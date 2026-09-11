#!/usr/bin/env python3
"""OmniBlock 的独立账户同步服务。

服务端只处理账户认证和客户端加密 envelope。它不导入 sync-core、不解密
名单/规则/反馈，也不接受 API Key。生产环境应把本进程绑定在 loopback，
再由已有 HTTPS 反向代理转发到外部域名。
"""

from __future__ import annotations

import argparse
import base64
import datetime as datetime_module
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


MAX_BODY_BYTES = 16 * 1024 * 1024
MAX_ENVELOPE_CHARS = 15 * 1024 * 1024
PASSWORD_ITERATIONS = 310_000
TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,64}$")
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ENVELOPE_FORMAT = "omniblock.sync-envelope"


class BadRequest(Exception):
    pass


class AccountExists(Exception):
    pass


class InvalidCredentials(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, revision: int, blob: dict[str, Any] | None):
        super().__init__("sync-revision-conflict")
        self.revision = revision
        self.blob = blob


def utc_now() -> str:
    return datetime_module.datetime.now(datetime_module.timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_username(value: Any) -> str:
    username = str(value or "").strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise BadRequest("invalid-registration")
    return username


def encode_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_bytes(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    if len(password) < 8 or len(password) > 256:
        raise BadRequest("invalid-registration")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS, dklen=32)
    return "pbkdf2-sha256${}${}${}".format(PASSWORD_ITERATIONS, encode_bytes(salt), encode_bytes(digest))


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, encoded_salt, encoded_digest = str(encoded).split("$", 3)
        if algorithm != "pbkdf2-sha256":
            return False
        iteration_count = int(iterations)
        if iteration_count < 100_000 or iteration_count > 1_000_000:
            return False
        salt = decode_bytes(encoded_salt)
        expected = decode_bytes(encoded_digest)
        actual = hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), salt, iteration_count, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError, UnicodeError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def account_id() -> str:
    return "acct_" + secrets.token_hex(10)


def access_token() -> str:
    return "tok_" + secrets.token_urlsafe(32)


def json_clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def validate_envelope(value: Any) -> dict[str, Any]:
    """Validate only the opaque envelope shape; never inspect plaintext fields."""
    if not isinstance(value, dict) or value.get("format") != ENVELOPE_FORMAT or value.get("schema") != 1:
        raise BadRequest("invalid-sync-envelope")
    if not isinstance(value.get("kdf"), dict) or not isinstance(value.get("cipher"), dict):
        raise BadRequest("invalid-sync-envelope")
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) > MAX_ENVELOPE_CHARS:
        raise BadRequest("sync-envelope-too-large")
    return json_clone(value)


class SyncStore:
    def __init__(self, database_path: str):
        self.lock = threading.RLock()
        path = Path(database_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        with self.lock:
            self.connection.execute("PRAGMA foreign_keys = ON")
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.execute("PRAGMA busy_timeout = 5000")
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS accounts (
                    account_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS access_tokens (
                    token_hash TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sync_states (
                    account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    blob_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS access_tokens_expiry_idx ON access_tokens(expires_at);
                """
            )
            self.connection.commit()

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    def register(self, username: str, password: str) -> dict[str, str]:
        normalized = normalize_username(username)
        password_hash = hash_password(password)
        result = {"accountId": account_id(), "username": normalized}
        with self.lock:
            try:
                self.connection.execute(
                    "INSERT INTO accounts(account_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (result["accountId"], normalized, password_hash, utc_now()),
                )
            except sqlite3.IntegrityError as error:
                raise AccountExists("account-exists") from error
        return result

    def login(self, username: str, password: str) -> dict[str, str]:
        normalized = str(username or "").strip().lower()
        with self.lock:
            row = self.connection.execute(
                "SELECT account_id, username, password_hash FROM accounts WHERE username = ?", (normalized,)
            ).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            raise InvalidCredentials("invalid-credentials")
        raw_token = access_token()
        expires_at = int(time.time()) + TOKEN_TTL_SECONDS
        with self.lock:
            self.connection.execute(
                "INSERT INTO access_tokens(token_hash, account_id, expires_at) VALUES (?, ?, ?)",
                (token_digest(raw_token), row["account_id"], expires_at),
            )
            self.connection.execute("DELETE FROM access_tokens WHERE expires_at < ?", (int(time.time()),))
        return {
            "accessToken": raw_token,
            "accountId": row["account_id"],
            "username": row["username"],
            "expiresAt": datetime_module.datetime.fromtimestamp(expires_at, datetime_module.timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    def account_for_token(self, raw_token: str) -> str | None:
        if not raw_token or len(raw_token) > 256:
            return None
        with self.lock:
            row = self.connection.execute(
                "SELECT account_id, expires_at FROM access_tokens WHERE token_hash = ?", (token_digest(raw_token),)
            ).fetchone()
        if not row or int(row["expires_at"]) < int(time.time()):
            return None
        return str(row["account_id"])

    def get_state(self, account: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute(
                "SELECT revision, blob_json, updated_at FROM sync_states WHERE account_id = ?", (account,)
            ).fetchone()
        if not row:
            return None
        return {
            "revision": int(row["revision"]),
            "blob": json.loads(row["blob_json"]),
            "updatedAt": row["updated_at"],
        }

    def put_state(self, account: str, base_revision: int, blob: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(blob, ensure_ascii=False, separators=(",", ":"))
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                row = self.connection.execute(
                    "SELECT revision, blob_json FROM sync_states WHERE account_id = ?", (account,)
                ).fetchone()
                current_revision = int(row["revision"]) if row else 0
                current_blob = json.loads(row["blob_json"]) if row else None
                if base_revision != current_revision:
                    self.connection.execute("ROLLBACK")
                    raise RevisionConflict(current_revision, current_blob)
                next_revision = current_revision + 1
                updated_at = utc_now()
                if row:
                    self.connection.execute(
                        "UPDATE sync_states SET revision = ?, blob_json = ?, updated_at = ? WHERE account_id = ?",
                        (next_revision, encoded, updated_at, account),
                    )
                else:
                    self.connection.execute(
                        "INSERT INTO sync_states(account_id, revision, blob_json, updated_at) VALUES (?, ?, ?, ?)",
                        (account, next_revision, encoded, updated_at),
                    )
                self.connection.execute("COMMIT")
                return {"revision": next_revision, "updatedAt": updated_at}
            except Exception:
                if self.connection.in_transaction:
                    self.connection.execute("ROLLBACK")
                raise


class SyncHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], store: SyncStore, allowed_origins: set[str]):
        self.store = store
        self.allowed_origins = allowed_origins
        super().__init__(address, SyncRequestHandler)


class SyncRequestHandler(http.server.BaseHTTPRequestHandler):
    server_version = "OmniBlockSync/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Do not write request headers, tokens, usernames or encrypted payloads to logs.
        return

    @property
    def sync_server(self) -> SyncHTTPServer:
        return self.server  # type: ignore[return-value]

    def origin_allowed(self, origin: str) -> bool:
        return bool(origin and origin in self.sync_server.allowed_origins)

    def send_json(self, status: int, body: dict[str, Any], origin: str = "") -> None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if origin and self.origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(payload)

    def send_empty(self, status: int, origin: str = "") -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        if origin and self.origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin", "")
        if not self.origin_allowed(origin):
            self.send_empty(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def body_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError as error:
            raise BadRequest("invalid-content-length") from error
        if length < 0 or length > MAX_BODY_BYTES:
            raise BadRequest("body-too-large")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise BadRequest("body-incomplete")
        try:
            value = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BadRequest("invalid-json") from error
        if not isinstance(value, dict):
            raise BadRequest("invalid-json-object")
        return value

    def bearer_account(self) -> str:
        header = str(self.headers.get("Authorization", ""))
        match = re.fullmatch(r"Bearer\s+(.+)", header, re.IGNORECASE)
        account = self.sync_server.store.account_for_token(match.group(1) if match else "")
        if not account:
            raise PermissionError("invalid-token")
        return account

    def route(self) -> tuple[int, dict[str, Any]]:
        path = urlsplit(self.path).path
        origin = self.headers.get("Origin", "")
        if self.command == "GET" and path == "/healthz":
            return 200, {"ok": True, "service": "omniblock-sync"}
        if self.command == "POST" and path == "/v1/auth/register":
            body = self.body_json()
            return 201, self.sync_server.store.register(body.get("username", ""), str(body.get("password", "")))
        if self.command == "POST" and path == "/v1/auth/login":
            body = self.body_json()
            try:
                return 200, self.sync_server.store.login(body.get("username", ""), str(body.get("password", "")))
            except InvalidCredentials as error:
                raise PermissionError(str(error)) from error
        if path != "/v1/sync/state" or self.command not in {"GET", "PUT"}:
            return 404, {"code": "not-found"}
        account = self.bearer_account()
        if self.command == "GET":
            state = self.sync_server.store.get_state(account)
            if not state:
                return 404, {"code": "empty"}
            return 200, state
        body = self.body_json()
        base_revision = body.get("baseRevision")
        if isinstance(base_revision, bool) or not isinstance(base_revision, int) or base_revision < 0:
            raise BadRequest("invalid-sync-write")
        blob = validate_envelope(body.get("blob"))
        return 200, self.sync_server.store.put_state(account, base_revision, blob)

    def handle_request(self) -> None:
        origin = self.headers.get("Origin", "")
        try:
            status, body = self.route()
            self.send_json(status, body, origin)
        except AccountExists:
            self.send_json(409, {"code": "account-exists"}, origin)
        except RevisionConflict as error:
            self.send_json(409, {"code": "sync_conflict", "revision": error.revision, "blob": error.blob}, origin)
        except PermissionError as error:
            self.send_json(401, {"code": str(error) or "unauthorized"}, origin)
        except BadRequest as error:
            self.send_json(400, {"code": str(error) or "bad-request"}, origin)
        except Exception:
            # The response intentionally does not expose a traceback or database detail.
            self.send_json(500, {"code": "internal-error"}, origin)

    def do_GET(self) -> None:
        self.handle_request()

    def do_POST(self) -> None:
        self.handle_request()

    def do_PUT(self) -> None:
        self.handle_request()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OmniBlock opaque encrypted sync server")
    parser.add_argument("--db", default="./omniblock-sync.sqlite3", help="独立 SQLite 数据库路径")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址；生产环境默认绑定 loopback")
    parser.add_argument("--port", type=int, default=8787, help="监听端口，测试可使用 0")
    parser.add_argument("--allow-origin", action="append", default=[], help="允许的精确 Origin，可重复；不要使用通配符")
    parser.add_argument("--allow-public-bind", action="store_true", help="明确允许绑定非 loopback 地址")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    host = str(args.host)
    if host not in LOOPBACK_HOSTS and not args.allow_public_bind:
        raise SystemExit("拒绝绑定非 loopback 地址；如由反向代理隔离，请显式传入 --allow-public-bind")
    if not 0 <= int(args.port) <= 65535:
        raise SystemExit("端口必须在 0..65535")
    allowed_origins = {str(value).strip() for value in args.allow_origin if str(value).strip() and str(value).strip() != "*"}
    store = SyncStore(args.db)
    server = SyncHTTPServer((host, int(args.port)), store, allowed_origins)
    port = int(server.server_address[1])
    print("READY " + str(port), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

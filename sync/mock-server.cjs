/* In-process HTTP server for the sync protocol regression suite.
 * It intentionally treats blob as opaque JSON and never imports the sync core,
 * so the test can catch accidental server-side plaintext coupling.
 */
const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 16 * 1024 * 1024;

function json(response, status, body) {
  const text = JSON.stringify(body || {});
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY) { reject(new Error('body-too-large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(new Error('invalid-json')); }
    });
    request.on('error', reject);
  });
}

function hashPassword(password, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), actualSalt, 32).toString('hex');
  return actualSalt + ':' + hash;
}

function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function accountId() { return 'acct_' + crypto.randomBytes(10).toString('hex'); }
function token() { return 'tok_' + crypto.randomBytes(32).toString('hex'); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function createMockSyncServer() {
  const accounts = new Map();
  const tokens = new Map();
  let server;

  async function handler(request, response) {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/healthz') { json(response, 200, { ok: true, service: 'omniblock-sync-mock' }); return; }
    let body = {};
    if (request.method === 'POST' || request.method === 'PUT') {
      try { body = await readBody(request); } catch (error) { json(response, 400, { code: error.message }); return; }
    }
    if (request.method === 'POST' && url.pathname === '/v1/auth/register') {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9_.-]{3,64}$/.test(username) || password.length < 8 || password.length > 256) { json(response, 400, { code: 'invalid-registration' }); return; }
      if (accounts.has(username)) { json(response, 409, { code: 'account-exists' }); return; }
      const account = { accountId: accountId(), username, passwordHash: hashPassword(password), revision: 0, blob: null, updatedAt: '' };
      accounts.set(username, account);
      json(response, 201, { accountId: account.accountId, username });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/auth/login') {
      const username = String(body.username || '').trim().toLowerCase();
      const account = accounts.get(username);
      if (!account || !verifyPassword(body.password, account.passwordHash)) { json(response, 401, { code: 'invalid-credentials' }); return; }
      const accessToken = token();
      tokens.set(accessToken, account.accountId);
      json(response, 200, { accessToken, accountId: account.accountId, username: account.username, expiresAt: new Date(Date.now() + 86400000).toISOString() });
      return;
    }
    if (url.pathname !== '/v1/sync/state' || !['GET', 'PUT'].includes(request.method)) { json(response, 404, { code: 'not-found' }); return; }
    const authorization = String(request.headers.authorization || '');
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i);
    const account = accessToken && accountsById(tokens.get(accessToken[1]));
    if (!account) { json(response, 401, { code: 'invalid-token' }); return; }
    if (request.method === 'GET') {
      if (!account.revision) { json(response, 404, { code: 'empty' }); return; }
      json(response, 200, { revision: account.revision, blob: clone(account.blob), updatedAt: account.updatedAt });
      return;
    }
    const baseRevision = Number(body.baseRevision);
    if (!Number.isSafeInteger(baseRevision) || !body.blob || typeof body.blob !== 'object' || Array.isArray(body.blob)) { json(response, 400, { code: 'invalid-sync-write' }); return; }
    if (baseRevision !== account.revision) { json(response, 409, { code: 'sync_conflict', revision: account.revision, blob: clone(account.blob) }); return; }
    account.revision++;
    account.blob = clone(body.blob);
    account.updatedAt = new Date().toISOString();
    json(response, 200, { revision: account.revision, updatedAt: account.updatedAt });
  }

  function accountsById(id) {
    if (!id) return null;
    for (const account of accounts.values()) if (account.accountId === id) return account;
    return null;
  }

  return {
    async start() {
      server = http.createServer((request, response) => { void handler(request, response).catch((error) => json(response, 500, { code: error.message })); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      return 'http://127.0.0.1:' + address.port;
    },
    async close() { if (server) await new Promise((resolve) => server.close(resolve)); },
    inspect(username) {
      const account = accounts.get(String(username || '').trim().toLowerCase());
      return account ? { revision: account.revision, blob: clone(account.blob) } : null;
    },
    forceWrite(username, blob) {
      const account = accounts.get(String(username || '').trim().toLowerCase());
      if (!account) throw new Error('account-not-found');
      account.revision++;
      account.blob = clone(blob);
      account.updatedAt = new Date().toISOString();
      return account.revision;
    },
  };
}

module.exports = { createMockSyncServer };

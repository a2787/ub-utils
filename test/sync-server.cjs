/* OmniBlock 独立 Python 同步服务回归。
 * 这是本地临时服务与人工合成账户；不连接东京服务器，不写入任何现有项目数据库。
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Sync = require('../sync/sync-core.js');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = process.env.OMNIBLOCK_PYTHON || 'python';

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('sync-server-start-timeout')), 10000);
    const onData = (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/(?:^|\r?\n)READY (\d+)(?:\r?\n|$)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timer); reject(new Error('sync-server-exit-' + code)); }
    });
  });
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniblock-sync-'));
  const database = path.join(tempDir, 'state.sqlite3');
  const child = spawn(PYTHON, ['sync-server/server.py', '--db', database, '--host', '127.0.0.1', '--port', '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  try {
    const port = await waitForReady(child);
    const endpoint = 'http://127.0.0.1:' + port;
    const health = await fetch(endpoint + '/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'omniblock-sync' });

    const username = 'synthetic-server-test';
    const password = 'synthetic-password-123';
    const registered = await Sync.register({ endpoint, username, password });
    assert.ok(registered.accountId);
    const login = await Sync.login({ endpoint, username, password });
    assert.ok(login.accessToken);

    const state = {
      data: { version: 1, persons: { person1: { id: 'person1', identities: ['bili:uid:10001'], label: 'synthetic' } }, settings: { enabled: true } },
      promptProfile: { schemaVersion: 1, profile: { objective: 'synthetic objective' }, personalization: {}, meta: {} },
      feedbackState: { schemaVersion: 1, events: [{ id: 'event1', label: 'positive', text: 'synthetic text', createdAt: 1 }], meta: {} },
    };
    const document = Sync.documentFromState(state, null, 'device-server-test');
    const synced = await Sync.synchronize({ endpoint, token: login.accessToken, accountId: login.accountId,
      passphrase: 'shared-sync-passphrase', deviceId: 'device-server-test', localDocument: document });
    assert.equal(synced.revision, 1);

    const remote = await fetch(endpoint + '/v1/sync/state', { headers: { Authorization: 'Bearer ' + login.accessToken } });
    assert.equal(remote.status, 200);
    const remoteBody = await remote.json();
    assert.equal(remoteBody.revision, 1);
    assert.equal(JSON.stringify(remoteBody.blob).includes('synthetic text'), false);
    assert.equal(JSON.stringify(remoteBody.blob).includes('synthetic-password'), false);

    const stale = await fetch(endpoint + '/v1/sync/state', {
      method: 'PUT', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + login.accessToken },
      body: JSON.stringify({ baseRevision: 0, blob: remoteBody.blob }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'sync_conflict');

    let wrongPassphrase = null;
    try {
      await Sync.synchronize({ endpoint, token: login.accessToken, accountId: login.accountId,
        passphrase: 'wrong-sync-passphrase', deviceId: 'device-server-test', localDocument: document });
    } catch (error) { wrongPassphrase = error; }
    assert.equal(wrongPassphrase && wrongPassphrase.code, 'crypto');
    console.log('PASS: 5 (Python service health/auth/encrypted blob/CAS/wrong-passphrase)');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    // Windows may release SQLite WAL handles a moment after the child exit
    // event. Cleanup is best-effort because the directory is already outside
    // the repository and a transient antivirus lock must not hide test results.
    let cleanupError = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); cleanupError = null; break; }
      catch (error) { cleanupError = error; await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1))); }
    }
    if (cleanupError && cleanupError.code !== 'EPERM' && cleanupError.code !== 'EBUSY') throw cleanupError;
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch((error) => { console.error('FAIL: ' + (error && error.stack || error)); process.exitCode = 1; });

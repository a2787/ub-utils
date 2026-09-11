/* Account-sync protocol regression.
 * The server is local and artificial. Assertions cover encrypted/opaque
 * storage, auth boundaries, CAS conflict convergence, tombstones, and a
 * transient offline retry; no real account or page identifier is used.
 */
const assert = require('assert');
const Sync = require('../sync/sync-core.js');
const { createMockSyncServer } = require('../sync/mock-server.cjs');

function person(id, label, key) {
  return { [id]: { label, note: '人工合成测试记录', createdAt: 1, hits: 0, identities: [key] } };
}
function makeStorage(persons, settings, events) {
  return {
    [Sync.DATA_KEY]: JSON.stringify({ version: 1, persons, settings }),
    [Sync.PROFILE_KEY]: JSON.stringify({ schemaVersion: 1, profile: { language: 'zh-CN', objective: '人工合成目标', blockCriteria: ['人工合成边界'], allowCriteria: [], priority: ['keyword', 'manual', 'ai'], reviewRequired: true }, personalization: { accepted: [], pending: [], dismissed: [] }, meta: { revision: 1, updatedAt: 1, profileConfigured: true } }),
    [Sync.FEEDBACK_KEY]: JSON.stringify({ schemaVersion: 1, events: events || [], meta: { revision: 1, updatedAt: 1 } }),
  };
}
function docFrom(storage, previous, deviceId) {
  return Sync.documentFromState(Sync.stateFromStorage(storage), previous, deviceId);
}
function fetchWithBase(base) {
  return (url, options) => fetch(new URL(url).href.replace(/^http:\/\/127\.0\.0\.1:\d+/, base), options);
}

(async () => {
  const server = createMockSyncServer();
  let base = '';
  const report = { pass: [], fail: [] };
  try {
    base = await server.start();
    const username = 'synthetic-sync-user';
    const accountPassword = 'synthetic-account-password';
    const passphrase = 'synthetic-sync-passphrase';
    const registered = await Sync.register({ endpoint: base, username, password: accountPassword });
    assert.strictEqual(registered.username, username);
    const auth = await Sync.login({ endpoint: base, username, password: accountPassword });
    assert.ok(auth.accessToken && auth.accountId);
    report.pass.push('本地 mock 支持注册/登录，并只向客户端返回访问令牌和账户元数据');

    await assert.rejects(() => Sync.login({ endpoint: base, username, password: 'wrong-password' }), (error) => error && error.code === 'auth');
    await assert.rejects(() => Sync.readRemote({ endpoint: base, token: 'invalid-token' }), (error) => error && error.code === 'auth');
    report.pass.push('错误账户密码和伪造令牌会得到可识别的 auth 失败');

    const storageA = makeStorage(person('p_a', '人工合成甲', 'bili:uid:101'), { aiEnabled: true, aiMode: 'direct', aiProviderUrl: 'https://provider.example/v1/chat/completions', aiProviderModel: 'synthetic-direct', aiRules: ['人工合成规则'] }, [{ id: 'fb_synthetic_a', platform: 'bilibili', kind: 'comment', contentType: 'comment', text: '人工合成反馈', label: 'positive', source: 'manual', reasonCode: 'other', note: '', createdAt: 2 }]);
    storageA[Sync.DEVICE_CONFIG_KEY] = JSON.stringify({ providerUrl: 'https://provider.example/v1/chat/completions', model: 'synthetic-direct', apiKey: 'synthetic-device-key' });
    const docA = docFrom(storageA, null, 'device-a');
    assert.ok(!JSON.stringify(docA).includes('synthetic-device-key'));
    const first = await Sync.synchronize({ endpoint: base, token: auth.accessToken, accountId: auth.accountId, passphrase, deviceId: 'device-a', localDocument: docA, fetchImpl: fetch });
    assert.strictEqual(first.revision, 1);
    const stored = server.inspect(username);
    assert.ok(stored && stored.blob);
    assert.ok(!JSON.stringify(stored.blob).includes('人工合成'));
    assert.ok(!JSON.stringify(stored.blob).includes('synthetic-device-key'));
    const decodedA = await Sync.decryptEnvelope(stored.blob, passphrase, auth.accountId);
    const materializedA = Sync.materializeDocument(decodedA);
    assert.strictEqual(materializedA.data.persons.p_a.label, '人工合成甲');
    await assert.rejects(() => Sync.decryptEnvelope(stored.blob, 'wrong-sync-passphrase', auth.accountId), /sync-decrypt-failed/);
    report.pass.push('云端 mock 只保存不透明密文；正确口令可恢复名单，错误口令不能解密');

    const storageB = makeStorage(person('p_b', '人工合成乙', 'weibo:uid:202'), { aiEnabled: false, aiMode: 'direct', aiProviderUrl: 'https://provider.example/v1/chat/completions' });
    const docB = docFrom(storageB, null, 'device-b');
    const second = await Sync.synchronize({ endpoint: base, token: auth.accessToken, accountId: auth.accountId, passphrase, deviceId: 'device-b', localDocument: docB, fetchImpl: fetch });
    const decodedB = await Sync.decryptEnvelope(server.inspect(username).blob, passphrase, auth.accountId);
    const mergedB = Sync.materializeDocument(decodedB);
    assert.ok(mergedB.data.persons.p_a && mergedB.data.persons.p_b);
    assert.strictEqual(mergedB.data.settings.aiMode, 'direct');
    assert.ok(second.revision >= 2);
    report.pass.push('第二台设备使用同一账户和口令后可合并名单、设置及反馈，不覆盖另一台设备的人物');

    // Make a stale local document, inject another device write immediately
    // before the stale PUT, and require the client to merge the 409 response.
    const stale = docFrom(makeStorage(person('p_stale', '人工合成陈', 'tieba:uid:303'), { aiEnabled: true, aiMode: 'direct' }), null, 'device-stale');
    let injected = false;
    const raceFetch = async (url, options) => {
      if (options && options.method === 'PUT' && !injected) {
        injected = true;
        const remote = await Sync.readRemote({ endpoint: base, token: auth.accessToken, fetchImpl: fetch });
        const remoteDoc = await Sync.decryptEnvelope(remote.blob, passphrase, auth.accountId);
        const concurrent = Sync.documentFromState(Sync.stateFromStorage(makeStorage(person('p_race', '人工合成并发', 'x:uid:404'), { aiEnabled: true, aiMode: 'direct', aiProviderUrl: 'https://provider.example/v1/chat/completions', aiProviderModel: 'synthetic-direct' })), remoteDoc, 'device-race');
        await Sync.synchronize({ endpoint: base, token: auth.accessToken, accountId: auth.accountId, passphrase, deviceId: 'device-race', localDocument: concurrent, fetchImpl: fetch });
      }
      return fetch(url, options);
    };
    const raced = await Sync.synchronize({ endpoint: base, token: auth.accessToken, accountId: auth.accountId, passphrase, deviceId: 'device-stale', localDocument: stale, fetchImpl: raceFetch, maxConflicts: 3 });
    assert.ok(raced.conflicts >= 1);
    const afterRace = Sync.materializeDocument(await Sync.decryptEnvelope(server.inspect(username).blob, passphrase, auth.accountId));
    assert.ok(afterRace.data.persons.p_stale && afterRace.data.persons.p_race);
    report.pass.push('CAS revision 冲突会触发确定性合并和自动重试，并保留并发设备的记录');

    const deletionBase = Sync.documentFromState(Sync.stateFromStorage(makeStorage(person('p_delete', '人工合成待删除', 'x:uid:505'), {})), raced.document, 'device-a');
    const deletionState = Sync.materializeDocument(deletionBase);
    delete deletionState.data.persons.p_delete;
    const deletionDoc = Sync.documentFromState(deletionState, deletionBase, 'device-a');
    assert.ok(deletionDoc.records.persons.p_delete.tombstone);
    const remoteAfterDelete = Sync.mergeDocuments(deletionDoc, raced.document, 'device-a');
    assert.ok(remoteAfterDelete.records.persons.p_delete.tombstone);
    report.pass.push('删除会生成墓碑，后续合并不会把已删除人物从旧设备重新带回');

    let attempts = 0;
    const retry = await Sync.synchronizeWithRetry({ endpoint: base, token: auth.accessToken, accountId: auth.accountId, passphrase, deviceId: 'device-a', localDocument: docA, retryDelayMs: 0, networkAttempts: 2,
      fetchImpl: async (url, options) => { attempts++; if (attempts === 1) throw new Error('synthetic-offline'); return fetch(url, options); } });
    assert.ok(retry.revision > 0 && attempts >= 2);
    report.pass.push('首次网络失败会保留失败并重试，恢复网络后同步成功');
  } catch (error) {
    report.fail.push(String(error && error.stack || error));
  } finally { await server.close(); }
  console.log('==== OmniBlock 账户同步协议回归 ====');
  console.log('SERVER: local in-process mock; DATA: artificial only');
  console.log('PASS:', report.pass.length); report.pass.forEach((item) => console.log('  ✅', item));
  console.log('FAIL:', report.fail.length); report.fail.forEach((item) => console.log('  ❌', item));
  const ok = report.fail.length === 0;
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

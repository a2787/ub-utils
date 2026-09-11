(() => {
  'use strict';

  const Sync = window.OmniBlockSync;
  if (!Sync) throw new Error('OmniBlock sync core unavailable');

  const ROLLBACK_KEY = 'omniblock:import-rollback:v1';
  const stateKeys = [Sync.DATA_KEY, Sync.PROFILE_KEY, Sync.FEEDBACK_KEY];
  let pendingImport = null;

  function chromeCall(method, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      const callback = (value) => {
        const lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError) fail(new Error(lastError.message || 'chrome-api-error'));
        else done(value);
      };
      try {
        const result = method(...(Array.isArray(args) ? args : []), callback);
        if (result && typeof result.then === 'function') result.then(done, fail);
      } catch (error) { fail(error); }
    });
  }

  const getStorage = (keys) => chromeCall(chrome.storage.local.get.bind(chrome.storage.local), [keys]);
  const setStorage = (values) => chromeCall(chrome.storage.local.set.bind(chrome.storage.local), [values]);
  const removeStorage = (keys) => chromeCall(chrome.storage.local.remove.bind(chrome.storage.local), [keys]);
  const sendMessage = (message) => chromeCall(chrome.runtime.sendMessage.bind(chrome.runtime), [message]);

  function element(id) { return document.getElementById(id); }
  function setStatus(id, message, kind) {
    const node = element(id);
    if (!node) return;
    node.textContent = String(message || '');
    node.className = 'status' + (kind ? ' ' + kind : '');
  }
  function errorMessage(error) {
    const code = String(error && error.code || '');
    if (code === 'offline') return '网络不可用；本机数据未丢失，已保留待重试状态。';
    if (code === 'auth') return '登录已失效或账户信息不正确，请重新登录。';
    if (code === 'crypto') return '无法解密云端数据；请确认两台设备使用的是同一个同步口令。';
    if (code === 'conflict') return '云端并发冲突超过重试上限，请稍后再次同步。';
    if (code === 'direct-ai-config-invalid') return 'API 地址或 Key 无效；请检查后重试。';
    if (code === 'direct-ai-host-permission-required') return '浏览器没有授予该 API 域名权限，请重新保存并允许访问。';
    return String(error && error.message || error || '操作失败');
  }
  function parseObject(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (error) {} }
    return null;
  }
  function countState(state) {
    const data = state && state.data || {};
    const persons = data.persons && typeof data.persons === 'object' ? Object.values(data.persons) : [];
    const prompt = state && state.promptProfile || {};
    const personalization = prompt.personalization && typeof prompt.personalization === 'object' ? prompt.personalization : {};
    const feedback = state && state.feedbackState || {};
    return {
      persons: persons.length,
      identities: persons.reduce((sum, person) => sum + (Array.isArray(person && person.identities) ? person.identities.length : 0), 0),
      settings: data.settings && typeof data.settings === 'object' ? Object.keys(data.settings).length : 0,
      feedback: Array.isArray(feedback.events) ? feedback.events.length : 0,
      preferences: ['accepted', 'pending', 'dismissed'].reduce((sum, key) => sum + (Array.isArray(personalization[key]) ? personalization[key].length : 0), 0),
    };
  }
  function summaryText(summary) {
    return '名单 ' + summary.persons + ' 人物 / ' + summary.identities + ' 个身份；'
      + '设置 ' + summary.settings + ' 项；AI 反馈 ' + summary.feedback + ' 条；提示词提案 ' + summary.preferences + ' 条。';
  }
  function makeDeviceId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return 'device-' + cryptoApi.randomUUID();
    return 'device-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  async function deviceId() {
    const values = await getStorage(Sync.DEVICE_ID_KEY);
    const existing = String(values && values[Sync.DEVICE_ID_KEY] || '').trim();
    if (existing) return existing;
    const created = makeDeviceId();
    await setStorage({ [Sync.DEVICE_ID_KEY]: created });
    return created;
  }
  async function currentState() {
    const raw = await getStorage(stateKeys);
    return { raw, state: Sync.stateFromStorage(raw) };
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.rel = 'noopener';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function normalizedEndpoint(value) {
    const endpoint = Sync.normalizeEndpoint(value);
    if (!endpoint) throw new Error('同步服务地址必须是 HTTPS；本机测试可使用 loopback HTTP');
    return endpoint;
  }
  async function requestOriginPermission(endpoint) {
    const url = new URL(endpoint);
    if (['localhost', '127.0.0.1', '[::1]'].includes(String(url.hostname || '').toLowerCase())) return true;
    if (!chrome.permissions || typeof chrome.permissions.request !== 'function') throw new Error('浏览器不支持请求同步服务域名权限');
    const granted = await chromeCall(chrome.permissions.request.bind(chrome.permissions), [{ origins: [url.origin + '/*'] }]);
    if (!granted) throw new Error('未授予同步服务域名权限');
    return true;
  }
  async function authState() {
    const values = await getStorage(Sync.AUTH_KEY);
    return parseObject(values && values[Sync.AUTH_KEY]);
  }
  async function saveAuth(auth) {
    const safe = {
      accessToken: String(auth && (auth.accessToken || auth.token) || ''),
      accountId: String(auth && auth.accountId || ''),
      username: String(auth && auth.username || ''),
      endpoint: normalizedEndpoint(auth && auth.endpoint || element('sync-endpoint').value),
      expiresAt: String(auth && auth.expiresAt || ''),
    };
    if (safe.accessToken.length < 8 || !safe.accountId) throw new Error('登录响应缺少账户凭据');
    await setStorage({ [Sync.AUTH_KEY]: safe });
    return safe;
  }

  async function load() {
    const manifest = chrome.runtime.getManifest();
    element('runtime-version').textContent = 'v' + manifest.version + ' · MV3 · ' + (manifest.description || '');
    const config = await sendMessage({ type: 'omniblock-device-config:get' }).catch(() => ({ configured: false }));
    if (config && config.configured) {
      element('provider-url').value = config.providerUrl || '';
      element('provider-model').value = config.model || '';
      setStatus('provider-status', '当前设备已配置直连 Key（Key 本身不会显示）。', 'success');
    } else setStatus('provider-status', '当前设备尚未配置直连 Key。');
    const auth = await authState();
    if (auth) {
      element('sync-endpoint').value = auth.endpoint || '';
      element('sync-username').value = auth.username || '';
      setStatus('sync-status', '已登录账户 ' + (auth.username || '当前账户') + '；同步口令不会保存。', 'success');
    }
    const current = await currentState();
    setStatus('import-status', '当前数据：' + summaryText(countState(current.state)));
  }

  async function saveProvider() {
    const endpoint = element('provider-url').value.trim();
    const model = element('provider-model').value.trim();
    const apiKey = element('provider-key').value.trim();
    try {
      const normalized = Sync.normalizeEndpoint(endpoint);
      // Provider URL has the same transport safety boundary as the service worker;
      // the actual final validation and secret write remain inside the worker.
      if (!normalized && !/^https:\/\//i.test(endpoint) && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i.test(endpoint)) throw new Error('API 地址必须是 HTTPS；本机测试可使用 loopback HTTP');
      await requestOriginPermission(normalized || endpoint);
      const result = await sendMessage({ type: 'omniblock-device-config:set', providerUrl: endpoint, model, apiKey, keepExisting: !apiKey });
      if (!result || !result.ok) throw Object.assign(new Error(result && result.error || '设备直连配置保存失败'), { code: result && result.error });
      const current = await currentState();
      const providerUrl = result.config && result.config.providerUrl || normalized || endpoint;
      const providerModel = result.config && result.config.model || model;
      const nextState = {
        ...current.state,
        data: {
          ...current.state.data,
          settings: {
            ...current.state.data.settings,
            aiMode: 'direct',
            aiProviderUrl: providerUrl,
            aiProviderModel: providerModel,
          },
        },
      };
      await setStorage(Sync.storageFromState(nextState));
      element('provider-key').value = '';
      setStatus('provider-status', '已保存并启用当前设备直连配置。Key 只存在 service worker 的扩展存储。', 'success');
    } catch (error) { setStatus('provider-status', errorMessage(error), 'error'); }
  }
  async function clearProvider() {
    try {
      const result = await sendMessage({ type: 'omniblock-device-config:clear' });
      if (!result || !result.ok) throw new Error(result && result.error || '清除失败');
      element('provider-key').value = '';
      setStatus('provider-status', '已清除当前设备的直连 Key。', 'success');
    } catch (error) { setStatus('provider-status', errorMessage(error), 'error'); }
  }

  async function exportData() {
    try {
      const current = await currentState();
      const packageObject = Sync.exportPackage(current.raw, { source: 'omniblock-extension' });
      download('omniblock-export-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(packageObject, null, 2));
      setStatus('import-status', '已导出当前有效数据；没有包含 API Key、登录令牌、日志或本地快照。', 'success');
    } catch (error) { setStatus('import-status', errorMessage(error), 'error'); }
  }
  async function inspectImport(file) {
    try {
      const text = await file.text();
      const source = JSON.parse(text);
      const current = await currentState();
      const imported = Sync.importPackage(source);
      // Legacy Store.exportJSON has no prompt fields; migration must not erase
      // prompt feedback already present in the extension.
      if (!source.data && source.promptProfile === undefined && source.feedbackState === undefined) {
        imported.promptProfile = current.state.promptProfile;
        imported.feedbackState = current.state.feedbackState;
      }
      const summary = countState(imported);
      pendingImport = { state: imported, summary };
      const preview = element('import-preview');
      preview.hidden = false;
      preview.textContent = '待导入预览（尚未写入）：\n' + summaryText(summary)
        + '\n\n导入会替换当前名单、设置、提示词和反馈；API Key、登录令牌、日志、本地快照不会被导入。确认后可恢复上一次导入前状态。';
      element('import-actions').hidden = false;
      setStatus('import-status', '已完成格式校验，请检查预览后再确认。');
    } catch (error) {
      pendingImport = null;
      element('import-actions').hidden = true;
      element('import-preview').hidden = true;
      setStatus('import-status', '导入文件无效：' + errorMessage(error), 'error');
    }
  }
  async function confirmImport() {
    if (!pendingImport) return;
    try {
      const current = await currentState();
      await setStorage({ [ROLLBACK_KEY]: { createdAt: Date.now(), storage: current.raw } });
      await setStorage(Sync.storageFromState(pendingImport.state));
      setStatus('import-status', '已导入：' + summaryText(pendingImport.summary) + '；回滚点已保存在本机。', 'success');
      pendingImport = null;
      element('import-actions').hidden = true;
      element('import-preview').hidden = true;
    } catch (error) { setStatus('import-status', '导入写入失败，当前数据未确认替换：' + errorMessage(error), 'error'); }
  }
  function cancelImport() {
    pendingImport = null;
    element('import-actions').hidden = true;
    element('import-preview').hidden = true;
    setStatus('import-status', '已取消导入。');
  }
  async function rollbackImport() {
    try {
      const values = await getStorage(ROLLBACK_KEY);
      const rollback = parseObject(values && values[ROLLBACK_KEY]);
      if (!rollback || !rollback.storage) throw new Error('暂无可用回滚点');
      await setStorage(rollback.storage);
      const summary = countState(Sync.stateFromStorage(rollback.storage));
      setStatus('import-status', '已恢复上一次导入前状态：' + summaryText(summary), 'success');
    } catch (error) { setStatus('import-status', errorMessage(error), 'error'); }
  }

  async function registerAccount() {
    try {
      const endpoint = normalizedEndpoint(element('sync-endpoint').value);
      await requestOriginPermission(endpoint);
      const username = element('sync-username').value.trim();
      const password = element('sync-password').value;
      if (!username || password.length < 8) throw new Error('账户名不能为空，账户密码至少 8 个字符');
      const result = await Sync.register({ endpoint, username, password });
      setStatus('sync-status', '账户已注册（' + String(result && result.username || username) + '）；请点击登录，账户密码不会保存。', 'success');
    } catch (error) { setStatus('sync-status', errorMessage(error), 'error'); }
  }
  async function loginAccount() {
    try {
      const endpoint = normalizedEndpoint(element('sync-endpoint').value);
      await requestOriginPermission(endpoint);
      const username = element('sync-username').value.trim();
      const password = element('sync-password').value;
      if (!username || password.length < 8) throw new Error('账户名不能为空，账户密码至少 8 个字符');
      const result = await Sync.login({ endpoint, username, password });
      const auth = await saveAuth({ ...result, endpoint, username });
      element('sync-password').value = '';
      setStatus('sync-status', '已登录账户 ' + auth.username + '；请输入同步口令后点击立即同步。', 'success');
    } catch (error) { setStatus('sync-status', errorMessage(error), 'error'); }
  }
  async function logoutAccount() {
    await removeStorage(Sync.AUTH_KEY).catch(() => {});
    setStatus('sync-status', '已清除本机登录令牌；云端数据未删除。', 'success');
  }
  async function syncNow() {
    const passphrase = element('sync-passphrase').value;
    let localDocument;
    try {
      const auth = await authState();
      if (!auth || !auth.accessToken || !auth.accountId) throw Object.assign(new Error('请先登录同步账户'), { code: 'auth' });
      const endpoint = normalizedEndpoint(element('sync-endpoint').value || auth.endpoint);
      await requestOriginPermission(endpoint);
      const current = await currentState();
      const device = await deviceId();
      const localValues = await getStorage(Sync.LOCAL_STATE_KEY);
      const localMeta = parseObject(localValues && localValues[Sync.LOCAL_STATE_KEY]);
      localDocument = Sync.documentFromState(current.state, localMeta && localMeta.document, device);
      const result = await Sync.synchronizeWithRetry({ endpoint, token: auth.accessToken, accountId: auth.accountId,
        passphrase, deviceId: device, localDocument, maxConflicts: 3, networkAttempts: 2 });
      const materialized = Sync.materializeDocument(result.document);
      await setStorage(Sync.storageFromState(materialized));
      await setStorage({ [Sync.LOCAL_STATE_KEY]: { deviceId: device, document: result.document, revision: result.revision, updatedAt: Date.now(), pending: false } });
      element('sync-passphrase').value = '';
      setStatus('sync-status', '同步完成；云端 revision ' + result.revision + '，合并并发变更 ' + result.conflicts + ' 次。同步口令已从页面清除。', 'success');
    } catch (error) {
      if (localDocument) await setStorage({ [Sync.LOCAL_STATE_KEY]: { document: localDocument, pending: true, updatedAt: Date.now() } }).catch(() => {});
      setStatus('sync-status', errorMessage(error), 'error');
    }
  }

  element('save-provider').onclick = saveProvider;
  element('clear-provider').onclick = clearProvider;
  element('export-data').onclick = exportData;
  element('import-file').onchange = (event) => { const file = event.target.files && event.target.files[0]; if (file) void inspectImport(file); event.target.value = ''; };
  element('confirm-import').onclick = confirmImport;
  element('cancel-import').onclick = cancelImport;
  element('rollback-import').onclick = rollbackImport;
  element('register-account').onclick = registerAccount;
  element('login-account').onclick = loginAccount;
  element('logout-account').onclick = logoutAccount;
  element('sync-now').onclick = syncNow;
  void load().catch((error) => setStatus('import-status', errorMessage(error), 'error'));
})();

/* 从当前 userscript 生成专用调试 Chrome 使用的临时 MV3 扩展。
 * 生成目录 test/_dev-extension/ 已加入 .gitignore，不进入发布物。
 * 运行：node test/build-dev-extension.cjs
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'omniblock.user.js');
const OUTPUT_DIR = path.join(ROOT, 'test', '_dev-extension');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const version = (source.match(/\/\/\s*@version\s+([\d.]+)/) || [])[1];
const build = (source.match(/const RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/) || [])[1];
if (!version || !build) throw new Error('无法从 userscript 读取 @version/RUNTIME_BUILD');

const matches = [
  // userscript 的通配匹配覆盖作者页、播放器子域和移动站；开发扩展必须
  // 逐平台镜像这些边界，否则“新页面自动加载”会只对首页偶然成立。
  'https://bilibili.com/*', 'https://*.bilibili.com/*',
  'https://douyin.com/*', 'https://*.douyin.com/*',
  'https://weibo.com/*', 'https://*.weibo.com/*',
  'https://m.weibo.cn/*',
  'https://zhihu.com/*', 'https://*.zhihu.com/*',
  'https://tieba.baidu.com/*',
  'https://x.com/*', 'https://*.x.com/*',
  'https://twitter.com/*', 'https://*.twitter.com/*',
];

// 隔离世界负责 chrome.storage/跨域只读请求；主世界负责与平台页面共享
// fetch/XHR 原型和 DOM 运行环境，等存储快照就绪后再执行 userscript。
const manifest = {
  manifest_version: 3,
  name: 'OmniBlock development runtime',
  version,
  description: 'Local-only development runtime for OmniBlock browser validation.',
  permissions: ['storage'],
  host_permissions: [
    'https://raw.githubusercontent.com/*',
    'https://api.bilibili.com/*',
  ],
  content_scripts: [
    { matches, js: ['bridge-isolated.js'], run_at: 'document_start' },
    { matches, js: ['bridge-main.js', 'omniblock.user.js'], run_at: 'document_start', world: 'MAIN' },
  ],
};

const isolatedBridge = String.raw`(() => {
  'use strict';
  const CHANNEL = '__OMNIBLOCK_EXTENSION_GM_V1__';
  const ownWrites = new Map();
  const xhrControllers = new Map();

  function post(message) {
    window.postMessage({ channel: CHANNEL, source: 'omniblock-isolated', ...message }, '*');
  }
  function rememberOwn(key, entry) {
    const list = ownWrites.get(key) || [];
    list.push(entry);
    ownWrites.set(key, list);
  }
  function forgetOwn(key, entry) {
    const list = ownWrites.get(key) || [];
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
    if (list.length) ownWrites.set(key, list); else ownWrites.delete(key);
  }
  function consumeOwn(key, change) {
    const list = ownWrites.get(key) || [];
    const removed = typeof change.newValue === 'undefined';
    const index = list.findIndex((entry) => entry.removed === removed
      && (removed || entry.value === change.newValue));
    if (index < 0) return false;
    list.splice(index, 1);
    if (list.length) ownWrites.set(key, list); else ownWrites.delete(key);
    return true;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.channel !== CHANNEL
      || event.data.source !== 'omniblock-main') return;
    const message = event.data;
    if (message.type === 'ready-request') {
      chrome.storage.local.get(null).then((values) => {
        post({ type: 'ready-response', requestId: message.requestId, values: values || {} });
      }).catch((error) => {
        post({ type: 'ready-response', requestId: message.requestId, values: {}, error: String(error && error.message || error) });
      });
      return;
    }
    if (message.type === 'set') {
      const key = String(message.key || '');
      if (!key) return;
      const own = { removed: false, value: message.value };
      rememberOwn(key, own);
      chrome.storage.local.set({ [key]: message.value }).catch(() => forgetOwn(key, own));
      return;
    }
    if (message.type === 'remove') {
      const key = String(message.key || '');
      if (!key) return;
      const own = { removed: true };
      rememberOwn(key, own);
      chrome.storage.local.remove(key).catch(() => forgetOwn(key, own));
      return;
    }
    if (message.type === 'xhr') {
      const id = String(message.id || '');
      if (!id || !message.url) return;
      const controller = new AbortController();
      xhrControllers.set(id, controller);
      fetch(String(message.url), {
        method: String(message.method || 'GET'),
        headers: message.headers && typeof message.headers === 'object' ? message.headers : {},
        body: message.data == null ? undefined : String(message.data),
        credentials: 'omit',
        signal: controller.signal,
      }).then(async (response) => {
        const responseText = await response.text();
        post({ type: 'xhr-response', id, ok: true, status: response.status,
          statusText: response.statusText, responseText, responseHeaders: '' });
      }).catch((error) => {
        if (error && error.name === 'AbortError') return;
        post({ type: 'xhr-response', id, ok: false, error: String(error && error.message || error) });
      }).finally(() => xhrControllers.delete(id));
      return;
    }
    if (message.type === 'xhr-abort') {
      const controller = xhrControllers.get(String(message.id || ''));
      if (controller) controller.abort();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const external = {};
    for (const key of Object.keys(changes || {})) {
      const change = changes[key];
      if (!consumeOwn(key, change)) {
        external[key] = {
          oldValue: change && change.oldValue,
          newValue: change && change.newValue,
          removed: typeof (change && change.newValue) === 'undefined',
        };
      }
    }
    if (Object.keys(external).length) post({ type: 'storage-changed', changes: external });
  });
})();
`;

const mainBridge = String.raw`(() => {
  'use strict';
  const CHANNEL = '__OMNIBLOCK_EXTENSION_GM_V1__';
  const values = Object.create(null);
  const listeners = new Map();
  const xhrCallbacks = new Map();
  let ready = false;
  let readyResolve;
  let readyTimer = 0;
  let requestSequence = 0;
  const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

  function post(message) {
    window.postMessage({ channel: CHANNEL, source: 'omniblock-main', ...message }, '*');
  }
  function requestReady() {
    if (ready) return;
    post({ type: 'ready-request', requestId: 'ready_' + (++requestSequence) });
    readyTimer = setTimeout(requestReady, 50);
  }
  function notifyValueChange(key, change) {
    const previous = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    if (change && change.removed) delete values[key];
    else if (change) values[key] = change.newValue;
    const callbacks = listeners.get(key) || [];
    callbacks.slice().forEach((callback) => {
      try { callback(key, previous, change && change.removed ? undefined : change.newValue, true); } catch (error) {}
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.channel !== CHANNEL
      || event.data.source !== 'omniblock-isolated') return;
    const message = event.data;
    if (message.type === 'ready-response') {
      Object.keys(values).forEach((key) => delete values[key]);
      Object.assign(values, message.values && typeof message.values === 'object' ? message.values : {});
      ready = true;
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = 0; }
      readyResolve();
      return;
    }
    if (message.type === 'storage-changed') {
      for (const key of Object.keys(message.changes || {})) notifyValueChange(key, message.changes[key]);
      return;
    }
    if (message.type === 'xhr-response') {
      const callback = xhrCallbacks.get(String(message.id || ''));
      if (!callback) return;
      xhrCallbacks.delete(String(message.id || ''));
      if (message.ok) {
        try { if (callback.onload) callback.onload(message); } catch (error) {}
      } else {
        try { if (callback.onerror) callback.onerror(new Error(message.error || 'GM_xmlhttpRequest failed')); } catch (error) {}
      }
    }
  });

  window.__OB_EXTENSION_READY__ = () => readyPromise;
  window.GM_getValue = (key, fallback) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
  window.GM_setValue = (key, value) => {
    const normalized = String(key || '');
    if (!normalized) return;
    values[normalized] = value;
    post({ type: 'set', key: normalized, value });
  };
  window.GM_deleteValue = (key) => {
    const normalized = String(key || '');
    if (!normalized) return;
    delete values[normalized];
    post({ type: 'remove', key: normalized });
  };
  window.GM_addValueChangeListener = (key, callback) => {
    if (typeof callback !== 'function') return 0;
    const normalized = String(key || '');
    const list = listeners.get(normalized) || [];
    list.push(callback); listeners.set(normalized, list);
    return list.length;
  };
  window.GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = String(css || '');
    (document.head || document.documentElement || document.body).appendChild(style);
  };
  window.GM_registerMenuCommand = () => {};
  window.GM_xmlhttpRequest = (details) => {
    const id = 'xhr_' + (++requestSequence);
    xhrCallbacks.set(id, details || {});
    post({ type: 'xhr', id, url: details && details.url, method: details && details.method,
      headers: details && details.headers, data: details && details.data });
    return { abort: () => { xhrCallbacks.delete(id); post({ type: 'xhr-abort', id }); } };
  };
  window.GM_openInTab = (url) => window.open(String(url || ''), '_blank', 'noopener');
  window.GM_info = { script: {
    name: '本地内容过滤增强', version: '__OB_VERSION__', namespace: 'https://github.com/a2787/ub-utils',
  } };
  window.__OB_EXTENSION_RUNTIME__ = { mode: 'persistent-dev-extension', version: '__OB_VERSION__', build: '__OB_BUILD__' };
  requestReady();
})();
`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'bridge-isolated.js'), isolatedBridge, 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'bridge-main.js'), mainBridge
  .replaceAll('__OB_VERSION__', version).replaceAll('__OB_BUILD__', build), 'utf8');
fs.copyFileSync(SOURCE_PATH, path.join(OUTPUT_DIR, 'omniblock.user.js'));

const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
console.log(JSON.stringify({
  status: 'built',
  directory: path.relative(ROOT, OUTPUT_DIR).replaceAll(path.sep, '/'),
  version,
  build,
  sourceHash,
  pages: 'new matching documents load automatically; no per-page source injection',
}, null, 2));

module.exports = { ROOT, OUTPUT_DIR, version, build, sourceHash };

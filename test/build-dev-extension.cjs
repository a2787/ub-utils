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
const bridgeSecret = crypto.randomBytes(32).toString('hex');
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
  background: { service_worker: 'bridge-service-worker.js' },
  host_permissions: [
    'https://raw.githubusercontent.com/*',
    'https://api.bilibili.com/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
    'http://[::1]/*',
  ],
  content_scripts: [
    { matches, js: ['bridge-isolated.js'], run_at: 'document_start' },
    { matches, js: ['runtime-main.js'], run_at: 'document_start', world: 'MAIN' },
  ],
};

const isolatedBridge = String.raw`(() => {
  'use strict';
  const CHANNEL = '__OMNIBLOCK_EXTENSION_GM_V1__';
  const BRIDGE_SECRET = '__OB_BRIDGE_SECRET__';
  const SOURCE = 'omniblock-isolated';
  const EXPECTED_SOURCE = 'omniblock-main';
  const MAX_VALUE_CHARS = 4 * 1024 * 1024;
  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_AI_REQUEST_CHARS = 256 * 1024;
  const MAX_AI_REQUEST_TIMEOUT_MS = 60000;
  const ownWrites = new Map();
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const importKey = subtle && subtle.importKey.bind(subtle);
  const signHmac = subtle && subtle.sign.bind(subtle);
  const verifyHmac = subtle && subtle.verify.bind(subtle);
  const postWindow = window.postMessage.bind(window);
  let outgoingSequence = 0;
  let incomingSequence = 0;
  let postChain = Promise.resolve();
  let receiveChain = Promise.resolve();

  const keyBytes = Uint8Array.from(BRIDGE_SECRET.match(/../g) || [], (value) => parseInt(value, 16));
  const keyPromise = importKey
    ? importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    : Promise.reject(new Error('WebCrypto unavailable'));

  function decodeMac(value) {
    try {
      const binary = atob(String(value || ''));
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch (error) { return new Uint8Array(); }
  }
  function encodeMac(value) {
    return btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join(''));
  }
  async function signedEnvelope(message) {
    const sequence = ++outgoingSequence;
    const payload = JSON.stringify(message);
    const input = SOURCE + '|' + sequence + '|' + payload;
    const key = await keyPromise;
    const mac = await signHmac('HMAC', key, encoder.encode(input));
    return { channel: CHANNEL, source: SOURCE, sequence, payload, mac: encodeMac(mac) };
  }
  async function verifyEnvelope(envelope) {
    if (!envelope || envelope.channel !== CHANNEL || envelope.source !== EXPECTED_SOURCE
      || !Number.isSafeInteger(envelope.sequence) || envelope.sequence <= incomingSequence
      || typeof envelope.payload !== 'string' || envelope.payload.length > MAX_VALUE_CHARS * 2) return null;
    const input = EXPECTED_SOURCE + '|' + envelope.sequence + '|' + envelope.payload;
    const key = await keyPromise;
    const valid = await verifyHmac('HMAC', key, decodeMac(envelope.mac), encoder.encode(input));
    if (!valid) return null;
    incomingSequence = envelope.sequence;
    try { return JSON.parse(envelope.payload); } catch (error) { return null; }
  }

  function post(message) {
    postChain = postChain.catch(() => {}).then(async () => {
      const envelope = await signedEnvelope(message);
      postWindow(envelope, location.origin);
      return true;
    }).catch(() => false);
    return postChain;
  }
  function isAllowedStorageKey(key) {
    const value = String(key || '');
    return value === 'omniblock:data:v1' || value === 'omniblock:backup:v1'
      || value === 'omniblock:events:index:v1'
      || /^omniblock:events:v1:\d{4}-\d{2}-\d{2}$/.test(value);
  }
  function allowedStorageValues(values) {
    const out = {};
    for (const key of Object.keys(values || {})) if (isAllowedStorageKey(key)) out[key] = values[key];
    return out;
  }
  function normalizeAllowedUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) return '';
      if (url.hostname === 'raw.githubusercontent.com'
        && url.pathname === '/a2787/ub-utils/master/omniblock.user.js' && !url.search) return url.href;
      if (url.hostname === 'api.bilibili.com' && url.pathname === '/x/web-interface/card') {
        if (Array.from(url.searchParams.keys()).some((key) => key !== 'type' && key !== 'mid')) return '';
        if (url.searchParams.get('type') !== 'json' || !/^\d{1,20}$/.test(url.searchParams.get('mid') || '')) return '';
        return url.href;
      }
    } catch (error) {}
    return '';
  }
  function normalizeLoopbackAIUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' || url.username || url.password || url.hash
        || !['localhost', '127.0.0.1', '[::1]'].includes(String(url.hostname || '').toLowerCase())) return '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (error) { return ''; }
  }
  function normalizeAIHeaders(headers) {
    if (!headers || typeof headers !== 'object') return null;
    const out = {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (!['accept', 'content-type'].includes(lower)) return null;
      out[lower] = String(headers[key] || '');
    }
    if (!out['content-type'] || !out.accept
      || out['content-type'].toLowerCase() !== 'application/json'
      || out.accept.toLowerCase() !== 'application/json') return null;
    return out;
  }
  function isAllowedAIRequestData(data) {
    if (typeof data !== 'string' || data.length > MAX_AI_REQUEST_CHARS) return false;
    let body;
    try { body = JSON.parse(data); } catch (error) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['model', 'temperature', 'messages'].includes(key))
      || typeof body.model !== 'string' || body.model.length > 120
      || typeof body.temperature !== 'number' || !Array.isArray(body.messages) || body.messages.length !== 2) return false;
    if (body.messages.some((message) => !message || typeof message !== 'object'
      || !['system', 'user'].includes(message.role) || typeof message.content !== 'string'
      || message.content.length > MAX_AI_REQUEST_CHARS)) return false;
    let input;
    try { input = JSON.parse(body.messages[1].content); } catch (error) { return false; }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['rules', 'items'].includes(key))
      || !Array.isArray(input.rules) || input.rules.length > 32
      || !Array.isArray(input.items) || input.items.length > 80) return false;
    return input.rules.every((rule) => typeof rule === 'string' && rule.length <= 500)
      && input.items.every((item) => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every((key) => ['id', 'kind', 'text'].includes(key))
        && typeof item.id === 'string' && item.id.length <= 80
        && (item.kind === 'comment' || item.kind === 'danmaku')
        && typeof item.text === 'string' && item.text.length <= 800);
  }
  function normalizeAllowedRequest(message) {
    const method = String(message && message.method || 'GET').toUpperCase();
    const url = normalizeAllowedUrl(message && message.url);
    if (method === 'GET' && url && message && message.data == null
      && (!message.headers || Object.keys(message.headers).length === 0)) {
      return { url, method, headers: {}, body: undefined, timeout: 15000 };
    }
    const aiUrl = normalizeLoopbackAIUrl(message && message.url);
    const headers = normalizeAIHeaders(message && message.headers);
    if (method === 'POST' && aiUrl && headers && isAllowedAIRequestData(message && message.data)) {
      return { url: aiUrl, method, headers, body: message.data, timeout: MAX_AI_REQUEST_TIMEOUT_MS };
    }
    return null;
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

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready-request') {
      chrome.storage.local.get(null).then((values) => {
        post({ type: 'ready-response', requestId: String(message.requestId || ''), values: allowedStorageValues(values) });
      }).catch((error) => {
        post({ type: 'ready-response', requestId: String(message.requestId || ''), values: {}, error: 'storage-unavailable' });
      });
      return;
    }
    if (message.type === 'set') {
      const key = String(message.key || '');
      let serialized = '';
      try { serialized = JSON.stringify(message.value); } catch (error) { return; }
      if (!isAllowedStorageKey(key) || serialized.length > MAX_VALUE_CHARS) return;
      const own = { removed: false, value: message.value };
      rememberOwn(key, own);
      chrome.storage.local.set({ [key]: message.value }).catch(() => forgetOwn(key, own));
      return;
    }
    if (message.type === 'remove') {
      const key = String(message.key || '');
      if (!isAllowedStorageKey(key)) return;
      const own = { removed: true };
      rememberOwn(key, own);
      chrome.storage.local.remove(key).catch(() => forgetOwn(key, own));
      return;
    }
    if (message.type === 'xhr') {
      const id = String(message.id || '');
      const request = normalizeAllowedRequest(message);
      if (!id || !request) {
        post({ type: 'xhr-response', id, ok: false, error: 'request-not-allowed' });
        return;
      }
      chrome.runtime.sendMessage({ type: 'omniblock-xhr', id, url: request.url,
        method: request.method, headers: request.headers, body: request.body,
        timeout: message.timeout }, (response) => {
        if (chrome.runtime.lastError) {
          post({ type: 'xhr-response', id, ok: false, error: 'extension-request-failed' });
          return;
        }
        post(response && response.type === 'xhr-response'
          ? response : { type: 'xhr-response', id, ok: false, error: 'extension-empty-response' });
      });
      return;
    }
    if (message.type === 'xhr-abort') {
      chrome.runtime.sendMessage({ type: 'omniblock-xhr-abort', id: String(message.id || '') });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data
      || event.data.channel !== CHANNEL || event.data.source !== EXPECTED_SOURCE) return;
    receiveChain = receiveChain.catch(() => {}).then(async () => {
      const message = await verifyEnvelope(event.data);
      if (message) await handleMessage(message);
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const external = {};
    for (const key of Object.keys(changes || {})) {
      if (!isAllowedStorageKey(key)) continue;
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

const serviceWorker = String.raw`(() => {
  'use strict';
  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_AI_REQUEST_CHARS = 256 * 1024;
  const MAX_AI_REQUEST_TIMEOUT_MS = 60000;
  const controllers = new Map();

  function requestKey(sender, id) {
    const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : 'extension';
    return String(tabId) + ':' + String(id || '');
  }

  function normalizeLoopbackUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' || url.username || url.password || url.hash
        || !['localhost', '127.0.0.1', '[::1]'].includes(String(url.hostname || '').toLowerCase())) return '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (error) { return ''; }
  }

  function normalizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') return null;
    const out = {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (!['accept', 'content-type'].includes(lower)) return null;
      out[lower] = String(headers[key] || '');
    }
    if (!out.accept || !out['content-type']
      || out.accept.toLowerCase() !== 'application/json'
      || out['content-type'].toLowerCase() !== 'application/json') return null;
    return out;
  }

  function allowedBody(data) {
    if (typeof data !== 'string' || data.length > MAX_AI_REQUEST_CHARS) return false;
    let body;
    try { body = JSON.parse(data); } catch (error) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['model', 'temperature', 'messages'].includes(key))
      || typeof body.model !== 'string' || body.model.length > 120
      || typeof body.temperature !== 'number' || !Array.isArray(body.messages) || body.messages.length !== 2) return false;
    if (body.messages.some((message) => !message || typeof message !== 'object'
      || !['system', 'user'].includes(message.role) || typeof message.content !== 'string'
      || message.content.length > MAX_AI_REQUEST_CHARS)) return false;
    let input;
    try { input = JSON.parse(body.messages[1].content); } catch (error) { return false; }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['rules', 'items'].includes(key))
      || !Array.isArray(input.rules) || input.rules.length > 32
      || !Array.isArray(input.items) || input.items.length > 80) return false;
    return input.rules.every((rule) => typeof rule === 'string' && rule.length <= 500)
      && input.items.every((item) => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every((key) => ['id', 'kind', 'text'].includes(key))
        && typeof item.id === 'string' && item.id.length <= 80
        && (item.kind === 'comment' || item.kind === 'danmaku')
        && typeof item.text === 'string' && item.text.length <= 800);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const id = String(message && message.id || '');
    if (!id) return false;
    const key = requestKey(sender, id);
    if (message.type === 'omniblock-xhr-abort') {
      const state = controllers.get(key);
      if (state) state.controller.abort('aborted');
      return false;
    }
    if (message.type !== 'omniblock-xhr' || String(message.method || '').toUpperCase() !== 'POST') return false;
    const url = normalizeLoopbackUrl(message.url);
    const headers = normalizeHeaders(message.headers);
    if (!url || !headers || !allowedBody(message.body)) {
      sendResponse({ type: 'xhr-response', id, ok: false, error: 'request-not-allowed' });
      return false;
    }
    const controller = new AbortController();
    const state = { controller, timedOut: false };
    controllers.set(key, state);
    const timeout = Math.max(1000, Math.min(Number(message.timeout) || MAX_AI_REQUEST_TIMEOUT_MS, MAX_AI_REQUEST_TIMEOUT_MS));
    const timeoutId = setTimeout(() => { state.timedOut = true; controller.abort('timeout'); }, timeout);
    fetch(url, { method: 'POST', credentials: 'omit', headers, body: message.body, signal: controller.signal })
      .then(async (response) => {
        const responseText = await response.text();
        if (responseText.length > MAX_RESPONSE_CHARS) throw new Error('response-too-large');
        sendResponse({ type: 'xhr-response', id, ok: true, status: response.status,
          statusText: response.statusText, responseText, responseHeaders: '' });
      })
      .catch((error) => sendResponse({ type: 'xhr-response', id, ok: false, timeout: state.timedOut,
        error: state.timedOut ? 'request-timeout' : String(error && error.message || error).slice(0, 120) }))
      .finally(() => { clearTimeout(timeoutId); controllers.delete(key); });
    return true;
  });
})();
`;

const mainBridge = String.raw`(() => {
  'use strict';
  const CHANNEL = '__OMNIBLOCK_EXTENSION_GM_V1__';
  const BRIDGE_SECRET = '__OB_BRIDGE_SECRET__';
  const SOURCE = 'omniblock-main';
  const EXPECTED_SOURCE = 'omniblock-isolated';
  const MAX_READY_ATTEMPTS = 8;
  const MAX_VALUE_CHARS = 4 * 1024 * 1024;
  const values = Object.create(null);
  const listeners = new Map();
  const xhrCallbacks = new Map();
  const readyRequests = new Set();
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const importKey = subtle && subtle.importKey.bind(subtle);
  const signHmac = subtle && subtle.sign.bind(subtle);
  const verifyHmac = subtle && subtle.verify.bind(subtle);
  const postWindow = window.postMessage.bind(window);
  const setTimer = window.setTimeout.bind(window);
  const clearTimer = window.clearTimeout.bind(window);
  let ready = false;
  let readyResolve;
  let readyReject;
  let readySettled = false;
  let readyTimer = 0;
  let requestSequence = 0;
  let readyAttempts = 0;
  let outgoingSequence = 0;
  let incomingSequence = 0;
  let postChain = Promise.resolve();
  let receiveChain = Promise.resolve();
  const bridgeStatus = { state: 'starting', attempts: 0, rejectedMessages: 0, reason: '' };
  const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const keyBytes = Uint8Array.from(BRIDGE_SECRET.match(/../g) || [], (value) => parseInt(value, 16));
  const keyPromise = importKey
    ? importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    : Promise.reject(new Error('WebCrypto unavailable'));

  function decodeMac(value) {
    try {
      const binary = atob(String(value || ''));
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch (error) { return new Uint8Array(); }
  }
  function encodeMac(value) {
    return btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join(''));
  }
  async function signedEnvelope(message) {
    const sequence = ++outgoingSequence;
    const payload = JSON.stringify(message);
    const input = SOURCE + '|' + sequence + '|' + payload;
    const key = await keyPromise;
    const mac = await signHmac('HMAC', key, encoder.encode(input));
    return { channel: CHANNEL, source: SOURCE, sequence, payload, mac: encodeMac(mac) };
  }
  async function verifyEnvelope(envelope) {
    if (!envelope || envelope.channel !== CHANNEL || envelope.source !== EXPECTED_SOURCE
      || !Number.isSafeInteger(envelope.sequence) || envelope.sequence <= incomingSequence
      || typeof envelope.payload !== 'string' || envelope.payload.length > MAX_VALUE_CHARS * 2) return null;
    const input = EXPECTED_SOURCE + '|' + envelope.sequence + '|' + envelope.payload;
    const key = await keyPromise;
    const valid = await verifyHmac('HMAC', key, decodeMac(envelope.mac), encoder.encode(input));
    if (!valid) return null;
    incomingSequence = envelope.sequence;
    try { return JSON.parse(envelope.payload); } catch (error) { return null; }
  }

  function post(message) {
    postChain = postChain.catch(() => {}).then(async () => {
      const envelope = await signedEnvelope(message);
      postWindow(envelope, location.origin);
      return true;
    }).catch(() => false);
    return postChain;
  }
  function isAllowedStorageKey(key) {
    const value = String(key || '');
    return value === 'omniblock:data:v1' || value === 'omniblock:backup:v1'
      || value === 'omniblock:events:index:v1'
      || /^omniblock:events:v1:\d{4}-\d{2}-\d{2}$/.test(value);
  }
  function normalizeAllowedUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) return '';
      if (url.hostname === 'raw.githubusercontent.com'
        && url.pathname === '/a2787/ub-utils/master/omniblock.user.js' && !url.search) return url.href;
      if (url.hostname === 'api.bilibili.com' && url.pathname === '/x/web-interface/card') {
        if (Array.from(url.searchParams.keys()).some((key) => key !== 'type' && key !== 'mid')) return '';
        if (url.searchParams.get('type') !== 'json' || !/^\d{1,20}$/.test(url.searchParams.get('mid') || '')) return '';
        return url.href;
      }
    } catch (error) {}
    return '';
  }
  function normalizeLoopbackAIUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' || url.username || url.password || url.hash
        || !['localhost', '127.0.0.1', '[::1]'].includes(String(url.hostname || '').toLowerCase())) return '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (error) { return ''; }
  }
  function normalizeAIHeaders(headers) {
    if (!headers || typeof headers !== 'object') return null;
    const out = {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (!['accept', 'content-type'].includes(lower)) return null;
      out[lower] = String(headers[key] || '');
    }
    if (!out['content-type'] || !out.accept
      || out['content-type'].toLowerCase() !== 'application/json'
      || out.accept.toLowerCase() !== 'application/json') return null;
    return out;
  }
  function isAllowedAIRequestData(data) {
    if (typeof data !== 'string' || data.length > 256 * 1024) return false;
    let body;
    try { body = JSON.parse(data); } catch (error) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['model', 'temperature', 'messages'].includes(key))
      || typeof body.model !== 'string' || body.model.length > 120
      || typeof body.temperature !== 'number' || !Array.isArray(body.messages) || body.messages.length !== 2) return false;
    if (body.messages.some((message) => !message || typeof message !== 'object'
      || !['system', 'user'].includes(message.role) || typeof message.content !== 'string'
      || message.content.length > 256 * 1024)) return false;
    let input;
    try { input = JSON.parse(body.messages[1].content); } catch (error) { return false; }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['rules', 'items'].includes(key))
      || !Array.isArray(input.rules) || input.rules.length > 32
      || !Array.isArray(input.items) || input.items.length > 80) return false;
    return input.rules.every((rule) => typeof rule === 'string' && rule.length <= 500)
      && input.items.every((item) => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every((key) => ['id', 'kind', 'text'].includes(key))
        && typeof item.id === 'string' && item.id.length <= 80
        && (item.kind === 'comment' || item.kind === 'danmaku')
        && typeof item.text === 'string' && item.text.length <= 800);
  }
  function normalizeAllowedRequest(details) {
    const method = String(details && details.method || 'GET').toUpperCase();
    const url = normalizeAllowedUrl(details && details.url);
    if (method === 'GET' && url && details && details.data == null
      && (!details.headers || Object.keys(details.headers).length === 0)) {
      return { url, method, headers: {}, data: undefined };
    }
    const aiUrl = normalizeLoopbackAIUrl(details && details.url);
    const headers = normalizeAIHeaders(details && details.headers);
    if (method === 'POST' && aiUrl && headers && isAllowedAIRequestData(details && details.data)) {
      return { url: aiUrl, method, headers, data: details.data };
    }
    return null;
  }
  function failReady(reason) {
    if (readySettled) return;
    readySettled = true;
    bridgeStatus.state = 'degraded';
    bridgeStatus.reason = String(reason || 'ready-timeout');
    if (readyTimer) { clearTimer(readyTimer); readyTimer = 0; }
    readyReject(new Error('OmniBlock extension bridge unavailable: ' + bridgeStatus.reason));
  }
  function requestReady() {
    if (ready || readySettled) return;
    if (readyAttempts >= MAX_READY_ATTEMPTS) { failReady('ready-timeout'); return; }
    readyAttempts++;
    bridgeStatus.attempts = readyAttempts;
    const requestId = 'ready_' + (++requestSequence);
    readyRequests.add(requestId);
    post({ type: 'ready-request', requestId }).catch(() => {});
    const delay = Math.min(800, 50 * (2 ** (readyAttempts - 1)));
    readyTimer = setTimer(requestReady, delay);
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

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready-response') {
      if (!readyRequests.has(String(message.requestId || '')) || readySettled) return;
      readyRequests.clear();
      Object.keys(values).forEach((key) => delete values[key]);
      for (const key of Object.keys(message.values || {})) if (isAllowedStorageKey(key)) values[key] = message.values[key];
      if (message.error) { failReady('storage-unavailable'); return; }
      ready = true;
      readySettled = true;
      bridgeStatus.state = 'ready';
      bridgeStatus.reason = '';
      if (readyTimer) { clearTimer(readyTimer); readyTimer = 0; }
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
        try {
          if (message.timeout && callback.ontimeout) callback.ontimeout();
          else if (callback.onerror) callback.onerror(new Error(message.error || 'GM_xmlhttpRequest failed'));
        } catch (error) {}
      }
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data
      || event.data.channel !== CHANNEL || event.data.source !== EXPECTED_SOURCE) return;
    receiveChain = receiveChain.catch(() => {}).then(async () => {
      const message = await verifyEnvelope(event.data);
      if (!message) { bridgeStatus.rejectedMessages++; return; }
      await handleMessage(message);
    });
  });

  window.__OB_EXTENSION_READY__ = () => readyPromise;
  const GM_getValue = (key, fallback) => isAllowedStorageKey(key)
    && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
  const GM_setValue = (key, value) => {
    const normalized = String(key || '');
    let serialized = '';
    try { serialized = JSON.stringify(value); } catch (error) { return; }
    if (!isAllowedStorageKey(normalized) || serialized.length > MAX_VALUE_CHARS) return;
    values[normalized] = value;
    post({ type: 'set', key: normalized, value });
  };
  const GM_deleteValue = (key) => {
    const normalized = String(key || '');
    if (!isAllowedStorageKey(normalized)) return;
    delete values[normalized];
    post({ type: 'remove', key: normalized });
  };
  const GM_addValueChangeListener = (key, callback) => {
    if (typeof callback !== 'function' || !isAllowedStorageKey(key)) return 0;
    const normalized = String(key || '');
    const list = listeners.get(normalized) || [];
    list.push(callback); listeners.set(normalized, list);
    return list.length;
  };
  const GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = String(css || '');
    (document.head || document.documentElement || document.body).appendChild(style);
  };
  const GM_registerMenuCommand = () => {};
  const GM_xmlhttpRequest = (details) => {
    const request = normalizeAllowedRequest(details);
    if (!request) {
      setTimer(() => { try { if (details && details.onerror) details.onerror(new Error('request-not-allowed')); } catch (error) {} }, 0);
      return { abort() {} };
    }
    const id = 'xhr_' + (++requestSequence);
    xhrCallbacks.set(id, details || {});
    post({ type: 'xhr', id, url: request.url, method: request.method,
      headers: request.headers, data: request.data, timeout: details && details.timeout });
    return { abort: () => { xhrCallbacks.delete(id); post({ type: 'xhr-abort', id }); } };
  };
  const GM_openInTab = (url) => {
    const normalizedUrl = normalizeAllowedUrl(url);
    if (normalizedUrl === 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js') {
      return window.open(normalizedUrl, '_blank', 'noopener');
    }
    return null;
  };
  const GM_info = { script: {
    name: '本地内容过滤增强', version: '__OB_VERSION__', namespace: 'https://github.com/a2787/ub-utils',
  } };
  window.__OB_EXTENSION_RUNTIME__ = {
    mode: 'persistent-dev-extension', version: '__OB_VERSION__', build: '__OB_BUILD__', bridge: bridgeStatus,
  };
  requestReady();
`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'bridge-isolated.js'), isolatedBridge
  .replaceAll('__OB_BRIDGE_SECRET__', bridgeSecret), 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'bridge-service-worker.js'), serviceWorker, 'utf8');
const runtimeMain = mainBridge
  .replaceAll('__OB_BRIDGE_SECRET__', bridgeSecret)
  .replaceAll('__OB_VERSION__', version)
  .replaceAll('__OB_BUILD__', build)
  + '\n' + source + '\n})();\n';
fs.writeFileSync(path.join(OUTPUT_DIR, 'runtime-main.js'), runtimeMain, 'utf8');

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

/* Product-only MV3 service-worker handlers.
 * The compatibility/dev bridge remains generated from test/build-dev-extension.cjs;
 * this file is appended only to the installable product build. It owns the one
 * secret that must never cross into a page: the device's direct-provider API key.
 */
(() => {
  'use strict';

  const DEVICE_CONFIG_KEY = 'omniblock:ai-device-config:v1';
  const MAX_BODY_CHARS = 256 * 1024;
  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_TIMEOUT_MS = 60000;
  const controllers = new Map();

  function requestKey(sender, id) {
    const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : 'extension';
    return String(tabId) + ':' + String(id || '');
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const host = String(url.hostname || '').toLowerCase();
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
        || url.username || url.password || url.hash) return '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (error) { return ''; }
  }

  function isAllowedBody(data) {
    if (typeof data !== 'string' || data.length > MAX_BODY_CHARS) return false;
    let body;
    try { body = JSON.parse(data); } catch (error) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['model', 'temperature', 'messages'].includes(key))
      || typeof body.model !== 'string' || body.model.length > 120
      || typeof body.temperature !== 'number' || !Array.isArray(body.messages) || body.messages.length !== 2) return false;
    return body.messages.every((message) => message && typeof message === 'object'
      && !Array.isArray(message) && ['system', 'user'].includes(message.role)
      && typeof message.content === 'string' && message.content.length <= MAX_BODY_CHARS);
  }

  function normalizeConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const providerUrl = normalizeUrl(source.providerUrl);
    const apiKey = String(source.apiKey || '').trim();
    const model = String(source.model || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!providerUrl || apiKey.length < 8 || apiKey.length > 512) return null;
    return { providerUrl, model, apiKey };
  }

  function publicConfig(value) {
    const config = normalizeConfig(value);
    return config ? { configured: true, providerUrl: config.providerUrl, model: config.model } : { configured: false, providerUrl: '', model: '' };
  }

  async function getConfig() {
    const values = await chrome.storage.local.get(DEVICE_CONFIG_KEY);
    return normalizeConfig(values && values[DEVICE_CONFIG_KEY]);
  }

  async function permissionGranted(url) {
    const host = String(new URL(url).hostname || '').toLowerCase();
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
    if (!chrome.permissions || typeof chrome.permissions.contains !== 'function') return false;
    try { return await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] }); }
    catch (error) { return false; }
  }

  function replyError(sendResponse, id, error, timeout) {
    sendResponse({ type: 'xhr-response', id, ok: false, error, timeout: !!timeout });
  }

  async function handleDirect(message, sender, sendResponse) {
    const id = String(message && message.id || '');
    const key = requestKey(sender, id);
    const url = normalizeUrl(message && message.url);
    if (!id || String(message && message.method || '').toUpperCase() !== 'POST' || !url || !isAllowedBody(message && message.body)) {
      replyError(sendResponse, id, 'request-not-allowed'); return;
    }
    const config = await getConfig();
    if (!config) { replyError(sendResponse, id, 'direct-ai-key-missing'); return; }
    if (config.providerUrl !== url) { replyError(sendResponse, id, 'direct-ai-config-mismatch'); return; }
    if (!(await permissionGranted(url))) { replyError(sendResponse, id, 'direct-ai-host-permission-required'); return; }
    const controller = new AbortController();
    const state = { controller, timedOut: false };
    controllers.set(key, state);
    const timeout = Math.max(1000, Math.min(Number(message.timeout) || MAX_TIMEOUT_MS, MAX_TIMEOUT_MS));
    const timeoutId = setTimeout(() => { state.timedOut = true; controller.abort(); }, timeout);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + config.apiKey,
        },
        body: message.body,
        signal: controller.signal,
      });
      const responseText = await response.text();
      if (responseText.length > MAX_RESPONSE_CHARS) throw new Error('response-too-large');
      sendResponse({ type: 'xhr-response', id, ok: true, status: response.status,
        statusText: response.statusText, responseText, responseHeaders: '' });
    } catch (error) {
      replyError(sendResponse, id, state.timedOut ? 'request-timeout' : String(error && error.message || error).slice(0, 120), state.timedOut);
    } finally {
      clearTimeout(timeoutId);
      controllers.delete(key);
    }
  }

  function isInternalSender(sender) {
    const extensionUrl = 'chrome-extension://' + chrome.runtime.id + '/';
    const senderUrl = String(sender && sender.url || '');
    return !!sender && (sender.id === chrome.runtime.id || senderUrl.indexOf(extensionUrl) === 0)
      && senderUrl.indexOf(extensionUrl) === 0;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'omniblock-direct-ai-abort') {
      const state = controllers.get(requestKey(sender, message.id));
      if (state) state.controller.abort();
      return false;
    }
    if (message.type === 'omniblock-direct-ai') {
      void handleDirect(message, sender, sendResponse).catch((error) => {
        replyError(sendResponse, String(message.id || ''), 'direct-ai-handler-' + String(error && error.message || error).slice(0, 80));
      });
      return true;
    }
    if (!isInternalSender(sender)) return false;
    if (message.type === 'omniblock-device-config:get') {
      chrome.storage.local.get(DEVICE_CONFIG_KEY).then((values) => sendResponse(publicConfig(values && values[DEVICE_CONFIG_KEY]))).catch(() => sendResponse({ configured: false, providerUrl: '', model: '', error: 'storage-unavailable' }));
      return true;
    }
    if (message.type === 'omniblock-device-config:set') {
      const providerUrl = normalizeUrl(message.providerUrl);
      const model = String(message.model || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      chrome.storage.local.get(DEVICE_CONFIG_KEY).then((values) => {
        const previous = normalizeConfig(values && values[DEVICE_CONFIG_KEY]);
        const suppliedKey = String(message.apiKey || '').trim();
        const apiKey = suppliedKey || (message.keepExisting && previous ? previous.apiKey : '');
        if (!providerUrl || apiKey.length < 8 || apiKey.length > 512) {
          sendResponse({ ok: false, error: 'direct-ai-config-invalid' }); return;
        }
        return chrome.storage.local.set({ [DEVICE_CONFIG_KEY]: { providerUrl, apiKey, model } })
          .then(() => sendResponse({ ok: true, config: { configured: true, providerUrl, model } }));
      }).catch(() => sendResponse({ ok: false, error: 'storage-unavailable' }));
      return true;
    }
    if (message.type === 'omniblock-device-config:clear') {
      chrome.storage.local.remove(DEVICE_CONFIG_KEY)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: 'storage-unavailable' }));
      return true;
    }
    if (message.type === 'omniblock-open-options') {
      chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false, error: 'options-unavailable' }));
      return true;
    }
    return false;
  });
})();

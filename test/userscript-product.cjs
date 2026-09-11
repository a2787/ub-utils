/* OmniBlock userscript product regression.
 * 夹具说明：页面、provider 和 sync endpoint 全部是人工合成路由；不访问真实站点、
 * 真实模型或真实账户。覆盖 userscript 直连 API、Key/同步密文边界、账户登录同步，
 * 以及 390px 窄屏触控设置面板。真实平板安装仍需单独记录 blocked 或 real-site verified。
 * 运行：node test/userscript-product.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { launchChromium, ROOT } = require('./runtime.cjs');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const PROVIDER_URL = 'https://provider.test/v1/chat/completions';
const SYNC_URL = 'https://sync.test';
const KEY = 'synthetic-direct-key';
const TOKEN = 'synthetic-sync-token';
const PASSPHRASE = 'synthetic-sync-passphrase';
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OmniBlock userscript artificial product fixture</title></head><body>
<bili-comments id="comments"></bili-comments>
<script>
  const host = document.getElementById('comments');
  const root = host.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid: '123', member: { mid: '123', uname: '人工合成用户' } };
  const shadow = renderer.attachShadow({ mode: 'open' });
  const link = document.createElement('a'); link.className = 'user-name'; link.href = 'https://space.bilibili.com/123'; link.textContent = '人工合成用户';
  const body = document.createElement('span'); body.className = 'text'; body.textContent = '人工合成直连测试内容';
  shadow.append(link, body); root.appendChild(renderer);
</script></body></html>`;

const SHIM = `
window.__gm = {
  'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: '${KEY}' }),
  'omniblock:data:v1': JSON.stringify({ version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: false, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'synthetic-model',
    aiRules: [{ id: 'synthetic-rule', text: '直连测试规则', enabled: true }]
  } })
};
window.__requests = [];
window.GM_getValue = (key, fallback) => (key in window.__gm ? window.__gm[key] : fallback);
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const style = document.createElement('style'); style.textContent = css; const root = document.head || document.documentElement; if (root) root.appendChild(style); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '0.57.0', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (options) => {
  const item = { url: String(options && options.url || ''), method: options && options.method || 'GET', headers: options && options.headers || {}, data: options && options.data || '' };
  window.__requests.push(item);
  fetch(item.url, { method: item.method, headers: item.headers, body: item.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (options.onload) options.onload(response); })
    .catch((error) => { if (options.onerror) options.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, authorization',
    'cache-control': 'no-store',
  };
}

(async () => {
  const report = { pass: [], fail: [], pageErrors: [], console: [] };
  let browser;
  try {
    browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push(message.type() + ': ' + message.text()); });
    let providerRequests = 0;
    let loginRequests = 0;
    let syncPut = null;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      if (url === PROVIDER_URL || url === SYNC_URL + '/v1/auth/login' || url === SYNC_URL + '/v1/sync/state') {
        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders(), body: '' });
          return;
        }
      }
      if (url === PROVIDER_URL) {
        providerRequests++;
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
        });
        return;
      }
      if (url === SYNC_URL + '/v1/auth/login' && request.method() === 'POST') {
        loginRequests++;
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ accessToken: TOKEN, accountId: 'acct-synthetic', username: 'synthetic-user', expiresAt: '2099-01-01T00:00:00Z' }),
        });
        return;
      }
      if (url === SYNC_URL + '/v1/sync/state' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ revision: 0, blob: null, updatedAt: '' }) });
        return;
      }
      if (url === SYNC_URL + '/v1/sync/state' && request.method() === 'PUT') {
        try { syncPut = JSON.parse(request.postData() || '{}'); } catch (error) { syncPut = null; }
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ revision: 1, updatedAt: '2099-01-01T00:00:00Z' }),
        });
        return;
      }
      if (url.startsWith('https://www.bilibili.com/')) {
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: FIXTURE });
        return;
      }
      await route.fulfill({ status: 200, body: '' });
    });
    await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-userscript-product-shim.cjs' });
    await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-userscript-product.cjs' });
    await page.goto('https://www.bilibili.com/video/userscript-product-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.OB && window.OB.ai && window.OB.sync && document.querySelector('#ob-gear')), null, { timeout: 8000 });

    const direct = await page.evaluate(async (expectedKey) => {
      window.OB.Store.setSetting('aiEnabled', true);
      const before = window.__requests.length;
      const result = await window.OB.ai.analyzePage('直连测试规则');
      const request = (window.__requests || []).slice(before).find((item) => item.url.includes('/v1/chat/completions')) || null;
      const status = window.OB.ai.status();
      const requestText = String(request && request.data || '');
      return {
        result,
        status,
        request,
        requestText,
        windowExposure: Object.keys(window).some((key) => {
          if (key === '__gm' || key === '__requests') return false;
          try { return JSON.stringify(window[key]).includes(expectedKey); } catch (error) { return false; }
        }),
        storeExport: window.OB.Store.exportJSON(),
        promptExport: window.OB.promptSystem.exportJSON(),
        syncState: JSON.stringify(window.OB.sync.collectState()),
      };
      }, KEY);
    assert.ok(direct.result && direct.result.ok, JSON.stringify(direct.result));
    assert.strictEqual(direct.status.mode, 'direct');
    assert.strictEqual(direct.status.gatewayConfigured, false);
    assert.strictEqual(direct.status.providerConfigured, true);
    assert.strictEqual(direct.status.keyConfigured, true);
    assert.ok(direct.request && direct.request.headers && direct.request.headers.Authorization === 'Bearer ' + KEY, JSON.stringify(direct.request));
    assert.ok(!direct.requestText.includes(KEY), 'request body contains API Key');
    assert.strictEqual(direct.windowExposure, false, 'page global contains API Key');
    assert.ok(!direct.storeExport.includes(KEY), 'Store export contains API Key');
    assert.ok(!direct.promptExport.includes(KEY), 'prompt export contains API Key');
    assert.ok(!direct.syncState.includes(KEY), 'sync state contains API Key');
    assert.ok(providerRequests >= 1, 'provider route was not called');
    report.pass.push('userscript direct API uses the device Key only in Authorization and excludes it from body/exports/sync state');

    const settings = await page.evaluate(() => {
      window.OB.openOptions();
      const panel = document.querySelector('#ob-panel');
      const box = panel && panel.querySelector('.ob-box');
      const visibleButtons = panel ? Array.from(panel.querySelectorAll('button')).filter((button) => button.getClientRects().length) : [];
      return {
        panel: !!panel,
        syncForm: !!(panel && panel.querySelector('#ob-sync-form')) || !!(panel && panel.querySelector('#ob-sync-endpoint')),
        fields: panel ? ['#ob-sync-endpoint', '#ob-sync-username', '#ob-sync-password', '#ob-sync-passphrase'].every((selector) => !!panel.querySelector(selector)) : false,
        buttons: panel ? ['#ob-sync-register', '#ob-sync-login', '#ob-sync-now', '#ob-sync-logout'].every((selector) => !!panel.querySelector(selector)) : false,
        noGatewayText: !String(panel && panel.textContent || '').includes('网关'),
        noHorizontalOverflow: !!(box && box.scrollWidth <= box.clientWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1),
        touchTargets: visibleButtons.every((button) => button.getBoundingClientRect().height >= 40),
        buttonSizes: visibleButtons.map((button) => ({ id: button.id, className: button.className, height: Math.round(button.getBoundingClientRect().height) })),
        safeAreaRule: Array.from(document.querySelectorAll('style')).some((style) => style.textContent.includes('safe-area-inset')),
      };
    });
    assert.ok(settings.panel && settings.syncForm && settings.fields && settings.buttons, JSON.stringify(settings));
    assert.ok(settings.noGatewayText && settings.noHorizontalOverflow && settings.touchTargets && settings.safeAreaRule, JSON.stringify(settings));
    await page.setViewportSize({ width: 768, height: 1024 });
    const tabletLayout = await page.evaluate(() => {
      const panel = document.querySelector('#ob-panel');
      const box = panel && panel.querySelector('.ob-box');
      return {
        panel: !!panel,
        noHorizontalOverflow: !!(panel && box && panel.scrollWidth <= panel.clientWidth + 1 && box.scrollWidth <= box.clientWidth + 1),
      };
    });
    assert.ok(tabletLayout.panel && tabletLayout.noHorizontalOverflow, JSON.stringify(tabletLayout));
    await page.setViewportSize({ width: 390, height: 844 });
    report.pass.push('390px touch fixture has the account sync form, no gateway UI, safe-area CSS, no horizontal overflow and usable buttons');

    await page.evaluate(() => window.OB.openOptions());
    await page.evaluate((provider) => window.OB.openContentManager(window.OB.adapters.bilibili, 'ai'), PROVIDER_URL);
    await page.waitForSelector('#ob-content-manager .ob-ai-provider', { timeout: 5000 });
    const aiUi = await page.evaluate(() => ({
      manager: !!document.querySelector('#ob-content-manager'),
      provider: !!document.querySelector('#ob-content-manager .ob-ai-provider'),
      mode: !!document.querySelector('#ob-content-manager #ob-ai-mode'),
      gateway: !!document.querySelector('#ob-content-manager .ob-ai-gateway'),
      keyStatus: document.querySelector('#ob-content-manager #ob-ai-key-status') && document.querySelector('#ob-content-manager #ob-ai-key-status').textContent,
      text: document.querySelector('#ob-content-manager').textContent,
      managerNoHorizontalOverflow: (() => {
        const manager = document.querySelector('#ob-content-manager');
        const box = manager && manager.querySelector('.ob-content-box');
        return !!(manager && box && manager.scrollWidth <= manager.clientWidth + 1 && box.scrollWidth <= box.clientWidth + 1);
      })(),
      managerTouchTargets: (() => {
        const manager = document.querySelector('#ob-content-manager');
        const buttons = manager ? Array.from(manager.querySelectorAll('button')).filter((button) => button.getClientRects().length) : [];
        return buttons.length > 0 && buttons.every((button) => button.getBoundingClientRect().height >= 40);
      })(),
    }));
    assert.ok(aiUi.manager && aiUi.provider && !aiUi.mode && !aiUi.gateway && /本机 Key/.test(aiUi.keyStatus || '')
      && !aiUi.text.includes('网关') && aiUi.managerNoHorizontalOverflow && aiUi.managerTouchTargets, JSON.stringify(aiUi));
    report.pass.push('AI settings expose only provider URL/model and local Key controls');

    const sync = await page.evaluate(async (args) => {
      const login = await window.OB.sync.login({ endpoint: args.endpoint, username: 'synthetic-user', password: 'synthetic-account-password' });
      const result = await window.OB.sync.synchronize(args.passphrase);
      const local = window.__gm['omniblock:sync-local:v1'] || '';
      const auth = window.__gm['omniblock:sync-auth:v1'] || '';
      return {
        login,
        result,
        status: window.OB.sync.status(),
        local,
        auth,
      };
    }, { endpoint: SYNC_URL, passphrase: PASSPHRASE });
    assert.strictEqual(loginRequests, 1);
    assert.ok(sync.login && sync.login.accountId);
    assert.ok(sync.result && sync.result.ok && sync.result.revision === 1, JSON.stringify(sync));
    assert.ok(sync.status.loggedIn && sync.status.localRevision > 0, JSON.stringify(sync.status));
    assert.ok(syncPut && syncPut.blob && syncPut.blob.format === 'omniblock.sync-envelope', JSON.stringify(syncPut));
    const opaque = JSON.stringify(syncPut.blob);
    assert.ok(!opaque.includes(KEY) && !opaque.includes(PASSPHRASE) && !opaque.includes('synthetic-account-password') && !opaque.includes(TOKEN), 'sync blob contains a secret');
    assert.ok(!sync.local.includes(KEY) && !sync.local.includes(PASSPHRASE) && !sync.local.includes(TOKEN), 'local sync cursor contains a secret');
    assert.ok(sync.auth.includes(TOKEN), 'auth token was not kept in its separate local auth record');
    report.pass.push('userscript account sync encrypts the document client-side and keeps passphrase/token/Key outside the sync blob');

    await browser.close();
  } catch (error) {
    report.fail.push(String(error && error.stack || error));
    if (browser) { try { await browser.close(); } catch (closeError) {} }
  }
  console.log('==== OmniBlock userscript product regression ====');
  console.log('FIXTURE: artificial Bilibili document, synthetic provider and sync endpoint');
  console.log('PASS:', report.pass.length); report.pass.forEach((item) => console.log('  ✅', item));
  console.log('FAIL:', report.fail.length); report.fail.forEach((item) => console.log('  ❌', item));
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  const ok = report.fail.length === 0 && report.pageErrors.length === 0 && report.console.length === 0;
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  process.exitCode = ok ? 0 : 1;
})().catch((error) => { console.error('HARNESS ERROR:', error && error.stack || error); process.exitCode = 2; });

/* Product MV3 extension regression: the same built source must run without
 * Tampermonkey, keep direct-provider credentials in the service worker, and
 * complete one OpenAI-compatible direct request through an extension-owned
 * loopback mock. Page DOM is artificial and contains no real identifiers.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { launchPersistentChromium, ROOT, EDGE_PATH, CHROME_PATH } = require('./runtime.cjs');

const buildScript = path.join(ROOT, 'extension', 'build.cjs');
execFileSync(process.execPath, [buildScript], { cwd: ROOT, encoding: 'utf8' });
const extensionDir = path.join(ROOT, 'dist', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const fixtureUrl = 'https://www.bilibili.com/omniblock-product-extension-fixture';
const fixture = '<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock product fixture</title></head><body><main><h1>人工合成页面</h1><p>人工合成正文</p></main></body></html>';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], pageErrors: [] };
  let aiServer = null;
  let context = null;
  let profileDir = '';
  let aiUrl = '';
  let received = [];
  try {
    aiServer = http.createServer((request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, authorization' });
        response.end();
        return;
      }
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (error) {}
        received.push({ authorization: request.headers.authorization || '', body });
        let input = {};
        try { input = JSON.parse(body.messages[1].content); } catch (error) {}
        const item = input.items && input.items[0];
        const payload = { items: item ? [{ id: item.id, decision: 'block', claimType: 'policy_violation', verificationStatus: 'not_applicable', verificationMethod: 'none', ruleMatched: true, matchedRuleIds: input.ruleCatalog && input.ruleCatalog[0] ? [input.ruleCatalog[0].id] : [], contextSufficiency: 'sufficient', evidenceRefs: [], category: 'synthetic', confidence: 0.9, reasonCodes: ['synthetic'], reason: '人工合成回归', evidence: '' }] : [] };
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
      });
    });
    await new Promise((resolve, reject) => { aiServer.once('error', reject); aiServer.listen(0, '127.0.0.1', resolve); });
    const address = aiServer.address();
    aiUrl = 'http://127.0.0.1:' + address.port + '/v1/chat/completions';

    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniblock-product-extension-'));
    const browserPath = process.env.OMNIBLOCK_EXTENSION_BROWSER_PATH || EDGE_PATH || CHROME_PATH || '';
    context = await launchPersistentChromium(profileDir, {
      headless: false,
      ...(browserPath ? { executablePath: browserPath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-position=-32000,-32000', '--load-extension=' + extensionDir],
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url === aiUrl) return route.continue();
      if (url.startsWith(fixtureUrl)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
      return /^https?:/i.test(url) ? route.abort() : route.continue();
    });
    await sleep(300);
    const workers = context.serviceWorkers();
    if (!workers.length) throw new Error('product service worker not started');
    for (const worker of workers) worker.on('pageerror', (error) => report.fail.push('service-worker-error: ' + String(error)));
    const extensionId = new URL(workers[0].url()).hostname;
    const options = await context.newPage();
    options.on('pageerror', (error) => report.pageErrors.push('options: ' + String(error)));
    await options.goto('chrome-extension://' + extensionId + '/options.html', { waitUntil: 'domcontentloaded' });
    await options.locator('#provider-url').fill(aiUrl);
    await options.locator('#provider-model').fill('synthetic-direct');
    await options.locator('#provider-key').fill('synthetic-direct-key');
    await options.locator('#save-provider').click();
    await options.waitForFunction(() => /已保存并启用当前设备直连配置/.test(document.querySelector('#provider-status') && document.querySelector('#provider-status').textContent || ''), null, { timeout: 5000 });
    const configured = await options.evaluate(async () => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'omniblock-device-config:get' }, (value) => resolve({ value, error: chrome.runtime.lastError && chrome.runtime.lastError.message }));
    }));
    const configuredValue = configured && configured.value;
    if (configuredValue && configuredValue.configured && configuredValue.providerUrl === aiUrl && configuredValue.model === 'synthetic-direct') report.pass.push('正式扩展设置页可把直连 Key 写入 service worker，并只返回脱敏配置');
    else report.fail.push('正式扩展设备 Key 配置失败：' + JSON.stringify(configured));
    const directProbe = await options.evaluate(async (url) => new Promise((resolve) => {
      const body = JSON.stringify({ model: 'synthetic-direct', temperature: 0, messages: [
        { role: 'system', content: 'probe' }, { role: 'user', content: JSON.stringify({ promptSchemaVersion: 1, rules: [], profile: { schemaVersion: 1, language: 'zh-CN', objective: '', blockCriteria: [], allowCriteria: [], priority: [], reviewRequired: true, acceptedPreferences: [] }, examples: [], items: [] }) },
      ] });
      chrome.runtime.sendMessage({ type: 'omniblock-direct-ai', id: 'direct-probe', method: 'POST', url, headers: { 'content-type': 'application/json', accept: 'application/json' }, body }, (value) => resolve({ value, error: chrome.runtime.lastError && chrome.runtime.lastError.message }));
    }), aiUrl);
    if (!directProbe || !directProbe.error) report.pass.push('扩展内部直连消息可收到 service worker 回调：' + JSON.stringify(directProbe && directProbe.value || {}));
    else report.fail.push('扩展内部直连消息未收到回调：' + JSON.stringify(directProbe));
    await options.close();

    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push('fixture: ' + String(error)));
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OB && window.__OB_EXTENSION_RUNTIME__
      && window.__OB_EXTENSION_RUNTIME__.mode === 'persistent-extension'
      && window.__OB_EXTENSION_RUNTIME__.bridge
      && window.__OB_EXTENSION_RUNTIME__.bridge.state === 'ready', null, { timeout: 10000 });
    const state = await page.evaluate((endpoint) => {
      const host = document.createElement('bili-comments');
      const shadow = host.attachShadow({ mode: 'open' });
      const renderer = document.createElement('bili-comment-renderer');
      renderer.__data = { mid: '123', member: { mid: '123', uname: '人工合成用户' } };
      const root = renderer.attachShadow({ mode: 'open' });
      const link = document.createElement('a'); link.className = 'user-name'; link.href = 'https://space.bilibili.com/123'; link.textContent = '人工合成用户';
      const text = document.createElement('span'); text.className = 'text'; text.textContent = '人工合成评论';
      root.append(link, text); shadow.appendChild(renderer); document.body.appendChild(host);
      window.OB.Store.setSetting('aiRules', [{ text: '人工合成规则', enabled: true }]);
      window.OB.Store.setSetting('aiEnabled', true);
      const settings = window.OB.Store.settings();
      return window.OB.ai.analyzePage('人工合成页面规则').then((result) => ({
        result, settings, runtime: window.OB.runtime, extension: window.__OB_EXTENSION_RUNTIME__,
        pageGlobals: ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest'].filter((key) => typeof window[key] !== 'undefined'),
        directStatus: window.OB.ai.status(),
      }));
    }, aiUrl);
    const request = received[0] || {};
    const requestText = JSON.stringify(request.body || {});
    if (state.result && state.result.ok && state.extension.mode === 'persistent-extension'
      && state.settings.aiMode === 'direct' && state.settings.aiProviderUrl === aiUrl && state.settings.aiProviderModel === 'synthetic-direct'
      && state.directStatus.mode === 'direct' && state.pageGlobals.length === 0
      && request.authorization === 'Bearer synthetic-direct-key'
      && !requestText.includes('synthetic-direct-key')) {
      report.pass.push('正式扩展 service worker 完成设备直连 AI，页面无 GM/Key，发送请求只含安全 AI 内容');
    } else report.fail.push('设备直连 AI 回归失败：' + JSON.stringify({ state, request: { authorization: request.authorization, hasKeyInBody: requestText.includes('synthetic-direct-key') } }));
    await page.close();
  } catch (error) { report.fail.push(String(error && error.stack || error)); }
  finally {
    if (context) { try { await context.close(); } catch (error) {} }
    if (aiServer) { try { await new Promise((resolve) => aiServer.close(resolve)); } catch (error) {} }
    if (profileDir) { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (error) {} }
  }
  console.log('==== OmniBlock 正式 MV3 扩展回归 ====');
  console.log('VERSION:', manifest.version);
  console.log('FIXTURE: artificial Bilibili document, no real page identifiers');
  console.log('PASS:', report.pass.length); report.pass.forEach((item) => console.log('  ✅', item));
  console.log('FAIL:', report.fail.length); report.fail.forEach((item) => console.log('  ❌', item));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach((item) => console.log('  ·', item));
  const ok = report.fail.length === 0 && report.pageErrors.length === 0;
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

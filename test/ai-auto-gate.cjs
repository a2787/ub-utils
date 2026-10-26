/* OmniBlock AI 自动分析独立开关（OB-AI-015）回归测试。
 * 夹具是人工合成 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：默认只手动（页面加载 0 次自动请求）、手动分析不再强制页规则、
 * 自动候选不自动弹窗而是等在「AI 待审建议」浮条、本机用量计数与请求一致。
 * 运行：node test/ai-auto-gate.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4021/v1/chat/completions';
const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
    aiRules: [{ id: 'ai-auto-gate-rule', text: '引战', enabled: true }]
  }
}) };
window.__aiBodies = [];
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (opts) => {
  try { window.__aiBodies.push(JSON.parse(opts.data || '{}')); } catch (error) {}
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>AI 自动开关人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_auto_gate_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
</div>
<div id="relatedVideoCard"><div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/GateFixture">自动开关夹具作者</a><span>初始引战评论</span></div></div>
</body></html>`;

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url() === PROVIDER_URL) {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          items: (Array.isArray(input.items) ? input.items : []).filter((item) => String(item && item.text || '').includes('引战'))
            .map((item) => ({ id: item.id, decision: 'block', confidence: 0.9, reason: '命中自动开关回归规则' })),
        }) } }] }),
      });
      return;
    }
    const url = new URL(request.url());
    if (url.hostname.endsWith('douyin.com')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-auto-gate.cjs' });
  await page.goto('https://www.douyin.com/video/ai-auto-gate-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });

  // AUTO-GATE-1：aiEnabled 默认开、aiAutoAnalyze 未开启时，页面加载后不产生任何自动 AI 请求。
  // 旧行为（自动分析挂在 aiEnabled 上）会在 ~1.4s 后发出请求，本断言在旧源码上失败。
  await new Promise((resolve) => setTimeout(resolve, 3600));
  const gate = await page.evaluate(() => ({
    bodies: (window.__aiBodies || []).length,
    status: window.OB.ai.status(),
    pending: window.OB.ai.pendingCount(),
    review: !!document.querySelector('#ob-ai-review'),
    pill: !!document.querySelector('#ob-ai-pending'),
  }));
  if (gate.bodies === 0 && gate.status.autoAnalyze === false && gate.pending === 0 && !gate.review && !gate.pill) {
    report.pass.push('AUTO-GATE-1 默认设置下页面加载与等待期间 0 次自动 AI 请求，无待审浮条');
  } else report.fail.push('AUTO-GATE-1 默认设置仍然自动请求：' + JSON.stringify({ bodies: gate.bodies, autoAnalyze: gate.status.autoAnalyze, pending: gate.pending }));

  // AUTO-GATE-2：手动分析不再强制填写页面附加规则；留空时使用提示词边界并直接弹审核。
  const manual = await page.evaluate(async () => {
    const result = await window.OB.ai.analyzePage('');
    return {
      result,
      bodies: (window.__aiBodies || []).length,
      review: !!document.querySelector('#ob-ai-review'),
      status: window.OB.ai.status(),
    };
  });
  if (manual.result && manual.result.ok && manual.bodies >= 1 && manual.review) {
    report.pass.push('AUTO-GATE-2 未填写页面附加规则时手动“分析本页”成功并进入审核');
  } else report.fail.push('AUTO-GATE-2 手动分析（无页规则）异常：' + JSON.stringify(manual.result));

  // AUTO-GATE-3：开启自动分析后，自动候选不再自动弹窗，而是出现在待审浮条；点击后才打开审核。
  await page.evaluate(() => window.OB.ai.closeReview());
  const beforeAuto = await page.evaluate(() => (window.__aiBodies || []).length);
  await page.evaluate(() => window.OB.Store.setSetting('aiAutoAnalyze', true));
  await page.waitForFunction((before) => (window.__aiBodies || []).length > before, beforeAuto, { timeout: 8000 });
  const autoRun = await page.evaluate(() => ({
    bodies: (window.__aiBodies || []).length,
    pending: window.OB.ai.pendingCount(),
    review: !!document.querySelector('#ob-ai-review'),
    pill: !!document.querySelector('#ob-ai-pending'),
    status: window.OB.ai.status(),
  }));
  if (autoRun.pending >= 1 && autoRun.pill && !autoRun.review && autoRun.status.autoAnalyze === true) {
    report.pass.push('AUTO-GATE-3 自动候选不再自动弹窗，等在「AI 待审建议」浮条');
  } else report.fail.push('AUTO-GATE-3 自动候选展示方式异常：' + JSON.stringify(autoRun));
  const opened = await page.evaluate(() => {
    document.querySelector('#ob-ai-pending').click();
    return {
      review: !!document.querySelector('#ob-ai-review'),
      candidates: document.querySelectorAll('#ob-ai-review .ob-ai-candidate').length,
      status: window.OB.ai.status(),
    };
  });
  if (opened.review && opened.candidates >= 1) {
    report.pass.push('AUTO-GATE-3b 点击待审浮条后打开审核弹窗，候选数量一致');
  } else report.fail.push('AUTO-GATE-3b 待审浮条打开审核异常：' + JSON.stringify(opened));

  // AUTO-GATE-4：本机用量计数与真实请求数一致，且记录/字符数被累计。
  const usage = await page.evaluate(() => ({
    usage: window.OB.ai.usage(),
    bodies: (window.__aiBodies || []).length,
    usageKeyInStore: Object.keys(window.__gm).filter((key) => key.startsWith('omniblock:ai-usage')).length,
  }));
  if (usage.usage.sessionRequests === usage.bodies && usage.bodies >= 2
    && usage.usage.sessionRecords >= 2 && usage.usage.sessionChars > 0
    && usage.usage.dayRequests >= usage.usage.sessionRequests && usage.usageKeyInStore === 1) {
    report.pass.push('AUTO-GATE-4 本机用量计数与实际请求数一致并已持久化（当日键 1 个）');
  } else report.fail.push('AUTO-GATE-4 用量计数不一致：' + JSON.stringify(usage));

  await browser.close();
  console.log('==== OmniBlock AI 自动开关回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

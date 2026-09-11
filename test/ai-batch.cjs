/* OmniBlock AI 全量分批回归测试。
 * 夹具说明：85 条抖音评论为人工合成节点，只用于验证“每批最多 80 条但不丢弃后续记录”；
 * 测试不访问真实站点或真实模型，使用 Playwright route 模拟人工合成 Chat Completions provider。
 * 运行：node test/ai-batch.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';
const COMMENTS = Array.from({ length: 85 }, (_, index) => (
  '<div data-e2e="comment-item" id="ai-batch-comment-' + index + '">' +
    '<a data-e2e="comment-username" href="/user/artificial-secuid-' + index + '">人工合成作者' + index + '</a>' +
    '<span>人工合成批量内容' + index + '</span>' +
  '</div>'
)).join('');
const FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><title>抖音 AI 分批人工合成回归页</title></head><body>' +
  '<div id="dy-player" class="basePlayerContainer video_ai_batch" data-e2e="video-player"></div>' + COMMENTS +
  '</body></html>';

const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default', aiRules: []
  }
}) };
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.__aiBodies = [];
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url() === PROVIDER_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-batch.cjs' });
  await page.goto('https://www.douyin.com/video/ai-batch-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  await page.evaluate(() => window.OB.ai.analyzePage('批量回归规则'));
  await sleep(300);
  const result = await page.evaluate(() => {
    const extractItems = (body) => {
      try {
        const content = body && body.messages && body.messages[1] && body.messages[1].content;
        return JSON.parse(content || '{}').items || [];
      } catch (error) { return []; }
    };
    return {
      status: window.OB.ai.status(),
      bodies: window.__aiBodies || [],
      itemCounts: (window.__aiBodies || []).map(extractItems).map((items) => items.length),
      itemIds: (window.__aiBodies || []).flatMap(extractItems).map((item) => item.id),
    };
  });
  const ids = result.itemIds;
  const uniqueIds = new Set(ids);
  if (result.status.state === 'ready'
    && result.status.records === 85
    && result.status.analyzed === 85
    && result.status.batchCount === 2
    && result.status.batchIndex === 2
    && result.bodies.length === 2
    && JSON.stringify(result.itemCounts) === JSON.stringify([80, 5])
    && ids.length === 85
    && uniqueIds.size === 85) {
    report.pass.push('AI-BATCH-1 85 条已观察内容按 80+5 分批且全部送入 provider');
  } else {
    report.fail.push('AI-BATCH-1 分批总量异常：' + JSON.stringify({
      status: result.status, requests: result.bodies.length, itemCounts: result.itemCounts,
      itemIds: ids.length, uniqueIds: uniqueIds.size,
    }));
  }
  await page.evaluate(() => window.OB.openContentManager(window.OB.adapters.douyin, 'ai'));
  const statusText = await page.locator('#ob-ai-status').textContent().catch(() => '');
  if (!/仅分析前 80 条|只分析前 80 条|仅展示前 80 条/.test(statusText || '')
    && /全部 85 条/.test(statusText || '')) {
    report.pass.push('AI-BATCH-2 AI 标签页状态不再把每批上限误报为全页截断');
  } else {
    report.fail.push('AI-BATCH-2 AI 标签页分批文案异常：' + String(statusText || '').slice(0, 400));
  }
  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('AI BATCH TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

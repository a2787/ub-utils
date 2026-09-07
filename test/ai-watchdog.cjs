/* OmniBlock AI loopback watchdog 回归。
 * 夹具说明：抖音评论 DOM 为人工合成，GM_xmlhttpRequest 故意模拟真实问题中的
 * “函数存在但完全不回调”桥接；旧实现会永久停留 loading，本测试把请求上限替换为 120ms。
 * 运行：node test/ai-watchdog.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const userscript = source.replace(
  /const AI_REQUEST_TIMEOUT_MS = \d+;/,
  "const AI_REQUEST_TIMEOUT_MS = 120;",
);
if (userscript === source) {
  console.error('FAIL: 未找到可替换的 AI_REQUEST_TIMEOUT_MS 测试常量');
  process.exit(1);
}

const gatewayUrl = 'http://127.0.0.1:4000/v1/chat/completions';
const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiGatewayUrl: '${gatewayUrl}', aiGatewayModel: 'omni-default',
    aiRules: [{ id: 'ai-watchdog-rule', text: '不许引战', enabled: true }]
  }
}) };
window.GM_getValue = (key, fallback) => (key in window.__gm ? window.__gm[key] : fallback);
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const style = document.createElement('style'); style.textContent = css; const root = document.head || document.documentElement; if (root) root.appendChild(style); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '0.48.0', namespace: 'https://github.com/a2787/ub-utils' } };
// 故意不返回 request，也不触发 onload/onerror/ontimeout，复现 stale bridge。
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
`;
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="basePlayerContainer video_watchdog" data-e2e="video-player">
  <div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/MS4wLjABAAWatchdog">人工合成作者</a><span>引战评论</span></div>
</div></body></html>`;

(async () => {
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()); });
  await page.route('**/*', async (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixture,
  }));
  await page.addInitScript({ content: shim + '\n' + userscript + '\n//# sourceURL=omniblock-ai-watchdog.cjs' });
  await page.goto('https://www.douyin.com/video/ai-watchdog-fixture', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 5000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      ready: document.readyState,
      keys: Object.keys(window).filter((key) => /^OB/.test(key)),
      hasOB: !!window.OB,
      body: document.body && document.body.innerText,
    }));
    await browser.close();
    console.error('FAIL: AI runtime 未初始化：' + JSON.stringify({ state, pageErrors, error: error.message }));
    process.exit(1);
  }
  const started = Date.now();
  try {
    await page.waitForFunction(() => {
      const status = window.OB && window.OB.ai && window.OB.ai.status();
      return status && status.state === 'error';
    }, null, { timeout: 5000 });
  } catch (error) {
    const status = await page.evaluate(() => window.OB && window.OB.ai && window.OB.ai.status());
    await browser.close();
    console.error('FAIL: stale bridge 未在限定时间内结束：' + JSON.stringify(status) + '；' + error.message);
    process.exit(1);
  }
  const result = await page.evaluate(() => window.OB.ai.status());
  await browser.close();
  if (!/超时/.test(String(result.lastError || '')) || result.state !== 'error') {
    console.error('FAIL: stale bridge 未进入超时错误：' + JSON.stringify(result));
    process.exit(1);
  }
  console.log('PASS: AI watchdog 1/1 (' + (Date.now() - started) + 'ms)');
})().catch(async (error) => {
  console.error('FAIL: AI watchdog 未在限定时间内结束：' + (error && error.stack || error));
  process.exit(1);
});

/* OmniBlock AI 持久化开发扩展桥接降级回归。
 * 夹具说明：抖音评论节点为人工合成，GM_xmlhttpRequest 故意保持空回调，
 * 同时注入持久化开发扩展的 degraded/ready-timeout 运行时状态。
 * 旧实现会等完整 watchdog 才报“请求超时”；当前实现应立即指出浏览器桥接不可用。
 * 运行：node test/ai-bridge.cjs
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
    aiEnabled: true, aiGatewayUrl: '${gatewayUrl}', aiGatewayModel: 'omni-default', aiRules: []
  }
}) };
window.GM_getValue = (key, fallback) => (key in window.__gm ? window.__gm[key] : fallback);
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const style = document.createElement('style'); style.textContent = css; const root = document.head || document.documentElement; if (root) root.appendChild(style); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '0.48.0', namespace: 'https://github.com/a2787/ub-utils' } };
window.__OB_EXTENSION_RUNTIME__ = {
  mode: 'persistent-dev-extension',
  version: '0.48.0',
  build: '人工合成桥接降级夹具',
  bridge: { state: 'degraded', attempts: 8, rejectedMessages: 8, reason: 'ready-timeout' }
};
// 故意不触发任何回调，复现持久化开发扩展桥接降级后的 no-op 请求。
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
`;
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="basePlayerContainer video_ai_bridge" data-e2e="video-player">
  <div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/artificial-bridge-secuid">人工合成作者</a><span>桥接降级回归内容</span></div>
</div></body></html>`;

(async () => {
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') pageErrors.push('console: ' + message.text()); });
  await page.route('**/*', async (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixture,
  }));
  await page.addInitScript({ content: shim + '\n' + userscript + '\n//# sourceURL=omniblock-ai-bridge.cjs' });
  await page.goto('https://www.douyin.com/video/ai-bridge-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 5000 });

  const result = await page.evaluate(async () => {
    const started = performance.now();
    const response = await window.OB.ai.analyzePage('桥接降级回归规则');
    return {
      elapsedMs: Math.round(performance.now() - started),
      response,
      status: window.OB.ai.status(),
    };
  });
  await page.evaluate(() => window.OB.openContentManager(window.OB.adapters.douyin, 'ai'));
  await page.waitForSelector('#ob-content-manager #ob-ai-status', { timeout: 3000 });
  const statusText = await page.locator('#ob-ai-status').textContent();
  await browser.close();

  const lastError = String(result.status && result.status.lastError || '');
  const bridgeFastFailed = result.status && result.status.state === 'error'
    && /浏览器开发扩展桥接不可用/.test(lastError)
    && !/AI 网关请求超时/.test(lastError)
    && result.elapsedMs < 1000;
  if (!bridgeFastFailed) {
    console.error('FAIL: 持久化开发扩展桥接未快速失败：' + JSON.stringify({ result, pageErrors }));
    process.exit(1);
  }
  if (!/loopback 地址校验已通过/.test(statusText || '') || /当前仅允许 loopback 网关/.test(statusText || '')) {
    console.error('FAIL: 有效 loopback 的失败文案仍混入地址误导：' + JSON.stringify({ statusText, result }));
    process.exit(1);
  }
  if (pageErrors.length) {
    console.error('FAIL: 桥接降级回归出现页面/控制台错误：' + JSON.stringify(pageErrors));
    process.exit(1);
  }
  console.log('PASS: AI bridge degraded fast-fail 1/1 (' + result.elapsedMs + 'ms)');
})().catch((error) => {
  console.error('FAIL: AI bridge degraded 回归异常：' + (error && error.stack || error));
  process.exit(1);
});

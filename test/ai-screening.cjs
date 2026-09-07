/* OmniBlock AI 智能屏蔽第一阶段回归测试。
 * 夹具说明：评论 Shadow DOM 结构是人工合成，但节点形态沿用已有 B站评论适配器契约；
 * 本测试不连接真实模型，使用 Playwright route 模拟本地 OpenAI Chat Completions 网关。
 * 覆盖：默认配置入口、loopback 网关请求、请求不含身份键、AI 建议多选确认、
 * 无可靠身份候选不可执行、页面附加规则和名单持久化。
 * 运行：node test/ai-screening.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const DEV_EXTENSION_BUILDER = fs.readFileSync(path.join(ROOT, 'test', 'build-dev-extension.cjs'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const GATEWAY_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiGatewayUrl: '${GATEWAY_URL}', aiGatewayModel: 'omni-default',
    aiRules: [{ id: 'ai-rule-repro', text: '不许引战', enabled: true }]
  }
}) };
window.__writes = 0;
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; if (k === 'omniblock:data:v1') window.__writes++; };
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

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站 AI 人工合成回归页</title></head><body>
<bili-comments id="comments"></bili-comments>
<script>
  const comments = document.getElementById('comments');
  const root = comments.attachShadow({ mode: 'open' });
  function makeComment(mid, name, text, withIdentity = true) {
    const renderer = document.createElement('bili-comment-renderer');
    if (withIdentity) renderer.__data = { mid: String(mid), member: { mid: String(mid), uname: name } };
    const shadow = renderer.attachShadow({ mode: 'open' });
    if (withIdentity) {
      const link = document.createElement('a'); link.className = 'user-name';
      link.href = 'https://space.bilibili.com/' + mid; link.textContent = name;
      shadow.appendChild(link);
    }
    const body = document.createElement('span'); body.className = 'text'; body.textContent = text;
    shadow.appendChild(body);
    return renderer;
  }
  // 延迟挂载用于回归“评论晚于首轮自动分析”时的有界重试。
  setTimeout(() => root.append(
    makeComment(123, '人工合成用户甲', '这是一条引战内容'),
    makeComment(321, '人工合成用户丁', '这是另一条引战内容'),
    makeComment(456, '人工合成用户乙', '这是一条正常内容'),
    makeComment(789, '人工合成用户丙', '这是一条拉踩内容'),
    makeComment('', '', '这是一条没有可靠身份的引战内容', false)
  ), 1650);
</script>
</body></html>`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const watchdogReady = USERSCRIPT.includes("const AI_REQUEST_TIMEOUT_MS = 60000;")
    && USERSCRIPT.includes("const AI_REQUEST_WATCHDOG_SLACK_MS = 250;")
    && USERSCRIPT.includes("timer = setTimeout(() => cancel('AI 网关请求超时'), timeoutMs + AI_REQUEST_WATCHDOG_SLACK_MS);")
    && DEV_EXTENSION_BUILDER.includes('const MAX_AI_REQUEST_TIMEOUT_MS = 60000;')
    && /const serviceWorker = String\.raw`[\s\S]*?const MAX_AI_REQUEST_TIMEOUT_MS = 60000;/.test(DEV_EXTENSION_BUILDER)
    && DEV_EXTENSION_BUILDER.includes('Math.min(Number(message.timeout) || MAX_AI_REQUEST_TIMEOUT_MS, MAX_AI_REQUEST_TIMEOUT_MS)');
  if (watchdogReady) report.pass.push('AI-9 GM/XHR 无回调时有独立请求 watchdog');
  else report.fail.push('AI-9 缺少独立请求 watchdog，桥接无回调可能永久 loading');
  if (USERSCRIPT.includes("const AI_BATCH_SIZE = 80;")
    && USERSCRIPT.includes("status.batchCount")
    && USERSCRIPT.includes("每批最多 ' + AI_BATCH_SIZE + ' 条" )
    && !USERSCRIPT.includes('仅分析前')) {
    report.pass.push('AI-10 分析加载态显示分批进度，不再把单批上限误报为全页截断');
  } else report.fail.push('AI-10 分析加载态未切换到全量分批文案');
  const bridgeDiagnosticsReady = USERSCRIPT.includes('function persistentBridgeError()')
    && USERSCRIPT.includes('浏览器开发扩展桥接不可用')
    && USERSCRIPT.includes('loopback 地址校验已通过；请检查本地网关和浏览器扩展桥接。')
    && USERSCRIPT.includes("status.state === 'error' && status.gatewayConfigured");
  if (bridgeDiagnosticsReady) report.pass.push('AI-11 开发桥降级快速诊断与 loopback 错误文案已接入');
  else report.fail.push('AI-11 缺少开发桥降级快速诊断或有效 loopback 错误文案');
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url() === GATEWAY_URL) {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            items: (Array.isArray(input.items) ? input.items : []).flatMap((item) => {
              const rules = Array.isArray(input.rules) ? input.rules.join(' ') : '';
              const text = String(item && item.text || '');
              const shouldBlock = (rules.includes('引战') && text.includes('引战'))
                || (rules.includes('拉踩') && text.includes('拉踩'));
              return shouldBlock ? [{ id: item.id, decision: 'block', confidence: text.includes('拉踩') ? 0.74 : 0.96, reason: text.includes('拉踩') ? '命中页面附加规则' : '命中预设规则' }] : [];
            }),
          }) } }],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-screening.cjs' });
  await page.goto('https://www.bilibili.com/video/ai-screening-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai && document.querySelector('#ob-gear')), null, { timeout: 8000 }).catch(() => {});
  await sleep(3000);

  const initial = await page.evaluate(() => {
    const review = document.querySelector('#ob-ai-review');
    const inputs = review ? Array.from(review.querySelectorAll('input[type="checkbox"]')) : [];
    return {
      hasAI: !!(window.OB && window.OB.ai),
      status: window.OB && window.OB.ai ? window.OB.ai.status() : null,
      review: !!review,
      candidates: inputs.length,
      disabledCandidates: inputs.filter((input) => input.disabled).length,
      bodies: window.__aiBodies || [],
    };
  });
  if (initial.hasAI) report.pass.push('AI-1 window.OB.ai 已初始化');
  else report.fail.push('AI-1 window.OB.ai 未初始化');
  if (initial.review && initial.candidates === 3 && initial.disabledCandidates === 1) report.pass.push('AI-2 自动分析弹出候选审核，可靠身份可选、无身份候选禁用');
  else report.fail.push('AI-2 自动候选审核形态不符合预期：' + JSON.stringify({ review: initial.review, candidates: initial.candidates, disabled: initial.disabledCandidates, status: initial.status }));
  const serializedBodies = JSON.stringify(initial.bodies);
  if (initial.bodies.length >= 1 && !/(bili:uid|bili:dmhash|space\.bilibili|"keys"|"uid"|"mid"|"hash")/i.test(serializedBodies)) report.pass.push('AI-3 发往网关的请求只包含规则/临时项目/文本，不含身份键');
  else report.fail.push('AI-3 AI 请求疑似携带身份字段：' + serializedBodies.slice(0, 1000));

  if (initial.review) {
    await page.locator('#ob-ai-review .ob-ai-confirm').click();
    await page.waitForFunction(() => {
      const state = window.__gm && window.__gm['omniblock:data:v1'];
      return typeof state === 'string' && state.includes('bili:uid:123');
    }, null, { timeout: 5000 }).catch(() => {});
  }
  const afterAuto = await page.evaluate(() => ({
    has123: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:123'),
    has321: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:321'),
    has789: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'),
    review: !!document.querySelector('#ob-ai-review'),
    writes: window.__writes || 0,
  }));
  if (afterAuto.has123 && afterAuto.has321 && !afterAuto.has789) report.pass.push('AI-4 多选确认一次写入两个可靠身份，未把未命中的页面附加内容提前写入');
  else report.fail.push('AI-4 自动审核确认结果异常：' + JSON.stringify(afterAuto));

  await page.evaluate(() => window.OB.openOptions());
  await page.waitForSelector('#ob-panel');
  const settingsHasAI = await page.locator('#ob-panel #ob-ai-enabled').count();
  if (!settingsHasAI) report.pass.push('AI-12 设置页不再承载 AI 配置控件');
  else report.fail.push('AI-12 AI 配置控件仍残留在设置页');
  await page.evaluate(() => { window.OB.openOptions(); window.OB.openContentManager(window.OB.adapters.bilibili, 'ai'); });
  await page.waitForSelector('#ob-content-manager #ob-ai-status');
  const launcherHint = await page.locator('.ob-ai-intro').textContent();
  if (/启动网关\.cmd/.test(launcherHint || '') && /loopback 网关/.test(launcherHint || '')) report.pass.push('AI-8 AI 标签页说明根目录双击启动网关并保持 loopback 边界');
  else report.fail.push('AI-8 AI 标签页缺少一键启动说明：' + String(launcherHint || '').slice(0, 300));
  await page.locator('#ob-ai-url').fill('https://example.invalid/v1/chat/completions');
  await page.locator('#ob-ai-save').click();
  const rejectedGateway = await page.evaluate(() => ({
    text: document.querySelector('#ob-ai-status') && document.querySelector('#ob-ai-status').textContent,
    saved: String(window.__gm['omniblock:data:v1'] || '').includes('example.invalid'),
  }));
  if (/只允许.*loopback/.test(rejectedGateway.text || '') && !rejectedGateway.saved) report.pass.push('AI-7 远程网关地址被拒绝，设置不会保存非 loopback URL');
  else report.fail.push('AI-7 loopback 地址边界未生效：' + JSON.stringify(rejectedGateway));
  await page.locator('#ob-ai-page-rule').fill('不许拉踩');
  await page.locator('#ob-ai-analyze').click();
  await page.waitForSelector('#ob-ai-review', { timeout: 5000 }).catch(() => {});
  const pageRule = await page.evaluate(() => {
    const review = document.querySelector('#ob-ai-review');
    const rows = review ? Array.from(review.querySelectorAll('.ob-ai-candidate')) : [];
    return {
      rows: rows.length,
      text: rows.map((row) => row.querySelector('.ob-ai-candidate-text') && row.querySelector('.ob-ai-candidate-text').textContent),
      status: window.OB.ai.status(),
    };
  });
  if (pageRule.rows === 2 && pageRule.text.some((text) => String(text).includes('拉踩'))
    && pageRule.text.some((text) => String(text).includes('引战'))) report.pass.push('AI-5 页面附加规则与预设规则合并分析当前页，并保留无身份候选的安全提示');
  else report.fail.push('AI-5 页面附加规则候选异常：' + JSON.stringify(pageRule));
  if (pageRule.rows) {
    await page.locator('#ob-ai-review .ob-ai-confirm').click();
    await page.waitForFunction(() => String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'), null, { timeout: 5000 }).catch(() => {});
  }
  const finalState = await page.evaluate(() => ({
    has123: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:123'),
    has321: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:321'),
    has789: String(window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'),
    persistedSettings: String(window.__gm['omniblock:data:v1'] || '').includes('aiEnabled'),
    errors: window.__aiBodies.length,
  }));
  if (finalState.has123 && finalState.has321 && finalState.has789 && finalState.persistedSettings) report.pass.push('AI-6 页面附加规则确认进入现有名单持久化链路');
  else report.fail.push('AI-6 页面附加规则确认未完成：' + JSON.stringify(finalState));

  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('AI TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

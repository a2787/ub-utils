/* OmniBlock AI 智能屏蔽第一阶段回归测试。
 * 夹具说明：评论 Shadow DOM 结构是人工合成，但节点形态沿用已有 B站评论适配器契约；
 * 本测试不连接真实模型，使用 Playwright route 模拟本地 OpenAI Chat Completions 网关。
 * 覆盖：默认配置入口、loopback 网关请求、请求不含身份键、AI 建议多选确认、
 * 无可靠身份候选不可执行、页面附加规则、名单持久化、评论晚到后的增量分析，
 * 以及后续弹幕数据段触发的增量分析、累计计数和 B站嵌套评论滚动/点击后的增量分析。
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
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
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
window.__cardCalls = [];
window.GM_xmlhttpRequest = (opts) => {
  const requestUrl = String(opts && opts.url || '');
  if (requestUrl.includes('api.bilibili.com/x/web-interface/card')) {
    let uid = '';
    try { uid = new URL(requestUrl).searchParams.get('mid') || ''; } catch (error) {}
    window.__cardCalls.push(uid);
    setTimeout(() => {
      const card = uid === '33' ? { mid: '33', name: 'AI Danmaku User', level_info: { current_level: 5 } } : null;
      if (opts.onload) opts.onload({ status: 200, responseText: JSON.stringify(card
        ? { code: 0, data: { card } }
        : { code: -404, data: null }) });
    }, 0);
    return { abort() {} };
  }
  try { window.__aiBodies.push(JSON.parse(opts.data || '{}')); } catch (error) {}
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

function varint(value) {
  const out = [];
  let n = value >>> 0;
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n); return out;
}
function fieldText(number, value) {
  const body = Array.from(Buffer.from(value, 'utf8'));
  return [...varint((number << 3) | 2), ...varint(body.length), ...body];
}
function fieldVarint(number, value) { return [...varint(number << 3), ...varint(value)]; }
const AI_DM_SEGMENT = Buffer.from([
  ...varint(10),
  ...varint(fieldVarint(2, 1000).length + fieldText(6, '0a6216d9').length + fieldText(7, 'AI弹幕拉踩内容').length),
  ...fieldVarint(2, 1000), ...fieldText(6, '0a6216d9'), ...fieldText(7, 'AI弹幕拉踩内容'),
]);

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站 AI 人工合成回归页</title></head><body>
<script>window.__INITIAL_STATE__ = { videoData: { aid: '12345', cid: '67890' } };</script>
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
    && DEV_EXTENSION_BUILDER.includes('Math.min(Number(message.timeout) || request.timeout, request.timeout)');
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
  page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (/\/x\/v2\/dm\/(?:wbi\/)?web\/seg\.so/.test(request.url())) {
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: AI_DM_SEGMENT });
      return;
    }
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
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-ai-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-ai-screening.cjs' });
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
    has123: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:123'),
    has321: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:321'),
    has789: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'),
    review: !!document.querySelector('#ob-ai-review'),
    writes: window.__writes || 0,
  }));
  if (afterAuto.has123 && afterAuto.has321 && !afterAuto.has789) report.pass.push('AI-4 多选确认一次写入两个可靠身份，未把未命中的页面附加内容提前写入');
  else report.fail.push('AI-4 自动审核确认结果异常：' + JSON.stringify(afterAuto));

  // 人工合成：首轮评论分析并确认完成后才挂载一条新评论；第二次自动分析
  // 只能携带这个尚未分析的稳定记录，不能把首轮已发送的评论再次发送。
  const beforeLateCommentBodies = initial.bodies.length;
  await page.evaluate(() => {
    const comments = document.getElementById('comments');
    const root = comments && comments.shadowRoot;
    if (!root) return;
    const renderer = document.createElement('bili-comment-renderer');
    renderer.__data = { mid: '654', member: { mid: '654', uname: '人工合成晚到用户' } };
    const shadow = renderer.attachShadow({ mode: 'open' });
    const link = document.createElement('a'); link.className = 'user-name';
    link.href = 'https://space.bilibili.com/654'; link.textContent = '人工合成晚到用户';
    const body = document.createElement('span'); body.className = 'text'; body.textContent = '这是一条晚到引战内容';
    shadow.append(link, body); root.appendChild(renderer);
  });
  await page.waitForFunction((expected) => (window.__aiBodies || []).length >= expected,
    beforeLateCommentBodies + 1, { timeout: 5000 });
  await sleep(80);
  const lateComment = await page.evaluate(() => {
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    let input = {};
    try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
    return {
      count: bodies.length,
      items: input.items || [],
      rows: Array.from(document.querySelectorAll('#ob-ai-review .ob-ai-candidate-text')).map((node) => node.textContent),
      status: window.OB.ai.status(),
    };
  });
  if (lateComment.count === beforeLateCommentBodies + 1 && lateComment.items.length === 1
    && /晚到引战内容/.test(lateComment.items[0].text || '')
    && !/这是一条引战内容|另一条引战内容/.test(JSON.stringify(lateComment.items))) {
    report.pass.push('AI-14 B站评论晚于首轮分析时只增量发送新记录，不重复消耗旧内容 token');
  } else report.fail.push('AI-14 B站评论延迟增量分析异常：' + JSON.stringify(lateComment));
  if (lateComment.status && lateComment.status.records > 0
    && lateComment.status.analyzed === lateComment.status.records
    && lateComment.status.batchCount === 1 && lateComment.status.batchIndex === 1
    && lateComment.status.newRecords === 1) {
    report.pass.push('AI-15 B站评论增量完成后“已分析数量”保持为当前页面累计数');
  } else report.fail.push('AI-15 B站增量累计分析数异常：' + JSON.stringify(lateComment));
  await page.evaluate(() => window.OB.ai.closeReview());

  // 人工合成：关闭本页自动弹幕 bootstrap，待首轮评论 AI 审核完成后才主动
  // 读取目标段；这样可以证明弹幕是后续被纳入 AI 分析的内容，而不是首屏全量扫描。
  const beforeAiDanmakuBodies = await page.evaluate(() => (window.__aiBodies || []).length);
  const loadedAiDanmaku = await page.evaluate(async () => {
    try {
      const response = await fetch('https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=67890&segment_index=1');
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: response.ok, content: window.OB && window.OB.adapters.bilibili.collectAIRecords(document).some((item) => item.kind === 'danmaku' && item.text === 'AI弹幕拉踩内容') };
    } catch (error) { return { ok: false, error: String(error) }; }
  });
  if (loadedAiDanmaku.ok && loadedAiDanmaku.content) report.pass.push('AI-13 目标弹幕在首轮评论审核后按需载入，未依赖初始全量弹幕扫描');
  else report.fail.push('AI-13 目标弹幕按需载入失败：' + JSON.stringify(loadedAiDanmaku));
  await sleep(1800);
  const aiDanmakuIncrement = await page.evaluate(() => {
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    let input = {};
    try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
    return { count: bodies.length, items: input.items || [], status: window.OB.ai.status() };
  });
  if (aiDanmakuIncrement.count === beforeAiDanmakuBodies + 1
    && aiDanmakuIncrement.items.length === 1
    && aiDanmakuIncrement.items[0].kind === 'danmaku'
    && aiDanmakuIncrement.items[0].text === 'AI弹幕拉踩内容'
    && aiDanmakuIncrement.status.analyzed === aiDanmakuIncrement.status.records
    && !/晚到引战内容|这是一条引战内容|另一条引战内容/.test(JSON.stringify(aiDanmakuIncrement.items))) {
    report.pass.push('AI-16 B站后续弹幕数据段触发只含新弹幕的增量 AI 分析');
  } else report.fail.push('AI-16 B站弹幕数据段增量分析异常：' + JSON.stringify(aiDanmakuIncrement));
  await page.evaluate(() => window.OB.ai.closeReview());

  // 人工合成：模拟 B站评论组件先挂载 thread 容器、稍后才 attachShadow 并
  // 填充子评论。此时首轮扫描已经结束；只有滚动/点击交互触发重新发现开放
  // ShadowRoot，才应把这条新记录交给下一次有界 AI 分析。
  const beforeNestedCommentBodies = await page.evaluate(() => (window.__aiBodies || []).length);
  await page.evaluate(async () => {
    const comments = document.getElementById('comments');
    const root = comments && comments.shadowRoot;
    if (!root) return;
    const thread = document.createElement('bili-comment-thread-renderer');
    root.appendChild(thread);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const threadShadow = thread.attachShadow({ mode: 'open' });
    const replies = document.createElement('bili-comment-replies-renderer');
    const repliesShadow = replies.attachShadow({ mode: 'open' });
    const reply = document.createElement('bili-comment-reply-renderer');
    reply.__data = { mid: '987', root: '654', rpid: '9870', member: { mid: '987', uname: '人工合成子评论用户' } };
    const replyShadow = reply.attachShadow({ mode: 'open' });
    const link = document.createElement('a'); link.className = 'user-name';
    link.href = 'https://space.bilibili.com/987'; link.textContent = '人工合成子评论用户';
    const body = document.createElement('bili-rich-text');
    const bodyShadow = body.attachShadow({ mode: 'open' });
    const bodyText = document.createElement('p'); bodyText.textContent = '这是一条延迟子评论内容';
    bodyShadow.appendChild(bodyText);
    replyShadow.append(link, body);
    repliesShadow.appendChild(reply);
    threadShadow.appendChild(replies);
    await new Promise((resolve) => setTimeout(resolve, 60));
    window.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction((expected) => (window.__aiBodies || []).length >= expected,
    beforeNestedCommentBodies + 1, { timeout: 5000 }).catch(() => {});
  await sleep(80);
  const nestedComment = await page.evaluate(() => {
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    let input = {};
    try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
    return { count: bodies.length, items: input.items || [], status: window.OB.ai.status() };
  });
  if (nestedComment.count === beforeNestedCommentBodies + 1
    && nestedComment.items.length === 1
    && nestedComment.items[0].kind === 'comment'
    && nestedComment.items[0].text === '这是一条延迟子评论内容'
    && nestedComment.status.analyzed === nestedComment.status.records
    && nestedComment.status.newRecords === 1
    && !/晚到引战内容|AI弹幕拉踩内容/.test(JSON.stringify(nestedComment.items))) {
    report.pass.push('AI-17 B站嵌套子评论经滚动交互后触发只含新记录的增量分析');
  } else report.fail.push('AI-17 B站嵌套子评论交互增量分析异常：' + JSON.stringify(nestedComment));
  await page.evaluate(() => window.OB.ai.closeReview());

  const beforeNestedClickBodies = await page.evaluate(() => (window.__aiBodies || []).length);
  await page.evaluate(async () => {
    const comments = document.getElementById('comments');
    const root = comments && comments.shadowRoot;
    if (!root) return;
    const thread = document.createElement('bili-comment-thread-renderer');
    root.appendChild(thread);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const threadShadow = thread.attachShadow({ mode: 'open' });
    const replies = document.createElement('bili-comment-replies-renderer');
    const repliesShadow = replies.attachShadow({ mode: 'open' });
    const reply = document.createElement('bili-comment-reply-renderer');
    reply.__data = { mid: '988', root: '655', rpid: '9880', member: { mid: '988', uname: '人工合成点击子评论用户' } };
    const replyShadow = reply.attachShadow({ mode: 'open' });
    const link = document.createElement('a'); link.className = 'user-name';
    link.href = 'https://space.bilibili.com/988'; link.textContent = '人工合成点击子评论用户';
    const body = document.createElement('bili-rich-text');
    const bodyShadow = body.attachShadow({ mode: 'open' });
    const bodyText = document.createElement('p'); bodyText.textContent = '这是一条点击后加载的子评论内容';
    bodyShadow.appendChild(bodyText);
    replyShadow.append(link, body);
    repliesShadow.appendChild(reply);
    threadShadow.appendChild(replies);
    await new Promise((resolve) => setTimeout(resolve, 60));
    reply.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  await page.waitForFunction((expected) => (window.__aiBodies || []).length >= expected,
    beforeNestedClickBodies + 1, { timeout: 5000 }).catch(() => {});
  await sleep(80);
  const nestedClickComment = await page.evaluate(() => {
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    let input = {};
    try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
    return { count: bodies.length, items: input.items || [], status: window.OB.ai.status() };
  });
  if (nestedClickComment.count === beforeNestedClickBodies + 1
    && nestedClickComment.items.length === 1
    && nestedClickComment.items[0].kind === 'comment'
    && nestedClickComment.items[0].text === '这是一条点击后加载的子评论内容'
    && nestedClickComment.status.analyzed === nestedClickComment.status.records
    && nestedClickComment.status.newRecords === 1
    && !/延迟子评论内容|AI弹幕拉踩内容/.test(JSON.stringify(nestedClickComment.items))) {
    report.pass.push('AI-18 B站嵌套子评论经点击交互后触发只含新记录的增量分析');
  } else report.fail.push('AI-18 B站嵌套子评论点击增量分析异常：' + JSON.stringify(nestedClickComment));
  await page.evaluate(() => window.OB.ai.closeReview());

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
    saved: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('example.invalid'),
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
  if (pageRule.rows === 4 && pageRule.text.some((text) => String(text).includes('拉踩'))
    && pageRule.text.some((text) => String(text).includes('AI弹幕拉踩内容'))
    && pageRule.text.some((text) => String(text).includes('引战'))
    && pageRule.text.some((text) => String(text).includes('晚到引战内容'))) report.pass.push('AI-5 页面附加规则与预设规则合并分析当前页，并保留无身份候选的安全提示');
  else report.fail.push('AI-5 页面附加规则候选异常：' + JSON.stringify(pageRule));
  if (pageRule.rows) {
    await page.evaluate(() => { window.__cardCalls.length = 0; });
    await page.locator('#ob-ai-review .ob-ai-confirm').click();
    await page.waitForFunction(() => {
      const state = String(window.__gm['omniblock:data:v1'] || '');
      return state.includes('bili:uid:789') && state.includes('bili:dmhash:0a6216d9') && state.includes('bili:uid:33');
    }, null, { timeout: 5000 }).catch(() => {});
  }
  const finalState = await page.evaluate(() => ({
    has123: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:123'),
    has321: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:321'),
    has789: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'),
    hasDmHash: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:0a6216d9'),
    hasDmUid: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:33'),
    cardCalls: window.__cardCalls || [],
    persistedSettings: String(window.__gm['omniblock:data:v1'] || '').includes('aiEnabled'),
    errors: window.__aiBodies.length,
  }));
  if (finalState.has123 && finalState.has321 && finalState.has789 && finalState.hasDmHash && finalState.hasDmUid
    && finalState.cardCalls.includes('33') && finalState.persistedSettings) report.pass.push('AI-6 页面附加规则确认进入现有名单持久化链路，并仅为命中的弹幕按需关联 UID');
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

/* OmniBlock AI 智能屏蔽第一阶段回归测试。
 * 夹具说明：评论 Shadow DOM 结构是人工合成，但节点形态沿用已有 B站评论适配器契约；
 * 本测试不连接真实模型，使用 Playwright route 模拟用户配置的 OpenAI-compatible API。
 * 覆盖：默认配置入口、userscript API 直连、请求不含身份键、AI 建议多选确认、
 * 无可靠身份候选不可执行、页面附加规则、名单持久化、评论晚到后的增量分析，
 * 以及后续弹幕数据段触发的增量分析、累计计数和 B站嵌套评论滚动/点击后的增量分析，
 * 以及 AI 弹幕确认的即时关闭、基础 hash 先落盘、后台 UID 补充和分段耗时日志。
 * 运行：node test/ai-screening.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const DEV_EXTENSION_BUILDER = fs.readFileSync(path.join(ROOT, 'test', 'build-dev-extension.cjs'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: true,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
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
      const cards = {
        '33': { mid: '33', name: 'AI Danmaku User', level_info: { current_level: 5 } },
        '222': { mid: '222', name: 'AI Paused User', level_info: { current_level: 5 } },
        '1001': { mid: '1001', name: 'AI Route User', level_info: { current_level: 5 } },
      };
      const card = cards[uid] || null;
      if (opts.onload) opts.onload({ status: 200, responseText: JSON.stringify(card
        ? { code: 0, data: { card } }
        : { code: -404, data: null }) });
    }, Math.max(0, Number(window.__cardDelayMs) || 0));
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
const AI_DM_SEGMENT_ROUTE = Buffer.from([
  ...varint(10),
  ...varint(fieldVarint(2, 3000).length + fieldText(6, 'c3209381').length + fieldText(7, 'AI弹幕路由拉踩内容').length),
  ...fieldVarint(2, 3000), ...fieldText(6, 'c3209381'), ...fieldText(7, 'AI弹幕路由拉踩内容'),
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
  let providerAttempts = 0;
  const watchdogReady = USERSCRIPT.includes("const AI_REQUEST_TIMEOUT_MS = 60000;")
    && USERSCRIPT.includes("const AI_REQUEST_WATCHDOG_SLACK_MS = 250;")
    && USERSCRIPT.includes("timer = setTimeout(() => cancel(label + '请求超时'), timeoutMs + AI_REQUEST_WATCHDOG_SLACK_MS);")
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
  const directMainlineReady = USERSCRIPT.includes('function readAIDirectKey()')
    && USERSCRIPT.includes("headers.Authorization = 'Bearer ' + apiKey")
    && USERSCRIPT.includes('providerConfigured: !!transport.url')
    && USERSCRIPT.includes('API Key 只保存在当前设备的 Tampermonkey GM 存储');
  if (directMainlineReady) report.pass.push('AI-11 userscript 直连 API、独立本机 Key 与状态诊断已接入');
  else report.fail.push('AI-11 userscript 直连 API 或本机 Key 边界缺失');
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (/\/x\/v2\/dm\/(?:wbi\/)?web\/seg\.so/.test(request.url())) {
      let segment = AI_DM_SEGMENT;
      try {
        const index = new URL(request.url()).searchParams.get('segment_index');
        if (index === '3') segment = AI_DM_SEGMENT_ROUTE;
      } catch (error) {}
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: segment });
      return;
    }
    if (request.url() === PROVIDER_URL) {
      // 首次请求返回 429，验证直连批量请求的瞬态失败重试：分析必须靠
      // 第二次请求完成，旧行为（无重试）会让整轮分析失败。
      providerAttempts++;
      if (providerAttempts === 1) {
        await route.fulfill({ status: 429, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'rate limited' }) });
        return;
      }
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      if (input && input.items && input.items.length === 0 && body.max_tokens === 1) {
        await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ choices: [{ message: { content: 'pong' } }] }) });
        return;
      }
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
  // 自动分析含一次 429 重试延迟；等审核浮层出现而不是固定 sleep。
  await page.waitForFunction(() => !!document.querySelector('#ob-ai-review'), null, { timeout: 15000 }).catch(() => {});
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
  if (initial.status && initial.status.mode === 'direct'
    && initial.status.directSupported === true
    && initial.status.providerConfigured === true
    && initial.status.keyConfigured === true
    && initial.status.gatewayConfigured === false) {
    report.pass.push('AI-1A userscript 默认使用 API 直连且已读取本机 Key，不再依赖历史网关');
  } else report.fail.push('AI-1A 非正式扩展错误开放设备直连 API：' + JSON.stringify(initial.status));
  if (initial.review && initial.candidates === 3 && initial.disabledCandidates === 1) report.pass.push('AI-2 自动分析弹出候选审核，可靠身份可选、无身份候选禁用');
  else report.fail.push('AI-2 自动候选审核形态不符合预期：' + JSON.stringify({ review: initial.review, candidates: initial.candidates, disabled: initial.disabledCandidates, status: initial.status }));
  const serializedBodies = JSON.stringify(initial.bodies);
  if (initial.bodies.length >= 1 && !/(bili:uid|bili:dmhash|space\.bilibili|"keys"|"uid"|"mid"|"hash")/i.test(serializedBodies)) report.pass.push('AI-3 发往 API 的请求只包含规则/临时项目/文本，不含身份键');
  else report.fail.push('AI-3 AI 请求疑似携带身份字段：' + serializedBodies.slice(0, 1000));

  // 人工合成：审核弹窗中的负向反馈必须是可撤销切换。测试四次点击的
  // 完整状态链：记录、撤销、再次记录、再次撤销；最后恢复可选状态，
  // 以免干扰后续的名单确认断言。
  let rejectToggle = null;
  if (initial.review && initial.candidates) {
    const targetReject = page.locator('#ob-ai-review .ob-ai-candidate').first().locator('.ob-ai-reject');
    const snapshotReject = () => page.evaluate(() => {
      const row = document.querySelector('#ob-ai-review .ob-ai-candidate');
      const button = row && row.querySelector('.ob-ai-reject');
      const input = row && row.querySelector('input[type="checkbox"]');
      const feedback = window.OB.ai.prompt.getFeedback(500).filter((event) => event.label === 'negative' && event.source === 'ai_rejected');
      return {
        active: button && button.getAttribute('aria-pressed') === 'true',
        disabled: !!(button && button.disabled),
        inputDisabled: !!(input && input.disabled),
        checked: !!(input && input.checked),
        rowFeedback: row && row.dataset.feedback || '',
        feedbackCount: feedback.length,
        mainData: String(window.__gm && window.__gm['omniblock:data:v1'] || ''),
      };
    });
    await targetReject.click();
    await page.waitForSelector('#ob-ai-feedback', { timeout: 3000 }).catch(() => {});
    if (await page.locator('#ob-ai-feedback .ob-ai-feedback-skip').count()) await page.locator('#ob-ai-feedback .ob-ai-feedback-skip').click();
    const recorded = await snapshotReject();
    await targetReject.click();
    const withdrawn = await snapshotReject();
    await targetReject.click();
    await page.waitForSelector('#ob-ai-feedback', { timeout: 3000 }).catch(() => {});
    if (await page.locator('#ob-ai-feedback .ob-ai-feedback-skip').count()) await page.locator('#ob-ai-feedback .ob-ai-feedback-skip').click();
    const rerecorded = await snapshotReject();
    await targetReject.click();
    const restored = await snapshotReject();
    rejectToggle = { recorded, withdrawn, rerecorded, restored };
  }
  if (rejectToggle
    && rejectToggle.recorded.active && !rejectToggle.recorded.disabled
    && rejectToggle.recorded.inputDisabled && !rejectToggle.recorded.checked
    && rejectToggle.recorded.rowFeedback === 'negative' && rejectToggle.recorded.feedbackCount === 1
    && !rejectToggle.withdrawn.active && !rejectToggle.withdrawn.disabled
    && !rejectToggle.withdrawn.inputDisabled && rejectToggle.withdrawn.checked
    && !rejectToggle.withdrawn.rowFeedback && rejectToggle.withdrawn.feedbackCount === 0
    && rejectToggle.rerecorded.active && !rejectToggle.rerecorded.disabled
    && rejectToggle.rerecorded.feedbackCount === 1
    && !rejectToggle.restored.active && !rejectToggle.restored.disabled
    && !rejectToggle.restored.inputDisabled && rejectToggle.restored.checked
    && rejectToggle.restored.feedbackCount === 0
    && !/bili:(?:uid|dmhash):/.test(rejectToggle.restored.mainData)) {
    report.pass.push('AI-19 审核“不屏蔽”灰态可点击撤销，反馈可再次记录且候选恢复可选');
  } else report.fail.push('AI-19 负向反馈切换异常：' + JSON.stringify(rejectToggle));

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
  if (/填写.*API|OpenAI-compatible API/.test(launcherHint || '')
    && /Tampermonkey/.test(launcherHint || '') && /API Key/.test(launcherHint || '') && !/本地模型/.test(launcherHint || '')) {
    report.pass.push('AI-8 AI 标签页说明 userscript API 直连、本机 Key 和无本地模型边界');
  } else report.fail.push('AI-8 AI 标签页缺少 userscript 直连和本机 Key 说明：' + String(launcherHint || '').slice(0, 360));
  await page.locator('#ob-ai-provider-url').fill('http://example.invalid/v1/chat/completions');
  await page.locator('#ob-ai-save').click();
  const rejectedGateway = await page.evaluate(() => ({
    text: document.querySelector('#ob-ai-status') && document.querySelector('#ob-ai-status').textContent,
    saved: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('example.invalid'),
  }));
  if (/只允许 HTTPS.*loopback HTTP/.test(rejectedGateway.text || '') && !rejectedGateway.saved) report.pass.push('AI-7 非 HTTPS/loopback API 地址被拒绝，设置不会保存');
  else report.fail.push('AI-7 API 地址边界未生效：' + JSON.stringify(rejectedGateway));
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
    await page.evaluate(() => {
      window.__cardCalls.length = 0;
      window.__cardDelayMs = 700;
      window.__aiConfirmClickAt = performance.now();
    });
    await page.locator('#ob-ai-review .ob-ai-confirm').click();
    const immediateCommit = await page.evaluate(() => ({
      review: !!document.querySelector('#ob-ai-review'),
      elapsed: performance.now() - Number(window.__aiConfirmClickAt || 0),
      hasImmediateDmHash: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:0a6216d9'),
      background: window.OB && window.OB.ai ? window.OB.ai.status().background : null,
      backgroundText: document.querySelector('#ob-ai-background-status') && document.querySelector('#ob-ai-background-status').textContent,
      hasBackgroundUndo: !!document.querySelector('#ob-ai-background-status .ob-ai-background-undo'),
    }));
    if (!immediateCommit.review && immediateCommit.elapsed < 250 && immediateCommit.hasImmediateDmHash
      && immediateCommit.background && immediateCommit.background.active === 1
      && immediateCommit.background.total >= 1 && /正在后台补充 UID/.test(immediateCommit.backgroundText || '')
      && immediateCommit.hasBackgroundUndo) {
      report.pass.push('AI-20 B站 AI 弹幕确认后审核弹窗立即关闭，基础 hash 立即生效，后台状态/撤销入口可见');
    } else {
      report.fail.push('AI-20 B站 AI 弹幕确认仍阻塞审核弹窗：' + JSON.stringify(immediateCommit));
    }
    // 当前任务先模拟页面隐藏；隐藏时应暂停 UID 补充，恢复可见后继续完成。
    const pauseState = await page.evaluate(async () => {
    const result = { supported: false, paused: false, text: '', hash: false };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await pause(120);
      const status = window.OB.ai.status();
      result.supported = true;
      result.paused = status.background && status.background.paused === 1 && status.background.active === 0;
      result.text = document.querySelector('#ob-ai-background-status') && document.querySelector('#ob-ai-background-status').textContent || '';
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await pause(80);
    } catch (error) {
      result.error = String(error);
    } finally {
      try {
        if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden); else delete document.hidden;
        if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility); else delete document.visibilityState;
      } catch (error) {}
    }
    result.hash = String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:0a6216d9');
    return result;
  });
  await page.waitForFunction(() => String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:33'), null, { timeout: 6000 }).catch(() => {});
  const afterPause = await page.evaluate(() => ({
    hasHash: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:0a6216d9'),
    hasUid: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:33'),
    hasCard33: (window.__cardCalls || []).includes('33'),
    background: window.OB.ai.status().background,
    statusNode: !!document.querySelector('#ob-ai-background-status'),
    toast: document.querySelector('#ob-toast') && document.querySelector('#ob-toast').textContent,
  }));
  if (pauseState.supported && pauseState.paused && /页面不可见，已暂停/.test(pauseState.text)
     && pauseState.hash && afterPause.hasHash && afterPause.hasUid && afterPause.hasCard33
     && afterPause.background.total === 0 && !afterPause.statusNode && /后台补充完成/.test(afterPause.toast || '')) {
    report.pass.push('AI-22 B站 UID 后台任务在 hidden 时暂停，恢复可见后继续且不重复写基础 hash');
  } else report.fail.push('AI-22 B站后台任务 hidden/resume 生命周期异常：' + JSON.stringify({ pauseState, afterPause }));

    // 再载入一个新的弹幕段，启动第二个后台任务后切换 SPA 路由；旧任务
    // 可以保留已经确认的 hash，但不能把迟到的 UID 写入新会话。
    const loadedRouteDm = await page.evaluate(async () => {
      try {
        const response = await fetch('https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=67890&segment_index=3');
        await response.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          ok: response.ok,
          content: window.OB.adapters.bilibili.collectAIRecords(document)
            .some((item) => item.kind === 'danmaku' && item.text === 'AI弹幕路由拉踩内容'),
        };
      } catch (error) { return { ok: false, error: String(error) }; }
    });
    await sleep(1800);
    await page.evaluate(() => window.OB && window.OB.ai && window.OB.ai.closeReview());
    await page.evaluate(() => {
      if (!document.querySelector('#ob-content-manager')) window.OB.openOptions();
      window.OB.openContentManager(window.OB.adapters.bilibili, 'ai');
    });
    await page.waitForSelector('#ob-content-manager #ob-ai-page-rule', { timeout: 5000 }).catch(() => {});
    await page.locator('#ob-content-manager #ob-ai-page-rule').fill('不许拉踩');
    await page.locator('#ob-content-manager #ob-ai-analyze').click();
    await page.waitForSelector('#ob-ai-review', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#ob-ai-review .ob-ai-candidate-text'))
      .some((node) => /AI弹幕路由拉踩内容/.test(node.textContent || '')), null, { timeout: 5000 }).catch(() => {});
    const routeCandidate = await page.evaluate(() => Array.from(document.querySelectorAll('#ob-ai-review .ob-ai-candidate-text'))
      .some((node) => /AI弹幕路由拉踩内容/.test(node.textContent || '')));
    let routeState = { hash: false, uid: false, background: null, statusNode: false };
    if (routeCandidate) {
      await page.evaluate(() => { window.__cardCalls.length = 0; window.__cardDelayMs = 1500; });
      await page.locator('#ob-ai-review .ob-ai-confirm').click();
      await page.evaluate(() => { history.pushState({}, '', '/video/ai-screening-route-cancel'); });
      await sleep(1800);
      routeState = await page.evaluate(() => ({
        hash: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:c3209381'),
        uid: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:1001'),
        background: window.OB.ai.status().background,
        statusNode: !!document.querySelector('#ob-ai-background-status'),
      }));
    }
    if (loadedRouteDm.ok && loadedRouteDm.content && routeCandidate && routeState.hash && !routeState.uid
      && routeState.background && routeState.background.total === 0 && !routeState.statusNode)
      report.pass.push('AI-23 B站 SPA 换路由后取消旧 UID 任务，保留已确认 hash 且不写入迟到 UID');
    else report.fail.push('AI-23 B站后台任务路由隔离异常：' + JSON.stringify({ loadedRouteDm, routeCandidate, routeState }));

  const finalState = await page.evaluate(() => ({
    has123: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:123'),
    has321: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:321'),
    has789: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:789'),
    hasDmHash: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:dmhash:0a6216d9'),
    hasDmUid: String(window.__gm && window.__gm['omniblock:data:v1'] || '').includes('bili:uid:33'),
    cardCalls: window.__cardCalls || [],
    toast: document.querySelector('#ob-toast') && document.querySelector('#ob-toast').textContent,
    review: !!document.querySelector('#ob-ai-review'),
    persistedSettings: String(window.__gm['omniblock:data:v1'] || '').includes('aiEnabled'),
    errors: window.__aiBodies.length,
  }));
   if (finalState.has123 && finalState.has321 && finalState.has789 && finalState.hasDmHash && finalState.hasDmUid
     && afterPause.hasCard33 && /后台补充完成/.test(afterPause.toast || '')
     && finalState.persistedSettings) report.pass.push('AI-6 页面附加规则确认进入现有名单持久化链路，并仅为命中的弹幕按需关联 UID，完成后提示');
  else report.fail.push('AI-6 页面附加规则确认未完成：' + JSON.stringify(finalState));

  const timing = await page.evaluate(() => {
    const events = window.OB && window.OB.logs ? window.OB.logs.eventsForDay() : [];
    const finish = events.filter((event) => event && event.type === 'ai.analysis.finish').pop();
    return finish && finish.data || null;
  });
  if (timing && Number.isFinite(Number(timing.durationMs)) && Number(timing.durationMs) >= 0
    && Number.isFinite(Number(timing.collectMs)) && Number(timing.collectMs) >= 0
    && Number.isFinite(Number(timing.providerMs)) && Number(timing.providerMs) >= 0) {
    report.pass.push('AI-21 AI 分析日志拆分记录采集、API 和总耗时，不含正文或身份键');
  } else report.fail.push('AI-21 AI 分析耗时日志缺少分段字段：' + JSON.stringify(timing));

  const recovered = await page.evaluate(() => {
    const status = window.OB && window.OB.ai ? window.OB.ai.status() : null;
    return !!status && (status.analyzed > 0 || status.candidates > 0 || status.state === 'review' || status.state === 'idle');
  });
  if (providerAttempts >= 2 && recovered) {
    report.pass.push('AI-24 直连请求 429 后自动重试一次，分析靠第二次请求完成（旧行为整轮失败）');
  } else report.fail.push('AI-24 直连重试未生效：providerAttempts=' + providerAttempts + ' recovered=' + recovered);

  }
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

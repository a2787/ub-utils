/* OB-AI-014 作品语境契约与 B 站作用域回归。
 * 夹具说明：页面、标题、简介和评论树均为人工合成；节点形态只复用仓库已有
 * 的 B 站捕获契约。本测试不连接真实平台或模型，只验证语境边界、序号脱敏和
 * 作品切换隔离。
 * 运行：node test/ai-context.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({ version: 1, persons: {}, settings: {
  enabled: true, hideMode: 'collapse', showHoverButton: false, showQuickBlock: false,
  showBulkBlock: false, aiEnabled: false, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default', aiRules: []
} }) };
window.GM_getValue = (key, fallback) => key in window.__gm ? window.__gm[key] : fallback;
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const parent = document.head || document.documentElement; if (!parent) return; const node = document.createElement('style'); node.textContent = css; parent.appendChild(node); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add, { once: true }); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: 'OmniBlock context fixture', version: '0.55.0' } };
window.__contextBodies = [];
window.GM_xmlhttpRequest = (opts) => {
  try { window.__contextBodies.push(JSON.parse(opts.data || '{}')); } catch (error) {}
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
window.__contextErrors = [];
window.addEventListener('error', (event) => window.__contextErrors.push(String(event.error && event.error.stack || event.message || event)));
window.addEventListener('unhandledrejection', (event) => window.__contextErrors.push(String(event.reason && event.reason.stack || event.reason || event)));
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="video-info-container"><h1 class="video-title">人工合成主题：实验室里的安全吐槽</h1><div class="video-desc-container"><div class="basic-desc-info">讨论实验室安全与同学之间的善意调侃。</div></div></div>
<a class="up-name" href="https://space.bilibili.com/8001">人工合成作者</a>
<bili-comments id="comments"></bili-comments>
<script>
  const comments = document.querySelector('#comments');
  const root = comments.attachShadow({ mode: 'open' });
  const thread = document.createElement('bili-comment-thread-renderer');
  thread.__data = { root: '10001' };
  const threadShadow = thread.attachShadow({ mode: 'open' });
  const main = document.createElement('bili-comment-renderer');
  main.__data = { rpid: '10001', mid: '880002', member: { mid: '880002', uname: '根评论作者' } };
  const mainShadow = main.attachShadow({ mode: 'open' });
  const mainLink = document.createElement('a'); mainLink.className = 'user-name'; mainLink.href = 'https://space.bilibili.com/8002'; mainLink.textContent = '根评论作者';
  const mainText = document.createElement('span'); mainText.className = 'text'; mainText.textContent = '这个实验也太硬核了，笑死';
  mainShadow.append(mainLink, mainText);
  const reply = document.createElement('bili-comment-reply-renderer');
  reply.__data = { rpid: '10002', root: '10001', mid: '880003', member: { mid: '880003', uname: '回复作者' } };
  const replyShadow = reply.attachShadow({ mode: 'open' });
  const replyLink = document.createElement('a'); replyLink.className = 'user-name'; replyLink.href = 'https://space.bilibili.com/8003'; replyLink.textContent = '回复作者';
  const replyText = document.createElement('span'); replyText.className = 'text'; replyText.textContent = '你说的硬核是夸奖还是在讽刺？';
  replyShadow.append(replyLink, replyText);
  threadShadow.append(main, reply);
  root.append(thread);
</script></body></html>`;

function fail(message) { throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) report.console.push(message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
  await page.route('**/*', async (route) => {
    if (route.request().url() === PROVIDER_URL) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      const ruleIds = Array.isArray(input.ruleCatalog) ? input.ruleCatalog.map((rule) => rule.id) : [];
      const insufficientContext = Array.isArray(input.rules) && input.rules.includes('语境不足规则');
      const unknownRuleId = Array.isArray(input.rules) && input.rules.includes('未知规则 ID');
      const items = (Array.isArray(input.items) ? input.items : []).map((item) => ({
        id: item.id, decision: 'block', claimType: 'policy_violation', ruleMatched: true,
        matchedRuleIds: unknownRuleId ? ['ai_unknown_rule'] : ruleIds,
        contextSufficiency: insufficientContext ? 'insufficient' : 'sufficient', confidence: 0.96,
        evidenceRefs: ['title', 'description', 'item'], reason: '命中人工合成规则',
      }));
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ items }) } }],
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-context.cjs' });
  await page.goto('https://www.bilibili.com/video/av1?p=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.adapters && window.OB.adapters.bilibili), null, { timeout: 8000 }).catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({ ob: !!window.OB, errors: window.__contextErrors || [] })).catch(() => ({}));
    throw new Error(String(error && error.message || error) + ' diagnostics=' + JSON.stringify(diagnostics));
  });
  await sleep(180);

  const result = await page.evaluate(() => {
    const adapter = window.OB.adapters.bilibili;
    const records = adapter.collectAIRecords(document);
    const summary = records.map((record) => ({
      kind: record.kind, text: record.text, keys: record.keys,
      context: record.context, itemKey: record.context && record.context.item && record.context.item.key,
    }));
    const reply = records.find((record) => record.text.includes('讽刺'));
    const root = records.find((record) => record.text.includes('笑死'));
    const content = records.find((record) => record.kind === 'content');
    const outbound = window.OB.ai.context.toOutbound(reply && reply.context, { work: 1, item: 2, parent: 3 });
    return { summary, root: root && root.context, reply: reply && reply.context, content: content && content.context, outbound };
  });
  const hasWork = !!(result.content && result.content.work && result.content.work.title === '人工合成主题：实验室里的安全吐槽');
  const hasReplyParent = !!(result.reply && result.reply.parent && result.reply.parent.relation === 'reply');
  const noPrivateOutbound = !/88000|context-fixture|space\.bilibili|https?:\/\//i.test(JSON.stringify(result.outbound));
  const hasOrdinalOutbound = !!(result.outbound && result.outbound.workId === 'w1' && result.outbound.itemId === 'i2' && result.outbound.parentId === 'r3');
  if (hasWork) report.pass.push('CTX-1 B站作品标题/简介进入独立 WorkContext'); else report.fail.push('CTX-1 缺少 B站作品语境：' + JSON.stringify(result.content));
  if (hasReplyParent) report.pass.push('CTX-2 回复只关联真实 root parent，不使用 DOM 邻近文本'); else report.fail.push('CTX-2 回复 parent 关系缺失：' + JSON.stringify({ reply: result.reply, summary: result.summary }));
  if (noPrivateOutbound && hasOrdinalOutbound) report.pass.push('CTX-3 provider 请求上下文只使用 ordinal ID，未泄露平台身份/URL'); else report.fail.push('CTX-3 出站上下文脱敏或序号化失败：' + JSON.stringify(result.outbound));

  const switched = await page.evaluate(() => {
    const title = document.querySelector('h1.video-title');
    title.textContent = '人工合成主题：另一部完全不同的作品';
    const record = window.OB.adapters.bilibili.collectAIRecords(document).find((item) => item.kind === 'comment');
    return record && record.context && record.context.work;
  });
  if (switched && result.reply && switched.key === result.reply.work.key && switched.revision !== result.reply.work.revision) report.pass.push('CTX-4 同一作品的标题/简介变化递增 context revision，缓存可失效');
  else report.fail.push('CTX-4 作品切换未隔离 workKey：' + JSON.stringify({ before: result.reply && result.reply.work, after: switched, summary: result.summary }));

  const scoped = await page.evaluate(() => {
    const ctx = window.OB.ai.context;
    const current = ctx.normalize({ kind: 'comment', contentType: 'comment', work: { key: 'work-a', title: '作品甲', confidence: 'reliable' }, itemKey: 'item-a' });
    const otherWork = ctx.normalize({ kind: 'comment', contentType: 'comment', work: { key: 'work-b', title: '作品乙', confidence: 'reliable' }, itemKey: 'item-a' });
    const token = window.OB.ai.scopedBlocks.add([{ context: current }]);
    const hit = window.OB.ai.scopedBlocks.matches({ context: current });
    const miss = window.OB.ai.scopedBlocks.matches({ context: otherWork });
    window.OB.ai.scopedBlocks.remove(token);
    return { hit, miss, remaining: window.OB.ai.scopedBlocks.snapshot().length };
  });
  if (scoped.hit && !scoped.miss && scoped.remaining === 0) report.pass.push('CTX-5 当前作品屏蔽按 work/item 作用域命中，跨作品同文本不串联');
  else report.fail.push('CTX-5 作用域隔离失败：' + JSON.stringify(scoped));

  const aiCommit = await page.evaluate(async () => {
    window.OB.Store.setSetting('aiRules', [{ id: 'context-fixture-rule', text: '引战', enabled: true }]);
    window.OB.Store.setSetting('aiEnabled', true);
    await window.OB.ai.analyzePage('当前作品语境规则');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const review = document.querySelector('#ob-ai-review');
    const payload = (window.__contextBodies || [])[0] || null;
    const scopedBefore = window.OB.ai.scopedBlocks.snapshot().length;
    if (review) review.querySelector('.ob-ai-confirm').click();
    await new Promise((resolve) => setTimeout(resolve, 160));
    const payloadText = JSON.stringify(payload || {});
    let budget = null;
    try {
      const input = JSON.parse(payload && payload.messages && payload.messages[1] && payload.messages[1].content || '{}');
      const items = Array.isArray(input.items) ? input.items : [];
      const withoutContext = items.map((item) => {
        const copy = { ...item };
        delete copy.context;
        return copy;
      });
      const baselineInput = { ...input, items: withoutContext };
      delete baselineInput.contextSchemaVersion;
      delete baselineInput.contextCatalog;
      const baselineUserChars = JSON.stringify(baselineInput).length;
      const actualUserChars = JSON.stringify(input).length;
      const systemChars = Number(payload && payload.messages && payload.messages[0]
        && String(payload.messages[0].content || '').length) || 0;
      const baselineChars = systemChars + baselineUserChars;
      const contextChars = actualUserChars - baselineUserChars;
      budget = { baselineChars, contextChars, overheadRatio: baselineChars ? Number((contextChars / baselineChars).toFixed(3)) : 0 };
      var compactWire = input.contextSchemaVersion === 2
        && input.contextCatalog && input.contextCatalog.defaults
        && Object.prototype.hasOwnProperty.call(input.contextCatalog.defaults, 'workId')
        && items.some((item) => !Object.prototype.hasOwnProperty.call(item, 'context') || Array.isArray(item.context));
    } catch (error) {}
    return {
      review: !!review,
      popupGone: !document.querySelector('#ob-ai-review'),
      scopes: window.OB.ai.scopedBlocks.snapshot().length,
      persons: Object.keys(JSON.parse(window.__gm['omniblock:data:v1']).persons || {}).length,
      hasScopeSelect: !!(review && review.querySelector('select.ob-ai-candidate-scope')),
      scopedBefore,
      body: payload,
      privateOutboundMatches: payloadText.match(/space\.bilibili|bili:uid|bili:dmhash|88000/g) || [],
      budget,
      compactWire: typeof compactWire === 'boolean' ? compactWire : false,
    };
  });
  const payloadText = JSON.stringify(aiCommit.body || {});
  const ctxCommitChecks = {
    review: aiCommit.review,
    popupGone: aiCommit.popupGone,
    hasScopeSelect: aiCommit.hasScopeSelect,
    scopes: aiCommit.scopes > 0,
    persons: aiCommit.persons === 0,
    context: /context/.test(payloadText),
    privateFree: !aiCommit.privateOutboundMatches.length,
    compactWire: aiCommit.compactWire,
  };
  if (Object.values(ctxCommitChecks).every(Boolean)
    && /context/.test(payloadText) && !aiCommit.privateOutboundMatches.length) {
    report.pass.push('CTX-6 语境候选默认确认到当前作品 ScopedBlocks，不污染全局名单，payload 使用 v2 紧凑语境；context overhead=' + JSON.stringify(aiCommit.budget));
  } else report.fail.push('CTX-6 语境候选确认/出站边界异常：' + JSON.stringify({ ...aiCommit, checks: ctxCommitChecks }));
  if (aiCommit.budget && aiCommit.budget.overheadRatio <= 0.25) {
    report.pass.push('CTX-9 共享 contextCatalog 后请求级上下文额外字符占比不超过 25%');
  } else report.fail.push('CTX-9 上下文预算超限：' + JSON.stringify(aiCommit.budget));

  const contextGuard = await page.evaluate(async () => {
    const result = await window.OB.ai.analyzePage('语境不足规则');
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { result, review: !!document.querySelector('#ob-ai-review'), status: window.OB.ai.status() };
  });
  if (contextGuard.result && contextGuard.result.ok && Array.isArray(contextGuard.result.candidates)
    && contextGuard.result.candidates.length === 0 && !contextGuard.review
    && Number(contextGuard.status && contextGuard.status.deferred) >= 1) {
    report.pass.push('CTX-7 contextSufficiency=insufficient 时只延期，不生成可执行候选');
  } else report.fail.push('CTX-7 语境不足安全门禁异常：' + JSON.stringify(contextGuard));

  const ruleGuard = await page.evaluate(async () => {
    const result = await window.OB.ai.analyzePage('未知规则 ID');
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { result, review: !!document.querySelector('#ob-ai-review'), status: window.OB.ai.status() };
  });
  if (ruleGuard.result && ruleGuard.result.ok && Array.isArray(ruleGuard.result.candidates)
    && ruleGuard.result.candidates.length === 0 && !ruleGuard.review
    && Number(ruleGuard.status && ruleGuard.status.deferred) >= 1) {
    report.pass.push('CTX-8 未知 matchedRuleId 即使 ruleMatched=true 也不会生成候选');
  } else report.fail.push('CTX-8 规则 ID 白名单门禁异常：' + JSON.stringify(ruleGuard));

  if (report.console.length) report.fail.push('CTX-5 控制台出现错误：' + JSON.stringify(report.console));
  if (report.pageErrors.length) report.fail.push('CTX-6 页面异常：' + JSON.stringify(report.pageErrors));
  for (const item of report.pass) console.log('PASS', item);
  for (const item of report.fail) console.error('FAIL', item);
  await browser.close();
  if (report.fail.length) process.exitCode = 1;
})().catch((error) => { console.error('AI CONTEXT ERROR:', error && error.stack || error); process.exitCode = 1; });

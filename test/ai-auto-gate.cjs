/* OmniBlock AI 自动分析独立开关（OB-AI-015）与已分析持久缓存/自动批量上限（OB-AI-016）回归测试。
 * 夹具是人工合成 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：默认只手动（页面加载 0 次自动请求）、手动分析不再强制页规则、
 * 自动候选不自动弹窗而是等在「AI 待审建议」浮条、本机用量计数与请求一致，
 * 以及跨重访持久缓存（CACHE-1）、提示词变更使缓存失效（CACHE-INV-1）、
 * 自动模式每页最多 3 批（CAP-1）和「自动分析只看评论」（ONLY-COMMENTS-1）。
 * 运行：node test/ai-auto-gate.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4021/v1/chat/completions';
const SHIM = `
(() => {
  const SEED = {
    'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }),
    'omniblock:data:v1': JSON.stringify({
      version: 1, persons: {}, settings: {
        enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
        showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
        aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
        aiRules: [{ id: 'ai-auto-gate-rule', text: '引战', enabled: true }]
      }
    })
  };
  // GM 存储用 localStorage 做后备：page.reload() 后 __gm 不再被重置，
  // 跨导航持久化（OB-AI-016 的缓存与设置）才有断言前提。
  const LS_KEY = '__ob_ai_gate_gm_v1';
  let store = null;
  try { const raw = window.localStorage.getItem(LS_KEY); store = raw ? JSON.parse(raw) : null; } catch (e) { store = null; }
  if (!store || typeof store !== 'object') store = JSON.parse(JSON.stringify(SEED));
  // ONLY-COMMENTS-1：通过夹具 URL 标记在存储装载前打开「自动分析只看评论」，
  // 避免与首屏自动分析定时器竞争。
  if (/[?&]ob-only-comments=1/.test(location.search)) {
    try {
      const data = JSON.parse(store['omniblock:data:v1'] || '{}');
      data.settings = Object.assign({}, data.settings, { aiAutoAnalyze: true, aiAutoCommentsOnly: true });
      store['omniblock:data:v1'] = JSON.stringify(data);
      window.localStorage.setItem(LS_KEY, JSON.stringify(store));
    } catch (e) {}
  }
  window.__gm = store;
  const persist = () => { try { window.localStorage.setItem(LS_KEY, JSON.stringify(window.__gm)); } catch (e) {} };
  window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
  window.GM_setValue = (k, v) => { window.__gm[k] = v; persist(); };
  window.GM_deleteValue = (k) => { delete window.__gm[k]; persist(); };
})();
window.__aiBodies = [];
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

// CAP-1：260 条互不相同的人工合成评论（唯一文本 + 唯一作者），80 条/批 →
// 4 批；自动模式最多发送 3 批，剩余 20 条等待手动分析。
const FIXTURE_CAP = `<!doctype html><html><head><meta charset="utf-8"><title>AI 自动批量上限人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_cap_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
</div>
<div id="relatedVideoCard"></div>
<script>
  const card = document.getElementById('relatedVideoCard');
  for (let i = 0; i < 260; i++) {
    const row = document.createElement('div');
    row.setAttribute('data-e2e', 'comment-item');
    const link = document.createElement('a');
    link.setAttribute('data-e2e', 'comment-username');
    link.setAttribute('href', '/user/CapFixtureUser' + i);
    link.textContent = '批量上限夹具作者' + i;
    const text = document.createElement('span');
    text.textContent = '自动批量上限夹具评论 ' + String(i).padStart(3, '0') + ' 号：这是一条普通合成内容';
    row.append(link, text);
    card.appendChild(row);
  }
</script>
</body></html>`;

// ONLY-COMMENTS-1：弹幕 + 评论混合；URL 标记让 shim 在装载存储前写入
// aiAutoCommentsOnly=true，自动分析的请求项必须不含任何弹幕。
const FIXTURE_ONLY = `<!doctype html><html><head><meta charset="utf-8"><title>AI 只看评论人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_only_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
  <div data-danmaku-user-id="99001">自动只看评论夹具弹幕甲</div>
  <div data-danmaku-user-id="99002">自动只看评论夹具弹幕乙</div>
</div>
<div id="relatedVideoCard">
  <div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/OnlyFixtureUserA">只看评论夹具作者甲</a><span>自动只看评论夹具：这是一条引战评论</span></div>
  <div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/OnlyFixtureUserB">只看评论夹具作者乙</a><span>自动只看评论夹具：这是一条普通评论</span></div>
</div>
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
      const fixture = url.pathname.endsWith('ai-auto-cap-fixture') ? FIXTURE_CAP
        : url.pathname.endsWith('ai-auto-only-comments-fixture') ? FIXTURE_ONLY : FIXTURE;
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });
  await page.addInitScript({ content: SHIM + '\n' + '\nwindow.__OB_TEST_HOOKS__="omniblock-test-only";\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-auto-gate.cjs' });
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
  await page.waitForFunction(() => ['ready', 'review', 'error'].includes(window.OB.ai.status().state), null, { timeout: 8000 });
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

  // CACHE-1：自动分析成功后重访同一页面（reload），已分析记录不得再次产生
  // provider 请求；持久缓存键只含 ai-item 记录 ID 与时间戳。
  await page.evaluate(() => window.OB.ai.closeReview());
  // 延迟落盘是 2 秒防抖：先等它触发，再读取缓存键，验证 debounce 保存路径。
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const cacheBefore = await page.evaluate(() => ({
    bodies: (window.__aiBodies || []).length,
    cacheRaw: window.__gm['omniblock:ai-analyzed:v1'] || '',
  }));
  if (!cacheBefore.cacheRaw) {
    report.fail.push('CACHE-1 首轮自动分析后持久缓存键不存在（pagehide 冲刷缺失？）');
  } else {
    let cacheShapeOk = true;
    let cacheShapeDetail = '';
    try {
      const parsed = JSON.parse(cacheBefore.cacheRaw);
      const ids = Object.keys(parsed.entries || {});
      const idsOk = ids.length >= 1 && ids.every((id) => /^ai-item-[0-9a-f]{8}$/.test(id));
      const valuesOk = ids.every((id) => Number.isFinite(parsed.entries[id]) && parsed.entries[id] > 0);
      const generationOk = /^[0-9a-f]{8}$/.test(String(parsed.generation || ''));
      const versionOk = parsed.version === 1;
      const noText = !cacheBefore.cacheRaw.includes('引战') && !cacheBefore.cacheRaw.includes('douyin:')
        && !cacheBefore.cacheRaw.includes('自动开关夹具');
      cacheShapeOk = idsOk && valuesOk && generationOk && versionOk && noText;
      if (!cacheShapeOk) cacheShapeDetail = JSON.stringify({ idsOk, valuesOk, generationOk, versionOk, noText, ids: ids.slice(0, 3) });
    } catch (error) { cacheShapeOk = false; cacheShapeDetail = String(error); }
    if (!cacheShapeOk) report.fail.push('CACHE-1 缓存结构或隐私边界异常：' + cacheShapeDetail);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  await page.waitForFunction(() => ['ready', 'review', 'error'].includes(window.OB.ai.status().state), null, { timeout: 12000 });
  const cacheAfter = await page.evaluate(() => ({
    bodies: (window.__aiBodies || []).length,
    status: window.OB.ai.status(),
    pending: window.OB.ai.pendingCount(),
    pill: !!document.querySelector('#ob-ai-pending'),
  }));
  if (cacheAfter.bodies === 0 && cacheAfter.status.autoAnalyze === true
    && cacheAfter.status.state === 'ready' && cacheAfter.status.records >= 1
    && cacheAfter.status.analyzed === cacheAfter.status.records
    && cacheAfter.pending === 0 && !cacheAfter.pill && !cacheAfter.status.lastError) {
    report.pass.push('CACHE-1 重访同页自动分析 0 次新请求，记录不重复计费，状态保持 ready 且无剩余');
  } else {
    report.fail.push('CACHE-1 重访后缓存未生效：' + JSON.stringify({
      before: cacheBefore.bodies, after: cacheAfter.bodies, state: cacheAfter.status.state,
      records: cacheAfter.status.records, analyzed: cacheAfter.status.analyzed,
      autoAnalyze: cacheAfter.status.autoAnalyze, error: cacheAfter.status.lastError,
    }));
  }

  // CACHE-INV-1：修改提示词 profile → 缓存 generation 失效 → 重访后同一记录
  // 重新发送。updateProfile 后立即 reload：pagehide 取消 500ms 的自动重跑
  // 定时器并冲刷被清空的缓存，重访运行的请求项必须再次携带原评论。
  await page.evaluate(() => {
    window.OB.ai.prompt.updateProfile({ blockCriteria: ['持续人身攻击', '引战与拉踩内容'] });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  let resent = null;
  try {
    await page.waitForFunction((before) => (window.__aiBodies || []).length > before, cacheAfter.bodies, { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    resent = await page.evaluate(`(() => {
      const bodies = window.__aiBodies || [];
      const latest = bodies[bodies.length - 1] || {};
      let items = [];
      try {
        const input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}');
        items = Array.isArray(input.items) ? input.items : [];
      } catch (error) {}
      return { count: bodies.length, items, status: window.OB.ai.status() };
    })()`);
  } catch (error) {
    resent = { count: (await page.evaluate(() => (window.__aiBodies || []).length)), items: [], status: await page.evaluate(() => window.OB.ai.status()) };
  }
  if (resent.count > cacheAfter.bodies && resent.items.some((item) => /初始引战评论/.test(String(item && item.text || '')))) {
    report.pass.push('CACHE-INV-1 提示词变更使持久缓存失效，重访后同一记录重新发送');
  } else {
    report.fail.push('CACHE-INV-1 缓存未随提示词变更失效：' + JSON.stringify({
      before: cacheAfter.bodies, after: resent.count,
      items: resent.items.map((item) => String(item && item.text || '').slice(0, 40)),
      state: resent.status.state, error: resent.status.lastError,
    }));
  }

  // CAP-1：260 条合成评论 → 4 批（80×3+20）；自动模式只发 3 批并提示剩余，
  // 随后手动「分析本页」不受上限约束补齐其余 4 批。
  await page.goto('https://www.douyin.com/video/ai-auto-cap-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  let capped = null;
  try {
    await page.waitForFunction(() => Number(window.OB.ai.status().autoCappedRemaining || 0) > 0, null, { timeout: 20000 });
    capped = await page.evaluate(() => ({
      bodies: (window.__aiBodies || []).length,
      status: window.OB.ai.status(),
    }));
  } catch (error) {
    capped = await page.evaluate(() => ({ bodies: (window.__aiBodies || []).length, status: window.OB.ai.status() }));
  }
  const capOk = capped.bodies === 3 && Number(capped.status.autoCappedRemaining) === 20
    && capped.status.state === 'ready' && capped.status.newRecords === 260;
  if (capOk) {
    report.pass.push('CAP-1 自动模式 260 条只发送 3 批（80/批），autoCappedRemaining=20');
  } else {
    report.fail.push('CAP-1 自动批量上限未生效：' + JSON.stringify({
      bodies: capped.bodies, autoCappedRemaining: capped.status.autoCappedRemaining,
      state: capped.status.state, newRecords: capped.status.newRecords, error: capped.status.lastError,
    }));
  }
  // 状态行提示（AI 面板在内容管理器 AI 标签中挂载）。
  await page.evaluate(() => { window.OB.openContentManager(window.OB.adapters.douyin, 'ai'); });
  await page.waitForSelector('#ob-content-manager #ob-ai-status', { timeout: 8000 }).catch(() => {});
  const capStatusText = await page.evaluate(() => {
    const node = document.querySelector('#ob-content-manager #ob-ai-status');
    return node ? node.textContent : '';
  });
  if (capStatusText.includes('已达本页自动分析批量上限（每页最多 3 批），其余 20 条可用「分析本页」手动处理')) {
    report.pass.push('CAP-1 状态行明示自动批量上限与剩余条数的手动处理指引');
  } else {
    report.fail.push('CAP-1 状态行缺少上限提示：' + JSON.stringify({ text: capStatusText.slice(0, 240) }));
  }
  await page.evaluate(() => { window.OB.closeContentManager && window.OB.closeContentManager(); });
  const manualCap = await page.evaluate(async () => {
    const before = (window.__aiBodies || []).length;
    const result = await window.OB.ai.analyzePage('');
    return { before, after: (window.__aiBodies || []).length, result, status: window.OB.ai.status() };
  });
  if (manualCap.result && manualCap.result.ok && manualCap.after - manualCap.before === 4
    && manualCap.after > 3 && Number(manualCap.status.autoCappedRemaining) === 0
    && manualCap.status.analyzed === manualCap.status.records) {
    report.pass.push('CAP-1 手动「分析本页」不受上限约束，4 批补齐剩余记录');
  } else {
    report.fail.push('CAP-1 手动续跑异常：' + JSON.stringify({
      before: manualCap.before, after: manualCap.after, result: manualCap.result,
      remaining: manualCap.status.autoCappedRemaining, analyzed: manualCap.status.analyzed,
      records: manualCap.status.records, error: manualCap.status.lastError,
    }));
  }

  // ONLY-COMMENTS-1：aiAutoCommentsOnly=true 时自动请求项不得包含弹幕。
  await page.goto('https://www.douyin.com/video/ai-auto-only-comments-fixture?ob-only-comments=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  let onlyComments = null;
  try {
    await page.waitForFunction(() => (window.__aiBodies || []).length > 0, null, { timeout: 12000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    onlyComments = await page.evaluate(() => {
      const bodies = window.__aiBodies || [];
      const items = bodies.flatMap((body) => {
        try {
          const input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}');
          return Array.isArray(input.items) ? input.items : [];
        } catch (error) { return []; }
      });
      return {
        bodies: bodies.length,
        items,
        raw: JSON.stringify(bodies),
        status: window.OB.ai.status(),
      };
    });
  } catch (error) {
    onlyComments = await page.evaluate(() => ({ bodies: (window.__aiBodies || []).length, items: [], raw: '[]', status: window.OB.ai.status() }));
  }
  const hasComment = onlyComments.items.some((item) => item && item.kind === 'comment' && /引战评论/.test(String(item.text || '')));
  const noDanmaku = onlyComments.items.length > 0 && onlyComments.items.every((item) => item && item.kind !== 'danmaku')
    && !onlyComments.raw.includes('只看评论夹具弹幕');
  if (onlyComments.bodies >= 1 && hasComment && noDanmaku) {
    report.pass.push('ONLY-COMMENTS-1 自动分析只发送评论（含引战评论），请求项 0 条弹幕');
  } else {
    report.fail.push('ONLY-COMMENTS-1 只看评论开关未生效：' + JSON.stringify({
      bodies: onlyComments.bodies,
      kinds: onlyComments.items.map((item) => item && item.kind),
      state: onlyComments.status.state, error: onlyComments.status.lastError,
      commentsOnly: onlyComments.status.commentsOnly,
    }));
  }

  await browser.close();
  console.log('==== OmniBlock AI 自动开关回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

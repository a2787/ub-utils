/* OmniBlock 抖音一键加载与 AI 分析回归测试。
 * 夹具是人工合成 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：一次调用依次编排评论/弹幕加载、把加载后的记录全部交给 AI、审核态保持，
 * 以及用户取消时 AbortSignal 能终止加载且不发起新的 AI 请求。
 * 运行：node test/ai-autoload.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';
const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: false, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
    aiRules: [{ id: 'ai-autoload-rule', text: '引战', enabled: true }]
  }
}) };
window.__aiBodies = [];
window.__autoloadCalls = [];
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

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>抖音 AI 自动加载人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_autoload_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
  <div class="danmu"><div data-danmu-id="initial-dm" data-danmaku-user-id="1001"><div class="danMuText">初始引战弹幕</div></div></div>
</div>
<div id="relatedVideoCard"><div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/CommentInitial">初始评论作者</a><span>初始引战评论</span></div></div>
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
            .map((item) => ({ id: item.id, decision: 'block', confidence: 0.9, reason: '命中自动加载回归规则' })),
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
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-autoload.cjs' });
  await page.goto('https://www.douyin.com/video/ai-autoload-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });

  await page.evaluate(() => {
    const adapter = window.OB.adapters.douyin;
    window.__autoloadCalls.length = 0;
    adapter.commentManager.loadAll = async (onProgress, options) => {
      window.__autoloadCalls.push('comments');
      if (options && options.signal && options.signal.aborted) throw new DOMException('aborted', 'AbortError');
      onProgress({ phase: 'expand', collected: 1 });
      const panel = document.querySelector('#relatedVideoCard');
      panel.insertAdjacentHTML('beforeend', '<div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/CommentLoaded">后加载评论作者</a><span>后加载引战评论</span></div>');
      onProgress({ phase: 'scroll', collected: 2 });
      return { records: adapter.commentManager.collectRecords(), partial: true, reason: 'synthetic' };
    };
    adapter.loadDanmakuTimeline = async (onProgress, options) => {
      window.__autoloadCalls.push('danmaku');
      if (options && options.signal && options.signal.aborted) throw new DOMException('aborted', 'AbortError');
      onProgress({ phase: 'danmaku', completed: 0, sampleCount: 2, collected: 1 });
      document.querySelector('.danmu').insertAdjacentHTML('beforeend', '<div data-danmu-id="loaded-dm" data-danmaku-user-id="1002"><div class="danMuText">后加载引战弹幕</div></div>');
      onProgress({ phase: 'danmaku', completed: 2, sampleCount: 2, collected: 2 });
      return { supported: true, completed: 2, sampleCount: 2, cancelled: false };
    };
    window.OB.Store.setSetting('aiEnabled', true);
  });

  const result = await page.evaluate(() => window.OB.ai.loadAndAnalyzePage('本页屏蔽引战内容'));
  const first = await page.evaluate((result) => {
    const review = document.querySelector('#ob-ai-review');
    const body = (window.__aiBodies || [])[0] || {};
    let items = [];
    try { items = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}').items || []; } catch (error) {}
    return {
      calls: window.__autoloadCalls,
      result,
      status: window.OB.ai.status(),
      review: !!review,
      candidateCount: review ? review.querySelectorAll('.ob-ai-candidate').length : 0,
      items: items.map((item) => item.text),
      bodyCount: (window.__aiBodies || []).length,
    };
  }, result);
  if (first.result && first.result.ok && first.calls.join(',') === 'comments,danmaku'
    && first.review && first.status.source === 'douyin-autoload'
    && first.status.records === 4 && first.status.analyzed === 4
    && first.candidateCount === 4 && first.items.length === 4
    && first.items.some((text) => /后加载评论/.test(text))
    && first.items.some((text) => /后加载引战弹幕/.test(text))) {
    report.pass.push('AUTO-AI-1 一次调用依次加载抖音评论/弹幕，并把后加载的 4 条实际记录全部分析后进入审核');
  } else report.fail.push('AUTO-AI-1 一键编排结果异常：' + JSON.stringify(first));

  await page.evaluate(() => window.OB.ai.closeReview());
  const classMutationRun = await page.evaluate(async () => {
    const adapter = window.OB.adapters.douyin;
    let finished = false;
    adapter.commentManager.loadAll = (onProgress, options) => new Promise((resolve, reject) => {
      const signal = options && options.signal;
      const root = document.querySelector('#dy-player');
      let tick = 0;
      const timer = setInterval(() => {
        if (signal && signal.aborted) return;
        root.classList.toggle('xgplayer-playing', tick++ % 2 === 0);
        onProgress({ phase: 'scroll', collected: 2 });
        if (tick >= 4) {
          clearInterval(timer);
          finished = true;
          resolve({ records: adapter.commentManager.collectRecords(), partial: true, reason: 'synthetic-class-mutation' });
        }
      }, 35);
      if (signal) signal.addEventListener('abort', () => { clearInterval(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
    const result = await window.OB.ai.loadAndAnalyzePage('播放器状态变化不应取消自动加载');
    return { result, finished, status: window.OB.ai.status(), bodies: (window.__aiBodies || []).length };
  });
  if (classMutationRun.result && classMutationRun.result.ok && classMutationRun.finished
    && classMutationRun.status.source === 'douyin-autoload' && classMutationRun.status.state === 'review'
    && classMutationRun.status.records >= 2) {
    report.pass.push('AUTO-AI-2 播放器状态 class 变化不会误取消抖音自动加载与后续分析');
  } else report.fail.push('AUTO-AI-2 播放器状态变化误取消自动加载：' + JSON.stringify(classMutationRun));

  await page.evaluate(() => window.OB.ai.closeReview());
  const beforeCancel = await page.evaluate(() => (window.__aiBodies || []).length);
  const cancellation = await page.evaluate(async () => {
    const adapter = window.OB.adapters.douyin;
    let aborted = false;
    adapter.commentManager.loadAll = (onProgress, options) => new Promise((resolve, reject) => {
      onProgress({ phase: 'expand', collected: 0 });
      const signal = options && options.signal;
      const onAbort = () => { aborted = true; const error = new DOMException('aborted', 'AbortError'); reject(error); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      setTimeout(() => { if (!aborted) resolve({ records: [], partial: true, reason: 'late' }); }, 1200);
    });
    const pending = window.OB.ai.loadAndAnalyzePage('取消这次自动加载');
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.OB.ai.cancel('test-cancel');
    const result = await pending;
    return { result, aborted, status: window.OB.ai.status(), bodyCount: (window.__aiBodies || []).length };
  });
  if (cancellation.result && !cancellation.result.ok && /取消/.test(cancellation.result.error || '')
    && cancellation.aborted && cancellation.status.state === 'idle' && cancellation.bodyCount === beforeCancel) {
    report.pass.push('AUTO-AI-3 取消自动加载会终止 AbortSignal，不启动弹幕阶段且不发起新的 AI 请求');
  } else report.fail.push('AUTO-AI-3 取消收尾异常：' + JSON.stringify(cancellation));

  await browser.close();
  console.log('==== OmniBlock 抖音一键 AI 回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

/* OmniBlock 内容弹窗、关键词优先级和五平台 AI 提醒回归。
 * 夹具说明：B站/抖音/微博/知乎/贴吧 DOM 均为人工合成，选择器只复用仓库已有的
 * 当前捕获契约；不访问真实平台或真实模型，provider 由 Playwright 模拟。
 * 覆盖：B站/抖音评论关键词即时屏蔽且不请求 AI、关键词标签迁移、微博/知乎/贴吧
 * 评论 AI 采集与统一提醒弹窗、详情路由空评论入口，以及知乎没有未经验证的全量加载入口。
 * 运行：node test/content-ai.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
    aiRules: [{ id: 'ai-content-fixture', text: '命中目标', enabled: true }],
    biliDanmakuRules: [{ id: 'bili-keyword-fixture', kind: 'keyword', pattern: '目标', enabled: true }],
    douyinDanmakuRules: [{ id: 'douyin-keyword-fixture', kind: 'keyword', pattern: '目标', enabled: true }]
  }
}) };
window.__writes = 0;
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; if (k === 'omniblock:data:v1') window.__writes++; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.__aiBodies = [];
window.__gmError = '';
window.GM_xmlhttpRequest = (opts) => {
  try { window.__aiBodies.push(JSON.parse(opts.data || '{}')); } catch (error) {}
  if (window.__gmError) {
    const message = String(window.__gmError);
    setTimeout(() => { if (opts.onerror) opts.onerror(new Error(message)); }, 0);
    return { abort() {} };
  }
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

const BILI_FIXTURE = `<!doctype html><html><body><bili-comments id="comments"></bili-comments><script>
const comments = document.getElementById('comments');
const shadow = comments.attachShadow({ mode:'open' });
const row = document.createElement('bili-comment-renderer');
row.__data = { mid:'4400', member:{ mid:'4400', uname:'B站关键词作者' } };
const rowShadow = row.attachShadow({ mode:'open' });
const link = document.createElement('a'); link.className='user-name'; link.href='https://space.bilibili.com/4400'; link.textContent='B站关键词作者';
const body = document.createElement('span'); body.className='text'; body.textContent='目标 B站评论';
rowShadow.append(link, body); shadow.appendChild(row);
</script></body></html>`;

const DOUYIN_FIXTURE = `<!doctype html><html><body>
<div class="basePlayerContainer video_1111111111111111111" data-e2e="video-player"><a data-e2e="video-avatar" href="/user/AuthorSec">作者</a></div>
<div data-e2e="comment-item" id="dy-target"><a data-e2e="comment-username" href="/user/TargetSec">抖音关键词作者</a><span>目标 抖音评论</span></div>
<div data-e2e="comment-item" id="dy-keep"><a data-e2e="comment-username" href="/user/KeepSec">抖音普通作者</a><span>普通抖音评论</span></div>
</body></html>`;

const WEIBO_FIXTURE = `<!doctype html><html><body>
<div class="wbpro-list"><div class="item1" comment_id="root-fixture"><div class="item1in"><div class="con1"><div class="text"><a class="name" href="/u/550001">微博目标作者</a><span>目标 微博评论</span></div></div></div><div class="list2"><div class="item2" comment_id="reply-fixture"><div class="con2"><div class="text"><a href="/u/550002">微博普通作者</a><span>普通微博评论</span></div></div></div></div></div></div>
</body></html>`;

const ZHIHU_FIXTURE = `<!doctype html><html><body>
<div class="comment-row"><div class="avatar-col"><a href="/people/660001">知乎目标作者</a></div><div class="content-col"><div class="comment-head"><a href="/people/660001">知乎目标作者</a></div><div class="CommentContent css-captured">目标 知乎评论正文</div><div class="comment-actions"><button>赞同</button><button>回复</button><button>举报</button></div></div></div>
</body></html>`;

const TIEBA_FIXTURE = `<!doctype html><html><body>
<div class="pb-comment-item" id="tieba-target"><div class="head-line user-info"><a class="head-name" href="/home/main?id=opaque-portrait">贴吧目标作者</a></div><div class="comment-content">目标 贴吧评论正文</div><div class="comment-actions"><button>回复</button><button>举报</button><button>拉黑</button></div><script>document.currentScript.parentElement.__vue__ = { userInfo: { id: 770001, name: 'tieba-target', name_show: '贴吧目标作者' } };</script></div>
</body></html>`;

const EMPTY_ZHIHU_FIXTURE = `<!doctype html><html><body><main><h1>人工合成知乎问题详情</h1><div>评论尚未展开</div></main></body></html>`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function installPage(browser, url, fixture) {
  const page = await browser.newPage();
  await page.route('**/*', async (route) => {
    if (route.request().url() === PROVIDER_URL) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      const items = Array.isArray(input.items) ? input.items : [];
      const response = {
        choices: [{ message: { content: JSON.stringify({
          items: items.filter((item) => String(item && item.text || '').includes('目标')).map((item) => ({
            id: item.id, decision: 'block', confidence: 0.95, reason: '人工合成目标规则',
          })),
        }) } }],
      };
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(response) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
  });
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-content-ai-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-content-ai.cjs' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && document.querySelector('#ob-gear')), null, { timeout: 8000 });
  return page;
}

async function openContent(page, adapterId, tab) {
  await page.evaluate(({ adapterId, tab }) => {
    window.OB.openContentManager(window.OB.adapters[adapterId], tab);
  }, { adapterId, tab });
  await page.waitForSelector('#ob-content-manager');
  await sleep(100);
}

(async () => {
  const report = { pass: [], fail: [], pageErrors: [], console: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const bili = await installPage(browser, 'https://www.bilibili.com/video/content-rule-fixture', BILI_FIXTURE);
    bili.on('pageerror', (error) => report.pageErrors.push('bili: ' + String(error)));
    await sleep(1100);
    const biliState = await bili.evaluate(() => {
      const row = document.querySelector('bili-comments')?.shadowRoot?.querySelector('bili-comment-renderer');
      return {
        blocked: window.OB.Index.isBlocked('bili:uid:4400'),
        hidden: !!row && (row.getAttribute('data-ob-blocked') === '1' || row.hasAttribute('data-ob-auto-blocked')),
        aiBodies: (window.__aiBodies || []).length,
      };
    });
    if (biliState.blocked && biliState.hidden && biliState.aiBodies === 0) report.pass.push('CR-1 B站评论关键词命中后立即屏蔽可靠作者，不消耗 AI 请求');
    else report.fail.push('CR-1 B站评论关键词优先级异常：' + JSON.stringify(biliState));
    const biliUi = await bili.evaluate(async () => {
      window.OB.openOptions();
      const settings = document.querySelector('#ob-panel');
      const settingsRules = settings ? settings.querySelectorAll('.ob-auto-platform').length : -1;
      const migration = settings && /关键词.*内容屏蔽/.test(settings.textContent || '');
      window.OB.openOptions();
      window.OB.openContentManager(window.OB.adapters.bilibili, 'keywords');
      await new Promise((resolve) => setTimeout(resolve, 80));
      const content = document.querySelector('#ob-content-manager');
      const keywordPane = content && content.querySelector('[data-ob-content-pane="keywords"]');
      const tabs = content ? Array.from(content.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [];
      return {
        settingsRules, migration, tabs,
        keywordPane: !!keywordPane,
        keywordRows: keywordPane ? keywordPane.querySelectorAll('.ob-auto-rule').length : 0,
        keywordIntro: keywordPane && /不消耗 token/.test(keywordPane.textContent || ''),
      };
    });
    if (biliUi.settingsRules === 0 && biliUi.migration && biliUi.tabs.length === 4
      && biliUi.tabs.includes('关键词屏蔽') && biliUi.keywordPane && biliUi.keywordRows === 1 && biliUi.keywordIntro)
      report.pass.push('CR-2 B站设置页只保留迁移说明，内容弹窗新增关键词屏蔽标签并展示旧规则');
    else report.fail.push('CR-2 B站关键词入口迁移异常：' + JSON.stringify(biliUi));
    await bili.close();

    const douyin = await installPage(browser, 'https://www.douyin.com/video/content-rule-fixture', DOUYIN_FIXTURE);
    await sleep(900);
    const douyinState = await douyin.evaluate(() => ({
      blocked: window.OB.Index.isBlocked('douyin:secuid:TargetSec'),
      targetHidden: (() => { const node = document.querySelector('#dy-target'); return !!node && (node.getAttribute('data-ob-blocked') === '1' || node.getAttribute('data-ob-auto-dm-blocked') === '1'); })(),
      keepBlocked: window.OB.Index.isBlocked('douyin:secuid:KeepSec'),
      aiBodies: (window.__aiBodies || []).length,
    }));
    if (douyinState.blocked && douyinState.targetHidden && !douyinState.keepBlocked)
      report.pass.push('CR-3 抖音评论关键词默认即时屏蔽且不把普通作者误加入名单');
    else report.fail.push('CR-3 抖音评论关键词优先级异常：' + JSON.stringify(douyinState));
    const douyinUi = await douyin.evaluate(async () => {
      window.OB.openContentManager(window.OB.adapters.douyin, 'keywords');
      await new Promise((resolve) => setTimeout(resolve, 80));
      const root = document.querySelector('#ob-content-manager');
      return {
        tabs: root ? Array.from(root.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [],
        rows: root ? root.querySelectorAll('[data-ob-content-pane="keywords"] .ob-auto-rule').length : 0,
      };
    });
    if (douyinUi.tabs.length === 4 && douyinUi.tabs.includes('关键词屏蔽') && douyinUi.rows === 1)
      report.pass.push('CR-4 抖音内容弹窗新增关键词屏蔽标签并保留旧规则');
    else report.fail.push('CR-4 抖音关键词面板异常：' + JSON.stringify(douyinUi));
    await douyin.close();

    const weibo = await installPage(browser, 'https://weibo.com/fixture/status/fixture#comment', WEIBO_FIXTURE);
    await sleep(2300);
    const weiboState = await weibo.evaluate(() => {
      const latest = (window.__aiBodies || [])[window.__aiBodies.length - 1] || {};
      let input = {};
      try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
      return {
        records: window.OB.adapters.weibo.collectAIRecords(document).length,
        requestCount: (window.__aiBodies || []).length,
        items: input.items || [],
        review: !!document.querySelector('#ob-ai-review'),
      };
    });
    if (weiboState.records === 2 && weiboState.requestCount >= 1 && weiboState.review
      && weiboState.items.length === 2 && weiboState.items.every((item) => !/weibo:uid|keys|uid/i.test(JSON.stringify(item))))
      report.pass.push('CR-5 微博当前可靠评论进入 AI 采集和自动建议审核，出站请求不含身份键');
    else report.fail.push('CR-5 微博评论 AI 提醒异常：' + JSON.stringify(weiboState));
    const weiboUi = await weibo.evaluate(async () => {
      window.OB.ai.closeReview();
      window.OB.openContentManager(window.OB.adapters.weibo, 'ai');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const root = document.querySelector('#ob-content-manager');
      const contentFab = document.querySelector('[data-ob-content-tool="1"]');
      return {
        tabs: root ? Array.from(root.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [],
        aiSurface: !!(root && root.querySelector('[data-ob-content-pane="ai"] [data-ob-ai-surface]')),
        keywordTab: !!(root && root.querySelector('[data-ob-content-tab="keywords"]')),
        contentFabRight: !!contentFab && contentFab.style.right === '14px' && contentFab.style.left === 'auto'
          && contentFab.style.bottom === '62px',
      };
    });
    if (weiboUi.tabs.length === 2 && weiboUi.tabs.includes('屏蔽评论') && weiboUi.tabs.includes('AI 屏蔽')
      && weiboUi.aiSurface && !weiboUi.keywordTab && weiboUi.contentFabRight) report.pass.push('CR-6 微博使用右下统一评论/AI 内容弹窗，不增加不适用的关键词或弹幕标签');
    else report.fail.push('CR-6 微博统一内容弹窗异常：' + JSON.stringify(weiboUi));
    const weiboError = await weibo.evaluate(async () => {
      window.__gmError = 'request-not-allowed';
      let result = null;
      try { result = await window.OB.ai.analyzePage('人工合成错误路径'); }
      finally { window.__gmError = ''; }
      const status = window.OB.ai.status();
      const statusText = document.querySelector('#ob-ai-status')?.textContent || '';
      return { result, lastError: status.lastError, statusText };
    });
    if (weiboError.result && weiboError.result.ok === false
      && weiboError.lastError === 'AI 请求被浏览器扩展拒绝（request-not-allowed）'
      && /扩展桥已就绪，但 AI 请求体未通过桥接协议校验/.test(weiboError.statusText)
      && !/请检查本地网关和浏览器扩展桥接/.test(weiboError.statusText))
      report.pass.push('CR-6A 桥接拒绝错误保留可诊断原因，不再显示泛化传输/桥接提示');
    else report.fail.push('CR-6A 桥接拒绝错误提示异常：' + JSON.stringify(weiboError));
    await weibo.close();

    const zhihu = await installPage(browser, 'https://www.zhihu.com/question/1', ZHIHU_FIXTURE);
    await sleep(2300);
    const zhihuState = await zhihu.evaluate(() => {
      const adapter = window.OB.adapters.zhihu;
      const records = adapter.collectAIRecords(document);
      const latest = (window.__aiBodies || [])[window.__aiBodies.length - 1] || {};
      let input = {};
      try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
      return {
        records: records.map((record) => ({ text: record.text, keys: record.keys })),
        requestCount: (window.__aiBodies || []).length,
        items: input.items || [],
        review: !!document.querySelector('#ob-ai-review'),
      };
    });
    if (zhihuState.records.length === 1 && /目标 知乎评论正文/.test(zhihuState.records[0].text)
      && zhihuState.requestCount >= 1 && zhihuState.review && zhihuState.items.length === 1
      && !/赞同|回复|举报/.test(zhihuState.items[0].text || ''))
      report.pass.push('CR-7 知乎复用 CommentContent 正文层进入 AI 提醒，操作按钮文字未进入请求');
    else report.fail.push('CR-7 知乎评论 AI 正文/提醒异常：' + JSON.stringify(zhihuState));
    const zhihuUi = await zhihu.evaluate(async () => {
      window.OB.ai.closeReview();
      window.OB.openContentManager(window.OB.adapters.zhihu, 'comments');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const root = document.querySelector('#ob-content-manager');
      const panel = root && root.querySelector('#ob-comment-manager');
      const loadAll = panel && panel.querySelector('.ob-cm-load-all');
      return {
        tabs: root ? Array.from(root.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [],
        aiTab: !!(root && root.querySelector('[data-ob-content-tab="ai"]')),
        rows: panel ? panel.querySelectorAll('.ob-cm-row').length : 0,
        fullLoadHidden: !!loadAll && getComputedStyle(loadAll).display === 'none',
      };
    });
    if (zhihuUi.tabs.length === 2 && zhihuUi.tabs.includes('屏蔽评论') && zhihuUi.aiTab
      && zhihuUi.rows === 1 && zhihuUi.fullLoadHidden) report.pass.push('CR-8 知乎统一弹窗显示评论/AI，评论管理器不提供未经验证的全量加载');
    else report.fail.push('CR-8 知乎统一内容弹窗异常：' + JSON.stringify(zhihuUi));
    await zhihu.close();

    const zhihuEmpty = await installPage(browser, 'https://www.zhihu.com/question/2', EMPTY_ZHIHU_FIXTURE);
    await sleep(900);
    const zhihuEmptyUi = await zhihuEmpty.evaluate(async () => {
      const gear = document.querySelector('#ob-gear');
      if (gear) gear.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const fab = document.querySelector('[data-ob-content-tool="1"]');
      window.OB.openContentManager(window.OB.adapters.zhihu, 'comments');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const root = document.querySelector('#ob-content-manager');
      return {
        fab: !!fab,
        fabRight: !!fab && fab.style.right === '14px' && fab.style.left === 'auto' && fab.style.bottom === '62px',
        tabs: root ? Array.from(root.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [],
        emptyCommentPanel: !!(root && root.querySelector('#ob-comment-manager')),
      };
    });
    if (zhihuEmptyUi.fab && zhihuEmptyUi.fabRight && zhihuEmptyUi.tabs.length === 2
      && zhihuEmptyUi.tabs.includes('屏蔽评论') && zhihuEmptyUi.tabs.includes('AI 屏蔽')
      && zhihuEmptyUi.emptyCommentPanel) report.pass.push('CR-9 知乎详情评论尚未展开时仍显示右下内容入口，并保留空评论管理器与 AI 标签');
    else report.fail.push('CR-9 知乎空评论详情入口异常：' + JSON.stringify(zhihuEmptyUi));
    await zhihuEmpty.close();

    const tieba = await installPage(browser, 'https://tieba.baidu.com/p/1', TIEBA_FIXTURE);
    await sleep(2300);
    const tiebaState = await tieba.evaluate(() => {
      const adapter = window.OB.adapters.tieba;
      const records = adapter.collectAIRecords(document);
      const latest = (window.__aiBodies || [])[window.__aiBodies.length - 1] || {};
      let input = {};
      try { input = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}'); } catch (error) {}
      return {
        records: records.map((record) => ({ text: record.text, keys: record.keys, level: record.level })),
        requestCount: (window.__aiBodies || []).length,
        items: input.items || [],
        review: !!document.querySelector('#ob-ai-review'),
      };
    });
    if (tiebaState.records.length === 1 && tiebaState.records[0].keys.includes('tieba:uid:770001')
      && /目标 贴吧评论正文/.test(tiebaState.records[0].text)
      && !/回复|举报|拉黑/.test(tiebaState.records[0].text)
      && tiebaState.requestCount >= 1 && tiebaState.review && tiebaState.items.length === 1)
      report.pass.push('CR-10 贴吧现代评论正文进入 AI 提醒，Vue 数字 UID 可执行且操作文字未进入请求');
    else report.fail.push('CR-10 贴吧评论 AI 采集/提醒异常：' + JSON.stringify(tiebaState));
    const tiebaUi = await tieba.evaluate(async () => {
      window.OB.ai.closeReview();
      window.OB.openContentManager(window.OB.adapters.tieba, 'ai');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const aiRoot = document.querySelector('#ob-content-manager');
      const aiSurface = !!(aiRoot && aiRoot.querySelector('[data-ob-content-pane="ai"] [data-ob-ai-surface]'));
      window.OB.openContentManager(window.OB.adapters.tieba, 'comments');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const root = document.querySelector('#ob-content-manager');
      return {
        tabs: root ? Array.from(root.querySelectorAll('[data-ob-content-tab]')).map((node) => node.textContent.trim()) : [],
        aiSurface,
        commentRows: root ? root.querySelectorAll('[data-ob-content-pane="comments"] .ob-cm-row').length : 0,
        fabRight: (() => { const fab = document.querySelector('[data-ob-content-tool="1"]'); return !!fab && fab.style.right === '14px' && fab.style.left === 'auto' && fab.style.bottom === '62px'; })(),
      };
    });
    if (tiebaUi.tabs.length === 2 && tiebaUi.tabs.includes('屏蔽评论') && tiebaUi.tabs.includes('AI 屏蔽')
      && tiebaUi.aiSurface && tiebaUi.commentRows === 1 && tiebaUi.fabRight)
      report.pass.push('CR-11 贴吧内容弹窗统一显示右下评论/AI 两标签，并挂载评论管理器');
    else report.fail.push('CR-11 贴吧统一内容弹窗异常：' + JSON.stringify(tiebaUi));
    await tieba.close();
  } finally {
    await browser.close();
  }
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('CONTENT AI TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

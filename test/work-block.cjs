/*
 * OmniBlock 作品级屏蔽回归。
 *
 * 所有页面和身份均为人工合成夹具；它验证公共确认/一次事务/撤销协议与三个
 * 适配器的作用域边界，不代表三个平台的真实站点验收。真实站点证据由只读探针
 * 和用户自己的专用浏览器复核提供。
 * 运行：node test/work-block.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

function shim(extra = '') {
  return `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true, logEnabled:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; window.__writes = (window.__writes || 0) + 1; if (k === 'omniblock:data:v1') window.__mainWrites = (window.__mainWrites || 0) + 1; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
${extra}
`;
}

const cases = [
  {
    id: 'douyin',
    url: 'https://www.douyin.com/video/synthetic-work',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div class="basePlayerContainer" data-e2e-vid="synthetic-video">
        <a data-e2e="video-avatar" href="/user/MS4wLjABAAWorkAuthor">抖音作品作者</a>
        <div class="danmu"><div data-danmu-id="synthetic-dm" data-danmaku-user-id="700001"><div class="danMuText">抖音人工合成弹幕</div></div></div>
      </div>
      <div data-e2e="comment-item" data-comment-id="dy-root"><a data-e2e="comment-username" href="/user/MS4wLjABAAComment">抖音主评论作者</a><div class="comment-item" data-comment-id="dy-reply"><a data-e2e="comment-username" href="/user/MS4wLjABAAReply">抖音子评论作者</a></div></div>
    </body></html>`,
    expected: ['douyin:secuid:MS4wLjABAAWorkAuthor', 'douyin:secuid:MS4wLjABAAComment', 'douyin:secuid:MS4wLjABAAReply', 'douyin:uid:700001'],
    outside: [],
  },
  {
    id: 'weibo',
    url: 'https://weibo.com/synthetic-work',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <article class="woo-panel-main" data-id="synthetic-post-a">
        <header><a href="/u/110001" usercard="110001" nick-name="微博作品作者甲">微博作品作者甲</a></header>
        <div class="wbpro-list"><div class="item1">
          <div class="item1in"><div class="con1"><div class="text"><a href="/u/110002" usercard="110002">微博主评论作者甲</a><span>人工合成正文</span></div><div class="info"><div class="opt"></div></div></div></div>
          <div class="list2"><div class="item2"><div class="con2"><div class="text"><a href="/u/110003" usercard="110003">微博子评论作者甲</a><span>人工合成回复</span></div><div class="info"><div class="opt"></div></div></div></div></div>
        </div></div>
      </article>
      <article class="woo-panel-main" data-id="synthetic-post-b">
        <header><a href="/u/120001" usercard="120001" nick-name="微博作品作者乙">微博作品作者乙</a></header>
        <div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/120002" usercard="120002">微博主评论作者乙</a></div><div class="info"><div class="opt"></div></div></div></div></div></div>
      </article>
    </body></html>`,
    expected: ['weibo:uid:110001', 'weibo:uid:110002', 'weibo:uid:110003'],
    outside: ['weibo:uid:120001', 'weibo:uid:120002'],
  },
  {
    id: 'bilibili',
    url: 'https://www.bilibili.com/opus/12345678901234567890',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div class="opus-module-author"><div class="opus-module-author__center"><div class="opus-module-author__name">B站动态视频作者</div></div></div>
      <div class="opus-video"><video></video></div>
      <bili-comments>
        <bili-comment-renderer data-comment-id="bili-root" data-mid="130002"><span class="user-name">B站主评论作者</span></bili-comment-renderer>
        <bili-comment-reply-renderer data-comment-id="bili-reply" data-mid="130003"><span class="user-name">B站子评论作者</span></bili-comment-reply-renderer>
      </bili-comments>
    </body></html>`,
    init: `window.__INITIAL_STATE__ = { detail:{ module_author:{ mid:'130001', name:'B站动态视频作者' } } };`,
    expected: ['bili:uid:130001', 'bili:uid:130002', 'bili:uid:130003'],
    outside: [],
  },
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCase(browser, item, report) {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + item.id + ' ' + message.type() + '] ' + message.text());
  });
  page.on('pageerror', (error) => report.pageErrors.push('[' + item.id + '] ' + String(error)));
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: item.body }));
  await page.addInitScript({ content: shim(item.init || '') + '\n' + userscript });
  await page.goto(item.url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      href: location.href,
      readyState: document.readyState,
      body: !!document.body,
      runtimeGuard: window.__OB_RUNTIME_GUARD__ || null,
      ob: !!window.OB,
      adapterKeys: window.OB && Object.keys(window.OB.adapters || {}),
      scripts: document.scripts.length,
    })).catch(() => null);
    return { fatal: 'OB_INIT_TIMEOUT', diagnostic, error: String(error) };
  }
  try {
    await page.waitForFunction(() => !!document.querySelector('.ob-work-block'), null, { timeout: 8000 });
  } catch (error) {
    return { fatal: 'WORK_BUTTON_TIMEOUT', diagnostic: await page.evaluate(() => ({
      href: location.href,
      body: !!document.body,
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      ob: !!window.OB,
      adapterKeys: window.OB && Object.keys(window.OB.adapters || {}),
      workButtons: document.querySelectorAll('.ob-work-block').length,
      candidateDebug: (() => {
        const adapter = window.OB && Object.values(window.OB.adapters || {}).find((candidate) => {
          try { return candidate && candidate.match && candidate.match(location); } catch (error) { return false; }
        });
        try {
          const candidates = adapter && adapter.workScope && adapter.workScope.list ? adapter.workScope.list() : [];
          return { count: candidates.length, items: candidates.map((candidate) => ({
            key: candidate && candidate.key,
            scope: !!(candidate && candidate.scope),
            scopeConnected: !!(candidate && candidate.scope && candidate.scope.isConnected),
            anchor: !!(candidate && candidate.anchor),
            anchorConnected: !!(candidate && candidate.anchor && candidate.anchor.isConnected),
            keys: candidate && candidate.creator && candidate.creator.keys,
          })) };
        } catch (error) { return { error: String(error) }; }
      })(),
      runtimeGuard: window.__OB_RUNTIME_GUARD__ || null,
    })).catch(() => null), error: String(error) };
  }
  const state = await page.evaluate(async ({ id, expected, outside }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const buttons = Array.from(document.querySelectorAll('.ob-work-block'));
    const beforeWrites = window.__writes || 0;
    const beforeMainWrites = window.__mainWrites || 0;
    if (!buttons.length) return { buttons: 0 };
    const adapter = window.OB.adapters[id];
    const candidates = adapter && adapter.workScope && adapter.workScope.list ? adapter.workScope.list() : [];
    const raw = candidates[0] && adapter.workScope.collect ? adapter.workScope.collect(candidates[0]) : {};
    const recordDebug = (raw.records || []).map((record) => ({ keys: record.keys, level: record.level, workSection: record.workSection, source: record.source }));
    buttons[0].click();
    await wait(120);
    const confirm = document.getElementById('ob-work-confirm');
    if (!confirm) return { buttons: buttons.length, confirm: false, recordDebug };
    const confirmText = confirm.textContent || '';
    const countText = confirm.querySelector('.ob-work-counts') && confirm.querySelector('.ob-work-counts').textContent || '';
    const ok = confirm.querySelector('.ob-work-ok');
    if (!ok || ok.disabled) return { buttons: buttons.length, confirm: true, confirmText, countText, ok: false, recordDebug };
    ok.click();
    await wait(180);
    const blocked = expected.every((key) => window.OB.Index.isBlocked(key));
    const untouched = outside.every((key) => !window.OB.Index.isBlocked(key));
    const writesAfterCommit = window.__writes || 0;
    const mainWritesAfterCommit = window.__mainWrites || 0;
    const toast = document.getElementById('ob-toast');
    const toastText = toast && toast.textContent || '';
    const undo = toast && toast.querySelector('button');
    if (undo) { undo.click(); await wait(180); }
    const mainWritesAfterUndo = window.__mainWrites || 0;
    const restored = expected.every((key) => !window.OB.Index.isBlocked(key));
    const loggedTypes = new Set(window.OB.logs.eventsForDay(window.OB.logs.days()[0]).map((event) => event.type));
    return {
      id,
      buttons: buttons.length,
      confirm: true,
      confirmText,
      countText,
      ok: true,
      blocked,
      untouched,
      restored,
      undo: !!undo,
      toastText,
      writes: writesAfterCommit - beforeWrites,
      mainWrites: mainWritesAfterCommit - beforeMainWrites,
      undoMainWrites: mainWritesAfterUndo - mainWritesAfterCommit,
      loggedOpen: loggedTypes.has('action.work.open'),
      loggedLoad: id === 'bilibili'
        ? true
        : (loggedTypes.has('action.work.load.start') && loggedTypes.has('action.work.load.finish')),
      loggedCommit: loggedTypes.has('action.work.commit'),
      loggedUndo: loggedTypes.has('action.work.undo'),
      recordDebug,
    };
  }, { id: item.id, expected: item.expected, outside: item.outside });
  await page.close();
  return state;
}

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    for (const item of cases) {
      const state = await runCase(browser, item, report);
      const counts = state.countText || '';
      const hasCreator = /作品作者：1 位/.test(counts);
      const hasComments = /主评论作者：1 位/.test(counts) && /子评论作者：1 位/.test(counts);
      const hasDanmaku = item.id === 'douyin' ? /弹幕发送者：1 位/.test(counts) : true;
      if (state.buttons === (item.id === 'weibo' ? 2 : 1) && state.confirm && state.ok
        && hasCreator && hasComments && hasDanmaku && state.blocked && state.untouched
        && state.undo && state.restored && state.mainWrites === 1 && state.undoMainWrites === 1
        && state.loggedOpen && state.loggedLoad && state.loggedCommit && state.loggedUndo
        && /已屏蔽当前作品的/.test(state.toastText)) {
        report.pass.push(item.id + ' 作品作用域确认、作者/评论/子评论/弹幕收集、一次事务与撤销通过');
      } else {
        report.fail.push(item.id + ' 作品级屏蔽错误：' + JSON.stringify(state));
      }
    }
  } catch (error) {
    report.fail.push('FATAL: ' + String(error && error.stack || error));
  }
  try { await browser.close(); } catch (error) {}
  console.log('==== OmniBlock 作品级屏蔽回归 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('Console(errors/warn):', report.console.length); report.console.forEach((line) => console.log('  ', line));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.pageErrors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

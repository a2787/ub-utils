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
    // 使用最短的合成数字路由满足详情页判断；不携带 5 位以上 uid/mid，
    // 避免维护自检的公开页面标识隐私门禁把人工夹具误判为真站页面。
    url: 'https://weibo.com/1/synthetic-work',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <textarea id="synthetic-comment-editor" aria-label="人工合成评论输入框"></textarea>
      <div class="synthetic-detail" data-detail="a">
        <article class="woo-panel-main" data-id="synthetic-post-a">
          <header><a href="/u/110001" usercard="110001" nick-name="微博作品作者甲">微博作品作者甲</a></header>
        </article>
        <div class="synthetic-comments"><div class="wbpro-list vue-recycle-scroller page-mode direction-vertical synthetic-page-mode" style="height:1800px"><div class="item1">
          <div class="item1in"><div class="con1"><div class="text"><a href="/u/110002" usercard="110002">微博主评论作者甲</a><span>人工合成正文</span></div><div class="info"><div class="opt"></div></div><div class="synthetic-reply-control"><a href="/u/999999" usercard="999999">伪作者链接</a><a href="javascript:;">共1条回复</a></div></div></div>
          <div class="list2"><div class="item2"><div class="con2"><div class="text"><a href="/u/110003" usercard="110003">微博子评论作者甲</a><span>人工合成回复</span></div><div class="info"><div class="opt"></div></div></div></div></div>
        </div></div><template id="synthetic-second-page"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/110004" usercard="110004">微博主评论作者乙</a><span>人工合成第二页正文</span></div><div class="info"><div class="opt"></div></div></div></div><div class="list2"><div class="item2"><div class="con2"><div class="text"><a href="/u/110005" usercard="110005">微博子评论作者乙</a><span>人工合成第二页回复</span></div><div class="info"><div class="opt"></div></div></div></div></div></div></template></div></div>
      </div>
      <div class="synthetic-detail" data-detail="b">
        <article class="woo-panel-main" data-id="synthetic-post-b">
          <header><a href="/u/120001" usercard="120001" nick-name="微博作品作者乙">微博作品作者乙</a></header>
        </article>
        <div class="synthetic-comments"><div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/120002" usercard="120002">微博主评论作者乙</a></div><div class="info"><div class="opt"></div></div></div></div></div></div></div>
      </div>
    </body></html>`,
    init: `window.addEventListener('scroll', () => {
      const list = document.querySelector('.synthetic-page-mode');
      const template = document.getElementById('synthetic-second-page');
      if (!list || !template) return;
      if (!window.__syntheticFirstPage && list.firstElementChild) window.__syntheticFirstPage = list.firstElementChild.cloneNode(true);
      if (window.scrollY > 500 && !list.dataset.page2) {
        list.textContent = '';
        list.appendChild(template.content.firstElementChild.cloneNode(true));
        list.dataset.page2 = '1';
      } else if (window.scrollY <= 500 && list.dataset.page2 && window.__syntheticFirstPage) {
        list.textContent = '';
        list.appendChild(window.__syntheticFirstPage.cloneNode(true));
        delete list.dataset.page2;
      }
    });
    // 模拟微博真站：程序化点击楼中楼关闭入口会移除弹窗，但保留
    // html 的滚动锁；作品读取器必须在弹窗消失后恢复打开前的 style。
    document.addEventListener('click', (event) => {
      const control = event.target && event.target.closest
        ? event.target.closest('.synthetic-reply-control a[href="javascript:;"]') : null;
      if (!control || !/^共\\s*\\d+\\s*条回复$/.test((control.textContent || '').replace(/\\s+/g, ' ').trim())) return;
      event.preventDefault();
      // 首个且唯一的楼中楼入口也故意延迟挂载，直接锁住旧的 600ms
      // 轮询窗口；这样回归只验证“弹窗晚到时仍清理滚动锁”，不引入第二个
      // 并行弹窗把测试耗时和失败原因混在一起。
      const delayedOpen = true;
      const firstId = '110006';
      const secondId = '110007';
      const openModal = () => {
        window.__syntheticModalOpens = (window.__syntheticModalOpens || 0) + 1;
        const modal = document.createElement('div');
        modal.className = 'woo-modal-main';
        modal.innerHTML = '<div class="wbpro-layer"><div class="wbpro-layer-tit-opt"><i class="woo-font--cross"></i></div><div class="synthetic-modal-scroll" style="height:180px;overflow:auto"><div class="wbpro-list"><div class="list2"><div class="item2"><div class="con2"><div class="text"><a href="/u/' + firstId + '" usercard="' + firstId + '">微博楼中楼回复作者</a><span>人工合成延迟回复</span></div></div></div><div style="height:520px"></div></div></div></div></div>';
        const modalScroll = modal.querySelector('.synthetic-modal-scroll');
        modalScroll.addEventListener('scroll', () => {
          if (modalScroll.scrollTop < modalScroll.scrollHeight - modalScroll.clientHeight - 2 || modal.dataset.delayed) return;
          modal.dataset.delayed = '1';
          setTimeout(() => {
            const row = document.createElement('div');
            row.className = 'item2';
            row.innerHTML = '<div class="con2"><div class="text"><a href="/u/' + secondId + '" usercard="' + secondId + '">微博楼中楼异步追加作者</a><span>人工合成异步追加回复</span></div></div>';
            modalScroll.querySelector('.wbpro-list .list2').appendChild(row);
          }, 1800);
        });
        modal.querySelector('i.woo-font--cross').addEventListener('click', () => {
          window.__syntheticModalCloses = (window.__syntheticModalCloses || 0) + 1;
          modal.remove();
          // 模拟微博真站：平台关闭楼中楼后把焦点重新放回评论输入框。
          const editor = document.getElementById('synthetic-comment-editor');
          if (editor) editor.focus();
        });
        document.documentElement.style.cssText = 'overflow: auto hidden; margin-right: 15px;';
        document.body.appendChild(modal);
      };
      // 第二个入口故意延迟超过旧的 600ms 轮询窗口，锁住低配置/慢网络
      // 下弹窗晚到导致滚动锁残留的回归路径；新实现应由结构观察及时接住。
      if (delayedOpen) setTimeout(openModal, 780); else openModal();
    });`,
    expected: ['weibo:uid:110001', 'weibo:uid:110002', 'weibo:uid:110003', 'weibo:uid:110004', 'weibo:uid:110005', 'weibo:uid:110006', 'weibo:uid:110007'],
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
    const urlBefore = location.href;
    if (!buttons.length) return { buttons: 0 };
    const adapter = window.OB.adapters[id];
    const candidates = adapter && adapter.workScope && adapter.workScope.list ? adapter.workScope.list() : [];
    const raw = candidates[0] && adapter.workScope.collect ? adapter.workScope.collect(candidates[0]) : {};
    const recordDebug = (raw.records || []).map((record) => ({ keys: record.keys, level: record.level, workSection: record.workSection, source: record.source }));
    buttons[0].click();
    await wait(120);
    let confirm = document.getElementById('ob-work-confirm');
    if (!confirm) return { buttons: buttons.length, confirm: false, recordDebug };
    let confirmText = confirm.textContent || '';
    let countText = confirm.querySelector('.ob-work-counts') && confirm.querySelector('.ob-work-counts').textContent || '';
    let warningText = confirm.querySelector('.ob-work-warning') && confirm.querySelector('.ob-work-warning').textContent || '';
    let ok = confirm.querySelector('.ob-work-ok');
    let cancelFocus = null;
    let cancelCleanup = null;
    // 真站关闭楼中楼后会把焦点交给评论输入框；同时验证用户在作品级
    // 读取仍未完成时取消，后台扫描和迟到的弹窗不会继续占用页面。
    if (id === 'weibo') {
      const editor = document.getElementById('synthetic-comment-editor');
      if (editor) editor.focus();
      const no = confirm.querySelector('.ob-work-no');
      if (no) no.click();
      await wait(120);
      cancelFocus = {
        tag: document.activeElement && document.activeElement.tagName,
        id: document.activeElement && document.activeElement.id,
        isBody: document.activeElement === document.body,
      };
      await wait(1800);
      cancelCleanup = {
        modalCount: document.querySelectorAll('.woo-modal-main').length,
        htmlStyle: document.documentElement.getAttribute('style'),
        bodyStyle: document.body.getAttribute('style'),
        modalOpens: window.__syntheticModalOpens || 0,
        modalCloses: window.__syntheticModalCloses || 0,
      };
      const reopen = document.querySelector('.ob-work-block');
      if (!reopen) return { buttons: buttons.length, confirm: false, recordDebug, cancelFocus, cancelCleanup };
      reopen.click();
      await wait(120);
      confirm = document.getElementById('ob-work-confirm');
      if (!confirm) return { buttons: buttons.length, confirm: false, recordDebug, cancelFocus, cancelCleanup };
      confirmText = confirm.textContent || '';
      countText = confirm.querySelector('.ob-work-counts') && confirm.querySelector('.ob-work-counts').textContent || '';
      warningText = confirm.querySelector('.ob-work-warning') && confirm.querySelector('.ob-work-warning').textContent || '';
      ok = confirm.querySelector('.ob-work-ok');
    }
    // 微博 page-mode 夹具会在滚动分段后才挂载第二页；等待作品加载器
    // 完成，避免把“正在读取”误判成确认按钮不可用。
    for (let attempt = 0; attempt < 100 && ok && ok.disabled; attempt++) {
      await wait(100);
      ok = confirm.querySelector('.ob-work-ok');
    }
    const loadedCountText = confirm.querySelector('.ob-work-counts') && confirm.querySelector('.ob-work-counts').textContent || '';
    if (!ok || ok.disabled) return { buttons: buttons.length, confirm: true, confirmText, countText, warningText, ok: false, recordDebug };
    ok.click();
    await wait(180);
    const blocked = expected.every((key) => window.OB.Index.isBlocked(key));
    const untouched = outside.every((key) => !window.OB.Index.isBlocked(key));
    const mountedDom = (() => {
      const adapterNow = window.OB.adapters[id];
      const selectors = adapterNow && Array.isArray(adapterNow.selectors) ? adapterNow.selectors : [];
      const nodes = Array.from(new Set(selectors.flatMap((selector) => {
        try { return Array.from(document.querySelectorAll(selector)); } catch (error) { return []; }
      })));
      const byKey = new Map();
      for (const node of nodes) {
        let info = null;
        try { info = adapterNow.extract(node); } catch (error) { info = null; }
        if (!info || !Array.isArray(info.keys) || !info.keys.length) continue;
        const container = (adapterNow.containerOf && adapterNow.containerOf(node)) || info.container || node;
        if (!container || !container.isConnected) continue;
        for (const key of info.keys) {
          const list = byKey.get(key) || [];
          if (!list.includes(container)) list.push(container);
          byKey.set(key, list);
        }
      }
      const hidden = (node) => node && (node.classList.contains('ob-hidden')
        || node.getAttribute('data-ob-blocked') === '1'
        || getComputedStyle(node).display === 'none'
        || node.getBoundingClientRect().height === 0);
      const checked = expected.filter((key) => byKey.has(key));
      const failed = checked.filter((key) => !(byKey.get(key) || []).every(hidden));
      return { mounted: checked.length, hidden: checked.length - failed.length, failed, ok: failed.length === 0 };
    })();
    const writesAfterCommit = window.__writes || 0;
    const mainWritesAfterCommit = window.__mainWrites || 0;
    const urlAfter = location.href;
    const toast = document.getElementById('ob-toast');
    const toastText = toast && toast.textContent || '';
    const undo = toast && toast.querySelector('button');
    if (undo) { undo.click(); await wait(180); }
    const mainWritesAfterUndo = window.__mainWrites || 0;
    const interactionState = (() => ({
      modalCount: document.querySelectorAll('.woo-modal-main').length,
      htmlStyle: document.documentElement.getAttribute('style'),
      bodyStyle: document.body.getAttribute('style'),
      overflowY: getComputedStyle(document.documentElement).overflowY,
    }))();
    const restored = expected.every((key) => !window.OB.Index.isBlocked(key));
    const loggedTypes = new Set(window.OB.logs.eventsForDay(window.OB.logs.days()[0]).map((event) => event.type));
    return {
      id,
      buttons: buttons.length,
      confirm: true,
      confirmText,
      countText: loadedCountText || countText,
      warningText: confirm.querySelector('.ob-work-warning') && confirm.querySelector('.ob-work-warning').textContent || warningText,
      ok: true,
      blocked,
      untouched,
      mountedDom,
      restored,
      cancelFocus,
      cancelCleanup,
      undo: !!undo,
      toastText,
      writes: writesAfterCommit - beforeWrites,
      mainWrites: mainWritesAfterCommit - beforeMainWrites,
      urlBefore,
      urlAfter,
      undoMainWrites: mainWritesAfterUndo - mainWritesAfterCommit,
      interactionState,
      loggedOpen: loggedTypes.has('action.work.open'),
      loggedLoad: id === 'bilibili'
        ? true
        : (loggedTypes.has('action.work.load.start') && loggedTypes.has('action.work.load.finish')),
      loggedCommit: loggedTypes.has('action.work.commit'),
      loggedUndo: loggedTypes.has('action.work.undo'),
      recordDebug,
    };
  }, { id: item.id, expected: item.expected, outside: item.outside });
  if (state && state.ok && item.id === 'weibo') {
    const before = await page.evaluate(() => ({
      y: window.scrollY,
      max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      htmlY: getComputedStyle(document.documentElement).overflowY,
      bodyY: getComputedStyle(document.body).overflowY,
    }));
    await page.mouse.move(600, 700);
    await page.mouse.wheel(0, 500);
    await pause(80);
    const afterWheel = await page.evaluate(() => ({ y: window.scrollY }));
    await page.keyboard.press('ArrowDown');
    await pause(80);
    const afterDown = await page.evaluate(() => ({ y: window.scrollY }));
    await page.keyboard.press('ArrowUp');
    await pause(80);
    const afterUp = await page.evaluate(() => ({ y: window.scrollY }));
    state.inputScroll = { before, afterWheel, afterDown, afterUp };
  }
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
      const hasComments = /已识别主评论作者：\d+ 位/.test(counts) && /已识别子评论作者：\d+ 位/.test(counts);
      const hasSemanticLabels = /可屏蔽用户（去重）：\d+ 位/.test(counts)
        && /未加载、虚拟回收或没有可靠身份的评论不会被猜测屏蔽/.test(state.warningText || '');
      const hasDanmaku = item.id === 'douyin' ? /弹幕发送者：1 位/.test(counts) : true;
      if (state.buttons === (item.id === 'weibo' ? 2 : 1) && state.confirm && state.ok
        && hasCreator && hasComments && hasSemanticLabels && hasDanmaku && state.blocked && state.untouched
        && state.mountedDom && state.mountedDom.ok
        && (item.id !== 'weibo' || (state.inputScroll && state.inputScroll.before.max > 0
          && state.inputScroll.afterWheel.y > state.inputScroll.before.y
          && state.inputScroll.afterDown.y >= state.inputScroll.afterWheel.y
          && state.inputScroll.afterUp.y < state.inputScroll.afterDown.y))
        && state.undo && state.restored && state.mainWrites === 1 && state.undoMainWrites === 1
        && state.urlBefore === state.urlAfter
        && (item.id !== 'weibo' || (state.cancelFocus && state.cancelFocus.isBody
          && state.cancelCleanup && state.cancelCleanup.modalCount === 0
          && (state.cancelCleanup.htmlStyle === '' || state.cancelCleanup.htmlStyle == null)
          && state.cancelCleanup.bodyStyle == null))
        && state.interactionState && state.interactionState.modalCount === 0
        && (state.interactionState.htmlStyle === '' || state.interactionState.htmlStyle == null)
        && state.interactionState.overflowY !== 'hidden'
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

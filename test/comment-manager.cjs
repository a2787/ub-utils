/* OmniBlock 三平台统一评论管理器结构回归。
 * 夹具是人工合成的真实 DOM 契约：B站 Shadow DOM、抖音 comment-item/portal、
 * 微博 wbpro-list/item1/item2。它不替代真实站点验收，只锁住管理器的选择、
 * 作者去重、自动加载、一次提交和主/子评论入口边界。
 * 运行：node test/comment-manager.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (source.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const shim = `
window.__OB_PROBE_DIAGNOSTICS__ = { enabled:true };
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'disappear', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (key, fallback) => key in window.__gm ? window.__gm[key] : fallback;
window.GM_setValue = (key, value) => { window.__gm[key] = value; if (key === 'omniblock:data:v1') window.__writes = (window.__writes || 0) + 1; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const style = document.createElement('style'); style.textContent = css; (document.head || document.documentElement).appendChild(style); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script: { version: '${version}' } };
`;

const biliFixture = `<!doctype html><html><body>
<bili-comments id="comments"></bili-comments>
<script>
window.__INITIAL_STATE__ = { aid: '1' };
const comments = document.getElementById('comments');
const commentsRoot = comments.attachShadow({ mode:'open' });
function makeComment(mid, uname, rpid) {
  const thread = document.createElement('bili-comment-thread-renderer');
  const threadRoot = thread.attachShadow({ mode:'open' });
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid:String(mid), member:{ mid:String(mid), uname }, rpid:String(rpid), rpid_str:String(rpid), root:'0', root_str:'0' };
  const rendererRoot = renderer.attachShadow({ mode:'open' });
  const link = document.createElement('a'); link.className='user-name'; link.href='//space.bilibili.com/'+mid; link.textContent=uname;
  const menu = document.createElement('bili-comment-menu'); const menuRoot = menu.attachShadow({ mode:'open' });
  const options = document.createElement('ul'); options.id='options';
  for (const label of ['加入黑名单','举报']) { const li=document.createElement('li'); li.textContent=label; options.appendChild(li); }
  menuRoot.appendChild(options); rendererRoot.append(link, menu); threadRoot.appendChild(renderer); commentsRoot.appendChild(thread); return thread;
}
const root = makeComment(100001, 'B站根作者', 101);
makeComment(100002, 'B站另一根作者', 102);
window.__biliRoot = root;
</script></body></html>`;

const douyinFixture = `<!doctype html><html><body>
<div id="relatedVideoCard" style="height:260px;overflow:hidden">
  <div data-e2e="comment-item" id="dy-root"><a data-e2e="comment-username" href="/user/RootSec">抖音根作者</a><span>根评论正文</span><button id="dy-more">三个点</button><button id="dy-expand">展开 2 条回复</button></div>
</div>
<div id="dy-menu" class="semi-tooltip-wrapper" role="tooltip"><div data-e2e="video-comment-more-report" id="dy-report">举报评论</div></div>
<script>
document.getElementById('dy-expand').onclick = () => {
  const root = document.getElementById('dy-root'); if (document.getElementById('dy-reply')) return;
  root.insertAdjacentHTML('beforeend','<div data-e2e="comment-item" id="dy-reply"><a data-e2e="comment-username" href="/user/ReplySec">抖音回复作者</a><span>回复正文</span></div><div data-e2e="comment-item" id="dy-reply-two"><a data-e2e="comment-username" href="/user/ReplyTwoSec">抖音回复作者二</a><span>回复正文二</span></div>');
  document.getElementById('dy-expand').textContent='已展开 2 条回复';
};
</script></body></html>`;

const weiboFixture = `<!doctype html><html><body>
<div class="wbpro-list"><div class="item1" comment_id="root-1"><div class="item1in"><div class="con1"><div class="text"><a class="name" href="/u/300001">微博根作者</a><span>微博根评论正文</span></div><div class="info"><div class="opt"></div></div></div></div><div class="list2"><div class="item2" comment_id="reply-1"><div class="con2"><div class="text"><a href="/u/300002">微博回复作者</a><span>微博回复正文</span></div><div class="info"><div class="opt"></div></div></div></div></div></div></div>
</body></html>`;

async function wait(page, ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
function check(ok, pass, fail, report) { if (ok) report.pass.push(pass); else report.fail.push(fail); }

(async () => {
  const browser = await launchChromium();
  const report = { pass: [], fail: [] };
  try {
    const bili = await browser.newPage();
    await bili.route('**/x/v2/reply/**', (route) => {
      const url = route.request().url();
      const body = url.includes('/reply?')
        ? { code:0, data:{ page:{ count:1 }, replies:[{ rpid:201, rpid_str:'201', mid:400001, member:{ uname:'B站子回复作者' }, ctime:1700000000, content:{ message:'API 子回复' } }] } }
        : { code:0, data:{ cursor:{ is_end:true, all_count:2, next:0 }, replies:[
          { rpid:101, rpid_str:'101', mid:100001, member:{ uname:'B站根作者' }, rcount:1, ctime:1700000100, content:{ message:'API 根评论' }, replies:[] },
          { rpid:102, rpid_str:'102', mid:100002, member:{ uname:'B站另一根作者' }, rcount:0, ctime:1700000200, content:{ message:'API 另一根评论' }, replies:[] },
        ] } };
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    });
    await bili.route('https://www.bilibili.com/video/BVfixture-manager', (route) => route.fulfill({
      status:200, contentType:'text/html; charset=utf-8', body:biliFixture,
    }));
    await bili.addInitScript({ content: shim + '\n' + source });
    await bili.goto('https://www.bilibili.com/video/BVfixture-manager', { waitUntil:'domcontentloaded' });
    await bili.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(bili, 1800);
    const biliState = await bili.evaluate(async () => {
      const fab = Array.from(document.querySelectorAll('.ob-bulk[data-ob-kind="page"]')).find((el) => /评论屏蔽/.test(el.textContent || ''));
      if (!fab) return { fab:false, url:location.href, adapter:!!(window.OB && window.OB.adapters && window.OB.adapters.bilibili), comments:window.OB && window.OB.adapters.bilibili && window.OB.adapters.bilibili.commentManager && window.OB.adapters.bilibili.commentManager.collectRecords().length, available:window.OB && window.OB.adapters.bilibili && window.OB.adapters.bilibili.commentManager && window.OB.adapters.bilibili.commentManager.available(), host:!!document.querySelector('bili-comments'), shadow:!!(document.querySelector('bili-comments') && document.querySelector('bili-comments').shadowRoot), renderers:document.querySelector('bili-comments') && document.querySelector('bili-comments').shadowRoot ? document.querySelector('bili-comments').shadowRoot.querySelectorAll('bili-comment-renderer').length : -1 };
      fab.click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const panel = document.querySelector('#ob-comment-manager');
      if (!panel) return { fab:true, panel:false };
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = Array.from(panel.querySelectorAll('.ob-cm-row'));
      const search = panel.querySelector('.ob-cm-search'); search.value='B站子回复作者'; search.dispatchEvent(new Event('input',{bubbles:true}));
      const searchRows = panel.querySelectorAll('.ob-cm-row').length;
      const searchKey = panel.querySelector('.ob-cm-row') && panel.querySelector('.ob-cm-row').getAttribute('data-key');
      const searchRowText = panel.querySelector('.ob-cm-row') && panel.querySelector('.ob-cm-row').textContent;
      search.value=''; search.dispatchEvent(new Event('input',{bubbles:true}));
      const checkAll = panel.querySelector('.ob-cm-checkall input'); checkAll.click();
      const batch = panel.querySelector('.ob-cm-batch'); const selectedText = batch.textContent;
      batch.click(); await new Promise((resolve) => setTimeout(resolve, 50));
      const confirm = document.querySelector('#ob-confirm');
      if (confirm) confirm.querySelector('.ob-no').click();
      const manager = window.OB.adapters.bilibili.commentManager;
      const savedLoadAll = manager.loadAll;
      manager.loadAll = async () => ({ records: [], partial: true, reason: '人工合成分页失败' });
      const loadAll = panel.querySelector('.ob-cm-load-all');
      if (loadAll) loadAll.click();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const partialStatus = panel.querySelector('.ob-cm-status') && panel.querySelector('.ob-cm-status').textContent || '';
      manager.loadAll = savedLoadAll;
      const managerWrites = window.__writes || 0;
      window.OB.closeCommentManager();

      // 异步加载返回前关闭管理器：当前实现必须中止 signal，并丢弃旧结果，
      // 防止路由/面板切换后旧 Promise 再次写入已失效的管理器状态。
      let deferredResolve = null;
      let receivedSignal = null;
      manager.loadAll = async (_onProgress, options) => {
        receivedSignal = options && options.signal || null;
        return new Promise((resolve) => { deferredResolve = resolve; });
      };
      window.OB.openCommentManager(window.OB.adapters.bilibili, fab);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const pendingPanel = !!document.querySelector('#ob-comment-manager');
      window.OB.closeCommentManager();
      const signalAborted = !!receivedSignal && receivedSignal.aborted;
      if (deferredResolve) deferredResolve({ records: [], partial: true, reason: '人工合成取消' });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const cancelDiagnostics = window.OB.diagnostics && window.OB.diagnostics.commentManagerCancelledLoads || 0;
      const cancelledPanelAbsent = !document.querySelector('#ob-comment-manager');
      manager.loadAll = savedLoadAll;
      const rootMenu = window.__biliRoot && window.__biliRoot.shadowRoot
        ? window.__biliRoot.shadowRoot.querySelector('bili-comment-renderer') : null;
      const rootMenuOptions = rootMenu && rootMenu.shadowRoot
        ? rootMenu.shadowRoot.querySelector('bili-comment-menu') : null;
      const rootOptions = rootMenuOptions && rootMenuOptions.shadowRoot
        ? rootMenuOptions.shadowRoot.querySelector('#options') : null;
      const threadButton = rootOptions && rootOptions.querySelector('.ob-thread-quick');
      const threadWritesBefore = window.__writes || 0;
      const savedLoadThread = manager.loadThread;
      let cancelledThreadResolve = null;
      let cancelledThreadSignal = null;
      manager.loadThread = async (_item, _onProgress, options) => {
        cancelledThreadSignal = options && options.signal || null;
        return new Promise((resolve) => { cancelledThreadResolve = resolve; });
      };
      const cancelTarget = window.__biliRoot;
      const cancelInfo = window.OB.adapters.bilibili.extract(cancelTarget);
      const cancelPromise = window.OB.runThreadBlock(cancelTarget, window.OB.adapters.bilibili, cancelInfo);
      await new Promise((resolve) => setTimeout(resolve, 80));
      history.pushState({}, '', location.pathname + '#ob-thread-cancel');
      await new Promise((resolve) => setTimeout(resolve, 1250));
      const threadSignalAborted = !!cancelledThreadSignal && cancelledThreadSignal.aborted;
      if (cancelledThreadResolve) cancelledThreadResolve({ records: [], partial: true, reason: '人工合成路由取消' });
      await cancelPromise;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const threadCancelDiagnostics = window.OB.diagnostics && window.OB.diagnostics.threadCancelledLoads || 0;
      const threadCancelConfirmAbsent = !document.querySelector('#ob-confirm');
      manager.loadThread = savedLoadThread;
      if (threadButton) threadButton.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const threadConfirm = document.querySelector('#ob-confirm');
      const threadText = threadConfirm && threadConfirm.textContent || '';
      const threadConfirmOk = !!threadConfirm && threadText.includes('屏蔽该楼及 2 位作者')
        && threadText.includes('bili:uid:100001') && threadText.includes('bili:uid:400001');
      if (threadConfirm) threadConfirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const threadBlocked = window.OB.Index.isBlocked('bili:uid:100001') && window.OB.Index.isBlocked('bili:uid:400001');
      const threadWrites = (window.__writes || 0) - threadWritesBefore;
      const threadToast = document.querySelector('#ob-toast');
      const threadUndo = threadToast && threadToast.querySelector('button');
      if (threadUndo) { threadUndo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      const threadRestored = !window.OB.Index.isBlocked('bili:uid:100001') && !window.OB.Index.isBlocked('bili:uid:400001');
      return {
        fab:true, panel:true, rows:rows.length, rowTexts:rows.map((row)=>row.textContent), hasSample:rows.some((row) => row.textContent.includes('API 根评论')),
        hasMeta:rows.some((row) => /主评论/.test(row.textContent || '')), searchRows,
        searchMatch:searchRows === 1 && searchKey === 'bili:uid:400001', searchKey, searchValue:search.value, searchRowText,
        selectedText, managerWrites, writes:window.__writes || 0, confirm:!!confirm, partialStatus,
        pendingPanel, receivedSignal:!!receivedSignal, signalAborted, cancelDiagnostics,
        cancelledPanelAbsent,
        threadSignalAborted, threadCancelDiagnostics, threadCancelConfirmAbsent,
        threadButton:!!threadButton, threadConfirmOk, threadBlocked, threadWrites, threadRestored,
      };
    });
    check(biliState.fab && biliState.panel && biliState.rows === 3 && biliState.hasSample && biliState.hasMeta
      && biliState.searchMatch && /3/.test(biliState.selectedText) && biliState.managerWrites === 0 && biliState.confirm
      && /部分加载|分页失败/.test(biliState.partialStatus || '')
      && biliState.pendingPanel && biliState.receivedSignal && biliState.signalAborted
      && biliState.cancelDiagnostics >= 1 && biliState.cancelledPanelAbsent
      && biliState.threadSignalAborted && biliState.threadCancelDiagnostics >= 1
      && biliState.threadCancelConfirmAbsent
      && biliState.threadButton && biliState.threadConfirmOk && biliState.threadBlocked
      && biliState.threadWrites === 1 && biliState.threadRestored,
      'B站统一管理器自动读取根评论/子回复、作者去重、示例评论、搜索和筛选全选', JSON.stringify(biliState), report);
    await bili.close();

    const douyin = await browser.newPage();
    await douyin.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:douyinFixture }));
    await douyin.addInitScript({ content: shim + '\n' + source });
    await douyin.goto('https://www.douyin.com/video/fixture-manager', { waitUntil:'domcontentloaded' });
    await douyin.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(douyin, 1100);
    const douyinState = await douyin.evaluate(async () => {
      const more=document.getElementById('dy-more'); const report=document.getElementById('dy-report');
      more.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}));
      report.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,composed:true})); await new Promise((resolve)=>setTimeout(resolve,100));
      const menuQuick=document.querySelectorAll('#dy-menu .ob-quick').length;
      const threadMenu=document.querySelectorAll('#dy-menu .ob-thread-quick').length;
      const threadButton=document.querySelector('#dy-menu .ob-thread-quick');
      if (!threadButton) return { fab:false,menuQuick,threadMenu,threadConfirmOk:false,threadBlocked:false,threadWrites:0,threadRestored:false,rows:0,hasReplies:false,childThread:-1 };
      const threadWritesBefore=window.__writes || 0;
      threadButton.click(); await new Promise((resolve)=>setTimeout(resolve,650));
      const threadConfirm=document.querySelector('#ob-confirm');
      const threadConfirmText=threadConfirm && threadConfirm.textContent || '';
      const threadConfirmOk=!!threadConfirm
        && threadConfirmText.includes('屏蔽该楼及 3 位作者')
        && threadConfirmText.includes('douyin:secuid:RootSec')
        && threadConfirmText.includes('douyin:secuid:ReplyTwoSec');
      if (threadConfirm) threadConfirm.querySelector('.ob-ok').click();
      await new Promise((resolve)=>setTimeout(resolve,180));
      const threadBlocked=['RootSec','ReplySec','ReplyTwoSec'].every((sec)=>window.OB.Index.isBlocked('douyin:secuid:'+sec));
      const threadWrites=(window.__writes || 0)-threadWritesBefore;
      const threadToast=document.querySelector('#ob-toast');
      const threadUndo=threadToast && threadToast.querySelector('button');
      if (threadUndo) { threadUndo.click(); await new Promise((resolve)=>setTimeout(resolve,180)); }
      const threadRestored=['RootSec','ReplySec','ReplyTwoSec'].every((sec)=>!window.OB.Index.isBlocked('douyin:secuid:'+sec));
      const fab=document.querySelector('.ob-bulk[data-ob-kind="page"]'); if (!fab) return { fab:false,menuQuick,threadMenu };
      fab.click(); await new Promise((resolve)=>setTimeout(resolve,600));
      const panel=document.querySelector('#ob-comment-manager');
      const rows=panel ? panel.querySelectorAll('.ob-cm-row').length : 0;
      const hasReplies=panel && ['ReplySec','ReplyTwoSec'].every((sec)=>Array.from(panel.querySelectorAll('.ob-cm-row')).some((row)=>row.getAttribute('data-key')==='douyin:secuid:'+sec));
      const rootItem=document.getElementById('dy-root');
      const childItem=document.getElementById('dy-reply');
      const childMenu=document.createElement('div'); childMenu.className='semi-tooltip-wrapper'; childMenu.setAttribute('role','tooltip'); childMenu.innerHTML='<div data-e2e="video-comment-more-report">举报评论</div>'; document.body.appendChild(childMenu);
      childItem.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true})); childMenu.querySelector('[data-e2e="video-comment-more-report"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,composed:true}));
      await new Promise((resolve)=>setTimeout(resolve,150));
      return { fab:true,menuQuick,threadMenu,threadConfirmOk,threadBlocked,threadWrites,threadRestored,rows,hasReplies,childThread:childMenu.querySelectorAll('.ob-thread-quick').length };
    });
    check(douyinState.fab && douyinState.menuQuick === 2 && douyinState.threadMenu === 1
      && douyinState.threadConfirmOk && douyinState.threadBlocked && douyinState.threadWrites === 1 && douyinState.threadRestored
      && douyinState.rows === 3 && douyinState.hasReplies && douyinState.childThread === 0,
      '抖音统一管理器自动展开回复，主评论菜单有一个楼操作且子评论没有楼操作', JSON.stringify(douyinState), report);
    await douyin.close();

    const weibo = await browser.newPage();
    await weibo.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:weiboFixture }));
    await weibo.addInitScript({ content: shim + '\n' + source });
    await weibo.goto('https://weibo.com/fixture-post#comment', { waitUntil:'domcontentloaded' });
    await weibo.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(weibo, 1800);
    const weiboState = await weibo.evaluate(async () => {
      const fab=document.querySelector('.ob-bulk[data-ob-kind="page"]');
      const root=document.querySelector('.item1'); const child=document.querySelector('.item2');
      const rootLocal=root && root.querySelector('.ob-weibo-comment-block'); const rootThread=root && root.querySelector('.ob-weibo-thread-block');
      const childThread=child && child.querySelector('.ob-weibo-thread-block');
      if (!fab) return { fab:false,rootLocal:!!rootLocal,rootThread:!!rootThread,childThread:!!childThread };
      fab.click(); await new Promise((resolve)=>setTimeout(resolve,350));
      const panel=document.querySelector('#ob-comment-manager');
      const rows=panel ? panel.querySelectorAll('.ob-cm-row').length : 0;
      const search=panel && panel.querySelector('.ob-cm-search');
      if (search) { search.value='微博回复作者'; search.dispatchEvent(new Event('input',{bubbles:true})); }
      const searchRows=panel ? panel.querySelectorAll('.ob-cm-row').length : 0;
      if (search) search.value=''; if (search) search.dispatchEvent(new Event('input',{bubbles:true}));
      const manager=window.OB.adapters.weibo.commentManager;
      const savedCollect=manager.collectRecords; const savedLoadAll=manager.loadAll;
      let collectCalls=0;
      // 超过脚本的本地评论管理器安全上限，验证旧记录会被有界淘汰，
      // 而不是随着虚拟列表滚动无限保留。
      const manyRecords=Array.from({length:20005},(_,index)=>({
        keys:['weibo:uid:'+(700000+index)], label:'人工作者'+index, note:'人工合成评论'+index,
        level:index%2?'reply':'root', threadId:'synthetic-thread-'+index, source:'dom',
      }));
      manager.collectRecords=()=>{ collectCalls++; return manyRecords; };
      manager.loadAll=async()=>({records:[]});
      window.OB.closeCommentManager();
      await window.OB.openCommentManager(manager ? window.OB.adapters.weibo : null, fab);
      await new Promise((resolve)=>setTimeout(resolve,120));
      const manyPanel=document.querySelector('#ob-comment-manager');
      const manyRows=manyPanel ? manyPanel.querySelectorAll('.ob-cm-row').length : 0;
      const manySearch=manyPanel && manyPanel.querySelector('.ob-cm-search');
      if (manySearch) { manySearch.value='人工作者19999'; manySearch.dispatchEvent(new Event('input',{bubbles:true})); }
      const manySearchRows=manyPanel ? manyPanel.querySelectorAll('.ob-cm-row').length : 0;
      window.OB.closeCommentManager();
      manager.collectRecords=savedCollect; manager.loadAll=savedLoadAll;
      rootThread.click(); await new Promise((resolve)=>setTimeout(resolve,120));
      const threadConfirm=document.querySelector('#ob-confirm');
      const threadConfirmText=threadConfirm && threadConfirm.textContent || '';
      const threadPartial=!!threadConfirm && /屏蔽该楼及 2 位作者/.test(threadConfirmText) && /部分/.test(threadConfirmText);
      if (threadConfirm) threadConfirm.querySelector('.ob-no').click();
      return { fab:true,rootLocal:!!rootLocal,rootThread:!!rootThread,childThread:!!childThread,rows,searchRows,manyRows,manySearchRows,collectCalls,threadPartial,threadConfirmText };
    });
    check(weiboState.fab && weiboState.rootLocal && weiboState.rootThread && !weiboState.childThread
      && weiboState.rows === 2 && weiboState.searchRows === 1
      && weiboState.manyRows === 20000 && weiboState.manySearchRows === 1 && weiboState.collectCalls < 10
      && weiboState.threadPartial,
      '微博评论管理器与行内楼操作共用统一记录，主评论/回复入口边界正确', JSON.stringify(weiboState), report);
    await weibo.close();
  } finally {
    await browser.close();
  }
  console.log('==== OmniBlock 统一评论管理器结构回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  if (report.fail.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });

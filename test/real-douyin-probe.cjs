/* 抖音登录态只读探针（需要用户调试浏览器 127.0.0.1:9222）。
 * 默认在用户已登录的浏览器里开一个临时标签页，注入带内存 GM 存储的 userscript；
 * --current 复用专用当前标签页并在结束后保留它。两种模式只做抖音页面的只读导航、
 * 滚动和脚本自身 UI 操作，不读取/导出 Cookie，不点击平台写入控件。
 * 运行：node test/real-douyin-probe.cjs [--url=https://www.douyin.com/...] [--duration=90]
 *        node test/real-douyin-probe.cjs --current --verify-video-switch --verify-auto-danmaku --duration=90
 *        node test/real-douyin-probe.cjs --open-entry --duration=90
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const sourceHash = crypto.createHash('sha256').update(userscript).digest('hex');
const build = (userscript.match(/const RUNTIME_BUILD\s*=\s*'([^']+)'/) || [, ''])[1];
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = urlArg ? urlArg.slice('--url='.length) : '';
const useCurrentTarget = process.argv.includes('--current');
const durationArg = process.argv.find((arg) => arg.startsWith('--duration='));
const durationSeconds = Math.max(5, Math.min(600, Number(durationArg ? durationArg.slice(11) : 90) || 90));
const openEntry = process.argv.includes('--open-entry');
const verifyVideoSwitch = process.argv.includes('--verify-video-switch');
const verifyAutoDanmaku = process.argv.includes('--verify-auto-danmaku');

const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = () => {};
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;

function httpJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('CDP HTTP timeout')));
    req.on('error', reject);
  });
}

async function browserClient() {
  const info = await httpJSON('http://127.0.0.1:9222/json/version');
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('browser CDP websocket error')));
  });
  socket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
    }
  });
  function send(method, params, sessionId) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 60000);
    });
  }
  await ready;
  return { send, close: () => { try { socket.close(); } catch (e) {} } };
}

async function evaluate(send, sessionId, expression) {
  const result = await send('Runtime.evaluate', {
    expression: '(async () => { ' + expression + ' })()',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(String(detail || result.exceptionDetails.text || 'evaluate failed').slice(0, 600));
  }
  return result.result && result.result.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_SCRIPT = `
const out = { hasOB: !!window.__OB_TEST__, danmakuCount: document.querySelectorAll('[data-danmu-id]').length, errors: [], runtime: null };
if (!out.hasOB) return out;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, ms) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (fn()) return true; await pause(80); } return !!fn(); };
const OB = window.__OB_TEST__;
out.runtime = OB && OB.runtime || null;
const adapter = OB.adapters.douyin;
out.adapterReady = !!adapter;
if (!adapter) return out;
const items = Array.from(document.querySelectorAll('[data-danmu-id]'));
const withIdentity = items.filter((el) => String(el.getAttribute('data-danmaku-user-id') || el.getAttribute('data-danmu-user-id') || '').trim());
out.withIdentity = withIdentity.length;
out.sample = withIdentity.slice(0, 3).map((el) => ({
  hasDanmuId: !!el.getAttribute('data-danmu-id'),
  hasUserId: !!(el.getAttribute('data-danmaku-user-id') || el.getAttribute('data-danmu-user-id')),
  isAuthor: el.getAttribute('data-is-danmu-author') === 'true',
}));
let target = withIdentity.find((el) => {
  const info = adapter.extract(el);
  const uid = info && info.keys && info.keys.find((key) => key.startsWith('douyin:uid:'));
  return !!uid && !OB.Index.isBlocked(info.keys);
});
if (!target) { out.noTarget = true; return out; }
let targetInfo = adapter.extract(target);
let uidKey = targetInfo.keys.find((key) => key.startsWith('douyin:uid:'));
let commentFab = document.querySelector('.ob-bulk[data-ob-kind="page"][data-ob-douyin-toolbar="1"]');
let commentEntryOpened = false;
if (!commentFab) {
  // 精选页的视频弹窗初始可能只展示视频和弹幕，评论列表要由用户点击真实的
  // feed-comment-icon 后才挂载。只选择当前 DOM 中第一个可见入口，不猜测私有接口。
  const commentEntry = Array.from(document.querySelectorAll('[data-e2e="feed-comment-icon"]'))
    .find((el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
  if (commentEntry) {
    commentEntry.click();
    commentEntryOpened = true;
    await waitFor(() => document.querySelectorAll('[data-e2e="comment-item"], .comment-item').length > 0, 4500);
    await waitFor(() => document.querySelector('.ob-bulk[data-ob-kind="page"][data-ob-douyin-toolbar="1"]'), 2500);
    commentFab = document.querySelector('.ob-bulk[data-ob-kind="page"][data-ob-douyin-toolbar="1"]');
  }
}
out.commentEntryOpened = commentEntryOpened;
out.commentDomCount = document.querySelectorAll('[data-e2e="comment-item"], .comment-item').length;
out.commentRecordCount = adapter.commentManager && typeof adapter.commentManager.collectRecords === 'function'
  ? adapter.commentManager.collectRecords('manager').length : null;
out.commentManagerAvailable = adapter.commentManager && typeof adapter.commentManager.available === 'function'
  ? adapter.commentManager.available() : null;
const gear = document.getElementById('ob-gear');
const toolbarPosition = (node) => node ? {
  left: getComputedStyle(node).left,
  right: getComputedStyle(node).right,
  bottom: getComputedStyle(node).bottom,
} : null;
const visible = (node) => {
  if (!node) return false;
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};
const dockInitial = {
  state: document.documentElement.getAttribute('data-ob-dock') || '',
  gearState: gear && gear.getAttribute('data-ob-dock-state') || '',
  pageToolsHidden: [commentFab, document.getElementById('ob-douyin-dm-tool')]
    .filter(Boolean).every((node) => !visible(node)),
};
if (gear) {
  // 这是脚本自身齿轮的悬停事件，不是平台写入操作；验证真实页面上由
  // 收起态进入展开态后，评论/弹幕入口确实恢复可见。
  gear.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, relatedTarget: document.body }));
  await pause(280);
}
const dockExpanded = {
  state: document.documentElement.getAttribute('data-ob-dock') || '',
  gearState: gear && gear.getAttribute('data-ob-dock-state') || '',
  pageToolsVisible: [commentFab, document.getElementById('ob-douyin-dm-tool')]
    .filter(Boolean).every(visible),
};
out.dockInitial = dockInitial;
out.dockExpanded = dockExpanded;
out.commentToolPresent = !!commentFab;
out.commentToolPosition = toolbarPosition(commentFab);
out.gearPosition = toolbarPosition(gear);
out.commentToolRightColumn = !!commentFab && getComputedStyle(commentFab).right === '14px'
  && getComputedStyle(commentFab).bottom === '106px';
out.gearRightColumn = !!gear && getComputedStyle(gear).right === '14px'
  && getComputedStyle(gear).bottom === '14px';
const dmTool = document.getElementById('ob-douyin-dm-tool');
out.managerToolPresent = !!dmTool;
out.managerToolVisible = visible(dmTool);
out.managerToolText = dmTool && dmTool.textContent;
out.managerToolPosition = toolbarPosition(dmTool);
out.managerToolRightColumn = !!dmTool && getComputedStyle(dmTool).right === '14px'
  && getComputedStyle(dmTool).bottom === '62px';
if (dmTool) {
  dmTool.click();
  await pause(120);
  const manager = document.getElementById('ob-douyin-dm-manager');
  out.managerPresent = !!manager;
  out.managerRows = manager ? manager.querySelectorAll('.ob-dd-row').length : 0;
  const managerSearch = manager && manager.querySelector('.ob-dd-search');
  const managerScan = manager && manager.querySelector('.ob-dd-scan');
  out.managerSearchPresent = !!managerSearch;
  out.managerScanPresent = !!managerScan;
  const rowKeys = manager ? Array.from(manager.querySelectorAll('.ob-dd-row')).map((row) => row.getAttribute('data-key')).filter(Boolean) : [];
  if (managerSearch && rowKeys.length) {
    const sampleName = manager.querySelector('.ob-dd-name');
    managerSearch.value = ((sampleName && sampleName.textContent) || rowKeys[0]).trim();
    managerSearch.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(80);
    out.managerSearchWorks = manager.querySelectorAll('.ob-dd-row').length > 0;
    managerSearch.value = '';
    managerSearch.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(80);
  } else {
    out.managerSearchWorks = null;
  }
  const checkAll = manager && manager.querySelector('.ob-dd-checkall input');
  if (checkAll) checkAll.click();
  await pause(80);
  const batch = manager && manager.querySelector('.ob-dd-batch');
  out.managerBatchEnabled = !!batch && !batch.disabled && rowKeys.length > 0;
  if (batch) batch.click();
  await pause(100);
  const managerConfirm = document.getElementById('ob-confirm');
  if (managerConfirm) managerConfirm.querySelector('.ob-ok').click();
  out.managerBlocked = await waitFor(() => rowKeys.length > 0 && rowKeys.every((key) => OB.Index.isBlocked(key)), 2500);
  const managerToast = document.getElementById('ob-toast');
  const managerUndo = managerToast && managerToast.querySelector('button');
  if (managerUndo) { managerUndo.click(); await pause(120); }
  out.managerRestored = rowKeys.length > 0 && rowKeys.every((key) => !OB.Index.isBlocked(key));
  const managerClose = manager && manager.querySelector('.ob-dd-close');
  if (managerClose) managerClose.click();
}
if (commentFab) {
  commentFab.click();
  // 抖音统一评论管理器打开后自动展开明确回复并安全滚动；只等待脚本自身
  // 的加载流程，不点击平台的举报、拉黑或关注控件。
  await pause(2600);
  const commentManager = document.getElementById('ob-comment-manager');
  out.commentManagerPresent = !!commentManager;
  out.commentSearchPresent = !!(commentManager && commentManager.querySelector('.ob-cm-search'));
  out.commentLoadPresent = !!(commentManager && commentManager.querySelector('.ob-cm-load-all'));
  const commentScope = document.querySelector('#relatedVideoCard');
  out.commentModalScopePresent = !!commentScope;
  out.commentModalBulkCount = commentScope
    ? commentScope.querySelectorAll('.ob-bulk[data-ob-kind="modal"]').length : 0;
  out.commentModalBulkAbsent = !commentScope || out.commentModalBulkCount === 0;
  const commentRows = commentManager && commentManager.querySelectorAll('.ob-cm-row');
  out.commentManagerStaysOpen = !!commentManager && document.getElementById('ob-comment-manager') === commentManager;
  if (commentManager && commentRows && commentRows.length) {
    const sampleName = commentManager.querySelector('.ob-cm-name');
    const commentSearch = commentManager.querySelector('.ob-cm-search');
    if (commentSearch) {
      commentSearch.value = ((sampleName && sampleName.textContent) || commentRows[0].textContent || '').trim();
      commentSearch.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(80);
      out.commentSearchWorks = commentManager.querySelectorAll('.ob-cm-row').length > 0;
      commentSearch.value = '';
      commentSearch.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const checkAll = commentManager.querySelector('.ob-cm-checkall input');
    if (checkAll) checkAll.click();
    await pause(80);
    const batch = commentManager.querySelector('.ob-cm-batch');
    out.commentBatchEnabled = !!batch && !batch.disabled && !!commentRows.length;
    const status = commentManager.querySelector('.ob-cm-status');
    out.commentStatus = status && status.textContent;
  } else {
    out.commentSearchWorks = null;
    out.commentBatchEnabled = false;
  }
  const commentClose = commentManager && commentManager.querySelector('.ob-cm-close');
  if (commentClose) commentClose.click();
}
// 评论管理器会滚动评论侧栏，抖音可能同时回收正在飘过的旧弹幕节点；
// 单条入口断言应重新选择当前仍连接且带可靠身份的弹幕，而不是使用已回收节点。
const targetRect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
if (!target || !target.isConnected || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
  const currentTargets = Array.from(document.querySelectorAll('[data-danmu-id],[data-danmaku-id]'));
  target = currentTargets.find((el) => {
    const info = adapter.extract(el);
    const uid = info && info.keys && info.keys.find((key) => key.startsWith('douyin:uid:'));
    const rect = el.getBoundingClientRect();
    return !!uid && !OB.Index.isBlocked(info.keys) && rect.width > 0 && rect.height > 0;
  }) || currentTargets.find((el) => {
    const info = adapter.extract(el);
    const uid = info && info.keys && info.keys.find((key) => key.startsWith('douyin:uid:'));
    return !!uid && !OB.Index.isBlocked(info.keys);
  }) || null;
  targetInfo = target && adapter.extract(target);
  uidKey = targetInfo && targetInfo.keys && targetInfo.keys.find((key) => key.startsWith('douyin:uid:'));
}
if (!target || !uidKey) { out.noTarget = true; return out; }
target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
await pause(120);
const btn = target.querySelector('.ob-dy-dm-block');
out.buttonPresent = !!btn;
out.buttonInside = !!btn && target.contains(btn);
out.buttonLabel = btn && btn.textContent;
if (!btn) return out;
if (!uidKey) { out.noUidKey = true; return out; }
btn.click();
await pause(120);
const confirm = document.getElementById('ob-confirm');
out.confirmShown = !!confirm;
out.confirmUid = !!(confirm && (confirm.textContent || '').includes(uidKey));
if (confirm) confirm.querySelector('.ob-ok').click();
out.blocked = await waitFor(() => OB.Index.isBlocked(uidKey), 2500);
out.hidden = await waitFor(() => getComputedStyle(target).display === 'none' || target.getBoundingClientRect().height === 0, 2500);
const toast = document.getElementById('ob-toast');
const undo = toast && toast.querySelector('button');
if (undo) { undo.click(); await pause(120); }
out.restored = await waitFor(() => !OB.Index.isBlocked(uidKey) && getComputedStyle(target).display !== 'none' && target.getBoundingClientRect().height > 0, 2500);
const authorDm = document.querySelector('[data-danmu-id][data-is-danmu-author="true"]');
out.authorDanmakuCount = document.querySelectorAll('[data-danmu-id][data-is-danmu-author="true"]').length;
if (authorDm) {
  const info = adapter.extract(authorDm);
  out.authorIdentityResolved = !!(info && info.keys && info.keys.length);
}
return out;
`;

const VIDEO_SWITCH_TEST_SCRIPT = `
const out = { attempted: true, errors: [], initialKey: '', nextKey: '', initialRows: 0, nextRows: 0, nextDomCount: 0, nextCurrentRows: 0, staleRows: 0, managerClosed: false, sentinelRecorded: false, sentinelPresent: false, oldRowsAbsent: false, newRowsPresent: false, emptyNextValid: false };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, ms) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (fn()) return true; await pause(100); } return !!fn(); };
const OB = window.__OB_TEST__;
const adapter = OB && OB.adapters && OB.adapters.douyin;
const dmTool = document.getElementById('ob-douyin-dm-tool');
if (!OB || !adapter || !dmTool) { out.reason = '没有当前抖音弹幕管理器入口'; return out; }
const closeExisting = document.querySelector('#ob-douyin-dm-manager .ob-dd-close');
if (closeExisting) closeExisting.click();
dmTool.click();
await pause(180);
let manager = document.getElementById('ob-douyin-dm-manager');
if (!manager) { out.reason = '当前视频弹幕管理器未能打开'; return out; }
await waitFor(() => manager.querySelectorAll('.ob-dd-row').length > 0, 2500);
out.initialKey = typeof adapter.videoKey === 'function' ? adapter.videoKey() : location.pathname + location.search;
const sentinelKey = 'douyin:uid:999999999999999999';
const oldRoot = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
const sentinel = document.createElement('div');
sentinel.setAttribute('data-danmu-id', 'ob-video-switch-sentinel');
sentinel.setAttribute('data-danmaku-user-id', '999999999999999999');
sentinel.textContent = 'OmniBlock video switch sentinel';
if (oldRoot && oldRoot.appendChild) oldRoot.appendChild(sentinel);
const oldClose = manager.querySelector('.ob-dd-close');
if (oldClose) oldClose.click();
await waitFor(() => !document.getElementById('ob-douyin-dm-manager'), 1500);
dmTool.click();
await pause(180);
manager = document.getElementById('ob-douyin-dm-manager');
if (!manager) { if (sentinel.isConnected) sentinel.remove(); out.reason = '加入切换哨兵后旧管理器未能重新打开'; return out; }
out.sentinelRecorded = await waitFor(() => !!manager.querySelector('[data-key="' + sentinelKey + '"]'), 2500);
const initialRows = Array.from(manager.querySelectorAll('.ob-dd-row')).map((row) => row.getAttribute('data-key')).filter(Boolean);
out.initialRows = initialRows.length;
const activeMedia = Array.from(document.querySelectorAll('video, audio')).find((media) => !media.paused && !media.ended);
const activeRoot = activeMedia && activeMedia.closest ? activeMedia.closest('.basePlayerContainer, .playerContainer, [data-e2e="video-player"]') : null;
const nextCandidates = activeRoot
  ? Array.from(activeRoot.querySelectorAll('[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next'))
  : Array.from(document.querySelectorAll('[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next'));
const next = nextCandidates.find((el) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
}) || nextCandidates.find((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
if (!next) { out.reason = '当前页面没有可见的下一个视频导航'; return out; }
if (sentinel.isConnected) sentinel.remove();
next.click();
const changed = await waitFor(() => {
  const key = typeof adapter.videoKey === 'function' ? adapter.videoKey() : location.pathname + location.search;
  return key !== out.initialKey;
}, 10000);
if (!changed) { out.reason = '点击下一个视频后视频会话键没有变化'; return out; }
out.nextKey = typeof adapter.videoKey === 'function' ? adapter.videoKey() : location.pathname + location.search;
out.managerClosed = await waitFor(() => !document.getElementById('ob-douyin-dm-manager'), 2500);
await waitFor(() => document.getElementById('ob-douyin-dm-tool') && /\\(\\d+\\)/.test(document.getElementById('ob-douyin-dm-tool').textContent || ''), 2500);
dmTool.click();
await pause(180);
manager = document.getElementById('ob-douyin-dm-manager');
if (!manager) { out.reason = '切换后新弹幕管理器未能打开'; return out; }
await waitFor(() => manager.querySelectorAll('.ob-dd-row').length > 0, 5000);
const nextRows = Array.from(manager.querySelectorAll('.ob-dd-row')).map((row) => row.getAttribute('data-key')).filter(Boolean);
out.nextRows = nextRows.length;
const currentRoot = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
const currentItems = currentRoot && currentRoot.querySelectorAll
  ? Array.from(currentRoot.querySelectorAll('[data-danmu-id],[data-danmaku-id],[data-danmaku-user-id],[data-danmu-user-id]')) : [];
const currentKeys = new Set();
for (const item of currentItems) {
  const info = adapter.extract(item);
  for (const key of (info && info.keys || [])) if (key.startsWith('douyin:')) currentKeys.add(key);
}
out.nextDomCount = currentItems.length;
out.nextCurrentRows = nextRows.filter((key) => currentKeys.has(key)).length;
out.staleRows = nextRows.filter((key) => !currentKeys.has(key)).length;
out.sentinelPresent = nextRows.includes(sentinelKey);
// 同一作者可以在相邻视频发言，且当前视频早先观察到的历史发送者可以暂时
// 不在屏幕上；受控哨兵才是可以无歧义证明旧缓存未跨视频泄漏的断言。
out.oldRowsAbsent = out.sentinelRecorded && !out.sentinelPresent;
out.newRowsPresent = nextRows.length > 0;
out.emptyNextValid = !out.newRowsPresent && out.nextDomCount === 0 && /\\(0\\)/.test(dmTool.textContent || '');
return out;
`;

const AUTO_DANMAKU_TEST_SCRIPT = `
const out = { attempted: true, targetFound: false, ruleAdded: false, matched: false, hidden: false, identityPersisted: false, restored: false, errors: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, ms) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (fn()) return true; await pause(80); } return !!fn(); };
const OB = window.__OB_TEST__;
const adapter = OB && OB.adapters && OB.adapters.douyin;
if (!OB || !adapter || !OB.danmakuRules) { out.reason = '自动规则运行时未就绪'; return out; }
const currentRoot = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
const deepQuery = (root, selector) => {
  const result = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.nodeType === 1 && node.matches && node.matches(selector)) result.push(node);
    if (node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.children || []) walk(child);
  };
  walk(root); return result;
};
const hasVideoIdentity = (root) => {
  if (!root || !root.getAttribute) return false;
  if (['data-e2e-vid', 'data-video-id', 'data-item-id'].some((name) => !!root.getAttribute(name))) return true;
  return /(?:^|\s)video_[0-9]{6,}(?:\s|$)/.test(String(root.className || ''));
};
const playerRoots = deepQuery(document, '.basePlayerContainer, .playerContainer, [data-e2e="video-player"]');
const playerDiagnostics = playerRoots.map((root, index) => {
  const media = deepQuery(root, 'video, audio')[0];
  const rect = root.getBoundingClientRect();
  return {
    index,
    danmakuCount: deepQuery(root, '[data-danmu-id],[data-danmaku-id],[data-danmaku-user-id],[data-danmu-user-id]').length,
    visible: rect.width > 0 && rect.height > 0,
    playing: !!media && !media.paused && !media.ended,
    identity: hasVideoIdentity(root),
    current: root === currentRoot,
  };
});
out.rootDiagnostics = {
  documentDanmakuCount: deepQuery(document, '[data-danmu-id],[data-danmaku-id],[data-danmaku-user-id],[data-danmu-user-id]').length,
  currentRootDanmakuCount: deepQuery(currentRoot, '[data-danmu-id],[data-danmaku-id],[data-danmaku-user-id],[data-danmu-user-id]').length,
  currentRootVisible: currentRoot === document || (() => { const rect = currentRoot && currentRoot.getBoundingClientRect ? currentRoot.getBoundingClientRect() : { width:0, height:0 }; return rect.width > 0 && rect.height > 0; })(),
  currentRootIdentity: hasVideoIdentity(currentRoot),
  playerRoots: playerDiagnostics,
};
const candidates = deepQuery(currentRoot, '[data-danmu-id],[data-danmaku-id]');
const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
const contentOf = (node) => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.ob-dy-dm-block').forEach((button) => button.remove());
  return String(copy.textContent || '').replace(/\\s+/g, ' ').trim();
};
const target = candidates.find((node) => {
  const info = adapter.extract(node);
  const hasUid = !!(info && info.keys && info.keys.some((key) => key.startsWith('douyin:uid:')));
  const content = contentOf(node);
  return hasUid && content && visible(node) && !OB.Index.isBlocked(info.keys);
}) || candidates.find((node) => {
  const info = adapter.extract(node);
  return !!(info && info.keys && info.keys.some((key) => key.startsWith('douyin:uid:'))) && !!contentOf(node);
});
if (!target) { out.reason = '当前页面没有可见且带可靠发送者身份的弹幕'; return out; }
out.targetFound = true;
const info = adapter.extract(target);
const content = contentOf(target);
const token = content.slice(0, Math.min(6, content.length));
const beforeKeys = new Set(OB.Store.allIdentities());
const beforeStatus = adapter.getAutoDanmakuStatus();
const rule = OB.danmakuRules.add('douyin', 'keyword', token);
out.ruleAdded = !!(rule && rule.ok);
if (!out.ruleAdded) { out.reason = '无法创建临时关键词规则'; return out; }
adapter.scanAutoDanmaku();
await waitFor(() => target.getAttribute('data-ob-auto-dm-blocked') === '1', 1800);
// 自动规则先同步隐藏节点，再用一个零延迟批次写入本地名单；等待名单本身，
// 避免把“节点已隐藏但持久化批次尚未落盘”误报成身份链失败。
await waitFor(() => info.keys.some((key) => OB.Index.isBlocked(key))
  && Array.from(OB.Store.allIdentities()).some((key) => !beforeKeys.has(key) && key.startsWith('douyin:')), 1800);
const afterStatus = adapter.getAutoDanmakuStatus();
const afterKeys = new Set(OB.Store.allIdentities());
out.matched = afterStatus.matchedMessages > beforeStatus.matchedMessages;
out.hidden = target.getAttribute('data-ob-auto-dm-blocked') === '1'
  && getComputedStyle(target).display === 'none';
out.identityPersisted = info.keys.some((key) => OB.Index.isBlocked(key))
  && Array.from(afterKeys).some((key) => !beforeKeys.has(key) && key.startsWith('douyin:'));
OB.danmakuRules.remove('douyin', rule.rule.id);
for (const key of afterKeys) if (!beforeKeys.has(key) && key.startsWith('douyin:')) OB.Store.removeIdentity(key);
adapter.scanAutoDanmaku();
out.restored = await waitFor(() => target.getAttribute('data-ob-auto-dm-blocked') !== '1'
  && getComputedStyle(target).display !== 'none', 1800);
return out;
`;

async function runStabilityCheck(send, sessionId) {
  const result = {
    durationSeconds,
    samples: 0,
    heartbeatErrors: 0,
    maxLatencyMs: 0,
    minDanmakuCount: null,
    minCommentCount: null,
    finalDanmakuCount: null,
    finalCommentCount: null,
  };
  const deadline = Date.now() + durationSeconds * 1000;
  while (Date.now() < deadline) {
    const started = Date.now();
    try {
      const state = await evaluate(send, sessionId, `return {
        ready: document.readyState,
        hasOB: !!window.__OB_TEST__,
        danmakuCount: document.querySelectorAll('[data-danmu-id]').length,
        commentCount: document.querySelectorAll('[data-e2e="comment-item"], .comment-item').length,
      }`);
      result.samples++;
      result.maxLatencyMs = Math.max(result.maxLatencyMs, Date.now() - started);
      if (result.minDanmakuCount === null || state.danmakuCount < result.minDanmakuCount) result.minDanmakuCount = state.danmakuCount;
      if (result.minCommentCount === null || state.commentCount < result.minCommentCount) result.minCommentCount = state.commentCount;
      result.finalDanmakuCount = state.danmakuCount;
      result.finalCommentCount = state.commentCount;
      // 弹幕节点会随时间滚出/回收，也可能被当前自动规则全部隐藏；它的最低数量
      // 只作诊断。页面是否仍可用以运行时和持续评论为准，自动规则命中则由专门断言验证。
      if (!state.hasOB || state.ready !== 'complete' || state.commentCount < 1) {
        result.heartbeatErrors++;
      }
    } catch (error) {
      result.heartbeatErrors++;
      result.maxLatencyMs = Math.max(result.maxLatencyMs, Date.now() - started);
    }
    await sleep(500);
  }
  return result;
}

(async () => {
  const report = { version, sourceHash, build, durationSeconds, blocked: [], probe: null, videoSwitch: null, stability: null };
  const client = await browserClient();
  let targetId = '';
  let reusedTarget = false;
  try {
    const pages = await httpJSON('http://127.0.0.1:9222/json/list');
    const openDouyin = pages.find((page) => page.type === 'page' && /douyin\.com/.test(page.url)
      && (useCurrentTarget || /(\/video\/|modal_id=)/.test(page.url)));
    const discovered = openDouyin ? openDouyin.url : '';
    const url = requestedUrl || discovered || (openEntry ? 'https://www.douyin.com/jingxuan' : '');
    if (!url) {
      report.blocked.push(useCurrentTarget ? '未找到已打开的抖音标签页，也没有提供 --url=' : '未找到已打开的抖音视频页，也没有提供 --url=');
      console.log(JSON.stringify(report, null, 2));
      process.exit(2);
    }
    const targetUrl = new URL(url);
    report.target = targetUrl.origin + '/...' + (targetUrl.search ? '?...' : '');
    const created = useCurrentTarget && openDouyin
      ? { targetId: openDouyin.id }
      : await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    reusedTarget = useCurrentTarget && !!openDouyin;
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.sessionId;
    await client.send('Target.activateTarget', { targetId }).catch(() => {});
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: shim + '\n' + userscript + '\nwindow.__OB_TEST__ = window.OB;\n' }, sessionId);
    if (reusedTarget) await client.send('Page.reload', { ignoreCache: true }, sessionId);
    else await client.send('Page.navigate', { url }, sessionId);
    await sleep(4000);
    if (openEntry) {
      // 只点击精选页上真实可见的视频卡片，模拟用户打开视频；不调用私有接口，
      // 不点击举报、拉黑、关注或其他平台写入控件。
      await evaluate(client.send, sessionId, `(() => {
        const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
        const cards = Array.from(document.querySelectorAll('.jingxuanVideoCard, [data-e2e="feed-active-video"]'))
          .filter(visible);
        const card = cards[0];
        if (card && typeof card.click === 'function') { card.click(); return { clicked: true, candidates: cards.length }; }
        return { clicked: false, candidates: cards.length };
      })()`);
      await sleep(6000);
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const ready = await evaluate(client.send, sessionId, 'return !!window.__OB_TEST__');
      if (ready) break;
      await sleep(1000);
    }
    await evaluate(client.send, sessionId, `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } return true; })()`);
    for (let attempt = 0; attempt < 30; attempt++) {
      const count = await evaluate(client.send, sessionId, 'return document.querySelectorAll("[data-danmu-id]").length');
      if (count > 0) break;
      await sleep(1000);
    }
    if (verifyAutoDanmaku) {
      // 先在初始播放器弹幕稳定后验证自动规则；评论管理器的滚动/回收可能会
      // 让抖音重挂弹幕层，不能把评论操作后的正常节点回收当成自动规则失败。
      report.autoDanmaku = await evaluate(client.send, sessionId, AUTO_DANMAKU_TEST_SCRIPT);
      const automatic = report.autoDanmaku || {};
      if (!automatic.targetFound) report.blocked.push('blocked：当前页面没有可用于自动规则验证的可靠抖音弹幕');
      else if (!automatic.ruleAdded || !automatic.matched || !automatic.hidden || !automatic.identityPersisted || !automatic.restored) {
        report.blocked.push('抖音自动弹幕规则真实验证未完成：' + JSON.stringify(automatic));
      }
    }
    report.probe = await evaluate(client.send, sessionId, TEST_SCRIPT);
    const probe = report.probe || {};
    if (!probe.hasOB || !probe.adapterReady || !probe.runtime || probe.runtime.version !== version
      || probe.runtime.build !== build || !probe.danmakuCount || !probe.withIdentity) {
      report.blocked.push('临时标签页未渲染出带发送者身份的抖音弹幕（' + JSON.stringify({ danmakuCount: probe.danmakuCount, withIdentity: probe.withIdentity }) + '）');
    } else if (!probe.managerToolPresent || !probe.managerToolVisible || !probe.managerToolRightColumn
      || !probe.commentToolPresent || !probe.commentToolRightColumn || !probe.gearRightColumn
      || !probe.managerPresent || !probe.managerRows || !probe.managerSearchPresent
      || !probe.managerScanPresent || probe.managerSearchWorks === false
      || !probe.managerBatchEnabled || !probe.managerBlocked || !probe.managerRestored
      || !probe.commentManagerPresent || !probe.commentManagerStaysOpen || !probe.commentSearchPresent || !probe.commentLoadPresent
      || probe.commentSearchWorks === false || !probe.commentBatchEnabled
      || (probe.commentModalScopePresent && !probe.commentModalBulkAbsent)
      || !probe.buttonPresent || !probe.buttonInside || !probe.confirmShown || !probe.confirmUid
      || !probe.blocked || !probe.hidden || !probe.restored || probe.noTarget) {
      report.blocked.push('抖音弹幕本地拉黑闭环未完成：' + JSON.stringify(probe));
    }
    if (!report.blocked.length && verifyVideoSwitch) {
      report.videoSwitch = await evaluate(client.send, sessionId, VIDEO_SWITCH_TEST_SCRIPT);
      const switched = report.videoSwitch || {};
      if (!switched.attempted || !switched.managerClosed || !switched.oldRowsAbsent
        || (!switched.newRowsPresent && !switched.emptyNextValid)) {
        report.blocked.push('抖音跨视频弹幕缓存隔离未完成：' + JSON.stringify(switched));
      }
    }
    if (!report.blocked.length) {
      // 抖音切换视频时会先销毁旧播放器，再异步挂载新弹幕/评论节点；
      // 等待平台完成这段过渡后再测稳定性，避免把正常换片空窗计成插件错误。
      if (verifyVideoSwitch) {
        await sleep(1200);
        await evaluate(client.send, sessionId, `(() => {
          const videos = Array.from(document.querySelectorAll('video, audio'));
          const media = videos.find((item) => !item.ended) || videos[0];
          if (media) {
            media.muted = true;
            const playing = media.play();
            if (playing && playing.catch) playing.catch(() => {});
          }
          return true;
        })()`);
        await sleep(3500);
        let resumed = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const state = await evaluate(client.send, sessionId, `return {
            comments: document.querySelectorAll('[data-e2e="comment-item"], .comment-item').length,
          }`);
          if (state && state.comments > 0) { resumed = true; break; }
          await sleep(500);
        }
        if (!resumed) report.blocked.push('抖音换片后弹幕/评论未在过渡窗口内恢复');
      }
      if (!report.blocked.length) report.stability = await runStabilityCheck(client.send, sessionId);
      if (!report.stability.samples || report.stability.heartbeatErrors) {
        report.blocked.push('抖音 ' + durationSeconds + ' 秒稳定性检查出现心跳错误或页面内容消失');
      }
    }
  } catch (error) {
    report.blocked.push(String(error && error.message || error).slice(0, 500));
  } finally {
    if (targetId && !reusedTarget) await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.blocked.length ? 1 : 0);
})().catch((error) => {
  console.error('HARNESS ERROR:', error && error.stack || error);
  process.exit(2);
});

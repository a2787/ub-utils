/* 登录态真实站点只读探针。
 *
 * 当前只支持 Weibo，使用固定 127.0.0.1:9222 的专用 Chrome。源码直接在
 * 导航前注入，GM 存储是内存 stub；不读取 Cookie，不执行微博举报、官方拉黑、
 * 关注、发帖等平台写操作。探针失败或遇到登录/验证码时保留临时标签页。
 *
 * 用法：
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --duration=90
 *   node test/real-login-probe.cjs weibo --current --duration=90
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --scenario=feed --duration=90
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --scenario=feed --observe-empty-feed --duration=30
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --scenario=feed --repeat-inject=2 --duration=90
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --scenario=comments --duration=90
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --scenario=comments --expand-comment-index=0 --verify-reply-modal --duration=90
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const sourceHash = crypto.createHash('sha256').update(userscript).digest('hex');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const build = (userscript.match(/const RUNTIME_BUILD\s*=\s*'([^']+)'/) || [, ''])[1];
const platform = process.argv[2] || '';
const requestedUrlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = requestedUrlArg ? requestedUrlArg.slice('--url='.length) : '';
const useCurrentTarget = process.argv.includes('--current');
const durationArg = process.argv.find((arg) => arg.startsWith('--duration='));
const durationSeconds = Math.max(5, Math.min(600, Number(durationArg ? durationArg.slice(11) : 90) || 90));
const scenarioArg = process.argv.find((arg) => arg.startsWith('--scenario='));
const scenario = scenarioArg ? scenarioArg.slice(11) : 'all';
const targetIdArg = process.argv.find((arg) => arg.startsWith('--target-id='));
const reuseTargetId = targetIdArg ? targetIdArg.slice('--target-id='.length) : '';
const expandArg = process.argv.find((arg) => arg.startsWith('--expand-comment-index='));
const expandCommentIndex = expandArg ? Math.max(0, Number(expandArg.slice('--expand-comment-index='.length)) || 0) : -1;
const blockArg = process.argv.find((arg) => arg.startsWith('--block-comment-index='));
const blockCommentIndex = blockArg ? Math.max(0, Number(blockArg.slice('--block-comment-index='.length)) || 0) : 0;
const verifyReplyModal = process.argv.includes('--verify-reply-modal');
const disableAutoScroll = process.argv.includes('--no-scroll');
const disableQuickBlock = process.argv.includes('--disable-quick-block');
const observeEmptyFeed = process.argv.includes('--observe-empty-feed');
const repeatInjectArg = process.argv.find((arg) => arg.startsWith('--repeat-inject='));
const repeatInjectionCount = Math.max(1, Math.min(4, Number(repeatInjectArg ? repeatInjectArg.slice('--repeat-inject='.length) : 1) || 1));
const feedMode = process.argv.includes('--feed') || scenario === 'feed';

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin + '/...' + (parsed.search ? '?...' : '');
  } catch (error) { return ''; }
}

function safeWeiboUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !/(^|\.)weibo\.com$/.test(parsed.hostname)) return '';
    return parsed.href;
  } catch (error) { return ''; }
}

async function discoverCurrentWeiboUrl() {
  const pages = await httpJSON('http://127.0.0.1:9222/json/list');
  const candidates = Array.isArray(pages) ? pages
    .filter((item) => item && item.type === 'page')
    .map((item) => safeWeiboUrl(item.url))
    .filter(Boolean) : [];
  return candidates[0] || '';
}

function httpJSON(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('CDP HTTP timeout')));
    request.on('error', reject);
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function createClient() {
  const info = await httpJSON('http://127.0.0.1:9222/json/version');
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')));
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch (error) { return; }
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message || 'CDP error'));
    else item.resolve(message.result);
  });
  function send(method, params = {}, sessionId = '', timeout = 15000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeout);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });
  }
  await opened;
  return { send, close: () => { try { socket.close(); } catch (error) {} } };
}

async function evaluate(client, sessionId, expression, timeout = 2500) {
  const result = await client.send('Runtime.evaluate', {
    expression: '(async () => { ' + expression + ' })()',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId, timeout);
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(String(exception || result.exceptionDetails.text || '页面脚本执行失败').slice(0, 500));
  }
  return result.result && result.result.value;
}

function gmShim(showQuickBlock = true) {
  return `
window.__OB_PROBE_SOURCE_HASH__ = ${JSON.stringify(sourceHash)};
window.__OB_PROBE_DIAGNOSTICS__ = { enabled: true, sourceHash: ${JSON.stringify(sourceHash)} };
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'disappear', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:${showQuickBlock ? 'true' : 'false'}, showBulkBlock:true }}) };
window.GM_getValue = (key, fallback) => (key in window.__gm ? window.__gm[key] : fallback);
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => { const add = () => { const style = document.createElement('style'); style.textContent = css; (document.head || document.documentElement).appendChild(style); }; if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script: { version: ${JSON.stringify(version)} } };
window.__OB_PROBE_LONGTASKS__ = { count: 0, total: 0, max: 0 };
try {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__OB_PROBE_LONGTASKS__.count++;
      window.__OB_PROBE_LONGTASKS__.total += Number(entry.duration) || 0;
      window.__OB_PROBE_LONGTASKS__.max = Math.max(window.__OB_PROBE_LONGTASKS__.max, Number(entry.duration) || 0);
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
} catch (error) {}
`;
}

function hotSurfaceExpression() {
  return `(() => {
  const bodyText = document.body && document.body.innerText || '';
  const rankedPanels = Array.from(document.querySelectorAll('.hotBand,.wbpro-side-card7,.wbpro-side-panel'))
    .filter((node) => /热搜|热门榜单|查看完整热搜榜单/.test(node.textContent || ''));
  return {
    panelCount: rankedPanels.length,
    hasHotSearchData: bodyText.includes('查看完整热搜榜单'),
    hasHotNavigation: bodyText.includes('热门榜单'),
    bodyTextLength: bodyText.length,
  };
})()`;
}

function baselineProbeScript() {
  return `
(() => {
  const title = document.title || '';
  const text = ((title) + ' ' + (document.body && document.body.innerText || '')).slice(0, 5000);
  const hasContentSurface = !!document.querySelector('article,.wbpro-list,.card-review,[node-type="comment"],[node-type="comment_list"]');
  const loginPath = /\\/(login|signin)(?:[/?#]|$)/i.test(location.pathname);
  const explicitLoginText = /请登录|登录后(?:查看|继续|评论)|账号登录|密码登录|扫码登录|短信登录/i.test(text);
  return {
    ready: document.readyState,
    loginGate: loginPath || explicitLoginText || (/登录/.test(title) && !hasContentSurface),
    captchaGate: /验证码|安全验证|滑动验证|人机验证|captcha|challenge/i.test(text),
    hasOmniBlock: !!window.OB,
    gearCount: document.querySelectorAll('#ob-gear').length,
    articleCount: document.querySelectorAll('article').length,
    virtualRowCount: document.querySelectorAll('.vue-recycle-scroller__item-view').length,
    hotSurface: ${hotSurfaceExpression()},
  };
})()`;
}

function candidateProbeScript(block) {
  return `
(() => {
  const out = { ready: document.readyState, hasOmniBlock: !!window.OB, selected: false, blocked: false,
    sourceHash: window.__OB_PROBE_SOURCE_HASH__ || '', runtime: window.OB && window.OB.runtime || null,
    runtimeGuard: window.__OB_RUNTIME_GUARD__ ? { ...window.__OB_RUNTIME_GUARD__ } : null,
    articleCount: document.querySelectorAll('article').length,
    virtualRowCount: document.querySelectorAll('.vue-recycle-scroller__item-view').length,
    hotSurface: ${hotSurfaceExpression()} };
  const title = document.title || '';
  const text = (title + ' ' + (document.body && document.body.innerText || '')).slice(0, 5000);
  const hasContentSurface = !!document.querySelector('article,.wbpro-list,.card-review,[node-type="comment"],[node-type="comment_list"]');
  const loginPath = /\\/(login|signin)(?:[/?#]|$)/i.test(location.pathname);
  const explicitLoginText = /请登录|登录后(?:查看|继续|评论)|账号登录|密码登录|扫码登录|短信登录/i.test(text);
  out.loginGate = loginPath || explicitLoginText || (/登录/.test(title) && !hasContentSurface);
  out.captchaGate = /验证码|安全验证|滑动验证|人机验证|captcha|challenge/i.test(text);
  if (!out.hasOmniBlock || out.loginGate || out.captchaGate) return out;
  const adapter = window.OB.adapters && window.OB.adapters.weibo;
  if (!adapter) return out;
  const selectors = [
    '.vue-recycle-scroller__item-view .item1',
    '.wbpro-list > .item1',
    '.wbpro-list .list2 > .item2',
    '.wbpro-layer .wbpro-scroller-item > .item2',
    '.wbpro-layer .vue-recycle-scroller__item-view > .item2',
    '[node-type="reply_list"] .item2',
  ].join(',');
  const candidates = Array.from(document.querySelectorAll(selectors)).filter((node) => {
    const info = adapter.extract(node);
    return !!(info && info.keys && info.keys.length && !window.OB.Index.isBlocked(info.keys));
  });
  const target = candidates[${blockCommentIndex}] || candidates[0];
  if (!target) return out;
  const info = adapter.extract(target);
  out.selected = !!(info && info.keys && info.keys.length);
  if (${block ? 'true' : 'false'} && out.selected) {
    const result = window.OB.Store.addIdentities(info.keys, '探针临时作者', '仅保存在本次内存探针');
    out.blocked = !!(result && result.added >= 0);
    window.__OB_PROBE_BLOCK_TARGET__ = { node: target, keys: info.keys };
  }
  return out;
})()`;
}

function commentManagerProbeScript() {
  return `
 (async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const out = {
    hasOmniBlock: !!window.OB,
    managerAvailable: false,
    fab: false,
    panel: false,
    stayedOpen: false,
    initialRows: 0,
    rows: 0,
    searchPresent: false,
    searchWorks: false,
    loadAllPresent: false,
    refreshPresent: false,
    allSelected: false,
    rootThreadButtons: 0,
    replyThreadButtons: 0,
    threadAction: false,
    threadConfirm: false,
    threadConfirmShape: null,
    threadPartial: false,
    threadBlocked: false,
    threadRestored: false,
    status: '',
  };
  if (!window.OB || !window.OB.adapters || !window.OB.adapters.weibo) return out;
  const adapter = window.OB.adapters.weibo;
  const manager = adapter.commentManager;
  out.managerAvailable = !!manager && (!manager.available || manager.available());
  const comments = Array.from(document.querySelectorAll(
    '.card-review[comment_id],.wbpro-list > .item1,.wbpro-list .list2 > .item2,' +
    '.vue-recycle-scroller__item-view > .wbpro-scroller-item > .item1,' +
    '.wbpro-layer .wbpro-scroller-item > .item2,.wbpro-layer .vue-recycle-scroller__item-view > .item2,' +
    '[node-type="reply_list"] .item2,.list_ul > .item2,.WB_reply > .item2'
  ));
  out.rootThreadButtons = comments.filter((item) => manager && manager.isRootComment(item))
    .reduce((count, item) => count + item.querySelectorAll('.ob-weibo-thread-block').length, 0);
  out.replyThreadButtons = comments.filter((item) => manager && !manager.isRootComment(item))
    .reduce((count, item) => count + item.querySelectorAll('.ob-weibo-thread-block').length, 0);
  const fab = Array.from(document.querySelectorAll('.ob-bulk[data-ob-kind="page"]'))
    .find((item) => /评论作者|评论屏蔽/.test(item.textContent || ''));
  if (!fab || !out.managerAvailable) return out;
  out.fab = true;
  fab.click();
  await pause(2800);
  const panel = document.getElementById('ob-comment-manager');
  if (!panel) return out;
  out.panel = true;
  out.stayedOpen = document.getElementById('ob-comment-manager') === panel;
  out.initialRows = panel.querySelectorAll('.ob-cm-row').length;
  out.rows = out.initialRows;
  const search = panel.querySelector('.ob-cm-search');
  out.searchPresent = !!search;
  if (search && out.rows) {
    const sample = panel.querySelector('.ob-cm-name');
    const term = (sample && sample.textContent || panel.querySelector('.ob-cm-row').getAttribute('data-key') || '').trim();
    search.value = term;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(80);
    out.searchRows = panel.querySelectorAll('.ob-cm-row').length;
    out.searchWorks = out.searchRows > 0;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  out.loadAllPresent = !!panel.querySelector('.ob-cm-load-all');
  out.refreshPresent = !!panel.querySelector('.ob-cm-refresh');
  const checkAll = panel.querySelector('.ob-cm-checkall input');
  if (checkAll) checkAll.click();
  await pause(80);
  const batch = panel.querySelector('.ob-cm-batch');
  out.allSelected = !!checkAll && checkAll.checked && !!batch && !batch.disabled;
  const status = panel.querySelector('.ob-cm-status');
  out.status = status && status.textContent || '';
  const close = panel.querySelector('.ob-cm-close');
  if (close) close.click();
  const rootTarget = comments.find((item) => manager && manager.isRootComment(item)
    && item.querySelector('.ob-weibo-thread-block'));
  const threadButton = rootTarget && rootTarget.querySelector('.ob-weibo-thread-block');
  if (threadButton) {
    const info = manager.extract ? manager.extract(rootTarget) : adapter.extract(rootTarget);
    const key = info && info.keys && info.keys[0] || '';
    threadButton.click();
    await pause(1200);
    const confirm = document.getElementById('ob-confirm');
    const confirmText = confirm && confirm.textContent || '';
    const confirmHead = confirmText.split('\\n')[0] || '';
    out.threadAction = true;
    // 确认框的主体文案可能因“部分加载”附加说明而换行；只验证稳定的
    // 功能标签和作者数量，不把 DOM 空白格式当成产品行为。
    out.threadConfirmShape = {
      present: !!confirm,
      hasThreadLabel: /屏蔽该楼及/.test(confirmHead),
      hasAuthorCount: /屏蔽该楼及\\s*\\d+/.test(confirmHead),
      length: confirmText.length,
    };
    out.threadConfirm = out.threadConfirmShape.present
      && out.threadConfirmShape.hasThreadLabel
      && out.threadConfirmShape.hasAuthorCount;
    out.threadPartial = /部分/.test(confirmText);
    if (confirm) confirm.querySelector('.ob-ok').click();
    await pause(220);
    out.threadBlocked = !!key && window.OB.Index.isBlocked(key);
    const threadToast = document.getElementById('ob-toast');
    const threadUndo = threadToast && threadToast.querySelector('button');
    if (threadUndo) {
      threadUndo.click();
      await pause(220);
      out.threadRestored = !window.OB.Index.isBlocked(key);
    }
  }
  return out;
})()`;
}

function expansionStateScript(articleIndex) {
  return `
(() => {
  const articles = Array.from(document.querySelectorAll('article'));
  const article = articles[${articleIndex}] || null;
  const icon = article && article.querySelector('i[title="评论"], [aria-label="评论"]');
  const target = icon && (icon.closest('div[class*="_item_"]') || icon.parentElement || icon);
  if (!target) return { article: !!article, icon: !!icon, target: false };
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = target.getBoundingClientRect();
  return { article: true, icon: true, target: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`;
}

function installFlashMonitorScript() {
  return `
(() => {
  const state = window.__OB_PROBE_BLOCK_TARGET__;
  const target = state && state.node && state.node.isConnected ? state.node : null;
  const row = target && target.closest('.vue-recycle-scroller__item-view');
  const list = row && row.parentElement;
  const monitor = { startedAt: performance.now(), samples: 0, signatureChanges: 0, targetStateChanges: 0, listMutationRecords: 0, listStyleMutations: 0, rowStyleMutations: 0, maxUnblockedEmptyRows: 0, maxVisibleGap: 0, lastSignature: '', targetStates: [], signatures: [], timer: 0, observer: null };
  window.__OB_PROBE_FLASH__ = monitor;
  if (!row || !list) return { installed: false, target: !!target, row: !!row, list: !!list };
  const sample = () => {
    const rows = Array.from(list.children || []).filter((item) => item.matches && item.matches('.vue-recycle-scroller__item-view'));
    const measurements = rows.map((item) => {
      const rect = item.getBoundingClientRect();
      const contentRect = item.firstElementChild && item.firstElementChild.getBoundingClientRect();
      const style = getComputedStyle(item);
      return { item, rect, contentRect, style };
    });
    const entries = measurements.map(({ item, rect, contentRect, style }) => (
      [Math.round(rect.top), Math.round(rect.height), contentRect ? Math.round(contentRect.top) : 0, contentRect ? Math.round(contentRect.height) : 0, item.style.getPropertyValue('transform'), style.display, style.visibility, item.style.getPropertyValue('opacity')].join(',')
    ));
    const unblockedEmptyRows = measurements.filter(({ item, contentRect, style }) => {
      const inactive = item.style.getPropertyValue('opacity').trim() === '0'
        || style.display === 'none' || style.visibility === 'hidden';
      const blocked = !!item.querySelector('[data-ob-blocked="1"]');
      return !inactive && !blocked && (!contentRect || contentRect.height <= 0);
    }).length;
    const visible = measurements.filter(({ item, contentRect, style }) => {
      const inactive = item.style.getPropertyValue('opacity').trim() === '0'
        || style.display === 'none' || style.visibility === 'hidden';
      const blocked = !!item.querySelector('[data-ob-blocked="1"]');
      return !inactive && !blocked && contentRect && contentRect.height > 0;
    }).sort((left, right) => left.contentRect.top - right.contentRect.top);
    let visibleGap = 0;
    for (let index = 1; index < visible.length; index++) {
      visibleGap = Math.max(visibleGap, visible[index].contentRect.top
        - (visible[index - 1].contentRect.top + visible[index - 1].contentRect.height));
    }
    monitor.maxUnblockedEmptyRows = Math.max(monitor.maxUnblockedEmptyRows, unblockedEmptyRows);
    monitor.maxVisibleGap = Math.max(monitor.maxVisibleGap, Math.round(Math.max(0, visibleGap)));
    const signature = entries.join('|');
    const hidden = target && (target.classList.contains('ob-hidden') || getComputedStyle(target).display === 'none' || target.getBoundingClientRect().height === 0);
    monitor.samples++;
    if (signature !== monitor.lastSignature) {
      monitor.signatureChanges++;
      monitor.lastSignature = signature;
      if (monitor.signatures.length < 120) monitor.signatures.push({ at: Math.round(performance.now() - monitor.startedAt), rows: entries.length, signature });
    }
    const previous = monitor.targetStates.length ? monitor.targetStates[monitor.targetStates.length - 1].hidden : null;
    if (previous !== hidden) {
      monitor.targetStateChanges++;
      if (monitor.targetStates.length < 120) monitor.targetStates.push({ at: Math.round(performance.now() - monitor.startedAt), hidden });
    }
  };
  monitor.observer = new MutationObserver((records) => {
    monitor.listMutationRecords += records.length;
    for (const record of records) {
      if (record.type !== 'attributes') continue;
      if (record.target === list) monitor.listStyleMutations++;
      else if (record.target.matches && record.target.matches('.vue-recycle-scroller__item-view')) monitor.rowStyleMutations++;
    }
  });
  monitor.observer.observe(list, { childList: true, attributes: true, attributeFilter: ['style'] });
  for (const item of list.children || []) {
    if (item.matches && item.matches('.vue-recycle-scroller__item-view')) monitor.observer.observe(item, { attributes: true, attributeFilter: ['style'] });
  }
  sample();
  monitor.timer = setInterval(sample, 50);
  return { installed: true, target: true, row: true, list: true, rowCount: list.children.length };
})()`;
}

function stopFlashMonitorScript() {
  return `
(() => {
  const monitor = window.__OB_PROBE_FLASH__;
  if (!monitor) return null;
  if (monitor.timer) clearInterval(monitor.timer);
  if (monitor.observer) monitor.observer.disconnect();
  monitor.timer = 0;
  monitor.observer = null;
  return { ...monitor, signatures: monitor.signatures.slice(0, 120), targetStates: monitor.targetStates.slice(0, 120) };
})()`;
}

function installFeedMonitorScript() {
  return `
(() => {
  const previous = window.__OB_PROBE_FEED__;
  if (previous) {
    if (previous.timer) clearInterval(previous.timer);
    if (previous.observer) previous.observer.disconnect();
  }
  const state = {
    startedAt: performance.now(), samples: 0, lastY: Number(window.scrollY || 0),
    lastHeight: Number(document.documentElement.scrollHeight || 0), minDy: Infinity,
    maxDy: -Infinity, negativeScrolls: 0, largeScrolls: 0, visualJumps: 0,
    maxResidual: 0, maxDocDelta: 0, mutations: 0, childMutations: 0,
    attrMutations: 0, articleMin: Infinity, articleMax: 0, rowMin: Infinity,
    rowMax: 0, authorMin: Infinity, authorMax: 0, tracked: new Map(),
    timer: 0, observer: null,
  };
  const sample = () => {
    const y = Number(window.scrollY || 0);
    const height = Number(document.documentElement.scrollHeight || 0);
    const dy = y - state.lastY;
    const dh = height - state.lastHeight;
    state.samples++;
    state.minDy = Math.min(state.minDy, dy);
    state.maxDy = Math.max(state.maxDy, dy);
    if (dy < -2) state.negativeScrolls++;
    if (Math.abs(dy) > 1000) state.largeScrolls++;
    state.maxDocDelta = Math.max(state.maxDocDelta, Math.abs(dh));
    const articles = Array.from(document.querySelectorAll('article'));
    const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
    const authors = document.querySelectorAll('.ob-weibo-author-block').length;
    state.articleMin = Math.min(state.articleMin, articles.length);
    state.articleMax = Math.max(state.articleMax, articles.length);
    state.rowMin = Math.min(state.rowMin, rows.length);
    state.rowMax = Math.max(state.rowMax, rows.length);
    state.authorMin = Math.min(state.authorMin, authors);
    state.authorMax = Math.max(state.authorMax, authors);
    for (const article of articles) {
      const rect = article.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const previous = state.tracked.get(article);
      if (previous) {
        // 对同一物理节点扣除窗口滚动量；剩余位移才是内容/回收器重排。
        const residual = (rect.top - previous.top) + (y - previous.y);
        state.maxResidual = Math.max(state.maxResidual, Math.abs(residual));
        if (Math.abs(residual) > 24) state.visualJumps++;
      }
      state.tracked.set(article, { top: rect.top, y });
    }
    state.lastY = y;
    state.lastHeight = height;
  };
  state.observer = new MutationObserver((records) => {
    state.mutations += records.length;
    for (const record of records) {
      if (record.type === 'childList') state.childMutations++;
      else if (record.type === 'attributes') state.attrMutations++;
    }
  });
  state.observer.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'],
  });
  sample();
  state.timer = setInterval(sample, 50);
  window.__OB_PROBE_FEED__ = state;
  return {
    installed: true, y: state.lastY, height: state.lastHeight,
    articles: document.querySelectorAll('article').length,
    rows: document.querySelectorAll('.vue-recycle-scroller__item-view').length,
  };
})()`;
}

function stopFeedMonitorScript() {
  return `
(() => {
  const state = window.__OB_PROBE_FEED__;
  if (!state) return null;
  if (state.timer) clearInterval(state.timer);
  if (state.observer) state.observer.disconnect();
  state.timer = 0;
  state.observer = null;
  return {
    durationMs: Math.round(performance.now() - state.startedAt),
    samples: state.samples, minDy: state.minDy, maxDy: state.maxDy,
    negativeScrolls: state.negativeScrolls, largeScrolls: state.largeScrolls,
    visualJumps: state.visualJumps, maxResidual: state.maxResidual,
    maxDocDelta: state.maxDocDelta, mutations: state.mutations,
    childMutations: state.childMutations, attrMutations: state.attrMutations,
    articleMin: state.articleMin, articleMax: state.articleMax,
    rowMin: state.rowMin, rowMax: state.rowMax,
    authorMin: state.authorMin, authorMax: state.authorMax,
    tracked: state.tracked.size, y: Number(window.scrollY || 0),
    height: Number(document.documentElement.scrollHeight || 0),
  };
})()`;
}

async function performanceMetrics(client, sessionId) {
  try {
    const result = await client.send('Performance.getMetrics', {}, sessionId, 2500);
    const values = Object.create(null);
    for (const item of result.metrics || []) values[item.name] = item.value;
    return {
      taskDuration: Number(values.TaskDuration || 0),
      scriptDuration: Number(values.ScriptDuration || 0),
      layoutDuration: Number(values.LayoutDuration || 0),
      recalcStyleDuration: Number(values.RecalcStyleDuration || 0),
      layoutCount: Number(values.LayoutCount || 0),
      recalcStyleCount: Number(values.RecalcStyleCount || 0),
    };
  } catch (error) { return { error: String(error && error.message || error) }; }
}

async function processMetrics(client) {
  try {
    const result = await client.send('SystemInfo.getProcessInfo', {}, '', 2500);
    const renderers = (result.processInfo || []).filter((item) => item.type === 'renderer');
    return { rendererCount: renderers.length, rendererCpuTime: renderers.reduce((sum, item) => sum + (Number(item.cpuTime) || 0), 0) };
  } catch (error) { return { error: String(error && error.message || error) }; }
}

async function expandCommentAction(client, sessionId, articleIndex) {
  const point = await evaluate(client, sessionId, `return (${expansionStateScript(articleIndex).trim()});`, 3000);
  if (!point || !point.target) return point;
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId, 2500);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId, 2500);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId, 2500);
  await sleep(2500);
  return await evaluate(client, sessionId, `
    return {
      article: true,
      commentLists: document.querySelectorAll('.wbpro-list').length,
      rootComments: document.querySelectorAll('.wbpro-list > .item1').length,
      virtualRows: document.querySelectorAll('.vue-recycle-scroller__item-view').length,
    };
  `, 3000);
}

async function verifyReplyModalAction(client, sessionId) {
  const point = await evaluate(client, sessionId, `
    const controls = Array.from(document.querySelectorAll('.item2 > .text > a[href="javascript:;"], .item2 > .text > a'))
      .filter((item) => {
        const text = (item.textContent || '').replace(/\\s+/g, ' ').trim();
        const rect = item.getBoundingClientRect();
        return /^共\\s*\\d+\\s*条回复$/.test(text) && rect.width > 0 && rect.height > 0;
      });
    const target = controls[0] || null;
    if (!target) return { opened: false, reason: '未找到真实的“共 N 条回复”入口', controlCount: controls.length };
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { opened: true, controlCount: controls.length, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  `, 3000);
  if (!point || !point.opened) return point || { opened: false, reason: '回复入口探针执行失败' };
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId, 2500);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId, 2500);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId, 2500);
  await sleep(2500);

  const state = await evaluate(client, sessionId, `
    return (() => {
      const layer = document.querySelector('.woo-modal-main > .wbpro-layer, .woo-modal-main .wbpro-layer');
      const adapter = window.OB && window.OB.adapters && window.OB.adapters.weibo;
      const manager = adapter && adapter.commentManager;
      if (!layer || !manager) return { opened: false, reason: '微博楼中楼弹窗未挂载或适配器不可用' };
      const root = layer.querySelector('.wbpro-list > .item1');
      const replyRows = Array.from(new Set([
        ...layer.querySelectorAll('.wbpro-scroller-item > .item2'),
        ...layer.querySelectorAll('.vue-recycle-scroller__item-view > .item2'),
      ])).filter((item) => item && item.isConnected);
      const identifiedReplies = replyRows.map((item) => ({ item, info: adapter.extract(item) }))
        .filter(({ info }) => info && info.keys && info.keys.length);
      const target = identifiedReplies.find(({ item }) => item.querySelector('.ob-weibo-comment-block')) || null;
      return {
        opened: true,
        root: !!root,
        rootIsRoot: !!root && !!manager.isRootComment(root),
        replyRows: replyRows.length,
        identifiedReplies: identifiedReplies.length,
        localButtonCount: identifiedReplies.reduce((count, item) => count + item.item.querySelectorAll('.ob-weibo-comment-block').length, 0),
        threadButtonCount: identifiedReplies.reduce((count, item) => count + item.item.querySelectorAll('.ob-weibo-thread-block').length, 0),
        rootThreadButtonCount: root ? root.querySelectorAll('.ob-weibo-thread-block').length : 0,
        target: target ? { key: target.info.keys[0] } : null,
      };
    })()
  `, 3000);
  if (!state || !state.opened) return { ...point, ...(state || {}) };
  const { target: targetState, ...safeState } = state;
  const target = targetState;
  if (!target) return { ...point, ...safeState, localBlock: { attempted: false, reason: '弹窗内没有带本地按钮的可识别回复' } };
  const localBlock = await evaluate(client, sessionId, `
    return (() => {
      const layer = document.querySelector('.woo-modal-main > .wbpro-layer, .woo-modal-main .wbpro-layer');
      const adapter = window.OB && window.OB.adapters && window.OB.adapters.weibo;
      const manager = adapter && adapter.commentManager;
      if (!layer || !manager) return { attempted: false, reason: '弹窗已关闭' };
      const rows = Array.from(new Set([
        ...layer.querySelectorAll('.wbpro-scroller-item > .item2'),
        ...layer.querySelectorAll('.vue-recycle-scroller__item-view > .item2'),
      ])).filter((item) => item && item.isConnected);
      const selected = rows.map((item) => ({ item, info: adapter.extract(item) }))
        .find(({ item, info }) => info && info.keys && info.keys[0] === ${JSON.stringify(target.key)}
          && item.querySelector('.ob-weibo-comment-block'));
      if (!selected) return { attempted: false, reason: '目标回复在弹窗中已被回收或身份发生变化' };
      selected.item.querySelector('.ob-weibo-comment-block').click();
      return { attempted: true };
    })()
  `, 3000);
  if (!localBlock || !localBlock.attempted) return { ...point, ...safeState, localBlock };
  await sleep(900);
  const confirm = await evaluate(client, sessionId, `
    return (() => {
      const dialog = document.getElementById('ob-confirm');
      const text = dialog && (dialog.textContent || '');
      if (!dialog) return { present: false, text: '' };
      const ok = dialog.querySelector('.ob-ok');
      if (ok) ok.click();
      void text;
      return { present: true };
    })()
  `, 3000);
  await sleep(350);
  const blocked = await evaluate(client, sessionId, `
    return (() => {
      const layer = document.querySelector('.woo-modal-main > .wbpro-layer, .woo-modal-main .wbpro-layer');
      const adapter = window.OB && window.OB.adapters && window.OB.adapters.weibo;
      const manager = adapter && adapter.commentManager;
      if (!layer || !manager) return { present: false };
      const rows = Array.from(new Set([
        ...layer.querySelectorAll('.wbpro-scroller-item > .item2'),
        ...layer.querySelectorAll('.vue-recycle-scroller__item-view > .item2'),
      ])).filter((item) => item && item.isConnected);
      const reply = rows.map((item) => ({ item, info: adapter.extract(item) }))
        .find(({ info }) => info && info.keys && info.keys[0] === ${JSON.stringify(target.key)});
      const root = layer.querySelector('.wbpro-list > .item1');
      const style = reply && getComputedStyle(reply.item);
      return {
        present: !!reply,
        blocked: !!reply && window.OB.Index.isBlocked(reply.info.keys),
        hidden: !!reply && (reply.item.classList.contains('ob-hidden') || style.display === 'none' || reply.item.getBoundingClientRect().height === 0),
        rootVisible: !!root && getComputedStyle(root).display !== 'none' && root.getBoundingClientRect().height > 0,
      };
    })()
  `, 3000);
  const undo = await evaluate(client, sessionId, `
    return (() => {
      const toast = document.getElementById('ob-toast');
      const button = toast && toast.querySelector('button');
      if (!button) return { present: false };
      button.click();
      return { present: true };
    })()
  `, 3000);
  await sleep(350);
  const restored = await evaluate(client, sessionId, `
    return (() => {
      const layer = document.querySelector('.woo-modal-main > .wbpro-layer, .woo-modal-main .wbpro-layer');
      const adapter = window.OB && window.OB.adapters && window.OB.adapters.weibo;
      const manager = adapter && adapter.commentManager;
      if (!layer || !manager) return { present: false };
      const rows = Array.from(new Set([
        ...layer.querySelectorAll('.wbpro-scroller-item > .item2'),
        ...layer.querySelectorAll('.vue-recycle-scroller__item-view > .item2'),
      ])).filter((item) => item && item.isConnected);
      const reply = rows.map((item) => ({ item, info: adapter.extract(item) }))
        .find(({ info }) => info && info.keys && info.keys[0] === ${JSON.stringify(target.key)});
      const style = reply && getComputedStyle(reply.item);
      return {
        present: !!reply,
        restored: !!reply && !window.OB.Index.isBlocked(reply.info.keys),
        visible: !!reply && !reply.item.classList.contains('ob-hidden') && style.display !== 'none' && reply.item.getBoundingClientRect().height > 0,
      };
    })()
  `, 3000);
  return {
    ...point,
    ...safeState,
    localBlock: { ...localBlock, confirm, blocked, undo, restored },
  };
}

async function heartbeat(client, sessionId, report) {
  const started = Date.now();
  try {
    const state = await evaluate(client, sessionId, `return (${baselineProbeScript().trim()});`, 1500);
    report.heartbeats.push({ latencyMs: Date.now() - started, ...state });
    return true;
  } catch (error) {
    report.heartbeatErrors.push({ latencyMs: Date.now() - started, error: String(error && error.message || error).slice(0, 250) });
    return false;
  }
}

async function runScenario(client, url, name, inject, block) {
  const report = {
    scenario: name,
    target: redactUrl(url),
    sourceHash: inject ? sourceHash : '',
    version: inject ? version : '',
    build: inject ? build : '',
    injectionCount: inject ? repeatInjectionCount : 0,
    injected: !!inject,
    targetId: '',
    sessionId: '',
    heartbeats: [],
    heartbeatErrors: [],
    longtasks: null,
    pageMetricsBefore: null,
    pageMetricsAfter: null,
    processBefore: null,
    processAfter: null,
    page: null,
    commentManager: null,
    replyModal: null,
    blocked: [],
    feed: null,
    emptyFeedObserved: false,
  };
  const created = reuseTargetId
    ? { targetId: reuseTargetId }
    : await client.send('Target.createTarget', { url: 'about:blank' });
  report.targetId = created.targetId;
  const attached = await client.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  report.sessionId = attached.sessionId;
  let injectedScriptId = '';
  try {
    await client.send('Target.activateTarget', { targetId: created.targetId });
    await client.send('Page.enable', {}, report.sessionId);
    await client.send('Performance.enable', {}, report.sessionId);
    // 专用调试 Chrome 的新标签可能继承 500x1 一类的探针视口；微博在该
    // 视口下只渲染导航占位，不能作为真实 DOM/滚动证据。固定桌面视口并置前，
    // 不改变用户主浏览器的窗口或登录态。
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    }, report.sessionId);
    await client.send('Page.bringToFront', {}, report.sessionId).catch(() => {});
    if (inject) {
      const injected = await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: Array.from({ length: repeatInjectionCount }, () => (
          gmShim(!disableQuickBlock) + '\n' + userscript + '\nwindow.__OB_TEST__ = window.OB;\n'
        )).join('\n'),
      }, report.sessionId);
      injectedScriptId = injected && injected.identifier || '';
    }
    report.processBefore = await processMetrics(client);
    if (reuseTargetId) {
      // 对现有标签页强制经过一个新 document，确保本轮刚注册的
      // addScriptToEvaluateOnNewDocument 不会被同文档导航/BFCache 跳过。
      await client.send('Page.navigate', { url: 'about:blank' }, report.sessionId, 10000);
      await sleep(250);
    }
    await client.send('Page.navigate', { url }, report.sessionId, 20000);
    await sleep(5000);
    report.page = inject
      ? await evaluate(client, report.sessionId, `return (${candidateProbeScript(block).trim()});`, 3000)
      : await evaluate(client, report.sessionId, `return (${baselineProbeScript().trim()});`, 3000);
    report.pageMetricsBefore = await performanceMetrics(client, report.sessionId);
    if (!report.page || report.page.loginGate || report.page.captchaGate) {
      report.blocked.push(report.page && report.page.captchaGate ? '验证码/安全验证拦截' : '登录页拦截');
      return report;
    }
    if (inject && expandCommentIndex >= 0) {
      report.commentExpansion = await expandCommentAction(client, report.sessionId, expandCommentIndex)
        .catch((error) => ({ error: String(error && error.message || error).slice(0, 300) }));
    }
    if (inject && expandCommentIndex >= 0) {
      report.page = await evaluate(client, report.sessionId, `return (${candidateProbeScript(block).trim()});`, 3000);
    }
    if (inject && (!report.page.hasOmniBlock || report.page.sourceHash !== sourceHash
      || !report.page.runtime || report.page.runtime.version !== version
      || report.page.runtime.build !== build)) {
      report.blocked.push('候选运行标识与当前工作区源码不一致');
      return report;
    }
    if (inject && repeatInjectionCount > 1
      && (!report.page.runtimeGuard || report.page.runtimeGuard.active !== true
        || report.page.runtimeGuard.duplicateExecutions !== repeatInjectionCount - 1)) {
      report.blocked.push('同文档重复注入运行锁计数不符合预期');
      return report;
    }
    const emptyFeedObserved = feedMode && (!report.page || report.page.articleCount < 1 || report.page.virtualRowCount < 1);
    report.emptyFeedObserved = emptyFeedObserved;
    if (emptyFeedObserved && !observeEmptyFeed) {
      report.blocked.push('真实微博无限流页面未渲染可测帖子卡片/回收行');
      return report;
    }
    if (inject && !feedMode && !report.page.selected) {
      report.blocked.push('登录态页面没有可解析的微博评论目标');
      return report;
    }
      if (inject && name === 'comments') {
      report.commentManager = await evaluate(client, report.sessionId,
        'return (' + commentManagerProbeScript().trim() + ');', 12000)
        .catch((error) => ({ error: String(error && error.message || error).slice(0, 300) }));
      const manager = report.commentManager || {};
      if (!manager.fab || !manager.panel || !manager.stayedOpen || !manager.rows
        || !manager.searchPresent || !manager.loadAllPresent || !manager.refreshPresent
        || !manager.searchWorks || !manager.allSelected || manager.replyThreadButtons !== 0
        || !manager.threadAction || !manager.threadConfirm || !manager.threadPartial
        || !manager.threadBlocked || !manager.threadRestored) {
        report.blocked.push('微博统一评论管理器未能在登录态页面完成只读打开、自动读取、搜索/全选或主评论楼入口边界检查');
      }
    }
    if (inject && name === 'comments' && verifyReplyModal) {
      report.replyModal = await verifyReplyModalAction(client, report.sessionId)
        .catch((error) => ({ opened: false, reason: String(error && error.message || error).slice(0, 300) }));
      const modal = report.replyModal || {};
      const localBlock = modal.localBlock && modal.localBlock.blocked || {};
      const restored = modal.localBlock && modal.localBlock.restored || {};
      if (!modal.opened || !modal.root || !modal.rootIsRoot || modal.replyRows < 1
        || modal.identifiedReplies < 1 || modal.localButtonCount < modal.identifiedReplies
        || modal.threadButtonCount !== 0 || modal.rootThreadButtonCount !== 1
        || !modal.localBlock || !modal.localBlock.confirm || !localBlock.blocked || !localBlock.hidden
        || !localBlock.rootVisible || !modal.localBlock.undo || !modal.localBlock.undo.present
        || !restored.restored || !restored.visible) {
        report.blocked.push('微博真实楼中楼弹窗未能完成回复识别、主/子评论入口边界或回复隐藏/撤销检查');
      }
    }
    if (inject && block) {
      // 微博首轮虚拟列表可能要等下一次扫描周期才接管刚加载的评论；固定 500ms
      // 会把正常时序误报成失败，因此只在短超时内轮询到隐藏状态。
      report.localBlock = { selected: false, connected: false, hidden: false };
      for (let attempt = 0; attempt < 30; attempt++) {
        report.localBlock = await evaluate(client, report.sessionId, `
          const state = window.__OB_PROBE_BLOCK_TARGET__;
          const target = state && state.node && state.node.isConnected ? state.node : null;
          const hidden = !!target && (target.classList.contains('ob-hidden')
            || getComputedStyle(target).display === 'none'
            || target.getBoundingClientRect().height === 0);
          return { selected: !!state, connected: !!target, hidden };
        `, 2500).catch(() => ({ selected: false, connected: false, hidden: false }));
        if (report.localBlock.hidden) break;
        await sleep(100);
      }
      if (!report.localBlock.hidden) report.blocked.push('内存本地屏蔽未在当前微博评论页确认');
      report.flashMonitor = await evaluate(client, report.sessionId,
        'return (' + installFlashMonitorScript().trim() + ');', 3000).catch((error) => ({ installed: false, error: String(error && error.message || error).slice(0, 300) }));
    }
    if (feedMode) {
      report.feedMonitor = await evaluate(client, report.sessionId,
        'return (' + installFeedMonitorScript().trim() + ');', 3000)
        .catch((error) => ({ installed: false, error: String(error && error.message || error).slice(0, 300) }));
      if (!report.feedMonitor || report.feedMonitor.installed === false) {
        report.blocked.push('无限流滚动诊断未能安装');
        return report;
      }
    }
    const initialScrollY = inject
      ? await evaluate(client, report.sessionId, 'return Number(window.scrollY || 0)', 1500).catch(() => 0)
      : 0;
    const deadline = Date.now() + durationSeconds * 1000;
    let nextScrollAt = Date.now() + (feedMode ? 800 : 5000);
    while (Date.now() < deadline) {
      await heartbeat(client, report.sessionId, report);
      if (!disableAutoScroll && Date.now() >= nextScrollAt && (feedMode || inject)) {
        const scrollExpression = feedMode
          ? 'const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); window.scrollTo(0, Math.min(max, Number(window.scrollY || 0) + 700)); return true'
          : `window.scrollBy(0, 700); setTimeout(() => window.scrollTo(0, ${initialScrollY}), 900); return true`;
        await evaluate(client, report.sessionId, scrollExpression, 1500)
          .catch(() => {});
        nextScrollAt = Date.now() + (feedMode ? 800 : 5000);
      }
      await sleep(500);
    }
    report.pageMetricsAfter = await performanceMetrics(client, report.sessionId);
    report.processAfter = await processMetrics(client);
    report.diagnostics = await evaluate(client, report.sessionId,
      'return window.OB && window.OB.diagnostics ? { ...window.OB.diagnostics } : null', 1500).catch(() => null);
    report.longtasks = await evaluate(client, report.sessionId,
      'return window.__OB_PROBE_LONGTASKS__ || null', 1500).catch(() => null);
    if (feedMode) {
      report.feed = await evaluate(client, report.sessionId,
        'return (' + stopFeedMonitorScript().trim() + ');', 2500).catch(() => null);
    }
    if (emptyFeedObserved) report.blocked.push('真实微博无限流页面未渲染可测帖子卡片/回收行');
    if (block) {
      report.flash = await evaluate(client, report.sessionId,
        'return (' + stopFlashMonitorScript().trim() + ');', 2500).catch(() => null);
      if (report.flash && report.flash.maxUnblockedEmptyRows > 0) {
        report.blocked.push('采样到未屏蔽活动虚拟行零高度');
      }
    }
    const latencies = report.heartbeats.map((item) => item.latencyMs).sort((a, b) => a - b);
    report.p95HeartbeatMs = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;
    if (report.heartbeatErrors.length) report.blocked.push('页面心跳出现 CDP 超时，标签页已保留');
    return report;
  } catch (error) {
    report.blocked.push(String(error && error.message || error).slice(0, 500));
    return report;
  } finally {
    // 复用 --target-id 时，初始化脚本只应服务于本轮导航；若一直保留，
    // 后续每次刷新都会叠加一份候选脚本，制造重复 UI 和重复观察器。
    if (injectedScriptId) {
      await client.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: injectedScriptId,
      }, report.sessionId).catch(() => {});
    }
  }
}

(async () => {
  const report = {
    platform,
    target: redactUrl(requestedUrl),
    sourceHash,
    version,
    build,
    durationSeconds,
    scenario,
    readOnly: true,
    scenarios: [],
    blocked: [],
  };
  if (platform !== 'weibo') report.blocked.push('当前探针只支持 weibo');
  let url = safeWeiboUrl(requestedUrl);
  if (!url && useCurrentTarget) {
    try { url = await discoverCurrentWeiboUrl(); }
    catch (error) { report.blocked.push('无法从专用 Chrome 当前标签页发现微博目标'); }
  }
  if (!url) report.blocked.push('必须通过 --url= 或 --current 提供 https://weibo.com/... 运行时目标');
  if (report.blocked.length) { console.log(JSON.stringify(report, null, 2)); process.exit(2); }
  let client;
  try {
    client = await createClient();
    const modes = scenario === 'all' ? [['baseline', false, false], ['empty', true, false], ['blocked', true, true]]
      : [[scenario, scenario !== 'baseline', scenario === 'blocked']];
    for (const [name, inject, block] of modes) {
      const item = await runScenario(client, url, name, inject, block);
      report.scenarios.push(item);
      if (item.blocked.length) {
        report.blocked.push(name + ': ' + item.blocked.join('；'));
        if (item.page && (item.page.loginGate || item.page.captchaGate)) break;
      }
      // 只有正常完成的标签页才关闭；失败页保留给用户处理或后续诊断。
      if (!item.blocked.length && item.targetId && !reuseTargetId) {
        await client.send('Target.closeTarget', { targetId: item.targetId }).catch(() => {});
      }
    }
  } catch (error) {
    report.blocked.push(String(error && error.message || error).slice(0, 500));
  } finally {
    if (client) client.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.blocked.length ? 1 : 0);
})().catch((error) => { console.error('PROBE ERROR:', error && error.stack || error); process.exit(2); });

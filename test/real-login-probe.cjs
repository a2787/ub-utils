/* 登录态真实站点只读探针。
 *
 * 当前只支持 Weibo，使用固定 127.0.0.1:9222 的专用 Chrome。源码直接在
 * 导航前注入，GM 存储是内存 stub；不读取 Cookie，不执行微博举报、官方拉黑、
 * 关注、发帖等平台写操作。探针失败或遇到登录/验证码时保留临时标签页。
 *
 * 用法：
 *   node test/real-login-probe.cjs weibo --url=https://weibo.com/... --duration=90
 *   node test/real-login-probe.cjs weibo --current --duration=90
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
const expandArg = process.argv.find((arg) => arg.startsWith('--expand-comment-index='));
const expandCommentIndex = expandArg ? Math.max(0, Number(expandArg.slice('--expand-comment-index='.length)) || 0) : -1;
const blockArg = process.argv.find((arg) => arg.startsWith('--block-comment-index='));
const blockCommentIndex = blockArg ? Math.max(0, Number(blockArg.slice('--block-comment-index='.length)) || 0) : 0;
const disableAutoScroll = process.argv.includes('--no-scroll');

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

function gmShim() {
  return `
window.__OB_PROBE_SOURCE_HASH__ = ${JSON.stringify(sourceHash)};
window.__OB_PROBE_DIAGNOSTICS__ = { enabled: true, sourceHash: ${JSON.stringify(sourceHash)} };
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'disappear', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true }}) };
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
  };
})()`;
}

function candidateProbeScript(block) {
  return `
(() => {
  const out = { ready: document.readyState, hasOmniBlock: !!window.OB, selected: false, blocked: false,
    sourceHash: window.__OB_PROBE_SOURCE_HASH__ || '', runtime: window.OB && window.OB.runtime || null };
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
    blocked: [],
  };
  const created = await client.send('Target.createTarget', { url: 'about:blank' });
  report.targetId = created.targetId;
  const attached = await client.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  report.sessionId = attached.sessionId;
  try {
    await client.send('Target.activateTarget', { targetId: created.targetId });
    await client.send('Page.enable', {}, report.sessionId);
    await client.send('Performance.enable', {}, report.sessionId);
    if (inject) {
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: gmShim() + '\n' + userscript + '\nwindow.__OB_TEST__ = window.OB;\n',
      }, report.sessionId);
    }
    report.processBefore = await processMetrics(client);
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
    if (inject && !report.page.selected) {
      report.blocked.push('登录态页面没有可解析的微博评论目标');
      return report;
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
    const initialScrollY = inject
      ? await evaluate(client, report.sessionId, 'return Number(window.scrollY || 0)', 1500).catch(() => 0)
      : 0;
    const deadline = Date.now() + durationSeconds * 1000;
    let nextScrollAt = Date.now() + 5000;
    while (Date.now() < deadline) {
      await heartbeat(client, report.sessionId, report);
      if (inject && !disableAutoScroll && Date.now() >= nextScrollAt) {
        await evaluate(client, report.sessionId,
          `window.scrollBy(0, 700); setTimeout(() => window.scrollTo(0, ${initialScrollY}), 900); return true`, 1500)
          .catch(() => {});
        nextScrollAt = Date.now() + 5000;
      }
      await sleep(500);
    }
    report.pageMetricsAfter = await performanceMetrics(client, report.sessionId);
    report.processAfter = await processMetrics(client);
    report.diagnostics = await evaluate(client, report.sessionId,
      'return window.OB && window.OB.diagnostics ? { ...window.OB.diagnostics } : null', 1500).catch(() => null);
    report.longtasks = await evaluate(client, report.sessionId,
      'return window.__OB_PROBE_LONGTASKS__ || null', 1500).catch(() => null);
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
      if (!item.blocked.length && item.targetId) await client.send('Target.closeTarget', { targetId: item.targetId }).catch(() => {});
    }
  } catch (error) {
    report.blocked.push(String(error && error.message || error).slice(0, 500));
  } finally {
    if (client) client.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.blocked.length ? 1 : 0);
})().catch((error) => { console.error('PROBE ERROR:', error && error.stack || error); process.exit(2); });

/* 抖音登录态只读探针（需要用户调试浏览器 127.0.0.1:9222）。
 * 在用户已登录的浏览器里开一个临时标签页，注入带内存 GM 存储的 userscript，
 * 只操作脚本自身 UI；不读取/导出 Cookie，不点击平台写入控件，结束后关闭标签页。
 * 运行：node test/real-douyin-probe.cjs [--url=https://www.douyin.com/...]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = urlArg ? urlArg.slice('--url='.length) : '';

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
const out = { hasOB: !!window.__OB_TEST__, danmakuCount: document.querySelectorAll('[data-danmu-id]').length, errors: [] };
if (!out.hasOB) return out;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, ms) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (fn()) return true; await pause(80); } return !!fn(); };
const OB = window.__OB_TEST__;
const adapter = OB.adapters.douyin;
out.adapterReady = !!adapter;
if (!adapter) return out;
const items = Array.from(document.querySelectorAll('[data-danmu-id]'));
const withIdentity = items.filter((el) => String(el.getAttribute('data-danmaku-user-id') || el.getAttribute('data-danmu-user-id') || '').trim());
out.withIdentity = withIdentity.length;
out.sample = withIdentity.slice(0, 3).map((el) => ({
  attrs: { danmuId: el.getAttribute('data-danmu-id'), uid: el.getAttribute('data-danmaku-user-id') || el.getAttribute('data-danmu-user-id'), isAuthor: el.getAttribute('data-is-danmu-author') },
  text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
}));
const target = withIdentity.find((el) => {
  const info = adapter.extract(el);
  const uid = info && info.keys && info.keys.find((key) => key.startsWith('douyin:uid:'));
  return !!uid && !OB.Index.isBlocked(info.keys);
});
if (!target) { out.noTarget = true; return out; }
const targetInfo = adapter.extract(target);
const uidKey = targetInfo.keys.find((key) => key.startsWith('douyin:uid:'));
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
out.uid = uidKey;
const authorDm = document.querySelector('[data-danmu-id][data-is-danmu-author="true"]');
out.authorDanmakuCount = document.querySelectorAll('[data-danmu-id][data-is-danmu-author="true"]').length;
if (authorDm) {
  const info = adapter.extract(authorDm);
  out.authorKeys = info && info.keys || [];
}
return out;
`;

(async () => {
  const report = { version, blocked: [], probe: null };
  const client = await browserClient();
  let targetId = '';
  try {
    const pages = await httpJSON('http://127.0.0.1:9222/json/list');
    const openDouyin = pages.find((page) => page.type === 'page' && /douyin\.com/.test(page.url) && /(\/video\/|modal_id=)/.test(page.url));
    const discovered = openDouyin ? openDouyin.url : '';
    const url = requestedUrl || discovered;
    if (!url) {
      report.blocked.push('未找到已打开的抖音视频页，也没有提供 --url=');
      console.log(JSON.stringify(report, null, 2));
      process.exit(2);
    }
    const targetUrl = new URL(url);
    report.target = targetUrl.origin + '/...' + (targetUrl.search ? '?...' : '');
    const created = await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.sessionId;
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: shim + '\n' + userscript + '\nwindow.__OB_TEST__ = window.OB;\n' }, sessionId);
    await client.send('Page.navigate', { url }, sessionId);
    await sleep(4000);
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
    report.probe = await evaluate(client.send, sessionId, TEST_SCRIPT);
    const probe = report.probe || {};
    if (!probe.hasOB || !probe.adapterReady || !probe.danmakuCount || !probe.withIdentity) {
      report.blocked.push('临时标签页未渲染出带发送者身份的抖音弹幕（' + JSON.stringify({ danmakuCount: probe.danmakuCount, withIdentity: probe.withIdentity }) + '）');
    } else if (!probe.buttonPresent || !probe.buttonInside || !probe.confirmShown || !probe.confirmUid
      || !probe.blocked || !probe.hidden || !probe.restored || probe.noTarget) {
      report.blocked.push('抖音弹幕本地拉黑闭环未完成：' + JSON.stringify(probe));
    }
  } catch (error) {
    report.blocked.push(String(error && error.message || error).slice(0, 500));
  } finally {
    if (targetId) await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.blocked.length ? 1 : 0);
})().catch((error) => {
  console.error('HARNESS ERROR:', error && error.stack || error);
  process.exit(2);
});

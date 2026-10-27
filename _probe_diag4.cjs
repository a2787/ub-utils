'use strict';
const http = require('http');
const ENDPOINT = 'http://127.0.0.1:9222';
function httpJSON(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', (c) => { body += c; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    request.on('timeout', () => request.destroy(new Error('CDP HTTP timeout')));
    request.on('error', reject);
  });
}
(async () => {
  const info = await httpJSON(ENDPOINT + '/json/version');
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  const pending = new Map(); let nextId = 1;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', () => reject(new Error('ws fail'))); });
  socket.addEventListener('message', (event) => {
    let m; try { m = JSON.parse(String(event.data)); } catch (e) { return; }
    if (!m.id || !pending.has(m.id)) return;
    const item = pending.get(m.id); pending.delete(m.id);
    if (m.error) item.reject(new Error(m.error.message)); else item.resolve(m.result || {});
  });
  const send = (method, params = {}, sessionId = '', timeout = 20000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, timeout);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject });
      const payload = { id, method, params }; if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });
  };
  const created = await send('Target.createTarget', { url: 'https://www.bilibili.com/' });
  const targetId = created.targetId;
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await new Promise((r) => setTimeout(r, 16000));
  const raw = await send('Runtime.evaluate', { expression: `(() => {
    const find = (node, selector) => {
      if (!node) return null;
      if (node.nodeType === 1 && node.matches && node.matches(selector)) return node;
      if (node.shadowRoot) { const inside = find(node.shadowRoot, selector); if (inside) return inside; }
      for (const child of node.children || []) { const inside = find(child, selector); if (inside) return inside; }
      return null;
    };
    const anchor = find(document, 'a[href*="/video/"]');
    return { found: !!anchor, href: anchor ? 'bilibili.com' + new URL(anchor.href).pathname : '' };
  })()`, returnByValue: true }, sessionId, 25000);
  console.log('RAW ' + JSON.stringify(raw).slice(0, 500));
  const wrapped = await send('Runtime.evaluate', { expression: `(async () => { return (() => { const a = document.querySelector('a[href*="/video/"]'); return { qsa: !!a, deep: (() => { const f = (n, s) => { if (!n) return null; if (n.nodeType === 1 && n.matches && n.matches(s)) return n; if (n.shadowRoot) { const i = f(n.shadowRoot, s); if (i) return i; } for (const c of n.children || []) { const i = f(c, s); if (i) return i; } return null; }; return !!f(document, 'a[href*="/video/"]'); })() }; })(); })()`, returnByValue: true, awaitPromise: true }, sessionId, 25000);
  console.log('WRAPPED ' + JSON.stringify(wrapped).slice(0, 500));
  await send('Target.closeTarget', { targetId }).catch(() => {});
  socket.close();
})().catch((error) => { console.error('FAILED: ' + (error && error.message || error)); process.exit(1); });

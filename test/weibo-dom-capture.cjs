/*
 * Read-only Weibo DOM capture for the dedicated browser harness.
 *
 * This tool deliberately captures only structural metadata and bounded text
 * snippets. It does not read cookies or click platform write controls.
 * A target id must be supplied at runtime; no real page is embedded here.
 *
 * Usage:
 *   node test/weibo-dom-capture.cjs --target-id=<CDP page id>
 */
const http = require('http');

const targetArg = process.argv.find((arg) => arg.startsWith('--target-id='));
const targetId = targetArg ? targetArg.slice('--target-id='.length) : '';
const clickArg = process.argv.find((arg) => arg.startsWith('--click-comment-index='));
const clickCommentIndex = clickArg ? Math.max(0, Number(clickArg.slice('--click-comment-index='.length)) || 0) : -1;

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

async function main() {
  if (!targetId) throw new Error('必须通过 --target-id= 提供专用 Chrome 页面目标');
  const pages = await httpJSON('http://127.0.0.1:9222/json/list');
  const page = (Array.isArray(pages) ? pages : []).find((item) => item.id === targetId && item.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到指定的专用 Chrome 页面目标');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
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
  await opened;
  function send(method, params = {}, timeout = 10000) {
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
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression: '(async () => { ' + expression + ' })()',
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(String(result.exceptionDetails.text || '页面脚本执行失败').slice(0, 500));
    }
    return result.result && result.result.value;
  }

  let clickResult = null;
  if (clickCommentIndex >= 0) {
    clickResult = await evaluate(`
      const articles = Array.from(document.querySelectorAll('article'));
      const article = articles[${clickCommentIndex}] || null;
      const icon = article && article.querySelector('i[title="评论"], [aria-label="评论"]');
      const target = icon && (icon.closest('div[class*="_item_"]') || icon.parentElement || icon);
      if (target) target.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = target ? target.getBoundingClientRect() : null;
      return { article: !!article, icon: !!icon, target: !!target, x: rect ? rect.left + rect.width / 2 : 0, y: rect ? rect.top + rect.height / 2 : 0 };
    `);
    if (clickResult && clickResult.target) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clickResult.x, y: clickResult.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickResult.x, y: clickResult.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickResult.x, y: clickResult.y, button: 'left', clickCount: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  const capture = await evaluate(`
    const clean = (value, limit = 120) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const attrs = (node) => {
      const names = ['class', 'role', 'aria-label', 'title', 'action-type', 'data-e2e', 'data-e2e-vid', 'comment_id', 'comment-id', 'data-comment-id', 'node-type', 'href'];
      const out = {};
      for (const name of names) {
        const value = node.getAttribute && node.getAttribute(name);
        if (value) out[name] = clean(value, 180);
      }
      return out;
    };
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
    };
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const shallow = (node) => ({ tag: node.tagName, attrs: attrs(node), box: box(node), text: clean(node.innerText || node.textContent, 160) });
    const selectorCounts = {};
    for (const selector of ['article', '.card-wrap', '.card-feed', '.woo-panel-main', '.wbpro-list', '.item1', '.item2', '.vue-recycle-scroller__item-view', '.wbpro-scroller-item', '[node-type="comment"]', '[node-type="comment_list"]']) {
      selectorCounts[selector] = document.querySelectorAll(selector).length;
    }
    const articles = Array.from(document.querySelectorAll('article, .card-wrap, .card-feed, .woo-panel-main')).slice(0, 8).map((article, index) => {
      const all = Array.from(article.querySelectorAll('*')).filter(visible);
      const controls = all.filter((node) => {
        const role = node.getAttribute('role') || '';
        const action = node.getAttribute('action-type') || '';
        const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
        const cls = typeof node.className === 'string' ? node.className : '';
        return role === 'button' || action || label || /(?:comment|reply|share|like|forward|more|func|opt|action|operate)/i.test(cls);
      }).slice(-80).map(shallow);
      return { index, node: shallow(article), controls };
    });
    const commentActions = Array.from(document.querySelectorAll('i[title="评论"], [aria-label="评论"]')).slice(0, 20).map((node) => ({
      node: shallow(node),
      layout: (() => {
        const row = node.closest('.vue-recycle-scroller__item-view');
        const content = row && row.firstElementChild;
        const rowStyle = row ? getComputedStyle(row) : null;
        const contentStyle = content ? getComputedStyle(content) : null;
        return row && content ? {
          rowOverflow: rowStyle.overflow,
          rowPosition: rowStyle.position,
          rowTransform: rowStyle.transform,
          contentOverflow: contentStyle.overflow,
          contentPosition: contentStyle.position,
          contentTransform: contentStyle.transform,
        } : null;
      })(),
      ancestors: Array.from({ length: 5 }, (_, offset) => {
        let current = node;
        for (let i = 0; i < offset + 1 && current; i++) current = current.parentElement;
        return current && visible(current) ? shallow(current) : null;
      }).filter(Boolean),
    }));
    const comments = Array.from(document.querySelectorAll('.card-review[comment_id], .wbpro-list > .item1, .wbpro-list .list2 > .item2, .vue-recycle-scroller__item-view .item1, .vue-recycle-scroller__item-view .item2, [node-type="reply_list"] .item2')).slice(0, 80).map((node, index) => ({
      index,
      node: shallow(node),
      links: Array.from(node.querySelectorAll('a')).slice(0, 8).map(shallow),
      directChildren: Array.from(node.children || []).map(shallow),
      layout: (() => {
        const row = node.closest('.vue-recycle-scroller__item-view');
        const content = row && row.firstElementChild;
        const rowStyle = row ? getComputedStyle(row) : null;
        const contentStyle = content ? getComputedStyle(content) : null;
        return row && content ? {
          rowOverflow: rowStyle.overflow,
          rowPosition: rowStyle.position,
          rowTransform: rowStyle.transform,
          contentOverflow: contentStyle.overflow,
          contentPosition: contentStyle.position,
          contentTransform: contentStyle.transform,
        } : null;
      })(),
      ancestors: Array.from({ length: 5 }, (_, offset) => {
        let current = node;
        for (let i = 0; i < offset + 1 && current; i++) current = current.parentElement;
        return current && visible(current) ? shallow(current) : null;
      }).filter(Boolean),
    }));
    const runtime = window.OB && window.OB.runtime ? { ...window.OB.runtime } : null;
    const blockedCount = document.querySelectorAll('[data-ob-blocked="1"], .ob-hidden').length;
    return { url: location.origin + location.pathname, title: clean(document.title, 200), ready: document.readyState, bodyTextLength: clean(document.body && document.body.innerText, 5000).length, hasOmniBlock: !!window.OB, runtime, blockedCount, selectorCounts, articles, commentActions, comments };
  `);
  console.log(JSON.stringify({ clickResult, capture }, null, 2));
  socket.close();
}

main().catch((error) => { console.error('CAPTURE ERROR:', error && error.stack || error); process.exitCode = 1; });

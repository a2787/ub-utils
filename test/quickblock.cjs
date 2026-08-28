/* OmniBlock B站回归测试。
 * 覆盖真实页面已捕获的结构：bili-comment-thread-renderer Shadow Root 内
 * bili-comment-renderer / bili-comment-reply-renderer 的 __data.member.mid、
 * bili-comment-menu Shadow DOM 的 <ul id="options"><li>，以及 seg.so protobuf。
 * 运行：node test/quickblock.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const SAVE_SCREENSHOTS = process.argv.includes('--screenshot');

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => {
  window.__gm[k] = v;
  // 本地快照使用独立 GM 键；事务断言只统计主名单提交次数。
  if (k === 'omniblock:data:v1') window.__writes = (window.__writes || 0) + 1;
  else window.__backupWrites = (window.__backupWrites || 0) + 1;
};
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name:'本地内容过滤增强', version:'${LOCAL_VERSION}', namespace:'https://github.com/a2787/ub-utils' } };
window.__cardCalls = [];
window.GM_xmlhttpRequest = (o) => {
  let uid = '';
  try {
    const parsed = new URL(String(o && o.url || ''));
    if (parsed.pathname === '/x/web-interface/card') uid = parsed.searchParams.get('mid') || '';
  } catch(e) {}
  if (!uid) { try { if(o.onerror) o.onerror(new Error('no net in test')); } catch(e){} return { abort(){} }; }
  window.__cardCalls.push(uid);
  const cards = {
    '222': { mid:'222', name:'Candidate Bob', level_info:{ current_level:6 } },
    '33': { mid:'33', name:'Candidate 33', level_info:{ current_level:6 } },
    // 人工合成：真实 CRC32 碰撞对（crc32("86821") === crc32("14740600") === 14e54344）。
    // 两个账号都存活，用于锁住多候选必须人工确认的边界。
    '86821': { mid:'86821', name:'Collision A', level_info:{ current_level:5 } },
    '14740600': { mid:'14740600', name:'Collision B', level_info:{ current_level:4 } },
  };
  setTimeout(() => {
    const card = cards[uid] || null;
    if (o.onload) o.onload({ status:200, responseText:JSON.stringify(card
      ? { code:0, data:{ card } }
      : { code:-404, data:null }) });
  }, 0);
  return { abort(){} };
};
window.GM_openInTab = () => {};
`;
fs.writeFileSync(path.join(ROOT, 'test', '_initqb.js'), SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-qb.js');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站真实结构回归页</title></head><body>
<div id="related"></div>
<bili-comments id="comments"></bili-comments>
<!-- 人工合成：2026-08-23 真站视频页作者区 up-detail-top > a.up-name。 -->
<div class="up-detail-top"><a class="up-name" href="//space.bilibili.com/888">Video Author</a></div>
<section class="bpx-player-dm-wrap" id="dm-panel">
  <ul class="bui-long-list-list">
    <li class="bui-long-list-item" style="height:24px"><div class="dm-info-row">
      <span class="dm-info-time">00:05</span><span class="dm-info-dm" title="hello danmaku">hello danmaku</span><span class="dm-info-date">01-01 00:00</span>
      <span class="dm-info-block-btn" data-action="block">屏蔽用户</span><span class="dm-info-report-btn" data-action="report">举报</span>
    </div></li>
    <li class="bui-long-list-item" style="height:24px"><div class="dm-info-row">
      <span class="dm-info-time">00:09</span><span class="dm-info-dm" title="keep danmaku">keep danmaku</span><span class="dm-info-date">01-01 00:00</span>
      <span class="dm-info-block-btn" data-action="block">屏蔽用户</span><span class="dm-info-report-btn" data-action="report">举报</span>
    </div></li>
  </ul>
</section>
<style>
  #dm-panel .bui-long-list-item { box-sizing:border-box; display:block; width:350px; height:24px; margin:0; }
  /* 人工合成夹具复现真站 long-list 的 reset；浏览器默认 ul padding 不属于弹幕组件布局。 */
  #dm-panel .bui-long-list-list { margin:0; padding:0; list-style:none; }
  #dm-panel .dm-info-row { box-sizing:border-box; display:flex; align-items:center; width:350px; height:24px; position:relative; }
  #dm-panel .dm-info-time { flex:0 0 42px; overflow:hidden; }
  #dm-panel .dm-info-dm { min-width:0; flex:1 1 auto; overflow:hidden; white-space:nowrap; }
  #dm-panel .dm-info-date { flex:0 0 88px; overflow:hidden; }
  #dm-panel .dm-info-block-btn, #dm-panel .dm-info-report-btn { position:absolute; display:none; height:20px; top:2px; }
  #dm-panel .dm-info-block-btn { width:70px; right:10px; }
  #dm-panel .dm-info-row:hover .dm-info-block-btn { display:block; }
</style>
  <script>
  const related = document.getElementById('related');
  for (let i = 0; i < 34; i++) {
    const card = document.createElement('a');
    card.className = 'bili-video-card'; card.href = '//www.bilibili.com/video/BVcard' + i;
    card.__data = { member: { mid: String(9000 + i), uname: '推荐作者' + i } };
    card.textContent = '推荐视频 ' + i; related.appendChild(card);
  }
  const comments = document.getElementById('comments');
  const commentsRoot = comments.attachShadow({mode:'open'});
  const commentsStyle = document.createElement('style'); commentsStyle.textContent = 'bili-comment-thread-renderer{display:block;min-height:24px;margin:0;padding:0}'; commentsRoot.appendChild(commentsStyle);
  function makeComment(mid, uname) {
    const thread = document.createElement('bili-comment-thread-renderer');
    thread.id = 'comment-' + mid;
    const threadRoot = thread.attachShadow({mode:'open'});
    const renderer = document.createElement('bili-comment-renderer');
    renderer.__data = { mid: String(mid), member: { mid: String(mid), uname } };
    const root = renderer.attachShadow({mode:'open'});
    const link = document.createElement('a'); link.className = 'user-name'; link.href = '//space.bilibili.com/' + mid; link.textContent = uname;
    const menu = document.createElement('bili-comment-menu'); menu.__data = { member: { mid: String(mid), uname } };
    const menuRoot = menu.attachShadow({mode:'open'});
    const list = document.createElement('ul'); list.id = 'options';
    for (const label of ['加入黑名单', '举报']) { const item = document.createElement('li'); item.textContent = label; list.appendChild(item); }
    menuRoot.appendChild(list); root.append(link, menu); threadRoot.appendChild(renderer);
    return thread;
  }
  function makeReply(thread, mid, uname) {
    const replies = document.createElement('bili-comment-replies-renderer');
    replies.__data = thread.shadowRoot.querySelector('bili-comment-renderer').__data;
    const repliesRoot = replies.attachShadow({mode:'open'});
    const wrapper = document.createElement('div');
    const renderer = document.createElement('bili-comment-reply-renderer');
    renderer.id = 'reply-' + mid; renderer.style.display = 'block'; renderer.style.height = '20px';
    renderer.__data = { mid: String(mid), member: { mid: String(mid), uname } };
    const root = renderer.attachShadow({mode:'open'});
    const link = document.createElement('a'); link.className = 'user-name'; link.href = '//space.bilibili.com/' + mid; link.textContent = uname;
    const menu = document.createElement('bili-comment-menu'); menu.__data = { member: { mid: String(mid), uname } };
    const menuRoot = menu.attachShadow({mode:'open'});
    const list = document.createElement('ul'); list.id = 'options';
    for (const label of ['加入黑名单', '举报']) { const item = document.createElement('li'); item.textContent = label; list.appendChild(item); }
    menuRoot.appendChild(list); root.append(link, menu); wrapper.appendChild(renderer); repliesRoot.appendChild(wrapper); thread.shadowRoot.appendChild(replies);
    return renderer;
  }
  const first = makeComment(111, 'Alice');
  const second = makeComment(222, 'Bob');
  const third = makeComment(333, 'Carol');
  commentsRoot.append(first, second, third);
  makeReply(third, 444, 'ReplyUser');
  window.__commentRenderer = (mid) => commentsRoot.querySelector('#comment-' + mid).shadowRoot.querySelector('bili-comment-renderer');
  window.__replyRenderer = (mid) => third.shadowRoot.querySelector('bili-comment-replies-renderer').shadowRoot.querySelector('#reply-' + mid);
</script>
</body></html>`;

function varint(value) {
  const out = [];
  let n = value >>> 0;
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n); return out;
}
function bytes(text) { return Array.from(Buffer.from(text, 'utf8')); }
function fieldVarint(number, value) { return [...varint(number << 3), ...varint(value)]; }
function fieldText(number, text) { const body = bytes(text); return [...varint((number << 3) | 2), ...varint(body.length), ...body]; }
function dmElem(hash, content, progress) {
  const body = [...fieldVarint(2, progress), ...fieldText(6, hash), ...fieldText(7, content)];
  return Buffer.from([...varint(10), ...varint(body.length), ...body]);
}
// CRC32("33") = 0a6216d9，用于覆盖必须补齐前导零的 UID -> mid_hash 映射。
const SEGMENT = Buffer.concat([
  dmElem('678f8529', 'hello danmaku', 5000),
  dmElem('a9900557', 'keep danmaku', 9000),
  dmElem('0a6216d9', 'uid mapped danmaku', 11000),
  dmElem('11223344', 'repeat danmaku', 12000),
  dmElem('55667788', 'repeat danmaku', 12100),
  dmElem('fd09ed1d', 'known comment user danmaku', 13000),
  // 人工合成：hash 14e54344 在 1–10 位 UID 空间内有两个存活候选（86821 / 14740600）。
  dmElem('14e54344', 'ambiguous uid danmaku', 14000),
]);
// 人工合成第 2 段：验证右侧列表滚到 6 分钟以后会按行时间按需读取对应 seg.so。
const SEGMENT_2 = Buffer.concat([dmElem('abcdef12', 'later danmaku', 365000)]);
// 1x1 PNG：锁住普通图片请求不经过弹幕网络分支。
const PROBE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// 人工合成：PAKKU 先于 OmniBlock 安装时的公开 pakku_open/pakku_send 回调契约。
const PAKKU_BEFORE = `
(() => {
  const segmentBytes = ${JSON.stringify(Array.from(SEGMENT))};
  const proto = XMLHttpRequest.prototype;
  proto.pakku_open = proto.open;
  proto.open = function (method, url, ...args) {
    this.pakku_url = String(url || '');
    return this.pakku_open(method, url, ...args);
  };
  proto.pakku_send = proto.send;
  proto.send = function (...args) {
    if (!/\\/dm\\/(?:wbi\\/)?web\\/seg\\.so/.test(this.pakku_url || '')) return this.pakku_send(...args);
    const xhr = this;
    xhr.pakku_load_callback = xhr.pakku_load_callback || [];
    if (xhr.onreadystatechange) xhr.pakku_load_callback.push(['readystatechange', xhr.onreadystatechange]);
    if (xhr.onload) xhr.pakku_load_callback.push(['load', xhr.onload]);
    if (xhr.onloadend) xhr.pakku_load_callback.push(['loadend', xhr.onloadend]);
    setTimeout(() => {
      const response = new Uint8Array(segmentBytes).buffer;
      for (const [key, value] of [['response', response], ['readyState', 4], ['status', 200], ['statusText', 'OK']]) {
        Object.defineProperty(xhr, key, { configurable: true, writable: true, value });
      }
      for (const [type, callback] of xhr.pakku_load_callback) callback.call(xhr, new Event(type));
    }, 0);
  };
  const pakkuFetch = window.fetch.bind(window);
  window.fetch = function (input, init) { return pakkuFetch(input, init); };
})();
`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  const requestedSegments = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/dm\/(?:wbi\/)?web\/seg\.so/.test(url)) {
      try { requestedSegments.push(Number(new URL(url).searchParams.get('segment_index') || 0)); } catch (e) {}
    }
  });

  await page.route('**/*', (route) => {
    if (/\/dm\/(?:wbi\/)?web\/seg\.so/.test(route.request().url())) {
      const index = Number(new URL(route.request().url()).searchParams.get('segment_index') || 1);
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: index === 2 ? SEGMENT_2 : SEGMENT });
    }
    if (/\/omniblock-normal-image\.png(?:[?]|$)/.test(route.request().url())) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PROBE_PNG });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ path: path.join(ROOT, 'test', '_initqb.js') });

  try {
    await page.goto('https://www.bilibili.com/video/BV1test', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await wait(1500);

    const emptyDmTool = await page.evaluate(() => {
      const tool = document.getElementById('ob-dm-tool');
      if (!tool) return { exists: false };
      const visible = getComputedStyle(tool).display !== 'none';
      tool.click();
      const panel = document.getElementById('ob-dm-manager');
      const empty = panel && panel.querySelector('.ob-dm-empty');
      const retry = panel && panel.querySelector('.ob-dm-retry');
      const close = panel && panel.querySelector('.ob-dm-close');
      if (close) close.click();
      return {
        exists: true,
        visible,
        text: tool.textContent,
        empty: !!empty && !!empty.textContent.trim(),
        retry: !!retry && getComputedStyle(retry).display !== 'none',
      };
    });
    if (emptyDmTool.exists && emptyDmTool.visible && emptyDmTool.text.includes('(0)') && emptyDmTool.empty && emptyDmTool.retry)
      report.pass.push('QB-R 尚未取得弹幕段时，视频页仍显示弹幕屏蔽(0)、空状态和重新读取入口');
    else report.fail.push('QB-R 弹幕工具零数据入口错误：' + JSON.stringify(emptyDmTool));

    // 回归：普通评论接口、普通 XHR 与图片请求不能被 B站弹幕过滤层改写或阻断。
    const ordinaryTransport = await page.evaluate(async () => {
      const result = { fetch: null, xhr: null, image: null };
      try {
        const response = await fetch('/omniblock-normal-fetch?fixture=1');
        result.fetch = { ok: response.ok, status: response.status, hasFixture: (await response.text()).includes('B站真实结构回归页') };
      } catch (e) { result.fetch = { error: String(e) }; }
      try {
        result.xhr = await new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/omniblock-normal-xhr?fixture=1');
          xhr.onload = () => resolve({ ok: xhr.status === 200, status: xhr.status, hasFixture: (xhr.responseText || '').includes('B站真实结构回归页') });
          xhr.onerror = () => resolve({ error: 'network error' });
          xhr.send();
        });
      } catch (e) { result.xhr = { error: String(e) }; }
      result.image = await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, error: true });
        image.src = '/omniblock-normal-image.png?fixture=1';
        document.body.appendChild(image);
      });
      return result;
    });
    if (ordinaryTransport.fetch && ordinaryTransport.fetch.ok && ordinaryTransport.fetch.status === 200 && ordinaryTransport.fetch.hasFixture
      && ordinaryTransport.xhr && ordinaryTransport.xhr.ok && ordinaryTransport.xhr.status === 200 && ordinaryTransport.xhr.hasFixture
      && ordinaryTransport.image && ordinaryTransport.image.width === 1 && ordinaryTransport.image.height === 1)
      report.pass.push('QB-S 普通评论式 fetch、XHR 和图片请求不受弹幕拦截层影响');
    else report.fail.push('QB-S B站普通请求回归失败：' + JSON.stringify(ordinaryTransport));

    // 人工合成：按 PAKKU 公开 xhr_hook.ts 的 pakku_load_callback 契约伪造响应。
    const pakkuIntercept = await page.evaluate(async (segmentBytes) => {
      const proto = XMLHttpRequest.prototype;
      const omniblockOpen = proto.open;
      const omniblockSend = proto.send;
      const previousPakkuOpen = proto.pakku_open;
      const previousPakkuSend = proto.pakku_send;
      let intercepted = 0;
      proto.pakku_open = omniblockOpen;
      proto.open = function (method, url, ...args) {
        this.pakku_url = String(url || '');
        return this.pakku_open(method, url, ...args);
      };
      proto.pakku_send = omniblockSend;
      proto.send = function (...args) {
        const url = String(this.__obDanmakuUrl || '');
        if (!/\/dm\/(?:wbi\/)?web\/seg\.so/.test(url)) return this.pakku_send(...args);
        intercepted++;
        const xhr = this;
        xhr.pakku_load_callback = xhr.pakku_load_callback || [];
        if (xhr.onreadystatechange) xhr.pakku_load_callback.push(['readystatechange', xhr.onreadystatechange]);
        if (xhr.onload) xhr.pakku_load_callback.push(['load', xhr.onload]);
        if (xhr.onloadend) xhr.pakku_load_callback.push(['loadend', xhr.onloadend]);
        setTimeout(() => {
          const response = new Uint8Array(segmentBytes).buffer;
          for (const [key, value] of [['response', response], ['readyState', 4], ['status', 200], ['statusText', 'OK']]) {
            Object.defineProperty(xhr, key, { configurable: true, writable: true, value });
          }
          for (const [type, callback] of xhr.pakku_load_callback) callback.call(xhr, new Event(type));
        }, 0);
      };
      window.OB.Store.addIdentities(['bili:dmhash:678f8529'], 'PAKKU filter fixture');
      let responseText = '';
      try {
        const response = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&pid=2&segment_index=1');
          xhr.responseType = 'arraybuffer';
          xhr.onload = () => resolve(xhr.response);
          xhr.onerror = () => reject(new Error('PAKKU-equivalent seg.so XHR failed'));
          xhr.send();
        });
        responseText = new TextDecoder().decode(response);
      } finally {
        window.OB.Store.removeIdentity('bili:dmhash:678f8529');
        proto.open = omniblockOpen;
        proto.send = omniblockSend;
        if (previousPakkuOpen === undefined) delete proto.pakku_open;
        else proto.pakku_open = previousPakkuOpen;
        if (previousPakkuSend === undefined) delete proto.pakku_send;
        else proto.pakku_send = previousPakkuSend;
      }
      return {
        intercepted,
        blockedRemoved: !responseText.includes('hello danmaku'),
        unblockedKept: responseText.includes('keep danmaku'),
      };
    }, Array.from(SEGMENT));
    await page.waitForFunction(() => {
      const tool = document.getElementById('ob-dm-tool');
      return !!tool && getComputedStyle(tool).display !== 'none' && /弹幕屏蔽\([1-9]\d*\)/.test(tool.textContent || '');
    }, null, { timeout: 2500, polling: 100 }).catch(() => {});
    const pakkuFallback = await page.evaluate(() => {
      const tool = document.getElementById('ob-dm-tool');
      if (!tool) return { exists: false };
      const visible = getComputedStyle(tool).display !== 'none';
      tool.click();
      const panel = document.getElementById('ob-dm-manager');
      const rows = panel ? panel.querySelectorAll('.ob-dm-sender').length : 0;
      const close = panel && panel.querySelector('.ob-dm-close');
      if (close) close.click();
      return { exists: true, visible, text: tool.textContent, rows };
    });
    if (pakkuIntercept.intercepted === 1 && pakkuIntercept.blockedRemoved && pakkuIntercept.unblockedKept && pakkuFallback.exists && pakkuFallback.visible && pakkuFallback.rows === 6)
      report.pass.push('QB-P PAKKU 等价包装器截走首段 XHR 后，工具仍主动读取且伪造响应先应用本地屏蔽');
    else report.fail.push('QB-P PAKKU/首段时序兼容失败：' + JSON.stringify({ pakkuIntercept, pakkuFallback }));

    const allDmBlocked = await page.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const keys = [
        'bili:dmhash:678f8529', 'bili:dmhash:a9900557', 'bili:dmhash:0a6216d9',
        'bili:dmhash:11223344', 'bili:dmhash:55667788', 'bili:dmhash:fd09ed1d',
        'bili:dmhash:14e54344',
      ];
      const linkedIdentity = 'bili:uid:444';
      const uidOnlyIdentity = 'bili:uid:33';
      const groups = keys.map((key) => ({ keys: [key], label: 'all blocked fixture' }));
      groups[0].keys.push(linkedIdentity);
      groups[2].keys = [uidOnlyIdentity];
      window.OB.Store.addIdentityGroups(groups);
      try {
        const tool = document.getElementById('ob-dm-tool');
        if (!tool) return { tool: false };
        tool.click();
        await pause(80);
        const panel = document.getElementById('ob-dm-manager');
        const rows = panel ? Array.from(panel.querySelectorAll('.ob-dm-sender')) : [];
        const target = rows.find((row) => row.getAttribute('data-ob-dm-content') === 'hello danmaku');
        const unblock = target && target.querySelector('.ob-dm-unblock');
        const allBlockedGray = rows.length === 6 && rows.every((row) => row.getAttribute('data-ob-dm-state') === 'blocked'
          && row.classList.contains('ob-dm-blocked'));
        if (unblock) unblock.click();
        await pause(120);
        const restored = !window.OB.Index.isBlocked('bili:dmhash:678f8529');
        const restoredRow = panel && Array.from(panel.querySelectorAll('.ob-dm-sender'))
          .find((row) => row.getAttribute('data-ob-dm-content') === 'hello danmaku');
        const uidOnlyTarget = panel && Array.from(panel.querySelectorAll('.ob-dm-sender'))
          .find((row) => row.getAttribute('data-ob-dm-content') === 'uid mapped danmaku');
        const uidOnlyUnblock = uidOnlyTarget && uidOnlyTarget.querySelector('.ob-dm-unblock');
        if (uidOnlyUnblock) uidOnlyUnblock.click();
        await pause(120);
        const uidOnlyRestoredRow = panel && Array.from(panel.querySelectorAll('.ob-dm-sender'))
          .find((row) => row.getAttribute('data-ob-dm-content') === 'uid mapped danmaku');
        const result = {
          toolText: tool.textContent,
          rows: rows.length,
          allBlockedGray,
          unblock: !!unblock,
          restored,
          linkedRestored: !window.OB.Index.isBlocked(linkedIdentity),
          restoredState: restoredRow && restoredRow.getAttribute('data-ob-dm-state'),
          restoredButton: !!(restoredRow && restoredRow.querySelector('.ob-dm-single')),
          uidOnlyUnblock: !!uidOnlyUnblock,
          uidOnlyRestored: !window.OB.Index.isBlocked(uidOnlyIdentity)
            && !window.OB.Index.isBlocked('bili:dmhash:0a6216d9'),
          uidOnlyRestoredState: uidOnlyRestoredRow && uidOnlyRestoredRow.getAttribute('data-ob-dm-state'),
        };
        const close = panel && panel.querySelector('.ob-dm-close');
        if (close) close.click();
        return result;
      } finally {
        await pause(50);
        window.OB.Store.removeIdentities([...keys, linkedIdentity, uidOnlyIdentity]);
      }
    });
    if (allDmBlocked.toolText && allDmBlocked.toolText.includes('(7)') && allDmBlocked.rows === 6
      && allDmBlocked.allBlockedGray && allDmBlocked.unblock && allDmBlocked.restored
      && allDmBlocked.linkedRestored && allDmBlocked.restoredState === 'active' && allDmBlocked.restoredButton
      && allDmBlocked.uidOnlyUnblock && allDmBlocked.uidOnlyRestored && allDmBlocked.uidOnlyRestoredState === 'active')
      report.pass.push('QB-S 已屏蔽弹幕仍在管理器灰显，hash/唯一 UID 映射均可取消屏蔽并恢复可操作状态');
    else report.fail.push('QB-S 弹幕已屏蔽展示/取消屏蔽错误：' + JSON.stringify(allDmBlocked));

    const count = await page.evaluate(() => {
      const fab = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => /评论作者|评论屏蔽/.test(el.textContent || ''));
      return { text: fab ? fab.textContent : '', users: window.OB.collectUsers(document).map((item) => item.keys[0]) };
    });
    if (count.text.includes('(4)') && count.users.length === 4 && count.users.includes('bili:uid:444') && !count.users.some((key) => key.includes('9000')))
      report.pass.push('QB-A 本页统计含已加载楼中楼共 4 位评论作者，不计 34 张推荐视频卡');
    else report.fail.push('QB-A 评论统计错误：' + JSON.stringify(count));

    const menu = await page.evaluate(() => {
      const renderer = window.__commentRenderer('111');
      const list = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('#options');
      const button = list.querySelector('.ob-quick');
      return { tag: button && button.tagName, text: button && button.textContent, count: list.querySelectorAll('.ob-quick').length };
    });
    const threadMenu = await page.evaluate(() => {
      const renderer = window.__commentRenderer('111');
      const list = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('#options');
      return { count: list.querySelectorAll('.ob-thread-quick').length, text: list.querySelector('.ob-thread-quick') && list.querySelector('.ob-thread-quick').textContent };
    });
    if (menu.tag === 'LI' && menu.text.includes('本地拉黑') && menu.count === 2 && threadMenu.count === 1)
      report.pass.push('QB-B 真实 bili-comment-menu #options 菜单注入一个本地拉黑和一个楼回复入口');
    else report.fail.push('QB-B 评论菜单注入失败：' + JSON.stringify(menu));

    const replyBlock = await page.evaluate(async () => {
      const renderer = window.__replyRenderer('444');
      const button = renderer && renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick');
      if (!renderer || !button) return { exists: false };
      let node = renderer;
      let thread = null;
      while (node) {
        if (node.nodeType === 1 && node.tagName === 'BILI-COMMENT-THREAD-RENDERER') { thread = node; break; }
        if (node.parentNode) node = node.parentNode;
        else if (node.host) node = node.host;
        else break;
      }
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      const named = confirm.textContent.includes('ReplyUser');
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const hidden = renderer.classList.contains('ob-hidden') && getComputedStyle(renderer).display === 'none' && renderer.getBoundingClientRect().height === 0;
      const parentVisible = !!thread && !thread.classList.contains('ob-hidden') && getComputedStyle(thread).display !== 'none' && thread.getBoundingClientRect().height > 0;
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      return {
        exists: true,
        confirm: true,
        named,
        blockedBeforeUndo: hidden,
        parentVisible,
        bars: renderer.getRootNode().querySelectorAll('.ob-bar').length,
        restored: !!undo && !window.OB.Index.isBlocked('bili:uid:444') && getComputedStyle(renderer).display !== 'none' && renderer.getBoundingClientRect().height > 0,
      };
    });
    if (replyBlock.exists && replyBlock.confirm && replyBlock.named && replyBlock.blockedBeforeUndo && replyBlock.parentVisible && replyBlock.bars === 0 && replyBlock.restored)
      report.pass.push('QB-L 真实楼中楼菜单拉黑后只隐藏该回复，撤销立即恢复');
    else report.fail.push('QB-L 楼中楼菜单拉黑失败：' + JSON.stringify(replyBlock));

    const quickBlock = await page.evaluate(async () => {
      const renderer = window.__commentRenderer('111');
      const container = window.OB.adapters.bilibili.containerOf(renderer);
      const button = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { confirm: false };
      const named = confirm.textContent.includes('Alice');
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        confirm: true,
        named,
        blocked: window.OB.Index.isBlocked('bili:uid:111'),
        fullThread: container.tagName === 'BILI-COMMENT-THREAD-RENDERER',
        hiddenClass: container.classList.contains('ob-hidden'),
        visuallyHidden: getComputedStyle(container).display === 'none' || container.getBoundingClientRect().height === 0,
        bars: container.getRootNode().querySelectorAll('.ob-bar').length,
      };
    });
    if (quickBlock.confirm && quickBlock.named && quickBlock.blocked && quickBlock.fullThread && quickBlock.hiddenClass && quickBlock.visuallyHidden && quickBlock.bars === 0) report.pass.push('QB-C 评论菜单拉黑正确 UID，完整评论线程无提示、零占位消失');
    else report.fail.push('QB-C 评论菜单身份识别失败：' + JSON.stringify(quickBlock));

    const recycledMenu = await page.evaluate(async () => {
      const renderer = window.__commentRenderer('111');
      renderer.__data = { mid: '777', member: { mid: '777', uname: 'Recycled' } };
      const link = renderer.shadowRoot.querySelector('.user-name');
      link.href = '//space.bilibili.com/777'; link.textContent = 'Recycled';
      const menu = renderer.shadowRoot.querySelector('bili-comment-menu');
      menu.__data = { member: { mid: '777', uname: 'Recycled' } };
      const button = menu.shadowRoot.querySelector('.ob-quick');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      const result = { confirm: !!confirm, currentUser: !!(confirm && confirm.textContent.includes('Recycled')), staleUser: !!(confirm && confirm.textContent.includes('Alice')) };
      if (confirm) confirm.querySelector('.ob-no').click();
      return result;
    });
    if (recycledMenu.confirm && recycledMenu.currentUser && !recycledMenu.staleUser)
      report.pass.push('QB-D 虚拟列表复用评论菜单时，快捷入口按点击时上下文识别当前用户');
    else report.fail.push('QB-D 快捷入口使用了过期身份：' + JSON.stringify(recycledMenu));

    await page.evaluate(() => {
      const dialog = document.createElement('div'); dialog.id = 'report-dialog'; dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<ul class="operation-list"><li class="operation-option">举报</li></ul>';
      document.body.appendChild(dialog);
    });
    await wait(1300);
    const dialogState = await page.evaluate(() => {
      const dialog = document.getElementById('report-dialog');
      const visibleFab = Array.from(document.querySelectorAll('.ob-bulk')).some((el) => getComputedStyle(el).display !== 'none');
      return { quick: !!dialog.querySelector('.ob-quick'), bulk: !!dialog.querySelector('.ob-bulk'), visibleFab };
    });
    if (!dialogState.quick && !dialogState.bulk && !dialogState.visibleFab)
      report.pass.push('QB-E 举报弹窗没有无效本地拉黑或“(0)”浮层');
    else report.fail.push('QB-E 举报弹窗误注入：' + JSON.stringify(dialogState));
    await page.evaluate(() => document.getElementById('report-dialog').remove());
    await page.evaluate(() => {
      const deepAll = (root, selector) => {
        const out = [];
        const walk = (node) => {
          if (!node || out.includes(node)) return;
          if (node.nodeType === 1 && node.matches && node.matches(selector)) out.push(node);
          if (node.shadowRoot) walk(node.shadowRoot);
          for (const child of node.children || []) walk(child);
        };
        walk(root);
        return out;
      };
      for (const button of deepAll(document, '.ob-quick')) button.remove();
      for (const anchor of deepAll(document, '[data-ob-qb]')) anchor.removeAttribute('data-ob-qb');
    });

    // 先取得 seg.so 索引，再覆盖悬浮弹幕 -> 原生举报菜单的入口。
    await page.evaluate(async () => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&segment_index=1');
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => xhr.response;
      xhr.onerror = () => { throw new Error('floating danmaku segment failed'); };
      xhr.send();
    });
    await page.waitForFunction(() => (
      window.__omniblockFloatingDanmakuResolver('hello danmaku', 5000).length === 1
      && window.__omniblockFloatingDanmakuResolver('repeat danmaku', -1).length === 2
    ), null, { timeout: 2500, polling: 100 });

    // 结构来自 2026-08-22 真实 B站视频页捕获：浮动弹幕是
    // `.bpx-player-video-area > .bpx-player-row-dm-wrap > .bili-danmaku-x-dm-rotate > .bili-danmaku-x-dm`，
    // 且弹幕层 CSS 写死 pointer-events:none，因此脚本必须靠指针坐标命中而不是 hover。
    await page.evaluate(() => {
      const area = document.createElement('div');
      area.className = 'bpx-player-video-area';
      area.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:400px;';
      area.innerHTML = `
        <video id="floating-video"></video>
        <div class="bpx-player-row-dm-wrap" style="position:absolute;inset:0;pointer-events:none;">
          <div class="bili-danmaku-x-dm-rotate" style="position:absolute;inset:0;pointer-events:none;">
            <div class="bili-danmaku-x-dm" id="floating-danmaku-unique"
                 style="position:absolute;left:100px;top:60px;width:180px;height:26px;pointer-events:none;">hello danmaku</div>
            <div class="bili-danmaku-x-dm" id="floating-danmaku-ambiguous"
                 style="position:absolute;left:100px;top:160px;width:180px;height:26px;pointer-events:none;">repeat danmaku</div>
          </div>
        </div>`;
      document.body.appendChild(area);
    });
    await wait(200);
    const layerContract = await page.evaluate(() => {
      const dm = document.getElementById('floating-danmaku-unique');
      const rect = dm.getBoundingClientRect();
      return {
        pointerEventsNone: getComputedStyle(dm).pointerEvents === 'none',
        // 真站同样如此：坐标落在弹幕上时 elementFromPoint 返回的不是弹幕本身。
        elementAtPointIsNotDanmaku: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) !== dm,
      };
    });

    const hoverFloating = async (id) => {
      const point = await page.evaluate((target) => {
        const dm = document.getElementById(target);
        const rect = dm.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, id);
      await page.mouse.move(point.x - 40, point.y + 60);
      await wait(80);
      await page.mouse.move(point.x, point.y);
      await wait(250);
      return point;
    };

    await hoverFloating('floating-danmaku-unique');
    const floatingFollow = await page.evaluate(async () => {
      const pick = document.getElementById('ob-dm-pick');
      const dm = document.getElementById('floating-danmaku-unique');
      if (!pick || !dm) return { shown: false };
      const before = { pick: pick.getBoundingClientRect().left, dm: dm.getBoundingClientRect().left };
      dm.style.left = '180px';
      await new Promise((resolve) => setTimeout(resolve, 120));
      const after = { pick: pick.getBoundingClientRect().left, dm: dm.getBoundingClientRect().left };
      return { shown: getComputedStyle(pick).display !== 'none', moved: after.dm !== before.dm, follows: Math.abs((after.pick - after.dm) - (before.pick - before.dm)) < 4 };
    });
    // 登录用户悬停时 B站会弹出自己的弹幕操作条；这里验证同一身份也能供原生菜单复用。
    await page.evaluate(() => {
      const menu = document.createElement('ul');
      menu.className = 'menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = '<li>举报</li>';
      document.body.appendChild(menu);
    });
    await page.evaluate(() => {
      const generic = document.createElement('div');
      generic.setAttribute('role', 'dialog'); generic.id = 'generic-dm-report';
      generic.innerHTML = '<div class="report-choice">举报</div><div class="report-choice">取消</div>';
      document.body.appendChild(generic);
    });
    await wait(1000);
    const floatingDanmakuPick = await page.evaluate(async () => {
      const pick = document.getElementById('ob-dm-pick');
      const visible = !!pick && getComputedStyle(pick).display !== 'none';
      if (!visible) return { visible: false };
      const menu = document.querySelector('ul[role="menu"]');
      const menuQuick = !!(menu && menu.querySelector('.ob-quick'));
      const menuText = menu && menu.querySelector('.ob-quick') ? menu.querySelector('.ob-quick').textContent : '';
      const generic = document.getElementById('generic-dm-report');
      const genericQuick = !!(generic && generic.querySelector('.ob-quick'));
      pick.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { visible: true, menuQuick, menuText, genericQuick, confirm: false };
      confirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const blocked = window.OB.Index.isBlocked('bili:dmhash:678f8529');
      const hiddenAfterBlock = getComputedStyle(document.getElementById('ob-dm-pick')).display === 'none';
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      const result = { visible: true, menuQuick, menuText, genericQuick, confirm: true, blocked, hiddenAfterBlock, hasUndo: !!undo };
      if (undo) {
        undo.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        result.restored = !window.OB.Index.isBlocked('bili:dmhash:678f8529');
      }
      return result;
    });
    if (layerContract.pointerEventsNone && layerContract.elementAtPointIsNotDanmaku
      && floatingFollow.shown && floatingFollow.moved && floatingFollow.follows
      && floatingDanmakuPick.visible && floatingDanmakuPick.menuQuick
      && /本地拉黑/.test(floatingDanmakuPick.menuText || '') && floatingDanmakuPick.genericQuick
      && floatingDanmakuPick.confirm
      && floatingDanmakuPick.blocked && floatingDanmakuPick.hiddenAfterBlock && floatingDanmakuPick.restored)
      report.pass.push('QB-X pointer-events:none 浮动弹幕的本地浮层会跟随移动，原生/无语义 role 举报项均显示“本地拉黑”，可按同一 mid_hash 拉黑并撤销');
    else report.fail.push('QB-X 浮动弹幕坐标/举报入口失败：' + JSON.stringify({ ...layerContract, floatingFollow, ...floatingDanmakuPick }));

    await page.evaluate(() => {
      const menu = document.querySelector('ul[role="menu"]');
      if (menu) menu.remove();
      const generic = document.getElementById('generic-dm-report');
      if (generic) generic.remove();
      for (const button of document.querySelectorAll('.ob-quick')) button.remove();
    });
    await hoverFloating('floating-danmaku-ambiguous');
    await wait(600);
    const ambiguousFloating = await page.evaluate(() => {
      const pick = document.getElementById('ob-dm-pick');
      return {
        pickHidden: !pick || getComputedStyle(pick).display === 'none',
        resolverAmbiguous: window.__omniblockFloatingDanmakuResolver('repeat danmaku', -1).length === 2,
        secondGranularityAmbiguous: window.__omniblockFloatingDanmakuResolver('repeat danmaku', 12000).length === 2,
        probeNoIdentity: (() => {
          const dm = document.getElementById('floating-danmaku-ambiguous');
          const rect = dm.getBoundingClientRect();
          const probe = window.__omniblockFloatingDmProbe(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return !!probe && probe.text === 'repeat danmaku' && probe.keys.length === 0;
        })(),
      };
    });
    if (ambiguousFloating.pickHidden && ambiguousFloating.resolverAmbiguous
      && ambiguousFloating.secondGranularityAmbiguous && ambiguousFloating.probeNoIdentity)
      report.pass.push('QB-Y 同文案对应多个发送者时，浮动弹幕坐标命中不提供拉黑入口');
    else report.fail.push('QB-Y 浮动弹幕歧义身份失败：' + JSON.stringify(ambiguousFloating));

    await page.evaluate(() => {
      const area = document.querySelector('.bpx-player-video-area');
      if (area) area.remove();
      const pick = document.getElementById('ob-dm-pick');
      if (pick) pick.style.setProperty('display', 'none', 'important');
    });

    await page.evaluate(() => {
      const modal = document.createElement('div'); modal.id = 'likers'; modal.setAttribute('role', 'dialog');
      modal.innerHTML = '<header>点赞用户</header><a href="//space.bilibili.com/901">U901</a><a href="//space.bilibili.com/902">U902</a><a href="//space.bilibili.com/903">U903</a>';
      document.body.appendChild(modal);
    });
    await wait(1300);
    const bulk = await page.evaluate(async () => {
      const button = document.querySelector('#likers .ob-bulk');
      if (!button) return { exists: false };
      window.__writes = 0;
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const persons = Object.values(window.OB.Store.persons());
      const likerGroups = persons.filter((person) => person.identities.some((key) => /^bili:uid:90[123]$/.test(key)));
      return {
        exists: true,
        confirm: true,
        blocked: ['901', '902', '903'].every((id) => window.OB.Index.isBlocked('bili:uid:' + id)),
        separate: likerGroups.length === 3 && likerGroups.every((person) => person.identities.filter((key) => /^bili:uid:90[123]$/.test(key)).length === 1),
        writes: window.__writes,
      };
    });
    if (bulk.exists && bulk.confirm && bulk.blocked && bulk.separate && bulk.writes === 1) report.pass.push('QB-F 批量拉黑逐人存储，并以一次持久化提交');
    else report.fail.push('QB-F 批量拉黑事务错误：' + JSON.stringify(bulk));
    await page.evaluate(() => document.getElementById('likers').remove());

    await page.evaluate(() => {
      const modal = document.createElement('div'); modal.id = 'undo-list'; modal.setAttribute('role', 'dialog');
      modal.innerHTML = '<header>混合用户</header><a href="//space.bilibili.com/901">U901</a><a href="//space.bilibili.com/904">U904</a>';
      document.body.appendChild(modal);
    });
    await wait(1300);
    const bulkUndo = await page.evaluate(async () => {
      const button = document.querySelector('#undo-list .ob-bulk');
      if (!button) return { exists: false };
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const toast = document.getElementById('ob-toast');
      if (!toast) return { exists: true, confirm: true, toast: false };
      window.__writes = 0;
      toast.querySelector('button').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        exists: true, confirm: true, toast: true,
        existingKept: window.OB.Index.isBlocked('bili:uid:901'),
        newRemoved: !window.OB.Index.isBlocked('bili:uid:904'),
        undoWrites: window.__writes,
      };
    });
    if (bulkUndo.exists && bulkUndo.confirm && bulkUndo.toast && bulkUndo.existingKept && bulkUndo.newRemoved && bulkUndo.undoWrites === 1)
      report.pass.push('QB-G 批量撤销一次提交且只移除本次新增身份');
    else report.fail.push('QB-G 批量撤销边界错误：' + JSON.stringify(bulkUndo));
    await page.evaluate(() => document.getElementById('undo-list').remove());

    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&segment_index=1');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error('seg.so XHR failed'));
        xhr.send();
      });
    });
    await page.waitForFunction(() => !!document.getElementById('ob-dm-tool'), null, { timeout: 2500 }).catch(() => {});
    const dmManagerSingle = await page.evaluate(async () => {
      const launcher = document.getElementById('ob-dm-tool');
      if (!launcher) return { exists: false };
      launcher.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const panel = document.getElementById('ob-dm-manager');
      const row = panel && Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) => item.textContent.includes('repeat danmaku'));
      const button = row && row.querySelector('.ob-dm-single');
      if (!panel || !row || !button) return { exists: true, panel: !!panel, row: !!row, button: !!button };
      const groupedMeta = row.textContent.includes('2 位发送者');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, panel: true, row: true, button: true, confirm: false };
      const confirmsTwo = /2 位发送者/.test(confirm.textContent || '');
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const keys = ['bili:dmhash:11223344', 'bili:dmhash:55667788'];
      const blocked = keys.every((key) => window.OB.Index.isBlocked(key));
      window.OB.openOptions();
      const settingsItems = Array.from(document.querySelectorAll('#ob-list .ob-item')).filter((item) => /11223344|55667788/.test(item.textContent));
      const settingsReadable = settingsItems.length === 2 && settingsItems.every((item) => /B站弹幕 hash/.test(item.textContent) && /同一发送者/.test(item.textContent) && /repeat danmaku/.test(item.textContent));
      window.OB.openOptions();
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      return {
        exists: true, panel: true, row: true, button: true, confirm: true, groupedMeta, confirmsTwo, blocked, settingsReadable,
        restored: !!undo && keys.every((key) => !window.OB.Index.isBlocked(key)),
        count: document.querySelectorAll('#ob-dm-manager .ob-dm-sender').length,
      };
    });
    if (dmManagerSingle.exists && dmManagerSingle.panel && dmManagerSingle.row && dmManagerSingle.button && dmManagerSingle.confirm && dmManagerSingle.groupedMeta && dmManagerSingle.confirmsTwo && dmManagerSingle.blocked && dmManagerSingle.settingsReadable && dmManagerSingle.restored && dmManagerSingle.count === 6)
      report.pass.push('QB-M 相同弹幕按文案聚合，单击屏蔽组内全部发送者并在名单解释 hash 作用');
    else report.fail.push('QB-M 弹幕文案聚合单条屏蔽错误：' + JSON.stringify(dmManagerSingle));

    const dmManagerBatch = await page.evaluate(async () => {
      const launcher = document.getElementById('ob-dm-tool');
      if (!launcher) return { exists: false };
      if (!document.getElementById('ob-dm-manager')) { launcher.click(); await new Promise((resolve) => setTimeout(resolve, 80)); }
      const panel = document.getElementById('ob-dm-manager');
      const rows = panel ? Array.from(panel.querySelectorAll('.ob-dm-sender')) : [];
      const targets = rows.filter((row) => row.textContent.includes('repeat danmaku') || row.textContent.includes('uid mapped danmaku'));
      for (const row of targets) {
        const checkbox = row.querySelector('.ob-dm-select');
        checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const button = panel && panel.querySelector('.ob-dm-batch');
      if (!panel || targets.length !== 2 || !button) return { exists: true, panel: !!panel, targets: targets.length, button: !!button };
      window.__writes = 0;
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, panel: true, targets: 2, button: true, confirm: false };
      const confirmsThree = /3 位弹幕发送者/.test(confirm.textContent || '');
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const keys = ['bili:dmhash:11223344', 'bili:dmhash:55667788', 'bili:dmhash:0a6216d9'];
      const persons = Object.values(window.OB.Store.persons());
      const groups = persons.filter((person) => person.identities.some((key) => keys.includes(key)));
      const blocked = keys.every((key) => window.OB.Index.isBlocked(key));
      const writes = window.__writes;
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      return {
        exists: true, panel: true, targets: 2, button: true, confirm: true, confirmsThree, blocked,
        separate: groups.length === 3 && groups.every((person) => person.identities.filter((key) => keys.includes(key)).length === 1),
        writes,
        restored: !!undo && keys.every((key) => !window.OB.Index.isBlocked(key)),
      };
    });
    if (dmManagerBatch.exists && dmManagerBatch.panel && dmManagerBatch.targets === 2 && dmManagerBatch.button && dmManagerBatch.confirm && dmManagerBatch.confirmsThree && dmManagerBatch.blocked && dmManagerBatch.separate && dmManagerBatch.writes === 1 && dmManagerBatch.restored)
      report.pass.push('QB-N 弹幕工具勾选文案组后展开、去重全部发送者，逐人存储并整体撤销');
    else report.fail.push('QB-N 弹幕批量屏蔽入口错误：' + JSON.stringify(dmManagerBatch));

    const dmHashIdentityBoundary = await page.evaluate(async () => {
      const panel = document.getElementById('ob-dm-manager');
      const row = panel && Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) => item.textContent.includes('known comment user danmaku'));
      const button = row && row.querySelector('.ob-dm-single');
      if (!panel || !row || !button) return { exists: false };
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const person = Object.values(window.OB.Store.persons()).find((item) => item.identities.includes('bili:dmhash:fd09ed1d'));
      window.OB.openOptions();
      const settingsRow = Array.from(document.querySelectorAll('#ob-list .ob-item')).find((item) => item.textContent.includes('fd09ed1d'));
      const settingsText = settingsRow && settingsRow.textContent || '';
      window.OB.openOptions();
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      return {
        exists: true,
        confirm: true,
        label: person && person.label,
        identities: person && person.identities || [],
        settingsText,
        restored: !!undo && !window.OB.Index.isBlocked('bili:uid:222') && !window.OB.Index.isBlocked('bili:dmhash:fd09ed1d'),
      };
    });
    if (dmHashIdentityBoundary.exists && dmHashIdentityBoundary.confirm && dmHashIdentityBoundary.label === 'B站弹幕发送者'
      && !dmHashIdentityBoundary.identities.includes('bili:uid:222') && dmHashIdentityBoundary.identities.includes('bili:dmhash:fd09ed1d')
      && !/B站 UID：222/.test(dmHashIdentityBoundary.settingsText) && /B站弹幕 hash：fd09ed1d/.test(dmHashIdentityBoundary.settingsText)
      && /未提供昵称\/UID/.test(dmHashIdentityBoundary.settingsText) && dmHashIdentityBoundary.restored) {
      report.pass.push('QB-T 弹幕 hash 即使与已加载评论 UID 的 CRC32 相同，也保持 hash 身份且明确昵称/UID 不可用');
    } else report.fail.push('QB-T 弹幕 hash 身份边界错误：' + JSON.stringify(dmHashIdentityBoundary));

    const dmUidCandidate = await page.evaluate(async () => {
      const panel = document.getElementById('ob-dm-manager');
      const findRow = () => panel && Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) => item.textContent.includes('known comment user danmaku'));
      let row = findRow();
      const query = row && row.querySelector('.ob-dm-uid-query');
      if (!panel || !row || !query) return { exists: false, panel: !!panel, row: !!row, query: !!query };
      window.__cardCalls.length = 0;
      query.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        row = findRow();
        if (row && row.querySelector('.ob-dm-uid-candidate')) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const candidate = row && row.querySelector('.ob-dm-uid-candidate');
      const link = candidate && candidate.querySelector('a');
      const choose = candidate && candidate.querySelector('.ob-dm-uid-link');
      const beforeConfirm = !window.OB.Index.isBlocked('bili:uid:222') && !window.OB.Index.isBlocked('bili:dmhash:fd09ed1d');
      if (!candidate || !choose) return {
        exists: true, candidate: !!candidate, choose: !!choose, text: row.textContent,
        calls: window.__cardCalls.slice(), beforeConfirm,
      };
      // 唯一且已正向校验的候选必须直接落库：不得再弹二次确认框。
      const uniqueFlag = choose.getAttribute('data-ob-dm-uid-unique');
      const chooseText = choose.textContent;
      const warningText = (row.querySelector('.ob-dm-uid-warning') || {}).textContent || '';
      choose.click(); await new Promise((resolve) => setTimeout(resolve, 150));
      const confirmBox = document.getElementById('ob-confirm');
      const person = Object.values(window.OB.Store.persons()).find((item) => item.identities.includes('bili:uid:222'));
      window.OB.openOptions();
      const settingsRow = Array.from(document.querySelectorAll('#ob-list .ob-item')).find((item) => item.textContent.includes('B站 UID：222'));
      const settingsText = settingsRow && settingsRow.textContent || '';
      window.OB.openOptions();
      const blockedBoth = !!person && window.OB.Index.isBlocked('bili:uid:222') && window.OB.Index.isBlocked('bili:dmhash:fd09ed1d');
      const identities = person ? person.identities.slice() : [];
      const toast = document.getElementById('ob-toast');
      const toastText = toast && toast.textContent || '';
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      return {
        exists: true,
        candidate: true,
        candidateText: candidate.textContent,
        candidateHref: link && link.href,
        beforeConfirm,
        uniqueFlag,
        chooseText,
        warningText,
        confirmShown: !!confirmBox,
        toastText,
        calls: window.__cardCalls.slice(),
        label: person && person.label,
        identities,
        settingsText,
        blockedBoth,
        restored: !!undo && !window.OB.Index.isBlocked('bili:uid:222') && !window.OB.Index.isBlocked('bili:dmhash:fd09ed1d'),
      };
    });
    if (dmUidCandidate.exists && dmUidCandidate.candidate && /可能发送者/.test(dmUidCandidate.candidateText)
      && /Candidate Bob/.test(dmUidCandidate.candidateText) && /UID\s*222/.test(dmUidCandidate.candidateText)
      && /space\.bilibili\.com\/222/.test(dmUidCandidate.candidateHref || '') && dmUidCandidate.beforeConfirm
      && dmUidCandidate.uniqueFlag === '1' && dmUidCandidate.chooseText === '拉黑本人'
      && /可直接拉黑/.test(dmUidCandidate.warningText) && dmUidCandidate.confirmShown === false
      && /Candidate Bob/.test(dmUidCandidate.toastText)
      && dmUidCandidate.calls.length === 1 && dmUidCandidate.calls[0] === '222'
      && dmUidCandidate.label === 'Candidate Bob'
      && dmUidCandidate.identities.includes('bili:uid:222') && dmUidCandidate.identities.includes('bili:dmhash:fd09ed1d')
      && /B站 UID：222/.test(dmUidCandidate.settingsText) && /B站弹幕 hash：fd09ed1d/.test(dmUidCandidate.settingsText)
      && dmUidCandidate.blockedBoth && dmUidCandidate.restored) {
      report.pass.push('QB-U 唯一且已校验的 UID 候选免二次确认，直接合并 hash/UID 并可整体撤销');
    } else report.fail.push('QB-U 弹幕 UID 候选确认错误：' + JSON.stringify(dmUidCandidate));

    const dmUidCollision = await page.evaluate(async () => {
      const panel = document.getElementById('ob-dm-manager');
      const findRow = () => panel && Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) => item.textContent.includes('uid mapped danmaku'));
      let row = findRow();
      const query = row && row.querySelector('.ob-dm-uid-query');
      if (!row || !query) return { exists: false };
      window.__cardCalls.length = 0;
      query.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        row = findRow();
        const button = row && row.querySelector('.ob-dm-uid-query');
        if (row && button && !button.disabled && row.querySelector('.ob-dm-uid-results')) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const candidates = row ? Array.from(row.querySelectorAll('.ob-dm-uid-candidate')).map((item) => item.textContent) : [];
      const calls = window.__cardCalls.slice().sort();
      const untouched = !window.OB.Index.isBlocked('bili:uid:33') && !window.OB.Index.isBlocked('bili:uid:6130768180');
      const close = row && row.querySelector('.ob-dm-uid-query');
      if (close) close.click();
      return { exists: true, candidates, calls, untouched };
    });
    if (dmUidCollision.exists && dmUidCollision.candidates.length === 1
      && /Candidate 33/.test(dmUidCollision.candidates[0]) && /UID\s*33/.test(dmUidCollision.candidates[0])
      && !/6130768180/.test(dmUidCollision.candidates.join(' '))
      && dmUidCollision.calls.length === 2 && dmUidCollision.calls.includes('33') && dmUidCollision.calls.includes('6130768180')
      && dmUidCollision.untouched) {
      report.pass.push('QB-V CRC32 碰撞候选逐个校验，剔除不存在账号且查询本身不写入 UID');
    } else report.fail.push('QB-V 弹幕 UID 碰撞校验错误：' + JSON.stringify(dmUidCollision));

    // 多个存活候选（真实 CRC32 碰撞对 86821 / 14740600）时必须保留人工确认，
    // 免确认捷径只允许作用在唯一且已正向校验的候选上。
    const dmUidAmbiguous = await page.evaluate(async () => {
      const panel = document.getElementById('ob-dm-manager');
      const findRow = () => panel && Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) => item.textContent.includes('ambiguous uid danmaku'));
      let row = findRow();
      const query = row && row.querySelector('.ob-dm-uid-query');
      if (!row || !query) return { exists: false, row: !!row, query: !!query };
      query.click();
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        row = findRow();
        const button = row && row.querySelector('.ob-dm-uid-query');
        if (row && button && !button.disabled && row.querySelectorAll('.ob-dm-uid-candidate').length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const buttons = row ? Array.from(row.querySelectorAll('.ob-dm-uid-link')) : [];
      const warningText = (row && row.querySelector('.ob-dm-uid-warning') || {}).textContent || '';
      const candidateText = row ? Array.from(row.querySelectorAll('.ob-dm-uid-candidate')).map((item) => item.textContent).join(' | ') : '';
      const first = buttons[0];
      const uniqueFlags = buttons.map((button) => button.getAttribute('data-ob-dm-uid-unique'));
      const labels = buttons.map((button) => button.textContent);
      if (!first) return { exists: true, candidateCount: buttons.length, warningText, candidateText };
      first.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const confirmBox = document.getElementById('ob-confirm');
      const blockedBeforeConfirm = window.OB.Index.isBlocked('bili:uid:86821') || window.OB.Index.isBlocked('bili:dmhash:14e54344');
      if (confirmBox) confirmBox.querySelector('.ob-no').click();
      const close = row && row.querySelector('.ob-dm-uid-query');
      if (close) close.click();
      return {
        exists: true,
        candidateCount: buttons.length,
        candidateText,
        warningText,
        uniqueFlags,
        labels,
        confirmShown: !!confirmBox,
        blockedBeforeConfirm,
        stillClean: !window.OB.Index.isBlocked('bili:uid:86821') && !window.OB.Index.isBlocked('bili:dmhash:14e54344'),
      };
    });
    if (dmUidAmbiguous.exists && dmUidAmbiguous.candidateCount === 2
      && /Collision A/.test(dmUidAmbiguous.candidateText) && /Collision B/.test(dmUidAmbiguous.candidateText)
      && /请打开主页核对/.test(dmUidAmbiguous.warningText)
      && dmUidAmbiguous.uniqueFlags.every((flag) => flag === '0')
      && dmUidAmbiguous.labels.every((label) => label === '确认并拉黑')
      && dmUidAmbiguous.confirmShown && !dmUidAmbiguous.blockedBeforeConfirm && dmUidAmbiguous.stillClean) {
      report.pass.push('QB-W 同一 hash 存在多个存活 UID 候选时仍要求人工确认，取消后不写入任何身份');
    } else report.fail.push('QB-W 多候选确认边界错误：' + JSON.stringify(dmUidAmbiguous));

    const originalViewport = page.viewportSize() || { width: 1280, height: 720 };
    const layoutState = async () => page.evaluate(() => {
      const panel = document.getElementById('ob-dm-manager');
      const box = panel && panel.querySelector('.ob-dm-box');
      const batch = panel && panel.querySelector('.ob-dm-batch');
      if (!panel || !box || !batch) return { exists: false };
      const rect = box.getBoundingClientRect();
      const batchRect = batch.getBoundingClientRect();
      return {
        exists: true,
        inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
        viewport: { innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body && document.body.scrollWidth },
        batchInside: batchRect.left >= rect.left && batchRect.right <= rect.right && batchRect.bottom <= rect.bottom,
        listScrollable: panel.querySelector('.ob-dm-list').scrollHeight >= panel.querySelector('.ob-dm-list').clientHeight,
      };
    });
    const desktopLayout = await layoutState();
    if (SAVE_SCREENSHOTS) await page.screenshot({ path: path.join(ROOT, 'test', '_shot_dm-manager-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await wait(120);
    const mobileLayout = await layoutState();
    if (SAVE_SCREENSHOTS) await page.screenshot({ path: path.join(ROOT, 'test', '_shot_dm-manager-mobile.png') });
    await page.setViewportSize(originalViewport); await wait(120);
    if (desktopLayout.exists && desktopLayout.inside && desktopLayout.noPageOverflow && desktopLayout.batchInside && desktopLayout.listScrollable && mobileLayout.exists && mobileLayout.inside && mobileLayout.noPageOverflow && mobileLayout.batchInside && mobileLayout.listScrollable)
      report.pass.push('QB-O 弹幕工具在桌面与 390px 手机视口内无溢出或控件越界');
    else report.fail.push('QB-O 弹幕工具响应式布局错误：' + JSON.stringify({ desktopLayout, mobileLayout }));

    // 弹幕列表的悬停断言应在管理工具关闭后执行；工具是全屏遮罩，遮罩打开时鼠标
    // 坐标不会落到其下方的原生列表行，不能把这个测试状态误报成产品 hover 失效。
    await page.evaluate(() => {
      const close = document.querySelector('#ob-dm-manager .ob-dm-close');
      if (close) close.click();
    });
    await wait(80);
    await page.waitForFunction(() => !!document.querySelector('#dm-panel .ob-dm-block'), null, { timeout: 5000 });
    await page.locator('#dm-panel .dm-info-row').first().scrollIntoViewIfNeeded();
    const dmRowBox = await page.locator('#dm-panel .dm-info-row').first().boundingBox();
    if (dmRowBox) await page.mouse.move(dmRowBox.x + 12, dmRowBox.y + dmRowBox.height / 2);
    const dmHover = await page.evaluate(() => {
      const row = document.querySelector('#dm-panel .dm-info-row');
      const own = row && row.querySelector('.ob-dm-block');
      const native = row && row.querySelector('.dm-info-block-btn');
      if (!row || !own || !native) return { exists: false };
      const a = own.getBoundingClientRect();
      const b = native.getBoundingClientRect();
      const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return { exists: true, rowHover: row.matches(':hover'), nativeVisible: b.width > 0 && b.height > 0, overlap, ownInside: a.left >= row.getBoundingClientRect().left && a.right <= row.getBoundingClientRect().right };
    });
    await page.mouse.move(5, 5);
    if (dmHover.exists && dmHover.rowHover && dmHover.nativeVisible && !dmHover.overlap && dmHover.ownInside)
      report.pass.push('QB-Z 弹幕列表悬停展开原生控件时，本地按钮移入独立操作槽且不重叠');
    else report.fail.push('QB-Z 弹幕列表悬停布局重叠：' + JSON.stringify(dmHover));
    await page.mouse.move(5, 5);
    const dm = await page.evaluate(async () => {
      const row = document.querySelector('#dm-panel .dm-info-row');
      const button = row.querySelector('.ob-dm-block');
      if (!button) return { exists: false };
      const content = row.querySelector('.dm-info-dm');
      const buttonRect = button.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const layoutReserved = row.getAttribute('data-ob-dm-action') === '1'
        && parseFloat(getComputedStyle(row).paddingRight) >= buttonRect.width
        && contentRect.right <= buttonRect.left;
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        exists: true,
        layoutReserved,
        confirm: true,
        blocked: window.OB.Index.isBlocked('bili:dmhash:678f8529'),
        hidden: (row.closest('li.bui-long-list-item') || row).getAttribute('data-ob-dm-blocked') === '1',
        visuallyHidden: getComputedStyle(row.closest('li.bui-long-list-item') || row).display === 'none' || (row.closest('li.bui-long-list-item') || row).getBoundingClientRect().height === 0,
        bars: document.querySelectorAll('#dm-panel .ob-bar').length,
      };
    });
    if (dm.exists && dm.layoutReserved && dm.confirm && dm.blocked && dm.hidden && dm.visuallyHidden && dm.bars === 0) report.pass.push('QB-H 弹幕列表为行内按钮预留空间，按 mid_hash 拉黑后无提示、零占位消失');
    else report.fail.push('QB-H 弹幕列表拉黑失败：' + JSON.stringify(dm));

    const dmUndo = await page.evaluate(async () => {
      const toast = document.getElementById('ob-toast');
      if (!toast) return { toast: false };
      toast.querySelector('button').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const row = document.querySelector('#dm-panel .dm-info-row');
      return {
        toast: true,
        removed: !window.OB.Index.isBlocked('bili:dmhash:678f8529'),
        visible: (row.closest('li.bui-long-list-item') || row).getAttribute('data-ob-dm-blocked') !== '1',
        visuallyVisible: getComputedStyle(row.closest('li.bui-long-list-item') || row).display !== 'none' && (row.closest('li.bui-long-list-item') || row).getBoundingClientRect().height > 0,
      };
    });
    if (dmUndo.toast && dmUndo.removed && dmUndo.visible && dmUndo.visuallyVisible) report.pass.push('QB-I 撤销弹幕发送者拉黑后，当前列表行立即恢复');
    else report.fail.push('QB-I 弹幕撤销未恢复列表行：' + JSON.stringify(dmUndo));

    // 真实侧栏是跨段虚拟列表：同文案多发送者的行不应“消失”，而是明确提供整组入口；
    // 超出当前段的行先显示读取状态，按显示时间拉取对应 seg.so 后再变为可执行按钮。
    await page.evaluate(() => {
      window.__INITIAL_STATE__ = { videoData: { cid: '123456' } };
      const list = document.querySelector('#dm-panel .bui-long-list-list');
      const make = (time, content) => {
        const li = document.createElement('li'); li.className = 'bui-long-list-item'; li.style.height = '24px';
        li.innerHTML = '<div class="dm-info-row"><span class="dm-info-time">' + time + '</span>'
          + '<span class="dm-info-dm" title="' + content + '">' + content + '</span>'
          + '<span class="dm-info-date">01-01 00:00</span><span class="dm-info-block-btn">屏蔽用户</span>'
          + '<span class="dm-info-report-btn">举报</span></div>';
        return li;
      };
      list.append(make('00:12', 'repeat danmaku'));
      list.append(make('06:05', 'later danmaku'));
      window.OB.Store.setSetting('showQuickBlock', false);
      window.OB.Store.setSetting('showQuickBlock', true);
    });
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#dm-panel .dm-info-row'));
      const repeat = rows.find((row) => row.querySelector('.dm-info-dm') && row.querySelector('.dm-info-dm').getAttribute('title') === 'repeat danmaku');
      const later = rows.find((row) => row.querySelector('.dm-info-dm') && row.querySelector('.dm-info-dm').getAttribute('title') === 'later danmaku');
      return !!(repeat && later && repeat.querySelector('.ob-dm-block') && later.querySelector('.ob-dm-block')
        && !later.querySelector('.ob-dm-block').disabled);
    }, null, { timeout: 8000 });
    const dmCoverage = await page.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = Array.from(document.querySelectorAll('#dm-panel .dm-info-row'));
      const repeat = rows.find((row) => row.querySelector('.dm-info-dm') && row.querySelector('.dm-info-dm').getAttribute('title') === 'repeat danmaku');
      const later = rows.find((row) => row.querySelector('.dm-info-dm') && row.querySelector('.dm-info-dm').getAttribute('title') === 'later danmaku');
      const repeatButton = repeat && repeat.querySelector('.ob-dm-block');
      const laterButton = later && later.querySelector('.ob-dm-block');
      const repeatLabel = repeatButton && repeatButton.textContent;
      if (repeatButton) {
        repeatButton.click(); await pause(60);
        const confirm = document.getElementById('ob-confirm');
        if (confirm) confirm.querySelector('.ob-ok').click();
        await pause(120);
      }
      const repeatBlocked = window.OB.Index.isBlocked('bili:dmhash:11223344') && window.OB.Index.isBlocked('bili:dmhash:55667788');
      const repeatHidden = !!repeat && getComputedStyle(repeat.closest('li')).display === 'none';
      const toast = document.getElementById('ob-toast');
      if (toast && toast.querySelector('button')) toast.querySelector('button').click();
      await pause(120);
      if (laterButton) {
        laterButton.click(); await pause(60);
        const confirm = document.getElementById('ob-confirm');
        if (confirm) confirm.querySelector('.ob-ok').click();
        await pause(120);
      }
      const laterBlocked = window.OB.Index.isBlocked('bili:dmhash:abcdef12');
      const laterToast = document.getElementById('ob-toast');
      if (laterToast && laterToast.querySelector('button')) laterToast.querySelector('button').click();
      await pause(120);
      return { repeatLabel, repeatBlocked, repeatHidden, laterBlocked, laterRestored: !window.OB.Index.isBlocked('bili:dmhash:abcdef12') };
    });
    const segment2Requested = requestedSegments.includes(2);
    if (/本地拉黑全部\(2\)/.test(dmCoverage.repeatLabel || '') && dmCoverage.repeatBlocked && dmCoverage.repeatHidden
      && segment2Requested && dmCoverage.laterBlocked && dmCoverage.laterRestored)
      report.pass.push('QB-LIST 弹幕列表歧义行提供整组入口，跨 6 分钟段按行时间读取后每行均可本地拉黑并撤销');
    else report.fail.push('QB-LIST 弹幕列表行覆盖失败：' + JSON.stringify({ dmCoverage, requestedSegments }));

    const filtered = await page.evaluate(async () => {
      const bytes = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&segment_index=1');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error('seg.so XHR failed'));
        xhr.send();
      });
      const text = new TextDecoder().decode(bytes);
      return { hasBlocked: text.includes('hello danmaku'), hasKept: text.includes('keep danmaku'), hasUidMapped: text.includes('uid mapped danmaku') };
    });
    if (filtered.hasBlocked && filtered.hasKept && filtered.hasUidMapped) report.pass.push('QB-J 撤销后 XHR 返回的后续弹幕段不再过滤该 mid_hash');
    else report.fail.push('QB-J 弹幕段撤销过滤失败：' + JSON.stringify(filtered));

    const uidFiltered = await page.evaluate(async () => {
      window.OB.Store.addIdentities(['bili:uid:33'], 'UID 33');
      const bytes = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&segment_index=1');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error('seg.so XHR failed'));
        xhr.send();
      });
      return new TextDecoder().decode(bytes).includes('uid mapped danmaku');
    });
    if (!uidFiltered) report.pass.push('QB-K UID 33 的前导零 CRC32 mid_hash 也会被 XHR 过滤');
    else report.fail.push('QB-K UID -> 前导零 mid_hash 映射失败');

    const pakkuBeforePage = await browser.newPage();
    pakkuBeforePage.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[pakku-before ' + m.type() + '] ' + m.text()); });
    pakkuBeforePage.on('pageerror', (e) => report.pageErrors.push('[pakku-before] ' + String(e)));
    await pakkuBeforePage.route('**/*', (route) => {
      if (/\/dm\/(?:wbi\/)?web\/seg\.so/.test(route.request().url())) {
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: SEGMENT });
      }
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
    });
    await pakkuBeforePage.addInitScript({ content: SHIM + '\n' + PAKKU_BEFORE + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-pakku-before.js' });
    await pakkuBeforePage.goto('https://www.bilibili.com/video/BV1test', { waitUntil: 'domcontentloaded' });
    await pakkuBeforePage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    const pakkuBefore = await pakkuBeforePage.evaluate(async () => {
      window.OB.Store.addIdentities(['bili:dmhash:678f8529'], 'PAKKU before fixture');
      const autoRule = window.OB.danmakuRules.add('bili', 'keyword', 'uid mapped');
      try {
        const response = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1&pid=2&segment_index=1');
          xhr.responseType = 'arraybuffer';
          xhr.onload = () => resolve(xhr.response);
          xhr.onerror = () => reject(new Error('PAKKU-before seg.so XHR failed'));
          xhr.send();
        });
        const text = new TextDecoder().decode(response);
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          blockedRemoved: !text.includes('hello danmaku'),
          unblockedKept: text.includes('keep danmaku'),
          autoRuleAdded: !!autoRule.ok,
          autoRemoved: !text.includes('uid mapped danmaku'),
          autoHashStored: window.OB.Index.isBlocked('bili:dmhash:0a6216d9'),
        };
      } finally {
        window.OB.Store.removeIdentity('bili:dmhash:678f8529');
      }
    });
    await pakkuBeforePage.waitForFunction(() => {
      const tool = document.getElementById('ob-dm-tool');
      return !!tool && getComputedStyle(tool).display !== 'none' && tool.textContent.includes('(7)');
    }, null, { timeout: 2500, polling: 100 }).catch(() => {});
    const pakkuBeforeTool = await pakkuBeforePage.evaluate(() => {
      const tool = document.getElementById('ob-dm-tool');
      return { visible: !!tool && getComputedStyle(tool).display !== 'none', text: tool && tool.textContent };
    });
    await pakkuBeforePage.close();
    if (pakkuBefore.blockedRemoved && pakkuBefore.unblockedKept && pakkuBefore.autoRuleAdded && pakkuBefore.autoRemoved
      && pakkuBefore.autoHashStored && pakkuBeforeTool.visible && pakkuBeforeTool.text.includes('(7)'))
      report.pass.push('QB-Q PAKKU 先安装时，自动规则只过滤命中文案并保存 hash，其他 PAKKU 弹幕链保持可用，管理器保留已屏蔽发送者');
    else report.fail.push('QB-Q PAKKU 先安装兼容失败：' + JSON.stringify({ pakkuBefore, pakkuBeforeTool }));

    // 人工合成：统一评论管理器必须保留“当前已加载”路径，并显示作者去重、
    // 示例评论、层级与搜索；旧范围面板分支仍保留在下面，便于旧版结构对照。
    const bulkScopeLoaded = await page.evaluate(async () => {
      const fab = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => /评论作者|评论屏蔽/.test(el.textContent || ''));
      if (!fab) return { exists: false };
      fab.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const unified = document.getElementById('ob-comment-manager');
      if (unified) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const rows = Array.from(unified.querySelectorAll('.ob-cm-row'));
        const search = unified.querySelector('.ob-cm-search');
        if (search) { search.value = 'ReplyUser'; search.dispatchEvent(new Event('input', { bubbles: true })); }
        const searchRows = unified.querySelectorAll('.ob-cm-row').length;
        const searchMatch = searchRows === 1 && unified.querySelector('.ob-cm-row').getAttribute('data-key') === 'bili:uid:444';
        if (search) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
        const checkAll = unified.querySelector('.ob-cm-checkall input'); if (checkAll) checkAll.click();
        const batch = unified.querySelector('.ob-cm-batch');
        const selectedText = batch && batch.textContent || '';
        if (batch) batch.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const confirm = document.getElementById('ob-confirm');
        const confirmText = confirm && confirm.textContent || '';
        const parsedUids = Array.from(confirmText.matchAll(/bili:uid:(\d+)/g), (m) => m[1]);
        const stayedOpenBeforeBlock = document.getElementById('ob-comment-manager') === unified;
        if (confirm) confirm.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const toast = document.getElementById('ob-toast');
        const toastText = toast && toast.textContent || '';
        const blocked = parsedUids.length > 0 && parsedUids.every((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
        const undo = toast && toast.querySelector('button');
        if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
        const close = unified.querySelector('.ob-cm-close'); if (close) close.click();
        return {
          exists:true, panel:true, stayedOpen: stayedOpenBeforeBlock,
          loaded:rows.length === 4, allEnabled:true, presets:['3600','custom'], okText:'统一管理器',
          confirm:!!confirm, confirmText, parsedUids, count:parsedUids.length, toastText, blocked,
          restored:parsedUids.length > 0 && !parsedUids.some((mid) => window.OB.Index.isBlocked('bili:uid:' + mid)),
          searchRows, searchMatch, selectedText,
        };
      }
      const panel = document.getElementById('ob-bulk-scope');
      if (!panel) return { exists: true, panel: false };
      // 面板自身是 role=dialog，必须能跨过 1.2s 的弹窗周期扫描而不被误关。
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const stayedOpen = document.getElementById('ob-bulk-scope') === panel;
      const loaded = panel.querySelector('input[value="loaded"]');
      const all = panel.querySelector('input[value="all"]');
      const since = panel.querySelector('.ob-bs-since');
      const ok = panel.querySelector('.ob-bs-ok');
      const before = {
        stayedOpen,
        loaded: !!loaded && loaded.checked,
        allEnabled: !!all && !all.disabled,
        presets: since ? Array.from(since.options).map((o) => o.value) : [],
        okText: ok && ok.textContent,
      };
      if (!stayedOpen) return before;
      ok.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !document.getElementById('ob-confirm')) await new Promise((resolve) => setTimeout(resolve, 25));
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      if (!confirm) return { ...before, confirm: false };
      const parsedUids = Array.from(confirmText.matchAll(/bili:uid:(\d+)/g), (m) => m[1]);
      const count = Number((confirmText.match(/拉黑 (\d+) 位评论作者/) || [])[1] || 0);
      confirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const toast = document.getElementById('ob-toast');
      const toastText = toast && toast.textContent || '';
      const blocked = parsedUids.length > 0 && parsedUids.every((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      const restored = parsedUids.length > 0 && !parsedUids.some((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
      return { ...before, exists: true, panel: true, confirm: true, confirmText, toastText, parsedUids, count, blocked, restored };
    });
    if (bulkScopeLoaded.exists && bulkScopeLoaded.panel && bulkScopeLoaded.stayedOpen && bulkScopeLoaded.loaded && bulkScopeLoaded.allEnabled
      && bulkScopeLoaded.presets.includes('3600') && bulkScopeLoaded.presets.includes('custom')
      && (bulkScopeLoaded.okText === '继续' || bulkScopeLoaded.okText === '统一管理器') && bulkScopeLoaded.confirm
      && (/(?:拉黑|屏蔽选中) \d+ 位(?:评论作者|作者)/.test(bulkScopeLoaded.confirmText) || bulkScopeLoaded.parsedUids.length > 0) && bulkScopeLoaded.count > 0
      && bulkScopeLoaded.parsedUids.length === bulkScopeLoaded.count
      && /已拉黑：/.test(bulkScopeLoaded.toastText)
      && bulkScopeLoaded.blocked && bulkScopeLoaded.restored)
      report.pass.push('QB-AA 批量范围面板跨过周期扫描不被误关，仅当前已加载且不限时间时按原路径拉黑并撤销');
    else report.fail.push('QB-AA 批量范围面板（已加载模式）错误：' + JSON.stringify(bulkScopeLoaded));

    // 人工合成：模拟 x/v2/reply/main 两页 + 两个根评论的子回复页；第三位子回复缺
    // ctime。全量抓取必须翻完根与子页，时间筛选保留 5 位、跳过缺时间的 1 位。
    const bulkScopeAll = await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const callLog = [];
      window.__INITIAL_STATE__ = { aid: '12345', videoData: { aid: '12345' } };
      const makeReply = (rpid, mid, name, ctime, rcount) => ({ rpid_str: String(rpid), mid_str: String(mid), member: { uname: name }, ctime, rcount });
      window.fetch = async (input) => {
        const url = String(input);
        callLog.push(url);
        const isMain = url.includes('/x/v2/reply/main');
        const isSub = url.includes('/x/v2/reply/reply');
        if (isMain) {
          const next = Number(new URL(url).searchParams.get('next') || 0);
          if (next === 0) {
            return { ok: true, status: 200, json: async () => ({ code: 0, data: {
              replies: [makeReply('r1', 5001, 'Main One', now - 2000, 3), makeReply('r2', 5002, 'Main Two', now - 1000, 0)],
              cursor: { all_count: 3, is_end: false, next: 1 },
            } }) };
          }
          return { ok: true, status: 200, json: async () => ({ code: 0, data: {
            replies: [makeReply('r3', 5003, 'Main Three', now - 500, 2)],
            cursor: { all_count: 3, is_end: true, next: 2 },
          } }) };
        }
        if (isSub) {
          const root = String(new URL(url).searchParams.get('root') || '');
          if (root === 'r1') {
            return { ok: true, status: 200, json: async () => ({ code: 0, data: {
              replies: [makeReply('s1', 6001, 'Sub One', now - 300, 0), makeReply('s2', 6002, 'Sub Two', now - 100, 0)],
              page: { count: 2 },
            } }) };
          }
          return { ok: true, status: 200, json: async () => ({ code: 0, data: {
            replies: [makeReply('s3', 6003, 'Sub Three', 0, 0)],
            page: { count: 1 },
          } }) };
        }
        return { ok: false, status: 404, json: async () => ({ code: -1 }) };
      };
      const fab = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => /评论作者|评论屏蔽/.test(el.textContent || ''));
      if (!fab) return { exists: false };
      fab.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const unified = document.getElementById('ob-comment-manager');
      if (unified) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const since = unified.querySelector('.ob-cm-since');
        since.value = '3600'; since.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const rows = unified.querySelectorAll('.ob-cm-row').length;
        const checkAll = unified.querySelector('.ob-cm-checkall input'); if (checkAll) checkAll.click();
        const batch = unified.querySelector('.ob-cm-batch'); if (batch) batch.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const confirm = document.getElementById('ob-confirm');
        const confirmText = confirm && confirm.textContent || '';
        if (confirm) confirm.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const toast = document.getElementById('ob-toast');
        const toastText = toast && toast.textContent || '';
        const blocked = ['5001', '5002', '5003', '6001', '6002'].every((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
        const skippedUnknown = !window.OB.Index.isBlocked('bili:uid:6003');
        const undo = toast && toast.querySelector('button');
        if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
        const close = unified.querySelector('.ob-cm-close'); if (close) close.click();
        return { exists:true, panel:true, stayedOpen:true, loaded:true, allEnabled:true, presets:['3600','custom'], okText:'统一管理器', confirm:!!confirm, confirmText, toastText, rows, mainCalls:callLog.filter((url) => url.includes('/x/v2/reply/main')).length, subCalls:callLog.filter((url) => url.includes('/x/v2/reply/reply')).length, blocked, skippedUnknown, restored:!['5001', '5002', '5003', '6001', '6002'].some((mid) => window.OB.Index.isBlocked('bili:uid:' + mid)) };
      }
      const panel = document.getElementById('ob-bulk-scope');
      if (!panel) return { exists: true, panel: false };
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const stayedOpen = document.getElementById('ob-bulk-scope') === panel;
      panel.querySelector('input[value="all"]').click();
      const since = panel.querySelector('.ob-bs-since');
      since.value = '3600';
      since.dispatchEvent(new Event('change'));
      if (stayedOpen) panel.querySelector('.ob-bs-ok').click();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !document.getElementById('ob-confirm')) await new Promise((resolve) => setTimeout(resolve, 25));
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      const mainCalls = callLog.filter((url) => url.includes('/x/v2/reply/main')).length;
      const subCalls = callLog.filter((url) => url.includes('/x/v2/reply/reply')).length;
      if (!confirm) return { exists: true, panel: true, stayedOpen, confirm: false, mainCalls, subCalls, confirmText };
      confirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const toast = document.getElementById('ob-toast');
      const toastText = toast && toast.textContent || '';
      const blocked = ['5001', '5002', '5003', '6001', '6002'].every((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
      const skippedUnknown = !window.OB.Index.isBlocked('bili:uid:6003');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await new Promise((resolve) => setTimeout(resolve, 120)); }
      const restored = !['5001', '5002', '5003', '6001', '6002'].some((mid) => window.OB.Index.isBlocked('bili:uid:' + mid));
      return { exists: true, panel: true, stayedOpen, confirm: true, confirmText, toastText, mainCalls, subCalls, blocked, skippedUnknown, restored };
    });
    if (bulkScopeAll.exists && bulkScopeAll.panel && bulkScopeAll.stayedOpen && bulkScopeAll.confirm
      && bulkScopeAll.mainCalls === 2 && bulkScopeAll.subCalls === 2
      && (/(?:拉黑|屏蔽选中) 5 位(?:评论作者|作者)/.test(bulkScopeAll.confirmText) || bulkScopeAll.rows === 5)
      && /已拉黑：/.test(bulkScopeAll.toastText)
      && bulkScopeAll.blocked && bulkScopeAll.skippedUnknown && bulkScopeAll.restored)
      report.pass.push('QB-AB 批量面板跨过周期扫描并加载全部评论与子回复，按时间筛选跳过缺时间的未知记录');
    else report.fail.push('QB-AB 批量范围面板（全量/时间筛选）错误：' + JSON.stringify(bulkScopeAll));

    // 人工合成：视频页作者区 `.up-name` 旁出现「本地拉黑作者」，点击后按 uid 屏蔽并撤销。
    const videoAuthor = await page.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const mount = document.querySelector('.up-detail-top');
      const name = mount && mount.querySelector('.up-name');
      if (!mount || !name) return { found: false };
      const button = document.querySelector('.ob-bili-author-portal > .ob-bili-author-block');
      if (!button) return { found: true, button: false, mountedInsideVue: !!mount.querySelector(':scope > .ob-bili-author-block') };
      const before = { text: button.textContent, portal: !!button.closest('.ob-bili-author-portal'), mountedInsideVue: !!mount.querySelector(':scope > .ob-bili-author-block') };
      button.click(); await pause(80);
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      if (!confirm) return { ...before, confirm: false };
      confirm.querySelector('.ob-ok').click(); await pause(150);
      const blocked = window.OB.Index.isBlocked('bili:uid:888');
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await pause(150); }
      const restored = !window.OB.Index.isBlocked('bili:uid:888');
      return { ...before, found: true, button: true, confirm: true, confirmText, blocked, restored };
    });
    if (videoAuthor.found && videoAuthor.button && videoAuthor.text === '本地拉黑作者' && videoAuthor.portal && !videoAuthor.mountedInsideVue
      && videoAuthor.confirm && /Video Author/.test(videoAuthor.confirmText) && /bili:uid:888/.test(videoAuthor.confirmText)
      && videoAuthor.blocked && videoAuthor.restored)
      report.pass.push('QB-AC B站作者入口通过 body 门户贴近作者行，点击后按 uid 屏蔽并撤销');
    else report.fail.push('QB-AC 视频作者入口错误：' + JSON.stringify(videoAuthor));

    // 人工合成：动态详情页作者模块 `.opus-module-author` 使用 __INITIAL_STATE__ 的 mid。
    const OPUS_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div class="opus-module-author">
        <div class="opus-module-author__left"></div>
        <div class="opus-module-author__center">
          <div class="opus-module-author__name">Opus Author</div>
          <div class="opus-module-author__pub"><div class="opus-module-author__pub__text">2026-08-23</div></div>
        </div>
        <div class="opus-module-author__right"></div>
      </div>
      <script>window.__INITIAL_STATE__ = { detail: { module_author: { mid: '999', name: 'Opus Author' } } };</script>
    </body></html>`;
    const opusPage = await browser.newPage();
    opusPage.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[opus ' + m.type() + '] ' + m.text()); });
    opusPage.on('pageerror', (e) => report.pageErrors.push('[opus] ' + String(e)));
    await opusPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: OPUS_FIXTURE }));
    await opusPage.addInitScript({ path: path.join(ROOT, 'test', '_initqb.js') });
    await opusPage.goto('https://www.bilibili.com/opus/12345678901234567890', { waitUntil: 'domcontentloaded' });
    await opusPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await wait(1200);
    const opusAuthor = await opusPage.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !document.querySelector('.ob-bili-author-portal > .ob-bili-author-block')) await pause(100);
      const center = document.querySelector('.opus-module-author__center');
      let button = document.querySelector('.ob-bili-author-portal > .ob-bili-author-block');
      if (!button) {
        try { window.OB.adapters.bilibili.onScan(); } catch (e) {}
        await pause(300);
        button = document.querySelector('.ob-bili-author-portal > .ob-bili-author-block');
      }
      if (!center || !button) {
        return {
          found: !!center,
          button: !!button,
        };
      }
      const name = center.querySelector('.opus-module-author__name');
      const before = { text: button.textContent, portal: !!button.closest('.ob-bili-author-portal'), mountedInsideVue: !!center.querySelector(':scope > .ob-bili-author-block') };
      button.click(); await pause(80);
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      if (!confirm) return { ...before, confirm: false };
      confirm.querySelector('.ob-ok').click(); await pause(150);
      const blocked = window.OB.Index.isBlocked('bili:uid:999');
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await pause(150); }
      const restored = !window.OB.Index.isBlocked('bili:uid:999');
      return { ...before, found: true, button: true, name: name && name.textContent, confirm: true, confirmText, blocked, restored };
    });
    await opusPage.close();
    if (opusAuthor.found && opusAuthor.button && opusAuthor.text === '本地拉黑作者' && opusAuthor.portal && !opusAuthor.mountedInsideVue
      && opusAuthor.name === 'Opus Author' && opusAuthor.confirm
      && /Opus Author/.test(opusAuthor.confirmText) && /bili:uid:999/.test(opusAuthor.confirmText)
      && opusAuthor.blocked && opusAuthor.restored)
      report.pass.push('QB-AD 动态详情页作者模块显示「本地拉黑作者」，按 __INITIAL_STATE__ mid 屏蔽并撤销');
    else report.fail.push('QB-AD 动态作者入口错误：' + JSON.stringify(opusAuthor));
  } catch (error) {
    report.fail.push('FATAL: ' + (error && error.message || error));
  }

  const ok = report.fail.length === 0;
  fs.writeFileSync(path.join(ROOT, 'test', '_qb_lastrun.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('==== OmniBlock B站回归测试 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('Console(errors/warn):', report.console.length); report.console.forEach((line) => console.log('  ', line));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach((line) => console.log('  ', line));
  try { await browser.close(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

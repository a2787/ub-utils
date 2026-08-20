/* OmniBlock B站回归测试。
 * 覆盖真实页面已捕获的结构：bili-comment-thread-renderer Shadow Root 内
 * bili-comment-renderer 的 __data.member.mid、
 * bili-comment-menu Shadow DOM 的 <ul id="options"><li>，以及 seg.so protobuf。
 * 运行：node test/quickblock.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; window.__writes = (window.__writes || 0) + 1; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name:'本地内容过滤增强', version:'${LOCAL_VERSION}', namespace:'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (o) => { try { if(o.onerror) o.onerror(new Error('no net in test')); } catch(e){} };
window.GM_openInTab = () => {};
`;
fs.writeFileSync(path.join(ROOT, 'test', '_initqb.js'), SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-qb.js');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站真实结构回归页</title></head><body>
<div id="related"></div>
<bili-comments id="comments"></bili-comments>
<section class="bpx-player-dm-container" id="dm-panel">
  <li class="bpx-player-dm-item" data-progress="5000"><span>00:05</span><span>hello danmaku</span></li>
  <li class="bpx-player-dm-item" data-progress="9000"><span>00:09</span><span>keep danmaku</span></li>
</section>
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
  const commentsStyle = document.createElement('style'); commentsStyle.textContent = 'bili-comment-thread-renderer{display:block;height:24px;margin:0;padding:0}'; commentsRoot.appendChild(commentsStyle);
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
  commentsRoot.append(makeComment(111, 'Alice'), makeComment(222, 'Bob'), makeComment(333, 'Carol'));
  window.__commentRenderer = (mid) => commentsRoot.querySelector('#comment-' + mid).shadowRoot.querySelector('bili-comment-renderer');
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
]);

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

  await page.route('**/*', (route) => {
    if (/\/dm\/(?:wbi\/)?web\/seg\.so/.test(route.request().url())) {
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: SEGMENT });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ path: path.join(ROOT, 'test', '_initqb.js') });

  try {
    await page.goto('https://www.bilibili.com/video/BV1test', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await wait(1500);

    const count = await page.evaluate(() => {
      const fab = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => el.textContent.includes('本页评论用户'));
      return { text: fab ? fab.textContent : '', users: window.OB.collectUsers(document).map((item) => item.keys[0]) };
    });
    if (count.text.includes('(3)') && count.users.length === 3 && !count.users.some((key) => key.includes('9000')))
      report.pass.push('QB-A 本页统计只计 3 位评论作者，不计 34 张推荐视频卡');
    else report.fail.push('QB-A 评论统计错误：' + JSON.stringify(count));

    const menu = await page.evaluate(() => {
      const renderer = window.__commentRenderer('111');
      const list = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('#options');
      const button = list.querySelector('.ob-quick');
      return { tag: button && button.tagName, text: button && button.textContent, count: list.querySelectorAll('.ob-quick').length };
    });
    if (menu.tag === 'LI' && menu.text.includes('本地拉黑') && menu.count === 1)
      report.pass.push('QB-B 真实 bili-comment-menu #options 菜单注入一个合法的 LI 本地拉黑项');
    else report.fail.push('QB-B 评论菜单注入失败：' + JSON.stringify(menu));

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
    await page.waitForFunction(() => !!document.querySelector('#dm-panel .ob-dm-block'), null, { timeout: 5000 });
    const dm = await page.evaluate(async () => {
      const row = document.querySelector('#dm-panel .bpx-player-dm-item');
      const button = row.querySelector('.ob-dm-block');
      if (!button) return { exists: false };
      button.click(); await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { exists: true, confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        exists: true,
        confirm: true,
        blocked: window.OB.Index.isBlocked('bili:dmhash:678f8529'),
        hidden: row.getAttribute('data-ob-dm-blocked') === '1',
        visuallyHidden: getComputedStyle(row).display === 'none' || row.getBoundingClientRect().height === 0,
        bars: document.querySelectorAll('#dm-panel .ob-bar').length,
      };
    });
    if (dm.exists && dm.confirm && dm.blocked && dm.hidden && dm.visuallyHidden && dm.bars === 0) report.pass.push('QB-H 弹幕列表按 mid_hash 拉黑后无提示、零占位消失（XHR 段数据）');
    else report.fail.push('QB-H 弹幕列表拉黑失败：' + JSON.stringify(dm));

    const dmUndo = await page.evaluate(async () => {
      const toast = document.getElementById('ob-toast');
      if (!toast) return { toast: false };
      toast.querySelector('button').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      const row = document.querySelector('#dm-panel .bpx-player-dm-item');
      return {
        toast: true,
        removed: !window.OB.Index.isBlocked('bili:dmhash:678f8529'),
        visible: row.getAttribute('data-ob-dm-blocked') !== '1',
        visuallyVisible: getComputedStyle(row).display !== 'none' && row.getBoundingClientRect().height > 0,
      };
    });
    if (dmUndo.toast && dmUndo.removed && dmUndo.visible && dmUndo.visuallyVisible) report.pass.push('QB-I 撤销弹幕发送者拉黑后，当前列表行立即恢复');
    else report.fail.push('QB-I 弹幕撤销未恢复列表行：' + JSON.stringify(dmUndo));

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

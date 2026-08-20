/* OmniBlock 快捷拉黑自测：模拟 B站 DOM，验证"锚定式快速拉黑"与"一键拉黑全部"
 * 运行：node test/quickblock.cjs
 */
const { chromium } = require('C:/Users/et4vr/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/pluginforchrome';
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = () => {};
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name:'本地内容过滤增强', version:'${LOCAL_VERSION}', namespace:'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (o) => { try { if(o.onerror) o.onerror(new Error('no net in test')); } catch(e){} };
window.GM_openInTab = () => {};
`;
fs.writeFileSync(path.join(ROOT, 'test', '_initqb.js'), SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-qb.js');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站</title></head><body>
<h3>评论区</h3>
<div id="clist"></div>
<h3>弹幕区</h3>
<div id="dm"></div>
<h3>空间页头部</h3>
<div id="space"><button class="native-block">拉黑</button></div>
<h3>点赞弹窗</h3>
<div id="modalhost"></div>
<script>
  function mkComment(uid, name, text){
    const host = document.createElement('bili-comment-renderer');
    const sr = host.attachShadow({mode:'open'});
    const a = document.createElement('a'); a.className='user-name'; a.href='https://space.bilibili.com/'+uid; a.textContent=name;
    const t = document.createElement('span'); t.className='text'; t.textContent=text;
    const menu = document.createElement('div'); menu.className='more-menu';
    const b1 = document.createElement('button'); b1.textContent='加入黑名单';
    const b2 = document.createElement('button'); b2.textContent='举报';
    menu.appendChild(b1); menu.appendChild(b2);
    sr.appendChild(a); sr.appendChild(t); sr.appendChild(menu);
    return host;
  }
  const cl = document.getElementById('clist');
  cl.appendChild(mkComment(111,'Alice','Alice 评论'));
  cl.appendChild(mkComment(222,'Bob','Bob 评论'));
  cl.appendChild(mkComment(333,'Carol','Carol 评论'));
  (function(){
    const dm = document.createElement('div'); dm.className='danmaku'; dm.setAttribute('data-mid','777');
    const sr = dm.attachShadow({mode:'open'});
    const menu = document.createElement('div'); menu.className='dm-menu';
    const r = document.createElement('button'); r.textContent='举报';
    menu.appendChild(r); sr.appendChild(menu); dm.appendChild(document.createTextNode('弹幕内容'));
    document.getElementById('dm').appendChild(dm);
  })();
</script>
</body></html>`;

const MODAL_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>空间</title></head><body>
<div id="space"><button class="native-block">拉黑</button></div>
<div id="modalhost"></div>
<script>
  function mkComment(uid, name){
    const host = document.createElement('bili-comment-renderer');
    const sr = host.attachShadow({mode:'open'});
    const a = document.createElement('a'); a.className='user-name'; a.href='https://space.bilibili.com/'+uid; a.textContent=name;
    sr.appendChild(a);
    return host;
  }
  const modal = document.createElement('div'); modal.setAttribute('role','dialog'); modal.id='likers';
  modal.appendChild(mkComment(901,'U901'));
  modal.appendChild(mkComment(902,'U902'));
  modal.appendChild(mkComment(903,'U903'));
  document.getElementById('modalhost').appendChild(modal);
</script>
</body></html>`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isBlocked = (arr, key) => !!(arr && arr.Index && arr.Index.isBlocked(key));

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  process.on('unhandledRejection', (e) => report.pageErrors.push('UNHANDLED:' + (e && e.message || e)));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type()==='error'||m.type()==='warning') report.console.push('['+m.type()+'] '+m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  const ev = async (code) => { try { return await page.evaluate(code); } catch (e) { report.fail.push('EVAL_ERR: ' + (e && e.message || e)); return null; } };

  try {
    await page.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body: FIXTURE }));
    await page.addInitScript({ path: path.join(ROOT, 'test', '_initqb.js') });
    await page.goto('https://www.bilibili.com/video/av1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 }).catch(() => {});
    await sleep(1400);

    const obKeys = await ev(() => window.OB ? Object.keys(window.OB) : 'NO_OB');
    report.pass.push('OB 导出键：' + JSON.stringify(obKeys));
    if (!obKeys || obKeys === 'NO_OB' || obKeys.indexOf('Index') === -1) report.fail.push('window.OB 缺少 Index（初始化抛错）');

    const qa = await ev(() => {
      const hosts = Array.from(document.querySelectorAll('bili-comment-renderer'));
      const alice = hosts.find(h => h.shadowRoot && h.shadowRoot.querySelector('a[href*="space.bilibili.com/111"]'));
      if (!alice) return { missing:true };
      const qb = alice.shadowRoot.querySelector('.ob-quick');
      return { hasQuick: !!qb, text: qb ? qb.textContent : '' };
    });
    (qa && qa.hasQuick && qa.text && qa.text.includes('本地拉黑')) ? report.pass.push('QB-A 评论菜单注入"本地拉黑"') : report.fail.push('QB-A 失败：' + JSON.stringify(qa));

    const qb = await ev(`(async () => {
      const hosts = Array.from(document.querySelectorAll('bili-comment-renderer'));
      const alice = hosts.find(h => h.shadowRoot && h.shadowRoot.querySelector('a[href*="space.bilibili.com/111"]'));
      const native = alice.shadowRoot.querySelector('.more-menu button');
      let preInfo=null, preErr=null;
      try { preInfo = window.OB.identifyFromAnchor(native); } catch(e){ preErr=e.message; }
      const btn = alice.shadowRoot.querySelector('.ob-quick');
      btn.click();
      await new Promise(r=>setTimeout(r,150));
      const conf = document.getElementById('ob-confirm');
      if(!conf) return { preInfo, preErr, hasConfirm:false, blocked:false, hidden:false };
      conf.querySelector('.ob-ok').click();
      await new Promise(r=>setTimeout(r,400));
      return { preInfo, preErr, hasConfirm:true, blocked: !!(window.OB && window.OB.Index && window.OB.Index.isBlocked(['bili:uid:111'])), hidden: alice.getAttribute('data-ob-blocked')==='1' };
    })()`);
    (qb && qb.hasConfirm && qb.blocked && qb.hidden) ? report.pass.push('QB-B 一键识别并拉黑评论用户(111)') : report.fail.push('QB-B 失败：' + JSON.stringify(qb));

    const qc = await ev(`(async () => {
      const dm = document.querySelector('.danmaku');
      if(!dm) return { missing:true };
      const native = dm.shadowRoot.querySelector('.dm-menu button');
      let preInfo=null, preErr=null;
      try { preInfo = window.OB.identifyFromAnchor(native); } catch(e){ preErr=e.message; }
      const qb = dm.shadowRoot.querySelector('.ob-quick');
      if(!qb) return { noQuick:true, preInfo, preErr };
      qb.click();
      await new Promise(r=>setTimeout(r,150));
      const conf = document.getElementById('ob-confirm');
      if(!conf) return { preInfo, preErr, hasConfirm:false };
      conf.querySelector('.ob-ok').click();
      await new Promise(r=>setTimeout(r,400));
      return { preInfo, preErr, hasConfirm:true, blocked: !!(window.OB && window.OB.Index && window.OB.Index.isBlocked(['bili:uid:777'])) };
    })()`);
    (qc && qc.blocked) ? report.pass.push('QB-C 弹幕"举报"旁注入并拉黑发送者(777)') : report.fail.push('QB-C 失败：' + JSON.stringify(qc));

    await page.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body: MODAL_FIXTURE }));
    await page.goto('https://space.bilibili.com/888', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 }).catch(() => {});
    await sleep(1600);

    const qd = await ev(`(async () => {
      const native = document.querySelector('#space .native-block');
      const qb = native.parentNode.querySelector(':scope > .ob-quick');
      if(!qb) return { noQuick:true };
      qb.click();
      await new Promise(r=>setTimeout(r,150));
      const conf = document.getElementById('ob-confirm');
      if(!conf) return { step:'no-confirm' };
      conf.querySelector('.ob-ok').click();
      await new Promise(r=>setTimeout(r,400));
      return { blocked: !!(window.OB && window.OB.Index && window.OB.Index.isBlocked(['bili:uid:888'])) };
    })()`);
    (qd && qd.blocked) ? report.pass.push('QB-D 空间页头部"拉黑"旁注入并拉黑(888)') : report.fail.push('QB-D 失败：' + JSON.stringify(qd));

    const qe = await ev(`(async () => {
      const modal = document.getElementById('likers');
      const bulk = modal.querySelector('.ob-bulk');
      if(!bulk) return { noBulk:true, html: modal ? modal.innerHTML.slice(0,200) : 'no-modal' };
      bulk.click();
      await new Promise(r=>setTimeout(r,150));
      const conf = document.getElementById('ob-confirm');
      if(!conf) return { step:'no-confirm' };
      conf.querySelector('.ob-ok').click();
      await new Promise(r=>setTimeout(r,500));
      const ok = ['901','902','903'].every(u => window.OB.Index.isBlocked(['bili:uid:'+u]));
      return { bulkText: bulk.textContent, allBlocked: ok };
    })()`);
    (qe && qe.allBlocked) ? report.pass.push('QB-E 点赞弹窗"拉黑全部"批量入库(901/902/903)') : report.fail.push('QB-E 失败：' + JSON.stringify(qe));

    const qf = await ev(() => {
      const fab = Array.from(document.querySelectorAll('.ob-bulk')).find(b => b.textContent.includes('拉黑本页用户'));
      return { hasFab: !!fab, text: fab ? fab.textContent : '' };
    });
    const m = qf && qf.text && qf.text.match(/\((\d+)\)/);
    (qf && qf.hasFab && m && parseInt(m[1])>0) ? report.pass.push('QB-F 本页浮层"拉黑本页用户(N)"出现') : report.fail.push('QB-F 失败：' + JSON.stringify(qf));
  } catch (e) {
    report.fail.push('FATAL: ' + (e && e.message || e));
  }

  const ok = report.fail.length === 0;
  try { fs.writeFileSync(path.join(ROOT, 'test', '_qb_lastrun.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'); } catch (e) {}
  console.log('==== OmniBlock 快捷拉黑自测 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach(x => console.log('  ✅', x));
  console.log('FAIL:', report.fail.length); report.fail.forEach(x => console.log('  ❌', x));
  console.log('Console(err/warn):', report.console.length); report.console.forEach(x => console.log('  ·', x));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach(x => console.log('  ·', x));
  console.log(ok ? '\nRESULT: ALL GREEN ✅' : '\nRESULT: HAS FAILURES ❌');
  try { await browser.close(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})();

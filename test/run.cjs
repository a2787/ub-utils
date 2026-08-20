/* OmniBlock 自测夹具：用真实 Chrome 跑用户脚本
 * 覆盖：B站 Shadow DOM 拉黑链路 + 全局影子穿透兜底 + 检查更新按钮三分支
 * 依赖：playwright-core 与 Chrome；可用 PLAYWRIGHT_CORE_PATH / CHROME_PATH 覆盖自动发现。
 * 运行：node test/run.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const UPDATE_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';
const DOWNLOAD_URL = UPDATE_URL;
// 解析脚本头里的本地版本，注入 GM_info（模拟 Tampermonkey 提供的元信息），供 checkUpdate 比对
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

// 动态控制"远程版本"（更新测试用）
let updateVersion = '9.9.9';

// 1) GM_* 桩 + 预置被拉黑用户（Bob=222 验证加载即隐藏；Frank=666 验证嵌套影子穿透）
const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1,
  persons: {
    'p_bob': { label:'Bob', note:'', createdAt:0, hits:0, identities:['bili:uid:222'] },
    'p_frank': { label:'Frank', note:'', createdAt:0, hits:0, identities:['bili:uid:666'] }
  },
  settings: { enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6 }
}) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => {
  const inject = () => { const s=document.createElement('style'); s.textContent=css; const p=document.head||document.documentElement; if(p) p.appendChild(s); };
  if (document.head || document.documentElement) inject();
  else document.addEventListener('DOMContentLoaded', inject);
};
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
// 模拟 Tampermonkey 注入的元信息（checkUpdate 用 GM_info.script.version 取本地版本）
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
// 用 fetch 实现 GM_xmlhttpRequest（让 Playwright route 能拦截并返回伪造的远程脚本）
// __forceXhrError 置真时直接走 onerror，模拟"网络错误"分支而不产生真实请求（避免控制台噪声）
window.GM_xmlhttpRequest = (opts) => {
  if (window.__forceXhrError) { try { if (opts.onerror) opts.onerror(new Error('simulated network error')); } catch (e) {} return; }
  window.fetch(opts.url).then((r) => r.text()).then((t) => { if (opts.onload) opts.onload({ responseText: t, status: 200 }); })
    .catch((e) => { if (opts.onerror) opts.onerror(e); });
};
window.GM_openInTab = (url) => { window.__openInTab = window.__openInTab || []; window.__openInTab.push(url); };
`;
fs.writeFileSync(path.join(ROOT, 'test', '_initscript.js'), SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-injected.js');

// 2) 测试页：模拟 B站 评论区（评论在 Shadow DOM 内），并额外加一个"双层嵌套影子"的 Frank(666)
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站测试页</title></head>
<body>
<h3>评论区（模拟 B站 Shadow DOM 结构）</h3>
<div class="comment-list" id="clist"></div>
<div class="nested-wrap" id="nwrap"><span>下面的 Frank 在双层影子 DOM 内</span></div>
<script>
  function mk(uid, name, text, sub){
    const host = document.createElement('bili-comment-renderer');
    const sr = host.attachShadow({mode:'open'});
    const a = document.createElement('a'); a.className='user-name';
    a.href='https://space.bilibili.com/'+uid; a.textContent=name;
    const t = document.createElement('span'); t.className='text'; t.textContent=text;
    sr.appendChild(a); sr.appendChild(t);
    if(sub){
      const sh=document.createElement('bili-sub-comment-renderer');
      const ssr=sh.attachShadow({mode:'open'});
      const sa=document.createElement('a'); sa.className='user-name';
      sa.href='https://space.bilibili.com/'+sub.uid; sa.textContent=sub.name;
      const st=document.createElement('span'); st.className='text'; st.textContent=sub.text;
      ssr.appendChild(sa); ssr.appendChild(st); sr.appendChild(sh);
    }
    return host;
  }
  const list=document.getElementById('clist');
  list.appendChild(mk(111,'Alice','Alice 的正常评论'));
  list.appendChild(mk(222,'Bob','Bob 的评论（应被预拉黑隐藏）'));
  list.appendChild(mk(333,'Carol','Carol 的评论（用于右键拉黑测试）'));
  list.appendChild(mk(444,'Dave','Dave 的评论',{uid:555,name:'Eve',text:'Eve 的楼中楼回复'}));

  // Frank(666) 放在"外层阴影 -> 内层阴影 -> bili-comment-renderer"的双层嵌套里
  (function(){
    const wrap=document.getElementById('nwrap');
    const inner=document.createElement('div');
    const innerRoot=inner.attachShadow({mode:'open'});
    const host=document.createElement('bili-comment-renderer');
    const sr=host.attachShadow({mode:'open'});
    const a=document.createElement('a'); a.className='user-name'; a.href='https://space.bilibili.com/666'; a.textContent='Frank';
    const t=document.createElement('span'); t.className='text'; t.textContent='Frank 的嵌套影子评论（应被全局穿透隐藏）';
    sr.appendChild(a); sr.appendChild(t);
    innerRoot.appendChild(host); wrap.appendChild(inner);
  })();
</script>
</body></html>`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));

  // 单一兜底路由：按请求 URL 分流——"更新地址"返回伪造远程脚本，其余返回测试页。
  // 用单一路由 + 精确 URL 判断，避免 Playwright 多路由 glob 匹配的优先级歧义。
  // （"网络错误"分支由 SHIM 的 __forceXhrError 直接触发 onerror 模拟，不走真实请求）
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === UPDATE_URL) {
      return route.fulfill({
        status: 200, contentType: 'text/plain; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '// ==UserScript==\n// @name x\n// @version ' + updateVersion + '\n// ==/UserScript==\n',
      });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });

  await page.addInitScript({ path: path.join(ROOT, 'test', '_initscript.js') });
  await page.goto('https://www.bilibili.com/test', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 }).catch(() => {});
  await sleep(1300);

  const diag = await page.evaluate(() => ({
    total: document.querySelectorAll('*').length,
    bili: document.querySelectorAll('bili-comment-renderer').length,
    clistKids: (document.getElementById('clist') || {}).childElementCount,
    ob: !!window.OB, gear: !!document.getElementById('ob-gear'),
  }));
  console.log('DIAG:', JSON.stringify(diag));
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  if (!diag.ob) report.fail.push('用户脚本未初始化（window.OB 不存在）——见上方 PAGEERRORS/CONSOLE');

  const hostOf = `(uid) => { const arr = Array.from(document.querySelectorAll('bili-comment-renderer')); const h = arr.find(x => x.shadowRoot && x.shadowRoot.querySelector('a[href*="space.bilibili.com/' + uid + '"]')); return h || null; }`;

  // A. 加载即隐藏：Bob(222) 应被标记
  const a = await page.evaluate(`(() => {
    const f = ${hostOf}; const bob = f('222');
    return { exists: !!bob, blocked: !!(bob && bob.getAttribute('data-ob-blocked')==='1'), obCount: document.querySelectorAll('[data-ob-blocked="1"]').length };
  })()`);
  a.exists && a.blocked ? report.pass.push('A 加载即隐藏：Bob(222) 已隐藏') : report.fail.push('A 加载即隐藏失败：' + JSON.stringify(a));

  // B. 未拉黑者初始可见：Alice(111)/Carol(333) 未隐藏
  const b = await page.evaluate(`(() => {
    const f = ${hostOf};
    const alice = f('111'); const carol = f('333');
    return { alice: !!(alice && alice.getAttribute('data-ob-blocked')!=='1'), carol: !!(carol && carol.getAttribute('data-ob-blocked')!=='1') };
  })()`);
  (b.alice && b.carol) ? report.pass.push('B 未拉黑者初始可见：Alice/Carol 正常') : report.fail.push('B 未拉黑者异常：' + JSON.stringify(b));

  await page.screenshot({ path: path.join(ROOT, 'test', 'shot-1-load.png'), fullPage: true });

  // C. 右键穿透 Shadow DOM：Carol 影子内 <a> 派发 contextmenu
  const c = await page.evaluate(`(() => {
    const f = ${hostOf};
    const carol = f('333'); if(!carol) return { missing:true };
    const a = carol.shadowRoot.querySelector('a.user-name');
    const ev = new MouseEvent('contextmenu', { bubbles:true, cancelable:true, composed:true, clientX:40, clientY:40 });
    a.dispatchEvent(ev);
    const ctx = document.getElementById('ob-ctx');
    return { ctxShown: !!ctx, text: ctx ? ctx.textContent : '' };
  })()`);
  (c.ctxShown && c.text.includes('Carol')) ? report.pass.push('C 右键穿透 Shadow DOM：菜单识别 Carol') : report.fail.push('C 右键菜单失败：' + JSON.stringify(c));

  // D. 走完拉黑流程：Carol(333) 隐藏并入库
  const d = await page.evaluate(`(async () => {
    const f = ${hostOf};
    if(!document.getElementById('ob-ctx')) return { step:'no-ctx' };
    document.querySelector('#ob-ctx button').click();
    await new Promise(r=>setTimeout(r,150));
    const conf = document.getElementById('ob-confirm');
    if(!conf) return { step:'no-confirm' };
    conf.querySelector('.ob-ok').click();
    await new Promise(r=>setTimeout(r,400));
    const carol = f('333');
    return { confirmShown:true, carolBlocked: !!(carol && carol.getAttribute('data-ob-blocked')==='1'), inList: !!(window.OB && window.OB.Index.isBlocked(['bili:uid:333'])) };
  })()`);
  (d.confirmShown && d.carolBlocked && d.inList) ? report.pass.push('D 拉黑全流程：Carol 已隐藏且进名单') : report.fail.push('D 拉黑流程失败：' + JSON.stringify(d));

  await page.screenshot({ path: path.join(ROOT, 'test', 'shot-2-after-block.png'), fullPage: true });

  // E. 设置面板：出现且含"抖音连续跳过上限"(skipCap) 与 "检查更新"按钮
  const e = await page.evaluate(`(async () => {
    document.getElementById('ob-gear').click();
    await new Promise(r=>setTimeout(r,150));
    const panel = document.getElementById('ob-panel');
    const skip = panel ? panel.querySelector('#ob-skipcap') : null;
    const upd = panel ? panel.querySelector('#ob-update') : null;
    return { panelShown: !!panel, hasSkipCap: !!skip, hasUpdateBtn: !!upd };
  })()`);
  (e.panelShown && e.hasSkipCap && e.hasUpdateBtn) ? report.pass.push('E 设置面板：含"跳过上限"与"检查更新"按钮') : report.fail.push('E 设置面板失败：' + JSON.stringify(e));

  // F. 全局影子穿透兜底：Frank(666) 在双层嵌套 Shadow DOM 内也应被隐藏
  const f = await page.evaluate(`(() => {
    function findNested(uid){
      function walk(node){
        if(node && node.shadowRoot){
          if(node.shadowRoot.querySelector('a[href*="space.bilibili.com/'+uid+'"]')) return node;
          for(const c of node.shadowRoot.children){ const r=walk(c); if(r) return r; }
        }
        for(const c of (node.children||[])){ const r=walk(c); if(r) return r; }
        return null;
      }
      return walk(document);
    }
    const frank = findNested('666');
    return { found: !!frank, blocked: !!(frank && frank.getAttribute('data-ob-blocked')==='1') };
  })()`);
  (f.found && f.blocked) ? report.pass.push('F 全局影子穿透：嵌套影子内的 Frank(666) 也被隐藏') : report.fail.push('F 嵌套影子穿透失败：' + JSON.stringify(f));

  // G. 检查更新·有新版：应提示发现新版本并打开安装页
  updateVersion = '9.9.9';
  const g = await page.evaluate(`(async () => {
    window.__openInTab = [];
    document.getElementById('ob-update').click();
    await new Promise(r=>setTimeout(r,400));
    return { status: (document.getElementById('ob-update-status')||{}).textContent, opened: window.__openInTab || [] };
  })()`);
  (g.status && g.status.includes('发现新版本') && g.opened.some((u) => u.includes('omniblock.user.js')))
    ? report.pass.push('G 检查更新·有新版：提示并打开安装页') : report.fail.push('G 有新版分支失败：' + JSON.stringify(g));

  // H. 检查更新·无新版：应提示已是最新
  updateVersion = '0.0.1';
  const h = await page.evaluate(`(async () => {
    document.getElementById('ob-update').click();
    await new Promise(r=>setTimeout(r,400));
    return (document.getElementById('ob-update-status')||{}).textContent;
  })()`);
  (h && h.includes('已是最新')) ? report.pass.push('H 检查更新·无新版：提示已是最新') : report.fail.push('H 无新版分支失败：' + JSON.stringify(h));

  // I. 检查更新·网络错误：__forceXhrError 置真，SHIM 直接走 onerror（不发起真实请求，无控制台噪声）
  updateVersion = '0.0.1';
  const i = await page.evaluate(`(async () => {
    window.__forceXhrError = true;
    document.getElementById('ob-update').click();
    await new Promise(r=>setTimeout(r,400));
    return (document.getElementById('ob-update-status')||{}).textContent;
  })()`);
  (i && i.includes('检查失败')) ? report.pass.push('I 检查更新·网络错误：提示检查失败') : report.fail.push('I 网络错误分支失败：' + JSON.stringify(i));

  await page.screenshot({ path: path.join(ROOT, 'test', 'shot-3-settings.png'), fullPage: true });

  const ok = report.fail.length === 0;
  // 同步落盘报告（务必在 browser.close 之前，避免其偶发挂起导致进程卡死、结果丢失）
  try { fs.writeFileSync(path.join(ROOT, 'test', '_lastrun.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'); } catch (e) {}
  console.log('==== OmniBlock 自测结果 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach(x => console.log('  ✅', x));
  console.log('FAIL:', report.fail.length); report.fail.forEach(x => console.log('  ❌', x));
  console.log('Console(errors/warn):', report.console.length); report.console.forEach(x => console.log('  ·', x));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach(x => console.log('  ·', x));
  console.log(ok ? '\nRESULT: ALL GREEN ✅' : '\nRESULT: HAS FAILURES ❌');
  // 不 await browser.close：偶发挂起会让进程无法自然退出；强制退出以保结果落盘
  try { browser.close().catch(() => {}); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});

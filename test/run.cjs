/* OmniBlock 自测夹具：用真实 Chrome 跑用户脚本，验证 B站 Shadow DOM 相关修复
 * 依赖：playwright-core（已存在于本机 node workspace），系统 Chrome
 * 运行：node test/run.cjs
 */
const { chromium } = require('C:/Users/et4vr/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/pluginforchrome';
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');

// 1) GM_* 桩 + 预置一个被拉黑用户（Bob=222，用于验证"加载即隐藏"）
const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1,
  persons: { 'p_bob': { label:'Bob', note:'', createdAt:0, hits:0, identities:['bili:uid:222'] } },
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
`;
fs.writeFileSync(path.join(ROOT, 'test', '_initscript.js'), SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-injected.js');

// 2) 测试页：模拟 B站 评论区（评论在 Shadow DOM 内，宿主是 bili-comment-renderer）
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站测试页</title></head>
<body>
<h3>评论区（模拟 B站 Shadow DOM 结构）</h3>
<div class="comment-list" id="clist"></div>
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
</script>
</body></html>`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));

  await page.addInitScript({ path: path.join(ROOT, 'test', '_initscript.js') });
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));

  await page.goto('https://www.bilibili.com/test', { waitUntil: 'domcontentloaded' });
  // 等扫描器（800ms 兜底扫描）
  await page.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 }).catch(() => {});
  await sleep(1300);

  const diag = await page.evaluate(() => ({
    total: document.querySelectorAll('*').length,
    bili: document.querySelectorAll('bili-comment-renderer').length,
    clistKids: (document.getElementById('clist') || {}).childElementCount,
    ob: !!window.OB,
    gear: !!document.getElementById('ob-gear'),
    bodyLen: (document.body && document.body.innerHTML || '').slice(0, 80),
  }));
  console.log('DIAG:', JSON.stringify(diag));
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));

  if (!diag.ob) { report.fail.push('用户脚本未初始化（window.OB 不存在）——见上方 PAGEERRORS/CONSOLE'); }

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

  // C. 右键穿透 Shadow DOM：在 Carol 影子内 <a> 上派发 contextmenu，应弹出含 "Carol" 的菜单
  const c = await page.evaluate(`(() => {
    const f = ${hostOf};
    const carol = f('333'); if(!carol) return { missing:true };
    const a = carol.shadowRoot.querySelector('a.user-name');
    const ev = new MouseEvent('contextmenu', { bubbles:true, cancelable:true, composed:true, clientX:40, clientY:40 });
    a.dispatchEvent(ev);
    const ctx = document.getElementById('ob-ctx');
    return { ctxShown: !!ctx, text: ctx ? ctx.textContent : '' };
  })()`);
  (c.ctxShown && c.text.includes('Carol')) ? report.pass.push('C 右键穿透 Shadow DOM：菜单出现且识别 Carol') : report.fail.push('C 右键菜单失败：' + JSON.stringify(c));

  // D. 走完拉黑流程：点菜单 -> 确认气泡 -> 拉黑，Carol 应被隐藏且进名单
  const d = await page.evaluate(`(async () => {
    const f = ${hostOf};
    if(!document.getElementById('ob-ctx')) return { step:'no-ctx' };
    document.querySelector('#ob-ctx button').click();           // 菜单 -> 拉黑
    await new Promise(r=>setTimeout(r,150));
    const conf = document.getElementById('ob-confirm');
    if(!conf) return { step:'no-confirm' };
    conf.querySelector('.ob-ok').click();                       // 确认拉黑
    await new Promise(r=>setTimeout(r,400));                    // 等重扫
    const carol = f('333');
    return {
      confirmShown: true,
      carolBlocked: !!(carol && carol.getAttribute('data-ob-blocked')==='1'),
      inList: !!(window.OB && window.OB.Index.isBlocked(['bili:uid:333'])),
    };
  })()`);
  (d.confirmShown && d.carolBlocked && d.inList) ? report.pass.push('D 拉黑全流程：Carol 已隐藏且进名单') : report.fail.push('D 拉黑流程失败：' + JSON.stringify(d));

  await page.screenshot({ path: path.join(ROOT, 'test', 'shot-2-after-block.png'), fullPage: true });

  // E. 设置面板：点齿轮，应出现且含"抖音连续跳过上限"(skipCap)
  const e = await page.evaluate(`(async () => {
    document.getElementById('ob-gear').click();
    await new Promise(r=>setTimeout(r,150));
    const panel = document.getElementById('ob-panel');
    const skip = panel ? panel.querySelector('#ob-skipcap') : null;
    return { panelShown: !!panel, hasSkipCap: !!skip, obCount: document.querySelectorAll('[data-ob-blocked="1"]').length };
  })()`);
  (e.panelShown && e.hasSkipCap) ? report.pass.push('E 设置面板：出现且含"抖音连续跳过上限"') : report.fail.push('E 设置面板失败：' + JSON.stringify(e));

  await page.screenshot({ path: path.join(ROOT, 'test', 'shot-3-settings.png'), fullPage: true });

  await browser.close();

  // 汇总
  const ok = report.fail.length === 0;
  console.log('==== OmniBlock 自测结果 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach(x => console.log('  ✅', x));
  console.log('FAIL:', report.fail.length); report.fail.forEach(x => console.log('  ❌', x));
  console.log('Console(errors/warn):', report.console.length); report.console.forEach(x => console.log('  ·', x));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach(x => console.log('  ·', x));
  console.log(ok ? '\nRESULT: ALL GREEN ✅' : '\nRESULT: HAS FAILURES ❌');
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('HARNESS ERROR:', err);
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exit(2);
});

/* OmniBlock 核心状态与身份契约回归。
 * 夹具为人工合成 DOM；证明状态机和输入边界，不代表真实平台结构。
 * 运行：node test/state.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

function shim(persons, settings = {}) {
  return `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:${JSON.stringify(persons)}, settings:${JSON.stringify({ enabled: true, hideMode: 'collapse', showHoverButton: true, douyinAutoSkip: true, skipCap: 6, showQuickBlock: true, showBulkBlock: true, ...settings })} }) };
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
}

const biliFixture = `<!doctype html><html><body><bili-comments id="comments"></bili-comments><script>
const root = document.getElementById('comments').attachShadow({mode:'open'});
function addComment(uid, name) {
  const item = document.createElement('bili-comment-renderer');
  item.__data = { member:{ mid:String(uid), uname:name } };
  const shadow = item.attachShadow({mode:'open'});
  const link = document.createElement('a'); link.className='user-name'; link.href='//space.bilibili.com/'+uid; link.textContent=name;
  const menu = document.createElement('bili-comment-menu'); menu.__data = { member:{ mid:String(uid), uname:name } };
  const menuRoot = menu.attachShadow({mode:'open'}); const options = document.createElement('ul'); options.id='options';
  const nativeBlock = document.createElement('li'); nativeBlock.textContent='加入黑名单'; options.appendChild(nativeBlock); menuRoot.appendChild(options);
  shadow.append(link, menu); root.appendChild(item); return item;
}
window.__addComment = addComment;
addComment(222, 'Bob');
</script></body></html>`;

const xFixture = `<!doctype html><html><body><div data-testid="cellInnerDiv" id="cell"><article data-testid="tweet"><a role="link" href="/MixedCase">@MixedCase</a></article></div></body></html>`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const bili = await browser.newPage();
    await bili.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: biliFixture }));
    await bili.addInitScript({ content: shim({ p_bob:{ label:'Bob', note:'', createdAt:0, hits:0, identities:['bili:uid:222'] }, p_late:{ label:'Late', note:'', createdAt:0, hits:0, identities:['bili:uid:333'] } }) + '\n' + userscript });
    await bili.goto('https://www.bilibili.com/test', { waitUntil: 'domcontentloaded' });
    await bili.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 });
    await wait(1300);

    const initial = await bili.evaluate(() => {
      const root = document.querySelector('bili-comments').shadowRoot;
      const item = root.querySelector('bili-comment-renderer');
      return { blocked:item.getAttribute('data-ob-blocked') === '1', collapsed:item.classList.contains('ob-collapsed'), bars:root.querySelectorAll('.ob-bar').length };
    });
    if (initial.blocked && initial.collapsed && initial.bars === 1) report.pass.push('STATE-A 初始黑名单内容折叠且只有一个恢复条');
    else report.fail.push('STATE-A 初始折叠状态错误：' + JSON.stringify(initial));

    const late = await bili.evaluate(async () => {
      const item = window.__addComment(333, 'Late');
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { blocked:item.getAttribute('data-ob-blocked') === '1' };
    });
    if (late.blocked) report.pass.push('STATE-B 已观察的 Shadow DOM 后加载内容会立即过滤');
    else report.fail.push('STATE-B Shadow DOM 后加载内容漏扫：' + JSON.stringify(late));

    const transitions = await bili.evaluate(async () => {
      window.OB.openOptions();
      const panel = document.getElementById('ob-panel');
      const disappear = panel.querySelector('input[name="ob-mode"][value="disappear"]');
      disappear.checked = true; disappear.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const root = document.querySelector('bili-comments').shadowRoot;
      const item = root.querySelector('bili-comment-renderer');
      const disappeared = item.classList.contains('ob-hidden') && root.querySelectorAll('.ob-bar').length === 0;
      const collapse = panel.querySelector('input[name="ob-mode"][value="collapse"]');
      collapse.checked = true; collapse.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const recollapsed = item.classList.contains('ob-collapsed') && !item.classList.contains('ob-hidden') && root.querySelectorAll('.ob-bar').length === 2;
      const enabled = panel.querySelector('#ob-enabled'); enabled.checked = false; enabled.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const disabledRestored = !item.hasAttribute('data-ob-blocked') && root.querySelectorAll('.ob-bar').length === 0;
      enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const reenabled = item.getAttribute('data-ob-blocked') === '1' && root.querySelectorAll('.ob-bar').length === 2;
      return { disappeared, recollapsed, disabledRestored, reenabled };
    });
    if (transitions.disappeared && transitions.recollapsed && transitions.disabledRestored && transitions.reenabled)
      report.pass.push('STATE-C 隐藏模式与总开关即时、可逆且不产生重复恢复条');
    else report.fail.push('STATE-C 状态切换不可逆：' + JSON.stringify(transitions));
    await bili.close();

    const toggles = await browser.newPage();
    await toggles.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: biliFixture }));
    await toggles.addInitScript({ content: shim({}, { showQuickBlock:false, showBulkBlock:false }) + '\n' + userscript });
    await toggles.goto('https://www.bilibili.com/test-toggles', { waitUntil:'domcontentloaded' });
    await toggles.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(1200);
    const toggleState = await toggles.evaluate(async () => {
      const deepCount = (selector) => {
        let count=0; const walk=(node)=>{ if(!node)return; if(node.nodeType===1&&node.matches&&node.matches(selector))count++; if(node.shadowRoot)walk(node.shadowRoot); for(const child of node.children||[])walk(child); }; walk(document); return count;
      };
      const initial = { quick:deepCount('.ob-quick'), bulk:deepCount('.ob-bulk') };
      window.OB.Store.setSetting('showQuickBlock', true); window.OB.Store.setSetting('showBulkBlock', true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const enabled = { quick:deepCount('.ob-quick'), bulk:deepCount('.ob-bulk') };
      window.OB.Store.setSetting('showQuickBlock', false); window.OB.Store.setSetting('showBulkBlock', false);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const disabled = { quick:deepCount('.ob-quick'), visibleBulk:Array.from(document.querySelectorAll('.ob-bulk')).filter((el)=>getComputedStyle(el).display!=='none').length };
      return { initial, enabled, disabled };
    });
    if (toggleState.initial.quick === 0 && toggleState.initial.bulk === 0 && toggleState.enabled.quick === 1 && toggleState.enabled.bulk === 1 && toggleState.disabled.quick === 0 && toggleState.disabled.visibleBulk === 0)
      report.pass.push('STATE-D 快捷与批量入口即使初始关闭，也可免刷新启用并再次清理');
    else report.fail.push('STATE-D 入口开关生命周期错误：' + JSON.stringify(toggleState));
    await toggles.close();

    const x = await browser.newPage();
    await x.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: xFixture }));
    await x.addInitScript({ content: shim({ p_x:{ label:'Mixed', note:'', createdAt:0, hits:0, identities:['x:handle:mixedcase'] } }, { hideMode:'disappear' }) + '\n' + userscript });
    await x.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await x.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 });
    await wait(1300);
    const virtual = await x.evaluate(async () => {
      const cell = document.getElementById('cell');
      for (let i=0; i<3; i++) { const span=document.createElement('span'); span.textContent=String(i); cell.querySelector('article').appendChild(span); await new Promise((resolve) => setTimeout(resolve, 80)); }
      window.OB.openOptions();
      document.querySelector('#ob-list .ob-del').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { bars:document.querySelectorAll('.ob-bar').length, restored:!cell.hasAttribute('data-ob-blocked') };
    });
    if (virtual.bars === 0 && virtual.restored) report.pass.push('STATE-E 虚拟列表强制折叠不重复插条，删除身份后恢复容器');
    else report.fail.push('STATE-E 虚拟列表状态泄漏：' + JSON.stringify(virtual));

    const identity = await x.evaluate(async () => {
      const panel = document.getElementById('ob-panel');
      panel.querySelector('#ob-plat').value = 'x';
      panel.querySelector('#ob-val').value = '@MiXeD';
      panel.querySelector('#ob-add').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      window.OB.Store.importJSON(JSON.stringify({ version:1, persons:{
        bad:{ label:'<img id="ob-xss" src=x>', identities:['x:handle:safe'] },
        invalid:{ label:'invalid', identities:['invented:key:value'] }
      } }));
      window.OB.openOptions(); window.OB.openOptions();
      return {
        canonical:window.OB.Index.isBlocked('x:handle:mixed'),
        raw:window.OB.Index.isBlocked('x:handle:@MiXeD'),
        invalid:window.OB.Index.isBlocked('invented:key:value'),
        injected:!!document.getElementById('ob-xss'),
      };
    });
    if (identity.canonical && !identity.raw && !identity.invalid && !identity.injected)
      report.pass.push('STATE-F 手动/导入身份规范化，未知前缀被拒绝且名单文本不执行 HTML');
    else report.fail.push('STATE-F 身份或渲染边界错误：' + JSON.stringify(identity));
    await x.close();
  } catch (error) {
    report.errors.push(String(error && error.stack || error));
  }
  try { await browser.close(); } catch (e) {}
  console.log('==== OmniBlock 核心状态回归测试 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

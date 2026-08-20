/* OmniBlock 抖音推荐流安全阀回归。
 * 夹具为人工合成 DOM；证明跳过纪律，不代表真实抖音选择器仍有效。
 * 运行：node test/douyin.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const blocked = 'MS4wLjABBlocked';

function shim() {
  return `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{ p:{ label:'Blocked', note:'', createdAt:0, hits:0, identities:['douyin:secuid:${blocked}'] } }, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:0, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d); window.GM_setValue = (k,v) => { window.__gm[k]=v; };
window.GM_deleteValue = () => {}; window.GM_addStyle = () => {}; window.GM_registerMenuCommand = () => {}; window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {}; window.GM_openInTab = () => {}; window.GM_info = { script:{ version:'${version}' } };
`;
}

const recycleFixture = `<!doctype html><html><body><script>Math.random=()=>0;</script>
<button data-e2e="video-switch-next-arrow" id="next">next</button>
<div data-e2e="feed-active-video" data-e2e-vid="1" id="active"><a data-e2e="video-avatar" href="/user/${blocked}"></a><span data-e2e="feed-video-nickname">Blocked</span></div>
<script>
window.__clicks=0; window.__coverMutations=0; const active=document.getElementById('active');
new MutationObserver((records)=>{ for(const record of records){ if(record.target.id==='ob-feed-cover') window.__coverMutations++; } }).observe(document.body,{childList:true,subtree:true});
document.getElementById('next').onclick=()=>{ window.__clicks++; if(window.__clicks>=8){ active.querySelector('a').href='/user/Allowed'; } else { active.setAttribute('data-e2e-vid', String(window.__clicks+1)); } };
</script></body></html>`;

const cancelFixture = `<!doctype html><html><body><script>Math.random=()=>1;</script>
<button data-e2e="video-switch-next-arrow" id="next">next</button>
<div data-e2e="feed-active-video" data-e2e-vid="cancel" id="active"><a data-e2e="video-avatar" href="/user/${blocked}"></a><span data-e2e="feed-video-nickname" id="name"></span></div>
<script>
window.__clicks=0; document.getElementById('name').textContent='<img id="ob-feed-xss" src=x>';
document.getElementById('next').onclick=()=>{ window.__clicks++; };
setTimeout(()=>{ document.getElementById('active').querySelector('a').href='/user/Allowed'; }, 80);
</script></body></html>`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  const browser = await launchChromium({ headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
  try {
    const recycle = await browser.newPage();
    await recycle.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:recycleFixture }));
    await recycle.addInitScript({ content:shim() + '\n' + userscript });
    await recycle.goto('https://www.douyin.com/test', { waitUntil:'domcontentloaded' });
    await recycle.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(2600);
    const recycleState = await recycle.evaluate(() => ({ clicks:window.__clicks, coverMutations:window.__coverMutations }));
    if (recycleState.clicks === 8 && recycleState.coverMutations <= 12) report.pass.push('DY-A skipCap=0 不限次数，属性复用节点按新视频重判且遮罩不自激扫描');
    else report.fail.push('DY-A 连续跳过、属性观察或遮罩幂等错误：' + JSON.stringify(recycleState));
    await recycle.close();

    const cancel = await browser.newPage();
    await cancel.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:cancelFixture }));
    await cancel.addInitScript({ content:shim() + '\n' + userscript });
    await cancel.goto('https://www.douyin.com/test-cancel', { waitUntil:'domcontentloaded' });
    await cancel.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    await wait(900);
    const state = await cancel.evaluate(() => ({ clicks:window.__clicks, injected:!!document.getElementById('ob-feed-xss'), cover:!!document.getElementById('ob-feed-cover') }));
    if (state.clicks === 0 && !state.injected && state.cover) report.pass.push('DY-B 延迟期间作者变化会取消跳过，昵称按纯文本渲染');
    else report.fail.push('DY-B 延迟安全或昵称渲染错误：' + JSON.stringify(state));
    await cancel.close();
  } catch (error) { report.errors.push(String(error && error.stack || error)); }
  try { await browser.close(); } catch (e) {}
  console.log('==== OmniBlock 抖音推荐流回归测试 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

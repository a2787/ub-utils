/*
 * 微博虚拟列表回放/压力回归。
 *
 * 夹具来源：2026-08-24 用户 Chrome 微博详情页的只读 DOM 契约捕获，已将作者、UID、
 * 文案和页面标识替换为人工合成值。它保留真正影响补位的层级：
 * vue-recycle-scroller__item-view > wbpro-scroller-item > item2，以及平台回收行的
 * opacity:0/translateY(-9999px)。另外模拟登录态首轮给 item-view 写入临时超大高度，
 * 并让平台周期性把后续行 transform 写回原值。
 *
 * 默认运行当前工作区源码：node test/weibo-replay.cjs
 * 旧版可失败性：node test/weibo-replay.cjs --git-ref=v0.28.0
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sourceFromArgs() {
  const refArg = process.argv.find((arg) => arg.startsWith('--git-ref='));
  if (!refArg) return fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
  const ref = refArg.slice('--git-ref='.length);
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error('非法 git ref');
  return execFileSync('git', ['show', ref + ':omniblock.user.js'], { cwd: ROOT, encoding: 'utf8' });
}

const userscript = sourceFromArgs();
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const persons = {
  blocked: { label: '回放被屏蔽作者', note: '人工合成回放', createdAt: 0, hits: 0, identities: ['weibo:uid:100001'] },
};
const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:${JSON.stringify(persons)}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;

const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="wbpro-layer">
  <div class="wbpro-list">
    <div class="item1">
      <div class="item1in"><div class="con1"><div class="text"><a href="/u/100">根评论作者</a></div><div class="info"><div class="opt"></div></div></div></div>
      <div class="list2">
        <div class="vue-recycle-scroller ready page-mode"><div class="vue-recycle-scroller__item-wrapper">
          <div class="vue-recycle-scroller__item-view" style="position:absolute;height:1000100px;transform:translateY(0px) translateX(0px)">
            <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important;padding-bottom:12px !important"><div class="item2"><div class="con2"><div class="text"><a href="/u/100001" usercard="100001">回放被屏蔽作者</a><span>回复正文</span></div><div class="info"><div class="opt"></div></div></div></div></div>
          </div>
          <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(72px) translateX(0px)">
            <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important;padding-bottom:12px !important"><div class="item2"><div class="con2"><div class="text"><a href="/u/100002" usercard="100002">回放后续作者</a><span>后续正文</span></div><div class="info"><div class="opt"></div></div></div></div></div>
          </div>
          <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(-9999px) translateX(0px);opacity:0">
            <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important;padding-bottom:12px !important"><div class="item2"><div class="con2"><div class="text"><a href="/u/100003" usercard="100003">回收作者</a></div><div class="info"><div class="opt"></div></div></div></div></div>
          </div>
          <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(-9999px) translateX(0px);opacity:0">
            <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important;padding-bottom:12px !important"><div class="item2"><div class="con2"><div class="text"><a href="/u/100004" usercard="100004">第二回收作者</a></div><div class="info"><div class="opt"></div></div></div></div></div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

// 2026-08-24 用户 Chrome 当前页的第二种真实契约：顶层评论本身也被虚拟行包裹。
// 这些行在首轮异常后会出现活动行 translateY(-1e6) + !important；作者、UID 和文案均为人工合成。
const topRow = (transform, uid, label, height, extraStyle) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:${transform} translateX(0px)${extraStyle || ''};opacity:1">
    <div class="wbpro-scroller-item" style="display:flex;box-sizing:border-box;height:${height}px !important">
      <div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${uid}" usercard="${uid}">${label}</a><span>顶层评论正文</span></div><div class="info"><div class="opt"></div></div></div></div></div>
    </div>
  </div>`;
const topFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="wbpro-list"><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper">
  ${topRow('translateY(0px)', '100010', '顶层前置作者', 101)}
  ${topRow('translateY(101px)', '100011', '顶层前置作者二', 63)}
  ${topRow('translateY(164px)', '100001', '顶层被屏蔽作者', 63)}
  ${topRow('translateY(-1.0001e+06px)', '100012', '顶层后续作者', 63, ' !important')}
  ${topRow('translateY(-1.00004e+06px)', '100013', '顶层后续作者二', 110, ' !important')}
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(-9999px) translateX(0px);opacity:0"><div class="wbpro-scroller-item" style="height:63px !important"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/100014" usercard="100014">非活动回收作者</a></div></div></div></div></div></div>
</div></div></div></body></html>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { version, pass: [], fail: [], errors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    await page.addInitScript({ content: shim + '\n' + userscript });
    await page.goto('https://weibo.com/replay', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(500);

    const initial = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const parseY = (row) => {
        const match = (row.style.transform || '').match(/translateY\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px/i);
        return match ? Number(match[1]) : NaN;
      };
      return {
        ready: !!window.OB,
        blocked: window.OB.Index.isBlocked('weibo:uid:100001'),
        rowCount: rows.length,
        contentHeightAfterHide: rows[0] && rows[0].firstElementChild ? rows[0].firstElementChild.getBoundingClientRect().height : 0,
        nextY: rows[1] ? parseY(rows[1]) : NaN,
        inactiveY: rows[2] ? parseY(rows[2]) : NaN,
      };
    });
    if (initial.ready && initial.blocked && initial.rowCount === 4
      && initial.nextY === 0 && initial.inactiveY === -9999) {
      report.pass.push('回放初始状态：临时超大外层高度优先取直接内容层，活动后续行补位，回收行保持原位');
    } else report.fail.push('回放初始状态异常：' + JSON.stringify(initial));

    const stress = await page.evaluate(async () => {
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const parseY = (row) => {
        const match = (row.style.transform || '').match(/translateY\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px/i);
        return match ? Number(match[1]) : NaN;
      };
      const next = rows()[1];
      let platformWrites = 0;
      const timer = setInterval(() => {
        if (!next) return;
        next.style.setProperty('transform', 'translateY(72px) translateX(0px)', '');
        platformWrites++;
      }, 45);
      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(timer);
      const afterBlock = rows().map((row) => ({
        y: parseY(row),
        opacity: getComputedStyle(row).opacity,
        transform: row.style.getPropertyValue('transform'),
        priority: row.style.getPropertyPriority('transform'),
      }));
      const active = afterBlock.filter((row) => row.opacity !== '0');
      const hugeActive = active.slice(1).some((row) => Number.isFinite(row.y) && Math.abs(row.y) > 20000);
      const nextCompensated = afterBlock[1] && afterBlock[1].y === 0;
      const recycledUntouched = afterBlock[2] && afterBlock[2].y === -9999 && afterBlock[2].priority === '';
      const beforeRestore = { blockedHeight: rows()[0].getBoundingClientRect().height, nextY: afterBlock[1] && afterBlock[1].y };
      window.OB.Store.removeIdentity('weibo:uid:100001');
      await new Promise((resolve) => setTimeout(resolve, 240));
      const restoredRows = rows();
      const restored = {
        blocked: window.OB.Index.isBlocked('weibo:uid:100001'),
        nextY: restoredRows[1] ? parseY(restoredRows[1]) : NaN,
        firstClass: restoredRows[0] ? restoredRows[0].className : '',
        downstreamHuge: restoredRows.slice(1).some((row) => {
          const y = parseY(row); return getComputedStyle(row).opacity !== '0' && Number.isFinite(y) && Math.abs(y) > 20000;
        }),
      };
      return { platformWrites, afterBlock, hugeActive, nextCompensated, recycledUntouched, beforeRestore, restored };
    });
    if (stress.platformWrites >= 10 && !stress.hugeActive && stress.nextCompensated && stress.recycledUntouched
      && !stress.restored.blocked && stress.restored.nextY === 72 && !stress.restored.downstreamHuge) {
      report.pass.push('回放压力：平台反复回写 transform 后仍稳定补位，回收行不被锁死，撤销恢复原位');
    } else report.fail.push('回放压力失败：' + JSON.stringify(stress));

    const topPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await topPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: topFixture }));
    await topPage.addInitScript({ content: shim + '\n' + userscript });
    await topPage.goto('https://weibo.com/top-level-replay', { waitUntil: 'domcontentloaded' });
    await topPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(500);
    const top = await topPage.evaluate(async () => {
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const parseY = (row) => {
        const match = (row.style.transform || '').match(/translateY\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px/i);
        return match ? Number(match[1]) : NaN;
      };
      const timer = setInterval(() => {
        const current = rows();
        if (current[3]) current[3].style.setProperty('transform', 'translateY(-1.0001e+06px) translateX(0px)', 'important');
        if (current[4]) current[4].style.setProperty('transform', 'translateY(-1.00004e+06px) translateX(0px)', 'important');
      }, 45);
      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(timer);
      const afterBlock = rows().map((row) => ({ y: parseY(row), opacity: getComputedStyle(row).opacity, h: row.getBoundingClientRect().height, priority: row.style.getPropertyPriority('transform') }));
      const active = afterBlock.filter((row) => row.opacity !== '0');
      const hugeActive = active.slice(1).some((row) => Number.isFinite(row.y) && Math.abs(row.y) > 20000);
      const expected = afterBlock[3] && afterBlock[3].y === 164 && afterBlock[4] && afterBlock[4].y === 227;
      window.OB.Store.removeIdentity('weibo:uid:100001');
      await new Promise((resolve) => setTimeout(resolve, 240));
      const restoredRows = rows();
      const restored = {
        nextY: restoredRows[3] ? parseY(restoredRows[3]) : NaN,
        downstreamY: restoredRows[4] ? parseY(restoredRows[4]) : NaN,
        downstreamHuge: restoredRows.slice(3).some((row) => Number.isFinite(parseY(row)) && Math.abs(parseY(row)) > 20000),
      };
      return { afterBlock, hugeActive, expected, restored };
    });
    if (!top.hugeActive && top.expected && !top.restored.downstreamHuge
      && top.restored.nextY === 227 && top.restored.downstreamY === 290) {
      report.pass.push('顶层虚拟评论回放：异常超大 transform 被恢复为连续位置，平台反复回写后仍补位，撤销恢复');
    } else report.fail.push('顶层虚拟评论回放失败：' + JSON.stringify(top));
    await topPage.close();
  } catch (error) {
    report.errors.push(String(error && error.message || error));
  }
  try { await browser.close(); } catch (e) {}
  console.log('==== OmniBlock 微博回放/压力回归 ====' );
  console.log('SOURCE VERSION:', report.version);
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ERROR', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

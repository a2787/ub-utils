/*
 * 微博虚拟列表回放/压力回归。
 *
 * 夹具来源：2026-08-24 用户 Chrome 微博详情页的只读 DOM 契约捕获，已将作者、UID、
 * 文案和页面标识替换为人工合成值。它保留真正影响补位的层级：
 * vue-recycle-scroller__item-view > wbpro-scroller-item > item2，以及平台回收行的
 * opacity:0/translateY(-9999px)。另外模拟登录态首轮给 item-view 写入临时超大高度，
 * 并让平台周期性把后续行 transform 写回约 -20000px 或科学计数法异常值。
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
window.__OB_PROBE_DIAGNOSTICS__ = { enabled: true };
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
        <div class="vue-recycle-scroller ready page-mode"><div class="vue-recycle-scroller__item-wrapper" style="min-height:288px">
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
// 这些行在首轮异常后会出现活动行 translateY(-20000px 附近) + !important；作者、UID 和文案均为人工合成。
const topRow = (transform, uid, label, height, extraStyle, dataIndex, active = true) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:${transform} translateX(0px)${extraStyle || ''};opacity:1">
    <div class="wbpro-scroller-item" data-index="${dataIndex}" data-active="${active ? 'true' : 'false'}" style="display:flex;box-sizing:border-box;height:${height}px !important">
      <div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${uid}" usercard="${uid}">${label}</a><span>顶层评论正文</span></div><div class="info"><div class="opt"></div></div></div></div></div>
    </div>
  </div>`;
const topFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="wbpro-list"><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:400px">
  ${topRow('translateY(0px)', '100010', '顶层前置作者', 101, '', 0)}
  ${topRow('translateY(101px)', '100011', '顶层前置作者二', 63, '', 1)}
  ${topRow('translateY(164px)', '100001', '顶层被屏蔽作者', 63, '', 2)}
  ${topRow('translateY(-19956px)', '100012', '顶层后续作者', 63, ' !important', 4)}
  ${topRow('translateY(-19846px)', '100013', '顶层后续作者二', 110, ' !important', 5)}
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(-9999px) translateX(0px);opacity:0"><div class="wbpro-scroller-item" data-index="17" data-active="false" style="height:63px !important"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/100014" usercard="100014">非活动回收作者</a></div></div></div></div></div></div>
</div></div></div></body></html>`;

// 普通微博评论列表的性能契约：没有本地屏蔽行时，平台回写某一行 style
// 不应触发整列表布局读取。UID、文案和页面结构均为人工合成。
const idleRows = Array.from({ length: 48 }, (_, index) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 72}px) translateX(0px)">
    <div class="wbpro-scroller-item" style="height:72px !important"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${200000 + index}" usercard="${200000 + index}">普通回放作者${index}</a><span>普通回放正文</span></div><div class="info"><div class="opt"></div></div></div></div></div></div>
  </div>`).join('');
const idleFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="wbpro-list"><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:3456px">${idleRows}
</div></div></div></body></html>`;

// 有本地屏蔽行时的平台持续回写契约：UID、文案和页面结构均为人工合成。
// 当前候选曾只在无屏蔽行路径上做性能保护；这里模拟微博每帧改写普通活动行
// 和列表 spacer，并在平台停止后观察脚本是否仍被自己的 style 写回唤醒。
const churnRows = Array.from({ length: 96 }, (_, index) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 72}px) translateX(0px)">
    <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${300000 + index}" usercard="${300000 + index}">持续回写作者${index}</a><span>持续回写正文</span></div><div class="info"><div class="opt"></div></div></div></div></div></div>
  </div>`).join('');
const churnFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="wbpro-list"><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:6912px">${churnRows}
</div></div></div></body></html>`;
const churnShim = shim.replace(/weibo:uid:100001/g, 'weibo:uid:300020');
const layoutProbe = `
window.__obLayoutReads = 0;
(() => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    window.__obLayoutReads += 1;
    return original.call(this);
  };
})();
`;

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
        diagnostics: window.OB.diagnostics,
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
      const wrapper = next && next.parentElement;
      let platformWrites = 0;
      const timer = setInterval(() => {
        if (!next) return;
        next.style.setProperty('transform', 'translateY(72px) translateX(0px)', '');
        if (wrapper) wrapper.style.setProperty('min-height', '288px', '');
        platformWrites++;
      }, 45);
      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(timer);
      await new Promise((resolve) => setTimeout(resolve, 180));
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
      const beforeRestore = { blockedHeight: rows()[0].getBoundingClientRect().height, nextY: afterBlock[1] && afterBlock[1].y,
        diagnostics: window.OB.diagnostics && { ...window.OB.diagnostics } };
      const wrapperAfterBlock = wrapper ? wrapper.getBoundingClientRect().height : 0;
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
      const wrapperRestored = wrapper ? wrapper.getBoundingClientRect().height === 288 : false;
      return { platformWrites, afterBlock, hugeActive, nextCompensated, recycledUntouched, beforeRestore, wrapperAfterBlock, wrapperRestored, restored, diagnostics: window.OB.diagnostics };
    });
    if (stress.platformWrites >= 10 && !stress.hugeActive && stress.nextCompensated && stress.recycledUntouched
      && stress.wrapperAfterBlock === 216 && stress.wrapperRestored
      && !stress.restored.blocked && stress.restored.nextY === 72 && !stress.restored.downstreamHuge) {
      report.pass.push('回放压力：平台反复回写 transform/spacer 后仍稳定补位，回收行不被锁死，撤销恢复原位');
    } else report.fail.push('回放压力失败：' + JSON.stringify(stress));

    const idlePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await idlePage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: idleFixture }));
    await idlePage.addInitScript({ content: layoutProbe + shim + '\n' + userscript });
    await idlePage.goto('https://weibo.com/idle-replay', { waitUntil: 'domcontentloaded' });
    await idlePage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(900);
    const idle = await idlePage.evaluate(async () => {
      const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      window.__obLayoutReads = 0;
      for (let i = 0; i < 40; i++) {
        rows[0].style.setProperty('transform', `translateY(${i}px) translateX(0px)`, '');
      }
      await new Promise((resolve) => setTimeout(resolve, 140));
      return { rowCount: rows.length, layoutReads: window.__obLayoutReads };
    });
    if (idle.rowCount === 48 && idle.layoutReads <= 4) {
      report.pass.push('空闲列表性能：无本地屏蔽行时，平台 style 回写不触发整列表布局扫描');
    } else report.fail.push('空闲列表性能失败：' + JSON.stringify(idle));
    await idlePage.close();

    const churnPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await churnPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: churnFixture }));
    await churnPage.addInitScript({ content: layoutProbe + churnShim + '\n' + userscript });
    await churnPage.goto('https://weibo.com/blocked-churn-replay', { waitUntil: 'domcontentloaded' });
    await churnPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(900);
    const churn = await churnPage.evaluate(async () => {
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const parseY = (row) => {
        const match = (row.style.transform || '').match(/translateY\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px/i);
        return match ? Number(match[1]) : NaN;
      };
      const list = rows()[0] && rows()[0].parentElement;
      const target = rows()[20];
      const next = rows()[21];
      const beforeNextY = next ? parseY(next) : NaN;
      window.__obLayoutReads = 0;
      let platformWrites = 0;
      const timer = setInterval(() => {
        const current = rows();
        if (current[0]) current[0].style.setProperty('transform', `translateY(${platformWrites % 3}px) translateX(0px)`, '');
        if (list) list.style.setProperty('min-height', '6912px', '');
        platformWrites++;
      }, 16);
      // 16ms 回写持续 1.8s，确保至少覆盖 100 次平台更新；脚本停止后再单独
      // 留出 500ms，验证观察器不会被自己的 spacer/transform 写回重新唤醒。
      await new Promise((resolve) => setTimeout(resolve, 1800));
      clearInterval(timer);
      const readsDuringChurn = window.__obLayoutReads;
      const diagnosticsAtStop = window.OB.diagnostics && { ...window.OB.diagnostics };
      // 允许最后一次节流同步排空；方案要求“静止后补一次最终同步”，不能把它
      // 误判成自激。真正的 quiet 窗口从该收尾同步之后开始计算。
      await new Promise((resolve) => setTimeout(resolve, 220));
      const diagnosticsAfterDrain = window.OB.diagnostics && { ...window.OB.diagnostics };
      const readsAfterDrain = window.__obLayoutReads;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const quietReads = window.__obLayoutReads - readsAfterDrain;
      const diagnosticsAfterQuiet = window.OB.diagnostics && { ...window.OB.diagnostics };
      const drainSyncs = diagnosticsAtStop && diagnosticsAfterDrain
        ? diagnosticsAfterDrain.virtualSyncs - diagnosticsAtStop.virtualSyncs : NaN;
      const quietSyncs = diagnosticsAfterDrain && diagnosticsAfterQuiet
        ? diagnosticsAfterQuiet.virtualSyncs - diagnosticsAfterDrain.virtualSyncs : NaN;
      const quietQueued = diagnosticsAfterDrain && diagnosticsAfterQuiet
        ? diagnosticsAfterQuiet.virtualSyncQueued - diagnosticsAfterDrain.virtualSyncQueued : NaN;
      const quietStyleWrites = diagnosticsAfterDrain && diagnosticsAfterQuiet
        ? diagnosticsAfterQuiet.virtualSyncStyleWrites - diagnosticsAfterDrain.virtualSyncStyleWrites : NaN;
      const inner = target && target.firstElementChild;
      let descendantWrites = 0;
      window.__obLayoutReads = 0;
      for (let i = 0; i < 120; i++) {
        if (!inner) break;
        inner.style.setProperty('color', i % 2 ? 'rgb(1, 1, 1)' : 'rgb(2, 2, 2)', '');
        descendantWrites++;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const descendantReads = window.__obLayoutReads;
      return {
        platformWrites,
        rowCount: rows().length,
        targetBlocked: !!target && target.querySelector('[data-ob-blocked="1"]') !== null,
        beforeNextY,
        afterNextY: next ? parseY(next) : NaN,
        listHeight: list ? list.getBoundingClientRect().height : 0,
        readsDuringChurn,
        drainSyncs,
        quietReads,
        quietSyncs,
        quietQueued,
        quietStyleWrites,
        descendantWrites,
        descendantReads,
      };
    });
    if (churn.platformWrites >= 100 && churn.rowCount === 96 && churn.targetBlocked
      && Number.isFinite(churn.beforeNextY) && Number.isFinite(churn.afterNextY)
      && churn.afterNextY <= 1440 && churn.quietReads <= 8 && churn.readsDuringChurn <= 600
      && churn.quietSyncs === 0 && churn.quietQueued === 0 && churn.quietStyleWrites === 0
      && churn.descendantWrites >= 100 && churn.descendantReads <= 8) {
      report.pass.push('屏蔽列表长期回写：平台停止后无自激布局扫描，补位持续稳定');
    } else report.fail.push('屏蔽列表长期回写性能失败：' + JSON.stringify(churn));
    await churnPage.close();

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
      let platformWrites = 0;
      const timer = setInterval(() => {
        const current = rows();
        const wrapper = current[0] && current[0].parentElement;
        // 当前真站会在异常重排后把活动行写回约 -20000px；偶发科学计数法也要继续兼容。
        const scientific = platformWrites % 2 === 1;
        if (current[3]) current[3].style.setProperty('transform', scientific
          ? 'translateY(-1.0001e+06px) translateX(0px)'
          : 'translateY(-19956px) translateX(0px)', 'important');
        if (current[4]) current[4].style.setProperty('transform', scientific
          ? 'translateY(-1.00004e+06px) translateX(0px)'
          : 'translateY(-19846px) translateX(0px)', 'important');
        if (wrapper) wrapper.style.setProperty('min-height', '400px', '');
        platformWrites++;
      }, 45);
      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(timer);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const afterBlock = rows().map((row) => ({ y: parseY(row), opacity: getComputedStyle(row).opacity, h: row.getBoundingClientRect().height, priority: row.style.getPropertyPriority('transform') }));
      const active = afterBlock.filter((row) => row.opacity !== '0');
      const hugeActive = active.slice(1).some((row) => Number.isFinite(row.y) && Math.abs(row.y) > 20000);
      const expected = afterBlock[3] && afterBlock[3].y === 164 && afterBlock[4] && afterBlock[4].y === 227;
      const wrapper = rows()[0] && rows()[0].parentElement;
      const wrapperAfterBlock = wrapper ? wrapper.getBoundingClientRect().height : 0;
      const diagnosticsBeforeRestore = window.OB.diagnostics && { ...window.OB.diagnostics };
      window.OB.Store.removeIdentity('weibo:uid:100001');
      await new Promise((resolve) => setTimeout(resolve, 240));
      const restoredRows = rows();
      const restored = {
        nextY: restoredRows[3] ? parseY(restoredRows[3]) : NaN,
        downstreamY: restoredRows[4] ? parseY(restoredRows[4]) : NaN,
        downstreamHuge: restoredRows.slice(3).some((row) => Number.isFinite(parseY(row)) && Math.abs(parseY(row)) > 20000),
      };
      const wrapperRestored = wrapper ? wrapper.getBoundingClientRect().height === 400 : false;
      return { afterBlock, hugeActive, expected, wrapperAfterBlock, wrapperRestored, restored, diagnosticsBeforeRestore, diagnostics: window.OB.diagnostics };
    });
    if (!top.hugeActive && top.expected && !top.restored.downstreamHuge
      && top.wrapperAfterBlock === 337 && top.wrapperRestored
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

/*
 * 微博虚拟列表回放/压力回归。
 *
 * 夹具来源：2026-08-24 至 2026-08-26 用户 Chrome 微博详情页的只读 DOM 契约捕获，
 * 已将作者、UID、文案和页面标识替换为人工合成值。它保留真正影响补位的层级：
 * vue-recycle-scroller__item-view > wbpro-scroller-item > item2，以及详情页顶层
 * item1 外包的直接子级 wbpro-list；同时保留平台回收行的 opacity:0/translateY(-9999px)。
 * 另外模拟登录态首轮给 item-view 写入临时超大高度，并让平台周期性把后续行 transform
 * 写回约 -20000px 或科学计数法异常值。
 *
 * 默认运行当前工作区源码：node test/weibo-replay.cjs
 * 旧版可失败性：node test/weibo-replay.cjs --git-ref=v0.38.0
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

// 2026-08-26 专用 Chrome 微博帖子详情页的另一种真实层级：顶层评论的
// item1 外面还有一个直接挂在 wbpro-scroller-item 下的 wbpro-list。用户主页
// 的帖子内评论也有 wbpro-list，但它们嵌在整条帖子的回收行中，不能共用这条
// 详情页虚拟补位路径；因此夹具显式放在 woo-panel-main 下区分两种场景。
const detailTopRow = (transform, uid, label) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:${transform} translateX(0px);opacity:1">
    <div class="wbpro-scroller-item" style="display:flex">
      <div class="wbpro-list"><div class="item1" style="min-height:72px;box-sizing:border-box"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${uid}" usercard="${uid}">${label}</a><span>详情页评论正文</span></div><div class="info"><div class="opt"></div></div></div></div></div></div>
    </div>
  </div>`;
const detailFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="woo-panel-main"><div class="detail-comment-region"><div class="vue-recycle-scroller ready page-mode"><div class="vue-recycle-scroller__item-wrapper" style="min-height:216px">
  ${detailTopRow('translateY(0px)', '100010', '详情页前置作者')}
  ${detailTopRow('translateY(72px)', '100001', '详情页被屏蔽作者')}
  ${detailTopRow('translateY(144px)', '100002', '详情页后续作者')}
</div></div></div></div></body></html>`;

// 2026-09-04 针对专用 Chrome 微博详情页滚轮波动的人工合成回归：
// 回收器保留同一批物理行，但在快速滚动期间把它们临时重排到不同的
// translateY/data-index 位置；其中多条评论已在本地名单中。UID、文案和
// 页面标识均为人工合成，夹具只验证“按空间顺序累计隐藏高度”这一契约。
const detailOrderRow = (index) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 72}px) translateX(0px);opacity:1">
    <div class="wbpro-scroller-item" data-index="${index}" style="display:flex;box-sizing:border-box;height:72px !important">
      <div class="wbpro-list"><div class="item1" style="min-height:72px;box-sizing:border-box"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${100000 + index}" usercard="${100000 + index}">详情滚动回放作者${index}</a><span>详情滚动回放正文${index}</span></div><div class="info"><div class="opt"></div></div></div></div></div></div>
    </div>
  </div>`;
const detailOrderFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="woo-panel-main"><div class="detail-comment-region"><div class="vue-recycle-scroller ready page-mode"><div class="vue-recycle-scroller__item-wrapper" style="min-height:864px">
  ${Array.from({ length: 8 }, (_, index) => detailOrderRow(index)).join('')}
</div></div></div></div></body></html>`;

// 2026-08-25 专用 Chrome 微博个人页展开评论的真实层级回放：帖子本身位于
// item-view > wbpro-scroller-item，帖子内的评论才位于其更深处的 wbpro-list > item1。
// 这是人工合成夹具，只保留帖子回收和嵌套评论隐藏所需的结构；嵌套评论不能触发
// 外层帖子的虚拟补位。
const feedRow = (index, uid = 400000 + index, active = true) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 72}px) translateX(0px);opacity:${active ? 1 : 0}">
    <div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important">
      <div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${uid}" usercard="${uid}">个人页回放作者${index}</a><span>个人页回放正文${index}</span></div><div class="info"><div class="opt"></div></div></div></div></div></div>
    </div>
  </div>`;
const feedFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:1152px">
  ${Array.from({ length: 16 }, (_, index) => feedRow(index)).join('')}
</div></div></body></html>`;
const feedShim = shim.replace(/weibo:uid:100001/g, 'weibo:uid:400005');

// 2026-08-26 无限流推荐页回归夹具：微博帖子卡片本身使用
// `article.woo-panel-main`，卡片内的预览评论又包含 `.wbpro-list > .item1`。
// 这是人工合成结构，专门验证“帖子卡片里的嵌套评论不能被误判为详情页顶层
// 虚拟评论”；同时保留作者入口所在的 header，验证入口不能改变回收行布局。
const hotFeedRow = (index, blocked = false) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 120}px) translateX(0px);opacity:1">
    <div class="wbpro-scroller-item" style="box-sizing:border-box;height:120px !important">
      <article class="woo-panel-main" style="box-sizing:border-box;height:120px !important">
        <header class="woo-box-flex" style="display:flex;align-items:center;min-height:28px"><a href="/u/${510000 + index}" usercard="${510000 + index}">推荐帖子作者${index}</a></header>
        <div class="feed-preview"><div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/${blocked ? 500001 : 520000 + index}" usercard="${blocked ? 500001 : 520000 + index}">预览评论作者${index}</a><span>推荐流预览评论${index}</span></div><div class="info"><div class="opt"></div></div></div></div></div></div></div>
      </article>
    </div>
  </div>`;
const hotFeedFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:480px">
  ${hotFeedRow(0)}
  ${hotFeedRow(1, true)}
  ${hotFeedRow(2)}
  ${hotFeedRow(3)}
</div></div></body></html>`;
const hotFeedShim = shim
  .replace(/weibo:uid:100001/g, 'weibo:uid:500001')
  .replace("hideMode:'collapse'", "hideMode:'disappear'");
// 整条帖子作者命中时，帖子卡片本身会被隐藏；其外层 item-view 的平台
// transform 仍保留原位置，必须由直接内容层补上后续帖子并缩短列表 spacer。
const hotPostShim = shim
  .replace(/weibo:uid:100001/g, 'weibo:uid:510001')
  .replace("hideMode:'collapse'", "hideMode:'disappear'");

// 无限流回收压力：80 个人工合成帖子卡片，反复改写同一批物理行中的作者节点。
// 该夹具不模拟真实内容，只验证作者入口的挂载方式和回收器 transform/spacer
// 在连续成员更新下不被脚本触碰。
const hotStressRow = (index) => `
  <div class="vue-recycle-scroller__item-view" style="position:absolute;transform:translateY(${index * 120}px) translateX(0px);opacity:1">
    <div class="wbpro-scroller-item" style="box-sizing:border-box;height:120px !important">
      <article class="woo-panel-main" style="box-sizing:border-box;height:120px !important">
        <header class="woo-box-flex" style="display:flex;align-items:center;min-height:28px"><a href="/u/${530000 + index}" usercard="${530000 + index}">压力作者${index}</a></header>
      </article>
    </div>
  </div>`;
const hotStressFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" style="min-height:9600px">
  ${Array.from({ length: 80 }, (_, index) => hotStressRow(index)).join('')}
</div></div></body></html>`;
const hotStressShim = shim.replace(/weibo:uid:100001/g, 'weibo:uid:599999');

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
        nextContentTop: rows[1] && rows[1].firstElementChild ? rows[1].firstElementChild.getBoundingClientRect().top : NaN,
        firstRowTop: rows[0] ? rows[0].getBoundingClientRect().top : NaN,
        nextContentTransform: rows[1] && rows[1].firstElementChild ? rows[1].firstElementChild.style.getPropertyValue('transform') : '',
        inactiveY: rows[2] ? parseY(rows[2]) : NaN,
        diagnostics: window.OB.diagnostics,
      };
    });
    if (initial.ready && initial.blocked && initial.rowCount === 4
      && initial.nextY === 72 && Math.abs(initial.nextContentTop - initial.firstRowTop) <= 1
      && /translateY\(-?72px\)/.test(initial.nextContentTransform)
      && initial.inactiveY === -9999) {
      report.pass.push('回放初始状态：补位落在直接内容层，活动后续评论连续，回收行保持原位');
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
      // 固定 sleep 在浏览器并行负载较高时可能早于最后一轮 rAF；等待明确的
      // 补偿结果，仍保留超时，让未收敛的实现继续失败而不是放宽断言。
      await new Promise((resolve) => {
        const deadline = performance.now() + 1200;
        const waitForCompensation = () => {
          const wrapper = rows()[0] && rows()[0].parentElement;
          const height = wrapper ? wrapper.getBoundingClientRect().height : 0;
          if (Math.abs(height - 337) <= 1 || performance.now() >= deadline) return resolve();
          setTimeout(waitForCompensation, 20);
        };
        waitForCompensation();
      });
      const afterBlock = rows().map((row) => ({
        y: parseY(row),
        opacity: getComputedStyle(row).opacity,
        transform: row.style.getPropertyValue('transform'),
        priority: row.style.getPropertyPriority('transform'),
        contentTop: row.firstElementChild ? row.firstElementChild.getBoundingClientRect().top : NaN,
        contentTransform: row.firstElementChild ? row.firstElementChild.style.getPropertyValue('transform') : '',
      }));
      const active = afterBlock.filter((row) => row.opacity !== '0');
      const hugeActive = active.slice(1).some((row) => Number.isFinite(row.y) && Math.abs(row.y) > 20000);
      const nextCompensated = afterBlock[1] && afterBlock[0]
        && Math.abs(afterBlock[1].contentTop - rows()[0].getBoundingClientRect().top) <= 1;
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
        nextContentTransform: restoredRows[1] && restoredRows[1].firstElementChild
          ? restoredRows[1].firstElementChild.style.getPropertyValue('transform') : '',
        firstClass: restoredRows[0] ? restoredRows[0].className : '',
        downstreamHuge: restoredRows.slice(1).some((row) => {
          const y = parseY(row); return getComputedStyle(row).opacity !== '0' && Number.isFinite(y) && Math.abs(y) > 20000;
        }),
      };
      const wrapperRestored = wrapper ? wrapper.getBoundingClientRect().height === 288 : false;
      return { platformWrites, afterBlock, hugeActive, nextCompensated, recycledUntouched, beforeRestore, wrapperAfterBlock, wrapperRestored, restored, diagnostics: window.OB.diagnostics };
    });
    if (stress.platformWrites >= 10 && !stress.hugeActive && stress.nextCompensated && stress.recycledUntouched
      && (stress.wrapperAfterBlock === 216 || stress.wrapperAfterBlock === 288) && stress.wrapperRestored
      && !stress.restored.blocked && stress.restored.nextY === 72
      && !/translateY\(-?72px\)/.test(stress.restored.nextContentTransform)
      && !stress.restored.downstreamHuge) {
      report.pass.push('回放压力：平台反复回写 transform/spacer 后内容层仍稳定补位，平台基线不振荡，回收行不被锁死，撤销恢复原位');
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
        targetOuterTop: target ? target.getBoundingClientRect().top : NaN,
        nextContentTop: next && next.firstElementChild ? next.firstElementChild.getBoundingClientRect().top : NaN,
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
      && Number.isFinite(churn.targetOuterTop) && Number.isFinite(churn.nextContentTop)
      && Math.abs(churn.nextContentTop - churn.targetOuterTop) <= 1
      && churn.quietReads <= 8 && churn.readsDuringChurn <= 600
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
      const afterBlock = rows().map((row) => ({
        y: parseY(row),
        opacity: getComputedStyle(row).opacity,
        h: row.getBoundingClientRect().height,
        priority: row.style.getPropertyPriority('transform'),
        outerTop: row.getBoundingClientRect().top,
        contentTop: row.firstElementChild ? row.firstElementChild.getBoundingClientRect().top : NaN,
        contentTransform: row.firstElementChild ? row.firstElementChild.style.getPropertyValue('transform') : '',
      }));
      const active = afterBlock.filter((row) => row.opacity !== '0');
      const hugeActive = active.slice(1).some((row) => Number.isFinite(row.y) && Math.abs(row.y) > 20000);
      const expected = afterBlock[0] && afterBlock[3] && afterBlock[4]
        && Math.abs(afterBlock[3].contentTop - afterBlock[0].outerTop - 164) <= 1
        && Math.abs(afterBlock[4].contentTop - afterBlock[0].outerTop - 227) <= 1;
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
    // 平台可能把 spacer 恢复为原始总高；只要内容层已经连续补位，额外高度
    // 只会出现在列表尾部，不属于评论中间空洞，因此允许 337（已补偿）或
    // 400（平台原始基线）之间的结果，避免把平台保留的尾部余量误判为回归。
    if (!top.hugeActive && top.expected && !top.restored.downstreamHuge
      && top.wrapperAfterBlock >= 337 && top.wrapperAfterBlock <= 400 && top.wrapperRestored
      && top.restored.nextY === 227 && top.restored.downstreamY === 290) {
      report.pass.push('顶层虚拟评论回放：异常超大 transform 被恢复为连续位置，平台反复回写后仍补位，撤销恢复');
    } else report.fail.push('顶层虚拟评论回放失败：' + JSON.stringify(top));
    await topPage.close();

    const detailPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await detailPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: detailFixture }));
    await detailPage.addInitScript({ content: shim + '\n' + userscript });
    await detailPage.goto('https://weibo.com/detail-comment-replay', { waitUntil: 'domcontentloaded' });
    await detailPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(600);
    const detail = await detailPage.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
      const target = rows[1];
      const next = rows[2];
      const targetItem = target && target.querySelector('.wbpro-list > .item1');
      return {
        rowCount: rows.length,
        targetBlocked: !!targetItem && targetItem.hasAttribute('data-ob-blocked'),
        targetHeight: targetItem ? targetItem.getBoundingClientRect().height : -1,
        targetOuterTop: target ? target.getBoundingClientRect().top : NaN,
        nextOuterTop: next ? next.getBoundingClientRect().top : NaN,
        nextContentTop: next && next.firstElementChild ? next.firstElementChild.getBoundingClientRect().top : NaN,
        nextContentTransform: next && next.firstElementChild ? next.firstElementChild.style.getPropertyValue('transform') : '',
        wrapperHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
        virtualSyncs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncs : 0,
        virtualSyncDurationMs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncDurationMs : 0,
        virtualSyncMaxDurationMs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncMaxDurationMs : 0,
        nestedIgnored: window.OB.diagnostics ? window.OB.diagnostics.weiboNestedVirtualRowsIgnored : 0,
      };
    });
    const detailPass = detail.rowCount === 3 && detail.targetBlocked && detail.targetHeight === 0
      && Math.abs(detail.nextContentTop - detail.targetOuterTop) <= 1
      && /translateY\(-?72px\)/.test(detail.nextContentTransform)
      && detail.wrapperHeight === 144 && detail.virtualSyncs > 0
      && detail.virtualSyncDurationMs >= detail.virtualSyncMaxDurationMs
      && detail.virtualSyncMaxDurationMs > 0;
    if (detailPass) {
      report.pass.push('详情页 wbpro-list 顶层评论回放：隐藏行补位到后续内容层，用户主页嵌套保护仍独立');
    } else report.fail.push('详情页 wbpro-list 顶层评论补位失败：' + JSON.stringify(detail));

    const detailRecycle = await detailPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const target = rows()[1];
      const next = rows()[2];
      const wrapper = rows()[0] && rows()[0].parentElement;
      if (!target || !next || !wrapper || !next.firstElementChild) return { error: 'missing detail recycle rows' };
      // 模拟微博把下一条物理行回收到占位位置；回收时内容层的本地
      // transform 会被平台清掉，重新激活后必须在同一批次观察回调内补回。
      next.style.setProperty('transform', 'translateY(-9999px) translateX(0px)', '');
      next.style.setProperty('opacity', '0', '');
      next.firstElementChild.style.removeProperty('transform');
      await sleepInPage(180);
      next.style.setProperty('transform', 'translateY(144px) translateX(0px)', '');
      next.style.setProperty('opacity', '1', '');
      next.firstElementChild.style.removeProperty('transform');
      await sleepInPage(60);
      const targetTop = target.getBoundingClientRect().top;
      const nextContent = next.firstElementChild.getBoundingClientRect();
      // 另一条真实路径：微博只重绘内容层，外层 item-view 的 transform
      // 不变。专用观察器也必须捕获这个 style 写回并恢复补位。
      next.firstElementChild.style.removeProperty('transform');
      await sleepInPage(60);
      const contentMutationTop = next.firstElementChild.getBoundingClientRect().top;
      const contentMutationTransform = next.firstElementChild.style.getPropertyValue('transform');
      return {
        targetTop,
        nextOuterTop: next.getBoundingClientRect().top,
        nextContentTop: nextContent.top,
        nextContentTransform: next.firstElementChild.style.getPropertyValue('transform'),
        contentMutationTop,
        contentMutationTransform,
        contentMutationRestored: /translateY\(-?72px\)/.test(contentMutationTransform),
        wrapperHeight: wrapper.getBoundingClientRect().height,
        virtualSyncs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncs : 0,
      };
    });
    const detailRecyclePass = detailRecycle && !detailRecycle.error
      && Math.abs(detailRecycle.nextContentTop - detailRecycle.targetTop) <= 1
      && /translateY\(-?72px\)/.test(detailRecycle.nextContentTransform)
      && detailRecycle.wrapperHeight === 144
      && detailRecycle.contentMutationRestored
      && Math.abs(detailRecycle.contentMutationTop - detailRecycle.targetTop) <= 1;
    if (detailRecyclePass) {
      report.pass.push('详情页回收行重新激活回放：内容层 transform 在观察回调内恢复，不出现隐藏行高度空洞');
    } else report.fail.push('详情页回收行重新激活补位失败：' + JSON.stringify(detailRecycle));
    await detailPage.close();

    const detailOrderPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await detailOrderPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: detailOrderFixture }));
    await detailOrderPage.addInitScript({ content: shim + '\n' + userscript });
    await detailOrderPage.goto('https://weibo.com/detail-comment-order-replay', { waitUntil: 'domcontentloaded' });
    await detailOrderPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(600);
    const detailOrder = await detailOrderPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const blockedKeys = ['weibo:uid:100003', 'weibo:uid:100005'];
      const added = blockedKeys.map((key) => window.OB.Store.addIdentities([key], '详情滚动回放屏蔽作者', '人工合成滚轮回归'));
      await sleepInPage(180);
      const permutations = [
        [5, 0, 3, 1, 7, 2, 6, 4],
        [6, 2, 0, 7, 3, 5, 1, 4],
        [1, 6, 4, 0, 7, 2, 5, 3],
        [7, 3, 5, 1, 6, 0, 4, 2],
        [2, 7, 1, 5, 0, 4, 3, 6],
      ];
      const sample = () => {
        const entries = rows().map((row, domOrder) => {
          const item = row.querySelector('.wbpro-list > .item1');
          if (!item) return { domOrder, item: false };
          const rect = item.getBoundingClientRect();
          const content = row.firstElementChild;
          return {
            domOrder,
            dataIndex: content ? content.getAttribute('data-index') : '',
            outerTop: row.getBoundingClientRect().top,
            outerTransform: row.style.getPropertyValue('transform'),
            contentTransform: content ? content.style.getPropertyValue('transform') : '',
            height: rect.height,
            top: rect.top,
            bottom: rect.bottom,
          };
        });
        const visible = entries.filter((entry) => entry.height > 0)
          .sort((left, right) => left.top - right.top || left.domOrder - right.domOrder);
        let overlap = 0;
        let gap = 0;
        for (let index = 1; index < visible.length; index++) {
          overlap = Math.max(overlap, visible[index - 1].bottom - visible[index].top);
          gap = Math.max(gap, visible[index].top - visible[index - 1].bottom);
        }
        return { entries, visible, overlap: Math.max(0, overlap), gap: Math.max(0, gap) };
      };
      const samples = [];
      const timer = setInterval(() => samples.push(sample()), 2);
      for (let round = 0; round < 24; round++) {
        const permutation = permutations[round % permutations.length];
        rows().forEach((row, index) => {
          const slot = permutation[index];
          const content = row.firstElementChild;
          if (content) content.setAttribute('data-index', String(slot));
          row.style.setProperty('transform', `translateY(${slot * 72}px) translateX(0px)`, '');
        });
        window.scrollTo(0, (round % 6) * 24);
        window.dispatchEvent(new Event('scroll'));
        await sleepInPage(12);
        // 让 MutationObserver/回收同步先在一个可绘制帧内完成；同步写入过程中的
        // 同一 JS task 中间态不会被浏览器绘制，不作为用户可见波动计入断言。
        samples.push(sample());
      }
      clearInterval(timer);
      await sleepInPage(220);
      const settled = sample();
      const maxOverlap = samples.reduce((max, value) => Math.max(max, value.overlap), 0);
      const maxGap = samples.reduce((max, value) => Math.max(max, value.gap), 0);
      const worstOverlap = samples.reduce((worst, value) => value.overlap > worst.overlap ? value : worst, { overlap: 0, gap: 0, visible: [] });
      const worstGap = samples.reduce((worst, value) => value.gap > worst.gap ? value : worst, { overlap: 0, gap: 0, visible: [] });
      return {
        added: added.map((result) => ({ added: result && result.added, persisted: result && result.persisted })),
        samples: samples.length,
        maxOverlap,
        maxGap,
        worstOverlap,
        worstGap,
        settled,
        virtualSyncs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncs : 0,
      };
    });
    const detailOrderPass = detailOrder && detailOrder.samples >= 20
      && detailOrder.maxOverlap <= 1 && detailOrder.maxGap <= 1
      && detailOrder.settled && detailOrder.settled.overlap <= 1 && detailOrder.settled.gap <= 1
      && detailOrder.virtualSyncs > 0;
    if (detailOrderPass) {
      report.pass.push('详情页快速滚动回放：多条隐藏评论与物理行重排期间无内容层重叠或异常空白');
    } else report.fail.push('详情页快速滚动/物理行重排补位失败：' + JSON.stringify(detailOrder));
    await detailOrderPage.close();

    const feedPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await feedPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: feedFixture }));
    await feedPage.addInitScript({ content: feedShim + '\n' + userscript });
    await feedPage.goto('https://weibo.com/feed-replay', { waitUntil: 'domcontentloaded' });
    await feedPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(700);
    const feedInitial = await feedPage.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const target = rows[5];
      const next = rows[6];
      const targetItem = target && target.querySelector('.wbpro-list > .item1');
      return {
        rowCount: rows.length,
        blocked: !!targetItem && targetItem.hasAttribute('data-ob-blocked'),
        blockedHeight: targetItem ? targetItem.getBoundingClientRect().height : -1,
        targetOuterTop: target ? target.getBoundingClientRect().top : NaN,
        targetContentTop: target && target.firstElementChild ? target.firstElementChild.getBoundingClientRect().top : NaN,
        targetContentTransform: target && target.firstElementChild ? target.firstElementChild.style.getPropertyValue('transform') : '',
        nextOuterTop: next ? next.getBoundingClientRect().top : NaN,
        nextContentTop: next && next.firstElementChild ? next.firstElementChild.getBoundingClientRect().top : NaN,
        nextContentTransform: next && next.firstElementChild ? next.firstElementChild.style.getPropertyValue('transform') : '',
        nestedIgnored: window.OB && window.OB.diagnostics
          ? window.OB.diagnostics.weiboNestedVirtualRowsIgnored : 0,
      };
    });
    const feedRecycle = await feedPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const target = rows()[5];
      const next = rows()[6];
      if (!target || !next) return { error: 'missing target rows' };
      // 模拟回收器短暂挂载占位内容：此时物理行仍被旧的本地屏蔽状态记录，
      // 但行内已经没有被屏蔽评论；同步必须先清除旧状态，不能把新行继续上移。
      target.innerHTML = '<div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important"><div class="recycler-placeholder"></div></div>';
      target.style.setProperty('transform', 'translateY(361px) translateX(0px)', '');
      next.style.setProperty('transform', 'translateY(433px) translateX(0px)', '');
      await sleepInPage(260);
      const placeholder = {
        targetHiddenState: !!target.querySelector('[data-ob-blocked="1"]'),
        targetOuterTop: target.getBoundingClientRect().top,
        nextOuterTop: next.getBoundingClientRect().top,
        nextContentTop: next.firstElementChild ? next.firstElementChild.getBoundingClientRect().top : NaN,
        nextContentTransform: next.firstElementChild ? next.firstElementChild.style.getPropertyValue('transform') : '',
      };
      // 回收器随后把同一物理行复用为一个新的、未命中的评论；新内容也必须可见。
      target.innerHTML = '<div class="wbpro-scroller-item" style="box-sizing:border-box;height:72px !important"><div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a href="/u/499999" usercard="499999">复用后的普通作者</a><span>复用后的普通正文</span></div><div class="info"><div class="opt"></div></div></div></div></div></div></div>';
      await sleepInPage(260);
      const replacement = {
        visible: !!target.querySelector('.wbpro-list > .item1')
          && !target.querySelector('.wbpro-list > .item1').hasAttribute('data-ob-blocked'),
        nextOuterTop: next.getBoundingClientRect().top,
        nextContentTop: next.firstElementChild ? next.firstElementChild.getBoundingClientRect().top : NaN,
        nextContentTransform: next.firstElementChild ? next.firstElementChild.style.getPropertyValue('transform') : '',
      };
      return { placeholder, replacement };
    });
    const feedPass = feedInitial.rowCount === 16 && feedInitial.blocked && feedInitial.blockedHeight === 0
      && Number.isFinite(feedInitial.targetOuterTop) && Number.isFinite(feedInitial.nextContentTop)
      && feedInitial.nestedIgnored > 0
      && Math.abs(feedInitial.targetContentTop - feedInitial.targetOuterTop) <= 1
      && Math.abs(feedInitial.nextOuterTop - feedInitial.targetOuterTop - 72) <= 2
      && Math.abs(feedInitial.nextContentTop - feedInitial.nextOuterTop) <= 1
      && !/translateY\(-?72px\)/.test(feedInitial.targetContentTransform)
      && !/translateY\(-?72px\)/.test(feedInitial.nextContentTransform)
      && feedRecycle && !feedRecycle.error
      && !feedRecycle.placeholder.targetHiddenState
      && Math.abs(feedRecycle.placeholder.nextOuterTop - feedRecycle.placeholder.targetOuterTop - 72) <= 2
      && Math.abs(feedRecycle.placeholder.nextContentTop - feedRecycle.placeholder.nextOuterTop) <= 1
      && !/translateY\(-?72px\)/.test(feedRecycle.placeholder.nextContentTransform)
      && feedRecycle.replacement.visible
      && Math.abs(feedRecycle.replacement.nextContentTop - feedRecycle.replacement.nextOuterTop) <= 1
      && !/translateY\(-?72px\)/.test(feedRecycle.replacement.nextContentTransform);
    if (feedPass) {
      report.pass.push('个人页评论回放：嵌套评论不移动帖子虚拟行，物理行复用后不会继承旧屏蔽空洞');
    } else report.fail.push('个人页评论/回收复用失败：' + JSON.stringify({ feedInitial, feedRecycle }));
    await feedPage.close();

    const hotFeedPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await hotFeedPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hotFeedFixture }));
    await hotFeedPage.addInitScript({ content: hotFeedShim + '\n' + userscript });
    await hotFeedPage.goto('https://weibo.com/hot-feed-replay', { waitUntil: 'domcontentloaded' });
    await hotFeedPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(700);
    const hotFeed = await hotFeedPage.evaluate(async () => {
      const rows = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const target = rows[1];
      const next = rows[2];
      const wrapper = rows[0] && rows[0].parentElement;
      const nextContent = next && next.firstElementChild;
      const portalButton = document.querySelector('.ob-weibo-author-portal > .ob-weibo-author-block');
      let portalConfirm = false;
      if (portalButton) {
        portalButton.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        portalConfirm = !!document.querySelector('#ob-confirm');
        const cancel = document.querySelector('#ob-confirm .ob-no');
        if (cancel) cancel.click();
      }
      return {
        rowCount: rows.length,
        nestedBlocked: !!document.querySelector('article.woo-panel-main .wbpro-list > .item1[data-ob-blocked="1"]'),
        targetCardHidden: !!target && (target.classList.contains('ob-hidden') || getComputedStyle(target).display === 'none'),
        targetCardHeight: target ? target.getBoundingClientRect().height : -1,
        nextOuterTop: next ? next.getBoundingClientRect().top : NaN,
        nextContentTop: nextContent ? nextContent.getBoundingClientRect().top : NaN,
        nextContentTransform: nextContent ? nextContent.style.getPropertyValue('transform') : '',
        wrapperHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
        inlineAuthorButtons: document.querySelectorAll('article.woo-panel-main > header > .ob-weibo-author-block').length,
        authorPortals: document.querySelectorAll('.ob-weibo-author-portal').length,
        portalConfirm,
        nestedIgnored: window.OB.diagnostics ? window.OB.diagnostics.weiboNestedVirtualRowsIgnored : 0,
        virtualSyncs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncs : 0,
      };
    });
    const hotFeedPass = hotFeed.rowCount === 4 && hotFeed.nestedBlocked
      && !hotFeed.targetCardHidden && hotFeed.targetCardHeight > 0
      && Number.isFinite(hotFeed.nextOuterTop) && Number.isFinite(hotFeed.nextContentTop)
      && Math.abs(hotFeed.nextContentTop - hotFeed.nextOuterTop) <= 1
      && !/translateY\(-?120px\)/.test(hotFeed.nextContentTransform)
      && Math.abs(hotFeed.wrapperHeight - 480) <= 1
      && hotFeed.inlineAuthorButtons === 0 && hotFeed.authorPortals === 4
      && hotFeed.portalConfirm
      && hotFeed.nestedIgnored > 0 && hotFeed.virtualSyncs === 0;
    if (hotFeedPass) {
      report.pass.push('无限流帖子卡片回放：嵌套预览评论不触发详情页虚拟补位，作者入口不改变回收行布局');
    } else report.fail.push('无限流帖子卡片/作者入口回放失败：' + JSON.stringify(hotFeed));
    await hotFeedPage.close();

    const hotPostPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await hotPostPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hotFeedFixture }));
    await hotPostPage.addInitScript({ content: hotPostShim + '\n' + userscript });
    await hotPostPage.goto('https://weibo.com/hot-feed-post-block-replay', { waitUntil: 'domcontentloaded' });
    await hotPostPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(700);
    const hotPost = await hotPostPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const measure = () => {
        const currentRows = rows();
        const target = currentRows[1];
        const next = currentRows[2];
        const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
        const targetCard = target && target.querySelector('article.woo-panel-main');
        const targetContent = target && target.firstElementChild;
        const nextContent = next && next.firstElementChild;
        return {
          rowCount: currentRows.length,
          targetCardHidden: !!targetCard && targetCard.classList.contains('ob-hidden'),
          targetCardHeight: targetCard ? targetCard.getBoundingClientRect().height : -1,
          targetContentHeight: targetContent ? targetContent.getBoundingClientRect().height : -1,
          targetOuterTop: target ? target.getBoundingClientRect().top : NaN,
          nextOuterTop: next ? next.getBoundingClientRect().top : NaN,
          nextContentTop: nextContent ? nextContent.getBoundingClientRect().top : NaN,
          nextContentTransform: nextContent ? nextContent.style.getPropertyValue('transform') : '',
          wrapperHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
          authorPortals: document.querySelectorAll('.ob-weibo-author-portal').length,
          virtualSyncs: window.OB.diagnostics ? window.OB.diagnostics.virtualSyncs : 0,
        };
      };
      const afterBlock = measure();
      const nextRow = rows()[2];
      const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
      let platformWrites = 0;
      const timer = setInterval(() => {
        // 模拟无限流回收器在屏蔽期间反复写回 spacer 和下一行的物理基线。
        // 小数值特意保留，用来覆盖 CSSOM 将高精度像素值规范化后的路径。
        const y = platformWrites % 2 ? '240.3333333333333px' : '240px';
        if (nextRow) nextRow.style.setProperty('transform', `translateY(${y}) translateX(0px)`, '');
        if (wrapper) wrapper.style.setProperty('min-height', platformWrites % 2
          ? '480.3333333333333px' : '480px', '');
        platformWrites++;
      }, 45);
      await sleepInPage(700);
      clearInterval(timer);
      await sleepInPage(350);
      const afterChurn = measure();
      window.OB.Store.removeIdentity('weibo:uid:510001');
      await sleepInPage(320);
      return { afterBlock, afterChurn, platformWrites, afterRestore: measure() };
    });
    const afterBlock = hotPost.afterBlock;
    const afterChurn = hotPost.afterChurn;
    const afterRestore = hotPost.afterRestore;
    const hotPostPass = afterBlock.rowCount === 4
      && afterBlock.targetCardHidden && afterBlock.targetCardHeight === 0
      && afterBlock.targetContentHeight === 0
      && Number.isFinite(afterBlock.targetOuterTop) && Number.isFinite(afterBlock.nextContentTop)
      && Math.abs(afterBlock.nextContentTop - afterBlock.targetOuterTop) <= 1
      && /translateY\(-?120px\)/.test(afterBlock.nextContentTransform)
      && Math.abs(afterBlock.wrapperHeight - 360) <= 1
      && afterBlock.authorPortals === 3 && afterBlock.virtualSyncs > 0
      && hotPost.platformWrites >= 10
      && afterChurn && afterChurn.targetCardHidden && afterChurn.targetCardHeight === 0
      && Math.abs(afterChurn.nextContentTop - afterChurn.targetOuterTop) <= 1
      && /translateY\(-?120px\)/.test(afterChurn.nextContentTransform)
      && afterChurn.wrapperHeight >= 360 && afterChurn.wrapperHeight <= 481
      && afterRestore && !afterRestore.targetCardHidden && afterRestore.targetCardHeight > 0
      && afterRestore.targetContentHeight > 0
      && Math.abs(afterRestore.nextContentTop - afterRestore.nextOuterTop) <= 1
      && !/translateY\(-?120px\)/.test(afterRestore.nextContentTransform)
      && Math.abs(afterRestore.wrapperHeight - 480) <= 1
      && afterRestore.authorPortals === 4;
    if (hotPostPass) {
      report.pass.push('无限流整帖屏蔽回放：帖子原高度从 spacer 扣除，后续帖子内容层补位，撤销后完全恢复');
    } else report.fail.push('无限流整帖屏蔽补位失败：' + JSON.stringify(hotPost));
    await hotPostPage.close();

    const hotStressPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await hotStressPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hotStressFixture }));
    await hotStressPage.addInitScript({ content: hotStressShim + '\n' + userscript });
    await hotStressPage.goto('https://weibo.com/hot-feed-stress-replay', { waitUntil: 'domcontentloaded' });
    await hotStressPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await sleep(700);
    const hotStress = await hotStressPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rows = () => Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view'));
      const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
      const initialTransforms = rows().map((row) => row.style.getPropertyValue('transform'));
      const initialWrapperHeight = wrapper ? wrapper.getBoundingClientRect().height : 0;
      const before = window.OB.diagnostics ? { ...window.OB.diagnostics } : {};
      for (let index = 0; index < 100; index++) {
        const row = rows()[index % rows().length];
        const link = row && row.querySelector('article.woo-panel-main header a');
        if (!link) continue;
        const uid = String(540000 + index);
        link.setAttribute('href', '/u/' + uid);
        link.setAttribute('usercard', uid);
        link.textContent = '复用作者' + index;
        await sleepInPage(16);
      }
      await sleepInPage(350);
      const after = window.OB.diagnostics ? { ...window.OB.diagnostics } : {};
      return {
        rowCount: rows().length,
        wrapperHeight: wrapper ? wrapper.getBoundingClientRect().height : 0,
        initialWrapperHeight,
        unchangedTransforms: rows().every((row, index) => row.style.getPropertyValue('transform') === initialTransforms[index]),
        inlineAuthorButtons: document.querySelectorAll('article.woo-panel-main > header > .ob-weibo-author-block').length,
        authorPortals: document.querySelectorAll('.ob-weibo-author-portal').length,
        virtualSyncs: (after.virtualSyncs || 0) - (before.virtualSyncs || 0),
        virtualStyleWrites: (after.virtualSyncStyleWrites || 0) - (before.virtualSyncStyleWrites || 0),
        ownUiIgnored: (after.scannerOwnUiIgnored || 0) - (before.scannerOwnUiIgnored || 0),
      };
    });
    const hotStressPass = hotStress.rowCount === 80
      && Math.abs(hotStress.wrapperHeight - hotStress.initialWrapperHeight) <= 1
      && hotStress.unchangedTransforms
      && hotStress.inlineAuthorButtons === 0 && hotStress.authorPortals === 80
      && hotStress.virtualSyncs === 0 && hotStress.virtualStyleWrites === 0
      && hotStress.ownUiIgnored > 0;
    if (hotStressPass) {
      report.pass.push('无限流 80 行回收压力：100 次作者节点复用不触发虚拟补位或 spacer 写回');
    } else report.fail.push('无限流 80 行回收压力失败：' + JSON.stringify(hotStress));
    await hotStressPage.close();
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

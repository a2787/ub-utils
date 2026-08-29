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
const SOURCE_BUILD = (USERSCRIPT.match(/const RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/) || [, ''])[1];
const EXPECTED_RUNTIME_MARKER = `omniblock/${LOCAL_VERSION}/${SOURCE_BUILD}`;

// 动态控制"远程版本"（更新测试用）
let updateVersion = '9.9.9';

// 1) GM_* 桩 + 预置被拉黑用户（Bob=222 验证加载即隐藏；Frank=666 验证嵌套影子穿透）
const SHIM = `
window.__OB_PROBE_DIAGNOSTICS__ = { enabled:true };
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
  const metadataReady = /\/\/\s*@grant\s+GM_info\b/.test(USERSCRIPT)
    && /\/\/\s*@connect\s+raw\.githubusercontent\.com\b/.test(USERSCRIPT)
    && /\/\/\s*@connect\s+api\.bilibili\.com\b/.test(USERSCRIPT)
    && /\/\/\s*@license\s+GPL-3\.0-only\b/.test(USERSCRIPT);
  if (metadataReady) report.pass.push('J 更新、B站候选查询权限与 GPLv3 元数据声明完整');
  else report.fail.push('J 更新、B站候选查询权限或 GPLv3 元数据声明缺失');
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
    runtime: window.OB && window.OB.runtime,
    gearRuntime: (() => {
      const gear = document.getElementById('ob-gear');
      return gear ? {
        version: gear.getAttribute('data-ob-version'),
        build: gear.getAttribute('data-ob-build'),
        marker: gear.getAttribute('data-ob-runtime'),
      } : null;
    })(),
  }));
  console.log('DIAG:', JSON.stringify(diag));
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  if (!diag.ob) report.fail.push('用户脚本未初始化（window.OB 不存在）——见上方 PAGEERRORS/CONSOLE');
  const runtimeMatches = !!(diag.runtime
    && diag.runtime.version === LOCAL_VERSION
    && diag.runtime.build === SOURCE_BUILD
    && diag.runtime.marker === EXPECTED_RUNTIME_MARKER
    && diag.gearRuntime
    && diag.gearRuntime.version === LOCAL_VERSION
    && diag.gearRuntime.build === SOURCE_BUILD
    && diag.gearRuntime.marker === EXPECTED_RUNTIME_MARKER
    && SOURCE_BUILD.startsWith(LOCAL_VERSION + '-'));
  runtimeMatches
    ? report.pass.push('J 运行时维护标识：页面版本、源码构建与机器标记一致')
    : report.fail.push('J 运行时维护标识不一致：' + JSON.stringify({ localVersion: LOCAL_VERSION, sourceBuild: SOURCE_BUILD, diag }));

  // K. 同一文档重复注入：调试重放可能再次执行源码，但只能保留一套运行时。
  // 第二次执行用当前源码直接 eval，验证运行锁确实阻止第二套扫描器/定时器/UI。
  await page.evaluate((source) => { (0, eval)(source); }, USERSCRIPT);
  await sleep(120);
  const duplicateRuntime = await page.evaluate(() => ({
    guard: window.__OB_RUNTIME_GUARD__ ? { ...window.__OB_RUNTIME_GUARD__ } : null,
    gearCount: document.querySelectorAll('#ob-gear').length,
    runtime: window.OB && window.OB.runtime,
  }));
  const duplicateGuardWorks = !!(duplicateRuntime.guard
    && duplicateRuntime.guard.active
    && duplicateRuntime.guard.duplicateExecutions === 1
    && duplicateRuntime.runtime
    && duplicateRuntime.runtime.version === LOCAL_VERSION
    && duplicateRuntime.runtime.build === SOURCE_BUILD
    && duplicateRuntime.gearCount === 1);
  duplicateGuardWorks
    ? report.pass.push('K 同文档重复注入被运行锁忽略：仅保留一套运行时与设置入口')
    : report.fail.push('K 同文档重复注入防护失败：' + JSON.stringify(duplicateRuntime));

  // P. 突发 DOM 更新不能在 MutationObserver 回调内同步深扫。人工追加 40 棵
  // 相互独立的 Shadow DOM 评论树，扫描器应分帧处理，并至少触发一次预算让步。
  const scannerBefore = await page.evaluate(() => ({ ...(window.OB && window.OB.diagnostics || {}) }));
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 40; index++) {
      const section = document.createElement('section');
      section.className = 'artificial-ob-burst-root';
      const host = document.createElement('bili-comment-renderer');
      const shadow = host.attachShadow({ mode:'open' });
      const author = document.createElement('a');
      author.className = 'user-name';
      author.href = 'https://space.bilibili.com/' + String(880000001 + index);
      author.textContent = '人工突发作者' + index;
      shadow.appendChild(author);
      for (let depth = 0; depth < 12; depth++) {
        const node = document.createElement('span');
        node.textContent = '人工结构节点' + depth;
        shadow.appendChild(node);
      }
      section.appendChild(host);
      fragment.appendChild(section);
    }
    document.body.appendChild(fragment);
  });
  await page.waitForFunction((before) => {
    const current = window.OB && window.OB.diagnostics;
    return !!current && current.scannerDirtyRootsProcessed - (before.scannerDirtyRootsProcessed || 0) >= 40
      && window.OB.lifecycle.scannerStatus().dirtySubtrees === 0;
  }, scannerBefore, { timeout: 5000 }).catch(() => {});
  const scannerBurst = await page.evaluate((before) => {
    const current = window.OB && window.OB.diagnostics || {};
    return {
      queued: (current.scannerDirtyRootsQueued || 0) - (before.scannerDirtyRootsQueued || 0),
      processed: (current.scannerDirtyRootsProcessed || 0) - (before.scannerDirtyRootsProcessed || 0),
      yields: (current.scannerDirtyRootBudgetYields || 0) - (before.scannerDirtyRootBudgetYields || 0),
      overflows: (current.scannerDirtyRootOverflows || 0) - (before.scannerDirtyRootOverflows || 0),
      status: window.OB.lifecycle.scannerStatus(),
    };
  }, scannerBefore);
  (scannerBurst.queued >= 40 && scannerBurst.processed >= 40 && scannerBurst.yields >= 1
    && scannerBurst.overflows === 0 && scannerBurst.status && scannerBurst.status.dirtySubtrees === 0)
    ? report.pass.push('P 突发 DOM 深树按 8ms/32 根预算分帧处理，队列最终清空')
    : report.fail.push('P 扫描器突发队列/预算失败：' + JSON.stringify(scannerBurst));

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

  await page.screenshot({ path: path.join(ROOT, 'test', '_shot_1_load.png'), fullPage: true });

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

  await page.screenshot({ path: path.join(ROOT, 'test', '_shot_2_after_block.png'), fullPage: true });

  // E. 设置面板：出现且含"抖音连续跳过上限"(skipCap) 与 "检查更新"按钮
  const e = await page.evaluate(`(async () => {
    document.getElementById('ob-gear').click();
    await new Promise(r=>setTimeout(r,150));
    const panel = document.getElementById('ob-panel');
    const skip = panel ? panel.querySelector('#ob-skipcap') : null;
    const upd = panel ? panel.querySelector('#ob-update') : null;
    const localBackup = panel ? panel.querySelector('#ob-local-backup') : null;
    const backupStatus = panel ? panel.querySelector('#ob-backup-status') : null;
    const restoreBackup = panel ? panel.querySelector('#ob-restore-backup') : null;
    const runtime = panel ? panel.querySelector('#ob-runtime-build') : null;
    const logs = panel ? panel.querySelector('#ob-log-events') : null;
    const logDay = panel ? panel.querySelector('#ob-log-day') : null;
    const gear = document.getElementById('ob-gear');
    return {
      panelShown: !!panel, hasSkipCap: !!skip, hasUpdateBtn: !!upd, hasLocalBackup: !!localBackup,
      hasBackupStatus: !!backupStatus, hasRestoreBackup: !!restoreBackup,
      hasRuntime: !!runtime && /运行版本：v/.test(runtime.textContent || ''),
      hasLogs: !!logs && !!logDay,
      gearExpanded: !!gear && gear.getAttribute('aria-controls') === 'ob-panel'
        && gear.getAttribute('aria-expanded') === 'true',
    };
  })()`);
  (e.panelShown && e.hasSkipCap && e.hasUpdateBtn && e.hasLocalBackup && e.hasBackupStatus && e.hasRestoreBackup && e.hasRuntime && e.hasLogs && e.gearExpanded)
    ? report.pass.push('E 设置面板：含运行标识、详细日志、"跳过上限"、"检查更新"与本地快照控件') : report.fail.push('E 设置面板失败：' + JSON.stringify(e));

  // E2 设置名单按平台分组，并保留可悬停查看的屏蔽依据（人工合成身份）。
  const e2 = await page.evaluate(async () => {
    const panel = document.getElementById('ob-panel');
    if (!panel || !window.OB) return { panel:false };
    window.OB.Store.addIdentityGroups([
      { keys:['weibo:uid:123450010'], label:'微博测试作者', note:'微博评论：人工合成正文' },
      { keys:['douyin:secuid:MS4wLjABAASettings'], label:'抖音测试作者', note:'抖音弹幕：人工合成正文' },
      ...Array.from({ length: 28 }, (_, index) => ({
        keys:['bili:uid:' + String(900000001 + index)], label:'B站布局测试' + index, note:'设置列布局人工合成身份',
      })),
    ]);
    const close = panel.querySelector('.ob-close'); if (close) close.click();
    document.getElementById('ob-gear').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = document.getElementById('ob-panel');
    const list = current && current.querySelector('#ob-list');
    const groupNodes = Array.from(current ? current.querySelectorAll('.ob-platform-group') : []);
    const groups = groupNodes.map((group) => group.querySelector('.ob-platform-title') && group.querySelector('.ob-platform-title').textContent);
    const weiboRow = current && Array.from(current.querySelectorAll('.ob-item'))
      .find((row) => row.textContent.includes('微博测试作者'));
    const biliGroup = groupNodes.find((group) => /^B站（/.test(group.querySelector('.ob-platform-title')?.textContent || ''));
    const listStyle = list ? getComputedStyle(list) : null;
    const groupStyle = biliGroup ? getComputedStyle(biliGroup) : null;
    return {
      grouped: groups.some((text) => /^微博（\d+）/.test(text || ''))
        && groups.some((text) => /^抖音（\d+）/.test(text || '')),
      groupCount: groups.length,
      reasonTitle: !!(weiboRow && weiboRow.title.includes('屏蔽依据：微博评论：人工合成正文')),
      reasonText: !!(weiboRow && weiboRow.querySelector('.ob-note')
        && weiboRow.querySelector('.ob-note').textContent.includes('微博评论：人工合成正文')),
      columns: !!(list && listStyle && listStyle.display === 'flex' && listStyle.overflowY === 'hidden'),
      independentScroll: !!(biliGroup && groupStyle && groupStyle.overflowY === 'auto'
        && biliGroup.scrollHeight > biliGroup.clientHeight),
    };
  });
  (e2.grouped && e2.reasonTitle && e2.reasonText && e2.columns && e2.independentScroll)
    ? report.pass.push('E2 设置名单：按平台分列、各列独立滚动，行内备注并可通过鼠标悬停查看屏蔽依据')
    : report.fail.push('E2 设置名单分组/屏蔽依据失败：' + JSON.stringify(e2));

  const e5 = await page.evaluate(() => {
    const status = window.OB && window.OB.Store.storageStatus();
    const line = document.querySelector('#ob-storage-status');
    return {
      status,
      line: line && line.textContent,
      level: line && line.dataset.level,
      color: line && getComputedStyle(line).color,
    };
  });
  (e5.status && e5.status.persons >= 30 && e5.status.identities >= e5.status.persons
    && e5.status.chars > 0 && e5.status.warningChars < e5.status.criticalChars
    && e5.status.criticalChars < e5.status.devBridgeMaxChars
    && e5.status.persist && e5.status.persist.count > 0
    && e5.status.persist.lastPayloadChars > 0
    && e5.line && e5.line.includes(String(e5.status.persons)) && e5.level === e5.status.level)
    ? report.pass.push('E5 名单容量状态：设置页显示人数、身份数、序列化体积和分级预警边界')
    : report.fail.push('E5 名单容量状态失败：' + JSON.stringify(e5));

  // E3 详细日志：记录运行事件，导出再次脱敏，不出现人为注入的正文/身份值。
  const e3 = await page.evaluate(() => {
    const logs = window.OB && window.OB.logs;
    if (!logs) return { logs:false };
    logs.record('test.sensitive-probe', {
      text: '不应进入导出日志的人工合成正文',
      identity: 'bili:uid:999999999',
      url: 'https://example.invalid/video/private?id=999',
      safeCount: 7,
    }, { force:true, immediate:true });
    const day = logs.days()[0];
    const events = logs.eventsForDay(day);
    const exported = logs.exportJSON();
    const probe = events.find((event) => event.type === 'test.sensitive-probe');
    const scan = events.find((event) => event.type === 'scanner.scan' && event.data && event.data.selectorCounts);
    const mutation = events.find((event) => event.type === 'dom.mutation.batch');
    for (let index = 0; index < 20; index++) logs.recordPassive('test.passive', { safeCount: index });
    const passiveEvents = logs.eventsForDay(day).filter((event) => event.type === 'test.passive');
    const passiveAggregation = passiveEvents.length === 1
      && passiveEvents[0].data && passiveEvents[0].data.aggregated === true
      && passiveEvents[0].data.sampleCount === 20;
    const selectorCountsVisible = !!(scan && scan.data.selectorCounts
      && Object.values(scan.data.selectorCounts).some((value) => typeof value === 'number'));
    const mutationAggregated = !!(mutation && mutation.data && mutation.data.aggregated === true
      && !Object.prototype.hasOwnProperty.call(mutation.data, 'records')
      && mutation.data.sampleCount > 0);
    return {
      logs: true,
      hasProbe: !!probe,
      hasMutation: events.some((event) => event.type === 'dom.mutation.batch'),
      hasScan: events.some((event) => event.type === 'scanner.scan'),
      hasUserAction: events.some((event) => event.type === 'action.manual-block' || event.type === 'ui.settings.open'),
      hasPersistence: events.some((event) => event.type === 'storage.persist'),
      redacted: !!(probe && probe.data && probe.data.text === '[redacted]' && probe.data.identity === '[redacted]' && probe.data.url === '[redacted]'),
      exportClean: !exported.includes('不应进入导出日志的人工合成正文')
        && !exported.includes('bili:uid:999999999')
        && !exported.includes('private?id=999')
        && exported.includes('safeCount'),
      selectorCountsVisible,
      mutationAggregated,
      passiveAggregation,
      status: logs.status(),
    };
  });
  (e3.logs && e3.hasProbe && e3.hasMutation && e3.hasScan && e3.hasUserAction && e3.hasPersistence && e3.redacted && e3.exportClean
    && e3.mutationAggregated && e3.passiveAggregation
    && e3.selectorCountsVisible && e3.status.events > 0 && e3.status.metrics
    && e3.status.metrics.flushes > 0 && e3.status.metrics.cachedShards > 0)
    ? report.pass.push('E3 详细运行日志：高频 DOM/扫描事件窗口聚合，导出二次脱敏并保留安全计数')
    : report.fail.push('E3 详细运行日志失败：' + JSON.stringify(e3));

  // E4. 右下角控制坞：收起时隐藏页面入口，移入齿轮展开；从齿轮移向入口时
  // 用短暂 action hold 防止指针离开齿轮后浮窗抢先消失。
  const e4 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const panel = document.getElementById('ob-panel');
    if (panel) panel.querySelector('.ob-close')?.click();
    // 收起由 release 的 450ms 计时和 visibility 的 200ms CSS 过渡组成；
    // 初始面板关闭也要留出完整余量，避免读取到过渡中的 visible 状态。
    await sleep(900);
    const gear = document.getElementById('ob-gear');
    const fab = document.querySelector('.ob-bulk[data-ob-kind="page"]');
    if (!gear || !fab) return { gear:false, fab:!!fab };
    const collapsed = {
      state: document.documentElement.getAttribute('data-ob-dock'),
      gearState: gear.getAttribute('data-ob-dock-state'),
      fabOpacity: getComputedStyle(fab).opacity,
      fabVisibility: getComputedStyle(fab).visibility,
      fabPointerEvents: getComputedStyle(fab).pointerEvents,
      fabInlineVisibility: fab.style.getPropertyValue('visibility'),
      fabInlineVisibilityPriority: fab.style.getPropertyPriority('visibility'),
      fabMatchesCollapsed: fab.matches('html[data-ob-dock="collapsed"] .ob-bulk[data-ob-kind="page"]'),
    };
    gear.dispatchEvent(new PointerEvent('pointerover', { bubbles:true, composed:true, relatedTarget: document.body }));
    await sleep(280);
    const expanded = {
      state: document.documentElement.getAttribute('data-ob-dock'),
      gearState: gear.getAttribute('data-ob-dock-state'),
      fabOpacity: getComputedStyle(fab).opacity,
      fabVisibility: getComputedStyle(fab).visibility,
      fabPointerEvents: getComputedStyle(fab).pointerEvents,
      fabInlineVisibility: fab.style.getPropertyValue('visibility'),
      fabInlineVisibilityPriority: fab.style.getPropertyPriority('visibility'),
    };
    fab.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, composed:true }));
    fab.dispatchEvent(new PointerEvent('pointerout', { bubbles:true, composed:true, relatedTarget: document.body }));
    await sleep(550);
    const held = { state: document.documentElement.getAttribute('data-ob-dock') };
    await sleep(2550);
    const autoCollapsed = { state: document.documentElement.getAttribute('data-ob-dock') };
    gear.dispatchEvent(new PointerEvent('pointerover', { bubbles:true, composed:true, relatedTarget: document.body }));
    await sleep(280);
    gear.click();
    await sleep(120);
    const panelOpen = {
      present: !!document.getElementById('ob-panel'),
      gearExpanded: gear.getAttribute('aria-expanded') === 'true',
    };
    const closeButton = document.getElementById('ob-panel')?.querySelector('.ob-close');
    const closeBefore = {
      panel: !!document.getElementById('ob-panel'),
      button: !!closeButton,
      gearExpanded: gear.getAttribute('aria-expanded'),
    };
    closeButton?.click();
    // release 的收起计时为 450ms，visibility 还带 200ms 的 CSS 过渡延迟；
    // 留出明确余量，避免在两个定时器恰好同一 tick 时读取到过渡中的状态。
    await sleep(800);
    const panelClosed = {
      state: document.documentElement.getAttribute('data-ob-dock'),
      panelPresent: !!document.getElementById('ob-panel'),
      closeBefore,
      gearAttribute: gear.getAttribute('aria-expanded'),
      gearExpanded: gear.getAttribute('aria-expanded') === 'false',
    };
    return { gear:true, fab:true, collapsed, expanded, held, autoCollapsed, panelOpen, panelClosed };
  });
  const dockWorks = e4.gear && e4.fab
    && e4.collapsed.state === 'collapsed'
    && e4.collapsed.gearState === 'collapsed'
    && e4.collapsed.fabOpacity === '0'
    && e4.collapsed.fabVisibility === 'hidden'
    && e4.collapsed.fabPointerEvents === 'none'
    && e4.expanded.state === 'expanded'
    && e4.expanded.gearState === 'expanded'
    && e4.expanded.fabOpacity === '1'
    && e4.expanded.fabVisibility === 'visible'
    && e4.expanded.fabPointerEvents === 'auto'
    && e4.held.state === 'expanded'
    && e4.autoCollapsed.state === 'collapsed'
    && e4.panelOpen.present && e4.panelOpen.gearExpanded
    && e4.panelClosed.state === 'collapsed' && e4.panelClosed.gearExpanded;
  dockWorks
    ? report.pass.push('E4 右下角控制坞：收起隐藏页面入口、悬停展开，移向入口时 action hold 保持可用')
    : report.fail.push('E4 右下角控制坞状态/联动失败：' + JSON.stringify(e4));
  await page.evaluate(() => document.getElementById('ob-gear')?.click());
  await sleep(120);

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

  await page.screenshot({ path: path.join(ROOT, 'test', '_shot_3_settings.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(100);
  const mobile = await page.evaluate(() => {
    const box = document.querySelector('#ob-panel .ob-box');
    const rect = box && box.getBoundingClientRect();
    return {
      box: !!box,
      left: rect && rect.left,
      right: rect && rect.right,
      viewport: innerWidth,
      overflow: box ? box.scrollWidth > box.clientWidth + 1 : true,
    };
  });
  (mobile.box && mobile.left >= 0 && mobile.right <= mobile.viewport + 1 && !mobile.overflow)
    ? report.pass.push('K 移动视口：设置面板完整落在视口内且无横向溢出')
    : report.fail.push('K 移动视口布局错误：' + JSON.stringify(mobile));
  await page.screenshot({ path: path.join(ROOT, 'test', '_shot_4_mobile_settings.png'), fullPage: false });

  // L. frozen/BFCache/销毁边界：freeze 只暂停，persisted pagehide 不清理；普通
  // pagehide 必须统一停止扫描器、循环、订阅和观察器，且重复事件保持幂等。
  const lifecycle = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const before = {
      page: window.OB.lifecycle.pageStatus(),
      resources: window.OB.lifecycle.resourceStatus(),
      scanner: window.OB.lifecycle.scannerStatus(),
    };
    history.pushState({}, '', '/test-spa-resource-boundary');
    await wait(1150);
    const afterRoute = {
      resources: window.OB.lifecycle.resourceStatus(),
      scanner: window.OB.lifecycle.scannerStatus(),
    };
    document.dispatchEvent(new Event('freeze'));
    await wait(30);
    const frozen = {
      page: window.OB.lifecycle.pageStatus(),
      scanner: window.OB.lifecycle.scannerStatus(),
    };
    document.dispatchEvent(new Event('resume'));
    await wait(80);
    const resumed = {
      page: window.OB.lifecycle.pageStatus(),
      scanner: window.OB.lifecycle.scannerStatus(),
    };
    const cachedHide = new Event('pagehide');
    Object.defineProperty(cachedHide, 'persisted', { value:true });
    window.dispatchEvent(cachedHide);
    const afterCachedHide = window.OB.lifecycle.resourceStatus();
    const finalHide = new Event('pagehide');
    Object.defineProperty(finalHide, 'persisted', { value:false });
    window.dispatchEvent(finalHide);
    window.dispatchEvent(finalHide);
    const disposed = {
      resources: window.OB.lifecycle.resourceStatus(),
      scanner: window.OB.lifecycle.scannerStatus(),
    };
    return { before, afterRoute, frozen, resumed, afterCachedHide, disposed };
  });
  (lifecycle.before.resources.resources > 0 && lifecycle.before.scanner && !lifecycle.before.scanner.stopped
    && lifecycle.afterRoute.resources.resources <= lifecycle.before.resources.resources
    && lifecycle.afterRoute.scanner && !lifecycle.afterRoute.scanner.stopped
    && lifecycle.frozen.page.frozen && !lifecycle.frozen.page.visible && !lifecycle.frozen.scanner.scheduled
    && !lifecycle.resumed.page.frozen && lifecycle.resumed.page.visible && !lifecycle.resumed.scanner.stopped
    && !lifecycle.afterCachedHide.disposed
    && lifecycle.disposed.resources.disposed && lifecycle.disposed.resources.reason === 'pagehide'
    && lifecycle.disposed.resources.resources === 0 && lifecycle.disposed.scanner.stopped)
    ? report.pass.push('L 生命周期边界：SPA 不增殖资源，freeze/BFCache 可恢复，普通 pagehide 幂等回收')
    : report.fail.push('L 生命周期回收失败：' + JSON.stringify(lifecycle));

  const ok = report.fail.length === 0;
  // 同步落盘报告（务必在 browser.close 之前，避免其偶发挂起导致进程卡死、结果丢失）
  try { fs.writeFileSync(path.join(ROOT, 'test', '_lastrun.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'); } catch (e) {}
  console.log('==== OmniBlock 自测结果 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach(x => console.log('  ✅', x));
  console.log('FAIL:', report.fail.length); report.fail.forEach(x => console.log('  ❌', x));
  console.log('Console(errors/warn):', report.console.length); report.console.forEach(x => console.log('  ·', x));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach(x => console.log('  ·', x));
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  // 不 await browser.close：偶发挂起会让进程无法自然退出；强制退出以保结果落盘
  try { browser.close().catch(() => {}); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});

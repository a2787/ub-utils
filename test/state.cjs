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
window.GM_setValue = (k,v) => { if (window.__gmFailWrites) throw new Error('simulated storage failure'); window.__gm[k] = v; };
window.GM_deleteValue = () => {};
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.__gmListeners = {};
window.GM_addValueChangeListener = (k, fn) => { window.__gmListeners[k] = fn; };
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;
}

const biliFixture = `<!doctype html><html><body><bili-comments id="comments"></bili-comments><script>
const root = document.getElementById('comments').attachShadow({mode:'open'});
const style = document.createElement('style'); style.textContent = 'bili-comment-thread-renderer{display:block;height:24px;margin:0;padding:0}'; root.appendChild(style);
function addComment(uid, name) {
  const thread = document.createElement('bili-comment-thread-renderer');
  thread.id = 'comment-' + uid;
  const threadRoot = thread.attachShadow({mode:'open'});
  const item = document.createElement('bili-comment-renderer');
  item.id = 'renderer-' + uid;
  item.__data = { member:{ mid:String(uid), uname:name } };
  const shadow = item.attachShadow({mode:'open'});
  const link = document.createElement('a'); link.className='user-name'; link.href='//space.bilibili.com/'+uid; link.textContent=name;
  const menu = document.createElement('bili-comment-menu'); menu.__data = { member:{ mid:String(uid), uname:name } };
  const menuRoot = menu.attachShadow({mode:'open'}); const options = document.createElement('ul'); options.id='options';
  const nativeBlock = document.createElement('li'); nativeBlock.textContent='加入黑名单'; options.appendChild(nativeBlock); menuRoot.appendChild(options);
  shadow.append(link, menu); threadRoot.appendChild(item); root.appendChild(thread); return thread;
}
function addSubComment(threadUid, uid, name) {
  const thread = root.querySelector('#comment-' + threadUid);
  const item = document.createElement('bili-comment-reply-renderer'); item.id = 'sub-' + uid;
  item.__data = { member:{ mid:String(uid), uname:name } };
  const shadow = item.attachShadow({mode:'open'});
  const link = document.createElement('a'); link.className='user-name'; link.href='//space.bilibili.com/'+uid; link.textContent=name;
  shadow.appendChild(link); thread.shadowRoot.appendChild(item); return item;
}
window.__addComment = addComment;
addComment(111, 'Before');
addComment(222, 'Bob');
addComment(444, 'After');
addSubComment(111, 555, 'Blocked sub-comment');
</script></body></html>`;

const xFixture = `<!doctype html><html><body><div data-testid="cellInnerDiv" id="cell"><article data-testid="tweet"><a role="link" href="/MixedCase">@MixedCase</a></article></div></body></html>`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const bili = await browser.newPage();
    await bili.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: biliFixture }));
    await bili.addInitScript({ content: shim({ p_bob:{ label:'Bob', note:'', createdAt:0, hits:0, identities:['bili:uid:222'] }, p_late:{ label:'Late', note:'', createdAt:0, hits:0, identities:['bili:uid:333'] }, p_sub:{ label:'Sub', note:'', createdAt:0, hits:0, identities:['bili:uid:555'] } }) + '\n' + userscript });
    await bili.goto('https://www.bilibili.com/test', { waitUntil: 'domcontentloaded' });
    await bili.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 });
    await wait(1300);

    const initial = await bili.evaluate(() => {
      const root = document.querySelector('bili-comments').shadowRoot;
      const item = root.querySelector('#comment-222');
      const sub = root.querySelector('#comment-111').shadowRoot.querySelector('#sub-555');
      const before = root.querySelector('#comment-111').getBoundingClientRect();
      const after = root.querySelector('#comment-444').getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      return {
        blocked:item.getAttribute('data-ob-blocked') === '1',
        hidden:item.classList.contains('ob-hidden'),
        visuallyHidden:getComputedStyle(item).display === 'none' || rect.height === 0,
        bars:root.querySelectorAll('.ob-bar').length,
        gap:Math.round(after.top - before.bottom),
        subOnlyHidden:sub.classList.contains('ob-hidden') && getComputedStyle(sub).display === 'none' && !root.querySelector('#comment-111').hasAttribute('data-ob-blocked'),
      };
    });
    if (initial.blocked && initial.hidden && initial.visuallyHidden && initial.bars === 0 && initial.gap === 0 && initial.subOnlyHidden) report.pass.push('STATE-A 根评论线程与楼中楼均按正确边界无提示、零占位隐藏');
    else report.fail.push('STATE-A 初始评论无痕隐藏错误：' + JSON.stringify(initial));

    const late = await bili.evaluate(async () => {
      const item = window.__addComment(333, 'Late');
      await new Promise((resolve) => setTimeout(resolve, 350));
      const root = document.querySelector('bili-comments').shadowRoot;
      return {
        blocked:item.getAttribute('data-ob-blocked') === '1',
        hidden:item.classList.contains('ob-hidden'),
        visuallyHidden:getComputedStyle(item).display === 'none' || item.getBoundingClientRect().height === 0,
        bars:root.querySelectorAll('.ob-bar').length,
      };
    });
    if (late.blocked && late.hidden && late.visuallyHidden && late.bars === 0) report.pass.push('STATE-B 后加载的黑名单评论也会无提示、零占位隐藏');
    else report.fail.push('STATE-B Shadow DOM 后加载内容漏扫：' + JSON.stringify(late));

    const transitions = await bili.evaluate(async () => {
      window.OB.openOptions();
      const panel = document.getElementById('ob-panel');
      const disappear = panel.querySelector('input[name="ob-mode"][value="disappear"]');
      disappear.checked = true; disappear.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const root = document.querySelector('bili-comments').shadowRoot;
      const item = root.querySelector('#comment-222');
      const sub = root.querySelector('#comment-111').shadowRoot.querySelector('#sub-555');
      const disappeared = item.classList.contains('ob-hidden') && root.querySelectorAll('.ob-bar').length === 0;
      const collapse = panel.querySelector('input[name="ob-mode"][value="collapse"]');
      collapse.checked = true; collapse.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const stillDisappeared = item.classList.contains('ob-hidden') && !item.classList.contains('ob-collapsed') && root.querySelectorAll('.ob-bar').length === 0;
      const enabled = panel.querySelector('#ob-enabled'); enabled.checked = false; enabled.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const disabledRestored = !item.hasAttribute('data-ob-blocked') && getComputedStyle(item).display !== 'none' && item.getBoundingClientRect().height > 0 && !sub.hasAttribute('data-ob-blocked') && getComputedStyle(sub).display !== 'none' && root.querySelectorAll('.ob-bar').length === 0;
      enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const before = root.querySelector('#comment-111').getBoundingClientRect();
      const after = root.querySelector('#comment-444').getBoundingClientRect();
      const reenabled = item.getAttribute('data-ob-blocked') === '1' && item.classList.contains('ob-hidden') && sub.getAttribute('data-ob-blocked') === '1' && getComputedStyle(sub).display === 'none' && root.querySelectorAll('.ob-bar').length === 0 && Math.round(after.top - before.bottom) === 0;
      return { disappeared, stillDisappeared, disabledRestored, reenabled };
    });
    if (transitions.disappeared && transitions.stillDisappeared && transitions.disabledRestored && transitions.reenabled)
      report.pass.push('STATE-C 评论不受灰条模式影响，总开关关闭可恢复、重开后再次无痕隐藏');
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
      const initial = { quick:deepCount('.ob-quick:not(.ob-thread-quick)'), thread:deepCount('.ob-thread-quick'), bulk:deepCount('.ob-bulk') };
      window.OB.Store.setSetting('showQuickBlock', true); window.OB.Store.setSetting('showBulkBlock', true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const enabled = { quick:deepCount('.ob-quick:not(.ob-thread-quick)'), thread:deepCount('.ob-thread-quick'), bulk:deepCount('.ob-bulk') };
      window.OB.Store.setSetting('showQuickBlock', false); window.OB.Store.setSetting('showBulkBlock', false);
      // 关闭设置走同步清理；额外留出一小段时间确认没有后续队列把入口重建。
      await new Promise((resolve) => setTimeout(resolve, 180));
      const disabled = { quick:deepCount('.ob-quick:not(.ob-thread-quick)'), thread:deepCount('.ob-thread-quick'), visibleBulk:Array.from(document.querySelectorAll('.ob-bulk')).filter((el)=>getComputedStyle(el).display!=='none').length };
      return { initial, enabled, disabled };
    });
    if (toggleState.initial.quick === 0 && toggleState.initial.thread === 0 && toggleState.initial.bulk === 0
      && toggleState.enabled.quick === 3 && toggleState.enabled.thread === 3 && toggleState.enabled.bulk === 1
      && toggleState.disabled.quick === 0 && toggleState.disabled.thread === 0 && toggleState.disabled.visibleBulk === 0)
      report.pass.push('STATE-D 快捷与批量入口即使初始关闭，也可免刷新启用并再次清理');
    else report.fail.push('STATE-D 入口开关生命周期错误：' + JSON.stringify(toggleState));
    await toggles.close();

    const x = await browser.newPage();
    await x.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: xFixture }));
    await x.addInitScript({ content: shim({ p_x:{ label:'Mixed', note:'', createdAt:0, hits:0, identities:['x:handle:mixedcase'] } }, { hideMode:'collapse' }) + '\n' + userscript });
    await x.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await x.waitForFunction(() => !!window.OB && !!document.getElementById('ob-gear'), null, { timeout: 8000 });
    await wait(1300);
    const virtual = await x.evaluate(async () => {
      const cell = document.getElementById('cell');
      for (let i=0; i<3; i++) { const span=document.createElement('span'); span.textContent=String(i); cell.querySelector('article').appendChild(span); await new Promise((resolve) => setTimeout(resolve, 80)); }
      const initiallyGone = cell.classList.contains('ob-hidden') && getComputedStyle(cell).display === 'none' && document.querySelectorAll('.ob-bar').length === 0;
      window.OB.openOptions();
      document.querySelector('#ob-list .ob-del').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { initiallyGone, bars:document.querySelectorAll('.ob-bar').length, restored:!cell.hasAttribute('data-ob-blocked') && getComputedStyle(cell).display !== 'none' };
    });
    if (virtual.initiallyGone && virtual.bars === 0 && virtual.restored) report.pass.push('STATE-E X 虚拟条目无提示、零占位隐藏，删除身份后恢复容器');
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

    // G0. 主名单写入失败时，内存状态仍可供当前页继续运行，但不得触发备份/provider
    // 成功通知或把操作返回值伪装成已落盘；下一次成功写入应恢复正常状态。
    const persistFailure = await x.evaluate(() => {
      const store = window.OB.Store;
      const sinkSnapshots = [];
      const unregister = store.registerBackupSink('persist-failure-test', {
        onSnapshot: (snapshot) => sinkSnapshots.push(snapshot),
      });
      const before = store.storageStatus().persist;
      window.__gmFailWrites = true;
      const failed = store.addIdentities(['x:handle:persistfailure'], '写入失败人工合成');
      const afterFailure = store.storageStatus();
      const failedInMemory = window.OB.Index.isBlocked('x:handle:persistfailure');
      const externalRaw = JSON.stringify({ version:1, persons:{ external:{ label:'外部覆盖', identities:['x:handle:external-only'] } }, settings:{ enabled:true } });
      window.__gm['omniblock:data:v1'] = externalRaw;
      if (window.__gmListeners['omniblock:data:v1']) window.__gmListeners['omniblock:data:v1'](true, externalRaw, window.__gm['omniblock:data:v1']);
      const afterConflict = store.storageStatus();
      const preservedAfterExternal = window.OB.Index.isBlocked('x:handle:persistfailure')
        && !window.OB.Index.isBlocked('x:handle:external-only');
      window.__gmFailWrites = false;
      const recovered = store.addIdentities(['x:handle:persistrecovery'], '写入恢复人工合成');
      const afterRecovery = store.storageStatus();
      unregister();
      return {
        failedPersisted: failed && failed.persisted === false,
        failedPersistError: failed && failed.persistError,
        failedInMemory,
        failureCountIncreased: afterFailure.persist.failures > before.failures,
        lastFailed: afterFailure.persist.lastOk === false && afterFailure.persist.lastError === 'main-storage-write-failed',
        externalConflict: afterConflict.persist.externalConflict === true && afterConflict.persist.externalConflicts >= 1,
        preservedAfterExternal,
        sinkSuppressed: sinkSnapshots.length === 1,
        recoveredPersisted: recovered && recovered.persisted === true,
        lastRecovered: afterRecovery.persist.lastOk === true && afterRecovery.persist.lastError === ''
          && afterRecovery.persist.externalConflict === false && afterRecovery.persist.pendingLocalWrite === false,
      };
    });
    if (persistFailure.failedPersisted && persistFailure.failedPersistError === 'main-storage-write-failed'
      && persistFailure.failedInMemory && persistFailure.failureCountIncreased && persistFailure.lastFailed
      && persistFailure.externalConflict && persistFailure.preservedAfterExternal
      && persistFailure.sinkSuppressed && persistFailure.recoveredPersisted && persistFailure.lastRecovered) {
      report.pass.push('STATE-G0 主名单写入失败可见且不触发伪成功备份，恢复写入后状态正常');
    } else report.fail.push('STATE-G0 主名单写入失败语义错误：' + JSON.stringify(persistFailure));

    const identityIndex = await x.evaluate(() => {
      const store = window.OB.Store;
      const before = store.storageStatus().identityIndex;
      const groups = Array.from({ length: 80 }, (_, index) => ({
        keys: ['x:handle:index' + index], label: '索引批量 ' + index,
      }));
      const writes = store.addIdentityGroups(groups);
      const after = store.storageStatus().identityIndex;
      const all = store.allIdentities();
      return {
        count: writes.length,
        persisted: writes.persisted === true,
        entries: after.entries,
        added: all.has('x:handle:index0') && all.has('x:handle:index79'),
        rebuildDelta: after.rebuilds - before.rebuilds,
        lookupDelta: after.lookups - before.lookups,
      };
    });
    if (identityIndex.count === 80 && identityIndex.persisted && identityIndex.entries >= 80
      && identityIndex.added && identityIndex.rebuildDelta === 0 && identityIndex.lookupDelta >= 80) {
      report.pass.push('STATE-G1 批量身份添加复用 key→人物索引，不为每个组重复重建完整名单');
    } else report.fail.push('STATE-G1 身份索引批量路径异常：' + JSON.stringify(identityIndex));

    // G. 本地备份：人工合成状态只验证快照协议、保留上限、恢复可逆和未来 provider 边界，
    // 不代表浏览器配置丢失时仍能恢复；外部文件导出仍由用户显式操作。
    const backup = await x.evaluate(async () => {
      const store = window.OB.Store;
      store.ensureLocalBackup();
      const manualExport = JSON.parse(store.exportJSON());
      const sinkSnapshots = [];
      const unregister = store.registerBackupSink('state-test', { onSnapshot: (snapshot) => sinkSnapshots.push(snapshot) });
      const firstReplacement = [];
      const secondReplacement = [];
      const unregisterFirst = store.registerBackupSink('replace-test', { onSnapshot: (snapshot) => firstReplacement.push(snapshot) });
      const unregisterSecond = store.registerBackupSink('replace-test', { onSnapshot: (snapshot) => secondReplacement.push(snapshot) });
      unregisterFirst();
      store.addIdentities(['x:handle:backupa'], 'Backup A');
      const afterA = store.listBackups();
      store.addIdentities(['x:handle:backupb'], 'Backup B');
      store.addIdentities(['x:handle:replace'], 'Replacement');
      const beforeExternalNotify = sinkSnapshots.length;
      if (window.__gmListeners['omniblock:data:v1']) window.__gmListeners['omniblock:data:v1']('omniblock:data:v1', null, window.__gm['omniblock:data:v1'], true);
      const externalNotify = sinkSnapshots.slice(beforeExternalNotify).some((snapshot) => snapshot.reason === 'external-change');
      const beforeRestore = store.backupStatus();
      const restore = store.restoreBackup(afterA[0] && afterA[0].snapshotId);
      const restoredA = window.OB.Index.isBlocked('x:handle:backupa');
      const restoredB = window.OB.Index.isBlocked('x:handle:backupb');
      for (let i = 0; i < 8; i++) store.addIdentities(['x:handle:b' + i], 'B' + i);
      const bounded = store.backupStatus();
      const records = store.listBackups();
      const latestRaw = JSON.parse(window.__gm['omniblock:backup:v1'] || '{}');
      const latest = latestRaw.snapshots && latestRaw.snapshots[0];
      const countBeforeDisable = store.backupStatus().count;
      store.setSetting('localBackupEnabled', false);
      store.addIdentities(['x:handle:noauto'], 'No Auto');
      const countAfterDisable = store.backupStatus().count;
      const fallbackRestore = store.restorePreviousBackup();
      const restoredAfterDisabledWrite = window.OB.Index.isBlocked('x:handle:b7')
        && !window.OB.Index.isBlocked('x:handle:noauto')
        && store.getSetting('localBackupEnabled') === true;
      const restoredTarget = fallbackRestore && fallbackRestore.identities;
      unregisterSecond();
      unregister();
      return {
        format: latest && latest.format,
        schema: latest && latest.schema,
        manualExportCompatible: manualExport.version === 1 && !manualExport.format && !!manualExport.persons && !!manualExport.settings,
        recordCount: records.length,
        beforeRestore: beforeRestore.count,
        restoredA,
        restoredB,
        bounded: bounded.count <= bounded.retention,
        sinkCount: sinkSnapshots.length,
        sinkShape: !!(sinkSnapshots[0] && sinkSnapshots[0].format === 'omniblock.snapshot' && sinkSnapshots[0].persons && sinkSnapshots[0].settings),
        providerReplacement: firstReplacement.length === 0 && secondReplacement.length > 0,
        externalNotify,
        countBeforeDisable,
        countAfterDisable,
        restoredAfterDisabledWrite,
        restoredTarget,
      };
    });
    if (backup.format === 'omniblock.snapshot' && backup.schema === 1 && backup.recordCount > 0
      && backup.beforeRestore >= 2 && backup.restoredA && !backup.restoredB && backup.bounded
      && backup.sinkCount >= 2 && backup.sinkShape && backup.providerReplacement
      && backup.externalNotify
      && backup.manualExportCompatible && backup.countAfterDisable === backup.countBeforeDisable
      && backup.restoredAfterDisabledWrite && backup.restoredTarget > 0) {
      report.pass.push('STATE-G 本地快照环有界、恢复/关闭开关可逆，导出兼容且 provider 注册边界稳定');
    } else report.fail.push('STATE-G 本地备份边界错误：' + JSON.stringify(backup));
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

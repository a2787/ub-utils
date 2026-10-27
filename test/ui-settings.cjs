/* OmniBlock 设置面板信息架构与操作一致性（OB-UI-001）回归测试。
 * 夹具是人工合成 B站评论 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：分组导航（UI-IA-1）、名单搜索/平台筛选与计数（UI-LIST-1）、
 * 撤销窗口默认 10 秒且可配置（UI-UNDO-1）、最近本地屏蔽操作与撤销
 * （UI-ACTIONS-1）、关键路径自建确认浮层（UI-MODAL-1，含源码级断言）。
 * 运行：node test/ui-settings.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

// 源码级基线（OB-UI-001 之前）：openOptions 一带共 7 处 window.confirm(
// （3 处 AI 提示词/Key 管理 + 退出账户/清空日志/恢复快照/Key 清除），本轮
// 只允许保留 AI 提示词/Key 管理那 4 处；openOptions 函数体内不允许出现
// window.confirm/window.prompt/alert。
const BASELINE_WINDOW_CONFIRM = 7;
const MAX_WINDOW_CONFIRM = 4;

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true, localBackupEnabled:false, logEnabled:false } }) };
window.__nativeDialogs = { confirm: 0, prompt: 0, alert: 0 };
window.confirm = (msg) => { window.__nativeDialogs.confirm++; return true; };
window.prompt = (msg) => { window.__nativeDialogs.prompt++; return ''; };
window.alert = (msg) => { window.__nativeDialogs.alert++; };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name:'本地内容过滤增强', version:'${LOCAL_VERSION}', namespace:'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (o) => { if (o && o.onerror) { try { o.onerror(new Error('no net in test')); } catch(e){} } return { abort(){} }; };
window.GM_openInTab = () => {};
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock 设置面板人工合成回归页</title></head><body>
<bili-comments id="comments"></bili-comments>
<div class="up-detail-top"><a class="up-name" href="//space.bilibili.com/888">设置回归作者</a></div>
<script>
const comments = document.getElementById('comments');
const commentsRoot = comments.attachShadow({mode:'open'});
const style = document.createElement('style');
style.textContent = 'bili-comment-thread-renderer{display:block;min-height:24px;margin:0;padding:0}';
commentsRoot.appendChild(style);
function makeComment(mid, uname) {
  const thread = document.createElement('bili-comment-thread-renderer');
  thread.id = 'comment-' + mid;
  const threadRoot = thread.attachShadow({mode:'open'});
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid: String(mid), member: { mid: String(mid), uname } };
  const root = renderer.attachShadow({mode:'open'});
  const link = document.createElement('a'); link.className = 'user-name'; link.href = '//space.bilibili.com/' + mid; link.textContent = uname;
  const richText = document.createElement('bili-rich-text'); richText.textContent = '人工合成正文 ' + mid;
  const menu = document.createElement('bili-comment-menu'); menu.__data = { member: { mid: String(mid), uname } };
  const menuRoot = menu.attachShadow({mode:'open'});
  const list = document.createElement('ul'); list.id = 'options';
  for (const label of ['加入黑名单', '举报']) { const item = document.createElement('li'); item.textContent = label; list.appendChild(item); }
  menuRoot.appendChild(list);
  root.append(link, richText, menu);
  threadRoot.appendChild(renderer);
  commentsRoot.appendChild(thread);
  return renderer;
}
window.__commentRenderer = (mid) => commentsRoot.querySelector('#comment-' + mid).shadowRoot.querySelector('bili-comment-renderer');
makeComment(111, 'Alice');
makeComment(222, 'Bob');
<\/script>
</body></html>`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };

  // ---- 源码级断言（node 部分，旧源码上必然失败） ----
  const openOptionsStart = USERSCRIPT.indexOf('function openOptions()');
  const openOptionsEnd = USERSCRIPT.indexOf('// 8. 启动', openOptionsStart);
  const openOptionsSource = openOptionsStart >= 0 && openOptionsEnd > openOptionsStart
    ? USERSCRIPT.slice(openOptionsStart, openOptionsEnd) : '';
  const totalConfirm = (USERSCRIPT.match(/window\.confirm\(/g) || []).length;
  const totalAlert = (USERSCRIPT.match(/[^.\w]alert\(/g) || []).length;
  if (openOptionsSource
    && !openOptionsSource.includes('window.confirm(')
    && !openOptionsSource.includes('window.prompt(')
    && !openOptionsSource.includes('alert(')) {
    report.pass.push('UI-SRC-1 openOptions 函数体内不再使用 window.confirm/prompt/alert（改为自建浮层）');
  } else report.fail.push('UI-SRC-1 openOptions 仍使用原生对话框');
  if (totalConfirm <= MAX_WINDOW_CONFIRM && BASELINE_WINDOW_CONFIRM - totalConfirm >= 3) {
    report.pass.push('UI-SRC-2 全源码 window.confirm( 从基线 ' + BASELINE_WINDOW_CONFIRM + ' 处降到 ' + totalConfirm + ' 处（仅保留 AI 提示词/Key 管理）');
  } else report.fail.push('UI-SRC-2 window.confirm( 数量未按要求下降：' + totalConfirm);
  if (totalAlert === 0) report.pass.push('UI-SRC-3 全源码不再使用 alert(');
  else report.fail.push('UI-SRC-3 源码仍存在 alert(：' + totalAlert);
  const snapshotSource = USERSCRIPT.slice(USERSCRIPT.indexOf('function snapshotObject'), USERSCRIPT.indexOf('function snapshotFingerprint'));
  if (USERSCRIPT.includes('omniblock:recent-actions:v1')
    && snapshotSource && !snapshotSource.includes('recent-actions')
    && (USERSCRIPT.match(/omniblock:recent-actions:v1/g) || []).length === 1) {
    report.pass.push('UI-SRC-4 recent-actions 使用独立 GM 键，且不进入 Store 快照/导出序列化');
  } else report.fail.push('UI-SRC-4 recent-actions 存储键边界不成立');

  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
  await page.addInitScript({ content: SHIM + '\nwindow.__OB_TEST_HOOKS__="omniblock-test-only";\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ui-settings.cjs' });

  try {
    await page.goto('https://www.bilibili.com/video/ui-settings-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    // 与 quickblock.cjs 相同：新增/初始评论菜单的本地入口由菜单扫描循环注入；
    // 显式唤醒一次并等待 .ob-quick 出现。
    await page.evaluate(() => window.OB.setupQuickBlock());
    await page.waitForFunction(() => {
      const renderer = window.__commentRenderer && window.__commentRenderer('111');
      return !!(renderer && renderer.shadowRoot.querySelector('bili-comment-menu') &&
        renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick'));
    }, null, { timeout: 10000 });

    // ---- UI-UNDO-1a：默认撤销窗口 10 秒（纯函数 + 设置默认值） ----
    const undoDefault = await page.evaluate(() => ({
      helper: window.OB.ui.undoToastDurationMs(),
      setting: window.OB.Store.getSetting('undoToastSeconds'),
      clamped: (window.OB.Store.setSetting('undoToastSeconds', 99), window.OB.Store.getSetting('undoToastSeconds')),
    }));
    await page.evaluate(() => window.OB.Store.setSetting('undoToastSeconds', 10));
    if (undoDefault.helper === 10000 && undoDefault.setting === 10 && undoDefault.clamped === 30) {
      report.pass.push('UI-UNDO-1a 默认撤销窗口 10000ms；undoToastSeconds 按 5–30 收敛（99→30）');
    } else report.fail.push('UI-UNDO-1a 撤销窗口默认/收敛异常：' + JSON.stringify(undoDefault));

    // ---- UI-ACTIONS-1 + UI-UNDO-1b：快捷拉黑 → 最近操作 → 撤销；默认窗口行为 ≥8s ----
    const quickBlock = await page.evaluate(async () => {
      const renderer = window.__commentRenderer('111');
      const button = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 100));
      const confirm = document.getElementById('ob-confirm');
      if (!confirm) return { confirm: false };
      confirm.querySelector('.ob-ok').click(); await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        confirm: true,
        blocked: window.OB.Index.isBlocked('bili:uid:111'),
        toastShown: !!document.getElementById('ob-toast'),
      };
    });
    if (!(quickBlock.confirm && quickBlock.blocked && quickBlock.toastShown)) {
      report.fail.push('UI-ACTIONS-1 快捷拉黑未完成：' + JSON.stringify(quickBlock));
    }
    // 旧行为 5 秒后 toast 已消失；新默认 10 秒时 8.3s 仍在。
    await wait(8300);
    const toastStillThere = await page.evaluate(() => ({ toast: !!document.getElementById('ob-toast') }));
    await page.waitForFunction(() => !document.getElementById('ob-toast'), null, { timeout: 5000 })
      .then(() => { report.pass.push('UI-UNDO-1b 默认撤销 toast 在 8.3s 时仍在、10s 窗口内消失（旧行为 5s 必失败）'); })
      .catch(() => report.fail.push('UI-UNDO-1b 撤销 toast 未在 10s 窗口后消失'));
    if (toastStillThere.toast) report.pass.push('UI-UNDO-1b 在 8.3s 时 toast 仍然存在（默认 10s 窗口）');
    else report.fail.push('UI-UNDO-1b 8.3s 时 toast 已消失，说明撤销窗口短于 10s');

    // 最近本地屏蔽操作：打开面板检查条目与撤销。
    await page.evaluate(() => window.OB.openOptions());
    await wait(150);
    const recent = await page.evaluate(async () => {
      const wrap = document.querySelector('#ob-recent-actions');
      const entry = wrap && wrap.querySelector('.ob-recent-item');
      const before = {
        wrapPresent: !!wrap,
        entryPresent: !!entry,
        type: entry && entry.dataset.recentType,
        count: entry && entry.dataset.recentCount,
        text: entry && entry.textContent,
        hasUndo: !!(entry && entry.querySelector('.ob-recent-undo')),
        stored: window.OB.recentActions.list().length,
      };
      if (!entry) return before;
      entry.querySelector('.ob-recent-undo').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        ...before,
        blockedAfter: window.OB.Index.isBlocked('bili:uid:111'),
        entriesAfterDom: document.querySelectorAll('#ob-recent-actions .ob-recent-item').length,
        storedAfter: window.OB.recentActions.list().length,
      };
    });
    if (recent.wrapPresent && recent.entryPresent && recent.type === 'quick' && Number(recent.count) === 1
      && recent.hasUndo && recent.stored === 1 && recent.blockedAfter === false
      && recent.entriesAfterDom === 0 && recent.storedAfter === 0) {
      report.pass.push('UI-ACTIONS-1 快捷拉黑后最近操作含 1 条 quick 记录，撤销后身份移出名单且记录删除');
    } else report.fail.push('UI-ACTIONS-1 最近操作/撤销异常：' + JSON.stringify(recent));
    const recentKeyIsolated = await page.evaluate(() => ({
      key: Object.keys(window.__gm).includes('omniblock:recent-actions:v1'),
      exportHasRecent: window.OB.Store.exportJSON().includes('recent-actions'),
    }));
    if (recentKeyIsolated.key && !recentKeyIsolated.exportHasRecent) {
      report.pass.push('UI-ACTIONS-1b recent-actions 落在独立 GM 键，主名单导出不含该数据');
    } else report.fail.push('UI-ACTIONS-1b recent-actions 存储隔离失败：' + JSON.stringify(recentKeyIsolated));

    // ---- UI-UNDO-1c：把窗口调成 5 秒后 toast 提前消失 ----
    await page.evaluate(() => document.querySelector('#ob-panel .ob-close').click());
    await page.evaluate(() => window.OB.Store.setSetting('undoToastSeconds', 5));
    await page.evaluate(async () => {
      const renderer = window.__commentRenderer('222');
      const button = renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 100));
      const confirm = document.getElementById('ob-confirm');
      if (confirm) confirm.querySelector('.ob-ok').click();
    });
    await wait(2000);
    const toastShort1 = await page.evaluate(() => !!document.getElementById('ob-toast'));
    await page.waitForFunction(() => !document.getElementById('ob-toast'), null, { timeout: 6000 })
      .then(() => { report.pass.push('UI-UNDO-1c undoToastSeconds=5 时 toast 在 5s 窗口内消失（2s 时仍可见）'); })
      .catch(() => report.fail.push('UI-UNDO-1c 5 秒窗口未生效'));
    if (!toastShort1) report.fail.push('UI-UNDO-1c 2s 时 toast 已消失，无法证明窗口被测到');
    // 清理 UI-UNDO-1c 写入的身份，保证后续名单计数断言只针对本节种子数据。
    await page.evaluate(() => window.OB.Store.removeIdentities(['bili:uid:222']));

    // ---- UI-LIST-1：名单搜索/平台筛选/计数行/空态 ----
    await page.evaluate(() => {
      window.OB.Store.addIdentities(['bili:uid:700001'], '搜索测试甲', '甲的人工合成备注');
      window.OB.Store.addIdentities(['weibo:uid:700002'], '搜索测试乙', '');
      window.OB.Store.addIdentities(['bili:uid:700003'], 'CaseUser', '');
    });
    await page.evaluate(() => window.OB.openOptions());
    await wait(200);
    const listBase = await page.evaluate(() => ({
      count: document.querySelector('#ob-list-count') && document.querySelector('#ob-list-count').textContent,
      rows: document.querySelectorAll('#ob-list .ob-item').length,
    }));
    const searchFilter = await page.evaluate(async () => {
      const search = document.querySelector('#ob-list-search');
      const platform = document.querySelector('#ob-list-platform');
      const read = () => ({
        count: document.querySelector('#ob-list-count').textContent,
        rows: document.querySelectorAll('#ob-list .ob-item').length,
        empty: document.querySelector('#ob-list .ob-list-empty') && document.querySelector('#ob-list .ob-list-empty').textContent || '',
      });
      const result = {};
      search.value = '700001';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      result.byIdentityKey = read();
      search.value = 'caseuser';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      result.caseInsensitive = read();
      search.value = '不存在ZZZ';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      result.noMatch = read();
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      platform.value = 'weibo';
      platform.dispatchEvent(new Event('change', { bubbles: true }));
      result.weiboOnly = read();
      platform.value = 'all';
      platform.dispatchEvent(new Event('change', { bubbles: true }));
      result.backToAll = read();
      return result;
    });
    if (listBase.count === '显示 3 / 共 3' && listBase.rows === 3) {
      report.pass.push('UI-LIST-1 计数行初始为「显示 3 / 共 3」，逐行渲染 3 条');
    } else report.fail.push('UI-LIST-1 名单初始计数异常：' + JSON.stringify(listBase));
    if (searchFilter.byIdentityKey.count === '显示 1 / 共 3' && searchFilter.byIdentityKey.rows === 1
      && searchFilter.caseInsensitive.rows === 1
      && searchFilter.noMatch.rows === 0 && searchFilter.noMatch.empty.includes('没有匹配的记录')
      && searchFilter.weiboOnly.rows === 1 && searchFilter.weiboOnly.count === '显示 1 / 共 3'
      && searchFilter.backToAll.rows === 3) {
      report.pass.push('UI-LIST-1 身份键搜索、大小写不敏感搜索、空态文案、平台筛选与计数行全部生效');
    } else report.fail.push('UI-LIST-1 搜索/筛选异常：' + JSON.stringify({ searchFilter }));

    // ---- UI-IA-1：分组导航与分组顺序 ----
    const nav = await page.evaluate(async () => {
      const navRow = document.querySelector('#ob-nav');
      const buttons = navRow ? Array.from(navRow.querySelectorAll('button[data-ob-nav-target]')) : [];
      const labels = buttons.map((b) => b.textContent.trim());
      const backup = document.getElementById('ob-group-backup');
      const logs = document.getElementById('ob-group-logs');
      const about = document.getElementById('ob-group-about');
      const order = backup && logs && about
        ? !!(backup.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING)
          && !!(about.compareDocumentPosition(logs) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false;
      const box = document.querySelector('#ob-panel .ob-box');
      const before = box.scrollTop;
      const logsButton = buttons.find((b) => b.textContent.includes('日志诊断'));
      if (logsButton) logsButton.click();
      await new Promise((resolve) => setTimeout(resolve, 900));
      return { navPresent: !!navRow, labels, order, scrolled: box.scrollTop, scrollTopBefore: before };
    });
    if (nav.navPresent && nav.labels.join('|') === '屏蔽与名单|规则|备份与同步|更新与关于|日志诊断'
      && nav.order && nav.scrolled > nav.scrollTopBefore) {
      report.pass.push('UI-IA-1 导航行 5 个分组锚点齐全，日志诊断在备份与同步/更新与关于之后，点击锚点滚动生效');
    } else report.fail.push('UI-IA-1 分组导航异常：' + JSON.stringify(nav));

    // ---- UI-MODAL-1：清空日志路径使用自建浮层，confirm/cancel 都生效 ----
    await page.evaluate(() => {
      const logsButton = document.querySelector('#ob-nav button[data-ob-nav-target="ob-group-logs"]');
      if (logsButton) logsButton.click();
      window.OB.logs.record('ui-settings.modal-fixture', { safeCount: 1 }, { force: true, immediate: true });
    });
    await wait(200);
    const modal = await page.evaluate(async () => {
      const read = () => ({
        modal: !!document.getElementById('ob-modal'),
        message: document.querySelector('#ob-modal .ob-modal-message') && document.querySelector('#ob-modal .ob-modal-message').textContent || '',
      });
      document.getElementById('ob-log-clear').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const opened = read();
      const hasCancel = !!(document.querySelector('#ob-modal .ob-modal-no'));
      const hasOk = !!(document.querySelector('#ob-modal .ob-modal-ok'));
      document.querySelector('#ob-modal .ob-modal-no').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterCancel = read();
      const eventsAfterCancel = window.OB.logs.status().events;
      document.getElementById('ob-log-clear').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      document.querySelector('#ob-modal .ob-modal-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterConfirm = read();
      const eventsAfterConfirm = window.OB.logs.status().events;
      return { opened, hasCancel, hasOk, afterCancel, eventsAfterCancel, afterConfirm, eventsAfterConfirm,
        native: { confirm: window.__nativeDialogs.confirm, prompt: window.__nativeDialogs.prompt, alert: window.__nativeDialogs.alert } };
    });
    if (modal.opened.modal && modal.opened.message.includes('清空本机保存的全部 OmniBlock 运行日志')
      && modal.hasCancel && modal.hasOk && modal.afterCancel.modal === false
      && modal.eventsAfterCancel > 0 && modal.afterConfirm.modal === false && modal.eventsAfterConfirm === 0) {
      report.pass.push('UI-MODAL-1 清空日志打开自建浮层：取消保留日志、确认后日志清空');
    } else report.fail.push('UI-MODAL-1 清空日志浮层异常：' + JSON.stringify(modal));
    if (modal.native.confirm === 0 && modal.native.prompt === 0 && modal.native.alert === 0) {
      report.pass.push('UI-MODAL-1b 本轮全部交互 0 次原生 confirm/prompt/alert');
    } else report.fail.push('UI-MODAL-1b 出现原生对话框调用：' + JSON.stringify(modal.native));

    // 撤销窗口数字输入同步设置（面板内可见控件）。
    await page.evaluate(() => window.OB.Store.setSetting('undoToastSeconds', 10));
    await page.evaluate(() => { const c = document.querySelector('#ob-panel .ob-close'); if (c) c.click(); });
    await page.evaluate(() => window.OB.openOptions()); // 重新打开面板，让输入框读到重置后的默认值
    await wait(150);
    const undoInput = await page.evaluate(() => {
      const input = document.querySelector('#ob-undo-seconds');
      if (!input) return { present: false };
      const initial = input.value;
      input.value = '3';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { present: true, initial, afterLow: input.value, stored: window.OB.Store.getSetting('undoToastSeconds') };
    });
    if (undoInput.present && undoInput.initial === '10' && undoInput.afterLow === '5' && undoInput.stored === 5) {
      report.pass.push('UI-UNDO-1d 面板撤销窗口输入存在，输入 3 被收敛为 5 并写回设置');
    } else report.fail.push('UI-UNDO-1d 撤销窗口输入异常：' + JSON.stringify(undoInput));
  } catch (error) {
    report.fail.push('TEST-RUNNER 异常：' + (error && error.stack || error));
  }

  await browser.close();
  console.log('==== OmniBlock 设置面板信息架构回归（OB-UI-001） ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

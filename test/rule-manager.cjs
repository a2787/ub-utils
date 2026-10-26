/* OmniBlock 关键词/正则规则管理升级（OB-RULE-003）回归测试。
 * 夹具是人工合成 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：规则就地编辑（更新 API、id 迁移、命中计数迁移）、跨平台作用域、
 * 每条规则持久命中计数（落盘/清零/随删除清理）、规则包导入导出、
 * 设置面板规则管理入口与就地编辑 UI、失效文案与死代码清理。
 * 运行：node test/rule-manager.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: false,
    biliDanmakuRules: [], douyinDanmakuRules: [], biliDanmakuExemptions: [], douyinDanmakuExemptions: []
  }
}) };
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = () => ({ abort() {} });
window.GM_openInTab = () => {};
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>规则管理人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_rule_manager_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
</div>
<div id="relatedVideoCard"><div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/RuleFixture">规则夹具作者</a><span>初始引战评论</span></div></div>
</body></html>`;

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('douyin.com')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });
  await page.addInitScript({ content: SHIM + '\nwindow.__OB_TEST_HOOKS__="omniblock-test-only";\n' + USERSCRIPT + '\n//# sourceURL=omniblock-rule-manager.cjs' });
  await page.goto('https://www.douyin.com/video/rule-manager-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.danmakuRules), null, { timeout: 8000 });

  // RULE-EDIT：就地编辑更新类型/内容/备注，id 随内容迁移，匹配即时生效。
  const edit = await page.evaluate(() => {
    const rules = window.OB.danmakuRules;
    const added = rules.add('douyin', 'keyword', '旧关键词');
    if (!added.ok) return { error: 'add failed: ' + added.error };
    const oldId = added.rule.id;
    const updated = rules.update('douyin', oldId, { pattern: '新关键词', note: '测试备注', scope: 'both' });
    const after = rules.rulesFor('douyin');
    return {
      updateOk: updated.ok,
      updateError: updated.error || '',
      count: after.length,
      rule: after[0] || null,
      oldId,
      matchNew: !!rules.match('douyin', '这是新关键词内容的评论'),
      matchOld: !!rules.match('douyin', '这是旧关键词内容的评论'),
    };
  });
  if (edit.updateOk && edit.count === 1 && edit.rule && edit.rule.pattern === '新关键词'
    && edit.rule.note === '测试备注' && edit.rule.scope === 'both' && edit.rule.id !== edit.oldId
    && edit.matchNew && !edit.matchOld) {
    report.pass.push('RULE-EDIT 规则就地编辑生效：内容/备注/作用域更新，id 迁移，匹配即时切换');
  } else report.fail.push('RULE-EDIT 就地编辑异常：' + JSON.stringify(edit));

  // RULE-SCOPE：scope 'both' 参与另一平台匹配；默认/旧规则保持原平台。
  const scope = await page.evaluate(() => {
    const rules = window.OB.danmakuRules;
    const shared = rules.add('bili', 'keyword', '跨平台词');
    const sharedUpdate = rules.update('bili', shared.rule.id, { scope: 'both' });
    const local = rules.add('bili', 'keyword', '仅B站词');
    const biliShared = rules.rulesFor('bili').find((rule) => rule.pattern === '跨平台词');
    const biliLocal = rules.rulesFor('bili').find((rule) => rule.pattern === '仅B站词');
    return {
      sharedUpdateOk: sharedUpdate.ok,
      biliSharedScope: biliShared && biliShared.scope,
      biliLocalScope: biliLocal && biliLocal.scope,
      douyinHitsShared: !!rules.match('douyin', '弹幕里出现跨平台词'),
      douyinHitsLocal: !!rules.match('douyin', '弹幕里出现仅B站词'),
      biliHitsLocal: !!rules.match('bili', '评论里出现仅B站词'),
    };
  });
  if (scope.sharedUpdateOk && scope.biliSharedScope === 'both' && scope.biliLocalScope === 'platform'
    && scope.douyinHitsShared && !scope.douyinHitsLocal && scope.biliHitsLocal) {
    report.pass.push('RULE-SCOPE 跨平台作用域生效：both 规则两平台匹配，默认/旧规则仍只在原平台');
  } else report.fail.push('RULE-SCOPE 作用域异常：' + JSON.stringify(scope));

  // RULE-HITS：匹配递增持久计数；update 迁移；clearHits 清零；remove 清理。
  const hits = await page.evaluate(async () => {
    const rules = window.OB.danmakuRules;
    rules.clearHits('bili');
    rules.match('bili', '评论里出现仅B站词');
    rules.match('bili', '再出现一次仅B站词');
    const localRule = rules.rulesFor('bili').find((rule) => rule.pattern === '仅B站词');
    const countAfterTwo = rules.hitCount('bili', localRule.id);
    const total = rules.totalHits('bili');
    rules.flushHits();
    const persisted = JSON.parse(window.__gm['omniblock:rule-hits:v1'] || '{}');
    const persistedKey = Object.keys(persisted).some((key) => key === 'bili:' + localRule.id);
    const renamed = rules.update('bili', localRule.id, { pattern: '改名后的B站词' });
    const renamedRule = rules.rulesFor('bili').find((rule) => rule.pattern === '改名后的B站词');
    const migratedCount = rules.hitCount('bili', renamedRule.id);
    const migratedPersisted = JSON.parse(window.__gm['omniblock:rule-hits:v1'] || '{}');
    const migratedKeyOk = !!migratedPersisted['bili:' + renamedRule.id] && !migratedPersisted['bili:' + localRule.id];
    rules.clearHits('bili');
    const afterClear = rules.totalHits('bili');
    rules.remove('bili', renamedRule.id);
    const afterRemove = rules.totalHits('bili');
    return {
      countAfterTwo, total, persistedKey, migratedOk: renamed.ok && migratedCount === countAfterTwo && migratedKeyOk,
      afterClear, afterRemove,
    };
  });
  if (hits.countAfterTwo === 2 && hits.total >= 2 && hits.persistedKey
    && hits.migratedOk && hits.afterClear === 0 && hits.afterRemove === 0) {
    report.pass.push('RULE-HITS 命中计数持久化、编辑迁移、清零与删除清理全部生效');
  } else report.fail.push('RULE-HITS 计数异常：' + JSON.stringify(hits));

  // RULE-IO：导出 → 清空 → 导入还原；重复/无效/危险正则被拒并有计数。
  const io = await page.evaluate(() => {
    const rules = window.OB.danmakuRules;
    rules.add('bili', 'keyword', '导出词甲');
    rules.add('douyin', 'regex', '导出正则-\\d+');
    const exported = rules.exportRules();
    const formatOk = exported.format === 'omniblock.danmaku-rules' && exported.version === 1;
    window.OB.Store.setSetting('biliDanmakuRules', []);
    window.OB.Store.setSetting('douyinDanmakuRules', []);
    const imported = rules.importRules(exported);
    const restored = {
      bili: rules.rulesFor('bili').map((rule) => rule.pattern).sort(),
      douyin: rules.rulesFor('douyin').map((rule) => rule.pattern).sort(),
    };
    const again = rules.importRules(exported);
    const bad = rules.importRules({ format: 'omniblock.danmaku-rules', version: 1, rules: {
      bili: [{ kind: 'keyword', pattern: '' }, { kind: 'regex', pattern: '(a+)+' }, { kind: 'keyword', pattern: '导出词甲' }, { kind: 'nonsense', pattern: 'x' }],
      douyin: [],
    } });
    return {
      formatOk, importedOk: imported.ok,
      addedBili: imported.added.bili, addedDouyin: imported.added.douyin,
      restored,
      duplicates: again.duplicates,
      badOk: bad.ok, badInvalid: bad.invalid, badRisky: bad.risky, badDup: bad.duplicates,
    };
  });
  if (io.formatOk && io.importedOk && io.addedBili === 2 && io.addedDouyin === 2
    && JSON.stringify(io.restored) === JSON.stringify({ bili: ['导出词甲', '跨平台词'], douyin: ['导出正则-\\d+', '新关键词'] })
    && io.duplicates === 4 && io.badOk && io.badInvalid === 2 && io.badRisky === 1 && io.badDup === 1) {
    report.pass.push('RULE-IO 规则包导出/导入往返一致；重复、无效、危险正则被拒并可解释');
  } else report.fail.push('RULE-IO 导入导出异常：' + JSON.stringify(io));

  // RULE-UI：设置面板入口打开规则管理浮层；行内“命中”徽标与就地编辑可用。
  await page.evaluate(() => window.OB.openOptions());
  await page.waitForSelector('#ob-panel #ob-open-rules-bili', { timeout: 5000 });
  await page.click('#ob-open-rules-bili');
  await page.waitForSelector('#ob-keyword-manager .ob-auto-rule', { timeout: 5000 });
  const ui = await page.evaluate(() => {
    const overlay = document.querySelector('#ob-keyword-manager');
    const rows = Array.from(overlay.querySelectorAll('.ob-auto-rule'));
    const hitsBadge = rows.some((row) => /命中/.test(row.textContent || ''));
    const introMentionsEdit = /就地编辑/.test((overlay.querySelector('.ob-auto-intro') || {}).textContent || '');
    return { open: !!overlay, rows: rows.length, hitsBadge, introMentionsEdit };
  });
  await page.click('#ob-keyword-manager .ob-auto-rule-edit');
  const editUi = await page.evaluate(() => {
    const row = document.querySelector('#ob-keyword-manager .ob-auto-rule-editing');
    if (!row) return { editing: false };
    const patternInput = row.querySelector('input[type="text"]');
    const noteInput = row.querySelectorAll('input[type="text"]')[1];
    const scopeSelect = row.querySelector('select:nth-of-type(1)');
    patternInput.value = '界面改词';
    noteInput.value = '界面备注';
    scopeSelect.value = 'platform';
    row.querySelector('.ob-auto-rule-save').click();
    const after = Array.from(document.querySelectorAll('#ob-keyword-manager .ob-auto-rule'))
      .some((node) => /界面改词/.test(node.textContent || ''));
    return { editing: true, updated: after };
  });
  await page.keyboard.press('Escape');
  const uiClosed = await page.evaluate(() => !document.querySelector('#ob-keyword-manager'));
  if (ui.open && ui.rows >= 2 && ui.hitsBadge && ui.introMentionsEdit
    && editUi.editing && editUi.updated && uiClosed) {
    report.pass.push('RULE-UI 设置面板入口打开规则管理浮层，命中徽标与就地编辑（内容/备注/作用域）可用');
  } else report.fail.push('RULE-UI 规则管理界面异常：' + JSON.stringify({ ui, editUi, uiClosed }));

  await browser.close();
  console.log('==== OmniBlock 规则管理回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

/* OmniBlock 已屏蔽内容样本库与规则提炼（OB-RULE-004）回归测试。
 * 夹具是人工合成 DOM；本测试不访问真实站点或真实模型。
 * 覆盖：确认拉黑后样本进入独立本机样本库（SAMPLE-1，含去重与 LRU 上限）、
 * 样本转关键词的人工勾选路径（SAMPLE-CONV-1，转换不删样本）、
 * AI 归纳候选二次确认（SAMPLE-AI-1：关键词默认勾选、正则默认不勾选、
 * 危险正则/重复候选在写入时被拒、请求只携带样本正文）、
 * 归纳失败不产生候选与写入（SAMPLE-AI-ERR-1）、
 * 源码级隐私边界（SOURCE-1：样本 GM 键不进快照/同步/导出，事件日志只有计数）。
 * 运行：node test/rule-samples.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4023/v1/chat/completions';

const SHIM = `
window.__gm = {
  'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }),
  'omniblock:data:v1': JSON.stringify({ version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true, showBulkBlock: true,
    localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
    biliDanmakuRules: [], douyinDanmakuRules: [], biliDanmakuExemptions: [], douyinDanmakuExemptions: [],
  } }),
};
window.__aiBodies = [];
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (opts) => {
  try { window.__aiBodies.push(JSON.parse(opts.data || '{}')); } catch (error) {}
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>已屏蔽内容样本人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_rule_samples_fixture" data-e2e="video-player">
  <video id="fixture-video"></video>
</div>
<div id="relatedVideoCard"><div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/SampleFixture">样本夹具作者</a><span>样本夹具评论内容一行</span></div></div>
</body></html>`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 节点侧 mock 的响应模式：'ok' 返回受约束 JSON 候选；'error' 返回 500。
let providerMode = 'ok';

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };

  // ---- SOURCE-1：源码级隐私边界（node 断言） ----
  const samplesKeyLiteralCount = (USERSCRIPT.match(/omniblock:rule-samples:v1/g) || []).length;
  const snapshotSource = USERSCRIPT.slice(
    USERSCRIPT.indexOf('function snapshotObject'),
    USERSCRIPT.indexOf('function snapshotFingerprint'),
  );
  const accountSyncStart = USERSCRIPT.indexOf('const AccountSync = (() => {');
  const accountSyncEnd = USERSCRIPT.indexOf('\n  })();', accountSyncStart);
  const accountSyncSource = accountSyncStart >= 0 && accountSyncEnd > accountSyncStart
    ? USERSCRIPT.slice(accountSyncStart, accountSyncEnd) : '';
  const ruleSamplesModuleStart = USERSCRIPT.indexOf('const RuleSamples = (function () {');
  const ruleSamplesModuleEnd = USERSCRIPT.indexOf('\n  })();', ruleSamplesModuleStart);
  const ruleSamplesModule = ruleSamplesModuleStart >= 0 && ruleSamplesModuleEnd > ruleSamplesModuleStart
    ? USERSCRIPT.slice(ruleSamplesModuleStart, ruleSamplesModuleEnd) : '';
  const outsideLines = USERSCRIPT.split('\n').filter((line, index) => {
    const position = USERSCRIPT.indexOf(line);
    void position;
    return line.includes('RuleSamples') || line.includes('rule-samples');
  }).filter((line) => !ruleSamplesModule.includes(line) || line.includes('exportAll'));
  const sensitiveOutside = outsideLines.filter((line) =>
    /snapshotObject|AccountSync|exportJSON|exportRules|applySyncState|backupSnapshot|captureBackup/.test(line));
  const sampleEventLines = USERSCRIPT.split('\n').filter((line) =>
    /EventLog\.record(Error)?\(\s*'(?:ui\.content-rule\.sample-[a-z-]+|ai\.sample-mining\.[a-z]+)'/.test(line));
  const sampleEventLeak = sampleEventLines.filter((line) =>
    /sample\.text|candidate\.pattern|candidate\.reason|\.text\b|pattern:|reason:/.test(line));
  if (samplesKeyLiteralCount === 1 && snapshotSource && !snapshotSource.includes('rule-samples')
    && !snapshotSource.includes('RuleSamples') && accountSyncSource && !accountSyncSource.includes('RuleSamples')
    && !accountSyncSource.includes('rule-samples') && sensitiveOutside.length === 0) {
    report.pass.push('SOURCE-1 样本 GM 键字面量全源码仅 1 处（模块常量），快照/账户同步/导出路径不引用 RuleSamples');
  } else {
    report.fail.push('SOURCE-1 样本存储边界不成立：' + JSON.stringify({
      samplesKeyLiteralCount, snapshotOk: !!snapshotSource && !snapshotSource.includes('rule-samples'),
      syncOk: !!accountSyncSource && !accountSyncSource.includes('RuleSamples'), sensitiveOutside,
    }));
  }
  if (sampleEventLines.length >= 4 && sampleEventLeak.length === 0) {
    report.pass.push('SOURCE-1 样本/归纳事件日志只携带平台与计数，不含样本正文、候选模式或理由');
  } else {
    report.fail.push('SOURCE-1 事件日志可能携带正文：' + JSON.stringify({ sampleEventLines: sampleEventLines.length, sampleEventLeak }));
  }

  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url() === PROVIDER_URL) {
      if (providerMode === 'error') {
        await route.fulfill({ status: 500, contentType: 'text/plain; charset=utf-8', body: 'mock provider failure' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          keywords: [
            { pattern: '样本归纳关键词', reason: '命中多条样本共性' },
            { pattern: '已存在规则词', reason: '重复候选，用于验证写入去重' },
          ],
          regexes: [{ pattern: '(a+)+', reason: '危险正则候选，用于验证写入拒绝' }],
        }) } }] }),
      });
      return;
    }
    const url = new URL(request.url());
    if (url.hostname.endsWith('douyin.com')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });
  await page.addInitScript({ content: SHIM + '\nwindow.__OB_TEST_HOOKS__="omniblock-test-only";\n' + USERSCRIPT + '\n//# sourceURL=omniblock-rule-samples.cjs' });
  await page.goto('https://www.douyin.com/video/rule-samples-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ruleSamples && window.OB.danmakuRules), null, { timeout: 8000 });

  // ---- SAMPLE-1a：统一评论管理器批量确认拉黑 → 样本进入本机样本库 ----
  const blockFlow = await page.evaluate(async () => {
    const adapter = window.OB.adapters.douyin;
    const infos = window.OB.collectUsers(document, 'comment-manager');
    const expectedText = infos.map((info) => info.text).filter(Boolean)[0] || '';
    window.OB.openContentManager(adapter, 'comments');
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const panel = document.getElementById('ob-comment-manager');
      if (panel && panel.querySelector('.ob-cm-row')) break;
    }
    const panel = document.getElementById('ob-comment-manager');
    if (!panel) return { panel: false };
    const checkAll = panel.querySelector('.ob-cm-checkall input');
    checkAll.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const batch = panel.querySelector('.ob-cm-batch');
    if (!batch || batch.disabled) return { panel: true, batchDisabled: true };
    batch.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const confirm = document.getElementById('ob-confirm');
    if (!confirm) return { panel: true, confirm: false };
    confirm.querySelector('.ob-ok').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      panel: true, confirm: true,
      expectedText,
      blocked: window.OB.Index.isBlocked('douyin:secuid:SampleFixture'),
      samples: window.OB.ruleSamples.list('douyin'),
      storedKey: Object.keys(window.__gm).includes('omniblock:rule-samples:v1'),
      // 名单导出可以包含备注正文（既有设计）；样本库本身必须不可见：
      // 导出既不引用样本存储键，也不包含样本条目 id。
      notInSnapshot: (() => {
        const exported = window.OB.Store.exportJSON();
        const sampleId = (window.OB.ruleSamples.list('douyin')[0] || {}).id || '';
        return !exported.includes('rule-samples') && !(sampleId && exported.includes(sampleId));
      })(),
    };
  });
  if (blockFlow.panel && blockFlow.confirm && blockFlow.blocked
    && blockFlow.samples.length === 1 && blockFlow.samples[0].text === blockFlow.expectedText
    && blockFlow.samples[0].text.includes('样本夹具评论内容一行')
    && blockFlow.storedKey && blockFlow.notInSnapshot) {
    report.pass.push('SAMPLE-1a 批量确认拉黑后样本进入独立 GM 键（正文规范化、平台正确），不进入名单导出');
  } else {
    report.fail.push('SAMPLE-1a 样本未按预期记录：' + JSON.stringify(blockFlow));
  }

  // ---- SAMPLE-1b：重复文本不重复记录并移到队首；LRU 上限 200 ----
  const dedupe = await page.evaluate(() => {
    const samples = window.OB.ruleSamples;
    samples.clear('douyin');
    samples.record('douyin', '重复样本测试文本');
    const first = samples.list('douyin')[0];
    samples.record('douyin', '另一条样本文本');
    samples.record('douyin', '重复样本测试文本');
    const list = samples.list('douyin');
    return {
      length: list.length,
      movedToFront: list[0] && list[0].text === '重复样本测试文本',
      sameId: first && list[0] && first.id === list[0].id,
    };
  });
  if (dedupe.length === 2 && dedupe.movedToFront && dedupe.sameId) {
    report.pass.push('SAMPLE-1b 相同规范化文本不重复记录，命中时移到队首并沿用原条目');
  } else report.fail.push('SAMPLE-1b 去重/移动队首异常：' + JSON.stringify(dedupe));
  const cap = await page.evaluate(() => {
    const samples = window.OB.ruleSamples;
    samples.clear('douyin');
    for (let i = 0; i < 205; i++) {
      samples.record('douyin', '样本库容量测试文本' + String(i).padStart(3, '0'));
    }
    const list = samples.list('douyin');
    let persistedCount = -1;
    try { persistedCount = JSON.parse(window.__gm['omniblock:rule-samples:v1'] || '{}').samples.douyin.length; } catch (e) {}
    return {
      length: list.length,
      oldestDropped: !list.some((item) => item.text === '样本库容量测试文本000'),
      newestFirst: list[0] && list[0].text === '样本库容量测试文本204',
      persistedCount,
    };
  });
  if (cap.length === 200 && cap.oldestDropped && cap.newestFirst && cap.persistedCount === 200) {
    report.pass.push('SAMPLE-1c 样本按平台 LRU 上限 200：超限淘汰最旧，持久化与内存一致');
  } else report.fail.push('SAMPLE-1c 容量上限异常：' + JSON.stringify(cap));

  // ---- SAMPLE-CONV-1：关键词面板样本行渲染；勾选 + 转为关键词；转换不删样本 ----
  await page.evaluate(() => {
    const samples = window.OB.ruleSamples;
    samples.clear('douyin');
    samples.record('douyin', '样本归纳测试样本甲');
    samples.record('douyin', '样本归纳测试样本乙');
    window.OB.closeContentManager && window.OB.closeContentManager();
    window.OB.openContentManager(window.OB.adapters.douyin, 'keywords');
  });
  await page.waitForSelector('#ob-content-manager .ob-rule-sample', { state: 'attached', timeout: 8000 });
  const conv = await page.evaluate(async () => {
    const managerRoot = document.getElementById('ob-content-manager');
    const rows = Array.from(managerRoot.querySelectorAll('.ob-rule-sample'));
    const countText = (managerRoot.querySelector('.ob-rule-sample-count') || {}).textContent || '';
    // 样本按最近记录优先排序：rows[0] 是「乙」，rows[1] 是「甲」。
    const firstCheckbox = rows[0] && rows[0].querySelector('input[type="checkbox"]');
    if (firstCheckbox) firstCheckbox.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rulesBefore = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    const convertButton = managerRoot.querySelector('.ob-rule-sample-convert');
    convertButton.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rulesAfter = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    const rowsAfter = Array.from(managerRoot.querySelectorAll('.ob-rule-sample')).map((row) => row.dataset.sampleText);
    const perRowButton = managerRoot.querySelectorAll('.ob-rule-sample .ob-rule-sample-convert-one')[1];
    if (perRowButton) perRowButton.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rulesFinal = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    return {
      rows: rows.length, countText, rulesBefore, rulesAfter, rowsAfter, rulesFinal,
      sampleStays: rowsAfter.includes('样本归纳测试样本甲') && rowsAfter.includes('样本归纳测试样本乙'),
      aiButtonTitle: (managerRoot.querySelector('.ob-rule-sample-ai') || {}).title || '',
      aiButtonDisabled: !!(managerRoot.querySelector('.ob-rule-sample-ai') || {}).disabled,
    };
  });
  if (conv.rows === 2 && conv.countText === '2'
    && !conv.rulesBefore.includes('样本归纳测试样本乙')
    && conv.rulesAfter.includes('样本归纳测试样本乙') && conv.rulesAfter.length === conv.rulesBefore.length + 1
    && conv.rulesFinal.includes('样本归纳测试样本甲') && conv.rulesFinal.length === conv.rulesBefore.length + 2
    && conv.sampleStays) {
    report.pass.push('SAMPLE-CONV-1 勾选样本 + 「把选中转为关键词」/行内「转为关键词」写入规则表，样本保留不删除');
  } else report.fail.push('SAMPLE-CONV-1 样本转关键词异常：' + JSON.stringify(conv));
  if (!conv.aiButtonDisabled && conv.aiButtonTitle.includes('勾选')) {
    report.pass.push('SAMPLE-CONV-1b AI 配置齐备时「AI 归纳提炼规则」按钮可用，title 说明二次确认边界');
  } else report.fail.push('SAMPLE-CONV-1b AI 按钮门控异常：' + JSON.stringify({ aiButtonDisabled: conv.aiButtonDisabled, aiButtonTitle: conv.aiButtonTitle }));

  // ---- SAMPLE-AI-1：AI 归纳候选二次确认；正则默认不勾选；写入时拒绝危险/重复 ----
  await page.evaluate(() => {
    window.OB.danmakuRules.add('douyin', 'keyword', '已存在规则词');
    window.__aiBodies.length = 0;
  });
  // 样本区在折叠的 <details> 里，统一用 DOM click（JS click 不要求可见性）。
  await page.evaluate(() => document.querySelector('#ob-content-manager .ob-rule-sample-ai').click());
  await page.waitForFunction(() => document.querySelectorAll('#ob-content-manager .ob-rule-sample-candidate').length === 3, null, { timeout: 15000 });
  const aiState = await page.evaluate(() => {
    const managerRoot = document.getElementById('ob-content-manager');
    const rows = Array.from(managerRoot.querySelectorAll('.ob-rule-sample-candidate')).map((row) => {
      const input = row.querySelector('input[type="checkbox"]');
      return {
        kind: input.dataset.candidateKind,
        pattern: input.dataset.candidatePattern,
        checked: input.checked,
      };
    });
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    const userContent = latest.messages && latest.messages[1] && latest.messages[1].content || '';
    const systemContent = latest.messages && latest.messages[0] && latest.messages[0].content || '';
    return {
      rows,
      requestCount: bodies.length,
      userContent,
      systemOk: /只返回一个 JSON 对象/.test(systemContent) && /最多 10 条/.test(systemContent),
      userOnlySamples: userContent.includes('样本归纳测试样本甲') && userContent.includes('样本归纳测试样本乙'),
      noIdentity: !/douyin:secuid|sec_uid|douyin:uid/.test(userContent),
      noUrl: !/https?:\/\//.test(userContent),
      model: latest.model,
    };
  });
  const keywordRowsChecked = aiState.rows.filter((row) => row.kind === 'keyword').every((row) => row.checked);
  const regexRowsUnchecked = aiState.rows.filter((row) => row.kind === 'regex').every((row) => !row.checked);
  if (aiState.requestCount === 1 && aiState.rows.length === 3 && keywordRowsChecked && regexRowsUnchecked
    && aiState.systemOk && aiState.userOnlySamples && aiState.noIdentity && aiState.noUrl) {
    report.pass.push('SAMPLE-AI-1 归纳请求只携带样本正文（无身份键/URL），候选 3 行：关键词默认勾选、正则默认不勾选');
  } else report.fail.push('SAMPLE-AI-1 归纳请求/候选状态异常：' + JSON.stringify(aiState));
  const candidateAdd = await page.evaluate(async () => {
    const managerRoot = document.getElementById('ob-content-manager');
    const before = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    managerRoot.querySelector('.ob-rule-sample-candidate-add').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    // 第二次：只勾选危险正则（取消关键词默认勾选），验证写入被 assessDanmakuRegexRisk 拒绝。
    for (const input of managerRoot.querySelectorAll('.ob-rule-sample-candidate input[type="checkbox"]')) {
      const isRegex = input.dataset.candidateKind === 'regex';
      if (input.checked !== isRegex) input.click();
    }
    managerRoot.querySelector('.ob-rule-sample-candidate-add').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterRisky = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    return { before, after, afterRisky, addedNew: after.includes('样本归纳关键词') };
  });
  if (candidateAdd.before.length === 3
    && candidateAdd.after.length === candidateAdd.before.length + 1
    && candidateAdd.addedNew && candidateAdd.after.includes('已存在规则词')
    && candidateAdd.after.filter((pattern) => pattern === '已存在规则词').length === 1
    && !candidateAdd.after.includes('(a+)+')
    && candidateAdd.afterRisky.length === candidateAdd.after.length
    && !candidateAdd.afterRisky.includes('(a+)+')) {
    report.pass.push('SAMPLE-AI-1b 把选中加入规则：仅新增 1 条；重复候选被去重、危险正则 (a+)+ 被 assessDanmakuRegexRisk 拒绝');
  } else report.fail.push('SAMPLE-AI-1b 候选写入异常：' + JSON.stringify(candidateAdd));

  // ---- SAMPLE-AI-ERR-1：provider 500 → 失败提示，无候选、无写入 ----
  providerMode = 'error';
  const errBefore = await page.evaluate(() => ({
    rules: window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern),
  }));
  await page.evaluate(() => { window.__aiBodies.length = 0; });
  await page.evaluate(() => document.querySelector('#ob-content-manager .ob-rule-sample-ai').click());
  await page.waitForFunction(() => {
    const toast = document.getElementById('ob-toast');
    return !!(toast && /AI 归纳失败/.test(toast.textContent || ''));
  }, null, { timeout: 15000 }).catch(() => {});
  const errState = await page.evaluate((beforeRules) => {
    const managerRoot = document.getElementById('ob-content-manager');
    const toast = document.getElementById('ob-toast');
    const candidateBox = managerRoot.querySelector('.ob-rule-sample-candidate-box');
    const rules = window.OB.danmakuRules.rulesFor('douyin').map((rule) => rule.pattern);
    return {
      toastText: toast ? toast.textContent : '',
      candidatesVisible: !candidateBox.hidden && managerRoot.querySelectorAll('.ob-rule-sample-candidate').length > 0,
      candidateCount: managerRoot.querySelectorAll('.ob-rule-sample-candidate').length,
      rulesUnchanged: JSON.stringify(rules) === JSON.stringify(beforeRules),
      requests: (window.__aiBodies || []).length,
    };
  }, errBefore.rules);
  if (errState.toastText.includes('AI 归纳失败') && !errState.candidatesVisible && errState.candidateCount === 0
    && errState.rulesUnchanged) {
    report.pass.push('SAMPLE-AI-ERR-1 provider 500 时归纳失败给出可读提示，候选清空且未写入任何规则');
  } else report.fail.push('SAMPLE-AI-ERR-1 失败处理异常：' + JSON.stringify({ ...errState, beforeRules: errBefore.rules }));

  // 清理内容弹窗，避免悬挂面板影响后续探针。
  await page.evaluate(() => { window.OB.closeContentManager && window.OB.closeContentManager(); });

  await browser.close();
  // provider 500 是本测试刻意制造的失败路径，浏览器网络层的资源错误属预期噪音。
  report.console = report.console.filter((entry) => !/Failed to load resource.*500/.test(entry));
  console.log('==== OmniBlock 已屏蔽内容样本与规则提炼回归 ====');
  console.log('PASS:', report.pass.length);
  for (const item of report.pass) console.log('  PASS', item);
  console.log('FAIL:', report.fail.length);
  for (const item of report.fail) console.log('  FAIL', item);
  console.log('ERRORS:', JSON.stringify({ pageErrors: report.pageErrors, console: report.console }));
  if (report.fail.length || report.pageErrors.length || report.console.length) process.exitCode = 1;
})();

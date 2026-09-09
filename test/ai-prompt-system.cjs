/* OmniBlock AI 提示词系统回归测试。
 * 夹具说明：B站评论节点和 Shadow DOM 是人工合成，沿用当前适配器契约；
 * 本测试不连接真实模型，使用 Playwright route 模拟 loopback 网关。
 * 覆盖：旧 aiRules 迁移、profile 编辑、三态反馈和理由交互、脱敏导出、
 * 有界相关示例、请求载荷接入、待确认提案生命周期、反馈重算、坏包拒绝和反馈上限。
 * 运行：node test/ai-prompt-system.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const GATEWAY_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: false, aiGatewayUrl: '${GATEWAY_URL}', aiGatewayModel: 'omni-default',
    aiRules: [{ id: 'legacy-rule', text: '旧版不许引战', enabled: true }]
  }
}) };
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
`;

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站 AI 提示词系统人工合成页</title></head><body>
<script>window.__INITIAL_STATE__ = { videoData: { aid: '12345', cid: '67890' } };</script>
<bili-comments id="comments"></bili-comments>
<script>
  const comments = document.getElementById('comments');
  const root = comments.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid: '246', member: { mid: '246', uname: '人工合成作者' } };
  const shadow = renderer.attachShadow({ mode: 'open' });
  const link = document.createElement('a'); link.className = 'user-name'; link.href = 'https://space.bilibili.com/246'; link.textContent = '人工合成作者';
  const body = document.createElement('bili-rich-text');
  const bodyShadow = body.attachShadow({ mode: 'open' });
  const bodyText = document.createElement('p'); bodyText.textContent = '待审核候选内容';
  bodyShadow.appendChild(bodyText);
  shadow.append(link, body); root.appendChild(renderer);
</script>
</body></html>`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
  await page.route('**/*', async (route) => {
    if (route.request().url() === GATEWAY_URL) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      const items = Array.isArray(input.items) ? input.items : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: 1,
          items: items.filter((item) => String(item && item.text || '').includes('待审核候选')).map((item) => ({
            id: item.id, decision: 'block', category: 'synthetic', confidence: 0.91,
            reasonCodes: ['synthetic'], reason: '人工合成候选', evidence: '人工合成正文',
          })),
        }) } }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-ai-prompt-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-ai-prompt-system.cjs' });
  await page.goto('https://www.bilibili.com/video/ai-prompt-system-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai && window.OB.ai.prompt), null, { timeout: 8000 }).catch(() => {});
  await sleep(250);

  const initial = await page.evaluate(() => {
    const prompt = window.OB.ai.prompt;
    const profile = prompt.getProfile();
    const state = prompt.status();
    return { profile, state, schema: prompt.schemaVersion, format: prompt.packageFormat };
  });
  if (initial.profile.blockCriteria.includes('旧版不许引战') && initial.schema === 1
    && initial.format === 'omniblock.ai-prompt-package' && initial.state.positive === 0
    && initial.state.negative === 0 && initial.state.unknown === 0) {
    report.pass.push('PROMPT-1 旧版 aiRules 首次迁移到结构化 PromptProfile');
  } else report.fail.push('PROMPT-1 PromptProfile 迁移/版本异常：' + JSON.stringify(initial));

  await page.evaluate(() => window.OB.openContentManager(window.OB.adapters.bilibili, 'ai'));
  await page.waitForSelector('#ob-content-manager #ob-ai-profile-objective');
  await page.locator('#ob-ai-profile-objective').fill('只在明确满足屏蔽标准时提出候选');
  await page.locator('#ob-ai-profile-block').fill('持续人身攻击\n垃圾广告');
  await page.locator('#ob-ai-profile-allow').fill('仅表达不同观点\n语境不足');
  await page.locator('#ob-ai-profile-save').click();
  const editedProfile = await page.evaluate(() => window.OB.ai.prompt.getProfile());
  if (editedProfile.objective === '只在明确满足屏蔽标准时提出候选'
    && editedProfile.blockCriteria.length === 2 && editedProfile.allowCriteria.length === 2) {
    report.pass.push('PROMPT-2 AI 页面可编辑并保存结构化目标/边界');
  } else report.fail.push('PROMPT-2 profile 编辑结果异常：' + JSON.stringify(editedProfile));

  const profileOnly = await page.evaluate(() => {
    window.OB.Store.setSetting('aiRules', []);
    const status = window.OB.ai.status();
    return { ruleCount: status.ruleCount, criteria: window.OB.ai.prompt.getProfile().blockCriteria };
  });
  if (profileOnly.ruleCount === 2 && profileOnly.criteria.length === 2) {
    report.pass.push('PROMPT-2A 仅使用新 PromptProfile 屏蔽边界也能作为 AI 有效规则');
  } else report.fail.push('PROMPT-2A profile 未成为有效规则来源：' + JSON.stringify(profileOnly));

  const directFeedback = await page.evaluate(() => {
    const prompt = window.OB.ai.prompt;
    const positive = prompt.recordFeedback({
      platform: 'bilibili', kind: 'comment', text: '手动漏识别样本', label: 'positive', source: 'manual_miss',
      keys: ['bili:uid:123'], url: 'https://www.bilibili.com/video/secret', authorName: '不应进入模型的昵称',
    });
    const unknown = prompt.recordFeedback({
      platform: 'bilibili', kind: 'comment', text: '关闭审核样本', label: 'unknown', source: 'review_closed',
    });
    return { positive, unknown, status: prompt.status() };
  });
  if (directFeedback.positive.ok && directFeedback.unknown.ok
    && directFeedback.status.positive === 1 && directFeedback.status.unknown === 1) {
    report.pass.push('PROMPT-3 正反馈与 unknown 审计事件分开记录，未触碰主名单');
  } else report.fail.push('PROMPT-3 三态反馈记录异常：' + JSON.stringify(directFeedback));

  const reasonOpened = await page.evaluate(() => window.OB.ai.prompt.askReason({
    record: { platform: 'bilibili', kind: 'comment', text: '理由交互误识别样本' },
    label: 'negative', source: 'ai_rejected',
  }).ok);
  if (reasonOpened) {
    await page.locator('#ob-ai-feedback button[data-reason-code="context"]').click();
    await page.locator('#ob-ai-feedback .ob-ai-feedback-note').fill('人工合成测试备注');
    await page.locator('#ob-ai-feedback .ob-ai-feedback-save').click();
  }
  const reasonState = await page.evaluate(() => {
    const data = JSON.parse(window.OB.ai.prompt.exportJSON());
    return data.feedback.negative.find((item) => item.text === '理由交互误识别样本') || null;
  });
  if (reasonOpened && reasonState && reasonState.reasonCode === 'context' && reasonState.note === '人工合成测试备注') {
    report.pass.push('PROMPT-4 负反馈“不屏蔽”可登记受控理由和短备注');
  } else report.fail.push('PROMPT-4 理由交互未保存：' + JSON.stringify(reasonState));

  const rendered = await page.evaluate(() => window.OB.ai.prompt.render({
    platform: 'bilibili', records: [{ kind: 'comment', text: '待审核候选内容' }],
  }));
  const renderedText = JSON.stringify(rendered);
  if (rendered.system.length <= 7200 && rendered.examples.length <= 8
    && rendered.examples.some((item) => item.label === 'positive')
    && rendered.examples.some((item) => item.label === 'negative')
    && !/bili:uid:123|space\.bilibili\.com\/secret|不应进入模型的昵称/.test(renderedText)
    && /只读反馈证据/.test(rendered.system)) {
    report.pass.push('PROMPT-5 提示词只渲染有界相关反馈，身份/URL/昵称未进入模型输入');
  } else report.fail.push('PROMPT-5 提示词渲染边界异常：' + renderedText.slice(0, 1800));

  await page.evaluate(() => window.OB.Store.setSetting('aiEnabled', true));
  await page.waitForFunction(() => (window.__aiBodies || []).length >= 1, null, { timeout: 5000 }).catch(() => {});
  const requestShape = await page.evaluate(() => {
    const body = (window.__aiBodies || [])[0] || {};
    let input = {};
    try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
    return {
      hasPromptVersion: input.promptSchemaVersion === 1,
      hasProfile: !!(input.profile && input.profile.objective),
      hasExamples: Array.isArray(input.examples),
      items: input.items || [],
      body: JSON.stringify(body),
    };
  });
  if (requestShape.hasPromptVersion && requestShape.hasProfile && requestShape.hasExamples
    && requestShape.items.length === 1 && !/bili:uid|space\.bilibili|authorName|不应进入模型的昵称/.test(requestShape.body)) {
    report.pass.push('PROMPT-6 结构化提示词已接入实际 AI 请求载荷，仍不携带身份字段');
  } else report.fail.push('PROMPT-6 AI 请求载荷异常：' + JSON.stringify(requestShape));

  await page.waitForSelector('#ob-ai-review .ob-ai-reject', { timeout: 5000 }).catch(() => {});
  if (await page.locator('#ob-ai-review .ob-ai-reject').count()) {
    await page.locator('#ob-ai-review .ob-ai-reject').click();
    await page.locator('#ob-ai-feedback button[data-reason-code="context"]').click();
    await page.locator('#ob-ai-feedback .ob-ai-feedback-save').click();
  }
  const rejected = await page.evaluate(() => {
    const data = JSON.parse(window.OB.ai.prompt.exportJSON());
    return data.feedback.negative.find((item) => item.text === '待审核候选内容') || null;
  });
  if (rejected && rejected.source === 'ai_rejected' && rejected.label === 'negative') report.pass.push('PROMPT-7 AI 审核“不屏蔽”会生成负反馈，不写入名单');
  else report.fail.push('PROMPT-7 AI 候选拒绝反馈异常：' + JSON.stringify(rejected));

  const proposalSeed = await page.evaluate(() => {
    const prompt = window.OB.ai.prompt;
    prompt.recordFeedback({ platform: 'bilibili', kind: 'comment', text: '人工合成攻击样本一', label: 'positive', source: 'manual_miss', reasonCode: 'harassment' });
    prompt.recordFeedback({ platform: 'bilibili', kind: 'comment', text: '人工合成攻击样本二', label: 'positive', source: 'manual_miss', reasonCode: 'harassment' });
    const state = prompt.getPersonalization();
    const pending = state.pending.find((item) => item.reasonCode === 'harassment') || null;
    return {
      pending,
      accepted: state.accepted.length,
      status: prompt.status(),
      uiPending: !!document.querySelector('#ob-ai-prompt-pending .ob-ai-prompt-card')
        && /支持 2/.test(document.querySelector('#ob-ai-prompt-pending').textContent || '')
        && !!document.querySelector('#ob-ai-prompt-recompute'),
    };
  });
  if (proposalSeed.pending && proposalSeed.pending.supportCount === 2 && proposalSeed.pending.status === 'pending'
    && proposalSeed.accepted === 0 && proposalSeed.status.pendingPreferences >= 1 && proposalSeed.uiPending) {
    report.pass.push('PROMPT-10 明确理由达到阈值后只生成待确认提案，管理界面可见且不自动进入有效提示词');
  } else report.fail.push('PROMPT-10 个性化提案生成异常：' + JSON.stringify(proposalSeed));

  const lifecycle = await page.evaluate(() => {
    const prompt = window.OB.ai.prompt;
    const pending = prompt.getPersonalization().pending.find((item) => item.reasonCode === 'harassment');
    const accepted = prompt.acceptPreference(pending && pending.id);
    const acceptedState = prompt.getPersonalization();
    const acceptedInPrompt = prompt.render({ platform: 'bilibili', records: [{ kind: 'comment', text: '人工合成攻击样本一' }] })
      .profile.acceptedPreferences.some((text) => text.includes('骚扰/攻击'));
    const disabled = prompt.setPreferenceEnabled(pending && pending.id, false);
    const disabledInPrompt = prompt.render({ platform: 'bilibili', records: [] }).profile.acceptedPreferences.some((text) => text.includes('骚扰/攻击'));
    prompt.setPreferenceEnabled(pending && pending.id, true);
    const deleted = prompt.deletePreference(pending && pending.id);
    const deletedState = prompt.getPersonalization();
    const resumed = prompt.resumePreference(pending && pending.id);
    const resumedState = prompt.getPersonalization();
    const rejectedAgain = prompt.rejectPreference(pending && pending.id);
    const rejectedState = prompt.getPersonalization();
    const eventIds = prompt.getFeedback(50).filter((event) => event.reasonCode === 'harassment').map((event) => event.id);
    const removed = prompt.deleteFeedback(eventIds[0]);
    const afterRemoval = prompt.getPersonalization();
    return {
      accepted: !!accepted.ok && acceptedState.accepted.some((item) => item.id === pending.id),
      acceptedInPrompt, disabled: !!disabled.ok && disabledInPrompt === false,
      deleted: !!deleted.ok && deletedState.accepted.every((item) => item.id !== pending.id)
        && deletedState.dismissed.some((item) => item.id === pending.id && item.status === 'deleted'),
      resumed: !!resumed.ok && resumedState.pending.some((item) => item.id === pending.id),
      rejected: !!rejectedAgain.ok && rejectedState.pending.every((item) => item.id !== pending.id)
        && rejectedState.dismissed.some((item) => item.id === pending.id && item.status === 'rejected'),
      removed: !!removed.ok && !afterRemoval.pending.some((item) => item.id === pending.id)
        && !afterRemoval.dismissed.some((item) => item.id === pending.id),
    };
  });
  if (lifecycle.accepted && lifecycle.acceptedInPrompt && lifecycle.disabled && lifecycle.deleted
    && lifecycle.resumed && lifecycle.rejected && lifecycle.removed) {
    report.pass.push('PROMPT-11 提案接受/停用/删除/恢复/拒绝与反馈删除后的重算均无幽灵状态');
  } else report.fail.push('PROMPT-11 提案生命周期异常：' + JSON.stringify(lifecycle));

  const beforeInvalid = await page.evaluate(() => window.OB.ai.prompt.exportJSON());
  const invalid = await page.evaluate(() => {
    try { window.OB.ai.prompt.importJSON(JSON.stringify({ format: 'omniblock.ai-prompt-package', schemaVersion: 999 })); return false; }
    catch (error) { return true; }
  });
  const afterInvalid = await page.evaluate(() => window.OB.ai.prompt.exportJSON());
  if (invalid && beforeInvalid === afterInvalid) report.pass.push('PROMPT-8 未知 schema 导入被拒绝且本地包保持不变');
  else report.fail.push('PROMPT-8 坏提示词包处理异常');

  const bounded = await page.evaluate(() => {
    const events = Array.from({ length: 700 }, (_, index) => ({
      platform: 'bilibili', kind: 'comment', label: 'positive', source: 'manual_miss',
      text: '超长反馈样本-' + index,
    }));
    window.OB.ai.prompt.importJSON(JSON.stringify({
      format: 'omniblock.ai-prompt-package', schemaVersion: 1,
      profile: { objective: '边界测试', blockCriteria: [], allowCriteria: [] },
      feedback: { positive: events, negative: [], unknown: [] },
      personalization: { accepted: [], pending: [] },
    }));
    const status = window.OB.ai.prompt.status();
    const rendered = window.OB.ai.prompt.render({ platform: 'bilibili', records: [{ kind: 'comment', text: '超长反馈样本-699' }] });
    return { status, examples: rendered.examples.length, systemLength: rendered.system.length };
  });
  if (bounded.status.positive <= 500 && bounded.examples <= 8 && bounded.systemLength <= 7200) report.pass.push('PROMPT-9 导入反馈、相关示例和提示词文本均受上限约束');
  else report.fail.push('PROMPT-9 上限未生效：' + JSON.stringify(bounded));

  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('AI PROMPT TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

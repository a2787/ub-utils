/*
 * AI 事实核查接入回归：默认 off 不请求 broker；canary 只在收到受限来源后
 * 发起第二轮事实判断，并继续停在人工审核层。页面、身份和来源均为人工合成。
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const GATEWAY_URL = 'http://127.0.0.1:4000/v1/chat/completions';
const FACT_URL = 'http://127.0.0.1:4001/v1/fact-check';
const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version: 1, persons: {}, settings: {
  enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
  showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
  aiEnabled: false, aiGatewayUrl: '${GATEWAY_URL}', aiGatewayModel: 'omni-default', aiRules: [{ id: 'synthetic-rule', text: '明确事实性错误需要核查', enabled: true }],
  aiFactRetrievalMode: 'off', aiFactRetrievalUrl: '${FACT_URL}'
}}) };
window.__aiBodies = []; window.__factBodies = [];
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {}; window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '0.54.0', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (opts) => {
  try { const body = JSON.parse(opts.data || '{}'); if (String(opts.url).includes('/fact-check')) window.__factBodies.push(body); else window.__aiBodies.push(body); } catch (error) {}
  fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (opts.onload) opts.onload(response); })
    .catch((error) => { if (opts.onerror) opts.onerror(error); });
  return { abort() {} };
};
`;
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>人工合成事实核查页</title></head><body>
<bili-comments id="comments"></bili-comments>
<script>
  const comments = document.getElementById('comments'); const root = comments.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid: '246', member: { mid: '246', uname: '人工合成作者' } };
  const shadow = renderer.attachShadow({ mode: 'open' });
  const link = document.createElement('a'); link.className = 'user-name'; link.href = 'https://space.bilibili.com/246'; link.textContent = '人工合成作者';
  const body = document.createElement('span'); body.className = 'text'; body.textContent = '人工合成事实主张待核查'; shadow.append(link, body); root.appendChild(renderer);
</script></body></html>`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], pageErrors: [], console: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push(message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error && error.stack || error)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === FACT_URL) {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
      const claims = Array.isArray(body.claims) ? body.claims : [];
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({
        schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', items: claims.map((claim) => ({
          id: claim.id, status: 'contradicted', method: 'local_allowlist',
          sources: [{ sourceId: 'synthetic-official', sourceTier: 'official', title: '人工合成官方来源', snippet: '人工合成矛盾摘要 https://source.invalid/private 123456789', publishedAt: '2026-01-01', verdict: 'contradicted' }],
        })),
      }) });
      return;
    }
    if (url === GATEWAY_URL) {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
      let input = {}; try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      const hasSources = Array.isArray(input.verificationSources) && input.verificationSources.some((item) => item.sources && item.sources.length);
      const items = Array.isArray(input.items) ? input.items : [];
      const output = items.map((item) => hasSources ? ({
        id: item.id, decision: 'block', claimType: 'factual_claim', verificationStatus: 'contradicted',
        verificationMethod: 'external_source', ruleMatched: true, confidence: 0.9,
        reasonCodes: ['synthetic-fact'], reason: '人工合成规则与来源摘要共同满足', evidence: '人工合成矛盾摘要',
      }) : ({
        id: item.id, decision: 'uncertain', claimType: 'factual_claim', verificationStatus: 'not_checked',
        verificationMethod: 'none', ruleMatched: true, confidence: 0.5, reasonCodes: [], reason: '尚未核查', evidence: '',
      }));
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, items: output }) } }] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-ai-fact-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-ai-fact-integration.cjs' });
  await page.goto('https://www.bilibili.com/video/ai-fact-integration-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai), null, { timeout: 8000 });
  const defaultState = await page.evaluate(() => window.OB.ai.status().factRetrieval);
  if (defaultState && defaultState.mode === 'off') report.pass.push('FACT-1 新安装默认 off，不启用事实核查请求');
  else report.fail.push('FACT-1 默认事实核查模式异常：' + JSON.stringify(defaultState));
  await page.evaluate(async () => {
    window.OB.Store.setSetting('aiFactRetrievalMode', 'canary');
    window.OB.Store.setSetting('aiFactRetrievalUrl', 'http://127.0.0.1:4001/v1/fact-check');
    window.OB.Store.setSetting('aiEnabled', true);
    window.OB.ai.cancel('integration-test');
    window.__factAnalyzeResult = await window.OB.ai.analyzePage('本页只处理人工合成事实错误');
    return window.__factAnalyzeResult;
  });
  await page.waitForFunction(() => (window.__factBodies || []).length >= 1 && (window.__aiBodies || []).length >= 2, null, { timeout: 8000 });
  await page.waitForSelector('#ob-ai-review', { timeout: 5000 }).catch(() => {});
  const result = await page.evaluate(() => {
    const bodies = window.__aiBodies || []; const first = bodies[0] || {}; const last = bodies[bodies.length - 1] || {};
    let firstInput = {}; let lastInput = {}; let fact = {};
    try { firstInput = JSON.parse(first.messages[1].content); } catch (error) {}
    try { lastInput = JSON.parse(last.messages[1].content); } catch (error) {}
    try { fact = window.__factBodies[0] || {}; } catch (error) {}
    const store = String(window.__gm && window.__gm['omniblock:data:v1'] || '');
    return {
      aiCalls: bodies.length, factCalls: (window.__factBodies || []).length,
      firstHasSources: !Array.isArray(firstInput.verificationSources) || firstInput.verificationSources.length === 0,
      lastHasSources: Array.isArray(lastInput.verificationSources) && lastInput.verificationSources.some((item) => item.sources && item.sources.length),
      factHasOnlyClaims: Array.isArray(fact.claims) && fact.claims.every((item) => /^c\d+$/.test(item.id)),
      leakedIdentity: /bili:(?:uid|dmhash)|space\.bilibili|人工合成作者|mid|hash|cookie|token|source\.invalid|\d{8,}/i.test(JSON.stringify({ firstInput, lastInput, fact })),
      reviewCandidates: document.querySelectorAll('#ob-ai-review .ob-ai-candidate').length,
      storeHasIdentity: /bili:(?:uid|dmhash):/.test(store),
      status: window.OB.ai.status().factRetrieval,
    };
  });
  if (result.aiCalls >= 2 && result.factCalls === 1 && result.firstHasSources && result.lastHasSources && result.factHasOnlyClaims && !result.leakedIdentity) report.pass.push('FACT-2 Canary 先分类再按 ordinal claim id 请求 broker，未携带身份或 URL');
  else report.fail.push('FACT-2 事实核查请求边界异常：' + JSON.stringify(result));
  if (result.reviewCandidates === 1 && result.status && result.status.checked >= 1 && !result.storeHasIdentity) report.pass.push('FACT-3 受限矛盾来源只生成一个待人工审核候选，未自动写入名单');
  else report.fail.push('FACT-3 Canary 候选/人工确认门禁异常：' + JSON.stringify(result));
  await page.evaluate(async () => {
    window.OB.ai.closeReview();
    window.OB.Store.setSetting('aiFactRetrievalMode', 'shadow');
    window.OB.ai.cancel('shadow-integration-test');
    await window.OB.ai.analyzePage('本页只处理人工合成事实错误');
  });
  await sleep(150);
  const shadow = await page.evaluate(() => ({
    status: window.OB.ai.status().factRetrieval,
    aiReview: !!document.querySelector('#ob-ai-review'),
    state: window.OB.ai.status().state,
  }));
  if (shadow.status && shadow.status.mode === 'shadow' && shadow.status.checked >= 1 && !shadow.aiReview && shadow.state === 'ready') report.pass.push('FACT-4 Shadow 完成核查观测但不改变候选、不弹人工审核');
  else report.fail.push('FACT-4 Shadow 隔离异常：' + JSON.stringify(shadow));
  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => { console.error('AI FACT INTEGRATION ERROR:', error && error.stack || error); process.exitCode = 1; });

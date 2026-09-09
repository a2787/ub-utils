/* OmniBlock AI 提示词离线评测。
 * 夹具说明：全部评论正文、作者和身份均为人工合成数据；DOM 形态沿用当前
 * B站评论适配器契约。网关返回的是人工合成 gold oracle，不连接 DeepSeek，
 * 因此本文件评估的是提示词系统的请求边界和结果解析链路，不是模型语义准确率。
 * 覆盖：block/allow/uncertain gold 集、事实性“未核查”误判隔离、TP/FP/FN、
 * 提示词预算、示例去重和身份脱敏。
 * 运行：node test/ai-prompt-eval.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const GATEWAY_URL = 'http://127.0.0.1:4000/v1/chat/completions';
const SYNTHETIC_ITEMS = [
  ['人工合成攻击样本甲', 'block'],
  ['人工合成广告样本乙', 'block'],
  ['人工合成歧视样本丙', 'block'],
  ['人工合成剧透样本丁', 'block'],
  ['人工合成已核查矛盾事实', 'block'],
  ['人工合成正常问候', 'allow'],
  ['人工合成不同观点', 'allow'],
  ['人工合成引用原句', 'allow'],
  ['人工合成语境充分的玩笑', 'allow'],
  ['人工合成语境不明样本甲', 'uncertain'],
  ['人工合成反讽不明样本乙', 'uncertain'],
  ['人工合成短句不明样本丙', 'uncertain'],
  ['人工合成方言不明样本丁', 'uncertain'],
];
const GOLD = new Map(SYNTHETIC_ITEMS);

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiGatewayUrl: '${GATEWAY_URL}', aiGatewayModel: 'omni-default',
    aiRules: [{ id: 'ai-eval-rule', text: '按人工合成评测标准识别需要审核的内容', enabled: true }]
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

const fixtureItems = SYNTHETIC_ITEMS.map(([text], index) => `
  const item${index} = document.createElement('bili-comment-renderer');
  item${index}.__data = { mid: '${100 + index}', member: { mid: '${100 + index}', uname: '人工合成作者${index}' } };
  const shadow${index} = item${index}.attachShadow({ mode: 'open' });
  const link${index} = document.createElement('a'); link${index}.className = 'user-name'; link${index}.href = 'https://space.bilibili.com/${100 + index}'; link${index}.textContent = '人工合成作者${index}';
  const body${index} = document.createElement('bili-rich-text');
  const bodyShadow${index} = body${index}.attachShadow({ mode: 'open' });
  const bodyText${index} = document.createElement('p'); bodyText${index}.textContent = ${JSON.stringify(text)}; bodyShadow${index}.appendChild(bodyText${index});
  shadow${index}.append(link${index}, body${index}); commentsRoot.appendChild(item${index});`).join('\n');
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>B站 AI 提示词人工合成离线评测</title></head><body>
<script>window.__INITIAL_STATE__ = { videoData: { aid: '12345', cid: '67890' } };</script>
<bili-comments id="comments"></bili-comments>
<script>
  const commentsRoot = document.getElementById('comments').attachShadow({ mode: 'open' });
  ${fixtureItems}
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
    const request = route.request();
    if (request.url() === GATEWAY_URL) {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch (error) {}
      let input = {};
      try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: 1,
          items: (Array.isArray(input.items) ? input.items : []).flatMap((item) => {
            const label = GOLD.get(String(item && item.text || ''));
            if (label === 'uncertain') return [{
              id: item.id, decision: 'block', claimType: 'factual_claim', verificationStatus: 'not_checked',
              verificationMethod: 'none', ruleMatched: true, confidence: 0.93,
              reasonCodes: ['unverified'], reason: '未经证实，缺少可核实依据', evidence: '',
            }];
            if (label !== 'block') return [];
            const verified = String(item && item.text || '').includes('已核查');
            return [{
              id: item.id, decision: 'block', claimType: verified ? 'factual_claim' : 'policy_violation',
              verificationStatus: verified ? 'contradicted' : 'not_applicable',
              verificationMethod: verified ? 'external_source' : 'none', ruleMatched: true,
              category: 'synthetic-gold', confidence: 0.88,
              reasonCodes: ['synthetic'], reason: '人工合成 gold oracle', evidence: verified ? '人工合成核查摘要' : '人工合成评测标签',
            }];
          }),
        }) } }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  });
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-ai-prompt-eval-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-ai-prompt-eval.cjs' });
  await page.goto('https://www.bilibili.com/video/ai-prompt-eval-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai && window.OB.ai.prompt), null, { timeout: 8000 }).catch(() => {});
  await sleep(250);
  await page.evaluate(() => window.OB.ai.cancel('offline-eval-setup'));
  const result = await page.evaluate(() => window.OB.ai.analyzePage('人工合成离线评测附加规则'));
  await page.waitForSelector('#ob-ai-review', { timeout: 5000 }).catch(() => {});
  const observed = await page.evaluate(() => {
    const body = (window.__aiBodies || [])[0] || {};
    let input = {};
    try { input = JSON.parse(body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
    const rows = Array.from(document.querySelectorAll('#ob-ai-review .ob-ai-candidate-text')).map((node) => node.textContent);
    const examples = Array.isArray(input.examples) ? input.examples : [];
    const exampleKeys = examples.map((item) => [item.label, item.kind, item.text].join('\x1f'));
    return {
      body,
      input,
      rows,
      systemLength: String(body.messages && body.messages[0] && body.messages[0].content || '').length,
      duplicateExamples: exampleKeys.length - new Set(exampleKeys).size,
      feedbackLimit: window.OB.ai.prompt.status().feedbackLimit,
      deferred: window.OB.ai.status().deferred,
    };
  });
  const goldBlock = SYNTHETIC_ITEMS.filter(([, label]) => label === 'block').map(([text]) => text);
  const goldAllow = SYNTHETIC_ITEMS.filter(([, label]) => label === 'allow').map(([text]) => text);
  const goldUncertain = SYNTHETIC_ITEMS.filter(([, label]) => label === 'uncertain').map(([text]) => text);
  const predicted = observed.rows;
  const goldSet = new Set(goldBlock);
  const predictedSet = new Set(predicted);
  const tp = predicted.filter((text) => goldSet.has(text)).length;
  const fp = predicted.filter((text) => !goldSet.has(text)).length;
  const fn = goldBlock.filter((text) => !predictedSet.has(text)).length;
  const uncertainBlocked = goldUncertain.filter((text) => predictedSet.has(text)).length;
  const serialized = JSON.stringify(observed.body);
  const leakage = /bili:(?:uid|dmhash)|space\.bilibili|authorName|"keys"|"mid"|"hash"|cookie/i.test(serialized);
  const shapeOk = observed.input.promptSchemaVersion === 1
    && Array.isArray(observed.input.items) && observed.input.items.length === SYNTHETIC_ITEMS.length
    && observed.input.items.every((item) => item && item.id && item.kind && item.text)
    && Array.isArray(observed.input.examples);
  if (result && result.ok && shapeOk) report.pass.push('EVAL-1 人工合成 gold 请求包含稳定项目 ID、kind、正文和提示词版本');
  else report.fail.push('EVAL-1 请求形态异常：' + JSON.stringify({ result, shapeOk, itemCount: observed.input.items && observed.input.items.length }));
  if (tp === goldBlock.length && fp === 0 && fn === 0 && uncertainBlocked === 0
    && observed.deferred === goldUncertain.length
    && observed.rows.includes('人工合成已核查矛盾事实')) {
    report.pass.push('EVAL-2 mock gold oracle 分类指标 TP=' + tp + ' FP=' + fp + ' FN=' + fn + '，不误杀未核查事实并保留有依据矛盾事实');
  } else report.fail.push('EVAL-2 分类指标异常：' + JSON.stringify({ tp, fp, fn, uncertainBlocked, deferred: observed.deferred, goldAllow: goldAllow.length, result, rows: observed.rows, inputItems: observed.input.items, status: await page.evaluate(() => window.OB.ai.status()) }));
  if (observed.systemLength <= 7200 && observed.input.examples.length <= 8 && observed.duplicateExamples === 0) {
    report.pass.push('EVAL-3 system/examples 遵守长度和数量预算，示例没有重复');
  } else report.fail.push('EVAL-3 提示词预算或示例去重异常：' + JSON.stringify({ systemLength: observed.systemLength, examples: observed.input.examples.length, duplicateExamples: observed.duplicateExamples }));
  if (!leakage) report.pass.push('EVAL-4 发往网关的人工合成请求未携带身份键、个人主页、Cookie 或原始作者字段');
  else report.fail.push('EVAL-4 请求出现身份字段泄漏：' + serialized.slice(0, 1800));
  if (observed.feedbackLimit === 500) report.pass.push('EVAL-5 评测运行仍受反馈账本上限约束');
  else report.fail.push('EVAL-5 反馈上限异常：' + observed.feedbackLimit);
  await page.evaluate(() => window.OB.ai.closeReview());
  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('AI PROMPT EVAL ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

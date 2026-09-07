/* OmniBlock AI 多平台采集回归测试。
 * 夹具说明：抖音评论/弹幕结构来自仓库已记录的真实属性片段，但页面是人工合成；
 * 本测试不访问真实站点或真实模型，使用 Playwright route 模拟 loopback Chat Completions。
 * 覆盖：抖音评论与当前视频弹幕统一采集、身份键不出站、无身份候选只读、同 URL 换片
 * 清空 AI 会话缓存，以及普通弹幕属性变化不触发重复分析。
 * 运行：node test/ai-platforms.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const GATEWAY_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: true,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiGatewayUrl: '${GATEWAY_URL}', aiGatewayModel: 'omni-default',
    aiRules: [{ id: 'ai-douyin-repro', text: '不许引战', enabled: true }]
  }
}) };
window.__writes = 0;
window.GM_getValue = (k, d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k, v) => { window.__gm[k] = v; if (k === 'omniblock:data:v1') window.__writes++; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${LOCAL_VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.__aiBodies = [];
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

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>抖音 AI 人工合成回归页</title></head><body>
<div id="dy-player" class="basePlayerContainer video_1111111111111111111" data-e2e="video-player" style="display:block">
  <a data-e2e="video-avatar" href="/user/MS4wLjABAAAuthor">人工合成作者</a>
  <div class="danmu" style="display:block">
    <div id="dy-ai-dm-one" data-danmu-id="ai-dm-one" data-is-danmu-author="false" data-danmaku-user-id="7654321"><div class="danMuText">引战弹幕甲</div><span>喜欢</span><span>举报</span><span>回复</span></div>
    <div id="dy-ai-dm-unknown" data-danmu-id="ai-dm-unknown"><div class="danMuText">引战弹幕（无身份）</div></div>
  </div>
</div>
<div data-e2e="comment-item" id="dy-ai-comment"><a data-e2e="comment-username" href="/user/MS4wLjABAAComment">评论作者</a><span>引战评论甲</span><div class="comment-item-stats-container"><div>分享</div><div tabindex="0">回复</div><button type="button" class="comment-reply-expand-btn">展开1条回复</button></div></div>
<div data-e2e="comment-item" id="dy-ai-comment-body-text"><span>正文里喜欢回复举报但不是控件</span></div>
</body></html>`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const report = { pass: [], fail: [], console: [], pageErrors: [] };
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') report.console.push('[' + message.type() + '] ' + message.text()); });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
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
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            items: (Array.isArray(input.items) ? input.items : []).filter((item) => String(item && item.text || '').includes('引战')).map((item) => ({
              id: item.id, decision: 'block', confidence: 0.91, reason: '命中人工合成回归规则',
            })),
          }) } }],
        }),
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
  await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT + '\n//# sourceURL=omniblock-ai-platforms.cjs' });
  await page.goto('https://www.douyin.com/video/ai-platforms-fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.ai && document.querySelector('#ob-gear')), null, { timeout: 8000 }).catch(() => {});
  await sleep(2600);

  const first = await page.evaluate(() => {
    const review = document.querySelector('#ob-ai-review');
    const inputs = review ? Array.from(review.querySelectorAll('input[type="checkbox"]')) : [];
    const records = window.OB.adapters.douyin.collectAIRecords(document);
    return {
      status: window.OB.ai.status(),
      review: !!review,
      candidates: inputs.length,
      disabledCandidates: inputs.filter((input) => input.disabled).length,
      records: records.map((item) => ({ kind: item.kind, keys: item.keys, text: item.text || item.note })),
      bodies: window.__aiBodies || [],
    };
  });
  const firstBody = first.bodies[0] || {};
  const firstItems = firstBody.messages && firstBody.messages[1]
    ? JSON.parse(firstBody.messages[1].content || '{}').items || [] : [];
  if (first.review && first.candidates === 3 && first.disabledCandidates === 1) {
    report.pass.push('DY-AI-1 抖音评论/弹幕自动分析弹出三条候选，无法确认身份的弹幕不可执行');
  } else {
    report.fail.push('DY-AI-1 候选审核形态异常：' + JSON.stringify({ review: first.review, candidates: first.candidates, disabled: first.disabledCandidates, status: first.status }));
  }
  if (first.records.some((item) => item.kind === 'comment' && item.keys.includes('douyin:secuid:MS4wLjABAAComment'))
    && first.records.some((item) => item.kind === 'danmaku' && item.keys.includes('douyin:uid:7654321'))
    && first.records.some((item) => item.kind === 'danmaku' && item.keys.length === 0)) {
    report.pass.push('DY-AI-2 抖音评论复用 sec_uid、带身份弹幕保留 uid、无身份弹幕保留为只读文本');
  } else report.fail.push('DY-AI-2 抖音 AI 记录身份边界异常：' + JSON.stringify(first.records));
  const cleanedComment = first.records.find((item) => item.kind === 'comment' && item.keys.includes('douyin:secuid:MS4wLjABAAComment'));
  const bodyTextComment = first.records.find((item) => item.kind === 'comment' && !item.keys.length);
  const cleanedDanmaku = first.records.find((item) => item.kind === 'danmaku' && item.keys.includes('douyin:uid:7654321'));
  if (cleanedComment && cleanedDanmaku && bodyTextComment
    && /引战评论甲$/.test(cleanedComment.text)
    && /引战弹幕甲$/.test(cleanedDanmaku.text)
    && /喜欢回复举报但不是控件/.test(bodyTextComment.text)
    && !/(喜欢|举报|回复)$/.test(cleanedComment.text)
    && !/(喜欢|举报|回复)$/.test(cleanedDanmaku.text)) {
    report.pass.push('DY-AI-6 抖音 AI 正文移除末尾控件词，正文自身出现控件词时保留');
  } else report.fail.push('DY-AI-6 抖音正文清洗异常：' + JSON.stringify({ cleanedComment, cleanedDanmaku, bodyTextComment }));
  const serializedFirst = JSON.stringify(first.bodies);
  if (first.bodies.length >= 1 && firstItems.length === 4
    && !/(douyin:(uid|secuid)|MS4wLjABAA|"keys"|"uid"|"secuid"|data-danm)/i.test(serializedFirst)) {
    report.pass.push('DY-AI-3 发往网关的抖音 AI 请求包含评论/弹幕正文但不含身份字段');
  } else report.fail.push('DY-AI-3 抖音 AI 请求边界异常：' + serializedFirst.slice(0, 1600));

  await page.evaluate(() => window.OB.ai.closeReview());
  const beforeSwitchBodies = first.bodies.length;
  await page.evaluate(() => {
    const player = document.querySelector('#dy-player');
    const comment = document.querySelector('#dy-ai-comment');
    player.className = 'basePlayerContainer video_2222222222222222222';
    player.querySelector('.danmu').innerHTML = '<div id="dy-ai-dm-next" data-danmu-id="ai-dm-next" data-danmaku-user-id="7654322"><div class="danMuText">新视频引战弹幕乙</div></div>';
    comment.innerHTML = '<a data-e2e="comment-username" href="/user/MS4wLjABAACommentNext">新评论作者</a><span>新视频引战评论乙</span>';
    document.querySelector('#dy-ai-comment-body-text')?.remove();
  });
  await sleep(2100);
  const afterSwitch = await page.evaluate(() => {
    const review = document.querySelector('#ob-ai-review');
    const rows = review ? Array.from(review.querySelectorAll('.ob-ai-candidate-text')).map((node) => node.textContent) : [];
    const bodies = window.__aiBodies || [];
    const latest = bodies[bodies.length - 1] || {};
    let items = [];
    try { items = JSON.parse(latest.messages && latest.messages[1] && latest.messages[1].content || '{}').items || []; } catch (error) {}
    return { review: !!review, rows, bodies, latestItems: items, status: window.OB.ai.status() };
  });
  const latestSerialized = JSON.stringify(afterSwitch.latestItems);
  if (afterSwitch.review && afterSwitch.latestItems.length === 2
    && afterSwitch.rows.every((text) => /新视频/.test(String(text)))
    && !/引战弹幕甲|引战评论甲/.test(latestSerialized)
    && afterSwitch.bodies.length === beforeSwitchBodies + 1) {
    report.pass.push('DY-AI-4 同 URL 换片后清空旧 AI 会话，只分析新视频评论/弹幕并重新弹出审核');
  } else report.fail.push('DY-AI-4 换片会话隔离异常：' + JSON.stringify({ rows: afterSwitch.rows, latestItems: afterSwitch.latestItems, count: afterSwitch.bodies.length, status: afterSwitch.status }));

  await page.evaluate(() => window.OB.ai.closeReview());
  const stableCount = afterSwitch.bodies.length;
  await page.evaluate(() => document.querySelector('#dy-ai-dm-next').setAttribute('data-digg-count', '1'));
  await sleep(1200);
  const afterOrdinaryMutation = await page.evaluate(() => ({ count: (window.__aiBodies || []).length, status: window.OB.ai.status() }));
  if (afterOrdinaryMutation.count === stableCount) report.pass.push('DY-AI-5 普通弹幕属性变化不会触发重复 AI 请求');
  else report.fail.push('DY-AI-5 普通弹幕变化触发了额外请求：' + JSON.stringify(afterOrdinaryMutation));

  await browser.close();
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(report.pageErrors));
  console.log('CONSOLE:', JSON.stringify(report.console));
  process.exitCode = report.fail.length || report.pageErrors.length || report.console.length ? 1 : 0;
})().catch((error) => {
  console.error('AI PLATFORM TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

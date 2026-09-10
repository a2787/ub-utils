/* 专用开发扩展回归：证明源码不是只在当前标签页一次性注入。
 * 人工合成 B 站/抖音页面，打开三个新文档，验证不同平台/子域都自动加载扩展，
 * chrome.storage 本地桥接能跨页面保存设置和 AI 反馈，loopback AI 窄 JSON 请求可经桥接返回，
 * 页面脚本不能伪造桥接消息；最后在缺少隔离桥的人工页面验证启动会有界降级，不会无限重试。
 * 运行：node test/dev-extension.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { launchPersistentChromium, ROOT, EDGE_PATH, CHROME_PATH } = require('./runtime.cjs');

const buildScript = path.join(ROOT, 'test', 'build-dev-extension.cjs');
const build = JSON.parse(execFileSync(process.execPath, [buildScript], { cwd: ROOT, encoding: 'utf8' }));
const extensionDir = path.join(ROOT, 'test', '_dev-extension');
const serviceWorkerSource = fs.readFileSync(path.join(extensionDir, 'bridge-service-worker.js'), 'utf8');
const bridgeSourcePaths = [
  path.join(extensionDir, 'runtime-main.js'),
  path.join(extensionDir, 'bridge-isolated.js'),
  path.join(extensionDir, 'bridge-service-worker.js'),
];
const bridgeSources = bridgeSourcePaths.map((file) => fs.readFileSync(file, 'utf8'));
// 当前 Google Chrome 148 会忽略命令行 unpacked-extension 开关；Edge/Chromium
// 仍支持它们，因此结构回归默认选 Edge，专用 Chrome 的长期运行由一次性的
// chrome://extensions「加载已解压的扩展程序」安装流程负责。
const extensionBrowserPath = process.env.OMNIBLOCK_EXTENSION_BROWSER_PATH || EDGE_PATH || CHROME_PATH || '';
const fixtureUrls = [
  'https://www.bilibili.com/omniblock-structure-fixture',
  'https://space.bilibili.com/omniblock-structure-fixture',
  'https://www.douyin.com/omniblock-structure-fixture',
];
// 使用可被浏览器正常解析的保留域名；context.route 会在真正发出网络请求前
// 返回人工页面，避免 Edge 对 `.invalid` 导航直接报 ERR_ABORTED/关闭目标页，
// 让该用例真正覆盖“缺少隔离桥”的 runtime-main 降级路径。
const fallbackUrl = 'https://example.com/omniblock-bridge-timeout-fixture';
let aiUrl = '';
let factUrl = '';
let aiServer = null;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock extension fixture</title></head>
<body><main data-ob-fixture="artificial"><h1>人工合成扩展回归页面</h1><p>不包含真实作品或账号标识。</p></main></body></html>`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], pageErrors: [] };
  if (/function normalizeBiliCardUrl/.test(serviceWorkerSource)
    && /method === 'GET' \? normalizeBiliCardUrl/.test(serviceWorkerSource)
    && /fetch\(request\.url, fetchOptions\)/.test(serviceWorkerSource)
    && /api\.bilibili\.com/.test(serviceWorkerSource)) {
    report.pass.push('开发扩展桥接仅转发白名单 B站用户卡片 GET，支持 UID 反查路径');
  } else {
    report.fail.push('开发扩展桥接缺少 B站用户卡片 GET 白名单转发');
  }
  const feedbackExampleAllowlist = "['role', 'label', 'kind', 'contentType', 'text', 'reasonCode', 'note']";
  if (bridgeSources.length === 3 && bridgeSources.every((source) => source.includes(feedbackExampleAllowlist))) {
    report.pass.push('提示词反馈样例的 contentType 在主世界、隔离世界和 service worker 白名单中一致');
  } else {
    report.fail.push('提示词反馈样例白名单未在三层开发扩展桥中同步');
  }
  const feedbackStorageKeys = [
    "value === 'omniblock:ai-prompt-profile:v1'",
    "value === 'omniblock:ai-feedback:v1'",
  ];
  if (bridgeSources.length === 3 && bridgeSources.slice(0, 2).every((source) => feedbackStorageKeys.every((key) => source.includes(key)))) {
    report.pass.push('提示词 profile/反馈存储键在主世界和隔离世界存储桥白名单中一致');
  } else {
    report.fail.push('提示词 profile/反馈存储键未在主世界和隔离世界存储桥中同步');
  }
  if (bridgeSources.length === 3 && bridgeSources.every((source) => source.includes('isAllowedFactRequestData')
    && source.includes('isAllowedVerificationSources') && source.includes('fact-local-allowlist-v1')
    && source.includes('verificationSources'))) {
    report.pass.push('事实核查请求和 verificationSources 在三层开发扩展桥中均受限校验');
  } else {
    report.fail.push('事实核查请求的开发扩展桥白名单未在三层同步');
  }
  if (bridgeSources.length === 3 && bridgeSources.every((source) => source.includes('isAllowedAIContext')
    && source.includes('isAllowedAIContextCatalog') && source.includes('contextSchemaVersion'))) {
    report.pass.push('作品语境 context/contextCatalog 在三层开发扩展桥中均受 ordinal 白名单校验');
  } else {
    report.fail.push('作品语境 context/contextCatalog 未在三层开发扩展桥同步校验');
  }
  const aiRequests = [];
  const factRequests = [];
  const responseFor = (body) => {
    if (body && body.policyVersion === 'fact-local-allowlist-v1') {
      factRequests.push(body);
      return { schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', items: (body.claims || []).map((claim) => ({
        id: claim.id, status: 'contradicted', method: 'local_allowlist',
        sources: [{ sourceId: 'synthetic-source', sourceTier: 'official', title: '人工合成来源',
          snippet: '人工合成矛盾摘要', publishedAt: '2026-09-10' }],
      })) };
    }
    let input = {};
    try { input = JSON.parse(body && body.messages && body.messages[1] && body.messages[1].content || '{}'); } catch (error) {}
    if (input.rules && input.rules.includes('桥接事实核查规则') && input.items && input.items[0]) {
      return { items: [{
        id: input.items[0].id, decision: 'block', claimType: 'factual_claim', verificationStatus: 'contradicted',
        verificationMethod: 'external_source', ruleMatched: false, category: 'synthetic', confidence: 0.8,
        reasonCodes: ['synthetic-fact'], reason: '人工合成来源与内容共同满足', evidence: '人工合成矛盾摘要',
      }] };
    }
    return { items: [] };
  };
  // 扩展 service worker 发起的 fetch 不一定经过 Playwright 的 page/context
  // route；用一次性本地 HTTP mock 保证桥接回归验证的是“扩展 worker → loopback”
  // 真实路径，而不是依赖某个浏览器版本的网络拦截实现。
  aiServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (error) {}
      const input = body && body.messages ? (() => { try { return JSON.parse(body.messages[1] && body.messages[1].content || '{}'); } catch (error) { return {}; } })() : {};
      if (!(body && body.policyVersion === 'fact-local-allowlist-v1')) aiRequests.push({ body, input });
      const payload = responseFor(body);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      response.end(JSON.stringify(body && body.policyVersion === 'fact-local-allowlist-v1'
        ? payload : { choices: [{ message: { content: JSON.stringify(payload) } }] }));
    });
  });
  await new Promise((resolve, reject) => {
    aiServer.once('error', reject);
    aiServer.listen(0, '127.0.0.1', () => {
    const address = aiServer.address();
      aiUrl = 'http://127.0.0.1:' + address.port + '/v1/chat/completions';
      factUrl = 'http://127.0.0.1:' + address.port + '/v1/fact-check';
      resolve();
    });
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniblock-extension-'));
  let context;
  try {
    context = await launchPersistentChromium(profileDir, {
      // Chrome 148 的无头模式仍不执行 unpacked content scripts；这里使用
      // 隔离临时 profile 的 headed 进程，并把窗口移出屏幕，不打开用户专用浏览器。
      headless: false,
      ...(extensionBrowserPath ? { executablePath: extensionBrowserPath } : {}),
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
        '--window-position=-32000,-32000',
        '--load-extension=' + extensionDir,
      ],
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url === aiUrl || url === factUrl) {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (error) {}
        const input = body && body.messages ? (() => { try { return JSON.parse(body.messages[1] && body.messages[1].content || '{}'); } catch (error) { return {}; } })() : {};
        if (!(body && body.policyVersion === 'fact-local-allowlist-v1')) aiRequests.push({ body, input });
        const payload = responseFor(body);
        return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(
          body && body.policyVersion === 'fact-local-allowlist-v1'
            ? payload : { choices: [{ message: { content: JSON.stringify(payload) } }] }) });
      }
      if (fixtureUrls.some((fixtureUrl) => url.startsWith(fixtureUrl)) || url.startsWith(fallbackUrl)) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
      }
      // 只阻断人工页面的外部网络；不得拦截 chrome-extension:// 资源，
      // 否则测试会伪造出“新页面没有插件”的错误结论。
      return /^https?:/i.test(url) ? route.abort() : route.continue();
    });

    const openAndCheck = async (label, url) => {
      const page = await context.newPage();
      page.on('pageerror', (error) => report.pageErrors.push(label + ': ' + String(error)));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForFunction(() => !!window.OB
          && !!document.getElementById('ob-gear')
          && !!window.__OB_EXTENSION_RUNTIME__
          && window.__OB_EXTENSION_RUNTIME__.bridge
          && window.__OB_EXTENSION_RUNTIME__.bridge.state === 'ready', null, { timeout: 8000 });
      } catch (error) {
        const state = await page.evaluate(() => ({
          title: document.title,
          ready: typeof window.__OB_EXTENSION_READY__,
          extension: window.__OB_EXTENSION_RUNTIME__ || null,
          globals: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_openInTab']
            .filter((key) => typeof window[key] !== 'undefined'),
          ob: !!window.OB,
          gear: !!document.getElementById('ob-gear'),
          styleCount: document.querySelectorAll('style').length,
        }));
        throw new Error(label + ' 初始化超时：' + JSON.stringify(state) + '；' + error.message);
      }
      await sleep(80);
      return page;
    };
    const closePage = async (page) => {
      if (page && !page.isClosed()) await page.close();
    };

    const first = await openAndCheck('page-1', fixtureUrls[0]);
    const firstState = await first.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      globals: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_openInTab']
        .filter((key) => typeof window[key] !== 'undefined'),
      gearCount: document.querySelectorAll('#ob-gear').length,
      dock: document.documentElement.getAttribute('data-ob-dock'),
    }));
    if (firstState.runtime && firstState.runtime.build === build.build
      && firstState.extension && firstState.extension.mode === 'persistent-dev-extension'
      && firstState.extension.bridge && firstState.extension.bridge.state === 'ready'
      && firstState.extension.bridge.attempts >= 1 && firstState.globals.length === 0
      && firstState.gearCount === 1 && firstState.dock === 'collapsed') {
      report.pass.push('page-1 自动加载当前源码，桥接就绪且 GM 能力未暴露给页面');
    } else {
      report.fail.push('page-1 运行时不完整：' + JSON.stringify(firstState));
    }

    await first.evaluate((endpoint) => {
      const host = document.createElement('bili-comments');
      const hostRoot = host.attachShadow({ mode: 'open' });
      const renderer = document.createElement('bili-comment-renderer');
      renderer.__data = { mid: '123', member: { mid: '123', uname: '人工合成 AI 用户' } };
      const root = renderer.attachShadow({ mode: 'open' });
      const link = document.createElement('a');
      link.className = 'user-name'; link.href = 'https://space.bilibili.com/123'; link.textContent = '人工合成 AI 用户';
      const text = document.createElement('span'); text.className = 'text'; text.textContent = '人工合成评论正文';
      root.append(link, text); hostRoot.appendChild(renderer); document.body.appendChild(host);
      const card = document.createElement('div'); card.className = 'bili-video-card';
      const title = document.createElement('a'); title.href = 'https://www.bilibili.com/video/av123'; title.textContent = '人工合成作品标题';
      const owner = document.createElement('a'); owner.className = 'bili-video-card__info--owner'; owner.href = 'https://space.bilibili.com/124'; owner.textContent = '人工合成作品作者';
      card.append(title, owner); document.body.appendChild(card);
      window.OB.Store.setSetting('aiGatewayUrl', endpoint);
      window.OB.Store.setSetting('aiGatewayModel', 'bridge-test');
      window.OB.Store.setSetting('aiRules', [{ text: '人工合成规则', enabled: true }]);
      window.OB.Store.setSetting('aiEnabled', true);
      window.OB.ai.prompt.recordFeedback({
        platform: 'bilibili', kind: 'comment', contentType: 'comment',
        text: '人工合成反馈样例', label: 'positive', source: 'manual',
        reasonCode: 'other', note: '桥接 contentType 回归',
      });
    }, aiUrl);
    const aiResult = await first.evaluate(async () => window.OB.ai.analyzePage('人工合成页面规则'));
    const aiBridgeState = await first.evaluate(() => window.OB.ai.status());
    const aiInput = aiRequests[0] && aiRequests[0].input;
    const aiItems = aiInput && Array.isArray(aiInput.items) ? aiInput.items : [];
    const aiExamples = aiInput && Array.isArray(aiInput.examples) ? aiInput.examples : [];
    const aiFeedbackExampleOk = aiExamples.length >= 1
      && aiExamples.every((example) => Object.keys(example).sort().join(',')
        === 'contentType,kind,label,note,reasonCode,role,text')
      && aiExamples.some((example) => example.contentType === 'comment');
    const aiContextCatalogOk = !!(aiInput && aiInput.contextSchemaVersion === 2
      && aiInput.contextCatalog && Array.isArray(aiInput.contextCatalog.works)
      && aiInput.contextCatalog.works.every((work) => /^w\d+$/.test(work.id || '')
        && typeof work.title === 'string' && !/space\.bilibili|bili:(?:uid|dmhash)/i.test(JSON.stringify(work)))
      && (!aiInput.contextCatalog.defaults || (typeof aiInput.contextCatalog.defaults.workId === 'string'
        && typeof aiInput.contextCatalog.defaults.sufficiency === 'string')));
    const aiUnsafeMatches = JSON.stringify(aiInput || {}).match(/bili:uid|bili:dmhash|space\.bilibili|["'](?:uid|mid|hash|keys)["']/gi) || [];
    const aiHasOnlySafeItems = !!(aiInput && Array.isArray(aiInput.rules)
      && aiItems.length === 2
      && aiItems.every((item) => ['contentType,id,kind,text', 'contentType,id,kind,text,title',
        'contentType,context,id,kind,text', 'contentType,context,id,kind,text,title'].includes(Object.keys(item).sort().join(',')))
      && aiItems.some((item) => item.kind === 'comment' && item.contentType === 'comment')
      && aiItems.some((item) => item.kind === 'content' && item.contentType === 'video' && item.title === '人工合成作品标题')
      && !/bili:uid|bili:dmhash|space\.bilibili|["'](?:uid|mid|hash|keys)["']/i.test(JSON.stringify(aiInput)));
    if (aiResult && aiResult.ok && aiBridgeState.state === 'ready' && aiRequests.length === 1
      && aiHasOnlySafeItems && aiContextCatalogOk && aiFeedbackExampleOk) {
      report.pass.push('page-1 loopback AI 作品/评论/反馈样例窄 JSON 经持久桥接返回，未携带身份字段');
    } else {
      report.fail.push('loopback AI 桥接失败：' + JSON.stringify({ aiResult, aiBridgeState, requests: aiRequests.length, aiInput, aiFeedbackExampleOk,
        aiContextCatalogOk, aiHasOnlySafeItems, aiUnsafeMatches, itemShapes: aiItems.map((item) => Object.keys(item).sort().join(',')) }));
    }

    const aiBeforeFact = aiRequests.length;
    const factBefore = factRequests.length;
    const factResult = await first.evaluate(async (endpoint) => {
      window.OB.Store.setSetting('aiFactRetrievalMode', 'canary');
      window.OB.Store.setSetting('aiFactRetrievalUrl', endpoint);
      return window.OB.ai.analyzePage('桥接事实核查规则');
    }, factUrl);
    for (let attempt = 0; attempt < 40 && (aiRequests.length < aiBeforeFact + 2 || factRequests.length < factBefore + 1); attempt++) await sleep(50);
    const factAiCalls = aiRequests.slice(aiBeforeFact);
    const factBody = factRequests[factBefore] || {};
    const factInput = factAiCalls[factAiCalls.length - 1] && factAiCalls[factAiCalls.length - 1].input || {};
    const factBridgeOk = factResult && factResult.ok
      && factAiCalls.length >= 2 && factRequests.length >= factBefore + 1
      && Array.isArray(factBody.claims) && factBody.claims.length >= 1
      && factBody.claims.every((claim) => /^c\d{1,2}$/.test(claim.id) && claim.language === 'zh-CN')
      && Array.isArray(factInput.verificationSources) && factInput.verificationSources.length >= 1
      && !/(?:bili:(?:uid|dmhash)|space\.bilibili|cookie|token|api[_ -]?key)/i.test(JSON.stringify({ factBody, factInput }));
    if (factBridgeOk) {
      report.pass.push('事实核查请求与带 verificationSources 的二次 AI 请求均经持久桥接返回');
    } else {
      report.fail.push('事实核查持久桥接失败：' + JSON.stringify({ factResult, aiCalls: factAiCalls.length,
        factCalls: factRequests.length - factBefore, factBody, factInput }));
    }
    await first.evaluate(() => window.OB.Store.setSetting('aiFactRetrievalMode', 'off'));

    await first.evaluate(() => window.OB.Store.setSetting('skipCap', 11));
    await sleep(120);
    await first.evaluate(() => {
      const channel = '__OMNIBLOCK_EXTENSION_GM_V1__';
      // 两个方向都发送缺少签名的伪造消息：前者试图污染扩展存储，后者试图
      // 欺骗主世界进入错误状态。桥接必须忽略它们。
      window.postMessage({ channel, source: 'omniblock-main', type: 'set',
        key: 'omniblock:data:v1', value: '{"settings":{"skipCap":99}}' }, location.origin);
      window.postMessage({ channel, source: 'omniblock-isolated', type: 'ready-response',
        requestId: 'forged', values: { 'omniblock:data:v1': '{}' } }, location.origin);
    });
    await sleep(120);
    // Edge 在移出屏幕的 headed profile 中可能回收长时间留在后台的标签页。
    // 这个回归要验证“新文档自动加载”，不需要同时保留旧标签；逐个关闭已完成
    // 的人工页面可以避免后台回收把后续 page.evaluate 误报为扩展失败。
    await closePage(first);
    const second = await openAndCheck('page-2', fixtureUrls[1]);
    const secondState = await second.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      globals: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_openInTab']
        .filter((key) => typeof window[key] !== 'undefined'),
      gearCount: document.querySelectorAll('#ob-gear').length,
      skipCap: window.OB && window.OB.Store.getSetting('skipCap'),
      promptPositive: window.OB && window.OB.ai && window.OB.ai.prompt
        ? window.OB.ai.prompt.status().positive : -1,
    }));
    if (secondState.runtime && secondState.runtime.build === build.build
      && secondState.extension && secondState.extension.mode === 'persistent-dev-extension'
      && secondState.extension.bridge && secondState.extension.bridge.state === 'ready'
      && secondState.globals.length === 0
      && secondState.gearCount === 1 && secondState.skipCap === 11
      && secondState.promptPositive === 1) {
      report.pass.push('page-2 新建文档共享设置和 AI 反馈存储，未签名伪造消息未能篡改设置');
    } else {
      report.fail.push('page-2 自动加载或持久存储失败：' + JSON.stringify(secondState));
    }
    await closePage(second);
    const third = await openAndCheck('page-3', fixtureUrls[2]);
    const thirdState = await third.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      globals: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_openInTab']
        .filter((key) => typeof window[key] !== 'undefined'),
      gearCount: document.querySelectorAll('#ob-gear').length,
      dock: document.documentElement.getAttribute('data-ob-dock'),
    }));
    if (thirdState.runtime && thirdState.runtime.build === build.build
      && thirdState.extension && thirdState.extension.mode === 'persistent-dev-extension'
      && thirdState.extension.bridge && thirdState.extension.bridge.state === 'ready'
      && thirdState.globals.length === 0
      && thirdState.gearCount === 1 && thirdState.dock === 'collapsed') {
      report.pass.push('page-3 新建抖音文档自动加载，平台匹配和控制坞边界正常');
    } else {
      report.fail.push('page-3 抖音文档自动加载失败：' + JSON.stringify(thirdState));
    }
    await closePage(third);
    const runtimeMain = fs.readFileSync(path.join(extensionDir, 'runtime-main.js'), 'utf8');
    const fallback = await context.newPage();
    fallback.on('pageerror', (error) => report.pageErrors.push('fallback: ' + String(error)));
    await fallback.addInitScript({ content: runtimeMain });
    await fallback.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
    await fallback.waitForFunction(() => !!window.OB && !!window.__OB_EXTENSION_RUNTIME__
      && window.__OB_EXTENSION_RUNTIME__.bridge
      && window.__OB_EXTENSION_RUNTIME__.bridge.state === 'degraded', null, { timeout: 8000 });
    const fallbackBefore = await fallback.evaluate(() => ({
      extension: window.__OB_EXTENSION_RUNTIME__,
      globals: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_openInTab']
        .filter((key) => typeof window[key] !== 'undefined'),
      ob: !!window.OB,
    }));
    await sleep(500);
    const fallbackAfter = await fallback.evaluate(() => ({
      state: window.__OB_EXTENSION_RUNTIME__.bridge.state,
      attempts: window.__OB_EXTENSION_RUNTIME__.bridge.attempts,
    }));
    if (fallbackBefore.ob && fallbackBefore.extension.bridge.attempts === 8
      && fallbackBefore.extension.bridge.reason === 'ready-timeout'
      && fallbackBefore.globals.length === 0
      && fallbackAfter.state === 'degraded' && fallbackAfter.attempts === 8) {
      report.pass.push('缺少隔离桥时 8 次内有界降级，运行时继续启动且不再重试');
    } else {
      report.fail.push('桥接有界降级失败：' + JSON.stringify({ fallbackBefore, fallbackAfter }));
    }

    await closePage(fallback);
  } catch (error) {
    report.fail.push(String(error && error.stack || error));
  } finally {
    if (context) { try { await context.close(); } catch (error) {} }
    if (aiServer) {
      try { await new Promise((resolve) => aiServer.close(() => resolve())); } catch (error) {}
      aiServer = null;
    }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (error) {}
  }

  console.log('==== OmniBlock 持久化开发扩展回归 ====' );
  console.log('BROWSER:', path.basename(extensionBrowserPath || 'playwright-default'));
  console.log('FIXTURE: artificial Bilibili/Douyin documents, no real page identifiers');
  console.log('PASS:', report.pass.length); report.pass.forEach((item) => console.log('  ✅', item));
  console.log('FAIL:', report.fail.length); report.fail.forEach((item) => console.log('  ❌', item));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach((item) => console.log('  ·', item));
  const ok = report.fail.length === 0 && report.pageErrors.length === 0;
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('HARNESS ERROR:', error);
  process.exit(2);
});

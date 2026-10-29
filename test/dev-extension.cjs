/* 专用开发扩展回归：证明源码不是只在当前标签页一次性注入。
 * 人工合成 B 站/抖音页面，打开三个新文档，验证不同平台/子域都自动加载扩展，
 * chrome.storage 本地桥接能跨页面保存设置和 AI 反馈，页面脚本不能伪造桥接消息；
 * 并验证 AI 直连形态下的开发扩展边界：无设备 Key 时 analyzePage 有界失败、
 * 零 provider 请求离开页面、设备 Key 无法经桥接存储面写入；
 * 最后在缺少隔离桥的人工页面验证启动会有界降级，不会无限重试。
 *
 * 2026-10-27 降级说明（OB-MAINT-003）：本用例原先验证 loopback AI 网关与事实核查
 * 往返（写入 aiGatewayUrl/aiGatewayModel 后断言 analyzePage 请求经桥接往返）。
 * v0.57.1 起 AI 主链路改为直连：设置键为 aiProviderUrl/aiProviderModel，设备 Key
 * 存 Tampermonkey GM 键 omniblock:ai-direct-config:v1，网关设置键已从源码整体移除，
 * 旧往返断言结构性失效（每轮必然失败）。在开发扩展内恢复直连往返需要改
 * build-dev-extension.cjs 的桥接协议：存储白名单加入设备 Key、请求头白名单放行
 * Authorization、service worker 增加 omniblock-direct-ai 取回处理器——三者都是
 * 桥接安全面协议变更，超出维护轮非目标，因此把两个往返用例降级为直连拒绝断言
 * （旧行为上网关请求会真实发出，新断言"零请求离开页面"在旧架构上失败），
 * 桥接三层的反馈样例/存储键/事实核查/作品语境白名单静态断言全部保留。
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
  // OB-MAINT-003 降级守卫：内嵌源码必须仍是 AI 直连形态（网关设置键 0 处），
  // 否则本文件的降级说明与直连拒绝断言不再描述当前架构，需要重写该用例。
  if (!bridgeSources[0].includes('aiGatewayUrl')
    && bridgeSources[0].includes('aiProviderUrl')
    && bridgeSources[0].includes('aiProviderModel')
    && bridgeSources[0].includes("'omniblock:ai-direct-config:v1'")) {
    report.pass.push('内嵌源码为 AI 直连形态：loopback 网关设置键已移除，直连设置与设备 GM 键存在');
  } else {
    report.fail.push('内嵌源码 AI 传输形态与预期不符（应无 aiGatewayUrl，含直连设置与设备 GM 键）');
  }
  // OB-STORE-001 degraded 双层防御源码级守卫：主世界 ready 后先发 ready-ack、
  // GM 写入在 !ready 时拒绝并计数；隔离世界锁存 ready-ack，'set'/'remove' 在
  // 未锁存时拒绝转发。缺失任一字面量说明门控被移除，degraded 页面可能再次
  // 用空态覆盖真实名单（test/degraded-storage.cjs 负责浏览器级行为断言）。
  const readyAckGateOk = /post\(\{ type: 'ready-ack' \}\)/.test(bridgeSources[0])
    && (bridgeSources[0].match(/if \(!ready\) \{ bridgeStatus\.blockedWrites\+\+; return; \}/g) || []).length >= 2
    && bridgeSources[0].includes('blockedWrites: 0');
  const isolatedGateOk = /let mainReadySeen = false;/.test(bridgeSources[1])
    && /if \(message\.type === 'ready-ack'\)/.test(bridgeSources[1])
    && /mainReadySeen = true;/.test(bridgeSources[1])
    && (bridgeSources[1].match(/if \(!mainReadySeen\) \{ gatedWrites\+\+; return; \}/g) || []).length >= 2;
  if (readyAckGateOk && isolatedGateOk) {
    report.pass.push('桥接双层写入门控存在：主世界 ready-ack 先行 + !ready 拒写计数，隔离世界锁存后放行 set/remove');
  } else {
    report.fail.push('桥接 degraded 写入门控缺失：' + JSON.stringify({ readyAckGateOk, isolatedGateOk }));
  }
  // OB-BRIDGE-001 就绪快照分块守卫：'ready-values-chunk' 字面量必须同时存在于
  // 主世界（聚合）与隔离世界（分块发送）两个模板，且两侧分块参数一致。缺失
  // 任一侧说明分块协议被移除，白名单总量超过 8MiB 的真实存储会再次永久 degraded。
  const chunkGateOk = (bridgeSources[0].match(/ready-values-chunk/g) || []).length >= 1
    && /const MAX_READY_CHUNKS = 64;/.test(bridgeSources[0])
    && /const readyChunks = new Map\(\);/.test(bridgeSources[0])
    && /readyChunks\.clear\(\)/.test(bridgeSources[0])
    && bridgeSources[1].includes('ready-values-chunk')
    && /const READY_CHUNK_CHARS = 2 \* 1024 \* 1024;/.test(bridgeSources[1])
    && /const MAX_READY_CHUNKS = 64;/.test(bridgeSources[1]);
  if (chunkGateOk) {
    report.pass.push('就绪快照分块协议两侧同步：主世界 ready-values-chunk 聚合 + 隔离世界 2MiB 分块发送，MAX_READY_CHUNKS=64 一致');
  } else {
    report.fail.push('就绪快照分块协议缺失或两侧不同步：' + JSON.stringify({ chunkGateOk }));
  }
  // loopback mock provider：直连形态下预期零请求到达；计数同时覆盖
  // 页面级（context.route）与 service worker fetch（本地 HTTP）两条可能路径。
  let providerRequests = 0;
  aiServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      providerRequests++;
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      response.end('{}');
    });
  });
  await new Promise((resolve, reject) => {
    aiServer.once('error', reject);
    aiServer.listen(0, '127.0.0.1', () => {
      const address = aiServer.address();
      aiUrl = 'http://127.0.0.1:' + address.port + '/v1/chat/completions';
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
      if (url === aiUrl) {
        providerRequests++;
        return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: '{}' });
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

    // AI 直连形态下的开发扩展边界（OB-MAINT-003 重写）：配置合法 loopback
    // provider 后，analyzePage 必须因设备 Key 缺失有界失败，任何 provider 请求
    // 都不得离开页面；setApiKey 经桥接 GM shim 的存储白名单必须被丢弃。
    await first.evaluate((endpoint) => {
      window.OB.Store.setSetting('aiProviderUrl', endpoint);
      window.OB.Store.setSetting('aiProviderModel', 'bridge-test');
      window.OB.Store.setSetting('aiRules', [{ text: '人工合成规则', enabled: true }]);
      window.OB.Store.setSetting('aiEnabled', true);
      window.OB.ai.prompt.recordFeedback({
        platform: 'bilibili', kind: 'comment', contentType: 'comment',
        text: '人工合成反馈样例', label: 'positive', source: 'manual',
        reasonCode: 'other', note: '桥接 contentType 回归',
      });
    }, aiUrl);
    const aiTransport = await first.evaluate(() => {
      const before = window.OB.ai.status();
      window.OB.ai.setApiKey('bridge-test-device-key-0123456789');
      const keyAfterSet = window.OB.ai.apiKeyConfigured();
      window.OB.ai.clearApiKey();
      return {
        mode: before.mode,
        gatewayConfigured: before.gatewayConfigured,
        providerConfigured: before.providerConfigured,
        keyConfiguredBefore: before.keyConfigured,
        keyAfterSet,
      };
    });
    const aiResult = await first.evaluate(async () => window.OB.ai.analyzePage('人工合成页面规则'));
    const aiStatus = await first.evaluate(() => window.OB.ai.status());
    const aiDirectRefusalOk = aiTransport.mode === 'direct'
      && aiTransport.gatewayConfigured === false
      && aiTransport.providerConfigured === true
      && aiTransport.keyConfiguredBefore === false
      && aiTransport.keyAfterSet === false
      && aiResult && aiResult.ok === false && /AI API Key/.test(String(aiResult.error || ''))
      && aiStatus.state === 'error' && /AI API Key/.test(String(aiStatus.lastError || ''))
      && providerRequests === 0;
    if (aiDirectRefusalOk) {
      report.pass.push('page-1 AI 直连形态：无设备 Key 时 analyzePage 有界失败，零 provider 请求离开页面，设备 Key 无法经桥接存储面写入');
    } else {
      report.fail.push('AI 直连拒绝断言失败：' + JSON.stringify({
        aiTransport, aiResult, aiStatus,
        providerRequests,
        stateOk: !!(aiResult && aiResult.ok === false && /AI API Key/.test(String(aiResult.error || ''))),
        lastErrorOk: !!(aiStatus.state === 'error' && /AI API Key/.test(String(aiStatus.lastError || ''))),
      }));
    }

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

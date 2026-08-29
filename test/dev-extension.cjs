/* 专用开发扩展回归：证明源码不是只在当前标签页一次性注入。
 * 人工合成 B 站/抖音页面，打开三个新文档，验证不同平台/子域都自动加载扩展，
 * 且 chrome.storage 本地桥接能把设置从第一个页面带到第二个页面。
 * 运行：node test/dev-extension.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchPersistentChromium, ROOT, EDGE_PATH, CHROME_PATH } = require('./runtime.cjs');

const buildScript = path.join(ROOT, 'test', 'build-dev-extension.cjs');
const build = JSON.parse(execFileSync(process.execPath, [buildScript], { cwd: ROOT, encoding: 'utf8' }));
const extensionDir = path.join(ROOT, 'test', '_dev-extension');
// 当前 Google Chrome 148 会忽略命令行 unpacked-extension 开关；Edge/Chromium
// 仍支持它们，因此结构回归默认选 Edge，专用 Chrome 的长期运行由一次性的
// chrome://extensions「加载已解压的扩展程序」安装流程负责。
const extensionBrowserPath = process.env.OMNIBLOCK_EXTENSION_BROWSER_PATH || EDGE_PATH || CHROME_PATH || '';
const fixtureUrls = [
  'https://www.bilibili.com/omniblock-structure-fixture',
  'https://space.bilibili.com/omniblock-structure-fixture',
  'https://www.douyin.com/omniblock-structure-fixture',
];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock extension fixture</title></head>
<body><main data-ob-fixture="artificial"><h1>人工合成扩展回归页面</h1><p>不包含真实作品或账号标识。</p></main></body></html>`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { pass: [], fail: [], pageErrors: [] };
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
      if (fixtureUrls.some((fixtureUrl) => url.startsWith(fixtureUrl))) {
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
          && !!window.__OB_EXTENSION_RUNTIME__, null, { timeout: 8000 });
      } catch (error) {
        const state = await page.evaluate(() => ({
          title: document.title,
          ready: typeof window.__OB_EXTENSION_READY__,
          extension: window.__OB_EXTENSION_RUNTIME__ || null,
          ob: !!window.OB,
          gear: !!document.getElementById('ob-gear'),
          styleCount: document.querySelectorAll('style').length,
        }));
        throw new Error(label + ' 初始化超时：' + JSON.stringify(state) + '；' + error.message);
      }
      await sleep(80);
      return page;
    };

    const first = await openAndCheck('page-1', fixtureUrls[0]);
    const firstState = await first.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      gearCount: document.querySelectorAll('#ob-gear').length,
      dock: document.documentElement.getAttribute('data-ob-dock'),
    }));
    if (firstState.runtime && firstState.runtime.build === build.build
      && firstState.extension && firstState.extension.mode === 'persistent-dev-extension'
      && firstState.gearCount === 1 && firstState.dock === 'collapsed') {
      report.pass.push('page-1 自动加载当前源码、扩展桥接和收起态控制坞');
    } else {
      report.fail.push('page-1 运行时不完整：' + JSON.stringify(firstState));
    }

    await first.evaluate(() => window.OB.Store.setSetting('skipCap', 11));
    await sleep(120);
    const second = await openAndCheck('page-2', fixtureUrls[1]);
    const secondState = await second.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      gearCount: document.querySelectorAll('#ob-gear').length,
      skipCap: window.OB && window.OB.Store.getSetting('skipCap'),
    }));
    if (secondState.runtime && secondState.runtime.build === build.build
      && secondState.extension && secondState.extension.mode === 'persistent-dev-extension'
      && secondState.gearCount === 1 && secondState.skipCap === 11) {
      report.pass.push('page-2 新建文档自动加载，且共享本地设置存储');
    } else {
      report.fail.push('page-2 自动加载或持久存储失败：' + JSON.stringify(secondState));
    }
    const third = await openAndCheck('page-3', fixtureUrls[2]);
    const thirdState = await third.evaluate(() => ({
      runtime: window.OB && window.OB.runtime,
      extension: window.__OB_EXTENSION_RUNTIME__,
      gearCount: document.querySelectorAll('#ob-gear').length,
      dock: document.documentElement.getAttribute('data-ob-dock'),
    }));
    if (thirdState.runtime && thirdState.runtime.build === build.build
      && thirdState.extension && thirdState.extension.mode === 'persistent-dev-extension'
      && thirdState.gearCount === 1 && thirdState.dock === 'collapsed') {
      report.pass.push('page-3 新建抖音文档自动加载，平台匹配和控制坞边界正常');
    } else {
      report.fail.push('page-3 抖音文档自动加载失败：' + JSON.stringify(thirdState));
    }
    await first.close();
    await second.close();
    await third.close();
  } catch (error) {
    report.fail.push(String(error && error.stack || error));
  } finally {
    if (context) { try { await context.close(); } catch (error) {} }
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

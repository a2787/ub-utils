/* Shared browser-test runtime. Environment variables override local defaults. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadChromium() {
  const userProfile = process.env.USERPROFILE || '';
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
    userProfile && path.join(userProfile, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'),
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      const api = require(candidate);
      if (api && api.chromium) return api.chromium;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('无法加载 playwright-core。请安装依赖或设置 PLAYWRIGHT_CORE_PATH。' + (lastError ? ' ' + lastError.message : ''));
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function findEdgePath() {
  const candidates = [
    process.env.OMNIBLOCK_EXTENSION_BROWSER_PATH,
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

const chromium = loadChromium();
const CHROME_PATH = findChromePath();
const EDGE_PATH = findEdgePath();

function launchChromium(options) {
  return chromium.launch(CHROME_PATH ? { ...options, executablePath: CHROME_PATH } : options);
}

function launchPersistentChromium(userDataDir, options) {
  const config = { ...(options || {}) };
  // Playwright 为普通浏览器回归默认加入 --disable-extensions；持久化开发
  // 浏览器的职责正是验证扩展自动加载，因此只在这个专用启动入口移除该默认参数。
  const ignoredDefaults = Array.isArray(config.ignoreDefaultArgs) ? config.ignoreDefaultArgs.slice() : [];
  if (!ignoredDefaults.includes('--disable-extensions')) ignoredDefaults.push('--disable-extensions');
  config.ignoreDefaultArgs = ignoredDefaults;
  if (!config.executablePath && CHROME_PATH) config.executablePath = CHROME_PATH;
  return chromium.launchPersistentContext(userDataDir, config);
}

function connectChromiumOverCDP(endpoint) {
  return chromium.connectOverCDP(endpoint);
}

module.exports = {
  ROOT, CHROME_PATH, EDGE_PATH,
  launchChromium, launchPersistentChromium, connectChromiumOverCDP,
};

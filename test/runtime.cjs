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

const chromium = loadChromium();
const CHROME_PATH = findChromePath();

function launchChromium(options) {
  return chromium.launch(CHROME_PATH ? { ...options, executablePath: CHROME_PATH } : options);
}

module.exports = { ROOT, launchChromium };

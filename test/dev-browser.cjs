/* OmniBlock 专用调试 Chrome 启动器
 *
 * 只使用 Way 2：非默认 user-data-dir + 固定 CDP 端口。端口已有浏览器时
 * 复用它，不重复启动，也不会触碰用户日常 Chrome。
 *
 * 用法：
 *   node test/dev-browser.cjs status
 *   node test/dev-browser.cjs ensure
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.OMNIBLOCK_CDP_PORT || 9222);
const PROFILE = path.resolve(process.env.OMNIBLOCK_BROWSER_PROFILE
  || 'C:\\Users\\et4vr\\.browser-harness-chrome-profile');
const ENDPOINT = `http://${HOST}:${PORT}`;

function httpJSON(resource, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const request = http.get(ENDPOINT + resource, { timeout }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('CDP HTTP timeout')));
    request.on('error', reject);
  });
}

function chromeCandidates() {
  const out = [];
  if (process.env.CHROME_PATH) out.push(process.env.CHROME_PATH);
  const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter(Boolean);
  for (const root of roots) {
    out.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    out.push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
  }
  return [...new Set(out)];
}

function findChrome() {
  const candidate = chromeCandidates().find((file) => fs.existsSync(file));
  if (!candidate) throw new Error('找不到 Chrome；可设置 CHROME_PATH 指向 chrome.exe');
  return candidate;
}

async function ready() {
  try {
    const version = await httpJSON('/json/version');
    return { ready: true, version };
  } catch (error) {
    return { ready: false, error: String(error && error.message || error) };
  }
}

async function waitForReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const result = await ready();
    if (result.ready) return result;
    last = result.error || last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('专用 Chrome 未在限定时间内开放 CDP：' + last);
}

async function ensure() {
  const before = await ready();
  if (before.ready) {
    return { status: 'ready', launched: false, cdpUrl: ENDPOINT, profile: PROFILE };
  }
  const defaultProfile = path.resolve(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  if (PROFILE === defaultProfile) throw new Error('拒绝使用 Chrome 默认配置目录');
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = findChrome();
  const child = spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  await waitForReady();
  return { status: 'ready', launched: true, cdpUrl: ENDPOINT, profile: PROFILE, chrome };
}

(async () => {
  const command = process.argv[2] || 'status';
  try {
    const result = command === 'ensure'
      ? await ensure()
      : command === 'status'
        ? { status: (await ready()).ready ? 'ready' : 'stopped', cdpUrl: ENDPOINT, profile: PROFILE }
        : (() => { throw new Error('用法：node test/dev-browser.cjs status|ensure'); })();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'blocked', cdpUrl: ENDPOINT, profile: PROFILE,
      error: String(error && error.message || error) }, null, 2));
    process.exit(2);
  }
})();

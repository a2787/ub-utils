/* OmniBlock 专用调试 Chrome 启动器
 *
 * 只使用 Way 2：非默认 user-data-dir + 固定 CDP 端口。端口已有浏览器时
 * 复用它，不重复启动，也不会触碰用户日常 Chrome。
 *
 * 用法：
 *   node test/dev-browser.cjs status
 *   node test/dev-browser.cjs build
 *   node test/dev-browser.cjs sync
 *   node test/dev-browser.cjs ensure
 *   node test/dev-browser.cjs guide
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { syncDevExtension } = require('./dedicated-browser.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEV_EXTENSION_DIR = path.join(ROOT, 'test', '_dev-extension');

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

function buildDevExtension() {
  const script = path.join(ROOT, 'test', 'build-dev-extension.cjs');
  const output = execFileSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(output);
}

async function ensure() {
  const extension = buildDevExtension();
  const before = await ready();
  if (before.ready) {
    const sync = await syncDevExtension({ endpoint: ENDPOINT });
    const syncFailed = sync.status === 'failed';
    return {
      status: sync.status === 'ready' ? 'ready-existing' : (syncFailed ? 'failed' : 'ready-install-required'), launched: false, requiresRestart: false,
      cdpUrl: ENDPOINT, profile: PROFILE,
      extension,
      sync,
      requiresManualInstall: sync.status === 'blocked',
      note: sync.status === 'ready'
        ? '复用已有专用 Chrome，并已核对新页面会运行当前开发扩展。'
        : syncFailed
          ? '复用已有专用 Chrome，但扩展同步发生内部错误；未把 CDP 可用误报为扩展 ready。'
          : '复用已有专用 Chrome，但当前扩展仍需一次性加载；同步命令已明确报告原因，不把 CDP 可用误报为扩展 ready。',
    };
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
  const sync = await syncDevExtension({ endpoint: ENDPOINT });
  const syncFailed = sync.status === 'failed';
  return {
    status: sync.status === 'ready' ? 'ready' : (syncFailed ? 'failed' : 'ready-install-required'), launched: true, cdpUrl: ENDPOINT, profile: PROFILE, chrome, extension,
    sync,
    requiresManualInstall: sync.status === 'blocked',
    note: sync.status === 'ready'
      ? '专用 Chrome 已启动，并已核对新页面会运行当前开发扩展。'
      : syncFailed
        ? '专用 Chrome 已启动，但扩展同步发生内部错误；未把 CDP 可用误报为扩展 ready。'
        : `专用 Chrome 已启动；首次仍需在 chrome://extensions 加载 ${extension.directory}，之后可由 sync 自动刷新已加载扩展。`,
  };
}

function guide() {
  const extension = buildDevExtension();
  return {
    status: 'manual-install-required',
    extension,
    steps: [
      '运行 node test/dev-browser.cjs ensure 启动固定专用 Chrome（若尚未启动）。',
      '在该窗口打开 chrome://extensions，开启右上角“开发者模式”。',
      `点击“加载已解压的扩展程序”，选择 ${extension.directory}。`,
      '以后在同一专用 profile 新建或刷新支持平台页面，源码会由扩展自动加载，不需要页面注入。',
      '源码修改后运行 node test/dev-browser.cjs sync；它会自动构建、核对当前扩展，必要时打开扩展页并刷新 OmniBlock。',
      '用 node test/dedicated-browser-probe.cjs 验证六个平台当前专用 profile 的只读内容读取。',
    ],
    note: '首次加载是 Chrome 对解压扩展的安装边界；完成一次后不再要求人工刷新。sync 只点击扩展自己的“重新加载”，不会操作平台页面。',
  };
}

(async () => {
  const command = process.argv[2] || 'status';
  try {
    const result = command === 'ensure'
      ? await ensure()
      : command === 'build'
        ? buildDevExtension()
        : command === 'sync'
          ? await (async () => { const extension = buildDevExtension(); const sync = await syncDevExtension({ endpoint: ENDPOINT, force: process.argv.includes('--force') }); return { extension, sync }; })()
        : command === 'guide'
          ? guide()
          : command === 'status'
          ? { status: (await ready()).ready ? 'ready' : 'stopped', cdpUrl: ENDPOINT, profile: PROFILE }
          : (() => { throw new Error('用法：node test/dev-browser.cjs status|build|sync|ensure|guide'); })();
    console.log(JSON.stringify(result, null, 2));
    if (command === 'sync' && result.sync && result.sync.status !== 'ready') process.exit(result.sync.status === 'failed' ? 1 : 2);
    if (command === 'ensure' && result.status !== 'ready' && result.status !== 'ready-existing') process.exit(result.status === 'failed' ? 1 : 2);
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', cdpUrl: ENDPOINT, profile: PROFILE,
      error: String(error && error.message || error) }, null, 2));
    process.exit(1);
  }
})();

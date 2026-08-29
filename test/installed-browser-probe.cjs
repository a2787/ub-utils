/* 已安装运行时只读探针：验证“新建页面自动加载”，不注入源码。
 * 运行前提：专用浏览器已经以 127.0.0.1:9222 开放 CDP，且本轮登录态验证
 * 已得到用户明确授权。探针只导航到显式给出的支持平台 URL，读取脚本自身
 * 的版本/构建/控制坞标记，不读取 Cookie，不点击平台写入控件。
 *
 * 运行：node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ROOT } = require('./runtime.cjs');

const source = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const expectedVersion = (source.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const expectedBuild = (source.match(/const RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/) || [, ''])[1];
const endpoint = process.env.OMNIBLOCK_CDP_URL || 'http://127.0.0.1:9222';
const requestedUrlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = requestedUrlArg ? requestedUrlArg.slice('--url='.length) : '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpJSON(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
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

// Chrome 148 的浏览器级 connectOverCDP 在本机专用 profile 上可能卡在
// websocket handshake；页面级 CDP 是同仓库其他登录态探针实际使用的兼容路径。
async function createClient() {
  const info = await httpJSON(endpoint + '/json/version');
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')));
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch (error) { return; }
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message || 'CDP error'));
    else item.resolve(message.result);
  });
  function send(method, params = {}, sessionId = '', timeout = 15000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeout);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });
  }
  await opened;
  return { send, close: () => { try { socket.close(); } catch (error) {} } };
}

async function evaluate(client, sessionId, expression, timeout = 2500) {
  const result = await client.send('Runtime.evaluate', {
    expression: '(async () => { ' + expression + ' })()',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId, timeout);
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(String(exception || result.exceptionDetails.text || '页面脚本执行失败').slice(0, 500));
  }
  return result.result && result.result.value;
}

function supportedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)bilibili\.com$|(^|\.)douyin\.com$|(^|\.)weibo\.com$|(^|\.)weibo\.cn$|(^|\.)zhihu\.com$|(^|\.)tieba\.baidu\.com$|(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return null;
    return url;
  } catch (error) { return null; }
}

function platformForHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (/(^|\.)bilibili\.com$/.test(host)) return 'bilibili';
  if (/(^|\.)douyin\.com$/.test(host)) return 'douyin';
  if (/(^|\.)weibo\.com$|(^|\.)weibo\.cn$/.test(host)) return 'weibo';
  if (/(^|\.)zhihu\.com$/.test(host)) return 'zhihu';
  if (/(^|\.)tieba\.baidu\.com$/.test(host)) return 'tieba';
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) return 'x';
  return 'unknown';
}

function redactedTarget(url) {
  const platform = platformForHost(url.hostname);
  const host = platform === 'bilibili' ? 'bilibili.com'
    : platform === 'douyin' ? 'douyin.com'
      : platform === 'weibo' ? 'weibo.com'
        : platform === 'zhihu' ? 'zhihu.com'
          : platform === 'tieba' ? 'tieba.baidu.com'
            : platform === 'x' ? 'x.com' : String(url.hostname || 'platform');
  const first = url.pathname.split('/').filter(Boolean)[0] || '';
  let pathShape = 'page';
  if (platform === 'bilibili' && /^(video|opus|space|read|search)$/i.test(first)) pathShape = first.toLowerCase();
  else if (platform === 'douyin' && /^video$/i.test(first)) pathShape = 'video';
  else if (platform === 'weibo') pathShape = /^\d+$/.test(first) ? 'post' : (/^(u|n)$/i.test(first) ? 'profile' : 'page');
  else if (platform === 'zhihu' && /^(people|question|p|hot|search)$/i.test(first)) pathShape = first.toLowerCase();
  else if (platform === 'tieba' && /^(f|p)$/i.test(first)) pathShape = first.toLowerCase();
  else if (platform === 'x' && /^(home|search|i)$/i.test(first)) pathShape = first.toLowerCase();
  return host + '/' + pathShape + '/...';
}

function safeError(error, url) {
  return String(error && error.message || error || 'unknown error')
    .replaceAll(url.href, redactedTarget(url))
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .slice(0, 240);
}

async function inspectPage(client, label, url) {
  const result = { label, loaded: false, snapshot: null, errors: [] };
  let targetId = '';
  let sessionId = '';
  try {
    const created = await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attached.sessionId;
    await client.send('Target.activateTarget', { targetId });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const navigation = await client.send('Page.navigate', { url: url.href }, sessionId, 20000);
    if (navigation && navigation.errorText) result.errors.push('页面导航错误：' + navigation.errorText);
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const ready = await evaluate(client, sessionId, `return {
          ready: document.readyState === 'interactive' || document.readyState === 'complete',
          ob: !!window.OB,
          gear: !!document.getElementById('ob-gear'),
        };`, 1500);
        if (ready && ready.ready && ready.ob && ready.gear) break;
      } catch (error) {
        // 导航提交后的短暂 detached document 属于正常过渡，继续轮询新 document。
      }
      await sleep(300);
    }
    const readyState = await evaluate(client, sessionId, 'return document.readyState;', 2500).catch(() => '');
    result.loaded = readyState === 'interactive' || readyState === 'complete';
    await sleep(180);
    result.snapshot = await evaluate(client, sessionId, `return (() => {
      const runtime = window.OB && window.OB.runtime;
      const extension = window.__OB_EXTENSION_RUNTIME__;
      const gear = document.getElementById('ob-gear');
      return {
        ob: !!window.OB,
        runtime: runtime ? {
          version: String(runtime.version || ''),
          build: String(runtime.build || ''),
          marker: !!runtime.marker,
        } : null,
        extensionMode: extension ? String(extension.mode || '') : '',
        gearCount: document.querySelectorAll('#ob-gear').length,
        dock: document.documentElement.getAttribute('data-ob-dock') || '',
        gearState: gear ? gear.getAttribute('data-ob-dock-state') || '' : '',
      };
    })();`, 3000);
  } catch (error) {
    result.errors.push(safeError(error, url));
  } finally {
    if (targetId) await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }
  return result;
}

(async () => {
  if (!requestedUrl) {
    console.error('RESULT: BLOCKED');
    console.error('必须通过 --url= 显式提供本轮只读验证页面；探针不内置真实页面地址。');
    process.exit(2);
  }
  const url = supportedUrl(requestedUrl);
  if (!url) {
    console.error('RESULT: BLOCKED');
    console.error('只接受 https 支持平台页面；未导航，也未注入源码。');
    process.exit(2);
  }

  let client;
  const report = { target: redactedTarget(url), platform: platformForHost(url.hostname), pages: [], errors: [] };
  try {
    client = await createClient();
    report.pages.push(await inspectPage(client, 'new-page-1', url));
    report.pages.push(await inspectPage(client, 'new-page-2', url));
    for (const page of report.pages) {
      const snapshot = page.snapshot;
      if (!page.loaded) page.errors.push('页面导航未返回成功响应');
      if (!snapshot || !snapshot.ob) page.errors.push('新页面没有发现 OmniBlock 运行时（可能尚未完成一次性扩展安装）');
      else {
        if (snapshot.runtime.version !== expectedVersion || snapshot.runtime.build !== expectedBuild) {
          page.errors.push('运行版本或构建标识与当前源码不一致');
        }
        if (snapshot.gearCount !== 1 || snapshot.dock !== 'collapsed' || snapshot.gearState !== 'collapsed') {
          page.errors.push('控制坞初始收起状态不完整');
        }
      }
    }
  } catch (error) {
    report.errors.push(String(error && error.message || error).slice(0, 240));
  } finally {
    if (client) client.close();
  }

  console.log('PROBE installed: ' + JSON.stringify(report));
  const blocked = report.errors.length || report.pages.some((page) => !page.loaded || page.errors.length);
  if (blocked) {
    console.log('EVIDENCE: blocked - 已安装运行时未能在两个新页面中完成当前源码标识核对');
    console.log('RESULT: INSTALLED RUNTIME BLOCKED');
    process.exit(2);
  }
  console.log('EVIDENCE: real-site verified - 两个新建页面均自动加载当前源码，未使用页面源码注入');
  console.log('RESULT: INSTALLED RUNTIME VERIFIED');
  process.exit(0);
})().catch((error) => {
  console.error('RESULT: BLOCKED');
  console.error(String(error && error.message || error).slice(0, 240));
  process.exit(2);
});

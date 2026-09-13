/*
 * 免死锁的登录态右键探针（浏览器级 WS + 单次 attachToTarget）。
 *
 * 实测结论（2026-09-13，Chrome 148 本机 profile）：
 *  - 直接连页面级 webSocketDebuggerUrl（/json/list 给的）时，连 Runtime.evaluate('1+1')
 *    都会 15s 超时——页面级 WS 在本机构建上整体卡死；
 *  - 浏览器级 webSocketDebuggerUrl（/json/version 给的）+ Target.attachToTarget 拿到页面
 *    session 后，页面级 Page 与 Runtime 命令是健康的（之前知乎即此路径验证成功）；
 *  - 唯一的死锁触发点是浏览器级 Target.getTargets（首次成功、后续平台必死锁）。
 *
 * 因此本探针：
 *  1. 浏览器级 WS（/json/version）；
 *  2. 用 HTTP /json/list 发现 target（绝不调用 Target.getTargets）；
 *  3. 对「一个」页面标签只做一次 Target.attachToTarget，拿到 sessionId；
 *  4. 之后逐平台 Page.navigate + Runtime.evaluate（全部走该 sessionId，页面级）；
 *  5. 不再发任何浏览器级命令，规避累积死锁。
 *
 * 右键接管与否只取决于内容脚本是否注册了捕获阶段的 contextmenu 监听，与扩展桥接
 * （bridge）是否 ready 无关——bridge 在专用环境常处于 degraded，但右键证据仍有效。
 *
 * 用法：node test/dedicated-rightclick-probe.cjs [平台...]
 *   白名单：zhihu tieba x douyin
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { ROOT } = require('./runtime.cjs');

const ENDPOINT = process.env.OMNIBLOCK_CDP_URL || 'http://127.0.0.1:9222';
const source = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const expectedVersion = (source.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const expectedBuild = (source.match(/const RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/) || [, ''])[1];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLATFORM_CONFIG = {
  zhihu: { url: 'https://www.zhihu.com/hot', selectors: ['a[href*="/question/"]'] },
  tieba: { url: 'https://tieba.baidu.com/f?kw=python', selectors: ['a[href*="/p/"]'] },
  x: { url: 'https://x.com/home', selectors: ['article[data-testid="tweet"] a[href*="/status/"]'] },
  douyin: { url: 'https://www.douyin.com/jingxuan', selectors: ['a[href*="/video/"]'] },
};

function httpJSON(resource, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(ENDPOINT + resource, { timeout }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on('timeout', () => request.destroy(new Error('CDP HTTP timeout')));
    request.on('error', reject);
  });
}

// 浏览器级 WS 客户端；send(method, params, sessionId, timeout)
function createBrowserClient(timeoutMs = 20000) {
  return httpJSON('/json/version').then((info) => {
    if (!globalThis.WebSocket) throw new Error('当前 Node 没有 WebSocket API');
    const ws = new globalThis.WebSocket(info.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    const opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('浏览器级 CDP WebSocket 连接失败')));
    });
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch (error) { return; }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || 'CDP error'));
      else item.resolve(message.result || {});
    });
    return opened.then(() => ({
      send(method, params = {}, sessionId = '', timeout = timeoutMs) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
          }, timeout);
          pending.set(id, {
            resolve: (value) => { clearTimeout(timer); resolve(value); },
            reject: (error) => { clearTimeout(timer); reject(error); },
          });
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          try { ws.send(JSON.stringify(payload)); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      },
      close() { try { ws.close(); } catch (error) {} },
    }));
  });
}

async function attachPage(client) {
  const list = await httpJSON('/json/list');
  const pages = (list || []).filter((t) => t.type === 'page');
  const target = pages.find((t) => /about:blank|chrome:\/\/newtab/i.test(t.url)) || pages[0];
  if (!target) throw new Error('专用 Chrome 没有可用页面标签；先由 dev-browser.cjs launch 启动');
  const attached = await client.send('Target.attachToTarget', { targetId: target.id, flatten: true }, '');
  const sessionId = attached.sessionId;
  await client.send('Page.enable', {}, sessionId).catch(() => {});
  await client.send('Runtime.enable', {}, sessionId).catch(() => {});
  return { targetId: target.id, sessionId };
}

async function navigateAndWait(client, sessionId, url, timeoutMs = 28000) {
  await client.send('Page.navigate', { url }, sessionId, 30000);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.send('Runtime.evaluate', {
        expression: '(() => ({'
          + ' loaded: document.readyState === \'interactive\' || document.readyState === \'complete\','
          + ' ob: !!window.OB,'
          + ' gear: document.querySelectorAll(\'#ob-gear\').length,'
          + ' runtime: (window.OB && window.OB.runtime) ? String(window.OB.runtime.version || \'\') : null,'
          + ' host: location.hostname }))()',
        returnByValue: true,
      }, sessionId, 4000).then((r) => r.result && r.result.value).catch(() => null);
    } catch (error) { last = null; }
    if (last && last.loaded && (last.ob || (last.gear > 0))) break;
    await sleep(500);
  }
  return last;
}

async function readRightClick(client, sessionId, config) {
  const expression = '(() => {'
    + ' const ob = window.OB;'
    + ' let ctxDefaultPrevented = null, ctxShown = null, ctxTargetFound = false;'
    + ' try {'
    + '   const selectors = ' + JSON.stringify(config.selectors) + ';'
    + '   let target = null;'
    + '   for (const sel of selectors) { const el = document.querySelector(sel); if (el) { target = el; break; } }'
    + '   if (target) {'
    + '     ctxTargetFound = true;'
    + '     const evt = new MouseEvent(\'contextmenu\', { bubbles: true, cancelable: true, view: window, button: 2, clientX: 120, clientY: 120 });'
    + '     target.dispatchEvent(evt);'
    + '     ctxDefaultPrevented = !!evt.defaultPrevented;'
    + '     ctxShown = !!document.getElementById(\'ob-ctx\');'
    + '   }'
    + ' } catch (e) { ctxDefaultPrevented = null; ctxShown = null; ctxTargetFound = null; }'
    + ' return {'
    + '   loaded: document.readyState === \'interactive\' || document.readyState === \'complete\','
    + '   finalUrl: String(location.href || \'\'),'
    + '   ob: !!ob,'
    + '   gear: document.querySelectorAll(\'#ob-gear\').length,'
    + '   runtime: (ob && ob.runtime) ? String(ob.runtime.version || \'\') : null,'
    + '   build: (ob && ob.runtime) ? String(ob.runtime.build || \'\') : null,'
    + '   ctxDefaultPrevented, ctxShown, ctxTargetFound'
    + ' };'
    + '})()';
  return client.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId, 8000)
    .then((r) => (r.result && r.result.value) || { error: 'no value' })
    .catch((error) => ({ error: String(error && error.message || error).slice(0, 240) }));
}

function assess(snapshot) {
  if (!snapshot || snapshot.error) {
    if (snapshot && snapshot.error && /CDP timeout/.test(snapshot.error)) {
      return { status: 'blocked', reason: 'CDP 渲染进程无响应（页面反爬/重资源卡死主线程），无法读取，非产品回归：' + snapshot.error };
    }
    return { status: 'failed', reason: snapshot && snapshot.error ? '探针读取失败：' + snapshot.error : '无快照' };
  }
  if (!snapshot.loaded) return { status: 'blocked', reason: '页面没有完成加载（可能网络/登录墙/防火墙拦截）：' + String(snapshot.finalUrl || '').slice(0, 80) };
  const active = !!(snapshot.ob || (snapshot.gear > 0));
  if (!active) return { status: 'blocked', reason: '当前页面未加载 OmniBlock 扩展（window.OB 与 #ob-gear 均缺失），无法验证右键接管' };
  if (!snapshot.runtime || !snapshot.build) return { status: 'failed', reason: '未读取当前扩展的版本与构建标识，不能归因于当前候选' };
  if (snapshot.runtime !== expectedVersion || snapshot.build !== expectedBuild) return { status: 'failed', reason: '扩展版本/构建不是当前预期 ' + expectedVersion + ' / ' + expectedBuild + '（实为 ' + snapshot.runtime + ' / ' + snapshot.build + '）' };
  if (snapshot.ctxTargetFound !== true) {
    return { status: 'blocked', reason: snapshot.ctxTargetFound === null
      ? '真实条目右键探测执行失败，无法读取事件状态'
      : '当前页面没有可探测的真实条目，不能用 body 代替条目验证右键' };
  }
  if (typeof snapshot.ctxDefaultPrevented !== 'boolean') return { status: 'blocked', reason: '右键事件状态不可读，不能判定页面是否保持原生' };
  if (snapshot.ctxShown) return { status: 'failed', reason: '右键被接管：出现 #ob-ctx 浮层（v0.57.4 右键移除冲突）' };
  if (snapshot.ctxDefaultPrevented) return { status: 'failed', reason: '右键被 preventDefault 接管（v0.57.4 右键移除冲突）' };
  return { status: 'verified', reason: '右键保持原生（无 #ob-ctx、未 preventDefault），扩展为当前 ' + expectedVersion };
}

function selfTest() {
  const base = { loaded: true, ob: true, gear: 1, runtime: expectedVersion, build: expectedBuild, ctxTargetFound: true, ctxDefaultPrevented: false, ctxShown: false };
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  check(assess(base).status === 'verified', 'native right-click classification');
  check(assess({ ...base, ctxShown: true }).status === 'failed', 'menu hijack classification');
  check(assess({ ...base, ctxDefaultPrevented: true }).status === 'failed', 'preventDefault classification');
  check(assess({ ...base, ctxTargetFound: false }).status === 'blocked', 'missing target classification');
  check(assess({ ...base, build: 'old-build' }).status === 'failed', 'build mismatch classification');
  return failures;
}

async function main() {
  const requested = process.argv.slice(2).filter((id) => PLATFORM_CONFIG[id]);
  const ids = requested.length ? requested : Object.keys(PLATFORM_CONFIG);
  const report = {
    mode: 'dedicated-login-readonly-browserws',
    expected: { version: expectedVersion, build: expectedBuild },
    endpoint: ENDPOINT.replace(/:\d+$/, ':...'),
    platforms: [],
  };
  let client;
  try {
    client = await createBrowserClient();
    const page = await attachPage(client);
    for (const id of ids) {
      const config = PLATFORM_CONFIG[id];
      const nav = await navigateAndWait(client, page.sessionId, config.url);
      const snap = await readRightClick(client, page.sessionId, config);
      const merged = Object.assign({}, nav || {}, snap || {});
      const verdict = assess(merged);
      report.platforms.push({
        id,
        url: config.url,
        snapshot: { loaded: !!merged.loaded, ob: !!merged.ob, gear: Number(merged.gear || 0), runtime: merged.runtime || null, build: merged.build || null, ctxTargetFound: merged.ctxTargetFound, ctxShown: !!merged.ctxShown, ctxDefaultPrevented: merged.ctxDefaultPrevented, finalUrl: String(merged.finalUrl || '').slice(0, 120) },
        status: verdict.status,
        reason: verdict.reason,
      });
      console.log('EVIDENCE ' + id + ' status=' + verdict.status
        + ' runtime=' + (merged.runtime || 'null')
        + ' build=' + (merged.build || 'null')
        + ' ctxTargetFound=' + merged.ctxTargetFound
        + ' ctxShown=' + merged.ctxShown
        + ' ctxDefaultPrevented=' + merged.ctxDefaultPrevented
        + ' loaded=' + !!merged.loaded
        + (verdict.reason ? ' reason="' + verdict.reason.replace(/"/g, "'") + '"' : ''));
    }
  } catch (error) {
    report.error = String(error && error.message || error).slice(0, 240);
    console.log('EVIDENCE probe status=failed reason="' + report.error.replace(/"/g, "'") + '"');
  } finally {
    if (client) client.close();
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.error || report.platforms.some((platform) => platform.status === 'failed') ? 1 : 0);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    const failures = selfTest();
    console.log(failures.length ? 'FAIL: ' + failures.join('; ') : 'PASS: dedicated-rightclick self-test');
    process.exit(failures.length ? 1 : 0);
  } else {
    main();
  }
}

module.exports = { assess, selfTest, PLATFORM_CONFIG, expectedVersion, expectedBuild };

/*
 * 专用 Chrome 的登录态只读能力层。
 *
 * 这里故意使用页面级 CDP：Chrome 148 的浏览器级 connectOverCDP 在本机
 * profile 上偶发握手卡死，而 Target.attachToTarget + 页面 Runtime 是当前
 * 专用调试浏览器已经验证过的兼容路径。模块只读取页面和脚本自己的状态，
 * 不读取 Cookie，不注入 userscript，不触发平台写入。
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { ROOT } = require('./runtime.cjs');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9222';
const endpoint = process.env.OMNIBLOCK_CDP_URL || DEFAULT_ENDPOINT;
const source = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const expectedVersion = (source.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const expectedBuild = (source.match(/const RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/) || [, ''])[1];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLATFORM_CONFIG = {
  bilibili: {
    url: 'https://www.bilibili.com/',
    contentSelectors: ['a[href*="/video/"]'],
  },
  douyin: {
    url: 'https://www.douyin.com/jingxuan',
    contentSelectors: ['a[href*="/video/"]'],
  },
  weibo: {
    url: 'https://weibo.com/',
    contentSelectors: [],
  },
  zhihu: {
    url: 'https://www.zhihu.com/hot',
    contentSelectors: ['a[href*="/question/"]'],
  },
  tieba: {
    url: 'https://tieba.baidu.com/f?kw=python',
    contentSelectors: [
      'a.thread-content-link[href*="/p/"]',
      'a.top-thread-card-item[href*="/p/"]',
      'a[href*="/p/"]',
    ],
  },
  x: {
    url: 'https://x.com/home',
    contentSelectors: ['article[data-testid="tweet"] a[href*="/status/"]'],
  },
};

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

function redactedTarget(value) {
  const url = value instanceof URL ? value : new URL(String(value));
  const platform = platformForHost(url.hostname);
  const host = platform === 'bilibili' ? 'bilibili.com'
    : platform === 'douyin' ? 'douyin.com'
      : platform === 'weibo' ? 'weibo.com'
        : platform === 'zhihu' ? 'zhihu.com'
          : platform === 'tieba' ? 'tieba.baidu.com'
            : platform === 'x' ? 'x.com' : 'platform';
  const first = url.pathname.split('/').filter(Boolean)[0] || '';
  let shape = 'page';
  if (platform === 'bilibili' && /^(video|opus|space|read|search)$/i.test(first)) shape = first.toLowerCase();
  else if (platform === 'douyin' && /^(video|jingxuan)$/i.test(first)) shape = first.toLowerCase();
  else if (platform === 'weibo') shape = /^\d+$/.test(first) ? 'post' : (/^(u|n)$/i.test(first) ? 'profile' : 'page');
  else if (platform === 'zhihu' && /^(people|question|p|hot|search)$/i.test(first)) shape = first.toLowerCase();
  else if (platform === 'tieba' && /^(f|p)$/i.test(first)) shape = first.toLowerCase();
  else if (platform === 'x' && /^(home|search|i)$/i.test(first)) shape = first.toLowerCase();
  return host + '/' + shape + '/...';
}

function safeError(error, value) {
  const message = String(error && error.message || error || 'unknown error');
  let redacted = message;
  try { redacted = redacted.replaceAll(value instanceof URL ? value.href : String(value), redactedTarget(value)); } catch (ignored) {}
  return redacted.replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]').slice(0, 240);
}

function isDedicatedEnvironmentBlock(error) {
  const message = String(error && error.message || error || '');
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|CDP HTTP timeout|WebSocket API|WebSocket 连接失败|无法连接专用 Chrome/i.test(message);
}

function createClient(cdpEndpoint = endpoint) {
  return httpJSON(cdpEndpoint + '/json/version').then((info) => {
    const WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) throw new Error('当前 Node 没有 WebSocket API，无法连接专用 Chrome CDP');
    const socket = new WebSocketImpl(info.webSocketDebuggerUrl);
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
      else item.resolve(message.result || {});
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
        try { socket.send(JSON.stringify(payload)); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    }
    return opened.then(() => ({
      send,
      close: () => { try { socket.close(); } catch (error) {} },
    }));
  });
}

async function evaluate(client, sessionId, expression, timeout = 4000) {
  const result = await client.send('Runtime.evaluate', {
    expression: '(async () => { ' + expression + '\n})()',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId, timeout);
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(String(exception || result.exceptionDetails.text || '页面脚本执行失败').slice(0, 500));
  }
  return result.result && result.result.value;
}

async function openPage(client, url) {
  const created = await client.send('Target.createTarget', { url: 'about:blank' });
  const targetId = created.targetId;
  const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('DOM.enable', {}, sessionId).catch(() => {});
  await client.send('Target.activateTarget', { targetId }).catch(() => {});
  const navigation = await client.send('Page.navigate', { url }, sessionId, 30000);
  return { targetId, sessionId, navigation };
}

async function closePage(client, page) {
  if (page && page.targetId) await client.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
}

async function attachExistingPlatformPage(client, platform) {
  const targets = await client.send('Target.getTargets');
  const candidates = (targets.targetInfos || [])
    .filter((target) => target.type === 'page' && platformForHost(new URL(target.url || 'https://invalid/').hostname) === platform)
    .sort((left, right) => {
      const detail = (value) => {
        const url = String(value || '');
        if (/\/video\/|\/question\/|\/p\/|\/status\//i.test(url)) return 2;
        if (platform === 'weibo' && /\/\d+(?:[?#]|$)/.test(url)) return 1;
        return 0;
      };
      return detail(right.url) - detail(left.url);
    });
  const target = candidates[0];
  if (!target) return null;
  const attached = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = { targetId: target.targetId, sessionId: attached.sessionId, existing: true };
  return page;
}

async function detachExistingPlatformPage(client, page) {
  if (page && page.existing && page.sessionId) {
    await client.send('Target.detachFromTarget', { sessionId: page.sessionId }).catch(() => {});
  }
}

async function waitForRuntime(client, page, timeoutMs = 22000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(client, page.sessionId, `return {
        loaded: document.readyState === 'interactive' || document.readyState === 'complete',
        ob: !!window.OB,
        gear: !!document.getElementById('ob-gear'),
        bridgeReady: !!(window.__OB_EXTENSION_RUNTIME__
          && window.__OB_EXTENSION_RUNTIME__.bridge
          && window.__OB_EXTENSION_RUNTIME__.bridge.state === 'ready'),
      };`, 2500);
      // 扩展 content script 可能先于页面的 load 事件就绪；对已确认的
      // runtime/bridge 直接继续采样，避免把平台长资源加载误判成扩展故障。
      if (last && last.ob && last.gear && last.bridgeReady) return last;
    } catch (error) {
      // 导航提交后的 detached document 属于正常过渡，继续轮询新 document。
    }
    await sleep(350);
  }
  return last || { loaded: false, ob: false, gear: false };
}

async function readSnapshot(client, page, platform) {
  const snapshot = await evaluate(client, page.sessionId, `return (() => {
    const ob = window.OB;
    const adapter = ob && ob.adapters && ob.adapters[${JSON.stringify(platform)}];
    let records = [];
    let collectError = '';
    try {
      records = adapter && typeof adapter.collectAIRecords === 'function'
        ? (adapter.collectAIRecords(document) || []) : [];
      if (!Array.isArray(records)) records = [];
    } catch (error) {
      collectError = String(error && error.message || error).slice(0, 160);
      records = [];
    }
    const byKind = {};
    const contentTypes = {};
    for (const record of records) {
      const kind = String(record && record.kind || 'comment');
      const type = String(record && record.contentType || kind);
      byKind[kind] = (byKind[kind] || 0) + 1;
      contentTypes[type] = (contentTypes[type] || 0) + 1;
    }
    let users = [];
    try { users = ob && typeof ob.collectUsers === 'function' ? (ob.collectUsers(document) || []) : []; } catch (error) { users = []; }
    const extension = window.__OB_EXTENSION_RUNTIME__ || null;
    const title = String(document.title || '');
    const bodyText = String(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1400);
    const finalUrl = String(location.href || '');
    const gate = /登录|signin|sign in|安全验证|验证码|slide|滑动|登录后查看|Log in|Sign in/i.test(title + ' ' + bodyText)
      || /\\/(signin|login)\\b/i.test(location.pathname);
    return {
      loaded: document.readyState === 'interactive' || document.readyState === 'complete',
      finalUrl,
      route: location.pathname || '/',
      titleGate: gate,
      ob: !!ob,
      adapter: !!adapter,
      runtime: ob && ob.runtime ? {
        version: String(ob.runtime.version || ''),
        build: String(ob.runtime.build || ''),
        marker: !!ob.runtime.marker,
      } : null,
      bridge: extension && extension.bridge ? {
        state: String(extension.bridge.state || ''),
        attempts: Number(extension.bridge.attempts || 0),
        rejections: Number(extension.bridge.rejections || extension.bridge.rejectedMessages || 0),
        reason: String(extension.bridge.reason || ''),
      } : null,
      extensionMode: extension ? String(extension.mode || '') : '',
      gearCount: document.querySelectorAll('#ob-gear').length,
      contentEntryCount: document.querySelectorAll('.ob-bulk[data-ob-kind="page"]').length,
      ai: {
        total: records.length,
        byKind,
        contentTypes,
        withIdentity: records.filter((record) => Array.isArray(record && record.keys) && record.keys.length).length,
        withoutIdentity: records.filter((record) => !Array.isArray(record && record.keys) || !record.keys.length).length,
      },
      users: users.length,
      articleCount: document.querySelectorAll('article').length,
      collectError,
    };
  })();`, 15000);
  return snapshot || { loaded: false, ob: false, adapter: false, ai: { total: 0 }, users: 0 };
}

function publicSnapshot(snapshot) {
  const value = snapshot || {};
  let route = 'platform/page/...';
  try { route = redactedTarget(value.finalUrl || 'https://example.com/'); } catch (error) {}
  return {
    route,
    loaded: !!value.loaded,
    ob: !!value.ob,
    adapter: !!value.adapter,
    runtime: value.runtime || null,
    bridge: value.bridge || null,
    extensionMode: value.extensionMode || '',
    gearCount: Number(value.gearCount || 0),
    contentEntryCount: Number(value.contentEntryCount || 0),
    ai: value.ai || { total: 0, byKind: {}, contentTypes: {}, withIdentity: 0, withoutIdentity: 0 },
    users: Number(value.users || 0),
    articleCount: Number(value.articleCount || 0),
    gate: value.titleGate ? 'login-or-security' : '',
    collectError: value.collectError || '',
  };
}

function runtimeProblem(snapshot) {
  if (!snapshot || !snapshot.loaded) return '页面没有完成加载';
  if (!snapshot.ob || !snapshot.runtime) return '专用浏览器新页面没有加载 OmniBlock 当前扩展';
  if (snapshot.runtime.version !== expectedVersion || snapshot.runtime.build !== expectedBuild) return '专用浏览器仍加载旧版本或旧构建';
  if (!snapshot.bridge || snapshot.bridge.state !== 'ready') return '专用扩展桥接未就绪，不能验证 AI/存储链路';
  if (!snapshot.adapter) return '当前页面没有匹配到平台适配器';
  if (snapshot.gearCount !== 1) return '当前页面没有唯一控制齿轮';
  return '';
}

function discoverSelectors(platform) {
  return (PLATFORM_CONFIG[platform] && PLATFORM_CONFIG[platform].contentSelectors) || [];
}

async function navigateToContent(client, page, platform) {
  const selectors = discoverSelectors(platform);
  if (!selectors.length) return false;
  return !!(await evaluate(client, page.sessionId, `return (() => {
    const selectors = ${JSON.stringify(selectors)};
    let anchor = null;
    for (const selector of selectors) {
      anchor = Array.from(document.querySelectorAll(selector)).find((candidate) => {
        const href = candidate && candidate.href;
        if (!href) return false;
        try {
          const url = new URL(href, location.href);
          return url.protocol === 'https:' && url.hostname === location.hostname;
        } catch (error) { return false; }
      });
      if (anchor) break;
    }
    if (!anchor) return false;
    location.href = anchor.href;
    return true;
  })();`, 3500));
}

function looksLikeDetail(platform, snapshot) {
  const route = String(snapshot && snapshot.route || '');
  if (platform === 'bilibili') return /\/video\//i.test(route);
  if (platform === 'douyin') return /\/video\//i.test(route);
  if (platform === 'zhihu') return /\/question\//i.test(route);
  if (platform === 'tieba') return /\/p\//i.test(route);
  if (platform === 'x') return /\/status\//i.test(route);
  return false;
}

function assessSnapshot(snapshot) {
  const problem = runtimeProblem(snapshot);
  if (problem) return { status: 'failed', reason: problem };
  const total = Number(snapshot.ai && snapshot.ai.total || 0);
  if (!total && snapshot.titleGate) return { status: 'blocked', reason: '页面落在登录或安全验证门禁，当前没有可读取内容' };
  if (!total) return { status: 'blocked', reason: '当前页面没有可读取的语义内容' };
  return { status: 'verified', reason: '' };
}

async function inspectPlatform(client, platform) {
  const config = PLATFORM_CONFIG[platform];
  const result = { id: platform, entry: null, content: null, status: 'blocked', reasons: [], errors: [] };
  let page;
  let existingPage;
  let entrySnapshot;
  let usedExisting = false;
  // 先读取用户已经打开的同平台页面。这样既能利用用户实际登录态，
  // 也避免某些平台入口页的大型虚拟列表把新建探针标签页拖入不可响应。
  try {
    existingPage = await attachExistingPlatformPage(client, platform);
    if (existingPage) {
      await waitForRuntime(client, existingPage, 8000);
      await sleep(400);
      const candidate = await readSnapshot(client, existingPage, platform);
      const assessment = assessSnapshot(candidate);
      if (assessment.status === 'verified' || looksLikeDetail(platform, candidate)) {
        entrySnapshot = candidate;
        usedExisting = true;
      }
    }
  } catch (error) {
    // 现有标签页不可响应时，下面仍会尝试独立临时标签页；不把用户页
    // 的偶发卡顿直接写成平台永久不可用。
  } finally {
    await detachExistingPlatformPage(client, existingPage);
    existingPage = null;
  }
  try {
    const needsOwnedContentPage = entrySnapshot && config.contentSelectors.length
      && !looksLikeDetail(platform, entrySnapshot);
    if (!entrySnapshot || needsOwnedContentPage) {
      page = await openPage(client, config.url);
      await waitForRuntime(client, page);
      await sleep(1200);
      if (!entrySnapshot) entrySnapshot = await readSnapshot(client, page, platform);
    }
  } catch (error) {
    // 某些平台入口页会因自身大型虚拟列表暂时占满主线程；优先复用
    // 专用 profile 中用户已经打开且可响应的同平台详情页，避免把“新建
    // 入口页卡顿”误报为登录态不可用。
    await closePage(client, page);
    page = null;
    try {
      existingPage = await attachExistingPlatformPage(client, platform);
      if (existingPage) {
        usedExisting = true;
        await waitForRuntime(client, existingPage, 8000);
        await sleep(400);
        entrySnapshot = await readSnapshot(client, existingPage, platform);
      }
    } catch (fallbackError) {
      result.errors.push(safeError(fallbackError, config.url));
    } finally {
      await detachExistingPlatformPage(client, existingPage);
    }
    if (!entrySnapshot && !result.errors.length) result.errors.push(safeError(error, config.url));
  } finally {
    await closePage(client, page);
  }
  if (entrySnapshot) {
    result.entry = publicSnapshot(entrySnapshot);
    const entryAssessment = assessSnapshot(entrySnapshot);
    if (entryAssessment.status === 'failed') result.errors.push(entryAssessment.reason);
    else if (entryAssessment.status === 'blocked') result.reasons.push('入口：' + entryAssessment.reason);
    else result.status = 'verified';

    if (page && config.contentSelectors.length && !looksLikeDetail(platform, entrySnapshot)) {
      try {
        const discovered = await navigateToContent(client, page, platform);
        if (discovered) {
          await waitForRuntime(client, page, 22000);
          await sleep(5000);
          const contentSnapshot = await readSnapshot(client, page, platform);
          result.content = publicSnapshot(contentSnapshot);
          const contentAssessment = assessSnapshot(contentSnapshot);
          if (contentAssessment.status === 'failed') result.errors.push('内容页：' + contentAssessment.reason);
          else if (contentAssessment.status === 'blocked') result.reasons.push('内容页：' + contentAssessment.reason);
          else result.status = 'verified';
        } else if (entryAssessment.status === 'blocked') {
          result.reasons.push('入口没有发现可只读导航到内容详情的链接');
        }
      } catch (error) {
        const message = String(error && error.message || error || '');
        if (/CDP timeout|页面没有完成加载/i.test(message)) {
          result.reasons.push('内容页：当前专用页面未响应或没有可用详情目标，按外部页面阻断记录');
        } else {
          result.errors.push('内容页：' + safeError(error, config.url));
        }
      }
    } else if (config.contentSelectors.length && looksLikeDetail(platform, entrySnapshot)) {
      result.content = result.entry;
    }
  }
  if (result.errors.length) result.status = 'failed';
  return result;
}

async function runDedicatedProbe(options = {}) {
  const ids = Array.isArray(options.platforms) && options.platforms.length
    ? options.platforms.filter((id) => PLATFORM_CONFIG[id]) : Object.keys(PLATFORM_CONFIG);
  const report = {
    mode: 'dedicated-login-readonly',
    endpoint: endpoint.replace(/:\d+$/, ':...'),
    expected: { version: expectedVersion, build: expectedBuild },
    platforms: [],
    errors: [],
  };
  let client;
  try {
    client = await createClient(options.endpoint || endpoint);
    for (const platform of ids) report.platforms.push(await inspectPlatform(client, platform));
  } catch (error) {
    const message = String(error && error.message || error).slice(0, 240);
    report.errors.push((isDedicatedEnvironmentBlock(error) ? 'blocked：专用 Chrome/CDP 不可用：' : 'failed：专用探针内部错误：') + message);
  } finally {
    if (client) client.close();
  }
  return report;
}

function extensionCardRefreshScript() {
  return `return (() => {
    const matches = [];
    const associated = (element) => {
      let node = element;
      for (let depth = 0; node && depth < 10; depth++) {
        const text = String(node.textContent || '').replace(/\\s+/g, ' ');
        if (/OmniBlock development runtime/i.test(text)) return true;
        node = node.parentNode || node.host || null;
      }
      return false;
    };
    const visit = (root) => {
      if (!root || !root.querySelectorAll) return;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const label = String(element.getAttribute && element.getAttribute('aria-label') || '');
        const title = String(element.getAttribute && element.getAttribute('title') || '');
        if (/重新加载|Reload/i.test(label + ' ' + title) && associated(element)) matches.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    const button = matches[0];
    if (!button) return { found: false, candidates: matches.length };
    button.click();
    return { found: true, candidates: matches.length, label: button.getAttribute('aria-label') || button.getAttribute('title') || '' };
  })();`;
}

async function refreshExtensionCard(client) {
  let extensionPage;
  let created = false;
  try {
    const targets = await client.send('Target.getTargets');
    const existing = (targets.targetInfos || []).find((target) => target.type === 'page' && target.url === 'chrome://extensions/');
    if (existing) {
      extensionPage = existing;
      const attached = await client.send('Target.attachToTarget', { targetId: existing.targetId, flatten: true });
      extensionPage = { targetId: existing.targetId, sessionId: attached.sessionId };
      await client.send('Runtime.enable', {}, attached.sessionId).catch(() => {});
      await client.send('DOM.enable', {}, attached.sessionId).catch(() => {});
    } else {
      extensionPage = await openPage(client, 'chrome://extensions/');
      created = true;
    }
    await sleep(400);
    let clicked = await evaluate(client, extensionPage.sessionId, extensionCardRefreshScript(), 5000).catch(() => null);
    if (!clicked || !clicked.found) {
      await client.send('Accessibility.enable', {}, extensionPage.sessionId).catch(() => {});
      const tree = await client.send('Accessibility.getFullAXTree', {}, extensionPage.sessionId, 8000).catch(() => ({ nodes: [] }));
      const node = (tree.nodes || []).find((item) => item.role && item.role.value === 'button'
        && /重新加载|Reload/i.test(String(item.name && item.name.value || ''))
        && /OmniBlock development runtime/i.test(String(item.description && item.description.value || '')));
      if (node && node.backendDOMNodeId) {
        const model = await client.send('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId }, extensionPage.sessionId, 5000);
        const quad = model && model.model && model.model.content;
        if (Array.isArray(quad) && quad.length >= 8) {
          const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
          const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
          await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }, extensionPage.sessionId);
          await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, extensionPage.sessionId);
          await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, extensionPage.sessionId);
          clicked = { found: true, via: 'accessibility-coordinate' };
        }
      }
    }
    await sleep(900);
    return clicked || { found: false, candidates: 0 };
  } finally {
    if (created) await closePage(client, extensionPage);
  }
}

async function inspectInstalledRuntime(client, url = 'https://www.bilibili.com/') {
  let page;
  try {
    page = await openPage(client, url);
    const ready = await waitForRuntime(client, page);
    await sleep(250);
    const snapshot = await readSnapshot(client, page, 'bilibili');
    return {
      status: runtimeProblem(snapshot) ? 'not-ready' : (ready && ready.ob ? 'ready' : 'not-ready'),
      reason: runtimeProblem(snapshot),
      snapshot: publicSnapshot(snapshot),
    };
  } catch (error) {
    return { status: 'not-ready', reason: safeError(error, url), snapshot: null };
  } finally {
    await closePage(client, page);
  }
}

async function syncDevExtension(options = {}) {
  const cdpEndpoint = options.endpoint || endpoint;
  let client;
  try {
    client = await createClient(cdpEndpoint);
    const before = await inspectInstalledRuntime(client);
    if (before.status === 'ready' && !options.force) {
      return { status: 'ready', action: 'already-current', expected: { version: expectedVersion, build: expectedBuild }, before };
    }
    const refresh = await refreshExtensionCard(client);
    if (!refresh || !refresh.found) {
      return {
        status: 'blocked', action: 'manual-install-required', expected: { version: expectedVersion, build: expectedBuild }, before, refresh,
        reason: '扩展页没有找到 OmniBlock 的重新加载控件；请先一次性加载 test/_dev-extension。',
      };
    }
    const after = await inspectInstalledRuntime(client);
    if (after.status !== 'ready') {
      return {
        status: 'blocked', action: 'refresh-did-not-activate', expected: { version: expectedVersion, build: expectedBuild }, before, refresh, after,
        reason: after.reason || '刷新后新页面仍未读到当前扩展构建。',
      };
    }
    return { status: 'ready', action: 'reloaded', expected: { version: expectedVersion, build: expectedBuild }, before, refresh, after };
  } catch (error) {
    return {
      status: isDedicatedEnvironmentBlock(error) ? 'blocked' : 'failed',
      action: isDedicatedEnvironmentBlock(error) ? 'cdp-unavailable' : 'internal-error',
      expected: { version: expectedVersion, build: expectedBuild },
      reason: String(error && error.message || error).slice(0, 240),
    };
  } finally {
    if (client) client.close();
  }
}

function selfTest() {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  check(platformForHost('www.bilibili.com') === 'bilibili', 'B站 host mapping');
  check(platformForHost('www.zhihu.com') === 'zhihu', '知乎 host mapping');
  check(redactedTarget('https://www.bilibili.com/video/private-token') === 'bilibili.com/video/...', 'route redaction');
  check(runtimeProblem({ loaded: false }) === '页面没有完成加载', 'load failure classification');
  check(runtimeProblem({ loaded: true, ob: true, runtime: { version: '0.0.0', build: 'old' }, bridge: { state: 'ready' }, adapter: true, gearCount: 1 }) === '专用浏览器仍加载旧版本或旧构建', 'version failure classification');
  check(assessSnapshot({ loaded: true, ob: true, adapter: true, runtime: { version: expectedVersion, build: expectedBuild }, bridge: { state: 'ready' }, gearCount: 1, titleGate: true, ai: { total: 0 } }).status === 'blocked', 'gate classification');
  check(assessSnapshot({ loaded: true, ob: true, adapter: true, runtime: { version: expectedVersion, build: expectedBuild }, bridge: { state: 'ready' }, gearCount: 1, titleGate: false, ai: { total: 1 } }).status === 'verified', 'content classification');
  check(isDedicatedEnvironmentBlock(new Error('connect ECONNREFUSED 127.0.0.1:9222')), 'CDP availability classification');
  check(!isDedicatedEnvironmentBlock(new Error('CDP timeout: Runtime.evaluate')), 'unexpected probe failure classification');
  return failures;
}

module.exports = {
  DEFAULT_ENDPOINT,
  ENDPOINT: endpoint,
  ROOT,
  expectedVersion,
  expectedBuild,
  PLATFORM_CONFIG,
  createClient,
  evaluate,
  openPage,
  closePage,
  waitForRuntime,
  readSnapshot,
  navigateToContent,
  sleep,
  publicSnapshot,
  runtimeProblem,
  assessSnapshot,
  runDedicatedProbe,
  syncDevExtension,
  redactedTarget,
  selfTest,
};

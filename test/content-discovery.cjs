/*
 * 内容链接发现共享模块（OB-MAINT-004）。
 *
 * 背景：2026 版 B 站等 SPA 入口页把内容详情链接渲染进 open shadow root
 * （自定义元素嵌套），浅层 document.querySelectorAll('a[href]') / CSS 选择器
 * 找不到任何目标；2026-10-28 专用登录态会话的临时诊断脚本（_probe_features.cjs、
 * _probe_diag*.cjs，均未入库）确认了该形态，并验证「深度遍历 + 路由形状匹配」
 * 可以发现目标。此前 test/discover.cjs（隔离匿名探针证据链）与
 * test/dedicated-browser.cjs navigateToContent（专用登录态探针证据链）各自维护
 * 浅层发现实现；本模块把两条证据链收敛到同一实现。
 *
 * 两个策略：
 *  策略 1（collectDeepHrefs）：Shadow DOM 深度遍历 —— 只进入 open shadowRoot
 *          （closed root 对页面脚本不可达，保持不可见），含嵌套；深度与锚点
 *          数量有界（默认 40 层 / 2000 锚点，界值沿用 2026-10-28 专用会话
 *          捕获形态）。锚点匹配大小写不敏感（HTML 'A' / SVG 'a'），收集面是
 *          旧 querySelectorAll('a[href]') 的严格超集；SVG 锚点的
 *          SVGAnimatedString href 与旧实现同样无法产出可用目标（DISC-8）。
 *  策略 2（filterRouteShapes）：href 路由形状匹配 —— 以 pathname 前缀形状
 *          （^/video/、^/question/、^/p/、^/<user>/status/ 等）取代
 *          a[href*=...] 浅层选择器；保留 https-only 与可选同主机约束，
 *          避免只读探针导航到第三方域。
 *
 * collectDeepHrefs 与 filterRouteShapes 是自包含纯函数（不引用任何模块级
 * 标识符），可整体序列化进页面上下文（Runtime.evaluate / page.evaluate），
 * 也可在 Node 夹具中直接调用；deepHrefsExpression 生成页面上下文表达式。
 * 本文件被直接运行时（node test/content-discovery.cjs）执行人工合成 SPA
 * 夹具自测：页面浅层无任何 <a>，目标链接位于嵌套 open shadow root。
 * 夹具注明：人工合成，结构来自 2026-10-28 专用会话捕获形态；不含任何
 * 真实页面标识（BV 号/uid 等）。
 */
'use strict';

// 各平台内容详情页 pathname 形状（正则源字符串，可 JSON 序列化后进页面上下文）。
// 形状来源：2026-10-28 专用会话捕获（B 站 ^/video/<id>）+ 既有
// test/dedicated-browser.cjs PLATFORM_CONFIG 选择器中的路由子串
// （zhihu /question/、tieba /p/、x /status/、douyin /video/）。
const ROUTE_SHAPES = {
  bilibili: ['^/video/[^/]+'],
  douyin: ['^/video/[^/]+'],
  zhihu: ['^/question/[0-9]+'],
  tieba: ['^/p/[0-9]+'],
  x: ['^/[^/]+/status/[0-9]+'],
};

// 深度遍历默认界值（与 2026-10-28 专用会话捕获一致的量级，防止超长 SPA 拖垮探针）。
const DEFAULT_DEEP_OPTIONS = { maxDepth: 40, maxAnchors: 2000 };

// 自包含（页面上下文可用）：从 root（Document/ShadowRoot/Element）深度遍历
// <a href>，进入 open shadowRoot，按文档顺序返回绝对 href 字符串数组。
// 锚点匹配大小写不敏感（HTML 锚点 tagName 为 'A'，SVG 锚点为 'a'），保持收集
// 面是旧实现 document.querySelectorAll('a[href]') 的严格超集；SVG 锚点的 href
// 是 SVGAnimatedString 对象而非字符串，旧实现的下游（accept 正则 / new URL）
// 必然拒绝、从未产出可用目标，这里同样只产出字符串 href，净效果一致
// （夹具 DISC-8 固化该等价性）。
function collectDeepHrefs(root, options) {
  var maxDepth = options && options.maxDepth > 0 ? options.maxDepth : 40;
  var maxAnchors = options && options.maxAnchors > 0 ? options.maxAnchors : 2000;
  var hrefs = [];
  var walk = function (node, depth) {
    if (!node || depth > maxDepth || hrefs.length >= maxAnchors) return;
    if (node.nodeType === 1) {
      var tag = node.tagName;
      if ((tag === 'A' || tag === 'a') && node.href && typeof node.href === 'string') {
        hrefs.push(node.href);
      }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      var children = node.children || [];
      for (var i = 0; i < children.length; i++) walk(children[i], depth + 1);
    } else if (node.nodeType === 9 || node.nodeType === 11) {
      var kids = node.children || [];
      for (var j = 0; j < kids.length; j++) walk(kids[j], depth + 1);
    }
  };
  try { walk(root, 0); } catch (error) { /* 页面脚本干扰遍历时返回已收集部分 */ }
  return hrefs;
}

// 自包含（页面上下文可用）：href 路由形状匹配。shapes 是 pathname 正则源
// 字符串数组；hostname 非空时要求同主机；httpsOnly 默认 true。
// 返回按输入顺序去重后的绝对 href 数组。
function filterRouteShapes(hrefs, shapes, options) {
  var hostname = options && options.hostname ? String(options.hostname) : '';
  var httpsOnly = !options || options.httpsOnly !== false;
  var patterns = [];
  var shapeList = shapes || [];
  for (var i = 0; i < shapeList.length; i++) {
    try { patterns.push(new RegExp(shapeList[i])); } catch (error) { /* 非法形状跳过 */ }
  }
  var out = [];
  for (var k = 0; k < (hrefs || []).length; k++) {
    var href = String(hrefs[k] || '');
    var url = null;
    try { url = new URL(href, (options && options.resolveBase) || undefined); } catch (error) { url = null; }
    if (!url) continue;
    if (httpsOnly && url.protocol !== 'https:') continue;
    if (hostname && url.hostname !== hostname) continue;
    var matched = false;
    for (var p = 0; p < patterns.length; p++) {
      if (patterns[p].test(url.pathname)) { matched = true; break; }
    }
    if (matched && out.indexOf(url.href) === -1) out.push(url.href);
  }
  return out;
}

// Node 侧便捷组合（collectDeepHrefs 引用了模块级标识符，不单独序列化进页面；
// 页面上下文请用 deepHrefsExpression + filterRouteShapes 组合）。
function collectContentLinks(root, options) {
  var hrefs = collectDeepHrefs(root, options);
  return filterRouteShapes(hrefs, options && options.shapes, options);
}

// 生成在页面上下文执行 collectDeepHrefs 的表达式字符串：
// CDP Runtime.evaluate / Playwright page.evaluate(字符串) 通用。
// rootExpr 默认 document，可换成其他可序列化根表达式。
function deepHrefsExpression(options, rootExpr) {
  return '(' + collectDeepHrefs.toString() + ')(' + (rootExpr || 'document') + ', '
    + JSON.stringify(options || DEFAULT_DEEP_OPTIONS) + ')';
}

// ---------------------------------------------------------------------------
// 人工合成 SPA 夹具自测（node test/content-discovery.cjs 直接运行时执行）。
// 夹具注明：人工合成，结构来自 2026-10-28 专用会话捕获形态；页面浅层无任何
// <a>，目标链接位于嵌套 open shadow root；不含真实页面标识。
// ---------------------------------------------------------------------------
const SYNTHETIC_HTML = `<!doctype html>
<html><head><title>synthetic-spa-discovery-fixture</title></head>
<body>
  <!-- 人工合成，结构来自 2026-10-28 专用会话捕获形态：宿主自定义元素 -->
  <!-- → 卡片自定义元素 → 各自 open shadowRoot，链接只存在于最内层 shadow root。 -->
  <div id="app"></div>
  <script>
    class BiliFeedSynth extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<bili-card-synth data-kind="video"></bili-card-synth>'
          + '<bili-card-synth data-kind="question"></bili-card-synth>'
          + '<bili-card-synth data-kind="http-neg"></bili-card-synth>'
          + '<bili-card-synth data-kind="cross-neg"></bili-card-synth>'
          // SVG 锚点（tagName 小写 'a'）：验证新收集器与旧 querySelectorAll
          // 收集面的等价性（DISC-8）。
          + '<svg width="8" height="8"><a href="https://www.bilibili.com/video/SVGNEG01"><text>svg-link</text></a></svg>';
      }
    }
    class BiliCardSynth extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        const kind = this.getAttribute('data-kind');
        const href = kind === 'video'
          ? 'https://www.bilibili.com/video/1SYNTH01A'
          : kind === 'question'
            ? 'https://www.zhihu.com/question/111111111'
            : kind === 'http-neg'
              ? 'http://www.bilibili.com/video/HTTPNEG01'
              : 'https://cross.example.com/video/CROSSNEG01';
        root.innerHTML = '<a href="' + href + '">synthetic-card-link</a>';
      }
    }
    class ClosedRootSynth extends HTMLElement {
      connectedCallback() {
        // closed shadow root 对页面脚本不可达，探针必须保持发现不到它。
        const root = this.attachShadow({ mode: 'closed' });
        root.innerHTML = '<a href="https://www.bilibili.com/video/CLOSEDNEG01">closed</a>';
      }
    }
    customElements.define('bili-card-synth', BiliCardSynth);
    customElements.define('bili-feed-synth', BiliFeedSynth);
    customElements.define('closed-root-synth', ClosedRootSynth);
    const app = document.getElementById('app');
    app.appendChild(document.createElement('bili-feed-synth'));
    app.appendChild(document.createElement('closed-root-synth'));
  </script>
</body></html>`;

// 旧 test/discover.cjs 浅层收集的逐字复刻（改动前实现），用于证明旧行为失败。
function legacyDiscoverHarvest() {
  return Array.from(document.querySelectorAll('a[href]')).map((a) => a.href);
}

// 旧 test/dedicated-browser.cjs navigateToContent 页内脚本的复刻。唯一差异：
// 把 location.hostname 换成显式 hostname 参数（本地夹具不在目标域上服务），
// 遍历与匹配逻辑逐字保留，失败原因因此只可能是"浅层看不到 shadow 内链接"。
function legacyNavigateReplica(selectors, hostname) {
  return (() => {
    let anchor = null;
    for (const selector of selectors) {
      anchor = Array.from(document.querySelectorAll(selector)).find((candidate) => {
        const href = candidate && candidate.href;
        if (!href) return false;
        try {
          const url = new URL(href, location.href);
          return url.protocol === 'https:' && url.hostname === hostname;
        } catch (error) { return false; }
      });
      if (anchor) break;
    }
    if (!anchor) return false;
    location.href = anchor.href;
    return true;
  })();
}

async function runFixture() {
  const { launchChromium } = require('./runtime.cjs');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  };

  const browser = await launchChromium({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
  });
  let page;
  try {
    page = await browser.newPage();
    await page.setContent(SYNTHETIC_HTML, { waitUntil: 'load' });
    await sleep(200);

    // DISC-0 夹具有效性：合成页浅层 DOM 没有任何 <a href>。
    const shallowHrefs = await page.evaluate('Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)');
    check('DISC-0 夹具有效性：合成 SPA 页面浅层无任何 <a href>', shallowHrefs.length === 0,
      '浅层 href 数=' + shallowHrefs.length);

    // DISC-1 旧行为（test/discover.cjs 改动前）复刻：浅层收集 + /video/、/question/
    // 路由过滤 → 0 目标。旧实现上确认失败。
    const legacyFound = await page.evaluate('(' + legacyDiscoverHarvest.toString() + ')()')
      .then((hrefs) => filterRouteShapes(hrefs, ['^/video/[^/]+', '^/question/[0-9]+'], { httpsOnly: true }));
    check('DISC-1 旧行为失败对照：旧 discover.cjs 浅层收集复刻发现 0 个 /video/ 或 /question/ 目标',
      legacyFound.length === 0, '旧实现发现数=' + legacyFound.length);

    // DISC-2 旧行为（test/dedicated-browser.cjs 改动前 navigateToContent）复刻：
    // 浅层 CSS 选择器（旧 PLATFORM_CONFIG.contentSelectors）→ 导航失败。
    const legacyNavVideo = await page.evaluate(
      '(' + legacyNavigateReplica.toString() + ')('
      + JSON.stringify(['a[href*="/video/"]']) + ', "www.bilibili.com")');
    const legacyNavQuestion = await page.evaluate(
      '(' + legacyNavigateReplica.toString() + ')('
      + JSON.stringify(['a[href*="/question/"]']) + ', "www.zhihu.com")');
    check('DISC-2 旧行为失败对照：旧 navigateToContent 浅层选择器复刻对 /video/ 与 /question/ 均返回 false',
      legacyNavVideo === false && legacyNavQuestion === false,
      'video=' + legacyNavVideo + ' question=' + legacyNavQuestion);

    // DISC-3 新实现：Shadow DOM 深度遍历发现全部 open shadow root 内链接
    //（closed root 不可达）。
    const deepHrefs = await page.evaluate(deepHrefsExpression());
    const hasVideo = deepHrefs.some((href) => href === 'https://www.bilibili.com/video/1SYNTH01A');
    const hasQuestion = deepHrefs.some((href) => href === 'https://www.zhihu.com/question/111111111');
    const closedLeak = deepHrefs.some((href) => String(href).indexOf('CLOSEDNEG01') !== -1);
    check('DISC-3 新实现发现：深度遍历同时发现 1 个 /video/ 与 1 个 /question/ 目标（共 '
      + deepHrefs.length + ' 个 open shadow 链接，closed root 保持不可见）',
      hasVideo && hasQuestion && deepHrefs.length === 4 && !closedLeak,
      'video=' + hasVideo + ' question=' + hasQuestion + ' total=' + deepHrefs.length + ' closedLeak=' + closedLeak);

    // DISC-4 新实现路由形状匹配（Node 侧纯函数运行，证明可导出复用）：
    // B 站形状 + 同主机 → 只有 /video/ 目标；知乎形状 + 同主机 → 只有 /question/ 目标。
    const videoMatches = filterRouteShapes(deepHrefs, ROUTE_SHAPES.bilibili,
      { hostname: 'www.bilibili.com', httpsOnly: true });
    const questionMatches = filterRouteShapes(deepHrefs, ROUTE_SHAPES.zhihu,
      { hostname: 'www.zhihu.com', httpsOnly: true });
    check('DISC-4 新实现路由形状匹配：/video/ 形状（同主机 https）命中 1 个、/question/ 形状命中 1 个',
      videoMatches.length === 1 && videoMatches[0] === 'https://www.bilibili.com/video/1SYNTH01A'
      && questionMatches.length === 1 && questionMatches[0] === 'https://www.zhihu.com/question/111111111',
      'video=' + videoMatches.length + ' question=' + questionMatches.length);

    // DISC-5 安全约束回归：http 目标与跨主机目标即使形状匹配也必须被排除。
    const unsafeMatches = filterRouteShapes(deepHrefs, ['^/video/[^/]+'], { httpsOnly: true });
    check('DISC-5 安全约束回归：无同主机约束时 http 目标被 https-only 排除、跨主机目标不混入主机过滤结果',
      unsafeMatches.every((href) => href.indexOf('HTTPNEG01') === -1)
      && videoMatches.every((href) => href.indexOf('CROSSNEG01') === -1),
      'shapes-only=' + unsafeMatches.length);

    // DISC-6 遍历界值：maxDepth 不足以到达嵌套 shadow 内链接时返回 0；
    // maxAnchors=1 时只返回首个锚点。
    const depthBound = await page.evaluate(deepHrefsExpression({ maxDepth: 3, maxAnchors: 2000 }));
    const anchorBound = await page.evaluate(deepHrefsExpression({ maxDepth: 40, maxAnchors: 1 }));
    check('DISC-6 遍历界值回归：maxDepth=3 发现 0 个、maxAnchors=1 只发现 1 个',
      depthBound.length === 0 && anchorBound.length === 1,
      'depthBound=' + depthBound.length + ' anchorBound=' + anchorBound.length);

    // DISC-7 两条证据链接线断言：discover.cjs 与 dedicated-browser.cjs 必须在
    // 调用点（require 语句、page.evaluate 调用、模板插值调用）使用本模块，
    // 而非仅在注释中出现字符串。
    const fs = require('fs');
    const path = require('path');
    const discoverSource = fs.readFileSync(path.join(__dirname, 'discover.cjs'), 'utf8');
    const dedicatedSource = fs.readFileSync(path.join(__dirname, 'dedicated-browser.cjs'), 'utf8');
    check('DISC-7 证据链接线（调用点级）：discover.cjs 的 page.evaluate 调用与 dedicated-browser.cjs '
      + '的模板插值调用均使用共享实现',
      /require\('\.\/content-discovery\.cjs'\)/.test(discoverSource)
      && /page\.evaluate\(deepHrefsExpression\(/.test(discoverSource)
      && /require\('\.\/content-discovery\.cjs'\)/.test(dedicatedSource)
      && /\$\{deepHrefsExpression\(DEFAULT_DEEP_OPTIONS\)\}/.test(dedicatedSource)
      && /\$\{filterRouteShapes\.toString\(\)\}/.test(dedicatedSource)
      && /contentRouteShapes\(platform\)/.test(dedicatedSource));

    // DISC-8 SVG 锚点等价性（独立复核 2026-10-28 提出）：旧收集面
    // querySelectorAll('a[href]') 能匹配 tagName 小写的 SVG 锚点；其 href 是
    // SVGAnimatedString 对象，旧下游（accept 正则 / new URL）必然拒绝、从未
    // 产出可用目标。新收集器大小写不敏感覆盖该锚点但只产出字符串 href，
    // 净效果与旧实现一致。
    const svgEquivalence = await page.evaluate(`(() => {
      const feed = document.querySelector('bili-feed-synth');
      const anchors = Array.from(feed.shadowRoot.querySelectorAll('a[href]'));
      const svgAnchor = anchors.find((el) => el.tagName === 'a'
        && String(el.getAttribute('href')).indexOf('SVGNEG01') !== -1);
      if (!svgAnchor) return { matchedByOldSurface: false };
      let oldDownstreamRejects = false;
      try { new URL(String(svgAnchor.href), location.href); } catch (error) { oldDownstreamRejects = true; }
      return {
        matchedByOldSurface: true,
        svgTag: svgAnchor.tagName,
        hrefType: typeof svgAnchor.href,
        hrefCoerced: String(svgAnchor.href),
        oldDownstreamRejects,
        anchorCount: anchors.length,
      };
    })()`);
    const svgNewRejects = filterRouteShapes([svgEquivalence.hrefCoerced], ROUTE_SHAPES.bilibili,
      { hostname: 'www.bilibili.com', httpsOnly: true }).length === 0;
    check('DISC-8 SVG 锚点等价性：旧收集面匹配 tagName 小写的 SVG 锚点（该 shadowRoot 共 '
      + svgEquivalence.anchorCount + ' 个 a[href]），其 href 为 ' + svgEquivalence.hrefType
      + '（"' + svgEquivalence.hrefCoerced + '"）在旧下游 URL 解析与新的路由过滤中同样被拒'
      + '（' + (svgEquivalence.oldDownstreamRejects ? 1 : 0) + '/' + (svgNewRejects ? 1 : 0) + '），'
      + '新深度结果不含 SVGNEG01',
      svgEquivalence.matchedByOldSurface && svgEquivalence.svgTag === 'a'
      && svgEquivalence.hrefType !== 'string' && svgEquivalence.oldDownstreamRejects && svgNewRejects
      && deepHrefs.every((href) => href.indexOf('SVGNEG01') === -1));
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const passed = results.filter((item) => item.ok).length;
  console.log('PASS: content-discovery ' + passed + '/' + results.length);
  if (passed !== results.length) process.exit(1);
}

module.exports = {
  ROUTE_SHAPES,
  DEFAULT_DEEP_OPTIONS,
  collectDeepHrefs,
  filterRouteShapes,
  collectContentLinks,
  deepHrefsExpression,
};

if (require.main === module) {
  runFixture().catch((error) => {
    console.error('FAIL: content-discovery fixture — ' + String(error && error.message || error));
    process.exit(1);
  });
}

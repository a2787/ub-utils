/* OmniBlock 深色模式（OB-UI-003）回归测试。
 * 夹具是人工合成 B站评论 DOM（沿用 ui-settings.cjs 的合成结构，另加
 * __INITIAL_STATE__ 以支撑内容弹窗 AI 标签页）；本测试不访问真实站点或真实模型。
 * 覆盖：
 *   DARK-1  浏览器级：Playwright emulateMedia 切换 colorScheme，断言设置面板、
 *           内容弹窗、确认气泡与自建确认浮层在深色下为深底浅字、浅色下为浅底深字，
 *           且 #ob-panel 的 color-scheme 计算值随媒体查询翻转（证明真正由
 *           prefers-color-scheme 驱动，不是写死的深色）。
 *   DARK-2  源码级：GM_addStyle 样式表末尾存在 @media (prefers-color-scheme: dark)
 *           覆盖段，含 ≥40 条选择器规则和 color-scheme: dark；浅色规则段不得
 *           出现其他 prefers-color-scheme。
 *   DARK-3  浅色行为回归：浅色（默认）下快捷拉黑 → 确认气泡 → 写入名单 →
 *           撤销 toast 的链路与旧行为一致（行为无变化）。
 * 运行：node test/dark-mode.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const LOCAL_VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

// WCAG 相对亮度：输入 getComputedStyle 的 rgb()/rgba() 字符串。
function luminance(cssColor) {
  const m = String(cssColor).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((v) => parseFloat(v));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(parts[0] / 255) + 0.7152 * lin(parts[1] / 255) + 0.0722 * lin(parts[2] / 255);
}

// ---- DARK-2：源码级断言 ----
const styleStart = USERSCRIPT.indexOf('GM_addStyle(`');
const styleEnd = styleStart >= 0 ? USERSCRIPT.indexOf('`);', styleStart) : -1;
const stylesheet = styleStart >= 0 && styleEnd > styleStart ? USERSCRIPT.slice(styleStart, styleEnd) : '';
const darkMarker = '@media (prefers-color-scheme: dark)';
const darkStart = stylesheet.indexOf(darkMarker);
const darkSection = darkStart >= 0 ? stylesheet.slice(darkStart) : '';
// 深色段内除媒体查询自身的 `{` 外，每个 `{` 都是一条规则（段内无嵌套花括号注释）。
const darkRuleCount = darkSection ? (darkSection.match(/\{/g) || []).length - 1 : 0;
const darkSchemeCount = (darkSection.match(/color-scheme: dark/g) || []).length;
const mediaQueryCount = (stylesheet.match(/@media \(prefers-color-scheme/g) || []).length;

const report = { pass: [], fail: [], console: [], pageErrors: [] };

if (darkSection && darkRuleCount >= 40) {
  report.pass.push('DARK-2 深色覆盖段含 ' + darkRuleCount + ' 条选择器规则（要求 ≥40）');
} else report.fail.push('DARK-2 深色覆盖段规则数不足：' + darkRuleCount);
if (darkSchemeCount >= 1) {
  report.pass.push('DARK-2 深色覆盖段声明 color-scheme: dark（' + darkSchemeCount + ' 处，用于原生控件与滚动条）');
} else report.fail.push('DARK-2 深色覆盖段缺少 color-scheme: dark');
if (mediaQueryCount === 1 && darkStart >= 0) {
  report.pass.push('DARK-2 全样式表只有 1 处 prefers-color-scheme（即深色覆盖段），浅色规则无媒体查询改动');
} else report.fail.push('DARK-2 prefers-color-scheme 出现次数异常：' + mediaQueryCount);
if (/\-\-ob\-dark\-bg:\s*#1c2030/.test(darkSection) && /--ob-dark-text:\s*#e8eaf2/.test(darkSection)) {
  report.pass.push('DARK-2 深色设计令牌就位（--ob-dark-bg #1c2030 家族 / --ob-dark-text #e8eaf2）');
} else report.fail.push('DARK-2 深色设计令牌缺失');

const SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true, localBackupEnabled:false, logEnabled:false } }) };
window.__nativeDialogs = { confirm: 0, prompt: 0, alert: 0 };
window.confirm = (msg) => { window.__nativeDialogs.confirm++; return true; };
window.prompt = (msg) => { window.__nativeDialogs.prompt++; return ''; };
window.alert = (msg) => { window.__nativeDialogs.alert++; };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name:'本地内容过滤增强', version:'${LOCAL_VERSION}', namespace:'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (o) => { if (o && o.onerror) { try { o.onerror(new Error('no net in test')); } catch(e){} } return { abort(){} }; };
window.GM_openInTab = () => {};
`;

// 人工合成夹具：B站评论 Shadow DOM 结构（与 ui-settings.cjs 同源），
// 外加 __INITIAL_STATE__ 供内容弹窗 AI 标签页使用。不含任何真实页面标识。
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock 深色模式人工合成回归页</title></head><body>
<script>window.__INITIAL_STATE__ = { videoData: { aid: '1', cid: '1' } };</script>
<bili-comments id="comments"></bili-comments>
<div class="up-detail-top"><a class="up-name" href="//space.bilibili.com/888">深色回归作者</a></div>
<script>
const comments = document.getElementById('comments');
const commentsRoot = comments.attachShadow({mode:'open'});
const style = document.createElement('style');
style.textContent = 'bili-comment-thread-renderer{display:block;min-height:24px;margin:0;padding:0}';
commentsRoot.appendChild(style);
function makeComment(mid, uname) {
  const thread = document.createElement('bili-comment-thread-renderer');
  thread.id = 'comment-' + mid;
  const threadRoot = thread.attachShadow({mode:'open'});
  const renderer = document.createElement('bili-comment-renderer');
  renderer.__data = { mid: String(mid), member: { mid: String(mid), uname } };
  const root = renderer.attachShadow({mode:'open'});
  const link = document.createElement('a'); link.className = 'user-name'; link.href = '//space.bilibili.com/' + mid; link.textContent = uname;
  const richText = document.createElement('bili-rich-text'); richText.textContent = '人工合成正文 ' + mid;
  const menu = document.createElement('bili-comment-menu'); menu.__data = { member: { mid: String(mid), uname } };
  const menuRoot = menu.attachShadow({mode:'open'});
  const list = document.createElement('ul'); list.id = 'options';
  for (const label of ['加入黑名单', '举报']) { const item = document.createElement('li'); item.textContent = label; list.appendChild(item); }
  menuRoot.appendChild(list);
  root.append(link, richText, menu);
  threadRoot.appendChild(renderer);
  commentsRoot.appendChild(thread);
  return renderer;
}
window.__commentRenderer = (mid) => commentsRoot.querySelector('#comment-' + mid).shadowRoot.querySelector('bili-comment-renderer');
makeComment(111, 'Alice');
makeComment(222, 'Bob');
<\/script>
</body></html>`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
  await page.addInitScript({ content: SHIM + '\nwindow.__OB_TEST_HOOKS__="omniblock-test-only";\n' + USERSCRIPT + '\n//# sourceURL=omniblock-dark-mode.cjs' });

  // 页面内读取一组选择器的计算样式（背景、前景、color-scheme）。
  const probe = (selectors) => page.evaluate((sels) => {
    const lum = (cssColor) => {
      const m = String(cssColor).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((v) => parseFloat(v));
      const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(parts[0] / 255) + 0.7152 * lin(parts[1] / 255) + 0.0722 * lin(parts[2] / 255);
    };
    const out = { scheme: getComputedStyle(document.getElementById('ob-panel') || document.body).colorScheme };
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) { out[name] = null; continue; }
      const cs = getComputedStyle(el);
      out[name] = { bg: cs.backgroundColor, color: cs.color, bgLum: lum(cs.backgroundColor), colorLum: lum(cs.color) };
    }
    return out;
  }, selectors);

  const SELECTORS = {
    panelBox: '#ob-panel .ob-box',
    panelInput: '#ob-list-search',
    cmBox: '#ob-content-manager .ob-content-box',
    cmTab: '#ob-content-manager .ob-content-tab[aria-selected="true"]',
    confirm: '#ob-confirm',
    modalBox: '#ob-modal .ob-modal-box',
  };

  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('https://www.bilibili.com/video/dark-mode-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await page.evaluate(() => window.OB.setupQuickBlock());
    await page.waitForFunction(() => {
      const renderer = window.__commentRenderer && window.__commentRenderer('111');
      return !!(renderer && renderer.shadowRoot.querySelector('bili-comment-menu') &&
        renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick'));
    }, null, { timeout: 10000 });

    // ---- 深色：设置面板 ----
    await page.evaluate(() => window.OB.openOptions());
    await wait(150);
    const darkPanel = await probe(SELECTORS);
    if (darkPanel.scheme === 'dark') {
      report.pass.push('DARK-1 深色下 #ob-panel 计算色 color-scheme=dark（媒体查询真实生效）');
    } else report.fail.push('DARK-1 深色下 color-scheme 未生效：' + darkPanel.scheme);
    if (darkPanel.panelBox && darkPanel.panelBox.bgLum < 0.25 && darkPanel.panelBox.colorLum > 0.7) {
      report.pass.push('DARK-1 设置面板深底（亮度 ' + darkPanel.panelBox.bgLum.toFixed(3) + ' < 0.25）浅字（亮度 ' + darkPanel.panelBox.colorLum.toFixed(3) + ' > 0.7）');
    } else report.fail.push('DARK-1 设置面板深色断言失败：' + JSON.stringify(darkPanel.panelBox));
    if (darkPanel.panelInput && darkPanel.panelInput.bgLum < 0.25 && darkPanel.panelInput.colorLum > 0.7) {
      report.pass.push('DARK-1 面板输入框深色底/浅色字（' + darkPanel.panelInput.bg + ' / ' + darkPanel.panelInput.color + '）');
    } else report.fail.push('DARK-1 面板输入框深色断言失败：' + JSON.stringify(darkPanel.panelInput));

    // ---- 深色：内容弹窗（AI 标签页，不触发评论抓取） ----
    await page.evaluate(() => window.OB.openContentManager(window.OB.adapters.bilibili, 'ai'));
    await page.waitForSelector('#ob-content-manager .ob-content-box', { timeout: 8000 });
    const darkCm = await probe(SELECTORS);
    if (darkCm.cmBox && darkCm.cmBox.bgLum < 0.25) {
      report.pass.push('DARK-1 内容弹窗主容器深底（亮度 ' + darkCm.cmBox.bgLum.toFixed(3) + '）');
    } else report.fail.push('DARK-1 内容弹窗深色断言失败：' + JSON.stringify(darkCm.cmBox));
    if (darkCm.cmTab && darkCm.cmTab.colorLum > 0.3) {
      report.pass.push('DARK-1 选中标签页文字在深色下可读（亮度 ' + darkCm.cmTab.colorLum.toFixed(3) + ' > 0.3）');
    } else report.fail.push('DARK-1 选中标签页深色断言失败：' + JSON.stringify(darkCm.cmTab));

    // ---- 深色：确认气泡 + 自建确认浮层（只打开/取消，不产生写入） ----
    await page.evaluate(async () => {
      const renderer = window.__commentRenderer('111');
      renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await page.waitForSelector('#ob-confirm', { timeout: 5000 });
    const darkConfirm = await probe(SELECTORS);
    if (darkConfirm.confirm && darkConfirm.confirm.bgLum < 0.25 && darkConfirm.confirm.colorLum > 0.7) {
      report.pass.push('DARK-1 确认气泡深底浅字（亮度 ' + darkConfirm.confirm.bgLum.toFixed(3) + ' / ' + darkConfirm.confirm.colorLum.toFixed(3) + '）');
    } else report.fail.push('DARK-1 确认气泡深色断言失败：' + JSON.stringify(darkConfirm.confirm));
    await page.evaluate(() => { const c = document.getElementById('ob-confirm'); if (c) c.querySelector('.ob-no').click(); });
    await page.evaluate(() => { window.OB.ui.showOBConfirm('深色模式确认浮层探针', { title: '深色探针' }); });
    await page.waitForSelector('#ob-modal .ob-modal-box', { timeout: 5000 });
    const darkModal = await probe(SELECTORS);
    if (darkModal.modalBox && darkModal.modalBox.bgLum < 0.25 && darkModal.modalBox.colorLum > 0.7) {
      report.pass.push('DARK-1 自建确认浮层深底浅字（亮度 ' + darkModal.modalBox.bgLum.toFixed(3) + ' / ' + darkModal.modalBox.colorLum.toFixed(3) + '）');
    } else report.fail.push('DARK-1 自建确认浮层深色断言失败：' + JSON.stringify(darkModal.modalBox));
    await page.evaluate(() => { const m = document.getElementById('ob-modal'); if (m) m.querySelector('.ob-modal-no').click(); });

    // ---- 切回浅色：同一批元素必须回到浅底深字 ----
    await page.emulateMedia({ colorScheme: 'light' });
    await wait(150);
    // 确认气泡/确认浮层与内容弹窗互斥，上一组交互可能已关闭内容弹窗；重开后探测。
    await page.evaluate(() => window.OB.openContentManager(window.OB.adapters.bilibili, 'ai'));
    await page.waitForSelector('#ob-content-manager .ob-content-box', { timeout: 8000 });
    const lightPanel = await probe(SELECTORS);
    if (lightPanel.scheme !== 'dark') {
      report.pass.push('DARK-1 浅色下 #ob-panel color-scheme 不再是 dark（计算值 ' + lightPanel.scheme + '），覆盖段随媒体查询退出');
    } else report.fail.push('DARK-1 切回浅色后 color-scheme 仍为 dark');
    const lightSurfaces = [
      ['panelBox', lightPanel.panelBox, '设置面板'],
      ['cmBox', lightPanel.cmBox, '内容弹窗'],
    ];
    for (const [, value, label] of lightSurfaces) {
      if (value && value.bgLum > 0.8 && value.colorLum < 0.1) {
        report.pass.push('DARK-1 浅色下' + label + '恢复浅底（亮度 ' + value.bgLum.toFixed(3) + '）深字（亮度 ' + value.colorLum.toFixed(3) + '）');
      } else report.fail.push('DARK-1 浅色下' + label + '断言失败：' + JSON.stringify(value));
    }
    if (lightPanel.panelInput && lightPanel.panelInput.bgLum > 0.8 && lightPanel.panelInput.colorLum < 0.1) {
      report.pass.push('DARK-1 浅色下面板输入框恢复浅底深字（' + lightPanel.panelInput.bg + ' / ' + lightPanel.panelInput.color + '）');
    } else report.fail.push('DARK-1 浅色输入框断言失败：' + JSON.stringify(lightPanel.panelInput));
    if (lightPanel.cmTab && lightPanel.cmTab.colorLum < 0.3) {
      report.pass.push('DARK-1 浅色下选中标签页文字回到深色强调（亮度 ' + lightPanel.cmTab.colorLum.toFixed(3) + ' < 0.3）');
    } else report.fail.push('DARK-1 浅色选中标签页断言失败：' + JSON.stringify(lightPanel.cmTab));

    // ---- DARK-3：浅色行为回归（快捷拉黑全链路与旧行为一致） ----
    await page.evaluate(async () => {
      const renderer = window.__commentRenderer('222');
      renderer.shadowRoot.querySelector('bili-comment-menu').shadowRoot.querySelector('.ob-quick').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await page.waitForSelector('#ob-confirm', { timeout: 5000 });
    const lightConfirm = await probe(SELECTORS);
    if (lightConfirm.confirm && lightConfirm.confirm.bgLum > 0.8) {
      report.pass.push('DARK-1 浅色下确认气泡恢复白底（亮度 ' + lightConfirm.confirm.bgLum.toFixed(3) + '）');
    } else report.fail.push('DARK-1 浅色确认气泡断言失败：' + JSON.stringify(lightConfirm.confirm));
    const lightBehavior = await page.evaluate(async () => {
      const confirm = document.getElementById('ob-confirm');
      confirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        blocked: window.OB.Index.isBlocked('bili:uid:222'),
        toastShown: !!document.getElementById('ob-toast'),
      };
    });
    if (lightBehavior.blocked && lightBehavior.toastShown) {
      report.pass.push('DARK-3 浅色（默认）下快捷拉黑 → 确认 → 名单写入 → 撤销 toast 链路与旧行为一致');
    } else report.fail.push('DARK-3 浅色行为回归失败：' + JSON.stringify(lightBehavior));
    await page.evaluate(() => window.OB.Store.removeIdentities(['bili:uid:222']));
  } catch (e) {
    report.fail.push('测试执行异常：' + (e && e.message || e));
  } finally {
    await browser.close().catch(() => {});
  }

  if (report.pageErrors.length) report.fail.push('页面错误 ' + report.pageErrors.length + ' 条：' + report.pageErrors.join(' | '));
  const fatalConsole = report.console.filter((line) => !/no net in test/i.test(line));
  if (fatalConsole.length) report.fail.push('控制台错误/警告 ' + fatalConsole.length + ' 条：' + fatalConsole.join(' | '));

  console.log('通过 ' + report.pass.length + ' 项：');
  for (const line of report.pass) console.log('  [PASS] ' + line);
  if (report.fail.length) {
    console.log('失败 ' + report.fail.length + ' 项：');
    for (const line of report.fail) console.log('  [FAIL] ' + line);
    process.exit(1);
  }
  console.log('dark-mode 全部通过。');
})().catch((e) => { console.error(e); process.exit(1); });

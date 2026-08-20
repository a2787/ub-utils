/* 已知真实属性片段的跨平台适配器回归测试。
 * 这不是各站真页面验收；真站验证由 real-bilibili-probe.cjs 和手工登录态复核承担。
 * 运行：node test/adapters.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = () => {};
window.GM_addStyle = () => {};
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;

const cases = [
  {
    id: 'weibo', url: 'https://weibo.com/test', selector: 'article.woo-panel-main', expected: 'weibo:uid:1234567890',
    body: '<article class="woo-panel-main"><a href="//weibo.com/u/1234567890" data-user-card="id=1234567890&foo=bar" usercard="1234567890" nick-name="微博作者">微博作者</a></article>',
  },
  {
    id: 'zhihu', url: 'https://www.zhihu.com/hot', selector: '.ContentItem', expected: 'zhihu:token:known-author',
    body: '<div class="ContentItem"><a href="/people/known-author">知乎作者</a></div>',
  },
  {
    id: 'tieba', url: 'https://tieba.baidu.com/f?kw=test', selector: '.l_post', expected: 'tieba:uid:987654321',
    body: '<div class="l_post l_post_bright"><span class="tb_icon_author" data-field="{&quot;author&quot;:{&quot;user_id&quot;:&quot;987654321&quot;,&quot;user_name&quot;:&quot;贴吧作者&quot;}}"></span></div>',
  },
  {
    id: 'x', url: 'https://x.com/home', selector: 'article[data-testid="tweet"]', expected: 'x:handle:knownhandle',
    body: '<div data-testid="cellInnerDiv"><article data-testid="tweet"><a role="link" href="/knownhandle">@knownhandle</a></article></div>',
  },
  {
    id: 'douyin', url: 'https://www.douyin.com/test', selector: '[data-e2e="comment-item"]', expected: 'douyin:secuid:MS4wLjABAAKnown',
    body: '<div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/MS4wLjABAAKnown">抖音作者</a></div>',
  },
];

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  const browser = await launchChromium({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  try {
    for (const test of cases) {
      const page = await browser.newPage();
      const fixture = '<!doctype html><html><body>' + test.body + '</body></html>';
      await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
      await page.addInitScript({ content: shim + '\n' + userscript });
      await page.goto(test.url, { waitUntil: 'domcontentloaded' });
      const result = await page.evaluate(({ id, selector }) => {
        const adapter = window.OB && window.OB.adapters[id];
        const item = document.querySelector(selector);
        return { adapter: !!adapter, item: !!item, info: adapter && item ? adapter.extract(item) : null };
      }, test);
      const keys = result.info && result.info.keys || [];
      if (result.adapter && result.item && keys.includes(test.expected)) report.pass.push(test.id + ': ' + test.expected);
      else report.fail.push(test.id + ': ' + JSON.stringify(result));
      await page.close();
    }
  } catch (error) {
    report.errors.push(String(error && error.message || error));
  }
  try { await browser.close(); } catch (e) {}
  console.log('==== OmniBlock 跨平台结构回归测试 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

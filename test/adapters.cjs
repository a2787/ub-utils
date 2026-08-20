/* 人工合成的跨平台适配器回归测试，选择器契约来自已记录的真实属性片段和本地参考实现。
 * 这不是各站真页面验收；真站验证由 real-bilibili-probe.cjs 和手工登录态复核承担。
 * 运行：node test/adapters.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
function shim(blockedIdentity) {
  const persons = blockedIdentity ? { blocked:{ label:'Blocked', note:'', createdAt:0, hits:0, identities:[blockedIdentity] } } : {};
  return `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:${JSON.stringify(persons)}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = () => {};
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;
}

const cases = [
  {
    id: 'weibo', url: 'https://weibo.com/test', selector: 'article.woo-panel-main', expected: 'weibo:uid:1234567890',
    body: '<article class="woo-panel-main"><a href="//weibo.com/u/1234567890" data-user-card="id=1234567890&foo=bar" usercard="1234567890" nick-name="微博作者">微博作者</a></article>',
  },
  {
    id: 'weibo', name: 'weibo-comment', url: 'https://weibo.com/test', selector: '.card-review[comment_id]', expected: 'weibo:uid:123450001', unexpected: 'weibo:uid:999990001', expectSelfContainer: true, expectVanished: true,
    body: '<div class="card-review" comment_id="c1"><div class="content"><div class="txt"><a href="/u/999990001">被提及用户</a><a class="name" href="/u/123450001" nick-name="评论作者">评论作者</a></div></div></div>',
  },
  {
    id: 'weibo', name: 'weibo-search', url: 'https://s.weibo.com/weibo?q=test', selector: '.card-wrap[action-type="feed_list_item"]', expected: 'weibo:uid:123450002',
    body: '<div class="card-wrap" action-type="feed_list_item"><div class="card-feed"><div class="content"><div class="info"><a class="name" href="/u/123450002">搜索作者</a></div></div></div></div>',
  },
  {
    id: 'zhihu', url: 'https://www.zhihu.com/hot', selector: '.ContentItem', expected: 'zhihu:token:known-author',
    body: '<div class="ContentItem"><a href="/people/known-author">知乎作者</a></div>',
  },
  {
    id: 'zhihu', name: 'zhihu-comment', url: 'https://www.zhihu.com/question/1', selector: '.CommentItem', expected: 'zhihu:token:comment-author', expectVanished: true,
    body: '<div class="CommentItem"><a href="/people/comment-author">知乎评论作者</a></div>',
  },
  {
    id: 'tieba', url: 'https://tieba.baidu.com/f?kw=test', selector: '.l_post', expected: 'tieba:uid:987654321', expectVanished: true,
    body: '<div class="l_post l_post_bright"><span class="tb_icon_author" data-field="{&quot;author&quot;:{&quot;user_id&quot;:&quot;987654321&quot;,&quot;user_name&quot;:&quot;贴吧作者&quot;}}"></span></div>',
  },
  {
    id: 'tieba', name: 'tieba-post-content', url: 'https://tieba.baidu.com/p/1', selector: '.d_post_content_main', expected: 'tieba:uid:987654322', expectVanished: true, expectContainerSelector: '.l_post',
    body: '<div class="l_post l_post_bright"><div class="d_post_content_main"><span class="tb_icon_author" data-field="{&quot;author&quot;:{&quot;user_id&quot;:&quot;987654322&quot;,&quot;user_name&quot;:&quot;贴吧楼层作者&quot;}}"></span></div></div>',
  },
  {
    id: 'tieba', name: 'tieba-lzl-collection-guard', url: 'https://tieba.baidu.com/p/1', selector: '.j_lzl_container', expectSelected: false,
    body: '<div class="j_lzl_container"><div data-field="{&quot;user_id&quot;:&quot;111111111&quot;}"></div><div data-field="{&quot;user_id&quot;:&quot;222222222&quot;}"></div></div>',
  },
  {
    id: 'x', url: 'https://x.com/home', selector: 'article[data-testid="tweet"]', expected: 'x:handle:knownhandle', expectVanished: true,
    body: '<div data-testid="cellInnerDiv"><article data-testid="tweet"><a role="link" href="/knownhandle">@knownhandle</a></article></div>',
  },
  {
    id: 'douyin', url: 'https://www.douyin.com/test', selector: '[data-e2e="comment-item"]', expected: 'douyin:secuid:MS4wLjABAAKnown', expectVanished: true,
    body: '<div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/MS4wLjABAAKnown">抖音作者</a></div>',
  },
  {
    id: 'douyin', name: 'douyin-comment-fallback', url: 'https://www.douyin.com/test', selector: '.comment-item', expected: 'douyin:secuid:MS4wLjABAAFallback', expectVanished: true,
    body: '<div class="comment-item"><a href="/user/MS4wLjABAAFallback"></a><a href="/user/MS4wLjABAAFallback">抖音评论作者</a></div>',
  },
  {
    id: 'douyin', name: 'douyin-search', url: 'https://www.douyin.com/search/test', selector: '.search-result-card', expected: 'douyin:secuid:MS4wLjABAASearch',
    body: '<div class="search-result-card"><a href="/user/MS4wLjABAASearch">抖音搜索作者</a></div>',
  },
  {
    id: 'douyin', name: 'douyin-profile', url: 'https://www.douyin.com/user/MS4wLjABAAProfile', selector: '[data-e2e="user-post-list"] [data-e2e="scroll-list"]', expected: 'douyin:secuid:MS4wLjABAAProfile',
    body: '<h1>抖音主页作者</h1><section data-e2e="user-post-list"><div data-e2e="scroll-list"><a href="/video/1">作品</a></div></section>',
  },
  {
    id: 'douyin', name: 'douyin-danmaku', url: 'https://www.douyin.com/test', selector: '[data-danmu-id]', expected: 'douyin:uid:7654321', expectVanished: true,
    body: '<div data-danmu-id="dm-1" data-danmu-user-id="7654321">抖音弹幕</div>',
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
      await page.addInitScript({ content: shim(test.expectVanished ? test.expected : '') + '\n' + userscript });
      await page.goto(test.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const result = await page.evaluate(({ id, selector, expectContainerSelector }) => {
        const adapter = window.OB && window.OB.adapters[id];
        const item = document.querySelector(selector);
        const selected = !!(adapter && item && adapter.selectors.some((candidate) => item.matches(candidate)));
        const info = adapter && item ? adapter.extract(item) : null;
        const target = info && adapter.containerOf && adapter.containerOf(item) || info && info.container || item;
        const rect = target && target.getBoundingClientRect();
        return {
          adapter: !!adapter,
          item: !!item,
          selected,
          selfContainer: !!info && info.container === item,
          containerMatches: !!target && (!expectContainerSelector || target.matches(expectContainerSelector)),
          hiddenClass: !!target && target.classList.contains('ob-hidden'),
          visuallyHidden: !!target && (getComputedStyle(target).display === 'none' || rect.height === 0),
          bars: document.querySelectorAll('.ob-bar').length,
          info,
        };
      }, test);
      const keys = result.info && result.info.keys || [];
      const label = test.name || test.id;
      const selectionOk = test.expectSelected === false ? !result.selected : result.selected;
      const identityOk = test.expectSelected === false || keys.includes(test.expected);
      const exclusionOk = !test.unexpected || !keys.includes(test.unexpected);
      const containerOk = !test.expectSelfContainer || result.selfContainer;
      const containerSelectorOk = !test.expectContainerSelector || result.containerMatches;
      const vanishedOk = !test.expectVanished || (result.hiddenClass && result.visuallyHidden && result.bars === 0);
      if (result.adapter && result.item && selectionOk && identityOk && exclusionOk && containerOk && containerSelectorOk && vanishedOk) {
        report.pass.push(label + ': ' + (test.expectSelected === false ? 'not selected' : test.expected) + (test.expectVanished ? ' (no placeholder)' : ''));
      } else report.fail.push(label + ': ' + JSON.stringify(result));
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

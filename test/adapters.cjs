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

// 2026-08-22 未登录真实详情页捕获：根评论为 `.item1 > .item1in > .con1 > .info > .opt`，
// 楼中楼为 `.item2 > .con2 > .info > .opt`（没有 `.item2in` 中间层），
// 并且「共 N 条回复」展开行同样匹配 `.item2` 但没有作者身份。
const WEIBO_DETAIL_FIXTURE = `
  <article class="woo-panel-main">
    <header><a href="/u/1234567890" usercard="1234567890" nick-name="微博作者">微博作者</a></header>
  </article>
  <div class="wbpro-list">
    <div class="item1">
      <div class="woo-box-flex item1in">
        <div><a href="/u/123450001"><div usercard="123450001"></div></a></div>
        <div class="con1">
          <div class="text"><a href="/u/123450001" usercard="123450001">评论作者甲</a><span>评论正文</span><a href="/u/999990001">被提及用户</a></div>
          <div class="info"><div>刚刚</div><div class="opt"></div></div>
        </div>
      </div>
      <div class="list2" style="min-height: 44px; padding: 3px 0;">
        <div class="item2">
          <div class="con2">
            <div class="text"><a href="/u/123450002" usercard="123450002">回复作者乙</a><span>:</span><span>回复正文</span></div>
            <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info"><div>刚刚</div><div class="woo-box-flex opt opt"></div></div>
          </div>
        </div>
        <div class="item2">
          <div class="text"><a><i class="woo-font woo-font--caretDown"></i></a>共 39 条回复</div>
        </div>
      </div>
    </div>
  </div>
  <div role="dialog" aria-label="点赞用户" style="display: none;">
    <header>点赞用户</header>
    <a href="/u/123450003" usercard="123450003">点赞用户丙</a>
    <a href="/u/123450004" usercard="123450004">点赞用户丁</a>
  </div>`;

// 人工合成：旧版微博楼中楼行，用于覆盖懒加载/虚拟列表下缺少 wbpro 包装的结构。
const WEIBO_LEGACY_REPLY_FIXTURE = `
  <ul node-type="reply_list" class="list_ul">
    <li class="item2">
      <div class="con">
        <div class="txt"><a href="/u/123450005" usercard="123450005">回复作者戊</a><span>回复正文</span></div>
        <div class="info"><span>刚刚</span><span class="opt"></span></div>
      </div>
    </li>
  </ul>`;

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

    const weiboPage = await browser.newPage();
    const weiboFixture = '<!doctype html><html><body>' + WEIBO_DETAIL_FIXTURE + WEIBO_LEGACY_REPLY_FIXTURE + '</body></html>';
    await weiboPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: weiboFixture }));
    await weiboPage.addInitScript({ content: shim('') + '\n' + userscript });
    // 人工合成详情页 URL，仅用于本地夹具路由。
    await weiboPage.goto('https://weibo.com/fixture-user/fixture-detail', { waitUntil: 'domcontentloaded' });
    await weiboPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const weiboDetail = await weiboPage.evaluate(async () => {
      const adapter = window.OB.adapters.weibo;
      const comments = [
        document.querySelector('.wbpro-list > .item1'),
        document.querySelector('.wbpro-list .list2 > .item2'),
      ].filter(Boolean);
      const infos = comments.map((item) => adapter.extract(item));
      const users = window.OB.collectUsers(document);
      const buttons = Array.from(document.querySelectorAll('.ob-weibo-comment-block'));
      const duplicateQuickCount = comments.reduce((count, item) => count + item.querySelectorAll('.ob-quick').length, 0);
      const bulk = document.querySelector('.ob-bulk[data-ob-kind="page"]');
      // 「共 N 条回复」展开行也匹配 .item2，但没有作者身份，不能出现入口。
      const expandRow = Array.from(document.querySelectorAll('.wbpro-list .list2 > .item2'))
        .find((row) => /共\s*\d+\s*条回复/.test(row.textContent || ''));
      const expandRowInfo = expandRow ? adapter.extract(expandRow) : null;
      const expandRowGuard = !!expandRow && !!expandRowInfo && !expandRowInfo.keys.length
        && !expandRow.querySelector('.ob-weibo-comment-block');
      const second = comments.find((item) => item.matches('.wbpro-list .list2 > .item2'));
      const secondButton = second && second.querySelector('.ob-weibo-comment-block');
      if (secondButton) secondButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      if (confirm) confirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const firstRect = comments[0] && comments[0].getBoundingClientRect();
      const secondRect = second && second.getBoundingClientRect();
      const replyList = document.querySelector('[node-type="reply_list"]');
      const legacyReply = replyList && replyList.querySelector('.item2');
      const legacyButton = legacyReply && legacyReply.querySelector('.ob-weibo-comment-block');
      if (!legacyButton) return { legacyButtonPresent: false };
      legacyButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const legacyConfirm = document.getElementById('ob-confirm');
      if (!legacyConfirm) return { legacyButtonPresent: true, legacyConfirm: false };
      legacyConfirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const modal = document.querySelector('[role="dialog"][aria-label="点赞用户"]');
      modal.style.display = '';
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const modalButton = modal.querySelector('.ob-bulk[data-ob-kind="modal"]');
      if (!modalButton) return { legacyButtonPresent: true, legacyConfirm: true, modalButtonPresent: false };
      modalButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const modalConfirm = document.getElementById('ob-confirm');
      if (!modalConfirm) return { legacyButtonPresent: true, legacyConfirm: true, modalButtonPresent: true, modalConfirm: false };
      modalConfirm.querySelector('.ob-ok').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      // 弹窗批量必须在撤销之前判定：撤销会移除本次新增的点赞用户身份。
      const likersBlocked = ['weibo:uid:123450003', 'weibo:uid:123450004'].every((key) => window.OB.Index.isBlocked(key));
      const toast = document.getElementById('ob-toast');
      if (toast) toast.querySelector('button').click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const likersRestored = ['weibo:uid:123450003', 'weibo:uid:123450004'].every((key) => !window.OB.Index.isBlocked(key));
      return {
        selected: comments.map((item) => adapter.selectors.some((selector) => item.matches(selector))),
        keys: infos.map((info) => info && info.keys || []),
        labels: infos.map((info) => info && info.label || ''),
        containersAreRows: infos.every((info, index) => info && info.container === comments[index]),
        collectedKeys: users.flatMap((info) => info.keys),
        buttonCount: buttons.length,
        duplicateQuickCount,
        bulkText: bulk && bulk.textContent,
        confirmText,
        blockedReply: window.OB.Index.isBlocked('weibo:uid:123450002'),
        firstVisible: !!firstRect && firstRect.height > 0,
        replyHidden: !!secondRect && secondRect.height === 0,
        outerPostVisible: document.querySelector('article').getBoundingClientRect().height > 0,
        wrapperCollapsed: !!replyList && getComputedStyle(replyList).paddingTop === '0px' && replyList.getBoundingClientRect().height === 0,
        legacyButtonPresent: true,
        legacyConfirm: true,
        legacyBlocked: window.OB.Index.isBlocked('weibo:uid:123450005'),
        modalButtonPresent: true,
        modalConfirm: true,
        likersBlocked,
        likersRestored,
        expandRowGuard,
      };
    });
    const expectedWeiboKeys = ['weibo:uid:1234567890', 'weibo:uid:123450001', 'weibo:uid:123450002'];
    if (!Array.isArray(weiboDetail.selected)) weiboDetail.selected = [];
    if (!Array.isArray(weiboDetail.keys)) weiboDetail.keys = [];
    weiboDetail.keys = weiboDetail.keys.map((keys) => Array.isArray(keys) ? keys : []);
    if (!Array.isArray(weiboDetail.keys[0])) weiboDetail.keys[0] = [];
    if (!Array.isArray(weiboDetail.keys[1])) weiboDetail.keys[1] = [];
    if (!Array.isArray(weiboDetail.labels)) weiboDetail.labels = [];
    if (!Array.isArray(weiboDetail.collectedKeys)) weiboDetail.collectedKeys = [];
    weiboDetail.confirmText = weiboDetail.confirmText || '';
    weiboDetail.bulkText = weiboDetail.bulkText || '';
    if (weiboDetail.selected.every(Boolean)
      && weiboDetail.keys[0].includes('weibo:uid:123450001')
      && !weiboDetail.keys[0].includes('weibo:uid:999990001')
      && weiboDetail.keys[1].includes('weibo:uid:123450002')
      && weiboDetail.labels.join('|').includes('评论作者甲')
      && weiboDetail.labels.join('|').includes('回复作者乙')
      && weiboDetail.containersAreRows
      && expectedWeiboKeys.every((key) => weiboDetail.collectedKeys.includes(key))
      && weiboDetail.buttonCount === 3
      && weiboDetail.duplicateQuickCount === 0
      && weiboDetail.expandRowGuard
      && /微博\/评论作者\(4\)/.test(weiboDetail.bulkText || '')
      && weiboDetail.confirmText.includes('回复作者乙')
      && weiboDetail.blockedReply && weiboDetail.firstVisible && weiboDetail.replyHidden && weiboDetail.outerPostVisible) {
      report.pass.push('weibo-detail-comments: captured item1 plus referenced item2 single and bulk local blocking');
    } else report.fail.push('weibo-detail-comments: ' + JSON.stringify(weiboDetail));
    if (weiboDetail.legacyButtonPresent && weiboDetail.legacyConfirm && weiboDetail.legacyBlocked
      && weiboDetail.wrapperCollapsed && weiboDetail.modalButtonPresent && weiboDetail.modalConfirm
      && weiboDetail.likersBlocked && weiboDetail.likersRestored) {
      report.pass.push('weibo-legacy-reply-and-likers: old reply row gets local block, hidden-row wrapper collapses, and like-modal users bulk block');
    } else report.fail.push('weibo-legacy-reply-and-likers: ' + JSON.stringify(weiboDetail));
    await weiboPage.close();
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

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
    // 2026-08-23 登录态捕获：弹幕节点为 data-danmu-id + data-danmaku-user-id。
    body: '<div class="danmu"><div id="dm-1" style="position:absolute"><div data-danmu-id="dm-1" data-is-danmu-author="false" data-is-like="false" data-danmaku-user-id="7654321" data-digg-count="0"><div class="danMuText"><span>抖音弹幕</span></div></div></div></div>',
  },
  {
    id: 'douyin', name: 'douyin-danmaku-author', url: 'https://www.douyin.com/test', selector: '[data-danmu-id="dm-a"]', expected: 'douyin:secuid:MS4wLjABAAAuthor', expectVanished: true,
    // 作者自己的弹幕：data-is-danmu-author=true 时按当前视频作者 sec_uid 隐藏。
    body: '<div class="basePlayerContainer"><a data-e2e="video-avatar" href="/user/MS4wLjABAAAuthor">作者头像</a></div><div class="danmu"><div id="dm-a" style="position:absolute"><div data-danmu-id="dm-a" data-is-danmu-author="true" data-danmaku-user-id="7654322"><div class="danMuText"><span>作者弹幕</span></div></div></div></div>',
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

// 2026-08-22 未登录真实详情页捕获：点击「共 N 条回复」打开
// `.woo-modal-wrap > .woo-modal-main > .wbpro-layer` 弹窗。弹窗里根评论保留
// `.item1 > .item1in > .con1`，但回复行是 `.item2 > .con2`（无 `.item2in`），
// 且被 vue-recycle-scroller 包了一层 `.wbpro-scroller-item`，所以
// `.wbpro-list .list2 > .item2` 这条直接子元素路径匹配不到弹窗内的回复。
const WEIBO_REPLY_MODAL_FIXTURE = `
  <div class="woo-box-flex woo-modal-wrap">
    <div class="woo-modal-main">
      <div class="wbpro-layer">
        <div class="woo-panel-main woo-panel-bottom">
          <div class="woo-box-flex wbpro-layer-tit"><div class="wbpro-layer-tit-text">1条回复</div></div>
          <div class="_scroll3_f78o9_3">
            <div class="wbpro-list">
              <div class="item1">
                <div class="woo-box-flex item1in">
                  <div><a href="/u/123460001"><div usercard="123460001"></div></a></div>
                  <div class="woo-box-item-flex con1">
                    <div class="text"><a class="_default_129qs_2" href="/u/123460001" usercard="123460001">弹窗根作者</a><span>根评论正文</span></div>
                    <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info"><div>刚刚</div><div class="woo-box-flex opt opt"></div></div>
                  </div>
                </div>
                <div class="list2">
                  <div class="vue-recycle-scroller ready page-mode">
                      <div class="vue-recycle-scroller__item-wrapper">
                        <div class="vue-recycle-scroller__item-view">
                          <div class="wbpro-scroller-item" style="height:72px;padding-bottom:12px">
                            <div class="item2">
                              <div class="con2">
                                <div class="text"><a class="_default_129qs_2" href="/u/123460002" usercard="123460002">弹窗回复作者</a><span>:</span><span>回复正文</span></div>
                                <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info"><div>刚刚</div><div class="woo-box-flex opt opt"></div></div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="vue-recycle-scroller__item-view">
                          <div class="wbpro-scroller-item" style="height:72px;padding-bottom:12px">
                            <div class="item2">
                              <div class="con2">
                                <div class="text"><a class="_default_129qs_2" href="/u/123460003" usercard="123460003">弹窗后续作者</a><span>:</span><span>后续回复正文</span></div>
                                <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info"><div>刚刚</div><div class="woo-box-flex opt opt"></div></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="woo-modal-mask"></div>
  </div>`;

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

    // 抖音弹幕 UI：跟随浮层、点击拉黑、无身份边界与作者弹幕映射（人工合成真实捕获结构）。
    const dyDmPage = await browser.newPage();
    const dyDmFixture = `<!doctype html><html><body>
      <div class="basePlayerContainer"><a data-e2e="video-avatar" href="/user/MS4wLjABAAAuthor">作者头像</a></div>
      <div class="danmu">
        <div id="dm-normal" style="position:absolute;left:160px;top:40px;width:180px;height:24px" data-danmu-id="dm-normal" data-is-danmu-author="false" data-is-like="false" data-danmaku-user-id="7654321" data-digg-count="0"><div class="danMuText"><span>普通弹幕</span></div></div>
        <div id="dm-author" data-danmu-id="dm-author" data-is-danmu-author="true" data-danmaku-user-id="7654322"><div class="danMuText"><span>作者弹幕</span></div></div>
        <div id="dm-unknown" data-danmu-id="dm-unknown"><div class="danMuText"><span>无身份弹幕</span></div></div>
      </div>
    </body></html>`;
    await dyDmPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: dyDmFixture }));
    await dyDmPage.addInitScript({ content: shim('') + '\n' + userscript });
    await dyDmPage.goto('https://www.douyin.com/test', { waitUntil: 'domcontentloaded' });
    await dyDmPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const dyDm = await dyDmPage.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, ms) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (fn()) return true; await pause(50); } return !!fn(); };
      const normal = document.querySelector('#dm-normal');
      const author = document.querySelector('#dm-author');
      const unknown = document.querySelector('#dm-unknown');
      const hidden = (el) => getComputedStyle(el).display === 'none' || el.getBoundingClientRect().height === 0;
      const hover = (el) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      const result = { fixtureOk: !!(normal && author && unknown) };
      if (!result.fixtureOk) return result;
      hover(unknown);
      await pause(80);
      result.unknownButton = !!unknown.querySelector('.ob-dy-dm-block');
      result.unknownHidden = hidden(unknown);
      hover(normal);
      await pause(80);
      const btn = normal.querySelector('.ob-dy-dm-block');
      result.buttonPresent = !!btn;
      result.buttonInside = !!btn && normal.contains(btn);
      result.genericButtonAbsent = !document.querySelector('.ob-block-btn');
      const buttonRect = btn && btn.getBoundingClientRect();
      const textRect = normal.querySelector('.danMuText') && normal.querySelector('.danMuText').getBoundingClientRect();
      result.buttonLeftOfText = !!buttonRect && !!textRect && buttonRect.left < textRect.left;
      result.buttonOverlapsTextEdge = !!buttonRect && !!textRect && buttonRect.right > textRect.left && buttonRect.left < textRect.left;
      result.buttonVerticallyParallel = !!buttonRect && !!textRect
        && Math.abs((buttonRect.top + buttonRect.height / 2) - (textRect.top + textRect.height / 2)) < 3;
      if (!btn) return result;
      btn.click();
      await pause(80);
      const confirm = document.getElementById('ob-confirm');
      result.confirmShown = !!confirm;
      result.confirmUid = !!(confirm && /douyin:uid:7654321/.test(confirm.textContent));
      if (confirm) confirm.querySelector('.ob-ok').click();
      result.blocked = await waitFor(() => window.OB.Index.isBlocked('douyin:uid:7654321'), 1500);
      result.hidden = await waitFor(() => hidden(normal), 1500);
      const toast = document.getElementById('ob-toast');
      const undo = toast && toast.querySelector('button');
      if (undo) { undo.click(); await pause(80); }
      result.restored = await waitFor(() => !window.OB.Index.isBlocked('douyin:uid:7654321') && !hidden(normal), 1500);
      window.OB.Store.addIdentityGroups([{ keys: ['douyin:secuid:MS4wLjABAAAuthor'], label: '作者' }]);
      result.authorHidden = await waitFor(() => hidden(author), 1500);
      window.OB.Store.removeIdentity('douyin:secuid:MS4wLjABAAAuthor');
      result.authorRestored = await waitFor(() => !hidden(author), 1500);
      return result;
    });
    if (dyDm.fixtureOk && !dyDm.unknownButton && !dyDm.unknownHidden
      && dyDm.buttonPresent && dyDm.buttonInside && dyDm.buttonLeftOfText && dyDm.buttonOverlapsTextEdge
      && dyDm.buttonVerticallyParallel && dyDm.genericButtonAbsent
      && dyDm.confirmShown && dyDm.confirmUid && dyDm.blocked && dyDm.hidden && dyDm.restored
      && dyDm.authorHidden && dyDm.authorRestored) {
      report.pass.push('douyin-danmaku-ui: hover button sits left/overlapping the text, blocks uid, hides/restores; author danmaku maps to video author secuid');
    } else report.fail.push('douyin-danmaku-ui: ' + JSON.stringify(dyDm));
    await dyDmPage.close();

    // 抖音评论菜单与批量管理器：人工合成评论结构；portal 举报项必须复用最近一次
    // 三个点点击记录的评论身份，管理器则通过语义展开控件收集未手动展开的子评论。
    const dyCommentPage = await browser.newPage();
    const dyCommentFixture = `<!doctype html><html><body>
      <div data-e2e="comment-item" id="dy-comment-root">
        <a data-e2e="comment-username" href="/user/MS4wLjABAACommentRoot">根评论作者</a>
        <span>根评论正文</span>
        <button id="dy-comment-more" type="button">三个点</button>
        <button id="dy-comment-expand" type="button">展开 2 条回复</button>
      </div>
      <div id="dy-comment-menu"><button id="dy-report-comment" type="button">举报评论</button></div>
      <script>
        document.getElementById('dy-comment-expand').addEventListener('click', function () {
          if (document.getElementById('dy-reply-one')) return;
          const root = document.getElementById('dy-comment-root');
          root.insertAdjacentHTML('beforeend',
            '<div data-e2e="comment-item" id="dy-reply-one"><a data-e2e="comment-username" href="/user/MS4wLjABAACommentOne">子评论作者甲</a><span>子评论甲</span></div>' +
            '<div data-e2e="comment-item" id="dy-reply-two"><a data-e2e="comment-username" href="/user/MS4wLjABAACommentTwo">子评论作者乙</a><span>子评论乙</span></div>');
          this.textContent = '已展开 2 条回复';
        });
      </script>
    </body></html>`;
    await dyCommentPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: dyCommentFixture }));
    await dyCommentPage.addInitScript({ content: shim('') + '\n' + userscript });
    await dyCommentPage.goto('https://www.douyin.com/test', { waitUntil: 'domcontentloaded' });
    await dyCommentPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const dyComments = await dyCommentPage.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const root = document.querySelector('#dy-comment-root');
      const more = document.querySelector('#dy-comment-more');
      const report = document.querySelector('#dy-report-comment');
      const result = { fixtureOk: !!(root && more && report) };
      if (!result.fixtureOk) return result;
      more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      await pause(1050);
      const quick = document.querySelector('#dy-comment-menu .ob-quick');
      result.menuQuickPresent = !!quick;
      if (quick) {
        quick.click();
        await pause(80);
        const confirm = document.getElementById('ob-confirm');
        result.menuConfirmHasRootAuthor = !!(confirm && confirm.textContent.includes('根评论作者')
          && confirm.textContent.includes('douyin:secuid:MS4wLjABAACommentRoot'));
        if (confirm) confirm.querySelector('.ob-no').click();
      }
      const fab = document.querySelector('.ob-bulk[data-ob-kind="page"]');
      result.fabPresent = !!fab;
      if (!fab) return result;
      fab.click();
      await pause(100);
      result.managerPresent = !!document.querySelector('#ob-douyin-comment-manager');
      result.managerStaysOpen = result.managerPresent;
      if (!result.managerPresent) return result;
      const manager = document.querySelector('#ob-douyin-comment-manager');
      result.initialRows = manager.querySelectorAll('.ob-dc-row').length;
      await pause(900);
      const expandButton = manager.querySelector('.ob-dc-expand');
      if (expandButton) expandButton.click();
      await pause(500);
      result.expandedRows = manager.querySelectorAll('.ob-dc-row').length;
      result.expandedAuthors = ['MS4wLjABAACommentRoot', 'MS4wLjABAACommentOne', 'MS4wLjABAACommentTwo']
        .every((sec) => Array.from(manager.querySelectorAll('.ob-dc-row')).some((row) => row.getAttribute('data-key') === 'douyin:secuid:' + sec));
      const checkAll = manager.querySelector('.ob-dc-checkall input');
      if (checkAll) checkAll.click();
      await pause(80);
      const batch = manager.querySelector('.ob-dc-batch');
      result.batchSelected = !!batch && !batch.disabled && /3/.test(batch.textContent);
      if (batch) batch.click();
      await pause(80);
      const confirm = document.getElementById('ob-confirm');
      if (confirm) confirm.querySelector('.ob-ok').click();
      await pause(180);
      result.allBlocked = ['MS4wLjABAACommentRoot', 'MS4wLjABAACommentOne', 'MS4wLjABAACommentTwo']
        .every((sec) => window.OB.Index.isBlocked('douyin:secuid:' + sec));
      return result;
    });
    if (dyComments.fixtureOk && dyComments.menuQuickPresent && dyComments.menuConfirmHasRootAuthor
      && dyComments.fabPresent && dyComments.managerPresent && dyComments.managerStaysOpen
      && dyComments.initialRows >= 1 && dyComments.expandedRows === 3 && dyComments.expandedAuthors
      && dyComments.batchSelected && dyComments.allBlocked) {
      report.pass.push('douyin-comment-tools: portal 举报评论 gets per-comment local block and the manager expands/blocks loaded child-comment authors together');
    } else report.fail.push('douyin-comment-tools: ' + JSON.stringify(dyComments));
    await dyCommentPage.close();

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
      // 帖子作者常驻入口：真站 `article.woo-panel-main > header` 作者链接旁。
      const authorButtons = Array.from(document.querySelectorAll('.ob-weibo-author-block'));
      const authorButton = authorButtons[0] || null;
      let authorConfirm = false; let authorNamed = false; let authorBlocked = false; let authorRestored = false;
      if (authorButton) {
        authorButton.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const authorConfirmBox = document.getElementById('ob-confirm');
        authorConfirm = !!authorConfirmBox;
        authorNamed = !!(authorConfirmBox && authorConfirmBox.textContent.includes('微博作者'));
        if (authorConfirmBox) authorConfirmBox.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        authorBlocked = window.OB.Index.isBlocked('weibo:uid:1234567890');
        const authorToast = document.getElementById('ob-toast');
        if (authorToast) authorToast.querySelector('button').click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        authorRestored = !window.OB.Index.isBlocked('weibo:uid:1234567890');
      }
      return {
        selected: comments.map((item) => adapter.selectors.some((selector) => item.matches(selector))),
        keys: infos.map((info) => info && info.keys || []),
        labels: infos.map((info) => info && info.label || ''),
        containersAreRows: infos.every((info, index) => info && info.container === comments[index]),
        collectedKeys: users.flatMap((info) => info.keys),
        buttonCount: buttons.length,
        authorButtonCount: authorButtons.length,
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
        authorConfirm,
        authorNamed,
        authorBlocked,
        authorRestored,
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
      && weiboDetail.authorButtonCount === 1
      && weiboDetail.authorConfirm && weiboDetail.authorNamed && weiboDetail.authorBlocked && weiboDetail.authorRestored
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

    // 旧版信息流卡片（.card-wrap[mid] > .card-feed .content .info）的帖子作者入口。
    const wbCardPage = await browser.newPage();
    const wbCardFixture = `<!doctype html><html><body>
      <div class="card-wrap" mid="abc">
        <div class="card-feed">
          <div class="content">
            <div class="info"><a class="name" href="/u/123450006" nick-name="帖子作者">帖子作者</a></div>
          </div>
        </div>
      </div>
    </body></html>`;
    await wbCardPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: wbCardFixture }));
    await wbCardPage.addInitScript({ content: shim('') + '\n' + userscript });
    await wbCardPage.goto('https://weibo.com/fixture-feed', { waitUntil: 'domcontentloaded' });
    await wbCardPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const wbCard = await wbCardPage.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const card = document.querySelector('.card-wrap[mid]');
      const info = card && card.querySelector('.content > .info');
      const button = info && info.querySelector(':scope > .ob-weibo-author-block');
      if (!card || !info || !button) return { fixtureOk: !!card && !!info, button: !!button };
      const afterName = button.previousElementSibling === info.querySelector('a.name');
      button.click(); await pause(80);
      const confirm = document.getElementById('ob-confirm');
      const confirmText = confirm && confirm.textContent || '';
      if (!confirm) return { fixtureOk: true, button: true, afterName, confirm: false };
      confirm.querySelector('.ob-ok').click(); await pause(120);
      const blocked = window.OB.Index.isBlocked('weibo:uid:123450006');
      const toast = document.getElementById('ob-toast');
      if (toast) toast.querySelector('button').click();
      await pause(120);
      const restored = !window.OB.Index.isBlocked('weibo:uid:123450006');
      return { fixtureOk: true, button: true, afterName, confirm: true, confirmText, blocked, restored };
    });
    if (wbCard.fixtureOk && wbCard.button && wbCard.afterName && wbCard.confirm
      && /帖子作者/.test(wbCard.confirmText || '') && /weibo:uid:123450006/.test(wbCard.confirmText || '')
      && wbCard.blocked && wbCard.restored) {
      report.pass.push('weibo-post-author: feed card author entry sits beside the name, blocks uid and restores');
    } else report.fail.push('weibo-post-author: ' + JSON.stringify(wbCard));
    await wbCardPage.close();

    // 「共 N 条回复」展开弹窗：真站里回复行被 vue-recycle-scroller 包裹，
    // 旧的 `.wbpro-list .list2 > .item2` 直接子元素路径匹配不到，因此弹窗内没有入口。
    const modalPage = await browser.newPage();
    const modalFixture = '<!doctype html><html><body>' + WEIBO_REPLY_MODAL_FIXTURE + '</body></html>';
    await modalPage.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: modalFixture }));
    await modalPage.addInitScript({ content: shim('') + '\n' + userscript });
    await modalPage.goto('https://weibo.com/fixture-user/fixture-detail', { waitUntil: 'domcontentloaded' });
    await modalPage.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const weiboModal = await modalPage.evaluate(async () => {
      const adapter = window.OB.adapters.weibo;
      const layer = document.querySelector('.woo-modal-main > .wbpro-layer');
      const rootRow = layer && layer.querySelector('.wbpro-list > .item1');
      const replyRow = layer && layer.querySelector('.wbpro-scroller-item > .item2');
      const replyRows = layer ? Array.from(layer.querySelectorAll('.wbpro-scroller-item > .item2')) : [];
      const nextReplyRow = replyRows[1] || null;
      if (!layer || !rootRow || !replyRow || !nextReplyRow) return { fixtureOk: false };
      const rootInfo = adapter.extract(rootRow);
      const replyInfo = adapter.extract(replyRow);
      const replySelected = adapter.selectors.some((selector) => replyRow.matches(selector));
      const replyButton = replyRow.querySelector('.ob-weibo-comment-block');
      const rootButton = rootRow.querySelector('.ob-weibo-comment-block');
      const nextBeforeTop = nextReplyRow.getBoundingClientRect().top;
      let blocked = false; let confirmText = ''; let replyHidden = false; let rootVisible = false; let restored = false;
      let nextMovedUp = false;
      if (replyButton) {
        replyButton.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const confirm = document.getElementById('ob-confirm');
        confirmText = (confirm && confirm.textContent) || '';
        if (confirm) confirm.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 140));
        blocked = window.OB.Index.isBlocked('weibo:uid:123460002');
        replyHidden = replyRow.getBoundingClientRect().height === 0;
        rootVisible = rootRow.getBoundingClientRect().height > 0;
        nextMovedUp = nextReplyRow.getBoundingClientRect().top < nextBeforeTop - 1;
        const toast = document.getElementById('ob-toast');
        if (toast) toast.querySelector('button').click();
        await new Promise((resolve) => setTimeout(resolve, 140));
        restored = !window.OB.Index.isBlocked('weibo:uid:123460002')
          && replyRow.getBoundingClientRect().height > 0;
      }
      return {
        fixtureOk: true,
        replySelected,
        rootKeys: rootInfo.keys,
        replyKeys: replyInfo.keys,
        replyLabel: replyInfo.label,
        rootButtonPresent: !!rootButton,
        replyButtonPresent: !!replyButton,
        confirmText,
        blocked,
        replyHidden,
        rootVisible,
        nextMovedUp,
        restored,
      };
    });
    if (weiboModal.fixtureOk && weiboModal.replySelected
      && (weiboModal.rootKeys || []).includes('weibo:uid:123460001')
      && (weiboModal.replyKeys || []).includes('weibo:uid:123460002')
      && weiboModal.replyLabel === '弹窗回复作者'
      && weiboModal.rootButtonPresent && weiboModal.replyButtonPresent
      && weiboModal.confirmText.includes('弹窗回复作者')
      && weiboModal.blocked && weiboModal.replyHidden && weiboModal.rootVisible && weiboModal.nextMovedUp && weiboModal.restored) {
      report.pass.push('weibo-reply-modal: scroller-wrapped replies in the expand dialog resolve identity, get inline entries, hide independently and restore');
    } else report.fail.push('weibo-reply-modal: ' + JSON.stringify(weiboModal));
    await modalPage.close();
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

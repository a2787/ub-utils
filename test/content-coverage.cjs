/* OmniBlock 多平台内容读取覆盖回归。
 *
 * 夹具说明：以下 DOM 全部是人工合成，选择器只复用本轮真实站点捕获的
 * 语义结构；因此本文件的证据标签是 structure regression，不代表线上站点
 * 当前仍提供相同结构。测试不访问真实平台，不触发平台写操作，provider 由
 * Playwright route 模拟。
 *
 * 覆盖：B站视频/推荐作品卡/动态卡、抖音播放器/精选/搜索/主页作品、微博帖子、
 * 知乎回答/文章/想法/专栏/问题/视频、贴吧主题帖/X 帖子，以及作者身份、正文和
 * 操作文案隔离；无可靠作者身份的正文/评论仍必须进入 AI 只读记录。
 * 运行：node test/content-coverage.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const PROVIDER_URL = 'http://127.0.0.1:4000/v1/chat/completions';

const SHIM = `
window.__gm = { 'omniblock:ai-direct-config:v1': JSON.stringify({ version: 1, apiKey: 'synthetic-direct-key' }), 'omniblock:data:v1': JSON.stringify({
  version: 1, persons: {}, settings: {
    enabled: true, hideMode: 'collapse', showHoverButton: true, showQuickBlock: false,
    showBulkBlock: true, localBackupEnabled: false, logEnabled: false,
    aiEnabled: true, aiProviderUrl: '${PROVIDER_URL}', aiProviderModel: 'omni-default',
    aiRules: [{ id: 'coverage-rule', text: '覆盖测试规则', enabled: true }]
  }
}) };
window.__aiBodies = [];
window.GM_getValue = (key, fallback) => (key in window.__gm ? window.__gm[key] : fallback);
window.GM_setValue = (key, value) => { window.__gm[key] = value; };
window.GM_deleteValue = (key) => { delete window.__gm[key]; };
window.GM_addStyle = (css) => {
  const add = () => { const style = document.createElement('style'); style.textContent = css; (document.head || document.documentElement).appendChild(style); };
  if (document.head || document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
};
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_info = { script: { name: '本地内容过滤增强', version: '${VERSION}', namespace: 'https://github.com/a2787/ub-utils' } };
window.GM_xmlhttpRequest = (options) => {
  try { window.__aiBodies.push(JSON.parse(options.data || '{}')); } catch (error) {}
  fetch(options.url, { method: options.method || 'GET', headers: options.headers || {}, body: options.data || undefined })
    .then(async (response) => ({ status: response.status, responseText: await response.text() }))
    .then((response) => { if (options.onload) options.onload(response); })
    .catch((error) => { if (options.onerror) options.onerror(error); });
  return { abort() {} };
};
window.GM_openInTab = () => {};
`;

const CASES = [
  {
    name: 'B站视频、推荐作品与动态', id: 'bilibili', url: 'https://www.bilibili.com/video/av123',
    fixture: `<!doctype html><html><body>
      <div class="video-info-container">
        <h1 class="video-title">人工合成 B站视频标题</h1>
        <div class="video-desc-container"><div class="basic-desc-info">人工合成 B站视频简介</div><button>展开</button></div>
       <a class="up-name" href="//space.bilibili.com/${'100001'}">B站视频作者</a>
      </div>
      <div class="bili-video-card" id="bili-card">
        <a class="bili-video-card__image--link" href="//www.bilibili.com/video/av124"><img alt="封面"></a>
        <a href="//www.bilibili.com/video/av124">人工合成推荐作品标题</a>
       <a class="bili-video-card__info--owner" href="//space.bilibili.com/${'100002'}">B站推荐作者</a>
        <div class="bili-video-card__stats--text">123 万播放</div><div class="no-interest-title">不感兴趣</div>
      </div>
      <div class="bili-dyn-item" data-mid="100003">
        <div class="bili-dyn-item__header"><div class="bili-dyn-title"><span class="bili-dyn-title__text">B站动态作者</span></div><div class="bili-dyn-item__desc">刚刚 投稿了视频</div></div>
        <div class="bili-dyn-content"><div class="bili-dyn-card-video"><div class="bili-dyn-card-video__header">00:30</div><div class="bili-dyn-card-video__body"><div class="bili-dyn-card-video__title">人工合成动态标题</div><div class="bili-dyn-card-video__desc">人工合成动态摘要</div><div class="bili-dyn-card-video__stat">12 3</div></div></div></div>
        <div class="bili-dyn-item__footer"><div class="bili-dyn-item__action">转发</div><div class="bili-dyn-item__action">评论</div><div class="bili-dyn-item__action">点赞</div></div>
      </div>
    </body></html>`,
    check(records, extra) {
      const contents = records.filter((record) => record.kind === 'content');
      return contents.length === 3
        && contents.some((record) => record.contentType === 'video' && record.keys.includes('bili:uid:100001')
          && /人工合成 B站视频标题/.test(record.text) && /人工合成 B站视频简介/.test(record.text)
          && !/展开|不感兴趣|播放/.test(record.text))
        && contents.some((record) => record.keys.includes('bili:uid:100002')
          && /人工合成推荐作品标题/.test(record.text) && !/不感兴趣|播放/.test(record.text))
        && contents.some((record) => record.contentType === 'video' && record.keys.includes('bili:uid:100003')
          && /人工合成动态标题/.test(record.text) && /人工合成动态摘要/.test(record.text)
          && !/刚刚|投稿了|00:30|转发|评论|点赞|12 3/.test(record.text))
        && !!(extra && extra.identityFreeCurrent);
    },
  },
  {
    name: '抖音播放器作品', id: 'douyin', url: 'https://www.douyin.com/video/synthetic-coverage',
    fixture: `<!doctype html><html><body>
      <div data-e2e="feed-active-video" data-e2e-vid="synthetic-video-1">
        <div class="basePlayerContainer"><a data-e2e="video-avatar" href="/user/synthetic-secuid">抖音作者</a></div>
        <div data-e2e="video-info"><span data-e2e="feed-video-nickname">抖音作者</span>
          <div data-e2e="video-desc"><span>人工合成抖音作品正文</span><span>展开</span></div></div>
        <button>点赞</button><button>分享</button>
      </div>
      <div class="discover-video-card-item"><div href="/video/synthetic-discover"><img alt="人工合成抖音精选作品正文"><div data-feed-ad-click-refer="title">人工合成抖音精选作品正文</div><div data-feed-ad-click-refer="name">@精选作者</div></div></div>
      <div class="search-result-card"><div><img alt="搜索封面"></div><div><div><div><div>人工合成抖音搜索作品正文</div><div><span>@</span><span>搜索作者</span><span>· 2天前</span></div></div></div></div></div>
      <div data-e2e="user-post-list"><ul data-e2e="scroll-list"><li><a href="/note/synthetic-note"><img alt="人工合成抖音主页作品正文"></a></li></ul></div>
      <div data-e2e="comment-item"><a data-e2e="comment-username" href="/user/synthetic-comment">抖音评论作者</a><span>人工合成抖音评论</span><div class="comment-item-stats-container"><div>举报</div><div>回复</div></div></div>
    </body></html>`,
    check(records, extra) {
      const contents = records.filter((record) => record.kind === 'content');
      const work = contents.find((record) => record.keys.includes('douyin:secuid:synthetic-secuid'));
      const comment = records.find((record) => record.kind === 'comment');
      return contents.length === 4 && !!work && work.contentType === 'video'
         && /人工合成抖音作品正文/.test(work.text) && !/展开|点赞|分享/.test(work.text)
        && contents.some((record) => !record.keys.length && record.contentType === 'video'
          && /人工合成抖音精选作品正文/.test(record.text))
        && contents.some((record) => !record.keys.length && record.contentType === 'content'
          && /人工合成抖音搜索作品正文/.test(record.text) && !/2天前|搜索作者/.test(record.text))
        && contents.some((record) => !record.keys.length && record.contentType === 'post'
          && /人工合成抖音主页作品正文/.test(record.text))
        && !!(extra && extra.selfProfileReadOnly)
        && !!comment && comment.keys.includes('douyin:secuid:synthetic-comment')
        && /人工合成抖音评论$/.test(comment.text) && !/举报|回复$/.test(comment.text);
    },
  },
  {
    name: '微博帖子', id: 'weibo', url: 'https://weibo.com/u/synthetic-author',
    fixture: `<!doctype html><html><body>
      <article class="woo-panel-main"><header><a href="/u/100003" nick-name="微博作者">微博作者</a></header>
        <div class="wbpro-feed-content"><div class="wbpro-feed-ogText">人工合成微博帖子正文</div></div>
        <footer><button>转发</button><button>评论</button><button>赞</button><button>分享</button></footer>
      </article>
      <article class="woo-panel-main"><div class="wbpro-feed-content"><div class="wbpro-feed-ogText">人工合成无身份微博帖子正文</div></div><footer><button>转发</button><button>评论</button><button>赞</button></footer></article>
      <div class="wbpro-list"><div class="item1"><div class="item1in"><div class="con1"><div class="text"><a class="name" href="/u/100004">微博评论作者</a><span>人工合成微博评论</span></div></div></div></div><div class="item1"><div class="item1in"><div class="con1"><div class="text">人工合成无身份微博评论</div></div></div></div></div>
    </body></html>`,
    check(records) {
      const posts = records.filter((record) => record.kind === 'content');
      const post = posts.find((record) => record.keys.includes('weibo:uid:100003'));
      const comments = records.filter((record) => record.kind === 'comment');
      const comment = comments.find((record) => record.keys.includes('weibo:uid:100004'));
      return posts.length === 2 && !!post && post.contentType === 'post'
         && post.text === '人工合成微博帖子正文' && !/转发|评论|赞|分享/.test(post.text)
        && posts.some((record) => !record.keys.length && record.text === '人工合成无身份微博帖子正文')
        && comments.length === 2 && !!comment && /人工合成微博评论/.test(comment.text)
        && comments.some((record) => !record.keys.length && record.text === '人工合成无身份微博评论');
    },
  },
  {
    name: '知乎回答文章想法专栏问题视频', id: 'zhihu', url: 'https://www.zhihu.com/people/synthetic-author/answers',
    fixture: `<!doctype html><html><body>
      <div class="ContentItem AnswerItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎回答作者</a></div><div class="RichContent"><div class="RichContent-inner">人工合成知乎回答正文</div></div><div class="ContentItem-actions"><button>赞同</button><button>评论</button></div></div>
      <div class="ContentItem ArticleItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎文章作者</a></div><h2 class="ContentItem-title">人工合成知乎文章标题</h2><div class="RichContent"><div class="RichContent-inner">人工合成知乎文章摘要</div></div><div class="ContentItem-actions"><button>分享</button></div></div>
      <div class="ContentItem PinItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎想法作者</a></div><div class="RichContent"><div class="RichContent-inner">人工合成知乎想法正文</div></div><div class="ContentItem-actions"><button>评论</button></div></div>
      <div class="ContentItem ColumnItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎专栏作者</a></div><h2 class="ContentItem-title">人工合成知乎专栏标题</h2><div class="ColumnItem-meta">人工合成知乎专栏摘要</div><div class="ContentItem-status">已更新</div></div>
      <div class="ContentItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎问题作者</a></div><a href="/question/1234567890">人工合成问题标题</a><div class="RichContent"><div class="RichContent-inner">人工合成问题正文</div></div><div class="ContentItem-actions"><button>关注问题</button></div></div>
      <div class="ContentItem"><div class="AuthorInfo"><a href="/people/synthetic-author">知乎视频作者</a></div><a href="/zvideo/123456789">人工合成视频标题</a><div class="RichContent"><div class="RichContent-inner">人工合成视频正文</div></div><div class="ContentItem-actions"><button>收藏</button></div></div>
      <div class="synthetic-comment"><div><div class="CommentContent">人工合成知乎无身份评论</div></div></div>
    </body></html>`,
    check(records) {
      const types = new Set(records.filter((record) => record.kind === 'content').map((record) => record.contentType));
      const texts = records.filter((record) => record.kind === 'content').map((record) => record.text).join('|');
      return ['answer', 'post', 'pin', 'column', 'question', 'video'].every((type) => types.has(type))
        && /人工合成知乎回答正文/.test(texts) && /人工合成知乎文章标题/.test(texts)
        && /人工合成知乎想法正文/.test(texts) && /人工合成知乎专栏摘要/.test(texts)
        && /人工合成问题标题|人工合成问题正文/.test(texts) && /人工合成视频标题|人工合成视频正文/.test(texts)
        && !/赞同|分享|已更新|关注问题|收藏/.test(texts)
        && records.some((record) => record.kind === 'comment' && !record.keys.length
          && record.text === '人工合成知乎无身份评论');
    },
  },
  {
    name: '贴吧主题帖与现代视频主题和评论', id: 'tieba', url: 'https://tieba.baidu.com/p/123456',
    fixture: `<!doctype html><html><body>
      <div class="l_post l_post_bright"><div class="d_post_content_main"><span class="tb_icon_author" data-field='{"author":{"user_id":"100005","user_name":"tieba-author"}}'>贴吧主题帖作者</span><div>人工合成贴吧主题帖正文</div></div><div class="post-tail-wrap"><button>回复</button><button>举报</button></div></div>
      <div class="l_post l_post_bright"><div class="d_post_content_main"><div>人工合成无身份贴吧主题帖正文</div></div><div class="post-tail-wrap"><button>回复</button></div></div>
      <div class="image-text"><div class="head-line user-info"><a class="head-name" href="/home/main?id=opaque-modern">贴吧新版主题作者</a></div><div class="pb-content-wrap"><div class="pb-content-item"><span class="pb-text-wrapper text">人工合成贴吧新版主题帖正文</span></div></div><div class="action-bar-container"><button>回复</button><button>举报</button></div><script>document.currentScript.parentElement.__vue__ = { author: { id: 100007, name_show: '贴吧新版主题作者' } };</script></div>
      <div class="image-text"><div class="head-line user-info"><a class="head-name" href="/home/main?id=opaque-richtext">贴吧富文本主题作者</a></div><div class="pb-content-wrap"><div class="richtext-item"><span class="pb-text-wrapper">人工合成贴吧富文本主题帖正文</span></div></div><div class="action-bar-container"><button>回复</button><button>举报</button></div><script>document.currentScript.parentElement.__vue__ = { author: { id: 100008, name_show: '贴吧富文本主题作者' } };</script></div>
      <div class="image-text"><div class="pb-title-wrap"><span class="pb-title">人工合成贴吧视频主题标题</span></div><div class="player-placeholder"></div><div class="action-bar-container"><button>回复</button><button>举报</button></div><script>document.currentScript.parentElement.__vue__ = { author: { id: 100009, name_show: '贴吧视频主题作者' }, thread: { title: '人工合成贴吧视频主题标题', origin_thread_info: { content: [{ text: '人工合成贴吧视频主题正文' }] } } };</script></div>
      <div class="pb-comment-item"><div class="head-line user-info"><a class="head-name" href="/home/main?id=opaque">贴吧评论作者</a></div><div class="comment-content">人工合成贴吧评论</div><div class="comment-actions"><button>举报</button><button>拉黑</button></div><script>document.currentScript.parentElement.__vue__ = { userInfo: { id: 100006, name_show: '贴吧评论作者' } };</script></div>
    </body></html>`,
    check(records) {
      const posts = records.filter((record) => record.kind === 'content');
      const post = posts.find((record) => record.keys.includes('tieba:uid:100005'));
      const modernPost = posts.find((record) => record.keys.includes('tieba:uid:100007'));
      const richTextPost = posts.find((record) => record.keys.includes('tieba:uid:100008'));
      const videoPost = posts.find((record) => record.keys.includes('tieba:uid:100009'));
      const comment = records.find((record) => record.kind === 'comment');
      return posts.length === 5 && !!post && post.contentType === 'thread'
         && /人工合成贴吧主题帖正文/.test(post.text) && !/回复|举报/.test(post.text)
        && posts.some((record) => !record.keys.length && /人工合成无身份贴吧主题帖正文/.test(record.text))
        && !!modernPost && /人工合成贴吧新版主题帖正文/.test(modernPost.text)
        && modernPost.source === 'dom-vue-thread' && !/回复|举报/.test(modernPost.text)
        && !!richTextPost && /人工合成贴吧富文本主题帖正文/.test(richTextPost.text)
        && !!videoPost && /人工合成贴吧视频主题标题/.test(videoPost.text)
        && /人工合成贴吧视频主题正文/.test(videoPost.text)
        && videoPost.source === 'dom-vue-thread' && !/回复|举报/.test(videoPost.text)
        && !!comment && comment.keys.includes('tieba:uid:100006') && /人工合成贴吧评论/.test(comment.text)
        && !/举报|拉黑/.test(comment.text);
    },
  },
  {
    name: 'X 帖子', id: 'x', url: 'https://x.com/home',
    fixture: `<!doctype html><html><body><div data-testid="cellInnerDiv"><article data-testid="tweet"><div><a role="link" href="/synthetic_user">@synthetic_user</a></div><div class="tweet-body"><span>人工合成 X 帖子正文</span></div><time>刚刚</time><button>转发</button><div role="button">点赞</div></article></div></body></html>`,
    check(records) {
      const post = records.find((record) => record.kind === 'content');
      return !!post && post.contentType === 'tweet' && post.keys.includes('x:handle:synthetic_user')
        && post.text === '人工合成 X 帖子正文';
    },
  },
];

async function installPage(browser, testCase) {
  const page = await browser.newPage();
  await page.route('**/*', async (route) => {
    if (route.request().url() === PROVIDER_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: testCase.fixture });
  });
  await page.addInitScript({ content: SHIM + '\n//# sourceURL=omniblock-content-coverage-shim.cjs' });
  await page.addInitScript({ content: USERSCRIPT + '\n//# sourceURL=omniblock-content-coverage.cjs' });
  await page.goto(testCase.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.OB && window.OB.adapters && document.querySelector('#ob-gear')), null, { timeout: 8000 });
  // 等待首轮扫描注册 adapter，同时给异步 __vue__/Shadow DOM 夹具留出一帧。
  await page.waitForTimeout(450);
  return page;
}

(async () => {
  const pass = [];
  const fail = [];
  const pageErrors = [];
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    for (const testCase of CASES) {
      const page = await installPage(browser, testCase);
      page.on('pageerror', (error) => pageErrors.push(testCase.name + ': ' + String(error)));
      const result = await page.evaluate((id) => {
        const adapter = window.OB.adapters[id];
        const records = adapter && typeof adapter.collectAIRecords === 'function'
          ? adapter.collectAIRecords(document) : [];
        const extra = {};
        if (id === 'bilibili') {
          const author = document.querySelector('.up-name');
          if (author) author.remove();
          extra.identityFreeCurrent = adapter.collectAIRecords(document).some((record) => (
            record.kind === 'content' && (!record.keys || !record.keys.length)
              && /人工合成 B站视频标题/.test(record.text)
          ));
        }
        if (id === 'douyin') {
          const originalUrl = location.href;
          history.replaceState({}, '', '/user/self');
          const profile = adapter.collectAIRecords(document).find((record) => (
            record.kind === 'content' && record.contentType === 'post'
              && /人工合成抖音主页作品正文/.test(record.text)
          ));
          extra.selfProfileReadOnly = !!profile && (!profile.keys || !profile.keys.length);
          history.replaceState({}, '', originalUrl);
        }
        return {
          records: records.map((record) => ({
            kind: record.kind, contentType: record.contentType, source: record.source, keys: record.keys, text: record.text,
          })),
          contentRoute: !!(adapter && typeof adapter.contentRouteAvailable === 'function' && adapter.contentRouteAvailable()),
          extra,
        };
      }, testCase.id);
      const passed = testCase.check(result.records, result.extra);
      if (passed && result.contentRoute) pass.push('CC-' + (pass.length + fail.length + 1) + ' ' + testCase.name + '：作者、语义正文和 AI 记录均可读');
      else fail.push(testCase.name + '：' + JSON.stringify({ contentRoute: result.contentRoute, records: result.records.map((record) => ({ kind: record.kind, type: record.contentType, text: record.text })) }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('PASS:', pass.join(' | ') || '无');
  console.log('FAIL:', fail.join(' | ') || '无');
  console.log('PAGEERRORS:', JSON.stringify(pageErrors));
  process.exitCode = fail.length || pageErrors.length ? 1 : 0;
})().catch((error) => {
  console.error('CONTENT COVERAGE TEST ERROR:', error && error.stack || error);
  process.exitCode = 1;
});

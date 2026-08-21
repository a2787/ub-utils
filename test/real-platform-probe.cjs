/* 其余平台的真实页面只读探针。
 * 不读取用户 Cookie、不执行平台写操作；用于记录当前未登录公开页的可验证边界。
 * 运行：node test/real-platform-probe.cjs
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
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;

const targets = [
  { id: 'weibo', url: 'https://weibo.com/' },
  { id: 'zhihu', url: 'https://www.zhihu.com/hot' },
  { id: 'tieba', url: 'https://tieba.baidu.com/f?kw=python' },
  { id: 'x', url: 'https://x.com/home' },
  { id: 'douyin', url: 'https://www.douyin.com/' },
];
const args = process.argv.slice(2);
const requestedIds = new Set(args.filter((arg) => !arg.startsWith('--')));
const requestedUrlArg = args.find((arg) => arg.startsWith('--url='));
const requestedUrl = requestedUrlArg ? requestedUrlArg.slice('--url='.length) : '';
const safeRequestedUrl = (() => {
  try {
    const parsed = new URL(requestedUrl);
    return parsed.protocol === 'https:' && /(^|\.)weibo\.com$/.test(parsed.hostname) ? parsed.href : '';
  } catch (error) { return ''; }
})();
const selectedTargets = (requestedIds.size ? targets.filter((target) => requestedIds.has(target.id)) : targets)
  .map((target) => target.id === 'weibo' && safeRequestedUrl ? { ...target, url: safeRequestedUrl } : target);
const showDetails = process.argv.includes('--detail');
const verifyLocal = process.argv.includes('--verify-local');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const report = { version, targets: [] };
  let browser;
  try {
    browser = await launchChromium({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
    });
    for (const target of selectedTargets) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const result = { id: target.id, requestedUrl: target.url, loaded: false, errors: [] };
      page.on('pageerror', (error) => result.errors.push('pageerror: ' + error.message));
      await page.addInitScript({ content: shim + '\n' + userscript });
      try {
        const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        result.loaded = !!response && response.ok();
        await sleep(target.id === 'weibo' && safeRequestedUrl ? 8000 : 5000);
        result.page = await page.evaluate(({ id, showDetails }) => {
          const adapter = window.OB && window.OB.adapters[id];
          const entries = [];
          if (adapter) {
            for (const selector of adapter.selectors || []) {
              for (const item of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
                try {
                  const info = adapter.extract(item);
                  entries.push({ selector, keys: info && info.keys || [], label: info && info.label || '' });
                } catch (error) {
                  entries.push({ selector, error: String(error && error.message || error) });
                }
              }
            }
          }
          const detailSelectors = ['article', '[action-type="feed_list_item"]', '.WB_feed_type', 'article[class*="vue-card"]', '.card-feed', '.wbpro-list > .item1', '.wbpro-list .list2 > .item2', '[data-user-card]', '[data-usercard]', '[usercard]', '[data-uid]', 'a[href*="/u/"]', 'a[href*="/n/"]'];
          const detail = showDetails ? detailSelectors.map((selector) => ({
            selector,
            count: document.querySelectorAll(selector).length,
            samples: Array.from(document.querySelectorAll(selector)).slice(0, 3).map((el) => ({ tag: el.tagName, id: el.id, className: el.className, href: el.getAttribute('href'), usercard: el.getAttribute('data-user-card') || el.getAttribute('data-usercard') || el.getAttribute('usercard') || el.getAttribute('data-uid'), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) })),
          })) : undefined;
          const platform = id === 'weibo' ? (() => {
            const comments = Array.from(document.querySelectorAll('.wbpro-list > .item1, .wbpro-list .list2 > .item2'));
            const commentInfos = comments.map((item) => adapter && adapter.extract(item));
            const users = window.OB && window.OB.collectUsers(document) || [];
            const bulk = document.querySelector('.ob-bulk[data-ob-kind="page"]');
            return {
              commentCount: comments.length,
              identifiedCommentCount: commentInfos.filter((info) => info && info.keys && info.keys.length).length,
              inlineButtonCount: document.querySelectorAll('.ob-weibo-comment-block').length,
              duplicateInlineQuickCount: document.querySelectorAll('.item1 > .item1in > .con1 > .info > .opt > .ob-quick, .item2 > .item2in > .con2 > .info > .opt > .ob-quick').length,
              collectedUserCount: users.length,
              bulkLabel: bulk && bulk.textContent || '',
            };
          })() : undefined;
          return {
            finalUrl: location.href,
            title: document.title,
            obReady: !!window.OB,
            adapterReady: !!adapter,
            candidateCount: entries.length,
            identityCount: entries.filter((entry) => entry.keys && entry.keys.length).length,
            samples: entries.slice(0, 5),
            pageText: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
            detail,
            platform,
          };
        }, { id: target.id, showDetails });
        if (target.id === 'weibo' && verifyLocal) {
          if (result.page && result.page.platform && result.page.platform.duplicateInlineQuickCount) {
            result.errors.push('验证失败：微博评论常驻入口旁重复注入了快捷按钮');
          }
          result.localBlock = await page.evaluate(async () => {
            const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const adapter = window.OB && window.OB.adapters.weibo;
            const row = document.querySelector('.wbpro-list > .item1, .wbpro-list .list2 > .item2');
            const button = row && row.querySelector('.ob-weibo-comment-block');
            const info = adapter && row && adapter.extract(row);
            const key = info && info.keys && info.keys[0];
            const post = document.querySelector('article');
            if (!row || !button || !key) return { found: false, row: !!row, button: !!button, identity: !!key };
            button.click(); await pause(100);
            const confirm = document.getElementById('ob-confirm');
            const named = !!confirm && !!info.label && confirm.textContent.includes(info.label);
            if (!confirm) return { found: true, confirm: false };
            confirm.querySelector('.ob-ok').click(); await pause(220);
            const blocked = window.OB.Index.isBlocked(key);
            const hidden = row.classList.contains('ob-hidden') && (getComputedStyle(row).display === 'none' || row.getBoundingClientRect().height === 0);
            const postVisible = !!post && getComputedStyle(post).display !== 'none' && post.getBoundingClientRect().height > 0;
            const toast = document.getElementById('ob-toast');
            const undo = toast && toast.querySelector('button');
            if (undo) { undo.click(); await pause(220); }
            const restored = !!undo && !window.OB.Index.isBlocked(key) && getComputedStyle(row).display !== 'none' && row.getBoundingClientRect().height > 0;
            return { found: true, confirm: true, named, blocked, hidden, postVisible, restored };
          });
          const local = result.localBlock || {};
          if (!local.found || !local.confirm || !local.named || !local.blocked || !local.hidden || !local.postVisible || !local.restored) {
            result.errors.push('验证失败：微博详情评论本地拉黑、隔离隐藏或撤销不完整');
          }
        }
      } catch (error) {
        result.errors.push(String(error && error.message || error));
      }
      await page.close().catch(() => {});
      report.targets.push(result);
      console.log('PROBE ' + target.id + ': ' + JSON.stringify(result));
    }
  } catch (error) {
    report.fatal = String(error && error.message || error);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2));
})();

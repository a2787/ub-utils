/* 其余平台的真实页面只读探针。
 * 不读取用户 Cookie、不执行平台写操作；用于记录当前未登录公开页的可验证边界。
 * 运行：node test/real-platform-probe.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const { discoverTargets, redactTarget } = require('./discover.cjs');
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

// 已加载楼中楼是否存在取决于具体微博，不是脚本行为。需要验证楼中楼入口时，
// 先用只读预检从候选里挑一个真的展开出楼中楼的详情页。
const WB_ROOT_SEL = '.wbpro-list > .item1';
const WB_REPLY_SEL = '.wbpro-list .list2 > .item2';
async function loadWeiboDetail(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(6000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(1100);
  }
  const clicked = await page.evaluate(async ({ rootSel, replySel }) => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let count = 0;
    // 真站结构：展开行是 `.item2 > .text`，其中是带 caretDown 图标的 <a>。
    const rows = Array.from(document.querySelectorAll(replySel + ', ' + rootSel + ' .item2'))
      .filter((row) => /共\s*\d+\s*条回复/.test(row.textContent || ''))
      .slice(0, 3);
    for (const row of rows) {
      const trigger = row.querySelector('a') || row.querySelector('.text') || row;
      trigger.click(); count++; await pause(1600);
    }
    return count;
  }, { rootSel: WB_ROOT_SEL, replySel: WB_REPLY_SEL });
  await sleep(2000);
  return clicked;
}
async function countWeiboRows(page) {
  return page.evaluate(({ rootSel, replySel }) => {
    const adapter = window.OB && window.OB.adapters.weibo;
    const roots = Array.from(document.querySelectorAll(rootSel));
    const replies = Array.from(document.querySelectorAll(replySel));
    const keyOf = (row) => {
      const info = adapter && adapter.extract(row);
      return (info && info.keys && info.keys[0]) || '';
    };
    const identifiedRoots = roots.filter((row) => !!keyOf(row));
    const identifiedReplies = replies.filter((row) => !!keyOf(row));
    const distinctReplies = identifiedReplies.filter((row) => {
      const root = row.closest(rootSel);
      return !!root && keyOf(root) && keyOf(root) !== keyOf(row);
    });
    return {
      roots: identifiedRoots.length,
      replies: identifiedReplies.length,
      distinctReplies: distinctReplies.length,
    };
  }, { rootSel: WB_ROOT_SEL, replySel: WB_REPLY_SEL });
}
async function pickWeiboDetailTarget(browser, candidates) {
  let fallback = '';
  for (const candidate of candidates) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.addInitScript({ content: shim + '\n' + userscript });
      await loadWeiboDetail(page, candidate);
      const counts = await countWeiboRows(page);
      // 独立隐藏的断言必须选到作者不同于根评论的回复；同作者回复被一起隐藏是
      // 正确的身份语义，但不能证明“只收起回复行”。
      if (counts.distinctReplies > 0) return candidate;
      if (counts.roots > 0 && !fallback) fallback = candidate;
    } catch (error) {
      // 单个候选失败不影响继续尝试下一个。
    } finally {
      await page.close().catch(() => {});
    }
  }
  return fallback;
}

(async () => {
  const report = { version, targets: [] };
  let browser;
  try {
    browser = await launchChromium({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
    });
    for (const target of selectedTargets) {
      // 微博的评论/楼中楼验证必须在真实详情页进行；不在仓库里固化具体 uid/mid，
      // 因此未显式给 `--url=` 时从公开首页发现一个只读目标。
      let url = target.url;
      let discovered = false;
      if (target.id === 'weibo' && verifyLocal && !safeRequestedUrl) {
        const candidates = await discoverTargets(browser, 'weibo', { limit: 6 });
        const found = await pickWeiboDetailTarget(browser, candidates);
        if (found) { url = found; discovered = true; }
      }
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const result = { id: target.id, target: redactTarget(url), discovered, localTarget: url, loaded: false, errors: [] };
      page.on('pageerror', (error) => result.errors.push('pageerror: ' + error.message));
      await page.addInitScript({ content: shim + '\n' + userscript });
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        result.loaded = !!response && response.ok();
        const onDetail = target.id === 'weibo' && (!!safeRequestedUrl || discovered);
        await sleep(onDetail ? 2000 : 5000);
        if (onDetail) {
          // 评论与楼中楼按需加载；只滚动和展开，不写任何站内状态。
          result.expandedReplies = await loadWeiboDetail(page, url);
        }
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
            const rootRows = comments.filter((item) => item.matches('.wbpro-list > .item1'));
            const replyRows = comments.filter((item) => item.matches('.wbpro-list .list2 > .item2'));
            const identified = (rows) => rows.filter((row) => {
              const info = adapter && adapter.extract(row);
              return !!(info && info.keys && info.keys.length);
            });
            const keyOf = (row) => {
              const info = adapter && adapter.extract(row);
              return (info && info.keys && info.keys[0]) || '';
            };
            const distinctReplies = replyRows.filter((row) => {
              const root = row.closest('.wbpro-list > .item1');
              return !!root && keyOf(root) && keyOf(row) && keyOf(root) !== keyOf(row);
            });
            const withButton = (rows) => rows.filter((row) => !!row.querySelector('.ob-weibo-comment-block'));
            const users = window.OB && window.OB.collectUsers(document) || [];
            const bulk = document.querySelector('.ob-bulk[data-ob-kind="page"]');
            return {
              commentCount: comments.length,
              identifiedCommentCount: commentInfos.filter((info) => info && info.keys && info.keys.length).length,
              inlineButtonCount: document.querySelectorAll('.ob-weibo-comment-block').length,
              rootRowCount: rootRows.length,
              identifiedRootCount: identified(rootRows).length,
              rootButtonCount: withButton(identified(rootRows)).length,
              replyRowCount: replyRows.length,
              identifiedReplyCount: identified(replyRows).length,
              replyButtonCount: withButton(identified(replyRows)).length,
              distinctReplyCount: distinctReplies.length,
              // 「共 N 条回复」展开行同样匹配 .item2，但没有作者身份，不应出现入口。
              expandRowsWithButton: replyRows.filter((row) => /共\s*\d+\s*条回复/.test(row.textContent || '')
                && !!row.querySelector('.ob-weibo-comment-block')).length,
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
            // 优先验证楼中楼行：它是本轮修复的目标，且必须独立隐藏而不影响根评论。
            // 必须挑选作者与所属根评论不同的回复，否则根评论会因为同一身份一起隐藏，
            // 那属于正确行为，却无法证明“只隐藏该行”。
            const keyOf = (node) => {
              const info = node && adapter && adapter.extract(node);
              return (info && info.keys && info.keys[0]) || '';
            };
            const rows = Array.from(document.querySelectorAll('.wbpro-list .list2 > .item2, .wbpro-list > .item1'));
            const row = rows.find((item) => {
              if (!item.matches('.wbpro-list .list2 > .item2')) return false;
              if (!item.querySelector('.ob-weibo-comment-block')) return false;
              const root = item.closest('.wbpro-list > .item1');
              const replyKey = keyOf(item);
              return !!replyKey && (!root || keyOf(root) !== replyKey);
            });
            if (!row) return {
              found: false,
              blocked: 'blocked：本轮真实页没有作者不同于根评论的已加载楼中楼，无法安全证明独立隐藏',
            };
            const button = row && row.querySelector('.ob-weibo-comment-block');
            const info = adapter && row && adapter.extract(row);
            const key = info && info.keys && info.keys[0];
            const post = document.querySelector('article');
            const rootThread = row && row.closest('.wbpro-list > .item1');
            const rootKey = rootThread && rootThread !== row ? keyOf(rootThread) : '';
            const rootBefore = rootThread && rootThread !== row ? rootThread.getBoundingClientRect().height : 0;
            if (!row || !button || !key) return { found: false, row: !!row, button: !!button, identity: !!key };
            const isReplyRow = row.matches('.wbpro-list .list2 > .item2');
            button.click(); await pause(100);
            const confirm = document.getElementById('ob-confirm');
            const named = !!confirm && !!info.label && confirm.textContent.includes(info.label);
            if (!confirm) return { found: true, confirm: false };
            confirm.querySelector('.ob-ok').click(); await pause(220);
            const blocked = window.OB.Index.isBlocked(key);
            const liveRows = () => Array.from(document.querySelectorAll('.wbpro-list .list2 > .item2, .wbpro-list > .item1'));
            const liveRow = liveRows().find((item) => keyOf(item) === key) || row;
            const liveRoot = rootKey
              ? Array.from(document.querySelectorAll('.wbpro-list > .item1')).find((item) => keyOf(item) === rootKey) || null
              : null;
            const hidden = liveRow.classList.contains('ob-hidden')
              && (getComputedStyle(liveRow).display === 'none' || liveRow.getBoundingClientRect().height === 0);
            const postVisible = !!post && getComputedStyle(post).display !== 'none' && post.getBoundingClientRect().height > 0;
            // 屏蔽楼中楼时根评论必须保持可见，且高度只应减少（不留空位）。
            const rootNode = liveRoot || (rootThread && rootThread.isConnected ? rootThread : null);
            const rootAfter = rootNode && rootNode !== liveRow ? rootNode.getBoundingClientRect().height : 0;
            const rootDiagnostics = rootThread && rootThread !== row ? {
              originalConnected: rootThread.isConnected,
              freshFound: !!liveRoot,
              connected: rootThread.isConnected,
              display: getComputedStyle(rootThread).display,
              cls: String(rootThread.className).slice(0, 90),
              blockedAttr: rootThread.getAttribute('data-ob-blocked'),
              wrapper: !!rootNode && rootNode.classList.contains('ob-blocked-wrapper'),
              childCount: rootNode ? rootNode.children.length : 0,
              childInfo: rootNode ? Array.from(rootNode.children).map((el) => ({
                cls: String(el.className).slice(0, 50),
                h: Math.round(el.getBoundingClientRect().height),
                wrapper: el.classList.contains('ob-blocked-wrapper'),
                hidden: el.classList.contains('ob-hidden'),
              })) : [],
            } : null;
            const sameAuthorAsRoot = !!rootKey && rootKey === key;
            const rootKept = !!rootNode && rootNode !== liveRow && !sameAuthorAsRoot
              && rootAfter > 0 && rootAfter < rootBefore;
            const toast = document.getElementById('ob-toast');
            const undo = toast && toast.querySelector('button');
            if (undo) { undo.click(); await pause(220); }
            const restoredRow = liveRows().find((item) => keyOf(item) === key) || row;
            const restored = !!undo && !window.OB.Index.isBlocked(key)
              && getComputedStyle(restoredRow).display !== 'none' && restoredRow.getBoundingClientRect().height > 0;

            // 顶层评论在当前真站会被 vue-recycle-scroller 放进独立 item-view。
            // 只验证脚本自身入口和本地名单，不触碰微博举报/官方拉黑等写入控件。
            // 这里专门检查 item-wrapper 的 min-height 是否随隐藏行扣减；只移动行的
            // transform 而不缩短这个 spacer，正是评论下方出现整段空白的原因。
            const topCommentOf = (virtualRow) => {
              const candidates = Array.from(virtualRow.querySelectorAll('.item1,.item2,.card-review[comment_id]'));
              return candidates.find((comment) => {
                let parent = comment.parentElement;
                while (parent && parent !== virtualRow) {
                  if (parent.matches && parent.matches('.item1,.item2,.card-review[comment_id]')) return false;
                  parent = parent.parentElement;
                }
                return comment.matches('.item1');
              }) || null;
            };
            const virtualRows = () => Array.from(document.querySelectorAll(
              '.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view',
            ));
            const inactive = (virtualRow) => {
              const style = getComputedStyle(virtualRow);
              return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
            };
            const rowHeight = (virtualRow) => {
              const content = virtualRow && virtualRow.firstElementChild;
              return Number((content || virtualRow).getBoundingClientRect().height) || 0;
            };
            const sizeOf = (list) => Number(list && list.getBoundingClientRect().height) || 0;
            const inlineSizeOf = (list) => list && (
              list.style.getPropertyValue('min-height') || list.style.getPropertyValue('height') || ''
            );
            const virtualCandidate = virtualRows().map((virtualRow) => ({
              virtualRow,
              comment: topCommentOf(virtualRow),
            })).find(({ virtualRow, comment }) => {
              if (!comment || inactive(virtualRow) || !comment.querySelector('.ob-weibo-comment-block')) return false;
              const info = adapter && adapter.extract(comment);
              const list = virtualRow.parentElement;
              return !!(info && info.keys && info.keys[0] && list && Number.parseFloat(inlineSizeOf(list)) > 0
                && rowHeight(virtualRow) > 0);
            });
            let topLevelSpacer = { attempted: false };
            if (!virtualCandidate) {
              topLevelSpacer.blocked = 'blocked：本轮真实页没有带可测 spacer 的活动顶层虚拟评论';
            } else {
              const { virtualRow: targetVirtualRow, comment: targetComment } = virtualCandidate;
              const targetInfo = adapter.extract(targetComment);
              const targetKey = targetInfo && targetInfo.keys && targetInfo.keys[0];
              const list = targetVirtualRow.parentElement;
              const siblings = () => Array.from(list.children || [])
                .filter((candidate) => candidate.matches && candidate.matches('.vue-recycle-scroller__item-view'));
              const targetIndex = siblings().indexOf(targetVirtualRow);
              const nextVirtualRow = siblings().slice(targetIndex + 1)
                .find((candidate) => !inactive(candidate) && topCommentOf(candidate));
              const nextBeforeTop = nextVirtualRow ? nextVirtualRow.getBoundingClientRect().top : NaN;
              const targetHeight = rowHeight(targetVirtualRow);
              const listBefore = sizeOf(list);
              const inlineBefore = inlineSizeOf(list);
              const topButton = targetComment.querySelector('.ob-weibo-comment-block');
              topButton.click(); await pause(100);
              const topConfirm = document.getElementById('ob-confirm');
              if (!topConfirm || !topConfirm.querySelector('.ob-ok') || !targetKey) {
                topLevelSpacer = { attempted: true, confirm: false };
              } else {
                topConfirm.querySelector('.ob-ok').click(); await pause(260);
                const liveVirtualRows = () => virtualRows().map((virtualRow) => ({
                  virtualRow,
                  comment: topCommentOf(virtualRow),
                }));
                const liveTarget = liveVirtualRows().find(({ comment }) => comment && keyOf(comment) === targetKey);
                const liveTargetRow = liveTarget && liveTarget.virtualRow;
                const liveTargetComment = liveTarget && liveTarget.comment;
                const liveNext = nextVirtualRow && nextVirtualRow.isConnected
                  ? nextVirtualRow : (siblings().find((candidate) => candidate !== liveTargetRow && topCommentOf(candidate)) || null);
                const listAfter = list.isConnected ? list : (liveTargetRow && liveTargetRow.parentElement);
                const listAfterHeight = sizeOf(listAfter);
                const targetHidden = !!liveTargetComment && (getComputedStyle(liveTargetComment).display === 'none'
                  || rowHeight(liveTargetRow) === 0);
                const spacerDelta = listBefore - listAfterHeight;
                const spacerCompensated = targetHidden && targetHeight > 0
                  && Math.abs(spacerDelta - targetHeight) <= 3;
                const nextAfterTop = liveNext ? liveNext.getBoundingClientRect().top : NaN;
                const nextShifted = Number.isFinite(nextBeforeTop) && Number.isFinite(nextAfterTop)
                  ? nextAfterTop <= nextBeforeTop - targetHeight + 3 : true;
                const topToast = document.getElementById('ob-toast');
                const topUndo = topToast && topToast.querySelector('button');
                if (topUndo) { topUndo.click(); await pause(260); }
                const restoredList = list.isConnected ? list : (liveTargetRow && liveTargetRow.parentElement);
                const restoredHeight = sizeOf(restoredList);
                const restoredTopRow = virtualRows().map((virtualRow) => ({
                  virtualRow,
                  comment: topCommentOf(virtualRow),
                })).find(({ comment }) => comment && keyOf(comment) === targetKey);
                const spacerRestored = !!topUndo && Math.abs(restoredHeight - listBefore) <= 3
                  && Math.abs(Number.parseFloat(inlineSizeOf(restoredList)) - Number.parseFloat(inlineBefore)) <= 3;
                const targetRestored = !!topUndo && !window.OB.Index.isBlocked(targetKey)
                  && !!restoredTopRow && getComputedStyle(restoredTopRow.comment).display !== 'none'
                  && rowHeight(restoredTopRow.virtualRow) > 0;
                topLevelSpacer = {
                  attempted: true,
                  confirm: true,
                  targetHeight,
                  listBefore,
                  listAfterHeight,
                  spacerDelta,
                  spacerCompensated,
                  nextShifted,
                  spacerRestored,
                  targetRestored,
                };
              }
            }
            return { found: true, isReplyRow, confirm: true, named, blocked, hidden, postVisible, rootKept, sameAuthorAsRoot, rootBefore, rootAfter, rootDiagnostics, restored, topLevelSpacer };
          });
          const local = result.localBlock || {};
          const platform = (result.page && result.page.platform) || {};
          if (local.blocked && typeof local.blocked === 'string' && local.blocked.indexOf('blocked：') === 0) {
            result.errors.push(local.blocked);
          } else if (!local.found || !local.confirm || !local.named || !local.blocked || !local.hidden || !local.postVisible || !local.rootKept || !local.restored) {
            result.errors.push('验证失败：微博详情评论本地拉黑、隔离隐藏或撤销不完整');
          }
          const spacer = local.topLevelSpacer || {};
          if (spacer.blocked && typeof spacer.blocked === 'string' && spacer.blocked.indexOf('blocked：') === 0) {
            result.errors.push(spacer.blocked);
          } else if (!spacer.attempted || !spacer.confirm || !spacer.spacerCompensated
            || !spacer.spacerRestored || !spacer.targetRestored) {
            result.errors.push('验证失败：微博顶层虚拟评论隐藏后 spacer 未补位或撤销未恢复');
          }
          if (onDetail) {
            if (platform.identifiedRootCount && platform.rootButtonCount !== platform.identifiedRootCount) {
              result.errors.push('验证失败：部分可识别根评论没有行内本地拉黑入口');
            }
            if (platform.identifiedReplyCount && platform.replyButtonCount !== platform.identifiedReplyCount) {
              result.errors.push('验证失败：部分可识别楼中楼没有行内本地拉黑入口');
            }
            if (!platform.identifiedReplyCount) {
              result.errors.push('blocked：本轮真实页没有可识别的已加载楼中楼');
            }
            if (platform.identifiedReplyCount && !platform.distinctReplyCount) {
              result.errors.push('blocked：本轮真实页的楼中楼作者均与根评论相同，无法安全证明独立隐藏');
            }
            if (platform.expandRowsWithButton) {
              result.errors.push('验证失败：「共 N 条回复」展开行错误地获得了拉黑入口');
            }
          }
        }
        // 微博以外的平台此前即使停在登录页或安全验证页也返回空 errors，等于把
        // 「无法验证」静默记成通过。按证据规则，这类结果必须显式落成 blocked。
        if (target.id !== 'weibo') {
          const page = result.page || {};
          const text = String(page.pageText || '');
          const title = String(page.title || '');
          const gate = /登录|signin|sign in|安全验证|验证码|slide|滑动/i.test(title + ' ' + text)
            || /\/(signin|login)\b/i.test(String(page.finalUrl || ''));
          if (!page.obReady) {
            result.errors.push('验证失败：用户脚本未在真实页面就绪');
          } else if (!page.adapterReady) {
            result.errors.push('验证失败：真实页面未匹配到对应适配器');
          } else if (!result.loaded) {
            result.errors.push('blocked：真实页面未成功加载（HTTP 非 2xx 或被重定向）'
              + (gate ? '，落在登录/安全验证页' : ''));
          } else if (gate && !page.identityCount) {
            result.errors.push('blocked：未登录会话被登录页或安全验证页拦截，无法验证条目身份');
          } else if (!page.candidateCount) {
            result.errors.push('blocked：真实页面没有可解析的条目（未登录会话下无内容）');
          } else if (!page.identityCount) {
            result.errors.push('验证失败：真实页面有条目但没有任何条目解析出身份');
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

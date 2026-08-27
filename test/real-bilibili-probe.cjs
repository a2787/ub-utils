/* 真实 B站页面只读探针。
 * 使用隔离的临时 Chrome 配置和内存 GM 存储；只修改该临时本地名单，
 * 不会读取用户 Cookie，也不会触发平台写操作或官方拉黑。
 * 运行：node test/real-bilibili-probe.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const { discoverTargets, redactTarget } = require('./discover.cjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = urlArg ? urlArg.slice('--url='.length) : '';
let URL = /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+\/?(?:[?#].*)?$/.test(requestedUrl)
  ? requestedUrl
  : '';
const SAVE_SCREENSHOT = process.argv.includes('--screenshot');
const VERIFY_LOCAL_BUTTON = process.argv.includes('--verify-local');
const VERIFY_SUB_COMMENT = process.argv.includes('--verify-sub-comment');
const VERIFY_DANMAKU_UID = process.argv.includes('--verify-danmaku-uid');
const VERIFY_DANMAKU_TOOL = process.argv.includes('--verify-danmaku-tool') || VERIFY_DANMAKU_UID;
const VERIFY_FLOATING_DANMAKU = process.argv.includes('--verify-floating-danmaku');
const EXPAND_REPLIES = process.argv.includes('--expand-replies') || VERIFY_SUB_COMMENT;
const VERIFY_BULK_SCOPE = process.argv.includes('--verify-bulk-scope') || VERIFY_LOCAL_BUTTON;
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const sourceHash = crypto.createHash('sha256').update(userscript).digest('hex');
const build = (userscript.match(/const RUNTIME_BUILD\s*=\s*'([^']+)'/) || [, ''])[1];
const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; if (k === 'omniblock:data:v1') window.__obProbeWrites = (window.__obProbeWrites || 0) + 1; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = (options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); if(options.ontimeout) options.ontimeout(); }, Number(options.timeout) || 30000);
  window.fetch(options.url, { method:options.method || 'GET', credentials:'omit', signal:controller.signal })
    .then(async (response) => {
      const responseText = await response.text();
      clearTimeout(timeout);
      if(options.onload) options.onload({ status:response.status, responseText });
    })
    .catch((error) => {
      clearTimeout(timeout);
      if(error && error.name === 'AbortError') return;
      if(options.onerror) options.onerror(error);
    });
  return { abort(){ controller.abort(); clearTimeout(timeout); } };
};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${version}' } };
`;
const xhrProbe = `
window.__obXhrProbe = [];
const __obProbeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (...args) {
  const url = String(this.__obDanmakuUrl || '');
  if (/\\/dm\\/(?:wbi\\/)?web\\/seg\\.so|\\/dm\\/list\\.so/.test(url)) {
    window.__obXhrProbe.push({ url: url.replace(/[?].*$/, ''), responseType: this.responseType || '' });
  }
  return __obProbeSend.call(this, ...args);
};
`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// 并非每个视频都会渲染浮动弹幕（弹幕过少或被关闭时播放器不会插入节点）。
// 需要验证浮动弹幕入口时，先用只读预检从候选里挑一个真的会渲染的目标。
async function pickFloatingDanmakuTarget(browser, candidates) {
  for (const candidate of candidates) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await sleep(3500);
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) { video.muted = true; const play = video.play(); if (play && play.catch) play.catch(() => {}); }
      });
      for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(2200);
        const rendered = await page.evaluate(() => document.querySelectorAll('.bili-danmaku-x-dm').length);
        if (rendered > 0) return candidate;
      }
    } catch (error) {
      // 单个候选失败不影响继续尝试下一个。
    } finally {
      await page.close().catch(() => {});
    }
  }
  return '';
}

(async () => {
  const result = { target: '', discovered: false, version, sourceHash, build, pageLoaded: false, errors: [], probe: null };
  let browser;
  try {
    browser = await launchChromium({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
    });
    if (!URL) {
      // 不在仓库里固化具体验证页；运行时从公开入口页发现一个只读目标。
      const candidates = await discoverTargets(browser, 'bilibili', { limit: 6 });
      URL = VERIFY_FLOATING_DANMAKU
        ? (await pickFloatingDanmakuTarget(browser, candidates)) || candidates[0] || ''
        : candidates[0] || '';
      result.discovered = !!URL;
    }
    if (!URL) {
      result.errors.push('blocked：未能从 bilibili.com 公开入口发现视频目标，也没有提供 --url=');
      console.log(JSON.stringify(result, null, 2));
      try { await browser.close(); } catch (e) {}
      process.exit(2);
    }
    result.target = redactTarget(URL);
    result.localTarget = URL;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => result.errors.push('pageerror: ' + error.message));
    result.uidCardRequestCount = 0;
    result.uidCardRouteErrors = [];
    await page.route('https://api.bilibili.com/x/web-interface/card**', async (route) => {
      try {
        const uid = new globalThis.URL(route.request().url()).searchParams.get('mid') || '';
        if (/^\d+$/.test(uid)) result.uidCardRequestCount++;
        const requestHeaders = { ...route.request().headers() };
        delete requestHeaders.cookie;
        const response = await route.fetch({ headers: requestHeaders });
        const headers = { ...response.headers(), 'access-control-allow-origin': '*' };
        delete headers['set-cookie'];
        await route.fulfill({ response, headers });
      } catch (error) {
        result.uidCardRouteErrors.push(String(error && error.message || error));
        await route.abort('failed');
      }
    });
    await page.addInitScript({ content: shim + '\n' + userscript + '\n' + xhrProbe });
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.pageLoaded = !!response && response.ok();

    // B站评论按需加载；只滚动和等待，不点击原生菜单或写入任何站内状态。
    for (let i = 0; i < 12; i++) {
      await page.evaluate((step) => {
        const comments = document.querySelector('bili-comments');
        if (comments && step === 0) comments.scrollIntoView({ block: 'start' });
        else if (comments) window.scrollBy(0, 850);
        else window.scrollBy(0, 900);
      }, i);
      await sleep(1200);
      const found = await page.evaluate(() => {
        function count(root, selector) {
          let total = 0;
          const walk = (node) => {
            if (!node) return;
            if (node.nodeType === 1 && node.matches && node.matches(selector)) total++;
            if (node.shadowRoot) walk(node.shadowRoot);
            for (const child of node.children || []) walk(child);
          };
          walk(root); return total;
        }
        return {
          roots: count(document, 'bili-comment-renderer'),
          children: count(document, 'bili-sub-comment-renderer,bili-comment-reply-renderer'),
        };
      });
      if (found.children || found.roots >= 10) break;
    }

    if (EXPAND_REPLIES) {
      result.replyExpansion = { attempts: 0, clicked: 0, tags: [], replyCount: 0 };
      for (let attempt = 0; attempt < 6; attempt++) {
        const expansion = await page.evaluate(() => {
          const replies = [];
          let replyCount = 0;
          const seen = new Set();
          const walk = (node) => {
            if (!node || seen.has(node)) return;
            seen.add(node);
            if (node.nodeType === 1) {
              if (node.tagName === 'BILI-COMMENT-REPLIES-RENDERER') replies.push(node);
              if (node.tagName === 'BILI-COMMENT-REPLY-RENDERER') replyCount++;
              if (node.shadowRoot) walk(node.shadowRoot);
            }
            for (const child of node.children || []) walk(child);
          };
          walk(document);
          if (replyCount) return { clicked: 0, tags: [], replyCount };
          const tags = [];
          for (const renderer of replies) {
            const candidates = [];
            const collect = (node) => {
              if (!node) return;
              if (node.nodeType === 1 && node.matches && node.matches('button,a,[role="button"],li,span')) candidates.push(node);
              if (node.shadowRoot) collect(node.shadowRoot);
              for (const child of node.children || []) collect(child);
            };
            collect(renderer);
            const control = candidates.find((element) => {
              const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
              return /(?:查看|展开|更多|共\s*\d+\s*条).*回复|回复.*(?:查看|展开|更多)/.test(text);
            });
            if (!control) continue;
            control.scrollIntoView({ block: 'center', inline: 'nearest' });
            control.click(); tags.push(control.tagName);
          }
          return { clicked: tags.length, tags, replyCount: 0 };
        });
        result.replyExpansion.attempts++;
        result.replyExpansion.clicked += expansion.clicked;
        result.replyExpansion.tags.push(...expansion.tags);
        result.replyExpansion.replyCount = expansion.replyCount;
        if (expansion.replyCount) break;
        await sleep(1400);
        result.replyExpansion.replyCount = await page.evaluate(() => {
          let count = 0;
          const walk = (node) => {
            if (!node) return;
            if (node.nodeType === 1) {
              if (node.tagName === 'BILI-COMMENT-REPLY-RENDERER') count++;
              if (node.shadowRoot) walk(node.shadowRoot);
            }
            for (const child of node.children || []) walk(child);
          };
          walk(document); return count;
        });
        if (result.replyExpansion.replyCount) break;
      }
    }

    // 在打开任何自建确认框之前记录本页批量入口。此前探针只在点过按钮后
    // 才读取它，正好会撞上“弹窗打开时隐藏 FAB”的正常逻辑，无法验证入口本身。
    // FAB 在“已识别作者数为 0”时按设计隐藏，所以快照必须等到评论作者真的解析出来，
    // 否则读到的只是评论尚未渲染完的中间状态。
    let bulkBeforeInteraction;
    for (let attempt = 0; attempt < 16; attempt++) {
      bulkBeforeInteraction = await page.evaluate(() => {
      const modalSelector = '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal';
      const modalCandidates = [];
      const seen = new Set();
      const walk = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        if (node.nodeType === 1) {
          if (node.matches && node.matches(modalSelector)) {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            modalCandidates.push({
              tag: node.tagName,
              id: node.id || '',
              className: typeof node.className === 'string' ? node.className : '',
              role: node.getAttribute('role') || '',
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
          }
          if (node.shadowRoot) walk(node.shadowRoot);
        }
        for (const child of node.children || []) walk(child);
      };
      walk(document);
      const userCount = window.OB && typeof window.OB.collectUsers === 'function'
        ? window.OB.collectUsers(document).length
        : null;
      if (window.OB && typeof window.OB.refreshBulk === 'function') window.OB.refreshBulk();
      const bulk = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => /评论作者|评论屏蔽/.test(el.textContent || ''));
      if (!bulk) return { found: false, text: null, visible: false, userCount, modalCandidates };
      const style = getComputedStyle(bulk);
      return {
        found: true,
        text: bulk.textContent,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
        userCount,
        modalCandidates,
      };
      });
      if (bulkBeforeInteraction.found && bulkBeforeInteraction.visible) break;
      // 作者还没解析出来时继续滚动评论区，让 B站按需加载更多评论。
      if (!bulkBeforeInteraction.userCount) {
        await page.evaluate(() => {
          const comments = document.querySelector('bili-comments');
          if (comments) comments.scrollIntoView({ block: 'center', inline: 'nearest' });
          else window.scrollBy(0, 700);
        });
      }
      await sleep(900);
    }
    result.bulkBeforeInteraction = bulkBeforeInteraction;

    if (VERIFY_BULK_SCOPE) {
      // 真实页面上验证统一评论管理器：打开后自动读取当前可用根评论/子回复，
      // 跨过周期扫描仍保持打开，搜索和筛选全选可用；本段不点击平台写入控件，
      // 也不点击脚本自己的“屏蔽选中”，因此不会污染真实名单。
      result.commentManager = await page.evaluate(async () => {
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const fab = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => /评论作者|评论屏蔽/.test(el.textContent || ''));
        if (!fab) return { found: false };
        fab.click(); await pause(150);
        const panel = document.getElementById('ob-comment-manager');
        if (!panel) return { found: true, panel: false };
        const initialRows = panel.querySelectorAll('.ob-cm-row').length;
        await pause(2200);
        const rows = Array.from(panel.querySelectorAll('.ob-cm-row'));
        const stayedOpen = document.getElementById('ob-comment-manager') === panel;
        const loadAll = panel.querySelector('.ob-cm-load-all');
        const refresh = panel.querySelector('.ob-cm-refresh');
        const search = panel.querySelector('.ob-cm-search');
        let searchRows = 0;
        let searchMatch = false;
        if (search && rows.length) {
          const sample = rows[0].querySelector('.ob-cm-name');
          const term = (sample && sample.textContent || rows[0].getAttribute('data-key') || '').trim();
          search.value = term;
          search.dispatchEvent(new Event('input', { bubbles: true }));
          await pause(80);
          searchRows = panel.querySelectorAll('.ob-cm-row').length;
          searchMatch = searchRows > 0;
          search.value = '';
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const checkAll = panel.querySelector('.ob-cm-checkall input');
        if (checkAll) checkAll.click();
        await pause(80);
        const batch = panel.querySelector('.ob-cm-batch');
        const allSelected = !!checkAll && checkAll.checked && !!batch && !batch.disabled;
        const status = panel.querySelector('.ob-cm-status');
        const managerRecords = window.OB.adapters.bilibili.commentManager.collectRecords() || [];
        const domReplyCount = managerRecords.filter((item) => item && item.level === 'reply').length;
        const result = {
          found: true, panel: true, initialRows, rows: rows.length, stayedOpen,
          loadAll: !!loadAll, refresh: !!refresh, search: !!search, searchRows, searchMatch,
          allSelected, status: status && status.textContent || '', domReplyCount,
          automaticRead: rows.length > 0 && stayedOpen,
        };
        const close = panel.querySelector('.ob-cm-close'); if (close) close.click();
        return result;
      });
      const cm = result.commentManager || {};
      if (!cm.found || !cm.panel || !cm.stayedOpen || !cm.loadAll || !cm.refresh || !cm.search
        || !cm.rows || !cm.searchMatch || !cm.allSelected || !cm.automaticRead) {
        result.errors.push('验证失败：真实页面的统一评论管理器未能自动读取、搜索或保持打开');
      }

      result.commentApiContract = await page.evaluate(async () => {
        const state = window.__INITIAL_STATE__ || {};
        const aid = String(state.aid || (state.videoData && state.videoData.aid) || '');
        if (!/^\d+$/.test(aid)) return { blocked: 'page has no numeric aid' };
        const get = async (url) => {
          const res = await fetch(url, { credentials: 'include' });
          return res.json();
        };
        const main = await get('https://api.bilibili.com/x/v2/reply/main?oid=' + aid + '&type=1&mode=3&ps=20&next=0');
        const replies = (main && main.data && main.data.replies) || [];
        const first = replies[0] || null;
        const root = replies.find((r) => Number(r && r.rcount) > 0) || null;
        let sub = null;
        if (root) {
          const payload = await get('https://api.bilibili.com/x/v2/reply/reply?oid=' + aid + '&type=1&root=' + String(root.rpid_str || root.rpid) + '&ps=20&pn=1');
          const subs = (payload && payload.data && payload.data.replies) || [];
          sub = {
            code: payload && payload.code,
            count: subs.length,
            hasCtime: !!subs[0] && !!subs[0].ctime,
            hasMid: !!subs[0] && !!String(subs[0].mid_str || subs[0].mid),
          };
        }
        return {
          code: main && main.code,
          replies: replies.length,
          hasCtime: !!first && !!first.ctime,
          hasMid: !!first && !!String(first.mid_str || first.mid),
          cursorIsEnd: !!(main && main.data && main.data.cursor && main.data.cursor.is_end),
          sub,
        };
      });
      const api = result.commentApiContract || {};
      const apiRootOk = api.code === 0 && api.replies > 0 && api.hasCtime && api.hasMid;
      const apiSubOk = !api.sub || api.sub.skipped
        || (api.sub.code === 0 && api.sub.count > 0 && api.sub.hasCtime && api.sub.hasMid);
      if (!apiRootOk || !apiSubOk) {
        result.errors.push('验证失败：真实评论 API 契约未返回可分页的 mid/ctime 根评论与子回复');
      }
    }

    if (VERIFY_SUB_COMMENT) {
      await page.waitForFunction(() => {
        if (window.OB && typeof window.OB.setupQuickBlock === 'function') window.OB.setupQuickBlock();
        const find = (node, selector) => {
          if (!node) return null;
          if (node.nodeType === 1 && node.matches && node.matches(selector)) return node;
          if (node.shadowRoot) { const inside = find(node.shadowRoot, selector); if (inside) return inside; }
          for (const child of node.children || []) { const inside = find(child, selector); if (inside) return inside; }
          return null;
        };
        const reply = find(document, 'bili-comment-reply-renderer');
        return !!reply && !!find(reply, '.ob-quick');
      }, null, { timeout: 8000, polling: 250 }).catch(() => {});
      result.subCommentBlock = await page.evaluate(async () => {
        const find = (node, selector) => {
          if (!node) return null;
          if (node.nodeType === 1 && node.matches && node.matches(selector)) return node;
          if (node.shadowRoot) { const inside = find(node.shadowRoot, selector); if (inside) return inside; }
          for (const child of node.children || []) { const inside = find(child, selector); if (inside) return inside; }
          return null;
        };
        const target = find(document, 'bili-comment-reply-renderer');
        const adapter = window.OB && window.OB.adapters && window.OB.adapters.bilibili;
        const info = target && adapter && adapter.extract ? adapter.extract(target) : null;
        const button = target && find(target, '.ob-quick');
        if (!target || !info || !info.keys || !info.keys.length || !button) {
          return { found: !!target, identityResolved: !!(info && info.keys && info.keys.length), localButtonPresent: !!button };
        }
        let node = target;
        let thread = null;
        while (node) {
          if (node.nodeType === 1 && node.tagName === 'BILI-COMMENT-THREAD-RENDERER') { thread = node; break; }
          if (node.parentNode) node = node.parentNode;
          else if (node.host) node = node.host;
          else break;
        }
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const confirm = document.getElementById('ob-confirm');
        if (!confirm) return { found: true, identityResolved: true, localButtonPresent: true, confirm: false };
        confirm.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const blocked = info.keys.every((key) => window.OB.Index.isBlocked(key));
        const bulkIncludesTarget = window.OB.collectUsers(document).some((candidate) =>
          candidate.keys && candidate.keys.some((key) => info.keys.includes(key))
        );
        const hidden = target.classList.contains('ob-hidden') && getComputedStyle(target).display === 'none' && target.getBoundingClientRect().height === 0;
        const threadVisible = !!thread && getComputedStyle(thread).display !== 'none' && thread.getBoundingClientRect().height > 0;
        const toast = document.getElementById('ob-toast');
        const undo = toast && toast.querySelector('button');
        if (undo) {
          undo.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return {
          found: true,
          identityResolved: true,
          localButtonPresent: true,
          confirm: true,
          blocked,
          bulkIncludesTarget,
          hidden,
          threadVisible,
          restored: !!undo && getComputedStyle(target).display !== 'none' && target.getBoundingClientRect().height > 0,
        };
      });
      const sub = result.subCommentBlock || {};
      if (!sub.found || !sub.identityResolved || !sub.localButtonPresent || !sub.confirm || !sub.blocked || !sub.bulkIncludesTarget || !sub.hidden || !sub.threadVisible || !sub.restored) {
        result.errors.push('验证失败：真实楼中楼本地拉黑未做到独立无占位隐藏并可撤销');
      }
    }

    if (VERIFY_DANMAKU_TOOL) {
      await page.waitForFunction(() => {
        const tool = document.getElementById('ob-dm-tool');
        return !!tool && getComputedStyle(tool).display !== 'none' && /弹幕屏蔽\(\d+\)/.test(tool.textContent || '');
      }, null, { timeout: 8000, polling: 250 }).catch(() => {});
      result.danmakuTool = await page.evaluate(async () => {
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const tool = document.getElementById('ob-dm-tool');
        if (!tool || getComputedStyle(tool).display === 'none') return { found: false };
        tool.click(); await pause(120);
        const panel = document.getElementById('ob-dm-manager');
        const initialRows = panel ? Array.from(panel.querySelectorAll('.ob-dm-sender')) : [];
        if (!panel || initialRows.length < 3) return { found: true, panel: !!panel, groupCount: initialRows.length };

        const first = initialRows[0];
        const firstHashes = (first.getAttribute('data-ob-dm-hashes') || '').split(',').filter(Boolean);
        const single = first.querySelector('.ob-dm-single');
        single.click(); await pause(100);
        let confirm = document.getElementById('ob-confirm');
        if (!confirm) return { found: true, panel: true, groupCount: initialRows.length, singleConfirm: false };
        confirm.querySelector('.ob-ok').click(); await pause(200);
        const singleBlocked = !!firstHashes.length && firstHashes.every((hash) => window.OB.Index.isBlocked('bili:dmhash:' + hash));
        let toast = document.getElementById('ob-toast');
        const singleUndo = toast && toast.querySelector('button');
        if (singleUndo) { singleUndo.click(); await pause(200); }
        const singleRestored = !!singleUndo && firstHashes.every((hash) => !window.OB.Index.isBlocked('bili:dmhash:' + hash));

        const currentRows = Array.from(panel.querySelectorAll('.ob-dm-sender'));
        const batchRows = currentRows.slice(0, 2);
        const batchHashes = Array.from(new Set(batchRows.flatMap((row) => (row.getAttribute('data-ob-dm-hashes') || '').split(',').filter(Boolean))));
        for (const row of batchRows) {
          const checkbox = row && row.querySelector('.ob-dm-select');
          if (!checkbox) continue;
          checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const batch = panel.querySelector('.ob-dm-batch');
        const batchReady = batchRows.length === 2 && !!batchHashes.length && batch && !batch.disabled && /2组/.test(batch.textContent || '');
        if (batchReady) batch.click();
        await pause(100);
        confirm = document.getElementById('ob-confirm');
        if (confirm) { confirm.querySelector('.ob-ok').click(); await pause(200); }
        const batchBlocked = batchReady && !!confirm && batchHashes.every((hash) => window.OB.Index.isBlocked('bili:dmhash:' + hash));
        const persons = Object.values(window.OB.Store.persons());
        const batchSeparate = !!batchHashes.length && persons.filter((person) =>
          person.identities.some((key) => batchHashes.some((hash) => key === 'bili:dmhash:' + hash))
        ).length === batchHashes.length;
        toast = document.getElementById('ob-toast');
        const batchUndo = toast && toast.querySelector('button');
        if (batchUndo) { batchUndo.click(); await pause(200); }
        const batchRestored = !!batchUndo && batchHashes.every((hash) => !window.OB.Index.isBlocked('bili:dmhash:' + hash));
        const close = panel.querySelector('.ob-dm-close');
        if (close) close.click();
        return {
          found: true,
          panel: true,
          groupCount: initialRows.length,
          senderCount: new Set(initialRows.flatMap((row) => (row.getAttribute('data-ob-dm-hashes') || '').split(',').filter(Boolean))).size,
          multiSenderGroupCount: initialRows.filter((row) => (row.getAttribute('data-ob-dm-hashes') || '').split(',').filter(Boolean).length > 1).length,
          singleSenderCount: firstHashes.length,
          batchSenderCount: batchHashes.length,
          singleConfirm: true,
          singleBlocked,
          singleRestored,
          batchReady,
          batchConfirm: !!confirm,
          batchBlocked,
          batchSeparate,
          batchRestored,
        };
      });
      const dm = result.danmakuTool || {};
      if (!dm.found || !dm.panel || dm.groupCount < 3 || dm.senderCount < 3 || !dm.singleConfirm || !dm.singleBlocked || !dm.singleRestored || !dm.batchReady || !dm.batchConfirm || !dm.batchBlocked || !dm.batchSeparate || !dm.batchRestored) {
        result.errors.push('验证失败：真实弹幕段未提供可用的单条与批量本地屏蔽工具');
      }
    }

    if (VERIFY_FLOATING_DANMAKU) {
      // 真实播放器里的浮动弹幕层 CSS 写死 pointer-events:none，脚本靠指针坐标命中。
      // 这里只移动鼠标并点击我们自己的浮层，不触碰 B站原生举报或任何站内写操作。
      // 前面为加载评论已经滚到页面下方，必须先把播放器滚回视口，否则弹幕矩形在视口外。
      const bringPlayerIntoView = async () => {
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          const player = document.querySelector('.bpx-player-video-area,#bilibili-player');
          if (player && player.scrollIntoView) player.scrollIntoView({ block: 'center' });
        });
        await sleep(700);
      };
      await bringPlayerIntoView();
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) { video.muted = true; const play = video.play(); if (play && play.catch) play.catch(() => {}); }
      });
      const floating = { rendered: 0, pointerEventsNone: null, candidates: 0, hovered: 0, pickShown: false };
      for (let attempt = 0; attempt < 8 && !floating.rendered; attempt++) {
        await sleep(2500);
        floating.rendered = await page.evaluate(() => document.querySelectorAll('.bili-danmaku-x-dm').length);
      }
      if (floating.rendered) {
        // 等待弹幕渲染期间页面可能再次被站点脚本滚动，采样前重新对齐播放器。
        await bringPlayerIntoView();
        // 采样矩形后若继续播放，弹幕可能在一次鼠标移动前已经越过视口，
        // 会把“目标移动太快”误报成坐标命中失败。暂停只用于本轮只读验证，
        // 不触发平台写操作；真实脚本仍覆盖播放中的跟随路径。
        await page.evaluate(() => { const video = document.querySelector('video'); if (video) video.pause(); });
        await sleep(300);
        floating.pointerEventsNone = await page.evaluate(() => {
          const dm = document.querySelector('.bili-danmaku-x-dm');
          return !!dm && getComputedStyle(dm).pointerEvents === 'none';
        });
        // 滚动弹幕常常一半在视口外；取矩形与视口的交集中心即可稳定命中。
        const spots = await page.evaluate(() => Array.from(document.querySelectorAll('.bili-danmaku-x-dm'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            const left = Math.max(r.left, 2);
            const right = Math.min(r.right, window.innerWidth - 2);
            const top = Math.max(r.top, 2);
            const bottom = Math.min(r.bottom, window.innerHeight - 2);
            return { w: right - left, h: bottom - top, x: (left + right) / 2, y: (top + bottom) / 2 };
          })
          .filter((it) => it.w > 20 && it.h > 6)
          .slice(0, 14)
          .map((it) => ({ x: it.x, y: it.y })));
        floating.candidates = spots.length;
        if (!spots.length) {
          floating.rectSamples = await page.evaluate(() => ({
            viewport: { w: window.innerWidth, h: window.innerHeight },
            scrollY: window.scrollY,
            rects: Array.from(document.querySelectorAll('.bili-danmaku-x-dm')).slice(0, 5).map((el) => {
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }),
          }));
        }
        for (const spot of spots) {
          floating.hovered++;
          await page.mouse.move(spot.x - 30, spot.y + 40);
          await sleep(90);
          await page.mouse.move(spot.x, spot.y);
          await sleep(260);
          const shown = await page.evaluate(() => {
            const pick = document.getElementById('ob-dm-pick');
            return !!pick && getComputedStyle(pick).display !== 'none';
          });
          if (shown) { floating.pickShown = true; break; }
        }
        if (floating.pickShown) {
          floating.transaction = await page.evaluate(async () => {
            const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const pick = document.getElementById('ob-dm-pick');
            pick.click(); await pause(150);
            const confirm = document.getElementById('ob-confirm');
            if (!confirm) return { confirm: false };
            // 确认框把标签与身份键放在同一个 `.ob-sub` 文本里，需要从文本中提取。
            const keys = ((confirm.textContent || '').match(/bili:dmhash:[0-9a-f]{1,8}/g) || []);
            confirm.querySelector('.ob-ok').click(); await pause(220);
            const key = keys[0] || '';
            const blocked = !!key && window.OB.Index.isBlocked(key);
            const toast = document.getElementById('ob-toast');
            const undo = toast && toast.querySelector('button');
            const out = { confirm: true, keyShown: !!key, blocked, hasUndo: !!undo };
            if (undo) { undo.click(); await pause(220); out.restored = !!key && !window.OB.Index.isBlocked(key); }
            return out;
          });
        }
      }
      result.floatingDanmaku = floating;
      const tx = floating.transaction || {};
      if (!floating.rendered) {
        result.errors.push('blocked：真实播放器未渲染浮动弹幕，无法验证坐标命中入口');
      } else if (!floating.pointerEventsNone) {
        result.errors.push('结构变化：浮动弹幕不再是 pointer-events:none，需要重新确认命中策略');
      } else if (!floating.pickShown || !tx.confirm || !tx.keyShown || !tx.blocked || !tx.restored) {
        result.errors.push('验证失败：浮动弹幕坐标命中未提供可用的本地拉黑与撤销');
      }
    }

    if (VERIFY_DANMAKU_UID) {
      result.danmakuUid = await page.evaluate(async () => {
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const tool = document.getElementById('ob-dm-tool');
        if (!tool || getComputedStyle(tool).display === 'none') return { found: false };
        tool.click(); await pause(120);
        const panel = document.getElementById('ob-dm-manager');
        if (!panel) return { found: true, panel: false };
        const attempted = [];
        const lookupStates = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const rows = Array.from(panel.querySelectorAll('.ob-dm-sender'));
          const row = rows.find((item) => {
            const content = item.getAttribute('data-ob-dm-content') || '';
            const hashes = (item.getAttribute('data-ob-dm-hashes') || '').split(',').filter(Boolean);
            return hashes.length === 1 && !attempted.includes(content);
          });
          if (!row) break;
          const content = row.getAttribute('data-ob-dm-content') || '';
          attempted.push(content);
          const query = row.querySelector('.ob-dm-uid-query');
          if (!query) continue;
          query.click();
          const deadline = Date.now() + 20000;
          let current = null;
          while (Date.now() < deadline) {
            current = Array.from(panel.querySelectorAll('.ob-dm-sender')).find((item) =>
              (item.getAttribute('data-ob-dm-content') || '') === content
            );
            const currentQuery = current && current.querySelector('.ob-dm-uid-query');
            const results = current && current.querySelector('.ob-dm-uid-results');
            if (currentQuery && !currentQuery.disabled && results && !/正在计算|等待查询/.test(results.textContent || '')) break;
            await pause(100);
          }
          const candidate = current && current.querySelector('.ob-dm-uid-candidate');
          const errorSection = current && current.querySelector('[data-ob-dm-uid-error]');
          lookupStates.push({
            candidateCount: current ? current.querySelectorAll('.ob-dm-uid-candidate').length : 0,
            failed: !!errorSection,
            error: errorSection && errorSection.getAttribute('data-ob-dm-uid-error') || '',
          });
          if (!candidate) {
            const close = current && current.querySelector('.ob-dm-uid-query');
            if (close && !close.disabled && close.getAttribute('aria-expanded') === 'true') close.click();
            continue;
          }
          const profile = candidate.querySelector('a');
          const choose = candidate.querySelector('.ob-dm-uid-link');
          const uidMatch = String(profile && profile.href || '').match(/space\.bilibili\.com\/(\d+)/);
          const section = candidate.closest('.ob-dm-uid-hash');
          const hashMatch = String(section && section.querySelector('.ob-dm-uid-hash-label') && section.querySelector('.ob-dm-uid-hash-label').textContent || '').match(/([0-9a-f]{8})/i);
          if (!choose || !uidMatch || !hashMatch) continue;
          const uid = uidMatch[1];
          const hash = hashMatch[1].toLowerCase();
          const unique = choose.getAttribute('data-ob-dm-uid-unique') === '1';
          const warning = (current && current.querySelector('.ob-dm-uid-warning') || {}).textContent || '';
          const uniqueButton = unique && choose.textContent === '拉黑本人';
          const ambiguousButton = !unique && choose.textContent === '确认并拉黑';
          choose.click(); await pause(100);
          const confirm = document.getElementById('ob-confirm');
          const person = Object.values(window.OB.Store.persons()).find((item) =>
            item.identities.includes('bili:uid:' + uid) && item.identities.includes('bili:dmhash:' + hash)
          );
          if (unique) {
            // 唯一且已正向校验的候选直接落库，不再弹二次确认。
            if (confirm || !person) {
              const close = panel.querySelector('.ob-dm-close');
              if (close) close.click();
              return {
                found: true, panel: true, attempted: attempted.length, lookupStates,
                candidateFound: true, path: 'unique', uniqueButton, warning,
                uidResolved: true, hashResolved: true, directBlock: false,
                confirm: !!confirm, linked: !!person, blockedBoth: false, restored: false,
              };
            }
            const blockedBoth = window.OB.Index.isBlocked('bili:uid:' + uid) && window.OB.Index.isBlocked('bili:dmhash:' + hash);
            const toast = document.getElementById('ob-toast');
            const undo = toast && toast.querySelector('button');
            if (undo) { undo.click(); await pause(250); }
            const close = panel.querySelector('.ob-dm-close');
            if (close) close.click();
            return {
              found: true, panel: true, attempted: attempted.length, lookupStates,
              candidateFound: true, path: 'unique', uniqueButton, warning,
              uidResolved: true, hashResolved: true, directBlock: true,
              confirm: false, linked: true, blockedBoth,
              restored: !!undo && !window.OB.Index.isBlocked('bili:uid:' + uid) && !window.OB.Index.isBlocked('bili:dmhash:' + hash),
            };
          }
          // 多候选（CRC32 碰撞）仍必须人工核对后确认。
          const confirmText = confirm && confirm.textContent || '';
          if (!confirm) {
            const close = panel.querySelector('.ob-dm-close');
            if (close) close.click();
            return {
              found: true, panel: true, attempted: attempted.length, lookupStates,
              candidateFound: true, path: 'ambiguous', ambiguousButton, warning,
              uidResolved: true, hashResolved: true, directBlock: false,
              confirm: false, linked: false, blockedBoth: false, restored: false,
            };
          }
          confirm.querySelector('.ob-ok').click(); await pause(250);
          const blockedBoth = window.OB.Index.isBlocked('bili:uid:' + uid) && window.OB.Index.isBlocked('bili:dmhash:' + hash);
          const personAfterConfirm = Object.values(window.OB.Store.persons()).find((item) =>
            item.identities.includes('bili:uid:' + uid) && item.identities.includes('bili:dmhash:' + hash)
          );
          const toast = document.getElementById('ob-toast');
          const undo = toast && toast.querySelector('button');
          if (undo) { undo.click(); await pause(250); }
          const close = panel.querySelector('.ob-dm-close');
          if (close) close.click();
          return {
            found: true,
            panel: true,
            attempted: attempted.length,
            lookupStates,
            candidateFound: true,
            path: 'ambiguous',
            ambiguousButton,
            warning,
            uidResolved: /^\d+$/.test(uid),
            hashResolved: /^[0-9a-f]{8}$/.test(hash),
            directBlock: false,
            confirm: true,
            confirmMarked: /可能发送者/.test(confirmText),
            linked: !!personAfterConfirm,
            blockedBoth,
            restored: !!undo && !window.OB.Index.isBlocked('bili:uid:' + uid) && !window.OB.Index.isBlocked('bili:dmhash:' + hash),
          };
        }
        const close = panel.querySelector('.ob-dm-close');
        if (close) close.click();
        return { found: true, panel: true, attempted: attempted.length, candidateFound: false, lookupStates };
      });
      const uid = result.danmakuUid || {};
      const uniqueOk = uid.path === 'unique' && uid.uniqueButton && uid.directBlock && !uid.confirm && uid.linked;
      const ambiguousOk = uid.path === 'ambiguous' && uid.ambiguousButton && uid.confirm && uid.confirmMarked && uid.linked;
      if (!uid.found || !uid.panel || !uid.candidateFound || !uid.uidResolved || !uid.hashResolved
        || !uid.blockedBoth || !uid.restored || !result.uidCardRequestCount || (!uniqueOk && !ambiguousOk)) {
        result.errors.push('验证失败：真实弹幕 hash 未按新语义完成 UID 处理（唯一候选免确认 / 碰撞候选确认）与撤销');
      }
    }

    let menuTrigger = null;
    if (SAVE_SCREENSHOT) {
      menuTrigger = await page.evaluate(() => {
        function firstMenu(root) {
          if (!root) return null;
          if (root.nodeType === 1 && root.tagName === 'BILI-COMMENT-MENU') return root;
          if (root.shadowRoot) { const inside = firstMenu(root.shadowRoot); if (inside) return inside; }
          for (const child of root.children || []) { const inside = firstMenu(child); if (inside) return inside; }
          return null;
        }
        const menu = firstMenu(document);
        const trigger = menu && menu.parentElement;
        if (!trigger) return null;
        trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = trigger.getBoundingClientRect();
        return rect.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      });
      if (menuTrigger) {
        await sleep(250);
        menuTrigger = await page.evaluate(() => {
          function firstMenu(root) {
            if (!root) return null;
            if (root.nodeType === 1 && root.tagName === 'BILI-COMMENT-MENU') return root;
            if (root.shadowRoot) { const inside = firstMenu(root.shadowRoot); if (inside) return inside; }
            for (const child of root.children || []) { const inside = firstMenu(child); if (inside) return inside; }
            return null;
          }
          const menu = firstMenu(document);
          const trigger = menu && menu.parentElement;
          if (!trigger) return null;
          const rect = trigger.getBoundingClientRect();
          return rect.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        });
        if (menuTrigger) { await page.mouse.move(menuTrigger.x, menuTrigger.y); await page.mouse.click(menuTrigger.x, menuTrigger.y); await sleep(500); }
      }
    }

    if (VERIFY_LOCAL_BUTTON) {
      await page.waitForFunction(() => {
        if (window.OB && typeof window.OB.setupQuickBlock === 'function') window.OB.setupQuickBlock();
        const find = (node) => {
          if (!node) return false;
          if (node.nodeType === 1 && node.classList && node.classList.contains('ob-quick')) return true;
          if (node.shadowRoot && find(node.shadowRoot)) return true;
          for (const child of node.children || []) if (find(child)) return true;
          return false;
        };
        return find(document);
      }, null, { timeout: 8000, polling: 400 }).catch(() => {});
      result.localButton = await page.evaluate(async () => {
        function collect(root, selector) {
          const out = [];
          const walk = (node) => {
            if (!node) return;
            if (node.nodeType === 1 && node.matches && node.matches(selector)) out.push(node);
            if (node.shadowRoot) walk(node.shadowRoot);
            for (const child of node.children || []) walk(child);
          };
          walk(root); return out;
        }
        function findButton(root) {
          if (!root) return null;
          if (root.nodeType === 1 && root.classList && root.classList.contains('ob-quick')) return root;
          if (root.shadowRoot) { const inside = findButton(root.shadowRoot); if (inside) return inside; }
          for (const child of root.children || []) { const inside = findButton(child); if (inside) return inside; }
          return null;
        }
        function composedElements(start) {
          const out = [];
          let node = start;
          while (node) {
            if (node.nodeType === 1) out.push(node);
            if (node.parentNode) node = node.parentNode;
            else if (node.host) node = node.host;
            else {
              const root = node.getRootNode && node.getRootNode();
              node = root && root !== node && root.host || null;
            }
          }
          return out;
        }
        const renderers = collect(document, 'bili-comment-renderer');
        const hasLoadedReply = (renderer) => {
          const data = renderer && renderer.__data;
          const dataCount = Number(data && (data.rcount || data.reply_control && data.reply_control.count)) || 0;
          return dataCount > 0 || collect(renderer, 'bili-comment-reply-renderer,bili-sub-comment-renderer').length > 0;
        };
        const targetIndex = renderers.findIndex((renderer) => findButton(renderer) && hasLoadedReply(renderer));
        if (targetIndex < 0) return { found: false, reason: '没有同时具备本地入口和下一条评论的目标行' };
        const targetRenderer = renderers[targetIndex];
        const nextRenderer = renderers[targetIndex + 1];
        const adapter = window.OB && window.OB.adapters && window.OB.adapters.bilibili;
        const target = adapter && adapter.containerOf ? adapter.containerOf(targetRenderer) : targetRenderer;
        const next = adapter && adapter.containerOf ? adapter.containerOf(nextRenderer) : nextRenderer;
        const button = findButton(targetRenderer);
        const targetElements = composedElements(target);
        const nextElements = composedElements(next);
        const common = targetElements.find((element) => nextElements.includes(element));
        const commonBefore = common && common.getBoundingClientRect();
        const before = target.getBoundingClientRect();
        const nextBefore = next.getBoundingClientRect();
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const confirm = document.getElementById('ob-confirm');
        const result = {
          found: true,
          confirm: !!confirm,
          hasName: !!(confirm && !confirm.textContent.includes('该用户')),
          containerTag: target.tagName,
          beforeHeight: Math.round(before.height),
        };
        if (!confirm) return result;
        confirm.querySelector('.ob-ok').click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = target.getBoundingClientRect();
        const nextAfter = next.getBoundingClientRect();
        const commonAfter = common && common.getBoundingClientRect();
        const root = target.getRootNode();
        result.hidden = target.classList.contains('ob-hidden') && getComputedStyle(target).display === 'none' && after.height === 0;
        result.barCount = root.querySelectorAll ? root.querySelectorAll('.ob-bar').length : -1;
        result.nextShift = Math.round(nextBefore.top - nextAfter.top);
        result.relativeNextShift = commonBefore && commonAfter
          ? Math.round((nextBefore.top - commonBefore.top) - (nextAfter.top - commonAfter.top))
          : 0;
        result.layoutClosed = result.relativeNextShift >= Math.max(1, Math.floor(before.height) - 1);

        const toast = document.getElementById('ob-toast');
        const undo = toast && toast.querySelector('button');
        if (undo) {
          undo.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        result.restored = !!undo && !target.hasAttribute('data-ob-blocked') && getComputedStyle(target).display !== 'none' && target.getBoundingClientRect().height > 0;

        // 同一条根评论的楼操作：只点击脚本自己的入口和确认框，存储仍是内存 stub。
        const threadButton = collect(targetRenderer, '.ob-thread-quick')[0] || null;
        result.thread = { found: !!threadButton, confirm: false, authorKeyCount: 0, blocked: false, partial: false, writes: 0, restored: false };
        if (threadButton) {
          const writesBeforeThread = window.__obProbeWrites || 0;
          threadButton.click();
          await new Promise((resolve) => setTimeout(resolve, 700));
          const threadConfirm = document.getElementById('ob-confirm');
          const threadText = threadConfirm && threadConfirm.textContent || '';
          const threadKeys = Array.from(new Set(threadText.match(/bili:uid:\d+/g) || []));
          const countMatch = threadText.match(/屏蔽该楼及\s*(\d+)\s*位作者/);
          result.thread.confirm = !!threadConfirm;
          result.thread.authorKeyCount = threadKeys.length;
          result.thread.partial = /部分/.test(threadText);
          result.thread.authorCount = countMatch ? Number(countMatch[1]) : 0;
          if (threadConfirm) threadConfirm.querySelector('.ob-ok').click();
          await new Promise((resolve) => setTimeout(resolve, 450));
          result.thread.blocked = threadKeys.length >= 2 && threadKeys.every((key) => window.OB.Index.isBlocked(key));
          result.thread.writes = (window.__obProbeWrites || 0) - writesBeforeThread;
          const threadToast = document.getElementById('ob-toast');
          const threadUndo = threadToast && threadToast.querySelector('button');
          if (threadUndo) {
            threadUndo.click();
            await new Promise((resolve) => setTimeout(resolve, 350));
            result.thread.restored = threadKeys.every((key) => !window.OB.Index.isBlocked(key));
          }
        }
        return result;
      });
    }

    result.probe = await page.evaluate(() => {
      function collect(root, selector) {
        const out = [];
        const seen = new Set();
        const walk = (node) => {
          if (!node || seen.has(node)) return;
          seen.add(node);
          if (node.nodeType === 1 && node.matches && node.matches(selector)) out.push(node);
          if (node.shadowRoot) walk(node.shadowRoot);
          for (const child of node.children || []) walk(child);
        };
        walk(root); return out;
      }
      function composedElements(start) {
        const out = [];
        let node = start;
        while (node) {
          if (node.nodeType === 1) out.push(node);
          if (node.parentNode) node = node.parentNode;
          else if (node.host) node = node.host;
          else {
            const root = node.getRootNode && node.getRootNode();
            node = root && root !== node && root.host || null;
          }
        }
        return out;
      }
      // 确认框关闭后立即刷新一次，避免定时器尚未运行导致把正常隐藏状态
      // 误报为“没有一键拉黑入口”。
      if (window.OB && typeof window.OB.refreshBulk === 'function') window.OB.refreshBulk();
      const renderers = collect(document, 'bili-comment-renderer');
      const subRenderers = collect(document, 'bili-comment-reply-renderer,bili-sub-comment-renderer');
      const repliesRenderers = collect(document, 'bili-comment-replies-renderer');
      const menus = collect(document, 'bili-comment-menu');
      const first = renderers[0];
      const data = first && first.__data;
      const firstMenu = menus[0];
      const firstMenuItem = firstMenu && firstMenu.shadowRoot && firstMenu.shadowRoot.querySelector('li');
      const options = firstMenu && firstMenu.shadowRoot && firstMenu.shadowRoot.querySelector('#options');
      const identity = firstMenuItem && window.OB.identifyFromAnchor(firstMenuItem);
      const bulk = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => el.textContent.includes('评论作者'));
      const video = document.querySelector('video');
      const adapter = window.OB && window.OB.adapters && window.OB.adapters.bilibili;
      const commentTagCounts = {};
      for (const element of collect(document, '*')) {
        if (!/^BILI-.*COMMENT/.test(element.tagName)) continue;
        commentTagCounts[element.tagName] = (commentTagCounts[element.tagName] || 0) + 1;
      }
      const subDetails = subRenderers.slice(0, 8).map((renderer) => {
        const data = renderer.__data;
        const info = adapter && adapter.extract ? adapter.extract(renderer) : null;
        const chain = composedElements(renderer);
        const parent = chain.find((node) => node !== renderer && (node.tagName === 'BILI-COMMENT-RENDERER' || node.tagName === 'BILI-COMMENT-REPLIES-RENDERER'));
        const parentInfo = parent && adapter && adapter.extract ? adapter.extract(parent) : null;
        const localButtons = collect(renderer, '.ob-quick');
        return {
          ancestorTags: chain.slice(0, 8).map((node) => node.tagName),
          dataKeys: data && typeof data === 'object' ? Object.keys(data).sort().slice(0, 30) : [],
          dataShape: data && typeof data === 'object' ? {
            directMid: !!(data.mid || data.uid || data.user_id),
            memberMid: !!(data.member && (data.member.mid || data.member.uid)),
            replyMid: !!(data.reply && ((data.reply.member && data.reply.member.mid) || data.reply.mid)),
            rootMid: !!(data.root && ((data.root.member && data.root.member.mid) || data.root.mid)),
          } : null,
          identityResolved: !!(info && info.keys && info.keys.length),
          sameIdentityAsParent: !!(info && parentInfo && info.keys && parentInfo.keys && info.keys[0] === parentInfo.keys[0]),
          containerTag: info && info.container && info.container.tagName || null,
          menuCount: collect(renderer, 'bili-comment-menu').length,
          localButtonCount: localButtons.length,
        };
      });
      const replyContainerDetails = repliesRenderers.slice(0, 8).map((renderer) => {
        const data = renderer.__data;
        const controls = collect(renderer, 'button,a,[role="button"],li,span')
          .map((element) => String(element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((text) => text && /回复/.test(text))
          .map((text) => text.replace(/[^\d回复查看展开更多共条]/g, ''))
          .filter(Boolean)
          .slice(0, 8);
        return {
          dataKeys: data && typeof data === 'object' ? Object.keys(data).sort().slice(0, 30) : [],
          arrayLengths: data && typeof data === 'object' ? Object.fromEntries(
            Object.entries(data).filter((entry) => Array.isArray(entry[1])).map((entry) => [entry[0], entry[1].length])
          ) : {},
          replyControlTexts: controls,
        };
      });
      return {
        obReady: !!window.OB,
        runtime: window.OB && window.OB.runtime || null,
        commentsHost: !!document.querySelector('bili-comments'),
        commentRendererCount: renderers.length,
        commentTagCounts,
        subCommentRendererCount: subRenderers.length,
        identifiedSubCommentCount: subDetails.filter((item) => item.identityResolved).length,
        subDetails,
        replyContainerDetails,
        commentMenuCount: menus.length,
        firstMenu: firstMenuItem ? {
          rootHost: firstMenuItem.getRootNode().host && firstMenuItem.getRootNode().host.tagName,
          items: options ? Array.from(options.children).map((item) => ({ tag: item.tagName, text: (item.textContent || '').trim() })) : [],
          identityResolved: !!(identity && identity.keys && identity.keys.length),
          localButtonPresent: !!(options && options.querySelector('.ob-quick')),
        } : null,
        firstRendererData: data ? { hasMember: !!data.member, hasMid: !!((data.member && data.member.mid) || data.mid || data.uid), hasName: !!((data.member && data.member.uname) || data.uname) } : null,
        commentUserCount: window.OB && window.OB.collectUsers ? window.OB.collectUsers(document).length : null,
        bulkLabel: bulk ? bulk.textContent : null,
        quickButtonCount: collect(document, '.ob-quick').length,
        modalCandidateCount: collect(document, '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal').length,
        danmakuResources: performance.getEntriesByType('resource')
          .filter((entry) => /\/dm\/(?:wbi\/)?web\/seg\.so|\/dm\/list\.so/.test(entry.name))
          .map((entry) => ({ initiatorType: entry.initiatorType, endpoint: entry.name.replace(/[?].*$/, '') })),
        danmakuXhrTypes: window.__obXhrProbe || [],
        // 2026-08-22 真站捕获的当前结构：弹幕列表由 `.bpx-player-dm-wrap` 承载，
        // 虚拟行是 `li.bui-long-list-item` / `.dm-info-row`；旧的四个容器选择器已失效。
        danmakuPanelCount: collect(document, '.bpx-player-dm-wrap,.bui-long-list-list').length,
        danmakuRowCount: collect(document, '.bpx-player-dm-wrap li.bui-long-list-item,.bpx-player-dm-wrap .dm-info-row').length,
        danmakuLocalButtonCount: collect(document, '.bpx-player-dm-wrap .ob-dm-block').length,
        player: video ? { present: true, readyState: video.readyState, durationFinite: Number.isFinite(video.duration) } : { present: false },
      };
    });
    if (VERIFY_LOCAL_BUTTON) {
      const probe = result.probe || {};
      const menu = probe.firstMenu || {};
      const local = result.localButton || {};
      const failed = [];
      if (!result.pageLoaded) failed.push('页面未成功加载');
      if (!probe.obReady) failed.push('用户脚本未就绪');
      if (!probe.runtime || probe.runtime.version !== version || probe.runtime.build !== build) failed.push('注入源码版本/构建标识不一致');
      if (!probe.commentRendererCount) failed.push('未捕获真实评论组件');
      if (!menu.localButtonPresent || !menu.identityResolved) failed.push('真实评论菜单未注入可识别身份的本地拉黑项');
      if (!probe.commentUserCount) failed.push('未识别任何评论作者');
      if (!result.bulkBeforeInteraction || !result.bulkBeforeInteraction.visible
        || !/^🚫 (?:B站评论屏蔽|拉黑已加载评论作者)\(\d+\)$/.test(result.bulkBeforeInteraction.text || '')) {
        failed.push('已加载评论作者批量入口未出现');
      }
      if (!local.found || !local.confirm || !local.hasName) failed.push('本地拉黑确认框未显示具体用户名');
      if (local.containerTag !== 'BILI-COMMENT-THREAD-RENDERER' || !local.hidden || local.barCount !== 0 || !local.layoutClosed) failed.push('真实评论未按完整线程无提示、零占位隐藏');
      if (!local.restored) failed.push('撤销本地拉黑后真实评论未恢复');
      if (!local.thread || !local.thread.found || !local.thread.confirm || local.thread.authorCount < 2
        || local.thread.authorKeyCount < 2 || !local.thread.blocked || local.thread.writes !== 1 || !local.thread.restored) {
        failed.push('真实主评论“屏蔽该楼回复”未读取并撤销至少一位回复作者');
      }
      if (!(probe.danmakuXhrTypes || []).some((item) => item.responseType === 'arraybuffer')) failed.push('未捕获 seg.so 的 ArrayBuffer XHR');
      if (failed.length) result.errors.push('验证失败：' + failed.join('；'));
    }
    if (SAVE_SCREENSHOT) {
      const screenshot = path.join(ROOT, 'test', '_real_bili_probe_current.png');
      await page.screenshot({ path: screenshot, fullPage: false });
      result.screenshot = screenshot;
      result.menuTrigger = menuTrigger;
    }
  } catch (error) {
    result.errors.push(String(error && error.message || error));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length ? 1 : 0);
})();

/* 真实 B站页面只读探针。
 * 使用隔离的临时 Chrome 配置和内存 GM 存储；只修改该临时本地名单，
 * 不会读取用户 Cookie，也不会触发平台写操作或官方拉黑。
 * 运行：node test/real-bilibili-probe.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const requestedUrl = urlArg ? urlArg.slice('--url='.length) : '';
const URL = /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+\/?(?:[?#].*)?$/.test(requestedUrl)
  ? requestedUrl
  : 'https://www.bilibili.com/video/BV1eyYRz2E2v';
const SAVE_SCREENSHOT = process.argv.includes('--screenshot');
const VERIFY_LOCAL_BUTTON = process.argv.includes('--verify-local');
const VERIFY_SUB_COMMENT = process.argv.includes('--verify-sub-comment');
const VERIFY_DANMAKU_TOOL = process.argv.includes('--verify-danmaku-tool');
const EXPAND_REPLIES = process.argv.includes('--expand-replies') || VERIFY_SUB_COMMENT;
const userscript = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const version = (userscript.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const shim = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:true, showBulkBlock:true } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
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

(async () => {
  const result = { url: URL, version, pageLoaded: false, errors: [], probe: null };
  let browser;
  try {
    browser = await launchChromium({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => result.errors.push('pageerror: ' + error.message));
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
    let bulkBeforeInteraction;
    for (let attempt = 0; attempt < 8; attempt++) {
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
      if (window.OB && typeof window.OB.refreshBulk === 'function') window.OB.refreshBulk();
      const bulk = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => el.textContent.includes('评论作者'));
      if (!bulk) return { found: false, text: null, visible: false, modalCandidates };
      const style = getComputedStyle(bulk);
      return {
        found: true,
        text: bulk.textContent,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
        modalCandidates,
      };
      });
      if (bulkBeforeInteraction.found && bulkBeforeInteraction.visible) break;
      await sleep(750);
    }
    result.bulkBeforeInteraction = bulkBeforeInteraction;

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
        if (!panel || initialRows.length < 3) return { found: true, panel: !!panel, senderCount: initialRows.length };

        const first = initialRows[0];
        const firstHash = first.getAttribute('data-ob-dm-hash');
        const single = first.querySelector('.ob-dm-single');
        single.click(); await pause(100);
        let confirm = document.getElementById('ob-confirm');
        if (!confirm) return { found: true, panel: true, senderCount: initialRows.length, singleConfirm: false };
        confirm.querySelector('.ob-ok').click(); await pause(200);
        const singleBlocked = window.OB.Index.isBlocked('bili:dmhash:' + firstHash);
        let toast = document.getElementById('ob-toast');
        const singleUndo = toast && toast.querySelector('button');
        if (singleUndo) { singleUndo.click(); await pause(200); }
        const singleRestored = !!singleUndo && !window.OB.Index.isBlocked('bili:dmhash:' + firstHash);

        const currentRows = Array.from(panel.querySelectorAll('.ob-dm-sender'));
        const batchHashes = currentRows.slice(0, 2).map((row) => row.getAttribute('data-ob-dm-hash'));
        for (const hash of batchHashes) {
          const row = panel.querySelector('[data-ob-dm-hash="' + hash + '"]');
          const checkbox = row && row.querySelector('.ob-dm-select');
          if (!checkbox) continue;
          checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const batch = panel.querySelector('.ob-dm-batch');
        const batchReady = batchHashes.length === 2 && batch && !batch.disabled && /\(2\)/.test(batch.textContent || '');
        if (batchReady) batch.click();
        await pause(100);
        confirm = document.getElementById('ob-confirm');
        if (confirm) { confirm.querySelector('.ob-ok').click(); await pause(200); }
        const batchBlocked = batchReady && !!confirm && batchHashes.every((hash) => window.OB.Index.isBlocked('bili:dmhash:' + hash));
        const persons = Object.values(window.OB.Store.persons());
        const batchSeparate = batchHashes.length === 2 && persons.filter((person) =>
          person.identities.some((key) => batchHashes.some((hash) => key === 'bili:dmhash:' + hash))
        ).length === 2;
        toast = document.getElementById('ob-toast');
        const batchUndo = toast && toast.querySelector('button');
        if (batchUndo) { batchUndo.click(); await pause(200); }
        const batchRestored = !!batchUndo && batchHashes.every((hash) => !window.OB.Index.isBlocked('bili:dmhash:' + hash));
        const close = panel.querySelector('.ob-dm-close');
        if (close) close.click();
        return {
          found: true,
          panel: true,
          senderCount: initialRows.length,
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
      if (!dm.found || !dm.panel || dm.senderCount < 3 || !dm.singleConfirm || !dm.singleBlocked || !dm.singleRestored || !dm.batchReady || !dm.batchConfirm || !dm.batchBlocked || !dm.batchSeparate || !dm.batchRestored) {
        result.errors.push('验证失败：真实弹幕段未提供可用的单条与批量本地屏蔽工具');
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
        const targetIndex = renderers.findIndex((renderer, index) => index < renderers.length - 1 && findButton(renderer));
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
        danmakuPanelCount: collect(document, '.bpx-player-dm-container,.bpx-player-dm-list,.bpx-player-dm-list-container,.bpx-player-dm-list-view').length,
        danmakuRowCount: collect(document, '.bpx-player-dm-container li,.bpx-player-dm-list li,.bpx-player-dm-list-container li,.bpx-player-dm-list-view li').length,
        danmakuLocalButtonCount: collect(document, '.ob-dm-block').length,
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
      if (!probe.commentRendererCount) failed.push('未捕获真实评论组件');
      if (!menu.localButtonPresent || !menu.identityResolved) failed.push('真实评论菜单未注入可识别身份的本地拉黑项');
      if (!probe.commentUserCount) failed.push('未识别任何评论作者');
      if (!result.bulkBeforeInteraction || !result.bulkBeforeInteraction.visible || !/^🚫 拉黑已加载评论作者\(\d+\)$/.test(result.bulkBeforeInteraction.text || '')) failed.push('已加载评论作者批量入口未出现');
      if (!local.found || !local.confirm || !local.hasName) failed.push('本地拉黑确认框未显示具体用户名');
      if (local.containerTag !== 'BILI-COMMENT-THREAD-RENDERER' || !local.hidden || local.barCount !== 0 || !local.layoutClosed) failed.push('真实评论未按完整线程无提示、零占位隐藏');
      if (!local.restored) failed.push('撤销本地拉黑后真实评论未恢复');
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

/* 真实 B站页面只读探针。
 * 使用隔离的临时 Chrome 配置和内存 GM 存储；只修改该临时本地名单，
 * 不会读取用户 Cookie，也不会触发平台写操作或官方拉黑。
 * 运行：node test/real-bilibili-probe.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const URL = 'https://www.bilibili.com/video/BV1eyYRz2E2v';
const SAVE_SCREENSHOT = process.argv.includes('--screenshot');
const VERIFY_LOCAL_BUTTON = process.argv.includes('--verify-local');
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
      await page.evaluate(() => {
        const comments = document.querySelector('bili-comments');
        if (comments) comments.scrollIntoView({ block: 'center' });
        else window.scrollBy(0, 900);
      });
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
        return count(document, 'bili-comment-renderer');
      });
      if (found) break;
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
      const bulk = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => el.textContent.includes('本页'));
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
      // 确认框关闭后立即刷新一次，避免定时器尚未运行导致把正常隐藏状态
      // 误报为“没有一键拉黑入口”。
      if (window.OB && typeof window.OB.refreshBulk === 'function') window.OB.refreshBulk();
      const renderers = collect(document, 'bili-comment-renderer');
      const menus = collect(document, 'bili-comment-menu');
      const first = renderers[0];
      const data = first && first.__data;
      const firstMenu = menus[0];
      const firstMenuItem = firstMenu && firstMenu.shadowRoot && firstMenu.shadowRoot.querySelector('li');
      const options = firstMenu && firstMenu.shadowRoot && firstMenu.shadowRoot.querySelector('#options');
      const identity = firstMenuItem && window.OB.identifyFromAnchor(firstMenuItem);
      const bulk = Array.from(document.querySelectorAll('.ob-bulk')).find((el) => el.textContent.includes('本页'));
      const video = document.querySelector('video');
      return {
        obReady: !!window.OB,
        commentsHost: !!document.querySelector('bili-comments'),
        commentRendererCount: renderers.length,
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
      if (!result.bulkBeforeInteraction || !result.bulkBeforeInteraction.visible || !/^🚫 拉黑本页评论用户\(\d+\)$/.test(result.bulkBeforeInteraction.text || '')) failed.push('本页评论批量入口未出现');
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

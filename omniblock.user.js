// ==UserScript==
// @name          OmniBlock 拉黑不上限（6 平台统一本地黑名单）
// @namespace     https://github.com/vibeme/omniblock
// @version       0.6.0
// @description   一个本地黑名单，跨 B站/微博/知乎/百度贴吧/X(推特)/抖音 隐藏指定用户的所有内容。无数量上限、纯本地、不联网。
// @match         *://*.bilibili.com/*
// @match         *://*.weibo.com/*
// @match         *://m.weibo.cn/*
// @match         *://*.zhihu.com/*
// @match         *://tieba.baidu.com/*
// @match         *://*.x.com/*
// @match         *://*.twitter.com/*
// @match         *://*.douyin.com/*
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_deleteValue
// @grant         GM_addStyle
// @grant         GM_registerMenuCommand
// @grant         GM_addValueChangeListener
// @run-at        document-start
// @sandbox       raw
// @license       MIT
// @author        vibeme (抖音/微博适配器行为脱胎自 Pynseq-Douyin / Pynseq-Weibo，MIT；其余适配器自建)
// ==/UserScript==

/*
 * OmniBlock —— 跨平台本地黑名单
 * --------------------------------------------------------------------------
 * 设计要点（详见项目计划文档）：
 *  - 一份共享名单（GM 单键存储），6 个平台通用；可导出/导入 JSON 备份。
 *  - 三种处置：折叠（默认）、完全消失、跳过（抖音推荐流专用）。
 *  - 抖音推荐流：绝不写 media.muted（抖音把静音当全局偏好），改用视觉遮罩 + 自动切下一条，带四道安全阀。
 *  - 所有拉黑入口均为自建 UI，绝不触发平台原生"不感兴趣"/官方拉黑，避免污染推荐模型或被风控。
 *  - B站弹幕：MAIN world 拦截 seg.so，手写轻量 varint 解析 + CRC32 正向映射过滤（无需彩虹表）。
 *  - 全程本地，不联网、不上传任何数据。
 */
(function () {
  'use strict';

  // ====================================================================
  // 0. 基础工具
  // ====================================================================
  const PLATFORM_LABEL = {
    bili: 'B站', weibo: '微博', zhihu: '知乎', tieba: '贴吧', x: 'X', douyin: '抖音',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const textOf = (el) => (el ? (el.textContent || '').trim() : '');
  const attr = (el, a) => (el ? el.getAttribute(a) : null);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 归一化身份值：去空白、小写（平台 uid 多为数字，sec_uid 大小写敏感故保留原样）
  function normId(v) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    return s;
  }
  function normNick(v) {
    if (!v) return '';
    return String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ====================================================================
  // 1. 共享名单存储（一份名单，6 平台通用）
  // ====================================================================
  const STORAGE_KEY = 'omniblock:data:v1';

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideMode: 'collapse',        // 'collapse' | 'disappear'
    showHoverButton: true,
    douyinAutoSkip: true,
    skipCap: 6,                  // 连续跳过上限，超过则停在遮罩不再自动切
  };

  const Store = (function () {
    let data = null;             // { version, persons:{}, settings:{} }
    const listeners = [];

    function load() {
      if (data) return data;
      let raw;
      try { raw = GM_getValue(STORAGE_KEY, null); } catch (e) { raw = null; }
      if (raw && typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = null; }
      }
      if (!raw || typeof raw !== 'object') raw = null;
      data = raw && raw.persons ? raw : { version: 1, persons: {}, settings: { ...DEFAULT_SETTINGS } };
      if (!data.settings) data.settings = { ...DEFAULT_SETTINGS };
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (data.settings[k] === undefined) data.settings[k] = DEFAULT_SETTINGS[k];
      }
      return data;
    }

    function persist() {
      try { GM_setValue(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* 配额/隐私模式 */ }
      listeners.forEach((fn) => { try { fn(); } catch (e) {} });
    }

    function persons() { return load().persons; }
    function settings() { return load().settings; }
    function setSetting(k, v) { load().settings[k] = v; persist(); }
    function getSetting(k) { return load().settings[k]; }

    function genId() {
      return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // 按原始身份键数组新增一个"人物"，或合并进已有（同平台同值则合并）
    function addIdentities(keys, label, note) {
      load();
      const pset = persons();
      let target = null;
      // 命中已有同键则合并
      for (const id in pset) {
        if (keys.some((k) => pset[id].identities.includes(k))) { target = pset[id]; break; }
      }
      if (!target) {
        target = { label: label || '未命名', note: note || '', createdAt: Date.now(), hits: 0, identities: [] };
        const id = genId();
        pset[id] = target;
      }
      let added = 0;
      for (const k of keys) {
        if (k && !target.identities.includes(k)) { target.identities.push(k); added++; }
      }
      if (label && target.label === '未命名') target.label = label;
      persist();
      return { person: target, added };
    }

    function removePerson(id) {
      load();
      if (persons()[id]) { delete persons()[id]; persist(); return true; }
      return false;
    }

    function removeIdentity(key) {
      load();
      let removed = false;
      for (const id in persons()) {
        const arr = persons()[id].identities;
        const i = arr.indexOf(key);
        if (i >= 0) { arr.splice(i, 1); removed = true; if (arr.length === 0) delete persons()[id]; }
      }
      if (removed) persist();
      return removed;
    }

    function allIdentities() {
      const set = new Set();
      const pset = persons();
      for (const id in pset) for (const k of pset[id].identities) set.add(k);
      return set;
    }

    function exportJSON() {
      return JSON.stringify({ version: 1, exportedAt: Date.now(), persons: persons(), settings: settings() }, null, 2);
    }

    function importJSON(text) {
      const obj = JSON.parse(text);
      if (!obj || !obj.persons) throw new Error('格式不正确：缺少 persons');
      load();
      const cur = persons();
      for (const id in obj.persons) {
        const p = obj.persons[id];
        if (!p || !Array.isArray(p.identities)) continue;
        let target = null;
        for (const k of p.identities) {
          for (const cid in cur) { if (cur[cid].identities.includes(k)) { target = cur[cid]; break; } }
          if (target) break;
        }
        if (!target) { target = { label: p.label || '未命名', note: p.note || '', createdAt: p.createdAt || Date.now(), hits: p.hits || 0, identities: [] }; const nid = genId(); cur[nid] = target; }
        for (const k of p.identities) if (!target.identities.includes(k)) target.identities.push(k);
      }
      if (obj.settings) for (const k of Object.keys(DEFAULT_SETTINGS)) if (obj.settings[k] !== undefined) data.settings[k] = obj.settings[k];
      persist();
    }

    // 跨标签页/设置变更的监听
    try {
      GM_addValueChangeListener(STORAGE_KEY, () => { data = null; load(); listeners.forEach((fn) => { try { fn(); } catch (e) {} }); });
    } catch (e) { /* 不支持则忽略 */ }

    function onChange(fn) { listeners.push(fn); }

    return {
      persons, settings, setSetting, getSetting, addIdentities, removePerson,
      removeIdentity, allIdentities, exportJSON, importJSON, onChange,
    };
  })();

  // 内存索引：身份键 → 是否屏蔽（O(1) 判定）
  const Index = (function () {
    let set = new Set();
    function rebuild() { set = Store.allIdentities(); return set; }
    rebuild();
    Store.onChange(rebuild);
    return {
      isBlocked(keys) { if (!Array.isArray(keys)) keys = [keys]; return keys.some((k) => k && set.has(k)); },
      has(k) { return set.has(k); },
      size() { return set.size; },
      rebuild,
    };
  })();

  // ====================================================================
  // 2. 隐藏引擎：折叠 / 完全消失
  // ====================================================================
  GM_addStyle(`
    [data-ob-blocked="1"].ob-collapsed { position: relative !important; }
    [data-ob-blocked="1"].ob-collapsed > * { max-height: 0 !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    .ob-bar {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      font-size: 13px; line-height: 1.6; padding: 6px 10px; margin: 2px 0;
      background: #f3f3f5; color: #888; border-left: 3px solid #bbb; border-radius: 4px;
    }
    .ob-bar:hover { background: #ececf0; }
    [data-ob-blocked="1"].ob-expanded > * { max-height: none !important; overflow: visible !important; opacity: 1 !important; pointer-events: auto !important; }
    [data-ob-blocked="1"].ob-hidden { display: none !important; }

    /* 抖音推荐流遮罩 */
    #ob-feed-cover {
      position: fixed; inset: 0; z-index: 2147483640;
      background: rgba(0,0,0,0.82); color: #fff;
      display: flex; align-items: center; justify-content: center; flex-direction: column;
      font-size: 16px; backdrop-filter: blur(6px); pointer-events: none;
    }
    #ob-feed-cover small { opacity: 0.7; margin-top: 6px; font-size: 12px; }

    /* 悬浮拉黑按钮 */
    .ob-block-btn {
      display: inline-flex !important; align-items: center; gap: 3px; cursor: pointer;
      font-size: 12px; color: #c0392b !important; border: 1px solid #e0b4b0;
      border-radius: 4px; padding: 1px 6px; margin-left: 6px; user-select: none;
      background: #fff5f4 !important; vertical-align: middle; line-height: 1.4;
    }
    .ob-block-btn:hover { background: #ffe9e7 !important; }

    /* 右键浮动菜单 */
    #ob-ctx {
      position: fixed; z-index: 2147483647; background: #fff; color: #222;
      border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 4px; min-width: 140px; font-size: 13px;
    }
    #ob-ctx button {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 7px 10px; border-radius: 5px; cursor: pointer; color: #c0392b; font-size: 13px;
    }
    #ob-ctx button:hover { background: #f5f5f5; }

    /* 确认气泡 */
    #ob-confirm {
      position: fixed; z-index: 2147483646; background: #fff; color: #222;
      border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 6px 26px rgba(0,0,0,0.22);
      padding: 14px 16px; width: 260px; font-size: 13px;
    }
    #ob-confirm .ob-title { font-weight: 600; margin-bottom: 4px; }
    #ob-confirm .ob-sub { color: #888; margin-bottom: 10px; word-break: break-all; }
    #ob-confirm .ob-row { display: flex; gap: 8px; }
    #ob-confirm button { flex: 1; border: 0; border-radius: 6px; padding: 7px 0; cursor: pointer; font-size: 13px; }
    #ob-confirm .ob-ok { background: #c0392b; color: #fff; }
    #ob-confirm .ob-no { background: #eee; color: #444; }

    /* 撤销 toast */
    #ob-toast {
      position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
      z-index: 2147483645; background: rgba(30,30,30,0.92); color: #fff;
      padding: 10px 16px; border-radius: 8px; font-size: 13px; display: flex; gap: 12px; align-items: center;
    }
    #ob-toast button { background: transparent; border: 0; color: #ffb3aa; cursor: pointer; font-size: 13px; }

    /* 选项面板 */
    #ob-panel { position: fixed; inset: 0; z-index: 2147483644; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; }
    #ob-panel .ob-box { background: #fff; color: #222; width: min(680px, 92vw); max-height: 86vh; overflow: auto; border-radius: 12px; padding: 18px; font-size: 13px; }
    #ob-panel h2 { margin: 0 0 10px; font-size: 16px; }
    #ob-panel h3 { margin: 16px 0 6px; font-size: 14px; }
    #ob-panel input, #ob-panel select, #ob-panel textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
    #ob-panel .ob-list { border: 1px solid #eee; border-radius: 8px; max-height: 260px; overflow: auto; }
    #ob-panel .ob-item { display: flex; justify-content: space-between; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #f2f2f2; align-items: center; }
    #ob-panel .ob-item:last-child { border-bottom: 0; }
    #ob-panel .ob-item .ob-meta { color: #999; font-size: 11px; word-break: break-all; }
    #ob-panel .ob-del { color: #c0392b; cursor: pointer; border: 0; background: transparent; font-size: 12px; white-space: nowrap; }
    #ob-panel .ob-close { float: right; cursor: pointer; border: 0; background: transparent; font-size: 18px; color: #999; }
  `);

  const processed = new WeakSet();   // 已处理过的节点，防重复/死循环

  function makeBar(label) {
    const bar = document.createElement('div');
    bar.className = 'ob-bar';
    bar.textContent = `🔇 内容已屏蔽${label ? ' · ' + label : ''} · 点击展开`;
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = bar.nextElementSibling;
      if (el && el.hasAttribute('data-ob-blocked')) el.classList.toggle('ob-expanded');
    });
    return bar;
  }

  // 标记一个容器为已屏蔽（折叠或完全消失）
  function markBlocked(container, label) {
    if (!container || processed.has(container)) return;
    processed.add(container);
    const mode = Store.getSetting('hideMode');
    container.setAttribute('data-ob-blocked', '1');
    container.classList.remove('ob-hidden', 'ob-collapsed', 'ob-expanded');
    if (mode === 'disappear') {
      container.classList.add('ob-hidden');
    } else {
      container.classList.add('ob-collapsed');
      const bar = makeBar(label);
      container.parentNode && container.parentNode.insertBefore(bar, container);
      // 记录 bar 以便后续若取消屏蔽可移除
      container.__obBar = bar;
    }
  }

  function unmark(container) {
    if (!container) return;
    if (container.__obBar && container.__obBar.parentNode) container.__obBar.parentNode.removeChild(container.__obBar);
    container.__obBar = null;
    container.removeAttribute('data-ob-blocked');
    container.classList.remove('ob-hidden', 'ob-collapsed', 'ob-expanded');
    processed.delete(container);
  }

  // 通用：处理一个"条目"——抽出身份，命中则隐藏
  function handleItem(adapter, item) {
    if (processed.has(item)) {
      // 已处理但可能已不在名单：检查是否仍需隐藏
    }
    const info = adapter.extract(item);
    if (!info) { processed.add(item); return; }
    if (Index.isBlocked(info.keys)) {
      const container = (adapter.containerOf && adapter.containerOf(item)) || item;
      if (adapter.forceMode === 'collapse') {
        // 虚拟列表：只折叠，绝不 display:none
        markBlocked(container, info.label);
        if (Store.getSetting('hideMode') === 'disappear') {
          container.classList.remove('ob-hidden');
          container.classList.add('ob-collapsed');
          if (!container.__obBar && container.parentNode) container.parentNode.insertBefore(makeBar(info.label), container);
        }
      } else {
        markBlocked(container, info.label);
      }
    } else if (item.hasAttribute && item.hasAttribute('data-ob-blocked')) {
      unmark(item);
    }
  }

  // ====================================================================
  // 3. 扫描器：MutationObserver + rAF 批处理 + 节流
  // ====================================================================
  function createScanner(adapter) {
    let scheduled = false;
    function scanOnce() {
      scheduled = false;
      if (!Store.getSetting('enabled')) return;
      if (adapter.selectors) {
        for (const sel of adapter.selectors) {
          for (const item of $$(sel)) {
            try { handleItem(adapter, item); } catch (e) {}
          }
        }
      }
      try { adapter.onScan && adapter.onScan(); } catch (e) {}
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(scanOnce);
    }
    const mo = new MutationObserver(() => schedule());
    // 初始扫描 + 监听
    schedule();
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      document.addEventListener('DOMContentLoaded', () => { try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e2) {} });
    }
    // SPA 路由切换：重新全扫
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; schedule(); }
    }, 1000);
    return { schedule, scanOnce };
  }

  // ====================================================================
  // 4. 拉黑入口 UI（右键菜单 + 悬浮按钮 + 确认气泡 + 撤销 toast）
  // ====================================================================
  function buildContextMenu(x, y, info, onBlock) {
    let ctx = $('#ob-ctx');
    if (ctx) ctx.remove();
    ctx = document.createElement('div');
    ctx.id = 'ob-ctx';
    ctx.style.left = x + 'px';
    ctx.style.top = y + 'px';
    const btn = document.createElement('button');
    btn.textContent = `🚫 拉黑此用户${info.label ? '：' + info.label : ''}`;
    btn.onclick = (e) => { e.stopPropagation(); ctx.remove(); onBlock(); };
    ctx.appendChild(btn);
    document.body.appendChild(ctx);
    setTimeout(() => { const close = (ev) => { if (!ctx.contains(ev.target)) { ctx.remove(); document.removeEventListener('click', close); } }; document.addEventListener('click', close); }, 0);
  }

  function showConfirm(label, keys, anchorEl) {
    let box = $('#ob-confirm');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ob-confirm';
    box.innerHTML = `<div class="ob-title">确认拉黑？</div><div class="ob-sub"></div><div class="ob-row"><button class="ob-no">取消</button><button class="ob-ok">拉黑</button></div>`;
    box.querySelector('.ob-sub').textContent = (label || '该用户') + '\n' + keys.join('  ');
    box.querySelector('.ob-no').onclick = () => box.remove();
    let rect = { left: window.innerWidth / 2 - 130, top: window.innerHeight / 2 - 60 };
    if (anchorEl && anchorEl.getBoundingClientRect) { const r = anchorEl.getBoundingClientRect(); rect = { left: clamp(r.left, 8, window.innerWidth - 280), top: clamp(r.bottom + 6, 8, window.innerHeight - 160) }; }
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    document.body.appendChild(box);
    box.querySelector('.ob-ok').onclick = () => {
      const res = Store.addIdentities(keys, label);
      box.remove();
      showToast(`已拉黑：${label || keys[0]}`, () => { /* 撤销：移除刚加的身份 */ keys.forEach((k) => Store.removeIdentity(k)); });
      // 立即重扫
      if (currentScanner) currentScanner.schedule();
    };
  }

  function showToast(msg, onUndo) {
    let t = $('#ob-toast');
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'ob-toast';
    t.innerHTML = `<span></span><button>撤销</button>`;
    t.querySelector('span').textContent = msg;
    let undone = false;
    t.querySelector('button').onclick = () => { if (undone) return; undone = true; onUndo && onUndo(); t.remove(); if (currentScanner) currentScanner.schedule(); };
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 5000);
  }

  // 在某元素上插入悬浮拉黑按钮
  function attachHoverButton(adapter, container, info) {
    if (container.__obHover) return;
    const anchor = (adapter.actionAnchorOf && adapter.actionAnchorOf(container)) || container;
    if (!anchor) return;
    const btn = document.createElement('span');
    btn.className = 'ob-block-btn';
    btn.textContent = '🚫 拉黑';
    btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); showConfirm(info.label, info.keys, btn); };
    anchor.appendChild(btn);
    container.__obHover = btn;
  }

  let currentScanner = null;

  // 右键：若光标在某条目上，弹出自建菜单（不触发平台原生"不感兴趣"）
  document.addEventListener('contextmenu', (e) => {
    if (!Store.getSetting('enabled')) return;
    const adapter = currentAdapter;
    if (!adapter || !adapter.selectors) return;
    let found = null;
    for (const sel of adapter.selectors) {
      const el = e.target.closest && e.target.closest(sel);
      if (el) { const info = adapter.extract(el); if (info && info.keys.length) { found = { el, info }; break; } }
    }
    if (!found) return;
    e.preventDefault();   // 仅当命中条目时接管右键
    buildContextMenu(e.clientX, e.clientY, found.info, () => showConfirm(found.info.label, found.info.keys, found.el));
  }, true);

  // 悬浮按钮：mouseover 时为其挂拉黑按钮（为避免卡顿，仅在命中条目时）
  document.addEventListener('mouseover', (e) => {
    if (!Store.getSetting('showHoverButton') || !Store.getSetting('enabled')) return;
    const adapter = currentAdapter;
    if (!adapter || !adapter.selectors) return;
    if (e.target.__obHoverAttached) return;
    for (const sel of adapter.selectors) {
      const el = e.target.closest && e.target.closest(sel);
      if (el) {
        const info = adapter.extract(el);
        if (info && info.keys.length && !Index.isBlocked(info.keys)) {
          e.target.__obHoverAttached = true;
          attachHoverButton(adapter, el, info);
        }
        break;
      }
    }
  }, true);

  // ====================================================================
  // 5. 各平台适配器
  // ====================================================================
  const Adapters = {};

  // ---------- 抖音 ----------
  Adapters.douyin = (function () {
    const SEL = {
      comment: '[data-e2e="comment-item"]',
      commentUser: '[data-e2e="comment-username"], a[href*="/user/"]',
      searchCard: '[data-e2e="general-card"], [data-e2e="search-card"]',
      postList: '[data-e2e="user-post-list"] [data-e2e="scroll-list"] > *, [data-e2e="video-desc"]',
      feedActive: '[data-e2e="feed-active-video"]',
      feedAuthorLink: '[data-e2e="video-avatar"][href*="/user/"], a[href*="/user/"]',
      feedAuthorName: '[data-e2e="feed-video-nickname"], [data-e2e="feed-author-name"]',
      danmaku: '[data-danmu-id], [data-danmaku-id], [data-danmaku-user-id], [data-danmu-user-id]',
    };

    function secUidFromHref(href) {
      if (!href) return '';
      try {
        const u = new URL(href, location.href);
        const s = u.searchParams.get('sec_uid') || u.searchParams.get('secUid');
        if (s) return normId(s);
        const m = u.pathname.match(/\/user\/([^/?#]+)/);
        if (m) return normId(decodeURIComponent(m[1]));
      } catch (e) {}
      return '';
    }

    function extractComment(item) {
      const link = item.querySelector('a[href*="/user/"]');
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(item.querySelector('[data-e2e="comment-username"]')) || textOf(link);
      const keys = [];
      if (sec) keys.push('douyin:secuid:' + sec);
      return { keys, label: name, container: item };
    }

    function extractGeneric(item) {
      const link = item.querySelector('a[href*="/user/"]');
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(item.querySelector('[data-e2e="feed-video-nickname"], [data-e2e="feed-author-name"]')) || textOf(link);
      const keys = [];
      if (sec) keys.push('douyin:secuid:' + sec);
      return { keys, label: name, container: item };
    }

    function extractDanmaku(item) {
      const uid = normId(attr(item, 'data-danmaku-user-id') || attr(item, 'data-danmu-user-id') || attr(item, 'data-user-id') || attr(item, 'data-uid'));
      const sec = secUidFromHref(attr(item, 'data-sec-uid') || attr(item, 'href') || '');
      const keys = [];
      if (uid) keys.push('douyin:uid:' + uid);
      if (sec) keys.push('douyin:secuid:' + sec);
      if (!keys.length) return null;   // 无身份属性则跳过（抖音弹幕兜底见计划 M5）
      return { keys, label: '', container: item };
    }

    // 推荐流自动切：视觉遮罩 + 点下一条，带四道安全阀
    const skippedIds = new WeakSet();
    let consecutive = 0;
    let coverEl = null;
    function ensureCover() {
      if (coverEl) return coverEl;
      coverEl = document.createElement('div');
      coverEl.id = 'ob-feed-cover';
      coverEl.style.display = 'none';
      document.body.appendChild(coverEl);
      return coverEl;
    }
    function clearCover() { if (coverEl) coverEl.style.display = 'none'; }

    function advance() {
      const next = $('[data-e2e="video-switch-next-arrow"]');
      if (next && next.offsetParent !== null && !next.disabled && next.getAttribute('aria-disabled') !== 'true') {
        next.click();
        return true;
      }
      // 兜底：向 document 派发 ArrowDown（抖音监听 document）
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      return true;
    }

    function feedTick() {
      const active = $(SEL.feedActive);
      if (!active) { clearCover(); consecutive = 0; return; }
      const link = active.querySelector(SEL.feedAuthorLink);
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(active.querySelector(SEL.feedAuthorName)) || textOf(link);
      if (!sec) { clearCover(); return; }   // 拿不到作者身份就不动
      const blocked = Index.isBlocked(['douyin:secuid:' + sec]);
      if (!blocked) { clearCover(); consecutive = 0; return; }

      const videoId = attr(active, 'data-e2e-vid') || sec;
      ensureCover();
      coverEl.style.display = 'flex';
      coverEl.innerHTML = `🔇 已自动跳过被屏蔽作者<small>${name ? '（' + name + '）' : ''} · 如误切可手动划走</small>`;

      if (!Store.getSetting('douyinAutoSkip')) return;   // 仅遮罩，不自动切
      if (skippedIds.has(active)) return;                // 安全阀② 同视频只切一次
      if (consecutive >= (Store.getSetting('skipCap') || 6)) { return; }  // 安全阀③ 连续上限

      skippedIds.add(active);
      consecutive++;
      const delay = rand(200, 600);                      // 安全阀① 随机延迟
      setTimeout(advance, delay);
    }

    return {
      id: 'douyin',
      match: (h) => /(^|\.)douyin\.com$/.test(h.hostname),
      selectors: [SEL.comment, SEL.searchCard, SEL.postList, SEL.danmaku],
      extract(item) {
        if (item.matches && item.matches(SEL.comment)) return extractComment(item);
        if (item.matches && item.matches(SEL.danmaku)) return extractDanmaku(item);
        return extractGeneric(item);
      },
      containerOf: (item) => item,
      onScan: feedTick,
    };
  })();

  // ---------- 微博 ----------
  Adapters.weibo = (function () {
    const SEL = {
      card: '[action-type="feed_list_item"], .WB_feed_type, article[class*="vue-card"], .card-feed',
      userLink: 'a[href*="/u/"], a[href*="/n/"], a[nick-name], [data-user-card]',
    };
    function uidFromLink(link) {
      if (!link) return '';
      const href = attr(link, 'href') || '';
      const m = href.match(/\/u\/(\d+)/) || href.match(/\/(\d{6,})/);
      if (m) return normId(m[1]);
      const card = attr(link, 'data-user-card') || attr(link, 'nick-name');
      return '';
    }
    function findCard(el) {
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(SEL.card)) return p;
        p = p.parentElement;
      }
      return el;
    }
    return {
      id: 'weibo',
      match: (h) => /(^|\.)weibo\.com$/.test(h.hostname) || /(^|\.)weibo\.cn$/.test(h.hostname),
      selectors: [SEL.card],
      extract(item) {
        const link = item.querySelector(SEL.userLink);
        const uid = uidFromLink(link);
        const name = textOf(link) || attr(link, 'nick-name');
        const keys = [];
        if (uid) keys.push('weibo:uid:' + uid);
        if (name) keys.push('weibo:name:' + normNick(name));
        return { keys, label: name, container: findCard(item) };
      },
      containerOf: (item) => findCard(item),
    };
  })();

  // ---------- 知乎 ----------
  Adapters.zhihu = (function () {
    const SEL = {
      item: '.ContentItem, .FeedCard, .TopstoryItem, [data-testid="AnswerCard"], .CommentItem, .List-item',
      userLink: 'a[href*="/people/"], a[href*="/org/"]',
    };
    function idFromLink(link) {
      if (!link) return { id: '', token: '' };
      const href = attr(link, 'href') || '';
      const m = href.match(/\/(people|org)\/([^/?#]+)/);
      if (m) return { token: normId(m[2]) };
      return { token: '' };
    }
    function findCard(el) {
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(SEL.item)) return p;
        p = p.parentElement;
      }
      return el;
    }
    return {
      id: 'zhihu',
      match: (h) => /(^|\.)zhihu\.com$/.test(h.hostname),
      selectors: [SEL.item],
      extract(item) {
        const link = item.querySelector(SEL.userLink);
        const { token } = idFromLink(link);
        const name = textOf(link);
        const keys = [];
        if (token) keys.push('zhihu:token:' + token);   // 永久 id 优先
        if (name) keys.push('zhihu:name:' + normNick(name)); // 仅兜底
        return { keys, label: name, container: findCard(item) };
      },
      containerOf: (item) => findCard(item),
    };
  })();

  // ---------- X / Twitter ----------
  Adapters.x = (function () {
    const SEL = {
      tweet: 'article[data-testid="tweet"]',
      cell: '[data-testid="cellInnerDiv"]',
      userLink: 'a[role="link"][href^="/"]',
    };
    // X 时间线是虚拟列表，强制折叠（保留节点，不 display:none），防闪烁/错位
    function findCell(el) {
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(SEL.cell)) return p;
        p = p.parentElement;
      }
      return el.closest(SEL.tweet) || el;
    }
    return {
      id: 'x',
      match: (h) => /(^|\.)(x|twitter)\.com$/.test(h.hostname),
      forceMode: 'collapse',
      selectors: [SEL.tweet],
      extract(item) {
        // 取推文作者链接（形如 /handle）
        const links = $$('a[role="link"]', item);
        let handle = '';
        for (const l of links) {
          const href = attr(l, 'href') || '';
          const m = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
          if (m && !l.querySelector('svg') && textOf(l) === '@' + m[1]) { handle = m[1]; break; }
          const m2 = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
          if (m2 && !href.includes('/status/') && !href.includes('/photo') && !href.includes('/video')) { handle = m2[1]; break; }
        }
        const keys = [];
        if (handle) keys.push('x:handle:' + handle.toLowerCase());
        return { keys, label: handle ? '@' + handle : '', container: findCell(item) };
      },
      containerOf: (item) => findCell(item),
    };
  })();

  // ---------- 百度贴吧 ----------
  Adapters.tieba = (function () {
    const SEL = {
      thread: 'li.j_thread_list, div.threadlist_item',
      post: 'div.l_post.l_post_bright, div.d_post_content_main',
      lzl: '.j_lzl_container, .lzl_cnt',
      author: 'span.tb_icon_author[data-field], div.d_name[data-field], [data-field]',
    };
    function uidFromField(el) {
      const f = attr(el, 'data-field');
      if (!f) return { uid: '', name: '' };
      try {
        const o = JSON.parse(f);
        const uid = o.user_id || (o.author && o.author.user_id) || (o.data && o.data.user_id) || '';
        const name = o.user_name || (o.author && o.author.user_name) || (o.data && o.data.user_name) || '';
        return { uid: normId(uid), name: normNick(name) };
      } catch (e) { return { uid: '', name: '' }; }
    }
    function findContainer(el, sel) {
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(sel)) return p;
        p = p.parentElement;
      }
      return el;
    }
    return {
      id: 'tieba',
      match: (h) => /(^|\.)tieba\.baidu\.com$/.test(h.hostname),
      selectors: [SEL.thread, SEL.post, SEL.lzl],
      extract(item) {
        let fieldEl = item.querySelector(SEL.author);
        if (!fieldEl && item.hasAttribute && item.hasAttribute('data-field')) fieldEl = item;
        const { uid, name } = fieldEl ? uidFromField(fieldEl) : { uid: '', name: '' };
        const keys = [];
        if (uid) keys.push('tieba:uid:' + uid);
        if (name) keys.push('tieba:name:' + name);
        const container = item.matches(SEL.thread) ? findContainer(item, SEL.thread)
          : item.matches(SEL.lzl) ? findContainer(item, SEL.lzl)
          : findContainer(item, SEL.post);
        return { keys, label: name, container };
      },
      containerOf: (item) => item,
    };
  })();

  // ---------- B站 ----------
  Adapters.bilibili = (function () {
    const SEL = {
      comment: 'bili-comment-renderer, .comment-item, .reply-item, [data-comment-id]',
      dyn: '.bili-dyn-item, .bili-dynamic-card, [data-dyn-id]',
      videoCard: '.bili-video-card, .video-card, a[href*="//www.bilibili.com/video/"]',
      space: '.space-item, .list-item',
    };
    function midFromEl(el) {
      // lit 组件常把数据挂到 __data.mid / __data.uid
      const d = el.__data;
      if (d) {
        const mid = d.mid || d.uid || (d.user && (d.user.mid || d.user.uid)) || (d.member && d.member.mid);
        if (mid) return normId(mid);
      }
      const link = el.querySelector('a[href*="space.bilibili.com/"]');
      if (link) {
        const m = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/);
        if (m) return normId(m[1]);
      }
      const up = el.querySelector('[data-up-mid], [data-mid], [data-uid]');
      if (up) return normId(attr(up, 'data-up-mid') || attr(up, 'data-mid') || attr(up, 'data-uid'));
      return '';
    }
    // B站评论是 Shadow DOM 嵌套，需递归穿透挂载 observer（简化：对 document 全树扫描 + 处理 shadowRoot）
    function walkShadow(root, cb) {
      if (!root) return;
      cb(root);
      const kids = root.shadowRoot ? [root.shadowRoot] : (root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : []);
      for (const k of kids) walkShadow(k, cb);
    }
    return {
      id: 'bilibili',
      match: (h) => /(^|\.)bilibili\.com$/.test(h.hostname),
      selectors: [SEL.comment, SEL.dyn, SEL.videoCard, SEL.space],
      extract(item) {
        const mid = midFromEl(item);
        const name = textOf(item.querySelector('.user-name, .uname, [data-name]'));
        const keys = [];
        if (mid) keys.push('bili:uid:' + mid);
        return { keys, label: name, container: item };
      },
      containerOf: (item) => item,
      onScan() {
        // 递归穿透 Shadow DOM 处理评论区
        if (!Store.getSetting('enabled')) return;
        const roots = [document];
        const seen = new Set();
        function rec(node) {
          if (!node || seen.has(node)) return;
          seen.add(node);
          if (node.querySelectorAll) {
            for (const sel of Adapters.bilibili.selectors) {
              for (const el of Array.from(node.querySelectorAll(sel))) {
                if (!processed.has(el)) { try { handleItem(Adapters.bilibili, el); } catch (e) {} }
              }
            }
          }
          if (node.shadowRoot) rec(node.shadowRoot);
          if (node.querySelectorAll) for (const c of Array.from(node.querySelectorAll('*'))) if (c.shadowRoot) rec(c.shadowRoot);
        }
        rec(document);
      },
    };
  })();

  // ====================================================================
  // 6. B站弹幕过滤（MAIN world 拦截 seg.so + CRC32 正向映射）
  // ====================================================================
  function setupBilibiliDanmaku() {
    if (!/(^|\.)bilibili\.com$/.test(location.hostname)) return;
    if (typeof window.fetch !== 'function') return;

    // CRC32 表
    const crcTable = (function () {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      return t;
    })();
    function crc32(str) {
      let c = 0xFFFFFFFF;
      for (let i = 0; i < str.length; i++) c = crcTable[(c ^ str.charCodeAt(i)) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function blockedHashes() {
      const set = new Set();
      // 从当前屏蔽名单里把 bili:uid:N 算成 dmhash
      const all = Store.allIdentities();
      for (const key of all) {
        const m = key.match(/^bili:uid:(\d+)$/);
        if (m) set.add(crc32(m[1]).toString(16));
      }
      return set;
    }

    // 轻量 protobuf 解析：top-level repeated 消息 field1=elems；每个 elem 内 field6=midHash(string)
    function readVarint(buf, pos) {
      let result = 0, shift = 0, b;
      do { b = buf[pos++]; result |= (b & 0x7F) << shift; shift += 7; } while (b & 0x80 && pos < buf.length);
      return { value: result >>> 0, next: pos };
    }
    function findMidHashInElem(buf, start, end) {
      let p = start;
      while (p < end) {
        const tag = readVarint(buf, p); p = tag.next;
        const field = tag.value >> 3, wt = tag.value & 7;
        if (field === 6 && wt === 2) {
          const len = readVarint(buf, p); p = len.next;
          let s = '';
          for (let i = p; i < p + len.value; i++) s += String.fromCharCode(buf[i]);
          return s;
        } else if (wt === 0) { p = readVarint(buf, p).next; }
        else if (wt === 1) { p += 8; }
        else if (wt === 5) { p += 4; }
        else if (wt === 2) { const l = readVarint(buf, p); p = l.next + l.value; }
        else return null;
      }
      return null;
    }

    function filterSeg(bytes) {
      const blocked = blockedHashes();
      if (blocked.size === 0) return bytes;
      const buf = new Uint8Array(bytes);
      const out = [];
      let p = 0;
      while (p < buf.length) {
        const tag = readVarint(buf, p);
        const field = tag.value >> 3, wt = tag.value & 7;
        if (field === 1 && wt === 2) {
          const lenInfo = readVarint(buf, tag.next);
          const elemStart = lenInfo.next, elemEnd = lenInfo.next + lenInfo.value;
          const hash = findMidHashInElem(buf, elemStart, elemEnd);
          if (hash && blocked.has(hash.toLowerCase())) { p = elemEnd; continue; } // 丢弃该弹幕
          // 保留：把 tag+len+body 原样写入
          for (let i = p; i < elemEnd; i++) out.push(buf[i]);
          p = elemEnd;
        } else if (wt === 0) { for (let i = p; i < tag.next; i++) out.push(buf[i]); p = readVarint(buf, tag.next).next; }
        else if (wt === 1) { for (let i = p; i < tag.next + 8; i++) out.push(buf[i]); p = tag.next + 8; }
        else if (wt === 5) { for (let i = p; i < tag.next + 4; i++) out.push(buf[i]); p = tag.next + 4; }
        else if (wt === 2) { const l = readVarint(buf, tag.next); for (let i = p; i < tag.next + l.value + (l.next - tag.next); i++) out.push(buf[i]); p = l.next + l.value; }
        else { out.push(buf[p]); p++; }
      }
      return out;
    }

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const isDanmaku = /dm\/web\/seg\.so/.test(url) || /dm\/web\/view/.test(url) || /dm\/list\.so/.test(url);
      if (!isDanmaku || !Store.getSetting('enabled')) return nativeFetch(input, init);
      return nativeFetch(input, init).then(async (resp) => {
        try {
          const buf = await resp.arrayBuffer();
          const filtered = filterSeg(buf);
          // 重建响应时丢掉内容编码相关头，否则浏览器会二次解压导致弹幕全失
          const hdr = new Headers();
          resp.headers.forEach((v, k) => {
            if (/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) return;
            hdr.append(k, v);
          });
          return new Response(new Uint8Array(filtered), { status: resp.status, statusText: resp.statusText, headers: hdr });
        } catch (e) {
          return resp;
        }
      });
    };
  }

  // ====================================================================
  // 7. 选项面板
  // ====================================================================
  function openOptions() {
    let panel = $('#ob-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'ob-panel';
    panel.innerHTML = `
      <div class="ob-box">
        <button class="ob-close">×</button>
        <h2>OmniBlock 设置（拉黑不上限）</h2>
        <div class="ob-meta">当前屏蔽身份数：<b id="ob-count">0</b> · 平台：B站/微博/知乎/贴吧/X/抖音</div>

        <h3>新增屏蔽</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="ob-plat">
            <option value="bili">B站 uid</option>
            <option value="weibo">微博 uid</option>
            <option value="zhihu">知乎 token</option>
            <option value="tieba">贴吧 uid</option>
            <option value="x">X handle</option>
            <option value="douyin">抖音 sec_uid</option>
          </select>
          <input id="ob-val" placeholder="身份值（如 2233 / MS4wLjAB... / elonmusk）" style="flex:1;min-width:200px">
          <input id="ob-label" placeholder="备注名（可选）" style="width:140px">
          <button id="ob-add" style="background:#c0392b;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer">添加</button>
        </div>

        <h3>隐藏方式</h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <label><input type="radio" name="ob-mode" value="collapse" checked> 折叠成灰条（默认，可追溯）</label>
          <label><input type="radio" name="ob-mode" value="disappear"> 完全消失</label>
          <label><input type="checkbox" id="ob-enabled" checked> 启用屏蔽</label>
          <label><input type="checkbox" id="ob-hover" checked> 显示悬浮拉黑按钮</label>
          <label><input type="checkbox" id="ob-skip" checked> 抖音推荐流自动切下一条</label>
        </div>

        <h3>名单（点击删除）</h3>
        <div class="ob-list" id="ob-list"></div>

        <h3>备份</h3>
        <div style="display:flex;gap:8px">
          <button id="ob-export" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导出 JSON</button>
          <button id="ob-import" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导入 JSON</button>
          <input type="file" id="ob-file" accept="application/json" style="display:none">
        </div>
        <p style="color:#999;font-size:12px;margin-top:14px">纯本地工具，不联网、不上传任何数据。抖音推荐流跳过是唯一一处"模拟操作"，已带随机延迟/连续上限等安全阀。</p>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.ob-close').onclick = () => panel.remove();
    panel.onclick = (e) => { if (e.target === panel) panel.remove(); };

    function refresh() {
      panel.querySelector('#ob-count').textContent = String(Index.size());
      const list = panel.querySelector('#ob-list');
      list.innerHTML = '';
      const ps = Store.persons();
      for (const id in ps) {
        const p = ps[id];
        const row = document.createElement('div');
        row.className = 'ob-item';
        row.innerHTML = `<div><div>${p.label || '未命名'}</div><div class="ob-meta">${(p.identities || []).join('  ')}</div></div>`;
        const del = document.createElement('button');
        del.className = 'ob-del'; del.textContent = '删除';
        del.onclick = () => { Store.removePerson(id); refresh(); if (currentScanner) currentScanner.schedule(); };
        row.appendChild(del);
        list.appendChild(row);
      }
      const s = Store.settings();
      panel.querySelector('#ob-enabled').checked = s.enabled;
      panel.querySelector('#ob-hover').checked = s.showHoverButton;
      panel.querySelector('#ob-skip').checked = s.douyinAutoSkip;
      const mode = panel.querySelector(`input[name="ob-mode"][value="${s.hideMode}"]`);
      if (mode) mode.checked = true;
    }
    refresh();

    panel.querySelector('#ob-add').onclick = () => {
      const plat = panel.querySelector('#ob-plat').value;
      const val = normId(panel.querySelector('#ob-val').value);
      const label = panel.querySelector('#ob-label').value.trim();
      if (!val) return;
      const keyMap = { bili: 'bili:uid:', weibo: 'weibo:uid:', zhihu: 'zhihu:token:', tieba: 'tieba:uid:', x: 'x:handle:', douyin: 'douyin:secuid:' };
      Store.addIdentities([keyMap[plat] + val], label || val);
      panel.querySelector('#ob-val').value = '';
      refresh(); if (currentScanner) currentScanner.schedule();
    };
    panel.querySelectorAll('input[name="ob-mode"]').forEach((r) => r.onchange = () => { if (r.checked) { Store.setSetting('hideMode', r.value); if (currentScanner) currentScanner.schedule(); } });
    panel.querySelector('#ob-enabled').onchange = (e) => { Store.setSetting('enabled', e.target.checked); if (currentScanner) currentScanner.schedule(); };
    panel.querySelector('#ob-hover').onchange = (e) => Store.setSetting('showHoverButton', e.target.checked);
    panel.querySelector('#ob-skip').onchange = (e) => Store.setSetting('douyinAutoSkip', e.target.checked);
    panel.querySelector('#ob-export').onclick = () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'omniblock-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const file = panel.querySelector('#ob-file');
    panel.querySelector('#ob-import').onclick = () => file.click();
    file.onchange = () => {
      const f = file.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { try { Store.importJSON(String(reader.result)); refresh(); if (currentScanner) currentScanner.schedule(); } catch (e) { alert('导入失败：' + e.message); } };
      reader.readAsText(f);
    };
  }

  // ====================================================================
  // 8. 启动
  // ====================================================================
  let currentAdapter = null;
  for (const id in Adapters) {
    if (Adapters[id].match && Adapters[id].match(location)) { currentAdapter = Adapters[id]; break; }
  }

  try { GM_registerMenuCommand('OmniBlock 设置', openOptions, 'o'); } catch (e) {}

  if (currentAdapter) {
    setupBilibiliDanmaku();
    currentScanner = createScanner(currentAdapter);
    // 首屏延迟补扫（应对 SPA 晚加载）
    setTimeout(() => currentScanner && currentScanner.schedule(), 800);
    setTimeout(() => currentScanner && currentScanner.schedule(), 2500);
    setTimeout(() => currentScanner && currentScanner.schedule(), 6000);
  }

  // 暴露调试接口
  window.OB = { Store, Index, openOptions, adapters: Adapters };
})();

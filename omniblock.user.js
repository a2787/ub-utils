// ==UserScript==
// @name          本地内容过滤增强
// @namespace     https://github.com/a2787/ub-utils
// @version       0.10.0
// @description   一个浏览器本地内容过滤用户脚本，可按用户隐藏其内容。纯本地、不联网、无数量上限。
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
// @grant         GM_xmlhttpRequest
// @grant         GM_openInTab
// @run-at        document-start
// @sandbox       raw
// @updateURL     https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js
// @downloadURL   https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js
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
 *  - B站弹幕：MAIN world 拦截 seg.so（当前播放器走 XHR，保留 fetch 兼容），手写轻量 varint 解析 + CRC32 正向映射过滤（无需彩虹表）。
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

  // 更新地址（与脚本头 @updateURL/@downloadURL 保持一致；用户脚本运行时无法自读元数据，故显式声明）
  const UPDATE_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';
  const DOWNLOAD_URL = UPDATE_URL;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const textOf = (el) => (el ? (el.textContent || '').trim() : '');
  const attr = (el, a) => (el ? el.getAttribute(a) : null);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 穿透所有 open Shadow DOM 查找（B站评论/动态在影子 DOM 内，表层 query 拿不到）
  function deepQuery(root, sel) {
    return querySelectorAllDeep(root, sel)[0] || null;
  }
  // 递归遍历 root 及其所有 open shadowRoot，收集所有匹配 sel 的元素（全局影子穿透）。
  // 逐节点匹配可避免每一层反复 querySelectorAll 全部后代，B站评论较多时尤其重要。
  function querySelectorAllDeep(root, sel) {
    const out = [];
    if (!root) return out;
    const seen = new Set();
    const collect = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (node.nodeType === 1 && node.matches) {
        try { if (node.matches(sel)) out.push(node); } catch (e) { return; }
        if (node.shadowRoot) collect(node.shadowRoot);
      }
      for (const c of node.children || []) collect(c);
    };
    collect(root);
    return out;
  }
  // 沿 composedPath（含影子宿主）找到第一个匹配适配器的条目
  function findItem(target, adapter) {
    const path = (target && target.composedPath) ? target.composedPath() : [target];
    for (const n of path) {
      if (!n || n.nodeType !== 1 || !n.matches) continue;
      for (const sel of adapter.selectors) {
        if (n.matches(sel)) {
          const info = adapter.extract(n);
          if (info && info.keys && info.keys.length) return { el: n, info };
        }
      }
    }
    return null;
  }

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
    showQuickBlock: true,        // 在平台原生"拉黑/举报"旁插入"本地拉黑"
    showBulkBlock: true,         // 本页/弹窗内"一键拉黑全部用户"
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

    /* 锚定式快速拉黑按钮（插在平台原生菜单项旁） */
    .ob-quick {
      display: block !important; width: 100% !important; box-sizing: border-box !important;
      text-align: left !important; border: 0 !important; background: transparent !important;
      padding: 7px 10px !important; border-radius: 5px !important; cursor: pointer !important;
      color: #c0392b !important; font: inherit !important; font-size: 13px !important;
      list-style: none !important; white-space: nowrap !important;
    }
    .ob-quick:hover { background: #fdeceb !important; }
    /* 一键拉黑本页 / 弹窗内全部用户 */
    .ob-bulk {
      display: inline-flex !important; align-items: center; gap: 4px; cursor: pointer !important;
      font-size: 12px !important; color: #fff !important; background: #c0392b !important;
      border: 0 !important; border-radius: 6px !important; padding: 4px 10px !important; margin: 4px !important;
      z-index: 2147483646 !important;
    }
    .ob-bulk:hover { background: #a93226 !important; }
    /* B站右侧弹幕列表里的本地发送者屏蔽入口 */
    .ob-dm-block {
      flex: 0 0 auto !important; margin-left: 8px !important; padding: 2px 6px !important;
      border: 1px solid #e89a91 !important; border-radius: 4px !important; background: #fff !important;
      color: #c0392b !important; font-size: 11px !important; line-height: 18px !important; cursor: pointer !important;
    }
    .ob-dm-block:hover { background: #fdeceb !important; }
    [data-ob-dm-blocked="1"] { display: none !important; }

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
          for (const item of querySelectorAllDeep(document, sel)) {
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

  function showConfirm(label, keys, anchorEl, onBlocked) {
    let box = $('#ob-confirm');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ob-confirm';
    box.innerHTML = `<div class="ob-title">确认拉黑？</div><div class="ob-sub"></div><div class="ob-row"><button class="ob-no">取消</button><button class="ob-ok">拉黑</button></div>`;
    const sub = (label || '该用户') + (keys.length ? '\n' + (keys.length > 5 ? keys.slice(0, 5).join('  ') + ' …(共' + keys.length + '项)' : keys.join('  ')) : '');
    box.querySelector('.ob-sub').textContent = sub;
    box.querySelector('.ob-no').onclick = () => box.remove();
    let rect = { left: window.innerWidth / 2 - 130, top: window.innerHeight / 2 - 60 };
    if (anchorEl && anchorEl.getBoundingClientRect) { const r = anchorEl.getBoundingClientRect(); rect = { left: clamp(r.left, 8, window.innerWidth - 280), top: clamp(r.bottom + 6, 8, window.innerHeight - 160) }; }
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    document.body.appendChild(box);
    box.querySelector('.ob-ok').onclick = () => {
      const res = Store.addIdentities(keys, label);
      box.remove();
      try { if (onBlocked) onBlocked(res); } catch (e) {}
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

  // 悬浮拉黑按钮（浮层定位，穿透 Shadow DOM 也能显示；原元素内塞不进影子树）
  let hoverOwner = null;
  function clearHover() {
    if (hoverOwner) { hoverOwner.__obHover = false; hoverOwner.__obHoverBtn = null; hoverOwner = null; }
    const old = document.querySelector('.ob-block-btn');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function attachHoverButton(adapter, container, info) {
    if (container.__obHover) return;
    container.__obHover = true;
    hoverOwner = container;
    const btn = document.createElement('div');
    btn.className = 'ob-block-btn';
    btn.textContent = '🚫 拉黑';
    btn.style.position = 'fixed';
    btn.style.zIndex = '2147483646';
    const r = (container.getBoundingClientRect ? container.getBoundingClientRect() : { top: 8, right: window.innerWidth - 60 });
    btn.style.left = Math.max(4, (r.right || window.innerWidth) - 58) + 'px';
    btn.style.top = Math.max(4, r.top + 4) + 'px';
    btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); showConfirm(info.label, info.keys, btn); };
    document.body.appendChild(btn);
    container.__obHoverBtn = btn;
    btn.addEventListener('mouseleave', clearHover);
  }
  window.addEventListener('scroll', clearHover, true);

  let currentScanner = null;

  // 右键：若光标在某条目上，弹出自建菜单（不触发平台原生"不感兴趣"）
  document.addEventListener('contextmenu', (e) => {
    if (!Store.getSetting('enabled')) return;
    const adapter = currentAdapter;
    if (!adapter || !adapter.selectors) return;
    // 沿 composedPath 穿透 Shadow DOM 找到命中条目
    const found = findItem(e.target, adapter);
    if (!found) return;
    e.preventDefault();   // 仅当命中条目时接管右键
    buildContextMenu(e.clientX, e.clientY, found.info, () => showConfirm(found.info.label, found.info.keys, found.el));
  }, true);

  // 悬浮按钮：mouseover 时为其挂拉黑按钮（沿 composedPath 穿透 Shadow DOM）
  document.addEventListener('mouseover', (e) => {
    if (!Store.getSetting('showHoverButton') || !Store.getSetting('enabled')) return;
    const adapter = currentAdapter;
    if (!adapter || !adapter.selectors) return;
    const found = (e.target && e.target.composedPath) ? findItem(e.target, adapter) : null;
    if (!found || !found.info.keys.length || Index.isBlocked(found.info.keys)) { if (hoverOwner) clearHover(); return; }
    if (hoverOwner === found.el) return;
    clearHover();
    attachHoverButton(adapter, found.el, found.info);
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
      card: '[action-type="feed_list_item"], .WB_feed_type, article[class*="vue-card"], article.woo-panel-main, .card-feed',
      userLink: 'a[href*="/u/"], a[href*="/n/"], a[nick-name], [data-user-card], [data-usercard], [usercard], [data-uid], [uid]',
    };
    function uidFromLink(link) {
      if (!link) return '';
      const href = attr(link, 'href') || '';
      const m = href.match(/\/u\/(\d+)/) || href.match(/\/(\d{6,})/);
      if (m) return normId(m[1]);
      // 微博虚拟列表会把 uid 放在 usercard="id=..." / data-user-card 等属性里，
      // 不能只依赖可变的主页 URL。
      const values = [
        attr(link, 'data-user-card'), attr(link, 'data-usercard'), attr(link, 'usercard'),
        attr(link, 'data-uid'), attr(link, 'uid'),
      ];
      for (const value of values) {
        const raw = normId(value);
        const direct = raw.match(/^\d{5,}$/);
        if (direct) return direct[0];
        const inCard = raw.match(/(?:^|[?&;,\s])(?:id|uid)=(\d{5,})(?:$|[?&;,\s])/i);
        if (inCard) return normId(inCard[1]);
      }
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
    function findUserLink(item) {
      const links = $$(SEL.userLink, item);
      return links.find((link) => uidFromLink(link) && (textOf(link) || attr(link, 'nick-name')))
        || links.find((link) => uidFromLink(link)) || null;
    }
    return {
      id: 'weibo',
      match: (h) => /(^|\.)weibo\.com$/.test(h.hostname) || /(^|\.)weibo\.cn$/.test(h.hostname),
      selectors: [SEL.card],
      extract(item) {
        const link = findUserLink(item);
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
      comment: 'bili-comment-renderer, bili-sub-comment-renderer, .comment-item, .reply-item, [data-comment-id]',
      dyn: '.bili-dyn-item, .bili-dynamic-card, [data-dyn-id]',
      videoCard: '.bili-video-card, .video-card, a[href*="//www.bilibili.com/video/"]',
      space: '.space-item, .list-item',
    };

    function dataIdentity(d) {
      if (!d || typeof d !== 'object') return { mid: '', name: '' };
      const candidates = [
        d, d.user, d.member, d.author, d.owner,
        d.reply, d.reply && d.reply.member, d.reply && d.reply.user,
        d.root, d.root && d.root.member, d.data, d.data && d.data.member,
      ].filter(Boolean);
      let mid = '', name = '';
      for (const item of candidates) {
        if (!mid) mid = normId(item.mid || item.uid || item.user_id);
        if (!name) name = normId(item.uname || item.name || item.nickname);
        if (mid && name) break;
      }
      return { mid, name };
    }

    function midFromEl(el) {
      // lit 组件常把数据挂到 __data.mid / __data.uid
      const fromData = dataIdentity(el && el.__data);
      if (fromData.mid) return fromData.mid;
      const ownMid = attr(el, 'data-up-mid') || attr(el, 'data-mid') || attr(el, 'data-uid');
      if (ownMid) return normId(ownMid);
      // 穿透 Shadow DOM：B站评论/动态在影子树内，表层 query 拿不到。
      const link = deepQuery(el, 'a[href*="space.bilibili.com/"]');
      if (link) {
        const m = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/);
        if (m) return normId(m[1]);
      }
      const up = deepQuery(el, '[data-up-mid], [data-mid], [data-uid]');
      if (up) return normId(attr(up, 'data-up-mid') || attr(up, 'data-mid') || attr(up, 'data-uid'));
      return '';
    }

    function extract(el) {
      const fromData = dataIdentity(el && el.__data);
      const mid = fromData.mid || midFromEl(el);
      const name = fromData.name || textOf(deepQuery(el, '.user-name, .uname, [data-name], a[href*="space.bilibili.com/"]'));
      const keys = [];
      if (mid) keys.push('bili:uid:' + mid);
      return { keys, label: name, container: el };
    }

    function userFromSpaceLink(link) {
      const m = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/);
      if (!m) return null;
      return { keys: ['bili:uid:' + normId(m[1])], label: textOf(link), container: link };
    }

    function collectCommentUsers(root) {
      return querySelectorAllDeep(root, SEL.comment).map(extract);
    }

    function collectModalUsers(root) {
      // B站视频页的举报弹窗并不含发送者；只有实际列出空间链接的用户列表才可批量处理。
      return querySelectorAllDeep(root, 'a[href*="space.bilibili.com/"]').map(userFromSpaceLink).filter(Boolean);
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
      extract,
      // 统计“本页用户”时只计算评论作者，绝不把推荐视频卡/列表项当成人。
      collectUsers(root, purpose) {
        return purpose === 'modal' ? collectModalUsers(root) : collectCommentUsers(root);
      },
      canBulkModal(modal) {
        return collectModalUsers(modal).length >= 2;
      },
      bulkFabLabel: (n) => '🚫 拉黑本页评论用户(' + n + ')',
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
  // 5.5 锚定式快速拉黑 + 一键拉黑全部（贴着平台原生拉黑/举报入口）
  // --------------------------------------------------------------------
  // 思路：用 MutationObserver 盯住平台原生菜单里的"拉黑/举报"等项，紧挨着
  // 插入"🚫 本地拉黑"；点击时从上下文自动识别当前用户并走现有拉黑流程。
  // 各平台 DOM 类名常变，故用"文本 + 菜单项形态"判定，比写死 class 更鲁棒。
  // 一键拉黑全部：复用适配器扫描本页/弹窗内全部可见用户并去重后批量入库。
  // ====================================================================
  function isMenuItem(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches('a,button,[role="menuitem"],[role="button"]')) return true;
    // B站评论菜单目前有两种版本：operation-list/operation-option，或
    // bili-comment-menu 的 Shadow DOM 内 #options > li。
    if (el.matches && el.matches('li.operation-option,.operation-option')) return true;
    if (el.tagName === 'LI' && el.parentElement && el.parentElement.matches('.operation-list,[role="menu"]')) return true;
    if (el.tagName === 'LI' && el.parentElement && el.parentElement.matches('#options')) {
      const root = el.getRootNode && el.getRootNode();
      if (root && root.host && root.host.tagName === 'BILI-COMMENT-MENU') return true;
    }
    if (el.closest && el.closest('.menu,[role="menu"],.dropdown,.popup,.context-menu,.bili-popover,.modal,[role="dialog"],.dialog,.Dialog')) return true;
    return false;
  }

  // 从锚点上下文识别用户身份：优先 URL（空间页）；其次沿 composedPath 找适配器命中条目
  // 沿祖先链向上（遇 Shadow DOM 用 .host 跨出），比 composedPath 更稳（影子内按钮的 composedPath 在某些环境缺失）
  // uid 型身份前缀：与 keyMap / 各适配器 extract 保持一致（data-mid/data-uid 必为数字 uid）。
  // 注意 bilibili 适配器 extract 用的是 'bili:uid:' 而非 'bilibili:uid:'，故此处以规范前缀为准，避免产生孤儿 key。
  const UID_PREFIX = { bilibili: 'bili:uid:', weibo: 'weibo:uid:', zhihu: 'zhihu:uid:', tieba: 'tieba:uid:', x: 'x:uid:', douyin: 'douyin:uid:' };

  function ancestorChain(elm) {
    const out = [];
    let n = elm;
    while (n) {
      out.push(n);
      if (n.parentNode) n = n.parentNode;
      else if (n.host) n = n.host;
      else break;
    }
    return out;
  }

  function identifyFromAnchor(anchor) {
    const a = currentAdapter; if (!a) return null;
    if (a.id === 'bilibili') {
      const m = location.href.match(/space\.bilibili\.com\/(\d+)/);
      if (m) return { keys: ['bili:uid:' + m[1]], label: '' };
    }
    const chain = ancestorChain(anchor);
    // 1) 链路里直接带 mid/uid（弹幕等）
    for (const n of chain) {
      const mid = (n.getAttribute && (n.getAttribute('data-mid') || n.getAttribute('data-uid'))) || '';
      if (mid) return { keys: [(UID_PREFIX[a.id] || a.id + ':uid:') + normId(mid)], label: '' };
    }
    // 2) 链路命中适配器条目 → 复用 extract
    for (const n of chain) {
      if (!n || n.nodeType !== 1 || !n.matches) continue;
      for (const sel of (a.selectors || [])) {
        if (n.matches(sel)) { const info = a.extract(n); if (info && info.keys && info.keys.length) return info; }
      }
    }
    // 3) 退化：链路节点里找用户主页链接取身份（deepQuery 可穿透一层影子）
    for (const n of chain) {
      if (!n || n.nodeType !== 1) continue;
      // body/document 的后代是整页，扫到这里会把举报弹窗误关联为第一条评论。
      if (n === document.body || n === document.documentElement) continue;
      const link = deepQuery(n, 'a[href*="space.bilibili.com/"]');
      if (link) { const mm = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/); if (mm) return { keys: ['bili:uid:' + normId(mm[1])], label: textOf(link) }; }
    }
    return null;
  }

  function makeQuickBtn(label, anchorEl, cfg, key, initialInfo) {
    const listItem = anchorEl && anchorEl.tagName === 'LI';
    // 保持 B站 <ul> 的合法子节点与原生菜单的布局规则。
    const btn = document.createElement(listItem ? 'li' : 'button');
    btn.className = 'ob-quick' + (listItem ? ' operation-option' : '');
    if (listItem) { btn.setAttribute('role', 'menuitem'); btn.tabIndex = 0; }
    else btn.type = 'button';
    btn.setAttribute('data-key', key);
    btn.textContent = '🚫 ' + label;
    const activate = (e) => {
      e.stopPropagation(); e.preventDefault();
      const info = initialInfo || (cfg.identify ? cfg.identify(anchorEl) : identifyFromAnchor(anchorEl));
      if (!info || !info.keys || !info.keys.length) { showToast('⚠️ 无法识别该用户，可试悬浮按钮或右键'); return; }
      showConfirm(info.label || '该用户', info.keys, anchorEl);
    };
    btn.addEventListener('click', activate);
    if (listItem) btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); });
    return btn;
  }

  // 各平台"原生锚点文本"：评论/用户页用拉黑类，弹幕/举报页用举报类
  const QB = {
    bilibili: { label: '本地拉黑', anchorTexts: ['加入黑名单', '拉黑', '举报'] },
    weibo:    { label: '本地拉黑', anchorTexts: ['拉黑', '举报'] },
    zhihu:    { label: '本地拉黑', anchorTexts: ['拉黑', '举报'] },
    tieba:    { label: '本地拉黑', anchorTexts: ['拉黑', '举报'] },
    x:        { label: '本地拉黑', anchorTexts: ['Block', '封鎖', 'Report', '举报'] },
    douyin:   { label: '本地拉黑', anchorTexts: ['拉黑', '举报'] },
  };

  const QB_CANDIDATE = 'a,button,[role="menuitem"],[role="button"],li,.operation-option';
  function setupQuickBlock() {
    const a = currentAdapter; if (!a) return;
    if (!Store.getSetting('showQuickBlock')) return;
    const cfg = QB[a.id]; if (!cfg) return;
    function tryInject(el) {
      if (!el || el.nodeType !== 1 || (el.classList && el.classList.contains('ob-quick'))) return;
      // Lit/Vue 菜单重绘可能删掉我们的兄弟节点但保留原生 li；此时允许下一轮补回。
      if (el.hasAttribute('data-ob-qb')) {
        if (el.parentNode && el.parentNode.querySelector(':scope > .ob-quick')) return;
        el.removeAttribute('data-ob-qb');
      }
      if (!Store.getSetting('showQuickBlock')) return;
      const t = textOf(el);
      if (!t) return;
      for (const txt of cfg.anchorTexts) {
        if (t.indexOf(txt) !== -1 && isMenuItem(el)) {
          // 不向稿件举报等没有发送者上下文的菜单注入无效按钮。
          const info = cfg.identify ? cfg.identify(el) : identifyFromAnchor(el);
          if (!info || !info.keys || !info.keys.length) return;
          // 该菜单已有快速按钮则跳过（避免评论菜单里"加入黑名单"和"举报"各插一个）
          if (el.parentNode && el.parentNode.querySelector(':scope > .ob-quick')) return;
          const btn = makeQuickBtn(cfg.label || '本地拉黑', el, cfg, txt, info);
          el.parentNode.insertBefore(btn, el.nextSibling);
          el.setAttribute('data-ob-qb', '1');
          return;
        }
      }
    }
    function scanAll() {
      if (!Store.getSetting('showQuickBlock')) return;
      for (const el of querySelectorAllDeep(document, QB_CANDIDATE)) tryInject(el);
    }
    // 周期扫描：B站菜单在 Shadow DOM 内，MutationObserver 跨不过影子边界，故用定时器 + 全局穿透扫描
    setInterval(scanAll, 900);
    scanAll();
    (window.OB = window.OB || {}).setupQuickBlock = scanAll;
  }

  // ---- 一键拉黑本页 / 弹窗内全部可见用户 ----
  function uniqueUsers(items) {
    const out = []; const seen = new Set();
    for (const info of items || []) {
      if (info && info.keys && info.keys.length) {
        const k = info.keys.join('|');
        if (!seen.has(k)) { seen.add(k); out.push(info); }
      }
    }
    return out;
  }

  function collectUsers(root, purpose) {
    const a = currentAdapter; if (!a || !a.selectors) return [];
    const scope = root || document;
    if (typeof a.collectUsers === 'function') return uniqueUsers(a.collectUsers(scope, purpose || 'page'));
    const selectors = (purpose === 'modal' && a.modalSelectors) || a.bulkSelectors || a.selectors;
    const items = [];
    for (const sel of selectors) {
      for (const item of querySelectorAllDeep(scope, sel)) items.push(a.extract(item));
    }
    return uniqueUsers(items);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || attr(el, 'aria-hidden') === 'true') return false;
    if (el.tagName === 'DIALOG' && !el.open) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    return !el.getClientRects || el.getClientRects().length > 0;
  }

  function blockMany(list, anchorEl) {
    if (!list.length) { showToast('没有可拉黑的用户'); return; }
    const keys = [];
    list.forEach((i) => i.keys.forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
    showConfirm('拉黑全部 ' + list.length + ' 位用户', keys, anchorEl);
  }

  function setupBulkBlock() {
    const a = currentAdapter; if (!a) return;
    if (!Store.getSetting('showBulkBlock')) return;
    let fab = null;
    const MODAL_SEL = '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal';
    const setFabVisible = (visible) => {
      if (fab) fab.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
    };
    function hasOpenModal() {
      return querySelectorAllDeep(document, MODAL_SEL).some(isVisible);
    }
    function refreshFab() {
      if (!Store.getSetting('showBulkBlock')) { setFabVisible(false); return; }
      const n = collectUsers(document).length;
      // 页面批量按钮不应遮住举报/登录等原生弹窗，更不能显示无意义的“(0)”。
      if (!n || hasOpenModal()) { setFabVisible(false); return; }
      if (!fab) {
        fab = document.createElement('div');
        fab.className = 'ob-bulk';
        fab.style.position = 'fixed'; fab.style.left = '14px'; fab.style.bottom = '14px';
        fab.onclick = () => { const list = collectUsers(document); if (!list.length) { showToast('本页没有可拉黑的用户'); return; } blockMany(list, fab); };
        const mountFab = () => { if (document.body) document.body.appendChild(fab); else setTimeout(mountFab, 300); };
        mountFab();
      }
      fab.textContent = a.bulkFabLabel ? a.bulkFabLabel(n) : '🚫 拉黑本页用户(' + n + ')';
      setFabVisible(true);
    }
    function tryModal(modal) {
      if (!Store.getSetting('showBulkBlock')) return;
      if (modal.hasAttribute('data-ob-bulk')) return;
      if (a.canBulkModal && !a.canBulkModal(modal)) return;
      const users = collectUsers(modal, 'modal');
      if (users.length < 2) return;   // 至少 2 个才视为"列表"
      modal.setAttribute('data-ob-bulk', '1');
      const btn = document.createElement('div');
      btn.className = 'ob-bulk';
      btn.textContent = '🚫 拉黑全部(' + users.length + ')';
      btn.onclick = () => blockMany(collectUsers(modal, 'modal'), btn);
      const header = modal.querySelector('header,.modal-header,.dialog-header,.head,.title') || modal.firstElementChild;
      if (header && header.parentNode) header.parentNode.insertBefore(btn, header);
      else modal.insertBefore(btn, modal.firstChild);
    }
    function scanModals() {
      if (!Store.getSetting('showBulkBlock')) return;
      for (const md of querySelectorAllDeep(document, MODAL_SEL)) tryModal(md);
    }
    // 周期扫描（弹窗可能在 Shadow DOM 内，定时器 + 影子穿透更稳）
    setInterval(() => { refreshFab(); scanModals(); }, 1200);
    refreshFab(); scanModals();
    (window.OB = window.OB || {}).refreshBulk = refreshFab;
    (window.OB = window.OB || {}).collectUsers = collectUsers;
  }

  // ====================================================================
  // 6. B站弹幕过滤（MAIN world 拦截 seg.so + CRC32 正向映射）
  // ====================================================================
  function setupBilibiliDanmaku() {
    if (!/(^|\.)bilibili\.com$/.test(location.hostname)) return;
    if (typeof window.fetch !== 'function' && typeof XMLHttpRequest === 'undefined') return;

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

    function normalHash(value) {
      const hash = String(value == null ? '' : value).trim().replace(/^0x/i, '').toLowerCase();
      return /^[0-9a-f]{1,8}$/.test(hash) ? hash.padStart(8, '0') : '';
    }

    function blockedHashes() {
      const set = new Set();
      // 评论 UID 和弹幕 mid_hash 是两种可独立保存的身份。CRC 结果必须补齐 8 位。
      const all = Store.allIdentities();
      for (const key of all) {
        const m = key.match(/^bili:uid:(\d+)$/);
        if (m) set.add(crc32(m[1]).toString(16).padStart(8, '0'));
        const hash = key.match(/^bili:dmhash:([0-9a-f]{1,8})$/i);
        if (hash) set.add(normalHash(hash[1]));
      }
      return set;
    }

    // 轻量 protobuf 解析：top-level repeated 消息 field1=elems；每个 elem 内
    // field2=progress, field6=midHash, field7=content。保留原字节，避免重编码。
    function readVarint(buf, pos) {
      let result = 0, shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        if (shift < 32) result += (b & 0x7F) * Math.pow(2, shift);
        if (!(b & 0x80)) return { value: result >>> 0, next: pos, ok: true };
        shift += 7;
      }
      return { value: result >>> 0, next: pos, ok: false };
    }

    function skipField(buf, pos, wireType, end) {
      if (wireType === 0) return readVarint(buf, pos).next;
      if (wireType === 1) return pos + 8;
      if (wireType === 5) return pos + 4;
      if (wireType === 2) {
        const len = readVarint(buf, pos);
        return len.ok ? len.next + len.value : end + 1;
      }
      return end + 1;
    }

    const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
    function bytesToText(buf, start, length) {
      const part = buf.subarray(start, start + length);
      if (decoder) return decoder.decode(part);
      let s = ''; for (let i = 0; i < part.length; i++) s += String.fromCharCode(part[i]);
      try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    function parseDanmakuElem(buf, start, end) {
      const elem = { hash: '', content: '', progress: -1 };
      let p = start;
      while (p < end) {
        const tag = readVarint(buf, p); if (!tag.ok) return elem; p = tag.next;
        const field = tag.value >> 3, wt = tag.value & 7;
        if (wt === 0) {
          const value = readVarint(buf, p); if (!value.ok) return elem;
          if (field === 2) elem.progress = value.value;
          p = value.next;
          continue;
        }
        if (wt === 2) {
          const len = readVarint(buf, p); if (!len.ok || len.next + len.value > end) return elem;
          if (field === 6) elem.hash = normalHash(bytesToText(buf, len.next, len.value));
          else if (field === 7) elem.content = bytesToText(buf, len.next, len.value);
          p = len.next + len.value;
          continue;
        }
        p = skipField(buf, p, wt, end);
        if (p > end) return elem;
      }
      return elem;
    }

    const dmByContent = new Map();
    const dmByProgress = new Map();
    function cleanDmText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function rememberDanmaku(elem) {
      if (!elem || !elem.hash || !elem.content) return;
      const content = cleanDmText(elem.content);
      if (!content) return;
      const hashes = dmByContent.get(content) || new Set();
      hashes.add(elem.hash); dmByContent.set(content, hashes);
      if (elem.progress >= 0) {
        const key = String(elem.progress) + '\x1f' + content;
        const progressHashes = dmByProgress.get(key) || new Set();
        progressHashes.add(elem.hash); dmByProgress.set(key, progressHashes);
      }
      // 长视频连续播放时限制会话内索引大小，当前视频的侧栏仍会保留。
      if (dmByContent.size > 5000) { dmByContent.clear(); dmByProgress.clear(); }
    }

    function copyRange(out, buf, start, end) {
      for (let i = start; i < end; i++) out.push(buf[i]);
    }
    function filterSeg(bytes) {
      const buf = new Uint8Array(bytes);
      const blocked = blockedHashes();
      const out = [];
      let changed = false;
      let p = 0;
      while (p < buf.length) {
        const start = p;
        const tag = readVarint(buf, p); if (!tag.ok) return buf;
        const field = tag.value >> 3, wt = tag.value & 7;
        if (field === 1 && wt === 2) {
          const lenInfo = readVarint(buf, tag.next);
          if (!lenInfo.ok) return buf;
          const elemStart = lenInfo.next, elemEnd = lenInfo.next + lenInfo.value;
          if (elemEnd > buf.length) return buf;
          const elem = parseDanmakuElem(buf, elemStart, elemEnd);
          rememberDanmaku(elem);
          if (elem.hash && blocked.has(elem.hash)) { changed = true; p = elemEnd; continue; }
          copyRange(out, buf, start, elemEnd);
          p = elemEnd;
          continue;
        }
        const next = skipField(buf, tag.next, wt, buf.length);
        if (next > buf.length) return buf;
        copyRange(out, buf, start, next);
        p = next;
      }
      scanDmPanels();
      return changed ? new Uint8Array(out) : buf;
    }

    function hashFromData(data) {
      if (!data || typeof data !== 'object') return '';
      const candidates = [data, data.dm, data.item, data.data, data.props, data.props && data.props.item].filter(Boolean);
      for (const item of candidates) {
        const hash = normalHash(item.midHash || item.mid_hash || item.dmHash || item.dm_hash || item.hash);
        if (hash) return hash;
      }
      return '';
    }

    function timeInMs(text) {
      const match = cleanDmText(text).match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
      if (!match) return -1;
      return (Number(match[1]) * 60 + Number(match[2])) * 1000;
    }

    function hashFromDmRow(row) {
      const direct = normalHash(attr(row, 'data-mid-hash') || attr(row, 'data-mid_hash') || attr(row, 'data-dm-hash') || attr(row, 'data-danmaku-hash'));
      if (direct) return direct;
      const fromData = hashFromData(row.__data) || hashFromData(row.__vueParentComponent && row.__vueParentComponent.props) || hashFromData(row._vnode && row._vnode.props);
      if (fromData) return fromData;
      const rowText = cleanDmText(textOf(row));
      if (!rowText) return '';
      const rawProgress = attr(row, 'data-progress') || attr(row, 'data-time') || attr(row, 'data-dm-progress');
      const progress = rawProgress == null || rawProgress === '' ? NaN : Number(rawProgress);
      const at = Number.isFinite(progress) && progress >= 0 ? progress : timeInMs(rowText);
      const candidates = new Set();
      for (const [content, hashes] of dmByContent) {
        if (!rowText.includes(content)) continue;
        if (at >= 0) {
          const exact = dmByProgress.get(String(at) + '\x1f' + content);
          if (exact) for (const hash of exact) candidates.add(hash);
          // 列表有时只显示到秒，允许 1 秒的时间差。
          for (const [key, timedHashes] of dmByProgress) {
            const divider = key.indexOf('\x1f');
            if (divider < 0 || key.slice(divider + 1) !== content) continue;
            if (Math.abs(Number(key.slice(0, divider)) - at) <= 1000) for (const hash of timedHashes) candidates.add(hash);
          }
        } else for (const hash of hashes) candidates.add(hash);
      }
      return candidates.size === 1 ? Array.from(candidates)[0] : '';
    }

    const DM_PANEL_SEL = '.bpx-player-dm-container,.bpx-player-dm-list,.bpx-player-dm-list-container,.bpx-player-dm-list-view';
    const DM_ROW_SEL = 'li,[data-mid-hash],[data-mid_hash],[data-dm-hash],[data-danmaku-hash],[class*="dm-item"],[class*="danmaku-item"]';
    function markDmRows(hash) {
      for (const panel of querySelectorAllDeep(document, DM_PANEL_SEL)) {
        for (const row of querySelectorAllDeep(panel, DM_ROW_SEL)) {
          if (hashFromDmRow(row) === hash) row.setAttribute('data-ob-dm-blocked', '1');
        }
      }
    }

    function addDmBlockButton(row, hash) {
      if (row.querySelector && row.querySelector(':scope > .ob-dm-block')) return;
      const btn = document.createElement('button');
      btn.className = 'ob-dm-block'; btn.type = 'button'; btn.textContent = '本地拉黑';
      btn.title = '按该弹幕的 mid_hash 本地屏蔽发送者';
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        showConfirm('该弹幕发送者', ['bili:dmhash:' + hash], btn, () => markDmRows(hash));
      });
      row.appendChild(btn);
    }

    function scanDmPanels() {
      if (!Store.getSetting('enabled')) return;
      for (const panel of querySelectorAllDeep(document, DM_PANEL_SEL)) {
        for (const row of querySelectorAllDeep(panel, DM_ROW_SEL)) {
          if (row.hasAttribute('data-ob-dm-blocked') || (row.classList && row.classList.contains('ob-dm-block'))) continue;
          const hash = hashFromDmRow(row);
          if (!hash) continue; // 没有可验证的 mid_hash 时不显示一个必然失败的按钮。
          if (blockedHashes().has(hash)) { row.setAttribute('data-ob-dm-blocked', '1'); continue; }
          addDmBlockButton(row, hash);
        }
      }
    }

    // view 是元数据 protobuf，不能按弹幕 Elem 过滤；只处理实际段/列表响应。
    const isDanmakuUrl = (url) => /\/dm\/(?:wbi\/)?web\/seg\.so(?:[/?]|$)|\/dm\/list\.so(?:[/?]|$)/.test(String(url || ''));
    const asArrayBuffer = (bytes) => {
      if (bytes instanceof ArrayBuffer) return bytes;
      if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return bytes;
    };

    // 当前 B站播放器以 XMLHttpRequest + responseType=arraybuffer 请求 seg.so。
    // 覆盖实例 response 的 getter，播放器自己的 onload 回调第一次读取时就拿到过滤后的字节。
    if (typeof XMLHttpRequest !== 'undefined') {
      const nativeXhrOpen = XMLHttpRequest.prototype.open;
      const nativeXhrSend = XMLHttpRequest.prototype.send;
      const responseDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
      function installXhrFilter(xhr) {
        if (xhr.__obDanmakuResponseInstalled || !responseDescriptor || !responseDescriptor.get) return;
        xhr.__obDanmakuResponseInstalled = true;
        let lastRaw = null, lastFiltered = null;
        try {
          Object.defineProperty(xhr, 'response', {
            configurable: true,
            get() {
              const raw = responseDescriptor.get.call(xhr);
              if (!isDanmakuUrl(xhr.__obDanmakuUrl) || !Store.getSetting('enabled') || xhr.readyState !== 4 || !(raw instanceof ArrayBuffer)) return raw;
              if (raw === lastRaw) return lastFiltered;
              try {
                lastRaw = raw;
                lastFiltered = asArrayBuffer(filterSeg(raw));
                return lastFiltered;
              } catch (e) {
                return raw;
              }
            },
          });
        } catch (e) {
          xhr.__obDanmakuResponseInstalled = false;
        }
      }
      XMLHttpRequest.prototype.open = function (method, url, ...args) {
        this.__obDanmakuUrl = String(url || '');
        return nativeXhrOpen.call(this, method, url, ...args);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        if (isDanmakuUrl(this.__obDanmakuUrl)) installXhrFilter(this);
        return nativeXhrSend.call(this, ...args);
      };
    }

    // fetch 保留为兼容分支；页面版本切换回 fetch 时仍可工作。
    if (typeof window.fetch === 'function') {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (!isDanmakuUrl(url) || !Store.getSetting('enabled')) return nativeFetch(input, init);
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
    setInterval(scanDmPanels, 900);
  }

  // ====================================================================
  // 6.5 检查更新（一键检测 + 触发安装）
  // 说明：用户脚本无法运行时自替换，故"更新"= 拉取远程脚本比对版本，
  // 有新版则打开 .user.js 链接，由 Tampermonkey 弹「更新」页（点一次即装）。
  // 想彻底免拖文件：在 Tampermonkey 把本脚本「更新 → 模式」设为「自动」，TM 每天静默更新。
  // ====================================================================
  function checkUpdate() {
    const statusEl = document.getElementById('ob-update-status');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
    setStatus('正在检查…');
    try {
      GM_xmlhttpRequest({
        url: UPDATE_URL,
        method: 'GET',
        onload: (res) => {
          try {
            const txt = res.responseText || '';
            const m = txt.match(/\/\/\s*@version\s+([\d.]+)/);
            if (!m) { setStatus('无法解析远程版本'); return; }
            const remote = m[1];
            const local = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '0.0.0';
            const cmp = (a, b) => {
              const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
              for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const x = pa[i] || 0, y = pb[i] || 0;
                if (x !== y) return x > y ? 1 : -1;
              }
              return 0;
            };
            if (cmp(remote, local) > 0) {
              setStatus('发现新版本 v' + remote + '，正在打开安装…');
              try { GM_openInTab(DOWNLOAD_URL, { active: true }); }
              catch (e) { window.open(DOWNLOAD_URL, '_blank'); }
            } else {
              setStatus('已是最新 (v' + local + ')');
            }
          } catch (e) { setStatus('检查失败：' + (e && e.message || e)); }
        },
        onerror: () => setStatus('检查失败（网络问题），可稍后重试或手动拖入'),
      });
    } catch (e) {
      setStatus('检查失败（GM_xmlhttpRequest 不可用）');
    }
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
          <label><input type="checkbox" id="ob-quick" checked> 在平台原生"拉黑/举报"旁显示"本地拉黑"</label>
          <label><input type="checkbox" id="ob-bulk" checked> 显示"一键拉黑本页/全部"按钮</label>
          <label><input type="checkbox" id="ob-skip" checked> 抖音推荐流自动切下一条</label>
          <label>抖音连续跳过上限 <input type="number" id="ob-skipcap" min="0" max="50" style="width:56px"> 条（0=不限制）</label>
        </div>

        <h3>名单（点击删除）</h3>
        <div class="ob-list" id="ob-list"></div>

        <h3>备份</h3>
        <div style="display:flex;gap:8px">
          <button id="ob-export" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导出 JSON</button>
          <button id="ob-import" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导入 JSON</button>
          <input type="file" id="ob-file" accept="application/json" style="display:none">
        </div>

        <h3>更新</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="ob-update" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">检查更新</button>
          <span id="ob-update-status" style="font-size:12px;color:#999"></span>
        </div>
        <p style="color:#999;font-size:12px">点一下自动去仓库比对版本，有新版会弹出安装页（点一次即更新）。想彻底免拖文件：在 Tampermonkey 里把本脚本「更新 → 模式」设为「自动」，TM 会每天静默更新。</p>

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
    panel.querySelector('#ob-quick').checked = s.showQuickBlock;
    panel.querySelector('#ob-bulk').checked = s.showBulkBlock;
      panel.querySelector('#ob-skip').checked = s.douyinAutoSkip;
      panel.querySelector('#ob-skipcap').value = s.skipCap;
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
    panel.querySelector('#ob-quick').onchange = (e) => { Store.setSetting('showQuickBlock', e.target.checked); if (e.target.checked && window.OB && window.OB.setupQuickBlock) window.OB.setupQuickBlock(); };
    panel.querySelector('#ob-bulk').onchange = (e) => { Store.setSetting('showBulkBlock', e.target.checked); if (e.target.checked && window.OB && window.OB.refreshBulk) window.OB.refreshBulk(); };
    panel.querySelector('#ob-skip').onchange = (e) => Store.setSetting('douyinAutoSkip', e.target.checked);
    panel.querySelector('#ob-skipcap').onchange = (e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) Store.setSetting('skipCap', v); };
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
    panel.querySelector('#ob-update').onclick = checkUpdate;
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
  try { GM_registerMenuCommand('检查更新', checkUpdate, 'u'); } catch (e) {}

  if (currentAdapter) {
    setupBilibiliDanmaku();
    currentScanner = createScanner(currentAdapter);
    setupQuickBlock();
    setupBulkBlock();
    // 首屏延迟补扫（应对 SPA 晚加载）
    setTimeout(() => currentScanner && currentScanner.schedule(), 800);
    setTimeout(() => currentScanner && currentScanner.schedule(), 2500);
    setTimeout(() => currentScanner && currentScanner.schedule(), 6000);

    // 常驻设置入口（⚙ 按钮）：让设置页不再藏在 Tampermonkey 菜单里
    (function mountGear() {
      if (!document.body) { setTimeout(mountGear, 300); return; }
      if (document.getElementById('ob-gear')) return;
      const gear = document.createElement('div');
      gear.id = 'ob-gear';
      gear.textContent = '⚙';
      gear.title = '本地内容过滤增强 · 设置';
      gear.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;width:40px;height:40px;border-radius:50%;background:#2b2b32;color:#fff;font-size:20px;line-height:40px;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);user-select:none;';
      gear.onclick = () => openOptions();
      document.body.appendChild(gear);
    })();
  }

  // 暴露调试接口
  window.OB = { Store, Index, openOptions, adapters: Adapters, setupQuickBlock, setupBulkBlock, collectUsers, identifyFromAnchor };
})();

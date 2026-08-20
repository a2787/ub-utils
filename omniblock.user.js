// ==UserScript==
// @name          本地内容过滤增强
// @namespace     https://github.com/a2787/ub-utils
// @version       0.12.0
// @description   一个浏览器本地内容过滤用户脚本，可按用户隐藏其内容。名单纯本地、不上传、无数量上限。
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
// @grant         GM_info
// @connect       raw.githubusercontent.com
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
 *  - 评论/弹幕固定零占位隐藏；其他内容可折叠或完全消失；抖音推荐流可自动跳过。
 *  - 抖音推荐流：绝不写 media.muted（抖音把静音当全局偏好），改用视觉遮罩 + 自动切下一条，带四道安全阀。
 *  - 所有拉黑入口均为自建 UI，绝不触发平台原生"不感兴趣"/官方拉黑，避免污染推荐模型或被风控。
 *  - B站弹幕：MAIN world 拦截 seg.so（当前播放器走 XHR，保留 fetch 兼容），手写轻量 varint 解析 + CRC32 正向映射过滤（无需彩虹表）。
 *  - 名单与浏览数据只在本机保存，不上传；仅用户主动检查更新时请求脚本更新地址。
 */
(function () {
  'use strict';

  // ====================================================================
  // 0. 基础工具
  // ====================================================================
  // 更新地址（与脚本头 @updateURL/@downloadURL 保持一致；用户脚本运行时无法自读元数据，故显式声明）
  const UPDATE_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';
  const DOWNLOAD_URL = UPDATE_URL;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const textOf = (el) => (el ? (el.textContent || '').trim() : '');
  const attr = (el, a) => (el ? el.getAttribute(a) : null);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
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

  const IDENTITY_NORMALIZERS = {
    'bili:uid': normalizeDigits,
    'bili:dmhash': (value) => {
      const hash = normId(value).replace(/^0x/i, '').toLowerCase();
      return /^[0-9a-f]{1,8}$/.test(hash) ? hash.padStart(8, '0') : '';
    },
    'weibo:uid': normalizeDigits,
    'zhihu:token': normalizeOpaque,
    'tieba:uid': normalizeDigits,
    'x:handle': (value) => {
      const handle = normId(value).replace(/^@/, '').toLowerCase();
      return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : '';
    },
    'douyin:secuid': normalizeOpaque,
    'douyin:uid': normalizeDigits,
    // 旧版本可能保存过姓名或非规范 uid。保留可导入/导出兼容，但适配器不再生成这些键。
    'weibo:name': normalizeLegacyName,
    'zhihu:name': normalizeLegacyName,
    'tieba:name': normalizeLegacyName,
    'zhihu:uid': normalizeOpaque,
    'x:uid': normalizeOpaque,
  };
  const MANUAL_IDENTITY_TYPE = {
    bili: 'bili:uid', weibo: 'weibo:uid', zhihu: 'zhihu:token',
    tieba: 'tieba:uid', x: 'x:handle', douyin: 'douyin:secuid',
  };

  function normalizeDigits(value) {
    const digits = normId(value);
    return /^\d+$/.test(digits) ? digits.replace(/^0+(?=\d)/, '') : '';
  }

  function normalizeOpaque(value) {
    const opaque = normId(value);
    return opaque && opaque.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(opaque) ? opaque : '';
  }

  function normalizeLegacyName(value) {
    const name = normNick(value);
    return name && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name) ? name : '';
  }

  function normalizeIdentityKey(key) {
    const raw = normId(key);
    for (const type of Object.keys(IDENTITY_NORMALIZERS)) {
      const prefix = type + ':';
      if (!raw.startsWith(prefix)) continue;
      const value = IDENTITY_NORMALIZERS[type](raw.slice(prefix.length));
      return value ? prefix + value : '';
    }
    return '';
  }

  function normalizeIdentityKeys(keys) {
    const out = [];
    const seen = new Set();
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const normalized = normalizeIdentityKey(key);
      if (normalized && !seen.has(normalized)) { seen.add(normalized); out.push(normalized); }
    }
    return out;
  }

  function makeIdentityKey(type, value) {
    return normalizeIdentityKey(type + ':' + normId(value));
  }

  function appendIdentityKey(keys, type, value) {
    const key = makeIdentityKey(type, value);
    if (key) keys.push(key);
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

    function cleanText(value, fallback, maxLength) {
      if (value == null) return fallback;
      const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
      return (text || fallback).slice(0, maxLength);
    }

    function sanitizeSettings(input) {
      const source = input && typeof input === 'object' ? input : {};
      const out = { ...DEFAULT_SETTINGS };
      for (const key of ['enabled', 'showHoverButton', 'douyinAutoSkip', 'showQuickBlock', 'showBulkBlock']) {
        if (typeof source[key] === 'boolean') out[key] = source[key];
      }
      if (source.hideMode === 'collapse' || source.hideMode === 'disappear') out.hideMode = source.hideMode;
      const cap = Number(source.skipCap);
      if (Number.isFinite(cap)) out.skipCap = clamp(Math.round(cap), 0, 50);
      return out;
    }

    function genId() {
      return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function sanitizePersons(input) {
      const out = Object.create(null);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
      for (const sourceId of Object.keys(input)) {
        const person = input[sourceId];
        if (!person || typeof person !== 'object') continue;
        const identities = normalizeIdentityKeys(person.identities);
        if (!identities.length) continue;
        let id = /^p_[A-Za-z0-9_-]+$/.test(sourceId) ? sourceId : genId();
        while (out[id]) id = genId();
        out[id] = {
          label: cleanText(person.label, '未命名', 200),
          note: cleanText(person.note, '', 2000),
          createdAt: Number.isFinite(Number(person.createdAt)) ? Number(person.createdAt) : Date.now(),
          hits: Number.isFinite(Number(person.hits)) ? Math.max(0, Math.round(Number(person.hits))) : 0,
          identities,
        };
      }
      return out;
    }

    function load() {
      if (data) return data;
      let raw;
      try { raw = GM_getValue(STORAGE_KEY, null); } catch (e) { raw = null; }
      if (raw && typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = null; }
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
      data = { version: 1, persons: sanitizePersons(raw.persons), settings: sanitizeSettings(raw.settings) };
      return data;
    }

    function persist() {
      try { GM_setValue(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* 配额/隐私模式 */ }
      listeners.forEach((fn) => { try { fn(); } catch (e) {} });
    }

    function persons() { return load().persons; }
    function settings() { return load().settings; }
    function setSetting(k, v) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) return false;
      const next = sanitizeSettings({ ...load().settings, [k]: v });
      if (next[k] === load().settings[k]) return true;
      data.settings = next; persist(); return true;
    }
    function getSetting(k) { return load().settings[k]; }

    function addIdentitiesInternal(keys, label, note, meta) {
      load();
      const normalized = normalizeIdentityKeys(keys);
      if (!normalized.length) return { person: null, personId: '', added: 0, addedKeys: [], rejected: true };
      const pset = persons();
      const existingKeys = allIdentities();
      const matchedIds = Object.keys(pset).filter((id) => normalized.some((key) => pset[id].identities.includes(key)));
      let targetId = matchedIds[0] || '';
      if (!targetId) {
        targetId = genId();
        while (pset[targetId]) targetId = genId();
        pset[targetId] = {
          label: cleanText(label, '未命名', 200), note: cleanText(note, '', 2000),
          createdAt: meta && Number.isFinite(Number(meta.createdAt)) ? Number(meta.createdAt) : Date.now(),
          hits: meta && Number.isFinite(Number(meta.hits)) ? Math.max(0, Math.round(Number(meta.hits))) : 0,
          identities: [],
        };
      }
      const target = pset[targetId];
      // 一个身份只能归属一个人物；导入桥接记录时合并已有重复人物。
      for (const id of matchedIds.slice(1)) {
        const other = pset[id];
        for (const key of other.identities) if (!target.identities.includes(key)) target.identities.push(key);
        if (target.label === '未命名' && other.label) target.label = other.label;
        if (!target.note && other.note) target.note = other.note;
        target.createdAt = Math.min(target.createdAt || Date.now(), other.createdAt || Date.now());
        target.hits = (target.hits || 0) + (other.hits || 0);
        delete pset[id];
      }
      for (const key of normalized) if (!target.identities.includes(key)) target.identities.push(key);
      if (label && target.label === '未命名') target.label = cleanText(label, '未命名', 200);
      const addedKeys = normalized.filter((key) => !existingKeys.has(key));
      return { person: target, personId: targetId, added: addedKeys.length, addedKeys, rejected: false };
    }

    function addIdentities(keys, label, note) {
      const result = addIdentitiesInternal(keys, label, note);
      if (!result.rejected) persist();
      return result;
    }

    function addIdentityGroups(groups) {
      const results = [];
      for (const group of Array.isArray(groups) ? groups : []) {
        const result = addIdentitiesInternal(group && group.keys, group && group.label, group && group.note);
        if (!result.rejected) results.push(result);
      }
      if (results.length) persist();
      return results;
    }

    function removePerson(id) {
      load();
      if (Object.prototype.hasOwnProperty.call(persons(), id)) { delete persons()[id]; persist(); return true; }
      return false;
    }

    function removeIdentities(keys) {
      load();
      const targets = new Set(normalizeIdentityKeys(keys));
      if (!targets.size) return 0;
      let removed = 0;
      for (const id of Object.keys(persons())) {
        const arr = persons()[id].identities;
        const kept = arr.filter((key) => !targets.has(key));
        removed += arr.length - kept.length;
        if (kept.length) persons()[id].identities = kept;
        else if (kept.length !== arr.length) delete persons()[id];
      }
      if (removed) persist();
      return removed;
    }

    function removeIdentity(key) { return removeIdentities([key]) > 0; }

    function allIdentities() {
      const set = new Set();
      const pset = persons();
      for (const id of Object.keys(pset)) for (const key of pset[id].identities) set.add(key);
      return set;
    }

    function exportJSON() {
      return JSON.stringify({ version: 1, exportedAt: Date.now(), persons: persons(), settings: settings() }, null, 2);
    }

    function importJSON(text) {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || !obj.persons || typeof obj.persons !== 'object' || Array.isArray(obj.persons)) {
        throw new Error('格式不正确：缺少 persons');
      }
      load();
      const result = { persons: 0, identities: 0, skipped: 0 };
      for (const id of Object.keys(obj.persons)) {
        const person = obj.persons[id];
        if (!person || !Array.isArray(person.identities)) { result.skipped++; continue; }
        const before = Object.keys(persons()).length;
        const added = addIdentitiesInternal(person.identities, person.label, person.note, person);
        if (added.rejected) { result.skipped++; continue; }
        if (Object.keys(persons()).length > before) result.persons++;
        result.identities += added.added;
      }
      if (obj.settings && typeof obj.settings === 'object') data.settings = sanitizeSettings({ ...data.settings, ...obj.settings });
      persist();
      return result;
    }

    // 跨标签页/设置变更的监听
    try {
      GM_addValueChangeListener(STORAGE_KEY, () => { data = null; load(); listeners.forEach((fn) => { try { fn(); } catch (e) {} }); });
    } catch (e) { /* 不支持则忽略 */ }

    function onChange(fn) { listeners.push(fn); }

    return {
      persons, settings, setSetting, getSetting, addIdentities, addIdentityGroups, removePerson,
      removeIdentity, removeIdentities, allIdentities, exportJSON, importJSON, onChange,
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
  // 2. 隐藏引擎：评论/弹幕零占位隐藏，其他内容可折叠或完全消失
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

    /* B站弹幕发送者管理工具：直接使用已解析的 seg.so 数据，不依赖原生弹幕菜单。 */
    #ob-dm-tool {
      position: fixed; right: 14px; bottom: 62px; z-index: 2147483643;
      box-sizing: border-box; min-height: 34px; max-width: min(220px, calc(100vw - 28px));
      border: 0; border-radius: 6px; padding: 7px 10px; background: #2b2b32; color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.3); cursor: pointer; font-size: 12px; line-height: 20px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #ob-dm-tool:hover { background: #41414a; }
    #ob-dm-manager {
      position: fixed; inset: 0; z-index: 2147483644; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-dm-manager .ob-dm-box {
      box-sizing: border-box; width: min(720px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
      border-radius: 8px; padding: 16px; background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.24);
    }
    #ob-dm-manager .ob-dm-head, #ob-dm-manager .ob-dm-toolbar, #ob-dm-manager .ob-dm-footer {
      display: flex; align-items: center; gap: 8px;
    }
    #ob-dm-manager .ob-dm-head { justify-content: space-between; margin-bottom: 10px; }
    #ob-dm-manager h2 { margin: 0; font-size: 16px; }
    #ob-dm-manager .ob-dm-close, #ob-dm-manager .ob-dm-page {
      flex: 0 0 auto; width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent;
      color: #555; cursor: pointer; font-size: 18px; line-height: 32px; padding: 0;
    }
    #ob-dm-manager .ob-dm-close:hover, #ob-dm-manager .ob-dm-page:hover:not(:disabled) { background: #f1f1f1; }
    #ob-dm-manager .ob-dm-toolbar { flex-wrap: wrap; margin-bottom: 10px; }
    #ob-dm-manager .ob-dm-search {
      flex: 1 1 220px; min-width: 0; box-sizing: border-box; height: 34px; border: 1px solid #ccc;
      border-radius: 6px; padding: 6px 8px; color: #222; background: #fff; font-size: 13px;
    }
    #ob-dm-manager .ob-dm-checkall { display: inline-flex; align-items: center; white-space: nowrap; }
    #ob-dm-manager input[type="checkbox"] { width: auto; margin: 0 6px 0 0; }
    #ob-dm-manager .ob-dm-list { min-height: 120px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
    #ob-dm-manager .ob-dm-sender {
      box-sizing: border-box; min-height: 52px; display: grid; grid-template-columns: auto minmax(0, 1fr) 34px;
      align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f0f0f0;
    }
    #ob-dm-manager .ob-dm-sender:last-child { border-bottom: 0; }
    #ob-dm-manager .ob-dm-content { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-dm-manager .ob-dm-meta { color: #888; font-size: 11px; margin-top: 2px; }
    #ob-dm-manager .ob-dm-single {
      width: 32px; height: 32px; border: 0; border-radius: 4px; padding: 0; background: transparent;
      color: #c0392b; cursor: pointer; font-size: 15px;
    }
    #ob-dm-manager .ob-dm-single:hover { background: #fdeceb; }
    #ob-dm-manager .ob-dm-footer { justify-content: space-between; flex-wrap: wrap; padding-top: 10px; }
    #ob-dm-manager .ob-dm-status { color: #777; }
    #ob-dm-manager .ob-dm-pages { display: inline-flex; align-items: center; gap: 4px; }
    #ob-dm-manager .ob-dm-page:disabled { color: #bbb; cursor: default; }
    #ob-dm-manager .ob-dm-batch {
      min-height: 34px; border: 0; border-radius: 6px; padding: 7px 12px; background: #c0392b;
      color: #fff; cursor: pointer; font-size: 12px;
    }
    #ob-dm-manager .ob-dm-batch:hover:not(:disabled) { background: #a93226; }
    #ob-dm-manager .ob-dm-batch:disabled { background: #ccc; cursor: default; }
    @media (max-width: 520px) {
      #ob-dm-manager { align-items: flex-end; }
      #ob-dm-manager .ob-dm-box { width: 100vw; max-height: 88vh; border-radius: 8px 8px 0 0; }
      #ob-dm-manager .ob-dm-footer { align-items: stretch; }
      #ob-dm-manager .ob-dm-batch { flex: 1 1 100%; }
    }

    /* 选项面板 */
    #ob-panel { position: fixed; inset: 0; z-index: 2147483644; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; }
    #ob-panel .ob-box { box-sizing: border-box; background: #fff; color: #222; width: min(680px, 92vw); max-height: 86vh; overflow: auto; border-radius: 8px; padding: 18px; font-size: 13px; }
    #ob-panel h2 { margin: 0 0 10px; font-size: 16px; }
    #ob-panel h3 { margin: 16px 0 6px; font-size: 14px; }
    #ob-panel input:not([type="checkbox"]):not([type="radio"]), #ob-panel select, #ob-panel textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
    #ob-panel input[type="checkbox"], #ob-panel input[type="radio"] { width: auto; margin: 0 4px 0 0; }
    #ob-panel .ob-list { border: 1px solid #eee; border-radius: 8px; max-height: 260px; overflow: auto; }
    #ob-panel .ob-item { display: flex; justify-content: space-between; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #f2f2f2; align-items: center; }
    #ob-panel .ob-item:last-child { border-bottom: 0; }
    #ob-panel .ob-item .ob-meta { color: #999; font-size: 11px; word-break: break-all; }
    #ob-panel .ob-del { color: #c0392b; cursor: pointer; border: 0; background: transparent; font-size: 12px; white-space: nowrap; }
    #ob-panel .ob-close { float: right; cursor: pointer; border: 0; background: transparent; font-size: 18px; color: #999; }
    #ob-gear {
      position: fixed; right: 14px; bottom: 14px; z-index: 2147483643;
      width: 40px; height: 40px; border: 0; border-radius: 50%; padding: 0;
      background: #2b2b32; color: #fff; font-size: 20px; line-height: 40px;
      text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); user-select: none;
    }
    #ob-gear:hover { background: #41414a; }
  `);

  const blockedContainers = new Set();
  const inlineDisplayStates = new WeakMap();

  function needsInlineHide(container) {
    if (!container || !container.getRootNode) return false;
    const root = container.getRootNode();
    // 文档样式无法选择 Shadow Root 内的元素，也无法隐藏宿主的影子内容。
    return !!container.shadowRoot || !!(root && root.host);
  }

  function setInlineHidden(container, hidden) {
    if (!container || !container.style) return;
    if (hidden) {
      if (!inlineDisplayStates.has(container)) {
        inlineDisplayStates.set(container, {
          value: container.style.getPropertyValue('display'),
          priority: container.style.getPropertyPriority('display'),
        });
      }
      container.style.setProperty('display', 'none', 'important');
      return;
    }
    const previous = inlineDisplayStates.get(container);
    if (!previous) return;
    if (previous.value) container.style.setProperty('display', previous.value, previous.priority);
    else container.style.removeProperty('display');
    inlineDisplayStates.delete(container);
  }

  function blockedBarText(label) {
    return `🔇 内容已屏蔽${label ? ' · ' + label : ''} · 点击展开`;
  }

  function makeBar(container, label) {
    const bar = document.createElement('div');
    bar.className = 'ob-bar';
    // 提示条可能被插入 Shadow Root；使用内联样式确保不依赖文档级 stylesheet 穿透。
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;cursor:pointer;font-size:13px;line-height:1.6;padding:6px 10px;margin:2px 0;background:#f3f3f5;color:#888;border-left:3px solid #bbb;border-radius:4px;';
    bar.textContent = blockedBarText(label);
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (container && container.hasAttribute('data-ob-blocked')) {
        const expanded = container.classList.toggle('ob-expanded');
        setInlineHidden(container, !expanded && needsInlineHide(container));
      }
    });
    return bar;
  }

  // 标记一个容器为已屏蔽（折叠或完全消失）
  function markBlocked(container, label, forceMode) {
    if (!container || !container.setAttribute) return;
    const mode = forceMode || Store.getSetting('hideMode');
    blockedContainers.add(container);
    container.setAttribute('data-ob-blocked', '1');
    if (mode === 'disappear') {
      if (container.__obBar && container.__obBar.parentNode) container.__obBar.remove();
      container.__obBar = null;
      container.classList.remove('ob-collapsed', 'ob-expanded');
      container.classList.add('ob-hidden');
      setInlineHidden(container, needsInlineHide(container));
    } else {
      container.classList.remove('ob-hidden');
      container.classList.add('ob-collapsed');
      setInlineHidden(container, needsInlineHide(container) && !container.classList.contains('ob-expanded'));
      let bar = container.__obBar;
      if (!bar || !bar.isConnected) bar = makeBar(container, label);
      bar.textContent = blockedBarText(label);
      if (container.parentNode && (bar.parentNode !== container.parentNode || bar.nextElementSibling !== container)) {
        container.parentNode.insertBefore(bar, container);
      }
      container.__obBar = bar;
    }
  }

  function unmark(container) {
    if (!container) return;
    setInlineHidden(container, false);
    if (container.__obBar && container.__obBar.parentNode) container.__obBar.parentNode.removeChild(container.__obBar);
    container.__obBar = null;
    container.removeAttribute('data-ob-blocked');
    container.classList.remove('ob-hidden', 'ob-collapsed', 'ob-expanded');
    blockedContainers.delete(container);
  }

  function clearBlockedContent() {
    const targets = new Set(blockedContainers);
    for (const container of querySelectorAllDeep(document, '[data-ob-blocked="1"]')) targets.add(container);
    for (const container of targets) unmark(container);
  }

  function pruneBlockedContainers() {
    for (const container of blockedContainers) if (!container.isConnected) blockedContainers.delete(container);
  }

  function modeForItem(adapter, item) {
    for (const selector of adapter.disappearSelectors || []) {
      if (item.matches && item.matches(selector)) return 'disappear';
    }
    return adapter.forceMode === 'collapse' || adapter.forceMode === 'disappear' ? adapter.forceMode : '';
  }

  // 通用：处理一个"条目"——抽出身份，命中则隐藏
  function handleItem(adapter, item) {
    const info = adapter.extract(item);
    const container = (info && adapter.containerOf && adapter.containerOf(item)) || (info && info.container) || item;
    if (!info || !info.keys || !info.keys.length) { unmark(container); return; }
    if (Index.isBlocked(info.keys)) {
      markBlocked(container, info.label, modeForItem(adapter, item));
    } else unmark(container);
  }

  // ====================================================================
  // 3. 扫描器：MutationObserver + rAF 批处理 + 节流
  // ====================================================================
  function createScanner(adapter) {
    let scheduled = false;
    const observedRoots = new Set();
    const observedAttributes = [
      'href', 'data-e2e', 'data-e2e-vid', 'data-mid', 'data-uid', 'uid',
      'data-user-id', 'data-user-card', 'data-usercard', 'data-usercard-mid', 'usercard', 'nick-name',
      'data-field', 'data-sec-uid', 'data-secuid', 'data-danmaku-user-id', 'data-danmu-user-id',
      'data-mid-hash', 'data-mid_hash', 'data-dm-hash', 'data-danmaku-hash',
      'comment_id', 'comment-id', 'data-comment-id', 'action-type',
    ];
    const mo = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes || []) discoverShadowRoots(node);
      schedule();
    });

    function observeRoot(root) {
      if (!root || observedRoots.has(root)) return;
      observedRoots.add(root);
      try {
        mo.observe(root, { childList: true, attributes: true, attributeFilter: observedAttributes, subtree: true });
      } catch (e) { return; }
      discoverShadowRoots(root);
    }

    function discoverShadowRoots(root) {
      if (!root) return;
      if (root.nodeType === 1 && root.shadowRoot) observeRoot(root.shadowRoot);
      if (!root.querySelectorAll) return;
      for (const node of root.querySelectorAll('*')) if (node.shadowRoot) observeRoot(node.shadowRoot);
    }

    function pruneObservedRoots() {
      let hasDetachedRoot = false;
      for (const root of observedRoots) {
        if (root.host && !root.host.isConnected) { hasDetachedRoot = true; break; }
      }
      if (!hasDetachedRoot) return;
      mo.disconnect();
      observedRoots.clear();
      if (document.documentElement) observeRoot(document.documentElement);
    }

    function scanOnce() {
      scheduled = false;
      pruneBlockedContainers();
      pruneObservedRoots();
      discoverShadowRoots(document);
      if (!Store.getSetting('enabled')) {
        clearBlockedContent();
        try { adapter.onDisabled && adapter.onDisabled(); } catch (e) {}
        return;
      }
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
    // 初始扫描 + 监听
    schedule();
    if (document.documentElement) observeRoot(document.documentElement);
    else document.addEventListener('DOMContentLoaded', () => observeRoot(document.documentElement), { once: true });
    Store.onChange(schedule);
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

  function showConfirm(label, keys, anchorEl, onBlocked, commit) {
    const normalizedKeys = normalizeIdentityKeys(keys);
    if (!normalizedKeys.length) { showToast('无法识别可靠身份'); return; }
    let box = $('#ob-confirm');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ob-confirm';
    box.innerHTML = `<div class="ob-title">确认拉黑？</div><div class="ob-sub"></div><div class="ob-row"><button class="ob-no">取消</button><button class="ob-ok">拉黑</button></div>`;
    const sub = (label || '该用户') + '\n' + (normalizedKeys.length > 5 ? normalizedKeys.slice(0, 5).join('  ') + ' …(共' + normalizedKeys.length + '项)' : normalizedKeys.join('  '));
    box.querySelector('.ob-sub').textContent = sub;
    box.querySelector('.ob-no').onclick = () => box.remove();
    let rect = { left: window.innerWidth / 2 - 130, top: window.innerHeight / 2 - 60 };
    if (anchorEl && anchorEl.getBoundingClientRect) { const r = anchorEl.getBoundingClientRect(); rect = { left: clamp(r.left, 8, window.innerWidth - 280), top: clamp(r.bottom + 6, 8, window.innerHeight - 160) }; }
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    document.body.appendChild(box);
    box.querySelector('.ob-ok').onclick = () => {
      let transaction;
      try {
        if (commit) transaction = commit();
        else {
          const result = Store.addIdentities(normalizedKeys, label);
          transaction = {
            result,
            undo: result.addedKeys.length ? () => Store.removeIdentities(result.addedKeys) : null,
          };
        }
      } catch (e) {
        box.remove(); showToast('拉黑失败：' + (e && e.message || e)); return;
      }
      box.remove();
      try { if (onBlocked) onBlocked(transaction && transaction.result); } catch (e) {}
      showToast(`已拉黑：${label || normalizedKeys[0]}`, transaction && transaction.undo);
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
    const undoButton = t.querySelector('button');
    if (typeof onUndo !== 'function') undoButton.remove();
    else undoButton.onclick = () => { if (undone) return; undone = true; onUndo(); t.remove(); if (currentScanner) currentScanner.schedule(); };
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
      comment: '[data-e2e="comment-item"], .comment-item',
      commentNickname: '[data-e2e="comment-username"], [data-e2e*="nickname"], [data-e2e*="user-name"], [class*="nickname"], [class*="user-name"], [class*="username"]',
      siteCard: '.search-result-card, .discover-video-card-item, [data-e2e="general-card"], [data-e2e="search-card"]',
      profileList: '[data-e2e="user-post-list"] [data-e2e="scroll-list"]',
      feedActive: '[data-e2e="feed-active-video"]',
      feedVideo: '[data-e2e-vid][data-e2e^="feed-"]',
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

    function findAuthorLink(item) {
      const links = Array.from(item.querySelectorAll('a[href*="/user/"]'));
      const first = links.find((link) => secUidFromHref(attr(link, 'href')));
      if (!first) return null;
      const sec = secUidFromHref(attr(first, 'href'));
      return links.find((link) => secUidFromHref(attr(link, 'href')) === sec && textOf(link)) || first;
    }

    function extractComment(item) {
      const link = findAuthorLink(item);
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(link) || textOf(item.querySelector(SEL.commentNickname));
      const keys = [];
      appendIdentityKey(keys, 'douyin:secuid', sec);
      return { keys, label: name, container: item };
    }

    function extractGeneric(item) {
      const link = findAuthorLink(item);
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(item.querySelector('[data-e2e="feed-video-nickname"], [data-e2e="feed-author-name"]')) || textOf(link);
      const keys = [];
      appendIdentityKey(keys, 'douyin:secuid', sec);
      return { keys, label: name, container: item };
    }

    function extractProfileList(item) {
      const sec = /^\/user\/[^/?#]+/i.test(location.pathname) ? secUidFromHref(location.href) : '';
      const name = textOf(document.querySelector('h1, [data-e2e="user-title"]'));
      const keys = [];
      appendIdentityKey(keys, 'douyin:secuid', sec);
      return { keys, label: name, container: item };
    }

    function extractDanmaku(item) {
      const uid = normId(attr(item, 'data-danmaku-user-id') || attr(item, 'data-danmu-user-id') || attr(item, 'data-user-id') || attr(item, 'data-uid'));
      const sec = secUidFromHref(attr(item, 'data-sec-uid') || attr(item, 'href') || '');
      const keys = [];
      appendIdentityKey(keys, 'douyin:uid', uid);
      appendIdentityKey(keys, 'douyin:secuid', sec);
      if (!keys.length) return null;   // 无身份属性则跳过（抖音弹幕兜底见计划 M5）
      return { keys, label: '', container: item };
    }

    // 推荐流自动切：视觉遮罩 + 点下一条，带四道安全阀
    const skippedTokens = new WeakMap();
    let consecutive = 0;
    let coverEl = null;
    let pendingSkip = null;
    function ensureCover() {
      if (coverEl) return coverEl;
      coverEl = document.createElement('div');
      coverEl.id = 'ob-feed-cover';
      coverEl.style.display = 'none';
      const title = document.createElement('span');
      const detail = document.createElement('small');
      coverEl.append(title, detail);
      coverEl.__obTitle = title; coverEl.__obDetail = detail;
      document.body.appendChild(coverEl);
      return coverEl;
    }
    function clearCover() { if (coverEl) coverEl.style.display = 'none'; }
    function cancelPendingSkip() {
      if (pendingSkip) clearTimeout(pendingSkip.timer);
      pendingSkip = null;
    }

    function videoToken(active, sec) {
      return normId(attr(active, 'data-e2e-vid') || attr(active, 'data-video-id') || attr(active, 'data-item-id'))
        || sec + '|' + location.pathname + location.search;
    }

    function showFeedCover(name) {
      const cover = ensureCover();
      cover.style.display = 'flex';
      const titleText = '🔇 已自动跳过被屏蔽作者';
      const detailText = (name ? '（' + name + '）' : '') + ' · 如误切可手动划走';
      if (cover.__obTitle.textContent !== titleText) cover.__obTitle.textContent = titleText;
      if (cover.__obDetail.textContent !== detailText) cover.__obDetail.textContent = detailText;
    }

    function activeFeedItem() {
      const marked = $(SEL.feedActive);
      if (marked) return marked;
      const playing = $$(SEL.feedVideo).filter((item) => {
        const media = item.querySelector('video, audio');
        return media && !media.paused;
      });
      return playing.length === 1 ? playing[0] : null;
    }

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
      const active = activeFeedItem();
      if (!active) { cancelPendingSkip(); clearCover(); consecutive = 0; return; }
      const link = active.querySelector(SEL.feedAuthorLink);
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(active.querySelector(SEL.feedAuthorName)) || textOf(link);
      const identity = makeIdentityKey('douyin:secuid', sec);
      if (!identity) { cancelPendingSkip(); clearCover(); return; }   // 拿不到作者身份就不动
      const blocked = Index.isBlocked([identity]);
      if (!blocked) { cancelPendingSkip(); clearCover(); consecutive = 0; return; }

      const token = videoToken(active, sec);
      showFeedCover(name);

      if (!Store.getSetting('douyinAutoSkip')) { cancelPendingSkip(); return; }   // 仅遮罩，不自动切
      if (skippedTokens.get(active) === token) return;   // 同一个视频只切一次；节点复用为新视频时允许重判。
      const cap = Number(Store.getSetting('skipCap'));
      if (cap > 0 && consecutive >= cap) return;

      skippedTokens.set(active, token);
      consecutive++;
      cancelPendingSkip();
      const delay = rand(200, 600);
      const timer = setTimeout(() => {
        pendingSkip = null;
        if (!Store.getSetting('enabled') || !Store.getSetting('douyinAutoSkip')) return;
        const current = activeFeedItem();
        if (current !== active) return;
        const currentLink = current.querySelector(SEL.feedAuthorLink);
        const currentSec = secUidFromHref(attr(currentLink, 'href'));
        const currentIdentity = makeIdentityKey('douyin:secuid', currentSec);
        if (videoToken(current, currentSec) !== token || !Index.isBlocked(currentIdentity)) return;
        advance();
      }, delay);
      pendingSkip = { timer, active, token };
    }

    function disableFeed() { cancelPendingSkip(); clearCover(); consecutive = 0; }

    return {
      id: 'douyin',
      match: (h) => /(^|\.)douyin\.com$/.test(h.hostname),
      selectors: [SEL.comment, SEL.siteCard, SEL.profileList, SEL.danmaku],
      disappearSelectors: [SEL.comment, SEL.danmaku],
      extract(item) {
        if (item.matches && item.matches(SEL.comment)) return extractComment(item);
        if (item.matches && item.matches(SEL.profileList)) return extractProfileList(item);
        if (item.matches && item.matches(SEL.danmaku)) return extractDanmaku(item);
        return extractGeneric(item);
      },
      containerOf: (item) => item,
      onScan: feedTick,
      onDisabled: disableFeed,
    };
  })();

  // ---------- 微博 ----------
  Adapters.weibo = (function () {
    const SEL = {
      card: '.card-wrap[action-type="feed_list_item"], .card-wrap[mid], [action-type="feed_list_item"], .WB_feed_type, article[class*="vue-card"], article.woo-panel-main, .card-feed',
      comment: '.card-review[comment_id]',
      userLink: 'a[href*="/u/"], a[href*="/n/"], a[nick-name], [data-user-card], [data-usercard], [usercard], [data-uid], [uid]',
      postAuthor: [
        '.card-feed .content > .info a.name[href]',
        '.card-feed .content > .info [nick-name]',
        '.card-feed .avator a[href]',
        '.card-feed .avatar a[href]',
        '.content > .info a.name[href]',
        'header a[nick-name][href]',
        'header a[href*="/u/"]',
        'header [usercard]',
        'header [data-user-card]',
        'header [data-usercard]',
        ':scope > a[nick-name][href]',
      ].join(','),
      commentAuthor: [
        ':scope > .content > .txt a.name[href]',
        ':scope > .content > .txt a[nick-name][href]',
        ':scope > .con1 > .info a.name[href]',
        ':scope > .con1 > .info a[nick-name][href]',
        ':scope > .avator a[href]',
        ':scope > .avatar a[href]',
      ].join(','),
    };
    function uidFromLink(link) {
      if (!link) return '';
      const href = attr(link, 'href') || '';
      const m = href.match(/\/u\/(\d{5,})(?:[/?#]|$)/) || href.match(/\/(\d{5,})(?:[/?#]|$)/);
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
    function findContainer(el) {
      if (el.matches && el.matches(SEL.comment)) return el;
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(SEL.card)) return p;
        p = p.parentElement;
      }
      return el;
    }
    function preferredLink(links) {
      return links.find((link) => uidFromLink(link) && (textOf(link) || attr(link, 'nick-name')))
        || links.find((link) => uidFromLink(link)) || null;
    }
    function findUserLink(item) {
      if (item.matches && item.matches(SEL.comment)) {
        // 评论作者必须来自评论行自己的作者槽，不能退回到提及用户或外层微博作者。
        return preferredLink($$(SEL.commentAuthor, item));
      }
      const scoped = preferredLink($$(SEL.postAuthor, item));
      if (scoped) return scoped;

      // 旧版信息流存在没有稳定作者 class 的卡片；只有整卡唯一 UID 时才安全兜底。
      const byUid = new Map();
      for (const link of $$(SEL.userLink, item)) {
        const uid = uidFromLink(link);
        if (!uid) continue;
        const current = byUid.get(uid);
        if (!current || (!textOf(current) && textOf(link))) byUid.set(uid, link);
      }
      return byUid.size === 1 ? preferredLink(Array.from(byUid.values())) : null;
    }
    return {
      id: 'weibo',
      match: (h) => /(^|\.)weibo\.com$/.test(h.hostname) || /(^|\.)weibo\.cn$/.test(h.hostname),
      selectors: [SEL.comment, SEL.card],
      disappearSelectors: [SEL.comment],
      extract(item) {
        const link = findUserLink(item);
        const uid = uidFromLink(link);
        const name = textOf(link) || attr(link, 'nick-name');
        const keys = [];
        appendIdentityKey(keys, 'weibo:uid', uid);
        return { keys, label: name, container: findContainer(item) };
      },
      containerOf: (item) => findContainer(item),
    };
  })();

  // ---------- 知乎 ----------
  Adapters.zhihu = (function () {
    const SEL = {
      item: '.ContentItem, .FeedCard, .TopstoryItem, [data-testid="AnswerCard"], .CommentItem, .List-item',
      comment: '.CommentItem',
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
      disappearSelectors: [SEL.comment],
      extract(item) {
        const link = item.querySelector(SEL.userLink);
        const { token } = idFromLink(link);
        const name = textOf(link);
        const keys = [];
        appendIdentityKey(keys, 'zhihu:token', token);
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
    // X 的回复与普通帖子共用同一条目结构；统一零占位隐藏，避免回复位置留下灰条或空行。
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
      selectors: [SEL.tweet],
      disappearSelectors: [SEL.tweet],
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
        appendIdentityKey(keys, 'x:handle', handle);
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
    function containerForItem(item) {
      return item.matches(SEL.thread) ? findContainer(item, SEL.thread)
        : (item.closest && item.closest('div.l_post.l_post_bright')) || item;
    }
    return {
      id: 'tieba',
      match: (h) => /(^|\.)tieba\.baidu\.com$/.test(h.hostname),
      // 楼中楼集合不是单条回复；没有可靠的单回复捕获结构时不扫描该集合。
      selectors: [SEL.thread, SEL.post],
      disappearSelectors: [SEL.post],
      extract(item) {
        let fieldEl = item.querySelector(SEL.author);
        if (!fieldEl && item.hasAttribute && item.hasAttribute('data-field')) fieldEl = item;
        const { uid, name } = fieldEl ? uidFromField(fieldEl) : { uid: '', name: '' };
        const keys = [];
        appendIdentityKey(keys, 'tieba:uid', uid);
        const container = containerForItem(item);
        return { keys, label: name, container };
      },
      containerOf: containerForItem,
    };
  })();

  // ---------- B站 ----------
  Adapters.bilibili = (function () {
    const SEL = {
      comment: 'bili-comment-renderer, bili-comment-reply-renderer, bili-sub-comment-renderer, .comment-item, .reply-item, [data-comment-id]',
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

    function commentContainer(el) {
      if (el && el.tagName === 'BILI-COMMENT-RENDERER' && el.getRootNode) {
        const root = el.getRootNode();
        if (root && root.host && root.host.tagName === 'BILI-COMMENT-THREAD-RENDERER') return root.host;
      }
      return el;
    }

    function extract(el) {
      const fromData = dataIdentity(el && el.__data);
      const mid = fromData.mid || midFromEl(el);
      const name = fromData.name || textOf(deepQuery(el, '.user-name, .uname, [data-name], a[href*="space.bilibili.com/"]'));
      const keys = [];
      appendIdentityKey(keys, 'bili:uid', mid);
      return { keys, label: name, container: commentContainer(el) };
    }

    function userFromSpaceLink(link) {
      const m = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/);
      if (!m) return null;
      return { keys: [makeIdentityKey('bili:uid', m[1])], label: textOf(link), container: link };
    }

    function collectCommentUsers(root) {
      return querySelectorAllDeep(root, SEL.comment).map(extract);
    }

    function collectModalUsers(root) {
      // B站视频页的举报弹窗并不含发送者；只有实际列出空间链接的用户列表才可批量处理。
      return querySelectorAllDeep(root, 'a[href*="space.bilibili.com/"]').map(userFromSpaceLink).filter(Boolean);
    }

    return {
      id: 'bilibili',
      match: (h) => /(^|\.)bilibili\.com$/.test(h.hostname),
      selectors: [SEL.comment, SEL.dyn, SEL.videoCard, SEL.space],
      disappearSelectors: [SEL.comment],
      extract,
      // 统计当前已加载的根评论和楼中楼作者，绝不把推荐视频卡/列表项当成人。
      collectUsers(root, purpose) {
        return purpose === 'modal' ? collectModalUsers(root) : collectCommentUsers(root);
      },
      canBulkModal(modal) {
        return collectModalUsers(modal).length >= 2;
      },
      bulkFabLabel: (n) => '🚫 拉黑已加载评论作者(' + n + ')',
      containerOf: commentContainer,
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
  const UID_TYPE = { bilibili: 'bili:uid', weibo: 'weibo:uid', tieba: 'tieba:uid', douyin: 'douyin:uid' };

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
      if (m) return { keys: [makeIdentityKey('bili:uid', m[1])], label: '' };
    }
    const chain = ancestorChain(anchor);
    // 1) 链路里直接带 mid/uid（弹幕等）
    for (const n of chain) {
      const mid = (n.getAttribute && (n.getAttribute('data-mid') || n.getAttribute('data-uid'))) || '';
      const type = UID_TYPE[a.id];
      const key = type && mid ? makeIdentityKey(type, mid) : '';
      if (key) return { keys: [key], label: '' };
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
      if (link) { const mm = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/); if (mm) return { keys: [makeIdentityKey('bili:uid', mm[1])], label: textOf(link) }; }
    }
    return null;
  }

  function makeQuickBtn(label, anchorEl, cfg, key) {
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
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) return;
      const info = cfg.identify ? cfg.identify(anchorEl) : identifyFromAnchor(anchorEl);
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
  let refreshQuickBlock = () => {};
  function setupQuickBlock() {
    const a = currentAdapter; if (!a) return;
    const cfg = QB[a.id]; if (!cfg) return;
    function clearInjected() {
      for (const button of querySelectorAllDeep(document, '.ob-quick')) button.remove();
      for (const anchor of querySelectorAllDeep(document, '[data-ob-qb]')) anchor.removeAttribute('data-ob-qb');
    }
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
          const btn = makeQuickBtn(cfg.label || '本地拉黑', el, cfg, txt);
          el.parentNode.insertBefore(btn, el.nextSibling);
          el.setAttribute('data-ob-qb', '1');
          return;
        }
      }
    }
    function scanAll() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { clearInjected(); return; }
      for (const el of querySelectorAllDeep(document, QB_CANDIDATE)) tryInject(el);
    }
    // 周期扫描：B站菜单在 Shadow DOM 内，MutationObserver 跨不过影子边界，故用定时器 + 全局穿透扫描
    setInterval(scanAll, 900);
    scanAll();
    refreshQuickBlock = scanAll;
    Store.onChange(scanAll);
  }

  // ---- 一键拉黑本页 / 弹窗内全部可见用户 ----
  function uniqueUsers(items) {
    const out = []; const seen = new Set();
    for (const info of items || []) {
      if (info && info.keys && info.keys.length) {
        const keys = normalizeIdentityKeys(info.keys);
        if (!keys.length || keys.some((key) => seen.has(key))) continue;
        keys.forEach((key) => seen.add(key));
        out.push({ ...info, keys });
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

  function blockMany(list, anchorEl, confirmLabel) {
    if (!list.length) { showToast('没有可拉黑的用户'); return; }
    const keys = [];
    list.forEach((i) => i.keys.forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
    showConfirm(confirmLabel || ('拉黑全部 ' + list.length + ' 位用户'), keys, anchorEl, null, () => {
      const results = Store.addIdentityGroups(list.map((info) => ({ keys: info.keys, label: info.label })));
      const addedKeys = [];
      for (const result of results) {
        for (const key of result.addedKeys) if (!addedKeys.includes(key)) addedKeys.push(key);
      }
      return {
        result: { added: addedKeys.length, addedKeys },
        undo: addedKeys.length ? () => Store.removeIdentities(addedKeys) : null,
      };
    });
  }

  let refreshBulkBlock = () => {};
  function setupBulkBlock() {
    const a = currentAdapter; if (!a) return;
    let fab = null;
    const MODAL_SEL = '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal';
    const setFabVisible = (visible) => {
      if (fab) fab.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
    };
    function hasOpenModal() {
      return querySelectorAllDeep(document, MODAL_SEL).some(isVisible);
    }
    function refreshFab() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) { setFabVisible(false); return; }
      const n = collectUsers(document).length;
      // 页面批量按钮不应遮住举报/登录等原生弹窗，更不能显示无意义的“(0)”。
      if (!n || hasOpenModal()) { setFabVisible(false); return; }
      if (!fab) {
        fab = document.createElement('button');
        fab.type = 'button'; fab.setAttribute('data-ob-kind', 'page');
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
      let btn = Array.from(modal.children || []).find((child) => child.matches && child.matches('.ob-bulk[data-ob-kind="modal"]')) || null;
      const allowed = (!a.canBulkModal || a.canBulkModal(modal));
      const users = collectUsers(modal, 'modal');
      if (!allowed || users.length < 2) {
        if (btn) btn.remove();
        modal.removeAttribute('data-ob-bulk');
        return;
      }
      modal.setAttribute('data-ob-bulk', '1');
      if (!btn) {
        btn = document.createElement('button'); btn.type = 'button';
        btn.className = 'ob-bulk'; btn.setAttribute('data-ob-kind', 'modal');
        btn.onclick = () => blockMany(collectUsers(modal, 'modal'), btn);
        const header = modal.querySelector('header,.modal-header,.dialog-header,.head,.title') || modal.firstElementChild;
        if (header && header.parentNode) header.parentNode.insertBefore(btn, header);
        else modal.insertBefore(btn, modal.firstChild);
      }
      btn.textContent = '🚫 拉黑全部(' + users.length + ')';
    }
    function clearModalControls() {
      for (const button of querySelectorAllDeep(document, '.ob-bulk[data-ob-kind="modal"]')) button.remove();
      for (const modal of querySelectorAllDeep(document, '[data-ob-bulk]')) modal.removeAttribute('data-ob-bulk');
    }
    function scanModals() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) { clearModalControls(); return; }
      for (const md of querySelectorAllDeep(document, MODAL_SEL)) tryModal(md);
    }
    function refreshAll() { refreshFab(); scanModals(); }
    // 周期扫描（弹窗可能在 Shadow DOM 内，定时器 + 影子穿透更稳）
    setInterval(refreshAll, 1200);
    refreshAll();
    refreshBulkBlock = refreshAll;
    Store.onChange(refreshAll);
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
    const dmSenders = new Map();
    const selectedDmHashes = new Set();
    const DM_PAGE_SIZE = 100;
    const DM_SENDER_LIMIT = 5000;
    let dmTool = null;
    let dmManager = null;
    let dmManagerKeyHandler = null;
    let dmSearch = '';
    let dmPage = 0;
    let dmVideoKey = '';
    function cleanDmText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function currentVideoKey() {
      const match = location.pathname.match(/^\/video\/([^/?]+)/);
      return match ? match[1] : location.pathname;
    }
    function resetDmSessionIfNeeded() {
      const key = currentVideoKey();
      if (!dmVideoKey) { dmVideoKey = key; return false; }
      if (key === dmVideoKey) return false;
      dmVideoKey = key;
      dmByContent.clear(); dmByProgress.clear(); dmSenders.clear(); selectedDmHashes.clear();
      dmSearch = ''; dmPage = 0;
      if (dmManager) closeDmManager();
      return true;
    }
    function rememberDanmaku(elem) {
      if (!elem || !elem.hash || !elem.content) return;
      const content = cleanDmText(elem.content);
      if (!content) return;
      resetDmSessionIfNeeded();
      const hashes = dmByContent.get(content) || new Set();
      hashes.add(elem.hash); dmByContent.set(content, hashes);
      if (elem.progress >= 0) {
        const key = String(elem.progress) + '\x1f' + content;
        const progressHashes = dmByProgress.get(key) || new Set();
        progressHashes.add(elem.hash); dmByProgress.set(key, progressHashes);
      }
      let sender = dmSenders.get(elem.hash);
      if (!sender) {
        if (dmSenders.size >= DM_SENDER_LIMIT) {
          const oldest = dmSenders.keys().next().value;
          dmSenders.delete(oldest); selectedDmHashes.delete(oldest);
        }
        sender = { hash: elem.hash, content, progress: elem.progress, count: 0 };
        dmSenders.set(elem.hash, sender);
      }
      sender.count++;
      if (sender.progress < 0 || (elem.progress >= 0 && elem.progress < sender.progress)) {
        sender.progress = elem.progress; sender.content = content;
      }
      // 长视频连续播放时限制会话内索引大小，当前视频的侧栏仍会保留。
      if (dmByContent.size > 5000 || dmByProgress.size > 10000) { dmByContent.clear(); dmByProgress.clear(); }
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
      scanDmPanels(); refreshDmTool();
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

    function formatDmProgress(progress) {
      if (!Number.isFinite(progress) || progress < 0) return '--:--';
      const total = Math.floor(progress / 1000);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return hours
        ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
        : String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    function availableDmSenders() {
      resetDmSessionIfNeeded();
      const blocked = blockedHashes();
      return Array.from(dmSenders.values())
        .filter((sender) => !blocked.has(sender.hash))
        .sort((a, b) => (a.progress < 0 ? Number.MAX_SAFE_INTEGER : a.progress) - (b.progress < 0 ? Number.MAX_SAFE_INTEGER : b.progress));
    }

    function closeDmManager() {
      if (dmManager) dmManager.remove();
      dmManager = null;
      if (dmManagerKeyHandler) document.removeEventListener('keydown', dmManagerKeyHandler);
      dmManagerKeyHandler = null;
    }

    function renderDmManager() {
      if (!dmManager || !dmManager.isConnected) return;
      const available = availableDmSenders();
      const availableHashes = new Set(available.map((sender) => sender.hash));
      for (const hash of Array.from(selectedDmHashes)) if (!availableHashes.has(hash)) selectedDmHashes.delete(hash);
      const term = cleanDmText(dmSearch).toLowerCase();
      const filtered = term ? available.filter((sender) => sender.content.toLowerCase().includes(term)) : available;
      const pageCount = Math.max(1, Math.ceil(filtered.length / DM_PAGE_SIZE));
      dmPage = clamp(dmPage, 0, pageCount - 1);
      const pageItems = filtered.slice(dmPage * DM_PAGE_SIZE, (dmPage + 1) * DM_PAGE_SIZE);
      const batchEnabled = Store.getSetting('showBulkBlock');
      const list = dmManager.querySelector('.ob-dm-list');
      list.textContent = '';

      for (const sender of pageItems) {
        const row = document.createElement('label');
        row.className = 'ob-dm-sender';
        row.setAttribute('data-ob-dm-hash', sender.hash);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.className = 'ob-dm-select';
        checkbox.checked = selectedDmHashes.has(sender.hash);
        checkbox.style.display = batchEnabled ? '' : 'none';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedDmHashes.add(sender.hash);
          else selectedDmHashes.delete(sender.hash);
          renderDmManager();
        });

        const body = document.createElement('div');
        const content = document.createElement('div'); content.className = 'ob-dm-content'; content.textContent = sender.content;
        const meta = document.createElement('div'); meta.className = 'ob-dm-meta';
        meta.textContent = formatDmProgress(sender.progress) + ' · 已捕获 ' + sender.count + ' 条';
        body.append(content, meta);

        const single = document.createElement('button');
        single.type = 'button'; single.className = 'ob-dm-single'; single.textContent = '🚫';
        single.title = '本地屏蔽此弹幕发送者'; single.setAttribute('aria-label', '本地屏蔽此弹幕发送者');
        single.addEventListener('click', (event) => {
          event.stopPropagation(); event.preventDefault();
          showConfirm('弹幕发送者：' + sender.content.slice(0, 36), [makeIdentityKey('bili:dmhash', sender.hash)], single, () => {
            selectedDmHashes.delete(sender.hash); refreshDmTool(); scanDmPanels();
          });
        });
        row.append(checkbox, body, single);
        list.appendChild(row);
      }

      const selectAllWrap = dmManager.querySelector('.ob-dm-checkall');
      const selectAll = selectAllWrap.querySelector('input');
      selectAllWrap.style.display = batchEnabled ? 'inline-flex' : 'none';
      selectAll.checked = !!pageItems.length && pageItems.every((sender) => selectedDmHashes.has(sender.hash));
      selectAll.indeterminate = !selectAll.checked && pageItems.some((sender) => selectedDmHashes.has(sender.hash));
      selectAll.onchange = () => {
        for (const sender of pageItems) {
          if (selectAll.checked) selectedDmHashes.add(sender.hash);
          else selectedDmHashes.delete(sender.hash);
        }
        renderDmManager();
      };

      const selected = available.filter((sender) => selectedDmHashes.has(sender.hash));
      const batch = dmManager.querySelector('.ob-dm-batch');
      batch.style.display = batchEnabled ? '' : 'none';
      batch.disabled = !selected.length;
      batch.textContent = '屏蔽选中(' + selected.length + ')';
      batch.onclick = () => {
        const current = availableDmSenders().filter((sender) => selectedDmHashes.has(sender.hash));
        if (!current.length) return;
        blockMany(
          current.map((sender) => ({ keys: [makeIdentityKey('bili:dmhash', sender.hash)], label: '弹幕发送者' })),
          batch,
          '屏蔽选中的 ' + current.length + ' 位弹幕发送者'
        );
      };

      dmManager.querySelector('.ob-dm-status').textContent = filtered.length + ' 位发送者 · ' + (dmPage + 1) + '/' + pageCount;
      const previous = dmManager.querySelector('[data-ob-page="previous"]');
      const next = dmManager.querySelector('[data-ob-page="next"]');
      previous.disabled = dmPage <= 0;
      next.disabled = dmPage >= pageCount - 1;
    }

    function openDmManager() {
      if (dmManager || !document.body) return;
      dmManager = document.createElement('div');
      dmManager.id = 'ob-dm-manager';
      dmManager.innerHTML = `
        <div class="ob-dm-box" role="dialog" aria-modal="true" aria-labelledby="ob-dm-title">
          <div class="ob-dm-head"><h2 id="ob-dm-title">B站弹幕发送者</h2><button class="ob-dm-close" type="button" title="关闭" aria-label="关闭">×</button></div>
          <div class="ob-dm-toolbar">
            <input class="ob-dm-search" type="search" placeholder="搜索已加载弹幕" aria-label="搜索已加载弹幕">
            <label class="ob-dm-checkall"><input type="checkbox">全选当前页</label>
          </div>
          <div class="ob-dm-list"></div>
          <div class="ob-dm-footer">
            <span class="ob-dm-status"></span>
            <span class="ob-dm-pages"><button class="ob-dm-page" data-ob-page="previous" type="button" title="上一页" aria-label="上一页">‹</button><button class="ob-dm-page" data-ob-page="next" type="button" title="下一页" aria-label="下一页">›</button></span>
            <button class="ob-dm-batch" type="button">屏蔽选中(0)</button>
          </div>
        </div>`;
      dmManager.querySelector('.ob-dm-close').onclick = closeDmManager;
      dmManager.addEventListener('click', (event) => { if (event.target === dmManager) closeDmManager(); });
      const search = dmManager.querySelector('.ob-dm-search');
      search.value = dmSearch;
      search.oninput = () => { dmSearch = search.value; dmPage = 0; renderDmManager(); };
      dmManager.querySelector('[data-ob-page="previous"]').onclick = () => { dmPage--; renderDmManager(); };
      dmManager.querySelector('[data-ob-page="next"]').onclick = () => { dmPage++; renderDmManager(); };
      dmManagerKeyHandler = (event) => { if (event.key === 'Escape') closeDmManager(); };
      document.addEventListener('keydown', dmManagerKeyHandler);
      document.body.appendChild(dmManager);
      renderDmManager();
    }

    function mountDmTool() {
      if (dmTool || !document.body) {
        if (!document.body) setTimeout(mountDmTool, 300);
        return;
      }
      dmTool = document.createElement('button');
      dmTool.id = 'ob-dm-tool'; dmTool.type = 'button';
      dmTool.title = '管理当前视频已加载的弹幕发送者';
      dmTool.setAttribute('aria-label', '管理当前视频已加载的弹幕发送者');
      dmTool.onclick = openDmManager;
      dmTool.style.display = 'none';
      document.body.appendChild(dmTool);
    }

    function refreshDmTool() {
      resetDmSessionIfNeeded();
      mountDmTool();
      if (!dmTool) return;
      const count = availableDmSenders().length;
      const visible = Store.getSetting('enabled') && Store.getSetting('showQuickBlock') && count > 0;
      dmTool.textContent = '🚫 弹幕屏蔽(' + count + ')';
      dmTool.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      if (!visible && dmManager) closeDmManager();
      else if (dmManager) renderDmManager();
    }

    const DM_PANEL_SEL = '.bpx-player-dm-container,.bpx-player-dm-list,.bpx-player-dm-list-container,.bpx-player-dm-list-view';
    const DM_ROW_SEL = 'li,[data-mid-hash],[data-mid_hash],[data-dm-hash],[data-danmaku-hash],[class*="dm-item"],[class*="danmaku-item"]';
    function addDmBlockButton(row, hash) {
      if (row.querySelector && row.querySelector(':scope > .ob-dm-block')) return;
      const btn = document.createElement('button');
      btn.className = 'ob-dm-block'; btn.type = 'button'; btn.textContent = '本地拉黑';
      btn.title = '按该弹幕的 mid_hash 本地屏蔽发送者';
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        showConfirm('该弹幕发送者', [makeIdentityKey('bili:dmhash', hash)], btn, scanDmPanels);
      });
      row.appendChild(btn);
    }

    function scanDmPanels() {
      const enabled = Store.getSetting('enabled');
      const showButton = enabled && Store.getSetting('showQuickBlock');
      const blocked = enabled ? blockedHashes() : new Set();
      for (const panel of querySelectorAllDeep(document, DM_PANEL_SEL)) {
        for (const row of querySelectorAllDeep(panel, DM_ROW_SEL)) {
          const existingButton = row.querySelector && row.querySelector(':scope > .ob-dm-block');
          if (!enabled) {
            setInlineHidden(row, false);
            row.removeAttribute('data-ob-dm-blocked');
            if (existingButton) existingButton.remove();
            continue;
          }
          const hash = hashFromDmRow(row);
          if (!hash) {
            setInlineHidden(row, false);
            row.removeAttribute('data-ob-dm-blocked');
            if (existingButton) existingButton.remove();
            continue;
          }
          if (blocked.has(hash)) {
            row.setAttribute('data-ob-dm-blocked', '1');
            setInlineHidden(row, true);
            if (existingButton) existingButton.remove();
            continue;
          }
          setInlineHidden(row, false);
          row.removeAttribute('data-ob-dm-blocked');
          if (showButton) addDmBlockButton(row, hash);
          else if (existingButton) existingButton.remove();
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
        const url = (typeof input === 'string' || input instanceof URL) ? String(input) : (input && input.url) || '';
        if (!isDanmakuUrl(url) || !Store.getSetting('enabled')) return nativeFetch(input, init);
        return nativeFetch(input, init).then(async (resp) => {
          try {
            const buf = await resp.clone().arrayBuffer();
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
    Store.onChange(() => { scanDmPanels(); refreshDmTool(); });
    mountDmTool();
    setInterval(() => {
      scanDmPanels();
      if (resetDmSessionIfNeeded()) refreshDmTool();
    }, 900);
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
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'OmniBlock 设置');
    panel.innerHTML = `
      <div class="ob-box">
        <button class="ob-close" type="button" aria-label="关闭">×</button>
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

        <h3>帖子 / 动态等其他内容的隐藏方式</h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <label><input type="radio" name="ob-mode" value="collapse" checked> 折叠成灰条（默认，可追溯）</label>
          <label><input type="radio" name="ob-mode" value="disappear"> 完全消失</label>
          <label><input type="checkbox" id="ob-enabled" checked> 启用屏蔽</label>
          <label><input type="checkbox" id="ob-hover" checked> 显示悬浮拉黑按钮</label>
          <label><input type="checkbox" id="ob-quick" checked> 显示"本地拉黑"入口（含B站弹幕工具）</label>
          <label><input type="checkbox" id="ob-bulk" checked> 显示批量拉黑入口（含弹幕勾选批量）</label>
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

        <p style="color:#999;font-size:12px;margin-top:14px">名单与浏览数据只保存在本机，不上传。仅在你点击检查更新时请求脚本更新地址。抖音推荐流跳过是唯一一处"模拟操作"，已带随机延迟/连续上限等安全阀。</p>
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
        const details = document.createElement('div');
        const name = document.createElement('div'); name.textContent = p.label || '未命名';
        const identities = document.createElement('div'); identities.className = 'ob-meta'; identities.textContent = (p.identities || []).join('  ');
        details.append(name, identities); row.appendChild(details);
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
      const key = makeIdentityKey(MANUAL_IDENTITY_TYPE[plat], val);
      if (!key) { showToast('身份格式不正确'); return; }
      Store.addIdentities([key], label || val);
      panel.querySelector('#ob-val').value = '';
      refresh(); if (currentScanner) currentScanner.schedule();
    };
    panel.querySelectorAll('input[name="ob-mode"]').forEach((r) => r.onchange = () => { if (r.checked) { Store.setSetting('hideMode', r.value); if (currentScanner) currentScanner.schedule(); } });
    panel.querySelector('#ob-enabled').onchange = (e) => {
      Store.setSetting('enabled', e.target.checked);
      if (!e.target.checked) clearHover();
      refreshQuickBlock(); refreshBulkBlock();
      if (currentScanner) currentScanner.schedule();
    };
    panel.querySelector('#ob-hover').onchange = (e) => { Store.setSetting('showHoverButton', e.target.checked); if (!e.target.checked) clearHover(); };
    panel.querySelector('#ob-quick').onchange = (e) => { Store.setSetting('showQuickBlock', e.target.checked); refreshQuickBlock(); };
    panel.querySelector('#ob-bulk').onchange = (e) => { Store.setSetting('showBulkBlock', e.target.checked); refreshBulkBlock(); };
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
      reader.onload = () => {
        try {
          const result = Store.importJSON(String(reader.result));
          refresh(); refreshQuickBlock(); refreshBulkBlock();
          if (currentScanner) currentScanner.schedule();
          showToast('导入完成：新增 ' + result.identities + ' 个身份' + (result.skipped ? '，跳过 ' + result.skipped + ' 条无效记录' : ''));
        } catch (e) { alert('导入失败：' + e.message); }
        file.value = '';
      };
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
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.id = 'ob-gear';
      gear.textContent = '⚙';
      gear.title = '本地内容过滤增强 · 设置';
      gear.setAttribute('aria-label', '打开 OmniBlock 设置');
      gear.onclick = () => openOptions();
      document.body.appendChild(gear);
    })();
  }

  // 暴露调试接口
  window.OB = {
    Store, Index, openOptions, adapters: Adapters, collectUsers, identifyFromAnchor,
    setupQuickBlock: refreshQuickBlock, refreshBulk: refreshBulkBlock,
  };
})();

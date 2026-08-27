// ==UserScript==
// @name          本地内容过滤增强
// @namespace     https://github.com/a2787/ub-utils
// @version       0.43.0
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
// @connect       api.bilibili.com
// @run-at        document-start
// @sandbox       raw
// @updateURL     https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js
// @downloadURL   https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js
// @license       GPL-3.0-only
// @author        vibeme（含 PAKKU GPLv3 与 Pynseq MIT 来源代码，详见 README）
// ==/UserScript==

/*
 * OmniBlock —— 跨平台本地黑名单
 * Copyright (C) 2026 vibeme
 * SPDX-License-Identifier: GPL-3.0-only
 * --------------------------------------------------------------------------
 * 设计要点（详见项目计划文档）：
 *  - 一份共享名单（GM 单键存储），6 个平台通用；另有独立的本地快照环，可导出/恢复。
 *  - 评论/弹幕固定零占位隐藏；其他内容可折叠或完全消失；抖音推荐流可自动跳过。
 *  - 抖音推荐流：绝不写 media.muted（抖音把静音当全局偏好），改用视觉遮罩 + 自动切下一条，带四道安全阀。
 *  - 所有拉黑入口均为自建 UI，绝不触发平台原生"不感兴趣"/官方拉黑，避免污染推荐模型或被风控。
 *  - B站弹幕：拦截并主动读取 seg.so，兼容 PAKKU 的伪造 XHR 回调；按 mid_hash 过滤，并可查询 1–10 位 UID 候选。
 *  - 名单与浏览数据只在本机保存、不上传；本地快照也只写入本机 GM 存储；检查更新时请求 GitHub，主动查询 UID 候选时匿名请求 B站用户卡片接口。
 */
(function () {
  'use strict';

  // ====================================================================
  // 0. 基础工具
  // ====================================================================
  // 更新地址（与脚本头 @updateURL/@downloadURL 保持一致；用户脚本运行时无法自读元数据，故显式声明）
  const UPDATE_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';
  const DOWNLOAD_URL = UPDATE_URL;
  // 维护门禁：@version 标识发布序列，RUNTIME_BUILD 标识源码契约；两者都显示在页面上，
  // 便于在用户自己的 Tampermonkey 会话中确认“当前运行代码”确实来自本轮源码。
  const RUNTIME_BUILD = '0.43.0-douyin-danmaku-video-session-guard';
  const RUNTIME_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version)
    ? String(GM_info.script.version) : 'unknown';
  // 调试探针、浏览器扩展重放或同一文档内的手动注入可能把同一份源码执行多次。
  // 运行时必须按文档幂等：第二份不能再创建扫描器、观察器、定时器和 UI。
  // 新版本在既有页面中的生效仍以刷新/新文档为边界，符合用户脚本的正常生命周期。
  const RUNTIME_GUARD_KEY = '__OB_RUNTIME_GUARD__';
  const activeRuntime = window[RUNTIME_GUARD_KEY];
  if (activeRuntime && activeRuntime.active) {
    activeRuntime.duplicateExecutions = Number(activeRuntime.duplicateExecutions || 0) + 1;
    return;
  }
  window[RUNTIME_GUARD_KEY] = {
    active: true,
    version: RUNTIME_VERSION,
    build: RUNTIME_BUILD,
    duplicateExecutions: 0,
  };
  const RUNTIME_MARKER = `omniblock/${RUNTIME_VERSION}/${RUNTIME_BUILD}`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const textOf = (el) => (el ? (el.textContent || '').trim() : '');
  // B站评论主体在 open Shadow DOM 内，普通 textContent 不一定能穿透到正文。
  // 这里只在单条记录上读取短文本，管理器不会对整页调用，避免把 UI/平台正文带入扫描热路径。
  function deepTextOf(el, limit = 500) {
    if (!el) return '';
    const parts = [];
    const seen = new Set();
    const walk = (node) => {
      if (!node || seen.has(node) || parts.join(' ').length >= limit) return;
      seen.add(node);
      if (node.nodeType === 3) {
        const value = String(node.nodeValue || '').trim();
        if (value) parts.push(value);
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.shadowRoot) walk(node.shadowRoot);
      for (const child of node.childNodes || []) walk(child);
    };
    walk(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }
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
  // 备份使用独立键和稳定 envelope。未来同步 provider 只需消费同一快照对象，
  // 当前版本不注册任何网络 provider，也不改变主名单键的兼容格式。
  const BACKUP_STORAGE_KEY = 'omniblock:backup:v1';
  const BACKUP_FORMAT = 'omniblock.snapshot';
  const BACKUP_SCHEMA = 1;
  const BACKUP_RETENTION = 5;
  const BACKUP_RECORD_MAX_BYTES = 2 * 1024 * 1024;
  const BACKUP_TOTAL_MAX_BYTES = 4 * 1024 * 1024;

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideMode: 'collapse',        // 'collapse' | 'disappear'
    showHoverButton: true,
    douyinAutoSkip: true,
    skipCap: 6,                  // 连续跳过上限，超过则停在遮罩不再自动切
    showQuickBlock: true,        // 在平台原生"拉黑/举报"旁插入"本地拉黑"
    showBulkBlock: true,         // 本页/弹窗内"一键拉黑全部用户"
    localBackupEnabled: true,    // 自动保留最近 5 份本地快照（不上传）
  };

  const Store = (function () {
    let data = null;             // { version, persons:{}, settings:{} }
    const listeners = [];
    const persistListeners = [];
    const backupSinks = new Map();
    let backupLastRevision = 0;
    let backupError = '';

    function cleanText(value, fallback, maxLength) {
      if (value == null) return fallback;
      const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
      return (text || fallback).slice(0, maxLength);
    }

    function sanitizeSettings(input) {
      const source = input && typeof input === 'object' ? input : {};
      const out = { ...DEFAULT_SETTINGS };
      for (const key of ['enabled', 'showHoverButton', 'douyinAutoSkip', 'showQuickBlock', 'showBulkBlock', 'localBackupEnabled']) {
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

    function snapshotObject(reason, source = 'local') {
      const now = Date.now();
      let knownRevision = backupLastRevision;
      try {
        for (const record of readBackupRecords()) knownRevision = Math.max(knownRevision, record.revision);
      } catch (e) {}
      const revision = Math.max(now, knownRevision + 1);
      backupLastRevision = revision;
      return {
        format: BACKUP_FORMAT,
        schema: BACKUP_SCHEMA,
        snapshotId: 's_' + revision.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        revision,
        exportedAt: now,
        source,
        reason: reason || 'manual',
        version: 1,
        persons: sanitizePersons(persons()),
        settings: sanitizeSettings(settings()),
      };
    }

    function snapshotFingerprint(snapshot) {
      return JSON.stringify({
        persons: sanitizePersons(snapshot.persons),
        settings: sanitizeSettings(snapshot.settings),
      });
    }

    function currentStateFingerprint() {
      return JSON.stringify({
        persons: sanitizePersons(persons()),
        settings: sanitizeSettings(settings()),
      });
    }

    function normalizeSnapshot(input) {
      const raw = input && input.state && typeof input.state === 'object'
        ? { ...input, ...input.state }
        : input;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.persons || typeof raw.persons !== 'object' || Array.isArray(raw.persons)) return null;
      // 允许旧版手动导出（没有 format/schema），但拒绝明确声明的未知协议，
      // 避免未来云端数据被静默当成当前 schema 解释。
      if (raw.format != null && raw.format !== BACKUP_FORMAT) return null;
      if (raw.schema != null && Number(raw.schema) !== BACKUP_SCHEMA) return null;
      const exportedAt = Number(raw.exportedAt);
      const revision = Number(raw.revision);
      return {
        format: BACKUP_FORMAT,
        schema: BACKUP_SCHEMA,
        snapshotId: cleanText(raw.snapshotId, '', 120) || ('s_' + (Number.isFinite(revision) && revision >= 0 ? Math.round(revision) : Date.now()).toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
        revision: Number.isFinite(revision) && revision >= 0 ? Math.round(revision) : (Number.isFinite(exportedAt) ? Math.round(exportedAt) : Date.now()),
        exportedAt: Number.isFinite(exportedAt) && exportedAt >= 0 ? Math.round(exportedAt) : Date.now(),
        source: cleanText(raw.source, 'local', 40),
        reason: cleanText(raw.reason, 'import', 80),
        version: 1,
        persons: sanitizePersons(raw.persons),
        settings: sanitizeSettings(raw.settings),
      };
    }

    function readBackupRecords() {
      let raw;
      try { raw = GM_getValue(BACKUP_STORAGE_KEY, null); } catch (e) { raw = null; }
      if (raw && typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = null; }
      }
      const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.snapshots) ? raw.snapshots : []);
      return list.map(normalizeSnapshot).filter(Boolean).sort((a, b) => b.revision - a.revision).slice(0, BACKUP_RETENTION);
    }

    function writeBackupRecords(records) {
      const payload = JSON.stringify({ format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, snapshots: records });
      if (payload.length > BACKUP_TOTAL_MAX_BYTES) {
        backupError = '本地快照超出存储上限';
        return false;
      }
      try {
        GM_setValue(BACKUP_STORAGE_KEY, payload);
        backupError = '';
        return true;
      } catch (e) {
        backupError = '本地快照写入失败';
        return false;
      }
    }

    function notifyBackupSinks(snapshot) {
      // provider 是故意窄化的未来扩展点：同步实现自行处理认证、加密、冲突和网络，
      // Store 只提供规范化快照，不替任何 provider 上传名单。
      for (const registration of backupSinks.values()) {
        try { registration.sink.onSnapshot(JSON.parse(JSON.stringify(snapshot))); } catch (e) {}
      }
    }

    function captureBackup(snapshot, reason, force = false) {
      const normalized = normalizeSnapshot({ ...snapshot, reason: reason || snapshot.reason || 'change' });
      if (!normalized || (!force && !getSetting('localBackupEnabled'))) return false;
      const serialized = JSON.stringify(normalized);
      if (serialized.length > BACKUP_RECORD_MAX_BYTES) {
        backupError = '本地快照过大，已保留旧快照';
        return false;
      }
      const records = readBackupRecords();
      const fingerprint = snapshotFingerprint(normalized);
      // 只跳过与当前最新快照完全相同的重复写入；历史上再次出现同一状态时仍要留下
      // 新的时间点，保证“恢复上一份”在恢复操作后有可逆路径。
      if (records[0] && snapshotFingerprint(records[0]) === fingerprint) return false;
      records.unshift(normalized);
      while (records.length > BACKUP_RETENTION || JSON.stringify({ format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, snapshots: records }).length > BACKUP_TOTAL_MAX_BYTES) records.pop();
      return writeBackupRecords(records);
    }

    function persist(reason) {
      try { GM_setValue(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* 配额/隐私模式 */ }
      const snapshot = snapshotObject(reason || 'change');
      captureBackup(snapshot, reason || 'change');
      notifyBackupSinks(snapshot);
      listeners.forEach((fn) => { try { fn(); } catch (e) {} });
      persistListeners.forEach((fn) => { try { fn(snapshot); } catch (e) {} });
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

    function confirmIdentityLink(keys, label, note) {
      load();
      const normalized = normalizeIdentityKeys(keys);
      if (!normalized.length) return { person: null, personId: '', added: 0, addedKeys: [], rejected: true, undo: null };
      const pset = persons();
      const existingKeys = allIdentities();
      let targetId = Object.keys(pset).find((id) => normalized.some((key) => pset[id].identities.includes(key))) || '';
      const created = !targetId;
      if (created) {
        targetId = genId();
        while (pset[targetId]) targetId = genId();
        pset[targetId] = { label: '未命名', note: '', createdAt: Date.now(), hits: 0, identities: [] };
      }
      const target = pset[targetId];
      const previous = { label: target.label, note: target.note };
      const addedKeys = [];
      for (const key of normalized) {
        // 已属于另一人物的身份保持原归属；确认关联不能偷偷合并两个既有人物。
        if (existingKeys.has(key)) continue;
        target.identities.push(key);
        addedKeys.push(key);
      }
      const nextLabel = cleanText(label, target.label || '未命名', 200);
      const nextNote = cleanText(note, target.note || '', 2000);
      const metadataChanged = nextLabel !== target.label || nextNote !== target.note;
      target.label = nextLabel;
      target.note = nextNote;
      const changed = created || addedKeys.length > 0 || metadataChanged;
      if (changed) persist();
      const committed = { label: nextLabel, note: nextNote };
      const undo = changed ? () => {
        load();
        const current = persons()[targetId];
        if (!current) return;
        current.identities = current.identities.filter((key) => !addedKeys.includes(key));
        if (created && !current.identities.length) delete persons()[targetId];
        else {
          if (current.label === committed.label) current.label = previous.label;
          if (current.note === committed.note) current.note = previous.note;
          if (!current.identities.length) delete persons()[targetId];
        }
        persist();
      } : null;
      return { person: target, personId: targetId, added: addedKeys.length, addedKeys, rejected: false, undo };
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
      // 手动文件仍保持 v1 的公开格式；内部快照 envelope 只用于本机环和 provider 边界。
      return JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        persons: sanitizePersons(persons()),
        settings: sanitizeSettings(settings()),
      }, null, 2);
    }

    function importJSON(text) {
      const obj = JSON.parse(text);
      const source = obj && obj.state && typeof obj.state === 'object' ? { ...obj, ...obj.state } : obj;
      if (!source || typeof source !== 'object' || !source.persons || typeof source.persons !== 'object' || Array.isArray(source.persons)) {
        throw new Error('格式不正确：缺少 persons');
      }
      if (source.format != null && source.format !== BACKUP_FORMAT) throw new Error('不支持的快照格式');
      if (source.schema != null && Number(source.schema) !== BACKUP_SCHEMA) throw new Error('不支持的快照版本');
      load();
      const result = { persons: 0, identities: 0, skipped: 0 };
      for (const id of Object.keys(source.persons)) {
        const person = source.persons[id];
        if (!person || !Array.isArray(person.identities)) { result.skipped++; continue; }
        const before = Object.keys(persons()).length;
        const added = addIdentitiesInternal(person.identities, person.label, person.note, person);
        if (added.rejected) { result.skipped++; continue; }
        if (Object.keys(persons()).length > before) result.persons++;
        result.identities += added.added;
      }
      if (source.settings && typeof source.settings === 'object') data.settings = sanitizeSettings({ ...data.settings, ...source.settings });
      persist();
      return result;
    }

    function listBackups() {
      return readBackupRecords().map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        revision: snapshot.revision,
        exportedAt: snapshot.exportedAt,
        source: snapshot.source,
        reason: snapshot.reason,
        persons: Object.keys(snapshot.persons).length,
        identities: Object.values(snapshot.persons).reduce((sum, person) => sum + person.identities.length, 0),
      }));
    }

    function backupStatus() {
      const records = readBackupRecords();
      return {
        enabled: !!getSetting('localBackupEnabled'),
        count: records.length,
        retention: BACKUP_RETENTION,
        latestAt: records[0] ? records[0].exportedAt : 0,
        error: backupError,
        format: BACKUP_FORMAT,
        schema: BACKUP_SCHEMA,
      };
    }

    function ensureLocalBackup() {
      if (!getSetting('localBackupEnabled')) return backupStatus();
      const records = readBackupRecords();
      if (!records.length) {
        const snapshot = snapshotObject('initial');
        captureBackup(snapshot, 'initial');
      }
      return backupStatus();
    }

    function preserveRestoreCheckpoint() {
      const current = currentStateFingerprint();
      const records = readBackupRecords();
      const alreadySaved = !!(records[0] && snapshotFingerprint(records[0]) === current);
      if (alreadySaved) return true;
      return captureBackup(snapshotObject('pre-restore'), 'pre-restore', true);
    }

    function restoreBackup(snapshotId) {
      const target = readBackupRecords().find((snapshot) => snapshot.snapshotId === snapshotId);
      if (!target) throw new Error('找不到本地快照');
      // 显式恢复是用户动作，即使自动快照当前关闭，也先保留当前状态，保证误恢复可回退。
      if (!preserveRestoreCheckpoint()) throw new Error('无法保留当前状态，已取消恢复');
      data = { version: 1, persons: sanitizePersons(target.persons), settings: sanitizeSettings(target.settings) };
      persist('restore');
      return { snapshotId: target.snapshotId, persons: Object.keys(data.persons).length, identities: allIdentities().size };
    }

    function restorePreviousBackup() {
      const records = readBackupRecords();
      const target = records[1] || records[0];
      if (!target) throw new Error('暂无本地快照');
      // 正常写入会先有“当前”快照，上一份是 records[1]；如果最近一次写入被
      // 关闭开关或存储配额阻断，当前状态不在环里，此时应恢复 records[0]。
      const latest = records[0];
      const current = currentStateFingerprint();
      const previous = latest && snapshotFingerprint(latest) !== current ? latest : (records[1] || latest);
      return restoreBackup((previous || target).snapshotId);
    }

    function registerBackupSink(name, sink) {
      const id = cleanText(name, '', 80);
      if (!id || !sink || typeof sink.onSnapshot !== 'function') throw new Error('备份 provider 不完整');
      const registration = { sink };
      backupSinks.set(id, registration);
      return () => {
        if (backupSinks.get(id) === registration) backupSinks.delete(id);
      };
    }

    function onPersist(fn) {
      if (typeof fn === 'function') persistListeners.push(fn);
      return () => {
        const index = persistListeners.indexOf(fn);
        if (index >= 0) persistListeners.splice(index, 1);
      };
    }

    // 跨标签页/设置变更的监听
    try {
      GM_addValueChangeListener(STORAGE_KEY, () => {
        data = null;
        load();
        const snapshot = snapshotObject('external-change', 'local');
        captureBackup(snapshot, 'external-change');
        notifyBackupSinks(snapshot);
        listeners.forEach((fn) => { try { fn(); } catch (e) {} });
        persistListeners.forEach((fn) => { try { fn(snapshot); } catch (e) {} });
      });
    } catch (e) { /* 不支持则忽略 */ }

    function onChange(fn) { listeners.push(fn); }

    return {
      persons, settings, setSetting, getSetting, addIdentities, addIdentityGroups, removePerson,
      confirmIdentityLink, removeIdentity, removeIdentities, allIdentities, exportJSON, importJSON, onChange,
      onPersist, registerBackupSink, listBackups, backupStatus, ensureLocalBackup, restoreBackup, restorePreviousBackup,
      backupFormat: BACKUP_FORMAT, backupSchema: BACKUP_SCHEMA,
    };
  })();

  // 首次加载即建立一个恢复点；没有本地备份开关或 GM 存储支持时静默降级，不影响名单。
  try { Store.ensureLocalBackup(); } catch (e) {}

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
    /* 微博虚拟列表的行包装器有时保留固定高度/内边距；包装器只有在不含可见兄弟内容时
       才会被脚本标记，因此这里可以安全地把它压成真正的零高度，确保下一条评论补位。 */
    .ob-blocked-wrapper { box-sizing: border-box !important; min-height: 0 !important; height: 0 !important; max-height: 0 !important; flex-basis: 0 !important; padding: 0 !important; margin: 0 !important; border-width: 0 !important; overflow: hidden !important; }

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

    /* 抖音弹幕跟随浮层：挂在弹幕节点内，随滚动弹幕一起移动 */
    .ob-dy-dm-block {
      position: absolute !important; left: 6px !important; top: 50% !important;
      transform: translate(-100%, -50%) !important;
      z-index: 2147483646 !important; height: 20px; line-height: 20px; padding: 0 7px;
      background: rgba(28, 28, 28, 0.92) !important; color: #fff !important;
      border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
      pointer-events: auto !important;
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35); user-select: none;
    }
    .ob-dy-dm-block:hover { background: #a93226 !important; }

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
    .ob-bulk[data-ob-douyin-toolbar="1"] {
      box-sizing: border-box; min-height: 34px; max-width: min(260px, calc(100vw - 28px));
      margin: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* 批量拉黑的范围/时间筛选面板 */
    #ob-bulk-scope {
      position: fixed; z-index: 2147483647; width: 288px; box-sizing: border-box;
      background: #fff; color: #222; border: 1px solid #ddd; border-radius: 8px;
      box-shadow: 0 8px 26px rgba(0,0,0,.18); padding: 12px; font-size: 13px; line-height: 1.5;
    }
    #ob-bulk-scope .ob-bs-title { font-weight: 600; margin-bottom: 8px; }
    #ob-bulk-scope fieldset { border: 0; margin: 0 0 8px; padding: 0; display: grid; gap: 4px; }
    #ob-bulk-scope legend { padding: 0; margin-bottom: 2px; color: #666; font-size: 12px; }
    #ob-bulk-scope label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    #ob-bulk-scope select, #ob-bulk-scope input[type="datetime-local"] {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12px;
      padding: 4px 6px; border: 1px solid #ccc; border-radius: 5px; background: #fff; color: #222;
    }
    #ob-bulk-scope .ob-bs-status { color: #666; font-size: 12px; margin: 6px 0 8px; min-height: 18px; word-break: break-all; }
    #ob-bulk-scope .ob-bs-row { display: flex; gap: 8px; }
    #ob-bulk-scope .ob-bs-row button { flex: 1; border: 0; border-radius: 6px; padding: 7px 0; cursor: pointer; font-size: 13px; }
    #ob-bulk-scope .ob-bs-ok { background: #c0392b; color: #fff; }
    #ob-bulk-scope .ob-bs-ok:disabled { background: #e0b3ad; cursor: default; }
    #ob-bulk-scope .ob-bs-no { background: #eee; color: #444; }
    @media (max-width: 640px) {
      #ob-bulk-scope { width: calc(100vw - 24px); left: 12px !important; right: 12px; }
    }
    /* 微博当前详情页评论操作区内的常驻入口。 */
    .ob-weibo-comment-block {
      flex: 0 0 auto !important; box-sizing: border-box !important; min-height: 22px !important;
      border: 1px solid #e2a39c !important; border-radius: 4px !important; padding: 1px 6px !important;
      background: transparent !important; color: #c0392b !important; font-size: 11px !important;
      line-height: 18px !important; white-space: nowrap !important; cursor: pointer !important;
    }
    .ob-weibo-comment-block:hover { background: #fdeceb !important; }
    .ob-weibo-thread-block {
      flex: 0 0 auto !important; box-sizing: border-box !important; min-height: 22px !important;
      border: 1px solid #e2a39c !important; border-radius: 4px !important; padding: 1px 6px !important;
      background: transparent !important; color: #a93226 !important; font-size: 11px !important;
      line-height: 18px !important; white-space: nowrap !important; cursor: pointer !important;
    }
    .ob-weibo-thread-block:hover { background: #fdeceb !important; }
    /* 微博帖子作者与 B站视频/动态作者的常驻拉黑入口。 */
    .ob-weibo-author-block, .ob-bili-author-block {
      flex: 0 0 auto !important; box-sizing: border-box !important; min-height: 20px !important;
      border: 1px solid #e2a39c !important; border-radius: 4px !important; padding: 1px 7px !important;
      background: rgba(255, 255, 255, 0.94) !important; color: #c0392b !important; font-size: 11px !important;
      line-height: 18px !important; white-space: nowrap !important; cursor: pointer !important;
      margin-left: 8px !important; vertical-align: middle !important;
    }
    .ob-weibo-author-block:hover, .ob-bili-author-block:hover { background: #fdeceb !important; }
    /* 微博无限流帖子也由回收器管理；作者入口不能插入 article/header 的 Vue 布局树，
       否则回收行会被重新测量。门户只挂在 body 上，再按作者链接的视口坐标定位。 */
    .ob-weibo-author-portal {
      position: fixed !important; z-index: 2147483645 !important; pointer-events: none !important;
      display: block !important; width: max-content !important; height: max-content !important;
    }
    .ob-weibo-author-portal > .ob-weibo-author-block {
      pointer-events: auto !important; margin-left: 0 !important; display: block !important;
    }
    /* B站页面主体由 Vue 管理，作者按钮不能作为其子节点插入；门户只挂在 body 上，
       再用 fixed 定位贴到作者链接旁，避免破坏 Vue 的虚拟 DOM。 */
    .ob-bili-author-portal {
      position: fixed !important; z-index: 2147483645 !important; pointer-events: none !important;
      display: block !important; width: max-content !important; height: max-content !important;
    }
    .ob-bili-author-portal > .ob-bili-author-block { pointer-events: auto !important; margin-left: 0 !important; display: block !important; }
    /* B站右侧弹幕列表里的本地发送者屏蔽入口 */
    .ob-dm-block {
      flex: 0 0 auto !important; margin-left: 8px !important; padding: 2px 6px !important;
      border: 1px solid #e89a91 !important; border-radius: 4px !important; background: #fff !important;
      color: #c0392b !important; font-size: 11px !important; line-height: 18px !important; cursor: pointer !important;
    }
    .ob-dm-block:hover { background: #fdeceb !important; }
    .ob-dm-block:disabled { border-color: #d8d8d8 !important; color: #999 !important; background: #f5f5f5 !important; cursor: wait !important; }
    [data-ob-dm-action="1"] {
      position: relative !important; box-sizing: border-box !important; padding-right: 76px !important;
    }
    [data-ob-dm-action="1"] > .ob-dm-block {
      position: absolute !important; right: 4px !important; top: 50% !important;
      transform: translateY(-50%) !important; margin: 0 !important; z-index: 1 !important;
    }
    /* 真站悬停时日期列会收起，原生“屏蔽用户”从右侧展开；把本地按钮移到释放的日期槽，
       避免两个操作入口互相盖住。偏移来自 2026-08-22 真站 350px 行捕获。 */
    [data-ob-dm-action="1"]:hover > .ob-dm-block { right: 82px !important; }
    [data-ob-dm-blocked="1"] { display: none !important; }

    /* 播放器内浮动弹幕的坐标命中拉黑按钮。真实弹幕层是 pointer-events:none，
       所以按钮必须是我们自己的浮层，跟随指针显示。 */
    #ob-dm-pick {
      position: fixed !important; z-index: 2147483646 !important; box-sizing: border-box !important;
      border: 0 !important; border-radius: 4px !important; padding: 3px 8px !important;
      background: rgba(43,43,50,.94) !important; color: #fff !important; font-size: 12px !important;
      line-height: 18px !important; white-space: nowrap !important; cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(0,0,0,.35) !important; pointer-events: auto !important;
    }
    #ob-dm-pick:hover { background: rgba(192,57,43,.96) !important; }

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
      width: 100vw; max-width: 100vw; min-width: 0; overflow: hidden; background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-dm-manager .ob-dm-box {
      box-sizing: border-box; width: min(720px, 94vw); max-width: 100%; min-width: 0; max-height: 86vh; display: flex; flex-direction: column;
      overflow-x: hidden;
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
    #ob-dm-manager .ob-dm-retry {
      flex: 0 0 auto; min-height: 34px; border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px;
      background: #fff; color: #333; cursor: pointer; font-size: 12px;
    }
    #ob-dm-manager .ob-dm-retry:hover:not(:disabled) { background: #f4f4f4; }
    #ob-dm-manager .ob-dm-retry:disabled { color: #aaa; cursor: default; }
    #ob-dm-manager .ob-dm-checkall { display: inline-flex; align-items: center; white-space: nowrap; }
    #ob-dm-manager input[type="checkbox"] { width: auto; margin: 0 6px 0 0; }
    #ob-dm-manager .ob-dm-list { min-height: 120px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
    #ob-dm-manager .ob-dm-empty {
      box-sizing: border-box; min-height: 120px; display: flex; align-items: center; justify-content: center;
      padding: 20px; color: #777; text-align: center;
    }
    #ob-dm-manager .ob-dm-sender {
      box-sizing: border-box; min-height: 52px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f0f0f0;
    }
    #ob-dm-manager .ob-dm-sender:last-child { border-bottom: 0; }
    #ob-dm-manager .ob-dm-content { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-dm-manager .ob-dm-meta { color: #888; font-size: 11px; margin-top: 2px; }
    #ob-dm-manager .ob-dm-actions { display: inline-flex; align-items: center; gap: 2px; }
    #ob-dm-manager .ob-dm-uid-query {
      min-width: 42px; height: 32px; border: 0; border-radius: 4px; padding: 0 5px; background: transparent;
      color: #555; cursor: pointer; font-size: 11px; white-space: nowrap;
    }
    #ob-dm-manager .ob-dm-uid-query:hover:not(:disabled) { background: #f1f1f1; }
    #ob-dm-manager .ob-dm-uid-query:disabled { color: #aaa; cursor: default; }
    #ob-dm-manager .ob-dm-single {
      width: 32px; height: 32px; border: 0; border-radius: 4px; padding: 0; background: transparent;
      color: #c0392b; cursor: pointer; font-size: 15px;
    }
    #ob-dm-manager .ob-dm-single:hover { background: #fdeceb; }
    #ob-dm-manager .ob-dm-uid-results {
      grid-column: 2 / -1; min-width: 0; display: grid; gap: 6px; padding: 6px 0 2px;
      color: #555; font-size: 11px;
    }
    #ob-dm-manager .ob-dm-uid-warning { color: #8a5b00; line-height: 1.45; }
    #ob-dm-manager .ob-dm-uid-hash { display: grid; gap: 4px; }
    #ob-dm-manager .ob-dm-uid-hash-label { color: #777; word-break: break-all; }
    #ob-dm-manager .ob-dm-uid-candidate {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0;
      padding: 5px 7px; border-left: 2px solid #d8d8dc; background: #f7f7f8;
    }
    #ob-dm-manager .ob-dm-uid-candidate span { min-width: 0; overflow-wrap: anywhere; }
    #ob-dm-manager .ob-dm-uid-candidate a { color: #1769aa; text-decoration: none; }
    #ob-dm-manager .ob-dm-uid-candidate a:hover { text-decoration: underline; }
    #ob-dm-manager .ob-dm-uid-link {
      flex: 0 0 auto; min-height: 28px; border: 1px solid #e2a39c; border-radius: 4px; padding: 3px 7px;
      background: #fff; color: #c0392b; cursor: pointer; font-size: 11px; white-space: nowrap;
    }
    #ob-dm-manager .ob-dm-uid-link:hover { background: #fdeceb; }
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
    #ob-douyin-comment-manager {
      position: fixed; inset: 0; z-index: 2147483644; display: flex; align-items: center; justify-content: center;
      width: 100vw; max-width: 100vw; min-width: 0; overflow: hidden; background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-douyin-comment-manager .ob-dc-box {
      box-sizing: border-box; width: min(680px, 94vw); max-width: 100%; min-width: 0; max-height: 86vh;
      display: flex; flex-direction: column; overflow: hidden; border-radius: 8px; padding: 16px;
      background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.24);
    }
    #ob-douyin-comment-manager .ob-dc-head, #ob-douyin-comment-manager .ob-dc-toolbar,
    #ob-douyin-comment-manager .ob-dc-footer { display: flex; align-items: center; gap: 8px; }
    #ob-douyin-comment-manager .ob-dc-head { justify-content: space-between; margin-bottom: 10px; }
    #ob-douyin-comment-manager h2 { margin: 0; font-size: 16px; }
    #ob-douyin-comment-manager .ob-dc-close { width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: #555; cursor: pointer; font-size: 18px; }
    #ob-douyin-comment-manager .ob-dc-close:hover { background: #f1f1f1; }
    #ob-douyin-comment-manager .ob-dc-toolbar { flex-wrap: wrap; margin-bottom: 10px; }
    #ob-douyin-comment-manager .ob-dc-search {
      flex: 1 1 220px; min-width: 0; box-sizing: border-box; height: 34px; border: 1px solid #ccc;
      border-radius: 6px; padding: 6px 8px; color: #222; background: #fff; font-size: 13px;
    }
    #ob-douyin-comment-manager .ob-dc-expand, #ob-douyin-comment-manager .ob-dc-load,
    #ob-douyin-comment-manager .ob-dc-retry {
      min-height: 34px; border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px; background: #fff; color: #333; cursor: pointer; font-size: 12px;
    }
    #ob-douyin-comment-manager .ob-dc-expand:hover:not(:disabled), #ob-douyin-comment-manager .ob-dc-load:hover:not(:disabled),
    #ob-douyin-comment-manager .ob-dc-retry:hover:not(:disabled) { background: #f4f4f4; }
    #ob-douyin-comment-manager button:disabled { color: #aaa; cursor: default; }
    #ob-douyin-comment-manager .ob-dc-checkall { display: inline-flex; align-items: center; white-space: nowrap; }
    #ob-douyin-comment-manager input[type="checkbox"] { width: auto; margin: 0 6px 0 0; }
    #ob-douyin-comment-manager .ob-dc-status { width: 100%; min-height: 18px; color: #777; font-size: 12px; word-break: break-word; }
    #ob-douyin-comment-manager .ob-dc-list { min-height: 120px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
    #ob-douyin-comment-manager .ob-dc-empty { min-height: 120px; display: flex; align-items: center; justify-content: center; padding: 20px; color: #777; text-align: center; }
    #ob-douyin-comment-manager .ob-dc-row { min-height: 48px; display: grid; grid-template-columns: auto minmax(0,1fr); align-items: start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
    #ob-douyin-comment-manager .ob-dc-row:last-child { border-bottom: 0; }
    #ob-douyin-comment-manager .ob-dc-name { min-width: 0; color: #333; font-weight: 600; }
    #ob-douyin-comment-manager .ob-dc-note { min-width: 0; margin-top: 3px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-douyin-comment-manager .ob-dc-footer { justify-content: space-between; flex-wrap: wrap; padding-top: 10px; }
    #ob-douyin-comment-manager .ob-dc-batch { min-height: 34px; border: 0; border-radius: 6px; padding: 7px 12px; background: #c0392b; color: #fff; cursor: pointer; font-size: 12px; }
    #ob-douyin-comment-manager .ob-dc-batch:hover:not(:disabled) { background: #a93226; }
    #ob-douyin-comment-manager .ob-dc-batch:disabled { background: #ccc; }

    /* 三个平台统一的评论作者管理器；平台评论 DOM 不会放在这个脚本自有面板里。 */
    #ob-comment-manager {
      position: fixed; inset: 0; z-index: 2147483644; display: flex; align-items: center; justify-content: center;
      width: 100vw; max-width: 100vw; min-width: 0; overflow: hidden; background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-comment-manager .ob-cm-box {
      box-sizing: border-box; width: min(760px, 94vw); max-width: 100%; min-width: 0; max-height: 86vh;
      display: flex; flex-direction: column; overflow: hidden; border-radius: 8px; padding: 16px;
      background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.24);
    }
    #ob-comment-manager .ob-cm-head, #ob-comment-manager .ob-cm-toolbar, #ob-comment-manager .ob-cm-footer {
      display: flex; align-items: center; gap: 8px;
    }
    #ob-comment-manager .ob-cm-head { justify-content: space-between; margin-bottom: 10px; }
    #ob-comment-manager h2 { margin: 0; font-size: 16px; }
    #ob-comment-manager .ob-cm-close {
      width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: #555;
      cursor: pointer; font-size: 18px; line-height: 32px; padding: 0;
    }
    #ob-comment-manager .ob-cm-close:hover { background: #f1f1f1; }
    #ob-comment-manager .ob-cm-toolbar { flex-wrap: wrap; margin-bottom: 10px; }
    #ob-comment-manager .ob-cm-search {
      flex: 1 1 260px; min-width: 0; box-sizing: border-box; height: 34px; border: 1px solid #ccc;
      border-radius: 6px; padding: 6px 8px; color: #222; background: #fff; font-size: 13px;
    }
    #ob-comment-manager .ob-cm-refresh, #ob-comment-manager .ob-cm-load-all {
      flex: 0 0 auto; min-height: 34px; border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px;
      background: #fff; color: #333; cursor: pointer; font-size: 12px; white-space: nowrap;
    }
    #ob-comment-manager .ob-cm-refresh:hover:not(:disabled), #ob-comment-manager .ob-cm-load-all:hover:not(:disabled) { background: #f4f4f4; }
    #ob-comment-manager button:disabled { color: #aaa; cursor: default; }
    #ob-comment-manager .ob-cm-since-wrap { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: #666; }
    #ob-comment-manager .ob-cm-since { height: 34px; border: 1px solid #ccc; border-radius: 6px; padding: 4px 6px; background: #fff; color: #333; font-size: 12px; }
    #ob-comment-manager .ob-cm-checkall { display: inline-flex; align-items: center; white-space: nowrap; }
    #ob-comment-manager input[type="checkbox"] { width: auto; margin: 0 6px 0 0; }
    #ob-comment-manager .ob-cm-status { width: 100%; min-height: 18px; color: #777; font-size: 12px; word-break: break-word; }
    #ob-comment-manager .ob-cm-list { min-height: 120px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
    #ob-comment-manager .ob-cm-empty { min-height: 120px; display: flex; align-items: center; justify-content: center; padding: 20px; color: #777; text-align: center; }
    #ob-comment-manager .ob-cm-row {
      min-height: 58px; display: grid; grid-template-columns: auto minmax(0,1fr); align-items: start; gap: 8px;
      padding: 8px 4px; border-bottom: 1px solid #f0f0f0; cursor: pointer;
    }
    #ob-comment-manager .ob-cm-row:last-child { border-bottom: 0; }
    #ob-comment-manager .ob-cm-body { min-width: 0; }
    #ob-comment-manager .ob-cm-name { min-width: 0; color: #333; font-weight: 600; overflow-wrap: anywhere; }
    #ob-comment-manager .ob-cm-meta { margin-top: 2px; color: #888; font-size: 11px; }
    #ob-comment-manager .ob-cm-note { min-width: 0; margin-top: 3px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-comment-manager .ob-cm-footer { justify-content: space-between; flex-wrap: wrap; padding-top: 10px; }
    #ob-comment-manager .ob-cm-count { color: #777; }
    #ob-comment-manager .ob-cm-batch { min-height: 34px; border: 0; border-radius: 6px; padding: 7px 12px; background: #c0392b; color: #fff; cursor: pointer; font-size: 12px; }
    #ob-comment-manager .ob-cm-batch:hover:not(:disabled) { background: #a93226; }
    #ob-comment-manager .ob-cm-batch:disabled { background: #ccc; }

    /* 抖音视频页弹幕发送者管理工具：与 B 站右下角工具保持同样的多选交互，
       数据只来自当前视频已观察到且带可靠身份的网页弹幕节点。 */
    #ob-douyin-dm-tool {
      position: fixed; right: 14px; bottom: 62px; z-index: 2147483643;
      box-sizing: border-box; min-height: 34px; max-width: min(240px, calc(100vw - 28px));
      border: 0; border-radius: 6px; padding: 7px 10px; background: #2b2b32; color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.3); cursor: pointer; font-size: 12px; line-height: 20px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #ob-douyin-dm-tool:hover { background: #41414a; }
    #ob-douyin-dm-manager {
      position: fixed; inset: 0; z-index: 2147483644; display: flex; align-items: center; justify-content: center;
      width: 100vw; max-width: 100vw; min-width: 0; overflow: hidden; background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-douyin-dm-manager .ob-dd-box {
      box-sizing: border-box; width: min(680px, 94vw); max-width: 100%; min-width: 0; max-height: 86vh;
      display: flex; flex-direction: column; overflow: hidden; border-radius: 8px; padding: 16px;
      background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.24);
    }
    #ob-douyin-dm-manager .ob-dd-head, #ob-douyin-dm-manager .ob-dd-toolbar,
    #ob-douyin-dm-manager .ob-dd-footer { display: flex; align-items: center; gap: 8px; }
    #ob-douyin-dm-manager .ob-dd-head { justify-content: space-between; margin-bottom: 10px; }
    #ob-douyin-dm-manager h2 { margin: 0; font-size: 16px; }
    #ob-douyin-dm-manager .ob-dd-close { width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: #555; cursor: pointer; font-size: 18px; }
    #ob-douyin-dm-manager .ob-dd-close:hover { background: #f1f1f1; }
    #ob-douyin-dm-manager .ob-dd-toolbar { flex-wrap: wrap; margin-bottom: 10px; }
    #ob-douyin-dm-manager .ob-dd-search {
      flex: 1 1 220px; min-width: 0; box-sizing: border-box; height: 34px; border: 1px solid #ccc;
      border-radius: 6px; padding: 6px 8px; color: #222; background: #fff; font-size: 13px;
    }
    #ob-douyin-dm-manager .ob-dd-scan {
      flex: 0 0 auto; min-height: 34px; border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px;
      background: #fff; color: #333; cursor: pointer; font-size: 12px; white-space: nowrap;
    }
    #ob-douyin-dm-manager .ob-dd-scan:hover:not(:disabled) { background: #f4f4f4; }
    #ob-douyin-dm-manager .ob-dd-scan:disabled { color: #aaa; cursor: default; }
    #ob-douyin-dm-manager .ob-dd-checkall { display: inline-flex; align-items: center; white-space: nowrap; }
    #ob-douyin-dm-manager input[type="checkbox"] { width: auto; margin: 0 6px 0 0; }
    #ob-douyin-dm-manager .ob-dd-list { min-height: 120px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
    #ob-douyin-dm-manager .ob-dd-empty { min-height: 120px; display: flex; align-items: center; justify-content: center; padding: 20px; color: #777; text-align: center; }
    #ob-douyin-dm-manager .ob-dd-row { min-height: 52px; display: grid; grid-template-columns: auto minmax(0,1fr); align-items: start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
    #ob-douyin-dm-manager .ob-dd-row:last-child { border-bottom: 0; }
    #ob-douyin-dm-manager .ob-dd-name { min-width: 0; color: #333; font-weight: 600; overflow-wrap: anywhere; }
    #ob-douyin-dm-manager .ob-dd-note { min-width: 0; margin-top: 3px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-douyin-dm-manager .ob-dd-footer { justify-content: space-between; flex-wrap: wrap; padding-top: 10px; }
    #ob-douyin-dm-manager .ob-dd-status { color: #777; }
    #ob-douyin-dm-manager .ob-dd-batch { min-height: 34px; border: 0; border-radius: 6px; padding: 7px 12px; background: #c0392b; color: #fff; cursor: pointer; font-size: 12px; }
    #ob-douyin-dm-manager .ob-dd-batch:hover:not(:disabled) { background: #a93226; }
    #ob-douyin-dm-manager .ob-dd-batch:disabled { background: #ccc; cursor: default; }
    @media (max-width: 520px) {
      #ob-comment-manager { align-items: flex-end; }
      #ob-comment-manager .ob-cm-box { width: 100%; max-width: 100%; max-height: 88vh; border-radius: 8px 8px 0 0; }
      #ob-comment-manager .ob-cm-footer { align-items: stretch; }
      #ob-comment-manager .ob-cm-batch { flex: 1 1 100%; }
    }
    @media (max-width: 520px) {
      #ob-douyin-comment-manager { align-items: flex-end; }
      #ob-douyin-comment-manager .ob-dc-box { width: 100%; max-width: 100%; max-height: 88vh; border-radius: 8px 8px 0 0; }
      #ob-douyin-comment-manager .ob-dc-footer { align-items: stretch; }
      #ob-douyin-comment-manager .ob-dc-batch { flex: 1 1 100%; }
    }
    @media (max-width: 520px) {
      #ob-douyin-dm-manager { align-items: flex-end; }
      #ob-douyin-dm-manager .ob-dd-box { width: 100%; max-width: 100%; max-height: 88vh; border-radius: 8px 8px 0 0; }
      #ob-douyin-dm-manager .ob-dd-footer { align-items: stretch; }
      #ob-douyin-dm-manager .ob-dd-batch { flex: 1 1 100%; }
    }
    @media (max-width: 520px) {
      #ob-dm-manager { align-items: flex-end; }
      #ob-dm-manager .ob-dm-box { width: 100%; max-width: 100%; min-width: 0; max-height: 88vh; border-radius: 8px 8px 0 0; }
      #ob-dm-manager .ob-dm-sender { grid-template-columns: auto minmax(0, 1fr); }
      #ob-dm-manager .ob-dm-actions { grid-column: 2; justify-self: end; }
      #ob-dm-manager .ob-dm-uid-results { grid-column: 1 / -1; }
      #ob-dm-manager .ob-dm-uid-candidate { align-items: flex-start; flex-direction: column; }
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
    #ob-panel .ob-list { border: 1px solid #eee; border-radius: 8px; max-height: 300px; overflow: auto; }
    #ob-panel .ob-platform-group { border-bottom: 1px solid #eee; }
    #ob-panel .ob-platform-group:last-child { border-bottom: 0; }
    #ob-panel .ob-platform-title { margin: 0; padding: 7px 10px; background: #f7f7f8; color: #555; font-size: 12px; font-weight: 600; }
    #ob-panel .ob-item { display: flex; justify-content: space-between; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #f2f2f2; align-items: center; }
    #ob-panel .ob-item:last-child { border-bottom: 0; }
    #ob-panel .ob-item .ob-meta { color: #999; font-size: 11px; word-break: break-all; }
    #ob-panel .ob-item .ob-note { color: #777; font-size: 11px; margin-top: 2px; word-break: break-word; }
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
  const blockedWrapperInlineStates = new WeakMap();
  const blockedVirtualRowStates = new WeakMap();
  const virtualRowInlineStates = new WeakMap();
  const virtualListInlineStates = new WeakMap();
  const virtualListSyncStates = new WeakMap();
  const virtualRowHeightStates = new WeakMap();
  const virtualOwnRowWrites = new WeakMap();
  const virtualOwnListWrites = new WeakMap();
  const virtualOwnContentWrites = new WeakMap();
  const runtimeDiagnostics = window.__OB_PROBE_DIAGNOSTICS__
    && window.__OB_PROBE_DIAGNOSTICS__.enabled
    ? {
      virtualSyncQueued: 0,
      virtualSyncs: 0,
      virtualSyncRowsVisited: 0,
      virtualSyncLayoutReads: 0,
      virtualSyncStyleWrites: 0,
      virtualObserverRecords: 0,
      virtualObserverIgnored: 0,
      virtualRowPlatformMutations: 0,
      virtualListOwnWritesIgnored: 0,
      virtualRowOwnWritesIgnored: 0,
      virtualContentPlatformMutations: 0,
      virtualContentOwnWritesIgnored: 0,
      virtualSyncThrottled: 0,
      virtualListObserverCallbacks: 0,
      virtualListPlatformMutations: 0,
      virtualListImmediateResyncs: 0,
      scannerOwnUiIgnored: 0,
      weiboItemsHandled: 0,
      weiboItemsMissingIdentity: 0,
      weiboBlockTransitions: 0,
      weiboUnblockTransitions: 0,
      weiboUnmarkTransitions: 0,
      virtualStaleBlockedRows: 0,
      weiboNestedVirtualRowsIgnored: 0,
      virtualListSamples: [],
      virtualLastList: null,
    } : null;
  const virtualContentOffsetStates = new WeakMap();
  const VIRTUAL_ROW_SELECTOR = '.vue-recycle-scroller__item-view';
  const MAX_VIRTUAL_ROW_HEIGHT = 20000;
  const MAX_VIRTUAL_ROW_GAP = 4096;
  const VIRTUAL_SYNC_THROTTLE_MS = 100;
  const VIRTUAL_PLATFORM_QUIET_MS = 120;
  const BLOCKED_WRAPPER_INLINE_PROPS = [
    'box-sizing', 'min-height', 'height', 'max-height', 'flex-basis',
    'padding', 'margin', 'border-width', 'overflow',
  ];
  const VIRTUAL_LIST_SIZE_PROPS = ['min-height', 'height'];

  function collapseWrapperInlineStyle(wrapper) {
    if (!wrapper || !wrapper.style) return;
    if (!blockedWrapperInlineStates.has(wrapper)) {
      const previous = {};
      for (const prop of BLOCKED_WRAPPER_INLINE_PROPS) {
        previous[prop] = {
          value: wrapper.style.getPropertyValue(prop),
          priority: wrapper.style.getPropertyPriority(prop),
        };
      }
      blockedWrapperInlineStates.set(wrapper, previous);
    }
    wrapper.style.setProperty('box-sizing', 'border-box', 'important');
    wrapper.style.setProperty('min-height', '0', 'important');
    wrapper.style.setProperty('height', '0', 'important');
    wrapper.style.setProperty('max-height', '0', 'important');
    wrapper.style.setProperty('flex-basis', '0', 'important');
    wrapper.style.setProperty('padding', '0', 'important');
    wrapper.style.setProperty('margin', '0', 'important');
    wrapper.style.setProperty('border-width', '0', 'important');
    wrapper.style.setProperty('overflow', 'hidden', 'important');
  }

  function restoreWrapperInlineStyle(wrapper) {
    if (!wrapper || !wrapper.style) return;
    const previous = blockedWrapperInlineStates.get(wrapper);
    if (!previous) return;
    for (const prop of BLOCKED_WRAPPER_INLINE_PROPS) {
      const state = previous[prop];
      if (state && state.value) wrapper.style.setProperty(prop, state.value, state.priority);
      else wrapper.style.removeProperty(prop);
    }
    blockedWrapperInlineStates.delete(wrapper);
  }

  function virtualRowOf(container) {
    if (!container || !container.closest) return null;
    return container.closest(VIRTUAL_ROW_SELECTOR);
  }

  function virtualRowListOf(row) {
    if (!row || !row.parentElement || !row.matches || !row.matches(VIRTUAL_ROW_SELECTOR)) return null;
    return row.parentElement;
  }

  function virtualDiagnostic(key, amount = 1) {
    if (runtimeDiagnostics) runtimeDiagnostics[key] = (runtimeDiagnostics[key] || 0) + amount;
  }

  // 微博回收器会给活动行和列表 spacer 回写 style。只在存在本地屏蔽行时
  // 建立专用观察器；普通评论内部的 style 变化不再进入全局扫描器。
  const pendingVirtualLists = new Set();
  let virtualSyncScheduled = false;

  function virtualListSyncState(list) {
    let state = virtualListSyncStates.get(list);
    if (state) return state;
    state = {
      blockedRows: new Set(),
      observer: null,
      observedRows: new Set(),
      pending: false,
      force: false,
      lastSyncAt: 0,
      timer: 0,
      platformTimer: 0,
      hiddenPixels: 0,
    };
    virtualListSyncStates.set(list, state);
    return state;
  }

  function virtualListHasBlockedWork(list) {
    if (!list) return false;
    const state = virtualListSyncStates.get(list);
    return !!(state && state.blockedRows.size) || virtualListInlineStates.has(list);
  }

  function registerVirtualBlockedRow(row) {
    const list = virtualRowListOf(row);
    if (!list) return;
    const state = virtualListSyncState(list);
    state.blockedRows.add(row);
    ensureVirtualListObserver(list);
  }

  function unregisterVirtualBlockedRow(row) {
    const list = virtualRowListOf(row);
    const state = list && virtualListSyncStates.get(list);
    if (state) state.blockedRows.delete(row);
  }

  function ownVirtualRowStyle(row) {
    if (!row || !row.style) return false;
    const state = virtualRowInlineStates.get(row);
    if (state && row.style.getPropertyValue('transform') === state.applied
      && row.style.getPropertyPriority('transform') === state.appliedPriority) return true;
    const write = virtualOwnRowWrites.get(row);
    if (!write) return false;
    const matches = row.style.getPropertyValue('transform') === write.value
      && row.style.getPropertyPriority('transform') === write.priority;
    if (matches) virtualOwnRowWrites.delete(row);
    return matches;
  }

  function ownVirtualListStyle(list) {
    if (!list || !list.style) return false;
    const state = virtualListInlineStates.get(list);
    if (state && list.style.getPropertyValue(state.prop) === state.appliedValue
      && list.style.getPropertyPriority(state.prop) === state.appliedPriority) return true;
    const write = virtualOwnListWrites.get(list);
    if (!write) return false;
    const matches = list.style.getPropertyValue(write.prop) === write.value
      && list.style.getPropertyPriority(write.prop) === write.priority;
    if (matches) virtualOwnListWrites.delete(list);
    return matches;
  }

  function ownVirtualContentStyle(content) {
    if (!content || !content.style) return false;
    const state = virtualContentOffsetStates.get(content);
    if (state && content.style.getPropertyValue('transform') === state.appliedValue
      && content.style.getPropertyPriority('transform') === state.appliedPriority) return true;
    const write = virtualOwnContentWrites.get(content);
    if (!write) return false;
    const matches = content.style.getPropertyValue('transform') === write.value
      && content.style.getPropertyPriority('transform') === write.priority;
    if (matches) virtualOwnContentWrites.delete(content);
    return matches;
  }

  // 当前真实结构中，只有帖子详情页把顶层评论的直接内容层放在
  // .woo-panel-main 内；用户主页的同名 wbpro-list 是整条帖子的嵌套内容，
  // 不能把它们的行回写切换为立即同步路径。
  function isWeiboDetailVirtualList(list) {
    return !!(list && list.closest && list.closest('.woo-panel-main'));
  }

  function refreshVirtualListObserver(list) {
    const state = virtualListSyncStates.get(list);
    if (!state || !state.observer || !list || !list.isConnected) return;
    state.observer.disconnect();
    state.observedRows.clear();
    state.observer.observe(list, { childList: true, attributes: true, attributeFilter: ['style'] });
    for (const row of list.children || []) {
      if (!row.matches || !row.matches(VIRTUAL_ROW_SELECTOR)) continue;
      state.observedRows.add(row);
      state.observer.observe(row, { attributes: true, attributeFilter: ['style'] });
      const content = row.firstElementChild;
      if (content && isWeiboDetailVirtualList(list)) {
        state.observer.observe(content, { attributes: true, attributeFilter: ['style'] });
      }
    }
  }

  function syncVirtualListNow(list) {
    const state = virtualListSyncStates.get(list);
    if (!state || !list || !list.isConnected) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.platformTimer) clearTimeout(state.platformTimer);
    state.timer = 0;
    state.platformTimer = 0;
    state.pending = false;
    state.force = false;
    pendingVirtualLists.delete(list);
    state.lastSyncAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    virtualDiagnostic('virtualListImmediateResyncs');
    const firstRow = Array.from(list.children || [])
      .find((child) => child.matches && child.matches(VIRTUAL_ROW_SELECTOR));
    if (firstRow) syncVirtualRowOffsets(firstRow);
    if (!virtualListHasBlockedWork(list)) detachVirtualListObserver(list);
  }

  function ensureVirtualListObserver(list) {
    if (!list || !list.isConnected) return;
    const state = virtualListSyncState(list);
    if (!state.observer && typeof MutationObserver === 'function') {
      state.observer = new MutationObserver((records) => {
        virtualDiagnostic('virtualListObserverCallbacks');
        let immediate = false;
        let deferred = false;
        for (const record of records) {
          virtualDiagnostic('virtualObserverRecords');
          if (record.type === 'childList' && record.target === list) {
            refreshVirtualListObserver(list);
            for (const row of list.children || []) {
              if (row.matches && row.matches(VIRTUAL_ROW_SELECTOR)) virtualRowHeightStates.delete(row);
            }
            for (const row of state.blockedRows) {
              if (!row.isConnected || virtualRowListOf(row) !== list || !blockedVirtualRowStates.has(row)) {
                state.blockedRows.delete(row);
              }
            }
            if (isWeiboDetailVirtualList(list)) immediate = true;
            else deferred = true;
            continue;
          }
          if (record.type !== 'attributes') continue;
          if (record.target === list) {
            if (ownVirtualListStyle(list)) {
              virtualDiagnostic('virtualObserverIgnored');
              virtualDiagnostic('virtualListOwnWritesIgnored');
            }
            else {
              virtualDiagnostic('virtualListPlatformMutations');
              if (runtimeDiagnostics && runtimeDiagnostics.virtualListSamples.length < 240) {
                const stateSnapshot = virtualListSyncStates.get(list);
                const listState = virtualListInlineStates.get(list);
                runtimeDiagnostics.virtualListSamples.push({
                  at: Math.round((performance && performance.now ? performance.now() : Date.now())),
                  current: list.style.getPropertyValue('min-height') || list.style.getPropertyValue('height'),
                  applied: listState ? listState.appliedValue : '',
                  base: listState ? listState.basePixels : 0,
                  hidden: stateSnapshot ? stateSnapshot.hiddenPixels : 0,
                });
              }
              // spacer 是平台自己的总高基线。正常补位已经在直接内容层完成，
              // 单独的 spacer 回写不需要再次扫描全部虚拟行；主动屏蔽、撤销和
              // 行/结构变化仍会通过 force 或对应的 row sync 进入协调器。
            }
          } else if (record.target.matches && record.target.matches(VIRTUAL_ROW_SELECTOR)) {
            if (ownVirtualRowStyle(record.target)) {
              virtualDiagnostic('virtualObserverIgnored');
              virtualDiagnostic('virtualRowOwnWritesIgnored');
            } else {
              virtualDiagnostic('virtualRowPlatformMutations');
              // 行重新从回收占位变为活动行时，微博可能同时清掉内容层的
              // 本地位移。这里不能和 spacer 一样等待 120ms 静默期，否则
              // 后续评论会在可见区域留下一个隐藏行高度的空洞；同一批次
              // 的多个行写回在本次 MutationObserver 回调内合并为一次同步。
              if (isWeiboDetailVirtualList(list)) immediate = true;
              else deferred = true;
            }
          } else {
            const row = record.target && record.target.closest && record.target.closest(VIRTUAL_ROW_SELECTOR);
            if (!row || row.firstElementChild !== record.target) continue;
            if (ownVirtualContentStyle(record.target)) {
              virtualDiagnostic('virtualObserverIgnored');
              virtualDiagnostic('virtualContentOwnWritesIgnored');
            } else {
              // 微博有时只重绘内容层，外层 item-view 的 transform 不变；
              // 这种写回不会触发行观察器，但会把本地补位清掉，必须单独
              // 立刻恢复，否则详情页会再次留下隐藏主评论的空洞。
              virtualDiagnostic('virtualContentPlatformMutations');
              if (isWeiboDetailVirtualList(list)) immediate = true;
              else deferred = true;
            }
          }
        }
        if (!state.blockedRows.size && !virtualListInlineStates.has(list) && !state.pending) {
          detachVirtualListObserver(list);
          return;
        }
        if (immediate) syncVirtualListNow(list);
        else if (deferred) queueVirtualListSync(list, false, 'platform');
      });
      refreshVirtualListObserver(list);
    } else if (state.observer) refreshVirtualListObserver(list);
  }

  function detachVirtualListObserver(list) {
    const state = virtualListSyncStates.get(list);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.platformTimer) clearTimeout(state.platformTimer);
    if (state.observer) state.observer.disconnect();
    pendingVirtualLists.delete(list);
    virtualListSyncStates.delete(list);
  }

  function requestVirtualSyncFlush() {
    if (virtualSyncScheduled) return;
    virtualSyncScheduled = true;
    const flush = () => {
      virtualSyncScheduled = false;
      const lists = Array.from(pendingVirtualLists);
      for (const list of lists) {
        const state = virtualListSyncStates.get(list);
        if (!state) {
          pendingVirtualLists.delete(list);
          continue;
        }
        if (!state.pending) {
          pendingVirtualLists.delete(list);
          continue;
        }
        if (!list.isConnected) { detachVirtualListObserver(list); continue; }
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const elapsed = now - state.lastSyncAt;
        if (!state.force && state.lastSyncAt > 0 && elapsed < VIRTUAL_SYNC_THROTTLE_MS) {
          virtualDiagnostic('virtualSyncThrottled');
          if (!state.timer) {
            state.timer = setTimeout(() => {
              state.timer = 0;
              requestVirtualSyncFlush();
            }, VIRTUAL_SYNC_THROTTLE_MS - elapsed);
          }
          continue;
        }
        state.pending = false;
        state.force = false;
        state.lastSyncAt = now;
        pendingVirtualLists.delete(list);
        const firstRow = Array.from(list.children || [])
          .find((child) => child.matches && child.matches(VIRTUAL_ROW_SELECTOR));
        if (firstRow) syncVirtualRowOffsets(firstRow);
        if (!virtualListHasBlockedWork(list)) detachVirtualListObserver(list);
      }
      // 扫描器可能在同一个 rAF 中撤销屏蔽并重新把列表加入 pending 集合。
      // 当前 flush 已经取过快照时，必须再排一次，否则撤销后的内容层位移会
      // 留在旧值，表现为评论已经恢复但后续评论仍停在上移后的位置。
      if (pendingVirtualLists.size) {
        requestVirtualSyncFlush();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  }

  function queueVirtualListSync(list, force = false, reason = 'platform') {
    if (!list || (!force && !virtualListHasBlockedWork(list))) return;
    const state = virtualListSyncState(list);
    state.pending = true;
    state.force = state.force || force;
    pendingVirtualLists.add(list);
    virtualDiagnostic('virtualSyncQueued');
    if (reason !== 'platform' && state.platformTimer) {
      clearTimeout(state.platformTimer);
      state.platformTimer = 0;
    }
    if (!force && reason === 'platform') {
      if (state.platformTimer) clearTimeout(state.platformTimer);
      state.platformTimer = setTimeout(() => {
        state.platformTimer = 0;
        requestVirtualSyncFlush();
      }, VIRTUAL_PLATFORM_QUIET_MS);
      return;
    }
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const elapsed = now - state.lastSyncAt;
    if (force || state.lastSyncAt <= 0 || elapsed >= VIRTUAL_SYNC_THROTTLE_MS) {
      requestVirtualSyncFlush();
    } else if (!state.timer) {
      virtualDiagnostic('virtualSyncThrottled');
      state.timer = setTimeout(() => {
        state.timer = 0;
        requestVirtualSyncFlush();
      }, VIRTUAL_SYNC_THROTTLE_MS - elapsed);
    }
  }

  function queueVirtualRowSync(row, force = false, reason = 'platform') {
    queueVirtualListSync(virtualRowListOf(row), force, reason);
  }

  function parseVirtualListPixels(value) {
    const match = String(value || '').trim().match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))px$/i);
    const numeric = match ? Number(match[1]) : NaN;
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function rememberVirtualList(row) {
    const list = virtualRowListOf(row);
    if (!list || !list.style) return list;
    const syncState = virtualListSyncState(list);
    if (row && blockedVirtualRowStates.has(row)) syncState.blockedRows.add(row);
    ensureVirtualListObserver(list);
    if (virtualListInlineStates.has(list)) return list;
    const computed = window.getComputedStyle ? getComputedStyle(list) : null;
    let prop = '';
    let originalValue = '';
    let originalPriority = '';
    let basePixels = 0;
    for (const candidate of VIRTUAL_LIST_SIZE_PROPS) {
      const inlineValue = list.style.getPropertyValue(candidate);
      const computedValue = computed ? computed.getPropertyValue(candidate) : '';
      const inlinePixels = parseVirtualListPixels(inlineValue);
      const computedPixels = parseVirtualListPixels(computedValue);
      // `height` 的 computed 值即使来自 auto 布局也会是一个像素值；把它
      // 固定成 inline 高度会反过来接管微博回收器。没有显式 height 时，
      // 只使用平台明确给出的 min-height 基线。
      if (candidate === 'height' && !inlinePixels) continue;
      if (!(inlinePixels > 0 || computedPixels > 0)) continue;
      prop = candidate;
      originalValue = inlineValue;
      originalPriority = list.style.getPropertyPriority(candidate);
      basePixels = inlinePixels || computedPixels;
      break;
    }
    if (!prop) return list;
    virtualListInlineStates.set(list, {
      prop,
      originalValue,
      originalPriority,
      basePixels,
      appliedValue: list.style.getPropertyValue(prop),
      appliedPriority: list.style.getPropertyPriority(prop),
      appliedDesiredValue: list.style.getPropertyValue(prop),
      appliedHiddenPixels: 0,
    });
    return list;
  }

  function syncVirtualListSize(list, hiddenPixels) {
    if (!list || !list.style) return;
    let state = virtualListInlineStates.get(list);
    if (!state) {
      const firstRow = Array.from(list.children || [])
        .find((child) => child.matches && child.matches(VIRTUAL_ROW_SELECTOR));
      rememberVirtualList(firstRow);
      state = virtualListInlineStates.get(list);
    }
    if (!state || !state.prop) return;
    const currentValue = list.style.getPropertyValue(state.prop);
    const currentPriority = list.style.getPropertyPriority(state.prop);
    const normalizedHiddenPixels = Math.max(0, hiddenPixels);
    const hiddenPixelsChanged = state.appliedHiddenPixels !== normalizedHiddenPixels;
    if (currentValue !== state.appliedValue || currentPriority !== state.appliedPriority) {
      const computed = window.getComputedStyle ? getComputedStyle(list) : null;
      const observedPixels = parseVirtualListPixels(currentValue)
        || parseVirtualListPixels(computed && computed.getPropertyValue(state.prop));
      // 平台回收器可能把 spacer 恢复为同一个原始基线。隐藏行已经由内容层
      // 位移完成可见补位时，不再和它反复争夺同一个 style；只有隐藏高度变化
      // 或平台确实建立了新的总高基线时才重新计算一次。
      if (!hiddenPixelsChanged && observedPixels > 0
        && Math.abs(observedPixels - state.basePixels) <= 1) {
        state.appliedValue = currentValue;
        state.appliedPriority = currentPriority;
        state.appliedDesiredValue = currentValue;
        return;
      }
      if (observedPixels > 0 && Math.abs(observedPixels - state.basePixels) > 1) {
        state.basePixels = observedPixels;
      }
    }
    const expectedCompensated = Math.max(0, state.basePixels - normalizedHiddenPixels);
    const desiredPixels = expectedCompensated;
    const desiredValue = desiredPixels + 'px';
    if (runtimeDiagnostics) {
      runtimeDiagnostics.virtualLastList = {
        prop: state.prop,
        currentValue,
        currentPriority,
        basePixels: state.basePixels,
        hiddenPixels,
        expectedCompensated,
        desiredValue,
        desiredPriority: state.originalPriority,
      };
    }
    const desiredAlreadyApplied = currentValue === state.appliedValue
      && currentPriority === state.appliedPriority
      && state.appliedDesiredValue === desiredValue;
    if (!desiredAlreadyApplied && (currentValue !== desiredValue || currentPriority !== state.originalPriority)) {
      virtualOwnListWrites.set(list, {
        prop: state.prop,
        value: desiredValue,
        priority: state.originalPriority,
      });
      virtualDiagnostic('virtualSyncStyleWrites');
      list.style.setProperty(state.prop, desiredValue, state.originalPriority);
    }
    state.appliedValue = list.style.getPropertyValue(state.prop);
    state.appliedPriority = list.style.getPropertyPriority(state.prop);
    state.appliedDesiredValue = desiredValue;
    virtualOwnListWrites.set(list, {
      prop: state.prop,
      value: state.appliedValue,
      priority: state.appliedPriority,
    });
    state.appliedHiddenPixels = normalizedHiddenPixels;
    if (runtimeDiagnostics) {
      runtimeDiagnostics.virtualLastList.afterValue = list.style.getPropertyValue(state.prop);
      runtimeDiagnostics.virtualLastList.afterPriority = list.style.getPropertyPriority(state.prop);
    }
  }

  function restoreVirtualListSize(list) {
    const state = virtualListInlineStates.get(list);
    if (!state || !list || !list.style) return;
    const syncState = virtualListSyncStates.get(list);
    if (syncState) syncState.hiddenPixels = 0;
    const currentValue = list.style.getPropertyValue(state.prop);
    const currentPriority = list.style.getPropertyPriority(state.prop);
    // 若微博已经在本地隐藏期间写入了新的合法基线，不覆盖它；只有仍是本次
    // 补偿值时才恢复原始 inline 声明。
    if (currentValue === state.appliedValue && currentPriority === state.appliedPriority) {
      const restoreValue = state.originalValue || '';
      virtualOwnListWrites.set(list, {
        prop: state.prop,
        value: restoreValue,
        priority: state.originalValue ? state.originalPriority : '',
      });
      virtualDiagnostic('virtualSyncStyleWrites');
      if (state.originalValue) list.style.setProperty(state.prop, state.originalValue, state.originalPriority);
      else list.style.removeProperty(state.prop);
      virtualOwnListWrites.set(list, {
        prop: state.prop,
        value: list.style.getPropertyValue(state.prop),
        priority: list.style.getPropertyPriority(state.prop),
      });
    }
    virtualListInlineStates.delete(list);
  }

  function readTranslateY(value) {
    const text = String(value || '');
    const translate = text.match(/translateY\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)px\s*\)/i);
    if (translate) return Number(translate[1]);
    const matrix = text.match(/^matrix(3d)?\(([^)]+)\)$/i);
    if (!matrix) return NaN;
    const parts = matrix[2].split(',').map((part) => Number(part.trim()));
    if (matrix[1]) return parts.length >= 14 ? parts[13] : NaN;
    return parts.length >= 6 ? parts[5] : NaN;
  }

  function shiftTranslateY(value, delta) {
    const text = String(value || '');
    const translate = text.match(/translateY\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)px\s*\)/i);
    if (translate) {
      const next = Number(translate[1]) - delta;
      return text.replace(translate[0], 'translateY(' + next + 'px)');
    }
    const matrix = text.match(/^matrix(3d)?\(([^)]+)\)$/i);
    if (!matrix) return '';
    const parts = matrix[2].split(',').map((part) => Number(part.trim()));
    const index = matrix[1] ? 13 : 5;
    if (parts.length <= index || parts.some((part) => !Number.isFinite(part))) return '';
    parts[index] -= delta;
    return 'matrix' + (matrix[1] ? '3d' : '') + '(' + parts.join(', ') + ')';
  }

  function setTranslateY(value, y) {
    const text = String(value || '');
    const translate = text.match(/translateY\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)px\s*\)/i);
    if (translate) return text.replace(translate[0], 'translateY(' + y + 'px)');
    const matrix = text.match(/^matrix(3d)?\(([^)]+)\)$/i);
    if (!matrix) return '';
    const parts = matrix[2].split(',').map((part) => Number(part.trim()));
    const index = matrix[1] ? 13 : 5;
    if (parts.length <= index || parts.some((part) => !Number.isFinite(part))) return '';
    parts[index] = y;
    return 'matrix' + (matrix[1] ? '3d' : '') + '(' + parts.join(', ') + ')';
  }

  function virtualBlockKindOf(adapter, container) {
    const kind = adapter && typeof adapter.virtualBlockKindOf === 'function'
      ? adapter.virtualBlockKindOf(container) : '';
    return kind === 'post' ? 'post' : 'comment';
  }

  function rememberVirtualRow(container, adapter) {
    const row = adapter && typeof adapter.virtualRowOf === 'function'
      ? adapter.virtualRowOf(container) : virtualCommentRowOf(container);
    if (!row) return row;
    const kind = virtualBlockKindOf(adapter, container);
    const existing = blockedVirtualRowStates.get(row);
    if (existing) {
      if (!(existing.kinds instanceof Set)) existing.kinds = new Set([existing.kind || 'comment']);
      existing.kinds.add(kind);
      if (!(existing.height > 0)) {
        const measured = readVirtualRowHeight(row);
        if (measured > 0) existing.height = measured;
      }
      return row;
    }
    const height = readVirtualRowHeight(row);
    blockedVirtualRowStates.set(row, { height, kinds: new Set([kind]) });
    return row;
  }

  // 用户页的帖子本身也可能位于 item-view > wbpro-scroller-item 中，但帖子内
  // 展开的评论位于该内容层更深处的普通 wbpro-list。那条 item-view 是整条帖子，
  // 不是评论虚拟行；若把它纳入补位，会移动整条帖子并和微博回收器形成闪动。
  // 详情页的顶层评论也使用 wbpro-list，但当前真站结构能由 woo-panel-main
  // 区分：只有详情面板中、直接挂在虚拟行内容层下的 wbpro-list > item1，才允许
  // 虚拟补位；用户页嵌套评论继续走普通 DOM 折叠。
  function virtualCommentRowOf(container) {
    const row = virtualRowOf(container);
    if (!row) return null;
    const commentSelector = '.item1,.item2,.card-review[comment_id]';
    const comment = container.matches && container.matches(commentSelector)
      ? container : (container.closest && container.closest(commentSelector));
    const content = row.firstElementChild;
    if (!comment || !content || !row.contains(comment)) return null;
    if (comment.parentElement === row || comment.parentElement === content) return row;
    const detailListComment = comment.classList && comment.classList.contains('item1')
      && comment.parentElement && comment.parentElement.classList
      && comment.parentElement.classList.contains('wbpro-list')
      && comment.parentElement.parentElement === content
      // 详情页的虚拟列表 wrapper 位于 `.woo-panel-main` 里面；无限流/个人页
      // 则是反过来由回收行包住 `article.woo-panel-main`。必须判断 wrapper
      // 的祖先，不能只看 row，否则会把帖子卡片内的预览评论误当成顶层评论。
      && isWeiboDetailVirtualList(virtualRowListOf(row));
    if (detailListComment) return row;
    if (runtimeDiagnostics) virtualDiagnostic('weiboNestedVirtualRowsIgnored');
    return null;
  }

  function readVirtualRowHeight(row) {
    if (!row) return 0;
    const cached = safeVirtualRowHeight(virtualRowHeightStates.get(row));
    if (cached > 0) return cached;
    // 微博登录态在首轮测量时可能先把 item-view 撑到很大的临时高度；
    // item-view 的直接内容层才是评论实际占用的高度，优先读取它。
    const candidates = [row.firstElementChild, row];
    for (const candidate of candidates) {
      if (!candidate || !candidate.getBoundingClientRect) continue;
      virtualDiagnostic('virtualSyncLayoutReads');
      const rect = candidate.getBoundingClientRect();
      const rectHeight = Number(rect.height) || 0;
      if (rectHeight > 0 && rectHeight <= MAX_VIRTUAL_ROW_HEIGHT) {
        virtualRowHeightStates.set(row, rectHeight);
        return rectHeight;
      }
      const scrollHeight = Number(candidate.scrollHeight) || 0;
      if (scrollHeight > 0 && scrollHeight <= MAX_VIRTUAL_ROW_HEIGHT) {
        virtualRowHeightStates.set(row, scrollHeight);
        return scrollHeight;
      }
    }
    return 0;
  }

  function safeVirtualRowHeight(value) {
    const height = Number(value);
    return Number.isFinite(height) && height > 0 && height <= MAX_VIRTUAL_ROW_HEIGHT ? height : 0;
  }

  function virtualRowInlineState(row) {
    let state = virtualRowInlineStates.get(row);
    if (state) return state;
    const value = row.style.getPropertyValue('transform');
    const priority = row.style.getPropertyPriority('transform');
    state = {
      value,
      priority,
      safeValue: value,
      safePriority: priority,
      safeY: readTranslateY(value),
      applied: '',
      appliedPriority: '',
    };
    virtualRowInlineStates.set(row, state);
    return state;
  }

  function shiftVirtualContentTransform(value, offset) {
    const amount = Number(offset);
    if (!(amount > 0)) return String(value || '');
    const text = String(value || '').trim();
    if (!text || text === 'none') return 'translateY(' + (-amount) + 'px)';
    const translate3d = text.match(/translate3d\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))px\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))px\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))px\s*\)/i);
    if (translate3d) {
      const nextY = Number(translate3d[2]) - amount;
      return text.replace(translate3d[0], 'translate3d(' + translate3d[1] + 'px, ' + nextY + 'px, ' + translate3d[3] + 'px)');
    }
    const shifted = shiftTranslateY(text, amount);
    return shifted || (text + ' translateY(' + (-amount) + 'px)');
  }

  // 外层 item-view 的 transform 是微博回收器的控制面：脚本改它会立刻触发
  // 回收器重排，回收器再写回原值，最终形成频闪。正常补位只移动直接内容层，
  // 保留外层 transform 供异常基线修复使用。
  function syncVirtualContentOffset(row, offset) {
    if (!row || !row.firstElementChild) return;
    const content = row.firstElementChild;
    const amount = Number(offset) > 0 ? Number(offset) : 0;
    let state = virtualContentOffsetStates.get(content);
    const currentValue = content.style.getPropertyValue('transform');
    const currentPriority = content.style.getPropertyPriority('transform');
    if (state && (currentValue !== state.appliedValue || currentPriority !== state.appliedPriority)) {
      // 内容节点可能被平台复用并写入新的基线；不要把旧的本地位移
      // 当成平台 transform 继续叠加。
      state.baselineValue = currentValue;
      state.baselinePriority = currentPriority;
      state.appliedValue = '';
      state.appliedPriority = '';
      state.desiredValue = '';
      state.desiredPriority = '';
    }
    if (!state && amount > 0) {
      state = {
        baselineValue: currentValue,
        baselinePriority: currentPriority,
        appliedValue: '',
        appliedPriority: '',
        desiredValue: '',
        desiredPriority: '',
      };
      virtualContentOffsetStates.set(content, state);
    }
    if (!state) return;
    const desiredValue = amount > 0
      ? shiftVirtualContentTransform(state.baselineValue, amount)
      : state.baselineValue;
    const desiredPriority = state.baselinePriority || '';
    const desiredAlreadyApplied = currentValue === state.appliedValue
      && currentPriority === state.appliedPriority
      && state.desiredValue === desiredValue
      && state.desiredPriority === desiredPriority;
    if (!desiredAlreadyApplied && (currentValue !== desiredValue || currentPriority !== desiredPriority)) {
      virtualOwnContentWrites.set(content, { value: desiredValue, priority: desiredPriority });
      virtualDiagnostic('virtualSyncStyleWrites');
      if (desiredValue) content.style.setProperty('transform', desiredValue, desiredPriority);
      else content.style.removeProperty('transform');
    }
    state.appliedValue = content.style.getPropertyValue('transform');
    state.appliedPriority = content.style.getPropertyPriority('transform');
    state.desiredValue = desiredValue;
    state.desiredPriority = desiredPriority;
    virtualOwnContentWrites.set(content, { value: state.appliedValue, priority: state.appliedPriority });
    if (amount === 0) virtualContentOffsetStates.delete(content);
  }

  function restoreVirtualRowInlineStyle(row) {
    const state = virtualRowInlineStates.get(row);
    if (!state || !row.style) return;
    const value = state.safeValue || state.value;
    const priority = state.safeValue ? state.safePriority : state.priority;
    const restoreValue = value || '';
    const restorePriority = value ? priority : '';
    if (row.style.getPropertyValue('transform') !== restoreValue
      || row.style.getPropertyPriority('transform') !== restorePriority) {
      virtualOwnRowWrites.set(row, { value: restoreValue, priority: restorePriority });
      virtualDiagnostic('virtualSyncStyleWrites');
      if (value) row.style.setProperty('transform', value, priority);
      else row.style.removeProperty('transform');
      virtualOwnRowWrites.set(row, {
        value: row.style.getPropertyValue('transform'),
        priority: row.style.getPropertyPriority('transform'),
      });
    }
    virtualRowInlineStates.delete(row);
  }

  function hiddenWeiboCommentInVirtualRow(row) {
    const commentSelector = '.item1,.item2,.card-review[comment_id]';
    const comments = Array.from(row.querySelectorAll(commentSelector));
    return comments.some((comment) => {
      let parent = comment.parentElement;
      while (parent && parent !== row) {
        if (parent.matches && parent.matches(commentSelector)) return false;
        parent = parent.parentElement;
      }
      return comment.classList.contains('ob-hidden')
      || (comment.hasAttribute('data-ob-blocked') && getComputedStyle(comment).display === 'none');
    });
  }

  function virtualRowStateStillBlocked(row, state) {
    if (!row || !state) return false;
    const kinds = state.kinds instanceof Set
      ? state.kinds : new Set([state.kind || 'comment']);
    if (kinds.has('post') && currentAdapter && currentAdapter.id === 'weibo'
      && typeof currentAdapter.hasBlockedVirtualPost === 'function'
      && currentAdapter.hasBlockedVirtualPost(row)) return true;
    return kinds.has('comment') && hiddenWeiboCommentInVirtualRow(row);
  }

  function inactiveWeiboVirtualRow(row) {
    if (!row || !row.style) return false;
    const inlineOpacity = row.style.getPropertyValue('opacity').trim();
    if (inlineOpacity) {
      const numeric = Number.parseFloat(inlineOpacity);
      if (Number.isFinite(numeric)) return numeric === 0;
    }
    const inlineDisplay = row.style.getPropertyValue('display').trim();
    if (inlineDisplay) return inlineDisplay === 'none';
    const inlineVisibility = row.style.getPropertyValue('visibility').trim();
    if (inlineVisibility) return inlineVisibility === 'hidden' || inlineVisibility === 'collapse';
    // 真站回收行捕获结构用 inline opacity:0 标记非活动占位节点；没有该标记的
    // 行按活动行处理，避免每次补位都触发全列表 computed-style 读取。
    return false;
  }

  function syncVirtualRowOffsets(row) {
    if (!row || !row.parentElement || !row.matches(VIRTUAL_ROW_SELECTOR)) return;
    const list = virtualRowListOf(row);
    if (!list) return;
    const rows = Array.from(list.children || [])
      .filter((candidate) => candidate.matches && candidate.matches(VIRTUAL_ROW_SELECTOR));
    if (!rows.length) return;
    virtualDiagnostic('virtualSyncs');
    virtualDiagnostic('virtualSyncRowsVisited', rows.length);
    if (runtimeDiagnostics) {
      const listState = virtualListSyncStates.get(list);
      runtimeDiagnostics.virtualLastBlockedRows = listState ? listState.blockedRows.size : 0;
    }
    const meta = rows.map((candidate) => {
      const state = virtualRowInlineStates.get(candidate);
      const inlineValue = candidate.style.getPropertyValue('transform');
      const inlinePriority = candidate.style.getPropertyPriority('transform');
      if (state && (inlineValue !== state.applied || inlinePriority !== state.appliedPriority)) {
        // Weibo 会在虚拟列表重排时重新写入行的 style；正常位置视为新的平台基线。
        // 但登录态首轮异常会反复写回 -1e6 一类的科学计数法位置，这不是新基线，
        // 否则下一轮会继续沿用错误 transform，出现短暂上移后又回到空洞位置。
        const observedY = readTranslateY(inlineValue);
        const observedSafe = Number.isFinite(observedY) && Math.abs(observedY) <= MAX_VIRTUAL_ROW_HEIGHT;
        if (observedSafe || !Number.isFinite(state.safeY)) {
          state.value = inlineValue;
          state.priority = inlinePriority;
          state.safeValue = inlineValue;
          state.safePriority = inlinePriority;
          state.safeY = observedY;
        }
        state.applied = '';
        state.appliedPriority = '';
      }
      const inline = state ? state.value : inlineValue;
      const computed = inline ? '' : (window.getComputedStyle ? getComputedStyle(candidate).transform : '');
      const source = inline || computed;
      const inactive = inactiveWeiboVirtualRow(candidate);
      // 非活动行是微博回收器的占位节点（常见为 translateY(-9999px) + opacity:0）。
      // 它们稍后会被平台复用到新的可见位置，不能把本地补位写成 !important，
      // 否则平台再也无法接管这些行，滚动到该处时会整段空白。
      if (inactive && state) {
        if (state.applied) {
          source = state.value;
          restoreVirtualRowInlineStyle(candidate);
        } else {
          virtualRowInlineStates.delete(candidate);
        }
      }
      const blockedState = blockedVirtualRowStates.get(candidate);
      let blockedByState = !!blockedState;
      if (blockedByState && !virtualRowStateStillBlocked(candidate, blockedState)) {
        if (runtimeDiagnostics) virtualDiagnostic('virtualStaleBlockedRows');
        // 回收器已经把这条物理行换成了新的评论，但身份扫描尚未完成时，
        // 旧的屏蔽状态不能继续参与累计高度和后续行偏移；否则新评论会被
        // 当成旧的屏蔽行，滚动后整段列表出现空洞。下一轮扫描若确认新身份
        // 仍在名单中，会重新注册同一物理行。
        blockedVirtualRowStates.delete(candidate);
        const syncState = virtualListSyncStates.get(list);
        if (syncState) syncState.blockedRows.delete(candidate);
        blockedByState = false;
      }
      return {
        candidate,
        source,
        y: readTranslateY(source),
        inactive,
        blocked: blockedByState,
        height: safeVirtualRowHeight(blockedState?.height)
          || safeVirtualRowHeight(readVirtualRowHeight(candidate)),
      };
    });
    const hiddenPixels = meta.reduce((total, entry) => (
      entry.blocked ? total + safeVirtualRowHeight(entry.height) : total
    ), 0);
    const listState = virtualListSyncState(list);
    listState.hiddenPixels = hiddenPixels;
    if (runtimeDiagnostics) runtimeDiagnostics.virtualLastHiddenPixels = hiddenPixels;
    if (hiddenPixels > 0) syncVirtualListSize(list, hiddenPixels);
    else restoreVirtualListSize(list);
    let shift = 0;
    let previousActive = null;
    for (let i = 0; i < meta.length; i++) {
      const entry = meta[i];
      if (entry.inactive) {
        // 保留平台的回收标记和原始 transform；等它重新变为活动行后再补位。
        syncVirtualContentOffset(entry.candidate, 0);
        continue;
      }

      const expectedBaseY = previousActive && Number.isFinite(previousActive.baseY) && previousActive.height > 0
        ? previousActive.baseY + previousActive.height : NaN;
      const discontinuous = Number.isFinite(entry.y) && Number.isFinite(expectedBaseY)
        && Math.abs(entry.y - expectedBaseY) > MAX_VIRTUAL_ROW_GAP;
      // 绝对位置可以随着长列表滚动而变大，只有没有相邻基线时才使用上限；
      // 有相邻活动行时以连续性为准，覆盖当前真站约 -20000px 的错误活动行。
      const abnormal = !Number.isFinite(entry.y)
        || discontinuous
        || (!Number.isFinite(expectedBaseY) && Math.abs(entry.y) > MAX_VIRTUAL_ROW_HEIGHT);
      let baseY = Number.isFinite(entry.y) && !abnormal ? entry.y : NaN;
      let baseSource = entry.source;
      if (abnormal && previousActive && Number.isFinite(previousActive.baseY) && previousActive.height > 0) {
        // 真实微博在此处会把后续活动行写成 -1.0001e+06px；按前一条活动行的
        // 正常位置和高度重建平台基线，再减去本地隐藏行的累计高度。
        baseY = previousActive.baseY + previousActive.height;
        baseSource = setTranslateY(entry.source, baseY) || entry.source;
        const state = virtualRowInlineStates.get(entry.candidate);
        if (state) {
          state.value = baseSource;
          state.priority = 'important';
          state.safeValue = baseSource;
          state.safePriority = 'important';
          state.safeY = baseY;
        }
      }
      if (!(entry.height > 0) && previousActive && Number.isFinite(baseY)
        && baseY > previousActive.baseY) {
        const inferred = baseY - previousActive.baseY;
        if (inferred > 0 && inferred <= MAX_VIRTUAL_ROW_HEIGHT) entry.height = inferred;
      }

      if (abnormal && Number.isFinite(baseY)) {
        // 异常的 -20000px/-1e6px 基线仍需修复外层回收行；正常的本地补位
        // 不再写外层 transform，避免和微博回收器互相触发。
        const nextTransform = setTranslateY(baseSource, baseY) || baseSource;
        const state = virtualRowInlineState(entry.candidate);
        state.value = nextTransform;
        state.priority = 'important';
        state.safeValue = nextTransform;
        state.safePriority = 'important';
        state.safeY = baseY;
        if (entry.candidate.style.getPropertyValue('transform') !== nextTransform
          || entry.candidate.style.getPropertyPriority('transform') !== 'important') {
          virtualDiagnostic('virtualSyncStyleWrites');
          entry.candidate.style.setProperty('transform', nextTransform, 'important');
        }
        state.value = entry.candidate.style.getPropertyValue('transform');
        state.safeValue = state.value;
        state.applied = state.value;
        state.appliedPriority = entry.candidate.style.getPropertyPriority('transform');
        virtualOwnRowWrites.set(entry.candidate, {
          value: state.applied,
          priority: state.appliedPriority,
        });
      } else if (virtualRowInlineStates.has(entry.candidate)) {
        restoreVirtualRowInlineStyle(entry.candidate);
      }

      // 真站 item-view 和其直接内容层均允许 overflow visible；把累计隐藏高度
      // 放到内容层不会改变回收器的物理行位置，也不会触发它的外层 style 观察器。
      syncVirtualContentOffset(entry.candidate, shift);

      if (entry.blocked) shift += Math.max(0, entry.height);
      if (Number.isFinite(baseY)) previousActive = { baseY, height: entry.height };
    }
    if (!virtualListHasBlockedWork(list)) detachVirtualListObserver(list);
  }

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
    const isWeibo = currentAdapter && currentAdapter.id === 'weibo';
    const virtualRow = isWeibo && currentAdapter && typeof currentAdapter.virtualRowOf === 'function'
      ? currentAdapter.virtualRowOf(container) : (isWeibo ? virtualCommentRowOf(container) : virtualRowOf(container));
    const virtualList = virtualRow && virtualRowListOf(virtualRow);
    const hadVirtualWork = !!virtualRow && (
      virtualRowInlineStates.has(virtualRow) || blockedVirtualRowStates.has(virtualRow)
    );
    setInlineHidden(container, false);
    if (container.__obBar && container.__obBar.parentNode) container.__obBar.parentNode.removeChild(container.__obBar);
    container.__obBar = null;
    container.removeAttribute('data-ob-blocked');
    container.classList.remove('ob-hidden', 'ob-collapsed', 'ob-expanded');
    blockedContainers.delete(container);
    let wrapper = container && container.parentElement;
    while (wrapper && wrapper.classList && wrapper.classList.contains('ob-blocked-wrapper')) {
      const parent = wrapper.parentElement;
      restoreWrapperInlineStyle(wrapper);
      wrapper.classList.remove('ob-blocked-wrapper');
      if (!wrapper.getAttribute('class')) wrapper.removeAttribute('class');
      wrapper = parent;
    }
    if (virtualRow && hadVirtualWork && currentAdapter && currentAdapter.id === 'weibo') {
      const kind = virtualBlockKindOf(currentAdapter, container);
      const state = blockedVirtualRowStates.get(virtualRow);
      if (state && state.kinds instanceof Set) {
        if (kind === 'post') state.kinds.delete('post');
        else if (!hiddenWeiboCommentInVirtualRow(virtualRow)) state.kinds.delete('comment');
      }
      if (!virtualRowStateStillBlocked(virtualRow, state)) {
        blockedVirtualRowStates.delete(virtualRow);
        unregisterVirtualBlockedRow(virtualRow);
      } else registerVirtualBlockedRow(virtualRow);
      queueVirtualRowSync(virtualRow, hadVirtualWork, 'unmark');
    }
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

  // 某些微博虚拟列表把高度/内边距放在评论行的包装层。只折叠被隐藏行自己的
  // 安全祖先，不碰正文、兄弟评论或列表容器。
  function collapseBlockedWrappers(container) {
    if (!container || !container.classList || !container.classList.contains('ob-hidden')) return;
    const subtreeHasVisibleContent = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (node.classList.contains('ob-blocked-wrapper') || node.classList.contains('ob-hidden') || node.hasAttribute('data-ob-blocked')) return false;
      const ownText = Array.from(node.childNodes || []).some((child) => (
        child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()
      ));
      if (ownText) return true;
      const children = Array.from(node.children || []);
      if (!children.length) return true;
      return children.some(subtreeHasVisibleContent);
    };
    let node = container.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle ? getComputedStyle(node) : null;
      const hasMeaningfulChild = Array.from(node.children || []).some((child) => child !== container && subtreeHasVisibleContent(child));
      const hasOwnText = Array.from(node.childNodes || []).some((child) => (
        child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()
      ));
      if (hasMeaningfulChild || hasOwnText) break;
      if (!style || style.display === 'none' || style.visibility === 'hidden') break;
      if (!(node.offsetHeight > 0 || node.scrollHeight > 0)) break;
      node.classList.add('ob-blocked-wrapper');
      collapseWrapperInlineStyle(node);
      node = node.parentElement;
    }
  }

  // 通用：处理一个"条目"——抽出身份，命中则隐藏
  function handleItem(adapter, item) {
    const info = adapter.extract(item);
    const container = (info && adapter.containerOf && adapter.containerOf(item)) || (info && info.container) || item;
    const wasBlocked = !!(container && (container.hasAttribute && container.hasAttribute('data-ob-blocked')));
    if (adapter.id === 'weibo') virtualDiagnostic('weiboItemsHandled');
    if (!info || !info.keys || !info.keys.length) {
      if (adapter.id === 'weibo') {
        virtualDiagnostic('weiboItemsMissingIdentity');
        if (wasBlocked) virtualDiagnostic('weiboUnmarkTransitions');
      }
      unmark(container); return;
    }
    if (Index.isBlocked(info.keys)) {
      if (adapter.id === 'weibo' && !wasBlocked) virtualDiagnostic('weiboBlockTransitions');
      const virtualRow = adapter.id === 'weibo' ? rememberVirtualRow(container, adapter) : null;
      if (virtualRow) rememberVirtualList(virtualRow);
      markBlocked(container, info.label, modeForItem(adapter, item));
      collapseBlockedWrappers(container);
      if (virtualRow) queueVirtualRowSync(virtualRow, true, 'block');
    } else {
      if (adapter.id === 'weibo' && wasBlocked) virtualDiagnostic('weiboUnblockTransitions');
      unmark(container);
    }
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
    function isOwnUiNode(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.id && /^ob-/.test(node.id)) return true;
      return !!(node.classList && Array.from(node.classList).some((name) => (
        name === 'ob-bar' || /^ob-/.test(name)
      )));
    }
    function isOwnUiOnlyChildList(record) {
      if (!record || record.type !== 'childList') return false;
      const changed = Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []))
        .filter((node) => node && node.nodeType === 1);
      return changed.length > 0 && changed.every(isOwnUiNode);
    }
    const mo = new MutationObserver((records) => {
      let shouldSchedule = false;
      for (const record of records) {
        for (const node of record.addedNodes || []) discoverShadowRoots(node);
        if (isOwnUiOnlyChildList(record)) {
          virtualDiagnostic('scannerOwnUiIgnored');
          continue;
        }
        if (record.type !== 'attributes' || record.attributeName !== 'style') shouldSchedule = true;
        if (adapter.id === 'weibo' && record.type === 'childList') {
          const row = record.target && record.target.closest && record.target.closest(VIRTUAL_ROW_SELECTOR);
          const list = row && virtualRowListOf(row);
          // 只有已经存在本地虚拟补位工作的列表才需要因行结构变化强制同步。
          // 普通无限流帖子里的作者入口、评论预览和平台自身换行不能启动整表
          // 布局读取；新出现的屏蔽评论会在 handleItem 中显式注册并排队。
          if (row && virtualListHasBlockedWork(list)) {
            virtualRowHeightStates.delete(row);
            refreshVirtualListObserver(list);
            // 内容节点被回收器替换时，平台通常会先清掉内容层 transform，
            // 也必须在下一帧恢复当前隐藏高度的补位，不能走平台静默延迟。
            queueVirtualRowSync(row, true, 'structure');
          }
        }
        }
      if (shouldSchedule) schedule();
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

  function reasonFromAnchor(anchorEl) {
    const a = currentAdapter;
    if (!a || !a.extract || !anchorEl) return '';
    for (const node of ancestorChain(anchorEl)) {
      if (!node || node.nodeType !== 1 || !node.matches) continue;
      for (const selector of a.selectors || []) {
        if (!node.matches(selector)) continue;
        const info = a.extract(node);
        if (info && info.note) return String(info.note).slice(0, 2000);
      }
    }
    return '';
  }

  function showConfirm(label, keys, anchorEl, onBlocked, commit, note, toastLabel) {
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
          const result = Store.addIdentities(normalizedKeys, label, note || reasonFromAnchor(anchorEl));
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
      showToast(`已拉黑：${toastLabel || label || normalizedKeys[0]}`, transaction && transaction.undo || null);
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
    // 适配器自带跟随式入口（如抖音弹幕）时，不再叠加通用固定按钮。
    if (found && adapter.suppressGenericHover && adapter.suppressGenericHover(found.el)) { if (hoverOwner) clearHover(); return; }
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
    const COMMENT_EXPAND_TEXT = /(?:展开|查看|更多|共)\s*(?:\d+\s*)?(?:条\s*)?(?:回复|评论)/;
    let lastCommentMenuContext = null;

    function noteFor(prefix, item) {
      const text = textOf(item).replace(/\s+/g, ' ').trim();
      return text ? prefix + '：' + text.slice(0, 300) : '';
    }

    function composedParent(node) {
      if (!node) return null;
      if (node.parentElement) return node.parentElement;
      const root = node.getRootNode && node.getRootNode();
      return root && root.host ? root.host : null;
    }

    function nearestComment(node) {
      let current = node;
      for (let guard = 0; current && guard < 20; guard++, current = composedParent(current)) {
        if (current.matches && current.matches(SEL.comment)) return current;
      }
      return null;
    }

    function rememberCommentMenuContext(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [event && event.target];
      for (const node of path || []) {
        const comment = nearestComment(node);
        if (!comment) continue;
        const info = extractComment(comment);
        if (info && info.keys && info.keys.length) {
          lastCommentMenuContext = { ...info, isRoot: isRootComment(comment), at: Date.now() };
          return;
        }
      }
    }

    function menuContextInfo() {
      if (!lastCommentMenuContext || Date.now() - lastCommentMenuContext.at > 5000) {
        lastCommentMenuContext = null;
        return null;
      }
      return lastCommentMenuContext;
    }

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

    function commentThreadId(item) {
      const root = rootCommentOf(item) || item;
      for (const node of [root, item]) {
        if (!node || !node.getAttribute) continue;
        for (const name of ['data-comment-id', 'comment_id', 'data-cid', 'data-rid', 'data-root-id']) {
          const value = normId(attr(node, name));
          if (value) return value;
        }
      }
      // 仅用于当前 DOM 节点之间的归属，不会写入身份键，也不把它当作用户 ID。
      return root && root.id ? String(root.id) : '';
    }

    function rootCommentOf(item) {
      let current = nearestComment(item) || item;
      let root = current;
      for (let guard = 0; current && guard < 24; guard++, current = composedParent(current)) {
        if (current !== root && current.matches && current.matches(SEL.comment)) root = current;
      }
      return root && root.matches && root.matches(SEL.comment) ? root : null;
    }

    function isRootComment(item) {
      const current = nearestComment(item) || item;
      const root = rootCommentOf(current);
      return !!current && !!root && current === root;
    }

    function extractComment(item) {
      const link = findAuthorLink(item);
      const sec = secUidFromHref(attr(link, 'href'));
      const name = textOf(link) || textOf(item.querySelector(SEL.commentNickname));
      const keys = [];
      appendIdentityKey(keys, 'douyin:secuid', sec);
      return {
        keys, label: name, note: noteFor('抖音评论', item), container: item,
        threadId: commentThreadId(item), level: isRootComment(item) ? 'root' : 'reply', source: 'dom',
      };
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

    function currentVideoAuthorSecUid() {
      // 2026-08-23 登录态捕获：视频信息区作者头像为
      // `[data-e2e="video-avatar"][href*="/user/"]`，href 里带 sec_uid。
      const player = document.querySelector('.basePlayerContainer, .playerContainer, [data-e2e="video-player"]');
      const root = player || document;
      const link = root.querySelector('[data-e2e="video-avatar"][href*="/user/"]') || root.querySelector('a[data-e2e="video-avatar"]');
      return secUidFromHref(attr(link, 'href'));
    }

    function extractDanmaku(item) {
      const uid = normId(attr(item, 'data-danmaku-user-id') || attr(item, 'data-danmu-user-id') || attr(item, 'data-user-id') || attr(item, 'data-uid'));
      const sec = secUidFromHref(attr(item, 'data-sec-uid') || attr(item, 'href') || '');
      const keys = [];
      appendIdentityKey(keys, 'douyin:uid', uid);
      appendIdentityKey(keys, 'douyin:secuid', sec);
      // 作者自己的弹幕：当前视频作者（sec_uid）被屏蔽时也一并隐藏，无需 uid 映射。
      if (attr(item, 'data-is-danmu-author') === 'true') {
        appendIdentityKey(keys, 'douyin:secuid', currentVideoAuthorSecUid());
      }
      if (!keys.length) return null;
      return { keys, label: '', note: noteFor('抖音弹幕', item), container: item };
    }

    function interactiveAncestor(node, comment) {
      let current = node;
      for (let guard = 0; current && current !== comment && guard < 8; guard++, current = composedParent(current)) {
        if (current.matches && current.matches('button,a,[role="button"],[role="menuitem"],[tabindex]')) return current;
      }
      return node.matches && node.matches('button,a,[role="button"],[role="menuitem"],[tabindex]') ? node : null;
    }

    function commentExpandControls(scope = document) {
      const out = []; const seen = new Set();
      for (const node of querySelectorAllDeep(scope, '*')) {
        if (!node || node.matches(SEL.comment)) continue;
        const text = textOf(node).replace(/\s+/g, ' ').trim();
        if (!text || text.length > 60 || !COMMENT_EXPAND_TEXT.test(text)) continue;
        if (node.getAttribute && (node.getAttribute('aria-expanded') === 'true'
          || node.getAttribute('data-expanded') === 'true'
          || node.hasAttribute('disabled'))) continue;
        if (/(?:已展开|收起|没有更多|暂无更多)/.test(text)) continue;
        const comment = nearestComment(node);
        const control = comment && interactiveAncestor(node, comment);
        if (scope !== document && comment && comment !== scope && !(scope.contains && scope.contains(comment))) continue;
        if (!comment || !control || !isVisible(control) || seen.has(control)) continue;
        seen.add(control); out.push(control);
      }
      return out;
    }

    async function expandAllCommentReplies(scope = document, onProgress) {
      if (typeof scope === 'function') { onProgress = scope; scope = document; }
      const clicked = new WeakSet();
      let count = 0;
      const maxClicks = 80;
      for (let round = 0; round < 16 && count < maxClicks; round++) {
        const controls = commentExpandControls(scope).filter((control) => !clicked.has(control));
        if (!controls.length) break;
        for (const control of controls) {
          if (count >= maxClicks) break;
          clicked.add(control);
          try { control.click(); count++; } catch (e) {}
          if (onProgress) onProgress(count);
          await new Promise((resolve) => setTimeout(resolve, 220));
        }
      }
      return { clicked: count, users: querySelectorAllDeep(scope, SEL.comment).length, remaining: commentExpandControls(scope).length };
    }

    function commentScrollTargets() {
      const out = []; const seen = new Set();
      const add = (node) => {
        if (!node || node.nodeType !== 1 || seen.has(node)) return;
        let style;
        try { style = getComputedStyle(node); } catch (e) { style = null; }
        const overflow = style ? (String(style.overflowY || '') + ' ' + String(style.overflow || '')) : '';
        const scrollable = node.scrollHeight > node.clientHeight + 8 && /(auto|scroll|overlay)/i.test(overflow);
        // #relatedVideoCard 是已捕获的抖音评论承载层；只有它实际有滚动空间时才使用，
        // 避免把同名但不承载列表的壳误当成加载目标。
        const knownCommentPanel = node.id === 'relatedVideoCard'
          && node.querySelector && node.querySelector('[data-e2e="comment-item"], .comment-item')
          && node.scrollHeight > node.clientHeight + 8;
        if (scrollable || knownCommentPanel) { seen.add(node); out.push(node); }
      };
      for (const comment of querySelectorAllDeep(document, SEL.comment)) {
        let current = comment;
        for (let guard = 0; current && guard < 24; guard++) {
          if (current.nodeType === 1) add(current);
          current = composedParent(current);
        }
      }
      const page = document.scrollingElement;
      if (!out.length && page && page.scrollHeight > page.clientHeight + 8) out.push(page);
      return out;
    }

    // 抖音评论没有公开、稳定且可安全复用的“全部评论”页面接口；滚动真实列表是唯一不触发
    // 平台写入的通用办法。调用方会在每次滚动后先缓存已识别作者，虚拟行回收后也不会丢失。
    async function loadMoreCommentItems(onProgress) {
      const targets = commentScrollTargets();
      const currentCount = () => querySelectorAllDeep(document, SEL.comment).length;
      if (!targets.length) return { supported: false, scrolls: 0, comments: currentCount() };
      const original = targets.map((target) => ({ target, top: target.scrollTop, left: target.scrollLeft }));
      let scrolls = 0; let stablePasses = 0; let lastSignature = '';
      const report = () => {
        if (typeof onProgress === 'function') onProgress({ scrolls, comments: currentCount(), targets: targets.length });
      };
      try {
        for (let pass = 0; pass < 24; pass++) {
          let grew = false;
          for (const target of targets) {
            const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
            if (maxTop <= 0) continue;
            const before = currentCount();
            const nearTop = pass ? Math.max(0, maxTop - target.clientHeight) : 0;
            const positions = pass ? [nearTop, maxTop] : [0, Math.round(maxTop / 2), maxTop];
            for (const top of positions) {
              target.scrollTop = top;
              try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
              await new Promise((resolve) => setTimeout(resolve, 260));
              scrolls++;
              if (currentCount() > before) grew = true;
              report();
            }
          }
          const signature = targets.map((target) => target.scrollHeight + ':' + target.scrollTop).join('|') + ':' + currentCount();
          if (signature === lastSignature && !grew) stablePasses++;
          else stablePasses = 0;
          lastSignature = signature;
          if (stablePasses >= 2) break;
        }
      } finally {
        for (const state of original) {
          state.target.scrollTop = state.top;
          state.target.scrollLeft = state.left;
        }
      }
      return { supported: true, scrolls, comments: currentCount(), stablePasses };
    }

    function collectCommentRecords(root) {
      return querySelectorAllDeep(root || document, SEL.comment).map(extractComment)
        .filter((info) => info && info.keys && info.keys.length);
    }

    async function loadAllCommentRecords(onProgress) {
      const expansion = await expandAllCommentReplies(document, (clicked) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'expand', collected: querySelectorAllDeep(document, SEL.comment).length, clicked });
      });
      const loaded = await loadMoreCommentItems((progress) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'scroll', collected: querySelectorAllDeep(document, SEL.comment).length, ...progress });
      });
      const records = collectCommentRecords(document);
      const reasons = ['抖音没有稳定公开的评论全量接口，仅按当前页面的明确控件和安全滚动读取'];
      if (!loaded.supported) reasons.push('未找到可安全滚动的评论容器');
      if (expansion.remaining || expansion.clicked >= 80) reasons.push('仍有未展开或达到安全上限的回复入口');
      return { records, partial: true, reason: reasons.join('；') };
    }

    async function loadThread(item, onProgress) {
      const root = rootCommentOf(item);
      if (!root || !isRootComment(root)) throw new Error('root comment unavailable');
      const expansion = await expandAllCommentReplies(root, (clicked) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'expand', collected: querySelectorAllDeep(root, SEL.comment).length, clicked });
      });
      const records = collectCommentRecords(root);
      const partialReasons = ['抖音没有稳定公开的楼中楼全量接口，仅按当前页面的明确展开控件读取'];
      if (expansion.remaining || expansion.clicked >= 80) partialReasons.push('仍有未展开的回复入口');
      return {
        records,
        partial: true,
        reason: partialReasons.join('；'),
      };
    }

    function isVideoPage() {
      return /^\/video\//i.test(location.pathname)
        || !!document.querySelector('.basePlayerContainer, .playerContainer, [data-e2e="video-player"]');
    }

    // 精选/推荐流是 SPA：切换下一个视频时，URL 经常仍保持 `/jingxuan` 或推荐页，
    // 但播放器容器会复用并把 `video_<id>` class 换成新视频的标识。只用路由做会话键
    // 会让弹幕管理器把旧视频的观察缓存一直带到后续视频。
    function activeVideoRoot() {
      const marked = $(SEL.feedActive);
      const roots = querySelectorAllDeep(document, '.basePlayerContainer, .playerContainer, [data-e2e="video-player"]');
      if (marked) {
        const markedPlayer = querySelectorAllDeep(marked, '.basePlayerContainer, .playerContainer, [data-e2e="video-player"]')
          .find((root) => {
            const media = querySelectorAllDeep(root, 'video, audio')[0];
            return !!media && !media.paused && !media.ended && isVisible(root);
          });
        if (markedPlayer) return markedPlayer;
        // 某些页面把播放器本身标成 feed-active-video；只有它真的带视频身份时
        // 才直接采用，避免一个无身份的外层标记遮住可用的 video_<id> class。
        if (videoIdentityFromRoot(marked)) return marked;
      }
      const playing = roots.find((root) => {
        const media = querySelectorAllDeep(root, 'video, audio')[0];
        return !!media && !media.paused && !media.ended && isVisible(root);
      });
      if (playing) return playing;
      const visible = roots.find((root) => isVisible(root));
      return visible || roots[0] || null;
    }

    function videoIdentityFromRoot(root) {
      if (!root) return '';
      for (const name of ['data-e2e-vid', 'data-video-id', 'data-item-id']) {
        const value = normId(attr(root, name));
        if (value) return value;
      }
      const className = typeof root.className === 'string' ? root.className : '';
      const match = className.match(/(?:^|\s)video_([0-9]{6,})(?:\s|$)/);
      return match ? match[1] : '';
    }

    function videoKey() {
      const route = location.pathname + location.search;
      const identity = videoIdentityFromRoot(activeVideoRoot());
      return route + (identity ? '|video:' + identity : '');
    }

    function danmakuRoot() {
      return activeVideoRoot() || document;
    }

    function collectDanmaku(root) {
      const byIdentity = new Map();
      for (const item of querySelectorAllDeep(root || document, SEL.danmaku)) {
        if (!item || !item.matches || !item.matches(SEL.danmaku)) continue;
        const info = extractDanmaku(item);
        if (!info || !info.keys || !info.keys.length) continue;
        const keys = normalizeIdentityKeys(info.keys);
        if (!keys.length) continue;
        const key = keys.join('|');
        const text = textOf(item).replace(/\s+/g, ' ').trim();
        const existing = byIdentity.get(key);
        if (existing) {
          existing.messageCount++;
          if (!existing.note && text) existing.note = noteFor('抖音弹幕', item);
          continue;
        }
        byIdentity.set(key, {
          ...info,
          keys,
          label: text ? text.slice(0, 80) : '抖音弹幕发送者',
          note: text ? noteFor('抖音弹幕', item) : '当前视频已观察到的弹幕发送者',
          messageCount: 1,
        });
      }
      return Array.from(byIdentity.values());
    }

    // 抖音弹幕是持续滚动的节点，通用固定悬浮按钮会停在原地。这里把按钮挂进
    // 弹幕节点内部随 transform 一起移动；弹幕层 pointer-events:none，但节点
    // 自身是 auto，可以接收鼠标事件。
    const DY_DM_BTN = 'ob-dy-dm-block';
    let dyDmHoverItem = null;
    let dyDmHoverBtn = null;
    let dyPointer = null;
    function clearDyDanmakuHover() {
      if (dyDmHoverBtn && dyDmHoverBtn.parentNode) dyDmHoverBtn.parentNode.removeChild(dyDmHoverBtn);
      if (dyDmHoverItem) dyDmHoverItem.__obDyDmHover = false;
      dyDmHoverItem = null;
      dyDmHoverBtn = null;
    }
    function attachDyDanmakuButton(item, info) {
      const existing = item.querySelector ? item.querySelector('.' + DY_DM_BTN) : null;
      if (existing) return;
      item.__obDyDmHover = true;
      dyDmHoverItem = item;
      const btn = document.createElement('div');
      btn.className = DY_DM_BTN;
      btn.textContent = '🚫 拉黑';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', '本地拉黑该弹幕发送者');
      btn.title = '本地拉黑该弹幕发送者';
      btn.onpointerdown = (e) => { e.stopPropagation(); };
      btn.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        showConfirm('该弹幕发送者', info.keys, btn);
      };
      item.appendChild(btn);
      dyDmHoverBtn = btn;
    }
    if (document.addEventListener) {
      document.addEventListener('pointermove', (e) => { dyPointer = { x: e.clientX, y: e.clientY }; }, true);
      document.addEventListener('mouseover', (e) => {
        if (!Store.getSetting('enabled') || !Store.getSetting('showHoverButton')) { clearDyDanmakuHover(); return; }
        const item = e.target && e.target.closest ? e.target.closest(SEL.danmaku) : null;
        if (!item) { clearDyDanmakuHover(); return; }
        const info = extractDanmaku(item);
        if (!info || !info.keys.length || Index.isBlocked(info.keys)) { clearDyDanmakuHover(); return; }
        if (item !== dyDmHoverItem) clearDyDanmakuHover();
        attachDyDanmakuButton(item, info);
      }, true);
      // 弹幕持续移动：指针位置不再落在该节点内时立刻收掉浮层，避免按钮停在原地。
      document.addEventListener('pointermove', () => {
        if (!dyDmHoverItem || !dyPointer) return;
        const el = document.elementFromPoint(dyPointer.x, dyPointer.y);
        if (!el || !dyDmHoverItem.contains(el)) clearDyDanmakuHover();
      }, true);
      document.addEventListener('mouseleave', clearDyDanmakuHover, true);
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
      collectUsers(root) {
        return querySelectorAllDeep(root || document, SEL.comment).map(extractComment);
      },
      isVideoPage,
      videoKey,
      danmakuRoot,
      collectDanmaku,
      bulkFabLabel: (n) => '🚫 抖音评论屏蔽(' + n + ')',
      commentManager: {
        available: () => isVideoPage() && collectCommentRecords(document).length > 0,
        collectRecords: () => collectCommentRecords(document),
        loadAll: loadAllCommentRecords,
        loadThread,
        isRootComment,
      },
      rememberMenuContext: rememberCommentMenuContext,
      menuContextInfo,
      extract(item) {
        if (item.matches && item.matches(SEL.comment)) return extractComment(item);
        if (item.matches && item.matches(SEL.profileList)) return extractProfileList(item);
        if (item.matches && item.matches(SEL.danmaku)) return extractDanmaku(item);
        return extractGeneric(item);
      },
      suppressGenericHover: (el) => !!(el && el.matches && el.matches(SEL.danmaku)),
      containerOf: (item) => item,
      onScan: feedTick,
      onDisabled: disableFeed,
    };
  })();

  // ---------- 微博 ----------
  Adapters.weibo = (function () {
    // 点赞/转发/粉丝弹窗里的用户锚点；只有能解析出 UID 的链接才进入批量名单。
    const WB_MODAL_USER_SEL = [
      'a[href*="/u/"]', 'a[href*="/n/"]', '[data-user-card]', '[data-usercard]',
      '[usercard]', '[data-uid]', '[uid]',
    ].join(',');
    const SEL = {
      card: '.card-wrap[action-type="feed_list_item"], .card-wrap[mid], [action-type="feed_list_item"], .WB_feed_type, article[class*="vue-card"], article.woo-panel-main, .card-feed',
      comment: [
        '.card-review[comment_id]',
        '.wbpro-list > .item1',
        '.wbpro-list .list2 > .item2',
        // 2026-08-24 用户 Chrome 真站捕获：详情页首轮虚拟化后，顶层评论变为
        // `.vue-recycle-scroller__item-view > .wbpro-scroller-item > .item1`，不再位于
        // `.wbpro-list > .item1`；必须继续把它作为独立评论行处理，才能记录行高并补位。
        '.vue-recycle-scroller__item-view > .wbpro-scroller-item > .item1',
        // 2026-08-22 真站捕获：「共 N 条回复」会打开
        // `.woo-modal-main > .wbpro-layer` 弹窗。弹窗里根评论仍是 `.wbpro-list > .item1`，
        // 但回复行被 vue-recycle-scroller 包了一层 `.wbpro-scroller-item`，因此
        // `.list2 > .item2` 这条直接子元素路径匹配不到它们。
        '.wbpro-layer .wbpro-scroller-item > .item2',
        '.wbpro-layer .vue-recycle-scroller__item-view > .item2',
        '.wbpro-frame [node-type="reply_list"] > .item2, .wbpro-frame [node-type="reply_list"] .item2',
        '[node-type="reply_list"] > .item2, [node-type="reply_list"] .item2',
        '.list_ul > .item2, .list_ul .item2',
        '.WB_reply > .item2, .WB_reply .item2',
      ].join(','),
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
    };
    // 评论作者槽按优先级逐组尝试：先取带昵称的作者链接，再退到该行头像链接。
    // 合成一个大选择器会把正文里的“被提及用户”和作者混在一组，导致昵称丢失。
    const COMMENT_AUTHOR_GROUPS = [
      ':scope > .content > .txt > a.name[href]',
      ':scope > .item1in > .con1 > .text > a:first-child[href]',
      ':scope > .item2in > .con2 > .text > a:first-child[href]',
      // 2026-08-22 真站捕获（「共 N 条回复」展开弹窗 .woo-modal-main > .wbpro-layer）：
      // 弹窗里根评论仍是 `.item1 > .item1in > .con1 > .text > a`（保留 item1in），
      // 但回复行是 `.item2 > .con2 > .text > a`，没有 `.item2in` 中间层，
      // 所以必须有这条直连路径，否则弹窗内的回复行解析不出身份。
      ':scope > .con2 > .text > a:first-child[href]',
      ':scope > .con > .txt > a:first-child[href]',
      ':scope > .txt > a:first-child[href]',
      ':scope > .content > .txt a.name[href], :scope > .content > .txt a[nick-name][href]',
      ':scope > .con1 > .info a.name[href], :scope > .con1 > .info a[nick-name][href]',
      ':scope a.S_func1[href*="/u/"], :scope a[name*="user"]',
      ':scope > .item1in > div:first-child a[href*="/u/"]',
      ':scope > .item2in > div:first-child a[href*="/u/"]',
      ':scope > .avator a[href], :scope > .avatar a[href]',
      ':scope > .con > .txt a[href*="/u/"]',
      ':scope > .txt a[href*="/u/"]',
      ':scope > div:first-child a[href*="/u/"]',
    ];
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
      const named = links.filter((link) => uidFromLink(link) && (textOf(link) || attr(link, 'nick-name')));
      if (named.length === 1) return named[0];
      // `.name` 是微博评论作者槽的稳定语义标记；没有唯一命名链接时不得退回提及用户。
      const semantic = named.find((link) => link.classList && link.classList.contains('name'));
      return semantic
        || links.find((link) => uidFromLink(link)) || null;
    }
    function findUserLink(item) {
      if (item.matches && item.matches(SEL.comment)) {
        // 评论作者必须来自评论行自己的作者槽，不能退回到提及用户或外层微博作者。
        let fallback = null;
        for (const group of COMMENT_AUTHOR_GROUPS) {
          const links = $$(group, item);
          if (!links.length) continue;
          const named = links.filter((link) => uidFromLink(link) && (textOf(link) || attr(link, 'nick-name')));
          if (named.length === 1) return named[0];
          const semantic = named.find((link) => link.classList && link.classList.contains('name'));
          if (semantic) return semantic;
          if (!fallback) {
            const withUid = links.filter((link) => uidFromLink(link));
            if (withUid.length === 1) fallback = withUid[0];
          }
        }
        return fallback;
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
    function extract(item) {
      const link = findUserLink(item);
      const uid = uidFromLink(link);
      const name = textOf(link) || attr(link, 'nick-name');
      const keys = [];
      appendIdentityKey(keys, 'weibo:uid', uid);
      const container = findContainer(item);
      const root = rootCommentOf(item) || item;
      const textNode = item.querySelector && item.querySelector('.item1in > .con1 > .text, .item2in > .con2 > .text, .con2 > .text, .con1 > .text, .content > .txt, .con > .txt, .txt, .text, .content');
      const text = textOf(textNode || item).replace(/\s+/g, ' ').trim().slice(0, 360);
      const rootId = commentDataValue(root, ['comment_id', 'commentId', 'data-comment-id', 'data-cid']);
      const commentId = commentDataValue(item, ['comment_id', 'commentId', 'data-comment-id', 'data-cid']);
      return {
        keys, label: name, note: text ? '微博评论：' + text : '', container,
        commentId, threadId: rootId || commentId, level: isRootComment(item) ? 'root' : 'reply', source: 'dom',
        root,
      };
    }

    function commentDataValue(item, names) {
      if (!item) return '';
      for (const name of names) {
        const value = normId(attr(item, name));
        if (value) return value;
      }
      return '';
    }

    function isReplyComment(item) {
      return !!(item && item.matches && item.matches('.item2, [node-type="reply"]'));
    }

    function rootCommentOf(item) {
      if (!item) return null;
      if (item.matches && item.matches('.item1, .card-review[comment_id], [node-type="comment"]')) return item;
      let current = item.parentElement;
      for (let guard = 0; current && guard < 24; guard++, current = current.parentElement) {
        if (current.matches && current.matches('.item1, .card-review[comment_id], [node-type="comment"]')) return current;
      }
      return null;
    }

    function isRootComment(item) {
      return !!item && !isReplyComment(item) && !!rootCommentOf(item);
    }

    function collectWeiboCommentRecordsActive(root) {
      return collectWeiboItems(root || document, SEL.comment).map(extract)
        .filter((info) => info && info.keys && info.keys.length);
    }

    const weiboCommentNodeIds = new WeakMap();
    let nextWeiboCommentNodeId = 1;
    let weiboCommentRouteKey = '';
    const weiboCommentCache = new Map();
    function weiboCommentCacheKey(info) {
      const container = info && info.container;
      let nodeId = '';
      if (container && (typeof container === 'object' || typeof container === 'function')) {
        nodeId = weiboCommentNodeIds.get(container);
        if (!nodeId) { nodeId = String(nextWeiboCommentNodeId++); weiboCommentNodeIds.set(container, nodeId); }
      }
      const identity = info && info.keys ? info.keys.join('|') : '';
      return (info && info.commentId ? 'id:' + info.commentId : 'node:' + nodeId) + '|' + identity + '|' + (info && info.level || 'root');
    }

    function currentWeiboCommentRouteKey() {
      return location.pathname + location.search + location.hash;
    }

    function collectWeiboCommentRecords(root) {
      const scope = root || document;
      const active = collectWeiboCommentRecordsActive(scope);
      if (scope !== document) return active;
      const nextRoute = currentWeiboCommentRouteKey();
      if (weiboCommentRouteKey && nextRoute !== weiboCommentRouteKey) weiboCommentCache.clear();
      weiboCommentRouteKey = nextRoute;
      for (const info of active) weiboCommentCache.set(weiboCommentCacheKey(info), info);
      return Array.from(weiboCommentCache.values());
    }

    function isCommentRoute() {
      const route = location.pathname + location.search + location.hash;
      if (/\/hot\//i.test(location.pathname) || /\/search\//i.test(location.pathname)) return false;
      return /#comment|comment/i.test(route)
        || /^\/u\/\d+/i.test(location.pathname)
        || /^\/\d+\/[A-Za-z0-9_-]+/i.test(location.pathname);
    }

    function weiboCommentScrollTargets() {
      const targets = []; const seen = new Set();
      const add = (node) => {
        if (!node || node.nodeType !== 1 || seen.has(node) || (node.closest && node.closest('#ob-comment-manager'))) return;
        let style = null;
        try { style = getComputedStyle(node); } catch (error) {}
        const overflow = style ? String(style.overflowY || '') + ' ' + String(style.overflow || '') : '';
        if (node.scrollHeight > node.clientHeight + 8 && /(auto|scroll|overlay)/i.test(overflow)) {
          seen.add(node); targets.push(node);
        }
      };
      for (const item of collectWeiboItems(document, SEL.comment)) {
        let current = item;
        for (let guard = 0; current && guard < 20; guard++, current = current.parentElement) add(current);
      }
      if (!targets.length && document.scrollingElement && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 8) targets.push(document.scrollingElement);
      return targets;
    }

    async function loadAllCommentRecords(onProgress) {
      const targets = weiboCommentScrollTargets();
      const original = targets.map((target) => ({ target, top: target.scrollTop, left: target.scrollLeft }));
      let scrolls = 0;
      try {
        for (let pass = 0; pass < 12 && targets.length; pass++) {
          for (const target of targets) {
            const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
            for (const top of [0, Math.round(maxTop / 2), maxTop]) {
              target.scrollTop = top;
              try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (error) {}
              await new Promise((resolve) => setTimeout(resolve, 220));
              scrolls++;
              const records = collectWeiboCommentRecords(document);
              if (typeof onProgress === 'function') onProgress({ phase: 'scroll', collected: records.length, scrolls });
            }
          }
          if (targets.every((target) => target.scrollTop >= Math.max(0, target.scrollHeight - target.clientHeight - 2))) break;
        }
      } finally {
        for (const state of original) { state.target.scrollTop = state.top; state.target.scrollLeft = state.left; }
      }
      const records = collectWeiboCommentRecords(document);
      return {
        records,
        partial: true,
        reason: targets.length ? '微博评论只按当前路由内实际观察到的 DOM 读取' : '未找到可安全滚动的评论容器，仅显示已发现评论',
      };
    }

    function weiboReplyExpandControls(root) {
      const out = []; const seen = new Set();
      const textPattern = /(?:共\s*\d+\s*条回复|查看[^\n]{0,20}回复|展开[^\n]{0,20}回复)/;
      for (const node of querySelectorAllDeep(root, 'a,button,[role="button"],div,span')) {
        const text = textOf(node).replace(/\s+/g, ' ').trim();
        if (!text || text.length > 80 || !textPattern.test(text)) continue;
        if (node.getAttribute && (node.getAttribute('aria-expanded') === 'true'
          || node.getAttribute('data-expanded') === 'true'
          || node.hasAttribute('disabled'))) continue;
        if (/(?:已展开|收起|没有更多|暂无更多)/.test(text)) continue;
        let control = node;
        if (!(node.matches && node.matches('a,button,[role="button"]'))) {
          control = node.querySelector && node.querySelector('a,button,[role="button"]');
        }
        if (!control || seen.has(control) || !isVisible(control)) continue;
        seen.add(control); out.push(control);
      }
      return out;
    }

    async function loadThread(item, onProgress) {
      const root = rootCommentOf(item);
      if (!root || !isRootComment(root)) throw new Error('root comment unavailable');
      let records = collectWeiboCommentRecordsActive(root);
      const controls = weiboReplyExpandControls(root);
      let partial = true;
      let reason = '微博没有稳定公开的楼中楼全量接口，仅按当前路由内可确认的 DOM 读取';
      for (const control of controls.slice(0, 20)) {
        try { control.click(); } catch (error) { reason += '；回复展开控件不可用'; }
        await new Promise((resolve) => setTimeout(resolve, 300));
        records = records.concat(collectWeiboCommentRecordsActive(root));
        if (typeof onProgress === 'function') onProgress({ collected: records.length });
      }
      const remaining = weiboReplyExpandControls(root).length;
      if (remaining || controls.length > 20) reason += '；仍有未展开或达到安全上限的回复入口';
      const rootId = commentDataValue(root, ['comment_id', 'commentId', 'data-comment-id', 'data-cid']);
      if (rootId) {
        const cached = collectWeiboCommentRecords(document).filter((record) => record.threadId === rootId);
        records = records.concat(cached);
      } else {
        reason += controls.length
          ? '；缺少可靠楼标识，未合并无法确认归属的弹窗回复'
          : '；缺少可靠楼标识，无法确认该楼回复是否完整';
      }
      return { records, partial, reason };
    }
    // 2026-08-22 真站捕获：根评论是 `.item1 > .item1in > .con1 > .info > .opt`，
    // 楼中楼是 `.item2 > .con2 > .info > .opt`（没有 `.item2in` 中间层）。
    // 因此必须按候选逐个尝试，不能按行类型只认一条路径，否则楼中楼拿不到挂载点。
    const COMMENT_MOUNT_CANDIDATES = [
      ':scope > .item1in > .con1 > .info > .opt',
      ':scope > .item2in > .con2 > .info > .opt',
      ':scope > .con2 > .info > .opt',
      ':scope > .con1 > .info > .opt',
      ':scope > .con > .info > .opt',
      ':scope > .content > .info > .opt',
      ':scope > .con2 > .info',
      ':scope > .con > .info',
      ':scope > .info > .opt',
      ':scope > .info',
    ];
    function commentActionMount(item) {
      if (!item || !item.querySelector) return null;
      for (const candidate of COMMENT_MOUNT_CANDIDATES) {
        const mount = item.querySelector(candidate);
        if (mount) return mount;
      }
      return null;
    }
    function collectWeiboItems(root, selector) {
      const all = querySelectorAllDeep(root, selector);
      // 微博会把根评论和楼中楼做成嵌套结构；两者都是可独立屏蔽的评论行。
      // querySelectorAllDeep 已去重，因此这里不能按“包含关系”丢弃子评论。
      return all.filter((item) => !item.matches || item.matches(selector));
    }
    function clearCommentButtons() {
      for (const button of querySelectorAllDeep(document, '.ob-weibo-comment-block,.ob-weibo-thread-block')) button.remove();
    }
    const weiboAuthorPortalStates = new Map();
    let weiboAuthorPositionListeners = false;
    let weiboAuthorPositionFrame = 0;

    function virtualPostRowOf(item) {
      if (!item || !item.matches || !item.matches(SEL.card)) return null;
      // 只认回收行中的最外层帖子卡片；帖子卡片里的 card-feed、预览评论
      // 等嵌套节点不能代表一条独立的虚拟帖子行。
      const outerCard = item.parentElement && item.parentElement.closest
        ? item.parentElement.closest(SEL.card) : null;
      if (outerCard) return null;
      const row = item.closest(VIRTUAL_ROW_SELECTOR);
      return row && row.firstElementChild && row.firstElementChild.contains(item) ? row : null;
    }

    function virtualRowOfItem(item) {
      return virtualCommentRowOf(item) || virtualPostRowOf(item);
    }

    function hasBlockedVirtualPost(row) {
      if (!row) return false;
      return collectWeiboItems(row, SEL.card).some((card) => (
        virtualPostRowOf(card) === row && card.classList && card.classList.contains('ob-hidden')
      ));
    }

    function isVirtualWeiboAuthorCard(card) {
      // 只把回收器里的帖子卡片转成门户；详情页普通帖子和旧版非虚拟卡片
      // 继续使用原来的行内入口，避免改变已验证的布局。
      return !!virtualPostRowOf(card);
    }

    function positionWeiboAuthorPortals() {
      weiboAuthorPositionFrame = 0;
      for (const [card, state] of weiboAuthorPortalStates) {
        if (!card.isConnected || !state.anchor || !state.anchor.isConnected || !state.portal.isConnected) {
          if (state.portal && state.portal.style) state.portal.style.setProperty('display', 'none', 'important');
          continue;
        }
        const rect = state.anchor.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.top < window.innerHeight
          && rect.right > 0 && rect.left < window.innerWidth;
        if (!visible) {
          state.portal.style.setProperty('display', 'none', 'important');
          continue;
        }
        state.portal.style.setProperty('display', 'block', 'important');
        const width = state.portal.offsetWidth || 120;
        const height = state.portal.offsetHeight || 22;
        const left = clamp(rect.right + 8, 4, Math.max(4, window.innerWidth - width - 4));
        const top = clamp(rect.top + (rect.height - height) / 2, 4, Math.max(4, window.innerHeight - height - 4));
        state.portal.style.left = left + 'px';
        state.portal.style.top = top + 'px';
      }
    }

    function scheduleWeiboAuthorPortalPosition() {
      if (weiboAuthorPositionFrame) return;
      const run = () => positionWeiboAuthorPortals();
      if (typeof requestAnimationFrame === 'function') weiboAuthorPositionFrame = requestAnimationFrame(run);
      else weiboAuthorPositionFrame = setTimeout(run, 0);
    }

    function ensureWeiboAuthorPositionListeners() {
      if (weiboAuthorPositionListeners || !document.addEventListener) return;
      const reposition = () => scheduleWeiboAuthorPortalPosition();
      document.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      weiboAuthorPositionListeners = true;
    }

    function removeWeiboAuthorPortal(card) {
      const state = weiboAuthorPortalStates.get(card);
      if (!state) return;
      if (state.portal && state.portal.parentNode) state.portal.parentNode.removeChild(state.portal);
      weiboAuthorPortalStates.delete(card);
    }

    function removeWeiboAuthorPortals() {
      for (const card of Array.from(weiboAuthorPortalStates.keys())) removeWeiboAuthorPortal(card);
    }

    function makeWeiboAuthorButton(card) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ob-weibo-author-block'; button.textContent = '本地拉黑作者';
      button.title = '本地拉黑此微博作者'; button.setAttribute('aria-label', '本地拉黑此微博作者');
      button.addEventListener('click', (event) => {
        event.stopPropagation(); event.preventDefault();
        const current = extract(card);
        if (!current.keys.length) return;
        showConfirm(current.label, current.keys, button);
      });
      return button;
    }

    function ensureWeiboAuthorPortal(card, info, link) {
      if (!card || !info || !info.keys || !info.keys.length || !link || !document.body) return;
      const key = info.keys.join('|');
      let state = weiboAuthorPortalStates.get(card);
      if (!state || state.key !== key || !state.portal || !state.portal.isConnected) {
        if (state) removeWeiboAuthorPortal(card);
        const portal = document.createElement('div');
        portal.className = 'ob-weibo-author-portal';
        portal.setAttribute('aria-label', '微博作者本地拉黑入口');
        portal.appendChild(makeWeiboAuthorButton(card));
        document.body.appendChild(portal);
        state = { key, anchor: link, portal };
        weiboAuthorPortalStates.set(card, state);
      } else {
        state.anchor = link;
      }
      ensureWeiboAuthorPositionListeners();
      scheduleWeiboAuthorPortalPosition();
    }

    function clearAuthorButtons() {
      removeWeiboAuthorPortals();
      for (const button of querySelectorAllDeep(document, '.ob-weibo-author-block')) button.remove();
    }
    // 帖子作者常驻入口：挂在作者链接所在行（真站捕获为
    // `article.woo-panel-main > header.woo-box-flex`，旧版为 `.card-feed .content > .info`）。
    // 只处理最外层卡片，避免 `.card-feed` 嵌套在 `.card-wrap[mid]` 里时重复注入。
    function syncAuthorButtons() {
      for (const button of querySelectorAllDeep(document, '.ob-weibo-author-block')) {
        if (button.closest && button.closest('.ob-weibo-author-portal')) continue;
        if (!button.closest || !button.closest(SEL.card)) button.remove();
      }
      const enabled = Store.getSetting('enabled') && Store.getSetting('showQuickBlock');
      const cards = collectWeiboItems(document, SEL.card)
        .filter((item) => !item.closest(SEL.card) || item.closest(SEL.card) === item);
      const activeCards = new Set(cards);
      for (const card of Array.from(weiboAuthorPortalStates.keys())) {
        if (!activeCards.has(card) || !isVirtualWeiboAuthorCard(card)) removeWeiboAuthorPortal(card);
      }
      for (const card of cards) {
        const link = findUserLink(card);
        const mount = link && link.isConnected
          ? ((card.querySelector('header') && card.querySelector('header').contains(link)) ? card.querySelector('header') : link.parentElement)
          : null;
        const info = extract(card);
        const virtualCard = isVirtualWeiboAuthorCard(card);
        if (virtualCard) {
          // 旧版本可能已经把按钮插进回收行；先撤掉它，再建立 body 门户。
          if (mount) {
            const inlineButton = mount.querySelector(':scope > .ob-weibo-author-block');
            if (inlineButton) inlineButton.remove();
          }
          if (!mount || !enabled || !info.keys.length || Index.isBlocked(info.keys)) {
            removeWeiboAuthorPortal(card);
          } else {
            ensureWeiboAuthorPortal(card, info, link);
          }
          continue;
        }
        removeWeiboAuthorPortal(card);
        if (!mount) continue;
        let button = mount.querySelector(':scope > .ob-weibo-author-block');
        if (!enabled || !info.keys.length || Index.isBlocked(info.keys)) {
          if (button) button.remove();
          continue;
        }
        if (button) continue;
        button = document.createElement('button');
        button.type = 'button'; button.className = 'ob-weibo-author-block'; button.textContent = '本地拉黑作者';
        button.title = '本地拉黑此微博作者'; button.setAttribute('aria-label', '本地拉黑此微博作者');
        button.addEventListener('click', (event) => {
          event.stopPropagation(); event.preventDefault();
          const current = extract(card);
          if (!current.keys.length) return;
          showConfirm(current.label, current.keys, button);
        });
        if (link.parentElement === mount) mount.insertBefore(button, link.nextSibling);
        else mount.appendChild(button);
      }
    }
    function syncCommentButtons() {
      for (const button of querySelectorAllDeep(document, '.ob-weibo-comment-block')) {
        if (!button.closest || !button.closest(SEL.comment)) button.remove();
      }
      for (const button of querySelectorAllDeep(document, '.ob-weibo-thread-block')) {
        if (!button.closest || !button.closest(SEL.comment)) button.remove();
      }
      const enabled = Store.getSetting('enabled') && Store.getSetting('showQuickBlock');
      for (const item of collectWeiboItems(document, SEL.comment)) {
        const mount = commentActionMount(item);
        if (!mount) continue;
        let button = mount.querySelector(':scope > .ob-weibo-comment-block');
        let threadButton = mount.querySelector(':scope > .ob-weibo-thread-block');
        const info = extract(item);
        const root = isRootComment(item);
        if (!enabled || !info.keys.length || Index.isBlocked(info.keys)) {
          if (button) button.remove();
          if (threadButton) threadButton.remove();
          continue;
        }
        if (!button) {
          button = document.createElement('button');
          button.type = 'button'; button.className = 'ob-weibo-comment-block'; button.textContent = '本地拉黑';
          button.title = '本地拉黑此评论作者'; button.setAttribute('aria-label', '本地拉黑此评论作者');
          button.addEventListener('click', (event) => {
            event.stopPropagation(); event.preventDefault();
            const current = extract(item);
            if (!current.keys.length) return;
            showConfirm(current.label, current.keys, button);
          });
          mount.insertBefore(button, mount.firstChild);
        }
        if (!root) {
          if (threadButton) threadButton.remove();
          continue;
        }
        if (!threadButton) {
          threadButton = document.createElement('button');
          threadButton.type = 'button'; threadButton.className = 'ob-weibo-thread-block'; threadButton.textContent = '屏蔽该楼回复';
          threadButton.title = '本地拉黑该主评论及已加载的所有回复作者';
          threadButton.setAttribute('aria-label', '屏蔽该楼回复');
          threadButton.addEventListener('click', (event) => {
            event.stopPropagation(); event.preventDefault();
            runThreadBlock(item, Adapters.weibo, extract(item));
          });
          mount.insertBefore(threadButton, button.nextSibling);
        }
      }
    }
    function collectWeiboUsers(root) {
      const items = [];
      for (const selector of [SEL.comment, SEL.card]) {
        for (const item of collectWeiboItems(root, selector)) items.push(extract(item));
      }
      if (root && root !== document) {
        for (const link of querySelectorAllDeep(root, WB_MODAL_USER_SEL)) {
          if (!isVisible(link)) continue;
          const uid = uidFromLink(link);
          if (!uid) continue;
          const name = textOf(link) || attr(link, 'nick-name') || ('微博用户 ' + uid);
          items.push({ keys: [makeIdentityKey('weibo:uid', uid)], label: name, container: link });
        }
      }
      return items;
    }
    return {
      id: 'weibo',
      match: (h) => /(^|\.)weibo\.com$/.test(h.hostname) || /(^|\.)weibo\.cn$/.test(h.hostname),
      selectors: [SEL.comment, SEL.card],
      disappearSelectors: [SEL.comment],
      extract,
      collectUsers: collectWeiboUsers,
      commentManager: {
        available: () => isCommentRoute() && collectWeiboCommentRecords(document).length > 0,
        collectRecords: () => collectWeiboCommentRecords(document),
        loadAll: loadAllCommentRecords,
        loadThread,
        isRootComment,
      },
      canBulkModal(modal) {
        return querySelectorAllDeep(modal || document, WB_MODAL_USER_SEL)
          .some((link) => uidFromLink(link) && isVisible(link));
      },
      bulkFabLabel: (n) => '🚫 拉黑已加载微博/评论作者(' + n + ')',
      containerOf: (item) => findContainer(item),
      virtualRowOf: virtualRowOfItem,
      virtualBlockKindOf: (item) => virtualPostRowOf(item) ? 'post' : 'comment',
      hasBlockedVirtualPost,
      onScan: () => { syncCommentButtons(); syncAuthorButtons(); },
      onDisabled: () => { clearCommentButtons(); clearAuthorButtons(); },
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
      // 2026-08-23 真站捕获：视频页作者名为 `.up-name`（在 `.up-detail-top` 内）。
      videoAuthor: 'a.up-name[href*="space.bilibili.com/"]',
      // 2026-08-23 真站捕获：动态详情页作者模块 `.opus-module-author`，uid 在
      // `__INITIAL_STATE__.detail.module_author.mid`（页面里的 space 链接是登录用户自己的）。
      opusAuthor: '.opus-module-author',
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

    function commentThreadOf(el) {
      let current = el;
      for (let guard = 0; current && guard < 24; guard++) {
        if (current.tagName === 'BILI-COMMENT-THREAD-RENDERER') return current;
        if (current.parentNode) current = current.parentNode;
        else if (current.host) current = current.host;
        else break;
      }
      return null;
    }

    function commentDataValue(el, names) {
      const nodes = [el, commentThreadOf(el), deepQuery(commentThreadOf(el) || el, 'bili-comment-renderer')].filter(Boolean);
      for (const node of nodes) {
        const data = node.__data;
        for (const source of [data, data && data.reply, data && data.root, data && data.data]) {
          if (!source || typeof source !== 'object') continue;
          for (const name of names) {
            const value = normId(source[name]);
            if (value) return value;
          }
        }
        for (const name of names) {
          const value = normId(attr(node, name));
          if (value) return value;
        }
      }
      return '';
    }

    function commentIdOf(el) {
      return commentDataValue(el, ['rpid_str', 'rpid', 'comment_id', 'commentId', 'data-comment-id']);
    }

    function commentThreadIdOf(el) {
      const explicit = commentDataValue(el, ['root', 'root_str', 'root_id', 'rootId', 'thread_id', 'threadId', 'comment_id', 'commentId', 'data-comment-id']);
      // B站根评论的 root 常见为 0；它不是可查询的楼号，必须回退到自身 rpid。
      if (explicit && explicit !== '0') return explicit;
      const ownId = commentDataValue(el, ['rpid_str', 'rpid']);
      if (ownId && ownId !== '0') return ownId;
      const thread = commentThreadOf(el);
      // 仅作为当前 DOM 节点的关联标识；API 调用前仍要求为纯数字的真实 root ID。
      return thread && thread.id ? String(thread.id) : '';
    }

    function isRootComment(el) {
      if (!el) return false;
      if (el.tagName === 'BILI-COMMENT-THREAD-RENDERER') return !!deepQuery(el, 'bili-comment-renderer');
      if (el.matches && el.matches('bili-comment-reply-renderer, bili-sub-comment-renderer, .reply-item')) return false;
      return !!(el.matches && el.matches('bili-comment-renderer, .comment-item, [data-comment-id]'));
    }

    function commentNote(el) {
      const text = deepTextOf(el, 360);
      return text ? 'B站评论：' + text : '';
    }

    function extract(el) {
      const fromData = dataIdentity(el && el.__data);
      const mid = fromData.mid || midFromEl(el);
      const name = fromData.name || textOf(deepQuery(el, '.user-name, .uname, [data-name], a[href*="space.bilibili.com/"]'));
      const keys = [];
      appendIdentityKey(keys, 'bili:uid', mid);
      const root = commentThreadOf(el) || (isRootComment(el) ? el : null);
      return {
        keys, label: name, note: commentNote(el), container: commentContainer(el),
        commentId: commentIdOf(el), threadId: commentThreadIdOf(el),
        level: isRootComment(el) ? 'root' : 'reply', source: 'dom', root,
      };
    }

    function userFromSpaceLink(link) {
      const m = (attr(link, 'href') || '').match(/space\.bilibili\.com\/(\d+)/);
      if (!m) return null;
      return { keys: [makeIdentityKey('bili:uid', m[1])], label: textOf(link), container: link };
    }

    function collectCommentUsers(root) {
      return querySelectorAllDeep(root, SEL.comment).map(extract);
    }

    function collectCommentRecords(root) {
      return querySelectorAllDeep(root || document, SEL.comment).map(extract)
        .filter((info) => info && info.keys && info.keys.length);
    }

    function collectModalUsers(root) {
      // B站视频页的举报弹窗并不含发送者；只有实际列出空间链接的用户列表才可批量处理。
      const scope = root || document;
      return querySelectorAllDeep(scope, 'a[href*="space.bilibili.com/"]').map(userFromSpaceLink).filter(Boolean);
    }

    function isOpusPage() {
      return /^\/opus\/\d+/i.test(location.pathname);
    }

    function opusAuthorInfo() {
      if (!isOpusPage()) return null;
      const state = window.__INITIAL_STATE__;
      const author = state && state.detail && state.detail.module_author;
      const mid = normId(author && author.mid);
      if (!/^\d+$/.test(mid) || mid === '0') return null;
      return { keys: [makeIdentityKey('bili:uid', mid)], label: normId(author && author.name) || ('UID ' + mid), container: null };
    }

    function videoAuthorInfo() {
      if (!isVideoCommentPage()) return null;
      return userFromSpaceLink(document.querySelector(SEL.videoAuthor));
    }

    function makeBiliAuthorButton(info) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ob-bili-author-block';
      button.textContent = '本地拉黑作者';
      button.title = '本地拉黑该内容作者'; button.setAttribute('aria-label', '本地拉黑该内容作者');
      button.addEventListener('click', (event) => {
        event.stopPropagation(); event.preventDefault();
        showConfirm(info.label, info.keys, button);
      });
      return button;
    }

    let biliAuthorPortal = null;
    let biliAuthorAnchor = null;
    let biliAuthorPortalKey = '';
    let biliAuthorPositionListeners = false;

    function positionBiliAuthorPortal() {
      if (!biliAuthorPortal || !biliAuthorAnchor || !biliAuthorAnchor.isConnected) return;
      const rect = biliAuthorAnchor.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < window.innerHeight
        && rect.right > 0 && rect.left < window.innerWidth;
      if (!visible) { biliAuthorPortal.style.setProperty('display', 'none', 'important'); return; }
      biliAuthorPortal.style.setProperty('display', 'block', 'important');
      const width = biliAuthorPortal.offsetWidth || 120;
      const height = biliAuthorPortal.offsetHeight || 22;
      const left = clamp(rect.right + 8, 4, Math.max(4, window.innerWidth - width - 4));
      const top = clamp(rect.top + (rect.height - height) / 2, 4, Math.max(4, window.innerHeight - height - 4));
      biliAuthorPortal.style.left = left + 'px';
      biliAuthorPortal.style.top = top + 'px';
    }

    function removeBiliAuthorPortal() {
      if (biliAuthorPortal && biliAuthorPortal.parentNode) biliAuthorPortal.parentNode.removeChild(biliAuthorPortal);
      biliAuthorPortal = null;
      biliAuthorAnchor = null;
      biliAuthorPortalKey = '';
    }

    function ensureBiliAuthorPortal(info, anchor, kind) {
      if (!info || !info.keys || !info.keys.length || !anchor || !document.body) return;
      const key = kind + '|' + info.keys.join('|');
      if (!biliAuthorPortal || biliAuthorAnchor !== anchor || biliAuthorPortalKey !== key) {
        removeBiliAuthorPortal();
        const portal = document.createElement('div');
        portal.className = 'ob-bili-author-portal';
        portal.setAttribute('aria-label', 'B站作者本地拉黑入口');
        const button = makeBiliAuthorButton(info);
        button.__obBiliAuthorKind = kind;
        portal.appendChild(button);
        document.body.appendChild(portal);
        biliAuthorPortal = portal;
        biliAuthorAnchor = anchor;
        biliAuthorPortalKey = key;
      }
      positionBiliAuthorPortal();
    }

    function syncBiliAuthorButtons() {
      // 清理旧版本可能插入到 Vue 管理树里的按钮；新版本只保留 body 门户。
      for (const button of querySelectorAllDeep(document, '.ob-bili-author-block')) {
        if (!button.closest || !button.closest('.ob-bili-author-portal')) button.remove();
      }
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { removeBiliAuthorPortal(); return; }
      if (!biliAuthorPositionListeners && document.addEventListener) {
        const reposition = () => positionBiliAuthorPortal();
        document.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        biliAuthorPositionListeners = true;
      }
      const vInfo = videoAuthorInfo();
      if (vInfo && vInfo.keys.length && !Index.isBlocked(vInfo.keys)) {
        const name = document.querySelector(SEL.videoAuthor);
        ensureBiliAuthorPortal(vInfo, name, 'video');
        return;
      }
      const oInfo = opusAuthorInfo();
      if (oInfo && oInfo.keys.length && !Index.isBlocked(oInfo.keys)) {
        const center = document.querySelector('.opus-module-author__center')
          || document.querySelector('.opus-module-author');
        ensureBiliAuthorPortal(oInfo, center, 'opus');
        return;
      }
      removeBiliAuthorPortal();
    }

    function clearBiliAuthorButtons() {
      removeBiliAuthorPortal();
      for (const button of querySelectorAllDeep(document, '.ob-bili-author-block')) button.remove();
    }

    // ---- 视频评论区整区抓取（只读公开接口，用于批量拉黑的"加载全部"与时间筛选）----
    // 真实站点确认（2026-08-23）：wbi 签名版 main 接口匿名返回 -403，未签名的
    // x/v2/reply/main 匿名返回 code 0，带 cursor 分页、mid 与 ctime；子回复用
    // x/v2/reply/reply 按 root 翻页。因此这里只用后两个端点，不做任何写操作。
    const REPLY_MAIN_API = 'https://api.bilibili.com/x/v2/reply/main';
    const REPLY_SUB_API = 'https://api.bilibili.com/x/v2/reply/reply';
    const REPLY_PAGE_SIZE = 20;
    const REPLY_MAIN_PAGE_CAP = 60;   // 最多 60 页根评论（约 1200 条），避免长视频无限翻页
    const REPLY_SUB_ROOT_CAP = 400;   // 最多展开 400 个有子回复的根评论
    const REPLY_SUB_PAGE_CAP = 15;    // 单个根评论最多翻 15 页子回复

    function isVideoCommentPage() {
      return /^\/video\/(BV[0-9A-Za-z]+|av\d+)/i.test(location.pathname);
    }

    function videoAidFromPage() {
      const state = window.__INITIAL_STATE__;
      const candidates = [
        state && state.aid,
        state && state.videoData && state.videoData.aid,
        state && state.videoInfo && state.videoInfo.aid,
      ];
      for (const value of candidates) {
        const aid = normId(value);
        if (/^\d+$/.test(aid) && aid !== '0') return aid;
      }
      const match = location.pathname.match(/^\/video\/av(\d+)/i);
      return match ? match[1] : '';
    }

    async function fetchReplyJSON(url) {
      // 评论管理器只读公开接口；明确不把当前站点的登录 Cookie 带到接口请求中。
      const response = await fetch(url, { credentials: 'omit' });
      if (!response || !response.ok) throw new Error('comment API HTTP ' + (response && response.status));
      const payload = await response.json();
      if (!payload || payload.code !== 0 || !payload.data) {
        throw new Error('comment API code ' + (payload && payload.code));
      }
      return payload.data;
    }

    function replyRecord(reply, threadId, level) {
      const mid = normId(reply && (reply.mid_str || reply.mid));
      if (!/^\d+$/.test(mid) || mid === '0') return null;
      const member = (reply && reply.member) || {};
      const ctime = Number(reply && reply.ctime);
      const commentId = normId(reply && (reply.rpid_str || reply.rpid));
      const message = reply && reply.content && (reply.content.message || reply.content.text);
      return {
        keys: [makeIdentityKey('bili:uid', mid)],
        label: normId(member.uname) || ('UID ' + mid),
        note: message ? 'B站评论：' + String(message).replace(/\s+/g, ' ').trim().slice(0, 360) : '',
        ctime: Number.isFinite(ctime) && ctime > 0 ? ctime : 0,
        commentId, threadId: normId(threadId) || commentId,
        level: level === 'reply' ? 'reply' : 'root', source: 'api',
      };
    }

    // 抓取当前视频的全部根评论与已公开的子回复作者。onProgress 用于 UI 反馈；
    // 任何一页失败都记为 partial，调用方必须据此提示"未取全"，不得当成完整名单。
    async function fetchAllCommentAuthors(onProgress) {
      if (!isVideoCommentPage()) throw new Error('not a video page');
      if (typeof fetch !== 'function') throw new Error('fetch unavailable');
      const aid = videoAidFromPage();
      if (!aid) throw new Error('video id unavailable');
      const records = [];
      const subRoots = [];
      let partial = false;
      let reason = '';
      let next = 0;
      let mainPages = 0;
      let total = 0;
      let mainEnded = false;
      let subRootCandidates = 0;
      const report = () => { if (typeof onProgress === 'function') onProgress({ collected: records.length, total, partial }); };

      while (mainPages < REPLY_MAIN_PAGE_CAP) {
        let data;
        try {
          data = await fetchReplyJSON(REPLY_MAIN_API + '?oid=' + encodeURIComponent(aid)
            + '&type=1&mode=3&ps=' + REPLY_PAGE_SIZE + '&next=' + encodeURIComponent(next));
        } catch (e) { partial = true; reason = '根评论分页读取失败'; break; }
        mainPages++;
        const replies = Array.isArray(data.replies) ? data.replies : [];
        const cursor = data.cursor || {};
        if (!total) total = Number(cursor.all_count) || 0;
        for (const reply of replies) {
          const rootId = normId(reply && (reply.rpid_str || reply.rpid));
          const record = replyRecord(reply, rootId, 'root');
          if (record) records.push(record);
          const loaded = Array.isArray(reply && reply.replies) ? reply.replies : [];
          for (const sub of loaded) {
            const subRecord = replyRecord(sub, rootId, 'reply');
            if (subRecord) records.push(subRecord);
          }
          // 楼中楼只在接口里预置少量几条；rcount 更大说明还有未展开的子回复。
          const rcount = Number(reply && reply.rcount) || 0;
          if (rcount > loaded.length) {
            subRootCandidates++;
            if (!rootId) {
              partial = true;
              reason = reason || '有子回复的根评论缺少可靠 root ID';
            } else if (subRoots.length < REPLY_SUB_ROOT_CAP) {
              subRoots.push(rootId);
            } else {
              partial = true;
              reason = reason || '有子回复的根评论达到安全读取上限';
            }
          }
        }
        report();
        if (cursor.is_end || !replies.length) { mainEnded = true; break; }
        const nextCursor = Number(cursor.next);
        if (!Number.isFinite(nextCursor) || nextCursor <= next) {
          partial = true;
          reason = reason || '根评论分页缺少连续 cursor';
          break;
        }
        next = nextCursor;
      }
      if (!mainEnded && mainPages >= REPLY_MAIN_PAGE_CAP) { partial = true; reason = reason || '根评论达到安全分页上限'; }
      if (!mainEnded && mainPages === 0) { partial = true; reason = reason || '根评论分页没有返回结束状态'; }
      if (subRootCandidates > REPLY_SUB_ROOT_CAP) { partial = true; reason = reason || '有子回复的根评论达到安全读取上限'; }

      for (const rootId of subRoots) {
        for (let page = 1; page <= REPLY_SUB_PAGE_CAP; page++) {
          let data;
          try {
            data = await fetchReplyJSON(REPLY_SUB_API + '?oid=' + encodeURIComponent(aid)
              + '&type=1&root=' + encodeURIComponent(rootId) + '&ps=' + REPLY_PAGE_SIZE + '&pn=' + page);
          } catch (e) { partial = true; reason = reason || '子回复分页读取失败'; break; }
          const replies = Array.isArray(data.replies) ? data.replies : [];
          for (const sub of replies) {
            const record = replyRecord(sub, rootId, 'reply');
            if (record) records.push(record);
          }
          report();
          const rawCount = data.page && data.page.count;
          const count = Number(rawCount);
          const hasCount = rawCount != null && Number.isFinite(count) && count >= 0;
          if (!replies.length || replies.length < REPLY_PAGE_SIZE || (hasCount && page * REPLY_PAGE_SIZE >= count)) break;
          if (page === REPLY_SUB_PAGE_CAP) { partial = true; reason = reason || '子回复达到安全分页上限'; }
        }
      }
      report();
      return { records, partial, total, reason };
    }

    async function loadThread(item, onProgress) {
      const container = commentThreadOf(item) || item;
      if (!container || !isRootComment(container)) throw new Error('root comment unavailable');
      const rootRenderer = deepQuery(container, 'bili-comment-renderer') || container;
      const rootId = commentThreadIdOf(rootRenderer);
      const records = collectCommentRecords(container);
      if (!/^\d+$/.test(rootId)) {
        return {
          records,
          partial: true,
          reason: '当前评论没有可用于只读接口的可靠 root ID',
        };
      }
      const aid = videoAidFromPage();
      if (!aid) return { records, partial: true, reason: '当前页面没有可靠视频 ID' };
      let partial = false;
      let reason = '';
      for (let page = 1; page <= REPLY_SUB_PAGE_CAP; page++) {
        let data;
        try {
          data = await fetchReplyJSON(REPLY_SUB_API + '?oid=' + encodeURIComponent(aid)
            + '&type=1&root=' + encodeURIComponent(rootId) + '&ps=' + REPLY_PAGE_SIZE + '&pn=' + page);
        } catch (error) {
          partial = true; reason = String(error && error.message || error).slice(0, 120); break;
        }
        const replies = Array.isArray(data.replies) ? data.replies : [];
        for (const reply of replies) {
          const record = replyRecord(reply, rootId, 'reply');
          if (record) records.push(record);
        }
        if (typeof onProgress === 'function') onProgress({ collected: records.length, page });
        const rawCount = data.page && data.page.count;
        const count = Number(rawCount);
        const hasCount = rawCount != null && Number.isFinite(count) && count >= 0;
        if (!replies.length || replies.length < REPLY_PAGE_SIZE || (hasCount && page * REPLY_PAGE_SIZE >= count)) break;
        if (page === REPLY_SUB_PAGE_CAP) { partial = true; reason = '单楼回复达到安全分页上限'; }
      }
      return { records, partial, reason };
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
      // 批量精细化只在视频评论区可用；动态页/空间页没有这套接口契约。
      bulkScope: { available: isVideoCommentPage, fetchAll: fetchAllCommentAuthors, unit: '评论作者' },
      commentManager: {
        available: () => isVideoCommentPage() && collectCommentRecords(document).length > 0,
        collectRecords: () => collectCommentRecords(document),
        loadAll: fetchAllCommentAuthors,
        loadThread,
        isRootComment,
      },
      containerOf: commentContainer,
      onScan: syncBiliAuthorButtons,
      onDisabled: clearBiliAuthorButtons,
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
    if (el.closest && el.closest('.menu,[role="menu"],.dropdown,.popup,.context-menu,.bili-popover,.modal,[role="dialog"],.dialog,.Dialog,[role="tooltip"],.semi-tooltip-wrapper')) return true;
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
    // 抖音评论菜单有时被挂到 body 的 portal，菜单项自身不再位于评论 DOM 链上；
    // 由用户打开“三个点”时记录的评论上下文提供同一条评论身份。
    if (typeof a.menuContextInfo === 'function') return a.menuContextInfo(anchor);
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
      showConfirm(info.label || '该用户', info.keys, anchorEl, null, null, info.note);
    };
    btn.addEventListener('click', activate);
    if (listItem) btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); });
    return btn;
  }

  function makeThreadBtn(anchorEl, cfg, key, adapter) {
    const listItem = anchorEl && anchorEl.tagName === 'LI';
    const btn = document.createElement(listItem ? 'li' : 'button');
    btn.className = 'ob-quick ob-thread-quick' + (listItem ? ' operation-option' : '');
    if (listItem) { btn.setAttribute('role', 'menuitem'); btn.tabIndex = 0; }
    else btn.type = 'button';
    btn.setAttribute('data-thread-key', key);
    btn.textContent = '🧵 屏蔽该楼回复';
    const activate = (event) => {
      event.stopPropagation(); event.preventDefault();
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) return;
      runThreadBlock(anchorEl, adapter);
    };
    btn.addEventListener('click', activate);
    if (listItem) btn.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
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
  // B站弹幕举报操作条的具体标签节点会随登录态和前端版本变化；在已经打开的菜单/对话框
  // 内，只补扫没有交互子节点的短文本叶子，避免把整页正文当成举报项。
  const QB_MENU_ROOT = '.menu,[role="menu"],.dropdown,.popup,.context-menu,.bili-popover,.modal,[role="dialog"],.dialog,.Dialog,.operation-list,[role="tooltip"],.semi-tooltip-wrapper';
  // 播放器浮动弹幕没有稳定公开 UID，也不接收指针事件（真站 CSS 写死
  // `pointer-events: none`）。弹幕模块用坐标命中解析出唯一 mid_hash 后写入这里，
  // 登录用户能弹出原生弹幕操作条时，「举报」菜单也可复用同一身份。
  const floatingDanmaku = {
    identity: null,
    timer: 0,
    remember(info) {
      this.identity = info && info.keys && info.keys.length ? { ...info, at: Date.now() } : null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.identity = null; }, 5000);
    },
    forget() {
      this.identity = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = 0;
    },
    fresh() {
      return this.identity && Date.now() - this.identity.at <= 5000 ? this.identity : null;
    },
  };

  let refreshQuickBlock = () => {};
  function setupQuickBlock() {
    const a = currentAdapter; if (!a) return;
    const cfg = QB[a.id]; if (!cfg) return;
    function clearInjected() {
      for (const button of querySelectorAllDeep(document, '.ob-quick')) button.remove();
      for (const anchor of querySelectorAllDeep(document, '[data-ob-qb]')) anchor.removeAttribute('data-ob-qb');
    }
    function tryInject(el) {
      if (!el || el.nodeType !== 1 || (el.classList && Array.from(el.classList).some((name) => name.startsWith('ob-')))) return;
      const inDouyinPortal = a.id === 'douyin' && el.closest
        && el.closest('[role="tooltip"],.semi-tooltip-wrapper');
      if (inDouyinPortal && !(el.matches && el.matches('[data-e2e="video-comment-more-report"]'))) return;
      if (!Store.getSetting('showQuickBlock')) return;
      const t = textOf(el);
      if (!t) return;
      for (const txt of cfg.anchorTexts) {
        if (t.indexOf(txt) !== -1 && isMenuItem(el)) {
          if (a.id === 'bilibili' && t.indexOf('举报') !== -1) {
            const dmInfo = floatingDanmaku.fresh();
            if (!dmInfo) {
              el.setAttribute('data-ob-qb', '1');
              return;
            }
            if (el.parentNode && el.parentNode.querySelector(':scope > .ob-quick')) return;
            const btn = makeQuickBtn(cfg.label || '本地拉黑', el, { identify: () => dmInfo }, dmInfo.keys.join('|'));
            el.setAttribute('data-ob-qb', '1');
            el.insertAdjacentElement('afterend', btn);
            return;
          }
          // 不向稿件举报等没有发送者上下文的菜单注入无效按钮。
          const info = cfg.identify ? cfg.identify(el) : identifyFromAnchor(el);
          if (!info || !info.keys || !info.keys.length) return;
          const parent = el.parentNode;
          if (!parent) return;
          // 该菜单已有本地按钮则复用；楼操作是独立入口，不能用同一个 class
          // 去重，否则会在重绘/周期扫描时丢失其中一个功能。
          let localButton = parent.querySelector(':scope > .ob-quick:not(.ob-thread-quick)');
          if (!localButton) {
            localButton = makeQuickBtn(cfg.label || '本地拉黑', el, cfg, txt);
            parent.insertBefore(localButton, el.nextSibling);
          }
          let rootComment = false;
          if (a.commentManager && typeof a.commentManager.isRootComment === 'function') {
            rootComment = !!(info.container && a.commentManager.isRootComment(info.container));
          }
          if (rootComment && !parent.querySelector(':scope > .ob-thread-quick')) {
            const threadButton = makeThreadBtn(el, cfg, txt, a);
            parent.insertBefore(threadButton, localButton.nextSibling);
          }
          el.setAttribute('data-ob-qb', '1');
          return;
        }
      }
    }
    function scanAll() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { clearInjected(); return; }
      for (const el of querySelectorAllDeep(document, QB_CANDIDATE)) tryInject(el);
      // 某些 B站登录态弹幕举报窗使用无 role/class 的 div 作为选项。只在已打开菜单根内
      // 检查叶子项，身份仍必须来自当前唯一浮动弹幕 hash，因而不会给普通举报窗乱挂入口。
      for (const root of querySelectorAllDeep(document, QB_MENU_ROOT)) {
        const tooltipRoot = root.matches && root.matches('[role="tooltip"],.semi-tooltip-wrapper');
        // 抖音当前的举报菜单是 portal：容器和内容层都带有同一段文字，只有
        // `[data-e2e="video-comment-more-report"]` 才是实际可点击的叶子项。
        // 若把 tooltip 内所有文字叶子都当菜单项，会在同一个菜单里插入 2~3 个入口。
        if (a.id === 'douyin' && tooltipRoot) {
          const portalRoot = (root.closest && root.closest('.semi-portal')) || root;
          const reports = querySelectorAllDeep(portalRoot, '[data-e2e="video-comment-more-report"]');
          const directButtons = reports.flatMap((report) => report.parentElement
            ? Array.from(report.parentElement.querySelectorAll(':scope > .ob-quick')) : []);
          const quicks = querySelectorAllDeep(portalRoot, '.ob-quick');
          for (const button of quicks) if (!directButtons.includes(button)) button.remove();
          for (const marked of querySelectorAllDeep(portalRoot, '[data-ob-qb]')) {
            if (!reports.includes(marked)) marked.removeAttribute('data-ob-qb');
          }
          for (const el of reports) tryInject(el);
          continue;
        }
        const leaves = querySelectorAllDeep(root, '*').filter((el) => {
          if (!el || el === root || !el.parentElement) return false;
          const text = textOf(el);
          if (!text || text.length > 120) return false;
          if ((el.children || []).length > 2) return false;
          const interactive = el.querySelector && el.querySelector('a,button,[role="menuitem"],[role="button"],li');
          if (interactive) return false;
          return (el.children || []).length === 0
            && (tooltipRoot || (el.parentElement.children || []).length >= 2);
        });
        for (const el of leaves) tryInject(el);
      }
    }
    const probeMenuEvent = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const el of path) {
        if (!el || el.nodeType !== 1) continue;
        const text = textOf(el);
        if (text && text.length <= 120 && cfg.anchorTexts.some((anchor) => text.indexOf(anchor) !== -1)) tryInject(el);
      }
    };
    // 举报项常在鼠标悬停后才瞬时挂载；事件触发补扫能赶在菜单关闭前插入入口，
    // 周期扫描仍负责键盘打开和无鼠标场景。
    document.addEventListener('pointerover', probeMenuEvent, true);
    document.addEventListener('focusin', probeMenuEvent, true);
    if (typeof a.rememberMenuContext === 'function') {
      document.addEventListener('pointerdown', (event) => a.rememberMenuContext(event), true);
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

  function blockMany(list, anchorEl, confirmLabel, onBlocked, toastLabel) {
    if (!list.length) { showToast('没有可拉黑的用户'); return; }
    const keys = [];
    list.forEach((i) => i.keys.forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
    showConfirm(confirmLabel || ('拉黑全部 ' + list.length + ' 位用户'), keys, anchorEl, onBlocked, () => {
      const results = Store.addIdentityGroups(list.map((info) => ({ keys: info.keys, label: info.label, note: info.note })));
      const addedKeys = [];
      for (const result of results) {
        for (const key of result.addedKeys) if (!addedKeys.includes(key)) addedKeys.push(key);
      }
      return {
        result: { added: addedKeys.length, addedKeys },
        undo: addedKeys.length ? () => Store.removeIdentities(addedKeys) : null,
      };
    }, '', toastLabel);
  }

  // 评论管理器内部的统一记录。记录只在本机内存中用于当前页面的选择与说明，
  // 真正写入名单时仍只提交规范化身份键和现有的 label/note 字段。
  function normalizeCommentRecord(info, fallbackSource = 'dom') {
    if (!info || !info.keys) return null;
    const keys = normalizeIdentityKeys(info.keys);
    if (!keys.length) return null;
    const level = info.level === 'reply' ? 'reply' : 'root';
    return {
      ...info,
      keys,
      label: String(info.label || '').trim(),
      note: String(info.note || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      ctime: Number(info.ctime) > 0 ? Number(info.ctime) : 0,
      threadId: info.threadId == null ? '' : String(info.threadId),
      level,
      source: info.source === 'api' ? 'api' : fallbackSource,
    };
  }

  const commentRecordObjectIds = new WeakMap();
  let nextCommentRecordObjectId = 1;
  function commentRecordInstanceKey(info) {
    if (!info) return '';
    if (info.commentId != null && String(info.commentId)) {
      return 'id:' + String(info.commentId) + '|' + (info.threadId || '') + '|' + (info.level || 'root');
    }
    if (info.container && (typeof info.container === 'object' || typeof info.container === 'function')) {
      let id = commentRecordObjectIds.get(info.container);
      if (!id) { id = String(nextCommentRecordObjectId++); commentRecordObjectIds.set(info.container, id); }
      return 'node:' + id;
    }
    return [info.keys && info.keys.join('|'), info.threadId || '', info.level || 'root', info.note || ''].join('|');
  }

  function mergeCommentRecords(items) {
    const entries = [];
    const keyEntries = new Map();
    const recordEntries = new Map();
      const mergeEntry = (target, source) => {
        if (target === source) return target;
        for (const key of source.keys) {
          if (!target.keys.includes(key)) target.keys.push(key);
          keyEntries.set(key, target);
        }
      target.count += source.count;
      for (const level of source.levels) target.levels.add(level);
        if (!target.label && source.label) target.label = source.label;
        if (source.note && (!target.note || source.ctime > target.ctime)) target.note = source.note;
        if (source.ctime > target.ctime) target.ctime = source.ctime;
        if (source.threadIds) for (const id of source.threadIds) if (id) target.threadIds.add(id);
        if (source.sources) for (const sourceName of source.sources) target.sources.add(sourceName);
        const at = entries.indexOf(source);
        if (at >= 0) entries.splice(at, 1);
        for (const ref of recordEntries.values()) if (ref.entry === source) ref.entry = target;
        return target;
    };
    for (const raw of items || []) {
      const info = normalizeCommentRecord(raw, raw && raw.source || 'dom');
      if (!info) continue;
      const instanceKey = commentRecordInstanceKey(info);
      const seenRecord = recordEntries.get(instanceKey);
      if (seenRecord) {
        // DOM 记录和 API 记录可能指向同一条评论；不重复计数，但让 API 返回的
        // 正文/时间补充到已有行，保证管理器显示的是更有代表性的样例。
        const entry = seenRecord.entry;
        if (info.label && !entry.label) entry.label = info.label;
        if (info.note && (!entry.note || info.ctime > entry.ctime)) entry.note = info.note;
        if (info.ctime > entry.ctime) entry.ctime = info.ctime;
        continue;
      }
      const matched = new Set();
      for (const key of info.keys) {
        const entry = keyEntries.get(key);
        if (entry) matched.add(entry);
      }
      let entry = Array.from(matched)[0] || null;
      const incoming = {
        keys: info.keys.slice(), label: info.label, note: info.note, ctime: info.ctime,
        count: 1, levels: new Set([info.level]), threadIds: new Set(info.threadId ? [info.threadId] : []),
        sources: new Set([info.source]),
      };
      if (!entry) {
        entry = incoming;
        entries.push(entry);
        for (const key of entry.keys) keyEntries.set(key, entry);
      } else {
        entry.count += incoming.count;
        for (const key of incoming.keys) {
          if (!entry.keys.includes(key)) entry.keys.push(key);
          keyEntries.set(key, entry);
        }
        for (const level of incoming.levels) entry.levels.add(level);
        for (const sourceName of incoming.sources) entry.sources.add(sourceName);
        if (!entry.label && incoming.label) entry.label = incoming.label;
        if (incoming.note && (!entry.note || incoming.ctime > entry.ctime)) entry.note = incoming.note;
        if (incoming.ctime > entry.ctime) entry.ctime = incoming.ctime;
        for (const id of incoming.threadIds) if (id) entry.threadIds.add(id);
      }
      recordEntries.set(instanceKey, { entry });
      for (const other of Array.from(matched)) if (other !== entry) entry = mergeEntry(entry, other);
    }
    return entries.map((entry) => ({
      ...entry,
      levels: Array.from(entry.levels),
      threadIds: Array.from(entry.threadIds),
      threadId: entry.threadIds.size ? Array.from(entry.threadIds)[0] : '',
      level: entry.levels.size === 1 ? Array.from(entry.levels)[0] : 'mixed',
      source: entry.sources.size === 1 ? Array.from(entry.sources)[0] : 'mixed',
    }));
  }

  function commentLevelLabel(levels) {
    const values = new Set(Array.isArray(levels) ? levels : [levels]);
    if (values.has('root') && values.has('reply')) return '主评论、回复';
    return values.has('reply') ? '回复' : '主评论';
  }

  let douyinCommentManager = null;
  let douyinCommentManagerKeyHandler = null;
  function closeDouyinCommentManager() {
    if (douyinCommentManagerKeyHandler) document.removeEventListener('keydown', douyinCommentManagerKeyHandler);
    douyinCommentManagerKeyHandler = null;
    if (douyinCommentManager) douyinCommentManager.remove();
    douyinCommentManager = null;
  }

  // 抖音评论使用独立管理器：页面本身的评论列表是虚拟/懒加载的，不能把“当前可见作者”
  // 误称为全量。管理器打开后自动尝试展开带明确回复数量语义的控件，按钮可在需要时重试，
  // 再重新收集作者，避免猜测平台内部接口或触发评论写入操作。
  function openDouyinCommentManager(adapter) {
    if (douyinCommentManager) { closeDouyinCommentManager(); return; }
    if (!document.body) return;
    const selected = new Set();
    const commentRecords = new Map();
    let commentPageKey = '';
    let searchText = '';
    let loadingRunning = false;
    douyinCommentManager = document.createElement('div');
    douyinCommentManager.id = 'ob-douyin-comment-manager';
    douyinCommentManager.innerHTML = `
      <div class="ob-dc-box" role="dialog" aria-modal="true" aria-labelledby="ob-dc-title">
        <div class="ob-dc-head"><h2 id="ob-dc-title">抖音评论屏蔽</h2><button class="ob-dc-close" type="button" aria-label="关闭">×</button></div>
        <div class="ob-dc-toolbar">
          <input class="ob-dc-search" type="search" placeholder="搜索已加载评论" aria-label="搜索已加载评论">
          <button class="ob-dc-load" type="button">尽量加载评论</button>
          <button class="ob-dc-expand" type="button">加载全部子评论</button>
          <label class="ob-dc-checkall"><input type="checkbox">全选当前列表</label>
          <div class="ob-dc-status"></div>
        </div>
        <div class="ob-dc-list"></div>
        <div class="ob-dc-footer"><span class="ob-dc-count"></span><button class="ob-dc-batch" type="button">屏蔽选中(0)</button></div>
      </div>`;
    document.body.appendChild(douyinCommentManager);
    const panel = douyinCommentManager;
    const close = () => closeDouyinCommentManager();
    panel.querySelector('.ob-dc-close').onclick = close;
    panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
    douyinCommentManagerKeyHandler = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', douyinCommentManagerKeyHandler);

    const keyOf = (info) => (info && info.keys || []).join('|');
    const currentPageKey = () => typeof adapter.videoKey === 'function'
      ? adapter.videoKey() : location.pathname + location.search;
    const getRecords = () => {
      const nextKey = currentPageKey();
      if (commentPageKey && nextKey !== commentPageKey) { commentRecords.clear(); selected.clear(); }
      commentPageKey = nextKey;
      for (const info of uniqueUsers(collectUsers(document, 'comment-manager'))) {
        const key = keyOf(info);
        if (!key) continue;
        const existing = commentRecords.get(key);
        if (!existing) commentRecords.set(key, { ...info });
        else {
          if (!existing.label && info.label) existing.label = info.label;
          if (!existing.note && info.note) existing.note = info.note;
        }
      }
      return Array.from(commentRecords.values()).filter((info) => !Index.isBlocked(info.keys));
    };
    const filterRecords = (records) => {
      const term = String(searchText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!term) return records;
      return records.filter((info) => [info.label, info.note, ...(info.keys || [])]
        .join(' ').toLowerCase().includes(term));
    };
    const status = panel.querySelector('.ob-dc-status');
    const count = panel.querySelector('.ob-dc-count');
    const list = panel.querySelector('.ob-dc-list');
    const checkAll = panel.querySelector('.ob-dc-checkall input');
    const batch = panel.querySelector('.ob-dc-batch');
    const search = panel.querySelector('.ob-dc-search');
    const load = panel.querySelector('.ob-dc-load');
    const expand = panel.querySelector('.ob-dc-expand');

    function render() {
      if (!panel.isConnected) return;
      const records = getRecords();
      const filtered = filterRecords(records);
      const available = new Set(records.map(keyOf));
      for (const key of Array.from(selected)) if (!available.has(key)) selected.delete(key);
      list.textContent = '';
      if (!filtered.length) {
        const empty = document.createElement('div'); empty.className = 'ob-dc-empty';
        empty.textContent = searchText.trim() ? '没有匹配的已加载评论' : '当前还没有可识别的抖音评论作者'; list.appendChild(empty);
      }
      for (const info of filtered) {
        const key = keyOf(info);
        const row = document.createElement('label'); row.className = 'ob-dc-row';
        row.setAttribute('data-key', key);
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key);
        checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(key); else selected.delete(key); render(); });
        const body = document.createElement('div');
        const name = document.createElement('div'); name.className = 'ob-dc-name'; name.textContent = info.label || key;
        body.appendChild(name);
        if (info.note) { const note = document.createElement('div'); note.className = 'ob-dc-note'; note.textContent = info.note; body.appendChild(note); }
        row.append(checkbox, body); list.appendChild(row);
      }
      count.textContent = filtered.length === records.length
        ? records.length + ' 位评论作者'
        : '匹配 ' + filtered.length + ' / 共 ' + records.length + ' 位评论作者';
      checkAll.checked = !!filtered.length && filtered.every((info) => selected.has(keyOf(info)));
      checkAll.indeterminate = !checkAll.checked && filtered.some((info) => selected.has(keyOf(info)));
      batch.disabled = !selected.size;
      batch.textContent = '屏蔽选中(' + selected.size + ')';
    }
    search.value = searchText;
    search.oninput = () => { searchText = search.value; render(); };
    checkAll.onchange = () => {
      for (const info of filterRecords(getRecords())) {
        const key = keyOf(info);
        if (checkAll.checked) selected.add(key); else selected.delete(key);
      }
      render();
    };
    batch.onclick = () => {
      const records = getRecords().filter((info) => selected.has(keyOf(info)));
      if (!records.length) return;
      blockMany(records, batch, '屏蔽选中的 ' + records.length + ' 位抖音评论作者', () => { selected.clear(); render(); });
    };
    load.onclick = async () => {
      if (loadingRunning || !adapter.commentManager || typeof adapter.commentManager.loadMore !== 'function') return;
      loadingRunning = true; load.disabled = true; expand.disabled = true;
      status.textContent = '正在滚动评论区并等待懒加载…';
      try {
        const result = await adapter.commentManager.loadMore((progress) => {
          getRecords();
          status.textContent = '已滚动 ' + progress.scrolls + ' 次，当前观察到 ' + progress.comments + ' 个评论节点…';
          render();
        });
        status.textContent = result.supported
          ? '已尽量滚动当前评论容器；平台回收/未提供的评论不会被猜测。'
          : '未找到可安全滚动的评论容器，请手动滚动评论区后再打开弹窗。';
      } catch (error) {
        status.textContent = '加载评论失败：' + String(error && error.message || error).slice(0, 100);
      }
      loadingRunning = false; load.disabled = false; expand.disabled = false; render();
    };
    let expansionRunning = false;
    const expandAll = async () => {
      if (expansionRunning) return;
      if (!adapter.commentManager || typeof adapter.commentManager.expandAll !== 'function') return;
      expansionRunning = true;
      expand.disabled = true; status.textContent = '正在展开带明确回复数量的子评论…';
      try {
        const result = await adapter.commentManager.expandAll((clicked) => {
          if (panel.isConnected) status.textContent = '已展开 ' + clicked + ' 个回复入口，正在等待评论加载…';
        });
        status.textContent = result.clicked
          ? '已尝试展开 ' + result.clicked + ' 个回复入口；未提供明确展开控件的评论不会被猜测。'
          : '当前页面没有找到可安全展开的回复入口，已显示当前已加载评论。';
      } catch (error) {
        status.textContent = '展开失败：' + String(error && error.message || error).slice(0, 100);
      }
      expansionRunning = false; expand.disabled = false; render();
    };
    expand.onclick = expandAll;
    status.textContent = '正在自动加载带明确回复数量的子评论…';
    render();
    // 先展开当前已加载的明确回复，再做只读滚动尽量加载；用户仍可再次点击按钮重试。
    // 两步串行，避免滚动与平台回复渲染同时发生时互相覆盖状态。
    expandAll().then(() => { if (panel.isConnected) load.click(); });
  }

  // 三个平台共用的评论管理器。旧版抖音管理器保留在上方仅用于升级期间的兼容，
  // 新入口统一走这里，避免 B站/抖音/微博各自维护一套选择、搜索和提交逻辑。
  let commentManagerRoot = null;
  let commentManagerKeyHandler = null;
  function platformLabelForCommentManager(adapter) {
    return ({ bilibili: 'B站', douyin: '抖音', weibo: '微博' }[adapter && adapter.id]) || '评论';
  }
  function closeCommentManager() {
    if (commentManagerKeyHandler) document.removeEventListener('keydown', commentManagerKeyHandler);
    commentManagerKeyHandler = null;
    if (commentManagerRoot) commentManagerRoot.remove();
    commentManagerRoot = null;
  }

  async function openCommentManager(adapter, anchorEl) {
    if (commentManagerRoot) { closeCommentManager(); return; }
    const manager = adapter && adapter.commentManager;
    if (!document.body || !manager || typeof manager.collectRecords !== 'function') return;
    if (typeof manager.available === 'function' && !manager.available()) {
      showToast('当前页面没有可识别的评论');
      return;
    }
    const selected = new Set();
    const discovered = [];
    let pageKey = '';
    let searchText = '';
    let loading = false;
    let partial = false;
    let partialReason = '';
    const platformLabels = { bilibili: 'B站', douyin: '抖音', weibo: '微博' };
    const platformLabel = platformLabels[adapter.id] || adapter.id || '平台';
    const panel = document.createElement('div');
    panel.id = 'ob-comment-manager';
    panel.setAttribute('data-ob-ui', 'comment-manager');
    panel.setAttribute('data-ob-platform', adapter.id || '');
    panel.innerHTML = `
      <div class="ob-cm-box" data-ob-ui="comment-manager" role="dialog" aria-modal="true" aria-labelledby="ob-cm-title">
        <div class="ob-cm-head"><h2 id="ob-cm-title">${platformLabel}评论屏蔽</h2><button class="ob-cm-close" type="button" aria-label="关闭">×</button></div>
        <div class="ob-cm-toolbar" data-ob-ui="comment-manager">
          <input class="ob-cm-search" type="search" placeholder="搜索作者、评论或身份键" aria-label="搜索评论作者、示例评论或身份键">
          <button class="ob-cm-refresh" type="button">刷新已识别评论</button>
          <button class="ob-cm-load-all" type="button">加载全部评论与子回复</button>
          <label class="ob-cm-since-wrap"><span>时间</span><select class="ob-cm-since" aria-label="评论时间筛选"></select></label>
          <label class="ob-cm-checkall"><input type="checkbox">全选筛选结果</label>
          <div class="ob-cm-status" aria-live="polite"></div>
        </div>
        <div class="ob-cm-list" data-ob-ui="comment-manager"></div>
        <div class="ob-cm-footer" data-ob-ui="comment-manager"><span class="ob-cm-count"></span><button class="ob-cm-batch" type="button">屏蔽选中(0)</button></div>
      </div>`;
    document.body.appendChild(panel);
    commentManagerRoot = panel;
    const close = () => closeCommentManager();
    panel.querySelector('.ob-cm-close').onclick = close;
    panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
    commentManagerKeyHandler = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', commentManagerKeyHandler);

    const keyOf = (info) => (info && info.keys || []).join('|');
    const currentPageKey = () => typeof adapter.videoKey === 'function'
      ? adapter.videoKey() : location.pathname + location.search + location.hash;
    const collectCurrent = () => {
      const nextKey = currentPageKey();
      if (pageKey && nextKey !== pageKey) { discovered.length = 0; selected.clear(); partial = false; partialReason = ''; }
      pageKey = nextKey;
      let records = [];
      try { records = manager.collectRecords('manager') || []; } catch (error) { records = []; }
      for (const record of records) discovered.push(record);
      return mergeCommentRecords(discovered).filter((info) => !Index.isBlocked(info.keys));
    };
    const sinceSelect = panel.querySelector('.ob-cm-since');
    for (const preset of (typeof BULK_SINCE_PRESETS !== 'undefined' ? BULK_SINCE_PRESETS : [{ value: '', label: '不限时间' }])) {
      const option = document.createElement('option'); option.value = preset.value; option.textContent = preset.label; sinceSelect.appendChild(option);
    }
    if (adapter.id !== 'bilibili') panel.querySelector('.ob-cm-since-wrap').style.display = 'none';
    const status = panel.querySelector('.ob-cm-status');
    const count = panel.querySelector('.ob-cm-count');
    const list = panel.querySelector('.ob-cm-list');
    const checkAll = panel.querySelector('.ob-cm-checkall input');
    const batch = panel.querySelector('.ob-cm-batch');
    const search = panel.querySelector('.ob-cm-search');
    const refresh = panel.querySelector('.ob-cm-refresh');
    const loadAll = panel.querySelector('.ob-cm-load-all');
    let customSince = 0;

    function selectedSince() {
      if (sinceSelect.value === 'custom') {
        if (!customSince) {
          const value = window.prompt('请输入起始时间（例如 2026-08-27 12:00）');
          if (!value) return { error: '未填写自定义时间' };
          const parsed = Date.parse(value.replace(/-/g, '/'));
          if (!Number.isFinite(parsed)) return { error: '自定义时间格式无效' };
          customSince = Math.floor(parsed / 1000);
        }
        return { since: customSince };
      }
      const seconds = Number(sinceSelect.value);
      return { since: sinceSelect.value && Number.isFinite(seconds) && seconds > 0
        ? Math.floor(Date.now() / 1000) - seconds : 0 };
    }

    function filterRecords(records) {
      const since = selectedSince();
      if (since.error) return { records: [], dropped: 0, unknown: 0, error: since.error };
      let kept = records; let dropped = 0; let unknown = 0;
      if (since.since) {
        kept = [];
        for (const record of records) {
          const ctime = Number(record.ctime) || 0;
          if (!ctime) { unknown++; continue; }
          if (ctime >= since.since) kept.push(record); else dropped++;
        }
      }
      const term = String(searchText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (term) kept = kept.filter((info) => [info.label, info.note, ...(info.keys || []), commentLevelLabel(info.levels)]
        .join(' ').toLowerCase().includes(term));
      return { records: kept, dropped, unknown, error: '' };
    }

    function render() {
      if (!panel.isConnected) return;
      const allRecords = collectCurrent();
      const filtered = filterRecords(allRecords);
      const available = new Set(allRecords.map(keyOf));
      for (const key of Array.from(selected)) if (!available.has(key)) selected.delete(key);
      list.textContent = '';
      if (!filtered.records.length) {
        const empty = document.createElement('div'); empty.className = 'ob-cm-empty';
        empty.textContent = filtered.error || (searchText.trim() ? '没有匹配的评论作者' : '当前还没有可识别的评论作者');
        list.appendChild(empty);
      }
      for (const info of filtered.records) {
        const key = keyOf(info);
        const row = document.createElement('label'); row.className = 'ob-cm-row'; row.setAttribute('data-key', key); row.setAttribute('data-ob-ui', 'comment-manager');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key);
        checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(key); else selected.delete(key); render(); });
        const body = document.createElement('div'); body.className = 'ob-cm-body';
        const name = document.createElement('div'); name.className = 'ob-cm-name'; name.textContent = info.label || key;
        const meta = document.createElement('div'); meta.className = 'ob-cm-meta';
        meta.textContent = info.count + ' 条评论 · ' + commentLevelLabel(info.levels);
        body.append(name, meta);
        if (info.note) { const note = document.createElement('div'); note.className = 'ob-cm-note'; note.textContent = info.note; body.appendChild(note); }
        row.append(checkbox, body); list.appendChild(row);
      }
      count.textContent = filtered.records.length === allRecords.length
        ? allRecords.length + ' 位作者' : '匹配 ' + filtered.records.length + ' / 共 ' + allRecords.length + ' 位作者';
      if (filtered.dropped || filtered.unknown) count.textContent += '（时间筛选排除 ' + (filtered.dropped + filtered.unknown) + '）';
      checkAll.checked = !!filtered.records.length && filtered.records.every((info) => selected.has(keyOf(info)));
      checkAll.indeterminate = !checkAll.checked && filtered.records.some((info) => selected.has(keyOf(info)));
      batch.disabled = !selected.size;
      batch.textContent = '屏蔽选中(' + selected.size + ')';
      const notices = [];
      if (partial) notices.push('部分加载' + (partialReason ? '：' + partialReason : ''));
      if (loading) notices.push('正在读取…');
      if (filtered.unknown) notices.push('时间未知 ' + filtered.unknown + ' 位已跳过');
      status.textContent = notices.join('；') || (allRecords.length ? '已显示当前路由内已识别的评论作者' : '');
    }

    async function loadAllRecords() {
      if (loading || typeof manager.loadAll !== 'function') return;
      loading = true; loadAll.disabled = true; refresh.disabled = true; render();
      try {
        const result = await manager.loadAll((progress) => {
          if (!panel.isConnected) return;
          const collected = progress && (progress.collected != null ? progress.collected : progress.records);
          status.textContent = '正在加载评论' + (collected != null ? '，已读取 ' + collected + ' 条' : '…');
          render();
        });
        for (const record of (result && result.records || [])) discovered.push(record);
        partial = !!(result && result.partial);
        partialReason = String(result && result.reason || '').slice(0, 160);
      } catch (error) {
        partial = true;
        partialReason = String(error && error.message || error).slice(0, 160);
      }
      loading = false; loadAll.disabled = false; refresh.disabled = false; render();
    }

    search.oninput = () => { searchText = search.value; render(); };
    sinceSelect.onchange = () => { customSince = 0; render(); };
    refresh.onclick = () => { partial = false; partialReason = ''; render(); status.textContent = '已刷新当前已识别评论'; };
    checkAll.onchange = () => {
      const records = filterRecords(collectCurrent()).records;
      for (const info of records) { const key = keyOf(info); if (checkAll.checked) selected.add(key); else selected.delete(key); }
      render();
    };
    batch.onclick = () => {
      const records = filterRecords(collectCurrent()).records.filter((info) => selected.has(keyOf(info)));
      if (!records.length) return;
      const suffix = partial ? '（部分加载，可能仍有未读取评论）' : '';
      blockMany(records, batch, '屏蔽选中的 ' + records.length + ' 位作者' + suffix,
        () => { selected.clear(); render(); }, '选中的 ' + records.length + ' 位作者' + suffix);
    };
    loadAll.onclick = loadAllRecords;
    render();
    // B站走只读 API；抖音/微博走已确认的可见 DOM、回复展开和安全滚动。
    // 打开面板即执行一次，失败时保留已识别记录并明确标记部分。
    loadAllRecords();
  }

  const pendingThreadBlocks = new WeakSet();
  async function runThreadBlock(anchorEl, adapter, providedInfo) {
    const manager = adapter && adapter.commentManager;
    if (!manager || typeof manager.loadThread !== 'function') { showToast('当前平台不支持楼操作'); return; }
    const info = providedInfo || (typeof adapter.menuContextInfo === 'function'
      ? adapter.menuContextInfo(anchorEl) : identifyFromAnchor(anchorEl));
    const item = info && info.container;
    if (!info || !info.keys || !info.keys.length || !item
      || (typeof manager.isRootComment === 'function' && !manager.isRootComment(item))) {
      showToast('只能从可确认的主评论执行“屏蔽该楼回复”');
      return;
    }
    if (pendingThreadBlocks.has(item)) return;
    pendingThreadBlocks.add(item);
    showToast('正在读取该楼已可加载的回复…');
    let partial = false; let reason = '';
    const records = [normalizeCommentRecord({ ...info, level: 'root', source: 'dom' })].filter(Boolean);
    try {
      const result = await manager.loadThread(item, (progress) => {
        if (progress && progress.collected != null) showToast('正在读取该楼回复：' + progress.collected + ' 条');
      });
      for (const record of (result && result.records || [])) records.push(record);
      partial = !!(result && result.partial);
      reason = String(result && result.reason || '').slice(0, 160);
    } catch (error) {
      partial = true;
      reason = String(error && error.message || error).slice(0, 160);
    } finally {
      pendingThreadBlocks.delete(item);
    }
    const merged = mergeCommentRecords(records);
    if (!merged.length) { showToast('没有读取到可靠的楼成员'); return; }
    const suffix = partial ? '（部分：已加载 ' + merged.length + ' 位，可能仍有未加载回复' + (reason ? '；' + reason : '') + '）' : '';
    blockMany(merged, anchorEl, '屏蔽该楼及 ' + merged.length + ' 位作者' + suffix, null,
      '该楼及 ' + merged.length + ' 位作者' + suffix);
  }

  let douyinDanmakuTool = null;
  let douyinDanmakuManager = null;
  let douyinDanmakuManagerKeyHandler = null;

  function closeDouyinDanmakuManager() {
    if (douyinDanmakuManagerKeyHandler) document.removeEventListener('keydown', douyinDanmakuManagerKeyHandler);
    douyinDanmakuManagerKeyHandler = null;
    if (douyinDanmakuManager) douyinDanmakuManager.remove();
    douyinDanmakuManager = null;
  }

  // 抖音弹幕节点会持续滚动和复用；这里累积当前视频本轮已观察到的可靠发送者，
  // 再用本地多选面板一次提交。它不读取平台私有接口，也不把没有身份属性的节点列入名单。
  function setupDouyinDanmakuManager() {
    const adapter = currentAdapter;
    if (!adapter || adapter.id !== 'douyin' || typeof adapter.collectDanmaku !== 'function') return;
    const records = new Map();
    const selected = new Set();
    let videoKey = '';
    let sessionGeneration = 0;
    let searchText = '';
    let scanRunning = false;
    let scanStatus = '';
    let scanRun = null;

    const keyOf = (info) => (info && info.keys || []).join('|');
    const readVideoKey = () => typeof adapter.videoKey === 'function'
      ? adapter.videoKey() : location.pathname + location.search;
    const resetForVideo = (nextVideoKey) => {
      if (!videoKey) { videoKey = nextVideoKey; return false; }
      if (nextVideoKey === videoKey) return false;
      videoKey = nextVideoKey;
      sessionGeneration++;
      records.clear(); selected.clear();
      searchText = '';
      scanStatus = '';
      if (scanRun) scanRun.cancelled = true;
      scanRun = null;
      scanRunning = false;
      closeDouyinDanmakuManager();
      return true;
    };
    const collectRecords = () => {
      resetForVideo(readVideoKey());
      const scope = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
      for (const info of adapter.collectDanmaku(scope || document) || []) {
        const key = keyOf(info);
        if (!key) continue;
        const existing = records.get(key);
        if (!existing) records.set(key, { ...info, messageCount: Math.max(1, Number(info.messageCount) || 1) });
        else {
          existing.messageCount = Math.max(existing.messageCount, Number(info.messageCount) || 1);
          if (!existing.label && info.label) existing.label = info.label;
          if (!existing.note && info.note) existing.note = info.note;
        }
      }
      return Array.from(records.values()).filter((info) => !Index.isBlocked(info.keys));
    };

    function render() {
      const panel = douyinDanmakuManager;
      if (!panel || !panel.isConnected) return;
      const available = collectRecords();
      // collectRecords() 可能在本次渲染中发现播放器已切到下一个视频并关闭旧面板；
      // 不能继续向已移除的旧节点写 DOM，也不能让旧面板的事件回调复活它。
      if (douyinDanmakuManager !== panel || !panel.isConnected) return;
      const availableKeys = new Set(available.map(keyOf));
      for (const key of Array.from(selected)) if (!availableKeys.has(key)) selected.delete(key);
      const term = String(searchText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const filtered = term
        ? available.filter((info) => [info.label, info.note, ...(info.keys || [])].join(' ').toLowerCase().includes(term))
        : available;
      const list = panel.querySelector('.ob-dd-list');
      list.textContent = '';
      if (!filtered.length) {
        const empty = document.createElement('div'); empty.className = 'ob-dd-empty';
        empty.textContent = term ? '没有匹配的抖音弹幕发送者' : '当前视频还没有观察到带可靠身份的弹幕';
        list.appendChild(empty);
      }
      for (const info of filtered) {
        const key = keyOf(info);
        const row = document.createElement('label'); row.className = 'ob-dd-row'; row.setAttribute('data-key', key);
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(key); else selected.delete(key);
          render();
        });
        const body = document.createElement('div');
        const name = document.createElement('div'); name.className = 'ob-dd-name';
        name.textContent = info.label || '抖音弹幕发送者';
        const note = document.createElement('div'); note.className = 'ob-dd-note';
        note.textContent = (info.note || '当前视频弹幕') + ' · 观察到 ' + (Number(info.messageCount) || 1) + ' 条';
        body.append(name, note);
        row.append(checkbox, body); list.appendChild(row);
      }
      const checkAll = panel.querySelector('.ob-dd-checkall input');
      checkAll.checked = !!filtered.length && filtered.every((info) => selected.has(keyOf(info)));
      checkAll.indeterminate = !checkAll.checked && filtered.some((info) => selected.has(keyOf(info)));
      checkAll.onchange = () => {
        for (const info of filtered) {
          const key = keyOf(info);
          if (checkAll.checked) selected.add(key); else selected.delete(key);
        }
        render();
      };
      const selectedRecords = available.filter((info) => selected.has(keyOf(info)));
      const batch = panel.querySelector('.ob-dd-batch');
      batch.disabled = !selectedRecords.length;
      batch.textContent = '屏蔽选中(' + selectedRecords.length + ')';
      batch.onclick = () => {
        const current = collectRecords().filter((info) => selected.has(keyOf(info)));
        if (!current.length) return;
        blockMany(current, batch, '屏蔽选中的 ' + current.length + ' 位抖音弹幕发送者', () => {
          selected.clear(); render(); refresh();
        });
      };
      const totalMessages = filtered.reduce((sum, info) => sum + (Number(info.messageCount) || 1), 0);
      panel.querySelector('.ob-dd-status').textContent = scanStatus
        || (filtered.length + ' 位发送者 · 观察到 ' + totalMessages + ' 条弹幕');
      const scan = panel.querySelector('.ob-dd-scan');
      scan.disabled = scanRunning;
      scan.textContent = scanRunning ? '扫描中…' : '尽量加载弹幕';
    }

    async function scanDanmakuTimeline() {
      if (scanRunning) return;
      resetForVideo(readVideoKey());
      const scope = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
      const video = querySelectorAllDeep(scope || document, 'video')[0]
        || querySelectorAllDeep(document, 'video')[0];
      const duration = Number(video && video.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) {
        scanStatus = '播放器尚未提供可扫描的总时长';
        render();
        return;
      }
      const requestedKey = readVideoKey();
      const requestedGeneration = sessionGeneration;
      const run = { key: requestedKey, generation: requestedGeneration, cancelled: false };
      scanRun = run;
      const originalTime = Number(video.currentTime) || 0;
      const wasPlaying = !video.paused && !video.ended;
      const sampleCount = Math.min(60, Math.max(6, Math.ceil(duration / 15)));
      let completed = 0;
      scanRunning = true;
      scanStatus = '正在扫描弹幕时间轴 0/' + sampleCount + '…';
      render();
      const sessionIsCurrent = () => {
        const currentKey = readVideoKey();
        if (currentKey !== requestedKey) {
          resetForVideo(currentKey);
          return false;
        }
        return scanRun === run && !run.cancelled && sessionGeneration === requestedGeneration;
      };
      const seekAndWait = (time) => new Promise((resolve) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          try { video.removeEventListener('seeked', done); } catch (e) {}
          resolve();
        };
        if (!sessionIsCurrent()) { done(); return; }
        try { video.addEventListener('seeked', done, { once: true }); } catch (e) {}
        try { video.currentTime = time; } catch (e) { done(); return; }
        setTimeout(done, 650);
      });
      try {
        if (wasPlaying) video.pause();
        for (let index = 0; index < sampleCount; index++) {
          if (!sessionIsCurrent()) break;
          const time = sampleCount === 1 ? 0 : Math.min(Math.max(0, duration - 0.05), duration * index / (sampleCount - 1));
          await seekAndWait(time);
          if (!sessionIsCurrent()) break;
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (!sessionIsCurrent()) break;
          collectRecords();
          completed = index + 1;
          scanStatus = '正在扫描弹幕时间轴 ' + completed + '/' + sampleCount + '…';
          render();
        }
      } finally {
        const currentKey = readVideoKey();
        if (currentKey !== requestedKey) {
          resetForVideo(currentKey);
          return;
        }
        if (scanRun !== run || run.cancelled || sessionGeneration !== requestedGeneration) return;
        try { video.currentTime = Math.min(Math.max(0, originalTime), Math.max(0, duration - 0.05)); } catch (e) {}
        if (wasPlaying) {
          try { const playing = video.play(); if (playing && playing.catch) playing.catch(() => {}); } catch (e) {}
        }
        scanRunning = false;
        scanRun = null;
        scanStatus = completed
          ? '已扫描 ' + completed + '/' + sampleCount + ' 个时间点；平台未渲染的弹幕不会被猜测。'
          : '未完成弹幕时间轴扫描；可稍后重试。';
        render();
      }
    }

    function open() {
      if (douyinDanmakuManager || !document.body) return;
      douyinDanmakuManager = document.createElement('div');
      douyinDanmakuManager.id = 'ob-douyin-dm-manager';
      douyinDanmakuManager.innerHTML = `
        <div class="ob-dd-box" role="dialog" aria-modal="true" aria-labelledby="ob-dd-title">
          <div class="ob-dd-head"><h2 id="ob-dd-title">抖音弹幕屏蔽</h2><button class="ob-dd-close" type="button" title="关闭" aria-label="关闭">×</button></div>
          <div class="ob-dd-toolbar">
            <input class="ob-dd-search" type="search" placeholder="搜索已观察弹幕" aria-label="搜索已观察弹幕">
            <button class="ob-dd-scan" type="button">尽量加载弹幕</button>
            <label class="ob-dd-checkall"><input type="checkbox">全选当前列表</label>
          </div>
          <div class="ob-dd-list"></div>
          <div class="ob-dd-footer"><span class="ob-dd-status"></span><button class="ob-dd-batch" type="button">屏蔽选中(0)</button></div>
        </div>`;
      const panel = douyinDanmakuManager;
      panel.querySelector('.ob-dd-close').onclick = closeDouyinDanmakuManager;
      panel.addEventListener('click', (event) => { if (event.target === panel) closeDouyinDanmakuManager(); });
      const search = panel.querySelector('.ob-dd-search');
      search.value = searchText;
      search.oninput = () => { searchText = search.value; render(); };
      panel.querySelector('.ob-dd-scan').onclick = () => { void scanDanmakuTimeline(); };
      douyinDanmakuManagerKeyHandler = (event) => { if (event.key === 'Escape') closeDouyinDanmakuManager(); };
      document.addEventListener('keydown', douyinDanmakuManagerKeyHandler);
      document.body.appendChild(panel);
      render();
    }

    function refresh() {
      const video = typeof adapter.isVideoPage === 'function' ? adapter.isVideoPage() : /^\/video\//i.test(location.pathname);
      const visible = Store.getSetting('enabled') && Store.getSetting('showBulkBlock') && video;
      if (!douyinDanmakuTool) {
        if (!document.body) { setTimeout(refresh, 300); return; }
        douyinDanmakuTool = document.createElement('button');
        douyinDanmakuTool.id = 'ob-douyin-dm-tool'; douyinDanmakuTool.type = 'button';
        douyinDanmakuTool.title = '管理当前视频已观察到的抖音弹幕发送者';
        douyinDanmakuTool.setAttribute('aria-label', '管理当前视频已观察到的抖音弹幕发送者');
        douyinDanmakuTool.onclick = open;
        document.body.appendChild(douyinDanmakuTool);
      }
      if (!visible) {
        douyinDanmakuTool.style.setProperty('display', 'none', 'important');
        if (douyinDanmakuManager) closeDouyinDanmakuManager();
        return;
      }
      const available = collectRecords();
      douyinDanmakuTool.textContent = '🚫 抖音弹幕屏蔽(' + available.length + ')';
      douyinDanmakuTool.style.setProperty('display', 'inline-flex', 'important');
      if (douyinDanmakuManager) render();
    }

    Store.onChange(refresh);
    setInterval(refresh, 900);
    refresh();
  }

  let refreshBulkBlock = () => {};

  // ---- 批量拉黑的范围与时间筛选（目前仅 B站视频评论区提供整区抓取能力）----
  const BULK_SINCE_PRESETS = [
    { value: '', label: '不限时间' },
    { value: '3600', label: '最近 1 小时' },
    { value: '21600', label: '最近 6 小时' },
    { value: '86400', label: '最近 24 小时' },
    { value: '259200', label: '最近 3 天' },
    { value: '604800', label: '最近 7 天' },
    { value: 'custom', label: '自定义时间点…' },
  ];

  let closeBulkScopeKeyHandler = null;
  function closeBulkScopePanel() {
    if (closeBulkScopeKeyHandler) {
      document.removeEventListener('keydown', closeBulkScopeKeyHandler);
      closeBulkScopeKeyHandler = null;
    }
    const existing = $('#ob-bulk-scope');
    if (existing) existing.remove();
  }

  // 时间筛选只能作用在带可靠 ctime 的记录上；缺少时间的记录必须被排除，
  // 否则"晚于某时间点"会把无法判定的人一起拉黑。
  function filterRecordsSince(records, sinceSeconds) {
    if (!sinceSeconds) return { kept: records, dropped: 0, unknown: 0 };
    let dropped = 0;
    let unknown = 0;
    const kept = [];
    for (const record of records) {
      const ctime = Number(record && record.ctime) || 0;
      if (!ctime) { unknown++; continue; }
      if (ctime >= sinceSeconds) kept.push(record);
      else dropped++;
    }
    return { kept, dropped, unknown };
  }

  function openBulkScopePanel(adapter, anchorEl) {
    const scope = adapter && adapter.bulkScope;
    closeBulkScopePanel();
    const panel = document.createElement('div');
    panel.id = 'ob-bulk-scope';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '批量拉黑范围');
    const unit = (scope && scope.unit) || '用户';
    panel.innerHTML = `
      <div class="ob-bs-title">批量拉黑${unit}</div>
      <fieldset class="ob-bs-range">
        <legend>范围</legend>
        <label><input type="radio" name="ob-bs-range" value="loaded" checked>仅当前已加载</label>
        <label><input type="radio" name="ob-bs-range" value="all">加载全部评论与子回复</label>
      </fieldset>
      <fieldset>
        <legend>只拉黑晚于此时间的发言</legend>
        <select class="ob-bs-since"></select>
        <input class="ob-bs-custom" type="datetime-local" style="display:none" aria-label="自定义起始时间">
      </fieldset>
      <div class="ob-bs-status"></div>
      <div class="ob-bs-row"><button type="button" class="ob-bs-no">取消</button><button type="button" class="ob-bs-ok">继续</button></div>`;

    const select = panel.querySelector('.ob-bs-since');
    for (const preset of BULK_SINCE_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.value; option.textContent = preset.label;
      select.appendChild(option);
    }
    const custom = panel.querySelector('.ob-bs-custom');
    const status = panel.querySelector('.ob-bs-status');
    const ok = panel.querySelector('.ob-bs-ok');
    select.onchange = () => {
      custom.style.display = select.value === 'custom' ? '' : 'none';
    };
    panel.querySelector('.ob-bs-no').onclick = closeBulkScopePanel;
    const keyHandler = (event) => {
      if (event.key !== 'Escape') return;
      closeBulkScopePanel();
    };
    closeBulkScopeKeyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);

    const rangeAll = panel.querySelector('input[value="all"]');
    if (!scope || typeof scope.fetchAll !== 'function' || (typeof scope.available === 'function' && !scope.available())) {
      rangeAll.disabled = true;
      rangeAll.closest('label').title = '当前页面不支持整区加载';
    }

    let rect = { left: clamp(window.innerWidth / 2 - 144, 8, Math.max(8, window.innerWidth - 296)), top: Math.max(8, window.innerHeight / 2 - 140) };
    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      rect = {
        left: clamp(r.left, 8, Math.max(8, window.innerWidth - 296)),
        top: clamp(r.top - 300, 8, Math.max(8, window.innerHeight - 300)),
      };
    }
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    document.body.appendChild(panel);

    function resolveSince() {
      if (select.value === 'custom') {
        if (!custom.value) return { error: '请填写自定义起始时间' };
        const parsed = Date.parse(custom.value);
        if (!Number.isFinite(parsed)) return { error: '自定义时间格式无效' };
        return { since: Math.floor(parsed / 1000) };
      }
      const seconds = Number(select.value);
      if (!select.value || !Number.isFinite(seconds) || seconds <= 0) return { since: 0 };
      return { since: Math.floor(Date.now() / 1000) - seconds };
    }

    ok.onclick = async () => {
      const sinceResult = resolveSince();
      if (sinceResult.error) { status.textContent = sinceResult.error; return; }
      const wantAll = panel.querySelector('input[name="ob-bs-range"]:checked').value === 'all';
      ok.disabled = true;
      let records = [];
      let partial = false;
      try {
        if (wantAll) {
          status.textContent = '正在加载全部评论...';
          const result = await scope.fetchAll((progress) => {
            if (!panel.isConnected) return;
            status.textContent = '已读取 ' + progress.collected + ' 位' + unit
              + (progress.total ? '（评论区共约 ' + progress.total + ' 条）' : '');
          });
          records = result.records || [];
          partial = !!result.partial;
        } else {
          records = collectUsers(document);
        }
      } catch (e) {
        status.textContent = '加载失败：' + String(e && e.message || e).slice(0, 80);
        ok.disabled = false;
        return;
      }
      if (!panel.isConnected) return;
      const filtered = filterRecordsSince(records, sinceResult.since);
      const list = uniqueUsers(filtered.kept);
      if (!list.length) {
        status.textContent = sinceResult.since ? '该时间之后没有可拉黑的' + unit : '没有可拉黑的' + unit;
        ok.disabled = false;
        return;
      }
      const notes = [];
      if (sinceResult.since) notes.push('已按时间排除 ' + filtered.dropped + ' 位');
      if (filtered.unknown) notes.push('缺少时间的 ' + filtered.unknown + ' 位已跳过');
      if (partial) notes.push('部分分页未取全');
      closeBulkScopePanel();
      blockMany(list, anchorEl, '拉黑 ' + list.length + ' 位' + unit + (notes.length ? '（' + notes.join('，') + '）' : ''));
    };
  }

  function setupBulkBlock() {
    const a = currentAdapter; if (!a) return;
    let fab = null;
    const MODAL_SEL = '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal';
    const setFabVisible = (visible) => {
      if (fab) fab.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      // 入口消失（关闭功能、切换页面、原生弹窗打开）时不留悬挂面板。
      if (!visible) { closeBulkScopePanel(); closeCommentManager(); if (a.id === 'douyin') closeDouyinCommentManager(); }
    };
    const isOwnBulkPanel = (el) => !!el && (
      el.id === 'ob-bulk-scope'
      || !!(el.closest && el.closest('#ob-comment-manager,#ob-douyin-comment-manager,#ob-douyin-dm-manager'))
    );
    function blocksPageBulkFab(el) {
      // 抖音当前视频详情侧栏使用 `#relatedVideoCard.LookModalFrameFast`，虽然类名含
      // Modal，但它本身就是评论承载面；把它当成遮挡弹窗会误删页面批量入口。
      if (a.id === 'douyin' && el && el.id === 'relatedVideoCard'
        && el.querySelector('[data-e2e="comment-item"], .comment-item')) return false;
      return true;
    }
    function hasOpenModal() {
      return querySelectorAllDeep(document, MODAL_SEL).some((el) => isVisible(el)
        && !isOwnBulkPanel(el) && blocksPageBulkFab(el));
    }
    function refreshFab() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) { setFabVisible(false); return; }
      const commentMode = !!(a.commentManager
        && (!a.commentManager.available || a.commentManager.available()));
      const commentRecords = commentMode && typeof a.commentManager.collectRecords === 'function'
        ? mergeCommentRecords(a.commentManager.collectRecords('manager')).filter((info) => !Index.isBlocked(info.keys)) : [];
      const n = commentMode ? commentRecords.length : collectUsers(document).length;
      // 页面批量按钮不应遮住举报/登录等原生弹窗，更不能显示无意义的“(0)”。
      // 抖音视频评论侧栏本身使用 LookModalFrameFast/Modal 类名，但它就是当前
      // 评论管理器的承载面；评论模式下必须保留入口，否则真实评论已加载却永远
      // 看不到“评论屏蔽”按钮。普通无评论的 Modal 仍由 hasOpenModal() 遮挡。
      const modalBlocksFab = hasOpenModal() && !(a.id === 'douyin' && commentMode);
      if (!n || modalBlocksFab) { setFabVisible(false); return; }
      if (!fab) {
        fab = document.createElement('button');
        fab.type = 'button'; fab.setAttribute('data-ob-kind', 'page');
        fab.className = 'ob-bulk';
        fab.style.position = 'fixed';
        if (a.id === 'douyin') {
          // 抖音播放器占据左下角；与齿轮、弹幕工具共用右侧固定列。
          fab.setAttribute('data-ob-douyin-toolbar', '1');
          fab.style.left = 'auto'; fab.style.right = '14px'; fab.style.bottom = '106px';
        } else {
          fab.style.left = '14px'; fab.style.right = 'auto'; fab.style.bottom = '14px';
        }
        fab.onclick = () => {
          if (a.commentManager && (!a.commentManager.available || a.commentManager.available())) {
            openCommentManager(a, fab); return;
          }
          // 支持整区抓取的平台先问范围与时间；其余平台保持原有的直接批量行为。
          if (a.bulkScope && typeof a.bulkScope.fetchAll === 'function') { openBulkScopePanel(a, fab); return; }
          const list = collectUsers(document);
          if (!list.length) { showToast('本页没有可拉黑的用户'); return; }
          blockMany(list, fab);
        };
        const mountFab = () => { if (document.body) document.body.appendChild(fab); else setTimeout(mountFab, 300); };
        mountFab();
      }
      fab.textContent = commentMode
        ? '🚫 ' + platformLabelForCommentManager(a) + '评论屏蔽(' + n + ')'
        : (a.bulkFabLabel ? a.bulkFabLabel(n) : '🚫 拉黑本页用户(' + n + ')');
      setFabVisible(true);
    }
    function tryModal(modal) {
      let btn = Array.from(modal.children || []).find((child) => child.matches && child.matches('.ob-bulk[data-ob-kind="modal"]')) || null;
      if (modal.hasAttribute('data-ob-bulk') && !isVisible(modal)) {
        // 弹窗被隐藏后复用（微博点赞/转发列表就是同一个节点反复显示）时，
        // 必须先清掉上一次的控件；此时按钮可能已被前端重绘删掉。
        if (btn) btn.remove();
        modal.removeAttribute('data-ob-bulk');
        return;
      }
      const allowed = (!a.canBulkModal || a.canBulkModal(modal));
      const users = collectUsers(modal, 'modal');
      if (!allowed || !users.length) {
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
      for (const md of querySelectorAllDeep(document, MODAL_SEL)) {
        if (isOwnBulkPanel(md)) continue;
        tryModal(md);
      }
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
    // 保留安装时可用的 fetch。PAKKU 等扩展后续替换 window.fetch 时，主动兜底仍有独立读取路径；
    // 若 PAKKU 已先安装，这里捕获到的是它的包装器，也仍会得到合法的 protobuf 响应。
    const dmFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

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

    /*
     * UID candidate cracker adapted from PAKKU's crc32_crack.ts
     * (xmcp/pakku.js, GPL-3.0; upstream credits @dramforever).
     * Modified for lazy initialization, typed bucket indexes and explicit
     * forward verification. It only searches decimal UID values up to 10 digits.
     */
    let uidHashCracker = null;
    function makeUidHashCracker() {
      const update = (byte, crc) => ((crc >>> 8) ^ crcTable[(crc & 0xFF) ^ byte]) >>> 0;
      const compute = (values, initial) => {
        let crc = initial == null ? 0 : initial;
        for (const value of values) crc = update(value, crc);
        return crc >>> 0;
      };
      const rainbow = new Uint32Array(100000);
      for (let i = 0; i < rainbow.length; i++) rainbow[i] = compute(Array.from(String(i), Number));
      const rainbowWithFiveZeroes = new Uint32Array(rainbow.length);
      for (let i = 0; i < rainbow.length; i++) rainbowWithFiveZeroes[i] = compute([0, 0, 0, 0, 0], rainbow[i]);

      const bucketPositions = new Uint32Array(65537);
      for (const value of rainbow) bucketPositions[(value >>> 16) + 1]++;
      for (let i = 1; i < bucketPositions.length; i++) bucketPositions[i] += bucketPositions[i - 1];
      const bucketCursor = bucketPositions.slice();
      const bucketUids = new Uint32Array(rainbow.length);
      for (let uid = 0; uid < rainbow.length; uid++) bucketUids[bucketCursor[rainbow[uid] >>> 16]++] = uid;

      const lookup = (crc) => {
        const out = [];
        const high = crc >>> 16;
        for (let i = bucketPositions[high]; i < bucketPositions[high + 1]; i++) {
          const uid = bucketUids[i];
          if (rainbow[uid] === crc) out.push(uid);
        }
        return out;
      };

      return (hash) => {
        const target = (~parseInt(hash, 16)) >>> 0;
        const results = [];
        let baseCrc = 0xFFFFFFFF;
        for (let digits = 1; digits <= 10; digits++) {
          baseCrc = update(0x30, baseCrc);
          if (digits < 6) {
            const firstUid = Math.pow(10, digits - 1);
            const lastUid = Math.pow(10, digits);
            for (let uid = firstUid; uid < lastUid; uid++) {
              if (target === ((baseCrc ^ rainbow[uid]) >>> 0)) results.push(uid);
            }
            continue;
          }
          const firstPrefix = Math.pow(10, digits - 6);
          const lastPrefix = Math.pow(10, digits - 5);
          for (let prefix = firstPrefix; prefix < lastPrefix; prefix++) {
            const remainder = (target ^ baseCrc ^ rainbowWithFiveZeroes[prefix]) >>> 0;
            for (const suffix of lookup(remainder)) results.push(prefix * 100000 + suffix);
          }
        }
        return results.filter((uid) => normalHash(crc32(String(uid)).toString(16)) === hash);
      };
    }

    function crackUidHash(hash) {
      const normalized = normalHash(hash);
      if (!normalized) return [];
      uidHashCracker = uidHashCracker || makeUidHashCracker();
      return uidHashCracker(normalized);
    }

    const isDanmakuUrl = (url) => /\/dm\/(?:wbi\/)?web\/seg\.so(?:[/?]|$)|\/dm\/list\.so(?:[/?]|$)/.test(String(url || ''));
    const isVideoPage = () => /^\/video\/[^/?]+/i.test(location.pathname);
    const numericCid = (value) => {
      const cid = String(value == null ? '' : value).trim();
      return /^\d+$/.test(cid) && cid !== '0' ? cid : '';
    };

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
    const dmContentGroups = new Map();
    const dmSeenElements = new Set();
    const dmLoadedSegments = new Set();
    const dmSegmentPromises = new Map();
    const dmSegmentRetryAt = new Map();
    const selectedDmGroups = new Set();
    const expandedDmUidGroups = new Set();
    const dmUidLookups = new Map();
    const dmUidCardCache = new Map();
    const DM_PAGE_SIZE = 100;
    const DM_SENDER_LIMIT = 5000;
    let dmTool = null;
    let dmManager = null;
    let dmManagerKeyHandler = null;
    let dmSearch = '';
    let dmPage = 0;
    let dmVideoKey = '';
    let dmObservedCid = '';
    let dmBootstrapStatus = 'idle';
    let dmBootstrapAttempts = 0;
    let dmBootstrapRetryAt = 0;
    let dmBootstrapPromise = null;
    let dmBootstrapTimer = 0;
    function cleanDmText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function resolveFloatingDanmakuHashes(content, progress) {
      const text = cleanDmText(content);
      if (!text) return [];
      const hashes = dmByContent.get(text);
      if (!hashes || !hashes.size) return [];
      // 播放器浮动弹幕与弹幕列表都只显示到秒，因此毫秒级精确匹配会把同一秒内的
      // 不同发送者误判成唯一身份。这里按显示粒度（±1s）收集候选，多于一个即视为歧义。
      if (progress < 0) return Array.from(hashes);
      const nearby = new Set();
      for (const [key, timedHashes] of dmByProgress) {
        const divider = key.indexOf('\x1f');
        if (divider < 0 || key.slice(divider + 1) !== text) continue;
        if (Math.abs(Number(key.slice(0, divider)) - progress) > 1000) continue;
        for (const hash of timedHashes) nearby.add(hash);
      }
      return nearby.size ? Array.from(nearby) : Array.from(hashes);
    }
    function currentVideoKey() {
      const match = location.pathname.match(/^\/video\/([^/?]+)/);
      if (!match) return location.pathname;
      let part = '1';
      try { part = new URLSearchParams(location.search).get('p') || '1'; } catch (e) {}
      return match[1] + ':p=' + part;
    }
    function resetDmBootstrap() {
      if (dmBootstrapTimer) clearTimeout(dmBootstrapTimer);
      dmBootstrapTimer = 0;
      dmObservedCid = '';
      dmBootstrapStatus = 'idle';
      dmBootstrapAttempts = 0;
      dmBootstrapRetryAt = 0;
      // 已发出的只读请求无法保证可取消；完成时会用 video key 丢弃跨视频结果。
      dmBootstrapPromise = null;
    }
    function resetDmSessionIfNeeded() {
      const key = currentVideoKey();
      if (!dmVideoKey) { dmVideoKey = key; return false; }
      if (key === dmVideoKey) return false;
      dmVideoKey = key;
      dmByContent.clear(); dmByProgress.clear(); dmSenders.clear(); dmContentGroups.clear(); dmSeenElements.clear();
      dmLoadedSegments.clear(); dmSegmentPromises.clear(); dmSegmentRetryAt.clear();
      selectedDmGroups.clear(); expandedDmUidGroups.clear();
      dmSearch = ''; dmPage = 0;
      resetDmBootstrap();
      if (dmManager) closeDmManager();
      return true;
    }
    function rememberDanmaku(elem) {
      if (!elem || !elem.hash || !elem.content) return;
      const content = cleanDmText(elem.content);
      if (!content) return;
      resetDmSessionIfNeeded();
      const fingerprint = elem.hash + '\x1f' + String(elem.progress) + '\x1f' + content;
      if (dmSeenElements.has(fingerprint)) return;
      if (dmSeenElements.size >= 20000) dmSeenElements.delete(dmSeenElements.values().next().value);
      dmSeenElements.add(fingerprint);
      const hashes = dmByContent.get(content) || new Set();
      hashes.add(elem.hash); dmByContent.set(content, hashes);
      let group = dmContentGroups.get(content);
      if (!group) {
        if (dmContentGroups.size >= DM_SENDER_LIMIT) dmContentGroups.delete(dmContentGroups.keys().next().value);
        group = { content, hashes: new Set(), progress: elem.progress, messageCount: 0 };
        dmContentGroups.set(content, group);
      }
      group.hashes.add(elem.hash);
      group.messageCount++;
      if (group.progress < 0 || (elem.progress >= 0 && elem.progress < group.progress)) group.progress = elem.progress;
      if (elem.progress >= 0) {
        const key = String(elem.progress) + '\x1f' + content;
        const progressHashes = dmByProgress.get(key) || new Set();
        progressHashes.add(elem.hash); dmByProgress.set(key, progressHashes);
      }
      let sender = dmSenders.get(elem.hash);
      if (!sender) {
        if (dmSenders.size >= DM_SENDER_LIMIT) {
          const oldest = dmSenders.keys().next().value;
          dmSenders.delete(oldest);
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
    function filterSeg(bytes, segmentIndex) {
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
      const parsedSegment = Number(segmentIndex);
      if (Number.isInteger(parsedSegment) && parsedSegment > 0) dmLoadedSegments.add(parsedSegment);
      if (dmSenders.size) {
        dmBootstrapStatus = 'ready';
        dmBootstrapRetryAt = 0;
      }
      scanDmPanels(); refreshDmTool();
      return changed ? new Uint8Array(out) : buf;
    }

    function currentPageNumber() {
      try {
        const page = Number(new URLSearchParams(location.search).get('p') || 1);
        return Number.isInteger(page) && page > 0 ? page : 1;
      } catch (e) {
        return 1;
      }
    }

    function cidFromPageState() {
      try {
        const manifest = window.player && typeof window.player.getManifest === 'function'
          ? window.player.getManifest()
          : null;
        const cid = numericCid(manifest && manifest.cid);
        if (cid) return cid;
      } catch (e) {}

      try {
        const state = window.__INITIAL_STATE__;
        if (!state || typeof state !== 'object') return '';
        const video = state.videoData && typeof state.videoData === 'object' ? state.videoData : null;
        const pages = (video && Array.isArray(video.pages) && video.pages)
          || (Array.isArray(state.pages) && state.pages)
          || [];
        const pageCid = numericCid(pages[currentPageNumber() - 1] && pages[currentPageNumber() - 1].cid);
        if (pageCid) return pageCid;
        for (const value of [video && video.cid, state.cid, state.epInfo && state.epInfo.cid]) {
          const cid = numericCid(value);
          if (cid) return cid;
        }
      } catch (e) {}
      return '';
    }

    function cidFromDanmakuUrl(url) {
      if (!isDanmakuUrl(url)) return '';
      try { return numericCid(new URL(String(url), location.href).searchParams.get('oid')); }
      catch (e) { return ''; }
    }
    function segmentIndexFromUrl(url) {
      try {
        const value = Number(new URL(String(url), location.href).searchParams.get('segment_index') || 0);
        return Number.isInteger(value) && value > 0 ? value : 0;
      } catch (e) { return 0; }
    }

    function noteDanmakuUrl(url) {
      const cid = cidFromDanmakuUrl(url);
      if (!cid) return;
      resetDmSessionIfNeeded();
      const pageCid = cidFromPageState();
      if (pageCid && pageCid !== cid) return;
      dmObservedCid = cid;
      scheduleDmBootstrap(350);
    }

    function installPakkuResponseFilter(xhr) {
      if (!xhr || xhr.__obPakkuFilterInstalled) return;
      const proto = typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype;
      if (!proto || typeof proto.pakku_send !== 'function') return;
      xhr.__obPakkuFilterInstalled = true;
      const callback = function () {
        if (!Store.getSetting('enabled') || !isDanmakuUrl(xhr.__obDanmakuUrl || xhr.pakku_url)) return;
        if (xhr.__obDanmakuVideoKey && xhr.__obDanmakuVideoKey !== currentVideoKey()) return;
        try {
          const raw = xhr.response;
          if (!(raw instanceof ArrayBuffer)) return;
          const filtered = asArrayBuffer(filterSeg(raw, segmentIndexFromUrl(xhr.__obDanmakuUrl || xhr.pakku_url)));
          if (filtered !== raw) xhr.response = filtered;
        } catch (e) {}
      };
      xhr.pakku_load_callback = Array.isArray(xhr.pakku_load_callback) ? xhr.pakku_load_callback : [];
      xhr.pakku_load_callback.unshift(['readystatechange', callback]);
    }

    async function cidFromVideoMetadata(requestKey) {
      if (!dmFetch) return '';
      const match = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
      if (!match) return '';
      const token = match[1];
      const query = /^BV/i.test(token) ? 'bvid=' + encodeURIComponent(token) : 'aid=' + encodeURIComponent(token.slice(2));
      const response = await dmFetch('https://api.bilibili.com/x/web-interface/view?' + query, { credentials: 'include' });
      if (!response || !response.ok) throw new Error('video metadata HTTP ' + (response && response.status));
      const payload = await response.json();
      if (currentVideoKey() !== requestKey || !payload || payload.code !== 0 || !payload.data) return '';
      const data = payload.data;
      const pages = Array.isArray(data.pages) ? data.pages : [];
      return numericCid(pages[currentPageNumber() - 1] && pages[currentPageNumber() - 1].cid) || numericCid(data.cid);
    }

    function scheduleDmBootstrap(delay) {
      if (!isVideoPage() || dmSenders.size || dmBootstrapPromise) return;
      if (dmBootstrapTimer) clearTimeout(dmBootstrapTimer);
      dmBootstrapTimer = setTimeout(() => {
        dmBootstrapTimer = 0;
        ensureDmBootstrap(false);
      }, Math.max(0, Number(delay) || 0));
    }

    function ensureDmBootstrap(force) {
      resetDmSessionIfNeeded();
      if (!isVideoPage() || !Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) return;
      if (dmSenders.size) {
        dmBootstrapStatus = 'ready';
        refreshDmTool();
        return;
      }
      if (!dmFetch) {
        dmBootstrapStatus = 'error';
        refreshDmTool();
        return;
      }
      if (dmBootstrapPromise) return;
      if (force) { dmBootstrapAttempts = 0; dmBootstrapRetryAt = 0; }
      if (!force && (Date.now() < dmBootstrapRetryAt || dmBootstrapAttempts >= 3)) return;

      const requestKey = currentVideoKey();
      dmBootstrapAttempts++;
      dmBootstrapStatus = 'loading';
      const run = (async () => {
        let cid = cidFromPageState() || dmObservedCid;
        if (!cid) cid = await cidFromVideoMetadata(requestKey);
        if (!cid) throw new Error('current cid unavailable');
        if (currentVideoKey() !== requestKey) return;
        const url = 'https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=' + encodeURIComponent(cid) + '&segment_index=1';
        const response = await dmFetch(url, { credentials: 'include' });
        if (!response || !response.ok) throw new Error('danmaku segment HTTP ' + (response && response.status));
        const bytes = await response.arrayBuffer();
        if (currentVideoKey() !== requestKey) return;
        filterSeg(bytes, 1);
        dmLoadedSegments.add(1);
        if (currentVideoKey() !== requestKey) return;
        dmBootstrapStatus = dmSenders.size ? 'ready' : 'empty';
        dmBootstrapRetryAt = dmSenders.size ? 0 : Date.now() + 5000;
      })().catch(() => {
        if (currentVideoKey() !== requestKey) return;
        dmBootstrapStatus = 'error';
        dmBootstrapRetryAt = Date.now() + Math.min(15000, 1000 * Math.pow(2, dmBootstrapAttempts));
      }).finally(() => {
        if (dmBootstrapPromise === run) dmBootstrapPromise = null;
        if (currentVideoKey() === requestKey) refreshDmTool();
      });
      dmBootstrapPromise = run;
      refreshDmTool();
    }

    // 右侧弹幕列表是跨整段的虚拟列表，而播放器通常只先请求当前段。列表行带有显示秒数，
    // 按 B站 seg.so 每 6 分钟一段的协议按需读取对应段，避免把“尚未进入播放器缓存”误判为
    // 无身份。请求仅针对当前视频 cid，且结果仍走同一 protobuf 解析/过滤路径。
    function dmSegmentIndexFromRow(row) {
      const cell = row && row.querySelector && row.querySelector('.dm-info-time');
      const at = timeInMs(cell ? textOf(cell) : textOf(row));
      return at >= 0 ? Math.floor(at / 360000) + 1 : 0;
    }
    function loadDmSegment(index) {
      const segment = Number(index);
      if (!Number.isInteger(segment) || segment < 1 || !dmFetch) return null;
      if (dmLoadedSegments.has(segment)) return null;
      if (dmSegmentPromises.has(segment)) return dmSegmentPromises.get(segment);
      if (Date.now() < (dmSegmentRetryAt.get(segment) || 0)) return null;
      const requestKey = currentVideoKey();
      const run = (async () => {
        let cid = cidFromPageState() || dmObservedCid;
        if (!cid) cid = await cidFromVideoMetadata(requestKey);
        if (!cid || currentVideoKey() !== requestKey) return;
        const url = 'https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=' + encodeURIComponent(cid)
          + '&segment_index=' + encodeURIComponent(segment);
        const response = await dmFetch(url, { credentials: 'include' });
        if (!response || !response.ok) throw new Error('danmaku segment HTTP ' + (response && response.status));
        const bytes = await response.arrayBuffer();
        if (currentVideoKey() !== requestKey) return;
        filterSeg(bytes, segment);
        dmLoadedSegments.add(segment);
        dmSegmentRetryAt.delete(segment);
      })().catch(() => {
        if (currentVideoKey() === requestKey) dmSegmentRetryAt.set(segment, Date.now() + 10000);
      }).finally(() => {
        if (dmSegmentPromises.get(segment) === run) dmSegmentPromises.delete(segment);
        if (currentVideoKey() === requestKey) scanDmPanels();
      });
      dmSegmentPromises.set(segment, run);
      return run;
    }
    function requestDmRowSegment(row) {
      const segment = dmSegmentIndexFromRow(row);
      if (segment < 1) return;
      // 第 1 段由播放器/XHR 或 bootstrap 负责；不要与 bootstrap 并发重复读取。
      if (segment === 1 && (dmBootstrapPromise || dmBootstrapStatus === 'loading')) return;
      loadDmSegment(segment);
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

    // 2026-08-22 真站捕获：弹幕列表的 `.dm-info-dm` 只显示前 30 个字符，完整文案在
    // 它的 `title` 属性里。因此必须优先用 title 做匹配，否则长弹幕永远匹配不到数据段。
    function dmRowContent(row) {
      const cell = row.querySelector && row.querySelector('.dm-info-dm');
      return {
        title: cell ? cleanDmText(attr(cell, 'title')) : '',
        text: cell ? cleanDmText(textOf(cell)) : '',
      };
    }

    // 返回 { hash, reason, candidateCount }。reason 用于诊断与回归断言：
    // attr/data 表示站点直接给了 mid_hash；matched 表示按文案(+时间)唯一命中；
    // ambiguous 表示同文案有多个发送者（提供明确的整组入口，不提供单身份入口）；
    // no-session 表示本轮还没抓到任何弹幕段；unmatched 表示该行文案不在本轮段里。
    function resolveDmRow(row) {
      const direct = normalHash(attr(row, 'data-mid-hash') || attr(row, 'data-mid_hash') || attr(row, 'data-dm-hash') || attr(row, 'data-danmaku-hash'));
      if (direct) return { hash: direct, hashes: [direct], reason: 'attr', candidateCount: 1 };
      const fromData = hashFromData(row.__data) || hashFromData(row.__vueParentComponent && row.__vueParentComponent.props) || hashFromData(row._vnode && row._vnode.props);
      if (fromData) return { hash: fromData, hashes: [fromData], reason: 'data', candidateCount: 1 };
      const rowText = cleanDmText(textOf(row));
      const cell = dmRowContent(row);
      if (!rowText && !cell.title && !cell.text) return { hash: '', hashes: [], reason: 'no-text', candidateCount: 0 };
      if (!dmByContent.size) return { hash: '', hashes: [], reason: 'no-session', candidateCount: 0 };
      const timeCell = row.querySelector && row.querySelector('.dm-info-time');
      const rawProgress = attr(row, 'data-progress') || attr(row, 'data-time') || attr(row, 'data-dm-progress');
      const progress = rawProgress == null || rawProgress === '' ? NaN : Number(rawProgress);
      const exactProgress = Number.isFinite(progress) && progress >= 0;
      const at = exactProgress ? progress : timeInMs(timeCell ? textOf(timeCell) : rowText);
      // 2026-08-22 真站取证：列表时间列是 floor(progress/1000)（20/20 条唯一文案行成立，
      // 其中 10 条对四舍五入不成立）。所以由显示时间反推时只接受 [at, at+1000) 这一秒，
      // 用对称的 ±1s 会把相邻一秒的另一位发送者也算进来，凭空造出歧义。
      const inWindow = (value) => (exactProgress
        ? Math.abs(value - at) <= 1000
        : value >= at && value < at + 1000);
      // 先用完整 title 精确匹配；没有 title 时退回可见文案（可能被站点截断），
      // 最后才用整行文本包含关系。越靠后的方式越容易产生多候选，从而判为歧义。
      const collect = (accepts) => {
        const candidates = new Set();
        for (const [content, hashes] of dmByContent) {
          if (!accepts(content)) continue;
          if (at >= 0) {
            for (const [key, timedHashes] of dmByProgress) {
              const divider = key.indexOf('\x1f');
              if (divider < 0 || key.slice(divider + 1) !== content) continue;
              if (inWindow(Number(key.slice(0, divider)))) for (const hash of timedHashes) candidates.add(hash);
            }
          } else for (const hash of hashes) candidates.add(hash);
        }
        return candidates;
      };
      const strategies = [];
      if (cell.title) strategies.push((content) => content === cell.title);
      if (cell.text) strategies.push((content) => content === cell.text || content.startsWith(cell.text));
      if (rowText) strategies.push((content) => rowText.includes(content));
      let candidates = new Set();
      for (const accepts of strategies) {
        candidates = collect(accepts);
        if (candidates.size) break;
      }
      const hashes = Array.from(candidates);
      if (hashes.length === 1) return { hash: hashes[0], hashes, reason: 'matched', candidateCount: 1 };
      // 命中 0 个时，说明该行文案不在本轮已抓到的弹幕段里（例如列表已滚到
      // 尚未请求的分段）；命中多个时是同文案多发送者的真实歧义。
      return {
        hash: '',
        hashes,
        reason: hashes.length ? 'ambiguous' : 'unmatched',
        candidateCount: hashes.length,
      };
    }

    function hashFromDmRow(row) {
      return resolveDmRow(row).hash;
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

    function availableDmGroups() {
      resetDmSessionIfNeeded();
      const blocked = blockedHashes();
      return Array.from(dmContentGroups.values())
        .map((group) => ({
          content: group.content,
          progress: group.progress,
          messageCount: group.messageCount,
          hashes: Array.from(group.hashes).filter((hash) => dmSenders.has(hash) && !blocked.has(hash)),
        }))
        .filter((group) => group.hashes.length)
        .sort((a, b) => (a.progress < 0 ? Number.MAX_SAFE_INTEGER : a.progress) - (b.progress < 0 ? Number.MAX_SAFE_INTEGER : b.progress));
    }

    function dmIdentityRecords(groups) {
      const contentByHash = new Map();
      for (const group of groups || []) {
        for (const hash of group.hashes || []) if (!contentByHash.has(hash)) contentByHash.set(hash, group.content);
      }
      const records = [];
      for (const [hash, content] of contentByHash) {
        records.push({
          keys: [makeIdentityKey('bili:dmhash', hash)],
          label: 'B站弹幕发送者',
          note: 'B站弹幕段未提供昵称/UID；同一发送者后续弹幕均会屏蔽。代表弹幕：' + content,
        });
      }
      return records;
    }

    function requestDmUidCard(uid) {
      const normalizedUid = normalizeDigits(uid);
      if (!normalizedUid) return Promise.resolve(null);
      if (dmUidCardCache.has(normalizedUid)) return dmUidCardCache.get(normalizedUid);
      const request = new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('GM_xmlhttpRequest unavailable')); return; }
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.bilibili.com/x/web-interface/card?type=json&mid=' + encodeURIComponent(normalizedUid),
            timeout: 10000,
            anonymous: true,
            onload(response) {
              if (!response || Number(response.status) !== 200) { reject(new Error('user card HTTP ' + (response && response.status))); return; }
              let payload = response.response;
              if (!payload || typeof payload !== 'object') {
                try { payload = JSON.parse(response.responseText || ''); }
                catch (e) { reject(new Error('invalid user card response')); return; }
              }
              if (payload.code === -404 || (payload.code === 0 && (!payload.data || !payload.data.card))) { resolve(null); return; }
              if (payload.code !== 0 || !payload.data || !payload.data.card) { reject(new Error('user card API ' + payload.code)); return; }
              const card = payload.data.card;
              const cardUid = normalizeDigits(card.mid);
              if (cardUid !== normalizedUid) { resolve(null); return; }
              resolve({ uid: cardUid, name: cleanDmText(card.name) || ('UID ' + cardUid) });
            },
            onerror() { reject(new Error('user card request failed')); },
            ontimeout() { reject(new Error('user card request timed out')); },
          });
        } catch (e) { reject(e); }
      }).catch((error) => {
        dmUidCardCache.delete(normalizedUid);
        throw error;
      });
      dmUidCardCache.set(normalizedUid, request);
      return request;
    }

    async function lookupDmUidCandidates(hash) {
      const previous = dmUidLookups.get(hash);
      if (previous && previous.status === 'ready') return previous;
      if (previous && previous.status === 'loading') return previous.promise;
      const state = { status: 'loading', candidates: [], partial: false, error: '', promise: null };
      dmUidLookups.set(hash, state);
      renderDmManager();
      const run = (async () => {
        // 先让“正在查询”渲染出来，再初始化约 1 MB 的彩虹表。
        await new Promise((resolve) => setTimeout(resolve, 0));
        const uids = crackUidHash(hash);
        const candidates = [];
        let failed = false;
        let requestError = '';
        for (const uid of uids) {
          try {
            const card = await requestDmUidCard(uid);
            if (card) candidates.push(card);
          } catch (e) {
            failed = true;
            requestError = String(e && e.message || e || 'candidate request failed').slice(0, 200);
          }
        }
        state.status = failed && !candidates.length ? 'error' : 'ready';
        state.candidates = candidates;
        state.partial = failed && candidates.length > 0;
        state.error = requestError;
        return state;
      })().catch((error) => {
        state.status = 'error';
        state.candidates = [];
        state.error = String(error && error.message || error || 'unknown error').slice(0, 200);
        return state;
      }).finally(() => {
        state.promise = null;
        renderDmManager();
      });
      state.promise = run;
      return run;
    }

    async function lookupDmUidGroup(group) {
      expandedDmUidGroups.add(group.content);
      renderDmManager();
      for (const hash of group.hashes) await lookupDmUidCandidates(hash);
    }

    function dmUidLinkNote(content) {
      return '弹幕 hash 唯一命中并经用户卡片正向校验；评论按 UID、弹幕按 hash 屏蔽。代表弹幕：' + content;
    }

    // 唯一候选：CRC32 反查只得到一个 UID，且该 UID 已由 api.bilibili.com 用户卡片
    // 正向校验回同一 hash，此时无需再让用户确认，直接入库并提供撤销。
    function blockUniqueDmUidCandidate(hash, candidate, content) {
      const keys = [makeIdentityKey('bili:dmhash', hash), makeIdentityKey('bili:uid', candidate.uid)];
      let result;
      try {
        result = Store.confirmIdentityLink(keys, candidate.name, dmUidLinkNote(content));
      } catch (e) {
        showToast('拉黑失败：' + (e && e.message || e));
        return;
      }
      if (result.rejected) { showToast('无法识别可靠身份'); return; }
      expandedDmUidGroups.delete(content);
      refreshDmTool();
      scanDmPanels();
      showToast('已拉黑：' + candidate.name + '（UID ' + candidate.uid + '）', result.undo || null);
      if (currentScanner) currentScanner.schedule();
    }

    // 多候选：CRC32 碰撞下无法判定本人，必须保留人工核对，不得静默拉黑。
    function confirmDmUidCandidate(hash, candidate, content, anchorEl) {
      const keys = [makeIdentityKey('bili:dmhash', hash), makeIdentityKey('bili:uid', candidate.uid)];
      const note = '从 CRC32 候选中手动选择；评论按 UID、弹幕按 hash 屏蔽。代表弹幕：' + content;
      showConfirm(
        '可能发送者：' + candidate.name + '（UID ' + candidate.uid + '）',
        keys,
        anchorEl,
        () => {
          expandedDmUidGroups.delete(content);
          refreshDmTool();
          scanDmPanels();
        },
        () => {
          const result = Store.confirmIdentityLink(keys, candidate.name, note);
          return { result, undo: result.undo };
        }
      );
    }

    function buildDmUidResults(group) {
      const results = document.createElement('div');
      results.className = 'ob-dm-uid-results';
      const warning = document.createElement('div');
      warning.className = 'ob-dm-uid-warning';
      // 文案随实际风险变化：只有出现多候选（CRC32 碰撞）时才要求人工核对。
      const ambiguous = group.hashes.some((hash) => {
        const state = dmUidLookups.get(hash);
        return !!state && state.status === 'ready' && (state.candidates.length > 1 || (state.candidates.length && state.partial));
      });
      warning.textContent = ambiguous
        ? '仅查询 1–10 位 UID；该文案存在多个 CRC32 候选，请打开主页核对后再确认。'
        : '仅查询 1–10 位 UID；唯一候选已通过用户卡片正向校验，可直接拉黑。';
      results.appendChild(warning);
      for (const hash of group.hashes) {
        const section = document.createElement('div');
        section.className = 'ob-dm-uid-hash';
        const hashLabel = document.createElement('div');
        hashLabel.className = 'ob-dm-uid-hash-label';
        hashLabel.textContent = 'hash ' + hash;
        section.appendChild(hashLabel);
        const state = dmUidLookups.get(hash);
        if (!state || state.status === 'loading') {
          const status = document.createElement('div');
          status.textContent = state ? '正在计算并校验候选...' : '等待查询';
          section.appendChild(status);
        } else if (state.status === 'error') {
          section.setAttribute('data-ob-dm-uid-error', state.error || 'candidate lookup failed');
          const status = document.createElement('div');
          status.textContent = '候选查询失败，可收起后重试';
          section.appendChild(status);
        } else if (!state.candidates.length) {
          const status = document.createElement('div');
          status.textContent = '未找到仍存在的 1–10 位 UID 候选';
          section.appendChild(status);
        } else {
          const unique = state.candidates.length === 1 && !state.partial;
          for (const candidate of state.candidates) {
            const row = document.createElement('div');
            row.className = 'ob-dm-uid-candidate';
            const summary = document.createElement('span');
            summary.appendChild(document.createTextNode('可能发送者：'));
            const profile = document.createElement('a');
            profile.href = 'https://space.bilibili.com/' + candidate.uid;
            profile.target = '_blank'; profile.rel = 'noopener noreferrer';
            profile.textContent = candidate.name;
            summary.appendChild(profile);
            summary.appendChild(document.createTextNode(' · UID ' + candidate.uid));
            const choose = document.createElement('button');
            choose.type = 'button'; choose.className = 'ob-dm-uid-link';
            choose.textContent = unique ? '拉黑本人' : '确认并拉黑';
            choose.setAttribute('data-ob-dm-uid-unique', unique ? '1' : '0');
            choose.addEventListener('click', (event) => {
              event.stopPropagation(); event.preventDefault();
              if (unique) blockUniqueDmUidCandidate(hash, candidate, group.content);
              else confirmDmUidCandidate(hash, candidate, group.content, choose);
            });
            row.append(summary, choose);
            section.appendChild(row);
          }
          if (state.partial) {
            const partial = document.createElement('div');
            partial.textContent = '部分候选账号校验失败，可稍后重试';
            section.appendChild(partial);
          }
        }
        results.appendChild(section);
      }
      return results;
    }

    function closeDmManager() {
      if (dmManager) dmManager.remove();
      dmManager = null;
      if (dmManagerKeyHandler) document.removeEventListener('keydown', dmManagerKeyHandler);
      dmManagerKeyHandler = null;
    }

    function renderDmManager() {
      if (!dmManager || !dmManager.isConnected) return;
      const available = availableDmGroups();
      const availableGroupKeys = new Set(available.map((group) => group.content));
      for (const content of Array.from(selectedDmGroups)) if (!availableGroupKeys.has(content)) selectedDmGroups.delete(content);
      for (const content of Array.from(expandedDmUidGroups)) if (!availableGroupKeys.has(content)) expandedDmUidGroups.delete(content);
      const term = cleanDmText(dmSearch).toLowerCase();
      const filtered = term ? available.filter((group) => group.content.toLowerCase().includes(term)) : available;
      const pageCount = Math.max(1, Math.ceil(filtered.length / DM_PAGE_SIZE));
      dmPage = clamp(dmPage, 0, pageCount - 1);
      const pageItems = filtered.slice(dmPage * DM_PAGE_SIZE, (dmPage + 1) * DM_PAGE_SIZE);
      const batchEnabled = Store.getSetting('showBulkBlock');
      const list = dmManager.querySelector('.ob-dm-list');
      list.textContent = '';

      if (!pageItems.length) {
        const empty = document.createElement('div');
        empty.className = 'ob-dm-empty';
        if (term && available.length) empty.textContent = '没有匹配的已加载弹幕';
        else if (dmSenders.size && !available.length) empty.textContent = '当前已加载发送者均已屏蔽';
        else if (dmBootstrapStatus === 'loading') empty.textContent = '正在读取当前视频弹幕...';
        else if (dmBootstrapStatus === 'error') empty.textContent = '暂时无法读取弹幕，请稍后重试';
        else if (dmBootstrapStatus === 'empty') empty.textContent = '当前视频没有可读取的弹幕';
        else empty.textContent = '正在等待当前视频信息...';
        list.appendChild(empty);
      }

      for (const group of pageItems) {
        const row = document.createElement('div');
        row.className = 'ob-dm-sender';
        row.setAttribute('data-ob-dm-content', group.content);
        row.setAttribute('data-ob-dm-hashes', group.hashes.join(','));

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.className = 'ob-dm-select';
        checkbox.checked = selectedDmGroups.has(group.content);
        checkbox.style.display = batchEnabled ? '' : 'none';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedDmGroups.add(group.content);
          else selectedDmGroups.delete(group.content);
          renderDmManager();
        });

        const body = document.createElement('div');
        const content = document.createElement('div'); content.className = 'ob-dm-content'; content.textContent = group.content;
        const meta = document.createElement('div'); meta.className = 'ob-dm-meta';
        meta.textContent = group.hashes.length + ' 位发送者 · 捕获 ' + group.messageCount + ' 条 · ' + formatDmProgress(group.progress);
        body.append(content, meta);

        const actions = document.createElement('div');
        actions.className = 'ob-dm-actions';
        const uidQuery = document.createElement('button');
        uidQuery.type = 'button'; uidQuery.className = 'ob-dm-uid-query';
        const uidExpanded = expandedDmUidGroups.has(group.content);
        const uidLoading = group.hashes.some((hash) => dmUidLookups.get(hash) && dmUidLookups.get(hash).status === 'loading');
        uidQuery.textContent = uidExpanded ? '收起' : 'UID?';
        uidQuery.title = uidExpanded ? '收起可能的 UID' : '查询可能的 UID';
        uidQuery.setAttribute('aria-label', uidQuery.title);
        uidQuery.setAttribute('aria-expanded', uidExpanded ? 'true' : 'false');
        uidQuery.disabled = uidLoading;
        uidQuery.addEventListener('click', (event) => {
          event.stopPropagation(); event.preventDefault();
          if (expandedDmUidGroups.has(group.content)) {
            expandedDmUidGroups.delete(group.content);
            renderDmManager();
          } else void lookupDmUidGroup(group);
        });

        const single = document.createElement('button');
        single.type = 'button'; single.className = 'ob-dm-single'; single.textContent = '🚫';
        single.title = '本地屏蔽发送此文案的全部用户'; single.setAttribute('aria-label', '本地屏蔽发送此文案的全部用户');
        single.addEventListener('click', (event) => {
          event.stopPropagation(); event.preventDefault();
          blockMany(
            dmIdentityRecords([group]),
            single,
            '屏蔽该文案的 ' + group.hashes.length + ' 位发送者',
            () => { selectedDmGroups.delete(group.content); refreshDmTool(); scanDmPanels(); }
          );
        });
        actions.append(uidQuery, single);
        row.append(checkbox, body, actions);
        if (uidExpanded) row.appendChild(buildDmUidResults(group));
        list.appendChild(row);
      }

      const selectAllWrap = dmManager.querySelector('.ob-dm-checkall');
      const selectAll = selectAllWrap.querySelector('input');
      selectAllWrap.style.display = batchEnabled ? 'inline-flex' : 'none';
      selectAll.checked = !!pageItems.length && pageItems.every((group) => selectedDmGroups.has(group.content));
      selectAll.indeterminate = !selectAll.checked && pageItems.some((group) => selectedDmGroups.has(group.content));
      selectAll.onchange = () => {
        for (const group of pageItems) {
          if (selectAll.checked) selectedDmGroups.add(group.content);
          else selectedDmGroups.delete(group.content);
        }
        renderDmManager();
      };

      const selected = available.filter((group) => selectedDmGroups.has(group.content));
      const selectedRecords = dmIdentityRecords(selected);
      const batch = dmManager.querySelector('.ob-dm-batch');
      batch.style.display = batchEnabled ? '' : 'none';
      batch.disabled = !selected.length;
      batch.textContent = '屏蔽选中(' + selected.length + '组 / ' + selectedRecords.length + '人)';
      batch.onclick = () => {
        const current = availableDmGroups().filter((group) => selectedDmGroups.has(group.content));
        if (!current.length) return;
        const records = dmIdentityRecords(current);
        blockMany(
          records,
          batch,
          '屏蔽选中的 ' + records.length + ' 位弹幕发送者',
          () => { for (const group of current) selectedDmGroups.delete(group.content); }
        );
      };

      const filteredSenderCount = new Set(filtered.flatMap((group) => group.hashes)).size;
      dmManager.querySelector('.ob-dm-status').textContent = filtered.length + ' 组弹幕 · ' + filteredSenderCount + ' 位发送者 · ' + (dmPage + 1) + '/' + pageCount;
      const retry = dmManager.querySelector('.ob-dm-retry');
      retry.style.display = !dmSenders.size && dmBootstrapStatus !== 'loading' ? '' : 'none';
      retry.disabled = dmBootstrapStatus === 'loading';
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
          <div class="ob-dm-head"><h2 id="ob-dm-title">B站弹幕内容</h2><button class="ob-dm-close" type="button" title="关闭" aria-label="关闭">×</button></div>
          <div class="ob-dm-toolbar">
            <input class="ob-dm-search" type="search" placeholder="搜索已加载弹幕" aria-label="搜索已加载弹幕">
            <label class="ob-dm-checkall"><input type="checkbox">全选当前页文案</label>
            <button class="ob-dm-retry" type="button">重新读取</button>
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
      dmManager.querySelector('.ob-dm-retry').onclick = () => ensureDmBootstrap(true);
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
      setTimeout(refreshDmTool, 0);
    }

    function refreshDmTool() {
      resetDmSessionIfNeeded();
      mountDmTool();
      if (!dmTool) return;
      const count = availableDmSenders().length;
      const visible = Store.getSetting('enabled') && Store.getSetting('showQuickBlock') && isVideoPage();
      dmTool.textContent = '🚫 弹幕屏蔽(' + count + ')';
      dmTool.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      if (!visible && dmManager) closeDmManager();
      else if (dmManager) renderDmManager();
    }

    window.__omniblockFloatingDanmakuResolver = resolveFloatingDanmakuHashes;

    // ---- 播放器内浮动弹幕：坐标命中 + 自有拉黑浮层 ----
    // 2026-08-22 真站捕获：当前浮动弹幕是 `.bili-danmaku-x-dm`，位于
    // `.bpx-player-row-dm-wrap > .bili-danmaku-x-dm-rotate` 内，且这两层 CSS 写死
    // `pointer-events: none`，因此弹幕自身永远不会进入 :hover，也收不到指针事件。
    // 我们只能在播放器容器上监听指针坐标，再用弹幕矩形做命中判定。
    const FLOATING_DM_SEL = '.bili-danmaku-x-dm';
    const FLOATING_DM_LAYER_SEL = '.bpx-player-row-dm-wrap,.bili-danmaku-x-dm-rotate';
    const FLOATING_DM_PLAYER_SEL = '.bpx-player-video-area,.bpx-player-container,#bilibili-player';
    let dmPickButton = null;
    let dmPickTarget = null;
    let dmPickHideTimer = 0;
    let dmPickFollowFrame = 0;

    function floatingDmIdentityFor(node) {
      const content = cleanDmText(textOf(node));
      if (!content) return null;
      // 浮动弹幕节点不带时间；用当前播放进度做 ±1s 粒度的候选收敛。
      const video = document.querySelector('video');
      const progress = video && Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : -1;
      let candidates = resolveFloatingDanmakuHashes(content, progress);
      if (candidates.length !== 1 && progress >= 0) {
        // 弹幕从右向左滚动，出现时间早于当前进度；放宽到整条内容匹配。
        candidates = resolveFloatingDanmakuHashes(content, -1);
      }
      if (candidates.length !== 1) return null;
      const hash = candidates[0];
      if (!dmSenders.has(hash)) return null;
      return {
        keys: [makeIdentityKey('bili:dmhash', hash)],
        label: 'B站弹幕发送者',
        note: 'B站弹幕段未提供昵称/UID；同一发送者后续弹幕均会屏蔽。代表弹幕：' + content,
      };
    }

    function hideDmPick() {
      if (dmPickHideTimer) { clearTimeout(dmPickHideTimer); dmPickHideTimer = 0; }
      if (dmPickFollowFrame) {
        (window.cancelAnimationFrame || clearTimeout)(dmPickFollowFrame);
        dmPickFollowFrame = 0;
      }
      dmPickTarget = null;
      if (dmPickButton) dmPickButton.style.setProperty('display', 'none', 'important');
    }

    // 弹幕节点本身持续向左移动，只在 pointermove 时设置一次按钮坐标会让浮层停在旧位置。
    // 可见期间用一帧循环跟随目标矩形；目标离开或被站点回收时立即收起，避免悬空入口。
    function positionDmPick() {
      if (!dmPickButton || !dmPickTarget || !dmPickTarget.isConnected) return false;
      const rect = dmPickTarget.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
      const width = dmPickButton.offsetWidth || 150;
      const left = Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4));
      const top = rect.top - 26 >= 4 ? rect.top - 26 : rect.bottom + 6;
      dmPickButton.style.setProperty('left', Math.round(left) + 'px', 'important');
      dmPickButton.style.setProperty('top', Math.round(top) + 'px', 'important');
      return true;
    }
    function followDmPick() {
      if (dmPickFollowFrame) return;
      const tick = () => {
        dmPickFollowFrame = 0;
        if (!dmPickTarget || !positionDmPick()) { hideDmPick(); return; }
        const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
        dmPickFollowFrame = raf(tick);
      };
      const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
      dmPickFollowFrame = raf(tick);
    }

    function ensureDmPickButton() {
      if (dmPickButton && dmPickButton.isConnected) return dmPickButton;
      if (!document.body) return null;
      dmPickButton = document.createElement('button');
      dmPickButton.id = 'ob-dm-pick';
      dmPickButton.type = 'button';
      dmPickButton.textContent = '🚫 拉黑该弹幕发送者';
      dmPickButton.title = '按该弹幕的 mid_hash 本地屏蔽发送者';
      dmPickButton.setAttribute('aria-label', '本地拉黑该弹幕发送者');
      dmPickButton.style.setProperty('display', 'none', 'important');
      dmPickButton.addEventListener('mouseenter', () => {
        if (dmPickHideTimer) { clearTimeout(dmPickHideTimer); dmPickHideTimer = 0; }
      });
      dmPickButton.addEventListener('click', (event) => {
        event.stopPropagation(); event.preventDefault();
        const info = dmPickTarget && floatingDmIdentityFor(dmPickTarget);
        if (!info) { hideDmPick(); return; }
        blockMany([info], dmPickButton, '屏蔽该弹幕发送者', () => { scanDmPanels(); refreshDmTool(); });
        hideDmPick();
      });
      document.body.appendChild(dmPickButton);
      return dmPickButton;
    }

    function floatingDmAtPoint(x, y) {
      let best = null;
      for (const node of document.querySelectorAll(FLOATING_DM_SEL)) {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) continue;
        // 命中多条重叠弹幕时取矩形更小的那条，最接近指针实际指向。
        if (!best || rect.width * rect.height < best.area) best = { node, area: rect.width * rect.height, rect };
      }
      return best;
    }

    function onPlayerPointerMove(event) {
      if (!isVideoPage()) return;
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { hideDmPick(); return; }
      if (dmPickButton && event.target === dmPickButton) return;
      const player = event.target && event.target.closest && event.target.closest(FLOATING_DM_PLAYER_SEL);
      if (!player) { hideDmPick(); return; }
      const hit = floatingDmAtPoint(event.clientX, event.clientY);
      if (!hit) {
        // 指针刚离开弹幕时留一点时间让用户移到按钮上。
        if (dmPickTarget && !dmPickHideTimer) dmPickHideTimer = setTimeout(hideDmPick, 900);
        return;
      }
      const info = floatingDmIdentityFor(hit.node);
      if (!info) { hideDmPick(); return; }
      const button = ensureDmPickButton();
      if (!button) return;
      if (dmPickHideTimer) { clearTimeout(dmPickHideTimer); dmPickHideTimer = 0; }
      dmPickTarget = hit.node;
      // 登录用户悬停时 B站会弹出自己的弹幕操作条（含「举报」）。把身份同时交给
      // 快捷入口，使那条原生菜单也能复用同一 mid_hash。
      floatingDanmaku.remember(info);
      button.style.setProperty('display', 'inline-flex', 'important');
      positionDmPick();
      followDmPick();
    }

    function setupFloatingDmPick() {
      document.addEventListener('pointermove', onPlayerPointerMove, true);
      document.addEventListener('mousemove', onPlayerPointerMove, true);
      window.addEventListener('scroll', hideDmPick, true);
      document.addEventListener('pointerdown', (event) => {
        if (dmPickButton && event.target === dmPickButton) return;
        if (!event.target || !event.target.closest || !event.target.closest(FLOATING_DM_PLAYER_SEL)) hideDmPick();
      }, true);
      Store.onChange(() => {
        if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) hideDmPick();
      });
    }
    // 供回归测试断言真实结构契约，不改变运行行为。
    window.__omniblockFloatingDmProbe = (x, y) => {
      const hit = floatingDmAtPoint(x, y);
      if (!hit) return null;
      const info = floatingDmIdentityFor(hit.node);
      return { text: cleanDmText(textOf(hit.node)), keys: info ? info.keys : [] };
    };
    // 供回归测试与诊断查询“弹幕列表某一行为何没有入口”，不改变运行行为。
    window.__omniblockDmRowProbe = (row) => {
      if (!row) return null;
      const resolved = resolveDmRow(row);
      return {
        hash: resolved.hash,
        hashes: resolved.hashes,
        reason: resolved.reason,
        candidateCount: resolved.candidateCount,
        sessionSize: dmByContent.size,
      };
    };
    // 仅供本地诊断：列出某条文案在本轮已抓段里的 progress，用于验证列表显示秒
    // 与 progress 的换算关系。不参与运行逻辑。
    window.__omniblockDmContentProbe = (content) => {
      const text = cleanDmText(content);
      const out = [];
      for (const [key, hashes] of dmByProgress) {
        const divider = key.indexOf('\x1f');
        if (divider < 0 || key.slice(divider + 1) !== text) continue;
        for (const hash of hashes) out.push({ progress: Number(key.slice(0, divider)), hash });
      }
      return out.sort((a, b) => a.progress - b.progress);
    };
    // 仅供本地诊断：某条列表文案在本轮段里是否存在近似项，用于区分“段没抓到”
    // 和“文案对不上”。不参与运行逻辑。
    window.__omniblockDmNearMissProbe = (content) => {
      const text = cleanDmText(content);
      if (!text) return null;
      const head = text.slice(0, 8);
      const near = [];
      for (const known of dmByContent.keys()) {
        if (known === text) continue;
        if (known.startsWith(head) || text.startsWith(known.slice(0, 8))) near.push(known.slice(0, 40));
        if (near.length >= 5) break;
      }
      return { exact: dmByContent.has(text), sessionSize: dmByContent.size, near };
    };

    // 2026-08-22 真站捕获（未登录，播放器右侧「弹幕列表」由 .bui-dropdown-display 打开）：
    // 列表容器是 `.bpx-player-dm-wrap`，里面是虚拟长列表
    // `ul.bui-long-list-list > li.bui-long-list-item > div.dm-info-row`。
    // 旧的 `.bpx-player-dm-container` 在真站上是 0×0 且无子节点，另外三个选择器不存在，
    // 因此旧实现在真实弹幕列表里一个入口都挂不上；已按真站结构改正，不保留伪兜底。
    const DM_PANEL_SEL = '.bpx-player-dm-wrap,.bui-long-list-list';
    const DM_ROW_SEL = 'li.bui-long-list-item,.dm-info-row,[data-mid-hash],[data-mid_hash],[data-dm-hash],[data-danmaku-hash]';
    // `li.bui-long-list-item` 与其内部的 `.dm-info-row` 会同时匹配。只保留最内层，
    // 否则同一条弹幕会挂两个按钮。
    function dmRowsIn(panel) {
      const all = querySelectorAllDeep(panel, DM_ROW_SEL);
      return all.filter((row) => !all.some((other) => other !== row && row.contains(other)));
    }
    // 虚拟列表把高度写死在外层 `li` 上（真站为 24px）。隐藏时必须收掉那个 li，
    // 只隐藏内层 `.dm-info-row` 会留下等高空行。
    function dmHideTarget(row) {
      const host = row.closest && row.closest('li.bui-long-list-item');
      return host || row;
    }
    function addDmStatusButton(row, text, title) {
      row.setAttribute('data-ob-dm-action', '1');
      const signature = 'status:' + text;
      const current = row.querySelector && row.querySelector(':scope > .ob-dm-block');
      if (current && current.getAttribute('data-ob-dm-signature') === signature) return;
      if (current) current.remove();
      const btn = document.createElement('button');
      btn.className = 'ob-dm-block'; btn.type = 'button'; btn.disabled = true; btn.textContent = text;
      btn.title = title || text; btn.setAttribute('data-ob-dm-signature', signature);
      row.appendChild(btn);
    }

    function addDmBlockButton(row, resolved) {
      const hashes = Array.isArray(resolved && resolved.hashes) ? resolved.hashes.filter(Boolean) : [];
      if (!hashes.length) return;
      row.setAttribute('data-ob-dm-action', '1');
      const signature = 'hashes:' + hashes.join(',');
      const current = row.querySelector && row.querySelector(':scope > .ob-dm-block');
      if (current && current.getAttribute('data-ob-dm-signature') === signature) return;
      if (current) current.remove();
      const btn = document.createElement('button');
      btn.className = 'ob-dm-block'; btn.type = 'button';
      btn.textContent = hashes.length === 1 ? '本地拉黑' : '本地拉黑全部(' + hashes.length + ')';
      btn.title = hashes.length === 1
        ? '按该弹幕的 mid_hash 本地屏蔽发送者'
        : '该文案对应多位发送者；确认后按 mid_hash 全部屏蔽';
      btn.setAttribute('data-ob-dm-signature', signature);
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        const list = hashes.map((hash) => ({
          keys: [makeIdentityKey('bili:dmhash', hash)],
          label: 'B站弹幕发送者',
          note: 'B站弹幕段未提供昵称/UID；同一发送者后续弹幕均会屏蔽。',
        }));
        blockMany(list, btn, hashes.length === 1 ? '屏蔽该弹幕发送者' : '屏蔽该文案的全部 ' + hashes.length + ' 位发送者', scanDmPanels);
      });
      row.appendChild(btn);
    }

    function scanDmPanels() {
      const enabled = Store.getSetting('enabled');
      const showButton = enabled && Store.getSetting('showQuickBlock');
      const blocked = enabled ? blockedHashes() : new Set();
      for (const panel of querySelectorAllDeep(document, DM_PANEL_SEL)) {
        for (const row of dmRowsIn(panel)) {
          const existingButton = row.querySelector && row.querySelector(':scope > .ob-dm-block');
          const hideTarget = dmHideTarget(row);
          if (!enabled) {
            setInlineHidden(hideTarget, false);
            hideTarget.removeAttribute('data-ob-dm-blocked');
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          const resolved = resolveDmRow(row);
          if (!resolved.hashes.length) {
            setInlineHidden(hideTarget, false);
            hideTarget.removeAttribute('data-ob-dm-blocked');
            requestDmRowSegment(row);
            addDmStatusButton(row, resolved.reason === 'no-session' ? '读取弹幕…' : '匹配中…',
              resolved.reason === 'no-session' ? '正在读取当前时间段的弹幕数据' : '该行尚未在已读取的弹幕段中找到');
            continue;
          }
          if (resolved.hashes.length && resolved.hashes.every((hash) => blocked.has(hash))) {
            hideTarget.setAttribute('data-ob-dm-blocked', '1');
            setInlineHidden(hideTarget, true);
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          setInlineHidden(hideTarget, false);
          hideTarget.removeAttribute('data-ob-dm-blocked');
          if (showButton) addDmBlockButton(row, resolved);
          else {
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
          }
        }
      }
    }

    // view 是元数据 protobuf，不能按弹幕 Elem 过滤；只处理实际段/列表响应。
    const asArrayBuffer = (bytes) => {
      if (bytes instanceof ArrayBuffer) return bytes;
      if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return bytes;
    };

    // 当前 B站播放器以 XMLHttpRequest + responseType=arraybuffer 请求 seg.so。
    // 覆盖实例 response 的 getter，播放器自己的 onload 回调第一次读取时就拿到过滤后的字节。
    if (typeof XMLHttpRequest !== 'undefined') {
      const xhrProto = XMLHttpRequest.prototype;
      const nativeXhrOpen = xhrProto.open;
      const nativeXhrSend = xhrProto.send;
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
              if (xhr.__obDanmakuVideoKey && xhr.__obDanmakuVideoKey !== currentVideoKey()) return raw;
              if (raw === lastRaw) return lastFiltered;
              try {
                lastRaw = raw;
              lastFiltered = asArrayBuffer(filterSeg(raw, segmentIndexFromUrl(xhr.__obDanmakuUrl)));
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

      function rememberDanmakuXhr(xhr, url) {
        xhr.__obDanmakuUrl = String(url || '');
        xhr.__obDanmakuVideoKey = currentVideoKey();
        if (isDanmakuUrl(xhr.__obDanmakuUrl)) {
          noteDanmakuUrl(xhr.__obDanmakuUrl);
          installPakkuResponseFilter(xhr);
        }
      }

      // PAKKU 已经接管 open/send 时，只桥接它公开的 pakku_open 回调，不再把
      // 自己的包装层叠到所有 XHR 上。这样评论、图片和视频分片仍走 PAKKU/页面
      // 原有链路，弹幕 seg.so 仍可在 PAKKU 的回调交给播放器前过滤。
      const pakkuOpen = xhrProto.pakku_open;
      if (typeof pakkuOpen === 'function' && typeof xhrProto.pakku_send === 'function' && !pakkuOpen.__obPakkuOpenBridge) {
        const bridgedPakkuOpen = function (method, url, ...args) {
          rememberDanmakuXhr(this, url);
          return pakkuOpen.call(this, method, url, ...args);
        };
        bridgedPakkuOpen.__obPakkuOpenBridge = true;
        xhrProto.pakku_open = bridgedPakkuOpen;
      } else if (typeof nativeXhrOpen === 'function' && typeof nativeXhrSend === 'function') {
        xhrProto.open = function (method, url, ...args) {
          rememberDanmakuXhr(this, url);
          return nativeXhrOpen.call(this, method, url, ...args);
        };
        xhrProto.send = function (...args) {
          if (isDanmakuUrl(this.__obDanmakuUrl)) installXhrFilter(this);
          return nativeXhrSend.call(this, ...args);
        };
      }
    }

    // fetch 保留为兼容分支；页面版本切换回 fetch 时仍可工作。
    if (typeof window.fetch === 'function') {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = (typeof input === 'string' || input instanceof URL) ? String(input) : (input && input.url) || '';
        if (!isDanmakuUrl(url) || !Store.getSetting('enabled')) return nativeFetch(input, init);
        const requestKey = currentVideoKey();
        noteDanmakuUrl(url);
        return nativeFetch(input, init).then(async (resp) => {
          try {
            if (currentVideoKey() !== requestKey) return resp;
            const buf = await resp.clone().arrayBuffer();
            if (currentVideoKey() !== requestKey) return resp;
            const filtered = filterSeg(buf, segmentIndexFromUrl(url));
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
    Store.onChange(() => {
      scanDmPanels(); refreshDmTool();
      if (Store.getSetting('enabled') && Store.getSetting('showQuickBlock')) scheduleDmBootstrap(0);
    });
    mountDmTool();
    refreshDmTool();
    setupFloatingDmPick();
    scheduleDmBootstrap(1200);
    setInterval(() => {
      scanDmPanels();
      refreshDmTool();
      ensureDmBootstrap(false);
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
  function formatIdentityForDisplay(key) {
    const value = String(key || '');
    let match = value.match(/^bili:uid:(\d+)$/);
    if (match) return 'B站 UID：' + match[1];
    match = value.match(/^bili:dmhash:([0-9a-f]{8})$/i);
    if (match) return 'B站弹幕 hash：' + match[1].toLowerCase() + '（同一发送者的后续弹幕均会屏蔽）';
    return value;
  }

  const PLATFORM_LABELS = { bili: 'B站', weibo: '微博', zhihu: '知乎', tieba: '贴吧', x: 'X', douyin: '抖音' };
  function platformGroupForPerson(person) {
    const groups = new Set((person && person.identities || []).map((key) => {
      const prefix = String(key || '').split(':')[0];
      return PLATFORM_LABELS[prefix] ? prefix : 'other';
    }));
    if (groups.size === 1) return Array.from(groups)[0];
    return groups.size > 1 ? 'mixed' : 'other';
  }

  function platformLabel(group) {
    if (group === 'mixed') return '跨平台身份';
    if (group === 'other') return '其他身份';
    return PLATFORM_LABELS[group] || group;
  }

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
        <p id="ob-runtime-build" style="color:#777;font-size:11px;margin:5px 0 0;word-break:break-all"></p>

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
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button id="ob-export" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导出 JSON</button>
          <button id="ob-import" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">导入 JSON</button>
          <button id="ob-restore-backup" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">恢复上一份快照</button>
          <input type="file" id="ob-file" accept="application/json" style="display:none">
        </div>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="ob-local-backup" checked> 自动保留本地快照（最近 5 份）</label>
        <div id="ob-backup-status" style="color:#999;font-size:12px;margin-top:5px"></div>

        <h3>更新</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="ob-update" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">检查更新</button>
          <span id="ob-update-status" style="font-size:12px;color:#999"></span>
        </div>
        <p style="color:#999;font-size:12px">点一下自动去仓库比对版本，有新版会弹出安装页（点一次即更新）。想彻底免拖文件：在 Tampermonkey 里把本脚本「更新 → 模式」设为「自动」，TM 会每天静默更新。</p>

        <p style="color:#999;font-size:12px;margin-top:14px">名单、浏览数据和自动快照只保存在本机，不上传。自动快照用于误删/错误导入后的回退；浏览器配置整体丢失时仍请使用导出 JSON。仅在你点击检查更新时请求脚本更新地址。抖音推荐流跳过是唯一一处"模拟操作"，已带随机延迟/连续上限等安全阀。</p>
      </div>`;
    document.body.appendChild(panel);
    const runtimeEl = panel.querySelector('#ob-runtime-build');
    if (runtimeEl) {
      runtimeEl.textContent = `运行版本：v${RUNTIME_VERSION} · 构建：${RUNTIME_BUILD}`;
      runtimeEl.setAttribute('data-ob-version', RUNTIME_VERSION);
      runtimeEl.setAttribute('data-ob-build', RUNTIME_BUILD);
      runtimeEl.setAttribute('data-ob-runtime', RUNTIME_MARKER);
    }
    panel.querySelector('.ob-close').onclick = () => panel.remove();
    panel.onclick = (e) => { if (e.target === panel) panel.remove(); };

    function refresh() {
      panel.querySelector('#ob-count').textContent = String(Index.size());
      const list = panel.querySelector('#ob-list');
      list.innerHTML = '';
      const ps = Store.persons();
      const grouped = new Map();
      for (const id in ps) {
        const p = ps[id];
        const group = platformGroupForPerson(p);
        if (!grouped.has(group)) grouped.set(group, []);
        grouped.get(group).push({ id, person: p });
      }
      const order = ['bili', 'weibo', 'douyin', 'zhihu', 'tieba', 'x', 'mixed', 'other'];
      for (const group of order) {
        const entries = grouped.get(group);
        if (!entries || !entries.length) continue;
        const section = document.createElement('section');
        section.className = 'ob-platform-group';
        const heading = document.createElement('h4');
        heading.className = 'ob-platform-title';
        heading.textContent = platformLabel(group) + '（' + entries.length + '）';
        section.appendChild(heading);
        for (const entry of entries) {
          const id = entry.id; const p = entry.person;
          const row = document.createElement('div');
          row.className = 'ob-item';
          if (p.note) row.title = '屏蔽依据：' + p.note;
        const details = document.createElement('div');
        const name = document.createElement('div'); name.textContent = p.label || '未命名';
        const identities = document.createElement('div'); identities.className = 'ob-meta'; identities.textContent = (p.identities || []).map(formatIdentityForDisplay).join('  ');
        details.append(name, identities);
        if (p.note) {
          const note = document.createElement('div'); note.className = 'ob-note'; note.textContent = p.note;
          details.appendChild(note);
        }
        row.appendChild(details);
        const del = document.createElement('button');
        del.className = 'ob-del'; del.textContent = '删除';
        del.onclick = () => { Store.removePerson(id); refresh(); if (currentScanner) currentScanner.schedule(); };
        row.appendChild(del);
          section.appendChild(row);
        }
        list.appendChild(section);
      }
      const s = Store.settings();
      panel.querySelector('#ob-enabled').checked = s.enabled;
      panel.querySelector('#ob-hover').checked = s.showHoverButton;
      panel.querySelector('#ob-quick').checked = s.showQuickBlock;
      panel.querySelector('#ob-bulk').checked = s.showBulkBlock;
      panel.querySelector('#ob-skip').checked = s.douyinAutoSkip;
      panel.querySelector('#ob-skipcap').value = s.skipCap;
      const backup = Store.backupStatus();
      const backupToggle = panel.querySelector('#ob-local-backup');
      const restoreBackup = panel.querySelector('#ob-restore-backup');
      const backupStatus = panel.querySelector('#ob-backup-status');
      backupToggle.checked = s.localBackupEnabled;
      restoreBackup.disabled = backup.count < 2;
      backupStatus.textContent = backup.error
        || (backup.count ? ('已保留 ' + backup.count + '/' + backup.retention + ' 份本地快照，最新：' + new Date(backup.latestAt).toLocaleString()) : '尚无本地快照，将在下一次名单变更时建立');
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
    panel.querySelector('#ob-local-backup').onchange = (e) => {
      Store.setSetting('localBackupEnabled', e.target.checked);
      if (e.target.checked) Store.ensureLocalBackup();
      refresh();
    };
    panel.querySelector('#ob-export').onclick = () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'omniblock-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    panel.querySelector('#ob-restore-backup').onclick = () => {
      if (Store.backupStatus().count < 2) { showToast('暂无可恢复的上一份快照'); return; }
      if (!window.confirm('恢复上一份本地快照？当前状态会先保留为新的快照。')) return;
      try {
        const result = Store.restorePreviousBackup();
        refresh(); refreshQuickBlock(); refreshBulkBlock();
        if (currentScanner) currentScanner.schedule();
        showToast('已恢复本地快照：' + result.identities + ' 个身份');
      } catch (e) { showToast('恢复失败：' + (e && e.message || e)); }
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
    if (currentAdapter.id === 'douyin') setupDouyinDanmakuManager();
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
      gear.setAttribute('data-ob-version', RUNTIME_VERSION);
      gear.setAttribute('data-ob-build', RUNTIME_BUILD);
      gear.setAttribute('data-ob-runtime', RUNTIME_MARKER);
      gear.onclick = () => openOptions();
      document.body.appendChild(gear);
    })();
  }

  // 暴露调试接口
  window.OB = {
    Store, Index, openOptions, adapters: Adapters, collectUsers, identifyFromAnchor,
    setupQuickBlock: refreshQuickBlock, refreshBulk: refreshBulkBlock,
    openCommentManager, closeCommentManager, runThreadBlock, mergeCommentRecords,
    runtime: { version: RUNTIME_VERSION, build: RUNTIME_BUILD, marker: RUNTIME_MARKER },
    diagnostics: runtimeDiagnostics,
  };
})();

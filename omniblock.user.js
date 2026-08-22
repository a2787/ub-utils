// ==UserScript==
// @name          本地内容过滤增强
// @namespace     https://github.com/a2787/ub-utils
// @version       0.17.0
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
    .ob-blocked-wrapper { min-height: 0 !important; height: auto !important; padding-top: 0 !important; padding-bottom: 0 !important; margin-top: 0 !important; margin-bottom: 0 !important; }

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
    /* 微博当前详情页评论操作区内的常驻入口。 */
    .ob-weibo-comment-block {
      flex: 0 0 auto !important; box-sizing: border-box !important; min-height: 22px !important;
      border: 1px solid #e2a39c !important; border-radius: 4px !important; padding: 1px 6px !important;
      background: transparent !important; color: #c0392b !important; font-size: 11px !important;
      line-height: 18px !important; white-space: nowrap !important; cursor: pointer !important;
    }
    .ob-weibo-comment-block:hover { background: #fdeceb !important; }
    /* B站右侧弹幕列表里的本地发送者屏蔽入口 */
    .ob-dm-block {
      flex: 0 0 auto !important; margin-left: 8px !important; padding: 2px 6px !important;
      border: 1px solid #e89a91 !important; border-radius: 4px !important; background: #fff !important;
      color: #c0392b !important; font-size: 11px !important; line-height: 18px !important; cursor: pointer !important;
    }
    .ob-dm-block:hover { background: #fdeceb !important; }
    [data-ob-dm-action="1"] {
      position: relative !important; box-sizing: border-box !important; padding-right: 76px !important;
    }
    [data-ob-dm-action="1"] > .ob-dm-block {
      position: absolute !important; right: 4px !important; top: 50% !important;
      transform: translateY(-50%) !important; margin: 0 !important; z-index: 1 !important;
    }
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
    @media (max-width: 520px) {
      #ob-dm-manager { align-items: flex-end; }
      #ob-dm-manager .ob-dm-box { width: 100vw; max-height: 88vh; border-radius: 8px 8px 0 0; }
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
    #ob-panel .ob-list { border: 1px solid #eee; border-radius: 8px; max-height: 260px; overflow: auto; }
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
    let wrapper = container && container.parentElement;
    while (wrapper && wrapper.classList && wrapper.classList.contains('ob-blocked-wrapper')) {
      const parent = wrapper.parentElement;
      wrapper.classList.remove('ob-blocked-wrapper');
      if (!wrapper.getAttribute('class')) wrapper.removeAttribute('class');
      wrapper = parent;
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
    let node = container.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle ? getComputedStyle(node) : null;
      const hasMeaningfulChild = Array.from(node.children || []).some((child) => (
        child !== container && !child.hasAttribute?.('data-ob-blocked')
      ));
      const hasOwnText = Array.from(node.childNodes || []).some((child) => (
        child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()
      ));
      if (hasMeaningfulChild || hasOwnText) break;
      if (!style || style.display === 'none' || style.visibility === 'hidden') break;
      if (!(node.offsetHeight > 0 || node.scrollHeight > 0)) break;
      node.classList.add('ob-blocked-wrapper');
      node = node.parentElement;
    }
  }

  // 通用：处理一个"条目"——抽出身份，命中则隐藏
  function handleItem(adapter, item) {
    const info = adapter.extract(item);
    const container = (info && adapter.containerOf && adapter.containerOf(item)) || (info && info.container) || item;
    if (!info || !info.keys || !info.keys.length) { unmark(container); return; }
    if (Index.isBlocked(info.keys)) {
      markBlocked(container, info.label, modeForItem(adapter, item));
      collapseBlockedWrappers(container);
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
      showToast(`已拉黑：${label || normalizedKeys[0]}`, transaction && transaction.undo || null);
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
      return { keys, label: name, container: findContainer(item) };
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
      for (const button of querySelectorAllDeep(document, '.ob-weibo-comment-block')) button.remove();
    }
    function syncCommentButtons() {
      for (const button of querySelectorAllDeep(document, '.ob-weibo-comment-block')) {
        if (!button.closest || !button.closest(SEL.comment)) button.remove();
      }
      const enabled = Store.getSetting('enabled') && Store.getSetting('showQuickBlock');
      for (const item of collectWeiboItems(document, SEL.comment)) {
        const mount = commentActionMount(item);
        if (!mount) continue;
        let button = mount.querySelector(':scope > .ob-weibo-comment-block');
        const info = extract(item);
        if (!enabled || !info.keys.length || Index.isBlocked(info.keys)) {
          if (button) button.remove();
          continue;
        }
        if (button) continue;
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
      canBulkModal(modal) {
        return querySelectorAllDeep(modal || document, WB_MODAL_USER_SEL)
          .some((link) => uidFromLink(link) && isVisible(link));
      },
      bulkFabLabel: (n) => '🚫 拉黑已加载微博/评论作者(' + n + ')',
      containerOf: (item) => findContainer(item),
      onScan: syncCommentButtons,
      onDisabled: clearCommentButtons,
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
      const scope = root || document;
      return querySelectorAllDeep(scope, 'a[href*="space.bilibili.com/"]').map(userFromSpaceLink).filter(Boolean);
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
          if (a.id === 'bilibili' && t.indexOf('举报') !== -1) {
            const dmInfo = floatingDanmaku.fresh();
            if (!dmInfo) {
              el.setAttribute('data-ob-qb', '1');
              return;
            }
            if (el.parentNode && el.parentNode.querySelector(':scope > .ob-quick')) return;
            const btn = makeQuickBtn(dmInfo.label, el, { identify: () => dmInfo }, dmInfo.keys.join('|'));
            el.setAttribute('data-ob-qb', '1');
            el.insertAdjacentElement('afterend', btn);
            return;
          }
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

  function blockMany(list, anchorEl, confirmLabel, onBlocked) {
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
          const filtered = asArrayBuffer(filterSeg(raw));
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
        filterSeg(bytes);
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
      warning.textContent = '仅查询 1–10 位 UID；CRC32 可能碰撞，请打开主页核对后确认。';
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
            choose.type = 'button'; choose.className = 'ob-dm-uid-link'; choose.textContent = '确认并拉黑';
            choose.addEventListener('click', (event) => {
              event.stopPropagation(); event.preventDefault();
              confirmDmUidCandidate(hash, candidate, group.content, choose);
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
      dmPickTarget = null;
      if (dmPickButton) dmPickButton.style.setProperty('display', 'none', 'important');
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
      const width = button.offsetWidth || 150;
      const left = Math.min(Math.max(4, hit.rect.left), Math.max(4, window.innerWidth - width - 4));
      const top = hit.rect.top - 26 >= 4 ? hit.rect.top - 26 : hit.rect.bottom + 6;
      button.style.setProperty('left', Math.round(left) + 'px', 'important');
      button.style.setProperty('top', Math.round(top) + 'px', 'important');
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

    const DM_PANEL_SEL = '.bpx-player-dm-container,.bpx-player-dm-list,.bpx-player-dm-list-container,.bpx-player-dm-list-view';
    const DM_ROW_SEL = 'li,[data-mid-hash],[data-mid_hash],[data-dm-hash],[data-danmaku-hash],[class*="dm-item"],[class*="danmaku-item"]';
    function addDmBlockButton(row, hash) {
      row.setAttribute('data-ob-dm-action', '1');
      if (row.querySelector && row.querySelector(':scope > .ob-dm-block')) return;
      const btn = document.createElement('button');
      btn.className = 'ob-dm-block'; btn.type = 'button'; btn.textContent = '本地拉黑';
      btn.title = '按该弹幕的 mid_hash 本地屏蔽发送者';
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        blockMany([{
          keys: [makeIdentityKey('bili:dmhash', hash)],
          label: 'B站弹幕发送者',
          note: 'B站弹幕段未提供昵称/UID；同一发送者后续弹幕均会屏蔽。',
        }], btn, '屏蔽该弹幕发送者', scanDmPanels);
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
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          const hash = hashFromDmRow(row);
          if (!hash) {
            setInlineHidden(row, false);
            row.removeAttribute('data-ob-dm-blocked');
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          if (blocked.has(hash)) {
            row.setAttribute('data-ob-dm-blocked', '1');
            setInlineHidden(row, true);
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          setInlineHidden(row, false);
          row.removeAttribute('data-ob-dm-blocked');
          if (showButton) addDmBlockButton(row, hash);
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
              if (xhr.__obDanmakuVideoKey && xhr.__obDanmakuVideoKey !== currentVideoKey()) return raw;
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
        this.__obDanmakuVideoKey = currentVideoKey();
        if (isDanmakuUrl(this.__obDanmakuUrl)) {
          noteDanmakuUrl(this.__obDanmakuUrl);
          installPakkuResponseFilter(this);
        }
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
        const requestKey = currentVideoKey();
        noteDanmakuUrl(url);
        return nativeFetch(input, init).then(async (resp) => {
          try {
            if (currentVideoKey() !== requestKey) return resp;
            const buf = await resp.clone().arrayBuffer();
            if (currentVideoKey() !== requestKey) return resp;
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
        list.appendChild(row);
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

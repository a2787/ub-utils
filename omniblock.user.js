// ==UserScript==
// @name          本地内容过滤增强
// @namespace     https://github.com/a2787/ub-utils
// @version       0.46.1
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
(async function () {
  'use strict';

  // 运行锁必须先于任何异步初始化建立。开发扩展的存储恢复栅栏可能等待
  // 多个消息边界；如果在 await 之后才写锁，重复注入可以同时通过检查，
  // 从而各自创建 observer、定时器和 UI。starting 与 active 共用同一把锁，
  // 只有第一份实例允许继续等待初始化。
  const RUNTIME_GUARD_KEY = '__OB_RUNTIME_GUARD__';
  const RUNTIME_BUILD = '0.46.1-bili-comment-menu-report';
  const RUNTIME_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version)
    ? String(GM_info.script.version) : 'unknown';
  const activeRuntime = window[RUNTIME_GUARD_KEY];
  if (activeRuntime && activeRuntime.active) {
    activeRuntime.duplicateExecutions = Number(activeRuntime.duplicateExecutions || 0) + 1;
    return;
  }
  const runtimeGuard = window[RUNTIME_GUARD_KEY] = {
    active: true,
    state: 'starting',
    version: RUNTIME_VERSION,
    build: RUNTIME_BUILD,
    duplicateExecutions: 0,
  };

  // 专用开发扩展在真正初始化 GM 存储前会暴露这个异步栅栏；Tampermonkey
  // 和本地夹具没有该桥接时保持原有同步启动路径。这样新标签页不会在存储
  // 尚未恢复时先扫描并把默认状态写回去。
  const extensionReady = window.__OB_EXTENSION_READY__;
  if (typeof extensionReady === 'function') {
    try { await extensionReady(); } catch (error) { /* 降级到当前运行时的默认存储 */ }
  }

  runtimeGuard.state = 'active';

  // ====================================================================
  // 0. 基础工具
  // ====================================================================
  // 更新地址（与脚本头 @updateURL/@downloadURL 保持一致；用户脚本运行时无法自读元数据，故显式声明）
  const UPDATE_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';
  const DOWNLOAD_URL = UPDATE_URL;
  // 维护门禁：@version 标识发布序列，RUNTIME_BUILD 标识源码契约；两者都显示在页面上，
  // 便于在用户自己的 Tampermonkey 会话中确认“当前运行代码”确实来自本轮源码。
  // 调试探针、浏览器扩展重放或同一文档内的手动注入可能把同一份源码执行多次。
  // 运行时必须按文档幂等：第二份不能再创建扫描器、观察器、定时器和 UI。
  // 新版本在既有页面中的生效仍以刷新/新文档为边界，符合用户脚本的正常生命周期。
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
      // B 站 Lit 组件把大量布局 CSS 放在评论节点的 ShadowRoot 内；
      // 摘要只应读取用户可见文本，不能把 style/script/template 源码混进面板。
      if (node.nodeType === 1 && /^(STYLE|SCRIPT|NOSCRIPT|TEMPLATE)$/i.test(node.tagName)) return;
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
    if (!root) return null;
    const seen = new Set();
    const find = (node) => {
      if (!node || seen.has(node)) return null;
      seen.add(node);
      if (node.nodeType === 1 && node.matches) {
        try { if (node.matches(sel)) return node; }
        catch (e) { return null; }
        if (node.shadowRoot) {
          const shadowMatch = find(node.shadowRoot);
          if (shadowMatch) return shadowMatch;
        }
      }
      for (const child of node.children || []) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    };
    return find(root);
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

  // 同一次全量扫描需要匹配多个适配器选择器时，只遍历 DOM/Shadow DOM 一次。
  // 旧实现按选择器重复深度遍历；在 B 站评论和抖音播放器节点较多时，遍历成本
  // 会近似按选择器数量线性放大。返回数组与输入选择器一一对应，保留旧调用方
  // 的计数和处理顺序语义。
  function querySelectorAllDeepMany(root, selectors, onShadowRoot) {
    const selectorList = Array.isArray(selectors) ? selectors : [];
    const buckets = selectorList.map(() => []);
    if (!root || !selectorList.length) return buckets;
    const seen = new Set();
    const collect = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (node.nodeType === 1 && node.matches) {
        for (let index = 0; index < selectorList.length; index++) {
          try { if (node.matches(selectorList[index])) buckets[index].push(node); } catch (e) {}
        }
        if (node.shadowRoot) {
          if (typeof onShadowRoot === 'function') {
            try { onShadowRoot(node.shadowRoot); } catch (e) {}
          }
          collect(node.shadowRoot);
        }
      }
      for (const child of node.children || []) collect(child);
    };
    collect(root);
    return buckets;
  }

  // 运行时资源注册表：长寿命页面会建立循环、订阅和观察器；每一项都登记唯一
  // 清理函数。普通 pagehide 代表文档即将销毁，统一停止资源；BFCache 页面只暂停，
  // 仍由 PageLifecycle 在 pageshow/resume 后恢复，避免返回页面时运行时永久失效。
  const RuntimeResources = (() => {
    const disposers = new Set();
    let disposed = false;
    let reason = '';
    function add(disposer) {
      if (typeof disposer !== 'function') return () => {};
      if (disposed) {
        try { disposer(); } catch (e) {}
        return () => {};
      }
      disposers.add(disposer);
      return () => disposers.delete(disposer);
    }
    function dispose(nextReason) {
      if (disposed) return;
      disposed = true;
      reason = String(nextReason || 'runtime-dispose');
      const pending = Array.from(disposers);
      disposers.clear();
      for (const disposer of pending) {
        try { disposer(); } catch (e) {}
      }
    }
    function status() {
      return { disposed, reason, resources: disposers.size };
    }
    function timeout(callback, delay) {
      let timer = 0;
      let unregister = () => {};
      const cancel = () => {
        if (timer) { clearTimeout(timer); timer = 0; }
        unregister();
      };
      timer = setTimeout(() => {
        timer = 0;
        unregister();
        if (!disposed) {
          try { callback(); } catch (e) {}
        }
      }, Math.max(0, Number(delay) || 0));
      unregister = add(cancel);
      return cancel;
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', (event) => {
        if (!event || !event.persisted) dispose('pagehide');
      }, { capture: true });
    }
    return { add, dispose, status, timeout };
  })();

  // 页面级生命周期：后台或 frozen 标签页不需要继续处理动态 DOM。各功能模块共享
  // 这一组监听，避免各自建立 visibility/freeze/resume 事件和相互冲突的状态。
  const PageLifecycle = (() => {
    const listeners = new Set();
    let bound = false;
    let frozen = false;
    const isVisible = () => {
      if (typeof document === 'undefined') return true;
      if (frozen) return false;
      if (typeof document.visibilityState === 'string') return document.visibilityState !== 'hidden';
      return !document.hidden;
    };
    const notify = () => {
      const visible = isVisible();
      for (const listener of Array.from(listeners)) {
        try { listener(visible); } catch (e) {}
      }
    };
    const subscribe = (listener) => {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      if (!bound && typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', notify, { passive: true });
        document.addEventListener('freeze', () => { frozen = true; notify(); }, { passive: true });
        document.addEventListener('resume', () => { frozen = false; notify(); }, { passive: true });
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('pageshow', () => { frozen = false; notify(); }, { passive: true });
        }
        bound = true;
      }
      const unregisterRuntime = RuntimeResources.add(() => listeners.delete(listener));
      return () => { listeners.delete(listener); unregisterRuntime(); };
    };
    return { isVisible, subscribe, status: () => ({ visible: isVisible(), frozen, listeners: listeners.size }) };
  })();

  // 共享 DOM 活动信号：主扫描器已经承担 MutationObserver 的监听和 Shadow DOM
  // 发现工作，其他模块只订阅批次通知，不再各自建立观察器。订阅者必须在回调里
  // 只做标记/排队，具体扫描交给自己的 rAF 或低频循环。
  const PageMutationSignals = (() => {
    const listeners = new Set();
    const subscribe = (listener) => {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      const unregisterRuntime = RuntimeResources.add(() => listeners.delete(listener));
      return () => { listeners.delete(listener); unregisterRuntime(); };
    };
    const notify = (records, adapterId) => {
      for (const listener of Array.from(listeners)) {
        try { listener(records, adapterId); } catch (e) {}
      }
    };
    return { subscribe, notify };
  })();

  // SPA 路由只由主扫描器轮询一次，其他模块订阅这个共享信号；禁止每个入口再
  // 建立自己的 location.href 定时器。
  const PageRouteSignals = (() => {
    const listeners = new Set();
    const subscribe = (listener) => {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      const unregisterRuntime = RuntimeResources.add(() => listeners.delete(listener));
      return () => { listeners.delete(listener); unregisterRuntime(); };
    };
    const notify = (nextUrl, previousUrl) => {
      for (const listener of Array.from(listeners)) {
        try { listener(nextUrl, previousUrl); } catch (e) {}
      }
    };
    return { subscribe, notify };
  })();

  // 页面会话代号只用于丢弃跨 SPA 路由的旧异步结果；它不参与身份键，也不写入
  // 名单。评论/楼中楼读取等长任务在回调返回前必须核对这个代号。
  let pageSessionGeneration = 0;
  const pageSessionAbortControllers = new Set();
  PageRouteSignals.subscribe(() => {
    pageSessionGeneration++;
    // 适配器可选择消费 AbortSignal；即使旧版 loader 忽略它，下面各完成回调
    // 仍会用 generation/url/isConnected 再次核对并丢弃结果。
    for (const controller of Array.from(pageSessionAbortControllers)) {
      try { controller.abort(); } catch (e) {}
    }
    pageSessionAbortControllers.clear();
  });

  // 用一次性 timeout 取代独立 setInterval：任务执行期间不会重入，隐藏页面时
  // 不排队，功能关闭后也不会继续自我唤醒。wake() 供设置变化和页面恢复时立即
  // 触发一次，正常周期仍使用调用方提供的低频间隔。
  function createPageLoop(callback, interval, isActive = () => true) {
    const delay = Math.max(100, Number(interval) || 1000);
    let timer = 0;
    let stopped = false;
    const clear = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = 0;
    };
    const schedule = (nextDelay = delay) => {
      if (stopped || timer || !PageLifecycle.isVisible() || !isActive()) return;
      timer = setTimeout(run, Math.max(0, Number(nextDelay) || 0));
    };
    const run = () => {
      timer = 0;
      if (stopped || !PageLifecycle.isVisible() || !isActive()) return;
      try { callback(); }
      finally { schedule(delay); }
    };
    const unsubscribe = PageLifecycle.subscribe((visible) => {
      if (!visible) { clear(); return; }
      schedule(0);
    });
    let unregisterRuntime = () => {};
    const api = {
      wake(nextDelay = 0) {
        if (stopped) return;
        clear();
        if (!PageLifecycle.isVisible() || !isActive()) return;
        schedule(nextDelay);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        clear();
        unsubscribe();
        unregisterRuntime();
      },
      status() { return { stopped, scheduled: !!timer, active: !stopped && !!isActive() }; },
    };
    unregisterRuntime = RuntimeResources.add(api.stop);
    schedule(delay);
    return api;
  }

  // 沿 composedPath（含影子宿主）找到第一个匹配适配器的条目
  function findItem(targetOrEvent, adapter) {
    // 事件目标在开放 Shadow DOM 中会被浏览器重定向为宿主元素；只有从
    // Event.composedPath() 才能取得真正命中的评论节点。保留元素参数路径
    // 兼容快捷入口等非事件调用。
    const event = targetOrEvent && typeof targetOrEvent.composedPath === 'function' ? targetOrEvent : null;
    const target = event ? event.target : targetOrEvent;
    const path = event ? event.composedPath() : (() => {
      const out = [];
      let node = target && target.nodeType === 1 ? target : target && (target.parentElement || target.parentNode);
      for (let guard = 0; node && guard < 64; guard++) {
        out.push(node);
        if (node.parentElement) node = node.parentElement;
        else {
          const root = node.getRootNode && node.getRootNode();
          node = (root && root.host) || null;
        }
      }
      return out;
    })();
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

  // 自动弹幕规则只允许两种可审计的本地匹配方式：不区分大小写的关键词和
  // 正则表达式。规则不进入身份键，也不上传；命中后仍由各平台自己的身份链
  // 负责建立本地屏蔽身份。限制长度/数量是为了避免把一个失控表达式放进热路径。
  const DANMAKU_RULE_LIMIT = 64;
  const DANMAKU_RULE_MAX_LENGTH = 240;
  const DANMAKU_RULE_KINDS = new Set(['keyword', 'regex']);
  const DANMAKU_RULE_SETTING_KEYS = {
    bili: 'biliDanmakuRules',
    douyin: 'douyinDanmakuRules',
  };
  const DANMAKU_EXEMPTION_SETTING_KEYS = {
    bili: 'biliDanmakuExemptions',
    douyin: 'douyinDanmakuExemptions',
  };
  // 评论管理器只服务当前页面的识别、筛选和批量操作，不是永久历史数据库。
  // 设上限既避免虚拟列表长时间滚动后 Map 无限增长，也让达到上限时可以
  // 明确告诉用户结果可能不完整，而不是静默丢失评论。
  const COMMENT_MANAGER_RECORD_LIMIT = 20000;

  function ruleText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, DANMAKU_RULE_MAX_LENGTH);
  }

  function ruleHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function compileDanmakuRule(rule) {
    if (!rule || rule.kind !== 'regex') return null;
    let source = rule.pattern;
    let flags = 'iu';
    // 同时接受裸正则和常见的 /pattern/flags 写法；默认仍强制 Unicode + 忽略大小写，
    // 避免正则规则和关键词规则在中英文大小写上的行为不一致。
    const literal = source.match(/^\/(.*)\/([dgimsuvy]*)$/);
    if (literal) {
      source = literal[1];
      flags = Array.from(new Set((literal[2] || '').split('').concat(['i', 'u']))).join('');
    }
    try { return new RegExp(source, flags); } catch (e) { return null; }
  }

  function normalizeDanmakuRule(raw) {
    if (!raw || typeof raw !== 'object' || !DANMAKU_RULE_KINDS.has(raw.kind)) return null;
    const pattern = ruleText(raw.pattern);
    if (!pattern) return null;
    const rule = {
      id: 'r_' + ruleHash(raw.kind + '\x1f' + pattern),
      kind: raw.kind,
      pattern,
      enabled: raw.enabled !== false,
    };
    if (rule.kind === 'regex' && !compileDanmakuRule(rule)) return null;
    return rule;
  }

  function sanitizeDanmakuRules(input) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(input) ? input : []) {
      const rule = normalizeDanmakuRule(raw);
      if (!rule || seen.has(rule.id)) continue;
      seen.add(rule.id);
      out.push(rule);
      if (out.length >= DANMAKU_RULE_LIMIT) break;
    }
    return out;
  }

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

  function sanitizeDanmakuExemptions(input, platform) {
    const prefix = String(platform || '') + ':';
    return normalizeIdentityKeys(input).filter((key) => key.startsWith(prefix));
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
  const MAIN_STORAGE_WARNING_CHARS = 2 * 1024 * 1024;
  const MAIN_STORAGE_CRITICAL_CHARS = 3 * 1024 * 1024;
  const DEV_BRIDGE_VALUE_MAX_CHARS = 4 * 1024 * 1024;

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideMode: 'collapse',        // 'collapse' | 'disappear'
    showHoverButton: true,       // 平台专用悬浮入口（当前为抖音弹幕跟随按钮）
    douyinAutoSkip: true,
    skipCap: 6,                  // 连续跳过上限，超过则停在遮罩不再自动切
    showQuickBlock: true,        // 在平台原生"拉黑/举报"旁插入"本地拉黑"
    showBulkBlock: true,         // 本页/弹窗内"一键拉黑全部用户"
    localBackupEnabled: true,    // 自动保留最近 5 份本地快照（不上传）
    logEnabled: true,            // 记录本机 OmniBlock 运行事件，反馈页可暂停/导出
    biliDanmakuRules: [],        // B站自动弹幕关键词/正则；不承担 PAKKU 去重
    douyinDanmakuRules: [],      // 抖音自动弹幕关键词/正则
    biliDanmakuExemptions: [],   // B站自动规则例外；只跳过规则，不是新的屏蔽身份
    douyinDanmakuExemptions: [], // 抖音自动规则例外；只跳过规则，不是新的屏蔽身份
  };

  const Store = (function () {
    let data = null;             // { version, persons:{}, settings:{} }
    const listeners = [];
    const persistListeners = [];
    const backupSinks = new Map();
    let backupLastRevision = 0;
    let backupError = '';
    const persistMetrics = {
      count: 0,
      failures: 0,
      lastOk: true,
      lastError: '',
      pendingLocalWrite: false,
      externalConflict: false,
      externalConflicts: 0,
      lastExternalConflictAt: 0,
      lastDurationMs: 0,
      maxDurationMs: 0,
      lastPayloadChars: 0,
    };
    // key → 归属人物集合。名单通常很小，但批量导入/作品屏蔽会连续调用多个
    // addIdentities；缓存避免每组都重新遍历全部人物和身份数组。直接改动名单的
    // 少数路径会显式失效，下一次查询再惰性重建。
    let identityOwners = null;
    const identityIndexMetrics = { rebuilds: 0, lookups: 0 };

    function cleanText(value, fallback, maxLength) {
      if (value == null) return fallback;
      const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
      return (text || fallback).slice(0, maxLength);
    }

    function sanitizeSettings(input) {
      const source = input && typeof input === 'object' ? input : {};
      const out = { ...DEFAULT_SETTINGS };
      for (const key of ['enabled', 'showHoverButton', 'douyinAutoSkip', 'showQuickBlock', 'showBulkBlock', 'localBackupEnabled', 'logEnabled']) {
        if (typeof source[key] === 'boolean') out[key] = source[key];
      }
      if (source.hideMode === 'collapse' || source.hideMode === 'disappear') out.hideMode = source.hideMode;
      const cap = Number(source.skipCap);
      if (Number.isFinite(cap)) out.skipCap = clamp(Math.round(cap), 0, 50);
      for (const platform of Object.keys(DANMAKU_RULE_SETTING_KEYS)) {
        const key = DANMAKU_RULE_SETTING_KEYS[platform];
        out[key] = sanitizeDanmakuRules(source[key]);
      }
      for (const platform of Object.keys(DANMAKU_EXEMPTION_SETTING_KEYS)) {
        const key = DANMAKU_EXEMPTION_SETTING_KEYS[platform];
        out[key] = sanitizeDanmakuExemptions(source[key], platform);
      }
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
      identityOwners = null;
      return data;
    }

    function invalidateIdentityOwners() {
      identityOwners = null;
    }

    function ensureIdentityOwners() {
      load();
      if (identityOwners) return identityOwners;
      const owners = new Map();
      for (const id of Object.keys(data.persons || {})) {
        const person = data.persons[id];
        for (const key of (person && Array.isArray(person.identities) ? person.identities : [])) {
          let ids = owners.get(key);
          if (!ids) { ids = new Set(); owners.set(key, ids); }
          ids.add(id);
        }
      }
      identityOwners = owners;
      identityIndexMetrics.rebuilds++;
      return identityOwners;
    }

    function addIdentityOwner(key, id) {
      if (!identityOwners || !key || !id) return;
      let ids = identityOwners.get(key);
      if (!ids) { ids = new Set(); identityOwners.set(key, ids); }
      ids.add(id);
    }

    function removeIdentityOwner(key, id) {
      if (!identityOwners || !key || !id) return;
      const ids = identityOwners.get(key);
      if (!ids) return;
      ids.delete(id);
      if (!ids.size) identityOwners.delete(key);
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
      const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      let payload = '';
      let writeError = '';
      try {
        payload = JSON.stringify(data);
        GM_setValue(STORAGE_KEY, payload);
      } catch (e) {
        persistMetrics.failures++;
        persistMetrics.lastOk = false;
        persistMetrics.lastError = 'main-storage-write-failed';
        persistMetrics.pendingLocalWrite = true;
        writeError = persistMetrics.lastError;
      }
      const duration = Math.max(0, (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - startedAt);
      persistMetrics.count++;
      persistMetrics.lastDurationMs = duration;
      persistMetrics.maxDurationMs = Math.max(persistMetrics.maxDurationMs, duration);
      persistMetrics.lastPayloadChars = payload.length;
      if (writeError) {
        // 内存状态仍需通知界面刷新，但不能把写入失败伪装成成功：备份、provider
        // 和 storage.persist 日志只在主名单确认写入后触发。下一次成功写入仍会
        // 把当前内存状态完整落盘，因此不会引入半份名单。
        listeners.forEach((fn) => { try { fn(); } catch (e) {} });
        return { ok: false, error: writeError };
      }
      persistMetrics.lastOk = true;
      persistMetrics.lastError = '';
      persistMetrics.pendingLocalWrite = false;
      persistMetrics.externalConflict = false;
      const snapshot = snapshotObject(reason || 'change');
      captureBackup(snapshot, reason || 'change');
      notifyBackupSinks(snapshot);
      listeners.forEach((fn) => { try { fn(); } catch (e) {} });
      persistListeners.forEach((fn) => { try { fn(snapshot); } catch (e) {} });
      return { ok: true, error: '' };
    }

    function persons() { return load().persons; }
    function settings() { return load().settings; }
    function storageStatus() {
      const state = load();
      const personList = Object.values(state.persons || {});
      const identities = personList.reduce((total, person) => (
        total + (person && Array.isArray(person.identities) ? person.identities.length : 0)
      ), 0);
      let chars = 0;
      try { chars = JSON.stringify(state).length; } catch (e) { chars = MAIN_STORAGE_CRITICAL_CHARS; }
      const level = chars >= MAIN_STORAGE_CRITICAL_CHARS
        ? 'critical'
        : (chars >= MAIN_STORAGE_WARNING_CHARS ? 'warning' : 'normal');
      return {
        persons: personList.length,
        identities,
        chars,
        level,
        warningChars: MAIN_STORAGE_WARNING_CHARS,
        criticalChars: MAIN_STORAGE_CRITICAL_CHARS,
        devBridgeMaxChars: DEV_BRIDGE_VALUE_MAX_CHARS,
        identityIndex: {
          ...identityIndexMetrics,
          entries: ensureIdentityOwners().size,
        },
        persist: { ...persistMetrics },
      };
    }
    function setSetting(k, v) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) return false;
      const next = sanitizeSettings({ ...load().settings, [k]: v });
      const previous = load().settings[k];
      if (Array.isArray(next[k]) || Array.isArray(previous)) {
        if (JSON.stringify(next[k]) === JSON.stringify(previous)) return true;
      } else if (next[k] === previous) return true;
      data.settings = next;
      const result = persist(); return result.ok;
    }
    function getSetting(k) { return load().settings[k]; }

    function addIdentitiesInternal(keys, label, note, meta) {
      load();
      const normalized = normalizeIdentityKeys(keys);
      if (!normalized.length) return { person: null, personId: '', added: 0, addedKeys: [], rejected: true };
      const pset = persons();
      const ownerIndex = ensureIdentityOwners();
      identityIndexMetrics.lookups += normalized.length;
      const existingKeys = new Set(ownerIndex.keys());
      const matchedIdSet = new Set();
      for (const key of normalized) {
        const owners = ownerIndex.get(key);
        if (owners) for (const id of owners) matchedIdSet.add(id);
      }
      const matchedIds = Array.from(matchedIdSet);
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
        for (const key of other.identities) {
          if (!target.identities.includes(key)) target.identities.push(key);
          removeIdentityOwner(key, id);
          addIdentityOwner(key, targetId);
        }
        if (target.label === '未命名' && other.label) target.label = other.label;
        if (!target.note && other.note) target.note = other.note;
        target.createdAt = Math.min(target.createdAt || Date.now(), other.createdAt || Date.now());
        target.hits = (target.hits || 0) + (other.hits || 0);
        delete pset[id];
      }
      for (const key of normalized) {
        if (!target.identities.includes(key)) target.identities.push(key);
        addIdentityOwner(key, targetId);
      }
      if (label && target.label === '未命名') target.label = cleanText(label, '未命名', 200);
      const addedKeys = normalized.filter((key) => !existingKeys.has(key));
      return { person: target, personId: targetId, added: addedKeys.length, addedKeys, rejected: false };
    }

    function addIdentities(keys, label, note) {
      const result = addIdentitiesInternal(keys, label, note);
      if (result.rejected) return result;
      const persisted = persist();
      return { ...result, persisted: persisted.ok, persistError: persisted.error || '' };
    }

    function addIdentityGroups(groups) {
      const results = [];
      for (const group of Array.isArray(groups) ? groups : []) {
        const result = addIdentitiesInternal(group && group.keys, group && group.label, group && group.note);
        if (!result.rejected) results.push(result);
      }
      if (results.length) {
        const persisted = persist();
        // 保持原有数组返回兼容性，同时让批量调用方可以显式判断主名单写入。
        Object.defineProperties(results, {
          persisted: { value: persisted.ok, enumerable: false },
          persistError: { value: persisted.error || '', enumerable: false },
        });
      }
      return results;
    }

    function confirmIdentityLink(keys, label, note) {
      load();
      const normalized = normalizeIdentityKeys(keys);
      if (!normalized.length) return { person: null, personId: '', added: 0, addedKeys: [], rejected: true, undo: null };
      const pset = persons();
      const ownerIndex = ensureIdentityOwners();
      identityIndexMetrics.lookups += normalized.length;
      const existingKeys = new Set(ownerIndex.keys());
      const matchedIds = new Set();
      for (const key of normalized) {
        const owners = ownerIndex.get(key);
        if (owners) for (const id of owners) matchedIds.add(id);
      }
      // 确认关联沿用旧语义：如果导入数据已经让一个身份属于多个
      // 人物，仍只选稳定的第一个归属，不在用户确认动作里偷偷合并人物。
      let targetId = Object.keys(pset).find((id) => matchedIds.has(id)) || '';
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
        addIdentityOwner(key, targetId);
        addedKeys.push(key);
      }
      const nextLabel = cleanText(label, target.label || '未命名', 200);
      const nextNote = cleanText(note, target.note || '', 2000);
      const metadataChanged = nextLabel !== target.label || nextNote !== target.note;
      target.label = nextLabel;
      target.note = nextNote;
      const changed = created || addedKeys.length > 0 || metadataChanged;
      const persisted = changed ? persist() : { ok: true, error: '' };
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
        invalidateIdentityOwners();
        persist();
      } : null;
      return { person: target, personId: targetId, added: addedKeys.length, addedKeys, rejected: false,
        persisted: persisted.ok, persistError: persisted.error || '', undo };
    }

    function removePerson(id) {
      load();
      if (Object.prototype.hasOwnProperty.call(persons(), id)) { delete persons()[id]; invalidateIdentityOwners(); return persist().ok; }
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
      if (removed) { invalidateIdentityOwners(); persist(); }
      return removed;
    }

    function removeIdentity(key) { return removeIdentities([key]) > 0; }

    function allIdentities() {
      return new Set(ensureIdentityOwners().keys());
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
      const persisted = persist();
      result.persisted = persisted.ok;
      result.persistError = persisted.error || '';
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
      invalidateIdentityOwners();
      const persisted = persist('restore');
      return { snapshotId: target.snapshotId, persons: Object.keys(data.persons).length, identities: allIdentities().size,
        persisted: persisted.ok, persistError: persisted.error || '' };
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
      if (typeof fn !== 'function') return () => {};
      persistListeners.push(fn);
      const dispose = () => {
        const index = persistListeners.indexOf(fn);
        if (index >= 0) persistListeners.splice(index, 1);
      };
      const unregisterRuntime = RuntimeResources.add(dispose);
      return () => { dispose(); unregisterRuntime(); };
    }

    // 跨标签页/设置变更的监听
    try {
      GM_addValueChangeListener(STORAGE_KEY, () => {
        // 主名单写入失败后，当前内存状态尚未得到落盘确认。此时不能让另一
        // 标签页的通知静默覆盖这份状态；保留本地数据并暴露冲突，直到用户
        // 重试成功或主动刷新页面重新加载外部版本。
        if (persistMetrics.pendingLocalWrite) {
          persistMetrics.externalConflict = true;
          persistMetrics.externalConflicts++;
          persistMetrics.lastExternalConflictAt = Date.now();
          listeners.forEach((fn) => { try { fn(); } catch (e) {} });
          return;
        }
        data = null;
        identityOwners = null;
        load();
        const snapshot = snapshotObject('external-change', 'local');
        captureBackup(snapshot, 'external-change');
        notifyBackupSinks(snapshot);
        listeners.forEach((fn) => { try { fn(); } catch (e) {} });
        persistListeners.forEach((fn) => { try { fn(snapshot); } catch (e) {} });
      });
    } catch (e) { /* 不支持则忽略 */ }

    function onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.push(fn);
      const dispose = () => {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      };
      const unregisterRuntime = RuntimeResources.add(dispose);
      return () => { dispose(); unregisterRuntime(); };
    }

    return {
      persons, settings, storageStatus, setSetting, getSetting, addIdentities, addIdentityGroups, removePerson,
      confirmIdentityLink, removeIdentity, removeIdentities, allIdentities, exportJSON, importJSON, onChange,
      onPersist, registerBackupSink, listBackups, backupStatus, ensureLocalBackup, restoreBackup, restorePreviousBackup,
      backupFormat: BACKUP_FORMAT, backupSchema: BACKUP_SCHEMA,
    };
  })();

  // 首次加载即建立一个恢复点；没有本地备份开关或 GM 存储支持时静默降级，不影响名单。
  try { Store.ensureLocalBackup(); } catch (e) {}

  // ====================================================================
  // 1.5 本地详细事件日志
  // --------------------------------------------------------------------
  // 日志服务只保存 OmniBlock 自己观察到的事件元数据：事件类型、阶段、计数、
  // 状态和安全的节点形态。它不保存 Cookie、请求头、完整 URL、身份键、正文、
  // 原始 HTML 或异常堆栈。事件按本地日期分片，写入失败时降级到内存队列，
  // 绝不让诊断功能影响名单和隐藏主链路。
  // ====================================================================
  const EventLog = (function () {
    const INDEX_KEY = 'omniblock:events:index:v1';
    const DAY_KEY_PREFIX = 'omniblock:events:v1:';
    const FORMAT = 'omniblock.events';
    const SCHEMA = 1;
    const RETENTION_DAYS = 30;
    const MAX_EVENTS_PER_DAY = 50000;
    const MAX_TOTAL_CHARS = 16 * 1024 * 1024;
    // 被动遥测不需要把每一个 MutationObserver 回调都单独落盘。将高频、无用户
    // 操作的观察事件聚合成短窗口摘要，保留诊断计数和少量安全样本，避免空闲
    // 页面持续重写整份日志分片；用户操作、屏蔽动作和错误仍由 record() 逐条记录。
    const PASSIVE_WINDOW_MS = 10000;
    const PASSIVE_SAMPLE_LIMIT = 6;
    const MAX_VALUE_DEPTH = 4;
    const MAX_ARRAY_ITEMS = 160;
    const MAX_OBJECT_KEYS = 48;
    const MAX_STRING_LENGTH = 240;
    // 只按明确的字段名脱敏。不能把任意包含“comment”的动态 key（例如
    // selectorCounts 里的真实选择器）一起抹掉，否则日志看似详细，实际失去
    // 诊断价值。camelCase 会先转成 snake_case；身份/正文字段仍一律脱敏。
    const SENSITIVE_FIELD = /^(?:cookie|token|secret|password|credential|authorization|headers?|request_headers?|response_body|body|html|raw_html|inner_html|outer_html|comment|comment_(?:id|key|body|text|html)|content|content_(?:id|text|body|html)|message|message_(?:id|text|body|html)|note|label|name|text|keys|uid|mid|sec_uid|hash|identity|identities|href|url|query|referrer|stack|trace|exception|raw)$/i;
    function normalizedFieldName(field) {
      return String(field || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    }
    const listeners = [];
    const shardCache = new Map();
    const shardCharCache = new Map();
    let indexCache = null;
    let pending = [];
    let flushTimer = 0;
    const passiveBuckets = new Map();
    let passiveFlushTimer = 0;
    let sequence = 0;
    let writeErrors = 0;
    const metrics = {
      flushes: 0,
      failedFlushes: 0,
      lastFlushDurationMs: 0,
      maxFlushDurationMs: 0,
      storageWrites: 0,
      storageCharsWritten: 0,
    };
    let context = { platform: 'unknown', route: 'unknown' };
    let loggingEnabled = Store.getSetting('logEnabled') !== false;
    const sessionId = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    // 被动事件可能来自每一批 MutationObserver 记录；读取已缓存的开关，避免在
    // 每个热路径事件上再次进入设置层。设置变更仍通过 Store 的一次通知同步。
    const unsubscribeLogSetting = Store.onChange(() => {
      const next = Store.getSetting('logEnabled') !== false;
      if (!next && loggingEnabled) {
        passiveBuckets.clear();
        if (passiveFlushTimer) { clearTimeout(passiveFlushTimer); passiveFlushTimer = 0; }
      }
      loggingEnabled = next;
    });

    function localDay(timestamp) {
      const date = new Date(Number(timestamp) || Date.now());
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')); }

    function platformForLocation() {
      const host = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
      if (/(^|\.)bilibili\.com$/.test(host)) return 'bili';
      if (/(^|\.)douyin\.com$/.test(host)) return 'douyin';
      if (/(^|\.)weibo\.(com|cn)$/.test(host)) return 'weibo';
      if (/(^|\.)zhihu\.com$/.test(host)) return 'zhihu';
      if (host === 'tieba.baidu.com') return 'tieba';
      if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) return 'x';
      return 'unknown';
    }

    function routeForLocation() {
      const path = String((typeof location !== 'undefined' && location.pathname) || '');
      if (/^\/video\//i.test(path)) return 'video';
      if (/^\/opus\//i.test(path)) return 'opus';
      if (/^\/user\//i.test(path)) return 'profile';
      if (/^\/u\//i.test(path) || /^\/n\//i.test(path)) return 'profile';
      if (/^\/search(?:\/|$)/i.test(path)) return 'search';
      if (/^\/question\//i.test(path)) return 'question';
      if (/^\/p\//i.test(path)) return 'post';
      if (/^\/home(?:\/|$)/i.test(path) || path === '/') return 'home';
      return 'other';
    }

    function cleanType(type) {
      const value = String(type == null ? '' : type).trim().toLowerCase();
      return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value) ? value : 'unknown';
    }

    function cleanString(value) {
      return String(value == null ? '' : value)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_STRING_LENGTH);
    }

    function scrub(value, field, depth) {
      const key = String(field || '');
      if (SENSITIVE_FIELD.test(normalizedFieldName(key))) return '[redacted]';
      if (value == null || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string') return cleanString(value);
      if (depth >= MAX_VALUE_DEPTH) return '[depth-limited]';
      if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrub(item, '', depth + 1));
      if (typeof value === 'object') {
        const out = {};
        Object.keys(value).slice(0, MAX_OBJECT_KEYS).forEach((name) => {
          out[name] = scrub(value[name], name, depth + 1);
        });
        return out;
      }
      return String(typeof value);
    }

    function readValue(key, fallback) {
      try {
        if (typeof GM_getValue !== 'function') return fallback;
        const raw = GM_getValue(key, null);
        if (raw == null || raw === '') return fallback;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (error) { return fallback; }
    }

    function writeSerializedValue(key, serialized) {
      try {
        if (typeof GM_setValue !== 'function') return false;
        GM_setValue(key, serialized);
        metrics.storageWrites++;
        metrics.storageCharsWritten += String(serialized || '').length;
        return true;
      } catch (error) {
        writeErrors++;
        return false;
      }
    }

    function writeValue(key, value) {
      try { return writeSerializedValue(key, JSON.stringify(value)); }
      catch (error) { writeErrors++; return false; }
    }

    function deleteValue(key) {
      try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (error) { writeErrors++; }
    }

    function readIndex() {
      if (indexCache) return indexCache;
      const raw = readValue(INDEX_KEY, null);
      const days = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.days) ? raw.days : []);
      indexCache = {
        format: FORMAT,
        schema: SCHEMA,
        days: Array.from(new Set(days.filter(validDay))).sort().reverse(),
      };
      return indexCache;
    }

    function ensureShard(day) {
      if (shardCache.has(day)) return shardCache.get(day);
      const raw = readValue(DAY_KEY_PREFIX + day, null);
      const events = raw && Array.isArray(raw.events) ? raw.events : (Array.isArray(raw) ? raw : []);
      const shard = { format: FORMAT, schema: SCHEMA, day, events: events.filter((event) => event && typeof event === 'object') };
      shardCache.set(day, shard);
      try { shardCharCache.set(day, JSON.stringify(shard).length); } catch (error) { shardCharCache.set(day, 0); }
      return shard;
    }

    function shardChars(day, shard) {
      if (shardCharCache.has(day)) return shardCharCache.get(day);
      let chars = 0;
      try { chars = JSON.stringify(shard || ensureShard(day)).length; } catch (error) {}
      shardCharCache.set(day, chars);
      return chars;
    }

    function writeShard(day, shard) {
      let serialized;
      try { serialized = JSON.stringify(shard); }
      catch (error) { writeErrors++; return false; }
      if (!writeSerializedValue(DAY_KEY_PREFIX + day, serialized)) return false;
      shardCharCache.set(day, serialized.length);
      return true;
    }

    function notify() {
      listeners.slice().forEach((fn) => { try { fn(); } catch (error) {} });
    }

    function addNumber(target, key, value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      target[key] = (Number(target[key]) || 0) + number;
    }

    function addMaximum(target, key, value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      target[key] = Math.max(Number(target[key]) || 0, number);
    }

    function addCount(target, key, value) {
      const normalized = cleanString(key).slice(0, 80) || 'unknown';
      target[normalized] = (Number(target[normalized]) || 0) + (Number(value) || 0);
    }

    function appendSample(target, value) {
      if (!Array.isArray(target) || target.length >= PASSIVE_SAMPLE_LIMIT || value == null) return;
      const safe = scrub(value, 'sample', 0);
      const fingerprint = JSON.stringify(safe);
      if (target.some((item) => JSON.stringify(item) === fingerprint)) return;
      target.push(safe);
    }

    function mergePassiveBucket(bucket, data, at) {
      const source = data && typeof data === 'object' ? data : {};
      const target = bucket.data;
      bucket.count++;
      bucket.lastAt = at;
      if (bucket.type === 'dom.mutation.batch') {
        addNumber(target, 'recordTotal', source.recordCount);
        addNumber(target, 'addedNodes', source.addedNodes);
        addNumber(target, 'removedNodes', source.removedNodes);
        addNumber(target, 'ownUiOnlyBatches', source.ownUiOnlyBatches);
        for (const [key, value] of Object.entries(source.typeCounts || {})) addCount(target.typeCounts || (target.typeCounts = {}), key, value);
        for (const [key, value] of Object.entries(source.targetTags || {})) addCount(target.targetTags || (target.targetTags = {}), key, value);
        for (const [key, value] of Object.entries(source.attributes || {})) addCount(target.attributes || (target.attributes = {}), key, value);
        for (const sample of Array.isArray(source.samples) ? source.samples : []) appendSample(target.samples || (target.samples = []), sample);
        return;
      }
      if (bucket.type === 'scanner.scan') {
        target.scanCount = bucket.count;
        addNumber(target, 'matchedItems', source.matchedItems);
        addMaximum(target, 'maxMatchedItems', source.matchedItems);
        addNumber(target, 'durationMs', source.durationMs);
        addMaximum(target, 'maxDurationMs', source.durationMs);
        target.lastBlockedContainers = Number(source.blockedContainers) || 0;
        target.lastObservedRoots = Number(source.observedRoots) || 0;
        target.lastQueuedSubtrees = Number(source.queuedSubtrees) || 0;
        addMaximum(target, 'maxQueuedSubtrees', source.queuedSubtrees);
        if (source.selectorCounts && typeof source.selectorCounts === 'object') target.selectorCounts = scrub(source.selectorCounts, 'selectorCounts', 0);
        return;
      }
      if (bucket.type === 'scanner.item') {
        target.itemCount = bucket.count;
        if (source.identified) addNumber(target, 'identified', 1);
        if (source.blocked) addNumber(target, 'blocked', 1);
        if (source.wasBlocked) addNumber(target, 'wasBlocked', 1);
        if (source.handled) addNumber(target, 'handled', 1);
        addCount(target.stageCounts || (target.stageCounts = {}), source.stage || 'unknown', 1);
        addCount(target.sourceCounts || (target.sourceCounts = {}), source.source || 'unknown', 1);
        appendSample(target.samples || (target.samples = []), source);
        return;
      }
      // 预留给后续被动事件：即使新增调用点忘记提供专用聚合器，也只保留少量
      // 安全样本，不把原始高频 payload 无限堆入内存。
      appendSample(target.samples || (target.samples = []), source);
    }

    function schedulePassiveFlush() {
      if (passiveFlushTimer) return;
      passiveFlushTimer = setTimeout(() => {
        passiveFlushTimer = 0;
        flushPassive(false);
      }, PASSIVE_WINDOW_MS);
    }

    function flushPassive(deferFlush) {
      if (passiveFlushTimer) { clearTimeout(passiveFlushTimer); passiveFlushTimer = 0; }
      if (!passiveBuckets.size) return 0;
      const buckets = Array.from(passiveBuckets.values());
      passiveBuckets.clear();
      for (const bucket of buckets) {
        record(bucket.type, {
          aggregated: true,
          windowMs: Math.max(0, bucket.lastAt - bucket.startAt),
          sampleCount: bucket.count,
          ...bucket.data,
        }, {
          skipPassive: true,
          deferFlush: true,
          at: bucket.lastAt,
          platform: bucket.platform,
          route: bucket.route,
        });
      }
      if (!deferFlush && pending.length) scheduleFlush();
      return buckets.length;
    }

    function recordPassive(type, data) {
      if (!loggingEnabled) return '';
      const normalizedType = cleanType(type);
      const at = Date.now();
      const platform = context.platform || platformForLocation();
      const route = context.route || routeForLocation();
      const key = normalizedType + '|' + platform + '|' + route;
      let bucket = passiveBuckets.get(key);
      if (!bucket) {
        bucket = {
          type: normalizedType, platform, route,
          startAt: at, lastAt: at, count: 0, data: {},
        };
        passiveBuckets.set(key, bucket);
      }
      mergePassiveBucket(bucket, data, at);
      schedulePassiveFlush();
      return key;
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = 0; flush(); }, 350);
    }

    function trimAndWriteShard(day, shard) {
      if (shard.events.length > MAX_EVENTS_PER_DAY) {
        // shift() 逐条搬移数组元素，在达到上限时会退化为 O(n²)。一次 slice
        // 丢弃最旧前缀，保留同样的“最近 N 条”语义且只做一次线性复制。
        shard.events = shard.events.slice(-MAX_EVENTS_PER_DAY);
      }
      if (!writeShard(day, shard)) throw new Error('event log storage unavailable');
    }

    function rotate() {
      const index = readIndex();
      index.days = Array.from(new Set(index.days.filter(validDay))).sort().reverse();
      let total = 0;
      for (const day of index.days) total += shardChars(day, ensureShard(day));
      while (index.days.length > RETENTION_DAYS) {
        const oldest = index.days.pop();
        if (!oldest) break;
        const shard = shardCache.get(oldest);
        total -= shard ? shardChars(oldest, shard) : 0;
        deleteValue(DAY_KEY_PREFIX + oldest);
        shardCache.delete(oldest);
        shardCharCache.delete(oldest);
      }
      // 超过总容量时优先从最旧日期的开头裁剪，保留该日最近事件；只有连一条
      // 事件都放不下时才删除整日。这样“事无巨细”不会因为某天事件较多而把
      // 当天全部日志一次性清空。
      while (total > MAX_TOTAL_CHARS && index.days.length) {
        const oldest = index.days[index.days.length - 1];
        const shard = ensureShard(oldest);
        const currentShardChars = shardChars(oldest, shard);
        const otherChars = total - currentShardChars;
        const budget = Math.max(0, MAX_TOTAL_CHARS - otherChars);
        const emptyChars = JSON.stringify({ format: FORMAT, schema: SCHEMA, day: oldest, events: [] }).length;
        let keep = 0;
        if (budget > emptyChars && shard.events.length) {
          let low = 1; let high = shard.events.length;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = { ...shard, events: shard.events.slice(-middle) };
            if (JSON.stringify(candidate).length <= budget) { keep = middle; low = middle + 1; }
            else high = middle - 1;
          }
        }
        if (!keep) {
          index.days.pop();
          deleteValue(DAY_KEY_PREFIX + oldest);
          shardCache.delete(oldest);
          shardCharCache.delete(oldest);
          total = otherChars;
          continue;
        }
        shard.events = shard.events.slice(-keep);
        if (!writeShard(oldest, shard)) throw new Error('event log rotation unavailable');
        total = otherChars + shardChars(oldest, shard);
      }
      if (!writeValue(INDEX_KEY, index)) throw new Error('event log index unavailable');
    }

    function flush() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
      flushPassive(true);
      if (!pending.length) return true;
      const batch = pending.splice(0, pending.length);
      const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const finish = (failed) => {
        const duration = Math.max(0, (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - startedAt);
        metrics.flushes++;
        if (failed) metrics.failedFlushes++;
        metrics.lastFlushDurationMs = duration;
        metrics.maxFlushDurationMs = Math.max(metrics.maxFlushDurationMs, duration);
      };
      try {
        const index = readIndex();
        const grouped = new Map();
        for (const event of batch) {
          const day = validDay(event.day) ? event.day : localDay(event.at);
          if (!grouped.has(day)) grouped.set(day, []);
          grouped.get(day).push(event);
        }
        for (const [day, events] of grouped) {
          const shard = ensureShard(day);
          const existingIds = new Set(shard.events.map((event) => event && event.id).filter(Boolean));
          for (const event of events) {
            if (event && event.id && existingIds.has(event.id)) continue;
            shard.events.push(event);
            if (event && event.id) existingIds.add(event.id);
          }
          if (!index.days.includes(day)) index.days.push(day);
          trimAndWriteShard(day, shard);
        }
        rotate();
        notify();
        finish(false);
        return true;
      } catch (error) {
        writeErrors++;
        pending = batch.concat(pending).slice(-MAX_EVENTS_PER_DAY);
        finish(true);
        return false;
      }
    }

    function setContext(next) {
      const source = next && typeof next === 'object' ? next : {};
      context = {
        platform: cleanString(source.platform || platformForLocation()).slice(0, 24) || 'unknown',
        route: cleanString(source.route || routeForLocation()).slice(0, 32) || 'unknown',
      };
      return { ...context };
    }

    function record(type, data, options) {
      const opts = options && typeof options === 'object' ? options : {};
      if (!opts.force && !loggingEnabled) return '';
      const requestedAt = Number(opts.at);
      const at = Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : Date.now();
      const event = {
        id: sessionId + '_' + (++sequence),
        at,
        day: localDay(at),
        session: sessionId,
        platform: cleanString(opts.platform || context.platform || platformForLocation()).slice(0, 24) || 'unknown',
        route: cleanString(opts.route || context.route || routeForLocation()).slice(0, 32) || 'unknown',
        type: cleanType(type),
        data: scrub(data && typeof data === 'object' ? data : {}, 'data', 0),
      };
      pending.push(event);
      if (!opts.deferFlush) {
        if (opts.immediate || pending.length >= 180) flush();
        else scheduleFlush();
      }
      return event.id;
    }

    function errorCode(error) {
      const name = cleanString(error && error.name || 'Error').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48) || 'Error';
      const message = String(error && error.message || '').toLowerCase();
      if (/403|forbidden/.test(message)) return 'http-403';
      if (/404|not found/.test(message)) return 'http-404';
      if (/timeout|timed out/.test(message)) return 'timeout';
      if (/quota|storage|serialize/.test(message)) return 'storage';
      return name;
    }

    function recordError(phase, error, data, options) {
      const payload = { phase: cleanString(phase || 'unknown').slice(0, 64), errorCode: errorCode(error) };
      if (data && typeof data === 'object') Object.assign(payload, data);
      return record('error', payload, { ...(options || {}), immediate: true });
    }

    function days() {
      flush();
      const current = localDay(Date.now());
      const index = readIndex();
      if (!index.days.includes(current)) index.days.unshift(current);
      index.days = Array.from(new Set(index.days)).sort().reverse();
      return index.days.slice();
    }

    function eventsForDay(day) {
      const target = validDay(day) ? day : localDay(Date.now());
      flush();
      return ensureShard(target).events.map((event) => JSON.parse(JSON.stringify(event)));
    }

    function summary(day) {
      const events = eventsForDay(day);
      const byType = {};
      const byPlatform = {};
      let errors = 0;
      for (const event of events) {
        byType[event.type] = (byType[event.type] || 0) + 1;
        byPlatform[event.platform] = (byPlatform[event.platform] || 0) + 1;
        if (event.type === 'error') errors++;
      }
      return { day: validDay(day) ? day : localDay(Date.now()), events: events.length, errors, byType, byPlatform, pending: pending.length, writeErrors };
    }

    function status() {
      const allDays = days();
      let events = 0; let chars = 0;
      for (const day of allDays) {
        const shard = ensureShard(day);
        events += shard.events.length;
        chars += shardChars(day, shard);
      }
      return {
        days: allDays.length, events, chars, pending: pending.length, writeErrors,
        retentionDays: RETENTION_DAYS, maxEventsPerDay: MAX_EVENTS_PER_DAY, maxTotalChars: MAX_TOTAL_CHARS,
        metrics: { ...metrics, cachedShards: shardCache.size },
      };
    }

    function exportJSON(dayList) {
      flush();
      const selected = Array.isArray(dayList) && dayList.length ? dayList.filter(validDay) : days();
      const uniqueDays = Array.from(new Set(selected));
      const payload = {
        format: FORMAT,
        schema: SCHEMA,
        exportedAt: Date.now(),
        runtime: { version: RUNTIME_VERSION, build: RUNTIME_BUILD },
        days: uniqueDays.map((day) => ({
          day,
          events: eventsForDay(day).map((event) => ({
            at: Number(event.at) || 0,
            platform: cleanString(event.platform || 'unknown'),
            route: cleanString(event.route || 'unknown'),
            type: cleanType(event.type),
            data: scrub(event.data || {}, 'data', 0),
          })),
        })),
        status: status(),
      };
      return JSON.stringify(payload, null, 2);
    }

    function diagnosticText(day) {
      const target = validDay(day) ? day : localDay(Date.now());
      const s = summary(target);
      const typeText = Object.keys(s.byType).sort().map((key) => key + '=' + s.byType[key]).join(', ');
      const platformText = Object.keys(s.byPlatform).sort().map((key) => key + '=' + s.byPlatform[key]).join(', ');
      return [
        'OmniBlock 诊断摘要',
        '运行版本：v' + RUNTIME_VERSION,
        '构建：' + RUNTIME_BUILD,
        '日志日期：' + target,
        '事件数：' + s.events + '；错误数：' + s.errors,
        '平台分布：' + (platformText || '无'),
        '事件分布：' + (typeText || '无'),
        '说明：日志只包含 OmniBlock 事件元数据，未包含 Cookie、身份键、正文、完整 URL 或原始 HTML。',
      ].join('\n');
    }

    function clear(day) {
      if (passiveFlushTimer) { clearTimeout(passiveFlushTimer); passiveFlushTimer = 0; }
      passiveBuckets.clear();
      flush();
      const targets = validDay(day) ? [day] : readIndex().days.slice();
      for (const target of targets) {
        deleteValue(DAY_KEY_PREFIX + target);
        shardCache.delete(target);
        shardCharCache.delete(target);
      }
      const index = readIndex();
      index.days = index.days.filter((item) => !targets.includes(item));
      writeValue(INDEX_KEY, index);
      pending = [];
      notify();
    }

    function onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.push(fn);
      return () => { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); };
    }

    setContext();
    RuntimeResources.add(() => {
      try {
        record('lifecycle.stop', { reason: RuntimeResources.status().reason || 'pagehide' }, { force: true, immediate: true });
      } catch (error) {}
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
      if (passiveFlushTimer) { clearTimeout(passiveFlushTimer); passiveFlushTimer = 0; }
      passiveBuckets.clear();
      pending = [];
      listeners.length = 0;
      unsubscribeLogSetting();
    });
    return {
      setContext, record, recordPassive, recordError, flush, days, eventsForDay, summary, status,
      exportJSON, diagnosticText, clear, onChange, isEnabled: () => loggingEnabled,
      format: FORMAT, schema: SCHEMA,
    };
  })();

  EventLog.record('lifecycle.start', { runtime: RUNTIME_VERSION, build: RUNTIME_BUILD }, { immediate: true });
  Store.onPersist((snapshot) => {
    const persons = snapshot && snapshot.persons && typeof snapshot.persons === 'object' ? snapshot.persons : {};
    const identityCount = Object.keys(persons).reduce((total, id) => {
      const person = persons[id];
      return total + (person && Array.isArray(person.identities) ? person.identities.length : 0);
    }, 0);
    EventLog.record('storage.persist', {
      reason: snapshot && snapshot.reason || 'change',
      persons: Object.keys(persons).length,
      identities: identityCount,
    }, { immediate: true });
  });

  // 规则引擎只做纯匹配；它不决定平台身份、不执行存储写入，也不负责弹幕去重。
  // 这样 B站的 PAKKU 可以继续独立处理去重，OmniBlock 只在命中后接入现有屏蔽链。
  const DanmakuRules = (function () {
    const compiledCache = new Map();
    // 规则数组只有在 Store 变更时才会被替换；弹幕热路径不再为每条消息
    // JSON.stringify 一次完整设置，也不再重复编译相同正则。
    Store.onChange(() => compiledCache.clear());
    function settingKey(platform) { return DANMAKU_RULE_SETTING_KEYS[platform] || ''; }
    function rulesFor(platform) {
      const key = settingKey(platform);
      return key ? Store.getSetting(key) || [] : [];
    }
    function signature(platform) {
      return JSON.stringify(rulesFor(platform));
    }
    function compiled(platform) {
      const key = settingKey(platform);
      if (!key) return [];
      const previous = compiledCache.get(platform);
      if (previous) return previous;
      const rules = rulesFor(platform);
      const next = rules.map((rule) => ({ rule, regex: compileDanmakuRule(rule) }));
      compiledCache.set(platform, next);
      return next;
    }
    function match(platform, value) {
      const text = ruleText(value);
      if (!text) return null;
      const lower = text.toLowerCase();
      const hits = [];
      for (const item of compiled(platform)) {
        if (!item.rule.enabled) continue;
        if (item.rule.kind === 'keyword') {
          if (lower.includes(item.rule.pattern.toLowerCase())) hits.push(item.rule);
          continue;
        }
        if (!item.regex) continue;
        item.regex.lastIndex = 0;
        if (item.regex.test(text)) hits.push(item.rule);
      }
      return hits.length ? { text, rules: hits } : null;
    }
    function hasEnabled(platform) { return compiled(platform).some((item) => item.rule.enabled); }
    function add(platform, kind, pattern) {
      const key = settingKey(platform);
      if (!key || !DANMAKU_RULE_KINDS.has(kind)) return { ok: false, error: '规则类型不支持' };
      const rule = normalizeDanmakuRule({ kind, pattern });
      if (!rule) return { ok: false, error: kind === 'regex' ? '正则表达式无效或为空' : '关键词不能为空' };
      const rules = rulesFor(platform);
      if (rules.some((item) => item.id === rule.id)) return { ok: false, error: '这条规则已经存在' };
      if (rules.length >= DANMAKU_RULE_LIMIT) return { ok: false, error: '单个平台最多保存 ' + DANMAKU_RULE_LIMIT + ' 条规则' };
      Store.setSetting(key, rules.concat(rule));
      return { ok: true, rule };
    }
    function remove(platform, id) {
      const key = settingKey(platform);
      if (!key) return false;
      const rules = rulesFor(platform);
      const next = rules.filter((rule) => rule.id !== id);
      if (next.length === rules.length) return false;
      Store.setSetting(key, next);
      return true;
    }
    function setEnabled(platform, id, enabled) {
      const key = settingKey(platform);
      if (!key) return false;
      const rules = rulesFor(platform);
      const next = rules.map((rule) => rule.id === id ? { ...rule, enabled: !!enabled } : rule);
      if (JSON.stringify(next) === JSON.stringify(rules)) return false;
      Store.setSetting(key, next);
      return true;
    }
    return { settingKey, rulesFor, signature, match, hasEnabled, add, remove, setEnabled };
  })();

  // 自动规则例外是独立于屏蔽名单的本地 allowlist：恢复一个误命中的发送者时，
  // 规则仍可继续处理其他人，但不会在下一轮扫描中把这个身份重新写回名单。
  // 例外只接受当前平台的规范化身份键，不接受文案或不可逆的猜测身份。
  const DanmakuExemptions = (function () {
    const cache = new Map();
    // 例外名单在每条弹幕上都会参与判定；把设置读取、身份规范化和 Set
    // 建立集中到 Store 变更边界，避免热路径重复做 O(n) 清洗。
    Store.onChange(() => cache.clear());
    function settingKey(platform) { return DANMAKU_EXEMPTION_SETTING_KEYS[platform] || ''; }
    function stateFor(platform) {
      const key = settingKey(platform);
      if (!key) return { list: [], set: new Set() };
      const previous = cache.get(platform);
      if (previous) return previous;
      const list = sanitizeDanmakuExemptions(Store.getSetting(key), platform);
      const state = { list, set: new Set(list) };
      cache.set(platform, state);
      return state;
    }
    function keysFor(platform) {
      return stateFor(platform).list;
    }
    function normalizeFor(platform, keys) {
      return sanitizeDanmakuExemptions(keys, platform);
    }
    function isExempt(platform, keys) {
      const state = stateFor(platform);
      const prefix = String(platform || '') + ':';
      for (const raw of (Array.isArray(keys) ? keys : [keys])) {
        const normalized = normalizeIdentityKey(raw);
        if (normalized && normalized.startsWith(prefix) && state.set.has(normalized)) return true;
      }
      return false;
    }
    function has(platform, key) {
      const normalized = normalizeIdentityKey(key);
      const prefix = String(platform || '') + ':';
      return !!normalized && normalized.startsWith(prefix) && stateFor(platform).set.has(normalized);
    }
    function add(platform, keys) {
      const key = settingKey(platform);
      const normalized = normalizeFor(platform, keys);
      if (!key || !normalized.length) return { added: [], keys: keysFor(platform) };
      const current = keysFor(platform);
      const next = current.slice();
      const added = [];
      for (const identity of normalized) {
        if (next.includes(identity)) continue;
        next.push(identity); added.push(identity);
      }
      if (added.length) Store.setSetting(key, next);
      return { added, keys: next };
    }
    function remove(platform, keys) {
      const key = settingKey(platform);
      const targets = new Set(normalizeFor(platform, keys));
      if (!key || !targets.size) return { removed: [], keys: keysFor(platform) };
      const current = keysFor(platform);
      const removed = current.filter((identity) => targets.has(identity));
      if (removed.length) Store.setSetting(key, current.filter((identity) => !targets.has(identity)));
      return { removed, keys: current.filter((identity) => !targets.has(identity)) };
    }
    return { settingKey, keysFor, isExempt, has, add, remove };
  })();

  function clearDanmakuExemptionsForManualBlock(keys) {
    const byPlatform = new Map();
    for (const key of normalizeIdentityKeys(keys)) {
      const platform = key.split(':', 1)[0];
      if (!DANMAKU_EXEMPTION_SETTING_KEYS[platform]) continue;
      const list = byPlatform.get(platform) || [];
      list.push(key); byPlatform.set(platform, list);
    }
    for (const [platform, identities] of byPlatform) DanmakuExemptions.remove(platform, identities);
  }

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

    /* 作品级本地屏蔽入口与作用域确认框 */
    .ob-work-block {
      box-sizing: border-box !important; min-height: 22px !important; border: 1px solid #b96b62 !important;
      border-radius: 4px !important; padding: 2px 7px !important; background: #fff !important;
      color: #a93226 !important; font-size: 11px !important; line-height: 18px !important;
      white-space: nowrap !important; cursor: pointer !important; box-shadow: 0 1px 4px rgba(0,0,0,.12) !important;
    }
    .ob-work-block:hover { background: #fdeceb !important; }
    .ob-work-block-portal {
      position: fixed !important; z-index: 2147483645 !important; pointer-events: none !important;
      display: block !important; width: max-content !important; height: max-content !important;
    }
    .ob-work-block-portal > .ob-work-block { pointer-events: auto !important; display: block !important; }
    #ob-work-confirm {
      position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.45); color: #222; font-size: 13px;
    }
    #ob-work-confirm .ob-work-box {
      box-sizing: border-box; width: min(430px, calc(100vw - 28px)); max-height: 86vh; overflow: auto;
      border-radius: 10px; padding: 16px; background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.24);
    }
    #ob-work-confirm .ob-work-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #ob-work-confirm .ob-work-title { margin: 0; font-size: 16px; }
    #ob-work-confirm .ob-work-close { border: 0; background: transparent; color: #999; cursor: pointer; font-size: 18px; }
    #ob-work-confirm .ob-work-status { margin: 8px 0; color: #777; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
    #ob-work-confirm .ob-work-counts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 10px 0; }
    #ob-work-confirm .ob-work-count { min-width: 0; padding: 7px 8px; border: 1px solid #eee; border-radius: 6px; background: #fafafa; color: #555; }
    #ob-work-confirm .ob-work-warning { margin: 8px 0; padding: 8px; border-radius: 6px; background: #fff7e6; color: #8a5b00; line-height: 1.5; }
    #ob-work-confirm .ob-work-row { display: flex; gap: 8px; margin-top: 12px; }
    #ob-work-confirm .ob-work-row button { flex: 1; border: 0; border-radius: 6px; padding: 8px 0; cursor: pointer; font-size: 13px; }
    #ob-work-confirm .ob-work-ok { background: #c0392b; color: #fff; }
    #ob-work-confirm .ob-work-ok:disabled { background: #d8aaa4; cursor: default; }
    #ob-work-confirm .ob-work-no { background: #eee; color: #444; }

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
    #ob-dm-manager .ob-dm-sender.ob-dm-blocked { background: #f7f7f8; }
    #ob-dm-manager .ob-dm-sender.ob-dm-partial { background: #fcfcfc; }
    #ob-dm-manager .ob-dm-content { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-dm-manager .ob-dm-meta { color: #888; font-size: 11px; margin-top: 2px; }
    #ob-dm-manager .ob-dm-blocked .ob-dm-content,
    #ob-dm-manager .ob-dm-blocked .ob-dm-meta { color: #999; }
    #ob-dm-manager .ob-dm-state { color: #999; font-size: 11px; }
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
    #ob-dm-manager .ob-dm-unblock {
      min-width: 68px; height: 32px; border: 1px solid #d5d5d8; border-radius: 4px; padding: 0 7px;
      background: #fff; color: #666; cursor: pointer; font-size: 11px; white-space: nowrap;
    }
    #ob-dm-manager .ob-dm-unblock:hover:not(:disabled) { background: #f1f1f1; color: #333; }
    #ob-dm-manager .ob-dm-unblock:disabled { color: #aaa; cursor: default; }
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
    /* 右下角控制坞：收起时只保留齿轮的一条边，相关入口不占用视频画面；
       display 仍由各自的平台生命周期控制，这里只负责可见性与动效。 */
    #ob-gear,
    #ob-dm-tool,
    #ob-douyin-dm-tool,
    .ob-bulk[data-ob-kind="page"] {
      transition: opacity .18s ease, transform .22s ease, visibility 0s linear 0s;
      will-change: opacity, transform;
    }
    html[data-ob-dock="collapsed"] #ob-gear {
      transform: translateX(32px);
      opacity: .76;
    }
    html[data-ob-dock="expanded"] #ob-gear {
      transform: translateX(0);
      opacity: 1;
    }
    html[data-ob-dock="collapsed"] #ob-dm-tool,
    html[data-ob-dock="collapsed"] #ob-douyin-dm-tool,
    html[data-ob-dock="collapsed"] .ob-bulk[data-ob-kind="page"] {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      transform: translateX(14px);
      transition: opacity .16s ease, transform .2s ease, visibility 0s linear .2s;
    }
    html[data-ob-dock="collapsed"] .ob-bulk[data-ob-kind="page"]:not([data-ob-douyin-toolbar="1"]) {
      transform: translateX(-14px);
    }
    html[data-ob-dock="expanded"] #ob-dm-tool,
    html[data-ob-dock="expanded"] #ob-douyin-dm-tool,
    html[data-ob-dock="expanded"] .ob-bulk[data-ob-kind="page"] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateX(0);
      transition: opacity .18s ease, transform .22s ease, visibility 0s linear 0s;
    }
    @media (prefers-reduced-motion: reduce) {
      #ob-gear, #ob-dm-tool, #ob-douyin-dm-tool, .ob-bulk[data-ob-kind="page"] {
        transition: none !important;
      }
    }
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
    #ob-douyin-dm-manager .ob-dd-row { min-height: 52px; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
    #ob-douyin-dm-manager .ob-dd-row:last-child { border-bottom: 0; }
    #ob-douyin-dm-manager .ob-dd-row.ob-dd-blocked { background: #f7f7f8; }
    #ob-douyin-dm-manager .ob-dd-name { min-width: 0; color: #333; font-weight: 600; overflow-wrap: anywhere; }
    #ob-douyin-dm-manager .ob-dd-note { min-width: 0; margin-top: 3px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ob-douyin-dm-manager .ob-dd-blocked .ob-dd-name,
    #ob-douyin-dm-manager .ob-dd-blocked .ob-dd-note { color: #999; }
    #ob-douyin-dm-manager .ob-dd-actions { display: inline-flex; align-items: center; gap: 2px; }
    #ob-douyin-dm-manager .ob-dd-unblock {
      min-width: 68px; min-height: 32px; border: 1px solid #d5d5d8; border-radius: 4px; padding: 0 7px;
      background: #fff; color: #666; cursor: pointer; font-size: 11px; white-space: nowrap;
    }
    #ob-douyin-dm-manager .ob-dd-unblock:hover { background: #f1f1f1; color: #333; }
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
    #ob-panel .ob-list { box-sizing: border-box; display: flex; align-items: stretch; gap: 8px; min-width: 0; max-width: 100%; max-height: 300px; padding: 1px; overflow-x: auto; overflow-y: hidden; overscroll-behavior: contain; }
    #ob-panel .ob-platform-group { box-sizing: border-box; flex: 0 0 min(240px, 100%); min-width: 0; max-height: 298px; overflow-x: hidden; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; overscroll-behavior: contain; scrollbar-gutter: stable; }
    #ob-panel .ob-platform-title { position: sticky; top: 0; z-index: 1; margin: 0; padding: 7px 10px; background: #f7f7f8; color: #555; font-size: 12px; font-weight: 600; }
    #ob-panel .ob-item { display: flex; justify-content: space-between; gap: 8px; padding: 7px 10px; border-bottom: 1px solid #f2f2f2; align-items: center; }
    #ob-panel .ob-item:last-child { border-bottom: 0; }
    #ob-panel .ob-item .ob-meta { color: #999; font-size: 11px; word-break: break-all; }
    #ob-panel .ob-item .ob-note { color: #777; font-size: 11px; margin-top: 2px; word-break: break-word; }
    #ob-panel .ob-del { color: #c0392b; cursor: pointer; border: 0; background: transparent; font-size: 12px; white-space: nowrap; }
    #ob-panel .ob-close { float: right; cursor: pointer; border: 0; background: transparent; font-size: 18px; color: #999; }
    #ob-panel .ob-log-intro { color: #777; font-size: 12px; line-height: 1.55; margin: 0 0 8px; }
    #ob-panel .ob-log-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    #ob-panel .ob-log-toolbar select { width: auto; min-width: 130px; flex: 0 0 auto; }
    #ob-panel .ob-log-toolbar button { border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px; background: #fff; color: #333; cursor: pointer; white-space: nowrap; }
    #ob-panel .ob-log-toolbar button:hover { background: #f5f5f5; }
    #ob-panel .ob-log-toolbar .ob-log-danger { color: #c0392b; border-color: #e2a39c; }
    #ob-panel .ob-log-status { color: #777; font-size: 11px; line-height: 1.5; margin-top: 6px; word-break: break-word; }
    #ob-panel .ob-log-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 6px; margin-top: 8px; }
    #ob-panel .ob-log-summary-item { min-width: 0; padding: 6px 8px; border: 1px solid #eee; border-radius: 6px; background: #fafafa; color: #555; font-size: 11px; word-break: break-word; }
    #ob-panel .ob-log-events { box-sizing: border-box; max-height: 260px; overflow: auto; margin-top: 8px; padding: 7px 8px; border: 1px solid #eee; border-radius: 6px; background: #1f2024; color: #e8e8e8; font: 11px/1.5 Consolas, 'Courier New', monospace; white-space: pre-wrap; word-break: break-word; }
    #ob-panel .ob-log-events:empty::before { content: '当天还没有日志事件'; color: #999; }
    #ob-panel .ob-auto-intro { color: #777; font-size: 12px; line-height: 1.55; margin: 0 0 8px; }
    #ob-panel .ob-auto-platform { border: 1px solid #eee; border-radius: 8px; padding: 9px 10px; margin-top: 8px; }
    #ob-panel .ob-auto-platform h4 { margin: 0 0 7px; font-size: 13px; color: #444; }
    #ob-panel .ob-auto-add { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #ob-panel .ob-auto-add select { width: 82px; flex: 0 0 82px; }
    #ob-panel .ob-auto-add input { flex: 1 1 220px; min-width: 160px; }
    #ob-panel .ob-auto-add button { border: 0; border-radius: 6px; padding: 6px 10px; background: #c0392b; color: #fff; cursor: pointer; white-space: nowrap; }
    #ob-panel .ob-auto-add button:hover { background: #a93226; }
    #ob-panel .ob-auto-rule-list { display: grid; gap: 4px; margin-top: 8px; }
    #ob-panel .ob-auto-rule { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 6px; background: #f8f8f9; border-radius: 5px; }
    #ob-panel .ob-auto-rule input[type="checkbox"] { flex: 0 0 auto; }
    #ob-panel .ob-auto-rule-kind { flex: 0 0 auto; color: #777; font-size: 11px; }
    #ob-panel .ob-auto-rule-pattern { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; color: #333; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
    #ob-panel .ob-auto-rule-remove { flex: 0 0 auto; border: 0; background: transparent; color: #c0392b; cursor: pointer; font-size: 12px; }
    #ob-panel .ob-auto-exemption-list { display: grid; gap: 4px; margin-top: 8px; }
    #ob-panel .ob-auto-exemption-title { margin-top: 8px; color: #777; font-size: 11px; }
    #ob-panel .ob-auto-exemption { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 6px; background: #f5f5f6; border-radius: 5px; }
    #ob-panel .ob-auto-exemption-key { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; color: #666; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
    #ob-panel .ob-auto-exemption-remove { flex: 0 0 auto; border: 0; background: transparent; color: #555; cursor: pointer; font-size: 12px; }
    #ob-panel .ob-auto-empty, #ob-panel .ob-auto-status { color: #999; font-size: 11px; line-height: 1.5; }
    #ob-panel .ob-auto-empty { padding: 4px 0; }
    #ob-gear {
      position: fixed; right: 14px; bottom: 14px; z-index: 2147483643;
      width: 40px; height: 40px; border: 0; border-radius: 50%; padding: 0;
      background: #2b2b32; color: #fff; font-size: 20px; line-height: 40px;
      text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); user-select: none;
    }
    #ob-gear:hover { background: #41414a; }
  `);

  // 右下角统一控制坞。页面入口的创建/销毁仍由各平台适配器负责，
  // 这里统一管理它们的显示生命周期，避免每个入口各自实现一套 hover 定时器。
  // 模态面板不会被 CSS 隐藏；打开面板时由 hold 保持控制坞展开，直到面板真正关闭。
  const FloatingDock = (() => {
    const CONTROL_SELECTOR = '#ob-gear,#ob-dm-tool,#ob-douyin-dm-tool,.ob-bulk[data-ob-kind="page"]';
    const ACTION_HOLD = 'pointer-action';
    let mounted = false;
    let state = '';
    let collapseTimer = 0;
    let actionTimer = 0;
    const holds = new Set();

    function asElement(node) {
      if (!node) return null;
      if (node.nodeType === 1) return node;
      return node.parentElement || null;
    }

    function isControlTarget(node) {
      const element = asElement(node);
      return !!(element && element.closest && element.closest(CONTROL_SELECTOR));
    }

    function clearCollapseTimer() {
      if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = 0; }
    }

    function setState(next, reason) {
      if (next !== 'collapsed' && next !== 'expanded') return;
      clearCollapseTimer();
      if (state === next) return;
      state = next;
      const root = document.documentElement;
      if (root) root.setAttribute('data-ob-dock', next);
      const gear = document.getElementById('ob-gear');
      if (gear) {
        gear.setAttribute('data-ob-dock-state', next);
      }
      syncControls();
      EventLog.record('ui.floating-dock.state', { state: next, reason: reason || 'unspecified' });
    }

    // 动态创建的页面入口可能在 dock 已经收起后才出现。除了 CSS 状态外，
    // 这里同步两项交互属性，避免平台样式或旧内联样式让透明入口仍可命中。
    function syncControls() {
      const hidden = state === 'collapsed';
      for (const node of document.querySelectorAll(CONTROL_SELECTOR)) {
        if (node.id === 'ob-gear') continue;
        node.style.setProperty('visibility', hidden ? 'hidden' : 'visible', 'important');
        node.style.setProperty('pointer-events', hidden ? 'none' : 'auto', 'important');
      }
    }

    function expand(reason) {
      setState('expanded', reason || 'hover');
    }

    function scheduleCollapse(delay = 1800, reason = 'idle') {
      clearCollapseTimer();
      if (holds.size) return;
      collapseTimer = setTimeout(() => {
        collapseTimer = 0;
        if (!holds.size) setState('collapsed', reason);
      }, Math.max(120, Number(delay) || 1800));
    }

    function hold(token) {
      const value = String(token || 'anonymous');
      holds.add(value);
      expand('hold:' + value);
    }

    function release(token) {
      holds.delete(String(token || 'anonymous'));
      if (!holds.size) scheduleCollapse(450, 'release');
    }

    function holdPointerAction() {
      hold(ACTION_HOLD);
      if (actionTimer) clearTimeout(actionTimer);
      actionTimer = setTimeout(() => { actionTimer = 0; release(ACTION_HOLD); }, 2400);
    }

    function onPointerOver(event) {
      if (isControlTarget(event.target)) expand('pointerover');
    }

    function onPointerOut(event) {
      if (!isControlTarget(event.target) || isControlTarget(event.relatedTarget)) return;
      scheduleCollapse(1800, 'pointerout');
    }

    function onFocusIn(event) {
      if (isControlTarget(event.target)) expand('focusin');
    }

    function onFocusOut(event) {
      if (!isControlTarget(event.target) || isControlTarget(event.relatedTarget)) return;
      scheduleCollapse(1800, 'focusout');
    }

    function mount() {
      if (mounted) return;
      mounted = true;
      const root = document.documentElement;
      if (root) root.setAttribute('data-ob-dock', 'collapsed');
      state = 'collapsed';
      const gear = document.getElementById('ob-gear');
      if (gear) {
        gear.setAttribute('data-ob-dock-state', 'collapsed');
      }
      document.addEventListener('pointerover', onPointerOver, true);
      document.addEventListener('pointerout', onPointerOut, true);
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('pointerdown', (event) => {
        if (isControlTarget(event.target)) holdPointerAction();
      }, true);
      syncControls();
      // 动态创建的页面入口会在任意时间出现；初始折叠状态无需等待其创建。
      EventLog.record('ui.floating-dock.mount', { state: 'collapsed' });
    }

    return { mount, expand, scheduleCollapse, hold, release, isControlTarget, sync: syncControls };
  })();

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
      activeVideoRootCalls: 0,
      activeVideoRootComputations: 0,
      douyinActiveVideoRootInvalidations: 0,
      douyinPlayerIdentityWatches: 0,
      douyinPlayerIdentityMutations: 0,
      douyinPlayerIdentityWatchErrors: 0,
      douyinAutoScans: 0,
      douyinAutoNodesInspected: 0,
      douyinDanmakuCollections: 0,
      douyinDanmakuItems: 0,
      douyinDanmakuCancelledScans: 0,
      scannerFullScans: 0,
      scannerIncrementalScans: 0,
      scannerItemsProcessed: 0,
      scannerDirtyRootsQueued: 0,
      scannerDirtyRootsProcessed: 0,
      scannerDirtyRootBudgetYields: 0,
      scannerDirtyRootOverflows: 0,
      scannerMutationCallbacks: 0,
      scannerMutationRecords: 0,
      scannerMutationDurationMs: 0,
      scannerMutationMaxDurationMs: 0,
      scannerScanDurationMs: 0,
      scannerScanMaxDurationMs: 0,
      scannerDirtyRootDurationMs: 0,
      scannerDirtyRootMaxDurationMs: 0,
      virtualSyncDurationMs: 0,
      virtualSyncMaxDurationMs: 0,
      biliDmPanelScans: 0,
      biliDmFloatingScans: 0,
      biliDmToolRefreshes: 0,
      weiboCommentCollections: 0,
      weiboCommentCacheHits: 0,
      commentManagerCancelledLoads: 0,
      threadCancelledLoads: 0,
      biliDmLastPanelState: null,
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

  function runtimeDiagnostic(key, amount = 1) {
    if (runtimeDiagnostics) runtimeDiagnostics[key] = (runtimeDiagnostics[key] || 0) + amount;
  }

  function runtimeDiagnosticMax(key, value) {
    if (!runtimeDiagnostics || !Number.isFinite(Number(value))) return;
    runtimeDiagnostics[key] = Math.max(Number(runtimeDiagnostics[key]) || 0, Number(value));
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
    const syncStartedAt = runtimeDiagnostics
      ? (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
      : 0;
    virtualDiagnostic('virtualSyncs');
    virtualDiagnostic('virtualSyncRowsVisited', rows.length);
    if (runtimeDiagnostics) {
      const listState = virtualListSyncStates.get(list);
      runtimeDiagnostics.virtualLastBlockedRows = listState ? listState.blockedRows.size : 0;
    }
    const meta = rows.map((candidate, domOrder) => {
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
        domOrder,
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
    // 微博详情页的回收器会复用物理行，快速滚动时 DOM 顺序可能暂时与
    // translateY 的空间顺序不同（例如 16、8、2、3...）。隐藏高度必须按
    // 空间顺序累计；若仍按物理 DOM 顺序补位，就会把某些内容层重复上移，
    // 形成滚轮中的短暂重叠/空白。只对已由真实结构确认的详情列表启用，
    // 并在出现超大/无效基线时保留原有异常修复路径。
    let activeMeta = meta.filter((entry) => !entry.inactive);
    if (isWeiboDetailVirtualList(list)) {
      const hasUnsafePosition = activeMeta.some((entry) => (
        !Number.isFinite(entry.y) || Math.abs(entry.y) > MAX_VIRTUAL_ROW_HEIGHT
      ));
      let previousY = NaN;
      const spatiallyDisordered = !hasUnsafePosition && activeMeta.some((entry) => {
        const currentY = entry.y;
        const disordered = Number.isFinite(previousY) && currentY < previousY;
        if (Number.isFinite(currentY)) previousY = currentY;
        return disordered;
      });
      if (spatiallyDisordered) {
        activeMeta = activeMeta.slice().sort((left, right) => (
          left.y - right.y || left.domOrder - right.domOrder
        ));
      }
    }
    for (const entry of meta) {
      if (entry.inactive) {
        // 保留平台的回收标记和原始 transform；等它重新变为活动行后再补位。
        syncVirtualContentOffset(entry.candidate, 0);
      }
    }
    let shift = 0;
    let previousActive = null;
    for (let i = 0; i < activeMeta.length; i++) {
      const entry = activeMeta[i];

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
    if (runtimeDiagnostics) {
      const duration = Math.max(0, (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - syncStartedAt);
      runtimeDiagnostic('virtualSyncDurationMs', duration);
      runtimeDiagnosticMax('virtualSyncMaxDurationMs', duration);
    }
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
    // 当前运行时在 markBlocked() 时登记所有容器；关闭总开关时只清理这份集合，
    // 不再为了寻找旧标记而重新深遍历整页。运行时守卫已禁止同一文档重复初始化，
    // 因此不会有另一个 OmniBlock 实例留下的可执行状态需要兜底接管。
    for (const container of Array.from(blockedContainers)) unmark(container);
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
    // 平台可在通用身份处理前声明“这个节点已经由平台专用逻辑处理”。
    // 目前只有抖音自动弹幕规则使用它：无可靠身份的命中弹幕仍可即时隐藏，
    // 但不会伪造一个身份键；下一轮通用扫描也不能把它错误恢复。
    try {
      if (adapter.beforeHandle && adapter.beforeHandle(item) === true) {
        EventLog.recordPassive('scanner.item', { stage: 'before-handle', adapter: adapter.id, itemTag: item && item.tagName, handled: true });
        return;
      }
    } catch (e) { EventLog.recordError('scanner.before-handle', e, { adapter: adapter.id, itemTag: item && item.tagName }); }
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
    const blocked = Index.isBlocked(info.keys);
    if (blocked) {
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
    EventLog.recordPassive('scanner.item', {
      stage: 'handle', adapter: adapter.id, itemTag: item && item.tagName,
      containerTag: container && container.tagName, identified: !!(info && info.keys && info.keys.length),
      blocked, wasBlocked,
      source: info && info.source || 'dom',
    });
  }

  // ====================================================================
  // 3. 扫描器：MutationObserver + rAF 批处理 + 节流
  // ====================================================================
  function createScanner(adapter) {
    let scheduled = false;
    let frame = 0;
    let stopped = false;
    const observedRoots = new Set();
    const selectorList = Array.isArray(adapter.selectors) ? adapter.selectors.slice() : [];
    let fullScanRequested = true;
    let shadowDiscoveryRequested = false;
    let observerPaused = false;
    const dirtyItems = new Set();
    const dirtySubtrees = new Set();
    const MAX_DIRTY_SUBTREES = 128;
    const DIRTY_SUBTREE_ROOT_BUDGET = 32;
    const DIRTY_SUBTREE_TIME_BUDGET_MS = 8;
    let routeLoop = null;
    let rootReadyHandler = null;
    let unsubscribeStore = () => {};
    let unsubscribeLifecycle = () => {};
    let unregisterRuntime = () => {};
    const observerOptions = { childList: true, attributes: true, attributeFilter: [
      'href', 'data-e2e', 'data-e2e-vid', 'data-mid', 'data-uid', 'uid',
      'data-user-id', 'data-user-card', 'data-usercard', 'data-usercard-mid', 'usercard', 'nick-name',
      'data-field', 'data-sec-uid', 'data-secuid', 'data-danmaku-user-id', 'data-danmu-user-id',
      'data-mid-hash', 'data-mid_hash', 'data-dm-hash', 'data-danmaku-hash',
      'comment_id', 'comment-id', 'data-comment-id', 'action-type',
    ], subtree: true };
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
    function matchesSelector(node) {
      if (!node || node.nodeType !== 1 || !node.matches) return false;
      for (const selector of selectorList) {
        try { if (node.matches(selector)) return true; } catch (e) {}
      }
      return false;
    }
    function composedParent(node) {
      if (!node) return null;
      if (node.parentElement) return node.parentElement;
      const root = node.getRootNode && node.getRootNode();
      return root && root.host ? root.host : null;
    }
    function addDirtyAncestors(node) {
      let current = node;
      if (current && current.nodeType !== 1) current = current.host || current.parentElement || null;
      for (let guard = 0; current && guard < 32; guard++, current = composedParent(current)) {
        if (matchesSelector(current)) dirtyItems.add(current);
      }
    }
    function addDirtySubtree(root) {
      if (!root || !selectorList.length) return;
      // 同一次遍历同时发现新增 ShadowRoot 并收集匹配条目；避免先由
      // discoverShadowRoots() 扫一遍、再由 querySelectorAllDeepMany() 扫第二遍。
      const buckets = querySelectorAllDeepMany(root, selectorList, (shadowRoot) => observeRoot(shadowRoot, false));
      for (const bucket of buckets) for (const item of bucket) dirtyItems.add(item);
    }
    function queueDirtySubtree(root) {
      let candidate = root;
      if (candidate && candidate.nodeType !== 1 && candidate.nodeType !== 11) {
        candidate = candidate.parentElement || candidate.host || null;
      }
      if (!candidate || isOwnUiNode(candidate)) return;
      // 同一批次常同时上报父节点和多个子节点。保留最外层根即可，避免下一帧
      // 对同一棵抖音播放器/评论树重复深遍历。
      if (dirtySubtrees.has(candidate)) return;
      let ancestor = composedParent(candidate);
      for (let guard = 0; ancestor && guard < 32; guard++, ancestor = composedParent(ancestor)) {
        if (dirtySubtrees.has(ancestor)) return;
      }
      dirtySubtrees.add(candidate);
      runtimeDiagnostic('scannerDirtyRootsQueued');
      if (dirtySubtrees.size > MAX_DIRTY_SUBTREES) {
        dirtySubtrees.clear();
        fullScanRequested = true;
        runtimeDiagnostic('scannerDirtyRootOverflows');
      }
    }
    function processDirtySubtrees() {
      const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
      const started = now();
      let processed = 0;
      while (dirtySubtrees.size && processed < DIRTY_SUBTREE_ROOT_BUDGET
        && now() - started < DIRTY_SUBTREE_TIME_BUDGET_MS) {
        const root = dirtySubtrees.values().next().value;
        dirtySubtrees.delete(root);
        if (!root || (root.nodeType === 1 && !root.isConnected)) continue;
        addDirtySubtree(root);
        processed++;
      }
      runtimeDiagnostic('scannerDirtyRootsProcessed', processed);
      const duration = Math.max(0, now() - started);
      runtimeDiagnostic('scannerDirtyRootDurationMs', duration);
      runtimeDiagnosticMax('scannerDirtyRootMaxDurationMs', duration);
      if (dirtySubtrees.size) runtimeDiagnostic('scannerDirtyRootBudgetYields');
      return dirtySubtrees.size;
    }
    function noteMutationDuration(startedAt, recordCount) {
      if (!runtimeDiagnostics) return;
      const duration = Math.max(0, (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - startedAt);
      runtimeDiagnostic('scannerMutationCallbacks');
      runtimeDiagnostic('scannerMutationRecords', recordCount);
      runtimeDiagnostic('scannerMutationDurationMs', duration);
      runtimeDiagnosticMax('scannerMutationMaxDurationMs', duration);
    }
    const mo = new MutationObserver((records) => {
      const mutationStartedAt = runtimeDiagnostics
        ? (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
        : 0;
      // 后台标签页不需要消费平台的高频 DOM 变化。保留一次全量扫描请求，
      // 页面恢复时再发现新增 ShadowRoot 并按正常入口同步，避免后台继续做
      // 深树遍历和向各模块广播。
      if (!PageLifecycle.isVisible()) {
        fullScanRequested = true;
        shadowDiscoveryRequested = true;
        dirtyItems.clear();
        dirtySubtrees.clear();
        noteMutationDuration(mutationStartedAt, records.length);
        return;
      }
      PageMutationSignals.notify(records, adapter.id);
      const mutationSummary = EventLog.isEnabled() ? {
        recordCount: records.length,
        addedNodes: 0,
        removedNodes: 0,
        ownUiOnlyBatches: 0,
        typeCounts: {},
        targetTags: {},
        attributes: {},
        samples: [],
      } : null;
      let shouldSchedule = false;
      for (const record of records) {
        const ownUiOnly = isOwnUiOnlyChildList(record);
        if (mutationSummary) {
          const type = String(record.type || 'unknown');
          const targetTag = record.target && record.target.tagName
            || (record.target && record.target.nodeType === 11 ? 'shadow-root' : 'unknown');
          const added = record.addedNodes ? record.addedNodes.length : 0;
          const removed = record.removedNodes ? record.removedNodes.length : 0;
          mutationSummary.typeCounts[type] = (mutationSummary.typeCounts[type] || 0) + 1;
          mutationSummary.targetTags[targetTag] = (mutationSummary.targetTags[targetTag] || 0) + 1;
          mutationSummary.addedNodes += added;
          mutationSummary.removedNodes += removed;
          if (ownUiOnly) mutationSummary.ownUiOnlyBatches++;
          if (record.attributeName) mutationSummary.attributes[record.attributeName] = (mutationSummary.attributes[record.attributeName] || 0) + 1;
          if (mutationSummary.samples.length < 6) mutationSummary.samples.push({
            type, targetTag, attribute: record.attributeName || '', added, removed, ownUiOnly,
          });
        }
        if (ownUiOnly) {
          virtualDiagnostic('scannerOwnUiIgnored');
          continue;
        }
        if (record.type === 'childList') {
          addDirtyAncestors(record.target);
          for (const node of record.addedNodes || []) queueDirtySubtree(node);
          shouldSchedule = true;
        } else if (record.type === 'attributes' && record.attributeName !== 'style') {
          // 属性常写在作者链接或评论内部节点上；向 composed ancestor 追溯即可
          // 找到对应条目，不再为了一个属性变化整页重扫。
          addDirtyAncestors(record.target);
          shouldSchedule = true;
        }
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
      if (mutationSummary) EventLog.recordPassive('dom.mutation.batch', mutationSummary);
      if (shouldSchedule) schedule();
      noteMutationDuration(mutationStartedAt, records.length);
    });

    function observeRoot(root, discover = true) {
      if (!root || observedRoots.has(root)) return;
      try {
        mo.observe(root, observerOptions);
      } catch (e) { return; }
      observedRoots.add(root);
      if (discover) discoverShadowRoots(root);
    }

    function pauseObserver() {
      if (observerPaused) return;
      observerPaused = true;
      // 隐藏标签页不需要继续接收平台变化；保留 observedRoots，恢复时可以
      // 重新挂载，而不是重新猜测此前已经发现过的 ShadowRoot。
      mo.disconnect();
    }

    function resumeObserver() {
      if (!observerPaused) return;
      observerPaused = false;
      mo.disconnect();
      for (const root of Array.from(observedRoots)) {
        if (root.host && !root.host.isConnected) {
          observedRoots.delete(root);
          continue;
        }
        try { mo.observe(root, observerOptions); }
        catch (e) { observedRoots.delete(root); }
      }
      if (document.documentElement && !observedRoots.has(document.documentElement)) {
        observeRoot(document.documentElement);
      }
    }

    function discoverShadowRoots(root) {
      if (!root) return;
      if (!PageLifecycle.isVisible()) { shadowDiscoveryRequested = true; return; }
      if (root.nodeType === 1 && root.shadowRoot) observeRoot(root.shadowRoot, false);
      if (!root.querySelectorAll) return;
      for (const node of root.querySelectorAll('*')) if (node.shadowRoot) observeRoot(node.shadowRoot, false);
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
      if (stopped) return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (!PageLifecycle.isVisible()) {
        scheduled = false;
        fullScanRequested = true;
        shadowDiscoveryRequested = true;
        dirtyItems.clear();
        dirtySubtrees.clear();
        return;
      }
      scheduled = false;
      const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const finishScanDuration = () => {
        const duration = Math.max(0, (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - startedAt);
        runtimeDiagnostic('scannerScanDurationMs', duration);
        runtimeDiagnosticMax('scannerScanMaxDurationMs', duration);
        return duration;
      };
      if (shadowDiscoveryRequested) {
        shadowDiscoveryRequested = false;
        discoverShadowRoots(document.documentElement);
      }
      pruneBlockedContainers();
      pruneObservedRoots();
      const fullScan = fullScanRequested;
      fullScanRequested = false;
      if (!Store.getSetting('enabled')) {
        dirtyItems.clear();
        dirtySubtrees.clear();
        clearBlockedContent();
        try { adapter.onDisabled && adapter.onDisabled(); }
        catch (e) { EventLog.recordError('scanner.disabled-hook', e, { adapter: adapter.id }); }
        EventLog.recordPassive('scanner.scan', {
          adapter: adapter.id, enabled: false, matchedItems: 0,
          blockedContainers: blockedContainers.size, observedRoots: observedRoots.size,
          durationMs: finishScanDuration(),
        });
        return;
      }
      if (fullScan) dirtySubtrees.clear();
      else if (processDirtySubtrees()) schedule();
      const pendingItems = Array.from(dirtyItems);
      dirtyItems.clear();
      let matchedItems = 0;
      const selectorCounts = {};
      if (fullScan) {
        runtimeDiagnostic('scannerFullScans');
        const buckets = querySelectorAllDeepMany(document, selectorList);
        const processedItems = new Set();
        for (let index = 0; index < selectorList.length; index++) {
          const sel = selectorList[index];
          const items = buckets[index] || [];
          selectorCounts[sel] = items.length;
          matchedItems += items.length;
          for (const item of items) {
            // 一个 B站元素可能同时匹配“评论”和“动态/视频”兜底选择器。
            // 选择器统计仍保留完整结果，但实际处理每个节点一次，避免重复
            // 读取身份、布局和日志。
            if (processedItems.has(item)) continue;
            processedItems.add(item);
            runtimeDiagnostic('scannerItemsProcessed');
            try { handleItem(adapter, item); }
            catch (e) { EventLog.recordError('scanner.handle-item', e, { adapter: adapter.id, itemTag: item && item.tagName }); }
          }
        }
      } else {
        runtimeDiagnostic('scannerIncrementalScans');
        matchedItems = pendingItems.length;
        for (const selector of selectorList) selectorCounts[selector] = 0;
        for (const item of pendingItems) {
          for (const selector of selectorList) {
            try { if (item && item.matches && item.matches(selector)) selectorCounts[selector]++; } catch (e) {}
          }
          runtimeDiagnostic('scannerItemsProcessed');
          try { handleItem(adapter, item); }
          catch (e) { EventLog.recordError('scanner.handle-item', e, { adapter: adapter.id, itemTag: item && item.tagName }); }
        }
      }
      try {
        adapter.onScan && adapter.onScan({
          full: fullScan,
          items: pendingItems,
          matchedItems,
        });
      }
      catch (e) { EventLog.recordError('scanner.scan-hook', e, { adapter: adapter.id }); }
      const durationMs = finishScanDuration();
      EventLog.recordPassive('scanner.scan', {
        adapter: adapter.id, enabled: true, matchedItems, selectorCounts,
        blockedContainers: blockedContainers.size, observedRoots: observedRoots.size,
        queuedSubtrees: dirtySubtrees.size,
        durationMs,
      });
    }
    function schedule(forceFull = false) {
      if (stopped) return;
      if (forceFull) fullScanRequested = true;
      if (!PageLifecycle.isVisible()) {
        fullScanRequested = true;
        shadowDiscoveryRequested = true;
        return;
      }
      if (scheduled) return;
      scheduled = true;
      frame = requestAnimationFrame(scanOnce);
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      scheduled = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      mo.disconnect();
      observedRoots.clear();
      dirtyItems.clear();
      dirtySubtrees.clear();
      if (rootReadyHandler) {
        document.removeEventListener('DOMContentLoaded', rootReadyHandler);
        rootReadyHandler = null;
      }
      if (routeLoop) routeLoop.stop();
      unsubscribeStore();
      unsubscribeLifecycle();
      unregisterRuntime();
      try { if (adapter && typeof adapter.dispose === 'function') adapter.dispose(); } catch (e) {}
    }
    function status() {
      return {
        stopped,
        scheduled,
        observedRoots: observedRoots.size,
        dirtyItems: dirtyItems.size,
        dirtySubtrees: dirtySubtrees.size,
      };
    }
    // 初始扫描 + 监听
    schedule();
    if (document.documentElement) observeRoot(document.documentElement);
    else {
      rootReadyHandler = () => {
        rootReadyHandler = null;
        if (!stopped) observeRoot(document.documentElement);
      };
      document.addEventListener('DOMContentLoaded', rootReadyHandler, { once: true });
    }
    unsubscribeStore = Store.onChange(() => { fullScanRequested = true; schedule(); });
    unsubscribeLifecycle = PageLifecycle.subscribe((visible) => {
      if (!visible) {
        fullScanRequested = true;
        shadowDiscoveryRequested = true;
        dirtyItems.clear();
        dirtySubtrees.clear();
        scheduled = false;
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        pauseObserver();
        return;
      }
      resumeObserver();
      shadowDiscoveryRequested = true;
      schedule(true);
    });
    // SPA 路由切换：重新全扫
    let lastUrl = location.href;
    routeLoop = createPageLoop(() => {
      if (location.href !== lastUrl) {
        const previousUrl = lastUrl;
        lastUrl = location.href;
        EventLog.setContext();
        EventLog.record('navigation.change', { source: 'spa' }, { immediate: true });
        PageRouteSignals.notify(lastUrl, previousUrl);
        schedule(true);
      }
    }, 1000);
    unregisterRuntime = RuntimeResources.add(stop);
    routeLoop.wake();
    return { schedule, scanOnce, stop, status };
  }

  // ====================================================================
  // 4. 拉黑入口 UI（平台右键/快捷入口 + 确认气泡 + 撤销 toast）
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

  // 微博自身在楼中楼关闭后会把焦点重新放回评论 textarea；如果随后用户按
  // ArrowUp/ArrowDown，按键会被输入框当作光标移动而不是页面滚动。插件弹窗
  // 收尾时只在微博页面把焦点交还给 body，且仅处理本次收尾前已经存在的焦点，
  // 不抢走用户在延迟窗口内主动点击的新输入控件。
  let pageFocusRequest = 0;
  function focusPageAfterOmniBlock(reason) {
    if (!/(^|\.)weibo\.(com|cn)$/.test(location.hostname) && location.hostname !== 'm.weibo.cn') return;
    const request = ++pageFocusRequest;
    const before = document.activeElement;
    const focus = () => {
      if (request !== pageFocusRequest) return;
      if (document.querySelector('#ob-work-confirm,#ob-confirm')) return;
      const current = document.activeElement;
      const currentIsBefore = current === before;
      const disconnected = !!current && current !== document.body && current !== document.documentElement
        && current.isConnected === false;
      const pluginControl = !!(current && current.closest
        && current.closest('#ob-work-confirm,#ob-confirm'));
      const editable = !!(current && (current.isContentEditable
        || current.tagName === 'INPUT' || current.tagName === 'TEXTAREA'));
      // 用户已经在延迟窗口内主动聚焦其它输入控件时，不再替换其焦点。
      if (current && !editable && !currentIsBefore && !disconnected && !pluginControl
        && current !== document.body && current !== document.documentElement) return;
      if (current && current !== document.body && current !== document.documentElement
        && current.blur && (currentIsBefore || disconnected || pluginControl || editable)) {
        try { current.blur(); } catch (error) {}
      }
      const target = document.body || document.documentElement;
      if (!target || !target.focus) return;
      const hadTabIndex = target.hasAttribute('tabindex');
      const previousTabIndex = target.getAttribute('tabindex');
      if (!hadTabIndex) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (error) { try { target.focus(); } catch (ignored) {} }
      if (!hadTabIndex) target.removeAttribute('tabindex');
      else if (previousTabIndex == null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', previousTabIndex);
    };
    focus();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    setTimeout(focus, 80);
  }

  function showConfirm(label, keys, anchorEl, onBlocked, commit, note, toastLabel) {
    const normalizedKeys = normalizeIdentityKeys(keys);
    if (!normalizedKeys.length) { EventLog.record('ui.confirm.rejected', { reasonCode: 'no-reliable-identity' }, { immediate: true }); showToast('无法识别可靠身份'); return; }
    EventLog.record('ui.confirm.open', { action: 'block', keyCount: normalizedKeys.length, hasLabel: !!label }, { immediate: true });
    FloatingDock.hold('confirm');
    let box = $('#ob-confirm');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ob-confirm';
    box.innerHTML = `<div class="ob-title">确认拉黑？</div><div class="ob-sub"></div><div class="ob-row"><button class="ob-no">取消</button><button class="ob-ok">拉黑</button></div>`;
    const sub = (label || '该用户') + '\n' + (normalizedKeys.length > 5 ? normalizedKeys.slice(0, 5).join('  ') + ' …(共' + normalizedKeys.length + '项)' : normalizedKeys.join('  '));
    box.querySelector('.ob-sub').textContent = sub;
    box.querySelector('.ob-no').onclick = () => {
      EventLog.record('ui.confirm.cancel', { action: 'block' }, { immediate: true });
      box.remove(); FloatingDock.release('confirm'); focusPageAfterOmniBlock('confirm-cancel');
    };
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
          clearDanmakuExemptionsForManualBlock(normalizedKeys);
          const result = Store.addIdentities(normalizedKeys, label, note || reasonFromAnchor(anchorEl));
          transaction = {
            result,
            undo: result.addedKeys.length ? () => {
              EventLog.record('action.manual.undo', { keyCount: result.addedKeys.length }, { immediate: true });
              Store.removeIdentities(result.addedKeys);
            } : null,
          };
        }
      } catch (e) {
        EventLog.recordError('ui.confirm.commit', e);
        box.remove(); FloatingDock.release('confirm'); focusPageAfterOmniBlock('confirm-error'); showToast('拉黑失败：' + (e && e.message || e)); return;
      }
      box.remove();
      FloatingDock.release('confirm');
      focusPageAfterOmniBlock('confirm-commit');
      EventLog.record('ui.confirm.commit', {
        action: 'block', keyCount: normalizedKeys.length,
        added: transaction && transaction.result ? Number(transaction.result.added) || 0 : 0,
      }, { immediate: true });
      try { if (onBlocked) onBlocked(transaction && transaction.result); } catch (e) {}
      const persisted = !(transaction && transaction.result && transaction.result.persisted === false);
      showToast(persisted
        ? `已拉黑：${toastLabel || label || normalizedKeys[0]}`
        : `已在本页生效但未确认落盘：${toastLabel || label || normalizedKeys[0]}（请重试或导出备份）`,
      transaction && transaction.undo || null);
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
    else undoButton.onclick = () => { if (undone) return; undone = true; EventLog.record('action.undo', { available: true }, { immediate: true }); onUndo(); t.remove(); if (currentScanner) currentScanner.schedule(); };
    EventLog.record('ui.toast', { hasUndo: typeof onUndo === 'function' }, { immediate: false });
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 5000);
  }

  let currentScanner = null;
  // B站弹幕运行时在适配器之后初始化；通过这个窄桥把状态面板查询与网络过滤
  // 解耦，避免在适配器对象构造阶段引用尚未定义的局部函数。
  let biliDanmakuAutoStatus = () => ({
    enabled: DanmakuRules.hasEnabled('bili'), ruleCount: DanmakuRules.rulesFor('bili').filter((rule) => rule.enabled).length,
    observedSenders: 0, matchedMessages: 0, matchedHashes: 0, linkedUids: 0, hashOnly: 0, unidentifiable: 0, uidLimit: 0,
  });

  // 右键：若光标在某条目上，弹出自建菜单（不触发平台原生"不感兴趣"）
  document.addEventListener('contextmenu', (e) => {
    if (!Store.getSetting('enabled')) return;
    const adapter = currentAdapter;
    if (!adapter || !adapter.selectors) return;
    // 沿 composedPath 穿透 Shadow DOM 找到命中条目
    const found = findItem(e, adapter);
    if (!found) return;
    e.preventDefault();   // 仅当命中条目时接管右键
    buildContextMenu(e.clientX, e.clientY, found.info, () => showConfirm(found.info.label, found.info.keys, found.el));
  }, true);

  // ====================================================================
  // 5. 各平台适配器
  // ====================================================================
  const Adapters = {};

  // ---------- 抖音 ----------
  Adapters.douyin = (function () {
    const douyinHost = /(^|\.)douyin\.com$/.test(location.hostname);
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

    function currentVideoAuthorInfo() {
      const player = activeVideoRoot() || document.querySelector('.basePlayerContainer, .playerContainer, [data-e2e="video-player"]') || document;
      const link = player.querySelector('[data-e2e="video-avatar"][href*="/user/"]')
        || player.querySelector('a[data-e2e="video-avatar"]')
        || document.querySelector('[data-e2e="video-avatar"][href*="/user/"]');
      const sec = secUidFromHref(attr(link, 'href'));
      const keys = [];
      appendIdentityKey(keys, 'douyin:secuid', sec);
      return { keys, label: textOf(link) || textOf(player.querySelector(SEL.feedAuthorName)), container: player, anchor: link || player, workSection: 'creator' };
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

    function commentScrollTargets(scope = document) {
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
      for (const comment of querySelectorAllDeep(scope || document, SEL.comment)) {
        let current = comment;
        for (let guard = 0; current && guard < 24; guard++) {
          if (current.nodeType === 1) add(current);
          current = composedParent(current);
        }
      }
      const page = scope === document ? document.scrollingElement : null;
      if (!out.length && page && page.scrollHeight > page.clientHeight + 8) out.push(page);
      return out;
    }

    // 抖音评论没有公开、稳定且可安全复用的“全部评论”页面接口；滚动真实列表是唯一不触发
    // 平台写入的通用办法。调用方会在每次滚动后先缓存已识别作者，虚拟行回收后也不会丢失。
    async function loadMoreCommentItems(scope, onProgress) {
      if (typeof scope === 'function') { onProgress = scope; scope = document; }
      scope = scope || document;
      const targets = commentScrollTargets(scope);
      const currentCount = () => querySelectorAllDeep(scope, SEL.comment).length;
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
      const loaded = await loadMoreCommentItems(document, (progress) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'scroll', collected: querySelectorAllDeep(document, SEL.comment).length, ...progress });
      });
      const records = collectCommentRecords(document);
      const reasons = ['抖音没有稳定公开的评论全量接口，仅按当前页面的明确控件和安全滚动读取'];
      if (!loaded.supported) reasons.push('未找到可安全滚动的评论容器');
      if (expansion.remaining || expansion.clicked >= 80) reasons.push('仍有未展开或达到安全上限的回复入口');
      return { records, partial: true, reason: reasons.join('；') };
    }

    async function loadAllWorkComments(candidate, onProgress) {
      const scope = candidate && candidate.scope || document;
      const expansion = await expandAllCommentReplies(scope, (clicked) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'expand', collected: querySelectorAllDeep(scope, SEL.comment).length, clicked });
      });
      const loaded = await loadMoreCommentItems(scope, (progress) => {
        if (typeof onProgress === 'function') onProgress({ phase: 'scroll', collected: querySelectorAllDeep(scope, SEL.comment).length, ...progress });
      });
      const records = collectCommentRecords(scope).map((record) => ({
        ...record,
        workSection: record.level === 'reply' ? 'reply' : 'comment',
      }));
      const reasons = ['抖音没有稳定公开的作品评论全量接口，仅按当前作品页面的明确控件和安全滚动读取'];
      if (!loaded.supported) reasons.push('未找到可安全滚动的当前作品评论容器');
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
    //
    // 这里的选择会递归遍历抖音播放器树，不能在“每条弹幕”路径上重复执行。缓存
    // 持续到路由、播放器结构或媒体播放状态发生变化；这些变化由共享 DOM 信号和
    // media 事件主动失效，因此不会把播放器切换永久缓存成旧节点。
    let activeVideoRootCacheValid = false;
    let activeVideoRootCacheRoot = null;
    let activeVideoRootCacheRoute = '';
    let activeVideoIdentityGeneration = 0;
    let activePlayerIdentityObserver = null;
    const observedActivePlayerRoots = new Set();
    let dyAutoScanRequested = true;
    let feedDirty = true;
    const invalidateActiveVideoRoot = () => {
      runtimeDiagnostic('douyinActiveVideoRootInvalidations');
      activeVideoRootCacheRoot = null;
      activeVideoRootCacheValid = false;
      activeVideoRootCacheRoute = '';
      dyAutoScanRequested = true;
      feedDirty = true;
    };
    function watchActivePlayerIdentity(root) {
      if (!root || root.nodeType !== 1 || typeof MutationObserver !== 'function') return;
      if (!activePlayerIdentityObserver) {
        activePlayerIdentityObserver = new MutationObserver((records) => {
          if (!records || !records.length) return;
          runtimeDiagnostic('douyinPlayerIdentityMutations');
          activeVideoIdentityGeneration++;
          invalidateActiveVideoRoot();
        });
      }
      for (const observed of Array.from(observedActivePlayerRoots)) {
        if (observed.isConnected) continue;
        observedActivePlayerRoots.delete(observed);
        try { activePlayerIdentityObserver.unobserve(observed); } catch (e) {}
      }
      if (observedActivePlayerRoots.has(root)) return;
      try {
        activePlayerIdentityObserver.observe(root, {
          attributes: true,
          attributeFilter: ['class', 'data-e2e', 'data-e2e-vid', 'data-video-id', 'data-item-id'],
        });
        runtimeDiagnostic('douyinPlayerIdentityWatches');
        observedActivePlayerRoots.add(root);
      } catch (e) { runtimeDiagnostic('douyinPlayerIdentityWatchErrors'); }
    }
    function rememberActiveVideoRoot(root) {
      watchActivePlayerIdentity(root);
      activeVideoRootCacheRoot = root || null;
      activeVideoRootCacheValid = true;
      activeVideoRootCacheRoute = location.pathname + location.search;
      return root || null;
    }
    function activeVideoRoot() {
      runtimeDiagnostic('activeVideoRootCalls');
      const route = location.pathname + location.search;
      const marked = $(SEL.feedActive);
      watchActivePlayerIdentity(marked);
      if (activeVideoRootCacheValid && activeVideoRootCacheRoute === route) {
        const cached = activeVideoRootCacheRoot;
        if (!cached || cached === document || cached.isConnected) return cached;
        invalidateActiveVideoRoot();
      } else if (activeVideoRootCacheValid) {
        invalidateActiveVideoRoot();
      }
      runtimeDiagnostic('activeVideoRootComputations');
      const roots = querySelectorAllDeep(document, '.basePlayerContainer, .playerContainer, [data-e2e="video-player"]');
      const hasDanmaku = (root) => !!deepQuery(root, SEL.danmaku);
      if (marked) {
        const markedPlayer = querySelectorAllDeep(marked, '.basePlayerContainer, .playerContainer, [data-e2e="video-player"]')
          .find((root) => {
            const media = deepQuery(root, 'video, audio');
            return !!media && !media.paused && !media.ended && isVisible(root) && hasDanmaku(root);
          });
        if (markedPlayer) return rememberActiveVideoRoot(markedPlayer);
      }
      // 抖音推荐流有时把 feed-active-video 标在一个只负责状态的外层容器上，
      // 实际弹幕层则挂在同级的播放器根节点。必须先选“正在播放且含弹幕”的
      // 根节点，否则外层容器会以视频身份抢先返回，自动规则看不到弹幕。
      const playingWithDanmaku = roots.find((root) => {
        const media = deepQuery(root, 'video, audio');
        return !!media && !media.paused && !media.ended && isVisible(root) && hasDanmaku(root);
      });
      if (playingWithDanmaku) return rememberActiveVideoRoot(playingWithDanmaku);
      const visibleWithDanmaku = roots.find((root) => isVisible(root) && hasDanmaku(root));
      if (visibleWithDanmaku) return rememberActiveVideoRoot(visibleWithDanmaku);
      const playing = roots.find((root) => {
        const media = deepQuery(root, 'video, audio');
        return !!media && !media.paused && !media.ended && isVisible(root);
      });
      if (playing) return rememberActiveVideoRoot(playing);
      // 没有具体播放器根节点时，保留 feed-active 的身份节点作为会话键和后续
      // 节点出现前的兜底；一旦真实弹幕层出现，上面的含弹幕分支会优先接管。
      if (marked && videoIdentityFromRoot(marked)) return rememberActiveVideoRoot(marked);
      const visible = roots.find((root) => isVisible(root));
      return rememberActiveVideoRoot(visible || roots[0] || null);
    }

    function videoIdentityFromRoot(root) {
      if (!root || root.nodeType !== 1) return '';
      for (const name of ['data-e2e-vid', 'data-video-id', 'data-item-id']) {
        const value = normId(attr(root, name));
        if (value) return value;
      }
      const className = typeof root.className === 'string' ? root.className : '';
      const match = className.match(/(?:^|\s)video_([0-9]{6,})(?:\s|$)/);
      return match ? match[1] : '';
    }

    function videoKey(root) {
      const route = location.pathname + location.search;
      // feed-active-video 可能与实际弹幕播放器是两个节点；身份优先从前者取，
      // 扫描根节点则由 activeVideoRoot() 按真实弹幕层选择。
      const marked = $(SEL.feedActive);
      const identity = videoIdentityFromRoot(marked) || videoIdentityFromRoot(root || activeVideoRoot());
      return route + (identity ? '|video:' + identity : '');
    }

    const activePlayerSelector = '.basePlayerContainer, .playerContainer, [data-e2e="video-player"], [data-e2e="feed-active-video"], [data-e2e-vid], [data-video-id], [data-item-id]';
    const activePlayerIdentityAttributes = new Set([
      'class', 'data-e2e', 'data-e2e-vid', 'data-video-id', 'data-item-id',
    ]);
    const mutationElement = (node) => {
      if (!node) return null;
      if (node.nodeType === 1) return node;
      return node.host || node.parentElement || null;
    };
    const matchesActivePlayerRoot = (node) => {
      const element = mutationElement(node);
      if (!element || !element.matches) return false;
      try { return element.matches(activePlayerSelector); } catch (e) { return false; }
    };
    const mutationChangesActivePlayerIdentity = (record) => {
      if (!record) return false;
      const target = mutationElement(record.target);
      if (record.type === 'attributes') {
        return activePlayerIdentityAttributes.has(record.attributeName)
          && (activeVideoRootCacheRoot === target || matchesActivePlayerRoot(target));
      }
      if (record.type !== 'childList') return false;
      return Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []))
        .some((node) => matchesActivePlayerRoot(node) && !!videoIdentityFromRoot(mutationElement(node)));
    };
    // 弹幕节点本身也位于播放器内部。这里只在播放器根/身份属性或根的
    // 直接结构发生变化时失效缓存；普通弹幕逐条插入不能再次触发整棵播放器树
    // 的深遍历。播放状态仍由 media 事件单独失效。
    const mutationChangesActivePlayer = (record) => {
      if (!record) return false;
      const target = mutationElement(record.target);
      if (record.type === 'attributes') {
        if (!activePlayerIdentityAttributes.has(record.attributeName)) return false;
        return activeVideoRootCacheRoot === target || matchesActivePlayerRoot(target);
      }
      if (record.type !== 'childList') return false;
      if (activeVideoRootCacheRoot === target || matchesActivePlayerRoot(target)) return true;
      return Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []))
        .some((node) => matchesActivePlayerRoot(node));
    };
    const mutationTouchesActivePlayer = (records) => (records || []).some(mutationChangesActivePlayer);
    const watchKnownActivePlayerRoots = () => {
      for (const root of querySelectorAllDeep(document, activePlayerSelector)) watchActivePlayerIdentity(root);
    };
    let activePlayerRootTimer = 0;
    let unsubscribeActivePlayerSignals = () => {};
    const handleActiveMediaEvent = (event) => {
      if (event && event.type === 'loadedmetadata') activeVideoIdentityGeneration++;
      invalidateActiveVideoRoot();
    };
    if (douyinHost) {
      unsubscribeActivePlayerSignals = PageMutationSignals.subscribe((records, adapterId) => {
        if (adapterId !== 'douyin') return;
        if ((records || []).some(mutationChangesActivePlayerIdentity)) activeVideoIdentityGeneration++;
        if (mutationTouchesActivePlayer(records)) invalidateActiveVideoRoot();
      });
      document.addEventListener('DOMContentLoaded', watchKnownActivePlayerRoots, { once: true });
      if (document.readyState !== 'loading') activePlayerRootTimer = setTimeout(() => {
        activePlayerRootTimer = 0;
        watchKnownActivePlayerRoots();
      }, 0);
      for (const type of ['play', 'pause', 'ended', 'loadedmetadata']) {
        document.addEventListener(type, handleActiveMediaEvent, true);
      }
    }

    const DY_AUTO_QUEUE_LIMIT = 256;
    const DY_OBSERVED_NODE_LIMIT = 2000;
    const DY_OBSERVED_SENDER_LIMIT = 5000;
    const dyAutoSeenMessages = new Set();
    const dyAutoQueue = new Map();
    const dyAutoBlockedKeys = new Set();
    const dyAutoHiddenNodes = new Set();
    const dyObservedDanmakuNodes = new Set();
    const dyObservedSenders = new Map();
    const dyAutoDisplayStates = new WeakMap();
    let dyAutoFlushTimer = 0;
    let dyAutoVideoKey = '';
    let dyAutoGeneration = 0;
    let dyAutoStatus = { matchedMessages: 0, queuedSenders: 0, persistedSenders: 0, noIdentity: 0 };
    function setDouyinAutoHidden(node, hidden) {
      if (!node || !node.style) return;
      if (hidden) {
        let state = dyAutoDisplayStates.get(node);
        const currentValue = node.style.getPropertyValue('display');
        const currentPriority = node.style.getPropertyPriority('display');
        if (!state) {
          state = { value: currentValue, priority: currentPriority, appliedValue: '', appliedPriority: '' };
          dyAutoDisplayStates.set(node, state);
        } else if (currentValue !== state.appliedValue || currentPriority !== state.appliedPriority) {
          // 播放器回收/复用节点时可能在自动隐藏期间改写 display；把该值视为
          // 新平台基线，不能把旧视频的 display 恢复到新视频上。
          state.value = currentValue;
          state.priority = currentPriority;
        }
        if (currentValue !== 'none' || currentPriority !== 'important') node.style.setProperty('display', 'none', 'important');
        state.appliedValue = node.style.getPropertyValue('display');
        state.appliedPriority = node.style.getPropertyPriority('display');
        node.setAttribute('data-ob-auto-dm-blocked', '1');
        dyAutoHiddenNodes.add(node);
        return;
      }
      const state = dyAutoDisplayStates.get(node);
      if (state) {
        const currentValue = node.style.getPropertyValue('display');
        const currentPriority = node.style.getPropertyPriority('display');
        // 只有当前仍是本脚本最后写入的值时才恢复；平台已经写入的新值必须保留。
        if (currentValue === state.appliedValue && currentPriority === state.appliedPriority) {
          if (state.value) node.style.setProperty('display', state.value, state.priority);
          else node.style.removeProperty('display');
        }
        dyAutoDisplayStates.delete(node);
      }
      node.removeAttribute('data-ob-auto-dm-blocked');
      dyAutoHiddenNodes.delete(node);
    }
    function clearDouyinAutoHidden() {
      for (const node of Array.from(dyAutoHiddenNodes)) setDouyinAutoHidden(node, false);
      dyAutoHiddenNodes.clear();
    }
    function isInActiveDanmakuRoot(item, activeRoot) {
      const root = activeRoot || activeVideoRoot();
      if (!root) return false;
      if (root === document || root === item) return true;
      let current = item;
      for (let guard = 0; current && guard < 32; guard++, current = composedParent(current)) {
        if (current === root) return true;
      }
      return false;
    }
    function resetDyAutoSessionIfNeeded(nextKey) {
      const key = nextKey || videoKey();
      if (!dyAutoVideoKey) {
        dyAutoVideoKey = key;
        dyAutoScanRequested = true;
        return false;
      }
      if (key === dyAutoVideoKey) return false;
      clearDouyinAutoHidden();
      dyAutoVideoKey = key;
      if (dyAutoFlushTimer) clearTimeout(dyAutoFlushTimer);
      dyAutoFlushTimer = 0;
      dyAutoSeenMessages.clear();
      dyAutoQueue.clear();
      dyAutoBlockedKeys.clear();
      dyObservedDanmakuNodes.clear();
      dyObservedSenders.clear();
      dyAutoScanRequested = true;
      dyAutoGeneration++;
      dyAutoStatus = { matchedMessages: 0, queuedSenders: 0, persistedSenders: 0, noIdentity: 0 };
      return true;
    }
    function rememberObservedDanmaku(item, info, content, sessionKey) {
      const keys = normalizeIdentityKeys(info && info.keys);
      if (!keys.length) return;
      const key = sessionKey || videoKey();
      resetDyAutoSessionIfNeeded(key);
      if (item) {
        dyObservedDanmakuNodes.add(item);
        while (dyObservedDanmakuNodes.size > DY_OBSERVED_NODE_LIMIT) {
          const oldest = dyObservedDanmakuNodes.values().next().value;
          if (!oldest) break;
          dyObservedDanmakuNodes.delete(oldest);
        }
      }
      const identity = keys.join('|');
      const text = String(content || '').replace(/\s+/g, ' ').trim();
      const existing = dyObservedSenders.get(identity);
      if (existing) {
        existing.messageCount++;
        if (!existing.label && text) existing.label = text.slice(0, 80);
        if ((!existing.note || existing.note === '当前视频已观察到的弹幕发送者') && text) {
          existing.note = info && info.note || ('抖音弹幕：' + text.slice(0, 360));
        }
        return;
      }
      dyObservedSenders.set(identity, {
        ...(info || {}),
        keys,
        label: text ? text.slice(0, 80) : '抖音弹幕发送者',
        note: info && info.note || (text ? '抖音弹幕：' + text.slice(0, 360) : '当前视频已观察到的弹幕发送者'),
        messageCount: 1,
      });
      while (dyObservedSenders.size > DY_OBSERVED_SENDER_LIMIT) {
        const oldest = dyObservedSenders.keys().next().value;
        if (!oldest) break;
        dyObservedSenders.delete(oldest);
      }
    }
    function autoDouyinRuleNote(content, match) {
      const rules = match && match.rules || [];
      const summary = rules.slice(0, 3).map((rule) => (
        (rule.kind === 'regex' ? '正则' : '关键词') + '「' + String(rule.pattern || '').slice(0, 80) + '」'
      )).join('、') || '当前规则';
      return '抖音弹幕自动屏蔽：' + summary + '；代表弹幕：' + String(content || '').slice(0, 360);
    }
    function danmakuText(item) {
      if (!item) return '';
      const ownButton = item.querySelector && item.querySelector('.ob-dy-dm-block');
      if (!ownButton) return textOf(item).replace(/\s+/g, ' ').trim();
      const parts = [];
      const walk = (node) => {
        if (!node || node === ownButton) return;
        if (node.nodeType === 3) {
          const value = String(node.nodeValue || '').trim();
          if (value) parts.push(value);
          return;
        }
        for (const child of node.childNodes || []) walk(child);
      };
      walk(item);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    function applyDouyinAutoDanmaku(item, info, content, activeRoot, sessionKey) {
      if (!item || !item.matches || !item.matches(SEL.danmaku)) return false;
      // 没有启用抖音自动规则时，不需要为每条弹幕判断当前播放器根节点；这条
      // 快速返回是重要的热路径保护，因为弹幕节点会持续滚动/复用。
      const enabled = Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin');
      if (!enabled) {
        if (item.getAttribute('data-ob-auto-dm-blocked') === '1') setDouyinAutoHidden(item, false);
        return false;
      }
      const root = activeRoot || activeVideoRoot();
      const key = sessionKey || videoKey(root);
      if (!isInActiveDanmakuRoot(item, root)) {
        if (item.getAttribute('data-ob-auto-dm-blocked') === '1') setDouyinAutoHidden(item, false);
        return false;
      }
      resetDyAutoSessionIfNeeded(key);
      const text = content == null ? danmakuText(item) : String(content || '').replace(/\s+/g, ' ').trim();
      const match = DanmakuRules.match('douyin', text);
      if (!match) {
        if (item.getAttribute('data-ob-auto-dm-blocked') === '1') setDouyinAutoHidden(item, false);
        return false;
      }
      if (DanmakuExemptions.isExempt('douyin', info && info.keys)) {
        if (item.getAttribute('data-ob-auto-dm-blocked') === '1') setDouyinAutoHidden(item, false);
        return false;
      }
      queueDouyinAutoDanmaku(info || { keys: [] }, text, key, match);
      setDouyinAutoHidden(item, true);
      return true;
    }
    function flushDouyinAutoQueue() {
      dyAutoFlushTimer = 0;
      if (!Store.getSetting('enabled') || !DanmakuRules.hasEnabled('douyin')) {
        dyAutoQueue.clear();
        dyAutoBlockedKeys.clear();
        return;
      }
      if (!dyAutoQueue.size) return;
      const generation = dyAutoGeneration;
      const batch = Array.from(dyAutoQueue.values());
      dyAutoQueue.clear();
      if (generation !== dyAutoGeneration) return;
      const existing = Store.allIdentities();
      const groups = batch.filter((entry) => entry.keys.some((key) => !existing.has(key))).map((entry) => ({
        keys: entry.keys,
        label: entry.label || '抖音弹幕自动规则',
        note: entry.note,
      }));
      if (!groups.length) return;
      const results = Store.addIdentityGroups(groups);
      dyAutoStatus.persistedSenders += results.filter((result) => result && result.added > 0).length;
    }
    function scheduleDouyinAutoFlush() {
      if (dyAutoFlushTimer || !dyAutoQueue.size) return;
      dyAutoFlushTimer = setTimeout(flushDouyinAutoQueue, 0);
    }
    function queueDouyinAutoDanmaku(info, content, sessionKey, matchedRule = null) {
      if (!Store.getSetting('enabled') || !DanmakuRules.hasEnabled('douyin')) return false;
      resetDyAutoSessionIfNeeded(sessionKey);
      const match = matchedRule || DanmakuRules.match('douyin', content);
      if (!match) return false;
      const keys = normalizeIdentityKeys(info && info.keys);
      if (DanmakuExemptions.isExempt('douyin', keys)) return false;
      const text = String(content || '').replace(/\s+/g, ' ').trim();
      const fingerprint = (keys.length ? keys.join('|') : 'no-key') + '\x1f' + text;
      if (dyAutoSeenMessages.has(fingerprint)) return true;
      if (dyAutoSeenMessages.size >= 20000) dyAutoSeenMessages.delete(dyAutoSeenMessages.values().next().value);
      dyAutoSeenMessages.add(fingerprint);
      dyAutoStatus.matchedMessages++;
      if (!keys.length) {
        dyAutoStatus.noIdentity++;
        return true;
      }
      for (const key of keys) dyAutoBlockedKeys.add(key);
      const key = keys.join('|');
      if (!dyAutoQueue.has(key) && dyAutoQueue.size < DY_AUTO_QUEUE_LIMIT) {
        dyAutoQueue.set(key, {
          keys,
          label: info.label || '抖音弹幕发送者',
          note: autoDouyinRuleNote(text, match),
        });
        dyAutoStatus.queuedSenders++;
      }
      scheduleDouyinAutoFlush();
      return true;
    }
    function scanAutoDanmaku(force = true) {
      if (!Store.getSetting('enabled') || !DanmakuRules.hasEnabled('douyin')) {
        dyAutoScanRequested = false;
        clearDouyinAutoHidden();
        if (dyAutoFlushTimer) clearTimeout(dyAutoFlushTimer);
        dyAutoFlushTimer = 0;
        dyAutoQueue.clear();
        return false;
      }
      if (force !== true && !dyAutoScanRequested) return false;
      dyAutoScanRequested = false;
      runtimeDiagnostic('douyinAutoScans');
      const root = activeVideoRoot();
      const key = videoKey(root);
      resetDyAutoSessionIfNeeded(key);
      if (!root) return false;
      let inspected = 0;
      for (const item of Array.from(dyObservedDanmakuNodes)) {
        if (!item || !item.isConnected || !isInActiveDanmakuRoot(item, root)) {
          dyObservedDanmakuNodes.delete(item);
          continue;
        }
        const info = extractDanmaku(item);
        const text = danmakuText(item);
        rememberObservedDanmaku(item, info, text, key);
        applyDouyinAutoDanmaku(item, info, text, root, key);
        runtimeDiagnostic('douyinAutoNodesInspected');
        inspected++;
      }
      // 首次启动或播放器刚切换时，主扫描器可能尚未处理新根；只在没有任何
      // 当前节点缓存时做一次受控深扫，之后由 beforeHandle/增量扫描持续补充。
      if (!inspected) collectDanmaku(root, { videoKey: key });
      return true;
    }
    function autoDanmakuStatus() {
      resetDyAutoSessionIfNeeded();
      return {
        enabled: Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin'),
        ruleCount: DanmakuRules.rulesFor('douyin').filter((rule) => rule.enabled).length,
        matchedMessages: dyAutoStatus.matchedMessages,
        queuedSenders: dyAutoStatus.queuedSenders,
        persistedSenders: dyAutoStatus.persistedSenders,
        noIdentity: dyAutoStatus.noIdentity,
      };
    }

    function danmakuRoot() {
      return activeVideoRoot() || document;
    }

    function collectDanmaku(root, options) {
      const applyRules = !options || options.applyRules !== false;
      const autoRulesEnabled = applyRules
        && Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin');
      const activeRoot = autoRulesEnabled ? (root || activeVideoRoot()) : null;
      const sessionKey = autoRulesEnabled
        ? ((options && options.videoKey) || videoKey(activeRoot)) : '';
      if (autoRulesEnabled) resetDyAutoSessionIfNeeded(sessionKey);
      runtimeDiagnostic('douyinDanmakuCollections');
      const observedKey = (options && options.videoKey) || videoKey(root || activeVideoRoot());
      for (const item of querySelectorAllDeep(root || document, SEL.danmaku)) {
        runtimeDiagnostic('douyinDanmakuItems');
        if (!item || !item.matches || !item.matches(SEL.danmaku)) continue;
        const info = extractDanmaku(item);
        if (!info) continue;
        const text = danmakuText(item);
        rememberObservedDanmaku(item, info, text, observedKey);
        if (applyRules) applyDouyinAutoDanmaku(item, info, text, activeRoot, sessionKey);
      }
      return Array.from(dyObservedSenders.values());
    }

    function getObservedDanmakuRecords() {
      const root = danmakuRoot();
      const key = videoKey(root);
      resetDyAutoSessionIfNeeded(key);
      if (!dyObservedDanmakuNodes.size && root) collectDanmaku(root, { applyRules: false, videoKey: key });
      return Array.from(dyObservedSenders.values());
    }

    function beforeHandle(item) {
      if (!item || !item.matches || !item.matches(SEL.danmaku)) return false;
      const info = extractDanmaku(item);
      const text = danmakuText(item);
      rememberObservedDanmaku(item, info, text);
      return applyDouyinAutoDanmaku(item, info, text);
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
      dyPointer = null;
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
      document.addEventListener('pointermove', (e) => {
        if (!dyDmHoverItem) return;
        dyPointer = { x: e.clientX, y: e.clientY };
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

    function feedTick(context) {
      const items = context && Array.isArray(context.items) ? context.items : [];
      if (context && !context.full && !feedDirty && !items.some((item) => {
        let current = item && item.nodeType === 1 ? item : null;
        for (let guard = 0; current && guard < 32; guard++, current = composedParent(current)) {
          try {
            if (current.matches && current.matches(SEL.feedActive + ',' + SEL.feedVideo)) return true;
          } catch (e) { return false; }
        }
        return false;
      })) return;
      feedDirty = false;
      // 弹幕规则与弹幕管理器 UI 解耦：即使用户关闭右下角入口，当前播放器中新出现的
      // 节点仍会经过同一份只读收集器；它不会触发时间轴跳转，也不会调用抖音私有接口。
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

    function disableFeed() { cancelPendingSkip(); clearCover(); consecutive = 0; clearDouyinAutoHidden(); }

    let douyinDisposed = false;
    function disposeDouyinAdapter() {
      if (douyinDisposed) return;
      douyinDisposed = true;
      disableFeed();
      if (activePlayerRootTimer) { clearTimeout(activePlayerRootTimer); activePlayerRootTimer = 0; }
      document.removeEventListener('DOMContentLoaded', watchKnownActivePlayerRoots);
      for (const type of ['play', 'pause', 'ended', 'loadedmetadata']) {
        document.removeEventListener(type, handleActiveMediaEvent, true);
      }
      unsubscribeActivePlayerSignals();
      if (activePlayerIdentityObserver) activePlayerIdentityObserver.disconnect();
      observedActivePlayerRoots.clear();
      if (dyAutoFlushTimer) { clearTimeout(dyAutoFlushTimer); dyAutoFlushTimer = 0; }
      dyAutoQueue.clear();
      dyAutoSeenMessages.clear();
      dyAutoBlockedKeys.clear();
      dyObservedDanmakuNodes.clear();
      dyObservedSenders.clear();
      lastCommentMenuContext = null;
    }

    function workCandidates() {
      if (!isVideoPage()) return [];
      const author = currentVideoAuthorInfo();
      if (!author.keys.length) return [];
      return [{
        scope: document,
        anchor: author.anchor || author.container,
        key: 'video|' + videoKey(),
        title: '当前抖音作品',
      }];
    }

    function collectWork(candidate) {
      const scope = candidate && candidate.scope || document;
      const creator = currentVideoAuthorInfo();
      const allCommentNodes = querySelectorAllDeep(scope, SEL.comment);
      const commentRecords = collectCommentRecords(scope).map((record) => ({
        ...record, workSection: record.level === 'reply' ? 'reply' : 'comment',
      }));
      const danmakuRecords = collectDanmaku(danmakuRoot(), { applyRules: false }).map((record) => ({ ...record, workSection: 'danmaku' }));
      return {
        title: candidate && candidate.title || '当前抖音作品',
        creator,
        records: commentRecords.concat(danmakuRecords),
        unknown: Math.max(0, allCommentNodes.length - commentRecords.length),
        partial: true,
        reason: '抖音作品评论和弹幕只能按当前页面已观察到的 DOM、展开控件和安全滚动读取',
      };
    }

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
      videoSessionGeneration: () => activeVideoIdentityGeneration,
      danmakuRoot,
      collectDanmaku,
      getObservedDanmakuRecords,
      scanAutoDanmaku,
      isDanmakuAutoBlocked: (keys) => normalizeIdentityKeys(keys).some((key) => dyAutoBlockedKeys.has(key)
        && !DanmakuExemptions.isExempt('douyin', [key])),
      getAutoDanmakuStatus: autoDanmakuStatus,
      beforeHandle,
      bulkFabLabel: (n) => '🚫 抖音评论屏蔽(' + n + ')',
      commentManager: {
        // available 只判断路由；是否存在可靠评论由调用方的一次 collectRecords()
        // 决定，避免批量入口每次刷新把同一份评论深扫两遍。
        available: () => isVideoPage(),
        collectRecords: () => collectCommentRecords(document),
        loadAll: loadAllCommentRecords,
        loadThread,
        isRootComment,
        // `#relatedVideoCard.LookModalFrameFast` 同时承担评论侧栏和平台 Modal 语义；
        // 它已经由统一管理器接管，不能再被通用 Modal 扫描器插入“拉黑全部”。
        isScope: (root) => !!(root && root !== document && root.id === 'relatedVideoCard'
          && querySelectorAllDeep(root, SEL.comment).length > 0),
      },
      workScope: { list: workCandidates, collect: collectWork, loadAll: loadAllWorkComments },
      rememberMenuContext: rememberCommentMenuContext,
      menuContextInfo,
      extract(item) {
        if (item.matches && item.matches(SEL.comment)) return extractComment(item);
        if (item.matches && item.matches(SEL.profileList)) return extractProfileList(item);
        if (item.matches && item.matches(SEL.danmaku)) return extractDanmaku(item);
        return extractGeneric(item);
      },
      containerOf: (item) => item,
      onScan: feedTick,
      onDisabled: disableFeed,
      dispose: disposeDouyinAdapter,
    };
  })();

  // ---------- 微博 ----------
  Adapters.weibo = (function () {
    const weiboHost = /(^|\.)weibo\.(com|cn)$/.test(location.hostname);
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
    const WEIBO_COMMENT_CACHE_LIMIT = 5000;
    let weiboCommentCacheDirty = true;
    function invalidateWeiboCommentCache() {
      weiboCommentCacheDirty = true;
    }
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
      const scope = root && (root.nodeType || root === document) ? root : document;
      if (scope !== document) return collectWeiboCommentRecordsActive(scope);
      const nextRoute = currentWeiboCommentRouteKey();
      if (weiboCommentRouteKey && nextRoute !== weiboCommentRouteKey) {
        weiboCommentCache.clear();
        invalidateWeiboCommentCache();
      }
      weiboCommentRouteKey = nextRoute;
      if (!weiboCommentCacheDirty) {
        runtimeDiagnostic('weiboCommentCacheHits');
        return Array.from(weiboCommentCache.values());
      }
      runtimeDiagnostic('weiboCommentCollections');
      const active = collectWeiboCommentRecordsActive(scope);
      for (const info of active) {
        const key = weiboCommentCacheKey(info);
        // 文档级缓存只用于后续管理器展示和作者聚合，不需要保留可执行 DOM
        // 引用。虚拟列表回收节点后，缓存中的身份/正文元数据仍可保留，但
        // container/root 必须断开，否则一个长时间打开的页面会延长旧节点寿命。
        weiboCommentCache.set(key, { ...info, container: null, root: null });
      }
      // 虚拟列表需要保留已离开视口的评论，但不能让跨长时间滚动的缓存无限增长。
      // 达到上限时保留较新的观察记录；当前作品级操作本身也有明确的页面范围，
      // 不会把被淘汰的记录伪装成全量结果。
      while (weiboCommentCache.size > WEIBO_COMMENT_CACHE_LIMIT) {
        const oldest = weiboCommentCache.keys().next().value;
        if (!oldest) break;
        weiboCommentCache.delete(oldest);
      }
      weiboCommentCacheDirty = false;
      return Array.from(weiboCommentCache.values());
    }

    function isCommentRoute() {
      const route = location.pathname + location.search + location.hash;
      if (/\/hot\//i.test(location.pathname) || /\/search\//i.test(location.pathname)) return false;
      return /#comment|comment/i.test(route)
        || /^\/u\/\d+/i.test(location.pathname)
        || /^\/\d+\/[A-Za-z0-9_-]+/i.test(location.pathname);
    }

    function weiboCommentScrollTargets(scope = document) {
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
      const root = scope || document;
      for (const item of collectWeiboItems(root, SEL.comment)) {
        let current = item;
        for (let guard = 0; current && guard < 20; guard++, current = current.parentElement) {
          add(current);
          if (root !== document && current === root) break;
        }
      }
      if (!targets.length && root !== document && root.nodeType === 1
        && root.scrollHeight > root.clientHeight + 8) targets.push(root);
      // 2026-09-04 用户授权 Chrome 真站捕获：微博详情页评论使用
      // `.vue-recycle-scroller.page-mode.direction-vertical`，列表本身是
      // `overflow: visible`，实际滚动容器是文档而不是 `#scroller`。只有在
      // 当前作品 scope 内确实存在该 page-mode 列表时，才把文档加入目标，
      // 避免把普通信息流的整页滚动误当成作品评论读取。
      const pageModeList = root !== document
        && querySelectorAllDeep(root, '.vue-recycle-scroller.page-mode.direction-vertical').length > 0;
      if (!targets.length && pageModeList && document.scrollingElement
        && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 8) {
        targets.push(document.scrollingElement);
      }
      if (!targets.length && root === document && document.scrollingElement
        && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 8) targets.push(document.scrollingElement);
      return targets;
    }

    async function loadAllCommentRecords(scope, onProgress, options) {
      if (typeof scope === 'function') { onProgress = scope; scope = document; }
      scope = scope || document;
      const signal = options && options.signal;
      throwIfWeiboWorkAborted(signal);
      const targets = weiboCommentScrollTargets(scope);
      const pageModeList = scope !== document
        && querySelectorAllDeep(scope, '.vue-recycle-scroller.page-mode.direction-vertical').length > 0;
      // 楼中楼弹窗的列表会在滚到底部后异步追加回复；固定的三点采样可能在
      // 请求完成前就关闭弹窗，导致后续回复没有进入作品名单。仅对微博自己的
      // `woo-modal-main` 使用有界的动态到底扫描，普通评论容器仍保留三点采样。
      const asyncReplyModal = scope !== document
        && !!(scope.closest && scope.closest('.woo-modal-main'));
      const original = targets.map((target) => ({ target, top: target.scrollTop, left: target.scrollLeft }));
      // 详情页 page-mode 虚拟列表会回收离开视口的 DOM；作用域不是 document
      // 时，collectWeiboCommentRecords() 不走文档缓存，若只取最后一屏就会把
      // 前面已经观察到的评论丢掉。此次加载只在本次操作内保留规范化快照，
      // 不延长旧 DOM 节点生命周期，也不改变长期评论缓存的上限策略。
      const observed = new Map();
      const remember = (records) => {
        for (const info of records || []) {
          if (!info || !info.keys || !info.keys.length) continue;
          const key = weiboCommentCacheKey(info);
          const snapshot = { ...info, container: null, root: null };
          const previous = observed.get(key);
          if (!previous || (!previous.label && snapshot.label) || (!previous.note && snapshot.note)) {
            observed.set(key, snapshot);
          }
        }
      };
      invalidateWeiboCommentCache();
      remember(collectWeiboCommentRecords(scope));
      let scrolls = 0;
      try {
        const maxPasses = pageModeList ? 4 : 12;
        for (let pass = 0; pass < maxPasses && targets.length; pass++) {
          throwIfWeiboWorkAborted(signal);
          for (const target of targets) {
            throwIfWeiboWorkAborted(signal);
            const isPageModeTarget = pageModeList && target === document.scrollingElement;
            // page-mode 列表不是自己的滚动容器，直接从顶部跳到初始 maxTop
            // 可能只让回收器生成中间一小段行，且后续懒加载会改变 maxTop。
            // 采用一次操作内的有限步进扫描，并在每步重新读取高度，兼顾低配置
            // 机器的开销与作品级读取的覆盖率；普通嵌套容器仍保持原有三点采样。
            const positions = isPageModeTarget || asyncReplyModal ? null : (() => {
              const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
              return [0, Math.round(maxTop / 2), maxTop];
            })();
            let pageModeStep = 0;
            let pageModeStableBottoms = 0;
            let replyModalStableBottoms = 0;
            let previousReplyModalRecords = -1;
            while (isPageModeTarget || asyncReplyModal
              ? pageModeStep < (isPageModeTarget ? 16 : 12)
              : pageModeStep < positions.length) {
              throwIfWeiboWorkAborted(signal);
              const beforeMaxTop = Math.max(0, target.scrollHeight - target.clientHeight);
              const top = isPageModeTarget || asyncReplyModal
                ? (pageModeStep === 0
                  ? 0
                  : Math.min(beforeMaxTop, target.scrollTop + Math.max(560,
                    Math.round((target.clientHeight || window.innerHeight || 900) * 0.8))))
                : positions[pageModeStep];
              target.scrollTop = top;
              try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (error) {}
              // 微博详情页的 `page-mode` 回收器把监听器挂在 window；ScrollEvent
              // 在原生路径上不会像普通事件一样从 HTML 冒泡到 window，因而仅在
              // 文档滚动容器上派发事件时不会驱动虚拟行换页。补发一份窗口级
              // 只读通知，不触碰平台写入控件，也不改变普通嵌套容器路径。
              if (target === document.scrollingElement) {
                try { window.dispatchEvent(new Event('scroll')); } catch (error) {}
              }
              await waitForWeiboWork(isPageModeTarget || asyncReplyModal ? 420 : 220, signal);
              scrolls++;
              invalidateWeiboCommentCache();
              const records = collectWeiboCommentRecords(scope);
              remember(records);
              if (typeof onProgress === 'function') await onProgress({ phase: 'scroll', collected: observed.size, scrolls });
              if (isPageModeTarget) {
                const afterMaxTop = Math.max(0, target.scrollHeight - target.clientHeight);
                const atBottom = target.scrollTop >= afterMaxTop - 2;
                if (atBottom && afterMaxTop <= beforeMaxTop + 8) pageModeStableBottoms++;
                else pageModeStableBottoms = 0;
              }
              if (asyncReplyModal) {
                const afterMaxTop = Math.max(0, target.scrollHeight - target.clientHeight);
                const atBottom = target.scrollTop >= afterMaxTop - 2;
                const recordsStable = records.length === previousReplyModalRecords;
                if (atBottom && afterMaxTop <= beforeMaxTop + 8 && recordsStable) replyModalStableBottoms++;
                else replyModalStableBottoms = 0;
                previousReplyModalRecords = records.length;
              }
              pageModeStep++;
              if (isPageModeTarget && pageModeStableBottoms >= 2) break;
              // 真站楼中楼的最后一页可能在触底后才完成请求；至少保留约
              // 2.5 秒的稳定窗口，避免低配置或慢网络下过早关闭弹窗。
              if (asyncReplyModal && replyModalStableBottoms >= 6) break;
            }
          }
          if (targets.every((target) => target.scrollTop >= Math.max(0, target.scrollHeight - target.clientHeight - 2))) break;
        }
      } finally {
        for (const state of original) { state.target.scrollTop = state.top; state.target.scrollLeft = state.left; }
      }
      invalidateWeiboCommentCache();
      remember(collectWeiboCommentRecords(scope));
      const records = Array.from(observed.values());
      return {
        records,
        partial: true,
        reason: targets.length ? '微博评论只按当前路由内实际观察到的 DOM 读取' : '未找到可安全滚动的评论容器，仅显示已发现评论',
      };
    }

    function weiboReplyExpandControls(root) {
      const out = []; const seen = new Set();
      const textPattern = /^(?:共\s*\d+\s*条回复|查看[^\n]{0,20}回复|展开[^\n]{0,20}回复)$/;
      for (const node of querySelectorAllDeep(root, 'a,button,[role="button"],div,span')) {
        const text = textOf(node).replace(/\s+/g, ' ').trim();
        if (!text || text.length > 80 || !textPattern.test(text)) continue;
        if (node.getAttribute && (node.getAttribute('aria-expanded') === 'true'
          || node.getAttribute('data-expanded') === 'true'
          || node.hasAttribute('disabled'))) continue;
        if (/(?:已展开|收起|没有更多|暂无更多)/.test(text)) continue;
        let control = node;
        if (!(node.matches && node.matches('a,button,[role="button"]'))) {
          // 外层 `.item1/.item2` 的文本也包含作者名和正文；直接取第一个
          // 后代链接会把“共 N 条回复”误点成作者主页。只接受自身文本仍
          // 命中回复模式的交互节点，避免任何平台导航副作用。
          control = Array.from(node.querySelectorAll
            ? node.querySelectorAll('a,button,[role="button"]') : [])
            .find((candidate) => {
              const candidateText = textOf(candidate).replace(/\s+/g, ' ').trim();
              return candidateText && candidateText.length <= 80 && textPattern.test(candidateText);
            }) || null;
        }
        if (!control || seen.has(control) || !isVisible(control)) continue;
        seen.add(control); out.push(control);
      }
      return out;
    }

    function closeWeiboReplyModal(modal) {
      if (!modal || !modal.isConnected) return false;
      // 2026-09-04 用户授权 Chrome 真站捕获：回复弹窗关闭入口为
      // `.woo-modal-main > .wbpro-layer > .wbpro-layer-tit-opt > i.woo-font--cross`。
      // 只关闭本次展开控制新打开的微博回复弹窗，不触碰其它平台弹窗或用户已有界面。
      const close = modal.querySelector('i.woo-font--cross')
        || modal.querySelector('.wbpro-layer-tit-opt');
      if (!close) return false;
      try { close.click(); return true; } catch (error) {
        EventLog.recordError('work.weibo.reply-close', error, { adapter: 'weibo' });
        return false;
      }
    }

    function captureWeiboDocumentScrollState() {
      return {
        htmlStyle: document.documentElement ? document.documentElement.getAttribute('style') : null,
        bodyStyle: document.body ? document.body.getAttribute('style') : null,
      };
    }

    function restoreWeiboDocumentScrollState(state) {
      if (!state || document.querySelector('.woo-modal-main')) return false;
      const restore = (node, value) => {
        if (!node) return;
        if (value == null) node.removeAttribute('style');
        else node.setAttribute('style', value);
      };
      restore(document.documentElement, state.htmlStyle);
      restore(document.body, state.bodyStyle);
      return true;
    }

    async function waitForWeiboReplyModalClosed(modal) {
      if (!modal) return true;
      // 微博关闭楼中楼时可能先做一帧过渡，再把弹窗从详情 wrapper 移除。
      // 作品级滚动统计必须等这个短暂过渡结束，否则会把弹窗内部的
      // `_scroll3` 当成作品评论滚动容器，结果只统计到弹窗当前页。
      for (let attempt = 0; attempt < 12; attempt++) {
        if (!modal.isConnected || !isVisible(modal)) return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return !modal.isConnected || !isVisible(modal);
    }

    async function closeOwnedWeiboReplyModal(modal, restoreState) {
      if (!modal || !modal.isConnected) {
        restoreWeiboDocumentScrollState(restoreState);
        return true;
      }
      closeWeiboReplyModal(modal);
      await waitForWeiboReplyModalClosed(modal);
      // 某些真站版本的关闭动画可能被后续虚拟列表更新打断；这个节点是
      // 本次读取捕获并由插件打开的，超过有界等待仍可见时安全移除它，随后
      // 再恢复打开前的 html/body style，避免取消后页面继续锁滚动。
      if (modal.isConnected && isVisible(modal)) {
        try { modal.remove(); } catch (error) {
          EventLog.recordError('work.weibo.reply-force-close', error, { adapter: 'weibo' });
        }
        await waitForWeiboReplyModalClosed(modal);
      }
      restoreWeiboDocumentScrollState(restoreState);
      return !modal.isConnected || !isVisible(modal);
    }

    function weiboWorkAbortError() {
      const error = new Error('微博作品读取已取消');
      error.name = 'AbortError';
      return error;
    }

    function throwIfWeiboWorkAborted(signal) {
      if (signal && signal.aborted) throw weiboWorkAbortError();
    }

    function waitForWeiboWork(ms, signal) {
      const delay = Math.max(0, Number(ms) || 0);
      if (!signal) return new Promise((resolve) => setTimeout(resolve, delay));
      return new Promise((resolve, reject) => {
        let timer = 0;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        };
        const finish = () => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(weiboWorkAbortError()); };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(finish, delay);
      });
    }

    async function waitForNewWeiboReplyModal(previous, timeoutMs = 1400, signal) {
      throwIfWeiboWorkAborted(signal);
      const find = () => {
        const current = document.querySelector('.woo-modal-main');
        return current && current !== previous ? current : null;
      };
      const immediate = find();
      if (immediate) return immediate;
      const root = document.body || document.documentElement;
      if (!root || typeof MutationObserver !== 'function') {
        await waitForWeiboWork(timeoutMs, signal);
        return find();
      }
      return new Promise((resolve) => {
        let settled = false;
        let timer = 0;
        // 取消时不能立即拆掉观察器：微博可能已经排队了一个稍晚挂载的
        // 楼中楼。保留到有界超时，若弹窗出现就把节点交给调用方 finally
        // 关闭；否则定时器负责结束观察，不留下常驻资源。
        const onAbort = () => {
          const modal = find();
          if (modal) finish(modal);
        };
        const observer = new MutationObserver(() => {
          const modal = find();
          if (modal) finish(modal);
        });
        const finish = (modal) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          observer.disconnect();
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(modal || null);
        };
        if (signal && signal.aborted) { finish(null); return; }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        observer.observe(root, { childList: true, subtree: true });
        timer = setTimeout(() => finish(find()), Math.max(300, Number(timeoutMs) || 1400));
      });
    }

    let cancelLateWeiboModalWatch = null;
    async function closeLateWeiboReplyModals(initialModals, restoreState, waitMs = 1800) {
      if (cancelLateWeiboModalWatch) cancelLateWeiboModalWatch();
      const root = document.body || document.documentElement;
      if (!root || typeof MutationObserver !== 'function') {
        await waitForWeiboWork(waitMs);
        return;
      }
      const known = initialModals || new Set();
      return new Promise((resolve) => {
        let settled = false;
        let timer = 0;
        let pending = Promise.resolve();
        const closeCurrent = () => {
          const current = Array.from(document.querySelectorAll('.woo-modal-main'))
            .filter((modal) => !known.has(modal));
          if (current.length) {
            pending = Promise.all(current.map((modal) => closeOwnedWeiboReplyModal(modal, restoreState)));
          } else {
            restoreWeiboDocumentScrollState(restoreState);
          }
        };
        let cancelWatch = null;
        const finish = async () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          observer.disconnect();
          if (cancelLateWeiboModalWatch === cancelWatch) cancelLateWeiboModalWatch = null;
          closeCurrent();
          await pending;
          restoreWeiboDocumentScrollState(restoreState);
          resolve();
        };
        const observer = new MutationObserver(closeCurrent);
        cancelWatch = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          observer.disconnect();
          if (cancelLateWeiboModalWatch === cancelWatch) cancelLateWeiboModalWatch = null;
          resolve();
        };
        cancelLateWeiboModalWatch = cancelWatch;
        observer.observe(root, { childList: true, subtree: true });
        closeCurrent();
        timer = setTimeout(() => { finish(); }, Math.max(300, Number(waitMs) || 1800));
      });
    }

    function weiboReplyControlKey(control) {
      const root = rootCommentOf(control);
      const info = root ? extract(root) : null;
      // page-mode 会复用控制节点；不要用节点地址作为“已展开”标识。
      // 优先使用楼标识，缺失时用作者、正文和入口文本组成当前楼的稳定快照。
      return [
        info && info.commentId || '',
        info && info.keys && info.keys.join('|') || '',
        info && info.note || '',
        textOf(control),
      ].join('|').replace(/\s+/g, ' ').trim();
    }

    async function expandVisibleWeiboReplyControls(scope, state, onProgress, signal) {
      throwIfWeiboWorkAborted(signal);
      if (!state || state.clicked >= state.limit) {
        if (state) state.limitHit = true;
        return;
      }
      const controls = weiboReplyExpandControls(scope);
      for (const control of controls) {
        throwIfWeiboWorkAborted(signal);
        if (!control || (control.closest && control.closest('.woo-modal-main'))) continue;
        const key = weiboReplyControlKey(control);
        if (!key || state.attempted.has(key)) continue;
        state.discovered.add(key);
        if (state.clicked >= state.limit) {
          state.limitHit = true;
          break;
        }
        state.attempted.add(key);
        state.clicked++;
        const modalBefore = document.querySelector('.woo-modal-main');
        const pageScrollTop = document.scrollingElement && document.scrollingElement.scrollTop;
        // 微博打开楼中楼会把滚动锁写到 html/body 的内联 style；程序化
        // 点击关闭入口后，部分版本只移除弹窗节点而不撤销这组样式。
        // 保存打开前的精确状态，避免作品级读取结束后整页仍无法滚动。
        const documentScrollState = captureWeiboDocumentScrollState();
        let modal = null;
        try {
          try { control.click(); } catch (error) {
            EventLog.recordError('work.weibo.reply-expand', error, { adapter: 'weibo' });
          }
          // 旧实现只轮询 12×50ms；低配置或网络抖动时弹窗晚于 600ms
          // 才挂载，随后会把 html 的滚动锁留在页面上。MutationObserver
          // 先等结构变化，只有无变化时才走有界超时，不增加常驻轮询。
          modal = await waitForNewWeiboReplyModal(modalBefore, 1400, signal);
          throwIfWeiboWorkAborted(signal);
          if (modal) {
            // 弹窗自身也可能是虚拟列表；在关闭前按它自己的滚动容器做一次
            // 有界读取，避免只拿到弹窗首屏的少量回复。
            const loaded = await loadAllCommentRecords(modal, null, { signal });
            const modalRecords = Array.isArray(loaded.records) && loaded.records.length
              ? loaded.records : collectWeiboCommentRecordsActive(modal);
            for (const record of modalRecords) {
              state.records.push({
                ...record,
                container: null,
                root: null,
                workSection: record.level === 'reply' ? 'reply' : 'comment',
              });
            }
          }
        } finally {
          // 无论读取成功、抛错、超时还是用户取消，都必须清理本次展开。
          // 如果弹窗在等待窗口末尾才出现，finally 仍能捕获并关闭它；
          // 作品级 loader 还会在外层再做一次兜底恢复。
          if (modal && modal !== modalBefore) await closeOwnedWeiboReplyModal(modal, documentScrollState);
          else restoreWeiboDocumentScrollState(documentScrollState);
          // 打开/关闭楼中楼会暂时锁定文档滚动，部分真站版本会把 scrollTop
          // 重置为 0。恢复到打开前的位置，才能让外层 page-mode 分段扫描继续
          // 向下推进，而不是在首屏重复读取。
          if (pageScrollTop != null && document.scrollingElement
            && document.scrollingElement.scrollTop !== pageScrollTop) {
            document.scrollingElement.scrollTop = pageScrollTop;
            try { window.dispatchEvent(new Event('scroll')); } catch (error) {}
          }
        }
        if (typeof onProgress === 'function') onProgress({
          phase: 'expand',
          collected: state.records.length,
          clicked: state.clicked,
        });
      }
      if (controls.length && state.clicked >= state.limit) state.limitHit = true;
    }

    async function scanWeiboReplyControls(scope, state, onProgress, signal) {
      throwIfWeiboWorkAborted(signal);
      const targets = weiboCommentScrollTargets(scope);
      const pageModeTarget = targets.find((target) => target === document.scrollingElement);
      if (!pageModeTarget) {
        await expandVisibleWeiboReplyControls(scope, state, onProgress, signal);
        return;
      }
      const originalTop = pageModeTarget.scrollTop;
      let stableBottoms = 0;
      try {
        // 回复入口随 page-mode 虚拟行一起挂载；单独做一次有界入口扫描，
        // 避免在评论快照扫描的回调里开关弹窗，破坏虚拟列表的页码推进。
        for (let step = 0; step < 24 && state.clicked < state.limit; step++) {
          throwIfWeiboWorkAborted(signal);
          const beforeMaxTop = Math.max(0, pageModeTarget.scrollHeight - pageModeTarget.clientHeight);
          const nextTop = step === 0
            ? originalTop
            : Math.min(beforeMaxTop, pageModeTarget.scrollTop + Math.max(560,
              Math.round((pageModeTarget.clientHeight || window.innerHeight || 900) * 0.8)));
          pageModeTarget.scrollTop = nextTop;
          try { pageModeTarget.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (error) {}
          try { window.dispatchEvent(new Event('scroll')); } catch (error) {}
          await waitForWeiboWork(420, signal);
          await expandVisibleWeiboReplyControls(scope, state, onProgress, signal);
          const afterMaxTop = Math.max(0, pageModeTarget.scrollHeight - pageModeTarget.clientHeight);
          const atBottom = pageModeTarget.scrollTop >= afterMaxTop - 2;
          if (atBottom && afterMaxTop <= beforeMaxTop + 8) stableBottoms++;
          else stableBottoms = 0;
          if (atBottom && stableBottoms >= 1) break;
        }
      } finally {
        pageModeTarget.scrollTop = originalTop;
        try { window.dispatchEvent(new Event('scroll')); } catch (error) {}
      }
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
        invalidateWeiboCommentCache();
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

    async function loadAllWorkComments(candidate, onProgress, options) {
      const scope = candidate && candidate.scope || document;
      const signal = options && options.signal;
      throwIfWeiboWorkAborted(signal);
      const documentScrollState = captureWeiboDocumentScrollState();
      const initialModals = new Set(Array.from(document.querySelectorAll('.woo-modal-main')));
      const pageScrollTop = document.scrollingElement && document.scrollingElement.scrollTop;
      const pageScrollLeft = document.scrollingElement && document.scrollingElement.scrollLeft;
      const expansion = {
        limit: 32,
        clicked: 0,
        limitHit: false,
        attempted: new Set(),
        discovered: new Set(),
        records: [],
      };
      try {
        // 先处理首屏入口；评论快照扫描结束后再单独遍历 page-mode 入口。
        // 两个阶段不交错开关弹窗，避免微博回收器在弹窗过渡期间丢失页码。
        await expandVisibleWeiboReplyControls(scope, expansion, onProgress, signal);
        const loaded = await loadAllCommentRecords(scope, (progress) => {
          if (typeof onProgress === 'function') onProgress({
            ...progress,
            collected: Number(progress && progress.collected || 0) + expansion.records.length,
          });
        }, { signal });
        await scanWeiboReplyControls(scope, expansion, onProgress, signal);
        // loadAllCommentRecords 可能在 page-mode 虚拟列表滚动期间暂时回收旧行；
        // 这里必须使用它返回的快照集合，而不是重新只读取滚动结束时的当前屏幕。
        const records = (Array.isArray(loaded.records) ? loaded.records : collectWeiboCommentRecordsActive(scope)).map((record) => ({
          ...record,
          workSection: record.level === 'reply' ? 'reply' : 'comment',
        })).concat(expansion.records);
        const reasons = ['微博作品评论只能按当前作品作用域内实际观察到的 DOM 读取'];
        if (loaded.reason) reasons.push(loaded.reason);
        const remainingControls = weiboReplyExpandControls(scope)
          .filter((control) => !expansion.attempted.has(weiboReplyControlKey(control)));
        if (expansion.limitHit || remainingControls.length) reasons.push('仍有未展开或达到安全上限的回复入口');
        return { records, partial: true, reason: reasons.join('；') };
      } finally {
        // 作品级读取可能在任何阶段被关闭、取消或被 DOM 异常打断；不要把
        // 本次程序化打开的新弹窗和滚动锁留给用户。已有用户弹窗不属于本次
        // 读取，保持原样并让 restoreWeiboDocumentScrollState 自己跳过。
        for (const modal of Array.from(document.querySelectorAll('.woo-modal-main'))) {
          if (initialModals.has(modal)) continue;
          await closeOwnedWeiboReplyModal(modal, documentScrollState);
        }
        // 取消可能早于平台排队的延迟弹窗；在短暂有界窗口内继续观察并
        // 关闭新出现的本次读取弹窗，避免它重新写入 html 滚动锁后无人清理。
        if (signal && signal.aborted) {
          await closeLateWeiboReplyModals(initialModals, documentScrollState);
        }
        restoreWeiboDocumentScrollState(documentScrollState);
        if (pageScrollTop != null && document.scrollingElement
          && document.scrollingElement.scrollTop !== pageScrollTop) {
          document.scrollingElement.scrollTop = pageScrollTop;
          try { window.dispatchEvent(new Event('scroll')); } catch (error) {}
        }
        if (pageScrollLeft != null && document.scrollingElement
          && document.scrollingElement.scrollLeft !== pageScrollLeft) {
          document.scrollingElement.scrollLeft = pageScrollLeft;
        }
      }
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

    function workScopeOfCard(card) {
      if (!card || !isCommentRoute()) return card;
      // 2026-09-04 用户授权 Chrome 真站捕获：详情页的 `article.woo-panel-main`
      // 只包含帖子正文；同级的 `_box_*` 子树才包含 `.wbpro-form`、`#scroller`
      // 和评论虚拟行。向上只取“唯一帖子卡片 + 已观察评论行”的最近容器，
      // 避免把信息流中相邻帖子的评论并入当前作品。
      let current = card.parentElement;
      for (let guard = 0; current && current !== document.body && guard < 8; guard++, current = current.parentElement) {
        const cards = collectWeiboItems(current, SEL.card)
          .filter((item) => !item.closest(SEL.card) || item.closest(SEL.card) === item);
        if (cards.length !== 1 || cards[0] !== card) continue;
        if (collectWeiboItems(current, SEL.comment).length) return current;
      }
      return card;
    }

    function workCandidates() {
      const cards = collectWeiboItems(document, SEL.card)
        .filter((item) => !item.closest(SEL.card) || item.closest(SEL.card) === item);
      return cards.map((card) => {
        const link = findUserLink(card);
        const author = extract(card);
        if (!link || !author.keys.length) return null;
        const postId = commentDataValue(card, ['mid', 'data-mid', 'data-id', 'data-post-id']);
        return {
          card,
          scope: workScopeOfCard(card),
          anchor: link,
          key: postId ? 'post|' + postId : card,
          title: '当前微博帖子',
        };
      }).filter(Boolean);
    }

    function collectWork(candidate) {
      const scope = candidate && candidate.scope || document;
      // 作品 scope 在详情页会扩展到评论 wrapper；作者仍必须从帖子卡片自身解析，
      // 防止 wrapper 内出现其它用户链接时把作者身份混淆。
      const creator = extract(candidate && candidate.card || scope);
      creator.workSection = 'creator';
      const commentNodes = collectWeiboItems(scope, SEL.comment);
      const records = collectWeiboCommentRecordsActive(scope).map((record) => ({
        ...record,
        workSection: record.level === 'reply' ? 'reply' : 'comment',
      }));
      return {
        title: candidate && candidate.title || '当前微博帖子',
        creator,
        records,
        unknown: Math.max(0, commentNodes.length - records.length),
        partial: true,
        reason: '微博帖子评论只能按当前帖子作用域内实际观察到的 DOM、展开控件和安全滚动读取',
      };
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
    // 评论和帖子作者入口都需要一次全局清理来处理微博虚拟列表的节点回收；
    // 这类清理不能跟着每个增量 DOM 批次同步执行。用脏标记和 120ms 一次性
    // 合并窗口处理连续变化，空闲时不保留周期唤醒。
    let weiboUiSyncRequested = true;
    let weiboUiSyncLoop = null;
    const requestWeiboUiSync = (immediate = false) => {
      weiboUiSyncRequested = true;
      if (weiboUiSyncLoop) weiboUiSyncLoop.wake(immediate ? 0 : 120);
    };
    weiboUiSyncLoop = createPageLoop(() => {
      if (!weiboUiSyncRequested) return;
      weiboUiSyncRequested = false;
      syncCommentButtons();
      syncAuthorButtons();
    }, 1200, () => weiboHost && weiboUiSyncRequested && PageLifecycle.isVisible());
    const refreshWeiboUiAfterDomReady = () => requestWeiboUiSync(true);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshWeiboUiAfterDomReady, { once: true });
    } else {
      refreshWeiboUiAfterDomReady();
    }
    weiboUiSyncLoop.wake();
    Store.onChange(() => requestWeiboUiSync(true));
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== 'weibo') return;
      // 虚拟列表移除一整行时，removedNodes 不会进入主扫描器的新增 items；
      // 只对“被移除节点自身是帖子/评论行”的情况请求一次低频清理，避免
      // 让每个普通文本变更都启动全局入口同步。
      const removed = (records || []).some((record) => Array.from(record && record.removedNodes || [])
        .some((node) => node && node.nodeType === 1 && node.matches
          && (node.matches(SEL.comment) || node.matches(SEL.card))));
      if (removed) requestWeiboUiSync(false);
      // 回收器有时在滚动事件之后才把新评论内容写入物理行；这些变化可能
      // 晚于滚动帧到达。只要变更发生在虚拟行内，就安排同一条轻量视口重判，
      // 不把普通正文/热搜 DOM 变化升级为整页扫描。
      const virtualMutation = (records || []).some((record) => {
        const target = record && record.target && record.target.nodeType === 1 ? record.target : null;
        if (target && target.closest && target.closest(VIRTUAL_ROW_SELECTOR)) return true;
        return Array.from(record && record.addedNodes || []).some((node) => (
          node && node.nodeType === 1 && node.matches
          && (node.matches(VIRTUAL_ROW_SELECTOR) || node.querySelector(VIRTUAL_ROW_SELECTOR))
        ));
      });
      if (virtualMutation) requestVisibleWeiboBlockScan();
    });

    // 微博详情页回收器可能只改写现有 item-view 的内容/位置，不一定在同一帧
    // 产生可供主 MutationObserver 及时处理的作者属性变化。页面已有屏蔽工作
    // 时，滚动事件只安排一次 rAF，对视口内的物理行重新执行身份判定；没有
    // 任何屏蔽容器时不建立这条滚动热路径，避免普通浏览和信息流增加深树扫描。
    // 这样复用行在下一绘制帧内就会继承当前名单的隐藏状态，同时仍允许回收器
    // 把未命中的新评论恢复为可见。
    let weiboVisibleBlockFrame = 0;
    function scanVisibleWeiboBlocks() {
      weiboVisibleBlockFrame = 0;
      if (!PageLifecycle.isVisible() || !blockedContainers.size) return;
      const adapter = Adapters.weibo;
      if (!adapter) return;
      const viewportWidth = Number(window.innerWidth) || 0;
      const viewportHeight = Number(window.innerHeight) || 0;
      // 微博当前捕获的回收器在 light DOM 中；滚动热路径不再递归整棵 Shadow DOM，
      // 只读取物理行及其评论后代，避免低性能机器在快速滚轮时重复深遍历。
      const rows = Array.from(document.querySelectorAll(VIRTUAL_ROW_SELECTOR));
      const visited = new Set();
      let handled = 0;
      for (const row of rows) {
        if (!row || inactiveWeiboVirtualRow(row)) continue;
        const rect = row.getBoundingClientRect();
        if (!(rect.bottom > 0 && rect.top < viewportHeight
          && rect.right > 0 && rect.left < viewportWidth)) continue;
        for (const item of Array.from(row.querySelectorAll(SEL.comment))) {
          if (visited.has(item)) continue;
          visited.add(item);
          let info = null;
          try { info = adapter.extract(item); } catch (error) {
            EventLog.recordError('scanner.weibo-visible-extract', error, { adapter: 'weibo', itemTag: item && item.tagName });
          }
          const marked = item.hasAttribute && item.hasAttribute('data-ob-blocked');
          // 未命中的新行无需重复走完整通用处理；带旧标记的复用行仍必须
          // 经过 handleItem，才能在作者变化后撤销旧隐藏状态。
          if (!marked && !(info && info.keys && info.keys.length && Index.isBlocked(info.keys))) continue;
          try { handleItem(adapter, item); handled++; }
          catch (error) { EventLog.recordError('scanner.weibo-visible', error, { adapter: 'weibo', itemTag: item && item.tagName }); }
        }
      }
      runtimeDiagnostic('weiboVisibleBlockScans');
      runtimeDiagnostic('weiboVisibleBlockItems', handled);
    }
    function requestVisibleWeiboBlockScan() {
      if (!PageLifecycle.isVisible() || !blockedContainers.size || weiboVisibleBlockFrame) return;
      if (typeof requestAnimationFrame === 'function') weiboVisibleBlockFrame = requestAnimationFrame(scanVisibleWeiboBlocks);
      else weiboVisibleBlockFrame = setTimeout(scanVisibleWeiboBlocks, 0);
    }
    const onWeiboScrollForBlocks = () => requestVisibleWeiboBlockScan();
    document.addEventListener('scroll', onWeiboScrollForBlocks, { capture: true, passive: true });
    window.addEventListener('scroll', onWeiboScrollForBlocks, { passive: true });
    RuntimeResources.add(() => {
      document.removeEventListener('scroll', onWeiboScrollForBlocks, true);
      window.removeEventListener('scroll', onWeiboScrollForBlocks);
      if (!weiboVisibleBlockFrame) return;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(weiboVisibleBlockFrame);
      else clearTimeout(weiboVisibleBlockFrame);
      weiboVisibleBlockFrame = 0;
    });

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
      workScope: { list: workCandidates, collect: collectWork, loadAll: loadAllWorkComments },
      commentManager: {
        available: () => isCommentRoute(),
        collectRecords: () => collectWeiboCommentRecords(document),
        loadAll: loadAllCommentRecords,
        loadThread,
        isRootComment,
        // 微博评论弹窗同样走统一多选管理器；含真实评论行的 Modal 不保留旧批量条。
        isScope: (root) => !!(root && root !== document && querySelectorAllDeep(root, SEL.comment).length > 0),
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
      onScan: (context) => {
        const items = context && Array.isArray(context.items) ? context.items : [];
        const relevant = !context || context.full || items.some((item) => item && item.matches
          && (item.matches(SEL.comment) || item.matches(SEL.card)));
        if (relevant) {
          invalidateWeiboCommentCache();
          requestWeiboUiSync(false);
        }
      },
      onDisabled: () => { clearCommentButtons(); clearAuthorButtons(); },
    };
  })();

  // ---------- 知乎 ----------
  Adapters.zhihu = (function () {
    const SEL = {
      // 2026-09-05 登录态真站评论弹窗捕获：评论行没有稳定的 `.CommentItem`，
      // 而是由语义类 `CommentContent` 放在行内内容层，作者链接仍为
      // `/people/<token>`/`/org/<token>`。`div:has(> div > CommentContent)`
      // 只匹配包住头像列和内容列的单条行，不把整组评论容器当成用户。
      commentContent: '[class*="CommentContent"]',
      commentRow: 'div:has(> div > [class*="CommentContent"])',
      item: '.ContentItem, .FeedCard, .TopstoryItem, [data-testid="AnswerCard"], .CommentItem, .List-item, [class*="CommentContent"], div:has(> div > [class*="CommentContent"])',
      comment: '.CommentItem, [class*="CommentContent"], div:has(> div > [class*="CommentContent"])',
      userLink: 'a[href*="/people/"], a[href*="/org/"]',
    };
    function idFromLink(link) {
      if (!link) return { id: '', token: '' };
      const href = attr(link, 'href') || '';
      const m = href.match(/\/(people|org)\/([^/?#]+)/);
      if (m) return { token: normId(m[2]) };
      return { token: '' };
    }
    function isAnswerCard(el) {
      return !!(el && el.matches && el.matches('.ContentItem, .FeedCard, .TopstoryItem, [data-testid="AnswerCard"]'));
    }
    function findCommentRow(el) {
      let p = el;
      while (p && p !== document.body) {
        // 评论弹窗是独立 portal；若评论被嵌进回答卡，优先保留回答卡的
        // 原有身份语义，避免把一个被屏蔽评论误判为整条回答。
        if (p.matches && p.matches(SEL.commentRow) && !isAnswerCard(p)) return p;
        p = p.parentElement;
      }
      return null;
    }
    function findCard(el) {
      const commentRow = findCommentRow(el);
      if (commentRow) return commentRow;
      let p = el;
      while (p && p !== document.body) {
        if (p.matches && p.matches(SEL.item) && !p.matches(SEL.commentContent)) return p;
        p = p.parentElement;
      }
      return el;
    }
    function extract(item) {
      const container = findCard(item);
      const link = (container || item).querySelector(SEL.userLink);
      const { token } = idFromLink(link);
      const name = textOf(link);
      const keys = [];
      appendIdentityKey(keys, 'zhihu:token', token);
      return { keys, label: name, container };
    }
    let lastMenuContext = null;
    function rememberMenuContext(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [event && event.target];
      for (const node of path || []) {
        const row = findCommentRow(node);
        if (!row) continue;
        const info = extract(row);
        if (info && info.keys && info.keys.length) {
          lastMenuContext = { ...info, at: Date.now() };
          return;
        }
      }
    }
    function menuContextInfo() {
      // 真实 portal 可能在用户移动鼠标或菜单动画期间延迟挂载；给用户
      // 留出十几秒点击自建入口的时间，同时仍用时间窗阻止跨菜单复用旧行。
      if (!lastMenuContext || Date.now() - lastMenuContext.at > 15000) {
        lastMenuContext = null;
        return null;
      }
      return lastMenuContext;
    }
    function isQuickMenuItem(el) {
      if (!el || el.nodeType !== 1 || el.tagName !== 'DIV' || (el.children && el.children.length)) return false;
      const text = textOf(el);
      if (!['屏蔽用户', '举报', '踩评论', '复制'].includes(text)) return false;
      const parent = el.parentElement;
      if (!parent || parent.children.length < 2) return false;
      const siblings = Array.from(parent.children).map((child) => textOf(child));
      return siblings.includes('屏蔽用户') && siblings.includes('举报') && siblings.includes('复制');
    }
    function isQuickMenuMutation(node) {
      if (!node || node.nodeType !== 1 || node === document.body || node === document.documentElement) return false;
      // 只检查新插入的小菜单子树；不向 body 级别的大树下钻，避免把
      // 评论弹窗的普通文本变化重新带入深扫描热路径。
      if (node.children && node.children.length > 32) return false;
      try { return Array.from(node.querySelectorAll('div')).some(isQuickMenuItem); }
      catch (e) { return false; }
    }
    return {
      id: 'zhihu',
      match: (h) => /(^|\.)zhihu\.com$/.test(h.hostname),
      selectors: [SEL.item],
      disappearSelectors: [SEL.comment],
      rememberMenuContext,
      menuContextInfo,
      isQuickMenuItem,
      isQuickMenuMutation,
      extract,
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
      // 2026-09-04 登录态真站捕获：新版 Vue 详情页使用 `.pb-comment-item`，
      // 用户数字 ID 位于该节点的 `__vue__.userInfo.id`；链接中的 home/main?id
      // 是不透明 portrait，不能当作 tieba:uid。只把评论项纳入扫描，不猜测首页
      // `.thread-card` 的作者身份。
      post: 'div.l_post.l_post_bright, div.d_post_content_main, .pb-comment-item, .pb-lzl-item',
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
        : (item.matches && item.matches('.pb-comment-item, .pb-lzl-item')) ? item
        : (item.closest && item.closest('div.l_post.l_post_bright')) || item;
    }
    function modernVueIdentity(item) {
      const vm = item && item.__vue__;
      const candidates = [
        vm && vm.userInfo,
        vm && vm.$props && vm.$props.commentData && vm.$props.commentData.userInfo,
      ];
      for (const user of candidates) {
        if (!user || typeof user !== 'object') continue;
        const uid = normalizeDigits(user.id);
        if (uid) return { uid, name: normNick(user.name_show || user.name || '') };
      }
      return { uid: '', name: '' };
    }
    function menuContextItem(node) {
      let p = node;
      while (p && p !== document.body) {
        if (p.matches && p.matches('.pb-lzl-item, .pb-comment-item, div.l_post.l_post_bright')) return p;
        p = p.parentElement;
      }
      return null;
    }
    function extract(item) {
      let fieldEl = item.querySelector(SEL.author);
      if (!fieldEl && item.hasAttribute && item.hasAttribute('data-field')) fieldEl = item;
      let identity = fieldEl ? uidFromField(fieldEl) : { uid: '', name: '' };
      if (!identity.uid && item.matches && item.matches('.pb-comment-item, .pb-lzl-item')) {
        identity = modernVueIdentity(item);
        if (!identity.name) {
          const nameNode = item.querySelector('.head-name, .name-info-link');
          identity.name = normNick(textOf(nameNode));
        }
      }
      const keys = [];
      appendIdentityKey(keys, 'tieba:uid', identity.uid);
      const container = containerForItem(item);
      return { keys, label: identity.name, container, source: fieldEl ? 'data-field' : (identity.uid ? 'dom-vue' : 'dom') };
    }
    let lastMenuContext = null;
    function rememberMenuContext(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [event && event.target];
      for (const node of path || []) {
        const item = menuContextItem(node);
        if (!item) continue;
        const info = extract(item);
        if (info && info.keys && info.keys.length) {
          lastMenuContext = { ...info, at: Date.now() };
          return;
        }
      }
    }
    function menuContextInfo() {
      if (!lastMenuContext || Date.now() - lastMenuContext.at > 10000) {
        lastMenuContext = null;
        return null;
      }
      return lastMenuContext;
    }
    function isQuickMenuItem(el) {
      if (!el || el.nodeType !== 1 || el.tagName !== 'DIV' || !el.classList.contains('action-item')) return false;
      const text = textOf(el);
      if (text !== '拉黑' && text !== '举报') return false;
      const parent = el.parentElement;
      if (!parent || !parent.classList.contains('more-action-card') || parent.children.length < 2) return false;
      const siblings = Array.from(parent.children).map((child) => textOf(child));
      // 根评论菜单通常还有“收藏”，楼中楼回复菜单在真站只保留“举报/拉黑”。
      // 两种形态都必须位于同一个已捕获的 `.more-action-card`，不能把普通
      // 页面文案当成菜单入口；只要求这两个安全锚点即可覆盖回复菜单。
      return siblings.includes('举报') && siblings.includes('拉黑');
    }
    function isQuickMenuMutation(node) {
      if (!node || node.nodeType !== 1 || node === document.body || node === document.documentElement) return false;
      if (node.children && node.children.length > 24) return false;
      try { return Array.from(node.querySelectorAll('.action-item')).some(isQuickMenuItem); }
      catch (e) { return false; }
    }
    return {
      id: 'tieba',
      match: (h) => /(^|\.)tieba\.baidu\.com$/.test(h.hostname),
      // 楼中楼集合不是单条回复；没有可靠的单回复捕获结构时不扫描该集合。
      selectors: [SEL.thread, SEL.post],
      disappearSelectors: [SEL.post],
      rememberMenuContext,
      menuContextInfo,
      isQuickMenuItem,
      isQuickMenuMutation,
      quickMenuSelector: '.action-item',
      extract,
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
      const container = document.querySelector(SEL.opusAuthor);
      const anchor = container && (container.querySelector('.opus-module-author__center') || container);
      return {
        keys: [makeIdentityKey('bili:uid', mid)],
        label: normId(author && author.name) || ('UID ' + mid),
        container: container || document,
        anchor: anchor || container || document,
        workSection: 'creator',
      };
    }

    function videoAuthorInfo() {
      if (!isVideoCommentPage()) return null;
      return userFromSpaceLink(document.querySelector(SEL.videoAuthor));
    }

    function workCandidates() {
      if (!isOpusPage()) return [];
      const author = opusAuthorInfo();
      if (!author || !author.keys.length) return [];
      return [{
        scope: document,
        anchor: author.anchor || author.container,
        key: 'opus|' + location.pathname + location.search,
        title: '当前 B 站动态作品',
      }];
    }

    function collectWork(candidate) {
      const scope = candidate && candidate.scope || document;
      const creator = opusAuthorInfo();
      const commentNodes = querySelectorAllDeep(scope, SEL.comment);
      const records = collectCommentRecords(scope).map((record) => ({
        ...record,
        workSection: record.level === 'reply' ? 'reply' : 'comment',
      })).concat(biliWorkDanmakuRecords());
      return {
        title: candidate && candidate.title || '当前 B 站动态作品',
        creator,
        records,
        unknown: Math.max(0, commentNodes.length - records.length),
        partial: true,
        // 动态详情页的作者身份有明确的 __INITIAL_STATE__ 来源；评论行则只按
        // 当前页面捕获到的 DOM 读取。当前没有经过真站确认的动态评论/弹幕全量
        // 接口，因此这里必须把“已识别”与“全量”明确区分。
        reason: 'B 站动态作品只按当前页面已观察到的评论和子评论 DOM 读取；动态视频弹幕没有已确认的安全全量来源',
      };
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

    // B站作者入口只需要在作者节点出现、路由变化或名单变化时更新。请求通过
    // 120ms 的一次性合并窗口处理；空闲时不保留每 1.2 秒唤醒一次的空循环。
    const bilibiliHost = /(^|\.)bilibili\.com$/.test(location.hostname);
    let biliAuthorSyncRequested = true;
    let biliAuthorSyncLoop = null;
    const requestBiliAuthorSync = (immediate = false) => {
      biliAuthorSyncRequested = true;
      if (biliAuthorSyncLoop) biliAuthorSyncLoop.wake(immediate ? 0 : 120);
    };
    biliAuthorSyncLoop = createPageLoop(() => {
      if (!biliAuthorSyncRequested) return;
      biliAuthorSyncRequested = false;
      syncBiliAuthorButtons();
    }, 1200, () => bilibiliHost && biliAuthorSyncRequested && PageLifecycle.isVisible());
    const refreshBiliAuthorAfterDomReady = () => requestBiliAuthorSync(true);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshBiliAuthorAfterDomReady, { once: true });
    } else {
      refreshBiliAuthorAfterDomReady();
    }
    biliAuthorSyncLoop.wake();
    Store.onChange(() => requestBiliAuthorSync(true));

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

    // B站可能把请求的 ps=20 限制成更小的实际 page.size；只按 replies.length
    // 与请求值比较会在第一页提前停止，正好漏掉界面上的第二页、第三页。优先使用
    // 接口返回的页号/实际页大小与总数判断，只有接口没有总数时才退回请求页大小。
    function replyPageState(data, replies, requestedPage) {
      const page = data && data.page || {};
      const rawCount = page.count;
      const count = Number(rawCount);
      const hasCount = rawCount != null && Number.isFinite(count) && count >= 0;
      const rawNumber = page.num;
      const number = Number(rawNumber);
      const pageNumber = Number.isFinite(number) && number > 0 ? number : requestedPage;
      const rawSize = page.size;
      const size = Number(rawSize);
      const pageSize = Number.isFinite(size) && size > 0
        ? size : Math.max(1, replies.length || REPLY_PAGE_SIZE);
      return {
        hasMore: hasCount ? pageNumber * pageSize < count : replies.length >= REPLY_PAGE_SIZE,
        emptyBeforeEnd: hasCount && pageNumber * pageSize < count && !replies.length,
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
          const pageState = replyPageState(data, replies, page);
          if (!pageState.hasMore) break;
          if (pageState.emptyBeforeEnd) {
            partial = true; reason = reason || '子回复分页提前返回空页'; break;
          }
          if (page === REPLY_SUB_PAGE_CAP) {
            partial = true; reason = reason || '子回复达到安全分页上限'; break;
          }
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
        const pageState = replyPageState(data, replies, page);
        if (!pageState.hasMore) break;
        if (pageState.emptyBeforeEnd) {
          partial = true; reason = '单楼回复分页提前返回空页'; break;
        }
        if (page === REPLY_SUB_PAGE_CAP) { partial = true; reason = '单楼回复达到安全分页上限'; break; }
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
      workScope: { list: workCandidates, collect: collectWork },
      getAutoDanmakuStatus: () => biliDanmakuAutoStatus(),
      commentManager: {
        available: () => isVideoCommentPage(),
        collectRecords: () => collectCommentRecords(document),
        loadAll: fetchAllCommentAuthors,
        loadThread,
        isRootComment,
        // 已接入统一多选管理器的评论承载层，不再显示旧的“拉黑全部”弹窗按钮。
        isScope: (root) => {
          if (!root || root === document) return false;
          const tag = String(root.tagName || '').toLowerCase();
          return tag === 'bili-comments' || querySelectorAllDeep(root, SEL.comment).length > 0;
        },
      },
      containerOf: commentContainer,
      onScan: (context) => {
        const items = context && Array.isArray(context.items) ? context.items : [];
        if (!context || context.full || items.some((item) => item && item.matches
          && (item.matches(SEL.videoAuthor) || item.matches(SEL.opusAuthor)))) requestBiliAuthorSync(false);
      },
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

  // 真站评论菜单由 BILI-COMMENT-MENU 的 Shadow DOM 承载；其中的“硬核会员举报”
  // 与弹幕举报共用“举报”文本，但仍有评论上下文，不能被弹幕 hash 分支提前拦截。
  function isBilibiliCommentMenuItem(el) {
    if (!el || el.nodeType !== 1) return false;
    return ancestorChain(el).some((node) => node && node.tagName === 'BILI-COMMENT-MENU');
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
      // 仍连接的评论/菜单节点可能被虚拟列表复用；先按点击时的当前 DOM
      // 重新识别，避免把旧行身份带到新用户。portal 菜单与评论行分离时，
      // 当前 DOM 无法沿回评论上下文，再回退到创建/最近扫描时保存的快照，
      // 以覆盖用户停顿超过上下文 TTL 的安全延迟点击。
      const liveInfo = cfg.identify ? cfg.identify(anchorEl) : identifyFromAnchor(anchorEl);
      const info = liveInfo && liveInfo.keys && liveInfo.keys.length ? liveInfo : btn.__obQuickInfo;
      if (!info || !info.keys || !info.keys.length) {
        EventLog.record('ui.quick.rejected', { platform: currentAdapter && currentAdapter.id || 'unknown', reasonCode: 'no-reliable-identity' }, { immediate: true });
        showToast('⚠️ 无法识别该用户，请重新打开菜单或试右键'); return;
      }
      EventLog.record('ui.quick.open-confirm', { platform: currentAdapter && currentAdapter.id || 'unknown' }, { immediate: true });
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
    const injectedButtons = new Set();
    const markedAnchors = new Set();
    const trackButton = (button) => { if (button) injectedButtons.add(button); return button; };
    const trackAnchor = (anchor) => {
      if (!anchor) return;
      markedAnchors.add(anchor);
      anchor.setAttribute('data-ob-qb', '1');
    };
    const untrackButton = (button) => { if (button) injectedButtons.delete(button); };
    const untrackAnchor = (anchor) => { if (anchor) markedAnchors.delete(anchor); };
    function pruneTracked() {
      for (const button of Array.from(injectedButtons)) if (!button || !button.isConnected) injectedButtons.delete(button);
      for (const anchor of Array.from(markedAnchors)) if (!anchor || !anchor.isConnected) markedAnchors.delete(anchor);
    }
    function clearInjected() {
      for (const button of injectedButtons) if (button && button.isConnected) button.remove();
      for (const anchor of markedAnchors) if (anchor && anchor.isConnected) anchor.removeAttribute('data-ob-qb');
      injectedButtons.clear();
      markedAnchors.clear();
    }
    let menuScanRequested = true;
    let menuLoop = null;
    const requestMenuScan = () => {
      menuScanRequested = true;
      if (menuLoop) menuLoop.wake();
    };
    function tryInject(el) {
      if (!el || el.nodeType !== 1 || (el.classList && Array.from(el.classList).some((name) => name.startsWith('ob-')))) return;
      const inDouyinPortal = a.id === 'douyin' && el.closest
        && el.closest('[role="tooltip"],.semi-tooltip-wrapper');
      if (inDouyinPortal && !(el.matches && el.matches('[data-e2e="video-comment-more-report"]'))) return;
      if (!Store.getSetting('showQuickBlock')) return;
      const t = textOf(el);
      if (!t) return;
      for (const txt of cfg.anchorTexts) {
        const adapterMenuItem = typeof a.isQuickMenuItem === 'function' && a.isQuickMenuItem(el);
        // 知乎评论菜单的真实项是无 role 的结构化 div；该平台正文/热榜里
        // 也常出现“被举报/举报中心”等普通链接，不能把它们当成可执行菜单。
        const recognizedMenuItem = a.id === 'zhihu'
          ? adapterMenuItem
          : (isMenuItem(el) || adapterMenuItem);
        if (t.indexOf(txt) !== -1 && recognizedMenuItem) {
          if (a.id === 'bilibili' && t.indexOf('举报') !== -1 && !isBilibiliCommentMenuItem(el)) {
            const dmInfo = floatingDanmaku.fresh();
            if (!dmInfo) {
              trackAnchor(el);
              return;
            }
            if (el.parentNode && el.parentNode.querySelector(':scope > .ob-quick')) return;
            const btn = makeQuickBtn(cfg.label || '本地拉黑', el, { identify: () => dmInfo }, dmInfo.keys.join('|'));
            trackButton(btn);
            trackAnchor(el);
            el.insertAdjacentElement('afterend', btn);
            return;
          }
          // 不向稿件举报等没有发送者上下文的菜单注入无效按钮。
          const info = cfg.identify ? cfg.identify(el)
            : (typeof a.menuContextInfo === 'function' && a.menuContextInfo()) || identifyFromAnchor(el);
          if (!info || !info.keys || !info.keys.length) return;
          const parent = el.parentNode;
          if (!parent) return;
          // 该菜单已有本地按钮则复用；楼操作是独立入口，不能用同一个 class
          // 去重，否则会在重绘/周期扫描时丢失其中一个功能。
          let localButton = parent.querySelector(':scope > .ob-quick:not(.ob-thread-quick)');
          if (!localButton) {
            localButton = makeQuickBtn(cfg.label || '本地拉黑', el, cfg, txt);
            trackButton(localButton);
          } else trackButton(localButton);
          // 保存本次菜单项解析出的身份；portal 菜单可能延迟点击，也可能
          // 复用同一节点承载另一条评论，后者由后续扫描覆盖该快照。
          localButton.__obQuickInfo = info;
          if (!localButton.isConnected) parent.insertBefore(localButton, el.nextSibling);
          let rootComment = false;
          if (a.commentManager && typeof a.commentManager.isRootComment === 'function') {
            rootComment = !!(info.container && a.commentManager.isRootComment(info.container));
          }
          if (rootComment && !parent.querySelector(':scope > .ob-thread-quick')) {
            const threadButton = makeThreadBtn(el, cfg, txt, a);
            trackButton(threadButton);
            parent.insertBefore(threadButton, localButton.nextSibling);
          }
          const existingThreadButton = parent.querySelector(':scope > .ob-thread-quick');
          if (existingThreadButton) trackButton(existingThreadButton);
          trackAnchor(el);
          return;
        }
      }
    }
    function scanAll() {
      pruneTracked();
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { clearInjected(); return; }
      for (const el of querySelectorAllDeep(document, QB_CANDIDATE)) tryInject(el);
      // 知乎评论弹窗当前版本的菜单项是无 role/class 语义 div，菜单容器类名
      // 每次构建都会变化。仅在菜单扫描已被点击/Mutation 信号唤醒时，按适配器
      // 提供的真实结构谓词检查叶子节点，不把 `div` 加入常态观察热路径。
      if (typeof a.isQuickMenuItem === 'function') {
        const selector = a.quickMenuSelector || 'div';
        for (const el of querySelectorAllDeep(document, selector)) {
          if (a.isQuickMenuItem(el)) tryInject(el);
        }
      }
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
          for (const button of quicks) if (!directButtons.includes(button)) { untrackButton(button); button.remove(); }
          for (const marked of querySelectorAllDeep(portalRoot, '[data-ob-qb]')) {
            if (!reports.includes(marked)) { untrackAnchor(marked); marked.removeAttribute('data-ob-qb'); }
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
        if (text && text.length <= 120 && cfg.anchorTexts.some((anchor) => text.indexOf(anchor) !== -1)) {
          requestMenuScan();
          tryInject(el);
        }
      }
    };
    // 举报项常在鼠标悬停后才瞬时挂载；事件触发补扫能赶在菜单关闭前插入入口，
    // 周期扫描仍负责键盘打开和无鼠标场景。
    document.addEventListener('pointerover', probeMenuEvent, true);
    document.addEventListener('focusin', probeMenuEvent, true);
    if (typeof a.rememberMenuContext === 'function') {
      document.addEventListener('pointerdown', (event) => a.rememberMenuContext(event), true);
    }
    const menuNode = (node) => {
      if (!node) return null;
      return node.nodeType === 1 ? node : (node.host || node.parentElement || null);
    };
    const isMenuMutation = (node) => {
      let current = menuNode(node);
      for (let guard = 0; current && guard < 16; guard++) {
        if (current.matches) {
          if (typeof a.isQuickMenuMutation === 'function' && a.isQuickMenuMutation(current)) return true;
          try {
            if (current.matches(QB_MENU_ROOT + ',#options,bili-comment-menu,[role="menu"]')) return true;
          } catch (e) {}
        }
        current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }
      return false;
    };
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== a.id || !Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) return;
      if ((records || []).some((record) => isMenuMutation(record && record.target)
        || Array.from(record && record.addedNodes || []).some(isMenuMutation)
        || Array.from(record && record.removedNodes || []).some(isMenuMutation))) requestMenuScan();
    });
    const isMenuTrigger = (node) => {
      const element = menuNode(node);
      if (!element || !element.matches) return false;
      let text = '';
      let className = '';
      try { text = textOf(element) + ' ' + (attr(element, 'aria-label') || '') + ' ' + (attr(element, 'title') || '') + ' ' + (attr(element, 'data-e2e') || ''); }
      catch (e) { return false; }
      try { className = attr(element, 'class') || ''; } catch (e) { className = ''; }
      if (/Dots24|ellipsis|more/i.test(className)) return true;
      return /更多|操作|菜单|评论|more|menu|action/i.test(text)
        && (/^(BUTTON|A)$/.test(element.tagName) || element.getAttribute('role') === 'button'
          || element.hasAttribute('aria-haspopup'));
    };
    document.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (typeof a.rememberMenuContext === 'function') a.rememberMenuContext(event);
      if (path.some(isMenuTrigger)) requestMenuScan();
    }, true);
    // 菜单打开、键盘聚焦或相关 Shadow DOM 变化时才执行一次扫描；请求处理完
    // 即停止计时，普通页面空闲时不保留周期唤醒。
    menuLoop = createPageLoop(() => {
      if (!menuScanRequested) return;
      menuScanRequested = false;
      scanAll();
    }, 3000,
      () => menuScanRequested && Store.getSetting('enabled') && Store.getSetting('showQuickBlock'));
    scanAll();
    menuScanRequested = false;
    menuLoop.wake();
    refreshQuickBlock = () => { requestMenuScan(); menuLoop.wake(); };
    Store.onChange(() => {
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) {
        // 循环的 active 门控在功能关闭后会拒绝唤醒；关闭动作本身仍必须
        // 同步清理已经注入的菜单节点，不能把旧 UI 留在页面上。
        menuScanRequested = false;
        clearInjected();
        return;
      }
      requestMenuScan(); menuLoop.wake();
    });
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

  // 管理器里的“取消屏蔽”按已保存的人物身份组处理：同一人物可能同时拥有
  // UID、sec_uid、弹幕 hash 等键，只删当前一条键会让页面仍因关联键保持灰态。
  // 调用方只传入当前行已经判定为屏蔽的键，未屏蔽的并列记录不会触发扩展。
  function relatedIdentityKeys(keys) {
    const targets = new Set(normalizeIdentityKeys(keys));
    if (!targets.size) return [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const person of Object.values(Store.persons())) {
        const identities = normalizeIdentityKeys(person && person.identities);
        if (!identities.some((key) => targets.has(key))) continue;
        for (const key of identities) {
          if (targets.has(key)) continue;
          targets.add(key);
          changed = true;
        }
      }
    }
    return Array.from(targets);
  }

  function unblockIdentityGroup(keys) {
    const normalized = normalizeIdentityKeys(keys);
    if (!normalized.length) return { removed: 0, keys: [] };
    const expanded = relatedIdentityKeys(normalized);
    return { removed: Store.removeIdentities(expanded), keys: expanded };
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
    if (!list.length) { EventLog.record('action.bulk.empty', {}, { immediate: true }); showToast('没有可拉黑的用户'); return; }
    const keys = [];
    list.forEach((i) => i.keys.forEach((k) => { if (keys.indexOf(k) === -1) keys.push(k); }));
    EventLog.record('action.bulk.prepare', { candidateCount: list.length, keyCount: keys.length }, { immediate: true });
    showConfirm(confirmLabel || ('拉黑全部 ' + list.length + ' 位用户'), keys, anchorEl, onBlocked, () => {
      clearDanmakuExemptionsForManualBlock(keys);
      const results = Store.addIdentityGroups(list.map((info) => ({ keys: info.keys, label: info.label, note: info.note })));
      const addedKeys = [];
      for (const result of results) {
        for (const key of result.addedKeys) if (!addedKeys.includes(key)) addedKeys.push(key);
      }
      return {
        result: {
          added: addedKeys.length,
          addedKeys,
          persisted: results.persisted !== false,
          persistError: results.persistError || '',
        },
        undo: addedKeys.length ? () => {
          EventLog.record('action.bulk.undo', { keyCount: addedKeys.length }, { immediate: true });
          Store.removeIdentities(addedKeys);
        } : null,
      };
    }, '', toastLabel);
  }

  // ---- 一键屏蔽单个作品的关联用户 ----
  // 作品级操作必须由适配器提供明确的 scope；公共层只负责计数、确认、一次事务和撤销。
  // 这样不会把同一信息流里相邻作品的作者或评论误并入本次操作。
  function normalizeWorkRecord(info, section) {
    if (!info || !info.keys) return null;
    const keys = normalizeIdentityKeys(info.keys);
    if (!keys.length) return null;
    return {
      ...info,
      keys,
      label: String(info.label || '').trim(),
      note: String(info.note || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      workSection: section || info.workSection || info.section || 'other',
    };
  }

  function workResultFrom(adapter, candidate, provided) {
    const scopeApi = adapter && adapter.workScope;
    let base = {};
    try { base = scopeApi && typeof scopeApi.collect === 'function' ? (scopeApi.collect(candidate) || {}) : {}; }
    catch (error) { EventLog.recordError('work.collect', error, { adapter: adapter && adapter.id }); }
    const raw = provided && typeof provided === 'object' ? { ...base, ...provided } : base;
    // 作用域加载器通常只补充评论分页；基础收集结果还可能包含已经建立的
    // 当前作品弹幕会话，因此不能用分页结果覆盖基础结果。后续 uniqueUsers
    // 会按规范化身份去重，sectionCounts 也用 Set 统计，不会因两次观察重复计数。
    if (provided && Array.isArray(provided.records)) {
      raw.records = (Array.isArray(base.records) ? base.records : []).concat(provided.records);
    }
    if (!raw.creator && base.creator) raw.creator = base.creator;
    const records = [];
    const creator = normalizeWorkRecord(raw.creator, 'creator');
    if (creator) records.push(creator);
    for (const item of Array.isArray(raw.records) ? raw.records : []) {
      const record = normalizeWorkRecord(item, item && (item.workSection || item.section) || 'comment');
      if (record) records.push(record);
    }
    const sectionKeys = { creator: new Set(), comment: new Set(), reply: new Set(), danmaku: new Set(), other: new Set() };
    for (const record of records) {
      const bucket = sectionKeys[record.workSection] || sectionKeys.other;
      for (const key of record.keys) bucket.add(key);
    }
    const users = uniqueUsers(records);
    const existing = users.filter((item) => Index.isBlocked(item.keys));
    const fresh = users.filter((item) => !Index.isBlocked(item.keys));
    const sectionCounts = {};
    for (const name of Object.keys(sectionKeys)) if (sectionKeys[name].size) sectionCounts[name] = sectionKeys[name].size;
    return {
      candidate,
      records,
      users,
      fresh,
      existing,
      sectionCounts,
      unknown: Math.max(0, Number(raw.unknown) || 0),
      partial: raw.complete === true ? false : raw.partial !== false,
      complete: raw.complete === true,
      reason: String(raw.reason || '').replace(/\s+/g, ' ').trim().slice(0, 360),
      title: String(raw.title || candidate && candidate.title || '当前作品').replace(/\s+/g, ' ').trim().slice(0, 120),
      loadedAt: Date.now(),
    };
  }

  function workCountLine(label, count) {
    return label + '：' + (Number(count) || 0) + ' 位';
  }

  function workCandidateStillCurrent(adapter, candidate) {
    const scopeApi = adapter && adapter.workScope;
    if (!scopeApi || typeof scopeApi.list !== 'function') return true;
    const target = candidate && (candidate.key || candidate.scope);
    try {
      return (scopeApi.list() || []).some((item) => item && (item.key || item.scope) === target);
    } catch (error) {
      EventLog.recordError('work.current-check', error, { adapter: adapter && adapter.id });
      return false;
    }
  }

  function renderWorkResult(box, result, loading, progress) {
    if (!box || !result) return;
    const title = box.querySelector('.ob-work-title');
    const status = box.querySelector('.ob-work-status');
    const counts = box.querySelector('.ob-work-counts');
    const warning = box.querySelector('.ob-work-warning');
    const ok = box.querySelector('.ob-work-ok');
    if (title) title.textContent = '屏蔽作品用户：' + (result.title || '当前作品');
    if (status) {
      const progressText = progress && progress.collected != null
        ? '正在读取：已发现 ' + (Number(progress.collected) || 0) + ' 条记录' + (progress.phase ? '（' + progress.phase + '）' : '') + '\n'
        : '';
      status.textContent = progressText + (loading ? '正在尽力读取当前作品内容，请保持页面不切换。' : '已完成本次可安全读取的范围。');
    }
    if (counts) {
      counts.textContent = '';
      const lines = [
        ['作品作者', result.sectionCounts.creator || 0],
        ['已识别主评论作者', result.sectionCounts.comment || 0],
        ['已识别子评论作者', result.sectionCounts.reply || 0],
        ['已识别弹幕发送者', result.sectionCounts.danmaku || 0],
        ['可屏蔽用户（去重）', result.users.length],
        ['本次新增身份', result.fresh.length],
        ['原已屏蔽身份', result.existing.length],
        ['当前可见但无可靠身份', result.unknown],
      ];
      for (const [label, count] of lines) {
        const item = document.createElement('div'); item.className = 'ob-work-count'; item.textContent = workCountLine(label, count); counts.appendChild(item);
      }
    }
    if (warning) {
      warning.textContent = result.complete
        ? '已确认当前适配器的读取范围结束。'
        : '平台显示的评论总数不等于已识别作者数；未加载、虚拟回收或没有可靠身份的评论不会被猜测屏蔽。'
          + '\n确认后只会屏蔽已经可靠识别到的用户。'
          + (result.reason ? '\n原因：' + result.reason : '');
      warning.style.display = loading ? 'none' : 'block';
    }
    if (ok) {
      ok.disabled = loading || !result.users.length;
      ok.textContent = result.users.length ? (result.partial ? '屏蔽已识别用户' : '确认屏蔽这些用户') : '没有可屏蔽用户';
    }
  }

  function resolveLiveWorkCandidate(adapter, candidate) {
    if (!adapter || !adapter.workScope || typeof adapter.workScope.list !== 'function' || !candidate) return candidate;
    try {
      const candidates = adapter.workScope.list() || [];
      // 微博详情评论是异步挂载的：作品卡片对象不变，但候选的 scope 会从
      // 卡片本身升级为同级详情 wrapper。点击按钮时重新取一次当前候选，
      // 避免按钮闭包还握着“评论尚未挂载”的早期快照。
      const sameCard = candidate.card
        ? candidates.filter((item) => item && item.card === candidate.card)
        : [];
      const upgraded = sameCard.find((item) => item.scope && item.scope !== item.card);
      if (upgraded) return upgraded;
      const sameScope = candidates.find((item) => item && item.scope === candidate.scope);
      if (sameScope) return sameScope;
      const sameKey = candidate.key != null
        ? candidates.find((item) => item && item.key != null && item.key === candidate.key)
        : null;
      return sameKey || sameCard[0] || candidate;
    } catch (error) {
      EventLog.recordError('work.current-candidate', error, { adapter: adapter.id });
      return candidate;
    }
  }

  let activeWorkAbortController = null;
  async function openWorkBlock(adapter, candidate) {
    if (!adapter || !adapter.workScope || !candidate) return;
    candidate = resolveLiveWorkCandidate(adapter, candidate);
    if (!candidate.scope || candidate.scope.isConnected === false) { EventLog.record('action.work.rejected', { adapter: adapter.id, reasonCode: 'scope-detached' }, { immediate: true }); showToast('当前作品已离开页面'); return; }
    if (activeWorkAbortController) activeWorkAbortController.abort();
    const old = document.getElementById('ob-work-confirm');
    FloatingDock.release('work-block');
    if (old) old.remove();
    FloatingDock.hold('work-block');
    let result = workResultFrom(adapter, candidate);
    let cancelled = false;
    let loading = false;
    const workAbortController = typeof AbortController === 'function' ? new AbortController() : null;
    const workSignal = workAbortController ? workAbortController.signal : null;
    activeWorkAbortController = workAbortController;
    const releaseWorkOperation = () => {
      if (activeWorkAbortController === workAbortController) activeWorkAbortController = null;
    };
    const box = document.createElement('div');
    box.id = 'ob-work-confirm';
    box.innerHTML = `<div class="ob-work-box" role="dialog" aria-modal="true" aria-labelledby="ob-work-title"><div class="ob-work-head"><h2 class="ob-work-title" id="ob-work-title"></h2><button class="ob-work-close" type="button" aria-label="关闭">×</button></div><div class="ob-work-status"></div><div class="ob-work-counts"></div><div class="ob-work-warning"></div><div class="ob-work-row"><button class="ob-work-no" type="button">取消</button><button class="ob-work-ok" type="button">屏蔽已识别用户</button></div></div>`;
    document.body.appendChild(box);
    EventLog.record('action.work.open', { adapter: adapter.id, initialUsers: result.users.length }, { immediate: true });
    const close = (reason) => {
      if (cancelled && !box.isConnected) return;
      cancelled = true;
      if (workAbortController) workAbortController.abort();
      releaseWorkOperation();
      EventLog.record('action.work.cancel', { adapter: adapter.id, reason: reason || 'user' }, { immediate: true });
      box.remove(); FloatingDock.release('work-block'); focusPageAfterOmniBlock('work-' + (reason || 'user'));
    };
    box.querySelector('.ob-work-close').onclick = () => close('close-button');
    box.querySelector('.ob-work-no').onclick = () => close('cancel-button');
    box.onclick = (event) => { if (event.target === box) close('backdrop'); };
    const commit = () => {
      if (cancelled || loading || !result.users.length) return;
      if (!workCandidateStillCurrent(adapter, candidate)) {
        EventLog.record('action.work.rejected', { adapter: adapter.id, reasonCode: 'work-changed' }, { immediate: true });
        close('work-changed');
        showToast('作品已切换，未执行屏蔽；请在当前作品重新打开入口');
        return;
      }
      const allKeys = [];
      for (const user of result.users) for (const key of user.keys) if (!allKeys.includes(key)) allKeys.push(key);
      try {
        clearDanmakuExemptionsForManualBlock(allKeys);
        const writes = Store.addIdentityGroups(result.users.map((user) => ({ keys: user.keys, label: user.label, note: user.note })));
        const persisted = writes.persisted !== false;
        const addedKeys = [];
        for (const write of writes) for (const key of write.addedKeys || []) if (!addedKeys.includes(key)) addedKeys.push(key);
        EventLog.record('action.work.commit', {
          adapter: adapter.id, users: result.users.length, added: addedKeys.length, persisted,
          fresh: result.fresh.length, existing: result.existing.length,
          partial: result.partial, complete: result.complete,
          creator: result.sectionCounts.creator || 0, comments: result.sectionCounts.comment || 0,
          replies: result.sectionCounts.reply || 0, danmaku: result.sectionCounts.danmaku || 0,
        }, { immediate: true });
        if (workAbortController) workAbortController.abort();
        releaseWorkOperation();
        box.remove(); FloatingDock.release('work-block');
        focusPageAfterOmniBlock('work-commit');
        showToast((persisted ? '已屏蔽当前作品的 ' : '已在本页屏蔽但未确认落盘：') + result.users.length + ' 位已识别用户'
          + (result.partial ? '（结果可能不完整）' : '') + (persisted ? '' : '，请重试或导出备份'),
          addedKeys.length ? () => {
            EventLog.record('action.work.undo', { adapter: adapter.id, removed: addedKeys.length }, { immediate: true });
            Store.removeIdentities(addedKeys);
          } : null);
        if (currentScanner) currentScanner.schedule();
      } catch (error) {
        EventLog.recordError('action.work.commit', error, { adapter: adapter.id });
        showToast('作品屏蔽失败：' + (error && error.message || error));
      }
    };
    box.querySelector('.ob-work-ok').onclick = commit;
    renderWorkResult(box, result, false, null);

    const loadAll = typeof adapter.workScope.loadAll === 'function' ? adapter.workScope.loadAll : null;
    if (!loadAll) {
      result.partial = true;
      result.reason = result.reason || '当前平台没有可安全调用的作品级加载器';
      renderWorkResult(box, result, false, null);
      return;
    }
    loading = true;
    renderWorkResult(box, result, true, null);
    EventLog.record('action.work.load.start', { adapter: adapter.id, initialUsers: result.users.length }, { immediate: true });
    try {
      const loaded = await loadAll(candidate, (progress) => {
        if (cancelled) return;
        EventLog.record('action.work.load.progress', {
          adapter: adapter.id, phase: progress && progress.phase || 'unknown',
          collected: Number(progress && (progress.collected || progress.comments || progress.users)) || 0,
          scrolls: Number(progress && progress.scrolls) || 0,
        });
        renderWorkResult(box, result, true, progress || null);
      }, { signal: workSignal });
      if (cancelled) return;
      result = workResultFrom(adapter, candidate, loaded);
      EventLog.record('action.work.load.finish', {
        adapter: adapter.id, users: result.users.length, partial: result.partial, complete: result.complete,
      }, { immediate: true });
      loading = false;
      renderWorkResult(box, result, false, null);
    } catch (error) {
      if (cancelled || (workSignal && workSignal.aborted) || error && error.name === 'AbortError') {
        focusPageAfterOmniBlock('work-load-cancelled');
        return;
      }
      EventLog.recordError('action.work.load', error, { adapter: adapter.id });
      loading = false;
      result.partial = true;
      result.reason = '作品内容读取失败，保留已经识别到的用户';
      renderWorkResult(box, result, false, null);
    }
  }

  let refreshWorkBlock = () => {};
  function setupWorkBlock() {
    const adapter = currentAdapter;
    if (!adapter || !adapter.workScope || typeof adapter.workScope.list !== 'function') return;
    const states = new Map();
    let positionFrame = 0;
    let refreshRequested = true;
    let workLoop = null;
    let lastWorkUrl = location.href;
    const position = (state) => {
      const anchor = state && state.anchor;
      const portal = state && state.portal;
      if (!anchor || !anchor.isConnected || !portal || !portal.isConnected || !isVisible(anchor)) {
        if (portal) portal.style.setProperty('display', 'none', 'important');
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      if (!visible) { portal.style.setProperty('display', 'none', 'important'); return; }
      portal.style.setProperty('display', 'block', 'important');
      const width = portal.offsetWidth || 100;
      const height = portal.offsetHeight || 24;
      const left = clamp(rect.right + 8, 4, Math.max(4, window.innerWidth - width - 4));
      let top = rect.bottom + 4;
      if (top + height > window.innerHeight - 4) top = rect.top - height - 4;
      portal.style.left = left + 'px'; portal.style.top = clamp(top, 4, Math.max(4, window.innerHeight - height - 4)) + 'px';
    };
    const schedulePosition = () => {
      if (positionFrame) return;
      const run = () => { positionFrame = 0; for (const state of states.values()) position(state); };
      positionFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 0);
    };
    const removeState = (key) => {
      const state = states.get(key);
      if (state && state.portal && state.portal.parentNode) state.portal.parentNode.removeChild(state.portal);
      states.delete(key);
    };
    const clear = () => { for (const key of Array.from(states.keys())) removeState(key); };
    const requestRefresh = (immediate = false) => {
      refreshRequested = true;
      if (workLoop) workLoop.wake(immediate ? 0 : 180);
    };
    const refresh = () => {
      // 用户脚本可能早于 body 执行；此时不能消费掉脏标记，否则后续没有
      // DOM 变更的页面会永远失去作品入口。保留请求并交给低频循环/DOMContentLoaded
      // 在页面就绪后重试。
      if (!document.body) { refreshRequested = true; return; }
      if (!Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) { clear(); return; }
      let candidates = [];
      try { candidates = adapter.workScope.list() || []; }
      catch (error) { EventLog.recordError('work.list', error, { adapter: adapter.id }); clear(); return; }
      const active = new Set();
      for (const candidate of candidates) {
        if (!candidate || !candidate.scope || !candidate.anchor || candidate.scope.isConnected === false || !candidate.anchor.isConnected) continue;
        const key = candidate.key || candidate.scope;
        active.add(key);
        let state = states.get(key);
        if (!state) {
          const portal = document.createElement('div'); portal.className = 'ob-work-block-portal'; portal.setAttribute('aria-label', '作品用户本地屏蔽入口');
          const button = document.createElement('button'); button.type = 'button'; button.className = 'ob-work-block'; button.textContent = '🚫 屏蔽作品';
          button.title = '本地屏蔽当前作品的作者、评论、子评论和可确认弹幕发送者';
          button.setAttribute('aria-label', '屏蔽当前作品用户');
          button.onclick = (event) => { event.stopPropagation(); event.preventDefault(); openWorkBlock(adapter, state.candidate); };
          portal.appendChild(button); document.body.appendChild(portal);
          state = { key, candidate, anchor: candidate.anchor, scope: candidate.scope, portal };
          states.set(key, state);
        } else {
          // 评论表面可能在帖子卡片之后才挂载；入口存在期间必须使用最新候选，
          // 否则按钮闭包会一直持有没有评论 scope 的早期快照。
          state.candidate = candidate;
          state.anchor = candidate.anchor; state.scope = candidate.scope;
        }
        position(state);
      }
      for (const key of Array.from(states.keys())) if (!active.has(key)) removeState(key);
      schedulePosition();
    };
    const reposition = () => schedulePosition();
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const workNode = (node) => {
      if (!node) return null;
      return node.nodeType === 1 ? node : (node.host || node.parentElement || null);
    };
    const within = (node, root) => {
      let current = workNode(node);
      for (let guard = 0; current && guard < 32; guard++, current = current.parentElement
        || (current.getRootNode && current.getRootNode().host) || null) {
        if (current === root) return true;
      }
      return false;
    };
    const workActivitySelector = (adapter.selectors || []).join(',')
      + ',.basePlayerContainer,.playerContainer,[data-e2e="video-player"],[data-e2e="feed-active-video"]';
    const workMutationRelevant = (record) => {
      const changed = Array.from(record && record.addedNodes || [])
        .concat(Array.from(record && record.removedNodes || []))
        .filter((node) => node && node.nodeType === 1);
      if (changed.some((node) => {
        const element = workNode(node);
        try {
          return !!(element && element.matches && element.matches(workActivitySelector))
            || !!(element && element.querySelector && element.querySelector(workActivitySelector));
        } catch (e) { return false; }
      })) return true;
      for (const state of states.values()) {
        if (within(record && record.target, state.scope) || changed.some((node) => within(node, state.scope))) return true;
      }
      return false;
    };
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== adapter.id || !Store.getSetting('enabled') || !Store.getSetting('showQuickBlock')) return;
      if ((records || []).some(workMutationRelevant)) requestRefresh(false);
    });
    PageRouteSignals.subscribe((nextUrl) => {
      lastWorkUrl = nextUrl || location.href;
      requestRefresh(true);
    });
    workLoop = createPageLoop(() => {
      if (!refreshRequested) return;
      refreshRequested = false;
      refresh();
    }, 1800,
      () => refreshRequested && Store.getSetting('enabled') && Store.getSetting('showQuickBlock'));
    workLoop.wake();
    const refreshAfterDomReady = () => requestRefresh(true);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshAfterDomReady, { once: true });
    } else {
      refreshAfterDomReady();
    }
    Store.onChange(() => { requestRefresh(true); });
    refreshWorkBlock = () => { requestRefresh(true); };
    requestRefresh(true);
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
      // 虚拟列表会复用同一个 DOM 节点承载不同评论；仅按节点编号去重会把
      // 后来的作者误并入第一次观察到的评论。身份/楼号也必须参与实例键。
      return 'node:' + id + '|' + (info.keys || []).join('|') + '|' + (info.threadId || '') + '|' + (info.level || 'root');
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
    FloatingDock.release('legacy-douyin-comment-manager');
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
    FloatingDock.hold('legacy-douyin-comment-manager');
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
  let commentManagerMutationUnsubscribe = null;
  let commentManagerGeneration = 0;
  let commentManagerAbortController = null;
  function platformLabelForCommentManager(adapter) {
    return ({ bilibili: 'B站', douyin: '抖音', weibo: '微博' }[adapter && adapter.id]) || '评论';
  }
  function closeCommentManager(reason) {
    commentManagerGeneration++;
    if (commentManagerAbortController) {
      try { commentManagerAbortController.abort(); } catch (e) {}
      pageSessionAbortControllers.delete(commentManagerAbortController);
      commentManagerAbortController = null;
    }
    const platform = commentManagerRoot && commentManagerRoot.getAttribute('data-ob-platform') || 'unknown';
    if (commentManagerMutationUnsubscribe) commentManagerMutationUnsubscribe();
    commentManagerMutationUnsubscribe = null;
    if (commentManagerKeyHandler) document.removeEventListener('keydown', commentManagerKeyHandler);
    commentManagerKeyHandler = null;
    if (commentManagerRoot) commentManagerRoot.remove();
    commentManagerRoot = null;
    FloatingDock.release('comment-manager');
    if (platform !== 'unknown') EventLog.record('ui.comment-manager.close', { platform, reason: reason || 'user' }, { immediate: true });
  }

  async function openCommentManager(adapter, anchorEl) {
    if (commentManagerRoot) { closeCommentManager('toggle'); return; }
    const manager = adapter && adapter.commentManager;
    if (!document.body || !manager || typeof manager.collectRecords !== 'function') {
      EventLog.record('ui.comment-manager.rejected', { platform: adapter && adapter.id || 'unknown', reasonCode: 'unavailable' }, { immediate: true });
      return;
    }
    if (typeof manager.available === 'function' && !manager.available()) {
      EventLog.record('ui.comment-manager.rejected', { platform: adapter.id, reasonCode: 'no-records' }, { immediate: true });
      showToast('当前页面没有可识别的评论');
      return;
    }
    let initialRecords = [];
    try { initialRecords = manager.collectRecords('manager') || []; }
    catch (error) { EventLog.recordError('ui.comment-manager.collect', error, { platform: adapter.id }); }
    if (!initialRecords.length) {
      EventLog.record('ui.comment-manager.rejected', { platform: adapter.id, reasonCode: 'no-records' }, { immediate: true });
      showToast('当前页面没有可识别的评论');
      return;
    }
    const managerGeneration = ++commentManagerGeneration;
    const managerPageGeneration = pageSessionGeneration;
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    commentManagerAbortController = abortController;
    if (abortController) pageSessionAbortControllers.add(abortController);
    const selected = new Set();
    // 记录按“评论实例”保存，而不是每次 render 都把当前 DOM 快照 append 到数组。
    // 否则搜索、全选和加载进度会让同一批评论在内存中重复累积，虚拟列表页面
    // 运行时间越长越慢。实例键同时包含节点身份、评论身份和楼号，兼容节点复用。
    const discovered = new Map();
    let discoveredTruncated = false;
    const mergeDiscovered = (records) => {
      for (const raw of Array.isArray(records) ? records : []) {
        const info = normalizeCommentRecord(raw, raw && raw.source || 'dom');
        if (!info) continue;
        const key = commentRecordInstanceKey(info);
        const existing = discovered.get(key);
        if (!existing) {
          // 管理器缓存只保留身份和展示元数据，不保留虚拟列表节点引用；
          // 否则节点被平台回收后，Map 仍会把整棵旧 DOM 子树留在内存里。
          discovered.set(key, { ...info, container: null, root: null });
          while (discovered.size > COMMENT_MANAGER_RECORD_LIMIT) {
            const oldest = discovered.keys().next().value;
            if (oldest == null) break;
            discovered.delete(oldest);
            discoveredTruncated = true;
          }
          continue;
        }
        const keys = normalizeIdentityKeys([...(existing.keys || []), ...(info.keys || [])]);
        if (keys.length) existing.keys = keys;
        if (!existing.label && info.label) existing.label = info.label;
        if (info.note && (!existing.note || info.ctime > existing.ctime)) existing.note = info.note;
        if (info.ctime > existing.ctime) existing.ctime = info.ctime;
        if (!existing.threadId && info.threadId) existing.threadId = info.threadId;
        if (info.commentId && !existing.commentId) existing.commentId = info.commentId;
      }
    };
    mergeDiscovered(initialRecords);
    let pageKey = '';
    let searchText = '';
    let loading = false;
    let partial = false;
    let partialReason = '';
    let collectionDirty = false;
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
    FloatingDock.hold('comment-manager');
    EventLog.record('ui.comment-manager.open', { platform: adapter.id, anchor: !!anchorEl }, { immediate: true });
    const close = (reason) => closeCommentManager(reason || 'user');
    const isCurrent = () => commentManagerGeneration === managerGeneration
      && pageSessionGeneration === managerPageGeneration
      && commentManagerRoot === panel && panel.isConnected
      && (!abortController || !abortController.signal.aborted);
    panel.querySelector('.ob-cm-close').onclick = () => close('button');
    panel.addEventListener('click', (event) => { if (event.target === panel) close('backdrop'); });
    commentManagerKeyHandler = (event) => { if (event.key === 'Escape') close('escape'); };
    document.addEventListener('keydown', commentManagerKeyHandler);

    const keyOf = (info) => (info && info.keys || []).join('|');
    const currentPageKey = () => typeof adapter.videoKey === 'function'
      ? adapter.videoKey() : location.pathname + location.search + location.hash;
    const collectCurrent = () => {
      const nextKey = currentPageKey();
      if (pageKey && nextKey !== pageKey) {
        EventLog.record('ui.comment-manager.page-change', { platform: adapter.id, selected: selected.size }, { immediate: true });
        discovered.clear(); selected.clear(); partial = false; partialReason = ''; discoveredTruncated = false;
        collectionDirty = true;
      }
      pageKey = nextKey;
      if (collectionDirty) {
        let records = [];
        try { records = manager.collectRecords('manager') || []; }
        catch (error) { records = []; EventLog.recordError('ui.comment-manager.collect', error, { platform: adapter.id }); }
        mergeDiscovered(records);
        collectionDirty = false;
      }
      return mergeCommentRecords(Array.from(discovered.values())).filter((info) => !Index.isBlocked(info.keys));
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

    // 评论区通常由虚拟列表持续复用节点。管理器打开期间只记录“平台 DOM 有变化”，
    // 把实际 collect 延迟到下一次用户刷新/渲染；不在每个 MutationObserver 批次里
    // 重新深扫整页，也不让管理器自身的列表重绘把脏标记反复唤醒。
    const mutationElement = (node) => {
      if (!node) return null;
      if (node.nodeType === 1) return node;
      return node.host || node.parentElement || null;
    };
    const isManagerNode = (node) => {
      const element = mutationElement(node);
      return !!(element && (element === panel || panel.contains(element)));
    };
    commentManagerMutationUnsubscribe = PageMutationSignals.subscribe((records, adapterId) => {
      if (!isCurrent() || adapterId !== adapter.id) return;
      for (const record of records || []) {
        const changed = Array.from(record.addedNodes || [])
          .concat(Array.from(record.removedNodes || []));
        // body/document 上只新增了管理器自己的 UI 时忽略；平台目标或平台节点变化
        // 则只留下脏标记，下一次 render 会合并一次 collect。
        if (isManagerNode(record.target) || (changed.length && changed.every(isManagerNode))) continue;
        collectionDirty = true;
        break;
      }
    });

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
      if (!isCurrent()) {
        closeCommentManager('page-session-changed');
        return;
      }
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
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(key); else selected.delete(key);
          EventLog.record('ui.comment-manager.select', { platform: adapter.id, checked: checkbox.checked, selected: selected.size });
          render();
        });
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
      if (discoveredTruncated) notices.push('已达到本地记录上限 ' + COMMENT_MANAGER_RECORD_LIMIT + ' 条');
      if (loading) notices.push('正在读取…');
      if (filtered.unknown) notices.push('时间未知 ' + filtered.unknown + ' 位已跳过');
      status.textContent = notices.join('；') || (allRecords.length ? '已显示当前路由内已识别的评论作者' : '');
    }

    async function loadAllRecords() {
      if (!isCurrent() || loading || typeof manager.loadAll !== 'function') return;
      EventLog.record('ui.comment-manager.load.start', { platform: adapter.id, discovered: discovered.size }, { immediate: true });
      loading = true; loadAll.disabled = true; refresh.disabled = true; render();
      try {
        const result = await manager.loadAll((progress) => {
          if (!isCurrent()) return;
          const collected = progress && (progress.collected != null ? progress.collected : progress.records);
          EventLog.record('ui.comment-manager.load.progress', {
            platform: adapter.id,
            collected: Number(collected) || 0,
            page: Number(progress && progress.page) || 0,
            phase: progress && progress.phase || 'unknown',
          });
          status.textContent = '正在加载评论' + (collected != null ? '，已读取 ' + collected + ' 条' : '…');
          // DOM 型加载器会在滚动/展开后产生新节点；下一次 render 只重新
          // 收集一次，再由 Map 去重，不在每个列表行渲染时重复深扫。
          collectionDirty = true;
          render();
        }, abortController ? { signal: abortController.signal } : undefined);
        if (!isCurrent()) {
          runtimeDiagnostic('commentManagerCancelledLoads');
          return;
        }
        mergeDiscovered(result && result.records || []);
        collectionDirty = false;
        partial = !!(result && result.partial);
        partialReason = String(result && result.reason || '').slice(0, 160);
        if (discoveredTruncated) {
          partial = true;
          partialReason = [partialReason, '已达到本地评论管理器安全记录上限 ' + COMMENT_MANAGER_RECORD_LIMIT + ' 条']
            .filter(Boolean).join('；').slice(0, 160);
        }
        EventLog.record('ui.comment-manager.load.finish', { platform: adapter.id, discovered: discovered.size, partial }, { immediate: true });
      } catch (error) {
        if (!isCurrent()) {
          runtimeDiagnostic('commentManagerCancelledLoads');
          return;
        }
        partial = true;
        partialReason = String(error && error.message || error).slice(0, 160);
        EventLog.recordError('ui.comment-manager.load', error, { platform: adapter.id });
      }
      if (isCurrent()) {
        loading = false; loadAll.disabled = false; refresh.disabled = false; render();
      }
    }

    search.oninput = () => {
      searchText = search.value;
      EventLog.record('ui.comment-manager.search', { platform: adapter.id, hasQuery: !!searchText.trim(), queryLength: searchText.trim().length });
      render();
    };
    sinceSelect.onchange = () => {
      customSince = 0;
      EventLog.record('ui.comment-manager.time-filter', { platform: adapter.id, preset: sinceSelect.value || 'all' });
      render();
    };
    refresh.onclick = () => {
      partial = false; partialReason = '';
      collectionDirty = true;
      EventLog.record('ui.comment-manager.refresh', { platform: adapter.id }, { immediate: true });
      render(); status.textContent = '已刷新当前已识别评论';
    };
    checkAll.onchange = () => {
      const records = filterRecords(collectCurrent()).records;
      for (const info of records) { const key = keyOf(info); if (checkAll.checked) selected.add(key); else selected.delete(key); }
      EventLog.record('ui.comment-manager.select-all', { platform: adapter.id, checked: checkAll.checked, selected: selected.size, visible: records.length }, { immediate: true });
      render();
    };
    batch.onclick = () => {
      const records = filterRecords(collectCurrent()).records.filter((info) => selected.has(keyOf(info)));
      if (!records.length) return;
      const suffix = partial ? '（部分加载，可能仍有未读取评论）' : '';
      EventLog.record('ui.comment-manager.batch', { platform: adapter.id, selected: records.length, partial }, { immediate: true });
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
    if (!manager || typeof manager.loadThread !== 'function') {
      EventLog.record('ui.thread.rejected', { platform: adapter && adapter.id || 'unknown', reasonCode: 'unsupported' }, { immediate: true });
      showToast('当前平台不支持楼操作'); return;
    }
    const info = providedInfo || (typeof adapter.menuContextInfo === 'function'
      ? adapter.menuContextInfo(anchorEl) : identifyFromAnchor(anchorEl));
    const item = info && info.container;
    if (!info || !info.keys || !info.keys.length || !item
      || (typeof manager.isRootComment === 'function' && !manager.isRootComment(item))) {
      EventLog.record('ui.thread.rejected', { platform: adapter.id, reasonCode: 'not-root-or-no-identity' }, { immediate: true });
      showToast('只能从可确认的主评论执行“屏蔽该楼回复”');
      return;
    }
    if (pendingThreadBlocks.has(item)) {
      EventLog.record('ui.thread.rejected', { platform: adapter.id, reasonCode: 'already-loading' });
      return;
    }
    pendingThreadBlocks.add(item);
    const threadGeneration = pageSessionGeneration;
    const threadUrl = location.href;
    const threadAbortController = typeof AbortController === 'function' ? new AbortController() : null;
    if (threadAbortController) pageSessionAbortControllers.add(threadAbortController);
    const isThreadCurrent = () => threadGeneration === pageSessionGeneration && location.href === threadUrl
      && item.isConnected && (!threadAbortController || !threadAbortController.signal.aborted);
    EventLog.record('ui.thread.load.start', { platform: adapter.id }, { immediate: true });
    showToast('正在读取该楼已可加载的回复…');
    let partial = false; let reason = '';
    const records = [normalizeCommentRecord({ ...info, level: 'root', source: 'dom' })].filter(Boolean);
    try {
      const result = await manager.loadThread(item, (progress) => {
        if (!isThreadCurrent()) return;
        EventLog.record('ui.thread.load.progress', {
          platform: adapter.id, collected: Number(progress && progress.collected) || 0,
          page: Number(progress && progress.page) || 0,
        });
        if (progress && progress.collected != null) showToast('正在读取该楼回复：' + progress.collected + ' 条');
      }, threadAbortController ? { signal: threadAbortController.signal } : undefined);
      if (!isThreadCurrent()) {
        runtimeDiagnostic('threadCancelledLoads');
        EventLog.record('ui.thread.load.cancel', { platform: adapter.id, reason: 'page-session-changed' });
        return;
      }
      for (const record of (result && result.records || [])) records.push(record);
      partial = !!(result && result.partial);
      reason = String(result && result.reason || '').slice(0, 160);
      EventLog.record('ui.thread.load.finish', { platform: adapter.id, records: records.length, partial }, { immediate: true });
    } catch (error) {
      if (!isThreadCurrent()) {
        runtimeDiagnostic('threadCancelledLoads');
        EventLog.record('ui.thread.load.cancel', { platform: adapter.id, reason: 'page-session-changed' }, { immediate: true });
        return;
      }
      partial = true;
      reason = String(error && error.message || error).slice(0, 160);
      EventLog.recordError('ui.thread.load', error, { platform: adapter.id });
    } finally {
      pendingThreadBlocks.delete(item);
      if (threadAbortController) pageSessionAbortControllers.delete(threadAbortController);
    }
    const merged = mergeCommentRecords(records);
    if (!merged.length) {
      EventLog.record('ui.thread.empty', { platform: adapter.id }, { immediate: true });
      showToast('没有读取到可靠的楼成员'); return;
    }
    const suffix = partial ? '（部分：已加载 ' + merged.length + ' 位，可能仍有未加载回复' + (reason ? '；' + reason : '') + '）' : '';
    EventLog.record('ui.thread.prepare', { platform: adapter.id, records: merged.length, partial }, { immediate: true });
    blockMany(merged, anchorEl, '屏蔽该楼及 ' + merged.length + ' 位作者' + suffix, null,
      '该楼及 ' + merged.length + ' 位作者' + suffix);
  }

  let douyinDanmakuTool = null;
  let douyinDanmakuManager = null;
  let douyinDanmakuManagerKeyHandler = null;
  // 弹幕时间轴扫描可能跨越多个面板生命周期；关闭管理器时由当前会话
  // 注销它，避免面板消失后仍继续暂停/拖动播放器。
  let cancelDouyinDanmakuScan = null;

  function closeDouyinDanmakuManager(reason) {
    const wasOpen = !!douyinDanmakuManager;
    if (cancelDouyinDanmakuScan) {
      try { cancelDouyinDanmakuScan(reason || 'manager-close'); } catch (e) {}
    }
    if (douyinDanmakuManagerKeyHandler) document.removeEventListener('keydown', douyinDanmakuManagerKeyHandler);
    douyinDanmakuManagerKeyHandler = null;
    if (douyinDanmakuManager) douyinDanmakuManager.remove();
    douyinDanmakuManager = null;
    FloatingDock.release('douyin-danmaku-manager');
    if (wasOpen) EventLog.record('ui.douyin-danmaku.close', { reason: reason || 'user' }, { immediate: true });
  }

  // 抖音弹幕节点会持续滚动和复用；这里累积当前视频本轮已观察到的可靠发送者，
  // 再用本地多选面板一次提交。它不读取平台私有接口，也不把没有身份属性的节点列入名单。
  function setupDouyinDanmakuManager() {
    const adapter = currentAdapter;
    if (!adapter || adapter.id !== 'douyin'
      || (typeof adapter.collectDanmaku !== 'function' && typeof adapter.getObservedDanmakuRecords !== 'function')) return;
    const records = new Map();
    const selected = new Set();
    let videoKey = '';
    let sessionGeneration = 0;
    let searchText = '';
    let scanRunning = false;
    let scanStatus = '';
    let scanRun = null;
    let refreshRequested = true;
    let refreshLoop = null;
    let playerIdentityGeneration = typeof adapter.videoSessionGeneration === 'function'
      ? Number(adapter.videoSessionGeneration()) || 0 : 0;

    const keyOf = (info) => (info && info.keys || []).join('|');
    const readVideoKey = () => typeof adapter.videoKey === 'function'
      ? adapter.videoKey() : location.pathname + location.search;
    const routePartOfVideoKey = (key) => String(key || '').split('|video:')[0];
    const isSameVideoKeyScope = (left, right) => {
      const a = String(left || '');
      const b = String(right || '');
      if (!a || !b || routePartOfVideoKey(a) !== routePartOfVideoKey(b)) return false;
      // 播放器身份节点可能比路由晚出现，也可能在组件重建的一瞬间暂时消失；
      // 两者都是同一页面作品的身份信息完善/降级，不应取消正在进行的时间轴任务。
      return a === b || a.indexOf('|video:') < 0 || b.indexOf('|video:') < 0;
    };
    const cancelScan = (reason = 'manager-close') => {
      const run = scanRun;
      if (!run) return false;
      run.cancelled = true;
      const currentKey = readVideoKey();
      const sameScope = sessionGeneration === run.generation
        && isSameVideoKeyScope(currentKey, run.key);
      // 扫描会暂停并拖动播放器。只要仍在同一作品，就在取消的瞬间把播放头
      // 和播放状态交还给页面；若作品已切换，则不触碰新播放器。
      if (sameScope && run.video && run.video.isConnected) {
        try { run.video.currentTime = run.originalTime; } catch (e) {}
        if (run.wasPlaying) {
          try { const playing = run.video.play(); if (playing && playing.catch) playing.catch(() => {}); } catch (e) {}
        }
      }
      scanRunning = false;
      scanRun = null;
      runtimeDiagnostic('douyinDanmakuCancelledScans');
      EventLog.record('ui.douyin-danmaku.scan.cancel', {
        reason: String(reason || 'manager-close').slice(0, 48), sameScope,
      }, { immediate: true });
      return true;
    };
    cancelDouyinDanmakuScan = cancelScan;
    const resetForVideo = (nextVideoKey) => {
      const nextGeneration = typeof adapter.videoSessionGeneration === 'function'
        ? Number(adapter.videoSessionGeneration()) || 0 : playerIdentityGeneration;
      const identityGenerationChanged = nextGeneration !== playerIdentityGeneration;
      playerIdentityGeneration = nextGeneration;
      if (!videoKey) { videoKey = nextVideoKey; refreshRequested = true; return false; }
      // 精选流可能一直保持同一路由，且播放器先给出“无身份”的路由键；
      // 若之后发生了明确的播放器身份变更，再补出新 video key 时不能把旧视频
      // 的观察记录当作同一作品继续累积。普通弹幕节点插入不会递增该代数。
      const identityChangedToSpecific = identityGenerationChanged
        && nextVideoKey && nextVideoKey.indexOf('|video:') >= 0
        && (!videoKey || videoKey.indexOf('|video:') < 0 || nextVideoKey !== videoKey);
      if (identityChangedToSpecific) {
        videoKey = nextVideoKey;
        refreshRequested = true;
        sessionGeneration++;
        records.clear(); selected.clear();
        searchText = '';
        scanStatus = '';
        if (scanRun) scanRun.cancelled = true;
        scanRun = null;
        scanRunning = false;
        closeDouyinDanmakuManager('video-change');
        return true;
      }
      // 页面初始化时播放器可能晚于脚本出现：先得到纯路由键，随后才补出
      // `|video:<id>`。这是同一作品的身份键完善，不应取消正在进行的管理器/时间轴任务。
      if (nextVideoKey && videoKey && isSameVideoKeyScope(nextVideoKey, videoKey)) {
        if (nextVideoKey.indexOf('|video:') >= 0) videoKey = nextVideoKey;
        return false;
      }
      if (nextVideoKey === videoKey) return false;
      videoKey = nextVideoKey;
      refreshRequested = true;
      sessionGeneration++;
      records.clear(); selected.clear();
      searchText = '';
      scanStatus = '';
      if (scanRun) scanRun.cancelled = true;
      scanRun = null;
      scanRunning = false;
      closeDouyinDanmakuManager('video-change');
      return true;
    };
    const requestManagerRefresh = (immediate = false) => {
      refreshRequested = true;
      // DOM 弹幕节点可能连续滚动/复用；只在面板已打开时提前唤醒，且仍由
      // createPageLoop 合并同一批变化，关闭面板时不把 Map 复制工作带入热路径。
      if (immediate && refreshLoop) refreshLoop.wake();
    };
    const collectRecords = () => {
      resetForVideo(readVideoKey());
      const scope = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
      const observed = typeof adapter.getObservedDanmakuRecords === 'function'
        ? adapter.getObservedDanmakuRecords()
        : adapter.collectDanmaku(scope || document) || [];
      for (const info of observed) {
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
      while (records.size > 5000) records.delete(records.keys().next().value);
      return Array.from(records.values()).map((info) => ({
        ...info,
        blockedKeys: (info.keys || []).filter((key) => Index.has(key)),
        autoBlockedKeys: typeof adapter.isDanmakuAutoBlocked === 'function' && adapter.isDanmakuAutoBlocked(info.keys)
          ? (info.keys || []).filter((key) => !DanmakuExemptions.isExempt('douyin', [key])) : [],
      }));
    };

    function render(availableOverride) {
      const panel = douyinDanmakuManager;
      if (!panel || !panel.isConnected) return;
      const available = Array.isArray(availableOverride) ? availableOverride : collectRecords();
      // collectRecords() 可能在本次渲染中发现播放器已切到下一个视频并关闭旧面板；
      // 不能继续向已移除的旧节点写 DOM，也不能让旧面板的事件回调复活它。
      if (douyinDanmakuManager !== panel || !panel.isConnected) return;
      const availableKeys = new Set(available.map(keyOf));
      const blockedKeys = new Set(available.filter((info) => info.blockedKeys.length).map(keyOf));
      for (const key of Array.from(selected)) if (!availableKeys.has(key) || blockedKeys.has(key)) selected.delete(key);
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
        const isBlocked = info.blockedKeys.length > 0;
        const isAutoBlocked = info.autoBlockedKeys.length > 0;
        const row = document.createElement('label');
        row.className = 'ob-dd-row' + (isBlocked ? ' ob-dd-blocked' : '') + (isAutoBlocked ? ' ob-dd-auto' : '');
        row.setAttribute('data-key', key);
        row.setAttribute('data-ob-dd-state', isBlocked ? 'blocked' : 'active');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !isBlocked && selected.has(key);
        checkbox.disabled = isBlocked;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(key); else selected.delete(key);
          EventLog.record('ui.douyin-danmaku.select', { checked: checkbox.checked, selected: selected.size });
          render();
        });
        const body = document.createElement('div');
        const name = document.createElement('div'); name.className = 'ob-dd-name';
        name.textContent = info.label || '抖音弹幕发送者';
        const note = document.createElement('div'); note.className = 'ob-dd-note';
        note.textContent = (info.note || '当前视频弹幕') + ' · 观察到 ' + (Number(info.messageCount) || 1) + ' 条'
          + (isBlocked ? ' · 已屏蔽' : '') + (isAutoBlocked ? ' · 自动规则命中' : '');
        body.append(name, note);
        const actions = document.createElement('div'); actions.className = 'ob-dd-actions';
        if (isBlocked) {
          const unblock = document.createElement('button');
          unblock.type = 'button'; unblock.className = 'ob-dd-unblock';
          unblock.textContent = isAutoBlocked ? '恢复并例外' : '取消屏蔽';
          unblock.title = isAutoBlocked
            ? '恢复该发送者，并让抖音自动规则以后跳过它'
            : '取消该发送者的本地屏蔽';
          unblock.setAttribute('aria-label', unblock.title);
          unblock.setAttribute('data-ob-dd-action', isAutoBlocked ? 'exception' : 'unblock');
          unblock.addEventListener('click', (event) => {
            event.stopPropagation(); event.preventDefault();
            EventLog.record('ui.douyin-danmaku.unblock', { autoException: isAutoBlocked }, { immediate: true });
            const exemption = isAutoBlocked ? DanmakuExemptions.add('douyin', info.keys) : { added: [] };
            const result = unblockIdentityGroup(info.blockedKeys);
            if (!result.removed) {
              if (!exemption.added.length) {
                showToast('未找到可取消的本地屏蔽身份');
                return;
              }
              // 运行时自动隐藏节点可能尚未经过下一轮定时扫描；恢复动作必须即时可见。
              try { adapter.scanAutoDanmaku(); } catch (e) {}
              showToast('已恢复该发送者，并加入抖音自动规则例外；可在设置中恢复规则作用');
              refresh();
              render();
              return;
            }
            try { adapter.scanAutoDanmaku(); } catch (e) {}
            showToast(isAutoBlocked
              ? '已恢复该发送者，并加入抖音自动规则例外；可在设置中恢复规则作用'
              : '已取消屏蔽：' + (info.label || '抖音弹幕发送者'));
            refresh();
            render();
          });
          actions.appendChild(unblock);
        }
        row.append(checkbox, body, actions); list.appendChild(row);
      }
      const checkAll = panel.querySelector('.ob-dd-checkall input');
      const selectable = filtered.filter((info) => !info.blockedKeys.length);
      checkAll.checked = !!selectable.length && selectable.every((info) => selected.has(keyOf(info)));
      checkAll.indeterminate = !checkAll.checked && selectable.some((info) => selected.has(keyOf(info)));
      checkAll.onchange = () => {
        for (const info of selectable) {
          const key = keyOf(info);
          if (checkAll.checked) selected.add(key); else selected.delete(key);
        }
        EventLog.record('ui.douyin-danmaku.select-all', { checked: checkAll.checked, selected: selected.size, visible: selectable.length }, { immediate: true });
        render();
      };
      const selectedRecords = available.filter((info) => !info.blockedKeys.length && selected.has(keyOf(info)));
      const batch = panel.querySelector('.ob-dd-batch');
      batch.disabled = !selectedRecords.length;
      batch.textContent = '屏蔽选中(' + selectedRecords.length + ')';
      batch.onclick = () => {
        const current = collectRecords().filter((info) => !info.blockedKeys.length && selected.has(keyOf(info)));
        if (!current.length) return;
        EventLog.record('ui.douyin-danmaku.batch', { selected: current.length }, { immediate: true });
        blockMany(current, batch, '屏蔽选中的 ' + current.length + ' 位抖音弹幕发送者', () => {
          selected.clear(); render(); refresh();
        });
      };
      const totalMessages = filtered.reduce((sum, info) => sum + (Number(info.messageCount) || 1), 0);
      const blockedCount = filtered.filter((info) => info.blockedKeys.length).length;
      panel.querySelector('.ob-dd-status').textContent = scanStatus
        || (filtered.length + ' 位发送者 · 观察到 ' + totalMessages + ' 条弹幕'
          + (blockedCount ? ' · 已屏蔽 ' + blockedCount + ' 位' : ''));
      const scan = panel.querySelector('.ob-dd-scan');
      scan.disabled = scanRunning;
      scan.textContent = scanRunning ? '扫描中…' : '尽量加载弹幕';
    }

    const managerPlayerSelector = '.basePlayerContainer, .playerContainer, [data-e2e="video-player"], [data-e2e="feed-active-video"], [data-e2e-vid], [data-video-id], [data-item-id]';
    const managerPlayerIdentityAttributes = new Set([
      'class', 'data-e2e', 'data-e2e-vid', 'data-video-id', 'data-item-id',
    ]);
    const managerMutationParent = (node) => {
      if (!node) return null;
      if (node.parentElement) return node.parentElement;
      const root = node.getRootNode && node.getRootNode();
      return root && root.host ? root.host : null;
    };
    const managerNodeMatchesPlayerRoot = (node) => {
      const current = node && node.nodeType === 1 ? node : managerMutationParent(node);
      if (!current || !current.matches) return false;
      try { return current.matches(managerPlayerSelector); } catch (e) { return false; }
    };
    const mutationChangesManagerPlayer = (record) => {
      if (!record) return false;
      const target = record.target && record.target.nodeType === 1
        ? record.target : managerMutationParent(record.target);
      if (record.type === 'attributes') {
        if (!managerPlayerIdentityAttributes.has(record.attributeName)) return false;
        return managerNodeMatchesPlayerRoot(target);
      }
      if (record.type !== 'childList') return false;
      // 仅播放器根本身的结构或根节点替换会触发管理器刷新；弹幕条目在
      // 根内部持续插入时不需要每条都复制一次发送者 Map。
      if (managerNodeMatchesPlayerRoot(target)) return true;
      return Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []))
        .some(managerNodeMatchesPlayerRoot);
    };
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== 'douyin') return;
      const relevant = (records || []).some(mutationChangesManagerPlayer);
      if (relevant) requestManagerRefresh(false);
    });
    if (document.addEventListener) {
      for (const type of ['play', 'pause', 'ended', 'loadedmetadata']) {
        document.addEventListener(type, () => requestManagerRefresh(true), true);
      }
      const refreshAfterDomReady = () => {
        refreshRequested = true;
        refresh();
        requestManagerRefresh(false);
      };
      document.addEventListener('DOMContentLoaded', refreshAfterDomReady, { once: true });
      if (document.readyState !== 'loading') setTimeout(refreshAfterDomReady, 0);
    }

    async function scanDanmakuTimeline() {
      if (scanRunning) {
        EventLog.record('ui.douyin-danmaku.scan.rejected', { reasonCode: 'already-running' });
        return;
      }
      resetForVideo(readVideoKey());
      const scope = typeof adapter.danmakuRoot === 'function' ? adapter.danmakuRoot() : document;
      const video = querySelectorAllDeep(scope || document, 'video')[0]
        || querySelectorAllDeep(document, 'video')[0];
      const duration = Number(video && video.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) {
        EventLog.record('ui.douyin-danmaku.scan.rejected', { reasonCode: 'duration-unavailable' }, { immediate: true });
        scanStatus = '播放器尚未提供可扫描的总时长';
        render();
        return;
      }
      let requestedKey = readVideoKey();
      const requestedGeneration = sessionGeneration;
      const originalTime = Number(video.currentTime) || 0;
      const wasPlaying = !video.paused && !video.ended;
      const run = {
        key: requestedKey,
        generation: requestedGeneration,
        cancelled: false,
        video,
        originalTime,
        wasPlaying,
      };
      scanRun = run;
      const sampleCount = Math.min(60, Math.max(6, Math.ceil(duration / 15)));
      let completed = 0;
      scanRunning = true;
      EventLog.record('ui.douyin-danmaku.scan.start', { sampleCount }, { immediate: true });
      scanStatus = '正在扫描弹幕时间轴 0/' + sampleCount + '…';
      render();
      const sessionIsCurrent = () => {
        const currentKey = readVideoKey();
        if (!isSameVideoKeyScope(currentKey, requestedKey)) {
          resetForVideo(currentKey);
          return false;
        }
        if (currentKey !== requestedKey) {
          resetForVideo(currentKey);
          if (currentKey.indexOf('|video:') >= 0) requestedKey = currentKey;
        }
        const current = scanRun === run && !run.cancelled && sessionGeneration === requestedGeneration;
        return current;
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
          const available = collectRecords();
          completed = index + 1;
          scanStatus = '正在扫描弹幕时间轴 ' + completed + '/' + sampleCount + '…';
          render(available);
        }
      } finally {
        const currentKey = readVideoKey();
        if (!isSameVideoKeyScope(currentKey, requestedKey)) {
          resetForVideo(currentKey);
          return;
        }
        if (currentKey !== requestedKey) {
          resetForVideo(currentKey);
          if (currentKey.indexOf('|video:') >= 0) requestedKey = currentKey;
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
        EventLog.record('ui.douyin-danmaku.scan.finish', { completed, sampleCount, cancelled: completed < sampleCount }, { immediate: true });
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
      FloatingDock.hold('douyin-danmaku-manager');
      EventLog.record('ui.douyin-danmaku.open', {}, { immediate: true });
      panel.querySelector('.ob-dd-close').onclick = () => closeDouyinDanmakuManager('button');
      panel.addEventListener('click', (event) => { if (event.target === panel) closeDouyinDanmakuManager('backdrop'); });
      const search = panel.querySelector('.ob-dd-search');
      search.value = searchText;
      search.oninput = () => {
        searchText = search.value;
        EventLog.record('ui.douyin-danmaku.search', { hasQuery: !!searchText.trim(), queryLength: searchText.trim().length });
        render();
      };
      panel.querySelector('.ob-dd-scan').onclick = () => {
        EventLog.record('ui.douyin-danmaku.scan.request', {}, { immediate: true });
        void scanDanmakuTimeline();
      };
      douyinDanmakuManagerKeyHandler = (event) => { if (event.key === 'Escape') closeDouyinDanmakuManager('escape'); };
      document.addEventListener('keydown', douyinDanmakuManagerKeyHandler);
      document.body.appendChild(panel);
      refreshRequested = true;
      refresh();
    }

    function refresh() {
      const video = typeof adapter.isVideoPage === 'function' ? adapter.isVideoPage() : /^\/video\//i.test(location.pathname);
      if (!document.body) { refreshRequested = true; return; }
      refreshRequested = false;
      const visible = Store.getSetting('enabled') && Store.getSetting('showBulkBlock') && video;
      if (!douyinDanmakuTool) {
        if (!document.body) return;
        douyinDanmakuTool = document.createElement('button');
        douyinDanmakuTool.id = 'ob-douyin-dm-tool'; douyinDanmakuTool.type = 'button';
        douyinDanmakuTool.title = '管理当前视频已观察到的抖音弹幕发送者';
        douyinDanmakuTool.setAttribute('aria-label', '管理当前视频已观察到的抖音弹幕发送者');
        douyinDanmakuTool.onclick = open;
        document.body.appendChild(douyinDanmakuTool);
      }
      if (!visible) {
        douyinDanmakuTool.style.setProperty('display', 'none', 'important');
        FloatingDock.sync();
        if (douyinDanmakuManager) closeDouyinDanmakuManager('hidden');
        return;
      }
      const available = collectRecords();
      douyinDanmakuTool.textContent = '🚫 抖音弹幕屏蔽(' + available.length + ')';
      douyinDanmakuTool.style.setProperty('display', 'inline-flex', 'important');
      FloatingDock.sync();
      if (douyinDanmakuManager) render(available);
    }

    refreshLoop = createPageLoop(() => {
      const nextKey = readVideoKey();
      if (nextKey !== videoKey) refreshRequested = true;
      if (refreshRequested && !scanRunning) refresh();
      if (Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin')
        && typeof adapter.scanAutoDanmaku === 'function') adapter.scanAutoDanmaku(false);
    }, 1800, () => Store.getSetting('enabled')
      && (Store.getSetting('showBulkBlock') || DanmakuRules.hasEnabled('douyin')));
    Store.onChange(() => {
      refreshRequested = true;
      refresh();
      if (Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin')
        && typeof adapter.scanAutoDanmaku === 'function') adapter.scanAutoDanmaku();
      refreshLoop.wake();
    });
    refresh();
    if (Store.getSetting('enabled') && DanmakuRules.hasEnabled('douyin')
      && typeof adapter.scanAutoDanmaku === 'function') adapter.scanAutoDanmaku();
    refreshLoop.wake();
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
  function closeBulkScopePanel(reason) {
    if (closeBulkScopeKeyHandler) {
      document.removeEventListener('keydown', closeBulkScopeKeyHandler);
      closeBulkScopeKeyHandler = null;
    }
    const existing = $('#ob-bulk-scope');
    if (existing) {
      const platform = existing.getAttribute('data-ob-platform') || 'unknown';
      existing.remove();
      EventLog.record('ui.bulk-scope.close', { platform, reason: reason || 'user' }, { immediate: true });
    }
    FloatingDock.release('bulk-scope');
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
    closeBulkScopePanel('replace');
    const panel = document.createElement('div');
    panel.id = 'ob-bulk-scope';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '批量拉黑范围');
    panel.setAttribute('data-ob-platform', adapter && adapter.id || 'unknown');
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
      EventLog.record('ui.bulk-scope.time-filter', { platform: adapter.id, preset: select.value || 'all' });
    };
    panel.querySelectorAll('input[name="ob-bs-range"]').forEach((input) => {
      input.onchange = () => EventLog.record('ui.bulk-scope.range', { platform: adapter.id, range: input.value, checked: input.checked });
    });
    panel.querySelector('.ob-bs-no').onclick = () => closeBulkScopePanel('cancel-button');
    const keyHandler = (event) => {
      if (event.key !== 'Escape') return;
      closeBulkScopePanel('escape');
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
    FloatingDock.hold('bulk-scope');
    EventLog.record('ui.bulk-scope.open', { platform: adapter && adapter.id || 'unknown', unit }, { immediate: true });

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
      if (sinceResult.error) {
        EventLog.record('ui.bulk-scope.rejected', { platform: adapter.id, reasonCode: 'invalid-time-filter' }, { immediate: true });
        status.textContent = sinceResult.error; return;
      }
      const wantAll = panel.querySelector('input[name="ob-bs-range"]:checked').value === 'all';
      EventLog.record('ui.bulk-scope.load.start', { platform: adapter.id, range: wantAll ? 'all' : 'loaded', hasSince: !!sinceResult.since }, { immediate: true });
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
            EventLog.record('ui.bulk-scope.load.progress', {
              platform: adapter.id,
              collected: Number(progress && progress.collected) || 0,
              total: Number(progress && progress.total) || 0,
            });
          });
          records = result.records || [];
          partial = !!result.partial;
          EventLog.record('ui.bulk-scope.load.finish', { platform: adapter.id, records: records.length, partial }, { immediate: true });
        } else {
          records = collectUsers(document);
          EventLog.record('ui.bulk-scope.load.finish', { platform: adapter.id, records: records.length, partial: false }, { immediate: true });
        }
      } catch (e) {
        status.textContent = '加载失败：' + String(e && e.message || e).slice(0, 80);
        EventLog.recordError('ui.bulk-scope.load', e, { platform: adapter.id });
        ok.disabled = false;
        return;
      }
      if (!panel.isConnected) return;
      const filtered = filterRecordsSince(records, sinceResult.since);
      const list = uniqueUsers(filtered.kept);
      if (!list.length) {
        EventLog.record('ui.bulk-scope.empty', { platform: adapter.id, partial, dropped: filtered.dropped, unknown: filtered.unknown }, { immediate: true });
        status.textContent = sinceResult.since ? '该时间之后没有可拉黑的' + unit : '没有可拉黑的' + unit;
        ok.disabled = false;
        return;
      }
      const notes = [];
      if (sinceResult.since) notes.push('已按时间排除 ' + filtered.dropped + ' 位');
      if (filtered.unknown) notes.push('缺少时间的 ' + filtered.unknown + ' 位已跳过');
      if (partial) notes.push('部分分页未取全');
      EventLog.record('ui.bulk-scope.prepare', {
        platform: adapter.id, records: list.length, partial, dropped: filtered.dropped, unknown: filtered.unknown,
      }, { immediate: true });
      closeBulkScopePanel('submit');
      blockMany(list, anchorEl, '拉黑 ' + list.length + ' 位' + unit + (notes.length ? '（' + notes.join('，') + '）' : ''));
    };
  }

  function setupBulkBlock() {
    const a = currentAdapter; if (!a) return;
    let fab = null;
    const modalButtons = new Set();
    const markedModals = new Set();
    const MODAL_SEL = '[role="dialog"],.modal,.dialog,.Dialog,[class*="Modal"],.bili-modal';
    let refreshRequested = true;
    let bulkLoop = null;
    let commentRecordsCache = [];
    let commentRecordsCacheKey = '';
    let commentRecordsCacheDirty = true;
    const requestRefresh = (immediate = false) => {
      refreshRequested = true;
      if (bulkLoop) bulkLoop.wake(immediate ? 0 : 180);
    };
    const trackModalButton = (button) => { if (button) modalButtons.add(button); return button; };
    const forgetModalButton = (button) => { if (button) modalButtons.delete(button); };
    const trackModal = (modal) => { if (modal) markedModals.add(modal); return modal; };
    const forgetModal = (modal) => { if (modal) markedModals.delete(modal); };
    const setFabVisible = (visible) => {
      if (fab) fab.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      FloatingDock.sync();
      // 入口消失（关闭功能、切换页面、原生弹窗打开）时不留悬挂面板。
      if (!visible) { closeBulkScopePanel('hidden'); closeCommentManager('hidden'); if (a.id === 'douyin') closeDouyinCommentManager(); }
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
    function modalNodes(modals) {
      return Array.isArray(modals) ? modals : querySelectorAllDeep(document, MODAL_SEL);
    }
    // 弹窗常被前端复用：节点先以 display:none 挂在页面上，打开时只改 style/class。
    // 不把 style 属性加入主扫描器的全页面观察列表，避免抖音播放器等高频样式变化
    // 重新进入热路径；只对已发现的少量弹窗根节点做属性级观察。
    const watchedModalNodes = new Set();
    const modalAttributeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
        if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) return;
        if ((records || []).some((record) => record && record.target && record.target.isConnected)) requestRefresh(true);
      })
      : null;
    function watchModalNodes(modals) {
      if (!modalAttributeObserver) return;
      for (const modal of modalNodes(modals)) {
        if (!modal || !modal.isConnected || (modal.id && /^ob-/.test(modal.id)) || watchedModalNodes.has(modal)) continue;
        try {
          modalAttributeObserver.observe(modal, {
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'open'],
          });
          watchedModalNodes.add(modal);
        } catch (e) {}
      }
      for (const modal of Array.from(watchedModalNodes)) {
        if (modal.isConnected) continue;
        try { modalAttributeObserver.unobserve(modal); } catch (e) {}
        watchedModalNodes.delete(modal);
      }
    }
    function hasOpenModal(modals) {
      return modalNodes(modals).some((el) => isVisible(el)
        && !isOwnBulkPanel(el) && blocksPageBulkFab(el));
    }
    function commentRecordsForFab() {
      const manager = a.commentManager;
      if (!manager || typeof manager.collectRecords !== 'function') return [];
      const routeKey = location.pathname + location.search + location.hash;
      if (commentRecordsCacheKey !== routeKey) {
        commentRecordsCacheKey = routeKey;
        commentRecordsCacheDirty = true;
      }
      if (!commentRecordsCacheDirty) return commentRecordsCache;
      let raw = [];
      try { raw = manager.collectRecords('manager') || []; }
      catch (error) {
        EventLog.recordError('ui.bulk-fab.comment-collect', error, { platform: a.id });
      }
      // 这里缓存的是已经合并的纯展示元数据，不保留评论 DOM；平台虚拟列表回收后，
      // 缓存不会把旧节点和整棵子树继续留在内存里。相关 DOM 变化由下方共享信号
      // 重新置脏，用户点击/手动刷新也会立即唤醒。
      commentRecordsCache = mergeCommentRecords(raw)
        .filter((info) => !Index.isBlocked(info.keys));
      commentRecordsCacheDirty = false;
      return commentRecordsCache;
    }
    function refreshFab(modals) {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) { setFabVisible(false); return; }
      let commentMode = false;
      let commentRecords = [];
      let commentRoute = false;
      if (a.commentManager && typeof a.commentManager.collectRecords === 'function') {
        commentRoute = !a.commentManager.available || a.commentManager.available();
        if (commentRoute) {
          commentRecords = commentRecordsForFab();
          commentMode = commentRecords.length > 0;
        }
      }
      // 评论路由没有可靠记录时不再重复调用 collectUsers（它通常就是同一份深扫）；
      // 非评论路由才转向卡片/用户列表批量入口。
      const n = commentMode ? commentRecords.length : (commentRoute ? 0 : collectUsers(document).length);
      // 页面批量按钮不应遮住举报/登录等原生弹窗，更不能显示无意义的“(0)”。
      // 抖音视频评论侧栏本身使用 LookModalFrameFast/Modal 类名，但它就是当前
      // 评论管理器的承载面；评论模式下必须保留入口，否则真实评论已加载却永远
      // 看不到“评论屏蔽”按钮。普通无评论的 Modal 仍由 hasOpenModal() 遮挡。
      const modalBlocksFab = hasOpenModal(modals) && !(a.id === 'douyin' && commentMode);
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
            EventLog.record('ui.bulk-fab.open-comment-manager', { platform: a.id }, { immediate: true });
            openCommentManager(a, fab); return;
          }
          // 支持整区抓取的平台先问范围与时间；其余平台保持原有的直接批量行为。
          if (a.bulkScope && typeof a.bulkScope.fetchAll === 'function') {
            EventLog.record('ui.bulk-fab.open-scope', { platform: a.id }, { immediate: true });
            openBulkScopePanel(a, fab); return;
          }
          const list = collectUsers(document);
          if (!list.length) {
            EventLog.record('ui.bulk-fab.empty', { platform: a.id }, { immediate: true });
            showToast('本页没有可拉黑的用户'); return;
          }
          EventLog.record('ui.bulk-fab.prepare', { platform: a.id, users: list.length }, { immediate: true });
          blockMany(list, fab);
        };
        const mountFab = () => {
          if (fab.isConnected) return;
          if (!document.body) return;
          document.body.appendChild(fab);
        };
        if (document.body) mountFab();
        else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFab, { once: true });
      }
      fab.textContent = commentMode
        ? '🚫 ' + platformLabelForCommentManager(a) + '评论屏蔽(' + n + ')'
        : (a.bulkFabLabel ? a.bulkFabLabel(n) : '🚫 拉黑本页用户(' + n + ')');
      setFabVisible(true);
    }
    function tryModal(modal) {
      let btn = Array.from(modal.children || []).find((child) => child.matches && child.matches('.ob-bulk[data-ob-kind="modal"]')) || null;
      if (btn) trackModalButton(btn);
      // 评论区已经有统一的可多选管理器时，旧版通用“拉黑全部”条会造成两个入口，
      // 且可能遮挡平台评论内容。适配器通过 isScope 明确声明哪些 Modal 是评论承载层；
      // 命中时同时清理历史注入的按钮和标记，其他用户列表 Modal 仍保留原有入口。
      let managedCommentScope = false;
      try {
        managedCommentScope = !!(a.commentManager && typeof a.commentManager.isScope === 'function'
          && a.commentManager.isScope(modal));
      } catch (error) { managedCommentScope = false; }
      if (managedCommentScope) {
        if (btn) { forgetModalButton(btn); btn.remove(); }
        forgetModal(modal);
        modal.removeAttribute('data-ob-bulk');
        return;
      }
      if (modal.hasAttribute('data-ob-bulk') && !isVisible(modal)) {
        // 弹窗被隐藏后复用（微博点赞/转发列表就是同一个节点反复显示）时，
        // 必须先清掉上一次的控件；此时按钮可能已被前端重绘删掉。
        if (btn) { forgetModalButton(btn); btn.remove(); }
        forgetModal(modal);
        modal.removeAttribute('data-ob-bulk');
        return;
      }
      const allowed = (!a.canBulkModal || a.canBulkModal(modal));
      const users = collectUsers(modal, 'modal');
      if (!allowed || !users.length) {
        if (btn) { forgetModalButton(btn); btn.remove(); }
        forgetModal(modal);
        modal.removeAttribute('data-ob-bulk');
        return;
      }
      modal.setAttribute('data-ob-bulk', '1');
      trackModal(modal);
      if (!btn) {
        btn = document.createElement('button'); btn.type = 'button';
        btn.className = 'ob-bulk'; btn.setAttribute('data-ob-kind', 'modal');
        btn.onclick = () => blockMany(collectUsers(modal, 'modal'), btn);
        const header = modal.querySelector('header,.modal-header,.dialog-header,.head,.title') || modal.firstElementChild;
        if (header && header.parentNode) header.parentNode.insertBefore(btn, header);
        else modal.insertBefore(btn, modal.firstChild);
        trackModalButton(btn);
      }
      btn.textContent = '🚫 拉黑全部(' + users.length + ')';
    }
    function clearModalControls() {
      for (const button of modalButtons) if (button && button.isConnected) button.remove();
      for (const modal of markedModals) if (modal && modal.isConnected) modal.removeAttribute('data-ob-bulk');
      modalButtons.clear();
      markedModals.clear();
    }
    function scanModals(modals) {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) { clearModalControls(); return; }
      for (const md of modalNodes(modals)) {
        if (isOwnBulkPanel(md)) continue;
        tryModal(md);
      }
    }
    function refreshAll() {
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) {
        setFabVisible(false);
        clearModalControls();
        return;
      }
      // 一次刷新共享同一份弹窗列表，避免 refreshFab/scanModals 各自再次穿透整页。
      const modals = modalNodes();
      watchModalNodes(modals);
      refreshFab(modals);
      scanModals(modals);
    }
    const activityNode = (node) => {
      if (!node) return null;
      return node.nodeType === 1 ? node : (node.host || node.parentElement || null);
    };
    const activitySelector = MODAL_SEL
      + ',#relatedVideoCard,[data-e2e="comment-item"],.comment-item,.card-review[comment_id]'
      + ',.wbpro-list,.item1,.item2,bili-comment-thread-renderer,bili-comment-renderer'
      + ',bili-comment-reply-renderer,bili-sub-comment-renderer';
    const isModalActivity = (node) => {
      let current = activityNode(node);
      for (let guard = 0; current && guard < 16; guard++) {
        if (current.matches) {
          try { if (current.matches(MODAL_SEL)) return true; } catch (e) {}
        }
        current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }
      return false;
    };
    const isBulkActivity = (node) => {
      let current = activityNode(node);
      for (let guard = 0; current && guard < 16; guard++) {
        if (current.matches) {
          try {
            if (current.matches(activitySelector)) return true;
          } catch (e) {}
        }
        current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }
      return false;
    };
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== a.id || !Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) return;
      const relevant = (records || []).filter((record) => isBulkActivity(record && record.target)
        || Array.from(record && record.addedNodes || []).some(isBulkActivity)
        || Array.from(record && record.removedNodes || []).some(isBulkActivity));
      if (!relevant.length) return;
      if (a.commentManager && typeof a.commentManager.collectRecords === 'function'
        && (a.commentManager.available == null || a.commentManager.available())) {
        commentRecordsCacheDirty = true;
      }
      const modalChanged = relevant.some((record) => isModalActivity(record && record.target)
        || Array.from(record && record.addedNodes || []).some(isModalActivity)
        || Array.from(record && record.removedNodes || []).some(isModalActivity));
      // 首批评论刚出现时入口尚未创建，必须立即补一次；入口已经存在时，评论
      // 虚拟化变化用 180ms 防抖合并，避免每条评论重绘都触发整页深扫。
      requestRefresh(modalChanged || !fab);
    });
    document.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.some(isBulkActivity)) requestRefresh(true);
    }, true);
    // 弹窗/评论内容变化时按需刷新；请求处理完即停止计时，空闲页面不再周期
    // 唤醒，也不再重复收集同一份评论元数据。
    bulkLoop = createPageLoop(() => {
      if (!refreshRequested) return;
      refreshRequested = false;
      refreshAll();
    }, 1800,
      () => refreshRequested && Store.getSetting('enabled') && Store.getSetting('showBulkBlock'));
    // 用户脚本可能在 document.body/Shadow DOM 建立之前执行；主扫描器会负责
    // 后续动态变化，但解析期的首批评论/弹窗不应依赖某个观察器恰好先挂上。
    // DOMContentLoaded 是一次性的页面就绪信号，只唤醒已有低频循环，不新增观察器。
    const refreshAfterDomReady = () => {
      // document-start 时 ShadowRoot 可能尚未建立，首轮缓存只能得到空结果；
      // DOM 就绪是一次可靠的补发现边界，必须同时使评论缓存失效。
      commentRecordsCacheDirty = true;
      requestRefresh(true);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshAfterDomReady, { once: true });
    } else {
      refreshAfterDomReady();
    }
    refreshAll();
    refreshRequested = false;
    bulkLoop.wake();
    refreshBulkBlock = () => { requestRefresh(true); };
    Store.onChange(() => {
      commentRecordsCacheDirty = true;
      if (!Store.getSetting('enabled') || !Store.getSetting('showBulkBlock')) {
        // 与快速入口相同：active=false 时循环不会自唤醒，关闭设置必须直接
        // 完成一次可见 UI 清理，再让循环在重新开启时恢复正常门控。
        refreshRequested = false;
        setFabVisible(false);
        clearModalControls();
        return;
      }
      requestRefresh(true);
    });
    RuntimeResources.add(() => {
      if (modalAttributeObserver) modalAttributeObserver.disconnect();
      watchedModalNodes.clear();
      if (bulkLoop) bulkLoop.stop();
      clearModalControls();
      if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
      fab = null;
      commentRecordsCache = [];
    });
  }

  // ====================================================================
  // 6. B站弹幕过滤（MAIN world 拦截 seg.so + CRC32 正向映射）
  // ====================================================================
  // 作品级入口需要读取同一页当前弹幕会话中已经解析出的发送者。默认空实现
  // 保证非 B 站页面和未建立弹幕会话时不会产生跨平台/跨页面数据。
  let biliWorkDanmakuRecords = () => [];
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
    // 动态视频只有在页面状态能给出可靠 CID 时才进入弹幕会话；普通动态不应
    // 因为路由相似而错误请求/继承另一页的弹幕。动态评论仍由作品作用域自行处理。
    const isVideoPage = () => /^\/video\/[^/?]+/i.test(location.pathname)
      || (/^\/opus\/\d+/i.test(location.pathname) && !!cidFromPageState());
    const numericCid = (value) => {
      const cid = String(value == null ? '' : value).trim();
      return /^\d+$/.test(cid) && cid !== '0' ? cid : '';
    };

    let blockedHashCache = null;
    let exemptionHashCache = null;
    function blockedHashes() {
      if (blockedHashCache) return new Set(blockedHashCache);
      const set = new Set();
      // 评论 UID 和弹幕 mid_hash 是两种可独立保存的身份。CRC 结果必须补齐 8 位。
      const all = Store.allIdentities();
      for (const key of all) {
        const m = key.match(/^bili:uid:(\d+)$/);
        if (m) set.add(crc32(m[1]).toString(16).padStart(8, '0'));
        const hash = key.match(/^bili:dmhash:([0-9a-f]{1,8})$/i);
        if (hash) set.add(normalHash(hash[1]));
      }
      blockedHashCache = set;
      return new Set(set);
    }

    // 一个弹幕 hash 可能来自直接保存的 hash，也可能只是某个已保存 B站 UID 的 CRC32 映射。
    // 取消屏蔽时优先使用直接 hash；UID 映射只有在当前 hash 恰好对应唯一已保存 UID 时才自动移除，
    // 多 UID 碰撞必须留给设置面板逐个处理，避免“取消一行”误删另一个人的本地屏蔽。
    function blockedIdentityKeysForHashes(hashes) {
      const targets = new Set((hashes || []).map((hash) => normalHash(hash)).filter(Boolean));
      const directByHash = new Map();
      const uidByHash = new Map();
      for (const key of Store.allIdentities()) {
        const direct = key.match(/^bili:dmhash:([0-9a-f]{1,8})$/i);
        if (direct) {
          const hash = normalHash(direct[1]);
          if (targets.has(hash)) {
            const list = directByHash.get(hash) || [];
            list.push(key);
            directByHash.set(hash, list);
          }
          continue;
        }
        const uid = key.match(/^bili:uid:(\d+)$/);
        if (!uid) continue;
        const hash = normalHash(crc32(uid[1]).toString(16));
        if (!targets.has(hash)) continue;
        const list = uidByHash.get(hash) || [];
        list.push(key);
        uidByHash.set(hash, list);
      }
      const keys = [];
      let ambiguous = false;
      for (const hash of targets) {
        for (const key of directByHash.get(hash) || []) keys.push(key);
        const uids = uidByHash.get(hash) || [];
        if (uids.length === 1) keys.push(uids[0]);
        else if (uids.length > 1) ambiguous = true;
      }
      return { keys: normalizeIdentityKeys(keys), ambiguous };
    }

    function isBiliDmHashExempt(hash) {
      const normalized = normalHash(hash);
      if (!normalized) return false;
      if (!exemptionHashCache) {
        exemptionHashCache = new Set();
        // 设置导入可能只保留了已确认 UID；把它映射到 hash 只用于跳过自动规则，
        // 不会因此反向声称 hash 已经能证明 UID 身份。映射结果缓存到下一次
        // Store 变更，避免每条弹幕重复遍历例外列表。
        for (const key of DanmakuExemptions.keysFor('bili')) {
          const direct = key.match(/^bili:dmhash:([0-9a-f]{1,8})$/i);
          if (direct) {
            const directHash = normalHash(direct[1]);
            if (directHash) exemptionHashCache.add(directHash);
            continue;
          }
          const uid = key.match(/^bili:uid:(\d+)$/);
          if (uid) exemptionHashCache.add(normalHash(crc32(uid[1]).toString(16)));
        }
      }
      return exemptionHashCache.has(normalized);
    }

    function currentBlockedHashes() {
      const set = blockedHashes();
      for (const hash of Array.from(set)) if (isBiliDmHashExempt(hash)) set.delete(hash);
      if (Store.getSetting('enabled') && DanmakuRules.hasEnabled('bili')) {
        for (const hash of dmAutoBlockedHashes) if (!isBiliDmHashExempt(hash)) set.add(hash);
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
    const dmProgressKeysByContent = new Map();
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
    const DM_UID_LOOKUP_LIMIT = 5000;
    const DM_UID_CARD_CACHE_LIMIT = 5000;
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
    const DM_AUTO_UID_LIMIT = 64;
    const dmAutoSeenMessages = new Set();
    const dmAutoBlockedHashes = new Set();
    const dmAutoHashQueue = new Map();
    const dmAutoUidQueue = new Map();
    const dmAutoUidStates = new Map();
    let dmAutoHashTimer = 0;
    let dmAutoUidTimer = 0;
    let dmAutoUidLookups = 0;
    let dmAutoGeneration = 0;
    let dmAutoRuleSignature = '';
    let dmPanelScanRequested = true;
    let dmFloatingScanRequested = true;
    let dmToolRefreshRequested = true;
    let biliDmLoop = null;
    let dmAutoStatus = {
      matchedMessages: 0,
      matchedHashes: 0,
      linkedUids: 0,
      hashOnly: 0,
      unidentifiable: 0,
      uidLimit: 0,
    };
    function requestDmPanelScan(immediate = false) {
      dmPanelScanRequested = true;
      if (immediate && biliDmLoop) biliDmLoop.wake();
    }
    function requestFloatingDmScan(immediate = false) {
      dmFloatingScanRequested = true;
      if (immediate && biliDmLoop) biliDmLoop.wake();
    }
    function requestDmToolRefresh(immediate = false) {
      dmToolRefreshRequested = true;
      if (immediate && biliDmLoop) biliDmLoop.wake();
    }
    function cleanDmText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function autoDmRuleNote(content, match) {
      const rules = match && match.rules || [];
      const summary = rules.slice(0, 3).map((rule) => (
        (rule.kind === 'regex' ? '正则' : '关键词') + '「' + String(rule.pattern || '').slice(0, 80) + '」'
      )).join('、') || '当前规则';
      return 'B站弹幕自动屏蔽：' + summary + '；代表弹幕：' + cleanDmText(content).slice(0, 360);
    }
    function resetDmAutoState() {
      if (dmAutoHashTimer) clearTimeout(dmAutoHashTimer);
      dmAutoHashTimer = 0;
      if (dmAutoUidTimer) clearTimeout(dmAutoUidTimer);
      dmAutoUidTimer = 0;
      if (dmAutoUidQueue) dmAutoUidQueue.clear();
      if (dmAutoHashQueue) dmAutoHashQueue.clear();
      if (dmAutoUidStates) dmAutoUidStates.clear();
      dmAutoSeenMessages.clear();
      dmAutoBlockedHashes.clear();
      dmAutoUidLookups = 0;
      dmAutoGeneration++;
      dmAutoStatus = {
        matchedMessages: 0,
        matchedHashes: 0,
        linkedUids: 0,
        hashOnly: 0,
        unidentifiable: 0,
        uidLimit: 0,
      };
    }
    function scheduleAutoBiliUidFlush() {
      if (dmAutoUidTimer || !dmAutoUidQueue.size) return;
      dmAutoUidTimer = setTimeout(() => {
        dmAutoUidTimer = 0;
        flushAutoBiliUidQueue();
      }, 0);
    }
    function scheduleAutoBiliHashFlush() {
      if (dmAutoHashTimer || !dmAutoHashQueue.size) return;
      dmAutoHashTimer = setTimeout(() => {
        dmAutoHashTimer = 0;
        const generation = dmAutoGeneration;
        const entries = Array.from(dmAutoHashQueue.values());
        dmAutoHashQueue.clear();
        if (generation !== dmAutoGeneration || !entries.length) return;
        const existing = Store.allIdentities();
        const groups = entries
          .filter((entry) => entry && entry.hash && !isBiliDmHashExempt(entry.hash)
            && !existing.has(makeIdentityKey('bili:dmhash', entry.hash)))
          .map((entry) => ({
            keys: [makeIdentityKey('bili:dmhash', entry.hash)],
            label: 'B站弹幕自动规则',
            note: entry.note,
          }));
        if (groups.length) Store.addIdentityGroups(groups);
        for (const entry of entries) queueAutoBiliUidLookup(entry.hash, entry.content, entry.match);
      }, 0);
    }
    function queueAutoBiliHash(hash, content, match) {
      const normalized = normalHash(hash);
      if (!normalized || !match || isBiliDmHashExempt(normalized)) return false;
      const isNew = !dmAutoBlockedHashes.has(normalized);
      dmAutoBlockedHashes.add(normalized);
      if (isNew) dmAutoStatus.matchedHashes++;
      dmAutoHashQueue.set(normalized, {
        hash: normalized,
        content: cleanDmText(content),
        match,
        note: autoDmRuleNote(content, match),
      });
      scheduleAutoBiliHashFlush();
      return true;
    }
    function queueAutoBiliContent(content, hashes, match) {
      if (!Store.getSetting('enabled') || !DanmakuRules.hasEnabled('bili') || !match) return false;
      const list = Array.from(new Set((hashes || []).map(normalHash).filter(Boolean)));
      if (!list.length) {
        dmAutoStatus.unidentifiable++;
        return true;
      }
      for (const hash of list) queueAutoBiliHash(hash, content, match);
      return true;
    }
    function queueAutoBiliUidLookup(hash, content, match) {
      const normalized = normalHash(hash);
      if (!normalized || isBiliDmHashExempt(normalized) || dmAutoUidStates.has(normalized) || dmAutoUidQueue.has(normalized)) return;
      if (dmAutoUidLookups + dmAutoUidQueue.size >= DM_AUTO_UID_LIMIT) {
        dmAutoStatus.uidLimit++;
        return;
      }
      dmAutoUidQueue.set(normalized, { hash: normalized, content, match });
      scheduleAutoBiliUidFlush();
    }
    function flushAutoBiliUidQueue() {
      if (!dmAutoUidQueue.size) return;
      const generation = dmAutoGeneration;
      const entries = Array.from(dmAutoUidQueue.values());
      dmAutoUidQueue.clear();
      const run = (async () => {
        const links = [];
        for (const entry of entries) {
          if (generation !== dmAutoGeneration || !Store.getSetting('enabled') || !DanmakuRules.hasEnabled('bili')) return;
          if (isBiliDmHashExempt(entry.hash)) continue;
          dmAutoUidLookups++;
          dmAutoUidStates.set(entry.hash, { status: 'loading' });
          let candidates = [];
          try { candidates = crackUidHash(entry.hash); } catch (e) { candidates = []; }
          if (candidates.length !== 1) {
            dmAutoStatus.hashOnly++;
            dmAutoUidStates.set(entry.hash, { status: 'hash-only', candidateCount: candidates.length });
            continue;
          }
          try {
            const card = await requestDmUidCard(candidates[0]);
            if (!card || generation !== dmAutoGeneration || isBiliDmHashExempt(entry.hash)) {
              dmAutoStatus.hashOnly++;
              dmAutoUidStates.set(entry.hash, { status: 'hash-only', candidateCount: candidates.length });
              continue;
            }
            links.push({
              keys: [makeIdentityKey('bili:dmhash', entry.hash), makeIdentityKey('bili:uid', card.uid)],
              label: card.name,
              note: 'B站弹幕自动规则命中；hash 唯一反查并经用户卡片正向校验 UID。代表弹幕：' + cleanDmText(entry.content).slice(0, 320),
            });
            dmAutoStatus.linkedUids++;
            dmAutoUidStates.set(entry.hash, { status: 'linked', uid: card.uid });
          } catch (e) {
            dmAutoStatus.hashOnly++;
            dmAutoUidStates.set(entry.hash, { status: 'hash-only', candidateCount: candidates.length });
          }
        }
        if (generation === dmAutoGeneration && links.length) Store.addIdentityGroups(links);
      })();
      // 不让未捕获的网络/实现异常变成页面级 unhandledrejection；hash 身份已经在前一批提交。
      Promise.resolve(run).catch(() => {});
    }
    function applyAutoRulesToObservedDanmaku() {
      if (!Store.getSetting('enabled') || !DanmakuRules.hasEnabled('bili')) return;
      for (const sender of dmSenders.values()) {
        if (isBiliDmHashExempt(sender.hash)) continue;
        const match = DanmakuRules.match('bili', sender.content);
        if (match) queueAutoBiliContent(sender.content, [sender.hash], match);
      }
    }
    function autoDanmakuStatus() {
      resetDmSessionIfNeeded();
      return {
        enabled: Store.getSetting('enabled') && DanmakuRules.hasEnabled('bili'),
        ruleCount: DanmakuRules.rulesFor('bili').filter((rule) => rule.enabled).length,
        observedSenders: dmSenders.size,
        matchedMessages: dmAutoStatus.matchedMessages,
        matchedHashes: dmAutoStatus.matchedHashes,
        linkedUids: dmAutoStatus.linkedUids,
        hashOnly: dmAutoStatus.hashOnly,
        unidentifiable: dmAutoStatus.unidentifiable,
        uidLimit: dmAutoStatus.uidLimit,
      };
    }
    biliDanmakuAutoStatus = autoDanmakuStatus;
    function resolveFloatingDanmakuHashes(content, progress) {
      const text = cleanDmText(content);
      if (!text) return [];
      const hashes = dmByContent.get(text);
      if (!hashes || !hashes.size) return [];
      // 播放器浮动弹幕与弹幕列表都只显示到秒，因此毫秒级精确匹配会把同一秒内的
      // 不同发送者误判成唯一身份。这里按显示粒度（±1s）收集候选，多于一个即视为歧义。
      if (progress < 0) return Array.from(hashes);
      const nearby = new Set();
      const progressKeys = dmProgressKeysByContent.get(text) || [];
      for (const key of progressKeys) {
        const timedHashes = dmByProgress.get(key);
        if (!timedHashes) continue;
        const divider = key.indexOf('\x1f');
        if (divider < 0) continue;
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
      if (!dmVideoKey) { dmVideoKey = key; dmAutoStatus.videoKey = key; return false; }
      if (key === dmVideoKey) return false;
      dmVideoKey = key;
      dmByContent.clear(); dmByProgress.clear(); dmProgressKeysByContent.clear(); dmSenders.clear(); dmContentGroups.clear(); dmSeenElements.clear();
      dmLoadedSegments.clear(); dmSegmentPromises.clear(); dmSegmentRetryAt.clear();
      selectedDmGroups.clear(); expandedDmUidGroups.clear();
      dmSearch = ''; dmPage = 0;
      // 候选状态只属于当前视频；旧视频尚未完成的异步请求会在自己的 Promise
      // 中自然结束，但不应继续占用当前会话的查找 Map。
      dmUidLookups.clear();
      resetDmAutoState();
      dmAutoStatus.videoKey = key;
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
        const progressKeys = dmProgressKeysByContent.get(content) || new Set();
        progressKeys.add(key); dmProgressKeysByContent.set(content, progressKeys);
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
      if (dmByContent.size > 5000 || dmByProgress.size > 10000) {
        dmByContent.clear(); dmByProgress.clear(); dmProgressKeysByContent.clear();
      }
    }

    function copyRange(out, buf, start, end) {
      for (let i = start; i < end; i++) out.push(buf[i]);
    }
    function filterSeg(bytes, segmentIndex) {
      const buf = new Uint8Array(bytes);
      const blocked = currentBlockedHashes();
      const autoEnabled = Store.getSetting('enabled') && DanmakuRules.hasEnabled('bili');
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
          const autoMatch = autoEnabled && !isBiliDmHashExempt(elem.hash)
            ? DanmakuRules.match('bili', elem.content) : null;
          const autoFingerprint = (elem.hash || '') + '\x1f' + String(elem.progress) + '\x1f' + cleanDmText(elem.content);
          const autoSeen = dmAutoSeenMessages.has(autoFingerprint);
          if (autoMatch && !autoSeen) {
            if (dmAutoSeenMessages.size >= 20000) dmAutoSeenMessages.delete(dmAutoSeenMessages.values().next().value);
            dmAutoSeenMessages.add(autoFingerprint);
            dmAutoStatus.matchedMessages++;
            queueAutoBiliContent(elem.content, elem.hash ? [elem.hash] : [], autoMatch);
          }
          rememberDanmaku(elem);
          if ((autoMatch && autoMatch.text) || (elem.hash && (blocked.has(elem.hash)
            || (autoEnabled && dmAutoBlockedHashes.has(elem.hash) && !isBiliDmHashExempt(elem.hash))))) {
            changed = true; p = elemEnd; continue;
          }
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
      // protobuf 解析位于页面弹幕请求热路径；UI 只标记脏状态并排入共享低频循环，
      // 不在播放器读取响应的同步调用栈里再次深扫 DOM。
      requestDmPanelScan(true);
      requestFloatingDmScan(true);
      requestDmToolRefresh(true);
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
      const autoEnabled = DanmakuRules.hasEnabled('bili');
      if (!isVideoPage() || dmSenders.size || dmBootstrapPromise
        || (!Store.getSetting('showQuickBlock') && !autoEnabled)) return;
      if (dmBootstrapTimer) clearTimeout(dmBootstrapTimer);
      dmBootstrapTimer = setTimeout(() => {
        dmBootstrapTimer = 0;
        ensureDmBootstrap(false);
      }, Math.max(0, Number(delay) || 0));
    }

    function ensureDmBootstrap(force) {
      resetDmSessionIfNeeded();
      const autoEnabled = DanmakuRules.hasEnabled('bili');
      if (!isVideoPage() || !Store.getSetting('enabled') || (!Store.getSetting('showQuickBlock') && !autoEnabled)) return;
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
        if (currentVideoKey() === requestKey) requestDmPanelScan(true);
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
      const addContentCandidates = (content, hashes, candidates) => {
        if (at >= 0) {
          const progressKeys = dmProgressKeysByContent.get(content) || [];
          for (const key of progressKeys) {
            const timedHashes = dmByProgress.get(key);
            if (!timedHashes) continue;
            const divider = key.indexOf('\x1f');
            if (divider < 0) continue;
            if (inWindow(Number(key.slice(0, divider)))) for (const hash of timedHashes) candidates.add(hash);
          }
        } else for (const hash of hashes) candidates.add(hash);
      };
      const collect = (accepts, exactContent = null) => {
        const candidates = new Set();
        if (exactContent !== null) {
          const hashes = dmByContent.get(exactContent);
          if (hashes) addContentCandidates(exactContent, hashes, candidates);
          return candidates;
        }
        for (const [content, hashes] of dmByContent) {
          if (!accepts(content)) continue;
          addContentCandidates(content, hashes, candidates);
        }
        return candidates;
      };
      let candidates = new Set();
      if (cell.title) candidates = collect((content) => content === cell.title, cell.title);
      if (!candidates.size && cell.text) {
        candidates = collect((content) => content === cell.text || content.startsWith(cell.text));
      }
      if (!candidates.size && rowText) {
        candidates = collect((content) => rowText.includes(content));
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
      return Array.from(dmSenders.values())
        .sort((a, b) => (a.progress < 0 ? Number.MAX_SAFE_INTEGER : a.progress) - (b.progress < 0 ? Number.MAX_SAFE_INTEGER : b.progress));
    }

    function availableDmGroups() {
      resetDmSessionIfNeeded();
      const blocked = currentBlockedHashes();
      const autoBlocked = Store.getSetting('enabled') && DanmakuRules.hasEnabled('bili')
        ? new Set(Array.from(dmAutoBlockedHashes).filter((hash) => !isBiliDmHashExempt(hash))) : new Set();
      return Array.from(dmContentGroups.values())
        .map((group) => ({
          content: group.content,
          progress: group.progress,
          messageCount: group.messageCount,
          hashes: Array.from(group.hashes).filter((hash) => dmSenders.has(hash)),
        }))
        .filter((group) => group.hashes.length)
        .map((group) => {
          const blockedHashesForGroup = group.hashes.filter((hash) => blocked.has(hash));
          const activeHashes = group.hashes.filter((hash) => !blocked.has(hash));
          const autoBlockedHashes = group.hashes.filter((hash) => autoBlocked.has(hash));
          const unblockInfo = blockedIdentityKeysForHashes(blockedHashesForGroup);
          return {
            ...group,
            blockedHashes: blockedHashesForGroup,
            activeHashes,
            autoBlockedHashes,
            unblockKeys: unblockInfo.keys,
            unblockAmbiguous: unblockInfo.ambiguous,
            ruleExceptionKeys: normalizeIdentityKeys([
              ...autoBlockedHashes.map((hash) => makeIdentityKey('bili:dmhash', hash)),
              ...unblockInfo.keys,
            ]),
            fullyBlocked: blockedHashesForGroup.length === group.hashes.length,
          };
        })
        .sort((a, b) => (a.progress < 0 ? Number.MAX_SAFE_INTEGER : a.progress) - (b.progress < 0 ? Number.MAX_SAFE_INTEGER : b.progress));
    }

    function dmIdentityRecords(groups) {
      const contentByHash = new Map();
      for (const group of groups || []) {
        const hashes = Array.isArray(group.activeHashes) ? group.activeHashes : group.hashes || [];
        for (const hash of hashes) if (!contentByHash.has(hash)) contentByHash.set(hash, group.content);
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

    function unblockBiliDmGroup(group) {
      const keys = group && Array.isArray(group.unblockKeys) ? group.unblockKeys : [];
      const result = unblockIdentityGroup(keys);
      if (!result.removed) {
        showToast(group && group.autoBlockedHashes && group.autoBlockedHashes.length
          ? '该条仍受启用中的自动弹幕规则控制，请在设置中停用或删除规则'
          : group && group.unblockAmbiguous
            ? '该条关联多个可能的 UID，请在设置中逐个取消屏蔽'
          : '未找到可取消的本地屏蔽身份');
        return false;
      }
      showToast('已取消屏蔽：' + ((group && group.content) || 'B站弹幕发送者'));
      refreshDmTool();
      scanDmPanels();
      if (currentScanner) currentScanner.schedule();
      return true;
    }

    function restoreBiliDmGroup(group) {
      const keys = group && Array.isArray(group.ruleExceptionKeys) ? group.ruleExceptionKeys : [];
      if (!keys.length) {
        showToast('没有可保存的可靠弹幕身份，无法建立规则例外');
        return false;
      }
      const exemption = DanmakuExemptions.add('bili', keys);
      const result = unblockIdentityGroup(keys);
      if (!exemption.added.length && !result.removed) {
        showToast('该发送者已经是自动规则例外');
        return false;
      }
      showToast('已恢复该发送者，并加入 B站自动规则例外；可在设置中恢复规则作用');
      refreshDmTool();
      scanDmPanels();
      if (currentScanner) currentScanner.schedule();
      return true;
    }

    function requestDmUidCard(uid) {
      const normalizedUid = normalizeDigits(uid);
      if (!normalizedUid) return Promise.resolve(null);
      if (dmUidCardCache.has(normalizedUid)) {
        const cached = dmUidCardCache.get(normalizedUid);
        // 以最近使用顺序维护有界缓存，避免跨多个视频打开 UID 查询后无限增长。
        dmUidCardCache.delete(normalizedUid);
        dmUidCardCache.set(normalizedUid, cached);
        return cached;
      }
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
      while (dmUidCardCache.size > DM_UID_CARD_CACHE_LIMIT) {
        const oldest = dmUidCardCache.keys().next().value;
        if (oldest == null) break;
        dmUidCardCache.delete(oldest);
      }
      return request;
    }

    async function lookupDmUidCandidates(hash) {
      const previous = dmUidLookups.get(hash);
      if (previous && previous.status === 'ready') return previous;
      if (previous && previous.status === 'loading') return previous.promise;
      const state = { status: 'loading', candidates: [], partial: false, error: '', promise: null };
      dmUidLookups.set(hash, state);
      while (dmUidLookups.size > DM_UID_LOOKUP_LIMIT) {
        const oldest = dmUidLookups.keys().next().value;
        if (oldest == null) break;
        dmUidLookups.delete(oldest);
      }
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
        clearDanmakuExemptionsForManualBlock(keys);
        result = Store.confirmIdentityLink(keys, candidate.name, dmUidLinkNote(content));
      } catch (e) {
        showToast('拉黑失败：' + (e && e.message || e));
        return;
      }
      if (result.rejected) { showToast('无法识别可靠身份'); return; }
      expandedDmUidGroups.delete(content);
      refreshDmTool();
      scanDmPanels();
      showToast((result.persisted === false ? '已在本页生效但未确认落盘：' : '已拉黑：')
        + candidate.name + '（UID ' + candidate.uid + '）' + (result.persisted === false ? '，请重试或导出备份' : ''), result.undo || null);
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
          clearDanmakuExemptionsForManualBlock(keys);
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
      const blockedGroupKeys = new Set(available.filter((group) => group.fullyBlocked).map((group) => group.content));
      for (const content of Array.from(selectedDmGroups)) {
        if (!availableGroupKeys.has(content) || blockedGroupKeys.has(content)) selectedDmGroups.delete(content);
      }
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
        const partiallyBlocked = group.blockedHashes.length > 0 && !group.fullyBlocked;
        row.className = 'ob-dm-sender' + (group.fullyBlocked ? ' ob-dm-blocked' : (partiallyBlocked ? ' ob-dm-partial' : ''));
        row.setAttribute('data-ob-dm-state', group.fullyBlocked ? 'blocked' : (partiallyBlocked ? 'partial' : 'active'));
        row.setAttribute('data-ob-dm-content', group.content);
        row.setAttribute('data-ob-dm-hashes', group.hashes.join(','));
        row.setAttribute('data-ob-dm-blocked-hashes', group.blockedHashes.join(','));

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.className = 'ob-dm-select';
        checkbox.checked = !group.fullyBlocked && selectedDmGroups.has(group.content);
        checkbox.disabled = group.fullyBlocked;
        checkbox.style.display = batchEnabled && !group.fullyBlocked ? '' : 'none';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedDmGroups.add(group.content);
          else selectedDmGroups.delete(group.content);
          renderDmManager();
        });

        const body = document.createElement('div');
        const content = document.createElement('div'); content.className = 'ob-dm-content'; content.textContent = group.content;
        const meta = document.createElement('div'); meta.className = 'ob-dm-meta';
        let stateText = '';
        if (group.fullyBlocked) stateText = ' · 已屏蔽';
        else if (partiallyBlocked) stateText = ' · 已屏蔽 ' + group.blockedHashes.length + '/' + group.hashes.length + ' 位';
        if (group.autoBlockedHashes.length) stateText += ' · 自动规则生效';
        meta.textContent = group.hashes.length + ' 位发送者 · 捕获 ' + group.messageCount + ' 条 · ' + formatDmProgress(group.progress) + stateText;
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

        if (group.blockedHashes.length) {
          const unblock = document.createElement('button');
          const autoBlocked = group.autoBlockedHashes.length > 0;
          unblock.type = 'button'; unblock.className = 'ob-dm-unblock';
          unblock.textContent = autoBlocked ? '恢复并例外' : '取消屏蔽';
          const canUnblock = autoBlocked ? group.ruleExceptionKeys.length > 0 : !group.unblockAmbiguous;
          unblock.disabled = !canUnblock;
          unblock.title = canUnblock
            ? autoBlocked ? '恢复该发送者，并让 B站自动规则以后跳过它' : '取消该弹幕发送者的本地屏蔽'
            : autoBlocked
              ? '没有可保存的可靠身份，无法建立自动规则例外'
              : '该条关联多个可能的 UID，请在设置中逐个取消屏蔽';
          unblock.setAttribute('aria-label', unblock.title);
          unblock.addEventListener('click', (event) => {
            event.stopPropagation(); event.preventDefault();
            if (!canUnblock) return;
            if (autoBlocked) restoreBiliDmGroup(group);
            else unblockBiliDmGroup(group);
          });
          actions.append(uidQuery, unblock);
        } else {
          const single = document.createElement('button');
          single.type = 'button'; single.className = 'ob-dm-single'; single.textContent = '🚫';
          single.title = '本地屏蔽发送此文案的全部未屏蔽用户'; single.setAttribute('aria-label', '本地屏蔽发送此文案的全部未屏蔽用户');
          single.addEventListener('click', (event) => {
            event.stopPropagation(); event.preventDefault();
            blockMany(
              dmIdentityRecords([group]),
              single,
              '屏蔽该文案的 ' + group.activeHashes.length + ' 位发送者',
              () => { selectedDmGroups.delete(group.content); refreshDmTool(); scanDmPanels(); }
            );
          });
          actions.append(uidQuery, single);
        }
        row.append(checkbox, body, actions);
        if (uidExpanded) row.appendChild(buildDmUidResults(group));
        list.appendChild(row);
      }

      const selectAllWrap = dmManager.querySelector('.ob-dm-checkall');
      const selectAll = selectAllWrap.querySelector('input');
      selectAllWrap.style.display = batchEnabled ? 'inline-flex' : 'none';
      const selectablePageItems = pageItems.filter((group) => !group.fullyBlocked);
      selectAll.checked = !!selectablePageItems.length && selectablePageItems.every((group) => selectedDmGroups.has(group.content));
      selectAll.indeterminate = !selectAll.checked && selectablePageItems.some((group) => selectedDmGroups.has(group.content));
      selectAll.onchange = () => {
        for (const group of selectablePageItems) {
          if (selectAll.checked) selectedDmGroups.add(group.content);
          else selectedDmGroups.delete(group.content);
        }
        renderDmManager();
      };

      const selected = available.filter((group) => !group.fullyBlocked && selectedDmGroups.has(group.content));
      const selectedRecords = dmIdentityRecords(selected);
      const batch = dmManager.querySelector('.ob-dm-batch');
      batch.style.display = batchEnabled ? '' : 'none';
      batch.disabled = !selected.length;
      batch.textContent = '屏蔽选中(' + selected.length + '组 / ' + selectedRecords.length + '人)';
      batch.onclick = () => {
        const current = availableDmGroups().filter((group) => !group.fullyBlocked && selectedDmGroups.has(group.content));
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
      const blockedSenderCount = new Set(filtered.flatMap((group) => group.blockedHashes)).size;
      dmManager.querySelector('.ob-dm-status').textContent = filtered.length + ' 组弹幕 · ' + filteredSenderCount + ' 位发送者 · '
        + (dmPage + 1) + '/' + pageCount + (blockedSenderCount ? ' · 已屏蔽 ' + blockedSenderCount + ' 位' : '');
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
      dmToolRefreshRequested = false;
      runtimeDiagnostic('biliDmToolRefreshes');
      resetDmSessionIfNeeded();
      mountDmTool();
      if (!dmTool) return;
      const count = availableDmSenders().length;
      const visible = Store.getSetting('enabled') && Store.getSetting('showQuickBlock') && isVideoPage();
      dmTool.textContent = '🚫 弹幕屏蔽(' + count + ')';
      dmTool.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      FloatingDock.sync();
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
      // 真实鼠标通常同时产生 pointermove 与 mousemove，但自动化/旧式页面有时
      // 只派发其中一类。两类事件共用同一处理器，并在同坐标的短窗口内去重，
      // 兼顾覆盖面和“每帧只做一次坐标命中”。
      let lastMove = { x: NaN, y: NaN, at: 0, type: '' };
      const onMove = (event) => {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (event && event.clientX === lastMove.x && event.clientY === lastMove.y
          && now - lastMove.at < 32 && event.type !== lastMove.type) return;
        lastMove = { x: event && event.clientX, y: event && event.clientY, at: now, type: event && event.type || '' };
        onPlayerPointerMove(event);
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('mousemove', onMove, true);
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
      if (all.length < 2) return all;
      const matched = new Set(all);
      const outer = new Set();
      for (const row of all) {
        for (let parent = row.parentElement; parent && parent !== panel; parent = parent.parentElement) {
          // 当前 row 如果被另一个匹配节点包住，应该淘汰那个外层节点，
          // 保留当前更内层的行；此前把 row 本身加入集合会把按钮挂到 li 上。
          if (matched.has(parent)) outer.add(parent);
        }
      }
      return all.filter((row) => !outer.has(row));
    }
    // 虚拟列表把高度写死在外层 `li` 上（真站为 24px）。隐藏时必须收掉那个 li，
    // 只隐藏内层 `.dm-info-row` 会留下等高空行。
    function dmHideTarget(row) {
      const host = row.closest && row.closest('li.bui-long-list-item');
      return host || row;
    }
    function scanFloatingDanmakuAutoRules() {
      dmFloatingScanRequested = false;
      runtimeDiagnostic('biliDmFloatingScans');
      const enabled = Store.getSetting('enabled') && DanmakuRules.hasEnabled('bili');
      for (const node of document.querySelectorAll(FLOATING_DM_SEL)) {
        const content = cleanDmText(textOf(node));
        const hashes = dmByContent.get(content);
        const applicableHashes = hashes ? Array.from(hashes).filter((hash) => !isBiliDmHashExempt(hash)) : [];
        const match = enabled && (!hashes || applicableHashes.length)
          ? DanmakuRules.match('bili', content) : null;
        if (match) {
          if (applicableHashes.length) queueAutoBiliContent(content, applicableHashes, match);
          setInlineHidden(node, true);
          node.setAttribute('data-ob-dm-auto-blocked', '1');
        } else if (node.getAttribute('data-ob-dm-auto-blocked') === '1') {
          setInlineHidden(node, false);
          node.removeAttribute('data-ob-dm-auto-blocked');
        }
      }
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
      dmPanelScanRequested = false;
      runtimeDiagnostic('biliDmPanelScans');
      const enabled = Store.getSetting('enabled');
      const showButton = enabled && Store.getSetting('showQuickBlock');
      const autoEnabled = enabled && DanmakuRules.hasEnabled('bili');
      const blocked = enabled ? currentBlockedHashes() : new Set();
      const diagnostic = runtimeDiagnostics ? {
        enabled: !!enabled, showButton: !!showButton, autoEnabled: !!autoEnabled,
        blockedCount: blocked.size, rows: 0, withHash: 0, buttons: 0,
        blockedRows: 0, unresolvedRows: 0,
      } : null;
      for (const panel of querySelectorAllDeep(document, DM_PANEL_SEL)) {
        for (const row of dmRowsIn(panel)) {
          if (diagnostic) diagnostic.rows++;
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
          if (diagnostic && resolved.hashes.length) diagnostic.withHash++;
          const rowContent = dmRowContent(row);
          const visibleText = rowContent.title || rowContent.text || cleanDmText(textOf(row));
          const applicableHashes = resolved.hashes.filter((hash) => !isBiliDmHashExempt(hash));
          const autoMatch = autoEnabled && (!resolved.hashes.length || applicableHashes.length)
            ? DanmakuRules.match('bili', visibleText) : null;
          if (autoMatch && applicableHashes.length) queueAutoBiliContent(visibleText, applicableHashes, autoMatch);
          if (!resolved.hashes.length) {
            if (autoMatch) {
              setInlineHidden(hideTarget, true);
              hideTarget.setAttribute('data-ob-dm-blocked', '1');
              if (existingButton) existingButton.remove();
              row.removeAttribute('data-ob-dm-action');
            } else {
              if (diagnostic) diagnostic.unresolvedRows++;
              setInlineHidden(hideTarget, false);
              hideTarget.removeAttribute('data-ob-dm-blocked');
              requestDmRowSegment(row);
              addDmStatusButton(row, resolved.reason === 'no-session' ? '读取弹幕…' : '匹配中…',
                resolved.reason === 'no-session' ? '正在读取当前时间段的弹幕数据' : '该行尚未在已读取的弹幕段中找到');
            }
            continue;
          }
          if (autoMatch || (resolved.hashes.length && resolved.hashes.every((hash) => blocked.has(hash)))) {
            if (diagnostic) diagnostic.blockedRows++;
            hideTarget.setAttribute('data-ob-dm-blocked', '1');
            setInlineHidden(hideTarget, true);
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
            continue;
          }
          setInlineHidden(hideTarget, false);
          hideTarget.removeAttribute('data-ob-dm-blocked');
          if (showButton) {
            addDmBlockButton(row, resolved);
            if (diagnostic && row.querySelector && row.querySelector(':scope > .ob-dm-block')) diagnostic.buttons++;
          }
          else {
            if (existingButton) existingButton.remove();
            row.removeAttribute('data-ob-dm-action');
          }
        }
      }
      if (runtimeDiagnostics) runtimeDiagnostics.biliDmLastPanelState = diagnostic;
    }

    const biliDmMutationElement = (node) => {
      if (!node) return null;
      return node.nodeType === 1 ? node : (node.host || node.parentElement || null);
    };
    const biliDmMutationTouches = (node, selector, includeDescendants = false) => {
      let current = biliDmMutationElement(node);
      for (let guard = 0; current && guard < 24; guard++, current = current.parentElement
        || (current.getRootNode && current.getRootNode().host) || null) {
        if (current.matches) {
          try { if (current.matches(selector)) return true; } catch (e) { return false; }
        }
      }
      const element = biliDmMutationElement(node);
      if (includeDescendants && element && element.querySelector) {
        try { return !!element.querySelector(selector); } catch (e) {}
      }
      return false;
    };
    const biliDmOwnUiNode = (node) => {
      const element = biliDmMutationElement(node);
      if (!element || element.nodeType !== 1) return false;
      if (element.id && /^ob-/.test(element.id)) return true;
      return !!(element.classList && Array.from(element.classList).some((name) => /^ob-/.test(name)));
    };
    PageMutationSignals.subscribe((records, adapterId) => {
      if (adapterId !== 'bilibili') return;
      let panelChanged = false;
      let floatingChanged = false;
      for (const record of records || []) {
        const changed = Array.from(record && record.addedNodes || [])
          .concat(Array.from(record && record.removedNodes || []))
          .filter((node) => node && node.nodeType === 1);
        if (changed.length && changed.every(biliDmOwnUiNode)) continue;
        if (biliDmMutationTouches(record && record.target, DM_PANEL_SEL)
          || changed.some((node) => biliDmMutationTouches(node, DM_PANEL_SEL, true))) panelChanged = true;
        if (biliDmMutationTouches(record && record.target, FLOATING_DM_SEL + ',' + FLOATING_DM_LAYER_SEL)
          || changed.some((node) => biliDmMutationTouches(node, FLOATING_DM_SEL + ',' + FLOATING_DM_LAYER_SEL, true))) floatingChanged = true;
        if (panelChanged && floatingChanged) break;
      }
      if (panelChanged) requestDmPanelScan(false);
      if (floatingChanged) requestFloatingDmScan(false);
    });
    document.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.some((node) => biliDmMutationTouches(node, DM_PANEL_SEL))) requestDmPanelScan(true);
    }, true);

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
        const normalizedUrl = String(url || '');
        xhr.__obDanmakuUrl = normalizedUrl;
        if (!isDanmakuUrl(normalizedUrl)) {
          xhr.__obDanmakuVideoKey = '';
          return;
        }
        // 只有弹幕请求才需要计算当前视频会话键；页面上的图片、评论和
        // 其他 XHR 都不应进入弹幕身份/路由热路径。
        xhr.__obDanmakuVideoKey = currentVideoKey();
        noteDanmakuUrl(normalizedUrl);
        installPakkuResponseFilter(xhr);
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
    let lastDmRouteKey = currentVideoKey();
    biliDmLoop = createPageLoop(() => {
      const nextRouteKey = currentVideoKey();
      if (nextRouteKey !== lastDmRouteKey) {
        lastDmRouteKey = nextRouteKey;
        resetDmSessionIfNeeded();
        dmPanelScanRequested = true;
        dmFloatingScanRequested = true;
        dmToolRefreshRequested = true;
        if (Store.getSetting('enabled') && (Store.getSetting('showQuickBlock') || DanmakuRules.hasEnabled('bili'))) {
          scheduleDmBootstrap(0);
        }
      }
      if (dmPanelScanRequested) scanDmPanels();
      if (dmFloatingScanRequested) scanFloatingDanmakuAutoRules();
      if (dmToolRefreshRequested) refreshDmTool();
      if (dmBootstrapRetryAt && Date.now() >= dmBootstrapRetryAt) ensureDmBootstrap(false);
    }, 2400, () => Store.getSetting('enabled')
      && (Store.getSetting('showQuickBlock') || DanmakuRules.hasEnabled('bili')));
    Store.onChange(() => {
      blockedHashCache = null;
      exemptionHashCache = null;
      const nextRuleSignature = DanmakuRules.signature('bili');
      if (nextRuleSignature !== dmAutoRuleSignature || !Store.getSetting('enabled')) {
        dmAutoRuleSignature = nextRuleSignature;
        resetDmAutoState();
        applyAutoRulesToObservedDanmaku();
      }
      scanDmPanels(); refreshDmTool();
      scanFloatingDanmakuAutoRules();
      if (Store.getSetting('enabled') && (Store.getSetting('showQuickBlock') || DanmakuRules.hasEnabled('bili'))) scheduleDmBootstrap(0);
      biliDmLoop.wake();
    });
    dmAutoRuleSignature = DanmakuRules.signature('bili');
    mountDmTool();
    refreshDmTool();
    setupFloatingDmPick();
    if (Store.getSetting('showQuickBlock') || DanmakuRules.hasEnabled('bili')) scheduleDmBootstrap(1200);
    biliDmLoop.wake();
    biliWorkDanmakuRecords = () => availableDmSenders().map((sender) => ({
      keys: [makeIdentityKey('bili:dmhash', sender.hash)],
      label: 'B站弹幕发送者',
      note: '当前动态视频已观察到的弹幕发送者；弹幕段未提供昵称/UID。',
      workSection: 'danmaku',
      source: 'danmaku-session',
    })).filter((info) => info.keys[0]);
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
    EventLog.record('action.update.check', { source: 'settings-or-menu' }, { immediate: true });
    setStatus('正在检查…');
    try {
      GM_xmlhttpRequest({
        url: UPDATE_URL,
        method: 'GET',
        onload: (res) => {
          try {
            const txt = res.responseText || '';
            const m = txt.match(/\/\/\s*@version\s+([\d.]+)/);
            if (!m) { EventLog.record('action.update.result', { result: 'unparseable' }, { immediate: true }); setStatus('无法解析远程版本'); return; }
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
              EventLog.record('action.update.result', { result: 'new-version' }, { immediate: true });
              setStatus('发现新版本 v' + remote + '，正在打开安装…');
              try { GM_openInTab(DOWNLOAD_URL, { active: true }); }
              catch (e) { window.open(DOWNLOAD_URL, '_blank'); }
            } else {
              EventLog.record('action.update.result', { result: 'current' }, { immediate: true });
              setStatus('已是最新 (v' + local + ')');
            }
          } catch (e) { EventLog.recordError('action.update.response', e); setStatus('检查失败：' + (e && e.message || e)); }
        },
        onerror: () => { EventLog.record('action.update.result', { result: 'network-error' }, { immediate: true }); setStatus('检查失败（网络问题），可稍后重试或手动拖入'); },
      });
    } catch (e) {
      EventLog.recordError('action.update.request', e);
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

  function formatDanmakuExemptionForDisplay(key) {
    const value = String(key || '');
    let match = value.match(/^douyin:uid:(\d+)$/);
    if (match) return '抖音 UID：' + match[1];
    match = value.match(/^douyin:secuid:(.+)$/);
    if (match) return '抖音 sec_uid：' + match[1];
    return formatIdentityForDisplay(value);
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
    if (panel) {
      if (typeof panel.__obClose === 'function') panel.__obClose();
      else {
        panel.remove(); FloatingDock.release('settings');
        const gear = document.getElementById('ob-gear');
        if (gear) gear.setAttribute('aria-expanded', 'false');
      }
      return;
    }
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

        <h3>反馈与日志</h3>
        <p class="ob-log-intro">日志按本地日期记录 OmniBlock 的完整运行事件摘要流，包括扫描批次、DOM 变化摘要、用户操作、收集/分页阶段、状态转移和错误；其中空闲页面的高频扫描与 DOM 观察按 10 秒窗口汇总。日志只保存在本机；不会记录 Cookie、Token、请求头、身份键、评论/弹幕正文、完整 URL 或原始 HTML。</p>
        <div class="ob-log-toolbar">
          <select id="ob-log-day" aria-label="日志日期"></select>
          <button id="ob-log-refresh" type="button">刷新日志</button>
          <button id="ob-log-copy" type="button">复制诊断摘要</button>
          <button id="ob-log-export" type="button">导出日志 JSON</button>
          <button id="ob-log-clear" class="ob-log-danger" type="button">清空日志</button>
        </div>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="ob-log-enabled" checked> 自动记录详细运行日志</label>
        <div id="ob-log-status" class="ob-log-status"></div>
        <div id="ob-log-summary" class="ob-log-summary"></div>
        <pre id="ob-log-events" class="ob-log-events" aria-live="polite"></pre>

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
          <label><input type="checkbox" id="ob-hover" checked> 显示平台专用悬浮入口（如抖音弹幕）</label>
          <label><input type="checkbox" id="ob-quick" checked> 显示"本地拉黑"入口（含B站弹幕工具）</label>
          <label><input type="checkbox" id="ob-bulk" checked> 显示批量拉黑入口（含弹幕勾选批量）</label>
          <label><input type="checkbox" id="ob-skip" checked> 抖音推荐流自动切下一条</label>
          <label>抖音连续跳过上限 <input type="number" id="ob-skipcap" min="0" max="50" style="width:56px"> 条（0=不限制）</label>
        </div>

        <h3>自动屏蔽弹幕</h3>
        <p class="ob-auto-intro">规则只在本机按弹幕文字匹配；添加并启用规则后，B站和抖音会自动隐藏命中的弹幕。管理器中的“恢复并例外”会让当前发送者继续显示，同时让自动规则以后跳过他；删除例外后规则重新生效。B站仍沿用现有 seg.so / PAKKU 兼容链：命中时保存 mid_hash，只有唯一候选且用户卡片正向校验成功时才补充 UID；不会重复实现 PAKKU 的去重。</p>
        <div class="ob-auto-platform" data-ob-auto-platform="bili">
          <h4>B站弹幕规则</h4>
          <div class="ob-auto-add"><select class="ob-auto-kind" aria-label="B站规则类型"><option value="keyword">关键词</option><option value="regex">正则</option></select><input class="ob-auto-pattern" type="text" maxlength="240" placeholder="输入关键词或正则表达式"><button class="ob-auto-add-button" type="button">添加规则</button></div>
          <div class="ob-auto-rule-list" id="ob-auto-bili-rules"></div>
          <div class="ob-auto-exemption-title">自动规则例外（恢复的发送者）</div>
          <div class="ob-auto-exemption-list" id="ob-auto-bili-exemptions"></div>
          <div class="ob-auto-status" id="ob-auto-bili-status"></div>
        </div>
        <div class="ob-auto-platform" data-ob-auto-platform="douyin">
          <h4>抖音弹幕规则</h4>
          <div class="ob-auto-add"><select class="ob-auto-kind" aria-label="抖音规则类型"><option value="keyword">关键词</option><option value="regex">正则</option></select><input class="ob-auto-pattern" type="text" maxlength="240" placeholder="输入关键词或正则表达式"><button class="ob-auto-add-button" type="button">添加规则</button></div>
          <div class="ob-auto-rule-list" id="ob-auto-douyin-rules"></div>
          <div class="ob-auto-exemption-title">自动规则例外（恢复的发送者）</div>
          <div class="ob-auto-exemption-list" id="ob-auto-douyin-exemptions"></div>
          <div class="ob-auto-status" id="ob-auto-douyin-status"></div>
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
        <div id="ob-storage-status" style="color:#999;font-size:12px;margin-top:5px"></div>

        <h3>更新</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="ob-update" style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">检查更新</button>
          <span id="ob-update-status" style="font-size:12px;color:#999"></span>
        </div>
        <p style="color:#999;font-size:12px">点一下自动去仓库比对版本，有新版会弹出安装页（点一次即更新）。想彻底免拖文件：在 Tampermonkey 里把本脚本「更新 → 模式」设为「自动」，TM 会每天静默更新。</p>

        <p style="color:#999;font-size:12px;margin-top:14px">名单、浏览数据和自动快照只保存在本机，不上传。自动快照用于误删/错误导入后的回退；浏览器配置整体丢失时仍请使用导出 JSON。仅在你点击检查更新时请求脚本更新地址。抖音推荐流跳过是唯一一处"模拟操作"，已带随机延迟/连续上限等安全阀。</p>
      </div>`;
    document.body.appendChild(panel);
    FloatingDock.hold('settings');
    const gear = document.getElementById('ob-gear');
    if (gear) {
      gear.setAttribute('aria-controls', 'ob-panel');
      gear.setAttribute('aria-expanded', 'true');
    }
    let stopLogWatch = () => {};
    const closePanel = () => {
      stopLogWatch(); panel.remove(); FloatingDock.release('settings');
      const currentGear = document.getElementById('ob-gear');
      if (currentGear) currentGear.setAttribute('aria-expanded', 'false');
      EventLog.record('ui.settings.close', {}, { immediate: true });
    };
    panel.__obClose = closePanel;
    const runtimeEl = panel.querySelector('#ob-runtime-build');
    if (runtimeEl) {
      runtimeEl.textContent = `运行版本：v${RUNTIME_VERSION} · 构建：${RUNTIME_BUILD}`;
      runtimeEl.setAttribute('data-ob-version', RUNTIME_VERSION);
      runtimeEl.setAttribute('data-ob-build', RUNTIME_BUILD);
      runtimeEl.setAttribute('data-ob-runtime', RUNTIME_MARKER);
    }
    panel.querySelector('.ob-close').onclick = closePanel;
    panel.onclick = (e) => { if (e.target === panel) closePanel(); };
    EventLog.record('ui.settings.open', { source: 'gear-or-menu' }, { immediate: true });

    function autoStatusText(platform, rules) {
      const enabledCount = rules.filter((rule) => rule.enabled).length;
      let text = enabledCount + ' 条规则启用；命中后自动写入本地名单（例外身份跳过）。';
      try {
        const adapter = currentAdapter;
        if (adapter && adapter.id === platform && typeof adapter.getAutoDanmakuStatus === 'function') {
          const status = adapter.getAutoDanmakuStatus();
          if (platform === 'bili') {
            text += ' 当前视频已观察 ' + status.observedSenders + ' 位发送者，已命中 ' + status.matchedMessages
              + ' 条；hash ' + status.matchedHashes + ' 个，UID 正向关联 ' + status.linkedUids + ' 个。';
            if (status.hashOnly || status.unidentifiable || status.uidLimit) {
              text += ' hash-only ' + status.hashOnly + '，无可靠 hash ' + status.unidentifiable
                + '，达到 UID 查询上限 ' + status.uidLimit + '。';
            }
          } else {
            text += ' 当前视频已命中 ' + status.matchedMessages + ' 条，排队发送者 ' + status.queuedSenders
              + ' 位，已提交 ' + status.persistedSenders + ' 位。';
            if (status.noIdentity) text += ' 另有 ' + status.noIdentity + ' 条没有可靠发送者身份，未写入名单。';
          }
        }
      } catch (e) {}
      return text;
    }

    function refreshAutoRules() {
      for (const platform of ['bili', 'douyin']) {
        const rules = DanmakuRules.rulesFor(platform);
        const list = panel.querySelector('#ob-auto-' + platform + '-rules');
        const exemptionList = panel.querySelector('#ob-auto-' + platform + '-exemptions');
        const status = panel.querySelector('#ob-auto-' + platform + '-status');
        if (!list || !status) continue;
        list.textContent = '';
        if (!rules.length) {
          const empty = document.createElement('div');
          empty.className = 'ob-auto-empty';
          empty.textContent = '尚未设置规则';
          list.appendChild(empty);
        }
        for (const rule of rules) {
          const row = document.createElement('div');
          row.className = 'ob-auto-rule';
          const toggle = document.createElement('input');
          toggle.type = 'checkbox'; toggle.checked = rule.enabled;
          toggle.title = rule.enabled ? '停用规则' : '启用规则';
          toggle.addEventListener('change', () => {
            DanmakuRules.setEnabled(platform, rule.id, toggle.checked);
            EventLog.record('settings.danmaku-rule.toggle', { platform, kind: rule.kind, enabled: toggle.checked }, { immediate: true });
            refreshAutoRules();
            if (currentScanner) currentScanner.schedule();
          });
          const kind = document.createElement('span');
          kind.className = 'ob-auto-rule-kind'; kind.textContent = rule.kind === 'regex' ? '正则' : '关键词';
          const pattern = document.createElement('span');
          pattern.className = 'ob-auto-rule-pattern'; pattern.textContent = rule.pattern;
          pattern.title = rule.pattern;
          const remove = document.createElement('button');
          remove.type = 'button'; remove.className = 'ob-auto-rule-remove'; remove.textContent = '删除';
          remove.addEventListener('click', () => {
            DanmakuRules.remove(platform, rule.id);
            EventLog.record('settings.danmaku-rule.remove', { platform, kind: rule.kind }, { immediate: true });
            refreshAutoRules();
            if (currentScanner) currentScanner.schedule();
          });
          row.append(toggle, kind, pattern, remove);
          list.appendChild(row);
        }
        if (exemptionList) {
          exemptionList.textContent = '';
          const exemptions = DanmakuExemptions.keysFor(platform);
          if (!exemptions.length) {
            const empty = document.createElement('div');
            empty.className = 'ob-auto-empty'; empty.textContent = '暂无例外；管理器中的“恢复并例外”会在这里出现';
            exemptionList.appendChild(empty);
          }
          for (const identity of exemptions) {
            const row = document.createElement('div'); row.className = 'ob-auto-exemption';
            const key = document.createElement('span'); key.className = 'ob-auto-exemption-key';
            key.textContent = formatDanmakuExemptionForDisplay(identity); key.title = identity;
            const remove = document.createElement('button');
            remove.type = 'button'; remove.className = 'ob-auto-exemption-remove'; remove.textContent = '恢复规则';
            remove.title = '删除该例外；自动规则下次扫描时可重新作用于此身份';
            remove.addEventListener('click', () => {
              DanmakuExemptions.remove(platform, [identity]);
              EventLog.record('settings.danmaku-exemption.remove', { platform }, { immediate: true });
              refreshAutoRules();
              if (currentScanner) currentScanner.schedule();
              try { currentAdapter && currentAdapter.scanAutoDanmaku && currentAdapter.scanAutoDanmaku(); } catch (e) {}
            });
            row.append(key, remove); exemptionList.appendChild(row);
          }
        }
        const exemptionCount = DanmakuExemptions.keysFor(platform).length;
        status.textContent = autoStatusText(platform, rules)
          + (exemptionCount ? ' 当前有 ' + exemptionCount + ' 条自动规则例外。' : '');
      }
    }

    panel.querySelectorAll('.ob-auto-platform').forEach((section) => {
      const platform = section.getAttribute('data-ob-auto-platform');
      const kind = section.querySelector('.ob-auto-kind');
      const pattern = section.querySelector('.ob-auto-pattern');
      const add = section.querySelector('.ob-auto-add-button');
      const submit = () => {
        const result = DanmakuRules.add(platform, kind.value, pattern.value);
        EventLog.record('settings.danmaku-rule.add', { platform, kind: kind.value, ok: !!result.ok }, { immediate: true });
        if (!result.ok) { showToast(result.error); return; }
        pattern.value = '';
        refreshAutoRules();
        if (currentScanner) currentScanner.schedule();
        try { currentAdapter && currentAdapter.scanAutoDanmaku && currentAdapter.scanAutoDanmaku(); } catch (e) {}
      };
      add.onclick = submit;
      pattern.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    });

    function renderLogMap(map) {
      return Object.keys(map || {}).sort().map((key) => key + '=' + map[key]).join('，') || '无';
    }

    function refreshLogs() {
      const daySelect = panel.querySelector('#ob-log-day');
      const statusEl = panel.querySelector('#ob-log-status');
      const summaryEl = panel.querySelector('#ob-log-summary');
      const eventsEl = panel.querySelector('#ob-log-events');
      const enabled = panel.querySelector('#ob-log-enabled');
      if (!daySelect || !statusEl || !summaryEl || !eventsEl) return;
      const previous = daySelect.value;
      const availableDays = EventLog.days();
      daySelect.textContent = '';
      for (const day of availableDays) {
        const option = document.createElement('option'); option.value = day; option.textContent = day;
        daySelect.appendChild(option);
      }
      const selected = availableDays.includes(previous) ? previous : (availableDays[0] || '');
      if (selected) daySelect.value = selected;
      const status = EventLog.status();
      const summary = EventLog.summary(selected);
      if (enabled) enabled.checked = Store.getSetting('logEnabled') !== false;
      statusEl.textContent = '已保存 ' + status.events + ' 个事件；当前日期 ' + summary.events + ' 个，错误 ' + summary.errors
        + ' 个；待写入 ' + status.pending + ' 个；保留最近 ' + status.retentionDays + ' 天。'
        + (status.writeErrors ? ' 历史写入失败 ' + status.writeErrors + ' 次。' : '');
      summaryEl.textContent = '';
      const cards = [
        ['当天事件', summary.events],
        ['当天错误', summary.errors],
        ['平台分布', renderLogMap(summary.byPlatform)],
        ['事件分布', renderLogMap(summary.byType)],
      ];
      for (const [title, value] of cards) {
        const card = document.createElement('div'); card.className = 'ob-log-summary-item';
        card.textContent = title + '：' + value; summaryEl.appendChild(card);
      }
      const events = selected ? EventLog.eventsForDay(selected) : [];
      const renderLimit = 800;
      const visible = events.slice(-renderLimit).reverse();
      const lines = visible.map((event) => {
        const time = new Date(Number(event.at) || 0).toLocaleTimeString();
        const data = event.data && Object.keys(event.data).length ? ' ' + JSON.stringify(event.data) : '';
        return time + ' [' + (event.platform || 'unknown') + '/' + (event.route || 'unknown') + '] ' + event.type + data;
      });
      if (events.length > renderLimit) lines.unshift('（仅显示最近 ' + renderLimit + ' 条，导出文件包含当天全部 ' + events.length + ' 条）');
      eventsEl.textContent = lines.join('\n');
    }

    stopLogWatch = EventLog.onChange(refreshLogs);
    panel.querySelector('#ob-log-refresh').onclick = refreshLogs;
    panel.querySelector('#ob-log-day').onchange = refreshLogs;
    panel.querySelector('#ob-log-enabled').onchange = (event) => {
      const enabled = !!event.target.checked;
      EventLog.record('settings.log.toggle', { enabled }, { force: true, immediate: true });
      Store.setSetting('logEnabled', enabled);
      refreshLogs();
    };
    panel.querySelector('#ob-log-copy').onclick = async () => {
      const day = panel.querySelector('#ob-log-day').value;
      const text = EventLog.diagnosticText(day);
      EventLog.record('diagnostic.copy', { dayPresent: !!day }, { immediate: true });
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
        else {
          const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
          document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
        }
        showToast('诊断摘要已复制');
      } catch (error) { EventLog.recordError('diagnostic.copy', error); showToast('复制失败，请改用导出日志 JSON'); }
    };
    panel.querySelector('#ob-log-export').onclick = () => {
      const day = panel.querySelector('#ob-log-day').value;
      EventLog.record('diagnostic.export', { dayPresent: !!day }, { immediate: true });
      const blob = new Blob([EventLog.exportJSON()], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'omniblock-events-' + (day || new Date().toISOString().slice(0, 10)) + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      refreshLogs();
    };
    panel.querySelector('#ob-log-clear').onclick = () => {
      if (!window.confirm('清空本机保存的全部 OmniBlock 运行日志？名单和备份不会受影响。')) return;
      EventLog.clear();
      EventLog.record('diagnostic.clear', { scope: 'all' }, { immediate: true });
      refreshLogs();
    };

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
      panel.querySelector('#ob-log-enabled').checked = s.logEnabled !== false;
      const backup = Store.backupStatus();
      const backupToggle = panel.querySelector('#ob-local-backup');
      const restoreBackup = panel.querySelector('#ob-restore-backup');
      const backupStatus = panel.querySelector('#ob-backup-status');
      const storage = Store.storageStatus();
      const storageStatus = panel.querySelector('#ob-storage-status');
      backupToggle.checked = s.localBackupEnabled;
      restoreBackup.disabled = backup.count < 2;
      backupStatus.textContent = backup.error
        || (backup.count ? ('已保留 ' + backup.count + '/' + backup.retention + ' 份本地快照，最新：' + new Date(backup.latestAt).toLocaleString()) : '尚无本地快照，将在下一次名单变更时建立');
      storageStatus.dataset.level = storage.level;
      storageStatus.style.color = storage.persist && (storage.persist.lastOk === false || storage.persist.externalConflict)
        ? '#c62828' : (storage.level === 'critical' ? '#c62828' : (storage.level === 'warning' ? '#b26a00' : '#999'));
      storageStatus.textContent = '主名单：' + storage.persons + ' 人、' + storage.identities + ' 个身份，序列化约 '
        + (storage.chars / (1024 * 1024)).toFixed(2) + ' MiB。'
        + (storage.persist && storage.persist.externalConflict
          ? ' 检测到其他标签页变更；本页有未确认写入，已保留当前内存状态，请先导出并重试。'
          : (storage.persist && storage.persist.lastOk === false
          ? ' 上次主名单写入失败，本页内存状态未确认落盘；请重试或导出备份。'
          : (storage.level === 'critical'
          ? ' 已接近专用开发扩展的单值上限，请先导出备份并清理不再需要的记录。'
          : (storage.level === 'warning' ? ' 名单体积较大，建议定期导出并检查重复身份。' : ' 当前体积正常。'))));
      const mode = panel.querySelector(`input[name="ob-mode"][value="${s.hideMode}"]`);
      if (mode) mode.checked = true;
      refreshAutoRules();
      refreshLogs();
    }
    refresh();

    const logSettingChange = (setting, value) => EventLog.record('settings.change', {
      setting,
      valueType: Array.isArray(value) ? 'array' : typeof value,
      value: typeof value === 'boolean' || typeof value === 'number' ? value : undefined,
    }, { immediate: true });
    panel.querySelector('#ob-add').onclick = () => {
      const plat = panel.querySelector('#ob-plat').value;
      const val = normId(panel.querySelector('#ob-val').value);
      const label = panel.querySelector('#ob-label').value.trim();
      if (!val) return;
      const key = makeIdentityKey(MANUAL_IDENTITY_TYPE[plat], val);
      if (!key) { showToast('身份格式不正确'); return; }
      clearDanmakuExemptionsForManualBlock([key]);
      const result = Store.addIdentities([key], label || val);
      EventLog.record('action.manual-block', { platform: plat, added: result.added, rejected: !!result.rejected }, { immediate: true });
      panel.querySelector('#ob-val').value = '';
      if (result.persisted === false) showToast('已在本页生效但未确认落盘，请重试或导出备份');
      refresh(); if (currentScanner) currentScanner.schedule();
    };
    panel.querySelectorAll('input[name="ob-mode"]').forEach((r) => r.onchange = () => { if (r.checked) { Store.setSetting('hideMode', r.value); logSettingChange('hideMode', r.value); if (currentScanner) currentScanner.schedule(); } });
    panel.querySelector('#ob-enabled').onchange = (e) => {
      Store.setSetting('enabled', e.target.checked);
      logSettingChange('enabled', e.target.checked);
      refreshQuickBlock(); refreshBulkBlock();
      if (currentScanner) currentScanner.schedule();
    };
    panel.querySelector('#ob-hover').onchange = (e) => { Store.setSetting('showHoverButton', e.target.checked); logSettingChange('showHoverButton', e.target.checked); };
    panel.querySelector('#ob-quick').onchange = (e) => { Store.setSetting('showQuickBlock', e.target.checked); logSettingChange('showQuickBlock', e.target.checked); refreshQuickBlock(); };
    panel.querySelector('#ob-bulk').onchange = (e) => { Store.setSetting('showBulkBlock', e.target.checked); logSettingChange('showBulkBlock', e.target.checked); refreshBulkBlock(); };
    panel.querySelector('#ob-skip').onchange = (e) => { Store.setSetting('douyinAutoSkip', e.target.checked); logSettingChange('douyinAutoSkip', e.target.checked); };
    panel.querySelector('#ob-skipcap').onchange = (e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) { Store.setSetting('skipCap', v); logSettingChange('skipCap', v); } };
    panel.querySelector('#ob-local-backup').onchange = (e) => {
      Store.setSetting('localBackupEnabled', e.target.checked);
      logSettingChange('localBackupEnabled', e.target.checked);
      if (e.target.checked) Store.ensureLocalBackup();
      refresh();
    };
    panel.querySelector('#ob-export').onclick = () => {
      EventLog.record('action.backup.export', { source: 'settings' }, { immediate: true });
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
        EventLog.record('action.backup.restore', { ok: result.persisted !== false, identities: result.identities }, { immediate: true });
        refresh(); refreshQuickBlock(); refreshBulkBlock();
        if (currentScanner) currentScanner.schedule();
        showToast((result.persisted === false ? '已在本页恢复但未确认落盘：' : '已恢复本地快照：') + result.identities + ' 个身份'
          + (result.persisted === false ? '，请重试或导出备份' : ''));
      } catch (e) { EventLog.recordError('action.backup.restore', e); showToast('恢复失败：' + (e && e.message || e)); }
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
          EventLog.record('action.backup.import', { ok: result.persisted !== false, identities: result.identities, skipped: result.skipped }, { immediate: true });
          refresh(); refreshQuickBlock(); refreshBulkBlock();
          if (currentScanner) currentScanner.schedule();
          showToast((result.persisted === false ? '已在本页导入但未确认落盘：' : '导入完成：') + '新增 ' + result.identities + ' 个身份'
            + (result.skipped ? '，跳过 ' + result.skipped + ' 条无效记录' : '')
            + (result.persisted === false ? '，请重试或导出备份' : ''));
        } catch (e) { EventLog.recordError('action.backup.import', e); alert('导入失败：' + e.message); }
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
  EventLog.setContext();
  EventLog.record('lifecycle.adapter-selected', { adapter: currentAdapter ? currentAdapter.id : 'none', matched: !!currentAdapter }, { immediate: true });

  try { GM_registerMenuCommand('OmniBlock 设置', openOptions, 'o'); } catch (e) {}
  try { GM_registerMenuCommand('检查更新', checkUpdate, 'u'); } catch (e) {}

  if (currentAdapter) {
    setupBilibiliDanmaku();
    currentScanner = createScanner(currentAdapter);
    setupQuickBlock();
    setupBulkBlock();
    setupWorkBlock();
    if (currentAdapter.id === 'douyin') setupDouyinDanmakuManager();
    // 常驻设置入口（⚙ 按钮）：让设置页不再藏在 Tampermonkey 菜单里
    function mountGear() {
      if (!document.body || document.getElementById('ob-gear')) return;
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.id = 'ob-gear';
      gear.textContent = '⚙';
      gear.title = '本地内容过滤增强 · 设置';
      gear.setAttribute('aria-label', '打开 OmniBlock 设置');
      gear.setAttribute('aria-controls', 'ob-panel');
      gear.setAttribute('aria-expanded', 'false');
      gear.setAttribute('data-ob-version', RUNTIME_VERSION);
      gear.setAttribute('data-ob-build', RUNTIME_BUILD);
      gear.setAttribute('data-ob-runtime', RUNTIME_MARKER);
      gear.onclick = () => openOptions();
      document.body.appendChild(gear);
      FloatingDock.mount();
    }
    if (document.body) mountGear();
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountGear, { once: true });
  }

  // 暴露调试接口
  window.OB = {
    Store, Index, openOptions, adapters: Adapters, collectUsers, identifyFromAnchor,
    setupQuickBlock: refreshQuickBlock, refreshBulk: refreshBulkBlock,
    refreshWork: refreshWorkBlock, openWorkBlock,
    openCommentManager, closeCommentManager, runThreadBlock, mergeCommentRecords,
    logs: EventLog,
    danmakuRules: DanmakuRules,
    danmakuExemptions: DanmakuExemptions,
    runtime: { version: RUNTIME_VERSION, build: RUNTIME_BUILD, marker: RUNTIME_MARKER },
    lifecycle: {
      pageStatus: () => PageLifecycle.status(),
      resourceStatus: () => RuntimeResources.status(),
      scannerStatus: () => currentScanner && currentScanner.status ? currentScanner.status() : null,
    },
    diagnostics: runtimeDiagnostics,
  };
})();

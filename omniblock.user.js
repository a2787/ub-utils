// ==UserScript==
// @name         OmniBlock 拉黑不上限（6 平台统一本地黑名单）
// @namespace    https://github.com/vibeme/omniblock
// @version      0.1.0 (M0 地基)
// @description  本地屏蔽 B站/微博/知乎/贴吧/X/抖音 指定用户的内容，一份名单跨平台通用。基于 Pynseq 思路，MIT 许可。
// @author       vibeme
// @license      MIT
// @match        *://*.bilibili.com/*
// @match        *://*.weibo.com/*
// @match        *://m.weibo.cn/*
// @match        *://*.zhihu.com/*
// @match        *://*.zhihu.com/zhuanlan/*
// @match        *://tieba.baidu.com/*
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @match        *://*.douyin.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @run-at       document-start
// @sandbox      raw
// ==/UserScript==

/*
 * OmniBlock 拉黑不上限 —— 跨平台本地黑名单（统一用户脚本）
 *
 * 架构（单文件但内部模块化，详见计划文件 §11.3）：
 *   core/store.js        共享名单 + 设置（一份 GM 存储，6 平台通用）
 *   core/identity.js     身份归一（platform:type:value 小写 key）
 *   core/hide-engine.js  折叠 / 消失 / 跳过 三种处置（M1+ 实现）
 *   core/scanner.js      MutationObserver 调度（M1+ 实现）
 *   core/action-ui.js    拉黑入口（右键/悬浮按钮/确认气泡，M1+ 实现）
 *   adapters/*           各平台适配器（M1 抖音 / M2 微博 / M3 知乎+X / M4 贴吧 / M5 B站）
 *   adapters/pynseq-bridge.js  把 Pynseq 抖音/微博的名单读写重定向到统一 store（M1/M2）
 *   ui/options.js        统一选项页（名单管理/模式/导入导出）
 *
 * M0 只落地：共享名单 store + 选项页（增删/导出/导入）+ 菜单入口。
 * 适配器与隐藏引擎在 M1 起逐平台接入。
 */

(function () {
  'use strict';

  /* ============================ 常量 ============================ */
  const SCRIPT_NAME = 'OmniBlock 拉黑不上限';
  const SCRIPT_VERSION = '0.1.0';
  const LIST_KEY = 'ob_list';        // 共享名单：一份，6 平台通用
  const SETTINGS_KEY = 'ob_settings';
  const PLATFORMS = ['bili', 'weibo', 'zhihu', 'tieba', 'x', 'douyin'];

  /* ====================== core/store.js ====================== */
  // 共享名单：数组，每项 { id, platform, type, value, label, createdAt }
  // id 用 identity 归一后的 key，保证同人同键、可去重。
  const Store = {
    getList() {
      try { return JSON.parse(GM_getValue(LIST_KEY, '[]')); }
      catch (e) { return []; }
    },
    setList(list) { GM_setValue(LIST_KEY, JSON.stringify(list)); },
    addEntry(entry) {
      const list = this.getList();
      if (list.some(e => e.id === entry.id)) return list.length; // 去重
      list.push(entry);
      this.setList(list);
      return list.length;
    },
    removeEntry(id) {
      this.setList(this.getList().filter(e => e.id !== id));
    },
    getSettings() {
      try { return JSON.parse(GM_getValue(SETTINGS_KEY, '{}')); }
      catch (e) { return {}; }
    },
    setSettings(s) { GM_setValue(SETTINGS_KEY, JSON.stringify(s)); },
    exportJSON() {
      return JSON.stringify({ version: 1, list: this.getList() }, null, 2);
    },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.list)) throw new Error('文件格式不对（缺 list 数组）');
      this.setList(data.list);
      return data.list.length;
    }
  };

  /* ====================== core/identity.js ====================== */
  // 归一为小写 key：{platform}:{type}:{value}
  function normalizeKey(platform, type, value) {
    return `${platform}:${type}:${String(value).toLowerCase()}`;
  }

  /* =================== core/hide-engine.js（占位） =================== */
  const HideEngine = {
    // M1+：折叠成灰条（保留节点，虚拟列表安全）
    collapse(el, label) { /* TODO M1 */ },
    // M1+：完全消失（display:none）
    hide(el) { /* TODO M1 */ },
    // M1+：抖音推荐流专用——静音+遮罩+自动切下一条（不动 DOM 结构）
    skip() { /* TODO M1（抖音） */ }
  };

  /* =================== core/scanner.js（占位） =================== */
  const Scanner = {
    // M1+：MutationObserver + rAF 批处理 + WeakSet 去重
    observe(root, cb) { /* TODO M1 */ }
  };

  /* ====================== ui/options.js ====================== */
  function renderList(panel) {
    const list = Store.getList();
    panel.querySelector('#ob-count').textContent = `当前屏蔽 ${list.length} 条（6 平台共用一份）`;
    const box = panel.querySelector('#ob-list');
    box.innerHTML = list.length
      ? list.map(e => `
          <div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f3f3f3">
            <span>${escapeHtml(e.label)} <span style="color:#999">(${e.platform})</span></span>
            <button data-del="${escapeHtml(e.id)}" style="color:#c33;border:none;background:none;cursor:pointer">删</button>
          </div>`).join('')
      : '<div style="color:#999">名单为空</div>';
    box.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => { Store.removeEntry(b.getAttribute('data-del')); renderList(panel); };
    });
  }

  function openOptions() {
    if (document.getElementById('ob-options')) return;
    const panel = document.createElement('div');
    panel.id = 'ob-options';
    panel.style.cssText =
      'position:fixed;top:20px;right:20px;width:340px;max-height:80vh;overflow:auto;' +
      'background:#fff;color:#222;border:1px solid #ccc;border-radius:12px;padding:16px;' +
      'z-index:2147483647;font:13px/1.6 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>${SCRIPT_NAME}</b><span style="color:#888">v${SCRIPT_VERSION}</span>
      </div>
      <div id="ob-count" style="color:#555;margin-bottom:8px"></div>
      <div id="ob-list" style="border-top:1px solid #eee;padding-top:8px"></div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button data-act="add" style="padding:4px 10px">添加</button>
        <button data-act="export" style="padding:4px 10px">导出</button>
        <button data-act="import" style="padding:4px 10px">导入</button>
        <button data-act="close" style="padding:4px 10px">关闭</button>
      </div>`;
    document.body.appendChild(panel);
    renderList(panel);

    panel.addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act');
      if (act === 'close') return panel.remove();
      if (act === 'add') {
        const platform = prompt('平台？(' + PLATFORMS.join('/') + ')');
        const value = prompt('用户标识（uid / sec_uid / handle / 用户名 等）');
        const label = prompt('备注名（可选）') || value;
        if (platform && value) {
          const id = normalizeKey(platform, 'uid', value);
          Store.addEntry({ id, platform, type: 'uid', value, label, createdAt: Date.now() });
          renderList(panel);
        }
      }
      if (act === 'export') {
        const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `omniblock-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
      }
      if (act === 'import') {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'application/json';
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try { const n = Store.importJSON(r.result); alert(`已导入 ${n} 条`); renderList(panel); }
            catch (err) { alert('导入失败：' + err.message); }
          };
          r.readAsText(f);
        };
        inp.click();
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ====================== 启动 ====================== */
  function boot() {
    GM_registerMenuCommand('OmniBlock 设置', openOptions);
    console.log(`[${SCRIPT_NAME}] v${SCRIPT_VERSION} 已加载，名单 ${Store.getList().length} 条`);
    // M1+：按当前 hostname 选择适配器并启动扫描
    // if (location.host.includes('douyin.com')) DouyinAdapter.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

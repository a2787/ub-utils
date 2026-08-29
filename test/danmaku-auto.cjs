/* OmniBlock 自动弹幕规则回归。
 * 夹具全部为人工合成 DOM/protobuf，不代表真实平台结构；真实站点证据仍由
 * 专用浏览器探针提供。覆盖 B站现有 seg.so/PAKKU 过滤链和抖音当前播放器节点链。
 * 运行：node test/danmaku-auto.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function varint(value) {
  const out = [];
  let n = value >>> 0;
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n); return out;
}
function bytes(text) { return Array.from(Buffer.from(text, 'utf8')); }
function fieldVarint(number, value) { return [...varint(number << 3), ...varint(value)]; }
function fieldText(number, text) {
  const body = bytes(text);
  return [...varint((number << 3) | 2), ...varint(body.length), ...body];
}
function dmElem(hash, content, progress) {
  const body = [...fieldVarint(2, progress), ...fieldText(6, hash), ...fieldText(7, content)];
  return Buffer.from([...varint(10), ...varint(body.length), ...body]);
}

// 人工合成：CRC32("12") = 4f5344cd；该 hash 在当前 1–10 位候选空间内唯一，
// 用于验证自动规则命中 hash 后才允许正向校验并关联 UID。
const AUTO_SEGMENT = Buffer.concat([
  dmElem('4f5344cd', 'AUTO UID candidate', 5000),
  dmElem('11223344', 'keep this danmaku', 9000),
  dmElem('22334455', 'REGEX_123', 12000),
]);

const BILI_SHIM = `
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:false, showBulkBlock:false } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; window.__writes = (window.__writes || 0) + (k === 'omniblock:data:v1' ? 1 : 0); };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = (options) => {
  const parsed = new URL(String(options && options.url || ''));
  const uid = parsed.searchParams.get('mid') || '';
  setTimeout(() => {
  const card = uid === '12' ? { mid:'12', name:'Auto UID 12' } : null;
    if (options.onload) options.onload({ status:200, responseText:JSON.stringify(card ? { code:0, data:{ card } } : { code:-404, data:null }) });
  }, 0);
  return { abort(){} };
};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${VERSION}' } };
`;

const DOUYIN_SHIM = `
window.__OB_PROBE_DIAGNOSTICS__ = { enabled:true };
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:false, showBulkBlock:false } }) };
window.GM_getValue = (k,d) => (k in window.__gm ? window.__gm[k] : d);
window.GM_setValue = (k,v) => { window.__gm[k] = v; };
window.GM_deleteValue = (k) => { delete window.__gm[k]; };
window.GM_addStyle = (css) => { const add=()=>{ const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); }; if(document.head||document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); };
window.GM_registerMenuCommand = () => {};
window.GM_addValueChangeListener = () => {};
window.GM_xmlhttpRequest = () => {};
window.GM_openInTab = () => {};
window.GM_info = { script:{ version:'${VERSION}' } };
`;

const BILI_FIXTURE = `<!doctype html><html><body><bili-comments id="comments"></bili-comments></body></html>`;
const DOUYIN_FIXTURE = `<!doctype html><html><body>
  <div class="basePlayerContainer video_1111111111111111111">
    <div class="dy-danmaku-layer">
      <div id="auto-dm-one" data-danmu-id="one" data-danmaku-user-id="7001">AUTO 抖音弹幕一</div>
      <div id="keep-dm" data-danmu-id="keep" data-danmaku-user-id="7002">普通抖音弹幕</div>
      <div id="auto-dm-two" data-danmu-id="two" data-danmaku-user-id="7001">AUTO 抖音弹幕二</div>
      <div id="auto-dm-no-id" data-danmu-id="no-id">AUTO 无可靠身份</div>
      <div id="regex-dm" data-danmu-id="regex" data-danmaku-user-id="7004">REGEX_456</div>
    </div>
  </div>
</body></html>`;

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  const browser = await launchChromium({ headless:true, args:['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const bili = await browser.newPage();
    await bili.route('**/*', (route) => {
      if (/\/dm\/(?:wbi\/)?web\/seg\.so/.test(route.request().url())) {
        return route.fulfill({ status:200, contentType:'application/octet-stream', body:AUTO_SEGMENT });
      }
      return route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:BILI_FIXTURE });
    });
    await bili.addInitScript({ content:BILI_SHIM + '\n' + USERSCRIPT });
    await bili.goto('https://www.bilibili.com/video/BVauto', { waitUntil:'domcontentloaded' });
    await bili.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    const biliResult = await bili.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rules = window.OB.danmakuRules;
      const keyword = rules.add('bili', 'keyword', 'AUTO');
      const duplicate = rules.add('bili', 'keyword', 'AUTO');
      const regex = rules.add('bili', 'regex', '^REGEX_[0-9]+$');
      const response = await fetch('https://api.bilibili.com/x/v2/dm/web/seg.so?oid=1&segment_index=1');
      const text = new TextDecoder().decode(await response.arrayBuffer());
      await pause(700);
      const persons = Object.values(window.OB.Store.persons());
      const autoPerson = persons.find((person) => person.identities.includes('bili:dmhash:4f5344cd'));
      const statusBeforeDisable = window.OB.adapters.bilibili.getAutoDanmakuStatus();
      const hashStoredBeforeExemption = window.OB.Index.isBlocked('bili:dmhash:4f5344cd');
      const uidLinkedBeforeExemption = window.OB.Index.isBlocked('bili:uid:12');
      const linkedTogetherBeforeExemption = !!autoPerson && autoPerson.identities.includes('bili:dmhash:4f5344cd')
        && autoPerson.identities.includes('bili:uid:12');
      const exemption = window.OB.danmakuExemptions.add('bili', ['bili:dmhash:4f5344cd']);
      window.OB.Store.removeIdentities(['bili:dmhash:4f5344cd', 'bili:uid:12']);
      const exemptResponse = await fetch('https://api.bilibili.com/x/v2/dm/web/seg.so?oid=1&segment_index=1');
      const exemptText = new TextDecoder().decode(await exemptResponse.arrayBuffer());
      const exemptKept = exemptText.includes('AUTO UID candidate') && !window.OB.Index.isBlocked('bili:dmhash:4f5344cd');
      const removedExemption = window.OB.danmakuExemptions.remove('bili', ['bili:dmhash:4f5344cd']);
      const reblockedResponse = await fetch('https://api.bilibili.com/x/v2/dm/web/seg.so?oid=1&segment_index=1');
      const reblockedText = new TextDecoder().decode(await reblockedResponse.arrayBuffer());
      window.OB.Store.setSetting('enabled', false);
      const disabledText = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.bilibili.com/x/v2/dm/web/seg.so?oid=1&segment_index=1');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(new TextDecoder().decode(xhr.response));
        xhr.onerror = () => reject(new Error('disabled XHR failed'));
        xhr.send();
      });
      window.OB.Store.setSetting('enabled', true);
      return {
        keyword: keyword.ok,
        duplicateRejected: !duplicate.ok,
        regex: regex.ok,
        regexMatches: !!rules.match('bili', 'REGEX_123'),
        autoRemoved: !text.includes('AUTO UID candidate'),
        regexRemoved: !text.includes('REGEX_123'),
        keepPresent: text.includes('keep this danmaku'),
        hashStored: hashStoredBeforeExemption,
        regexHashStored: window.OB.Index.isBlocked('bili:dmhash:22334455'),
        uidLinked: uidLinkedBeforeExemption,
        linkedTogether: linkedTogetherBeforeExemption,
        exemptionStored: exemption.added.length === 1 && exemptKept,
        exemptionRemovedRestoresRule: removedExemption.removed.length === 1 && !reblockedText.includes('AUTO UID candidate'),
        disabledKeepsOriginal: disabledText.includes('AUTO UID candidate') && disabledText.includes('REGEX_123') && disabledText.includes('keep this danmaku'),
        statusBeforeDisable,
        status: window.OB.adapters.bilibili.getAutoDanmakuStatus(),
        quickHidden: getComputedStyle(document.getElementById('ob-dm-tool') || document.body).display === 'none',
      };
    });
    if (biliResult.keyword && biliResult.duplicateRejected && biliResult.regex && biliResult.regexMatches && biliResult.autoRemoved
      && biliResult.regexRemoved && biliResult.keepPresent && biliResult.hashStored && biliResult.regexHashStored
      && biliResult.uidLinked && biliResult.linkedTogether && biliResult.disabledKeepsOriginal && biliResult.quickHidden
      && biliResult.exemptionStored && biliResult.exemptionRemovedRestoresRule
      && biliResult.statusBeforeDisable.matchedMessages === 2 && biliResult.statusBeforeDisable.matchedHashes === 2
      && biliResult.statusBeforeDisable.linkedUids === 1)
      report.pass.push('AUTO-BILI 规则命中经现有 seg.so 链过滤，hash 入库并仅将唯一正向校验 UID 关联；关闭快捷入口不影响自动屏蔽');
    else report.fail.push('AUTO-BILI 自动规则/UID/入口隔离失败：' + JSON.stringify(biliResult));
    const settingsUi = await bili.evaluate(() => {
      window.OB.danmakuExemptions.add('bili', ['bili:dmhash:11223344']);
      window.OB.openOptions();
      const panel = document.getElementById('ob-panel');
      const boxes = panel ? Array.from(panel.querySelectorAll('.ob-auto-platform')) : [];
      const result = {
        panel: !!panel,
        platforms: boxes.map((box) => box.getAttribute('data-ob-auto-platform')).sort(),
        biliKinds: panel ? panel.querySelector('[data-ob-auto-platform="bili"] .ob-auto-kind').querySelectorAll('option').length : 0,
        douyinKinds: panel ? panel.querySelector('[data-ob-auto-platform="douyin"] .ob-auto-kind').querySelectorAll('option').length : 0,
        ruleRows: panel ? panel.querySelectorAll('.ob-auto-rule').length : 0,
        exemptionRows: panel ? panel.querySelectorAll('.ob-auto-exemption').length : 0,
        exemptionRemove: panel ? !!panel.querySelector('.ob-auto-exemption-remove') : false,
        pakkuNote: panel ? /不会重复实现 PAKKU 的去重/.test(panel.textContent || '') : false,
      };
      const removeExemption = panel && panel.querySelector('.ob-auto-exemption-remove');
      if (removeExemption) removeExemption.click();
      result.exemptionRemoved = !window.OB.danmakuExemptions.keysFor('bili').includes('bili:dmhash:11223344');
      if (panel) panel.remove();
      return result;
    });
    if (settingsUi.panel && settingsUi.platforms.join(',') === 'bili,douyin'
      && settingsUi.biliKinds === 2 && settingsUi.douyinKinds === 2 && settingsUi.ruleRows === 2
      && settingsUi.exemptionRows === 1 && settingsUi.exemptionRemove && settingsUi.exemptionRemoved && settingsUi.pakkuNote)
      report.pass.push('AUTO-UI B站/抖音规则分平台显示关键词与正则入口，并明确不复制 PAKKU 去重');
    else report.fail.push('AUTO-UI 规则面板分平台/兼容说明失败：' + JSON.stringify(settingsUi));
    await bili.close();

    const douyin = await browser.newPage();
    await douyin.route('**/*', (route) => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:DOUYIN_FIXTURE }));
    await douyin.addInitScript({ content:DOUYIN_SHIM + '\n' + USERSCRIPT });
    await douyin.goto('https://www.douyin.com/video/auto', { waitUntil:'domcontentloaded' });
    await douyin.waitForFunction(() => !!window.OB, null, { timeout:8000 });
    const douyinResult = await douyin.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.OB.Store.setSetting('douyinDanmakuRules', [
        { kind:'keyword', pattern:'AUTO', enabled:true },
        { kind:'regex', pattern:'^REGEX_[0-9]+$', enabled:true },
      ]);
      const adapter = window.OB.adapters.douyin;
      adapter.scanAutoDanmaku();
      await pause(250);
      const one = document.getElementById('auto-dm-one');
      const two = document.getElementById('auto-dm-two');
      const noId = document.getElementById('auto-dm-no-id');
      const regex = document.getElementById('regex-dm');
      const keep = document.getElementById('keep-dm');
      const initial = {
        blocked: window.OB.Index.isBlocked('douyin:uid:7001'),
        keepUnblocked: !window.OB.Index.isBlocked('douyin:uid:7002'),
        autoHidden: [one, two, noId, regex].every((node) => node && node.getAttribute('data-ob-auto-dm-blocked') === '1'
          && (getComputedStyle(node).display === 'none' || node.getBoundingClientRect().height === 0)),
        keepVisible: !!keep && getComputedStyle(keep).display !== 'none' && keep.getAttribute('data-ob-blocked') !== '1',
        status: adapter.getAutoDanmakuStatus(),
        managerAbsent: !document.getElementById('ob-douyin-dm-manager'),
      };
      const diagnostics = window.OB.diagnostics;
      const resetTraversalDiagnostics = () => {
        if (!diagnostics) return;
        diagnostics.activeVideoRootCalls = 0;
        diagnostics.activeVideoRootComputations = 0;
        diagnostics.douyinDanmakuCollections = 0;
        diagnostics.douyinDanmakuItems = 0;
      };
      const readTraversalDiagnostics = () => diagnostics ? {
        activeVideoRootCalls: diagnostics.activeVideoRootCalls,
        activeVideoRootComputations: diagnostics.activeVideoRootComputations,
        douyinDanmakuCollections: diagnostics.douyinDanmakuCollections,
        douyinDanmakuItems: diagnostics.douyinDanmakuItems,
      } : null;
      window.OB.Store.setSetting('douyinDanmakuRules', []);
      resetTraversalDiagnostics();
      const noRuleRoot = adapter.danmakuRoot();
      adapter.collectDanmaku(noRuleRoot);
      const noRuleTraversal = readTraversalDiagnostics();
      window.OB.Store.setSetting('douyinDanmakuRules', [
        { kind:'keyword', pattern:'AUTO', enabled:true },
        { kind:'regex', pattern:'^REGEX_[0-9]+$', enabled:true },
      ]);
      resetTraversalDiagnostics();
      adapter.scanAutoDanmaku();
      const enabledTraversal = readTraversalDiagnostics();
      window.OB.Store.setSetting('douyinDanmakuRules', []);
      adapter.scanAutoDanmaku();
      await pause(100);
      const ruleDisabledRestored = noId
        && noId.getAttribute('data-ob-auto-dm-blocked') !== '1'
        && getComputedStyle(noId).display !== 'none';
      window.OB.Store.setSetting('douyinDanmakuRules', [
        { kind:'keyword', pattern:'AUTO', enabled:true },
        { kind:'regex', pattern:'^REGEX_[0-9]+$', enabled:true },
      ]);
      adapter.scanAutoDanmaku();
      const player = document.querySelector('.basePlayerContainer');
      const layer = player && player.querySelector('.dy-danmaku-layer');
      const stale = document.createElement('div');
      stale.className = 'basePlayerContainer video_9999999999999999999';
      stale.append(one, two, noId, regex);
      document.body.appendChild(stale);
      if (player) player.className = 'basePlayerContainer video_2222222222222222222';
      const next = document.createElement('div');
      next.id = 'auto-dm-next'; next.setAttribute('data-danmu-id', 'next'); next.setAttribute('data-danmaku-user-id', '7003');
      next.textContent = 'AUTO 新视频弹幕';
      if (layer) layer.appendChild(next);
      adapter.scanAutoDanmaku();
      await pause(250);
      const nextStatus = adapter.getAutoDanmakuStatus();
      return {
        ...initial,
        ruleDisabledRestored,
        switchScoped: next.getAttribute('data-ob-auto-dm-blocked') === '1'
          && getComputedStyle(next).display === 'none'
          && noId.getAttribute('data-ob-auto-dm-blocked') !== '1'
          && getComputedStyle(noId).display !== 'none'
          && nextStatus.matchedMessages === 1 && nextStatus.noIdentity === 0
          && window.OB.Index.isBlocked('douyin:uid:7003'),
        switchDetails: {
          nextMarker: next.getAttribute('data-ob-auto-dm-blocked'),
          nextDisplay: getComputedStyle(next).display,
          oldNoIdMarker: noId.getAttribute('data-ob-auto-dm-blocked'),
          oldNoIdDisplay: getComputedStyle(noId).display,
          nextStatus,
          nextBlocked: window.OB.Index.isBlocked('douyin:uid:7003'),
        },
        noRuleTraversal,
        enabledTraversal,
      };
    });
    if (douyinResult.blocked && douyinResult.keepUnblocked && douyinResult.autoHidden && douyinResult.keepVisible
      && douyinResult.status.matchedMessages === 4 && douyinResult.status.persistedSenders === 2
      && douyinResult.status.noIdentity === 1 && douyinResult.managerAbsent && douyinResult.ruleDisabledRestored && douyinResult.switchScoped)
      report.pass.push('AUTO-DOUYIN 仅扫描当前播放器，命中按身份合并写入；规则停用即时恢复，旧视频残留节点不串入新视频');
    else report.fail.push('AUTO-DOUYIN 自动规则/当前视频范围失败：' + JSON.stringify(douyinResult));
    const noRuleTraversal = douyinResult.noRuleTraversal || {};
    const enabledTraversal = douyinResult.enabledTraversal || {};
    if (noRuleTraversal.activeVideoRootCalls <= 3 && noRuleTraversal.activeVideoRootComputations <= 2
      && noRuleTraversal.douyinDanmakuItems === 5
      && enabledTraversal.activeVideoRootCalls <= 3 && enabledTraversal.activeVideoRootComputations <= 2
      && enabledTraversal.douyinDanmakuCollections === 0 && enabledTraversal.douyinDanmakuItems === 0)
      report.pass.push('AUTO-DOUYIN-PERF 自动规则关闭时走快速路径，启用时复用已观察弹幕节点，不再重复全量深遍历');
    else report.fail.push('AUTO-DOUYIN-PERF 活动播放器根节点重复遍历：' + JSON.stringify({ noRuleTraversal, enabledTraversal }));

    const douyinDanmakuManager = await douyin.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const autoIdentity = 'douyin:uid:7003';
      const identity = 'douyin:uid:7002';
      window.OB.Store.setSetting('showBulkBlock', true);
      try {
        await pause(180);
        const tool = document.getElementById('ob-douyin-dm-tool');
        if (!tool) return { tool: false };
        tool.click();
        await pause(80);
        const panel = document.getElementById('ob-douyin-dm-manager');
        const autoRow = panel && Array.from(panel.querySelectorAll('.ob-dd-row'))
          .find((item) => item.textContent.includes('AUTO 新视频弹幕'));
        const autoButton = autoRow && autoRow.querySelector('.ob-dd-unblock');
        const autoBlockedGray = !!autoRow && autoRow.getAttribute('data-ob-dd-state') === 'blocked'
          && !!autoButton && autoButton.textContent.includes('恢复并例外')
          && autoButton.getAttribute('data-ob-dd-action') === 'exception';
        if (autoButton) autoButton.click();
        await pause(120);
        const autoRestoredRow = panel && Array.from(panel.querySelectorAll('.ob-dd-row'))
          .find((item) => item.textContent.includes('AUTO 新视频弹幕'));
        const autoRestored = !window.OB.Index.isBlocked(autoIdentity)
          && window.OB.danmakuExemptions.keysFor('douyin').includes(autoIdentity)
          && autoRestoredRow && autoRestoredRow.getAttribute('data-ob-dd-state') === 'active'
          && document.getElementById('auto-dm-next').getAttribute('data-ob-auto-dm-blocked') !== '1';
        window.OB.danmakuExemptions.remove('douyin', [autoIdentity]);
        window.OB.adapters.douyin.scanAutoDanmaku();
        await pause(120);
        const autoRuleReapplied = document.getElementById('auto-dm-next').getAttribute('data-ob-auto-dm-blocked') === '1'
          && getComputedStyle(document.getElementById('auto-dm-next')).display === 'none';

        window.OB.Store.addIdentities([identity], 'manual danmaku manager fixture');
        await pause(80);
        const row = panel && Array.from(panel.querySelectorAll('.ob-dd-row'))
          .find((item) => item.textContent.includes('普通抖音弹幕'));
        const unblock = row && row.querySelector('.ob-dd-unblock');
        const blockedGray = !!row && row.getAttribute('data-ob-dd-state') === 'blocked'
          && row.classList.contains('ob-dd-blocked') && !!unblock;
        if (unblock) unblock.click();
        await pause(120);
        const restoredRow = panel && Array.from(panel.querySelectorAll('.ob-dd-row'))
          .find((item) => item.textContent.includes('普通抖音弹幕'));
        return {
          tool: true,
          toolText: tool.textContent,
          autoBlockedGray,
          autoRestored,
          autoRuleReapplied,
          blockedGray,
          restored: !window.OB.Index.isBlocked(identity),
          restoredState: restoredRow && restoredRow.getAttribute('data-ob-dd-state'),
          unblockRemoved: !(restoredRow && restoredRow.querySelector('.ob-dd-unblock')),
        };
      } finally {
        const panel = document.getElementById('ob-douyin-dm-manager');
        const close = panel && panel.querySelector('.ob-dd-close');
        if (close) close.click();
        window.OB.Store.removeIdentity(autoIdentity);
        window.OB.Store.removeIdentity(identity);
        window.OB.danmakuExemptions.remove('douyin', [autoIdentity, identity]);
        window.OB.Store.setSetting('showBulkBlock', false);
      }
    });
    if (douyinDanmakuManager.tool && douyinDanmakuManager.autoBlockedGray && douyinDanmakuManager.autoRestored
      && douyinDanmakuManager.autoRuleReapplied && douyinDanmakuManager.blockedGray && douyinDanmakuManager.restored
      && douyinDanmakuManager.restoredState === 'active' && douyinDanmakuManager.unblockRemoved)
      report.pass.push('AUTO-DOUYIN-MANAGER 自动命中可“恢复并例外”，删除例外后规则重新作用；手动屏蔽仍可单独取消');
    else report.fail.push('AUTO-DOUYIN-MANAGER 已屏蔽展示/取消屏蔽错误：' + JSON.stringify(douyinDanmakuManager));

    const markedRootResult = await douyin.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const adapter = window.OB.adapters.douyin;
      document.querySelectorAll('.basePlayerContainer, .playerContainer, [data-e2e="video-player"], [data-e2e="feed-active-video"]')
        .forEach((node) => node.remove());
      const marked = document.createElement('div');
      marked.setAttribute('data-e2e', 'feed-active-video');
      marked.setAttribute('data-e2e-vid', '3333333333333333333');
      const actual = document.createElement('div');
      actual.className = 'basePlayerContainer video_4444444444444444444';
      const danmaku = document.createElement('div');
      danmaku.setAttribute('data-danmu-id', 'root-split');
      danmaku.setAttribute('data-danmaku-user-id', '7999');
      danmaku.textContent = 'ROOT_SPLIT_TEST';
      actual.appendChild(danmaku);
      document.body.append(marked, actual);
      const rule = window.OB.danmakuRules.add('douyin', 'keyword', 'ROOT_SPLIT_TEST');
      adapter.scanAutoDanmaku();
      await pause(250);
      const result = {
        selectedActual: adapter.danmakuRoot() === actual,
        hidden: danmaku.getAttribute('data-ob-auto-dm-blocked') === '1'
          && getComputedStyle(danmaku).display === 'none',
        identityPersisted: window.OB.Index.isBlocked('douyin:uid:7999'),
      };
      if (rule && rule.rule) window.OB.danmakuRules.remove('douyin', rule.rule.id);
      window.OB.Store.removeIdentity('douyin:uid:7999');
      actual.remove(); marked.remove();
      return result;
    });
    if (markedRootResult.selectedActual && markedRootResult.hidden && markedRootResult.identityPersisted)
      report.pass.push('AUTO-DOUYIN 活动标记容器与实际弹幕播放器分离时，仍选择含弹幕的当前根节点');
    else report.fail.push('AUTO-DOUYIN 活动根节点选择失败：' + JSON.stringify(markedRootResult));
    await douyin.close();
  } catch (error) {
    report.errors.push(String(error && error.stack || error));
  }
  try { await browser.close(); } catch (e) {}
  console.log('==== OmniBlock 自动弹幕规则回归测试 ====');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

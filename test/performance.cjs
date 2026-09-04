/* OmniBlock 全插件性能边界回归。
 * 页面与弹幕节点均为人工合成；本测试证明调度/缓存契约，不替代真实站点性能测量。
 * 运行：node test/performance.cjs
 */
const { launchChromium, ROOT } = require('./runtime.cjs');
const fs = require('fs');
const path = require('path');

const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'omniblock.user.js'), 'utf8');
const VERSION = (USERSCRIPT.match(/\/\/\s*@version\s+([\d.]+)/) || [, '0.0.0'])[1];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SHIM = `
window.__OB_PROBE_DIAGNOSTICS__ = { enabled:true };
window.__gm = { 'omniblock:data:v1': JSON.stringify({ version:1, persons:{}, settings:{ enabled:true, hideMode:'collapse', showHoverButton:true, douyinAutoSkip:true, skipCap:6, showQuickBlock:false, showBulkBlock:true, logEnabled:false } }) };
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

const FIXTURE = `<!doctype html><html><body>
  <main id="app-shell">
    <div id="perf-player" class="basePlayerContainer video_1111111111111111111">
      <div id="perf-danmaku-layer" class="dy-danmaku-layer"></div>
    </div>
  </main>
</body></html>`;

function snapshot(page) {
  return page.evaluate(() => {
    const d = window.OB && window.OB.diagnostics;
    if (!d) return null;
    return {
      activeVideoRootCalls: d.activeVideoRootCalls || 0,
      activeVideoRootComputations: d.activeVideoRootComputations || 0,
      douyinDanmakuCollections: d.douyinDanmakuCollections || 0,
      douyinDanmakuItems: d.douyinDanmakuItems || 0,
      douyinAutoScans: d.douyinAutoScans || 0,
      scannerFullScans: d.scannerFullScans || 0,
      scannerIncrementalScans: d.scannerIncrementalScans || 0,
      scannerItemsProcessed: d.scannerItemsProcessed || 0,
      scannerMutationCallbacks: d.scannerMutationCallbacks || 0,
      scannerMutationRecords: d.scannerMutationRecords || 0,
      scannerMutationDurationMs: d.scannerMutationDurationMs || 0,
      scannerMutationMaxDurationMs: d.scannerMutationMaxDurationMs || 0,
      scannerScanDurationMs: d.scannerScanDurationMs || 0,
      scannerScanMaxDurationMs: d.scannerScanMaxDurationMs || 0,
      scannerDirtyRootDurationMs: d.scannerDirtyRootDurationMs || 0,
      scannerDirtyRootMaxDurationMs: d.scannerDirtyRootMaxDurationMs || 0,
    };
  });
}

function resetDiagnostics(page) {
  return page.evaluate(() => {
    const d = window.OB && window.OB.diagnostics;
    if (!d) return false;
    for (const key of [
      'activeVideoRootCalls', 'activeVideoRootComputations', 'douyinDanmakuCollections',
      'douyinDanmakuItems', 'douyinAutoScans', 'scannerFullScans',
      'scannerIncrementalScans', 'scannerItemsProcessed', 'scannerMutationCallbacks',
      'scannerMutationRecords', 'scannerMutationDurationMs', 'scannerMutationMaxDurationMs',
      'scannerScanDurationMs', 'scannerScanMaxDurationMs', 'scannerDirtyRootDurationMs',
      'scannerDirtyRootMaxDurationMs',
    ]) d[key] = 0;
    return true;
  });
}

(async () => {
  const report = { pass: [], fail: [], errors: [] };
  if (/setTimeout\s*\(\s*mount(?:Fab|Gear)\b/.test(USERSCRIPT)) {
    report.fail.push('启动入口仍使用 body 轮询定时器');
  } else {
    report.pass.push('启动入口等待 DOMContentLoaded，不建立 body 轮询定时器');
  }
  if (/\bsetInterval\s*\(/.test(USERSCRIPT)) {
    report.fail.push('源码仍存在无生命周期门控的 setInterval');
  } else {
    report.pass.push('源码不使用独立 setInterval，周期任务统一走生命周期门控调度');
  }
  const browser = await launchChromium({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
    await page.addInitScript({ content: SHIM + '\n' + USERSCRIPT });
    await page.goto('https://www.douyin.com/video/performance-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 8000 });
    await wait(1400);

    const setup = await page.evaluate(() => ({
      player: !!document.getElementById('perf-player'),
      layer: !!document.getElementById('perf-danmaku-layer'),
      diagnostics: !!window.OB.diagnostics,
      rulesDisabled: !window.OB.danmakuRules.hasEnabled('douyin'),
    }));
    if (!setup.player || !setup.layer || !setup.diagnostics || !setup.rulesDisabled) {
      report.fail.push('fixture setup: ' + JSON.stringify(setup));
    } else {
      const metricStatus = await page.evaluate(() => {
        window.OB.Store.setSetting('skipCap', 7);
        window.OB.Store.setSetting('skipCap', 6);
        for (let index = 0; index < 24; index++) {
          window.OB.logs.record('test.performance.metric', { safeCount:index }, {
            force:true, deferFlush:true,
          });
        }
        window.OB.logs.flush();
        return {
          storage: window.OB.Store.storageStatus(),
          logs: window.OB.logs.status(),
        };
      });
      const persist = metricStatus.storage && metricStatus.storage.persist;
      const logMetrics = metricStatus.logs && metricStatus.logs.metrics;
      if (persist && persist.count >= 2 && persist.lastPayloadChars > 0
        && Number.isFinite(persist.lastDurationMs) && persist.maxDurationMs >= persist.lastDurationMs
        && logMetrics && logMetrics.flushes >= 1 && logMetrics.storageWrites >= 2
        && logMetrics.storageCharsWritten > 0 && Number.isFinite(logMetrics.lastFlushDurationMs)
        && logMetrics.maxFlushDurationMs >= logMetrics.lastFlushDurationMs) {
        report.pass.push('名单持久化与日志分片分别暴露耗时、写入次数和序列化体积指标');
      } else {
        report.fail.push('存储/日志性能指标不完整：' + JSON.stringify(metricStatus));
      }

      // 日志分片上限回归：用延迟写入一次性制造略超上限的人工事件，确认只保留
      // 最近 MAX_EVENTS_PER_DAY 条；这条断言也保护 trimAndWriteShard 不退回逐条 shift。
      const logCap = await page.evaluate(() => {
        const day = new Date().toISOString().slice(0, 10);
        for (let index = 0; index < 50005; index++) {
          window.OB.logs.record('test.performance.log-cap', { safeCount: index }, {
            force: true, deferFlush: true, at: Date.now(),
          });
        }
        window.OB.logs.flush();
        const status = window.OB.logs.status();
        const events = window.OB.logs.eventsForDay(day);
        return {
          events: events.length,
          maxEventsPerDay: status.maxEventsPerDay,
          firstCount: events[0] && events[0].data && events[0].data.safeCount,
          lastCount: events[events.length - 1] && events[events.length - 1].data && events[events.length - 1].data.safeCount,
        };
      });
      if (logCap && logCap.events === logCap.maxEventsPerDay
        && logCap.firstCount === 5 && logCap.lastCount === 50004) {
        report.pass.push('日志分片超限时一次裁剪并保留最近事件，数量和顺序边界稳定');
      } else {
        report.fail.push('日志分片裁剪边界错误：' + JSON.stringify(logCap));
      }

      const bulkCache = await page.evaluate(async () => {
        const manager = window.OB.adapters && window.OB.adapters.douyin && window.OB.adapters.douyin.commentManager;
        if (!manager || typeof manager.collectRecords !== 'function') return { supported: false };
        const original = manager.collectRecords;
        let collections = 0;
        manager.collectRecords = function (...args) {
          collections++;
          return original.apply(this, args);
        };
        const comment = document.createElement('div');
        comment.className = 'comment-item';
        comment.innerHTML = '<a href="/user/perf?sec_uid=perf-cache-author">性能缓存夹具</a><span>首条评论</span>';
        document.getElementById('app-shell').appendChild(comment);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const afterInsert = collections;
        for (let index = 0; index < 4; index++) {
          window.OB.refreshBulk();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        const afterRefreshes = collections;
        comment.appendChild(document.createTextNode('更新'));
        window.OB.refreshBulk();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const afterMutation = collections;
        manager.collectRecords = original;
        return { supported: true, afterInsert, afterRefreshes, afterMutation };
      });
      if (bulkCache && bulkCache.supported && bulkCache.afterInsert >= 1
        && bulkCache.afterRefreshes === bulkCache.afterInsert
        && bulkCache.afterMutation > bulkCache.afterRefreshes) {
        report.pass.push('评论批量入口缓存只在评论活动时重新收集，不因重复刷新反复深扫');
      } else if (bulkCache && bulkCache.supported) {
        report.fail.push('评论批量入口缓存未按脏标记工作：' + JSON.stringify(bulkCache));
      }

      await resetDiagnostics(page);
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const noise = document.createElement('section');
        noise.id = 'perf-unrelated-region';
        document.body.appendChild(noise);
        // 多批次无关页面变化：主扫描器应只观察到无匹配节点，不消费播放器根。
        for (let batch = 0; batch < 18; batch++) {
          const fragment = document.createDocumentFragment();
          for (let index = 0; index < 40; index++) {
            const node = document.createElement('div');
            node.className = 'unrelated-platform-node';
            node.textContent = 'noise-' + batch + '-' + index;
            fragment.appendChild(node);
          }
          noise.appendChild(fragment);
          await sleep(18);
        }
        await sleep(350);
      });
      const unrelated = await snapshot(page);

      await resetDiagnostics(page);
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const layer = document.getElementById('perf-danmaku-layer');
        for (let batch = 0; batch < 12; batch++) {
          const fragment = document.createDocumentFragment();
          for (let index = 0; index < 25; index++) {
            const node = document.createElement('div');
            node.className = 'danmaku-item';
            node.setAttribute('data-danmu-id', 'perf-' + batch + '-' + index);
            node.setAttribute('data-danmaku-user-id', String(700000 + batch * 25 + index));
            node.textContent = '性能回归弹幕 ' + batch + '-' + index;
            fragment.appendChild(node);
          }
          layer.appendChild(fragment);
          await sleep(24);
        }
        await sleep(450);
      });
      const incremental = await snapshot(page);

      const visibility = await page.evaluate(async () => {
        const d = window.OB.diagnostics;
        const before = d.scannerItemsProcessed || 0;
        let supported = false;
        let resumed = false;
        try {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          supported = document.visibilityState === 'hidden' && document.hidden === true;
          document.dispatchEvent(new Event('visibilitychange'));
          const extra = document.createElement('div');
          extra.className = 'danmaku-item';
          extra.setAttribute('data-danmu-id', 'perf-hidden');
          extra.setAttribute('data-danmaku-user-id', '799999');
          document.getElementById('perf-danmaku-layer').appendChild(extra);
          await new Promise((resolve) => setTimeout(resolve, 240));
        } catch (error) {
          supported = false;
        } finally {
          try { delete document.visibilityState; } catch (error) {}
          try { delete document.hidden; } catch (error) {}
          document.dispatchEvent(new Event('visibilitychange'));
        }
        const hiddenAfter = d.scannerItemsProcessed || 0;
        if (supported) {
          const resumedNode = document.createElement('div');
          resumedNode.className = 'danmaku-item';
          resumedNode.setAttribute('data-danmu-id', 'perf-resumed');
          resumedNode.setAttribute('data-danmaku-user-id', '799998');
          document.getElementById('perf-danmaku-layer').appendChild(resumedNode);
          await new Promise((resolve) => setTimeout(resolve, 420));
          resumed = (d.scannerItemsProcessed || 0) > before;
        }
        return { supported, before, hiddenAfter, after: d.scannerItemsProcessed || 0, resumed };
      });

      if (unrelated && unrelated.activeVideoRootComputations <= 1
        && unrelated.douyinDanmakuCollections === 0 && unrelated.douyinAutoScans === 0
        && unrelated.scannerItemsProcessed === 0) {
        report.pass.push('无关 DOM 批次不会唤起抖音播放器深扫或自动规则扫描');
      } else report.fail.push('无关 DOM 变化触发了额外工作：' + JSON.stringify(unrelated));

      if (incremental && incremental.activeVideoRootComputations <= 2
        && incremental.douyinDanmakuCollections === 0 && incremental.douyinAutoScans === 0
        && incremental.douyinDanmakuItems === 0
        && incremental.scannerIncrementalScans <= 16
        && incremental.scannerItemsProcessed >= 250
        && incremental.scannerMutationCallbacks > 0 && incremental.scannerMutationRecords > 0
        && incremental.scannerMutationMaxDurationMs < 100
        && incremental.scannerDirtyRootMaxDurationMs < 100
        && incremental.scannerScanMaxDurationMs < 250) {
        report.pass.push('弹幕增量按批处理，活动根节点计算不随弹幕条数线性放大');
      } else report.fail.push('弹幕增量调度边界异常：' + JSON.stringify(incremental));

      if (!visibility.supported || (visibility.hiddenAfter === visibility.before && visibility.resumed)) {
        report.pass.push(visibility.supported
          ? '后台标签页暂停消费 MutationObserver 变化'
          : '当前 Chromium 不允许夹具覆盖页面可见性，后台暂停由 Page Visibility 真实事件门禁');
      } else report.fail.push('后台状态仍处理了新增弹幕：' + JSON.stringify(visibility));
    }
    await page.close();
  } catch (error) {
    report.errors.push(String(error && error.stack || error));
  }
  try { await browser.close(); } catch (error) {}
  console.log('==== OmniBlock 性能边界回归 ====', report.pass.length ? '' : '');
  console.log('PASS:', report.pass.length); report.pass.forEach((line) => console.log('  PASS', line));
  console.log('FAIL:', report.fail.length); report.fail.forEach((line) => console.log('  FAIL', line));
  console.log('ERRORS:', report.errors.length); report.errors.forEach((line) => console.log('  ', line));
  process.exit(report.fail.length || report.errors.length ? 1 : 0);
})().catch((error) => { console.error('HARNESS ERROR:', error); process.exit(2); });

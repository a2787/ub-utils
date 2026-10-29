/* OB-BRIDGE-001 + OB-STORE-001 回归（专用开发扩展夹具模式）。
 *
 * Phase A（OB-BRIDGE-001，桥接 ready 快照分块 + 孤儿分片日期清理）：
 *   复现 2026-09-12 起六平台 degraded 的 H1 根因——白名单总量超过主世界
 *   verifyEnvelope 的 8MiB 信封上限（MAX_VALUE_CHARS*2=8,388,608 字符）时，
 *   旧实现的单信封 ready-response 8 次尝试全部被拒，页面永久 degraded。
 *   夹具经扩展 service worker 直接向 chrome.storage.local 写入 3 个各
 *   3,000,000 字符的白名单事件分片（≈9.0M 字符，超限 9%，与生产实测同构）+
 *   2 个合成人物种子名单/快照 + 一个 40 天前、不在索引里的“孤儿”事件分片。
 *   断言（旧行为上失败）：
 *     BR-1  页面 bridge.state === 'ready'（旧：ready-timeout degraded）；
 *     BR-2  Store 能读回 2 个种子人物（旧：空态 0 人）；
 *     BR-3  storageStatus().degraded === false（旧：无字段/true）；
 *     BR-4  40 天前的孤儿分片被 rotate 的日期口径清理删除（旧：永久残留）；
 *     BR-5  ready 放行对照（OB-DEF-001 在 ready 状态解除）：setSetting 成功且
 *           落盘的 data:v1 同时含新设置与种子人物（旧：空态覆盖种子）。
 *
 * Phase B（OB-STORE-001，degraded 只读降级回归保留）：
 *   分块修复后，>8MiB 存储的匹配页面会正常 ready，无法再用它构造 degraded。
 *   这里改用 dev-extension 同款 fallback 夹具：把 runtime-main.js 注入不匹配
 *   扩展 content script 的页面（example.com），隔离桥不存在 → 8 次握手超时 →
 *   degraded，且桥接门控字面量仍由 dev-extension.cjs 源码级断言锁定。
 *   说明：OB-STORE-001 的“活桥 degraded 空态覆盖真实名单”旧行为已于 2026-10-30
 *   用 >8MiB 夹具（当时会 degraded 且隔离桥存活转发写入）留证（data:v1 SHA-256
 *   6be1e28e…→4186f9d7…、backup:v1 468→2,365 字节）；fallback 页面没有活桥，
 *   字节不变断言在旧代码上也会通过，本轮保留它验证最终状态与只读降级 UI。
 *   断言：
 *     STORE-1  runtime.storageDegraded === true 且写路径拒写（lastError 等）；
 *     STORE-2  主世界 shim 在 !ready 拒写并计数（blockedWrites ≥ 1）；
 *     STORE-3  面板顶部只读降级警示 + 浮条可关闭而面板警示保留；
 *     STORE-4  chrome.storage 的 data:v1/backup:v1 字节不变。
 * 运行：node test/degraded-storage.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchPersistentChromium, ROOT, EDGE_PATH, CHROME_PATH } = require('./runtime.cjs');

const buildScript = path.join(ROOT, 'test', 'build-dev-extension.cjs');
const build = JSON.parse(execFileSync(process.execPath, [buildScript], { cwd: ROOT, encoding: 'utf8' }));
const extensionDir = path.join(ROOT, 'test', '_dev-extension');
// 当前 Google Chrome 148 会忽略命令行 unpacked-extension 开关；Edge/Chromium
// 仍支持它们，与 test/dev-extension.cjs 保持同一选择逻辑。
const extensionBrowserPath = process.env.OMNIBLOCK_EXTENSION_BROWSER_PATH || EDGE_PATH || CHROME_PATH || '';
const fixtureUrl = 'https://www.bilibili.com/omniblock-degraded-fixture';
// Phase B 的 fallback 用 http:// 的 bilibili 页面：userscript 平台适配器按
// hostname 匹配（设置齿轮/浮条会挂载），而扩展 content script 只匹配 https
// ——该页面因此有平台 UI 但没有隔离桥，注入 runtime-main 后 8 次握手超时 →
// degraded，且 UI 断言可达。
const fallbackUrl = 'http://www.bilibili.com/omniblock-degraded-fallback-fixture';
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>OmniBlock degraded storage fixture</title></head>
<body><main data-ob-fixture="artificial"><h1>人工合成降级存储回归页面</h1><p>不包含真实作品或账号标识；名单种子均为人工合成。</p></main></body></html>`;
const DEGRADED_NOTICE = '存储桥接未就绪，本页为只读降级模式：名单与设置变更不会保存';
const SHARD_CHARS = 3 * 1000 * 1000; // 3 分片共 ≈9.0M 字符，越过 8,388,608 信封上限
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDay(offsetDays) {
  return new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

(async () => {
  const report = { pass: [], fail: [], pageErrors: [] };
  const expect = (id, label, ok, detail) => {
    if (ok) report.pass.push(id + ' ' + label);
    else report.fail.push(id + ' ' + label + (detail === undefined ? '' : '：' + JSON.stringify(detail)));
  };
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniblock-degraded-'));
  let context;
  let swWorker = null;
  try {
    context = await launchPersistentChromium(profileDir, {
      headless: false,
      ...(extensionBrowserPath ? { executablePath: extensionBrowserPath } : {}),
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
        '--window-position=-32000,-32000',
        '--load-extension=' + extensionDir,
      ],
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(fixtureUrl) || url.startsWith(fallbackUrl)) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
      }
      // 只阻断人工页面的外部网络；chrome-extension:// 资源不得拦截。
      return /^https?:/i.test(url) ? route.abort() : route.continue();
    });

    // ---- service worker 访问：seeding 与 chrome.storage 字节断言都经 SW 完成。
    async function getSw() {
      if (swWorker) {
        try { await swWorker.evaluate(() => 1); return swWorker; } catch (error) { swWorker = null; }
      }
      const existing = context.serviceWorkers();
      if (existing.length) { swWorker = existing[existing.length - 1]; return swWorker; }
      swWorker = await context.waitForEvent('serviceworker', { timeout: 20000 });
      return swWorker;
    }
    async function storageDigest() {
      const worker = await getSw();
      return worker.evaluate(async () => {
        const values = await chrome.storage.local.get(null);
        const hex = async (key) => {
          const raw = values[key] == null ? '' : String(values[key]);
          const bytes = new TextEncoder().encode(raw);
          const mac = await crypto.subtle.digest('SHA-256', bytes);
          return Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        let dataPersons = -1;
        try { dataPersons = Object.keys(JSON.parse(String(values['omniblock:data:v1'] || '{}')).persons || {}).length; } catch (error) {}
        return {
          keys: Object.keys(values).sort(),
          dataSha: await hex('omniblock:data:v1'),
          backupSha: await hex('omniblock:backup:v1'),
          dataLen: values['omniblock:data:v1'] == null ? -1 : String(values['omniblock:data:v1']).length,
          dataPersons,
        };
      });
    }
    const seedPersons = {
      p_seed1: { label: '合成名单A', note: '', createdAt: 1700000000000, hits: 0, identities: ['bili:uid:10001'] },
      p_seed2: { label: '合成名单B', note: '', createdAt: 1700000000100, hits: 0, identities: ['bili:uid:10002'] },
    };
    const seedSnapshot = {
      format: 'omniblock.snapshot', schema: 1, snapshotId: 's_seed0000000_seedaa',
      revision: 1700000000000, exportedAt: 1700000000000, source: 'local', reason: 'seed', version: 1,
      persons: seedPersons, settings: {},
    };
    async function seedCoreStorage(worker) {
      return worker.evaluate(async (seed) => {
        const entries = {
          'omniblock:data:v1': JSON.stringify({ version: 1, persons: seed.persons, settings: {} }),
          'omniblock:backup:v1': JSON.stringify({ format: 'omniblock.snapshot', schema: 1, snapshots: [seed.snapshot] }),
        };
        await chrome.storage.local.set(entries);
        return true;
      }, { persons: seedPersons, snapshot: seedSnapshot });
    }

    // ================= Phase A（OB-BRIDGE-001） =================
    const seeded = await getSw().then((worker) => worker.evaluate(async (seed) => {
      const entries = {
        'omniblock:data:v1': JSON.stringify({ version: 1, persons: seed.persons, settings: {} }),
        'omniblock:backup:v1': JSON.stringify({ format: 'omniblock.snapshot', schema: 1, snapshots: [seed.snapshot] }),
      };
      for (const day of seed.days) entries['omniblock:events:v1:' + day] = 'x'.repeat(3000000);
      // 40 天前、不写入索引的“孤儿”事件分片（旧 rotate 只裁剪索引内日期，永远清不掉它）。
      entries['omniblock:events:v1:' + seed.orphanDay] = JSON.stringify({
        format: 'omniblock.events', schema: 1, day: seed.orphanDay,
        events: [{ id: 'synthetic_orphan_1', at: 1, type: 'synthetic.orphan', data: {} }],
      });
      await chrome.storage.local.set(entries);
      const values = await chrome.storage.local.get(null);
      return { keys: Object.keys(values).sort(), orphanDay: seed.orphanDay };
    }, { persons: seedPersons, snapshot: seedSnapshot, days: [isoDay(1), isoDay(2), isoDay(3)], orphanDay: isoDay(40) }));
    const orphanKey = 'omniblock:events:v1:' + seeded.orphanDay;
    expect('FIX-0a', '种子写入成功（>8MiB 分片 + 2 人名单 + 快照 + 孤儿分片）',
      seeded.keys.includes(orphanKey) && seeded.keys.includes('omniblock:backup:v1')
      && seeded.keys.filter((key) => /^omniblock:events:v1:/.test(key)).length === 4, seeded.keys);

    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push('ready: ' + String(error)));
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__OB_EXTENSION_RUNTIME__
      && window.__OB_EXTENSION_RUNTIME__.bridge
      && ['ready', 'degraded'].includes(window.__OB_EXTENSION_RUNTIME__.bridge.state), null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.OB, null, { timeout: 15000 });
    await sleep(500);
    const bridgeState = await page.evaluate(() => ({
      state: window.__OB_EXTENSION_RUNTIME__.bridge.state,
      attempts: window.__OB_EXTENSION_RUNTIME__.bridge.attempts,
      reason: window.__OB_EXTENSION_RUNTIME__.bridge.reason,
    }));
    expect('BR-1', '>8MiB 白名单总量下桥接经分块快照就绪（旧：单信封 8 次全拒永久 degraded）',
      bridgeState.state === 'ready', bridgeState);
    const readBack = await page.evaluate(() => {
      const persons = window.OB.Store.persons();
      return {
        personCount: Object.keys(persons).length,
        labels: Object.values(persons).map((person) => person.label).sort(),
        degraded: window.OB.Store.storageStatus().degraded,
      };
    });
    expect('BR-2', 'ready 后 Store 读回 2 个种子人物（真实名单不再以空态呈现）',
      readBack.personCount === 2 && readBack.labels.join(',') === '合成名单A,合成名单B', readBack);
    expect('BR-3', 'storageStatus().degraded === false', readBack.degraded === false, readBack);
    const afterSweep = await storageDigest();
    expect('BR-4', '40 天前不在索引里的孤儿事件分片被 rotate 日期口径清理',
      !afterSweep.keys.includes(orphanKey), { orphanKey, keys: afterSweep.keys });
    const controlWrite = await page.evaluate(() => window.OB.Store.setSetting('skipCap', 21));
    await sleep(300);
    const afterControl = await getSw().then((worker) => worker.evaluate(async () => {
      const raw = String((await chrome.storage.local.get('omniblock:data:v1'))['omniblock:data:v1'] || '');
      return { hasSkipCap: raw.includes('"skipCap":21'), hasSeed: raw.includes('合成名单A') && raw.includes('合成名单B'), len: raw.length };
    }));
    expect('BR-5', 'ready 放行对照：setSetting 落盘且种子名单未被覆盖（OB-DEF-001 只读降级在 ready 状态解除）',
      controlWrite === true && afterControl.hasSkipCap && afterControl.hasSeed,
      { controlWrite, afterControl });
    await page.close();

    // ================= Phase B（OB-STORE-001，fallback degraded） =================
    await seedCoreStorage(await getSw());
    const baseline = await storageDigest();
    const runtimeMain = fs.readFileSync(path.join(extensionDir, 'runtime-main.js'), 'utf8');
    const fallback = await context.newPage();
    fallback.on('pageerror', (error) => report.pageErrors.push('fallback: ' + String(error)));
    await fallback.addInitScript({ content: runtimeMain });
    await fallback.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
    await fallback.waitForFunction(() => !!window.__OB_EXTENSION_RUNTIME__
      && window.__OB_EXTENSION_RUNTIME__.bridge
      && window.__OB_EXTENSION_RUNTIME__.bridge.state === 'degraded', null, { timeout: 30000 });
    await fallback.waitForFunction(() => !!window.OB, null, { timeout: 15000 });
    await sleep(300);
    const writeState = await fallback.evaluate(() => {
      const setOk = window.OB.Store.setSetting('skipCap', 11);
      const add = window.OB.Store.addIdentities(['bili:uid:90001'], '合成降级写入');
      window.OB.Store.ensureLocalBackup();
      window.OB.logs.record('degraded.probe', {}, { immediate: true });
      const status = window.OB.Store.storageStatus();
      return {
        runtimeDegraded: window.OB.runtime.storageDegraded === true,
        degraded: status.degraded === true,
        lastError: status.persist.lastError,
        setOk,
        addPersisted: add.persisted,
        blockedWrites: window.__OB_EXTENSION_RUNTIME__.bridge.blockedWrites,
      };
    });
    await sleep(500);
    expect('STORE-1', 'fallback 页 degraded：runtime/Store 标记只读降级且写路径拒写',
      writeState.runtimeDegraded && writeState.degraded && writeState.lastError === 'storage-degraded-readonly'
      && writeState.setOk === false && writeState.addPersisted === false,
      writeState);
    expect('STORE-2', '主世界 GM shim 在 !ready 时拒绝写入并计数（防御层 2a）',
      Number(writeState.blockedWrites) >= 1, writeState);

    const floatBefore = await fallback.evaluate(() => !!document.getElementById('ob-degraded-float'));
    // 旧代码没有浮条/横幅，面板交互可能不可达：所有点击走 tryClick 短超时，
    // 失败时断言按 false 记录而不是卡死整个回归。
    const tryClick = async (target, selector) => {
      try { await target.click(selector, { timeout: 5000 }); return true; } catch (error) { return false; }
    };
    if (floatBefore) {
      // 面板是全屏模态遮罩，会盖住浮条；先关浮条再开面板。
      await tryClick(fallback, '#ob-degraded-float .ob-degraded-float-close');
      await sleep(150);
    }
    const floatAfterClose = await fallback.evaluate(() => !!document.getElementById('ob-degraded-float'));
    const gearOpened = await tryClick(fallback, '#ob-gear');
    let panelFirst = { bannerVisible: false, noticeMatch: false };
    let bannerReopen = false;
    if (gearOpened) {
      try {
        await fallback.waitForSelector('#ob-panel .ob-box', { timeout: 8000 });
        panelFirst = await fallback.evaluate((notice) => {
          const banner = document.getElementById('ob-degraded-banner');
          const status = document.getElementById('ob-storage-status');
          return {
            bannerVisible: !!banner && banner.style.display !== 'none',
            noticeMatch: !!banner && banner.textContent.includes(notice)
              && !!status && status.textContent.includes(notice),
          };
        }, DEGRADED_NOTICE);
        if (await tryClick(fallback, '#ob-panel .ob-close')) await sleep(150);
        if (await tryClick(fallback, '#ob-gear')) {
          await fallback.waitForSelector('#ob-panel .ob-box', { timeout: 8000 });
          bannerReopen = await fallback.evaluate((notice) => {
            const banner = document.getElementById('ob-degraded-banner');
            return !!banner && banner.style.display !== 'none' && banner.textContent.includes(notice);
          }, DEGRADED_NOTICE);
        }
      } catch (error) { /* 断言按已采集的 false 记录 */ }
    }
    expect('STORE-3', '面板顶部出现只读降级持续警示且关闭浮条后保留',
      panelFirst.bannerVisible && panelFirst.noticeMatch && floatBefore && !floatAfterClose && bannerReopen,
      { panelFirst, floatBefore, floatAfterClose, bannerReopen });
    await fallback.close();

    const finalDigest = await storageDigest();
    expect('STORE-4', 'degraded 页面写入后 chrome.storage 的 data:v1/backup:v1 字节不变',
      finalDigest.dataSha === baseline.dataSha && finalDigest.backupSha === baseline.backupSha
      && finalDigest.dataPersons === 2,
      { baseline, final: finalDigest });
  } catch (error) {
    report.fail.push(String(error && error.stack || error));
  } finally {
    if (context) { try { await context.close(); } catch (error) {} }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (error) {}
  }

  console.log('==== OmniBlock 桥接分块就绪 + degraded 只读降级回归（OB-BRIDGE-001 / OB-STORE-001） ====');
  console.log('BROWSER:', path.basename(extensionBrowserPath || 'playwright-default'));
  console.log('FIXTURE: artificial oversized-storage + bridgeless fallback documents, synthetic seeds only');
  console.log('PASS:', report.pass.length); report.pass.forEach((item) => console.log('  ✅', item));
  console.log('FAIL:', report.fail.length); report.fail.forEach((item) => console.log('  ❌', item));
  console.log('PageErrors:', report.pageErrors.length); report.pageErrors.forEach((item) => console.log('  ·', item));
  const ok = report.fail.length === 0 && report.pageErrors.length === 0;
  console.log(ok ? '\nRESULT: STRUCTURE REGRESSION PASSED' : '\nRESULT: STRUCTURE REGRESSION FAILED');
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error('HARNESS ERROR:', error);
  process.exit(2);
});

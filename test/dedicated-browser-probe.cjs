/* 专用 Chrome 登录态只读探针。
 *
 * 它连接当前用户明确授权的 browser-harness Chrome，使用同一 profile 的
 * 已安装开发扩展读取六个平台页面实际出现的语义记录。不会注入源码、读取
 * Cookie 或点击平台写入控件。缺少 CDP、扩展未加载、页面门禁和当前无内容
 * 都分别输出为 blocked/failed，不能被夹具数字替代。
 *
 * 运行：
 *   node test/dedicated-browser-probe.cjs --self-test
 *   node test/dedicated-browser-probe.cjs
 */
'use strict';

const { runDedicatedProbe, selfTest } = require('./dedicated-browser.cjs');

if (process.argv.includes('--self-test')) {
  const failures = selfTest();
  if (failures.length) {
    console.error('FAIL:', failures.join('；'));
    process.exit(1);
  }
  console.log('PASS: dedicated browser probe classification 8/8');
  process.exit(0);
}

(async () => {
  const report = await runDedicatedProbe();
  console.log('PROBE dedicated: ' + JSON.stringify(report));
  for (const item of report.platforms || []) {
    const pages = [item.entry, item.content].filter(Boolean);
    const verified = pages.filter((page) => page.ai && page.ai.total > 0);
    if (verified.length) {
      console.log('EVIDENCE: real-site verified - ' + item.id + ' 专用 Chrome 只读读取 '
        + verified.map((page) => page.route + ' content=' + page.ai.total
          + ' users=' + page.users + ' byKind=' + JSON.stringify(page.ai.byKind)).join('；'));
    }
    for (const reason of item.reasons || []) console.log('EVIDENCE: blocked - ' + item.id + '：' + reason);
    for (const error of item.errors || []) console.log('EVIDENCE: failed - ' + item.id + '：' + error);
  }
  for (const error of report.errors || []) {
    const prefix = String(error).startsWith('blocked：') ? 'blocked' : 'failed';
    console.log('EVIDENCE: ' + prefix + ' - dedicated：' + String(error).replace(/^(?:blocked|failed)：/, ''));
  }
  const failed = (report.errors || []).some((error) => !String(error).startsWith('blocked：'))
    || report.platforms.some((item) => item.status === 'failed');
  const blocked = (report.errors || []).some((error) => String(error).startsWith('blocked：'))
    || report.platforms.some((item) => item.status === 'blocked');
  if (failed) {
    console.log('RESULT: DEDICATED REAL-SITE PROBE FAILED');
    process.exit(1);
  }
  if (blocked) {
    console.log('RESULT: DEDICATED REAL-SITE PROBE BLOCKED');
    process.exit(2);
  }
  console.log('RESULT: DEDICATED REAL-SITE PROBE VERIFIED');
  process.exit(0);
})().catch((error) => {
  console.error('EVIDENCE: failed - dedicated：' + String(error && error.message || error).slice(0, 240));
  console.log('RESULT: DEDICATED REAL-SITE PROBE FAILED');
  process.exit(1);
});

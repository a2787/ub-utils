/*
 * OmniBlock 维护闭环：默认由维护者运行，不依赖用户 Tampermonkey 已安装版本。
 * 它会顺序执行静态门禁、userscript 直连/同步产品回归、通用/平台回归、作品级屏蔽回归、性能边界、微博虚拟列表回放和
 * 隔离真站探针。上一轮 MV3/网关检查仍保留在仓库中，但不再是当前交付链；
 * 加 --dedicated 后，追加当前用户授权的专用 Chrome 登录态只读探针；
 * --dedicated-only 则只保留本地门禁和专用链路，避免匿名探针阻断混入当前登录态结论。
 * 运行：node test/maintenance-check.cjs [--dedicated|--dedicated-only]
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./runtime.cjs');

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
function collectMarkdownFiles(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(child);
    return entry.isFile() && /\.md$/i.test(entry.name) ? [child.replace(/\\/g, '/')] : [];
  });
}
const privacyFiles = [...new Set([...trackedFiles, ...collectMarkdownFiles('docs')])]
  .filter((name) => /^(?:README\.md|CHANGELOG\.md|MAINTENANCE\.md|AGENTS\.md|docs\/.*\.md|omniblock\.user\.js|test\/.*\.cjs)$/.test(name));
for (const extra of ['test/comment-manager.cjs', 'test/weibo-replay.cjs', 'test/danmaku-auto.cjs', 'test/work-block.cjs',
  'test/maintenance-check.cjs', 'test/build-dev-extension.cjs', 'test/dev-extension.cjs', 'test/installed-browser-probe.cjs',
  'test/dev-browser.cjs', 'test/dedicated-browser.cjs', 'test/dedicated-browser-probe.cjs',
  'test/performance.cjs', 'test/ai-screening.cjs', 'test/ai-prompt-system.cjs', 'test/ai-prompt-eval.cjs', 'test/ai-platforms.cjs', 'test/content-ai.cjs', 'test/ai-autoload.cjs', 'test/ai-watchdog.cjs', 'test/gateway-smoke.cjs', 'gateway/scripts/render-config.cjs',
  'test/content-coverage.cjs', 'test/probe-hygiene.cjs', 'test/product-extension.cjs', 'test/userscript-product.cjs', 'test/sync.cjs', 'test/sync-server.cjs',
  'sync-server/server.py', 'sync-server/README.md']) {
  if (!privacyFiles.includes(extra)) privacyFiles.push(extra);
}
const privacyPatterns = [
  /BV[0-9A-Za-z]{8,}/,
  /weibo\.com\/[0-9]{5,}\//,
  /space\.bilibili\.com\/[0-9]{5,}/,
];
const privacyHits = [];
for (const relative of privacyFiles) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (privacyPatterns.some((pattern) => pattern.test(text))) privacyHits.push(relative);
}

const checks = [
  { label: 'userscript syntax', command: process.execPath, args: ['--check', 'omniblock.user.js'] },
  { label: 'documentation governance', command: process.execPath, args: ['test/docs-check.cjs'] },
  { label: 'comment manager syntax', command: process.execPath, args: ['--check', 'test/comment-manager.cjs'] },
  { label: 'automatic danmaku rules syntax', command: process.execPath, args: ['--check', 'test/danmaku-auto.cjs'] },
  { label: 'work block syntax', command: process.execPath, args: ['--check', 'test/work-block.cjs'] },
  { label: 'installed browser probe syntax', command: process.execPath, args: ['--check', 'test/installed-browser-probe.cjs'] },
  { label: 'dedicated browser probe syntax', command: process.execPath, args: ['--check', 'test/dedicated-browser.cjs'] },
  { label: 'dedicated browser probe wrapper syntax', command: process.execPath, args: ['--check', 'test/dedicated-browser-probe.cjs'] },
  { label: 'AI platform regression syntax', command: process.execPath, args: ['--check', 'test/ai-platforms.cjs'] },
  { label: 'content AI regression syntax', command: process.execPath, args: ['--check', 'test/content-ai.cjs'] },
  { label: 'multi-platform content coverage syntax', command: process.execPath, args: ['--check', 'test/content-coverage.cjs'] },
  { label: 'userscript product regression syntax', command: process.execPath, args: ['--check', 'test/userscript-product.cjs'] },
  { label: 'AI Douyin autoload syntax', command: process.execPath, args: ['--check', 'test/ai-autoload.cjs'] },
  { label: 'generic UI/state', command: process.execPath, args: ['test/run.cjs'] },
  { label: 'core state', command: process.execPath, args: ['test/state.cjs'] },
  { label: 'Bilibili', command: process.execPath, args: ['test/quickblock.cjs'] },
  { label: 'automatic danmaku rules', command: process.execPath, args: ['test/danmaku-auto.cjs'] },
  { label: 'unified comment manager', command: process.execPath, args: ['test/comment-manager.cjs'] },
  { label: 'work block', command: process.execPath, args: ['test/work-block.cjs'] },
  { label: 'performance boundaries', command: process.execPath, args: ['test/performance.cjs'] },
  { label: 'userscript product regression', command: process.execPath, args: ['test/userscript-product.cjs'] },
  { label: 'account sync protocol', command: process.execPath, args: ['test/sync.cjs'] },
  { label: 'independent Python sync server', command: process.execPath, args: ['test/sync-server.cjs'] },
  { label: 'AI screening', command: process.execPath, args: ['test/ai-screening.cjs'] },
  { label: 'AI prompt system', command: process.execPath, args: ['test/ai-prompt-system.cjs'] },
  { label: 'AI prompt offline evaluation syntax', command: process.execPath, args: ['--check', 'test/ai-prompt-eval.cjs'] },
  { label: 'AI prompt offline evaluation', command: process.execPath, args: ['test/ai-prompt-eval.cjs'] },
  { label: 'AI platform collection', command: process.execPath, args: ['test/ai-platforms.cjs'] },
  { label: 'content AI', command: process.execPath, args: ['test/content-ai.cjs'] },
  { label: 'multi-platform content coverage', command: process.execPath, args: ['test/content-coverage.cjs'] },
  { label: 'AI Douyin autoload', command: process.execPath, args: ['test/ai-autoload.cjs'] },
  { label: 'AI request watchdog', command: process.execPath, args: ['test/ai-watchdog.cjs'] },
  { label: 'probe hygiene', command: process.execPath, args: ['test/probe-hygiene.cjs'] },
  { label: 'dedicated browser probe classification', command: process.execPath, args: ['test/dedicated-browser-probe.cjs', '--self-test'] },
  { label: 'cross-platform adapters', command: process.execPath, args: ['test/adapters.cjs'] },
  { label: 'Bilibili isolated real-site probe', command: process.execPath, args: ['test/real-bilibili-probe.cjs', '--verify-local'] },
  { label: 'Douyin feed', command: process.execPath, args: ['test/douyin.cjs'] },
  { label: 'Douyin isolated real-site probe', command: process.execPath, args: ['test/real-platform-probe.cjs', 'douyin', '--verify-local'] },
  { label: 'Weibo replay stress', command: process.execPath, args: ['test/weibo-replay.cjs'] },
  { label: 'Weibo isolated real-site probe', command: process.execPath, args: ['test/real-platform-probe.cjs', 'weibo', '--verify-local'] },
  { label: 'diff whitespace', command: 'git', args: ['diff', '--check'] },
];

const dedicated = process.argv.includes('--dedicated') || process.argv.includes('--dedicated-only');
if (process.argv.includes('--dedicated-only')) {
  for (let index = checks.length - 1; index >= 0; index--) {
    if (/ isolated real-site probe$/.test(checks[index].label)) checks.splice(index, 1);
  }
}
if (dedicated) {
  checks.push({ label: 'legacy dedicated Chrome harness sync', command: process.execPath,
    args: ['test/dev-browser.cjs', 'sync'] });
  checks.push({ label: 'dedicated Chrome login-state real-site probe', command: process.execPath,
    args: ['test/dedicated-browser-probe.cjs'] });
}

if (privacyHits.length) {
  console.error('PRIVACY GATE FAILED:', privacyHits.join(', '));
  process.exit(1);
}

let failed = false;
const blocked = [];
for (const check of checks) {
  console.log('\n=== ' + check.label + ' ===');
  if (check.label === 'legacy dedicated Chrome harness sync') {
    const result = spawnSync(check.command, check.args, { cwd: ROOT, encoding: 'utf8', env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      failed = true;
      console.error('CHECK FAILED:', check.label, result.error.message);
    } else if (result.status === 2) {
      blocked.push('历史专用 Chrome 扩展夹具需要一次性加载或当前 CDP 不可用；详见上方 sync 结果');
    } else if (result.status !== 0) {
      failed = true;
      console.error('CHECK FAILED:', check.label, 'exit ' + result.status);
    }
    continue;
  }
  if (check.label === 'dedicated Chrome login-state real-site probe') {
    const result = spawnSync(check.command, check.args, { cwd: ROOT, encoding: 'utf8', env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      failed = true;
      console.error('CHECK FAILED:', check.label, result.error.message);
    } else if (result.status === 2) {
      blocked.push('专用 Chrome 登录态探针存在外部门禁或当前页面无内容；详见上方 dedicated evidence');
    } else if (result.status !== 0) {
      failed = true;
      console.error('CHECK FAILED:', check.label, 'exit ' + result.status);
    }
    continue;
  }
  const isolatedProbe = check.label.match(/^(.+) isolated real-site probe$/);
  if (isolatedProbe) {
    const probeId = isolatedProbe[1].toLowerCase();
    const result = spawnSync(check.command, check.args, { cwd: ROOT, encoding: 'utf8', env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      failed = true;
      console.error('CHECK FAILED:', check.label, result.error.message);
      break;
    }
    const probePrefix = 'PROBE ' + probeId + ': ';
    const probeLines = String(result.stdout || '').split(/\r?\n/).filter((line) => line.startsWith(probePrefix));
    if (probeId === 'bilibili' && !probeLines.length) {
      try {
        const target = JSON.parse(String(result.stdout || '').trim());
        probeLines.push(probePrefix + JSON.stringify({
          discovered: !!target.discovered,
          loaded: !!target.pageLoaded,
          errors: Array.isArray(target.errors) ? target.errors : [],
        }));
      } catch (error) {}
    }
    let sawBlocked = false;
    for (const line of probeLines) {
      try {
        const target = JSON.parse(line.slice(probePrefix.length));
        const errors = Array.isArray(target.errors) ? target.errors : [];
        // 未发现目标或导航根本未完成时，网络拒绝、验证码和登录页都属于证据阻断；
        // 只有已经加载并发现目标后的脚本/页面错误才让维护自检失败。
        const reachabilityBlocked = !target.discovered || !target.loaded
          || errors.some((error) => String(error).startsWith('blocked：'));
        const hardErrors = reachabilityBlocked ? [] : errors.filter((error) => !String(error).startsWith('blocked：'));
        if (hardErrors.length) {
          failed = true;
          console.error('CHECK FAILED:', check.label, hardErrors.join(' | '));
        } else if (reachabilityBlocked) {
          sawBlocked = true;
          blocked.push(errors.join(' | ') || ('未能从公开入口发现可验证' + probeId + '页面'));
        }
      } catch (error) {
        failed = true;
        console.error('CHECK FAILED:', check.label, '无法解析探针结果：' + error.message);
      }
    }
    if (!probeLines.length) {
      failed = true;
      console.error('CHECK FAILED:', check.label, '没有返回' + probeId + '探针结果');
    } else if (result.status !== 0 && !sawBlocked && !failed) {
      failed = true;
      console.error('CHECK FAILED:', check.label, '探针非零退出但没有可归类的 blocked 证据（exit ' + result.status + '）');
    }
    continue;
  }
  const result = spawnSync(check.command, check.args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error('CHECK FAILED:', check.label, result.error ? result.error.message : 'exit ' + result.status);
    break;
  }
}
if (blocked.length) console.log('\nEVIDENCE: blocked - ' + blocked.join(' | '));
if (failed) {
  console.log('\nRESULT: MAINTENANCE SELF-CHECK FAILED');
  process.exit(1);
}
if (blocked.length) {
  console.log('\nRESULT: MAINTENANCE SELF-CHECK BLOCKED');
  process.exit(2);
}
console.log('\nRESULT: MAINTENANCE SELF-CHECK PASSED');
process.exit(0);

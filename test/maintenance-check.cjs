/*
 * OmniBlock 维护闭环：默认由维护者运行，不依赖用户 Tampermonkey 已安装版本。
 * 它会顺序执行静态门禁、通用/平台回归、微博虚拟列表回放和当前源码注入的抖音/微博真站探针。
 * 真实探针仍遵守只读边界；用户浏览器只作为最终环境复核，不是本命令的代码生效前提。
 * 运行：node test/maintenance-check.cjs
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./runtime.cjs');

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
const privacyFiles = trackedFiles.filter((name) => /^(?:README\.md|CHANGELOG\.md|MAINTENANCE\.md|AGENTS\.md|omniblock\.user\.js|test\/.*\.cjs)$/.test(name));
for (const extra of ['test/comment-manager.cjs', 'test/weibo-replay.cjs', 'test/maintenance-check.cjs']) {
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
  { label: 'comment manager syntax', command: process.execPath, args: ['--check', 'test/comment-manager.cjs'] },
  { label: 'generic UI/state', command: process.execPath, args: ['test/run.cjs'] },
  { label: 'core state', command: process.execPath, args: ['test/state.cjs'] },
  { label: 'Bilibili', command: process.execPath, args: ['test/quickblock.cjs'] },
  { label: 'unified comment manager', command: process.execPath, args: ['test/comment-manager.cjs'] },
  { label: 'cross-platform adapters', command: process.execPath, args: ['test/adapters.cjs'] },
  { label: 'Douyin feed', command: process.execPath, args: ['test/douyin.cjs'] },
  { label: 'Douyin isolated real-site probe', command: process.execPath, args: ['test/real-platform-probe.cjs', 'douyin', '--verify-local'] },
  { label: 'Weibo replay stress', command: process.execPath, args: ['test/weibo-replay.cjs'] },
  { label: 'Weibo isolated real-site probe', command: process.execPath, args: ['test/real-platform-probe.cjs', 'weibo', '--verify-local'] },
  { label: 'diff whitespace', command: 'git', args: ['diff', '--check'] },
];

if (privacyHits.length) {
  console.error('PRIVACY GATE FAILED:', privacyHits.join(', '));
  process.exit(1);
}

let failed = false;
const blocked = [];
for (const check of checks) {
  console.log('\n=== ' + check.label + ' ===');
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

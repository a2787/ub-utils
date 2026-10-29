#!/usr/bin/env node
/* OmniBlock v0.63.2 发布脚本（2026-10-30 任务明确授权的发布链）。
 *
 * 用法：node scripts/release-0632.cjs [--dry-run]
 *
 * 步骤（对应任务授权）：
 *   1. 校验工作区干净、HEAD 即功能提交、其树内 omniblock.user.js 为 @version 0.63.2；
 *   2. git tag -a v0.63.2 -m "OmniBlock v0.63.2" <功能提交>（不覆盖既有 tag）；
 *   3. git push origin v0.63.2；
 *   4. gh release create v0.63.2 --title ... --notes-file scripts/release-notes/v0.63.2-release.md；
 *   5. curl 只读核对 raw master 已服务 0.63.2（短重试；仅允许 https + 固定域名，
 *      拒绝 localhost/环回/私有/保留地址）。
 *
 * 所有子进程调用 execFileSync 直传、不经 shell（同 commit-worktree.cjs）。
 */
'use strict';
const { execFileSync } = require('node:child_process');

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');
// 可选 --commit <sha>：tag 指向该提交（默认 HEAD）。用于功能提交之后另有小工具提交、
// 而 tag 必须指向功能提交的场景（2026-10-30 授权语义：tag 指向功能提交）。
const commitArgIdx = process.argv.indexOf('--commit');
const COMMIT_ARG = commitArgIdx > -1 ? process.argv[commitArgIdx + 1] : '';
const TAG = 'v0.63.2';
const TITLE = 'OmniBlock v0.63.2 — 数据安全修复与桥接根因修复（合并发布）';
const NOTES = 'scripts/release-notes/v0.63.2-release.md';
const RAW_URL = 'https://raw.githubusercontent.com/a2787/ub-utils/master/omniblock.user.js';

// 出口校验：仅 https + 明确允许的公开域名，拒绝 localhost/环回/私有/保留地址。
const url = new URL(RAW_URL);
if (url.protocol !== 'https:') throw new Error('raw 核对仅允许 https');
const host = url.hostname;
const BLOCKED = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local');
if (BLOCKED) throw new Error('拒绝 localhost/环回地址');
if (!/^raw\.githubusercontent\.com$/.test(host)) throw new Error('raw 核对域名不在允许名单: ' + host);

const sh = (cmd, args, opts = {}) => {
  const printable = cmd + ' ' + args.join(' ');
  if (DRY && cmd !== 'git') { console.log('[dry-run] ' + printable); return ''; }
  // userscript ≈1MB：默认 1MiB maxBuffer 会 ERR_CHILD_PROCESS_STDIO_MAXBUFFER，放宽到 64MiB
  const out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
  return String(out).trim();
};
const trySh = (cmd, args) => { try { return sh(cmd, args); } catch (e) { return ''; } };

// 1. 工作区与功能提交校验
const status = sh('git', ['status', '--porcelain']);
if (!DRY && status) {
  console.error('工作区不干净，中止（发布脚本要求先由 commit-worktree 完成提交）:\n' + status);
  process.exit(1);
}
const head = COMMIT_ARG ? sh('git', ['rev-parse', '--verify', COMMIT_ARG]) : sh('git', ['rev-parse', 'HEAD']);
console.log('功能提交 (tag 目标):', head);
const headVersion = sh('git', ['show', head + ':omniblock.user.js']).split('\n').find((l) => l.includes('@version'));
if (!/@version\s+0\.63\.2/.test(headVersion || '')) {
  console.error('功能提交内 @version 不是 0.63.2: ' + headVersion);
  process.exit(1);
}
console.log('功能提交 @version 校验通过:', (headVersion || '').trim());

// 2. tag（不覆盖既有）
if (trySh('git', ['rev-parse', '-q', '--verify', TAG])) {
  console.log('tag 已存在，跳过创建:', trySh('git', ['rev-parse', '-q', '--verify', TAG + '^{}']));
} else if (DRY) {
  console.log('[dry-run] git tag -a ' + TAG + ' -m "OmniBlock ' + TAG + '" ' + head);
} else {
  sh('git', ['tag', '-a', TAG, '-m', 'OmniBlock ' + TAG, head]);
  console.log('tag 已创建:', sh('git', ['rev-parse', '-q', '--verify', TAG]));
}

// 3. push tag
if (DRY) console.log('[dry-run] git push origin ' + TAG);
else {
  sh('git', ['push', 'origin', TAG]);
  console.log('tag 已推送 origin');
}

// 4. GitHub Release
const existingRelease = DRY ? '' : trySh('gh', ['release', 'view', TAG, '--repo', 'a2787/ub-utils', '--json', 'tagName', '-q', '.tagName']).trim();
if (existingRelease === TAG) {
  console.log('Release 已存在，跳过创建');
} else if (DRY) {
  console.log('[dry-run] gh release create ' + TAG + ' --title ' + JSON.stringify(TITLE) + ' --notes-file ' + NOTES);
} else {
  sh('gh', ['release', 'create', TAG, '--repo', 'a2787/ub-utils', '--title', TITLE, '--notes-file', NOTES]);
  console.log('Release 已创建: https://github.com/a2787/ub-utils/releases/tag/' + TAG);
}

// 5. raw 只读核对（最多 6 次、间隔 15s）
const expect = '@version       0.63.2';
let verified = false;
for (let i = 1; i <= 6 && !DRY; i++) {
  let body = '';
  try { body = sh('curl', ['-fsSL', '--max-time', '60', RAW_URL]); } catch (e) { body = ''; }
  if (body.includes(expect) && body.includes("RUNTIME_BUILD = '0.63.2-bridge-chunked-ready'")) {
    console.log('raw 核对通过（第 ' + i + ' 次尝试）: ' + RAW_URL + ' 已服务 @version 0.63.2 / build 0.63.2-bridge-chunked-ready');
    verified = true;
    break;
  }
  console.log('raw 第 ' + i + ' 次尝试未见 0.63.2（可能是缓存延迟），15s 后重试…');
  execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},0)'], { timeout: 15000 });
}
if (!DRY && !verified) {
  console.error('raw 核对未确认 0.63.2（tag/Release 已创建；raw 可能仍在缓存延迟中，稍后可手动复核 ' + RAW_URL + '）');
  process.exit(2);
}
console.log(DRY ? '[dry-run] 完成' : 'v0.63.2 发布链完成');

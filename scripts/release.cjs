#!/usr/bin/env node
/* OmniBlock 通用发布脚本（Personal 2.0 Task 3.4，替代按版本硬编码的 release-0632.cjs）。
 *
 * 用法（仓库根目录执行）：
 *   node scripts/release.cjs [--dry-run]                     # 默认即 dry-run，只读
 *   node scripts/release.cjs --publish --confirm-manual-gates # 明确授权后执行 tag/push/Release
 * 可选：--commit <ref>（tag 目标，默认 HEAD）、--tag <name>（必须等于 v@version）、
 *       --notes <file>（默认 scripts/release-notes/vX.Y.Z-release.md，缺失回退 docs/changelog/vX.Y.Z.md）、
 *       --repo <owner/name>（默认 a2787/ub-utils）。
 *
 * 步骤：
 *   1. 读 omniblock.user.js 的 @version 与 RUNTIME_BUILD；tag 必须与 @version 一致；
 *   2. 校验目标 commit 树内 userscript 的 version/build 与读取值一致；
 *      omniblock.user.js 必须无未提交改动（任何模式）；全工作区脏只拒绝 --publish；
 *   3. 运行 node --check、node test/docs-check.cjs、git diff --check；
 *   4. 隐私门禁（BV/微博 uid/B站 space 正则，只扫 git 跟踪文件，只打印 file:line:规则，
 *      不回显命中内容、不写任何产物）；
 *   5. 既有 tag/Release 检测：指向同一目标 commit 才允许跳过；不同 commit 立即失败（exit 2），
 *      绝不覆盖或自动续跑；
 *   6. dry-run 到此为止，只打印将执行的命令；
 *   7. --publish 前置：gh auth status + repo 写权限功能探测；§9 发布前全量清单（自动部分强制
 *      运行，degraded-storage/真站探针为人工门禁，须 --confirm-manual-gates 确认）；
 *   8. 依次执行 分支 push → tag 创建 → tag push → gh release create；每步完成打印断点状态，
 *      失败时报告“已完成到哪一步、下一步是什么”，脚本本身不做 commit；
 *   9. 发布后用 tag 路径 raw（不是 master）核对 @version/RUNTIME_BUILD，6 次 × 15s；
 *      耗尽时报“发布已成、raw 待复核”（exit 0），不报发布失败。
 *
 * 出口码：0=通过/完成；1=门禁或校验失败；2=tag/Release 指向不同 commit，需人工裁决。
 * 所有子进程 execFileSync 直传、不经 shell；raw 核对仅 https + raw.githubusercontent.com。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const PUBLISH = argv.includes('--publish');
const DRY = !PUBLISH; // 默认 dry-run
const USERSCRIPT = 'omniblock.user.js';
const DEFAULT_REPO = 'a2787/ub-utils';

function flagValue(name) {
  const eq = argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : '';
}
const COMMIT_ARG = flagValue('--commit') || 'HEAD';
const TAG_ARG = flagValue('--tag');
const NOTES_ARG = flagValue('--notes');
const REPO = flagValue('--repo') || DEFAULT_REPO;
const CONFIRM_MANUAL = argv.includes('--confirm-manual-gates');
const KNOWN = ['--publish', '--dry-run', '--confirm-manual-gates'];
const VALUE_FLAGS = ['--commit', '--tag', '--notes', '--repo'];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (KNOWN.includes(a)) continue;
  if (VALUE_FLAGS.includes(a)) { i++; continue; } // 下一个参数是其值
  if (a.startsWith('--') && !VALUE_FLAGS.some((f) => a.startsWith(f + '='))) {
    console.error('未知参数: ' + a);
    process.exit(1);
  }
  if (!a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1])) {
    console.error('未知参数: ' + a);
    process.exit(1);
  }
}
if (PUBLISH && DRY === false && !CONFIRM_MANUAL) {
  console.error('--publish 必须同时带 --confirm-manual-gates，确认 degraded-storage 与（如适用）已授权真站探针已人工完成（见计划 §9 发布前行）。');
  process.exit(1);
}

const sh = (cmd, args, opts = {}) => {
  const out = execFileSync(cmd, args, {
    cwd: ROOT, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024, ...opts,
  });
  return String(out).trim();
};
// dry-run 下只调用只读命令（status/show/ls-remote/gh view/auth status/node --check 等）；
// 写命令（git tag/push、gh release create）由 --publish 分支执行，dry-run 仅打印计划。
const trySh = (cmd, args, opts) => { try { return sh(cmd, args, opts); } catch (e) { return null; } };

const failures = [];
const warnings = [];
const fail = (msg) => { failures.push(msg); console.error('FAIL: ' + msg); };
const warn = (msg) => { warnings.push(msg); console.warn('WARN: ' + msg); };
const ok = (msg) => console.log('OK:   ' + msg);

// ---------- 1. 读取 @version / RUNTIME_BUILD ----------
const src = fs.readFileSync(path.join(ROOT, USERSCRIPT), 'utf8');
const vMatch = src.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)/m);
const bMatch = src.match(/const\s+RUNTIME_BUILD\s*=\s*'([^']+)'/);
if (!vMatch) fail('无法从 ' + USERSCRIPT + ' 解析 @version');
if (!bMatch) fail('无法从 ' + USERSCRIPT + ' 解析 RUNTIME_BUILD');
if (failures.length) process.exit(1);
const VERSION = vMatch[1];
const BUILD = bMatch[1];
const TAG = TAG_ARG || ('v' + VERSION);
if (TAG !== 'v' + VERSION) {
  fail('tag ' + TAG + ' 与 @version ' + VERSION + ' 不一致，拒绝（不覆盖既有 tag，须人工裁决）');
  process.exit(2);
}
console.log('版本: @version=' + VERSION + '  RUNTIME_BUILD=' + BUILD + '  tag=' + TAG);

// ---------- 2. 工作区与目标 commit 校验 ----------
const selfDirty = sh('git', ['status', '--porcelain', '--', USERSCRIPT]);
if (selfDirty) fail(USERSCRIPT + ' 有未提交改动，目标 commit 校验无意义: ' + selfDirty);
const anyDirty = sh('git', ['status', '--porcelain']);
if (anyDirty) {
  if (PUBLISH) fail('工作区不干净，--publish 拒绝（脚本不 commit，请先完成逐路径提交）:\n' + anyDirty);
  else warn('工作区不干净（dry-run 允许，发布前必须干净）: ' + anyDirty.split('\n').length + ' 个条目');
}
const target = trySh('git', ['rev-parse', '--verify', COMMIT_ARG + '^{commit}']);
if (!target) fail('目标 commit 不存在: ' + COMMIT_ARG);
else {
  ok('目标 commit (tag 指向): ' + target);
  const treeSrc = trySh('git', ['show', target + ':' + USERSCRIPT]);
  if (treeSrc == null) fail('目标 commit 树内无 ' + USERSCRIPT);
  else {
    const tv = (treeSrc.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)/m) || [])[1];
    const tb = (treeSrc.match(/const\s+RUNTIME_BUILD\s*=\s*'([^']+)'/) || [])[1];
    if (tv !== VERSION) fail('目标 commit 树内 @version=' + tv + ' ≠ 工作区读取 ' + VERSION);
    if (tb !== BUILD) fail('目标 commit 树内 RUNTIME_BUILD=' + tb + ' ≠ 工作区读取 ' + BUILD);
    if (tv === VERSION && tb === BUILD) ok('目标 commit 树内 version/build 一致');
  }
}

// ---------- 3. 基础门禁 ----------
for (const [cmd, args] of [['node', ['--check', USERSCRIPT]], ['node', ['test/docs-check.cjs']], ['git', ['diff', '--check']]]) {
  const r = trySh(cmd, args);
  if (r === null) fail('门禁失败: ' + cmd + ' ' + args.join(' '));
  else ok('门禁通过: ' + cmd + ' ' + args.join(' '));
}

// ---------- 4. changelog / notes ----------
const changelog = 'docs/changelog/v' + VERSION + '.md';
if (fs.existsSync(path.join(ROOT, changelog))) ok(changelog + ' 存在');
else fail('缺少 ' + changelog + '（发布必须有对应版本 changelog）');
let notes = NOTES_ARG;
if (!notes) {
  const primary = 'scripts/release-notes/v' + VERSION + '-release.md';
  notes = fs.existsSync(path.join(ROOT, primary)) ? primary : changelog;
}
if (!fs.existsSync(path.join(ROOT, notes))) fail('Release notes 文件不存在: ' + notes);
else ok('Release notes: ' + notes);

// ---------- 5. 隐私门禁（只扫 git 跟踪文件；不回显命中内容） ----------
{
  const rules = [['BV', /BV[0-9A-Za-z]{8,}/], ['weibo-uid', /weibo\.com\/[0-9]{5,}\//], ['bili-space', /space\.bilibili\.com\/[0-9]{5,}/]];
  const roots = ['README.md', 'CHANGELOG.md', 'MAINTENANCE.md', 'AGENTS.md', 'docs', USERSCRIPT, 'test'];
  const listed = trySh('git', ['ls-files', '--', ...roots]) || '';
  let hits = 0;
  for (const f of listed.split('\n').filter(Boolean)) {
    if (!fs.existsSync(path.join(ROOT, f))) continue; // 以当前跟踪清单为准，跳过缺失
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [name, re] of rules) {
        if (re.test(line)) { hits++; console.error('PRIVACY: ' + f + ':' + (i + 1) + ' 命中规则 ' + name); }
      }
    });
  }
  if (hits) fail('隐私门禁命中 ' + hits + ' 处（见上，须改为占位符或注明人工合成后移除）');
  else ok('隐私门禁通过（扫描 ' + listed.split('\n').filter(Boolean).length + ' 个跟踪文件）');
}

// ---------- 6. 既有 tag / Release 检测（绝不覆盖） ----------
let skipTagCreate = false, skipTagPush = false, skipRelease = false;
const localTagDeref = trySh('git', ['rev-parse', '-q', '--verify', TAG + '^{}']);
if (localTagDeref) {
  if (localTagDeref === target) { skipTagCreate = true; ok('本地 tag 已存在且指向目标 commit，跳过创建'); }
  else fail('本地 tag ' + TAG + ' 指向 ' + localTagDeref + ' ≠ 目标 ' + target + '：立即失败，人工裁决，绝不覆盖');
} else if (DRY) {
  console.log('[dry-run] git tag -a ' + TAG + ' -m "OmniBlock v' + VERSION + '" ' + target);
}
const remoteTagLines = trySh('git', ['ls-remote', 'origin', 'refs/tags/' + TAG, 'refs/tags/' + TAG + '^{}']) || '';
const remoteShas = remoteTagLines.split('\n').filter(Boolean).map((l) => l.split(/\t/)[0]);
if (remoteShas.length) {
  const localTagObj = trySh('git', ['rev-parse', '-q', '--verify', TAG]);
  // 远端指向目标 commit 的两种形态：peeled 行等于 target，或与本地 tag 引用同对象且本地已确认指向 target。
  if (remoteShas.includes(target) || (skipTagCreate && localTagObj && remoteShas.includes(localTagObj))) {
    skipTagPush = true;
    ok('远端 tag 已存在且指向目标 commit，跳过 push');
  } else {
    fail('远端 tag ' + TAG + ' 指向 ' + remoteShas.join('/') + ' ≠ 目标 ' + target + '：立即失败，人工裁决，绝不覆盖');
  }
} else if (DRY) {
  console.log('[dry-run] git push origin ' + TAG);
}
const ghPresent = trySh('gh', ['--version']) !== null;
let ghAuthed = false;
if (ghPresent) {
  ghAuthed = trySh('gh', ['auth', 'status']) !== null;
  if (ghAuthed) ok('gh 已登录');
  else fail('gh auth status 失败：未登录或凭据失效（须在 tag/push 前解决，避免半发布）');
} else fail('gh CLI 不可用');
if (ghAuthed) {
  // repo scope 的功能等价探测：能读到仓库且当前用户有 push 权限。
  const canPush = trySh('gh', ['api', 'repos/' + REPO, '--jq', '.permissions.push']);
  if (canPush === 'true') ok('gh 对 ' + REPO + ' 有 push 权限');
  else if (DRY && canPush === null) warn('无法确认 gh push 权限（dry-run 容忍；--publish 前必须可确认）');
  else fail('gh 未登录账号缺少 ' + REPO + ' 的 repo 写权限（拒绝在 tag/push 后半发布）');
}
if (ghAuthed) {
  if (failures.length) {
    warn('tag 指向性已有冲突，跳过 Release 判定（人工裁决后再评估）');
  } else {
    const rel = trySh('gh', ['release', 'view', TAG, '--repo', REPO, '--json', 'tagName', '--jq', '.tagName']);
    if (rel === TAG) {
      // Release 存在：tag 指向性冲突已由上文失败拦截，能走到这里说明既有 tag 与目标 commit 一致。
      skipRelease = true;
      ok('Release ' + TAG + ' 已存在且 tag 指向性一致，跳过创建' + (skipTagPush ? '' : '（注意：本地 tag 需补 push）'));
    } else if (DRY) {
      console.log('[dry-run] gh release create ' + TAG + ' --repo ' + REPO + ' --target ' + target + ' --title "OmniBlock v' + VERSION + '" --notes-file ' + notes);
    }
  }
}

// ---------- 7. 分支 push（目标 commit 须随分支到达远端） ----------
const branch = trySh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'master';
let pushBranch = false;
if (!failures.length) {
  if (PUBLISH) sh('git', ['fetch', 'origin', branch, '--quiet'], { stdio: 'ignore' });
  const remoteTip = (trySh('git', ['ls-remote', 'origin', 'refs/heads/' + branch]) || '').split(/\s+/)[0];
  const headSha = trySh('git', ['rev-parse', 'HEAD']);
  if (remoteTip === target) {
    ok('远端 ' + branch + ' 已指向目标 commit，无需 push 分支');
  } else if (remoteTip && trySh('git', ['merge-base', '--is-ancestor', target, remoteTip]) !== null) {
    ok('目标 commit 已在远端 ' + branch + ' 历史中，无需 push 分支');
  } else if (headSha === target) {
    pushBranch = true; // 正常非强推；远端落后则由 fast-forward 带上目标 commit
  } else {
    fail('目标 commit 不是本地 ' + branch + ' 顶端且不在远端分支可达范围内：先由维护流程推送分支，发布脚本不强推');
  }
}

// 断点汇总（dry-run 打印计划；publish 失败时说明已完成到哪一步）
console.log('--- 计划/断点 ---');
const planLine = (skipped, label) => (skipped ? '(跳过) ' : (DRY ? '[dry-run] ' : '')) + label;
if (pushBranch) console.log(planLine(false, 'git push origin ' + branch));
console.log(planLine(skipTagCreate, 'git tag -a ' + TAG + ' -m "OmniBlock v' + VERSION + '" ' + target));
console.log(planLine(skipTagPush, 'git push origin ' + TAG));
console.log(planLine(skipRelease, 'gh release create ' + TAG + ' --repo ' + REPO + ' --target ' + target + ' --notes-file ' + notes));
console.log((DRY ? '[dry-run] ' : '') + 'raw 核对: https://raw.githubusercontent.com/' + REPO + '/' + TAG + '/' + USERSCRIPT);

if (failures.length) {
  console.error('\n共 ' + failures.length + ' 项失败，' + (warnings.length ? warnings.length + ' 项警告。' : ''));
  console.error(failures.map((f) => '- ' + f.split('\n')[0]).join('\n'));
  process.exit(failures.some((f) => f.includes('人工裁决')) ? 2 : 1);
}
if (DRY) {
  console.log('\ndry-run 完成：未写任何 tag/远端/Release。');
  process.exit(0);
}

// ---------- 8. 发布前全量清单（计划 §9，强制；自动部分） ----------
const AUTO_TESTS = [
  // CI 22 项（.github/workflows/maintenance.yml）
  'run', 'state', 'quickblock', 'comment-manager', 'danmaku-auto', 'work-block', 'performance',
  'weibo-replay', 'userscript-product', 'adapters', 'douyin', 'sync', 'sync-server',
  'ai-screening', 'ai-prompt-system', 'ai-prompt-eval', 'ai-platforms', 'content-ai',
  'content-coverage', 'ai-autoload', 'ai-watchdog', 'probe-hygiene',
  // 差集 headless 项（Task 4.2）与 Phase 2/4 门禁
  'ui-settings', 'dark-mode', 'rule-manager', 'rule-samples', 'ai-auto-gate', 'ai-batch',
  'ai-bridge', 'ai-context', 'ai-eval', 'ai-fact-integration', 'ai-retrieval', 'gateway-smoke',
  'runtime', 'health', 'code-health',
];
console.log('--- 发布前全量清单（自动部分） ---');
for (const t of AUTO_TESTS) {
  const p = path.join(ROOT, 'test', t + '.cjs');
  if (!fs.existsSync(p)) { warn('清单缺脚本（Phase 未落地）: test/' + t + '.cjs'); continue; }
  try { sh('node', ['test/' + t + '.cjs']); console.log('PASS ' + t); }
  catch (e) { fail('发布前全量清单失败: test/' + t + '.cjs（断点：尚未 tag/push/Release，修复后重跑）'); process.exit(1); }
}
console.log('人工门禁已由 --confirm-manual-gates 确认：degraded-storage（Edge/Chromium 非 headless）与登录态真站探针（如适用）。');

// ---------- 9. 执行 tag / push / Release ----------
const done = { branch: false, tag: false, tagPush: false, release: false };
try {
  if (pushBranch) { sh('git', ['push', 'origin', branch]); done.branch = true; console.log('分支已推送: ' + branch); }
  if (!skipTagCreate) { sh('git', ['tag', '-a', TAG, '-m', 'OmniBlock v' + VERSION, target]); done.tag = true; console.log('tag 已创建: ' + TAG); }
  if (!skipTagPush) { sh('git', ['push', 'origin', TAG]); done.tagPush = true; console.log('tag 已推送 origin'); }
  if (!skipRelease) {
    sh('gh', ['release', 'create', TAG, '--repo', REPO, '--target', target, '--title', 'OmniBlock v' + VERSION, '--notes-file', notes]);
    done.release = true;
    console.log('Release 已创建: https://github.com/' + REPO + '/releases/tag/' + TAG);
  }
} catch (e) {
  const stage = done.release ? 'Release' : done.tagPush ? 'tag push' : done.tag ? 'tag 创建（未 push）' : done.branch ? '分支 push（未 tag）' : '未开始写入';
  console.error('发布链中断于: ' + stage + '；错误: ' + (e && e.message || e));
  console.error('已完成的步骤不会重复执行（幂等跳过在同 commit 前提下成立）；请人工核对后重跑。');
  process.exit(1);
}

// ---------- 10. 发布后 tag 路径 raw 核对（不用 master） ----------
const rawUrl = 'https://raw.githubusercontent.com/' + REPO + '/' + TAG + '/' + USERSCRIPT;
const u = new URL(rawUrl);
if (u.protocol !== 'https:' || u.hostname !== 'raw.githubusercontent.com') { fail('raw 核对 URL 不在白名单'); process.exit(1); }
const fetchRaw = () => new Promise((resolve) => {
  https.get(rawUrl, { headers: { 'user-agent': 'omniblock-release' } }, (res) => {
    if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
      const next = new URL(res.headers.location, rawUrl);
      if (next.protocol !== 'https:' || next.hostname !== 'raw.githubusercontent.com') return resolve('');
      res.resume();
      return https.get(next, (r2) => { let b = ''; r2.setEncoding('utf8'); r2.on('data', (c) => { b += c; }); r2.on('end', () => resolve(r2.statusCode === 200 ? b : '')); r2.on('error', () => resolve('')); });
    }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve(res.statusCode === 200 ? body : ''));
    res.on('error', () => resolve(''));
  }).on('error', () => resolve(''));
});
let verified = false;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 1; i <= 6; i++) {
    const body = await fetchRaw();
    const vOk = (body.match(/^\/\/\s*@version\s+(\d+\.\d+\.\d+)/m) || [])[1] === VERSION;
    const bOk = body.includes("RUNTIME_BUILD = '" + BUILD + "'");
    if (vOk && bOk) { console.log('raw 核对通过（第 ' + i + ' 次）: @version ' + VERSION + ' / build ' + BUILD); verified = true; break; }
    if (i < 6) { console.log('raw 第 ' + i + ' 次未见 ' + VERSION + '/' + BUILD + '（缓存延迟？），15s 后重试…'); await promisify(setTimeout)(15000); }
  }
  if (!verified) {
    console.warn('WARN: 发布已成（tag/Release 均在），raw 待复核：稍后手动检查 ' + rawUrl);
  }
  console.log('v' + VERSION + ' 发布链完成。断点: branch=' + done.branch + ' tag=' + done.tag + ' tagPush=' + done.tagPush + ' release=' + done.release);
  process.exit(0);
})();

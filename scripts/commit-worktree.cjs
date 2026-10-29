#!/usr/bin/env node
/* OmniBlock 通用工作区提交工具（2026-10-29 新增，审计完善轮）。
 *
 * 用法：node scripts/commit-worktree.cjs <消息文件路径> [--dry-run]
 *
 * 行为（2026-10-29 任务明确授权的实现形态）：
 *   1. git add -A
 *   2. git reset -q -- .mimosa _probe_diag.cjs _probe_diag2.cjs _probe_diag3.cjs _probe_features.cjs
 *   3. git commit -F <消息文件>          ← 多行信息经文件传入并绕过 cmd.exe；
 *      消息"没有真实换行却含字面反斜杠 n"（cmd.exe 单行化缺陷的特征签名）时拒绝提交，
 *      防 b3fdbb1/446daa1 缺陷复发；正文里正常提到 \n 字样的多行消息不受影响。
 *      （commit-pending.cjs 按审计 fixHint 对固定模板消息用整条断言，语义一致更严格。）
 *   4. git push origin master
 *
 * 说明：
 * - AGENTS.md 常规规则是"脏工作区只暂存明确路径"；本工具是用户点名的通用收尾工具，
 *   2026-10-29 任务原文指定 add -A + 上述 reset 名单，未跟踪噪声同时由 .gitignore
 *   2026-10-29 条目（.mimosa/、/_probe_diag*.cjs、/_probe_features.cjs）兜底，reset 对
 *   不在索引中的路径是已实测的 no-op（exit 0）。
 * - 所有 git 调用经 execFileSync 直传、不经 shell，避免 cmd.exe 对多行参数的再解释。
 * - 提交前的文档/测试门禁（docs-check 等）由调用方负责先行运行；--dry-run 不做任何
 *   变更（不 add、不 reset、不 commit、不 push），只打印状态、计划命令与消息预览。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RESET_PATHS = ['.mimosa', '_probe_diag.cjs', '_probe_diag2.cjs', '_probe_diag3.cjs', '_probe_features.cjs'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const msgArg = args.find((a) => a !== '--dry-run');
if (!msgArg) {
  console.error('用法: node scripts/commit-worktree.cjs <消息文件路径> [--dry-run]');
  process.exit(1);
}
const msgFile = path.resolve(process.cwd(), msgArg);
if (!fs.existsSync(msgFile) || !fs.statSync(msgFile).isFile()) {
  console.error('消息文件不存在或不是普通文件: ' + msgFile);
  process.exit(1);
}

// 只读命令（status/diff/rev-parse）在 --dry-run 下也真实执行，保证预览状态可信；
// 变更型命令（add/reset/commit/push）在 --dry-run 下只打印不执行。
const READ_ONLY = new Set(['status', 'diff', 'rev-parse']);
const git = (gitArgs) => {
  const printable = 'git ' + gitArgs.join(' ');
  if (DRY && !READ_ONLY.has(gitArgs[0])) { console.log('[dry-run] ' + printable); return ''; }
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
};

const MSG = fs.readFileSync(msgFile, 'utf8');
if (!MSG.trim()) {
  console.error('消息文件为空: ' + msgFile);
  process.exit(1);
}
// 缺陷签名：cmd.exe 路径会把全部真实换行折叠成字面 \n，被单行化的消息不含任何真实换行；
// 含真实换行的消息即使正文提到 \n 字样也是合法的（见 2026-10-29-polish-commit.txt）。
const hasRealNewline = MSG.includes('\n');
if (!hasRealNewline && /\\n/.test(MSG)) {
  console.error('消息没有任何真实换行却含字面反斜杠 n：疑似经 cmd.exe 单行化的提交说明，拒绝提交；');
  console.error('请用真实换行改写消息文件（git commit -F 原样读取），正文中需要指代该序列时写成"backslash-n"等描述');
  process.exit(1);
}

console.log('== 当前工作区状态 ==');
console.log(git(['status', '--short']) || '(clean)');

git(['add', '-A']);
git(['reset', '-q', '--', ...RESET_PATHS]);

const staged = git(['diff', '--cached', '--name-only']).split('\n').map((p) => p.trim()).filter(Boolean);

if (DRY) {
  console.log('== dry-run 未实际暂存：上方 status 输出即当前全部未忽略变更（含已暂存部分） ==');
  if (staged.length) {
    console.log('== 当前已暂存 (' + staged.length + ') ==');
    for (const p of staged) console.log('  ' + p);
  }
  console.log('== 提交信息预览（' + msgFile + '）==');
  console.log(MSG.trimEnd());
  console.log('[dry-run] 实际运行时将执行: git add -A && git reset -q -- ' + RESET_PATHS.join(' ') + ' && git commit -F ' + msgFile + ' && git push origin master');
  process.exit(0);
}

if (!staged.length) {
  console.error('暂存区为空（add -A + reset 后没有可提交变更），中止');
  process.exit(1);
}
console.log('== 将提交的路径 (' + staged.length + ') ==');
for (const p of staged) console.log('  ' + p);

git(['commit', '-F', msgFile]);
const head = git(['rev-parse', 'HEAD']);
console.log('committed:', head);
git(['push', 'origin', 'master']);
console.log('pushed origin master');

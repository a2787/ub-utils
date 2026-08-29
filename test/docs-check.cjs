/*
 * OmniBlock 文档治理门禁。
 * 检查活动文档的大小预算、内部 Markdown 链接、版本/构建同步和关键入口，
 * 防止维护流程随着迭代重新退化为一份无人能安全加载的大台账。
 * 历史归档文件不在活动文档预算内；它们只能通过索引按需读取。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const errors = [];

const source = read('omniblock.user.js');
const versionMatch = source.match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/);
const buildMatch = source.match(/const\s+RUNTIME_BUILD\s*=\s*['"]([^'"]+)['"]/);
if (!versionMatch) errors.push('源码缺少 @version');
if (!buildMatch) errors.push('源码缺少 RUNTIME_BUILD');
const version = versionMatch ? versionMatch[1] : 'unknown';
const build = buildMatch ? buildMatch[1] : 'unknown';

const activeDocs = [
  ['AGENTS.md', 16],
  ['README.md', 64],
  ['CHANGELOG.md', 24],
  ['MAINTENANCE.md', 16],
  ['docs/KNOWLEDGE_TREE.md', 12],
  ['docs/MAINTENANCE_WORKFLOW.md', 24],
  ['docs/maintenance/CURRENT.md', 24],
  ['docs/maintenance/PLAN.md', 24],
  ['docs/architecture/ARCHITECTURE.md', 24],
  ['docs/maintenance/HISTORY_INDEX.md', 12],
  ['docs/changelog/INDEX.md', 12],
  [`docs/changelog/v${version}.md`, 24],
];

const decisionsDir = path.join(ROOT, 'docs', 'decisions');
if (!fs.existsSync(decisionsDir)) errors.push('缺少架构决策目录：docs/decisions');
else {
  const decisions = fs.readdirSync(decisionsDir).filter((name) => /^\d{4}-[a-z0-9-]+\.md$/i.test(name));
  if (!decisions.length) errors.push('docs/decisions 缺少 ADR');
  for (const name of decisions) activeDocs.push([`docs/decisions/${name}`, 12]);
}

for (const [relative, budgetKiB] of activeDocs) {
  if (!exists(relative)) {
    errors.push(`缺少活动文档：${relative}`);
    continue;
  }
  const bytes = Buffer.byteLength(read(relative), 'utf8');
  if (bytes > budgetKiB * 1024) {
    errors.push(`${relative} 超出 ${budgetKiB} KiB 预算（${bytes} bytes）`);
  }
  console.log(`SIZE ${relative}: ${(bytes / 1024).toFixed(1)} KiB / ${budgetKiB} KiB`);
}

const rootChangelog = exists('CHANGELOG.md') ? read('CHANGELOG.md') : '';
const current = exists('docs/maintenance/CURRENT.md') ? read('docs/maintenance/CURRENT.md') : '';
const plan = exists('docs/maintenance/PLAN.md') ? read('docs/maintenance/PLAN.md') : '';
const architecture = exists('docs/architecture/ARCHITECTURE.md') ? read('docs/architecture/ARCHITECTURE.md') : '';
const tree = exists('docs/KNOWLEDGE_TREE.md') ? read('docs/KNOWLEDGE_TREE.md') : '';
const workflow = exists('docs/MAINTENANCE_WORKFLOW.md') ? read('docs/MAINTENANCE_WORKFLOW.md') : '';
const currentVersionDoc = exists(`docs/changelog/v${version}.md`)
  ? read(`docs/changelog/v${version}.md`) : '';

const requiredTexts = [
  ['docs/KNOWLEDGE_TREE.md', tree, 'docs/MAINTENANCE_WORKFLOW.md'],
  ['docs/KNOWLEDGE_TREE.md', tree, 'docs/maintenance/PLAN.md'],
  ['docs/KNOWLEDGE_TREE.md', tree, 'docs/architecture/ARCHITECTURE.md'],
  ['docs/KNOWLEDGE_TREE.md', tree, '注意更新'],
  ['docs/KNOWLEDGE_TREE.md', tree, '文档大小'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, '注意更新'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, 'docs-check'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, '历史归档'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, 'OB-*'],
  ['MAINTENANCE.md', exists('MAINTENANCE.md') ? read('MAINTENANCE.md') : '', 'docs/maintenance/CURRENT.md'],
  ['CHANGELOG.md', rootChangelog, 'docs/changelog/INDEX.md'],
  ['CHANGELOG.md', rootChangelog, `## v${version}`],
  ['docs/maintenance/CURRENT.md', current, version],
  ['docs/maintenance/CURRENT.md', current, build],
  ['docs/maintenance/CURRENT.md', current, '当前候选源码 SHA-256'],
  ['docs/maintenance/PLAN.md', plan, '唯一的活动计划'],
  ['docs/architecture/ARCHITECTURE.md', architecture, '生命周期契约'],
  [`docs/changelog/v${version}.md`, currentVersionDoc, `# OmniBlock v${version}`],
];
for (const [file, content, expected] of requiredTexts) {
  if (!content.includes(expected)) errors.push(`${file} 缺少关键内容：${expected}`);
}

function parsePlanItems(content) {
  const headings = Array.from(content.matchAll(/^###\s+(OB-[A-Z0-9-]+)\s+—\s+[^\r\n]+$/gm));
  return headings.map((heading, index) => {
    const block = content.slice(heading.index, headings[index + 1] ? headings[index + 1].index : content.length);
    const fields = Object.create(null);
    for (const match of block.matchAll(/^-\s+([a-z][a-z-]*):\s*(.+)$/gm)) fields[match[1]] = match[2].trim();
    const checks = Array.from(block.matchAll(/^\s{2}-\s+\[([ xX])\]\s+(.+)$/gm));
    return { id: heading[1], block, fields, checks };
  });
}

function validatePlan(content) {
  const items = parsePlanItems(content);
  if (!items.length) {
    errors.push('docs/maintenance/PLAN.md 没有 OB-* 活动项');
    return;
  }
  const allowedStatuses = new Set(['proposed', 'approved', 'in_progress', 'verified', 'deferred', 'blocked', 'superseded']);
  const requiredFields = ['status', 'priority', 'scope', 'non-goals', 'dependencies', 'acceptance', 'evidence', 'next', 'updated', 'supersedes'];
  const byId = new Map();
  for (const item of items) {
    if (byId.has(item.id)) errors.push(`PLAN ID 重复：${item.id}`);
    byId.set(item.id, item);
    for (const field of requiredFields) if (!item.fields[field]) errors.push(`${item.id} 缺少字段：${field}`);
    if (item.fields.status && !allowedStatuses.has(item.fields.status)) errors.push(`${item.id} 状态非法：${item.fields.status}`);
    if (item.fields.priority && !/^P[0-3]$/.test(item.fields.priority)) errors.push(`${item.id} 优先级非法：${item.fields.priority}`);
    if (!item.checks.length) errors.push(`${item.id} 缺少可执行验收项`);
    if (item.fields.status === 'verified') {
      if (!item.fields.evidence || item.fields.evidence === 'pending') errors.push(`${item.id} 已 verified 但缺少证据`);
      if (item.checks.some((check) => check[1] === ' ')) errors.push(`${item.id} 已 verified 但仍有未勾选验收项`);
    }
    if (item.fields.status === 'blocked' && (!item.fields.evidence || item.fields.evidence === 'pending')) {
      errors.push(`${item.id} 已 blocked 但没有阻断证据`);
    }
  }

  const dependencies = new Map();
  for (const item of items) {
    const raw = item.fields.dependencies || 'none';
    const refs = raw === 'none' ? [] : raw.split(',').map((value) => value.trim()).filter(Boolean);
    dependencies.set(item.id, refs);
    for (const ref of refs) if (!byId.has(ref)) errors.push(`${item.id} 引用了不存在的依赖：${ref}`);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, pathIds) {
    if (visiting.has(id)) {
      errors.push(`PLAN 依赖成环：${pathIds.concat(id).join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency, pathIds.concat(id));
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id, []);
}

validatePlan(plan);

const snapshotMatch = current.match(/最近验证的源码快照：`([0-9a-f]{40})`/i);
if (!snapshotMatch) {
  errors.push('CURRENT 缺少 40 位最近验证源码快照');
} else {
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', snapshotMatch[1], 'HEAD'], { cwd: ROOT });
  if (ancestor.status !== 0) errors.push(`CURRENT 源码快照不是当前 HEAD 的祖先：${snapshotMatch[1]}`);
}

const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
const documentedHashMatch = current.match(/当前候选源码 SHA-256：`([0-9a-f]{64})`/i);
if (!documentedHashMatch) errors.push('CURRENT 缺少当前候选源码 SHA-256');
else if (documentedHashMatch[1].toLowerCase() !== sourceHash) {
  errors.push(`CURRENT 候选源码 SHA-256 过期：文档 ${documentedHashMatch[1]}，实际 ${sourceHash}`);
}

let shortStatus = '';
try { shortStatus = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
catch (error) { errors.push('无法读取 Git 工作区状态：' + error.message); }
if (shortStatus && /(?:^|\n).*当前工作区干净/.test(current)) errors.push('CURRENT 声称当前工作区干净，但 Git 存在改动');

function checkMarkdownLinks(relative, content) {
  const linkPattern = /\[[^\]]+\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match;
  while ((match = linkPattern.exec(content))) {
    let target = match[1];
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|chrome:|javascript:)/i.test(target)) continue;
    target = target.split('#', 1)[0].split('?', 1)[0];
    if (!target) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch (error) {
      errors.push(`${relative} 链接编码无效：${target}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(path.join(ROOT, relative)), decoded);
    if (!fs.existsSync(resolved)) errors.push(`${relative} 存在断链：${target}`);
  }
}

for (const [relative] of activeDocs) {
  if (exists(relative) && relative.toLowerCase().endsWith('.md')) checkMarkdownLinks(relative, read(relative));
}

if (errors.length) {
  console.error('\nDOCUMENTATION GOVERNANCE FAILED');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log(`DOCS VERSION: ${version}`);
console.log(`DOCS BUILD: ${build}`);
console.log('RESULT: DOCUMENTATION GOVERNANCE PASSED');

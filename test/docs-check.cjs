/*
 * OmniBlock 文档治理门禁。
 * 检查活动文档的大小预算、内部 Markdown 链接、版本/构建同步和关键入口，
 * 防止维护流程随着迭代重新退化为一份无人能安全加载的大台账。
 * 历史归档文件不在活动文档预算内；它们只能通过索引按需读取。
 */
const fs = require('fs');
const path = require('path');

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
  ['docs/maintenance/HISTORY_INDEX.md', 12],
  ['docs/changelog/INDEX.md', 12],
  [`docs/changelog/v${version}.md`, 24],
];

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
const tree = exists('docs/KNOWLEDGE_TREE.md') ? read('docs/KNOWLEDGE_TREE.md') : '';
const workflow = exists('docs/MAINTENANCE_WORKFLOW.md') ? read('docs/MAINTENANCE_WORKFLOW.md') : '';
const currentVersionDoc = exists(`docs/changelog/v${version}.md`)
  ? read(`docs/changelog/v${version}.md`) : '';

const requiredTexts = [
  ['docs/KNOWLEDGE_TREE.md', tree, 'docs/MAINTENANCE_WORKFLOW.md'],
  ['docs/KNOWLEDGE_TREE.md', tree, '注意更新'],
  ['docs/KNOWLEDGE_TREE.md', tree, '文档大小'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, '注意更新'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, 'docs-check'],
  ['docs/MAINTENANCE_WORKFLOW.md', workflow, '历史归档'],
  ['MAINTENANCE.md', exists('MAINTENANCE.md') ? read('MAINTENANCE.md') : '', 'docs/maintenance/CURRENT.md'],
  ['CHANGELOG.md', rootChangelog, 'docs/changelog/INDEX.md'],
  ['CHANGELOG.md', rootChangelog, `## v${version}`],
  ['docs/maintenance/CURRENT.md', current, version],
  ['docs/maintenance/CURRENT.md', current, build],
  [`docs/changelog/v${version}.md`, currentVersionDoc, `# OmniBlock v${version}`],
];
for (const [file, content, expected] of requiredTexts) {
  if (!content.includes(expected)) errors.push(`${file} 缺少关键内容：${expected}`);
}

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

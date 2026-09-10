/*
 * OmniBlock 独立 AI 评测门禁。
 * 数据集只包含人工合成、脱敏文本；默认 mock-oracle 仅验证指标引擎和安全门禁，
 * 不能解释为真实模型精度。recorded 模式接受脱敏预测文件，live 模式只允许本机
 * loopback 且只用于维护者自建 mock，不读取凭据、不访问公开 provider。
 * 运行：node test/ai-eval.cjs --mode=mock
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATASET_PATH = path.join(__dirname, 'fixtures', 'ai-eval-v1.json');
const ALLOWED_ACTIONS = new Set(['block', 'allow', 'defer', 'commit_base_first', 'background_only', 'pause', 'cancel', 'notify']);
const ALLOWED_CLAIMS = new Set(['policy_violation', 'factual_claim', 'opinion', 'mixed', 'not_applicable', 'unknown']);
const ALLOWED_VERIFICATION = new Set(['supported', 'contradicted', 'not_checked', 'insufficient_context', 'opinion', 'not_applicable', 'unknown']);
const ALLOWED_IDENTITY = new Set([
  'execute_if_confirmed', 'no_action', 'uid_ok', 'hash_only', 'no_identity', 'reject_guess',
  'cross_session_no_guess', 'popup_closes_immediately', 'hash_only_on_failure', 'resume_on_visible',
  'no_stale_write', 'count_only_notice',
]);

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function containsForbidden(value) {
  const text = JSON.stringify(value);
  return /(?:Cookie|Set-Cookie|Authorization|Bearer\s|api[_-]?key|token\s*[:=]|https?:\/\/|www\.|space\.bilibili|BV[0-9A-Za-z]{8,}|\b\d{5,}\b)/i.test(text);
}
function assertString(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label + ' 无效');
}
function validateDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1 || dataset.datasetId !== 'ai-eval-v1') fail('评测集 schema/datasetId 不匹配');
  if (containsForbidden(dataset)) fail('评测集触发隐私门禁');
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) fail('评测集为空');
  const ids = new Set();
  for (const item of dataset.cases) {
    assertString(item && item.id, 'case.id', 80);
    if (!/^(?:policy|fact|context|identity|lifecycle)-\d{3}$/.test(item.id) || ids.has(item.id)) fail('case.id 不稳定或重复');
    ids.add(item.id);
    if (!['policy_core', 'fact_claims', 'context_pairs', 'identity_gate', 'lifecycle_cases'].includes(item.category)) fail(item.id + ' category 无效');
    if (!item.input || typeof item.input !== 'object') fail(item.id + ' input 缺失');
    if (item.input.text != null) assertString(item.input.text, item.id + '.input.text', 480);
    const gold = item.gold || {};
    for (const [field, values] of [['claimType', ALLOWED_CLAIMS], ['verificationStatus', ALLOWED_VERIFICATION], ['expectedAction', ALLOWED_ACTIONS], ['identityAction', ALLOWED_IDENTITY]]) {
      if (!values.has(gold[field])) fail(item.id + '.' + field + ' 无效');
    }
    if (!['sufficient', 'insufficient'].includes(gold.contextSufficiency)) fail(item.id + '.contextSufficiency 无效');
  }
  for (const split of ['dev', 'test', 'challenge']) {
    if (!Array.isArray(dataset.splits && dataset.splits[split])) fail('缺少 split ' + split);
    for (const id of dataset.splits[split]) if (!ids.has(id)) fail('split 引用了不存在的 case ' + id);
  }
  const allSplitIds = Object.values(dataset.splits).flat();
  if (new Set(allSplitIds).size !== dataset.cases.length) fail('splits 未覆盖每条 case 且未重复');
  return dataset;
}
function mockPrediction(item) {
  const gold = item.gold;
  return {
    id: item.id,
    decision: gold.expectedAction === 'block' ? 'block' : gold.expectedAction === 'allow' ? 'allow' : gold.expectedAction,
    claimType: gold.claimType,
    verificationStatus: gold.verificationStatus,
    identityAction: gold.identityAction,
    schemaVersion: 1,
  };
}
function normalizePrediction(raw, id) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const decision = String(value.decision || value.action || '').trim().toLowerCase();
  const normalizedDecision = decision === 'uncertain' || decision === 'review' ? 'defer' : decision;
  if (!ALLOWED_ACTIONS.has(normalizedDecision)) fail(id + ' prediction.decision 无效');
  const claimType = String(value.claimType || 'unknown');
  const verificationStatus = String(value.verificationStatus || 'unknown');
  if (!ALLOWED_CLAIMS.has(claimType) || !ALLOWED_VERIFICATION.has(verificationStatus)) fail(id + ' prediction 分类无效');
  const identityAction = String(value.identityAction || 'no_action');
  if (!ALLOWED_IDENTITY.has(identityAction)) fail(id + ' prediction.identityAction 无效');
  return { id, decision: normalizedDecision, claimType, verificationStatus, identityAction, schemaVersion: Number(value.schemaVersion) || 0 };
}
function loadPredictions(dataset, mode, inputPath) {
  if (mode === 'mock') return dataset.cases.map(mockPrediction);
  if (mode !== 'recorded') fail('当前只支持 --mode=mock 或 --mode=recorded；live 保留给后续本机 mock 网关阶段');
  if (!inputPath) fail('recorded 模式必须提供 --input=<脱敏预测 JSON>');
  const source = readJson(path.resolve(ROOT, inputPath));
  const list = Array.isArray(source) ? source : source && source.predictions;
  if (!Array.isArray(list)) fail('预测文件缺少 predictions 数组');
  const byId = new Map(list.map((item) => [String(item && item.id || ''), item]));
  return dataset.cases.map((item) => normalizePrediction(byId.get(item.id), item.id));
}
function binaryMetrics(rows, expected, actual) {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const row of rows) {
    const e = expected(row); const a = actual(row);
    if (e && a) tp++; else if (!e && a) fp++; else if (e && !a) fn++; else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1, count: rows.length };
}
function evaluate(dataset, predictions) {
  const predById = new Map(predictions.map((item) => [item.id, item]));
  const rows = dataset.cases.map((item) => ({ item, prediction: predById.get(item.id) }));
  const action = binaryMetrics(rows, (row) => row.item.gold.expectedAction === 'block', (row) => row.prediction.decision === 'block');
  const nonBlock = rows.filter((row) => row.item.gold.expectedAction !== 'block');
  const falseBlock = binaryMetrics(nonBlock, () => false, (row) => row.prediction.decision === 'block');
  const unverified = rows.filter((row) => row.item.category === 'fact_claims' && ['not_checked', 'insufficient_context', 'unknown'].includes(row.item.gold.verificationStatus));
  const unverifiedFalseBlock = binaryMetrics(unverified, () => false, (row) => row.prediction.decision === 'block');
  const defer = binaryMetrics(rows, (row) => row.item.gold.expectedAction === 'defer', (row) => row.prediction.decision === 'defer');
  const policy = rows.filter((row) => row.item.category === 'policy_core' || row.item.category === 'context_pairs');
  const fact = rows.filter((row) => row.item.category === 'fact_claims');
  const unsafeIdentity = rows.filter((row) => ['reject_guess', 'cross_session_no_guess', 'hash_only', 'no_identity'].includes(row.item.gold.identityAction))
    .filter((row) => row.prediction.identityAction === 'uid_ok' || row.prediction.identityAction === 'execute_if_confirmed');
  const schemaErrors = predictions.filter((item) => item.schemaVersion !== 1).length;
  const byCategory = {};
  for (const category of ['policy_core', 'fact_claims', 'context_pairs', 'identity_gate', 'lifecycle_cases']) {
    const group = rows.filter((row) => row.item.category === category);
    byCategory[category] = {
      count: group.length,
      action: binaryMetrics(group, (row) => row.item.gold.expectedAction === 'block', (row) => row.prediction.decision === 'block'),
    };
  }
  const gates = {
    identitySafetyZero: unsafeIdentity.length === 0,
    unverifiedFalseBlockZero: unverifiedFalseBlock.fp === 0,
    schemaErrorsZero: schemaErrors === 0,
    policyRecallStable: policy.filter((row) => row.item.gold.expectedAction === 'block').length === 0
      || binaryMetrics(policy, (row) => row.item.gold.expectedAction === 'block', (row) => row.prediction.decision === 'block').recall >= 0.95,
    factDeferStable: defer.precision >= 0.95,
  };
  return {
    action, falseBlock, unverifiedFalseBlock, defer, byCategory,
    identityUnsafeCount: unsafeIdentity.length, schemaErrors, gates,
    gatePassed: Object.values(gates).every(Boolean),
  };
}
function parseArgs(argv) {
  const out = { mode: 'mock', input: '' };
  for (const arg of argv.slice(2)) {
    const match = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out[match[1]] = match[2] == null ? true : match[2];
  }
  return out;
}
function main() {
  const args = parseArgs(process.argv);
  const dataset = validateDataset(readJson(DATASET_PATH));
  const datasetHash = sha256(canonical(dataset));
  const predictions = loadPredictions(dataset, String(args.mode), args.input);
  const metrics = evaluate(dataset, predictions);
  const report = {
    datasetId: dataset.datasetId,
    datasetHash,
    mode: String(args.mode),
    caseCount: dataset.cases.length,
    note: String(args.mode) === 'mock' ? 'mock-oracle：仅验证评测引擎、schema 和安全门禁，不代表真实模型准确率' : 'recorded：预测文件必须来自脱敏、可复现的维护样本',
    metrics,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!metrics.gatePassed) process.exitCode = 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error('AI EVAL ERROR:', error && error.message || error); process.exitCode = 1; }
}
module.exports = { canonical, sha256, validateDataset, normalizePrediction, evaluate };

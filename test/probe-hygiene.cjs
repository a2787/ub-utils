/* OmniBlock 真实探针注入卫生回归。
 * 该断言针对 test/real-douyin-probe.cjs 的 CDP 生命周期；不连接真实站点，
 * 只保证 probe 结束时会移除 document-start 测试 shim，避免污染复用的用户标签页。
 * 运行：node test/probe-hygiene.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./runtime.cjs');

const source = fs.readFileSync(path.join(ROOT, 'test', 'real-douyin-probe.cjs'), 'utf8');
const addIndex = source.indexOf('Page.addScriptToEvaluateOnNewDocument');
const removeIndex = source.indexOf('Page.removeScriptToEvaluateOnNewDocument');
const finallyIndex = source.lastIndexOf('} finally {');
const closeIndex = source.lastIndexOf('client.close()');
const hasIdentifierCapture = /injectedScriptId\s*=\s*String\(injected\s*&&\s*injected\.identifier/.test(source);
const hasCleanupGuard = /if\s*\(injectedScriptId\s*&&\s*sessionId\)/.test(source);

const failures = [];
if (addIndex < 0) failures.push('未找到 document-start 注入调用');
if (removeIndex < 0) failures.push('未找到 document-start 移除调用');
if (!hasIdentifierCapture) failures.push('未保存 Page.addScriptToEvaluateOnNewDocument 返回的 identifier');
if (!hasCleanupGuard) failures.push('缺少注入标识和 CDP 会话的清理保护');
if (finallyIndex < 0 || removeIndex < finallyIndex) failures.push('移除调用不在最终清理路径');
if (closeIndex >= 0 && removeIndex > closeIndex) failures.push('关闭 CDP 客户端前没有先移除注入脚本');

if (failures.length) {
  console.error('FAIL:', failures.join('；'));
  process.exit(1);
}
console.log('PASS: probe hygiene 1/1');

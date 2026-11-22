/* OmniBlock 代码健康门禁（Phase 4 / Task 4.1，OB 个人 2.0 计划 §7）。
 * 读取 omniblock.user.js，与 test/code-health-baseline.json 比较：
 *   - 空 catch 数量只允许下降或持平（防止再引入吞异常的 catch{}）；
 *   - 总行数不超过 maxLines（阻止单文件无上限增长）；
 *   - GM_addStyle 注入的 CSS 串长度不超过 maxCssChars（宽松上限，防样式膨胀）。
 * 基线锁定为 Phase 4 落地时的实测值；修复后应同步下调基线，不允许上调。
 * 本检查纯静态、不访问浏览器与真实站点。
 * 运行：node test/code-health.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./runtime.cjs');

const sourcePath = path.join(ROOT, 'omniblock.user.js');
const baselinePath = path.join(__dirname, 'code-health-baseline.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

// 空 catch：catch {} / catch (e) {}，花括号之间只有空白。
const emptyCatch = (source.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) || []).length;
const lines = source.split(/\r?\n/).length;

// GM_addStyle 注入的 CSS 串：定位唯一调用后的模板字面量，扫描未转义的收尾反引号。
// 解析异常（找不到、未闭合、收尾后不是右括号）视为门禁失败，而不是静默跳过。
const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);
function measureInjectedCss(text) {
  const marker = 'GM_addStyle(';
  const start = text.indexOf(marker);
  if (start < 0) return { error: '未找到 GM_addStyle( 调用' };
  let i = start + marker.length;
  if (text[i] !== BT) return { error: 'GM_addStyle( 后不是模板字面量' };
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === BS) { j += 1; continue; }
    if (text[j] === BT) {
      if (text[j + 1] !== ')') return { error: 'GM_addStyle 模板收尾异常（可能提前闭合）' };
      return { chars: text.slice(i + 1, j) .length };
    }
  }
  return { error: 'GM_addStyle 模板字面量未闭合' };
}

const css = measureInjectedCss(source);

const failures = [];
if (typeof baseline.emptyCatch !== 'number' || typeof baseline.maxLines !== 'number'
  || typeof baseline.maxCssChars !== 'number') {
  failures.push('基线文件缺少 emptyCatch/maxLines/maxCssChars 数值字段');
}
if (emptyCatch > baseline.emptyCatch) {
  failures.push(`空 catch ${emptyCatch} > 基线 ${baseline.emptyCatch}（只允许下降或持平）`);
}
if (lines > baseline.maxLines) {
  failures.push(`总行数 ${lines} > 上限 ${baseline.maxLines}`);
}
if (css.error) {
  failures.push(`CSS 注入测量失败：${css.error}`);
} else if (typeof baseline.maxCssChars === 'number' && css.chars > baseline.maxCssChars) {
  failures.push(`GM_addStyle CSS ${css.chars} 字符 > 上限 ${baseline.maxCssChars}`);
}

if (failures.length) {
  console.error('CODE HEALTH FAILED');
  failures.forEach((f) => console.error('- ' + f));
  process.exit(1);
}
console.log(`PASS: code-health emptyCatch=${emptyCatch}/${baseline.emptyCatch}, lines=${lines}/${baseline.maxLines}, cssChars=${css.chars}/${baseline.maxCssChars}`);

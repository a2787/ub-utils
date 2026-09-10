/* 受控事实核查 broker 的本机合成回归测试；不访问公网、不读取凭据。 */
const http = require('http');
const assert = require('assert');
const { createServer, sanitizeClaim, validateSources, processFactCheck } = require('../gateway/scripts/fact-retrieval.cjs');

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
function fetchJson(url, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    request.on('error', reject); request.end(JSON.stringify(body));
  });
}

(async () => {
  const report = { pass: [], fail: [] };
  try {
    assert.strictEqual(sanitizeClaim('网址 https://example.invalid/a 账号 bili:uid:123456 长数字 1234567'), '网址 账号 长数字 <redacted>');
    report.pass.push('RETRIEVAL-1 claim 脱敏去掉 URL、身份键和长数字');
    assert.throws(() => validateSources([{ id: 'bad', endpoint: 'http://public.example.invalid', sourceTier: 'official' }]));
    assert.throws(() => validateSources([{ id: 'bad', endpoint: 'https://public.example.invalid/?q=raw', sourceTier: 'official' }]));
    report.pass.push('RETRIEVAL-2 allowlist 拒绝非 HTTPS、带 query 的来源配置');

    const sourceServer = http.createServer((request, response) => {
      const body = JSON.stringify({ results: [{ title: '人工合成官方来源', snippet: '人工合成的矛盾依据 https://source.invalid/private 账号 1234567', publishedAt: '2026-01-01', verdict: 'contradicted' }] });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); response.end(body);
    });
    const sourcePort = await listen(sourceServer);
    const sources = validateSources([{ id: 'synthetic-official', endpoint: 'http://127.0.0.1:' + sourcePort, sourceTier: 'official' }]);
    const broker = createServer({ sources });
    const brokerPort = await listen(broker);
    const rejected = await fetchJson('http://127.0.0.1:' + brokerPort + '/v1/fact-check', {
      schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', claims: [{ id: 'c1', text: '人工合成事实主张 https://example.invalid/private', language: 'zh-CN' }],
    });
    assert.strictEqual(rejected.status, 400);
    const result = await fetchJson('http://127.0.0.1:' + brokerPort + '/v1/fact-check', {
      schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', claims: [{ id: 'c1', text: '人工合成事实主张 <redacted>，附带', language: 'zh-CN' }],
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.items[0].status, 'contradicted');
    assert.strictEqual(result.body.items[0].sources[0].sourceId, 'synthetic-official');
    assert.ok(!JSON.stringify(result.body).includes('example.invalid/private'));
    assert.ok(!JSON.stringify(result.body).includes('source.invalid/private'));
    assert.ok(!JSON.stringify(result.body).includes('1234567'));
    report.pass.push('RETRIEVAL-3 broker 拒绝未脱敏请求，并对 allowlist 来源响应做大小/字段脱敏');
    const oversized = await processFactCheck({
      schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1',
      claims: [{ id: 'c1', text: '人工合成超大响应测试', language: 'zh-CN' }],
    }, sources, async () => ({ ok: true, headers: { get: () => '' }, arrayBuffer: async () => new Uint8Array(256 * 1024 + 1) }));
    assert.strictEqual(oversized.items[0].status, 'not_checked');
    assert.deepStrictEqual(oversized.items[0].sources, []);
    report.pass.push('RETRIEVAL-4 无 Content-Length 的超大来源响应也被丢弃');
    await close(broker); await close(sourceServer);

    const empty = await processFactCheck({ schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', claims: [{ id: 'c1', text: '人工合成无来源事实', language: 'zh-CN' }] }, []);
    assert.strictEqual(empty.items[0].status, 'not_checked');
    assert.deepStrictEqual(empty.items[0].sources, []);
    report.pass.push('RETRIEVAL-5 无 allowlist/无来源统一 not_checked，不伪造证据');
  } catch (error) { report.fail.push(String(error && error.stack || error)); }
  console.log('PASS:', report.pass.join(' | ') || '无');
  console.log('FAIL:', report.fail.join(' | ') || '无');
  process.exitCode = report.fail.length ? 1 : 0;
})().catch((error) => { console.error('AI RETRIEVAL TEST ERROR:', error.stack || error); process.exitCode = 1; });

#!/usr/bin/env node
/*
 * OmniBlock 受控事实核查 broker。
 *
 * 这是一个 loopback-only 的只读 sidecar，不是搜索引擎，也不负责决定屏蔽。
 * 只有显式写入本机 fact-sources.local.json 的 HTTPS allowlist 来源才会被访问；
 * 默认没有来源，服务会返回 not_checked。请求只接受脱敏 claim，不接受 UID、hash、
 * URL、Cookie 或授权头。来源响应只保留受限的标题、摘要、时间和 verdict。
 *
 * 启动：node gateway/scripts/fact-retrieval.cjs --port=4001 --sources=gateway/runtime/fact-sources.local.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 4001;
const MAX_CLAIMS = 8;
const MAX_CLAIM_LENGTH = 320;
const MAX_SOURCES = 3;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const SOURCE_TIMEOUT_MS = 3500;
const ALLOWED_TIERS = new Set(['official', 'licensed', 'local']);
const ALLOWED_VERDICTS = new Set(['supported', 'contradicted', 'not_checked', 'insufficient_context']);

function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
function sanitizeClaim(value) {
  return cleanText(value, MAX_CLAIM_LENGTH)
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/(?:cookie|set-cookie|authorization|bearer|api[\s_-]?key|token)\s*[:=]?\s*\S+/gi, ' ')
    .replace(/(?:bili|douyin|weibo|zhihu|tieba|x):[a-z0-9_-]+:[^\s,，。；;]+/gi, ' ')
    .replace(/\b(?:BV[0-9A-Za-z]{8,}|\d{5,})\b/g, '<redacted>')
    .replace(/@[\w.-]{2,64}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CLAIM_LENGTH);
}
function sanitizeSourceText(value, maxLength) {
  return cleanText(value, maxLength)
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/(?:cookie|set-cookie|authorization|bearer|api[\s_-]?key|token)\s*[:=]?\s*\S+/gi, ' ')
    .replace(/(?:bili|douyin|weibo|zhihu|tieba|x):[a-z0-9_-]+:[^\s,，。；;]+/gi, ' ')
    .replace(/\b(?:BV[0-9A-Za-z]{8,}|\d{5,})\b/g, '<redacted>')
    .replace(/@[\w.-]{2,64}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
function pathValue(source, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean).reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, source);
}
function validateSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('source must be an object');
  const id = cleanText(raw.id, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('source id invalid');
  const endpoint = String(raw.endpoint || '').trim();
  let url;
  try { url = new URL(endpoint); } catch (error) { throw new Error('source endpoint invalid'); }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) throw new Error('source endpoint must use https');
  if (url.username || url.password || url.search || url.hash) throw new Error('source endpoint must not contain credentials/query/hash');
  const sourceTier = cleanText(raw.sourceTier, 24).toLowerCase();
  if (!ALLOWED_TIERS.has(sourceTier)) throw new Error('source tier invalid');
  const parser = raw.parser || 'json';
  if (parser !== 'json') throw new Error('only json parser is supported');
  const queryParam = cleanText(raw.queryParam || 'q', 32);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(queryParam)) throw new Error('queryParam invalid');
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
  return {
    id,
    endpoint: url.href,
    queryParam,
    sourceTier,
    parser,
    resultPath: cleanText(raw.resultPath || 'results', 80),
    fields: {
      title: cleanText(fields.title || 'title', 80),
      snippet: cleanText(fields.snippet || 'snippet', 80),
      publishedAt: cleanText(fields.publishedAt || 'publishedAt', 80),
      verdict: cleanText(fields.verdict || 'verdict', 80),
    },
  };
}
function validateSources(config) {
  const sourceList = Array.isArray(config) ? config : config && config.sources;
  if (!Array.isArray(sourceList)) throw new Error('fact source config 缺少 sources');
  const out = []; const seen = new Set();
  for (const raw of sourceList.slice(0, 16)) {
    const source = validateSource(raw);
    if (seen.has(source.id)) throw new Error('duplicate source id');
    seen.add(source.id); out.push(source);
  }
  return out;
}
function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, sources: path.join(__dirname, '..', 'runtime', 'fact-sources.local.json') };
  for (const arg of argv.slice(2)) {
    const match = String(arg).match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  out.port = Math.max(1, Math.min(65535, Number(out.port) || DEFAULT_PORT));
  return out;
}
function loadSources(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return validateSources(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}
function statusForSources(sources) {
  return sources.length ? 'not_checked' : 'not_checked';
}
function sourceResultValue(value) {
  const verdict = cleanText(value, 32).toLowerCase();
  return ALLOWED_VERDICTS.has(verdict) ? verdict : 'insufficient_context';
}
function normalizeSourceResult(source, raw) {
  const title = sanitizeSourceText(pathValue(raw, source.fields.title), 160);
  const snippet = sanitizeSourceText(pathValue(raw, source.fields.snippet), 480);
  const publishedAt = sanitizeSourceText(pathValue(raw, source.fields.publishedAt), 40);
  if (!title && !snippet) return null;
  return {
    sourceId: source.id,
    sourceTier: source.sourceTier,
    title: title || 'allowlist source',
    snippet,
    publishedAt,
    verdict: sourceResultValue(pathValue(raw, source.fields.verdict)),
  };
}
async function fetchSource(source, claim, fetchImpl) {
  const url = new URL(source.endpoint);
  url.searchParams.set(source.queryParam, claim);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response || !response.ok) return [];
    const length = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
    if (length > MAX_SOURCE_BYTES) return [];
    if (typeof response.arrayBuffer !== 'function') return [];
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_SOURCE_BYTES) return [];
    const raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const list = pathValue(raw, source.resultPath);
    return (Array.isArray(list) ? list : []).slice(0, MAX_SOURCES).map((item) => normalizeSourceResult(source, item)).filter(Boolean);
  } catch (error) {
    return [];
  } finally { clearTimeout(timer); }
}
function mergeVerdict(results) {
  const verdicts = new Set(results.map((item) => item.verdict).filter((value) => value !== 'insufficient_context'));
  if (verdicts.has('contradicted') && verdicts.has('supported')) return 'unknown';
  if (verdicts.size === 1) return Array.from(verdicts)[0];
  return results.length ? 'insufficient_context' : 'not_checked';
}
function validateFactRequest(body) {
  if (!body || Number(body.schemaVersion) !== 1
    || body.policyVersion !== 'fact-local-allowlist-v1' || !Array.isArray(body.claims)
    || body.claims.length > MAX_CLAIMS) throw new Error('fact-check request schema invalid');
  const seen = new Set();
  for (const raw of body.claims) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some((key) => !['id', 'text', 'language'].includes(key))) {
      throw new Error('fact-check claim schema invalid');
    }
    const id = cleanText(raw.id, 32);
    const text = String(raw.text == null ? '' : raw.text);
    if (!/^c\d{1,2}$/.test(id) || seen.has(id) || raw.language !== 'zh-CN'
      || !text || sanitizeClaim(text) !== text) throw new Error('fact-check claim is not sanitized');
    seen.add(id);
  }
  return body.claims;
}
async function processFactCheck(body, sources, fetchImpl = globalThis.fetch) {
  const claims = validateFactRequest(body);
  const items = [];
  for (const raw of claims) {
    const id = cleanText(raw && raw.id, 32);
    const claim = sanitizeClaim(raw && raw.text);
    if (!/^c\d{1,2}$/.test(id) || !claim) {
      items.push({ id, status: 'not_checked', method: 'local_allowlist', sources: [] });
      continue;
    }
    const results = [];
    for (const source of sources) {
      const sourceResults = await fetchSource(source, claim, fetchImpl);
      for (const result of sourceResults) results.push(result);
      if (results.length >= MAX_SOURCES) break;
    }
    const unique = [];
    const seen = new Set();
    for (const result of results) {
      const key = result.sourceId + '\x1f' + result.title + '\x1f' + result.snippet;
      if (seen.has(key)) continue;
      seen.add(key); unique.push(result);
      if (unique.length >= MAX_SOURCES) break;
    }
    items.push({ id, status: mergeVerdict(unique), method: 'local_allowlist', sources: unique });
  }
  return { schemaVersion: 1, policyVersion: 'fact-local-allowlist-v1', items };
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0; let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { size += Buffer.byteLength(chunk); if (size <= MAX_BODY_BYTES) text += chunk; });
    request.on('end', () => { if (size > MAX_BODY_BYTES) reject(new Error('request too large')); else resolve(JSON.parse(text || '{}')); });
    request.on('error', reject);
  });
}
function createServer({ sources = [], fetchImpl = globalThis.fetch } = {}) {
  const safeSources = validateSources(sources);
  return http.createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.method === 'GET' && request.url === '/health') return send(200, { ok: true, sourceCount: safeSources.length, policyVersion: 'fact-local-allowlist-v1' });
    if (request.method !== 'POST' || request.url !== '/v1/fact-check') return send(404, { error: 'not_found' });
    try { return send(200, await processFactCheck(await readBody(request), safeSources, fetchImpl)); }
    catch (error) { return send(400, { error: 'invalid_request' }); }
  });
}
async function main() {
  const args = parseArgs(process.argv);
  const sources = loadSources(path.resolve(args.sources));
  const server = createServer({ sources });
  server.listen(args.port, '127.0.0.1', () => console.log('OmniBlock fact broker listening on 127.0.0.1:' + args.port + ' sources=' + sources.length));
}
if (require.main === module) main().catch((error) => { console.error('FACT BROKER ERROR:', error.message); process.exitCode = 1; });
module.exports = { sanitizeClaim, sanitizeSourceText, validateSource, validateSources, validateFactRequest, processFactCheck, createServer, sha256 };

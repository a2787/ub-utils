'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'gateway', 'scripts', 'render-config.cjs');
const LAUNCHER = path.join(ROOT, '启动网关.cmd');
const IMAGE = 'ghcr.io/berriai/litellm:v1.98.0';
const SKIP_DOCKER = process.argv.includes('--skip-docker');

class BlockedError extends Error {}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim().slice(-1200);
    throw new Error(`${command} ${args.join(' ')} 失败（${result.status}）${detail ? `：${detail}` : ''}`);
  }
  return result.stdout || '';
}

function writeUtf8(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: 'utf8' });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = netServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function netServer() {
  const net = require('node:net');
  return net.createServer();
}

function startMockProvider({ name, fail }) {
  const state = { name, requests: [] };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: name, object: 'model' }] }));
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      state.requests.push(parsed);
      if (fail) {
        response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        response.end(JSON.stringify({ error: { message: 'synthetic rate limit', type: 'rate_limit_error' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `smoke-${name}`,
        object: 'chat.completion',
        created: 1,
        model: name,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'fallback-ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error(`mock provider ${name} 没有取得监听端口`));
        return;
      }
      resolve({ server, port: address.port, state });
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function waitForHealthy(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const result = await fetchJson(url);
      if (result.response.ok) return result;
      lastError = `HTTP ${result.response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(1000);
  }
  throw new Error(`网关健康检查超时：${lastError}`);
}

function dockerReady() {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  return result.status === 0 && String(result.stdout || '').trim().length > 0;
}

function createFixtureConfig(primaryPort, fallbackPort) {
  return {
    modelAlias: 'omni-smoke',
    image: IMAGE,
    settings: {
      routingStrategy: 'simple-shuffle',
      requestTimeoutSeconds: 5,
      numRetries: 0,
      allowedFails: 1,
      cooldownSeconds: 5,
    },
    providers: [
      {
        id: 'synthetic-primary',
        baseUrl: `http://host.docker.internal:${primaryPort}/v1`,
        model: 'synthetic-primary-model',
        litellmModel: 'openai/synthetic-primary-model',
        thinkingMode: 'disabled',
        apiKey: 'synthetic-primary-key',
        role: 'primary',
        rpm: 60,
      },
      {
        id: 'synthetic-fallback',
        baseUrl: `http://host.docker.internal:${fallbackPort}/v1`,
        model: 'synthetic-fallback-model',
        litellmModel: 'openai/synthetic-fallback-model',
        apiKey: 'synthetic-fallback-key',
        role: 'fallback',
        rpm: 60,
      },
    ],
  };
}

function createComposeFile() {
  return fs.readFileSync(path.join(ROOT, 'gateway', 'docker-compose.yml'), 'utf8');
}

function assertLauncher() {
  const launcher = fs.readFileSync(LAUNCHER, 'utf8');
  assert.match(launcher, /where pwsh\.exe/i);
  assert.match(launcher, /gateway\\start\.ps1/i);
  assert.match(launcher, /%~dp0/i);
  assert.match(launcher, /pause/i);
  assert.doesNotMatch(launcher, /powershell\.exe/i);
  assert.doesNotMatch(launcher, /(?:API[_-]?KEY|api[_-]?key\s*=|sk-[A-Za-z0-9_-]{12,})/i);
  console.log('PASS: 根目录双击启动文件只调用 PowerShell 7 gateway\\start.ps1，保留错误窗口且不含凭据');
}

async function main() {
  console.log('==== OmniBlock AI gateway smoke ====');
  console.log('FIXTURE: artificial local providers; no real API key or real provider traffic');
  assertLauncher();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniblock-ai-gateway-'));
  const runtimeDir = path.join(tempDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  let primary;
  let fallback;
  let composeStarted = false;
  let composeArgs = null;
  try {
    if (!SKIP_DOCKER && !dockerReady()) {
      throw new BlockedError('Docker Linux 引擎未运行；先启动 Docker Desktop 后重试 gateway smoke。');
    }

    primary = await startMockProvider({ name: 'synthetic-primary-model', fail: true });
    fallback = await startMockProvider({ name: 'synthetic-fallback-model', fail: false });
    const configPath = path.join(tempDir, 'providers.local.json');
    writeUtf8(configPath, `${JSON.stringify(createFixtureConfig(primary.port, fallback.port), null, 2)}\n`);
    run(process.execPath, [RENDERER, '--input', configPath, '--output-dir', runtimeDir]);

    const configYaml = fs.readFileSync(path.join(runtimeDir, 'litellm.config.yaml'), 'utf8');
    const secretsEnv = fs.readFileSync(path.join(runtimeDir, 'provider-secrets.env'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'gateway.manifest.json'), 'utf8'));
    assert.match(configYaml, /omni-smoke-fallback/);
    assert.match(configYaml, /OMNI_PROVIDER_001_API_KEY/);
    assert.match(configYaml, /extra_body:\s+thinking:\s+type: "disabled"/);
    assert.doesNotMatch(configYaml, /synthetic-primary-key|synthetic-fallback-key/);
    assert.match(secretsEnv, /synthetic-primary-key/);
    assert.match(secretsEnv, /synthetic-fallback-key/);
    assert.equal(manifest.primaryCount, 1);
    assert.equal(manifest.fallbackCount, 1);
    console.log('PASS: 向导配置格式生成、Key 与 YAML 分离、primary/fallback 分组和别名校验');

    if (SKIP_DOCKER) {
      console.log('RESULT: STRUCTURE REGRESSION PASSED (--skip-docker)');
      return;
    }

    const proxyPort = await reservePort();
    writeUtf8(path.join(tempDir, 'docker-compose.yml'), createComposeFile());
    writeUtf8(path.join(tempDir, 'compose.env'), `OMNI_GATEWAY_PORT=${proxyPort}\nLITELLM_IMAGE=${IMAGE}\n`);
    const projectName = `omniblock-ai-smoke-${process.pid}`;
    composeArgs = ['compose', '--project-name', projectName, '--env-file', path.join(tempDir, 'compose.env'), '--file', path.join(tempDir, 'docker-compose.yml')];
    composeStarted = true;
    run('docker', [...composeArgs, 'up', '-d']);
    await waitForHealthy(`http://127.0.0.1:${proxyPort}/health/liveliness`);
    const modelList = await fetchJson(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(modelList.response.status, 200);
    assert.ok(Array.isArray(modelList.body.data));
    assert.ok(modelList.body.data.some((item) => item.id === 'omni-smoke'));

    const completion = await fetchJson(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'omni-smoke',
        temperature: 0,
        messages: [{ role: 'user', content: '人工合成 gateway smoke' }],
      }),
    });
    assert.equal(completion.response.status, 200, JSON.stringify(completion.body));
    assert.equal(completion.body.choices[0].message.content, 'fallback-ok');
    assert.ok(primary.state.requests.length >= 1, '主 provider 没有收到测试请求');
    assert.ok(fallback.state.requests.length >= 1, 'fallback provider 没有收到测试请求');
    console.log('PASS: LiteLLM 容器健康、OpenAI 兼容入口、429 后自动 fallback 和返回格式');
    console.log('RESULT: STRUCTURE REGRESSION PASSED');
  } finally {
    if (composeStarted && composeArgs) {
      try {
        run('docker', [...composeArgs, 'down']);
      } catch {
        // The test result already contains the primary failure; do not print container logs.
      }
    }
    await Promise.all([primary, fallback].filter(Boolean).map(({ server }) => new Promise((resolve) => server.close(() => resolve()))));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (error instanceof BlockedError) {
    console.log(`BLOCKED: ${error.message}`);
    console.log('RESULT: BLOCKED');
    process.exitCode = 2;
    return;
  }
  console.error(`FAIL: ${error.stack || error.message}`);
  console.log('RESULT: FAILED');
  process.exitCode = 1;
});

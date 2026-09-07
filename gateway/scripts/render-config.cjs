'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  modelAlias: 'omni-default',
  routingStrategy: 'simple-shuffle',
  requestTimeoutSeconds: 18,
  numRetries: 1,
  allowedFails: 2,
  cooldownSeconds: 60,
  image: 'ghcr.io/berriai/litellm:v1.98.0',
});

function fail(message) {
  throw new Error(`[gateway-config] ${message}`);
}

function parseArgs(argv) {
  const args = { input: '', outputDir: '', checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--check-only') {
      args.checkOnly = true;
      continue;
    }
    if (value === '--input' || value === '--output-dir') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) fail(`${value} 需要一个路径`);
      if (value === '--input') args.input = next;
      else args.outputDir = next;
      index += 1;
      continue;
    }
    fail(`未知参数：${value}`);
  }
  if (!args.input) fail('缺少 --input');
  if (!args.checkOnly && !args.outputDir) fail('写入模式需要 --output-dir');
  return args;
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`);
  return value;
}

function asString(value, label, { required = true, max = 512 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    fail(`${label} 不能为空`);
  }
  if (typeof value !== 'string') fail(`${label} 必须是字符串`);
  if (value.length > max) fail(`${label} 不能超过 ${max} 个字符`);
  if (/\r|\n/.test(value)) fail(`${label} 不能包含换行`);
  return value.trim();
}

function asOptionalNumber(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function asBoolean(value, defaultValue) {
  return value === undefined ? defaultValue : value === true;
}

function validateAlias(value, label) {
  const alias = asString(value, label, { max: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(alias)) {
    fail(`${label} 只能包含字母、数字、点、下划线、冒号和短横线`);
  }
  return alias;
}

function validateBaseUrl(value, label) {
  const text = asString(value, label, { max: 2048 });
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    fail(`${label} 不是有效 URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail(`${label} 只允许 http 或 https`);
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${label} 不能包含用户名、密码、查询参数或片段`);
  }
  if (/\/chat\/completions\/?$/i.test(parsed.pathname) || /\/responses\/?$/i.test(parsed.pathname)) {
    fail(`${label} 应填写 provider 的 base URL（通常以 /v1 结尾），不能填写具体接口路径`);
  }
  return text.replace(/\/+$/, '');
}

function validateProvider(value, index) {
  const source = asObject(value, `providers[${index}]`);
  const id = asString(source.id, `providers[${index}].id`, { max: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    fail(`providers[${index}].id 只能包含字母、数字、下划线和短横线`);
  }
  const baseUrl = validateBaseUrl(source.baseUrl, `providers[${index}].baseUrl`);
  const model = asString(source.model, `providers[${index}].model`, { max: 256 });
  const litellmModel = asString(source.litellmModel, `providers[${index}].litellmModel`, {
    required: false,
    max: 256,
  }) || `openai/${model}`;
  const thinkingMode = asString(source.thinkingMode, `providers[${index}].thinkingMode`, {
    required: false,
    max: 16,
  }).toLowerCase();
  if (thinkingMode && !['disabled', 'enabled'].includes(thinkingMode)) {
    fail(`providers[${index}].thinkingMode 只能是 disabled 或 enabled`);
  }
  const rawApiKey = asString(source.apiKey, `providers[${index}].apiKey`, {
    required: false,
    max: 8192,
  });
  const apiKey = rawApiKey.trim() ? rawApiKey : 'none';
  const role = source.role === undefined ? 'primary' : source.role;
  if (!['primary', 'fallback'].includes(role)) fail(`providers[${index}].role 只能是 primary 或 fallback`);
  return {
    id,
    baseUrl,
    model,
    litellmModel,
    thinkingMode,
    apiKey,
    role,
    enabled: asBoolean(source.enabled, true),
    rpm: asOptionalNumber(source.rpm, `providers[${index}].rpm`, { min: 1, max: 10_000_000 }),
    tpm: asOptionalNumber(source.tpm, `providers[${index}].tpm`, { min: 1, max: 100_000_000 }),
    weight: asOptionalNumber(source.weight, `providers[${index}].weight`, { min: 1, max: 10_000 }),
  };
}

function validateConfig(raw) {
  const source = asObject(raw, '配置根对象');
  const modelAlias = validateAlias(source.modelAlias || DEFAULTS.modelAlias, 'modelAlias');
  const providers = Array.isArray(source.providers)
    ? source.providers.map(validateProvider)
    : fail('providers 必须是数组');
  if (providers.length < 1 || providers.length > 32) fail('providers 数量必须在 1 到 32 之间');
  const ids = new Set();
  for (const provider of providers) {
    const normalizedId = provider.id.toLowerCase();
    if (ids.has(normalizedId)) fail(`provider id 重复：${provider.id}`);
    ids.add(normalizedId);
  }
  const active = providers.filter((provider) => provider.enabled);
  if (active.length < 1) fail('至少需要一个 enabled provider');
  const primary = active.filter((provider) => provider.role === 'primary');
  if (primary.length < 1) fail('至少需要一个 primary provider');

  const settings = asObject(source.settings || {}, 'settings');
  const routingStrategy = settings.routingStrategy || DEFAULTS.routingStrategy;
  if (!['simple-shuffle', 'least-busy', 'latency-based-routing'].includes(routingStrategy)) {
    fail('settings.routingStrategy 不是支持的 LiteLLM 路由策略');
  }
  const normalizedSettings = {
    routingStrategy,
    requestTimeoutSeconds: asOptionalNumber(
      settings.requestTimeoutSeconds,
      'settings.requestTimeoutSeconds',
      { min: 1, max: 120 },
    ) ?? DEFAULTS.requestTimeoutSeconds,
    numRetries: asOptionalNumber(settings.numRetries, 'settings.numRetries', { min: 0, max: 5 }) ?? DEFAULTS.numRetries,
    allowedFails: asOptionalNumber(settings.allowedFails, 'settings.allowedFails', { min: 1, max: 100 }) ?? DEFAULTS.allowedFails,
    cooldownSeconds: asOptionalNumber(settings.cooldownSeconds, 'settings.cooldownSeconds', { min: 1, max: 3600 }) ?? DEFAULTS.cooldownSeconds,
  };
  const fallback = active.filter((provider) => provider.role === 'fallback');
  const fallbackAlias = fallback.length ? `${modelAlias}-fallback` : '';
  if (fallbackAlias.length > 64) fail('modelAlias 太长，无法生成 fallback 别名');
  const image = asString(source.image, 'image', { required: false, max: 256 }) || DEFAULTS.image;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/.test(image)) fail('image 不是安全的 Docker 镜像引用');
  return {
    modelAlias,
    fallbackAlias,
    image,
    settings: normalizedSettings,
    providers: active,
    primary,
    fallback,
  };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function yamlNumber(value) {
  return String(value);
}

function envQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._~+/=-]+$/.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function renderModelEntry(provider, modelAlias, envName) {
  const lines = [
    `  - model_name: ${yamlString(modelAlias)}`,
    '    litellm_params:',
    `      model: ${yamlString(provider.litellmModel)}`,
    `      api_base: ${yamlString(provider.baseUrl)}`,
    `      api_key: ${yamlString(`os.environ/${envName}`)}`,
  ];
  if (provider.thinkingMode) {
    lines.push(
      '      extra_body:',
      '        thinking:',
      `          type: ${yamlString(provider.thinkingMode)}`,
    );
  }
  if (provider.rpm !== undefined) lines.push(`      rpm: ${yamlNumber(provider.rpm)}`);
  if (provider.tpm !== undefined) lines.push(`      tpm: ${yamlNumber(provider.tpm)}`);
  if (provider.weight !== undefined) lines.push(`      weight: ${yamlNumber(provider.weight)}`);
  return lines;
}

function renderFiles(config) {
  const yaml = [
    '# Generated by gateway/scripts/render-config.cjs. Do not edit this file directly.',
    '# API keys are loaded from provider-secrets.env via os.environ references.',
    'model_list:',
  ];
  const secretLines = [
    '# Generated locally. Keep this file private and never commit it.',
  ];
  let providerNumber = 0;
  for (const provider of config.providers) {
    providerNumber += 1;
    const envName = `OMNI_PROVIDER_${String(providerNumber).padStart(3, '0')}_API_KEY`;
    const alias = provider.role === 'fallback' ? config.fallbackAlias : config.modelAlias;
    yaml.push(...renderModelEntry(provider, alias, envName));
    secretLines.push(`${envName}=${envQuote(provider.apiKey)}`);
  }
  yaml.push(
    'litellm_settings:',
    '  drop_params: true',
    `  num_retries: ${yamlNumber(config.settings.numRetries)}`,
    `  request_timeout: ${yamlNumber(config.settings.requestTimeoutSeconds)}`,
    `  allowed_fails: ${yamlNumber(config.settings.allowedFails)}`,
    `  cooldown_time: ${yamlNumber(config.settings.cooldownSeconds)}`,
  );
  if (config.fallback.length) {
    yaml.push(`  fallbacks: [${JSON.stringify({ [config.modelAlias]: [config.fallbackAlias] })}]`);
  }
  yaml.push(
    'router_settings:',
    `  routing_strategy: ${yamlString(config.settings.routingStrategy)}`,
    'general_settings:',
    '  store_model_in_db: false',
  );
  const gatewayEnv = [
    '# Generated locally. The plugin connects to this loopback port.',
    'OMNI_GATEWAY_PORT=4000',
    `LITELLM_IMAGE=${config.image}`,
  ];
  const manifest = {
    modelAlias: config.modelAlias,
    fallbackAlias: config.fallbackAlias || null,
    routingStrategy: config.settings.routingStrategy,
    providerCount: config.providers.length,
    primaryCount: config.primary.length,
    fallbackCount: config.fallback.length,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      role: provider.role,
      model: provider.model,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
    })),
  };
  return {
    configYaml: `${yaml.join('\n')}\n`,
    secretsEnv: `${secretLines.join('\n')}\n`,
    gatewayEnv: `${gatewayEnv.join('\n')}\n`,
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) fail(`找不到配置文件：${inputPath}`);
  const stat = fs.statSync(inputPath);
  if (!stat.isFile() || stat.size > 256 * 1024) fail('配置文件必须是小于 256 KiB 的普通文件');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    fail(`配置 JSON 无法解析：${error.message}`);
  }
  const config = validateConfig(raw);
  if (args.checkOnly) {
    console.log(JSON.stringify({
      valid: true,
      modelAlias: config.modelAlias,
      providerCount: config.providers.length,
      primaryCount: config.primary.length,
      fallbackCount: config.fallback.length,
      routingStrategy: config.settings.routingStrategy,
    }));
    return;
  }
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const files = renderFiles(config);
  writeUtf8(path.join(outputDir, 'litellm.config.yaml'), files.configYaml);
  writeUtf8(path.join(outputDir, 'provider-secrets.env'), files.secretsEnv);
  writeUtf8(path.join(outputDir, 'gateway.env'), files.gatewayEnv);
  writeUtf8(path.join(outputDir, 'gateway.manifest.json'), files.manifest);
  console.log(JSON.stringify({
    generated: true,
    outputDir,
    modelAlias: config.modelAlias,
    providerCount: config.providers.length,
    primaryCount: config.primary.length,
    fallbackCount: config.fallback.length,
    routingStrategy: config.settings.routingStrategy,
  }));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$GatewayRoot = $PSScriptRoot
$RuntimeDir = Join-Path $GatewayRoot 'runtime'
$InputPath = Join-Path $RuntimeDir 'providers.local.json'
$RendererPath = Join-Path $GatewayRoot 'scripts\render-config.cjs'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-Required([string]$Prompt) {
    while ($true) {
        $value = Read-Host $Prompt
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
        Write-Host '此项不能为空。'
    }
}

function Read-Choice([string]$Prompt, [string[]]$Allowed, [string]$Default) {
    while ($true) {
        $value = Read-Host "$Prompt [$Default]"
        if ([string]::IsNullOrWhiteSpace($value)) {
            return $Default
        }
        $candidate = $value.Trim().ToLowerInvariant()
        if ($Allowed -contains $candidate) {
            return $candidate
        }
        Write-Host ("请输入：" + ($Allowed -join ', '))
    }
}

function Read-OptionalPositiveInt([string]$Prompt) {
    while ($true) {
        $value = Read-Host "$Prompt（可留空）"
        if ([string]::IsNullOrWhiteSpace($value)) {
            return $null
        }
        $number = 0
        if ([int]::TryParse($value.Trim(), [ref]$number) -and $number -gt 0) {
            return $number
        }
        Write-Host '请输入正整数，或直接回车跳过。'
    }
}

function Read-ApiKey {
    $secureValue = Read-Host 'API Key（输入时不会回显；本地模型可直接回车）' -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
if ((Test-Path -LiteralPath $InputPath) -and -not $Force) {
    $answer = Read-Host '已存在本地 provider 配置，是否覆盖？输入 yes 继续'
    if ($answer.Trim().ToLowerInvariant() -ne 'yes') {
        Write-Host '已取消，原配置未修改。'
        exit 0
    }
}

Write-Host ''
Write-Host 'OmniBlock 本地 AI 网关配置向导'
Write-Host '每个 provider 将成为 LiteLLM 的一个 deployment；相同 role 的配置共享同一模型别名。'
Write-Host 'primary 先参与路由；fallback 仅在 primary 组失败后接管。'
Write-Host ''

$modelAliasInput = Read-Host '插件请求使用的模型别名 [omni-default]'
$modelAlias = if ([string]::IsNullOrWhiteSpace($modelAliasInput)) { 'omni-default' } else { $modelAliasInput.Trim() }

while ($true) {
    $providerCountInput = Read-Host '要配置几个 provider（1-32）'
    $providerCount = 0
    if ([int]::TryParse($providerCountInput.Trim(), [ref]$providerCount) -and $providerCount -ge 1 -and $providerCount -le 32) {
        break
    }
    Write-Host '请输入 1 到 32 之间的整数。'
}

$providers = @()
for ($index = 1; $index -le $providerCount; $index++) {
    Write-Host ""
    Write-Host ("--- Provider " + $index + " ---")
    $id = Read-Required '本地标识（仅字母、数字、下划线、短横线）'
    $baseUrl = Read-Required 'API Base URL（例如 https://provider.example/v1）'
    $model = Read-Required '上游模型名称'
    $litellmModel = Read-Host 'LiteLLM model reference（可留空，默认 openai/<上游模型名称>）'
    $thinkingMode = ''
    if ($model.Trim() -match '(?i)^deepseek-v4(?:-|$)') {
        Write-Host '检测到 DeepSeek V4。为适配插件的 20 秒客户端边界，默认建议关闭思考模式。'
        $thinkingMode = Read-Choice 'DeepSeek V4 thinking mode disabled/enabled' @('disabled', 'enabled') 'disabled'
    }
    $role = Read-Choice '路由角色 primary/fallback' @('primary', 'fallback') 'primary'
    $apiKey = Read-ApiKey
    $rpm = Read-OptionalPositiveInt '每分钟请求上限 RPM'
    $tpm = Read-OptionalPositiveInt '每分钟 token 上限 TPM'
    $weight = Read-OptionalPositiveInt '路由权重'

    $provider = [ordered]@{
        id = $id
        baseUrl = $baseUrl
        model = $model
        apiKey = $apiKey
        role = $role
    }
    if (-not [string]::IsNullOrWhiteSpace($litellmModel)) { $provider.litellmModel = $litellmModel.Trim() }
    if (-not [string]::IsNullOrWhiteSpace($thinkingMode)) { $provider.thinkingMode = $thinkingMode }
    if ($null -ne $rpm) { $provider.rpm = $rpm }
    if ($null -ne $tpm) { $provider.tpm = $tpm }
    if ($null -ne $weight) { $provider.weight = $weight }
    $providers += [pscustomobject]$provider
}

$config = [ordered]@{
    modelAlias = $modelAlias
    settings = [ordered]@{
        routingStrategy = 'simple-shuffle'
        requestTimeoutSeconds = 18
        numRetries = 1
        allowedFails = 2
        cooldownSeconds = 60
    }
    providers = $providers
}

$json = $config | ConvertTo-Json -Depth 8
Write-Utf8NoBom -Path $InputPath -Content ($json + [Environment]::NewLine)

& node $RendererPath --input $InputPath --output-dir $RuntimeDir
if ($LASTEXITCODE -ne 0) {
    throw 'provider 配置已保存，但生成 LiteLLM 配置失败；请根据上面的错误修正后重试。'
}

Write-Host ''
Write-Host '配置已生成。API Key 只保存在 gateway\runtime\（该目录被 Git 忽略），不会进入插件源码。'
Write-Host '下一步运行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\start.ps1'

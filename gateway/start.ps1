param(
    [switch]$SkipHealthCheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$GatewayRoot = $PSScriptRoot
$RuntimeDir = Join-Path $GatewayRoot 'runtime'
$InputPath = Join-Path $RuntimeDir 'providers.local.json'
$RendererPath = Join-Path $GatewayRoot 'scripts\render-config.cjs'
$ComposePath = Join-Path $GatewayRoot 'docker-compose.yml'
$EnvPath = Join-Path $RuntimeDir 'gateway.env'

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw '尚未找到本地 provider 配置。请先运行 gateway\setup.ps1。'
}

& node $RendererPath --input $InputPath --output-dir $RuntimeDir
if ($LASTEXITCODE -ne 0) { throw 'provider 配置校验失败，网关未启动。' }

function Test-DockerEngine {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-DockerEngine)) {
    $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $dockerDesktop) {
        Write-Host 'Docker Desktop 尚未就绪，正在启动。'
        Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }
    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-DockerEngine) {
            $ready = $true
            break
        }
        if (($attempt % 5) -eq 0) { Write-Host ("等待 Docker 引擎（" + ($attempt * 2) + " 秒）...") }
    }
    if (-not $ready) {
        throw 'Docker 引擎未能在 60 秒内启动；请手动打开 Docker Desktop 后再次运行 gateway\start.ps1。'
    }
}

Push-Location $GatewayRoot
try {
    & docker compose --project-name omniblock-ai-gateway --env-file $EnvPath --file $ComposePath up -d
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 启动失败。' }
} finally {
    Pop-Location
}

if (-not $SkipHealthCheck) {
    & (Join-Path $GatewayRoot 'health.ps1')
    if ($LASTEXITCODE -ne 0) { throw '网关容器已启动，但健康检查失败。' }
}

Write-Host 'OmniBlock AI 网关已启动： http://127.0.0.1:4000/v1/chat/completions'

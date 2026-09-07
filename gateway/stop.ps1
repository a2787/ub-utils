$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$GatewayRoot = $PSScriptRoot
$RuntimeDir = Join-Path $GatewayRoot 'runtime'
$EnvPath = Join-Path $RuntimeDir 'gateway.env'
$ComposePath = Join-Path $GatewayRoot 'docker-compose.yml'

if (-not (Test-Path -LiteralPath $EnvPath)) {
    Write-Host '没有找到已生成的网关配置，未执行任何操作。'
    exit 0
}

Push-Location $GatewayRoot
try {
    & docker compose --project-name omniblock-ai-gateway --env-file $EnvPath --file $ComposePath down
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 停止失败。' }
} finally {
    Pop-Location
}

Write-Host 'OmniBlock AI 网关已停止。'

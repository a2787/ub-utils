param(
    [int]$WaitSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$healthUrl = 'http://127.0.0.1:4000/health/liveliness'
$modelsUrl = 'http://127.0.0.1:4000/v1/models'
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
$healthy = $false

while ([DateTime]::UtcNow -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -Method Get -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        # Container startup is expected to fail the first few probes.
    }
    Start-Sleep -Seconds 1
}

if (-not $healthy) {
    throw "LiteLLM 健康检查失败：$healthUrl"
}

$modelNames = @()
try {
    $modelResponse = Invoke-RestMethod -Uri $modelsUrl -Method Get -TimeoutSec 5
    if ($null -ne $modelResponse.data) {
        $modelNames = @($modelResponse.data | ForEach-Object { $_.id })
    }
} catch {
    Write-Host '健康端点已通过，但模型列表暂时不可读。'
}

Write-Host 'LiteLLM 健康检查通过。'
if ($modelNames.Count -gt 0) {
    Write-Host ("已加载模型别名：" + ($modelNames -join ', '))
}

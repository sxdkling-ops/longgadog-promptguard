# Starts the PromptGuard PH gateway after checking that the local AI layer is ready.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-gateway.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$model = if ($env:PG_MODEL) { $env:PG_MODEL } else { 'qwen2.5:3b' }
$ollama = if ($env:PG_OLLAMA) { $env:PG_OLLAMA } else { 'http://127.0.0.1:11434' }

try {
    $tags = Invoke-RestMethod -Uri "$ollama/api/tags" -TimeoutSec 3
} catch {
    Write-Host "Ollama is not answering at $ollama. Start Ollama first; the guard blocks all sending without it." -ForegroundColor Red
    exit 1
}
$names = @($tags.models | ForEach-Object { $_.name })
if (-not ($names | Where-Object { $_ -eq $model -or ($_ -split ':')[0] -eq $model })) {
    Write-Host "Model $model is not pulled. Run:  ollama pull $model" -ForegroundColor Red
    exit 1
}

Write-Host "Local AI ready ($model). Starting the gateway on http://127.0.0.1:8787 (Ctrl+C to stop)..." -ForegroundColor Green
Set-Location $root
python -m uvicorn app:app --app-dir gateway --host 127.0.0.1 --port 8787

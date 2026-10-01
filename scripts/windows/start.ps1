# Старт Yani на Windows, порт 8080
# Запуск:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

# Подтянуть .env в процесс
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $pair = $_.Split('=', 2)
    if ($pair.Length -eq 2) {
      $name = $pair[0].Trim()
      $value = $pair[1].Trim().Trim('"')
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

$env:PORT = "8080"
$env:HOSTNAME = "0.0.0.0"

Write-Host "==> Проверка Docker (postgres/redis)..." -ForegroundColor Cyan
docker compose up -d postgres redis | Out-Null

Write-Host "==> Yani слушает http://0.0.0.0:8080" -ForegroundColor Green
Write-Host "    Чат:     http://localhost:8080/chat"
Write-Host "    Админка: http://localhost:8080/login"
Write-Host ""

npm run start:win

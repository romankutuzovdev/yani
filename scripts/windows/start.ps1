# Start Yani on Windows, port 8080 (SQLite)
# Encoding: ASCII only
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

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
if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = "file:./data/yani.db"
}

Write-Host "==> Yani http://0.0.0.0:8080" -ForegroundColor Green
Write-Host "    Chat:  http://91.149.133.54:8080/chat"
Write-Host "    Admin: http://91.149.133.54:8080/login"
Write-Host ""

if (-not (Test-Path (Join-Path $Root "node_modules\next"))) {
  Write-Host "next not installed. Run setup.ps1 first:" -ForegroundColor Red
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1"
  throw "Missing node_modules"
}

if (-not (Test-Path (Join-Path $Root ".next"))) {
  Write-Host "No build found. Building..." -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

npx --no-install next start -H 0.0.0.0 -p 8080

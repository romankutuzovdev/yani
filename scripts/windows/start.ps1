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

$standalone = Join-Path $Root ".next\standalone\server.js"
if (-not (Test-Path $standalone)) {
  Write-Host "No standalone build. Building..." -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

if (-not (Test-Path $standalone)) {
  throw "Missing .next\standalone\server.js after build"
}

# Standalone server does not include public/ or .next/static by itself.
$standaloneRoot = Join-Path $Root ".next\standalone"
$publicSrc = Join-Path $Root "public"
$publicDst = Join-Path $standaloneRoot "public"
if (Test-Path $publicSrc) {
  if (Test-Path $publicDst) { Remove-Item -Recurse -Force $publicDst }
  Copy-Item $publicSrc $publicDst -Recurse -Force
}
$staticSrc = Join-Path $Root ".next\static"
$staticDstParent = Join-Path $standaloneRoot ".next"
$staticDst = Join-Path $staticDstParent "static"
if (Test-Path $staticSrc) {
  New-Item -ItemType Directory -Force -Path $staticDstParent | Out-Null
  if (Test-Path $staticDst) { Remove-Item -Recurse -Force $staticDst }
  Copy-Item $staticSrc $staticDst -Recurse -Force
}

Write-Host "==> node .next\standalone\server.js" -ForegroundColor Cyan
node $standalone

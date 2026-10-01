# Update Yani from GitHub + rebuild
# Encoding: ASCII only
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1

param(
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

Write-Host "==> Fetch origin/$Branch..." -ForegroundColor Cyan
git fetch origin $Branch
$local = (git rev-parse HEAD).Trim()
$remote = (git rev-parse "origin/$Branch").Trim()

if ($local -eq $remote) {
  Write-Host "==> Already up to date ($local)" -ForegroundColor Green
  exit 0
}

Write-Host "==> Updating $local -> $remote" -ForegroundColor Yellow
git pull origin $Branch

Write-Host "==> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host "==> prisma db push..." -ForegroundColor Cyan
npx prisma db push

Write-Host "==> build..." -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "Rebuild done. Restart the app:" -ForegroundColor Green
Write-Host "  Ctrl+C in start window, then:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""

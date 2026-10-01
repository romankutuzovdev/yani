# Обновление Yani с GitHub + пересборка
# Запуск:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
#
# Для автообновления: Планировщик заданий Windows → каждые 5 минут → этот скрипт.
# (приложение должно крутиться отдельно через start.ps1 / NSSM / pm2)

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
  Write-Host "==> Уже актуально ($local)" -ForegroundColor Green
  exit 0
}

Write-Host "==> Есть обновления: $local -> $remote" -ForegroundColor Yellow
git pull origin $Branch

Write-Host "==> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host "==> prisma db push..." -ForegroundColor Cyan
npx prisma db push

Write-Host "==> build..." -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "Сборка обновлена. Перезапусти приложение:" -ForegroundColor Green
Write-Host "  1) Останови текущий npm/node (Ctrl+C в окне start.ps1)"
Write-Host "  2) powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""
Write-Host "Если используешь pm2:" -ForegroundColor Cyan
Write-Host "  pm2 restart yani"

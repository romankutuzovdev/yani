# Yani — развёртывание на Windows Server (порт 8080)
#
# Требования на сервере:
#   - Git
#   - Node.js 22 LTS  https://nodejs.org/
#   - Docker Desktop  https://www.docker.com/products/docker-desktop/
#
# 1) Склонируй репозиторий (подставь свой URL):
#    git clone https://github.com/YOUR_ORG/yani.git C:\apps\yani
#    cd C:\apps\yani
#
# 2) Первый запуск:
#    powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
#
# 3) Старт приложения:
#    powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
#
# 4) Обновление с GitHub:
#    powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
#
# Открой в браузере: http://IP_СЕРВЕРА:8080/chat
# Админка:          http://IP_СЕРВЕРА:8080/login
# Логин: admin@yani.local / admin123456  (смени после первого входа)

param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}

Set-Location $Root
Write-Host "==> Каталог: $Root" -ForegroundColor Cyan

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Не найдена команда '$name'. Установи и перезапусти PowerShell."
  }
}

Assert-Command git
Assert-Command node
Assert-Command npm
Assert-Command docker

$nodeVer = node -v
Write-Host "==> Node: $nodeVer"

# .env
$envFile = Join-Path $Root ".env"
$example = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
  if (Test-Path $example) {
    Copy-Item $example $envFile
    Write-Host "==> Создан .env из .env.example" -ForegroundColor Yellow
  } else {
    throw "Нет .env и .env.example"
  }
}

# Порт и URL
$envContent = Get-Content $envFile -Raw
if ($envContent -notmatch "PORT=") {
  Add-Content $envFile "`nPORT=8080"
} else {
  $envContent = $envContent -replace "(?m)^PORT=.*$", "PORT=8080"
  Set-Content -Path $envFile -Value $envContent -NoNewline
}

# Подсказка по APP URL
Write-Host ""
Write-Host "Проверь .env:" -ForegroundColor Yellow
Write-Host "  DEEPSEEK_API_KEY=..."
Write-Host "  JWT_SECRET=длинный-секрет"
Write-Host "  NEXT_PUBLIC_APP_URL=http://IP_СЕРВЕРА:8080"
Write-Host "  DATABASE_URL=postgresql://yani:yani@localhost:5433/yani?schema=public"
Write-Host ""

# Docker DB
Write-Host "==> Запуск Postgres + Redis..." -ForegroundColor Cyan
docker compose up -d postgres redis

Write-Host "==> Ожидание Postgres..." -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 30; $i++) {
  docker compose exec -T postgres pg_isready -U yani 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "Postgres не поднялся. Проверь Docker Desktop." }

Write-Host "==> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host "==> Prisma db push..." -ForegroundColor Cyan
npx prisma db push

Write-Host "==> Seed..." -ForegroundColor Cyan
npm run db:seed

Write-Host "==> Build..." -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "Готово. Дальше запусти:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""

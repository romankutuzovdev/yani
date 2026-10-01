# Yani setup for Windows Server, port 8080
# Encoding: ASCII only (Windows PowerShell 5.x)
#
# Requires: Git, Node.js 22+
# Database: Docker (postgres) OR local PostgreSQL
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

Write-Host "==> Root: $Root" -ForegroundColor Cyan

function Assert-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $name. Install it and reopen PowerShell."
  }
}

Assert-Command git
Assert-Command node
Assert-Command npm

Write-Host "==> Node: $(node -v)"

$envFile = Join-Path $Root ".env"
$example = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
  if (-not (Test-Path $example)) { throw "Missing .env and .env.example" }
  Copy-Item $example $envFile
  Write-Host "==> Created .env from .env.example" -ForegroundColor Yellow
}

function Set-EnvKey([string]$key, [string]$value) {
  $raw = Get-Content $envFile -Raw
  if ($raw -match "(?m)^$key=") {
    $raw = $raw -replace "(?m)^$key=.*$", "$key=$value"
  } else {
    if (-not $raw.EndsWith("`n")) { $raw += "`n" }
    $raw += "$key=$value`n"
  }
  Set-Content -Path $envFile -Value $raw -NoNewline -Encoding UTF8
}

Set-EnvKey "PORT" "8080"
Set-EnvKey "NEXT_PUBLIC_APP_URL" "http://91.149.133.54:8080"

$hasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
$dbOk = $false

if ($hasDocker) {
  Write-Host "==> Docker found. Starting postgres..." -ForegroundColor Cyan
  docker compose up -d postgres
  for ($i = 1; $i -le 40; $i++) {
    docker compose exec -T postgres pg_isready -U yani 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dbOk = $true; break }
    Start-Sleep -Seconds 2
  }
  if ($dbOk) {
    Set-EnvKey "DATABASE_URL" "postgresql://yani:yani@localhost:5433/yani?schema=public"
    Write-Host "==> Postgres (Docker) is ready on :5433" -ForegroundColor Green
  } else {
    Write-Host "==> Docker postgres did not become ready." -ForegroundColor Yellow
  }
}

if (-not $dbOk) {
  Write-Host "==> No Docker DB. Looking for local PostgreSQL..." -ForegroundColor Yellow
  $psql = $null
  $candidates = @(
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files\PostgreSQL\14\bin\psql.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $psql = $c; break }
  }
  if (-not $psql -and (Get-Command psql -ErrorAction SilentlyContinue)) {
    $psql = (Get-Command psql).Source
  }

  if (-not $psql) {
    Write-Host ""
    Write-Host "PostgreSQL not found. Install ONE of:" -ForegroundColor Red
    Write-Host "  A) Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host "  B) PostgreSQL Windows: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads"
    Write-Host "     During install set password for user postgres, keep port 5432."
    Write-Host "     Then run this setup.ps1 again."
    Write-Host ""
    Write-Host "Or with winget (admin PowerShell):"
    Write-Host "  winget install --id PostgreSQL.PostgreSQL.16 -e --accept-package-agreements"
    throw "Database required."
  }

  Write-Host "==> Found psql: $psql" -ForegroundColor Cyan
  Write-Host "Enter password for PostgreSQL superuser 'postgres' when asked." -ForegroundColor Yellow
  $env:PGPASSWORD = $env:PGPASSWORD
  & $psql -U postgres -h localhost -p 5432 -c "SELECT 1" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Cannot connect as postgres. Set env and retry:" -ForegroundColor Red
    Write-Host '  $env:PGPASSWORD = "your_postgres_password"'
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1"
    throw "Cannot connect to local PostgreSQL."
  }

  & $psql -U postgres -h localhost -p 5432 -tc "SELECT 1 FROM pg_roles WHERE rolname='yani'" | Out-Null
  $roleExists = (& $psql -U postgres -h localhost -p 5432 -Atc "SELECT 1 FROM pg_roles WHERE rolname='yani'").Trim()
  if ($roleExists -ne "1") {
    & $psql -U postgres -h localhost -p 5432 -c "CREATE USER yani WITH PASSWORD 'yani' CREATEDB;"
  }
  $dbExists = (& $psql -U postgres -h localhost -p 5432 -Atc "SELECT 1 FROM pg_database WHERE datname='yani'").Trim()
  if ($dbExists -ne "1") {
    & $psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE yani OWNER yani;"
  }

  Set-EnvKey "DATABASE_URL" "postgresql://yani:yani@localhost:5432/yani?schema=public"
  Write-Host "==> Local Postgres ready on :5432" -ForegroundColor Green
  $dbOk = $true
}

Write-Host ""
Write-Host "Check .env has DEEPSEEK_API_KEY and JWT_SECRET" -ForegroundColor Yellow
Write-Host ""

Write-Host "==> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "==> prisma db push..." -ForegroundColor Cyan
npx prisma db push
if ($LASTEXITCODE -ne 0) { throw "prisma db push failed" }

Write-Host "==> seed..." -ForegroundColor Cyan
npm run db:seed
if ($LASTEXITCODE -ne 0) { throw "db:seed failed" }

Write-Host "==> build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host ""
Write-Host "OK. Start the app:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""

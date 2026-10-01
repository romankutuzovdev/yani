# Yani setup for Windows Server — SQLite, port 8080
# No Docker / PostgreSQL required.
# Encoding: ASCII only (Windows PowerShell 5.x)
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
  if ($null -eq $raw) { $raw = "" }
  if ($raw -match "(?m)^$key=") {
    $raw = $raw -replace "(?m)^$key=.*$", "$key=$value"
  } else {
    if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { $raw += "`n" }
    $raw += "$key=$value`n"
  }
  Set-Content -Path $envFile -Value $raw -NoNewline -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "uploads") | Out-Null

Set-EnvKey "PORT" "8080"
Set-EnvKey "NEXT_PUBLIC_APP_URL" "http://91.149.133.54:8080"
Set-EnvKey "DATABASE_URL" '"file:./data/yani.db"'

Write-Host ""
Write-Host "Edit .env and set DEEPSEEK_API_KEY + JWT_SECRET if empty." -ForegroundColor Yellow
Write-Host ""

# Load .env into process for prisma
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $pair = $_.Split('=', 2)
  if ($pair.Length -eq 2) {
    $name = $pair[0].Trim()
    $value = $pair[1].Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}
$env:DATABASE_URL = "file:./data/yani.db"

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

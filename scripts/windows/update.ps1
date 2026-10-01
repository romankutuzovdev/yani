# Update Yani from GitHub + rebuild
# Encoding: ASCII only (no Unicode dashes/quotes - breaks Windows PowerShell)
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1

param(
  [string]$Branch = "main",
  [switch]$SkipGit
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

function Stop-YaniOnPort {
  param([int]$Port = 8080)
  Write-Host "==> Stopping processes on port $Port ..." -ForegroundColor Cyan
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  } catch {
    $conns = @()
  }
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    if ($procId -and $procId -ne 0) {
      try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
          Write-Host ("    stop PID {0} ({1})" -f $procId, $p.ProcessName) -ForegroundColor Yellow
          Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
      } catch {}
    }
  }
  Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $cmd = (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $_.Id)).CommandLine
      if ($cmd -and ($cmd -like "*yani*" -or $cmd -like "*next*")) {
        Write-Host ("    stop node PID {0}" -f $_.Id) -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Start-Sleep -Seconds 2
}

function Assert-Ok {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw ("{0} failed (exit {1})" -f $Step, $LASTEXITCODE)
  }
}

Stop-YaniOnPort 8080

if (-not $SkipGit) {
  Write-Host ("==> Fetch origin/{0}..." -f $Branch) -ForegroundColor Cyan
  git fetch origin $Branch
  Assert-Ok "git fetch"
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse ("origin/{0}" -f $Branch)).Trim()

  if ($local -eq $remote) {
    Write-Host ("==> Git already up to date ({0}) - rebuilding anyway" -f $local) -ForegroundColor Green
  } else {
    Write-Host ("==> Updating {0} -> {1}" -f $local, $remote) -ForegroundColor Yellow
    git pull origin $Branch
    Assert-Ok "git pull"
  }
}

Write-Host "==> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund
Assert-Ok "npm install"

Write-Host "==> prisma generate..." -ForegroundColor Cyan
npx prisma generate
Assert-Ok "prisma generate"

Write-Host "==> prisma db push..." -ForegroundColor Cyan
npx prisma db push
Assert-Ok "prisma db push"

Write-Host "==> fix character asset URLs..." -ForegroundColor Cyan
npx tsx scripts/fix-character-urls.ts
# non-fatal if script missing on old builds
if ($LASTEXITCODE -ne 0) {
  Write-Host "    (skip fix-character-urls)" -ForegroundColor Yellow
}

Write-Host "==> db seed (refresh demo assets)..." -ForegroundColor Cyan
npm run db:seed
if ($LASTEXITCODE -ne 0) {
  Write-Host "    (seed failed - continue)" -ForegroundColor Yellow
}

Write-Host "==> build..." -ForegroundColor Cyan
npm run build
Assert-Ok "npm run build"

Write-Host ""
Write-Host "Rebuild OK. Start the app:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""

# Update Yani from GitHub + rebuild
# Encoding: ASCII only (no Unicode dashes/quotes - breaks Windows PowerShell)
#
# Keeps the site up as long as possible:
#   1) git + npm install while old process still runs
#   2) stop only before prisma generate (Windows EPERM on DLL)
#   3) backup .next; restore it if build fails
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1 -SkipGit

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
  # Only the process that LISTENS on 8080.
  # Do not kill every node whose path contains "yani" — that also kills
  # the GitHub Actions job itself (working dir C:\apps\yani) and leaves the site down.
  $ids = @{}
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  } catch {
    $conns = @()
  }
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    if ($procId -and $procId -ne 0 -and $procId -ne $PID) {
      $ids[$procId] = $true
    }
  }
  foreach ($procId in $ids.Keys) {
    try {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host ("    stop PID {0} ({1})" -f $procId, $p.ProcessName) -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
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

$nextDir = Join-Path $Root ".next"
$nextBackup = Join-Path $Root ".next-prev"
$buildOk = $false

# --- Phase 1: sync code while site can still serve old build ---
if (-not $SkipGit) {
  Write-Host ("==> Fetch origin/{0}..." -f $Branch) -ForegroundColor Cyan
  git fetch origin $Branch
  Assert-Ok "git fetch"
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse ("origin/{0}" -f $Branch)).Trim()

  if ($local -eq $remote) {
    Write-Host ("==> Git already up to date ({0})" -f $local) -ForegroundColor Green
  } else {
    Write-Host ("==> Updating {0} -> {1}" -f $local, $remote) -ForegroundColor Yellow
    git pull origin $Branch
    Assert-Ok "git pull"
  }
}

Write-Host "==> npm install (site still up if already running)..." -ForegroundColor Cyan
npm install --no-audit --no-fund
Assert-Ok "npm install"

# --- Phase 2: stop only when we need to touch Prisma / rebuild ---
Write-Host "==> Backup .next (fallback if build fails)..." -ForegroundColor Cyan
if (Test-Path $nextBackup) {
  Remove-Item -Recurse -Force $nextBackup -ErrorAction SilentlyContinue
}
if (Test-Path $nextDir) {
  try {
    Copy-Item -Path $nextDir -Destination $nextBackup -Recurse -Force
    Write-Host "    .next -> .next-prev" -ForegroundColor Green
  } catch {
    Write-Host ("    backup skipped: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }
} else {
  Write-Host "    no .next yet" -ForegroundColor Yellow
}

Stop-YaniOnPort 8080

try {
  Write-Host "==> prisma generate..." -ForegroundColor Cyan
  npx prisma generate
  Assert-Ok "prisma generate"

  Write-Host "==> prisma db push..." -ForegroundColor Cyan
  npx prisma db push
  Assert-Ok "prisma db push"

  Write-Host "==> check hero image files..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\check-hero.ps1
  if ($LASTEXITCODE -ne 0) {
    throw "Hero PNG files missing after git pull"
  }

  Write-Host "==> fix character asset URLs..." -ForegroundColor Cyan
  npx tsx scripts/fix-character-urls.ts
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
  $buildOk = $true
}
catch {
  Write-Host ("==> BUILD FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host "==> Restoring previous .next ..." -ForegroundColor Yellow
  if (Test-Path $nextBackup) {
    if (Test-Path $nextDir) {
      Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
    }
    Copy-Item -Path $nextBackup -Destination $nextDir -Recurse -Force
    Write-Host "    restored .next from .next-prev" -ForegroundColor Green
  } else {
    Write-Host "    no .next-prev backup available" -ForegroundColor Red
  }
  # Non-zero so caller knows update failed, but deploy.ps1 will still start
  exit 1
}

Write-Host ""
Write-Host "Rebuild OK." -ForegroundColor Green
Write-Host ""
exit 0

# Update Yani from GitHub + rebuild
# Encoding: ASCII only
#
# IMPORTANT: stop the running app first (Ctrl+C), or this script will
# stop Node processes on port 8080 so Prisma can replace its DLL.
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
  Write-Host "==> Stopping processes on port $Port (unlock Prisma DLL)..." -ForegroundColor Cyan
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
          Write-Host "    stop PID $procId ($($p.ProcessName))" -ForegroundColor Yellow
          Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
      } catch {}
    }
  }
  # Also stop orphan next/node that may still hold query_engine-windows.dll.node
  Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
      if ($cmd -and ($cmd -like "*yani*" -or $cmd -like "*next*")) {
        Write-Host "    stop node PID $($_.Id)" -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Start-Sleep -Seconds 2
}

function Assert-Ok($step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed (exit $LASTEXITCODE)"
  }
}

Stop-YaniOnPort 8080

if (-not $SkipGit) {
  Write-Host "==> Fetch origin/$Branch..." -ForegroundColor Cyan
  git fetch origin $Branch
  Assert-Ok "git fetch"
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse "origin/$Branch").Trim()

  if ($local -eq $remote) {
    Write-Host "==> Git already up to date ($local) — rebuilding anyway" -ForegroundColor Green
  } else {
    Write-Host "==> Updating $local -> $remote" -ForegroundColor Yellow
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

Write-Host "==> build..." -ForegroundColor Cyan
npm run build
Assert-Ok "npm run build"

Write-Host ""
Write-Host "Rebuild OK. Start the app:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1"
Write-Host ""

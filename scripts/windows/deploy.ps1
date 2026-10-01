# One-shot deploy: update + ALWAYS restart Yani in background
# Encoding: ASCII only
#
# Even if build fails, tries to start the previous (or restored) build
# so the site does not stay down.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\deploy.ps1 -SkipGit

param(
  [switch]$SkipGit
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

$updateScript = Join-Path $PSScriptRoot "update.ps1"
$startScript = Join-Path $PSScriptRoot "start.ps1"
$stopScript = Join-Path $PSScriptRoot "stop.ps1"
$pidFile = Join-Path $Root "data\yani.pid"
$logDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$updateFailed = $false

Write-Host "==> Deploy: update + restart (always start at end)" -ForegroundColor Cyan

try {
  if ($SkipGit) {
    & powershell -ExecutionPolicy Bypass -File $updateScript -SkipGit
  } else {
    & powershell -ExecutionPolicy Bypass -File $updateScript
  }
  if ($LASTEXITCODE -ne 0) {
    $updateFailed = $true
    Write-Host "update.ps1 failed - will still try to start previous build" -ForegroundColor Yellow
  }
}
catch {
  $updateFailed = $true
  Write-Host ("update.ps1 threw: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

function Start-YaniBackground {
  Write-Host "==> Ensuring port 8080 is free before start..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File $stopScript
  Start-Sleep -Seconds 1

  if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid) {
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path (Join-Path $Root ".next"))) {
    Write-Host "ERROR: no .next build to start" -ForegroundColor Red
    return $false
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outLog = Join-Path $logDir ("yani-" + $stamp + ".out.log")
  $errLog = Join-Path $logDir ("yani-" + $stamp + ".err.log")

  Write-Host "==> Starting Yani in background..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $startScript
    ) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

  Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii
  Write-Host ("    started PID {0}" -f $proc.Id) -ForegroundColor Green
  Write-Host ("    logs: {0}" -f $logDir)

  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
      $conns = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
      if ($conns) { $ok = $true; break }
    } catch {}
    if ($proc.HasExited) {
      Write-Host ("Yani process exited early. Check logs: {0}" -f $errLog) -ForegroundColor Red
      return $false
    }
  }

  if (-not $ok) {
    Write-Host "WARNING: port 8080 not listening yet. Check logs." -ForegroundColor Yellow
    return $false
  }

  Write-Host "Site up: http://91.149.133.54:8080/chat" -ForegroundColor Green
  return $true
}

$started = Start-YaniBackground

if (-not $started) {
  Write-Host "FAILED to start Yani after deploy" -ForegroundColor Red
  exit 1
}

if ($updateFailed) {
  Write-Host "Site is up on PREVIOUS build, but update/build failed. Fix and redeploy." -ForegroundColor Yellow
  exit 1
}

Write-Host "Deploy OK (new build)." -ForegroundColor Green
exit 0

# One-shot deploy: pull/build (via update.ps1) then restart Yani in background
# Encoding: ASCII only
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\deploy.ps1 -SkipGit

param(
  [switch]$SkipGit
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

$updateScript = Join-Path $PSScriptRoot "update.ps1"
$startScript = Join-Path $PSScriptRoot "start.ps1"
$pidFile = Join-Path $Root "data\yani.pid"
$logDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "==> Deploy: update + restart" -ForegroundColor Cyan

if ($SkipGit) {
  & powershell -ExecutionPolicy Bypass -File $updateScript -SkipGit
} else {
  & powershell -ExecutionPolicy Bypass -File $updateScript
}
if ($LASTEXITCODE -ne 0) {
  throw "update.ps1 failed"
}

# Ensure port is free (update already stops, but start may still be running from prior deploy)
Write-Host "==> Stopping previous Yani process..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop.ps1")
Start-Sleep -Seconds 1

if (Test-Path $pidFile) {
  $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid) {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
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

# Wait until port 8080 answers
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    $conns = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($conns) { $ok = $true; break }
  } catch {}
  if ($proc.HasExited) {
    throw ("Yani process exited early. Check logs: {0}" -f $errLog)
  }
}

if (-not $ok) {
  Write-Host "WARNING: port 8080 not listening yet. Check logs." -ForegroundColor Yellow
  exit 1
}

Write-Host "Deploy OK: http://91.149.133.54:8080/chat" -ForegroundColor Green

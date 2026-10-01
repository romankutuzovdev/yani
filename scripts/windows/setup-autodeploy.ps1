# Install GitHub Actions self-hosted runner for auto-deploy on push to main
# Encoding: ASCII only
#
# 1) On GitHub: Repo -> Settings -> Actions -> Runners -> New self-hosted runner
#    Copy the registration token (expires ~1 hour).
# 2) On the Windows server:
#    powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup-autodeploy.ps1 -Token YOUR_TOKEN
#
# Optional:
#   -Url https://github.com/romankutuzovdev/yani
#   -RunnerDir C:\apps\actions-runner

param(
  [Parameter(Mandatory = $true)]
  [string]$Token,
  [string]$Url = "https://github.com/romankutuzovdev/yani",
  [string]$RunnerDir = "C:\actions-runner",
  [string]$RunnerName = "yani-windows",
  [string]$Labels = "self-hosted,Windows,yani"
)

$ErrorActionPreference = "Stop"

Write-Host "==> GitHub Actions self-hosted runner setup" -ForegroundColor Cyan
Write-Host ("    Url:    {0}" -f $Url)
Write-Host ("    Dir:    {0}" -f $RunnerDir)
Write-Host ("    Labels: {0}" -f $Labels)

if (-not (Test-Path "C:\apps\yani\package.json")) {
  Write-Host "WARNING: C:\apps\yani not found. Clone the app there before first deploy." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null
Set-Location $RunnerDir

# Windows x64 runner
$version = "2.337.0"
$zip = "actions-runner-win-x64-$version.zip"
$download = "https://github.com/actions/runner/releases/download/v$version/$zip"

if (-not (Test-Path ".\config.cmd")) {
  Write-Host "==> Downloading runner $version ..." -ForegroundColor Cyan
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Invoke-WebRequest -Uri $download -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath . -Force
  Remove-Item $zip -Force
} else {
  Write-Host "==> Runner binaries already present" -ForegroundColor Green
}

if (Test-Path ".\.runner") {
  Write-Host "==> Runner already configured (.runner exists). Skipping config." -ForegroundColor Yellow
} else {
  Write-Host "==> Configuring runner..." -ForegroundColor Cyan
  & .\config.cmd --unattended `
    --url $Url `
    --token $Token `
    --name $RunnerName `
    --labels $Labels `
    --work "_work" `
    --replace
  if ($LASTEXITCODE -ne 0) { throw "config.cmd failed" }
}

Write-Host "==> Installing and starting runner as Windows service..." -ForegroundColor Cyan
& .\svc.cmd install
if ($LASTEXITCODE -ne 0) {
  Write-Host "svc install returned $LASTEXITCODE - trying start anyway" -ForegroundColor Yellow
}
& .\svc.cmd start
if ($LASTEXITCODE -ne 0) { throw "svc start failed" }

Write-Host ""
Write-Host "Autodeploy ready." -ForegroundColor Green
Write-Host "  - Push to main on GitHub -> workflow Deploy to Windows server"
Write-Host "  - Check: GitHub -> Actions, and Runners list (Idle/Online)"
Write-Host "  - App path must be: C:\apps\yani"
Write-Host ""
Write-Host "Manual deploy still works:"
Write-Host "  powershell -ExecutionPolicy Bypass -File C:\apps\yani\scripts\windows\deploy.ps1"

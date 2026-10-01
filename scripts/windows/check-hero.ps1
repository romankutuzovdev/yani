# Ensure hero PNG files exist after git pull (Windows)
# Called from update.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

$dir = Join-Path $Root "public\characters\yani"
Write-Host "==> Checking hero images in $dir" -ForegroundColor Cyan

if (-not (Test-Path $dir)) {
  Write-Host "MISSING folder: public/characters/yani" -ForegroundColor Red
  Write-Host "Run: git pull   (files must come from repo)" -ForegroundColor Yellow
  exit 1
}

$need = @("idle.png","thinking.png","working.png","success.png","error.png","speaking.png","waiting.png","sad.png","angry.png")
$missing = @()
foreach ($f in $need) {
  $p = Join-Path $dir $f
  if (-not (Test-Path $p)) { $missing += $f }
}

if ($missing.Count -gt 0) {
  Write-Host ("MISSING files: {0}" -f ($missing -join ", ")) -ForegroundColor Red
  exit 1
}

Write-Host ("OK: {0} hero images present" -f $need.Count) -ForegroundColor Green

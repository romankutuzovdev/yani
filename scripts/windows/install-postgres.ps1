# Download and silently install PostgreSQL 16 (no winget)
# Run in Administrator PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-postgres.ps1

$ErrorActionPreference = "Stop"
$Password = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "YaniPg2026!" }
$Installer = "$env:TEMP\postgresql-16-windows-x64.exe"
$Url = "https://get.enterprisedb.com/postgresql/postgresql-16.15-3-windows-x64.exe"

Write-Host "==> Downloading PostgreSQL 16..." -ForegroundColor Cyan
Write-Host "    $Url"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $Url -OutFile $Installer -UseBasicParsing

Write-Host "==> Silent install (password for user postgres = $Password)" -ForegroundColor Cyan
$args = @(
  "--mode", "unattended",
  "--unattendedmodeui", "none",
  "--superpassword", $Password,
  "--serverport", "5432",
  "--servicename", "postgresql-x64-16",
  "--prefix", "C:\Program Files\PostgreSQL\16",
  "--datadir", "C:\Program Files\PostgreSQL\16\data",
  "--install_runtimes", "0"
)
$p = Start-Process -FilePath $Installer -ArgumentList $args -Wait -PassThru
if ($p.ExitCode -ne 0) {
  throw "Installer failed with exit code $($p.ExitCode)"
}

$bin = "C:\Program Files\PostgreSQL\16\bin"
if (-not (Test-Path "$bin\psql.exe")) {
  throw "psql.exe not found after install"
}

$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($machinePath -notlike "*$bin*") {
  [Environment]::SetEnvironmentVariable("Path", "$machinePath;$bin", "Machine")
}
$env:Path = "$env:Path;$bin"
$env:PGPASSWORD = $Password

Write-Host "==> Waiting for service..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

Write-Host "==> OK. Password for postgres: $Password" -ForegroundColor Green
Write-Host "    Reopen PowerShell, then:"
Write-Host '    $env:PGPASSWORD = "' + $Password + '"'
Write-Host "    cd C:\apps\yani"
Write-Host "    powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1"

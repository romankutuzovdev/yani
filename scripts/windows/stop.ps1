# Stop Yani on port 8080
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\stop.ps1

$ErrorActionPreference = "SilentlyContinue"
$Port = 8080
Write-Host ("==> Stopping listeners on port {0}..." -f $Port) -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $procId = $_.OwningProcess
  if ($procId) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    Write-Host ("    stop PID {0} ({1})" -f $procId, $(if ($p) { $p.ProcessName } else { "?" })) -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 1
Write-Host "Done." -ForegroundColor Green

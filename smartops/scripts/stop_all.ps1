# scripts/stop_all.ps1 — stop all SmartOps services launched by run_all.ps1
#
# Usage:
#   cd smartops
#   ./scripts/stop_all.ps1

$ErrorActionPreference = "SilentlyContinue"

# Kill dotnet processes on SmartOps ports
$ports = @(7000,7001,7002,7003,7004,7005,7006,8001,8002,8003,8004,8005)

$killed = 0
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Stopping $($proc.ProcessName) (PID $($proc.Id)) on :$port" -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            $killed++
        }
    }
}

# Also close any PowerShell windows titled "SmartOps ·"
Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "SmartOps *" } |
    ForEach-Object {
        Write-Host "Closing window: $($_.MainWindowTitle)" -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        $killed++
    }

if ($killed -eq 0) {
    Write-Host "No running SmartOps services found." -ForegroundColor Gray
} else {
    Write-Host "`nStopped $killed process(es)." -ForegroundColor Green
}

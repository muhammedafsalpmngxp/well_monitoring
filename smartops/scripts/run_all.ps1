# scripts/run_all.ps1 — launch every SmartOps service locally on Windows.
#
# Prereq: .NET 8 SDK + Python 3.11 + (optionally) SQL Server LocalDB or
# SQL Server Developer Edition listening on localhost:1433.
#
# Usage:
#   cd smartops
#   ./scripts/run_all.ps1

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
Write-Host "SmartOps root: $root" -ForegroundColor Cyan

# ─── .NET services ────────────────────────────────────────────────────────────
$dotnetServices = @(
    @{ name="Gateway";       path="gateway"; port=7000 },
    @{ name="Auth";          path="services\dotnet\SmartOps.Auth";          port=7001 },
    @{ name="Wells";         path="services\dotnet\SmartOps.Wells\src\SmartOps.Wells.API"; port=7002 },
    @{ name="Finance";       path="services\dotnet\SmartOps.Finance";       port=7003 },
    @{ name="Workflow";      path="services\dotnet\SmartOps.Workflow";      port=7004 },
    @{ name="Reports";       path="services\dotnet\SmartOps.Reports";       port=7005 },
    @{ name="Integrations";  path="services\dotnet\SmartOps.Integrations";  port=7006 }
)

foreach ($s in $dotnetServices) {
    $title = "SmartOps · $($s.name) · :$($s.port)"
    $cmd = "Set-Location '$root\$($s.path)'; dotnet run --urls=http://localhost:$($s.port)"
    Write-Host "Starting $title" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit","-Command","`$Host.UI.RawUI.WindowTitle='$title'; $cmd"
    Start-Sleep -Milliseconds 600
}

# ─── Python services ──────────────────────────────────────────────────────────
$pythonServices = @(
    @{ name="Jenny";          path="services\python\jenny_ai";        port=8001 },
    @{ name="Predictive";     path="services\python\predictive";      port=8002 },
    @{ name="Anomaly";        path="services\python\anomaly";         port=8003 },
    @{ name="CrewOptimizer";  path="services\python\crew_optimizer";  port=8004 },
    @{ name="Vision";         path="services\python\vision";          port=8005 }
)

foreach ($s in $pythonServices) {
    $title = "SmartOps · $($s.name) · :$($s.port)"
    $shared = "$root\shared\python"
    $cmd = "Set-Location '$root\$($s.path)'; `$env:PYTHONPATH='$shared'; uvicorn app.main:app --host 0.0.0.0 --port $($s.port) --reload"
    Write-Host "Starting $title" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit","-Command","`$Host.UI.RawUI.WindowTitle='$title'; $cmd"
    Start-Sleep -Milliseconds 600
}

Write-Host ""
Write-Host "Gateway:        http://localhost:7000" -ForegroundColor Green
Write-Host "OpenAPI:        http://localhost:7000/swagger" -ForegroundColor Green
Write-Host "Run health check: python scripts/health_check.py" -ForegroundColor Green

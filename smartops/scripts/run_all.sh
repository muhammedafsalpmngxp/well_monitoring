#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT/shared/python"
mkdir -p .logs

# name|kind|path|port
services=(
  # "Gateway|dotnet|gateway|7000"
  # "Auth|dotnet|services/dotnet/SmartOps.Auth|7001"
  "Wells|dotnet|services/dotnet/SmartOps.Wells/src/SmartOps.Wells.API|7002"
  # "Finance|dotnet|services/dotnet/SmartOps.Finance|7003"
  # "Workflow|dotnet|services/dotnet/SmartOps.Workflow|7004"
  # "Reports|dotnet|services/dotnet/SmartOps.Reports|7005"
  # "Integrations|dotnet|services/dotnet/SmartOps.Integrations|7006"
  # "Jenny|python|services/python/jenny_ai|8001"
  # "Predictive|python|services/python/predictive|8002"
  # "Anomaly|python|services/python/anomaly|8003"
  # "CrewOptimizer|python|services/python/crew_optimizer|8004"
  # "Vision|python|services/python/vision|8005"
)

pids=()
for s in "${services[@]}"; do
  IFS='|' read -r name kind path port <<< "$s"
  log=".logs/${name}.log"
  echo "Starting $name on :$port"
  if [[ "$kind" == "dotnet" ]]; then
    (cd "$path" && dotnet run --urls "http://localhost:$port") > "$log" 2>&1 &
  else
    (cd "$path" && uvicorn app.main:app --host 0.0.0.0 --port "$port" --reload) > "$log" 2>&1 &
  fi
  pids+=("$!")
done

trap 'echo "Stopping…"; kill "${pids[@]}" 2>/dev/null || true' INT TERM
echo "All services launching. Gateway: http://localhost:7000"
wait
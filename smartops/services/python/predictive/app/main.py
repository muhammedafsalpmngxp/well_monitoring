"""
Predictive Rate Intelligence — Prophet-based forecasting.

Endpoints:
  POST /forecast/completion   — given recent progress points, forecast finish date
  POST /forecast/rate         — given recent daily rate, forecast next N days
"""
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "shared" / "python"))

from pydantic import BaseModel, Field
from fastapi import HTTPException

from smartops_shared.app import create_app

try:
    import pandas as pd
    from prophet import Prophet
except Exception:
    pd = None
    Prophet = None  # type: ignore

app = create_app(title="SmartOps · Predictive Rate Intelligence",
                 service_name="predictive")


class TimePoint(BaseModel):
    ds: date
    y: float


class CompletionRequest(BaseModel):
    well_id: str
    points: List[TimePoint] = Field(..., min_length=3)
    target: float = 100.0           # finish at 100% complete
    horizon_days: int = 90


class CompletionResponse(BaseModel):
    well_id: str
    forecast_finish: Optional[date]
    days_to_finish: Optional[int]
    confidence: float
    rationale: str


class RateRequest(BaseModel):
    well_id: str
    points: List[TimePoint] = Field(..., min_length=5)
    horizon_days: int = 14


class RatePoint(BaseModel):
    ds: date
    yhat: float
    yhat_lower: float
    yhat_upper: float


class RateResponse(BaseModel):
    well_id: str
    forecast: List[RatePoint]


def _require_prophet():
    if Prophet is None:
        raise HTTPException(503, "Prophet/pandas not installed. pip install -r requirements.txt")


@app.post("/forecast/completion", response_model=CompletionResponse)
def forecast_completion(body: CompletionRequest):
    _require_prophet()
    df = pd.DataFrame([{"ds": p.ds, "y": p.y} for p in body.points])
    m = Prophet(daily_seasonality=False, weekly_seasonality=False)
    m.fit(df)
    future = m.make_future_dataframe(periods=body.horizon_days)
    fc = m.predict(future)
    hit = fc[fc["yhat"] >= body.target]
    if hit.empty:
        return CompletionResponse(
            well_id=body.well_id, forecast_finish=None, days_to_finish=None,
            confidence=0.0,
            rationale=f"Forecast does not reach {body.target}% within {body.horizon_days} days")
    finish = hit.iloc[0]["ds"].date()
    days = (finish - df["ds"].max()).days
    last_yhat = fc.iloc[-1]
    spread = float(last_yhat["yhat_upper"]) - float(last_yhat["yhat_lower"])
    confidence = max(0.0, min(1.0, 1.0 - spread / max(1.0, body.target)))
    return CompletionResponse(
        well_id=body.well_id, forecast_finish=finish, days_to_finish=days,
        confidence=round(confidence, 2),
        rationale=f"Linear-trend projection of {len(df)} progress points.")


@app.post("/forecast/rate", response_model=RateResponse)
def forecast_rate(body: RateRequest):
    _require_prophet()
    df = pd.DataFrame([{"ds": p.ds, "y": p.y} for p in body.points])
    m = Prophet(daily_seasonality=False, weekly_seasonality=True)
    m.fit(df)
    future = m.make_future_dataframe(periods=body.horizon_days)
    fc = m.predict(future).tail(body.horizon_days)
    out = [
        RatePoint(ds=row["ds"].date(),
                  yhat=float(row["yhat"]),
                  yhat_lower=float(row["yhat_lower"]),
                  yhat_upper=float(row["yhat_upper"]))
        for _, row in fc.iterrows()
    ]
    return RateResponse(well_id=body.well_id, forecast=out)


# ── Forecasts from the database (read-only; see app/data.py) ────────────────
# Open http://localhost:8002/docs to try these in the browser.

import json
import threading
import time

from fastapi.responses import JSONResponse

_CACHE_SECONDS = 3600
_cache: dict = {}
_cache_lock = threading.Lock()


def _clean_data():
    """Load and clean the data once, then reuse it for an hour."""
    from app.data import load_clean
    with _cache_lock:
        if "data" not in _cache or time.time() - _cache["at"] > _CACHE_SECONDS:
            _cache.clear()
            _cache["data"], _cache["at"] = load_clean(), time.time()
        return _cache["data"]


def _cached(key, compute):
    data = _clean_data()
    if key not in _cache:
        _cache[key] = compute(data)
    return _cache[key]


def _completion_model(data):
    from app import ml
    return ml.train(data)


def _pdo_backtest(data):
    from app.forecast import backtest_pdo
    return backtest_pdo(data)


def _wells_forecast(data):
    """Stage-model forecast; PDO's drilling sequence for the stages where it tested
    better; the variables model only where it validated better (currently off)."""
    from app import ml
    from app.forecast import forecast_well_finish
    use_pdo = _cached("pdo_backtest", _pdo_backtest).get("use_for_stages", [])
    return ml.apply(_cached("completion_model", _completion_model), data,
                    forecast_well_finish(data, use_pdo=use_pdo))


def _records(df) -> JSONResponse:
    """DataFrame -> JSON rows (dates as YYYY-MM-DD, NaN as null)."""
    return JSONResponse(json.loads(df.to_json(orient="records", date_format="iso", date_unit="s")
                                   .replace("T00:00:00", "")))


@app.get("/wells/forecast", tags=["forecast"])
def wells_forecast(stage: Optional[str] = None, risk: Optional[str] = None, flag: Optional[str] = None,
                   limit: int = 1000):
    """Completion forecast (best / most likely / worst case) for wells not yet
    completed, vs the hook-up deadline (actual rig off + 2 days, or planned
    rig off + 2 days while the rig is still on).
    stage: hookup | drilling | waiting_for_rig.
    risk: late | at_risk | on_track | on_hold | no_completion_no_reason | plan_dates_conflict.
    flag: ok | stalled | slower_than_90pct | on_hold."""
    df = _cached("wells", _wells_forecast)
    if stage:
        df = df[df["stage"] == stage]
    if risk:
        df = df[df["risk"] == risk]
    if flag:
        df = df[df["flag"] == ("" if flag == "ok" else flag)]
    return _records(df.head(limit))


@app.get("/wells/forecast/summary", tags=["forecast"])
def wells_forecast_summary():
    """Counts of running wells by risk and flag, plus the data as-of date."""
    from app.forecast import forecast_as_of
    data = _clean_data()
    df = _cached("wells", _wells_forecast)
    model = _cached("completion_model", _completion_model)
    return {
        "as_of": str(forecast_as_of(data).date()),
        "daily_reports_until": str(data.as_of),
        "open_wells_by_stage": df["stage"].value_counts().to_dict(),
        "open_wells_by_risk": df["risk"].fillna("no_deadline").value_counts().to_dict(),
        "late_or_at_risk_by_owner": df[df["risk"].isin(["late", "at_risk"])]["delay_owner"].value_counts().to_dict(),
        "variables_model_in_use": model.use,
    }


@app.get("/wells/{well_id}/forecast", tags=["forecast"])
def well_forecast(well_id: str):
    df = _cached("wells", _wells_forecast)
    row = df[df["well_id"] == well_id]
    if row.empty:
        status = _clean_data().wells.set_index("well_id")["status"].get(well_id)
        raise HTTPException(404, f"No forecast for well {well_id} (status: {status or 'no reported work'})")
    return _records(row)


@app.get("/activities/forecast", tags=["forecast"])
def activities_forecast(top: int = 10, horizon_days: int = 14):
    """Prophet forecast of daily output for the busiest activities (per unit)."""
    from app.forecast import forecast_activity_output
    return _records(_cached(("activities", top, horizon_days),
                            lambda d: forecast_activity_output(d, top=top, horizon=horizon_days)))


@app.get("/backtest", tags=["accuracy"])
def backtest():
    """How accurate the forecasts were on past data."""
    from app.forecast import backtest_activity_output, backtest_well_finish, forecast_as_of

    def run(data):
        as_of = forecast_as_of(data)
        wells = [backtest_well_finish(data, as_of - pd.Timedelta(days=d)) for d in (30, 60, 90)]
        model = _cached("completion_model", _completion_model)
        return {"well_finish": wells,
                "pdo_schedule": _cached("pdo_backtest", _pdo_backtest),
                "variables_model": {"in_use": model.use, "training_cases": model.examples,
                                    "training_wells": model.wells, **model.validation},
                "activity_output": json.loads(backtest_activity_output(data).to_json(orient="records"))}
    return _cached("backtest", run)


@app.get("/insights/plan", tags=["insights"])
def insights_plan():
    """Planned vs actual: hook-up vs the 2-day rule, rig slip and drilling time per
    rig (PDO schedule), and actual daily rates per activity next to the norms."""
    from app.insights import plan_realism
    return JSONResponse(json.loads(pd.Series([_cached("insights_plan", plan_realism)]).to_json(orient="values"))[0])


@app.get("/insights/crews", tags=["insights"])
def insights_crews():
    """Crew productivity index (1.0 = typical daily output on the same activity) and output by crew size."""
    from app.insights import crew_productivity
    return JSONResponse(json.loads(pd.Series([_cached("insights_crews", crew_productivity)]).to_json(orient="values"))[0])


@app.get("/insights/idle", tags=["insights"])
def insights_idle():
    """Days with hours booked but no output, per well / crew / activity / month, plus stalled and on-hold wells."""
    from app.insights import idle_days

    def run(data):
        wells = _cached("wells", _wells_forecast)
        stalled = wells[wells["flag"].isin(["stalled"]) | wells["risk"].isin(["on_hold", "no_completion_no_reason"])]
        return idle_days(data, stalled)
    return JSONResponse(json.loads(pd.Series([_cached("insights_idle", run)]).to_json(orient="values", date_format="iso"))[0])


@app.get("/data-quality", tags=["data"])
def data_quality(limit: int = 200):
    """Cleaning summary and the flagged task-days with the rule that caught them."""
    data = _clean_data()
    return {"stats": data.stats, "flagged": json.loads(_records(data.quality_report().head(limit)).body)}


@app.post("/refresh", tags=["data"])
def refresh():
    """Reload from the database on the next request."""
    with _cache_lock:
        _cache.clear()
    return {"status": "cache cleared"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8002, reload=False)

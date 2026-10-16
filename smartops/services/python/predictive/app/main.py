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

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared" / "python"))

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8002, reload=False)

"""
Self-Healing AI — Isolation Forest anomaly detection.

Endpoints:
  POST /detect          — score new datapoints against an Isolation Forest
  POST /heal/suggest    — suggest a healing action for a given DQ error code
"""
import sys
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared" / "python"))

from pydantic import BaseModel, Field
from fastapi import HTTPException

from smartops_shared.app import create_app

try:
    import numpy as np
    from sklearn.ensemble import IsolationForest
except Exception:
    np = None
    IsolationForest = None  # type: ignore

app = create_app(title="SmartOps · Self-Healing AI", service_name="anomaly")


class DetectRequest(BaseModel):
    history: List[List[float]] = Field(..., min_length=20,
        description="Each row is a vector of features (e.g. [progress, daily_rate, spi, cpi])")
    points: List[List[float]] = Field(..., min_length=1,
        description="Vectors to score")
    contamination: float = 0.05


class DetectResponse(BaseModel):
    scores: List[float]      # higher = more normal; negative = anomaly
    anomalies: List[bool]


class HealRequest(BaseModel):
    error_code: str
    rule: Optional[str] = None
    field: Optional[str] = None
    detected_value: Optional[str] = None


class HealSuggestion(BaseModel):
    action: str
    confidence: float
    rationale: str


@app.post("/detect", response_model=DetectResponse)
def detect(body: DetectRequest):
    if IsolationForest is None:
        raise HTTPException(503, "scikit-learn not installed")
    history = np.asarray(body.history, dtype=float)
    points = np.asarray(body.points, dtype=float)
    if history.shape[1] != points.shape[1]:
        raise HTTPException(400, "history and points must have the same feature width")
    model = IsolationForest(contamination=body.contamination, random_state=42)
    model.fit(history)
    scores = model.decision_function(points).tolist()
    preds = model.predict(points).tolist()    # -1 anomaly, 1 normal
    return DetectResponse(
        scores=[round(s, 4) for s in scores],
        anomalies=[p == -1 for p in preds])


_HEALING_RULES = {
    "R04": HealSuggestion(
        action="Update planned_td so planned_td >= planned_spud + drilling_days_estimate",
        confidence=0.92,
        rationale="Cross-field integrity rule — recompute from BP estimate."),
    "R08": HealSuggestion(
        action="Fetch md_depth from the latest DSR for this well and write back",
        confidence=0.87,
        rationale="Missing depth — pull from DSR feed."),
    "R11": HealSuggestion(
        action="Replace project_id with the active project code mapped to this well's cluster",
        confidence=0.78,
        rationale="Orphan FK — map by cluster."),
    "R19": HealSuggestion(
        action="Cap completion_pct at 100 and recompute downstream KPIs",
        confidence=0.95,
        rationale="Clamp range violation."),
    "R21": HealSuggestion(
        action="Convert daily_rate from mm/day to m/day (÷1000) — likely unit mismatch",
        confidence=0.81,
        rationale="Outlier magnitude consistent with mm vs m confusion."),
    "R22": HealSuggestion(
        action="Update cluster_id to match field_area zone mapping",
        confidence=0.74,
        rationale="Geo cluster mismatch."),
    "R23": HealSuggestion(
        action="Populate norm_qty from Activity Master before P-rating runs",
        confidence=0.88,
        rationale="Division-by-zero in P-rating calc."),
}


@app.post("/heal/suggest", response_model=HealSuggestion)
def suggest_heal(body: HealRequest):
    # Pick by rule code if the error_code matches a known pattern.
    rule_code = body.rule.split(" ")[0].lstrip("R") if body.rule else None
    if rule_code and f"R{rule_code}" in _HEALING_RULES:
        return _HEALING_RULES[f"R{rule_code}"]

    return HealSuggestion(
        action="Investigate manually; no auto-healing template available for this rule.",
        confidence=0.30,
        rationale="No heuristic match. Suggest adding rule to template library.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8003, reload=False)

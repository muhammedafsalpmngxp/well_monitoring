"""
Crew Optimization — OR-Tools CP-SAT solver for crew → activity assignment.

Endpoints:
  POST /optimize   — given crews, activities, and skill compatibility,
                     return the optimal assignment minimising total cost
                     subject to each crew being assigned at most one activity
                     and each activity being staffed exactly once.
"""
import sys
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared" / "python"))

from pydantic import BaseModel, Field
from fastapi import HTTPException

from smartops_shared.app import create_app

try:
    from ortools.sat.python import cp_model
except Exception:
    cp_model = None  # type: ignore

app = create_app(title="SmartOps · Crew Optimizer", service_name="crew_optimizer")


class Crew(BaseModel):
    code: str
    disciplines: List[str]   # what this crew can do
    cost_per_day: int = 100


class Activity(BaseModel):
    code: str
    discipline: str
    priority: int = 1        # higher = more important
    well_id: str | None = None


class OptimizeRequest(BaseModel):
    crews: List[Crew] = Field(..., min_length=1)
    activities: List[Activity] = Field(..., min_length=1)
    max_seconds: int = 5


class Assignment(BaseModel):
    crew_code: str
    activity_code: str
    well_id: str | None = None


class OptimizeResponse(BaseModel):
    status: str
    objective_value: float
    assignments: List[Assignment]
    unassigned_activities: List[str]


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(body: OptimizeRequest):
    if cp_model is None:
        raise HTTPException(503, "OR-Tools not installed")

    crews, acts = body.crews, body.activities

    # Pre-compute feasibility matrix
    feasible = {(c.code, a.code): (a.discipline in c.disciplines)
                for c in crews for a in acts}

    model = cp_model.CpModel()
    x = {(c.code, a.code): model.NewBoolVar(f"x_{c.code}_{a.code}")
         for c in crews for a in acts}

    # Each crew → at most one activity
    for c in crews:
        model.Add(sum(x[c.code, a.code] for a in acts) <= 1)

    # Each activity → at most one crew (we allow some unassigned)
    for a in acts:
        model.Add(sum(x[c.code, a.code] for c in crews) <= 1)

    # Skill constraint — disallow infeasible pairs
    for (cc, ac), ok in feasible.items():
        if not ok:
            model.Add(x[cc, ac] == 0)

    # Objective: maximise (priority × assignment) − cost
    objective_terms = []
    for c in crews:
        for a in acts:
            value = a.priority * 1000 - c.cost_per_day
            objective_terms.append(x[c.code, a.code] * value)
    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(body.max_seconds)
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.UNKNOWN: "UNKNOWN",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
    }.get(status, "UNKNOWN")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return OptimizeResponse(
            status=status_name, objective_value=0,
            assignments=[], unassigned_activities=[a.code for a in acts])

    assignments: List[Assignment] = []
    assigned_acts = set()
    for c in crews:
        for a in acts:
            if solver.Value(x[c.code, a.code]) == 1:
                assignments.append(Assignment(crew_code=c.code, activity_code=a.code,
                                              well_id=a.well_id))
                assigned_acts.add(a.code)

    return OptimizeResponse(
        status=status_name,
        objective_value=solver.ObjectiveValue(),
        assignments=assignments,
        unassigned_activities=[a.code for a in acts if a.code not in assigned_acts])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8004, reload=False)

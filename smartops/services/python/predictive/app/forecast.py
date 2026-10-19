"""
Forecasts built on the cleaned data (app/data.py + app/cleaning.py), following
the PDO / Al Tasnim business rules (core.AiPrompt 'askdata.business_rules'):

  * A well is completed when hook-up is done: eng_completion_date IS NOT NULL.
  * Lifecycle: construction -> rig on -> drilling (PDO) -> rig off -> hook-up
    (Al Tasnim) -> completed.
  * Construction is due ex_rig_on_date - 1 day; it is missed when that day has
    passed and the rig is still not on.
  * Hook-up deadline = ex_rig_off_date + 2 days while the rig is still on;
    once rig_off_date is known, rig_off_date + 2 days takes precedence.
  * Early is good news, never an anomaly; database dates are shown as stored.
  * Delay ownership follows the KPI reports (vw_Chart7 / fn_Chart30): reasons
    such as scope change, MOC, awaiting manifold/MSV are PDO issues.

1. Predicted engineering completion date for every well that has none yet
   (best / most likely / worst case = P10 / P50 / P90), by stage:
     hookup           rig off   -> rig off + hook-up time
     drilling         rig on    -> remaining drilling + hook-up time
     waiting_for_rig  no rig    -> wait for rig on (planned rig on + typical
                                   rig-on variance) + drilling + hook-up time
     on hold          rig off far longer than any past hook-up -> completion
                                   if work resumes now (today + hook-up time);
                                   not counted as late
   All times are learned from past wells, conditioned on how long the current
   stage has already run.

2. Daily output per activity (Prophet).

3. Backtests of the completion forecast, against the earlier duration-only model.

Run `python -m app.forecast` for a summary.
"""
import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.data import CleanData, daily_series

logging.getLogger("cmdstanpy").disabled = True
logging.getLogger("prophet").setLevel(logging.WARNING)

HOOKUP_DEADLINE_DAYS = 2      # business rule: hook-up due rig off + 2 days
CONSTRUCTION_DUE_DAYS = -1    # business rule: construction due planned rig on - 1 day
MIN_REFERENCE_WELLS = 10      # past wells needed to form a best..worst range
MAX_DRILLING_DAYS = 365       # rig on -> off longer than this is not used for learning
STALLED_DAYS = 30             # no reported work for this long -> stalled
OVERDUE_PERCENTILE = 98       # hook-up open longer than 98% of past hook-ups -> on hold
N_SIMULATIONS = 4000
HORIZON_DAYS = 14

# kpi_miss_reason patterns the KPI reports (vw_Chart7_Drilldown_Excel, fn_Chart30_KPI_Progress)
# treat as PDO issues, plus FLAF (issued by PDO per the business rules) and suspended wells.
PDO_REASONS = ["moc", "emoc", "scope change", "awaiting handover", "awaiting manifold", "msv",
               "material availability", "rsr", "hoist delay", "operation issue", "appraisal well",
               "technical issue", "flaf", "suspended"]

# Ramadan and Eid in the data window (approximate).
HOLIDAYS = pd.DataFrame([
    ("ramadan",      "2025-03-01", 0, 28), ("eid_al_fitr", "2025-03-30", -1, 3),
    ("eid_al_adha",  "2025-06-06", -1, 3),
    ("ramadan",      "2026-02-18", 0, 29), ("eid_al_fitr", "2026-03-20", -1, 3),
    ("eid_al_adha",  "2026-05-27", -1, 3),
    ("ramadan",      "2027-02-08", 0, 29), ("eid_al_fitr", "2027-03-10", -1, 3),
], columns=["holiday", "ds", "lower_window", "upper_window"]).assign(ds=lambda d: pd.to_datetime(d["ds"]))


# ── 1. predicted engineering completion ─────────────────────────────────────

def forecast_as_of(data: CleanData) -> pd.Timestamp:
    """Latest date with evidence: the last daily report or the latest actual
    rig / completion date in well_master (which is updated separately)."""
    today = pd.Timestamp(date.today())
    m = data.master
    actual = pd.concat([m["rig_on_date"], m["rig_off_date"], m["eng_completion_date"]])
    actual = actual[actual <= today]
    return max(pd.Timestamp(data.as_of), actual.max()) if len(actual) else pd.Timestamp(data.as_of)


def _hookup_days(m: pd.DataFrame, upto: pd.Timestamp) -> pd.Series:
    """Rig off -> hook-up complete, for wells completed by `upto`."""
    done = m[(m["eng_completion_date"] <= upto) & (m["rig_off_date"] <= upto)]
    d = (done["eng_completion_date"] - done["rig_off_date"]).dt.days
    return d[d >= 0]


def _drilling_days(m: pd.DataFrame, upto: pd.Timestamp) -> pd.Series:
    """Rig on -> rig off, for rigs off by `upto`."""
    done = m[(m["rig_off_date"] <= upto) & m["rig_on_date"].notna()]
    d = (done["rig_off_date"] - done["rig_on_date"]).dt.days
    return d[(d >= 0) & (d <= MAX_DRILLING_DAYS)]


def _rig_on_variance(m: pd.DataFrame, upto: pd.Timestamp) -> pd.Series:
    """Actual minus planned rig on (negative = early), for rigs on by `upto`."""
    done = m[(m["rig_on_date"] <= upto) & m["ex_rig_on_date"].notna()]
    return (done["rig_on_date"] - done["ex_rig_on_date"]).dt.days


def _remaining(pool: pd.Series, elapsed: int) -> tuple[np.ndarray, bool]:
    """Remaining days, judged only from past wells that took longer than
    `elapsed`. Second value: the well is already slower than ~all of them."""
    longer = pool[pool > elapsed]
    slower_than_most = len(longer) < MIN_REFERENCE_WELLS
    if slower_than_most:
        longer = pool.nlargest(MIN_REFERENCE_WELLS)
    return np.maximum(longer.to_numpy() - elapsed, 1), slower_than_most


def _sample(a: np.ndarray) -> np.ndarray:
    return np.random.default_rng(42).choice(a, N_SIMULATIONS)


def _stage_outcomes(stage: str, w: dict, as_of: pd.Timestamp, pools: dict):
    """Plausible numbers of days from `as_of` to completion, the most likely
    rig on / rig off dates on the way, and whether the well is already slower
    than nearly all past wells in its current stage."""
    hook = pools["hookup"].to_numpy()
    if stage == "hookup":
        rem, slow = _remaining(pools["hookup"], (as_of - w["rig_off_date"]).days)
        return rem, None, None, slow
    if stage == "drilling":
        drill, slow = _remaining(pools["drilling"], (as_of - w["rig_on_date"]).days)
        rig_off = as_of + pd.Timedelta(days=int(np.median(drill)))
        return _sample(drill) + _sample(hook), None, rig_off, slow
    # waiting for rig: planned rig on + how far rigs usually land from their plan
    wait, slow = _remaining(pools["rig_on_variance"], (as_of - w["ex_rig_on_date"]).days)
    drill = pools["drilling"].to_numpy()
    rig_on = as_of + pd.Timedelta(days=int(np.median(wait)))
    rig_off = rig_on + pd.Timedelta(days=int(np.median(drill)))
    return _sample(wait) + _sample(drill) + _sample(hook), rig_on, rig_off, slow


# ── PDO drilling-sequence schedule (dsq.drilling_sequence snapshots) ────────

PDO_LEAD_BUCKETS = [-10**6, 14, 30, 60, 10**6]   # days between the snapshot and planned rig off
MIN_PDO_ERRORS = 20
MAX_PDO_PLAN_AGE_DAYS = 30                        # older plans: the well dropped out of PDO's schedule
RESCHEDULED_DAYS = 90         # PDO's rig-on moved this far from well_master's plan -> "rescheduled by PDO"


def _pdo_first_ops(data: CleanData) -> pd.DataFrame:
    """Per snapshot and well: the first planned operation (rig on -> rig off)."""
    p = data.pdo.dropna(subset=["earl_start_date"]).assign(load_day=lambda d: d["load_timestamp"].dt.normalize())
    return p.sort_values("earl_start_date").groupby(["well_id", "load_day"], as_index=False).first()


def pdo_plan(data: CleanData, day: pd.Timestamp, first_ops: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """PDO's plan per well from the latest snapshot taken on or before `day`."""
    f = _pdo_first_ops(data) if first_ops is None else first_ops
    f = f[(f["load_day"] <= day) & (f["load_day"] >= day - pd.Timedelta(days=MAX_PDO_PLAN_AGE_DAYS))]
    return f.sort_values("load_day").groupby("well_id").last()


def _pdo_rig_off_misses(data: CleanData, day: pd.Timestamp, first_ops: pd.DataFrame) -> pd.DataFrame:
    """How far actual rig off landed from PDO's planned rig off, for every
    snapshot taken before the rig came off, using rigs off by `day` only."""
    f = first_ops[first_ops["load_day"] <= day]
    off = data.master.set_index("well_id")["rig_off_date"]
    f = f.assign(rig_off=f["well_id"].map(off))
    f = f[(f["rig_off"] <= day) & (f["rig_off"] > f["load_day"]) & f["earl_end_date"].notna()]
    return pd.DataFrame({"miss": (f["rig_off"] - f["earl_end_date"]).dt.days,
                         "lead": (f["earl_end_date"] - f["load_day"]).dt.days})


def _pdo_outcomes(plan: pd.Series, as_of: pd.Timestamp, misses: pd.DataFrame, hookup: pd.Series):
    """Days from `as_of` to completion: PDO planned rig off + its usual miss at
    this lead time + hook-up time. Also returns the most likely rig-off date."""
    lead = (plan["earl_end_date"] - as_of).days
    bucket = pd.cut([lead], PDO_LEAD_BUCKETS)[0]
    same = misses[pd.cut(misses["lead"], PDO_LEAD_BUCKETS) == bucket]["miss"]
    pool = (same if len(same) >= MIN_PDO_ERRORS else misses["miss"]).to_numpy()
    rig_off_days = np.maximum(lead + _sample(pool), 1)          # rig is not off yet
    rig_off = as_of + pd.Timedelta(days=int(np.median(rig_off_days)))
    return rig_off_days + _sample(hookup.to_numpy()), rig_off


def backtest_pdo(data: CleanData) -> dict:
    """Strict test of the PDO-schedule forecast against the stage model: at each
    snapshot date, use only that day's PDO schedule and what was known then,
    for wells drilling / waiting for rig that completed later."""
    as_of = forecast_as_of(data)
    m = data.master
    first_ops = _pdo_first_ops(data)
    rows = []
    for day in sorted(first_ops["load_day"].unique())[1:]:
        day = pd.Timestamp(day)
        pools = {"hookup": _hookup_days(m, day), "drilling": _drilling_days(m, day),
                 "rig_on_variance": _rig_on_variance(m, day)}
        misses = _pdo_rig_off_misses(data, day, first_ops)
        if len(misses) < MIN_PDO_ERRORS:
            continue
        plan = pdo_plan(data, day, first_ops)
        for _, w in m[(m["eng_completion_date"] > day) & (m["eng_completion_date"] <= as_of)].iterrows():
            on = w["rig_on_date"] if pd.notna(w["rig_on_date"]) and w["rig_on_date"] <= day else pd.NaT
            off = w["rig_off_date"] if pd.notna(w["rig_off_date"]) and w["rig_off_date"] <= day else pd.NaT
            stage = "hookup" if pd.notna(off) else "drilling" if pd.notna(on) else "waiting_for_rig"
            if stage == "hookup" or w["well_id"] not in plan.index or pd.isna(plan.at[w["well_id"], "earl_end_date"]):
                continue
            if stage == "waiting_for_rig" and pd.isna(w["ex_rig_on_date"]):
                continue
            actual = (w["eng_completion_date"] - day).days
            s_out, *_ = _stage_outcomes(stage, {"rig_off_date": off, "rig_on_date": on,
                                                "ex_rig_on_date": w["ex_rig_on_date"]}, day, pools)
            p_out, _ = _pdo_outcomes(plan.loc[w["well_id"]], day, misses, pools["hookup"])
            for name, o in (("stage", s_out), ("pdo", p_out)):
                p10, p50, p90 = np.percentile(o, [10, 50, 90])
                rows.append({"model": name, "stage": stage, "err": abs(actual - p50), "inside": p10 <= actual <= p90})
    r = pd.DataFrame(rows)
    if not len(r):
        return {"use_for_stages": [], "note": "no PDO snapshots to test"}

    def summary(g):
        return {"cases": int(len(g)), "average_miss": round(float(g["err"].mean()), 1),
                "typical_miss": float(g["err"].median()), "within_4_days": round(float((g["err"] <= 4).mean()), 2),
                "inside_window": round(float(g["inside"].mean()), 2)}
    out = {m_: summary(g) for m_, g in r.groupby("model")}
    out["by_stage"] = {f"{s}/{m_}": summary(g) for (s, m_), g in r.groupby(["stage", "model"])}
    # Use the PDO schedule only for the stages where it beat the stage model.
    out["use_for_stages"] = [s for s in ("drilling", "waiting_for_rig")
                             if f"{s}/pdo" in out["by_stage"]
                             and out["by_stage"][f"{s}/pdo"]["average_miss"]
                             <= out["by_stage"][f"{s}/stage"]["average_miss"] - 0.1]
    return out


def reason_owner(reason) -> Optional[str]:
    """Delay owner implied by a recorded kpi_miss_reason (KPI-report rules)."""
    if not isinstance(reason, str):
        return None
    r = reason.lower()
    if "non kpi" in r:
        return "Not counted in KPI"
    if any(p in r for p in PDO_REASONS):
        return "PDO"
    return None


def _d(x):
    return x.date() if pd.notna(x) else None


def forecast_well_finish(data: CleanData, as_of: Optional[date] = None, use_pdo=()) -> pd.DataFrame:
    """Predicted engineering completion for every well_master well that has
    no completion date (as of `as_of`). Wells in a stage listed in `use_pdo`
    (see backtest_pdo) that appear in PDO's recent drilling sequence are
    forecast from PDO's planned rig off instead of the stage model."""
    as_of = pd.Timestamp(as_of) if as_of else forecast_as_of(data)
    m = data.master
    pools = {"hookup": _hookup_days(m, as_of), "drilling": _drilling_days(m, as_of),
             "rig_on_variance": _rig_on_variance(m, as_of)}
    plan, misses = pd.DataFrame(), pd.DataFrame()
    if use_pdo and len(data.pdo):
        first_ops = _pdo_first_ops(data)
        plan, misses = pdo_plan(data, as_of, first_ops), _pdo_rig_off_misses(data, as_of, first_ops)
        if len(misses) < MIN_PDO_ERRORS:
            plan = pd.DataFrame()
    hook_q = np.percentile(pools["hookup"], [10, 50, 90]).round().astype(int)
    on_hold_after = int(np.percentile(pools["hookup"], OVERDUE_PERCENTILE))
    open_wells = m[m["eng_completion_date"].isna() | (m["eng_completion_date"] > as_of)]
    last_work = data.wells.set_index("well_id")["last_work_day"]

    rows = []
    for _, w in open_wells.iterrows():
        rig_on = w["rig_on_date"] if pd.notna(w["rig_on_date"]) and w["rig_on_date"] <= as_of else pd.NaT
        rig_off = w["rig_off_date"] if pd.notna(w["rig_off_date"]) and w["rig_off_date"] <= as_of else pd.NaT
        stage = "hookup" if pd.notna(rig_off) else "drilling" if pd.notna(rig_on) else "waiting_for_rig"
        reason = w["kpi_miss_reason"] if isinstance(w["kpi_miss_reason"], str) else None

        # Hook-up deadline: actual rig off + 2 takes precedence over planned rig off + 2.
        if pd.notna(rig_off):
            deadline, basis = rig_off + pd.Timedelta(days=HOOKUP_DEADLINE_DAYS), "actual rig off + 2 days"
        elif pd.notna(w["ex_rig_off_date"]):
            deadline, basis = w["ex_rig_off_date"] + pd.Timedelta(days=HOOKUP_DEADLINE_DAYS), "planned rig off + 2 days"
        else:
            deadline, basis = pd.NaT, None

        construction_due = (w["ex_rig_on_date"] + pd.Timedelta(days=CONSTRUCTION_DUE_DAYS)
                            if pd.notna(w["ex_rig_on_date"]) else pd.NaT)
        notes = []
        # Planned rig off before planned rig on: the planned deadline contradicts the plan itself,
        # so no late / on-time verdict is given while it is still the deadline in use.
        plan_conflict = (pd.notna(w["ex_rig_off_date"]) and pd.notna(w["ex_rig_on_date"])
                         and w["ex_rig_off_date"] < w["ex_rig_on_date"])
        if plan_conflict:
            notes.append("planned rig off is before planned rig on (as stored in well_master)")
        if stage == "waiting_for_rig" and pd.notna(construction_due) and as_of > construction_due:
            notes.append(f"construction deadline (planned rig on - 1 = {construction_due.date()}) passed and rig not on yet")

        row = {
            "well_id": w["well_id"], "stage": stage, "kpi_miss_reason": reason,
            "planned_rig_on": _d(w["ex_rig_on_date"]), "actual_rig_on": _d(rig_on),
            "planned_rig_off": _d(w["ex_rig_off_date"]), "actual_rig_off": _d(rig_off),
            "construction_due": _d(construction_due),
            "deadline": _d(deadline), "deadline_basis": basis,
            "p10_finish": None, "p50_finish": None, "p90_finish": None,
            "forecast_basis": None, "forecast_rig_on": None, "forecast_rig_off": None,
            "days_vs_deadline": None, "risk": None, "delay_owner": None, "flag": "",
            "pdo_planned_rig_on": None, "rescheduled_days": None,
            "days_since_work": (as_of - last_work[w["well_id"]]).days
                                if w["well_id"] in last_work.index and pd.notna(last_work[w["well_id"]]) else None,
        }

        on_hold = stage == "hookup" and (as_of - rig_off).days > on_hold_after
        if on_hold:
            # Open far longer than any normal hook-up: blocked. Predict completion if work
            # resumes now, and keep the well out of late counts.
            p10, p50, p90 = (as_of + pd.Timedelta(days=int(q)) for q in hook_q)
            row.update(p10_finish=p10.date(), p50_finish=p50.date(), p90_finish=p90.date(),
                       forecast_basis="if work resumes now",
                       risk="on_hold" if reason else "no_completion_no_reason",
                       delay_owner=reason_owner(reason), flag="on_hold")
            notes.append(f"rig off {(as_of - rig_off).days} days ago; {OVERDUE_PERCENTILE}% of hook-ups finish "
                         f"within {on_hold_after} days" + (f"; reason: {reason}" if reason else "; no reason recorded"))
        elif stage == "waiting_for_rig" and pd.isna(w["ex_rig_on_date"]):
            row["forecast_basis"] = "no planned rig-on date"
        else:
            in_pdo = (stage in use_pdo and w["well_id"] in plan.index
                      and pd.notna(plan.at[w["well_id"], "earl_end_date"]))
            rescheduled = None
            if in_pdo:
                p = plan.loc[w["well_id"]]
                outcomes, rig_off_p50 = _pdo_outcomes(p, as_of, misses, pools["hookup"])
                rig_on_p50 = p["earl_start_date"] if stage == "waiting_for_rig" else None
                slow = False
                basis_text = f"PDO drilling sequence ({p['load_day'].date()}): planned rig off + usual PDO miss + hook-up"
                row["pdo_planned_rig_on"] = _d(p["earl_start_date"])
                if pd.notna(w["ex_rig_on_date"]) and pd.notna(p["earl_start_date"]):
                    moved = (p["earl_start_date"] - w["ex_rig_on_date"]).days
                    if abs(moved) > RESCHEDULED_DAYS:
                        rescheduled = moved
                        notes.append(f"PDO rescheduled the rig: well_master planned rig on {w['ex_rig_on_date'].date()}, "
                                     f"PDO now {p['earl_start_date'].date()} ({moved:+d} days) - well_master needs updating")
            else:
                outcomes, rig_on_p50, rig_off_p50, slow = _stage_outcomes(
                    stage, {"rig_off_date": rig_off, "rig_on_date": rig_on, "ex_rig_on_date": w["ex_rig_on_date"]},
                    as_of, pools)
                basis_text = {"hookup": "rig off + hook-up time",
                              "drilling": "remaining drilling + hook-up time",
                              "waiting_for_rig": "planned rig on + usual rig-on variance + drilling + hook-up"}[stage]
            p10, p50, p90 = (as_of + pd.Timedelta(days=int(round(np.percentile(outcomes, q)))) for q in (10, 50, 90))
            row.update(p10_finish=p10.date(), p50_finish=p50.date(), p90_finish=p90.date(),
                       forecast_basis=basis_text,
                       forecast_rig_on=_d(rig_on_p50), forecast_rig_off=_d(rig_off_p50),
                       flag="slower_than_90pct" if slow else "")
            if (stage == "hookup" and row["days_since_work"] is not None
                    and row["days_since_work"] >= STALLED_DAYS):
                row["flag"] = "stalled"
            if rescheduled is not None:
                # The deadline still comes from the old well_master plan, so late / on-time
                # against it says nothing actionable; the forecast follows PDO's new plan.
                row["risk"], row["delay_owner"] = "rescheduled_by_pdo", "PDO (rescheduled)"
                row["rescheduled_days"] = rescheduled
            elif pd.notna(deadline) and plan_conflict and pd.isna(rig_off):
                row["risk"] = "plan_dates_conflict"
            elif pd.notna(deadline):
                row["days_vs_deadline"] = (p50 - deadline).days        # negative = early (good)
                row["risk"] = "late" if p50 > deadline else "at_risk" if p90 > deadline else "on_track"
                if row["risk"] != "on_track":
                    if reason_owner(reason):
                        row["delay_owner"] = reason_owner(reason)
                    elif stage == "hookup":
                        row["delay_owner"] = "Al Tasnim (hook-up)"
                    elif pd.notna(w["ex_rig_off_date"]) and rig_off_p50 is not None and rig_off_p50 > w["ex_rig_off_date"]:
                        row["delay_owner"] = "PDO (rig off later than planned)"
                    else:
                        row["delay_owner"] = "Al Tasnim (hook-up)"
        row["date_note"] = "; ".join(notes) or None
        rows.append(row)

    out = pd.DataFrame(rows)
    if not len(out):
        return out
    order = out["stage"].map({"hookup": 0, "drilling": 1, "waiting_for_rig": 2})
    return (out.assign(_o=order).sort_values(["_o", "days_vs_deadline"], ascending=[True, False], na_position="last")
               .drop(columns="_o").reset_index(drop=True))


def backtest_well_finish(data: CleanData, cutoff: date) -> dict:
    """Pretend today is `cutoff`: learn only from what was known then,
    forecast wells completed since, and compare with the real completion date.
    The earlier duration-only model (first reported work -> completion) is
    scored on the same wells where it applies.

    Caveat for waiting_for_rig: well_master keeps only the latest planned rig
    on date, which may have been revised after the cutoff."""
    cutoff = pd.Timestamp(cutoff)
    as_of = forecast_as_of(data)
    m = data.master
    pools = {"hookup": _hookup_days(m, cutoff), "drilling": _drilling_days(m, cutoff),
             "rig_on_variance": _rig_on_variance(m, cutoff)}
    test = m[(m["eng_completion_date"] > cutoff) & (m["eng_completion_date"] <= as_of)]
    first_work = data.wells.set_index("well_id")["first_work_day"]
    f = data.wells[(data.wells["status"] == "finished") & (data.wells["finish_date"] <= cutoff)]
    old_pool = (f["finish_date"] - f["first_work_day"]).dt.days
    old_pool = old_pool[old_pool >= 0]

    res = {s: {"wells": 0, "hits": 0, "err": [], "old_err": []}
           for s in ("hookup", "drilling", "waiting_for_rig", "all")}
    for _, w in test.iterrows():
        rig_on = w["rig_on_date"] if pd.notna(w["rig_on_date"]) and w["rig_on_date"] <= cutoff else pd.NaT
        rig_off = w["rig_off_date"] if pd.notna(w["rig_off_date"]) and w["rig_off_date"] <= cutoff else pd.NaT
        stage = "hookup" if pd.notna(rig_off) else "drilling" if pd.notna(rig_on) else "waiting_for_rig"
        if stage == "waiting_for_rig" and pd.isna(w["ex_rig_on_date"]):
            continue
        outcomes, _, _, _ = _stage_outcomes(
            stage, {"rig_off_date": rig_off, "rig_on_date": rig_on, "ex_rig_on_date": w["ex_rig_on_date"]},
            cutoff, pools)
        p10, p50, p90 = np.percentile(outcomes, [10, 50, 90])
        actual = (w["eng_completion_date"] - cutoff).days
        old = None
        fw = first_work.get(w["well_id"])
        if fw is not None and pd.notna(fw) and fw <= cutoff:
            rem, _ = _remaining(old_pool, (cutoff - fw).days)
            old = abs(np.percentile(rem, 50) - actual)
        for key in (stage, "all"):
            r = res[key]
            r["wells"] += 1
            r["hits"] += p10 <= actual <= p90
            r["err"].append(abs(p50 - actual))
            if old is not None:
                r["old_err"].append(old)
    out = {"cutoff": str(cutoff.date())}
    for key, r in res.items():
        n = r["wells"]
        out[key] = {
            "wells_tested": n,
            "typical_miss_days": float(np.median(r["err"])) if n else None,
            "inside_best_worst_window": round(r["hits"] / n, 2) if n else None,
            "old_model_typical_miss_days": float(np.median(r["old_err"])) if r["old_err"] else None,
        }
    return out


# ── 2. Prophet: daily output per activity ───────────────────────────────────

def _prophet_fit_predict(series: pd.DataFrame, horizon: int) -> pd.DataFrame:
    from prophet import Prophet
    s = series.set_index("ds")["y"].asfreq("D", fill_value=0).reset_index()   # no report = no output
    m = Prophet(weekly_seasonality=True, yearly_seasonality=False, daily_seasonality=False,
                holidays=HOLIDAYS, interval_width=0.8)
    m.fit(s)
    fc = m.predict(m.make_future_dataframe(periods=horizon)).tail(horizon)
    fc[["yhat", "yhat_lower", "yhat_upper"]] = fc[["yhat", "yhat_lower", "yhat_upper"]].clip(lower=0)
    return fc[["ds", "yhat", "yhat_lower", "yhat_upper"]]


def activity_series(data: CleanData, min_days: int = 60) -> pd.DataFrame:
    """Daily clean output per activity + unit, for activities with enough
    working days."""
    s = daily_series(data.daily, ["activity", "uom_id"], "qty_clean")
    active = s[s["y"] > 0].groupby(["activity", "uom_id"])["ds"].nunique()
    keep = active[active >= min_days].index
    return s.set_index(["activity", "uom_id"]).loc[keep].reset_index()


def forecast_activity_output(data: CleanData, top: int = 10, horizon: int = HORIZON_DAYS) -> pd.DataFrame:
    s = activity_series(data)
    busiest = (s[s["y"] > 0].groupby(["activity", "uom_id"])["ds"].nunique()
                .sort_values(ascending=False).head(top).index)
    out = []
    for key in busiest:
        one = s[(s["activity"] == key[0]) & (s["uom_id"] == key[1])][["ds", "y"]]
        fc = _prophet_fit_predict(one, horizon)
        fc.insert(0, "uom_id", key[1])
        fc.insert(0, "activity", key[0])
        out.append(fc)
    res = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    return res.rename(columns={"yhat": "p50", "yhat_lower": "p10", "yhat_upper": "p90"})


def backtest_activity_output(data: CleanData, top: int = 10, holdout: int = HORIZON_DAYS) -> pd.DataFrame:
    """Hide the last `holdout` days, forecast them, and compare with a naive
    forecast (average of the 28 days before) on total output over the window."""
    s = activity_series(data)
    busiest = (s[s["y"] > 0].groupby(["activity", "uom_id"])["ds"].nunique()
                .sort_values(ascending=False).head(top).index)
    rows = []
    for act, uom in busiest:
        one = s[(s["activity"] == act) & (s["uom_id"] == uom)][["ds", "y"]]
        one = one.set_index("ds")["y"].asfreq("D", fill_value=0)
        train, test = one.iloc[:-holdout], one.iloc[-holdout:]
        fc = _prophet_fit_predict(train.reset_index(), holdout)
        naive = train.iloc[-28:].mean()
        rows.append({
            "activity": act, "uom_id": uom, "actual_total": round(test.sum(), 1),
            "prophet_total": round(fc["yhat"].sum(), 1), "naive_total": round(naive * holdout, 1),
            "prophet_daily_mae": round(np.abs(fc["yhat"].to_numpy() - test.to_numpy()).mean(), 2),
            "naive_daily_mae": round(np.abs(naive - test.to_numpy()).mean(), 2),
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    import json
    from app.data import load_clean
    pd.set_option("display.width", 220)
    data = load_clean()
    as_of = forecast_as_of(data)
    print("as of:", as_of.date(), "(daily reports until", data.as_of, ")")

    wf = forecast_well_finish(data)
    print("\nopen wells by stage:", wf["stage"].value_counts().to_dict())
    print("with a predicted completion date:", int(wf["p50_finish"].notna().sum()), "of", len(wf))
    print("by status:", wf["risk"].fillna("no_deadline").value_counts().to_dict())
    print("late / at risk by owner:", wf[wf["risk"].isin(["late", "at_risk"])]["delay_owner"].value_counts().to_dict())

    for days_back in (30, 60, 90):
        print("\nbacktest:", json.dumps(backtest_well_finish(data, as_of - pd.Timedelta(days=days_back)), indent=1))

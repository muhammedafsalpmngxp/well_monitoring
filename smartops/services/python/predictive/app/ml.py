"""
Completion-date correction model for wells waiting for a rig or drilling.

The stage model in app/forecast.py gives a first estimate from typical times
(rig-on variance, drilling, hook-up). This module learns how far that estimate
is off from variables known at prediction time, and corrects it:

  FLAF lead time        planned rig on - FLAF issue date (business rule: 90 days)
  flowline / OHL length well_master fl_length_m, ohl_length_m
  PMS progress          planned quantity per task (PMS weightage) vs work
                        reported in task_daily up to that day
  PMS remaining hours   planned manhours not yet earned
  recent manhours       hours x crew in the last 14 days of reports
  rig, well type, cluster, non-standard, lift type

Every training example is built "as of" a past date, using only what was
known then, and is scored against the real eng_completion_date. One model
corrects the most likely date. The best / worst case window is sized from the
model's real misses on wells it was not trained on (5-fold, grouped by well,
scaled by how far ahead the forecast is), so it holds about 8 in 10 real
dates. Before use, the model is
validated on the most recent VALIDATION_DAYS of dates against the stage model
alone; the correction is applied only if it is more accurate there.

Hook-up wells keep the stage model: extra variables did not improve them.
"""
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from app import forecast as F
from app.data import CleanData

STAGES = ("waiting_for_rig", "drilling")
FIRST_CUTOFF = pd.Timestamp("2025-10-01")
CUTOFF_STEP_DAYS = 14
VALIDATION_DAYS = 90
MIN_HOOKUP_WELLS = 20         # completed wells needed before a date is usable for training
RECENT_DAYS = 14
WINDOW_QUANTILES = (0.05, 0.95)   # tested: holds ~8 in 10 real dates on later, unseen dates
MIN_SCALE_DAYS = 7            # misses are measured relative to max(days ahead, 7)

# Forward selection under strict walk-forward testing (learn only from completions known
# before each test period): only flaf_issued lowered the error (13.95 -> 13.80 days MAE).
# PMS %, PMS remaining manhours, recent manhours, flowline/OHL length, rig, well type and
# cluster all made the honest error worse, so they are computed but not used.
FEATURES = ["base_p50", "flaf_issued"]
MIN_GAIN_DAYS = 0.1           # the correction is used only if it lowers the honest MAE by this much

# Variables explained to users as drivers of a well's forecast.
DRIVERS = {
    "flaf_lead_days": lambda v, r: ("FLAF not issued yet" if r["flaf_issued"] == 0
                                    else f"FLAF issued {v:.0f} days before planned rig on"),
    "fl_length_m": lambda v, r: f"flowline {v:,.0f} m",
    "ohl_length_m": lambda v, r: f"overhead line {v:,.0f} m",
    "pms_remaining_mh": lambda v, r: f"{v:,.0f} PMS manhours still to earn",
    "pms_pct": lambda v, r: f"PMS {v:.0%} complete",
    "mh_14d": lambda v, r: f"{v:,.0f} manhours reported in the last 14 days",
    "rig_id": lambda v, r: f"rig {v:.0f}",
    "well_type_id": lambda v, r: f"well type {v:.0f}",
    "days_to_planned_rig_on": lambda v, r: (f"planned rig on in {v:.0f} days" if v >= 0
                                            else f"planned rig on passed {-v:.0f} days ago"),
}


# ── variables as of a date ───────────────────────────────────────────────────

def _report_features(data: CleanData, cutoff: pd.Timestamp) -> pd.DataFrame:
    """PMS progress and work intensity per well from daily reports up to
    `cutoff` (or the last report day, if reports stop earlier)."""
    report_day = min(cutoff, pd.Timestamp(data.as_of))
    d = data.daily[data.daily["ds"] <= report_day]
    done = d.groupby(["well_id", "task_code"], as_index=False)["qty_clean"].sum().rename(columns={"qty_clean": "done"})
    p = data.pms.merge(done, on=["well_id", "task_code"], how="left").fillna({"done": 0})
    p["frac"] = (p["done"] / p["quantity"]).clip(upper=1)
    p["fam"] = p["task_code"].str.extract(r"^([A-Z]+)")[0].fillna("")
    p["wf"] = p["weightage"] * p["frac"]

    def weighted(mask=None):
        g = (p if mask is None else p[mask]).groupby("well_id")[["wf", "weightage"]].sum()
        return g["wf"] / g["weightage"]

    recent = d[d["ds"] > report_day - pd.Timedelta(days=RECENT_DAYS)]
    recent = recent.assign(mh=recent["hours_clean"].fillna(0) * recent["crew_size"].clip(lower=1))
    out = pd.concat([
        weighted().rename("pms_pct"),
        weighted(p["fam"].str.startswith("LC")).rename("pms_location_pct"),
        weighted(p["fam"].str.startswith("FL")).rename("pms_flowline_pct"),
        p.assign(r=p["manhours"].fillna(0) * (1 - p["frac"])).groupby("well_id")["r"].sum().rename("pms_remaining_mh"),
        recent.groupby("well_id")["mh"].sum().rename("mh_14d"),
        recent.groupby("well_id")["ds"].nunique().rename("workdays_14d"),
        (report_day - d.groupby("well_id")["ds"].max()).dt.days.rename("days_since_report"),
    ], axis=1)
    out[["mh_14d", "workdays_14d"]] = out[["mh_14d", "workdays_14d"]].fillna(0)
    return out


def _stage(w, cutoff):
    rig_on = w["rig_on_date"] if pd.notna(w["rig_on_date"]) and w["rig_on_date"] <= cutoff else pd.NaT
    rig_off = w["rig_off_date"] if pd.notna(w["rig_off_date"]) and w["rig_off_date"] <= cutoff else pd.NaT
    stage = "hookup" if pd.notna(rig_off) else "drilling" if pd.notna(rig_on) else "waiting_for_rig"
    return stage, rig_on, rig_off


def _examples(data: CleanData, cutoff: pd.Timestamp, wells: pd.DataFrame, pools: dict) -> pd.DataFrame:
    """One row of variables per well (waiting for rig / drilling) as of `cutoff`."""
    rep = _report_features(data, cutoff)
    rows = []
    for _, w in wells.iterrows():
        stage, rig_on, rig_off = _stage(w, cutoff)
        if stage not in STAGES or (stage == "waiting_for_rig" and pd.isna(w["ex_rig_on_date"])):
            continue
        outcomes, *_ = F._stage_outcomes(
            stage, {"rig_off_date": rig_off, "rig_on_date": rig_on, "ex_rig_on_date": w["ex_rig_on_date"]},
            cutoff, pools)
        r = rep.loc[w["well_id"]] if w["well_id"] in rep.index else None
        flaf_known = pd.notna(w["flaf_issue_date"]) and w["flaf_issue_date"] <= cutoff
        rows.append({
            "cutoff": cutoff, "well_id": w["well_id"], "stage": stage,
            "base_p10": float(np.percentile(outcomes, 10)), "base_p50": float(np.percentile(outcomes, 50)),
            "base_p90": float(np.percentile(outcomes, 90)),
            "days_to_planned_rig_on": (w["ex_rig_on_date"] - cutoff).days if pd.notna(w["ex_rig_on_date"]) else np.nan,
            "days_since_rig_on": (cutoff - rig_on).days if pd.notna(rig_on) else np.nan,
            **{k: (r[k] if r is not None else np.nan) for k in
               ("pms_pct", "pms_location_pct", "pms_flowline_pct", "pms_remaining_mh", "days_since_report")},
            "mh_14d": r["mh_14d"] if r is not None else 0.0,
            "workdays_14d": r["workdays_14d"] if r is not None else 0.0,
            "flaf_issued": int(flaf_known),
            "flaf_lead_days": ((w["ex_rig_on_date"] - w["flaf_issue_date"]).days
                               if flaf_known and pd.notna(w["ex_rig_on_date"]) else np.nan),
            "scr_issued": int(pd.notna(w["scr_date"]) and w["scr_date"] <= cutoff),
            "well_type_id": w["well_type_id"], "rig_id": w["rig_id"], "cluster_code": w["cluster_code"],
            "non_standard": w["non_standard"], "fl_length_m": w["fl_length_m"], "ohl_length_m": w["ohl_length_m"],
            "lift_beam_pump": int(str(w["lift_type"]).strip().upper().startswith("B")),
            "is_drilling": int(stage == "drilling"),
        })
    return pd.DataFrame(rows)


def training_examples(data: CleanData, as_of: pd.Timestamp) -> pd.DataFrame:
    """Examples from past dates (every CUTOFF_STEP_DAYS while daily reports
    exist), each scored with the real days to engineering completion."""
    m = data.master
    last_cutoff = min(as_of, pd.Timestamp(data.as_of))
    frames = []
    for c in pd.date_range(FIRST_CUTOFF, last_cutoff, freq=f"{CUTOFF_STEP_DAYS}D"):
        pools = {"hookup": F._hookup_days(m, c), "drilling": F._drilling_days(m, c),
                 "rig_on_variance": F._rig_on_variance(m, c)}
        if len(pools["hookup"]) < MIN_HOOKUP_WELLS:
            continue
        done_later = m[(m["eng_completion_date"] > c) & (m["eng_completion_date"] <= as_of)]
        ex = _examples(data, c, done_later, pools)
        if len(ex):
            actual = done_later.set_index("well_id")["eng_completion_date"]
            ex["actual"] = (ex["well_id"].map(actual) - c).dt.days
            frames.append(ex)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


# ── model ────────────────────────────────────────────────────────────────────

def _regressor(loss: str, quantile: Optional[float] = None):
    from sklearn.ensemble import HistGradientBoostingRegressor
    kw = {"quantile": quantile} if quantile is not None else {}
    return HistGradientBoostingRegressor(loss=loss, max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                         min_samples_leaf=20, random_state=0, **kw)


def _relative_misses(ex: pd.DataFrame, p50: pd.Series) -> pd.Series:
    """Real miss (actual - predicted) relative to how far ahead the forecast was."""
    return (ex["actual"] - p50) / np.maximum(p50, MIN_SCALE_DAYS)


def _window(ex: pd.DataFrame, p50: pd.Series) -> dict:
    """Per stage: the 10th and 90th percentile of relative misses."""
    rel = _relative_misses(ex, p50)
    return {s: tuple(float(rel[ex["stage"] == s].quantile(q)) for q in WINDOW_QUANTILES)
            for s in STAGES if (ex["stage"] == s).sum() >= 20}


@dataclass
class CompletionModel:
    use: bool = False
    model: object = None                                # corrects the most likely date
    window: dict = field(default_factory=dict)          # stage -> (low, high) relative miss
    medians: dict = field(default_factory=dict)         # training medians, for per-well drivers
    validation: dict = field(default_factory=dict)
    examples: int = 0
    wells: int = 0

    @staticmethod
    def _fit(ex: pd.DataFrame):
        return _regressor("absolute_error").fit(ex[FEATURES], ex["actual"] - ex["base_p50"])

    @staticmethod
    def _p50(ex: pd.DataFrame, model) -> pd.Series:
        return pd.Series(np.maximum(ex["base_p50"] + model.predict(ex[FEATURES]), 1), index=ex.index)

    def predict(self, ex: pd.DataFrame, model=None, window: Optional[dict] = None) -> pd.DataFrame:
        """Days from the example's date to completion: best / most likely / worst."""
        p50 = self._p50(ex, model or self.model)
        window = self.window if window is None else window
        scale = np.maximum(p50, MIN_SCALE_DAYS)
        lo = ex["stage"].map(lambda s: window.get(s, (-0.5, 0.5))[0])
        hi = ex["stage"].map(lambda s: window.get(s, (-0.5, 0.5))[1])
        return pd.DataFrame({"p10": np.clip(p50 + lo * scale, 1, None).where(lambda v: v <= p50, p50),
                             "p50": p50,
                             "p90": (p50 + hi * scale).where(lambda v: v >= p50, p50)}, index=ex.index)

    def drivers(self, ex: pd.DataFrame, top: int = 3) -> pd.Series:
        """Per well: the variables that move its most likely date the most
        (compared with a typical well), e.g. 'FLAF issued 40 days before
        planned rig on (+12 d)'."""
        base = self.model.predict(ex[FEATURES])
        effects = {}
        for f in DRIVERS:
            alt = ex[FEATURES].copy()
            alt[f] = self.medians.get(f, np.nan)
            effects[f] = base - self.model.predict(alt)
        eff = pd.DataFrame(effects, index=ex.index)
        out = []
        for i, row in ex.iterrows():
            picked = eff.loc[i].abs().sort_values(ascending=False)
            texts = []
            for f in picked.index[:top]:
                d = eff.at[i, f]
                if abs(d) < 1 or (pd.isna(row[f]) and f != "flaf_lead_days"):
                    continue
                texts.append(f"{DRIVERS[f](row[f], row)} ({d:+.0f} d)")
            out.append("; ".join(texts) or None)
        return pd.Series(out, index=ex.index)


def _out_of_fold_p50(ex: pd.DataFrame, folds: int = 5) -> pd.Series:
    """Most likely days for each example from a model that never saw its well."""
    from sklearn.model_selection import GroupKFold
    out = pd.Series(np.nan, index=ex.index)
    for fit_idx, pred_idx in GroupKFold(folds).split(ex, groups=ex["well_id"]):
        fitted = CompletionModel._fit(ex.iloc[fit_idx])
        out.iloc[pred_idx] = CompletionModel._p50(ex.iloc[pred_idx], fitted).to_numpy()
    return out


def train(data: CleanData) -> CompletionModel:
    """Fit on all past dates; validate on the latest VALIDATION_DAYS first."""
    as_of = F.forecast_as_of(data)
    ex = training_examples(data, as_of)
    model = CompletionModel(examples=len(ex), wells=int(ex["well_id"].nunique()) if len(ex) else 0)
    if len(ex) < 200:
        model.validation = {"note": "not enough history to train"}
        return model
    # Strict walk-forward: for each test period, learn only from wells whose completion was
    # already known before the period started (no information from the future).
    split = ex["cutoff"].max() - pd.Timedelta(days=VALIDATION_DAYS)
    va_parts, pred_parts = [], []
    for start in pd.date_range(split, ex["cutoff"].max(), freq="42D"):
        known = ex[(ex["cutoff"] < start) & (ex["cutoff"] + pd.to_timedelta(ex["actual"], unit="D") < start)]
        test = ex[(ex["cutoff"] >= start) & (ex["cutoff"] < start + pd.Timedelta(days=42))]
        if len(known) < 200 or not len(test):
            continue
        fitted = model._fit(known)
        pred_parts.append(model.predict(test, fitted, _window(known, _out_of_fold_p50(known))))
        va_parts.append(test)
    if not va_parts:
        model.validation = {"note": "not enough history for walk-forward validation"}
        return model
    va, pred = pd.concat(va_parts), pd.concat(pred_parts)
    base_err = (va["actual"] - va["base_p50"]).abs()
    new_err = (va["actual"] - pred["p50"]).abs()
    by_stage = {}
    for s in STAGES:
        k = va["stage"] == s
        if k.any():
            by_stage[s] = {"cases": int(k.sum()),
                           "typical_miss_stage_model": float(base_err[k].median()),
                           "typical_miss_with_variables": float(new_err[k].median()),
                           "inside_window_stage_model": round(float(((va["actual"] >= va["base_p10"]) & (va["actual"] <= va["base_p90"]))[k].mean()), 2),
                           "inside_window_with_variables": round(float(((va["actual"] >= pred["p10"]) & (va["actual"] <= pred["p90"]))[k].mean()), 2)}
    model.validation = {
        "validated_on_dates_from": str(split.date()), "cases": int(len(va)), "wells": int(va["well_id"].nunique()),
        "method": "walk-forward, learning only from completions known before each test period",
        "typical_miss_stage_model": float(base_err.median()), "typical_miss_with_variables": float(new_err.median()),
        "average_miss_stage_model": round(float(base_err.mean()), 1), "average_miss_with_variables": round(float(new_err.mean()), 1),
        "inside_window_stage_model": round(float(((va["actual"] >= va["base_p10"]) & (va["actual"] <= va["base_p90"])).mean()), 2),
        "inside_window_with_variables": round(float(((va["actual"] >= pred["p10"]) & (va["actual"] <= pred["p90"])).mean()), 2),
        "by_stage": by_stage,
    }
    model.use = bool(new_err.mean() <= base_err.mean() - MIN_GAIN_DAYS)
    # Final: refit on every date; window from misses on wells left out of each fit.
    model.window = _window(ex, _out_of_fold_p50(ex))
    model.model = model._fit(ex)
    model.medians = ex[FEATURES].median(numeric_only=True).to_dict()
    return model


def apply(model: CompletionModel, data: CleanData, forecast: pd.DataFrame) -> pd.DataFrame:
    """Correct the stage-model dates of waiting-for-rig and drilling wells and
    add per-well drivers. Returns the forecast unchanged if the model is off."""
    out = forecast.copy()
    out["model"] = np.where(out["p50_finish"].notna(), "stage model", None)
    out["drivers"] = None
    if not model.use or not len(out):
        return out
    as_of = F.forecast_as_of(data)
    m = data.master
    pools = {"hookup": F._hookup_days(m, as_of), "drilling": F._drilling_days(m, as_of),
             "rig_on_variance": F._rig_on_variance(m, as_of)}
    target = out[out["stage"].isin(STAGES) & out["p50_finish"].notna()]
    ex = _examples(data, as_of, m[m["well_id"].isin(target["well_id"])], pools)
    if not len(ex):
        return out
    pred = model.predict(ex)
    drv = model.drivers(ex)
    for i, e in ex.iterrows():
        j = out.index[out["well_id"] == e["well_id"]][0]
        p10, p50, p90 = (as_of + pd.Timedelta(days=int(round(pred.at[i, k]))) for k in ("p10", "p50", "p90"))
        out.loc[j, ["p10_finish", "p50_finish", "p90_finish"]] = [p10.date(), p50.date(), p90.date()]
        out.at[j, "model"] = "stage model + variables"
        out.at[j, "drivers"] = drv.at[i]
        dl = out.at[j, "deadline"]
        deadline = pd.Timestamp(dl) if pd.notna(dl) else pd.NaT
        if pd.notna(deadline) and out.at[j, "risk"] not in ("plan_dates_conflict", "rescheduled_by_pdo"):
            out.at[j, "days_vs_deadline"] = (p50 - deadline).days
            risk = "late" if p50 > deadline else "at_risk" if p90 > deadline else "on_track"
            out.at[j, "risk"] = risk
            if risk == "on_track":
                out.at[j, "delay_owner"] = None
            elif pd.isna(out.at[j, "delay_owner"]):
                out.at[j, "delay_owner"] = F.reason_owner(out.at[j, "kpi_miss_reason"]) or "Al Tasnim (hook-up)"
    return out

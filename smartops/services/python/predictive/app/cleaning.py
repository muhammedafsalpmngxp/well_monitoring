"""
Cleaning pipeline for well.task_daily daily reports.

Every step is a small named function. Rows are only removed when they are a
second copy of work already counted (or cannot be placed in time); anything
suspicious is kept and *flagged* with the rule that caught it, so the
forecast can skip it and the data-quality report can show it.

Steps, in order:
  1. parse_reports      daily_data as JSON, else Ruby-hash text ("k"=>"v"),
                        else the `planned` column (qty rounded to 1 decimal)
  2. drop_bad_days      ActionOn missing, before 2020 or in the future
  3. count_once         identical report copies (e.g. the same report under two
                        schedules) count once; same crew twice on one day ->
                        latest update wins; different crews -> summed
  4. flag_outliers      qty far above the task's own usual day (or the
                        activity's when the task has few days), absurd values,
                        negative qty
  5. flag_hours         hours < 0 or > 24
"""
import json
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Optional

import numpy as np
import pandas as pd

MIN_DATE = pd.Timestamp("2020-01-01")
MAX_PLAN_DATE = pd.Timestamp("2030-12-31")

OUTLIER_RATIO = 20.0          # flag a day >= 20x the task's own usual daily qty
FALLBACK_RATIO = 100.0        # stricter when only the activity's usual day is known
                              # (catches m typed into Km, x1000; spares big one-day jobs)
ABSURD_QTY = 1_000_000        # always flag (keyboard mash, e.g. 989089888899998)
MIN_TASK_DAYS = 5             # task history needed to use the task's own median
MIN_ACTIVITY_DAYS = 20        # activity history needed for the fallback median
MAX_HOURS = 24.0


@dataclass
class Ctx:
    today: pd.Timestamp
    stats: dict = field(default_factory=dict)


# ── helpers ──────────────────────────────────────────────────────────────────

def parse_report(text: Optional[str]) -> Optional[dict]:
    """Parse a daily_data value: JSON first, then Ruby-hash text."""
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        pass
    try:
        return json.loads(text.replace('"=>', '":').replace(":nil", ":null"))
    except ValueError:
        return None


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _crew(emps) -> str:
    """Crew key: sorted employee ids, so the same crew in another order matches."""
    if not emps:
        return ""
    return ",".join(sorted(e.strip() for e in str(emps).split(",") if e.strip()))


def activity_of(task_code: str) -> str:
    """'LRCV1010-4947' -> 'LRCV1010' (task code without the well suffix)."""
    return str(task_code).rsplit("-", 1)[0] if task_code else ""


def _add_flag(df: pd.DataFrame, mask: pd.Series, reason: str) -> None:
    mask = mask.fillna(False)
    df.loc[mask, "flag_reason"] = np.where(
        df.loc[mask, "flag_reason"].eq(""), reason, df.loc[mask, "flag_reason"] + "; " + reason)


# ── steps ────────────────────────────────────────────────────────────────────

def parse_reports(df: pd.DataFrame, ctx: Ctx) -> pd.DataFrame:
    df = df.copy()
    df["ActionOn"] = pd.to_datetime(df["ActionOn"], errors="coerce")
    df["well_id"] = df["well_id"].astype(str).str.strip()
    parsed = df["daily_data"].map(parse_report)
    is_json = df["daily_data"].map(lambda t: t is not None and t.lstrip().startswith("{") and '"=>' not in t)
    ctx.stats["parsed_ruby_format"] = int((parsed.notna() & ~is_json).sum())
    ctx.stats["unparseable_used_planned"] = int(parsed.isna().sum())
    df["qty"] = [_num(p.get("actual_quantity")) if p else None for p in parsed]
    df["qty"] = df["qty"].fillna(pd.to_numeric(df["planned"], errors="coerce"))
    df["hours"] = [_num(p.get("actual_hours")) if p else None for p in parsed]
    df["crew"] = [_crew(p.get("employee_ids")) if p else "" for p in parsed]
    df["ph_name"] = [str(p.get("ph_name") or "").strip() or None if p else None for p in parsed]
    return df


def drop_bad_days(df: pd.DataFrame, ctx: Ctx) -> pd.DataFrame:
    keep = df["ActionOn"].between(MIN_DATE, ctx.today)
    ctx.stats["dropped_bad_day"] = int((~keep).sum())
    return df[keep]


def count_once(df: pd.DataFrame, ctx: Ctx) -> pd.DataFrame:
    """Turn reports into one row per well / task / day without double counting."""
    before = len(df)
    df = df.sort_values("id").drop_duplicates(["well_id", "task_code", "ActionOn", "daily_data"])
    ctx.stats["removed_identical_copies"] = before - len(df)

    before = len(df)
    df = df.drop_duplicates(["well_id", "task_code", "ActionOn", "crew"], keep="last")
    ctx.stats["removed_same_crew_earlier_updates"] = before - len(df)

    df = df.assign(crew_size=df["crew"].map(lambda c: len(c.split(",")) if c else 0))
    multi = df.duplicated(["well_id", "task_code", "ActionOn"], keep=False)
    ctx.stats["task_days_summed_different_crews"] = int(
        df[multi].drop_duplicates(["well_id", "task_code", "ActionOn"]).shape[0])
    daily = (df.groupby(["well_id", "task_code", "ActionOn"], as_index=False)
               .agg(qty=("qty", lambda s: s.sum(min_count=1)),
                    hours=("hours", lambda s: s.sum(min_count=1)),
                    crew_size=("crew_size", "sum"), reports=("id", "count"),
                    uom_id=("uom_id", "last"),
                    crew_id=("crew_id", "last"), ph_name=("ph_name", "last")))   # last non-empty
    # Unit of measure per task from its latest report (copies under other schedules can differ).
    daily["uom_id"] = daily.groupby("task_code")["uom_id"].transform("last")
    daily = daily.rename(columns={"ActionOn": "ds"})
    daily["activity"] = daily["task_code"].map(activity_of)
    daily["flag_reason"] = ""
    ctx.stats["clean_task_days"] = len(daily)
    return daily


def flag_outliers(df: pd.DataFrame, ctx: Ctx) -> pd.DataFrame:
    """Compare each day with the task's own usual day (median of its working
    days); tasks with too few days use the usual day of the same activity *in
    the same unit* (FLCV1010 is reported in Km, CWCV1220 in m², FLC1380 in
    trips), so a task measured in another unit is not flagged as a whole."""
    df = df.copy()
    pos = df["qty"] > 0
    work = df[pos]
    task_med = work.groupby("task_code")["qty"].agg(["median", "size"])
    act_med = work.groupby(["activity", "uom_id"], dropna=False)["qty"].agg(["median", "size"])
    t = task_med.reindex(df["task_code"]).set_axis(df.index)
    a = act_med.reindex(pd.MultiIndex.from_frame(df[["activity", "uom_id"]])).set_axis(df.index)
    own = t["median"].where(t["size"] >= MIN_TASK_DAYS)
    ref = own.fillna(a["median"].where(a["size"] >= MIN_ACTIVITY_DAYS))
    df["usual_qty"] = ref
    df["ratio_to_usual"] = df["qty"] / ref
    limit = np.where(own.notna(), OUTLIER_RATIO, FALLBACK_RATIO)

    absurd = df["qty"] >= ABSURD_QTY
    spike = pos & ~absurd & (df["ratio_to_usual"] >= limit)
    negative = df["qty"] < 0
    _add_flag(df, absurd, "absurd_qty")
    _add_flag(df, spike, "qty_far_above_usual")
    _add_flag(df, negative, "negative_qty")
    ctx.stats["flag_absurd_qty"] = int(absurd.sum())
    ctx.stats["flag_qty_spike"] = int(spike.sum())
    ctx.stats["flag_negative_qty"] = int(negative.sum())
    return df


def flag_hours(df: pd.DataFrame, ctx: Ctx) -> pd.DataFrame:
    df = df.copy()
    bad = (df["hours"] < 0) | (df["hours"] > MAX_HOURS)
    _add_flag(df, bad, "hours_out_of_range")
    ctx.stats["flag_hours_out_of_range"] = int(bad.sum())
    return df


PIPELINE: list[Callable[[pd.DataFrame, Ctx], pd.DataFrame]] = [
    parse_reports, drop_bad_days, count_once, flag_outliers, flag_hours,
]


def run_pipeline(raw: pd.DataFrame, today: Optional[date] = None,
                 steps=PIPELINE) -> tuple[pd.DataFrame, dict]:
    """Raw report rows -> one row per well/task/day with `flagged` and
    `flag_reason`; `qty_clean` / `hours_clean` blank out flagged values."""
    ctx = Ctx(today=pd.Timestamp(today or date.today()), stats={"report_rows": len(raw)})
    df = raw
    for step in steps:
        df = step(df, ctx)
    df["flagged"] = df["flag_reason"] != ""
    # A quantity flag blanks the quantity; an hours flag blanks only the hours.
    df["qty_clean"] = df["qty"].where(~df["flag_reason"].str.contains("qty"))
    df["hours_clean"] = df["hours"].where(~df["flag_reason"].str.contains("hours"))
    ctx.stats["flagged_task_days"] = int(df["flagged"].sum())
    ctx.stats["task_days_with_work"] = int((df["qty_clean"] > 0).sum())
    ctx.stats["wells_with_work"] = int(df.loc[df["qty_clean"] > 0, "well_id"].nunique())
    return df.reset_index(drop=True), ctx.stats


# ── task and well level ──────────────────────────────────────────────────────

def clean_tasks(raw: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    """Per task: plan/actual dates (out-of-range -> NaT), first/last working
    day from the clean daily rows, and the actual duration in days."""
    t = raw.copy()
    t["well_id"] = t["well_id"].astype(str).str.strip()
    for c in ("actual_start", "actual_end", "target_start", "target_end", "committed_end"):
        t[c] = pd.to_datetime(t[c], errors="coerce", utc=False)
        if getattr(t[c].dt, "tz", None) is not None:
            t[c] = t[c].dt.tz_localize(None)
        t.loc[~t[c].between(MIN_DATE, MAX_PLAN_DATE), c] = pd.NaT
    work = (daily[daily["qty_clean"] > 0]
            .groupby(["well_id", "task_code"], as_index=False)
            .agg(first_work_day=("ds", "min"), last_work_day=("ds", "max"),
                 work_days=("ds", "nunique"), total_qty=("qty_clean", "sum")))
    t = t.merge(work, on=["well_id", "task_code"], how="left")
    t["activity"] = t["task_code"].map(activity_of)
    ok = t["actual_start"].notna() & t["actual_end"].notna() & (t["actual_end"] >= t["actual_start"])
    t["duration_days"] = ((t["actual_end"] - t["actual_start"]).dt.days + 1).where(ok)
    t["completed"] = t["completed"].fillna(0).astype(int)
    t["closed"] = t["actual_end"].notna() | (t["completed"] == 1)
    return t


def well_status(tasks: pd.DataFrame, master: pd.DataFrame) -> pd.DataFrame:
    """One row per well that has reported work.

    status = 'finished' / 'running' only for wells in well_master, decided by
    eng_completion_date. Wells missing from well_master get status 'unknown':
    closed tasks do not prove a well is finished, so these wells are left out
    of finish-date training and forecasts (their daily work is still used).
    """
    worked = tasks[tasks["first_work_day"].notna()]
    w = (worked.groupby("well_id")
               .agg(tasks=("task_code", "nunique"), open_tasks=("closed", lambda s: int((~s).sum())),
                    first_work_day=("first_work_day", "min"), last_work_day=("last_work_day", "max"),
                    last_task_end=("actual_end", "max"))
               .reset_index())
    m = master.copy()
    m["well_id"] = m["well_id"].astype(str).str.strip()
    m = m[["well_id"] + [c for c in m.columns if c.endswith("_date")]]
    for c in m.columns.drop("well_id"):
        m[c] = pd.to_datetime(m[c], errors="coerce")
    w = w.merge(m.drop_duplicates("well_id").assign(in_master=True), on="well_id", how="left")
    w["in_master"] = w["in_master"].eq(True)

    w["finished"] = w["in_master"] & w["eng_completion_date"].notna()
    w["status"] = np.select([~w["in_master"], w["finished"]], ["unknown", "finished"], "running")
    w["finish_date"] = w["eng_completion_date"]
    return w

"""
Read-only loader for the forecasting data in AlTasnimBI.

Nothing is written to the database: rows are read once and cleaned in memory
by the pipeline in app/cleaning.py.

Sources:
  well.task_daily    daily work reports (daily_data) and task plan/actual dates
  well.well_master   eng_completion_date = the well is finished;
                     ex_rig_off_date (planned rig off) + 2 days = the deadline

Connection string: env ConnectionStrings__AlTasnimBI (ADO.NET or ODBC form).
Run `python -m app.data` for a cleaning summary and data-quality examples.
"""
import os
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

import pandas as pd

from app.cleaning import clean_tasks, run_pipeline, well_status

CONN_ENV = "ConnectionStrings__AlTasnimBI"
ODBC_DRIVER = os.environ.get("PREDICTIVE_ODBC_DRIVER", "ODBC Driver 18 for SQL Server")

_ADO_TO_ODBC = {
    "server": "SERVER", "data source": "SERVER",
    "database": "DATABASE", "initial catalog": "DATABASE",
    "user id": "UID", "uid": "UID", "user": "UID",
    "password": "PWD", "pwd": "PWD",
    "trustservercertificate": "TrustServerCertificate",
    "encrypt": "Encrypt",
}


def to_odbc(conn_str: str) -> str:
    """Accept an ADO.NET connection string (as used by the .NET services) or an
    ODBC one, and return an ODBC string for pyodbc."""
    if "driver=" in conn_str.lower():
        return conn_str
    parts = {}
    for item in conn_str.split(";"):
        if "=" not in item:
            continue
        k, v = item.split("=", 1)
        key = _ADO_TO_ODBC.get(k.strip().lower())
        if key:
            v = v.strip()
            if key in ("TrustServerCertificate", "Encrypt"):
                v = "yes" if v.lower() in ("true", "yes", "1") else "no"
            parts[key] = v
    parts.setdefault("Encrypt", "no")
    body = ";".join(f"{k}={{{v}}}" if k == "PWD" else f"{k}={v}" for k, v in parts.items())
    return f"DRIVER={{{ODBC_DRIVER}}};{body};ApplicationIntent=ReadOnly"


def _connect():
    import pyodbc  # imported lazily so the service starts without ODBC installed
    raw = os.environ.get(CONN_ENV)
    if not raw:
        raise RuntimeError(f"Environment variable {CONN_ENV} is not set")
    return pyodbc.connect(to_odbc(raw), timeout=30, readonly=True)


def _query(cn, sql: str) -> pd.DataFrame:
    cur = cn.cursor()
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    return pd.DataFrame.from_records(cur.fetchall(), columns=cols)


_REPORTS_SQL = """
SELECT id, well_id, task_code, schedule_id, uom_id, crew_id, crew_type_id, ActionOn, planned, daily_data
FROM well.task_daily
WHERE daily_data IS NOT NULL
"""

# Crew names, activity norms and PDO drilling-sequence snapshots (for app/insights.py).
_CREW_SQL = """
SELECT c.crew_id, c.code AS crew_code, t.crew_type_code, t.crew_type_name
FROM ref.crew c LEFT JOIN ref.crew_type t ON t.crew_type_id = c.crew_type_id
"""
_NORMS_SQL = """
SELECT activity_id AS activity, new_activity_code, uom_id AS norm_uom_id, TRY_CAST(norms AS float) AS norm
FROM dbo.activity_codes_norms WHERE TRY_CAST(norms AS float) > 0
"""
_PDO_SQL = """
SELECT CAST(well_id AS varchar(20)) AS well_id, load_timestamp, rig_id AS pdo_rig_id,
       earl_start_date, earl_end_date, normal_duration
FROM dsq.drilling_sequence
"""

# Cast so pyodbc can read the columns whatever their source type (some are datetimeoffset).
_TASKS_SQL = """
SELECT well_id, task_code,
       MIN(CAST(actual_start  AS datetime2)) AS actual_start,
       MAX(CAST(actual_end    AS datetime2)) AS actual_end,
       MAX(CAST(target_start  AS datetime2)) AS target_start,
       MAX(CAST(target_end    AS datetime2)) AS target_end,
       MAX(CAST(committed_end AS datetime2)) AS committed_end,
       MAX(CAST(completed AS int))           AS completed
FROM well.task_daily
GROUP BY well_id, task_code
"""

# rig_off_date = actual rig off, ex_rig_off_date = planned (expected) rig off;
# kpi_miss_reason = why a well is delayed / on hold (e.g. 'Well Suspended').
# The remaining columns are predictors for the completion model (app/ml.py).
_MASTER_SQL = """
SELECT m.well_id, m.eng_completion_date, m.rig_on_date, m.rig_off_date, m.ex_rig_on_date, m.ex_rig_off_date,
       m.kpi_miss_reason, m.flaf_issue_date, m.scr_date, m.well_type_id, m.lift_type, m.rig_id, m.cluster_code,
       TRY_CAST(m.fl_length_m AS float) AS fl_length_m, TRY_CAST(m.ohl_length_m AS float) AS ohl_length_m,
       CAST(c.non_standard AS int) AS non_standard
FROM well.well_master m
LEFT JOIN (SELECT well_id, MAX(CAST(non_standard AS int)) AS non_standard
           FROM well.well_classification GROUP BY well_id) c ON c.well_id = m.well_id
"""

# PMS plan per task from each well's latest schedule: weightage, planned quantity and manhours.
_PMS_SQL = """
WITH s AS (
    SELECT well_id, schedule_id,
           ROW_NUMBER() OVER (PARTITION BY well_id ORDER BY MAX(updated_at) DESC) AS rn
    FROM dbo.activity_taskplan_job_progress
    GROUP BY well_id, schedule_id
)
SELECT CAST(p.well_id AS varchar(20)) AS well_id, p.task_code,
       TRY_CAST(p.weightage AS float) AS weightage,
       TRY_CAST(p.quantity AS float)  AS quantity,
       TRY_CAST(p.manhours AS float)  AS manhours
FROM dbo.activity_taskplan_job_progress p
JOIN s ON s.well_id = p.well_id AND s.schedule_id = p.schedule_id AND s.rn = 1
"""


@dataclass
class CleanData:
    daily: pd.DataFrame          # one row per well, task, day (flagged rows kept)
    tasks: pd.DataFrame          # one row per well, task: plan/actual dates, duration
    wells: pd.DataFrame          # one row per well with work: finished?, finish_date
    as_of: Optional[date]        # last day with reported work
    stats: dict = field(default_factory=dict)
    master: pd.DataFrame = field(default_factory=pd.DataFrame)   # well_master rig / completion dates, all wells
    pms: pd.DataFrame = field(default_factory=pd.DataFrame)      # PMS plan per task (weightage, quantity, manhours)
    crews: pd.DataFrame = field(default_factory=pd.DataFrame)    # ref.crew + crew type names
    norms: pd.DataFrame = field(default_factory=pd.DataFrame)    # dbo.activity_codes_norms
    pdo: pd.DataFrame = field(default_factory=pd.DataFrame)      # PDO drilling-sequence snapshots

    def quality_report(self) -> pd.DataFrame:
        """Every flagged task-day with the rule that caught it."""
        cols = ["well_id", "task_code", "ds", "qty", "hours", "usual_qty", "ratio_to_usual", "flag_reason"]
        return self.daily.loc[self.daily["flagged"], cols].sort_values("ratio_to_usual", ascending=False)


def load_clean(today: Optional[date] = None) -> CleanData:
    with _connect() as cn:
        raw_reports = _query(cn, _REPORTS_SQL)
        raw_tasks = _query(cn, _TASKS_SQL)
        master = _query(cn, _MASTER_SQL)
        pms = _query(cn, _PMS_SQL)
        crews = _query(cn, _CREW_SQL)
        norms = _query(cn, _NORMS_SQL)
        pdo = _query(cn, _PDO_SQL)
    daily, stats = run_pipeline(raw_reports, today)
    tasks = clean_tasks(raw_tasks, daily)
    wells = well_status(tasks, master)
    as_of = daily.loc[daily["qty_clean"] > 0, "ds"].max()
    stats["tasks"] = len(tasks)
    stats["wells_total"] = len(wells)
    for status in ("finished", "running", "unknown"):
        stats[f"wells_{status}"] = int((wells["status"] == status).sum())
    master = master.copy()
    master["well_id"] = master["well_id"].astype(str).str.strip()
    for c in [c for c in master.columns if c.endswith("_date")]:
        master[c] = pd.to_datetime(master[c], errors="coerce")
    master["kpi_miss_reason"] = master["kpi_miss_reason"].astype("string").str.strip().replace("", pd.NA)
    for c in ("well_type_id", "rig_id", "cluster_code", "fl_length_m", "ohl_length_m", "non_standard"):
        master[c] = pd.to_numeric(master[c], errors="coerce")
    pms["well_id"] = pms["well_id"].astype(str).str.strip()
    pms = pms[(pms["weightage"] > 0) & (pms["quantity"] > 0)].drop_duplicates(["well_id", "task_code"])
    pdo["well_id"] = pdo["well_id"].astype(str).str.strip()
    for c in ("load_timestamp", "earl_start_date", "earl_end_date"):
        pdo[c] = pd.to_datetime(pdo[c], errors="coerce")
    pdo["normal_duration"] = pd.to_numeric(pdo["normal_duration"], errors="coerce")
    return CleanData(daily=daily, tasks=tasks, wells=wells,
                     as_of=as_of.date() if pd.notna(as_of) else None, stats=stats,
                     master=master.drop_duplicates("well_id"), pms=pms.reset_index(drop=True),
                     crews=crews, norms=norms.drop_duplicates("activity"), pdo=pdo)


def daily_series(daily: pd.DataFrame, by: list[str], value: str = "qty_clean") -> pd.DataFrame:
    """Aggregate clean task-days into Prophet-ready series: columns by + ds + y.
    Flagged values are already blank in qty_clean / hours_clean.

    Quantities are only comparable within one activity (units differ between
    activities), so use by=["activity"] or ["well_id", "activity"] for qty;
    hours and crew_size can be summed across activities.
    """
    return (daily.groupby(by + ["ds"], as_index=False)[value].sum()
                 .rename(columns={value: "y"}))


if __name__ == "__main__":
    data = load_clean()
    print("as of (last day with work):", data.as_of)
    for k, v in data.stats.items():
        print(f"  {k:36} {v:>8}")
    print("\ndata-quality report (top flagged task-days):")
    print(data.quality_report().head(10).to_string(index=False))
    print("\nwell status:")
    print(data.wells["status"].value_counts().to_string())

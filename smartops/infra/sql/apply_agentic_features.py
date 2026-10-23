"""Applies the Agentic Features SQL to QA without sqlcmd (uses pyodbc), then checks the result.

    set SA_PWD=<the SA password>
    python apply_agentic_features.py

Runs add-agentic-features.sql on the tenant database and add-agentic-features-permission.sql on the control plane.
Both scripts are idempotent (safe to run again). The password is read from SA_PWD, never from this file.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pyodbc

SERVER = os.environ.get("SQL_SERVER", "20.98.112.250,1433")
USER = os.environ.get("SQL_USER", "SA")
TENANT_DB = os.environ.get("TENANT_DB", "smartops_tenant_TNT-1000")
CONTROL_DB = os.environ.get("CONTROL_DB", "smartops_control_plane_qa")
HERE = Path(__file__).resolve().parent


def connect(database: str) -> pyodbc.Connection:
    password = os.environ.get("SA_PWD")
    if not password:
        sys.exit("Set the password first:  set SA_PWD=<the SA password>")
    driver = [d for d in pyodbc.drivers() if "SQL Server" in d][-1]
    return pyodbc.connect(f"DRIVER={{{driver}}};SERVER={SERVER};DATABASE={database};UID={USER};PWD={password};"
                          "TrustServerCertificate=yes", autocommit=True, timeout=30)


def run_file(name: str, database: str) -> None:
    sql = (HERE / name).read_text(encoding="utf-8-sig")
    sql = re.sub(r"^\s*USE\s+\[?[^\]\n;]+\]?\s*;?\s*$", "", sql, flags=re.M | re.I)  # the database is chosen here
    batches = [b for b in re.split(r"^\s*GO\s*$", sql, flags=re.M | re.I) if b.strip()]
    with connect(database) as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
            while cur.nextset():
                pass
    print(f"OK  {name} on {database} ({len(batches)} batch(es))")


def check() -> None:
    with connect(TENANT_DB) as conn:
        cur = conn.cursor()
        tables = ["AiFeatureQuery", "AnomalyRule", "AnomalyProbe", "AnomalyRun", "AnomalyRunReport", "AnomalyProposal", "AiFeatureJob"]
        missing = [t for t in tables if cur.execute("SELECT OBJECT_ID(?, 'U')", f"core.{t}").fetchone()[0] is None]
        cols = [c for c in ("slippage_settings_json", "dailyreport_settings_json", "anomaly_settings_json", "crew_settings_json",
                            "askdata_included_tables")
                if cur.execute("SELECT COL_LENGTH('core.AiSettings', ?)", c).fetchone()[0] is None]
        if cur.execute("SELECT COL_LENGTH('core.AiTraces', 'rejections_json')").fetchone()[0] is None:
            cols.append("AiTraces.rejections_json")
    with connect(CONTROL_DB) as conn:
        modules = conn.cursor().execute(
            "SELECT COUNT(*) FROM control.FeatureModule WHERE module_code IN "
            "('agentic-ai.features','agentic-ai.slippage','agentic-ai.daily-report','agentic-ai.data-anomaly','agentic-ai.crew-management')").fetchone()[0]
    print(f"Tenant tables missing: {missing or 'none'} | AiSettings columns missing: {cols or 'none'} | permission modules: {modules}/5")


if __name__ == "__main__":
    run_file("add-agentic-features.sql", TENANT_DB)
    run_file("add-agentic-features-permission.sql", CONTROL_DB)
    check()

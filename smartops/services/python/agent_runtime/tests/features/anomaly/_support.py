"""Offline fakes for the Data Anomaly tests: a small fake database (catalogue + probe results) and a scripted AI
provider. Nothing here reaches a database or a model.

* The database: app.features.anomaly.dbio.connect returns a FakeConn, and introspect.make_reader a FakeReader over
  the same FakeDb. The REAL guards still run (dbio.guard: SELECT-only gate + table allowlist) on every probe; the fake
  only answers. Probe SQL is answered by the rule id literal (SUMMARY) or an evidence column alias (DETAIL).
* The AI provider: app.features.common.llm.invoke is replaced, so the REAL llm.chat runs and records usage. Each
  agent is recognised by its system prompt (the seeded texts) and answered from a per-role script.
"""
from __future__ import annotations

import copy
import json
import re
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Callable, Iterator

from app.features.anomaly import FEATURE
from app.features.anomaly.config import parse, use
from app.features.anomaly.introspect import CatalogReader
from app.features.common.context import FeatureRun, run_context
from app.features.common.models import FeatureRequest
from tests.features import _seed

DB = {"server": "test-server", "name": "welldb", "user": "reader", "password": "not-a-secret"}
LLM = {"provider": "openai", "baseUrl": "https://example.invalid/v1", "model": "main-model", "fastModel": "fast-model"}
ACCESS = {"allowedSchemas": ["well", "ref", "dbo"], "excludedTables": ["dbo.sysdiagrams"], "excludedColumns": []}


def seed() -> dict[str, Any]:
    return _seed.feature_seed(FEATURE)


def seed_prompts() -> dict[str, str]:
    return _seed.prompts("anomaly.")


def seed_settings() -> dict[str, Any]:
    return copy.deepcopy(_seed.default_settings(FEATURE))


def body(*, prompts: dict | None = None, settings: dict | None = None, llm: Any = "default",
         access: dict | None = None, **fields: Any) -> dict[str, Any]:
    merged_settings = seed_settings()
    # One rule at a time unless a test asks otherwise: some scripted replies are consumed in call order.
    merged_settings["compileConcurrency"] = 1
    merged_settings.update(settings or {})
    merged_prompts = seed_prompts()
    merged_prompts.update(prompts or {})
    out = {"db": dict(DB), "llm": LLM if llm == "default" else llm, "prompts": merged_prompts,
           "settings": merged_settings, "access": copy.deepcopy(access or ACCESS)}
    out.update(fields)
    return out


@contextmanager
def feature_context(**overrides: Any) -> Iterator[FeatureRun]:
    """The request's run context plus its parsed settings, for calling the engine directly."""
    run = FeatureRun(FEATURE, FeatureRequest.model_validate(body(**overrides)))
    with run_context(run), use(parse(run.request.settings)):
        yield run


# ── The fake database ──

class FakeDb:
    """Catalogue rows (INFORMATION_SCHEMA / sys.* shaped) and probe answers."""

    def __init__(self) -> None:
        self.columns: list[tuple] = [
            # schema, table, column, type, max length, nullable
            ("well", "well_master", "well_id", "int", None, "NO"),
            ("well", "well_master", "well_name", "nvarchar", 100, "YES"),
            ("well", "well_master", "rig_on_date", "date", None, "YES"),
            ("well", "well_master", "rig_off_date", "date", None, "YES"),
            ("well", "well_master", "progress_pct", "decimal", None, "YES"),
            ("well", "well_master", "password_hash", "nvarchar", 64, "YES"),        # a secret: never shown
            ("well", "task_daily", "task_daily_id", "int", None, "NO"),
            ("well", "task_daily", "task_code", "nvarchar", 50, "YES"),
            ("well", "task_daily", "well_id", "int", None, "YES"),
            ("well", "task_daily", "start_date", "date", None, "YES"),
            ("well", "task_daily", "end_date", "date", None, "YES"),
            ("well", "task_crew", "crew_row_id", "int", None, "NO"),
            ("well", "task_crew", "task_daily_id", "int", None, "YES"),
            ("ref", "status_lookup", "status_code", "nvarchar", 10, "NO"),
            ("ref", "status_lookup", "status_name", "nvarchar", 50, "YES"),
            ("dbo", "sysdiagrams", "definition", "varbinary", -1, "YES"),           # excluded by access
        ]
        self.pks = [("well", "well_master", "well_id"), ("well", "task_daily", "task_daily_id"),
                    ("well", "task_crew", "crew_row_id")]
        self.fks = [("well", "task_daily", "well_id", "well", "well_master", "well_id"),
                    ("well", "task_crew", "task_daily_id", "well", "task_daily", "task_daily_id")]
        self.sizes = {("well", "well_master"): 120, ("well", "task_daily"): 600, ("well", "task_crew"): 300,
                      ("ref", "status_lookup"): 4, ("dbo", "sysdiagrams"): 1}
        self.lookup_values = [("DONE", "Done"), ("OPEN", "Open")]
        # One aggregate row per table: rows, then (min, max, avg, stdev, non-null) per numeric, (non-null, bad) per text.
        self.profiles = {
            ("well", "well_master"): {"well_id": (1, 120, 60.5, 34.8, 120), "progress_pct": (0, 1.4, 0.6, 0.2, 110),
                                      "well_name": (120, 120)},
            ("well", "task_daily"): {"task_daily_id": (1, 600, 300.5, 173.4, 600), "well_id": (1, 125, 60, 30, 600),
                                     "task_code": (600, 600)},
            ("well", "task_crew"): {"crew_row_id": (1, 300, 150.5, 86.7, 300), "task_daily_id": (1, 600, 300, 170, 300)},
            ("ref", "status_lookup"): {"status_code": (4, 4), "status_name": (4, 4)},
        }
        # SUMMARY answers by rule id (prefix match): (scope_total, anomaly_count). DETAIL answers by evidence alias.
        self.summaries: dict[str, tuple[int, int]] = {"DQ-T01": (600, 3), "DQ-T02": (120, 2), "DQ-G01": (600, 0)}
        self.details: dict[str, tuple[list[str], list[tuple]]] = {
            "evidence_start_date": (
                ["entity_key", "entity_label", "severity_value", "evidence_start_date", "evidence_end_date",
                 "explain_text"],
                [(101, "T-101", 9, "2026-05-10", "2026-05-01", "finished 9 day(s) before it started"),
                 (205, "T-205", 4, "2026-06-05", "2026-06-01", "finished 4 day(s) before it started"),
                 (333, "T-333", 1, "2026-07-02", "2026-07-01", "finished 1 day(s) before it started")]),
            "evidence_rig_on_date": (
                ["entity_key", "entity_label", "evidence_rig_on_date", "explain_text"],
                [(7, "Well 7", None, "no rig-on date"), (19, "Well 19", None, "no rig-on date")]),
            "evidence_missing_reference": (
                ["entity_key", "evidence_missing_reference", "explain_text"],
                [(44, 999, "names a parent that does not exist")]),
        }
        self.failing: set[str] = set()          # substrings: a probe containing one raises a driver error
        self.executed: list[str] = []
        self.connections = 0

    # ── what the catalogue reader sees ──
    def reader(self, conn: Any) -> "FakeReader":
        return FakeReader(self)

    def connect(self, timeout: int, read_uncommitted: bool = False) -> "FakeConn":
        self.connections += 1
        return FakeConn(self, timeout)

    def answer(self, sql: str) -> tuple[list[str], list[tuple]]:
        self.executed.append(sql)
        for marker in self.failing:
            if marker in sql:
                raise RuntimeError("[42S22] Invalid column name 'nope'.")
        m = re.search(r"'([^']+)'\s+AS\s+rule_id", sql, re.IGNORECASE)
        if m:
            rule_id = m.group(1)
            scope, count = next((v for k, v in self.summaries.items() if rule_id.startswith(k)), (10, 0))
            pct = round(100.0 * count / scope, 4) if scope else None
            return ["rule_id", "scope_total", "anomaly_count", "anomaly_pct"], [(rule_id, scope, count, pct)]
        for alias, (columns, rows) in self.details.items():
            if alias in sql:
                return columns, list(rows)
        raise AssertionError("the fake database was sent SQL it has no answer for:\n" + sql)


class FakeCursor:
    def __init__(self, db: FakeDb) -> None:
        self.db = db
        self.description = None
        self._rows: list[tuple] = []

    def execute(self, sql: str, *params: Any) -> None:
        columns, rows = self.db.answer(sql)
        self.description = [(c, None, None, None, None, None, True) for c in columns]
        self._rows = list(rows)

    def fetchmany(self, n: int) -> list[tuple]:
        out, self._rows = self._rows[:n], self._rows[n:]
        return out

    def fetchall(self) -> list[tuple]:
        out, self._rows = self._rows, []
        return out

    def close(self) -> None:
        pass


class FakeConn:
    def __init__(self, db: FakeDb, timeout: int) -> None:
        self.db = db
        self.timeout = timeout

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.db)

    def close(self) -> None:
        pass


class FakeReader(CatalogReader):
    """The catalogue as the fake database describes it (the real reader's SQL is not executed)."""

    def __init__(self, db: FakeDb) -> None:
        super().__init__(None)
        self.db = db

    def columns(self, schemas):
        return [c for c in self.db.columns if c[0].lower() in schemas]

    def structure_columns(self, schemas):
        return sorted(self.columns(schemas), key=lambda c: (c[0], c[1], c[2]))

    def primary_keys(self, schemas):
        return [p for p in self.db.pks if p[0] in schemas]

    def foreign_keys(self, schemas):
        return [f for f in self.db.fks if f[0] in schemas]

    def row_counts(self, schemas):
        return [(s, t, n) for (s, t), n in sorted(self.db.sizes.items()) if s in schemas]

    def key_signature(self, schemas):
        return [("PK", *p) for p in self.primary_keys(schemas)] + [("FK", *f) for f in self.foreign_keys(schemas)]

    def count_rows(self, schema, table):
        return self.db.sizes[(schema, table)]

    def count_distinct(self, schema, table, key, with_total):
        total = self.db.sizes[(schema, table)]
        return (total if with_total else None), total

    def distinct_values(self, schema, table, columns, limit):
        return self.db.lookup_values[:limit]

    def profile(self, schema, table, numeric, textish):
        stats = self.db.profiles.get((schema, table), {})
        row: list[Any] = [self.db.sizes[(schema, table)]]
        for c in numeric:
            row += list(stats.get(c, (None, None, None, None, 0)))
        for c in textish:
            row += list(stats.get(c, (0, 0)))
        return row


# ── The scripted AI provider ──

ROLES = (("ROLE: You are the Grounding agent", "grounding"), ("ROLE: You are the Anomaly SQL Author", "author"),
         ("ROLE: You are the Rule Verifier", "verifier"), ("ROLE: You are the Findings Summarizer", "summarizer"),
         ("ROLE: You are the Anomaly Scout", "scout"))


def role_of(system: str) -> str:
    return next((role for marker, role in ROLES if marker in system), "unknown")


def rule_id_of(user: str) -> str:
    m = re.search(r"^RULE (\S+) - ", user, re.MULTILINE)
    return m.group(1) if m else ""


def author_reply(system: str, user: str) -> str:
    """Correct SQL for the test rules (a family gets its {{token}} template)."""
    if "THIS QUERY IS WRITTEN ONCE AND REUSED" in user:
        return FAMILY_SQL
    rule_id = rule_id_of(user)
    if rule_id.startswith("DQ-T01"):
        return TASK_SQL.replace("<ID>", rule_id)
    return WELL_SQL.replace("<ID>", rule_id)


TASK_SQL = """Here are the queries.

```sql summary
WITH scoped AS (
    SELECT t.task_daily_id,
           CASE WHEN t.end_date < t.start_date THEN 1 ELSE 0 END AS is_anomaly
    FROM well.task_daily t
    WHERE t.start_date IS NOT NULL AND t.end_date IS NOT NULL
)
SELECT '<ID>' AS rule_id, COUNT(*) AS scope_total, SUM(is_anomaly) AS anomaly_count,
       CAST(100.0 * SUM(is_anomaly) / NULLIF(COUNT(*), 0) AS decimal(9,4)) AS anomaly_pct
FROM scoped
```

```sql detail
SELECT t.task_daily_id AS entity_key, t.task_code AS entity_label,
       DATEDIFF(day, t.end_date, t.start_date) AS severity_value,
       t.start_date AS evidence_start_date, t.end_date AS evidence_end_date,
       'finished before it started' AS explain_text
FROM well.task_daily t
WHERE t.end_date < t.start_date
ORDER BY severity_value DESC
```"""

WELL_SQL = """```sql summary
SELECT '<ID>' AS rule_id, COUNT(*) AS scope_total,
       SUM(CASE WHEN w.rig_on_date IS NULL THEN 1 ELSE 0 END) AS anomaly_count
FROM well.well_master w
```

```sql detail
SELECT w.well_id AS entity_key, w.well_name AS entity_label, w.rig_on_date AS evidence_rig_on_date,
       'no rig-on date' AS explain_text
FROM well.well_master w
WHERE w.rig_on_date IS NULL
ORDER BY w.well_id
```"""

FAMILY_SQL = """```sql summary
SELECT '{{rule_id}}' AS rule_id, COUNT(*) AS scope_total,
       SUM(CASE WHEN p.[{{parent_column}}] IS NULL THEN 1 ELSE 0 END) AS anomaly_count
FROM {{child_table}} c
LEFT JOIN {{parent_table}} p ON p.[{{parent_column}}] = c.[{{child_column}}]
WHERE c.[{{child_column}}] IS NOT NULL
```

```sql detail
SELECT c.[{{entity_column}}] AS entity_key, c.[{{child_column}}] AS evidence_missing_reference,
       'names a parent that does not exist' AS explain_text
FROM {{child_table}} c
LEFT JOIN {{parent_table}} p ON p.[{{parent_column}}] = c.[{{child_column}}]
WHERE c.[{{child_column}}] IS NOT NULL AND p.[{{parent_column}}] IS NULL
ORDER BY c.[{{entity_column}}]
```"""

def grounded(system: str, user: str) -> str:
    """Grounding names the tables each test rule concerns."""
    if rule_id_of(user).startswith("DQ-T01"):
        return json.dumps({"tables": ["well.task_daily"], "applicable": True, "reason": "",
                           "notes": "task dates live on task_daily"})
    return json.dumps({"tables": ["well.well_master"], "applicable": True, "reason": "", "notes": "the well master"})
APPROVED = json.dumps({"ok": True, "not_applicable": False, "reason": "", "feedback": "", "threshold_note": "",
                       "note": "detects the rule as written"})
SUMMARY = "The data is mostly sound.\n- **3** tasks finished before they started."


class FakeLlm:
    """Answers per role: a string, a list (consumed in order, the last repeats) or callable(system, user)."""

    def __init__(self) -> None:
        self.script: dict[str, Any] = {"grounding": grounded, "author": author_reply, "verifier": APPROVED,
                                       "summarizer": SUMMARY, "scout": json.dumps({"proposals": []})}
        self.calls: list[SimpleNamespace] = []
        self.failing: set[str] = set()

    def count(self, role: str) -> int:
        return sum(1 for c in self.calls if c.role == role)

    def of(self, role: str) -> list[SimpleNamespace]:
        return [c for c in self.calls if c.role == role]

    def invoke(self, llm, messages, temperature, fast=False, effort="", verbosity="", max_tokens=None,
               json_mode=False):
        system, user = messages[0][1], messages[1][1]
        role = role_of(system)
        self.calls.append(SimpleNamespace(role=role, system=system, user=user, temperature=temperature, fast=fast,
                                          json_mode=json_mode))
        if role in self.failing:
            raise RuntimeError("the provider said no (test)")
        answer = self.script.get(role, "")
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if callable(answer):
            answer = answer(system, user)
        model = llm.fast_model if fast and llm.fast_model else llm.model
        return model, SimpleNamespace(content=answer, usage_metadata={"input_tokens": 100, "output_tokens": 10})


# ── Rules used across the tests ──

def rule(rule_id: str, title: str, **fields: Any) -> dict[str, Any]:
    out = {"ruleId": rule_id, "title": title, "category": "Task execution", "severity": "high", "entity": "task",
           "body": "Wrong: x.\nMatters: y.\nDetect: z.\nNever flag: nothing."}
    out.update(fields)
    return out


def sample_rules() -> list[dict[str, Any]]:
    return [
        rule("DQ-T01", "Task finished before it started", tags=["task", "dates"],
             body="Wrong: A task's finish date is before its start date.\nMatters: Durations go negative.\n"
                  "Detect: Compare each task's start and finish dates.\nNever flag: tasks with either date missing."),
        rule("DQ-T02", "Well has no rig-on date", severity="medium", entity="well", status="probation",
             source="discovered", discovery={"evidence": "OBS-001", "discoveredFrom": "welldb",
                                             "decided": "2026-10-01"}),
        rule("DQ-G01", "Reference points at nothing", category="Reference integrity", expandsOver="foreign_key"),
        rule("DQ-X01", "A draft nobody finished", status="draft"),
        rule("DQ-R01", "Rigs moved on public holidays", status="rejected", source="discovered",
             discovery={"reason": "crew codes are free text by design"}),
    ]


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        name, data = "", ""
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                data += line[len("data: "):]
        if name:
            events.append((name, json.loads(data) if data else {}))
    return events


def only(events: list[tuple[str, dict]], name: str) -> list[dict]:
    return [d for n, d in events if n == name]


Responder = Callable[[str, str], str]

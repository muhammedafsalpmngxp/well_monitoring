"""Offline fixtures for the Daily Report tests: no database, no AI provider, no network.

* The tenant's prompts, settings, access and verified SQL come from the seed (tests/features/_seed.py; during
  development AGENTIC_FRAGMENTS=<dir> supplies the not-yet-merged fragments).
* ``fake_db`` replaces app.features.common.db.query: it still runs the real SELECT-only gate and table allowlist on
  the tenant's SQL, then answers from rows the test gives per capability (DAILY_DETAILS, WELL_ACTIVITY, ...).
* ``fake_model`` replaces app.features.common.llm.chat: answers per agent role (planner / writer / day_writer /
  verifier) from queues, records every call, and records usage as the real one does.
"""
from __future__ import annotations

import copy
from contextlib import contextmanager
from datetime import date
from typing import Any, Callable, Dict, Iterator, List, Optional

import pytest

from app.features.common import db as common_db
from app.features.common import llm as common_llm
from app.features.common.context import FeatureRun, current, run_context
from app.features.common.db import DatabaseUnavailable, QueryResult
from app.features.common.models import FeatureRequest
from app.features.dailyreport import data
from app.features.dailyreport.context import FEATURE, ReportContext
from tests.features import _seed

REPORT_DATE = date(2026, 8, 1)
TODAY = date(2026, 8, 3)

DB = {"server": "test-server", "name": "testdb", "user": "reader", "password": "not-a-secret"}
LLM = {"provider": "openai", "baseUrl": "https://example.invalid/v1", "model": "writer-model",
       "fastModel": "fast-model"}


def seed_prompts() -> Dict[str, str]:
    return _seed.prompts("dailyreport.")


def seed_settings() -> Dict[str, Any]:
    return _seed.default_settings("dailyreport")


def seed_queries() -> Dict[str, Dict[str, Any]]:
    return _seed.queries("dailyreport")


def seed_access() -> Dict[str, Any]:
    return _seed.feature_seed("dailyreport")["access"]


@pytest.fixture(autouse=True)
def _seed_present():
    if not seed_queries() or not seed_prompts() or not seed_settings():
        pytest.skip("The Daily Report seed was not found: merge it into the Tenant API seed files or set "
                    "AGENTIC_FRAGMENTS=<fragments dir>.")


@pytest.fixture(autouse=True)
def _clean_caches():
    data.ROW_CACHE.clear()
    data.ANSWER_CACHE.clear()
    yield
    data.ROW_CACHE.clear()
    data.ANSWER_CACHE.clear()


def body(*, prompts: Optional[Dict[str, str]] = None, settings: Optional[Dict[str, Any]] = None,
         llm: Any = "default", db: Optional[Dict[str, Any]] = None, queries: Optional[Dict[str, Any]] = None,
         **fields: Any) -> Dict[str, Any]:
    """A request body as the Tenant API sends it (camelCase), seed values unless overridden."""
    merged_settings = seed_settings()
    merged_settings.update(settings or {})
    merged_prompts = seed_prompts()
    merged_prompts.update(prompts or {})
    out = {
        "db": dict(db or DB),
        "llm": LLM if llm == "default" else llm,
        "prompts": merged_prompts,
        "settings": merged_settings,
        "access": copy.deepcopy(seed_access()),
        "queries": queries if queries is not None else seed_queries(),
    }
    out.update(fields)
    return out


@contextmanager
def report_context(**overrides: Any) -> Iterator[ReportContext]:
    """A ReportContext for service-level tests, inside the request's run context."""
    request = FeatureRequest.model_validate(body(**overrides))
    run = FeatureRun(FEATURE, request)
    with run_context(run):
        yield ReportContext(run)


def make_row(**overrides: Any) -> Dict[str, Any]:
    """A resolved daily row with the keys the DAILY_DETAILS query returns."""
    row: Dict[str, Any] = {
        "task_daily_id": 1, "well_id": 31474, "action_on": REPORT_DATE, "schedule_id": 359,
        "task_code": "FLME1180-31474", "activity_id": "FLME1180", "activity_code": "FL-ME-ML08-03",
        "activity_description": "Pipe Stringing, Alignment, Fitup and Welding",
        "wbs": "Straightline Welding incl. supports", "crew_code": "MWS0602", "uom_id": 3, "uom_code": "Joint",
        "activity_uom": "Joint", "crew_id": 10570, "crew_type_id": 1, "crew_type_name": "Welding Crew",
        "crew_type_code": "MWS0602", "crew_instance_code": "W-01", "crew_supervisor": "Ali",
        "crew_employee_names": "Ali, Omar", "planned_start": REPORT_DATE, "planned_end": REPORT_DATE,
        "actual_start": REPORT_DATE, "actual_end": REPORT_DATE, "planned": 15, "progress": 0,
        "actual_quantity": 15, "actual_quantity_raw": "15", "daily_completed": False, "ph_name": "Ammar",
        "is_actual_entry": 1, "daily_data_json_valid": 1, "daily_data_json_invalid": 0,
        "actual_quantity_unparseable": 0, "group_row_count": 1, "group_actual_entry_count": 1,
    }
    row.update(overrides)
    return row


def activity_row(**overrides: Any) -> Dict[str, Any]:
    """A WELL_ACTIVITY row: 10 tasks, 6 completed, 4 open = 2 incomplete (1 not started + 1 ended) + 2 ongoing."""
    row: Dict[str, Any] = {
        "well_id": 31474, "logical_task_count": 10, "completed_task_count": 6, "open_task_count": 4,
        "incomplete_task_count": 2, "ongoing_task_count": 2, "not_started_task_count": 1,
        "ended_not_completed_task_count": 1, "last_task_date": date(2026, 7, 30),
    }
    row.update(overrides)
    return row


def detail_row(**overrides: Any) -> Dict[str, Any]:
    """A WELL_DETAIL row."""
    row: Dict[str, Any] = {
        "well_id": 31474, "schedule_id": 359, "task_code": "FLME1180-31474", "task_state": "ONGOING",
        "latest_action_on": date(2026, 7, 30), "actual_start": date(2026, 7, 20), "actual_end": None,
        "completed": False, "activity_id": "FLME1180", "activity_code": "FL-ME-ML08-03",
        "activity_description": "Pipe Stringing, Alignment, Fitup and Welding",
        "wbs": "Straightline Welding incl. supports",
    }
    row.update(overrides)
    return row


class FakeDb:
    """Stands in for app.features.common.db.query: the real gate first, then the test's rows per capability."""

    def __init__(self) -> None:
        self.rows: Dict[str, Any] = {}
        self.calls: List[tuple] = []
        self.failing: set = set()
        self.columns_override: Dict[str, List[str]] = {}
        self._guard = common_db.guard

    def set(self, key: str, rows: Any) -> None:
        """``rows``: a list, or a callable(params) -> list."""
        self.rows[key] = rows

    def count(self, key: str) -> int:
        return sum(1 for label, _ in self.calls if label == key)

    def __call__(self, sql, params=(), *, feature_title, label="query", max_rows=None, timeout=60, conn=None,
                 **conn_kwargs) -> QueryResult:
        self._guard(sql, feature_title)                 # the real SELECT-only gate and table allowlist
        self.calls.append((label, list(params)))
        if label in self.failing:
            raise DatabaseUnavailable(f"The query '{label}' failed.")
        source = self.rows.get(label, [])
        rows = [dict(r) for r in (source(list(params)) if callable(source) else source)]
        contract = list(current().request.queries[label].columns)
        if label in self.columns_override:
            columns = list(self.columns_override[label])
        else:
            columns = contract + [c for r in rows for c in r if c not in contract]
            columns = list(dict.fromkeys(columns))
        rows = [{c: r.get(c) for c in columns} for r in rows]
        return QueryResult(columns, rows, False)


@pytest.fixture
def fake_db(monkeypatch) -> FakeDb:
    fake = FakeDb()
    monkeypatch.setattr(common_db, "query", fake)
    return fake


class FakeModel:
    """Answers each agent role from its own queue (the last answer repeats); day_writer shares writer's queue."""

    def __init__(self) -> None:
        self.answers: Dict[str, List[str]] = {"planner": [], "writer": [], "verifier": []}
        self.calls: List[Dict[str, Any]] = []
        self.failing: set = set()

    @staticmethod
    def queue_of(agent: str) -> str:
        return "writer" if agent in ("writer", "day_writer") else agent

    def __call__(self, system: str, user: str, *, agent: str, temperature: Optional[float] = 0.0, fast: bool = False,
                 effort: str = "", verbosity: str = "", max_tokens: Optional[int] = None,
                 json_mode: bool = False) -> str:
        run = current()
        if run.request.llm is None:
            raise common_llm.AiUnavailable("No AI provider is active for this tenant.")
        self.calls.append({"agent": agent, "system": system, "user": user, "fast": fast, "max_tokens": max_tokens,
                           "json_mode": json_mode, "temperature": temperature})
        if agent in self.failing:
            raise RuntimeError("provider said no (test)")
        queue = self.answers[self.queue_of(agent)]
        text = queue.pop(0) if len(queue) > 1 else (queue[0] if queue else "")
        model = (run.request.llm.fast_model or run.request.llm.model) if fast else run.request.llm.model
        run.usage.append({"agent": f"{run.feature}.{agent}", "model": model, "calls": 1, "input": 10, "output": 5})
        return text

    def count(self, agent: str) -> int:
        return sum(1 for call in self.calls if call["agent"] == agent)


@pytest.fixture
def fake_model(monkeypatch) -> FakeModel:
    fake = FakeModel()
    monkeypatch.setattr(common_llm, "chat", fake)
    return fake


def rows_for_date(rows_by_date: Dict[date, List[Dict[str, Any]]]) -> Callable[[list], list]:
    """A row source keyed by the bound report date (the first parameter)."""
    return lambda params: rows_by_date.get(params[0], [])

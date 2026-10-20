"""Offline fakes for the Slippage tests: no database, no AI provider is ever reached.

* The database: app.features.common.db.connection is replaced by a fake connection, so the REAL db.query still runs
  (SELECT-only gate, table allowlist, max_rows / truncated) and only the execution is faked. The fake knows each
  verified query by its SQL text and returns the sample rows in _support.
* The AI provider: app.features.common.llm.invoke is replaced, so the REAL llm.chat still runs and records usage.
"""
from __future__ import annotations

import contextlib
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.common import db as common_db
from app.features.common import llm as common_llm
from app.features.common.context import FeatureRun, run_context
from app.features.common.models import FeatureRequest
from app.features.slippage import advisor, settings
from app.features.slippage.api import router
from tests.features.slippage import _support as S


def _norm(sql: str) -> str:
    return sql.strip().rstrip(";").strip()


class FakeCursor:
    def __init__(self, db: "FakeDb"):
        self.db = db
        self.description = None
        self._rows: list[tuple] = []

    def execute(self, sql: str, *params: Any) -> None:
        key = self.db.key_of(sql)
        self.db.calls.append((key, list(params)))
        if key == "activity_delay":
            columns = S.ACTIVITY_COLUMNS
            rows = self.db.activity.get(params[0], [])
        else:
            columns, rows = self.db.results[key]
        columns = self.db.columns_override.get(key, columns)
        self.description = [(c, None, None, None, None, None, True) for c in columns]
        self._rows = [tuple(r.get(c) for c in columns) for r in rows]

    def fetchmany(self, n: int) -> list[tuple]:
        return self._rows[:n]

    def fetchall(self) -> list[tuple]:
        return list(self._rows)

    def close(self) -> None:
        pass


class FakeDb:
    def __init__(self) -> None:
        self.sql_keys = {_norm(q["sql"]): k for k, q in S.SEED_QUERIES.items()}
        self.results: dict[str, tuple[list[str], list[dict]]] = {
            "well_slippage": (S.WELL_COLUMNS, S.well_rows()),
            "activity_summary": (S.SUMMARY_COLUMNS, S.summary_rows()),
            "crew_availability": (S.CREW_COLUMNS, S.crews()),
        }
        self.activity: dict[str, list[dict]] = {S.WELL: S.tasks(), S.OTHER_WELL: S.tasks()[:2]}
        self.columns_override: dict[str, list[str]] = {}
        self.calls: list[tuple[str, list]] = []
        self.unavailable = False

    def key_of(self, sql: str) -> str:
        key = self.sql_keys.get(_norm(sql))
        assert key, "the fake database was sent SQL that is not a seeded Slippage query"
        return key

    def keys_called(self) -> list[str]:
        return [k for k, _ in self.calls]

    @contextlib.contextmanager
    def connection(self, **kwargs: Any):
        if self.unavailable:
            raise common_db.DatabaseUnavailable("The database could not be reached. Check the Ask Data database "
                                                "connection of the Tenant API and network access.")
        yield SimpleNamespace(cursor=lambda: FakeCursor(self))


class FakeLlm:
    """The AI provider. `reply` is a string or reply(system, user); `before` runs before replying (to block)."""

    def __init__(self) -> None:
        self.calls: list[SimpleNamespace] = []
        self.reply: Any = lambda system, user: S.TASK_REPLY if "THE TASK IN QUESTION" in user else S.WELL_REPLY
        self.error: BaseException | None = None
        self.before: Any = None

    def invoke(self, llm, messages, temperature, fast=False, effort="", verbosity="", max_tokens=None,
               json_mode=False):
        system, user = messages[0][1], messages[1][1]
        self.calls.append(SimpleNamespace(system=system, user=user, temperature=temperature, effort=effort,
                                          verbosity=verbosity, fast=fast, json_mode=json_mode, model=llm.model))
        if self.before:
            self.before()
        if self.error:
            raise self.error
        reply = self.reply(system, user) if callable(self.reply) else self.reply
        return "fake-model", SimpleNamespace(content=reply, usage_metadata={"input_tokens": 100, "output_tokens": 20})


@pytest.fixture(autouse=True)
def fake_db(monkeypatch) -> FakeDb:
    fake = FakeDb()
    monkeypatch.setattr(common_db, "connection", fake.connection)
    return fake


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch) -> FakeLlm:
    fake = FakeLlm()
    monkeypatch.setattr(common_llm, "invoke", fake.invoke)
    return fake


@pytest.fixture(autouse=True)
def _fresh_advice_store():
    advisor.clear()
    advisor._inflight.clear()
    yield
    advisor.clear()
    advisor._inflight.clear()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/slippage")
    return TestClient(app)


@pytest.fixture
def body() -> dict[str, Any]:
    return S.make_body()


@contextlib.contextmanager
def feature_context(body: dict[str, Any]):
    """A Slippage request context for calling the package directly: yields (run, settings)."""
    run = FeatureRun("slippage", FeatureRequest.model_validate(body))
    with run_context(run):
        yield run, settings.load(body["settings"])


@pytest.fixture
def ctx():
    return feature_context

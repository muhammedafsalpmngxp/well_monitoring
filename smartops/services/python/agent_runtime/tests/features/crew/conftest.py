"""Offline fakes for the Crew Management tests: the REAL db.query runs (SELECT-only gate, table allowlist, column
contract) against a fake connection that knows each seeded query by its SQL; the REAL llm.chat runs against a fake
provider."""
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
from app.features.crew import queries, settings
from app.features.crew.api import router
from tests.features.crew import _support as S


def _norm(sql: str) -> str:
    return sql.strip().rstrip(";").strip()


class FakeCursor:
    def __init__(self, db: "FakeDb"):
        self.db = db
        self.description = None
        self._rows: list[tuple] = []

    def execute(self, sql: str, *params: Any) -> None:
        key = self.db.sql_keys.get(_norm(sql))
        assert key, "the fake database was sent SQL that is not a seeded Crew Management query"
        self.db.calls.append((key, list(params)))
        rows = self.db.rows[key](params) if callable(self.db.rows[key]) else self.db.rows[key]
        columns = S.SEED_QUERIES[key]["columns"]
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
        self.rows: dict[str, Any] = {
            queries.WELLS: S.wells(),
            queries.WELL: lambda p: [S.well_row()] if str(p[0]) == S.WELL else [],
            queries.DELAYED: lambda p: S.delayed() if str(p[0]) == S.WELL else [],
            queries.BOARD: S.board(),
            queries.DEMAND: S.demand(),
            queries.EXPERIENCE: S.experience(),
        }
        self.calls: list[tuple[str, list]] = []

    def keys_called(self) -> list[str]:
        return [k for k, _ in self.calls]

    @contextlib.contextmanager
    def connection(self, **kwargs: Any):
        yield SimpleNamespace(cursor=lambda: FakeCursor(self))


class FakeLlm:
    def __init__(self) -> None:
        self.calls: list[SimpleNamespace] = []
        self.reply: Any = "**Well 35552 - Crew Suggestion**\n\nAssign **Crew 203** to the welding activity."
        self.error: BaseException | None = None

    def invoke(self, llm, messages, temperature, fast=False, effort="", verbosity="", max_tokens=None,
               json_mode=False):
        self.calls.append(SimpleNamespace(system=messages[0][1], user=messages[1][1], temperature=temperature,
                                          effort=effort, max_tokens=max_tokens))
        if self.error:
            raise self.error
        return "fake-model", SimpleNamespace(content=self.reply, usage_metadata={"input_tokens": 100,
                                                                                 "output_tokens": 20})


@pytest.fixture(autouse=True)
def fake_db(monkeypatch) -> FakeDb:
    fake = FakeDb()
    monkeypatch.setattr(common_db, "connection", fake.connection)
    queries.clear()
    yield fake
    queries.clear()


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch) -> FakeLlm:
    fake = FakeLlm()
    monkeypatch.setattr(common_llm, "invoke", fake.invoke)
    return fake


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/crew")
    return TestClient(app)


@pytest.fixture
def body() -> dict[str, Any]:
    return S.make_body()


@contextlib.contextmanager
def feature_context(body: dict[str, Any]):
    run = FeatureRun("crew", FeatureRequest.model_validate(body))
    with run_context(run):
        yield run, settings.load(body["settings"])


@pytest.fixture
def ctx():
    return feature_context

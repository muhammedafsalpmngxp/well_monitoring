"""Offline fixtures for the Data Anomaly tests (see _support): the seed (AGENTIC_FRAGMENTS=<dir> during development),
a fake database behind dbio / the catalogue reader, a scripted AI provider behind llm.invoke, and a private cache
directory per test."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.askdata import settings as askdata_settings
from app.features.anomaly import dbio, introspect
from app.features.anomaly.api import router
from app.features.common import llm as common_llm
from tests.features.anomaly import _support as S

PREFIX = "/api/agent-runtime/features/anomaly"


@pytest.fixture(autouse=True)
def _seed_present():
    if not S.seed_prompts() or not S.seed_settings():
        pytest.skip("The Data Anomaly seed was not found: merge it into the Tenant API seed or set "
                    "AGENTIC_FRAGMENTS=<fragments dir>.")


@pytest.fixture(autouse=True)
def _private_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(askdata_settings, "CACHE_ROOT", tmp_path / "cache")


@pytest.fixture(autouse=True)
def fake_db(monkeypatch) -> S.FakeDb:
    fake = S.FakeDb()
    monkeypatch.setattr(dbio, "connect", fake.connect)
    monkeypatch.setattr(introspect, "make_reader", fake.reader)
    return fake


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch) -> S.FakeLlm:
    fake = S.FakeLlm()
    monkeypatch.setattr(common_llm, "invoke", fake.invoke)
    return fake


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix=PREFIX)
    return TestClient(app)


@pytest.fixture
def ctx():
    return S.feature_context

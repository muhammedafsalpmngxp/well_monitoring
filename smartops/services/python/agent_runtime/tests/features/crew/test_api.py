"""The Crew Management endpoints: status codes, the brief and its reference check."""
from __future__ import annotations

import pytest

from tests.features.crew import _support as S

pytestmark = S.requires_seed


def test_overview(client, body):
    r = client.post("/crew/overview", json=body)
    assert r.status_code == 200
    assert {"kpis", "crew_types", "crews", "wells", "rules"} <= set(r.json())


def test_well_plan_and_errors(client, body):
    assert client.post("/crew/well", json={**body, "wellId": S.WELL}).json()["summary"]["delayed_activities"] == 4
    assert client.post("/crew/well", json={**body, "wellId": "999"}).status_code == 404
    assert client.post("/crew/well", json={**body, "wellId": "12; DROP"}).status_code == 400
    assert client.post("/crew/well", json={**body, "wellId": S.WELL, "settings": {}}).status_code == 400


def test_brief_narrates_the_plan_and_flags_unknown_references(client, body, fake_llm):
    fake_llm.reply = "Assign **Crew 203**. Also Crew 999 and code X-Y-9 are mentioned."
    r = client.post("/crew/brief", json={**body, "wellId": S.WELL})
    data = r.json()
    assert r.status_code == 200 and data["brief"].startswith("Assign **Crew 203**")
    assert data["unverified_references"] == ["crew 999", "X-Y-9"]
    assert data["usage"][0]["agent"] == "crew.brief" and data["plan"]["well_id"] == int(S.WELL)
    call = fake_llm.calls[0]
    assert "<crew_rules>" in call.system and "# TASK" in call.system and "{RULES}" not in call.system
    assert call.user.startswith("Crew suggestion evidence:") and '"task_code"' not in call.user


def test_a_provider_failure_keeps_the_plan(client, body, fake_llm):
    fake_llm.error = RuntimeError("timeout")
    data = client.post("/crew/brief", json={**body, "wellId": S.WELL}).json()
    assert data["brief"] is None and "could not write the brief" in data["brief_error"]
    assert data["plan"]["activities"]


def test_no_ai_provider_is_503(client, body):
    assert client.post("/crew/brief", json={**body, "wellId": S.WELL, "llm": None}).status_code == 503


@pytest.mark.parametrize("missing", ["crew.rules", "crew.brief_system"])
def test_a_missing_prompt_is_named(client, body, missing):
    del body["prompts"][missing]
    r = client.post("/crew/brief", json={**body, "wellId": S.WELL})
    assert r.status_code == 400 and missing in r.json()["detail"]

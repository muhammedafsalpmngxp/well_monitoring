"""POST /query: the four verified queries, well id binding, column contract, access and read-only refusals."""
from __future__ import annotations

import pytest

from app.features.slippage.queries import placeholders
from tests.features.slippage import _support as S

pytestmark = S.requires_seed


def test_fleet_query_returns_json_safe_records(client, body, fake_db):
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["key"] == "well_slippage"
    assert data["columns"] == S.WELL_COLUMNS
    assert data["truncated"] is False
    first = data["rows"][0]
    assert first["well_id"] == 35552
    assert first["flaf_deadline"] == "2026-01-01"            # dates as ISO text
    assert first["rig_on_variance_days"] == 202.0            # Decimal as a number
    assert fake_db.calls == [("well_slippage", [])]


@pytest.mark.parametrize("key", ["activity_summary", "crew_availability"])
def test_other_fleet_queries(client, body, key):
    r = client.post("/slippage/query", json={**body, "key": key})
    assert r.status_code == 200, r.text
    assert r.json()["columns"] == S.SEED_QUERIES[key]["columns"]


def test_fleet_query_ignores_a_well_id(client, body, fake_db):
    r = client.post("/slippage/query", json={**body, "key": "activity_summary", "wellId": S.WELL})
    assert r.status_code == 200
    assert fake_db.calls == [("activity_summary", [])]


def test_activity_delay_binds_the_trimmed_well_id(client, body, fake_db):
    r = client.post("/slippage/query", json={**body, "key": "activity_delay", "wellId": f"  {S.WELL} "})
    assert r.status_code == 200, r.text
    assert fake_db.calls == [("activity_delay", [S.WELL])]
    rows = r.json()["rows"]
    assert [t["task_code"] for t in rows][:2] == ["FLME1180-3035", "A-2"]
    assert rows[0]["progress_percent"] == 50.0
    assert rows[0]["action_on"] == "2026-10-01T08:30:00"


def test_activity_delay_accepts_a_numeric_well_id(client, body, fake_db):
    r = client.post("/slippage/query", json={**body, "key": "activity_delay", "wellId": int(S.WELL)})
    assert r.status_code == 200
    assert fake_db.calls == [("activity_delay", [S.WELL])]


@pytest.mark.parametrize("well_id", [None, "", "   ", "x" * 51])
def test_activity_delay_rejects_a_missing_or_long_well_id(client, body, fake_db, well_id):
    payload = {**body, "key": "activity_delay"}
    if well_id is not None:
        payload["wellId"] = well_id
    r = client.post("/slippage/query", json=payload)
    assert r.status_code == 400
    assert "well" in r.json()["detail"].lower()
    assert fake_db.calls == []


def test_well_id_length_comes_from_the_settings(client, body, fake_db):
    body["settings"]["wellIdMaxLength"] = 3
    r = client.post("/slippage/query", json={**body, "key": "activity_delay", "wellId": S.WELL})
    assert r.status_code == 400 and r.json()["detail"] == "Invalid well id."
    assert fake_db.calls == []


def test_unknown_key_is_400(client, body):
    r = client.post("/slippage/query", json={**body, "key": "drop_tables"})
    assert r.status_code == 400
    assert "well_slippage" in r.json()["detail"]


def test_query_not_configured_is_400(client, body):
    del body["queries"]["crew_availability"]
    r = client.post("/slippage/query", json={**body, "key": "crew_availability"})
    assert r.status_code == 400
    assert "'crew_availability' is not configured" in r.json()["detail"]


def test_row_limit_comes_from_the_settings(client, body):
    body["settings"]["queryMaxRows"] = 3
    r = client.post("/slippage/query", json={**body, "key": "crew_availability"})
    data = r.json()
    assert len(data["rows"]) == 3 and data["truncated"] is True


def test_column_contract_names_the_missing_columns(client, body, fake_db):
    fake_db.columns_override["well_slippage"] = [c for c in S.WELL_COLUMNS
                                                 if c not in ("well_slippage_status", "flaf_status")]
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "flaf_status" in detail and "well_slippage_status" in detail
    assert "SELECT" not in detail                       # no SQL text in a message


def test_empty_column_contract_is_not_checked(client, body, fake_db):
    body["queries"]["well_slippage"]["columns"] = []
    fake_db.columns_override["well_slippage"] = ["well_id"]
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 200 and r.json()["columns"] == ["well_id"]


def test_table_not_allowed_is_refused_before_running(client, body, fake_db):
    body["access"]["includedTables"] = [t for t in body["access"]["includedTables"] if t != "dbo.mapping_master"]
    r = client.post("/slippage/query", json={**body, "key": "activity_summary"})
    assert r.status_code == 400
    assert "dbo.mapping_master" in r.json()["detail"]
    assert fake_db.calls == []


def test_feature_without_access_set_up_is_refused(client, body, fake_db):
    body["access"] = {}
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 400 and "not set up" in r.json()["detail"]
    assert fake_db.calls == []


def test_a_write_statement_is_refused(client, body, fake_db):
    body["queries"]["well_slippage"]["sql"] = "DELETE FROM well.well_master"
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 400
    assert "read-only" in r.json()["detail"]
    assert fake_db.calls == []


def test_activity_delay_must_bind_the_well(client, body, fake_db):
    body["queries"]["activity_delay"]["params"] = []
    r = client.post("/slippage/query", json={**body, "key": "activity_delay", "wellId": S.WELL})
    assert r.status_code == 400 and "does not bind the well id" in r.json()["detail"]
    assert fake_db.calls == []


def test_parameter_count_must_match_the_sql(client, body, fake_db):
    body["queries"]["well_slippage"]["params"] = ["well_id"]          # declared, but the SQL binds none
    r = client.post("/slippage/query", json={**body, "key": "well_slippage", "wellId": S.WELL})
    assert r.status_code == 400 and "binds 0" in r.json()["detail"]
    assert fake_db.calls == []


def test_unknown_parameter_name_is_400(client, body):
    body["queries"]["activity_delay"]["params"] = ["well_id", "project_id"]
    r = client.post("/slippage/query", json={**body, "key": "activity_delay", "wellId": S.WELL})
    assert r.status_code == 400 and "'project_id'" in r.json()["detail"]


def test_placeholders_ignore_literals_comments_and_quoted_names():
    sql = "SELECT '?' AS a, [b?] AS b /* ? */ FROM t -- ?\nWHERE x = ? AND y = 'it''s?'"
    assert placeholders(sql) == 1


def test_database_unavailable_is_503(client, body, fake_db):
    fake_db.unavailable = True
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 503
    assert "could not be reached" in r.json()["detail"]


def test_missing_setting_is_400_naming_it(client, body):
    del body["settings"]["queryMaxRows"]
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 400
    assert "'queryMaxRows' is missing" in r.json()["detail"]


def test_invalid_setting_is_400_naming_it(client, body):
    body["settings"]["milestones"] = ["flaf|FLAF issued"]
    r = client.post("/slippage/query", json={**body, "key": "well_slippage"})
    assert r.status_code == 400
    assert "'milestones'" in r.json()["detail"]

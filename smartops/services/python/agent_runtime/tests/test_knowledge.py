"""Business terms and column names (tools/knowledge.py) and suggested questions (tools/suggest.py) for Ask Data."""
from fastapi.testclient import TestClient

from app.askdata import runner
from app.askdata.settings import AskDataRun, AskDataSettings, ColumnNote, DbTarget, Term, run_context
from app.askdata.tools import knowledge, suggest
from app.models import AskDataTenantSettings
from tests.seeded_prompts import runtime_texts

TERMS = (Term("NPT", ("non-productive time",), meaning="downtime_hours where category = 'Non-productive'"),
         Term("dry well", (), "well.well_master.cluster", "Dry"))
SCHEMA = "TABLE well.well_master\n  - well_id int\n  - bl_flaf_scr float\n\nTABLE ref.crew\n  - code varchar(30)"


def _run():
    return run_context(AskDataRun(settings=AskDataSettings(), db=DbTarget(server="s", name="n", user="u", password="p"),
                                  texts=runtime_texts()))


def test_only_the_terms_a_question_uses_are_sent():
    assert [t.term for t in knowledge.used_terms("NPT of dry wells last week", TERMS)] == ["NPT", "dry well"]
    assert knowledge.used_terms("non-productive time per crew", TERMS)[0].term == "NPT"      # a synonym
    assert knowledge.used_terms("input of wells", TERMS) == []                               # "input" is not "NPT"
    with _run():
        block = knowledge.terms_block("NPT of dry wells", TERMS)
        assert knowledge.terms_block("wells per cluster", TERMS) == ""
    assert "\"NPT\" means: downtime_hours where category = 'Non-productive'" in block
    assert "\"dry well\" means well.well_master.cluster = 'Dry'" in block


def test_column_names_and_notes_are_added_to_the_schema_without_changing_table_lines():
    notes = (ColumnNote("well.well_master.bl_flaf_scr", "FLAF Score", "0-100, higher is better"),
             ColumnNote("ref.crew", "", "one row per crew"))
    with _run():
        out = knowledge.annotate(SCHEMA, notes).split("\n")
    assert out[0] == "TABLE well.well_master"                                   # the safety check reads this line
    assert out[2] == '  - bl_flaf_scr float | called "FLAF Score" | 0-100, higher is better'
    assert out[4:6] == ["TABLE ref.crew", "  NOTE: one row per crew"]
    assert knowledge.known_words("FLAF score of dry wells", TERMS, notes) >= {"flaf", "score", "dry", "well"}


def test_tenant_terms_and_notes_reach_the_run_settings():
    s = runner.settings_for(None, AskDataTenantSettings(
        allowed_schemas=["well"], terms=[{"term": " NPT ", "synonyms": ["downtime", " "], "meaning": "x"}],
        notes=[{"column": "Well.Well_Master.BL_FLAF_SCR", "displayName": "FLAF Score"}]))
    assert s.terms == (Term("NPT", ("downtime",), "", "", "x"),)
    assert s.notes == (ColumnNote("well.well_master.bl_flaf_scr", "FLAF Score", ""),)


PROFILES = {
    "well.well_master": {
        "well_id": {"kind": "number", "rows": 841, "empty": 0, "table_rows": 841, "distinct": 841},
        "lift_type": {"kind": "text", "rows": 841, "empty": 290, "table_rows": 841, "distinct": 3,
                      "values": [["PCP", 294], ["WI", 99], ["ESP", 53]]},
        "spud_date": {"kind": "date", "rows": 841, "empty": 10, "table_rows": 841, "min": "2019-01-03", "max": "2026-10-15"},
    },
    "ref.cluster": {"cluster_name": {"kind": "text", "rows": 2, "empty": 0, "table_rows": 2, "distinct": 2,
                                     "values": [["Nimr", 1], ["Marmul", 1]]}},
    "dbo.vw_wells": {"cluster": {"kind": "text", "rows": 841, "empty": 0, "table_rows": None, "distinct": 2,
                                 "values": [["Marmul", 448], ["Nimr", 393]]}},
}


def test_starters_ask_about_real_tables_in_business_names():
    qs = suggest.starters(PROFILES, (ColumnNote("well.well_master.lift_type", "Lift method"),))
    assert qs[0] == "How many wells are there by Lift method?"
    assert set(qs) == {"How many wells are there by Lift method?", "How many wells have Lift method PCP?",
                       "How many wells per month of spud date?"}               # no lookup table, no view
    assert suggest.starters({}) == []


def test_follow_ups_offer_another_value_a_breakdown_and_by_month():
    sql = ("SELECT COUNT(*) FROM well.well_master AS wm JOIN ref.cluster AS c ON c.cluster_code = wm.cluster_code "
           "WHERE c.cluster_name = 'Nimr'")
    assert suggest.follow_ups(sql, PROFILES) == ["Same for Marmul", "Break this down by lift type",
                                                 "Show this by month of spud date"]
    assert suggest.follow_ups("SELECT lift_type, COUNT(*) FROM well.well_master GROUP BY lift_type", PROFILES) == \
        ["Show this by month of spud date"]


def test_answers_with_rows_get_follow_ups_and_empty_ones_get_starters():
    found = {"route": "sql", "sql": "SELECT lift_type FROM well.well_master WHERE lift_type = 'PCP'", "data": {"rows": [[294]]}}
    assert runner._suggestions("pcp wells", found, PROFILES, ())["follow_ups"][0] == "Same for WI"
    empty = {"route": "sql", "sql": "SELECT 1", "data": {"rows": [[0]]}}
    assert runner._suggestions("how many wells are there by lift type?", empty, PROFILES, ()) == \
        {"suggestions": ["How many wells have lift type PCP?", "How many wells per month of spud date?"]}
    assert runner._suggestions("x", {"route": "clarify"}, PROFILES, ()) == {}
    message = {"route": "sql", "sql": "SELECT CAST('Downtime is not available.' AS nvarchar(200)) AS message",
               "data": {"rows": [["Downtime is not available."]]}}
    assert "suggestions" in runner._suggestions("rig downtime per crew", message, PROFILES, ())


def test_the_starters_endpoint_returns_none_until_profiles_exist():
    from app.main import app
    body = {"db": {"server": "s", "name": "n", "user": "u", "password": "p"}, "askDataSettings": {"allowedSchemas": ["well"]}}
    r = TestClient(app).post("/api/agent-runtime/askdata/starters", json=body)
    assert r.status_code == 200 and r.json() == {"questions": []}            # profiles are off in tests
    r = TestClient(app).post("/api/agent-runtime/askdata/starters", json={**body, "askDataSettings": {}})
    assert r.status_code == 400                                               # not set up


def test_an_answers_rows_run_again_only_when_still_allowed(monkeypatch):
    from app.main import app
    monkeypatch.setattr(runner, "_schema", lambda run: "TABLE well.well_master\n  - well_id int\n  - lift_type varchar(20)")
    calls = []

    def fetch_all(sql, schema):
        calls.append(sql)
        from app.askdata.tools.export import ExportError
        if "SELECT *" in sql:
            raise ExportError("This query cannot be exported: SELECT * is not allowed.")
        return ["lift_type", "n"], [["PCP", 294], ["WI", 99]], False
    monkeypatch.setattr(runner.export_svc, "fetch_all", fetch_all)
    body = {"db": {"server": "s", "name": "n", "user": "u", "password": "p"}, "askDataSettings": {"allowedSchemas": ["well"]}}
    ok = TestClient(app).post("/api/agent-runtime/askdata/rows", json={**body, "sql": "SELECT lift_type, COUNT(*) AS n FROM well.well_master GROUP BY lift_type"})
    assert ok.status_code == 200 and ok.json() == {"data": {"columns": ["lift_type", "n"], "rows": [["PCP", 294], ["WI", 99]], "truncated": False}}
    bad = TestClient(app).post("/api/agent-runtime/askdata/rows", json={**body, "sql": "SELECT * FROM well.well_master"})
    assert bad.status_code == 400 and "cannot run again" in bad.json()["detail"]

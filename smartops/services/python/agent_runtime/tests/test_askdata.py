# Ported from twise-agentic db_assistant/tests/test_agent.py (team repo): graphs, routing budgets,
# SQL guards (validator, access, sqlcheck), helpers and the deterministic chart. Offline.
from __future__ import annotations

import pytest

from app.askdata import graph_deep as builder
from app.askdata import graph_fast as fast_builder
from app.askdata.common.text import extract_json, extract_sql, strip_think
from app.askdata.nodes import validator
from app.askdata.nodes.chart import chart_node
from app.askdata.nodes.finalize import _entity_names
from app.askdata.nodes.orchestrator import names_known_entity
from app.askdata.nodes.sql_author import normalize_sql
from app.askdata.nodes.verifier import _trim_feedback
from app.askdata.prompts import AGENT_RULES_HEADING, build_prompts, knowledge
from app.prompt_text import PromptMissing
from tests.seeded_prompts import runtime_texts
from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget, agent_settings, run_context
from app.askdata.tools import access, sqlcheck


@pytest.fixture(autouse=True)
def askdata_run():
    """Every test runs inside an Ask Data run with a fixed visibility boundary (twise's access_settings)."""
    run = AskDataRun(
        settings=AskDataSettings(allowed_schemas=("well", "project"), excluded_tables=("well.hidden_table",),
                                 excluded_columns=("well.well_master.location_dd",)),
        db=DbTarget(server="test", name="test", user="u", password="p"),
        prompts=build_prompts(100, "", "", runtime_texts()), texts=runtime_texts())
    with run_context(run):
        yield run


@pytest.fixture
def access_settings(askdata_run):
    return askdata_run.settings


SCHEMA = """TABLE well.well_master
  - well_id int NOT NULL PK
  - well_name nvarchar(100)
  - project_id int
  FK: project_id -> project.prj_mstr.prj_id

TABLE project.prj_mstr
  - prj_id int NOT NULL PK
  - project_code nvarchar(20)
  - project_name nvarchar(200)

TABLE well.task_daily
  - well_id int
  - [plan] nvarchar(50)
  - progress decimal
  ⚠ MANY ROWS PER well_id — de-duplicate (COUNT(DISTINCT ...) or GROUP BY) before answering per-well_id questions
  FK: well_id -> well.well_master.well_id
"""


# ── Graphs ──────────────────────────────────────────────────────────────────────

def test_build_graph_compiles():
    g = builder.build_graph()
    nodes = set(g.get_graph().nodes)
    assert {"orchestrator", "planner", "sql_author", "validator", "executor", "analysis",
            "verifier", "synthesize", "chart", "clarify", "chitchat"} <= nodes


def test_build_fast_graph_compiles():
    g = fast_builder.build_fast_graph()
    nodes = set(g.get_graph().nodes)
    assert "sqlcheck" in nodes
    assert "verifier" not in nodes and "planner" not in nodes and "analysis" not in nodes


def test_routing_functions_respect_budgets():
    # Validator: a validation error retries while the budget allows, then falls through.
    assert builder._route_after_validator({"validation_error": "x", "retry_count": 0}) == "sql_author"
    assert builder._route_after_validator(
        {"validation_error": "x", "retry_count": agent_settings.max_sql_retries + 1}
    ) == "synthesize"
    assert builder._route_after_validator({"validation_error": ""}) == "executor"
    # Repeat guard only bites AFTER a verifier rejection.
    repeated = {"validation_error": "", "tried_sql": ["select 1", "select 1"]}
    assert builder._route_after_validator(repeated) == "executor"
    assert builder._route_after_validator(repeated | {"verify_retry_count": 1}) == "synthesize"
    # Verifier: own budget.
    assert builder._route_after_verifier({"verify_ok": False, "verify_retry_count": 0}) == "sql_author"
    assert builder._route_after_verifier(
        {"verify_ok": False, "verify_retry_count": agent_settings.verify_retries + 1}
    ) == "synthesize"
    assert builder._route_after_verifier({"verify_ok": True}) == "synthesize"
    # Analysis is skipped when no rows came back.
    assert builder._answer_target({"needs_analysis": True, "steps": []}) == "verifier"
    assert builder._answer_target({"needs_analysis": True, "steps": [{"rows": [[1]]}]}) == "analysis"
    assert builder._route_after_orchestrator({"route": "chitchat"}) == "chitchat"
    assert builder._route_after_orchestrator({"route": "sql", "multi_step": True}) == "planner"
    assert builder._route_after_synthesize({"wants_chart": True}) == "chart"


@pytest.mark.parametrize("sql", [
    "SELECT TOP 5 well_name FROM well.well_master ORDER BY well_name",
    "WITH x AS (SELECT well_id FROM well.well_master) SELECT COUNT(*) FROM x",
    "SELECT * FROM well.well_master WHERE remarks LIKE '%update required%'",   # keyword inside data
    "SELECT [Delete Count] FROM well.well_master",                            # bracketed identifier
    "SELECT 1 FROM well.well_master -- drop table t\n",                          # keyword in a comment
])
def test_validator_accepts_read_only(sql):
    ok, reason = validator.is_select_only(sql)
    assert ok, reason


@pytest.mark.parametrize("sql, needle", [
    ("DELETE FROM well.well_master", "start with SELECT"),
    ("SELECT 1; DROP TABLE well.well_master", "Multiple statements"),
    ("SELECT * INTO backup FROM well.well_master", "Forbidden keyword"),
    ("SELECT * FROM well.well_master; EXEC sp_who", "Multiple statements"),
    ("SELECT * FROM OPENROWSET('x','y','z')", "OPENROWSET"),
    ("SELECT name FROM sys.sql_logins", "sys.sql_logins"),
    ("SELECT a -- '\nDROP TABLE t -- '", "Forbidden keyword"),
    ("", "Empty"),
])
def test_validator_rejects_unsafe(sql, needle):
    ok, reason = validator.is_select_only(sql)
    assert not ok and needle.lower() in reason.lower()


def test_validator_node_flags_unknown_tables(access_settings):
    out = validator.validator_node({"sql": "SELECT well_id FROM dbo.task_daily", "schema": SCHEMA, "retry_count": 0})
    assert "dbo.task_daily" in out["validation_error"] and out["retry_count"] == 1
    out = validator.validator_node({"sql": "SELECT well_id FROM well.task_daily", "schema": SCHEMA})
    assert out == {"validation_error": ""}
    # No schema text -> nothing can be checked, so nothing runs (fails closed).
    out = validator.validator_node({"sql": "SELECT well_id FROM well.task_daily", "schema": ""})
    assert "schema is not loaded" in out["validation_error"]





@pytest.mark.parametrize("sql, needle", [
    ("SELECT name FROM [sys].[sql_logins]", "sys.sql_logins"),                    # bracketed system view
    ("SELECT w.well_id FROM well.well_master w, sys.objects o", "sys.objects"),   # comma join
    ("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES", "INFORMATION_SCHEMA"),
    ("SELECT x FROM [OtherDb].dbo.t", "other databases"),                         # cross-database
    ("SELECT x FROM [10.0.0.1].db.dbo.t", "linked servers"),                      # linked server
    ("SELECT * FROM OPENQUERY(srv, 'select 1')", "OPENQUERY"),
    ("SELECT w.well_id FROM well.well_master w CROSS APPLY OPENQUERY(srv, 'x') q", "OPENQUERY"),
    ("SELECT dbo.fn_x(w.well_id) FROM well.well_master w", "user-defined"),
    ("SELECT x FROM well.hidden_table", "well.hidden_table"),                     # EXCLUDED_TABLES
    ("SELECT location_dd FROM well.well_master", "location_dd"),                  # EXCLUDED_COLUMNS
    ("SELECT w.[location_dd] FROM well.well_master AS w", "location_dd"),
    ("SELECT w.well_id FROM well.well_master w WHERE EXISTS "
     "(SELECT 1 FROM well.task_daily t WHERE t.well_id = w.well_id AND location_dd > 0)", "location_dd"),
    ("SELECT password_hash FROM well.well_master", "password_hash"),              # secret-name filter
    ("SELECT * FROM well.well_master", "SELECT *"),                               # would return hidden columns
    ("SELECT w.* FROM well.well_master w", "w.*"),
    ("SELECT well_id FROM well_master", "schema.table"),
    ("SELECT 1 AS a KILL 55", "could not be parsed"),                             # batch without ';'
    ("SELECT 1 AS [a]]--] DROP TABLE well.well_master", "could not be parsed"),
    ("SELECT '--' AS x; DELETE FROM well.well_master", "exactly ONE SELECT"),
    ("SELECT * INTO well.bk FROM well.well_master", "INTO"),
])
def test_access_rejects_reads_outside_the_schema(access_settings, sql, needle):
    problems = access.access_problems(sql, SCHEMA)
    assert problems and needle.lower() in " ".join(problems).lower(), problems


@pytest.mark.parametrize("sql", [
    "SELECT TOP 5 well_name FROM well.well_master ORDER BY well_name",
    "WITH c AS (SELECT well_id, well_name FROM well.well_master) SELECT * FROM c",
    "SELECT COUNT(*) FROM well.task_daily",
    "SELECT w.well_name, p.project_name FROM well.well_master w JOIN project.prj_mstr p ON p.prj_id = w.project_id",
    "SELECT t.well_id, s.value FROM well.task_daily t CROSS APPLY STRING_SPLIT(t.[plan], '-') s",
    "SELECT w.well_id, z.progress FROM well.well_master w OUTER APPLY "
    "(SELECT TOP 1 t.progress FROM well.task_daily t WHERE t.well_id = w.well_id) z",
    "SELECT well_id, COUNT(*) AS location_dd FROM well.task_daily GROUP BY well_id ORDER BY location_dd",
    "SELECT well_id FROM well.well_master UNION SELECT well_id FROM well.task_daily",
    "SELECT w.well_id FROM well.well_master AS w WITH (NOLOCK) OPTION (MAXRECURSION 10)",
    "SELECT v.x FROM (VALUES (1), (2)) AS v(x)",
])
def test_access_allows_ordinary_queries(access_settings, sql):
    assert access.access_problems(sql, SCHEMA) == []





def test_sqlcheck_schema_derived_concerns():
    # 1. many-rows-per-key table used without collapsing
    concerns = sqlcheck.check("SELECT well_id, progress FROM well.task_daily", SCHEMA)
    assert any("many rows per well_id" in c for c in concerns)
    assert sqlcheck.check("SELECT well_id, MAX(progress) FROM well.task_daily GROUP BY well_id", SCHEMA) == []
    # 2. declared FK joined to the wrong target column
    bad = ("SELECT w.well_name FROM well.well_master w JOIN project.prj_mstr p "
           "ON w.project_id = p.project_code")
    assert any("project.prj_mstr.prj_id" in c for c in sqlcheck.check(bad, SCHEMA))
    good = ("SELECT w.well_name FROM well.well_master w JOIN project.prj_mstr p "
            "ON w.project_id = p.prj_id")
    assert sqlcheck.check(good, SCHEMA) == []
    assert sqlcheck.check("", SCHEMA) == [] and sqlcheck.log_check("SELECT 1", "", "q") == []
    # The fast graph's node reports the verdict explicitly either way.
    assert fast_builder.sqlcheck_node({"sql": good, "schema": SCHEMA, "question": "q"}) == {"verify_ok": True}
    assert fast_builder.sqlcheck_node({"sql": "SELECT * FROM well.task_daily", "schema": SCHEMA}) == {"verify_ok": False}


# ── Extract / text helpers ──────────────────────────────────────────────────────

def test_extract_helpers():
    raw = "<think>reasoning</think>Here you go:\n```sql\nSELECT TOP 3 well_name FROM well.well_master;\n```"
    assert extract_sql(raw) == "SELECT TOP 3 well_name FROM well.well_master"
    assert extract_json('```json\n{"route": "sql", "needs_analysis": false}\n```')["route"] == "sql"
    assert extract_json("prose {\"ok\": true, \"feedback\": \"\"} trailing")["ok"] is True
    assert extract_json("not json", default={"route": "sql"}) == {"route": "sql"}
    assert strip_think("<think>x</think> answer") == "answer"
    assert normalize_sql("SELECT  1 ;") == normalize_sql("select 1")
    assert names_known_entity("how many wells are there?", SCHEMA) == "well"
    assert names_known_entity("what is the time now?", SCHEMA) == ""
    assert _entity_names(SCHEMA)[:1] == ["well"] and "task daily" in _entity_names(SCHEMA)  # " master" suffix dropped
    long = ("Fix the join. " * 200).strip()
    trimmed = _trim_feedback(long)
    assert len(trimmed) <= 1500 + len(" […truncated]") and trimmed.endswith("[…truncated]")


def test_chart_node_is_deterministic():
    state = {
        "wants_chart": True, "chart_type": "donut", "question": "wells per project as a donut",
        "steps": [{"sub_question": "wells per project", "columns": ["project", "wells"],
                   "rows": [["A", 5], ["B", 12], ["C", "7"]], "truncated": False}],
    }
    spec = chart_node(state)["chart"]
    assert spec["type"] == "donut" and spec["labels"] == ["B", "C", "A"]
    assert spec["series"] == [{"name": "wells", "data": [12.0, 7.0, 5.0]}]
    # A single scalar becomes a KPI card; a truncated result is refused.
    kpi = chart_node({"wants_chart": True, "steps": [{"columns": ["n"], "rows": [[42]]}]})["chart"]
    assert kpi["type"] == "kpi"
    assert chart_node({"wants_chart": True, "steps": [{"columns": ["a"], "rows": [[1]], "truncated": True}]}) == {"chart": {}}
    assert chart_node({"wants_chart": False}) == {"chart": {}}


# A turn the Verifier rejected once and then approved: COUNT(*) over a snapshot table (wrong),
# rewritten to COUNT(DISTINCT ...) (right). Rejected steps are appended AFTER the approved ones.
_APPROVED = {"sub_question": "wells", "sql": "SELECT COUNT(DISTINCT well_id) AS n FROM well.well_master",
             "columns": ["n"], "rows": [[587]], "truncated": False}
_REJECTED = {"sub_question": "wells", "sql": "SELECT COUNT(*) AS n FROM well.well_master",
             "columns": ["n"], "rows": [[92000]], "truncated": False}


def _turn(verify_ok: bool) -> dict:
    steps = [_APPROVED] if verify_ok else []
    return {"answer": "There are 587 wells.", "route": "sql", "verify_ok": verify_ok,
            "steps": steps, "rejected_steps": [_REJECTED], "wants_chart": True}


def test_verified_turn_shows_only_the_approved_data():
    from app.askdata.runner import _response

    turn = _turn(verify_ok=True)
    resp = _response(turn, "deep", 1.0, [])
    assert resp["verified"] and resp["data"]["rows"] == [[587]]
    assert chart_node(turn)["chart"]["series"][0]["data"] == [587.0]
    # The SQL view still lists every attempt, the rejected one included.
    assert [s["sql"] for s in resp["steps"]] == [_APPROVED["sql"], _REJECTED["sql"]]


def test_unverified_turn_shows_the_data_the_flagged_answer_used():
    from app.askdata.runner import _response

    turn = _turn(verify_ok=False)
    resp = _response(turn, "deep", 1.0, [])
    assert not resp["verified"] and resp["data"]["rows"] == [[92000]]
    assert chart_node(turn)["chart"]["series"][0]["data"] == [92000.0]


def test_response_has_twise_chat_response_fields():
    # As twise build_response: routes that run no verification are reported as verified.
    from app.askdata.runner import _response

    chit = _response({"route": "chitchat", "answer": "Hello"}, "deep", 0.123, [])
    assert chit["verified"] is True and chit["needs_analysis"] is False and chit["export_token"] is None
    assert chit["seconds"] == 0.12


def test_export_token_round_trip_and_tamper():
    from app.askdata.tools import export

    token = _response_token = export.make_token("SELECT well_id FROM well.well_master")
    assert export.read_token(token) == "SELECT well_id FROM well.well_master"
    with pytest.raises(export.ExportError):
        export.read_token(_response_token[:-2] + "xx")


def test_history_keeps_the_last_three_turns():
    from app.askdata.runner import bound_history

    turns = [{"user": str(i), "assistant": "a"} for i in range(5)]
    assert [t["user"] for t in bound_history(turns, 3)] == ["2", "3", "4"]


def test_executor_refuses_anything_but_a_select():
    # Second line of defence: the executor itself rejects writes, before any connection is opened.
    from app.askdata.nodes.executor import executor_node

    out = executor_node({"sql": "DELETE FROM well.well_master", "retry_count": 0})
    assert out["retry_count"] == 1 and "select" in out["exec_error"].lower()


def test_each_refused_query_is_recorded_with_its_stage_and_reason(monkeypatch):
    from app.askdata import runner
    from app.askdata.nodes.executor import executor_node
    from app.askdata.nodes.verifier import _reject

    # Validator (the SQL checker): refused before it runs.
    out = validator.validator_node({"sql": "SELECT well_id FROM dbo.task_daily", "schema": SCHEMA, "sub_question": "late wells"})
    assert out["rejections"] == [{"stage": "validator", "sql": "SELECT well_id FROM dbo.task_daily",
                                  "reason": out["validation_error"], "sub_question": "late wells"}]
    # Database: the run failed (here the executor's own read-only guard); earlier rejections are kept.
    out = executor_node({"sql": "DELETE FROM well.well_master", "question": "q", "rejections": out["rejections"]})
    assert [r["stage"] for r in out["rejections"]] == ["validator", "database"]
    assert out["rejections"][1]["sql"] == "DELETE FROM well.well_master" and out["rejections"][1]["reason"] == out["exec_error"]
    # Verifier: one verdict over the steps, so every query set aside carries the same reason.
    steps = [{"sql": "SELECT a FROM well.well_master", "rows": []}, {"sql": "SELECT b FROM well.task_daily", "rows": []}]
    out = _reject({"steps": steps, "question": "q", "rejections": out["rejections"]}, "Counts wells, not tasks.")
    assert [(r["stage"], r["sql"], r["reason"]) for r in out["rejections"][2:]] == [
        ("verifier", "SELECT a FROM well.well_master", "Counts wells, not tasks."),
        ("verifier", "SELECT b FROM well.task_daily", "Counts wells, not tasks.")]

    # They reach the answer the Tenant API stores.
    monkeypatch.setattr(runner.export_svc, "make_token", lambda sql: "t")
    sent = runner._response({"answer": "a", "rejections": out["rejections"]}, "deep", 1.0, [])["rejections"]
    assert [r["stage"] for r in sent] == ["validator", "database", "verifier", "verifier"]
    assert set(sent[0]) == {"stage", "sql", "reason", "sub_question"}


def test_rejections_are_bounded():
    from app.askdata.nodes._common import MAX_REJECTIONS, with_rejection

    many = with_rejection({"sql": "SELECT 1", "rejections": [{"stage": "x"}] * MAX_REJECTIONS}, "validator", "why")
    assert len(many) == MAX_REJECTIONS
    long = with_rejection({"sql": "S" * 20_000}, "database", "R" * 5_000)[0]
    assert len(long["sql"]) == 8000 and len(long["reason"]) == 2000


def test_knowledge_reaches_the_prompts_and_no_profile_is_added():
    p = build_prompts(50, "RULE X", "EXAMPLE Y", runtime_texts())
    assert "AGENT PROFILE" not in p.SYNTHESIZE_SYSTEM   # as twise: the prompts are the DB Assistant's own
    assert "RULE X" in p.SQL_AUTHOR_SYSTEM and "EXAMPLE Y" in p.SQL_AUTHOR_SYSTEM
    assert "MAX_ROWS" not in p.VERIFIER_SYSTEM and "50" in p.VERIFIER_SYSTEM
    assert p.label(p.SQL_AUTHOR_SYSTEM) == "sql_author"


def test_export_endpoint_refuses_a_forged_token():
    from fastapi.testclient import TestClient
    from app.main import app

    body = {"token": "abc.def", "format": "xlsx", "db": {"server": "s", "name": "n", "user": "u", "password": "p"},
            "askDataSettings": {"allowedSchemas": ["well"]}}
    r = TestClient(app).post("/api/agent-runtime/askdata/export", json=body)
    assert r.status_code == 400 and "export" in r.json()["detail"].lower()


def test_export_refuses_when_ask_data_is_not_set_up():
    from fastapi.testclient import TestClient
    from app.main import app

    body = {"token": "abc.def", "format": "xlsx", "db": {"server": "s", "name": "n", "user": "u", "password": "p"}}
    r = TestClient(app).post("/api/agent-runtime/askdata/export", json=body)
    assert r.status_code == 400 and "AI Settings > Ask Data & Features" in r.json()["detail"]


def test_the_runtime_has_no_schema_table_or_column_names_of_its_own():
    from app.askdata.settings import AskDataSettings

    s = AskDataSettings()
    assert s.allowed_schemas == () and s.included_tables == () and s.excluded_tables == () and s.excluded_columns == ()
    assert s.org_name == ""


def test_the_tenants_lists_are_lowercased_like_twise():
    from app.askdata.runner import settings_for
    from app.models import AskDataTenantSettings

    s = settings_for(None, AskDataTenantSettings(allowed_schemas=["Well", " DBO ", "well"],
                                                 excluded_tables=["dbo.ActivityCodesNorms"],
                                                 excluded_columns=["Well.Well_Master.Location_DD"],
                                                 max_rows=250, query_timeout=30, max_queries=2, max_sql_retries=1,
                                                 verify_retries=0, history_turns=5, org_name=" Acme ", export_prefix="acme"))
    assert s.allowed_schemas == ("well", "dbo")
    assert s.excluded_tables == ("dbo.activitycodesnorms",) and s.excluded_columns == ("well.well_master.location_dd",)
    assert (s.max_rows, s.query_timeout, s.max_queries, s.max_sql_retries, s.verify_retries, s.history_turns) == (250, 30, 2, 1, 0, 5)
    assert s.org_name == "Acme" and s.export_prefix == "acme"


def test_the_tenants_table_list_is_lowercased_too():
    from app.askdata.runner import settings_for
    from app.models import AskDataTenantSettings

    s = settings_for(None, AskDataTenantSettings(allowed_schemas=["well"], included_tables=["Well.Well_Master", " well.task_daily "]))
    assert s.included_tables == ("well.well_master", "well.task_daily")
    assert settings_for(None, AskDataTenantSettings(allowed_schemas=["well"])).included_tables == ()


def test_with_a_table_list_every_other_table_is_hidden_and_refused(askdata_run):
    import dataclasses
    from app.askdata.tools.schema_introspect import _is_excluded

    askdata_run.settings = dataclasses.replace(askdata_run.settings, included_tables=("well.well_master",))
    assert not _is_excluded("well", "well_master") and not _is_excluded("WELL", "Well_Master")
    assert _is_excluded("well", "task_daily") and _is_excluded("project", "prj_mstr")
    problems = access.access_problems("SELECT COUNT(*) FROM well.task_daily", SCHEMA)
    assert problems and "well.task_daily" in " ".join(problems)
    assert access.access_problems("SELECT TOP 5 well_name FROM well.well_master ORDER BY well_name", SCHEMA) == []


def test_ask_data_refuses_until_the_tenant_sets_it_up():
    from app.askdata.runner import NOT_SET_UP, settings_for
    from app.models import AskDataTenantSettings

    for tenant in (None, AskDataTenantSettings(), AskDataTenantSettings(allowed_schemas=["sys", "INFORMATION_SCHEMA", " "])):
        with pytest.raises(ValueError, match="AI Settings > Ask Data & Features"):
            settings_for(None, tenant)
    assert "not set up" in NOT_SET_UP


def test_an_agent_can_only_narrow_the_allowed_schemas():
    from app.askdata.runner import settings_for
    from app.models import AskDataOptions

    from app.models import AskDataTenantSettings

    tenant = AskDataTenantSettings(allowed_schemas=["well", "project", "ref"], max_rows=500)
    assert settings_for(AskDataOptions(allowed_schemas=["Well", "sys", "INFORMATION_SCHEMA"]), tenant).allowed_schemas == ("well",)
    default = settings_for(None, tenant).allowed_schemas
    assert default == ("well", "project", "ref")
    assert settings_for(AskDataOptions(allowed_schemas=None), tenant).allowed_schemas == default   # null from the Tenant API
    assert settings_for(AskDataOptions(allowed_schemas=[]), tenant).allowed_schemas == default     # blank: the tenant's list
    with pytest.raises(ValueError, match="can be read here"):
        settings_for(AskDataOptions(allowed_schemas=["sys", "wel"]), tenant)   # never widened to every schema
    with pytest.raises(ValueError, match="can be read here"):
        settings_for(AskDataOptions(allowed_schemas=["hr"]), tenant)           # nor to a schema the tenant does not allow


def test_an_agent_can_lower_the_row_limit_but_never_raise_it():
    from app.askdata.runner import settings_for
    from app.models import AskDataOptions, AskDataTenantSettings

    tenant = AskDataTenantSettings(allowed_schemas=["well"], max_rows=500)
    assert settings_for(AskDataOptions(max_rows=100), tenant).max_rows == 100
    assert settings_for(AskDataOptions(max_rows=5000), tenant).max_rows == 500
    assert settings_for(None, tenant).max_rows == 500


def test_done_event_carries_an_export_token(monkeypatch):
    # The response is built inside the run, so the token can be signed (it was None when built after it).
    from app.askdata import runner
    from app.models import AskDataTenantSettings, Db

    class FakeGraph:
        def stream(self, *_a, **_k):
            yield "values", {"route": "sql", "answer": "x", "verify_ok": True,
                             "steps": [{"sql": "SELECT 1 AS n", "columns": ["n"], "rows": [[1]]}]}
    monkeypatch.setattr(runner, "_graphs", lambda: {"deep": FakeGraph(), "normal": FakeGraph()})
    monkeypatch.setattr(runner, "build_schema_text", lambda: "TABLE well.well_master")
    monkeypatch.setattr(runner, "build_value_hints", lambda: "")
    with run_context(None):   # leave the fixture's run: ask() opens its own
        events = list(runner.ask("q", [], mode="deep", options=None,
                                 db=Db(server="s", name="n", user="u", password="p"), llm=None,
                                 prompts=runtime_texts(), tenant=AskDataTenantSettings(allowed_schemas=["well"])))
    assert events[-1]["data"]["export_token"]


def test_the_chatbot_says_how_to_set_ask_data_up():
    from app.askdata import runner
    from app.models import Db

    with run_context(None):
        events = list(runner.ask("q", [], mode="deep", options=None,
                                 db=Db(server="s", name="n", user="u", password="p"), llm=None, prompts=runtime_texts()))
    assert events == [{"event": "error", "data": {"message": runner.NOT_SET_UP}}]


def test_ask_your_data_answers_drop_the_export_hint():
    from app.askdata.runner import without_export_hints
    answer = "There are **12** wells.\n\nShowing the first 12 of 40 records.\n\nAll 40 can be downloaded using the Export option below."
    assert without_export_hints(answer) == "There are **12** wells.\n\nShowing the first 12 of 40 records."
    table = "| a | b |\n|---|---|\n| 1 | 2 |"
    assert without_export_hints(table) == table


def test_ask_your_data_endpoint_streams_the_ask_data_graph(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.askdata import runner

    def fake_ask(question, history, **_k):
        yield {"event": "status", "data": {"stage": "Understanding your question"}}
        yield {"event": "done", "data": {"answer": "3 wells. They can be downloaded using the Export option below.", "steps": []}}
    monkeypatch.setattr(runner, "ask", fake_ask)
    monkeypatch.setattr(main, "API_KEY", "")
    body = {"question": "how many wells?", "db": {"server": "s", "name": "n", "user": "u", "password": "p"},
            "llm": {"baseUrl": "http://x", "model": "m"}}
    with run_context(None):
        text = TestClient(main.app).post("/api/agent-runtime/askdata/ask", json=body).text
    assert "event: status" in text and "event: done" in text
    assert '"answer": "3 wells."' in text


def test_agent_business_rules_are_added_after_the_tenant_rules():
    texts = {"askdata.business_rules": "TENANT RULES", "askdata.few_shots": "TENANT EXAMPLES"}
    combined = knowledge(texts, "business_rules", "AGENT RULES")
    assert combined == f"TENANT RULES\n\n{AGENT_RULES_HEADING}\n\nAGENT RULES"
    assert knowledge(texts, "business_rules", None) == "TENANT RULES"
    assert knowledge(texts, "business_rules", "") == "TENANT RULES"
    # The tenant's rules are required (nothing falls back), even when the agent has its own.
    with pytest.raises(PromptMissing):
        knowledge({**texts, "askdata.business_rules": ""}, "business_rules", "AGENT RULES")


def test_agent_examples_replace_the_tenant_examples():
    texts = {"askdata.business_rules": "TENANT RULES", "askdata.few_shots": "TENANT EXAMPLES"}
    assert knowledge(texts, "few_shots", "AGENT EXAMPLES") == "AGENT EXAMPLES"
    assert knowledge(texts, "few_shots", None) == "TENANT EXAMPLES"

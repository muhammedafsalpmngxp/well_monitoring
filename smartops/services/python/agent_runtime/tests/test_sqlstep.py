"""Saved SQL (sql_query): a step that runs its own SELECT. Offline: the database and the AI provider are faked."""
import datetime
import decimal

import pytest

from app import sqlstep
from app.main import run_events, tools
from app.models import AskDataTenantSettings, RunRequest
from tests.seeded_prompts import runtime_texts

REPORT_SQL = "SELECT TOP 10 report_date, COUNT(*) AS entries FROM dbo.daily_report WHERE cluster = {{cluster}} GROUP BY report_date"


def _req(steps, tools_=None, inputs=None, llm=None):
    return RunRequest.model_validate({
        "agent": {
            "name": "Daily Report", "role": "daily report analyst",
            "steps": steps,
            "tools": tools_ or [{"agent": "sql_query", "action": "table"}],
            "inputs": [{"name": "cluster", "required": True}],
        },
        "inputs": inputs if inputs is not None else {"cluster": "Nimr"},
        "llm": llm,
        "prompts": runtime_texts(),
    })


def fake_sql(calls, rows=(("2026-10-01", 4), ("2026-10-02", 7))):
    def run_sql(sql, action, inputs):
        calls.append({"sql": sql, "action": action, "inputs": dict(inputs)})
        yield {"event": "status", "data": {"stage": "Fetching your data"}}
        yield {"event": "done", "data": {
            "answer": sqlstep.table(["report_date", "entries"], [list(r) for r in rows], False),
            "route": "sql", "verified": True, "summarize": action == "summary",
            "steps": [{"sql": sql}], "data": {"columns": ["report_date", "entries"], "rows": [list(r) for r in rows],
                                              "truncated": False}, "usage": []}}
    return run_sql


def no_chat(llm, messages):
    raise AssertionError("Saved SQL with the table action must not call the model")


# ── binding and checks ─────────────────────────────────────────────────────────

def test_bind_turns_placeholders_into_parameters_in_order():
    sql, params = sqlstep.bind("SELECT a FROM t WHERE c = {{cluster}} AND d = '{{ day }}' AND e = {{cluster}}",
                               {"cluster": "Nimr", "day": "2026-10-01"})
    assert sql == "SELECT a FROM t WHERE c = ? AND d = ? AND e = ?"
    assert params == ["Nimr", "2026-10-01", "Nimr"]


def test_bind_sends_a_blank_input_as_null():
    assert sqlstep.bind("SELECT a FROM t WHERE ({{w}} IS NULL OR w = {{w}})", {"w": "  "})[1] == [None, None]


def test_input_values_never_reach_the_sql_text():
    sql, params = sqlstep.bind("SELECT a FROM t WHERE c = {{cluster}}", {"cluster": "x'; DROP TABLE t; --"})
    assert "DROP" not in sql and params == ["x'; DROP TABLE t; --"]


def test_problems_accepts_one_select_using_known_inputs():
    assert sqlstep.problems(REPORT_SQL, "table", {"cluster"}) == []


@pytest.mark.parametrize("sql, action, needle", [
    ("", "table", "write its SQL"),
    ("SELECT a FROM dbo.t WHERE c = {{well}}", "table", "{{well}}, which is not an input"),
    ("DELETE FROM dbo.t", "table", "Only SELECT/WITH"),
    ("SELECT a FROM dbo.t; SELECT b FROM dbo.u", "table", "Multiple statements"),
    ("SELECT a INTO dbo.copy FROM dbo.t", "table", "not allowed"),
    ("SELECT a FROM OtherDb.dbo.t", "table", "other databases"),
    ("SELECT a FROM dbo.t", "chart", "unknown action"),
])
def test_problems_refuses(sql, action, needle):
    assert any(needle in p for p in sqlstep.problems(sql, action, {"cluster"}))


@pytest.mark.parametrize("sql", [
    "SELECT a FROM dbo.t WHERE name LIKE '%{{cluster}}%'",          # would bind as LIKE '%?%': not a parameter
    "SELECT a FROM dbo.t -- for {{cluster}}\nWHERE b = 1",
    "SELECT a FROM dbo.t /* {{cluster}} */",
])
def test_a_placeholder_inside_quoted_text_or_a_comment_is_refused(sql):
    assert any("cannot be a parameter" in p for p in sqlstep.problems(sql, "table", {"cluster"}))


@pytest.mark.parametrize("sql", [
    "SELECT a FROM dbo.t WHERE c = '{{cluster}}'",                  # the whole quoted text: a parameter
    "SELECT a FROM dbo.t WHERE name LIKE '%' + {{cluster}} + '%'",
])
def test_a_placeholder_that_is_a_parameter_is_accepted(sql):
    assert sqlstep.problems(sql, "table", {"cluster"}) == []


def test_table_escapes_pipes_and_says_how_many_rows():
    text = sqlstep.table(["name", "n"], [["a|b", 1], [None, decimal.Decimal("2.50")]], truncated=True)
    assert "| a\\|b | 1 |" in text and "|  | 2.5 |" in text and text.endswith("2+ rows.")
    assert sqlstep.table(["n"], [], False) == "The query returned no rows."


def test_cells_are_json_friendly():
    assert sqlstep._cell(datetime.date(2026, 10, 1)) == "2026-10-01"
    assert sqlstep._cell(datetime.datetime(2026, 10, 1, 8, 30)) == "2026-10-01 08:30:00"
    assert sqlstep._cell(decimal.Decimal("7")) == 7 and sqlstep._cell(None) is None


def test_the_tool_list_offers_saved_sql():
    offered = {t["agent"]: t for t in tools()["tools"]}
    assert offered["sql_query"]["capabilities"] == ["table", "summary"] and "ask_data" in offered


# ── in an agent ────────────────────────────────────────────────────────────────

def test_table_action_answers_with_the_rows_and_no_model_call():
    calls = []
    req = _req([{"text": "Recent report dates", "sql": REPORT_SQL}], llm={"baseUrl": "http://llm", "model": "m"})
    events = list(run_events(req, run_sql=fake_sql(calls), chat=no_chat))
    done = events[-1][1]
    assert done["ok"] and done["answer"].startswith("| report_date | entries |") and done["usage"] == []
    assert calls == [{"sql": REPORT_SQL, "action": "table", "inputs": {"cluster": "Nimr"}}]
    step = done["steps"][0]
    assert step["agent"] == "sql_query" and step["sql"] == [REPORT_SQL] and step["data"]["rows"][1] == ["2026-10-02", 7]


def test_summary_action_has_the_model_write_the_answer_from_the_rows():
    seen = []

    def chat(llm, messages):
        seen.append(messages)
        return "Nimr reported on 2 days; 2 Oct had the most entries (7).", {"input": 40, "output": 12}

    req = _req([{"text": "Recent report dates", "sql": REPORT_SQL}], tools_=[{"agent": "sql_query", "action": "summary"}],
               llm={"baseUrl": "http://llm", "model": "m"})
    done = list(run_events(req, run_sql=fake_sql([]), chat=chat))[-1][1]
    assert done["answer"].startswith("Nimr reported on 2 days")
    assert "| 2026-10-02 | 7 |" in seen[0][1][1]
    assert [u["agent"] for u in done["usage"]] == ["agent_runtime.answer"]


def test_summary_without_a_provider_returns_the_table():
    req = _req([{"text": "Recent report dates", "sql": REPORT_SQL}], tools_=[{"agent": "sql_query", "action": "summary"}])
    done = list(run_events(req, run_sql=fake_sql([])))[-1][1]
    assert done["ok"] and done["answer"].startswith("| report_date |")


def test_a_bad_saved_sql_stops_the_run_before_anything_runs():
    calls = []
    req = _req([{"text": "Wipe it", "sql": "DELETE FROM dbo.daily_report"}])
    events = list(run_events(req, run_sql=fake_sql(calls)))
    assert events[-1][0] == "error" and "Step 1 ('Wipe it') uses Saved SQL" in events[-1][1]["message"]
    assert calls == []


def test_saved_sql_and_another_tool_in_one_agent():
    sql_calls, tool_calls = [], []

    def run_tool(agent, action, text, history, session_id):
        tool_calls.append({"agent": agent, "history": history})
        yield {"event": "done", "data": {"answer": "2 Oct was the busiest day."}}

    req = _req([{"text": "Recent report dates", "sql": REPORT_SQL},
                {"text": "Which day was busiest?", "tool": {"agent": "ask_data", "action": "normal"}}],
               tools_=[{"agent": "sql_query", "action": "table"}, {"agent": "ask_data", "action": "normal"}])
    done = list(run_events(req, run_sql=fake_sql(sql_calls), run_tool=run_tool))[-1][1]
    assert len(sql_calls) == 1 and tool_calls[0]["agent"] == "ask_data"
    assert tool_calls[0]["history"][0]["user"] == "Recent report dates"
    assert "| 2026-10-01 | 4 |" in tool_calls[0]["history"][0]["assistant"]
    assert done["ok"]


# ── sqlstep.run against a fake database ────────────────────────────────────────

class _Cursor:
    def __init__(self, rows, seen):
        self.rows, self.seen, self.description = rows, seen, [("report_date",), ("entries",)]

    def execute(self, sql, *params):
        self.seen.append((sql, params))

    def fetchmany(self, n):
        return self.rows[:n]


class _Conn:
    def __init__(self, rows, seen):
        self.cur, self.closed, self.autocommit, self.rolled_back = _Cursor(rows, seen), False, True, False

    def cursor(self):
        return self.cur

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


SCHEMA = "TABLE dbo.daily_report\n  report_date date\n  entries int\n  cluster nvarchar\n"
DB = type("Db", (), {"server": "s", "name": "n", "user": "u", "password": "p", "port": 1433, "encrypt": "yes",
                     "trust_cert": "yes"})()


@pytest.fixture
def fake_db(monkeypatch):
    seen, conns = [], []

    def connect(rows):
        def get_connection(**_):
            conns.append(_Conn(rows, seen))
            return conns[-1]
        monkeypatch.setattr("app.askdata.common.connection.get_connection", get_connection)

    monkeypatch.setattr("app.askdata.runner._schema", lambda run: SCHEMA)
    return connect, seen, conns


TENANT = AskDataTenantSettings(allowed_schemas=["dbo", "well"])   # AI Settings > Ask Data & Features: what Ask Data may read


def test_run_binds_inputs_caps_rows_and_closes_the_connection(fake_db):
    connect, seen, conns = fake_db
    connect([[datetime.date(2026, 10, d), d] for d in range(1, 8)])
    options = type("O", (), {"max_rows": 5, "allowed_schemas": None})()
    events = list(sqlstep.run("SELECT report_date, entries FROM dbo.daily_report WHERE cluster = '{{cluster}}'",
                              "table", {"cluster": "Nimr"}, db=DB, options=options, tenant=TENANT))
    done = events[-1]["data"]
    assert seen == [("SELECT report_date, entries FROM dbo.daily_report WHERE cluster = ?", ("Nimr",))]
    assert len(done["data"]["rows"]) == 5 and done["data"]["truncated"] and done["data"]["rows"][0] == ["2026-10-01", 1]
    assert conns[0].closed and done["summarize"] is False
    # The login may be able to write (SA): the query ran in a transaction that was rolled back.
    assert conns[0].autocommit is False and conns[0].rolled_back


def test_run_refuses_a_table_ask_data_may_not_read(fake_db):
    connect, seen, _ = fake_db
    connect([])
    events = list(sqlstep.run("SELECT name FROM sys.sql_logins", "table", {}, db=DB, options=None, tenant=TENANT))
    assert events[-1]["event"] == "error" and "cannot run" in events[-1]["data"]["message"]
    assert seen == []


def test_run_needs_the_tenants_ask_data_settings(fake_db):
    """Saved SQL reads under the same tenant settings as Ask Data; without them nothing runs."""
    connect, seen, _ = fake_db
    connect([])
    events = list(sqlstep.run("SELECT a FROM dbo.daily_report", "table", {}, db=DB, options=None, tenant=None))
    assert events[-1]["event"] == "error" and "not set up" in events[-1]["data"]["message"]
    assert seen == []


def test_run_without_a_database_is_an_error():
    events = list(sqlstep.run("SELECT 1 AS one", "table", {}, db=None, options=None))
    assert events == [{"event": "error", "data": {"message": "Saved SQL has no database configured."}}]

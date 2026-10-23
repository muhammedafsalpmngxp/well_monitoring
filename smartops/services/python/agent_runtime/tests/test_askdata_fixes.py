"""Ask Data fixes from the comparison with the original db-assistant: the SQL shown is the one the answer used, an
unnamed organisation reads naturally, failures reach the user as safe messages, and an empty schema is not cached."""
from __future__ import annotations

from app.askdata import runner
from app.askdata.common.connection import DatabaseUnavailable
from app.askdata.prompts import NO_ORG_NAME, with_org_name
from app.errors import user_message


def test_the_shown_sql_is_the_accepted_query_and_rejected_attempts_are_marked(monkeypatch):
    monkeypatch.setattr(runner.export_svc, "make_token", lambda sql: f"token:{sql}")
    accepted = {"sub_question": "q", "sql": "SELECT good", "columns": ["n"], "rows": [[1]], "truncated": False}
    rejected = {"sub_question": "q", "sql": "SELECT bad", "columns": ["n"], "rows": [[9], [9]], "truncated": False}
    out = runner._response({"answer": "a", "steps": [accepted], "rejected_steps": [rejected], "verify_ok": True}, "deep", 1.0, [])

    assert out["sql"] == "SELECT good"
    assert out["export_token"] == "token:SELECT good"
    assert [(s["sql"], s["rejected"]) for s in out["steps"]] == [("SELECT good", False), ("SELECT bad", True)]
    assert out["data"]["rows"] == [[1]]


def test_no_query_means_no_sql():
    out = runner._response({"answer": "hi", "route": "chitchat"}, "deep", 0.1, [])
    assert out["sql"] is None and out["steps"] == [] and out["data"] is None


def test_an_unnamed_organisation_does_not_read_the_the_organisation():
    text = "You are the voice of the {{ORG_NAME}} AI Assistant. The {{ORG_NAME}} data. What is {{ORG_NAME}}?"
    assert with_org_name(text, "") == ("You are the voice of the organisation AI Assistant. The organisation data. "
                                       f"What is {NO_ORG_NAME}?")
    assert with_org_name(text, " Al-Tasnim ") == ("You are the voice of the Al-Tasnim AI Assistant. The Al-Tasnim data. "
                                                  "What is Al-Tasnim?")
    # Only a whole word "the" merges: "Breathe" is left alone.
    assert with_org_name("Breathe {{ORG_NAME}}", "") == f"Breathe {NO_ORG_NAME}"


def test_failures_become_safe_messages():
    assert user_message(DatabaseUnavailable("The database is not reachable."), "Ask Data") == "The database is not reachable."
    secret = RuntimeError("Login failed for user 'sa' on server 10.0.0.5 with password hunter2")
    msg = user_message(secret, "Ask Data")
    assert msg == "Ask Data failed unexpectedly (RuntimeError). The service log has the details."
    assert "10.0.0.5" not in msg and "hunter2" not in msg

    class AuthenticationError(Exception):
        status_code = 401
    AuthenticationError.__module__ = "openai._exceptions"
    assert "refused the key (HTTP 401)" in user_message(AuthenticationError("Incorrect API key sk-abc"), "The agent")
    assert "sk-abc" not in user_message(AuthenticationError("Incorrect API key sk-abc"), "The agent")

    class APITimeoutError(Exception):
        pass
    APITimeoutError.__module__ = "openai._exceptions"
    assert user_message(APITimeoutError("x"), "Ask Data").startswith("Ask Data could not reach the AI provider")


def test_an_empty_schema_is_not_cached(monkeypatch):
    calls = []

    def schema_text():
        calls.append(1)
        return "" if len(calls) == 1 else "TABLE well.well_master"

    monkeypatch.setattr(runner, "build_schema_text", schema_text)
    monkeypatch.setattr(runner, "build_value_hints", lambda: "")
    monkeypatch.setattr(runner, "_SCHEMAS", {})

    class Db:
        server, port, name = "s", 1433, "d"

    class Settings:
        allowed_schemas, included_tables, excluded_tables, excluded_columns = ("well",), (), (), ()

    class Run:
        db, settings = Db(), Settings()

    assert runner._schema(Run()) == ""
    assert runner._schema(Run()) == "TABLE well.well_master"
    assert runner._schema(Run()) == "TABLE well.well_master"
    assert len(calls) == 2, "a real schema is cached; the empty one was not"


def test_quoted_names_are_not_keywords_but_writes_are_still_refused():
    import pytest
    from app.askdata.common.readonly import ReadOnlyViolation, assert_read_only

    assert_read_only('SELECT [Last Update], "Create Date" FROM well.well_master')
    for bad in ("SELECT 1 AS a; DELETE FROM x", "SELECT [a] FROM t KILL 55", "SELECT * INTO [new] FROM t",
                "SELECT 1 AS [x]] DROP TABLE t --]", 'SELECT "a" FROM t; UPDATE t SET a = 1'):
        with pytest.raises(ReadOnlyViolation):
            assert_read_only(bad)


def test_after_a_restart_the_cached_schema_answers_at_once_and_is_checked_in_the_background(monkeypatch):
    import threading
    checked = threading.Event()

    def load(key):
        runner._SCHEMAS[key] = "TABLE well.new_table"
        checked.set()
        return runner._SCHEMAS[key]

    monkeypatch.setattr(runner, "_SCHEMAS", {})
    monkeypatch.setattr(runner, "_cached_schema", lambda: "TABLE well.well_master")
    monkeypatch.setattr(runner, "_load_schema", load)

    class Db:
        server, port, name = "s", 1433, "d"

    class Settings:
        allowed_schemas, included_tables, excluded_tables, excluded_columns = ("well",), (), (), ()

    class Run:
        db, settings = Db(), Settings()

    assert runner._schema(Run()) == "TABLE well.well_master"        # no database round trip before the question
    assert checked.wait(5) and runner._schema(Run()) == "TABLE well.new_table"   # a changed database: the next question

"""A connection the database drops while a compiled check is tested (SQLSTATE 08S01) is not the SQL's fault: the same
statement runs again, and a link that stays down stops the compile instead of failing the rule or sending sound SQL
back to the author. A genuine SQL error still goes back to the author."""
from __future__ import annotations

import pytest

from app.features.anomaly import compile_graph, dbio
from tests.features.anomaly import _support as S


class LinkDropped(Exception):
    """Shaped like pyodbc's error: (SQLSTATE, message)."""


DROPPED = LinkDropped("08S01", "[08S01] [Microsoft][ODBC Driver 17 for SQL Server]TCP Provider: A connection attempt "
                               "failed (10060) (SQLExecDirectW)")


class Flaky:
    """dbio.connect whose cursor drops the link on the first `drops` statements, then answers as the fake database."""

    def __init__(self, fake_db: S.FakeDb, drops: int) -> None:
        self.fake_db, self.drops, self.connects = fake_db, drops, 0

    def connect(self, **kwargs):
        self.connects += 1
        conn = self.fake_db.connect(**kwargs)
        flaky = self

        class Cursor(S.FakeCursor):
            def execute(self, sql, *params):
                if flaky.drops > 0:
                    flaky.drops -= 1
                    raise DROPPED
                super().execute(sql, *params)

        conn.cursor = lambda: Cursor(self.fake_db)
        return conn


def state() -> dict:
    return {"rule_id": "DQ-T01", "retry_count": 0,
            "summary_sql": "SELECT 'DQ-T01' AS rule_id, 10 AS scope_total, 0 AS anomaly_count FROM well.well_master",
            "detail_sql": ""}


@pytest.fixture(autouse=True)
def _no_pauses(monkeypatch):
    monkeypatch.setattr(compile_graph, "LINK_RETRY_PAUSES", (0.0, 0.0))


def test_a_dropped_connection_runs_the_same_sql_again(fake_db, monkeypatch):
    flaky = Flaky(fake_db, drops=1)
    monkeypatch.setattr(dbio, "connect", flaky.connect)
    with S.feature_context():
        out = compile_graph.executor_node(state())
    assert out["exec_error"] == "" and out["summary_row"][0] == "DQ-T01"
    assert flaky.connects == 2
    assert "retry_count" not in out, "a dropped link is not counted against the SQL's rewrite budget"


def test_a_link_that_stays_down_stops_the_compile_instead_of_failing_the_rule(fake_db, monkeypatch):
    flaky = Flaky(fake_db, drops=10)
    monkeypatch.setattr(dbio, "connect", flaky.connect)
    with S.feature_context(), pytest.raises(dbio.DatabaseUnavailable, match="dropped while testing DQ-T01"):
        compile_graph.executor_node(state())
    assert flaky.connects == len(compile_graph.LINK_RETRY_PAUSES) + 1


def test_a_real_sql_error_still_goes_back_to_the_author(fake_db, monkeypatch):
    class BadSql(Exception):
        pass

    def connect(**kwargs):
        conn = fake_db.connect(**kwargs)

        class Cursor(S.FakeCursor):
            def execute(self, sql, *params):
                raise BadSql("42S22", "[42S22] Invalid column name 'spud_dt'.")

        conn.cursor = lambda: Cursor(fake_db)
        return conn

    monkeypatch.setattr(dbio, "connect", connect)
    with S.feature_context():
        out = compile_graph.executor_node(state())
    assert out["exec_error"] == "[42S22] Invalid column name 'spud_dt'." and out["retry_count"] == 1


def test_a_family_check_that_only_runs_out_of_smoke_test_time_is_kept(monkeypatch):
    """A clone of a family's query that is merely slow on a big table is left for the run to judge, not failed."""
    from app.features.anomaly import compiler
    from app.features.anomaly.model import Probe

    answers = {"slow": "[HYT00] [Microsoft][ODBC Driver 17 for SQL Server]Query timeout expired (0) (SQLExecDirectW)",
               "bad": "[42S22] Invalid column name 'x'."}
    monkeypatch.setattr(compiler, "executor_node", lambda state: {"exec_error": answers[state["rule_id"]]})
    assert compiler.smoke_test(Probe(rule_id="slow", summary_sql="SELECT 1")) == ""
    assert compiler.smoke_test(Probe(rule_id="bad", summary_sql="SELECT 1")) == answers["bad"]

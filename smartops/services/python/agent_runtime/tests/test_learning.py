"""Ask Data's metrics library, learned examples and table links (tools/knowledge.py, tools/links.py)."""
from fastapi.testclient import TestClient

from app.askdata import runner
from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget, Example, Link, Metric, run_context
from app.askdata.tools import knowledge, links
from app.models import AskDataTenantSettings
from tests.seeded_prompts import runtime_texts

SCHEMA = ("TABLE well.well_master\n  - well_id int NOT NULL PK\n  - cluster_code int\n\n"
          "TABLE well.task_daily\n  - well_id int\n  - crew_id int\n  FK: crew_id -> ref.crew.crew_id\n\n"
          "TABLE ref.crew\n  - crew_id int NOT NULL PK\n  - code varchar(30)")


def _run():
    return run_context(AskDataRun(settings=AskDataSettings(), db=DbTarget(server="s", name="n", user="u", password="p"),
                                  texts=runtime_texts()))


def test_a_metric_the_question_names_is_sent_as_its_formula():
    metrics = (Metric("Rig uptime", "sum", "well.rig_day.uptime_hours", "hours worked"), Metric("Crews", "countDistinct", "ref.crew.crew_id"),
               Metric("Tasks", "count"))
    with _run():
        block = knowledge.metrics_block("rig uptime and crews per cluster", metrics)
        assert knowledge.metrics_block("wells per cluster", metrics) == ""
    assert '"Rig uptime" = SUM(well.rig_day.uptime_hours) (hours worked)' in block
    assert '"Crews" = COUNT(DISTINCT ref.crew.crew_id)' in block and "Tasks" not in block
    assert knowledge.formula(metrics[2]) == "COUNT(*)"


def test_the_approved_examples_most_like_the_question_are_sent():
    examples = (Example("How many wells are in Nimr?", "SELECT 1"), Example("Crew attendance by month", "SELECT 2"),
                Example("Wells in Marmul by lift type", "SELECT 3"))
    with _run():
        block = knowledge.examples_block("how many wells in marmul by status", examples)
        assert knowledge.examples_block("total revenue", examples) == ""
    assert block.index("SELECT 3") < block.index("SELECT 1") and "SELECT 2" not in block   # most shared words first


def test_confirmed_links_become_fk_lines_only_for_tables_and_columns_shown():
    shown = (Link("well.task_daily.well_id", "well.well_master.well_id"),
             Link("well.task_daily.crew_id", "ref.crew.crew_id"),                          # the FK is already there
             Link("well.hidden.well_id", "well.well_master.well_id"))                      # a table Ask Data cannot read
    out = knowledge.annotate(SCHEMA, (), shown).split("\n")
    block = out[out.index("TABLE well.task_daily"):out.index("TABLE ref.crew")]
    assert "  FK: well_id -> well.well_master.well_id" in block
    assert sum(line.strip().startswith("FK: crew_id") for line in out) == 1 and "hidden" not in "\n".join(out)


PROFILES = {
    "well.well_master": {"well_id": {"kind": "number", "rows": 841, "empty": 0, "table_rows": 841, "distinct": 841, "min": 1, "max": 900},
                         "pk_id": {"kind": "number", "rows": 841, "empty": 0, "table_rows": 841, "distinct": 841}},
    "well.task_daily": {"well_id": {"kind": "number", "rows": 5000, "empty": 0, "table_rows": 5000, "distinct": 700, "min": 3, "max": 880},
                        "crew_id": {"kind": "number", "rows": 5000, "empty": 0, "table_rows": 5000, "distinct": 40},
                        "pk_id": {"kind": "number", "rows": 5000, "empty": 0, "table_rows": 5000, "distinct": 5000}},
    "ref.crew": {"crew_id": {"kind": "number", "rows": 60, "empty": 0, "table_rows": 60, "distinct": 60}},
    "dbo.vw_old": {"well_id": {"kind": "number", "rows": 10, "empty": 0, "table_rows": None, "distinct": 10, "min": 5000, "max": 9000}},
}


def test_links_are_suggested_to_the_key_table_where_no_fk_joins_them():
    found = links.suggest(PROFILES, SCHEMA)
    assert [(x["from"], x["to"]) for x in found] == [("well.task_daily.well_id", "well.well_master.well_id")]
    # not crew_id (its FK exists), not pk_id (each table's own key), not the view (its ids are outside the range)


def test_tenant_metrics_examples_and_links_reach_the_run_settings_and_the_endpoint():
    s = runner.settings_for(None, AskDataTenantSettings(
        allowed_schemas=["well"], metrics=[{"name": "Rig uptime", "agg": "sum", "column": "well.rig_day.uptime_hours"}],
        examples=[{"question": "Wells in Nimr?", "sql": "SELECT 1"}],
        links=[{"from": "well.task_daily.well_id", "to": "well.well_master.well_id"}]))
    assert s.metrics == (Metric("Rig uptime", "sum", "well.rig_day.uptime_hours", ""),)
    assert s.examples == (Example("Wells in Nimr?", "SELECT 1"),)
    assert s.links == (Link("well.task_daily.well_id", "well.well_master.well_id"),)
    from app.main import app
    body = {"db": {"server": "s", "name": "n", "user": "u", "password": "p"}, "askDataSettings": {"allowedSchemas": ["well"]}}
    assert TestClient(app).post("/api/agent-runtime/askdata/links", json=body).json() == {"links": []}   # profiles off in tests

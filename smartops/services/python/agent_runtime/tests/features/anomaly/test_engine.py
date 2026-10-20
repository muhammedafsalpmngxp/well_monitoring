"""The engine's deterministic parts, ported from the original eval/test_rules.py where the check still means something
in a stateless runtime: the rule parser and the rule dict, families, the probe contract (grain / saturation / dedup
refusals), the safety gate, staleness per probe, probation scoring, the scorer, the Scout's filters, the author's
feedback, context pruning and the report helpers."""
from __future__ import annotations

import pytest

from app.features.anomaly import catalog as staleness
from app.features.anomaly import prompts as pt
from app.features.anomaly.compile_graph import (
    feedback_sections,
    is_read_only,
    probe_status,
    route_after_verifier,
    unknown_tables,
)
from app.features.anomaly.compiler import foreign_columns
from app.features.anomaly.context import build_context, example_conditions, prune_examples, prune_reference, table_index
from app.features.anomaly.contract import (
    check_detail,
    check_summary,
    dedup_problems,
    grain_concerns,
    grain_problems,
    nearly_saturated,
    probe_signature,
    sanity_concerns,
    saturation_problems,
    static_problems,
)
from app.features.anomaly.discover_graph import context_builder, dedup_filter, evidence_check, proposal_hash
from app.features.anomaly.expand import date_pairs, expand_families, missing_tokens, substitute, unfilled_tokens
from app.features.anomaly.introspect import Picture, render_schema
from app.features.anomaly.markdown import next_free_id, parse_markdown
from app.features.anomaly.model import Probe, ProbeResult, Rule, RuleInvalid, load_catalog, load_rules
from app.features.anomaly.report.format import emphasis_runs, sheet_title
from app.features.anomaly.run_graph import partition, rule_set_fingerprint, scorer
from app.features.anomaly.schema_index import load_index
from app.features.anomaly.semantics import semantic_fingerprint

SCHEMA = """TABLE well.well_master  -- 120 rows
  - well_id int NOT NULL PK
  - well_name nvarchar(100)
  - rig_on_date date
  - rig_off_date date
  - progress_pct decimal

TABLE well.task_daily  -- 600 rows
  - task_daily_id int NOT NULL PK
  - task_code nvarchar(50)
  - well_id int
  - start_date date
  - end_date date
  FK: well_id -> well.well_master.well_id

TABLE well.task_history  -- 1,000 rows
  - row_id int NOT NULL
  - task_code nvarchar(50) NOT NULL
  - action_on date
  MANY ROWS PER task_code - de-duplicate (COUNT(DISTINCT ...) or GROUP BY) before counting anything per-task_code

TABLE well.empty_copy  -- EMPTY: 0 rows. Nothing can be found here.
  - id int NOT NULL PK
  - well_id int
  FK: well_id -> well.well_master.well_id
"""
NUMERIC = """NUMERIC HINTS (MEASURED ...):
well.well_master  (120 rows)
  - well_id: 1..120
  - progress_pct: min 0, max 1.4, avg 0.6, stdev 0.2, nulls 8% | PERCENT_100 (0-100) - already a percentage, do NOT multiply
well.task_daily  (600 rows)
  - task_code (text): 30 of 600 values do NOT parse as a number - TRY_CAST is required, and the failures are themselves a finding
"""


def rule(**fields) -> dict:
    return {"ruleId": "DQ-1", "title": "A rule", **fields}


# ── The markdown import (a port of the original loader) ──

MARKDOWN = """# DATA ANOMALIES

# GROUP A - Dates

## RULE DQ-A01 - Rig-on date is missing

- category: Milestone dates
- severity: critical
- entity: well
- tags: milestone, rig
- deadline_days: 14

Wrong: A well has no rig-on date.
Never flag: nothing.

---

## RULE DQ-A02: Pinned check

- sql_mode: pinned
- threshold: 5

```sql summary
SELECT '{{rule_id}}' AS rule_id, COUNT(*) AS scope_total, SUM(CASE WHEN x > {{threshold}} THEN 1 ELSE 0 END) AS anomaly_count FROM well.t
```

```sql detail
SELECT id AS entity_key, x AS evidence_x FROM well.t WHERE x > {{threshold}} ORDER BY x DESC
```

**What is wrong**
The older layout.

# GROUP B - Families

## RULE DQ-G01 - Orphans
- expands_over: foreign_key
- status: disabled

## RULE Negative crew size
## RULE DQ-A01 - Duplicate id
"""


def test_markdown_rules_parse_in_both_layouts():
    rules, errors = parse_markdown([("data_anomalies.md", MARKDOWN)])
    assert [r.rule_id for r in rules] == ["DQ-A01", "DQ-A02", "DQ-G01"]
    a01, a02, g01 = rules
    assert (a01.severity, a01.entity, a01.tags, a01.params) == ("critical", "well", ("milestone", "rig"),
                                                                 {"deadline_days": "14"})
    assert a01.body == "Wrong: A well has no rig-on date.\nNever flag: nothing."      # no trailing --- or group
    assert a02.sql_mode == "pinned" and "'DQ-A02' AS rule_id" in a02.summary_sql and "x > 5" in a02.detail_sql
    assert a02.body == "**What is wrong**\nThe older layout." and "```" not in a02.body
    assert g01.is_family and g01.status == "disabled" and not g01.runnable
    assert any("'## RULE Negative crew size' is not a usable rule heading" in e and "DQ-A03" in e for e in errors)
    assert any("[DQ-A01]: duplicate rule id" in e for e in errors)


@pytest.mark.parametrize("block, problem", [
    ("## RULE DQ-9 - x\n- severity: urgent\n", "severity is 'urgent'"),
    ("## RULE DQ-9 - x\n```sql summary\nSELECT 1\n```\n", "no ```sql detail block"),
    ("## RULE DQ-9 - x\n```sql\nSELECT 1\n```\n", "untagged ```sql block"),
    ("## RULE DQ-9 - x\n- sql_mode: seed\n", "sql_mode is 'seed' but the rule carries no SQL"),
    ("## RULE DQ-9 - x\n- tolerance: auto\n```sql summary\nSELECT {{tolerance}}\n```\n```sql detail\nSELECT 1\n```",
     "set to 'auto'"),
    ("## RULE DQ-9 - x\n```sql summary\nSELECT {{nope}}\n```\n```sql detail\nSELECT 1\n```", "no 'nope:' metadata"),
    ("## RULE DQ-9 - x\n- expands_over: views\n", "not a schema feature"),
])
def test_the_parser_rejects_bad_rules(block, problem):
    rules, errors = parse_markdown([("x.md", block)])
    assert rules == [] and len(errors) == 1 and problem in errors[0] and errors[0].startswith("x.md:1 [DQ-9]")


def test_next_free_id_follows_the_largest_family():
    assert next_free_id(["DQ-A01", "DQ-A02", "DQ-B07"]) == "DQ-A03"
    assert next_free_id(["DQ-S9"]) == "DQ-S10" and next_free_id([]) == ""


# ── The rule dict ──

def test_rule_dict_round_trip_and_validation():
    data = rule(severity="HIGH", tags="a, b", params={"Deadline_Days": 14}, discovery={"reason": "r"})
    r = Rule.from_dict(data)
    assert r.severity == "high" and r.tags == ("a", "b") and r.params == {"deadline_days": "14"}
    again = Rule.from_dict(r.to_dict())
    assert again == r and r.to_dict()["ruleHash"] == r.rule_hash
    for bad, message in ((rule(method="magic"), "method is 'magic'"), (rule(summarySql="SELECT 1"), "PAIR"),
                         (rule(sqlMode="pinned"), "carries no SQL"), ({"title": "x"}, "no ruleId"),
                         (rule(expandsOver="foreign_key", summarySql="a", detailSql="b"), "must not carry"),
                         (rule(title=" "), "no title")):
        with pytest.raises(RuleInvalid, match=message):
            Rule.from_dict(bad)
    rules, errors = load_rules([rule(), rule(), rule(ruleId="DQ-2", status="nope")])
    assert [r.rule_id for r in rules] == ["DQ-1"] and len(errors) == 2


def test_the_rule_hash_covers_the_definition_not_the_status():
    base = Rule.from_dict(rule(body="Wrong: x."))
    assert base.rule_hash == Rule.from_dict(rule(body="Wrong: x.", status="probation", source="discovered",
                                                 discovery={"decided": "2026-01-01"})).rule_hash
    for change in ({"body": "Wrong: y."}, {"severity": "low"}, {"params": {"a": "1"}}, {"tags": ["t"]}):
        assert Rule.from_dict(rule(**{"body": "Wrong: x.", **change})).rule_hash != base.rule_hash


def test_declared_values_include_discovery_provenance():
    r = Rule.from_dict(rule(params={"grace_days": "3"}, source="discovered",
                            discovery={"evidence": "6,054 rows", "decided": "2026-09-25"}))
    assert r.declared_values() == {"grace_days": "3", "source": "discovered", "evidence": "6,054 rows",
                                   "decided": "2026-09-25"}


def test_an_unreadable_catalog_entry_is_skipped_and_an_unknown_status_is_failed():
    catalog = load_catalog([{"ruleId": "A", "status": "weird"}, {"nothing": 1}, "junk", {"ruleId": "B"}])
    assert set(catalog) == {"A", "B"} and catalog["A"].status == "failed" and catalog["B"].status == "active"
    assert Probe.from_dict(catalog["A"].to_dict()) == catalog["A"]


# ── Families ──

def test_families_expand_without_sql(ctx):
    with ctx():
        index = load_index(SCHEMA, NUMERIC)
        rules = [Rule.from_dict(rule(ruleId=f"DQ-G0{i}", title=kind, expandsOver=kind))
                 for i, kind in enumerate(("foreign_key", "duplicate_key", "date_pair", "future_date", "numeric_range",
                                           "text_numeric"), 1)]
        expanded, notes = expand_families(rules, index)
    by_family: dict[str, list[Rule]] = {}
    for r in expanded:
        by_family.setdefault(r.family_id, []).append(r)
    fk = by_family["DQ-G01"]
    assert [r.params["child_table"] for r in fk] == ["well.task_daily"]               # the EMPTY copy is skipped
    assert fk[0].rule_id == "DQ-G01-001" and fk[0].source == "expanded" and not fk[0].has_sql
    assert by_family["DQ-G02"][0].params == {"table": "well.task_history", "key_column": "task_code"}
    assert {(r.params["start_column"], r.params["end_column"]) for r in by_family["DQ-G03"]} == {
        ("rig_on_date", "rig_off_date"), ("start_date", "end_date")}
    assert "DQ-G04" not in by_family and any("DQ-G04 expands over future_date" in n for n in notes)
    assert by_family["DQ-G05"][0].params["upper_bound"] == "1" and by_family["DQ-G06"][0].params["column"] == "task_code"
    assert all(r.is_expanded and not r.is_family for r in expanded)


def test_date_pairs_follow_the_configured_convention(ctx):
    with ctx(settings={"datePairSuffixes": ["_from|_until"], "datePairPrefixes": ["begin|finish"]}):
        index = load_index("TABLE s.t\n  - a_from date\n  - a_until date\n  - begin_x date\n  - finish_x date\n"
                           "  - start_date date\n  - end_date date\n")
        assert date_pairs(index.tables["s.t"]) == [("a_from", "a_until"), ("begin_x", "finish_x")]


def test_tokens_substitute_and_report_what_is_missing():
    sql = "SELECT '{{rule_id}}' FROM {{table}} WHERE [{{column}}] IS NULL AND {{ unknown }} = 1"
    out = substitute(sql, {"rule_id": "DQ-1", "table": "s.t", "column": "c"})
    assert out.startswith("SELECT 'DQ-1' FROM s.t WHERE [c]") and unfilled_tokens(out) == ["unknown"]
    assert missing_tokens(sql, ("table", "entity_column")) == ["entity_column"]


def test_a_clone_naming_a_foreign_column_is_caught():
    index = load_index(SCHEMA)
    assert foreign_columns("SELECT [task_code], [well_id] FROM x", ("well.task_daily",), index) == []
    assert foreign_columns("SELECT [rig_on_date] FROM x WHERE note = '[0, 1]'", ("well.task_daily",), index) == \
        ["rig_on_date"]                                       # a printed interval inside a literal is text
    assert foreign_columns("SELECT [anything]", ("well.unknown",), index) == []       # unverifiable: never fails


# ── The probe contract ──

GOOD_SUMMARY = ("SELECT 'DQ-1' AS rule_id, COUNT(*) AS scope_total, SUM(f) AS anomaly_count, "
                "100.0 * SUM(f) / NULLIF(COUNT(*), 0) AS anomaly_pct FROM well.t")
GOOD_DETAIL = "SELECT id AS entity_key, x AS evidence_x FROM well.t WHERE f = 1 ORDER BY x DESC"


def test_static_contract(ctx):
    with ctx():
        assert static_problems(GOOD_SUMMARY, GOOD_DETAIL, "DQ-1") == []
        problems = static_problems("SELECT COUNT(*) AS scope_total, a / b AS r FROM t -- AS rule_id",
                                   "SELECT TOP 10 id AS entity_key FROM t", "DQ-1")
    text = "\n".join(problems)
    for expected in ("alias a column rule_id", "alias a column anomaly_count", "written exactly 'DQ-1'",
                     "no evidence_* column", "no ORDER BY", "uses TOP", "divides without a NULLIF guard"):
        assert expected in text, expected
    with ctx():
        assert static_problems("", GOOD_DETAIL, "DQ-1") == ["The SUMMARY query is missing entirely. A probe is always "
                                                            "a PAIR."]
        # Words inside literals and comments are not code.
        assert static_problems(GOOD_SUMMARY, GOOD_DETAIL.replace("ORDER BY x DESC", "ORDER BY x DESC -- select top"),
                               "DQ-1") == []


def test_returned_columns_contract():
    assert check_summary(["rule_id", "scope_total", "anomaly_count"], 1) == []
    assert "returned NO rows" in check_summary(["rule_id", "scope_total", "anomaly_count"], 0)[0]
    assert "returned 2 rows" in check_summary(["rule_id", "scope_total", "anomaly_count"], 2)[0]
    assert "missing required column(s): anomaly_count" in check_summary(["rule_id", "scope_total"], 1)[0]
    assert len(check_detail(["entity_label"])) == 2 and check_detail(["entity_key", "evidence_a"]) == []


def test_detail_rows_are_one_per_entity(ctx):
    columns = ["entity_key", "entity_label", "evidence_x"]
    with ctx():
        repeated = [[k % 3, "Task A", 5] for k in range(6)]
        assert "same entity_key more than once" in grain_problems(columns, repeated)[0]
        positional = [[i, f"T{i}", i] for i in range(1, 7)]
        assert "positional row number" in grain_problems(columns, positional)[0]
        history = [[k, "Task A", 5] for k in (11, 23, 37, 41, 55, 68)]
        assert grain_problems(columns, history) == []                       # no grain marker in scope
        refused = grain_problems(columns, history, schema_block=SCHEMA)
        assert "MANY ROWS PER" in refused[0] and "'Task A' appears 6 times" in refused[0] and "task_code" in refused[0]
        assert "the findings repeat" in grain_concerns(columns, history)[0]
        assert grain_problems(columns, history[:4], schema_block=SCHEMA) == []     # below the minimum sample


def test_a_saturated_scope_is_refused_above_the_floor(ctx):
    with ctx():
        assert "not a denominator" in saturation_problems({"scope_total": 50, "anomaly_count": 50})[0]
        assert saturation_problems({"scope_total": 5, "anomaly_count": 5}) == []
        assert "every row in scope is flagged" in sanity_concerns({"scope_total": 5, "anomaly_count": 5})[0]
        assert nearly_saturated(97, 100) and not nearly_saturated(100, 100) and not nearly_saturated(9, 10)
    with ctx(settings={"saturationFloor": 1000}):
        assert saturation_problems({"scope_total": 50, "anomaly_count": 50}) == []


def test_a_dedup_that_reduces_nothing_is_refused(ctx):
    with ctx():
        assert "entire row count of well.task_history" in dedup_problems({"scope_total": 995}, SCHEMA)[0]
        assert dedup_problems({"scope_total": 400}, SCHEMA) == []
        assert dedup_problems({"scope_total": 600}, SCHEMA) == []         # task_daily holds one row per thing


def test_sanity_concerns(ctx):
    with ctx():
        assert "examined NO rows" in sanity_concerns({"scope_total": 0, "anomaly_count": 0})[0]
        assert "impossible" in sanity_concerns({"scope_total": 3, "anomaly_count": 9})[0]
        assert "DETAIL returned 2 rows" in sanity_concerns({"scope_total": 30, "anomaly_count": 3}, 2)[0]
        assert "does not match" in sanity_concerns({"scope_total": 100, "anomaly_count": 3, "anomaly_pct": 30})[0]


def test_two_rules_measuring_the_same_thing_share_a_signature():
    a = ("WITH s AS (SELECT CASE WHEN t.x > 1 THEN 1 ELSE 0 END AS f FROM well.t t WHERE t.y = 2) "
         "SELECT 'A' AS rule_id, COUNT(*) AS scope_total FROM s")
    b = a.replace("'A'", "'B'").replace("t.x", "q.x").replace("well.t t", "well.t q").replace("t.y", "q.y")
    assert probe_signature(a) == probe_signature(b) != ""
    assert probe_signature(a.replace("> 1", "> 2")) != probe_signature(a)
    catalog = {i: Probe(rule_id=i, summary_sql=s, status="active") for i, s in (("A", a), ("B", b))}
    assert staleness.duplicate_probes(catalog) == [("A", "B")]


# ── The safety gate ──

@pytest.mark.parametrize("sql, ok", [
    ("SELECT 1", True), ("WITH a AS (SELECT 1 AS x) SELECT x FROM a", True),
    ("SELECT 'update required' AS note", True), ("SELECT [delete] FROM t", True),
    ("SELECT 1; DROP TABLE t", False), ("SELECT a -- '\nDROP TABLE t -- '", False),
    ("DELETE FROM t", False), ("EXEC sp_who", False), ("SELECT * FROM OPENROWSET('x')", False),
    ("SELECT * INTO t2 FROM t", False), ("", False),
])
def test_the_validator_is_strictly_read_only(sql, ok):
    assert is_read_only(sql)[0] is ok


def test_unknown_tables_are_caught_before_the_database():
    assert unknown_tables("SELECT 1 FROM well.task_daily JOIN well.nope n ON 1=1", SCHEMA) == ["well.nope"]
    assert unknown_tables("SELECT 1 FROM well.nope", "") == []           # no schema to check against: never refuse


# ── The compile graph's decisions ──

def test_the_author_sees_every_outstanding_objection(ctx):
    state = {"summary_sql": "S1", "detail_sql": "D1", "exec_error": "Invalid column name 'x'.",
             "verify_feedback": "Key on the task code, not the row id.", "tried_sql": ["a", "b"]}
    with ctx():
        sections = feedback_sections(state)
    assert sections[0].startswith("YOUR PREVIOUS ATTEMPT WAS:\n\nSUMMARY:\nS1") and "IT FAILED WHEN RUN" in sections[0]
    assert sections[1].startswith("AN INDEPENDENT REVIEWER ALSO REJECTED THIS RULE EARLIER")
    assert "THE REQUIREMENT ABOVE WINS" in sections[1] and "Key on the task code" in sections[1]
    assert sections[1].endswith("make the smallest change that satisfies the feedback.")
    assert sections[2] == ("You have already made 2 attempt(s) at this rule. Each new attempt must differ materially "
                           "from the ones before it.")
    with ctx():
        alone = feedback_sections({"summary_sql": "S", "detail_sql": "D", "verify_feedback": "Fix it."})
    assert "AN INDEPENDENT REVIEWER REJECTED IT.\nWHAT TO FIX:\nFix it." in alone[0]


def test_the_rule_brief_shows_every_declared_value(ctx):
    with ctx():
        brief = pt.rule_brief({"rule_id": "DQ-D02", "title": "x", "category": "c", "severity": "high",
                               "entity": "task", "method": "rule", "tolerance": "auto",
                               "declared": {"placeholder_date": "1900-01-01", "tolerance": "auto"},
                               "grounding_note": "tasks live on task_daily", "body": "Wrong: x."})
    assert brief.splitlines()[1].endswith("| tolerance: auto")
    assert "VALUES DECLARED BY THIS RULE" in brief and "  placeholder_date = 1900-01-01" in brief
    assert "HOW THIS MAPS ONTO THE TABLES: tasks live on task_daily" in brief and brief.endswith("\n\nWrong: x.")


def test_a_zero_scope_probe_is_never_stored_active():
    state = {"summary_sql": "S", "detail_sql": "D", "summary_columns": ["rule_id", "scope_total", "anomaly_count"],
             "summary_row": ["X", 0, 0], "verify_ok": True, "verifier_note": "the join matches nothing"}
    status, error = probe_status(state)
    assert status == "not_applicable" and error.endswith("The reviewer's assessment: the join matches nothing")
    assert probe_status({**state, "summary_row": ["X", 5, 0]}) == ("active", "")
    assert probe_status({**state, "summary_row": ["X", 5, 0], "verify_ok": False,
                         "verify_feedback": "no"})[0] == "failed"


def test_a_pinned_probe_is_never_rewritten(ctx):
    with ctx():
        assert route_after_verifier({"verify_ok": False, "sql_mode": "pinned"}) == "catalog_writer"
        assert route_after_verifier({"verify_ok": False, "sql_mode": "seed", "verify_retry_count": 1}) == "sql_author"
        assert route_after_verifier({"verify_ok": False, "verify_retry_count": 2}) == "catalog_writer"
        repeated = {"verify_ok": False, "verify_retry_count": 1, "tried_sql": ["a", "a"]}
        assert route_after_verifier(repeated) == "catalog_writer"


# ── Staleness, per probe ──

def _probe(rule: Rule, **fields) -> Probe:
    return Probe(rule_id=rule.rule_id, rule_hash=rule.rule_hash, status="active", **fields)


def test_staleness_is_judged_per_probe():
    r = Rule.from_dict(rule())
    signatures = {"s.a": "1", "s.b": "2"}
    probe = _probe(r, tables=("s.a",), table_fingerprint=staleness.probe_fingerprint(("s.a",), signatures),
                   structure_fingerprint="old")
    assert staleness.is_stale(probe, r, "new", False, signatures) == (False, "")    # its own tables did not move
    assert staleness.is_stale(probe, r, "new", False, {**signatures, "s.b": "9"}) == (False, "")
    assert staleness.is_stale(probe, r, "new", False, {**signatures, "s.a": "9"})[1] == \
        "the structure of the tables it reads changed"
    assert "no longer exist" in staleness.is_stale(probe, r, "new", False, {"s.b": "2"})[1]
    legacy = _probe(r, structure_fingerprint="old")
    assert staleness.is_stale(legacy, r, "new", False, {})[1] == "the database structure changed"
    assert staleness.is_stale(None, r, "x")[1] == "not compiled yet"
    assert staleness.is_stale(_probe(Rule.from_dict(rule(body="other"))), r, "")[1] == "the rule definition changed"
    failed = Probe(rule_id=r.rule_id, rule_hash=r.rule_hash, status="failed")
    assert not staleness.is_stale(failed, r, "")[0] and staleness.is_stale(failed, r, "", True)[0]


def test_semantic_drift_is_detected_but_survives_a_data_reload():
    tables = ("well.well_master",)
    before = semantic_fingerprint(tables, SCHEMA, "", NUMERIC)
    reload = NUMERIC.replace("max 1.4, avg 0.6", "max 1.2, avg 0.7").replace("(120 rows)", "(130 rows)")
    assert semantic_fingerprint(tables, SCHEMA, "", reload) == before != ""
    flipped = NUMERIC.replace("PERCENT_100 (0-100) - already a percentage, do NOT multiply",
                              "FRACTION_1 (0-1) - multiply by 100 to report a percentage")
    assert semantic_fingerprint(tables, SCHEMA, "", flipped) != before
    r = Rule.from_dict(rule())
    probe = _probe(r, tables=tables, semantic_fingerprint=before)
    assert "MEASURED MEANING" in staleness.is_stale(probe, r, "", False, None, "different")[1]
    assert staleness.is_stale(probe, r, "", False, None, "")[0] is False            # unknown never invalidates


def test_switched_off_rules_never_run_and_rejected_ones_are_not_reported():
    rules = {r.rule_id: r for r in (Rule.from_dict(rule(ruleId=i, status=s)) for i, s in (
        ("A", "active"), ("B", "disabled"), ("C", "rejected"), ("D", "probation"), ("E", "active")))}
    probes = [Probe(rule_id=i, status="failed" if i == "E" else "active", error="boom" if i == "E" else "")
              for i in rules]
    run, not_running = partition(probes, rules, {"D": "the structure moved"})
    assert [p.rule_id for p in run] == ["A"]
    assert [(n["rule_id"], n["status"], n["reason"]) for n in not_running] == [
        ("B", "disabled", "the rule is disabled"), ("D", "stale", "the structure moved"), ("E", "failed", "boom")]
    catalog = {i: Probe(rule_id=i) for i in "ABC"}
    assert staleness.prune_removed(catalog, {"A"}) == ["B", "C"] and set(catalog) == {"A"}


# ── Scoring ──

def test_probation_runs_but_is_never_scored(ctx):
    rules = {"A": Rule.from_dict(rule(ruleId="A", severity="critical")),
             "B": Rule.from_dict(rule(ruleId="B", severity="low")),
             "P": Rule.from_dict(rule(ruleId="P", severity="critical", status="probation")),
             "Z": Rule.from_dict(rule(ruleId="Z"))}
    results = [ProbeResult("A", scope_total=100, anomaly_count=10), ProbeResult("B", scope_total=1000),
               ProbeResult("P", scope_total=50, anomaly_count=50), ProbeResult("Z", scope_total=0),
               ProbeResult("F", ok=False, error="x")]
    with ctx():
        out = scorer(results, rules, [{"rule_id": "N"}])
        without = scorer([r for r in results if r.rule_id != "P"], rules, [{"rule_id": "N"}])
    assert out["score"] == without["score"] == round(100 * (1 - (40 * 0.1) / (40 + 5)), 1)
    assert out["rule_set_fingerprint"] == without["rule_set_fingerprint"] != ""
    assert out["totals"] == {"probes_run": 4, "probes_failed": 1, "probes_clean": 1, "probes_with_findings": 1,
                             "probes_empty_scope": 1, "records_examined": 1100, "records_flagged": 10,
                             "not_running": 1}
    assert out["empty_scope"] == ["Z"] and [r["rule_id"] for r in out["ranked"]] == ["A"]
    assert [r["rule_id"] for r in out["discovered_ranked"]] == ["P"] and out["discovered_totals"]["records_flagged"] == 50
    assert out["by_severity"]["critical"] == 1 and out["by_category"][0]["anomalies"] == 10


def test_a_score_records_which_checks_produced_it():
    rules = {"A": Rule.from_dict(rule(ruleId="A")), "B": Rule.from_dict(rule(ruleId="B", severity="low"))}
    one = rule_set_fingerprint([ProbeResult("A"), ProbeResult("B")], rules)
    assert one == rule_set_fingerprint([ProbeResult("B"), ProbeResult("A")], rules)
    rules["B"] = Rule.from_dict(rule(ruleId="B", severity="critical"))
    assert rule_set_fingerprint([ProbeResult("A"), ProbeResult("B")], rules) != one


def test_the_severity_weights_come_from_the_settings(ctx):
    rules = {"A": Rule.from_dict(rule(ruleId="A", severity="critical")),
             "B": Rule.from_dict(rule(ruleId="B", severity="low"))}
    results = [ProbeResult("A", scope_total=10, anomaly_count=10), ProbeResult("B", scope_total=10)]
    with ctx(settings={"severityWeights": {"critical": 1, "low": 1}}):
        out = scorer(results, rules, [])
    assert out["score"] == 50.0 and "critical 1, low 1" in out["score_basis"]


# ── Discover ──

def test_context_builder_measures_and_numbers_observations(ctx):
    with ctx():
        observations = context_builder(Picture(SCHEMA, "", NUMERIC), load_index(SCHEMA, NUMERIC))
    kinds = {o["kind"] for o in observations}
    assert {"unconstrained_key", "out_of_range", "unreadable_number", "history_grain"} <= kinds
    assert [o["id"] for o in observations] == [f"OBS-{n:03d}" for n in range(1, len(observations) + 1)]
    history = next(o for o in observations if o["kind"] == "history_grain")
    assert history["table"] == "well.task_history" and history["column"] == "task_code"


def test_evidence_check_and_dedup_filter(ctx):
    observations = [{"id": "OBS-001", "fact": "measured fact", "table": "well.t"}]
    base = {"what_is_wrong": "w", "why_it_matters": "m", "how_to_detect": "d"}
    proposals = [{"title": "Kept", **base, "observation_id": "obs-001"},
                 {"title": "No id", **base}, {"title": "Wrong id", **base, "observation_id": "OBS-7"},
                 {"title": "Incomplete", "observation_id": "OBS-001"}]
    dropped: list = []
    kept = evidence_check(proposals, observations, dropped)
    assert [p["title"] for p in kept] == ["Kept"] and kept[0]["observation_fact"] == "measured fact"
    assert kept[0]["evidence"] == "measured fact" and kept[0]["tables"] == ["well.t"]
    assert [d["reason"] for d in dropped] == ["no evidence", "evidence not found", "incomplete"]
    with ctx():
        covered = [{"rule_id": "DQ-1", "title": "Task finished before it started", "category": "", "tags": ""}]
        rejected = [{"rule_id": "DQ-S3", "title": "Crew roster gaps", "reason": "by design"}]
        candidates = [
            {"title": "Task finished before it started", "what_is_wrong": "a task finished before it started",
             "how_to_detect": "compare the dates"},
            {"title": "Crew roster has gaps", "what_is_wrong": "a crew roster gap", "how_to_detect": "roster dates"},
            {"title": "Pipe joints welded twice", "what_is_wrong": "joint welded twice", "how_to_detect": "count welds"},
            {"title": "Pipe joints welded twice again", "what_is_wrong": "joint welded twice",
             "how_to_detect": "count welds"}]
        dropped = []
        kept = dedup_filter(candidates, covered, rejected, dropped)
    assert [p["title"] for p in kept] == ["Pipe joints welded twice"]
    assert [d["reason"] for d in dropped] == ["already covered", "previously refused", "duplicate"]
    assert "refused because: by design" in dropped[1]["detail"]


def test_a_proposal_keeps_its_handle_when_reworded_in_order():
    a = {"title": "Task names a missing well", "how_to_detect": "compare task wells", "tables": ["s.t"]}
    b = {"title": "missing well Task names a", "how_to_detect": "compare task wells", "tables": ["s.t"]}
    assert proposal_hash(a) == proposal_hash(b) != proposal_hash({**a, "tables": ["s.u"]})


# ── Context pruning ──

def test_the_schema_is_pruned_only_when_it_pays(ctx):
    with ctx(settings={"schemaPruneAboveTables": 0}):
        block, hints, tables = build_context(SCHEMA, "", NUMERIC, ["task_history"])
        assert tables == ["well.task_history"] and "TABLE well.task_daily" not in block and hints == ""
        _, _, tables = build_context(SCHEMA, "", NUMERIC, ["well.well_master"])
        assert set(tables) == {"well.well_master", "well.task_daily", "well.empty_copy"} \
            or set(tables) == set(load_index(SCHEMA).tables)                    # neighbours, else the full schema
        assert build_context(SCHEMA, "", NUMERIC, ["nothing.here"])[2] == list(load_index(SCHEMA).tables)
    with ctx():
        assert build_context(SCHEMA, "", NUMERIC, ["task_history"])[0] == SCHEMA    # small database: never pruned


def test_the_table_index_states_row_counts():
    index = table_index(SCHEMA)
    assert "well.task_daily [600 rows]: task_daily_id, task_code, well_id, start_date, end_date" in index
    assert "well.empty_copy [EMPTY - nothing can be found here]: id, well_id" in index


def test_reference_pruning_never_starves_a_rule(ctx):
    sections = "\n".join(f"## Section {i}\n" + (f"topic{i} " * 300) for i in range(6))
    with ctx():
        pruned = prune_reference(sections, "a rule about topic2 only", ())
        assert "## Section 2" in pruned and "## Section 4" not in pruned
        assert "## Section 4" in prune_reference(sections, "a rule about topic2", ("topic4",))   # its own tag
        assert prune_reference(sections, "", ()) == sections
    with ctx(settings={"referencePrune": False}):
        assert prune_reference(sections, "a rule about topic2 only", ()) == sections


def test_worked_examples_are_cut_only_by_their_declaration(ctx):
    examples = ("Intro\n\n## 1. Scope\n- applies: always\nA\n\n## 2. Grain\n- applies: grain\nB\n\n"
                "## 3. Undeclared\nC\n")
    with ctx():
        assert prune_examples(examples, {"always"}) == "Intro\n\n## 1. Scope\n- applies: always\nA\n\n" \
                                                       "## 3. Undeclared\nC"
        assert example_conditions(SCHEMA, "x nulls 55%", "statistical", "") == {"always", "grain", "scale", "nulls",
                                                                                 "threshold"}


# ── Introspection round trip and report helpers ──

def test_every_reader_of_the_schema_text_understands_the_writer():
    text = render_schema({"s.t": [("id", "int", None, "NO"), ("order", "nvarchar", 10, "YES")],
                          "s.u": [("k", "int", None, "NO")]},
                         {"s.t": {"id"}}, {"s.t": ["order -> s.u.k"]}, {"s.u": "k"}, {"s.t": 1234, "s.u": 0})
    index = load_index(text)
    t = index.tables["s.t"]
    assert t.row_count == 1234 and t.pk_columns == ["id"] and t.column("order") is not None
    assert t.foreign_keys[0].parent_table == "s.u" and index.tables["s.u"].row_count == 0
    assert index.tables["s.u"].duplicate_key == "k" and "  - [order] nvarchar(10)" in text


def test_sheet_titles_and_emphasis():
    used: set[str] = {"Summary"}
    assert sheet_title("DQ-1 a/b:c*d?[e]", used) == "DQ-1 a b c d e"
    long = "x" * 40
    assert sheet_title(long, used) == "x" * 31 and sheet_title(long, used) == "x" * 27 + " (2)"
    assert emphasis_runs("Most **3** records") == [("Most ", False), ("3", True), (" records", False)]

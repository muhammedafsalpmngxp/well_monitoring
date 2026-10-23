"""The seed (prompts, settings, verified SQL, access) against the engine: every query passes the read-only gate and
the access list, every prompt the code reads exists, every placeholder is filled, every setting the model needs
has a definition."""
from __future__ import annotations

import re

import pytest

from app.askdata.common.readonly import assert_read_only
from app.features.common import access
from app.features.common.models import FeatureAccess
from app.features.dailyreport import data
from app.features.dailyreport.agent.tools import TOOLS
from app.features.dailyreport.settings import DailyReportSettings, load_settings
from app.features.dailyreport.texts import parse_entries, parse_tool
from tests.features import _seed
from tests.features.dailyreport.conftest import seed_access, seed_prompts, seed_queries, seed_settings

CAPABILITIES = [data.DAILY_SUMMARY, data.DAILY_DETAILS, data.WELL_ACTIVITY, data.WELL_DETAIL, data.MILESTONES,
                data.CREW_SUGGESTION, data.ACTIVITY_DATES]
#: The parameters the engine binds, by capability.
PARAMS = {data.DAILY_SUMMARY: ["report_date"], data.DAILY_DETAILS: ["report_date"], data.WELL_ACTIVITY: ["report_date"],
          data.WELL_DETAIL: ["report_date"], data.MILESTONES: [], data.CREW_SUGGESTION: [
              "report_date", "well_id", "task_code"], data.ACTIVITY_DATES: ["limit"]}

#: prompt -> the placeholders the engine fills (entry lists: entry name -> placeholders).
TEMPLATES = {
    "explain_system": set(), "writer_addendum": {"WORD_LIMIT"}, "planner_system": {"MAX_STEPS"},
    "planner_user": {"REPORT_DATE", "TOOLS", "QUESTION"}, "writer_user": {"REPORT_DATE", "QUESTION", "TOOL_RESULTS"},
    "writer_revision": {"ISSUES", "DRAFT"}, "writer_patch": {"ISSUES", "DRAFT", "COUNT", "SENTENCES"},
    "verifier_system": set(), "verifier_user": {"TOOL_RESULTS", "DRAFT"},
    "tool_unavailable_note": set(), "tool_deadline_rule": {"WINDOW_DAYS"}, "tool_data_quality_note": set(),
    "evidence_no_daily_entry_note": set(), "evidence_quantities_withheld": set(), "evidence_data_quality_note": set(),
    "evidence_tasks_truncated_note": set(), "well_ongoing_truncated_note": set(), "day_wells_truncated_note": set(),
    "answer_unanswerable": {"REASON"}, "answer_nothing_to_explain": set(),
}
ENTRIES = {
    "verifier_issues": {"date": {"DATE"}, "figure": {"FIGURE"}, "judgement": {"PHRASE"}, "field_name": {"FIELD"}},
    "tool_errors": {"unknown_tool": {"TOOL"}, "required": {"NAME"}, "whole_number": {"NAME", "VALUE"},
                    "one_of": {"NAME", "OPTIONS"}, "no_task": {"TASK_DAILY_ID", "REPORT_DATE"}, "failed": {"DETAIL"}},
    "crew_no_suggestion_reasons": {"unmapped_activity": set(), "no_history": set(), "all_busy": set()},
    "evidence_status_definitions": {k: set() for k in ("ON_PLAN", "ABOVE_PLAN", "BELOW_PLAN", "NO_ACTUAL",
                                                       "NOT_VALIDATED")},
    "evidence_crew_match_definitions": {k: set() for k in ("MATCHED", "MISMATCHED", "NOT_COMPARABLE")},
    "evidence_date_status_definitions": {k: set() for k in ("ON_TIME", "EARLY", "LATE", "NO_ACTUAL", "NOT_VALIDATED")},
    "evidence_constraints": {}, "well_activity_definitions": {}, "task_state_definitions": {
        k: set() for k in ("COMPLETED", "ONGOING", "NOT_STARTED", "ENDED_NOT_COMPLETED")},
    "well_activity_constraints": {}, "day_activity_definitions": {}, "day_activity_constraints": {},
}
_TOKEN = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")


@pytest.mark.parametrize("key", CAPABILITIES)
def test_each_query_is_read_only_and_within_the_access_list(key):
    query = seed_queries()[key]
    assert_read_only(query["sql"])
    access.check(query["sql"], FeatureAccess.model_validate(seed_access()), "Daily Report")
    assert "{{include" not in query["sql"].replace("{{include:...}}", "")


@pytest.mark.parametrize("key", CAPABILITIES)
def test_each_query_binds_what_the_engine_provides(key):
    query = seed_queries()[key]
    assert query["params"] == PARAMS[key]
    assert query["columns"], "every query states its output contract"


def test_the_access_list_is_exactly_the_tables_the_queries_read():
    read = set().union(*(access.referenced_tables(q["sql"]) for q in seed_queries().values()))
    assert set(seed_access()["includedTables"]) == read


def test_every_prompt_the_engine_reads_exists_with_its_placeholders():
    prompts = seed_prompts()
    expected = {f"dailyreport.{k}" for k in [*TEMPLATES, *ENTRIES]} | {f"dailyreport.tool_{n}" for n in TOOLS}
    assert set(prompts) == expected
    for name, placeholders in TEMPLATES.items():
        assert set(_TOKEN.findall(prompts[f"dailyreport.{name}"])) == placeholders, name
    for name, entries in ENTRIES.items():
        parsed = parse_entries(prompts[f"dailyreport.{name}"])
        assert parsed and all(parsed.values()), name
        for entry, placeholders in entries.items():
            assert set(_TOKEN.findall(parsed[entry])) == placeholders, (name, entry)


def test_every_tool_description_covers_its_arguments():
    prompts = seed_prompts()
    for name, tool in TOOLS.items():
        description, args = parse_tool(prompts[f"dailyreport.tool_{name}"])
        assert description and list(args) == list(tool.params), name


def test_the_prompts_keep_the_original_strings():
    prompts = seed_prompts()
    assert prompts["dailyreport.explain_system"].startswith("You are an operational data explanation assistant.")
    assert "ALWAYS give a crew's id the first time you mention that crew" in prompts["dailyreport.explain_system"]
    assert prompts["dailyreport.explain_system"].endswith("based on the evidence available then.")
    assert prompts["dailyreport.planner_system"].startswith("You plan read-only data lookups")
    assert prompts["dailyreport.writer_addendum"].startswith("YOU ARE NOW WRITING FROM SEVERAL TOOL RESULTS AT ONCE.")
    assert prompts["dailyreport.verifier_system"].endswith("Wording, style and length are not issues.")
    seed = _seed.feature_seed("dailyreport")
    frag = {p["key"]: p for p in (_seed._fragment("dailyreport", "prompts.json") or {"prompts": []})["prompts"]}
    if frag:
        assert frag["dailyreport.planner_system"]["replyKeys"] == ["steps", "unanswerable_reason"]
        assert frag["dailyreport.verifier_system"]["replyKeys"] == ["ok", "issues"]
    assert seed["queries"]


def test_the_settings_definitions_match_the_model():
    definitions = _seed.feature_seed("dailyreport")["settings"]
    keys = [d["key"] for d in definitions]
    assert len(keys) == len(set(keys))
    aliases = {field.alias for field in DailyReportSettings.model_fields.values()}
    assert set(keys) == aliases
    for definition in definitions:
        assert definition["type"] in {"int", "decimal", "bool", "text", "list", "enum"}
        if definition["type"] == "enum":
            assert definition["default"] in definition["options"]
    load_settings(seed_settings())


def test_a_missing_setting_names_itself():
    raw = seed_settings()
    raw.pop("agentMaxToolCalls")
    with pytest.raises(ValueError, match="agentMaxToolCalls"):
        load_settings(raw)

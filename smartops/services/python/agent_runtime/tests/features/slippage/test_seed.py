"""The seed texts reproduce the ORIGINAL advisor prompts, and the seed (prompts, settings, queries, access) matches
what the code reads."""
from __future__ import annotations

import re

import pytest

from app.askdata.common.readonly import assert_read_only
from app.features.common.access import referenced_tables
from app.features.slippage import prompts, queries
from app.features.slippage.settings import SlippageSettings
from app.prompt_text import fill
from tests.features.slippage import _support as S

pytestmark = S.requires_seed

_TOKEN = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")

# Every placeholder the code fills, per prompt (anything else in a template would be sent to the model as written).
PLACEHOLDERS = {
    "task_glossary": {"RISK_RED", "RISK_AMBER_START_SLIPPING", "RISK_AMBER_START_DELAYED", "RISK_GREEN",
                      "END_STATUSES", "START_STATUSES", "EXECUTION_STATUSES", "CREW_AVAILABLE", "CREW_BUSY"},
    "advisor_grounding": {"BUSINESS_RULES", "SCENARIOS", "TASK_GLOSSARY"},
    "advisor_task_system": {"GROUNDING"},
    "advisor_well_system": {"GROUNDING"},
    "advisor_task_message": {"WELL_ID", "TASK", "EARLIER_LATE_TASKS", "SAME_WBS_LATE_TASKS", "MILESTONES",
                             "ASSIGNED_CREW_ID", "ASSIGNED_CREW", "CREW_TYPE_ID", "AVAILABLE_COUNT", "BUSY_COUNT",
                             "TYPE_TOTAL", "AVAILABLE_CREWS", "NOTE"},
    "advisor_well_message": {"WELL_ID", "MILESTONES", "TASK_TALLY", "LATE_BY_WBS", "LATE_BY_CREW_TYPE", "MOST_URGENT",
                             "NOTE"},
    "msg_task_milestones_listed": {"HEADLINE", "MILESTONE_LINES"},
    "msg_well_milestones_listed": {"HEADLINE", "MILESTONE_LINES"},
    "msg_task_milestones_unknown": {"NOTE"},
    "msg_well_milestones_unknown": {"NOTE"},
    "msg_note": {"NOTE"},
}


# -- The original prompts, exactly --------------------------------------------------------------------------------


def test_system_prompts_reproduce_the_original_exactly(body, ctx):
    """prompt_text.text() trims every prompt, so the original's single trailing newline is the only difference."""
    with ctx(body) as (_, cfg):
        assert prompts.task_system(cfg) == S.ORIGINAL["advisor_task_system"].rstrip("\n")
        assert prompts.well_system(cfg) == S.ORIGINAL["advisor_well_system"].rstrip("\n")
    assert S.ORIGINAL["advisor_task_system"].endswith("}\n") and S.ORIGINAL["advisor_well_system"].endswith("}\n")


def test_generated_blocks_reproduce_the_original(body, ctx):
    with ctx(body) as (_, cfg):
        assert prompts.text("scenarios") == S.ORIGINAL["scenarios"]
        glossary = prompts.grounding(cfg).split("</slippage_scenarios>\n\n", 1)[1]
        assert glossary == S.ORIGINAL["task_glossary"]
        assert prompts.grounding(cfg).startswith("<business_rules>\n# BUSINESS RULES")


def test_glossary_vocabulary_is_filled_from_the_settings(body, ctx):
    body["settings"].update(riskGreen="ON_TRACK", endStatuses=["LATE", "EARLY"], crewBusy="WORKING")
    with ctx(body) as (_, cfg):
        system = prompts.well_system(cfg)
    assert "{RISK_GREEN}" not in system and "started later than planned; ON_TRACK = otherwise." in system
    assert "- end_status: LATE | EARLY." in system and "WORKING = at least one of its tasks" in system


def test_a_placeholder_inside_a_value_is_not_filled_again(body, ctx):
    body["prompts"]["slippage.business_rules"] = "Rule: write {GROUNDING} and {WELL_ID} literally."
    with ctx(body) as (_, cfg):
        assert "Rule: write {GROUNDING} and {WELL_ID} literally." in prompts.task_system(cfg)


# -- Seed consistency ---------------------------------------------------------------------------------------------


def test_every_prompt_the_code_reads_is_seeded_and_nothing_else():
    assert set(S.SEED_PROMPTS) == set(prompts.KEYS)
    assert all(S.SEED_PROMPTS[k].strip() for k in prompts.KEYS)


def test_templates_use_only_placeholders_the_code_fills():
    for key in prompts.KEYS:
        name = key.removeprefix("slippage.")
        found = set(_TOKEN.findall(S.SEED_PROMPTS[key]))
        assert found == PLACEHOLDERS.get(name, set()), key


def test_prompt_definitions():
    if not S.SEED_PROMPT_DEFS:
        pytest.skip("the Slippage seed is not merged yet")
    for p in S.SEED_PROMPT_DEFS:
        assert set(p) == {"key", "name", "description", "text", "replyKeys", "allowEmpty"}, p["key"]
        assert p["name"] and p["description"] and p["allowEmpty"] is False
    reply = {p["key"]: p["replyKeys"] for p in S.SEED_PROMPT_DEFS}
    assert reply["slippage.advisor_task_system"] == ["summary", "caused_by_other_delay", "causes", "actions",
                                                     "checks", "caveats"]
    assert reply["slippage.advisor_well_system"] == ["description", "delayed", "why_delayed", "actions", "checks",
                                                     "caveats"]
    assert all(not v for k, v in reply.items() if not k.endswith("_system"))
    for key in ("slippage.advisor_task_system", "slippage.advisor_well_system"):
        for name in reply[key]:
            assert f'"{name}"' in S.SEED_PROMPTS[key]                  # the reply format names every parsed key


def test_settings_definitions_match_the_settings_model():
    aliases = {f.alias for f in SlippageSettings.model_fields.values()}
    assert {s["key"] for s in S.SEED_SETTING_DEFS} == aliases
    for s in S.SEED_SETTING_DEFS:
        assert {"key", "label", "help", "group", "type", "default"} <= set(s), s["key"]
        assert s["type"] in {"int", "decimal", "bool", "text", "list", "enum"}
        if s["type"] == "enum":
            assert s["default"] in s["options"]
        if "min" in s:
            assert s["min"] <= s["default"] <= s["max"], s["key"]
    SlippageSettings.model_validate(S.SEED_SETTINGS)                  # the defaults are a valid configuration


def test_settings_model_has_no_defaults():
    assert all(f.is_required() for f in SlippageSettings.model_fields.values())


def test_queries_are_the_four_verified_read_only_statements():
    assert [q["key"] for q in S.SEED_QUERY_DEFS] == list(queries.KEYS)
    allowed = {t.lower() for t in S.SEED_ACCESS["includedTables"]}
    read = set()
    for q in S.SEED_QUERY_DEFS:
        assert q["label"] and q["description"] and q["columns"], q["key"]
        assert "frozen SQL below" not in q["sql"] and not q["sql"].startswith("--")   # no provenance header
        assert_read_only(q["sql"])
        assert queries.placeholders(q["sql"]) == len(q["params"])
        read |= referenced_tables(q["sql"])
    assert S.SEED_QUERIES["activity_delay"]["params"] == ["well_id"]
    assert read == allowed                                            # access lists exactly what the queries read


def test_seed_milestones_match_the_listing_contract():
    columns = set(S.SEED_QUERIES["well_slippage"]["columns"])
    cfg = SlippageSettings.model_validate(S.SEED_SETTINGS)
    for m in cfg.milestone_list:
        assert {f"{m.prefix}_{p}" for p in ("deadline", "actual", "status", "variance_days")} <= columns


def test_fill_is_single_pass():
    assert fill("{A} {B}", A="{B}", B="x") == "{B} x"

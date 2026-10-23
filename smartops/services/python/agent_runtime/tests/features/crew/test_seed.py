"""The seed (prompts, settings, queries, access) matches what the Crew Management code reads."""
from __future__ import annotations

import re

from app.askdata.common.readonly import assert_read_only
from app.features.common.access import referenced_tables
from app.features.crew import prompts, queries
from app.features.crew.settings import CrewSettings
from tests.features.crew import _support as S

pytestmark = S.requires_seed

_TOKEN = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")
PLACEHOLDERS = {"brief_system": {"RULES", "TASK"}, "brief_message": {"EVIDENCE"}}


def test_every_prompt_the_code_reads_is_seeded_and_nothing_else():
    assert set(S.SEED_PROMPTS) == set(prompts.KEYS)
    assert all(S.SEED_PROMPTS[k].strip() for k in prompts.KEYS)


def test_templates_use_only_placeholders_the_code_fills():
    for key in prompts.KEYS:
        found = set(_TOKEN.findall(S.SEED_PROMPTS[key]))
        assert found == PLACEHOLDERS.get(key.removeprefix("crew."), set()), key


def test_prompt_definitions():
    for p in S.SEED_PROMPT_DEFS:
        assert set(p) == {"key", "name", "description", "text", "replyKeys", "allowEmpty"}, p["key"]
        assert p["name"] and p["description"] and p["allowEmpty"] is False and p["replyKeys"] == []


def test_settings_definitions_match_the_settings_model():
    aliases = {f.alias for f in CrewSettings.model_fields.values()}
    assert {s["key"] for s in S.SEED_SETTING_DEFS} == aliases
    for s in S.SEED_SETTING_DEFS:
        assert {"key", "label", "help", "group", "type", "default"} <= set(s), s["key"]
        assert s["type"] in {"int", "decimal", "bool", "text", "list", "enum"}
        if s["type"] == "enum":
            assert s["default"] in s["options"]
        if "min" in s:
            assert s["min"] <= s["default"] <= s["max"], s["key"]
    CrewSettings.model_validate(S.SEED_SETTINGS)


def test_settings_model_has_no_defaults():
    assert all(f.is_required() for f in CrewSettings.model_fields.values())


def test_queries_are_the_verified_read_only_statements_and_access_lists_what_they_read():
    assert [q["key"] for q in S.SEED_QUERY_DEFS] == list(queries.KEYS)
    allowed = {t.lower() for t in S.SEED_ACCESS["includedTables"]}
    read = set()
    for q in S.SEED_QUERY_DEFS:
        assert q["label"] and q["description"] and q["columns"], q["key"]
        assert "AlTasnimBI" not in q["sql"], q["key"]                  # two-part names: the tenant's own database
        assert_read_only(q["sql"])
        assert queries.placeholders(q["sql"]) == len(q["params"]), q["key"]
        assert set(q["params"]) <= queries.PARAMS, q["key"]
        read |= referenced_tables(q["sql"])
    assert read == allowed
    assert S.SEED_QUERIES[queries.DELAYED]["params"] == ["well_id"]
    assert S.SEED_QUERIES[queries.BOARD]["params"] == ["recent_days"]
    assert S.SEED_QUERIES[queries.EXPERIENCE]["params"] == ["activity_codes"]

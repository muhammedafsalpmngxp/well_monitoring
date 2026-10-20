"""The seed (prompts, settings, access, rules) matches what the code reads: every prompt key the engine uses is seeded
and nothing else, every template uses only the placeholders the code fills, every settings key is a field of the
settings model (which has no defaults), and every seeded rule loads."""
from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path

import pytest

from app.features.anomaly import prompts as pt
from app.features.anomaly.config import AnomalySettings, parse
from app.features.anomaly.model import STATUSES, load_rules
from app.prompt_text import fill
from tests.features.anomaly import _support as S

_TOKEN = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")
PACKAGE = Path(pt.__file__).parent

# Every placeholder the code fills, per prompt (anything else in a template would be sent to the model as written).
PLACEHOLDERS: dict[str, set[str]] = {
    "author_system": {"PLATFORM_PREAMBLE", "PROBE_CONTRACT", "TSQL_KNOWLEDGE", "MEASUREMENT_RULES", "BUSINESS_RULES",
                      "FEW_SHOTS"},
    "verifier_system": {"BUSINESS_RULES", "SAMPLE_ROWS"},
    "scout_system": {"MAX_PROPOSALS", "BUSINESS_RULES"},
    "rule_mapping": {"NOTE"},
    "grounding_user": {"TABLE_INDEX", "RULE"},
    "author_schema": {"SCHEMA"}, "author_patterns": {"PATTERNS"}, "author_rule": {"RULE"},
    "author_seed": {"SEED_SUMMARY", "SEED_DETAIL"}, "author_concerns": {"CONCERNS"},
    "author_family": {"FEATURE_KIND", "TOKENS"}, "author_previous": {"SUMMARY_SQL", "DETAIL_SQL"},
    "author_rejected_validation": {"PREVIOUS", "ERROR"}, "author_rejected_exec": {"PREVIOUS", "ERROR"},
    "author_rejected_contract": {"PREVIOUS", "ERROR"}, "author_reviewer_also": {"FEEDBACK"},
    "author_reviewer_rejected": {"PREVIOUS", "FEEDBACK"}, "author_attempts": {"ATTEMPTS"},
    "verifier_schema": {"SCHEMA"}, "verifier_hints": {"HINTS"}, "verifier_rule": {"RULE"},
    "verifier_probe": {"SUMMARY_SQL", "DETAIL_SQL"}, "verifier_returned": {"SUMMARY_ROW", "SAMPLE_ROWS", "DETAIL_SAMPLE"},
    "verifier_concerns": {"CONCERNS"}, "verifier_advice": {"ADVICE"}, "verifier_history": {"HISTORY"},
    "table_more": {"COUNT"},
    "summarizer_headline": {"SCORE", "PROBES_RUN", "WITH_FINDINGS", "CLEAN", "FAILED", "EXAMINED", "FLAGGED"},
    "summarizer_findings": {"ROWS"}, "summarizer_findings_more": {"COUNT", "RECORDS"},
    "summarizer_examples": {"SAMPLE_ROWS", "EXAMPLES"}, "summarizer_example_for": {"TITLE", "TABLE"},
    "summarizer_near_saturated": {"COUNT", "NAMED"}, "summarizer_saturated": {"COUNT", "NAMED"},
    "summarizer_coverage_gaps": {"COUNT"}, "summarizer_not_running": {"COUNT"},
    "scout_observations": {"OBSERVATIONS"}, "scout_schema": {"SCHEMA"}, "scout_covered": {"COVERED"},
    "scout_not_expressible": {"RULES"}, "scout_refused": {"REFUSED"}, "scout_final": {"MAX_PROPOSALS"},
}


def _declared_keys() -> set[str]:
    return {value for name, value in vars(pt).items()
            if name.isupper() and isinstance(value, str) and value.startswith(pt.P) and value != pt.P}


def _keys_used_in_code() -> set[str]:
    """Every pt.<CONSTANT> referenced by the engine (outside prompts.py, plus prompts.py's own builders)."""
    names: set[str] = set()
    for path in PACKAGE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "pt":
                names.add(node.attr)
    for fn in (pt.author_system, pt.verifier_system, pt.scout_system, pt.rows_to_table, pt.summary_line,
               pt.rule_brief):
        names |= set(re.findall(r"\b([A-Z][A-Z_]+)\b", inspect.getsource(fn)))
    return {getattr(pt, n) for n in names if isinstance(getattr(pt, n, None), str) and getattr(pt, n).startswith(pt.P)}


def test_every_prompt_the_code_reads_is_seeded_and_nothing_else():
    seeded = set(S.seed_prompts())
    assert _declared_keys() == seeded
    assert _keys_used_in_code() == seeded
    assert set(pt.COMPILE_KEYS) | set(pt.RUN_KEYS) | set(pt.DISCOVER_KEYS) == seeded - set(pt.ALLOW_EMPTY)
    assert all(S.seed_prompts()[k].strip() for k in seeded - set(pt.ALLOW_EMPTY))


def test_templates_use_only_placeholders_the_code_fills():
    for key, text in S.seed_prompts().items():
        name = key.removeprefix("anomaly.")
        assert set(_TOKEN.findall(text)) == PLACEHOLDERS.get(name, set()), key


def test_prompt_definitions():
    defs = S.seed()["prompts"]
    for p in defs:
        assert set(p) == {"key", "name", "description", "text", "replyKeys", "allowEmpty"}, p["key"]
        assert p["name"].startswith("Data Anomaly: ") and p["description"]
        assert p["allowEmpty"] is (p["key"] in pt.ALLOW_EMPTY)
    reply = {p["key"]: p["replyKeys"] for p in defs}
    assert reply[pt.GROUNDING_SYSTEM] == ["tables", "applicable", "reason", "notes"]
    assert reply[pt.VERIFIER_SYSTEM] == ["ok", "not_applicable", "reason", "feedback", "threshold_note", "note"]
    assert reply[pt.SCOUT_REPLY_FORMAT][0] == "proposals" and "observation_id" in reply[pt.SCOUT_REPLY_FORMAT]
    for key, names in reply.items():
        for name in names:
            assert f'"{name}"' in S.seed_prompts()[key], (key, name)     # the reply format names every parsed key


def test_the_original_texts_are_reproduced():
    texts = S.seed_prompts()
    assert texts[pt.PROBE_CONTRACT].startswith("THE PROBE CONTRACT - every probe is a PAIR of queries")
    assert "every division guarded as NULLIF(<divisor>, 0)" in texts[pt.PROBE_CONTRACT]
    assert texts[pt.AUTHOR_SYSTEM].startswith("{PLATFORM_PREAMBLE}\n\nROLE: You are the Anomaly SQL Author")
    assert texts[pt.AUTHOR_SYSTEM].endswith("```sql detail\n-- the offending records, worst first\n```")
    assert "You are shown at most {SAMPLE_ROWS} detail rows." in texts[pt.VERIFIER_SYSTEM]
    assert texts[pt.VERIFIER_SYSTEM].endswith('"threshold_note": "", "note": ""}\n\n{BUSINESS_RULES}')
    assert "3. RETURN AT MOST {MAX_PROPOSALS}, AND RETURN NONE WHEN THERE ARE NONE." in texts[pt.SCOUT_SYSTEM]
    assert texts[pt.SCOUT_SYSTEM].endswith("BUSINESS RULES - the vocabulary and the definitions you must use:\n"
                                           "{BUSINESS_RULES}")
    assert "{max_proposals}" not in texts[pt.SCOUT_SYSTEM] and "SAMPLE_ROWS" not in texts[pt.AUTHOR_SYSTEM]


def test_the_contract_the_prompt_states_is_the_contract_the_code_enforces():
    """Every alias the contract code requires is named in the prompt (the original eval's cross-check)."""
    from app.features.anomaly.model import DETAIL_RECOMMENDED, DETAIL_REQUIRED, SUMMARY_OPTIONAL, SUMMARY_REQUIRED

    contract = S.seed_prompts()[pt.PROBE_CONTRACT]
    for alias in SUMMARY_REQUIRED + SUMMARY_OPTIONAL + DETAIL_REQUIRED + DETAIL_RECOMMENDED + ("evidence_<name>",):
        assert alias in contract, alias
    for duty in ("ORDER BY", "TOP", "NULLIF", "{{placeholders}}", "EXACTLY ONE ROW"):
        assert duty in contract, duty
    assert "not_applicable" in S.seed_prompts()[pt.VERIFIER_SYSTEM]


def test_assembled_system_prompts(ctx):
    with ctx() as _:
        author = pt.author_system("task finished before it started", ("task",), {"always"})
        verifier = pt.verifier_system("task finished before it started", ("task",))
        scout = pt.scout_system(7)
    assert author.startswith("You are part of an agentic data-quality engine")
    assert "THE PROBE CONTRACT" in author and "SQL DIALECT: Microsoft SQL Server" in author
    for text in (author, verifier, scout):
        assert not _TOKEN.search(text)                                   # every placeholder was filled
    assert "You are shown at most 25 detail rows." in verifier
    assert "RETURN AT MOST 7," in scout and scout.endswith("reply {\"proposals\": []}.")


def test_an_empty_reference_drops_its_line(ctx):
    with ctx(prompts={"anomaly.business_rules": "", "anomaly.few_shots": ""}):
        author = pt.author_system("x", (), None)
        verifier = pt.verifier_system("x")
    assert not _TOKEN.search(author) and "OUTPUT FORMAT" in author and verifier.endswith('"note": ""}')


def test_settings_definitions_match_the_settings_model():
    defs = S.seed()["settings"]
    aliases = {f.alias for f in AnomalySettings.model_fields.values()}
    assert [s["key"] for s in defs if s["key"] not in aliases] == []
    assert {s["key"] for s in defs} == aliases and len(defs) == len(aliases)
    for s in defs:
        assert {"key", "label", "help", "group", "type", "default"} <= set(s), s["key"]
        assert s["type"] in {"int", "decimal", "bool", "text", "list", "enum", "map"}, s["key"]
        assert s["label"] and s["help"] and s["group"] and "_" not in s["label"], s["key"]
        if s["type"] == "enum":
            assert s["default"] in s["options"]
        if "min" in s:
            assert s["min"] <= s["default"] <= s["max"], s["key"]
    parse(S.seed_settings())                                             # the defaults are a valid configuration


def test_settings_model_has_no_defaults():
    assert all(f.is_required() for f in AnomalySettings.model_fields.values())


def test_a_missing_or_bad_setting_names_the_key():
    raw = S.seed_settings()
    raw.pop("sampleRows")
    raw["severityWeights"] = {"critical": -1}
    raw["datePairSuffixes"] = ["_start"]
    with pytest.raises(ValueError) as err:
        parse(raw)
    message = str(err.value)
    assert "missing sampleRows" in message and "severityWeights" in message and "datePairSuffixes" in message


def test_access_is_the_original_scope():
    access = S.seed()["access"]
    assert access["allowedSchemas"] == ["dbo", "dsq", "project", "ref", "well", "core", "bridge", "wbs"]
    assert access["excludedTables"] == ["dbo.sysdiagrams"] and access["excludedColumns"] == []


def test_every_seeded_rule_loads():
    seeded = S.seed()["rules"]
    rules, errors = load_rules(seeded)
    assert errors == [] and len(rules) == len(seeded) == 90
    counts = {s: sum(1 for r in rules if r.status == s) for s in STATUSES}
    assert counts == {"active": 74, "probation": 0, "draft": 12, "disabled": 3, "rejected": 1}
    assert len({r.rule_id for r in rules}) == len(rules)
    assert all(r.body.strip() and not r.body.rstrip().endswith("---") for r in rules)
    assert all("# GROUP" not in r.body for r in rules)
    families = {r.rule_id: r.expands_over for r in rules if r.expands_over}
    assert set(families.values()) == {"foreign_key", "duplicate_key", "date_pair", "future_date", "numeric_range",
                                      "text_numeric"}
    discovered = [r for r in rules if r.source == "discovered"]
    assert len(discovered) == 10 and all(r.discovery and r.discovery.decided for r in discovered)
    for item, rule in zip(seeded, rules):
        assert item["ruleHash"] == rule.rule_hash                     # the stored hash is the computed one


def test_fill_is_single_pass():
    assert fill("{A} {B}", A="{B}", B="x") == "{B} x"

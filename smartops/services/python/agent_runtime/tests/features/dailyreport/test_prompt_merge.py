"""Daily Report's 40 prompts became 10 (six of them hold the rest as "## name" sections, three message wrappers moved
into code). The merge must change nothing the AI reads: every one of the 40 texts that was a prompt of its own is,
through the code that reads it now, exactly the same words.

tests/fixtures/dailyreport_prompts_before_merge.json holds the 40 texts as they were before the merge."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.features.dailyreport.texts import (
    LAYOUT, MESSAGE_TEMPLATES, SECTION_OF, parse_entries, parse_sections, serialize_sections,
)
from app.prompt_text import PromptMissing
from tests.features.dailyreport.conftest import prompts_with, report_context, seed_prompts

BEFORE = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "dailyreport_prompts_before_merge.json")
                    .read_text(encoding="utf-8"))
PREFIX = "dailyreport."


def test_the_fixture_is_the_forty_earlier_prompts():
    assert len(BEFORE) == 40 and all(key.startswith(PREFIX) for key in BEFORE)


@pytest.mark.parametrize("key", sorted(BEFORE))
def test_every_earlier_prompt_reaches_the_code_word_for_word(key):
    """What Texts.get returns for each name the code asks for is character for character the earlier prompt."""
    name = key[len(PREFIX):]
    with report_context() as ctx:
        assert ctx.texts.get(name) == BEFORE[key]


def test_the_lists_of_entries_and_the_tool_arguments_read_the_same_too():
    with report_context() as ctx:
        for name in ("evidence_status_definitions", "task_state_definitions", "crew_no_suggestion_reasons",
                     "tool_errors", "verifier_issues"):
            assert ctx.texts.entries(name) == parse_entries(BEFORE[PREFIX + name]), name
        for tool in ("day_overview", "list_wells", "milestones"):
            description, args = ctx.texts.tool(tool, DEFAULT_LIMIT=15, MAX_LIMIT=50)
            assert description and isinstance(args, dict)
        assert ctx.texts.entry("tool_errors", "required", NAME="limit") == "'limit' is required"


def test_the_four_prompts_that_stand_alone_are_unchanged():
    prompts = seed_prompts()
    for name in ("explain_system", "writer_addendum", "planner_system", "verifier_system"):
        assert prompts[PREFIX + name] == BEFORE[PREFIX + name], name


def test_every_earlier_prompt_is_accounted_for_exactly_once():
    stored = {"explain_system", "writer_addendum", "planner_system", "verifier_system"}
    names = [*stored, *SECTION_OF, *MESSAGE_TEMPLATES]
    assert sorted(PREFIX + n for n in names) == sorted(BEFORE) and len(names) == len(set(names))


def test_a_tenant_without_the_earlier_prompts_still_works():
    """A tenant's request now carries only the ten prompts; none of the 33 earlier keys is needed."""
    prompts = {k: v for k, v in seed_prompts().items()}
    assert not any(key in prompts for key in BEFORE if key[len(PREFIX):] in SECTION_OF or key[len(PREFIX):] in MESSAGE_TEMPLATES)
    with report_context() as ctx:
        assert ctx.texts.fill("verifier_user", TOOL_RESULTS="[]", DRAFT="text") == "Tool results:\n[]\n\nDraft:\ntext"


def test_a_missing_section_names_the_prompt_and_the_section():
    sections = parse_sections(seed_prompts()[PREFIX + "notes"])
    del sections["tool_unavailable_note"]
    with report_context(prompts={PREFIX + "notes": serialize_sections(sections)}) as ctx:
        with pytest.raises(PromptMissing, match=r"dailyreport\.notes \(section tool_unavailable_note\)"):
            ctx.texts.get("tool_unavailable_note")
        assert ctx.texts.get("tool_data_quality_note")      # the others still read


def test_an_empty_section_counts_as_missing():
    text = seed_prompts()[PREFIX + "notes"].replace(
        parse_sections(seed_prompts()[PREFIX + "notes"])["tool_unavailable_note"], "")
    with report_context(prompts={PREFIX + "notes": text}) as ctx:
        with pytest.raises(PromptMissing):
            ctx.texts.get("tool_unavailable_note")


def test_an_edited_section_reaches_the_code_and_leaves_the_others_alone():
    with report_context(prompts=prompts_with(tool_unavailable_note="Nothing to show here.")) as ctx:
        assert ctx.texts.get("tool_unavailable_note") == "Nothing to show here."
        assert ctx.texts.get("tool_data_quality_note") == BEFORE[PREFIX + "tool_data_quality_note"]


def test_headings_with_windows_line_endings_and_spaces_still_read():
    text = "## one  \r\nFirst.\r\n\r\n##   two\r\nSecond line a\r\nSecond line b\r\n"
    assert parse_sections(text) == {"one": "First.", "two": "Second line a\nSecond line b"}


def test_text_before_the_first_heading_and_lookalike_lines_belong_to_no_section():
    text = "Intro.\n## one\nText with ## inside and a line\n### not a heading\n## Two Words\n"
    assert parse_sections(text) == {"one": "Text with ## inside and a line\n### not a heading\n## Two Words"}


def test_serialising_the_sections_is_the_exact_inverse():
    for merged in LAYOUT:
        text = seed_prompts()[PREFIX + merged]
        assert serialize_sections(parse_sections(text)) == text, merged


def test_the_message_wrappers_are_fixed_in_code():
    assert set(MESSAGE_TEMPLATES) == {"planner_user", "writer_user", "verifier_user"}
    assert "dailyreport.planner_user" not in seed_prompts()

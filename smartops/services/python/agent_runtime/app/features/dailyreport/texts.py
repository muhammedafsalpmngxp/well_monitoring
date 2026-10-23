"""The dailyreport.* prompt texts of one request (AI Settings > AI Prompts), in the three shapes the feature uses:

* a template:            ``{UPPER_CASE}`` placeholders, filled in one pass (``fill``);
* a list of entries:     one ``name: text`` line per entry (definitions, constraints, refusals, verifier issues);
                         a line that does not start with ``name:`` continues the entry above it;
* a tool description:    the description line(s), then one ``- argument: meaning`` line per argument.

A missing prompt raises PromptMissing naming its key; a missing entry names the key and the entry.

Where the texts live. The code asks for texts by a logical name (``evidence_constraints``, ``tool_milestones``, ...).
Most of them are a SECTION of one of six merged prompts (AI Settings > AI Prompts shows 10 Daily Report prompts, not 40):
a merged prompt is ``## name`` headings, each followed by the text that used to be a prompt of its own, word for
word (LAYOUT says which). Four prompts stand alone (explain_system, writer_addendum, planner_system,
verifier_system), and three message wrappers that only carry placeholders (MESSAGE_TEMPLATES) are fixed here.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable

from app.features.common.context import FeatureRun
from app.features.common.text import fill
from app.prompt_text import PromptMissing

PREFIX = "dailyreport."

#: The merged prompts and the logical texts (sections) each holds, in the order they are written.
LAYOUT: dict[str, tuple[str, ...]] = {
    "tools": ("tool_day_overview", "tool_well_overview", "tool_task_detail", "tool_list_wells", "tool_milestones",
              "tool_deadline_pressure", "tool_crew_options", "tool_data_quality"),
    "writer_fix": ("writer_revision", "writer_patch"),
    "definitions": ("evidence_status_definitions", "evidence_crew_match_definitions",
                    "evidence_date_status_definitions", "task_state_definitions", "well_activity_definitions",
                    "day_activity_definitions"),
    "data_limits": ("evidence_constraints", "well_activity_constraints", "day_activity_constraints"),
    "notes": ("evidence_no_daily_entry_note", "evidence_quantities_withheld", "evidence_data_quality_note",
              "evidence_tasks_truncated_note", "well_ongoing_truncated_note", "day_wells_truncated_note",
              "tool_unavailable_note", "tool_deadline_rule", "tool_data_quality_note"),
    "messages": ("answer_unanswerable", "answer_nothing_to_explain", "crew_no_suggestion_reasons", "tool_errors",
                 "verifier_issues"),
}

#: logical name -> the merged prompt that holds it as a section.
SECTION_OF: dict[str, str] = {name: merged for merged, names in LAYOUT.items() for name in names}

#: The wrapper of each message sent to a model: placeholders only, so fixed in code rather than an editable prompt.
MESSAGE_TEMPLATES: dict[str, str] = {
    "planner_user": "Report date: {REPORT_DATE}\n\nTools:\n{TOOLS}\n\nQuestion: {QUESTION}",
    "writer_user": "Report date: {REPORT_DATE}\nQuestion: {QUESTION}\n\nTool results (authoritative):\n{TOOL_RESULTS}",
    "verifier_user": "Tool results:\n{TOOL_RESULTS}\n\nDraft:\n{DRAFT}",
}

_ENTRY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):(?:\s(.*))?$")
_ARG = re.compile(r"^-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s(.*))?$")
_HEADING = re.compile(r"^##[ \t]+([a-z][a-z0-9_]*)[ \t]*$")


@lru_cache(maxsize=64)
def _sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current = None
    for line in text.replace("\r\n", "\n").split("\n"):
        heading = _HEADING.match(line)
        if heading:
            current = heading.group(1)
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


def parse_sections(text: str) -> dict[str, str]:
    """A merged prompt as {section name: text}: the lines under each ``## name`` heading, trimmed."""
    return dict(_sections(text))


def serialize_sections(sections: dict[str, str]) -> str:
    """The merged prompt for sections in order (the exact inverse of parse_sections for trimmed, non-empty texts)."""
    return "\n\n".join(f"## {name}\n{body}" for name, body in sections.items())


def parse_entries(text: str) -> dict[str, str]:
    entries: dict[str, str] = {}
    last = None
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        match = _ENTRY.match(line)
        if match:
            last = match.group(1)
            entries[last] = (match.group(2) or "").strip()
        elif last is not None:
            entries[last] = f"{entries[last]} {line}".strip()
    return entries


def parse_tool(text: str) -> tuple[str, dict[str, str]]:
    description: list[str] = []
    args: dict[str, str] = {}
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        match = _ARG.match(line)
        if match:
            args[match.group(1)] = (match.group(2) or "").strip()
        else:
            description.append(line)
    return " ".join(description), args


def drop_lines_with(template: str, names: Iterable[str]) -> str:
    """The template without the lines that hold one of the ``{NAME}`` placeholders (an optional line)."""
    tokens = [f"{{{name}}}" for name in names]
    return "\n".join(line for line in template.split("\n") if not any(t in line for t in tokens))


class Texts:
    def __init__(self, run: FeatureRun) -> None:
        self._run = run

    def get(self, name: str) -> str:
        """The text called ``name``: a message wrapper (fixed), a section of a merged prompt, or a prompt of its own."""
        fixed = MESSAGE_TEMPLATES.get(name)
        if fixed is not None:
            return fixed
        merged = SECTION_OF.get(name)
        if merged is None:
            return self._run.prompt(PREFIX + name)
        found = _sections(self._run.prompt(PREFIX + merged)).get(name)
        if not found:
            raise PromptMissing(f"{PREFIX}{merged} (section {name})")
        return found

    def fill(self, name: str, *, optional: Iterable[str] = (), **values: object) -> str:
        """The template filled in; a line holding an ``optional`` placeholder whose value is empty is left out."""
        template = self.get(name)
        empty = [n for n in optional if not str(values.get(n) or "")]
        if empty:
            template = drop_lines_with(template, empty)
        return fill(template, **values)

    def entries(self, name: str) -> dict[str, str]:
        return parse_entries(self.get(name))

    def entry(self, name: str, kind: str, **values: object) -> str:
        found = self.entries(name).get(kind)
        if not found:
            raise PromptMissing(f"{PREFIX}{name} ({kind})")
        return fill(found, **values)

    def tool(self, name: str, **values: object) -> tuple[str, dict[str, str]]:
        return parse_tool(fill(self.get(f"tool_{name}"), **values))

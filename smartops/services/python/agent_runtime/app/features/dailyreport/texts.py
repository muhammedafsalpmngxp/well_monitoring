"""The dailyreport.* prompt texts of one request (AI Settings > AI Prompts), in the three shapes the feature uses:

* a template:            ``{UPPER_CASE}`` placeholders, filled in one pass (``fill``);
* a list of entries:     one ``name: text`` line per entry (definitions, constraints, refusals, verifier issues);
                         a line that does not start with ``name:`` continues the entry above it;
* a tool description:    the description line(s), then one ``- argument: meaning`` line per argument.

A missing prompt raises PromptMissing naming its key; a missing entry names the key and the entry.
"""
from __future__ import annotations

import re
from typing import Iterable

from app.features.common.context import FeatureRun
from app.features.common.text import fill
from app.prompt_text import PromptMissing

PREFIX = "dailyreport."

_ENTRY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):(?:\s(.*))?$")
_ARG = re.compile(r"^-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s(.*))?$")


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
        return self._run.prompt(PREFIX + name)

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

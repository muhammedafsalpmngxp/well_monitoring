"""The AI prompt texts of one request.

Every text the runtime sends to a model comes from the tenant's database (core.AiPrompt, edited
under AI Settings > AI Prompts). The Tenant API sends them with each request as {key: text}; nothing here has a
built-in default. A key that is missing or empty stops the run with a message naming it.

Templates hold placeholders such as {QUESTION}: upper-case names in single braces. They are filled in one pass,
so a value that itself contains "{QUESTION}" is never filled again, and a brace that is not a known placeholder
(the JSON in a reply format, for example) is left as it is.
"""
from __future__ import annotations

import re
from typing import Mapping

_TOKEN = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")


class PromptMissing(LookupError):
    """A prompt the run needs is not configured for the tenant."""

    def __init__(self, key: str):
        self.key = key
        super().__init__(f"The AI prompt '{key}' is not configured for this tenant. "
                         "An admin can restore it under AI Settings > AI Prompts.")


def text(texts: Mapping[str, str] | None, key: str) -> str:
    """The prompt's text, trimmed. Raises PromptMissing when it is missing or empty."""
    value = (texts or {}).get(key)
    if value is None or not str(value).strip():
        raise PromptMissing(key)
    return str(value).strip()


def missing(texts: Mapping[str, str] | None, keys) -> list[str]:
    """The keys among `keys` that have no text."""
    return [k for k in keys if not str((texts or {}).get(k) or "").strip()]


def fill(template: str, **values: object) -> str:
    """Replaces {NAME} with values["NAME"] in one pass; unknown names stay as written."""
    def put(m: re.Match) -> str:
        name = m.group(1)
        return str(values[name]) if name in values else m.group(0)
    return _TOKEN.sub(put, template)


def fill_lines(template: str, **values: object) -> str:
    """fill(), dropping a line that held only a placeholder whose value is empty (an optional block)."""
    kept = []
    for line in template.split("\n"):
        only = _TOKEN.fullmatch(line.strip())
        if only and only.group(1) in values and not str(values[only.group(1)]):
            continue
        kept.append(fill(line, **values))
    return "\n".join(kept)

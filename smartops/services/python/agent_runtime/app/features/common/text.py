"""Reading model replies: think blocks, JSON, fenced SQL. Tolerant on purpose (no provider-side JSON schema is
assumed); callers treat ``None`` as an unreadable reply."""
from __future__ import annotations

import json
import re
from typing import Any

from app.prompt_text import fill, fill_lines, text

__all__ = ["fill", "fill_lines", "text", "strip_think", "extract_json", "extract_sql", "extract_sql_blocks"]

_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)
_SQL_FENCE = re.compile(r"```sql[^\n]*\n(.*?)```", re.S | re.I)
_LABELLED = re.compile(r"```sql[ \t]+(\w+)[^\n]*\n(.*?)```", re.S | re.I)


def strip_think(reply: str) -> str:
    return _THINK.sub("", reply or "").strip()


def extract_json(reply: str) -> Any | None:
    """The JSON object (or list) in a reply: a fenced block, else the outermost {...} or [...]."""
    body = strip_think(reply)
    candidates = [m.group(1) for m in _FENCE.finditer(body)] + [body]
    for c in candidates:
        c = c.strip()
        for open_, close in (("{", "}"), ("[", "]")):
            start, end = c.find(open_), c.rfind(close)
            if start != -1 and end > start:
                try:
                    return json.loads(c[start:end + 1])
                except ValueError:
                    continue
    return None


def extract_sql(reply: str) -> str:
    """The SQL in a reply: a ```sql block, else everything from the first WITH / SELECT."""
    body = strip_think(reply)
    m = _SQL_FENCE.search(body)
    if m:
        return m.group(1).strip()
    m = re.search(r"\b(with|select)\b", body, re.I)
    return body[m.start():].strip() if m else ""


def extract_sql_blocks(reply: str) -> dict[str, str]:
    """Labelled blocks ```sql summary ... ``` / ```sql detail ... ``` as {label: sql} (labels lower case)."""
    return {m.group(1).lower(): m.group(2).strip() for m in _LABELLED.finditer(strip_think(reply))}

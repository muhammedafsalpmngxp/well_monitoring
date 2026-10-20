"""Reading model replies, the way the original engine did (app/utils.py), on top of common.text.

The anomaly engine needs two things common.text does not offer: tagged SQL blocks where an UNTAGGED block is keyed
"" and a duplicate tag keeps the FIRST occurrence (a restatement is the likelier paraphrase), and a brace-COUNTING
JSON scan, because a verdict's feedback string routinely contains braces. Nothing here ever raises: a node must be
able to detect "nothing usable came back" and retry.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.features.common.text import strip_think

_FENCE = re.compile(r"```[ \t]*sql[ \t]*([A-Za-z_][A-Za-z0-9_-]*)?[ \t]*\r?\n(.*?)```", re.IGNORECASE | re.DOTALL)
_ANY_FENCE = re.compile(r"```[a-zA-Z0-9_-]*[ \t]*\r?\n(.*?)```", re.DOTALL)
_WS = re.compile(r"\s+")


def extract_sql_blocks(text: str) -> dict[str, str]:
    """Every ```sql <tag>``` block, keyed by its lowercased tag ("" for an untagged block); first occurrence wins."""
    out: dict[str, str] = {}
    for tag, body in _FENCE.findall(strip_think(text or "")):
        key = (tag or "").strip().lower()
        body = body.strip()
        if body and key not in out:
            out[key] = body
    return out


def extract_json(text: str, default: Any = None) -> Any:
    """The first JSON object in a reply: the whole text, a fenced block, then a brace-balanced scan.
    Returns ``default`` on failure, so an unparseable verdict is distinguishable from {"ok": true}."""
    raw = strip_think(text or "").strip()
    if not raw:
        return default
    for candidate in (raw, *_ANY_FENCE.findall(raw)):
        candidate = candidate.strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            pass
    start = raw.find("{")
    while start != -1:
        depth, in_string, escaped = 0, False, False
        for i in range(start, len(raw)):
            ch = raw[i]
            if escaped:
                escaped = False
                continue
            if ch == "\\" and in_string:
                escaped = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start: i + 1])
                    except (ValueError, TypeError):
                        break
        start = raw.find("{", start + 1)
    return default


def normalize_sql(sql: str) -> str:
    """Whitespace/case-insensitive form, only ever used to DETECT a repeated attempt."""
    return _WS.sub(" ", (sql or "")).strip().rstrip(";").strip().lower()


def truncate(text: str, limit: int, suffix: str = " [...truncated]") -> str:
    """Bound text without cutting mid-sentence: feedback is fed straight to the author, and a cut inside the "Fix:"
    clause leaves it acting on a fragment."""
    text = (text or "").strip()
    if limit <= 0 or len(text) <= limit:
        return text
    window = text[:limit]
    cut = max(window.rfind(". "), window.rfind(".\n"), window.rfind("\n"), window.rfind("; "))
    if cut < limit // 2:
        cut = window.rfind(" ")
    if cut <= 0:
        cut = limit
    return window[: cut + 1].rstrip() + suffix

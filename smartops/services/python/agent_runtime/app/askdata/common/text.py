# Ported from twise-agentic shared/twise_common/utils/text.py (team repo); see app/askdata/README.md.
"""Parsing helpers - tolerant extraction from LLM output, shared by every agent."""
from __future__ import annotations

import json
import re
from typing import Any

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_SQL_FENCE_RE = re.compile(r"```(?:sql)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def strip_think(text: str) -> str:
    """Remove Qwen-style <think>...</think> reasoning blocks before parsing."""
    return _THINK_RE.sub("", text or "").strip()


def extract_sql(text: str) -> str:
    """Pull the SQL statement out of an LLM reply (fenced block preferred)."""
    text = strip_think(text)
    m = _SQL_FENCE_RE.search(text)
    candidate = m.group(1) if m else text
    candidate = candidate.replace("```", "").strip()
    kw = re.search(r"\b(WITH|SELECT)\b", candidate, re.IGNORECASE)
    if kw:
        candidate = candidate[kw.start():]
    return candidate.strip().rstrip(";").strip()


def extract_json(text: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
    """Pull a JSON object out of an LLM reply, tolerating fences/prose."""
    text = strip_think(text)
    m = _JSON_FENCE_RE.search(text)
    blob = m.group(1) if m else None
    if blob is None:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            blob = text[start : end + 1]
    if blob:
        try:
            parsed = json.loads(blob)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return default if default is not None else {}


def parse_json(text: str) -> dict[str, Any] | None:
    """The first JSON object in ``text``, or None."""
    result = extract_json(text, default=None)
    return result or None


def rows_to_markdown(columns: list[str], rows: list[list[Any]], max_rows: int = 100) -> str:
    """Render a result set as a compact markdown table (truncated for display)."""
    if not columns:
        return "(no columns)"
    if not rows:
        return "(no rows returned)"
    shown = rows[:max_rows]
    header = "| " + " | ".join(str(c) for c in columns) + " |"
    sep = "| " + " | ".join("---" for _ in columns) + " |"
    body = ["| " + " | ".join("" if v is None else str(v) for v in row) + " |" for row in shown]
    table = "\n".join([header, sep, *body])
    if len(rows) > max_rows:
        table += f"\n\n(showing first {max_rows} of {len(rows)} rows)"
    return table

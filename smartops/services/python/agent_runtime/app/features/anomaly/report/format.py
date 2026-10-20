"""Shared rendering decisions, so the Word document and the Excel workbook cannot disagree (ported)."""
from __future__ import annotations

import datetime as dt
import re

from app.features.anomaly.config import cfg

SEVERITY_COLOURS: dict[str, str] = {"critical": "C00000", "high": "E36C0A", "medium": "BF9000", "low": "808080"}
_INVALID_SHEET_CHARS = frozenset('\\*?:/[]')
_EMPHASIS = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)


def header(name: str) -> str:
    """A column name in business language (the contract's own prefixes stripped)."""
    text = str(name)
    for prefix in ("evidence_", "entity_", "explain_", "severity_"):
        if text.lower().startswith(prefix):
            text = text[len(prefix):]
            break
    return text.replace("_", " ").strip().title() or str(name)


def cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, dt.date):
        return value.isoformat()
    return str(value)


def number_or_text(value):
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return value
    return cell(value)


def content_widths(columns: list[str], rows: list[list]) -> list[int]:
    """Width per column from the header and a bounded sample of values."""
    settings = cfg()
    widths = [len(header(c)) for c in columns]
    for row in rows[: settings.report_width_sample_rows]:
        for i, value in enumerate(row):
            if i < len(widths):
                widths[i] = max(widths[i], len(cell(value)))
    return [max(settings.report_min_width_chars, min(settings.report_max_width_chars, w + 2)) for w in widths]


def sheet_title(title: str, used: set[str] | None = None) -> str:
    """A sheet name Excel accepts: legal characters, <= 31 chars, unique, never empty."""
    cleaned = "".join(" " if c in _INVALID_SHEET_CHARS else c for c in (title or ""))
    name = " ".join(cleaned.split())[:31].strip() or "Findings"
    if used is None:
        return name
    if name not in used:
        used.add(name)
        return name
    for suffix in range(2, 1000):
        tag = f" ({suffix})"
        candidate = name[: 31 - len(tag)].strip() + tag
        if candidate not in used:
            used.add(candidate)
            return candidate
    unique = name[:27] + " ~~~"
    used.add(unique)
    return unique


def sheet_names(state: dict) -> dict[str, str]:
    """rule_id -> the workbook sheet holding its findings, assigned exactly as the workbook assigns them (so the
    Word document's pointer names the real sheet)."""
    results = {r.rule_id: r for r in (state.get("results") or [])}
    rules = state.get("rules") or {}
    used: set[str] = {"Summary"}
    out: dict[str, str] = {}
    for row in (state.get("ranked") or []) + (state.get("discovered_ranked") or []):
        result = results.get(row["rule_id"])
        if result is None or not result.detail_columns or row["rule_id"] in out:
            continue
        title = getattr(rules.get(row["rule_id"]), "title", row["rule_id"])
        out[row["rule_id"]] = sheet_title(f"{row['rule_id']} {title}", used)
    return out


def emphasis_runs(text: str) -> list[tuple[str, bool]]:
    """(fragment, is_bold) pairs on **double asterisks** - the one markup the summarizer may use."""
    out: list[tuple[str, bool]] = []
    position = 0
    for match in _EMPHASIS.finditer(text or ""):
        if match.start() > position:
            out.append((text[position:match.start()], False))
        out.append((match.group(1), True))
        position = match.end()
    if position < len(text or ""):
        out.append((text[position:], False))
    return out or [(text or "", False)]

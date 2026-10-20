"""Import rules written in the original markdown format (domain/data_anomalies.md, domain/anomalies/*.md) as rule
dicts. A faithful port of the original rules/loader.py, working on texts instead of files - kept for an admin
"import markdown" and to build the seed (rules.json). No LLM anywhere: a deterministic parser either understands a
rule or reports precisely what is wrong with it, on a numbered line.

FORMAT
    ## RULE <id> - <title>          (an em dash, en dash, hyphen or colon; a dash needs a space before it)
    - category: ...                 (leading "- key: value" lines are metadata)
    - severity: critical | high | medium | low
    - entity: ...
    - method: rule | statistical | rollup
    - sql_mode: pinned | seed | authored
    - status: active | probation | draft | disabled | rejected
    - source: declared | discovered
    - tags: a, b, c
    - expands_over: foreign_key | duplicate_key | date_pair | future_date | numeric_range | text_numeric
    - <anything else>: a declared value, usable as {{placeholder}} in the rule's SQL

    Wrong: / Matters: / Detect: / Never flag:   (or the older **What is wrong** ... bold headings: the prose is
                                                 kept verbatim as the body, so both layouts work)
    ```sql summary ... ```  ```sql detail ... ```   (optional; a probe is always a pair)

Two differences from the original, both about what is DATA rather than parsing: the body stops at a top-level
"# GROUP ..." heading and drops a trailing "---" (the original carried the next group's introduction as the last
rule's prose), and a discovered rule's provenance lines (evidence, discovered_from, decided, reason) become its
``discovery`` record instead of declared values - Rule.declared_values() still shows them to the agents exactly as
before.
"""
from __future__ import annotations

import re
from typing import Iterable

from app.features.anomaly.model import (
    AUTO,
    EXPANDS_OVER,
    METHODS,
    SEVERITIES,
    SOURCES,
    SQL_MODES,
    STATUSES,
    Discovery,
    Rule,
)
from app.features.anomaly.textutil import extract_sql_blocks

# "## RULE DQ-001 - Title". A DASH MUST HAVE A SPACE BEFORE IT; A COLON NEED NOT: ids contain dashes, and
# "## RULE DQ-D27 Negative crew size" must fail outright rather than parse as id "DQ".
_RULE_HEADING = re.compile(r"^##\s+RULE\s+([A-Za-z0-9][A-Za-z0-9._-]*?)\s*(?::|\s+[—–-])\s*(.+?)\s*$", re.MULTILINE)
_META_LINE = re.compile(r"^\s*[-*]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$")
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_RESERVED_KEYS = frozenset(("category", "severity", "entity", "method", "sql_mode", "status", "tags", "title",
                            "expands_over", "source"))
# A discovered rule's provenance: recorded, never a declared value of its own.
_DISCOVERY_KEYS = ("evidence", "discovered_from", "decided", "reason")
_RULE_ATTEMPT = re.compile(r"^##\s+RULE\b.*$", re.MULTILINE)
_ID_TAIL = re.compile(r"^(.*?)(\d+)$")
_GROUP_HEADING = re.compile(r"^#\s", re.MULTILINE)


class RuleParseError(Exception):
    """A rule that cannot be understood."""


def _split_meta_body(block: str) -> tuple[dict[str, str], str]:
    """The leading "- key: value" lines (after the heading), and the prose that follows."""
    meta: dict[str, str] = {}
    lines = block.splitlines()
    i = 1 if lines and lines[0].lstrip().startswith("#") else 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        m = _META_LINE.match(line)
        if not m:
            break
        meta[m.group(1).strip().lower()] = m.group(2).strip()
        i += 1
    return meta, "\n".join(lines[i:]).strip()


def _strip_sql_fences(body: str) -> str:
    return re.sub(r"```[ \t]*sql[^\n]*\n.*?```", "", body, flags=re.IGNORECASE | re.DOTALL).strip()


def _tidy_body(body: str) -> str:
    """The rule's own prose: up to the next top-level heading, without a trailing horizontal rule."""
    m = _GROUP_HEADING.search(body)
    if m:
        body = body[: m.start()]
    lines = body.rstrip().splitlines()
    while lines and lines[-1].strip() in ("", "---", "***", "___"):
        lines.pop()
    return "\n".join(lines).strip()


def _substitute(sql: str, params: dict[str, str], rule_id: str, where: str) -> str:
    """Replace every {{placeholder}} from the rule's own metadata, at load time, so stored SQL is parameter-free."""
    unresolved: list[str] = []

    def repl(m: re.Match) -> str:
        name = m.group(1).lower()
        if name == "rule_id":
            return rule_id
        if name in params:
            value = params[name]
            if value.lower() == AUTO:
                unresolved.append(
                    f"{{{{{name}}}}} is used in the {where} SQL but {name} is set to 'auto'. 'auto' means the query "
                    f"must DERIVE the threshold from the data (AVG/STDEV/PERCENTILE_CONT) - there is no literal to "
                    f"substitute. Either give {name} a number, or remove the placeholder and compute it in SQL."
                )
                return m.group(0)
            return value
        unresolved.append(f"{{{{{name}}}}} is used in the {where} SQL but no '{name}:' metadata line defines it.")
        return m.group(0)

    out = _PLACEHOLDER.sub(repl, sql)
    if unresolved:
        raise RuleParseError("; ".join(unresolved))
    return out


def _validate(key: str, value: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise RuleParseError(f"{key} is '{value}'; it must be one of: {', '.join(allowed)}")
    return value


def build_rule(rule_id: str, title: str, block: str, source_file: str = "", line_no: int = 0) -> Rule:
    meta, body = _split_meta_body(block)
    blocks = extract_sql_blocks(body)
    summary_sql = blocks.get("summary", "")
    detail_sql = blocks.get("detail", "")

    if "" in blocks and not (summary_sql or detail_sql):
        raise RuleParseError("found an untagged ```sql block. Tag each one so it is unambiguous: ```sql summary and "
                             "```sql detail.")
    if bool(summary_sql) != bool(detail_sql):
        missing = "detail" if summary_sql else "summary"
        raise RuleParseError(
            f"has a ```sql {'summary' if summary_sql else 'detail'} block but no ```sql {missing} block. A probe is "
            f"always a PAIR: SUMMARY returns one row of counts, DETAIL returns the offending rows. Supply both, or "
            f"neither (which makes the rule sql_mode: authored)."
        )

    params = {k: v for k, v in meta.items() if k not in _RESERVED_KEYS and k not in _DISCOVERY_KEYS}
    if summary_sql:
        summary_sql = _substitute(summary_sql, params, rule_id, "summary")
    if detail_sql:
        detail_sql = _substitute(detail_sql, params, rule_id, "detail")

    default_mode = "seed" if (summary_sql and detail_sql) else "authored"
    sql_mode = _validate("sql_mode", meta.get("sql_mode", default_mode), SQL_MODES)

    expands_over = (meta.get("expands_over") or "").strip().lower()
    if expands_over:
        if expands_over not in EXPANDS_OVER:
            raise RuleParseError(f"expands_over is '{expands_over}', which is not a schema feature this engine can "
                                 f"enumerate. Use one of: {', '.join(EXPANDS_OVER)}.")
        if summary_sql or detail_sql:
            raise RuleParseError("a rule with expands_over must not carry its own SQL - it is applied to every "
                                 "matching feature in the schema, so the query is written per feature. Remove the "
                                 "```sql blocks.")
    if sql_mode in ("pinned", "seed") and not (summary_sql and detail_sql):
        raise RuleParseError(f"sql_mode is '{sql_mode}' but the rule carries no SQL. Add ```sql summary and ```sql "
                             f"detail blocks, or set sql_mode: authored.")

    provenance = {k: meta[k] for k in _DISCOVERY_KEYS if meta.get(k)}
    return Rule(
        rule_id=rule_id,
        title=meta.get("title") or title,
        category=meta.get("category", "Uncategorised"),
        severity=_validate("severity", meta.get("severity", "medium").lower(), SEVERITIES),
        entity=meta.get("entity", "row"),
        method=_validate("method", meta.get("method", "rule").lower(), METHODS),
        sql_mode=sql_mode,
        status=_validate("status", meta.get("status", "active").lower(), STATUSES),
        source=_validate("source", meta.get("source", "declared").lower(), SOURCES),
        expands_over=expands_over,
        tags=tuple(t.strip() for t in meta.get("tags", "").split(",") if t.strip()),
        body=_tidy_body(_strip_sql_fences(body)),
        summary_sql=summary_sql,
        detail_sql=detail_sql,
        params=params,
        discovery=Discovery(evidence=provenance.get("evidence", ""),
                            discovered_from=provenance.get("discovered_from", ""),
                            decided=provenance.get("decided", ""), reason=provenance.get("reason", ""))
        if provenance else None,
        source_file=source_file,
        line_no=line_no,
    )


def next_free_id(existing: Iterable[str]) -> str:
    """The next unused id in the largest existing family - suggested in errors, never assigned silently."""
    existing = set(existing)
    groups: dict[str, int] = {}
    for rule_id in existing:
        m = _ID_TAIL.match(rule_id)
        if m:
            groups[m.group(1)] = max(groups.get(m.group(1), 0), int(m.group(2)))
    if not groups:
        return ""
    prefix = max(groups, key=lambda p: sum(1 for r in existing if r.startswith(p)))
    width = max((len(m.group(2)) for r in existing if (m := _ID_TAIL.match(r)) and r.startswith(prefix)), default=2)
    return f"{prefix}{groups[prefix] + 1:0{width}d}"


def malformed_headings(text: str, name: str, parsed: set[str]) -> list[str]:
    """Every '## RULE' line the strict pattern did NOT accept - a rule that would otherwise vanish silently."""
    out: list[str] = []
    for m in _RULE_ATTEMPT.finditer(text or ""):
        line = m.group(0).strip()
        if _RULE_HEADING.match(line):
            continue
        line_no = text.count("\n", 0, m.start()) + 1
        suggestion = next_free_id(parsed)
        out.append(
            f"{name}:{line_no}: {line[:70]!r} is not a usable rule heading, so this rule WOULD BE SILENTLY IGNORED. "
            f"Write it as: ## RULE <id> - <title>"
            + (f"   (for example: ## RULE {suggestion} - ...)" if suggestion else "")
            + ". The id is how the engine tracks this check across runs and names it in the report, so it must be "
              "written explicitly and must never change afterwards."
        )
    return out


def parse_markdown(files: Iterable[tuple[str, str]]) -> tuple[list[Rule], list[str]]:
    """Every rule in ``files`` [(name, text)], in order (the first definition of an id wins), plus the problems.
    A malformed rule is never silently skipped: it is absent from the list AND named in the errors."""
    rules: list[Rule] = []
    errors: list[str] = []
    seen: dict[str, str] = {}
    for name, text in files:
        text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
        matches = list(_RULE_HEADING.finditer(text))
        errors.extend(malformed_headings(text, name, {m.group(1).strip() for m in matches}))
        for i, m in enumerate(matches):
            rule_id, title = m.group(1).strip(), m.group(2).strip()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            block = text[m.start():end].strip()
            line_no = text.count("\n", 0, m.start()) + 1
            where = f"{name}:{line_no} [{rule_id}]"
            if rule_id in seen:
                errors.append(f"{where}: duplicate rule id - already defined in {seen[rule_id]}. Ids must be unique; "
                              f"the catalog is keyed on them.")
                continue
            try:
                rules.append(build_rule(rule_id, title, block, name, line_no))
                seen[rule_id] = where
            except RuleParseError as exc:
                errors.append(f"{where}: {exc}")
            except Exception as exc:  # noqa: BLE001 - report, never crash the whole import
                errors.append(f"{where}: unexpected problem - {exc}")
    return rules, errors

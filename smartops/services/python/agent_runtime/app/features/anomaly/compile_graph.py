"""The COMPILE graph: one rule in, one stored probe out (ported from the original graph/build.py and nodes).

    rule_loader -> grounding -> sql_author -> validator -> executor -> sanity_gate -> verifier -> catalog_writer
                                    ^            |           |            |             |
                                    +------------+-----------+------------+-------------+  (rewrite, while budget)

EVERY RETRY DECISION LIVES IN THE ROUTING, NOT IN A NODE. Two budgets, never one: max_sql_retries funds MECHANICAL
faults (safety gate, database error, broken column contract); verify_retries funds SEMANTIC rejections. Three ways in:
an expanded family member skips grounding (its tables are known exactly); a pinned rule skips the author (the reviewer
still runs); seed / authored rules are grounded, written and reviewed. The Verifier FAILS CLOSED.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
import time
from typing import Any, TypedDict

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.anomaly import dbio
from app.features.anomaly import prompts as pt
from app.features.anomaly.config import cfg
from app.features.anomaly.context import build_context, example_conditions, table_index
from app.features.anomaly.contract import (
    check_detail,
    check_summary,
    dedup_problems,
    detail_advice,
    grain_concerns,
    grain_problems,
    sanity_concerns,
    saturation_problems,
    static_problems,
    summary_values,
)
from app.features.anomaly.expand import missing_tokens, substitute
from app.features.anomaly.introspect import probe_fingerprint
from app.features.anomaly.model import Probe
from app.features.anomaly.semantics import semantic_fingerprint
from app.features.anomaly.sqlcheck import check_probe
from app.features.anomaly.textutil import extract_json, extract_sql_blocks, normalize_sql, truncate
from app.features.common import llm
from app.features.common.access import AccessDenied

log = logging.getLogger("agent_runtime.anomaly")
_UNREADABLE: dict = {"__unreadable__": True}


class CompileState(TypedDict, total=False):
    # input: the rule (seeded by the compiler, never modified)
    rule_id: str
    title: str
    body: str
    category: str
    tags: tuple[str, ...]
    severity: str
    entity: str
    method: str
    sql_mode: str
    source: str
    tolerance: str
    params: dict[str, str]
    declared: dict[str, str]
    rule_hash: str
    structure_fingerprint: str
    table_signatures: dict[str, str]
    seed_summary_sql: str
    seed_detail_sql: str
    # shared reference material
    schema: str
    value_hints: str
    numeric_hints: str
    patterns: str
    coverage: str
    # families
    expands_over: str
    placeholders: tuple[str, ...]
    summary_sql_template: str
    detail_sql_template: str
    # grounding
    tables: list[str]
    grounding_note: str
    applicable: bool
    not_applicable_reason: str
    schema_block: str
    hint_block: str
    # author
    summary_sql: str
    detail_sql: str
    tried_sql: list[str]
    # validator / executor / sanity gate
    validation_error: str
    retry_count: int
    exec_error: str
    summary_columns: list[str]
    summary_row: list[Any]
    summary_row_count: int
    detail_columns: list[str]
    detail_rows: list[list[Any]]
    detail_truncated: bool
    smoke_test: bool
    detail_skipped: bool
    contract_error: str
    concerns: list[str]
    advice: list[str]
    # verifier
    verify_ok: bool
    verify_feedback: str
    feedback_history: list[str]
    verify_retry_count: int
    verifier_note: str
    threshold_note: str
    # outcome
    status: str
    error: str
    llm_calls: int
    probe: Any


def _rule_text(state: CompileState) -> str:
    return " ".join(str(state.get(k) or "") for k in ("title", "category", "entity", "method", "body"))


def _chat(role: str, system: str, user: str, json_mode: bool = False) -> str:
    settings = cfg()
    return llm.chat(system, user, agent=role, temperature=getattr(settings, f"{_ROLE[role]}_temperature"),
                    fast=getattr(settings, f"{_ROLE[role]}_tier") == "fast", json_mode=json_mode)


_ROLE = {"grounding": "grounding", "sql_author": "author", "verifier": "verifier", "summarizer": "summarizer",
         "scout": "scout"}


# ── rule_loader (deterministic) ──

def rule_loader_node(state: CompileState) -> dict:
    out: dict = {
        "summary_sql": state.get("seed_summary_sql", ""), "detail_sql": state.get("seed_detail_sql", ""),
        "tried_sql": [], "retry_count": 0, "verify_retry_count": 0, "llm_calls": 0, "concerns": [], "advice": [],
        "validation_error": "", "exec_error": "", "contract_error": "", "applicable": True, "status": "active",
    }
    if state.get("source") == "expanded":
        tables = [value for key, value in (state.get("params") or {}).items() if key.endswith("table")]
        schema_block, hint_block, resolved = build_context(state.get("schema", ""), state.get("value_hints", ""),
                                                           state.get("numeric_hints", ""), tables)
        out.update(schema_block=schema_block, hint_block=hint_block, tables=resolved,
                   grounding_note=pt.text(pt.EXPANDED_GROUNDING_NOTE))
    return out


# ── grounding (LLM, cheap tier by default) - a failure here is never fatal ──

def _grounding_fallback(state: CompileState, why: str) -> dict:
    log.info("anomaly ground: %s - using the full schema", why)
    schema_block, hint_block, tables = build_context(state.get("schema", ""), state.get("value_hints", ""),
                                                     state.get("numeric_hints", ""), [])
    return {"applicable": True, "tables": tables, "schema_block": schema_block, "hint_block": hint_block,
            "grounding_note": ""}


def grounding_node(state: CompileState) -> dict:
    index = table_index(state.get("schema", ""), state.get("numeric_hints", ""))
    if not index.strip():
        return _grounding_fallback(state, "the schema block is empty")
    user = pt.build(pt.GROUNDING_USER, TABLE_INDEX=index, RULE=pt.rule_brief(dict(state)))
    system = pt.text(pt.GROUNDING_SYSTEM)       # a missing prompt is a configuration error, never a fallback
    spent = state.get("llm_calls", 0) + 1
    try:
        raw = _chat("grounding", system, user, json_mode=True)
    except llm.AiUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - a provider failure must not lose the rule
        return {**_grounding_fallback(state, f"the model call failed ({type(exc).__name__})"), "llm_calls": spent}
    parsed = extract_json(raw, default=_UNREADABLE)
    data = parsed if isinstance(parsed, dict) and parsed is not _UNREADABLE else None
    if data is None:
        return {**_grounding_fallback(state, "the reply could not be parsed"), "llm_calls": spent}
    # Only an EXPLICIT false retires a rule: silence is not "this rule is impossible".
    if data.get("applicable") is False:
        reason = str(data.get("reason") or "").strip() or "no reason given"
        return {"applicable": False, "not_applicable_reason": reason, "status": "not_applicable", "llm_calls": spent}
    named = data.get("tables")
    named = [str(t) for t in named] if isinstance(named, list) else []
    schema_block, hint_block, tables = build_context(state.get("schema", ""), state.get("value_hints", ""),
                                                     state.get("numeric_hints", ""), named)
    return {"applicable": True, "tables": tables, "schema_block": schema_block, "hint_block": hint_block,
            "grounding_note": str(data.get("notes") or "").strip(), "llm_calls": spent}


# ── sql_author (LLM, main tier) - both queries in one call ──

def _pair_signature(summary_sql: str, detail_sql: str) -> str:
    return normalize_sql(summary_sql) + " ;; " + normalize_sql(detail_sql)


def feedback_sections(state: CompileState) -> list[str]:
    """Everything the previous attempt got wrong, mechanical first - and the reviewer's standing objection beneath
    it, with which of the two wins when they conflict."""
    out: list[str] = []
    previous = ""
    if state.get("summary_sql") or state.get("detail_sql"):
        previous = pt.build(pt.AUTHOR_PREVIOUS, SUMMARY_SQL=state.get("summary_sql", ""),
                            DETAIL_SQL=state.get("detail_sql", ""))
    mechanical = False
    if state.get("validation_error"):
        out.append(pt.build(pt.AUTHOR_REJECTED_VALIDATION, PREVIOUS=previous, ERROR=state["validation_error"]))
        mechanical = True
    elif state.get("exec_error"):
        out.append(pt.build(pt.AUTHOR_REJECTED_EXEC, PREVIOUS=previous, ERROR=state["exec_error"]))
        mechanical = True
    elif state.get("contract_error"):
        out.append(pt.build(pt.AUTHOR_REJECTED_CONTRACT, PREVIOUS=previous, ERROR=state["contract_error"]))
        mechanical = True
    if state.get("verify_feedback"):
        key = pt.AUTHOR_REVIEWER_ALSO if mechanical else pt.AUTHOR_REVIEWER_REJECTED
        out.append(pt.build(key, PREVIOUS=previous, FEEDBACK=state["verify_feedback"]) + "\n\n"
                   + pt.text(pt.AUTHOR_REWRITE))
    if state.get("tried_sql"):
        out.append(pt.build(pt.AUTHOR_ATTEMPTS, ATTEMPTS=len(state["tried_sql"])))
    return out


def sql_author_node(state: CompileState) -> dict:
    parts: list[str] = [pt.build(pt.AUTHOR_SCHEMA, SCHEMA=state.get("schema_block", ""))]
    if state.get("hint_block"):
        parts.append(state["hint_block"])
    if state.get("patterns"):
        parts.append(pt.build(pt.AUTHOR_PATTERNS, PATTERNS=state["patterns"]))
    if state.get("coverage"):
        parts.append(state["coverage"])
    parts.append(pt.build(pt.AUTHOR_RULE, RULE=pt.rule_brief(dict(state))))
    if state.get("sql_mode") == "seed" and state.get("seed_summary_sql"):
        parts.append(pt.build(pt.AUTHOR_SEED, SEED_SUMMARY=state["seed_summary_sql"],
                              SEED_DETAIL=state.get("seed_detail_sql", "")))
    if state.get("concerns"):
        parts.append(pt.build(pt.AUTHOR_CONCERNS, CONCERNS=pt.numbered(state["concerns"])))
    placeholders = state.get("placeholders") or ()
    params = state.get("params") or {}
    if placeholders:
        tokens = "\n".join(f"  {{{{{name}}}}}  = {params.get(name, '')}" for name in placeholders)
        parts.append(pt.build(pt.AUTHOR_FAMILY, FEATURE_KIND=state.get("expands_over") or "feature", TOKENS=tokens))
    parts.extend(feedback_sections(state))
    parts.append(pt.text(pt.AUTHOR_FINAL))

    conditions = example_conditions(state.get("schema_block") or "", state.get("hint_block") or "",
                                    str(state.get("method") or ""), str(state.get("tolerance") or ""))
    raw = _chat("sql_author", pt.author_system(_rule_text(state), tuple(state.get("tags") or ()), conditions),
                "\n\n".join(p for p in parts if p))
    blocks = extract_sql_blocks(raw)
    summary_sql = blocks.get("summary", "")
    detail_sql = blocks.get("detail", "")

    # The token form is the reusable template; everything downstream judges the SUBSTITUTED, runnable query.
    summary_template = detail_template = ""
    if placeholders and summary_sql and detail_sql:
        summary_template, detail_template = summary_sql, detail_sql
        values = {**params, "rule_id": state.get("rule_id", "")}
        summary_sql = substitute(summary_sql, values)
        detail_sql = substitute(detail_sql, values)
    return {
        "summary_sql": summary_sql, "detail_sql": detail_sql,
        "summary_sql_template": summary_template, "detail_sql_template": detail_template,
        "validation_error": "", "exec_error": "", "contract_error": "", "concerns": [],
        # verify_feedback is deliberately NOT cleared: it stays valid until the reviewer rules on the rewrite.
        "tried_sql": list(state.get("tried_sql", [])) + [_pair_signature(summary_sql, detail_sql)],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ── validator (deterministic): the hard safety gate plus the static contract ──

_FORBIDDEN = re.compile(r"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|"
                         r"GRANT|REVOKE|BACKUP|RESTORE|SHUTDOWN|RECONFIGURE|INTO|USE)\b", re.IGNORECASE)
_PROC = re.compile(r"\b(sp_|xp_)\w+", re.IGNORECASE)
_UNSAFE = re.compile(r"\b(OPENROWSET|OPENQUERY|OPENDATASOURCE|OPENXML|BULK|WAITFOR)\b"
                      r"|\bfn_(get_audit_file|trace_gettable)\b"
                      r"|\bsys\.(sql_logins|server_principals|credentials|master_key_passwords)\b", re.IGNORECASE)
_TABLE_REF = re.compile(r"\b(?:FROM|JOIN)\s+(\w+\.\w+)", re.IGNORECASE)
_TABLE_DECL = re.compile(r"^TABLE (\S+)", re.MULTILINE)


def scrub(sql: str) -> str:
    """Blank out literals, bracketed identifiers and comments in ONE pass (doing them separately is exploitable)."""
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if sql.startswith("--", i):
            nl = sql.find("\n", i)
            i = n if nl == -1 else nl
            out.append(" ")
            continue
        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
            continue
        if ch == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append("''")
            continue
        if ch == "[":
            end = sql.find("]", i + 1)
            if end != -1:
                out.append("[x]")
                i = end + 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def is_read_only(sql: str) -> tuple[bool, str]:
    if not sql or not sql.strip():
        return False, "The query is empty."
    clean = scrub(sql).strip().rstrip(";").strip()
    if ";" in clean:
        return False, "Multiple statements are not allowed - write a single query."
    lowered = clean.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        return False, "A query must begin with SELECT, or with WITH for a CTE chain."
    m = _FORBIDDEN.search(clean)
    if m:
        return False, f"Forbidden keyword {m.group(0)!r} - this engine is strictly read-only, so a probe may only read."
    if _PROC.search(clean):
        return False, "Stored-procedure calls (sp_ / xp_) are not allowed."
    m = _UNSAFE.search(clean)
    if m:
        return False, (f"{m.group(0)!r} is not allowed - a probe may read the approved schemas only, never remote "
                       f"servers, files on disk, or login and credential data.")
    return True, ""


def unknown_tables(sql: str, schema_text: str) -> list[str]:
    valid = {m.lower() for m in _TABLE_DECL.findall(schema_text or "")}
    if not valid:
        return []
    return sorted({m.lower() for m in _TABLE_REF.findall(scrub(sql))} - valid)


def validator_node(state: CompileState) -> dict:
    rule_id = state.get("rule_id", "")
    summary_sql = state.get("summary_sql", "")
    detail_sql = state.get("detail_sql", "")
    problems: list[str] = []
    for sql, which in ((summary_sql, "SUMMARY"), (detail_sql, "DETAIL")):
        if not sql.strip():
            continue
        ok, reason = is_read_only(sql)
        if not ok:
            problems.append(f"{which}: {reason}")
            continue
        unknown = unknown_tables(sql, state.get("schema_block", ""))
        if unknown:
            problems.append(f"{which} references {', '.join(unknown)}, which is not in the SCHEMA block. Use only the "
                            f"exact schema-qualified names listed there.")
            continue
        # The platform's own gate (one parsed SELECT) and the tables this feature may read: checked here, where the
        # author can still fix it, as well as again in front of the driver.
        try:
            dbio.guard(sql)
        except (ReadOnlyViolation, AccessDenied) as exc:
            problems.append(f"{which}: {exc}")
    problems += static_problems(summary_sql, detail_sql, rule_id)

    required = tuple(state.get("placeholders") or ())
    summary_template = state.get("summary_sql_template", "")
    detail_template = state.get("detail_sql_template", "")
    if required and (summary_template.strip() or detail_template.strip()):
        absent = missing_tokens(summary_template + "\n" + detail_template, tuple(t for t in required if t != "rule_id"))
        if absent:
            problems.append("The queries do not use " + ", ".join("{{%s}}" % t for t in absent)
                            + ". This probe is applied to every matching feature in the schema, so each of those must "
                              "appear as the TOKEN rather than the literal value you were shown - a literal is correct "
                              "only for the one feature you wrote against, and wrong for every other.")
        if summary_template.strip() and missing_tokens(summary_template, ("rule_id",)):
            problems.append("SUMMARY writes its rule id literally instead of using {{rule_id}}. Every feature this "
                            "query is applied to would then report under one id.")
    if problems:
        return {"validation_error": "\n".join(f"- {p}" for p in problems),
                "retry_count": state.get("retry_count", 0) + 1}
    return {"validation_error": ""}


# ── executor (deterministic): both halves at compile time, capped at sample_rows + 1 ──

def executor_node(state: CompileState) -> dict:
    settings = cfg()
    summary_sql = state.get("summary_sql", "")
    detail_sql = state.get("detail_sql", "")
    smoke = bool(state.get("smoke_test"))
    started = time.perf_counter()
    conn = None
    try:
        # A smoke test asks whether the SQL is VALID, which is decided when it is parsed: the short deadline.
        conn = dbio.connect(timeout=settings.query_timeout if smoke else settings.detail_timeout,
                            read_uncommitted=settings.read_uncommitted)
        cur = conn.cursor()
        dbio.guard(summary_sql)
        cur.execute(summary_sql)
        summary_columns = [str(d[0]) for d in cur.description] if cur.description else []
        summary_fetched = [list(r) for r in cur.fetchmany(2)]
        summary_row: list[Any] = summary_fetched[0] if summary_fetched else []
        if not (detail_sql or "").strip():
            return {"exec_error": "", "summary_columns": summary_columns, "summary_row": summary_row,
                    "summary_row_count": len(summary_fetched), "detail_columns": [], "detail_rows": [],
                    "detail_truncated": False, "detail_skipped": True}
        dbio.guard(detail_sql)
        cur.execute(detail_sql)
        detail_columns = [str(d[0]) for d in cur.description] if cur.description else []
        fetched = [list(r) for r in cur.fetchmany(settings.sample_rows + 1)]
        log.info("anomaly exec [%s]: ok in %.2fs", state.get("rule_id", ""), time.perf_counter() - started)
        return {"exec_error": "", "summary_columns": summary_columns, "summary_row": summary_row,
                "summary_row_count": len(summary_fetched), "detail_columns": detail_columns,
                "detail_rows": fetched[: settings.sample_rows], "detail_truncated": len(fetched) > settings.sample_rows,
                "detail_skipped": False}
    except dbio.DatabaseUnavailable:
        raise                                   # the database is gone: no rewrite can fix that
    except (ReadOnlyViolation, AccessDenied) as exc:
        return {"exec_error": str(exc), "retry_count": state.get("retry_count", 0) + 1}
    except Exception as exc:  # noqa: BLE001 - the database's complaint is fed back for self-correction
        return {"exec_error": dbio.error_text(exc), "retry_count": state.get("retry_count", 0) + 1}
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


# ── sanity_gate (deterministic): HARD contract vs ADVISORY concerns ──

def sanity_gate_node(state: CompileState) -> dict:
    summary_columns = state.get("summary_columns", []) or []
    detail_columns = state.get("detail_columns", []) or []
    detail_rows = state.get("detail_rows", []) or []
    problems = check_summary(summary_columns, state.get("summary_row_count", 0))
    problems += check_detail(detail_columns)
    problems += grain_problems(detail_columns, detail_rows, bool(state.get("detail_truncated")),
                               state.get("schema_block", ""))
    values = summary_values(summary_columns, state.get("summary_row", []) or [])
    problems += saturation_problems(values)
    problems += dedup_problems(values, state.get("schema_block", ""))
    if problems:
        return {"contract_error": "\n".join(f"- {p}" for p in problems), "retry_count": state.get("retry_count", 0) + 1}
    # ── ADVISORY: everything the Verifier will adjudicate ──
    detail_count = None if state.get("detail_truncated") else len(detail_rows)
    concerns = sanity_concerns(values, detail_count)
    concerns += grain_concerns(detail_columns, detail_rows)
    concerns += check_probe(state.get("summary_sql", ""), state.get("detail_sql", ""), state.get("schema_block", ""),
                            state.get("numeric_hints", ""))
    return {"contract_error": "", "concerns": list(dict.fromkeys(concerns)), "advice": detail_advice(detail_columns)}


# ── verifier (LLM, main tier): fails CLOSED ──

def _reject(state: CompileState, feedback: str, spent: int, note: str = "") -> dict:
    """Record the rejection and fund the rewrite (retry_count reset; verify_retry_count bounds this path)."""
    limit = cfg().verifier_feedback_max_chars
    bounded = truncate(feedback, limit)
    return {"verify_ok": False, "verify_feedback": bounded,
            "feedback_history": list(state.get("feedback_history") or []) + [bounded],
            "verifier_note": note, "verify_retry_count": state.get("verify_retry_count", 0) + 1, "retry_count": 0,
            "llm_calls": spent}


def verifier_node(state: CompileState) -> dict:
    settings = cfg()
    parts: list[str] = []
    if state.get("schema_block"):
        parts.append(pt.build(pt.VERIFIER_SCHEMA, SCHEMA=state["schema_block"]))
    if state.get("hint_block"):
        parts.append(pt.build(pt.VERIFIER_HINTS, HINTS=state["hint_block"]))
    parts.append(pt.build(pt.VERIFIER_RULE, RULE=pt.rule_brief(dict(state))))
    parts.append(pt.build(pt.VERIFIER_PROBE, SUMMARY_SQL=state.get("summary_sql", ""),
                          DETAIL_SQL=state.get("detail_sql", "")))
    parts.append(pt.build(pt.VERIFIER_RETURNED,
                          SUMMARY_ROW=pt.summary_line(state.get("summary_columns", []), state.get("summary_row", [])),
                          SAMPLE_ROWS=settings.sample_rows,
                          DETAIL_SAMPLE=pt.rows_to_table(state.get("detail_columns", []),
                                                         state.get("detail_rows", []))))
    if state.get("concerns"):
        parts.append(pt.build(pt.VERIFIER_CONCERNS, CONCERNS=pt.numbered(state["concerns"])))
    if state.get("advice"):
        parts.append(pt.build(pt.VERIFIER_ADVICE, ADVICE=pt.numbered(state["advice"])))
    if state.get("feedback_history"):
        parts.append(pt.build(pt.VERIFIER_HISTORY, HISTORY=pt.numbered(state["feedback_history"])))
    parts.append(pt.text(pt.VERIFIER_FINAL))
    spent = state.get("llm_calls", 0) + 1
    system = pt.verifier_system(_rule_text(state), tuple(state.get("tags") or ()))
    try:
        raw = _chat("verifier", system, "\n\n".join(parts), json_mode=True)
    except llm.AiUnavailable:
        raise
    except Exception:  # noqa: BLE001 - a provider failure is not evidence the probe is good: fail closed
        return _reject(state, pt.text(pt.VERIFIER_FAILED_FEEDBACK), spent)
    parsed = extract_json(raw, default=_UNREADABLE)
    data = parsed if isinstance(parsed, dict) and parsed is not _UNREADABLE else None
    if data is None or "ok" not in data:
        return _reject(state, pt.text(pt.VERIFIER_UNREADABLE_FEEDBACK), spent)
    note = str(data.get("note") or "").strip()
    threshold_note = str(data.get("threshold_note") or "").strip()
    if bool(data.get("not_applicable")):
        reason = str(data.get("reason") or "").strip() or note or "no reason given"
        return {"applicable": False, "not_applicable_reason": reason, "status": "not_applicable", "verify_ok": True,
                "verify_feedback": "", "verifier_note": note, "llm_calls": spent}
    if data.get("ok") is True or str(data.get("ok")).strip().lower() == "true":
        return {"verify_ok": True, "verify_feedback": "", "verifier_note": note, "threshold_note": threshold_note,
                "llm_calls": spent}
    feedback = str(data.get("feedback") or "").strip() or pt.text(pt.VERIFIER_NO_FIX_FEEDBACK)
    return _reject(state, feedback, spent, note=note)


# ── catalog_writer (deterministic): the finished state as one Probe (a failure is still recorded) ──

def _failure_reason(state: CompileState) -> str:
    for key in ("exec_error", "validation_error", "contract_error", "verify_feedback"):
        value = (state.get(key) or "").strip()
        if value:
            return f"{key}: {value}"
    return "the rule could not be compiled into a usable probe"


def _examined_nothing(state: CompileState) -> bool:
    columns = state.get("summary_columns") or []
    row = state.get("summary_row") or []
    if not columns or not row:
        return False
    try:
        return int(summary_values(columns, row).get("scope_total") or 0) <= 0
    except (TypeError, ValueError):
        return False


def probe_status(state: CompileState) -> tuple[str, str]:
    """(status, error), decided from the state alone. A probe that examined NOTHING is never stored active."""
    if state.get("applicable") is False:
        return "not_applicable", state.get("not_applicable_reason", "")
    if _examined_nothing(state):
        reason = ("the compiled probe examined 0 records, so it can prove nothing about its subject. This is normally a "
                  "join that matches nothing, a filter on a value that does not exist, or a rule whose concepts this "
                  "database does not record.")
        note = (state.get("verifier_note") or "").strip()
        if note:
            reason += f" The reviewer's assessment: {note}"
        return "not_applicable", reason
    if not state.get("summary_sql", "").strip() or not state.get("detail_sql", "").strip():
        return "failed", _failure_reason(state)
    if state.get("validation_error") or state.get("exec_error") or state.get("contract_error"):
        return "failed", _failure_reason(state)
    if state.get("verify_ok") is False:
        return "failed", _failure_reason(state)
    return "active", ""


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def catalog_writer_node(state: CompileState) -> dict:
    status, error = probe_status(state)
    tables = tuple(state.get("tables", []) or ())
    probe = Probe(
        rule_id=state.get("rule_id", ""), summary_sql=state.get("summary_sql", ""),
        detail_sql=state.get("detail_sql", ""), status=status, source=state.get("source", "declared"),
        rule_hash=state.get("rule_hash", ""), structure_fingerprint=state.get("structure_fingerprint", ""),
        table_fingerprint=probe_fingerprint(tables, state.get("table_signatures") or {}),
        # From the FULL artefacts, never the pruned blocks (which vary with how much context a retry was given).
        semantic_fingerprint=semantic_fingerprint(tables, state.get("schema", ""), state.get("value_hints", ""),
                                                  state.get("numeric_hints", "")),
        compiled_at=now_iso(), tables=tables, grounding_note=state.get("grounding_note", ""),
        verifier_note=state.get("verifier_note", ""), threshold_note=state.get("threshold_note", ""),
        error=error, llm_calls=state.get("llm_calls", 0),
    )
    return {"status": status, "error": error, "probe": probe}


# ── routing: every retry decision in one place ──

def _mechanical_budget_left(state: CompileState) -> bool:
    return state.get("retry_count", 0) <= cfg().max_sql_retries


def _rewritable(state: CompileState) -> bool:
    """A pinned probe has no author: it fails honestly rather than being silently replaced by a model's query."""
    return state.get("sql_mode") != "pinned"


def _repeated_attempt(state: CompileState) -> bool:
    if state.get("verify_retry_count", 0) < 1:
        return False
    tried = state.get("tried_sql") or []
    return len(tried) > 1 and tried[-1] in tried[:-1]


def route_after_loader(state: CompileState) -> str:
    return "sql_author" if state.get("source") == "expanded" else "grounding"


def route_after_grounding(state: CompileState) -> str:
    if state.get("applicable") is False:
        return "catalog_writer"
    return "validator" if state.get("sql_mode") == "pinned" else "sql_author"


def _mechanical_route(state: CompileState, error_key: str, onward: str) -> str:
    if state.get(error_key):
        return "sql_author" if _rewritable(state) and _mechanical_budget_left(state) else "catalog_writer"
    return onward


def route_after_validator(state: CompileState) -> str:
    return _mechanical_route(state, "validation_error", "executor")


def route_after_executor(state: CompileState) -> str:
    return _mechanical_route(state, "exec_error", "sanity_gate")


def route_after_sanity(state: CompileState) -> str:
    return _mechanical_route(state, "contract_error", "verifier")


def route_after_verifier(state: CompileState) -> str:
    if state.get("verify_ok") or not _rewritable(state):
        return "catalog_writer"
    if state.get("verify_retry_count", 0) > cfg().verify_retries or _repeated_attempt(state):
        return "catalog_writer"
    return "sql_author"


def build_compile_graph():
    from langgraph.graph import END, START, StateGraph

    g = StateGraph(CompileState)
    for name, node in (("rule_loader", rule_loader_node), ("grounding", grounding_node),
                       ("sql_author", sql_author_node), ("validator", validator_node), ("executor", executor_node),
                       ("sanity_gate", sanity_gate_node), ("verifier", verifier_node),
                       ("catalog_writer", catalog_writer_node)):
        g.add_node(name, node)
    g.add_edge(START, "rule_loader")
    g.add_conditional_edges("rule_loader", route_after_loader, {"grounding": "grounding", "sql_author": "sql_author"})
    g.add_conditional_edges("grounding", route_after_grounding,
                            {"sql_author": "sql_author", "validator": "validator", "catalog_writer": "catalog_writer"})
    g.add_edge("sql_author", "validator")
    g.add_conditional_edges("validator", route_after_validator,
                            {"sql_author": "sql_author", "executor": "executor", "catalog_writer": "catalog_writer"})
    g.add_conditional_edges("executor", route_after_executor,
                            {"sql_author": "sql_author", "sanity_gate": "sanity_gate",
                             "catalog_writer": "catalog_writer"})
    g.add_conditional_edges("sanity_gate", route_after_sanity,
                            {"sql_author": "sql_author", "verifier": "verifier", "catalog_writer": "catalog_writer"})
    g.add_conditional_edges("verifier", route_after_verifier,
                            {"sql_author": "sql_author", "catalog_writer": "catalog_writer"})
    g.add_edge("catalog_writer", END)
    return g.compile()

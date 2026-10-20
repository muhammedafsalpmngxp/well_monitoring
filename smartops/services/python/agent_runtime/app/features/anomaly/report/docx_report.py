"""The Word document: the narrative report a person reads end to end (ported from the original docx_report.py).

A DOCUMENT, NOT A DATA DUMP: each finding shows its headline, what is wrong and why it matters (from the rule's own
prose), the DISTINCT shapes the problem takes with a count each, a few real sample records, and a pointer to the
workbook sheet holding the rest. THE TRANSPARENCY SECTION IS NOT OPTIONAL: checks that failed, examined nothing or
are not running are listed with their reasons. The disclaimer is in the footer of every page. Headings that open a
section ask for a page break themselves (no break-only paragraph that could render as a blank page).
"""
from __future__ import annotations

import re
from collections import Counter

from app.features.anomaly.config import cfg
from app.features.anomaly.report.format import SEVERITY_COLOURS, cell, emphasis_runs, sheet_names
from app.features.anomaly.report.wordml import Document, Run

_DIGITS = re.compile(r"\d+")
_QUOTED = re.compile(r"'[^']*'")
_BOLD_HEADING = re.compile(r"^\*\*(.+?)\*\*\s*$")
_SHORT_FIELD = re.compile(r"^(Wrong|Matters|Detect|Never flag)\s*:\s*(.*)$", re.IGNORECASE)
_SHORT_TO_LONG = {"wrong": "what is wrong", "matters": "why it matters", "detect": "how to detect",
                  "never flag": "do not flag"}


def _shape_of(text: str) -> str:
    """The explanation with its variable parts masked, so repetitions collapse into one shape (used to GROUP)."""
    return _DIGITS.sub("<n>", _QUOTED.sub("'<value>'", str(text or ""))).strip()


def prose(body: str) -> dict[str, str]:
    """A rule body's sections - in either layout (**What is wrong** headings, or Wrong: / Matters: lines)."""
    out: dict[str, str] = {}
    current = ""
    for line in (body or "").splitlines():
        text = line.strip()
        if not text:
            continue
        heading = _BOLD_HEADING.match(text)
        if heading:
            current = heading.group(1).strip().lower()
            out[current] = ""
            continue
        short = _SHORT_FIELD.match(text)
        if short:
            current = _SHORT_TO_LONG[short.group(1).lower()]
            out[current] = short.group(2).replace("**", "").strip()
            continue
        if current:
            out[current] = (out[current] + " " + text.replace("**", "")).strip()
    return out


def _samples(result, limit: int) -> list[tuple[str, str]]:
    columns = [str(c).lower() for c in (result.detail_columns or [])]

    def index(name: str) -> int | None:
        return columns.index(name) if name in columns else None

    i_key, i_label, i_text = index("entity_key"), index("entity_label"), index("explain_text")
    i_evidence = [n for n, c in enumerate(columns) if c.startswith("evidence_")]
    out: list[tuple[str, str]] = []
    for row in (result.detail_rows or [])[:limit]:
        label = ""
        if i_label is not None and row[i_label] not in (None, ""):
            label = cell(row[i_label])
        elif i_key is not None:
            label = cell(row[i_key])
        if i_key is not None and label != cell(row[i_key]):
            label = f"{label} ({cell(row[i_key])})"
        if i_text is not None and row[i_text] not in (None, ""):
            explanation = cell(row[i_text])
        else:
            explanation = ", ".join(f"{columns[n][len('evidence_'):]} = {cell(row[n])}" for n in i_evidence[:4]
                                    if row[n] not in (None, ""))
        out.append((label or "(unidentified record)", explanation))
    return out


def _patterns(result) -> list[tuple[str, int]]:
    """Distinct explanation shapes, most frequent first, each shown as a REAL sentence (the mask only groups)."""
    columns = [str(c).lower() for c in (result.detail_columns or [])]
    if "explain_text" not in columns:
        return []
    i = columns.index("explain_text")
    counts: Counter = Counter()
    representative: dict[str, str] = {}
    for row in result.detail_rows or []:
        value = row[i]
        if value in (None, ""):
            continue
        shape = _shape_of(value)
        counts[shape] += 1
        representative.setdefault(shape, cell(value))
    return [(representative[shape], n) for shape, n in counts.most_common()]


def _severity_runs(severity: str, rest: str) -> list[Run]:
    return [Run(severity.upper(), bold=True, color=SEVERITY_COLOURS.get(severity, "808080")), Run(rest)]


def _rule_prose(doc: Document, rule) -> None:
    sections = prose(getattr(rule, "body", "") or "")
    for heading in ("what is wrong", "why it matters"):
        if sections.get(heading):
            doc.paragraph([Run(heading.capitalize() + ". ", bold=True), Run(sections[heading])])


def build(state: dict) -> bytes:
    """The Word document as bytes."""
    settings = cfg()
    doc = Document()
    totals = state.get("totals") or {}
    by_severity = state.get("by_severity") or {}
    reason_limit = settings.report_reason_max_chars

    # ── Cover ──
    doc.heading(settings.report_title, level=0)
    doc.paragraph([Run(f"{state.get('database_name') or 'database'}  ·  run {state.get('run_id', '')}", italic=True)],
                  align="left")
    doc.kv_table([
        ("Overall score", f"{state.get('score', 0)} / 100"),
        ("Checks run", f"{totals.get('probes_run', 0):,}"),
        ("Checks with findings", f"{totals.get('probes_with_findings', 0):,}"),
        ("Records examined", f"{totals.get('records_examined', 0):,}"),
        ("Records flagged", f"{totals.get('records_flagged', 0):,}"),
    ])
    if any(by_severity.values()):
        doc.heading("Findings by severity", level=1)
        doc.kv_table([(name.capitalize(), f"{by_severity.get(name, 0):,} check(s)")
                      for name in ("critical", "high", "medium", "low") if by_severity.get(name)])

    # ── Executive summary (written by the model from aggregates, or the plain fallback) ──
    doc.heading("Executive summary", level=1)
    for line in str(state.get("summary") or "").splitlines():
        text = line.strip()
        if not text:
            continue
        bullet = text.startswith(("- ", "* ", "• "))
        runs = [Run(fragment, bold=bold) for fragment, bold in emphasis_runs(text[2:].strip() if bullet else text)]
        if bullet:
            doc.bullet(runs)
        else:
            doc.paragraph(runs)
    doc.small("How the score is calculated: " + str(state.get("score_basis", "")))
    if state.get("catalog_note"):
        stale = bool(state.get("catalog_stale"))
        doc.paragraph([Run(("WARNING: " if stale else "Note: ") + str(state["catalog_note"]), bold=stale)])

    # ── Findings ──
    ranked = state.get("ranked") or []
    results = {r.rule_id: r for r in (state.get("results") or [])}
    rules = state.get("rules") or {}
    sheets = sheet_names(state)
    doc.heading("Findings", level=1, page_break_before=True)
    if not ranked:
        doc.paragraph("No check found anything to report.")
    for position, row in enumerate(ranked):
        if position == settings.report_full_sections:
            doc.heading("Further findings", level=2)
            doc.paragraph("Ranked below the findings above. Full detail for each is in the workbook.")
            for tail in ranked[settings.report_full_sections:]:
                doc.bullet([Run(f"{tail['rule_id']} - {tail['title']}: ", bold=True),
                            Run(f"{tail['anomaly_count']:,} of {tail['scope_total']:,} "
                                f"({float(tail['anomaly_pct']):.2f}%), {tail['severity']}")])
            break
        result = results.get(row["rule_id"])
        doc.heading(f"{row['rule_id']} - {row['title']}", level=2)
        doc.paragraph(_severity_runs(row["severity"], f"  ·  {row['anomaly_count']:,} of {row['scope_total']:,} records "
                                                      f"({float(row['anomaly_pct']):.2f}%)  ·  {row['category']}"))
        _rule_prose(doc, rules.get(row["rule_id"]))
        if result is None:
            continue
        patterns = _patterns(result)
        if len(patterns) > 1:
            doc.paragraph("How the problem presents", style="IntenseQuote")
            for shape, count in patterns[: settings.report_patterns_per_finding]:
                doc.bullet([Run(f"{count:,}x ", bold=True), Run(shape)])
            remaining = len(patterns) - settings.report_patterns_per_finding
            if remaining > 0:
                doc.small(f"... and {remaining:,} further variation(s).")
        elif patterns:
            doc.paragraph([Run("Every affected record reports: ", bold=True), Run(patterns[0][0])])
        samples = _samples(result, settings.report_samples_per_finding)
        if samples:
            doc.paragraph("Sample records", style="IntenseQuote")
            for label, explanation in samples:
                doc.bullet([Run(f"{label}: ", bold=True), Run(explanation)])
        shown = len(result.detail_rows or [])
        if (result.detail_total > shown or row["anomaly_count"] > len(samples)) and row["rule_id"] in sheets:
            doc.small(f"All {row['anomaly_count']:,} affected records are in the workbook, sheet "
                      f"\"{sheets[row['rule_id']]}\".")
        for concern in result.concerns:
            doc.small("Note: " + concern)

    # ── Findings from rules still on trial (their own section; in no headline figure) ──
    discovered = state.get("discovered_ranked") or []
    if discovered:
        totals_d = state.get("discovered_totals") or {}
        doc.heading("Findings from rules on trial", level=1, page_break_before=True)
        doc.paragraph("These checks were proposed automatically and accepted for trial. They are NOT included in the "
                      "data quality score, the flagged record count, or any other figure on the first page - those "
                      "describe the established checks only. Treat what follows as evidence for deciding whether each "
                      "check is worth keeping, not as settled findings.")
        doc.kv_table([("Rules on trial", f"{totals_d.get('probes_run', 0):,}"),
                      ("With findings", f"{totals_d.get('probes_with_findings', 0):,}"),
                      ("Records flagged", f"{totals_d.get('records_flagged', 0):,}"),
                      ("Records examined", f"{totals_d.get('records_examined', 0):,}")])
        for row in discovered:
            doc.heading(f"{row['rule_id']} - {row['title']}", level=2)
            doc.paragraph(_severity_runs(row["severity"], f"  ·  {row['anomaly_count']:,} of {row['scope_total']:,} "
                                                          f"records ({float(row['anomaly_pct']):.2f}%)  ·  "
                                                          f"{row['category']}  ·  on trial"))
            _rule_prose(doc, rules.get(row["rule_id"]))
            result = results.get(row["rule_id"])
            if result is not None:
                for label, explanation in _samples(result, settings.report_samples_per_finding):
                    doc.bullet([Run(f"{label}: ", bold=True), Run(explanation)])

    # ── Transparency ──
    gaps = state.get("empty_scope") or []
    not_running = state.get("not_running") or []
    failed = [r for r in (state.get("results") or []) if not r.ok]
    if gaps or not_running or failed:
        doc.heading("Checks that did not report", level=1, page_break_before=True)
        doc.paragraph("These checks produced no finding, but not because the data is clean. They are listed so the "
                      "coverage of this report is not overstated.")
        if gaps:
            doc.heading("Examined no records", level=2)
            doc.paragraph("The check ran but its scope matched nothing, so it can prove nothing about its subject. This "
                          "is a coverage gap, not a clean result.")
            for rule_id in gaps:
                title = getattr(rules.get(rule_id), "title", "")
                doc.bullet([Run(rule_id, bold=True)] + ([Run(f" - {title}")] if title else []))
        if failed:
            doc.heading("Failed while running", level=2)
            for result in failed:
                doc.bullet([Run(f"{result.rule_id}: ", bold=True), Run(str(result.error)[:reason_limit])])
        if not_running:
            doc.heading("Not running", level=2)
            for item in not_running:
                doc.bullet([Run(f"{item.get('rule_id', '')} - {item.get('title', '')} ({item.get('status', '')}): ",
                                bold=True), Run(str(item.get("reason", ""))[:reason_limit])])
    return doc.save(settings.report_disclaimer, settings.report_title)

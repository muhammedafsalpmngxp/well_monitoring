"""Which compiled probes are still trustworthy, and which may run (ported from the original rules/catalog.py).

The catalog itself is stored by the Tenant API and arrives with each request; this module only JUDGES it. Staleness
is decided PER PROBE: its rule definition (rule hash), the structure of the tables it reads (with the whole-database
fingerprint as the fallback for an entry without table fingerprints), and the measured meaning of those tables. A
failed probe is kept with its error so the report can say a check is not running.

The compiler and the run's catalog loader both use these functions: the two must never disagree about whether a
probe is current.
"""
from __future__ import annotations

from app.features.anomaly.contract import probe_signature
from app.features.anomaly.introspect import missing_tables, probe_fingerprint
from app.features.anomaly.model import Probe, Rule
from app.features.anomaly.semantics import describe_drift


def structure_moved(probe: Probe, structure_fingerprint: str,
                    table_signatures: dict[str, str] | None = None) -> tuple[bool, str]:
    """(has the structure this probe depends on changed, why): a table GONE, then its own tables, then the
    whole database for an entry compiled before per-table hashes existed."""
    if table_signatures:
        gone = missing_tables(probe.tables, table_signatures)
        if gone:
            return True, "it reads " + ", ".join(gone) + ", which no longer exist(s) in the database"
        if probe.table_fingerprint and probe.tables:
            current = probe_fingerprint(probe.tables, table_signatures)
            if current and current != probe.table_fingerprint:
                return True, "the structure of the tables it reads changed"
            return False, ""
    if structure_fingerprint and probe.structure_fingerprint != structure_fingerprint:
        return True, "the database structure changed"
    return False, ""


def semantics_moved(probe: Probe, current: str) -> tuple[bool, str]:
    """(has the MEANING of what it reads changed, why). Either side empty = unknown, and unknown never invalidates."""
    if not current or not probe.semantic_fingerprint or current == probe.semantic_fingerprint:
        return False, ""
    return True, describe_drift(probe.tables)


def is_stale(probe: Probe | None, rule: Rule, structure_fingerprint: str, retry_failed: bool = False,
             table_signatures: dict[str, str] | None = None, semantic_fingerprint: str = "") -> tuple[bool, str]:
    """(needs recompiling, why)."""
    if probe is None:
        return True, "not compiled yet"
    if probe.rule_hash != rule.rule_hash:
        return True, "the rule definition changed"
    moved, why = structure_moved(probe, structure_fingerprint, table_signatures)
    if moved:
        return True, why
    drifted, why = semantics_moved(probe, semantic_fingerprint)
    if drifted:
        return True, why
    if probe.status == "failed" and retry_failed:
        return True, "retrying a rule that previously failed"
    return False, ""


def runnable_reason(probe: Probe, rule: Rule | None) -> str:
    """"" when this probe may run, otherwise WHY not. TWO statuses decide: the rule's (does the business still want
    the check?) and the probe's (did its SQL compile?)."""
    if rule is not None and not rule.runnable:
        return f"the rule is {rule.status}"
    if probe.status != "active":
        return probe.error or f"the probe is {probe.status}"
    return ""


def prune_removed(catalog: dict[str, Probe], runnable_ids: set[str]) -> list[str]:
    """Drop probes whose rule no longer exists or no longer runs. Pass RUNNABLE ids only."""
    gone = sorted(rule_id for rule_id in catalog if rule_id not in runnable_ids)
    for rule_id in gone:
        del catalog[rule_id]
    return gone


def duplicate_probes(catalog: dict[str, Probe]) -> list[tuple[str, ...]]:
    """Groups of active, non-expanded probes that measure the same thing (same tables, flag and scope). Reported,
    never disabled: which one drifted is a judgement about the business."""
    groups: dict[str, list[str]] = {}
    for probe in catalog.values():
        if probe.status != "active" or probe.source == "expanded":
            continue
        signature = probe_signature(probe.summary_sql)
        if signature:
            groups.setdefault(signature, []).append(probe.rule_id)
    return [tuple(sorted(ids)) for ids in groups.values() if len(ids) > 1]

"""The data model every stage shares: rule -> compiled probe -> result.

A RULE and a PROBE are plain dicts on the wire (camelCase, see the fragments' rule-schema.md); inside the engine they
are the frozen ``Rule`` and the ``Probe`` dataclasses below, ported from the original AnomalyRule / CompiledProbe.
Nothing here names a table or a column: ``entity_key`` and ``evidence_*`` are positions in a contract, filled by
whatever the rule's own SQL selects.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, replace
from typing import Any

# ── Enumerations ── validated strings rather than Enums: they round-trip through JSON and markdown.
SEVERITIES: tuple[str, ...] = ("critical", "high", "medium", "low")
# Report ordering by index: "critical" outranks "high", and "low" must not sort above "medium".
SEVERITY_RANK: dict[str, int] = {s: i for i, s in enumerate(SEVERITIES)}

# How the anomaly is decided: rule (a deterministic condition), statistical (an outlier against the population's
# own distribution), rollup (a parent total that disagrees with its children).
METHODS: tuple[str, ...] = ("rule", "statistical", "rollup")

# What the compile graph does with the rule's own SQL:
#   pinned    used verbatim; the author is skipped (the reviewer still runs)
#   seed      a starting point the author adapts to the live schema
#   authored  no SQL; written from the prose alone
SQL_MODES: tuple[str, ...] = ("pinned", "seed", "authored")

# Lifecycle. active runs and is scored; probation RUNS but is reported separately and counts towards nothing;
# draft is listed but never runs; disabled is switched off; rejected is a refused discovered proposal, never runs,
# never reported, kept only so the Scout cannot propose it again.
STATUSES: tuple[str, ...] = ("active", "probation", "draft", "disabled", "rejected")
RUNNABLE: tuple[str, ...] = ("active", "probation")

# Where a rule came from: declared (written as itself), expanded (one member of a structural family),
# discovered (proposed by the Scout and accepted by a person).
SOURCES: tuple[str, ...] = ("declared", "expanded", "discovered")

# Probe outcomes of a compile.
PROBE_STATUSES: tuple[str, ...] = ("active", "failed", "not_applicable", "disabled")

# The value that means "derive the threshold from the data, do not substitute a literal".
AUTO = "auto"

# Schema features a family rule may expand over - one probe per matching feature.
EXPANDS_OVER: tuple[str, ...] = (
    "foreign_key", "duplicate_key", "date_pair", "future_date", "numeric_range", "text_numeric",
)

# ── The SUMMARY / DETAIL contract ── checked against what the driver returned, never by parsing SQL.
SUMMARY_REQUIRED: tuple[str, ...] = ("rule_id", "scope_total", "anomaly_count")
SUMMARY_OPTIONAL: tuple[str, ...] = ("anomaly_pct", "worst_severity_val")
DETAIL_REQUIRED: tuple[str, ...] = ("entity_key",)
DETAIL_RECOMMENDED: tuple[str, ...] = ("entity_label", "severity_value", "explain_text")
EVIDENCE_PREFIX = "evidence_"


class RuleInvalid(ValueError):
    """A rule dict that cannot be used (message names the rule and the field)."""


@dataclass(frozen=True)
class Discovery:
    """Provenance of a rule the Scout proposed and a person decided on. Never part of the rule's definition."""

    evidence: str = ""
    discovered_from: str = ""
    decided: str = ""
    reason: str = ""
    observation_id: str = ""
    observation_fact: str = ""
    proposal_hash: str = ""

    def to_dict(self) -> dict[str, str]:
        return {"evidence": self.evidence, "discoveredFrom": self.discovered_from, "decided": self.decided,
                "reason": self.reason, "observationId": self.observation_id,
                "observationFact": self.observation_fact, "proposalHash": self.proposal_hash}

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Discovery | None":
        if not data:
            return None
        return cls(evidence=str(data.get("evidence") or ""), discovered_from=str(data.get("discoveredFrom") or ""),
                   decided=str(data.get("decided") or ""), reason=str(data.get("reason") or ""),
                   observation_id=str(data.get("observationId") or ""),
                   observation_fact=str(data.get("observationFact") or ""),
                   proposal_hash=str(data.get("proposalHash") or ""))


@dataclass(frozen=True)
class Rule:
    """One anomaly rule, as stored by the Tenant API or produced by expanding a family."""

    rule_id: str
    title: str
    category: str = "Uncategorised"
    severity: str = "medium"
    entity: str = "row"
    method: str = "rule"
    sql_mode: str = "authored"
    status: str = "active"
    source: str = "declared"
    tags: tuple[str, ...] = ()
    # A structural family is named after the SCHEMA FEATURE it applies to, never a table. Stays set on the
    # expansions (it is the feature KIND); family_id is what tells a concrete member from the family.
    expands_over: str = ""
    family_id: str = ""
    # The prose (Wrong / Matters / Detect / Never flag, or the older bold-heading layout), verbatim.
    body: str = ""
    # Placeholder-substituted SQL of a pinned / seed rule. Empty for an authored rule.
    summary_sql: str = ""
    detail_sql: str = ""
    # Every declared value (tolerance, deadlines, placeholder dates...) - the {{placeholders}} of its SQL.
    params: dict[str, str] = field(default_factory=dict)
    discovery: Discovery | None = None
    # Where it was imported from (markdown import only).
    source_file: str = ""
    line_no: int = 0

    @property
    def is_family(self) -> bool:
        return bool(self.expands_over) and not self.family_id

    @property
    def is_expanded(self) -> bool:
        return bool(self.family_id)

    @property
    def runnable(self) -> bool:
        """THE predicate deciding whether a rule exists for the engine: what compiles, runs and stays in the catalog."""
        return self.status in RUNNABLE

    @property
    def scored(self) -> bool:
        """Whether its findings reach the score and the headline totals. Separate from runnable: that IS probation."""
        return self.status == "active"

    @property
    def has_sql(self) -> bool:
        return bool(self.summary_sql.strip() and self.detail_sql.strip())

    @property
    def severity_rank(self) -> int:
        return SEVERITY_RANK.get(self.severity, len(SEVERITIES))

    @property
    def rule_hash(self) -> str:
        """Identity of this rule's DEFINITION, for per-rule staleness: any edit that reaches the author or the
        reviewer (prose, metadata, declared values, SQL) recompiles this rule and nothing else. Status and
        discovery provenance are NOT definition: promoting a rule off probation must not cost a recompile."""
        canonical = json.dumps({
            "title": self.title, "category": self.category, "severity": self.severity, "entity": self.entity,
            "method": self.method, "sqlMode": self.sql_mode, "expandsOver": self.expands_over,
            "tags": list(self.tags), "body": self.body, "params": dict(sorted(self.params.items())),
            "summarySql": self.summary_sql, "detailSql": self.detail_sql,
        }, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]

    def declared_values(self) -> dict[str, str]:
        """Every value the rule declares, as the original loader exposed them to the agents: its params plus, for a
        discovered rule, the provenance lines that sat in its metadata (source, evidence, discovered_from, decided,
        reason)."""
        values = dict(self.params)
        if self.source == "discovered":
            values["source"] = "discovered"
        if self.discovery is not None:
            for key, value in (("evidence", self.discovery.evidence),
                               ("discovered_from", self.discovery.discovered_from),
                               ("decided", self.discovery.decided), ("reason", self.discovery.reason)):
                if value:
                    values[key] = value
        return values

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "ruleId": self.rule_id, "title": self.title, "category": self.category, "severity": self.severity,
            "entity": self.entity, "method": self.method, "sqlMode": self.sql_mode, "status": self.status,
            "source": self.source, "tags": list(self.tags), "expandsOver": self.expands_over, "body": self.body,
            "params": dict(self.params), "summarySql": self.summary_sql, "detailSql": self.detail_sql,
            "ruleHash": self.rule_hash,
            "discovery": self.discovery.to_dict() if self.discovery else None,
        }
        if self.family_id:
            out["familyId"] = self.family_id
        if self.source_file:
            out["sourceFile"], out["lineNo"] = self.source_file, self.line_no
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Rule":
        """A validated Rule from its wire form. Raises RuleInvalid naming the rule and the field."""
        if not isinstance(data, dict):
            raise RuleInvalid("a rule must be an object")
        rule_id = str(data.get("ruleId") or "").strip()
        if not rule_id:
            raise RuleInvalid("a rule has no ruleId")

        def enum(key: str, allowed: tuple[str, ...], default: str) -> str:
            value = str(data.get(key) or default).strip().lower()
            if value not in allowed:
                raise RuleInvalid(f"{rule_id}: {key} is '{value}'; it must be one of: {', '.join(allowed)}")
            return value

        expands = str(data.get("expandsOver") or "").strip().lower()
        if expands and expands not in EXPANDS_OVER:
            raise RuleInvalid(f"{rule_id}: expandsOver is '{expands}', which is not a schema feature this engine can "
                              f"enumerate. Use one of: {', '.join(EXPANDS_OVER)}.")
        tags = data.get("tags") or []
        if isinstance(tags, str):
            tags = tags.split(",")
        params = data.get("params") or {}
        if not isinstance(params, dict):
            raise RuleInvalid(f"{rule_id}: params must be an object of name: value")
        summary_sql = str(data.get("summarySql") or "")
        detail_sql = str(data.get("detailSql") or "")
        sql_mode = enum("sqlMode", SQL_MODES, "seed" if (summary_sql.strip() and detail_sql.strip()) else "authored")
        if bool(summary_sql.strip()) != bool(detail_sql.strip()):
            raise RuleInvalid(f"{rule_id}: a probe is always a PAIR - supply both summarySql and detailSql, or neither")
        if sql_mode in ("pinned", "seed") and not (summary_sql.strip() and detail_sql.strip()):
            raise RuleInvalid(f"{rule_id}: sqlMode is '{sql_mode}' but the rule carries no SQL")
        if expands and (summary_sql.strip() or detail_sql.strip()):
            raise RuleInvalid(f"{rule_id}: a rule with expandsOver must not carry its own SQL - it is written per feature")
        title = str(data.get("title") or "").strip()
        if not title:
            raise RuleInvalid(f"{rule_id}: the rule has no title")
        return cls(
            rule_id=rule_id, title=title,
            category=str(data.get("category") or "Uncategorised").strip() or "Uncategorised",
            severity=enum("severity", SEVERITIES, "medium"),
            entity=str(data.get("entity") or "row").strip() or "row",
            method=enum("method", METHODS, "rule"),
            sql_mode=sql_mode,
            status=enum("status", STATUSES, "active"),
            source=enum("source", SOURCES, "declared"),
            tags=tuple(str(t).strip() for t in tags if str(t).strip()),
            expands_over=expands,
            family_id=str(data.get("familyId") or ""),
            body=str(data.get("body") or ""),
            summary_sql=summary_sql, detail_sql=detail_sql,
            params={str(k).strip().lower(): str(v) for k, v in params.items() if str(k).strip()},
            discovery=Discovery.from_dict(data.get("discovery")),
            source_file=str(data.get("sourceFile") or ""), line_no=int(data.get("lineNo") or 0),
        )

    def with_(self, **changes: Any) -> "Rule":
        return replace(self, **changes)


def load_rules(items: list[dict[str, Any]]) -> tuple[list[Rule], list[str]]:
    """Every usable rule plus a list of problems. A bad rule is never silently skipped: it is named in the errors
    (and a duplicate id keeps the FIRST definition, as the markdown loader did)."""
    rules: list[Rule] = []
    errors: list[str] = []
    seen: set[str] = set()
    for item in items or []:
        try:
            rule = Rule.from_dict(item)
        except RuleInvalid as exc:
            errors.append(str(exc))
            continue
        if rule.rule_id in seen:
            errors.append(f"{rule.rule_id}: duplicate rule id - already defined. Ids must be unique; the catalog is "
                          "keyed on them.")
            continue
        seen.add(rule.rule_id)
        rules.append(rule)
    return rules, errors


@dataclass
class Probe:
    """A rule after compilation: the SQL that will actually run, plus how it got there (the original CompiledProbe).

    ``rule_hash`` and the three fingerprints decide whether it is still valid. A failed probe is KEPT, with its
    error, so the report can say a check is not running."""

    rule_id: str
    summary_sql: str = ""
    detail_sql: str = ""
    status: str = "active"                 # active | failed | not_applicable | disabled
    source: str = "declared"               # declared | expanded | discovered (copied from the rule)
    rule_hash: str = ""
    structure_fingerprint: str = ""        # whole database, fallback for entries without table fingerprints
    table_fingerprint: str = ""            # structure of THIS probe's tables
    semantic_fingerprint: str = ""         # measured MEANING of the columns it reads ("" = unknown, never stale)
    compiled_at: str = ""
    tables: tuple[str, ...] = ()
    grounding_note: str = ""
    verifier_note: str = ""
    threshold_note: str = ""
    error: str = ""
    llm_calls: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ruleId": self.rule_id, "summarySql": self.summary_sql, "detailSql": self.detail_sql,
            "status": self.status, "source": self.source, "ruleHash": self.rule_hash,
            "structureFingerprint": self.structure_fingerprint, "tableFingerprint": self.table_fingerprint,
            "semanticFingerprint": self.semantic_fingerprint, "compiledAt": self.compiled_at,
            "tables": list(self.tables), "groundingNote": self.grounding_note, "verifierNote": self.verifier_note,
            "thresholdNote": self.threshold_note, "error": self.error, "llmCalls": self.llm_calls,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Probe":
        status = str(data.get("status") or "active")
        return cls(
            rule_id=str(data.get("ruleId") or ""), summary_sql=str(data.get("summarySql") or ""),
            detail_sql=str(data.get("detailSql") or ""),
            status=status if status in PROBE_STATUSES else "failed",
            source=str(data.get("source") or "declared"), rule_hash=str(data.get("ruleHash") or ""),
            structure_fingerprint=str(data.get("structureFingerprint") or ""),
            table_fingerprint=str(data.get("tableFingerprint") or ""),
            semantic_fingerprint=str(data.get("semanticFingerprint") or ""),
            compiled_at=str(data.get("compiledAt") or ""),
            tables=tuple(str(t) for t in (data.get("tables") or ()) if str(t).strip()),
            grounding_note=str(data.get("groundingNote") or ""), verifier_note=str(data.get("verifierNote") or ""),
            threshold_note=str(data.get("thresholdNote") or ""), error=str(data.get("error") or ""),
            llm_calls=int(data.get("llmCalls") or 0),
        )


def load_catalog(items: list[dict[str, Any]]) -> dict[str, Probe]:
    """The request's catalog keyed by rule id. An unreadable entry is skipped, never fatal: it is rebuilt."""
    out: dict[str, Probe] = {}
    for item in items or []:
        try:
            probe = Probe.from_dict(item if isinstance(item, dict) else {})
        except (TypeError, ValueError):
            continue
        if probe.rule_id:
            out[probe.rule_id] = probe
    return out


@dataclass
class ProbeResult:
    """One rule's outcome in one run. ``detail_rows`` holds at most the Word cap; ``anomaly_count`` comes from the
    SUMMARY and is NOT interchangeable with len(detail_rows)."""

    rule_id: str
    ok: bool = True
    error: str = ""
    scope_total: int = 0
    anomaly_count: int = 0
    anomaly_pct: float = 0.0
    worst_severity_val: float | None = None
    detail_columns: list[str] = field(default_factory=list)
    detail_rows: list[list[Any]] = field(default_factory=list)
    detail_truncated: bool = False
    detail_total: int = 0
    spool_path: str = ""
    spool_truncated: bool = False
    detail_skipped: bool = False
    summary_seconds: float = 0.0
    detail_seconds: float = 0.0
    concerns: list[str] = field(default_factory=list)

    @property
    def has_findings(self) -> bool:
        return self.ok and self.anomaly_count > 0

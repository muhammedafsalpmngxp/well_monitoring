"""Enumerate the schema features a family rule applies to. No SQL, no LLM, no naming guesses (except the date-pair
suffix convention, which comes from settings and fails SAFELY: an unrecognised convention yields no pair).

A rule declaring ``expandsOver: foreign_key`` is written once and applied to every foreign key the database declares.
A FEATURE IS A SET OF PLACEHOLDER VALUES: the SQL Author writes one query with {{tokens}}, substituted per feature.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.features.anomaly.config import cfg
from app.features.anomaly.model import Rule
from app.features.anomaly.schema_index import SchemaIndex, Table

log = logging.getLogger("agent_runtime.anomaly")

PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    "foreign_key": ("child_table", "child_column", "parent_table", "parent_column", "entity_column"),
    # No entity_column: the duplicated key IS the identity of the thing being reported.
    "duplicate_key": ("table", "key_column"),
    "date_pair": ("table", "start_column", "end_column", "entity_column"),
    "future_date": ("table", "column", "entity_column"),
    "numeric_range": ("table", "column", "lower_bound", "upper_bound", "entity_column"),
    "text_numeric": ("table", "column", "entity_column"),
}
# Supplied to EVERY family: the contract makes each query select its own id as a literal, so a template writing one
# literally would make every member report under the author's id.
UNIVERSAL_TOKENS: tuple[str, ...] = ("rule_id",)
_TOKEN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
# Placeholder names that hold a TABLE (declared, so a new kind cannot silently escape the empty-table filter).
_TABLE_PLACEHOLDERS: tuple[str, ...] = ("table", "child_table", "parent_table")


def tokens_for(kind: str) -> tuple[str, ...]:
    return PLACEHOLDERS.get(kind, ()) + UNIVERSAL_TOKENS


def missing_tokens(sql: str, required: tuple[str, ...]) -> list[str]:
    """Required tokens the author did not use - a LITERAL where a token belonged is correct for one feature only."""
    present = {m.group(1).lower() for m in _TOKEN.finditer(sql or "")}
    return [t for t in required if t.lower() not in present]


def substitute(sql: str, values: dict[str, str]) -> str:
    """Fill {{token}} placeholders; an UNKNOWN token is left as written so it fails visibly, never blanked."""
    return _TOKEN.sub(lambda m: values.get(m.group(1).lower(), m.group(0)), sql or "")


def unfilled_tokens(sql: str) -> list[str]:
    return sorted({m.group(1) for m in _TOKEN.finditer(sql or "")})


@dataclass(frozen=True)
class Feature:
    values: dict[str, str] = field(default_factory=dict)
    label: str = ""


def _escape(name: str) -> str:
    """A column name as it goes into `[{{placeholder}}]`: T-SQL's own `]]` escape."""
    return str(name).replace("]", "]]")


def date_pairs(table: Table) -> list[tuple[str, str]]:
    """Start/end date columns that belong together, by the configured naming convention (longest suffix first)."""
    settings = cfg()
    names = {c.name.lower(): c.name for c in table.date_columns}
    pairs: list[tuple[str, str]] = []
    used: set[str] = set()
    for lower, actual in sorted(names.items()):
        if lower in used:
            continue
        for a_suf, b_suf in settings.date_suffix_pairs:
            if not lower.endswith(a_suf):
                continue
            partner = lower[: -len(a_suf)] + b_suf
            if partner in names and partner not in used:
                pairs.append((actual, names[partner]))
                used.update({lower, partner})
                break
        else:
            for a_pre, b_pre in settings.date_prefix_pairs:
                if lower.startswith(a_pre):
                    partner = b_pre + lower[len(a_pre):]
                    if partner in names and partner not in used:
                        pairs.append((actual, names[partner]))
                        used.update({lower, partner})
                        break
    return pairs


def drop_empty_tables(features: list[Feature], index: SchemaIndex) -> tuple[list[Feature], list[tuple[str, str]]]:
    """Remove features whose table holds no rows (a probe there reports a clean result about nothing). A table with
    an UNKNOWN row count is kept: unknown is not empty."""
    kept: list[Feature] = []
    dropped: list[tuple[str, str]] = []
    for feature in features:
        empty_table = ""
        for key in _TABLE_PLACEHOLDERS:
            name = feature.values.get(key)
            if not name:
                continue
            table = index.get(name)
            if table is not None and table.row_count == 0:
                empty_table = name
                break
        if empty_table:
            dropped.append((empty_table, feature.label))
        else:
            kept.append(feature)
    return kept, dropped


def features_for(kind: str, index: SchemaIndex) -> list[Feature]:
    """Every place in this schema where a family rule of ``kind`` applies."""
    if kind not in PLACEHOLDERS:
        return []
    out: list[Feature] = []
    if kind == "foreign_key":
        for table, fk in index.foreign_keys:
            entity = table.entity_column()
            if not entity or index.get(fk.parent_table) is None:
                continue
            out.append(Feature(values={"child_table": table.name, "child_column": _escape(fk.child_column),
                                       "parent_table": fk.parent_table, "parent_column": _escape(fk.parent_column),
                                       "entity_column": _escape(entity)},
                               label=f"{table.name}.{fk.child_column} -> {fk.parent_table}"))
    elif kind == "duplicate_key":
        for table, key in index.duplicate_keys:
            if table.column(key) is None:
                continue                 # the grain line was parsed wrongly; a probe would fail confusingly
            out.append(Feature(values={"table": table.name, "key_column": _escape(key)},
                               label=f"{table.name} per {key}"))
    elif kind == "date_pair":
        for table in index.tables.values():
            entity = table.entity_column()
            if not entity:
                continue
            for start, end in date_pairs(table):
                out.append(Feature(values={"table": table.name, "start_column": _escape(start),
                                           "end_column": _escape(end), "entity_column": _escape(entity)},
                                   label=f"{table.name}.{start} > {end}"))
    elif kind == "future_date":
        # NOT IMPLEMENTED, and the empty list is the point: which date columns record an OUTCOME rather than an
        # intention is not something the schema says. It stays empty until those columns are DECLARED.
        pass
    elif kind == "numeric_range":
        for table in index.tables.values():
            entity = table.entity_column()
            if not entity:
                continue
            for column, stat in table.stats.items():
                bounds = stat.bounds()
                if bounds is None or table.column(column) is None:
                    continue
                low, high = bounds
                out.append(Feature(values={"table": table.name, "column": _escape(column),
                                           "entity_column": _escape(entity),
                                           "lower_bound": f"{low:g}", "upper_bound": f"{high:g}"},
                                   label=f"{table.name}.{column} outside {low:g}..{high:g}"))
    elif kind == "text_numeric":
        for table in index.tables.values():
            entity = table.entity_column()
            if not entity:
                continue
            for column, stat in table.stats.items():
                if stat.text_is_codes or not stat.text_bad or table.column(column) is None:
                    continue
                out.append(Feature(values={"table": table.name, "column": _escape(column),
                                           "entity_column": _escape(entity)},
                                   label=f"{table.name}.{column} ({stat.text_bad}/{stat.text_total} unparseable)"))
    out, empty = drop_empty_tables(out, index)
    if empty:
        log.info("anomaly expand: %s skipped %d feature(s) on empty table(s)", kind, len(empty))
    return out


def expand_families(rules: list[Rule], index: SchemaIndex) -> tuple[list[Rule], list[str]]:
    """Every family rule replaced by one concrete rule per matching feature (the family itself is never returned:
    it is a description, not a probe). Notes name the families that matched nothing."""
    out: list[Rule] = []
    notes: list[str] = []
    for rule in rules:
        if not rule.is_family:
            out.append(rule)
            continue
        features = features_for(rule.expands_over, index)
        if not features:
            notes.append(f"{rule.rule_id} expands over {rule.expands_over}, which matched nothing in this schema - "
                         "no probe was created for it")
            continue
        for n, feature in enumerate(features, 1):
            out.append(rule.with_(
                rule_id=f"{rule.rule_id}-{n:03d}",
                title=f"{rule.title}: {feature.label}" if feature.label else rule.title,
                family_id=rule.rule_id, source="expanded", sql_mode="authored",
                params={**rule.params, **feature.values},
            ))
    return out, notes


def coverage_summary(kinds: list[str], header: str) -> str:
    """What the structural families already cover, so an authored rule does not restate one (``header`` is the
    tenant's prompt text)."""
    if not kinds:
        return ""
    return "\n".join([header] + [f"- {kind.replace('_', ' ')}" for kind in sorted(set(kinds))])

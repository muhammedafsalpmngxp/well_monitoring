"""The feature's settings, read from the request (Settings > AI Settings > Data Anomaly).

Every knob the original engine read from its .env (ANOMALY_*), every retry budget, the severity weights, and the
engine tunables that used to be module constants (pruning limits, contract tolerances, introspection limits,
discovery thresholds, report limits, model temperatures and tiers) arrive here per request. NOTHING HAS A DEFAULT:
the Tenant API sends every key (seeded from settings.json), and a missing or malformed one is a clear 400 naming it,
never a silent fallback to a number nobody chose.

Read anywhere in the engine with ``cfg()`` while ``use(settings)`` (api.py) is active. The value is held in a
ContextVar, so thread pools that copy the context (README) see it too.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, Literal

from pydantic import Field, ValidationError, field_validator

from app.models import _Camel

Tier = Literal["main", "fast"]


class SettingsInvalid(ValueError):
    """A setting is missing or malformed (message is safe to show)."""


class AnomalySettings(_Camel):
    # ── Row volume ── four separate caps for four different problems
    sample_rows: int = Field(ge=1)                    # rows any prompt ever shows (LLM token bound)
    report_rows: int = Field(ge=1)                    # rows per rule kept in memory for the Word document
    export_max_rows: int = Field(ge=1)                # rows per rule sheet in Excel
    fetch_batch: int = Field(ge=1)                    # rows fetched per round trip while spooling

    # ── Query execution ──
    query_timeout: int = Field(ge=1)                  # SUMMARY and smoke tests
    metadata_timeout: int = Field(ge=1)               # catalogue reads (INFORMATION_SCHEMA, sys.*)
    detail_timeout: int = Field(ge=1)                 # DETAIL scans and numeric profiling
    run_concurrency: int = Field(ge=1)                # parallel probes during a run
    read_uncommitted: bool                            # probes run under READ UNCOMMITTED

    # ── Compile guardrails ──
    max_sql_retries: int = Field(ge=0)                # MECHANICAL rewrites per rule
    verify_retries: int = Field(ge=0)                 # SEMANTIC rewrites per rule
    family_author_attempts: int = Field(ge=1)         # members of one family sent to the author
    max_compile_calls: int = Field(ge=1)              # circuit breaker on a whole compile
    recursion_limit: int = Field(ge=10)               # LangGraph loop guard per rule
    verifier_feedback_max_chars: int = Field(ge=100)  # reviewer feedback re-sent on every rewrite
    auto_compile: bool                                # rebuild stale probes inside a run
    auto_compile_max_rules: int = Field(ge=0)         # most a run may rebuild by itself

    # ── Context pruning ──
    schema_prune_above_tables: int = Field(ge=0)
    max_pruned_tables: int = Field(ge=1)
    min_saving_ratio: float = Field(gt=0, le=1)
    reference_prune: bool
    reference_keep_below: int = Field(ge=0)
    reference_min_overlap: float = Field(ge=0, le=1)
    reference_min_sections: int = Field(ge=1)
    reference_stopwords: list[str]
    substantially_empty_pct: int = Field(ge=0, le=100)
    max_cell_chars: int = Field(ge=10)

    # ── Probe contract ──
    saturation_floor: int = Field(ge=0)
    near_saturation_share: float = Field(gt=0, le=1)
    dedup_scope_tolerance: float = Field(ge=0, le=1)
    nullif_window: int = Field(ge=5)
    grain_min_sample: int = Field(ge=2)
    grain_max_distinct_share: float = Field(gt=0, le=1)
    pct_tolerance: float = Field(ge=0)

    # ── Scoring ──
    severity_weights: dict[str, float]

    # ── Executive summary ──
    summarizer_sample_rules: int = Field(ge=0)
    summarizer_sample_rows: int = Field(ge=0)
    summarizer_max_listed: int = Field(ge=1)
    summarizer_caveat_names: int = Field(ge=1)
    fallback_summary_top: int = Field(ge=1)

    # ── AI models: temperature and tier per role ──
    grounding_temperature: float = Field(ge=0, le=2)
    grounding_tier: Tier
    author_temperature: float = Field(ge=0, le=2)
    author_tier: Tier
    verifier_temperature: float = Field(ge=0, le=2)
    verifier_tier: Tier
    summarizer_temperature: float = Field(ge=0, le=2)
    summarizer_tier: Tier
    scout_temperature: float = Field(ge=0, le=2)
    scout_tier: Tier

    # ── Introspection ──
    text_numeric_min_parse: float = Field(ge=0, le=1)
    dup_check_min_rows: int = Field(ge=0)
    hint_max_tables: int = Field(ge=0)
    hint_max_values: int = Field(ge=1)
    hint_max_rows: int = Field(ge=1)
    hint_column_suffixes: list[str]
    hint_column_names: list[str]
    numeric_max_rows: int = Field(ge=1)
    numeric_max_cols_per_query: int = Field(ge=1)
    ratio_markers: list[str]
    key_tokens: list[str]
    full_detail_null_pct: float = Field(ge=0, le=100)
    full_detail_max_over_avg: float = Field(gt=0)

    # ── Rule families ──
    date_pair_suffixes: list[str]                     # "_start_date|_end_date", longest first
    date_pair_prefixes: list[str]                     # "start|end"

    # ── Discover ──
    discover_max_proposals: int = Field(ge=1)
    discover_key_suffix_pattern: str
    discover_self_key_pattern: str
    discover_min_table_rows: int = Field(ge=0)
    discover_mostly_empty_share: float = Field(gt=0, le=1)
    discover_singleton_max_count: int = Field(ge=1)
    dedup_covered_threshold: float = Field(gt=0, le=1)
    dedup_rejected_threshold: float = Field(gt=0, le=1)
    dedup_noise_words: list[str]
    discovered_rule_id_prefix: str = Field(min_length=1)
    proposal_no_exclusions_text: str

    # ── Report ──
    report_title: str = Field(min_length=1)
    report_disclaimer: str
    report_samples_per_finding: int = Field(ge=0)
    report_patterns_per_finding: int = Field(ge=0)
    report_full_sections: int = Field(ge=0)
    report_width_sample_rows: int = Field(ge=0)
    report_min_width_chars: int = Field(ge=1)
    report_max_width_chars: int = Field(ge=1)
    report_reason_max_chars: int = Field(ge=20)

    @field_validator("severity_weights")
    @classmethod
    def _weights(cls, value: dict[str, float]) -> dict[str, float]:
        out = {str(k).strip().lower(): float(v) for k, v in value.items() if str(k).strip()}
        if any(v < 0 for v in out.values()):
            raise ValueError("severity weights cannot be negative")
        return out

    @field_validator("date_pair_suffixes", "date_pair_prefixes")
    @classmethod
    def _pairs(cls, value: list[str]) -> list[str]:
        for item in value:
            if item.count("|") != 1 or not all(p.strip() for p in item.split("|")):
                raise ValueError(f"'{item}' is not a pair written as start|end")
        return value

    @field_validator("discover_key_suffix_pattern", "discover_self_key_pattern")
    @classmethod
    def _regex(cls, value: str) -> str:
        import re

        try:
            re.compile(value)
        except re.error as exc:
            raise ValueError(f"not a valid regular expression ({exc})") from None
        return value

    # Convenience views, so the engine never re-parses the pair strings.
    @property
    def date_suffix_pairs(self) -> tuple[tuple[str, str], ...]:
        return tuple(tuple(p.strip().lower() for p in s.split("|")) for s in self.date_pair_suffixes)  # type: ignore[misc]

    @property
    def date_prefix_pairs(self) -> tuple[tuple[str, str], ...]:
        return tuple(tuple(p.strip().lower() for p in s.split("|")) for s in self.date_pair_prefixes)  # type: ignore[misc]


def parse(raw: dict[str, Any]) -> AnomalySettings:
    """The request's settings as AnomalySettings. Raises SettingsInvalid naming every missing / bad key."""
    try:
        return AnomalySettings.model_validate(raw or {})
    except ValidationError as exc:
        missing, bad = [], []
        for err in exc.errors():
            loc = err.get("loc") or ("?",)
            key = str(loc[0])
            if err.get("type") == "missing":
                missing.append(key)
            else:
                bad.append(f"{key} ({err.get('msg', 'invalid')})")
        parts = []
        if missing:
            parts.append("missing " + ", ".join(sorted(set(missing))))
        if bad:
            parts.append("invalid " + "; ".join(bad))
        raise SettingsInvalid("Data Anomaly settings are not usable: " + " - ".join(parts)
                              + ". An admin can fix them under Settings > AI Settings > Data Anomaly.") from None


_CURRENT: ContextVar[AnomalySettings | None] = ContextVar("anomaly_settings", default=None)


def cfg() -> AnomalySettings:
    value = _CURRENT.get()
    if value is None:
        raise RuntimeError("No Data Anomaly settings are active.")
    return value


@contextmanager
def use(settings: AnomalySettings) -> Iterator[AnomalySettings]:
    token = _CURRENT.set(settings)
    try:
        yield settings
    finally:
        _CURRENT.reset(token)

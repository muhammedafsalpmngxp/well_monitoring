"""The Daily Report settings a request carries (Settings > AI Settings > Daily Report).

Every limit, threshold, cache size, model choice and tunable vocabulary of the feature is one of these. There are no
defaults here: the Tenant API sends every key (the seed's defaults filled in), and a missing or invalid key stops the
request with a message naming it.
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic.alias_generators import to_camel

Tier = Literal["main", "fast"]


class SettingsInvalid(ValueError):
    """A Daily Report setting is missing or out of range (message is safe to show)."""


class DailyReportSettings(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore", frozen=True)

    # ---- dashboard -------------------------------------------------------------------------------------------
    detail_view_task_threshold: int = Field(ge=0)
    dates_default_limit: int = Field(ge=1)
    dates_max_limit: int = Field(ge=1)
    milestone_window_days: int = Field(ge=0)
    milestone_overdue_display_limit: int = Field(ge=0)
    report_date_min: date
    report_date_max: date
    export_file_prefix: str = Field(min_length=1)

    # ---- caching ---------------------------------------------------------------------------------------------
    dataset_cache_ttl_seconds: int = Field(ge=0)
    dataset_cache_max_entries: int = Field(ge=1)
    answer_cache_ttl_seconds: int = Field(ge=0)
    answer_cache_max_entries: int = Field(ge=1)

    # ---- database --------------------------------------------------------------------------------------------
    db_ansi_codepage: str = Field(min_length=1)
    db_query_timeout_seconds: int = Field(ge=1)

    # ---- AI evidence -----------------------------------------------------------------------------------------
    explain_max_wells: int = Field(ge=1)
    evidence_task_limit_task: int = Field(ge=1)
    evidence_task_limit_well: int = Field(ge=1)
    evidence_task_limit_other: int = Field(ge=1)
    ongoing_task_sample_limit: int = Field(ge=0)
    top_wells_sample_limit: int = Field(ge=0)
    proof_row_limit: int = Field(ge=0)

    # ---- agent -----------------------------------------------------------------------------------------------
    agent_max_tool_calls: int = Field(ge=1)
    agent_max_revisions: int = Field(ge=0)
    deadline_window_days: int = Field(ge=0)
    question_min_length: int = Field(ge=1)
    question_max_length: int = Field(ge=1)
    plan_reason_max_chars: int = Field(ge=0)
    writer_word_limit_day: int = Field(ge=1)
    writer_word_limit: int = Field(ge=1)

    # ---- AI models -------------------------------------------------------------------------------------------
    temperature: float = Field(ge=0)
    planner_tier: Tier
    day_writer_tier: Tier
    writer_tier: Tier
    verifier_tier: Tier
    planner_max_tokens: int = Field(ge=1)
    writer_max_tokens: int = Field(ge=1)
    day_writer_max_tokens: int = Field(ge=1)
    verifier_max_tokens: int = Field(ge=1)

    # ---- agent tools -----------------------------------------------------------------------------------------
    list_wells_default_limit: int = Field(ge=1)
    list_wells_max_limit: int = Field(ge=1)
    milestones_tool_default_limit: int = Field(ge=1)
    milestones_tool_max_limit: int = Field(ge=1)
    milestones_tool_max_window_days: int = Field(ge=0)
    deadline_pressure_default_limit: int = Field(ge=1)
    deadline_pressure_max_limit: int = Field(ge=1)
    data_quality_default_limit: int = Field(ge=1)
    data_quality_max_limit: int = Field(ge=1)

    # ---- verifier --------------------------------------------------------------------------------------------
    llm_verify: bool
    verifier_max_issues: int = Field(ge=1)
    forbidden_phrases: list[str]

    # ---- planner fallback ------------------------------------------------------------------------------------
    heuristic_well_words: list[str]
    heuristic_well_id_min_digits: int = Field(ge=1)
    heuristic_deadline_keywords: list[str]
    heuristic_quality_keywords: list[str]
    heuristic_no_report_phrases: list[str]

    # ---- vocabulary ------------------------------------------------------------------------------------------
    milestone_labels: list[str]
    crew_in_progress_code: str

    @model_validator(mode="after")
    def _consistent(self) -> "DailyReportSettings":
        if self.report_date_min > self.report_date_max:
            raise ValueError("reportDateMin is after reportDateMax")
        for entry in self.milestone_labels:
            if "=" not in entry or not entry.split("=", 1)[0].strip():
                raise ValueError(f"milestoneLabels entry {entry!r} is not CODE=Label")
        return self

    # ------------------------------------------------------------------------------------------------------------
    def milestone_label(self, code: str) -> str:
        """The display name of a milestone code; an unnamed code is shown as it is."""
        for entry in self.milestone_labels:
            key, _, label = entry.partition("=")
            if key.strip() == code:
                return label.strip() or code
        return code


def load_settings(raw: dict) -> DailyReportSettings:
    """request.settings as DailyReportSettings, or SettingsInvalid naming the first problem key."""
    try:
        return DailyReportSettings.model_validate(raw or {})
    except ValidationError as exc:
        problems = []
        for error in exc.errors():
            where = ".".join(str(p) for p in error.get("loc", ()) if p != "__root__")
            if error.get("type") == "missing":
                problems.append(f"'{where}' is missing")
            else:
                problems.append(f"'{where}' is invalid ({error.get('msg', 'invalid value')})" if where
                                else error.get("msg", "invalid value"))
        raise SettingsInvalid("Daily Report settings: " + "; ".join(problems[:5])
                              + ". An admin can correct them under Settings > AI Settings > Daily Report.") from None

"""One Daily Report request: its settings, prompt texts, data source and services.

Replaces the original module-level singletons (app.api.dependencies): every service is built for the request from
what the request carries, and a per-request memo keeps one report date's dataset loaded once however many tools
ask for it. Across requests only the content-hashed caches in data.py are shared.
"""
from __future__ import annotations

from functools import cached_property
from typing import Any, Callable, Hashable, TypeVar

from app.features.common.context import FeatureRun
from app.features.dailyreport.data import DataSource
from app.features.dailyreport.settings import DailyReportSettings, load_settings
from app.features.dailyreport.texts import Texts

FEATURE = "dailyreport"

T = TypeVar("T")


class ReportContext:
    def __init__(self, run: FeatureRun, settings: DailyReportSettings | None = None) -> None:
        self.run = run
        self.settings = settings or load_settings(run.request.settings)
        self.texts = Texts(run)
        self.data = DataSource(run.request, self.settings)
        self._memo: dict[Hashable, Any] = {}

    def memo(self, key: Hashable, build: Callable[[], T]) -> T:
        if key not in self._memo:
            self._memo[key] = build()
        return self._memo[key]

    def forget(self, prefix: Hashable) -> None:
        """Drop memoised values whose key is a tuple starting with ``prefix`` (Refresh within one request)."""
        for key in [k for k in self._memo if isinstance(k, tuple) and k and k[0] == prefix]:
            del self._memo[key]

    # ---- services, built for this request -----------------------------------------------------------------------
    @cached_property
    def daily(self):
        from app.features.dailyreport.daily import DailyService
        return DailyService(self)

    @cached_property
    def grouping(self):
        from app.features.dailyreport.grouping import GroupingService
        return GroupingService()

    @cached_property
    def evidence(self):
        from app.features.dailyreport.evidence import EvidenceService
        return EvidenceService(self)

    @cached_property
    def activity(self):
        from app.features.dailyreport.well_activity import WellActivityService
        return WellActivityService(self)

    @cached_property
    def milestones(self):
        from app.features.dailyreport.milestones import MilestoneService
        return MilestoneService(self)

    @cached_property
    def crew(self):
        from app.features.dailyreport.crew import CrewSuggestionService
        return CrewSuggestionService(self)

    @cached_property
    def export(self):
        from app.features.dailyreport.export import ExportService
        return ExportService(self)

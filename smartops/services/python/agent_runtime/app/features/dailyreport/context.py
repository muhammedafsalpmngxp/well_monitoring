"""One Daily Report request: its settings, prompt texts, data source and services.

Replaces the original module-level singletons (app.api.dependencies): every service is built for the request from
what the request carries, and a per-request memo keeps one report date's dataset loaded once however many tools
ask for it. Across requests only the content-hashed caches in data.py are shared.
"""
from __future__ import annotations

import threading
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
        self._lock = threading.Lock()
        self._building: dict[Hashable, threading.RLock] = {}

    def memo(self, key: Hashable, build: Callable[[], T]) -> T:
        """Built once per request, also when several tools ask at the same time (they run in parallel): the others
        wait for the first. A build that fails is not kept, so the next caller tries again."""
        with self._lock:
            if key in self._memo:
                return self._memo[key]
            building = self._building.setdefault(key, threading.RLock())
        with building:
            with self._lock:
                if key in self._memo:
                    return self._memo[key]
            value = build()
            with self._lock:
                self._memo[key] = value
            return value

    def forget(self, prefix: Hashable) -> None:
        """Drop memoised values whose key is a tuple starting with ``prefix`` (Refresh within one request)."""
        with self._lock:
            for key in [k for k in self._memo if isinstance(k, tuple) and k and k[0] == prefix]:
                del self._memo[key]

    def warm(self, report_date, *, dataset: bool = False, activity: bool = False, details: bool = False,
             milestones: bool = False) -> None:
        """Loads, at the same time, what the coming tools will read (parallelWorkers at a time). A look-up that fails
        is left for its tool, which runs it again and reports the failure as usual."""
        from app.features.common.parallel import run_parallel
        pieces = []
        if dataset:
            pieces.append(lambda: self.daily.get_dataset(report_date))
        if activity or details:
            pieces.append(lambda: self.activity.warm(report_date, details=details))
        if milestones:
            pieces.append(lambda: self.milestones.warm())
        run_parallel(pieces, self.settings.parallel_workers)

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

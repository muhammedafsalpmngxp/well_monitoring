"""The current feature request, for code deep inside a feature (nodes, services, tools).

A ContextVar, as Ask Data's run settings: set it with ``run_context`` INSIDE the generator or function that does the
work (with_heartbeat runs generators on another thread). Threads started by a feature (thread pools) must copy the
context: ``pool.submit(contextvars.copy_context().run, fn, *args)``.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator

from app.features.common.models import FeatureRequest
from app.prompt_text import text as _text


@dataclass
class FeatureRun:
    feature: str                      # slippage | dailyreport | anomaly: prefix of its prompt keys and usage labels
    request: FeatureRequest
    usage: list[dict[str, Any]] = field(default_factory=list)

    @property
    def texts(self) -> dict[str, str]:
        return self.request.prompts

    @property
    def settings(self) -> dict[str, Any]:
        return self.request.settings

    def prompt(self, key: str) -> str:
        """The tenant's text for ``key`` (raises PromptMissing naming it when the Tenant API did not send it)."""
        return _text(self.request.prompts, key)


_RUN: ContextVar[FeatureRun | None] = ContextVar("feature_run", default=None)


def current() -> FeatureRun:
    run = _RUN.get()
    if run is None:
        raise RuntimeError("No Agentic Feature request is active.")
    return run


@contextmanager
def run_context(run: FeatureRun) -> Iterator[FeatureRun]:
    token = _RUN.set(run)
    try:
        yield run
    finally:
        _RUN.reset(token)

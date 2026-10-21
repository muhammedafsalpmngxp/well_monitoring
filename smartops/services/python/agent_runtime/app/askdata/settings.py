"""Settings for the CURRENT Ask Data run.

The ported DB Assistant code reads ``agent_settings.<x>`` and ``settings.<x>`` as module globals. Agents
are created at runtime, each with its own limits, schemas and database, so both names are proxies that
read the run started by ``run_context`` (a ContextVar, which LangGraph carries into every node).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

CACHE_ROOT = Path(os.environ.get("AGENT_RUNTIME_CACHE", Path(__file__).resolve().parents[2] / ".cache"))


@dataclass(frozen=True)
class AskDataSettings:
    """Per-run limits and visibility: the tenant's Ask Data settings (AI Settings > Ask Data & Features, sent by the Tenant API),
    narrowed by an agent's Knowledge Source (runner.settings_for). Nothing here names a schema, table or column."""
    max_sql_retries: int = 2
    max_rows: int = 500
    query_timeout: int = 60
    max_queries: int = 3
    verify_retries: int = 1
    history_turns: int = 3
    allowed_schemas: tuple[str, ...] = ()
    excluded_tables: tuple[str, ...] = ()
    excluded_columns: tuple[str, ...] = ()
    org_name: str = ""                 # {{ORG_NAME}} in the prompts
    export_prefix: str = "ask-data"
    # Export (tools/export.py): full re-read of an answer's SQL, no model call.
    export_max_rows: int = 1_000_000
    export_query_timeout: int = 600
    export_secret: str = field(default_factory=lambda: os.environ.get("ASKDATA_EXPORT_SECRET", ""))
    export_token_ttl: int = 86400


@dataclass(frozen=True)
class DbTarget:
    """The SQL Server database the agent queries. Sent per run by the Tenant API; never logged."""
    server: str
    name: str
    user: str
    password: str
    port: int = 1433
    driver: str = ""
    encrypt: str = "yes"
    trust_cert: str = "yes"
    connect_timeout: int = 15


@dataclass
class AskDataRun:
    settings: AskDataSettings
    db: DbTarget
    prompts: Any = None          # app.askdata.prompts.PromptSet
    llm: Any = None              # app.models.Llm (the tenant's provider)
    usage: list[dict[str, Any]] = field(default_factory=list)
    # The tenant's prompt texts {key: text} for this run, from the Tenant API (core.AiPrompt).
    texts: dict[str, str] = field(default_factory=dict)
    # The VALUE MATCHES block being built for this question (tools/value_match.start): a Future of (block, seconds).
    value_matches: Any = None


_RUN: ContextVar[AskDataRun | None] = ContextVar("askdata_run", default=None)


def current_run() -> AskDataRun:
    run = _RUN.get()
    if run is None:
        raise RuntimeError("No Ask Data run is active.")
    return run


@contextmanager
def run_context(run: AskDataRun) -> Iterator[AskDataRun]:
    token = _RUN.set(run)
    try:
        yield run
    finally:
        _RUN.reset(token)


class _AgentSettingsProxy:
    def __getattr__(self, name: str) -> Any:
        return getattr(current_run().settings, name)


class _SharedSettingsProxy:
    """The twise_common ``settings`` fields the ported DB code reads (db_*, config_db_*, cache_root)."""

    _DB = {"server": "server", "port": "port", "name": "name", "user": "user", "password": "password",
           "driver": "driver", "encrypt": "encrypt", "trust_cert": "trust_cert",
           "connect_timeout": "connect_timeout"}

    def __getattr__(self, name: str) -> Any:
        if name == "cache_root":
            return CACHE_ROOT
        if name == "query_timeout":
            return current_run().settings.query_timeout
        for prefix in ("config_db_", "db_"):   # the config database is never used here; same target
            if name.startswith(prefix) and name[len(prefix):] in self._DB:
                return getattr(current_run().db, self._DB[name[len(prefix):]])
        raise AttributeError(name)


agent_settings: Any = _AgentSettingsProxy()
settings: Any = _SharedSettingsProxy()

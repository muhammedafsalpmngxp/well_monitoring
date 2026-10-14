"""The query layer: the request's verified SQL by capability, run read-only and cached by content hash.

Capabilities (request.queries keys): DAILY_SUMMARY, DAILY_DETAILS, WELL_ACTIVITY, WELL_DETAIL, MILESTONES,
CREW_SUGGESTION, ACTIVITY_DATES. Parameters are bound by name in the order the query's ``params`` lists them;
``columns`` is checked on every result, so a query edited until it no longer returns what this code reads is
refused with a message naming the missing columns instead of producing wrong figures.

Caches (the only state the runtime keeps, see app/features/README.md): bounded, TTL from the request's settings,
keyed by a SHA-256 of the database identity (the whole connection, password included, hashed), the SQL text and
the parameters. Every entry is tagged with (database, report date) so Refresh drops exactly that date. A cache hit
still passes the SELECT-only gate and the table allowlist, so withdrawing a table takes effect at once.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from datetime import date
from typing import Any, Hashable, Optional

from app.features.common import db
from app.features.common.models import FeatureQuery, FeatureRequest

FEATURE_TITLE = "Daily Report"

DAILY_SUMMARY = "DAILY_SUMMARY"
DAILY_DETAILS = "DAILY_DETAILS"
WELL_ACTIVITY = "WELL_ACTIVITY"
WELL_DETAIL = "WELL_DETAIL"
MILESTONES = "MILESTONES"
CREW_SUGGESTION = "CREW_SUGGESTION"
ACTIVITY_DATES = "ACTIVITY_DATES"


class QueryConfigError(ValueError):
    """A verified query is missing or does not fit what this feature reads (message is safe to show)."""


class TtlCache:
    """A bounded, thread-safe TTL cache. TTL and size are passed per call (they come from each request's settings)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: "OrderedDict[str, tuple[float, Hashable, Any]]" = OrderedDict()

    def get(self, key: str, ttl_seconds: int) -> Any | None:
        if ttl_seconds <= 0:
            return None
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            stored_at, _, value = entry
            if time.monotonic() - stored_at > ttl_seconds:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return value

    def put(self, key: str, value: Any, *, tag: Hashable, ttl_seconds: int, max_entries: int) -> None:
        if ttl_seconds <= 0:
            return
        with self._lock:
            self._entries[key] = (time.monotonic(), tag, value)
            self._entries.move_to_end(key)
            while len(self._entries) > max(1, max_entries):
                self._entries.popitem(last=False)

    def invalidate(self, tag: Hashable) -> None:
        with self._lock:
            for key in [k for k, (_, t, _) in self._entries.items() if t == tag]:
                del self._entries[key]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


ROW_CACHE = TtlCache()      # query results
ANSWER_CACHE = TtlCache()   # verified agent answers (app/features/dailyreport/agent/graph.py)


def content_key(*parts: Any) -> str:
    canonical = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def database_identity(request: FeatureRequest) -> str:
    return content_key("db", request.db.model_dump())


def date_tag(identity: str, report_date: Optional[date]) -> tuple[str, Optional[str]]:
    return identity, report_date.isoformat() if report_date else None


class DataSource:
    """One request's view of the feature's verified SQL."""

    def __init__(self, request: FeatureRequest, settings) -> None:
        self._request = request
        self._settings = settings
        self.identity = database_identity(request)

    def query(self, key: str) -> FeatureQuery:
        found = self._request.queries.get(key)
        if found is None:
            raise QueryConfigError(f"The Daily Report query '{key}' is not configured for this tenant. An admin can "
                                   "restore it under AI Settings > Ask Data & Features > Daily Report.")
        return found

    def parameters(self, key: str, values: dict[str, Any]) -> list[Any]:
        found = self.query(key)
        missing = [name for name in found.params if name not in values]
        if missing:
            raise QueryConfigError(f"The Daily Report query '{key}' asks for {', '.join(missing)}, which Daily Report "
                                   "does not provide. An admin can correct it under AI Settings > Ask Data & Features > "
                                   "Daily Report.")
        return [values[name] for name in found.params]

    def rows(self, key: str, values: dict[str, Any], *, report_date: Optional[date] = None,
             cached: bool = True) -> list[dict[str, Any]]:
        found = self.query(key)
        params = self.parameters(key, values)
        settings = self._settings
        ttl = settings.dataset_cache_ttl_seconds if cached else 0
        cache_key = content_key("rows", self.identity, settings.db_ansi_codepage, key, found.sql, params)
        hit = ROW_CACHE.get(cache_key, ttl)
        if hit is not None:
            db.guard(found.sql, FEATURE_TITLE)        # an allowlist change applies to cached results too
            return list(hit)
        result = db.query(found.sql, params, feature_title=FEATURE_TITLE, label=key,
                          timeout=settings.db_query_timeout_seconds, codepage=settings.db_ansi_codepage)
        rows = _fit_columns(key, found, result.columns, result.rows)
        ROW_CACHE.put(cache_key, rows, tag=date_tag(self.identity, report_date), ttl_seconds=ttl,
                      max_entries=settings.dataset_cache_max_entries)
        return list(rows)

    def invalidate_date(self, report_date: date) -> None:
        """Refresh: drop this database's query results and verified answers for the date."""
        tag = date_tag(self.identity, report_date)
        ROW_CACHE.invalidate(tag)
        ANSWER_CACHE.invalidate(tag)

    def source(self, key: str, values: dict[str, Any], label: str) -> dict[str, Any]:
        """One query as the operator's 'show the SQL' panel lists it: the text exactly as it runs, the parameters
        beside it (bound, never spliced in)."""
        found = self.query(key)
        params = self.parameters(key, values)
        return {
            "label": label,
            "file": key,
            "parameters": [f"? {i}  {name.replace('_', ' ')} = {_shown(value)}"
                           for i, (name, value) in enumerate(zip(found.params, params), start=1)],
            "sql": found.sql,
        }


def _shown(value: Any) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def _fit_columns(key: str, found: FeatureQuery, columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Check the result against the query's column contract; a contract column the database spelled in another
    case is renamed to the contract's spelling (the code reads the contract's names)."""
    if not found.columns:
        return rows
    by_lower = {c.lower(): c for c in columns}
    missing = [c for c in found.columns if c.lower() not in by_lower]
    if missing:
        raise QueryConfigError(f"The Daily Report query '{key}' does not return {', '.join(missing)}. An admin can "
                               "correct it under AI Settings > Ask Data & Features > Daily Report.")
    renames = {by_lower[c.lower()]: c for c in found.columns if by_lower[c.lower()] != c}
    if not renames:
        return rows
    return [{renames.get(k, k): v for k, v in row.items()} for row in rows]

"""The envelope every Agentic Feature endpoint receives from the Tenant API.

The runtime keeps nothing of a tenant's: the database, the AI provider, every prompt text, the feature's settings, the
tables it may read and its verified SQL all come with each request (see app/features/README.md).
"""
from __future__ import annotations

from typing import Any

from pydantic import Field

from app.models import Db, Llm, _Camel


class FeatureQuery(_Camel):
    """One verified SQL query of a feature (core.AiFeatureQuery). Read-only; parameters are bound with ``?`` in the
    order of ``params``; ``columns`` is the output contract the feature code relies on (empty = not checked)."""
    sql: str = Field(min_length=1)
    params: list[str] = []
    columns: list[str] = []


class FeatureAccess(_Camel):
    """The tables a feature may read (AI Settings > Ask Data & Features > the feature). A table is readable when it is not excluded
    and either listed in ``included_tables`` or, when that list is empty, in one of ``allowed_schemas``. Names are
    ``schema.table`` (``excluded_*`` also accept a bare table / column name, as Ask Data does)."""
    allowed_schemas: list[str] = []
    included_tables: list[str] = []
    excluded_tables: list[str] = []
    excluded_columns: list[str] = []


class FeatureRequest(_Camel):
    db: Db
    llm: Llm | None = None
    prompts: dict[str, str] = {}
    settings: dict[str, Any] = {}
    access: FeatureAccess = FeatureAccess()
    queries: dict[str, FeatureQuery] = {}

"""Prompt texts, settings and SQL for the feature tests, from the seed the Tenant API copies into every tenant
(TWise.Tenant.Application/Resources/agentic-features.seed.json: per feature its settings, access, queries, prompts and
rules). During development a feature's not-yet-merged seed fragments can be supplied with AGENTIC_FRAGMENTS=<dir>
(<dir>/<feature>/prompts.json, settings.json, queries.json, access.json, rules.json); they are used only for a feature
the seed does not hold yet."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

SEED = (Path(__file__).resolve().parents[5] / "services" / "dotnet" / "TWise.Backend.Tenant" / "src"
        / "TWise.Tenant.Application" / "Resources" / "agentic-features.seed.json")


def _load(path: Path) -> Any | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _fragment(feature: str, name: str) -> Any | None:
    root = os.environ.get("AGENTIC_FRAGMENTS")
    return _load(Path(root) / feature / name) if root else None


def _seeded(feature: str) -> dict[str, Any] | None:
    return (_load(SEED) or {}).get("features", {}).get(feature)


def feature_seed(feature: str) -> dict[str, Any]:
    """The feature's entry of the seed: settings definitions, access, queries, prompts (and rules)."""
    seed = _seeded(feature)
    if seed:
        return seed
    rules = _fragment(feature, "rules.json") or []
    return {
        "settings": _fragment(feature, "settings.json") or [],
        "access": _fragment(feature, "access.json") or {},
        "queries": _fragment(feature, "queries.json") or [],
        "prompts": (_fragment(feature, "prompts.json") or {"prompts": []})["prompts"],
        "rules": rules.get("rules", []) if isinstance(rules, dict) else rules,
    }


def prompts(prefix: str) -> dict[str, str]:
    """{key: text} of every prompt of the feature whose keys start with ``prefix`` (e.g. "slippage.")."""
    return {p["key"]: p["text"] for p in feature_seed(prefix.rstrip("."))["prompts"] if p["key"].startswith(prefix)}


def prompt_definitions(prefix: str) -> list[dict[str, Any]]:
    """The prompts as the seed defines them (key, name, description, text, replyKeys, allowEmpty)."""
    return [p for p in feature_seed(prefix.rstrip("."))["prompts"] if p["key"].startswith(prefix)]


def default_settings(feature: str) -> dict[str, Any]:
    return {s["key"]: s["default"] for s in feature_seed(feature)["settings"]}


def queries(feature: str) -> dict[str, dict[str, Any]]:
    return {q["key"]: {"sql": q["sql"], "params": q.get("params", []), "columns": q.get("columns", [])}
            for q in feature_seed(feature)["queries"]}

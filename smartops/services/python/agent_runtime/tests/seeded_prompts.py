"""The prompt texts a tenant starts with, for tests: the Tenant API's seed file (the runtime itself has no texts).

The runtime receives prompts with each request from the Tenant API, which reads them from core.AiSettings.prompts_json.
Tests use the same seed the Tenant API copies into a new tenant's database.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

SEED = (Path(__file__).resolve().parents[4] / "services" / "dotnet" / "TWise.Backend.Tenant" / "src"
        / "TWise.Tenant.Infrastructure" / "Resources" / "ai-prompts.seed.json")


@lru_cache(maxsize=1)
def seed() -> dict[str, str]:
    return dict(json.loads(SEED.read_text(encoding="utf-8"))["prompts"])


def runtime_texts() -> dict[str, str]:
    """The keys the runtime uses (askdata.* and agent.*), as the Tenant API sends them."""
    return {k: v for k, v in seed().items() if k.startswith(("askdata.", "agent."))}


class SeedAdapter:
    """tests/prompt_scenarios.py adapter: prompts from the seed, as a tenant has them after seeding."""

    def prompt_set(self, max_rows, business_rules, few_shots):
        from app.askdata.prompts import build_prompts, knowledge
        from app.askdata.settings import current_run

        texts = runtime_texts()
        current_run().texts = texts
        return build_prompts(max_rows, knowledge(texts, "business_rules", business_rules),
                             knowledge(texts, "few_shots", few_shots), texts)

    def agent_kwargs(self):
        return {"texts": runtime_texts()}

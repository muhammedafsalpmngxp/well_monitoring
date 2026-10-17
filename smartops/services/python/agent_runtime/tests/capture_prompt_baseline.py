"""Writes tests/fixtures/prompt_baseline.json: every AI message of tests/prompt_scenarios.py, built from the prompts
in the database seed (smartops/infra/sql/ai-prompts.seed.json). Run it only after a deliberate change to the seed
or to how messages are built, and review the diff:

    python tests/capture_prompt_baseline.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import prompt_scenarios as sc  # noqa: E402
from seeded_prompts import SeedAdapter  # noqa: E402

CONCERNS = ["well.task_daily has MANY ROWS PER well_id: COUNT(*) may count a well more than once."]


def capture(adapter) -> dict:
    return {"askdata": sc.run_askdata(adapter) + sc.run_askdata(adapter, concerns=CONCERNS), "agents": sc.run_agents(adapter)}


if __name__ == "__main__":
    out = ROOT / "tests" / "fixtures" / "prompt_baseline.json"
    out.write_text(json.dumps(capture(SeedAdapter()), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out}")

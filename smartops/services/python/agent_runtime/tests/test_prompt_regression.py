"""The prompts now come from the tenant's database; every message the AI receives must be exactly what it was.

tests/fixtures/prompt_baseline.json was recorded from the runtime before the move (prompt files and texts written in
the code). Built from the seed the Tenant API copies into each tenant's core.AiSettings.prompts_json, every Ask Data
node and agent message over the scenario matrix in tests/prompt_scenarios.py must match it character for character.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))   # the helper modules beside this test

import capture_prompt_baseline as cap  # noqa: E402
from app.askdata.prompts import KEYS as ASKDATA_KEYS, build_prompts
from app.askdata.settings import run_context
from app.graph import AGENT_KEYS
from app.prompt_text import PromptMissing, fill, fill_lines
from seeded_prompts import SeedAdapter, runtime_texts, seed

BASELINE = Path(__file__).parent / "fixtures" / "prompt_baseline.json"


@pytest.fixture(scope="module")
def built():
    with run_context(None):
        return cap.capture(SeedAdapter())


@pytest.fixture(scope="module")
def baseline():
    return json.loads(BASELINE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("part", ["askdata", "agents"])
def test_every_ai_message_is_unchanged(part, built, baseline):
    assert len(built[part]) == len(baseline[part])
    for new, old in zip(built[part], baseline[part]):
        assert new["scenario"] == old["scenario"]
        assert new == old, f"messages changed in scenario {old['scenario']}"


def test_every_runtime_prompt_reaches_the_ai():
    """Every askdata.* and agent.* key, tagged, shows up in a recorded message: no key is dead or untested.

    askdata.msg.planner_nothing is the planner's text for "no query yet", a state the graph never sends it to the model
    with (the planner returns before calling the model when nothing was gathered)."""
    tagged = {k: f"<<{k}>>{v}" for k, v in runtime_texts().items()}

    class Tagged(SeedAdapter):
        def prompt_set(self, max_rows, business_rules, few_shots):
            from app.askdata.settings import current_run
            current_run().texts = tagged
            return build_prompts(max_rows, business_rules or tagged["askdata.business_rules"],
                                 few_shots or tagged["askdata.few_shots"], tagged)

        def agent_kwargs(self):
            return {"texts": tagged}

    with run_context(None):
        every = json.dumps(cap.capture(Tagged()), ensure_ascii=False)
    unused = [k for k in tagged if f"<<{k}>>" not in every and k != "askdata.msg.planner_nothing"]
    assert unused == []


def test_the_seed_holds_every_key_the_runtime_needs():
    texts = runtime_texts()
    assert set(ASKDATA_KEYS) <= set(texts)
    assert set(AGENT_KEYS) <= set(texts)
    assert set(texts) == set(ASKDATA_KEYS) | set(AGENT_KEYS), "the seed has keys the runtime never reads"
    # Trimmed, and only "Extra rules for questions" (ask-rules) may be empty: its default is "no extra rules".
    assert all(v == v.strip() and (v or k == "ask-rules") for k, v in seed().items())


def test_a_missing_prompt_is_named_and_nothing_falls_back():
    texts = dict(runtime_texts())
    del texts["askdata.sql_rules"]
    with pytest.raises(PromptMissing, match="askdata.sql_rules"):
        build_prompts(500, "rules", "examples", texts)


def test_ask_data_refuses_to_run_without_its_prompts():
    from app.askdata import runner
    from app.models import Db

    with run_context(None):
        events = list(runner.ask("q", [], mode="deep", options=None, db=Db(server="s", name="n", user="u", password="p"),
                                 llm=None, prompts={k: v for k, v in runtime_texts().items() if k != "askdata.msg.sql_final"}))
    assert events == [{"event": "error", "data": {"message": events[0]["data"]["message"]}}]
    assert "askdata.msg.sql_final" in events[0]["data"]["message"]


def test_an_agent_with_a_model_refuses_to_run_without_its_prompts():
    from app.main import run_events
    from app.models import RunRequest

    req = RunRequest.model_validate({"agent": {"name": "T", "steps": [{"text": "a"}], "tools": [{"agent": "db_assistant", "action": "chat"}]},
                                     "llm": {"baseUrl": "http://x", "model": "m"}, "prompts": {}})
    events = list(run_events(req))
    assert events[0][0] == "error" and "agent.supervisor" in events[0][1]["message"]


def test_an_edited_prompt_reaches_the_ai():
    """What an admin saves is what the model gets: an edited synthesize prompt and an edited template."""
    from app.askdata.nodes import synthesize
    import prompt_scenarios as sc

    texts = dict(runtime_texts())
    texts["askdata.synthesize_system"] = "Answer like a pirate."
    texts["askdata.msg.synth_final"] = "Now write it, matey."
    rec = sc.Recorder(["Arr."])
    from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget

    run = AskDataRun(settings=AskDataSettings(), db=DbTarget(server="s", name="n", user="u", password="p"), texts=texts)
    with run_context(run):
        run.prompts = build_prompts(500, texts["askdata.business_rules"], texts["askdata.few_shots"], texts)
        old = synthesize.chat
        synthesize.chat = rec
        try:
            synthesize.synthesize_node({"question": "q", "steps": [sc.STEP], "verify_ok": True, "history": []})
        finally:
            synthesize.chat = old
    assert "Answer like a pirate." in rec.calls[0]["system"]
    assert rec.calls[0]["user"].endswith("Now write it, matey.")


def test_placeholders_are_filled_once_and_unknown_braces_stay():
    assert fill("Q: {QUESTION} {\"ok\": true} {OTHER}", QUESTION="{QUESTION}?") == 'Q: {QUESTION}? {"ok": true} {OTHER}'
    assert fill_lines("a\n{BLOCK}\nb", BLOCK="") == "a\nb"
    assert fill_lines("a\n{BLOCK}\nb", BLOCK="x") == "a\nx\nb"

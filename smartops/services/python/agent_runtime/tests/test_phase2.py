import pytest
"""Sub-agent tool and For Each steps, with a fake model."""
import json

from app.main import run_events
from app.models import RunRequest

pytestmark = pytest.mark.usefixtures("seeded_prompts")


def _done(events):
    return [d for n, d in events if n == "done"][0]


def _agent(name, steps, inputs=(), kind="sequential"):
    return {"name": name, "type": kind, "steps": steps, "tools": [{"agent": "ask_ai", "action": "answer"}],
            "inputs": [{"name": n} for n in inputs]}


def chat(llm, messages):
    user = messages[-1][1]
    if "List the items" in messages[0][1]:
        return json.dumps({"items": ["W1", "W2", "W3"]}), {"input": 1, "output": 1}
    return "ans:" + user.split("INSTRUCTION: ")[-1], {"input": 1, "output": 1}


def test_for_each_runs_the_step_once_per_item_in_order():
    req = RunRequest.model_validate({
        "agent": _agent("P", [{"text": "List the late wells", "outputKey": "wells"},
                              {"text": "Review well {{item}}", "forEach": "wells"}]),
        "llm": {"baseUrl": "http://x", "model": "m"}})
    done = _done(list(run_events(req, chat=chat)))
    step = done["steps"][1]
    assert [x["item"] for x in step["items"]] == ["W1", "W2", "W3"] and all(x["ok"] for x in step["items"])
    assert step["answer"].startswith("**W1**: ans:Review well W1")


def test_for_each_takes_a_json_array_input_without_the_model():
    req = RunRequest.model_validate({
        "agent": _agent("P", [{"text": "Check {{item}}", "forEach": "wells"}], inputs=["wells"]),
        "inputs": {"wells": '["A", "B"]'}, "llm": {"baseUrl": "http://x", "model": "m"}})
    done = _done(list(run_events(req, chat=chat)))
    assert [x["item"] for x in done["steps"][0]["items"]] == ["A", "B"]


def test_for_each_without_items_fails_the_step():
    req = RunRequest.model_validate({"agent": _agent("P", [{"text": "Check {{item}}", "forEach": "wells"}], inputs=["wells"]),
                                     "inputs": {"wells": " "}})
    events = list(run_events(req, chat=chat))
    assert [n for n, _ in events][-1] in ("done", "error")


def test_subagent_runs_a_published_agent_with_the_instruction_as_its_input():
    sub = _agent("Counter", [{"text": "Count wells in {{cluster}}"}], inputs=["cluster"])
    req = RunRequest.model_validate({
        "agent": _agent("Lead", [{"text": "Nimr", "tool": {"agent": "subagent", "action": "7"}},
                                 {"text": "Summarise"}]),
        "subagents": {"7": sub}, "llm": {"baseUrl": "http://x", "model": "m"}})
    done = _done(list(run_events(req, chat=chat)))
    first = done["steps"][0]
    assert first["ok"] and first["answer"] == "ans:Count wells in Nimr"
    assert first["substeps"][0]["question"] == "Count wells in Nimr"


def test_subagent_must_be_given_and_nesting_is_limited():
    req = RunRequest.model_validate({"agent": _agent("Lead", [{"text": "x", "tool": {"agent": "subagent", "action": "9"}}]),
                                     "llm": {"baseUrl": "http://x", "model": "m"}})
    done = _done(list(run_events(req, chat=chat)))
    assert not done["ok"] and "not available" in done["steps"][0]["error"]

    loop = _agent("Self", [{"text": "again", "tool": {"agent": "subagent", "action": "1"}}])
    req = RunRequest.model_validate({"agent": loop, "subagents": {"1": loop}, "llm": {"baseUrl": "http://x", "model": "m"}})
    done = _done(list(run_events(req, chat=chat)))
    assert "nested 2 levels" in json.dumps(done)

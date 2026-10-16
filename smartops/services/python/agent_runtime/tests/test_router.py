"""Router steps and step links (sequential and loop agents), with fake tools and a fake model."""
import json

import pytest
from pydantic import ValidationError

from app.main import run_events
from app.models import Branch, RunRequest
from app.graph import matches

ROUTER = {"id": "r", "text": "By age", "kind": "router", "branches": [
    {"id": "b1", "label": "Child", "input": "age", "op": "lt", "value": "12", "target": "child"},
    {"id": "b2", "label": "Senior", "input": "age", "op": "gte", "value": "65", "target": "senior"},
    {"id": "b3", "label": "Adult", "op": "else", "target": "final"},
]}
STEPS = [
    {"id": "start", "text": "Price for {{age}}"},
    ROUTER,
    {"id": "child", "text": "Child discount", "next": "final"},
    {"id": "senior", "text": "Senior discount"},
    {"id": "final", "text": "Final price"},
]


def _req(age, steps=STEPS, kind="sequential", llm=False):
    return RunRequest.model_validate({
        "agent": {"name": "T", "type": kind, "steps": steps, "tools": [{"agent": "db_assistant", "action": "chat"}],
                  "inputs": [{"name": "age"}]},
        "inputs": {"age": age},
        "llm": {"baseUrl": "http://llm", "model": "m"} if llm else None,
    })


def _run(req, chat=None):
    calls = []

    def tool(agent, action, text, history, session_id):
        calls.append(text)
        yield {"event": "done", "data": {"answer": f"answer to {text}"}}
    events = list(run_events(req, run_tool=tool, **({"chat": chat} if chat else {})))
    return calls, events


@pytest.mark.parametrize("age, expected", [
    ("8", ["Price for 8", "Child discount", "Final price"]),      # child -> joins at final, skips senior
    ("85", ["Price for 85", "Senior discount", "Final price"]),   # senior -> falls through to the following step
    ("30", ["Price for 30", "Final price"]),                      # otherwise
])
def test_rules_pick_one_branch_and_branches_join(age, expected):
    calls, events = _run(_req(age))
    assert calls == expected
    decision = [d for n, d in events if n == "decision"][0]
    assert decision["by"] == "router" and decision["step"] == 2


def test_numbers_compare_as_numbers_and_text_ignores_case():
    assert matches(Branch(id="x", input="age", op="lt", value="12"), {"age": "9"}, "")      # "9" < "12" as text is false
    assert matches(Branch(id="x", input="q", op="contains", value="WELL"), {"q": "my wells"}, "")
    assert matches(Branch(id="x", input="last_answer", op="empty"), {}, "")
    assert not matches(Branch(id="x", input="q", op="equals", value="a"), {"q": "b"}, "")


def test_no_match_and_no_otherwise_goes_to_the_answer():
    router = {**ROUTER, "branches": ROUTER["branches"][:2]}
    calls, _ = _run(_req("30", steps=[STEPS[0], router, *STEPS[2:]]))
    assert calls == ["Price for 30"]


def test_ai_router_uses_the_models_choice():
    def chat(llm, messages):
        if "You route the request" in messages[0][1]:
            return json.dumps({"branch": 2, "reason": "old"}), {"input": 1, "output": 1}
        return "combined", {"input": 1, "output": 1}
    router = {**ROUTER, "routeBy": "ai"}
    calls, events = _run(_req("8", steps=[STEPS[0], router, *STEPS[2:]], llm=True), chat=chat)
    assert calls == ["Price for 8", "Senior discount", "Final price"]
    assert [d["reason"] for n, d in events if n == "decision"] == ["old"]


def test_a_link_back_is_rejected():
    steps = [{"id": "a", "text": "A"}, {"id": "b", "text": "B", "next": "a"}]
    _, events = _run(_req("1", steps=steps))
    assert events[-1][0] == "error" and "circle" in events[-1][1]["message"]


def test_routers_need_sequential_or_loop_and_real_targets():
    with pytest.raises(ValidationError, match="sequential and loop"):
        _req("1", kind="parallel")
    bad = {**ROUTER, "branches": [{"id": "b", "op": "else", "target": "nowhere"}]}
    with pytest.raises(ValidationError, match="does not exist"):
        _req("1", steps=[STEPS[0], bad])

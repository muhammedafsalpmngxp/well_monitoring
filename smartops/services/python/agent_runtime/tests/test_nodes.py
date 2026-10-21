"""Evaluator, Guardrail, Compute and Merge steps, with a fake model."""
import json

import pytest

from app import nodes
from app.main import run_events
from app.models import RunRequest

pytestmark = pytest.mark.usefixtures("seeded_prompts")


def _run(steps, chat, inputs=None, kind="sequential", max_iterations=3):
    req = RunRequest.model_validate({"agent": {"name": "A", "type": kind, "maxIterations": max_iterations,
                                               "tools": [{"agent": "ask_ai", "action": "answer"}], "steps": steps,
                                               "inputs": [{"name": k} for k in (inputs or {})]},
                                     "inputs": inputs or {}, "llm": {"baseUrl": "http://x", "model": "m"}})
    events = list(run_events(req, chat=chat))
    return events, [d for n, d in events if n == "done"][0]


def test_evaluator_sends_the_run_back_with_the_reason_until_it_passes():
    verdicts = iter([{"pass": False, "reason": "No well count."}, {"pass": True, "reason": "Has the count."}])
    drafts = []
    def chat(llm, messages):
        if "CRITERIA" in messages[-1][1]:
            return json.dumps(next(verdicts)), {"input": 1, "output": 1}
        drafts.append(messages[-1][1])
        return f"draft {len(drafts)}", {"input": 1, "output": 1}
    _, done = _run([{"id": "d", "text": "Draft the summary"}, {"id": "e", "text": "Gives the well count", "tool": {"agent": "evaluator", "action": "check"}},
                    {"id": "f", "text": "Format it"}], chat)
    assert [s["step"] for s in done["steps"]] == [1, 2, 1, 2, 3]
    assert "Failed: No well count." in drafts[1]       # the redraft sees why
    assert "Passed" not in done["answer"]               # checks are not part of the final answer


def test_evaluator_gives_up_after_max_iterations():
    chat = lambda llm, m: (json.dumps({"pass": False, "reason": "Still wrong."}) if "CRITERIA" in m[-1][1] else "draft", {})
    events, done = _run([{"id": "d", "text": "Draft"}, {"id": "e", "text": "OK?", "tool": {"agent": "evaluator", "action": "check"}}], chat, max_iterations=2)
    assert [s["step"] for s in done["steps"]] == [1, 2, 1, 2]
    assert "gave up after 2 tries" in done["steps"][-1]["answer"]


def test_guardrail_blocks_personal_data_and_warn_goes_on():
    chat = lambda llm, m: ("Call me on +968 9123 4567 or a@b.com", {})
    _, done = _run([{"text": "Reply"}, {"text": "Check the reply", "tool": {"agent": "guardrail", "action": "check"}, "options": {"pii": True}}, {"text": "Send"}], chat)
    assert done["answer"].startswith("Stopped by a guardrail: The answer contains an e-mail address")
    assert len(done["steps"]) == 2
    _, done = _run([{"text": "Reply"}, {"text": "Check the reply", "tool": {"agent": "guardrail", "action": "check"}, "options": {"action": "warn"}}, {"text": "Send"}], chat)
    assert len(done["steps"]) == 3 and done["steps"][1]["passed"] is False


def test_guardrail_checks_inputs_with_blocked_words_and_an_ai_policy():
    def chat(llm, m):
        if "POLICY" in m[-1][1]:
            return json.dumps({"violates": True, "reason": "Asks for salaries."}), {}
        return "ok", {}
    _, done = _run([{"text": "Check the question", "tool": {"agent": "guardrail", "action": "check"}, "options": {"check": "inputs", "pii": False, "blocked": "salary, password"}},
                    {"text": "Answer {{q}}"}], chat, inputs={"q": "What is the CEO salary?"})
    assert done["answer"] == 'Stopped by a guardrail: The inputs contain "salary".'
    _, done = _run([{"text": "Check the question", "tool": {"agent": "guardrail", "action": "check"}, "options": {"check": "inputs", "pii": False, "policy": "No questions about pay."}},
                    {"text": "Answer {{q}}"}], chat, inputs={"q": "What does Ali earn?"})
    assert done["answer"] == "Stopped by a guardrail: The inputs break the policy (Asks for salaries)."


def test_compute_template_pick_and_math_need_no_model():
    calls = []
    def chat(llm, m):
        calls.append(1)
        return {"Count wells": "Nimr has 393 wells", "Count rigs": "There are 12 rigs", "Status JSON": '{"data": {"items": [{"status": "late"}]}}'}.get(m[-1][1].split("INSTRUCTION: ")[-1], "final"), {}
    _, done = _run([{"text": "Count wells", "outputKey": "wells"}, {"text": "Count rigs", "outputKey": "rigs"}, {"text": "Status JSON", "outputKey": "status"},
                    {"text": "{{wells}} / {{rigs}}", "tool": {"agent": "compute", "action": "run"}, "options": {"mode": "math"}, "outputKey": "ratio"},
                    {"text": "", "tool": {"agent": "compute", "action": "run"}, "options": {"mode": "pick", "source": "status", "path": "data.items[0].status"}, "outputKey": "first"},
                    {"text": "Wells per rig: {{ratio}}, first status {{first}}", "tool": {"agent": "compute", "action": "run"}}], chat)
    answers = [s["answer"] for s in done["steps"]]
    assert answers[3] == "32.75" and answers[4] == "late" and answers[5] == "Wells per rig: 32.75, first status late"
    assert len(calls) == 3   # the three Ask AI steps; Compute made no call, and ending with it needs no combining call
    assert done["answer"] == "Wells per rig: 32.75, first status late"


def test_compute_refuses_code_and_merge_joins_keys():
    with pytest.raises(ValueError):
        nodes.arithmetic("__import__('os').system('x')")
    chat = lambda llm, m: ("A" if m[-1][1].endswith("INSTRUCTION: one") else "B", {})
    _, done = _run([{"text": "one", "outputKey": "x"}, {"text": "two", "outputKey": "y"},
                    {"text": "Summary", "tool": {"agent": "merge", "action": "join"}, "options": {"keys": "x, y"}}], chat)
    assert done["steps"][2]["answer"] == "Summary\n\n**x**\n\nA\n\n**y**\n\nB"


def test_evaluator_only_where_the_run_can_go_back():
    events = list(run_events(RunRequest.model_validate({"agent": {"name": "A", "type": "parallel", "tools": [{"agent": "ask_ai", "action": "answer"}],
        "steps": [{"text": "x"}, {"text": "ok?", "tool": {"agent": "evaluator", "action": "check"}}]}})))
    assert events[-1][0] == "error"

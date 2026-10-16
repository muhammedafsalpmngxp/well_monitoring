"""Offline tests: the twise agent and the AI provider are faked."""
import httpx

from app.graph import fill
from app.main import run_events
from app.models import RunRequest


def _req(steps, inputs=None, llm=None, required=("cluster",)):
    return RunRequest.model_validate({
        "agent": {
            "name": "Active Wells Analyst", "role": "drilling data analyst", "goal": "Report active wells",
            "steps": [{"text": s} for s in steps],
            "tools": [{"agent": "db_assistant", "action": "chat"}],
            "inputs": [{"name": n, "required": True} for n in required],
        },
        "inputs": inputs if inputs is not None else {"cluster": "Nimr"},
        "llm": llm,
    })


def fake_tool(answers, calls):
    def run_tool(agent, action, text, history, session_id):
        calls.append({"agent": agent, "action": action, "text": text, "history": history})
        yield {"event": "status", "data": {"stage": "Fetching your data", "seconds": 1}}
        yield {"event": "node", "data": {"phase": "start", "node": "executor"}}
        yield {"event": "done", "data": {"answer": answers[len(calls) - 1], "steps": [{"sql": "SELECT 1"}],
                                         "usage": [{"agent": "db_assistant.sql_author", "model": "m", "calls": 1, "input": 5, "output": 2}]}}
    return run_tool


def test_accepts_the_tenant_api_shape_with_nulls():
    req = RunRequest.model_validate({
        "agent": {"name": "A", "role": None, "description": None, "systemPrompt": None, "goal": None,
                  "steps": [{"text": "x", "tool": None}], "tools": [{"agent": "db_assistant", "action": "chat"}],
                  "inputs": [{"name": "cluster", "type": "string", "required": False, "description": None}],
                  "outputs": [], "status": "draft"},
        "inputs": {}, "llm": None, "sessionId": "s",
    })
    done = list(run_events(req, run_tool=fake_tool(["ok"], [])))[-1][1]
    assert done["ok"] and done["answer"] == "ok"


def test_fill_replaces_known_inputs_only():
    assert fill("wells in {{ cluster }} for {{year}}", {"cluster": "Nimr"}) == "wells in Nimr for {{year}}"


def test_missing_required_input_is_an_error_and_runs_nothing():
    calls = []
    events = list(run_events(_req(["x"], inputs={}), run_tool=fake_tool(["a"], calls)))
    assert events == [("error", {"message": "Fill in: cluster"})]
    assert calls == []


def test_single_step_returns_the_tool_answer_without_the_llm():
    calls = []
    events = list(run_events(_req(["How many active wells in {{cluster}}?"]), run_tool=fake_tool(["There are 12."], calls)))
    names = [e[0] for e in events]
    assert names[0] == "step" and "status" in names and "node" in names and names[-1] == "done"
    done = events[-1][1]
    assert done["ok"] and done["answer"] == "There are 12."
    assert done["steps"][0]["question"] == "How many active wells in Nimr?"
    assert done["steps"][0]["sql"] == ["SELECT 1"]
    assert calls[0]["agent"] == "db_assistant" and calls[0]["action"] == "chat"


def test_later_steps_get_earlier_answers_as_history_and_llm_writes_the_answer():
    calls, seen = [], []

    def chat(llm, messages):
        seen.append(messages)
        return "Nimr has 12 active wells; NMR-1 is most delayed.", {"input": 50, "output": 10}

    req = _req(["How many active wells in {{cluster}}?", "Which is most delayed?"],
               llm={"baseUrl": "http://llm", "model": "m"})
    done = list(run_events(req, run_tool=fake_tool(["12", "NMR-1"], calls), chat=chat))[-1][1]
    assert calls[1]["history"] == [{"user": "How many active wells in Nimr?", "assistant": "12"}]
    assert done["answer"].startswith("Nimr has 12")
    assert "drilling data analyst" in seen[0][0][1] and "Result: NMR-1" in seen[0][1][1]
    assert any(u["agent"] == "agent_runtime.answer" for u in done["usage"])


def test_without_llm_multi_step_answers_are_joined():
    done = list(run_events(_req(["a {{cluster}}", "b"]), run_tool=fake_tool(["one", "two"], [])))[-1][1]
    assert "one" in done["answer"] and "two" in done["answer"]


def test_unreachable_tool_fails_the_step_and_the_run():
    def down(*_):
        raise httpx.ConnectError("refused")
        yield  # pragma: no cover

    events = list(run_events(_req(["x {{cluster}}"]), run_tool=down))
    step_end = [d for n, d in events if n == "step" and d["phase"] == "end"][0]
    assert not step_end["ok"] and "Could not reach db_assistant" in step_end["error"]
    assert events[-1][0] == "done" and events[-1][1]["ok"] is False


def test_tool_error_event_is_reported():
    def failing(*_):
        yield {"event": "error", "data": {"message": "Service not ready"}}

    done = list(run_events(_req(["x {{cluster}}"]), run_tool=failing))[-1][1]
    assert not done["ok"] and "Service not ready" in done["answer"]

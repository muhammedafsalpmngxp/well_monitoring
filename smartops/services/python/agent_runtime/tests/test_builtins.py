"""URL Context, Load / Preload Memory and Exit Loop, with a fake model and fake pages."""
import json

import httpx
import pytest

from tests.seeded_prompts import runtime_texts

from app import builtins
from app.main import run_events
from app.models import AgentOutput, Llm, RunRequest

pytestmark = pytest.mark.usefixtures("seeded_prompts")

LLM = Llm(base_url="http://llm", model="m")


def _req(steps, kind="sequential", memories=(), max_iterations=5):
    return RunRequest.model_validate({
        "agent": {"name": "T", "type": kind, "maxIterations": max_iterations, "goal": "Find the status",
                  "steps": [{"text": t, "tool": {"agent": a, "action": "x"}} for t, a in steps],
                  "tools": [{"agent": "ask_ai", "action": "answer"}]},
        "llm": {"baseUrl": "http://llm", "model": "m"}, "memories": list(memories),
    })


def _done(events):
    return [d for n, d in events if n == "done"][0]


def test_url_context_reads_the_page_text_and_follows_a_safe_redirect(monkeypatch):
    monkeypatch.setattr(builtins.api_tool, "check_url", lambda url: None)
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(302, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html"},
                              text="<html><head><title>x</title></head><body><script>bad()</script><p>Well A is <b>online</b></p></body></html>")
    seen = []
    def chat(llm, messages):
        seen.append(messages[1][1])
        return "Well A is online", {"input": 1, "output": 1}
    events = list(builtins.url_context("Status at https://example.com/old?", [], LLM, chat, "",
                                       transport=httpx.MockTransport(handler), texts=runtime_texts()))
    assert events[-1]["data"]["answer"] == "Well A is online"
    assert "Well A is online" in seen[0] and "bad()" not in seen[0] and "PAGE https://example.com/old" in seen[0]


def test_url_context_refuses_private_hosts_and_needs_a_url():
    events = list(builtins.url_context("Read http://10.0.0.5/x and https://192.168.1.1/", [], LLM,
                                       lambda llm, m: (m[1][1], {}), "", texts=runtime_texts()))
    assert events[-1]["event"] == "error" and "No page could be read" in events[-1]["data"]["message"]
    assert list(builtins.url_context("no link here", [], LLM, lambda *a: ("", {}), ""))[-1]["event"] == "error"


def test_relevant_memories_share_words_with_the_instruction():
    mem = ["Nimr cluster has 393 wells", "The user prefers tables", "Rig 7 moved to Lekhwair"]
    assert builtins.relevant(mem, "How many wells in Nimr?") == ["Nimr cluster has 393 wells"]
    assert builtins.relevant(mem, "unrelated question") == []


def test_memory_steps_get_memories_and_the_run_returns_new_facts():
    prompts = []
    def chat(llm, messages):
        system, user = messages[0][1], messages[1][1]
        if "long-term memory" in system:
            return json.dumps({"facts": ["Nimr cluster has 393 wells", "Rig 7 is in Nimr"]}), {"input": 1, "output": 1}
        prompts.append(user)
        return "393", {"input": 1, "output": 1}
    req = _req([("How many wells in Nimr?", "load_memory")], memories=["Nimr cluster has 393 wells", "Unrelated fact"])
    done = _done(list(run_events(req, chat=chat)))
    assert done["ok"] and done["answer"] == "393"
    assert "Nimr cluster has 393 wells" in prompts[0] and "Unrelated fact" not in prompts[0]
    assert done["memories"] == ["Rig 7 is in Nimr"]   # the known fact is not kept twice

    req = _req([("Summarise what you know", "preload_memory")], memories=["A", "B"])
    prompts.clear()
    _done(list(run_events(req, chat=chat)))
    assert "- A" in prompts[0] and "- B" in prompts[0]


def test_exit_loop_ends_the_loop_when_the_goal_is_met():
    calls, checks = [], []
    decisions = iter([{"done": False, "reason": "no status yet"}, {"done": True, "reason": "status found"}])
    def chat(llm, messages):
        system = messages[0][1]
        if "Stop when found" in system:   # Exit Loop: the loop check with the step's own words
            return json.dumps(next(decisions)), {"input": 1, "output": 1}
        if "repeats its steps" in system:   # the round's own check: only after round 1
            checks.append(1)
            return json.dumps({"done": False, "reason": "go on"}), {"input": 1, "output": 1}
        calls.append(messages[1][1])
        return f"answer {len(calls)}", {"input": 1, "output": 1}
    req = _req([("Look for the status", "ask_ai"), ("Stop when found", "exit_loop"), ("Never reached", "ask_ai")], kind="loop")
    events = list(run_events(req, chat=chat))
    done = _done(events)
    assert [s["agent"] for s in done["steps"]] == ["ask_ai", "exit_loop", "ask_ai", "ask_ai", "exit_loop"]
    assert done["steps"][-1]["answer"].startswith("Goal met") and checks == [1]
    assert all("Goal met" not in c and "Not yet" not in c for c in calls)   # the checks are not fed to later steps
    assert [d for n, d in events if n == "decision"][-1] == {"by": "exit_loop", "done": True, "reason": "status found", "step": 2}


def test_exit_loop_only_in_loop_agents():
    events = list(run_events(_req([("A", "ask_ai"), ("Stop", "exit_loop")]), chat=lambda *a: ("x", {})))
    assert events[-1][0] == "error" and "Loop agents only" in events[-1][1]["message"]


def test_outputs_come_back_as_typed_fields_and_the_answer_is_unchanged():
    def chat(llm, messages):
        if "Fill the fields" in messages[0][1]:
            return '{"wells": "393", "on_plan": "yes", "late": ["W1"], "note": null}', {"input": 1, "output": 1}
        return "Nimr has 393 wells; W1 is late.", {"input": 1, "output": 1}
    req = _req([("How many wells in Nimr?", "ask_ai")])
    req.agent.outputs = [AgentOutput(name="wells", type="number"), AgentOutput(name="on_plan", type="boolean"),
                         AgentOutput(name="late", type="array"), AgentOutput(name="note")]
    done = _done(list(run_events(req, chat=chat)))
    assert done["answer"] == "Nimr has 393 wells; W1 is late."
    assert done["output"] == {"wells": 393, "on_plan": True, "late": ["W1"], "note": None}
    assert "output" not in _done(list(run_events(_req([("Q", "ask_ai")]), chat=chat)))


def test_url_context_with_retries_tries_again_when_no_page_is_read(monkeypatch):
    import app.graph as graph
    monkeypatch.setattr(graph.time, "sleep", lambda s: None)
    calls = []
    def fetch(url, transport=None):
        calls.append(url)
        if len(calls) < 2:
            raise httpx.ConnectTimeout("timed out")
        return "Page text"
    monkeypatch.setattr(builtins, "fetch_text", fetch)
    req = _req([("Summarise https://example.com/a", "url_context")])
    req.agent.steps[0].retries = 2
    done = _done(list(run_events(req, chat=lambda llm, m: ("summary", {"input": 1, "output": 1}))))
    assert done["ok"] and done["steps"][0]["tries"] == 2 and len(calls) == 2

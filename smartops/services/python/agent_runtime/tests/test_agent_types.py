"""Agent types (AgenticUIFramework `process`): parallel, supervisor and loop, with fake tools and a fake model."""
import json

from app.main import run_events
from app.models import RunRequest
from tests.seeded_prompts import runtime_texts


def _req(kind, steps=("A", "B"), max_iterations=5, llm=True):
    return RunRequest.model_validate({
        "agent": {"name": "T", "type": kind, "maxIterations": max_iterations, "goal": "Answer the question",
                  "steps": [{"text": s} for s in steps], "tools": [{"agent": "db_assistant", "action": "chat"}]},
        "llm": {"baseUrl": "http://llm", "model": "m"} if llm else None,
        "prompts": runtime_texts(),
    })


def tool(calls):
    def run(agent, action, text, history, session_id):
        calls.append(text)
        yield {"event": "done", "data": {"answer": f"answer to {text}"}}
    return run


def scripted(replies):
    """A fake model: decisions are taken in order, anything else is the combined answer."""
    it = iter(replies)

    def chat(llm, messages):
        system = messages[0][1]
        if "supervisor" in system or "repeats its steps" in system:
            return json.dumps(next(it)), {"input": 1, "output": 1}
        return "combined", {"input": 1, "output": 1}
    return chat


def _done(events):
    return [d for n, d in events if n == "done"][0]


def test_parallel_runs_every_step_then_combines():
    calls = []
    done = _done(run_events(_req("parallel"), run_tool=tool(calls), chat=scripted([])))
    assert sorted(calls) == ["A", "B"]
    assert done["answer"] == "combined" and len(done["steps"]) == 2


def test_supervisor_picks_the_order_and_steps_run_their_own_instruction():
    calls = []
    replies = [{"next": "step_2", "reason": "count first"}, {"next": "step_1"}, {"next": "FINISH"}]
    events = list(run_events(_req("supervisor"), run_tool=tool(calls), chat=scripted(replies)))
    assert calls == ["B", "A"]          # the instruction as written, never a reworded task
    assert [d["next"] for n, d in events if n == "decision"] == ["step_2", "step_1", "answer"]
    assert _done(events)["answer"] == "combined"


def test_supervisor_does_not_rerun_a_step_that_succeeded():
    calls = []
    replies = [{"next": "step_1"} for _ in range(10)]
    _done(run_events(_req("supervisor", max_iterations=3), run_tool=tool(calls), chat=scripted(replies)))
    assert calls == ["A"]


def test_supervisor_stops_at_max_iterations():
    calls = []
    replies = [{"next": "step_1"}, {"next": "step_2"}, {"next": "step_1"}]
    _done(run_events(_req("supervisor", steps=("A", "B", "C"), max_iterations=2), run_tool=tool(calls),
                     chat=scripted(replies)))
    assert calls == ["A", "B"]


def test_supervisor_without_a_provider_runs_every_step_in_order():
    calls = []
    events = list(run_events(_req("supervisor", steps=("A", "B", "C"), max_iterations=2, llm=False), run_tool=tool(calls)))
    assert calls == ["A", "B", "C"]   # every step once, even with more steps than max_iterations
    assert _done(events)["ok"] is True
    assert all("No AI provider" in d["reason"] for n, d in events if n == "decision" and d["next"] != "answer")


def test_supervisor_with_unknown_worker_finishes():
    calls = []
    done = _done(run_events(_req("supervisor"), run_tool=tool(calls), chat=scripted([{"next": "step_9", "task": "x"}])))
    assert calls == [] and done["ok"] is False


def test_loop_repeats_until_the_model_says_done():
    calls = []
    replies = [{"done": False, "reason": "not yet"}, {"done": True, "reason": "met"}]
    events = list(run_events(_req("loop"), run_tool=tool(calls), chat=scripted(replies)))
    assert calls == ["A", "B", "A", "B"]
    attempts = [d["attempt"] for n, d in events if n == "step" and d["phase"] == "end"]
    assert attempts == [1, 1, 2, 2]


def test_loop_stops_at_max_iterations_without_asking_again():
    calls = []
    _done(run_events(_req("loop", max_iterations=2), run_tool=tool(calls), chat=scripted([{"done": False}] * 5)))
    assert calls == ["A", "B", "A", "B"]


def test_sequential_is_unchanged():
    calls = []
    _done(run_events(_req("sequential", llm=False), run_tool=tool(calls)))
    assert calls == ["A", "B"]


def test_heartbeat_pings_while_a_step_is_quiet():
    import time as _t
    from app.main import with_heartbeat

    def slow():
        yield "step", {"step": 1}
        _t.sleep(0.35)
        yield "done", {"ok": True}
    names = [n for n, _ in with_heartbeat(slow(), every=0.1)]
    assert names[0] == "step" and names[-1] == "done" and "ping" in names


def test_heartbeat_stops_the_run_when_the_caller_stops_reading():
    import threading
    import time as _t
    from app.main import with_heartbeat

    produced, closed = [], threading.Event()

    def endless():
        try:
            while True:
                produced.append(1)
                yield "step", {"step": len(produced)}
                _t.sleep(0.01)
        finally:
            closed.set()

    stream = with_heartbeat(endless(), every=1)
    assert next(stream)[0] == "step"
    stream.close()   # the page left
    assert closed.wait(2), "the run kept going after the caller stopped reading"
    count = len(produced)
    _t.sleep(0.1)
    assert len(produced) == count

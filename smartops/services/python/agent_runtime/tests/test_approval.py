import pytest
"""Human Approval: the run pauses with its state; resume (approve / edit / reject) continues from that state in a
fresh graph, as the Tenant API does after any restart. Also: supervisor approval, loop-back routers, retries, threads."""
import json

from app.main import resume_events, run_events
from app.models import ResumeRequest, RunRequest

pytestmark = pytest.mark.usefixtures("seeded_prompts")


def chat(llm, messages):
    return "seen:" + messages[-1][1].split("INSTRUCTION: ")[-1][:200], {"input": 1, "output": 1}


def _body(token, kind="sequential", steps=None):
    return {"agent": {"name": "A", "type": kind, "tools": [{"agent": "ask_ai", "action": "answer"}], "steps": steps or [
        {"text": "Draft the message"},
        {"text": "Approve the message", "tool": {"agent": "approval", "action": "review"}},
        {"text": "Send it"}]}, "llm": {"baseUrl": "http://x", "model": "m"}, "sessionId": token}


def _pause(body, chat_fn=chat):
    events = list(run_events(RunRequest.model_validate(body), chat=chat_fn))
    assert events[-1][0] == "approval", events[-1]
    return events[-1][1]


def _resume(body, paused, decision, text="", by="", chat_fn=chat):
    req = ResumeRequest.model_validate({**body, "state": json.loads(json.dumps(paused["state"])), "node": paused["node"],
                                        "decision": decision, "text": text, "by": by})
    return dict(list(resume_events(req, chat=chat_fn)))


def test_the_run_pauses_with_its_state_and_resumes_in_a_fresh_graph():
    body = _body("t1")
    paused = _pause(body)
    assert paused["token"] == "t1" and paused["step"] == 2 and paused["node"] == "step_2"
    assert paused["draft"] == "seen:Draft the message" and len(paused["state"]["results"]) == 1
    done = _resume(body, paused, "approve", by="a@b.com")["done"]
    assert done["ok"] and [s["agent"] for s in done["steps"]] == ["ask_ai", "approval", "ask_ai"]
    assert done["steps"][1]["verdict"] == "Approved" and done["steps"][1]["reviewer"] == "a@b.com"


def test_edit_replaces_the_draft_for_the_later_steps():
    seen = []
    def spy(llm, messages):
        seen.append(messages[-1][1])
        return chat(llm, messages)
    body = _body("t2")
    done = _resume(body, _pause(body), "edit", "Fixed text", chat_fn=spy)["done"]
    assert done["steps"][1]["answer"] == "Fixed text" and done["steps"][1]["verdict"] == "Approved with edits"
    assert "Fixed text" in seen[0]


def test_reject_ends_the_run_with_the_comment():
    body = _body("t3")
    done = _resume(body, _pause(body), "reject", "Wrong numbers", "lead")["done"]
    assert [s["agent"] for s in done["steps"]] == ["ask_ai", "approval"]
    assert done["answer"] == "Rejected by lead: Wrong numbers"


def test_parallel_agents_are_refused_and_a_bad_node_is_reported():
    assert list(run_events(RunRequest.model_validate(_body("t4", kind="parallel")), chat=chat))[-1][0] == "error"
    body = _body("t5")
    paused = _pause(body)
    req = ResumeRequest.model_validate({**body, "state": paused["state"], "node": "step_9", "decision": "approve"})
    assert list(resume_events(req, chat=chat))[-1][0] == "error"


def test_a_supervisor_can_ask_for_approval_and_a_rejection_finishes_it():
    picks = iter([{"next": "step_1", "task": "Draft it"}, {"next": "step_2", "task": "Approve"}])
    def boss(llm, messages):
        if "supervisor" in messages[0][1]:
            return json.dumps(next(picks, {"next": "FINISH"})), {"input": 1, "output": 1}
        return chat(llm, messages)
    body = _body("t6", kind="supervisor", steps=[{"text": "Writer"}, {"text": "Approval", "tool": {"agent": "approval", "action": "review"}}])
    paused = _pause(body, boss)
    done = _resume(body, paused, "reject", "Not yet", chat_fn=boss)["done"]
    assert done["answer"] == "Rejected: Not yet"


def test_a_router_may_go_back_until_max_iterations():
    body = {"agent": {"name": "A", "type": "sequential", "maxIterations": 2, "tools": [{"agent": "ask_ai", "action": "answer"}],
                      "steps": [{"id": "draft", "text": "Draft"},
                                {"id": "review", "kind": "router", "text": "Approved?", "branches": [
                                    {"id": "b1", "label": "Revise", "input": "last_answer", "op": "contains", "value": "seen", "target": "draft"},
                                    {"id": "b2", "label": "Otherwise", "op": "else", "target": "final"}]},
                                {"id": "final", "text": "Finalize"}]},
            "llm": {"baseUrl": "http://x", "model": "m"}}
    events = list(run_events(RunRequest.model_validate(body), chat=chat))
    done = [d for n, d in events if n == "done"][0]
    assert [s["step"] for s in done["steps"]] == [1, 1, 3]
    assert "already ran 2 times" in [d for n, d in events if n == "decision"][-1]["reason"]


def test_a_failed_step_is_retried(monkeypatch):
    import app.graph as graph
    monkeypatch.setattr(graph.time, "sleep", lambda s: None)
    calls = []
    def flaky(agent, action, text, history, session_id):
        calls.append(text)
        if len(calls) < 3:
            yield {"event": "error", "data": {"message": "timeout"}}
        else:
            yield {"event": "done", "data": {"answer": "393"}}
    body = {"agent": {"name": "A", "steps": [{"text": "Count", "retries": 2}], "tools": [{"agent": "db_assistant", "action": "chat"}]}}
    done = [d for n, d in run_events(RunRequest.model_validate(body), run_tool=flaky) if n == "done"][0]
    assert done["ok"] and done["steps"][0]["tries"] == 3 and len(calls) == 3


def test_a_thread_gives_the_earlier_turns_to_the_steps():
    seen = []
    def spy(llm, messages):
        seen.append(messages[-1][1])
        return "David", {"input": 1, "output": 1}
    body = {"agent": {"name": "A", "steps": [{"text": "What is my name?"}], "tools": [{"agent": "ask_ai", "action": "answer"}]},
            "llm": {"baseUrl": "http://x", "model": "m"}, "thread": [{"user": "My name is David.", "assistant": "Hello David!"}]}
    list(run_events(RunRequest.model_validate(body), chat=spy))
    assert "My name is David." in seen[0]


def test_an_approval_can_name_the_answer_it_shows():
    def reviewer(llm, messages):
        ins = messages[-1][1].split("INSTRUCTION: ")[-1]
        return ("APPROVED" if ins.startswith("Review") else "The report"), {"input": 1, "output": 1}
    body = _body("t7", steps=[{"text": "Write the report", "outputKey": "report"}, {"text": "Review it"},
                              {"text": "Approve the report: {{report}}", "tool": {"agent": "approval", "action": "review"}}])
    paused = _pause(body, reviewer)
    assert paused["draft"] == "The report" and paused["question"] == "Approve the report"

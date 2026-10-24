"""Langfuse tracing (app/observability.py): off without keys, one trace per unit of work with the AI calls nested in
it, secrets masked. Spans go to an in-memory exporter: nothing is sent anywhere."""
from __future__ import annotations

import contextvars
import threading

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app import observability as obs
from app.features.common.context import FeatureRun, run_context
from app.features.common.models import FeatureRequest
from app.models import Db

KEY = "pk-lf-test-observability"


@pytest.fixture(scope="module")
def exporter():
    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exp = InMemorySpanExporter()
    client = Langfuse(public_key=KEY, secret_key="sk-lf-test", base_url="http://127.0.0.1:9",
                      tracer_provider=TracerProvider(), span_exporter=exp, mask=obs.mask)
    return client, exp


@pytest.fixture
def traced(monkeypatch, exporter):
    """Tracing on with the in-memory client; the spans each test produced."""
    client, exp = exporter
    exp.clear()
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", KEY)
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    monkeypatch.setattr(obs, "_client", client)

    def spans():
        client.flush()
        return {s.name: s for s in exp.get_finished_spans()}
    return spans


def ask_model(name: str, reply: str) -> str:
    with obs.ai_call(name) as config:
        return FakeListChatModel(responses=[reply]).invoke([("user", "question")], config=config or None).content


# ── off ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_without_keys_nothing_is_traced(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    monkeypatch.setattr(obs, "_client", None)
    assert obs.client() is None
    with obs.ai_call("x") as config:
        assert config == {}
    with obs.unit("x") as opened:
        assert opened is None
    events = [("status", {}), ("done", {"answer": "a"})]
    assert list(obs.traced_events(iter(events), "ask-data")) == events


# ── names and masking ──────────────────────────────────────────────────────────────────────────────────────────────

def test_trace_names_come_from_the_endpoint():
    assert obs.route_name("/api/agent-runtime/features/slippage/advisor") == "slippage-advisor"
    assert obs.route_name("/api/agent-runtime/askdata/ask") == "ask-data"
    assert obs.route_name("/api/agent-runtime/eval/judge") == "eval-judge"


def test_passwords_and_keys_are_masked():
    text = "Server=x;User Id=SA;Password=hunter2;api_key: abc123 key sk-lf-1234567890abcdef"
    masked = obs.mask(data={"a": [text]})["a"][0]
    assert "hunter2" not in masked and "abc123" not in masked and "1234567890abcdef" not in masked
    assert "Password=***" in masked and "User Id=SA" in masked


# ── traces ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_event_stream_is_one_trace_with_its_ai_calls_inside(traced):
    def events():
        yield "status", {}
        yield "done", {"answer": ask_model("askdata.sql_author", "SELECT 1 -- Password=hunter2")}

    list(obs.traced_events(events(), "ask-data", input="how many wells?", session_id="s1", tags=("ask-data",)))
    spans = traced()
    root, call = spans["ask-data"], spans["askdata.sql_author"]
    assert call.context.trace_id == root.context.trace_id and call.parent.span_id == root.context.span_id
    assert call.attributes["langfuse.observation.type"] == "generation"
    assert root.attributes["langfuse.observation.type"] == "agent"
    assert root.attributes["langfuse.observation.input"] == "how many wells?"
    assert root.attributes["session.id"] == "s1"
    assert "hunter2" not in root.attributes["langfuse.observation.output"]
    assert "hunter2" not in call.attributes["langfuse.observation.output"]


def test_an_error_event_marks_the_trace(traced):
    list(obs.traced_events(iter([("error", {"message": "The agent failed."})]), "agent-run"))
    root = traced()["agent-run"]
    assert root.attributes["langfuse.observation.level"] == "ERROR"


def test_an_ai_call_outside_any_trace_gets_its_own_named_after_the_endpoint(traced):
    token = obs.set_route("/api/agent-runtime/eval/judge")
    try:
        ask_model("agent.eval_judge", "yes")
    finally:
        obs.reset_route(token)
    spans = traced()
    assert spans["agent.eval_judge"].parent.span_id == spans["eval-judge"].context.span_id


def test_a_feature_request_is_one_trace_across_its_threads(traced):
    run = FeatureRun("slippage", FeatureRequest(db=Db(server="s", name="n", user="u", password="p")))
    token = obs.set_route("/api/agent-runtime/features/slippage/advisor")
    try:
        with run_context(run):
            ask_model("slippage.advisor", "first")

            def step():                                   # a step on a thread of its own sets the run again
                with run_context(run):
                    ask_model("slippage.advisor_step", "second")
            t = threading.Thread(target=contextvars.copy_context().run, args=(step,))
            t.start()
            t.join()
    finally:
        obs.reset_route(token)
    spans = traced()
    root = spans["slippage-advisor"]
    for name in ("slippage.advisor", "slippage.advisor_step"):
        assert spans[name].context.trace_id == root.context.trace_id
    assert root.attributes["langfuse.trace.tags"] == ("agentic-feature", "slippage")
    assert sum(1 for s in spans.values() if s.parent is None) == 1                # one trace, one root

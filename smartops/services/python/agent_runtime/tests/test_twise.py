"""The twise agent service is optional (AGENT_RUNTIME_TWISE_URL)."""


def test_without_a_twise_url_only_built_in_tools_are_offered(monkeypatch):
    from fastapi.testclient import TestClient
    from app import twise
    from app.main import app

    monkeypatch.setattr(twise, "TWISE_URL", "")
    body = TestClient(app).get("/api/agent-runtime/tools").json()
    assert [t["agent"] for t in body["tools"]] == ["ask_data", "sql_query", "ask_ai", "url_context", "load_memory", "preload_memory", "exit_loop", "approval", "evaluator", "guardrail", "compute", "merge"] and body["message"] is None

"""Eval judge: the model's verdict on an answer."""
from fastapi.testclient import TestClient

import app.graph as graph
from app.main import app


def test_the_judge_returns_the_models_verdict(monkeypatch):
    seen = []
    def chat(llm, messages):
        seen.append((llm.temperature, messages[1][1]))
        return '{"pass": false, "reason": "It says 392, not 393."}', {"input": 5, "output": 3}
    monkeypatch.setattr(graph, "_chat", chat)
    body = {"llm": {"baseUrl": "http://x", "model": "m", "temperature": 0.9}, "question": "cluster: Nimr",
            "answer": "Nimr has 392 wells.", "expectation": "Says Nimr has 393 wells"}
    r = TestClient(app).post("/api/agent-runtime/eval/judge", json=body).json()
    assert r["pass"] is False and "393" in r["reason"] and r["usage"]["input"] == 5
    assert seen[0][0] == 0 and "EXPECTATION:\nSays Nimr has 393 wells" in seen[0][1]

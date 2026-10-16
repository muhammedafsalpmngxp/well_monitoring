"""Calls the twise-agentic supervisor: its agent list (the tools) and one agent run, streamed."""
from __future__ import annotations

import json
import os
from typing import Any, Iterable, Iterator

import httpx

TWISE_URL = os.environ.get("AGENT_RUNTIME_TWISE_URL", "http://localhost:8000").rstrip("/")
TWISE_API_KEY = os.environ.get("AGENT_RUNTIME_TWISE_API_KEY", "")
STEP_TIMEOUT = float(os.environ.get("AGENT_RUNTIME_STEP_TIMEOUT", "180"))


def _headers() -> dict[str, str]:
    return {"X-API-Key": TWISE_API_KEY} if TWISE_API_KEY else {}


def list_tools() -> list[dict[str, Any]]:
    """Every twise agent and the actions it accepts (GET /api/agents)."""
    r = httpx.get(f"{TWISE_URL}/api/agents", headers=_headers(), timeout=15)
    r.raise_for_status()
    return [
        {
            "agent": a["name"],
            "title": a.get("title") or a["name"],
            "description": a.get("description") or "",
            "capabilities": list(a.get("capabilities") or []),
            "ready": (a.get("health") or {}).get("status") in ("ok", "ready", None),
        }
        for a in r.json().get("agents", [])
    ]


def run_tool(agent: str, action: str, text: str, history: list[dict[str, str]], session_id: str) -> Iterator[dict[str, Any]]:
    """Runs one agent through POST /api/supervisor/execute and yields its events
    ({"event": "start"|"node"|"status"|"done"|"error", "data": {...}})."""
    body = {
        "agent": agent, "action": action, "input_text": text, "session_id": session_id,
        "payload": {"mode": "deep", "history": history},
    }
    timeout = httpx.Timeout(STEP_TIMEOUT, connect=10)
    with httpx.stream("POST", f"{TWISE_URL}/api/supervisor/execute", json=body, headers=_headers(), timeout=timeout) as r:
        r.raise_for_status()
        yield from parse_sse(r.iter_lines())


def parse_sse(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    name, data = "message", []
    for raw in lines:
        line = raw.rstrip("\r")
        if not line:
            if data:
                try:
                    payload = json.loads("\n".join(data))
                except ValueError:
                    payload = {"text": "\n".join(data)}
                yield {"event": name, "data": payload if isinstance(payload, dict) else {"value": payload}}
            name, data = "message", []
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())

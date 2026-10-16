"""
Agent Runtime: runs agents built on the Create New Agent page as LangGraph graphs.

Only the Tenant API calls this service; it owns storage, permissions and run history.

Endpoints:
  GET  /health
  GET  /api/agent-runtime/tools   built-in Ask Data + twise agents and the actions each accepts
  POST /api/agent-runtime/agentflow/export   agent -> agentflow.json v1 (AgenticUIFramework format)
  POST /api/agent-runtime/agentflow/import   agentflow.json v1 -> agent + warnings
  POST /api/agent-runtime/askdata/export   an Ask Data answer's data as xlsx / docx (signed token, no model call)
  POST /api/agent-runtime/run     runs one agent configuration; server-sent events:
                                  step, status, node while it runs (ping every 15 s when quiet),
                                  then done or error
"""
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterator

# Local runs: smartops/shared/python. In Docker PYTHONPATH already has /shared.
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "shared" / "python"))

import httpx
from fastapi import Body, Depends, Header, HTTPException
from fastapi.responses import Response, StreamingResponse

from smartops_shared.app import create_app

from app import twise
from app.agentflow.convert import from_agentflow, to_agentflow
from app.graph import build_graph, missing_inputs
from app.models import AskDataExportRequest, RunRequest

API_KEY = os.environ.get("AGENT_RUNTIME_API_KEY", "")

app = create_app(title="SmartOps Agent Runtime", service_name="agent-runtime")


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


ASK_DATA_TOOL = {
    "agent": "ask_data", "title": "Ask Data (built-in)", "ready": True, "capabilities": ["deep", "normal"],
    "description": "Answers a question from the database: writes one safe read-only SELECT, checks and runs it, "
                   "verifies the result and writes the answer. deep = full checks; normal = fast.",
}


@app.get("/api/agent-runtime/tools", dependencies=[Depends(require_key)])
def tools() -> dict[str, Any]:
    """The built-in Ask Data tool, then the twise agents (left out, with a message, when twise is down)."""
    try:
        return {"tools": [ASK_DATA_TOOL, *twise.list_tools()], "message": None}
    except httpx.HTTPError as exc:
        return {"tools": [ASK_DATA_TOOL], "message": f"The agent service at {twise.TWISE_URL} is not reachable: {exc}"}


@app.post("/api/agent-runtime/agentflow/export", dependencies=[Depends(require_key)])
def agentflow_export(agent: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """A saved agent (Tenant API shape) as agentflow.json v1, the AgenticUIFramework's format."""
    return to_agentflow(agent)


@app.post("/api/agent-runtime/agentflow/import", dependencies=[Depends(require_key)])
def agentflow_import(flow: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """An agentflow.json v1 (LangGraph) as an agent in the Tenant API shape, plus what could not be used."""
    try:
        agent, warnings = from_agentflow(flow)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:2000]) from exc
    return {"agent": agent, "warnings": warnings}


@app.post("/api/agent-runtime/askdata/export", dependencies=[Depends(require_key)])
def askdata_export(req: AskDataExportRequest) -> Response:
    """twise db_assistant POST /export: re-runs the exact SQL of an answer and returns every row as a file."""
    from app.askdata import runner
    from app.askdata.tools.export import ExportError

    try:
        content_type, filename, body = runner.export(req.token, req.format, question=req.question, answer=req.answer,
                                                     verified=req.verified, options=req.ask_data, db=req.db)
    except ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(status_code=501, detail=f"{req.format.upper()} export is not available on this server ({exc}).") from exc
    return Response(content=body, media_type=content_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/api/agent-runtime/run", dependencies=[Depends(require_key)])
def run(req: RunRequest) -> StreamingResponse:
    return StreamingResponse(
        (_sse(name, data) for name, data in with_heartbeat(run_events(req))),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def run_events(req: RunRequest, **graph_overrides: Any) -> Iterator[tuple[str, dict[str, Any]]]:
    """The run as (event, data) pairs; the last one is done or error."""
    missing = missing_inputs(req.agent, req.inputs)
    if missing:
        yield "error", {"message": "Fill in: " + ", ".join(missing)}
        return
    started, final = time.monotonic(), {}
    try:
        graph = build_graph(req.agent, req.llm, req.session_id, db=req.db, **graph_overrides)
        for mode, chunk in graph.stream({"inputs": req.inputs, "results": [], "usage": []}, stream_mode=["custom", "values"]):
            if mode == "custom":
                yield chunk["event"], chunk["data"]
            else:
                final = chunk
    except Exception as exc:  # noqa: BLE001 - reported to the caller, who records the failed run
        yield "error", {"message": f"The agent failed: {exc}"[:1000]}
        return
    yield "done", {
        "answer": final.get("answer", ""), "ok": bool(final.get("ok")), "steps": final.get("results", []),
        "usage": final.get("usage", []), "seconds": round(time.monotonic() - started, 1),
    }


def with_heartbeat(events: Iterator[tuple[str, dict[str, Any]]], every: float = 15.0) -> Iterator[tuple[str, dict[str, Any]]]:
    """Runs the events on a thread and sends "ping" when nothing came for `every` seconds: a step can wait minutes
    on the AI provider, and an idle stream is cut by proxies and browsers."""
    items: queue.Queue = queue.Queue()
    end = object()

    def pump() -> None:
        try:
            for item in events:
                items.put(item)
        finally:
            items.put(end)

    threading.Thread(target=pump, daemon=True).start()
    while True:
        try:
            item = items.get(timeout=every)
        except queue.Empty:
            yield "ping", {}
            continue
        if item is end:
            return
        yield item


def _sse(name: str, data: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8006")))

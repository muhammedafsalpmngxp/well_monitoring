"""
Agent Runtime: runs agents built on the Create New Agent page as LangGraph graphs.

Only the Tenant API calls this service; it owns storage, permissions and run history.

Endpoints:
  GET  /health
  GET  /api/agent-runtime/tools   built-in tools (Ask Data, Saved SQL, Ask AI, ...) + twise agents and the actions each accepts
  POST /api/agent-runtime/agentflow/export   agent -> agentflow.json v1 (AgenticUIFramework format)
  POST /api/agent-runtime/agentflow/import   agentflow.json v1 -> agent + warnings
  POST /api/agent-runtime/tools/try   calls one Tool (REST) once with sample values
  POST /api/agent-runtime/askdata/export   an Ask Data answer's data as xlsx / docx (signed token, no model call)
  POST /api/agent-runtime/askdata/ask   Ask your data: one question on the Ask Data database; events:
                                  status, node (ping when quiet), then done or error
  POST /api/agent-runtime/run     runs one agent configuration; server-sent events:
                                  inputs (what a question or the setup step set), step, status, node
                                  while it runs (ping every 15 s when quiet), then done, approval (paused)
                                  or error
  POST /api/agent-runtime/resume  Human Approval: continues a paused run with the person's decision
  POST /api/agent-runtime/eval/judge   Evals: does an answer meet a test case's expectation
"""
import logging
import os
import sys
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
from app.errors import user_message
from app import trace
from app.graph import RUN_KEYS, approval_update, build_graph, missing_inputs, uses
from app.prompt_text import missing as missing_prompts
from app.models import AskDataAskRequest, AskDataExportRequest, JudgeRequest, ResumeRequest, RunRequest, ToolTryRequest
from app import sqlstep
from app.prepare import Prepared, asks_question, prepare
from app.sqlstep import SQL_QUERY_TOOL
from app.features.anomaly.api import router as anomaly_router
from app.features.dailyreport.api import router as dailyreport_router
from app.features.slippage.api import router as slippage_router
from app.streaming import sse as _sse, with_heartbeat  # noqa: F401  (with_heartbeat: imported by tests)
from langgraph.checkpoint.memory import InMemorySaver

from app import api_tool
from app import builtins, nodes

API_KEY = os.environ.get("AGENT_RUNTIME_API_KEY", "")

app = create_app(title="SmartOps Agent Runtime", service_name="agent-runtime")
log = logging.getLogger("agent_runtime")
# Terminal logs (rich): each request, graph node, agent step, AI call and SQL query (app/trace.py).
trace.setup()


@app.middleware("http")
async def _log_request(request, call_next):
    """One line per runtime request: method, path, status, seconds (a stream is timed until its headers)."""
    started = time.monotonic()
    response = await call_next(request)
    if request.url.path.startswith("/api/agent-runtime"):
        trace.request_done(request.method, request.url.path, response.status_code, time.monotonic() - started)
    return response


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


# Agentic AI → Agentic Features (app/features): each feature's endpoints, behind the same key. The Tenant API sends
# every request's database, AI provider, prompts, settings, readable tables and verified SQL.
_FEATURES = "/api/agent-runtime/features"
app.include_router(slippage_router, prefix=f"{_FEATURES}/slippage", dependencies=[Depends(require_key)], tags=["Slippage"])
app.include_router(dailyreport_router, prefix=f"{_FEATURES}/dailyreport", dependencies=[Depends(require_key)],
                   tags=["Daily Report"])
app.include_router(anomaly_router, prefix=f"{_FEATURES}/anomaly", dependencies=[Depends(require_key)], tags=["Data Anomaly"])


ASK_DATA_TOOL = {
    "agent": "ask_data", "title": "Ask Data (built-in)", "ready": True, "capabilities": ["deep", "normal"],
    "description": "Answers a question from the database: writes one safe read-only SELECT, checks and runs it, "
                   "verifies the result and writes the answer. deep = full checks; normal = fast.",
}


ASK_AI_TOOL = {
    "agent": "ask_ai", "title": "Ask AI (built-in)", "ready": True, "capabilities": ["answer"],
    "description": "The tenant's AI model answers the instruction from the earlier results. Model, temperature and "
                   "max tokens can be set per step.",
}


@app.get("/api/agent-runtime/tools", dependencies=[Depends(require_key)])
def tools() -> dict[str, Any]:
    """The built-in tools (Ask Data, Saved SQL, Ask AI and the others), then the twise agents (left out, with a message, when twise is down)."""
    built_in = [ASK_DATA_TOOL, SQL_QUERY_TOOL, ASK_AI_TOOL, *builtins.TOOLS, *nodes.TOOLS]
    try:
        return {"tools": [*built_in, *twise.list_tools()], "message": None}
    except httpx.HTTPError as exc:
        # One line, no stack trace: twise not running is an expected state (the page asks every time it opens).
        log.warning("twise agent service at %s is not reachable (%s); only the built-in tools are offered", twise.TWISE_URL, exc)
        return {"tools": built_in, "message": f"The extra agent tools (agent service at {twise.TWISE_URL}) are offline. "
                                              "Ask Data and Saved SQL still work; start that service to add the others."}


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


@app.post("/api/agent-runtime/eval/judge", dependencies=[Depends(require_key)])
def eval_judge(req: JudgeRequest) -> dict[str, Any]:
    """Eval: {pass, reason, usage}. The model grades the answer against the expectation only (not style)."""
    from app.askdata.common.text import extract_json
    from app.graph import _chat

    system = ("You grade an AI agent's answer for a test case. Decide only whether the answer meets the expectation; "
              "ignore style and length unless the expectation mentions them. Numbers must match when the expectation "
              'gives one. Reply with JSON only: {"pass": true|false, "reason": "<one sentence>"}')
    user = f"QUESTION / INPUTS:\n{req.question}\n\nEXPECTATION:\n{req.expectation}\n\nANSWER:\n{req.answer}"
    try:
        reply, tokens = _chat(req.llm.model_copy(update={"temperature": 0}), [("system", system), ("user", user)])
    except Exception as exc:  # noqa: BLE001 - the case is reported as not judged
        raise HTTPException(status_code=502, detail=f"The judge model failed: {exc}"[:1000]) from exc
    verdict = extract_json(reply, default={})
    verdict = verdict if isinstance(verdict, dict) else {}
    return {"pass": verdict.get("pass") is True, "reason": str(verdict.get("reason") or reply)[:1000],
            "usage": {"agent": "agent_runtime.judge", "model": req.llm.model, "calls": 1, **tokens}}


@app.post("/api/agent-runtime/tools/try", dependencies=[Depends(require_key)])
def tool_try(req: ToolTryRequest) -> dict[str, Any]:
    """One call of a Tool with the values given: {status, result}; 400 for a URL the runtime may not call."""
    try:
        return api_tool.call(req.tool, req.args)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"The call failed: {exc}"[:1000]) from exc


@app.post("/api/agent-runtime/askdata/export", dependencies=[Depends(require_key)])
def askdata_export(req: AskDataExportRequest) -> Response:
    """twise db_assistant POST /export: re-runs the exact SQL of an answer and returns every row as a file."""
    from app.askdata import runner
    from app.askdata.tools.export import ExportError

    try:
        content_type, filename, body = runner.export(req.token, req.format, question=req.question, answer=req.answer,
                                                     verified=req.verified, options=req.ask_data, db=req.db,
                                                     tenant=req.ask_data_settings)
    except (ExportError, ValueError) as exc:   # ValueError: the agent's schemas cannot be read here
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(status_code=501, detail=f"{req.format.upper()} export is not available on this server ({exc}).") from exc
    return Response(content=body, media_type=content_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/api/agent-runtime/askdata/ask", dependencies=[Depends(require_key)])
def askdata_ask(req: AskDataAskRequest) -> StreamingResponse:
    return StreamingResponse(
        (_sse(name, data) for name, data in with_heartbeat(askdata_events(req))),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/agent-runtime/resume", dependencies=[Depends(require_key)])
def resume(req: ResumeRequest) -> StreamingResponse:
    """Human Approval: continue a paused run (approve / edit / reject); streams like /run."""
    return StreamingResponse(
        (_sse(name, data) for name, data in with_heartbeat(resume_events(req))),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def askdata_events(req: AskDataAskRequest) -> Iterator[tuple[str, dict[str, Any]]]:
    """The question as (event, data) pairs from the same Ask Data graph an agent's ask_data step runs; last is done or error."""
    from app.askdata import runner

    try:
        for ev in runner.ask(req.question, req.history, mode=req.mode, options=req.ask_data, db=req.db, llm=req.llm,
                             prompts=req.prompts, tenant=req.ask_data_settings):
            data = ev["data"]
            if ev["event"] == "done":
                # The panel has no Export button: drop the "download using the Export option" sentence.
                data = {**data, "answer": runner.without_export_hints(data.get("answer") or "")}
            yield ev["event"], data
    except Exception as exc:  # noqa: BLE001 - shown in the panel: a safe message, the details in the log
        log.exception("Ask your data failed")
        yield "error", {"message": user_message(exc, "Ask Data")}


@app.post("/api/agent-runtime/run", dependencies=[Depends(require_key)])
def run(req: RunRequest) -> StreamingResponse:
    return StreamingResponse(
        (_sse(name, data) for name, data in with_heartbeat(run_events(req))),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _run_sql(req: RunRequest, overrides: dict[str, Any]):
    return overrides.get("run_sql") or (
        lambda sql, action, inputs: sqlstep.run(sql, action, inputs, db=req.db, options=req.agent.ask_data,
                                                tenant=req.ask_data_settings))


def _graph(req: RunRequest, cfg: Any, first: int, checkpointer: Any, overrides: dict[str, Any]):
    """The agent's graph with everything a run needs: memories, sub-agents, thread, prompts, Ask Data settings."""
    return build_graph(cfg, req.llm, req.session_id, db=req.db, memories=req.memories, subagents=req.subagents,
                       checkpointer=checkpointer, thread=req.thread, prompts=req.prompts,
                       ask_data_settings=req.ask_data_settings, first=first,
                       **{**overrides, "run_sql": _run_sql(req, overrides)})


def _without_setup(cfg: Any) -> tuple[Any, int]:
    """The agent as its graph runs it: a setup step already ran as step 1 (app/prepare.py), so the graph starts at 2."""
    return (cfg.model_copy(update={"steps": cfg.steps[1:]}), 2) if cfg.steps and cfg.steps[0].kind == "setup" else (cfg, 1)


def run_events(req: RunRequest, *, extract_chat: Any = None, **graph_overrides: Any) -> Iterator[tuple[str, dict[str, Any]]]:
    """The run as (event, data) pairs; the last one is done, approval (paused) or error.

    A question (an input named "question") and a setup step can supply inputs, so the required inputs are checked
    after them when the agent has either; otherwise before anything runs, as always."""
    cfg = req.agent
    prepares = asks_question(cfg) or cfg.steps[0].kind == "setup"
    if not prepares and (missing := missing_inputs(cfg, req.inputs)):
        yield "error", {"message": "Fill in: " + ", ".join(missing)}
        return
    # With a model the supervisor, router, loop check and final answer speak through the tenant's prompts.
    absent = missing_prompts(req.prompts, RUN_KEYS) if req.llm is not None else []
    if absent:
        yield "error", {"message": "The agent cannot run: these AI prompts are not configured for this tenant: "
                                   f"{', '.join(absent)}. An admin can restore them under AI Settings > AI Prompts."}
        return
    ready = Prepared(cfg=cfg, inputs=dict(req.inputs))
    yield from prepare(cfg, dict(req.inputs), req.llm, req.prompts, ready, chat=extract_chat,
                       run_sql=_run_sql(req, graph_overrides))
    if ready.error:
        yield "error", {"message": ready.error}
        return
    if prepares and (missing := missing_inputs(cfg, ready.inputs)):
        hint = ", or give it in the question" if asks_question(cfg) else ""
        yield "error", {"message": "Fill in: " + ", ".join(missing) + hint}
        return
    try:
        paused = uses(cfg, builtins.APPROVAL)
        graph = _graph(req, ready.cfg, ready.first, InMemorySaver() if paused else None, graph_overrides)
    except Exception as exc:  # noqa: BLE001 - reported to the caller, who records the failed run (details in the log)
        log.exception("Agent run failed")
        yield "error", {"message": user_message(exc, "The agent")}
        return
    yield from _drive(graph, {"inputs": ready.inputs, "results": [], "usage": ready.usage}, req.session_id,
                      time.monotonic(), cfg.name, ready.steps, ready.inputs)


def resume_events(req: ResumeRequest, **graph_overrides: Any) -> Iterator[tuple[str, dict[str, Any]]]:
    """Continues a paused run from the state it paused in: the person's decision is applied as the approval step's
    update, then the graph runs on from that step. Step numbers are the editor's (a setup step stays step 1)."""
    try:
        i = int(req.node.split("_")[1])
        step = req.agent.steps[i - 1]
        cfg, first = _without_setup(req.agent)
        graph = _graph(req, cfg, first, InMemorySaver(), graph_overrides)
        events, update = approval_update(i, step, req.state, {"decision": req.decision, "text": req.text, "by": req.by})
        values = {**req.state, **update, "results": [*(req.state.get("results") or []), *update["results"]],
                  "outputs": {**(req.state.get("outputs") or {}), **update.get("outputs", {})}}
        graph.update_state({"configurable": {"thread_id": req.session_id}}, values, as_node=req.node)
    except Exception as exc:  # noqa: BLE001 - reported to the caller, who records the failed run (details in the log)
        log.exception("Agent run could not be resumed")
        yield "error", {"message": user_message(exc, "The run could not be resumed")}
        return
    for ev in events:
        yield ev["event"], ev["data"]
    yield from _drive(graph, None, req.session_id, time.monotonic(), req.agent.name, [], None)


def _drive(graph: Any, payload: Any, token: str, started: float, name: str, before: list[dict[str, Any]],
           inputs: dict[str, str] | None) -> Iterator[tuple[str, dict[str, Any]]]:
    """Streams the graph; `before` are steps that ran ahead of it (the setup step), `inputs` the inputs it ran with."""
    config = {"configurable": {"thread_id": token}}
    final: dict[str, Any] = {}
    try:
        for mode, chunk in graph.stream(payload, config, stream_mode=["custom", "values"]):
            if mode == "custom":
                trace.event(f"Agent {name}", chunk["event"], chunk["data"])
                yield chunk["event"], chunk["data"]
            else:
                final = chunk
        waiting = [i for t in graph.get_state(config).tasks for i in t.interrupts] if graph.checkpointer else []
    except Exception as exc:  # noqa: BLE001 - reported to the caller, who records the failed run (details in the log)
        log.exception("Agent run failed")
        yield "error", {"message": user_message(exc, "The agent")}
        return
    if waiting:
        # The Tenant API keeps the state and the paused node, and sends them back with the decision.
        snapshot = graph.get_state(config)
        task = next(t for t in snapshot.tasks if t.interrupts)
        yield "approval", {**waiting[0].value, "token": token, "steps": before + final.get("results", []),
                           "state": dict(snapshot.values), "node": task.name}
        return
    yield "done", {
        "answer": final.get("answer", ""), "ok": bool(final.get("ok")), "steps": before + final.get("results", []),
        "usage": final.get("usage", []), "seconds": round(time.monotonic() - started, 1),
        "memories": final.get("new_memories", []),
        **({"inputs": inputs} if inputs is not None else {}),
        **({"output": final["output"]} if final.get("output") is not None else {}),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8006")))

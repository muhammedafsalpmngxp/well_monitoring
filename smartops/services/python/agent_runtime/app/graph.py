"""Builds a LangGraph graph from one saved agent, wired by its type (the AgenticUIFramework's `process`):

  sequential  START -> step_1 -> step_2 -> ... -> answer
  parallel    START -> every step at once -> answer
  supervisor  START -> supervisor -> (a step -> supervisor)* -> answer; the model picks the next step and
              its task, or FINISH, at most max_iterations times
  loop        START -> step_1 -> ... -> step_n -> check -> (step_1 again | answer); the model judges whether
              the goal is met, at most max_iterations rounds

In sequential and loop agents a router step picks one of its branches (rules in order, or the model) and goes to
that branch's step; a step's `next` overrides "the following step", so branches can join again. Steps no branch
reaches do not run.

Built in memory on every run (no code generation). Each step node runs its tool (built-in Ask Data or a
twise agent) with the earlier answers as history. The answer node returns a single result as-is, or has
the tenant's AI provider write one answer from all of them. Progress goes out through LangGraph's custom
stream ("step", "status", "node", "decision" events).
"""
from __future__ import annotations

import operator
import re
import time
from typing import Annotated, Any, Callable, Iterator, TypedDict

import httpx
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app import twise
from app.models import AgentConfig, Branch, Db, Llm, Step

ASK_DATA = "ask_data"   # the built-in tool: DB Assistant's graph, run in this process (app/askdata)
RunTool = Callable[[str, str, str, list[dict[str, str]], str], Iterator[dict[str, Any]]]
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class AgentState(TypedDict, total=False):
    inputs: dict[str, str]
    results: Annotated[list[dict[str, Any]], operator.add]
    usage: Annotated[list[dict[str, Any]], operator.add]
    answer: str
    ok: bool
    # supervisor / loop
    iterations: int
    next: str          # supervisor: the step to run next, or "answer"
    task: str          # supervisor: the task it gave that step
    route: str         # router: the node its chosen branch goes to


def fill(template: str, inputs: dict[str, str]) -> str:
    """Replaces {{name}} with the input's value; unknown names are left as written."""
    return _PLACEHOLDER.sub(lambda m: inputs.get(m.group(1), m.group(0)), template)


def missing_inputs(cfg: AgentConfig, inputs: dict[str, str]) -> list[str]:
    return [i.name for i in cfg.inputs if i.required and not (inputs.get(i.name) or "").strip()]


def build_graph(cfg: AgentConfig, llm: Llm | None, session_id: str, run_tool: RunTool | None = None,
                chat: Callable[[Llm, list[tuple[str, str]]], tuple[str, dict[str, int]]] | None = None,
                db: Db | None = None):
    run_tool, chat = run_tool or _tools(cfg, llm, db), chat or _chat
    g = StateGraph(AgentState)
    names = [f"step_{i}" for i in range(1, len(cfg.steps) + 1)]
    end = "check" if cfg.type == "loop" else "answer"
    node_of = {s.id: n for n, s in zip(names, cfg.steps) if s.id}

    def to(target: str | None) -> str:
        return end if not target or target == "answer" else node_of[target]

    for i, (name, step) in enumerate(zip(names, cfg.steps), start=1):
        g.add_node(name, _router_node(i, step, cfg, llm, chat, to) if step.kind == "router"
                   else _step_node(i, step, cfg, session_id, run_tool))
    g.add_node("answer", _answer_node(cfg, llm, chat))
    g.add_edge("answer", END)

    if cfg.type == "parallel":
        for name in names:
            g.add_edge(START, name)
            g.add_edge(name, "answer")
    elif cfg.type == "supervisor":
        g.add_node("supervisor", _supervisor_node(cfg, llm, chat, names))
        g.add_edge(START, "supervisor")
        g.add_conditional_edges("supervisor", lambda st: st.get("next") or "answer", [*names, "answer"])
        for name in names:
            g.add_edge(name, "supervisor")
    else:   # sequential, loop
        nxt: dict[str, list[str]] = {}
        for i, (name, step) in enumerate(zip(names, cfg.steps)):
            if step.kind == "router":
                nxt[name] = sorted({to(b.target) for b in step.branches or []} | {end})
                g.add_conditional_edges(name, lambda st: st.get("route") or end, nxt[name])
            else:
                nxt[name] = [to(step.next) if step.next else names[i + 1] if i + 1 < len(names) else end]
                g.add_edge(name, nxt[name][0])
        _check_no_cycle(names[0], nxt, {n: s.text for n, s in zip(names, cfg.steps)})
        g.add_edge(START, names[0])
        if cfg.type == "loop":
            g.add_node("check", _loop_check_node(cfg, llm, chat))
            g.add_conditional_edges("check", lambda st: "answer" if st.get("next") == "answer" else names[0],
                                    [names[0], "answer"])
    # Supervisor and loop revisit nodes: give the graph room for max_iterations rounds.
    return g.compile().with_config(recursion_limit=max(25, (len(names) + 2) * (cfg.max_iterations + 1) + 5))


def _check_no_cycle(first: str, nxt: dict[str, list[str]], text: dict[str, str]) -> None:
    """Within one run (or one loop round) a step is reached at most once."""
    state: dict[str, int] = {}   # 1 = on the current path, 2 = done

    def visit(n: str) -> None:
        if n not in nxt or state.get(n) == 2:
            return
        if state.get(n) == 1:
            raise ValueError(f"The steps go round in a circle at '{text[n][:40]}'. Point a link forward or to the answer.")
        state[n] = 1
        for m in nxt[n]:
            visit(m)
        state[n] = 2

    visit(first)


def matches(branch: Branch, inputs: dict[str, str], last_answer: str) -> bool:
    """One router rule. Text compares ignore case; when both sides are numbers they compare as numbers."""
    if branch.op == "else":
        return True
    left = (last_answer if branch.input == "last_answer" else inputs.get(branch.input or "", "")).strip()
    right = (branch.value or "").strip()
    if branch.op in ("empty", "not_empty"):
        return (left == "") == (branch.op == "empty")
    if branch.op in ("contains", "not_contains"):
        return (right.lower() in left.lower()) == (branch.op == "contains")
    try:
        a, b = float(left), float(right)
    except ValueError:
        a, b = left.lower(), right.lower()
    return {"equals": a == b, "not_equals": a != b, "gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[branch.op]


def _router_node(i: int, step: Step, cfg: AgentConfig, llm: Llm | None, chat, to: Callable[[str | None], str]):
    branches = step.branches or []
    rules = [b for b in branches if b.op != "else"]
    fallback = next((b for b in branches if b.op == "else"), None)
    choices = "\n".join(f"{n}. {b.label or b.value}" for n, b in enumerate(rules, 1))
    system = "\n".join(p for p in [
        profile(cfg),
        f"You route the request. {step.text}".strip(),
        "Pick the ONE branch that fits best:", choices,
        "Reply with JSON only: {\"branch\": <number>, \"reason\": \"<one sentence>\"}"
        + (" or {\"branch\": 0} when none fits." if fallback else ""),
    ] if p)

    def node(state: AgentState) -> dict[str, Any]:
        inputs, usage, reason = state.get("inputs") or {}, [], ""
        last = next((r["answer"] for r in reversed(state.get("results") or []) if r["ok"]), "")
        if step.route_by == "ai" and llm is not None and rules:
            decision, usage = _decide(chat, llm, system, _progress(state))
            n, reason = decision.get("branch"), str(decision.get("reason", ""))
            chosen = rules[n - 1] if isinstance(n, int) and 1 <= n <= len(rules) else fallback
        elif step.route_by == "ai":
            # AI branches carry no real rules (their default is "equals ''"), so don't match them silently.
            chosen, reason = fallback, "No AI provider is active, so the Otherwise branch was taken."
        else:
            chosen = next((b for b in rules if matches(b, inputs, last)), fallback)
        route = to(chosen.target if chosen else None)
        get_stream_writer()({"event": "decision", "data": {
            "by": "router", "step": i, "router": step.text, "branch": (chosen.label or chosen.value) if chosen else "none",
            "next": route, "reason": reason}})
        return {"route": route, "usage": usage}

    return node


def profile(cfg: AgentConfig) -> str:
    """The agent's role, goal and system prompt, for the prompts that speak as the agent."""
    return "\n".join(p for p in [f"Role: {cfg.role}" if cfg.role else "", f"Goal: {cfg.goal}" if cfg.goal else "",
                                 cfg.system_prompt or ""] if p)


def _tools(cfg: AgentConfig, llm: Llm | None, db: Db | None) -> RunTool:
    """Ask Data runs in this process; every other tool is a twise agent over HTTP."""
    def run(agent: str, action: str, text: str, history: list[dict[str, str]], session_id: str):
        if agent != ASK_DATA:
            return twise.run_tool(agent, action, text, history, session_id)
        from app.askdata.runner import ask   # imported on use: needs pyodbc / sqlglot
        return ask(text, history, mode=action, options=cfg.ask_data, db=db, llm=llm)
    return run


def _step_node(i: int, step: Step, cfg: AgentConfig, session_id: str, run_tool: RunTool):
    tool = step.tool or cfg.tools[0]

    def node(state: AgentState) -> dict[str, Any]:
        write = get_stream_writer()
        # Every agent type runs the instruction as written (with its {{inputs}}): a supervisor only picks the order.
        # Letting it reword the task changed the question ("a rig on date" became "a rig on the specified date").
        text = fill(step.text, state.get("inputs") or {})
        attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
        write({"event": "step", "data": {"step": i, "attempt": attempt, "phase": "start", "question": text,
                                         "agent": tool.agent, "action": tool.action}})
        history = [{"user": r["question"], "assistant": r["answer"]} for r in state.get("results") or [] if r["ok"]]
        started, answer, sql, usage, error, extra = time.monotonic(), "", [], [], None, {}
        try:
            for ev in run_tool(tool.agent, tool.action, text, history, session_id):
                name, data = ev["event"], ev.get("data") or {}
                if name == "status" and data.get("stage"):
                    write({"event": "status", "data": {"step": i, "stage": data["stage"], "seconds": data.get("seconds")}})
                elif name == "node" and data.get("phase") == "start":
                    write({"event": "node", "data": {"step": i, "node": data.get("node") or data.get("id")}})
                elif name == "done":
                    answer = str(data.get("answer") or data.get("output") or data.get("summary") or data.get("explanation") or "")
                    sql = [s["sql"] for s in data.get("steps") or [] if isinstance(s, dict) and s.get("sql")]
                    usage = [u for u in data.get("usage") or [] if isinstance(u, dict)]
                    error = data.get("error")
                    # Ask Data also returns its verdict, result table and chart for the Test panel.
                    extra = {k: data[k] for k in ("verified", "route", "needs_analysis", "data", "chart", "export_token") if k in data}
                elif name == "error":
                    error = data.get("message") or "The tool failed."
        except httpx.HTTPError as exc:
            error = f"Could not reach {tool.agent}: {exc}"
        except Exception as exc:  # noqa: BLE001 - Ask Data runs in-process (database / AI provider errors)
            error = f"{tool.agent} failed: {exc}"[:1000]
        if not error and not answer:
            error = "The tool returned no answer."
        result = {
            "step": i, "attempt": attempt, "question": text, "agent": tool.agent, "action": tool.action, "answer": answer,
            "sql": sql, "ok": error is None, "error": error, "seconds": round(time.monotonic() - started, 1), **extra,
        }
        write({"event": "step", "data": {**result, "phase": "end"}})
        return {"results": [result], "usage": usage}

    return node


def _answer_node(cfg: AgentConfig, llm: Llm | None, chat):
    def node(state: AgentState) -> dict[str, Any]:
        results = state.get("results") or []
        done = [r for r in results if r["ok"]]
        if not results:
            return {"answer": "No step ran: the supervisor finished before choosing a step.", "ok": False}
        if not done:
            return {"answer": "No step produced an answer. " + "; ".join(r["error"] or "" for r in results), "ok": False}
        if len(results) == 1:
            return {"answer": done[0]["answer"], "ok": True}
        if llm is None:
            return {"answer": "\n\n".join(f"**{r['question']}**\n\n{r['answer']}" for r in done), "ok": True}
        get_stream_writer()({"event": "status", "data": {"stage": "Writing the answer"}})
        answer, tokens = chat(llm, _answer_messages(cfg, results))
        return {"answer": answer, "ok": True,
                "usage": [{"agent": "agent_runtime.answer", "model": llm.model, "calls": 1, **tokens}]}

    return node


def _decide(chat, llm: Llm, system: str, user: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One structured decision (JSON) from the tenant's AI provider, and its usage row."""
    from app.askdata.common.text import extract_json

    text, tokens = chat(llm, [("system", system), ("user", user)])
    return extract_json(text, default={}), [{"agent": "agent_runtime.answer", "model": llm.model, "calls": 1, **tokens}]


def _progress(state: AgentState) -> str:
    inputs = "\n".join(f"{k}: {v}" for k, v in (state.get("inputs") or {}).items())
    done = "\n\n".join(f"[step_{r['step']}] {r['question']}\n" + (r["answer"] if r["ok"] else f"FAILED: {r['error']}")
                        for r in state.get("results") or [])
    return (f"INPUTS:\n{inputs}\n\n" if inputs else "") + "RESULTS SO FAR:\n" + (done or "(none yet)")


def _supervisor_node(cfg: AgentConfig, llm: Llm | None, chat, names: list[str]):
    workers = "\n".join(f"- {n}: {s.text} (tool: {(s.tool or cfg.tools[0]).agent})" for n, s in zip(names, cfg.steps))
    system = "\n".join(p for p in [
        profile(cfg),
        "You are the supervisor. You coordinate these workers; each one answers its own instruction with its tool:",
        workers,
        "Pick the worker to run next, or FINISH when the results already answer the goal. "
        "Do not pick a worker that already succeeded.",
        'Reply with JSON only: {"next": "<worker name> or FINISH", "reason": "<one sentence>"}',
    ] if p)

    def node(state: AgentState) -> dict[str, Any]:
        n = state.get("iterations", 0)
        succeeded = {f"step_{r['step']}" for r in state.get("results") or [] if r["ok"]}
        if n >= cfg.max_iterations:
            return {"next": "answer"}
        if llm is None:
            # No AI provider to decide with: run every worker once, in order, instead of ending with nothing.
            ran = {f"step_{r['step']}" for r in state.get("results") or []}
            nxt = next((w for w in names if w not in ran), "answer")
            reason, usage = "No AI provider is active, so the steps run in order.", []
        else:
            decision, usage = _decide(chat, llm, system, _progress(state))
            nxt, reason = str(decision.get("next", "")).strip(), str(decision.get("reason", "")).strip()
            if nxt not in names or nxt in succeeded:
                nxt = "answer"
        get_stream_writer()({"event": "decision", "data": {"by": "supervisor", "next": nxt, "reason": reason, "round": n + 1}})
        return {"next": nxt, "iterations": n + 1, "usage": usage}

    return node


def _loop_check_node(cfg: AgentConfig, llm: Llm | None, chat):
    system = "\n".join(p for p in [
        profile(cfg),
        "You check an agent that repeats its steps. Decide whether the results now meet the goal.",
        'Reply with JSON only: {"done": true|false, "reason": "<one sentence>"}',
    ] if p)

    def node(state: AgentState) -> dict[str, Any]:
        n = state.get("iterations", 0) + 1
        if llm is None or n >= cfg.max_iterations:
            return {"next": "answer", "iterations": n}
        decision, usage = _decide(chat, llm, system, _progress(state))
        done = decision.get("done") is True
        get_stream_writer()({"event": "decision", "data": {"by": "loop", "done": done, "reason": decision.get("reason", ""), "round": n}})
        return {"next": "answer" if done else "again", "iterations": n, "usage": usage}

    return node


def _answer_messages(cfg: AgentConfig, results: list[dict[str, Any]]) -> list[tuple[str, str]]:
    system = "\n".join(p for p in [
        f"You are {cfg.role}." if cfg.role else "",
        cfg.system_prompt,
        f"Goal: {cfg.goal}" if cfg.goal else "",
        "Write one clear answer from the step results below. Include the key fact or number of EVERY step "
        "result; use only their facts and numbers; say plainly when a step failed. Do not mention steps, tools or agents.",
    ] if p)
    body = "\n\n".join(
        f"Step {r['step']}: {r['question']}\n" + (f"Result: {r['answer']}" if r["ok"] else f"Failed: {r['error']}")
        for r in results)
    return [("system", system), ("user", body)]


def _chat(llm: Llm, messages: list[tuple[str, str]]) -> tuple[str, dict[str, int]]:
    from app.askdata.llm import invoke

    _, reply = invoke(llm, messages, temperature=0.2)
    meta = getattr(reply, "usage_metadata", None) or {}
    return str(reply.content), {"input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))}

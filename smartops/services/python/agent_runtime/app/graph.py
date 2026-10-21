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

Built in memory on every run (no code generation). Each step node runs its tool (built-in Ask Data, built-in
Saved SQL or a twise agent) with the earlier answers as history. The answer node returns a single result as-is
(a Saved SQL step with the "summary" action excepted), or has the tenant's AI provider write one answer from all
of them. Progress goes out through LangGraph's custom stream ("step", "status", "node", "decision" events).
"""
from __future__ import annotations

import contextvars
import json
import operator
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Annotated, Any, Callable, Iterator, Mapping, TypedDict

import httpx
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app import sqlstep, twise
from app.models import AgentConfig, AskDataTenantSettings, Branch, Db, Llm, Step
from app.prompt_text import fill as fill_prompt, fill_lines, text as prompt

ASK_DATA = "ask_data"   # the built-in tool: DB Assistant's graph, run in this process (app/askdata)
SQL_QUERY = sqlstep.SQL_QUERY   # the built-in tool that runs a step's own SELECT (app/sqlstep.py)
# The agent-level prompt texts (core.AiPrompt, sent with each run). RUN_KEYS are needed by every run that has a model;
# EXTRACT_KEYS only when a question is read (app/prepare.py checks them then), so a runtime deployed before the Tenant
# API has seeded them still runs every other agent. AGENT_KEYS is all of them.
RUN_KEYS = tuple(f"agent.{n}" for n in (
    "profile_role", "profile_goal", "supervisor", "worker", "loop_check", "router", "router_none_fits", "choice",
    "progress_inputs", "progress_input", "progress_results", "progress_none", "progress_step", "progress_failed",
    "answer", "answer_role", "answer_goal", "answer_step", "answer_result", "answer_failed"))
EXTRACT_KEYS = ("agent.extract_inputs", "agent.extract_input")
# Read only by the steps that need them (Ask AI, REST tools, URL Context, memory, Evaluator, Guardrail, For Each,
# structured output, evals): a missing one stops that step with a message naming it (prompt_text.PromptMissing).
STEP_KEYS = tuple(f"agent.{n}" for n in (
    "expected_output", "ask_ai", "tool_use", "step_earlier", "earlier_result", "step_instruction", "url_context",
    "url_page", "url_page_failed", "memory_use", "memories", "memory_none", "remember", "remember_message", "remember_run",
    "evaluator", "evaluator_message", "guardrail", "guardrail_message", "for_each_items", "output_fields", "output_field",
    "eval_judge", "eval_judge_message"))
AGENT_KEYS = RUN_KEYS + EXTRACT_KEYS + STEP_KEYS
Texts = Mapping[str, str]
from app import api_tool, builtins, nodes

ASK_AI = "ask_ai"       # the built-in LLM step: the tenant's model answers from the earlier results (agentflow Agent)
SUBAGENT = "subagent"   # tool subagent / <agent id>: a published agent runs as one step
MAX_DEPTH = 2           # sub-agents of sub-agents, no deeper
MAX_ITEMS, MAX_PARALLEL = 20, 5   # For Each
RunTool = Callable[[str, str, str, list[dict[str, str]], str], Iterator[dict[str, Any]]]
RunSql = Callable[[str, str, dict[str, str]], Iterator[dict[str, Any]]]   # (sql, action, inputs) -> events
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class AgentState(TypedDict, total=False):
    inputs: dict[str, str]
    results: Annotated[list[dict[str, Any]], operator.add]
    outputs: Annotated[dict[str, str], operator.or_]   # output_key -> that step's answer, for {{key}}
    usage: Annotated[list[dict[str, Any]], operator.add]
    answer: str
    ok: bool
    # supervisor / loop
    iterations: int
    next: str          # supervisor: the step to run next, or "answer"
    task: str          # supervisor: the task it gave that step
    route: str         # router: the node its chosen branch goes to
    exit: bool         # exit_loop: the goal is met, go to the answer
    output: dict[str, Any]    # structured answer: the agent's Outputs as typed fields
    rejected: str      # approval: a person rejected the draft (their comment); the run ends
    new_memories: list[str]   # facts to keep for the agent's later runs


def fill(template: str, inputs: dict[str, str]) -> str:
    """Replaces {{name}} with the input's value; unknown names are left as written."""
    return _PLACEHOLDER.sub(lambda m: inputs.get(m.group(1), m.group(0)), template)


def missing_inputs(cfg: AgentConfig, inputs: dict[str, str]) -> list[str]:
    return [i.name for i in cfg.inputs if i.required and not (inputs.get(i.name) or "").strip()]


def step_tool(cfg: AgentConfig, step: Step):
    return step.tool or cfg.tools[0]


def uses(cfg: AgentConfig, *agents: str) -> bool:
    return any(s.kind == "step" and step_tool(cfg, s).agent in agents for s in cfg.steps)


def build_graph(cfg: AgentConfig, llm: Llm | None, session_id: str, run_tool: RunTool | None = None,
                chat: Callable[[Llm, list[tuple[str, str]]], tuple[str, dict[str, int]]] | None = None,
                db: Db | None = None, memories: list[str] | None = None, subagents: dict[str, AgentConfig] | None = None,
                depth: int = 0, checkpointer=None, thread: list[dict[str, str]] | None = None, prompts: Texts | None = None,
                ask_data_settings: AskDataTenantSettings | None = None, run_sql: RunSql | None = None, first: int = 1):
    """`first` is the number of the first step: 2 when a setup step already ran as step 1 (app/prepare.py), so the
    steps keep the numbers the editor shows. Saved SQL reads under the same tenant settings as Ask Data."""
    texts = prompts or {}
    check_sql_steps(cfg, first)
    run_tool, chat = run_tool or _tools(cfg, llm, db, texts, ask_data_settings), chat or _chat
    run_sql = run_sql or (lambda sql, action, inputs: sqlstep.run(sql, action, inputs, db=db, options=cfg.ask_data,
                                                                  tenant=ask_data_settings))
    sub_settings = {"prompts": texts, "ask_data_settings": ask_data_settings}
    if uses(cfg, builtins.APPROVAL) and cfg.type == "parallel":
        raise ValueError("Human Approval works in Sequential, Loop and Supervisor agents (not Parallel).")
    if uses(cfg, nodes.EVALUATOR) and cfg.type not in ("sequential", "loop"):
        raise ValueError("Evaluator works in Sequential and Loop agents (it may send the run back).")
    if uses(cfg, builtins.EXIT_LOOP) and cfg.type != "loop":
        raise ValueError("Exit Loop works in Loop agents only.")
    g = StateGraph(AgentState)
    names = [f"step_{i}" for i in range(first, first + len(cfg.steps))]
    end = "check" if cfg.type == "loop" else "answer"
    node_of = {s.id: n for n, s in zip(names, cfg.steps) if s.id}

    def to(target: str | None) -> str:
        return end if not target or target == "answer" else node_of[target]

    for i, (name, step) in enumerate(zip(names, cfg.steps), start=first):
        g.add_node(name, _router_node(i, step, cfg, llm, chat, to, names, texts=texts) if step.kind == "router"
                   else _exit_node(i, step, cfg, llm, chat, texts) if step_tool(cfg, step).agent == builtins.EXIT_LOOP
                   else _approval_node(i, step) if step_tool(cfg, step).agent == builtins.APPROVAL
                   else _evaluator_node(i, step, cfg, llm, chat, to, names, texts) if step_tool(cfg, step).agent == nodes.EVALUATOR
                   else _guardrail_node(i, step, cfg, llm, chat, texts) if step_tool(cfg, step).agent == nodes.GUARDRAIL
                   else _step_node(i, step, cfg, session_id, run_tool, llm, chat, memories or [], subagents, depth, db,
                                   thread or [], run_sql=run_sql, texts=texts, sub_settings=sub_settings))
    g.add_node("answer", _answer_node(cfg, llm, chat, texts=texts))
    if llm is not None and uses(cfg, *builtins.MEMORY):
        g.add_node("remember", _remember_node(llm, chat, memories or [], texts))
        g.add_edge("answer", "remember")
        g.add_edge("remember", END)
    else:
        g.add_edge("answer", END)

    if cfg.type == "parallel":
        for name in names:
            g.add_edge(START, name)
            g.add_edge(name, "answer")
    elif cfg.type == "supervisor":
        g.add_node("supervisor", _supervisor_node(cfg, llm, chat, names, texts=texts))
        g.add_edge(START, "supervisor")
        g.add_conditional_edges("supervisor", lambda st: st.get("next") or "answer", [*names, "answer"])
        for name in names:
            g.add_edge(name, "supervisor")
    else:   # sequential, loop
        nxt: dict[str, list[str]] = {}
        for i, (name, step) in enumerate(zip(names, cfg.steps)):
            if step.kind == "router":
                g.add_conditional_edges(name, lambda st: st.get("route") or end, sorted({to(b.target) for b in step.branches or []} | {end}))
                # A router may send the run back to an earlier step (capped at run time), so it is left out of the check.
                nxt[name] = []
            else:
                nxt[name] = [to(step.next) if step.next else names[i + 1] if i + 1 < len(names) else end]
                if step_tool(cfg, step).agent == nodes.EVALUATOR:
                    g.add_conditional_edges(name, lambda st: st.get("route") or end, sorted(set(names) | {end}))
                    nxt[name] = []   # it may go back (capped at run time), like a router
                elif step_tool(cfg, step).agent in (builtins.EXIT_LOOP, builtins.APPROVAL, nodes.GUARDRAIL):
                    following = nxt[name][0]
                    nxt[name] = sorted({following, "answer"})
                    g.add_conditional_edges(name, lambda st, f=following: "answer" if st.get("exit") else f, nxt[name])
                else:
                    g.add_edge(name, nxt[name][0])
        _check_no_cycle(names[0], nxt, {n: s.text for n, s in zip(names, cfg.steps)})
        g.add_edge(START, names[0])
        if cfg.type == "loop":
            g.add_node("check", _loop_check_node(cfg, llm, chat, texts=texts))
            g.add_conditional_edges("check", lambda st: "answer" if st.get("next") == "answer" else names[0],
                                    [names[0], "answer"])
    # Supervisor and loop revisit nodes: give the graph room for max_iterations rounds.
    return g.compile(checkpointer=checkpointer).with_config(recursion_limit=max(25, (len(names) + 2) * (cfg.max_iterations + 1) + 5))


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


def check_sql_steps(cfg: AgentConfig, first: int = 1) -> None:
    """Every Saved SQL step has one read-only SELECT using only the agent's inputs; raises ValueError naming the step
    by the number the editor shows (`first` is 2 when the setup step was taken off the front)."""
    names = {i.name for i in cfg.inputs}
    for i, step in enumerate(cfg.steps, start=first):
        tool = step.tool or cfg.tools[0]
        if step.kind == "router" or tool.agent != SQL_QUERY:
            continue
        found = sqlstep.problems(step.sql, tool.action, names)
        if found:
            raise ValueError(f"Step {i} ('{step.text[:40]}') uses Saved SQL: " + "; ".join(found) + ".")


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


def _number(node: str) -> int:
    """The step number of a node (step_<n>)."""
    return int(node.split("_")[1]) if node.startswith("step_") else -1


def _after(names: list[str], i: int) -> str | None:
    """The node after step i, or None for the last step (steps may start at 2: see build_graph's `first`)."""
    pos = names.index(f"step_{i}")
    return names[pos + 1] if pos + 1 < len(names) else None


def _before(names: list[str], i: int) -> str | None:
    pos = names.index(f"step_{i}")
    return names[pos - 1] if pos >= 1 else None


def _runs(state: AgentState, node: str) -> int:
    """How often a step (step_<n>) has run so far."""
    n = _number(node)
    return sum(1 for r in state.get("results") or [] if r["step"] == n)


def _router_node(i: int, step: Step, cfg: AgentConfig, llm: Llm | None, chat, to: Callable[[str | None], str],
                 names: list[str] | None = None, texts: Texts | None = None):
    branches = step.branches or []
    rules = [b for b in branches if b.op != "else"]
    fallback = next((b for b in branches if b.op == "else"), None)

    def system() -> str:   # built on use: rule routers need no prompt text
        choices = "\n".join(fill_prompt(prompt(texts, "agent.choice"), N=n, LABEL=b.label or b.value)
                            for n, b in enumerate(rules, 1))
        none_fits = " " + prompt(texts, "agent.router_none_fits") if fallback else ""
        body = fill_lines(prompt(texts, "agent.router"), INSTRUCTION=step.text.strip(), CHOICES=choices,
                          NONE_FITS=none_fits)
        return "\n".join(p for p in [profile(cfg, texts), "\n".join(line.rstrip() for line in body.split("\n"))] if p)

    def node(state: AgentState) -> dict[str, Any]:
        inputs, usage, reason = state.get("inputs") or {}, [], ""
        last = next((r["answer"] for r in reversed(state.get("results") or []) if r["ok"]), "")
        if step.route_by == "ai" and llm is not None and rules:
            decision, usage = _decide(chat, llm, system(), _progress(state, texts))
            n, reason = decision.get("branch"), str(decision.get("reason", ""))
            chosen = rules[n - 1] if isinstance(n, int) and 1 <= n <= len(rules) else fallback
        elif step.route_by == "ai":
            # AI branches carry no real rules (their default is "equals ''"), so don't match them silently.
            chosen = fallback
            reason = ("No AI provider is active, so the Otherwise branch was taken." if rules
                      else "The router has only an Otherwise branch.")
        else:
            chosen = next((b for b in rules if matches(b, inputs, last)), fallback)
        route = to(chosen.target if chosen else None)
        # Going back to a step that already ran max_iterations times: stop going back and carry on with the step
        # after this one (or the end).
        if route.startswith("step_") and _number(route) <= i and _runs(state, route) >= cfg.max_iterations:
            back = route
            route = _after(names or [], i) or ("check" if cfg.type == "loop" else "answer")
            reason = f"{back} already ran {cfg.max_iterations} times (max iterations); going on"
        get_stream_writer()({"event": "decision", "data": {
            "by": "router", "step": i, "router": step.text, "branch": (chosen.label or chosen.value) if chosen else "none",
            "next": route, "reason": reason}})
        return {"route": route, "usage": usage}

    return node


def profile(cfg: AgentConfig, texts: Texts | None) -> str:
    """The agent's role, goal and system prompt, for the prompts that speak as the agent."""
    return "\n".join(p for p in [fill_prompt(prompt(texts, "agent.profile_role"), ROLE=cfg.role) if cfg.role else "",
                                 fill_prompt(prompt(texts, "agent.profile_goal"), GOAL=cfg.goal) if cfg.goal else "",
                                 cfg.system_prompt or ""] if p)


def _tools(cfg: AgentConfig, llm: Llm | None, db: Db | None, texts: Texts | None = None,
           ask_data_settings: AskDataTenantSettings | None = None) -> RunTool:
    """Ask Data runs in this process; every other tool is a twise agent over HTTP."""
    def run(agent: str, action: str, text: str, history: list[dict[str, str]], session_id: str):
        if agent != ASK_DATA:
            return twise.run_tool(agent, action, text, history, session_id)
        from app.askdata.runner import ask   # imported on use: needs pyodbc / sqlglot
        return ask(text, history, mode=action, options=cfg.ask_data, db=db, llm=llm, prompts=texts,
                   tenant=ask_data_settings)
    return run


def _tuned(llm: Llm | None, step: Step) -> Llm | None:
    """The provider with the step's model / temperature / max tokens (Ask AI and Tool steps)."""
    if llm is None:
        return None
    return llm.model_copy(update={k: v for k, v in (("model", step.model), ("temperature", step.temperature),
                                                    ("max_tokens", step.max_tokens)) if v is not None})


def _system_text(cfg: AgentConfig, step: Step, task: str, texts: Texts | None = None) -> str:
    return "\n".join(p for p in [profile(cfg, texts), task,
                                 fill_prompt(prompt(texts, "agent.expected_output"), EXPECTED=step.expected_output)
                                 if step.expected_output else ""] if p)


def _ask_ai(step: Step, cfg: AgentConfig, llm: Llm | None, chat, text: str, history: list[dict[str, str]],
            texts: Texts | None = None):
    """Ask AI: one call to the tenant's model (the step's model / temperature / max tokens when set)."""
    if llm is None:
        yield {"event": "error", "data": {"message": "No AI provider is active. An admin can add one under AI Settings."}}
        return
    tuned = _tuned(llm, step)
    system = _system_text(cfg, step, texts=texts, task=prompt(texts, "agent.ask_ai"))
    yield {"event": "status", "data": {"stage": "Thinking"}}
    answer, tokens = chat(tuned, [("system", system), ("user", builtins.step_message(texts, history, text))])
    yield {"event": "done", "data": {"answer": answer, "usage": [{"agent": "agent_runtime.ask_ai", "model": tuned.model,
                                                                   "calls": 1, **tokens}]}}


def _step_node(i: int, step: Step, cfg: AgentConfig, session_id: str, run_tool: RunTool, llm: Llm | None = None, chat=None,
               memories: list[str] | None = None, subagents: dict[str, AgentConfig] | None = None, depth: int = 0,
               db: Db | None = None, thread: list[dict[str, str]] | None = None, run_sql: RunSql | None = None,
               texts: Texts | None = None, sub_settings: dict[str, Any] | None = None):
    tool = step_tool(cfg, step)
    chat = chat or _chat

    def _system(c: AgentConfig, s: Step, task: str) -> str:
        return _system_text(c, s, task, texts)

    def events(text: str, history: list[dict[str, str]], values: dict[str, str]):
        if tool.agent == SQL_QUERY:
            # Saved SQL runs the step's own SELECT with the run's inputs as parameters; the instruction is its label.
            return run_sql(step.sql or "", tool.action, values)
        if tool.agent == ASK_AI:
            return _ask_ai(step, cfg, llm, chat, text, history, texts)
        if tool.agent == builtins.URL_CONTEXT:
            return builtins.url_context(text, history, _tuned(llm, step), chat, _system(cfg, step, ""), texts=texts)
        if tool.agent in builtins.MEMORY:
            return builtins.memory(tool.agent, memories or [], text, history, _tuned(llm, step), chat, _system(cfg, step, ""),
                                   texts)
        if tool.agent == nodes.COMPUTE:
            return nodes.compute(step, values)
        if tool.agent == nodes.MERGE:
            return nodes.merge(step, values, history, text)
        if tool.agent == SUBAGENT:
            return _subagent(tool.action, subagents or {}, text, values, llm, chat, db, depth, session_id, sub_settings or {})
        if tool.agent == api_tool.API:
            custom = next((t for t in cfg.custom_tools or [] if t.name == tool.action), None)
            if custom is None:
                return iter([{"event": "error", "data": {"message": f"Tool '{tool.action}' is not defined on this agent."}}])
            return api_tool.run_step(custom, text, history, _tuned(llm, step),
                                     _system(cfg, step, fill_prompt(prompt(texts, "agent.tool_use"), TOOL=custom.name)))
        return run_tool(tool.agent, tool.action, text, history, session_id)

    def run_one(text: str, history: list[dict[str, str]], values: dict[str, str], write) -> dict[str, Any]:
        """The step's tool, retried `retries` more times on failure (2, 4, 8 s apart)."""
        tries = 1 + (step.retries or 0)
        for n in range(1, tries + 1):
            r = call_once(text, history, values, write)
            if r["error"] is None or n == tries:
                return {**r, "extra": {**r["extra"], **({"tries": n} if n > 1 else {})}}
            if write:
                write({"event": "status", "data": {"step": i, "stage": f"Failed ({r['error'][:80]}); retry {n} of {tries - 1}"}})
            time.sleep(min(2 ** n, 8))
        return r

    def call_once(text: str, history: list[dict[str, str]], values: dict[str, str], write) -> dict[str, Any]:
        """One call of the step's tool; `write` (None on For Each workers) gets its progress."""
        answer, sql, usage, error, extra = "", [], [], None, {}
        try:
            for ev in events(text, history, values):
                name, data = ev["event"], ev.get("data") or {}
                if write and name == "status" and data.get("stage"):
                    write({"event": "status", "data": {"step": i, "stage": data["stage"], "seconds": data.get("seconds")}})
                elif write and name == "node" and data.get("phase") == "start":
                    write({"event": "node", "data": {"step": i, "node": data.get("node") or data.get("id")}})
                elif name == "done":
                    answer = str(data.get("answer") or data.get("output") or data.get("summary") or data.get("explanation") or "")
                    sql = [s["sql"] for s in data.get("steps") or [] if isinstance(s, dict) and s.get("sql")]
                    usage = [u for u in data.get("usage") or [] if isinstance(u, dict)]
                    error = data.get("error")
                    # Ask Data also returns its verdict, result table and chart for the Test panel; Saved SQL its
                    # rows, and whether the answer node should summarise them.
                    extra = {k: data[k] for k in ("verified", "route", "needs_analysis", "data", "chart", "export_token",
                                                  "summarize", "tools_used", "substeps") if k in data}
                elif name == "error":
                    error = data.get("message") or "The tool failed."
        except httpx.HTTPError as exc:
            error = f"Could not reach {tool.agent}: {exc}"
        except Exception as exc:  # noqa: BLE001 - Ask Data runs in-process (database / AI provider errors)
            error = f"{tool.agent} failed: {exc}"[:1000]
        if not error and not answer:
            error = "The tool returned no answer."
        return {"answer": answer, "sql": sql, "usage": usage, "error": error, "extra": extra}

    def for_each(values: dict[str, str], history: list[dict[str, str]], write) -> dict[str, Any]:
        """Map: the step once per item, MAX_PARALLEL at a time; the answers are joined (the answer node reduces)."""
        items, usage = _items(values.get(step.for_each or ""), llm, chat, texts)
        if not items:
            return {"answer": "", "sql": [], "usage": usage, "extra": {},
                    "error": f"For each: {{{{{step.for_each}}}}} has no items (run the step that fills it first)."}
        write({"event": "status", "data": {"step": i, "stage": f"{len(items)} items"}})
        item_texts = [fill(step.text, {**values, "item": item}) for item in items]
        done = []
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            futures = {pool.submit(contextvars.copy_context().run, run_one, t, history, values, None): n for n, t in enumerate(item_texts)}
            for k, f in enumerate(as_completed(futures), start=1):
                done.append((futures[f], f.result()))
                write({"event": "status", "data": {"step": i, "stage": f"{k} of {len(items)} items done"}})
        done.sort(key=lambda x: x[0])
        ok = [(items[n], r) for n, r in done if not r["error"]]
        return {
            "answer": "\n\n".join(f"**{item}**: {r['answer']}" for item, r in ok),
            "sql": [s for _, r in done for s in r["sql"]], "usage": usage + [u for _, r in done for u in r["usage"]],
            "error": None if ok else "Every item failed: " + "; ".join(r["error"] for _, r in done)[:900],
            "extra": {"items": [{"item": items[n], "ok": not r["error"], "answer": r["answer"], "error": r["error"]} for n, r in done]},
        }

    def node(state: AgentState) -> dict[str, Any]:
        write = get_stream_writer()
        # Every agent type runs the instruction as written (with its {{inputs}}): a supervisor only picks the order.
        # Letting it reword the task changed the question ("a rig on date" became "a rig on the specified date").
        values = {**(state.get("inputs") or {}), **(state.get("outputs") or {})}
        text = fill(step.text, values)
        attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
        write({"event": "step", "data": {"step": i, "attempt": attempt, "phase": "start", "question": text,
                                         "agent": tool.agent, "action": tool.action}})
        # The conversation so far (earlier turns of the thread), then this run's answered steps.
        history = [*(thread or []), *({"user": r["question"], "assistant": r["answer"]} for r in _work(state))]
        started = time.monotonic()
        r = for_each(values, history, write) if step.for_each else run_one(text, history, values, write)
        result = {
            "step": i, "attempt": attempt, "question": text, "agent": tool.agent, "action": tool.action, "answer": r["answer"],
            "sql": r["sql"], "ok": r["error"] is None, "error": r["error"], "seconds": round(time.monotonic() - started, 1),
            **r["extra"],
            **({"output_key": step.output_key} if step.output_key else {}),
            **({"expected_output": step.expected_output} if step.expected_output else {}),
        }
        write({"event": "step", "data": {**result, "phase": "end"}})
        out: dict[str, Any] = {"results": [result], "usage": r["usage"]}
        if step.output_key and result["ok"]:
            out["outputs"] = {step.output_key: r["answer"]}
        return out

    return node


def _items(value: str | None, llm: Llm | None, chat, texts: Texts | None = None) -> tuple[list[str], list[dict[str, Any]]]:
    """For Each: the list in a value — a JSON array, else the model picks the items out of the text, else lines /
    commas. At most MAX_ITEMS."""
    if not value or not value.strip():
        return [], []
    try:
        data = json.loads(value)
        if isinstance(data, list):
            return [str(x) if not isinstance(x, (dict, list)) else json.dumps(x) for x in data][:MAX_ITEMS], []
    except ValueError:
        pass
    usage: list[dict[str, Any]] = []
    if llm is not None:
        from app.askdata.common.text import extract_json
        reply, tokens = chat(llm, [("system", prompt(texts, "agent.for_each_items")), ("user", value[:12000])])
        usage = [{"agent": "agent_runtime.for_each", "model": llm.model, "calls": 1, **tokens}]
        data = extract_json(reply, default={})
        items = data.get("items") if isinstance(data, dict) else None
        if isinstance(items, list) and items:
            return [str(x).strip() for x in items if str(x).strip()][:MAX_ITEMS], usage
    parts = [p for p in re.split(r"\n|,|;", value)]
    return [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", p).strip() for p in parts if p.strip()][:MAX_ITEMS], usage


def _subagent(agent_id: str, subagents: dict[str, AgentConfig], text: str, values: dict[str, str], llm: Llm | None,
              chat, db: Db | None, depth: int, session_id: str, settings: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Runs a published agent as one step. Its inputs take the parent's values with the same name; the first one left
    gets the instruction."""
    sub = subagents.get(agent_id)
    if sub is None:
        yield {"event": "error", "data": {"message": f"Sub-agent {agent_id} is not available: it must be a published agent."}}
        return
    if depth >= MAX_DEPTH:
        yield {"event": "error", "data": {"message": f"Sub-agents can be nested {MAX_DEPTH} levels deep."}}
        return
    inputs = {n.name: str(values[n.name]) for n in sub.inputs if values.get(n.name)}
    free = [n.name for n in sub.inputs if n.name not in inputs]
    if free:
        inputs[free[0]] = text
    missing = missing_inputs(sub, inputs)
    if missing:
        yield {"event": "error", "data": {"message": f"{sub.name} needs: " + ", ".join(missing)}}
        return
    yield {"event": "status", "data": {"stage": f"Running {sub.name}"}}
    graph = build_graph(sub, llm, f"{session_id}-sub{agent_id}", chat=chat, db=db, subagents=subagents, depth=depth + 1,
                        **settings)
    final: dict[str, Any] = {}
    for mode, chunk in graph.stream({"inputs": inputs, "results": [], "usage": []}, stream_mode=["custom", "values"]):
        if mode == "custom" and chunk["event"] == "step" and chunk["data"].get("phase") == "start":
            yield {"event": "status", "data": {"stage": f"{sub.name}: step {chunk['data']['step']}"}}
        elif mode == "values":
            final = chunk
    yield {"event": "done", "data": {
        "answer": final.get("answer", ""), "usage": final.get("usage", []), "error": None if final.get("ok") else final.get("answer"),
        "substeps": [{k: r.get(k) for k in ("step", "question", "agent", "action", "answer", "ok", "error")} for r in final.get("results", [])],
    }}


def _work(state: AgentState) -> list[dict[str, Any]]:
    """The answered steps, without Exit Loop's checks (an approval counts: its answer is the approved text)."""
    return [r for r in state.get("results") or [] if r["ok"] and r.get("agent") != builtins.EXIT_LOOP]


def _exit_node(i: int, step: Step, cfg: AgentConfig, llm: Llm | None, chat, texts: Texts | None = None):
    """Exit Loop: the model judges whether the goal is met; if so the run goes to the answer from here."""
    def node(state: AgentState) -> dict[str, Any]:
        write = get_stream_writer()
        attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
        text = step.text
        write({"event": "step", "data": {"step": i, "attempt": attempt, "phase": "start", "question": text,
                                         "agent": builtins.EXIT_LOOP, "action": "check"}})
        started, usage = time.monotonic(), []
        if llm is None:
            done, reason, ok = False, "No AI provider is active, so the loop goes on.", False
        else:
            done, reason, tokens = builtins.judge_goal(_tuned(llm, step), chat, "\n".join(p for p in [profile(cfg, texts), text] if p),
                                                       _progress(state, texts), texts)
            ok, usage = True, [{"agent": "agent_runtime.exit_loop", "model": llm.model, "calls": 1, **tokens}]
        write({"event": "decision", "data": {"by": "exit_loop", "done": done, "reason": reason, "step": i}})
        result = {"step": i, "attempt": attempt, "question": text, "agent": builtins.EXIT_LOOP, "action": "check",
                  "answer": ("Goal met — " if done else "Not yet — ") + reason, "sql": [], "ok": ok,
                  "error": None if ok else reason, "seconds": round(time.monotonic() - started, 1)}
        write({"event": "step", "data": {**result, "phase": "end"}})
        return {"results": [result], "usage": usage, "exit": done}

    return node


CONTROL = (builtins.EXIT_LOOP, nodes.EVALUATOR, nodes.GUARDRAIL)   # checks: shown, not part of the final answer


def _checked_text(step: Step, state: AgentState) -> str:
    """The answer a check looks at: the one named by {{key}} in the instruction, else the latest answer."""
    return _approval_draft(step, state)


def _evaluator_node(i: int, step: Step, cfg: AgentConfig, llm: Llm | None, chat, to, names: list[str], texts: Texts | None = None):
    """Evaluator: pass → the following step; fail → back to options.retryFrom (default the previous step), at most
    max_iterations times, then on with the failure recorded."""
    end = "check" if cfg.type == "loop" else "answer"
    forward = _after(names, i) or end
    back_id = (step.options or {}).get("retryFrom")
    back = to(back_id) if back_id else _before(names, i)

    def node(state: AgentState) -> dict[str, Any]:
        write = get_stream_writer()
        attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
        criteria = _PLACEHOLDER.sub("", step.text).strip() or step.text
        write({"event": "step", "data": {"step": i, "attempt": attempt, "phase": "start", "question": criteria, "agent": nodes.EVALUATOR, "action": "check"}})
        usage: list[dict[str, Any]] = []
        if llm is None:
            passed, reason = False, "No AI provider is active, so the answer could not be checked."
        else:
            passed, reason, tokens = nodes.judge(_tuned(llm, step), chat, criteria, _checked_text(step, state), texts)
            usage = [{"agent": "agent_runtime.evaluator", "model": llm.model, "calls": 1, **tokens}]
        route = forward
        if not passed and back:
            if _runs(state, back) >= cfg.max_iterations:
                reason += f" (gave up after {cfg.max_iterations} tries)"
            else:
                route = back
        write({"event": "decision", "data": {"by": "evaluator", "step": i, "done": passed, "reason": reason, "next": route}})
        result = {"step": i, "attempt": attempt, "question": criteria, "agent": nodes.EVALUATOR, "action": "check",
                  "answer": ("Passed: " if passed else "Failed: ") + reason, "sql": [], "ok": True, "error": None, "seconds": 0, "passed": passed}
        write({"event": "step", "data": {**result, "phase": "end"}})
        return {"results": [result], "route": route, "usage": usage}

    return node


def _guardrail_node(i: int, step: Step, cfg: AgentConfig, llm: Llm | None, chat, texts: Texts | None = None):
    """Guardrail: rules (and an AI policy when the instruction has one) on the inputs or the latest answer."""
    opts = step.options or {}

    def node(state: AgentState) -> dict[str, Any]:
        write = get_stream_writer()
        attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
        on_inputs = opts.get("check") == "inputs"
        text = "\n".join(f"{k}: {v}" for k, v in (state.get("inputs") or {}).items()) if on_inputs else _checked_text(step, state)
        rule = str(opts.get("policy") or "").strip()
        title = _PLACEHOLDER.sub("", step.text).strip() or "Guardrail"
        write({"event": "step", "data": {"step": i, "attempt": attempt, "phase": "start", "question": title,
                                         "agent": nodes.GUARDRAIL, "action": "check"}})
        contains, usage = [f.removeprefix("contains ") for f in nodes.violations(text, opts)], []
        broken = ""
        if rule and llm is not None:
            bad, why, tokens = nodes.policy(_tuned(llm, step), chat, rule, text, texts)
            usage = [{"agent": "agent_runtime.guardrail", "model": llm.model, "calls": 1, **tokens}]
            broken = f"{'break' if on_inputs else 'breaks'} the policy ({why.rstrip('.')})" if bad else ""
        found = contains + ([broken] if broken else [])
        block = bool(found) and opts.get("action", "block") == "block"
        where = "The inputs" if on_inputs else "The answer"
        parts = ([f"{'contain' if on_inputs else 'contains'} {', '.join(contains)}"] if contains else []) + ([broken] if broken else [])
        answer = f"{where} {' and '.join(parts)}." if found else f"{where} passed the guardrail."
        write({"event": "decision", "data": {"by": "guardrail", "step": i, "done": not found, "reason": answer}})
        result = {"step": i, "attempt": attempt, "question": title, "agent": nodes.GUARDRAIL, "action": "check",
                  "answer": answer, "sql": [], "ok": True, "error": None, "seconds": 0, "passed": not found}
        write({"event": "step", "data": {**result, "phase": "end"}})
        out: dict[str, Any] = {"results": [result], "usage": usage, "exit": block}
        if block:
            out["rejected"] = f"Stopped by a guardrail: {answer}"
        return out

    return node


def _approval_node(i: int, step: Step):
    """Human Approval: pauses the run (LangGraph interrupt) with the latest answer; resumes with the person's decision.
    approve keeps the draft, edit replaces it with their text, reject ends the run with their comment."""
    def node(state: AgentState) -> dict[str, Any]:
        reply = interrupt({"step": i, "question": _approval_question(step), "draft": _approval_draft(step, state)})
        # Resumed in this process (tests): the decision as the Tenant API's resume would apply it.
        events, out = approval_update(i, step, state, reply if isinstance(reply, dict) else {})
        write = get_stream_writer()
        for ev in events:
            write(ev)
        return out

    return node


def _approval_draft(step: Step, state: AgentState) -> str:
    """What the person approves: the answer named by the first {{key}} in the instruction, else the latest answer."""
    values = {**(state.get("inputs") or {}), **(state.get("outputs") or {})}
    named = next((values[k] for k in _PLACEHOLDER.findall(step.text) if k in values), None)
    return named if named is not None else next((r["answer"] for r in reversed(_work(state))), "")


def _approval_question(step: Step) -> str:
    return _PLACEHOLDER.sub("", step.text).strip().rstrip(":").strip() or step.text


def approval_update(i: int, step: Step, state: AgentState, reply: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """A person's decision on approval step i: the events to show and the state update. approve keeps the draft,
    edit replaces it with their text (later steps get it), reject ends the run with their comment."""
    draft = _approval_draft(step, state)
    attempt = 1 + sum(1 for r in state.get("results") or [] if r["step"] == i)
    decision = reply.get("decision", "approve")
    text, by = str(reply.get("text") or "").strip(), str(reply.get("by") or "")
    answer = text if decision == "edit" and text else draft
    verdict = {"approve": "Approved", "edit": "Approved with edits", "reject": "Rejected"}.get(decision, "Approved")
    result = {"step": i, "attempt": attempt, "question": _approval_question(step), "agent": builtins.APPROVAL, "action": "review",
              "answer": f"Rejected{' by ' + by if by else ''}: {text or 'no comment'}" if decision == "reject" else answer,
              "sql": [], "ok": True, "error": None, "seconds": 0, "verdict": verdict, "reviewer": by}
    events = [{"event": "decision", "data": {"by": "approval", "step": i, "decision": decision, "reviewer": by, "reason": text}},
              {"event": "step", "data": {**result, "phase": "end"}}]
    out: dict[str, Any] = {"results": [result], "exit": decision == "reject"}
    if decision == "reject":
        out["rejected"] = result["answer"]
    if step.output_key and decision != "reject":
        out["outputs"] = {step.output_key: answer}
    return events, out


def _remember_node(llm: Llm, chat, memories: list[str], texts: Texts | None = None):
    """After the answer: the facts from this run worth keeping in the agent's memory."""
    def node(state: AgentState) -> dict[str, Any]:
        if not state.get("ok"):
            return {"new_memories": []}
        get_stream_writer()({"event": "status", "data": {"stage": "Updating memory"}})
        facts, tokens = builtins.remember(llm, chat, memories, state.get("inputs") or {}, _work(state), state.get("answer", ""),
                                          texts)
        return {"new_memories": facts, "usage": [{"agent": "agent_runtime.memory", "model": llm.model, "calls": 1, **tokens}]}

    return node


def _fields(cfg: AgentConfig, llm: Llm, chat, answer: str, texts: Texts | None = None) -> tuple[dict[str, Any], dict[str, int]]:
    """The answer's Outputs as typed fields (one model call); a field the answer does not give is null."""
    spec = "\n".join(fill_prompt(prompt(texts, "agent.output_field"), NAME=o.name, TYPE=o.type,
                                 DESCRIPTION=": " + o.description if o.description else "") for o in cfg.outputs)
    reply, tokens = chat(llm, [("system", fill_prompt(prompt(texts, "agent.output_fields"), FIELDS=spec)), ("user", answer[:20000])])
    from app.askdata.common.text import extract_json
    data = extract_json(reply, default={})
    data = data if isinstance(data, dict) else {}
    return {o.name: _typed(data.get(o.name), o.type) for o in cfg.outputs}, tokens


def _typed(v: Any, kind: str) -> Any:
    if v is None:
        return None
    try:
        if kind == "number":
            n = float(str(v).replace(",", ""))
            return int(n) if n.is_integer() else n
        if kind == "boolean":
            return v if isinstance(v, bool) else str(v).strip().lower() in ("true", "yes", "1")
        if kind == "array":
            return v if isinstance(v, list) else [v]
        if kind == "object":
            return v if isinstance(v, dict) else {"value": v}
    except ValueError:
        return None
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)


def _answer_node(cfg: AgentConfig, llm: Llm | None, chat, texts: Texts | None = None):
    def node(state: AgentState) -> dict[str, Any]:
        out = _answer(state)
        if out.get("ok") and cfg.outputs and llm is not None:
            get_stream_writer()({"event": "status", "data": {"stage": "Filling the output fields"}})
            fields, tokens = _fields(cfg, llm, chat, out["answer"], texts)
            out = {**out, "output": fields,
                   "usage": out.get("usage", []) + [{"agent": "agent_runtime.output", "model": llm.model, "calls": 1, **tokens}]}
        return out

    def _answer(state: AgentState) -> dict[str, Any]:
        if state.get("rejected"):
            return {"answer": state["rejected"], "ok": True}
        results = [r for r in state.get("results") or [] if r.get("agent") not in CONTROL]
        done = [r for r in results if r["ok"]]
        if not results:
            return {"answer": "No step ran: the supervisor finished before choosing a step." if cfg.type == "supervisor"
                    else "No step ran: a router sent the run straight to the answer.", "ok": False}
        if not done:
            return {"answer": "No step produced an answer. " + "; ".join(r["error"] or "" for r in results), "ok": False}
        # One result is the answer as it is, unless it is Saved SQL rows asking for a summary (and a model is there).
        if len(results) == 1 and not (llm is not None and done[0].get("summarize")):
            return {"answer": done[0]["answer"], "ok": True}
        # A run that ends with Compute or Merge has already shaped its answer: no model call to combine.
        if cfg.type != "parallel" and results[-1]["ok"] and results[-1]["agent"] in (nodes.COMPUTE, nodes.MERGE):
            return {"answer": results[-1]["answer"], "ok": True}
        if llm is None:
            return {"answer": "\n\n".join(f"**{r['question']}**\n\n{r['answer']}" for r in done), "ok": True}
        get_stream_writer()({"event": "status", "data": {"stage": "Writing the answer"}})
        answer, tokens = chat(llm, _answer_messages(cfg, results, texts, state.get("inputs") or {}))
        return {"answer": answer, "ok": True,
                "usage": [{"agent": "agent_runtime.answer", "model": llm.model, "calls": 1, **tokens}]}

    return node


def _decide(chat, llm: Llm, system: str, user: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """One structured decision (JSON) from the tenant's AI provider, and its usage row."""
    from app.askdata.common.text import extract_json

    text, tokens = chat(llm, [("system", system), ("user", user)])
    return extract_json(text, default={}), [{"agent": "agent_runtime.answer", "model": llm.model, "calls": 1, **tokens}]


def _progress(state: AgentState, texts: Texts | None) -> str:
    inputs = "\n".join(fill_prompt(prompt(texts, "agent.progress_input"), NAME=k, VALUE=v)
                       for k, v in (state.get("inputs") or {}).items())
    done = "\n\n".join(
        fill_prompt(prompt(texts, "agent.progress_step"), N=r["step"], QUESTION=r["question"],
                    RESULT=r["answer"] if r["ok"] else fill_prompt(prompt(texts, "agent.progress_failed"), ERROR=r["error"]))
        for r in state.get("results") or [])
    return ((fill_prompt(prompt(texts, "agent.progress_inputs"), INPUTS=inputs) + "\n\n" if inputs else "")
            + fill_prompt(prompt(texts, "agent.progress_results"), RESULTS=done or prompt(texts, "agent.progress_none")))


def _supervisor_node(cfg: AgentConfig, llm: Llm | None, chat, names: list[str], texts: Texts | None = None):
    def system() -> str:   # built on use: without a model the supervisor runs the steps in order, no prompt needed
        workers = "\n".join(fill_prompt(prompt(texts, "agent.worker"), NAME=n, TEXT=s.text, TOOL=(s.tool or cfg.tools[0]).agent)
                            for n, s in zip(names, cfg.steps))
        return "\n".join(p for p in [profile(cfg, texts), fill_lines(prompt(texts, "agent.supervisor"), WORKERS=workers)] if p)

    def node(state: AgentState) -> dict[str, Any]:
        n = state.get("iterations", 0)
        succeeded = {f"step_{r['step']}" for r in state.get("results") or [] if r["ok"]}
        if llm is None:
            # No AI provider to decide with: run every worker once, in order, instead of ending with nothing.
            # (Not capped by max_iterations: each worker runs once, and there are at most 20.)
            ran = {f"step_{r['step']}" for r in state.get("results") or []}
            nxt = next((w for w in names if w not in ran), "answer")
            reason, usage = "No AI provider is active, so the steps run in order.", []
        elif n >= cfg.max_iterations or state.get("rejected"):
            return {"next": "answer"}
        else:
            decision, usage = _decide(chat, llm, system(), _progress(state, texts))
            nxt, reason = str(decision.get("next", "")).strip(), str(decision.get("reason", "")).strip()
            if nxt not in names or nxt in succeeded:
                nxt = "answer"
        get_stream_writer()({"event": "decision", "data": {"by": "supervisor", "next": nxt, "reason": reason, "round": n + 1}})
        return {"next": nxt, "iterations": n + 1, "usage": usage}

    return node


def _loop_check_node(cfg: AgentConfig, llm: Llm | None, chat, texts: Texts | None = None):
    def system() -> str:   # built on use: without a model the loop ends, no prompt needed
        return "\n".join(p for p in [profile(cfg, texts), prompt(texts, "agent.loop_check")] if p)

    def node(state: AgentState) -> dict[str, Any]:
        n = state.get("iterations", 0) + 1
        if llm is None or n >= cfg.max_iterations:
            return {"next": "answer", "iterations": n}
        decision, usage = _decide(chat, llm, system(), _progress(state, texts))
        done = decision.get("done") is True
        get_stream_writer()({"event": "decision", "data": {"by": "loop", "done": done, "reason": decision.get("reason", ""), "round": n}})
        return {"next": "answer" if done else "again", "iterations": n, "usage": usage}

    return node


def _answer_messages(cfg: AgentConfig, results: list[dict[str, Any]], texts: Texts | None,
                     inputs: dict[str, str] | None = None) -> list[tuple[str, str]]:
    # The goal's {{inputs}} are filled, so a goal such as "Answer: {{question}}" carries the user's own words.
    system = "\n".join(p for p in [
        fill_prompt(prompt(texts, "agent.answer_role"), ROLE=cfg.role) if cfg.role else "",
        cfg.system_prompt,
        fill_prompt(prompt(texts, "agent.answer_goal"), GOAL=fill(cfg.goal, inputs or {})) if cfg.goal else "",
        prompt(texts, "agent.answer"),
    ] if p)
    body = "\n\n".join(
        fill_prompt(prompt(texts, "agent.answer_step"), N=r["step"],
                    QUESTION=r["question"] + (f"\nExpected: {r['expected_output']}" if r.get("expected_output") else ""),
                    RESULT=fill_prompt(prompt(texts, "agent.answer_result"), ANSWER=r["answer"]) if r["ok"]
                    else fill_prompt(prompt(texts, "agent.answer_failed"), ERROR=r["error"]))
        for r in results)
    return [("system", system), ("user", body)]


def _chat(llm: Llm, messages: list[tuple[str, str]]) -> tuple[str, dict[str, int]]:
    from app.askdata.llm import invoke

    from app import trace

    with trace.label(trace.current_label() or "agent"):
        _, reply = invoke(llm, messages, temperature=0.2 if llm.temperature is None else llm.temperature,
                          max_tokens=llm.max_tokens)
    meta = getattr(reply, "usage_metadata", None) or {}
    return str(reply.content), {"input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))}

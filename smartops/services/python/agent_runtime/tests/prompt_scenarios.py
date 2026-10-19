"""Every message the Ask Data nodes and the agent graph send to the AI, over a matrix of cases.

Used by tests/test_prompt_regression.py: the messages built from the seeded prompts must equal the recorded
baseline (tests/fixtures/prompt_baseline.json) character for character. Each scenario calls a node directly with
a fake model that records (system, user) and replies with a fixed text, so no AI provider or database is needed.

`adapter` hides how prompts reach the code:
  adapter.prompt_set(max_rows, business_rules, few_shots) -> the PromptSet the Ask Data nodes use
  adapter.agent_kwargs() -> extra keyword arguments for the agent node factories (the prompt texts)
"""
from __future__ import annotations

from typing import Any, Callable

SCHEMA = (
    "TABLE well.well_master\n  - well_id varchar(20) NOT NULL PK\n  - well_name varchar(100)\n"
    "  - cluster varchar(50)\n  FK: well_id -> well.task_daily.well_id\n\n"
    "TABLE well.task_daily\n  - well_id varchar(20)\n  - crew_id int\n  - progress decimal(5,2)\n\n"
    "TABLE ref.crew\n  - crew_id int NOT NULL PK\n  - code varchar(30)"
)
HISTORY = [{"user": "How many wells are in Nimr?", "assistant": "There are 42 wells in Nimr."}]
STEP = {"sub_question": "wells per cluster", "sql": "SELECT cluster, COUNT(*) AS n FROM well.well_master GROUP BY cluster",
        "columns": ["cluster", "n"], "rows": [["Nimr", 42], ["Marmul", 17]], "truncated": False}
WIDE = {"sub_question": "task detail", "sql": "SELECT * FROM well.task_daily",
        "columns": [f"c{i}" for i in range(10)], "rows": [[f"value number {j}-{i} with a long text" for i in range(10)] for j in range(5)],
        "truncated": True}
FAILED_STEP_RESULT = {"step": 2, "question": "Count crews", "ok": False, "answer": "", "error": "timeout"}
NO_COLUMNS = {"sub_question": "", "sql": "SELECT 1 WHERE 1 = 0", "columns": [], "rows": [], "truncated": False}
NO_ROWS = {"sub_question": "empty result", "sql": "SELECT well_id FROM well.well_master WHERE 1 = 0",
           "columns": ["well_id"], "rows": [], "truncated": False}
BIG = {"sub_question": "all wells", "sql": "SELECT well_id FROM well.well_master", "columns": ["well_id"],
       "rows": [[f"W{i}"] for i in range(505)], "truncated": False}


class Recorder:
    """A fake `chat` for the Ask Data nodes: records each call, replies with the next canned text."""

    def __init__(self, replies: list[str] | None = None):
        self.calls: list[dict[str, Any]] = []
        self.replies = list(replies or [])

    def __call__(self, system: str, user: str, temperature=None, fast=False, **_k) -> str:
        self.calls.append({"system": system, "user": user, "temperature": temperature, "fast": bool(fast)})
        return self.replies.pop(0) if self.replies else '{"route": "sql", "action": "answer", "ok": true}'


class AgentRecorder:
    """A fake `chat` for the agent graph: chat(llm, messages) -> (text, tokens)."""

    def __init__(self, reply: str):
        self.calls: list[dict[str, Any]] = []
        self.reply = reply

    def __call__(self, llm, messages):
        self.calls.append({"messages": [list(m) for m in messages]})
        return self.reply, {"input": 1, "output": 1}


def _state(**kw) -> dict[str, Any]:
    base = {"question": "Which cluster has the most wells?", "schema": SCHEMA, "history": [], "mode": "deep",
            "steps": [], "rejected_steps": [], "tried_sql": []}
    base.update(kw)
    return base


def askdata_scenarios() -> list[tuple[str, str, dict[str, Any], list[str]]]:
    """(name, node, state, canned replies)."""
    return [
        ("orchestrator/plain", "orchestrator", _state(), ['{"route":"sql"}']),
        ("orchestrator/history", "orchestrator", _state(history=HISTORY, question="and in Marmul?"), ['{"route":"sql"}']),
        ("orchestrator/normal", "orchestrator", _state(mode="normal"), ['{"route":"sql"}']),
        ("planner/gathered", "planner", _state(steps=[STEP], query_count=1), ['{"action":"answer"}']),
        ("planner/wide-followup", "planner", _state(steps=[STEP, WIDE], query_count=2, is_followup=True, history=HISTORY),
         ['{"action":"answer"}']),
        ("sql_author/plain", "sql_author", _state(), ["```sql\nSELECT 1\n```"]),
        ("sql_author/plan", "sql_author", _state(plan="count wells per cluster, top 1"), ["```sql\nSELECT 1\n```"]),
        ("sql_author/sub-question", "sql_author", _state(sub_question="crews per well", steps=[STEP]), ["```sql\nSELECT 1\n```"]),
        ("sql_author/chart-donut", "sql_author", _state(wants_chart=True, chart_type="donut"), ["```sql\nSELECT 1\n```"]),
        ("sql_author/chart-bar", "sql_author", _state(wants_chart=True, chart_type="bar"), ["```sql\nSELECT 1\n```"]),
        ("sql_author/validator-retry", "sql_author", _state(validation_error="Not allowed: sys.tables"), ["```sql\nSELECT 1\n```"]),
        ("sql_author/exec-retry", "sql_author", _state(exec_error="Invalid column name 'x'."), ["```sql\nSELECT 1\n```"]),
        ("sql_author/verifier-retry", "sql_author", _state(verify_feedback="Count distinct wells.", sql="SELECT COUNT(*) FROM t",
                                                           tried_sql=["select count(*) from t"]), ["```sql\nSELECT 1\n```"]),
        ("sql_author/verifier-no-sql", "sql_author", _state(verify_feedback="Use the cluster column."), ["```sql\nSELECT 1\n```"]),
        ("sql_author/followup-normal", "sql_author", _state(is_followup=True, history=HISTORY, mode="normal"),
         ["```sql\nSELECT 1\n```"]),
        ("analysis/plain", "analysis", _state(steps=[STEP]), ["analysis text"]),
        ("analysis/truncated-followup", "analysis", _state(steps=[WIDE], is_followup=True, history=HISTORY), ["analysis text"]),
        ("analysis/no-columns-no-rows", "analysis", _state(steps=[NO_COLUMNS, NO_ROWS]), ["analysis text"]),
        ("synthesize/table-cut", "synthesize", _state(steps=[BIG], verify_ok=True), ["505 wells."]),
        ("synthesize/no-data-no-error", "synthesize", _state(), ["Sorry."]),
        ("synthesize/only-rejected-verified", "synthesize", _state(rejected_steps=[STEP], verify_ok=True), ["Nothing."]),
        ("planner/no-columns", "planner", _state(steps=[NO_COLUMNS, NO_ROWS], query_count=2), ['{"action":"query"}']),
        ("verifier/plain", "verifier", _state(steps=[STEP]), ['{"ok": true}']),
        ("verifier/analysis-followup", "verifier", _state(steps=[STEP], analysis="Nimr leads.", is_followup=True, history=HISTORY),
         ['{"ok": false, "feedback": "Group by cluster."}']),
        ("verifier/unreadable", "verifier", _state(steps=[STEP]), ["not json"]),
        ("verifier/no-schema", "verifier", _state(steps=[STEP], schema=""), ['{"ok": true}']),
        ("synthesize/no-data", "synthesize", _state(exec_error="timeout"), ["Sorry."]),
        ("synthesize/verified", "synthesize", _state(steps=[STEP], verify_ok=True), ["Nimr has 42 wells."]),
        ("synthesize/unverified", "synthesize", _state(steps=[STEP], rejected_steps=[WIDE], verify_ok=False, analysis="Nimr leads.",
                                                       is_followup=True, history=HISTORY), ["Indicative."]),
        ("synthesize/normal", "synthesize", _state(steps=[STEP], verify_ok=True, mode="normal"), ["Nimr."]),
        ("chitchat/entities", "chitchat", _state(question="hello"), ["Hi!"]),
        ("chitchat/no-schema", "chitchat", _state(question="hello", schema=""), ["Hi!"]),
        ("clarify/generic", "clarify", _state(), []),
        ("clarify/given", "clarify", _state(clarify_question="Which well?"), []),
    ]


def run_askdata(adapter, concerns: list[str] | None = None) -> list[dict[str, Any]]:
    """Runs every Ask Data scenario; returns one record per scenario (calls + the node's text output)."""
    import importlib

    from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget, run_context

    nodes = {n: importlib.import_module(f"app.askdata.nodes.{m}") for n, m in [
        ("orchestrator", "orchestrator"), ("planner", "planner"), ("sql_author", "sql_author"), ("analysis", "analysis"),
        ("verifier", "verifier"), ("synthesize", "synthesize"), ("chitchat", "finalize"), ("clarify", "finalize")]}
    fns = {"orchestrator": "orchestrator_node", "planner": "planner_node", "sql_author": "sql_author_node",
           "analysis": "analysis_node", "verifier": "verifier_node", "synthesize": "synthesize_node",
           "chitchat": "chitchat_node", "clarify": "clarify_node"}
    out = []
    for knowledge in ("default", "agent"):
        br, fs = (None, None) if knowledge == "default" else ("AGENT RULE: wells are counted by well_id.", "Q: wells?\nSELECT 1")
        run = AskDataRun(settings=AskDataSettings(max_rows=500), db=DbTarget(server="s", name="n", user="u", password="p"))
        with run_context(run):
            run.prompts = adapter.prompt_set(500, br, fs)
            for name, node, state, replies in askdata_scenarios():
                rec = Recorder(replies)
                module = nodes[node]
                old_chat = getattr(module, "chat", None)
                if old_chat is not None:
                    module.chat = rec
                old_concerns = getattr(module, "sql_concerns", None)
                if node == "verifier":
                    module.sql_concerns = (lambda *_a: list(concerns or [])) if concerns is not None else old_concerns
                try:
                    result = getattr(module, fns[node])(dict(state))
                finally:
                    if old_chat is not None:
                        module.chat = old_chat
                    if node == "verifier":
                        module.sql_concerns = old_concerns
                text = {k: v for k, v in result.items() if k in ("answer", "verify_feedback", "sql")}
                out.append({"scenario": f"{knowledge}/{name}" + ("/concerns" if concerns else ""), "calls": rec.calls,
                            "output": text})
    return out


def run_agents(adapter) -> list[dict[str, Any]]:
    """The supervisor, loop check, router and final-answer messages for a few agent shapes."""
    from app import graph

    writer = graph.get_stream_writer
    graph.get_stream_writer = lambda: (lambda _e: None)   # the nodes run outside a graph here
    try:
        return _agents(adapter, graph)
    finally:
        graph.get_stream_writer = writer


def _agents(adapter, graph) -> list[dict[str, Any]]:
    from app.models import AgentConfig, Llm

    llm = Llm(base_url="http://llm", model="m")
    cfg = AgentConfig.model_validate({
        "name": "Well report", "type": "supervisor", "role": "Drilling analyst", "goal": "Report well status",
        "systemPrompt": "Answer in tables.",
        "steps": [{"text": "Count wells per cluster"}, {"text": "Count crews", "tool": {"agent": "ask_data", "action": "normal"}}],
        "tools": [{"agent": "ask_data", "action": "deep"}]})
    bare = AgentConfig.model_validate({"name": "Bare", "type": "loop", "steps": [{"text": "a"}],
                                       "tools": [{"agent": "ask_data", "action": "deep"}]})
    results = [{"step": 1, "question": "Count wells per cluster", "ok": True, "answer": "Nimr 42", "error": None},
               FAILED_STEP_RESULT]
    state = {"inputs": {"well_id": "33785", "cluster": "Nimr"}, "results": results, "iterations": 0}
    empty = {"inputs": {}, "results": [], "iterations": 0}
    kw = adapter.agent_kwargs()
    out = []

    def record(name: str, factory: Callable, reply: str, st: dict, *args):
        rec = AgentRecorder(reply)
        result = factory(*args[:2], rec, *args[2:], **kw)(dict(st)) if args else None
        out.append({"scenario": name, "calls": rec.calls, "output": {k: v for k, v in (result or {}).items()
                                                                      if k in ("next", "answer", "route")}})

    for c, tag in ((cfg, "full"), (bare, "bare")):
        record(f"supervisor/{tag}", graph._supervisor_node, '{"next": "FINISH", "reason": "done"}', state, c, llm, ["step_1", "step_2"][:len(c.steps)])
        record(f"supervisor/{tag}/empty", graph._supervisor_node, '{"next": "step_1", "reason": "start"}', empty, c, llm, ["step_1", "step_2"][:len(c.steps)])
        record(f"loop/{tag}", graph._loop_check_node, '{"done": false, "reason": "more"}', state, c, llm)
        record(f"answer/{tag}", graph._answer_node, "Combined answer.", state, c, llm)

    from app.models import Step
    for fallback in (True, False):
        branches = [{"id": "b1", "label": "Completed wells", "op": "equals", "value": "done", "target": None},
                    {"id": "b2", "label": "Active wells", "op": "equals", "value": "active", "target": None}]
        if fallback:
            branches.append({"id": "b3", "op": "else", "target": None})
        step = Step.model_validate({"text": "Is the well completed?", "kind": "router", "routeBy": "ai", "branches": branches})
        for c, tag in ((cfg, "full"), (bare, "bare")):
            rec = AgentRecorder('{"branch": 1, "reason": "it is"}')
            result = graph._router_node(1, step, c, llm, rec, lambda target: target or "answer", **kw)(dict(state))
            out.append({"scenario": f"router/{'else' if fallback else 'no-else'}/{tag}", "calls": rec.calls,
                        "output": {"route": result.get("route")}})

    # A question filling the other inputs (app/prepare.py): one call, the inputs listed with type and description.
    from app.prepare import extract
    asking = AgentConfig.model_validate({
        "name": "Well slippage", "steps": [{"text": "x"}], "tools": [{"agent": "sql_query", "action": "table"}],
        "inputs": [{"name": "question"}, {"name": "well_id", "type": "number", "required": False, "description": "Well id"},
                   {"name": "report_date", "required": False}]})
    rec = AgentRecorder('{"values": {"well_id": "35543"}, "note": ""}')
    values, _, _ = extract(asking, "Slippage for well 35543", llm, kw["texts"], chat=rec, today="2026-10-19")
    out.append({"scenario": "question/extract", "calls": rec.calls, "output": {"values": values}})
    return out

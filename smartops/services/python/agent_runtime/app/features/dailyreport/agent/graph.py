"""The agent graph:  plan -> act -> write -> verify -> (write again | end)  (ported from app/agentic/graph.py).

    plan    a FIXED plan for the dashboard's own briefs (day / well / task): no planning call, as repeatable as
            before; the PLANNER model only for an open question, its plan validated against the tool catalogue and
            capped at agentMaxToolCalls. Planner unavailable or unusable: a keyword heuristic (settings).
    act     runs the plan's tools: read-only, deterministic, never a model.
    write   one writer call over every tool result, or a verified answer reused for identical input.
    verify  the deterministic check (verifier.py), plus an optional model second opinion (llmVerify). A failed draft
            returns to write with its issues, at most agentMaxRevisions times.

Built per request (nodes close over the request's context). Every node appends to ``trace`` (what it did, how long,
which model), returned beside the answer. Every text a model reads is a dailyreport.* prompt.
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import date
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.features.common import llm
from app.features.common.context import run_context
from app.features.common.text import extract_json, strip_think
from app.features.dailyreport.agent import tools, verifier
from app.features.dailyreport.data import ANSWER_CACHE, content_key, date_tag

logger = logging.getLogger(__name__)


class AgentState(TypedDict, total=False):
    kind: str                     # "brief" | "ask"
    report_date: date
    scope: str                    # brief: day | well | task
    well_id: Optional[int]
    task_daily_id: Optional[int]
    question: str
    plan: List[Dict[str, Any]]
    unanswerable_reason: Optional[str]
    results: List[tools.ToolResult]
    draft: Optional[str]
    answer_key: Optional[str]
    verification: Dict[str, Any]
    revisions: int
    retry: bool
    cached: bool
    models: Dict[str, str]
    error: Optional[str]
    trace: List[Dict[str, Any]]


class AiFailure(RuntimeError):
    """The model could not be asked or gave no text (message is safe to show)."""


def _trace(state: AgentState, node: str, started: float, **detail: Any) -> List[Dict[str, Any]]:
    entry = {"node": node, "duration_s": round(time.perf_counter() - started, 3)}
    entry.update({k: v for k, v in detail.items() if v is not None})
    return list(state.get("trace", [])) + [entry]


# ---------------------------------------------------------------------------------------------------------------
# plans
# ---------------------------------------------------------------------------------------------------------------
def fixed_plan(scope: str, well_id: Optional[int], task_daily_id: Optional[int]) -> List[Dict[str, Any]]:
    """The dashboard's own briefs: the same steps every time."""
    if scope == "well":
        return [
            {"tool": "well_overview", "args": {"well_id": well_id}, "why": "the well's own figures"},
            {"tool": "milestones", "args": {"well_id": well_id}, "why": "its lifecycle deadlines"},
        ]
    if scope == "task":
        return [{"tool": "task_detail", "args": {"task_daily_id": task_daily_id, "well_id": well_id},
                 "why": "the task and its crew evidence"}]
    return [
        {"tool": "day_overview", "args": {}, "why": "what was reported and where open work stands"},
        {"tool": "deadline_pressure", "args": {}, "why": "open work against upcoming deadlines"},
        {"tool": "data_quality", "args": {}, "why": "data problems worth flagging"},
    ]


def heuristic_plan(question: str, settings) -> List[Dict[str, Any]]:
    """Only when the planner model is unavailable or returns nothing usable. The words come from the settings."""
    lowered = question.lower()
    words = [re.escape(w.strip()) for w in settings.heuristic_well_words if w.strip()]
    if words:
        pattern = re.compile(rf"\b(?:{'|'.join(words)})\s*#?\s*(\d{{{settings.heuristic_well_id_min_digits},}})\b",
                             re.IGNORECASE)
        match = pattern.search(question)
        if match:
            well_id = int(match.group(1))
            return [
                {"tool": "well_overview", "args": {"well_id": well_id}, "why": "the well asked about"},
                {"tool": "milestones", "args": {"well_id": well_id}, "why": "its deadlines"},
            ]
    steps: List[Dict[str, Any]] = []

    def has(keywords) -> bool:
        return any(k.strip().lower() and k.strip().lower() in lowered for k in keywords)

    if has(settings.heuristic_deadline_keywords):
        steps.append({"tool": "deadline_pressure", "args": {}, "why": "deadlines with open work"})
    if has(settings.heuristic_quality_keywords):
        steps.append({"tool": "data_quality", "args": {}, "why": "data problems"})
    if has(settings.heuristic_no_report_phrases):
        steps.append({"tool": "list_wells", "args": {"filter": "no_report_with_open_work"},
                      "why": "wells without a report"})
    if not steps:
        steps.append({"tool": "day_overview", "args": {}, "why": "the day as a whole"})
    return steps


def validate_plan(raw: Any, max_steps: int, reason_max_chars: int) -> List[Dict[str, Any]]:
    """Known tools only, each with only the arguments it takes, at most ``max_steps``."""
    steps = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or item.get("tool") not in tools.TOOLS:
            continue
        args = item.get("args") if isinstance(item.get("args"), dict) else {}
        allowed = set(tools.TOOLS[item["tool"]].params)
        steps.append({"tool": item["tool"], "args": {k: v for k, v in args.items() if k in allowed},
                      "why": str(item.get("why") or "")[:reason_max_chars]})
        if len(steps) >= max_steps:
            break
    return steps


# ---------------------------------------------------------------------------------------------------------------
# the graph
# ---------------------------------------------------------------------------------------------------------------
class AgentGraph:
    """One request's agent: the nodes close over its context (settings, prompts, data, tools)."""

    def __init__(self, ctx, report_date: date, today: date) -> None:
        self.ctx = ctx
        self.settings = ctx.settings
        self.texts = ctx.texts
        self.env = tools.ToolEnv(ctx, report_date, today)

    # ---- model calls --------------------------------------------------------------------------------------------
    def model_name(self, tier: str) -> Optional[str]:
        provider = self.ctx.run.request.llm
        if provider is None:
            return None
        return (provider.fast_model or provider.model) if tier == "fast" else provider.model

    def chat(self, role: str, system: str, user: str, *, tier: str, max_tokens: int, json_mode: bool = False) -> str:
        try:
            text = llm.chat(system, user, agent=role, temperature=self.settings.temperature, fast=tier == "fast",
                            max_tokens=max_tokens, json_mode=json_mode)
        except llm.AiUnavailable as exc:
            raise AiFailure(str(exc)) from None
        except Exception as exc:  # noqa: BLE001 - a provider error is "unavailable", never a crash
            logger.warning("daily report %s call failed: %s", role, type(exc).__name__)
            raise AiFailure("The AI service could not be reached or returned an error.") from None
        text = strip_think(text or "").strip()
        if not text:
            raise AiFailure("The AI service returned no text.")
        return text

    def writer_profile(self, state: AgentState) -> tuple[str, int, int]:
        """(tier, max tokens, word limit): the front page's day brief has its own."""
        s = self.settings
        if state["kind"] == "brief" and state.get("scope") == "day":
            return s.day_writer_tier, s.day_writer_max_tokens, s.writer_word_limit_day
        return s.writer_tier, s.writer_max_tokens, s.writer_word_limit

    def answer_key(self, system: str, user: str, tier: str, max_tokens: int) -> str:
        """Content hash of everything a verified answer depends on: the database, the provider and model, the exact
        writer prompts (which carry the tool results) and how the answer was verified."""
        s = self.settings
        provider = self.ctx.run.request.llm
        verifier_texts = [self.texts.get("verifier_issues"), list(s.forbidden_phrases), s.llm_verify]
        if s.llm_verify:
            verifier_texts += [self.texts.get("verifier_system"), self.texts.get("verifier_user"),
                               self.model_name(s.verifier_tier), s.verifier_max_issues]
        return content_key("answer", self.ctx.data.identity,
                           [provider.provider, provider.base_url] if provider else None,
                           self.model_name(tier), s.temperature, max_tokens, system, user, verifier_texts)

    # ---- nodes --------------------------------------------------------------------------------------------------
    def plan(self, state: AgentState) -> Dict[str, Any]:
        started = time.perf_counter()
        s = self.settings
        if state["kind"] == "brief":
            plan = fixed_plan(state.get("scope", "day"), state.get("well_id"), state.get("task_daily_id"))
            return {"plan": plan, "trace": _trace(state, "plan", started, mode="fixed", steps=len(plan))}

        question = state.get("question", "")
        system = self.texts.fill("planner_system", MAX_STEPS=s.agent_max_tool_calls)
        user = self.texts.fill("planner_user", REPORT_DATE=state["report_date"].isoformat(),
                               TOOLS=json.dumps(tools.catalog(self.ctx), indent=2), QUESTION=question)
        models = dict(state.get("models", {}))
        model = None
        try:
            text = self.chat("planner", system, user, tier=s.planner_tier, max_tokens=s.planner_max_tokens,
                             json_mode=True)
            model = models["planner"] = self.model_name(s.planner_tier)
            parsed = extract_json(text)
            parsed = parsed if isinstance(parsed, dict) else {}
            plan = validate_plan(parsed.get("steps"), s.agent_max_tool_calls, s.plan_reason_max_chars)
            reason = parsed.get("unanswerable_reason") or None
            reason = str(reason) if reason else None
            if not plan and not reason:
                plan = heuristic_plan(question, s)
                mode = "planner returned no usable step; heuristic plan"
            else:
                mode = "planner"
        except AiFailure as exc:
            plan, reason, mode = heuristic_plan(question, s), None, f"planner unavailable ({exc}); heuristic plan"
        return {
            "plan": plan,
            "unanswerable_reason": reason if not plan else None,
            "models": models,
            "trace": _trace(state, "plan", started, mode=mode, steps=len(plan), model=model,
                            reason=reason if not plan else None),
        }

    def act(self, state: AgentState) -> Dict[str, Any]:
        trace = list(state.get("trace", []))
        results: List[tools.ToolResult] = []
        for step in state.get("plan", [])[: self.settings.agent_max_tool_calls]:
            result = tools.run_tool(self.env, step["tool"], step.get("args"))
            results.append(result)
            trace.append({"node": "tool", "tool": result.tool, "args": result.args, "why": step.get("why"),
                          "ok": result.ok, "error": result.error, "duration_s": round(result.duration_s, 3)})
        return {"results": results, "trace": trace}

    def _nothing_to_explain(self, state: AgentState) -> Optional[str]:
        """None when there is something to write about; otherwise the reason shown instead of an answer. A brief is
        about its scope's own tool (the first step); a failed tool says why it failed, not that nothing exists."""
        results = state.get("results", [])
        nothing = self.texts.get("answer_nothing_to_explain")
        if not results:
            return nothing
        considered = results[:1] if state["kind"] == "brief" else results
        if not all(_unavailable(r) for r in considered):
            return None
        failed = next((r for r in considered if not r.ok and r.error), None)
        return failed.error if failed is not None else nothing

    def write(self, state: AgentState) -> Dict[str, Any]:
        started = time.perf_counter()
        tier, max_tokens, words = self.writer_profile(state)
        models = dict(state.get("models", {}))

        if state.get("unanswerable_reason"):
            text = self.texts.fill("answer_unanswerable", REASON=state["unanswerable_reason"])
            return {"draft": text, "trace": _trace(state, "write", started, mode="unanswerable")}
        reason = self._nothing_to_explain(state)
        if reason is not None:
            return {"draft": None, "error": reason, "trace": _trace(state, "write", started, mode="nothing to explain")}

        system = self.texts.get("explain_system") + "\n\n" + self.texts.fill("writer_addendum", WORD_LIMIT=words)
        inputs = [result.for_model() for result in state["results"]]
        user = self.texts.fill("writer_user", optional=("QUESTION",), REPORT_DATE=state["report_date"].isoformat(),
                               QUESTION=state.get("question") or "",
                               TOOL_RESULTS=json.dumps(inputs, ensure_ascii=False, indent=2, default=str))

        revisions = state.get("revisions", 0)
        answer_key = state.get("answer_key")
        if revisions == 0:
            answer_key = self.answer_key(system, user, tier, max_tokens)
            cached = ANSWER_CACHE.get(answer_key, self.settings.answer_cache_ttl_seconds)
            if cached is not None:
                models["writer"] = cached["model"]
                return {"draft": cached["draft"], "verification": cached["verification"], "cached": True,
                        "answer_key": answer_key, "models": models,
                        "trace": _trace(state, "write", started, mode="reused from an earlier identical request",
                                                model=cached["model"])}
        else:
            issues = state.get("verification", {}).get("issues", [])
            user += "\n\n" + self.texts.fill("writer_revision", ISSUES="- " + "\n- ".join(issues),
                                             DRAFT=state.get("draft") or "")

        model = self.model_name(tier)
        try:
            text = self.chat("day_writer" if state.get("scope") == "day" and state["kind"] == "brief" else "writer",
                             system, user, tier=tier, max_tokens=max_tokens)
        except AiFailure as exc:
            return {"draft": None, "error": str(exc),
                    "trace": _trace(state, "write", started, mode="failed", error=str(exc), model=model)}
        models["writer"] = model
        usage = self.ctx.run.usage[-1] if self.ctx.run.usage else {}
        return {"draft": text, "cached": False, "answer_key": answer_key, "models": models,
                "trace": _trace(state, "write", started, mode="revision" if revisions else "draft", model=model,
                                output_tokens=usage.get("output"))}

    def verify(self, state: AgentState) -> Dict[str, Any]:
        started = time.perf_counter()
        if state.get("cached") or not state.get("draft") or state.get("unanswerable_reason"):
            return {"trace": _trace(state, "verify", started, mode="skipped")}
        s = self.settings
        inputs = [result.for_model() for result in state.get("results", [])]
        evidence = inputs + [{"report_date": state["report_date"]}]
        check = verifier.verify(
            state["draft"], evidence, question=state.get("question", ""), forbidden_phrases=s.forbidden_phrases,
            issue=lambda kind, **values: self.texts.entry("verifier_issues", kind, **values))
        issues = list(check.issues)
        models = dict(state.get("models", {}))

        if s.llm_verify and not issues:
            system = self.texts.get("verifier_system")
            user = self.texts.fill("verifier_user", TOOL_RESULTS=json.dumps(inputs, default=str, ensure_ascii=False),
                                   DRAFT=state["draft"])
            try:
                text = self.chat("verifier", system, user, tier=s.verifier_tier, max_tokens=s.verifier_max_tokens,
                                 json_mode=True)
                models["verifier"] = self.model_name(s.verifier_tier)
                opinion = extract_json(text)
                opinion = opinion if isinstance(opinion, dict) else {}
                if opinion.get("ok") is False:
                    found = opinion.get("issues") if isinstance(opinion.get("issues"), list) else []
                    issues.extend(str(i) for i in found[: s.verifier_max_issues])
            except AiFailure:
                logger.info("daily report verifier model unavailable; deterministic check only")

        verification = {"passed": not issues, "issues": issues, "checked_numbers": check.checked_numbers,
                        "llm_second_opinion": bool(s.llm_verify)}
        retry = bool(issues) and state.get("revisions", 0) < s.agent_max_revisions
        update: Dict[str, Any] = {
            "verification": verification, "models": models, "retry": retry,
            "trace": _trace(state, "verify", started, passed=not issues, issues=len(issues),
                            next="revise" if retry else "finish"),
        }
        if retry:
            update["revisions"] = state.get("revisions", 0) + 1
        elif not issues and state.get("answer_key"):
            # Only a verified answer is ever reused.
            ANSWER_CACHE.put(state["answer_key"],
                             {"draft": state["draft"], "verification": verification,
                              "model": models.get("writer")},
                             tag=date_tag(self.ctx.data.identity, state["report_date"]),
                             ttl_seconds=s.answer_cache_ttl_seconds, max_entries=s.answer_cache_max_entries)
        return update

    # ---- wiring -------------------------------------------------------------------------------------------------
    def _node(self, fn):
        def run(state: AgentState) -> Dict[str, Any]:
            with run_context(self.ctx.run):      # whatever thread LangGraph runs the node on
                return fn(state)
        return run

    def build(self):
        graph = StateGraph(AgentState)
        graph.add_node("plan", self._node(self.plan))
        graph.add_node("act", self._node(self.act))
        graph.add_node("write", self._node(self.write))
        graph.add_node("verify", self._node(self.verify))
        graph.add_edge(START, "plan")
        graph.add_edge("plan", "act")
        graph.add_edge("act", "write")
        graph.add_conditional_edges("write", lambda st: "verify" if st.get("draft") else END,
                                    {"verify": "verify", END: END})
        graph.add_conditional_edges("verify", lambda st: "write" if st.get("retry") else END,
                                    {"write": "write", END: END})
        return graph.compile()

    def invoke(self, state: AgentState) -> AgentState:
        limit = 2 * (self.settings.agent_max_revisions + 1) + 10
        return self.build().invoke(state, config={"recursion_limit": limit})


def _unavailable(result: tools.ToolResult) -> bool:
    return (not result.ok) or (isinstance(result.result, dict) and result.result.get("available") is False)

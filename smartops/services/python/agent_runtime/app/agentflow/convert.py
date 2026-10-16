"""Saved agent <-> agentflow.json v1 (the AgenticUIFramework's portable format, LangGraph flavour).

Export maps each instruction to an AgentSpec (its tool in `tools`) plus a TaskSpec (the instruction text), the
agent type to `process`, inputs to `state_channels` and the tools to ToolSpecs. For a supervisor the first
agent is the supervisor, as in the framework. What agentflow has no field for (Ask Data knowledge, canvas
positions, outputs, status, the exact tool of each step) goes in an extra `wellmonitoring` block, which the
schema allows; import prefers it, so wellmonitoring -> agentflow -> wellmonitoring is lossless.

Import also takes flows made in the framework: steps come from `tasks` (or the agents when there are none),
tools from ToolSpecs that name a wellmonitoring tool. Anything that cannot be used is reported as a warning.
Agents are plain dicts in the Tenant API's camelCase shape (SaveAiAgentRequest).
"""
from __future__ import annotations

import re
from typing import Any

from app.agentflow.schema import (AgentFlow, AgentSpec, LangGraphConfig, LlmProviderSpec, Meta, RouterSpec, RouteSpec,
                                  StateChannelSpec, TaskSpec, ToolSpec)

# The Tenant API's provider names (Settings > AI > Providers) as agentflow.json's. "custom" is any
# OpenAI-compatible endpoint, which agentflow calls vllm (it needs the base URL).
_PROVIDERS = {"openai": "openai", "azure": "azure-openai", "anthropic": "anthropic", "ollama": "ollama", "custom": "vllm"}


def _llm(agent: dict[str, Any]) -> LlmProviderSpec | None:
    """The tenant's active model (sent by the Tenant API as "llm", never with its key); None = agentflow's default."""
    llm = agent.get("llm") or {}
    if not llm.get("model"):
        return None
    provider = _PROVIDERS.get(str(llm.get("provider") or "").lower(), "vllm")
    return LlmProviderSpec(provider=provider, model=llm["model"], base_url=llm.get("baseUrl") or None,
                           api_key_env="AZURE_OPENAI_API_KEY" if provider == "azure-openai" else "OPENAI_API_KEY")

TYPES = ("sequential", "parallel", "supervisor", "loop")
EXTRA = "wellmonitoring"
DEFAULT_TOOL = {"agent": "ask_data", "action": "deep"}


def _tool_name(tool: dict[str, Any]) -> str:
    return re.sub(r"\W+", "_", f"{tool.get('agent', '')}_{tool.get('action', '')}").strip("_") or "tool"


def _key(i: int) -> str:
    return f"step_{i}"


_OPS = {"equals": "==", "not_equals": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def _condition(b: dict[str, Any]) -> str:
    """A router rule as the Python expression agentflow routes use (for reading in the framework)."""
    v, op, value = f"str(state.get({b.get('input') or ''!r}) or '').strip().lower()", b.get("op") or "equals", (b.get("value") or "").lower()
    if op in _OPS:
        try:
            return f"float({v} or 0) {_OPS[op]} {float(value)}"
        except ValueError:
            return f"{v} {_OPS[op]} {value!r}"
    return {"contains": f"{value!r} in {v}", "not_contains": f"{value!r} not in {v}",
            "empty": f"{v} == ''", "not_empty": f"{v} != ''"}.get(op, "True")


def _routers(steps: list[dict[str, Any]]) -> list[RouterSpec]:
    keys = {s.get("id"): _key(i) for i, s in enumerate(steps, 1) if s.get("id")}

    def target(t: str | None) -> str:
        return keys.get(t, "END") if t and t != "answer" else "END"

    out = []
    for i, s in enumerate(steps, 1):
        if s.get("kind") != "router":
            continue
        branches = s.get("branches") or []
        fallback = next((b for b in branches if b.get("op") == "else"), None)
        routes = [RouteSpec(condition="False" if s.get("routeBy") == "ai" else _condition(b), target=target(b.get("target")),
                            label=b.get("label") or "") for b in branches if b.get("op") != "else"]
        # The step that leads here: one linked to the router, else the step before it when that one has no link.
        prev = steps[i - 2] if i > 1 else None
        source = next((_key(j) for j, x in enumerate(steps, 1) if x.get("kind") != "router" and x.get("next") == s.get("id")),
                      _key(i - 1) if prev and prev.get("kind") != "router" and not prev.get("next") else "START")
        out.append(RouterSpec(name=_key(i), source=source, routes=routes,
                              default_target=target(fallback.get("target")) if fallback else "END",
                              description=s.get("text") or "", route_by=s.get("routeBy") or "rules"))
    return out


def to_agentflow(agent: dict[str, Any]) -> dict[str, Any]:
    tools = agent.get("tools") or []
    steps = agent.get("steps") or []
    work = [(i, s) for i, s in enumerate(steps, 1) if s.get("kind") != "router"]   # routers are edges in agentflow
    kind = agent.get("type") or "sequential"
    first = tools[0] if tools else DEFAULT_TOOL

    agents = [AgentSpec(name=_key(i), role=agent.get("role") or "", goal=agent.get("goal") or "",
                        system_prompt=agent.get("systemPrompt") or None,
                        tools=[_tool_name(s.get("tool") or first)], output_key=f"{_key(i)}_output")
              for i, s in work]
    if kind == "supervisor":
        agents.insert(0, AgentSpec(name="supervisor", role=agent.get("role") or "Supervisor",
                                   goal=agent.get("goal") or "", system_prompt=agent.get("systemPrompt") or None))

    flow = AgentFlow(
        framework="langgraph",
        meta=Meta(name=agent.get("name"), description=agent.get("description")),
        **({"provider": spec.provider} if (spec := _llm(agent)) else {}),
        config=LangGraphConfig(
            **({"llm_provider": spec} if spec else {}),
            process=kind if kind in TYPES else "sequential",
            max_iterations=int(agent.get("maxIterations") or 5),
            agents=agents,
            tasks=[TaskSpec(name=f"{_key(i)}_task", description=s.get("text", ""), agent=_key(i))
                   for i, s in work],
            routers=_routers(steps),
            tools=[ToolSpec(name=_tool_name(t), description=f"wellmonitoring tool {t.get('agent')} / {t.get('action')}",
                            agent=t.get("agent"), action=t.get("action")) for t in tools],
            state_channels=[StateChannelSpec(name=i["name"], type="str", description=i.get("description") or "")
                            for i in agent.get("inputs") or []],
        ),
    )
    out = flow.model_dump(mode="json", exclude_none=True)
    out["config"][EXTRA] = {
        "version": 1,
        "status": agent.get("status") or "draft",
        "steps": [{"key": _key(i), **s} for i, s in enumerate(steps, 1)],
        "tools": tools,
        "inputs": agent.get("inputs") or [],
        "outputs": agent.get("outputs") or [],
        "askData": agent.get("askData"),
    }
    return out


def from_agentflow(data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Returns (agent, warnings). Raises ValueError (with the schema's messages) for an invalid flow."""
    try:
        flow = AgentFlow.model_validate(data)
    except Exception as exc:  # pydantic.ValidationError: keep its field-level detail
        raise ValueError(f"Not a valid agentflow.json: {exc}") from exc
    if flow.framework != "langgraph":
        raise ValueError(f"Only LangGraph flows can be imported (this one is '{flow.framework}').")

    cfg, warnings = flow.config, []
    extra = (data.get("config") or {}).get(EXTRA) or {}
    kind = cfg.process if cfg.process in TYPES else "sequential"
    if cfg.process not in TYPES:
        warnings.append(f"Process '{cfg.process}' is not supported; imported as sequential.")
    for field, label in (("routers", "routers"), ("interrupts", "human-in-the-loop interrupts"),
                         ("subgraphs", "subgraphs")):
        if getattr(cfg, field) and not (field == "routers" and extra.get("steps")):
            warnings.append(f"The flow's {label} are not supported yet and were left out.")
    if cfg.map_reduce:
        warnings.append("The flow's map-reduce is not supported yet and was left out.")

    # Tools: ours are ToolSpecs carrying agent/action; others cannot run here.
    tool_by_name: dict[str, dict[str, str]] = {}
    for t in cfg.tools:
        extras = t.model_extra or {}
        if extras.get("agent"):
            tool_by_name[t.name] = {"agent": extras["agent"], "action": extras.get("action") or ""}
        else:
            warnings.append(f"Tool '{t.name}' is not a wellmonitoring tool and was left out.")
    tools = extra.get("tools") or list({(v["agent"], v["action"]): v for v in tool_by_name.values()}.values())
    if not tools:
        tools = [DEFAULT_TOOL]
        warnings.append("No usable tool in the flow; Ask Data (deep) was added.")

    workers = [a for a in cfg.agents if not (kind == "supervisor" and a is cfg.agents[0])]
    agent_tool = {a.name: next((tool_by_name[n] for n in a.tools if n in tool_by_name), None) for a in workers}
    if cfg.tasks:
        raw = [(t.description, agent_tool.get(t.agent or "")) for t in cfg.tasks]
    else:
        raw = [(a.goal or a.role or a.name, agent_tool.get(a.name)) for a in workers]
    saved_steps = extra.get("steps") or []
    layout = {s.get("key"): s for s in saved_steps}
    steps = []
    if saved_steps and all("text" in s for s in saved_steps):   # our own export: every step as it was, routers too
        steps = [{k: v for k, v in s.items() if k != "key"} for s in saved_steps]
        raw = []
    for i, (text, tool) in enumerate(raw, 1):
        saved = layout.get(_key(i)) or {}
        steps.append({"text": text, "tool": saved.get("tool", tool if tool and tool != tools[0] else None),
                      "id": saved.get("id"), "x": saved.get("x"), "y": saved.get("y")})
    if not steps:
        raise ValueError("The flow has no tasks or agents to turn into instructions.")

    lead = cfg.agents[0] if cfg.agents else None
    agent = {
        "name": flow.meta.name or "Imported agent",
        "description": flow.meta.description,
        "role": lead.role if lead else None,
        "goal": lead.goal if lead else None,
        "systemPrompt": lead.system_prompt if lead else None,
        "type": kind,
        "maxIterations": max(1, min(20, cfg.max_iterations)),
        "steps": steps,
        "tools": tools,
        "inputs": extra.get("inputs") or [{"name": c.name, "type": "string", "required": True,
                                           "description": c.description or None} for c in cfg.state_channels],
        "outputs": extra.get("outputs") or [],
        "status": "draft",
        "askData": extra.get("askData"),
    }
    return agent, warnings

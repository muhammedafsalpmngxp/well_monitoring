"""The tenant's model answers one instruction with a set of tools (LangGraph ReAct loop): custom Tool steps."""
from __future__ import annotations

from typing import Any

from app.models import Llm

MAX_TOOL_ROUNDS = 10


async def answer_with_tools(tools: list, text: str, history: list[dict[str, str]], llm: Llm, system: str,
                            label: str) -> tuple[str, list[str], list[dict[str, Any]]]:
    """(answer, names of the tools called, usage row)."""
    from langgraph.prebuilt import create_react_agent

    from app.askdata import llm as llm_module

    model = llm_module.chat_model(llm.provider, llm.base_url, llm.model, llm.api_key, llm.temperature, max_tokens=llm.max_tokens)
    agent = create_react_agent(model, tools, prompt=system or None)
    earlier = "\n\n".join(f"Q: {h['user']}\nA: {h['assistant']}" for h in history)
    question = (f"EARLIER RESULTS:\n{earlier}\n\n" if earlier else "") + f"INSTRUCTION: {text}"
    result = await agent.ainvoke({"messages": [("user", question)]}, {"recursion_limit": 2 * MAX_TOOL_ROUNDS + 1})
    messages = result["messages"]
    used = [c["name"] for m in messages for c in (getattr(m, "tool_calls", None) or [])]
    tokens = [getattr(m, "usage_metadata", None) or {} for m in messages]
    usage = [{"agent": f"agent_runtime.{label}", "model": llm.model, "calls": sum(1 for t in tokens if t),
              "input": sum(int(t.get("input_tokens", 0)) for t in tokens),
              "output": sum(int(t.get("output_tokens", 0)) for t in tokens)}]
    content = messages[-1].content
    return (content if isinstance(content, str) else str(content)), used, usage

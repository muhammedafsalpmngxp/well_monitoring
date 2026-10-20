"""One LLM call for an Agentic Feature, on the tenant's AI provider (askdata.llm.invoke: OpenAI-compatible, Azure,
Ollama; rejected optional parameters dropped and remembered). Each call is recorded in the request's usage as
``{"agent": "<feature>.<agent>", "model", "calls", "input", "output"}``; endpoints return it so the Tenant API can
log it against the tenant's quota."""
from __future__ import annotations

from app.askdata.llm import invoke
from app.features.common.context import current


class AiUnavailable(RuntimeError):
    """No AI provider was sent (the tenant has none active), message safe to show."""


def available() -> bool:
    return current().request.llm is not None


def chat(system: str, user: str, *, agent: str, temperature: float | None = 0.0, fast: bool = False,
         effort: str = "", verbosity: str = "", max_tokens: int | None = None, json_mode: bool = False) -> str:
    run = current()
    llm = run.request.llm
    if llm is None:
        raise AiUnavailable("No AI provider is active for this tenant. An admin can add one under Settings > AI Providers.")
    model, reply = invoke(llm, [("system", system), ("user", user)], temperature, fast, effort, verbosity,
                          max_tokens, json_mode)
    meta = getattr(reply, "usage_metadata", None) or {}
    run.usage.append({"agent": f"{run.feature}.{agent}", "model": model, "calls": 1,
                      "input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))})
    content = reply.content
    if isinstance(content, list):   # some providers return content parts
        content = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return content if isinstance(content, str) else str(content)

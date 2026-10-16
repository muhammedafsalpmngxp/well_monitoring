"""``chat(system, user, temperature, fast)`` for the ported nodes, on the tenant's AI provider.

Replaces twise's db_assistant llm_client + twise_common.llm.provider with the same behaviour:
  * the per-agent reasoning tuning table (effort, verbosity), main tier only and never for Ollama;
  * timeout 120 s and 2 provider retries (twise LLM_TIMEOUT / LLM_MAX_RETRIES);
  * a model that rejects temperature / verbosity / reasoning_effort gets ONE retry without it
    (remembered per model, so later calls do not pay the failed request again).
Same request shape as the Tenant API's OpenAiCompatibleChatClient ({base_url}/chat/completions, Bearer key
or Azure api-key header). The fast tier uses ``llm.fast_model`` when set, else the main model. Each call
is recorded in the run's usage, labelled by node (orchestrator, sql_author, ...).
"""
from __future__ import annotations

from functools import lru_cache

from app.askdata.settings import current_run

LLM_TIMEOUT = 120
LLM_MAX_RETRIES = 2

# twise db_assistant llm_client._AGENT_TUNING: (reasoning_effort, verbosity) per node, main tier only.
AGENT_TUNING: dict[str, tuple[str, str]] = {
    "sql_author": ("high", "low"),
    "verifier": ("high", "low"),
    "analysis": ("medium", "medium"),
    "synthesize": ("low", "medium"),
    "orchestrator": ("low", "low"),
}

# (model, parameter) pairs a model has rejected: not sent again.
_REJECTED: set[tuple[str, str]] = set()


@lru_cache(maxsize=32)
def chat_model(provider: str, base_url: str, model: str, api_key: str | None, temperature: float | None,
               effort: str = "", verbosity: str = ""):
    from langchain_openai import ChatOpenAI

    headers = {"api-key": api_key} if provider == "azure" and api_key else None
    kwargs: dict = {"temperature": temperature} if temperature is not None else {}
    if effort:
        kwargs["reasoning_effort"] = effort
    if verbosity:
        kwargs["verbosity"] = verbosity
    return ChatOpenAI(model=model, base_url=base_url.rstrip("/"), api_key=api_key or "none",
                      default_headers=headers, timeout=LLM_TIMEOUT, max_retries=LLM_MAX_RETRIES, **kwargs)


def invoke(llm, messages: list[tuple[str, str]], temperature: float | None, fast: bool = False,
           effort: str = "", verbosity: str = ""):
    """One call, retried once without the parameter the model rejected (twise provider.chat)."""
    model = (llm.fast_model or llm.model) if fast else llm.model
    if fast or llm.provider == "ollama":
        effort, verbosity = "", ""          # the fast tier and Ollama never get these
    if (model, "temperature") in _REJECTED:
        temperature = None
    if (model, "verbosity") in _REJECTED:
        verbosity = ""
    if (model, "reasoning_effort") in _REJECTED:
        effort = ""

    def call(t, e, v):
        return chat_model(llm.provider, llm.base_url, model, llm.api_key, t, e, v).invoke(messages)

    try:
        return model, call(temperature, effort, verbosity)
    except Exception as exc:  # noqa: BLE001
        text = str(exc).lower()
        if temperature is not None and "temperature" in text:
            _REJECTED.add((model, "temperature"))
            return model, call(None, effort, verbosity)
        if verbosity and "verbosity" in text:
            _REJECTED.add((model, "verbosity"))
            return model, call(temperature, effort, "")
        if effort and ("reasoning" in text or "effort" in text):
            _REJECTED.add((model, "reasoning_effort"))
            return model, call(temperature, "", verbosity)
        raise


def chat(system: str, user: str, temperature: float | None = 0.0, fast: bool = False) -> str:
    run = current_run()
    if run.llm is None:
        raise RuntimeError("No AI provider is active for this tenant. An admin can add one under AI Settings → AI Providers.")
    label = run.prompts.label(system)
    effort, verbosity = AGENT_TUNING.get(label, ("", ""))
    model, reply = invoke(run.llm, [("system", system), ("user", user)], temperature, fast, effort, verbosity)
    meta = getattr(reply, "usage_metadata", None) or {}
    run.usage.append({"agent": f"askdata.{label}", "model": model, "calls": 1,
                      "input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))})
    return reply.content if isinstance(reply.content, str) else str(reply.content)

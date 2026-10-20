"""``chat(system, user, temperature, fast)`` for the ported nodes, on the tenant's AI provider.

Replaces twise's db_assistant llm_client + twise_common.llm.provider with the same behaviour:
  * the per-agent reasoning tuning table (effort, verbosity), main tier only and never for Ollama;
  * timeout 120 s and 2 provider retries (twise LLM_TIMEOUT / LLM_MAX_RETRIES);
  * a model that rejects temperature / verbosity / reasoning_effort (or JSON mode) is asked again without
    it, once per rejected parameter (remembered per model, so later calls do not pay the failed request again).
Same request shape as the Tenant API's OpenAiCompatibleChatClient ({base_url}/chat/completions, Bearer key
or Azure api-key header). The fast tier uses ``llm.fast_model`` when set, else the main model. Each call
is recorded in the run's usage, labelled by node (orchestrator, sql_author, ...).
"""
from __future__ import annotations

import time

from functools import lru_cache

from app.askdata.settings import current_run
from app import trace

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
               effort: str = "", verbosity: str = "", max_tokens: int | None = None, json_mode: bool = False):
    from langchain_openai import ChatOpenAI

    headers = {"api-key": api_key} if provider == "azure" and api_key else None
    kwargs: dict = {"temperature": temperature} if temperature is not None else {}
    if effort:
        kwargs["reasoning_effort"] = effort
    if verbosity:
        kwargs["verbosity"] = verbosity
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    if json_mode:
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return ChatOpenAI(model=model, base_url=base_url.rstrip("/"), api_key=api_key or "none",
                      default_headers=headers, timeout=LLM_TIMEOUT, max_retries=LLM_MAX_RETRIES, **kwargs)


# A provider error that names one of these: the call is repeated without that parameter (remembered per model).
_OPTIONAL = (
    ("temperature", ("temperature",)),
    ("verbosity", ("verbosity",)),
    ("reasoning_effort", ("reasoning", "effort")),
    ("response_format", ("response_format", "json_object", "json mode")),
)


def invoke(llm, messages: list[tuple[str, str]], temperature: float | None, fast: bool = False,
           effort: str = "", verbosity: str = "", max_tokens: int | None = None, json_mode: bool = False):
    """One call. A model that rejects an optional parameter (temperature, verbosity, reasoning_effort, JSON mode) is
    asked again without it, as often as it rejects another one (twise provider.chat dropped them all at once)."""
    model = (llm.fast_model or llm.model) if fast else llm.model
    if fast or llm.provider == "ollama":
        effort, verbosity = "", ""          # the fast tier and Ollama never get these
    sent = {"temperature": temperature, "verbosity": verbosity, "reasoning_effort": effort, "response_format": json_mode}
    for name, _ in _OPTIONAL:
        if (model, name) in _REJECTED:
            sent[name] = None if name == "temperature" else ("" if name != "response_format" else False)

    started = time.perf_counter()
    while True:
        try:
            reply = chat_model(llm.provider, llm.base_url, model, llm.api_key, sent["temperature"],
                               sent["reasoning_effort"], sent["verbosity"], max_tokens,
                               bool(sent["response_format"])).invoke(messages)
            trace.llm(model, time.perf_counter() - started, getattr(reply, "usage_metadata", None), fast=fast)
            return model, reply
        except Exception as exc:  # noqa: BLE001
            text = str(exc).lower()
            rejected = next((name for name, words in _OPTIONAL
                             if sent[name] not in (None, "", False) and any(w in text for w in words)), None)
            if rejected is None:
                trace.llm(model, time.perf_counter() - started, None, fast=fast, error=exc)
                raise
            _REJECTED.add((model, rejected))
            sent[rejected] = None if rejected == "temperature" else ("" if rejected != "response_format" else False)


def chat(system: str, user: str, temperature: float | None = 0.0, fast: bool = False) -> str:
    run = current_run()
    if run.llm is None:
        raise RuntimeError("No AI provider is active for this tenant. An admin can add one under AI Settings → AI Providers.")
    label = run.prompts.label(system)
    effort, verbosity = AGENT_TUNING.get(label, ("", ""))
    with trace.label(f"askdata.{label}"):
        model, reply = invoke(run.llm, [("system", system), ("user", user)], temperature, fast, effort, verbosity)
    meta = getattr(reply, "usage_metadata", None) or {}
    run.usage.append({"agent": f"askdata.{label}", "model": model, "calls": 1,
                      "input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))})
    return reply.content if isinstance(reply.content, str) else str(reply.content)

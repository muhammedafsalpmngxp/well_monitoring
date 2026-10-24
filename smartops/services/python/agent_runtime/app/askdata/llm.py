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
from typing import Callable

from app.askdata.settings import current_run
from app import observability, trace

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
               effort: str = "", verbosity: str = "", max_tokens: int | None = None, json_mode: bool = False,
               stream_usage: bool = False):
    from langchain_openai import ChatOpenAI

    headers = {"api-key": api_key} if provider == "azure" and api_key else None
    kwargs: dict = {"temperature": temperature} if temperature is not None else {}
    if stream_usage:
        kwargs["stream_usage"] = True       # a streamed reply still reports its token counts (stream_options)
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
    ("stream_options", ("stream_options", "include_usage")),
)


def invoke(llm, messages: list[tuple[str, str]], temperature: float | None, fast: bool = False,
           effort: str = "", verbosity: str = "", max_tokens: int | None = None, json_mode: bool = False,
           on_delta: Callable[[str], None] | None = None):
    """One call. A model that rejects an optional parameter (temperature, verbosity, reasoning_effort, JSON mode) is
    asked again without it, as often as it rejects another one (twise provider.chat dropped them all at once).

    ``on_delta``: the reply is streamed, each piece of text passed to it as it arrives; the reply returned is the
    whole message, as without streaming. A provider that refuses streaming (an error naming it, before any text) is
    asked again without streaming, and remembered."""
    model = (llm.fast_model or llm.model) if fast else llm.model
    if fast or llm.provider == "ollama":
        effort, verbosity = "", ""          # the fast tier and Ollama never get these
    stream = on_delta is not None and (model, "stream") not in _REJECTED
    sent = {"temperature": temperature, "verbosity": verbosity, "reasoning_effort": effort, "response_format": json_mode,
            "stream_options": stream}
    for name, _ in _OPTIONAL:
        if (model, name) in _REJECTED:
            sent[name] = _DROPPED[name]

    started = time.perf_counter()
    while True:
        streamed = [False]
        try:
            chat = chat_model(llm.provider, llm.base_url, model, llm.api_key, sent["temperature"],
                              sent["reasoning_effort"], sent["verbosity"], max_tokens,
                              bool(sent["response_format"]), bool(stream and sent["stream_options"]))
            with observability.ai_call(trace.current_label() or "ai-call") as config:
                # config: the Langfuse handler when tracing is on; otherwise the call is made as it always was.
                reply = (_stream(chat, messages, on_delta, streamed, config) if stream
                         else chat.invoke(messages, config=config) if config else chat.invoke(messages))
            trace.llm(model, time.perf_counter() - started, getattr(reply, "usage_metadata", None), fast=fast)
            return model, reply
        except Exception as exc:  # noqa: BLE001
            text = str(exc).lower()
            rejected = next((name for name, words in _OPTIONAL
                             if sent[name] not in (None, "", False) and any(w in text for w in words)), None)
            if rejected is None and stream and not streamed[0] and "stream" in text:
                rejected = "stream"           # streaming refused before any text came: ask the ordinary way
            if rejected is None:
                trace.llm(model, time.perf_counter() - started, None, fast=fast, error=exc)
                raise
            _REJECTED.add((model, rejected))
            if rejected == "stream":
                stream = False
            else:
                sent[rejected] = _DROPPED[rejected]


#: What a rejected optional parameter is sent as from then on (nothing).
_DROPPED = {"temperature": None, "verbosity": "", "reasoning_effort": "", "response_format": False,
            "stream_options": False}


def _stream(chat, messages, on_delta: Callable[[str], None], streamed: list[bool], config: dict | None = None):
    """The streamed reply as one message (chunks added up, usage included), each text piece passed on as it comes."""
    reply = None
    for chunk in (chat.stream(messages, config=config) if config else chat.stream(messages)):
        reply = chunk if reply is None else reply + chunk
        piece = _text(chunk.content)
        if piece:
            streamed[0] = True
            on_delta(piece)
    if reply is None:
        raise RuntimeError("The AI service sent an empty stream.")
    return reply


def _text(content) -> str:
    if isinstance(content, list):   # some providers send content parts
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return content if isinstance(content, str) else str(content or "")


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

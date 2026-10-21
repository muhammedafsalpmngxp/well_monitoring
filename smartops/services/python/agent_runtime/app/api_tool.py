"""Custom Tool (agentflow ToolSpec, the AgenticUIFramework's Tool + REST API wizard) as a REST call: no generated code.

A step whose tool is ``api:<name>`` lets the tenant's model call that tool: it fills the parameters, the runtime makes
the request and the model answers from the response. ``{param}`` placeholders are filled in the URL (URL-encoded),
headers and body (JSON-encoded); parameters not used anywhere go into the query string for GET / DELETE.

Only https (http for localhost), and never a private, loopback or link-local address unless
AGENT_RUNTIME_ALLOW_PRIVATE_URLS=true: the runtime must not be a way into internal systems.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
import socket
from typing import Any, Iterator
from urllib.parse import quote, urlsplit

import httpx

from app.models import CustomTool, Llm

API = "api"
MAX_RESULT = 8000
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_TYPES: dict[str, type] = {"str": str, "int": int, "float": float, "bool": bool, "list": list, "dict": dict}


def private_allowed() -> bool:
    return os.environ.get("AGENT_RUNTIME_ALLOW_PRIVATE_URLS", "false").lower() in ("1", "true", "yes")


def check_url(url: str) -> None:
    """Raises ValueError for a URL the runtime must not call."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme not in ("https", "http") or not host:
        raise ValueError("The tool URL must be an absolute https URL.")
    if parts.scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("The tool URL must use https (http only for localhost).")
    if private_allowed():
        return
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, parts.port or 443)}
    except socket.gaierror as exc:
        raise ValueError(f"The tool host '{host}' could not be resolved.") from exc
    for a in addresses:
        ip = ipaddress.ip_address(a.split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError(f"The tool host '{host}' is on a private network, which tools may not call.")


def _fill(template: str, values: dict[str, Any], encode) -> str:
    return _PLACEHOLDER.sub(lambda m: encode(values[m.group(1)]) if m.group(1) in values else m.group(0), template)


def _pick(data: Any, path: str) -> Any:
    """``data.items[0].name`` style path into a JSON response."""
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path or ""):
        data = data[int(part[1:-1])] if part.startswith("[") else data[part]
    return data


def call(tool: CustomTool, args: dict[str, Any], transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """One request: {"status", "result"} (result is text, cut to MAX_RESULT). Raises ValueError for a refused URL."""
    values = {p.name: args.get(p.name) for p in tool.parameters if args.get(p.name) is not None}
    url = _fill(tool.url, values, lambda v: quote(str(v), safe=""))
    check_url(url)
    headers = {h.name: _fill(h.value, values, str) for h in tool.headers}
    if tool.auth_scheme != "none" and tool.auth_secret:
        if tool.auth_scheme == "bearer":
            headers["Authorization"] = f"Bearer {tool.auth_secret}"
        elif tool.auth_scheme == "basic":
            headers["Authorization"] = "Basic " + base64.b64encode(tool.auth_secret.encode()).decode()
        else:
            headers["X-Api-Key"] = tool.auth_secret
    used = set(_PLACEHOLDER.findall(tool.url + (tool.body or "") + "".join(h.value for h in tool.headers)))
    params = {k: v for k, v in values.items() if k not in used} if tool.method in ("GET", "DELETE") else None
    body = _fill(tool.body, values, json.dumps) if tool.body and tool.method in ("POST", "PUT", "PATCH") else None
    if body is not None:
        headers.setdefault("Content-Type", "application/json")
    with httpx.Client(timeout=tool.timeout, transport=transport, follow_redirects=False) as client:
        r = client.request(tool.method, url, headers=headers, params=params, content=body)
    if r.status_code >= 400:
        return {"status": r.status_code, "result": f"HTTP {r.status_code}: {r.text[:500]}"}
    try:
        data: Any = _pick(r.json(), tool.response_path) if tool.response_path else r.json()
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, default=str)
    except (ValueError, KeyError, IndexError, TypeError):
        text = r.text
    return {"status": r.status_code, "result": text[:MAX_RESULT]}


def as_langchain_tool(tool: CustomTool):
    """The tool as the model sees it: name, description and typed parameters."""
    from langchain_core.tools import StructuredTool
    from pydantic import Field, create_model

    fields = {p.name: ((_TYPES[p.type] if p.required else _TYPES[p.type] | None),
                       Field(... if p.required else None, description=p.description)) for p in tool.parameters}
    schema = create_model(f"{tool.name}_args", **fields)

    def run(**kwargs: Any) -> str:
        try:
            return call(tool, kwargs)["result"]
        except (ValueError, httpx.HTTPError) as exc:
            return f"The call failed: {exc}"
    return StructuredTool.from_function(func=run, name=tool.name, description=tool.description or tool.name, args_schema=schema)


def run_step(tool: CustomTool, text: str, history: list[dict[str, str]], llm: Llm | None, system: str) -> Iterator[dict[str, Any]]:
    """Step events for one instruction answered with this tool."""
    import asyncio

    from app.tool_loop import answer_with_tools

    if llm is None:
        yield {"event": "error", "data": {"message": "No AI provider is active. An admin can add one under AI Settings."}}
        return
    yield {"event": "status", "data": {"stage": f"Using {tool.name}"}}
    answer, used, usage = asyncio.run(answer_with_tools([as_langchain_tool(tool)], text, history, llm, system, f"tool.{tool.name}"))
    yield {"event": "done", "data": {"answer": answer, "tools_used": used, "usage": usage}}

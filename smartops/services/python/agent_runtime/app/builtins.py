"""Built-in tools from the AgenticUIFramework palette, run on the tenant's model (no ADK, no generated code).

  url_context     reads the http(s) URLs written in the instruction and answers from their text
  load_memory     answers from the agent's memories that match the instruction
  preload_memory  answers with all of the agent's memories as context
  exit_loop       in a loop agent: the model judges whether the goal is met; if so the loop ends at this step

Memories are short facts kept per saved agent by the Tenant API: they come in with the run, and after a run of an
agent that uses memory the model picks up to three new facts to keep (``remember``).
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any, Callable, Iterator
from urllib.parse import urljoin

import httpx

from app import api_tool
from app.models import Llm

URL_CONTEXT, LOAD_MEMORY, PRELOAD_MEMORY, EXIT_LOOP = "url_context", "load_memory", "preload_memory", "exit_loop"
APPROVAL = "approval"
MEMORY = (LOAD_MEMORY, PRELOAD_MEMORY)
MAX_URLS, MAX_PAGE_TEXT, MAX_BYTES, MAX_REDIRECTS = 3, 6000, 2_000_000, 3
_URL = re.compile(r"https?://[^\s<>\"'`)\]]+")
_WORD = re.compile(r"[a-z0-9]{3,}")

TOOLS = [
    {"agent": URL_CONTEXT, "title": "URL Context (built-in)", "ready": True, "capabilities": ["read"],
     "description": "Fetches the URLs written in the instruction and answers from their text (https only, no "
                    "private network addresses)."},
    {"agent": LOAD_MEMORY, "title": "Load Memory (built-in)", "ready": True, "capabilities": ["search"],
     "description": "Reads the agent's long-term memories that match the instruction into the prompt."},
    {"agent": PRELOAD_MEMORY, "title": "Preload Memory (built-in)", "ready": True, "capabilities": ["all"],
     "description": "Gives the model all stored memories as context. Useful for small memory banks."},
    {"agent": EXIT_LOOP, "title": "Exit Loop (built-in)", "ready": True, "capabilities": ["check"],
     "description": "In a Loop agent: the model checks whether the goal is met and, if so, ends the loop here."},
    {"agent": APPROVAL, "title": "Human Approval (built-in)", "ready": True, "capabilities": ["review"],
     "description": "Pauses the run and shows the latest answer to a person, who approves, edits or rejects it."},
]

Chat = Callable[[Llm, list[tuple[str, str]]], tuple[str, dict[str, int]]]
NO_MODEL = {"event": "error", "data": {"message": "No AI provider is active. An admin can add one under AI Settings."}}


class _Text(HTMLParser):
    """Visible text of an HTML page (no scripts, styles or markup)."""
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("script", "style", "noscript", "svg", "head"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg", "head") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def fetch_text(url: str, transport: httpx.BaseTransport | None = None) -> str:
    """The page's text, cut to MAX_PAGE_TEXT. Every hop (redirects too) passes the Tool URL guard."""
    with httpx.Client(timeout=20, transport=transport, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            api_tool.check_url(url)
            r = client.get(url, headers={"User-Agent": "TWise-Agent/1.0"})
            if r.is_redirect and r.headers.get("location"):
                url = urljoin(url, r.headers["location"])
                continue
            if r.status_code >= 400:
                return f"(HTTP {r.status_code})"
            body = r.content[:MAX_BYTES].decode(r.encoding or "utf-8", errors="replace")
            if "html" in r.headers.get("content-type", ""):
                p = _Text()
                p.feed(body)
                body = " ".join(p.parts)
            return re.sub(r"\s+", " ", body)[:MAX_PAGE_TEXT]
    return "(too many redirects)"


def _answer(llm: Llm, chat: Chat, system: str, context: str, text: str, history: list[dict[str, str]], agent: str):
    earlier = "\n\n".join(f"Q: {h['user']}\nA: {h['assistant']}" for h in history)
    answer, tokens = chat(llm, [("system", system), ("user", (f"EARLIER RESULTS:\n{earlier}\n\n" if earlier else "")
                                                      + f"{context}\n\nINSTRUCTION: {text}")])
    return {"event": "done", "data": {"answer": answer, "usage": [{"agent": f"agent_runtime.{agent}", "model": llm.model,
                                                                    "calls": 1, **tokens}]}}


def url_context(text: str, history: list[dict[str, str]], llm: Llm | None, chat: Chat, system: str,
                transport: httpx.BaseTransport | None = None) -> Iterator[dict[str, Any]]:
    if llm is None:
        yield NO_MODEL
        return
    urls = list(dict.fromkeys(u.rstrip(".,;:") for u in _URL.findall(text)))[:MAX_URLS]
    if not urls:
        yield {"event": "error", "data": {"message": "URL Context needs the page address (https://…) in the instruction."}}
        return
    pages, failed = [], []
    for u in urls:
        yield {"event": "status", "data": {"stage": f"Reading {u[:80]}"}}
        try:
            pages.append(f"PAGE {u}:\n{fetch_text(u, transport)}")
        except (ValueError, httpx.HTTPError) as exc:
            failed.append(f"{u}: {exc}")
            pages.append(f"PAGE {u}: not read — {exc}")
    if len(failed) == len(urls):
        # Nothing to answer from: the step fails (and is retried when it has retries).
        yield {"event": "error", "data": {"message": "No page could be read. " + "; ".join(failed)[:800]}}
        return
    yield {"event": "status", "data": {"stage": "Thinking"}}
    yield _answer(llm, chat, system + "\nAnswer from the pages below; say when a page could not be read.",
                  "\n\n".join(pages), text, history, URL_CONTEXT)


def relevant(memories: list[str], text: str, k: int = 5) -> list[str]:
    """The memories sharing the most words with the instruction (newest first on ties)."""
    words = set(_WORD.findall(text.lower()))
    scored = [(len(words & set(_WORD.findall(m.lower()))), -i, m) for i, m in enumerate(memories)]
    return [m for score, _, m in sorted(scored, reverse=True) if score > 0][:k]


def memory(kind: str, memories: list[str], text: str, history: list[dict[str, str]], llm: Llm | None, chat: Chat,
           system: str) -> Iterator[dict[str, Any]]:
    if llm is None:
        yield NO_MODEL
        return
    picked = relevant(memories, text) if kind == LOAD_MEMORY else memories
    context, size = [], 0
    for m in picked:   # newest first; keep the prompt bounded
        size += len(m)
        if size > 8000:
            break
        context.append(f"- {m}")
    yield {"event": "status", "data": {"stage": f"Using {len(context)} memories"}}
    yield _answer(llm, chat, system + "\nUse the agent's memories below where they help; say when they do not cover it.",
                  "MEMORIES:\n" + ("\n".join(context) or "(none yet)"), text, history, kind)


def judge_goal(llm: Llm, chat: Chat, profile: str, progress: str) -> tuple[bool, str, dict[str, int]]:
    """Exit Loop: whether the results so far meet the goal."""
    system = "\n".join(p for p in [profile, "You decide whether an agent in a loop can stop: do the results so far meet the goal?",
                                   'Reply with JSON only: {"done": true|false, "reason": "<one sentence>"}'] if p)
    reply, tokens = chat(llm, [("system", system), ("user", progress)])
    try:
        decision = json.loads(reply[reply.find("{"): reply.rfind("}") + 1])
    except ValueError:
        decision = {}
    return decision.get("done") is True, str(decision.get("reason") or ""), tokens


def remember(llm: Llm, chat: Chat, memories: list[str], inputs: dict[str, str], results: list[dict[str, Any]],
             answer: str) -> tuple[list[str], dict[str, int]]:
    """Up to three new facts from this run worth keeping (not already in memory)."""
    known = "\n".join(f"- {m}" for m in memories[:50]) or "(none)"
    run = "\n".join([f"INPUTS: {json.dumps(inputs)}"] + [f"Q: {r['question']}\nA: {r['answer']}" for r in results if r.get("ok")]
                    + [f"FINAL ANSWER: {answer}"])
    reply, tokens = chat(llm, [
        ("system", "You keep an agent's long-term memory. From the run below pick at most 3 short, lasting facts worth "
                   "remembering for later runs (names, numbers, preferences, findings). Skip anything already known or "
                   'temporary. Reply with JSON only: {"facts": ["...", ...]}'),
        ("user", f"ALREADY KNOWN:\n{known}\n\nRUN:\n{run[:12000]}")])
    try:
        facts = json.loads(reply[reply.find("{"): reply.rfind("}") + 1]).get("facts") or []
    except (ValueError, AttributeError):
        facts = []
    seen = {m.strip().lower() for m in memories}
    return [f.strip()[:1000] for f in facts if isinstance(f, str) and f.strip() and f.strip().lower() not in seen][:3], tokens

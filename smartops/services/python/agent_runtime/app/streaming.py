"""Server-sent events shared by the agent runs, Ask Data and the Agentic Features (app/features)."""
from __future__ import annotations

import contextvars
import json
import queue
import threading
from typing import Any, Iterator


def sse(name: str, data: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


def with_heartbeat(events: Iterator[tuple[str, dict[str, Any]]], every: float = 15.0) -> Iterator[tuple[str, dict[str, Any]]]:
    """Runs the events on a thread and sends "ping" when nothing came for `every` seconds: a step can wait minutes
    on the AI provider, and an idle stream is cut by proxies and browsers.
    When the caller stops reading (the page closed, the Tenant API cancelled the test), the run stops at its next
    event instead of going on calling the model, the database and twise for nobody."""
    items: queue.Queue = queue.Queue()
    end = object()
    stop = threading.Event()

    def pump() -> None:
        try:
            for item in events:
                if stop.is_set():
                    break
                items.put(item)
        finally:
            close = getattr(events, "close", None)
            if close:
                close()   # GeneratorExit inside run_events ends graph.stream: no further steps start
            items.put(end)

    # The thread runs in a copy of the caller's context: an Agentic Feature's run (app.features.common.context) is a
    # ContextVar, and its steps read it.
    threading.Thread(target=contextvars.copy_context().run, args=(pump,), daemon=True).start()
    try:
        while True:
            try:
                item = items.get(timeout=every)
            except queue.Empty:
                yield "ping", {}
                continue
            if item is end:
                return
            yield item
    finally:
        stop.set()

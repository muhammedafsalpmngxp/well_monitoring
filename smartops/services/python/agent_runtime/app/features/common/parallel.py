"""Running independent pieces of one request at the same time.

The pieces are database look-ups (pyodbc releases the GIL while SQL Server works, so threads overlap the waits) and
the tools built on them. Each piece runs in a copy of the caller's context, so the request's FeatureRun (a ContextVar)
is there. Results come back in the order given; a piece that raised gives its exception in its place, so one failed
look-up never hides the others.
"""
from __future__ import annotations

import contextvars
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, List, Sequence, TypeVar, Union

T = TypeVar("T")


def run_parallel(pieces: Sequence[Callable[[], T]], workers: int) -> List[Union[T, BaseException]]:
    """Each piece's result (or the exception it raised), in order. workers <= 1, or one piece: run in turn here."""
    if workers <= 1 or len(pieces) <= 1:
        return [_settle(piece) for piece in pieces]
    with ThreadPoolExecutor(max_workers=min(workers, len(pieces)), thread_name_prefix="feature") as pool:
        futures = [pool.submit(contextvars.copy_context().run, _settle, piece) for piece in pieces]
        return [f.result() for f in futures]


def _settle(piece: Callable[[], T]) -> Union[T, BaseException]:
    try:
        return piece()
    except Exception as exc:  # noqa: BLE001 - returned to the caller, which decides
        return exc

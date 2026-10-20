"""Stream a probe's findings to disk instead of holding them in memory (ported from the original report/spool.py).

Word wants the worst few thousand rows in memory; Excel wants EVERY row up to a million. So each rule's rows are
written straight through to its own JSON-Lines file as they are fetched, and only the Word cap stays in memory. The
directory is a per-run temporary directory, deleted once the reports are built.
"""
from __future__ import annotations

import datetime as dt
import decimal
import json
import logging
import os
from typing import Any, Iterator

log = logging.getLogger("agent_runtime.anomaly")


def jsonable(value: Any) -> Any:
    """How a database value becomes a spooled value: numbers stay numbers (Excel sorts them), dates and decimals
    become text HERE so the Word table and the Excel sheet can never disagree."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<{len(bytes(value))} bytes>"
    return str(value)


def _safe_name(rule_id: str) -> str:
    keep = [c if (c.isalnum() or c in "-_.") else "_" for c in rule_id]
    return "".join(keep)[:80] or "rule"


class Spool:
    """Append-only writer for one rule's findings."""

    def __init__(self, directory: str, rule_id: str, columns: list[str]) -> None:
        os.makedirs(directory, exist_ok=True)
        self.path = os.path.join(directory, f"{_safe_name(rule_id)}.jsonl")
        self.columns = columns
        self.rows_written = 0
        self._fh = open(self.path, "w", encoding="utf-8")

    def write(self, row: list[Any]) -> None:
        self._fh.write(json.dumps([jsonable(v) for v in row], ensure_ascii=False))
        self._fh.write("\n")
        self.rows_written += 1

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:  # noqa: BLE001 - closing a spool must never fail a run
            pass


def read_rows(path: str) -> Iterator[list[Any]]:
    """Stream a spool file back; an incomplete final line (an interrupted write) ends the stream quietly."""
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                return

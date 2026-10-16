"""Dead-letter writer: persist rejected rows as JSONL for investigation."""

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("smartops.etl.dead_letter")


class DeadLetterWriter:
    """
    Writes rejected rows to JSONL files: dead_letter/run_{id}_{entity}.jsonl
    Each line: {"row": {...}, "reason": "...", "ts": "..."}

    Use as a context manager:
        with DeadLetterWriter(run_id) as dl:
            dl.reject("[ref].[Cluster]", row, "missing: cluster_code")
    """

    def __init__(self, run_id: int | None, output_dir: Path) -> None:
        self._run_id = run_id or 0
        self._dir    = output_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        self._handles: dict[str, Any] = {}
        self._counts:  dict[str, int] = {}

    def reject(self, sql_table: str, row: dict, reason: str) -> None:
        """Append one rejected row to the entity's dead-letter file."""
        # Count rejection
        self._counts.setdefault(sql_table, 0)
        self._counts[sql_table] += 1

        # Write JSONL record
        if sql_table not in self._handles:
            safe = re.sub(r"[\[\]\. ]", "_", sql_table).strip("_")
            path = self._dir / f"run_{self._run_id}_{safe}.jsonl"
            self._handles[sql_table] = open(path, "a", encoding="utf-8")

        payload = {
            "row": row,
            "reason": reason,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        self._handles[sql_table].write(json.dumps(payload, default=str) + "\n")

    def summary(self) -> dict[str, int]:
        """Return {sql_table: rejected_count}."""
        return dict(self._counts)

    def close(self) -> None:
        """Flush and close all open file handles."""
        for fh in self._handles.values():
            try:
                fh.flush()
                fh.close()
            except OSError:
                pass
        self._handles.clear()

    def __enter__(self) -> "DeadLetterWriter":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

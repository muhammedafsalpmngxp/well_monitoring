"""The Ask Data system prompts for ONE agent (twise db_assistant/src/prompts/system_prompts.py, per agent).

Composition is unchanged: the static texts, the MAX_ROWS substitution and the business-rules / few-shots
injection. The texts come from ``prompt_files/<name>/v1.txt``, or, with ASKDATA_PROMPT_STORE=db, from the
config table ``<ASKDATA_PROMPT_SCHEMA>.prompt`` (task ``db_assistant/<name>``: the active version, else v1;
a task the table does not hold, or every task when it cannot be read, comes from the files) - twise's
prompt_service. BUSINESS_RULES and FEW_SHOTS come from the agent's Knowledge Source (default: the files in
ASKDATA_KNOWLEDGE_DIR, else knowledge_default/). {{ORG_NAME}} in a prompt is ASKDATA_ORG_NAME. The SQL safety rules
are not editable.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.askdata.settings import current_run

_DIR = Path(__file__).resolve().parent
# The Knowledge Source used when an agent leaves it blank, and the organisation the assistant speaks for, are
# deployment settings: the shipped files are Al Tasnim's (the deployment this was built for).
_KNOWLEDGE = Path(os.environ.get("ASKDATA_KNOWLEDGE_DIR") or _DIR / "knowledge_default")
ORG_NAME = os.environ.get("ASKDATA_ORG_NAME", "Al-Tasnim")


log = logging.getLogger("askdata.prompts")
_NAMES = ("platform_preamble", "answer_rules", "sql_knowledge", "sql_rules", "orchestrator_system", "planner_system",
          "sql_author_system", "analysis_system", "synthesize_system", "verifier_system", "chitchat_system")
# Read once per process, like twise's prompts at import: {name: text} from the config table.
_DB_PROMPTS: dict[str, str] | None = None


def load_db_prompts() -> None:
    """With ASKDATA_PROMPT_STORE=db, read the prompt table once (inside a run: it uses the run's database)."""
    global _DB_PROMPTS
    if _DB_PROMPTS is not None or os.environ.get("ASKDATA_PROMPT_STORE", "file").lower() != "db":
        return
    _DB_PROMPTS = {}
    schema = os.environ.get("ASKDATA_PROMPT_SCHEMA", "twise")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", schema):
        log.warning("ASKDATA_PROMPT_SCHEMA is not a plain identifier; prompts come from the files")
        return
    try:
        from app.askdata.common.connection import get_connection
        conn = get_connection(readonly=True)
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT task, version, body, is_active FROM [{schema}].[prompt] WHERE task LIKE 'db_assistant/%'")
            rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 - as twise: an unreachable table means the files
        log.warning("prompt table not readable (%s); prompts come from the files", exc)
        return
    by_task: dict[str, dict[str, str]] = {}
    active: dict[str, str] = {}
    for task, version, body, is_active in rows:
        name = str(task).split("/", 1)[1]
        by_task.setdefault(name, {})[str(version)] = str(body)
        if is_active:
            active[name] = str(version)
    for name in _NAMES:
        text = by_task.get(name, {}).get(active.get(name, "v1"))
        if text is not None:
            _DB_PROMPTS[name] = text.strip()
    log.info("prompts from the config table: %s", ", ".join(sorted(_DB_PROMPTS)) or "none")


def _load(name: str) -> str:
    if _DB_PROMPTS and name in _DB_PROMPTS:
        text = _DB_PROMPTS[name]
    else:
        text = (_DIR / "prompt_files" / name / "v1.txt").read_text(encoding="utf-8").strip()
    return text.replace("{{ORG_NAME}}", ORG_NAME)   # a placeholder no column or table name can match


def default_knowledge(filename: str) -> str:
    path = _KNOWLEDGE / filename
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


@dataclass(frozen=True)
class PromptSet:
    ORCHESTRATOR_SYSTEM: str
    PLANNER_SYSTEM: str
    SQL_AUTHOR_SYSTEM: str
    ANALYSIS_SYSTEM: str
    SYNTHESIZE_SYSTEM: str
    VERIFIER_SYSTEM: str
    CHITCHAT_SYSTEM: str

    def label(self, system: str) -> str:
        """Which node a call is for, by prompt identity (as twise's llm_client does)."""
        for name, value in self.__dict__.items():
            if value is system:
                return name.removesuffix("_SYSTEM").lower()
        return "agent"


@lru_cache(maxsize=32)
def build_prompts(max_rows: int, business_rules: str, few_shots: str) -> PromptSet:
    def limits(text: str) -> str:
        return text.replace("MAX_ROWS", str(max_rows))

    preamble = _load("platform_preamble")
    answer_rules = _load("answer_rules")
    answer_tail = f"{answer_rules}\n\n{business_rules}" if business_rules else answer_rules

    sql_author = _load("sql_author_system")
    for slot, value in (("{PLATFORM_PREAMBLE}", preamble), ("{SQL_KNOWLEDGE}", limits(_load("sql_knowledge"))),
                        ("{BUSINESS_RULES}", business_rules), ("{SQL_RULES}", _load("sql_rules")),
                        ("{FEW_SHOTS}", few_shots)):
        sql_author = sql_author.replace(slot, value)

    return PromptSet(
        ORCHESTRATOR_SYSTEM=preamble + "\n\n" + _load("orchestrator_system"),
        PLANNER_SYSTEM=_load("planner_system"),
        SQL_AUTHOR_SYSTEM=sql_author.strip(),
        ANALYSIS_SYSTEM=preamble + "\n\n" + _load("analysis_system") + "\n\n" + answer_tail,
        SYNTHESIZE_SYSTEM=preamble + "\n\n" + _load("synthesize_system") + "\n\n" + answer_tail,
        VERIFIER_SYSTEM=limits(preamble + "\n\n" + _load("verifier_system") + "\n\n" + answer_tail),
        CHITCHAT_SYSTEM=_load("chitchat_system"),
    )


def current_prompts() -> PromptSet:
    return current_run().prompts

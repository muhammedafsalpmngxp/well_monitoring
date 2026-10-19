"""Before the steps run: read the inputs from the user's question, then run the setup step.

Question. An agent with an input named "question" lets people ask in their own words. One call on the tenant's
fast model (agent.extract_inputs / agent.extract_input, core.AiPrompt) reads the agent's OTHER inputs from it: the
model only fills in values, it never writes SQL or figures. An input the person typed in is never replaced, and a
value that does not fit the input's type (a number input given "next week") is dropped and noted.

Setup. When the first step's kind is "setup" (Saved SQL only), it runs before every other step. Its first row's
columns named like inputs set those inputs for the rest of the run: a missing date becomes the latest report date,
a well id is checked against the live wells, and so on. No row stops the run with a message, so the other steps
never run on an input that does not exist. The setup step keeps its number (step 1); the rest start at 2.

Both report what they set with an "inputs" event ({by, values, note}), shown on the page as "Understood as".
"""
from __future__ import annotations

import datetime
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from app import sqlstep
from app.graph import EXTRACT_KEYS, RunSql, Texts, fill
from app.models import AgentConfig, Llm
from app.prompt_text import fill as fill_prompt, missing as missing_prompts, text as prompt

QUESTION = "question"
Chat = Callable[[Llm, list[tuple[str, str]]], tuple[str, dict[str, int]]]
_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def asks_question(cfg: AgentConfig) -> bool:
    return any(i.name == QUESTION for i in cfg.inputs)


def extract(cfg: AgentConfig, question: str, llm: Llm, texts: Texts, chat: Chat | None = None,
            today: str | None = None, only: set[str] | None = None) -> tuple[dict[str, str], str, list[dict[str, Any]]]:
    """The values the question gives for the agent's other inputs (`only` = just these), a note on anything unclear,
    and the usage row."""
    from app.askdata.common.text import extract_json

    wanted = [i for i in cfg.inputs if i.name != QUESTION and (only is None or i.name in only)]
    if not wanted:
        return {}, "", []
    lines = "\n".join(fill_prompt(prompt(texts, "agent.extract_input"), NAME=i.name, TYPE=i.type or "string",
                                  DESCRIPTION=(i.description or "").strip() or "-") for i in wanted)
    system = fill_prompt(prompt(texts, "agent.extract_inputs"), INPUTS=lines,
                         TODAY=today or datetime.date.today().isoformat())
    reply, tokens = (chat or _fast_chat)(llm, [("system", system), ("user", question)])
    parsed = extract_json(reply, default={})
    raw = parsed.get("values") if isinstance(parsed.get("values"), dict) else {}
    note = str(parsed.get("note") or "").strip()
    values, dropped = {}, []
    for i in wanted:
        v = str(raw.get(i.name) if raw.get(i.name) is not None else "").strip()
        if not v:
            continue
        if i.type == "number":
            v = v.replace(",", "")
            if not _NUMBER.match(v):
                dropped.append(i.name)
                continue
        values[i.name] = v
    if dropped:
        note = " ".join(p for p in [note, f"Not a number, so left blank: {', '.join(dropped)}."] if p)
    model = llm.fast_model or llm.model
    return values, note, [{"agent": "agent_runtime.inputs", "model": model, "calls": 1, **tokens}]


def _fast_chat(llm: Llm, messages: list[tuple[str, str]]) -> tuple[str, dict[str, int]]:
    from app.askdata.llm import invoke

    _, reply = invoke(llm, messages, temperature=0.0, fast=True)
    meta = getattr(reply, "usage_metadata", None) or {}
    return str(reply.content), {"input": int(meta.get("input_tokens", 0)), "output": int(meta.get("output_tokens", 0))}


@dataclass
class Prepared:
    """What the run starts from once the question and the setup step are done."""
    cfg: AgentConfig                      # the agent without its setup step
    inputs: dict[str, str]
    first: int = 1                        # the number of the first remaining step
    usage: list[dict[str, Any]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)   # the setup step's result, for the run record
    error: str | None = None


def prepare(cfg: AgentConfig, inputs: dict[str, str], llm: Llm | None, texts: Texts, out: Prepared,
            chat: Chat | None = None, run_sql: RunSql | None = None) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yields the events of both phases and fills `out`; out.error set means the run must stop with it."""
    values = dict(inputs)
    question = (values.get(QUESTION) or "").strip()
    # Only the inputs left blank are read from the question: with none (an agent whose only input is the question, as
    # Ask Data agents often have, or every field typed in) no call is made and nothing is reported.
    blank = {i.name for i in cfg.inputs if i.name != QUESTION and not (values.get(i.name) or "").strip()}
    if question and asks_question(cfg) and blank:
        if llm is None:
            yield "status", {"stage": "No AI provider is active, so the question was not read; using the inputs as entered"}
        elif absent := missing_prompts(texts, EXTRACT_KEYS):
            out.error = ("The question cannot be read: these AI prompts are not configured for this tenant: "
                         f"{', '.join(absent)}. An admin can restore them under Settings > AI Prompts.")
            return
        else:
            yield "status", {"stage": "Reading your question"}
            try:
                found, note, usage = extract(cfg, question, llm, texts, chat, only=blank)
            except Exception as exc:  # noqa: BLE001 - the provider or its reply
                out.error = f"The question could not be read: {exc}"[:1000]
                return
            out.usage += usage
            set_now = {k: v for k, v in found.items() if not (values.get(k) or "").strip()}
            values.update(set_now)
            yield "inputs", {"by": "question", "values": set_now, "note": note}

    out.cfg, out.inputs = cfg, values
    if cfg.steps[0].kind != "setup":
        return
    setup, tool = cfg.steps[0], cfg.steps[0].tool or cfg.tools[0]
    out.cfg = cfg.model_copy(update={"steps": cfg.steps[1:]})
    out.first = 2
    found = sqlstep.problems(setup.sql, tool.action, {i.name for i in cfg.inputs})
    if found:
        out.error = f"Step 1 ('{setup.text[:40]}') is the setup step: " + "; ".join(found) + "."
        return
    question_text = fill(setup.text, values)
    yield "step", {"step": 1, "attempt": 1, "phase": "start", "question": question_text, "agent": tool.agent,
                   "action": tool.action, "setup": True}
    started, data, error = time.monotonic(), {}, None
    try:
        for ev in run_sql(setup.sql or "", tool.action, values):
            if ev["event"] == "status" and (ev.get("data") or {}).get("stage"):
                yield "status", {"step": 1, "stage": ev["data"]["stage"]}
            elif ev["event"] == "done":
                data = ev.get("data") or {}
            elif ev["event"] == "error":
                error = (ev.get("data") or {}).get("message") or "The setup query failed."
    except Exception as exc:  # noqa: BLE001 - the database
        error = f"sql_query failed: {exc}"[:1000]
    table = data.get("data") or {}
    rows, columns = table.get("rows") or [], table.get("columns") or []
    result = {"step": 1, "attempt": 1, "question": question_text, "agent": tool.agent, "action": tool.action,
              "answer": data.get("answer") or "", "sql": [s["sql"] for s in data.get("steps") or [] if s.get("sql")],
              "ok": error is None and bool(rows), "error": error, "seconds": round(time.monotonic() - started, 1),
              "setup": True, **({"data": table} if table else {})}
    if error is None and not rows:
        given = ", ".join(f"{k} = {v}" for k, v in values.items() if k != QUESTION and v)
        result["error"] = error = ("The setup query found nothing for these inputs"
                                   + (f" ({given})" if given else "") + ". Check them and run again.")
    yield "step", {**result, "phase": "end"}
    out.steps.append(result)
    if error:
        out.error = error
        return
    names = {i.name for i in cfg.inputs} - {QUESTION}
    first_row = dict(zip(columns, rows[0]))
    resolved = {c: ("" if v is None else str(v)) for c, v in first_row.items() if c in names}
    values.update(resolved)
    out.inputs = values
    yield "inputs", {"by": "setup", "values": resolved, "note": ""}

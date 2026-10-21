"""Built-in steps that check or shape the answers: Evaluator, Guardrail, Compute and Merge.

  evaluator  the model checks the latest answer (or the one named with {{key}}) against the instruction's criteria;
             on fail the run goes back to an earlier step (options.retryFrom, default the previous one) at most
             max_iterations times, then carries on
  guardrail  checks the inputs or the latest answer: personal data (options.pii), blocked words (options.blocked),
             and an AI policy (options.policy, when written); options.action "block" stops the run, "warn" goes on.
             The instruction only describes the check.
  compute    no AI: options.mode "template" (the filled instruction), "pick" (options.source key + options.path
             into its JSON) or "math" (the instruction as arithmetic over numbers from {{keys}})
  merge      no AI: the answers of options.keys (default every earlier step) under headings
"""
from __future__ import annotations

import ast
import json
import operator
import re
from typing import Any, Iterator
from app.prompt_text import fill, text as prompt

EVALUATOR, GUARDRAIL, COMPUTE, MERGE = "evaluator", "guardrail", "compute", "merge"

TOOLS = [
    {"agent": EVALUATOR, "title": "Evaluator (built-in)", "ready": True, "capabilities": ["check"],
     "description": "Checks the latest answer against your criteria; if it fails, the run goes back to an earlier step."},
    {"agent": GUARDRAIL, "title": "Guardrail (built-in)", "ready": True, "capabilities": ["check"],
     "description": "Checks inputs or the answer for personal data, blocked words or a policy; stops or warns."},
    {"agent": COMPUTE, "title": "Compute (built-in, no AI)", "ready": True, "capabilities": ["run"],
     "description": "A template, a field picked from JSON, or arithmetic over earlier answers. No model call."},
    {"agent": MERGE, "title": "Merge (built-in, no AI)", "ready": True, "capabilities": ["join"],
     "description": "Joins earlier answers under headings. No model call."},
]

_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")
PII = {
    "an e-mail address": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "a card number": re.compile(r"\b(?:\d[ -]?){13,16}\b"),
    "a phone number": re.compile(r"(?<!\w)\+?\d[\d\s-]{7,}\d(?!\w)"),
}


def judge(llm, chat, criteria: str, answer: str, texts=None) -> tuple[bool, str, dict[str, int]]:
    """Whether the answer meets the criteria, by the model at temperature 0 (prompts agent.evaluator*)."""
    from app.askdata.common.text import extract_json
    user = fill(prompt(texts, "agent.evaluator_message"), CRITERIA=criteria, ANSWER=answer[:20000])
    reply, tokens = chat(llm.model_copy(update={"temperature": 0}), [("system", prompt(texts, "agent.evaluator")), ("user", user)])
    v = extract_json(reply, default={})
    v = v if isinstance(v, dict) else {}
    return v.get("pass") is True, str(v.get("reason") or reply)[:500], tokens


def violations(text: str, options: dict[str, Any]) -> list[str]:
    """Rule checks of a Guardrail: personal data and blocked words."""
    found = []
    if options.get("pii", True):
        found += [f"contains {name}" for name, rx in PII.items() if rx.search(text)]
    for word in [w.strip() for w in str(options.get("blocked") or "").split(",") if w.strip()]:
        if re.search(rf"(?<!\w){re.escape(word)}(?!\w)", text, re.IGNORECASE):
            found.append(f'contains "{word}"')
    return found


def policy(llm, chat, rule: str, text: str, texts=None) -> tuple[bool, str, dict[str, int]]:
    """Guardrail AI check: does the text break the policy? (prompts agent.guardrail*)"""
    from app.askdata.common.text import extract_json
    user = fill(prompt(texts, "agent.guardrail_message"), POLICY=rule, TEXT=text[:20000])
    reply, tokens = chat(llm.model_copy(update={"temperature": 0}), [("system", prompt(texts, "agent.guardrail")), ("user", user)])
    v = extract_json(reply, default={})
    v = v if isinstance(v, dict) else {}
    return v.get("violates") is True, str(v.get("reason") or "")[:500], tokens


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Mod: operator.mod, ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}


def arithmetic(expression: str) -> float:
    """+ - * / % ** and brackets over numbers only (no names, no calls)."""
    def ev(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            if isinstance(n.op, ast.Pow) and abs(ev(n.right)) > 100:
                raise ValueError("The power is too large.")
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("Use numbers, + - * / % ** and brackets only.")
    return ev(ast.parse(expression.strip(), mode="eval"))


def compute(step, values: dict[str, str]) -> Iterator[dict[str, Any]]:
    from app.api_tool import _pick
    opts = step.options or {}
    mode = opts.get("mode", "template")
    try:
        if mode == "pick":
            raw = values.get(str(opts.get("source") or ""), "")
            data = json.loads(raw) if raw.strip()[:1] in "[{" else raw
            picked = _pick(data, str(opts.get("path") or ""))
            answer = picked if isinstance(picked, str) else json.dumps(picked, ensure_ascii=False)
        elif mode == "math":
            def number(m: re.Match) -> str:
                found = _NUMBER.search(values.get(m.group(1), ""))
                if not found:
                    raise ValueError(f"{{{{{m.group(1)}}}}} has no number.")
                return found.group(0).replace(",", "")
            result = arithmetic(_PLACEHOLDER.sub(number, step.text))
            answer = str(int(result)) if float(result).is_integer() else f"{result:.4g}"
        else:
            answer = _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), step.text)
    except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError, SyntaxError) as exc:
        yield {"event": "error", "data": {"message": f"Compute failed: {exc}"[:500]}}
        return
    yield {"event": "done", "data": {"answer": answer}}


def merge(step, values: dict[str, str], history: list[dict[str, str]], text: str = "") -> Iterator[dict[str, Any]]:
    keys = [k.strip() for k in str((step.options or {}).get("keys") or "").split(",") if k.strip()]
    parts = [f"**{k}**\n\n{values[k]}" for k in keys if values.get(k)] if keys else [f"**{h['user']}**\n\n{h['assistant']}" for h in history]
    if not parts:
        yield {"event": "error", "data": {"message": "Merge found nothing to join."}}
        return
    intro = (text or step.text).strip()   # the instruction with its {{keys}} filled in
    yield {"event": "done", "data": {"answer": "\n\n".join(([intro] if intro else []) + parts)}}

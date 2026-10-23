"""The deterministic verifier: every figure in a draft must come from the evidence (ported unchanged in logic).

It runs on every draft, costs nothing and cannot be talked round:

* numbers and dates: each one the draft states must appear in the tool results (or the question it answers);
* forbidden judgements (setting forbiddenPhrases): refused unless the evidence carries the word as an upper-case
  status code, as the date-validation status LATE does;
* field-name leaks: a snake_case key of the evidence written into the prose is refused.

The issue texts are the tenant's (dailyreport.verifier_issues); a failed draft goes back to the writer with them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable, List, Sequence, Set, Tuple

_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?![\w])")
_LIST_MARKER = re.compile(r"^\s*\d+[.)]\s", re.MULTILINE)
_SNAKE = re.compile(r"\b[a-z]+(?:_[a-z0-9]+)+\b")

#: issue(kind, **values) -> text; kinds: date (DATE), figure (FIGURE), judgement (PHRASE), field_name (FIELD).
IssueText = Callable[..., str]


@dataclass
class Verification:
    passed: bool
    issues: List[str] = field(default_factory=list)
    checked_numbers: int = 0
    #: What each issue is about, (kind, the text in the draft): ("figure", "88"), ("date", "2026-07-21"), ("judgement",
    #: "late"), ("field_name", "open_total"). The writer uses it to find and fix only the sentences concerned.
    problems: List[Tuple[str, str]] = field(default_factory=list)

    def as_dict(self):
        return {"passed": self.passed, "issues": list(self.issues), "checked_numbers": self.checked_numbers}


def _normalise(token: str) -> str:
    token = token.replace(",", "")
    try:
        value = Decimal(token)
    except InvalidOperation:
        return token
    text = format(value.normalize(), "f")
    return "0" if text in {"-0", ""} else text


def _walk(value: Any, keys: Set[str], texts: List[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            keys.add(str(key))
            _walk(item, keys, texts)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            _walk(item, keys, texts)
    elif isinstance(value, (datetime, date)):
        texts.append(value.isoformat()[:10])
    elif value is not None:
        texts.append(str(value))


def evidence_vocabulary(evidence: Any, extra: Iterable[str] = ()):
    """(numbers, dates, keys, status codes) found in the evidence. A forbidden word is allowed only when the evidence
    carries it as an upper-case code, never because some explanatory note happens to contain it."""
    keys: Set[str] = set()
    texts: List[str] = []
    _walk(evidence, keys, texts)
    texts.extend(extra)
    numbers: Set[str] = set()
    dates: Set[str] = set()
    for text in texts:
        dates.update(_DATE.findall(text))
        for token in _NUMBER.findall(_DATE.sub(" ", text)):
            numbers.add(_normalise(token))
            numbers.add(_normalise(token.lstrip("-")))
        # Digit runs inside identifiers (FLME1180-30356), never the parts of a date.
        for run in re.findall(r"\d+", _DATE.sub(" ", text)):
            numbers.add(_normalise(run))
    codes = {text for text in texts if re.fullmatch(r"[A-Z][A-Z_]*", text)}
    return numbers, dates, keys, codes


def verify(draft: str, evidence: Any, *, issue: IssueText, forbidden_phrases: Sequence[str],
           question: str = "") -> Verification:
    numbers, dates, keys, codes = evidence_vocabulary(evidence, [question])
    issues: List[str] = []
    problems: List[Tuple[str, str]] = []

    body = _LIST_MARKER.sub(" ", draft)
    stated_dates = _DATE.findall(body)
    for stated in sorted(set(stated_dates)):
        if stated not in dates:
            issues.append(issue("date", DATE=stated))
            problems.append(("date", stated))

    stated_numbers = _NUMBER.findall(_DATE.sub(" ", body))
    for token in sorted(set(stated_numbers)):
        normalised = _normalise(token)
        if normalised not in numbers and normalised.lstrip("-") not in numbers:
            issues.append(issue("figure", FIGURE=token))
            problems.append(("figure", token))

    lowered = f" {draft.lower()} "
    for phrase in forbidden_phrases:
        phrase = phrase.strip().lower()
        if not phrase:
            continue
        pattern = rf"(?<![a-z]){re.escape(phrase)}(?![a-z])"
        if re.search(pattern, lowered) and phrase.upper().replace(" ", "_") not in codes:
            issues.append(issue("judgement", PHRASE=phrase))
            problems.append(("judgement", phrase))

    for token in sorted({token for token in _SNAKE.findall(draft) if token in keys}):
        issues.append(issue("field_name", FIELD=token))
        problems.append(("field_name", token))

    return Verification(passed=not issues, issues=issues,
                        checked_numbers=len(set(stated_numbers)) + len(set(stated_dates)), problems=problems)


def mentions(sentence: str, kind: str, text: str) -> bool:
    """Whether a sentence states what one problem is about, matched the way verify() found it in the draft."""
    if kind == "date":
        return text in _DATE.findall(sentence)
    if kind == "figure":
        wanted = _normalise(text)
        return any(_normalise(t) == wanted for t in _NUMBER.findall(_DATE.sub(" ", _LIST_MARKER.sub(" ", sentence))))
    if kind == "judgement":
        return re.search(rf"(?<![a-z]){re.escape(text)}(?![a-z])", sentence.lower()) is not None
    if kind == "field_name":
        return text in _SNAKE.findall(sentence)
    return False

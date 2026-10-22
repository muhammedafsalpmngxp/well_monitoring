"""Fixing only the sentences the verifier rejected, instead of rewriting the whole draft.

The verifier names what it rejected (a figure, a date, a forbidden word, a field name). Code, not the model, finds
the sentences that state it; the model rewrites just those (dailyreport.writer_patch); code puts them back in place,
keeping every other sentence exactly as it was, and the whole draft is checked again. When a problem cannot be
pinned to a sentence, or too much of the draft is affected, the caller rewrites the whole draft as before.
"""
from __future__ import annotations

import re
from typing import List, Optional, Sequence, Tuple

from app.features.dailyreport.agent.verifier import mentions

#: Sentence ends (". " after a full stop, ! or ?) and line breaks. "15.78" or "e.g.x" are not ends: no space follows.
_BOUNDARY = re.compile(r"((?<=[.!?])[ \t]+|\n+)")
#: A list marker a sentence starts with (kept when the sentence is replaced).
_MARKER = re.compile(r"^\s*(?:[*\-•]|\d+[.)])\s+")

#: The most of a draft a patch may replace; beyond it the whole draft is rewritten.
MAX_SHARE = 0.5


def split(text: str) -> List[str]:
    """The draft as [sentence, separator, sentence, ...]: joined back, exactly the draft."""
    return _BOUNDARY.split(text or "")


def faulty(parts: Sequence[str], problems: Sequence[Tuple[str, str]]) -> Optional[List[int]]:
    """The positions (in ``parts``) of the sentences that state a problem, or None when a problem is in no sentence
    or the sentences concerned are more than MAX_SHARE of the draft."""
    sentences = [i for i in range(0, len(parts), 2) if parts[i].strip()]
    found = set()
    for kind, text in problems:
        hits = [i for i in sentences if mentions(parts[i], kind, text)]
        if not hits:
            return None
        found.update(hits)
    if not found or len(found) > max(1, int(len(sentences) * MAX_SHARE)):
        return None
    return sorted(found)


def splice(parts: Sequence[str], positions: Sequence[int], replacements: Sequence[str]) -> str:
    """The draft with each sentence at ``positions`` replaced, its list marker (if any) kept."""
    out = list(parts)
    for position, new in zip(positions, replacements):
        marker = _MARKER.match(out[position])
        out[position] = (marker.group(0) if marker else "") + new.strip()
    return "".join(out)


def numbered(parts: Sequence[str], positions: Sequence[int]) -> str:
    """The sentences to rewrite, one per line: "1. ...", "2. ..." (list markers left out)."""
    return "\n".join(f"{n}. {_MARKER.sub('', parts[p]).strip()}" for n, p in enumerate(positions, start=1))

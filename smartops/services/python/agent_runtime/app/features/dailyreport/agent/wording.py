"""The AI's text as a reader should see it: status codes in plain words and no backticks.

The writer is given status codes (ON_PLAN, NO_ACTUAL, ...) and, in older prompts, asked to wrap copied values in
backticks. Neither reads well in a brief for stakeholders, and a prompt alone cannot guarantee it, so the text is
put into plain words here, before the verifier checks it (the figures are untouched) and before it is streamed or
saved. The words are the tenant's statusWords setting; a code it does not list stays as written.
"""
from __future__ import annotations

import re
from typing import Mapping


def plain(text: str, words: Mapping[str, str]) -> str:
    """No backticks; every listed status code, as a whole word, replaced by its words."""
    text = (text or "").replace("`", "")
    if not words:
        return text
    # Longest first, whole words only: COMPLETED is never replaced inside ENDED_NOT_COMPLETED.
    codes = sorted((re.escape(code) for code in words), key=len, reverse=True)
    return re.sub(r"\b(" + "|".join(codes) + r")\b", lambda m: words[m.group(1)], text)

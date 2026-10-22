"""Crew Management errors. Every message is safe to show (no SQL text, no credentials); api.py maps them to HTTP codes."""
from __future__ import annotations


class BadRequest(ValueError):
    """Bad input or a feature set-up problem the tenant can fix (400)."""


class WellNotFound(LookupError):
    """The well id is not in well.well_master (404).

    Its own class rather than a bare LookupError, which KeyError and IndexError also are: a bug raising one of those
    must surface as a failure, not be reported as "well not found"."""

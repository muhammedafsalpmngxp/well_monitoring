"""The errors the endpoints map to HTTP statuses (messages are safe to show)."""
from __future__ import annotations

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.common.access import AccessDenied
from app.features.dailyreport.data import QueryConfigError
from app.features.dailyreport.settings import SettingsInvalid
from app.prompt_text import PromptMissing


class BadRequest(ValueError):
    """The caller asked for something the feature does not accept."""


class NotFound(LookupError):
    """The requested well has no evidence at all."""


#: Something an admin must fix (a prompt, a setting, a verified query, the table allowlist). Raised through every
#: layer, never turned into "unavailable" data, so the message reaches the admin: 400.
CONFIG_ERRORS = (PromptMissing, SettingsInvalid, QueryConfigError, AccessDenied, ReadOnlyViolation)

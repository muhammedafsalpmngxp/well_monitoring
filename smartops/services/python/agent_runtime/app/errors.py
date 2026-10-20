"""What a failed run tells the user: a message that is safe to show (no driver text, server names, SQL or stack
traces). The full exception always goes to the log first (the caller logs it)."""
from __future__ import annotations

from app.askdata.common.connection import DatabaseUnavailable
from app.askdata.common.readonly import ReadOnlyViolation
from app.prompt_text import PromptMissing


def user_message(exc: BaseException, what: str) -> str:
    """``what`` names the operation, e.g. "Ask Data" or "The agent"."""
    # Our own errors are written for users already; so are the ValueErrors the graph and settings checks raise for a
    # configuration that cannot run (e.g. "a link back makes a circle").
    if isinstance(exc, (DatabaseUnavailable, ReadOnlyViolation, PromptMissing)) or type(exc) is ValueError:
        return str(exc)[:1000]
    module = type(exc).__module__.split(".")[0]
    if module in ("openai", "httpx", "langchain_openai", "langchain_core"):
        status = getattr(exc, "status_code", None)
        if status in (401, 403):
            return (f"{what} could not use the AI provider: it refused the key (HTTP {status}). An admin can check the "
                    "provider under Settings > AI Providers.")
        if status == 429:
            return f"{what} could not use the AI provider: it is rate-limiting or out of credit (HTTP 429). Try again later."
        if status == 404:
            return (f"{what} could not use the AI provider: the model or endpoint was not found (HTTP 404). An admin can "
                    "check the provider under Settings > AI Providers.")
        if status is not None and status >= 500:
            return f"{what} could not use the AI provider: it had an error (HTTP {status}). Try again in a moment."
        name = type(exc).__name__
        if "Timeout" in name or "Connection" in name:
            return f"{what} could not reach the AI provider ({name}). Try again in a moment."
        return f"{what} could not use the AI provider ({name}). An admin can check it under Settings > AI Providers."
    if type(exc).__module__.split(".")[0] == "pyodbc":
        return f"{what} could not read the database ({type(exc).__name__}). Try again; if it persists, the service log has the details."
    if isinstance(exc, TimeoutError):
        return f"{what} took too long and was stopped. Try a narrower question."
    return f"{what} failed unexpectedly ({type(exc).__name__}). The service log has the details."

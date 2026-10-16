"""Transform pipeline: rule parsing, type coercions, and batch processing."""

import contextvars
import io
import logging
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

logger = logging.getLogger("smartops.etl.transform")

_RULE_PATTERN = re.compile(r'^([\w]+)(?:\(([^)]*)\))?$', re.IGNORECASE)

# ── Source FK resolution cache (populated by engine before transform) ─────────
# Uses contextvars for thread-safety: concurrent tenant runs get isolated caches.
_FK_RESOLVE_CACHE: contextvars.ContextVar[dict[str, dict]] = contextvars.ContextVar('_fk_cache')

# ── Transform trace control ───────────────────────────────────────────────────
ENABLE_TRACE: bool = os.environ.get("ETL_ENABLE_TRACE", "1").lower() in ("1", "true", "yes")
_TRACE_BUFFER_SIZE: int = 10_000  # Flush trace to disk every N rows

# ── Transform trace log directory ─────────────────────────────────────────────
_TRACE_LOG_DIR = Path(os.environ.get(
    "ETL_LOG_DIR",
    str(Path(__file__).resolve().parents[1] / "logs"),
))


class TransformTracer:
    """
    Writes a per-run transform trace file showing field-by-field transformations.
    File: logs/transform_trace_run_{id}.log

    Uses an in-memory buffer that flushes every _TRACE_BUFFER_SIZE rows to reduce
    disk I/O overhead during high-volume processing.
    """

    def __init__(self, run_id: int | None) -> None:
        self._run_id = run_id or 0
        self._fh: TextIO | None = None
        self._buffer: io.StringIO = io.StringIO()
        self._row_count = 0
        self._buffer_rows = 0

    def open(self) -> None:
        if not ENABLE_TRACE:
            return
        _TRACE_LOG_DIR.mkdir(parents=True, exist_ok=True)
        path = _TRACE_LOG_DIR / f"transform_trace_run_{self._run_id}.log"
        self._fh = open(path, "w", encoding="utf-8")
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        self._fh.write(f"Transform Trace — Run {self._run_id} — {ts} UTC\n")
        self._fh.write("=" * 90 + "\n\n")

    def trace_row(self, idx: int, source_object: str | None, fields: list[dict]) -> None:
        """Write one row's transform details. `fields` is a list of field trace dicts."""
        if not ENABLE_TRACE or self._fh is None:
            return
        self._row_count += 1
        self._buffer_rows += 1
        buf = self._buffer
        src_label = source_object or "unknown"
        buf.write(f"── Row {idx + 1} (source: {src_label}) " + "─" * max(0, 60 - len(src_label)) + "\n")
        if not fields:
            buf.write("  (no mappings applied)\n\n")
            self._maybe_flush()
            return
        # Column widths
        src_w = max(len(f["source_field"]) for f in fields)
        tgt_w = max(len(f["target_label"]) for f in fields)
        for f in fields:
            status = "✓" if f["ok"] else "✗"
            rule_label = f["rule"] or "(auto)"
            buf.write(
                f"  {status} {f['source_field']:<{src_w}}  →  {f['target_label']:<{tgt_w}}"
                f"  │ {_fmt_val(f['before'])} → [{rule_label}] → {_fmt_val(f['after'])}\n"
            )
        buf.write("\n")
        self._maybe_flush()

    def _maybe_flush(self) -> None:
        """Flush buffer to disk when threshold reached."""
        if self._buffer_rows >= _TRACE_BUFFER_SIZE and self._fh:
            self._fh.write(self._buffer.getvalue())
            self._buffer = io.StringIO()
            self._buffer_rows = 0

    def close(self) -> None:
        if self._fh:
            # Flush remaining buffer
            remaining = self._buffer.getvalue()
            if remaining:
                self._fh.write(remaining)
            self._buffer = io.StringIO()
            self._buffer_rows = 0
            self._fh.write("=" * 90 + "\n")
            self._fh.write(f"Total rows traced: {self._row_count}\n")
            self._fh.flush()
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "TransformTracer":
        self.open()
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def _fmt_val(v: Any) -> str:
    """Format a value for trace display — truncate long strings."""
    if v is None:
        return "NULL"
    s = repr(v)
    return s if len(s) <= 60 else s[:57] + "..."


# Per-thread active tracer (set by engine before transform_batch)
_active_tracer: contextvars.ContextVar[TransformTracer | None] = contextvars.ContextVar('_tracer', default=None)


def set_active_tracer(tracer: TransformTracer | None) -> None:
    """Set the active transform tracer. Called by the engine."""
    _active_tracer.set(tracer)


def set_fk_resolve_cache(cache: dict[str, dict]) -> None:
    """Set the source FK resolution cache. Called by the engine before transform."""
    _FK_RESOLVE_CACHE.set(cache)
    # Reset warning counters for new run
    _FK_RESOLVE_WARN_COUNTS.clear()

# CASE WHEN expression support
_WHEN_CLAUSE_RE = re.compile(
    r"WHEN\s[^']*'([^']*)'\s+THEN\s+(?:'([^']*)'|(\S+))(?=\s|$)",
    re.IGNORECASE,
)
_ELSE_CLAUSE_RE = re.compile(r"ELSE\s+(?:'([^']*)'|(\S+))\s*$", re.IGNORECASE)

# ── Shared datetime format constant ──────────────────────────────────────────
_DATETIME_ISO_FMT = "%Y-%m-%dT%H:%M:%S"


def _extract_case_body(expr: str) -> str | None:
    """Extract body from a CASE...END expression, or None if not a match."""
    s = expr.strip()
    if len(s) < 8:
        return None
    if s[:4].upper() != "CASE" or s[-3:].upper() != "END":
        return None
    if not s[4:5].isspace() or not s[-4:-3].isspace():
        return None
    return s[5:-4]


def _apply_case_expression(value: Any, expr: str) -> Any:
    """
    Evaluate a SQL-style CASE WHEN expression against the current value.
    Supports: CASE WHEN <col> = '<val>' THEN <result> [WHEN...] ELSE <default> END
    The column name is optional/ignored — comparison is against the current value.
    """
    body = _extract_case_body(expr)
    if body is None:
        return None

    val_str = str(value).strip() if value is not None else ""

    # Check each WHEN clause
    for m in _WHEN_CLAUSE_RE.finditer(body):
        condition_val = m.group(1)
        then_val = (m.group(2) if m.group(2) is not None else m.group(3)).strip()
        if val_str.lower() == condition_val.lower():
            # Try to return as int if it looks numeric
            try:
                return int(then_val)
            except ValueError:
                return then_val

    # Fall through to ELSE
    else_match = _ELSE_CLAUSE_RE.search(body)
    if else_match:
        else_val = (else_match.group(1) if else_match.group(1) is not None else else_match.group(2)).strip()
        try:
            return int(else_val)
        except ValueError:
            return else_val

    return None


class _LookupRef:
    """
    Sentinel returned by the lookup() transform rule.
    Defers FK resolution to load time when a DB cursor is available.
    """
    __slots__ = ("table", "match_col", "return_col", "value")

    def __init__(self, table: str, match_col: str, return_col: str, value: Any) -> None:
        self.table      = table
        self.match_col  = match_col
        self.return_col = return_col
        self.value      = value

    def __repr__(self) -> str:
        return f"LookupRef({self.table}.{self.match_col}={self.value!r})"


_SAFE_IDENT_RE = re.compile(r'^\w{1,128}$')
_BRACKETED_TABLE_RE = re.compile(r"^\[\w{1,128}\]\.\[\w{1,128}\]$")


def _validate_and_normalize_table(raw_table: str) -> str | None:
    """Validate and normalize a table reference for lookup. Returns None if unsafe."""
    if "." in raw_table and not raw_table.startswith("["):
        schema, tbl = raw_table.split(".", 1)
        if not _SAFE_IDENT_RE.match(schema) or not _SAFE_IDENT_RE.match(tbl):
            logger.warning("lookup() unsafe table name rejected: %r", raw_table)
            return None
        return f"[{schema}].[{tbl}]"
    if raw_table.startswith("["):
        if not _BRACKETED_TABLE_RE.match(raw_table):
            logger.warning("lookup() unsafe bracketed table rejected: %r", raw_table)
            return None
    elif not _SAFE_IDENT_RE.match(raw_table):
        logger.warning("lookup() unsafe table name rejected: %r", raw_table)
        return None
    return raw_table


def _tr_lookup(value: Any, params: str) -> Any:
    """
    Defer FK lookup to load time.
    params = "<schema>.<Table>,<match_col>,<return_col>"
    """
    if value is None:
        return None
    parts = [p.strip() for p in params.split(",")]
    if len(parts) != 3:
        logger.warning("lookup() expects 3 params (table,match,return) — got %r", params)
        return None
    raw_table, match_col, return_col = parts[0], parts[1], parts[2]
    # Validate column names at parse time to reject injection attempts early
    if not _SAFE_IDENT_RE.match(match_col):
        logger.warning("lookup() unsafe match_col rejected: %r", match_col)
        return None
    if not _SAFE_IDENT_RE.match(return_col):
        logger.warning("lookup() unsafe return_col rejected: %r", return_col)
        return None
    sql_table = _validate_and_normalize_table(raw_table)
    if sql_table is None:
        return None
    return _LookupRef(sql_table, match_col, return_col, value)


def _tr_string(value: Any, params: str) -> Any:
    s = str(value)
    if params:
        try:
            s = s[:int(params.split(",")[0].strip())]
        except (ValueError, IndexError):
            pass
    return s


def _tr_int(value: Any, params: str) -> Any:
    return int(float(str(value).strip()))


def _clamp_decimal(f: float, precision: int, scale: int) -> float:
    """Clamp float to the range allowed by decimal(precision, scale)."""
    f = round(f, scale)
    max_integer_digits = precision - scale
    max_val = 10 ** max_integer_digits - 10 ** (-scale)
    if f > max_val:
        # Heuristic: if column allows <=1 integer digit and value looks
        # like a percentage (>1), normalize to fraction (e.g. 85 → 0.85)
        if max_integer_digits <= 1 and abs(f) > 1:
            f = round(f / 100.0, scale)
        else:
            f = max_val
    elif f < -max_val:
        if max_integer_digits <= 1 and abs(f) > 1:
            f = round(f / -100.0, scale)
        else:
            f = -max_val
    return f


def _tr_decimal(value: Any, params: str) -> Any:
    s = str(value).strip()
    # Strip common unit suffixes (e.g. '6"', '2.4 km', '1 Km', '150m')
    s = re.sub(r'(?:km|Km|KM|m|M|ft|")\s*$', '', s).strip()
    if not s:
        return 0.0
    f = float(s)
    if params and "," in params:
        try:
            parts = params.split(",")
            f = _clamp_decimal(f, int(parts[0].strip()), int(parts[1].strip()))
        except (ValueError, IndexError):
            pass
    return f


def _tr_float(value: Any, params: str) -> Any:
    return float(str(value).strip())


def _try_parse_epoch_ms(s: str) -> str | None:
    """Try to parse epoch milliseconds string to ISO datetime. Returns None if not applicable."""
    if not (s.isdigit() and len(s) >= 12):
        return None
    try:
        dt = datetime.fromtimestamp(int(s) / 1000, tz=timezone.utc)
        if dt.year <= 1900:
            return None
        return dt.strftime(_DATETIME_ISO_FMT)
    except (ValueError, OSError, OverflowError):
        return None


def _tr_datetime(value: Any, params: str) -> Any:
    if isinstance(value, datetime):
        # NULL out 1900-01-01 sentinel dates (used as NULL placeholder in some source systems)
        if value.year <= 1900:
            return None
        return value.isoformat()
    s = str(value).strip()
    # Strip trailing 'Z' (UTC indicator) and timezone offset (e.g. '+05:30', ' -0800')
    s_parse = s.rstrip("Z")
    s_parse = re.sub(r'\s[+-]\d{2}:?\d{2}$', '', s_parse)
    # Epoch milliseconds (e.g. '1762387200000')
    epoch_result = _try_parse_epoch_ms(s_parse)
    if epoch_result is not None:
        return epoch_result
    for fmt in (
        _DATETIME_ISO_FMT, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f",
        "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d",
        "%d/%m/%Y", "%m/%d/%Y",
        "%d-%b-%y", "%d-%b-%Y",  # DD-MON-YY/YYYY (e.g. 31-OCT-25, 14-Nov-2025)
    ):
        try:
            dt = datetime.strptime(s_parse, fmt)
            # NULL out 1900-01-01 sentinel dates
            if dt.year <= 1900:
                return None
            return dt.isoformat()
        except ValueError:
            continue
    if len(s) >= 19:
        # Last resort: check for 1900 sentinel in raw string
        if s.startswith("1900-01-01"):
            return None
        return s[:19]
    raise ValueError(f"Cannot parse datetime: {s!r}")


def _tr_date(value: Any, params: str) -> Any:
    return str(value).strip()[:10]


# ── Date-key: parse date string → int YYYYMMDD ───────────────────────────────
_DATE_KEY_FORMATS = (
    _DATETIME_ISO_FMT, "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
    "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y",
    "%d-%m-%Y", "%d.%m.%Y %H:%M:%S",
    "%d-%b-%y", "%d-%b-%Y",  # DD-MON-YY/YYYY (e.g. 31-OCT-25, 14-Nov-2025)
)


def _tr_date_key(value: Any, params: str) -> Any:
    """Parse date string (ISO, DD.MM.YYYY, etc.) → int YYYYMMDD (e.g. 20251218)."""
    if value is None:
        return None
    # Already an int — pass through
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if not s:
        return None
    # Try parsing as int directly (already YYYYMMDD)
    try:
        iv = int(s)
        if 19000101 <= iv <= 20991231:
            return iv
    except ValueError:
        pass
    # Strip timezone suffix (Z, +00:00, +0000, -0800, ' -0800')
    s_clean = re.sub(r'[Zz]$', '', s)
    s_clean = re.sub(r' ?[+-]\d{2}:?\d{2}$', '', s_clean)
    for fmt in _DATE_KEY_FORMATS:
        try:
            dt = datetime.strptime(s_clean, fmt)
            return int(dt.strftime("%Y%m%d"))
        except ValueError:
            continue
    logger.warning("date_key: cannot parse %r", value)
    return None


def _tr_time(value: Any, params: str) -> Any:
    s = str(value).strip()
    return s.split("T")[-1][:8] if "T" in s else s[:8]


def _tr_bit(value: Any, params: str) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    return 1 if str(value).strip().lower() in ("1", "true", "yes", "y", "on") else 0


def _tr_guid(value: Any, params: str) -> str:
    """
    Normalize value to a UUID string.
    If already a valid UUID, format it consistently; otherwise generate a
    deterministic uuid5 from the value.
    """
    s = str(value).strip()
    try:
        return str(uuid.UUID(s))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_OID, s.lower()))


def _tr_cast(value: Any, params: str) -> Any:
    """
    SQL-style CAST: ignores input value, returns the literal cast to target type.
    Usage in transform_rule: CAST(1 AS BIT), CAST('active' AS VARCHAR)
    """
    upper_params = params.upper()
    as_pos = upper_params.rfind(" AS ")
    if as_pos < 0:
        logger.warning("cast() expects '<literal> AS <type>' — got %r", params)
        return value
    literal = params[:as_pos].strip().strip("'\"")
    target_type = params[as_pos + 4:].strip().lower()
    if not target_type:
        logger.warning("cast() expects '<literal> AS <type>' — got %r", params)
        return value
    handler = TRANSFORM_REGISTRY.get(target_type.split()[0])
    if handler:
        return handler(literal, "")
    return literal


# ── fk_resolve warning rate limiter ───────────────────────────────────────────
_FK_RESOLVE_WARN_COUNTS: dict[str, int] = {}
_FK_RESOLVE_WARN_LIMIT = 5  # Log only first N misses per cache key per run


def _tr_fk_resolve(value: Any, params: str) -> Any:
    """
    Resolve a source FK ID to a business key using a pre-built cache.

    Usage:  fk_resolve(SourceTable,id_col,key_col)
    Example: fk_resolve(EquipmentType,ID,Code)
      - source row has EquipmentType=328
      - cache maps 328 → 'HTP18'
      - returns 'HTP18' so downstream lookup() can resolve in target DB

    Cache is populated by the engine before transform via set_fk_resolve_cache().
    """
    if value is None:
        return None
    cache = _FK_RESOLVE_CACHE.get({}).get(params)
    if cache is None:
        logger.warning("fk_resolve(%s) — no cache available", params)
        return value
    # Try exact match first, then string coercion (source IDs may be int or str)
    resolved = cache.get(value)
    if resolved is None:
        resolved = cache.get(str(value))
    if resolved is None:
        try:
            resolved = cache.get(int(value))
        except (ValueError, TypeError):
            pass
    if resolved is None:
        # Rate-limit warnings: log first N, then suppress until summary
        count = _FK_RESOLVE_WARN_COUNTS.get(params, 0) + 1
        _FK_RESOLVE_WARN_COUNTS[params] = count
        if count <= _FK_RESOLVE_WARN_LIMIT:
            logger.warning("fk_resolve(%s) — value %r not found", params, value)
        elif count == _FK_RESOLVE_WARN_LIMIT + 1:
            logger.warning("fk_resolve(%s) — suppressing further warnings (>%d misses)", params, _FK_RESOLVE_WARN_LIMIT)
    return resolved


def _tr_fk_resolve_nullable(value: Any, params: str) -> Any:
    """Same as fk_resolve but returns None on cache miss (for nullable FK fields).
    This prevents the raw source ID from leaking into the lookup step."""
    if value is None:
        return None
    cache = _FK_RESOLVE_CACHE.get({}).get(params)
    if cache is None:
        return None
    resolved = cache.get(value)
    if resolved is None:
        resolved = cache.get(str(value))
    if resolved is None:
        try:
            resolved = cache.get(int(value))
        except (ValueError, TypeError):
            pass
    return resolved  # None if not found — intentionally silent


# ── Generic reference data normalization ──────────────────────────────────────

# Regex patterns for cleaning noisy reference values
# These match "<value> <noise_phrase> <trailing>." and extract just <value>
_NOISE_FULL_PATTERN = re.compile(
    r'^(.+?)\s+'                                   # capture the actual value (non-greedy)
    r'(?:\(?'                                      # optional opening paren
    r'(?:Artificial Lift Type\s+)?'                 # optional prefix
    r'defined in \w+ is\s*:?\s*'                   # "defined in WCC is :"
    r'[^)]*'                                       # trailing value after colon
    r'\)?)'                                        # optional closing paren
    r'\.?\s*$',                                    # trailing period
    re.IGNORECASE
)

# Standalone noise — entire value IS the noise phrase (no prefix)
_NOISE_STANDALONE_PATTERN = re.compile(
    r'^(?:\(?'
    r'(?:Artificial Lift Type\s+)?'
    r'defined in \w+ is\s*:?\s*'
    r')'
    r'(.+?)'                                       # capture the WCC value
    r'\.?\)?\s*$',
    re.IGNORECASE
)

# ── Dynamic abbreviation discovery ────────────────────────────────────────────
# Populated at runtime by discover_abbreviations() before the transform phase.
# Maps normalised_code.lower() → Full Name  (e.g. "bp" → "Beam Pump").
_DYNAMIC_ABBREVS: dict[str, str] = {}
# Reverse map: full_name.lower() → shortest code  (e.g. "beam pump" → "BP").
_REVERSE_ABBREVS: dict[str, str] = {}


def discover_abbreviations(raw_values: list[str | None]) -> dict[str, str]:
    """
    Auto-discover code → full-name mappings from raw source values.

    Discovery strategies (applied in order):
    1. **Parenthetical**: ``"ESP (Electrical Submersible Pump)"`` in JSON arrays
       or standalone values → register ``esp → Electrical Submersible Pump``.
    2. **Acronym matching**: If both a short all-caps code (e.g. ``"BP"``) and a
       multi-word name (e.g. ``"Beam Pump"``) exist, and the code equals the
       first-letter initials of the name → register ``bp → Beam Pump``.

    The result is stored in the module-level ``_DYNAMIC_ABBREVS`` cache so that
    ``_tr_abbrev`` can use it during the streaming transform phase.
    """
    global _DYNAMIC_ABBREVS
    import json as _json

    explicit: dict[str, str] = {}      # code.lower() → Full Name
    clean_values: set[str] = set()     # all unique normalised values

    for raw in raw_values:
        if raw is None:
            continue
        s = str(raw).strip()
        if not s:
            continue

        # Replace newlines so patterns can match
        s = re.sub(r'[\r\n]+', ' ', s).strip()

        # ── JSON arrays: extract ALL items with parenthetical names ──
        if s.startswith('['):
            try:
                arr = _json.loads(s)
                if isinstance(arr, list):
                    for item in arr:
                        item_s = str(item).strip()
                        pm = re.match(r'^(.+?)\s*\((.+?)\)\s*$', item_s)
                        if pm:
                            code_part = pm.group(1).strip()
                            name_part = pm.group(2).strip()
                            # Only register if prefix is short code and parenthetical is longer name
                            if len(code_part) <= 5 and len(name_part) > len(code_part):
                                explicit[code_part.lower()] = name_part
                            clean_values.add(name_part)
                            clean_values.add(code_part)
                        else:
                            clean_values.add(item_s)
            except (ValueError, TypeError):
                pass
            continue

        # ── Standalone parenthetical: "ESP (Electrical Submersible Pump)" ──
        pm = re.match(r'^(.+?)\s*\((.+?)\)\s*$', s)
        if pm:
            name_part = pm.group(2).strip()
            # Only register if parenthetical is NOT a noise phrase
            # and prefix is a short code (≤ 5 chars), not a full name
            if (not re.search(r'defined in \w+ is', name_part, re.IGNORECASE)
                    and len(pm.group(1).strip()) <= 5
                    and len(name_part) > len(pm.group(1).strip())):
                code_part = pm.group(1).strip()
                explicit[code_part.lower()] = name_part
                clean_values.add(name_part)
                clean_values.add(code_part)
                continue

        # ── Normalise the raw value and record it ──
        normalised = _tr_normalize(s, "")
        if normalised:
            clean_values.add(normalised)

    # ── Acronym matching ──────────────────────────────────────────────
    # Short all-caps codes (≤ 5 chars) matched against multi-word names
    short_codes = {v for v in clean_values if len(v) <= 5 and v == v.upper() and v.isalpha()}
    full_names  = {v for v in clean_values if ' ' in v and len(v) > 5}

    for code in short_codes:
        if code.lower() in explicit:
            continue  # already explicitly mapped
        for name in full_names:
            words = name.split()
            if len(words) == len(code):
                initials = ''.join(w[0] for w in words).upper()
                if initials == code.upper():
                    explicit[code.lower()] = name
                    break

    _DYNAMIC_ABBREVS = explicit

    # Build reverse map: full_name.lower() → shortest code
    # When multiple codes map to the same name, prefer the shortest code
    reverse: dict[str, str] = {}
    for code_key, full_name in explicit.items():
        name_lower = full_name.lower()
        if name_lower not in reverse or len(code_key) < len(reverse[name_lower]):
            reverse[name_lower] = code_key.upper()
    _REVERSE_ABBREVS.clear()
    _REVERSE_ABBREVS.update(reverse)

    if explicit:
        logger.info("Abbreviation discovery: %d mapping(s) — %s",
                    len(explicit),
                    ", ".join(f"{k}→{v}" for k, v in sorted(explicit.items())))
    return explicit


def clear_abbrev_cache() -> None:
    """Clear the dynamic abbreviation cache (called between ETL runs)."""
    global _DYNAMIC_ABBREVS
    _DYNAMIC_ABBREVS = {}
    _REVERSE_ABBREVS.clear()


def _tr_normalize(value: Any, params: str) -> Any:
    """
    Generic reference value normalizer. Cleans noisy source data:
    1. Strips newlines and excess whitespace
    2. Parses JSON arrays → takes first element
    3. Removes known noise phrases (e.g. "defined in WCC is:")
    4. Strips trailing periods and whitespace

    Usage in transform rule: normalize
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None

    # Replace newlines with spaces
    s = re.sub(r'[\r\n]+', ' ', s).strip()

    # Handle JSON arrays — extract first element
    if s.startswith('['):
        try:
            import json
            arr = json.loads(s)
            if isinstance(arr, list) and arr:
                s = str(arr[0]).strip()
        except (ValueError, TypeError):
            # Strip bracket chars and take first comma-separated value
            s = s.strip('[]"\'')
            if ',' in s:
                s = s.split(',')[0].strip().strip('"\'')

    # Try full noise pattern: "<value> <noise> <trailing>." → extract <value>
    # Try standalone noise FIRST (entire string is noise phrase):
    # "Artificial Lift Type defined in WCC is : Beam Pump." → "Beam Pump"
    m = _NOISE_STANDALONE_PATTERN.match(s)
    if m:
        s = m.group(1).strip()
    else:
        # Try prefixed noise: "<value> defined in WCC is : <trailing>." → "<value>"
        m = _NOISE_FULL_PATTERN.match(s)
        if m:
            prefix = m.group(1).strip().rstrip('/-–— ')
            # Guard: reject prefix only if it's literally "Artificial Lift Type" (noise itself)
            if not re.match(r'^Artificial\s+Lift\s+Type$', prefix, re.IGNORECASE):
                s = prefix

    # Strip trailing period
    s = s.rstrip('.')

    # Strip parenthetical suffixes: "ESP (Electrical Submersible Pump)" → "ESP"
    s = re.sub(r'\s*\([^)]+\)\s*$', '', s).strip()

    # Collapse multiple spaces
    s = re.sub(r'\s{2,}', ' ', s).strip()

    return s if s else None


def _tr_abbrev(value: Any, params: str) -> Any:
    """
    Expand a code/abbreviation to its full canonical name using dynamically
    discovered mappings (populated by ``discover_abbreviations()``).

    Usage in transform rule: abbrev   (no parameters needed)
      — or — abbrev(lift_type)        (parameter is ignored; kept for compatibility)

    If no mapping is found, returns the cleaned value as-is (passthrough).
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None

    # Look up in the dynamically-discovered cache (case-insensitive)
    result = _DYNAMIC_ABBREVS.get(s.lower())
    if result:
        return result

    # No mapping found — return as-is
    return s


def _tr_to_code(value: Any, params: str) -> Any:
    """
    Convert a full name to its shortest known code using the reverse
    abbreviation map (populated by ``discover_abbreviations()``).

    Usage in transform rule: to_code

    Examples (after discovery):
      "Beam Pump"                  → "BP"
      "Electrical Submersible Pump" → "ESP"
      "Gas Lift"                   → "Gas Lift"  (no short code discovered)
      "BP"                         → "BP"        (already a short code)
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None

    # Check if this value IS a full name with a known short code
    result = _REVERSE_ABBREVS.get(s.lower())
    if result:
        return result

    # No reverse mapping — return as-is (may already be a short code)
    return s


TRANSFORM_REGISTRY: dict[str, Any] = {
    # String types
    "varchar": _tr_string,    "nvarchar": _tr_string,
    "char": _tr_string,       "nchar": _tr_string,
    "text": _tr_string,       "ntext": _tr_string,
    # Integer types
    "int": _tr_int,           "integer": _tr_int,
    "bigint": _tr_int,        "smallint": _tr_int,       "tinyint": _tr_int,
    # Decimal / money
    "decimal": _tr_decimal,   "numeric": _tr_decimal,
    "money": _tr_decimal,     "smallmoney": _tr_decimal,
    # Float
    "float": _tr_float,       "real": _tr_float,
    # Date / time
    "datetime": _tr_datetime,    "datetime2": _tr_datetime,
    "smalldatetime": _tr_datetime, "to_datetime": _tr_datetime,
    "date": _tr_date,            "to_date": _tr_date,
    "time": _tr_time,
    # Boolean
    "bit": _tr_bit,
    # String operations
    "upper": lambda v, p: str(v).upper(),
    "lower": lambda v, p: str(v).lower(),
    "trim":  lambda v, p: str(v).strip(),
    # Deterministic GUID from a business key
    "uuid5": lambda v, p: str(uuid.uuid5(uuid.NAMESPACE_OID, str(v).strip().lower())) if v is not None else None,
    # GUID normalization / pass-through
    "guid": _tr_guid,
    # SQL-style CAST (ignores input, returns literal cast to type)
    "cast": _tr_cast,
    # Source FK resolution (resolve source ID → business key before target lookup)
    "fk_resolve": _tr_fk_resolve,
    # Source FK resolution (nullable variant — returns None on miss, no warning)
    "fk_resolve_nullable": _tr_fk_resolve_nullable,
    # FK lookup — deferred to load phase
    "lookup": _tr_lookup,
    # Constant value — ignores input, returns the parameter as-is
    "const": lambda v, p: p.strip() if p else None,
    # Date → int YYYYMMDD for date_key columns
    "date_key": _tr_date_key,
    "date_to_key": _tr_date_key,
    # Reference data normalization (strip noise, parse JSON arrays, clean whitespace)
    "normalize": _tr_normalize,
    # Abbreviation expansion (code → full name via dynamic discovery)
    "abbrev": _tr_abbrev,
    # Reverse abbreviation (full name → shortest known code)
    "to_code": _tr_to_code,
}


def _apply_pipeline_step(value: Any, step: str) -> tuple[Any, bool]:
    """Apply one pipeline step with warning logging. Returns (result, should_continue)."""
    if step.lower().startswith("default:"):
        if value is None:
            return step[8:], False
        return value, True
    if value is None:
        return None, False
    m = _RULE_PATTERN.match(step)
    if not m:
        logger.warning("Unparseable transform step %r — skipping", step)
        return value, True
    handler = TRANSFORM_REGISTRY.get(m.group(1).lower())
    if handler is None:
        logger.warning("Unknown transform rule %r — passing through", m.group(1))
        return value, True
    try:
        return handler(value, m.group(2) or ""), True
    except (ValueError, TypeError, OverflowError) as exc:
        logger.warning("Transform %r failed for %r: %s", step, value, exc)
        return None, False


def apply_transform(value: Any, rule: str) -> Any:
    """
    Apply a DB-type transform rule pipeline to a value.
    Supports SQL Server types, string ops, null fills (default:val),
    CASE WHEN expressions, and pipelines joined by | (e.g. trim|upper|varchar(50)).
    """
    # Handle full CASE WHEN expression (cannot be part of a pipeline)
    if _extract_case_body(rule.strip()) is not None:
        return _apply_case_expression(value, rule.strip())

    for step in (s.strip() for s in rule.split("|") if s.strip()):
        value, should_continue = _apply_pipeline_step(value, step)
        if not should_continue:
            return value
    return value


# ── Auto-coercion: use target dataType when transform_rule is unknown/missing ─

def _auto_coerce(value: Any, target_data_type: str | None, field_name: str | None) -> Any:
    """
    Auto-coerce a value based on the target canonical field's dataType.
    Called when transformRule is missing or contains unrecognized steps.
    """
    if value is None or not target_data_type:
        return value
    # Special case: int fields named *_date_key → parse date to YYYYMMDD
    base = target_data_type.strip().split("(")[0].lower()
    if base in ("int", "integer", "bigint", "smallint") and field_name and field_name.endswith("_date_key"):
        return _tr_date_key(value, "")
    # Extract params from dataType (e.g., "decimal(12,2)" → params="12,2")
    params = ""
    paren_match = re.match(r'^\w+\((.+)\)$', target_data_type.strip())
    if paren_match:
        params = paren_match.group(1)
    handler = TRANSFORM_REGISTRY.get(base)
    if handler and handler not in (_tr_lookup, _tr_fk_resolve, _tr_cast):
        try:
            return handler(value, params)
        except (ValueError, TypeError, OverflowError) as exc:
            logger.debug("Auto-coerce %s→%s failed for %r: %s", field_name, base, value, exc)
            # Return None rather than raw string — NULL is safe, raw string crashes SQL
            return None
    return value


def _log_fk_resolve_summary() -> None:
    """Log summary of fk_resolve cache misses (suppressed warnings)."""
    for params, count in _FK_RESOLVE_WARN_COUNTS.items():
        if count > _FK_RESOLVE_WARN_LIMIT:
            logger.warning("fk_resolve(%s) — %d total misses (cache has %d entries)",
                           params, count, len(_FK_RESOLVE_CACHE.get({}).get(params, {})))


def transform_batch(
    source_data: list[dict],
    mappings: list[dict],
) -> tuple[list[dict], int]:
    """
    Apply FieldMappings to all source rows.
    Returns (transformed_rows, error_count). Rows that raise are skipped.

    Performance: pre-groups mappings by sourceObject to avoid iterating all
    mappings for every row (O(N×M_relevant) instead of O(N×M_total)).
    """
    # Pre-group mappings by sourceObject for O(1) lookup per row
    mappings_by_source: dict[str | None, list[dict]] = defaultdict(list)
    for m in mappings:
        mappings_by_source[m.get("sourceObject")].append(m)

    transformed: list[dict] = []
    errors = 0
    tracer = _active_tracer.get()
    enable_trace = ENABLE_TRACE and tracer is not None
    for idx, row in enumerate(source_data):
        try:
            new_row, trace_fields = _transform_single_row(row, mappings_by_source, enable_trace)
            if new_row:
                transformed.append(new_row)
            if enable_trace:
                tracer.trace_row(idx, row.get("_source_object"), trace_fields)
        except Exception as exc:
            errors += 1
            logger.warning("Row %d transform failed, skipping: %s", idx, exc)
    if errors:
        logger.warning("Transform batch: %d row(s) skipped", errors)
    # Log fk_resolve miss summary (suppressed warnings)
    if _FK_RESOLVE_WARN_COUNTS:
        _log_fk_resolve_summary()
    return transformed, errors


def _apply_mapping_transform(v: Any, rule: str | None, target_type: str | None, field_name: str | None) -> Any:
    """Apply the appropriate transform to a value based on mapping config."""
    if rule:
        return _apply_rule_with_fallback(v, rule, target_type, field_name)
    if target_type:
        return _auto_coerce(v, target_type, field_name)
    return v


def _build_trace_entry(
    src: str, fid: int, field_name: str | None,
    rule: str | None, target_type: str | None, before: Any, after: Any,
) -> dict:
    """Build a trace field entry for the transform tracer."""
    target_label = f"{field_name} (field_{fid})" if field_name else f"field_{fid}"
    return {
        "source_field": src,
        "target_label": target_label,
        "rule": rule or target_type or "",
        "before": before,
        "after": after,
        "ok": True,
    }


def _transform_single_row(
    row: dict, mappings_by_source: dict[str | None, list[dict]], enable_trace: bool = True,
) -> tuple[dict[str, Any], list[dict]]:
    """Apply mappings to one source row; returns the field_<id> dict and trace data."""
    new_row: dict[str, Any] = {}
    trace_fields: list[dict] = []
    row_source = row.get("_source_object")
    # Look up only mappings for this row's source object (+ any with None sourceObject)
    relevant = mappings_by_source.get(row_source, [])
    none_mappings = mappings_by_source.get(None)
    if none_mappings:
        relevant = relevant + none_mappings if relevant else none_mappings
    for m in relevant:
        src  = m.get("sourceField")
        fid  = m.get("canonicalFieldId")
        if not src or src not in row:
            continue
        before = row[src]
        rule = m.get("transformRule")
        target_type = m.get("_targetDataType")
        field_name  = m.get("_fieldName")
        v = _apply_mapping_transform(before, rule, target_type, field_name)
        new_row[f"field_{fid}"] = v
        if enable_trace:
            trace_fields.append(_build_trace_entry(src, fid, field_name, rule, target_type, before, v))
    return new_row, trace_fields


def _try_pipeline_step(result: Any, step: str) -> tuple[Any, bool, bool]:
    """
    Try one pipeline step. Returns (new_result, should_continue, step_recognized).
    """
    if step.lower().startswith("default:"):
        if result is None:
            return step[8:], False, True
        return result, True, True
    if result is None:
        return None, False, True
    m = _RULE_PATTERN.match(step)
    if not m:
        return result, True, False
    handler = TRANSFORM_REGISTRY.get(m.group(1).lower())
    if handler is None:
        return result, True, False
    try:
        return handler(result, m.group(2) or ""), True, True
    except (ValueError, TypeError, OverflowError):
        return result, False, False


def _apply_rule_with_fallback(value: Any, rule: str, target_type: str | None, field_name: str | None) -> Any:
    """
    Apply transform rule; if ANY step is unrecognized, fall back to auto-coercion.
    This makes user-specified rules like 'CAST_DECIMAL' or 'PARSE_DATE; event_type=X'
    degrade gracefully to type-based coercion instead of passing raw values through.
    """
    # CASE WHEN expressions — always apply directly
    if _extract_case_body(rule.strip()) is not None:
        return _apply_case_expression(value, rule.strip())

    had_unknown = False
    result = value
    for step in (s.strip() for s in rule.split("|") if s.strip()):
        result, should_continue, recognized = _try_pipeline_step(result, step)
        if not recognized:
            had_unknown = True
        if not should_continue:
            break

    # If any step was unrecognized, fall back to auto-coercion from target type
    if had_unknown and target_type:
        return _auto_coerce(value, target_type, field_name)
    return result

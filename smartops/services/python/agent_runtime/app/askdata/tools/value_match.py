"""Value matching: links words in a question to values really stored in the data, before the SQL is written.

People type "kap", "kap flowline" or "marmul", not the stored "KAP Flowline" or "Marmul ODC". The SQL Author then
guesses a spelling and the filter finds nothing. This finds the candidates first, the same way the dataset route of
Ask AI does (Tenant API, Features/Ai/ValueMatcher.cs): the question's search words are matched against

  * the full value lists the column profiles keep for columns with few values (tools/column_profile.py), and
  * a small live lookup in the name / code / description / status columns of tables (not views) up to LIVE_MAX_ROWS rows, for
    columns with too many values to keep: ONE parameterised, read-only query (a UNION ALL of small LIKE lookups,
    one per column) within LIVE_BUDGET seconds. Each query costs a round trip to the database, so they are not sent
    one by one.

Only candidates: the block tells the SQL Author which stored values contain which word, and it still decides which
one the question means. Only the columns the SCHEMA block shows are searched (the profiles hold no others).
"""
from __future__ import annotations

import contextvars
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass

from app.askdata.common.connection import get_connection
from app.askdata.log import get_agent_logger
from app.askdata.prompts import msg

log = get_agent_logger("db_assistant")

MAX_TERMS = 8
MAX_PER_TERM = 5
LIVE_MAX_ROWS = 200_000          # larger tables are not searched live
LIVE_MAX_COLUMNS = 40            # columns searched live per question
LIVE_TIMEOUT = 5                 # query timeout of the lookup
LIVE_BUDGET = 3.0                # seconds the question waits for it
WHOLE_WORD = 4                   # a term this short matches only as a whole word ("kap" not in "Kapildev")
_HINT_SUFFIXES = ("name", "code", "description", "desc", "label", "status", "type")

STOP_WORDS = frozenset("""
the and for with from that this what which who whom whose where when how why are was were is be been has have had does
did do can could should would will show list give tell find get display me us our all any each every per by of in on at
to as or not no than then there their its into over under between about only total sum count number many much average
avg mean max maximum min minimum highest lowest top bottom most least more less greater smaller rows row records record
value values year month week day date today last first next previous current those these group grouped breakdown split
trend compare comparison percent percentage ratio rate
""".split())

_QUOTED = re.compile(r"\"([^\"]{2,60})\"|'([^']{2,60})'")
_WORD = re.compile(r"[^\W_][\w\-/&.]*")
_TABLE = re.compile(r"^TABLE\s+(\S+)", re.M)
_COLUMN = re.compile(r"^\s+-\s+(\[[^\]]+\]|\S+)", re.M)


@dataclass(frozen=True)
class Match:
    term: str
    column: str      # schema.table.column
    value: str
    count: int
    approx: bool = False
    lookup: bool = False    # from a column that stores each value once (a reference table): the place to join to


def _schema_words(schema_text: str) -> set[str]:
    names = [t.split(".")[-1] for t in _TABLE.findall(schema_text)] + [c.strip("[]") for c in _COLUMN.findall(schema_text)]
    return {w.lower() for n in names for w in _WORD.findall(n.replace("_", " "))}


def terms(question: str, schema_text: str) -> list[str]:
    """Search words: quoted phrases first, then words of 3+ characters that are not common words or table / column
    names, then two-word phrases of those words. Numbers under 4 digits are skipped ("top 10" matches too much)."""
    known = _schema_words(schema_text)
    out: list[str] = []

    def add(t: str) -> None:
        t = t.strip().strip(".,?!")
        if len(t) >= 2 and t.lower() not in (o.lower() for o in out):
            out.append(t)

    for m in _QUOTED.finditer(question):
        add(m.group(1) or m.group(2))
    rest = _QUOTED.sub(" ", question)
    words = [w.strip(".-/") for w in _WORD.findall(rest)]
    words = [w for w in words if len(w) >= 3 and w.lower() not in STOP_WORDS and w.lower() not in known
             and not (w.isdigit() and len(w) < 4)]
    for w in words:
        if len(out) < MAX_TERMS:
            add(w)
    for a, b in zip(words, words[1:]):
        if len(out) < MAX_TERMS:
            add(f"{a} {b}")
    return out


def _whole(value: str, term: str) -> bool:
    return re.search(rf"(?<![^\W_]){re.escape(term)}(?![^\W_])", value, re.I) is not None


def _contains(value: str, term: str) -> bool:
    return _whole(value, term) if len(term) <= WHOLE_WORD else term.lower() in value.lower()


Hit = tuple[str, str, int, bool, bool]     # column, value, rows, approximate, lookup column


def assign(found_terms: list[str], found: list[Hit]) -> list[Match]:
    """Gives each found value to the most specific search word it contains; per word exact matches first, lookup
    columns first among them (else big tables and views crowd out the reference table), then the most common
    values, at most MAX_PER_TERM."""
    result: list[Match] = []
    for column, value, count, approx, lookup in found:
        contained = [t for t in found_terms if _contains(value, t)]
        if not contained:
            continue
        # A value holding several of the question's words ("Marmul Flowline" for "marmul ... flowline") is the
        # strongest candidate, so it is listed under those words together.
        single = [t for t in contained if " " not in t]
        term = " ".join(single) if len(single) > 1 else max(contained, key=len)
        result.append(Match(term, column, value, count, approx, lookup))
    by_term: dict[str, list[Match]] = {}
    for m in result:
        by_term.setdefault(m.term.lower(), []).append(m)
    ordered: list[Match] = []
    for group in by_term.values():
        group.sort(key=lambda m: (m.value.lower() != m.term.lower(), not _whole(m.value, m.term), not m.lookup,
                                  -m.count, m.value))
        ordered += group[:MAX_PER_TERM]
    return ordered


def unmatched(found_terms: list[str], matches: list[Match], question: str) -> list[str]:
    """Single words and quoted phrases with no match, unless a matched phrase already covers them."""
    matched = {p.lower() for m in matches for p in [*m.term.split(" "), m.term]}
    quoted = {(m.group(1) or m.group(2)).lower() for m in _QUOTED.finditer(question)}
    return [t for t in found_terms
            if t.lower() not in matched and (t.lower() in quoted or " " not in t)
            and not any(t.lower() in m for m in matched)]


def _in_profiles(found_terms: list[str], profiles: dict) -> list[Hit]:
    hits = []
    for table, columns in profiles.items():
        for column, p in columns.items():
            values = p.get("values") or []
            lookup = bool(values) and not p.get("sampled") and all(n == 1 for _v, n in values)
            for value, count in values:
                v = str(value)
                if len(v) <= 200 and any(_contains(v, t) for t in found_terms):
                    hits.append((_name(table, column), v, int(count), bool(p.get("sampled")), lookup))
    return hits


def _live_columns(profiles: dict) -> list[tuple[str, str]]:
    """(table, column) of the label columns whose values are not all in the profile, in small enough tables."""
    picked = []
    for table, columns in profiles.items():
        for column, p in columns.items():
            if p.get("kind") != "text" or p.get("values") or not p.get("distinct"):
                continue
            if p.get("table_rows") is None or p["table_rows"] > LIVE_MAX_ROWS:      # views and big tables
                continue
            if column.endswith(_HINT_SUFFIXES) or column in ("code", "name"):
                picked.append((table, column))
    return picked[:LIVE_MAX_COLUMNS]


def _name(table: str, column: str) -> str:
    """schema.table.column as the SQL must write it ([...] around a column name that is not a plain word)."""
    return f"{table}.{column}" if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", column) else f"{table}.[{column}]"


def _like(term: str) -> str:
    return "%" + term.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]") + "%"


def _lookup(columns: list[tuple[str, str]], found_terms: list[str]) -> list[Hit]:
    """The most common values containing a search word, per column, in ONE query: a round trip costs more than the
    small lookups themselves. Values are cast to one type and collation so the columns can be combined."""
    q = lambda n: "[" + n.replace("]", "]]") + "]"
    patterns = [_like(t) for t in found_terms]
    parts, params = [], []
    for i, (table, column) in enumerate(columns):
        sch, tbl = table.split(".", 1)
        where = " OR ".join(f"{q(column)} LIKE ?" for _ in found_terms)
        parts.append(f"SELECT * FROM (SELECT TOP {MAX_PER_TERM * len(found_terms)} {i} AS c, "
                     f"CAST({q(column)} AS nvarchar(400)) COLLATE DATABASE_DEFAULT AS v, COUNT_BIG(*) AS n "
                     f"FROM {q(sch)}.{q(tbl)} WHERE {where} GROUP BY {q(column)} ORDER BY COUNT_BIG(*) DESC) AS m{i}")
        params += patterns
    conn = get_connection(timeout=LIVE_TIMEOUT, readonly=True)
    try:
        cur = conn.cursor()
        cur.execute(" UNION ALL ".join(parts), *params)
        return [(_name(*columns[c]), str(v), int(n), False, False) for c, v, n in cur.fetchall() if v is not None]
    finally:
        conn.close()


def _live(found_terms: list[str], profiles: dict) -> list[Hit]:
    columns = _live_columns(profiles)
    if not columns:
        return []
    hits: list[Hit] = []
    started = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        # The lookup needs the run's database (a context variable): the task gets a copy. It runs in a thread only
        # so the question stops waiting after LIVE_BUDGET seconds.
        future = pool.submit(contextvars.copy_context().run, _lookup, columns, found_terms)
        hits = future.result(timeout=LIVE_BUDGET)
    except FutureTimeout:
        log.warning("value match: live lookup over the %.0fs budget was skipped", LIVE_BUDGET)
    except Exception as exc:  # noqa: BLE001 - an aid: the question is answered without it
        log.warning("value match: live lookup skipped (%s)", exc)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    log.info("value match: %d columns searched live in %.2fs", len(columns), time.monotonic() - started)
    return hits


def find(question: str, schema_text: str, profiles: dict, live: bool = True) -> tuple[list[Match], list[str]]:
    found_terms = terms(question, schema_text)
    if not found_terms or not profiles:
        return [], []
    hits = _in_profiles(found_terms, profiles)
    left = [t for t in found_terms if not any(_contains(h[1], t) for h in hits)]
    if live and left:
        hits += _live(left, profiles)
    seen, unique = set(), []
    for h in hits:
        if (h[0], h[1]) not in seen:
            seen.add((h[0], h[1]))
            unique.append(h)
    matches = assign(found_terms, unique)
    return matches, unmatched(found_terms, matches, question)


def block(matches: list[Match], missing: list[str]) -> str:
    """The SQL Author's VALUE MATCHES block (askdata.msg.value_* prompts), or "" when there is nothing to say."""
    parts = []
    if matches:
        lines = []
        for term in dict.fromkeys(m.term for m in matches):
            values = "; ".join(msg("value_match_value", COLUMN=m.column, VALUE=m.value.replace("'", "''"),
                                   ROWS=("≈" if m.approx else "") + f"{m.count:,} {'row' if m.count == 1 else 'rows'}")
                               for m in matches if m.term == term)
            lines.append(msg("value_match", TERM=term, VALUES=values))
        parts.append(msg("value_matches", MATCHES="\n".join(lines)))
    if missing:
        parts.append(msg("value_unmatched", TERMS=", ".join(f'"{t}"' for t in missing)))
    return "\n".join(parts)


_BACKGROUND = ThreadPoolExecutor(max_workers=4, thread_name_prefix="askdata-value-match")


def start(question: str, schema_text: str, profiles: dict):
    """for_question in the background, so it runs while the orchestrator works (only the SQL Author needs it): a
    Future of (block, seconds)."""
    def timed() -> tuple[str, float]:
        started = time.monotonic()
        return for_question(question, schema_text, profiles), time.monotonic() - started
    # The lookup needs the run's database (a context variable): the task gets a copy.
    return _BACKGROUND.submit(contextvars.copy_context().run, timed)


def awaited(pending) -> tuple[str, float]:
    """The block start() is building ("" when none was started or it failed)."""
    if pending is None:
        return "", 0.0
    try:
        return pending.result(timeout=LIVE_BUDGET + LIVE_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - an aid: the question is answered without it
        log.warning("value match: skipped (%s)", exc)
        return "", 0.0


def for_question(question: str, schema_text: str, profiles: dict) -> str:
    try:
        return block(*find(question, schema_text, profiles))
    except Exception as exc:  # noqa: BLE001 - an aid: the question is answered without it
        log.warning("value match: skipped (%s)", exc)
        return ""

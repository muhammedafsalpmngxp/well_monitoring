"""Read the rendered schema text and numeric hints (introspect.py) back into structured facts.

The family expansion needs the schema as DATA. Rather than re-query the database, this parses the text introspection
already wrote - so probes are generated from exactly the picture the agents are shown. No table or column name
appears here. THE READERS BELOW AND THE WRITERS IN introspect.py MUST CHANGE TOGETHER (tests round-trip them).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# "TABLE schema.table", optionally followed by "  -- 21,566 rows" or "  -- EMPTY: 0 rows. ..."
_TABLE_RE = re.compile(r"^TABLE\s+(\S+)\s*(?:--\s*(.*?))?\s*$")
_TABLE_ROWS_RE = re.compile(r"([\d,]+)\s+rows")
# "  - col type[(n)][ NOT NULL][ PK]" - the name may be [bracketed]
_COLUMN_RE = re.compile(r"^\s+-\s+(\[[^\]]+\]|\S+)\s+([A-Za-z_]+)(?:\(([^)]*)\))?(\s+NOT NULL)?(\s+PK)?\s*$")
# "  FK: child_col -> schema.table.parent_col"
_FK_RE = re.compile(r"^\s+FK:\s+(\S+)\s*->\s*(\S+)\.(\w+)\s*$")
# "  MANY ROWS PER key - ..." (the key may be [bracketed])
_DUP_RE = re.compile(r"MANY ROWS PER\s+(\[[^\]]+\]|\S+)")
# "core.revenue  (21,566 rows)"
_NUM_TABLE_RE = re.compile(r"^(\S+)\s+\(([\d,]+)\s+rows\)\s*$")
# "  - col: min 0, max 0.3, avg 0.01, stdev 0.03, nulls 0% | <scale prose>"
_NUM_COL_RE = re.compile(
    r"^\s+-\s+(\S+):\s+min\s+(\S+?),\s+max\s+(\S+?),\s+avg\s+(\S+?),\s+stdev\s+(\S+?),"
    r"\s+nulls\s+(<?>?\d+)%\s*\|\s*(.+?)\s*$"
)
# The COMPACT form "  - well_id: 628..37625"
_NUM_COMPACT_RE = re.compile(r"^\s+-\s+(\S+):\s+(-?[\d.eE+]+)\.\.(-?[\d.eE+]+)\s*$")
# "  - col (text): 183 of 642 values do NOT parse ..."
_TXT_BAD_RE = re.compile(r"^\s+-\s+(\S+)\s+\(text\):\s+(\d+)\s+of\s+(\d+)\s+values do NOT parse")
# "  - col (text): only 3 of 997 values parse as a number (0%) - ... NOT a quantity"
_TXT_NONE_RE = re.compile(r"^\s+-\s+(\S+)\s+\(text\):\s+only\s+\d+\s+of\s+(\d+)\s+values parse")

_DATE_TYPES = frozenset(("date", "datetime", "datetime2", "smalldatetime", "datetimeoffset"))
# Types SQL Server cannot compare, sort or group: never an entity key.
_UNSORTABLE = re.compile(r"^\s*(text|ntext|image)\s*$", re.IGNORECASE)


def bare(name: str) -> str:
    """Strip the display brackets the schema text adds to a name that needs quoting."""
    return name[1:-1] if name.startswith("[") and name.endswith("]") else name


def _num(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


@dataclass
class Column:
    name: str
    data_type: str
    nullable: bool = True
    is_pk: bool = False

    @property
    def is_date(self) -> bool:
        return self.data_type.lower() in _DATE_TYPES


@dataclass
class ForeignKey:
    child_column: str
    parent_table: str
    parent_column: str


@dataclass
class NumericStat:
    """What was MEASURED for one column. ``scale`` is the classifier's prose verdict."""

    lo: float | None = None
    hi: float | None = None
    avg: float | None = None
    stdev: float | None = None
    null_pct: int = 0
    scale: str = ""
    text_bad: int = 0
    text_total: int = 0
    text_is_codes: bool = False

    @property
    def is_ratio(self) -> bool:
        s = self.scale.upper()
        return "FRACTION_1" in s or "PERCENT_100" in s or s.startswith("PROPORTION")

    def bounds(self) -> tuple[float, float] | None:
        """The range this column should occupy, chosen on the AVERAGE (the maximum is the value most likely to be
        corrupt - bounds from it would let one bad row widen the range until that row looks legal)."""
        if not self.is_ratio or self.avg is None:
            return None
        if self.avg <= 1.0:
            return (0.0, 1.0)
        if self.avg <= 100.0:
            return (0.0, 100.0)
        return None


@dataclass
class Table:
    name: str
    columns: list[Column] = field(default_factory=list)
    foreign_keys: list[ForeignKey] = field(default_factory=list)
    duplicate_key: str | None = None
    row_count: int | None = None
    stats: dict[str, NumericStat] = field(default_factory=dict)

    @property
    def pk_columns(self) -> list[str]:
        return [c.name for c in self.columns if c.is_pk]

    @property
    def date_columns(self) -> list[Column]:
        return [c for c in self.columns if c.is_date]

    def column(self, name: str) -> Column | None:
        lower = name.lower()
        return next((c for c in self.columns if c.name.lower() == lower), None)

    def entity_column(self) -> str | None:
        """A stable per-row identifier for entity_key: a single-column PK, then a bare "id", then the first *_id
        column, then the first NOT NULL column. text/ntext/image never qualify (they cannot be ordered)."""
        usable = [c for c in self.columns if not _UNSORTABLE.match(c.data_type or "")]
        pks = [p for p in self.pk_columns if any(c.name == p for c in usable)]
        if len(pks) == 1:
            return pks[0]
        for c in usable:
            if c.name.lower() == "id":
                return c.name
        for c in usable:
            if c.name.lower().endswith("_id"):
                return c.name
        for c in usable:
            if not c.nullable:
                return c.name
        return usable[0].name if usable else None


class SchemaIndex:
    def __init__(self, tables: dict[str, Table]) -> None:
        self.tables = tables

    def __len__(self) -> int:
        return len(self.tables)

    def get(self, name: str) -> Table | None:
        return self.tables.get(name)

    @property
    def foreign_keys(self) -> list[tuple[Table, ForeignKey]]:
        return [(t, fk) for t in self.tables.values() for fk in t.foreign_keys]

    @property
    def duplicate_keys(self) -> list[tuple[Table, str]]:
        return [(t, t.duplicate_key) for t in self.tables.values() if t.duplicate_key]


def _parse_schema(text: str) -> dict[str, Table]:
    tables: dict[str, Table] = {}
    current: Table | None = None
    for line in text.splitlines():
        m = _TABLE_RE.match(line)
        if m:
            current = Table(name=m.group(1))
            rows = _TABLE_ROWS_RE.search(m.group(2) or "")
            if rows:
                current.row_count = int(rows.group(1).replace(",", ""))
            tables[current.name] = current
            continue
        if current is None:
            continue
        m = _COLUMN_RE.match(line)
        if m:
            current.columns.append(Column(name=bare(m.group(1)), data_type=m.group(2), nullable=not m.group(4),
                                          is_pk=bool(m.group(5))))
            continue
        m = _FK_RE.match(line)
        if m:
            current.foreign_keys.append(ForeignKey(child_column=bare(m.group(1)), parent_table=m.group(2),
                                                   parent_column=m.group(3)))
            continue
        m = _DUP_RE.search(line)
        if m:
            current.duplicate_key = bare(m.group(1))
    return tables


def _parse_numeric(text: str, tables: dict[str, Table]) -> None:
    current: Table | None = None
    for line in text.splitlines():
        m = _NUM_TABLE_RE.match(line)
        if m:
            current = tables.get(m.group(1))
            if current is not None:
                current.row_count = int(m.group(2).replace(",", ""))
            continue
        if current is None:
            continue
        m = _NUM_COL_RE.match(line)
        if m:
            current.stats[m.group(1)] = NumericStat(lo=_num(m.group(2)), hi=_num(m.group(3)), avg=_num(m.group(4)),
                                                    stdev=_num(m.group(5)), null_pct=int(m.group(6).lstrip("<>")),
                                                    scale=m.group(7))
            continue
        m = _NUM_COMPACT_RE.match(line)
        if m:
            current.stats[m.group(1)] = NumericStat(lo=_num(m.group(2)), hi=_num(m.group(3)))
            continue
        m = _TXT_BAD_RE.match(line)
        if m:
            current.stats[m.group(1)] = NumericStat(text_bad=int(m.group(2)), text_total=int(m.group(3)))
            continue
        m = _TXT_NONE_RE.match(line)
        if m:
            total = int(m.group(2))
            current.stats[m.group(1)] = NumericStat(text_bad=total, text_total=total, text_is_codes=True)


def load_index(schema_text: str, numeric_text: str = "") -> SchemaIndex:
    """The index from the rendered schema (and numeric hints, when there are any)."""
    tables = _parse_schema(schema_text or "")
    if numeric_text:
        _parse_numeric(numeric_text, tables)
    return SchemaIndex(tables)

"""Column profiles (tools/column_profile.py): what each column holds, for the SQL Author."""
from datetime import date

from app.askdata.tools import column_profile as cp


class Cursor:
    """A fake cursor: the aggregate row first, then one value list per listable column."""

    def __init__(self, aggregate, value_lists):
        self.sql, self.aggregate, self.value_lists = [], aggregate, list(value_lists)

    def execute(self, sql, *params):
        self.sql.append(sql)

    def fetchone(self):
        return self.aggregate

    def fetchall(self):
        return self.value_lists.pop(0)


COLUMNS = [("status", "nvarchar", 30, "YES"), ("spud_date", "date", None, "YES"), ("well_id", "int", None, "NO"),
           ("remarks", "nvarchar", -1, "YES")]


def test_a_table_is_profiled_in_one_query_plus_its_value_lists():
    # rows, then per column: non-null, distinct, min, max
    agg = (841, 820, 4, None, None, 700, 650, date(2019, 1, 3), date(2026, 10, 15), 841, 841, 1, 9999, 12, None, None, None)
    cur = Cursor(agg, [[("Active", 512), ("Completed", 299), ("Stopped", 6), ("Suspended", 3)]])
    p = cp.profile_table(cur, "well.well_master", COLUMNS, 841)
    assert "COUNT_BIG(DISTINCT p.[status])" in cur.sql[0] and "TOP 200000" not in cur.sql[0]
    assert p["status"]["values"][0] == ["Active", 512] and p["status"]["empty"] == 21
    assert p["spud_date"]["min"] == "2019-01-03" and p["well_id"]["distinct"] == 841
    assert "distinct" not in p["remarks"] and "values" not in p["remarks"]     # long text: empty share only
    assert len(cur.sql) == 2                                                    # only status gets a value list


def test_a_big_table_is_sampled_and_marked_approximate():
    cur = Cursor((200000, 200000, 3, None, None), [[("A", 9), ("B", 5), ("C", 1)]])
    p = cp.profile_table(cur, "dbo.big", [("kind", "varchar", 10, "NO")], 1_500_000)
    assert "TOP 200000" in cur.sql[0] and p["kind"]["sampled"] and p["kind"]["table_rows"] == 1_500_000
    assert cp.describe(p["kind"]).startswith("3 values: A, B, C")


def test_describe_lists_few_values_shows_ranges_and_empty_share():
    assert cp.describe({"kind": "text", "rows": 841, "empty": 21, "distinct": 2, "values": [["Active", 512], ["Done", 308]]}) \
        == "2 values: Active, Done"   # 2% empty: not notable
    assert cp.describe({"kind": "date", "rows": 10, "empty": 0, "distinct": 9, "min": "2019-01-03", "max": "2026-10-15"}) \
        == "2019-01-03 … 2026-10-15"
    many = [[f"W{i}", 1] for i in range(40)]
    assert cp.describe({"kind": "text", "rows": 40, "empty": 0, "distinct": 40, "values": many}) \
        == "40 values, most common: W0, W1, W2"
    assert cp.describe({"kind": "long", "rows": 5, "empty": 5}) == "always empty"
    assert cp.describe({"kind": "number", "rows": 9, "empty": 0, "distinct": 9, "min": 1, "max": 9}, "crew_id") == ""   # ids: no range


def test_annotate_adds_the_profile_to_each_column_line_only():
    schema = ("TABLE well.well_master\n  - status nvarchar(30)\n  - [Well Name] nvarchar(50) NOT NULL\n  FK: x -> a.b\n\n"
              "VALUE HINTS (real coded values):\n- well.well_status (status_name): Active")
    profiles = {"well.well_master": {"status": {"kind": "text", "rows": 2, "empty": 0, "distinct": 1, "values": [["Active", 2]]},
                                     "well name": {"kind": "text", "rows": 2, "empty": 1, "distinct": 1}}}
    out = cp.annotate(schema, profiles).split("\n")
    assert out[1] == "  - status nvarchar(30) | 1 value: Active"
    assert out[2] == "  - [Well Name] nvarchar(50) NOT NULL | 50% empty"
    assert out[3] == "  FK: x -> a.b" and out[-1] == "- well.well_status (status_name): Active"
    assert cp.annotate(schema, {}) == schema


def test_profiles_are_off_without_a_database(monkeypatch):
    monkeypatch.setenv("ASKDATA_PROFILES", "off")
    assert cp.current() == {}


def test_every_value_type_can_be_cached():
    import json
    import uuid
    from datetime import datetime, time
    from decimal import Decimal
    values = [cp._plain(v) for v in (time(6, 30), datetime(2026, 10, 1, 8, 0), Decimal("1.5"), uuid.UUID(int=1), b"x", None)]
    assert json.loads(json.dumps(values)) == ["06:30:00", "2026-10-01 08:00:00", 1.5, "00000000-0000-0000-0000-000000000001", None, None]

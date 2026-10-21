"""Value matching (tools/value_match.py): words in a question linked to stored values before the SQL is written."""
from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget, run_context
from app.askdata.tools import value_match as vm
from tests.seeded_prompts import runtime_texts

SCHEMA = "TABLE well.well_master\n  - well_id int\n  - cluster_name nvarchar(50)\n  - plant_description nvarchar(80)\n"
PROFILES = {
    "well.well_master": {
        "cluster_name": {"kind": "text", "rows": 841, "distinct": 3, "values": [["Marmul", 400], ["Nimr", 300], ["Amal", 141]]},
        "plant_description": {"kind": "text", "rows": 841, "distinct": 2, "values": [["Marmul ODC", 400], ["Nimr ODC", 441]],
                              "sampled": True},
        "flowline_name": {"kind": "text", "rows": 841, "table_rows": 841, "distinct": 900},
    },
    "dbo.huge": {"remark_name": {"kind": "text", "rows": 200000, "table_rows": 5_000_000, "distinct": 9000}},
    "dbo.vw_wells": {"well_name": {"kind": "text", "rows": 841, "table_rows": None, "distinct": 841}},     # a view
}


def test_terms_skip_common_words_schema_names_and_short_numbers():
    assert vm.terms('How many wells in marmul on "KAP Flowline" in top 10?', SCHEMA) == \
        ["KAP Flowline", "wells", "marmul", "wells marmul"]


def test_matches_come_from_the_profiles_best_first_and_unmatched_words_are_named():
    matches, missing = vm.find("wells in marmul", SCHEMA, PROFILES, live=False)
    assert [(m.term, m.column, m.value) for m in matches] == [
        ("marmul", "well.well_master.cluster_name", "Marmul"), ("marmul", "well.well_master.plant_description", "Marmul ODC")]
    assert matches[1].approx and missing == ["wells"]


def test_a_value_holding_several_words_is_listed_under_them_together():
    found = vm.assign(["marmul", "flowline"], [("t.c", "Marmul Flowline", 3, False, False), ("t.c", "Marmul", 9, False, False)])
    assert [(m.term, m.value) for m in found] == [("marmul flowline", "Marmul Flowline"), ("marmul", "Marmul")]


def test_live_lookups_search_only_label_columns_of_small_tables(monkeypatch):
    seen = []

    def lookup(columns, terms):
        seen.extend((table, column, tuple(terms)) for table, column in columns)
        return [(f"{table}.{column}", "KAP Flowline", 12, False, False) for table, column in columns]
    monkeypatch.setattr(vm, "_lookup", lookup)
    matches, _ = vm.find("wells on the kap flowline", SCHEMA, PROFILES)
    assert seen == [("well.well_master", "flowline_name", ("wells", "kap", "flowline", "wells kap", "kap flowline"))]  # not dbo.huge or the view
    assert (matches[0].term, matches[0].value) == ("kap flowline", "KAP Flowline")


def test_like_patterns_escape_wildcards():
    assert vm._like("50%_[x]") == "%50[%][_][[]x]%"


def test_the_block_uses_the_tenants_texts_and_quotes_values():
    with run_context(AskDataRun(settings=AskDataSettings(), db=DbTarget(server="s", name="n", user="u", password="p"),
                                texts=runtime_texts())):
        text = vm.block([vm.Match("marmul", "well.well_master.cluster_name", "Ma'rmul", 1)], ["wells"])
    assert "well.well_master.cluster_name = 'Ma''rmul' (1 row)" in text and 'No stored value contains: "wells"' in text
    assert vm.block([], []) == ""


def test_short_words_match_only_whole_words():
    found = vm.assign(["kap"], [("t.n", "BASIL KURIEKAPPILLI", 118, False, False), ("t.f", "KAP Flowline", 12, False, False)])
    assert [m.value for m in found] == ["KAP Flowline"]


def test_the_live_lookup_is_one_query_for_all_columns(monkeypatch):
    class Cursor:
        def execute(self, sql, *params):
            self.sql, self.params = sql, params

        def fetchall(self):
            return [(1, "KAP Flowline", 12), (0, None, 3)]

    class Conn:
        cur = Cursor()

        def cursor(self):
            return self.cur

        def close(self):
            pass
    monkeypatch.setattr(vm, "get_connection", lambda **kw: Conn())
    hits = vm._lookup([("well.well_master", "flowline_name"), ("ref.crew", "crew code")], ["kap"])
    assert Conn.cur.sql.count("SELECT TOP 5") == 2 and " UNION ALL " in Conn.cur.sql and Conn.cur.params == ("%kap%",) * 2
    assert hits == [("ref.crew.[crew code]", "KAP Flowline", 12, False, False)]


def test_a_reference_table_value_comes_before_big_tables_and_views():
    profiles = {f"dbo.vw_{i}": {"cluster": {"kind": "text", "rows": 900, "distinct": 2, "values": [["Nimr", 300 + i], ["Amal", 9]]}}
                for i in range(6)}
    profiles["ref.cluster"] = {"cluster_name": {"kind": "text", "rows": 2, "distinct": 2, "values": [["Nimr", 1], ["Marmul", 1]]}}
    matches, _ = vm.find("wells in nimr", SCHEMA, profiles, live=False)
    assert matches[0].column == "ref.cluster.cluster_name" and len(matches) == vm.MAX_PER_TERM


def test_matching_runs_in_the_background_and_the_sql_author_waits_for_it():
    with run_context(AskDataRun(settings=AskDataSettings(), db=DbTarget(server="s", name="n", user="u", password="p"),
                                texts=runtime_texts())):
        block, seconds = vm.awaited(vm.start("wells in amal", SCHEMA, {"well.well_master": PROFILES["well.well_master"] | {
            "flowline_name": {"kind": "text", "rows": 1, "table_rows": None, "distinct": 1}}}))
    assert "well.well_master.cluster_name = 'Amal'" in block and seconds >= 0
    assert vm.awaited(None) == ("", 0.0)

"""The Ask Data route log (trace.route): one numbered line per step, with what each step produced."""
import logging

from app import trace


def test_the_route_log_numbers_the_steps_and_shows_what_each_produced(caplog):
    steps = [("value match", 0.01, [], {"value_matches": "HEAD:\n- \"marmul\": ref.cluster.cluster_name = 'Marmul' (1 row)"}),
             ("orchestrator", 5.8, [{"input": 2552, "output": 125}], {"route": "sql", "validation_error": "", "verify_ok": True}),
             ("sql_author", 5.5, [{"input": 34381, "output": 273}], {"sql": "SELECT COUNT(*) AS n\nFROM well.well_master"}),
             ("validator", 0.0, [], {"validation_error": "SELECT * is not allowed"}),
             ("synthesize", 2.2, [{"input": 4861, "output": 13}], {"answer": "There are 448 wells in Marmul."})]
    with caplog.at_level(logging.INFO, logger="agent_runtime.trace"):
        trace.route("Ask Data (deep)", "how many wells are in marmul", steps,
                    {"route": "sql", "verified": True, "seconds": 20.3, "usage": [c for s in steps for c in s[2]]})
    text = caplog.records[-1].getMessage()
    assert "3 AI calls" in text and "41,794 / 411 tokens" in text
    assert "Step 1:" in text and "Step 5:" in text and "└─ Step 5:" in text
    assert "ref.cluster.cluster_name = 'Marmul'" in text and "SELECT COUNT(*) AS n FROM well.well_master" in text
    assert "route=sql" in text   # each node's own result, not a field another node reset
    assert "rejected: SELECT * is not allowed" in text and '"There are 448 wells in Marmul."' in text

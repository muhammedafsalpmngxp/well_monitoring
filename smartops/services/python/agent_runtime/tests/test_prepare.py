"""Question mode and the setup step (app/prepare.py). Offline: the AI provider and the database are faked."""
import pytest
from pydantic import ValidationError

from app.main import run_events
from app.models import AgentConfig, RunRequest
from app.prepare import extract
from tests.seeded_prompts import runtime_texts

LLM = {"baseUrl": "http://llm", "model": "main", "fastModel": "fast"}
SETUP_SQL = ("SELECT wm.well_id, CAST({{report_date}} AS date) AS report_date, 'LIVE' AS well_state "
             "FROM well.well_master AS wm WHERE wm.well_id = TRY_CONVERT(int, {{well_id}})")
DETAIL_SQL = "SELECT t.task_code FROM well.task_daily AS t WHERE t.well_id = {{well_id}} AND t.ActionOn <= {{report_date}}"
INPUTS = [{"name": "question", "required": False, "description": "Ask in your own words"},
          {"name": "well_id", "type": "number", "required": True, "description": "Well id"},
          {"name": "report_date", "required": True, "description": "Report date as YYYY-MM-DD"}]


def _agent(steps, inputs=INPUTS, goal=None, type_="parallel"):
    return {"name": "Well slippage", "type": type_, "goal": goal, "steps": steps,
            "tools": [{"agent": "sql_query", "action": "table"}], "inputs": inputs}


def _req(steps, values, llm=LLM, **agent):
    return RunRequest.model_validate({"agent": _agent(steps, **agent), "inputs": values, "llm": llm,
                                      "prompts": runtime_texts()})


def reads(values, note=""):
    """A fake fast-model call that 'reads' the question."""
    calls = []

    def chat(llm, messages):
        calls.append(messages)
        import json
        return json.dumps({"values": values, "note": note}), {"input": 30, "output": 8}
    chat.calls = calls
    return chat


def database(rows_for):
    """A fake Saved SQL runner: rows_for(sql, inputs) -> (columns, rows)."""
    seen = []

    def run_sql(sql, action, inputs):
        seen.append({"sql": sql, "inputs": dict(inputs)})
        columns, rows = rows_for(sql, inputs)
        yield {"event": "done", "data": {"answer": f"{len(rows)} rows", "steps": [{"sql": sql}],
                                         "data": {"columns": columns, "rows": rows, "truncated": False}}}
    run_sql.seen = seen
    return run_sql


def no_answer_call(llm, messages):
    raise AssertionError("one Saved SQL table step needs no answer call")


# ── reading the question ───────────────────────────────────────────────────────

def test_extract_fills_the_other_inputs_on_the_fast_model():
    cfg = AgentConfig.model_validate(_agent([{"text": "x", "sql": DETAIL_SQL}]))
    chat = reads({"well_id": "35,543", "report_date": "2026-08-02", "question": "ignored", "cluster": "not an input"})
    values, note, usage = extract(cfg, "slippage for well 35543 on 2 August", _llm(), runtime_texts(), chat=chat)
    assert values == {"well_id": "35543", "report_date": "2026-08-02"}
    assert usage == [{"agent": "agent_runtime.inputs", "model": "fast", "calls": 1, "input": 30, "output": 8}]
    system = chat.calls[0][0][1]
    assert "- well_id (number): Well id" in system and "- question" not in system
    assert chat.calls[0][1] == ("user", "slippage for well 35543 on 2 August")


def test_a_value_that_is_not_a_number_is_dropped_and_noted():
    cfg = AgentConfig.model_validate(_agent([{"text": "x", "sql": DETAIL_SQL}]))
    values, note, _ = extract(cfg, "the well near camp", _llm(), runtime_texts(), chat=reads({"well_id": "near camp"}))
    assert values == {} and "well_id" in note


def test_a_question_fills_the_inputs_and_typed_ones_win():
    db = database(lambda sql, inputs: (["task_code"], [["T1"]]))
    req = _req([{"text": "Open tasks of well {{well_id}}", "sql": DETAIL_SQL}],
               {"question": "slippage for well 35543 on 2 August", "well_id": "", "report_date": "2026-08-01"})
    events = list(run_events(req, extract_chat=reads({"well_id": "35543", "report_date": "2026-08-02"}), run_sql=db,
                             chat=no_answer_call))
    understood = [d for n, d in events if n == "inputs"]
    assert understood == [{"by": "question", "values": {"well_id": "35543"}, "note": ""}]   # the typed date wins
    assert db.seen[0]["inputs"]["well_id"] == "35543" and db.seen[0]["inputs"]["report_date"] == "2026-08-01"
    done = events[-1][1]
    assert done["ok"] and done["steps"][0]["question"] == "Open tasks of well 35543"
    assert [u["agent"] for u in done["usage"]] == ["agent_runtime.inputs"]


def test_without_a_provider_the_question_is_not_read_and_the_missing_input_is_named():
    req = _req([{"text": "x", "sql": DETAIL_SQL}], {"question": "well 35543", "well_id": "", "report_date": "2026-08-02"},
               llm=None)
    events = list(run_events(req, run_sql=database(lambda s, i: (["a"], [[1]]))))
    assert any(n == "status" and "question was not read" in d["stage"] for n, d in events)
    assert events[-1] == ("error", {"message": "Fill in: well_id, or give it in the question"})


def test_an_agent_whose_only_input_is_the_question_makes_no_extra_call():
    """Ask Data agents often have just a "question" input: nothing to fill, so no call and no "Understood as"."""
    def answer(llm, messages):
        return "x", {"input": 1, "output": 1}

    def no_extract(llm, messages):
        raise AssertionError("nothing to read from the question")
    req = _req([{"text": "{{question}}", "sql": "SELECT 1 AS one"}, {"text": "b", "sql": "SELECT 2 AS two"}],
               {"question": "how many wells?"}, inputs=[{"name": "question", "required": True}])
    events = list(run_events(req, extract_chat=no_extract, chat=answer, run_sql=database(lambda s, i: (["n"], [[1]]))))
    assert events[-1][0] == "done" and not [d for n, d in events if n == "inputs"]


def test_every_field_typed_in_means_no_call():
    req = _req([{"text": "x", "sql": DETAIL_SQL}], {"question": "well 1", "well_id": "35543", "report_date": "2026-08-02"})
    events = list(run_events(req, extract_chat=no_answer_call, chat=no_answer_call,
                             run_sql=database(lambda s, i: (["a"], [[1]]))))
    assert events[-1][0] == "done" and not [d for n, d in events if n == "inputs"]


def test_runs_without_a_question_need_no_extraction_prompts():
    """A runtime deployed before the Tenant API seeded agent.extract_* still runs agents that read no question."""
    texts = {k: v for k, v in runtime_texts().items() if not k.startswith("agent.extract_")}
    req = RunRequest.model_validate({"agent": _agent([{"text": "a", "sql": DETAIL_SQL}, {"text": "b", "sql": DETAIL_SQL}],
                                                     inputs=[{"name": "well_id"}, {"name": "report_date"}]),
                                     "inputs": {"well_id": "1", "report_date": "2026-08-02"}, "llm": LLM, "prompts": texts})
    events = list(run_events(req, chat=lambda llm, m: ("x", {"input": 1, "output": 1}),
                             run_sql=database(lambda s, i: (["a"], [[1]]))))
    assert events[-1][0] == "done"


def test_a_bad_step_after_the_setup_step_is_named_by_its_editor_number():
    req = _req([{"text": "Resolve", "kind": "setup", "sql": SETUP_SQL}, {"text": "Wipe", "sql": "DELETE FROM dbo.t"}],
               {"well_id": "1", "report_date": "2026-08-02"}, llm=None)
    events = list(run_events(req, run_sql=database(lambda s, i: (["well_id"], [[1]]))))
    assert events[-1][0] == "error" and "Step 2 ('Wipe')" in events[-1][1]["message"]


def test_an_agent_without_question_or_setup_still_checks_inputs_first():
    req = _req([{"text": "x", "sql": DETAIL_SQL}], {"well_id": ""},
               inputs=[{"name": "well_id", "required": True}, {"name": "report_date", "required": False}])
    db = database(lambda s, i: (["a"], [[1]]))
    assert list(run_events(req, run_sql=db)) == [("error", {"message": "Fill in: well_id"})] and db.seen == []


# ── the setup step ─────────────────────────────────────────────────────────────

def _slippage_steps():
    return [{"text": "Resolve well {{well_id}}", "kind": "setup", "sql": SETUP_SQL},
            {"text": "Task detail for well {{well_id}}", "sql": DETAIL_SQL},
            {"text": "Milestones", "sql": "SELECT wm.well_id FROM well.well_master AS wm"}]


def test_setup_runs_first_and_its_row_sets_the_inputs_for_every_other_step():
    def rows(sql, inputs):
        if "TRY_CONVERT" in sql:
            return ["well_id", "report_date", "well_state"], [[35543, "2026-08-02", "LIVE"]]
        return ["task_code"], [["T1"], ["T2"]]
    db = database(rows)
    req = _req(_slippage_steps(), {"question": "", "well_id": "35543", "report_date": ""}, llm=None)
    events = list(run_events(req, run_sql=db))
    assert db.seen[0]["sql"] == SETUP_SQL
    assert all(s["inputs"]["report_date"] == "2026-08-02" for s in db.seen[1:])   # the blank date was resolved
    assert ("inputs", {"by": "setup", "values": {"well_id": "35543", "report_date": "2026-08-02"}, "note": ""}) in events
    done = events[-1][1]
    assert [s["step"] for s in done["steps"]] == [1, 2, 3]                   # the editor's numbering is kept
    assert done["steps"][0]["setup"] is True and done["steps"][1]["question"] == "Task detail for well 35543"
    assert done["ok"]


def test_setup_finding_nothing_stops_the_run_before_the_other_steps():
    db = database(lambda sql, inputs: (["well_id", "report_date"], []))
    req = _req(_slippage_steps(), {"well_id": "99999", "report_date": "2026-08-02"}, llm=None)
    events = list(run_events(req, run_sql=db))
    assert len(db.seen) == 1
    assert events[-1][0] == "error" and "found nothing for these inputs (well_id = 99999" in events[-1][1]["message"]
    end = [d for n, d in events if n == "step" and d["phase"] == "end"][0]
    assert end["setup"] and not end["ok"]


def test_question_then_setup_then_the_steps():
    def rows(sql, inputs):
        if "TRY_CONVERT" in sql:
            return ["well_id", "report_date"], [[35543, "2026-08-04"]]
        return ["task_code"], [["T1"]]
    db = database(rows)
    req = _req(_slippage_steps(), {"question": "how is well 35543 doing", "well_id": "", "report_date": ""},
               goal="Answer: {{question}}")
    seen = []

    def answer(llm, messages):
        seen.append(messages)
        return "Well 35543 has one open task.", {"input": 50, "output": 9}
    events = list(run_events(req, extract_chat=reads({"well_id": "35543"}), run_sql=db, chat=answer))
    order = [n for n, _ in events if n in ("inputs", "step")]
    assert order[:2] == ["inputs", "step"] and [d["by"] for n, d in events if n == "inputs"] == ["question", "setup"]
    assert "Goal: Answer: how is well 35543 doing" in seen[0][0][1]
    done = events[-1][1]
    assert done["inputs"]["report_date"] == "2026-08-04"
    assert [u["agent"] for u in done["usage"]] == ["agent_runtime.inputs", "agent_runtime.answer"]


@pytest.mark.parametrize("steps, message", [
    ([{"text": "a", "sql": DETAIL_SQL}, {"text": "s", "kind": "setup", "sql": SETUP_SQL}], "Only the first step"),
    ([{"text": "s", "kind": "setup", "sql": SETUP_SQL, "tool": {"agent": "ask_data", "action": "deep"}},
      {"text": "a", "sql": DETAIL_SQL}], "must use Saved SQL"),
    ([{"text": "s", "kind": "setup", "sql": SETUP_SQL}], "at least one step after"),
    ([{"text": "s", "kind": "setup", "sql": SETUP_SQL, "id": "s1"}, {"text": "a", "sql": DETAIL_SQL, "id": "a", "next": "s1"}],
     "go back to the setup step"),
])
def test_setup_rules(steps, message):
    with pytest.raises(ValidationError, match=message):
        AgentConfig.model_validate(_agent(steps, type_="sequential"))


def _llm():
    from app.models import Llm
    return Llm.model_validate(LLM)

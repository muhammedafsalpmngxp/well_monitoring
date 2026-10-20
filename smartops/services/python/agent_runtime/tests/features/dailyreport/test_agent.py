"""The agentic layer: deterministic verifier, tools, plans, the graph, the answer cache and revisions -- offline
(ported from the original test_agentic.py). The model is the conftest's FakeModel at app.features.common.llm.chat,
answering per role."""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from app.features.dailyreport import data
from app.features.dailyreport.agent import service as agent_service
from app.features.dailyreport.agent import tools, verifier
from app.features.dailyreport.agent.graph import heuristic_plan, validate_plan
from app.features.dailyreport.settings import load_settings
from app.features.dailyreport.texts import parse_entries
from tests.features.dailyreport.conftest import (
    REPORT_DATE,
    TODAY,
    activity_row,
    make_row,
    report_context,
    seed_prompts,
    seed_settings,
)

REPORTING_WELL = 101
QUIET_WELL = 30349
GOOD_WELL_ANSWER = "Well 30349 reported nothing on the date and has 3 open tasks: 2 ongoing and 1 incomplete."


@pytest.fixture
def world(fake_db):
    """Well 101 reported one task on the date; well 30349 reported nothing but has 3 open tasks. Well 30349 has a
    rig-on deadline in 4 days, well 101 a FLAF deadline 3 days past (the tenant's today)."""
    fake_db.set(data.DAILY_DETAILS, [make_row(task_daily_id=1, well_id=REPORTING_WELL, planned=10, actual_quantity=10)])
    fake_db.set(data.DAILY_SUMMARY, [])
    fake_db.set(data.WELL_ACTIVITY, [activity_row(
        well_id=QUIET_WELL, logical_task_count=5, completed_task_count=2, open_task_count=3, incomplete_task_count=1,
        ongoing_task_count=2, not_started_task_count=1, ended_not_completed_task_count=0,
        last_task_date=date(2026, 7, 20))])
    fake_db.set(data.WELL_DETAIL, [])
    fake_db.set(data.MILESTONES, [
        {"well_id": QUIET_WELL, "milestone": "RIG_ON", "deadline_date": TODAY + timedelta(days=4)},
        {"well_id": REPORTING_WELL, "milestone": "FLAF", "deadline_date": TODAY - timedelta(days=3)},
    ])
    return fake_db


def _issue(kind, **values):
    from app.features.common.text import fill
    return fill(parse_entries(seed_prompts()["dailyreport.verifier_issues"])[kind], **values)


def _verify(draft, evidence, question=""):
    phrases = seed_settings()["forbiddenPhrases"]
    return verifier.verify(draft, evidence, issue=_issue, forbidden_phrases=phrases, question=question)


# ---------------------------------------------------------------------------------------------------------------
# verifier
# ---------------------------------------------------------------------------------------------------------------
class TestVerifier:
    EVIDENCE = [{"result": {"well_id": 30349, "open_task_count": 3, "date": "2026-07-20", "status": "LATE"}}]

    def test_figures_from_the_evidence_pass(self):
        check = _verify("Well 30349 has 3 open tasks, last seen 2026-07-20.", self.EVIDENCE)
        assert check.passed, check.issues

    def test_an_invented_figure_fails_with_the_tenants_wording(self):
        check = _verify("Well 30349 has 7 open tasks.", self.EVIDENCE)
        assert check.issues == ["the figure 7 is not in the evidence"]

    def test_an_invented_date_fails(self):
        assert not _verify("Last seen 2026-07-21.", self.EVIDENCE).passed

    def test_a_judgement_no_rule_defines_fails(self):
        assert any("at risk" in issue for issue in _verify("Well 30349 is at risk.", self.EVIDENCE).issues)

    def test_a_word_the_evidence_carries_as_a_status_code_is_allowed(self):
        assert _verify("The end date status is late.", self.EVIDENCE).passed

    def test_a_field_name_in_the_prose_fails(self):
        assert any("open_task_count" in i for i in _verify("The open_task_count is 3.", self.EVIDENCE).issues)

    def test_list_numbering_is_not_a_figure(self):
        assert _verify("1. Well 30349\n2. 3 open tasks", self.EVIDENCE).passed

    def test_thousands_separators_and_decimals_are_normalised(self):
        assert _verify("1,226 tasks and 10.5 units.", [{"result": {"total": 1226, "qty": "10.5000"}}]).passed

    def test_the_forbidden_phrases_are_the_tenants(self):
        check = verifier.verify("Well 30349 is on track.", self.EVIDENCE, issue=_issue, forbidden_phrases=["idle"])
        assert check.passed


# ---------------------------------------------------------------------------------------------------------------
# tools and plans
# ---------------------------------------------------------------------------------------------------------------
def _env(ctx):
    return tools.ToolEnv(ctx, REPORT_DATE, TODAY)


class TestTools:
    def test_unknown_tool_is_refused_as_data(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "drop_table", {})
        assert not result.ok and result.error == "unknown tool 'drop_table'"

    def test_bad_arguments_are_refused_not_guessed(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "well_overview", {"well_id": "thirty"})
        assert not result.ok and "whole number" in result.error

    def test_list_wells_without_a_report_but_with_open_work(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "list_wells", {"filter": "no_report_with_open_work"})
        assert result.ok and [w["well_id"] for w in result.result["wells"]] == [QUIET_WELL]

    def test_an_unknown_filter_is_refused(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "list_wells", {"filter": "late_wells"})
        assert not result.ok and "'filter' must be one of" in result.error

    def test_deadline_pressure_joins_deadlines_to_open_work(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "deadline_pressure", {})
        before = result.result["open_work_before_upcoming_deadline"]
        assert [(r["well_id"], r["open_task_count"], r["milestone"]) for r in before] == [(QUIET_WELL, 3, "Rig-on")]
        assert result.result["open_work_past_overdue_deadline"] == []      # well 101 has no open work
        assert "within 7 day(s)" in result.result["rule"]

    def test_milestones_are_evaluated_against_the_requests_today(self, world):
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "milestones", {"window_days": 999})
        assert result.result["today"] == TODAY
        assert result.result["window_days"] == seed_settings()["milestonesToolMaxWindowDays"]

    def test_a_database_failure_is_data_not_a_crash(self, world):
        world.failing.add(data.DAILY_DETAILS)
        with report_context() as ctx:
            result = tools.run_tool(_env(ctx), "data_quality", {})
        assert not result.ok and result.error.startswith("the tool failed:")

    def test_the_catalog_is_the_tenants_text_with_the_limits_filled_in(self):
        with report_context() as ctx:
            catalog = tools.catalog(ctx)
        assert [t["name"] for t in catalog] == list(tools.TOOLS)
        list_wells = next(t for t in catalog if t["name"] == "list_wells")
        assert list_wells["args"]["limit"] == "integer, default 15, max 50"
        with report_context(prompts={"dailyreport.tool_day_overview": "Day.\n- sql: anything"}) as ctx:
            day = tools.catalog(ctx)[0]
        assert day == {"name": "day_overview", "description": "Day.", "args": {}}   # an argument it does not take


class TestPlans:
    def test_validate_plan_keeps_known_tools_and_their_arguments_only(self):
        plan = validate_plan([{"tool": "deadline_pressure", "args": {"limit": 5, "sql": "DROP"}, "why": "x" * 500},
                              {"tool": "invented"}, "junk"], max_steps=6, reason_max_chars=10)
        assert plan == [{"tool": "deadline_pressure", "args": {"limit": 5}, "why": "x" * 10}]

    def test_heuristic_plan_uses_the_settings_vocabulary(self):
        s = load_settings(seed_settings())
        assert [st["tool"] for st in heuristic_plan("What is happening on well 30349?", s)] == [
            "well_overview", "milestones"]
        assert [st["tool"] for st in heuristic_plan("Which deadlines are near?", s)] == ["deadline_pressure"]
        assert [st["tool"] for st in heuristic_plan("Which wells did not report?", s)] == ["list_wells"]
        assert [st["tool"] for st in heuristic_plan("Tell me about today", s)] == ["day_overview"]
        custom = load_settings({**seed_settings(), "heuristicWellWords": ["bore"], "heuristicDeadlineKeywords": []})
        assert heuristic_plan("bore 30349 status", custom)[0]["args"] == {"well_id": 30349}
        assert [st["tool"] for st in heuristic_plan("Which deadlines?", custom)] == ["day_overview"]


# ---------------------------------------------------------------------------------------------------------------
# the graph
# ---------------------------------------------------------------------------------------------------------------
def _brief(**kwargs):
    ctx_overrides = kwargs.pop("ctx", {})
    with report_context(**ctx_overrides) as ctx:
        return agent_service.brief(ctx, REPORT_DATE, today=TODAY, **kwargs)


def _ask(question, **ctx_overrides):
    with report_context(**ctx_overrides) as ctx:
        return agent_service.ask(ctx, REPORT_DATE, question, today=TODAY)


class TestBrief:
    def test_a_well_brief_runs_a_fixed_plan_and_is_verified(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        result = _brief(scope="well", well_id=QUIET_WELL)
        assert result["available"] and result["verified"], result["verification"]
        assert result["explanation"] == GOOD_WELL_ANSWER
        assert [s["tool"] for s in result["plan"]] == ["well_overview", "milestones"]
        assert [t["node"] for t in result["trace"]] == ["plan", "tool", "tool", "write", "verify"]
        assert fake_model.count("planner") == 0
        assert result["models"]["writer"] == "writer-model"
        assert result["evidence"]["well_task_activity"]
        assert result["usage"] == [{"agent": "dailyreport.writer", "model": "writer-model", "calls": 1, "input": 10,
                                    "output": 5}]

    def test_the_writer_is_given_the_tenants_prompts(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        _brief(scope="well", well_id=QUIET_WELL)
        call = fake_model.calls[0]
        prompts = seed_prompts()
        assert call["system"].startswith(prompts["dailyreport.explain_system"] + "\n\n" + "YOU ARE NOW WRITING")
        assert "Keep the whole answer under 250 words." in call["system"]
        assert call["user"].startswith("Report date: 2026-08-01\n\nTool results (authoritative):\n[")
        assert "Question:" not in call["user"]
        assert call["max_tokens"] == seed_settings()["writerMaxTokens"]
        assert call["temperature"] == seed_settings()["temperature"]

    def test_the_same_brief_is_reused(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        first = _brief(scope="well", well_id=QUIET_WELL)
        second = _brief(scope="well", well_id=QUIET_WELL)
        assert first["cached"] is False and second["cached"] is True
        assert second["explanation"] == first["explanation"] and second["verified"]
        assert fake_model.count("writer") == 1
        assert second["usage"] == []

    def test_refresh_drops_the_reused_answer(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        _brief(scope="well", well_id=QUIET_WELL)
        with report_context() as ctx:
            ctx.data.invalidate_date(REPORT_DATE)
        assert _brief(scope="well", well_id=QUIET_WELL)["cached"] is False
        assert fake_model.count("writer") == 2

    def test_a_changed_prompt_or_model_is_never_served_an_old_answer(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        _brief(scope="well", well_id=QUIET_WELL)
        _brief(scope="well", well_id=QUIET_WELL,
               ctx={"prompts": {"dailyreport.explain_system": "Explain the evidence briefly."}})
        _brief(scope="well", well_id=QUIET_WELL, ctx={"settings": {"writerTier": "fast"}})
        assert fake_model.count("writer") == 3

    def test_a_rejected_draft_is_revised(self, world, fake_model):
        fake_model.answers["writer"] = ["Well 30349 has 47 open tasks and is delayed.", GOOD_WELL_ANSWER]
        result = _brief(scope="well", well_id=QUIET_WELL)
        assert result["verified"] and result["revisions"] == 1
        revision = fake_model.calls[-1]["user"]
        assert "Your previous draft was rejected by the verifier for these reasons:\n- " in revision
        assert "47" in revision and "Write a corrected answer that fixes every issue." in revision

    def test_revisions_are_bounded_and_an_unverified_answer_says_so(self, world, fake_model):
        fake_model.answers["writer"] = ["Well 30349 has 47 open tasks."]
        result = _brief(scope="well", well_id=QUIET_WELL)
        assert result["available"] and not result["verified"]
        assert result["revisions"] == 2 and fake_model.count("writer") == 3
        assert result["verification"]["issues"]
        # An unverified answer is never reused.
        assert _brief(scope="well", well_id=QUIET_WELL)["cached"] is False

    def test_the_revision_limit_is_a_setting(self, world, fake_model):
        fake_model.answers["writer"] = ["Well 30349 has 47 open tasks."]
        result = _brief(scope="well", well_id=QUIET_WELL, ctx={"settings": {"agentMaxRevisions": 0}})
        assert result["revisions"] == 0 and fake_model.count("writer") == 1

    def test_the_day_brief_has_its_own_model_tokens_and_word_limit(self, world, fake_model):
        fake_model.answers["writer"] = ["Well 101 reported 1 task on the date."]
        result = _brief(scope="day", ctx={"settings": {"dayWriterTier": "fast", "dayWriterMaxTokens": 4000}})
        assert [s["tool"] for s in result["plan"]] == ["day_overview", "deadline_pressure", "data_quality"]
        assert result["models"]["writer"] == "fast-model" and result["verified"]
        call = fake_model.calls[0]
        assert call["agent"] == "day_writer" and call["fast"] is True and call["max_tokens"] == 4000
        assert "under 350 words" in call["system"]
        assert result["evidence"]["live_well_task_activity"]

    def test_a_task_brief_carries_the_crew_evidence(self, world, fake_model):
        world.set(data.CREW_SUGGESTION, [])
        fake_model.answers["writer"] = ["Well 101 reported 1 task."]
        result = _brief(scope="task", task_daily_id=1)
        assert result["available"] and world.count(data.CREW_SUGGESTION) == 1

    def test_nothing_to_explain_is_not_sent_to_a_model(self, world, fake_model):
        result = _brief(scope="well", well_id=999999)
        assert not result["available"] and fake_model.count("writer") == 0
        assert result["error"] == seed_prompts()["dailyreport.answer_nothing_to_explain"]

    def test_a_database_failure_is_reported_not_called_nothing(self, world, fake_model):
        world.failing.add(data.DAILY_DETAILS)
        result = _brief(scope="day")
        assert not result["available"] and "could not" not in (result["explanation"] or "")
        assert result["error"].startswith("the tool failed:") and fake_model.count("day_writer") == 0

    def test_no_ai_provider_is_available_false_never_fabricated(self, world, fake_model):
        result = _brief(scope="well", well_id=QUIET_WELL, ctx={"llm": None})
        assert result["available"] is False and result["explanation"] is None
        assert "No AI provider" in result["error"]

    def test_a_provider_error_is_contained(self, world, fake_model):
        fake_model.failing.add("writer")
        result = _brief(scope="well", well_id=QUIET_WELL)
        assert result["available"] is False
        assert result["error"] == "The AI service could not be reached or returned an error."

    def test_the_ai_second_opinion_can_send_a_draft_back(self, world, fake_model):
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        fake_model.answers["verifier"] = ['{"ok": false, "issues": ["presents a crew as an assignment"]}',
                                          '{"ok": true, "issues": []}']
        result = _brief(scope="well", well_id=QUIET_WELL, ctx={"settings": {"llmVerify": True}})
        assert result["verified"] and result["revisions"] == 1
        assert fake_model.count("verifier") == 2
        first = next(c for c in fake_model.calls if c["agent"] == "verifier")
        assert first["system"] == seed_prompts()["dailyreport.verifier_system"] and first["json_mode"]
        assert first["user"].startswith("Tool results:\n[") and first["user"].endswith("Draft:\n" + GOOD_WELL_ANSWER)


class TestAsk:
    def test_the_planner_chooses_tools_and_its_plan_is_validated(self, world, fake_model):
        fake_model.answers["planner"] = [
            '{"steps": [{"tool": "deadline_pressure", "args": {"limit": 5, "sql": "DROP"}, "why": "deadlines"},'
            '{"tool": "invented_tool", "args": {}, "why": "x"}]}']
        fake_model.answers["writer"] = ["Well 30349 has 3 open tasks before an upcoming Rig-on deadline."]
        result = _ask("Which wells need attention before their deadlines?")
        assert [s["tool"] for s in result["plan"]] == ["deadline_pressure"]
        assert result["plan"][0]["args"] == {"limit": 5}
        assert result["verified"]
        planner = fake_model.calls[0]
        assert planner["json_mode"] and "At most 6 steps." in planner["system"]
        assert planner["user"].startswith("Report date: 2026-08-01\n\nTools:\n[")
        assert planner["user"].endswith("Question: Which wells need attention before their deadlines?")
        writer = fake_model.calls[1]
        assert "\nQuestion: Which wells need attention before their deadlines?\n\nTool results" in writer["user"]

    def test_an_unanswerable_question_is_said_to_be_so(self, world, fake_model):
        fake_model.answers["planner"] = ['{"steps": [], "unanswerable_reason": "costs are not in the report"}']
        result = _ask("How much did well 30349 cost?")
        assert result["available"] and fake_model.count("writer") == 0
        assert result["explanation"] == ("This question cannot be answered from the daily report's data: "
                                         "costs are not in the report")

    def test_a_failed_planner_falls_back_to_a_heuristic_plan(self, world, fake_model):
        fake_model.failing.add("planner")
        fake_model.answers["writer"] = [GOOD_WELL_ANSWER]
        result = _ask("What is happening on well 30349?")
        assert [s["tool"] for s in result["plan"]] == ["well_overview", "milestones"]
        assert "heuristic" in result["trace"][0]["mode"]

    def test_an_unreadable_plan_falls_back_too(self, world, fake_model):
        fake_model.answers["planner"] = ["I think you should look at the wells."]
        fake_model.answers["writer"] = ["Nothing stands out."]
        result = _ask("Anything on the day?")
        assert [s["tool"] for s in result["plan"]] == ["day_overview"]

    def test_the_question_is_part_of_the_reuse_key(self, world, fake_model):
        fake_model.answers["planner"] = ['{"steps": [{"tool": "list_wells", "args": {}}]}']
        fake_model.answers["writer"] = ["Well 30349 has 3 open tasks."]
        _ask("Which wells have open work?")
        assert _ask("Which wells have open work?")["cached"] is True
        assert _ask("Which wells have open work now?")["cached"] is False

    def test_the_tool_results_reach_the_writer_as_json(self, world, fake_model):
        fake_model.answers["planner"] = ['{"steps": [{"tool": "list_wells", "args": {"filter": "all"}}]}']
        fake_model.answers["writer"] = ["Well 30349 has 3 open tasks."]
        _ask("List the wells.")
        user = fake_model.calls[1]["user"]
        results = json.loads(user.split("Tool results (authoritative):\n", 1)[1])
        assert results[0]["tool"] == "list_wells" and results[0]["result"]["filter"] == "all"

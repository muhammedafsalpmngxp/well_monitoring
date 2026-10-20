"""The advice store: reuse while the data, prompts, settings and model are unchanged; fresh; TTL; LRU size; database
identity; failures not stored; concurrent requests for the same data share one model call."""
from __future__ import annotations

import logging
import threading

from app.features.slippage import advisor
from tests.features.slippage import _support as S

pytestmark = S.requires_seed

TASK = "FLME1180-3035"


def task(client, body, **extra):
    return client.post("/slippage/advise-task", json={**body, "wellId": S.WELL, "taskCode": TASK, **extra}).json()


def well(client, body, well_id=S.WELL, **extra):
    return client.post("/slippage/advise-well", json={**body, "wellId": well_id, **extra}).json()


def test_same_data_is_served_from_the_store(client, body, fake_db, fake_llm):
    first, second = task(client, body), task(client, body)
    assert (first["cached"], second["cached"]) == (False, True)
    assert len(fake_llm.calls) == 1
    assert second["usage"] == [] and len(first["usage"]) == 1          # no model call, nothing to bill
    assert second["advice"] == first["advice"] and second["generated_at"] == first["generated_at"]
    assert fake_db.keys_called().count("activity_delay") == 2          # the data is read on every request


def test_tied_rows_in_another_order_are_the_same_data(client, body, fake_db, fake_llm):
    task(client, body)
    fake_db.activity[S.WELL] = list(reversed(fake_db.activity[S.WELL]))
    assert task(client, body)["cached"] is True
    assert len(fake_llm.calls) == 1


def test_fresh_asks_again(client, body, fake_llm):
    task(client, body)
    again = task(client, body, fresh=True)
    assert again["cached"] is False and len(fake_llm.calls) == 2
    assert task(client, body)["cached"] is True                        # the fresh answer is stored


def test_changed_data_asks_again(client, body, fake_db, fake_llm):
    task(client, body)
    fake_db.results["crew_availability"][1][3]["open_tasks"] = 7      # crew 202: a candidate of this task's type
    assert task(client, body)["cached"] is False
    fake_db.activity[S.WELL][1]["end_variance_days"] = 11             # another task on the well
    assert task(client, body)["cached"] is False
    assert len(fake_llm.calls) == 3


def test_a_crew_of_an_unrelated_type_does_not_expire_a_task_answer(client, body, fake_db, fake_llm):
    task(client, body)
    fake_db.results["crew_availability"][1][7]["open_tasks"] = 9      # crew 999, type 555
    assert task(client, body)["cached"] is True


def test_changed_prompt_asks_again(client, body, fake_llm):
    task(client, body)
    body["prompts"]["slippage.advisor_task_system"] += "\nBe brief."
    assert task(client, body)["cached"] is False
    body["prompts"]["slippage.msg_none"] = "(nothing)"                 # a message part counts too
    assert task(client, body)["cached"] is False
    assert len(fake_llm.calls) == 3


def test_changed_settings_and_model(client, body, fake_llm):
    task(client, body)
    body["settings"]["maxCandidates"] = 3
    assert task(client, body)["cached"] is False
    body["settings"]["adviceCacheSize"] = 400                          # does not shape the answer
    assert task(client, body)["cached"] is True
    body["llm"]["model"] = "another-model"
    assert task(client, body)["cached"] is False


def test_another_database_never_shares_an_answer(client, body, fake_llm):
    task(client, body)
    body["db"]["name"] = "OtherTenantDb"
    assert task(client, body)["cached"] is False


def test_well_and_task_answers_are_kept_apart(client, body, fake_llm):
    task(client, body)
    assert well(client, body)["cached"] is False
    assert well(client, body)["cached"] is True and task(client, body)["cached"] is True
    assert len(fake_llm.calls) == 2


def test_ttl_zero_never_reuses(client, body, fake_llm):
    body["settings"]["adviceCacheTtlSeconds"] = 0
    task(client, body)
    assert task(client, body)["cached"] is False and len(fake_llm.calls) == 2


def test_an_answer_expires_after_the_ttl(body, ctx, monkeypatch, fake_llm):
    body["settings"]["adviceCacheTtlSeconds"] = 60
    clock = [1000.0]
    monkeypatch.setattr(advisor.time, "monotonic", lambda: clock[0])
    with ctx(body) as (_, cfg):
        assert advisor.suggest_well(S.WELL, cfg)["cached"] is False
        clock[0] += 59
        assert advisor.suggest_well(S.WELL, cfg)["cached"] is True
        clock[0] += 2
        assert advisor.suggest_well(S.WELL, cfg)["cached"] is False
    assert len(fake_llm.calls) == 2


def test_store_is_bounded_least_recently_used_first(client, body, fake_llm):
    body["settings"]["adviceCacheSize"] = 1
    well(client, body, S.WELL)
    well(client, body, S.OTHER_WELL)
    assert well(client, body, S.WELL)["cached"] is False              # dropped to make room
    assert len(advisor._cache) == 1 and len(fake_llm.calls) == 3


def test_size_zero_keeps_nothing(client, body, fake_llm):
    body["settings"]["adviceCacheSize"] = 0
    well(client, body)
    assert well(client, body)["cached"] is False and len(advisor._cache) == 0


def test_a_failure_is_not_stored(client, body, fake_llm):
    fake_llm.error = TimeoutError("slow")
    r = client.post("/slippage/advise-well", json={**body, "wellId": S.WELL})
    assert r.status_code == 503
    fake_llm.error = None
    assert well(client, body)["cached"] is False
    assert well(client, body)["cached"] is True
    assert advisor._inflight == {}


def test_concurrent_requests_for_the_same_data_share_one_call(body, ctx, fake_llm):
    entered, release, joined = threading.Event(), threading.Event(), threading.Event()

    def block() -> None:
        entered.set()
        assert release.wait(10)

    class Joined(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            if "already being answered" in record.getMessage():
                joined.set()

    fake_llm.before = block
    logger = logging.getLogger("agent_runtime.slippage")
    handler, level = Joined(), logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    results: dict[str, dict] = {}
    errors: list[BaseException] = []

    def ask(name: str) -> None:
        try:
            with ctx(body) as (run, cfg):
                results[name] = {**advisor.suggest_well(S.WELL, cfg), "usage": list(run.usage)}
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    try:
        leader = threading.Thread(target=ask, args=("leader",))
        leader.start()
        assert entered.wait(10)
        follower = threading.Thread(target=ask, args=("follower",))
        follower.start()
        assert joined.wait(10)                 # the follower is waiting on the leader's call
        release.set()
        leader.join(10)
        follower.join(10)
    finally:
        release.set()
        logger.removeHandler(handler)
        logger.setLevel(level)

    assert errors == []
    assert len(fake_llm.calls) == 1
    assert results["follower"]["cached"] is False                     # generated for this moment, not stored earlier
    assert results["follower"]["advice"] == results["leader"]["advice"]
    assert len(results["leader"]["usage"]) == 1 and results["follower"]["usage"] == []
    assert advisor._inflight == {}

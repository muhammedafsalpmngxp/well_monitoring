"""Identical queries asked at the same moment share one run (data.QueryFlights).

The page sends several requests together when it opens a date; each needs the same queries, and the cache is only
filled when a query ends. These tests start the requests together against a database that takes time to answer."""
from __future__ import annotations

import threading
import time
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.common import db as common_db
from app.features.common.db import DatabaseUnavailable
from app.features.dailyreport import data
from app.features.dailyreport.api import router
from tests.features.dailyreport.conftest import (
    REPORT_DATE,
    TODAY,
    activity_row,
    body,
    detail_row,
    make_row,
    report_context,
)

PREFIX = "/api/agent-runtime/features/dailyreport"
DAY = REPORT_DATE.isoformat()
VALUES = {"report_date": REPORT_DATE}


@pytest.fixture
def slow_db(fake_db, monkeypatch):
    """The fake database, answering after 0.2 s (as the remote QA server does), so requests overlap."""
    def slow(sql, params=(), **kw):
        time.sleep(0.2)
        return fake_db(sql, params, **kw)
    monkeypatch.setattr(common_db, "query", slow)
    fake_db.set(data.DAILY_DETAILS, [make_row(task_daily_id=1, well_id=101)])
    fake_db.set(data.DAILY_SUMMARY, [])
    fake_db.set(data.WELL_ACTIVITY, [activity_row(well_id=101)])
    fake_db.set(data.WELL_DETAIL, [detail_row(well_id=101)])
    fake_db.set(data.MILESTONES, [{"well_id": 101, "milestone": "RIG_ON", "deadline_date": TODAY + timedelta(days=2)}])
    fake_db.set(data.ACTIVITY_DATES, [{"report_date": REPORT_DATE, "row_count": 1, "well_count": 1}])
    return fake_db


def _together(count, work):
    """Runs ``work(i)`` on ``count`` threads that start at the same moment; (results, errors) by thread."""
    results, errors = [None] * count, [None] * count
    barrier = threading.Barrier(count)

    def run(i):
        barrier.wait()
        try:
            results[i] = work(i)
        except BaseException as exc:  # noqa: BLE001 - reported to the test
            errors[i] = exc

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    return results, errors


def _rows(key=data.DAILY_DETAILS, **ctx):
    with report_context(**ctx) as c:
        return c.data.rows(key, VALUES, report_date=REPORT_DATE)


def test_requests_asking_together_run_the_query_once_and_all_get_its_rows(slow_db):
    results, errors = _together(4, lambda i: _rows())
    assert errors == [None] * 4
    assert slow_db.count(data.DAILY_DETAILS) == 1
    assert all(r == results[0] and len(r) == 1 for r in results)


def test_different_queries_do_not_share(slow_db):
    _together(2, lambda i: _rows(data.DAILY_DETAILS))
    _together(2, lambda i: _rows(data.DAILY_SUMMARY))
    assert slow_db.count(data.DAILY_DETAILS) == 1 and slow_db.count(data.DAILY_SUMMARY) == 1


def test_opening_a_date_runs_each_query_once_however_many_requests_overlap(slow_db):
    """The page's own calls, and the brief, started at the same moment: 4 queries, not 10."""
    client = TestClient(_app())
    brief = dict(reportDate=DAY, scope="day", today=TODAY.isoformat())
    calls = [("/summary", {}), ("/group-details", {}), ("/well-activity", {}), ("/agent/brief", brief)]
    _together(len(calls), lambda i: client.post(PREFIX + calls[i][0], json=body(**({"reportDate": DAY} | calls[i][1]))))
    assert {k: slow_db.count(k) for k in (data.DAILY_DETAILS, data.DAILY_SUMMARY, data.WELL_ACTIVITY,
                                           data.MILESTONES)} == {data.DAILY_DETAILS: 1, data.DAILY_SUMMARY: 1,
                                                                 data.WELL_ACTIVITY: 1, data.MILESTONES: 1}


def test_a_database_failure_is_shared_and_the_next_request_tries_again(slow_db):
    slow_db.failing.add(data.DAILY_DETAILS)
    _, errors = _together(3, lambda i: _rows())
    assert all(isinstance(e, DatabaseUnavailable) for e in errors)
    assert slow_db.count(data.DAILY_DETAILS) == 1            # one try, three answers
    slow_db.failing.clear()
    assert len(_rows()) == 1                                  # nothing was kept: the next request ran it again
    assert slow_db.count(data.DAILY_DETAILS) == 2


def test_a_refresh_during_a_run_starts_a_fresh_query_and_the_old_rows_are_not_cached(fake_db, monkeypatch):
    release, started = threading.Event(), threading.Semaphore(0)
    runs = []

    def gated(sql, params=(), **kw):
        runs.append(1)
        n = len(runs)                                         # which run this is, fixed when it starts
        started.release()
        release.wait(5)
        result = fake_db(sql, params, **kw)
        for row in result.rows:
            row["well_id"] = 101 if n == 1 else 202           # the first run reads the old data, the second the new
        return result
    monkeypatch.setattr(common_db, "query", gated)
    fake_db.set(data.DAILY_DETAILS, [make_row(task_daily_id=1, well_id=101)])
    fake_db.set(data.DAILY_SUMMARY, [])

    out = {}
    first = threading.Thread(target=lambda: out.__setitem__("old", _rows()))
    first.start()
    started.acquire(timeout=5)                                # the first query is running
    with report_context() as c:
        c.data.invalidate_date(REPORT_DATE)                   # Refresh
    second = threading.Thread(target=lambda: out.__setitem__("new", _rows()))
    second.start()
    started.acquire(timeout=5)                                # the refreshed request did not join the old run
    release.set()
    first.join(); second.join()
    assert len(runs) == 2
    assert out["old"][0]["well_id"] == 101 and out["new"][0]["well_id"] == 202
    assert _rows()[0]["well_id"] == 202                       # the cache holds the fresh rows, not the old ones
    assert len(runs) == 2


def test_with_the_cache_off_every_request_runs_its_own_query(slow_db):
    _together(3, lambda i: _rows(settings={"datasetCacheTtlSeconds": 0}))
    assert slow_db.count(data.DAILY_DETAILS) == 3


def test_the_never_cached_date_list_is_not_shared(slow_db):
    def dates(i):
        with report_context() as c:
            return c.data.rows(data.ACTIVITY_DATES, {"limit": 30}, cached=False)
    _together(3, dates)
    assert slow_db.count(data.ACTIVITY_DATES) == 3


def test_a_waiting_request_still_passes_its_own_table_allowlist(slow_db):
    """The run is shared, the permission is not: a request whose tenant withdrew a table is refused even while
    another request's identical query is running."""
    def work(i):
        if i == 0:
            return _rows()
        time.sleep(0.05)                                      # arrive while the first query is running
        return _rows(**{"access": {"allowedSchemas": ["nothing"], "includedTables": [], "excludedTables": [],
                                   "excludedColumns": []}})
    _, errors = _together(2, work)
    assert errors[0] is None and errors[1] is not None


def _app():
    app = FastAPI()
    app.include_router(router, prefix=PREFIX)
    return app

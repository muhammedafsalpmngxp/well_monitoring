# Self-Healing: what is failing or slow

**Data Quality → Self-Healing AI** shows which data sources are failing or slow, from what really happened in the app. Every chart, tile, dashboard and Ask AI load, and every saved view run, is timed in the background: how long it took, how many rows came back, or why it failed. The page scans that record, and the imported data sets, for the period you pick (Last 7, 30 or 90 days).

- **KPIs**: loads, success rate, slow loads, failed loads, data load issues and the average load time.
- **Slowest Views** and **Failed Loads by Source**: the sources that took longest, and the ones that failed most.
- **Health Check**: failures today, sources that failed but have loaded fine since (**Recovered**), and sources whose last load failed (**Still failing**).
- **Needs Attention**: sources still failing, imports that failed, whose last refresh failed or that were not refreshed for a while (**Stale**), then the sources that recovered. Each shows the last error.
- **Loads per Day** and **Average Load Time per Day**, with the slow line.
- **Run Log**: the failed and slow loads themselves, newest first. Search by source or error, filter by status or by where the load came from.

**Run Healing Scan** and **Refresh** run the scan again. Nothing is changed or repaired yet: this step only finds the problems.

Loads are recorded without slowing them down. An admin sets what counts as slow, how long the record is kept, and when an import counts as stale.

Needs **View** on the **Self-Healing AI** module for your role.

## Endpoint

| Method | Route | What it does |
|---|---|---|
| GET | `/api/self-healing/overview?days=30` | The scan of the last `days` days (`days` optional: the first offered period) |

### Response

```json
{
  "days": 7,
  "dayOptions": [7, 30, 90],
  "slowMs": 5000,
  "recordingOn": true,
  "kpis": { "runs": 412, "failures": 9, "slowRuns": 14, "avgMs": 830, "maxMs": 41200, "failingViews": 1, "dataLoadIssues": 2 },
  "daily": [ { "day": "2026-10-23T00:00:00", "runs": 120, "failures": 4, "avgMs": 790 } ],
  "failingViews": [
    { "viewId": 31, "sourceName": "vw_rig_activity", "sourceType": "View", "runs": 40, "failures": 6,
      "lastError": "Invalid column name 'rig_cd'.", "lastFailedAt": "2026-10-23T09:12:00", "stillFailing": true }
  ],
  "slowViews": [ { "viewId": 12, "sourceName": "vw_well_progress", "sourceType": "View", "runs": 55, "avgMs": 7300, "maxMs": 41200 } ],
  "dataLoads": [ { "importId": 8, "name": "Rig plan (API)", "issue": "refresh_failed", "error": "401 Unauthorized", "at": "2026-10-22T06:00:00" } ],
  "log": [
    { "id": 9001, "viewId": 31, "sourceName": "vw_rig_activity", "sourceType": "View", "caller": "chart",
      "durationMs": 210, "rowCount": null, "error": "Invalid column name 'rig_cd'.", "createdAt": "2026-10-23T09:12:00" }
  ]
}
```

- Times are UTC. `durationMs` and the averages are milliseconds.
- `stillFailing`: the source's latest load in the period failed too. `kpis.failingViews` counts these.
- `issue`: `failed` (the import itself), `refresh_failed` (its last refresh) or `stale` (a refreshable import not refreshed recently; `at` is its last refresh).
- `caller`: `chart` (charts, tiles, dashboards, Ask AI) or `preview` (a saved view run as saved, for example on the view page or in a report).
- `recordingOn` false: loads are not being recorded, so only `dataLoads` has data.

## Errors

| Status | When |
|---|---|
| 400 | `days` is not one of `dayOptions` |
| 403 | Your role has no View on Self-Healing AI |
| 401 | Not signed in |

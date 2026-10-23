# Self-Healing step 1: internal notes

## Run log

`core.ViewRunLog` (`ViewRun`, `infra/sql/add-view-run-log.sql`; also in `init-tenant-schema.sql` and `check-agentic-release.sql`). No `tenant_id`: one tenant per database, and `ChartFilteredDataRequest` carries no tenant. Index on `created_at` (INCLUDE the scanned columns); rows older than `SelfHealing:RetentionDays` are deleted.

| Captured at | Caller | What |
|---|---|---|
| `SourceService.GetFilteredChartDataAsync` | `chart` | every chart, tile, dashboard, delivery and Ask AI data load (`ViewId`, `ChartSource`, `ChartSourceType`), including view filters, date placeholders, report filters, Top N and DAX tiles |
| `SourceService.GetTableDataAsync` / `GetAggregateAsync` | `chart` | table / view data (`SELECT TOP 1000`) and tile values |
| `DatabaseViewService.PreviewAsync` | `preview` | a saved view run as saved (`ViewId` set, no `Sql`); builder previews of edited SQL are not recorded |
| `RunModelQueryHandler` (Model Studio) | `dataset` | data model queries that reach the database (`SourceName` = the data model; result-cache hits are not loads) |
| `AiViewQueryRunner.RunAsync` | `ai` | Ask AI's push-down or streamed query over every row of a view |

Not recorded: Model Studio admin source samples, column profiles and value lookups (metadata, not loads), Data Quality rules, Crew Calendar, and the unused `ReportDataFetcher`.

**SQL:** `TimeAsync` puts the run in an `AsyncLocal`; the code that sends the query calls `ViewRunTiming.NoteSql(sql)` right before executing (no-op outside a timed load). The text is the final SQL after filters are applied, with parameter names (`@pFrom`), never their values. `ViewRunLog.Record` drops it for fast successful runs and cuts it to `SelfHealing:SqlLength`. Column `sql nvarchar(max)` (ALTER in `add-view-run-log.sql`). A wrapped exception records `"<message> (<inner message>)"`, so the database's own error stays visible behind the friendly one.

`ViewRunTiming.TimeAsync` times the call: success → `row_count`; a null result → `error` = `ViewRunTiming.NoResult` (refused or not found); an exception → its message, rethrown; `OperationCanceledException` is not recorded. When the view's source fails and the stored preview is served instead, the run keeps `"Served the stored preview: <error>"`.

`ViewRunLog` (singleton, also the hosted service) implements `IViewRunRecorder`: a bounded `Channel` (`QueueCapacity`, `DropWrite`), so `Record` never blocks or throws. Every `FlushSeconds` it inserts up to `BatchSize` rows per `SaveChanges` through `IDbContextFactory<TenantDbContext>`; a failed write is logged and dropped. Every `CleanupHours` it runs `ExecuteDelete` for rows older than `RetentionDays`. Errors are cut to `ViewRunConfiguration.ErrorLength` (2000, the column width).

## Scan

`GET api/self-healing/overview?days=` → `GetSelfHealingOverviewQuery` (validator: `days` null or in `SelfHealing:Days`) → `ViewRunRepository.OverviewAsync`, six queries:

1. per-day runs, failures, average ms (`CONVERT(date, created_at)`, UTC);
2. totals (runs, failures, slow = successful runs with `duration_ms >= SlowMs`, average, max);
3. failing sources: grouped by (`view_id`, `source_name`, `source_type`) with at least one error, ordered by failures; `StillFailing` = last failed at == last run at; top `TopViews` returned, all counted in `kpis.failingViews` when still failing;
4. slow sources: successful runs only, average ms, top `TopViews`;
5. the log: failed or slow runs, newest `LogRows`;
6. imports of the token's tenant: `status = 'failed'`, `last_refresh_status = 'failed'` (error from `core.RefreshJobs` by `last_refresh_job_code`), or refreshable (`data_source_connection_id` set) and `COALESCE(last_refreshed_at, created_at)` older than `StaleDays`.

Module permission `data-quality.self-healing` View (`RequireModulePermission`), the page's own module.

## Settings (`SelfHealing`, all required)

`RecordRuns`, `QueueCapacity`, `BatchSize`, `FlushSeconds`, `RetentionDays`, `CleanupHours`, `SlowMs`, `SqlLength`, `Days` (list; the first is the default), `TopViews`, `LogRows`, `StaleDays`. Read by `SelfHealingOptions.From` (`RequiredSettings`); a missing one stops startup with its name.

## Frontend

`SelfHealingService.overview(days)`; `self-healing-ai.component` replaces the sample KPIs, charts, review queue and audit grid with the scan (period menu from `dayOptions`, client-side paging and filters on the log). Approve / Reject / Escalate were removed: suggesting and applying a fix is step 2.

## Tests

`ViewRunLogTests`: rows, no-result and exception recording, no record on cancel, the chart load's source and user, batches and the full queue, recording off, error cut, the period validator, required settings. The six queries were checked to translate to SQL Server (no client evaluation).

# Alerts and SQL review: internal notes

## Settings (appsettings.json, no defaults in code)

Read by `AiAlertOptions.From` / `AiSqlReviewOptions.From` through `RequiredSettings`: a missing or invalid value stops startup with its name.

### `AiAlerts`

| Setting | Used by |
|---|---|
| `Enabled` | `AiAlertWorker`: false = no scheduled checks |
| `PollSeconds` | `AiAlertWorker`: how often it looks for due alerts |
| `BatchSize` | `AiAlertWorker`: due alerts per poll |
| `MaxEmails` | `AiAlertService.ParseEmails` and the panel form |
| `EveryHours` | Allowed intervals (create validator, service, panel form) |
| `DefaultEveryHours` | The form's starting interval (must be one of `EveryHours`) |
| `MaxHistory` | Past values kept per alert |
| `MinHistory` | Learning checks before a single number can be "unusual"; least groups for grouped "unusual" |
| `MaxListed` | Groups named in a fired message |
| `NoticeHistory` | Past values the AI sees when it words the notice |
| `UnusualScore` | Robust z-score threshold for "unusual" (`Insights.IsUnusual(…, score)`) |

### `AiSqlReview`

| Setting | Used by |
|---|---|
| `MaxSqlLength` | Validator and `ReviewSqlHandler` |
| `PlanMaxListed` | `SqlPlanReader`: scans, missing indexes, warnings listed (each) |
| `PlanTimeoutSeconds` | `SqlPlanReader`: time to compile the estimated plan |

Kept in code on purpose: `MessageLength` 1000 / `TitleLength` 200 in `AiAlertService` (sizes of `core.AiAlerts.last_message` and the bell title), 0.6745 in `Insights.IsUnusual` (constant that makes the MAD comparable to a standard deviation), and the provider id `mssql`. The insight report (`Insights.Find`) still uses its own 3.5 score.

## Ask Data alerts

- `CreateAsync`: for an `askdata` conversation the SQL comes from the answer's saved steps (`IAiAskService.AskDataSqlAsync`, kept 30 days). It runs once (`RunAskDataAsync`: runtime `/askdata/rows`, checked like an export) so a grouped answer can be refused for `change` before saving.
- Stored in `core.AiAlerts.query_spec_json` as `{"sql": "..."}` (`AskDataSettingsRules.ExampleJson`), `source_type = askdata`, `source_id = 0` — no schema change.
- Each check runs the SQL again; `AskDataInsights.WatchSpec` turns the rows into what `AlertCheck` watches: groups and the first varying number (as `Spec`), else the first number, else the row count.
- Scheduled checks run as the owner (`RunAsScope`), like dataset alerts.

## Bell link

`PublishAsync(..., route: "/ask-ai/alerts/{id}", ...)`. The navbar (`openNotification`) recognises this route and calls `AskAiPanelService.openAlert(id)`: the panel opens its history with that alert highlighted. No page is navigated to.

## Tests

- UnitTests `AskDataAlertTests`: watch shape; Ask Data alert stores and re-runs its SQL; change refused for grouped; e-mail limit and intervals from settings; bell route.
- CrewCalendar `AiAlertCheckTests` (with options), `SqlPlanReaderTests` (`Summarise(plans, maxListed)`).

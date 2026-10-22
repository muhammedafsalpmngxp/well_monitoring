# AI administration: internal notes

## Settings: `AiAdmin` (appsettings.json, no defaults in code)

Read by `AiAdminOptions.From(configuration, AiMapping.ProviderKinds)` through `RequiredSettings`. A missing value, or one out of range, stops startup with its name:
- `QuotaWarnPercent` must be below 100.
- `PageSize` must be at most `MaxPageSize`.
- `UsageDays`, `ActivityDays` and `DayOptions` must be at most `MaxDays`.
- Every provider kind needs a `Providers:{kind}` entry.

| Setting | Used by |
|---|---|
| `AdminRoles` | `AiController.IsAdmin`, `AgentsController.SetState`, quota warning recipients |
| `DefaultDailyQuota` | `SaveAiProviderHandler` (new provider), `AiMapping.ToDto` (no active provider), the dialog |
| `QuotaWarnPercent` | `AiService.CheckQuotaAsync` → `WarnAsync` (recipients: active users holding `AdminRoles`, via the directory) |
| `UsageDays` | `GetAiUsageHandler` (no `days`) |
| `ActivityDays`, `MaxDays`, `PageSize`, `MaxPageSize` | `ActivityRange` (both Activity lists), usage clamp |
| `DayOptions` | AI Activity period list |
| `AnswerPreviewLength` | `GetAiActivityHandler` |
| `TraceRetentionDays` | `AiConversationRepository.AddTraceAsync` cleanup |
| `ChatTimeoutSeconds` | `IAiChatClient` HttpClient timeout |
| `Providers:{kind}` (Label, BaseUrl, Model, NeedsKey) | Provider dialog, and the API-key rule in `SaveAiProviderHandler` |

Kept in code on purpose:
- the provider kinds (`AiMapping.ProviderKinds`): the chat client implements them;
- the 100-character name limits, which match the columns;
- the 1000-character error cut, which matches `ai_usage_log.error`.

Admin role names elsewhere in the app (dashboards, reports, model queries) are outside AI and were not changed.

## Quota warning

`CheckQuotaAsync` counts today's calls (`used`, before this one).
- If `used >= quota`, the call is refused.
- Otherwise it computes `warnAt = ceil(quota × QuotaWarnPercent / 100)`. If `used + 1 == warnAt`, `WarnAsync` sends a bell notice: type `AiQuota`, route `/settings/ai/providers`, sent to the active users holding `AdminRoles` (a ControlPlane module broadcast was not used: `settings.ai` is not a ControlPlane module).
- The notice goes out exactly once per day. Two calls racing may both skip it or both send it, which is harmless.
- A ControlPlane failure is logged and never fails the AI call.
- AI Providers shows the same warning from `AiUsageSummaryDto.QuotaWarnPercent`.

## AI Activity

- `ActivityRange.Resolve(from, to)`:
  - It returns `[from, to+1)` in UTC.
  - With no dates, the period is the last `ActivityDays` days, ending today.
  - It refuses `from > to` and periods longer than `MaxDays`.
- Answers: `IAiConversationRepository.SearchAnswersAsync(tenant, start, end, userId, search, skip, take)`.
- Calls: `IAiUsageRepository.SearchAsync` (filters user, purpose, failed only, and text in the model or error) and `FacetsAsync` (the users and purposes seen in the period). This replaces the old `activity/failures` endpoint and `GetFailuresAsync`.
- Frontend: routes `ai/providers`, `ai/features` and `ai/activity` now also use `adminGuard`.

## Tests

`AiAdminTests` covers:
- settings with no defaults (a missing value names itself);
- the warning firing only on the call that reaches the level;
- the calls list's default period and page size, and the over-long period error;
- a new provider's starting quota and the key rule from settings.

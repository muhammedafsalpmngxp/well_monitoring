# Scheduled insight reports: internal notes

## Target type `Insight`

`DeliveryTerms.Insight`. `TargetId` is the assistant message (`core.AiChatMessages.id`). No new table or column: it is a row in `delivery.Schedule` like any other target.

| Rule | Where |
|---|---|
| Formats: `Link` only (the report is mail text, not a file) | `ScheduleRules.Formats` |
| No page module: `ViewModules[Insight] = []`, so `ScheduleRules.CanView` passes on the module check | save (`SchedulesController.Refusal`) and every run (`DeliveryRunner`) |
| The answer must be in the reader's own chat (same tenant, conversation not deleted) | `ScheduleStore.TargetNamesAsync` (save: the caller; list: no reader) |
| Name = the user question just before the answer (falls back to the chat title) | same |
| Ask your data role access | `AiAskService.ReportAsync` (`FeatureOnAsync`), at each run as the owner |

## Run

`InsightDeliveryRenderer` (inside `RunAsScope`, as the owner) calls `IAiAskService.ReportAsync(messageId, tenant, owner)`, the same report as POST `messages/{id}/report`:
- dataset answer: the spec runs again; Ask Data answer: its checked SQL runs again;
- findings in code (`Insights.Report`), up to 3 AI recommendations (one AI call per run, counted in AI usage under `report`).

`InvalidOperationException` (feature off, fewer than 3 groups, unreadable AI reply) and a missing answer become `DeliveryException`: the run is **Failed** with that message in the Delivery Log. `IsEmpty` = `TotalRows == 0` (honours `SkipIfEmpty`).

`RenderedDelivery.Text` = `InsightReportText.Format(report)`. `DeliveryRunner` passes it as the `{{report}}` token (`MessageTokens`); when the body has no `{{report}}`, it is appended after the message. Other targets leave `Text` null, so `{{report}}` is empty for them.

## Link

`DeliveryLinks.For(App:PublicBaseUrl, Insight, messageId)` = `/ask-ai/answers/{messageId}`. The frontend route (`askAiAnswerLinkGuard`) opens the panel through `AskAiPanelService.openAnswer`, which calls `GET /api/ai/messages/{id}/conversation`:
- `GetAiConversationByMessageQuery` → `GetAiConversationByMessageHandler`: message → its conversation, only when it is the caller's (`AiConversationMapping.DetailAsync`, the same check as `GET conversations/{id}`); 404 otherwise.

## Frontend

- `TargetType` + `FORMATS_BY_TARGET` (schedule.service), `TARGET_LABELS` "Insight report", the `{{report}}` token chip, `INSIGHT_BODY` default, `itemPath` for the sample link (schedule-dialog).
- Ask AI panel: "Email this report on a schedule" under an open insight report (needs Schedules create), opening `app-schedule-dialog` with the answer as a fixed target.

## Tests

`InsightScheduleTests`: report text sections, format and module rules, link, `{{report}}` placement in the runner, renderer errors, and the by-message conversation only for its owner. `ScheduleRulesTests.Target_type_must_be_known` checks the new wording.

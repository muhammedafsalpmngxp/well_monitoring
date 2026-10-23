# Chat history: internal notes

## Storage

`core.AiChatMessages.answer_json` (NVARCHAR(MAX) NULL), added by `infra/sql/add-ai-conversations.sql` (idempotent) and in `init-tenant-schema.sql` for new tenants. `check-agentic-release.sql` reports it when missing.

It holds an `AiAnswerSnapshot` (`AiAskDtos.cs`) as camelCase JSON:

| Field | Ask Data answer | Dataset answer |
|---|---|---|
| `result` | rows of the answer's query, with business labels | rows of the spec's query, with display names |
| `chart` | the `chartspec` sent to the panel | null (the panel derives it from `querySpec`) |
| `insights` | `AskDataInsights.Spec` + `Insights.Find` | `Insights.Find(spec, result)` |
| `sql` | `AskDataSqlDto` (the same object as the `sql` event) | null |
| `followUps` | the runtime's `follow_ups` | null |

`AiAnswerSnapshots.ToJson` caps `result.Rows` at `AiHistory:SavedRows` (TotalRows unchanged) and returns null when nothing was shown, so the column stays NULL for clarifications and errors. `FromJson` returns null for NULL or unreadable values, so an old or damaged row never fails the chat.

## Settings: `AiHistory` (appsettings.json, no default in code)

| Setting | Used by |
|---|---|
| `SavedRows` | `AiAskService` (both answer paths) when saving the assistant message |

Read by `AiHistoryOptions.From` through `RequiredSettings`: a missing or non-positive value stops startup with its name.

## Where it is written

- Ask Data: `AiAskService.AskData.cs`, just before the assistant message is added. The `sql` event now sends `AskDataSqlDto` (same JSON shape as before).
- Dataset answers: `AiAskService.cs`, step 5 (Persist).

## Where it is read

`GetAiConversationHandler` maps it to `AiChatMessageDto.Answer`. The panel's `openConversation` puts it back on the turn: `result`, `sql`, `insights`, `followUps`, `askChart` (+ options), and the Chart Builder preset for dataset answers (`AiChartPresetService.suggest`).

## Tests

`AnswerHistoryTests`: the row cap keeps the real total, a full snapshot round-trips, an empty one stores nothing, old/unreadable values read as null, the conversation handler returns each answer's snapshot, and the setting has no default.

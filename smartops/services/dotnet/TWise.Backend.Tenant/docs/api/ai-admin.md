# AI administration

Settings → AI Providers, AI Features and AI Activity. Admins only (the roles in the server's AiAdmin settings).

## Options for the admin screens

`GET /api/ai/admin/options`

```json
{
  "providers": [ { "kind": "openai", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "needsKey": true } ],
  "defaultDailyQuota": 500, "quotaWarnPercent": 80, "usageDays": 14,
  "activityDays": 7, "maxDays": 90, "dayOptions": [1, 7, 30, 90], "pageSize": 50, "traceRetentionDays": 30
}
```

The provider dialog fills in these defaults when you pick a kind; a new provider starts with `defaultDailyQuota` calls a day.

## Usage and the quota warning

`GET /api/ai/usage?days=` — calls today, the active provider's daily limit, per-day totals (default `usageDays`) and `quotaWarnPercent`.

When today's calls reach `quotaWarnPercent` of the daily limit, the tenant's AI admins (users with the admin roles) get **one bell notification** that day, and AI Providers shows a warning. At the limit, new AI calls are refused until midnight UTC.

## AI Activity

Both lists take the same period and user:

| Parameter | Meaning |
|---|---|
| `from`, `to` | UTC days `yyyy-MM-dd`, inclusive. Without them: the last `activityDays` days. At most `maxDays`. |
| `userId` | One user |
| `skip`, `take` | Paging; `take` defaults to `pageSize` |

### Answers

`GET /api/ai/activity?from=&to=&userId=&q=&skip=&take=` — every user's Ask AI answers, newest first; `q` searches the answer, dataset, question or user id. `GET /api/ai/activity/{messageId}/trace` gives the steps behind one answer (kept `traceRetentionDays` days).

### AI calls

`GET /api/ai/activity/calls?from=&to=&userId=&purpose=&failed=true&q=&skip=&take=` — every call to the AI provider by any feature (ask, summary, filters, alerts, agents …), newest first, with tokens, latency and the error when it failed.

```json
{
  "total": 3, "items": [ { "id": 9, "userId": "5", "userName": "Ana", "purpose": "summary", "model": "gpt-4o-mini",
    "promptTokens": 812, "completionTokens": 96, "latencyMs": 2310, "succeeded": true, "error": null, "createdAt": "2026-10-22T08:27:00Z" } ],
  "users": [ { "userId": "5", "name": "Ana" } ], "purposes": [ "ask", "summary" ]
}
```

`users` and `purposes` are those seen in the period, for the filters.

## Errors

`403` for non-admins. `400` with a message when the start date is after the end date or the period is longer than `maxDays`.

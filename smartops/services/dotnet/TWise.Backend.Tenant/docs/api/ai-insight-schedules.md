# Scheduled insight reports

E-mail an answer's **insight report** on a schedule, for example "every Monday at 8 AM, email me the downtime insight report".

In **Ask your data**, open an answer's **Insight report** and click **Email this report on a schedule**. The schedule dialog opens with the answer as the item; choose when, who gets it, and the message. Manage it later under **Smart Alerts → Schedules** (pause, resume, run now, Delivery Log).

At every run the report is **built again**: the answer's query runs on today's data, the trend, findings and anomalies are worked out again, and the AI writes fresh recommendations. The mail holds the report as text, with a link that opens the answer in TWise.

Needs: **Schedules** (create) to set it up, and **Ask your data** for the owner's role at each run. Only your own answers can be scheduled.

## Endpoints

| Method | Route | What it does |
|---|---|---|
| POST | `/api/schedules` | Create a schedule. For an insight: `targetType` `"Insight"`, `targetId` the answer (message id), `format` `"Link"` |
| GET | `/api/ai/messages/{id}/conversation` | The chat that holds an answer (the mail's link opens it) |

All other schedule routes (`/api/schedules/...`: list, edit, pause, resume, run now, test, runs) work for insights as for reports.

### Create an insight schedule

```json
{
  "name": "Monday downtime", "targetType": "Insight", "targetId": 910, "format": "Link",
  "cron": "0 8 * * 1", "timeZone": "Asia/Muscat", "skipIfEmpty": true,
  "subject": "{{item}} for {{run_date}}",
  "body": "Hello,\n\nHere is the insight report for \"{{item}}\" as of {{run_date}} {{run_time}}.\n\n{{report}}\n\nOpen the answer in TWise: {{link}}\n\nRegards,\n{{owner}}",
  "recipients": [{ "kind": "To", "type": "Email", "value": "ops@company.com" }]
}
```

- `{{item}}` is the question the answer replied to; `{{report}}` is the report text. Without `{{report}}` the report goes after the message.
- `{{link}}` opens the Ask AI panel on that answer.
- `skipIfEmpty`: no mail when the query returns no rows.

### The report in the mail

```
Downtime by month
Ask your data · 12 rows

Trend
- Downtime rose 18% from Jan-26 to Sep-26.

Key findings
- March is the peak with 410 h.

Recommendations
- Check the March rig moves.
```

## Errors

| Status / run | When |
|---|---|
| 400 | `format` is not `Link`, or the answer is not in your chats |
| 403 | No Schedules permission |
| Run **Failed** | The answer was deleted, Ask your data is off for the owner's role, or the answer has fewer than 3 groups (the Delivery Log says which) |

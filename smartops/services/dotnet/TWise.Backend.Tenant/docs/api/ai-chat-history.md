# Chat history

**Ask your data** keeps every chat. Reopening one (the clock icon in the panel) shows each answer **as it was shown**: the answer text, and with it the result table ("Show table"), the chart, the key findings, the query and the suggested next questions.

Answers saved before this was added (23 Oct 2026) come back as text only.

## Endpoints

| Method | Route | What it does |
|---|---|---|
| GET | `/api/ai/conversations` | Your chats, newest first |
| GET | `/api/ai/conversations/{id}` | One chat with all its messages |
| DELETE | `/api/ai/conversations/{id}` | Delete a chat |

### One chat

```json
{
  "conversation": { "id": 3, "sourceType": "askdata", "sourceId": 0, "sourceName": "Ask your data", "title": "How many wells by lift type?", "modifiedAt": "2026-10-23T09:40:00Z" },
  "messages": [
    { "id": 8, "role": "user", "content": "How many wells by lift type?", "querySpec": null, "createdAt": "…", "answer": null },
    {
      "id": 9, "role": "assistant", "content": "PCP has the most wells…", "querySpec": null, "createdAt": "…",
      "answer": {
        "result": { "columns": ["lift_type", "well_count"], "rows": [{ "lift_type": "PCP", "well_count": 337 }], "totalRows": 17, "sourceRows": 17, "sourceTruncated": false, "labels": null },
        "chart": { "type": "bar", "title": "Wells by lift type", "labels": ["PCP"], "series": [{ "name": "Wells", "data": [337] }], "xAxis": "Lift type", "yAxis": "Wells" },
        "insights": ["PCP is 40.1% of the total."],
        "sql": { "sql": "SELECT …", "verified": true, "queries": 1 },
        "followUps": ["Show this by cluster"]
      }
    }
  ]
}
```

- `answer` is only on assistant messages, and is `null` for older answers.
- `result.rows` holds at most the number of rows an admin set (500 by default); `totalRows` is the real count.
- An answer on a dataset has `querySpec` and no `sql` or `chart` (its chart is worked out from the spec, as when it was asked).

## Errors

| Status | When |
|---|---|
| 401 | Not signed in |
| 404 | The chat does not exist or is another user's |

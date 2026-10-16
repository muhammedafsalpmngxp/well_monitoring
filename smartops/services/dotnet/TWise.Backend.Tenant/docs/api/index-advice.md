# View index advice — `POST /api/database-views/index-advice`

Shows the indexes that already exist on the tables a database view reads, and suggests indexes that would make the view faster. Used by the **Indexes** tab of the Database View Builder.

Nothing is changed in the database: the view's SQL is read, not run, and no index is created. Copy a suggested `CREATE INDEX` statement and have it reviewed before running it.

## Request

`Authorization: Bearer <token>` (tenant user).

```json
{
  "connectionId": 3,
  "sql": "SELECT d.Qty FROM dbo.task_daily d WHERE d.status = 'A' AND d.ActionOn >= '2026-01-01'"
}
```

| Field | Required | Notes |
|---|---|---|
| `connectionId` | Yes | The database connection the view uses. |
| `sql` | Yes | The view's SQL, as shown in the builder (up to 200,000 characters). |

## Response — `200 OK`

```json
{
  "supported": true,
  "message": null,
  "tables": [
    {
      "table": "[dbo].[task_daily]",
      "rowCount": 110184,
      "filterColumns": ["status", "ActionOn"],
      "joinColumns": [],
      "sortColumns": [],
      "existingIndexes": [
        { "name": "PK_task_daily", "type": "CLUSTERED", "isUnique": true, "isPrimaryKey": true,
          "keyColumns": ["id"], "includedColumns": [], "supportsView": false }
      ],
      "suggestedIndexes": [
        { "keyColumns": ["status", "ActionOn"], "includedColumns": [],
          "reason": "Filters on status, ActionOn", "source": "View", "estimatedImpact": null,
          "createSql": "CREATE NONCLUSTERED INDEX [IX_task_daily_status_ActionOn] ON [dbo].[task_daily] ([status], [ActionOn]);" }
      ]
    }
  ]
}
```

- `supportsView` — the existing index starts with a column the view filters, joins or sorts on.
- `source` — `View` (built from the view's filters, joins and sorting) or `SQL Server` (SQL Server's own record of queries that needed this index; `estimatedImpact` is its estimated % improvement).
- `supported: false` — the connection is not SQL Server, or the SQL could not be read; `message` says which.

## Errors

| Status | When |
|---|---|
| 400 | `connectionId` missing or `sql` empty / too long. |
| 401 | Not signed in. |
| 404 | The connection does not exist for your tenant. |

# Draft the data dictionary with AI

On **Data Quality → Data Dictionary**, open a dataset and click **Draft with AI**. The AI drafts a business name, a description, a sensitivity and tags for the dataset's columns, and a description of the dataset.

- **Nothing is saved** until you click **Save**: the draft fills the editor, the filled columns are highlighted with "AI draft", and you review and edit them first.
- **Your documentation is kept**: the draft only fills empty fields. A column's sensitivity is only set from the draft while the column has no business name and no description.
- The AI sees each column's name and type, the documentation already written, and a few example values the dataset already holds (an imported file's first rows, a view's last preview). **Columns marked PII or Confidential send no example values.** No query runs.

Needs the **Draft the data dictionary** AI feature for your role (Settings → AI Features). The wording the AI follows is under Settings → AI Settings → AI Prompts → "Draft the data dictionary".

## Endpoint

| Method | Route | What it does |
|---|---|---|
| POST | `/api/governance/dictionary/{kind}/{id}/draft` | The AI's draft for a dataset (`kind` = `import` or `view`); nothing is saved |

Save the reviewed documentation with the existing `PUT /api/governance/dictionary/{kind}/{id}`.

### Response

```json
{
  "description": "One row per well with its location, lift type and progress.",
  "columns": [
    { "columnName": "well_id", "businessName": "Well ID", "description": "The well's unique code.", "sensitivity": "internal", "tags": "well, identifier" },
    { "columnName": "supervisor_email", "businessName": "Supervisor E-mail", "description": "E-mail of the supervising engineer.", "sensitivity": "pii", "tags": "contact" }
  ]
}
```

- Only the dataset's own columns come back, once each, in the dataset's spelling; a large dataset is drafted for its first columns only (an admin sets how many).
- `sensitivity` is always one of `public`, `internal`, `confidential`, `pii`.

## Errors

| Status | When |
|---|---|
| 400 `{ "message": ... }` | The feature is off for your role, the dataset has no columns, the AI prompt is missing, or the AI reply could not be read |
| 404 | The dataset does not exist |
| 401 | Not signed in |

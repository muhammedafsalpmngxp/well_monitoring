# Ask Data: business terms, column names and suggested questions

Ask your data (the side panel, no dataset chosen) and agents' Ask Data steps read the Ask Data database directly.
These endpoints let an admin teach Ask Data the company's words and column names, and give the panel ready-made
questions. All paths are under the Tenant API (`/api`) and need a signed-in user.

## Business terms and column names

AI Settings → Ask Data & Features → **Terms & column names**. Ask Data's terms and names are stored like a dataset's,
under the fixed source **`askdata`, id `0`**.

| Method | Path | Who | Body / result |
|---|---|---|---|
| GET | `/api/ai/datasets/askdata/0/terms` | any user | `[{ term, synonyms, column, value, meaning }]` |
| PUT | `/api/ai/datasets/askdata/0/terms` | admin | the full list; replaces every term. Returns the saved list |
| GET | `/api/ai/datasets/askdata/0/notes` | any user | `[{ column, note, displayName }]` |
| PUT | `/api/ai/datasets/askdata/0/notes` | admin | the full list; replaces every name and note. Returns the saved list |

**A term** is a word or phrase people use (`term`, up to 100 characters) with optional `synonyms` (comma separated).
Give either a filter, `column` (`schema.table.column`) with `value`, or a `meaning` in plain words, or both:

```json
[
  { "term": "NPT", "synonyms": "non-productive time, downtime", "meaning": "downtime_hours where category = 'Non-productive'" },
  { "term": "dry well", "column": "well.well_master.cluster", "value": "Dry" }
]
```

When a question uses a term or a synonym (a plural counts too: "dry wells"), Ask Data applies its definition exactly.
Terms a question does not use are not sent to the AI.

**A column name or note** names a column (`schema.table.column`) or a whole table (`schema.table`). `displayName` is
what people call it ("FLAF Score" for `bl_flaf_scr`); `note` says what it means (units, code values). The AI
understands the name in questions, and answer tables show it as the column header.

```json
[{ "column": "well.well_master.bl_flaf_scr", "displayName": "FLAF Score", "note": "0-100, higher is better" }]
```

Errors (400, `{ message }`):
- the source is not `view`, `import`, or `askdata` with id 0;
- an Ask Data column is not `schema.table.column` (or `schema.table` for a note);
- a term has a column without a value, or neither a filter nor a meaning;
- two terms share a word.

Changes apply from the next question.

## Suggested first questions

| Method | Path | Result |
|---|---|---|
| GET | `/api/ai/askdata/starters` | up to 4 questions, e.g. `["How many wells are there by lift type?", "How many wells per month of eng start date?"]` |

The questions are built from what the Ask Data database holds (its tables, the values of their columns and the column
names above), without an AI call. The list is empty when Ask your data is off for the user, Ask Data is not set up,
or the database has not been profiled yet (after a restart of the agent runtime, about 2 minutes after the first
question).

## Suggestions after an answer (`POST /api/ai/ask`)

An Ask Data answer can be followed by one of these events (after `answer`):

| Event | Data | When |
|---|---|---|
| `followups` | `["Same for Marmul", "Break this down by lift type", "Show this by month of eng start date"]` | the answer found something: next questions that continue it (ask them in the same conversation) |
| `suggestions` | `["How many wells are there by lift type?", ...]` | nothing was found, or small talk: questions that work here |

## Key findings, insight report and steps

Ask Data answers that group rows (e.g. "wells by lift type") now get the same help as dataset answers:

- **Key findings** (`insights` event after `result`): highest and lowest group, share of the total, ties, blank
  groups, outliers and the trend over time. They are worked out in code from the answer's own rows, not by the AI.
  Shares and totals are given only when the numbers add up (the query counts or sums).
- **Insight report** (`POST /api/ai/messages/{id}/report`, the "Insight report" link): the answer's query runs again,
  checked like an export against what Ask Data may read now. Trend, findings and anomalies are worked out from those
  rows, and the AI adds up to 3 recommendations from the checked figures. 400 when the answer has fewer than 3 groups,
  its steps are older than 30 days, or its query reads something no longer allowed.
- **Show steps**: besides the route and each query, every step now shows its time and AI tokens ("Step 2 · 3,800 ms
  · orchestrator · AI 2,469 in / 52 out tokens"). Prompt texts are not shown.

## Learning from good answers, metrics and table links

All three are in AI Settings → Ask Data & Features → **Terms & column names**, and apply to every Ask Data run within
30 seconds of a change.

### Learned examples (👍 on an Ask Data answer)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/ai/messages/{id}/like` | the answer's owner | Ask Data answers too (Learning feature). The question and the SQL the answer used become an example with status `pending` |
| POST | `/api/ai/messages/{id}/dislike` | the answer's owner | status `disliked`: never used |
| GET | `/api/ai/datasets/askdata/0/examples` | any user | `[{ id, messageId, question, status, review, createdAt, sql }]` |
| PUT | `/api/ai/examples/{id}/status` | admin | `{ "status": "approved" \| "rejected" }`. Only **approved** examples guide later questions (the 3 most like each question) |
| DELETE | `/api/ai/examples/{id}` | admin | removes it |

A 👍 also asks the AI for up to 3 notes about the columns the answer read. They wait for an admin:
`GET /api/ai/datasets/askdata/0/proposals`, then `POST /api/ai/proposals/{id}/approve` (the note is added to that
column's note) or `.../reject`.

### Metrics

| Method | Path | Who | Body / result |
|---|---|---|---|
| GET | `/api/ai/datasets/askdata/0/metrics` | any user | `[{ name, agg, column, description }]` |
| PUT | `/api/ai/datasets/askdata/0/metrics` | admin | the full list; replaces every metric |

`agg` is `count`, `countDistinct`, `sum`, `avg`, `min` or `max`. `column` is `schema.table.column`; only `count` may
leave it empty (it then counts rows). Example: `{ "name": "Rig uptime", "agg": "sum", "column": "well.rig_day.uptime_hours" }`.
When a question names a metric (a plural counts too), Ask Data computes it with exactly that formula.

### Table links (joins where the database has no foreign key)

| Method | Path | Who | Body / result |
|---|---|---|---|
| GET | `/api/ai/askdata/links` | admin | `[{ id, fromName, fromColumn, toName, toColumn, status, overlap, ... }]`. `fromName` and `toName` are `schema.table` |
| POST | `/api/ai/askdata/links/scan` | admin | Suggests links from what the tables hold (no AI call) and returns every link. Suggestions replace the earlier ones; a link already confirmed or rejected is not suggested again |
| POST | `/api/ai/askdata/links` | admin | `{ "from": "well.task_daily.well_id", "to": "well.well_master.well_id" }`: a confirmed link |
| PUT | `/api/ai/relations/{id}/status` | admin | `{ "status": "confirmed" \| "rejected" }` |
| DELETE | `/api/ai/relations/{id}` | admin | removes a link |

Only **confirmed** links are used: Ask Data joins those columns as if the database had the foreign key.
Errors (400, `{ message }`):
- a scan when Ask Data is not set up or the agent runtime is down;
- a column not written `schema.table.column`;
- a link from a column to itself.

## Charts from Ask Data answers

- **Chart in the answer** (`chartspec` event after `result`, for an answer grouped by one column):
  `{ type: "bar" | "line" | "donut", title, labels, series: [{ name, data }], xAxis, yAxis }`. It is the runtime's
  chart when the question asked for one; otherwise it is read from the answer: a line over dates or periods, a donut
  for up to 6 parts of a count or sum, else bars. The panel draws it under the table ("Hide chart" hides it).
- **Open as chart / Add to dashboard**: `POST /api/ai/messages/{id}/askdata-view` (the answer's owner, Chart AI
  feature) saves the answer's query as a data source: a database view named `Ask Data #<message id>: <question>` on
  the tenant's data source for the Ask Data database. The query is first checked again, like an export, against
  what Ask Data may read now. A second call for the same answer reuses that view.
  Returns `{ viewId, viewName, chartType: "bar" | "line" | "pie" | "table", xAxis, measure }`. The panel then opens the
  Chart Builder with that view (x = `xAxis`, y = Sum of `measure`), or adds the chart to a dashboard.
  400 with `{ message }` when charts are off for the user, the answer's steps are older than 30 days, its query
  reads something no longer allowed, or no data source (Settings → Data Sources) points at the Ask Data database.

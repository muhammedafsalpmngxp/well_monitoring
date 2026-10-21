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

# Ask Data business terms, column names and suggested questions: internal notes

## Storage

No new tables. Ask Data's terms and names use `core.AiTerms` and `core.AiDatasetNotes` with `source_type = 'askdata'`,
`source_id = 0` (the key Ask Data conversations already use). `AiSources.IsKnowledgeSource` lets only the terms and
notes endpoints (Get / Save validators) accept it. For `askdata`, a term's column must be `schema.table.column`,
and a note's column must be that or `schema.table` (`AiSources.IsAskDataColumn`). A note with no column is kept by
the shared handler, but Ask Data ignores it. Other knowledge endpoints (metrics, examples, prompts, columns) still
refuse `askdata`.

## Flow

* `AskDataSettingsRules.WithKnowledgeAsync` adds `Terms` and `Notes` to `AgentRuntimeAskData`. They are written only
  when set, and the settings go to the runtime with every Ask Data run as `askDataSettings`. Two places call it:
  - the panel (`AiAskService.AskDataAsync`);
  - agent runs (`TestAiAgentStreamHandler.PrepareAsync`).

  Export does not need them.
* Runtime (`app/askdata`):
  - `runner.settings_for` maps them to `settings.Term` / `settings.ColumnNote` (column lower case).
  - `tools/knowledge.py`:
    - `terms_block` holds only the terms the question uses (whole word or phrase, plural allowed). It is added to the
      orchestrator's message (so a term is not a reason to clarify), the SQL Author's (before the value matches) and
      the verifier's (a filter from a definition is what was asked).
    - `annotate` adds ` | called "<name>" | <note>` to column lines and a `NOTE:` line under a TABLE line. The TABLE
      line itself stays bare, because `access.visible_tables` reads it.
    - `known_words` keeps term words and business names out of value matching.
  - Texts: `askdata.msg.business_terms`, `business_term_filter`, `business_term_meaning`, `column_called`,
    `table_note` (seed + `AiPromptCatalog`, scenarios in `tests/prompt_scenarios.py`).
* Table headers: `AiAskService.AskDataLabels` maps a result column to a business name by the noted column's last part,
  only when every noted column with that name has the same business name.

## Suggested questions (`tools/suggest.py`, no AI call)

* Starters:
  - Only base tables are offered: no views, no load or copy tables (`dump`, `csv`, `import`, `staging`, `tmp`,
    `backup`, `copy`, `test`, `old`, `log`, `audit`), and at least 20 rows.
  - Ranked by foreign keys in or out (the SCHEMA block's `FK:` lines: modelled tables before loose report tables),
    then by number of categories and dates.
  - A category is a text column with 2–12 values that is mostly filled, not an id, not numbers kept as text, and not
    a lookup (one row per value). Columns with 3 or more values come first.
  - Templates: "How many {rows} are there by {category}?", "… have {category} {top value}?" (values up to 20
    characters), "… per month of {date}?". Column names come from the business names first.
* Follow-ups (an answer with rows that are not a single zero), taken from the final SQL:
  - "Same for {value}": another value of the busiest category column that stores a literal the SQL filters on.
  - "Break this down by {category}": a category of a used table that the SQL does not use.
  - "Show this by month of {date}".
* `runner._suggestions` returns `follow_ups`, or `suggestions` (the starters) when nothing was found or for small
  talk, and nothing while clarifying. The Tenant API turns them into the `followups` / `suggestions` events.
* `POST /api/agent-runtime/askdata/starters` takes `{ db, askDataSettings }` and returns `{ questions }`. Both are []
  until the column profiles exist. The Tenant API's `GetAskDataStartersHandler` checks the Ask feature and returns []
  when the runtime is down or there is no Ask Data connection.

## UI

* `features/settings/ai-configuration/ask-data-knowledge`: the "Terms & column names" section. It is kept alive like
  the feature sections, column suggestions come from the Ask Data catalog, and it checks inputs the way the API does.
* `ask-ai-panel`:
  - starters show as chips in the empty panel when no dataset is chosen (`loadStarters`, and again on a new chat when
    there are none);
  - `followups` show as "Ask next:" chips under the answer;
  - `suggestions` keep their "Nothing matched" place above it.

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

## Key findings, insight report and step timeline

- **Finding the shape:** `AskDataInsights.Spec(sql, result)` reads the spec `Insights` needs from an Ask Data
  answer:
  - **groups** are the columns whose values are not all numbers, plus number columns named like a period (`year`,
    `month`, `*_year`, ...);
  - **the measure** is the first number column whose value varies (a constant like `COUNT(*) OVER ()` is skipped);
  - **its Agg** is count/sum when the SQL computes that alias with COUNT/COUNT_BIG/SUM, else avg (no totals or
    shares).
- **Key findings:** `AskDataAsync` yields `insights` when `Insights.Find` has any.
- **Report:**
  - `ReportAsync` sends a message without a spec to `AskDataReportAsync` for askdata conversations.
  - The SQL comes from the saved trace (`AskDataInsights.AcceptedSql`: the last `query` step not marked rejected).
  - It runs again through the runtime's `POST /askdata/rows`, which uses `runner.rows`, which uses
    `export.fetch_all`. That re-checks `is_select_only` and `access_problems` against the current schema, on a
    read-only connection, at most `max_rows` rows within `query_timeout`.
  - The SQL never comes from the browser.
  - The shared tail (`ReportFromAsync`) is the dataset report's: the AI gets the question, the query (the SQL here)
    and the checked findings.
- **Timeline:**
  - The runtime's done response carries `timeline` [{node, seconds, input, output}] from the route log.
  - The Tenant API adds one trace step per entry ("Step N", ms, "node · AI in / out tokens").
- **UI:** the "Insight report" link also shows for Ask Data answers with SQL and key findings (and at least 3 rows).

## Learned examples, metrics, table links

- **Storage, with no new tables.**
  - `core.AiExamples` holds source askdata/0. `query_spec_json` is `{"sql": "..."}` (`AskDataSettingsRules.ExampleJson` / `ExampleSql`); `AiExampleDto.Sql` carries it.
  - `core.AiMetrics` holds askdata/0, with the column as `schema.table.column`.
  - `core.AiDatasetRelations` has `from_type = to_type = 'askdata'`, ids 0, the names `schema.table` and the bare columns.
  - The dataset graph (`GET relations`) leaves these out.
- **Likes:**
  - `LikeAsync` and `DislikeAsync` accept askdata conversations (`Rateable`).
  - A like stores `pending`, and the SQL comes from the saved trace (`AnsweredSqlAsync`).
  - A like then queues `QueueAskDataExtractionAsync`, which uses the shared `QueueExtraction` with the SQL as the query and `requireColumn`. Its columns are the catalog columns of the tables the SQL reads; approving a proposal upserts the askdata note.
- **Knowledge for a run:**
  - `WithKnowledgeAsync(knowledge, cache, tenantId)` loads terms, notes, metrics, approved examples (newest 50) and confirmed links in 5 reads.
  - The bundle is cached per tenant for `KnowledgeTtl` (30 s), so a question doesn't pay those round trips each time; admin changes apply within 30 s.
  - Callers: the panel, the report, agent runs, starters and the link scan.
- **Runtime:**
  - `settings.Metric` / `Example` / `Link`.
  - `knowledge.definitions`: terms plus the metrics a question names (`formula`: COUNT(*), COUNT(DISTINCT c), SUM(c), …) for the orchestrator, SQL Author and verifier.
  - `knowledge.examples_block`: up to 3 approved examples sharing the most content words with the question, for the SQL Author.
  - `knowledge.annotate(..., links)`: a confirmed link becomes an `  FK: col -> schema.table.col` line in the from-table's block, only when both tables and columns are shown and no FK exists either way. `sqlcheck` and the starter ranking read it like a real FK.
  - Texts: `askdata.msg.metrics`, `metric`, `learned_examples`, `learned_example`.
- **Link suggestions:**
  - `tools/links.py`, behind `POST /askdata/links`.
  - Candidates are key-like column names (`*_id`, `*_code`, `*_no`, `*_num`, `*_key`; not `id` or `pk_*`) found in two or more tables, pointing to the base table where the values are unique (the biggest such table).
  - Pairs an FK already joins are skipped, and so are numbers outside the target's min/max.
  - Overlap is measured only when both columns have value lists. At most 50 are suggested.
  - The Tenant API's `ScanAskDataLinksHandler` replaces the old suggestions (`RemoveSuggestedRelationsAsync(["askdata:0"])`) and never re-suggests a pair already decided, in either direction.
- **UI:** the `ask-data-knowledge` section adds the Metrics card (saved with terms and names), Learned examples, Suggested notes and Table links (each action applies at once). In `ask-ai-panel`, 👍/👎 show on Ask Data answers (`t.sql`).

## Charts from Ask Data answers

- **`chartspec`:**
  - `AiAskService.AskDataChart` takes the runtime's `chart` when it is bar, line or donut (a kpi is skipped).
  - Otherwise `AskDataInsights.Chart(sql, result, question)`: only for one group column. Labels are `Insights.Label` ((blank) for empty) and data comes from `Num(measure)`. The type is line for a period column or date strings, donut for count/sum with ≤ 6 groups, else bar.
  - `AskDataInsights.BuilderType` maps to the Chart Builder type: donut → pie.
- **`SaveAskDataViewAsync`:**
  - It requires the Chart feature and an own askdata message. The SQL comes from the trace (`AnsweredSqlAsync`).
  - `AskDataRowsAsync` re-checks the query like an export and gives the columns.
  - The connection is the tenant's `DatabaseConnections` row with the Ask Data database's server (no port or `tcp:`) and database name (`IAgentRuntimeClient.AskDataDatabase`), active and not deleted. On QA that is 10005 "AlTasnimBI".
  - The view is `IDatabaseViewService.CreateAsync` with `ManualSql = GeneratedSql = sql` and the builder JSON empty. `ViewSqlWrapper` already handles a view whose SQL has a CTE or ORDER BY.
  - One view per answer: the name prefix `Ask Data #<id>` is looked up first. A deleted view is created again on the next click.
- **Panel:**
  - `withAskDataPreset` saves once, then sets the `AiChartPreset`: view, x = group, y = "Sum (F)" of the measure, since the view has one row per group.
  - It then runs the same Open in Chart Builder / Add to dashboard flow as a dataset answer.
  - The Highcharts options come from `chartOptions` (column / line / pie with innerSize). The panel imports `HighchartsChartComponent`.

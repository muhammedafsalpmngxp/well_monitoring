# View index advice — internal notes

Endpoint: `POST /api/database-views/index-advice` (`DatabaseViewController.IndexAdvice`).
Flow (CQRS): controller → `GetViewIndexAdviceQuery` (validated by `GetViewIndexAdviceValidator`) → `GetViewIndexAdviceHandler` → `IDatabaseViewService.GetIndexAdviceAsync`.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `ViewIndexAnalysis.Analyze` | Application/Features/DatabaseViews | Parses the SQL with ScriptDom (`TSql160Parser`, never executed). For every SELECT block it maps aliases to real tables and records columns used in `=` / `IN` (equality), `<` `>` `BETWEEN` `LIKE 'x%'` (range), column-to-column comparisons (join), and `GROUP BY` / `ORDER BY` (sort). Skips CTE names, `#temp` tables, table variables, columns wrapped in functions (`LTRIM(col) = x` is not sargable) and `LIKE '%x'`. Returns null when the SQL does not parse. |
| `ViewIndexAdvisor.Advise` | Application/Features/DatabaseViews | Pure rules: one filter index (equality columns, any order, then the first range column; sort columns when there is no filter), one index per join column, plus the top two SQL Server missing-index rows whose leading column the view uses. A suggestion is dropped when an existing index already starts with the same leading columns (`Covers`), and duplicates are merged. Builds the `CREATE NONCLUSTERED INDEX` text (name `IX_<table>_<cols>`, max 128 chars). |
| `DatabaseViewService.GetIndexAdviceAsync` | Infrastructure/Services | SQL Server only (`provider.Provider == "mssql"`). Per database (`ReadCatalogAsync`, one batch): `OBJECT_ID` of every table, schema, row count from `sys.partitions`, keys/includes from `sys.indexes` + `sys.index_columns` + `sys.columns` (three-part names read `[db].sys.*`); then one `sys.dm_db_missing_index_*` read. The DMV read needs `VIEW SERVER STATE`; without it a `SqlException` is logged at Information and only view-based suggestions are returned. |

## Behaviour to know

- Read-only: catalog queries only, 30 s command timeout each; the view SQL itself is never run.
- Tables the SQL names but `OBJECT_ID` cannot find (another server, synonym, typo) are returned with no indexes and the view-based suggestions only.
- Missing-index statistics are server-wide and reset on restart; they only reflect queries run since then.
- Cost: two round trips per database the view reads, whatever the number of tables. Each catalog query is cheap; the time is network latency (~250 ms per round trip to QA), which is why the reads are batched.

## Tests

`tests/TWise.Tenant.UnitTests/Features/DatabaseViews/ViewIndexAdviceTests.cs` — analysis (joins, CTEs, temp tables, wrapped columns, three-part names, leading-wildcard LIKE, parse failure) and advice (covered indexes, missing-index de-duplication and relevance filter, CREATE text).

## Frontend

`CommonApiService.getIndexAdvice` → Database View Builder **Indexes** tab (`loadIndexAdvice`, re-checks only when the SQL changed; Refresh forces it). Copy / Copy all put the `CREATE INDEX` text on the clipboard.

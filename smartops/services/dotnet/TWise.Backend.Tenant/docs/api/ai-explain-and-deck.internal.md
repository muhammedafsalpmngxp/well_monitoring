# Explain and AI deck: internal notes

## Settings (appsettings.json → `AiExplain`)

No defaults in code: a missing or non-positive value stops the API at startup with the setting's name (`AiExplainOptions.From`).

| Setting | Used by |
|---|---|
| `ChartRows` | Explain this chart: rows sent to the AI |
| `DashboardCharts` | Explain the dashboard and the deck: charts covered (the deck validator refuses more) |
| `DashboardRowsPerChart` | Explain the dashboard and the deck: rows of each chart sent to the AI; key figures are checked against these rows |
| `SummaryMemoryMinutes` | How long a summary stays in memory in front of the table |
| `SummaryUnusedDays` | A stored summary not shown for this long is deleted |
| `DeckKeyFigures` | Most figures on the Key figures slide (`{MAX}` in the prompt) |

## Summaries kept until the data changes

- Table `core.AiSummaries` (`infra/sql/add-ai-summaries.sql`; also in `init-tenant-schema.sql`): `tenant_id`, `kind` (chart | dashboard), `payload_hash`, `text`, `created_at`, `used_at`. Unique on (tenant_id, kind, payload_hash).
- `AiAskService.CachedStream(kind, payload, ...)`:
  - Hash: SHA-256 of the JSON payload — title, **every row** of the charts shown (not only the rows sent to the AI) and the system prompt. So any change to the data, the charts or the tenant's prompt is a new key.
  - Read order: memory (`SummaryMemoryMinutes`), then `IAiSummaryRepository.GetAsync`. A hit is written back to memory.
  - A new text is saved to memory and the table. `force` skips both reads and overwrites.
- `AiSummaryRepository`:
  - `used_at` is updated at most once a day on a read.
  - Each save deletes the tenant's rows unused for `SummaryUnusedDays`.
  - **Best-effort:** any database error (for example the table not created yet) is logged as a warning and treated as "not stored", so Explain keeps working from memory.

## Deck key figures

- Prompt key `deck-key-figures` (AI Settings → AI Prompts, "Slide deck key figures"), appended to the `deck` prompt; `{MAX}` becomes `DeckKeyFigures`.
- `BuildAiDeckHandler.GroundedFigures`: every number in a figure's value must match a cell, a column total, or (for `%`) a cell's share of its column total, within half a unit of the value's last digit (so `1.2k` matches 1,150–1,250). Figures that fail are dropped; at most `DeckKeyFigures` are kept.

## Frontend

- `core/utils/ai-deck.util.ts`: `writeAiDeck` builds the PPTX for both pages. `svgChartImage` turns a drawn Highcharts SVG into a PNG (Dashboard Builder). `canvasImage` wraps a captured canvas (dashboard view).
- Dashboard view: `exportDashboardDeck` (captured cards and KPI tiles). Dashboard Builder: `exportAiDeck` (charts found by `data-chart-slot`, shown when the `summary` feature is on).

## Deploy

Run `infra/sql/add-ai-summaries.sql` on each tenant database (QA, UAT) before or with this release. Until then, summaries are kept in memory only, and a warning is logged.

## Tests

- `ExplainAndDeckTests`: key figures kept only when found in the data; a stored summary is reused without an AI call, and changed data is a new key.

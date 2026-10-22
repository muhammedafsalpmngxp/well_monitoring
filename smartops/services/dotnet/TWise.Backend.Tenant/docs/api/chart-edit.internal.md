# Edit chart by chat: internal notes

## Flow

`AiController.ChartEdit` → `EditChartByAiCommand` → `EditChartByAiHandler` → `AiAskService.EditChartAsync`.

1. Checks the `edit` feature for the user's roles (`FeatureOnAsync`).
2. System prompt: the tenant's `chart-edit` prompt, plus the reply format and the allowed fields (written in code, so new fields need no prompt seed change).
3. One completion with purpose `edit`.
4. Validation: each patch field is checked against what the builder offers; anything else is dropped silently.
   - `chartType` from `request.ChartTypes`, `xAxis` and `yAggColumn` from `request.Columns`, `yAxis` from the aggregation functions.
   - `limitCategory` from `all|top|bottom`; `topN` and `bottomN` 1–500.
   - `sortOrder` from `SortOrders` (`none|value-desc|value-asc|label-asc|label-desc`), case-insensitive.
   - Fields equal to the current value are dropped, so a refusal that echoes the chart changes nothing.

## Sort order (`sortOrder`)

- Added 22 Oct 2026 as an optional last field of `AiChartState` (`SortOrder = null`), so existing callers and chart suggestions are unchanged.
- Frontend: the Chart Builder's **Sort** select (Display & Ranking) saves `sortOrder` in the widget design JSON.
- Rendering: `core/utils/chart-sort.util.ts` `applyChartSort(options, sort)` runs on the final Highcharts options, next to `applyDataLabelPreference`, in every renderer:
  - Chart Builder preview, widget view (both charts), chart card preview;
  - dashboard builder, board builder, board builder (test) and operations dashboard.
- It reorders `xAxis.categories` and every series' points together (sum across series for value sorts), or the named points of a single pie/donut/funnel series. "Others" stays last. Charts with x-valued points or uneven series are left unchanged. Special and advanced chart types are not sorted.

## Tests

- .NET: `ChartEditSortTests` (sort applied with a chart type; unknown sort dropped).
- Frontend: `chart-sort.util.spec.ts`.

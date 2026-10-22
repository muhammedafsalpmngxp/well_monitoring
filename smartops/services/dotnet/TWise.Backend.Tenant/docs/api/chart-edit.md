# Edit chart by chat

Change a chart in the Chart Builder by typing what you want, for example "make it a stacked bar and sort descending".

## Endpoint

`POST /api/ai/chart-edit`

Requires the **Edit chart by chat** AI feature for your role (Settings → AI Features).

### Request

```json
{
  "instruction": "make it a stacked bar and sort descending",
  "current": { "chartType": "bar", "xAxis": "lift_type", "yAxis": "Count (F)", "sortOrder": "none" },
  "columns": ["lift_type", "well_id"],
  "chartTypes": ["bar", "stacked", "line", "pie"]
}
```

| Field | Meaning |
|---|---|
| `instruction` | What to change, up to 500 characters. |
| `current` | The chart as the builder shows it now. |
| `columns` | The columns of the loaded data source. |
| `chartTypes` | The chart types the builder offers. |

### Response

```json
{ "patch": { "chartType": "stacked", "sortOrder": "value-desc" }, "message": "Changed to a stacked bar, sorted high to low." }
```

`patch` holds only the fields that change. The builder applies it at once; **Undo** reverts it.

### Fields the AI can change

`chartType`, `xAxis`, `yAxis`, `yAggColumn`, `title`, `xAxisTitle`, `yAxisTitle`, `showLegend`, `showDataLabels`, `showAxisTitle`, `includeDataTable`, `limitCategory` (`all`, `top`, `bottom`), `topN`, `bottomN`, `groupRestAsOthers`, and `sortOrder`.

`sortOrder` orders the bars or slices:

| Value | Order |
|---|---|
| `none` | As in the data |
| `value-desc` | Value, high to low |
| `value-asc` | Value, low to high |
| `label-asc` | Label, A to Z |
| `label-desc` | Label, Z to A |

"Others" always stays last. The sort is saved with the chart and applies wherever the chart is shown (chart view, chart cards, dashboards).

### Errors

`400` with a message when the feature is off for your role, the instruction is empty or too long, no data source is loaded, or the AI reply can't be read.

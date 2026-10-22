# Explain a chart, explain a dashboard, AI slide deck

All three need the **Explain charts** AI feature for your role (Settings → AI Features).

## Explain this chart

`POST /api/ai/summary` — a plain summary of what one chart shows, streamed as it is written.

```json
{ "title": "Wells by lift type", "columns": ["lift_type", "wells"], "rows": [{ "lift_type": "PCP", "wells": 294 }], "context": null, "force": false }
```

## Explain the dashboard

`POST /api/ai/dashboard-summary` — one narrative across the dashboard's charts, streamed.

```json
{ "title": "Well operations", "charts": [ { "title": "...", "columns": [], "rows": [], "context": null } ], "force": false }
```

**The summary is kept until the data changes.** Asking again for the same charts and data returns the stored summary at once, with no new AI cost, even after a restart. When any number, chart or title changes, a new summary is written. **Regenerate** (`force: true`) always writes a new one.

A summary that no one opens for a while is removed and written again the next time it is asked for (AiExplain:SummaryUnusedDays, 30 days by default).

### Response (both)

Server-sent events: `answer` (pieces of the text), then `done` with `{ "cached": true | false }`, or `error` with a message.

## AI slide deck

`POST /api/ai/deck` — the narrative for a PowerPoint of the dashboard. The browser builds the file.

```json
{ "title": "Well operations", "charts": [ { "title": "...", "columns": [], "rows": [], "context": null } ] }
```

```json
{
  "title": "Well operations",
  "headline": "PCP wells lead the field.",
  "keyFigures": [ { "label": "PCP wells", "value": "294", "note": "the largest lift type" } ],
  "slides": [ { "title": "Wells by lift type", "bullets": ["PCP has 294 wells"], "takeaway": "Focus on PCP." } ],
  "closing": "..."
}
```

The deck has a title slide, a **Key figures** slide, the KPI tiles (dashboard view only), one slide per chart (picture, bullets, takeaway) and a closing slide.

**Key figures are checked against the data.** A figure is kept only when its numbers are in the charts' data: a value, a column total, or a share of a column total. Anything else is left out, so the deck never shows an invented number.

Download it from the dashboard (**Export → AI deck**) or from the Dashboard Builder (**AI deck** in the toolbar).

### Errors

`400` with a message when the feature is off for your role, there is no chart data, or the dashboard has more charts than a deck covers (AiExplain:DashboardCharts).

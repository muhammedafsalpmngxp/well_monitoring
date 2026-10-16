import type Highcharts from 'highcharts';

/** Cartesian series types where a horizontal range-zoom makes sense. Anything else is left untouched. */
const ZOOMABLE_SERIES_TYPES = new Set([
  'line', 'spline', 'area', 'areaspline', 'column', 'bar',
  'columnrange', 'arearange', 'areasplinerange', 'waterfall',
  'boxplot', 'candlestick', 'ohlc',
]);

/**
 * Enables horizontal drag-zoom (Shift-drag to pan, plus the built-in "Reset zoom" button) on
 * axis-based cartesian charts only. Pie/donut/gauge/funnel/heatmap/treemap/sankey/bubble/advanced
 * charts — and any chart that already defines its own zoom — are returned untouched, so existing
 * behaviour including point-click drill-down is preserved.
 */
export function applyChartZoom<T extends Highcharts.Options | null | undefined>(options: T): T {
  if (!options) return options;
  const chart = (options.chart ?? {}) as Record<string, unknown>;
  if (chart['zoomType'] || chart['zooming']) return options;

  const series = options.series;
  if (!Array.isArray(series) || series.length === 0) return options;

  const chartType = chart['type'] as string | undefined;
  const everyCartesian = series.every(s => {
    const type = (s as { type?: string }).type ?? chartType ?? 'line';
    return ZOOMABLE_SERIES_TYPES.has(type);
  });
  if (!everyCartesian) return options;

  options.chart = { ...options.chart } as Highcharts.ChartOptions;
  const chartOpts = options.chart as unknown as Record<string, unknown>;
  chartOpts['zooming'] = { type: 'x', mouseWheel: { enabled: false } };
  chartOpts['panning'] = { enabled: true, type: 'x' };
  chartOpts['panKey'] = 'shift';
  chartOpts['resetZoomButton'] = { relativeTo: 'chart', position: { align: 'right', verticalAlign: 'top', x: -8, y: 6 } };

  return options;
}

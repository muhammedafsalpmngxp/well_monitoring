import type Highcharts from 'highcharts';

const SCROLLABLE_TYPES = new Set([
  'line', 'spline', 'area', 'areaspline', 'column', 'columnrange',
  'arearange', 'areasplinerange', 'waterfall', 'boxplot', 'candlestick', 'ohlc',
]);

/** Minimum plot width needed to keep categories and grouped columns readable. */
export function crowdedChartMinWidth(options: Highcharts.Options, categoryCount: number, margins: number): number | undefined {
  const series = options.series ?? [];
  if (!categoryCount || !series.length || options.chart?.inverted || options.chart?.polar) return undefined;
  const types = series.map(item => ('type' in item ? item.type : undefined) ?? options.chart?.type ?? 'line');
  if (!types.every(type => SCROLLABLE_TYPES.has(type))) return undefined;
  const columnCount = series.filter((item, index) =>
    types[index] === 'column' && item.visible !== false && !('stacking' in item && item.stacking)).length;
  const spacing = Math.max(56, columnCount * 24);
  return Math.ceil(categoryCount * spacing + margins);
}

const registered = new WeakSet<object>();

/** Run before Highcharts' own scrollable-plot sizing, including updates and container reflows. */
export function registerCrowdedChartScrolling(highcharts: typeof Highcharts): void {
  if (registered.has(highcharts)) return;
  registered.add(highcharts);
  const managed = new WeakSet<Highcharts.Chart>();
  highcharts.addEvent(highcharts.Chart, 'afterSetChartSize', function (this: Highcharts.Chart) {
    const chartOptions = this.options.chart;
    if (!chartOptions || this.renderer.forExport) return;
    // Explicit per-chart scrolling settings remain authoritative.
    if (chartOptions.scrollablePlotArea && !managed.has(this)) return;
    const count = Math.max(0, ...this.xAxis.map(axis => Array.isArray(axis.categories) ? axis.categories.length : 0),
      ...this.series.map(series => 'data' in series.options ? (series.options.data?.length ?? 0) : 0));
    const margins = this.chartWidth - this.plotWidth;
    const minimum = crowdedChartMinWidth(this.options, count, margins);
    if (minimum === undefined && !managed.has(this)) return;
    managed.add(this);
    chartOptions.scrollablePlotArea = {
      ...chartOptions.scrollablePlotArea,
      // Keep minWidth nonzero when data shrinks so Highcharts clears its previous scroll width.
      minWidth: Math.max(this.chartWidth, minimum ?? this.chartWidth),
      opacity: 1,
    };
  }, { order: -1, passive: true });
}

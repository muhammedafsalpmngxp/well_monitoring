import type Highcharts from 'highcharts';

/** How a chart's categories are ordered: as the data gives them, by value, or by label. */
export type ChartSortOrder = 'none' | 'value-desc' | 'value-asc' | 'label-asc' | 'label-desc';

export const CHART_SORT_ORDERS: { id: ChartSortOrder; label: string }[] = [
  { id: 'none', label: 'As in the data' },
  { id: 'value-desc', label: 'Value, high to low' },
  { id: 'value-asc', label: 'Value, low to high' },
  { id: 'label-asc', label: 'Label, A to Z' },
  { id: 'label-desc', label: 'Label, Z to A' },
];

/**
 * Reorders a chart's categories, and every series' points with them, by the saved sort: by value (summed across the
 * series) or by label. "Others" stays last. Charts whose points are not one per category (x values, uneven series)
 * are left as they are.
 */
export function applyChartSort<T extends Highcharts.Options | null | undefined>(options: T, sort: string | null | undefined): T {
  if (!options || !sort || sort === 'none') return options;
  const series = (options.series ?? []) as Record<string, unknown>[];
  if (!series.length) return options;

  const axis = (Array.isArray(options.xAxis) ? options.xAxis[0] : options.xAxis) as Highcharts.XAxisOptions | undefined;
  const cats = axis?.categories;
  if (cats?.length) {
    const datas = series.map(s => s['data']);
    if (!datas.every(d => Array.isArray(d) && d.length === cats.length && d.every(p => !hasX(p)))) return options;
    const order = sortedIndexes(cats, i => datas.reduce((t: number, d) => t + value((d as unknown[])[i]), 0), sort);
    const sortedAxis = { ...axis, categories: order.map(i => cats[i]) };
    return {
      ...options,
      xAxis: Array.isArray(options.xAxis) ? [sortedAxis, ...options.xAxis.slice(1)] : sortedAxis,
      series: series.map(s => ({ ...s, data: order.map(i => (s['data'] as unknown[])[i]) })),
    } as T;
  }

  // No categories: one series of named points (pie, donut, funnel).
  const data = series.length === 1 ? series[0]['data'] : null;
  if (!Array.isArray(data) || !data.length || data.some(p => name(p) === undefined)) return options;
  const order = sortedIndexes(data.map(p => name(p)!), i => value(data[i]), sort);
  return { ...options, series: [{ ...series[0], data: order.map(i => data[i]) }] } as T;
}

function sortedIndexes(labels: string[], valueAt: (i: number) => number, sort: string): number[] {
  const byValue = sort === 'value-desc' || sort === 'value-asc';
  const sign = sort === 'value-desc' || sort === 'label-desc' ? -1 : 1;
  const others = (i: number) => (labels[i] === 'Others' ? 1 : 0);
  return labels.map((_, i) => i).sort((a, b) =>
    others(a) - others(b)
    || sign * (byValue ? valueAt(a) - valueAt(b) : String(labels[a]).localeCompare(String(labels[b]), undefined, { numeric: true })));
}

function value(p: unknown): number {
  const v = typeof p === 'number' ? p : Array.isArray(p) ? p[1] : (p as { y?: unknown } | null)?.y;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function name(p: unknown): string | undefined {
  const n = Array.isArray(p) ? p[0] : (p as { name?: unknown } | null)?.name;
  return n == null ? undefined : String(n);
}

function hasX(p: unknown): boolean {
  return Array.isArray(p) ? p.length > 1 && typeof p[0] === 'number' : typeof (p as { x?: unknown } | null)?.x === 'number';
}

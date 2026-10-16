import type Highcharts from 'highcharts';

export interface ChartData { columns: string[]; rows: Record<string, unknown>[] }

/**
 * Turns the Highcharts options a chart is rendered from into a small table (category + one column
 * per series), which is what the AI "Explain" feature sends. Works for category charts, pies
 * (name/y points) and multi-series; returns null for shapes it cannot read (gauge, sankey…).
 */
export function chartDataFromOptions(options: Highcharts.Options | null | undefined, categoryLabel = 'Category'): ChartData | null {
  if (!options?.series?.length) return null;
  const xAxis = Array.isArray(options.xAxis) ? options.xAxis[0] : options.xAxis;
  const categories = (xAxis as Highcharts.XAxisOptions | undefined)?.categories ?? [];
  const series = options.series as Array<{ name?: string; data?: unknown[] }>;

  // Pie / donut: a single series of { name, y } points.
  const first = series[0]?.data ?? [];
  if (series.length === 1 && first.length && typeof first[0] === 'object' && first[0] !== null && 'name' in (first[0] as object)) {
    const pts = first as { name?: string; y?: number }[];
    return { columns: [categoryLabel, 'Value'], rows: pts.map(p => ({ [categoryLabel]: p.name ?? '', Value: p.y ?? null })) };
  }

  const names = series.map((s, i) => s.name || `Series ${i + 1}`);
  const length = Math.max(categories.length, ...series.map(s => s.data?.length ?? 0));
  if (!length) return null;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < length; i++) {
    const row: Record<string, unknown> = { [categoryLabel]: categories[i] ?? String(i + 1) };
    series.forEach((s, si) => {
      const v = s.data?.[i];
      row[names[si]] = typeof v === 'number' ? v : (v && typeof v === 'object' && 'y' in v) ? (v as { y?: number }).y ?? null : Array.isArray(v) ? v[1] ?? null : null;
    });
    rows.push(row);
  }
  return { columns: [categoryLabel, ...names], rows };
}

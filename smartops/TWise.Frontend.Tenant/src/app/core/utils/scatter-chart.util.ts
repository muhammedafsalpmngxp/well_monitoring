import type Highcharts from 'highcharts';
import { chartFallbackColor } from './chart-color.util';

export interface ScatterChartInput {
  rows: readonly Record<string, unknown>[];
  xColumn: string;
  yColumn: string;
  /** Optional: one series (and colour) per distinct value of this column. */
  categoryColumn?: string;
  xTitle?: string;
  yTitle?: string;
  height?: number;
  showLegend?: boolean;
  /** Colour for a category (or for the single series when there is no category column). */
  colorFor?: (category: string, index: number) => string | undefined;
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return NaN;
  return Number(value);
};

/** One point per row at (X, Y); the X-axis is a continuous numeric scale. */
export function buildScatterOptions(input: ScatterChartInput): Highcharts.Options {
  const { rows, xColumn, yColumn, categoryColumn } = input;
  const numericX = rows.some(row => Number.isFinite(toNumber(row[xColumn])));
  // A text X column (older charts) cannot sit on a numeric scale, so its values become axis labels.
  const xLabels: string[] = [];
  const xPosition = (raw: unknown): number => {
    if (numericX) return toNumber(raw);
    const label = String(raw ?? '');
    let index = xLabels.indexOf(label);
    if (index < 0) { index = xLabels.length; xLabels.push(label); }
    return index;
  };

  const groups = new Map<string, { x: number; y: number }[]>();
  for (const row of rows) {
    const y = toNumber(row[yColumn]);
    const x = xPosition(row[xColumn]);
    if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
    const key = categoryColumn ? (String(row[categoryColumn] ?? '').trim() || '(blank)') : '';
    const points = groups.get(key);
    if (points) points.push({ x, y }); else groups.set(key, [{ x, y }]);
  }

  const yName = yColumn || 'Value';
  const series = [...groups.entries()].map(([category, data], index): Highcharts.SeriesScatterOptions => ({
    type: 'scatter',
    name: category || yName,
    data,
    color: input.colorFor?.(category, index) ?? chartFallbackColor(`${yName}:${category}`, index),
    showInLegend: !!categoryColumn,
  }));

  return {
    chart: { type: 'scatter', zoomType: 'xy', backgroundColor: 'transparent', ...(input.height ? { height: input.height } : {}) },
    title: { text: undefined }, credits: { enabled: false },
    legend: { enabled: !!categoryColumn && input.showLegend !== false },
    xAxis: {
      ...(numericX ? { type: 'linear' as const } : { categories: xLabels }),
      title: { text: input.xTitle || undefined }, lineColor: '#E7ECF3',
    },
    yAxis: { title: { text: input.yTitle || undefined }, gridLineColor: '#F1F3F6' },
    tooltip: {
      headerFormat: '',
      pointFormatter(this: Highcharts.Point) {
        const xText = numericX ? String(this.x) : (xLabels[this.x] ?? String(this.x));
        return `${categoryColumn ? `<b>${this.series.name}</b><br/>` : ''}${xColumn}: <b>${xText}</b><br/>${yName}: <b>${this.y}</b>`;
      },
    },
    plotOptions: { scatter: { marker: { radius: 5, symbol: 'circle' } } },
    series,
  };
}

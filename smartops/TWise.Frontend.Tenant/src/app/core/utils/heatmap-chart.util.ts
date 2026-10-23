import type Highcharts from 'highcharts';

export interface HeatmapChartInput {
  rows: readonly Record<string, unknown>[];
  /** X dimension: one column of cells per distinct value. */
  xColumn: string;
  /** Y dimension: one row of cells per distinct value. */
  yColumn: string;
  /** Intensity / Value: the measure that sets each cell's colour. Empty counts rows. */
  valueColumn: string;
  /** Aggregation applied to the measure inside each cell (Sum (F), Average (F), ...). */
  operation?: string;
  xTitle?: string;
  yTitle?: string;
  height?: number;
  showLegend?: boolean;
}

const OPERATION_LABELS: Record<string, string> = {
  'Sum (F)': 'Sum', 'Average (F)': 'Average', 'Min (F)': 'Min', 'Max (F)': 'Max',
  'Count (F)': 'Count', 'Count Distinct (F)': 'Count distinct',
};

const text = (value: unknown): string => (value === null || value === undefined || value === '' ? '(empty)' : String(value));

/** Saved charts keep the measure in yAggColumn and the operation in yAxis; an older yAxis may hold a column name. */
export function resolveHeatmapMeasure(yAggColumn?: string, yAxis?: string): { valueColumn: string; operation: string } {
  const isOperation = !!yAxis && yAxis in OPERATION_LABELS;
  return { valueColumn: yAggColumn || (isOperation ? '' : yAxis ?? ''), operation: isOperation ? yAxis! : 'Sum (F)' };
}

/** The colour-scale title: the mapped measure, with its operation when one is chosen. */
export function heatmapMeasureLabel(valueColumn: string, operation?: string): string {
  const label = operation ? OPERATION_LABELS[operation] : undefined;
  if (!valueColumn) return 'Count';
  return label ? `${label} of ${valueColumn}` : valueColumn;
}

function aggregateCell(rows: readonly Record<string, unknown>[], valueColumn: string, operation?: string): number {
  if (!valueColumn) return rows.length;
  const raw = rows.map(row => row[valueColumn]);
  const present = raw.filter(value => value !== null && value !== undefined && value !== '');
  const numbers = raw.map(value => Number(value ?? 0)).map(number => (Number.isNaN(number) ? 0 : number));
  const total = numbers.reduce((sum, value) => sum + value, 0);
  switch (operation) {
    case 'Count (F)': return present.length;
    case 'Count Distinct (F)': return new Set(present.map(String)).size;
    case 'Average (F)': return numbers.length ? total / numbers.length : 0;
    case 'Min (F)': return numbers.length ? Math.min(...numbers) : 0;
    case 'Max (F)': return numbers.length ? Math.max(...numbers) : 0;
    default: return total;
  }
}

/** X x Y grid whose cell colour comes only from the cell value, so equal values share one colour. */
export function buildHeatmapOptions(input: HeatmapChartInput): Highcharts.Options {
  const { rows, xColumn, yColumn, valueColumn, operation } = input;
  const xCategories: string[] = [];
  const yCategories: string[] = [];
  const cells = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const x = text(row[xColumn]);
    const y = text(row[yColumn]);
    if (!xCategories.includes(x)) xCategories.push(x);
    if (!yCategories.includes(y)) yCategories.push(y);
    const key = `${xCategories.indexOf(x)}-${yCategories.indexOf(y)}`;
    const cell = cells.get(key);
    if (cell) cell.push(row); else cells.set(key, [row]);
  }
  const data = [...cells.entries()].map(([key, group]) => {
    const [xi, yi] = key.split('-').map(Number);
    return [xi, yi, aggregateCell(group, valueColumn, operation)] as [number, number, number];
  });
  const measure = heatmapMeasureLabel(valueColumn, operation);

  return {
    chart: { type: 'heatmap', backgroundColor: 'transparent', ...(input.height ? { height: input.height } : {}) },
    title: { text: undefined }, credits: { enabled: false },
    xAxis: { categories: xCategories, title: { text: input.xTitle || xColumn || undefined } },
    yAxis: { categories: yCategories, title: { text: input.yTitle || yColumn || undefined }, reversed: true },
    colorAxis: { minColor: '#EAF2FF', maxColor: '#2563EB', title: { text: measure } },
    legend: { enabled: input.showLegend !== false, align: 'right', layout: 'vertical', verticalAlign: 'middle' },
    tooltip: {
      headerFormat: '',
      pointFormatter(this: Highcharts.Point) {
        const point = this as Highcharts.Point & { value?: number };
        return `<b>${xCategories[point.x] ?? ''}</b> / <b>${yCategories[point.y ?? 0] ?? ''}</b><br/>${measure}: <b>${point.value}</b>`;
      },
    },
    series: [{ type: 'heatmap', name: measure, data, dataLabels: { enabled: true } }],
  };
}

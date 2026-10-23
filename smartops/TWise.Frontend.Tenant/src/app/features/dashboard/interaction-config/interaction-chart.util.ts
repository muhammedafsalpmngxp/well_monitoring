import type Highcharts from 'highcharts';
import { CHART_COLORS, CHART_THEME } from '../../../core/constants/chart-view.constants';
import { ChartData, ChartShape } from './interaction.util';

export interface InteractionChartInput {
  shape: ChartShape;
  data: ChartData;
  /** Values of the highlighted subset aligned to `data.categories`; null unless the visual is in highlight mode. */
  highlight: ChartData | null;
  /** Categories picked on this chart while it is the source. */
  selected: string[];
  onPick: (category: string, additive: boolean) => void;
}

export const CHART_HEIGHT = 230;
const MUTED_ALPHA = 0.3;

export interface LegendEntry {
  label: string;
  color: string;
  /** The category's value (single-series charts); series entries carry none. */
  value?: number;
  /** The highlighted subset's value for this entry (highlight mode only). */
  highlightValue?: number;
  /** A category entry can be clicked to pick it on the source chart. */
  pickable: boolean;
  selected: boolean;
  muted: boolean;
}

/** The legend shown under a chart: one pill per category (single series) or per series, coloured like the chart. */
export function buildLegendEntries(input: Pick<InteractionChartInput, 'shape' | 'data' | 'highlight' | 'selected'>): LegendEntry[] {
  const { shape, data, highlight, selected } = input;
  const chosen = new Set(selected.map(value => value.toLowerCase()));
  if (data.series.length === 1) {
    const values = data.series[0].values;
    const isPie = shape === 'pie' || shape === 'donut';
    return data.categories
      .map((label, index) => ({ label, index, value: values[index] ?? 0 }))
      .filter(item => !isPie || item.value > 0)
      .map(item => ({
        label: item.label, value: item.value,
        highlightValue: highlight ? highlight.series[0]?.values[item.index] ?? 0 : undefined,
        color: CHART_COLORS[item.index % CHART_COLORS.length], pickable: true,
        selected: chosen.has(item.label.toLowerCase()),
        muted: chosen.size > 0 && !chosen.has(item.label.toLowerCase()),
      }));
  }
  return data.series.map((series, index) => ({
    label: series.name, color: CHART_COLORS[index % CHART_COLORS.length], pickable: false, selected: false, muted: false,
  }));
}

/** Mutes a `#RRGGBB` colour; other colour formats are returned unchanged. */
export function fadeColor(color: string, alpha = MUTED_ALPHA): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function clickHandler(onPick: InteractionChartInput['onPick']) {
  return {
    click(this: Highcharts.Point, event: Highcharts.PointClickEventObject): void {
      const native = event as unknown as { ctrlKey?: boolean; metaKey?: boolean };
      // Cartesian points carry the category text; a pie point's `category` is only its index, so use its name.
      onPick(typeof this.category === 'string' ? this.category : String(this.name), !!(native.ctrlKey || native.metaKey));
    },
  };
}

function baseOptions(input: InteractionChartInput): Highcharts.Options {
  return {
    chart: { backgroundColor: 'transparent', height: CHART_HEIGHT, spacing: [8, 8, 8, 8] },
    title: { text: undefined },
    credits: { enabled: false },
    accessibility: { enabled: true },
    plotOptions: { series: { cursor: 'pointer', point: { events: clickHandler(input.onPick) }, states: { inactive: { opacity: 1 } } } },
  };
}

function buildPie(input: InteractionChartInput): Highcharts.Options {
  const { data, highlight, selected, shape } = input;
  const values = data.series[0]?.values ?? [];
  const chosen = new Set(selected.map(value => value.toLowerCase()));
  const dimmed = chosen.size > 0;
  const points = (source: number[], muted: boolean) => data.categories
    .map((name, index) => {
      const color = CHART_COLORS[index % CHART_COLORS.length];
      const isChosen = chosen.has(name.toLowerCase());
      return { name, y: source[index] ?? 0, sliced: isChosen,
        color: muted || (dimmed && !isChosen) ? fadeColor(color) : color };
    })
    .filter(point => point.y > 0);

  const series: Highcharts.SeriesPieOptions[] = [{
    type: 'pie', name: data.series[0]?.name ?? 'Value',
    size: '100%', innerSize: highlight ? '66%' : shape === 'donut' ? '55%' : '0%',
    borderColor: CHART_THEME.pieBorder, borderWidth: 2,
    data: points(values, !!highlight),
    dataLabels: highlight ? { enabled: false } : {
      enabled: true, distance: shape === 'donut' ? -22 : -28, format: '{point.y}',
      style: { color: '#fff', fontWeight: '700', fontSize: '11px', textOutline: 'none' },
    },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
  }];
  if (highlight) {
    series.push({
      type: 'pie', name: `${data.series[0]?.name ?? 'Value'} (highlighted)`,
      size: '62%', innerSize: '30%', borderColor: CHART_THEME.pieBorder, borderWidth: 2,
      data: points(highlight.series[0]?.values ?? [], false),
      dataLabels: { enabled: true, distance: -16, format: '{point.y}', style: { color: '#fff', fontWeight: '700', fontSize: '11px', textOutline: 'none' } },
      tooltip: { pointFormat: 'Highlighted: <b>{point.y}</b>' },
    });
  }
  const options = baseOptions(input);
  return { ...options, chart: { ...options.chart, type: 'pie' }, legend: { enabled: false }, series };
}

function buildCartesian(input: InteractionChartInput): Highcharts.Options {
  const { data, highlight, selected, shape } = input;
  const hcType = shape === 'column' ? 'bar' : shape === 'area' ? 'areaspline' : shape === 'line' || shape === 'spline' ? shape : 'column';
  const isLine = hcType === 'line' || hcType === 'spline' || hcType === 'areaspline';
  const chosen = new Set(selected.map(value => value.toLowerCase()));
  const dimmed = chosen.size > 0;
  const single = data.series.length === 1;
  const stacked = shape === 'stacked' && !highlight;
  const grouped = !stacked && !!highlight;

  const colorOf = (seriesIndex: number, categoryIndex: number): string =>
    CHART_COLORS[(single ? categoryIndex : seriesIndex) % CHART_COLORS.length];

  const series: Highcharts.SeriesOptionsType[] = [];
  data.series.forEach((item, seriesIndex) => {
    const base = item.values.map((y, categoryIndex) => {
      const color = colorOf(seriesIndex, categoryIndex);
      const isChosen = chosen.has(data.categories[categoryIndex]?.toLowerCase());
      return { y, color: highlight || (dimmed && !isChosen) ? fadeColor(color) : color };
    });
    // Highcharts treats an explicit `undefined` as a value (breaking bar widths), so only set what applies.
    const baseSeries: Record<string, unknown> = { type: hcType, name: item.name, data: base };
    if (stacked) baseSeries['stacking'] = 'normal';
    if (!single) baseSeries['color'] = fadeColor(CHART_COLORS[seriesIndex % CHART_COLORS.length], highlight ? MUTED_ALPHA : 1);
    if (grouped) { baseSeries['grouping'] = false; baseSeries['pointPadding'] = 0.08; }
    if (highlight && isLine) baseSeries['dashStyle'] = 'ShortDot';
    series.push(baseSeries as unknown as Highcharts.SeriesOptionsType);

    if (highlight) {
      series.push({
        type: hcType, name: `${item.name} (highlighted)`, showInLegend: false,
        data: (highlight.series[seriesIndex]?.values ?? []).map((y, categoryIndex) => ({ y, color: colorOf(seriesIndex, categoryIndex) })),
        grouping: false, pointPadding: 0.28, zIndex: 3,
        tooltip: { pointFormat: 'Highlighted: <b>{point.y}</b>' },
      } as Highcharts.SeriesOptionsType);
    }
  });

  const options = baseOptions(input);
  return {
    ...options,
    chart: { ...options.chart, type: hcType },
    legend: { enabled: false },
    xAxis: { categories: data.categories, labels: { style: CHART_THEME.axisLabels }, lineColor: CHART_THEME.axisLine },
    yAxis: { title: { text: undefined }, gridLineColor: CHART_THEME.gridLine, labels: { style: CHART_THEME.axisLabels } },
    tooltip: { pointFormat: '{series.name}: <b>{point.y}</b>' },
    plotOptions: {
      ...options.plotOptions,
      column: { borderRadius: stacked ? 0 : 3, borderWidth: 0 },
      bar: { borderRadius: 3, borderWidth: 0 },
      line: { marker: { radius: 3 } },
      spline: { marker: { radius: 3 } },
      areaspline: { fillOpacity: 0.15, marker: { radius: 3 } },
      series: options.plotOptions!.series,
    },
    series,
  };
}

export function buildInteractionChartOptions(input: InteractionChartInput): Highcharts.Options {
  return input.shape === 'pie' || input.shape === 'donut' ? buildPie(input) : buildCartesian(input);
}

import { ADVANCED_CHART_LABELS, AdvancedChartType } from '../utils/advanced-chart.util';

/** Series and slice colours for every chart. The only hex values allowed outside the SCSS tokens (DESIGN.md rule 1). */
export const CHART_COLORS = ['#16A34A', '#F5A623', '#2563EB', '#F97316', '#DC2626', '#38BDF8', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1'];

/**
 * The dashboard widgets' chart look, as chart-card-preview and board-builder set it: grey 11px axis labels, light
 * axis and grid lines, a soft legend, bold data labels and white pie borders. Canvas charts use it so they read like
 * the dashboard widgets next to them.
 */
export const CHART_THEME = {
  axisLabels: { fontSize: '11px', color: '#667085' },
  axisLine: '#E7ECF3',
  gridLine: '#F1F3F6',
  legendItem: { fontSize: '11px', fontWeight: '400', color: '#344054' },
  dataLabel: { fontSize: '11px', fontWeight: '600' },
  pieBorder: '#FFFFFF',
} as const;

export type ChartView = AdvancedChartType | 'pie' | 'donut' | 'bar' | 'column' | 'line' | 'spline' | 'area'
  | 'multiline' | 'stacked' | 'grouped' | 'combo' | 'trend' | 'table' | 'waterfall' | 'treemap' | 'scatter' | 'histogram'
  | 'gauge' | 'bullet' | 'sankey' | 'timeline' | 'bubble' | 'heatmap' | 'funnel' | 'kpi';

export type ChartViewIcon = 'pie' | 'donut' | 'bar' | 'line' | 'trend' | 'combo' | 'grouped' | 'table';

export const CHART_VIEW_LABELS: Record<ChartView, string> = {
  ...ADVANCED_CHART_LABELS,
  funnel: 'Funnel',
  pie: 'Pie', donut: 'Doughnut', bar: 'Bar', column: 'Column', line: 'Line', spline: 'Spline',
  area: 'Area', multiline: 'Multi Line', stacked: 'Stacked', grouped: 'Grouped', combo: 'Combo',
  trend: 'Trend', table: 'Table', waterfall: 'Waterfall', treemap: 'Treemap', scatter: 'Scatter', histogram: 'Histogram',
  gauge: 'Gauge', kpi: 'KPI', bullet: 'Bullet', sankey: 'Sankey', timeline: 'Timeline', bubble: 'Bubble', heatmap: 'Heat Map',
};

export const CHART_VIEW_ICONS: Record<ChartView, ChartViewIcon> = {
  funnel: 'grouped',
  ...Object.fromEntries(Object.keys(ADVANCED_CHART_LABELS).map(type => [type, ['matrix', 'pivottable'].includes(type) ? 'table' : 'combo'])) as Record<AdvancedChartType, ChartViewIcon>,
  pie: 'pie', donut: 'donut', bar: 'bar', column: 'bar', stacked: 'bar', grouped: 'grouped', combo: 'combo',
  line: 'line', spline: 'line', multiline: 'line', area: 'trend', trend: 'trend', table: 'table',
  waterfall: 'bar', treemap: 'grouped', scatter: 'line', histogram: 'bar',
  gauge: 'trend', kpi: 'bar', bullet: 'bar', sankey: 'combo', timeline: 'line', bubble: 'line', heatmap: 'grouped',
};

/** Chart types a saved chart may be switched to when viewing it (saved type is always first). */
export const CHART_SWITCH_OPTIONS: Record<ChartView, ChartView[]> = {
  funnel: ['funnel', 'bar', 'column', 'pie', 'donut', 'table'],
  ...Object.fromEntries(Object.keys(ADVANCED_CHART_LABELS).map(type => [type, [type]])) as Record<AdvancedChartType, ChartView[]>,
  combo:     ['combo', 'multiline', 'area', 'table'],
  multiline: ['multiline', 'stacked', 'grouped', 'area', 'table'],
  grouped:   ['grouped', 'multiline', 'stacked', 'area', 'table'],
  stacked:   ['stacked', 'multiline', 'grouped', 'area', 'table'],
  bar:       ['bar', 'column', 'pie', 'donut', 'table'],
  column:    ['column', 'bar', 'pie', 'donut', 'table'],
  pie:       ['pie', 'donut', 'bar', 'column', 'table'],
  donut:     ['donut', 'pie', 'bar', 'column', 'table'],
  line:      ['line', 'area', 'spline', 'table'],
  spline:    ['spline', 'area', 'line', 'table'],
  area:      ['area', 'multiline', 'grouped', 'stacked', 'table'],
  trend:     ['trend', 'table'],
  table:     ['table'],
  waterfall: ['waterfall', 'bar', 'column', 'table'],
  treemap:   ['treemap', 'table'],
  scatter:   ['scatter', 'table'],
  histogram: ['histogram', 'table'],
  gauge:     ['gauge', 'table'],
  kpi:       ['kpi', 'gauge', 'table'],
  bullet:    ['bullet', 'table'],
  sankey:    ['sankey', 'table'],
  timeline:  ['timeline', 'table'],
  bubble:    ['bubble', 'table'],
  heatmap:   ['heatmap', 'table'],
};

const Y_AGG_FUNCTIONS = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'];

export function toChartView(designChartType: string | undefined | null): ChartView {
  const key = (designChartType ?? '').toLowerCase();
  if (key === 'doughnut') return 'donut';
  return (key in CHART_VIEW_LABELS) ? key as ChartView : 'bar';
}

export function chartViewLabel(view: ChartView): string { return CHART_VIEW_LABELS[view] ?? view; }
export function chartViewIcon(view: ChartView): ChartViewIcon { return CHART_VIEW_ICONS[view] ?? 'bar'; }

/** Allowed switch targets for a saved chart, narrowed by its dual-Y / multi-Y series configuration. */
export function chartSwitchOptions(saved: ChartView, design: Record<string, unknown>): ChartView[] {
  const comboLineColumns = (design['comboLineColumns'] as string[]) ?? [];
  if (saved === 'multiline' && comboLineColumns.length > 0) return ['multiline', 'combo', 'table'];
  if (saved === 'area' && !hasMultipleYSeries(design)) return ['area', 'line', 'table'];
  return CHART_SWITCH_OPTIONS[saved] ?? [saved, 'table'];
}

function hasMultipleYSeries(design: Record<string, unknown>): boolean {
  const cols = (design['multiYColumns'] as string[]) ?? [];
  const yAxis = (design['yAxis'] as string) ?? '';
  const extra = (yAxis && !Y_AGG_FUNCTIONS.includes(yAxis) && !cols.includes(yAxis)) ? 1 : 0;
  return cols.length + extra > 1;
}

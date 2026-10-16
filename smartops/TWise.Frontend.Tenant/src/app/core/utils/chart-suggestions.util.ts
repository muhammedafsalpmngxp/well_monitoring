import { ADVANCED_CHART_LABELS, AdvancedChartType, applyAdvancedDefaultMapping, defaultAdvancedConfig, validateAdvancedConfig } from './advanced-chart.util';

export function getSuggestedChartTypeIds(columns: string[], rows: Record<string, unknown>[]): string[] {
  if (!columns.length) return [];
  const suggested = new Set<string>(['table']);
  if (!rows.length) return [...suggested];

  const values = (column: string) => rows.map(row => row[column]).filter(value =>
    value !== null && value !== undefined && !(typeof value === 'string' && !value.trim()));
  const numeric = (value: unknown): boolean =>
    (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value));
  const dates = (value: unknown): boolean => value instanceof Date
    ? Number.isFinite(value.getTime())
    : typeof value === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[Tt ]|$)/.test(value.trim()) && Number.isFinite(Date.parse(value));
  const populated = columns.filter(column => values(column).length > 0);
  const numericColumns = populated.filter(column => values(column).every(numeric));
  const dateColumns = populated.filter(column => values(column).every(dates));
  const categories = populated.filter(column => !numericColumns.includes(column) && !dateColumns.includes(column)
    && values(column).every(value => ['string', 'boolean'].includes(typeof value)));
  const add = (...types: string[]) => types.forEach(type => suggested.add(type));

  if (populated.length) add('kpi');
  if (categories.length) add('bar', 'column', 'pie', 'donut', 'treemap', 'funnel');
  if (dateColumns.length) add('line', 'area', 'spline', 'trend');
  if (dateColumns.length && categories.length) add('timeline');
  if (numericColumns.length) add('histogram', 'gauge');
  if (numericColumns.length && (categories.length || dateColumns.length)) add('bar', 'column', 'waterfall');
  if (numericColumns.length >= 2) add('scatter');
  if (numericColumns.length >= 3) add('bubble');
  if (numericColumns.length >= 2 && (categories.length || dateColumns.length)) add('grouped', 'stacked', 'combo', 'bullet');
  if (numericColumns.length >= 2 && dateColumns.length) add('multiline');
  if (categories.length >= 2 && numericColumns.length) add('heatmap');
  if (categories.length >= 2 && numericColumns.some(column => values(column).every(value => Number(value) >= 0))) add('sankey');

  for (const type of Object.keys(ADVANCED_CHART_LABELS) as AdvancedChartType[]) {
    const config = applyAdvancedDefaultMapping(type, rows, columns, defaultAdvancedConfig());
    try {
      validateAdvancedConfig(type, rows, config);
      if (type === 'stackedarea100' && config.measures.length < 2) continue;
      if (type === 'boxplot' && rows.some(row => {
        const points = ['low', 'q1', 'median', 'q3', 'high'].map(role => row[config.fields[role]]);
        return points.some(value => value == null || value === '' || !numeric(value))
          || points.some((value, index) => index > 0 && Number(value) < Number(points[index - 1]));
      })) continue;
      if (type === 'candlestick') {
        const timestamps = rows.map(row => Date.parse(String(row[config.fields['date']])));
        if (new Set(timestamps).size !== rows.length || rows.some(row => {
          const points = ['open', 'high', 'low', 'close'].map(role => row[config.fields[role]]);
          const [open, high, low, close] = points.map(Number);
          return points.some(value => value == null || value === '' || !numeric(value))
            || low > Math.min(open, close) || high < Math.max(open, close) || low > high;
        })) continue;
      }
      add(type);
    } catch {
      continue;
    }
  }
  return [...suggested];
}
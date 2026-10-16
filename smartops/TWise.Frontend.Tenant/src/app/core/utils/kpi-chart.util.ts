import type * as Highcharts from 'highcharts';
import { evaluateDaxMeasure, formatDaxValue, getActiveDaxMeasures } from './dax-evaluator.util';

/** The single number a KPI chart shows, with the text under it. */
export interface KpiValue {
  value: number;
  text: string;
  label: string;
}

interface KpiDesign {
  yAxis?: string;
  yAggColumn?: string;
  daxModel?: unknown;
}

/**
 * The KPI's value. A saved DAX measure wins, so a KPI can show any calculated metric;
 * otherwise the Y column is aggregated the way the Y-axis picker says (Sum by default).
 */
export function computeKpiValue(rows: Record<string, unknown>[], design: KpiDesign, availableColumns?: string[]): KpiValue {
  const measure = getActiveDaxMeasures(design as Record<string, unknown>)[0];
  if (measure) {
    const value = evaluateDaxMeasure(measure, rows, availableColumns);
    return { value, text: formatDaxValue(value, measure), label: measure.name?.trim() || 'Measure' };
  }

  const aggregation = design.yAxis ?? '';
  const column = resolveColumn(rows[0], design.yAggColumn || aggregation);
  const nums = rows.map(row => Number(row[column])).filter(Number.isFinite);
  let value: number;
  let label: string;
  switch (aggregation) {
    case 'Count (F)':
      value = rows.length; label = 'Count'; break;
    case 'Count Distinct (F)':
      value = new Set(rows.map(row => String(row[column] ?? ''))).size; label = `Distinct ${column}`; break;
    case 'Average (F)':
      value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; label = `Average ${column}`; break;
    case 'Min (F)':
      value = nums.length ? Math.min(...nums) : 0; label = `Min ${column}`; break;
    case 'Max (F)':
      value = nums.length ? Math.max(...nums) : 0; label = `Max ${column}`; break;
    default:
      value = nums.reduce((a, b) => a + b, 0); label = column ? `Total ${column}` : 'Total';
  }
  return { value, text: value.toLocaleString(undefined, { maximumFractionDigits: 2 }), label };
}

/**
 * Highcharts options that draw only the number and its label, centred. Every renderer already
 * mounts Highcharts options, so this needs no KPI-specific markup anywhere.
 */
export function buildKpiChartOptions(kpi: KpiValue, height?: number): Highcharts.Options {
  return {
    chart: { backgroundColor: 'transparent', ...(height ? { height } : {}) },
    credits: { enabled: false },
    legend: { enabled: false },
    tooltip: { enabled: false },
    xAxis: { visible: false },
    yAxis: { visible: false },
    title: {
      text: kpi.text,
      verticalAlign: 'middle',
      y: -8,
      style: { fontSize: '44px', fontWeight: '700', color: '#101828' },
    },
    subtitle: {
      text: kpi.label,
      verticalAlign: 'middle',
      y: 26,
      style: { fontSize: '14px', color: '#667085' },
    },
    series: [],
  };
}

function resolveColumn(sample: Record<string, unknown> | undefined, column: string): string {
  if (!sample || !column || column in sample) return column;
  return Object.keys(sample).find(key => key.toLowerCase() === column.toLowerCase()) ?? column;
}

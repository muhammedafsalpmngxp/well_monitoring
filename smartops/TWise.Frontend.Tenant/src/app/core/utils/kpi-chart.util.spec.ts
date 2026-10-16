import { describe, expect, it } from 'vitest';
import { buildKpiChartOptions, computeKpiValue } from './kpi-chart.util';

const rows = [
  { Region: 'North', Sales: 100 },
  { Region: 'South', Sales: 250 },
  { Region: 'North', Sales: 50 },
];

describe('computeKpiValue', () => {
  it('sums the Y column by default', () => {
    expect(computeKpiValue(rows, { yAxis: 'Sales' })).toEqual({ value: 400, text: '400', label: 'Total Sales' });
  });

  it('follows the Y-axis aggregation', () => {
    expect(computeKpiValue(rows, { yAxis: 'Average (F)', yAggColumn: 'Sales' }).value).toBeCloseTo(133.33, 2);
    expect(computeKpiValue(rows, { yAxis: 'Max (F)', yAggColumn: 'Sales' }).value).toBe(250);
    expect(computeKpiValue(rows, { yAxis: 'Count (F)' }).value).toBe(3);
    expect(computeKpiValue(rows, { yAxis: 'Count Distinct (F)', yAggColumn: 'Region' }).value).toBe(2);
  });

  it('uses a saved DAX measure when there is one', () => {
    const daxModel = { schemaVersion: 1, enabled: true, measures: [{ id: 'm', name: 'North sales', expression: 'SUM(IF(UPPER([Region]) = "NORTH", [Sales], 0))' }] };
    expect(computeKpiValue(rows, { yAxis: 'Sales', daxModel })).toMatchObject({ value: 150, label: 'North sales' });
  });
});

describe('buildKpiChartOptions', () => {
  it('draws the number and label with no series', () => {
    const options = buildKpiChartOptions({ value: 400, text: '400', label: 'Total Sales' }, 200);
    expect(options.title?.text).toBe('400');
    expect(options.subtitle?.text).toBe('Total Sales');
    expect(options.series).toEqual([]);
    expect(options.chart?.height).toBe(200);
  });
});

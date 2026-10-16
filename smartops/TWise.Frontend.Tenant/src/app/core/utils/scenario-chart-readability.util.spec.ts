import { describe, expect, it } from 'vitest';
import type Highcharts from 'highcharts';
import { applyScenarioChartReadability } from './scenario-chart-readability.util';
import { applyDataLabelPreference } from './chart-data-labels.util';

function options(): Highcharts.Options {
  return {
    chart: { type: 'line' },
    xAxis: { categories: Array.from({ length: 58 }, (_, index) => `week${index + 1}`) },
    plotOptions: { line: { dataLabels: { enabled: true, allowOverlap: true } } },
    series: [
      { type: 'line', data: [3.08, 3.16], dataLabels: [{ enabled: true, allowOverlap: true }] },
      { type: 'line', data: [3.09, 3.17] },
    ],
  };
}

describe('forecast chart readability', () => {
  it('keeps crowded forecast periods in the existing layout and suppresses overlapping labels', () => {
    const result = applyScenarioChartReadability(options(), true);
    expect(result.chart).toEqual({ type: 'line' });
    expect(result.xAxis).toEqual(options().xAxis);
    expect(result.plotOptions?.line?.dataLabels).toMatchObject({
      enabled: true, allowOverlap: false, backgroundColor: '#FFFFFF', padding: 3,
      style: { color: '#344054', fontSize: '12px', textOutline: 'none' },
    });
    expect(result.series?.[0]).toMatchObject({ dataLabels: [{ allowOverlap: false }] });
    expect(result.tooltip).toMatchObject({ shared: true, valueDecimals: 2 });
    expect(result.series?.[0]).toMatchObject({ data: [3.08, 3.16] });
  });

  it('preserves the saved hidden-label preference', () => {
    const result = applyDataLabelPreference(applyScenarioChartReadability(options(), true), false);
    expect(result.plotOptions?.line?.dataLabels).toMatchObject({ enabled: false });
    expect(result.series?.[0]).toMatchObject({ dataLabels: [{ enabled: false }] });
  });

  it('does not add scrolling or resize horizontal bars', () => {
    const result = options();
    result.chart = { type: 'bar', height: 340 };
    expect(applyScenarioChartReadability(result, true).chart).toEqual({ type: 'bar', height: 340 });
  });

  it('leaves charts without forecasts and circular charts unchanged', () => {
    const original = options();
    const snapshot = structuredClone(original);
    expect(applyScenarioChartReadability(original, false)).toEqual(snapshot);
    const pie: Highcharts.Options = { series: [{ type: 'pie', data: [1, 2] }] };
    expect(applyScenarioChartReadability(pie, true)).toEqual({ series: [{ type: 'pie', data: [1, 2] }] });
  });
});

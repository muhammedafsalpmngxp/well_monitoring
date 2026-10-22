import { describe, expect, it } from 'vitest';
import type Highcharts from 'highcharts';
import { applyChartSort } from './chart-sort.util';

function bars(): Highcharts.Options {
  return {
    xAxis: { categories: ['ESP', 'Others', 'PCP', 'BP'] },
    series: [
      { type: 'column', name: 'Oil', data: [5, 1, 9, { y: 2, color: 'red' }] },
      { type: 'column', name: 'Gas', data: [1, 1, 1, 1] },
    ],
  };
}

const cats = (o: Highcharts.Options) => (o.xAxis as Highcharts.XAxisOptions).categories;

describe('applyChartSort', () => {
  it('sorts categories and every series by the summed value, keeping Others last', () => {
    const result = applyChartSort(bars(), 'value-desc');
    expect(cats(result)).toEqual(['PCP', 'ESP', 'BP', 'Others']);
    expect((result.series![0] as { data: unknown[] }).data).toEqual([9, 5, { y: 2, color: 'red' }, 1]);
    expect((result.series![1] as { data: unknown[] }).data).toEqual([1, 1, 1, 1]);
  });

  it('sorts by label, ascending and descending', () => {
    expect(cats(applyChartSort(bars(), 'label-asc'))).toEqual(['BP', 'ESP', 'PCP', 'Others']);
    expect(cats(applyChartSort(bars(), 'label-desc'))).toEqual(['PCP', 'ESP', 'BP', 'Others']);
    expect(cats(applyChartSort(bars(), 'value-asc'))).toEqual(['BP', 'ESP', 'PCP', 'Others']);
  });

  it('sorts the named points of a pie', () => {
    const pie: Highcharts.Options = { series: [{ type: 'pie', data: [{ name: 'A', y: 1 }, ['B', 3], { name: 'C', y: 2 }] }] };
    const data = (applyChartSort(pie, 'value-desc').series![0] as { data: unknown[] }).data;
    expect(data).toEqual([['B', 3], { name: 'C', y: 2 }, { name: 'A', y: 1 }]);
  });

  it('leaves the chart alone with no sort, uneven series or x values', () => {
    const original = bars();
    expect(applyChartSort(original, 'none')).toBe(original);
    const uneven: Highcharts.Options = { xAxis: { categories: ['a', 'b'] }, series: [{ type: 'line', data: [1] }] };
    expect(applyChartSort(uneven, 'value-desc')).toBe(uneven);
    const scatter: Highcharts.Options = { xAxis: { categories: ['a', 'b'] }, series: [{ type: 'scatter', data: [[0, 2], [1, 1]] }] };
    expect(applyChartSort(scatter, 'value-desc')).toBe(scatter);
  });
});

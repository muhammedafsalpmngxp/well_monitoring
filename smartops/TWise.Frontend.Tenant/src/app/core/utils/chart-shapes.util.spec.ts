import { describe, expect, it } from 'vitest';
import { comboAxes, gaugeShape, treemapShape } from './chart-shapes.util';

describe('chart shapes shared with the dashboard chart preview', () => {
  it('draws a half-circle gauge from red through amber to green between a minimum and a maximum', () => {
    const options = gaugeShape(72, 0, 100, 'Task Count');

    expect(options.chart).toEqual({ type: 'solidgauge', backgroundColor: 'transparent' });
    expect(options.pane).toMatchObject({ startAngle: -90, endAngle: 90 });
    expect(options.yAxis).toMatchObject({ min: 0, max: 100, stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']], labels: { enabled: false } });
    expect(options.series).toEqual([{ type: 'solidgauge', name: 'Task Count', data: [72] }]);
  });

  it('draws a squarified treemap with one palette colour per rectangle', () => {
    const options = treemapShape([{ name: 'WL', value: 120 }, { name: 'RG', value: 40 }], 'Task Count', ['#111111', '#222222']);

    expect(options.series).toEqual([{
      type: 'treemap', name: 'Task Count', layoutAlgorithm: 'squarified', dataLabels: { enabled: true },
      data: [{ name: 'WL', value: 120, color: '#111111' }, { name: 'RG', value: 40, color: '#222222' }],
    }]);
  });

  it('gives a combo chart a second value axis on the right, without grid lines', () => {
    expect(comboAxes('#F1F3F6')).toEqual([
      { title: { text: undefined }, gridLineColor: '#F1F3F6' },
      { title: { text: undefined }, opposite: true, gridLineWidth: 0 },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildFunnelOptions } from './funnel-chart.util';

describe('buildFunnelOptions', () => {
  it('keeps labels inside the funnel stages', () => {
    const options = buildFunnelOptions(['Lead', 'Won'], [100, 20], ['#21409A'], 300);

    expect(options.plotOptions?.funnel?.dataLabels).toEqual({
      enabled: true,
      inside: true,
      format: '{point.name}: {point.y}',
      style: { textOutline: 'none' },
    });
    expect(options.series).toEqual([{
      type: 'funnel', name: 'Value', showInLegend: true,
      data: [
        { name: 'Lead', y: 100, color: '#21409A' },
        { name: 'Won', y: 20, color: '#21409A' },
      ],
    }]);
  });
});
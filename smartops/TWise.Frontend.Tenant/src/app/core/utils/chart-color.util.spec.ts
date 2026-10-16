import { describe, expect, it } from 'vitest';
import { chartFallbackColor, getSeriesColorByName, usesSeriesCategoryColorRules } from './chart-color.util';

describe('chart-color util', () => {
  it('keeps a stable semantic color for total drilled wells', () => {
    expect(getSeriesColorByName('Total Drilled Wells')).toBe('#3F7D32');
    expect(getSeriesColorByName('Total drilled wells')).toBe('#3F7D32');
  });

  it('keeps a stable semantic color for plan due wells', () => {
    expect(getSeriesColorByName('Plan - Due Well')).toBe('#168BCB');
    expect(getSeriesColorByName('Plan due well')).toBe('#168BCB');
  });

  it('keeps a stable semantic color for actual wells completed', () => {
    expect(getSeriesColorByName('Actual - Wells Completed')).toBe('#F58220');
    expect(getSeriesColorByName('Actual completed wells')).toBe('#F58220');
  });

  it('falls back to the palette when no semantic match exists', () => {
    expect(getSeriesColorByName('Unmapped Measure')).toBe(chartFallbackColor('Unmapped Measure', 0));
  });

  it.each(['line', 'multiline', 'area', 'bar', 'trend'])('uses legend names for %s charts mapped to Period', chartType => {
    expect(usesSeriesCategoryColorRules(chartType, ' Period ')).toBe(true);
    expect(usesSeriesCategoryColorRules(chartType, 'PERIOD')).toBe(true);
    expect(usesSeriesCategoryColorRules(chartType, 'Plant')).toBe(false);
  });

  it.each(['stacked', 'grouped', 'combo'])('keeps existing series category rules for %s charts', chartType => {
    expect(usesSeriesCategoryColorRules(chartType, 'Plant')).toBe(true);
  });
});

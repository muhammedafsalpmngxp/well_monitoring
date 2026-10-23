import { afterEach, describe, expect, it } from 'vitest';
import Highcharts from 'highcharts/esm/highcharts';
import { crowdedChartMinWidth, registerCrowdedChartScrolling } from './chart-scroll.util';

registerCrowdedChartScrolling(Highcharts);
const charts: Highcharts.Chart[] = [];
const containers = new WeakMap<Highcharts.Chart, HTMLElement>();
const categories = (count: number) => Array.from({ length: count }, (_, i) => `Week ${i + 1}`);

function createChart(count: number, extra: Highcharts.Options = {}): Highcharts.Chart {
  const container = document.createElement('div');
  document.body.append(container);
  const chart = Highcharts.chart(container, {
    chart: { width: 600, height: 350, animation: false, marginLeft: 60, marginRight: 20 },
    title: { text: '' }, accessibility: { enabled: false },
    xAxis: { categories: categories(count) },
    plotOptions: { series: { animation: false } },
    series: [{ type: 'line', data: Array.from({ length: count }, (_, i) => i + 1) }],
    ...extra,
  });
  charts.push(chart);
  containers.set(chart, container);
  return chart;
}

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const container = containers.get(chart);
    chart.destroy();
    container?.remove();
  }
});

describe('Crowded chart horizontal scrolling', () => {
  it('allocates at least 56 pixels per category and accounts for margins', () => {
    expect(crowdedChartMinWidth({ series: [{ type: 'line', data: [] }] }, 40, 80)).toBe(2320);
  });

  it('allocates extra space for grouped, but not stacked, columns', () => {
    expect(crowdedChartMinWidth({ series: [
      { type: 'column', data: [] }, { type: 'column', data: [] }, { type: 'column', data: [] },
    ] }, 20, 80)).toBe(1520);
    expect(crowdedChartMinWidth({ series: [
      { type: 'column', stacking: 'normal', data: [] },
      { type: 'column', stacking: 'normal', data: [] },
      { type: 'column', stacking: 'normal', data: [] },
    ] }, 20, 80)).toBe(1200);
  });

  it.each(['pie', 'gauge', 'bar', 'scatter', 'heatmap', 'sankey'] as const)(
    'does not alter %s charts', type => {
      expect(crowdedChartMinWidth({ chart: { type }, series: [{ type, data: [] }] }, 40, 80)).toBeUndefined();
    },
  );

  it('does not alter polar, inverted, empty, or mixed non-cartesian charts', () => {
    expect(crowdedChartMinWidth({ chart: { polar: true }, series: [{ type: 'line' }] }, 40, 80)).toBeUndefined();
    expect(crowdedChartMinWidth({ chart: { inverted: true }, series: [{ type: 'line' }] }, 40, 80)).toBeUndefined();
    expect(crowdedChartMinWidth({ series: [] }, 40, 80)).toBeUndefined();
    expect(crowdedChartMinWidth({ series: [{ type: 'line' }, { type: 'pie' }] }, 40, 80)).toBeUndefined();
  });

  it('creates native scrollable plot DOM only when the data exceeds available width', () => {
    const chart = createChart(40);
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(2320);
    expect(containers.get(chart)?.querySelector('.highcharts-scrolling')).not.toBeNull();
    expect(containers.get(chart)?.querySelector('.highcharts-fixed')).not.toBeNull();
    expect(containers.get(createChart(4))?.querySelector('.highcharts-scrolling')).toBeNull();
  });

  it('recalculates on resizing and resets scroll width when data shrinks', () => {
    const chart = createChart(20);
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(1200);
    chart.setSize(1500, 350, false);
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(1500);
    chart.setSize(600, 350, false);
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(1200);
    chart.update({ xAxis: { categories: categories(4) }, series: [{ type: 'line', data: [1, 2, 3, 4] }] });
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(600);
    const scrolling = containers.get(chart)?.querySelector<HTMLElement>('.highcharts-scrolling');
    expect(scrolling?.style.width).toBe('600px');
  }, 20000);

  it('preserves explicit scroll settings and is safe to register twice', () => {
    registerCrowdedChartScrolling(Highcharts);
    const chart = createChart(40, {
      chart: { width: 600, height: 350, scrollablePlotArea: { minWidth: 900, scrollPositionX: 1 } },
    });
    expect(chart.options.chart?.scrollablePlotArea?.minWidth).toBe(900);
    expect(chart.options.chart?.scrollablePlotArea?.scrollPositionX).toBe(1);
  });
});

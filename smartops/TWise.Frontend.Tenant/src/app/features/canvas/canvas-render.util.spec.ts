import type Highcharts from 'highcharts';
import { describe, expect, it, vi } from 'vitest';
import { CHART_COLORS } from '../../core/constants/chart-view.constants';
import { CanvasItem, MAX_SERIES } from './canvas-config.util';
import {
  MEASURE_AXIS, MEASURE_VALUE, chartOptions, compactLabel, fitHalfGauge, gaugeOptions, measureRows, pivotSeries, tileValue, withHighlight, withTooltips,
} from './canvas-render.util';

const chart: CanvasItem = {
  id: 'c1', type: 'chart', title: 'Tasks by crew', x: 0, y: 0, cols: 10, rows: 12,
  datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count', 'Hours'], chartType: 'column',
};

const result = {
  columns: ['CrewType.code', 'Task Count', 'Hours'],
  rows: [
    { 'CrewType.code': 'WL', 'Task Count': 120, 'Hours': 2.5 },
    { 'CrewType.code': null, 'Task Count': 7, 'Hours': null },
  ],
};

describe('chartOptions', () => {
  it('draws one category per row and one series per measure, in the chart palette', () => {
    const options = chartOptions(chart, result);

    expect((options.xAxis as Highcharts.XAxisOptions).categories).toEqual(['WL', '(blank)']);
    expect(options.series).toEqual([
      { type: 'column', name: 'Task Count', color: CHART_COLORS[0], data: [120, 7] },
      { type: 'column', name: 'Hours', color: CHART_COLORS[1], data: [2.5, null] },
    ]);
    expect(options.legend?.enabled).toBe(true);
    expect(options.chart?.type).toBe('column');
  });

  it('draws a pie from the first measure with one palette colour per slice', () => {
    const options = chartOptions({ ...chart, chartType: 'pie', measures: ['Task Count'] }, result);

    expect(options.series).toEqual([{
      type: 'pie', showInLegend: true, name: 'Task Count',
      data: [{ name: 'WL', y: 120, color: CHART_COLORS[0] }, { name: '(blank)', y: 7, color: CHART_COLORS[1] }],
    }]);
  });

  it('uses the palette the board builder uses', () => {
    expect(CHART_COLORS).toEqual(['#16A34A', '#F5A623', '#2563EB', '#F97316', '#DC2626', '#38BDF8', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1']);
  });

  it('draws charts in the dashboard widgets\' look', () => {
    const options = chartOptions(chart, result);
    const x = options.xAxis as Highcharts.XAxisOptions;
    const y = options.yAxis as Highcharts.YAxisOptions;

    expect(x.labels?.style).toEqual({ fontSize: '11px', color: '#667085' });
    expect(x.lineColor).toBe('#E7ECF3');
    expect(y.gridLineColor).toBe('#F1F3F6');
    expect(y.labels?.style).toEqual({ fontSize: '11px', color: '#667085' });
    expect(options.plotOptions?.column).toMatchObject({ borderRadius: 4, borderWidth: 0 });
    expect(options.plotOptions?.bar).toMatchObject({ borderRadius: 4, borderWidth: 0 });
    expect(options.legend).toMatchObject({ enabled: true, itemStyle: { fontSize: '11px', fontWeight: '400', color: '#344054' } });
    expect(options.tooltip?.shared).toBe(true);
    expect(chartOptions({ ...chart, measures: ['Task Count'] }, result).tooltip?.shared).toBe(false);

    const pie = chartOptions({ ...chart, chartType: 'pie', measures: ['Task Count'] }, result);
    expect(pie.plotOptions?.pie).toMatchObject({ borderWidth: 2, borderColor: '#FFFFFF' });
  });

  it('shows stack totals on a stacked chart with data labels', () => {
    const stack = (dataLabels: boolean) => (chartOptions({ ...chart, measures: ['Task Count'], stacking: 'normal', dataLabels }, result).yAxis as {
      stackLabels?: { enabled: boolean; formatter: (this: { total: number }) => string } }).stackLabels;
    expect(stack(true)?.enabled).toBe(true);
    expect(stack(true)!.formatter.call({ total: 366 })).toBe('366');
    expect(stack(false)).toBeUndefined();
  });

  it('puts each slice value inside a pie when data labels are on', () => {
    const labels = (on: boolean) => chartOptions({ ...chart, chartType: 'pie', measures: ['Task Count'], dataLabels: on, format: { style: 'number', decimals: 2 } }, result)
      .plotOptions?.pie?.dataLabels as { distance?: number; formatter?: (this: unknown) => string };
    expect(labels(true).distance).toBe(-30);
    expect(labels(true).formatter!.call({ y: 52.946 })).toBe('52.95');
    expect(labels(false).formatter).toBeUndefined();
  });
});

describe('scatter, bubble and bullet charts', () => {
  const points = {
    columns: ['CrewType.code', 'Task Count', 'Hours', 'Workers'],
    rows: [
      { 'CrewType.code': 'WL', 'Task Count': 120, 'Hours': 2.5, 'Workers': 4 },
      { 'CrewType.code': 'CT', 'Task Count': 7, 'Hours': null, 'Workers': 1 },
    ],
  };

  it('places one point per row by its X and Y, with the size of a bubble, and leaves out a row it cannot place', () => {
    const bubble = chartOptions({ ...chart, chartType: 'bubble', xMeasure: 'Task Count', measures: ['Hours'], sizeMeasure: 'Workers' }, points);
    expect(bubble.chart?.type).toBe('bubble');
    expect((bubble.series![0] as { data: unknown[] }).data).toEqual([{ name: 'WL', x: 120, y: 2.5, z: 4 }]);
    expect((bubble.xAxis as Highcharts.XAxisOptions).title?.text).toBe('Task Count');
  });

  it('draws a bullet bar per row with its target', () => {
    const bullet = chartOptions({ ...chart, chartType: 'bullet', measures: ['Task Count'], target: 'Workers' }, points);
    expect(bullet.chart).toEqual(expect.objectContaining({ type: 'bullet', inverted: true }));
    expect((bullet.series![0] as { data: unknown[] }).data).toEqual([{ y: 120, target: 4 }, { y: 7, target: 1 }]);
  });
});

describe('withHighlight', () => {
  it('fades the categories that are not chosen when the highlight is on the axis field', () => {
    const item: CanvasItem = { ...chart, measures: ['Task Count'] };
    const options = withHighlight(chartOptions(item, result), item, result, { field: 'CrewType.code', values: ['WL'], filter: { field: 'CrewType.code', op: 'eq', values: ['WL'] } }, null);
    expect((options.series![0] as { data: unknown[] }).data).toEqual([120, { y: 7, color: `${CHART_COLORS[0]}4d` }]);
  });

  it('fades the whole series and draws the highlighted part over it for another field', () => {
    const item: CanvasItem = { ...chart, measures: ['Task Count'] };
    const part = { columns: result.columns, rows: [{ 'CrewType.code': 'WL', 'Task Count': 30 }] };
    const options = withHighlight(chartOptions(item, result), item, result, { field: 'Task.x', values: ['a'], filter: { field: 'Task.x', op: 'eq', values: ['a'] } }, part);
    expect(options.series!.map(series => (series as { data: unknown[] }).data)).toEqual([[120, 7], [30, null]]);
    expect((options.plotOptions?.column as { grouping?: boolean }).grouping).toBe(false);
  });
});

describe('withTooltips', () => {
  it("adds the Tooltips measures of each point's row under its value, in their canvas names", () => {
    const item: CanvasItem = { ...chart, measures: ['Task Count'], tooltips: ['Hours'] };
    const options = withTooltips(chartOptions(item, result), item, result, { Hours: 'Hours logged' });
    const format = (options.tooltip as Highcharts.TooltipOptions).pointFormatter!;
    const point = { y: 120, index: 0, options: {}, series: { name: 'Task Count', index: 0, chart: { series: [{}] } } };
    expect(format.call(point as unknown as Highcharts.Point)).toBe('<b>120</b><br/>Hours logged: <b>2.5</b>');
  });

  it('leaves a chart split into series as it is', () => {
    const item: CanvasItem = { ...chart, measures: ['Task Count'], series: 'CrewType.code', tooltips: ['Hours'] };
    const options = chartOptions(item, result);
    expect(withTooltips(options, item, result)).toBe(options);
  });
});

describe('compactLabel', () => {
  it('writes large axis values in short form and leaves the rest as they are', () => {
    expect(compactLabel(12500)).toBe('12.5K');
    expect(compactLabel(3_400_000)).toBe('3.4M');
    expect(compactLabel(950)).toBe('950');
    expect(compactLabel('WL')).toBe('WL');
  });
});

describe('tileValue', () => {
  it('formats the value for reading, and says when there is none', () => {
    const tile: CanvasItem = { ...chart, type: 'tile', dimensions: [], measures: ['Task Count'] };
    const value = (v: unknown) => tileValue(tile, { columns: ['Task Count'], rows: [{ 'Task Count': v }] });

    expect(value(73302)).toBe('73,302');
    expect(value(12.3456)).toBe('12.35');
    expect(value('41.50')).toBe('41.5');
    expect(value(null)).toBe('No value');
    expect(value('WL')).toBe('WL');
    expect(tileValue(tile, { columns: ['Task Count'], rows: [] })).toBe('No value');
  });
});

describe('the charts of plan 10', () => {
  const one: CanvasItem = { ...chart, measures: ['Task Count'] };

  it('draws donut, area, treemap, waterfall and funnel charts', () => {
    expect(chartOptions({ ...one, chartType: 'donut' }, result).plotOptions?.pie).toMatchObject({ innerSize: '55%', borderColor: '#FFFFFF' });

    const area = chartOptions({ ...one, chartType: 'area' }, result);
    expect(area.chart?.type).toBe('area');
    expect(area.plotOptions?.area).toMatchObject({ fillOpacity: 0.15 });

    const treemap = chartOptions({ ...one, chartType: 'treemap' }, result).series?.[0] as Highcharts.SeriesTreemapOptions;
    expect(treemap.data).toEqual([{ name: 'WL', value: 120, color: CHART_COLORS[0] }, { name: '(blank)', value: 7, color: CHART_COLORS[1] }]);

    const waterfall = chartOptions({ ...one, chartType: 'waterfall' }, result).series?.[0] as Highcharts.SeriesWaterfallOptions;
    expect(waterfall).toMatchObject({ type: 'waterfall', upColor: CHART_COLORS[0], color: CHART_COLORS[4] });
    expect(waterfall.data).toEqual([{ name: 'WL', y: 120 }, { name: '(blank)', y: 7 }, { name: 'Total', isSum: true, color: CHART_COLORS[2] }]);

    const funnel = chartOptions({ ...one, chartType: 'funnel' }, result).series?.[0] as Highcharts.SeriesFunnelOptions;
    expect(funnel).toMatchObject({ type: 'funnel', data: [{ name: 'WL', y: 120, color: CHART_COLORS[0] }, { name: '(blank)', y: 7, color: CHART_COLORS[1] }] });
  });

  it('splits one measure into a series per value of a second field, stacked when asked', () => {
    const rows = [
      { 'CrewType.code': 'RG', 'TaskDaily.status': 'Open', 'Task Count': 4 },
      { 'CrewType.code': 'RG', 'TaskDaily.status': 'Closed', 'Task Count': 6 },
      { 'CrewType.code': 'WL', 'TaskDaily.status': 'Closed', 'Task Count': 9 },
    ];
    const options = chartOptions({ ...one, series: 'TaskDaily.status', stacking: 'percent' }, { columns: [], rows });

    expect((options.xAxis as Highcharts.XAxisOptions).categories).toEqual(['RG', 'WL']);
    expect(options.series).toEqual([
      { type: 'column', name: 'Open', color: CHART_COLORS[0], data: [4, null] },
      { type: 'column', name: 'Closed', color: CHART_COLORS[1], data: [6, 9] },
    ]);
    expect(options.plotOptions?.column).toMatchObject({ stacking: 'percent' });
    expect(options.legend?.enabled).toBe(true);

    const many = Array.from({ length: 10 }, (_, i) => ({ 'CrewType.code': 'RG', 'TaskDaily.status': `S${i}`, 'Task Count': i }));
    const cut = pivotSeries({ columns: [], rows: many }, 'CrewType.code', 'TaskDaily.status', 'Task Count');
    expect(cut.series).toHaveLength(MAX_SERIES);
    expect(cut.cut).toBe(true);
  });

  it('draws a combo with the first measure as columns and the others as lines on a second axis', () => {
    const options = chartOptions({ ...chart, chartType: 'combo' }, result);

    expect(options.series).toEqual([
      { type: 'column', name: 'Task Count', color: CHART_COLORS[0], data: [120, 7], yAxis: 0 },
      { type: 'line', name: 'Hours', color: CHART_COLORS[1], data: [2.5, null], yAxis: 1 },
    ]);
    expect(options.yAxis).toHaveLength(2);
    expect((options.yAxis as Highcharts.YAxisOptions[])[1]).toMatchObject({ opposite: true, gridLineWidth: 0 });
  });

  it("reports a clicked category, and shows data labels and tooltips in the object's number format", () => {
    const clicked: unknown[] = [];
    const options = chartOptions({ ...one, dataLabels: true, format: { style: 'compact', decimals: 1 } }, result, value => clicked.push(value));
    const series = options.plotOptions?.series as Highcharts.PlotSeriesOptions;
    const click = series.point?.events?.click as unknown as (this: { index: number }, event: object) => void;

    click.call({ index: 1 }, {});
    click.call({ index: 0 }, { ctrlKey: true });
    expect(clicked).toEqual([null, 'WL']);
    expect(series.cursor).toBe('pointer');

    const labels = series.dataLabels as Highcharts.DataLabelsOptions;
    expect(labels.enabled).toBe(true);
    expect((labels.formatter as unknown as (this: { y: number }) => string).call({ y: 12500 })).toBe('12.5K');
    const tooltip = options.tooltip as Highcharts.TooltipOptions;
    expect((tooltip.pointFormatter as unknown as (this: { y: number }) => string).call({ y: 12500 })).toBe('<b>12.5K</b>');
    expect((chartOptions(one, result).plotOptions?.series as Highcharts.PlotSeriesOptions).cursor).toBeUndefined();
  });

  it('draws a tile as a gauge up to its target', () => {
    const gauge: CanvasItem = { ...one, type: 'tile', dimensions: [], chartType: undefined, gauge: true, target: 'Task Target' };
    const options = gaugeOptions(gauge, { columns: [], rows: [{ 'Task Count': 72, 'Task Target': 90 }] });

    expect(options?.yAxis).toMatchObject({ min: 0, max: 90 });
    expect(options?.series).toEqual([{ type: 'solidgauge', name: 'Task Count', data: [72] }]);
    expect(gaugeOptions({ ...gauge, target: undefined }, { columns: [], rows: [{ 'Task Count': 72 }] })).toBeNull();
  });
});

describe('fitHalfGauge', () => {
  it('fits the half circle to a wide card and a tall card, and stops once it fits', () => {
    const chart = (plotWidth: number, plotHeight: number) => {
      const fake = { plotWidth, plotHeight, chartWidth: plotWidth, chartHeight: plotHeight, update: vi.fn() };
      return fake;
    };
    const wide = chart(400, 100);
    fitHalfGauge(wide as never);
    expect(wide.update).toHaveBeenCalledWith({ pane: { size: 192, center: ['50%', 98] } }, true, false, false);
    fitHalfGauge(wide as never);
    expect(wide.update).toHaveBeenCalledTimes(1);

    // A plot area that keeps changing under its own updates stops after a few tries.
    const jumpy = chart(400, 100);
    for (let i = 0; i < 10; i++) { jumpy.plotHeight = 100 + (i % 2) * 20; fitHalfGauge(jumpy as never); }
    expect(jumpy.update.mock.calls.length).toBeLessThanOrEqual(3);

    const tall = chart(200, 300);
    fitHalfGauge(tall as never);
    expect(tall.update).toHaveBeenCalledWith({ pane: { size: 192, center: ['50%', 198] } }, true, false, false);
  });
});

describe('measureRows', () => {
  it('turns one row of measures into one bar per measure, named as the canvas names them', () => {
    const item: CanvasItem = { ...chart, dimensions: [], measures: ['Task Count', 'Hours'] };
    const view = measureRows(item, { columns: ['Task Count', 'Hours'], rows: [{ 'Task Count': 120, 'Hours': 2.5 }] }, { Hours: 'Hours worked' });

    expect(view.item.dimensions).toEqual([MEASURE_AXIS]);
    expect(view.item.measures).toEqual([MEASURE_VALUE]);
    expect(view.result.rows).toEqual([
      { [MEASURE_AXIS]: 'Task Count', [MEASURE_VALUE]: 120 },
      { [MEASURE_AXIS]: 'Hours worked', [MEASURE_VALUE]: 2.5 },
    ]);
    const options = chartOptions(view.item, view.result);
    expect((options.xAxis as Highcharts.XAxisOptions).categories).toEqual(['Task Count', 'Hours worked']);
  });

  it('gives an empty result as bars with no value', () => {
    const item: CanvasItem = { ...chart, dimensions: [], measures: ['Task Count'] };
    expect(measureRows(item, { columns: [], rows: [] }).result.rows).toEqual([{ [MEASURE_AXIS]: 'Task Count', [MEASURE_VALUE]: null }]);
  });
});

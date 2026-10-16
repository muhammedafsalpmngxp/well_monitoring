import { describe, expect, it } from 'vitest';
import { CanvasItem, itemQuery, newItem } from './canvas-config.util';
import { VISUALS, addToFirstWell, applyVisual, dropOnWell, removeFromWell, setValueFn, visualOf, wellsFor } from './canvas-wells.util';

const chart: CanvasItem = {
  id: 'c1', type: 'chart', title: 'Tasks by crew', x: 0, y: 0, cols: 10, rows: 12,
  datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], chartType: 'column',
};
const tile: CanvasItem = { ...chart, id: 't1', type: 'tile', dimensions: [], chartType: undefined };
const table: CanvasItem = { ...chart, id: 'r1', type: 'table', dimensions: [], measures: [], chartType: undefined };
const visual = (id: string) => VISUALS.find(candidate => candidate.id === id)!;

describe('wellsFor', () => {
  it('gives each visual its wells, filled from the object', () => {
    expect(wellsFor(chart).map(well => [well.label, well.entries])).toEqual([['X-axis', ['CrewType.code']], ['Y-axis', ['Task Count']], ['Legend', []], ['Tooltips', []], ['Sort by', []]]);
    expect(wellsFor({ ...chart, chartType: 'pie' }).map(well => [well.label, well.single])).toEqual([['Legend', false], ['Values', true], ['Tooltips', false]]);
    expect(wellsFor(tile).map(well => [well.label, well.accepts, well.entries]))
      .toEqual([['Value', 'measure', ['Task Count']], ['Target', 'measure', []], ['Compare with', 'measure', []]]);
    expect(wellsFor(table).map(well => [well.label, well.accepts])).toEqual([['Rows', 'field'], ['Values', 'measure']]);
    expect(wellsFor(newItem('text', [], null))).toEqual([]);
  });
});

describe('scatter, bubble, bullet and smoothed line', () => {
  it('fills the X, Y and Size wells by place, and asks for the measures each chart needs', () => {
    let scatter = applyVisual(chart, visual('bubble'));
    expect(wellsFor(scatter).map(well => [well.label, well.entries])).toEqual([['Details', ['CrewType.code']], ['X-axis', []], ['Y-axis', ['Task Count']], ['Size', []], ['Tooltips', []]]);
    scatter = (dropOnWell(scatter, 'size', { kind: 'measure', name: 'Workers' }) as { item: CanvasItem }).item;
    expect(itemQuery(scatter)).toBeNull();
    scatter = (dropOnWell(scatter, 'x', { kind: 'measure', name: 'Hours' }) as { item: CanvasItem }).item;
    expect([scatter.xMeasure, scatter.measures, scatter.sizeMeasure]).toEqual(['Hours', ['Task Count'], 'Workers']);
    expect(itemQuery(scatter)?.measures).toEqual(['Hours', 'Task Count', 'Workers']);
    expect(removeFromWell(scatter, 'size', 'Workers').sizeMeasure).toBeUndefined();
    expect(applyVisual({ ...chart, measures: ['Task Count', 'Hours'] }, visual('scatter'))).toEqual(expect.objectContaining({ measures: ['Task Count'], xMeasure: 'Hours' }));
  });

  it('reads the target of a bullet chart in the same query and needs one', () => {
    const bullet = applyVisual({ ...chart, measures: ['Task Count', 'Hours'] }, visual('bullet'));
    expect(bullet.measures).toEqual(['Task Count']);
    expect(itemQuery(bullet)).toBeNull();
    expect(itemQuery({ ...bullet, target: 'Task Target' })?.measures).toEqual(['Task Count', 'Task Target']);
  });

  it('makes a smoothed line a line chart with a smooth curve, and a line again without it', () => {
    const smooth = applyVisual(chart, visual('spline'));
    expect([smooth.chartType, smooth.style?.smooth, visualOf(smooth)]).toEqual(['line', true, 'spline']);
    expect(visualOf(applyVisual(smooth, visual('line')))).toBe('line');
  });
});

describe('a drillable axis', () => {
  it('takes several fields, and a date on an empty axis becomes its year, quarter, month and day', () => {
    const empty = { ...chart, dimensions: [] };
    const axis = wellsFor(empty).find(well => well.id === 'axis')!;
    expect(axis.single).toBe(false);
    const dated = (dropOnWell(empty, 'axis', { kind: 'field', name: 't.action_on', fieldKind: 'date' }) as { item: CanvasItem }).item;
    expect(dated.dimensions).toEqual(['t.action_on@year', 't.action_on@quarter', 't.action_on@month', 't.action_on@day']);
    expect(dropOnWell(dated, 'axis', { kind: 'field', name: 'c.code' })).toEqual({ problem: 'A chart drills through up to 4 fields.' });
    expect(wellsFor({ ...chart, chartType: 'combo' }).find(well => well.id === 'axis')?.single).toBe(true);
  });
});

describe('dropOnWell and removeFromWell', () => {
  it('adds an entry once, swaps the entry of a one-entry well, and refuses the wrong kind', () => {
    const added = dropOnWell(chart, 'values', { kind: 'measure', name: 'Hours' });
    expect(added).toEqual({ item: { ...chart, measures: ['Task Count', 'Hours'] } });
    expect(dropOnWell((added as { item: CanvasItem }).item, 'values', { kind: 'measure', name: 'Hours' }))
      .toEqual({ item: { ...chart, measures: ['Task Count', 'Hours'] } });
    expect(dropOnWell(chart, 'axis', { kind: 'field', name: 'TaskDaily.task_code' }))
      .toEqual({ item: { ...chart, dimensions: ['CrewType.code', 'TaskDaily.task_code'] } });
    expect(dropOnWell(chart, 'values', { kind: 'field', name: 'CrewType.code' })).toEqual({ item: {
      ...chart, measures: ['Task Count', 'Count of code'], aggregates: { 'Count of code': { field: 'CrewType.code', fn: 'count', kind: 'text' } },
    } });
    expect(dropOnWell(chart, 'axis', { kind: 'measure', name: 'Hours' }))
      .toEqual({ problem: 'X-axis takes fields. Drag a field of a table here.' });
    expect(removeFromWell(chart, 'values', 'Task Count').measures).toEqual([]);
  });

  it('puts a clicked entry in the first well that takes it', () => {
    expect(addToFirstWell(table, { kind: 'field', name: 'CrewType.code' })).toEqual({ item: { ...table, dimensions: ['CrewType.code'] } });
    expect(addToFirstWell(table, { kind: 'measure', name: 'Task Count' })).toEqual({ item: { ...table, measures: ['Task Count'] } });
    expect(addToFirstWell(tile, { kind: 'field', name: 'CrewType.code', fieldKind: 'text' }))
      .toEqual({ item: { ...tile, target: 'Count of code', aggregates: { 'Count of code': { field: 'CrewType.code', fn: 'count', kind: 'text' } } } });
    expect(addToFirstWell(newItem('text', [], null), { kind: 'measure', name: 'Task Count' }))
      .toEqual({ problem: 'Text and image objects show no data.' });
  });
});

describe('stacking', () => {
  it("keeps a column chart stacked, and turns an area chart's off with its last extra series, since its control goes with it", () => {
    expect(removeFromWell({ ...chart, series: 'TaskDaily.status', stacking: 'normal' }, 'series', 'TaskDaily.status').stacking).toBe('normal');
    const split: CanvasItem = { ...chart, chartType: 'area', series: 'TaskDaily.status', stacking: 'percent' };
    expect(removeFromWell(split, 'series', 'TaskDaily.status').stacking).toBeUndefined();
    const twoMeasures: CanvasItem = { ...chart, chartType: 'area', measures: ['Task Count', 'Hours'], stacking: 'normal' };
    expect(removeFromWell(twoMeasures, 'values', 'Hours').stacking).toBeUndefined();
    const stillSplit: CanvasItem = { ...split, measures: ['Task Count', 'Hours'] };
    expect(removeFromWell(stillSplit, 'values', 'Hours').stacking).toBe('percent');
  });
});

describe('applyVisual', () => {
  it('changes the visual and drops what the new one cannot hold', () => {
    const wide: CanvasItem = { ...table, dimensions: ['CrewType.code', 'TaskDaily.task_code'], measures: ['Task Count', 'Hours'] };

    expect(applyVisual(wide, visual('pie'))).toMatchObject({ type: 'chart', chartType: 'pie', dimensions: ['CrewType.code'], measures: ['Task Count'] });
    expect(applyVisual(wide, visual('line'))).toMatchObject({ type: 'chart', chartType: 'line', dimensions: ['CrewType.code'], measures: ['Task Count', 'Hours'] });
    expect(applyVisual(chart, visual('tile'))).toEqual({ ...chart, type: 'tile', chartType: undefined, dimensions: [], measures: ['Task Count'] });
    expect(applyVisual(chart, visual('table'))).toEqual({ ...chart, type: 'table', chartType: undefined });
    expect(visualOf(chart)).toBe('column');
    expect(visualOf(tile)).toBe('tile');
    expect(VISUALS.map(entry => entry.id)).toEqual([
      'column', 'bar', 'stacked-column', 'stacked-bar', 'line', 'spline', 'area', 'combo', 'pie', 'donut', 'treemap', 'waterfall', 'funnel', 'scatter', 'bubble', 'bullet', 'tile', 'gauge', 'table', 'matrix', 'slicer', 'text', 'image',
    ]);
  });
});

describe('the visuals of plan 10', () => {
  it('gives the new visuals their wells, and a click fills the first empty well that takes it', () => {
    const labels = (item: CanvasItem) => wellsFor(item).map(well => well.label);
    expect(labels({ ...chart, chartType: 'combo' })).toEqual(['X-axis', 'Y-axis', 'Tooltips', 'Sort by']);
    expect(labels({ ...chart, chartType: 'treemap' })).toEqual(['Category', 'Values', 'Tooltips']);
    expect(labels({ ...tile, gauge: true })).toEqual(['Value', 'Target']);
    expect(labels({ ...table, type: 'matrix' })).toEqual(['Rows', 'Values']);
    expect(labels({ ...table, type: 'slicer' })).toEqual(['Field']);

    const split = dropOnWell(chart, 'series', { kind: 'field', name: 'TaskDaily.status' });
    expect(split).toEqual({ item: { ...chart, series: 'TaskDaily.status' } });
    expect(removeFromWell((split as { item: CanvasItem }).item, 'series', 'TaskDaily.status').series).toBeUndefined();
    expect(dropOnWell(tile, 'target', { kind: 'measure', name: 'Task Target' })).toEqual({ item: { ...tile, target: 'Task Target' } });

    expect(addToFirstWell(chart, { kind: 'field', name: 'TaskDaily.status' })).toEqual({ item: { ...chart, series: 'TaskDaily.status' } });
    expect(addToFirstWell(tile, { kind: 'measure', name: 'Task Target' })).toEqual({ item: { ...tile, target: 'Task Target' } });
    expect(addToFirstWell({ ...table, type: 'slicer' }, { kind: 'measure', name: 'Task Count' })).toEqual({ problem: 'A slicer takes no measures.' });
  });

  it('switches to the new visuals and keeps only what each one can hold', () => {
    const split: CanvasItem = {
      ...chart, measures: ['Task Count', 'Hours'], series: 'TaskDaily.status', stacking: 'normal', format: { style: 'compact', decimals: 1 },
    };
    expect(applyVisual(split, visual('area'))).toMatchObject({
      chartType: 'area', series: 'TaskDaily.status', stacking: 'normal', format: { style: 'compact', decimals: 1 }, measures: ['Task Count', 'Hours'],
    });
    const donut = applyVisual(split, visual('donut'));
    expect(donut).toMatchObject({ type: 'chart', chartType: 'donut', measures: ['Task Count'] });
    expect(donut.series).toBeUndefined();
    expect(applyVisual(tile, visual('gauge'))).toEqual({ ...tile, chartType: undefined, gauge: true });
    expect(visualOf(applyVisual(tile, visual('gauge')))).toBe('gauge');
    expect(applyVisual(chart, visual('matrix'))).toEqual({ ...chart, type: 'matrix', chartType: undefined, totals: true });
    expect(applyVisual(chart, visual('slicer'))).toEqual({
      ...chart, type: 'slicer', chartType: undefined, measures: [], slicer: { kind: 'list', values: [] },
    });
  });
});

describe('fields in value wells', () => {
  it('adds a number field up as a sum, changes how it is added up, sends it with the query and forgets it once removed', () => {
    const chart: CanvasItem = { ...newItem('chart', [], 7), chartType: 'column', dimensions: ['t.code'] };
    const dropped = dropOnWell(chart, 'values', { kind: 'field', name: 't.data_hours', fieldKind: 'number' });
    if (!('item' in dropped)) throw new Error(dropped.problem);
    expect(dropped.item.measures).toEqual(['Sum of data_hours']);

    const averaged = setValueFn(dropped.item, 'Sum of data_hours', 'avg');
    expect(averaged.measures).toEqual(['Average of data_hours']);
    expect(averaged.aggregates).toEqual({ 'Average of data_hours': { field: 't.data_hours', fn: 'avg', kind: 'number' } });
    expect(itemQuery(averaged)?.values).toEqual([{ name: 'Average of data_hours', field: 't.data_hours', fn: 'avg' }]);

    const text = dropOnWell(averaged, 'values', { kind: 'field', name: 't.code', fieldKind: 'text' });
    if (!('item' in text)) throw new Error(text.problem);
    expect(text.item.measures).toEqual(['Average of data_hours', 'Count of code']);

    const removed = removeFromWell(text.item, 'values', 'Average of data_hours');
    expect(Object.keys(removed.aggregates ?? {})).toEqual(['Count of code']);
  });
});

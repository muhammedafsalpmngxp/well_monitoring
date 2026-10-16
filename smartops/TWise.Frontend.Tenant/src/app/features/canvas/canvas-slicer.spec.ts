import { describe, expect, it } from 'vitest';
import {
  CanvasItem, SLICER_HIGH, SLICER_LOW, itemQuery, readCanvasConfig, renameSyncedSheet, serializeCanvas, sheetFilters, slicerFilters,
  slicerStyle, syncedSlicers,
} from './canvas-config.util';

const slicer = (id: string, slicerState: CanvasItem['slicer']): CanvasItem => ({
  id, type: 'slicer', title: id, x: 0, y: 0, cols: 4, rows: 6, datasetId: 7, dimensions: ['w.SpudDate'], measures: [], slicer: slicerState,
});
const tile = { id: 't', type: 'tile', title: 'T', x: 4, y: 0, cols: 4, rows: 4, datasetId: 7, dimensions: [], measures: ['Wells'] } as CanvasItem;

describe('canvas slicers', () => {
  it('keeps the style of slicers saved before styles', () => {
    expect(slicerStyle({ kind: 'list', values: [] })).toBe('list');
    expect(slicerStyle({ kind: 'range', values: [] })).toBe('between');
    expect(slicerStyle({ kind: 'list', values: [], style: 'tiles' })).toBe('tiles');
  });

  it('reads the lowest and highest value for ranges and the values for lists', () => {
    const range = itemQuery(slicer('s', { kind: 'range', values: [], style: 'between' }))!;
    expect(range.dimensions).toEqual([]);
    expect(range.values).toEqual([
      { name: SLICER_LOW, field: 'w.SpudDate', fn: 'min' }, { name: SLICER_HIGH, field: 'w.SpudDate', fn: 'max' },
    ]);
    expect(itemQuery(slicer('s', { kind: 'list', values: [], style: 'dropdown' }))!.dimensions).toEqual(['w.SpudDate']);
  });

  it('filters by before, after and relative periods', () => {
    expect(slicerFilters('f', { kind: 'range', values: ['', '2026-06-30'], style: 'before' })).toEqual([{ field: 'f', op: 'lte', values: ['2026-06-30'] }]);
    expect(slicerFilters('f', { kind: 'range', values: ['10', ''], style: 'after' })).toEqual([{ field: 'f', op: 'gte', values: ['10'] }]);
    expect(slicerFilters('f', { kind: 'relative', values: [], last: { n: 3, unit: 'months' } }, new Date(2026, 8, 25)))
      .toEqual([{ field: 'f', op: 'gte', values: ['2026-06-25'] }]);
    expect(slicerFilters('f', { kind: 'relative', values: [] })).toEqual([]);
  });

  it('applies a synced slicer to the sheets it syncs to, and follows a sheet rename', () => {
    const all = slicer('all', { kind: 'list', values: ['2026-01-01'], sync: 'all' });
    const chosen = slicer('chosen', { kind: 'list', values: ['2026-02-01'], sync: ['Detail'] });
    const own = slicer('own', { kind: 'list', values: ['2026-03-01'] });
    const sheets = [{ name: 'Overview', items: [all, chosen, own] }, { name: 'Detail', items: [tile] }, { name: 'Map', items: [] }];

    expect(syncedSlicers(sheets, 'Detail').map(item => item.id)).toEqual(['all', 'chosen']);
    expect(syncedSlicers(sheets, 'Map').map(item => item.id)).toEqual(['all']);
    expect(syncedSlicers(sheets, 'Overview')).toEqual([]);
    expect(sheetFilters([tile], tile, 7, null, [], syncedSlicers(sheets, 'Detail'))).toEqual([
      { field: 'w.SpudDate', op: 'in', values: ['2026-01-01'] }, { field: 'w.SpudDate', op: 'in', values: ['2026-02-01'] },
    ]);
    expect(renameSyncedSheet([chosen], 'Detail', 'Wells')[0].slicer!.sync).toEqual(['Wells']);
  });

  it('saves the new slicer settings and drops broken ones', () => {
    const good = slicer('s', { kind: 'relative', values: [], style: 'relative', single: true, last: { n: 7, unit: 'days' }, sync: ['B'] });
    expect(readCanvasConfig(serializeCanvas([{ name: 'A', items: [good] }]))![0].items[0].slicer).toEqual(good.slicer);
    const broken = slicer('b', { kind: 'relative', values: [], last: { n: 0, unit: 'weeks' as never } });
    expect(readCanvasConfig(serializeCanvas([{ name: 'A', items: [broken] }]))![0].items).toEqual([]);
  });
});

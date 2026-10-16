import { describe, expect, it } from 'vitest';
import { CanvasFilter, filterQuery, filterSummary, readFilters, relativeStart } from './canvas-filter.util';
import { CanvasItem, readCanvasConfig, readCanvasFilters, serializeCanvas, sheetFilters } from './canvas-config.util';

const today = new Date(2026, 8, 25);
const basic = (values: string[], exclude?: boolean): CanvasFilter => ({ field: 'w.Region', kind: 'text', mode: 'basic', values, exclude });
const advanced = (op: CanvasFilter['op'], value?: string, value2?: string, kind: CanvasFilter['kind'] = 'number'): CanvasFilter =>
  ({ field: 'w.Depth', kind, mode: 'advanced', values: [], op, value, value2 });

describe('canvas filters', () => {
  it('turns basic filters into in and not in, and filters nothing while no value is ticked', () => {
    expect(filterQuery(basic([]))).toEqual([]);
    expect(filterQuery(basic(['North', 'South']))).toEqual([{ field: 'w.Region', op: 'in', values: ['North', 'South'] }]);
    expect(filterQuery(basic(['North'], true))).toEqual([{ field: 'w.Region', op: 'not_in', values: ['North'] }]);
  });

  it('turns advanced conditions into query filters', () => {
    expect(filterQuery(advanced('gt', '5'))).toEqual([{ field: 'w.Depth', op: 'gt', values: ['5'] }]);
    expect(filterQuery(advanced('gt'))).toEqual([]);
    expect(filterQuery(advanced('between', '1', '9'))).toEqual([{ field: 'w.Depth', op: 'between', values: ['1', '9'] }]);
    expect(filterQuery(advanced('between', '', '9'))).toEqual([{ field: 'w.Depth', op: 'lte', values: ['9'] }]);
    expect(filterQuery(advanced('blank'))).toEqual([{ field: 'w.Depth', op: 'is_null' }]);
    expect(filterQuery(advanced('contains', 'ab', undefined, 'text'))).toEqual([{ field: 'w.Depth', op: 'contains', values: ['ab'] }]);
    expect(filterQuery(advanced('before', '2026-01-31', undefined, 'date'))).toEqual([{ field: 'w.Depth', op: 'lt', values: ['2026-01-31'] }]);
    expect(filterQuery(advanced('last_days', '7', undefined, 'date'), today)).toEqual([{ field: 'w.Depth', op: 'gte', values: ['2026-09-18'] }]);
    expect(filterQuery(advanced('last_days', '-2', undefined, 'date'), today)).toEqual([]);
  });

  it('counts relative dates back by days, months and years', () => {
    expect(relativeStart('last_months', 1, new Date(2026, 2, 31))).toBe('2026-02-28');
    expect(relativeStart('last_years', 2, today)).toBe('2024-09-25');
  });

  it('describes what a filter keeps', () => {
    expect(filterSummary(basic([]))).toBe('is (All)');
    expect(filterSummary(basic(['A', 'B', 'C', 'D'], true))).toBe('is not A, B, C and 1 more');
    expect(filterSummary(advanced('gte', '3'))).toBe('is greater than or equal to 3');
    expect(filterSummary(advanced('last_months', '6', undefined, 'date'))).toBe('is in the last 6 months');
  });

  it('keeps well-formed saved filters only', () => {
    expect(readFilters('x')).toBeNull();
    expect(readFilters([basic(['A']), { field: 'nodot', kind: 'text', mode: 'basic', values: [] }, { ...basic([]), op: 'drop' }]))
      .toEqual([basic(['A'])]);
  });

  it('saves filters on objects, sheets and all pages, and applies them to the objects of the canvas data model', () => {
    const tile = { id: 't', type: 'tile', title: 'T', x: 0, y: 0, cols: 4, rows: 4, datasetId: 7, dimensions: [], measures: ['Oil'],
      filters: [advanced('gt', '5')] } as CanvasItem;
    const json = serializeCanvas([{ name: 'A', items: [tile], filters: [basic(['North'])] }], 7, { filters: [basic(['East'], true)] });
    const sheets = readCanvasConfig(json)!;
    expect(sheets[0].filters).toEqual([basic(['North'])]);
    expect(sheets[0].items[0].filters).toEqual([advanced('gt', '5')]);
    expect(readCanvasFilters(json)).toEqual([basic(['East'], true)]);

    const scoped = [...readCanvasFilters(json), ...sheets[0].filters!];
    expect(sheetFilters(sheets[0].items, sheets[0].items[0], 7, null, scoped)).toEqual([
      { field: 'w.Region', op: 'not_in', values: ['East'] },
      { field: 'w.Region', op: 'in', values: ['North'] },
      { field: 'w.Depth', op: 'gt', values: ['5'] },
    ]);
    expect(sheetFilters(sheets[0].items, { ...tile, datasetId: 8 }, 7, null, scoped)).toEqual([]);
  });

  it('joins two advanced conditions with and or or, and turns Top N into a top filter', () => {
    const two = (join: 'and' | 'or'): CanvasFilter => ({ ...advanced('lt', '5'), second: { join, op: 'gt', value: '90' } });
    expect(filterQuery(two('or'))).toEqual([{ field: 'w.Depth', op: 'any', any: [
      { field: 'w.Depth', op: 'lt', values: ['5'] }, { field: 'w.Depth', op: 'gt', values: ['90'] }] }]);
    expect(filterQuery(two('and'))).toHaveLength(2);
    expect(filterSummary(two('or'))).toBe('is less than 5 or is greater than 90');

    const top: CanvasFilter = { field: 'w.Region', kind: 'text', mode: 'top', values: [], top: { direction: 'bottom', count: 3, measure: 'Wells' } };
    expect(filterQuery(top)).toEqual([{ field: 'w.Region', op: 'bottom', values: ['3', 'Wells'] }]);
    expect(filterSummary(top)).toBe('Bottom 3 by Wells');
    expect(readFilters([top, { ...top, top: { direction: 'up', count: 3, measure: 'x' } }])).toEqual([top]);

    const bySum: CanvasFilter = { ...top, top: { direction: 'top', count: 5, measure: 'w.Depth', fn: 'sum' } };
    expect(filterQuery(bySum)).toEqual([{ field: 'w.Region', op: 'top', values: ['5', 'w.Depth', 'sum'] }]);
    expect(filterSummary(bySum)).toBe('Top 5 by Sum of Depth');
    expect(readFilters([bySum, { ...bySum, top: { ...bySum.top!, fn: 'median' as never } }])).toEqual([bySum]);
  });
});

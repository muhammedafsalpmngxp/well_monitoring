import { describe, expect, it } from 'vitest';
import { bindCustomVisualRows, bindCustomVisualTemplate, isMultiRoleVisual } from './custom-visual-binding';
import type { CustomVisualDataRole } from './marketplace.service';

const role = (key: string, type: 'dimension' | 'measure', allowMultiple = false): CustomVisualDataRole =>
  ({ key, label: key, type, required: true, allowMultiple });
const sum = (values: unknown[]) => values.reduce<number>((total, value) => total + Number(value), 0);
const rows = [
  { Month: 'Jan', Cluster: 'Nimr', Output: 10, Target: 12, X: 3, Y: 9, D: '2026-01-02', O: 5, H: 9, L: 4, C: 8 },
  { Month: 'Jan', Cluster: 'Marmul', Output: 4, Target: 6, X: 1, Y: 2, D: '2026-01-01', O: 6, H: 7, L: 3, C: 5 },
  { Month: 'Feb', Cluster: 'Nimr', Output: 7, Target: 8, X: 2, Y: 5, D: '2026-01-03', O: 8, H: 10, L: 7, C: 9 },
];

describe('custom visual binding', () => {
  it('keeps the one-category, one-measure visuals on the existing binding', () => {
    expect(isMultiRoleVisual([role('category', 'dimension'), role('measure', 'measure')])).toBe(false);
    const options = bindCustomVisualTemplate('{"xAxis":{"categories":"{{category}}"},"series":[{"type":"column"}]}',
      [role('category', 'dimension'), role('measure', 'measure')], { labels: ['A', 'B'], values: [1, 2] });
    expect(options!['xAxis'].categories).toEqual(['A', 'B']);
    expect(options!['series'][0].data).toEqual([1, 2]);
  });

  it('draws one series per split value, aggregated per category', () => {
    const roles = [role('category', 'dimension'), role('split', 'dimension'), role('measure', 'measure')];
    expect(isMultiRoleVisual(roles)).toBe(true);
    const options = bindCustomVisualRows('{"xAxis":{"categories":"{{category}}"},"series":[{"type":"line"}]}', roles,
      { rows, columns: { category: ['Month'], split: ['Cluster'], measure: ['Output'] }, aggregate: sum });
    expect(options!['xAxis'].categories).toEqual(['Jan', 'Feb']);
    expect(options!['series'].map((s: any) => [s.name, s.data])).toEqual([['Nimr', [10, 7]], ['Marmul', [4, null]]]);
  });

  it('draws one series per measure and binds single measures per category', () => {
    const many = bindCustomVisualRows('{"series":[{"type":"area"}]}', [role('category', 'dimension'), role('measures', 'measure', true)],
      { rows, columns: { category: ['Month'], measures: ['Output', 'Target'] }, aggregate: sum });
    expect(many!['series'].map((s: any) => [s.name, s.data])).toEqual([['Output', [14, 7]], ['Target', [18, 8]]]);
    const dual = bindCustomVisualRows('{"series":[{"type":"column","data":"{{measure2}}"}]}',
      [role('category', 'dimension'), role('measure', 'measure'), role('measure2', 'measure')],
      { rows, columns: { category: ['Month'], measure: ['Output'], measure2: ['Target'] }, aggregate: sum });
    expect(dual!['series'][0].data).toEqual([18, 8]);
  });

  it('draws X/Y points, OHLC rows in date order, and level nodes', () => {
    const xy = bindCustomVisualRows('{"colorAxis":{},"series":[{"type":"line"}]}', [role('x', 'measure'), role('y', 'measure'), role('color', 'measure')],
      { rows, columns: { x: ['X'], y: ['Y'], color: [] }, aggregate: sum });
    expect(xy!['series'][0].data.map((p: any) => [p.x, p.y])).toEqual([[1, 2], [2, 5], [3, 9]]);
    expect(xy!['colorAxis']).toBeUndefined();

    const ohlc = bindCustomVisualRows('{"series":[{"type":"ohlc"}]}', ['date', 'open', 'high', 'low', 'close'].map(k => role(k, k === 'date' ? 'dimension' : 'measure')),
      { rows, columns: { date: ['D'], open: ['O'], high: ['H'], low: ['L'], close: ['C'] }, aggregate: sum });
    expect(ohlc!['series'][0].data.map((p: number[]) => p.slice(1))).toEqual([[6, 7, 3, 5], [5, 9, 4, 8], [8, 10, 7, 9]]);

    const tree = bindCustomVisualRows('{"series":[{"type":"sunburst"}]}', [role('levels', 'dimension', true), role('measure', 'measure')],
      { rows, columns: { levels: ['Cluster', 'Month'], measure: ['Output'] }, aggregate: sum });
    expect(tree!['series'][0].data).toContainEqual({ id: '|Nimr|Jan', parent: '|Nimr', name: 'Jan', value: 10 });
    expect(tree!['series'][0].data).toContainEqual({ id: '|Nimr', parent: undefined, name: 'Nimr' });
  });

  it('groups X/Y and latitude/longitude rows into density cells', () => {
    const density = bindCustomVisualRows('{"colorAxis":{"min":0},"series":[{"type":"heatmap"}]}', [role('x', 'measure'), role('y', 'measure')],
      { rows, columns: { x: ['X'], y: ['Y'] }, aggregate: sum });
    expect(density!['colorAxis']).toEqual({ min: 0 });
    expect(density!['series'][0].data.reduce((total: number, cell: any) => total + cell.value, 0)).toBe(3);

    const geo = [{ Lat: 23.6, Lon: 58.4, W: 2 }, { Lat: 23.6, Lon: 58.4, W: 3 }, { Lat: 17.0, Lon: 54.1, W: 1 }, { Lat: 999, Lon: 0, W: 9 }];
    const map = bindCustomVisualRows('{"mapView":{"padding":30},"series":[{"type":"tiledwebmap"},{"type":"geoheatmap"}]}',
      [role('latitude', 'measure'), role('longitude', 'measure'), role('weight', 'measure')],
      { rows: geo, columns: { latitude: ['Lat'], longitude: ['Lon'], weight: ['W'] }, aggregate: sum });
    expect(map!['series'][0].data).toBeUndefined();
    expect(map!['series'][1].data.map((cell: any) => cell.value).sort()).toEqual([1, 5]);
    expect(map!['mapView'].padding).toBe(30);
    expect(map!['mapView'].fitToGeometry.coordinates).toHaveLength(2);
  });

  it('colours tree nodes by value, draws one sunburst per group and a category heatmap', () => {
    const levels = [role('levels', 'dimension', true), role('measure', 'measure'), role('color', 'measure')];
    const colored = bindCustomVisualRows('{"series":[{"type":"treemap"}]}', levels,
      { rows, columns: { levels: ['Cluster'], measure: ['Output'], color: ['Target'] }, aggregate: sum });
    expect(colored!['series'][0].data).toContainEqual({ id: '|Nimr', parent: undefined, name: 'Nimr', value: 17, colorValue: 20 });

    const groups = bindCustomVisualRows('{"series":[{"type":"sunburst"}]}', [role('levels', 'dimension', true), role('split', 'dimension'), role('measure', 'measure')],
      { rows, columns: { levels: ['Month'], split: ['Cluster'], measure: ['Output'] }, aggregate: sum });
    expect(groups!['series'].map((s: any) => [s.name, s.center])).toEqual([['Nimr', ['25%', '50%']], ['Marmul', ['75%', '50%']]]);

    const matrix = bindCustomVisualRows('{"xAxis":{"categories":"{{category}}"},"yAxis":{"categories":"{{row}}"},"series":[{"type":"heatmap"}]}',
      [role('category', 'dimension'), role('row', 'dimension'), role('measure', 'measure')],
      { rows, columns: { category: ['Month'], row: ['Cluster'], measure: ['Output'] }, aggregate: sum });
    expect(matrix!['yAxis'].categories).toEqual(['Nimr', 'Marmul']);
    expect(matrix!['series'][0].data).toEqual([[0, 0, 10], [0, 1, 4], [1, 0, 7]]);
  });

  it('explains what is missing instead of drawing nothing', () => {
    expect(() => bindCustomVisualRows('{"series":[{"type":"ohlc"}]}', [role('date', 'dimension')],
      { rows, columns: { date: ['D'] }, aggregate: sum })).toThrow(/Open, High, Low and Close/);
  });
});

import '@angular/compiler';
import { ColDef } from 'ag-grid-community';
import type Highcharts from 'highcharts';
import { describe, expect, it, vi } from 'vitest';
import { NEVER, of, throwError } from 'rxjs';
import { CanvasItem } from '../canvas-config.util';
import { CanvasObjectComponent, withCues } from './canvas-object.component';
// Imported for its NgModule metadata only. CanvasObjectComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { CanvasModule } from '../canvas.module';

const chart: CanvasItem = {
  id: 'c1', type: 'chart', title: 'Tasks by crew', x: 0, y: 0, cols: 10, rows: 12,
  datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], chartType: 'column',
};
const result = {
  columns: ['CrewType.code', 'Task Count'],
  rows: [{ 'CrewType.code': 'WL', 'Task Count': 120 }, { 'CrewType.code': 'RG', 'Task Count': 40 }],
};

function create(runQuery = vi.fn().mockReturnValue(of(result))) {
  const component = new CanvasObjectComponent({ runQuery } as never, { markForCheck: vi.fn() } as never, { bypassSecurityTrustHtml: (html: string) => html } as never);
  return { component, runQuery };
}

describe('CanvasObjectComponent', () => {
  it('runs its query once and redraws without a new query when only the look changes', () => {
    const { component, runQuery } = create();

    component.item = chart;
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledExactlyOnceWith({
      datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 50, sort: { field: 'Task Count', descending: true },
    });
    expect(component.state).toBe('ready');
    expect((component.options?.xAxis as { categories: string[] }).categories).toEqual(['WL', 'RG']);

    component.item = { ...chart, title: 'Crews', chartType: 'bar' };
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(component.options?.chart?.type).toBe('bar');
    component.ngOnDestroy();
  });

  it('shows a tile value, and what an incomplete object still needs without asking the server', () => {
    const { component, runQuery } = create(vi.fn().mockReturnValue(of({ columns: ['Task Count'], rows: [{ 'Task Count': 73302 }] })));

    component.item = { ...chart, id: 't1', type: 'tile', dimensions: [], chartType: undefined };
    component.ngOnChanges();
    expect(component.value).toBe('73,302');

    component.item = { ...component.item, measures: [] };
    component.ngOnChanges();
    expect(component.state).toBe('incomplete');
    expect(component.problem).toBe('Choose one measure.');
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('explains a refusal in plain language', () => {
    const refusal = { status: 422, error: { code: 'fan_trap', message: 'Crew Size would count each CrewType row once per matching TaskDaily row.' } };
    const { component } = create(vi.fn().mockReturnValue(throwError(() => refusal)));

    component.item = chart;
    component.ngOnChanges();

    expect(component.state).toBe('error');
    expect(component.error?.message).toContain('Crew Size would count');
    expect(component.error?.hint).toContain('more than once');
  });

  it('shows a table and says when the row limit cut it short', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ 'CrewType.code': `C${i}`, 'Task Count': i }));
    const { component } = create(vi.fn().mockReturnValue(of({ columns: ['CrewType.code', 'Task Count'], rows })));

    component.item = { ...chart, type: 'table', chartType: undefined };
    component.ngOnChanges();

    expect(component.limited).toBe(true);
    // One column per field and measure: no row numbers, no header menus.
    expect(component.columnDefs.map(column => (column as { headerName?: string }).headerName)).toEqual(['code', 'Task Count']);
  });

  it('asks for fresh data on Refresh and on Refresh all, but not when it first loads', () => {
    const { component, runQuery } = create();

    component.item = chart;
    component.refreshToken = 3;
    component.ngOnChanges();
    expect(runQuery.mock.calls[0][0]).not.toHaveProperty('refresh');

    component.refresh();
    expect(runQuery.mock.calls[1][0]).toMatchObject({ datasetId: 7, measures: ['Task Count'], refresh: true });

    component.refreshToken = 4;
    component.ngOnChanges();
    expect(runQuery.mock.calls[2][0]).toMatchObject({ datasetId: 7, refresh: true });

    component.item = { ...chart, title: 'Crews' };
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledTimes(3);
    expect(component.state).toBe('ready');
    component.ngOnDestroy();
  });

  it('can be refreshed after a refusal', () => {
    const busy = { status: 422, error: { code: 'busy', message: 'Too many queries are running. Try again in a moment.' } };
    const { component, runQuery } = create(vi.fn().mockReturnValueOnce(throwError(() => busy)).mockReturnValueOnce(of(result)));

    component.item = chart;
    component.ngOnChanges();
    expect(component.state).toBe('error');

    component.refresh();
    expect(component.state).toBe('ready');
    expect(runQuery.mock.calls[1][0]).toMatchObject({ refresh: true });
  });

  it('shows a skeleton shaped like the object while its data loads', () => {
    const { component } = create(vi.fn().mockReturnValue(NEVER));

    component.item = chart;
    component.ngOnChanges();
    expect(component.state).toBe('loading');
    expect(component.skeleton).toBe('skeleton-bars');

    component.item = { ...chart, type: 'table', chartType: undefined };
    expect(component.skeleton).toBe('skeleton-table');
    component.item = { ...chart, type: 'tile', dimensions: [], chartType: undefined };
    expect(component.skeleton).toBe('skeleton-tile');
    component.ngOnDestroy();
  });

  it('shows text and images without asking the server, and says what they still need', () => {
    const { component, runQuery } = create();

    component.item = { ...chart, id: 'x1', type: 'text', datasetId: null, dimensions: [], measures: [], chartType: undefined, text: '' };
    component.ngOnChanges();
    expect(component.state).toBe('incomplete');
    expect(component.problem).toBe('Write the text.');

    component.item = { ...component.item, text: 'Crew hours, September' };
    component.ngOnChanges();
    expect(component.state).toBe('static');

    component.item = { ...component.item, type: 'image', text: undefined, imageUrl: 'https://example.com/logo.png', alt: 'Logo' };
    component.ngOnChanges();
    expect(component.state).toBe('static');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('sends the sheet filters with its query, and asks again only when they change', () => {
    const { component, runQuery } = create();
    const filters = [{ field: 'TaskDaily.status', op: 'in' as const, values: ['Open'] }];

    component.item = chart;
    component.filters = filters;
    component.ngOnChanges();
    expect(runQuery.mock.calls[0][0]).toMatchObject({ filters });

    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledTimes(1);
    component.filters = [];
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls[1][0]).not.toHaveProperty('filters');
    component.ngOnDestroy();
  });

  it('reports a clicked chart point as its field and value', () => {
    const { component } = create();
    const clicks: unknown[] = [];
    component.pointClick.subscribe(click => clicks.push(click));

    component.item = chart;
    component.ngOnChanges();
    const series = component.options?.plotOptions?.series as Highcharts.PlotSeriesOptions;
    const click = series.point?.events?.click as unknown as (this: { index: number }, event: object) => void;
    click.call({ index: 1 }, {});
    click.call({ index: 1 }, { ctrlKey: true });

    expect(clicks).toEqual([{ field: 'CrewType.code', value: 'RG', additive: false }, { field: 'CrewType.code', value: 'RG', additive: true }]);
  });

  it('shows a KPI card against its target and comparison, or a gauge', () => {
    const card: CanvasItem = { ...chart, id: 't1', type: 'tile', dimensions: [], chartType: undefined, target: 'Task Target', compare: 'Last month' };
    const { component, runQuery } = create(vi.fn().mockReturnValue(of({ columns: [], rows: [{ 'Task Count': 900, 'Task Target': 1000, 'Last month': 800 }] })));

    component.item = card;
    component.ngOnChanges();
    expect(runQuery.mock.calls[0][0].measures).toEqual(['Task Count', 'Task Target', 'Last month']);
    expect(component.tile).toMatchObject({ value: '900', progress: 90, tone: 'warn', delta: { good: true } });
    expect(component.options).toBeNull();

    component.item = { ...card, gauge: true, compare: undefined };
    component.ngOnChanges();
    expect(component.options?.chart?.type).toBe('solidgauge');
  });

  it("shows a matrix with its totals first, in the object's number format and coloured by its rules", () => {
    const matrix: CanvasItem = {
      ...chart, id: 'm1', type: 'matrix', chartType: undefined, totals: true, format: { style: 'number', decimals: 0 },
      rules: [{ field: 'Task Count', op: 'gt', values: ['100'], tone: 'bad' }],
    };
    const rows = [{ 'CrewType.code': null, 'Task Count': 160.4, '__level': 1 }, { 'CrewType.code': 'WL', 'Task Count': 120, '__level': 0 }];
    const { component, runQuery } = create(vi.fn().mockReturnValue(of({ columns: ['CrewType.code', 'Task Count', '__level'], rows })));

    component.item = matrix;
    component.ngOnChanges();
    expect(runQuery.mock.calls[0][0]).toMatchObject({ totals: true, topN: 500 });
    expect(component.rowData.map(row => [row['CrewType.code'], row['__kind']])).toEqual([['Grand total', 'total'], ['WL', 'detail']]);
    expect(component.matrixRowClass({ data: component.rowData[0] } as never)).toBe('canvas-object__row--total');
    expect(component.columnDefs.some(column => 'field' in column && column.field === '__level')).toBe(false);

    const count = component.columnDefs.find(column => 'field' in column && column.field === 'Task Count') as ColDef;
    expect((count.cellClassRules?.['canvas-object__cell--bad'] as (params: unknown) => boolean)({ value: 120 })).toBe(true);
    expect((count.cellClassRules?.['canvas-object__cell--good'] as (params: unknown) => boolean)({ value: 120 })).toBe(false);
    expect((count.valueFormatter as (params: unknown) => string)({ value: 160.4 })).toBe('160');
  });

  it("lists a slicer's values, narrows them to a search and reports the choice", () => {
    const slicer: CanvasItem = { ...chart, id: 's1', type: 'slicer', chartType: undefined, measures: [], slicer: { kind: 'list', values: ['WL'] } };
    const { component, runQuery } = create(vi.fn().mockReturnValue(of({
      columns: ['CrewType.code'], rows: [{ 'CrewType.code': 'RG' }, { 'CrewType.code': 'WL' }, { 'CrewType.code': null }],
    })));
    const changes: unknown[] = [];
    component.slicerChange.subscribe(change => changes.push(change));

    component.item = slicer;
    component.ngOnChanges();
    expect(runQuery.mock.calls[0][0]).toMatchObject({ dimensions: ['CrewType.code'], measures: [], sort: { field: 'CrewType.code', descending: false } });
    expect(component.skeleton).toBe('skeleton-table');
    expect(component.slicerValues).toEqual(['RG', 'WL']);
    expect(component.isChosen('WL')).toBe(true);
    component.slicerSearch = 'r';
    expect(component.slicerShown).toEqual(['RG']);

    component.toggleValue('RG');
    component.toggleValue('WL');
    component.item = { ...slicer, slicer: { kind: 'range', values: [] } };
    component.setRange(1, ' 8 ');
    component.clearSlicer();
    expect(changes).toEqual([
      { kind: 'list', values: ['WL', 'RG'] }, { kind: 'list', values: [] },
      { kind: 'range', values: ['', '8'] }, { kind: 'range', values: [] },
    ]);
  });
});

describe('withCues', () => {
  const rows = [{ a: 'x', v: 10 }, { a: 'y', v: 40 }, { a: 'Total', v: 50, __kind: 'total' }];
  const style = (params: object) => (col: ColDef) => (col.cellStyle as (p: object) => Record<string, string>)(params);

  it('draws a bar as wide as the value against the widest detail value, and leaves totals plain', () => {
    const [column] = withCues([{ field: 'v' }], rows, { dataBars: ['v'], barColor: '#112233' }) as ColDef[];
    expect(style({ value: 10, data: rows[0], node: {} })(column)['backgroundImage']).toBe('linear-gradient(90deg, #11223359 25%, transparent 25%)');
    expect(style({ value: 50, data: rows[2], node: {} })(column)).toEqual({});
  });

  it('shades a heatmap cell from light at the lowest value to strong at the highest', () => {
    const [column] = withCues([{ field: 'v' }], rows, { heatmap: ['v'], heatColor: '#16a34a' }) as ColDef[];
    expect(style({ value: 10, data: rows[0], node: {} })(column)['backgroundColor']).toBe('#16a34a14');
    expect(style({ value: 40, data: rows[1], node: {} })(column)['backgroundColor']).toBe('#16a34acc');
  });

  it('leaves the columns as they are without bars or a heatmap', () => {
    const columns = [{ field: 'v' }];
    expect(withCues(columns, rows, undefined)).toBe(columns);
  });
});

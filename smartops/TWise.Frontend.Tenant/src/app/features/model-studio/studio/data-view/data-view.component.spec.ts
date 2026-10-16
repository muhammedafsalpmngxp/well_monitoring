import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { DATA_VIEW_ROWS, DataViewComponent } from './data-view.component';
// Imported for its NgModule metadata only. DataViewComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../../model-studio.module';

const source = { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'c', rlsMode: 'none' as const, rlsPlantColumn: null };
const other = { id: 3, schemaName: 'core', sourceName: 'TaskDaily', alias: 't', rlsMode: 'none' as const, rlsPlantColumn: null };
const columns = new Map([
  ['ref.crewtype', [{ columnName: 'crew_type_id', dataType: 'int', ordinalPosition: 1 }, { columnName: 'code', dataType: 'varchar', ordinalPosition: 2 }]],
  ['core.taskdaily', [{ columnName: 'task_daily_id', dataType: 'bigint', ordinalPosition: 1 }]],
]);
const dataset = {
  id: 1, name: 'Data check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [source, other], relationships: [], transforms: [],
  measures: [
    { id: 5, name: 'Crew Count', expression: null, homeSourceId: 2 },
    { id: 6, name: 'Task Count', expression: null, homeSourceId: 3 },
    { id: 7, name: 'Total Hours', expression: null, homeSourceId: null },
  ],
  calculatedColumns: [{ id: 20, sourceId: 2, name: 'Prefix', dataType: 'text', expression: null }],
};
const rows = {
  columns: ['c.crew_type_id', 'c.code', 'c.Prefix'], rows: [{ 'c.crew_type_id': 1, 'c.code': 'NDT0001', 'c.Prefix': 'NDT' }],
  fetchedAt: '2026-09-22T08:00:00Z', fromCache: false,
};
const totals = { columns: ['Crew Count', 'Total Hours'], rows: [{ 'Crew Count': 12, 'Total Hours': 4262.5712 }], fetchedAt: '', fromCache: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setup(runQuery: any = vi.fn((request: { dimensions: string[] }) => of(request.dimensions.length ? rows : totals)), previewSource = vi.fn()) {
  const component = new DataViewComponent({ runQuery, previewSource } as never, { markForCheck: vi.fn() } as never);
  component.dataset = dataset as never;
  component.columns = columns as never;
  component.source = source as never;
  component.ngOnChanges();
  return { component, runQuery, previewSource };
}

describe('DataViewComponent', () => {
  it('reads the table as the draft model reads it, calculated columns included, under plain headers', () => {
    const { component, runQuery } = setup();

    expect(runQuery).toHaveBeenCalledWith({
      datasetId: 1, dimensions: ['c.crew_type_id', 'c.code', 'c.Prefix'], measures: [], topN: DATA_VIEW_ROWS, draft: true, refresh: false,
    });
    expect(component.raw).toBe(false);
    expect(component.rowsLabel).toBe('1 row, the whole table');
    expect(component.columnDefs.map(c => (c as { headerName?: string }).headerName)).toEqual(['#', 'crew_type_id', 'code', 'ƒx Prefix']);
    component.ngOnDestroy();
  });

  it('reads only the rows, no measures, and sets the row height from the density', () => {
    const { component, runQuery } = setup();
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(component.rowHeight).toBe(32);
    component.density = 'comfortable';
    expect(component.rowHeight).toBe(42);
    component.density = 'dense';
    expect(component.rowHeight).toBe(25);
    component.ngOnDestroy();
  });

  it('falls back to the rows as stored when the model cannot read the table', () => {
    const stored = { columns: ['crew_type_id'], rows: [{ crew_type_id: 1 }], fetchedAt: '', fromCache: false };
    const { component, previewSource } = setup(
      vi.fn((request: { dimensions: string[] }) => request.dimensions.length ? throwError(() => ({ status: 422, error: {} })) : of(totals)),
      vi.fn().mockReturnValue(of(stored)));

    expect(previewSource).toHaveBeenCalledExactlyOnceWith(1, { kind: 'table', schemaName: 'ref', sourceName: 'CrewType' });
    expect(component.raw).toBe(true);
    expect(component.result).toBe(stored);
    component.ngOnDestroy();
  });

  it('reads again for another table and on Refresh, not after a change elsewhere in the data model', () => {
    const { component, runQuery } = setup();
    const calls = runQuery.mock.calls.length;

    component.dataset = { ...dataset, name: 'Renamed' } as never;
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledTimes(calls);

    component.source = other as never;
    component.ngOnChanges();
    expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ dimensions: ['t.task_daily_id'] }));

    component.run(true);
    expect(runQuery).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    component.ngOnDestroy();
  });
});

import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { GetDataComponent } from './get-data.component';
// Imported for its NgModule metadata only. GetDataComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

const dataset = {
  id: 1, name: 'Crew check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [{ id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null, kind: 'table' }],
  relationships: [], measures: [],
};
const loaded = { ...dataset, sources: [...dataset.sources, { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType' }] };
const tables = [
  { schemaName: 'core', tableName: 'TaskDaily', columnCount: 1, columns: [{ columnName: 'task_daily_id', ordinalPosition: 1 }] },
  { schemaName: 'ref', tableName: 'CrewType', columnCount: 2, columns: [{ columnName: 'crew_type_id', ordinalPosition: 1 }, { columnName: 'plant_code', ordinalPosition: 2 }] },
];
const views = [{ id: 13, name: 'Commissioning', description: '', usable: false, problems: ['Rule 4: no grain.'], columns: [] }];
const uploaded = { id: 3, tableName: 'Crew_hours', fileName: 'crew.xlsx', sheetName: 'Hours', headerRow: 3, lastRow: 7, loadedRows: 3, modifiedAt: '' };
const preview = {
  sheets: ['Cover', 'Hours'], sheet: 'Hours', sheetRows: 10, headerRow: 3, lastRow: 7, dataRows: 3, suggestedTableName: 'Crew_hours_Hours',
  columns: [{ name: 'Crew', type: 'text' }, { name: 'Hours', type: 'decimal' }], rows: [['A1', '8'], ['B2', '7.5'], ['C3', '6']],
};

const connections = [
  { id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000', joinable: true },
  { id: 7, connectionName: 'BI', databaseName: 'AlTasnimBI', joinable: true },
  { id: 8, connectionName: 'Lake', databaseName: 'lake', joinable: false, reason: 'lake is not an active SQL Server connection.' },
];
const biTables = [{ schemaName: 'dbo', tableName: 'Orders', columnCount: 1, columns: [{ columnName: 'order_id', ordinalPosition: 1 }] }];

function setup(calls: Record<string, unknown> = {}) {
  const modelStudio = {
    views: vi.fn().mockReturnValue(of(views)),
    imports: vi.fn().mockReturnValue(of([uploaded])),
    previewSource: vi.fn().mockReturnValue(of({ columns: ['crew_type_id'], rows: [{ crew_type_id: 1 }] })),
    addSource: vi.fn().mockReturnValue(of(loaded)),
    previewImport: vi.fn().mockReturnValue(of(preview)),
    createImport: vi.fn().mockReturnValue(of({ ...uploaded, id: 4, tableName: 'Crew_hours_Hours' })),
    replaceImport: vi.fn().mockReturnValue(of({ ...uploaded, loadedRows: 5 })),
    get: vi.fn().mockReturnValue(of(loaded)),
    sourceConnections: vi.fn().mockReturnValue(of(connections)),
    googleSheet: vi.fn(),
    ...calls,
  };
  const commonApi = { getConnectionSchema: vi.fn().mockReturnValue(of({ tables: biTables })) };
  const component = new GetDataComponent(modelStudio as never, { canCreate: () => true } as never, { markForCheck: vi.fn() } as never,
    commonApi as never);
  component.dataset = dataset as never;
  component.tables = tables as never;
  const emitted: unknown[] = [];
  component.loaded.subscribe(result => emitted.push(result));
  component.ngOnInit();
  return { component, modelStudio, emitted, commonApi };
}

const find = (component: GetDataComponent, label: string) => component.items.find(item => item.label === label)!;

describe('GetDataComponent', () => {
  it('lists the sources, keeps Load closed until the row filter is chosen, and loads a table', () => {
    const { component, modelStudio, emitted } = setup();

    expect(component.itemsIn('tables').map(i => i.label)).toEqual(['core.TaskDaily', 'ref.CrewType']);
    expect(component.itemsIn('views')[0].disabled).toBe(true);
    expect(component.itemsIn('files').map(i => i.label)).toEqual(['Crew_hours']);
    expect(component.loadProblem).toBe('Tick at least one table, view or sheet.');

    const crews = find(component, 'ref.CrewType');
    component.toggle(crews);
    expect(component.loadProblem).toBe('ref.CrewType: choose who sees which rows.');
    component.settingsOf(crews).rlsMode = 'plant';
    component.settingsOf(crews).plantColumn = 'plant_code';
    expect(component.loadProblem).toBe('');

    component.load();

    expect(modelStudio.addSource).toHaveBeenCalledWith(1, {
      schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', kind: 'table', rlsMode: 'plant', rlsPlantColumn: 'plant_code',
    });
    expect(emitted).toEqual([{ dataset: loaded, message: 'ref.CrewType was loaded.' }]);
  });

  it('previews a table and shows the reasons of a view that cannot be loaded', () => {
    const { component, modelStudio } = setup();

    component.focus(find(component, 'ref.CrewType'));
    expect(modelStudio.previewSource).toHaveBeenCalledWith(1, { kind: 'table', schemaName: 'ref', sourceName: 'CrewType' });
    expect(component.previewRows).toEqual([{ crew_type_id: 1 }]);

    component.focus(find(component, 'Commissioning'));
    expect(modelStudio.previewSource).toHaveBeenCalledTimes(1);
    expect(component.focused?.reasons).toEqual(['Rule 4: no grain.']);
  });

  it('says why rows are hidden when the server refuses the preview', () => {
    const refusal = { status: 422, error: { code: 'rows_hidden', message: 'Row previews are shown to administrators only.' } };
    const { component } = setup({ previewSource: vi.fn().mockReturnValue(throwError(() => refusal)) });

    component.focus(find(component, 'ref.CrewType'));

    expect(component.previewMessage).toBe('Row previews are shown to administrators only.');
    expect(component.columnDefs).toEqual([]);
  });

  it('uploads a workbook, previews its first sheet with data, and loads it as a new table', () => {
    const { component, modelStudio, emitted } = setup({ addSource: vi.fn().mockReturnValue(of(loaded)) });
    const file = new File(['x'], 'crew.xlsx');

    component.chooseFile({ target: { files: [file], value: 'crew.xlsx' } } as never);

    expect(modelStudio.previewImport).toHaveBeenCalledWith(1, file, {});
    expect(component.itemsIn('files').map(i => i.label)).toEqual(['Crew_hours', 'Cover', 'Hours']);
    const hours = find(component, 'Hours');
    expect(component.focused?.key).toBe(hours.key);
    expect(component.previewMessage).toBe('3 data rows between row 3 and row 7, of 10 rows in the sheet.');
    expect(component.settingsOf(hours)).toMatchObject({ tableName: 'Crew_hours_Hours', alias: 'Crew_hours_Hours', types: ['text', 'decimal'] });

    component.toggle(hours);
    component.settingsOf(hours).rlsMode = 'none';
    component.load();

    expect(modelStudio.createImport).toHaveBeenCalledWith(1, file,
      { sheet: 'Hours', headerRow: 3, lastRow: 7, types: ['text', 'decimal'], tableName: 'Crew_hours_Hours' });
    expect(modelStudio.addSource).toHaveBeenCalledWith(1, {
      schemaName: 'import', sourceName: 'Crew_hours_Hours', alias: 'Crew_hours_Hours', kind: 'table', rlsMode: 'none', rlsPlantColumn: null,
    });
    expect(emitted).toEqual([{ dataset: loaded, message: 'Hours was loaded.' }]);
  });

  it('reads a Google Sheet by its link, ticks every sheet and loads each as a table', () => {
    const file = new File(['x'], 'Crew plan.xlsx');
    const previewImport = vi.fn().mockImplementation((_id: number, _file: File, options: { sheet?: string }) =>
      of({ ...preview, sheet: options.sheet ?? 'Hours', suggestedTableName: `Crew_plan_${options.sheet ?? 'Hours'}` }));
    const { component, modelStudio, emitted } = setup({ googleSheet: vi.fn().mockReturnValue(of(file)), previewImport });

    component.sheetLink = ' https://docs.google.com/spreadsheets/d/abc/edit ';
    component.chooseGoogleSheet();

    expect(modelStudio.googleSheet).toHaveBeenCalledWith(1, 'https://docs.google.com/spreadsheets/d/abc/edit');
    expect(component.sheetCount).toBe(2);

    component.tickAllSheets();

    expect(previewImport).toHaveBeenCalledWith(1, file, { sheet: 'Cover', headerRow: undefined, lastRow: undefined, types: undefined });
    expect(component.settingsOf(find(component, 'Cover'))).toMatchObject({ tableName: 'Crew_plan_Cover', types: ['text', 'decimal'] });
    expect(component.focused?.label).toBe('Hours');
    for (const label of ['Cover', 'Hours']) component.settingsOf(find(component, label)).rlsMode = 'none';
    expect(component.loadProblem).toBe('');

    component.load();

    expect(modelStudio.createImport).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([{ dataset: loaded, message: '2 sources were loaded.' }]);
  });

  it('shows why a Google Sheet could not be read', () => {
    const refusal = { status: 400, error: { message: 'The Google Sheet could not be read. Share it as "Anyone with the link can view" and try again.' } };
    const { component } = setup({ googleSheet: vi.fn().mockReturnValue(throwError(() => refusal)) });

    component.sheetLink = 'https://docs.google.com/spreadsheets/d/abc';
    component.chooseGoogleSheet();

    expect(component.error).toBe(refusal.error.message);
    expect(component.previewing).toBe(false);
  });

  it('replaces an uploaded table with a new file', () => {
    const { component, modelStudio, emitted } = setup();
    const file = new File(['x'], 'crew.xlsx');

    component.focus(find(component, 'Crew_hours'));
    component.chooseFile({ target: { files: [file], value: 'crew.xlsx' } } as never, uploaded);
    const hours = find(component, 'Hours');
    expect(hours.disabled).toBe(true);

    component.replace(hours);

    expect(modelStudio.replaceImport).toHaveBeenCalledWith(1, 3, file, { sheet: 'Hours', headerRow: 3, lastRow: 7, types: ['text', 'decimal'] });
    expect(emitted).toEqual([{ dataset: loaded, message: 'Crew_hours was replaced with 5 rows.' }]);
  });

  it('groups database tables by schema, folds a group, and ticks every table of a schema that can be loaded', () => {
    const { component } = setup();

    expect(component.sectionsIn('tables').map(section => [section.label, section.items.map(item => component.shortLabel(item))]))
      .toEqual([['core', ['TaskDaily']], ['ref', ['CrewType']]]);
    expect(component.sectionsIn('views').map(section => section.label)).toEqual([null]);

    component.toggleFold('tables');
    expect(component.isOpen('tables')).toBe(false);
    component.search = 'crew';
    expect(component.isOpen('tables')).toBe(true);
    component.search = '';

    const ref = component.sectionsIn('tables')[1];
    component.toggleSection(ref);
    expect(component.checkedIn('tables')).toBe(1);
    expect(component.sectionState(ref)).toBe('all');
    const core = component.sectionsIn('tables')[0];
    component.toggleSection(core);
    expect(component.checkedIn('tables')).toBe(1);
    component.toggleSection(ref);
    expect(component.checkedIn('tables')).toBe(0);
  });
  it('lists the tables of another database, keeps a ticked table of the first one and loads both with their connections', () => {
    const { component, modelStudio, commonApi } = setup();
    const crews = find(component, 'ref.CrewType');
    component.toggle(crews);
    Object.assign(component.settingsOf(crews), { rlsMode: 'none' });

    component.chooseDatabase(7);

    expect(commonApi.getConnectionSchema).toHaveBeenCalledWith(7);
    expect(component.sectionsIn('tables').map(s => [s.label, s.database ?? null, s.items.map(i => i.label)])).toEqual([
      ['dbo', 'AlTasnimBI', ['dbo.Orders']],
      ['ref', null, ['ref.CrewType']],
    ]);
    expect(component.itemsIn('views')).toHaveLength(1);
    const orders = find(component, 'dbo.Orders');
    component.toggle(orders);
    Object.assign(component.settingsOf(orders), { rlsMode: 'none' });
    expect(component.focusedOrigin!.rows[0]).toEqual({ label: 'Database', value: 'AlTasnimBI (BI)' });
    expect(modelStudio.previewSource).toHaveBeenLastCalledWith(1, { kind: 'table', schemaName: 'dbo', sourceName: 'Orders', connectionId: 7 });

    component.load();

    expect(modelStudio.addSource.mock.calls.map(call => call[1].connectionId)).toEqual([7, undefined]);
  });
});

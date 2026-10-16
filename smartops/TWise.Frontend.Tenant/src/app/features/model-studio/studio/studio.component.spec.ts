import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { StudioComponent } from './studio.component';
// Imported for its NgModule metadata only. StudioComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

const taskCount = { kind: 'agg' as const, fn: 'count' as const, arg: { source: 'TaskDaily', column: 'task_daily_id' } };
const dataset = {
  id: 1, name: 'Slice check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [{ id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null }],
  relationships: [], measures: [], calculatedColumns: [], transforms: [],
};
const minutes = {
  kind: 'bin' as const, op: '*' as const,
  left: { kind: 'col' as const, source: 'TaskDaily', column: 'data_hours' }, right: { kind: 'num' as const, value: 60 },
};
const withMeasure = { ...dataset, measures: [{ id: 5, name: 'Task Count', expression: taskCount }] };

function setup(loaded: object, calls: Record<string, unknown>, query: Record<string, string> = {}) {
  // `any`: calls carries whichever service methods a test needs; a spread index signature loses named
  // dot access under noPropertyAccessFromIndexSignature, so the merged mock is typed loosely here.
  const modelStudio: any = {
    get: vi.fn().mockReturnValue(of(loaded)), suggestions: vi.fn().mockReturnValue(of([])), viewTables: vi.fn().mockReturnValue(of([])), ...calls,
  };
  const commonApi = {
    getConnectionSchema: vi.fn().mockReturnValue(of({ tables: [
      { schemaName: 'ref', tableName: 'CrewType', columnCount: 1, columns: [{ columnName: 'crew_type_id', ordinalPosition: 1, isPrimaryKey: true }] },
      { schemaName: 'core', tableName: 'TaskDaily', columnCount: 1, columns: [{ columnName: 'task_daily_id', ordinalPosition: 1, isPrimaryKey: true }] },
    ] })),
  };
  const route = { snapshot: { paramMap: new Map([['id', '1']]), queryParamMap: new Map(Object.entries(query)) } };
  const permissions = { canModify: vi.fn().mockReturnValue(true) };
  const breadcrumbs = { set: vi.fn() };
  const component = new StudioComponent(
    route as never, modelStudio as never, commonApi as never, permissions as never, { markForCheck: vi.fn() } as never,
    breadcrumbs as never);
  component.ngOnInit();
  return { component, modelStudio, commonApi, breadcrumbs };
}

describe('StudioComponent', () => {
  it('loads the data model with its connection schema and swaps in the data model a saved measure returns', () => {
    const { component, modelStudio, commonApi } = setup(dataset, { addMeasure: vi.fn().mockReturnValue(of(withMeasure)) });

    expect(commonApi.getConnectionSchema).toHaveBeenCalledWith(4);
    expect(component.tables.map(t => t.tableName)).toEqual(['TaskDaily', 'CrewType']);

    component.openFormula(null);
    expect(component.formula).toEqual({ measure: null });
    component.saveMeasure({ name: 'Task Count', expression: taskCount });
    expect(modelStudio.addMeasure).toHaveBeenCalledWith(1, 'Task Count', taskCount);
    expect(component.formula).toBeNull();
    expect(component.dataset?.measures.map(m => m.name)).toEqual(['Task Count']);
    expect(component.toast?.kind).toBe('success');
    component.ngOnDestroy();
  });

  it('keeps the formula builder open with the server message when a save is refused', () => {
    const refusal = { status: 400, error: { message: 'Sum needs a number column, but CrewType.code holds text.' } };
    const { component, modelStudio } = setup(withMeasure, { updateMeasure: vi.fn().mockReturnValue(throwError(() => refusal)) });
    const measure = component.dataset!.measures[0];

    component.openFormula(measure);
    component.saveMeasure({ name: 'Task Count', expression: taskCount });

    expect(modelStudio.updateMeasure).toHaveBeenCalledWith(1, 5, 'Task Count', taskCount);
    expect(component.formula).toEqual({ measure });
    expect(component.formulaError).toBe('Sum needs a number column, but CrewType.code holds text.');
    expect(component.busy).toBe(false);
    component.ngOnDestroy();
  });

  it('asks for relationship suggestions again only after a change that can alter them', () => {
    const { component, modelStudio } = setup(dataset, {
      addMeasure: vi.fn().mockReturnValue(of(withMeasure)),
      updateSource: vi.fn().mockReturnValue(of(withMeasure)),
      addRelationship: vi.fn().mockReturnValue(of(withMeasure)),
    });
    expect(modelStudio.suggestions).toHaveBeenCalledTimes(1);

    component.openFormula(null);
    component.saveMeasure({ name: 'Task Count', expression: taskCount });
    component.saveRls({ sourceId: 1, body: { rlsMode: 'none', rlsPlantColumn: null } });
    expect(modelStudio.suggestions).toHaveBeenCalledTimes(1);

    component.connect({ fromSourceId: 1, fromColumn: 'task_daily_id', toSourceId: 1, toColumn: 'task_daily_id' });
    expect(modelStudio.suggestions).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('adds a calculated column through its dialog and closes it', () => {
    const withColumn = { ...dataset, calculatedColumns: [{ id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: minutes }] };
    const { component, modelStudio } = setup(dataset, { addCalculatedColumn: vi.fn().mockReturnValue(of(withColumn)) });
    const source = component.dataset!.sources[0];

    component.openColumn(source, null);
    expect(component.columnDialog).toEqual({ source, column: null });
    component.saveColumn({ name: 'Minutes', expression: minutes });

    expect(modelStudio.addCalculatedColumn).toHaveBeenCalledWith(1, 1, 'Minutes', minutes);
    expect(component.columnDialog).toBeNull();
    expect(component.dataset?.calculatedColumns.map(c => c.name)).toEqual(['Minutes']);
    expect(component.toast?.text).toBe('TaskDaily.Minutes was added.');
    expect(modelStudio.suggestions).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('keeps the column dialog open with the server message when a save is refused', () => {
    const refusal = { status: 400, error: { message: 'TaskDaily already has a column called "task_code". Choose another name.' } };
    const { component } = setup(dataset, { addCalculatedColumn: vi.fn().mockReturnValue(throwError(() => refusal)) });
    const source = component.dataset!.sources[0];

    component.openColumn(source, null);
    component.saveColumn({ name: 'task_code', expression: minutes });

    expect(component.columnDialog).toEqual({ source, column: null });
    expect(component.formulaError).toBe('TaskDaily already has a column called "task_code". Choose another name.');
    expect(component.busy).toBe(false);
    component.ngOnDestroy();
  });

  it('adds a transform at once and asks before removing one', () => {
    const transform = { id: 30, sourceId: 1, column: 'task_code', kind: 'trim' as const, value: null, sortOrder: 1 };
    const { component, modelStudio } = setup(dataset, {
      addTransform: vi.fn().mockReturnValue(of({ ...dataset, transforms: [transform] })),
      removeTransform: vi.fn().mockReturnValue(of(dataset)),
    });

    component.addTransform({ sourceId: 1, column: 'task_code', kind: 'trim', value: null });
    expect(modelStudio.addTransform).toHaveBeenCalledWith(1, { sourceId: 1, column: 'task_code', kind: 'trim', value: null });
    expect(component.dataset?.transforms).toEqual([transform]);

    component.removeTransform(transform);
    expect(modelStudio.removeTransform).not.toHaveBeenCalled();
    expect(component.confirm?.message).toBe('Remove the transform of TaskDaily.task_code? Its values are read as stored again.');
    component.runConfirmed();
    expect(modelStudio.removeTransform).toHaveBeenCalledWith(1, 30);
    expect(modelStudio.suggestions).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });

  it('reads the schema again after Get data loads a source, then swaps in the data model and says what was loaded', () => {
    const { component, commonApi } = setup(dataset, {});
    const withUpload = {
      ...dataset,
      sources: [...dataset.sources,
        { id: 2, schemaName: 'import', sourceName: 'Crew_hours', alias: 'Crew_hours', rlsMode: 'none', rlsPlantColumn: null, kind: 'table' }],
    };
    component.getDataOpen = true;

    component.onDataLoaded({ dataset: withUpload as never, message: 'Crew hours was loaded.' });

    expect(component.getDataOpen).toBe(false);
    expect(commonApi.getConnectionSchema).toHaveBeenCalledTimes(2);
    expect(component.dataset?.sources.map(s => s.alias)).toEqual(['TaskDaily', 'Crew_hours']);
    expect(component.toast).toEqual({ kind: 'success', text: 'Crew hours was loaded.' });
    component.ngOnDestroy();
  });

  it('opens on the Model view, and the Data view and New column follow the table picked in the Data pane', () => {
    const twoTables = {
      ...dataset,
      sources: [...dataset.sources, { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', rlsMode: 'none', rlsPlantColumn: null }],
    };
    const { component } = setup(twoTables, {});
    expect(component.view).toBe('model');
    expect(component.activeSource?.alias).toBe('TaskDaily');

    component.view = 'data';
    component.selectSource(2);
    expect(component.selection).toEqual({ kind: 'source', id: 2 });
    expect(component.activeSource?.alias).toBe('CrewType');

    component.newColumn();
    expect(component.columnDialog).toEqual({ source: twoTables.sources[1], column: null });

    component.select({ kind: 'relationship', id: 9 });
    expect(component.activeSource?.alias).toBe('TaskDaily');
    component.ngOnDestroy();
  });

  it('offers Back to canvas only when opened from a canvas', () => {
    expect(setup(dataset, {}, { canvas: '31' }).component.canvasRoute).toBe('/canvas/31');
    expect(setup(dataset, {}).component.canvasRoute).toBeNull();
    expect(setup(dataset, {}, { canvas: '31abc' }).component.canvasRoute).toBeNull();
    expect(setup(dataset, {}, { canvas: '0' }).component.canvasRoute).toBeNull();
  });

  it('gives the navbar its breadcrumb trail, ending with the data model name', () => {
    const { component, breadcrumbs } = setup(dataset, {});

    expect(breadcrumbs.set).toHaveBeenLastCalledWith([
      { label: 'Home' }, { label: 'Model Studio', route: '/model-studio' }, { label: 'Slice check' },
    ]);
    component.ngOnDestroy();
  });

  it('opens the Transform dialog on the active table, or on the selected column, from the ribbon', () => {
    const { component } = setup(dataset, {});

    component.openTransforms();
    expect(component.transformDialog).toEqual({ sourceId: 1, column: null });

    component.select({ kind: 'column', sourceId: 1, column: 'data_hours' });
    component.openTransforms();
    expect(component.transformDialog).toEqual({ sourceId: 1, column: 'data_hours' });

    const empty = setup({ ...dataset, sources: [] }, {}).component;
    empty.openTransforms();
    expect(empty.transformDialog).toBeNull();
    component.ngOnDestroy();
    empty.ngOnDestroy();
  });

  it('folds a side pane to a strip and remembers it', () => {
    localStorage.clear();
    const { component } = setup(dataset, {});
    expect(component.folded).toEqual({ inspector: false, pane: false });

    component.fold('pane', true);
    expect(setup(dataset, {}).component.folded).toEqual({ inspector: false, pane: true });
    component.fold('pane', false);
    component.ngOnDestroy();
  });

  it('widens and narrows a side pane from its handle within the limits, and remembers the width', () => {
    localStorage.clear();
    const { component } = setup(dataset, {});
    expect(component.widths).toEqual({ inspector: 300, pane: 260 });

    component.nudgePane('pane', new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(component.widths.pane).toBe(276);
    for (let i = 0; i < 10; i++) component.nudgePane('inspector', new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(component.widths.inspector).toBe(240);
    component.nudgePane('inspector', new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(component.widths.inspector).toBe(240);

    expect(setup(dataset, {}).component.widths).toEqual({ inspector: 240, pane: 276 });
    component.ngOnDestroy();
    localStorage.clear();
  });
});

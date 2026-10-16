import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { DatasetDetail } from '../../../core/services/model-studio.service';
import { DataDrag } from '../canvas-wells.util';
import { CanvasDataPaneComponent } from './canvas-data-pane.component';
// Imported for its NgModule metadata only. CanvasDataPaneComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { CanvasModule } from '../canvas.module';

const dataset = {
  id: 7, name: 'Canvas check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [
    { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null },
    { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'Crew', rlsMode: 'none', rlsPlantColumn: null },
  ],
  relationships: [],
  measures: [{ id: 5, name: 'Task Count', expression: null }],
  calculatedColumns: [{ id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: null }],
  transforms: [],
} as DatasetDetail;
const columns = new Map([
  ['core.taskdaily', [{ columnName: 'task_daily_id', ordinalPosition: 1 }] as DbSchemaColumn[]],
  ['ref.crewtype', [{ columnName: 'code', ordinalPosition: 1 }] as DbSchemaColumn[]],
]);

function pane(): CanvasDataPaneComponent {
  const component = new CanvasDataPaneComponent({ nativeElement: document.createElement('div') } as never);
  component.datasetId = 7;
  component.dataset = dataset;
  component.columns = columns;
  component.ngOnChanges();
  return component;
}

const listed = (component: CanvasDataPaneComponent) => component.tables.map(table => [
  table.source.alias, table.fields.map(field => `${component.fieldKey(table, field)}${field.calculated ? ' (calculated)' : ''}`),
]);

describe('CanvasDataPaneComponent', () => {
  it('lists each table with its columns, then its calculated columns, and narrows them to a search', () => {
    const component = pane();
    expect(listed(component)).toEqual([['TaskDaily', ['TaskDaily.task_daily_id', 'TaskDaily.Minutes (calculated)']], ['Crew', ['Crew.code']]]);
    expect(component.measures.map(measure => measure.name)).toEqual(['Task Count']);

    component.search = 'min';
    component.filter();
    expect(listed(component)).toEqual([['TaskDaily', ['TaskDaily.Minutes (calculated)']]]);
    expect(component.measures).toEqual([]);
  });

  it('starts a drag with the entry and marks a measure over two tables', () => {
    const component = pane();
    const drags: DataDrag[] = [];
    component.dragStarted.subscribe(drag => drags.push(drag));
    const setData = vi.fn();

    component.startDrag({ dataTransfer: { setData, effectAllowed: 'none' } } as unknown as DragEvent, { kind: 'field', name: 'Crew.code' });
    expect(setData).toHaveBeenCalledWith('text/plain', 'Crew.code');
    expect(drags).toEqual([{ kind: 'field', name: 'Crew.code' }]);

    const count = (source: string) => ({ kind: 'agg', fn: 'count', arg: { source, column: 'id' } });
    expect(component.isMultiTable({ id: 1, name: 'One', expression: count('Crew') } as never)).toBe(false);
    expect(component.isMultiTable({ id: 2, name: 'Ratio', expression: { kind: 'bin', op: '/', left: count('Crew'), right: count('Task') } } as never)).toBe(true);
  });

  it('keeps showing the canvas data model until the editor has applied a new choice', () => {
    const component = pane();
    const chosen: (number | null)[] = [];
    component.datasetChange.subscribe(id => chosen.push(id));

    const select = { value: '8' } as HTMLSelectElement;
    component.chooseDataset(select);
    expect(chosen).toEqual([8]);
    expect(select.value).toBe('7');

    component.chooseDataset({ value: '' } as HTMLSelectElement);
    expect(chosen).toEqual([8, null]);
  });

  it('renames and hides entries for this canvas only and sends menu choices up', () => {
    const component = pane();
    const renames: unknown[] = [];
    const hides: unknown[] = [];
    const filters: unknown[] = [];
    component.renameField.subscribe(e => renames.push(e));
    component.hideField.subscribe(e => hides.push(e));
    component.addFilter.subscribe(e => filters.push(e));
    const click = { preventDefault: vi.fn(), clientX: 10, clientY: 20, currentTarget: document.createElement('li') } as unknown as MouseEvent;

    component.openMenu(click, { kind: 'field', name: 'Crew.code' }, 'code');
    component.menuFilter('page');
    expect(filters).toEqual([{ scope: 'page', drag: { kind: 'field', name: 'Crew.code' } }]);
    expect(component.menu).toBeNull();

    component.openMenu(click, { kind: 'field', name: 'Crew.code' }, 'code');
    component.menuRename();
    component.renameValue = ' Crew code ';
    component.finishRename();
    expect(renames).toEqual([{ key: 'Crew.code', name: 'Crew code' }]);

    component.openMenu(click, { kind: 'measure', name: 'Task Count' }, 'Task Count');
    component.menuHide();
    expect(hides).toEqual([{ key: 'Task Count', hidden: true }]);

    component.fieldNames = { 'Crew.code': 'Crew code' };
    component.hiddenFields = ['Task Count', 'TaskDaily.Minutes'];
    component.ngOnChanges();
    expect(component.label('Crew.code', 'code')).toBe('Crew code');
    expect(component.measures).toEqual([]);
    expect(listed(component)).toEqual([['TaskDaily', ['TaskDaily.task_daily_id']], ['Crew', ['Crew.code']]]);
    component.toggleShowHidden();
    expect(component.measures.map(m => m.name)).toEqual(['Task Count']);
  });
});

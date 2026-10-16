import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { DatasetDetail, DatasetSource } from '../../../core/services/model-studio.service';
import { TransformsEditorComponent } from './transforms-editor.component';
// Imported for its NgModule metadata only. TransformsEditorComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

const tasks: DatasetSource = { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null };
const crews: DatasetSource = { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', rlsMode: 'plant', rlsPlantColumn: 'code' };
const dataset = {
  id: 1, name: 'Column check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [tasks, crews], relationships: [], measures: [], calculatedColumns: [],
  transforms: [
    { id: 31, sourceId: 1, column: 'task_assignee', kind: 'null_fill', value: 'Unassigned', sortOrder: 2 },
    { id: 30, sourceId: 1, column: 'task_code', kind: 'trim', value: null, sortOrder: 1 },
    { id: 32, sourceId: 2, column: 'description', kind: 'trim', value: null, sortOrder: 1 },
  ],
} as DatasetDetail;
const columns = new Map([
  ['core.taskdaily', [{ columnName: 'task_code' }, { columnName: 'task_assignee' }] as DbSchemaColumn[]],
  ['ref.crewtype', [{ columnName: 'code' }, { columnName: 'description' }] as DbSchemaColumn[]],
]);

function open(source: DatasetSource): TransformsEditorComponent {
  const component = new TransformsEditorComponent();
  component.dataset = dataset;
  component.columns = columns;
  component.source = source;
  return component;
}

describe('TransformsEditorComponent', () => {
  it('lists the table\'s transforms in the order they apply', () => {
    const component = open(tasks);

    expect(component.transforms.map(t => `${t.column}: ${component.describe(t)}`))
      .toEqual(['task_code: Remove spaces at either end', 'task_assignee: Fill blank cells with "Unassigned"']);
  });

  it('offers the table\'s columns except the one that decides who sees which rows', () => {
    expect(open(crews).tableColumns.map(c => c.columnName)).toEqual(['description']);
  });

  it('adds a fill with its value and a trim without one, and nothing while read-only', () => {
    const component = open(tasks);
    const added = vi.fn();
    component.add.subscribe(added);

    component.column = 'task_assignee';
    component.kind = 'null_fill';
    component.value = 'Unassigned';
    component.submit();
    component.kind = 'trim';
    component.submit();
    component.readonly = true;
    component.submit();

    expect(added.mock.calls).toEqual([
      [{ sourceId: 1, column: 'task_assignee', kind: 'null_fill', value: 'Unassigned' }],
      [{ sourceId: 1, column: 'task_assignee', kind: 'trim', value: null }],
    ]);
  });

  it('adds a replace, a type change and a removal with their settings', () => {
    const component = open(tasks);
    const added = vi.fn();
    component.add.subscribe(added);
    component.column = 'task_code';

    component.kind = 'replace';
    component.value = '-';
    component.replacement = '';
    component.submit();
    component.kind = 'type';
    component.toType = 'date';
    component.style = 'dmy';
    component.submit();
    component.kind = 'remove_rows';
    component.op = 'blank';
    component.submit();

    expect(added.mock.calls).toEqual([
      [{ sourceId: 1, column: 'task_code', kind: 'replace', value: '-', options: { with: '', match: 'part' } }],
      [{ sourceId: 1, column: 'task_code', kind: 'type', value: 'date', options: { style: 'dmy' } }],
      [{ sourceId: 1, column: 'task_code', kind: 'remove_rows', value: null, options: { op: 'blank' } }],
    ]);
  });

  it('asks for a value only where the transform fills or compares', () => {
    const component = open(tasks);
    component.kind = 'remove_rows';
    component.op = 'blank';
    expect(component.needsValue).toBe(false);
    component.op = 'eq';
    expect(component.needsValue).toBe(true);
    component.kind = 'type';
    expect(component.needsValue).toBe(false);
  });

  it('does not add a replace without the text to find', () => {
    const component = open(tasks);
    const added = vi.fn();
    component.add.subscribe(added);
    component.column = 'task_code';
    component.kind = 'replace';
    component.value = '';

    component.submit();

    expect(component.canSubmit).toBe(false);
    expect(added).not.toHaveBeenCalled();
  });
});

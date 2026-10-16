import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { of } from 'rxjs';
import { DatasetCalculatedColumn, DatasetDetail, MeasureNode } from '../../../core/services/model-studio.service';
import { CalculatedColumnDialogComponent } from './calculated-column-dialog.component';
// Imported for its NgModule metadata only. CalculatedColumnDialogComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

const source = { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none' as const, rlsPlantColumn: null };
const minutes: MeasureNode = {
  kind: 'bin', op: '*', left: { kind: 'col', source: 'TaskDaily', column: 'data_hours' }, right: { kind: 'num', value: 60 },
};
const stored: DatasetCalculatedColumn = { id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: minutes };
const dataset = {
  id: 1, name: 'Column check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [source], relationships: [], measures: [],
  calculatedColumns: [stored, { id: 21, sourceId: 1, name: 'Family', dataType: 'text', expression: null }], transforms: [],
} as DatasetDetail;
const columns = new Map([['core.taskdaily', [
  { columnName: 'task_code', dataType: 'varchar' },
  { columnName: 'data_hours', dataType: 'decimal' },
] as DbSchemaColumn[]]]);

const models = { checkCalculatedColumn: vi.fn(() => of({ kind: 'text' as const })) };

function open(column: DatasetCalculatedColumn | null = null): CalculatedColumnDialogComponent {
  const component = new CalculatedColumnDialogComponent(models as never, { markForCheck: () => undefined } as never);
  component.dataset = dataset;
  component.columns = columns;
  component.source = source;
  component.column = column;
  component.ngOnInit();
  return component;
}

describe('CalculatedColumnDialogComponent', () => {
  it('saves the name and the tree read from the formula', () => {
    const component = open();
    const saved = vi.fn();
    component.save.subscribe(saved);
    expect(component.title).toBe('New calculated column in TaskDaily');

    component.name = ' Task year ';
    component.text = 'year(TaskDaily.action_on)';
    expect(component.sentence).toBe('the year of TaskDaily.action_on');
    component.submit();

    expect(saved).toHaveBeenCalledWith({
      name: 'Task year', expression: { kind: 'fn', fn: 'year', args: [{ kind: 'col', source: 'TaskDaily', column: 'action_on' }] },
    });
  });

  it('opens a stored column with its canonical formula', () => {
    const component = open(stored);

    expect(component.title).toBe('Edit TaskDaily.Minutes');
    expect(component.name).toBe('Minutes');
    expect(component.text).toBe('TaskDaily.data_hours * 60');
  });

  it('stays open with the error and its position when the formula cannot be read', () => {
    const component = open();
    const saved = vi.fn();
    component.save.subscribe(saved);
    component.name = 'Total';
    component.text = 'SUM(TaskDaily.data_hours)';

    component.submit();

    expect(saved).not.toHaveBeenCalled();
    expect(component.textError).toEqual({
      message: 'SUM adds up many rows, and a calculated column works on one row at a time. Use it in a measure instead.', start: 0, end: 3,
    });
  });

  it('asks for a name, and closes on Escape', () => {
    const component = open();
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    component.text = 'TaskDaily.data_hours * 60';

    component.submit();
    expect(component.problem).toBe('Give the column a name.');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toHaveBeenCalled();
  });

  it('lists the fields the formula can use, leaving out the column being edited', () => {
    expect(open(stored).suggestFields.map(field => field.insert)).toEqual(['TaskDaily.task_code', 'TaskDaily.data_hours', 'TaskDaily.Family']);
  });

  it('inserts a function example and checks the formula as it is typed', () => {
    const component = open();
    component.text = 'TaskDaily.data_hours * ';

    component.insertExample('ROUND(TaskDaily.data_hours, 1)');

    expect(component.text).toBe('TaskDaily.data_hours * ROUND(TaskDaily.data_hours, 1)');
    expect(component.shownError).toBeNull();
    component.text = 'IF(TaskDaily.data_hours > 8, 1';
    expect(component.shownError).toEqual({ message: 'Expected a comma or a closing bracket ) here.', start: 30, end: 30 });
  });

  it('shows nothing for an empty formula until Save', () => {
    const component = open();
    expect(component.shownError).toBeNull();

    component.name = 'Hours band';
    component.submit();

    expect(component.shownError?.message).toBe('Write a formula, for example TaskDaily.data_hours * 60.');
  });

  it('saves what a builder writes, shown as it is filled in, and moves it to the formula box on request', () => {
    const component = open();
    const saved: unknown[] = [];
    component.save.subscribe(value => saved.push(value));
    expect(component.numberFields.map(c => c.columnName)).toEqual(['data_hours', 'Minutes']);

    component.setMode('bins');
    component.name = 'Hours band';
    component.submit();
    expect(component.problem).toBe('Choose the column to put into bins.');
    component.bins = { column: 'data_hours', mode: 'ranges', width: '', bounds: '4, 8', labels: 'Short, Normal, Long' };
    expect(component.formulaText).toBe("IF(TaskDaily.data_hours < 4, 'Short', IF(TaskDaily.data_hours < 8, 'Normal', 'Long'))");
    component.submit();
    expect(saved).toHaveLength(1);

    component.setMode('conditional');
    expect(component.rules).toEqual([{ column: '', op: 'eq', value: '', result: '' }]);
    component.rules = [{ column: 'data_hours', op: 'gt', value: '8', result: 'Long' }];
    component.otherwise = 'Normal';
    component.editAsFormula();
    expect(component.mode).toBe('formula');
    expect(component.text).toBe("IF(TaskDaily.data_hours > 8, 'Long', 'Normal')");
  });

  it('writes the function examples with the table and its own columns', () => {
    expect(open().exampleColumns).toEqual({ table: 'TaskDaily', number: 'data_hours', text: 'task_code', date: undefined, key: 'data_hours' });
  });
});

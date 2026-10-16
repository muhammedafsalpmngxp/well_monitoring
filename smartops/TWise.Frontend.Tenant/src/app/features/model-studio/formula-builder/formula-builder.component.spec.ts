import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { DatasetDetail, DatasetMeasure, MeasureNode } from '../../../core/services/model-studio.service';
import { FormulaBuilderComponent } from './formula-builder.component';
import { QUICK_MEASURES } from './formula-builder.util';
// Imported for its NgModule metadata only. FormulaBuilderComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

const dataset = {
  id: 1, name: 'Formula check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [{ id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null }],
  relationships: [], measures: [], calculatedColumns: [], transforms: [],
} as DatasetDetail;

const columns = new Map([['core.taskdaily', [
  { columnName: 'task_daily_id', dataType: 'int' },
  { columnName: 'task_code', dataType: 'varchar' },
  { columnName: 'data_hours', dataType: 'decimal' },
] as DbSchemaColumn[]]]);

const worked: MeasureNode = {
  kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' },
  where: { column: { source: 'TaskDaily', column: 'data_hours' }, op: 'gt', value: '0' },
};

const models = { checkMeasure: vi.fn(() => of({ kind: 'number' as const })) };

function open(measure: DatasetMeasure | null = null): FormulaBuilderComponent {
  const component = new FormulaBuilderComponent(models as never, { markForCheck: () => undefined } as never);
  component.dataset = dataset;
  component.columns = columns;
  component.measure = measure;
  component.ngOnInit();
  return component;
}

describe('FormulaBuilderComponent', () => {
  it('builds a new measure visually and saves the tree its sentence describes', () => {
    const component = open();
    const saved = vi.fn();
    component.save.subscribe(saved);

    component.name = ' Hours per Task ';
    component.setFn(component.visual.left, 'sum');
    expect(component.columnsFor(component.visual.left).map(c => c.columnName)).toEqual(['task_daily_id', 'data_hours']);
    component.visual.left.column = 'data_hours';
    component.visual.op = '/';
    component.rightPart!.column = 'task_daily_id';
    expect(component.sentence).toBe('Sum of TaskDaily.data_hours divided by Count of TaskDaily.task_daily_id');

    component.submit();
    expect(saved).toHaveBeenCalledWith({
      name: 'Hours per Task',
      expression: {
        kind: 'bin', op: '/',
        left: { kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'data_hours' } },
        right: { kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' } },
      },
    });
  });

  it('switches to text and back without changing the measure', () => {
    const component = open({ id: 5, name: 'Worked Tasks', expression: worked });
    const saved = vi.fn();
    component.save.subscribe(saved);
    expect(component.mode).toBe('visual');

    component.showText();
    expect(component.mode).toBe('text');
    expect(component.text).toBe('COUNT(TaskDaily.task_daily_id WHERE TaskDaily.data_hours > 0)');
    component.showVisual();
    expect(component.mode).toBe('visual');

    component.submit();
    expect(saved).toHaveBeenCalledWith({ name: 'Worked Tasks', expression: worked });
  });

  it('stays in text mode with the error and its position when the text cannot be read', () => {
    const component = open();
    const saved = vi.fn();
    component.save.subscribe(saved);
    component.name = 'Broken';

    component.showText();
    component.text = 'SUM(TaskDaily.data_hours';
    component.showVisual();
    expect(component.mode).toBe('text');
    expect(component.textError).toEqual({ message: 'A closing bracket ) is missing here.', start: 24, end: 24 });

    component.submit();
    expect(saved).not.toHaveBeenCalled();
  });

  it('opens a formula the visual mode cannot show in text mode, and keeps it there', () => {
    const scaled: MeasureNode = {
      kind: 'bin', op: '+', left: { kind: 'bin', op: '*', left: worked, right: { kind: 'num', value: 2 } }, right: { kind: 'num', value: 1 },
    };
    const component = open({ id: 6, name: 'Scaled', expression: scaled });

    expect(component.mode).toBe('text');
    expect(component.text).toBe('COUNT(TaskDaily.task_daily_id WHERE TaskDaily.data_hours > 0) * 2 + 1');
    component.showVisual();
    expect(component.mode).toBe('text');
    expect(component.textError?.message).toContain('Keep editing this formula as text.');
  });

  it('stays in visual mode while the formula is incomplete, and names what is missing', () => {
    const component = open();
    component.visual.left.column = 'task_daily_id';
    component.visual.op = '+';

    component.showText();

    expect(component.mode).toBe('visual');
    expect(component.problem).toBe('Choose a table and a column to calculate.');
  });

  it('asks for a name, and closes on Escape', () => {
    const component = open();
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    component.visual.left.column = 'task_daily_id';

    component.submit();
    expect(component.problem).toBe('Give the measure a name.');

    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toHaveBeenCalled();
  });

  it('returns focus to the opener only after the change-detection cycle that closes the dialog finishes', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const component = open();
    component.ngOnDestroy();

    // A reloaded dataset re-renders the inspector in the same cycle that destroys this dialog, and can
    // move focus away before that cycle finishes; the fix must win that race, not lose it.
    const distraction = document.createElement('input');
    document.body.appendChild(distraction);
    distraction.focus();
    expect(document.activeElement).toBe(distraction);

    await Promise.resolve();
    expect(document.activeElement).toBe(opener);

    opener.remove();
    distraction.remove();
  });

  it('clears a stale server error as soon as the name or formula changes', () => {
    const component = open();
    component.serverError = 'Sum needs a number column, but CrewType.code holds text.';

    component.clearServerError();

    expect(component.serverError).toBe('');
  });

  it('offers the table\'s calculated columns, and only the number ones to Sum', () => {
    const component = open();
    component.dataset = {
      ...dataset,
      calculatedColumns: [
        { id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: null },
        { id: 21, sourceId: 1, name: 'Family', dataType: 'text', expression: null },
      ],
    };

    expect(component.columnsOf('TaskDaily').map(c => c.columnName)).toEqual(['task_daily_id', 'task_code', 'data_hours', 'Minutes', 'Family']);
    component.setFn(component.visual.left, 'sum');
    expect(component.columnsFor(component.visual.left).map(c => c.columnName)).toEqual(['task_daily_id', 'data_hours', 'Minutes']);
  });

  it('starts a new measure from a quick measure, shows the notice, and saves once the columns are chosen', () => {
    const ratio = QUICK_MEASURES.find(quick => quick.id === 'ratio')!;
    const component = new FormulaBuilderComponent(models as never, { markForCheck: () => undefined } as never);
    component.dataset = dataset;
    component.columns = columns;
    component.start = { name: ratio.name, visual: ratio.visual('TaskDaily') };
    component.notice = 'This saves to the data model "Formula check". Every canvas built on it sees the change.';
    component.ngOnInit();
    const saved = vi.fn();
    component.save.subscribe(saved);

    expect(component.title).toBe('New measure');
    expect(component.name).toBe('Ratio');
    expect(component.visual).toMatchObject({ left: { fn: 'sum', source: 'TaskDaily' }, op: '/' });
    component.submit();
    expect(saved).not.toHaveBeenCalled();
    expect(component.problem).toBe('Choose a table and a column to calculate.');

    component.visual.left.column = 'data_hours';
    component.rightPart!.column = 'task_daily_id';
    component.submit();
    expect(saved).toHaveBeenCalledWith({
      name: 'Ratio',
      expression: {
        kind: 'bin', op: '/',
        left: { kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'data_hours' } },
        right: { kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'task_daily_id' } },
      },
    });
  });

  it('inserts a function example in the text mode and checks the text as it is typed', () => {
    const component = open();
    component.showText();
    component.text = 'SUM(TaskDaily.data_hours) / ';

    component.insertExample('COUNTROWS(TaskDaily)');

    expect(component.text).toBe('SUM(TaskDaily.data_hours) / COUNTROWS(TaskDaily)');
    expect(component.shownError).toBeNull();
    component.text = 'RUNNING_TOTAL SUM(TaskDaily.data_hours)';
    expect(component.shownError?.message)
      .toBe('RUNNING_TOTAL needs an opening bracket after it, as in RUNNING_TOTAL(SUM(table.column)).');
  });

  it('checks nothing while the visual mode is open or the text is empty', () => {
    const component = open();
    expect(component.mode).toBe('visual');
    expect(component.shownError).toBeNull();

    component.showText();

    expect(component.shownError).toBeNull();
  });

  it('asks the server about each complete formula once, while it is typed, and shows its refusal', () => {
    vi.useFakeTimers();
    models.checkMeasure.mockClear();
    models.checkMeasure.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 400, error: { message: 'UPPER in Probe needs text, but TaskDaily.data_hours holds numbers.' },
    })));
    const component = open();
    component.mode = 'text';
    component.text = 'SUM(TaskDaily.data_hours)';
    component.ngDoCheck();
    component.ngDoCheck();
    vi.advanceTimersByTime(400);
    expect(models.checkMeasure).toHaveBeenCalledTimes(1);
    expect(component.check.problem).toBe('UPPER in Probe needs text, but TaskDaily.data_hours holds numbers.');

    component.text = 'COUNT(TaskDaily.task_daily_id)';
    component.ngDoCheck();
    expect(component.check.problem).toBe('');
    vi.advanceTimersByTime(400);
    expect(models.checkMeasure).toHaveBeenCalledTimes(2);
    expect(component.check.kind).toBe('number');
    component.ngOnDestroy();
    vi.useRealTimers();
  });
});

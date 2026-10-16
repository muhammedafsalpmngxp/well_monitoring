import { describe, expect, it } from 'vitest';
import { ColDef, ICellRendererParams, ValueFormatterFunc, ValueFormatterParams } from 'ag-grid-community';
import { DbSchemaColumn } from '../../core/services/common-api.service';
import { DatasetDetail, MeasureFn, MeasureNode, RowFn } from '../../core/services/model-studio.service';
import {
  aggregateMeasure, apiErrorMessage, columnFitsAggregate, dataPaneMeasures, dataPaneTables, describeMeasure, describeTransform,
  fieldColumns, fieldKind, keepFocusInside, markBlankDimensions, orientLink, originGroups, queryErrorHint, readQueryError, sourceOrigin, suggestAlias,
  tableKey,
} from './model-studio.util';

describe('suggestAlias', () => {
  it('uses the table name when it is free', () => {
    expect(suggestAlias('TaskDaily', [])).toBe('TaskDaily');
  });

  it('adds a number when the name is taken, in any case', () => {
    expect(suggestAlias('TaskDaily', ['taskdaily', 'TaskDaily2'])).toBe('TaskDaily3');
  });

  it('replaces characters an alias cannot hold and never starts with a digit', () => {
    expect(suggestAlias('Task Daily-2024', [])).toBe('Task_Daily_2024');
    expect(suggestAlias('2024Data', [])).toBe('_2024Data');
  });

  it('stays within 64 characters with room for a number', () => {
    expect(suggestAlias('x'.repeat(80), ['x'.repeat(60)])).toBe(`${'x'.repeat(60)}2`);
  });
});

describe('aggregateMeasure', () => {
  it('puts kind first so the server can read the tree', () => {
    expect(JSON.stringify(aggregateMeasure('count', 'TaskDaily', 'task_daily_id')))
      .toBe('{"kind":"agg","fn":"count","arg":{"source":"TaskDaily","column":"task_daily_id"}}');
  });
});

describe('describeMeasure', () => {
  it('reads a measure as a sentence', () => {
    expect(describeMeasure(aggregateMeasure('count_distinct', 'CrewType', 'code'))).toBe('Distinct count of CrewType.code');
    expect(describeMeasure({ kind: 'bin', op: '/', left: aggregateMeasure('sum', 'TaskDaily', 'data_hours'), right: { kind: 'num', value: 8 } }))
      .toBe('Sum of TaskDaily.data_hours divided by 8');
  });

  it('reads a condition, quoting text but not numbers', () => {
    expect(describeMeasure({
      kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' },
      where: { column: { source: 'TaskDaily', column: 'task_code' }, op: 'neq', value: 'X1' },
    })).toBe('Count of TaskDaily.task_daily_id where TaskDaily.task_code is not "X1"');
    expect(describeMeasure({
      kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'data_hours' },
      where: { column: { source: 'TaskDaily', column: 'crew_type_id' }, op: 'gte', value: '3' },
    })).toBe('Sum of TaskDaily.data_hours where TaskDaily.crew_type_id is at least 3');
  });

  it('brackets a combination inside another', () => {
    const hours = aggregateMeasure('sum', 't', 'x');
    expect(describeMeasure({
      kind: 'bin', op: '*', left: { kind: 'bin', op: '+', left: hours, right: { kind: 'num', value: 1 } }, right: { kind: 'num', value: 2 },
    })).toBe('(Sum of t.x plus 1) times 2');
  });

  it('says when a stored measure cannot be read', () => {
    expect(describeMeasure(null)).toContain('cannot be read');
  });
});

describe('query errors', () => {
  it('pairs the server message with the fix for its code', () => {
    const error = { status: 422, error: { code: 'missing_relationship', message: 'TaskDaily and CrewType are not related. Add a relationship?' } };

    expect(readQueryError(error)).toEqual({
      message: 'TaskDaily and CrewType are not related. Add a relationship?',
      hint: queryErrorHint('missing_relationship'),
    });
    expect(queryErrorHint('missing_relationship')).toContain('Drag a column');
  });

  it('falls back when the response has no message or an unknown code', () => {
    expect(readQueryError({ status: 0, error: {} })).toEqual({ message: 'The query could not be run.', hint: queryErrorHint(undefined) });
    expect(queryErrorHint('cost_exceeded')).toBe(queryErrorHint(undefined));
  });

  it('points a forbidden query at the modules that grant access', () => {
    const error = { status: 403, error: { code: 'forbidden', message: 'You do not have permission to see data model results.' } };

    expect(readQueryError(error)).toEqual({
      message: 'You do not have permission to see data model results.',
      hint: queryErrorHint('forbidden'),
    });
    expect(queryErrorHint('forbidden')).toBe('Ask an administrator for access to BI Canvas or Model Studio.');
  });

  it('sends a changed view source to its own table in the diagram', () => {
    expect(queryErrorHint('view_source_needs_update')).toBe('Select the table in the diagram and choose Update from view, then try again.');
  });

  it('reads the message of an enveloped failure', () => {
    expect(apiErrorMessage({ error: { message: 'A data model called "X" already exists.' } }, 'fallback'))
      .toBe('A data model called "X" already exists.');
    expect(apiErrorMessage(new Error('network'), 'fallback')).toBe('fallback');
  });
});

describe('orientLink', () => {
  const foreignKey = { sourceId: 1, column: 'crew_type_id', isPrimaryKey: false };
  const primaryKey = { sourceId: 2, column: 'crew_type_id', isPrimaryKey: true };
  const expected = { fromSourceId: 1, fromColumn: 'crew_type_id', toSourceId: 2, toColumn: 'crew_type_id' };

  it('treats the dragged column as the many side', () => {
    expect(orientLink(foreignKey, primaryKey)).toEqual(expected);
  });

  it('swaps when a key is dragged onto a column that is not a key', () => {
    expect(orientLink(primaryKey, foreignKey)).toEqual(expected);
  });
});

describe('tableKey', () => {
  it('ignores case', () => {
    expect(tableKey('CORE', 'TaskDaily')).toBe(tableKey('core', 'taskdaily'));
  });
});

describe('columnFitsAggregate', () => {
  it('lets sum and average use only number columns', () => {
    for (const type of ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric(18,2)', 'float', 'real', 'money', 'smallmoney', 'DECIMAL']) {
      expect(columnFitsAggregate('sum', type)).toBe(true);
      expect(columnFitsAggregate('avg', type)).toBe(true);
    }
    for (const type of ['varchar', 'nvarchar(50)', 'date', 'datetime2', 'bit', 'uniqueidentifier']) {
      expect(columnFitsAggregate('sum', type)).toBe(false);
      expect(columnFitsAggregate('avg', type)).toBe(false);
    }
  });

  it('lets count, distinct count, minimum and maximum use any column', () => {
    for (const fn of ['count', 'count_distinct', 'min', 'max'] as const) {
      expect(columnFitsAggregate(fn, 'varchar')).toBe(true);
      expect(columnFitsAggregate(fn, 'date')).toBe(true);
    }
  });

  it('does not hide a column whose type is not known', () => {
    expect(columnFitsAggregate('sum', '')).toBe(true);
  });
});

describe('markBlankDimensions', () => {
  const format = (col: ColDef, value: unknown) => (col.valueFormatter as ValueFormatterFunc)({ value } as ValueFormatterParams);
  const render = (col: ColDef, value: unknown) => col.cellRenderer({ value } as ICellRendererParams);
  const [dimension, measure, flag] = markBlankDimensions([
    { field: 'w.WellName' },
    { field: 'Total Oil', valueFormatter: (p: ValueFormatterParams) => (p.value == null ? '' : `${p.value} bbl`) },
    { field: 'w.Active', cellRenderer: (p: ICellRendererParams) => (p.value ? 'true' : 'false') },
  ], new Set(['w.WellName', 'w.Active'])) as ColDef[];

  it('shows a missing grouping value as (blank), muted', () => {
    expect(format(dimension, null)).toBe('(blank)');
    expect(format(dimension, undefined)).toBe('(blank)');
    expect(render(flag, null)).toBe('(blank)');
    expect((dimension.cellClassRules!['preview__blank'] as (p: unknown) => boolean)({ value: null })).toBe(true);
  });

  it('keeps a present grouping value and its own formatting', () => {
    expect(format(dimension, 'Well 7')).toBe('Well 7');
    expect(format(dimension, '')).toBe('');
    expect(render(flag, true)).toBe('true');
  });

  it('leaves a measure column as it was', () => {
    expect(format(measure, null)).toBe('');
    expect(format(measure, 5)).toBe('5 bbl');
    expect(measure.cellClassRules).toBeUndefined();
  });
});

describe('describeMeasure for calculated columns', () => {
  it('reads row formulas as sentences', () => {
    const col = (column: string) => ({ kind: 'col' as const, source: 'TaskDaily', column });
    expect(describeMeasure({ kind: 'bin', op: '*', left: col('data_hours'), right: { kind: 'num', value: 60 } }))
      .toBe('TaskDaily.data_hours times 60');
    expect(describeMeasure({ kind: 'fn', fn: 'left', args: [col('task_code'), { kind: 'num', value: 4 }] }))
      .toBe('the first 4 characters of TaskDaily.task_code');
    expect(describeMeasure({ kind: 'fn', fn: 'concat', args: [col('task_code'), { kind: 'text', value: ' / ' }, col('task_assignee')] }))
      .toBe('TaskDaily.task_code then " / " then TaskDaily.task_assignee');
    expect(describeMeasure({ kind: 'fn', fn: 'year', args: [col('action_on')] })).toBe('the year of TaskDaily.action_on');
  });
});

describe('fieldColumns', () => {
  it('lists a table\'s own columns, then its calculated columns typed for the number checks', () => {
    const source = { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none' as const, rlsPlantColumn: null };
    const dataset = {
      sources: [source],
      calculatedColumns: [
        { id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: null },
        { id: 21, sourceId: 2, name: 'Elsewhere', dataType: 'text', expression: null },
        { id: 22, sourceId: 1, name: 'Family', dataType: 'text', expression: null },
      ],
    } as never;
    const columns = new Map([['core.taskdaily', [{ columnName: 'task_code', dataType: 'varchar', ordinalPosition: 1 }] as never]]);

    const fields = fieldColumns(dataset, columns, source);

    expect(fields.map(c => [c.columnName, c.dataType])).toEqual([['task_code', 'varchar'], ['Minutes', 'decimal'], ['Family', 'nvarchar']]);
    expect(columnFitsAggregate('sum', fields[1].dataType)).toBe(true);
    expect(columnFitsAggregate('sum', fields[2].dataType)).toBe(false);
  });
});

describe('describeTransform', () => {
  it('says what each transform does', () => {
    const base = { id: 30, sourceId: 1, column: 'task_assignee', sortOrder: 1 };
    expect(describeTransform({ ...base, kind: 'trim', value: null })).toBe('Remove spaces at either end');
    expect(describeTransform({ ...base, kind: 'null_fill', value: 'Unassigned' })).toBe('Fill blank cells with "Unassigned"');
  });

  it('points a refused calculated column or transform at the table that holds it', () => {
    expect(queryErrorHint('invalid_column'))
      .toBe('Correct or remove the calculated column in the Data pane, or select the table in the diagram and remove its transform.');
    expect(queryErrorHint('invalid_measure')).toBe('Select Edit next to the measure in the Data pane, correct it and save it again.');
  });

  it('says what the replace, type and removal transforms do', () => {
    const base = { id: 30, sourceId: 1, column: 'task_code', sortOrder: 1 };
    expect(describeTransform({ ...base, kind: 'replace', value: '-', options: { with: '', match: 'part' } })).toBe('Replace "-" with ""');
    expect(describeTransform({ ...base, kind: 'replace', value: 'N/A', options: { with: 'None', match: 'whole' } }))
      .toBe('Replace the value "N/A" with "None"');
    expect(describeTransform({ ...base, kind: 'type', value: 'date', options: { style: 'dmy' } }))
      .toBe('Change the type to date, written day first (31/01/2026)');
    expect(describeTransform({ ...base, kind: 'type', value: 'number' })).toBe('Change the type to number');
    expect(describeTransform({ ...base, kind: 'remove_rows', value: 'Test', options: { op: 'contains' } })).toBe('Remove rows where it contains "Test"');
    expect(describeTransform({ ...base, kind: 'remove_rows', value: null, options: { op: 'blank' } })).toBe('Remove rows where it is blank');
  });

  it('says where a measure function belongs when a column uses one', () => {
    expect(queryErrorHint('cross_row_column'))
      .toBe('Use PERCENT_OF_TOTAL, RUNNING_TOTAL, CHANGE or CHANGE_PCT in a measure. A calculated column works on one row at a time.');
  });
});

describe('keepFocusInside', () => {
  it('wraps Tab and Shift+Tab around the dialog', () => {
    const dialog = document.createElement('div');
    dialog.innerHTML = '<button id="a">A</button><input id="b" /><button id="c" disabled>C</button>';
    document.body.appendChild(dialog);
    const first = dialog.querySelector<HTMLElement>('#a')!;
    const last = dialog.querySelector<HTMLElement>('#b')!;

    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    keepFocusInside(tab, dialog);
    expect(document.activeElement).toBe(first);
    expect(tab.defaultPrevented).toBe(true);

    keepFocusInside(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }), dialog);
    expect(document.activeElement).toBe(last);
    dialog.remove();
  });
});

const paneDataset = {
  id: 1, name: 'Pane check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [
    { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null },
    { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', rlsMode: 'none', rlsPlantColumn: null },
  ],
  relationships: [],
  measures: [{ id: 5, name: 'Task Count', expression: null }, { id: 6, name: 'Crew Hours', expression: null }],
  calculatedColumns: [{ id: 20, sourceId: 1, name: 'Crew minutes', dataType: 'number', expression: null }],
  transforms: [],
} as DatasetDetail;
const paneColumns = new Map([
  ['core.taskdaily', [{ id: 11, columnName: 'task_daily_id', ordinalPosition: 1 }, { id: 12, columnName: 'crew_type_id', ordinalPosition: 2 }]],
  ['ref.crewtype', [{ id: 21, columnName: 'crew_type_id', ordinalPosition: 1 }, { id: 22, columnName: 'code', ordinalPosition: 2 }]],
]) as unknown as Map<string, DbSchemaColumn[]>;

describe('dataPaneTables', () => {
  it('lists every table with its columns, then its calculated columns marked as such', () => {
    const tables = dataPaneTables(paneDataset, paneColumns, '');

    expect(tables.map(t => t.source.alias)).toEqual(['TaskDaily', 'CrewType']);
    expect(tables[0].fields.map(f => f.name)).toEqual(['task_daily_id', 'crew_type_id', 'Crew minutes']);
    expect(tables[0].fields.map(f => f.calculated?.id ?? null)).toEqual([null, null, 20]);
  });

  it('keeps a table whose name matches with all its fields, and otherwise only the matching fields', () => {
    expect(dataPaneTables(paneDataset, paneColumns, ' crewtype ').map(t => [t.source.alias, t.fields.length])).toEqual([['CrewType', 2]]);
    expect(dataPaneTables(paneDataset, paneColumns, 'CREW').map(t => [t.source.alias, t.fields.map(f => f.name)])).toEqual([
      ['TaskDaily', ['crew_type_id', 'Crew minutes']],
      ['CrewType', ['crew_type_id', 'code']],
    ]);
    expect(dataPaneTables(paneDataset, paneColumns, 'nothing')).toEqual([]);
  });
});

describe('dataPaneMeasures', () => {
  it('keeps the measures whose names contain the term, ignoring case', () => {
    expect(dataPaneMeasures(paneDataset, '').map(m => m.name)).toEqual(['Task Count', 'Crew Hours']);
    expect(dataPaneMeasures(paneDataset, 'HOURS').map(m => m.name)).toEqual(['Crew Hours']);
  });
});

describe('fieldKind', () => {
  it('marks number and date or time types, treats every other type as text, and marks each Data pane field', () => {
    expect(['int', 'DECIMAL(18, 2)', 'money', 'datetime2(7)', 'date', 'time', 'nvarchar(50)', 'bit', '', undefined].map(t => fieldKind(t)))
      .toEqual(['number', 'number', 'number', 'date', 'date', 'date', 'text', 'text', 'text', 'text']);
    // paneColumns carry no type; the calculated column is a number.
    expect(dataPaneTables(paneDataset, paneColumns, '')[0].fields.map(f => f.kind)).toEqual(['text', 'text', 'number']);
  });
});

describe('describeMeasure for comparisons and row counts', () => {
  it('reads a comparison and a row count as sentences', () => {
    expect(describeMeasure({
      kind: 'cmp', op: 'gt', left: { kind: 'col', source: 'TaskDaily', column: 'data_hours' }, right: { kind: 'num', value: 8 },
    })).toBe('TaskDaily.data_hours is more than 8');
    expect(describeMeasure({ kind: 'agg', fn: 'count_rows', arg: { source: 'TaskDaily', column: '*' } })).toBe('the number of TaskDaily rows');
  });
});

describe('describeMeasure for the function library', () => {
  const col = (column: string): MeasureNode => ({ kind: 'col', source: 'TaskDaily', column });
  const num = (value: number): MeasureNode => ({ kind: 'num', value });
  const txt = (value: string): MeasureNode => ({ kind: 'text', value });
  const call = (fn: RowFn | MeasureFn, ...args: MeasureNode[]): MeasureNode => ({ kind: 'fn', fn, args });

  it('reads logic, text, date, number and measure functions as sentences', () => {
    expect(describeMeasure(call('if', { kind: 'cmp', op: 'gt', left: col('data_hours'), right: num(8) }, txt('Long'), txt('Short'))))
      .toBe('"Long" when TaskDaily.data_hours is more than 8, otherwise "Short"');
    expect(describeMeasure(call('not', call('isblank', col('task_assignee'))))).toBe('it is not true that TaskDaily.task_assignee is blank');
    expect(describeMeasure(call('split', col('task_code'), txt('-'), num(-1)))).toBe('the last piece of TaskDaily.task_code split at "-"');
    expect(describeMeasure(call('datediff', call('today'), col('action_on')))).toBe('the number of days from TaskDaily.action_on to today');
    expect(describeMeasure(call('round', col('data_hours'), num(1)))).toBe('TaskDaily.data_hours rounded to 1 decimal places');
    expect(describeMeasure(call('running_total', { kind: 'agg', fn: 'count_rows', arg: { source: 'TaskDaily', column: '*' } })))
      .toBe('the running total of the number of TaskDaily rows');
  });
});

describe('source origins', () => {
  const own = { connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000' };
  const dataset = {
    connectionId: 4,
    sources: [
      { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'Tasks', kind: 'table', ...own },
      { id: 2, schemaName: 'dbo', sourceName: 'Orders', alias: 'Orders', kind: 'table', connectionId: 7, connectionName: 'BI', databaseName: 'AlTasnimBI' },
      { id: 3, schemaName: 'view', sourceName: '12', alias: 'Crews', kind: 'view', label: 'Crew types', ...own },
    ],
  } as unknown as DatasetDetail;

  it('names the database, schema and table of a table, and the name and id of a view', () => {
    expect(sourceOrigin(dataset.sources[1])).toEqual({
      connection: 'BI', database: 'AlTasnimBI', other: true, path: 'AlTasnimBI.dbo.Orders',
      rows: [{ label: 'Database', value: 'AlTasnimBI (BI)' }, { label: 'Schema', value: 'dbo' }, { label: 'Table', value: 'Orders' }],
    });
    expect(sourceOrigin(dataset.sources[2]).rows.map(row => row.value)).toEqual(['smartops_tenant_TNT-1000 (Tenant database)', 'Crew types', '12']);
    expect(sourceOrigin({ ...dataset.sources[0], connectionName: null, databaseName: null }).path).toBe('Unknown database.core.TaskDaily');
  });

  it('groups the tables by database, the model database first', () => {
    expect(originGroups(dataset).map(group => [group.database, group.other, group.tables.map(t => t.source.alias)])).toEqual([
      ['smartops_tenant_TNT-1000', false, ['Tasks', 'Crews']],
      ['AlTasnimBI', true, ['Orders']],
    ]);
  });
});

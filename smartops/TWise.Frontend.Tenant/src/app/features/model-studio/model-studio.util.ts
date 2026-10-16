import { ColDef, ColGroupDef, ICellRendererParams, ValueFormatterFunc, ValueFormatterParams } from 'ag-grid-community';
import { DbSchemaColumn } from '../../core/services/common-api.service';
import {
  AggregateFn, BinaryOp, ConditionOp, DatasetCalculatedColumn, DatasetDetail, DatasetMeasure, DatasetSource, DatasetTransform, MeasureFn,
  MeasureNode, RowFn, TransformKind,
} from '../../core/services/model-studio.service';

/** Permission module code for every Model Studio page and action. */
export const MODEL_STUDIO_MODULE = 'model.studio';

/** What the inspector shows. */
export type Selection =
  | { kind: 'source'; id: number }
  | { kind: 'relationship'; id: number }
  | { kind: 'column'; sourceId: number; column: string }
  | { kind: 'measure'; id: number }
  | null;

/** The table a selection belongs to: the table itself, or the table of a selected column. */
export function selectedSourceId(selection: Selection): number | null {
  return selection?.kind === 'source' ? selection.id : selection?.kind === 'column' ? selection.sourceId : null;
}

/** A relationship to create. For many_to_one, from is the many side. */
export interface Link { fromSourceId: number; fromColumn: string; toSourceId: number; toColumn: string; }

export interface ColumnEnd { sourceId: number; column: string; isPrimaryKey: boolean; }

export const AGGREGATE_LABELS: Record<AggregateFn, string> = {
  count: 'Count',
  count_distinct: 'Distinct count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  count_rows: 'Count of rows',
};

export const OPERATOR_LABELS: Record<BinaryOp, string> = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' };

export const COMPARISON_LABELS: Record<ConditionOp, string> = {
  eq: 'is', neq: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
};

export const TRANSFORM_LABELS: Record<TransformKind, string> = {
  trim: 'Remove spaces at either end',
  null_fill: 'Fill blank cells',
  replace: 'Replace values',
  type: 'Change the type',
  remove_rows: 'Remove rows',
};

// The type a calculated column is offered with, so the number checks for table columns apply to it too.
const CALCULATED_TYPES: Record<DatasetCalculatedColumn['dataType'], string> = { number: 'decimal', text: 'nvarchar', date: 'date' };

/** The tests a removal of rows can make, as the transforms editor and the transform sentences show them. */
export const REMOVE_ROW_TESTS: Record<string, string> = {
  eq: 'is', neq: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  contains: 'contains', starts_with: 'starts with', ends_with: 'ends with', blank: 'is blank', not_blank: 'is not blank',
};

/** How dates are written in a text column that changes to dates. */
export const DATE_STYLES: Record<string, string> = {
  iso: 'year first (2026-01-31)', dmy: 'day first (31/01/2026)', mdy: 'month first (01/31/2026)',
};

/** The fix to show for each refusal code of POST /api/query. */
const QUERY_HINTS: Record<string, string> = {
  empty_request: 'Pick at least one field or measure.',
  unknown_dataset: 'This data model no longer exists. Go back to the data model list.',
  unknown_field: 'A field or measure no longer matches its table. Untick it, or ask an administrator to sync the connection schema.',
  invalid_measure: 'Select Edit next to the measure in the Data pane, correct it and save it again.',
  invalid_column: 'Correct or remove the calculated column in the Data pane, or select the table in the diagram and remove its transform.',
  cross_row_column: 'Use PERCENT_OF_TOTAL, RUNNING_TOTAL, CHANGE or CHANGE_PCT in a measure. A calculated column works on one row at a time.',
  formula_too_large: 'The formula, together with the columns it builds on, is too large. Simplify it or split it into more than one column.',
  count_rows_joined: 'COUNTROWS only works on the table the query reads its rows from. Pick fields from that table, or use a different measure.',
  invalid_totals: 'Totals cannot combine with a sort or with window measures such as percent of total, running total and change. Remove one of them.',
  invalid_filter: 'Complete or remove the filter.',
  missing_relationship: 'Drag a column from one table onto the matching column of the other table, or accept a dashed suggestion.',
  ambiguous_path: 'These tables are connected in more than one way. Remove one of the relationships between them.',
  fan_trap: 'This measure would count some rows more than once. Pick fields from the measure\'s own table, or use a measure based on the other table.',
  rls_unconfigured: 'Select each table in the diagram and choose who sees which rows.',
  rows_hidden: 'Show the table on a canvas instead. It shows the rows you are allowed to see.',
  source_not_contract_compliant: 'Open the view in View Builder and fix what the message says, or remove it from the data model.',
  view_source_needs_update: 'Select the table in the diagram and choose Update from view, then try again.',
  timeout: 'Remove some fields or add a filter, then try again.',
  busy: 'Wait a moment, then try again.',
  forbidden: 'Ask an administrator for access to BI Canvas or Model Studio.',
};
const DEFAULT_HINT = 'Try again. If it keeps failing, ask an administrator to check the data model.';

export function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`.toLowerCase();
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** An alias unique in the dataset, built from a table name: letters, digits and underscores, at most 64 characters. */
export function suggestAlias(tableName: string, taken: string[]): string {
  const base = (tableName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') || 'table').slice(0, 60);
  const used = new Set(taken.map(alias => alias.toLowerCase()));
  let alias = base;
  for (let n = 2; used.has(alias.toLowerCase()); n++) alias = `${base}${n}`;
  return alias;
}

/** Where a table of a data model is read from, for people. */
export interface SourceOrigin {
  connection: string;
  database: string;
  /** Read from another database than the model's own. */
  other: boolean;
  /** database.schema.table, or the view's name. */
  path: string;
  /** For a facts list: Database, Schema and Table, or Database, View and View id. */
  rows: { label: string; value: string }[];
}

/** The origin of a table or of a View Builder view on a connection; a connection that is gone reads as an unknown database. */
export function describeOrigin(
  connectionName: string | null | undefined, databaseName: string | null | undefined, other: boolean,
  place: { schema: string; table: string } | { view: string; id: string },
): SourceOrigin {
  const database = databaseName || 'Unknown database';
  const connection = connectionName ?? '';
  const databaseRow = { label: 'Database', value: connection && connection !== database ? `${database} (${connection})` : database };
  return 'view' in place
    ? { connection, database, other, path: place.view, rows: [databaseRow, { label: 'View', value: place.view }, { label: 'View id', value: place.id }] }
    : {
      connection, database, other, path: `${database}.${place.schema}.${place.table}`,
      rows: [databaseRow, { label: 'Schema', value: place.schema }, { label: 'Table', value: place.table }],
    };
}

export function sourceOrigin(source: DatasetSource): SourceOrigin {
  return describeOrigin(source.connectionName, source.databaseName, source.connectionId != null, source.kind === 'view' || source.kind === 'script'
    ? { view: source.label ?? source.sourceName, id: source.sourceName }
    : { schema: source.schemaName, table: source.sourceName });
}

export interface OriginGroup { database: string; connection: string; other: boolean; tables: { source: DatasetSource; origin: SourceOrigin }[]; }

/** The model's tables grouped by the database they are read from, the model's own first. */
export function originGroups(dataset: DatasetDetail): OriginGroup[] {
  const groups = new Map<string, OriginGroup>();
  for (const source of dataset.sources) {
    const origin = sourceOrigin(source);
    const key = String(source.connectionId ?? 'own');
    const group = groups.get(key) ?? { database: origin.database, connection: origin.connection, other: origin.other, tables: [] };
    group.tables.push({ source, origin });
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.other) - Number(b.other) || a.database.localeCompare(b.database));
}

const NUMBER_TYPES = new Set(['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney']);

/**
 * Sum and average need a number column; the other calculations take any column. A column with no
 * known type is offered, as the server does not check it either.
 */
export function columnFitsAggregate(fn: AggregateFn, dataType: string): boolean {
  if (fn !== 'sum' && fn !== 'avg') return true;
  const base = dataType.split('(')[0].trim().toLowerCase();
  return !base || NUMBER_TYPES.has(base);
}

/**
 * The columns a query can use from one table of a dataset: the table's own columns as given, then its
 * calculated columns, shaped as catalogue columns with the type the server gave them.
 */
export function fieldColumns(dataset: DatasetDetail, columns: ReadonlyMap<string, DbSchemaColumn[]>, source: DatasetSource): DbSchemaColumn[] {
  const own = columns.get(tableKey(source.schemaName, source.sourceName)) ?? [];
  const calculated = dataset.calculatedColumns.filter(c => c.sourceId === source.id).map((c, i): DbSchemaColumn => ({
    id: -c.id, columnName: c.name, dataType: CALCULATED_TYPES[c.dataType] ?? '', isNullable: true, isPrimaryKey: false,
    isForeignKey: false, foreignKeyTable: null, foreignKeyColumn: null, maxLength: null, ordinalPosition: own.length + i + 1,
  }));
  return [...own, ...calculated];
}

/** How the Data pane marks a field's type. */
export type FieldKind = 'number' | 'date' | 'text';

const DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset', 'time']);

/** A number, a date or time, or text for every other SQL type (bit, uniqueidentifier and so on). */
export function fieldKind(dataType: string | null | undefined): FieldKind {
  const base = (dataType ?? '').split('(')[0].trim().toLowerCase();
  if (NUMBER_TYPES.has(base)) return 'number';
  return DATE_TYPES.has(base) ? 'date' : 'text';
}

/** A field of the Data pane. calculated is the stored calculated column, or null for a column of the table. */
export interface DataPaneField { name: string; kind: FieldKind; calculated: DatasetCalculatedColumn | null; hidden: boolean; }

/** Measures that share a display folder; folder is null for measures in no folder. */
export interface MeasureGroup { folder: string | null; measures: DatasetMeasure[]; }

/** A table of the Data pane with the fields it shows and the measures listed under it (item: home table). */
export interface DataPaneTable { source: DatasetSource; fields: DataPaneField[]; measures: MeasureGroup[]; }

/** Measures in folder order, the ones in no folder first, each list sorted by name. */
export function groupMeasures(measures: DatasetMeasure[]): MeasureGroup[] {
  const groups = new Map<string | null, DatasetMeasure[]>();
  for (const measure of [...measures].sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = measure.folder?.trim() || null;
    groups.set(folder, [...(groups.get(folder) ?? []), measure]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, measures: list }));
}

/** The folders the dataset's measures use, for the Move to folder menu. */
export function measureFolders(dataset: DatasetDetail): string[] {
  return [...new Set(dataset.measures.map(m => m.folder?.trim()).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b));
}

/**
 * The tables of the Data pane in dataset order, each with its own columns and then its calculated
 * columns. A search term keeps a table whose name contains it with all its fields, and otherwise only
 * the fields whose names contain it; a table with neither is left out. Case is ignored.
 */
export function dataPaneTables(
  dataset: DatasetDetail, columns: ReadonlyMap<string, DbSchemaColumn[]>, term: string, withoutHidden = false,
): DataPaneTable[] {
  const find = term.trim().toLowerCase();
  return dataset.sources.flatMap(source => {
    const hidden = new Set((source.hiddenColumns ?? []).map(name => name.toLowerCase()));
    const fields = fieldColumns(dataset, columns, source).map((column): DataPaneField => ({
      name: column.columnName,
      kind: fieldKind(column.dataType),
      // fieldColumns gives a calculated column the negative of its id.
      calculated: column.id < 0 ? dataset.calculatedColumns.find(c => c.id === -column.id) ?? null : null,
      hidden: hidden.has(column.columnName.toLowerCase()),
    })).filter(field => !withoutHidden || !field.hidden);
    const home = dataset.measures.filter(measure => measure.homeSourceId === source.id);
    if (source.alias.toLowerCase().includes(find)) return [{ source, fields, measures: groupMeasures(home) }];
    const matching = fields.filter(field => field.name.toLowerCase().includes(find));
    const measures = home.filter(measure => measure.name.toLowerCase().includes(find));
    return matching.length || measures.length ? [{ source, fields: matching, measures: groupMeasures(measures) }] : [];
  });
}

/**
 * The measures listed with the dataset rather than under a table, whose names contain the search term,
 * ignoring case. A measure whose table left the dataset is listed here too.
 */
export function dataPaneMeasures(dataset: DatasetDetail, term: string): DatasetMeasure[] {
  const find = term.trim().toLowerCase();
  const tables = new Set(dataset.sources.map(source => source.id));
  return dataset.measures.filter(measure => (measure.homeSourceId == null || !tables.has(measure.homeSourceId))
    && measure.name.toLowerCase().includes(find));
}

/** A transform as a short sentence. */
export function describeTransform(transform: DatasetTransform): string {
  const value = transform.value ?? '';
  const options = transform.options ?? {};
  switch (transform.kind) {
    case 'null_fill': return `Fill blank cells with "${value}"`;
    case 'replace': return options['match'] === 'whole'
      ? `Replace the value "${value}" with "${options['with'] ?? ''}"`
      : `Replace "${value}" with "${options['with'] ?? ''}"`;
    case 'type': return value === 'date'
      ? `Change the type to date, written ${DATE_STYLES[options['style'] ?? 'iso'] ?? DATE_STYLES['iso']}`
      : `Change the type to ${value}`;
    case 'remove_rows': {
      const op = options['op'] ?? '';
      const test = REMOVE_ROW_TESTS[op] ?? op;
      return op === 'blank' || op === 'not_blank' ? `Remove rows where it ${test}` : `Remove rows where it ${test} "${value}"`;
    }
    default: return TRANSFORM_LABELS[transform.kind] ?? transform.kind;
  }
}

/** The tree for "fn of source.column". kind comes first: the server reads the node type from the first property. */
export function aggregateMeasure(fn: AggregateFn, source: string, column: string): MeasureNode {
  return { kind: 'agg', fn, arg: { source, column } };
}

/** The table aliases a formula reads, each once, in the order they first appear. */
export function measureTables(node: MeasureNode | null): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const source = (value as { source?: unknown }).source;
    if (typeof source === 'string') found.add(source);
    Object.values(value).forEach(walk);
  };
  walk(node);
  return [...found];
}

export function describeMeasure(node: MeasureNode | null): string {
  if (!node) return 'This measure cannot be read. Open it to build it again, or delete it.';
  switch (node.kind) {
    case 'agg': {
      const where = node.where
        ? ` where ${node.where.column.source}.${node.where.column.column} ${COMPARISON_LABELS[node.where.op] ?? node.where.op} ${describeValue(node.where.value)}`
        : '';
      if (node.fn === 'count_rows') return `the number of ${node.arg.source} rows${where}`;
      return `${AGGREGATE_LABELS[node.fn] ?? node.fn} of ${node.arg.source}.${node.arg.column}${where}`;
    }
    case 'col': return `${node.source}.${node.column}`;
    case 'num': return String(node.value);
    case 'bin': return `${describeOperand(node.left)} ${OPERATOR_LABELS[node.op] ?? node.op} ${describeOperand(node.right)}`;
    case 'cmp': return `${describeOperand(node.left)} ${COMPARISON_LABELS[node.op] ?? node.op} ${describeOperand(node.right)}`;
    case 'text': return `"${node.value}"`;
    case 'fn': return describeFunction(node.fn, node.args);
    case 'ref': return `the measure ${node.measure}`;
  }
}

function describeOperand(node: MeasureNode): string {
  return node.kind === 'bin' || node.kind === 'cmp' ? `(${describeMeasure(node)})` : describeMeasure(node);
}

function describeFunction(fn: RowFn | MeasureFn, args: MeasureNode[]): string {
  const parts = args.map(describeOperand);
  const plain = args.map(describeMeasure);
  const [first, second, third] = parts;
  const last = args[2];
  switch (fn) {
    case 'concat': return parts.join(' then ');
    case 'left': return `the first ${second} characters of ${first}`;
    case 'right': return `the last ${second} characters of ${first}`;
    case 'upper': return `${first} in capitals`;
    case 'lower': return `${first} in small letters`;
    case 'trim': return `${first} without spaces at either end`;
    case 'year': return `the year of ${first}`;
    case 'month': return `the month of ${first}`;
    case 'if': return `${second} when ${plain[0]}, otherwise ${third}`;
    case 'and': return plain.join(' and ');
    case 'or': return plain.join(' or ');
    case 'not': return `it is not true that ${plain[0]}`;
    case 'isblank': return `${first} is blank`;
    case 'coalesce': return `the first of ${parts.join(', ')} that is not blank`;
    case 'isnull': return `${first}, or ${second} when it is blank`;
    case 'iferror': return `${first}, or ${second} when it cannot be worked out`;
    case 'contains': return `${first} contains ${second}`;
    case 'starts_with': return `${first} starts with ${second}`;
    case 'ends_with': return `${first} ends with ${second}`;
    case 'len': return `the number of characters in ${first}`;
    case 'replace': return `${first} with ${second} replaced by ${third}`;
    case 'substring': return third ? `${third} characters of ${first} from character ${second}` : `${first} from character ${second}`;
    case 'split': return `${last?.kind === 'num' && last.value === -1 ? 'the last piece' : `piece ${third}`} of ${first} split at ${second}`;
    case 'first_word': return `the first word of ${first}`;
    case 'last_word': return `the last word of ${first}`;
    case 'to_number': return `${first} as a number`;
    case 'to_date': return `${first} as a date`;
    case 'day': return `the day of the month of ${first}`;
    case 'quarter': return `the quarter of ${first}`;
    case 'weekday': return `the day of the week of ${first}, 1 for Monday`;
    case 'month_name': return `the month name of ${first}`;
    case 'weekday_name': return `the day name of ${first}`;
    case 'month_start': return `the first day of the month of ${first}`;
    case 'datediff': return `the number of ${last?.kind === 'text' ? last.value : 'days'} from ${second} to ${first}`;
    case 'today': return 'today';
    case 'round': return `${first} rounded to ${second ?? '0'} decimal places`;
    case 'abs': return `${first} without its sign`;
    case 'floor': return `${first} rounded down`;
    case 'ceiling': return `${first} rounded up`;
    case 'min_of': return `the smallest of ${parts.join(', ')}`;
    case 'max_of': return `the largest of ${parts.join(', ')}`;
    case 'percent_of_total': return `${plain[0]} as a percentage of the total`;
    case 'running_total': return `the running total of ${plain[0]}`;
    case 'change': return `the change in ${plain[0]} from the row before`;
    case 'change_pct': return `the percentage change in ${plain[0]} from the row before`;
    case 'rank': return `the rank of ${plain[0]}, highest first`;
    case 'ytd': return `${plain[0]} year to date`;
    case 'moving_avg': return `the ${parts[1]}-row moving average of ${plain[0]}`;
    case 'threshold': return `a score of ${plain[0]}: 100 at ${parts[2]}, 50 at ${parts[1]}`;
    // A function this page does not know, from a newer server: shown as written.
    default: return `${String(fn).toUpperCase()}(${parts.join(', ')})`;
  }
}

function describeValue(value: string): string {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(value) ? value : `"${value}"`;
}

/** The message the server sent with a failure, or the fallback when there is none. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export function queryErrorHint(code: string | undefined): string {
  return (code && QUERY_HINTS[code]) || DEFAULT_HINT;
}

/** A query failure as the server's plain-language message plus the fix for its code. */
export function readQueryError(error: unknown): { message: string; hint: string } {
  const code = (error as { error?: { code?: unknown } } | null)?.error?.code;
  return {
    message: apiErrorMessage(error, 'The query could not be run.'),
    hint: queryErrorHint(typeof code === 'string' ? code : undefined),
  };
}

/** The dragged column is the many side, unless it is a key dropped on a column that is not. */
export function orientLink(dragged: ColumnEnd, target: ColumnEnd): Link {
  const [many, one] = dragged.isPrimaryKey && !target.isPrimaryKey ? [target, dragged] : [dragged, target];
  return { fromSourceId: many.sourceId, fromColumn: many.column, toSourceId: one.sourceId, toColumn: one.column };
}

/**
 * A grouping value is missing when the row has no match in a joined table; show it as (blank), muted,
 * so it reads as a group rather than a gap. Measure columns keep their own formatting.
 */
export function markBlankDimensions(columns: (ColDef | ColGroupDef)[], dimensions: ReadonlySet<string>): (ColDef | ColGroupDef)[] {
  const blank = (value: unknown) => value == null;
  return columns.map(column => {
    if ('children' in column || !column.field || !dimensions.has(column.field)) return column;
    const format = column.valueFormatter as ValueFormatterFunc | undefined;
    const render = column.cellRenderer as ((p: ICellRendererParams) => unknown) | undefined;
    return {
      ...column,
      valueFormatter: (p: ValueFormatterParams) => (blank(p.value) ? '(blank)' : format ? format(p) : p.value),
      ...(typeof render === 'function' ? { cellRenderer: (p: ICellRendererParams) => (blank(p.value) ? '(blank)' : render(p)) } : {}),
      cellClassRules: { ...column.cellClassRules, preview__blank: (p: { value: unknown }) => blank(p.value) },
    };
  });
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Tab and Shift+Tab wrap around inside a dialog instead of leaving it (DESIGN.md 8.8). */
export function keepFocusInside(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

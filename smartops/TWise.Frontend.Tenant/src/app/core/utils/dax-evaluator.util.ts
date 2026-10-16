function safeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export interface DaxMeasureConfig {
  id: string;
  name: string;
  expression: string;
  format?: 'number' | 'currency' | 'percent';
  decimalPlaces?: number;
  includeInSeries?: boolean;
  evaluationScope?: DaxEvaluationScope;
  /** Percentage operation only: columns summed to build the numerator/denominator of the ratio. */
  /** Operation and columns picked in the builder for this measure, restored when it is reopened. */
  operation?: string;
  columns?: string[];
  numeratorColumns?: string[];
  denominatorColumns?: string[];
  /** Set when the measure was added from a saved DAX model (core.DaxModels id); counted as "Used In". */
  savedModelId?: number;
}

export type DaxEvaluationScope = 'column' | 'row';

export interface DaxCalculatedColumnConfig {
  id: string;
  name: string;
  expression: string;
  dataType?: 'number' | 'string' | 'boolean' | 'date';
}

export type DaxDisplayPreference = 'result' | 'all' | `selected:${string}`;

export interface DaxModelConfig {
  schemaVersion: 1;
  enabled: boolean;
  selectedMeasureId?: string;
  measures: DaxMeasureConfig[];
  calculatedColumns?: DaxCalculatedColumnConfig[];
  displayPreference?: DaxDisplayPreference;
  selectedColumns?: string[];
  selectedOperation?: string;
}

export type DaxAstNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'column'; name: string }
  | { kind: 'unary'; operator: '-'; value: DaxAstNode }
  | { kind: 'binary'; operator: string; left: DaxAstNode; right: DaxAstNode }
  | { kind: 'function'; name: string; args: DaxAstNode[] };

export interface DaxToken {
  type: 'identifier' | 'number' | 'string' | 'column' | 'operator' | 'paren' | 'comma';
  value: string;
}

const DAX_AGGREGATE_FUNCTIONS = new Set(['SUM', 'PRODUCT', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCTCOUNT', 'MEDIAN', 'STDEV', 'VARIANCE', 'PERCENTILE', 'COUNTBLANK', 'DISTINCTCOUNTNOBLANK', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'PERCENTILE.INC']);

/** Every function the evaluator understands, with the fewest arguments it needs. */
const DAX_FUNCTION_MIN_ARGS: Record<string, number> = {
  SUM: 1, PRODUCT: 1, AVERAGE: 1, MIN: 1, MAX: 1, COUNT: 0, DISTINCTCOUNT: 1, MEDIAN: 1, STDEV: 1, VARIANCE: 1, PERCENTILE: 2,
  COUNTROWS: 0, BLANK: 0, COALESCE: 1, DIVIDE: 2, PERCENTAGE: 2, IF: 2, SWITCH: 3,
  COUNTBLANK: 1, DISTINCTCOUNTNOBLANK: 1, ISBLANK: 1, 'STDEV.S': 1, 'STDEV.P': 1, 'VAR.S': 1, 'VAR.P': 1, 'PERCENTILE.INC': 2,
  // Logic and math
  AND: 2, OR: 2, NOT: 1, IFERROR: 2, ROUND: 1, ABS: 1,
  // Text
  LEN: 1, LEFT: 1, RIGHT: 1, MID: 3, UPPER: 1, LOWER: 1, TRIM: 1, CONCATENATE: 2, SUBSTITUTE: 3,
  FIND: 2, SEARCH: 2, VALUE: 1, EXACT: 2,
  // Date
  TODAY: 0, NOW: 0, DATE: 3, DATEVALUE: 1, YEAR: 1, MONTH: 1, DAY: 1, QUARTER: 1, WEEKDAY: 1, DATEDIFF: 3, EOMONTH: 2,
};

const DATEDIFF_UNITS = new Set(['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']);

/** Operation picker entries shared by the Chart Builder and Report Builder. */
export const DAX_FUNCTION_SNIPPETS: readonly string[] = [
  'SUM([Column])', 'PRODUCT([Column])', 'AVERAGE([Column])', 'MIN([Column])', 'MAX([Column])', 'COUNT([Column])',
  'COUNTROWS()', 'DISTINCTCOUNT([Column])', 'MEDIAN([Column])', 'STDEV([Column])', 'VARIANCE([Column])',
  'PERCENTILE([Column], 0.9)', 'PERCENTAGE(SUM([Actual]), SUM([Target]))', 'DIVIDE(SUM([Actual]), SUM([Planned]))',
  'IF(SUM([Actual]) > SUM([Target]), 1, 0)', 'SWITCH(TRUE(), SUM([Score]) >= 90, 3, SUM([Score]) >= 70, 2, 1)',
  'COALESCE(SUM([Column]), 0)', 'ROUND(AVERAGE([Column]), 2)',
  // Text: use inside an aggregate or a condition.
  'SUM(LEN([Column]))', 'DISTINCTCOUNT(UPPER([Column]))', 'DISTINCTCOUNT(TRIM([Column]))', 'DISTINCTCOUNT(LEFT([Column], 3))',
  'SUM(IF(SEARCH("text", [Column]) > 0, 1, 0))', 'SUM(VALUE(SUBSTITUTE([Column], "$", "")))',
  // Date
  'MAX(YEAR([Column]))', 'DISTINCTCOUNT(MONTH([Column]))', 'DISTINCTCOUNT(QUARTER([Column]))',
  'AVERAGE(DATEDIFF([Column], TODAY(), "DAY"))', 'SUM(IF(WEEKDAY([Column], 2) > 5, 1, 0))',
  'COUNTBLANK([Column])', 'DISTINCTCOUNTNOBLANK([Column])',
  'STDEV.S([Column])', 'STDEV.P([Column])', 'VAR.S([Column])', 'VAR.P([Column])', 'PERCENTILE.INC([Column], 0.9)',
  'DIVIDE(SUM([Value] * [Weight]), SUM([Weight]), 0)',
  'SUM(IF([Status] = "Closed", [Amount], 0))',
  'SUM(IF([Actual] >= [Target], 1, 0))',
  'DIVIDE(SUM(IF([Status] = "Closed", [Amount], 0)), SUM(IF([Status] = "Closed", 1, 0)), 0)',
  'DIVIDE(SUM([Actual]) - SUM([Target]), SUM([Target]), 0) * 100',
  'SUM(IF(AND([Date] >= DATE(2026, 1, 1), [Date] < DATE(2027, 1, 1)), [Amount], 0))',
  'SUM(IF(ISBLANK([Column]), 0, 1))',
];

export function buildDaxOperationExpression(snippet: string, columns: string[], scope: DaxEvaluationScope = 'column'): string {
  if (!snippet.includes('(')) snippet = `${snippet}([Column])`;
  if (!columns.length) return snippet;
  const simple = /^(SUM|PRODUCT|AVERAGE|MIN|MAX|COUNT|DISTINCTCOUNT|MEDIAN|STDEV|VARIANCE|PERCENTILE)\(\[Column\](?:,\s*([0-9.]+))?\)$/.exec(snippet);
  const terms = columns.map(column => scope === 'row' ? `[${column}]` : `SUM([${column}])`);
  if (columns.length > 1 && simple) {
    const operation = simple[1];
    if (operation === 'PRODUCT') return terms.join(' * ');
    if (operation === 'AVERAGE') return `DIVIDE(${terms.join(' + ')}, ${terms.length})`;
    const args = columns.map(column => `[${column}]`).join(', ');
    return `${operation}(${args}${operation === 'PERCENTILE' ? `, ${simple[2] ?? '0.9'}` : ''})`;
  }
  if (columns.length > 1 && ['DIVIDE(SUM([Actual]), SUM([Planned]))', 'PERCENTAGE(SUM([Actual]), SUM([Target]))'].includes(snippet)) {
    return `${snippet.split('(')[0]}(${terms[0]}, ${terms[1]})`;
  }
  const { tokens, error } = tokenizeDax(snippet);
  if (error) return snippet;
  const placeholders = [...new Set(tokens.filter(token => token.type === 'column').map(token => token.value))];
  const replacements = new Map(placeholders.map((placeholder, index) => [placeholder, columns[index] ?? placeholder]));
  return tokens.map((token, index) => token.type === 'column' ? `[${replacements.get(token.value)}]`
    : token.type === 'string' ? `"${token.value.replace(/"/g, '""')}"`
    : token.type === 'identifier' && tokens[index + 1]?.type === 'column' ? `'${token.value}'` : token.value).join(' ');
}

export function restoreDaxOperation(operation: string | null | undefined, expression: string): string {
  if (!operation) return '';
  return operation.includes('(') ? operation : expression || `${operation}([Column])`;
}

/**
 * Name, Calculate By and expression checks for a measure about to be saved. `form` covers the name
 * and Calculate By fields, `expression` the formula; both are '' when valid. Names must be unique
 * because Row measures become table columns keyed by name.
 */
export function validateDaxMeasureDraft(
  draft: DaxMeasureConfig, others: DaxMeasureConfig[], availableColumns?: string[],
): { form: string; expression: string } {
  const name = draft.name?.trim() ?? '';
  const form = !name ? 'Enter a measure name.'
    : others.some(m => m.id !== draft.id && m.name?.trim().toLowerCase() === name.toLowerCase()) ? `A measure named "${name}" already exists.`
    : !draft.evaluationScope ? 'Select Calculate By (Column or Row).' : '';
  return { form, expression: form ? '' : validateDaxExpression(draft.expression?.trim() ?? '', availableColumns, draft.evaluationScope) };
}

export function createDefaultDaxMeasure(id = 'measure-1'): DaxMeasureConfig {
  // Name and Calculate By start empty so the form shows placeholders until the user chooses them.
  return { id, name: '', expression: '', format: 'number', includeInSeries: true };
}

export function createDefaultDaxModel(): DaxModelConfig {
  const measure = createDefaultDaxMeasure();
  return { schemaVersion: 1, enabled: false, selectedMeasureId: measure.id, measures: [measure], selectedColumns: [], selectedOperation: '' };
}

export function cloneDaxModel(model: DaxModelConfig | undefined): DaxModelConfig {
  if (!model) return createDefaultDaxModel();
  // Saved measures predating Calculate By meant Column; a new, empty measure keeps it unset.
  const measures: DaxMeasureConfig[] = (model.measures ?? []).map(m => ({ ...m, columns: m.columns ? [...m.columns] : undefined, evaluationScope: m.evaluationScope ?? (m.expression?.trim() ? 'column' : undefined) }));
  if (!measures.length) measures.push(createDefaultDaxMeasure());
  return {
    schemaVersion: 1,
    enabled: !!model.enabled,
    selectedMeasureId: model.selectedMeasureId ?? measures[0].id,
    measures,
    calculatedColumns: (model.calculatedColumns ?? []).map(c => ({ ...c })),
    displayPreference: (model.displayPreference as string) === 'selected-result' ? 'result' : (model.displayPreference ?? 'result'),
    selectedColumns: [...(model.selectedColumns ?? [])],
    selectedOperation: model.selectedOperation ?? '',
  };
}

export function parseDaxExpression(expression: string): { ast: DaxAstNode | null; error: string } {
  if (!expression?.trim()) {
    return { ast: null, error: 'Enter a DAX expression.' };
  }
  const { tokens, error: tokenError } = tokenizeDax(expression);
  if (tokenError || !tokens.length) {
    return { ast: null, error: tokenError ?? 'Enter a DAX expression.' };
  }
  const parser = { index: 0 };
  const ast = parseDaxComparison(tokens, parser);
  if (!ast || parser.index !== tokens.length) {
    // Name the most common mistake instead of a generic parse failure.
    const depth = tokens.reduce((d, t) => d + (t.value === '(' ? 1 : t.value === ')' ? -1 : 0), 0);
    if (depth > 0) return { ast: null, error: 'Invalid expression: a closing ")" is missing.' };
    if (depth < 0) return { ast: null, error: 'Invalid expression: there is an extra ")".' };
    return { ast: null, error: 'Invalid expression: check the function names, commas and brackets.' };
  }
  return { ast, error: '' };
}

/**
 * Checks an expression before it is saved: syntax, then function names, argument counts and
 * column references. Returns '' when the expression is valid. Unknown functions and columns
 * otherwise evaluate silently to 0, which looked like a working measure with a wrong result.
 */
export function validateDaxExpression(expression: string, availableColumns?: string[], scope?: DaxEvaluationScope): string {
  const { ast, error } = parseDaxExpression(expression);
  if (!ast) return error;
  const known = availableColumns?.length ? new Set(availableColumns.map(c => c.toLowerCase())) : null;
  // In Column mode a bare [Column] would read only the first row, so it must sit inside an aggregate.
  const needsAggregate = scope === 'column';
  const visit = (node: DaxAstNode, insideAggregate = false): string => {
    if (node.kind === 'column') {
      if (known && !known.has(node.name.toLowerCase())) return `Column [${node.name}] does not exist in this data source.`;
      if (needsAggregate && !insideAggregate) return `[${node.name}] must be inside an aggregate such as SUM([${node.name}]) when Calculate By is Column, or set Calculate By to Row.`;
      return '';
    }
    if (node.kind === 'unary') return visit(node.value, insideAggregate);
    if (node.kind === 'binary') return visit(node.left, insideAggregate) || visit(node.right, insideAggregate);
    if (node.kind === 'function') {
      if (node.name === 'PERCENTILE' || node.name === 'PERCENTILE.INC') {
        const fraction = node.args.at(-1);
        if (fraction?.kind === 'literal' && (asNumber(fraction.value) < 0 || asNumber(fraction.value) > 1)) {
          return 'PERCENTILE needs a fraction between 0 and 1 as its last argument, e.g. 0.9 for the 90th percentile.';
        }
      }

      const min = DAX_FUNCTION_MIN_ARGS[node.name];
      if (min === undefined) return `${node.name} is not a supported function.`;
      if (node.args.length < min) return `${node.name} needs at least ${min} argument${min === 1 ? '' : 's'}.`;
      if (['COUNTBLANK', 'DISTINCTCOUNTNOBLANK', 'ISBLANK', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'PERCENTILE.INC'].includes(node.name)
        && node.args.length !== min) return `${node.name} needs exactly ${min} argument${min === 1 ? '' : 's'}.`;
      if (node.name === 'DATEDIFF') {
        const unit = node.args[2];
        if (unit.kind !== 'literal' || !DATEDIFF_UNITS.has(safeString(unit.value).toUpperCase())) {
          return 'DATEDIFF needs a unit in quotes: "DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "HOUR", "MINUTE" or "SECOND".';
        }
      }
      const aggregates = insideAggregate || DAX_AGGREGATE_FUNCTIONS.has(node.name);
      for (const arg of node.args) {
        const argError = visit(arg, aggregates);
        if (argError) return argError;
      }
    }
    return '';
  };
  return visit(ast);
}

export function evaluateDaxMeasure(
  measure: DaxMeasureConfig | undefined,
  rows: Record<string, unknown>[],
  availableColumns?: string[],
): number {
  if (!measure?.expression?.trim() || !rows?.length) return 0;
  const { ast } = parseDaxExpression(measure.expression);
  if (!ast) return 0;
  if ((measure.evaluationScope ?? 'column') === 'row') {
    return rows.reduce((sum, row) => sum + asNumber(evaluateDaxNode(ast, [row], availableColumns)), 0);
  }
  const result = evaluateDaxNode(ast, rows, availableColumns);
  return asNumber(result);
}

/**
 * Evaluates a row-scope DAX measure for a single table row.
 */
export function evaluateDaxMeasureForRow(
  measure: DaxMeasureConfig | undefined,
  row: Record<string, unknown>,
  allRows: Record<string, unknown>[],
  availableColumns?: string[],
): number {
  if (!measure?.expression?.trim()) return 0;
  const { ast } = parseDaxExpression(measure.expression);
  if (!ast) return 0;
  // Row scope is per row by design: SUM([A], [B]) adds the two columns of this row.
  return asNumber(evaluateDaxNode(ast, [row], availableColumns));
}

/** Formats a DAX measure's numeric result per its configured display format (number, currency, percent). */
export function formatDaxValue(value: number, measure: Pick<DaxMeasureConfig, 'format' | 'decimalPlaces'> | undefined): string {
  // Decimals 1-4 are exact; unset/0 is Auto (up to 2), so a ratio like 0.87 no longer shows as "1".
  const places = measure?.decimalPlaces ?? 0;
  const digits = places > 0 ? { minimumFractionDigits: places, maximumFractionDigits: places } : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  const format = measure?.format ?? 'number';
  const safeValue = Number.isFinite(value) ? value : 0;
  if (format === 'percent') {
    // The PERCENTAGE operation already computes (sum(numerators) / sum(denominators)) * 100,
    // so only append the % sign here instead of scaling again.
    return `${safeValue.toLocaleString(undefined, digits)}%`;
  }
  if (format === 'currency') {
    return `$${safeValue.toLocaleString(undefined, digits)}`;
  }
  return safeValue.toLocaleString(undefined, digits);
}

/** Returns the measures of a saved chart design that should be rendered as chart series. */
export function getActiveDaxMeasures(design: Record<string, unknown> | null | undefined): DaxMeasureConfig[] {
  const model = design?.['daxModel'] as DaxModelConfig | undefined;
  // Turning DAX Model off in the builder must hide its measures in every saved view too.
  if (!model?.enabled) return [];
  return (model.measures ?? []).filter(m => m.includeInSeries !== false && !!m.expression?.trim());
}

export function getSelectedDaxMeasure(model: DaxModelConfig | null | undefined): DaxMeasureConfig | undefined {
  if (!model?.enabled || !model.selectedMeasureId) return undefined;
  return getActiveDaxMeasures({ daxModel: model }).find(measure => measure.id === model.selectedMeasureId);
}

export function getTileDaxRequest(model: DaxModelConfig | null | undefined, columns?: string[]): { expression: DaxAstNode; scope: DaxEvaluationScope } | undefined {
  if (!model?.enabled) return undefined;
  const measure = getSelectedDaxMeasure(model);
  if (!measure) throw new Error('Select a valid DAX measure for this tile.');
  const scope = measure.evaluationScope ?? 'column';
  const error = validateDaxExpression(measure.expression, columns, scope);
  if (error) throw new Error(error);
  const { ast } = parseDaxExpression(measure.expression);
  if (!ast) throw new Error('Invalid tile DAX expression.');
  return { expression: ast, scope };
}

export function evaluateTileDaxValue(rows: Record<string, unknown>[], model: DaxModelConfig | null | undefined, columns?: string[]): number | undefined {
  if (!getTileDaxRequest(model, columns ?? Object.keys(rows[0] ?? {}))) return undefined;
  return evaluateDaxMeasure(getSelectedDaxMeasure(model), rows, columns);
}

/**
 * Appends each DAX measure as an extra category, mirroring the Chart Builder preview:
 * multi-series charts get the measure total once, single-series charts
 * get it pushed onto the value list.
 */
export function appendDaxToChartData(
  measures: DaxMeasureConfig[],
  rows: Record<string, unknown>[],
  availableColumns: string[] | undefined,
  categories: string[],
  values: number[],
  series?: { data?: unknown }[],
  totalSeriesIndex = -1,
): void {
  for (const measure of measures) {
    const total = evaluateDaxMeasure(measure, rows, availableColumns);
    categories.push(measure.name?.trim() || 'New Metric');
    if (series?.length) {
      appendDaxTotalToSeries(total, series, totalSeriesIndex);
    } else {
      values.push(total);
    }
  }
}

export function appendDaxTotalToSeries(total: number, series: { data?: unknown }[], totalSeriesIndex = -1): void {
  const primaryIndex = series.findIndex((entry, index) => index !== totalSeriesIndex && Array.isArray(entry.data));
  series.forEach((entry, index) => {
    if (Array.isArray(entry.data)) entry.data.push(index === primaryIndex || index === totalSeriesIndex ? total : 0);
  });
}

/** Row-scope measures render as an extra column instead of a trailing summary row. */
export function getDaxRowColumnMeasures(measures: DaxMeasureConfig[]): DaxMeasureConfig[] {
  return measures.filter(m => (m.evaluationScope ?? 'column') === 'row');
}

/** The measure with every [fromCol] reference (and picked column) renamed to toCol. */
export function renameDaxColumn(measure: DaxMeasureConfig, fromCol: string, toCol: string): DaxMeasureConfig {
  const escaped = fromCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rename = (columns?: string[]) => columns?.map(c => c === fromCol ? toCol : c);
  return {
    ...measure,
    expression: (measure.expression ?? '').replace(new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'gi'), `[${toCol}]`),
    columns: rename(measure.columns),
    numeratorColumns: rename(measure.numeratorColumns),
    denominatorColumns: rename(measure.denominatorColumns),
  };
}

/** Returns the source columns referenced by a DAX expression, in expression order. */
export function getDaxReferencedColumns(measure: DaxMeasureConfig): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  const { tokens } = tokenizeDax(measure.expression ?? '');
  for (const token of tokens) {
    if (token.type !== 'column') continue;
    const column = token.value.trim();
    if (column && !seen.has(column.toLowerCase())) {
      seen.add(column.toLowerCase());
      columns.push(column);
    }
  }
  return columns;
}

/**
 * The summary-row cells a Column-scope measure fills under a table's value columns. A single
 * aggregate over several columns (e.g. COUNT([A], [B]) from the Operation/Column pickers) gives
 * each column its own result; any other expression gives one total under the last referenced
 * column (or the last column when it references none shown).
 */
export function daxSummaryCells(
  measure: DaxMeasureConfig,
  rows: Record<string, unknown>[],
  valueColumns: string[],
  availableColumns?: string[],
): string[] {
  const cells = valueColumns.map(() => '');
  if (!valueColumns.length) return cells;
  const indexOf = (column: string) => valueColumns.findIndex(c => c.toLowerCase() === column.toLowerCase());
  const { ast } = parseDaxExpression(measure.expression ?? '');
  if (ast?.kind === 'function' && DAX_AGGREGATE_FUNCTIONS.has(ast.name)) {
    const fraction = ast.name === 'PERCENTILE' ? ast.args.at(-1) : undefined;
    const columnArgs = (fraction ? ast.args.slice(0, -1) : ast.args);
    if (columnArgs.length > 1 && columnArgs.every(arg => arg.kind === 'column')) {
      let placed = false;
      for (const arg of columnArgs as Extract<DaxAstNode, { kind: 'column' }>[]) {
        const index = indexOf(arg.name);
        if (index < 0) continue;
        const single: DaxAstNode = { kind: 'function', name: ast.name, args: fraction ? [arg, fraction] : [arg] };
        cells[index] = formatDaxValue(asNumber(evaluateDaxNode(single, rows, availableColumns)), measure);
        placed = true;
      }
      if (placed) return cells;
    }
  }
  const referenced = getDaxReferencedColumns(measure).map(indexOf).filter(index => index >= 0);
  cells[referenced.length ? referenced[referenced.length - 1] : valueColumns.length - 1] =
    formatDaxValue(evaluateDaxMeasure(measure, rows, availableColumns), measure);
  return cells;
}

/**
 * Appends DAX measures to a rendered data table. Column-scope measures append a trailing
 * summary row (measure name + total). Row-scope measures append a new column instead, computing
 * the expression per existing table row using `rowGroups[i]` (the source rows for that table row).
 */
export function appendDaxToTableRows(
  measures: DaxMeasureConfig[],
  rows: Record<string, unknown>[],
  availableColumns: string[] | undefined,
  tableRows: (string | number)[][],
  valueColumnCount: number,
  rowGroups?: Record<string, unknown>[][],
  valueColumns?: string[],
): void {
  const rowMeasures = getDaxRowColumnMeasures(measures);
  const summaryMeasures = measures.filter(m => (m.evaluationScope ?? 'column') !== 'row');

  if (rowMeasures.length && rowGroups?.length === tableRows.length) {
    for (const measure of rowMeasures) {
      tableRows.forEach((cells, i) => cells.push(formatDaxValue(evaluateDaxMeasure(measure, rowGroups[i], availableColumns), measure)));
    }
  }

  for (const measure of summaryMeasures) {
    const columns = valueColumns?.length === valueColumnCount ? valueColumns : Array.from({ length: valueColumnCount }, (_, i) => `#${i}`);
    const cells: (string | number)[] = [measure.name?.trim() || 'New Metric', ...daxSummaryCells(measure, rows, columns, availableColumns)];
    rowMeasures.forEach(() => cells.push(''));
    tableRows.push(cells);
  }
}

export function evaluateDaxNode(
  node: DaxAstNode,
  rows: Record<string, unknown>[],
  availableColumns?: string[],
  fullRows?: Record<string, unknown>[],
): unknown {
  if (node.kind === 'literal') return node.value;
  if (node.kind === 'column') return rows[0]?.[resolveDaxColumn(node.name, rows, availableColumns)] ?? null;
  if (node.kind === 'unary') return -asNumber(evaluateDaxNode(node.value, rows, availableColumns, fullRows));
  if (node.kind === 'binary') return evaluateDaxBinary(node, rows, availableColumns, fullRows);
  return evaluateDaxFunction(node.name, node.args, rows, availableColumns, fullRows);
}

function tokenizeDax(expression: string): { tokens: DaxToken[]; error: string } {
  const tokens: DaxToken[] = [];
  let i = 0;
  while (i < expression.length) {
    const res = readDaxToken(expression, i, tokens);
    if (res.error) return { tokens: [], error: res.error };
    i = res.next;
  }
  return { tokens, error: '' };
}

function readDaxToken(expression: string, index: number, tokens: DaxToken[]): { next: number; error: string } {
  const ch = expression[index];
  if (/\s/.test(ch)) return { next: index + 1, error: '' };
  if (ch === '"') return readDaxStringToken(expression, index, tokens);
  if (ch === "'") return readDaxQuotedTableToken(expression, index, tokens);
  if (ch === '[') return readDaxColumnToken(expression, index, tokens);
  if (isDigit(ch) || (ch === '.' && isDigit(expression[index + 1] ?? ''))) return { next: readDaxNumberToken(expression, index, tokens), error: '' };
  if (isIdentifierStart(ch)) return { next: readDaxIdentifierToken(expression, index, tokens), error: '' };
  return readDaxSymbolToken(expression, index, tokens);
}

function readDaxSymbolToken(expression: string, index: number, tokens: DaxToken[]): { next: number; error: string } {
  const ch = expression[index];
  const two = expression.slice(index, index + 2);
  if (['>=', '<=', '<>', '&&', '||'].includes(two)) { tokens.push({ type: 'operator', value: two }); return { next: index + 2, error: '' }; }
  if ('+-*/^&=><'.includes(ch)) { tokens.push({ type: 'operator', value: ch }); return { next: index + 1, error: '' }; }
  if (ch === '(' || ch === ')') { tokens.push({ type: 'paren', value: ch }); return { next: index + 1, error: '' }; }
  if (ch === ',') { tokens.push({ type: 'comma', value: ch }); return { next: index + 1, error: '' }; }
  return { next: -1, error: `Unsupported token "${ch}" in DAX expression.` };
}

function readDaxStringToken(expression: string, start: number, tokens: DaxToken[]): { next: number; error: string } {
  let value = '';
  let i = start + 1;
  while (i < expression.length) {
    if (expression[i] === '"') {
      // "" inside a string is an escaped quote, as in DAX.
      if (expression[i + 1] === '"') { value += '"'; i += 2; continue; }
      tokens.push({ type: 'string', value });
      return { next: i + 1, error: '' };
    }
    value += expression[i++];
  }
  return { next: -1, error: 'String literal is not closed.' };
}

/** 'Table Name' before a [Column]; the table name is only a qualifier here. */
function readDaxQuotedTableToken(expression: string, start: number, tokens: DaxToken[]): { next: number; error: string } {
  const end = expression.indexOf("'", start + 1);
  if (end < 0) return { next: -1, error: 'Table name is not closed with a quote.' };
  tokens.push({ type: 'identifier', value: expression.slice(start + 1, end) });
  return { next: end + 1, error: '' };
}

function readDaxColumnToken(expression: string, start: number, tokens: DaxToken[]): { next: number; error: string } {
  let value = '';
  let i = start + 1;
  while (i < expression.length && expression[i] !== ']') value += expression[i++];
  if (expression[i] !== ']') { return { next: -1, error: 'Column reference is not closed.' }; }
  tokens.push({ type: 'column', value: value.trim() });
  return { next: i + 1, error: '' };
}

function readDaxNumberToken(expression: string, start: number, tokens: DaxToken[]): number {
  let value = expression[start];
  let i = start + 1;
  while (i < expression.length && (isDigit(expression[i]) || expression[i] === '.')) value += expression[i++];
  tokens.push({ type: 'number', value });
  return i;
}

function readDaxIdentifierToken(expression: string, start: number, tokens: DaxToken[]): number {
  let value = expression[start];
  let i = start + 1;
  while (i < expression.length && isIdentifierPart(expression[i])) value += expression[i++];
  tokens.push({ type: 'identifier', value });
  return i;
}

/** One left-associative binary level: `next` parses the tighter-binding operands. */
function parseDaxLevel(
  tokens: DaxToken[], parser: { index: number }, operators: string[],
  next: (tokens: DaxToken[], parser: { index: number }) => DaxAstNode | null,
): DaxAstNode | null {
  let node = next(tokens, parser);
  while (node && peekDax(tokens, parser)?.type === 'operator' && operators.includes(peekDax(tokens, parser)!.value)) {
    const op = tokens[parser.index++].value;
    const right = next(tokens, parser);
    if (!right) return null;
    node = { kind: 'binary', operator: op, left: node, right };
  }
  return node;
}

// DAX precedence, loosest first: ||, &&, comparison, & (concatenation), + -, * /, ^.
function parseDaxComparison(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  return parseDaxLevel(tokens, parser, ['||'], parseDaxAnd);
}

function parseDaxAnd(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  return parseDaxLevel(tokens, parser, ['&&'], parseDaxCompare);
}

function parseDaxCompare(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  return parseDaxLevel(tokens, parser, ['=', '<>', '>', '<', '>=', '<='], parseDaxConcat);
}

function parseDaxConcat(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  return parseDaxLevel(tokens, parser, ['&'], parseDaxAdd);
}

function parseDaxAdd(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  let node = parseDaxMultiply(tokens, parser);
  while (node && peekDax(tokens, parser)?.type === 'operator' && ['+', '-'].includes(peekDax(tokens, parser)!.value)) {
    const op = tokens[parser.index++].value;
    const right = parseDaxMultiply(tokens, parser);
    if (!right) return null;
    node = { kind: 'binary', operator: op, left: node, right };
  }
  return node;
}

function parseDaxMultiply(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  let node = parseDaxPower(tokens, parser);
  while (node && peekDax(tokens, parser)?.type === 'operator' && ['*', '/'].includes(peekDax(tokens, parser)!.value)) {
    const op = tokens[parser.index++].value;
    const right = parseDaxPower(tokens, parser);
    if (!right) return null;
    node = { kind: 'binary', operator: op, left: node, right };
  }
  return node;
}

function parseDaxPower(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  return parseDaxLevel(tokens, parser, ['^'], parseDaxUnary);
}

function parseDaxUnary(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  const token = peekDax(tokens, parser);
  if (token?.type === 'operator' && token.value === '-') {
    parser.index++;
    const value = parseDaxUnary(tokens, parser);
    return value ? { kind: 'unary', operator: '-', value } : null;
  }
  return parseDaxPrimary(tokens, parser);
}

function parseDaxPrimary(tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  const token = tokens[parser.index++];
  if (!token) return null;
  if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
  if (token.type === 'string') return { kind: 'literal', value: token.value };
  if (token.type === 'column') return { kind: 'column', name: token.value };
  if (token.type === 'identifier') return parseDaxIdentifier(token.value, tokens, parser);
  if (token.type === 'paren' && token.value === '(') {
    const expr = parseDaxComparison(tokens, parser);
    if (peekDax(tokens, parser)?.value !== ')') return null;
    parser.index++;
    return expr;
  }
  return null;
}

function parseDaxIdentifier(identifier: string, tokens: DaxToken[], parser: { index: number }): DaxAstNode | null {
  if (peekDax(tokens, parser)?.type === 'column') return { kind: 'column', name: tokens[parser.index++].value };
  const normalized = identifier.toUpperCase();
  if (normalized === 'TRUE' || normalized === 'FALSE') {
    // Both TRUE and TRUE() are valid DAX.
    if (peekDax(tokens, parser)?.value === '(' && tokens[parser.index + 1]?.value === ')') parser.index += 2;
    return { kind: 'literal', value: normalized === 'TRUE' };
  }
  if (peekDax(tokens, parser)?.value !== '(') return null;
  parser.index++;
  const args: DaxAstNode[] = [];
  while (peekDax(tokens, parser) && peekDax(tokens, parser)?.value !== ')') {
    const arg = parseDaxComparison(tokens, parser);
    if (!arg) return null;
    args.push(arg);
    if (peekDax(tokens, parser)?.type === 'comma') parser.index++;
    else if (peekDax(tokens, parser)?.value !== ')') return null;
  }
  if (peekDax(tokens, parser)?.value !== ')') return null;
  parser.index++;
  return { kind: 'function', name: normalized, args };
}

function peekDax(tokens: DaxToken[], parser: { index: number }): DaxToken | undefined {
  return tokens[parser.index];
}

function evaluateDaxBinary(
  node: Extract<DaxAstNode, { kind: 'binary' }>,
  rows: Record<string, unknown>[],
  availableColumns?: string[],
  fullRows?: Record<string, unknown>[],
): unknown {
  const left = evaluateDaxNode(node.left, rows, availableColumns, fullRows);
  const right = evaluateDaxNode(node.right, rows, availableColumns, fullRows);
  switch (node.operator) {
    case '+': return asNumber(left) + asNumber(right);
    case '-': return asNumber(left) - asNumber(right);
    case '*': return asNumber(left) * asNumber(right);
    case '/': return asNumber(right) === 0 ? 0 : asNumber(left) / asNumber(right);
    case '^': return Math.pow(asNumber(left), asNumber(right));
    case '&': return safeString(left) + safeString(right);
    case '=': return compareDax(left, right) === 0;
    case '<>': return compareDax(left, right) !== 0;
    case '>': return compareDax(left, right) > 0;
    case '<': return compareDax(left, right) < 0;
    case '>=': return compareDax(left, right) >= 0;
    case '<=': return compareDax(left, right) <= 0;
    case '&&': return asBoolean(left) && asBoolean(right);
    case '||': return asBoolean(left) || asBoolean(right);
    default: return 0;
  }
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/** Numbers compare as numbers, dates (e.g. DATE(), TODAY(), a date column) as dates, the rest as case-insensitive text. */
function compareDax(left: unknown, right: unknown): number {
  if (isNumericValue(left) && isNumericValue(right)) return Math.sign(asNumber(left) - asNumber(right));
  const leftDate = typeof left === 'string' || left instanceof Date ? toDaxDate(left) : null;
  const rightDate = typeof right === 'string' || right instanceof Date ? toDaxDate(right) : null;
  if (leftDate && rightDate) return Math.sign(leftDate.getTime() - rightDate.getTime());
  return safeString(left).toLowerCase().localeCompare(safeString(right).toLowerCase());
}

function evaluateDaxFunction(
  name: string,
  args: DaxAstNode[],
  rows: Record<string, unknown>[],
  availableColumns?: string[],
  fullRows?: Record<string, unknown>[],
): unknown {
  if (name === 'COUNTROWS') return (fullRows ?? rows).length;
  if (name === 'BLANK') return null;
  if (name === 'COALESCE') return args.map(arg => evaluateDaxNode(arg, rows, availableColumns, fullRows)).find(value => value !== null && value !== undefined && value !== '') ?? null;
  if (name === 'DIVIDE') return divideDax(args, rows, availableColumns, fullRows);
  // PERCENTAGE = (sum of numerator terms / sum of denominator terms) * 100.
  if (name === 'PERCENTAGE') return divideDax(args, rows, availableColumns, fullRows) * 100;
  if (name === 'IF') return ifDax(args, rows, availableColumns, fullRows);
  if (name === 'SWITCH') return switchDax(args, rows, availableColumns, fullRows);
  const arg = (index: number) => evaluateDaxNode(args[index], rows, availableColumns, fullRows);
  if (name === 'ISBLANK') return arg(0) == null;
  if (name === 'AND') return asBoolean(arg(0)) && asBoolean(arg(1));
  if (name === 'OR') return asBoolean(arg(0)) || asBoolean(arg(1));
  if (name === 'NOT') return !asBoolean(arg(0));
  if (name === 'ABS') return Math.abs(asNumber(arg(0)));
  if (name === 'ROUND') {
    const factor = 10 ** (args[1] ? asNumber(arg(1)) : 0);
    return Math.round(asNumber(arg(0)) * factor) / factor;
  }
  if (name === 'IFERROR') {
    try {
      const value = arg(0);
      return typeof value === 'number' && !Number.isFinite(value) ? arg(1) : value;
    } catch {
      return arg(1);
    }
  }
  if (DAX_AGGREGATE_FUNCTIONS.has(name)) {
    return evaluateDaxAggregateFunction(name, args, fullRows ?? rows, availableColumns);
  }
  const values = () => args.map(arg => evaluateDaxNode(arg, rows, availableColumns, fullRows));
  return evaluateDaxTextFunction(name, values) ?? evaluateDaxDateFunction(name, values) ?? 0;
}

/** Text functions; undefined when `name` is not one. Positions are 1-based, as in DAX. */
function evaluateDaxTextFunction(name: string, values: () => unknown[]): unknown {
  const text = (v: unknown) => safeString(v);
  switch (name) {
    case 'LEN': return text(values()[0]).length;
    case 'LEFT': { const [v, n] = values(); return text(v).slice(0, Math.max(0, n === undefined ? 1 : asNumber(n))); }
    case 'RIGHT': { const [v, n] = values(); const count = Math.max(0, n === undefined ? 1 : asNumber(n)); return count ? text(v).slice(-count) : ''; }
    case 'MID': { const [v, start, n] = values(); const from = Math.max(1, asNumber(start)) - 1; return text(v).slice(from, from + Math.max(0, asNumber(n))); }
    case 'UPPER': return text(values()[0]).toUpperCase();
    case 'LOWER': return text(values()[0]).toLowerCase();
    case 'TRIM': return text(values()[0]).trim().replace(/\s+/g, ' ');
    case 'CONCATENATE': return values().map(text).join('');
    case 'SUBSTITUTE': { const [v, from, to] = values(); return from ? text(v).split(text(from)).join(text(to)) : text(v); }
    case 'FIND':
    case 'SEARCH': {
      const [find, within, start, notFound] = values();
      const haystack = name === 'SEARCH' ? text(within).toLowerCase() : text(within);
      const needle = name === 'SEARCH' ? text(find).toLowerCase() : text(find);
      const index = haystack.indexOf(needle, Math.max(1, start === undefined ? 1 : asNumber(start)) - 1);
      return index >= 0 ? index + 1 : (notFound ?? 0);
    }
    case 'VALUE': return asNumber(text(values()[0]).replace(/,/g, ''));
    case 'EXACT': { const [a, b] = values(); return text(a) === text(b); }
    default: return undefined;
  }
}

/** Date functions; undefined when `name` is not one. Dates are returned as ISO strings. */
function evaluateDaxDateFunction(name: string, values: () => unknown[]): unknown {
  const date = (v: unknown) => toDaxDate(v);
  switch (name) {
    case 'TODAY': { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate())); }
    case 'NOW': return new Date().toISOString();
    case 'DATE': { const [y, m, d] = values().map(asNumber); return isoDate(new Date(y, m - 1, d)); }
    case 'DATEVALUE': { const d = date(values()[0]); return d ? isoDate(d) : null; }
    case 'YEAR': return date(values()[0])?.getFullYear() ?? null;
    case 'MONTH': { const d = date(values()[0]); return d ? d.getMonth() + 1 : null; }
    case 'DAY': return date(values()[0])?.getDate() ?? null;
    case 'QUARTER': { const d = date(values()[0]); return d ? Math.floor(d.getMonth() / 3) + 1 : null; }
    case 'WEEKDAY': {
      // Return type 1 (default): Sunday = 1 … Saturday = 7. Type 2: Monday = 1 … Sunday = 7.
      const [v, type] = values();
      const d = date(v);
      if (!d) return null;
      return asNumber(type) === 2 ? ((d.getDay() + 6) % 7) + 1 : d.getDay() + 1;
    }
    case 'DATEDIFF': {
      const [a, b, unit] = values();
      const start = date(a), end = date(b);
      return start && end ? daxDateDiff(start, end, safeString(unit).toUpperCase()) : null;
    }
    case 'EOMONTH': {
      const [v, months] = values();
      const d = date(v);
      return d ? isoDate(new Date(d.getFullYear(), d.getMonth() + asNumber(months) + 1, 0)) : null;
    }
    default: return undefined;
  }
}

function toDaxDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined || value === '') return null;
  const text = safeString(value);
  // Plain dates are local calendar days; parsing them as UTC would shift the day in many time zones.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const d = ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3]) : new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daxDateDiff(start: Date, end: Date, unit: string): number {
  const ms = end.getTime() - start.getTime();
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  switch (unit) {
    case 'SECOND': return Math.trunc(ms / 1000);
    case 'MINUTE': return Math.trunc(ms / 60_000);
    case 'HOUR': return Math.trunc(ms / 3_600_000);
    case 'WEEK': return Math.trunc(ms / 604_800_000);
    case 'MONTH': return months;
    case 'QUARTER': return Math.trunc(months / 3);
    case 'YEAR': return end.getFullYear() - start.getFullYear();
    default: return Math.round(ms / 86_400_000);
  }
}

function evaluateDaxAggregateFunction(
  name: string,
  args: DaxAstNode[],
  rows: Record<string, unknown>[],
  availableColumns?: string[],
): number {
  // PERCENTILE's last argument is the fraction (e.g. 0.9); every preceding argument is a
  // column/value whose data is combined into one set before computing the percentile.
  const isPercentile = name === 'PERCENTILE' || name === 'PERCENTILE.INC';
  const valueArgs = isPercentile ? args.slice(0, -1) : args;
  const values = valueArgs.length
    ? valueArgs.flatMap(arg => collectDaxValues(arg, rows, availableColumns))
    : collectDaxValues(undefined, rows, availableColumns);
  const nums = values.map(Number).filter(Number.isFinite);
  const numericValues = values.filter(value => value != null && value !== '' && typeof value !== 'boolean')
    .map(Number).filter(Number.isFinite);
  const populationVariance = () => {
    if (!numericValues.length) return 0;
    const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    return numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numericValues.length;
  };
  const aggregateHandlers: Record<string, () => number> = {
    COUNTBLANK: () => values.filter(value => value == null || value === '').length,
    DISTINCTCOUNTNOBLANK: () => new Set(values.filter(value => value != null).map(value => typeof value === 'string' ? value.toLowerCase() : value)).size,
    'STDEV.S': () => standardDeviation(numericValues),
    'STDEV.P': () => Math.sqrt(populationVariance()),
    'VAR.S': () => variance(numericValues),
    'VAR.P': () => populationVariance(),
    'PERCENTILE.INC': () => percentile(numericValues, asNumber(evaluateDaxNode(args.at(-1)!, rows, availableColumns))),
    COUNT: () => values.filter(value => value !== null && value !== undefined && value !== '').length,
    DISTINCTCOUNT: () => new Set(values.map(value => safeString(value)).filter(Boolean)).size,
    SUM: () => nums.reduce((sum, value) => sum + value, 0),
    PRODUCT: () => nums.reduce((product, value) => product * value, nums.length ? 1 : 0),
    AVERAGE: () => nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0,
    MIN: () => nums.length ? Math.min(...nums) : 0,
    MAX: () => nums.length ? Math.max(...nums) : 0,
    MEDIAN: () => percentile(nums, 0.5),
    STDEV: () => standardDeviation(nums),
    VARIANCE: () => variance(nums),
    PERCENTILE: () => percentile(nums, asNumber(evaluateDaxNode(args.at(-1)!, rows, availableColumns))),
  };
  return aggregateHandlers[name]?.() ?? 0;
}

function collectDaxValues(
  node: DaxAstNode | undefined,
  rows: Record<string, unknown>[],
  availableColumns?: string[],
): unknown[] {
  if (!node) return rows;
  if (node.kind === 'column') {
    const column = resolveDaxColumn(node.name, rows, availableColumns);
    return rows.map(row => row[column]);
  }
  return rows.map(row => evaluateDaxNodeForRow(node, row, availableColumns));
}

function evaluateDaxNodeForRow(
  node: DaxAstNode,
  row: Record<string, unknown>,
  availableColumns?: string[],
): unknown {
  if (node.kind === 'column') return row[resolveDaxColumn(node.name, [row], availableColumns)];
  return evaluateDaxNode(node, [row], availableColumns);
}

function divideDax(args: DaxAstNode[], rows: Record<string, unknown>[], availableColumns?: string[], fullRows?: Record<string, unknown>[]): number {
  const numerator = asNumber(evaluateDaxNode(args[0], rows, availableColumns, fullRows));
  const denominator = asNumber(evaluateDaxNode(args[1], rows, availableColumns, fullRows));
  if (denominator === 0) return args[2] ? asNumber(evaluateDaxNode(args[2], rows, availableColumns, fullRows)) : 0;
  return numerator / denominator;
}

function ifDax(args: DaxAstNode[], rows: Record<string, unknown>[], availableColumns?: string[], fullRows?: Record<string, unknown>[]): unknown {
  return asBoolean(evaluateDaxNode(args[0], rows, availableColumns, fullRows))
    ? evaluateDaxNode(args[1], rows, availableColumns, fullRows)
    : args[2] ? evaluateDaxNode(args[2], rows, availableColumns, fullRows) : null;
}

function switchDax(args: DaxAstNode[], rows: Record<string, unknown>[], availableColumns?: string[], fullRows?: Record<string, unknown>[]): unknown {
  if (!args.length) return null;
  const test = evaluateDaxNode(args[0], rows, availableColumns, fullRows);
  for (let i = 1; i < args.length - 1; i += 2) {
    const candidate = evaluateDaxNode(args[i], rows, availableColumns, fullRows);
    // SWITCH(TRUE(), cond, value, ...) tests conditions; otherwise the test value is matched.
    if (test === true ? asBoolean(candidate) : compareDax(candidate, test) === 0) {
      return evaluateDaxNode(args[i + 1], rows, availableColumns, fullRows);
    }
  }
  return args.length % 2 === 0 ? evaluateDaxNode(args.at(-1)!, rows, availableColumns, fullRows) : null;
}

function resolveDaxColumn(column: string, rows: Record<string, unknown>[], availableColumns?: string[]): string {
  if (availableColumns?.length) {
    const match = availableColumns.find(c => c.toLowerCase() === column.toLowerCase());
    if (match) return match;
  }
  if (rows.length && rows[0]) {
    const keys = Object.keys(rows[0]);
    const match = keys.find(k => k.toLowerCase() === column.toLowerCase());
    if (match) return match;
  }
  return column;
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = Math.min(1, Math.max(0, pct));
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/** Sample variance, as DAX VAR.S (STDEV/VARIANCE in DAX are the sample forms). */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !!safeString(value);
}

function isDigit(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return code >= 48 && code <= 57;
}

function isIdentifierStart(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentifierPart(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return isIdentifierStart(value) || value === '.' || (code >= 48 && code <= 57);
}

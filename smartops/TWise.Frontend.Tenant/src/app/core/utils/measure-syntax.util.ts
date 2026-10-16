import { AggregateFn, BinaryOp, ConditionOp, MeasureCondition, MeasureFn, MeasureNode, RowFn } from '../services/model-studio.service';

/*
 * Formula text for measures and calculated columns. The tree (MeasureNode) is the source of truth and the
 * text is a view of it: printMeasure writes the canonical text, parseMeasure and parseRowExpression read
 * text back into a tree, and reading a printed tree gives the same tree. The server prints the same text into
 * ExpressionText (MeasureText.cs); both sides pin the same cases in their tests.
 *
 *   formula     = sum                                                                  in a measure
 *   formula     = comparison                                                           in a calculated column
 *   comparison  = sum [compare sum]
 *   sum         = product (("+" | "-") product)*
 *   product     = factor (("*" | "/") factor)*
 *   factor      = number | "-" number | calculation | "(" sum ")"                      in a measure
 *   factor      = number | "-" number | text | column | function | "(" comparison ")"  in a calculated column
 *   calculation = AGGREGATE "(" column [WHERE condition] ")"
 *               | COUNTROWS "(" name [WHERE condition] ")"
 *               | MEASURE_FUNCTION "(" sum ("," number)* ")"      the numbers MEASURE_FUNCTION_PARTS asks for
 *               | "[" measure name "]"                                             another measure
 *   function    = ROW_FUNCTION "(" [comparison ("," comparison)*] ")"
 *   condition   = column compare value
 *   column      = name "." name
 *   name        = letters, digits and _ not starting with a digit, or [any text] with ]] for ]
 *   compare     = "=" | "<>" | ">" | ">=" | "<" | "<=", and "==" and "!=" as spreadsheets write them
 *   value       = 'text' with '' for ' | number | "-" number
 *   text        = 'text' with '' for '
 */

/** How each calculation is written in formula text. */
export const FUNCTION_NAMES: Record<AggregateFn, string> = {
  sum: 'SUM', avg: 'AVG', count: 'COUNT', count_distinct: 'DISTINCTCOUNT', min: 'MIN', max: 'MAX', count_rows: 'COUNTROWS',
};

/** How many parts each row function takes, and an example for messages and the function list. The server applies the same counts. */
export const ROW_FUNCTION_SHAPES: Record<RowFn, { fewest: number; most: number; example: string }> = {
  concat: { fewest: 2, most: 10, example: "CONCAT(TaskDaily.task_code, ' ', TaskDaily.task_assignee)" },
  left: { fewest: 2, most: 2, example: 'LEFT(TaskDaily.task_code, 4)' },
  right: { fewest: 2, most: 2, example: 'RIGHT(TaskDaily.task_code, 3)' },
  upper: { fewest: 1, most: 1, example: 'UPPER(TaskDaily.task_code)' },
  lower: { fewest: 1, most: 1, example: 'LOWER(TaskDaily.task_code)' },
  trim: { fewest: 1, most: 1, example: 'TRIM(TaskDaily.task_code)' },
  year: { fewest: 1, most: 1, example: 'YEAR(TaskDaily.action_on)' },
  month: { fewest: 1, most: 1, example: 'MONTH(TaskDaily.action_on)' },
  if: { fewest: 3, most: 3, example: "IF(TaskDaily.data_hours > 8, 'Long', 'Short')" },
  and: { fewest: 2, most: 10, example: 'AND(TaskDaily.data_hours > 0, TaskDaily.data_hours < 8)' },
  or: { fewest: 2, most: 10, example: "OR(TaskDaily.task_code = 'A', TaskDaily.task_code = 'B')" },
  not: { fewest: 1, most: 1, example: 'NOT(ISBLANK(TaskDaily.task_assignee))' },
  isblank: { fewest: 1, most: 1, example: 'ISBLANK(TaskDaily.task_assignee)' },
  coalesce: { fewest: 2, most: 10, example: "COALESCE(TaskDaily.task_assignee, 'Unassigned')" },
  isnull: { fewest: 2, most: 2, example: 'ISNULL(TaskDaily.data_hours, 0)' },
  iferror: { fewest: 2, most: 2, example: 'IFERROR(TaskDaily.data_hours / TaskDaily.crew_type_id, 0)' },
  contains: { fewest: 2, most: 2, example: "CONTAINS(TaskDaily.task_code, 'MNT')" },
  starts_with: { fewest: 2, most: 2, example: "STARTS_WITH(TaskDaily.task_code, 'MNT')" },
  ends_with: { fewest: 2, most: 2, example: "ENDS_WITH(TaskDaily.task_code, '01')" },
  len: { fewest: 1, most: 1, example: 'LEN(TaskDaily.task_code)' },
  replace: { fewest: 3, most: 3, example: "REPLACE(TaskDaily.task_code, '-', '')" },
  substring: { fewest: 2, most: 3, example: 'SUBSTRING(TaskDaily.task_code, 1, 3)' },
  split: { fewest: 3, most: 3, example: "SPLIT(TaskDaily.task_code, '-', 2)" },
  first_word: { fewest: 1, most: 1, example: 'FIRST_WORD(TaskDaily.task_assignee)' },
  last_word: { fewest: 1, most: 1, example: 'LAST_WORD(TaskDaily.task_assignee)' },
  to_number: { fewest: 1, most: 1, example: 'TO_NUMBER(TaskDaily.task_code)' },
  to_date: { fewest: 1, most: 2, example: "TO_DATE(TaskDaily.task_code, 'dmy')" },
  day: { fewest: 1, most: 1, example: 'DAY(TaskDaily.action_on)' },
  quarter: { fewest: 1, most: 1, example: 'QUARTER(TaskDaily.action_on)' },
  weekday: { fewest: 1, most: 1, example: 'WEEKDAY(TaskDaily.action_on)' },
  month_name: { fewest: 1, most: 1, example: 'MONTH_NAME(TaskDaily.action_on)' },
  weekday_name: { fewest: 1, most: 1, example: 'WEEKDAY_NAME(TaskDaily.action_on)' },
  month_start: { fewest: 1, most: 1, example: 'MONTH_START(TaskDaily.action_on)' },
  datediff: { fewest: 2, most: 3, example: "DATEDIFF(TODAY(), TaskDaily.action_on, 'days')" },
  today: { fewest: 0, most: 0, example: 'TODAY()' },
  round: { fewest: 1, most: 2, example: 'ROUND(TaskDaily.data_hours, 1)' },
  abs: { fewest: 1, most: 1, example: 'ABS(TaskDaily.data_hours - 8)' },
  floor: { fewest: 1, most: 1, example: 'FLOOR(TaskDaily.data_hours)' },
  ceiling: { fewest: 1, most: 1, example: 'CEILING(TaskDaily.data_hours)' },
  min_of: { fewest: 2, most: 10, example: 'MIN_OF(TaskDaily.data_hours, 8)' },
  max_of: { fewest: 2, most: 10, example: 'MAX_OF(TaskDaily.data_hours, 0)' },
};

/** How each row function of a calculated column is written in formula text: its code in capitals. */
export const ROW_FUNCTION_NAMES = Object.fromEntries(
  Object.keys(ROW_FUNCTION_SHAPES).map(fn => [fn, fn.toUpperCase()]),
) as Record<RowFn, string>;

/** Measure functions: each reads the grouped rows of the query, along its first field (THRESHOLD reads its own row). */
export const MEASURE_FUNCTION_NAMES: Record<MeasureFn, string> = {
  percent_of_total: 'PERCENT_OF_TOTAL', running_total: 'RUNNING_TOTAL', change: 'CHANGE', change_pct: 'CHANGE_PCT',
  rank: 'RANK', ytd: 'YTD', moving_avg: 'MOVING_AVG', threshold: 'THRESHOLD',
};

/** The numbers a measure function takes after its calculation, and an example; the server applies the same counts. */
export const MEASURE_FUNCTION_PARTS: Partial<Record<MeasureFn, { numbers: number; example: string }>> = {
  moving_avg: { numbers: 1, example: 'MOVING_AVG(SUM(table.column), 3)' },
  threshold: { numbers: 2, example: 'THRESHOLD(SUM(table.column), 50, 80)' },
};

export const COMPARISON_SYMBOLS: Record<ConditionOp, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const RANK: Record<BinaryOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLAIN_NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;

/** The canonical text of a measure or a calculated column's formula. */
export function printMeasure(node: MeasureNode): string {
  switch (node.kind) {
    case 'agg': {
      const where = node.where
        ? ` WHERE ${printColumn(node.where.column)} ${COMPARISON_SYMBOLS[node.where.op]} ${printValue(node.where.value)}`
        : '';
      // COUNTROWS counts the rows of a table, so it names the table alone.
      const target = node.fn === 'count_rows' ? printName(node.arg.source) : printColumn(node.arg);
      return `${FUNCTION_NAMES[node.fn]}(${target}${where})`;
    }
    // ponytail: String() switches to exponent notation outside 1e-6 to 1e21. The parser and the visual
    // mode only make numbers inside that range; a tree stored some other way prints text they refuse.
    case 'num': return String(node.value);
    case 'bin': return `${printOperand(node.left, node.op, false)} ${node.op} ${printOperand(node.right, node.op, true)}`;
    case 'cmp': return `${printSide(node.left)} ${COMPARISON_SYMBOLS[node.op]} ${printSide(node.right)}`;
    case 'col': return printColumn(node);
    case 'text': return printText(node.value);
    // Parts are separated by commas, so none of them needs brackets.
    case 'fn': return `${functionName(node.fn)}(${node.args.map(printMeasure).join(', ')})`;
    // Always bracketed, so a measure never reads as a function or a table.
    case 'ref': return `[${node.measure.replace(/]/g, ']]')}]`;
  }
}

function functionName(fn: RowFn | MeasureFn): string {
  return (ROW_FUNCTION_NAMES as Record<string, string>)[fn] ?? (MEASURE_FUNCTION_NAMES as Record<string, string>)[fn];
}

// Brackets keep the tree's shape: a comparison inside arithmetic always needs them, a looser operator always,
// an equal one only on the right.
function printOperand(node: MeasureNode, parent: BinaryOp, isRight: boolean): string {
  const text = printMeasure(node);
  if (node.kind === 'cmp') return `(${text})`;
  if (node.kind !== 'bin') return text;
  return RANK[node.op] < RANK[parent] || (isRight && RANK[node.op] === RANK[parent]) ? `(${text})` : text;
}

// One comparison at a time: a comparison on either side of another is bracketed.
function printSide(node: MeasureNode): string {
  const text = printMeasure(node);
  return node.kind === 'cmp' ? `(${text})` : text;
}

function printColumn(column: { source: string; column: string }): string {
  return `${printName(column.source)}.${printName(column.column)}`;
}

function printName(name: string): string {
  return PLAIN_NAME.test(name) ? name : `[${name.replace(/]/g, ']]')}]`;
}

// A condition value that reads as a number prints bare; a text value in a row formula is always quoted.
function printValue(value: string): string {
  return PLAIN_NUMBER.test(value) ? value : printText(value);
}

function printText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A problem in formula text. start and end are 0-based character offsets; end is exclusive. */
export interface FormulaError { message: string; start: number; end: number; }

export type ParseResult = { ok: true; node: MeasureNode } | { ok: false; error: FormulaError };

const MAX_LENGTH = 2000;
const NUMBER_RULE = 'A number can have at most 15 digits, and at most 6 after the decimal point.';
const CALCULATIONS = 'SUM, AVG, COUNT, DISTINCTCOUNT, MIN or MAX';
// Two-character symbols first, so "<=" is not read as "<" then "=".
const SYMBOLS = ['<>', '<=', '>=', '==', '!=', '+', '-', '*', '/', '(', ')', '.', ',', '=', '<', '>'];
const FUNCTION_BY_NAME = new Map(Object.entries(FUNCTION_NAMES).map(([fn, name]) => [name, fn as AggregateFn]));
// CEIL is how spreadsheets write CEILING.
const ROW_FUNCTION_BY_NAME = new Map<string, RowFn>([
  ...Object.entries(ROW_FUNCTION_NAMES).map(([fn, name]) => [name, fn as RowFn] as [string, RowFn]),
  ['CEIL', 'ceiling'],
]);
const MEASURE_FUNCTION_BY_NAME = new Map(Object.entries(MEASURE_FUNCTION_NAMES).map(([fn, name]) => [name, fn as MeasureFn]));
// == and != are read as = and <>, as spreadsheets write them.
const COMPARISON_BY_SYMBOL = new Map<string, ConditionOp>([
  ...Object.entries(COMPARISON_SYMBOLS).map(([op, symbol]) => [symbol, op as ConditionOp] as [string, ConditionOp]),
  ['==', 'eq'],
  ['!=', 'neq'],
]);

/**
 * Why a number literal cannot be used, or null when it can. Within 15 digits a number is exact in a
 * double, and inside the range this allows String() never prints an exponent.
 */
export function numberLiteralProblem(literal: string): string | null {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(literal);
  if (!match) return NUMBER_RULE;
  const whole = match[1].replace(/^0+(?=[0-9])/, '');
  const fraction = match[2] ?? '';
  return whole.length + fraction.length > 15 || fraction.length > 6 ? NUMBER_RULE : null;
}

/** Reads formula text into a measure tree, or explains in plain words what is wrong and where. */
export function parseMeasure(text: string): ParseResult {
  return parse(text, false);
}

/** Reads the formula of a calculated column: a calculation on one row, with no SUM or COUNT. */
export function parseRowExpression(text: string): ParseResult {
  return parse(text, true);
}

function parse(text: string, rows: boolean): ParseResult {
  if (text.length > MAX_LENGTH) {
    return { ok: false, error: { message: `A formula can be at most ${MAX_LENGTH} characters long.`, start: MAX_LENGTH, end: text.length } };
  }
  try {
    return { ok: true, node: new Parser(text, tokenize(text), rows).formula() };
  } catch (e) {
    if (e instanceof SyntaxProblem) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
    throw e;
  }
}

type TokenKind = 'name' | 'number' | 'text' | 'symbol' | 'end';

/** bracketed is true for a [name], which is never a keyword or a calculation. */
interface Token { kind: TokenKind; value: string; start: number; end: number; bracketed: boolean; }

class SyntaxProblem extends Error {
  constructor(readonly start: number, readonly end: number, message: string) {
    super(message);
  }
}

function fail(start: number, end: number, message: string): never {
  throw new SyntaxProblem(start, end, message);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, value: string, start: number, end: number, bracketed = false) =>
    tokens.push({ kind, value, start, end, bracketed });
  let i = 0;
  while (i < text.length) {
    const start = i;
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('name', text.slice(start, i), start, i);
    } else if (/[0-9]/.test(ch)) {
      while (i < text.length && /[0-9]/.test(text[i])) i++;
      if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
        i++;
        while (i < text.length && /[0-9]/.test(text[i])) i++;
      }
      push('number', text.slice(start, i), start, i);
    } else if (ch === '[' || ch === "'") {
      // A doubled closing character stands for itself: ]] in a name, '' in text.
      const close = ch === '[' ? ']' : "'";
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) fail(start, text.length, ch === '[' ? 'This name has no closing ].' : 'This text has no closing quote.');
        if (text[i] === close) {
          if (text[i + 1] === close) {
            value += close;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i++];
      }
      if (ch === '[' && !value) fail(start, i, 'A name in square brackets cannot be empty.');
      push(ch === '[' ? 'name' : 'text', value, start, i, ch === '[');
    } else if (ch === '"') {
      fail(start, start + 1, "Use single quotes around text, as in 'Done'.");
    } else {
      const symbol = SYMBOLS.find(s => text.startsWith(s, i));
      if (!symbol) fail(start, start + 1, `"${ch}" cannot be used in a formula.`);
      i += symbol.length;
      push('symbol', symbol, start, i);
    }
  }
  push('end', '', text.length, text.length);
  return tokens;
}

/**
 * Recursive descent over the grammar at the top of this file. rows is true for a calculated column's
 * formula. Every failure is a SyntaxProblem.
 */
class Parser {
  private index = 0;

  constructor(private readonly source: string, private readonly tokens: Token[], private readonly rows: boolean) {}

  formula(): MeasureNode {
    if (this.peek.kind === 'end') {
      fail(0, 0, this.rows ? 'Write a formula, for example TaskDaily.data_hours * 60.' : 'Write a formula, for example SUM(TaskDaily.data_hours).');
    }
    const node = this.rows ? this.comparison() : this.sum();
    const extra = this.peek;
    if (extra.kind !== 'end') {
      fail(extra.start, extra.end, this.isSymbol(')')
        ? 'This closing bracket ) has no opening bracket.'
        : `Expected +, -, * or / before ${this.shown(extra)}.`);
    }
    return node;
  }

  /** In a calculated column: a value, or two values and one comparison between them. */
  private comparison(): MeasureNode {
    const left = this.sum();
    const op = this.compareOp();
    if (!op) return left;
    this.next();
    const right = this.sum();
    if (this.compareOp()) fail(this.peek.start, this.peek.end, 'Compare two values at a time. Join comparisons with AND(...) or OR(...).');
    return { kind: 'cmp', op, left, right };
  }

  private compareOp(): ConditionOp | undefined {
    return this.peek.kind === 'symbol' ? COMPARISON_BY_SYMBOL.get(this.peek.value) : undefined;
  }

  private sum(): MeasureNode {
    let node = this.product();
    while (this.isSymbol('+') || this.isSymbol('-')) {
      const op = this.next().value as BinaryOp;
      node = { kind: 'bin', op, left: node, right: this.product() };
    }
    return node;
  }

  private product(): MeasureNode {
    let node = this.factor();
    while (this.isSymbol('*') || this.isSymbol('/')) {
      const op = this.next().value as BinaryOp;
      node = { kind: 'bin', op, left: node, right: this.factor() };
    }
    return node;
  }

  private factor(): MeasureNode {
    const token = this.peek;
    if (this.isSymbol('(')) {
      this.next();
      const node = this.rows ? this.comparison() : this.sum();
      this.expect(')', 'A closing bracket ) is missing here.');
      return node;
    }
    if (this.isSymbol('-')) {
      this.next();
      if (this.peek.kind !== 'number') {
        fail(token.start, token.end, this.rows
          ? 'A minus sign can only come before a number. To subtract a column, write 0 - table.column.'
          : 'A minus sign can only come before a number. To subtract a calculation, write 0 - SUM(...).');
      }
      // 0 - n rather than -n, so that -0 is read as 0.
      return { kind: 'num', value: 0 - this.number(this.next()) };
    }
    if (token.kind === 'number') return { kind: 'num', value: this.number(this.next()) };
    if (token.kind === 'name') return this.rows ? this.rowName() : this.calculation();
    if (token.kind === 'text' && this.rows) return { kind: 'text', value: this.next().value };
    const expected = this.rows ? 'a number, a column or a function such as CONCAT(...)' : 'a number or a calculation such as SUM(...)';
    if (token.kind === 'end') fail(token.start, token.end, `The formula ends too early. Expected ${expected}.`);
    return fail(token.start, token.end, `Expected ${expected} here, not ${this.shown(token)}.`);
  }

  private calculation(): MeasureNode {
    const name = this.next();
    // [Name] on its own is another measure; [Table].column and [Table] in COUNTROWS(...) stay names.
    if (name.bracketed && !this.isSymbol('.') && !this.isSymbol('(')) return { kind: 'ref', measure: name.value };
    if (this.isSymbol('.')) {
      // A column where a calculation belongs: name the column and show the fix.
      const column = this.tokens[this.index + 1];
      const end = column.kind === 'name' ? column.end : this.peek.end;
      const written = this.source.slice(name.start, end);
      fail(name.start, end, `${written} needs a calculation around it, for example SUM(${written}).`);
    }
    const upper = name.bracketed ? '' : name.value.toUpperCase();
    const fn = FUNCTION_BY_NAME.get(upper);
    const across = MEASURE_FUNCTION_BY_NAME.get(upper);
    if (!this.isSymbol('(')) {
      const example = fn === 'count_rows' ? 'COUNTROWS(table)'
        : fn ? `${FUNCTION_NAMES[fn]}(table.column)`
        : across ? `${MEASURE_FUNCTION_NAMES[across]}(SUM(table.column))` : '';
      const known = fn ? FUNCTION_NAMES[fn] : across ? MEASURE_FUNCTION_NAMES[across] : '';
      fail(name.start, name.end, known
        ? `${known} needs an opening bracket after it, as in ${example}.`
        : `Expected a number or a calculation such as SUM(...) here, not ${this.shown(name)}.`);
    }
    if (across) {
      this.next();
      const args = [this.sum()];
      const parts = MEASURE_FUNCTION_PARTS[across];
      while (this.isSymbol(',')) {
        const comma = this.next();
        if (!parts || args.length > parts.numbers) {
          fail(comma.start, comma.end, parts
            ? `${MEASURE_FUNCTION_NAMES[across]} takes a calculation and ${parts.numbers === 1 ? 'a number' : `${parts.numbers} numbers`}, as in ${parts.example}.`
            : `${MEASURE_FUNCTION_NAMES[across]} takes one calculation, as in ${MEASURE_FUNCTION_NAMES[across]}(SUM(table.column)).`);
        }
        const start = this.peek.start;
        const part = this.sum();
        if (part.kind !== 'num') fail(start, this.peek.start, `${MEASURE_FUNCTION_NAMES[across]} needs a plain number here, as in ${parts!.example}.`);
        args.push(part);
      }
      if (parts && args.length !== parts.numbers + 1) {
        fail(name.start, this.peek.end, `${MEASURE_FUNCTION_NAMES[across]} takes a calculation and ${parts.numbers === 1 ? 'a number' : `${parts.numbers} numbers`}, as in ${parts.example}.`);
      }
      this.expect(')', 'A closing bracket ) is missing here.');
      return { kind: 'fn', fn: across, args };
    }
    if (!fn) {
      const row = name.bracketed ? undefined : ROW_FUNCTION_BY_NAME.get(upper);
      fail(name.start, name.end, row
        ? `${ROW_FUNCTION_NAMES[row]} works on one row at a time. Add it as a calculated column, then use that column in the measure.`
        : `${this.shown(name)} is not a calculation. Use ${CALCULATIONS}.`);
    }
    this.next();
    const arg = fn === 'count_rows' ? this.table() : this.column();
    let where: MeasureCondition | undefined;
    if (this.peek.kind === 'name' && !this.peek.bracketed && this.peek.value.toUpperCase() === 'WHERE') {
      this.next();
      where = this.condition();
    }
    this.expect(')', 'A closing bracket ) is missing here.');
    return where ? { kind: 'agg', fn, arg, where } : { kind: 'agg', fn, arg };
  }

  /** COUNTROWS names a table, not a column. */
  private table(): { source: string; column: string } {
    const source = this.peek;
    if (source.kind !== 'name') fail(source.start, source.end, 'Expected a table name here, as in COUNTROWS(TaskDaily).');
    this.next();
    if (this.isSymbol('.')) fail(this.peek.start, this.peek.end, 'COUNTROWS takes a table name only, as in COUNTROWS(TaskDaily).');
    return { source: source.value, column: '*' };
  }

  /** In a calculated column: a column, or a row function and its parts. */
  private rowName(): MeasureNode {
    const name = this.peek;
    const after = this.tokens[this.index + 1];
    if (after.kind === 'symbol' && after.value === '.') {
      const column = this.column();
      return { kind: 'col', source: column.source, column: column.column };
    }
    this.next();
    const upper = name.bracketed ? '' : name.value.toUpperCase();
    const aggregate = FUNCTION_BY_NAME.get(upper);
    if (aggregate) {
      fail(name.start, name.end,
        `${FUNCTION_NAMES[aggregate]} adds up many rows, and a calculated column works on one row at a time. Use it in a measure instead.`);
    }
    const across = MEASURE_FUNCTION_BY_NAME.get(upper);
    if (across) {
      fail(name.start, name.end,
        `${MEASURE_FUNCTION_NAMES[across]} compares rows with each other, and a calculated column works on one row at a time. Use it in a measure instead.`);
    }
    const fn = ROW_FUNCTION_BY_NAME.get(upper);
    if (!fn) {
      fail(name.start, name.end, this.isSymbol('(')
        ? `${this.shown(name)} is not a function. Pick one from the function list.`
        : `Expected a column here, written as table.column, not ${this.shown(name)}.`);
    }
    const { fewest, most, example } = ROW_FUNCTION_SHAPES[fn];
    this.expect('(', `${ROW_FUNCTION_NAMES[fn]} needs an opening bracket after it, as in ${example}.`);
    const args: MeasureNode[] = [];
    if (!this.isSymbol(')')) {
      args.push(this.comparison());
      while (this.isSymbol(',')) {
        this.next();
        args.push(this.comparison());
      }
    }
    const close = this.peek;
    this.expect(')', 'Expected a comma or a closing bracket ) here.');
    if (args.length < fewest || args.length > most) {
      const count = fewest === most ? `${most}` : `${fewest} to ${most}`;
      fail(name.start, close.end, `${ROW_FUNCTION_NAMES[fn]} takes ${count} part${most === 1 ? '' : 's'}, as in ${example}.`);
    }
    return { kind: 'fn', fn, args };
  }

  private column(): { source: string; column: string } {
    const source = this.peek;
    if (source.kind !== 'name') fail(source.start, source.end, 'Expected a column here, written as table.column.');
    this.next();
    const written = this.source.slice(source.start, source.end);
    this.expect('.', `Expected a dot and a column name after ${this.shown(source)}, as in ${written}.column.`);
    const column = this.peek;
    if (column.kind !== 'name') fail(column.start, column.end, `Expected a column name after "${written}.".`);
    this.next();
    return { source: source.value, column: column.value };
  }

  private condition(): MeasureCondition {
    const column = this.column();
    const comparison = this.peek;
    const op = comparison.kind === 'symbol' ? COMPARISON_BY_SYMBOL.get(comparison.value) : undefined;
    if (!op) fail(comparison.start, comparison.end, 'Expected a comparison here: =, <>, >, >=, < or <=.');
    this.next();
    return { column, op, value: this.value() };
  }

  /** A condition value stays text as written, so 007 and 1.50 keep their digits. */
  private value(): string {
    const token = this.peek;
    if (token.kind === 'text' || token.kind === 'number') return this.next().value;
    if (this.isSymbol('-') && this.tokens[this.index + 1].kind === 'number') {
      this.next();
      return `-${this.next().value}`;
    }
    return fail(token.start, token.end, "Expected a value to compare with, such as 'Done' or 3.");
  }

  private number(token: Token): number {
    if (numberLiteralProblem(token.value)) fail(token.start, token.end, NUMBER_RULE);
    return Number(token.value);
  }

  private get peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private isSymbol(value: string): boolean {
    return this.peek.kind === 'symbol' && this.peek.value === value;
  }

  private expect(value: string, message: string): void {
    if (!this.isSymbol(value)) fail(this.peek.start, this.peek.end, message);
    this.next();
  }

  /** A token as the user typed it, in double quotes, for messages. */
  private shown(token: Token): string {
    return `"${this.source.slice(token.start, token.end)}"`;
  }
}

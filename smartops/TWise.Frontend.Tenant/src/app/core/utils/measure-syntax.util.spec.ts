import { describe, expect, it } from 'vitest';
import { AggregateFn, BinaryOp, ConditionOp, MeasureCondition, MeasureFn, MeasureNode, RowFn } from '../services/model-studio.service';
import { ROW_FUNCTION_SHAPES, numberLiteralProblem, parseMeasure, parseRowExpression, printMeasure } from './measure-syntax.util';

const agg = (fn: AggregateFn, source: string, column: string, where?: MeasureCondition): MeasureNode =>
  where ? { kind: 'agg', fn, arg: { source, column }, where } : { kind: 'agg', fn, arg: { source, column } };
const num = (value: number): MeasureNode => ({ kind: 'num', value });
const bin = (op: BinaryOp, left: MeasureNode, right: MeasureNode): MeasureNode => ({ kind: 'bin', op, left, right });
const when = (source: string, column: string, op: ConditionOp, value: string): MeasureCondition => ({ column: { source, column }, op, value });

// The same trees and texts are pinned in MeasureTextTests.cs, so the browser and the server print alike.
const CANONICAL: [string, MeasureNode][] = [
  ['COUNT(TaskDaily.task_daily_id)', agg('count', 'TaskDaily', 'task_daily_id')],
  ['SUM(TaskDaily.data_hours) / COUNT(TaskDaily.task_daily_id)',
    bin('/', agg('sum', 'TaskDaily', 'data_hours'), agg('count', 'TaskDaily', 'task_daily_id'))],
  ['(SUM(t.x) + SUM(t.y)) * 2', bin('*', bin('+', agg('sum', 't', 'x'), agg('sum', 't', 'y')), num(2))],
  ['SUM(t.x) - (SUM(t.y) - 1)', bin('-', agg('sum', 't', 'x'), bin('-', agg('sum', 't', 'y'), num(1)))],
  ['SUM(t.x) * 2 + 0.25', bin('+', bin('*', agg('sum', 't', 'x'), num(2)), num(0.25))],
  ['AVG(t.x) - -1.5', bin('-', agg('avg', 't', 'x'), num(-1.5))],
  ["DISTINCTCOUNT(CrewType.code WHERE CrewType.code <> 'Night''s')",
    agg('count_distinct', 'CrewType', 'code', when('CrewType', 'code', 'neq', "Night's"))],
  ['MAX(t.[Hours Worked] WHERE t.[a]]b] >= 3)', agg('max', 't', 'Hours Worked', when('t', 'a]b', 'gte', '3'))],
  ["MIN(TaskDaily.action_on WHERE TaskDaily.action_on > '2026-01-31')",
    agg('min', 'TaskDaily', 'action_on', when('TaskDaily', 'action_on', 'gt', '2026-01-31'))],
];

// Extra cases pinned in MeasureTextTests.cs beyond the shared nine, so the browser stays in step with the server.
const SERVER_EXTRA: [string, MeasureNode][] = [
  ['-2 * SUM(t.x)', bin('*', num(-2), agg('sum', 't', 'x'))],
  ['SUM([a.b].[[x] WHERE [a.b].[y[1]]] = 1)', agg('sum', 'a.b', '[x', when('a.b', 'y[1]', 'eq', '1'))],
  ["SUM(WHERE.SUM WHERE WHERE.SUM = 'x')", agg('sum', 'WHERE', 'SUM', when('WHERE', 'SUM', 'eq', 'x'))],
  ["COUNT(t.x WHERE t.y = 'a\nb')", agg('count', 't', 'x', when('t', 'y', 'eq', 'a\nb'))],
  ["COUNT(t.x WHERE t.y = '3\n')", agg('count', 't', 'x', when('t', 'y', 'eq', '3\n'))],
  ["COUNT(t.x WHERE t.y = 'a\r\nb')", agg('count', 't', 'x', when('t', 'y', 'eq', 'a\r\nb'))],
];

describe('printMeasure', () => {
  it.each(CANONICAL)('prints %s', (text, tree) => {
    expect(printMeasure(tree)).toBe(text);
  });

  it.each(SERVER_EXTRA)('matches the backend printer\'s text for %s', (text, tree) => {
    expect(printMeasure(tree)).toBe(text);
  });

  it('keeps brackets only where the shape of the tree needs them', () => {
    const [a, b, c] = [agg('sum', 't', 'a'), agg('sum', 't', 'b'), agg('sum', 't', 'c')];
    expect(printMeasure(bin('/', a, bin('*', b, c)))).toBe('SUM(t.a) / (SUM(t.b) * SUM(t.c))');
    expect(printMeasure(bin('*', bin('/', a, b), c))).toBe('SUM(t.a) / SUM(t.b) * SUM(t.c)');
    expect(printMeasure(bin('+', a, bin('*', b, c)))).toBe('SUM(t.a) + SUM(t.b) * SUM(t.c)');
    expect(printMeasure(bin('*', a, bin('+', b, c)))).toBe('SUM(t.a) * (SUM(t.b) + SUM(t.c))');
  });

  it('brackets names that are not plain and quotes values that are not numbers', () => {
    expect(printMeasure(agg('count', 'My Table', '2nd', when('My Table', 'x', 'eq', ' 5'))))
      .toBe("COUNT([My Table].[2nd] WHERE [My Table].x = ' 5')");
    expect(printMeasure(agg('count', 't', 'x', when('t', 'y', 'neq', '')))).toBe("COUNT(t.x WHERE t.y <> '')");
  });
});

// Written by hand the way people type; the right-hand side is the canonical text.
const TIDY: [string, string][] = [
  ['sum( TaskDaily.data_hours )/count(TaskDaily.task_daily_id)', 'SUM(TaskDaily.data_hours) / COUNT(TaskDaily.task_daily_id)'],
  ['((SUM(t.x)))', 'SUM(t.x)'],
  ['(SUM(t.x) * 2) + 1', 'SUM(t.x) * 2 + 1'],
  ['SUM(t.x) + (SUM(t.y) * 2)', 'SUM(t.x) + SUM(t.y) * 2'],
  ["count(t.id where t.status='Done')", "COUNT(t.id WHERE t.status = 'Done')"],
  ["max(t.x where t.n = '3')", 'MAX(t.x WHERE t.n = 3)'],
  ['min(t.x WHERE t.n>=007)', 'MIN(t.x WHERE t.n >= 007)'],
  ['distinctcount([t].[x])', 'DISTINCTCOUNT(t.x)'],
  ['1.50 + - 2', '1.5 + -2'],
  ['avg(t.x)\n  / 8', 'AVG(t.x) / 8'],
];

const NUMBER_RULE = 'A number can have at most 15 digits, and at most 6 after the decimal point.';

// Text, message, start, end.
const ERRORS: [string, string, number, number][] = [
  ['', 'Write a formula, for example SUM(TaskDaily.data_hours).', 0, 0],
  ['SUM(TaskDaily.data_hours', 'A closing bracket ) is missing here.', 24, 24],
  ['SUM(TaskDaily.data_hours))', 'This closing bracket ) has no opening bracket.', 25, 26],
  ['TOTAL(TaskDaily.data_hours)', '"TOTAL" is not a calculation. Use SUM, AVG, COUNT, DISTINCTCOUNT, MIN or MAX.', 0, 5],
  ['TaskDaily.data_hours * 2', 'TaskDaily.data_hours needs a calculation around it, for example SUM(TaskDaily.data_hours).', 0, 20],
  ['SUM(t.x) # 2', '"#" cannot be used in a formula.', 9, 10],
  ['COUNT(t.id WHERE t.status = "Done")', "Use single quotes around text, as in 'Done'.", 28, 29],
  ["COUNT(t.id WHERE t.status = 'Done)", 'This text has no closing quote.', 28, 34],
  ['SUM(t.x WHERE t.y 1)', 'Expected a comparison here: =, <>, >, >=, < or <=.', 18, 19],
  ['SUM(t.x WHERE t.y = )', "Expected a value to compare with, such as 'Done' or 3.", 20, 21],
  ['- SUM(t.x)', 'A minus sign can only come before a number. To subtract a calculation, write 0 - SUM(...).', 0, 1],
  ['SUM(t.x) * 1.1234567', NUMBER_RULE, 11, 20],
  ['[Hours', 'This name has no closing ].', 0, 6],
  ['SUM([].x)', 'A name in square brackets cannot be empty.', 4, 6],
  ['SUM(t)', 'Expected a dot and a column name after "t", as in t.column.', 5, 6],
  ['SUM(t.)', 'Expected a column name after "t.".', 6, 7],
  ['SUM()', 'Expected a column here, written as table.column.', 4, 5],
  ['2 3', 'Expected +, -, * or / before "3".', 2, 3],
  ['SUM(t.x) +', 'The formula ends too early. Expected a number or a calculation such as SUM(...).', 10, 10],
  ['(SUM(t.x)', 'A closing bracket ) is missing here.', 9, 9],
  ['SUM t.x', 'SUM needs an opening bracket after it, as in SUM(table.column).', 0, 3],
  ['Hours', 'Expected a number or a calculation such as SUM(...) here, not "Hours".', 0, 5],
  ['1'.repeat(2001), 'A formula can be at most 2000 characters long.', 2000, 2001],
];

// A seeded generator, so a failure always reproduces.
function randomNumbers(seed: number): (below: number) => number {
  let state = seed;
  return below => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) % below;
  };
}

const NAMES = ['TaskDaily', 'data_hours', 'Hours Worked', 'a]b', 'WHERE', 'sum', '_x1'];
const VALUES = ['Done', "It's", '3', '-2.5', '', '007', ' 5', '2026-01-31'];
const FUNCTIONS: AggregateFn[] = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'];
const OPERATORS: BinaryOp[] = ['+', '-', '*', '/'];
const COMPARISONS: ConditionOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];

function randomMeasure(pick: (below: number) => number, depth: number): MeasureNode {
  const choice = pick(depth > 0 ? 3 : 2);
  if (choice === 0) return num((pick(10001) - 5000) / 100);
  if (choice === 1) {
    const name = () => NAMES[pick(NAMES.length)];
    const where = pick(2) ? when(name(), name(), COMPARISONS[pick(6)], VALUES[pick(VALUES.length)]) : undefined;
    return agg(FUNCTIONS[pick(6)], name(), name(), where);
  }
  return bin(OPERATORS[pick(4)], randomMeasure(pick, depth - 1), randomMeasure(pick, depth - 1));
}

describe('parseMeasure', () => {
  it.each(CANONICAL)('reads %s back into its tree', (text, tree) => {
    expect(parseMeasure(text)).toEqual({ ok: true, node: tree });
  });

  it.each(SERVER_EXTRA)('reads the backend\'s awkward text %s back into its tree', (text, tree) => {
    expect(parseMeasure(text)).toEqual({ ok: true, node: tree });
  });

  it.each(TIDY)('reads %s and prints it canonically', (text, canonical) => {
    const parsed = parseMeasure(text);
    expect(parsed.ok).toBe(true);
    const printed = printMeasure((parsed as { node: MeasureNode }).node);
    expect(printed).toBe(canonical);
    expect(printMeasure((parseMeasure(printed) as { node: MeasureNode }).node)).toBe(canonical);
  });

  it.each(ERRORS)('refuses %s with a positioned, plain message', (text, message, start, end) => {
    expect(parseMeasure(text)).toEqual({ ok: false, error: { message, start, end } });
  });

  it('reads back every printed tree unchanged, and prints it the same way again', () => {
    const pick = randomNumbers(20260921);
    for (let i = 0; i < 500; i++) {
      const tree = randomMeasure(pick, 4);
      const text = printMeasure(tree);
      const parsed = parseMeasure(text);
      expect(parsed, text).toEqual({ ok: true, node: tree });
      expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(text);
    }
  });

  it('never treats a bracketed name as a keyword or a calculation', () => {
    expect(parseMeasure('SUM(t.[WHERE])')).toEqual({ ok: true, node: agg('sum', 't', 'WHERE') });
    expect(printMeasure(agg('sum', 't', 'WHERE'))).toBe('SUM(t.WHERE)');
    expect(parseMeasure('SUM(t.WHERE)')).toEqual({ ok: true, node: agg('sum', 't', 'WHERE') });
    expect(parseMeasure('[SUM](t.x)')).toEqual({ ok: false, error: {
      message: '"[SUM]" is not a calculation. Use SUM, AVG, COUNT, DISTINCTCOUNT, MIN or MAX.', start: 0, end: 5,
    } });
  });
});

describe('numberLiteralProblem', () => {
  it('accepts at most 15 digits, 6 of them after the point', () => {
    expect(numberLiteralProblem('123456789012345')).toBeNull();
    expect(numberLiteralProblem('000123.5')).toBeNull();
    expect(numberLiteralProblem('0.000001')).toBeNull();
    expect(numberLiteralProblem('1234567890123456')).toBe(NUMBER_RULE);
    expect(numberLiteralProblem('1.1234567')).toBe(NUMBER_RULE);
    expect(numberLiteralProblem('1e-7')).toBe(NUMBER_RULE);
  });
});

const col = (source: string, column: string): MeasureNode => ({ kind: 'col', source, column });
const txt = (value: string): MeasureNode => ({ kind: 'text', value });
const call = (fn: RowFn, ...args: MeasureNode[]): MeasureNode => ({ kind: 'fn', fn, args });

// The same trees and texts are pinned in MeasureTextTests.cs (RowCanonical), so the browser and the server print alike.
const ROW_CANONICAL: [string, MeasureNode][] = [
  ['TaskDaily.data_hours * 60', bin('*', col('TaskDaily', 'data_hours'), num(60))],
  ['YEAR(TaskDaily.action_on)', call('year', col('TaskDaily', 'action_on'))],
  ['LEFT(TaskDaily.task_code, 4)', call('left', col('TaskDaily', 'task_code'), num(4))],
  ["CONCAT(t.first_name, ' ', t.last_name)", call('concat', col('t', 'first_name'), txt(' '), col('t', 'last_name'))],
  ['(t.a + t.b) / 2', bin('/', bin('+', col('t', 'a'), col('t', 'b')), num(2))],
  ['UPPER(TRIM(t.[Crew Name]))', call('upper', call('trim', col('t', 'Crew Name')))],
  ["CONCAT('It''s ', t.x, '3')", call('concat', txt("It's "), col('t', 'x'), txt('3'))],
  ['t.x - -1.5 * MONTH(t.d)', bin('-', col('t', 'x'), bin('*', num(-1.5), call('month', col('t', 'd'))))],
];

const ROW_TIDY: [string, string][] = [
  ['year( t.d )', 'YEAR(t.d)'],
  ["concat(t.a,'-',t.b)", "CONCAT(t.a, '-', t.b)"],
  ['((t.x * 2))', 't.x * 2'],
  ['[t].[x]+1', 't.x + 1'],
];

// Text, message, start, end.
const ROW_ERRORS: [string, string, number, number][] = [
  ['', 'Write a formula, for example TaskDaily.data_hours * 60.', 0, 0],
  ['SUM(t.x)', 'SUM adds up many rows, and a calculated column works on one row at a time. Use it in a measure instead.', 0, 3],
  ['hours * 60', 'Expected a column here, written as table.column, not "hours".', 0, 5],
  ['UPPER(t.a, t.b)', 'UPPER takes 1 part, as in UPPER(TaskDaily.task_code).', 0, 15],
  ['LEFT(t.a 3)', 'Expected a comma or a closing bracket ) here.', 9, 10],
  ["CONCAT(t.a, 'x", 'This text has no closing quote.', 12, 14],
  ['- t.x', 'A minus sign can only come before a number. To subtract a column, write 0 - table.column.', 0, 1],
  ['t.x WHERE t.y > 0', 'Expected +, -, * or / before "WHERE".', 4, 9],
  ['CONCAT(t.a)', "CONCAT takes 2 to 10 parts, as in CONCAT(TaskDaily.task_code, ' ', TaskDaily.task_assignee).", 0, 11],
];

const ROW_FUNCTIONS: RowFn[] = ['concat', 'left', 'right', 'upper', 'lower', 'trim', 'year', 'month'];

function randomRow(pick: (below: number) => number, depth: number): MeasureNode {
  const choice = pick(depth > 0 ? 5 : 3);
  if (choice === 0) return num((pick(10001) - 5000) / 100);
  if (choice === 1) return col(NAMES[pick(NAMES.length)], NAMES[pick(NAMES.length)]);
  if (choice === 2) return txt(VALUES[pick(VALUES.length)]);
  if (choice === 3) return bin(OPERATORS[pick(4)], randomRow(pick, depth - 1), randomRow(pick, depth - 1));
  const fn = ROW_FUNCTIONS[pick(ROW_FUNCTIONS.length)];
  const parts = fn === 'concat' ? 2 + pick(3) : fn === 'left' || fn === 'right' ? 2 : 1;
  return call(fn, ...Array.from({ length: parts }, () => randomRow(pick, depth - 1)));
}

describe('row formulas', () => {
  it.each(ROW_CANONICAL)('prints %s', (text, tree) => {
    expect(printMeasure(tree)).toBe(text);
  });

  it.each(ROW_CANONICAL)('reads %s back into its tree', (text, tree) => {
    expect(parseRowExpression(text)).toEqual({ ok: true, node: tree });
  });

  it.each(ROW_TIDY)('reads %s and prints it canonically', (text, canonical) => {
    const parsed = parseRowExpression(text);
    expect(parsed.ok).toBe(true);
    expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(canonical);
  });

  it.each(ROW_ERRORS)('refuses %s with a positioned, plain message', (text, message, start, end) => {
    expect(parseRowExpression(text)).toEqual({ ok: false, error: { message, start, end } });
  });

  it('refuses a row function in a measure and says where it belongs', () => {
    expect(parseMeasure('CONCAT(t.a, t.b)')).toEqual({ ok: false, error: {
      message: 'CONCAT works on one row at a time. Add it as a calculated column, then use that column in the measure.', start: 0, end: 6,
    } });
  });

  it('reads back every printed row formula unchanged, and prints it the same way again', () => {
    const pick = randomNumbers(20260922);
    for (let i = 0; i < 300; i++) {
      const tree = randomRow(pick, 3);
      const text = printMeasure(tree);
      const parsed = parseRowExpression(text);
      expect(parsed, text).toEqual({ ok: true, node: tree });
      expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(text);
    }
  });
});

const cmp = (op: ConditionOp, left: MeasureNode, right: MeasureNode): MeasureNode => ({ kind: 'cmp', op, left, right });
const across = (fn: MeasureFn, arg: MeasureNode): MeasureNode => ({ kind: 'fn', fn, args: [arg] });
const rows = (source: string, where?: MeasureCondition): MeasureNode => agg('count_rows', source, '*', where);

// The same trees and texts are pinned in MeasureTextTests.cs (LibraryCanonical), so the browser and the server print alike.
const LIBRARY_CANONICAL: [string, MeasureNode][] = [
  ["IF(t.x > 3, 'High', 'Low')", call('if', cmp('gt', col('t', 'x'), num(3)), txt('High'), txt('Low'))],
  ["AND(t.a >= 1, NOT(ISBLANK(t.b)), OR(t.c = 'A', t.c <> 'B'))",
    call('and', cmp('gte', col('t', 'a'), num(1)), call('not', call('isblank', col('t', 'b'))),
      call('or', cmp('eq', col('t', 'c'), txt('A')), cmp('neq', col('t', 'c'), txt('B'))))],
  ["COALESCE(t.nick, t.name, '')", call('coalesce', col('t', 'nick'), col('t', 'name'), txt(''))],
  ['ISNULL(t.x, 0)', call('isnull', col('t', 'x'), num(0))],
  ['IFERROR(t.a / t.b, 0)', call('iferror', bin('/', col('t', 'a'), col('t', 'b')), num(0))],
  ["IF(CONTAINS(t.code, 'A-'), 1, 0)", call('if', call('contains', col('t', 'code'), txt('A-')), num(1), num(0))],
  ["STARTS_WITH(t.code, 'X')", call('starts_with', col('t', 'code'), txt('X'))],
  ["ENDS_WITH(t.code, '_1')", call('ends_with', col('t', 'code'), txt('_1'))],
  ['LEN(t.code) - 1', bin('-', call('len', col('t', 'code')), num(1))],
  ["REPLACE(t.phone, '-', '')", call('replace', col('t', 'phone'), txt('-'), txt(''))],
  ['SUBSTRING(t.code, 2, 3)', call('substring', col('t', 'code'), num(2), num(3))],
  ['SUBSTRING(t.code, 2)', call('substring', col('t', 'code'), num(2))],
  ["SPLIT(t.name, ' ', 2)", call('split', col('t', 'name'), txt(' '), num(2))],
  ["SPLIT(t.name, ', ', -1)", call('split', col('t', 'name'), txt(', '), num(-1))],
  ['FIRST_WORD(t.name)', call('first_word', col('t', 'name'))],
  ['LAST_WORD(t.name)', call('last_word', col('t', 'name'))],
  ['TO_NUMBER(t.amount) * 2', bin('*', call('to_number', col('t', 'amount')), num(2))],
  ["TO_DATE(t.written, 'dmy')", call('to_date', col('t', 'written'), txt('dmy'))],
  ['DAY(t.d) + QUARTER(t.d) + WEEKDAY(t.d)',
    bin('+', bin('+', call('day', col('t', 'd')), call('quarter', col('t', 'd'))), call('weekday', col('t', 'd')))],
  ["CONCAT(MONTH_NAME(t.d), ' ', WEEKDAY_NAME(t.d))", call('concat', call('month_name', col('t', 'd')), txt(' '), call('weekday_name', col('t', 'd')))],
  ['MONTH_START(t.d)', call('month_start', col('t', 'd'))],
  ["DATEDIFF(t.done, t.start, 'hours')", call('datediff', col('t', 'done'), col('t', 'start'), txt('hours'))],
  ['DATEDIFF(TODAY(), t.due)', call('datediff', call('today'), col('t', 'due'))],
  ['ROUND(t.x * 1.5, 2)', call('round', bin('*', col('t', 'x'), num(1.5)), num(2))],
  ['ABS(t.a - t.b)', call('abs', bin('-', col('t', 'a'), col('t', 'b')))],
  ['FLOOR(t.x / 10) * 10', bin('*', call('floor', bin('/', col('t', 'x'), num(10))), num(10))],
  ['CEILING(t.x)', call('ceiling', col('t', 'x'))],
  ['MIN_OF(t.cost, t.budget)', call('min_of', col('t', 'cost'), col('t', 'budget'))],
  ['MAX_OF(t.a, t.b, 0)', call('max_of', col('t', 'a'), col('t', 'b'), num(0))],
  ['(t.a > 1) * 2', bin('*', cmp('gt', col('t', 'a'), num(1)), num(2))],
  ['(t.a > 1) = (t.b > 1)', cmp('eq', cmp('gt', col('t', 'a'), num(1)), cmp('gt', col('t', 'b'), num(1)))],
  ['t.a + 1 >= t.b * 2', cmp('gte', bin('+', col('t', 'a'), num(1)), bin('*', col('t', 'b'), num(2)))],
  ['IF(t.x = 1, t.y, IF(t.x = 2, t.z, 0))',
    call('if', cmp('eq', col('t', 'x'), num(1)), col('t', 'y'), call('if', cmp('eq', col('t', 'x'), num(2)), col('t', 'z'), num(0)))],
  ["t.d < '2026-01-31'", cmp('lt', col('t', 'd'), txt('2026-01-31'))],
];

// The same trees and texts are pinned in MeasureTextTests.cs (MeasureLibraryCanonical).
const MEASURE_LIBRARY_CANONICAL: [string, MeasureNode][] = [
  ['COUNTROWS(TaskDaily)', rows('TaskDaily')],
  ['COUNTROWS(TaskDaily WHERE TaskDaily.data_hours > 0)', rows('TaskDaily', when('TaskDaily', 'data_hours', 'gt', '0'))],
  ['COUNTROWS([My Table])', rows('My Table')],
  ['PERCENT_OF_TOTAL(SUM(t.x))', across('percent_of_total', agg('sum', 't', 'x'))],
  ['RUNNING_TOTAL(SUM(t.x) / COUNT(t.id))', across('running_total', bin('/', agg('sum', 't', 'x'), agg('count', 't', 'id')))],
  ['CHANGE(SUM(t.x))', across('change', agg('sum', 't', 'x'))],
  ['CHANGE_PCT(COUNTROWS(t))', across('change_pct', rows('t'))],
  ['SUM(t.x) - CHANGE(SUM(t.x))', bin('-', agg('sum', 't', 'x'), across('change', agg('sum', 't', 'x')))],
  ['RANK(SUM(t.x))', across('rank', agg('sum', 't', 'x'))],
  ['YTD(SUM(t.x))', across('ytd', agg('sum', 't', 'x'))],
  ['MOVING_AVG(SUM(t.x), 3)', { kind: 'fn', fn: 'moving_avg', args: [agg('sum', 't', 'x'), num(3)] }],
  ['THRESHOLD(SUM(t.x), 50, 80)', { kind: 'fn', fn: 'threshold', args: [agg('sum', 't', 'x'), num(50), num(80)] }],
];

const LIBRARY_TIDY: [string, string][] = [
  ["if(t.x>3,'a','b')", "IF(t.x > 3, 'a', 'b')"],
  ['ceil(t.x)', 'CEILING(t.x)'],
  ["t.a == 'x'", "t.a = 'x'"],
  ['t.a != 1', 't.a <> 1'],
  ['today( )', 'TODAY()'],
  ['((t.a > 1))', 't.a > 1'],
];

const MEASURE_TIDY: [string, string][] = [
  ['countrows( t )', 'COUNTROWS(t)'],
  ['running_total( sum(t.x) )', 'RUNNING_TOTAL(SUM(t.x))'],
];

// Text, message, start, end.
const LIBRARY_ERRORS: [string, string, number, number][] = [
  ['t.a > 1 > 2', 'Compare two values at a time. Join comparisons with AND(...) or OR(...).', 8, 9],
  ['RUNNING_TOTAL(SUM(t.x))',
    'RUNNING_TOTAL compares rows with each other, and a calculated column works on one row at a time. Use it in a measure instead.', 0, 13],
  ['TODAY(1)', 'TODAY takes 0 parts, as in TODAY().', 0, 8],
  ['IF(t.a > 1, 2)', "IF takes 3 parts, as in IF(TaskDaily.data_hours > 8, 'Long', 'Short').", 0, 14],
  ['SQRT(t.x)', '"SQRT" is not a function. Pick one from the function list.', 0, 4],
];

const MEASURE_LIBRARY_ERRORS: [string, string, number, number][] = [
  ['COUNTROWS(t.x)', 'COUNTROWS takes a table name only, as in COUNTROWS(TaskDaily).', 11, 12],
  ['RUNNING_TOTAL SUM(t.x)', 'RUNNING_TOTAL needs an opening bracket after it, as in RUNNING_TOTAL(SUM(table.column)).', 0, 13],
  ['RANK(SUM(t.x), 3)', 'RANK takes one calculation, as in RANK(SUM(table.column)).', 13, 14],
  ['MOVING_AVG(SUM(t.x))', 'MOVING_AVG takes a calculation and a number, as in MOVING_AVG(SUM(table.column), 3).', 0, 20],
  ['MOVING_AVG(SUM(t.x), SUM(t.y))', 'MOVING_AVG needs a plain number here, as in MOVING_AVG(SUM(table.column), 3).', 21, 29],
];

function randomLibraryRow(pick: (below: number) => number, depth: number): MeasureNode {
  const choice = pick(depth > 0 ? 6 : 3);
  if (choice === 0) return num((pick(10001) - 5000) / 100);
  if (choice === 1) return col(NAMES[pick(NAMES.length)], NAMES[pick(NAMES.length)]);
  if (choice === 2) return txt(VALUES[pick(VALUES.length)]);
  if (choice === 3) return bin(OPERATORS[pick(4)], randomLibraryRow(pick, depth - 1), randomLibraryRow(pick, depth - 1));
  if (choice === 4) return cmp(COMPARISONS[pick(6)], randomLibraryRow(pick, depth - 1), randomLibraryRow(pick, depth - 1));
  const fns = Object.keys(ROW_FUNCTION_SHAPES) as RowFn[];
  const fn = fns[pick(fns.length)];
  const { fewest, most } = ROW_FUNCTION_SHAPES[fn];
  const parts = fewest + pick(Math.min(most, fewest + 2) - fewest + 1);
  return call(fn, ...Array.from({ length: parts }, () => randomLibraryRow(pick, depth - 1)));
}

const ACROSS: MeasureFn[] = ['percent_of_total', 'running_total', 'change', 'change_pct'];

function randomLibraryMeasure(pick: (below: number) => number, depth: number): MeasureNode {
  const choice = pick(depth > 0 ? 4 : 2);
  if (choice === 0) return num((pick(10001) - 5000) / 100);
  if (choice === 1) {
    const name = () => NAMES[pick(NAMES.length)];
    const where = pick(2) ? when(name(), name(), COMPARISONS[pick(6)], VALUES[pick(VALUES.length)]) : undefined;
    return pick(2) ? rows(name(), where) : agg(FUNCTIONS[pick(6)], name(), name(), where);
  }
  if (choice === 2) return bin(OPERATORS[pick(4)], randomLibraryMeasure(pick, depth - 1), randomLibraryMeasure(pick, depth - 1));
  return across(ACROSS[pick(4)], randomLibraryMeasure(pick, depth - 1));
}

describe('function library formulas', () => {
  it.each(LIBRARY_CANONICAL)('prints %s', (text, tree) => {
    expect(printMeasure(tree)).toBe(text);
  });

  it.each(LIBRARY_CANONICAL)('reads %s back into its tree', (text, tree) => {
    expect(parseRowExpression(text)).toEqual({ ok: true, node: tree });
  });

  it.each(MEASURE_LIBRARY_CANONICAL)('prints the measure %s', (text, tree) => {
    expect(printMeasure(tree)).toBe(text);
  });

  it.each(MEASURE_LIBRARY_CANONICAL)('reads the measure %s back into its tree', (text, tree) => {
    expect(parseMeasure(text)).toEqual({ ok: true, node: tree });
  });

  it.each(LIBRARY_TIDY)('reads %s and prints it canonically', (text, canonical) => {
    const parsed = parseRowExpression(text);
    expect(parsed.ok).toBe(true);
    expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(canonical);
  });

  it.each(MEASURE_TIDY)('reads the measure %s and prints it canonically', (text, canonical) => {
    const parsed = parseMeasure(text);
    expect(parsed.ok).toBe(true);
    expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(canonical);
  });

  it.each(LIBRARY_ERRORS)('refuses %s with a positioned, plain message', (text, message, start, end) => {
    expect(parseRowExpression(text)).toEqual({ ok: false, error: { message, start, end } });
  });

  it.each(MEASURE_LIBRARY_ERRORS)('refuses the measure %s with a positioned, plain message', (text, message, start, end) => {
    expect(parseMeasure(text)).toEqual({ ok: false, error: { message, start, end } });
  });

  it('reads back every printed library formula unchanged, and prints it the same way again', () => {
    const pick = randomNumbers(20260923);
    for (let i = 0; i < 400; i++) {
      const tree = randomLibraryRow(pick, 3);
      const text = printMeasure(tree);
      const parsed = parseRowExpression(text);
      expect(parsed, text).toEqual({ ok: true, node: tree });
      expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(text);
    }
  });

  it('reads back every printed measure with measure functions unchanged', () => {
    const pick = randomNumbers(20260924);
    for (let i = 0; i < 300; i++) {
      const tree = randomLibraryMeasure(pick, 3);
      const text = printMeasure(tree);
      const parsed = parseMeasure(text);
      expect(parsed, text).toEqual({ ok: true, node: tree });
      expect(printMeasure((parsed as { node: MeasureNode }).node)).toBe(text);
    }
  });

  it('reads [Name] on its own as another measure and prints it back bracketed', () => {
    const parsed = parseMeasure('SUM(t.data_hours) / [Task Count]');
    expect(parsed).toEqual({ ok: true, node: { kind: 'bin', op: '/', left: { kind: 'agg', fn: 'sum', arg: { source: 't', column: 'data_hours' } },
      right: { kind: 'ref', measure: 'Task Count' } } });
    if (parsed.ok) expect(printMeasure(parsed.node)).toBe('SUM(t.data_hours) / [Task Count]');
    expect(parseMeasure('COUNTROWS([Task Daily])')).toEqual({ ok: true, node: { kind: 'agg', fn: 'count_rows', arg: { source: 'Task Daily', column: '*' } } });
  });
});

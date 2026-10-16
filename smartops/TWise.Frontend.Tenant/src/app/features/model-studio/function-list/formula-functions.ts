import { AggregateFn, MeasureFn, RowFn } from '../../../core/services/model-studio.service';
import { FUNCTION_NAMES, MEASURE_FUNCTION_NAMES, ROW_FUNCTION_NAMES, ROW_FUNCTION_SHAPES } from '../../../core/utils/measure-syntax.util';

/** row for a calculated column, measure for a measure. */
export type FunctionMode = 'row' | 'measure';

/** One entry of the function list. name is how the function is written; example is inserted as it is. */
export interface FormulaFunction { name: string; category: string; signature: string; description: string; example: string; }

export interface FunctionGroup { category: string; functions: FormulaFunction[]; }

// fn, category, signature, description. The example is the parser's, so messages and the list agree.
const ROW_ENTRIES: [RowFn, string, string, string][] = [
  ['if', 'Logic', 'IF(condition, then, else)', 'One value when the condition holds and another when it does not.'],
  ['and', 'Logic', 'AND(condition, condition, ...)', 'Holds when every condition holds. Takes 2 to 10.'],
  ['or', 'Logic', 'OR(condition, condition, ...)', 'Holds when any condition holds. Takes 2 to 10.'],
  ['not', 'Logic', 'NOT(condition)', 'Holds when the condition does not.'],
  ['isblank', 'Logic', 'ISBLANK(value)', 'Holds when the value is missing, or is empty text.'],
  ['coalesce', 'Logic', 'COALESCE(value, value, ...)', 'The first value that is not blank.'],
  ['isnull', 'Logic', 'ISNULL(value, fallback)', 'The value, or the fallback when the value is blank.'],
  ['iferror', 'Logic', 'IFERROR(value, fallback)',
    'The value, or the fallback when it cannot be worked out, such as a division by zero or text that is not a number.'],
  ['concat', 'Text', 'CONCAT(value, value, ...)', 'Joins 2 to 10 values into one text. A blank value adds nothing.'],
  ['left', 'Text', 'LEFT(text, count)', 'The first count characters, 1 to 4000.'],
  ['right', 'Text', 'RIGHT(text, count)', 'The last count characters, 1 to 4000.'],
  ['upper', 'Text', 'UPPER(text)', 'The text in capitals.'],
  ['lower', 'Text', 'LOWER(text)', 'The text in small letters.'],
  ['trim', 'Text', 'TRIM(text)', 'The text without spaces at either end.'],
  ['len', 'Text', 'LEN(text)', 'The number of characters. Spaces at the end are not counted.'],
  ['replace', 'Text', 'REPLACE(text, find, with)', 'The text with every find replaced by with.'],
  ['substring', 'Text', 'SUBSTRING(text, start, length)', 'length characters from position start, counting from 1. Without length, to the end.'],
  ['split', 'Text', 'SPLIT(text, separator, piece)', 'One piece of the text cut at each separator: 1 to 4, or -1 for the last piece.'],
  ['first_word', 'Text', 'FIRST_WORD(text)', 'The first word.'],
  ['last_word', 'Text', 'LAST_WORD(text)', 'The last word.'],
  ['contains', 'Text', "CONTAINS(text, 'find')", 'Holds when the text contains find.'],
  ['starts_with', 'Text', "STARTS_WITH(text, 'find')", 'Holds when the text starts with find.'],
  ['ends_with', 'Text', "ENDS_WITH(text, 'find')", 'Holds when the text ends with find.'],
  ['to_number', 'Text', 'TO_NUMBER(text)', 'The text as a number, without commas, $, % and spaces. Blank when it is not a number.'],
  ['to_date', 'Text', "TO_DATE(text, 'dmy')",
    "The text as a date written 'iso' (2026-01-31), 'dmy' (31/01/2026) or 'mdy' (01/31/2026). Blank when it is not a date."],
  ['year', 'Date', 'YEAR(date)', 'The year, such as 2026.'],
  ['month', 'Date', 'MONTH(date)', 'The month, 1 to 12.'],
  ['day', 'Date', 'DAY(date)', 'The day of the month, 1 to 31.'],
  ['quarter', 'Date', 'QUARTER(date)', 'The quarter, 1 to 4.'],
  ['weekday', 'Date', 'WEEKDAY(date)', 'The day of the week, 1 for Monday to 7 for Sunday.'],
  ['month_name', 'Date', 'MONTH_NAME(date)', 'The month name, January to December.'],
  ['weekday_name', 'Date', 'WEEKDAY_NAME(date)', 'The day name, Monday to Sunday.'],
  ['month_start', 'Date', 'MONTH_START(date)', 'The first day of the month. A time axis on it sorts in date order.'],
  ['datediff', 'Date', "DATEDIFF(later, earlier, 'unit')",
    "later minus earlier in 'days', 'hours', 'minutes', 'weeks', 'months' or 'years'. Days when the unit is left out."],
  ['today', 'Date', 'TODAY()', "Today's date on the database server."],
  ['round', 'Number', 'ROUND(number, decimals)', 'Rounds to decimals places, -6 to 6. To a whole number when decimals is left out.'],
  ['abs', 'Number', 'ABS(number)', 'The number without its sign.'],
  ['floor', 'Number', 'FLOOR(number)', 'Rounds down to a whole number.'],
  ['ceiling', 'Number', 'CEILING(number)', 'Rounds up to a whole number. CEIL works too.'],
  ['min_of', 'Number', 'MIN_OF(value, value, ...)', 'The smallest of 2 to 10 values of the same row.'],
  ['max_of', 'Number', 'MAX_OF(value, value, ...)', 'The largest of 2 to 10 values of the same row.'],
];

const COMPARISONS: FormulaFunction = {
  name: '= <> > >= < <=', category: 'Logic', signature: 'value > value',
  description: 'Compares two values. 1 when it holds and 0 when it does not, so it can be added up.',
  example: 'TaskDaily.data_hours > 8',
};

export const ROW_LIBRARY: FormulaFunction[] = [
  COMPARISONS,
  ...ROW_ENTRIES.map(([fn, category, signature, description]) => ({
    name: ROW_FUNCTION_NAMES[fn], category, signature, description, example: ROW_FUNCTION_SHAPES[fn].example,
  })),
];

// fn, signature, description, example.
const AGGREGATE_ENTRIES: [AggregateFn, string, string, string][] = [
  ['sum', 'SUM(column)', 'Adds up a number column. WHERE keeps only some rows.', 'SUM(TaskDaily.data_hours)'],
  ['avg', 'AVG(column)', 'The average of a number column.', 'AVG(TaskDaily.data_hours)'],
  ['count', 'COUNT(column)', 'Counts the rows where the column is not blank.',
    "COUNT(TaskDaily.task_daily_id WHERE TaskDaily.task_assignee = 'Unassigned')"],
  ['count_distinct', 'DISTINCTCOUNT(column)', 'Counts the different values of the column.', 'DISTINCTCOUNT(TaskDaily.task_assignee)'],
  ['min', 'MIN(column)', 'The smallest value.', 'MIN(TaskDaily.action_on)'],
  ['max', 'MAX(column)', 'The largest value.', 'MAX(TaskDaily.action_on)'],
  ['count_rows', 'COUNTROWS(table)', 'Counts the rows of a table. WHERE keeps only some rows.', 'COUNTROWS(TaskDaily WHERE TaskDaily.data_hours > 8)'],
];

const MEASURE_ENTRIES: [MeasureFn, string, string, string][] = [
  ['percent_of_total', 'PERCENT_OF_TOTAL(calculation)', "Each row's share of the total of all the rows of the visual, as a percentage.",
    'PERCENT_OF_TOTAL(SUM(TaskDaily.data_hours))'],
  ['running_total', 'RUNNING_TOTAL(calculation)', 'Adds up along the first field of the visual, starting again for each value of the other fields.',
    'RUNNING_TOTAL(COUNTROWS(TaskDaily))'],
  ['change', 'CHANGE(calculation)', 'The difference from the row before, along the first field of the visual.', 'CHANGE(SUM(TaskDaily.data_hours))'],
  ['change_pct', 'CHANGE_PCT(calculation)', 'The difference from the row before as a percentage of it. Blank when the row before is 0.',
    'CHANGE_PCT(SUM(TaskDaily.data_hours))'],
  ['rank', 'RANK(calculation)', 'The place of each row when the rows are ordered by the calculation, highest first. Ties share a place.',
    'RANK(SUM(TaskDaily.data_hours))'],
  ['ytd', 'YTD(calculation)', 'Year to date: adds up along a date field put first on the visual, starting again each calendar year.',
    'YTD(SUM(TaskDaily.data_hours))'],
  ['moving_avg', 'MOVING_AVG(calculation, rows)', 'The average of this row and the rows before it along the first field; rows is 2 to 366.',
    'MOVING_AVG(SUM(TaskDaily.data_hours), 3)'],
  ['threshold', 'THRESHOLD(calculation, amber, green)', 'A score: 100 at or past green, 50 at or past amber, 0 before. Give green below amber when lower is better.',
    'THRESHOLD(SUM(TaskDaily.data_hours), 50, 80)'],
];

export const MEASURE_LIBRARY: FormulaFunction[] = [
  ...AGGREGATE_ENTRIES.map(([fn, signature, description, example]) => ({
    name: FUNCTION_NAMES[fn], category: 'Aggregate', signature, description, example,
  })),
  ...MEASURE_ENTRIES.map(([fn, signature, description, example]) => ({
    name: MEASURE_FUNCTION_NAMES[fn], category: 'Across rows', signature, description, example,
  })),
];

/**
 * The columns an example is written with in this dataset: a table alias and, for each role the examples use,
 * a column of that kind. A role the table has no column for keeps the example's own name.
 */
export interface ExampleColumns { table: string; number?: string; text?: string; date?: string; key?: string; }

// The example columns of the function library, by the role they play.
const EXAMPLE_ROLES: Record<string, keyof Omit<ExampleColumns, 'table'>> = {
  data_hours: 'number', task_code: 'text', task_assignee: 'text', action_on: 'date', task_daily_id: 'key', crew_type_id: 'key',
};

/** The example written against the dataset's own table and columns, so Insert gives a formula that runs. */
export function localizeExample(example: string, columns: ExampleColumns | null): string {
  if (!columns) return example;
  return example
    .replace(/TaskDaily\.(\w+)/g, (_, name: string) => {
      const role = EXAMPLE_ROLES[name];
      return `${columns.table}.${(role && columns[role]) || name}`;
    })
    .replace(/COUNTROWS\(TaskDaily\b/g, `COUNTROWS(${columns.table}`);
}

const CATEGORY_ORDER = ['Logic', 'Text', 'Date', 'Number', 'Aggregate', 'Across rows'];

/** The categories a formula of this kind can use, in the order the list shows them. */
export function functionCategories(mode: FunctionMode): string[] {
  const library = mode === 'row' ? ROW_LIBRARY : MEASURE_LIBRARY;
  return CATEGORY_ORDER.filter(category => library.some(fn => fn.category === category));
}

/**
 * The functions for a formula of this kind whose name or description holds the term, grouped by category in a
 * fixed order; only the one category when it is given.
 */
export function functionGroups(mode: FunctionMode, term: string, category: string | null = null): FunctionGroup[] {
  const find = term.trim().toLowerCase();
  const matching = (mode === 'row' ? ROW_LIBRARY : MEASURE_LIBRARY)
    .filter(fn => !find || fn.name.toLowerCase().includes(find) || fn.description.toLowerCase().includes(find));
  return CATEGORY_ORDER
    .filter(name => !category || name === category)
    .map(name => ({ category: name, functions: matching.filter(fn => fn.category === name) }))
    .filter(group => group.functions.length > 0);
}

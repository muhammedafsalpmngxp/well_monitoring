import { AggregateFn, BinaryOp, ConditionOp, MeasureNode } from '../../../core/services/model-studio.service';
import { FormulaError, numberLiteralProblem, parseMeasure, printMeasure } from '../../../core/utils/measure-syntax.util';
import { aggregateMeasure } from '../model-studio.util';

/** What the formula builder hands to its host on save. */
export interface SavedMeasure { name: string; expression: MeasureNode; }

/** A condition on a column of the part's own table. */
export interface PartCondition { column: string; op: ConditionOp; value: string; }

/** One calculation: fn of source.column, optionally over only the rows that pass a condition. */
export interface FormulaPart { fn: AggregateFn; source: string; column: string; where: PartCondition | null; }

export type Operand = { kind: 'agg'; part: FormulaPart } | { kind: 'num'; value: number | null };

/**
 * What the visual mode edits: one calculation, optionally combined with a second calculation or a number.
 * ponytail: two parts at most, the first always a calculation; any other formula stays in text mode.
 * Add parts when users ask for them.
 */
export interface VisualFormula { left: FormulaPart; op: BinaryOp | null; right: Operand; }

export type Built = { node: MeasureNode } | { problem: string };

const TOO_COMPLEX = 'The visual mode shows one calculation, or two joined by +, -, * or /, with any condition on the same table. '
  + 'Keep editing this formula as text.';

export function emptyPart(source: string): FormulaPart {
  return { fn: 'count', source, column: '', where: null };
}

export function blankFormula(source: string): VisualFormula {
  return { left: emptyPart(source), op: null, right: { kind: 'agg', part: emptyPart(source) } };
}

/** A name and a visual formula to open the builder with, for a new measure. */
export interface FormulaStart { name: string; visual: VisualFormula; }

/** A quick measure: a starting point for the formula builder, completed by choosing columns. */
export interface QuickMeasure { id: string; label: string; name: string; visual: (source: string) => VisualFormula; }

function quick(fn: AggregateFn, op: BinaryOp | null = null, condition = false): (source: string) => VisualFormula {
  return source => ({
    left: { fn, source, column: '', where: condition ? { column: '', op: 'eq', value: '' } : null },
    op,
    right: { kind: 'agg', part: { ...emptyPart(source), fn } },
  });
}

// ponytail: only what the measure tree expresses today. Percent of total and difference from the previous
// period need compiler support (a total over all rows, and ordered rows); add them with it.
export const QUICK_MEASURES: QuickMeasure[] = [
  { id: 'total', label: 'Total of a column', name: 'Total', visual: quick('sum') },
  { id: 'average', label: 'Average of a column', name: 'Average', visual: quick('avg') },
  { id: 'distinct', label: 'Count of different values', name: 'Distinct count', visual: quick('count_distinct') },
  { id: 'count_where', label: 'Count of rows that pass a condition', name: 'Count where', visual: quick('count', null, true) },
  { id: 'ratio', label: 'Ratio of two totals', name: 'Ratio', visual: quick('sum', '/') },
  { id: 'difference', label: 'Difference of two totals', name: 'Difference', visual: quick('sum', '-') },
];

/** Nothing chosen yet. */
export function isBlank(visual: VisualFormula): boolean {
  return !visual.left.column && !visual.op;
}

/** The visual form of a tree, or null when the visual mode cannot show it without changing it. */
export function toVisual(node: MeasureNode): VisualFormula | null {
  const single = partOf(node);
  if (single) return { left: single, op: null, right: { kind: 'agg', part: emptyPart(single.source) } };
  if (node.kind !== 'bin') return null;
  const left = partOf(node.left);
  if (!left) return null;
  if (node.right.kind === 'num') return { left, op: node.op, right: { kind: 'num', value: node.right.value } };
  const right = partOf(node.right);
  return right ? { left, op: node.op, right: { kind: 'agg', part: right } } : null;
}

/** The tree the visual form describes, or what is still missing. */
export function buildVisual(visual: VisualFormula): Built {
  const left = buildPart(visual.left);
  if (typeof left === 'string') return { problem: left };
  if (!visual.op) return { node: left };
  const right = visual.right.kind === 'num' ? buildNumber(visual.right.value) : buildPart(visual.right.part);
  if (typeof right === 'string') return { problem: right };
  return { node: { kind: 'bin', op: visual.op, left, right } };
}

/** Visual to text. Nothing chosen gives empty text; an incomplete formula stays visual, with the reason. */
export function visualToText(visual: VisualFormula): { text: string } | { problem: string } {
  if (isBlank(visual)) return { text: '' };
  const built = buildVisual(visual);
  return 'node' in built ? { text: printMeasure(built.node) } : built;
}

/** Text to visual. Unreadable text, or a formula the visual mode cannot show, stays in text mode. */
export function textToVisual(text: string, source: string): { visual: VisualFormula } | { error: FormulaError } {
  if (!text.trim()) return { visual: blankFormula(source) };
  const parsed = parseMeasure(text);
  if (!parsed.ok) return { error: parsed.error };
  const visual = toVisual(parsed.node);
  return visual ? { visual } : { error: { message: TOO_COMPLEX, start: 0, end: text.length } };
}

function partOf(node: MeasureNode): FormulaPart | null {
  // COUNTROWS has no column to pick, so it stays in the text mode.
  if (node.kind !== 'agg' || node.fn === 'count_rows') return null;
  const where = node.where;
  // The visual mode tests a column of the part's own table, spelled the same way, so nothing changes on the way back.
  if (where && where.column.source !== node.arg.source) return null;
  return {
    fn: node.fn,
    source: node.arg.source,
    column: node.arg.column,
    where: where ? { column: where.column.column, op: where.op, value: where.value } : null,
  };
}

function buildPart(part: FormulaPart): MeasureNode | string {
  if (!part.source || !part.column) return 'Choose a table and a column to calculate.';
  if (!part.where) return aggregateMeasure(part.fn, part.source, part.column);
  if (!part.where.column) return 'Choose the column the condition tests, or untick the condition.';
  return {
    kind: 'agg',
    fn: part.fn,
    arg: { source: part.source, column: part.column },
    where: { column: { source: part.source, column: part.where.column }, op: part.where.op, value: part.where.value },
  };
}

function buildNumber(value: number | null): MeasureNode | string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Enter the number to combine with.';
  // The same limit as typed numbers, so the text mode can always read the number back.
  const problem = numberLiteralProblem(String(Math.abs(value)));
  if (problem) return problem;
  return { kind: 'num', value };
}

/** text with snippet in place of the characters from start to end, and where the caret goes after it. */
export function insertText(text: string, start: number, end: number, snippet: string): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + snippet + text.slice(to), caret: from + snippet.length };
}

import { ConditionOp, MeasureNode } from '../../../core/services/model-studio.service';
import { numberLiteralProblem, printMeasure } from '../../../core/utils/measure-syntax.util';

/** The formula text a builder writes, or why it cannot yet. */
export type Built = { text: string } | { problem: string };

/** Bins of one number column: of equal width, or named ranges between boundaries. Every field is text as typed. */
export interface BinsSpec { column: string; mode: 'width' | 'ranges'; width: string; bounds: string; labels: string; }

/** One rule of a conditional column: when column op value, the column holds result. */
export interface ConditionRule { column: string; op: ConditionOp; value: string; result: string; }

const PLAIN_NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;

/** A number as the formula can hold it, or null. */
function numberOf(written: string): number | null {
  const trimmed = written.trim();
  if (!PLAIN_NUMBER.test(trimmed) || numberLiteralProblem(trimmed.replace(/^-/, ''))) return null;
  return Number(trimmed);
}

function literal(value: string, asNumber: boolean): MeasureNode {
  return asNumber ? { kind: 'num', value: Number(value.trim()) } : { kind: 'text', value };
}

/** Bins of equal width as FLOOR(column / width) * width, or named ranges as IF(column < boundary, label, ...). */
export function binsFormula(source: string, spec: BinsSpec): Built {
  if (!spec.column) return { problem: 'Choose the column to put into bins.' };
  const column: MeasureNode = { kind: 'col', source, column: spec.column };
  if (spec.mode === 'width') {
    const width = numberOf(spec.width);
    if (width === null || width <= 0) return { problem: 'Enter a bin width greater than 0.' };
    const size: MeasureNode = { kind: 'num', value: width };
    return {
      text: printMeasure({
        kind: 'bin', op: '*', left: { kind: 'fn', fn: 'floor', args: [{ kind: 'bin', op: '/', left: column, right: size }] }, right: size,
      }),
    };
  }
  const bounds = spec.bounds.split(',').map(numberOf);
  if (!spec.bounds.trim() || bounds.some(bound => bound === null)) {
    return { problem: 'Enter the boundaries as numbers separated by commas, such as 4, 8.' };
  }
  if (bounds.some((bound, i) => i > 0 && bound! <= bounds[i - 1]!)) return { problem: 'Enter the boundaries from smallest to largest.' };
  const labels = spec.labels.split(',').map(label => label.trim());
  if (labels.length !== bounds.length + 1 || labels.some(label => !label)) {
    return { problem: `Enter ${bounds.length + 1} labels separated by commas: one below each boundary and one above the last.` };
  }
  let node: MeasureNode = { kind: 'text', value: labels[labels.length - 1] };
  for (let i = bounds.length - 1; i >= 0; i--) {
    node = {
      kind: 'fn', fn: 'if',
      args: [{ kind: 'cmp', op: 'lt', left: column, right: { kind: 'num', value: bounds[i]! } }, { kind: 'text', value: labels[i] }, node],
    };
  }
  return { text: printMeasure(node) };
}

/**
 * The rules as IF(rule 1, result 1, IF(rule 2, result 2, ..., otherwise)). A number column is compared with a
 * number when the value is one; any other column with text. The results are numbers when every one is a number,
 * otherwise text, so IF never mixes the two.
 */
export function conditionalFormula(source: string, rules: ConditionRule[], otherwise: string, isNumberColumn: (column: string) => boolean): Built {
  if (!rules.length || rules.some(rule => !rule.column)) return { problem: 'Choose a column for every rule.' };
  const numbers = [...rules.map(rule => rule.result), otherwise].every(result => numberOf(result) !== null);
  let node = literal(otherwise, numbers);
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    const value = literal(rule.value, isNumberColumn(rule.column) && numberOf(rule.value) !== null);
    node = {
      kind: 'fn', fn: 'if',
      args: [{ kind: 'cmp', op: rule.op, left: { kind: 'col', source, column: rule.column }, right: value }, literal(rule.result, numbers), node],
    };
  }
  return { text: printMeasure(node) };
}

import { describe, expect, it } from 'vitest';
import { BinsSpec, binsFormula, conditionalFormula } from './column-builders.util';

const bins = (spec: Partial<BinsSpec>): BinsSpec => ({ column: 'data_hours', mode: 'width', width: '', bounds: '', labels: '', ...spec });
const isNumber = (column: string) => column === 'data_hours';

describe('binsFormula', () => {
  it('writes bins of equal width with FLOOR', () => {
    expect(binsFormula('TaskDaily', bins({ width: '2' }))).toEqual({ text: 'FLOOR(TaskDaily.data_hours / 2) * 2' });
  });

  it('writes named ranges as IF, from the smallest boundary up', () => {
    expect(binsFormula('TaskDaily', bins({ mode: 'ranges', bounds: '4, 8', labels: 'Short, Normal, Long' })))
      .toEqual({ text: "IF(TaskDaily.data_hours < 4, 'Short', IF(TaskDaily.data_hours < 8, 'Normal', 'Long'))" });
  });

  it('says what is missing', () => {
    expect(binsFormula('TaskDaily', bins({ column: '' }))).toEqual({ problem: 'Choose the column to put into bins.' });
    expect(binsFormula('TaskDaily', bins({ width: '0' }))).toEqual({ problem: 'Enter a bin width greater than 0.' });
    expect(binsFormula('TaskDaily', bins({ mode: 'ranges', bounds: 'a, 2', labels: 'x, y, z' })))
      .toEqual({ problem: 'Enter the boundaries as numbers separated by commas, such as 4, 8.' });
    expect(binsFormula('TaskDaily', bins({ mode: 'ranges', bounds: '8, 4', labels: 'x, y, z' })))
      .toEqual({ problem: 'Enter the boundaries from smallest to largest.' });
    expect(binsFormula('TaskDaily', bins({ mode: 'ranges', bounds: '4, 8', labels: 'x, y' })))
      .toEqual({ problem: 'Enter 3 labels separated by commas: one below each boundary and one above the last.' });
  });
});

describe('conditionalFormula', () => {
  it('writes the rules as nested IF, comparing number columns with numbers and the others with text', () => {
    expect(conditionalFormula('TaskDaily', [
      { column: 'data_hours', op: 'gt', value: '8', result: 'Long' },
      { column: 'task_code', op: 'eq', value: '007', result: 'Code' },
    ], 'Other', isNumber)).toEqual({ text: "IF(TaskDaily.data_hours > 8, 'Long', IF(TaskDaily.task_code = '007', 'Code', 'Other'))" });
  });

  it('gives numbers when every result is a number, and needs a column for every rule', () => {
    expect(conditionalFormula('TaskDaily', [{ column: 'task_code', op: 'eq', value: 'A', result: '1' }], '0', isNumber))
      .toEqual({ text: "IF(TaskDaily.task_code = 'A', 1, 0)" });
    expect(conditionalFormula('TaskDaily', [{ column: '', op: 'eq', value: 'A', result: '1' }], '0', isNumber))
      .toEqual({ problem: 'Choose a column for every rule.' });
  });
});

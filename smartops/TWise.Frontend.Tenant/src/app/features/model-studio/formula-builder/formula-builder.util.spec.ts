import { describe, expect, it } from 'vitest';
import { MeasureNode } from '../../../core/services/model-studio.service';
import { QUICK_MEASURES, blankFormula, buildVisual, emptyPart, insertText, textToVisual, toVisual, visualToText } from './formula-builder.util';

const count: MeasureNode = { kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' } };
const hours: MeasureNode = { kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'data_hours' } };
const worked: MeasureNode = {
  kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' },
  where: { column: { source: 'TaskDaily', column: 'data_hours' }, op: 'gt', value: '0' },
};

describe('toVisual', () => {
  it('shows a single calculation, with its condition, as the first part', () => {
    expect(toVisual(worked)).toEqual({
      left: { fn: 'count', source: 'TaskDaily', column: 'task_daily_id', where: { column: 'data_hours', op: 'gt', value: '0' } },
      op: null,
      right: { kind: 'agg', part: emptyPart('TaskDaily') },
    });
  });

  it('shows two calculations, or a calculation and a number, joined by an operator', () => {
    expect(toVisual({ kind: 'bin', op: '/', left: hours, right: worked })).toEqual({
      left: { fn: 'sum', source: 'TaskDaily', column: 'data_hours', where: null },
      op: '/',
      right: { kind: 'agg', part: { fn: 'count', source: 'TaskDaily', column: 'task_daily_id', where: { column: 'data_hours', op: 'gt', value: '0' } } },
    });
    expect(toVisual({ kind: 'bin', op: '*', left: hours, right: { kind: 'num', value: 1.5 } })?.right).toEqual({ kind: 'num', value: 1.5 });
  });

  it('refuses trees it cannot show without changing them', () => {
    const trees: MeasureNode[] = [
      { kind: 'num', value: 8 },
      { kind: 'bin', op: '+', left: { kind: 'bin', op: '*', left: hours, right: { kind: 'num', value: 2 } }, right: count },
      { kind: 'bin', op: '*', left: { kind: 'num', value: 2 }, right: hours },
      {
        kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' },
        where: { column: { source: 'CrewType', column: 'code' }, op: 'eq', value: 'N' },
      },
    ];
    for (const tree of trees) expect(toVisual(tree)).toBeNull();
  });

  it('leaves COUNTROWS to the text mode, which shows it without a column', () => {
    expect(toVisual({ kind: 'agg', fn: 'count_rows', arg: { source: 'TaskDaily', column: '*' } })).toBeNull();
  });
});

describe('buildVisual', () => {
  it('turns every visual form back into the same tree', () => {
    const trees: MeasureNode[] = [
      count,
      worked,
      { kind: 'bin', op: '/', left: hours, right: worked },
      { kind: 'bin', op: '-', left: worked, right: { kind: 'num', value: -2 } },
    ];
    for (const tree of trees) expect(buildVisual(toVisual(tree)!)).toEqual({ node: tree });
  });

  it('names what is still missing', () => {
    const formula = blankFormula('TaskDaily');
    expect(buildVisual(formula)).toEqual({ problem: 'Choose a table and a column to calculate.' });
    formula.left.column = 'task_daily_id';
    formula.left.where = { column: '', op: 'eq', value: '' };
    expect(buildVisual(formula)).toEqual({ problem: 'Choose the column the condition tests, or untick the condition.' });
    formula.left.where = null;
    formula.op = '*';
    formula.right = { kind: 'num', value: null };
    expect(buildVisual(formula)).toEqual({ problem: 'Enter the number to combine with.' });
    formula.right = { kind: 'num', value: 0.0000001 };
    expect(buildVisual(formula)).toEqual({ problem: 'A number can have at most 15 digits, and at most 6 after the decimal point.' });
    formula.right = { kind: 'num', value: 8 };
    expect(buildVisual(formula)).toEqual({ node: { kind: 'bin', op: '*', left: count, right: { kind: 'num', value: 8 } } });
  });
});

describe('switching modes', () => {
  it('moves to text: nothing chosen gives empty text, an incomplete formula stays with the reason, a complete one prints', () => {
    const formula = blankFormula('TaskDaily');
    expect(visualToText(formula)).toEqual({ text: '' });
    formula.op = '/';
    expect(visualToText(formula)).toEqual({ problem: 'Choose a table and a column to calculate.' });
    expect(visualToText(toVisual({ kind: 'bin', op: '/', left: hours, right: worked })!))
      .toEqual({ text: 'SUM(TaskDaily.data_hours) / COUNT(TaskDaily.task_daily_id WHERE TaskDaily.data_hours > 0)' });
  });

  it('moves to visual: empty text gives a blank formula, unreadable or long formulas stay in text', () => {
    expect(textToVisual('  ', 'TaskDaily')).toEqual({ visual: blankFormula('TaskDaily') });
    expect(textToVisual('COUNT(TaskDaily.task_daily_id WHERE TaskDaily.data_hours > 0)', 'CrewType'))
      .toEqual({ visual: toVisual(worked) });
    expect(textToVisual('SUM(t.x', 'TaskDaily')).toEqual({ error: { message: 'A closing bracket ) is missing here.', start: 7, end: 7 } });
    const long = 'SUM(t.x) * 2 + 1';
    expect(textToVisual(long, 'TaskDaily')).toEqual({ error: expect.objectContaining({ start: 0, end: long.length }) });
  });
});

describe('QUICK_MEASURES', () => {
  it('start on the given table with the calculation filled in and the columns left to choose', () => {
    expect(QUICK_MEASURES.map(quick => quick.id)).toEqual(['total', 'average', 'distinct', 'count_where', 'ratio', 'difference']);
    for (const quick of QUICK_MEASURES) {
      const visual = quick.visual('TaskDaily');
      expect(visual.left).toMatchObject({ source: 'TaskDaily', column: '' });
      expect(buildVisual(visual)).toEqual({ problem: 'Choose a table and a column to calculate.' });
    }
    expect(QUICK_MEASURES.find(quick => quick.id === 'count_where')!.visual('A').left.where).toEqual({ column: '', op: 'eq', value: '' });
    expect(QUICK_MEASURES.find(quick => quick.id === 'difference')!.visual('A')).toMatchObject({ op: '-', right: { kind: 'agg', part: { fn: 'sum' } } });
  });
});

describe('insertText', () => {
  it('replaces the selection with the snippet and puts the caret after it', () => {
    expect(insertText('a + b', 4, 5, 'LEN(c)')).toEqual({ text: 'a + LEN(c)', caret: 10 });
    expect(insertText('a + ', 4, 4, 'b')).toEqual({ text: 'a + b', caret: 5 });
  });

  it('keeps the selection inside the text', () => {
    expect(insertText('ab', 5, 9, 'c')).toEqual({ text: 'abc', caret: 3 });
    expect(insertText('ab', 1, 0, 'c')).toEqual({ text: 'acb', caret: 2 });
  });
});

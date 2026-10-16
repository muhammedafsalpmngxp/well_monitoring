import { describe, expect, it } from 'vitest';
import type { DaxMeasureConfig } from './dax-evaluator.util';
import { evaluateDaxMeasure, evaluateDaxMeasureForRow, validateDaxExpression, daxSummaryCells, renameDaxColumn, getActiveDaxMeasures } from './dax-evaluator.util';

describe('DAX evaluator row scope', () => {
  const rows = [
    { code: 10, id: 1 },
    { code: 20, id: 2 },
  ];

  const measure: DaxMeasureConfig = {
    id: 'measure-1',
    name: 'New Metric',
    expression: 'SUM([code], [id])',
    evaluationScope: 'row',
  };

  it('evaluates aggregate functions against the current row only', () => {
    expect(evaluateDaxMeasureForRow(measure, rows[0], rows, ['code', 'id'])).toBe(11);
    expect(evaluateDaxMeasureForRow(measure, rows[1], rows, ['code', 'id'])).toBe(22);
  });

  it('sums row-wise aggregate results for grouped rows', () => {
    expect(evaluateDaxMeasure(measure, rows, ['code', 'id'])).toBe(33);
  });
});
describe('DAX text and date functions', () => {
  const rows = [
    { Code: 'AB-100', Name: '  north  ', Day: '2026-01-15', End: '2026-03-15', Price: '$1,200' },
    { Code: 'CD-200', Name: 'South', Day: '2026-05-02', End: '2026-05-09', Price: '$300' },
  ];
  const run = (expression: string) => evaluateDaxMeasure({ id: 'm', name: 'm', expression }, rows);

  it('evaluates text functions inside aggregates and conditions', () => {
    expect(run('SUM(LEN([Code]))')).toBe(12);
    expect(run('SUM(IF(LEFT([Code], 2) = "AB", 1, 0))')).toBe(1);
    expect(run('SUM(IF(SEARCH("south", [Name]) > 0, 1, 0))')).toBe(1);
    expect(run('SUM(IF(FIND("south", [Name]) > 0, 1, 0))')).toBe(0);
    expect(run('SUM(VALUE(SUBSTITUTE([Price], "$", "")))')).toBe(1500);
    expect(run('SUM(IF(TRIM([Name]) = "north", 1, 0))')).toBe(1);
    expect(run('SUM(LEN(MID([Code], 4, 3)))')).toBe(6);
  });

  it('evaluates date functions', () => {
    expect(run('MAX(YEAR([Day]))')).toBe(2026);
    expect(run('SUM(MONTH([Day]))')).toBe(6);
    expect(run('SUM(QUARTER([Day]))')).toBe(3);
    expect(run('SUM(DATEDIFF([Day], [End], "DAY"))')).toBe(66);
    expect(run('SUM(DATEDIFF([Day], [End], "MONTH"))')).toBe(2);
    expect(run('YEAR(DATE(2025, 12, 31))')).toBe(2025);
    expect(run('DAY(EOMONTH(DATE(2026, 2, 10), 0))')).toBe(28);
  });
});

describe('validateDaxExpression', () => {
  const columns = ['Code', 'Day'];

  it('accepts a valid expression', () => {
    expect(validateDaxExpression('SUM(LEN([Code]))', columns)).toBe('');
  });

  it('reports syntax, unknown function, unknown column, missing arguments and bad units', () => {
    expect(validateDaxExpression('SUM([Code]', columns)).not.toBe('');
    expect(validateDaxExpression('BadExpr(', columns)).toBe('Invalid expression: a closing ")" is missing.');
    expect(validateDaxExpression('SUM([Code]))', columns)).toBe('Invalid expression: there is an extra ")".');
    expect(validateDaxExpression('BadExpr()', columns)).toBe('BADEXPR is not a supported function.');
    expect(validateDaxExpression('SUMM([Code])', columns)).toBe('SUMM is not a supported function.');
    expect(validateDaxExpression('SUM([Nope])', columns)).toBe('Column [Nope] does not exist in this data source.');
    expect(validateDaxExpression('MID([Code], 2)', columns)).toBe('MID needs at least 3 arguments.');
    expect(validateDaxExpression('DATEDIFF([Day], TODAY(), "DECADE")', columns)).toContain('DATEDIFF needs a unit');
  });
});

describe('DAX audit fixes', () => {
  const rows = [{ A: 3, B: 10, Code: 3, Status: 'Closed', D: '2023-06-01' }, { A: 7, B: 0, Code: 5, Status: 'Open', D: '2024-03-01' }];
  const col = (expression: string) => evaluateDaxMeasure({ id: 'm', name: 'm', expression, evaluationScope: 'column' }, rows);
  const row = (expression: string) => evaluateDaxMeasure({ id: 'm', name: 'm', expression, evaluationScope: 'row' }, rows);

  it('parses TRUE() and SWITCH(TRUE(), ...)', () => {
    expect(validateDaxExpression('SWITCH(TRUE(), SUM([A]) >= 10, 3, 1)')).toBe('');
    expect(col('SWITCH(TRUE(), SUM([A]) >= 10, 3, 1)')).toBe(3);
  });

  it('SWITCH matches the test value', () => {
    expect(row('SWITCH([Code], 5, 50, 3, 30, 0)')).toBe(80);
    expect(row('SWITCH([Status], "Open", 1, "Closed", 2, 0)')).toBe(3);
  });

  it('IF with two arguments does not throw', () => {
    expect(col('IF(SUM([A]) > 100, 1)')).toBe(0);
  });

  it('&& and || bind looser than comparisons', () => {
    expect(row('IF([A] > 1 && [B] > 5, 1, 0)')).toBe(1);
    expect(row('IF([B] > 5 || [A] > 5, 1, 0)')).toBe(2);
    expect(row('IF(AND([A] > 1, [B] > 5), 1, 0)')).toBe(1);
  });

  it('compares dates as dates', () => {
    expect(row('IF([D] >= DATE(2024, 1, 1), 1, 0)')).toBe(1);
  });


  it('flags a bare column in Column mode', () => {
    expect(validateDaxExpression('[A] + [B]', ['A', 'B'], 'column')).toContain('must be inside an aggregate');
    expect(validateDaxExpression('SUM([A]) + SUM([B])', ['A', 'B'], 'column')).toBe('');
    expect(validateDaxExpression('[A] + [B]', ['A', 'B'], 'row')).toBe('');
  });

  it('supports ROUND, ABS, ^, quoted table names and escaped quotes', () => {
    expect(col('ROUND(SUM([A]) / 3, 2)')).toBe(3.33);
    expect(col('ABS(-SUM([A]))')).toBe(10);
    expect(col('2 ^ 3')).toBe(8);
    expect(col("SUM('My Table'[A])")).toBe(10);
    expect(validateDaxExpression('IF("a""b" = "x", 1, 0)')).toBe('');
  });

  it('validates PERCENTILE fraction and aggregate arguments', () => {
    expect(validateDaxExpression('PERCENTILE([A], 90)')).toContain('between 0 and 1');
    expect(validateDaxExpression('SUM()')).toBe('SUM needs at least 1 argument.');
  });

  it('STDEV is the sample standard deviation', () => {
    expect(col('STDEV([A])')).toBeCloseTo(2.828, 3);
  });
});

describe('DAX table summary and saved-view helpers', () => {
  const rows = [{ Mobile: 7712, Position: 27 }, { Mobile: 7706, Position: 0 }, { Mobile: null, Position: 29 }];

  it('gives each selected column its own result (DFCT0010494)', () => {
    const measure = { id: 'm', name: 'Count', expression: 'COUNT([Mobile], [Position])', evaluationScope: 'column' as const };
    expect(daxSummaryCells(measure, rows, ['Mobile', 'Position'])).toEqual(['2', '3']);
  });

  it('puts a combined expression under the last referenced column', () => {
    const measure = { id: 'm', name: 'Total', expression: 'SUM([Mobile]) + SUM([Position])', evaluationScope: 'column' as const };
    expect(daxSummaryCells(measure, rows, ['Mobile', 'Position'])).toEqual(['', '15,474']);
  });

  it('renames a column inside a measure', () => {
    const renamed = renameDaxColumn({ id: 'm', name: 'm', expression: 'SUM([Oil]) + SUM([ oil ])', columns: ['Oil'] }, 'Oil', 'Oil Rate');
    expect(renamed.expression).toBe('SUM([Oil Rate]) + SUM([Oil Rate])');
    expect(renamed.columns).toEqual(['Oil Rate']);
  });

  it('hides measures when DAX Model is turned off', () => {
    const measures = [{ id: 'm', name: 'm', expression: 'SUM([Mobile])' }];
    expect(getActiveDaxMeasures({ daxModel: { schemaVersion: 1, enabled: false, measures } })).toEqual([]);
    expect(getActiveDaxMeasures({ daxModel: { schemaVersion: 1, enabled: true, measures } }).length).toBe(1);
  });
});

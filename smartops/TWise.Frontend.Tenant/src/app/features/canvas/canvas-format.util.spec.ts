import { describe, expect, it } from 'vitest';
import { CanvasItem, FormatRule } from './canvas-config.util';
import { LEVEL_COLUMN, canvasGridColumns, displayValue, formatNumber, matrixRows, ruleProblem, ruleTone, skippedFiltersNote, tableRows, tileView } from './canvas-format.util';

describe('formatNumber', () => {
  it('writes numbers plainly by default, or as the object asks', () => {
    expect(formatNumber(73302)).toBe('73,302');
    expect(formatNumber(12.3456)).toBe('12.35');
    expect(formatNumber(1234.5, { style: 'number', decimals: 0 })).toBe('1,235');
    expect(formatNumber(12500, { style: 'compact', decimals: 1 })).toBe('12.5K');
    expect(formatNumber(0.256, { style: 'percent', decimals: 1 })).toBe('25.6%');
    expect(formatNumber(1234.5, { style: 'currency', decimals: 2, currency: 'USD' })).toBe('$1,234.50');
    expect(formatNumber(1234.5, { style: 'currency', decimals: 3, currency: 'OMR' }).replace(/\s/g, ' ')).toBe('OMR 1,234.500');
  });
});

describe('displayValue', () => {
  it('writes ISO dates as dates, with the time only when there is one, and leaves other text alone', () => {
    expect(displayValue('2023-01-09T00:00:00')).toBe('09 Jan 2023');
    expect(displayValue('2023-12-31T23:59:59.997')).toBe('31 Dec 2023 23:59');
    expect(displayValue('2024-02-29T06:30:00Z')).toBe('29 Feb 2024 06:30');
    expect(displayValue('CWL1409')).toBe('CWL1409');
    expect(displayValue('2023-01-09')).toBe('2023-01-09');
    expect(displayValue(42)).toBe('42');
  });
});

describe('ruleTone', () => {
  it('colours a value by the first rule of its field that it meets', () => {
    const rules: FormatRule[] = [
      { field: 'Task Count', op: 'gt', values: ['100'], tone: 'bad' },
      { field: 'Task Count', op: 'between', values: ['50', '100'], tone: 'warn' },
      { field: 'Task Count', op: 'blank', values: [], tone: 'bad' },
      { field: 'CrewType.code', op: 'contains', values: ['w'], tone: 'good' },
      { field: 'CrewType.code', op: 'eq', values: ['RG'], tone: 'warn' },
    ];

    expect(ruleTone(rules, 'Task Count', 120)).toBe('bad');
    expect(ruleTone(rules, 'Task Count', '100')).toBe('warn');
    expect(ruleTone(rules, 'Task Count', 10)).toBeNull();
    expect(ruleTone(rules, 'Task Count', null)).toBe('bad');
    expect(ruleTone(rules, 'CrewType.code', 'WL')).toBe('good');
    expect(ruleTone(rules, 'CrewType.code', 'rg')).toBe('warn');
    expect(ruleTone(rules, 'CrewType.code', null)).toBeNull();
    expect(ruleTone(undefined, 'Task Count', 120)).toBeNull();
  });
});

describe('ruleProblem', () => {
  it('says what a rule still needs', () => {
    const rule = (patch: Partial<FormatRule>): FormatRule => ({ field: 'Task Count', op: 'gt', values: ['10'], tone: 'bad', ...patch });

    expect(ruleProblem(rule({ field: '' }))).toBe('Choose a field.');
    expect(ruleProblem(rule({ values: ['ten'] }))).toBe('Enter a number.');
    expect(ruleProblem(rule({ op: 'between', values: ['1', ''] }))).toBe('Enter two numbers.');
    expect(ruleProblem(rule({ op: 'contains', values: [' '] }))).toBe('Enter a value.');
    expect(ruleProblem(rule({ op: 'blank', values: [] }))).toBe('');
    expect(ruleProblem(rule({}))).toBe('');
  });
});

describe('tileView', () => {
  const card: CanvasItem = { id: 't1', type: 'tile', title: 'Tasks', x: 0, y: 0, cols: 4, rows: 5, datasetId: 7, dimensions: [], measures: ['Task Count'] };

  it('shows the value against its target and the change against its comparison', () => {
    const view = tileView({ ...card, target: 'Task Target', compare: 'Last month' }, { 'Task Count': 900, 'Task Target': 1000, 'Last month': 800 });
    expect(view).toMatchObject({ value: '900', number: 900, target: '1,000', targetNumber: 1000, progress: 90, tone: 'warn' });
    expect(view.delta).toEqual({ text: '▲ 12.5%', up: true, good: true });

    expect(tileView({ ...card, targetValue: 1000 }, { 'Task Count': 1200 })).toMatchObject({ progress: 100, tone: 'good' });
    expect(tileView({ ...card, targetValue: 1000, warnAt: 95 }, { 'Task Count': 900 }).tone).toBe('bad');
    expect(tileView({ ...card, targetValue: 1000, compare: 'Last month', lowerIsBetter: true }, { 'Task Count': 1050, 'Last month': 1200 }))
      .toMatchObject({ tone: 'warn', delta: { text: '▼ 12.5%', up: false, good: true } });
  });

  it('shows what it has when the value, the target or the comparison is missing', () => {
    expect(tileView(card, undefined)).toMatchObject({ value: 'No value', number: null, target: null, progress: null, tone: null, delta: null });
    expect(tileView({ ...card, compare: 'Last month' }, { 'Task Count': 5, 'Last month': 0 }).delta).toBeNull();
    expect(tileView({ ...card, format: { style: 'compact', decimals: 1 } }, { 'Task Count': 73302 })).toMatchObject({ value: '73.3K', full: '73,302' });
    expect(tileView(card, { 'Task Count': 'WL' }).value).toBe('WL');
  });
});

describe('matrixRows', () => {
  it("turns the server's level into grand total, subtotal and detail rows", () => {
    const rows = matrixRows({
      columns: ['CrewType.code', 'TaskDaily.status', 'Task Count', '__level'],
      rows: [
        { 'CrewType.code': null, 'TaskDaily.status': null, 'Task Count': 160, '__level': 3 },
        { 'CrewType.code': 'WL', 'TaskDaily.status': null, 'Task Count': 120, '__level': 1 },
        { 'CrewType.code': 'WL', 'TaskDaily.status': 'Open', 'Task Count': 70, '__level': 0 },
        { 'CrewType.code': 'WL', 'TaskDaily.status': null, 'Task Count': 50, '__level': 0 },
      ],
    }, ['CrewType.code', 'TaskDaily.status']);

    expect(rows.map(row => [row['__kind'], row['CrewType.code'], row['TaskDaily.status'], row['Task Count']])).toEqual([
      ['total', 'Grand total', '', 160],
      ['subtotal', 'WL', 'Total', 120],
      ['detail', 'WL', 'Open', 70],
      ['detail', 'WL', null, 50],
    ]);
    expect(rows[0]).not.toHaveProperty('__level');
  });
});

describe('canvas grids', () => {
  it('names columns as the canvas does, formats measures and marks blank fields', () => {
    const [field, measure] = canvasGridColumns(['w.Region', 'Oil'], new Set(['w.Region']), new Set(['Oil']), { 'w.Region': 'Region' }, undefined);
    expect([field.headerName, measure.headerName, measure.type, field.suppressHeaderMenuButton]).toEqual(['Region', 'Oil', 'rightAligned', true]);
    const fmt = (column: typeof field, value: unknown) => (column.valueFormatter as (p: unknown) => string)({ value });
    expect([fmt(field, null), fmt(measure, 558), fmt(measure, 1234.567)]).toEqual(['(blank)', '558', '1,234.57']);
  });

  it('keeps the detail rows of a table and pins its grand total under them', () => {
    const { rows, total } = tableRows({ columns: ['a.X', 'a.Y', 'N', LEVEL_COLUMN], rows: [
      { 'a.X': 'p', 'a.Y': 'q', N: 1, [LEVEL_COLUMN]: 0 }, { 'a.X': 'p', 'a.Y': null, N: 1, [LEVEL_COLUMN]: 1 }, { 'a.X': null, 'a.Y': null, N: 1, [LEVEL_COLUMN]: 3 },
    ] }, ['a.X', 'a.Y'], 'Total');
    expect(rows).toEqual([{ 'a.X': 'p', 'a.Y': 'q', N: 1 }]);
    expect(total).toEqual({ 'a.X': 'Total', 'a.Y': '', N: 1 });
    expect(tableRows({ columns: ['N'], rows: [{ N: 2 }] }, [], 'Total')).toEqual({ rows: [{ N: 2 }], total: null });
  });
});

describe('skippedFiltersNote', () => {
  it('names the fields a saved view could not be filtered by, by their canvas name or column', () => {
    expect(skippedFiltersNote(['Plant.plant_description', 'Well.cluster'], { 'Well.cluster': 'Cluster' })).toBe('Not filtered by: plant_description, Cluster');
    expect(skippedFiltersNote([])).toBe('');
    expect(skippedFiltersNote(undefined)).toBe('');
  });
});

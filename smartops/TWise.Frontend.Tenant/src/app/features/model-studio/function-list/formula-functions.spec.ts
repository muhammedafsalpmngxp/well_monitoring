import { describe, expect, it } from 'vitest';
import {
  FUNCTION_NAMES, MEASURE_FUNCTION_NAMES, ROW_FUNCTION_NAMES, parseMeasure, parseRowExpression,
} from '../../../core/utils/measure-syntax.util';
import { MEASURE_LIBRARY, ROW_LIBRARY, functionCategories, functionGroups } from './formula-functions';

describe('formula functions', () => {
  it('lists every row function once, after the comparisons', () => {
    expect(ROW_LIBRARY[0].name).toBe('= <> > >= < <=');
    expect(ROW_LIBRARY.slice(1).map(f => f.name).sort()).toEqual(Object.values(ROW_FUNCTION_NAMES).sort());
  });

  it('lists every calculation and measure function once', () => {
    expect(MEASURE_LIBRARY.map(f => f.name).sort())
      .toEqual([...Object.values(FUNCTION_NAMES), ...Object.values(MEASURE_FUNCTION_NAMES)].sort());
  });

  it('gives examples that read as formulas of their kind', () => {
    for (const fn of ROW_LIBRARY) expect(parseRowExpression(fn.example).ok, fn.example).toBe(true);
    for (const fn of MEASURE_LIBRARY) expect(parseMeasure(fn.example).ok, fn.example).toBe(true);
  });

  it('groups by category in a fixed order', () => {
    expect(functionGroups('row', '').map(g => [g.category, g.functions.length]))
      .toEqual([['Logic', 9], ['Text', 17], ['Date', 10], ['Number', 6]]);
    expect(functionGroups('measure', '').map(g => [g.category, g.functions.length])).toEqual([['Aggregate', 7], ['Across rows', 8]]);
  });

  it('finds functions by name or description, ignoring case', () => {
    expect(functionGroups('row', 'WEEKDAY').flatMap(g => g.functions.map(f => f.name))).toEqual(['WEEKDAY', 'WEEKDAY_NAME']);
    expect(functionGroups('row', 'rounds down').flatMap(g => g.functions.map(f => f.name))).toEqual(['FLOOR']);
    expect(functionGroups('row', 'nothing like this')).toEqual([]);
  });

  it('filters to one category and lists the categories each kind of formula can use', () => {
    expect(functionCategories('measure')).toEqual(['Aggregate', 'Across rows']);
    expect(functionGroups('row', '', 'Text').map(g => g.category)).toEqual(['Text']);
    expect(functionGroups('row', 'zzz', 'Text')).toEqual([]);
  });
});

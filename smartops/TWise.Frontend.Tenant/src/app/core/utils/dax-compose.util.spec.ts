import { describe, expect, it } from 'vitest';
import { composeContext, enclosingFunction, expandSnippet } from './dax-compose.util';

describe('composeContext', () => {
  it('reads a function name being typed', () => {
    expect(composeContext('SU', 2)).toEqual({ kind: 'function', prefix: 'SU', start: 0 });
    expect(composeContext('ROUND(AVER', 10)).toEqual({ kind: 'function', prefix: 'AVER', start: 6 });
  });

  it('reads a column after an unclosed bracket', () => {
    expect(composeContext('SUM([Val', 8)).toEqual({ kind: 'column', prefix: 'Val', start: 4 });
    expect(composeContext('SUM([Value]) + ', 15)).toEqual({ kind: 'none' });
  });

  it('offers nothing inside a string literal', () => {
    expect(composeContext('IF(LEFT([Period], 1) = "W', 25)).toEqual({ kind: 'none' });
  });
});

describe('enclosingFunction', () => {
  it('finds the function whose arguments hold the caret', () => {
    expect(enclosingFunction('ROUND(AVERAGE([A]), ', 20)).toBe('ROUND');
    expect(enclosingFunction('ROUND(AVERAGE([A]', 17)).toBe('AVERAGE');
    expect(enclosingFunction('SUM([A]) + 1', 12)).toBeNull();
  });
});

describe('expandSnippet', () => {
  it('brackets column parameters and selects the first one', () => {
    expect(expandSnippet('SUM(${1:ColumnName})$0')).toEqual({ text: 'SUM([ColumnName])', selectStart: 5, selectEnd: 15 });
  });

  it('keeps other parameters plain and quoted units quoted', () => {
    expect(expandSnippet('ROUND(${1:Number}, ${2:NumberOfDigits})$0').text).toBe('ROUND(Number, NumberOfDigits)');
    expect(expandSnippet('DATEDIFF(${1:Date1}, ${2:Date2}, "${3:DAY}")$0').text).toBe('DATEDIFF([Date1], [Date2], "DAY")');
  });

  it('puts the caret inside empty parentheses', () => {
    expect(expandSnippet('COUNTROWS()$0')).toEqual({ text: 'COUNTROWS()', selectStart: 10, selectEnd: 10 });
  });
});

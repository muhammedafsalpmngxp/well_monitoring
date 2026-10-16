import { describe, expect, it } from 'vitest';
import { SuggestField, applySuggestion, matchFields, suggestQuery } from './field-suggest.util';

const field = (table: string, name: string): SuggestField => ({ insert: `${table}.${name}`, table, name, kind: 'number', calculated: false });
const fields = [field('t', 'data_hours'), field('t', 'task_code'), field('t', 'hours_total'), field('c', 'code')];

describe('suggestQuery', () => {
  it('opens on a bracket and narrows on what follows, or on a table alias and a dot', () => {
    expect(suggestQuery('SUM([', 5, ['t', 'c'])).toEqual({ start: 4, term: '', table: null });
    expect(suggestQuery('SUM([hou', 8, ['t', 'c'])).toEqual({ start: 4, term: 'hou', table: null });
    expect(suggestQuery('SUM([t.co', 9, ['t', 'c'])).toEqual({ start: 4, term: 'co', table: 't' });
    expect(suggestQuery('SUM(t.da', 8, ['t', 'c'])).toEqual({ start: 4, term: 'da', table: 't' });
  });

  it('asks for nothing after a closed bracket, inside quotes, or after an unknown alias', () => {
    expect(suggestQuery('SUM([t.x]) ', 11, ['t'])).toBeNull();
    expect(suggestQuery("IF(t.a = '[x", 12, ['t'])).toBeNull();
    expect(suggestQuery('SUM(q.da', 8, ['t'])).toBeNull();
    expect(suggestQuery('3.5', 3, ['t'])).toBeNull();
  });
});

describe('matchFields and applySuggestion', () => {
  it('lists names that start with the term first, then those that contain it, in the asked table', () => {
    expect(matchFields(fields, { start: 0, term: 'hou', table: null }).map(f => f.insert)).toEqual(['t.hours_total', 't.data_hours']);
    expect(matchFields(fields, { start: 0, term: 'co', table: 'c' }).map(f => f.insert)).toEqual(['c.code']);
  });

  it('replaces the bracket and the typed part, and a closing bracket after the caret', () => {
    expect(applySuggestion('SUM([hou])', 8, { start: 4, term: 'hou', table: null }, fields[0]))
      .toEqual({ text: 'SUM(t.data_hours)', caret: 16 });
    expect(applySuggestion('SUM(t.da', 8, { start: 4, term: 'da', table: 't' }, fields[0]))
      .toEqual({ text: 'SUM(t.data_hours', caret: 16 });
  });
});

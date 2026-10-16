import { describe, expect, it } from 'vitest';
import { applyConditionalFilters } from './conditional-filter.util';
import { applyParameterFilters, countJsonPathMatches, getParameterRuleError, getRenamedColumnNames, getTransformationSourceColumns } from './parameter-filter.util';

describe('getTransformationSourceColumns', () => {
  it('makes active renamed columns available to subsequent rules', () => {
    const rules = [
      { id: 1, action: 'rename_column' as const, sourceColumn: 'Status', newColumnName: 'Well Status' },
      { id: 2, action: 'rename_column' as const, sourceColumn: 'Well Status', newColumnName: 'Current Status' },
      { id: 3, action: 'rename_column' as const, sourceColumn: 'Status', newColumnName: 'Disabled', enabled: false },
    ];
    expect(getTransformationSourceColumns(['Status', 'Well'], rules)).toEqual(['Well Status', 'Current Status', 'Status', 'Well']);
    expect(getRenamedColumnNames(rules)).toEqual(['Well Status', 'Current Status']);
    expect(applyParameterFilters([{ Status: 'Active' }], rules, ['Status']).rows[0]['Current Status']).toBe('Active');
  });

  it('exposes each output of a multi-column rename', () => {
    expect(getTransformationSourceColumns(['First', 'Last'], [
      { id: 1, action: 'rename_column', sourceColumns: ['First', 'Last'], newColumnName: '{col}_clean' },
    ])).toEqual(['First_clean', 'Last_clean', 'First', 'Last']);
  });

  it('allows conditional filters to match a renamed column after transformation', () => {
    const transformed = applyParameterFilters(
      [{ Status: 'Active' }, { Status: 'Inactive' }],
      [{ id: 1, action: 'rename_column', sourceColumn: 'Status', newColumnName: 'Well Status' }],
      ['Status'],
    );
    expect(applyConditionalFilters(transformed.rows, [
      { sourceColumn: 'Well Status', operator: 'equals', valueText: 'Active' },
    ])).toEqual([{ 'Well Status': 'Active' }]);
  });
});

describe('applyParameterFilters', () => {
  it('waits for an entered math value but accepts an explicit zero', () => {
    const rows = [{ Amount: 10 }];
    const rule = { id: 1, action: 'math_transform' as const, sourceColumn: 'Amount',
      mathOperator: 'average', newColumnName: 'Average', mathValue: undefined as number | undefined };

    expect(applyParameterFilters(rows, [rule], ['Amount'])).toEqual({ rows, columns: ['Amount'] });
    expect(applyParameterFilters(rows, [{ ...rule, mathValue: null }], ['Amount'])).toEqual({ rows, columns: ['Amount'] });
    expect(applyParameterFilters(rows, [{ ...rule, mathValue: 0 }], ['Amount'])).toEqual({
      rows: [{ Amount: 10, Average: 5 }], columns: ['Amount', 'Average'],
    });
  });

  it('replaces every literal text match regardless of casing', () => {
    const result = applyParameterFilters(
      [{ Account_guid: '367f58ab-D5e4-43ec-D5E4' }],
      [{
        id: 1,
        action: 'text_operation',
        sourceColumn: 'Account_guid',
        textOperation: 'Replace Text',
        findText: 'd5e4',
        replaceText: 'Xml',
      }],
      ['Account_guid'],
    );

    expect(result.rows[0]['Account_guid']).toBe('367f58ab-Xml-43ec-Xml');
  });

  it('leaves text unchanged when the replacement search value is empty', () => {
    const result = applyParameterFilters(
      [{ Name: 'Well A' }],
      [{ id: 1, action: 'text_operation', sourceColumn: 'Name', textOperation: 'Replace Text' }],
      ['Name'],
    );

    expect(result.rows[0]['Name']).toBe('Well A');
  });

  it('concatenates every selected column with optional literal text', () => {
    const result = applyParameterFilters(
      [{ FirstName: 'Ada', LastName: 'Lovelace' }],
      [{
        id: 1,
        action: 'text_operation',
        sourceColumns: ['FirstName', 'LastName'],
        textOperation: 'Concatenate',
        separator: ' ',
        literalText: '(Admin)',
        newColumnName: 'DisplayName',
      }],
      ['FirstName', 'LastName'],
    );

    expect(result.rows[0]['DisplayName']).toBe('Ada Lovelace (Admin)');
  });

  it('pads a numeric value as text to the requested total length', () => {
    const result = applyParameterFilters(
      [{ Crew_id: 84 }],
      [{
        id: 1,
        action: 'text_operation',
        sourceColumn: 'crew_id',
        textOperation: 'Pad',
        padDirection: 'Right',
        textLength: 3,
        padCharacter: '0',
      }],
      ['Crew_id'],
    );

    expect(result.rows[0]['Crew_id']).toBe('840');
  });

  it('extracts a property from JSON array values', () => {
    const result = applyParameterFilters(
      [{ Status: '[{"id":"0924918b-130c-4971-a11e-be9c5f15185b","name":"Well Suspension","value":"Resume"}]' }],
      [{ id: 1, action: 'json_extract', sourceColumn: 'Status', jsonPath: '$.value' }],
      ['Status'],
    );

    expect(result.rows[0]['Status']).toBe('Resume');
  });

  it('extracts a property from a JSON object value', () => {
    const result = applyParameterFilters(
      [{ Step: '{"Purpose_value":"1750.0","Step_type":"LOC"}' }],
      [{ id: 1, action: 'json_extract', sourceColumn: 'Step', jsonPath: '$.Purpose_value' }],
      ['Step'],
    );

    expect(result.rows[0]['Step']).toBe('1750.0');
  });

  it('extracts the first or last N characters through Text Operation', () => {
    const first = applyParameterFilters(
      [{ Account_guid: '367f58ab-D5e4' }],
      [{ id: 1, action: 'text_operation', sourceColumn: 'Account_guid', textOperation: 'First N Chars', textLength: 8 }],
      ['Account_guid'],
    );
    const last = applyParameterFilters(
      [{ Account_guid: '367f58ab-D5e4' }],
      [{ id: 1, action: 'text_operation', sourceColumn: 'Account_guid', textOperation: 'Last N Chars', textLength: 4 }],
      ['Account_guid'],
    );

    expect(first.rows[0]['Account_guid']).toBe('367f58ab');
    expect(last.rows[0]['Account_guid']).toBe('D5e4');
  });

  it('formats dates with abbreviated and full month tokens', () => {
    const format = (dateFormat: string) => applyParameterFilters(
      [{ Date: '2026-01-01' }],
      [{ id: 1, action: 'date_operation', sourceColumn: 'Date', dateOperation: 'Format Date', dateFormat }],
      ['Date'],
    ).rows[0]['Date'];

    expect(format('DD MMM YYYY')).toBe('01 Jan 2026');
    expect(format('MMM DD, YYYY')).toBe('Jan 01, 2026');
    expect(format('MMMM DD, YY')).toBe('January 01, 26');
  });
});

describe('incomplete transformation rules', () => {
  const rows = [{ Qty: 10, Code: 'A-B', Day: '2026-01-15', Other: '2026-01-10' }];

  it('does not split on an empty delimiter', () => {
    const rule = { id: 1, action: 'split_column' as const, sourceColumn: 'Code', delimiter: '' };
    expect(getParameterRuleError(rule)).toBe('Enter the delimiter to split on.');
    expect(applyParameterFilters(rows, [rule]).columns).not.toContain('Code_part_1');
  });

  it('does not multiply by a missing value', () => {
    const rule = { id: 1, action: 'math_transform' as const, sourceColumn: 'Qty', mathOperator: '*', mathValue: null };
    expect(getParameterRuleError(rule)).toBe('Enter the value to apply.');
    expect(applyParameterFilters(rows, [rule]).rows[0]['Qty']).toBe(10);
  });

  it('rejects dividing by 0', () => {
    const rule = { id: 1, action: 'math_transform' as const, sourceColumn: 'Qty', mathOperator: '/', mathValue: 0 };
    expect(getParameterRuleError(rule)).toBe('Cannot divide by zero.');
  });

  it('applies multiplication once a value is entered', () => {
    const rule = { id: 1, action: 'math_transform' as const, sourceColumn: 'Qty', mathOperator: '*', mathValue: 3 };
    expect(getParameterRuleError(rule)).toBeNull();
    expect(applyParameterFilters(rows, [rule]).rows[0]['Qty']).toBe(30);
  });

  it('requires a date operation and its parameters', () => {
    expect(getParameterRuleError({ id: 1, action: 'date_operation', sourceColumn: 'Day', dateOperation: '' })).toBe('Select the date operation.');
    expect(getParameterRuleError({ id: 1, action: 'date_operation', sourceColumn: 'Day', dateOperation: 'Date Difference' })).toBe('Select the column to compare with.');
    expect(getParameterRuleError({ id: 1, action: 'date_operation', sourceColumn: 'Day', dateOperation: 'Date Difference', secondaryColumn: 'Other' })).toBeNull();
  });
});

describe('date operation Add/Subtract Duration', () => {
  const rows = [{ Day: '2026-01-15' }];
  const rule = (dateAmount: number | null) => ({ id: 1, action: 'date_operation' as const, sourceColumn: 'Day', newColumnName: 'Due', dateOperation: 'Add/Subtract Duration', dateUnit: 'Days', dateAmount });

  it('waits for the number of days', () => {
    expect(getParameterRuleError(rule(null))).toBe('Enter the amount to add or subtract.');
    expect(applyParameterFilters(rows, [rule(null)]).rows[0]['Due']).toBeUndefined();
  });

  it('adds and subtracts days', () => {
    expect(applyParameterFilters(rows, [rule(7)]).rows[0]['Due']).toBe('2026-01-22');
    expect(applyParameterFilters(rows, [rule(-7)]).rows[0]['Due']).toBe('2026-01-08');
  });
});

describe('json extraction', () => {
  const rule = (jsonPath: string, newColumnName = '') => ({ id: 1, action: 'json_extract' as const, sourceColumn: 'Details', jsonPath, newColumnName });

  it('reads a key from a JSON column into a new column', () => {
    const rows = [{ Details: '{"count": 5, "active": true}' }, { Details: '{"count": 7}' }];
    const out = applyParameterFilters(rows, [rule('$.count', 'Count')]).rows;
    expect(out.map(r => r['Count'])).toEqual([5, 7]);
  });

  it('matches keys case-insensitively and accepts single-quoted JSON', () => {
    const rows = [{ Details: "{'Count': 3}" }];
    expect(applyParameterFilters(rows, [rule('$.count', 'Count')]).rows[0]['Count']).toBe(3);
  });

  it('does not blank the source column when nothing matches', () => {
    const rows = [{ Details: 3 }, { Details: 0 }];
    expect(applyParameterFilters(rows, [rule('$.active')]).rows.map(r => r['Details'])).toEqual([3, 0]);
    expect(countJsonPathMatches(rows, 'Details', '$.active')).toBe(0);
  });
});

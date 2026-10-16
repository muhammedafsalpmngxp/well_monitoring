import { describe, expect, it } from 'vitest';
import { getViewDateRangeDefaults, replaceViewDateRangeParameters } from './view-date-parameters.util';

describe('view date parameters', () => {
  it('reads a four-month future date relative to a declared start date', () => {
    const sql = `
      DECLARE @start_date DATE = '2026-01-31';
      DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);
    `;

    expect(getViewDateRangeDefaults(sql)).toEqual({
      hasStartDate: true,
      hasEndDate: false,
      hasFutureDate: true,
      fromDate: '2026-01-31',
      toDate: '2026-05-31',
    });
  });

  it('uses today for dynamic start dates and resolves a future date from today', () => {
    const sql = `
      DECLARE @start_date DATE = CAST(GETDATE() AS DATE);
      DECLARE @future_date DATE = DATEADD(MONTH, 4, CAST(GETDATE() AS DATE));
    `;

    expect(getViewDateRangeDefaults(sql, new Date(2026, 9, 7))).toMatchObject({
      fromDate: '2026-10-07',
      toDate: '2027-02-07',
    });
  });

  it('reads the first day of the current year from a DATEFROMPARTS declaration', () => {
    const sql = `
      DECLARE @start_date DATE = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
      DECLARE @future_date DATE = DATEADD(MONTH, 4, CAST(GETDATE() AS DATE));
    `;

    expect(getViewDateRangeDefaults(sql, new Date(2026, 9, 7))).toMatchObject({
      fromDate: '2026-01-01',
      toDate: '2027-02-07',
    });
  });

  it('reads a start date assigned to the most recent Tuesday and calculates future_date from it', () => {
    const sql = `
      DECLARE @start_date DATE;
      SET @start_date = DATEADD (
        DAY,
        -(DATEDIFF(DAY, '19000102', CAST(GETDATE() AS DATE)) % 7),
        CAST(GETDATE() AS DATE)
      );
      DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);
    `;

    expect(getViewDateRangeDefaults(sql, new Date(2026, 9, 7))).toMatchObject({
      fromDate: '2026-10-06',
      toDate: '2027-02-06',
    });
  });

  it('keeps the legacy end-date declaration unless the view declares future_date', () => {
    const sql = "DECLARE @start_date DATE = '2026-01-01'; DECLARE @end_date DATE = '2026-02-01';";
    expect(replaceViewDateRangeParameters(sql, '2026-03-01', '2026-04-01'))
      .toBe("DECLARE @start_date DATE = '2026-03-01'; DECLARE @end_date DATE = '2026-04-01';");
  });

  it('replaces future_date as the global end date when declared', () => {
    const sql = "DECLARE @start_date DATE = '2026-01-01'; DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);";
    expect(replaceViewDateRangeParameters(sql, '2026-02-01', '2026-06-01'))
      .toBe("DECLARE @start_date DATE = '2026-02-01'; DECLARE @future_date DATE = '2026-06-01';");
  });

  it('overrides a later SET assignment instead of only changing the declaration default', () => {
    const sql = `
      DECLARE @start_date DATE;
      SET @start_date = DATEADD(DAY, -1, CAST(GETDATE() AS DATE));
      DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);
    `;
    const updated = replaceViewDateRangeParameters(sql, '2026-10-06', '2027-02-06');

    expect(updated).toContain("SET @start_date = '2026-10-06';");
    expect(updated).toContain("DECLARE @future_date DATE = '2027-02-06';");
    expect(updated).not.toContain('SET @start_date = DATEADD');
  });
});

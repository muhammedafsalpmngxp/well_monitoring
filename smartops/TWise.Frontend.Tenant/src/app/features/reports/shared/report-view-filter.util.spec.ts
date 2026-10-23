import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import type { PreviewViewRequest } from '../../../core/services/common-api.service';
import { applyReportViewParameters, previewReportView } from './report-view-filter.util';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';

describe('report view global filters', () => {
  const sql = `
DECLARE @cluster NVARCHAR(100) = NULL;
DECLARE @plant NVARCHAR(100) = NULL;
DECLARE @start_date DATE = '2026-01-01';
DECLARE @end_date DATE = '2026-10-06';
SELECT SUM(Planned) AS Planned FROM WorkPlan
WHERE (@cluster IS NULL OR Cluster = @cluster)
  AND (@plant IS NULL OR Plant = @plant);`;
  const view = { id: 12, connectionId: 4, viewName: 'Daily_Work_Plan_Report_Summary_View', manualSql: sql, generatedSql: '' };
  const summary = { columns: ['Planned'], rows: [{ Planned: 3 }] };

  it('scopes aggregate queries even when returned rows have no hierarchy columns', async () => {
    const api = { getDatabaseViewById: vi.fn(() => of(view)), previewView: vi.fn((_request: PreviewViewRequest) => of(summary)) };
    const result = await firstValueFrom(previewReportView(api, 12, { cluster: 'Nimr', plant: 'Nimr ODC' }, '2026-09-01', '2026-09-30'));
    expect(result).toEqual(summary);
    const request = api.previewView.mock.calls[0]?.[0];
    expect(request).toMatchObject({ connectionId: 4, viewId: 12, maxRows: 0 });
    expect(request?.sql).toContain("DECLARE @cluster NVARCHAR(100) = N'Nimr';");
    expect(request?.sql).toContain("DECLARE @plant NVARCHAR(100) = N'Nimr ODC';");
    expect(request?.sql).toContain("DECLARE @start_date DATE = '2026-09-01';");
    expect(request?.sql).toContain("DECLARE @end_date DATE = '2026-09-30';");
  });

  it('forwards Advanced Filters for report previews and exports without embedding values in SQL', async () => {
    const api = { getDatabaseViewById: vi.fn(() => of(view)), previewView: vi.fn((_request: PreviewViewRequest) => of(summary)) };
    const advanced = advancedHierarchyFilters({ 'resource-type': ["O'Brien, SubContractor"] });
    await firstValueFrom(previewReportView(api, 12, { cluster: ['Nimr', 'Rima'] }, '', '', advanced));
    const request = api.previewView.mock.calls[0][0];
    expect(request.filters).toEqual([
      expect.objectContaining({ sourceColumn: 'cluster', values: ['Nimr', 'Rima'] }),
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ["O'Brien, SubContractor"] }),
    ]);
    expect(request.sql).not.toContain("O'Brien");
    expect(request.maxRows).toBe(0);

    await firstValueFrom(previewReportView(api, 12, {}, '', '', []));
    expect(api.previewView.mock.calls[1][0].filters).toBeUndefined();
  });

  it('sends multi-select hierarchy values as structured filters, never as SQL scalars', async () => {
    const api = {
      getDatabaseViewById: vi.fn(() => of(view)),
      previewView: vi.fn((_request: PreviewViewRequest) => of(summary)),
    };
    await firstValueFrom(previewReportView(api, 12, { cluster: ['Nimr', 'Rima'] }, '', ''));
    const request = api.previewView.mock.calls[0]?.[0];
    expect(request?.sql).toContain('DECLARE @cluster NVARCHAR(100) = NULL;');
    expect(request?.sql).not.toContain("N'Nimr, Rima'");
    expect(request?.filters).toEqual([{
      sourceTable: 'cluster',
      sourceColumn: 'cluster',
      label: 'cluster',
      controlType: 'MultiSelect',
      value: '',
      values: ['Nimr', 'Rima'],
    }]);
  });

  it('uses fresh filter values and clears stored defaults for All', () => {
    const stored = "DECLARE @cluster VARCHAR(100) = 'Nimr'; DECLARE @plant VARCHAR(100) = 'Nimr ODC';";
    expect(applyReportViewParameters(stored, { cluster: 'Amal', plant: 'All' }, '', ''))
      .toBe("DECLARE @cluster VARCHAR(100) = N'Amal'; DECLARE @plant VARCHAR(100) = NULL;");
    expect(applyReportViewParameters(stored, { cluster: 'All', plant: 'All' }, '', ''))
      .toBe('DECLARE @cluster VARCHAR(100) = NULL; DECLARE @plant VARCHAR(100) = NULL;');
  });

  it('requeries the summary with the changed selection instead of reusing old rows', async () => {
    const api = {
      getDatabaseViewById: vi.fn(() => of(view)),
      previewView: vi.fn((request: PreviewViewRequest) => of({
        columns: ['Planned'],
        rows: [{ Planned: request.sql?.includes("= N'Amal';") ? 7 : 3 }],
      })),
    };
    const nimr = await firstValueFrom(previewReportView(api, 12, { cluster: 'Nimr' }, '', ''));
    const amal = await firstValueFrom(previewReportView(api, 12, { cluster: 'Amal' }, '', ''));
    expect(api.previewView).toHaveBeenCalledTimes(2);
    expect(nimr.rows).toEqual([{ Planned: 3 }]);
    expect(amal.rows).toEqual([{ Planned: 7 }]);
  });

  it('overrides SET assignments and escapes quotes in selected values', () => {
    const stored = "DECLARE @cluster NVARCHAR(100); SET @cluster = 'Nimr'; SELECT @cluster;";
    const updated = applyReportViewParameters(stored, { cluster: "O'Brien $1" }, '', '');
    expect(updated).toContain("DECLARE @cluster NVARCHAR(100) = N'O''Brien $1';");
    expect(updated).toContain("SET @cluster = N'O''Brien $1';");
  });

  it('updates every hierarchy level and the future-date parameter', () => {
    const stored = `
DECLARE @country VARCHAR(100);
DECLARE @sector VARCHAR(100);
DECLARE @business_unit VARCHAR(100);
DECLARE @division VARCHAR(100);
DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);`;
    const updated = applyReportViewParameters(stored, {
      country: 'Oman', sector: 'Construction', businessUnit: 'Energy', division: 'Oilfield',
    }, '', '2027-02-01');
    expect(updated).toContain("DECLARE @country VARCHAR(100) = N'Oman';");
    expect(updated).toContain("DECLARE @sector VARCHAR(100) = N'Construction';");
    expect(updated).toContain("DECLARE @business_unit VARCHAR(100) = N'Energy';");
    expect(updated).toContain("DECLARE @division VARCHAR(100) = N'Oilfield';");
    expect(updated).toContain("DECLARE @future_date DATE = '2027-02-01';");
  });

  it('falls back to generated SQL only when manual SQL is empty', async () => {
    const api = { getDatabaseViewById: vi.fn(() => of({ ...view, manualSql: ' ', generatedSql: sql })), previewView: vi.fn((_request: PreviewViewRequest) => of(summary)) };
    await firstValueFrom(previewReportView(api, 12, { cluster: 'GB' }, '', ''));
    expect(api.previewView.mock.calls[0]?.[0]?.sql).toContain("= N'GB';");
  });

  it('propagates query failures instead of returning successful empty data', async () => {
    const api = { getDatabaseViewById: vi.fn(() => of(view)), previewView: vi.fn(() => throwError(() => new Error('Query failed'))) };
    await expect(firstValueFrom(previewReportView(api, 12, {}, '', ''))).rejects.toThrow('Query failed');
  });

  it('reports a missing SQL definition without issuing a preview', async () => {
    const api = { getDatabaseViewById: vi.fn(() => of({ ...view, manualSql: '', generatedSql: '' })), previewView: vi.fn(() => of(summary)) };
    await expect(firstValueFrom(previewReportView(api, 12, {}, '', ''))).rejects.toThrow('has no SQL definition');
    expect(api.previewView).not.toHaveBeenCalled();
  });

  it('does not issue a preview after a superseded subscription is cancelled', () => {
    const pending = new Subject<typeof view>();
    const api = { getDatabaseViewById: vi.fn(() => pending), previewView: vi.fn(() => of(summary)) };
    const subscription = previewReportView(api, 12, { cluster: 'Nimr' }, '', '').subscribe();
    subscription.unsubscribe();
    pending.next(view);
    expect(api.previewView).not.toHaveBeenCalled();
  });
});

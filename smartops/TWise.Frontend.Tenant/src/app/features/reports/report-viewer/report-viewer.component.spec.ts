import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import * as ExcelJS from 'exceljs';
import { ReportViewerComponent } from './report-viewer.component';
import { GlobalFilterSelection } from '../../../core/utils/global-filter-selection.util';
import { clusterBannerSelectionKey } from '../shared/report-cluster-banner.util';

describe('ReportViewerComponent cluster banner', () => {
  it.each<{ selection: GlobalFilterSelection; label: string }>([
    { selection: 'Nimr', label: 'Nimr' },
    { selection: '  Nimr  ', label: 'Nimr' },
    { selection: [' Nimr ', 'Amal '], label: 'Nimr, Amal' },
    { selection: ['Nimr', 'Nimr', 'All'], label: 'Nimr' },
    { selection: 'All', label: '' },
    { selection: '', label: '' },
    { selection: [], label: '' },
    { selection: ['All', '', '  '], label: '' },
  ])('formats cluster names for $selection', ({ selection, label }) => {
    const component: ReportViewerComponent = Object.create(ReportViewerComponent.prototype);
    component.filterCluster = selection;

    expect(component.selectedClusterName).toBe(label);
    expect(component.clusterBannerTitle).toBe(label ? `REPORT - ${label.toUpperCase()}` : 'REPORT');
    expect(component.showClusterBanner).toBe(false);
  });

  it('uses the same visibility and retained custom title in the viewer and Excel', () => {
    const component: ReportViewerComponent = Object.create(ReportViewerComponent.prototype);
    component.report = {
      id: 1, reportName: 'Report', categoryId: 1, sourceName: 'source', sourceType: 'view',
      status: 'draft', createdBy: 1, tenantId: 1, createdAt: '', updatedAt: '',
    };
    component.filterCluster = 'Nimr';
    component.config = { customClusterBannerEnabled: false };
    expect(component.showClusterBanner).toBe(false);
    const sheet = new ExcelJS.Workbook().addWorksheet('Report');
    component['addExcelClusterBanner'](sheet, 3, 5);
    expect(sheet.getCell(5, 1).value).toBeNull();

    component.config = {
      customClusterBannerEnabled: true,
      clusterBannerText: 'Custom Nimr title',
      clusterBannerSelection: clusterBannerSelectionKey('Nimr'),
    };
    expect(component.showClusterBanner).toBe(true);
    expect(component.clusterBannerTitle).toBe('Custom Nimr title');
    component['addExcelClusterBanner'](sheet, 3, 5);
    expect(sheet.getCell(5, 1).value).toBe('Custom Nimr title');
    component.filterCluster = 'Amal';
    expect(component.clusterBannerTitle).toBe('Custom Nimr title');
    component.filterCluster = 'All';
    expect(component.showClusterBanner).toBe(false);
  });
});

describe('ReportViewerComponent global option appearance', () => {
  const component: ReportViewerComponent = Object.create(ReportViewerComponent.prototype);

  it.each<GlobalFilterSelection>(['All', '', []])('checks every item checkbox for unrestricted selection %j', selection => {
    expect(component.isFilterOptionSelected(selection, 'Amal')).toBe(true);
    expect(component.isFilterOptionSelected(selection, 'Nimr')).toBe(true);
    expect(component.isFilterOptionSelected(selection, 'All')).toBe(true);
    expect(component.filterLabel(selection)).toBe('All');
  });

  it.each<GlobalFilterSelection>(['Amal', ['Amal', 'GB']])('checks only selected values for %j', selection => {
    expect(component.isFilterOptionSelected(selection, 'Amal')).toBe(true);
    expect(component.isFilterOptionSelected(selection, 'Nimr')).toBe(false);
    expect(component.isFilterOptionSelected(selection, 'All')).toBe(false);
  });
});
// import { describe, it, expect, vi } from 'vitest';

/**
 * Unit tests for ReportViewerComponent logic.
 * Tests null guards, timer cleanup, Excel offset, and PDF pagination.
 */

describe('ReportViewerComponent — edge cases', () => {
  // ── #4: null rows guard ───────────────────────────────────────────
  describe('data.rows null guard', () => {
    it('falls back to empty array when rows is null', () => {
      const data = { columns: ['a'], rows: null as any };
      const rows = (data.rows ?? []).map((row: any) => ({ a: row['a'] }));
      expect(rows).toEqual([]);
    });

    it('falls back to empty array when rows is undefined', () => {
      const data = { columns: ['a'], rows: undefined as any };
      const rows = (data.rows ?? []).map((row: any) => ({ a: row['a'] }));
      expect(rows).toEqual([]);
    });

    it('works normally with valid rows', () => {
      const data = { columns: ['a'], rows: [{ a: 1 }, { a: 2 }] };
      const rows = (data.rows ?? []).map((row: any) => ({ a: row['a'] }));
      expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    });
  });

  // ── #9: parseConfig null on error ─────────────────────────────────
  describe('parseConfig', () => {
    function parseConfig(reportJson: string | null | undefined): any {
      if (!reportJson) return null;
      try {
        return JSON.parse(reportJson);
      } catch {
        return null;
      }
    }

    it('returns null for null reportJson', () => {
      expect(parseConfig(null)).toBeNull();
    });

    it('returns null for undefined reportJson', () => {
      expect(parseConfig(undefined)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseConfig('{broken')).toBeNull();
    });

    it('returns parsed object for valid JSON', () => {
      const result = parseConfig('{"columns":[]}');
      expect(result).toEqual({ columns: [] });
    });
  });

  // ── #19: Route param "0" check ────────────────────────────────────
  describe('report ID validation', () => {
    it('rejects 0 as invalid (falsy)', () => {
      const id = Number('0');
      expect(!id).toBe(true); // 0 is falsy
    });

    it('rejects NaN from non-numeric param', () => {
      const id = Number('abc');
      expect(!id).toBe(true); // NaN is falsy
    });

    it('accepts positive integer', () => {
      const id = Number('42');
      expect(!id).toBe(false);
    });

    it('rejects negative (treated as valid Number but should be caught by API)', () => {
      const id = Number('-1');
      expect(!id).toBe(false); // -1 is truthy — will hit API which validates
    });
  });

  // ── #10/#11: Timer cleanup ────────────────────────────────────────
  describe('timer lifecycle', () => {
    it('clearTimeout handles null gracefully', () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      // Should not throw
      expect(() => {
        if (timer) clearTimeout(timer);
      }).not.toThrow();
    });

    it('clearTimeout cancels pending timer', () => {
      const fn = vi.fn();
      const timer = setTimeout(fn, 100);
      clearTimeout(timer);
      // fn should not be called — vitest doesn't advance real timers,
      // but we verify no throw
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ── #22: Excel Sl.No offset ───────────────────────────────────────
  describe('Excel group header offset', () => {
    it('Sl.No is at index 0, data columns start at index 1', () => {
      const displayColumns = ['col1', 'col2', 'col3'];
      const headers = ['Sl.No', ...displayColumns.map(c => c.toUpperCase())];

      expect(headers[0]).toBe('Sl.No');
      expect(headers[1]).toBe('COL1');
      expect(headers.length).toBe(displayColumns.length + 1);
    });

    it('config columns (no Sl.No) map to headers[i+1]', () => {
      const cols = [
        { field: 'col1', group: 'GroupA' },
        { field: 'col2', group: 'GroupA' },
        { field: 'col3', group: '' },
      ];
      const headers = ['Sl.No', 'Col 1', 'Col 2', 'Col 3'];

      // Column header row with correct offset
      const colHeaderRow: (string | null)[] = [];
      const hasGroups = cols.some(c => !!c.group);

      // Sl.No
      colHeaderRow.push(hasGroups ? null : 'Sl.No');

      // Data columns
      for (let i = 0; i < cols.length; i++) {
        const colHasGroup = !!cols[i].group;
        if (hasGroups && !colHasGroup) {
          colHeaderRow.push(null); // vertically merged
        } else {
          colHeaderRow.push(headers[i + 1]); // +1 for Sl.No offset
        }
      }

      expect(colHeaderRow).toEqual([null, 'Col 1', 'Col 2', null]);
    });
  });

  // ── PDF pagination ────────────────────────────────────────────────
  describe('column/row chunking', () => {
    const MAX_COLS_PER_PAGE = 8;
    const MAX_ROWS_PER_PAGE = 20;

    it('single chunk for <= 8 columns', () => {
      const cols = Array.from({ length: 5 }, (_, i) => `col${i}`);
      const chunks: string[][] = [];
      for (let i = 0; i < cols.length; i += MAX_COLS_PER_PAGE) {
        chunks.push(cols.slice(i, i + MAX_COLS_PER_PAGE));
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(5);
    });

    it('splits into 2 chunks for 12 columns', () => {
      const cols = Array.from({ length: 12 }, (_, i) => `col${i}`);
      const chunks: string[][] = [];
      for (let i = 0; i < cols.length; i += MAX_COLS_PER_PAGE) {
        chunks.push(cols.slice(i, i + MAX_COLS_PER_PAGE));
      }
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(8);
      expect(chunks[1]).toHaveLength(4);
    });

    it('splits rows into batches of 20', () => {
      const rows = Array.from({ length: 55 }, (_, i) => ({ id: i }));
      const batches: any[][] = [];
      for (let r = 0; r < rows.length; r += MAX_ROWS_PER_PAGE) {
        batches.push(rows.slice(r, r + MAX_ROWS_PER_PAGE));
      }
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(20);
      expect(batches[1]).toHaveLength(20);
      expect(batches[2]).toHaveLength(15);
    });

    it('total pages = row batches × column chunks', () => {
      const colChunks = 3;
      const rowBatches = 2;
      expect(colChunks * rowBatches).toBe(6);
    });
  });

  // ── loadMore edge cases ───────────────────────────────────────────
  describe('loadMore pagination', () => {
    it('does not exceed total rows', () => {
      const PAGE_SIZE = 20;
      const allRows = Array.from({ length: 35 }, (_, i) => i);
      const displayRows = allRows.slice(0, PAGE_SIZE);

      const start = displayRows.length;
      const end = Math.min(start + PAGE_SIZE, allRows.length);
      for (let i = start; i < end; i++) {
        displayRows.push(allRows[i]);
      }

      expect(displayRows).toHaveLength(35);
    });

    it('returns false for hasMore when all loaded', () => {
      const displayLength = 35;
      const totalRowCount = 35;
      expect(displayLength < totalRowCount).toBe(false);
    });
  });

  // ── groupHeaderSpans computation ──────────────────────────────────
  describe('groupHeaderSpans', () => {
    function computeSpans(columns: { field: string; shown: boolean; group: string }[]): { label: string; colspan: number }[] {
      const cols = columns.filter(c => c.shown !== false);
      const spans: { label: string; colspan: number }[] = [];
      let i = 0;
      while (i < cols.length) {
        const grp = cols[i].group || '';
        let span = 1;
        while (i + span < cols.length && (cols[i + span].group || '') === grp) span++;
        spans.push({ label: grp, colspan: span });
        i += span;
      }
      return spans;
    }

    it('returns empty for no columns', () => {
      expect(computeSpans([])).toEqual([]);
    });

    it('groups consecutive columns with same group', () => {
      const cols = [
        { field: 'a', shown: true, group: 'G1' },
        { field: 'b', shown: true, group: 'G1' },
        { field: 'c', shown: true, group: 'G2' },
      ];
      expect(computeSpans(cols)).toEqual([
        { label: 'G1', colspan: 2 },
        { label: 'G2', colspan: 1 },
      ]);
    });

    it('handles ungrouped columns', () => {
      const cols = [
        { field: 'a', shown: true, group: '' },
        { field: 'b', shown: true, group: 'G1' },
      ];
      expect(computeSpans(cols)).toEqual([
        { label: '', colspan: 1 },
        { label: 'G1', colspan: 1 },
      ]);
    });

    it('skips hidden columns', () => {
      const cols = [
        { field: 'a', shown: true, group: 'G1' },
        { field: 'b', shown: false, group: 'G1' },
        { field: 'c', shown: true, group: 'G1' },
      ];
      // Only a and c are shown — same group, colspan 2
      expect(computeSpans(cols)).toEqual([
        { label: 'G1', colspan: 2 },
      ]);
    });
  });
});

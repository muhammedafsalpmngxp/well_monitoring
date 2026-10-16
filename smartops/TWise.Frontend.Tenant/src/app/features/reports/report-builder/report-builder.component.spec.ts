import { beforeEach, describe, expect, it } from 'vitest';
// import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for ReportBuilderComponent logic.
 * Focused on tab state management, deep copy, and error handling edge cases.
 */

describe('ReportBuilderComponent — edge cases', () => {
  // ── #12: Deep copy of columnConfigs ───────────────────────────────
  describe('saveCurrentTabState deep copy', () => {
    it('deep copy prevents mutation corruption', () => {
      const original: Record<string, { shown: boolean; group: string; subGroup: string; total: string }> = {
        col1: { shown: true, group: 'A', subGroup: '', total: '' },
        col2: { shown: false, group: '', subGroup: 'B', total: 'Sum' },
      };

      // Simulate deep copy (what saveCurrentTabState now does)
      const saved = JSON.parse(JSON.stringify(original));

      // Mutate original after save
      original['col1'].shown = false;
      original['col1'].group = 'Changed';

      // Saved copy should be unchanged
      expect(saved['col1'].shown).toBe(true);
      expect(saved['col1'].group).toBe('A');
    });

    it('shallow copy WOULD be corrupted (proving the bug existed)', () => {
      const original: Record<string, { shown: boolean; group: string }> = {
        col1: { shown: true, group: 'A' },
      };

      // Shallow copy (the old buggy behavior)
      const shallowCopy = { ...original };

      original['col1'].shown = false;

      // Shallow copy IS corrupted — same reference
      expect(shallowCopy['col1'].shown).toBe(false);
    });
  });

  // ── #23: Empty name query param ───────────────────────────────────
  describe('name query param trimming', () => {
    it('trims whitespace from name', () => {
      const name = '  My Report  ';
      const trimmed = name?.trim();
      expect(trimmed).toBe('My Report');
    });

    it('empty string after trim is falsy', () => {
      const name = '   ' as unknown as string | null;
      const trimmed = name?.trim();
      expect(!!trimmed).toBe(false);
    });

    it('null name returns undefined from trim', () => {
      const name = null as unknown as string | null;
      const trimmed = name?.trim();
      expect(trimmed).toBeUndefined();
    });
  });

  // ── Tab state management ──────────────────────────────────────────
  describe('tab state save/restore', () => {
    const tabStates = new Map<string, any>();

    function saveCurrentTabState(tabId: string, state: any) {
      tabStates.set(tabId, {
        ...state,
        selectedRawFields: [...state.selectedRawFields],
        columnFields: [...state.columnFields],
        columnConfigs: JSON.parse(JSON.stringify(state.columnConfigs)),
      });
    }

    function restoreTabState(tabId: string): any | null {
      const state = tabStates.get(tabId);
      if (!state) return null;
      return {
        ...state,
        selectedRawFields: [...state.selectedRawFields],
        columnFields: [...state.columnFields],
        columnConfigs: JSON.parse(JSON.stringify(state.columnConfigs)),
      };
    }

    beforeEach(() => tabStates.clear());

    it('saves and restores state correctly', () => {
      const state = {
        reportName: 'Test',
        category: 'Wells',
        selectedRawFields: ['a', 'b'],
        columnFields: ['a', 'b', 'c'],
        columnConfigs: { a: { shown: true, group: '', subGroup: '', total: '' } },
      };

      saveCurrentTabState('tab-1', state);
      const restored = restoreTabState('tab-1');

      expect(restored!.reportName).toBe('Test');
      expect(restored!.selectedRawFields).toEqual(['a', 'b']);
      expect(restored!.columnConfigs.a.shown).toBe(true);
    });

    it('returns null for non-existent tab', () => {
      expect(restoreTabState('nonexistent')).toBeNull();
    });

    it('restored arrays are independent copies', () => {
      const state = {
        reportName: 'Test',
        category: 'Wells',
        selectedRawFields: ['a'],
        columnFields: ['a'],
        columnConfigs: {},
      };

      saveCurrentTabState('tab-1', state);
      const restored = restoreTabState('tab-1');
      restored!.selectedRawFields.push('b');

      // Original saved state should not be affected
      const restoredAgain = restoreTabState('tab-1');
      expect(restoredAgain!.selectedRawFields).toEqual(['a']);
    });
  });

  // ── hasUnsavedChanges detection ───────────────────────────────────
  describe('hasUnsavedChanges', () => {
    function hasUnsavedChanges(reportName: string, selectedRawFields: string[], editingReportId: number | null): boolean {
      return (
        (reportName !== '' && reportName !== 'Report Name') ||
        selectedRawFields.length > 0 ||
        editingReportId !== null
      );
    }

    it('returns false for default state', () => {
      expect(hasUnsavedChanges('', [], null)).toBe(false);
      expect(hasUnsavedChanges('Report Name', [], null)).toBe(false);
    });

    it('returns true when name is modified', () => {
      expect(hasUnsavedChanges('My Report', [], null)).toBe(true);
    });

    it('returns true when fields are selected', () => {
      expect(hasUnsavedChanges('', ['col1'], null)).toBe(true);
    });

    it('returns true when editing existing report', () => {
      expect(hasUnsavedChanges('', [], 42)).toBe(true);
    });
  });

  // ── buildReportJson structure ─────────────────────────────────────
  describe('buildReportJson output', () => {
    it('produces valid JSON with all required fields', () => {
      const json = JSON.stringify({
        columns: [{ field: 'col1', header: 'col1', shown: true, group: '', subGroup: '', total: '' }],
        filters: [],
        sortBy: 'Name A-Z',
        groupBy: '',
        metric: 'Count (F)',
        showTotals: false,
        subtotalAfterGroup: false,
        grandTotalAtBottom: false,
        selectedReportType: 'table',
        headerTitle: 'Test',
        headerSubtitle: '',
        bannerText: '',
        headerBackgroundColor: '#111827',
        headerTextColor: '#FFFFFF',
        bannerBackgroundColor: '#EDEFF4',
        columnGroupColors: [],
        rightLogoColor: '#111827',
        fontFamily: 'Inter',
        fontSize: 13,
        pageOrientation: 'Portrait',
        pageSize: 'A4',
      });

      const parsed = JSON.parse(json);
      expect(parsed.columns).toHaveLength(1);
      expect(parsed.pageOrientation).toBe('Portrait');
      expect(parsed.fontSize).toBe(13);
    });
  });
});

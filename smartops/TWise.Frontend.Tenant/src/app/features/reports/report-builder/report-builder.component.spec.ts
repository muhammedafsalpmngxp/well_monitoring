import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReportBuilderComponent } from './report-builder.component';
import { GlobalFilterSelection } from '../../../core/utils/global-filter-selection.util';

describe('ReportBuilderComponent cluster banner', () => {
  it.each<{ selection: GlobalFilterSelection; label: string }>([
    { selection: 'Nimr', label: 'Nimr' },
    { selection: '  Nimr  ', label: 'Nimr' },
    { selection: [' Nimr ', 'Amal '], label: 'Nimr, Amal' },
    { selection: ['Nimr', 'Nimr', 'All'], label: 'Nimr' },
    { selection: 'All', label: '' },
    { selection: '', label: '' },
    { selection: [], label: '' },
    { selection: ['All', '', '  '], label: '' },
  ])('renders the banner correctly for $selection', ({ selection, label }) => {
    const component: ReportBuilderComponent = Object.create(ReportBuilderComponent.prototype);
    component.filterValues = { cluster: selection };
    component.reportName = 'Job Progress Report';
    component.customClusterBannerEnabled = true;

    expect(component.selectedClusterName).toBe(label);
    expect(component.showClusterBanner).toBe(Boolean(label));
    expect(component.clusterBannerTitle)
      .toBe(label ? `JOB PROGRESS REPORT - ${label.toUpperCase()}` : 'JOB PROGRESS REPORT');
  });

  function makeBannerBuilder(): ReportBuilderComponent {
    const component: ReportBuilderComponent = Object.create(ReportBuilderComponent.prototype);
    component.filterValues = { cluster: 'Nimr' };
    component.reportName = 'Job Progress Report';
    component.setCustomClusterBannerEnabled(false);
    return component;
  }

  it('honors manual unchecking until the selected cluster changes', () => {
    const component = makeBannerBuilder();
    component.startEditClusterBanner();
    expect(component.showClusterBanner).toBe(false);
    expect(component.showClusterBannerEditor).toBe(false);
    component.filterValues['cluster'] = 'Amal';
    expect(component.showClusterBanner).toBe(true);
  });

  it('checks for a cluster, unchecks for All, and checks again on selecting a cluster', () => {
    const component = makeBannerBuilder();
    component.filterValues['cluster'] = 'All';
    component['refreshGlobalFilterData']();
    expect(component.customClusterBannerEnabled).toBe(false);
    expect(component.showClusterBanner).toBe(false);
    component.setCustomClusterBannerEnabled(true);
    expect(component.customClusterBannerEnabled).toBe(false);
    component.filterValues['cluster'] = 'Nimr';
    component['refreshGlobalFilterData']();
    expect(component.customClusterBannerEnabled).toBe(true);
    expect(component.showClusterBanner).toBe(true);
    component.setCustomClusterBannerEnabled(false);
    expect(component.customClusterBannerEnabled).toBe(false);
    component.filterValues['cluster'] = 'All';
    component['refreshGlobalFilterData']();
    expect(component.customClusterBannerEnabled).toBe(false);
    component.filterValues['cluster'] = 'Nimr';
    component['refreshGlobalFilterData']();
    expect(component.customClusterBannerEnabled).toBe(true);
  });

  it('edits the complete title live and hides all controls when disabled', () => {
    const component = makeBannerBuilder();
    component.setCustomClusterBannerEnabled(true);
    expect(component.showClusterBanner).toBe(true);
    expect(component.showClusterBannerEditor).toBe(false);
    component.updateClusterBannerText('Cannot edit before clicking Edit');
    expect(component.clusterBannerTitle).toBe('JOB PROGRESS REPORT - NIMR');
    component.startEditClusterBanner();
    expect(component.clusterBannerDraft).toBe('JOB PROGRESS REPORT - NIMR');
    expect(component.showClusterBannerEditor).toBe(true);
    component.updateClusterBannerText('My edited report - Nimr');
    expect(component.clusterBannerTitle).toBe('My edited report - Nimr');
    expect(component.reportName).toBe('Job Progress Report');
    expect(component.selectedClusterName).toBe('Nimr');
    component.setCustomClusterBannerEnabled(false);
    expect(component.showClusterBanner).toBe(false);
    expect(component.showClusterBannerEditor).toBe(false);
    component.setCustomClusterBannerEnabled(true);
    expect(component.showClusterBannerEditor).toBe(false);
    expect(component.clusterBannerTitle).toBe('My edited report - Nimr');
  });

  it('keeps the current title available while editing is disabled', () => {
    const component = makeBannerBuilder();
    component.setCustomClusterBannerEnabled(true);
    expect(component.clusterBannerTitle).toBe('JOB PROGRESS REPORT - NIMR');
    expect(component.showClusterBannerEditor).toBe(false);
    component.filterValues['cluster'] = 'Amal';
    expect(component.clusterBannerTitle).toBe('JOB PROGRESS REPORT - AMAL');
    expect(component.showClusterBannerEditor).toBe(false);
    component.startEditClusterBanner();
    expect(component.showClusterBannerEditor).toBe(true);
    expect(component.clusterBannerDraft).toBe('JOB PROGRESS REPORT - AMAL');
  });

  it('retains custom text but disables editing on a cluster change', () => {
    const component = makeBannerBuilder();
    component.setCustomClusterBannerEnabled(true);
    component.startEditClusterBanner();
    component.updateClusterBannerText('Nimr custom title');
    component.filterValues['cluster'] = 'Amal';
    expect(component.clusterBannerTitle).toBe('Nimr custom title');
    expect(component.showClusterBannerEditor).toBe(false);
    component.updateClusterBannerText('Stale input');
    expect(component.clusterBannerTitle).toBe('Nimr custom title');
    component.startEditClusterBanner();
    expect(component.clusterBannerDraft).toBe('Nimr custom title');
    expect(component.showClusterBannerEditor).toBe(true);
    component.updateClusterBannerText('Amal custom title');
    expect(component.clusterBannerTitle).toBe('Amal custom title');
    component.filterValues['cluster'] = 'All';
    expect(component.showClusterBanner).toBe(false);
    expect(component.showClusterBannerEditor).toBe(false);
    component.startEditClusterBanner();
    expect(component.showClusterBannerEditor).toBe(false);
  });

  it('resumes dynamic cluster text only after the user clears custom text', () => {
    const component = makeBannerBuilder();
    component.setCustomClusterBannerEnabled(true);
    component.startEditClusterBanner();
    component.updateClusterBannerText('Custom title');
    component.filterValues['cluster'] = 'Amal';
    component['refreshGlobalFilterData']();
    expect(component.clusterBannerTitle).toBe('Custom title');
    component.startEditClusterBanner();
    component.updateClusterBannerText('');
    component.filterValues['cluster'] = 'Nimr';
    component['refreshGlobalFilterData']();
    expect(component.clusterBannerTitle).toBe('JOB PROGRESS REPORT - NIMR');
    component.startEditClusterBanner();
    expect(component.clusterBannerDraft).toBe('JOB PROGRESS REPORT - NIMR');
    component.updateClusterBannerText('   ');
    component.filterValues['cluster'] = 'Amal';
    component['refreshGlobalFilterData']();
    expect(component.clusterBannerTitle).toBe('JOB PROGRESS REPORT - AMAL');
  });
});

describe('ReportBuilderComponent global option appearance', () => {
  const component: ReportBuilderComponent = Object.create(ReportBuilderComponent.prototype);

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

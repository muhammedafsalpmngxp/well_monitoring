import { describe, expect, it } from 'vitest';
import { CustomDashboardFilter, mergeDashboardSharedFilters } from './dashboard-shared-filter.util';

const shared: CustomDashboardFilter = {
  id: 'Plants::Plant_description', label: 'Plant', sourceTable: 'Plants',
  sourceColumn: 'Plant_description', value: 'Amal',
};
const local = {
  label: 'Plant', sourceTable: 'plants', sourceColumn: 'plant_description',
  controlType: 'Dropdown', value: 'Nimr', locked: false,
};

describe('mergeDashboardSharedFilters', () => {
  it('overrides matching unlocked selections without mutating chart-local state', () => {
    expect(mergeDashboardSharedFilters([local], [shared])).toEqual([{ ...local, value: 'Amal' }]);
    expect(local.value).toBe('Nimr');
  });

  it('does not filter charts with a different source or column', () => {
    const unrelated = [{ ...local, sourceTable: 'Other' }, { ...local, sourceColumn: 'Cluster' }];
    expect(mergeDashboardSharedFilters(unrelated, [shared])).toEqual(unrelated);
  });

  it('restores the chart-local selection when the shared selection is All or removed', () => {
    expect(mergeDashboardSharedFilters([local], [{ ...shared, value: 'All' }])[0]).toBe(local);
    expect(mergeDashboardSharedFilters([local], [])[0]).toBe(local);
  });

  it('preserves locked filters and non-dropdown controls', () => {
    const filters = [{ ...local, locked: true }, { ...local, controlType: 'MultiSelect' }];
    expect(mergeDashboardSharedFilters(filters, [shared])).toEqual(filters);
  });

  it('applies multiple shared selections in chart filter order', () => {
    const region = { ...local, sourceColumn: 'Region', value: '' };
    expect(mergeDashboardSharedFilters([local, region], [
      { ...shared, id: 'Plants::Region', sourceColumn: 'Region', value: 'North' }, shared,
    ]).map(filter => filter.value)).toEqual(['Amal', 'North']);
  });

  const createAdditional = (filter: CustomDashboardFilter) => ({
    label: filter.label, sourceTable: filter.sourceTable, sourceColumn: filter.sourceColumn,
    controlType: 'Dropdown', value: filter.value, locked: false, dashboardAdditional: true,
  });

  it('appends active additional fields for cross filtering without requiring a local filter', () => {
    expect(mergeDashboardSharedFilters([], [{ ...shared, additional: true }], createAdditional))
      .toEqual([createAdditional(shared)]);
  });

  it('does not append ordinary promoted filters or additional filters set to All', () => {
    expect(mergeDashboardSharedFilters([], [shared, { ...shared, additional: true, value: 'All' }], createAdditional))
      .toEqual([]);
  });

  it('marks matching additional fields without adding duplicates', () => {
    expect(mergeDashboardSharedFilters([local], [{ ...shared, additional: true }], createAdditional))
      .toEqual([{ ...local, value: 'Amal', dashboardAdditional: true }]);
  });

  it('does not append an additional filter over a locked or non-dropdown matching field', () => {
    for (const filter of [{ ...local, locked: true }, { ...local, controlType: 'MultiSelect' }]) {
      expect(mergeDashboardSharedFilters([filter], [{ ...shared, additional: true }], createAdditional))
        .toEqual([filter]);
    }
  });
});

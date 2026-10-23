import { describe, expect, it } from 'vitest';
import { advancedHierarchyFilters } from './advanced-hierarchy-filter.util';

describe('advancedHierarchyFilters', () => {
  it('builds source-column filters without needing or mutating chart-local controls', () => {
    const hierarchy = { 'resource-type': ['SubContractor'], 'cluster-heads': ['Head A', 'Head B'] };
    expect(advancedHierarchyFilters(hierarchy)).toEqual([
      expect.objectContaining({ advancedHierarchy: 'cluster-heads', sourceColumn: 'ClusterManager', values: ['Head A', 'Head B'] }),
      expect.objectContaining({ advancedHierarchy: 'resource-type', sourceColumn: 'resource_type', values: ['SubContractor'] }),
    ]);
    expect(hierarchy['resource-type']).toEqual(['SubContractor']);
  });

  it('clears filters and ignores empty or unknown fields', () => {
    expect(advancedHierarchyFilters({ nationality: [], arbitrary: ['value'] })).toEqual([]);
  });

  it('deduplicates selections without changing punctuation in values', () => {
    expect(advancedHierarchyFilters({ 'cluster-heads': [' Head A ', 'Head A', "O'Brien, Jr.", ''] })[0].values)
      .toEqual(['Head A', "O'Brien, Jr."]);
  });
});

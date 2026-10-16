import { describe, expect, it } from 'vitest';
// import { describe, it, expect, vi } from 'vitest';

/**
 * Unit tests for StandardReportsComponent logic.
 * Tests sort, formatRelativeTime, and category trigger edge cases.
 */

describe('StandardReportsComponent — edge cases', () => {
  // ── #16: formatRelativeTime NaN guard ─────────────────────────────
  describe('formatRelativeTime', () => {
    function formatRelativeTime(iso: string | null | undefined): string {
      if (!iso) return '—';
      const date = new Date(iso);
      if (isNaN(date.getTime())) return '—';
      const diff = Date.now() - date.getTime();
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }

    it('returns "—" for null', () => expect(formatRelativeTime(null)).toBe('—'));
    it('returns "—" for undefined', () => expect(formatRelativeTime(undefined)).toBe('—'));
    it('returns "—" for empty string', () => expect(formatRelativeTime('')).toBe('—'));
    it('returns "—" for garbage input', () => expect(formatRelativeTime('xyz')).toBe('—'));
    it('returns "just now" for Date.now()', () => expect(formatRelativeTime(new Date().toISOString())).toBe('just now'));
  });

  // ── #14: Newest/oldest sort with modifiedDate ─────────────────────
  describe('newest/oldest sort by modifiedDate', () => {
    const reports = [
      { title: 'Old', modifiedDate: '2024-01-01T00:00:00Z' },
      { title: 'New', modifiedDate: '2026-07-20T00:00:00Z' },
      { title: 'Mid', modifiedDate: '2025-06-15T00:00:00Z' },
    ];

    it('sorts newest first by ISO date string comparison', () => {
      const sorted = [...reports].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
      expect(sorted[0].title).toBe('New');
      expect(sorted[1].title).toBe('Mid');
      expect(sorted[2].title).toBe('Old');
    });

    it('sorts oldest first by ISO date string comparison', () => {
      const sorted = [...reports].sort((a, b) => (a.modifiedDate || '').localeCompare(b.modifiedDate || ''));
      expect(sorted[0].title).toBe('Old');
      expect(sorted[1].title).toBe('Mid');
      expect(sorted[2].title).toBe('New');
    });

    it('handles empty modifiedDate gracefully', () => {
      const withEmpty = [...reports, { title: 'NoDate', modifiedDate: '' }];
      const sorted = [...withEmpty].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
      // Empty string sorts last in descending
      expect(sorted[sorted.length - 1].title).toBe('NoDate');
    });
  });

  // ── #21: Category trigger text ────────────────────────────────────
  describe('category trigger display', () => {
    function categoryTriggerText(categoryFilter: string): string {
      return categoryFilter === 'all' ? 'All Category' : categoryFilter;
    }

    it('shows "All Category" when filter is "all"', () => {
      expect(categoryTriggerText('all')).toBe('All Category');
    });

    it('shows actual category name when selected', () => {
      expect(categoryTriggerText('Wells')).toBe('Wells');
    });

    it('shows category name for any non-all value', () => {
      expect(categoryTriggerText('Crew')).toBe('Crew');
    });
  });

  // ── visibleGroups with sort ───────────────────────────────────────
  describe('visibleGroups', () => {
    const groups = [
      {
        id: 'cat-0', label: 'Wells', icon: 'wells', expanded: true,
        reports: [
          { id: '1', title: 'A Report', category: 'Wells', favorite: true, recentlyViewed: false, modifiedDate: '2026-01-01' },
          { id: '2', title: 'B Report', category: 'Wells', favorite: false, recentlyViewed: true, modifiedDate: '2026-07-01' },
        ],
      },
    ];

    function visibleGroups(activeTab: string, categoryFilter: string, searchTerm: string, sortOption: string) {
      const term = searchTerm.trim().toLowerCase();
      return groups
        .map(group => {
          let reports = group.reports
            .filter((r: any) => activeTab === 'all' || (activeTab === 'favorites' ? r.favorite : r.recentlyViewed))
            .filter((r: any) => categoryFilter === 'all' || r.category === categoryFilter)
            .filter((r: any) => !term || r.title.toLowerCase().includes(term));
          if (sortOption === 'name-az') reports = [...reports].sort((a, b) => a.title.localeCompare(b.title));
          else if (sortOption === 'name-za') reports = [...reports].sort((a, b) => b.title.localeCompare(a.title));
          else if (sortOption === 'newest') reports = [...reports].sort((a: any, b: any) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
          else if (sortOption === 'oldest') reports = [...reports].sort((a: any, b: any) => (a.modifiedDate || '').localeCompare(b.modifiedDate || ''));
          return { ...group, reports };
        })
        .filter(group => group.reports.length > 0);
    }

    it('favorites tab filters correctly', () => {
      const result = visibleGroups('favorites', 'all', '', 'default');
      expect(result[0].reports).toHaveLength(1);
      expect(result[0].reports[0].id).toBe('1');
    });

    it('recent tab filters correctly', () => {
      const result = visibleGroups('recent', 'all', '', 'default');
      expect(result[0].reports).toHaveLength(1);
      expect(result[0].reports[0].id).toBe('2');
    });

    it('newest sort orders by modifiedDate desc', () => {
      const result = visibleGroups('all', 'all', '', 'newest');
      expect(result[0].reports[0].title).toBe('B Report');
    });

    it('oldest sort orders by modifiedDate asc', () => {
      const result = visibleGroups('all', 'all', '', 'oldest');
      expect(result[0].reports[0].title).toBe('A Report');
    });
  });
});

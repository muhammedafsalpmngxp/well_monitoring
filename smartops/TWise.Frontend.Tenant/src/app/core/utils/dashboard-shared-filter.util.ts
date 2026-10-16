export interface CustomDashboardFilter {
  id: string;
  label: string;
  sourceTable: string;
  sourceColumn: string;
  value: string;
  additional?: boolean;
}

export interface DashboardChartFilter {
  label?: string;
  sourceTable: string;
  sourceColumn: string;
  controlType: string;
  value: string;
  locked?: boolean;
  dashboardAdditional?: boolean;
}

/** Shared selections override unlocked local selections only on the same source field. */
export function mergeDashboardSharedFilters<T extends DashboardChartFilter>(
  localFilters: T[],
  sharedFilters: CustomDashboardFilter[],
  createAdditionalFilter?: (filter: CustomDashboardFilter) => T,
): T[] {
  const matches = (left: DashboardChartFilter, right: CustomDashboardFilter) =>
    left.sourceTable.trim().toLowerCase() === right.sourceTable.trim().toLowerCase() &&
    left.sourceColumn.trim().toLowerCase() === right.sourceColumn.trim().toLowerCase();
  const merged = localFilters.map(filter => {
    if (filter.locked || filter.controlType !== 'Dropdown') return filter;
    const shared = sharedFilters.find(candidate =>
      matches(filter, candidate) &&
      candidate.value && candidate.value !== 'All');
    return shared ? { ...filter, value: shared.value,
      ...(shared.additional ? { dashboardAdditional: true } : {}) } : filter;
  });
  if (createAdditionalFilter) {
    for (const shared of sharedFilters) {
      if (!shared.additional || !shared.value || shared.value === 'All' ||
          localFilters.some(filter => matches(filter, shared))) continue;
      merged.push(createAdditionalFilter(shared));
    }
  }
  return merged;
}

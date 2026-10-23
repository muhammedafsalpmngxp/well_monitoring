export interface CustomDashboardFilter {
  id: string;
  label: string;
  sourceTable: string;
  sourceColumn: string;
  value: GlobalFilterSelection;
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
  values?: string[];
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
      hasGlobalSelection(candidate.value));
    return shared ? { ...filter, ...globalSelectionPayload(shared.value),
      ...(shared.additional ? { dashboardAdditional: true } : {}) } : filter;
  });
  if (createAdditionalFilter) {
    for (const shared of sharedFilters) {
      if (!shared.additional || !hasGlobalSelection(shared.value) ||
          localFilters.some(filter => matches(filter, shared))) continue;
      merged.push(createAdditionalFilter(shared));
    }
  }
  return merged;
}
import { GlobalFilterSelection, globalSelectionPayload, hasGlobalSelection } from './global-filter-selection.util';

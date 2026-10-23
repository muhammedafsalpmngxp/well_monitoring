import { GlobalFilterSelection, globalSelectionValues } from './global-filter-selection.util';

/** A best-effort global filter sent to the filtered-chart-data endpoint for a Table source. */
export interface TableGlobalFilter {
  sourceTable: string;
  sourceColumn: string;
  controlType: string;
  value: string;
  values?: string[];
  label: string;
  optional: boolean;
}

/**
 * Global Cluster/Plant selections as best-effort cross-table filters for a Table source. The backend
 * joins them in via the source table's FK path (well_master.cluster_code -> ref.cluster, etc.) and
 * matches the name column; a table with no FK to cluster/plant is left unfiltered (optional=true).
 * Only Cluster and Plant have a table relationship — the other hierarchy levels are intentionally omitted.
 * Multi-select selections are sent as a MultiSelect filter (backend matches with IN).
 */
export function tableClusterPlantFilters(cluster?: GlobalFilterSelection, plant?: GlobalFilterSelection): TableGlobalFilter[] {
  const out: TableGlobalFilter[] = [];
  const add = (sourceTable: string, sourceColumn: string, label: string, selection?: GlobalFilterSelection): void => {
    const values = globalSelectionValues(selection);
    if (!values.length) return;
    out.push(values.length > 1
      ? { sourceTable, sourceColumn, controlType: 'MultiSelect', value: '', values, label, optional: true }
      : { sourceTable, sourceColumn, controlType: 'Dropdown', value: values[0], label, optional: true });
  };
  add('cluster', 'cluster_name', 'cluster', cluster);
  add('plant_description', 'plant_description', 'plant', plant);
  return out;
}

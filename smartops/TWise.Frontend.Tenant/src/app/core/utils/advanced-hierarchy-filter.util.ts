import type { WidgetDataFilter } from '../services/widget.service';

const HIERARCHY_COLUMNS: Record<string, string> = {
  'ceo-sector-head': 'CEO',
  'bu-head': 'ExecutiveVicePresident',
  'division-head': 'ProjectDirectorName',
  'cluster-heads': 'ClusterManager',
  'plant-project-head': 'SiteManagerA',
  nationality: 'nationality',
  'resource-type': 'resource_type',
  'position-category': 'position_category',
  'subcontractor-company': 'companyId',
};

const HIERARCHY_COLUMN_ALIASES: Record<string, string[]> = {
  'ceo-sector-head': ['sectorhead', 'ceosectorhead', 'chiefexecutiveofficer'],
  'bu-head': ['buhead', 'businessunithead', 'executivevicepresident', 'evp'],
  'division-head': ['divisionhead', 'projectdirector', 'projectdirectorname'],
  'cluster-heads': ['clusterheads', 'clusterhead', 'clustermanager'],
  'plant-project-head': ['plantprojecthead', 'planthead', 'projecthead', 'sitemanager', 'sitemanagera', 'sitemanagerb'],
  'resource-type': ['resource', 'resourcetype', 'atnmsc'],
  'position-category': ['positioncategory'],
  'subcontractor-company': ['subcontractorcompany', 'subcontractorcompanyid', 'companyid'],
};

export function advancedHierarchySourceColumn(field: string): string | undefined {
  return HIERARCHY_COLUMNS[field];
}

export function advancedHierarchySourceColumns(field: string): string[] {
  const column = HIERARCHY_COLUMNS[field];
  return column ? [column, ...(HIERARCHY_COLUMN_ALIASES[field] ?? [])] : [];
}

/** The server matches these fields to actual view SQL columns before aggregation. */
export function advancedHierarchyFilters(hierarchy: Record<string, string[]>): (WidgetDataFilter & { label: string })[] {
  return Object.entries(HIERARCHY_COLUMNS).flatMap(([field, column]) => {
    const values = [...new Set((hierarchy[field] ?? []).map(value => value.trim()).filter(Boolean))];
    return values.length ? [{
      sourceTable: 'advanced_hierarchy',
      sourceColumn: column,
      label: column,
      advancedHierarchy: field,
      controlType: 'MultiSelect',
      value: '',
      values,
    }] : [];
  });
}

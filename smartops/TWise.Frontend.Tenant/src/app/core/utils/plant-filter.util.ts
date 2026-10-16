export function isPlantFilter(filter: { label?: string; sourceColumn?: string }): boolean {
  const column = (filter.sourceColumn ?? '').replace(/[\s_\-\[\]]/g, '').toLowerCase().split('.').pop();
  return filter.label?.trim().toLowerCase() === 'plant' || column === 'plant' || column === 'plantdescription';
}

export function inferPlantFilter(source: string, columns: string[] = [], sql = '') {
  const executableSql = sql.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
  const sourceColumn = /DECLARE\s+@plant\s/i.test(executableSql) && (executableSql.match(/@plant\b/gi)?.length ?? 0) > 1
    ? 'plant'
    : columns.find(column => isPlantFilter({ sourceColumn: column }));
  return sourceColumn ? { label: 'Plant', controlType: 'Dropdown', sourceTable: source, sourceColumn } : null;
}
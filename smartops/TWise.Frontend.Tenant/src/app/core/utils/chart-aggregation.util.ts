const OPERATIONS = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'];

export function aggregateChartRows(
  rows: readonly Record<string, unknown>[],
  xAxis: string,
  operation: string,
  valueColumn: string,
): { categories: string[]; values: number[] } {
  const isOperation = OPERATIONS.includes(operation);
  const column = valueColumn || (isOperation || operation === 'None' ? '' : operation);
  if (!xAxis || (!column && operation !== 'Count (F)' && operation !== 'Count Distinct (F)')) {
    return { categories: [], values: [] };
  }
  const groups = new Map<string, { count: number; nonEmpty: number; distinct: Set<string>; numbers: number[] }>();
  for (const row of rows) {
    const rawKey = row[xAxis];
    const key = rawKey != null && typeof rawKey !== 'object' ? String(rawKey) : '(empty)';
    let group = groups.get(key);
    if (!group) {
      group = { count: 0, nonEmpty: 0, distinct: new Set(), numbers: [] };
      groups.set(key, group);
    }
    group.count++;
    if (column) {
      const raw = row[column];
      if (raw != null && raw !== '') {
        group.nonEmpty++;
        group.distinct.add(String(raw));
      }
      const number = Number(raw ?? 0);
      group.numbers.push(Number.isNaN(number) ? 0 : number);
    }
  }
  const categories: string[] = [];
  const values: number[] = [];
  for (const [category, group] of groups) {
    categories.push(category);
    switch (operation) {
      case 'Count (F)': values.push(column ? group.nonEmpty : group.count); break;
      case 'Count Distinct (F)': values.push(column ? group.distinct.size : group.count); break;
      case 'Sum (F)': values.push(group.numbers.reduce((sum, value) => sum + value, 0)); break;
      case 'Average (F)': values.push(group.numbers.reduce((sum, value) => sum + value, 0) / group.numbers.length); break;
      case 'Min (F)': values.push(Math.min(...group.numbers)); break;
      case 'Max (F)': values.push(Math.max(...group.numbers)); break;
      // None plots the first source value per category; it must not silently become SUM in a viewer.
      default: values.push(group.numbers[0] ?? 0); break;
    }
  }
  return { categories: categories.slice(0, 100), values: values.slice(0, 100) };
}

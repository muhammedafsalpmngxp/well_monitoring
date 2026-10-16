export const CONDITIONAL_FILTER_OPERATORS = [
  'contains',
  'starts with',
  'ends with',
  'equals',
  'greater than',
  'less than',
] as const;

export type ConditionalFilterOperator = (typeof CONDITIONAL_FILTER_OPERATORS)[number];

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function compareNumeric(cell: string, values: string[], keepGreater: boolean): boolean {
  const cellNumber = Number(cell);
  const bounds = values.map(Number).filter(Number.isFinite);
  if (!Number.isFinite(cellNumber) || !bounds.length) {
    // fall back to lexicographic comparison so non-numeric columns still behave predictably
    const bound = values[0] ?? '';
    return keepGreater ? cell.localeCompare(bound) > 0 : cell.localeCompare(bound) < 0;
  }
  const bound = keepGreater ? Math.min(...bounds) : Math.max(...bounds);
  return keepGreater ? cellNumber > bound : cellNumber < bound;
}

/** True when a single cell satisfies the operator against the selected values. */
export function matchesConditionalFilter(cellValue: unknown, operator: string, values: string[]): boolean {
  if (!values.length) return true;
  const cell = toText(cellValue);
  const lowered = cell.toLowerCase();
  const selected = values.map(v => v.toLowerCase());
  switch (operator) {
    case 'contains': return selected.some(v => lowered.includes(v));
    case 'does not contain': return !selected.some(v => lowered.includes(v));
    case 'starts with': return selected.some(v => lowered.startsWith(v));
    case 'ends with': return selected.some(v => lowered.endsWith(v));
    case 'not equal': return !selected.includes(lowered);
    case 'greater than': return compareNumeric(cell, values, true);
    case 'less than': return compareNumeric(cell, values, false);
    default: return selected.includes(lowered);
  }
}

export interface SavedConditionalFilter {
  id?: number;
  label?: string;
  sourceTable?: string;
  sourceColumn: string;
  operator?: string;
  valueText?: string;
  mode?: string;
  values?: string[];
  hidden?: boolean;
}

export function getSavedConditionalFilters(design: Record<string, unknown> | null | undefined): SavedConditionalFilter[] {
  const saved = design?.['conditionalFilters'] as SavedConditionalFilter[] | undefined;
  if (!Array.isArray(saved)) return [];
  return saved.filter(f => !!f?.sourceColumn && (f.valueText?.trim() || (f.values?.length ?? 0) > 0));
}

/**
 * Applies saved conditional filters to rows. Picked values scope the data first, then the typed
 * condition is evaluated within that scope; Include/Exclude inverts the condition result.
 */
export function applyConditionalFilters(
  rows: Record<string, unknown>[],
  filters: SavedConditionalFilter[],
): Record<string, unknown>[] {
  let out = rows;
  for (const filter of filters) {
    const typed = filter.valueText?.trim();
    const selected = filter.values ?? [];
    if (!typed && !selected.length) continue;

    const column = resolveColumn(out[0], filter.sourceColumn);
    const operator = filter.operator || 'equals';
    const exclude = filter.mode === 'Exclude';

    if (selected.length && typed) {
      const scope = new Set(selected.map(v => v.toLowerCase()));
      out = out.filter(row => scope.has(toText(row[column]).toLowerCase()));
    }
    const values = typed ? [typed] : selected;
    out = out.filter(row => matchesConditionalFilter(row[column], operator, values) !== exclude);
  }
  return out;
}

function resolveColumn(sample: Record<string, unknown> | undefined, column: string): string {
  if (!sample || column in sample) return column;
  return Object.keys(sample).find(key => key.toLowerCase() === column.toLowerCase()) ?? column;
}

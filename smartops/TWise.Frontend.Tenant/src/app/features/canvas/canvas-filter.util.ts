import { QueryFilter } from '../../core/services/model-studio.service';

export type FieldKind = 'number' | 'date' | 'text';

/** Advanced conditions of the Filters pane, as Power BI offers them per kind of field. */
export type FilterOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'before' | 'after' | 'last_days' | 'last_months' | 'last_years'
  | 'blank' | 'not_blank';

/**
 * A filter of the Filters pane on a visual, a sheet or the whole canvas. Basic: the ticked values (all when none),
 * or every value but them when exclude is set. Advanced: one condition, or two joined with And or Or. Top N: the
 * field's N values that rank highest or lowest by a measure. Values are kept as text, the way the query takes them;
 * dates are written 2026-01-31.
 */
export interface CanvasFilter {
  field: string;
  kind: FieldKind;
  mode: 'basic' | 'advanced' | 'top';
  values: string[];
  exclude?: boolean;
  op?: FilterOp;
  value?: string;
  value2?: string;
  /** Advanced filtering: a second condition, joined to the first with And or Or. */
  second?: { join: 'and' | 'or'; op: FilterOp; value?: string; value2?: string };
  /**
   * Top N: the field's N values with the highest (top) or lowest (bottom) measure. With fn, measure is a numeric
   * field ("alias.column") and the values rank by its sum, average, minimum or maximum.
   */
  top?: { direction: 'top' | 'bottom'; count: number; measure: string; fn?: TopFn };
}

export type TopFn = 'sum' | 'avg' | 'min' | 'max';
export const TOP_FNS: Record<TopFn, string> = { sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' };

export const MAX_FILTERS = 20;
const MAX_VALUES = 500;

export const OP_LABELS: Record<FilterOp, string> = {
  eq: 'is', neq: 'is not', gt: 'is greater than', gte: 'is greater than or equal to', lt: 'is less than',
  lte: 'is less than or equal to', between: 'is between', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', ends_with: 'ends with', before: 'is before', after: 'is after', last_days: 'is in the last (days)',
  last_months: 'is in the last (months)', last_years: 'is in the last (years)', blank: 'is blank', not_blank: 'is not blank',
};

const OPS_BY_KIND: Record<FieldKind, FilterOp[]> = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'blank', 'not_blank'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'blank', 'not_blank'],
  date: ['eq', 'before', 'after', 'between', 'last_days', 'last_months', 'last_years', 'blank', 'not_blank'],
};

export function opsFor(kind: FieldKind): FilterOp[] { return OPS_BY_KIND[kind]; }

/** How many values the condition takes: none, one, or a from and a to. */
export function valueCount(op: FilterOp | undefined): 0 | 1 | 2 {
  if (op === 'blank' || op === 'not_blank') return 0;
  return op === 'between' ? 2 : 1;
}

export function newFilter(field: string, kind: FieldKind): CanvasFilter {
  return { field, kind, mode: 'basic', values: [] };
}

/** The field's column name, without its table alias. */
export function fieldLabel(field: string): string {
  return field.slice(field.indexOf('.') + 1);
}

/** The date a relative condition starts from, as 2026-01-31: today less n days, months or years. */
export function relativeStart(op: 'last_days' | 'last_months' | 'last_years', n: number, today = new Date()): string {
  let d: Date;
  if (op === 'last_days') d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  else {
    // 31 March less one month is 28 or 29 February, not 3 March: the day is kept within the month.
    const month = today.getMonth() - (op === 'last_months' ? n : 12 * n);
    const lastDay = new Date(today.getFullYear(), month + 1, 0).getDate();
    d = new Date(today.getFullYear(), month, Math.min(today.getDate(), lastDay));
  }
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The query filters of one pane filter; none while it filters nothing (no value ticked, a condition not filled in).
 * Two advanced conditions joined with Or become one any filter; with And, two filters.
 */
export function filterQuery(filter: CanvasFilter, today = new Date()): QueryFilter[] {
  const field = filter.field;
  if (filter.mode === 'basic') {
    if (!filter.values.length) return [];
    return [{ field, op: filter.exclude ? 'not_in' : 'in', values: filter.values }];
  }
  if (filter.mode === 'top') {
    const top = filter.top;
    return top && top.measure && Number.isInteger(top.count) && top.count > 0
      ? [{ field, op: top.direction, values: top.fn ? [String(top.count), top.measure, top.fn] : [String(top.count), top.measure] }] : [];
  }
  const first = conditionQuery(field, filter.op, filter.value, filter.value2, today);
  const second = filter.second ? conditionQuery(field, filter.second.op, filter.second.value, filter.second.value2, today) : [];
  if (filter.second?.join === 'or' && first.length && second.length) return [{ field, op: 'any', any: [...first, ...second] }];
  return [...first, ...second];
}

function conditionQuery(field: string, op: FilterOp | undefined, value: string | undefined, value2: string | undefined, today: Date): QueryFilter[] {
  const a = value?.trim() ?? '';
  const b = value2?.trim() ?? '';
  switch (op) {
    case undefined:
      return [];
    case 'blank':
      return [{ field, op: 'is_null' }];
    case 'not_blank':
      return [{ field, op: 'not_null' }];
    case 'between':
      if (a && b) return [{ field, op: 'between', values: [a, b] }];
      if (a) return [{ field, op: 'gte', values: [a] }];
      return b ? [{ field, op: 'lte', values: [b] }] : [];
    case 'before':
      return a ? [{ field, op: 'lt', values: [a] }] : [];
    case 'after':
      return a ? [{ field, op: 'gt', values: [a] }] : [];
    case 'last_days':
    case 'last_months':
    case 'last_years': {
      const n = Number(a);
      return a && Number.isInteger(n) && n > 0 ? [{ field, op: 'gte', values: [relativeStart(op, n, today)] }] : [];
    }
    default:
      return a ? [{ field, op, values: [a] }] : [];
  }
}

/** What the filter keeps, in a few words: "is (All)", "is North, South", "is greater than 5". */
export function filterSummary(filter: CanvasFilter, display: (value: string) => string = v => v): string {
  if (filter.mode === 'top') {
    const top = filter.top!;
    const by = top.fn ? `${TOP_FNS[top.fn]} of ${fieldLabel(top.measure)}` : top.measure;
    return filterQuery(filter).length ? `${top.direction === 'top' ? 'Top' : 'Bottom'} ${top.count} by ${by}` : 'is (All)';
  }
  if (filter.mode === 'basic') {
    if (!filter.values.length) return 'is (All)';
    const shown = filter.values.slice(0, 3).map(display).join(', ') + (filter.values.length > 3 ? ` and ${filter.values.length - 3} more` : '');
    return `${filter.exclude ? 'is not' : 'is'} ${shown}`;
  }
  if (!filter.op || !filterQuery(filter).length) return 'is (All)';
  const count = valueCount(filter.op);
  if (count === 0) return OP_LABELS[filter.op];
  if (filter.op.startsWith('last_')) return `is in the last ${filter.value} ${filter.op.slice(5)}`;
  const one = count === 2 ? `${OP_LABELS[filter.op]} ${filter.value || '...'} and ${filter.value2 || '...'}` : `${OP_LABELS[filter.op]} ${filter.value}`;
  const second = filter.second;
  if (!second || !conditionQuery(filter.field, second.op, second.value, second.value2, new Date()).length) return one;
  const two = valueCount(second.op) === 0 ? OP_LABELS[second.op] : `${OP_LABELS[second.op]} ${second.value ?? ''}`;
  return `${one} ${second.join} ${two}`;
}

/** Every filter of the list that filters something, as query filters. */
export function filtersQuery(filters: CanvasFilter[] | undefined, today = new Date()): QueryFilter[] {
  return (filters ?? []).flatMap(filter => filterQuery(filter, today));
}

/** A saved filter list, with every filter checked for its shape; null when it is not a list. */
export function readFilters(value: unknown): CanvasFilter[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isFilter).slice(0, MAX_FILTERS);
}

export function isFilterList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_FILTERS && value.every(isFilter);
}

function isFilter(filter: CanvasFilter): boolean {
  const text = (v: unknown) => v === undefined || typeof v === 'string';
  return typeof filter === 'object' && filter !== null && typeof filter.field === 'string' && filter.field.includes('.')
    && (filter.kind === 'number' || filter.kind === 'date' || filter.kind === 'text')
    && (filter.mode === 'basic' || filter.mode === 'advanced' || filter.mode === 'top')
    && Array.isArray(filter.values) && filter.values.length <= MAX_VALUES && filter.values.every(v => typeof v === 'string')
    && (filter.exclude === undefined || typeof filter.exclude === 'boolean')
    && (filter.op === undefined || filter.op in OP_LABELS)
    && text(filter.value) && text(filter.value2)
    && (filter.second === undefined || (typeof filter.second === 'object' && filter.second !== null
      && (filter.second.join === 'and' || filter.second.join === 'or') && filter.second.op in OP_LABELS
      && text(filter.second.value) && text(filter.second.value2)))
    && (filter.top === undefined || (typeof filter.top === 'object' && filter.top !== null
      && (filter.top.direction === 'top' || filter.top.direction === 'bottom')
      && Number.isInteger(filter.top.count) && filter.top.count > 0 && filter.top.count <= 1000 && typeof filter.top.measure === 'string'
      && (filter.top.fn === undefined || filter.top.fn in TOP_FNS)));
}

import { ConditionalFilterOperator } from './conditional-filter.util';

/** Mirrors ReportFilter on the server. */
export interface ReportFilter {
  field: string;
  operator: string;
  values: string[];
  connector: string;
  sourceTable?: string | null;
}

/** Mirrors TopNSpec on the server. */
export interface TopNSpec {
  direction: 'top' | 'bottom';
  count: number;
  orderBy: string;
}

/**
 * Conditional-filter operators that have a server-side equivalent, and their inverse for
 * Exclude mode. An operator with no inverse is left to the client-side pass.
 */
const OPERATOR_MAP: Record<ConditionalFilterOperator, { include: string; exclude?: string }> = {
  'contains':         { include: 'contains',   exclude: 'notcontains' },
  'starts with':      { include: 'startswith' },
  'ends with':        { include: 'endswith' },
  'equals':           { include: 'eq',  exclude: 'neq' },
  'greater than':     { include: 'gt',  exclude: 'lte' },
  'less than':        { include: 'lt',  exclude: 'gte' },
};

/**
 * A conditional filter with its values ALREADY resolved by the caller. The builder composes
 * them from valueText plus the picked multi-values, and this must use exactly the same list —
 * a different one would filter server-side rows the browser would have kept.
 */
interface ResolvedConditionalFilter {
  sourceColumn: string;
  sourceTable?: string;
  operator: string;
  mode?: string;
  values: string[];
}

/**
 * Translates the builder's conditional filters into server-side report filters.
 *
 * Conditional filters are also applied in the browser, but only to rows already fetched — and the
 * chart-data endpoint caps that at 1000 rows, so a filter could silently search just the first
 * page. Sending them to the server as well pushes the predicate into SQL, where it sees every row.
 *
 * Running both is deliberate and safe: the predicates are equivalent, so applying one after the
 * other changes nothing. A filter that cannot be expressed server-side is simply omitted here and
 * still handled in the browser, so behaviour never regresses.
 */
export function toReportFilters(filters: readonly ResolvedConditionalFilter[]): ReportFilter[] {
  const out: ReportFilter[] = [];

  for (const filter of filters ?? []) {
    if (!filter?.sourceColumn) continue;

    const mapping = OPERATOR_MAP[filter.operator as ConditionalFilterOperator];
    if (!mapping) continue;

    const isExclude = (filter.mode ?? '').trim().toLowerCase() === 'exclude';
    const operator = isExclude ? mapping.exclude : mapping.include;
    if (!operator) continue;   // no server-side inverse; leave it to the client-side pass

    const values = (filter.values ?? []).filter(v => (v ?? '').trim().length > 0);
    if (!values.length) continue;

    out.push({
      field: filter.sourceColumn,
      operator,
      values,
      connector: 'and',
      sourceTable: filter.sourceTable || null,
    });
  }

  return out;
}

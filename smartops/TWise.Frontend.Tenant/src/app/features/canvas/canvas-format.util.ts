import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { QueryResult } from '../../core/services/model-studio.service';
import { CanvasItem, FormatRule, NumberFormat, RuleTone } from './canvas-config.util';

/** The server's totals column (QueryCompiler.LevelColumn) and the row kind matrixRows puts in its place. */
export const LEVEL_COLUMN = '__level';
export const MATRIX_KIND = '__kind';
export type MatrixRowKind = 'total' | 'subtotal' | 'detail';

const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const formatters = new Map<string, Intl.NumberFormat>();

/** A number as the object asks (P10-8): grouped with up to two decimals when it asks nothing. */
export function formatNumber(value: number, format?: NumberFormat): string {
  if (!format) return PLAIN.format(value);
  const key = `${format.style}|${format.decimals}|${format.currency ?? ''}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const digits = { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals };
    formatter = new Intl.NumberFormat('en-US',
      format.style === 'compact' ? { notation: 'compact', maximumFractionDigits: format.decimals }
        : format.style === 'percent' ? { style: 'percent', ...digits }
          : format.style === 'currency' ? { style: 'currency', currency: format.currency ?? 'OMR', ...digits }
            : digits);
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A field value as a person reads it. The API sends dates as ISO text, so a date shows as "09 Jan 2023", and
 * with its time only when it has one. Read as written, never shifted to the browser's time zone.
 */
export function displayValue(value: unknown): string {
  const text = String(value);
  const match = ISO_DATE_TIME.exec(text);
  if (!match) return text;
  const [, year, month, day, hours, minutes, seconds] = match;
  const date = `${day} ${MONTHS[Number(month) - 1]} ${year}`;
  return hours === '00' && minutes === '00' && (seconds ?? '00') === '00' ? date : `${date} ${hours}:${minutes}`;
}

/** The colour of the first rule for the field that the value meets, or null (P10-10). */
export function ruleTone(rules: FormatRule[] | undefined, field: string, value: unknown): RuleTone | null {
  for (const rule of rules ?? []) {
    if (rule.field === field && meets(rule, value)) return rule.tone;
  }
  return null;
}

/** What a rule still needs before it can be added, or ''. */
export function ruleProblem(rule: FormatRule): string {
  if (!rule.field) return 'Choose a field.';
  const [first = '', second = ''] = rule.values.map(value => value.trim());
  switch (rule.op) {
    case 'blank':
      return '';
    case 'between':
      return numeric(first) !== null && numeric(second) !== null ? '' : 'Enter two numbers.';
    case 'eq':
    case 'neq':
    case 'contains':
      return first ? '' : 'Enter a value.';
    default:
      return numeric(first) !== null ? '' : 'Enter a number.';
  }
}

/** The KPI card as it is drawn (P10-7). number and targetNumber are the raw values, for the gauge. */
export interface TileView {
  value: string;
  /** The value in full, for the tooltip. */
  full: string;
  number: number | null;
  target: string | null;
  targetNumber: number | null;
  /** Percent of the target reached, from 0 to 100. */
  progress: number | null;
  tone: RuleTone | null;
  delta: { text: string; up: boolean; good: boolean } | null;
}

/** A tile from its one result row: the value, the target from a measure or a fixed value, and the change against the comparison. */
export function tileView(item: CanvasItem, row: Record<string, unknown> | undefined): TileView {
  const raw = row?.[item.measures[0]];
  const value = numeric(raw);
  const target = item.target ? numeric(row?.[item.target]) : item.targetValue ?? null;
  const compare = item.compare ? numeric(row?.[item.compare]) : null;
  const against = value !== null && target !== null && target !== 0;
  const change = value !== null && compare !== null && compare !== 0 ? (value - compare) / Math.abs(compare) * 100 : null;
  return {
    value: value !== null ? formatNumber(value, item.format) : raw === null || raw === undefined || raw === '' ? 'No value' : String(raw),
    full: value !== null ? PLAIN.format(value) : '',
    number: value,
    target: target !== null ? formatNumber(target, item.format) : null,
    targetNumber: target,
    progress: against ? Math.round(Math.max(0, Math.min(100, value / target * 100))) : null,
    tone: against ? kpiTone(value, target, item) : null,
    delta: change === null ? null : {
      text: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`,
      up: change >= 0,
      good: item.lowerIsBetter ? change <= 0 : change >= 0,
    },
  };
}

/**
 * The rows of a matrix as the grid shows them (P10-11): the server's level column becomes a row kind, and a
 * field a row totals over is blank, with "Total" (or "Grand total") in the first such field.
 */
export function matrixRows(result: Pick<QueryResult, 'columns' | 'rows'>, dimensions: string[], totalLabel = 'Grand total'): Record<string, unknown>[] {
  return result.rows.map(row => {
    const level = Number(row[LEVEL_COLUMN] ?? 0);
    const rolled = dimensions.map((_, i) => (level & (1 << (dimensions.length - 1 - i))) !== 0);
    const kind: MatrixRowKind = rolled.every(Boolean) ? 'total' : rolled.some(Boolean) ? 'subtotal' : 'detail';
    const shaped: Record<string, unknown> = { ...row, [MATRIX_KIND]: kind };
    delete shaped[LEVEL_COLUMN];
    const firstRolled = rolled.indexOf(true);
    dimensions.forEach((dimension, i) => {
      if (rolled[i]) shaped[dimension] = i !== firstRolled ? '' : kind === 'total' ? totalLabel : 'Total';
    });
    return shaped;
  });
}

/** Row and header heights and cell padding by grid density; compact matches Power BI's tables. */
export const GRID_DENSITY = {
  compact: { rowHeight: 26, headerHeight: 30, spacing: 4, fontSize: 12 },
  normal: { rowHeight: 32, headerHeight: 36, spacing: 6, fontSize: 13 },
  comfortable: { rowHeight: 40, headerHeight: 44, spacing: 8, fontSize: 14 },
} as const;

/**
 * The columns of a canvas table or matrix, as Power BI draws them: the canvas name of each field and measure, no row
 * numbers, no header menus, one-line headers, numbers right-aligned in the object's number format, blanks as (blank).
 */
export function canvasGridColumns(
  columns: string[], dimensions: ReadonlySet<string>, measures: ReadonlySet<string>, labels: Record<string, string>, format: NumberFormat | undefined,
): ColDef[] {
  return columns.map((field): ColDef => {
    const measure = measures.has(field);
    return {
      field,
      headerName: labels[field] ?? (dimensions.has(field) ? field.slice(field.indexOf('.') + 1) : field),
      headerTooltip: field,
      minWidth: 70,
      suppressHeaderMenuButton: true,
      suppressHeaderFilterButton: true,
      ...(measure ? { type: 'rightAligned' } : {}),
      valueFormatter: (params: ValueFormatterParams) => {
        const value = params.value;
        if (value === null || value === undefined) return dimensions.has(field) ? '(blank)' : '';
        if (value === '') return '';
        const n = Number(value);
        return measure && Number.isFinite(n) ? formatNumber(n, format) : displayValue(value);
      },
    };
  });
}

/**
 * A table's rows when the server added totals: the detail rows, and the grand total apart to pin under them.
 * Subtotal rows of a table with several fields are left out, as Power BI's table shows only the grand total.
 */
export function tableRows(result: Pick<QueryResult, 'columns' | 'rows'>, dimensions: string[], label: string): { rows: Record<string, unknown>[]; total: Record<string, unknown> | null } {
  if (!result.columns.includes(LEVEL_COLUMN)) return { rows: result.rows, total: null };
  const all = (1 << dimensions.length) - 1;
  const strip = (row: Record<string, unknown>) => { const { [LEVEL_COLUMN]: _level, ...rest } = row; return rest; };
  const rows = result.rows.filter(row => Number(row[LEVEL_COLUMN] ?? 0) === 0).map(strip);
  const grand = result.rows.find(row => Number(row[LEVEL_COLUMN] ?? 0) === all);
  const total = grand ? { ...strip(grand), ...Object.fromEntries(dimensions.map((field, i) => [field, i === 0 ? label : ''])) } : null;
  return { rows, total };
}

/** Green at or past the target, amber from warnAt percent of it, red beyond; lowerIsBetter turns it around. */
function kpiTone(value: number, target: number, item: CanvasItem): RuleTone {
  const warnAt = item.warnAt ?? 90;
  if (item.lowerIsBetter) return value <= target ? 'good' : value * 100 <= target * (200 - warnAt) ? 'warn' : 'bad';
  return value >= target ? 'good' : value * 100 >= target * warnAt ? 'warn' : 'bad';
}

function meets(rule: FormatRule, value: unknown): boolean {
  const blank = value === null || value === undefined || value === '';
  if (rule.op === 'blank') return blank;
  if (blank) return false;
  const expected = rule.values[0] ?? '';
  if (rule.op === 'contains') return String(value).toLowerCase().includes(expected.toLowerCase());
  if (rule.op === 'eq' || rule.op === 'neq') {
    const [a, b] = [numeric(value), numeric(expected)];
    const same = a !== null && b !== null ? a === b : String(value).toLowerCase() === expected.toLowerCase();
    return rule.op === 'eq' ? same : !same;
  }
  const [n, low, high] = [numeric(value), numeric(expected), numeric(rule.values[1])];
  if (n === null || low === null) return false;
  switch (rule.op) {
    case 'gt': return n > low;
    case 'gte': return n >= low;
    case 'lt': return n < low;
    case 'lte': return n <= low;
    case 'between': return high !== null && n >= Math.min(low, high) && n <= Math.max(low, high);
    default: return false;
  }
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The note under an object whose rows a filter could not reach: "Not filtered by: plant". Fields show their canvas name, else the column. */
export function skippedFiltersNote(fields: string[] | undefined, labels: Record<string, string> = {}): string {
  return fields?.length ? `Not filtered by: ${fields.map(field => labels[field] ?? field.slice(field.indexOf('.') + 1)).join(', ')}` : '';
}

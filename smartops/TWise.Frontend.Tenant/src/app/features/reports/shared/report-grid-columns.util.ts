import { ColDef, ColGroupDef, IAggFuncParams, ICellRendererParams, SpanRowsParams, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';
import { ConditionalRule, MergedCellRange, ReportJsonConfig, RowLayoutRef, CellBorder, BorderType } from './report-config.model';
import { getReportGridPageSize } from './report-grid-lifecycle.util';

/** Internal row-object keys added by materializeRows so edits can be mapped back to state. */
export const MANUAL_ROW_FLAG = '__manual';
export const MANUAL_ROW_ID = '__insId';
export const SOURCE_ROW_INDEX = '__srcIndex';

/** Key holding a summary row's left-hand label (e.g. "Sum", "Average") — shown in the Sl.No column. */
export const TOTALS_LABEL_FIELD = '__totalLabel';

/**
 * Fixed row height (px) for data rows that contain at least one vertical-orientation cell.
 * AG Grid's autoHeight can't measure rotated (writing-mode) content, so we give such rows an
 * explicit height; the rotated text then wraps into multiple columns within this height.
 */
export const VERTICAL_CELL_ROW_HEIGHT = 150;

/** True when the given (absolute, unpinned) row index has at least one cell set to vertical. */
export function rowHasVerticalCell(cellOrientations: Record<string, string> | undefined, rowIndex: number | null | undefined): boolean {
  if (cellOrientations == null || rowIndex == null) return false;
  const prefix = `${rowIndex}:`;
  for (const key in cellOrientations) {
    if (cellOrientations[key] === 'vertical' && key.startsWith(prefix)) return true;
  }
  return false;
}

/** Border color per stored variant; unknown/legacy-truthy values fall back to the dark border. */
const BORDER_COLORS: Record<string, string> = { dark: '#334155', light: '#FFFFFF' };
/** Border color used for the manual outline (kept dark/single so edges read as one clean line). */
const BORDER_COLOR = BORDER_COLORS['dark'];
/** Light grid-line color (matches the AG theme borderColor) used for the header's baseline bottom line. */
const GRID_LINE_COLOR = '#E2E7EF';

/** Grid position of a cell within the range the border applies to (selection or whole grid/header row). */
export interface BorderPos { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; }

/**
 * The border sides a cell gets for a Google-Sheets-style placement, using edge ownership so a
 * shared edge is drawn by exactly one cell (no doubled lines): horizontal edges are owned by the
 * lower cell's `top`, vertical edges by the right cell's `left`; the range's far bottom/right edge
 * is owned by the last row/column's `bottom`/`right`.
 */
export function borderSidesFor(type: BorderType, pos: BorderPos): CellBorder {
  const { firstRow, lastRow, firstCol, lastCol } = pos;
  switch (type) {
    case 'all': return { top: true, left: true, bottom: lastRow, right: lastCol };
    case 'inner': return { top: !firstRow, left: !firstCol };
    case 'horizontal': return { top: !firstRow };
    case 'vertical': return { left: !firstCol };
    case 'outer': return { top: firstRow, bottom: lastRow, left: firstCol, right: lastCol };
    case 'top': return { top: firstRow };
    case 'bottom': return { bottom: lastRow };
    case 'left': return { left: firstCol };
    case 'right': return { right: lastCol };
    default: return {};
  }
}

/** Merge two side-sets (OR of each side) so borders accumulate when applied one placement at a time. */
export function unionCellBorder(a: CellBorder | undefined, b: CellBorder | undefined): CellBorder {
  return {
    top: !!(a?.top || b?.top),
    right: !!(a?.right || b?.right),
    bottom: !!(a?.bottom || b?.bottom),
    left: !!(a?.left || b?.left),
  };
}

/** Normalize a stored value (legacy 'dark'/'light' string = full box) to a CellBorder, or null. */
function toCellBorder(v: CellBorder | string | undefined | null): CellBorder | null {
  if (v == null) return null;
  if (typeof v === 'string') return { top: true, right: true, bottom: true, left: true };
  return v;
}

/** True when any side of the border is set. */
export function hasAnyBorderSide(b: CellBorder | null | undefined): boolean {
  return !!(b && (b.top || b.right || b.bottom || b.left));
}

/**
 * The stored border side-set for a single cell: an explicit per-cell override (even an empty
 * "cleared" set) wins; otherwise the report-wide placement derived from the cell's grid position.
 */
export function resolveStoredSides(
  cellBorders: Record<string, CellBorder | string> | undefined,
  reportBorder: BorderType | undefined,
  key: string | null,
  pos: BorderPos,
): CellBorder | null {
  if (key && cellBorders && key in cellBorders) return toCellBorder(cellBorders[key]);
  if (reportBorder) return borderSidesFor(reportBorder, pos);
  return null;
}

/**
 * Normalize per-cell side-sets into the sides a cell should actually paint so every shared edge is
 * drawn exactly once (Google-Sheets style). Side-sets are stored per cell, so two neighbours can
 * each claim the edge between them (e.g. one cell's `bottom` and the cell below's `top`) — painting
 * both yields a doubled line. Here a cell paints its top/left whenever it *or* the neighbour across
 * that edge declares it, and paints bottom/right only on the grid's last row/column (otherwise the
 * lower/right neighbour paints that shared edge as its top/left).
 */
export function dedupeBorderSides(
  own: CellBorder | null,
  above: CellBorder | null,
  left: CellBorder | null,
  isLastRow: boolean,
  isLastCol: boolean,
): CellBorder | null {
  const top = !!(own?.top || above?.bottom);
  const leftSide = !!(own?.left || left?.right);
  const bottom = isLastRow && !!own?.bottom;
  const right = isLastCol && !!own?.right;
  if (!top && !leftSide && !bottom && !right) return null;
  return { top, left: leftSide, bottom, right };
}

/**
 * Inline border styles (per side) for AG Grid cellStyle from a resolved side-set.
 * Colors the cell's own border — AG reserves a `solid` (transparent) border on every side, so
 * only the color is set here. This keeps the line exactly on the cell boundary (an inset
 * box-shadow sits *inside* that reserved border, leaving a background-colored sliver at the very
 * edge that reads as a doubled line on colored cells) and adds no box-model width
 * (box-sizing: border-box, width stays AG's reserved value). Edge ownership (see borderSidesFor)
 * means a shared edge is only drawn by one cell, so there's no doubling between neighbors.
 */
function borderSideStyles(sides: CellBorder | null): Record<string, string> {
  if (!hasAnyBorderSide(sides)) return {};
  const styles: Record<string, string> = {};
  if (sides!.top) { styles['borderTopStyle'] = 'solid'; styles['borderTopColor'] = BORDER_COLOR; }
  if (sides!.right) { styles['borderRightStyle'] = 'solid'; styles['borderRightColor'] = BORDER_COLOR; }
  if (sides!.bottom) { styles['borderBottomStyle'] = 'solid'; styles['borderBottomColor'] = BORDER_COLOR; }
  if (sides!.left) { styles['borderLeftStyle'] = 'solid'; styles['borderLeftColor'] = BORDER_COLOR; }
  return styles;
}

/**
 * Header border styles. AG's own header/body separator (`headerRowBorder`) is disabled in the
 * theme so a manual bottom border doesn't stack with it (the doubled line the user saw). The
 * header/body boundary is a single shared edge: when the first body row paints its own top border
 * there (`bodyOwnsBottom`), the header leaves that edge to the body so the line isn't drawn twice;
 * otherwise the header draws it — dark when the header has a manual bottom, else the light grid
 * baseline. Top/left/right follow the header's own side-set.
 */
function headerBorderStyles(sides: CellBorder | null, bodyOwnsBottom: boolean): Record<string, string> {
  const shadows: string[] = [];
  if (sides?.top) shadows.push(`inset 0 1px 0 0 ${BORDER_COLOR}`);
  if (sides?.left) shadows.push(`inset 1px 0 0 0 ${BORDER_COLOR}`);
  if (sides?.right) shadows.push(`inset -1px 0 0 0 ${BORDER_COLOR}`);
  if (!bodyOwnsBottom) shadows.push(`inset 0 -1px 0 0 ${sides?.bottom ? BORDER_COLOR : GRID_LINE_COLOR}`);
  return shadows.length ? { boxShadow: shadows.join(', ') } : {};
}

/**
 * Custom row-group aggregations. Report data often arrives as numeric *strings*, which
 * AG Grid's built-in 'sum'/'avg' silently skip — so we coerce to numbers here. 'numAvg'
 * carries sum+count up the tree so nested groups and the grand total stay count-weighted
 * (a naive average-of-averages would make parent/grand totals wrong).
 */
export const REPORT_AGG_FUNCS: Record<string, (params: IAggFuncParams) => unknown> = {
  numSum: (params: IAggFuncParams) => {
    let sum = 0;
    let has = false;
    for (const v of params.values) {
      if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isNaN(n)) { sum += n; has = true; }
    }
    return has ? sum : null;
  },
  numAvg: (params: IAggFuncParams) => {
    let sum = 0;
    let count = 0;
    for (const v of params.values) {
      if (v == null || v === '') continue;
      if (typeof v === 'object' && v && '__twCount' in (v as Record<string, unknown>)) {
        sum += Number((v as Record<string, unknown>)['__twSum']);
        count += Number((v as Record<string, unknown>)['__twCount']);
      } else {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isNaN(n)) { sum += n; count += 1; }
      }
    }
    if (!count) return null;
    const value = sum / count;
    return { __twSum: sum, __twCount: count, value, toString: () => String(value), valueOf: () => value };
  },
};

/** True when a single conditional-formatting rule matches a cell's value. */
function ruleMatches(rule: ConditionalRule, raw: unknown): boolean {
  const str = raw == null ? '' : String(raw);
  const num = Number(raw);
  const target = Number(rule.value);
  const numeric = !isNaN(num) && !isNaN(target);
  switch (rule.operator) {
    case 'eq': return numeric ? num === target : str.toLowerCase() === String(rule.value ?? '').toLowerCase();
    case 'neq': return numeric ? num !== target : str.toLowerCase() !== String(rule.value ?? '').toLowerCase();
    case 'gt': return numeric && num > target;
    case 'gte': return numeric && num >= target;
    case 'lt': return numeric && num < target;
    case 'lte': return numeric && num <= target;
    case 'between': return !isNaN(num) && num >= Number(rule.value) && num <= Number(rule.value2);
    case 'contains': return str.toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    case 'startsWith': return str.toLowerCase().startsWith(String(rule.value ?? '').toLowerCase());
    case 'isEmpty': return raw == null || str.trim() === '';
    case 'notEmpty': return raw != null && str.trim() !== '';
    default: return false;
  }
}

/** First matching rule's format for a cell (first-match wins), or empty when none apply. */
export function evaluateConditionalRules(
  rules: ConditionalRule[] | undefined,
  field: string,
  rowData: Record<string, unknown> | undefined,
): { backgroundColor?: string; textColor?: string; bold?: boolean } {
  if (!rules?.length || !rowData) return {};
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const scope = rule.scope ?? (rule.applyToRow ? 'row' : 'column');
    // 'column': only the rule's own column cell. 'row': any cell in a row whose rule-field
    // value matches. 'report': any cell (any column/page) whose OWN value meets the condition.
    const testValue = scope === 'report' ? rowData[field] : rowData[rule.field];
    if (scope === 'column' && rule.field !== field) continue;
    if (ruleMatches(rule, testValue)) {
      return { backgroundColor: rule.backgroundColor, textColor: rule.textColor, bold: rule.bold };
    }
  }
  return {};
}

/**
 * Reconciles a saved manual row layout against the current source rows: drops refs to
 * source rows that no longer exist, never resurrects deleted rows, and appends any new
 * source rows (data that grew since the layout was saved) at the end. Returns a layout
 * whose order is guaranteed to match what materializeRows() will render 1:1, so a display
 * row index can be used directly to splice inserts/deletes.
 */
export function reconcileRowLayout(
  layout: RowLayoutRef[] | undefined,
  sourceCount: number,
  deleted: ReadonlySet<number> = new Set(),
): RowLayoutRef[] {
  if (!layout?.length) {
    const out: RowLayoutRef[] = [];
    for (let i = 0; i < sourceCount; i++) if (!deleted.has(i)) out.push({ src: i });
    return out;
  }
  const referenced = new Set<number>();
  const result: RowLayoutRef[] = [];
  for (const ref of layout) {
    if ('src' in ref) {
      if (ref.src >= 0 && ref.src < sourceCount && !deleted.has(ref.src)) {
        referenced.add(ref.src);
        result.push(ref);
      }
    } else {
      result.push(ref);
    }
  }
  for (let i = 0; i < sourceCount; i++) {
    if (!referenced.has(i) && !deleted.has(i)) result.push({ src: i });
  }
  return result;
}

/**
 * Builds the final grid rows from a reconciled layout: source rows carry a __srcIndex and
 * any cell overrides; inserted rows carry their stored values plus __manual/__insId markers.
 * The extra keys aren't bound to any column so AG Grid never renders them.
 */
export function materializeRows(
  layout: RowLayoutRef[],
  sourceRows: Record<string, unknown>[],
  manualRows: Record<string, Record<string, unknown>> = {},
  cellOverrides: Record<string, unknown> = {},
): Record<string, unknown>[] {
  const ovBySrc = new Map<number, Record<string, unknown>>();
  for (const key of Object.keys(cellOverrides)) {
    const sep = key.indexOf(':');
    if (sep < 0) continue;
    const src = Number(key.slice(0, sep));
    if (Number.isNaN(src)) continue;
    const field = key.slice(sep + 1);
    if (!ovBySrc.has(src)) ovBySrc.set(src, {});
    ovBySrc.get(src)![field] = cellOverrides[key];
  }
  return layout.map(ref => {
    if ('src' in ref) {
      const base = sourceRows[ref.src] ?? {};
      const ov = ovBySrc.get(ref.src);
      return { ...base, ...(ov ?? {}), [SOURCE_ROW_INDEX]: ref.src };
    }
    return { ...(manualRows[ref.insId] ?? {}), [MANUAL_ROW_FLAG]: true, [MANUAL_ROW_ID]: ref.insId };
  });
}

/**
 * Pure AG Grid column-building logic shared by the report builder (live preview) and
 * the report viewer (final render), so the two can never visually diverge. Extracted
 * verbatim from ReportViewerComponent — same inputs, same outputs, no behavior change.
 */

export function isNumericColumn(rows: Record<string, unknown>[], field: string): boolean {
  const sample = rows.slice(0, 50);
  let numCount = 0;
  for (const row of sample) {
    const v = row[field];
    if (v == null || v === '') continue;
    if (!Number.isNaN(Number(v))) numCount++;
  }
  return numCount > sample.length * 0.5;
}

export function isDateColumn(rows: Record<string, unknown>[], field: string): boolean {
  const datePat = /^\d{4}-\d{2}-\d{2}|^\d{2}[/-]\d{2}[/-]\d{4}/;
  const sample = rows.slice(0, 20);
  let dateCount = 0;
  for (const row of sample) {
    const v = row[field];
    if (v == null || v === '') continue;
    if (typeof v === 'string' && datePat.test(v)) dateCount++;
  }
  return dateCount > sample.length * 0.3;
}

export function isBooleanColumn(rows: Record<string, unknown>[], field: string): boolean {
  const sample = rows.slice(0, 50);
  let boolCount = 0;
  for (const row of sample) {
    const v = row[field];
    if (v == null || v === '') continue;
    if (v === true || v === false || v === 'true' || v === 'false' || v === 'True' || v === 'False') boolCount++;
  }
  return boolCount > 0 && boolCount >= sample.filter(r => r[field] != null && r[field] !== '').length * 0.5;
}

export function formatGridDateValue(value: unknown): string {
  if (value == null || value === '') return '—';

  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '—';

    const isoDateOnly = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T\s].*)?$/.exec(trimmed);
    if (isoDateOnly) {
      const [, year, month, day] = isoDateOnly;
      date = new Date(Number(year), Number(month) - 1, Number(day));
    } else {
      date = new Date(trimmed);
    }
  }

  if (!date || Number.isNaN(date.getTime())) return String(value);

  const day = String(date.getDate()).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

type GridDataType = 'boolean' | 'date' | 'number' | 'text';

const SQL_BOOLEAN_TYPES = new Set(['bit']);
const SQL_DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']);
const SQL_NUMBER_TYPES = new Set([
  'bigint', 'decimal', 'float', 'int', 'money', 'numeric', 'real', 'smallint', 'smallmoney', 'tinyint',
]);
const SQL_TEXT_TYPES = new Set([
  'char', 'nchar', 'ntext', 'nvarchar', 'text', 'uniqueidentifier', 'varchar',
]);

function gridDataTypeForSqlType(dataType: string | undefined): GridDataType | undefined {
  if (!dataType) return undefined;
  const baseType = dataType.trim().toLowerCase().match(/^[a-z]+/)?.[0];
  if (!baseType) return undefined;
  if (SQL_BOOLEAN_TYPES.has(baseType)) return 'boolean';
  if (SQL_DATE_TYPES.has(baseType)) return 'date';
  if (SQL_NUMBER_TYPES.has(baseType)) return 'number';
  if (SQL_TEXT_TYPES.has(baseType)) return 'text';
  return undefined;
}

function gridDataTypeForTransformation(config: ReportJsonConfig | null | undefined, field: string): GridDataType | undefined {
  let transformedType: GridDataType | undefined;
  for (const rule of config?.parameterFilters ?? []) {
    if (rule.action !== 'type_change' || rule.enabled === false || !rule.targetType) continue;
    const sourceColumns = rule.sourceColumns?.length ? rule.sourceColumns : [rule.sourceColumn ?? ''];
    if (!sourceColumns.some(column => column.toLowerCase() === field.toLowerCase())) continue;
    switch (rule.targetType) {
      case 'Number': transformedType = 'number'; break;
      case 'Text': transformedType = 'text'; break;
      case 'Date': transformedType = 'date'; break;
      case 'Boolean': transformedType = 'boolean'; break;
    }
  }
  return transformedType;
}

/** True when a field name is an Sl.No-style serial/row-number column (e.g. "Sl.No", "sl_no", "S No", "Serial No"). */
export function isSerialNumberField(field: string): boolean {
  const norm = field.toLowerCase().replace(/[\s._#-]/g, '');
  return ['slno', 'sno', 'srno', 'serial', 'serialno', 'serialnumber', 'rowno', 'rownumber','Sl_no','sl_no'].includes(norm);
}

/** Normalizes a column's Total selection (e.g. 'Sum'/'Average') to the internal agg key. */
function normalizeTotalAgg(value: unknown): 'sum' | 'avg' | 'count' | 'min' | 'max' | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'sum') return 'sum';
  if (v === 'avg' || v === 'average') return 'avg';
  if (v === 'count') return 'count';
  if (v === 'min') return 'min';
  if (v === 'max') return 'max';
  return null;
}

/** Sum/avg/count/min/max totals for the given rows — used for the pinned bottom totals row. */
export function computeTotalsRow(
  config: ReportJsonConfig | null,
  rows: Record<string, unknown>[],
  displayColumns: string[],
): { totals: Record<string, unknown>; hasAnyTotal: boolean } {
  const totals: Record<string, unknown> = {};
  let hasAnyTotal = false;
  for (const field of displayColumns) {
    const cfgTotal = normalizeTotalAgg(config?.columns?.find(c => c.field === field)?.total);
    if (cfgTotal === 'count') {
      // Count works on any column type: tally non-empty cells (numeric OR text).
      totals[field] = rows.reduce((n, r) => {
        const v = r[field];
        return v === null || v === undefined || v === '' ? n : n + 1;
      }, 0);
      hasAnyTotal = true;
    } else if (cfgTotal) {
      const nums = rows.map(r => Number(r[field])).filter(n => !Number.isNaN(n));
      if (!nums.length) { totals[field] = '—'; continue; }
      switch (cfgTotal) {
        case 'sum':   totals[field] = nums.reduce((a, b) => a + b, 0); break;
        case 'avg':   totals[field] = +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2); break;
        case 'min':   totals[field] = Math.min(...nums); break;
        case 'max':   totals[field] = Math.max(...nums); break;
      }
      hasAnyTotal = true;
    } else {
      totals[field] = '';
    }
  }
  return { totals, hasAnyTotal };
}

const TOTALS_AGG_LABELS: Record<string, string> = { sum: 'Sum', avg: 'Avg', count: 'Count', min: 'Min', max: 'Max' };

/** Reads a field off a row, tolerating column-name drift (case/whitespace/punctuation) between config and data keys. */
function readRowValue(row: Record<string, unknown>, field: string): unknown {
  if (field in row) return row[field];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(field);
  for (const key of Object.keys(row)) {
    if (norm(key) === target) return row[key];
  }
  return undefined;
}

/**
 * One summary row per distinct aggregation type present across the columns' "Total" selections:
 * all Sum columns land in a "Sum" row, all Average columns in an "Average" row, etc. Each row
 * carries its left-hand label under TOTALS_LABEL_FIELD and the aggregated value in each column.
 */
export function computeTotalsRows(
  config: ReportJsonConfig | null,
  rows: Record<string, unknown>[],
  displayColumns: string[],
): Record<string, unknown>[] {
  const byAgg = new Map<string, Record<string, unknown>>();
  for (const field of displayColumns) {
    const agg = normalizeTotalAgg(config?.columns?.find(c => c.field === field)?.total);
    if (!agg) continue;
    let value: number;
    if (agg === 'count') {
      // Count works on any column type: tally non-empty cells (numeric OR text).
      value = rows.reduce((n, r) => {
        const v = readRowValue(r, field);
        return v === null || v === undefined || v === '' ? n : n + 1;
      }, 0);
    } else {
      const nums = rows.map(r => Number(readRowValue(r, field))).filter(n => !Number.isNaN(n));
      if (!nums.length) continue;
      switch (agg) {
        case 'sum': value = nums.reduce((a, b) => a + b, 0); break;
        case 'avg': value = +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2); break;
        case 'min': value = Math.min(...nums); break;
        case 'max': value = Math.max(...nums); break;
      }
    }
    if (!byAgg.has(agg)) byAgg.set(agg, {});
    byAgg.get(agg)![field] = value;
  }
  // Fixed row order (Sum, Average, Count, Min, Max) so the Count row sits consistently below Sum/Average.
  const order = ['sum', 'avg', 'count', 'min', 'max'].filter(a => byAgg.has(a));
  return order.map(agg => ({ ...byAgg.get(agg)!, [TOTALS_LABEL_FIELD]: TOTALS_AGG_LABELS[agg] }));
}

/**
 * Single "Total" row combining every aggregated column's value (sum columns show their sum,
 * average columns their average) — used for the flat-report grand total, which AG Grid's own
 * grandTotalRow only handles reliably when row grouping is active.
 */
export function computeGrandTotalRow(
  config: ReportJsonConfig | null,
  rows: Record<string, unknown>[],
  displayColumns: string[],
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  let hasAny = false;
  for (const perAgg of computeTotalsRows(config, rows, displayColumns)) {
    for (const [key, value] of Object.entries(perAgg)) {
      if (key === TOTALS_LABEL_FIELD) continue;
      merged[key] = value;
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  merged[TOTALS_LABEL_FIELD] = 'Total';
  return merged;
}

export type ConfigGetter = () => ReportJsonConfig | null;

/**
 * A merge is either a column merge (colSpan > 1, rowSpan === 1) or a row merge
 * (rowSpan > 1, colSpan === 1) — never both. AG Grid's two spanning mechanisms can't
 * combine on one column: `colSpan` (simple, always available) handles column merges;
 * `spanRows` (requires `enableCellSpan` + `CellSpanModule`) properly hides the rows it
 * covers and is the only mechanism for row merges — the older `colDef.rowSpan` callback
 * is a legacy fallback that does NOT hide covered rows (just overlays a taller cell via
 * z-index), which is why a naive rowSpan implementation renders as overlapping/broken.
 */
function isColumnMerge(r: MergedCellRange): boolean { return r.colSpan > 1 && r.rowSpan === 1; }
function isRowMerge(r: MergedCellRange): boolean { return r.rowSpan > 1 && r.colSpan === 1; }

/**
 * True when any range is a ROW merge. `enableCellSpan` must only be turned on for row merges:
 * AG Grid's span-aware absolute cell positioning otherwise breaks the pinned bottom (totals)
 * rows even when nothing actually spans. Column merges use `colSpan`, which never needs it.
 */
export function hasRowMerges(ranges: MergedCellRange[] | undefined | null): boolean {
  return !!ranges && ranges.some(isRowMerge);
}

/**
 * Builds AG Grid columnDefs (with grouping, coloring, pinning and cell-merge callbacks)
 * from a report's saved JSON config. `sampleRows` is used only for numeric/date/boolean
 * type inference when SQL column metadata is unavailable — pass the same rows that will
 * be bound as the grid's rowData.
 *
 * `getConfig` is called fresh every time AG Grid invokes a cell/header style callback
 * (once per cell render), not just once at build time. This lets color edits repaint
 * live via `gridApi.refreshCells()`/`refreshHeader()` without resetting `columnDefs` —
 * which would otherwise discard any column widths the user has resized or auto-sized.
 * Merges are baked in at build time instead (rebuilding columnDefs is unavoidable the
 * first time a column switches between plain/column-merge/row-merge), but the caller
 * preserves column widths across that rebuild via `gridApi.applyColumnState()`.
 */
export function buildReportGridColumns(
  getConfig: ConfigGetter,
  visibleFields: string[],
  sampleRows: Record<string, unknown>[],
  columnTypes?: Record<string, string>,
): (ColDef | ColGroupDef)[] {
  const config = getConfig();
  const cols = config?.columns?.filter(c => c.shown !== false) ?? [];
  const groupColor = config?.columnGroupColors?.find(color => color.level === 0)?.color;
  const subGroupColor = config?.columnGroupColors?.find(color => color.level === 1)?.color;
  // Per-group background overrides (keyed by group name), falling back to groupColor.
  const groupColors = config?.groupColors ?? {};
  // Per-sub-group background overrides (keyed by sub-group name), falling back to subGroupColor.
  const subGroupColors = config?.subGroupColors ?? {};
  const groupTextColor = config?.groupTextColor || '#FFFFFF';
  const subGroupTextColor = config?.subGroupTextColor || '#FFFFFF';
  const mergedCellRanges = config?.mergedCellRanges ?? [];
  // Fields that contain at least one vertical cell — those columns get auto-height + truncation.
  const verticalFields = new Set<string>();
  for (const key of Object.keys(config?.cellOrientations ?? {})) {
    const sep = key.indexOf(':');
    if (sep >= 0 && config!.cellOrientations![key] === 'vertical') verticalFields.add(key.slice(sep + 1));
  }
  const colByField = new Map<string, ColDef>();
  const groupOfField = new Map<string, string>();
  const subGroupOfField = new Map<string, string>();
  const seen = new Set<string>();

  for (const field of visibleFields) {
    if (seen.has(field)) continue;
    seen.add(field);
    const cfg = cols.find(c => c.field === field);
    const sqlType = gridDataTypeForTransformation(config, field) ?? gridDataTypeForSqlType(columnTypes?.[field]);
    const isBoolean = sqlType ? sqlType === 'boolean' : isBooleanColumn(sampleRows, field);
    const isNum = sqlType ? sqlType === 'number' : isNumericColumn(sampleRows, field);
    const isDate = sqlType ? sqlType === 'date' : isDateColumn(sampleRows, field);
    const rowMerges = mergedCellRanges.filter(r => r.field === field && isRowMerge(r));

    // Vertical headers show the full label rotated top-to-bottom; autoHeaderHeight +
    // wrapHeaderText let the header row grow taller to fit it (full name also in the tooltip).
    const headerFull = cfg?.header || field;
    const headerName = headerFull;

    const col: ColDef = {
      field,
      headerName,
      filter: isBoolean ? 'agTextColumnFilter' : (isDate ? 'agDateColumnFilter' : (isNum ? 'agNumberColumnFilter' : 'agSetColumnFilter')),
      sortable: true,
      resizable: true,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      headerTooltip: headerFull,
      enableRowGroup: true,
      enablePivot: true,
      enableValue: isNum && !isBoolean,
    };

    // AG Grid reads a '.' in `field` as a deep path (e.g. "Sl No." → data['Sl No']['']), so any
    // column whose name contains a dot renders blank. Force flat key access while keeping `field`
    // intact for the config lookups (colors, grouping, merges) that match on it.
    if (field.includes('.')) {
      col.colId = field;
      col.valueGetter = (params) => (params.data as Record<string, unknown> | undefined)?.[field];
      col.valueSetter = (params) => {
        if (!params.data) return false;
        (params.data as Record<string, unknown>)[field] = params.newValue;
        return true;
      };
    }

    // When the data already carries its own Sl.No-style column, the auto '#' column is skipped —
    // surface the totals-row label (Sum/Avg/Count/Total) in this column so the pinned summary
    // rows still show their labels; leaf rows keep their real serial value.
    if (isSerialNumberField(field)) {
      col.valueGetter = (params: ValueGetterParams) => {
        const label = (params.data as Record<string, unknown> | undefined)?.[TOTALS_LABEL_FIELD];
        if (label != null && label !== '') return label;
        if (params.node?.footer && (params.node.level == null || params.node.level < 0)) return 'Total';
        return (params.data as Record<string, unknown> | undefined)?.[field];
      };
    }

    // Header coloring — a live callback (not a static object) so header-color edits
    // repaint via refreshHeader() without needing to reset columnDefs.
    (col as any).headerStyle = () => {
      const c = getConfig();
      const bg = c?.headerCellColors?.[field] || c?.headerRowColor || cols.find(x => x.field === field)?.color;
      const fg = c?.headerCellTextColors?.[field] || c?.headerRowTextColor || c?.columns?.find(x => x.field === field)?.textColor;
      const hb = c?.headerCellBorders;
      // Headers are a single row, so firstRow/lastRow are both true; columns use the visible order.
      const isFirstCol = field === visibleFields[0];
      const isLastCol = field === visibleFields[visibleFields.length - 1];
      const sides = (hb && field in hb)
        ? toCellBorder(hb[field])
        : (c?.reportBorder
          ? borderSidesFor(c.reportBorder, { firstRow: true, lastRow: true, firstCol: isFirstCol, lastCol: isLastCol })
          : null);
      // The header/body separator is a single shared edge. If the first body row paints its own
      // top border there, let it own the line so the header doesn't draw a second one.
      const row0Sides = resolveStoredSides(c?.cellBorders, c?.reportBorder, `0:${field}`, { firstRow: true, lastRow: false, firstCol: isFirstCol, lastCol: isLastCol });
      const bodyOwnsBottom = !!row0Sides?.top;
      return {
        ...(bg ? { backgroundColor: bg } : {}),
        ...(fg ? { color: fg } : {}),
        ...headerBorderStyles(sides, bodyOwnsBottom),
      };
    };

    // Vertical header text is applied via a CSS class on the label (not headerStyle),
    // so only the text rotates — the sort/menu icons stay upright. Alignment is a sibling
    // class so a header can be both rotated and aligned.
    const headerClasses: string[] = [];
    if (config?.headerCellOrientations?.[field] === 'vertical') headerClasses.push('rb-header-vertical');
    const headerAlign = config?.headerCellAlignments?.[field] ?? config?.reportAlignment;
    if (headerAlign) headerClasses.push(`rb-header-align-${headerAlign}`);
    // headerStyle (above) paints the header live on-screen, but AG Grid's native Excel export only
    // reads headerClass -> excelStyles, not arbitrary inline styles - so also tag the header with the
    // same color as a class id (report-builder's updateExcelStyles registers a matching xl-bg-<hex> style).
    const headerBg = config?.headerCellColors?.[field] || config?.headerRowColor || cols.find(x => x.field === field)?.color;
    if (headerBg && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(headerBg)) {
      const hex = headerBg.length === 4 ? headerBg.slice(1).split('').map(ch => ch + ch).join('') : headerBg.slice(1, 7);
      headerClasses.push(`xl-bg-${hex.toLowerCase()}`);
    }
    if (headerClasses.length) col.headerClass = headerClasses;

    if (isNum && !isBoolean) {
      col.type = 'numericColumn';
      col.valueFormatter = (params: ValueFormatterParams) => {
        if (params.value == null || params.value === '') {
          // Summary rows (totals/grand-total/subtotal) leave untotaled columns blank rather
          // than "—", so the totals row isn't cluttered with dashes.
          return (params.node?.rowPinned || params.node?.footer) ? '' : '—';
        }
        const n = Number(params.value);
        if (Number.isNaN(n)) return String(params.value);
        const maxFractionDigits = field === 'Northing' || field === 'Easting' ? 4 : 2;
        const formatted = Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits });
        return formatted;
      };
    }

    if (isDate) {
      col.valueFormatter = (params: ValueFormatterParams) => formatGridDateValue(params.value);
    }

    if (isBoolean) {
      col.cellDataType = false;
      col.filter = 'agTextColumnFilter';
      col.cellRenderer = (params: ICellRendererParams) => {
        if (params.value == null || params.value === '') return '—';
        const value = typeof params.value === 'string' ? params.value.toLowerCase() : params.value;
        return value === true || value === 'true' || value === 1 ? 'true' : 'false';
      };
      col.valueFormatter = (params: ValueFormatterParams) => {
        if (params.value == null || params.value === '') return '—';
        const v = typeof params.value === 'string' ? params.value.toLowerCase() : params.value;
        return v === true || v === 'true' || v === 1 ? 'true' : 'false';
      };
    }

    // Cell coloring — live callback, precedence cell > row > column, matching getCellBackground().
    // Merged cells (either axis) also get flex-centered content, matching Excel's "merge & center".
    col.cellStyle = (params) => {
      const c = getConfig();
      const rowIndex = params.node?.rowIndex;
      // Manual colors/alignments/borders are keyed by the row's absolute index (matching where
      // they are stored), so a styled row keeps its styling on that row only — it is not repeated
      // at the same position on every pagination page.
      const rowKey = (params.node?.rowPinned || rowIndex == null || rowIndex < 0)
        ? undefined
        : rowIndex;
      const cellKey = rowKey != null ? `${rowKey}:${field}` : undefined;
      const manualBg = (cellKey ? c?.cellColors?.[cellKey] : undefined)
        || (rowKey != null ? c?.pageRowColors?.[rowKey] : undefined)
        || (rowKey != null ? c?.rowColors?.[rowKey] : undefined)
        || c?.columns?.find(x => x.field === field)?.color;
      const manualFg = (cellKey ? c?.cellTextColors?.[cellKey] : undefined)
        || (rowKey != null ? c?.rowTextColors?.[rowKey] : undefined)
        || c?.columns?.find(x => x.field === field)?.textColor;

      // Conditional formatting wins over manual paint (skip the totals row); manual fills gaps.
      const cf = params.node?.rowPinned ? {} : evaluateConditionalRules(c?.conditionalRules, field, params.data);
      const bg = cf.backgroundColor || manualBg;
      const fg = cf.textColor || manualFg;

      // A row merge only covers the rows inside its span. Treating the whole column as merged
      // centered every cell in it, including rows outside the range.
      const inRowMerge = rowIndex != null
        && rowMerges.some(range => rowIndex >= range.rowIndex && rowIndex < range.rowIndex + range.rowSpan);
      const isMerged = !(params.node?.rowPinned || params.node?.footer)
        && (inRowMerge || (rowIndex != null && mergedCellRanges.some(r => r.field === field && r.rowIndex === rowIndex && isColumnMerge(r))));
      // Orientation is keyed by absolute rowIndex (matches setCellOrientation + the cell renderer), not the page-relative color key.
      const vertical = (rowIndex != null && !params.node?.rowPinned)
        ? c?.cellOrientations?.[`${rowIndex}:${field}`] === 'vertical'
        : false;
      // Aggregated value cells (e.g. "Average: 0.05" on group/total rows) render bold.
      const isAggCell = !!cfg?.aggFunc && (params.node?.group === true || params.node?.footer === true);
      // Manual horizontal alignment (keyed page-relative like colors); wins over the theme default and merge-centering.
      const align = (cellKey ? c?.cellAlignments?.[cellKey] : undefined) ?? c?.reportAlignment;
      const cb = c?.cellBorders;
      // Borders are stored per-cell, but a shared edge must be painted once. Resolve this cell's
      // sides plus its top/left neighbours' sides, then de-duplicate so each edge is drawn by a
      // single cell (prevents the doubled line when a cell's bottom/right meets a neighbour's
      // top/left). Report-wide placements still fall back through resolveStoredSides.
      const totalRows = params.api?.getDisplayedRowCount?.() ?? 0;
      let sides: CellBorder | null = null;
      if (rowIndex != null && !params.node?.rowPinned) {
        const lastColIdx = visibleFields.length - 1;
        const colIdx = visibleFields.indexOf(field);
        const keyAt = (absRow: number, fld: string) => `${absRow}:${fld}`;
        const sidesAt = (absRow: number, fld: string, colI: number): CellBorder | null => {
          if (absRow < 0 || absRow >= totalRows || colI < 0) return null;
          return resolveStoredSides(cb, c?.reportBorder, keyAt(absRow, fld), {
            firstRow: absRow === 0,
            lastRow: totalRows > 0 && absRow === totalRows - 1,
            firstCol: colI === 0,
            lastCol: colI === lastColIdx,
          });
        };
        const own = sidesAt(rowIndex, field, colIdx);
        const above = sidesAt(rowIndex - 1, field, colIdx);
        const leftN = colIdx > 0 ? sidesAt(rowIndex, visibleFields[colIdx - 1], colIdx - 1) : null;
        sides = dedupeBorderSides(own, above, leftN, totalRows > 0 && rowIndex === totalRows - 1, colIdx === lastColIdx);
      }
      const hasBorder = hasAnyBorderSide(sides);
      if (!isMerged && !bg && !fg && !vertical && !cf.bold && !isAggCell && !align && !hasBorder) return null;
      return {
        ...(isMerged ? { display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } : {}),
        ...(bg ? { backgroundColor: bg } : {}),
        ...(fg ? { color: fg } : {}),
        ...((cf.bold || isAggCell) ? { fontWeight: '700' } : {}),
        ...(align ? { textAlign: align, justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' } : {}),
        ...borderSideStyles(sides),
      };
    };
    // Vertical cells: show the full value rotated top-to-bottom, wrapping into multiple
    // rotated lines (via the 'rb-cell-vertical' class + CSS) instead of clipping with an
    // ellipsis. AG's autoHeight can't measure rotated content, so the row height is set
    // explicitly via getRowHeight (see rowHasVerticalCell / VERTICAL_CELL_ROW_HEIGHT), and
    // the CSS wraps the rotated text within that height. Non-vertical cells in the same
    // column keep their normal (formatted / boolean) rendering.
    if (verticalFields.has(field)) {
      // Use cellClassRules (additive) rather than cellClass so we don't override the
      // defaultColDef's cellClass (which carries the native-Excel-export color classes).
      col.cellClassRules = {
        'rb-cell-vertical': (params) =>
          getConfig()?.cellOrientations?.[`${params.node?.rowIndex}:${field}`] === 'vertical',
      };
      const baseRenderer = col.cellRenderer as ((p: ICellRendererParams) => unknown) | undefined;
      col.cellRenderer = (params: ICellRendererParams) => {
        const isVertical = getConfig()?.cellOrientations?.[`${params.node?.rowIndex}:${field}`] === 'vertical';
        if (!isVertical) {
          return baseRenderer ? baseRenderer(params) : (params.valueFormatted ?? (params.value == null ? '' : String(params.value)));
        }
        const full = params.value == null ? '' : String(params.value);
        const span = document.createElement('span');
        span.textContent = full;
        span.title = full;
        // A definite height makes the rotated (vertical writing-mode) text wrap into columns
        // within the row instead of growing into one long overflowing line. Leave ~16px for the
        // cell's vertical padding so the wrapped text sits inside the getRowHeight() row.
        span.style.display = 'block';
        span.style.height = `${VERTICAL_CELL_ROW_HEIGHT - 16}px`;
        span.style.whiteSpace = 'normal';
        span.style.wordBreak = 'break-word';
        // Rotate the text itself (not the cell) so the cell box — and any borders/background on it
        // — stays upright. Rotating the whole cell (via the class) flips its border sides 180°, so
        // a top/left border would render on the visual bottom/right and double with neighbours.
        span.style.writingMode = 'vertical-rl';
        span.style.transform = 'rotate(180deg)';
        return span;
      };
    }

    // Pin column if configured
    const isPinned = cfg?.pinned || config?.pinnedColumns?.includes(field);
    if (isPinned) {
      col.pinned = cfg?.pinned || 'left';
    }

    // Row grouping — grouped columns are normally hidden so their values show only in the
    // group column (no duplicated data). But when a grouped column also carries an
    // aggregation, keep it visible: multipleColumns' group column only shows the group key,
    // so the aggregate has nowhere else to render — the visible column shows the sum/average
    // on group/total rows (and the raw value on leaf rows). aggFunc drives that number below.
    // Always set rowGroup/hide explicitly: on a columnDefs update AG Grid RETAINS a column's
    // prior grouping (and hidden) state for any property left undefined, so omitting them here
    // meant unchecking a grouped column never actually ungrouped it (its panel chip lingered too).
    if (cfg?.rowGroup) {
      col.rowGroup = true;
      if (typeof cfg.rowGroupIndex === 'number') col.rowGroupIndex = cfg.rowGroupIndex;
      col.hide = !cfg.aggFunc;
    } else {
      col.rowGroup = false;
      col.rowGroupIndex = null;
      col.hide = false;
    }
    // Map to the numeric-coercing aggregations so string data still sums/averages correctly.
    if (cfg?.aggFunc === 'sum') col.aggFunc = 'numSum';
    else if (cfg?.aggFunc === 'avg') col.aggFunc = 'numAvg';
    else if (cfg?.aggFunc) col.aggFunc = cfg.aggFunc;

    // The per-column "Total" selection (Sum/Average/Count) also drives AG Grid's grand-total
    // and group-subtotal rows, which aggregate via aggFunc — without this those rows render
    // blank ("—") for columns that only set a Total (and no row-group aggregation).
    if (!col.aggFunc) {
      const totalAgg = normalizeTotalAgg(cfg?.total);
      if (totalAgg === 'sum') col.aggFunc = 'numSum';
      else if (totalAgg === 'avg') col.aggFunc = 'numAvg';
      else if (totalAgg) col.aggFunc = totalAgg;
    }

    // Manual cell merges — column merges and row merges use two different, mutually
    // exclusive AG Grid mechanisms (see isColumnMerge/isRowMerge above), so exactly one
    // of colSpan/spanRows is attached per column, decided from the current merge state.
    if (rowMerges.length) {
      col.spanRows = (params: SpanRowsParams) => {
        // Never span the pinned totals / footer rows — spanning them staggers the summary cells.
        if (params.nodeA?.rowPinned || params.nodeB?.rowPinned || params.nodeA?.footer || params.nodeB?.footer) return false;
        const a = params.nodeA?.rowIndex;
        const b = params.nodeB?.rowIndex;
        if (a == null || b == null) return false;
        return rowMerges.some(range => {
          const within = (i: number) => i >= range.rowIndex && i < range.rowIndex + range.rowSpan;
          return within(a) && within(b);
        });
      };
      // spanRows requires editable/rowDrag to be false/undefined on the column — override
      // whatever the grid's defaultColDef sets (e.g. the viewer defaults every cell editable).
      col.editable = false;
      col.rowDrag = false;
    } else {
      col.colSpan = (params) => {
        // Pinned totals / footer rows never take part in a column merge.
        if (params.node?.rowPinned || params.node?.footer) return 1;
        const rowIndex = params.node?.rowIndex ?? -1;
        const anchor = mergedCellRanges.find(r => r.field === field && r.rowIndex === rowIndex && isColumnMerge(r));
        return anchor?.colSpan ?? 1;
      };
    }

    // Trim group / sub-group titles so a value left as whitespace-only after backspacing
    // (e.g. a stray space or newline from the multiline textarea) counts as "no group" —
    // matching the builder's groupNames/subGroupNames getters and avoiding a ghost empty
    // header bar that would otherwise persist here and in the saved report.
    const grp = cfg?.group?.trim();
    const sub = cfg?.subGroup?.trim();
    colByField.set(field, col);
    if (grp) groupOfField.set(field, grp);
    if (sub) subGroupOfField.set(field, sub);
  }

  const defs: (ColDef | ColGroupDef)[] = [];
  // Skip the auto row-number column when the data already carries an Sl.No-style column.
  if (!visibleFields.some(isSerialNumberField)) {
    defs.push({
      headerName: '#',
      valueGetter: (p: ValueGetterParams) => {
        const label = (p.data as Record<string, unknown> | undefined)?.[TOTALS_LABEL_FIELD];
        if (label != null && label !== '') return label;
        // AG Grid's grand-total footer (row grouping) is labeled "Total".
        if (p.node?.footer && (p.node.level == null || p.node.level < 0)) return 'Total';
        return (p.node?.rowIndex ?? 0) + 1;
      },
      width: 60,
      maxWidth: 70,
      sortable: false,
      filter: false,
      resizable: false,
      pinned: 'left',
      editable: false,
      suppressHeaderMenuButton: true,
      headerComponent: undefined,
      cellStyle: { fontWeight: '600', color: '#667085', textAlign: 'center' },
    } as ColDef);
  }
  // Preserve column order: a grouped column's header is inserted at the position of the
  // FIRST field of that group (not appended after every ungrouped column), so grouping a
  // column never moves it — or its neighbors — away from where the user placed it.
  const placedGroups = new Set<string>();
  const placedStandaloneSubs = new Set<string>();
  for (const field of visibleFields) {
    const col = colByField.get(field);
    if (!col) continue;
    const grp = groupOfField.get(field);
    if (!grp) {
      const sub = subGroupOfField.get(field);
      // No group and no sub group → a plain leaf column.
      if (!sub) { defs.push(col); continue; }
      // Sub group but no main Group: render the sub group at the SUB-GROUP tier (second row),
      // wrapped in a blank/headerless main-group tier so it sits under the empty main-grouping
      // space — lining up with sub groups that nest inside real groups, instead of appearing as a
      // header at the main-group tier itself. Anchored at the sub group's first member to keep order.
      if (placedStandaloneSubs.has(sub)) continue;
      placedStandaloneSubs.add(sub);
      const subFields = visibleFields.filter(f => !groupOfField.get(f) && subGroupOfField.get(f) === sub);
      const subChildren = subFields.map(f => colByField.get(f)).filter((c): c is ColDef => !!c);
      const sgColor = subGroupColors[sub] || subGroupColor;
      const subHeader: ColGroupDef = {
        groupId: `subgrp:${sub}`,
        headerName: sub,
        ...(sgColor ? { headerStyle: { backgroundColor: sgColor, color: subGroupTextColor } } : {}),
        wrapHeaderText: true,
        autoHeaderHeight: true,
        children: subChildren,
      } as ColGroupDef;
      defs.push({
        groupId: `subgrp-wrap:${sub}`,
        headerName: '',
        children: [subHeader],
      } as ColGroupDef);
      continue;
    }
    if (placedGroups.has(grp)) continue;
    placedGroups.add(grp);

    const groupFields = visibleFields.filter(f => groupOfField.get(f) === grp);
    const groupChildrenCols = groupFields.map(f => colByField.get(f)).filter((c): c is ColDef => !!c);

    // Build the group's children in the columns' original order: a direct (un-subgrouped) column
    // stays in place, and a subgroup is anchored at the position of its FIRST member (not appended
    // after every direct column). This keeps a newly added subgroup where its column already sits,
    // so the user no longer has to drag it back to preserve order.
    const groupChildren: (ColDef | ColGroupDef)[] = [];
    const placedSubGroups = new Set<string>();
    for (const child of groupChildrenCols) {
      const subGroup = child.field ? subGroupOfField.get(child.field) : undefined;
      if (!subGroup) {
        groupChildren.push(child);
        continue;
      }
      if (placedSubGroups.has(subGroup)) continue;
      placedSubGroups.add(subGroup);
      const subMembers = groupChildrenCols.filter(c => c.field && subGroupOfField.get(c.field) === subGroup);
      const sgColor = subGroupColors[subGroup] || subGroupColor;
      groupChildren.push({
        groupId: `grp:${grp}>${subGroup}`,
        headerName: subGroup,
        ...(sgColor ? { headerStyle: { backgroundColor: sgColor, color: subGroupTextColor } } : {}),
        wrapHeaderText: true,
        autoHeaderHeight: true,
        children: subMembers,
      } as ColGroupDef);
    }

    defs.push({
      groupId: `grp:${grp}`,
      headerName: grp,
      ...((groupColors[grp] || groupColor) ? { headerStyle: { backgroundColor: groupColors[grp] || groupColor, color: groupTextColor } } : {}),
      wrapHeaderText: true,
      autoHeaderHeight: true,
      children: groupChildren,
    } as ColGroupDef);
  }

  return defs;
}

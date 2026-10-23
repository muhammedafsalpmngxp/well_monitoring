import { CellClassParams, ColDef, ColGroupDef, Column, GridApi, HeaderStyleFunc, IAggFuncParams, ICellRendererParams, IRowNode, SpanRowsParams, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';
import { ConditionalRule, MergedCellRange, ReportJsonColumn, ReportJsonConfig, RowLayoutRef, CellBorder, BorderType, TextAlign } from './report-config.model';
import { getReportGridPageSize } from './report-grid-lifecycle.util';
import { getRuleSourceColumns } from '../../../core/utils/parameter-filter.util';
import { coerceNumberAllowPercent, formatPercentValue, isPercentValue, parseNumberAllowPercent } from '../../../core/utils/percent-number.util';
import { DEFAULT_DATA_BAR_COLOR, dataBarCellRenderer } from '../../../core/utils/table-grid-features.util';

/** Internal row-object keys added by materializeRows so edits can be mapped back to state. */
export const MANUAL_ROW_FLAG = '__manual';
export const MANUAL_ROW_ID = '__insId';
export const SOURCE_ROW_INDEX = '__srcIndex';
export const ROW_COLOR_KEY = '__reportRowColorKey';

/** A group's complete field/key path stays stable as rows expand, sort or change page. */
export function getReportGroupRowColorKey(node: IRowNode | null | undefined): string | undefined {
  if (!node?.group || node.footer || node.rowPinned || node.level < 0) return undefined;
  const path: [string, string | null][] = [];
  for (let group: IRowNode | null = node; group && group.level >= 0; group = group.parent) {
    const field = group.rowGroupColumn?.getColDef().field ?? group.field;
    if (!field) return undefined;
    path.unshift([field, group.key]);
  }
  return `group:${JSON.stringify(path)}`;
}

export function getReportGroupRowStyle(
  config: ReportJsonConfig | null | undefined,
  node: IRowNode | null | undefined,
): { backgroundColor: string; color: string } | undefined {
  const key = getReportGroupRowColorKey(node);
  if (!key) return undefined;
  const field = node?.rowGroupColumn?.getColDef().field ?? node?.field;
  return resolveReportGroupRowStyle(config, key, field);
}

export function resolveReportGroupRowStyle(
  config: ReportJsonConfig | null | undefined,
  key: string,
  field: string | null | undefined,
): { backgroundColor: string; color: string } {
  const column = field ? createColumnConfigResolver(config)(field) : undefined;
  return {
    backgroundColor: config?.rowColorsByKey?.[key] ?? column?.rowGroupColor ?? '',
    color: config?.rowTextColorsByKey?.[key] ?? '',
  };
}

/** Cell-setting key that stays attached to a record as its displayed position changes. */
export function reportCellSettingKey(rowColorKey: string, field: string): string {
  return `record:${JSON.stringify([rowColorKey, field])}`;
}

export function reportCellSettingPrefix(rowColorKey: string): string {
  return `record:${JSON.stringify([rowColorKey]).slice(0, -1)},`;
}

/** Discards prior per-cell styles on a record, including legacy styles keyed by its current row index. */
export function clearReportCellSettingsForRecord<T>(
  settings: Record<string, T>,
  rowIndex: number,
  rowColorKey?: string,
): void {
  const prefixes = rowColorKey
    ? [reportCellSettingPrefix(rowColorKey), `${rowIndex}:`]
    : [`${rowIndex}:`];
  for (const key of Object.keys(settings)) {
    if (prefixes.some(prefix => key.startsWith(prefix))) delete settings[key];
  }
}

/** Excel-style default alignment for cells without a manual alignment: numbers/dates right, text left. */
export function defaultReportCellAlign(rightAligned: boolean): TextAlign {
  return rightAligned ? 'right' : 'left';
}

/** Identifies a column-group (or sub-group) header; carried on ColGroupDef.context.reportHeaderGroup. */
export interface ReportHeaderGroupRef {
  level: 'group' | 'subGroup';
  name: string;
}

/** Group/sub-group header alignment: per-name override, then report-wide alignment, then center. */
export function resolveGroupHeaderAlign(
  config: Pick<ReportJsonConfig, 'groupHeaderAlignments' | 'subGroupHeaderAlignments' | 'reportAlignment'> | null | undefined,
  ref: ReportHeaderGroupRef,
): TextAlign {
  const overrides = ref.level === 'group' ? config?.groupHeaderAlignments : config?.subGroupHeaderAlignments;
  const align = overrides?.[ref.name] ?? config?.reportAlignment;
  return align === 'left' || align === 'right' || align === 'center' ? align : 'center';
}

/** Reads a stable cell setting first, then falls back to the legacy row-index key. */
export function getReportCellSetting<T>(
  settings: Record<string, T> | undefined,
  rowData: Record<string, unknown> | undefined,
  rowIndex: number | null | undefined,
  field: string,
): T | undefined {
  const rowColorKey = rowData?.[ROW_COLOR_KEY];
  if (typeof rowColorKey === 'string') {
    const stableValue = settings?.[reportCellSettingKey(rowColorKey, field)];
    if (stableValue !== undefined) return stableValue;
  }
  return rowIndex == null ? undefined : settings?.[`${rowIndex}:${field}`];
}

/** True when a cell-setting map key belongs to the given column. */
export function isReportCellSettingForField(key: string, field: string): boolean {
  return key.endsWith(`:${field}`) || key.endsWith(`,${JSON.stringify(field)}]`);
}

/** Stable identity for a source row; falls back to its original source position if no usable PK is available. */
export function getReportRowColorKey(row: Record<string, unknown>, primaryKeys: string[] = [], sourceIndex = 0): string {
  const primaryKeyValues = primaryKeys.map(primaryKey => {
    const exact = primaryKey.trim();
    const column = exact in row
      ? exact
      : Object.keys(row).find(key => key.toLowerCase() === exact.toLowerCase());
    return column ? row[column] : undefined;
  });
  if (primaryKeys.length && primaryKeyValues.every(value => value != null)) {
    return `pk:${JSON.stringify(primaryKeyValues)}`;
  }
  return `row:${sourceIndex}`;
}

/** Key holding a summary row's left-hand label (e.g. "Sum", "Average") — shown in the Sl.No column. */
export const TOTALS_LABEL_FIELD = '__totalLabel';

export function getPinnedSummaryLabel(node: {
  rowPinned?: string | null;
  data?: Record<string, unknown>;
} | null | undefined): string | undefined {
  const label = node?.data?.[TOTALS_LABEL_FIELD];
  return node?.rowPinned === 'bottom' && typeof label === 'string' && label ? label : undefined;
}

export function getSummaryRowStyle(
  config: Pick<ReportJsonConfig, 'summaryRowColors' | 'summaryRowTextColors'> | null | undefined,
  label: string | undefined,
): { backgroundColor?: string; color?: string } | undefined {
  if (!label) return undefined;
  const backgroundColor = config?.summaryRowColors?.[label];
  const color = config?.summaryRowTextColors?.[label];
  return backgroundColor || color
    ? { ...(backgroundColor ? { backgroundColor } : {}), ...(color ? { color } : {}) }
    : undefined;
}

/**
 * Fixed row height (px) for data rows that contain at least one vertical-orientation cell.
 * AG Grid's autoHeight can't measure rotated (writing-mode) content, so we give such rows an
 * explicit height; the rotated text then wraps into multiple columns within this height.
 */
export const VERTICAL_CELL_ROW_HEIGHT = 150;

/** True when the given (absolute, unpinned) row index has at least one cell set to vertical. */
export function rowHasVerticalCell(
  cellOrientations: Record<string, string> | undefined,
  rowIndex: number | null | undefined,
  rowData?: Record<string, unknown>,
): boolean {
  if (cellOrientations == null || rowIndex == null) return false;
  const rowColorKey = rowData?.[ROW_COLOR_KEY];
  if (typeof rowColorKey === 'string') {
    const prefix = reportCellSettingPrefix(rowColorKey);
    for (const key in cellOrientations) {
      if (key.startsWith(prefix) && cellOrientations[key] === 'vertical') return true;
    }
  }
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

/** Stable colId of the auto-generated row-number ('#') column, so it can be targeted (e.g. an editable header). */
export const ROW_NUMBER_COL_ID = '__rowNumber__';

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
    let allPercent = true;
    for (const v of params.values) {
      if (v == null || v === '') continue;
      const n = parseReportNumber(v);
      if (!Number.isNaN(n)) { sum += n; has = true; if (!isPercentValue(v)) allPercent = false; }
    }
    if (!has) return null;
    return allPercent ? formatPercentValue(sum) : sum;
  },
  numAvg: (params: IAggFuncParams) => {
    let sum = 0;
    let count = 0;
    let allPercent = true;
    for (const v of params.values) {
      if (v == null || v === '') continue;
      if (typeof v === 'object' && v && '__twCount' in (v as Record<string, unknown>)) {
        const agg = v as Record<string, unknown>;
        sum += Number(agg['__twSum']);
        count += Number(agg['__twCount']);
        if (!agg['__twPct']) allPercent = false;
      } else {
        const n = parseReportNumber(v);
        if (!Number.isNaN(n)) { sum += n; count += 1; if (!isPercentValue(v)) allPercent = false; }
      }
    }
    if (!count) return null;
    const value = sum / count;
    const text = allPercent ? formatPercentValue(value) : String(value);
    return { __twSum: sum, __twCount: count, __twPct: allPercent, value, toString: () => text, valueOf: () => value };
  },
};

export { isPercentValue, formatPercentValue, parseNumberAllowPercent as parseReportNumber };
const parseReportNumber = parseNumberAllowPercent;

/** True when most populated cells of the column are percentage strings ("12.5%"). */
export function isPercentColumn(rows: Record<string, unknown>[], field: string): boolean {
  let sampleCount = 0;
  let pctCount = 0;
  for (const row of rows) {
    const v = row[field];
    if (v == null || (typeof v === 'string' && v.trim() === '')) continue;
    sampleCount++;
    if (isPercentValue(v)) pctCount++;
    if (sampleCount === 50) break;
  }
  return sampleCount > 0 && pctCount > sampleCount * 0.5;
}

/** Columns that can be Summed/Averaged: numeric columns, or percentage columns ("12.5%"). */
export function isAggregatableColumn(rows: Record<string, unknown>[], field: string): boolean {
  return isNumericColumn(rows, field) || isPercentColumn(rows, field);
}

/**
 * Sum/avg/min/max over cell values, accepting "%"-suffixed values. When every contributing value
 * is a percentage the result keeps the "%" suffix; returns null when nothing is numeric.
 */
export function aggregateReportValues(values: unknown[], agg: 'sum' | 'avg' | 'min' | 'max'): number | string | null {
  const nums: number[] = [];
  let allPercent = true;
  for (const v of values) {
    const n = parseReportNumber(v);
    if (Number.isNaN(n)) continue;
    nums.push(n);
    if (!isPercentValue(v)) allPercent = false;
  }
  if (!nums.length) return null;
  let result: number;
  switch (agg) {
    case 'sum': result = nums.reduce((a, b) => a + b, 0); break;
    case 'avg': result = +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2); break;
    case 'min': result = Math.min(...nums); break;
    case 'max': result = Math.max(...nums); break;
  }
  return allPercent ? formatPercentValue(result) : result;
}

/** True when a single conditional-formatting rule matches a cell's value. */
function ruleMatches(rule: ConditionalRule, raw: unknown, duplicates?: ReadonlySet<string>): boolean {
  const str = raw == null ? '' : String(raw);
  // Blank cells (null/undefined/whitespace) are NOT the number 0 — `Number(null)` and `Number('')`
  // both coerce to 0, which would make ordered comparisons like "less than 15" wrongly match empty
  // cells. Treat blanks as non-numeric so only the explicit isEmpty/notEmpty rules act on them.
  const isBlank = raw == null || str.trim() === '';
  const num = isBlank ? NaN : coerceNumberAllowPercent(raw);
  const target = coerceNumberAllowPercent(rule.value);
  const numeric = !isNaN(num) && !isNaN(target);
  switch (rule.operator) {
    case 'eq': return numeric ? num === target : str.toLowerCase() === String(rule.value ?? '').toLowerCase();
    case 'neq': return numeric ? num !== target : str.toLowerCase() !== String(rule.value ?? '').toLowerCase();
    case 'gt': return numeric && num > target;
    case 'gte': return numeric && num >= target;
    case 'lt': return numeric && num < target;
    case 'lte': return numeric && num <= target;
    case 'between': return !isNaN(num) && num >= coerceNumberAllowPercent(rule.value) && num <= coerceNumberAllowPercent(rule.value2);
    case 'contains': return str.toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    case 'startsWith': return str.toLowerCase().startsWith(String(rule.value ?? '').toLowerCase());
    case 'isEmpty': return raw == null || str.trim() === '';
    case 'notEmpty': return raw != null && str.trim() !== '';
    case 'duplicate': {
      const key = duplicateValueKey(raw);
      return key != null && !!duplicates?.has(key);
    }
    default: return false;
  }
}

/** Light red used by default for the "Duplicate values" conditional-formatting rule. */
export const DUPLICATE_HIGHLIGHT_BG = '#FEE2E2';

/** Fixed dark-red text for the "Duplicate values" rule (Excel's "Light Red Fill with Dark Red Text"). */
export const DUPLICATE_HIGHLIGHT_TEXT = '#9C0006';

/** Returns the set of values (by duplicateValueKey) that repeat within a column. */
export type DuplicateValueLookup = (field: string) => ReadonlySet<string>;

/** Normalised comparison key for duplicate detection; null for blank cells (never duplicates). */
export function duplicateValueKey(raw: unknown): string | null {
  if (raw == null) return null;
  const text = (raw instanceof Date ? raw.toISOString() : String(raw)).trim();
  return text ? text.toLowerCase() : null;
}

/** Keys of every value that occurs more than once in `field` across `rows`. */
export function findDuplicateValues(rows: Iterable<Record<string, unknown> | undefined>, field: string): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const key = duplicateValueKey(row?.[field]);
    if (key == null) continue;
    if (seen.has(key)) duplicates.add(key);
    else seen.add(key);
  }
  return duplicates;
}

interface DuplicateSourceApi {
  forEachNode(callback: (node: { data?: Record<string, unknown>; group?: boolean }) => void): void;
}

// Per-source (grid API or row array) duplicate sets, kept only for the current synchronous
// render/export pass so every cell shares one O(n) scan yet cell edits are picked up next pass.
const duplicateCache = new WeakMap<object, Map<string, Set<string>>>();

/**
 * Duplicate lookup over the grid's current data (cell edits, inserted rows included), falling
 * back to `fallbackRows` when no grid API is available (e.g. before the grid is ready).
 */
export function createDuplicateValueLookup(
  api: DuplicateSourceApi | null | undefined,
  fallbackRows: Record<string, unknown>[] | null | undefined,
): DuplicateValueLookup {
  return field => {
    const source: object | null | undefined = api ?? fallbackRows;
    if (!source) return new Set<string>();
    let perField = duplicateCache.get(source);
    if (!perField) {
      perField = new Map();
      duplicateCache.set(source, perField);
      void Promise.resolve().then(() => duplicateCache.delete(source));
    }
    let duplicates = perField.get(field);
    if (!duplicates) {
      if (api) {
        const rows: Record<string, unknown>[] = [];
        api.forEachNode(node => { if (!node.group && node.data) rows.push(node.data); });
        duplicates = findDuplicateValues(rows, field);
      } else {
        duplicates = findDuplicateValues(fallbackRows ?? [], field);
      }
      perField.set(field, duplicates);
    }
    return duplicates;
  };
}

/** First matching rule's format for a cell (first-match wins), or empty when none apply. */
export function evaluateConditionalRules(
  rules: ConditionalRule[] | undefined,
  field: string,
  rowData: Record<string, unknown> | undefined,
  duplicateLookup?: DuplicateValueLookup,
): { backgroundColor?: string; textColor?: string; bold?: boolean } {
  if (!rules?.length || !rowData) return {};
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const scope = rule.scope ?? (rule.applyToRow ? 'row' : 'column');
    // 'column': only the rule's own column cell. 'row': any cell in a row whose rule-field
    // value matches. 'report': any cell (any column/page) whose OWN value meets the condition.
    const testField = scope === 'report' ? field : rule.field;
    const testValue = rowData[testField];
    if (scope === 'column' && rule.field !== field) continue;
    const duplicates = rule.operator === 'duplicate' ? duplicateLookup?.(testField) : undefined;
    if (ruleMatches(rule, testValue, duplicates)) {
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
 * any cell overrides; inserted rows carry their stored values plus identity markers.
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
    return {
      ...(manualRows[ref.insId] ?? {}),
      [ROW_COLOR_KEY]: `manual:${ref.insId}`,
      [MANUAL_ROW_FLAG]: true,
      [MANUAL_ROW_ID]: ref.insId,
    };
  });
}

/**
 * Pure AG Grid column-building logic shared by the report builder (live preview) and
 * the report viewer (final render), so the two can never visually diverge. Extracted
 * verbatim from ReportViewerComponent — same inputs, same outputs, no behavior change.
 */

export function isNumericColumn(rows: Record<string, unknown>[], field: string): boolean {
  let sampleCount = 0;
  let numCount = 0;
  // Sample populated values so sparse columns and leading nulls do not hide numeric operations.
  for (const row of rows) {
    const v = row[field];
    if (v == null || (typeof v === 'string' && v.trim() === '')) continue;
    sampleCount++;
    if ((typeof v === 'number' || typeof v === 'string') && Number.isFinite(Number(v))) numCount++;
    if (sampleCount === 50) break;
  }
  return numCount > sampleCount * 0.5;
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

// V8's Date constructor is extremely lenient: new Date("MAURID NE-105") and new Date("105")
// both yield 01-Jan-0105, and new Date("OP-9") yields 01-Sep-2001. Free-text cell values
// (common after a Split Column transformation whose derived column is value-inferred as a
// "date") would therefore be coerced into bogus dates. Restrict the lenient fallback parse
// to strings that actually look like a date so everything else renders as its original text.
function looksLikeDateString(value: string): boolean {
  // Numeric: 15/01/2024, 15-01-2024, 1.15.2024 (optionally followed by a time component).
  if (/^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}([ T]\d.*)?$/.test(value)) return true;
  const months = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';
  // Day Month Year: 15-Jan-2024, 15 January 2024.
  if (new RegExp(`^\\d{1,2}[ /.\\-]${months}[a-z]*[ /.\\-]\\d{1,4}$`, 'i').test(value)) return true;
  // Month Day, Year: Jan 15, 2024, January 15 2024.
  if (new RegExp(`^${months}[a-z]*[ /.\\-]\\d{1,2},?[ /.\\-]?\\d{1,4}$`, 'i').test(value)) return true;
  return false;
}

/** Number display shared by the grid and PDF export: integers as-is, decimals rounded without grouping. */
export function formatGridNumberValue(value: unknown, field: string): string {
  // Percentage text (e.g. "12.5%" from an Append Text transformation, or a percent Average) keeps its "%".
  if (isPercentValue(value)) return String(value);
  if (value && typeof value === 'object' && (value as Record<string, unknown>)['__twPct']) return String(value);
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const maxFractionDigits = field === 'Northing' || field === 'Easting' ? 4 : 2;
  return Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits });
}

export function formatGridDateValue(value: unknown): string {
  if (value == null || value === '') return '';

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
    } else if (looksLikeDateString(trimmed)) {
      date = new Date(trimmed);
    } else {
      // Not a date — render the original text instead of a V8-coerced bogus date.
      return String(value);
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
  // A `rename_column` data transformation renames the displayed field while the config entry
  // stays keyed by the original source field, so resolve through the rename-aware helper.
  const resolve = createColumnConfigResolver(config);
  for (const field of displayColumns) {
    const cfgTotal = normalizeTotalAgg(resolve(field)?.total);
    if (cfgTotal === 'count') {
      // Count works on any column type: tally non-empty cells (numeric OR text).
      totals[field] = rows.reduce((n, r) => {
        const v = readRowValue(r, field);
        return v === null || v === undefined || v === '' ? n : n + 1;
      }, 0);
      hasAnyTotal = true;
    } else if (cfgTotal) {
      const value = aggregateReportValues(rows.map(r => readRowValue(r, field)), cfgTotal);
      if (value == null) { totals[field] = '—'; continue; }
      totals[field] = value;
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
  // Resolve through the rename-aware helper so a `rename_column` transformed field still finds
  // its original config entry (which carries the Total aggregation selection).
  const resolve = createColumnConfigResolver(config);
  for (const field of displayColumns) {
    const agg = normalizeTotalAgg(resolve(field)?.total);
    if (!agg) continue;
    let value: number | string;
    if (agg === 'count') {
      // Count works on any column type: tally non-empty cells (numeric OR text).
      value = rows.reduce((n, r) => {
        const v = readRowValue(r, field);
        return v === null || v === undefined || v === '' ? n : n + 1;
      }, 0);
    } else {
      const aggregated = aggregateReportValues(rows.map(r => readRowValue(r, field)), agg);
      if (aggregated == null) continue;
      value = aggregated;
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

function getHeaderColorClasses(config: ReportJsonConfig | null | undefined, field: string): string[] {
  const classes: string[] = [];
  for (const [kind, color] of [
    ['bg', resolveHeaderBackgroundColor(config, field)],
    ['fg', resolveHeaderTextColor(config, field)],
  ]) {
    if (!color || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) continue;
    const hex = color.length === 4 ? color.slice(1).split('').map(ch => ch + ch).join('') : color.slice(1);
    classes.push(`xl-${kind}-${hex.toLowerCase()}`);
  }
  return classes;
}

/**
 * Resolves a column header's BACKGROUND color from the saved config — the single precedence shared
 * by BOTH the live grid and every export path: per-cell override (`headerCellColors`) → uniform
 * header-row color (`headerRowColor`) → the column's own color. Returns undefined when nothing is
 * configured, so each caller applies its own default (the live grid leaves it to the AG Grid theme
 * header background; exporters pass an explicit hex fallback). The column color resolves a
 * Data Transformation rename back to the source column's config.
 *
 * Centralized so the viewer and its exports can never drift (the cause of the Sl.No/header color
 * export bugs) — do NOT re-inline this precedence anywhere.
 */
export function resolveHeaderBackgroundColor(
  config: ReportJsonConfig | null | undefined,
  field: string,
): string | undefined {
  return config?.headerCellColors?.[field]
    || config?.headerRowColor
    || createColumnConfigResolver(config)(field)?.color
    || undefined;
}

/**
 * Resolves a column header's TEXT color: per-cell override (`headerCellTextColors`) → uniform
 * header-row text color (`headerRowTextColor`). The column's own body text color is intentionally
 * NOT a fallback — a "Column Text color" must never bleed into the header. Returns undefined when
 * nothing is configured. Centralized alongside resolveHeaderBackgroundColor.
 */
export function resolveHeaderTextColor(
  config: ReportJsonConfig | null | undefined,
  field: string,
): string | undefined {
  return config?.headerCellTextColors?.[field]
    || config?.headerRowTextColor
    || undefined;
}

/** Generated row-group columns keep their source field in showRowGroup, not field. */
export function getReportColumnField(colDef: ColDef): string | undefined {
  return typeof colDef.showRowGroup === 'string' ? colDef.showRowGroup : colDef.field ?? colDef.colId;
}

export function buildReportAutoGroupColumnStyles(
  getConfig: () => ReportJsonConfig | null | undefined,
): Pick<ColDef, 'headerStyle' | 'headerClass' | 'cellStyle'> {
  const position = (api: GridApi, column: Column | null | undefined) => {
    const columns = api.getAllDisplayedColumns();
    const index = column ? columns.indexOf(column) : -1;
    return {
      firstCol: index === 0,
      lastCol: index >= 0 && index === columns.length - 1,
    };
  };
  return {
    headerStyle: params => {
      const config = getConfig();
      const field = getReportColumnField(params.column?.getColDef() ?? {}) ?? '';
      const pos = position(params.api, params.column);
      const sides = resolveStoredSides(config?.headerCellBorders, config?.reportBorder, field, {
        ...pos, firstRow: true, lastRow: true,
      });
      const bodySides = resolveStoredSides(config?.cellBorders, config?.reportBorder, `0:${field}`, {
        ...pos, firstRow: true, lastRow: false,
      });
      return {
        backgroundColor: resolveHeaderBackgroundColor(config, field) ?? '',
        color: resolveHeaderTextColor(config, field) ?? '',
        boxShadow: 'none',
        ...headerBorderStyles(sides, !!bodySides?.top),
      };
    },
    headerClass: params => {
      const config = getConfig();
      const field = getReportColumnField(params.column?.getColDef() ?? {}) ?? '';
      const classes: string[] = [];
      const align = config?.headerCellAlignments?.[field] ?? config?.reportAlignment;
      if (align) classes.push(`rb-header-align-${align}`);
      if (config?.headerCellOrientations?.[field] === 'vertical') classes.push('rb-header-vertical');
      classes.push(...getHeaderColorClasses(config, field));
      return classes;
    },
    cellStyle: params => {
      const config = getConfig();
      const rowIndex = params.node.rowIndex;
      const field = getReportColumnField(params.colDef) ?? '';
      const displayedField = params.colDef.colId ?? field;
      const pos = position(params.api, params.column);
      const totalRows = params.api.getDisplayedRowCount();
      const sidesAt = (index: number) => index < 0 || index >= totalRows ? null
        : resolveStoredSides(config?.cellBorders, config?.reportBorder,
          config?.cellBorders && `${index}:${displayedField}` in config.cellBorders
            ? `${index}:${displayedField}` : `${index}:${field}`, {
          ...pos, firstRow: index === 0, lastRow: index === totalRows - 1,
        });
      const sides = !params.node.rowPinned && rowIndex != null && rowIndex >= 0
        ? dedupeBorderSides(sidesAt(rowIndex), sidesAt(rowIndex - 1), null, rowIndex === totalRows - 1, pos.lastCol)
        : null;
      const colorKey = params.data?.[ROW_COLOR_KEY];
      const groupStyle = getReportGroupRowStyle(config, params.node);
      const validRow = !params.node.rowPinned && !params.node.group && rowIndex != null && rowIndex >= 0;
      const bg = groupStyle ? groupStyle.backgroundColor : validRow
        ? (typeof colorKey === 'string' ? config?.rowColorsByKey?.[colorKey] : undefined)
          ?? config?.pageRowColors?.[rowIndex] ?? config?.rowColors?.[rowIndex]
        : undefined;
      const fg = groupStyle ? groupStyle.color : validRow
        ? (typeof colorKey === 'string' ? config?.rowTextColorsByKey?.[colorKey] : undefined)
          ?? config?.rowTextColors?.[rowIndex]
        : undefined;
      return {
        backgroundColor: bg ?? '',
        color: fg ?? '',
        borderTopStyle: '', borderTopColor: '',
        borderRightStyle: '', borderRightColor: '',
        borderBottomStyle: '', borderBottomColor: '',
        borderLeftStyle: '', borderLeftColor: '',
        ...borderSideStyles(sides),
        ...(params.node.rowPinned ? getSummaryRowStyle(config, getPinnedSummaryLabel(params.node)) : {}),
      };
    },
  };
}

/**
 * Resolves a *displayed* column name back to its saved `ColumnConfig`. A `rename_column`
 * data-transformation changes the on-screen/export field name while the config entry stays
 * keyed by the original source field, so a naive `columns.find(c => c.field === name)` misses
 * it — losing that column's grouping/sub-grouping (and any other config-keyed metadata).
 *
 * Both the live grid and the exporters MUST resolve through this helper so an export's
 * group/sub-group headers match exactly what the viewer renders.
 */
export function createColumnConfigResolver(
  config: ReportJsonConfig | null | undefined,
): (field: string) => ReportJsonColumn | undefined {
  const columnSources = createColumnSourceMap(config);
  const columnConfigByField = new Map((config?.columns ?? []).map(column => [column.field, column]));
  return (field: string) => {
    const direct = columnConfigByField.get(field);
    if (direct) return direct;
    const source = columnSources.get(field);
    return source ? columnConfigByField.get(source) : undefined;
  };
}

function createColumnSourceMap(config: ReportJsonConfig | null | undefined): Map<string, string> {
  return getReportColumnSourceMap(config);
}

/** Displayed column name → source column name after the config's rename_column rules (identity for unrenamed columns). */
export function getReportColumnSourceMap(config: Pick<ReportJsonConfig, 'columns' | 'parameterFilters'> | null | undefined): Map<string, string> {
  const columnSources = new Map((config?.columns ?? []).map(column => [column.field, column.field]));
  for (const rule of config?.parameterFilters ?? []) {
    if (rule.action !== 'rename_column' || rule.enabled === false) continue;
    const name = rule.newColumnName?.trim();
    if (!name) continue;
    const targets = getRuleSourceColumns(rule).map(target =>
      [...columnSources.keys()].find(column => column.toLowerCase() === target.toLowerCase()) ?? target,
    );
    for (const target of targets) {
      const source = columnSources.get(target) ?? target;
      const renamed = targets.length === 1
        ? name
        : name.includes('{col}') || name.includes('{}')
          ? name.replace(/\{col\}|\{\}/gi, target).trim()
          : `${target}_${name}`;
      if (!renamed || renamed === target) continue;
      columnSources.delete(target);
      columnSources.set(renamed, source);
    }
  }
  return columnSources;
}

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
  const cols = config?.columns ?? [];
  const findGroupingConfig = createColumnConfigResolver(config);
  visibleFields = [...new Set([
    ...visibleFields,
    ...[...createColumnSourceMap(config)].filter(([, source]) =>
      cols.some(column => column.field === source && column.rowGroup)).map(([field]) => field),
  ])];

  const groupColor = config?.columnGroupColors?.find(color => color.level === 0)?.color;
  const subGroupColor = config?.columnGroupColors?.find(color => color.level === 1)?.color;
  // Per-group background overrides (keyed by group name), falling back to groupColor.
  const groupColors = config?.groupColors ?? {};
  // Per-sub-group background overrides (keyed by sub-group name), falling back to subGroupColor.
  const subGroupColors = config?.subGroupColors ?? {};
  const groupTextColor = config?.groupTextColor || '#FFFFFF';
  const subGroupTextColor = config?.subGroupTextColor || '#FFFFFF';
  // Per-group / per-sub-group text-color overrides (keyed by name), falling back to the globals.
  const groupTextColors = config?.groupTextColors ?? {};
  const subGroupTextColors = config?.subGroupTextColors ?? {};
  const mergedCellRanges = config?.mergedCellRanges ?? [];
  // Fields that contain at least one vertical cell — those columns get auto-height + truncation.
  const verticalFields = new Set<string>();
  for (const key of Object.keys(config?.cellOrientations ?? {})) {
    const stableField = key.startsWith('record:')
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(key.slice('record:'.length));
            return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : undefined;
          } catch {
            return undefined;
          }
        })()
      : undefined;
    const sep = key.indexOf(':');
    const field = stableField ?? (sep >= 0 ? key.slice(sep + 1) : undefined);
    if (field && config!.cellOrientations![key] === 'vertical') verticalFields.add(field);
  }
  const colByField = new Map<string, ColDef>();
  const groupOfField = new Map<string, string>();
  const subGroupOfField = new Map<string, string>();
  const seen = new Set<string>();
  // The auto '#' column is prepended (pinned left) unless the data already carries an Sl.No-style
  // column. When present it is the table's true first column, so leaf columns are no longer the
  // first column for outer/left/vertical border placement — the '#' column owns that outer edge.
  const hasRowNumber = !visibleFields.some(isSerialNumberField);
  const leafFirstCol = (field: string) => !hasRowNumber && field === visibleFields[0];

  for (const field of visibleFields) {
    if (seen.has(field)) continue;
    seen.add(field);
    const cfg = cols.find(column => column.field === field);
    // A `rename_column` data transformation renames the displayed field while its config entry
    // stays keyed by the original source field. Header / pinned / display props stay keyed by the
    // displayed field, but the aggregation (row-group Sum/Average + subtotal/grand-total rows)
    // must resolve rename-aware so a renamed numeric column still aggregates on group/total rows.
    const aggCfg = findGroupingConfig(field) ?? cfg;
    const sqlType = gridDataTypeForTransformation(config, field) ?? gridDataTypeForSqlType(columnTypes?.[field]);
    const isBoolean = sqlType ? sqlType === 'boolean' : isBooleanColumn(sampleRows, field);
    const isNum = sqlType ? sqlType === 'number' : isNumericColumn(sampleRows, field);
    const isDate = sqlType ? sqlType === 'date' : isDateColumn(sampleRows, field);
    const defaultAlign = defaultReportCellAlign((isNum && !isBoolean) || isDate);
    const alignStyle = (align: TextAlign) => ({
      textAlign: align,
      justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    });
    // Keep numeric behavior intact; untyped string values only change to a checkbox-list filter.
    const useSetFilterForNumericStrings = !sqlType && isNum &&
      sampleRows
        .filter(row => {
          const value = row[field];
          return value != null && !(typeof value === 'string' && value.trim() === '');
        })
        .slice(0, 50)
        .every(row => typeof row[field] === 'string');
    const rowMerges = mergedCellRanges.filter(r => r.field === field && isRowMerge(r));

    // Vertical headers show the full label rotated top-to-bottom; autoHeaderHeight +
    // wrapHeaderText let the header row grow taller to fit it (full name also in the tooltip).
    const headerFull = cfg?.header || field;
    const headerName = headerFull;

    const col: ColDef = {
      field,
      headerName,
      filter: isBoolean ? 'agTextColumnFilter' : (isDate ? 'agDateColumnFilter' : (isNum ? (useSetFilterForNumericStrings ? 'agSetColumnFilter' : 'agNumberColumnFilter') : 'agSetColumnFilter')),
      sortable: true,
      resizable: true,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      headerTooltip: headerFull,
      enableRowGroup: true,
      enablePivot: true,
      enableValue: (isNum && !isBoolean) || (!sqlType && isPercentColumn(sampleRows, field)),
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
      const bg = resolveHeaderBackgroundColor(c, field);
      // Header text color is independent of the column's body text color: picking a
      // "Column Text color" must not bleed into the header — only "Header Text color"
      // (per-cell) or "All headers Text color" (row-wide) affect the header text.
      const fg = resolveHeaderTextColor(c, field);
      const hb = c?.headerCellBorders;
      // Headers are a single row, so firstRow/lastRow are both true; columns use the visible order.
      const isFirstCol = leafFirstCol(field);
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
        backgroundColor: bg ?? '',
        color: fg ?? '',
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
    headerClasses.push(...getHeaderColorClasses(config, field));
    if (headerClasses.length) col.headerClass = headerClasses;

    if (isNum && !isBoolean) {
      col.type = 'numericColumn';
      col.valueFormatter = (params: ValueFormatterParams) => {
        if (params.value == null || params.value === '') return '';
        return formatGridNumberValue(params.value, field);
      };
    }

    if (isDate) {
      col.valueFormatter = (params: ValueFormatterParams) => formatGridDateValue(params.value);
    }

    if (isBoolean) {
      col.cellDataType = false;
      col.filter = 'agTextColumnFilter';
      col.cellRenderer = (params: ICellRendererParams) => {
        if (params.value == null || params.value === '') return '';
        const value = typeof params.value === 'string' ? params.value.toLowerCase() : params.value;
        return value === true || value === 'true' || value === 1 ? 'true' : 'false';
      };
      col.valueFormatter = (params: ValueFormatterParams) => {
        if (params.value == null || params.value === '') return '';
        const v = typeof params.value === 'string' ? params.value.toLowerCase() : params.value;
        return v === true || v === 'true' || v === 1 ? 'true' : 'false';
      };
    }

    // Cell coloring — live callback, precedence cell > row > column, matching getCellBackground().
    // Merged cells (either axis) also get flex-centered content, matching Excel's "merge & center".
    col.cellStyle = (params) => {
      const c = getConfig();
      const column = createColumnConfigResolver(c)(field);
      if (params.node?.rowPinned) {
        const style = {
          ...(column?.color ? { backgroundColor: column.color } : {}),
          ...(column?.textColor ? { color: column.textColor } : {}),
          ...alignStyle(c?.reportAlignment ?? defaultAlign),
          ...getSummaryRowStyle(c, getPinnedSummaryLabel(params.node)),
        };
        return Object.keys(style).length ? style : null;
      }
      const rowIndex = params.node?.rowIndex;
      // Manual colors/alignments/borders are keyed by the row's absolute index (matching where
      // they are stored), so a styled row keeps its styling on that row only — it is not repeated
      // at the same position on every pagination page.
      const groupStyle = getReportGroupRowStyle(c, params.node);
      const rowKey = (params.node?.rowPinned || params.node?.group || rowIndex == null || rowIndex < 0)
        ? undefined
        : rowIndex;
      const cellKey = rowKey != null ? `${rowKey}:${field}` : undefined;
      const manualBg = groupStyle
        ? groupStyle.backgroundColor || column?.color
        : getReportCellSetting(c?.cellColors, params.data, rowIndex, field)
        || (params.data?.[ROW_COLOR_KEY] != null ? c?.rowColorsByKey?.[String(params.data[ROW_COLOR_KEY])] : undefined)
        || (rowKey != null ? c?.pageRowColors?.[rowKey] : undefined)
        || (rowKey != null ? c?.rowColors?.[rowKey] : undefined)
        || column?.color;
      const manualFg = groupStyle
        ? groupStyle.color || column?.textColor
        : getReportCellSetting(c?.cellTextColors, params.data, rowIndex, field)
        || (params.data?.[ROW_COLOR_KEY] != null
          ? c?.rowTextColorsByKey?.[String(params.data[ROW_COLOR_KEY])]
          : undefined)
        || (rowKey != null ? c?.rowTextColors?.[rowKey] : undefined)
        || column?.textColor;

      // Conditional formatting wins over manual paint (skip the totals row); manual fills gaps.
      const cf = params.node?.rowPinned || params.node?.group
        ? {}
        : evaluateConditionalRules(c?.conditionalRules, field, params.data, createDuplicateValueLookup(params.api, sampleRows));
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
        ? getReportCellSetting(c?.cellOrientations, params.data, rowIndex, field) === 'vertical'
        : false;
      // Aggregated value cells (e.g. "Average: 0.05" on group/total rows) render bold.
      const isAggCell = !!aggCfg?.aggFunc && (params.node?.group === true || params.node?.footer === true);
      // Manual horizontal alignment wins over merge-centering; otherwise unmerged cells use the Excel-style default.
      const manualAlign = getReportCellSetting(c?.cellAlignments, params.data, rowIndex, field) ?? c?.reportAlignment;
      const align = manualAlign ?? (isMerged ? undefined : defaultAlign);
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
            firstCol: colI === 0 && !hasRowNumber,
            lastCol: colI === lastColIdx,
          });
        };
        const own = sidesAt(rowIndex, field, colIdx);
        const above = sidesAt(rowIndex - 1, field, colIdx);
        const leftN = colIdx > 0 ? sidesAt(rowIndex, visibleFields[colIdx - 1], colIdx - 1) : null;
        sides = dedupeBorderSides(own, above, leftN, totalRows > 0 && rowIndex === totalRows - 1, colIdx === lastColIdx);
      }
      const hasBorder = hasAnyBorderSide(sides);
      if (!isMerged && !bg && !fg && !vertical && !cf.bold && !isAggCell && !align && !hasBorder && !groupStyle) return null;
      return {
        ...(isMerged ? { display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } : {}),
        ...(bg ? { backgroundColor: bg } : {}),
        ...(fg ? { color: fg } : {}),
        ...((cf.bold || isAggCell) ? { fontWeight: '700' } : {}),
        ...(align ? alignStyle(align) : {}),
        ...borderSideStyles(sides),
        ...(groupStyle ? { backgroundColor: bg ?? '', color: fg ?? '' } : {}),
      };
    };
    // Inline data bars (numeric columns only). Declared before the vertical-text wrapper below so
    // vertical cells keep rendering rotated and every other cell draws its bar.
    if ((isNum || isPercentColumn(sampleRows, field)) && !isBoolean && config?.dataBarColumns?.includes(field)) {
      let max = 0;
      for (const row of sampleRows) {
        const value = row[field];
        const number = value == null || value === '' ? NaN : coerceNumberAllowPercent(value);
        if (Number.isFinite(number) && number > max) max = number;
      }
      const drawBar = dataBarCellRenderer(max, config.dataBarColor || DEFAULT_DATA_BAR_COLOR);
      const plainRenderer = col.cellRenderer as ((p: ICellRendererParams) => unknown) | undefined;
      col.cellRenderer = (params: ICellRendererParams) => {
        if (params.node?.group || params.node?.rowPinned || params.node?.footer || params.value == null || params.value === '') {
          return plainRenderer ? plainRenderer(params) : (params.valueFormatted ?? (params.value == null ? '' : String(params.value)));
        }
        return drawBar(params);
      };
    }

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
          getReportCellSetting(getConfig()?.cellOrientations, params.data, params.node?.rowIndex, field) === 'vertical',
      };
      const baseRenderer = col.cellRenderer as ((p: ICellRendererParams) => unknown) | undefined;
      col.cellRenderer = (params: ICellRendererParams) => {
        const isVertical = getReportCellSetting(getConfig()?.cellOrientations, params.data, params.node?.rowIndex, field) === 'vertical';
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
    const pinnedSide = (cfg ?? aggCfg)?.pinned;
    const isPinned = pinnedSide || config?.pinnedColumns?.includes(field);
    if (isPinned) {
      col.pinned = pinnedSide || 'left';
    }

    // Row grouping — grouped columns are normally hidden so their values show only in the
    // group column (no duplicated data). But when a grouped column also carries an
    // aggregation, keep it visible: multipleColumns' group column only shows the group key,
    // so the aggregate has nowhere else to render — the visible column shows the sum/average
    // on group/total rows (and the raw value on leaf rows). aggFunc drives that number below.
    // Always set rowGroup/hide explicitly: on a columnDefs update AG Grid RETAINS a column's
    // prior grouping (and hidden) state for any property left undefined, so omitting them here
    // meant unchecking a grouped column never actually ungrouped it (its panel chip lingered too).
    if (aggCfg?.rowGroup) {
      col.rowGroup = true;
      if (typeof aggCfg.rowGroupIndex === 'number') col.rowGroupIndex = aggCfg.rowGroupIndex;
      col.hide = !aggCfg.aggFunc;
    } else {
      col.rowGroup = false;
      col.rowGroupIndex = null;
      col.hide = false;
    }
    // Map to the numeric-coercing aggregations so string data still sums/averages correctly.
    if (aggCfg?.aggFunc === 'sum') col.aggFunc = 'numSum';
    else if (aggCfg?.aggFunc === 'avg') col.aggFunc = 'numAvg';
    else if (aggCfg?.aggFunc) col.aggFunc = aggCfg.aggFunc;

    // The per-column "Total" selection (Sum/Average/Count) also drives AG Grid's grand-total
    // and group-subtotal rows, which aggregate via aggFunc — without this those rows render
    // blank ("—") for columns that only set a Total (and no row-group aggregation).
    if (!col.aggFunc) {
      const totalAgg = normalizeTotalAgg(aggCfg?.total);
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
    const groupingConfig = findGroupingConfig(field);
    const grp = groupingConfig?.group?.trim();
    const sub = groupingConfig?.subGroup?.trim();
    colByField.set(field, col);
    if (grp) groupOfField.set(field, grp);
    if (sub) subGroupOfField.set(field, sub);
  }

  const defs: (ColDef | ColGroupDef)[] = [];
  // Skip the auto row-number column when the data already carries an Sl.No-style column.
  if (hasRowNumber) {
    const rowNumBase: Record<string, string> = { fontWeight: '600', color: '#667085', textAlign: 'center' };
    defs.push({
      colId: ROW_NUMBER_COL_ID,
      headerName: getConfig()?.rowNumberHeader?.trim() || '#',
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
      headerClass: () => getHeaderColorClasses(getConfig(), ROW_NUMBER_COL_ID),
      // '#' is the table's first column — give its header/cells the report-wide border so an
      // "all"/"outer"/"vertical" placement outlines the serial column too (live via getConfig()).
      headerStyle: () => {
        const c = getConfig();
        const type = c?.reportBorder;
        const sides = type ? borderSidesFor(type, { firstRow: true, lastRow: true, firstCol: true, lastCol: false }) : null;
        const row0OwnsTop = !!type && !!borderSidesFor(type, { firstRow: true, lastRow: false, firstCol: true, lastCol: false }).top;
        return {
          backgroundColor: resolveHeaderBackgroundColor(c, ROW_NUMBER_COL_ID) ?? '',
          color: resolveHeaderTextColor(c, ROW_NUMBER_COL_ID) ?? '',
          ...headerBorderStyles(sides, row0OwnsTop),
        };
      },
      cellStyle: (p: CellClassParams) => {
        if (p.node?.rowPinned) {
          return { ...rowNumBase, ...getSummaryRowStyle(getConfig(), getPinnedSummaryLabel(p.node)) };
        }
        const groupStyle = getReportGroupRowStyle(getConfig(), p.node);
        const type = getConfig()?.reportBorder;
        if (!type || p.node?.rowPinned) return { ...rowNumBase, ...groupStyle };
        const total = p.api?.getDisplayedRowCount?.() ?? 0;
        const ri = p.node?.rowIndex ?? 0;
        const sides = borderSidesFor(type, { firstRow: ri === 0, lastRow: total > 0 && ri === total - 1, firstCol: true, lastCol: false });
        return { ...rowNumBase, ...borderSideStyles(sides), ...groupStyle };
      },
    } as ColDef);
  }
  // Preserve column order: a grouped column's header is inserted at the position of the
  // FIRST field of that group (not appended after every ungrouped column), so grouping a
  // column never moves it — or its neighbors — away from where the user placed it.
  const placedGroups = new Set<string>();
  const placedStandaloneSubs = new Set<string>();
  // Live header style for a group/sub-group bar: its saved background plus the report-wide border
  // (so an "all"/"outer"/… placement also outlines the grouping tiers). A header tier never owns
  // its bottom edge — the tier directly below paints that shared line as its top — so pass
  // bodyOwnsBottom=true. `getConfig()` keeps it live so applyBorder → refreshHeader repaints it.
  const groupHeaderStyle = (memberFields: string[], isTopTier: boolean, bg: string | undefined, fgColor: string): HeaderStyleFunc => {
    return () => {
      const type = getConfig()?.reportBorder;
      let border: Record<string, string> = {};
      if (type) {
        const idxs = memberFields.map(f => visibleFields.indexOf(f)).filter(i => i >= 0);
        if (idxs.length) {
          const sides = borderSidesFor(type, {
            firstRow: isTopTier,
            lastRow: false,
            firstCol: !hasRowNumber && Math.min(...idxs) === 0,
            lastCol: Math.max(...idxs) === visibleFields.length - 1,
          });
          border = headerBorderStyles(sides, true);
        }
      }
      return { ...(bg ? { backgroundColor: bg, color: fgColor } : {}), ...border };
    };
  };
  // Group/sub-group header identity + live alignment class (re-read on header refresh).
  const groupHeaderMeta = (ref: ReportHeaderGroupRef): Pick<ColGroupDef, 'context' | 'headerClass'> => ({
    context: { reportHeaderGroup: ref },
    headerClass: () => [`rb-group-align-${resolveGroupHeaderAlign(getConfig(), ref)}`],
  });
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
        headerStyle: groupHeaderStyle(subFields, false, sgColor, subGroupTextColors[sub] || subGroupTextColor),
        ...groupHeaderMeta({ level: 'subGroup', name: sub }),
        wrapHeaderText: true,
        autoHeaderHeight: true,
        children: subChildren,
      } as ColGroupDef;
      defs.push({
        groupId: `subgrp-wrap:${sub}`,
        headerName: '',
        headerStyle: groupHeaderStyle(subFields, true, undefined, subGroupTextColor),
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
      const subMemberFields = subMembers.map(c => c.field).filter((f): f is string => !!f);
      const sgColor = subGroupColors[subGroup] || subGroupColor;
      groupChildren.push({
        groupId: `grp:${grp}>${subGroup}`,
        headerName: subGroup,
        headerStyle: groupHeaderStyle(subMemberFields, false, sgColor, subGroupTextColors[subGroup] || subGroupTextColor),
        ...groupHeaderMeta({ level: 'subGroup', name: subGroup }),
        wrapHeaderText: true,
        autoHeaderHeight: true,
        children: subMembers,
      } as ColGroupDef);
    }

    defs.push({
      groupId: `grp:${grp}`,
      headerName: grp,
      headerStyle: groupHeaderStyle(groupFields, true, groupColors[grp] || groupColor, groupTextColors[grp] || groupTextColor),
      ...groupHeaderMeta({ level: 'group', name: grp }),
      wrapHeaderText: true,
      autoHeaderHeight: true,
      children: groupChildren,
    } as ColGroupDef);
  }

  return defs;
}

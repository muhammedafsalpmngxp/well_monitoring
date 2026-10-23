import type { ColDef, ICellRendererParams, IRowNode } from 'ag-grid-community';
import type { CfOperator, ConditionalRule } from '../../features/reports/shared/report-config.model';
import { DateUtil } from './date.util';
import { coerceNumberAllowPercent, isPercentValue } from './percent-number.util';

/** Table grid options shared by the chart builder's table preview and saved with the chart design. */
export interface TableGridOptions {
  /** Header names of columns pinned to the left. */
  pinnedColumns: string[];
  /** Header names grouped into expandable rows (in order). */
  groupBy: string[];
  groupExpanded: boolean;
  groupSubtotals: boolean;
  grandTotal: boolean;
  /** Header names of numeric columns drawn with an inline bar. */
  dataBarColumns: string[];
  dataBarColor: string;
  wrapText: boolean;
  conditionalRules: ConditionalRule[];
}

export const DEFAULT_DATA_BAR_COLOR = '#2948A3';

export function defaultTableGridOptions(): TableGridOptions {
  return {
    pinnedColumns: [],
    groupBy: [],
    groupExpanded: false,
    groupSubtotals: false,
    grandTotal: false,
    dataBarColumns: [],
    dataBarColor: DEFAULT_DATA_BAR_COLOR,
    wrapText: false,
    conditionalRules: [],
  };
}

/** Copies saved options, tolerating charts saved before these options existed. */
export function cloneTableGridOptions(source: Partial<TableGridOptions> | null | undefined): TableGridOptions {
  const base = defaultTableGridOptions();
  if (!source) return base;
  return {
    pinnedColumns: [...(source.pinnedColumns ?? base.pinnedColumns)],
    groupBy: [...(source.groupBy ?? base.groupBy)],
    groupExpanded: source.groupExpanded ?? base.groupExpanded,
    groupSubtotals: source.groupSubtotals ?? base.groupSubtotals,
    grandTotal: source.grandTotal ?? base.grandTotal,
    dataBarColumns: [...(source.dataBarColumns ?? base.dataBarColumns)],
    dataBarColor: source.dataBarColor || base.dataBarColor,
    wrapText: source.wrapText ?? base.wrapText,
    conditionalRules: (source.conditionalRules ?? base.conditionalRules).map(rule => ({ ...rule })),
  };
}

/** True when any option differs from the defaults, so untouched charts keep an unchanged design. */
export function hasTableGridOptions(options: TableGridOptions | null | undefined): options is TableGridOptions {
  if (!options) return false;
  return options.pinnedColumns.length > 0 || options.groupBy.length > 0 || options.groupExpanded
    || options.groupSubtotals || options.grandTotal || options.dataBarColumns.length > 0
    || options.dataBarColor !== DEFAULT_DATA_BAR_COLOR || options.wrapText || options.conditionalRules.length > 0;
}

export const TABLE_CF_OPERATORS: { id: CfOperator; label: string; needsValue: boolean; needsSecondValue?: boolean }[] = [
  { id: 'gt', label: 'Greater than', needsValue: true },
  { id: 'gte', label: 'Greater than or equal', needsValue: true },
  { id: 'lt', label: 'Less than', needsValue: true },
  { id: 'lte', label: 'Less than or equal', needsValue: true },
  { id: 'eq', label: 'Equal to', needsValue: true },
  { id: 'neq', label: 'Not equal to', needsValue: true },
  { id: 'between', label: 'Between', needsValue: true, needsSecondValue: true },
  { id: 'contains', label: 'Contains', needsValue: true },
  { id: 'startsWith', label: 'Starts with', needsValue: true },
  { id: 'isEmpty', label: 'Is empty', needsValue: false },
  { id: 'notEmpty', label: 'Is not empty', needsValue: false },
];

export interface TableColumnStat {
  numeric: boolean;
  /** Largest value in the column; the data bar of that value fills the cell. */
  max: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A column is numeric when it has numbers and every other cell is blank ("—" counts as blank). */
export function computeTableColumnStats(rows: readonly { values: readonly unknown[]; summary?: boolean }[], columnCount: number): TableColumnStat[] {
  const stats: TableColumnStat[] = Array.from({ length: columnCount }, () => ({ numeric: false, max: 0 }));
  const hasText = new Array<boolean>(columnCount).fill(false);
  for (const row of rows) {
    if (row.summary) continue;
    for (let index = 0; index < columnCount; index++) {
      const value = row.values[index];
      if (value == null || value === '' || value === '—') continue;
      const number = toFiniteNumber(value);
      if (number === null) { hasText[index] = true; continue; }
      const stat = stats[index];
      stat.numeric = true;
      if (number > stat.max) stat.max = number;
    }
  }
  return stats.map((stat, index) => ({ numeric: stat.numeric && !hasText[index], max: stat.max }));
}

/** Cell renderer drawing a proportional bar behind the formatted number. */
export function dataBarCellRenderer(max: number, color: string): (params: ICellRendererParams) => HTMLElement {
  return params => {
    const number = toFiniteNumber(isPercentValue(params.value) ? coerceNumberAllowPercent(params.value) : params.value);
    const percent = number !== null && number > 0 && max > 0 ? Math.min(100, (number / max) * 100) : 0;
    const host = document.createElement('div');
    host.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:0;top:15%;height:70%;border-radius:3px;opacity:0.35;pointer-events:none;';
    bar.style.width = `${percent}%`;
    bar.style.background = color;
    const label = document.createElement('span');
    label.style.cssText = 'position:relative;padding-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    label.textContent = String(params.valueFormatted ?? params.value ?? '');
    host.append(bar, label);
    return host;
  };
}

/** A rule is only applied once its column and the values its condition needs are filled in. */
export function isTableCfRuleComplete(rule: ConditionalRule): boolean {
  if (!rule.field || rule.enabled === false) return false;
  const blank = (value: unknown) => value == null || String(value).trim() === '';
  const operator = TABLE_CF_OPERATORS.find(option => option.id === rule.operator);
  if (operator?.needsValue && blank(rule.value)) return false;
  return !operator?.needsSecondValue || !blank(rule.value2);
}

/**
 * Grouping, pinning, aggregation and bars for one column. Every property is set explicitly: on a
 * columnDefs update AG Grid keeps the old value of any property left undefined, so a column would
 * stay grouped/hidden/pinned after the option was cleared. Grouped columns stay visible so their
 * values still show on the leaf rows.
 */
export function applyTableGridColumnOptions(def: ColDef, headerName: string, stat: TableColumnStat | undefined, grid: TableGridOptions): void {
  const grouped = grid.groupBy.includes(headerName);
  const aggregate = grid.groupBy.length > 0 || grid.grandTotal;
  def.pinned = grid.pinnedColumns.includes(headerName) ? 'left' : null;
  def.rowGroup = grouped;
  def.rowGroupIndex = grouped ? grid.groupBy.indexOf(headerName) : null;
  def.hide = false;
  def.aggFunc = !grouped && aggregate && stat?.numeric ? 'numSum' : null;
  if (stat?.numeric && grid.dataBarColumns.includes(headerName)) {
    def.cellRenderer = dataBarCellRenderer(stat.max, grid.dataBarColor);
  }
}

/** Leaf row data behind a row node; a group row yields every row in the group. */
export function drillLeafData<T>(node: IRowNode): T[] {
  const leaves = node.group ? node.allLeafChildren ?? [] : [node];
  return leaves.map(leaf => leaf.data as T | undefined).filter((data): data is T => !!data);
}

/** One column per key found in the drilled records. */
export function buildDrillColumns(records: readonly Record<string, unknown>[], hideKey: (key: string) => boolean = () => false): ColDef[] {
  const keys = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) if (!hideKey(key)) keys.add(key);
  return [...keys].map((key, index) => ({
    colId: `drill-${index}`,
    headerName: key,
    headerTooltip: key,
    valueGetter: params => params.data?.[key],
    valueFormatter: params => DateUtil.formatCellValue(params.value),
  }));
}

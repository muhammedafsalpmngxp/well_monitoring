/**
 * Single shared shape for the report definition persisted as `TenantReportDto.reportJson`.
 * Both the report builder (author side) and the report viewer (render side) must use
 * these exact interfaces — they are two independent consumers of the same JSON string,
 * kept in sync by this shared file instead of by convention.
 *
 * All fields are additive-only: never rename or repurpose an existing field, only add
 * new optional ones. Older saved reports won't have the newer fields, and every reader
 * must treat their absence as "feature not used", not as an error.
 */

import { ParameterFilterRule } from '../../../core/utils/parameter-filter.util';

export type TableDensity = 'comfortable' | 'compact' | 'dense';

export type { DaxModelConfig } from '../../../core/utils/dax-evaluator.util';
import type { DaxModelConfig } from '../../../core/utils/dax-evaluator.util';

export interface ColumnConfig {
  shown: boolean;
  group: string;
  subGroup: string;
  total: string;
  color: string;
  /** True for columns inserted manually in the builder (blank, editable), not from the data source. */
  custom?: boolean;
  /** Custom display name for the column header (defaults to the field name). */
  header?: string;
  textColor?: string;
}

export type CalcOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'percentage';

export interface CalculatedField {
  name: string;
  columnA: string;
  columnB: string;
  operation: CalcOperation | string;
}
// Conditional formatting types and interfaces.

export type CfOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'between' | 'contains' | 'startsWith' | 'isEmpty' | 'notEmpty'
  /** Value occurs more than once in the column (case-insensitive, trimmed; blanks never match). */
  | 'duplicate';

/** How far a conditional-formatting match spreads: just the rule's column cell, the whole
 * matched row, or every cell in the report (any column/page) whose own value meets the condition. */
export type CfScope = 'column' | 'row' | 'report';

/** One Excel-style conditional-formatting rule, evaluated live per cell at render time. */
export interface ConditionalRule {
  id: string;
  /** Column whose value the condition is tested against. */
  field: string;
  operator: CfOperator;
  value?: string | number;
  /** Upper bound for the 'between' operator. */
  value2?: string | number;
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  /** Match spread: 'column' (default), 'row', or 'report'. */
  scope?: CfScope;
  /** @deprecated Legacy flag, superseded by scope==='row'. Kept for reading old saved configs. */
  applyToRow?: boolean;
  enabled?: boolean;
}

export interface ColumnGroupColorRow {
  label: string;
  level: number;
  color: string;
}

/** One merged rectangular cell region, anchored at its top-left cell. */
export interface MergedCellRange {
  /** Row index (in the report's unsorted preview/data order) of the top-left cell. */
  rowIndex: number;
  /** Field of the top-left cell. */
  field: string;
  /** Number of rows this merge spans, including the anchor row. */
  rowSpan: number;
  /** Number of columns this merge spans, including the anchor column. */
  colSpan: number;
}

export interface ReportJsonColumn {
  field: string;
  header: string;
  shown?: boolean;
  group?: string;
  subGroup?: string;
  total?: string;
  color?: string;
  custom?: boolean;
  textColor?: string;
  pinned?: 'left' | 'right' | null;
  /** True when this column is used to group rows (AG Grid row grouping). */
  rowGroup?: boolean;
  /** Zero-based order of this column within the row-group hierarchy. */
  rowGroupIndex?: number;
  /** Aggregation applied to this column's values in group rows: 'sum' | 'avg'. */
  aggFunc?: string;
  /** Background color applied to this field's group title rows in the grid. */
  rowGroupColor?: string;
}

/**
 * One row in the report's manual (Excel-like) row layout: either a reference to a
 * source data row (by its index in data order) or a manually inserted blank row (by id).
 */
export type RowLayoutRef = { src: number } | { insId: string };

import type { GlobalFilterSelection } from '../../../core/utils/global-filter-selection.util';

export interface ReportJsonConfig {
  columns?: ReportJsonColumn[];
  filters?: { key: string; label: string; value: GlobalFilterSelection }[];
  sortBy?: string;
  groupBy?: string;
  metric?: string;
  showTotals?: boolean;
  subtotalAfterGroup?: boolean;
  grandTotalAtBottom?: boolean;
  selectedReportType?: string | null;
  headerTitle?: string;
  headerSubtitle?: string;
  headerSubtitle2?: string;
  bannerText?: string;
  /** Custom secondary banner title, retained across cluster changes until cleared. */
  clusterBannerText?: string;
  /** Normalized cluster-selection key associated with the custom title. */
  clusterBannerSelection?: string;
  /** Builder defaults to checked for a selected cluster, unchecked for All; saves the visibility choice. */
  customClusterBannerEnabled?: boolean;
  headerBackgroundColor?: string;
  headerTextColor?: string;
  bannerBackgroundColor?: string;
  bannerTextColor?: string;
  headerRowColor?: string;
  columnGroupColors?: ColumnGroupColorRow[];
  /** Per-group background color, keyed by group name; falls back to the level-0 columnGroupColors color. */
  groupColors?: Record<string, string>;
  /** Per-sub-group background color, keyed by sub-group name; falls back to the level-1 columnGroupColors color. */
  subGroupColors?: Record<string, string>;
  groupTextColor?: string;
  subGroupTextColor?: string;
  /** Per-group text color, keyed by group name; falls back to the global groupTextColor. */
  groupTextColors?: Record<string, string>;
  /** Per-sub-group text color, keyed by sub-group name; falls back to the global subGroupTextColor. */
  subGroupTextColors?: Record<string, string>;
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  rightLogoColor?: string;
  fontFamily?: string;
  fontSize?: number;
  headerFontSize?: number;
  bannerFontSize?: number;
  tableHeadingFontSize?: number;
  /** Column-header row height in px (adjustable in the builder's Appearance panel). */
  gridHeaderHeight?: number;
  rowColors?: Record<number, string>;
  /** Row background keyed by a source record identity or a `group:` field/key path. */
  rowColorsByKey?: Record<string, string>;
  /** Row text color keyed by a source record identity or a `group:` field/key path. */
  rowTextColorsByKey?: Record<string, string>;
  /** Pinned aggregate-row colors keyed by their stable label (Sum, Avg, Count, Total, Min, Max). */
  summaryRowColors?: Record<string, string>;
  summaryRowTextColors?: Record<string, string>;
  /** Row background by position within a page from 0, propagated to that row on every page. */
  pageRowColors?: Record<number, string>;
  /** Page size used when pageRowColors positions were assigned (defaults to 20). */
  paginationPageSize?: number;
  /** Cell background colors, keyed by stable record+field key; legacy `${rowIndex}:${field}` keys remain supported. */
  cellColors?: Record<string, string>;
  headerCellColors?: Record<string, string>;
  headerRowTextColor?: string;
  rowTextColors?: Record<number, string>;
  /** Cell text colors, keyed by stable record+field key; legacy `${rowIndex}:${field}` keys remain supported. */
  cellTextColors?: Record<string, string>;
  headerCellTextColors?: Record<string, string>;
  pinnedColumns?: string[];
  /** Numeric columns drawn with an inline data bar. */
  dataBarColumns?: string[];
  dataBarColor?: string;
  bannerCompanyName?: string;
  bannerContractInfo?: string;
  bannerReportLabel?: string;
  calculatedFields?: CalculatedField[];
  pageOrientation?: string;
  pageSize?: string;
  /** New, additive: manual cell-range merges created in the AG Grid builder/viewer. */
  mergedCellRanges?: MergedCellRange[];
  /** Manual Excel-like row order (insert/delete). Absent = source rows as-is, in data order. */
  rowLayout?: RowLayoutRef[];
  /** Values for manually inserted blank rows, keyed by their insId. */
  manualRows?: Record<string, Record<string, unknown>>;
  /** Source-row cell edits and custom-column values, keyed `${sourceRowIndex}:${field}`. */
  cellOverrides?: Record<string, unknown>;
  /** Source-row indices removed via "Delete Row" (kept so grown data never resurrects them). */
  deletedRowIndices?: number[];
  /** Embedded sub-grids ("Split Cells") per cell, keyed by stable record+field key; legacy index keys remain supported. */
  cellEmbeds?: Record<string, CellEmbed>;
  /** Vertical (bottom-to-top) text per data cell, keyed by stable record+field key; legacy index keys remain supported. */
  cellOrientations?: Record<string, TextOrientation>;
  /** Vertical (bottom-to-top) text per header cell, keyed by field. Absent = horizontal. */
  headerCellOrientations?: Record<string, TextOrientation>;
  /** Horizontal text alignment per data cell, keyed by stable record+field key; legacy index keys remain supported. */
  cellAlignments?: Record<string, TextAlign>;
  /** Horizontal text alignment per header cell, keyed by field. Absent = theme default. */
  headerCellAlignments?: Record<string, TextAlign>;
  /** Report-wide horizontal text alignment (all cells and headers), overridden by the per-cell/per-header maps. */
  reportAlignment?: TextAlign;
  /** Horizontal alignment per column-group header, keyed by group name. Absent = report alignment, else center. */
  groupHeaderAlignments?: Record<string, TextAlign>;
  /** Horizontal alignment per column sub-group header, keyed by sub-group name. Absent = report alignment, else center. */
  subGroupHeaderAlignments?: Record<string, TextAlign>;
  /** Per-side outlined border for a data cell, keyed by position; absent = inherit reportBorder; present (even empty) = explicit override. */
  cellBorders?: Record<string, CellBorder>;
  /** Per-side outlined border for a header cell, keyed by field. Absent = inherit reportBorder. */
  headerCellBorders?: Record<string, CellBorder>;
  /** Report-wide border placement (all cells and headers), overridden by the per-cell/per-header maps. */
  reportBorder?: BorderType;
  /** Custom header text for the auto row-number ('#') column. Absent/empty = default '#'. */
  rowNumberHeader?: string;
  /** Id of the last-applied built-in theme preset (drives the theme dropdown's selection). */
  themeId?: string;
  /** Accent color of the applied built-in theme; used for branded row striping in builder + viewer. */
  themeAccent?: string;
  /** Opt-in branded zebra striping, saved per sheet with themeAccent for matching builder/viewer rows. */
  brandedRows?: boolean;
  /** Report-level Excel-style conditional-formatting rules, evaluated live per cell. */
  conditionalRules?: ConditionalRule[];
  /** DAX Model: calculated measures shown as extra columns (row scope) or a totals value (column scope). */
  daxModel?: DaxModelConfig;
  /** Optional color swatches and descriptions shown above this sheet's report grid. */
  legends?: ReportLegendItem[];
  /** Row-level data filters that scope which source rows the report shows. */
  conditionalFilters?: ReportConditionalFilter[];
  /** Parameter-driven data transformation rules (Data Transformation section), applied to preview rows. */
  parameterFilters?: ParameterFilterRule[];
  /**
   * Template setups only: 'source' when column-keyed formatting is keyed by source column names
   * (so it maps onto any target report's renames). Absent = keyed by the displayed column names.
   */
  columnKeyBasis?: 'source' | 'display';
  /**
   * Excel-like multiple pages. When present with >1 entry, the report has multiple sheets;
   * each carries its own data source + full config. The top-level fields above mirror the
   * FIRST sheet so older single-page readers still render page 1. Absent = single-page report.
   */
  sheets?: ReportSheetConfig[];
}

export interface ReportLegendItem {
  color: string;
  label: string;
}

/** One page/sheet of a multi-sheet report: its tab name, data source, and full config. */
export interface ReportSheetConfig {
  name: string;
  sourceName: string;
  sourceType: string;
  config: ReportJsonConfig;
}

/** Reading direction of a cell/header's text. */
export type TextOrientation = 'horizontal' | 'vertical';

/** Horizontal alignment of a cell/header's text. */
export type TextAlign = 'left' | 'center' | 'right';

/** Which sides of a cell/header carry an outlined border. An empty object = explicitly no border. */
export interface CellBorder {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

/** Google-Sheets-style border placement applied to a selection, a column/header, or the whole report. */
export type BorderType = 'all' | 'inner' | 'horizontal' | 'vertical' | 'outer' | 'top' | 'bottom' | 'left' | 'right';

/** A row-level data filter (column + condition) that scopes which source rows the report shows. */
export interface ReportConditionalFilter {
  id: number;
  label: string;
  /** The report's source name (display only). */
  sourceTable: string;
  sourceColumn: string;
  /** One of: contains | starts with | ends with | equals | greater than. */
  operator: string;
  valueText: string;
  /** 'Include' keeps matching rows; 'Exclude' inverts the condition. */
  mode: string;
  /** Show toggle: when false (eye open) the filter is applied; when true (eye closed) it is skipped. */
  hidden: boolean;
}

/** A cell subdivided into a grid of blank editable sub-cells (rows × cols). */
export interface CellEmbed {
  rows: number;
  cols: number;
  /** Sub-cell values, keyed `${subRow}:${subCol}`. */
  values?: Record<string, unknown>;
  /** Excel-style conditional-formatting rules, evaluated live per cell. */
  conditionalRules?: ConditionalRule[];
}

import { DbSchemaColumn, DbSchemaTable } from '../../core/services/common-api.service';
import { DatasetDetail, QueryFilter, QueryRequest } from '../../core/services/model-studio.service';
import { dataPaneTables, tableKey } from '../model-studio/model-studio.util';
import {
  BrandKit, ItemStyle, PageSize, PageStyle, isImageSource, readBrandKit, readItemStyle, readPageSize, readPageStyle, richTextPlain,
} from './canvas-style.util';
import { CanvasFilter, FieldKind, filtersQuery, isFilterList, readFilters, relativeStart } from './canvas-filter.util';

/** Permission module code for the canvas pages. */
export const CANVAS_MODULE = 'dashboard.canvas';

export const CANVAS_COLUMNS = 20;
export const CHART_ROW_LIMIT = 50;
/** A scatter or bubble chart shows a point per row, so it reads more rows than a chart of bars. */
const POINT_ROW_LIMIT = 500;
export const TABLE_ROW_LIMIT = 200;
/** A chart split into series reads one row per category and series (P10-4). */
export const SERIES_ROW_LIMIT = 400;
/** At most this many series are drawn; the rest are left out and the chart says so (P10-4). */
export const MAX_SERIES = 8;
/** Totals come first, so this cut only drops detail rows (P10-11). */
export const MATRIX_ROW_LIMIT = 500;
export const MATRIX_MAX_ROW_FIELDS = 3;
export const SLICER_VALUE_LIMIT = 500;
export const MAX_RULES = 20;
/** Text is stored in the canvas config, which the API caps at 64 KB. */
export const TEXT_MAX_LENGTH = 2000;
/** Same bound as the dashboard layout (MAX_LAYOUT_ROWS). */
export const MAX_ROWS = 200;

export type CanvasItemType = 'chart' | 'tile' | 'table' | 'matrix' | 'slicer' | 'text' | 'image';
export type CanvasChartType =
  | 'column' | 'bar' | 'line' | 'area' | 'combo' | 'pie' | 'donut' | 'treemap' | 'waterfall' | 'funnel' | 'scatter' | 'bubble' | 'bullet';

export const CHART_TYPES: CanvasChartType[] = [
  'column', 'bar', 'line', 'area', 'combo', 'pie', 'donut', 'treemap', 'waterfall', 'funnel', 'scatter', 'bubble', 'bullet',
];
/** Chart types that can split their measure into series by a second field (P10-4). */
export const SERIES_CHART_TYPES: CanvasChartType[] = ['column', 'bar', 'line', 'area'];
/** Chart types that show one measure (P10-5). */
export const ONE_MEASURE_CHARTS: CanvasChartType[] = ['pie', 'donut', 'treemap', 'waterfall', 'funnel'];
/** Chart types that read in field order; the others show the largest values first. */
const IN_FIELD_ORDER: CanvasChartType[] = ['line', 'area', 'combo', 'waterfall'];
const ITEM_TYPES: CanvasItemType[] = ['chart', 'tile', 'table', 'matrix', 'slicer', 'text', 'image'];
const IMAGE_URL_PROBLEM = 'Use an address that starts with https://, a path on this site that starts with /, or upload a png, jpeg, gif or webp under 300 KB.';

const CHART_NAMES: Record<CanvasChartType, string> = {
  column: 'column chart', bar: 'bar chart', line: 'line chart', area: 'area chart', combo: 'combo chart',
  pie: 'pie chart', donut: 'donut chart', treemap: 'treemap', waterfall: 'waterfall chart', funnel: 'funnel',
  scatter: 'scatter chart', bubble: 'bubble chart', bullet: 'bullet chart',
};

export type NumberStyle = 'number' | 'compact' | 'percent' | 'currency';
/** How an object writes its numbers (P10-8): decimals from 0 to 6, and an ISO currency code such as OMR. */
export interface NumberFormat { style: NumberStyle; decimals: number; currency?: string; }
const NUMBER_STYLES: NumberStyle[] = ['number', 'compact', 'percent', 'currency'];

export type RuleOp = 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'eq' | 'neq' | 'contains' | 'blank';
export type RuleTone = 'good' | 'warn' | 'bad';
/** A conditional formatting rule of a table or matrix (P10-10). */
export interface FormatRule { field: string; op: RuleOp; values: string[]; tone: RuleTone; }
export const RULE_OPS: RuleOp[] = ['gt', 'gte', 'lt', 'lte', 'between', 'eq', 'neq', 'contains', 'blank'];
const RULE_TONES: RuleTone[] = ['good', 'warn', 'bad'];

/** How a slicer shows, as in Power BI: by the kind of its field (SLICER_STYLES). */
export type SlicerStyle = 'list' | 'dropdown' | 'tiles' | 'between' | 'before' | 'after' | 'relative';
export type RelativeUnit = 'days' | 'months' | 'years';

/**
 * A slicer's choice (P10-1): the ticked values (list), a from and a to where either may be empty (range; before keeps
 * only the to, after only the from), or the last n days, months or years (relative). style is how it shows, single
 * allows one value only, and sync names the other sheets the choice applies to: every sheet, or the named ones.
 */
export interface SlicerState {
  kind: 'list' | 'range' | 'relative';
  values: string[];
  style?: SlicerStyle;
  single?: boolean;
  last?: { n: number; unit: RelativeUnit };
  sync?: 'all' | string[];
}

export const SLICER_STYLE_LABELS: Record<SlicerStyle, string> = {
  list: 'Vertical list', dropdown: 'Dropdown', tiles: 'Tiles', between: 'Between', before: 'Before (up to)',
  after: 'After (from)', relative: 'Relative dates',
};

/** The slicer styles a field offers: text lists values; numbers and dates also take ranges; dates take relative periods. */
export const SLICER_STYLES: Record<FieldKind, SlicerStyle[]> = {
  text: ['list', 'dropdown', 'tiles'],
  number: ['between', 'before', 'after', 'list', 'dropdown', 'tiles'],
  date: ['between', 'before', 'after', 'relative', 'list', 'dropdown'],
};

/** A slicer's style; slicers saved before styles show as a list or as from and to. */
export function slicerStyle(state: SlicerState | undefined): SlicerStyle {
  if (state?.style) return state.style;
  return state?.kind === 'range' ? 'between' : state?.kind === 'relative' ? 'relative' : 'list';
}

/** The choice a style keeps: values for the lists, from and to for the ranges, a period for relative dates. */
export function slicerKindOf(style: SlicerStyle): SlicerState['kind'] {
  if (style === 'relative') return 'relative';
  return style === 'between' || style === 'before' || style === 'after' ? 'range' : 'list';
}

/** The names under which a range or relative slicer reads the lowest and highest value of its field. */
export const SLICER_LOW = 'Lowest value';
export const SLICER_HIGH = 'Highest value';

/** The point clicked on a chart: the chart, its first field and the value, null for a blank (P10-3). Not saved. */
/** Charts that drill down through the fields of their axis, one level at a time. */
const DRILL_CHARTS: CanvasChartType[] = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'treemap', 'funnel'];
export const MAX_DRILL_LEVELS = 4;
/** The levels a date field dropped on a drillable axis becomes, as Power BI's date hierarchy. */
export const DATE_LEVELS = ['year', 'quarter', 'month', 'day'] as const;

/** A chart whose axis can hold a hierarchy of fields to drill through. */
export function canDrill(item: CanvasItem): boolean {
  return item.type === 'chart' && DRILL_CHARTS.includes(item.chartType ?? 'column') && !item.series;
}

/**
 * The chart at a drill level: the field of the level after the chosen values, filtered to those values. A chart with
 * one field is itself. path holds the value chosen at each level above.
 */
export function drillView(item: CanvasItem, path: (string | null)[] = []): { item: CanvasItem; filters: QueryFilter[] } {
  if (item.type !== 'chart' || item.dimensions.length < 2) return { item, filters: [] };
  const level = Math.min(path.length, item.dimensions.length - 1);
  return {
    item: { ...item, dimensions: [item.dimensions[level]] },
    filters: path.slice(0, level).map((value, i): QueryFilter => value === null
      ? { field: item.dimensions[i], op: 'is_null' } : { field: item.dimensions[i], op: 'eq', values: [value] }),
  };
}

/**
 * The columns Show records lists for an object: those of the table its first measure adds up (a field's own table for
 * a value added up on the object, else the measure's home table), or of its first field's table. Hidden columns are
 * left out. ponytail: 15 columns and rows that are the same in all of them show once; add a row key column if needed.
 */
export function recordFields(item: CanvasItem, dataset: DatasetDetail, columns: ReadonlyMap<string, DbSchemaColumn[]>): string[] {
  const measure = [item.xMeasure, ...item.measures].find(Boolean);
  const value = measure ? item.aggregates?.[measure] : undefined;
  const homeId = dataset.measures.find(candidate => candidate.name === measure)?.homeSourceId;
  const home = value ? value.field.slice(0, value.field.indexOf('.'))
    : dataset.sources.find(source => source.id === homeId)?.alias ?? item.dimensions[0]?.slice(0, item.dimensions[0].indexOf('.'));
  const table = dataPaneTables(dataset, columns, '', true).find(candidate => candidate.source.alias === home);
  return (table?.fields ?? []).slice(0, 15).map(field => `${home}.${field.name}`);
}

/** A field as people read it: its column, with the level of a date hierarchy in brackets, as "action_on (Year)". */
export function levelLabel(field: string, names: Record<string, string> = {}): string {
  const at = field.lastIndexOf('@');
  const base = at > 0 ? field.slice(0, at) : field;
  const shown = names[base] ?? base.slice(base.indexOf('.') + 1);
  return at > 0 ? `${shown} (${field.charAt(at + 1).toUpperCase()}${field.slice(at + 2)})` : shown;
}

export type SortOrder = 'axis_asc' | 'axis_desc' | 'value_desc' | 'value_asc';
const SORT_ORDERS: SortOrder[] = ['axis_asc', 'axis_desc', 'value_desc', 'value_asc'];

/**
 * The sort a chart asks for, and the field it adds to the query for it: a sort-by field is grouped by too, so it can
 * order the rows. It should hold one value per axis value, as a month number does for a month name.
 */
function chartSort(item: CanvasItem, type: CanvasChartType): { sort: QueryRequest['sort']; extra: string[] } {
  const axis = item.dimensions[0];
  const order = item.sortOrder ?? (IN_FIELD_ORDER.includes(type) ? 'axis_asc' : 'value_desc');
  if (order === 'value_desc' || order === 'value_asc') return { sort: { field: item.measures[0], descending: order === 'value_desc' }, extra: [] };
  const by = item.sortBy && item.sortBy !== axis ? item.sortBy : axis;
  return { sort: { field: by, descending: order === 'axis_desc' }, extra: by === axis ? [] : [by] };
}

/** A click on chart points: the values of the source's first field that are chosen (Ctrl adds more). */
export interface CrossFilter { sourceId: string; field: string; values: (string | null)[]; }

/** How a visual answers a click on another visual, as Power BI's Edit interactions: filter it, highlight in it, or nothing. */
export type Interaction = 'filter' | 'highlight' | 'none';
const INTERACTIONS: Interaction[] = ['filter', 'highlight', 'none'];

/** Charts that can highlight part of each bar or point; the others are filtered instead. */
const HIGHLIGHT_CHARTS: CanvasChartType[] = ['column', 'bar', 'line', 'area', 'combo'];

/** What a chart highlights: the chosen values of a field, and the filter that reads the highlighted part. */
export interface Highlight { field: string; values: (string | null)[]; filter: QueryFilter; }

/**
 * One object on a sheet: its place on the grid and what it shows. A type alias, not an interface, so
 * that it fits Gridster's GridsterItemConfig, which has a string index signature.
 */
export type CanvasItem = {
  id: string;
  type: CanvasItemType;
  title: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  /** The dataset a data object queries: the canvas dataset, or another one on canvases saved before D-14. Null for text and images. */
  datasetId: number | null;
  /** Fields to group by, as "alias.column". */
  dimensions: string[];
  /** Measure names, and the names of fields added up on the object (aggregates). */
  measures: string[];
  /** Values made from a field on this object only, by the name they show under; the model is not changed. */
  aggregates?: Record<string, FieldAggregate>;
  /** Charts only. */
  chartType?: CanvasChartType;
  /** Text objects only: plain text, shown as written. */
  text?: string;
  /** Image objects only: an https address or a path on this site, and a description for screen readers. */
  imageUrl?: string;
  alt?: string;
  /** Column, bar, line and area charts: a second field that splits the measure into series. */
  series?: string;
  stacking?: 'normal' | 'percent' | null;
  dataLabels?: boolean;
  format?: NumberFormat;
  /** Tables and matrices. */
  rules?: FormatRule[];
  /** Tiles: a target measure or a fixed target, a measure to compare with, and the target bands. */
  target?: string;
  /** Scatter and bubble charts: the measure on the X-axis (Y is the first of measures) and, for a bubble, its size. */
  xMeasure?: string;
  sizeMeasure?: string;
  /** Charts: measures shown in the tooltip of each point, besides what the chart draws. */
  tooltips?: string[];
  /** How the object answers a click on another visual; filter when not set. */
  interaction?: Interaction;
  /**
   * Charts: the order of the axis. axis sorts by the axis field, or by sortBy when set (a month number for month
   * names); value by the first measure. Not set: in field order for lines, areas, combos and waterfalls, else biggest first.
   */
  sortOrder?: SortOrder;
  sortBy?: string;
  targetValue?: number | null;
  compare?: string;
  /** Percent of the target from which the card turns amber instead of red; 90 when not set. */
  warnAt?: number;
  lowerIsBetter?: boolean;
  /** A tile shown as a gauge up to its target. */
  gauge?: boolean;
  /** Matrices: subtotals and a grand total, on unless false. */
  totals?: boolean;
  /** Slicers. */
  slicer?: SlicerState;
  /** How the object looks: the Format pane's general and visual settings (canvas-style.util). */
  style?: ItemStyle;
  /** Filters on this visual, from the Filters pane. */
  filters?: CanvasFilter[];
  /** Text and images only: placed freely over the sheet, in page pixels, instead of on the grid. */
  float?: FloatBox;
};

/** Where a floating text or image sits over the sheet and how big it is, in page pixels from the top left. */
export interface FloatBox { x: number; y: number; w: number; h: number; }

/** How a field is added up in a value well: sum, average, minimum, maximum, count or distinct count. */
export type ValueFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';

/** A field in a value well: "alias.column", how it is added up, and the kind of its values. */
export interface FieldAggregate { field: string; fn: ValueFn; kind: 'number' | 'date' | 'text'; }

/** A sheet: its name, its objects, its page settings (background, wallpaper, theme, spacing) and its Filters pane filters. */
export interface CanvasSheet { name: string; items: CanvasItem[]; page?: PageStyle; filters?: CanvasFilter[]; }

/**
 * Stored in core.Dashboard.ConfigJson. kind tells every listing and reader that this row is not a v1 dashboard.
 * datasetId is the canvas dataset (D-14); canvases saved before it have none (see readCanvasDataset).
 */
export interface CanvasConfig {
  kind: 'canvas';
  layout: {
    version: 2; columns: number; sheets: CanvasSheet[]; datasetId?: number | null; filters?: CanvasFilter[]; fields?: CanvasFields;
    brand?: BrandKit; size?: PageSize; bookmarks?: CanvasBookmark[];
  };
}

/**
 * A saved view of the canvas, as a Power BI bookmark: the sheet it opens, the slicers' choices (by object id), the
 * Filters pane's filters on all pages and per sheet (by sheet name), and the points chosen by a click.
 */
export interface CanvasBookmark {
  name: string;
  sheet: string;
  slicers: Record<string, SlicerState>;
  filters: CanvasFilter[];
  pageFilters: Record<string, CanvasFilter[]>;
  cross?: CrossFilter | null;
}

export const MAX_BOOKMARKS = 20;

/** What a canvas keeps besides its sheets and dataset: filters on all pages, canvas-only names, brand kit, page size and bookmarks. */
export interface CanvasExtras {
  filters?: CanvasFilter[]; fields?: CanvasFields | null; brand?: BrandKit | null; size?: PageSize | null; bookmarks?: CanvasBookmark[];
}

/**
 * Names and hiding for this canvas only, set from the Data pane's menu; the dataset is not changed. Keys are fields
 * ("alias.column") and measure names. A renamed entry shows under its new name in the Data pane and on the objects.
 */
export interface CanvasFields { names: Record<string, string>; hidden: string[]; }

const MAX_FIELD_ENTRIES = 500;

const DEFAULT_SIZE: Record<CanvasItemType, { cols: number; rows: number }> = {
  chart: { cols: 10, rows: 12 },
  tile: { cols: 5, rows: 6 },
  table: { cols: 10, rows: 12 },
  matrix: { cols: 10, rows: 12 },
  slicer: { cols: 4, rows: 8 },
  text: { cols: 6, rows: 4 },
  image: { cols: 6, rows: 8 },
};

const DEFAULT_TITLE: Record<CanvasItemType, string> = {
  chart: 'New chart', tile: 'New tile', table: 'New table', matrix: 'New matrix', slicer: 'New slicer', text: 'Text', image: 'Image',
};

/** The settings a saved object may carry besides its place and its fields; stored only when set. */
const EXTRA_KEYS = [
  'series', 'stacking', 'dataLabels', 'format', 'rules', 'target', 'targetValue', 'compare', 'xMeasure', 'sizeMeasure', 'tooltips', 'interaction', 'sortOrder', 'sortBy', 'warnAt', 'lowerIsBetter', 'gauge', 'totals', 'slicer', 'style',
  'aggregates', 'filters', 'float',
] as const;

/** Every object but text and images shows dataset results. */
export function isDataItem(type: CanvasItemType): boolean {
  return type !== 'text' && type !== 'image';
}

/** The config of a new canvas: one empty sheet and no dataset yet. */
export function newCanvasConfig(): string {
  return serializeCanvas([{ name: 'Sheet 1', items: [] }]);
}

/**
 * kind first, then the layout, with the canvas dataset and the filters on all pages after the sheets. Only the stored
 * properties of each object are written.
 */
export function serializeCanvas(sheets: CanvasSheet[], datasetId: number | null = null, extras: CanvasExtras = {}): string {
  const { filters = [], fields = null, brand = null, size = null, bookmarks = [] } = extras;
  const config: CanvasConfig = {
    kind: 'canvas',
    layout: {
      version: 2,
      columns: CANVAS_COLUMNS,
      sheets: sheets.map(sheet => ({
        name: sheet.name, items: sheet.items.map(stored),
        ...(sheet.page ? { page: sheet.page } : {}),
        ...(sheet.filters?.length ? { filters: sheet.filters } : {}),
      })),
      datasetId,
      ...(filters.length ? { filters } : {}),
      ...(fields && (Object.keys(fields.names).length || fields.hidden.length) ? { fields } : {}),
      ...(brand ? { brand } : {}),
      ...(size ? { size } : {}),
      ...(bookmarks.length ? { bookmarks } : {}),
    },
  };
  return JSON.stringify(config);
}

/**
 * The sheets of a stored canvas, or null when the JSON is not a canvas: v1 dashboards have no kind
 * and stay with the dashboard reader. Objects with an unknown type, a place off the grid or a broken
 * setting are dropped, a blank sheet name is replaced, and a canvas always has at least one sheet.
 */
export function readCanvasConfig(configJson: string | null | undefined): CanvasSheet[] | null {
  let config: Partial<CanvasConfig> | null;
  try {
    config = JSON.parse(configJson ?? '');
  } catch {
    return null;
  }
  if (config?.kind !== 'canvas' || config.layout?.version !== 2) return null;
  const sheets = (Array.isArray(config.layout.sheets) ? config.layout.sheets : []).map((sheet, index): CanvasSheet => {
    const page = readPageStyle(sheet?.page);
    const filters = readFilters(sheet?.filters);
    return {
      name: typeof sheet?.name === 'string' && sheet.name.trim() ? sheet.name.trim() : `Sheet ${index + 1}`,
      items: (Array.isArray(sheet?.items) ? sheet.items : []).filter(isPlaceable).map(withCheckedStyle),
      ...(page ? { page } : {}),
      ...(filters?.length ? { filters } : {}),
    };
  });
  return sheets.length ? sheets : [{ name: 'Sheet 1', items: [] }];
}

/**
 * The canvas dataset (D-14). Canvases saved before it store none; for them it is the dataset of the first
 * data object that has one, in sheet order, so they open unchanged. Null when nothing names one.
 */
export function readCanvasDataset(configJson: string | null | undefined): number | null {
  const sheets = readCanvasConfig(configJson);
  if (!sheets) return null;
  const saved = (JSON.parse(configJson as string) as CanvasConfig).layout.datasetId;
  if (typeof saved === 'number' && Number.isInteger(saved)) return saved;
  return sheets.flatMap(sheet => sheet.items).find(item => isDataItem(item.type) && item.datasetId !== null)?.datasetId ?? null;
}

/** The filters on all pages of a stored canvas; none when it has no valid ones. */
export function readCanvasFilters(configJson: string | null | undefined): CanvasFilter[] {
  if (!readCanvasConfig(configJson)) return [];
  return readFilters((JSON.parse(configJson as string) as CanvasConfig).layout.filters) ?? [];
}

/** The bookmarks of a stored canvas, each checked for its shape; a broken one is left out. */
export function readCanvasBookmarks(configJson: string | null | undefined): CanvasBookmark[] {
  if (!readCanvasConfig(configJson)) return [];
  const raw = (JSON.parse(configJson as string) as CanvasConfig).layout.bookmarks;
  if (!Array.isArray(raw)) return [];
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  return raw.flatMap((mark): CanvasBookmark[] => {
    if (!isRecord(mark) || typeof mark['name'] !== 'string' || typeof mark['sheet'] !== 'string') return [];
    const slicers = isRecord(mark['slicers'])
      ? Object.fromEntries(Object.entries(mark['slicers']).filter(([, state]) => isRecord(state) && isSlicer(state as unknown as SlicerState)))
      : {};
    const pageFilters = isRecord(mark['pageFilters'])
      ? Object.fromEntries(Object.entries(mark['pageFilters']).map(([sheet, list]) => [sheet, readFilters(list) ?? []]))
      : {};
    const cross = mark['cross'];
    const crossOk = isRecord(cross) && typeof cross['sourceId'] === 'string' && typeof cross['field'] === 'string'
      && Array.isArray(cross['values']) && cross['values'].every(value => value === null || typeof value === 'string');
    return [{
      name: mark['name'].slice(0, 60), sheet: mark['sheet'], slicers: slicers as Record<string, SlicerState>,
      filters: readFilters(mark['filters']) ?? [], pageFilters, ...(crossOk ? { cross: cross as unknown as CrossFilter } : {}),
    }];
  }).slice(0, MAX_BOOKMARKS);
}

/** The canvas-only field names and hidden fields of a stored canvas; empty ones when it has none or they are broken. */
export function readCanvasFields(configJson: string | null | undefined): CanvasFields {
  const empty: CanvasFields = { names: {}, hidden: [] };
  if (!readCanvasConfig(configJson)) return empty;
  const fields = (JSON.parse(configJson as string) as CanvasConfig).layout.fields as Partial<CanvasFields> | undefined;
  if (typeof fields !== 'object' || fields === null) return empty;
  const names = typeof fields.names === 'object' && fields.names !== null && !Array.isArray(fields.names)
    ? Object.fromEntries(Object.entries(fields.names)
      .filter(([key, name]) => typeof name === 'string' && name.trim() && name.length <= 100)
      .slice(0, MAX_FIELD_ENTRIES))
    : {};
  const hidden = Array.isArray(fields.hidden) ? fields.hidden.filter(key => typeof key === 'string').slice(0, MAX_FIELD_ENTRIES) : [];
  return { names, hidden };
}

/** The brand kit and page size of a stored canvas; null for each it does not have or has broken. */
export function readCanvasLook(configJson: string | null | undefined): { brand: BrandKit | null; size: PageSize | null } {
  if (!readCanvasConfig(configJson)) return { brand: null, size: null };
  const layout = (JSON.parse(configJson as string) as CanvasConfig).layout;
  return { brand: readBrandKit(layout.brand), size: readPageSize(layout.size) };
}

/** A new object of the given type at the left edge, below everything already on the sheet. Only data objects take the dataset. */
export function newItem(type: CanvasItemType, existing: CanvasItem[], datasetId: number | null): CanvasItem {
  const size = DEFAULT_SIZE[type];
  return {
    id: newItemId(),
    type,
    title: DEFAULT_TITLE[type],
    x: 0,
    y: bottomOf(existing, size.rows),
    ...size,
    datasetId: isDataItem(type) ? datasetId : null,
    dimensions: [],
    measures: [],
    ...(type === 'chart' ? { chartType: 'column' as const } : {}),
    ...(type === 'text' ? { text: '' } : {}),
    ...(type === 'image' ? { imageUrl: '', alt: '' } : {}),
    ...(type === 'matrix' ? { totals: true } : {}),
    ...(type === 'slicer' ? { slicer: { kind: 'list' as const, values: [] } } : {}),
  };
}

/**
 * A copy of an object for the clone button and paste: every setting and filter, a new id and the same size. It goes
 * right of the original when that space is free, else under it, else under everything; the grid does not overlap objects.
 */
export function copyItem(item: CanvasItem, existing: CanvasItem[]): CanvasItem {
  const copy = JSON.parse(JSON.stringify(item)) as CanvasItem;
  // A floating copy lands a little down and to the right of the original.
  if (copy.float) return { ...copy, id: newItemId(), float: { ...copy.float, x: copy.float.x + 16, y: copy.float.y + 16 } };
  const free = (x: number, y: number) => x >= 0 && x + item.cols <= CANVAS_COLUMNS && y + item.rows <= MAX_ROWS
    && !existing.some(other => x < other.x + other.cols && other.x < x + item.cols && y < other.y + other.rows && other.y < y + item.rows);
  const spot = [[item.x + item.cols, item.y], [item.x, item.y + item.rows]].find(([x, y]) => free(x, y))
    ?? [0, bottomOf(existing, item.rows)];
  return { ...copy, id: newItemId(), x: spot[0], y: spot[1] };
}

function newItemId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The first row under every object, kept on the grid. */
function bottomOf(existing: CanvasItem[], rows: number): number {
  return Math.min(existing.reduce((lowest, item) => Math.max(lowest, item.y + item.rows), 0), MAX_ROWS - rows);
}

/** The object with its style as the checks keep it; a style with nothing valid left is dropped. */
function withCheckedStyle(item: CanvasItem): CanvasItem {
  if (item.style === undefined) return item;
  const { style, ...rest } = item;
  const checked = readItemStyle(style);
  return checked ? { ...rest, style: checked } : rest;
}

/** What the object still needs before it can be shown, or '' when it is complete. */
export function itemProblem(item: CanvasItem): string {
  if (item.type === 'text') return item.text?.trim() || richTextPlain(item.style?.html) ? '' : 'Write the text.';
  if (item.type === 'image') return imageUrlProblem(item.imageUrl ?? '');
  if (item.datasetId === null) return 'Choose a data model.';
  switch (item.type) {
    case 'chart':
      return chartProblem(item);
    case 'tile':
      if (item.measures.length !== 1 || item.dimensions.length) return 'Choose one measure.';
      return item.gauge && !item.target && !isFiniteNumber(item.targetValue)
        ? 'A gauge needs a target. Drag a measure onto Target, or enter a target value.'
        : '';
    case 'table':
      return item.dimensions.length || item.measures.length ? '' : 'Choose at least one field or measure.';
    case 'matrix':
      if (!item.dimensions.length || !item.measures.length) return 'Choose at least one field for Rows and one measure for Values.';
      return item.dimensions.length > MATRIX_MAX_ROW_FIELDS ? `A matrix groups by up to ${MATRIX_MAX_ROW_FIELDS} fields. Remove one from Rows.` : '';
    case 'slicer':
      return item.dimensions.length === 1 && !item.measures.length ? '' : 'Choose one field to slice by.';
    default:
      return '';
  }
}

/** Charts that can show several measures side by side with no axis field: one bar per measure, as the metric lists of view charts do. */
const MEASURE_AXIS_CHARTS: CanvasChartType[] = ['column', 'bar'];

/** True when the chart has no axis field and draws one bar per measure instead. */
export function measuresOnAxis(item: CanvasItem): boolean {
  return item.type === 'chart' && !item.dimensions.length && !item.series && item.measures.length > 0
    && MEASURE_AXIS_CHARTS.includes(item.chartType ?? 'column');
}

function chartProblem(item: CanvasItem): string {
  const type = item.chartType ?? 'column';
  if (measuresOnAxis(item)) return '';
  if (item.dimensions.length > 1 && canDrill(item)) {
    if (item.dimensions.length > MAX_DRILL_LEVELS) return `A chart drills through up to ${MAX_DRILL_LEVELS} fields. Remove one from the axis.`;
  } else if (item.dimensions.length !== 1) return 'Choose one field to group by.';
  if (!item.measures.length) return 'Choose at least one measure.';
  if (ONE_MEASURE_CHARTS.includes(type) && item.measures.length > 1) return `A ${CHART_NAMES[type]} shows one measure. Keep one.`;
  if (type === 'combo' && item.measures.length < 2) return 'A combo chart needs two measures: the first is drawn as columns, the rest as lines.';
  if ((type === 'scatter' || type === 'bubble') && (!item.xMeasure || item.measures.length !== 1)) {
    return `A ${CHART_NAMES[type]} needs one measure on the X-axis and one on the Y-axis.`;
  }
  if (type === 'bubble' && !item.sizeMeasure) return 'A bubble chart needs a measure for Size.';
  if (type === 'bullet' && item.measures.length > 1) return 'A bullet chart shows one measure against its target. Keep one.';
  if (type === 'bullet' && !item.target) return 'A bullet chart needs a target. Drag a measure onto Target.';
  if (item.series && SERIES_CHART_TYPES.includes(type)) {
    if (item.series === item.dimensions[0]) return 'Choose a different field for Legend than for the X-axis.';
    if (item.measures.length > 1) return 'Legend splits one measure. Keep one measure, or remove the Legend field.';
  }
  return '';
}

/** An image must be https, a path on this site, or a small embedded png, jpeg, gif or webp. javascript:, http: and //host are refused. */
export function imageUrlProblem(value: string): string {
  const url = value.trim();
  if (!url) return 'Enter the address of the image.';
  return isImageSource(url) ? '' : IMAGE_URL_PROBLEM;
}

/**
 * The POST /api/query request for a data object, or null while it is incomplete. Text and images have none.
 * filters are the sheet's (sheetFilters); they are sent only when there are some.
 */
export function itemQuery(item: CanvasItem, filters: QueryFilter[] = []): QueryRequest | null {
  // A chart with a hierarchy is read one level at a time; unless told otherwise, at its top level.
  if (item.type === 'chart' && item.dimensions.length > 1) item = drillView(item).item;
  if (!isDataItem(item.type) || item.datasetId === null || itemProblem(item)) return null;
  const query: QueryRequest = {
    datasetId: item.datasetId, dimensions: item.dimensions, measures: item.measures, ...(filters.length ? { filters } : {}),
  };
  const full = queryFor(item, query);
  if (!full) return null;
  // Fields added up on the object travel with the query; the server makes them for this query only.
  const values = full.measures.filter(name => item.aggregates?.[name])
    .map(name => ({ name, field: item.aggregates![name].field, fn: item.aggregates![name].fn }));
  return values.length ? { ...full, values } : full;
}

function queryFor(item: CanvasItem, query: QueryRequest): QueryRequest | null {
  switch (item.type) {
    case 'tile':
      // The value, its target and its comparison in one query, so the three always agree.
      return { ...query, measures: unique([...item.measures, item.target, item.compare]) };
    case 'table':
      // A table with fields and values gets its grand total from the server, as a matrix does, unless it is turned off.
      return { ...query, topN: TABLE_ROW_LIMIT, ...(item.totals !== false && item.dimensions.length && item.measures.length ? { totals: true } : {}) };
    case 'matrix':
      return { ...query, topN: MATRIX_ROW_LIMIT, ...(item.totals !== false ? { totals: true } : {}) };
    case 'slicer': {
      const field = item.dimensions[0];
      // Ranges and relative dates show the field's lowest and highest value; lists show its values.
      if (slicerKindOf(slicerStyle(item.slicer)) !== 'list') {
        return {
          ...query, dimensions: [], measures: [SLICER_LOW, SLICER_HIGH],
          values: [{ name: SLICER_LOW, field, fn: 'min' }, { name: SLICER_HIGH, field, fn: 'max' }],
        };
      }
      return { ...query, measures: [], topN: SLICER_VALUE_LIMIT, sort: { field, descending: false } };
    }
    case 'chart': {
      const type = item.chartType ?? 'column';
      // One row holds every measure; there is no axis to sort or cut.
      if (measuresOnAxis(item)) return query;
      if (item.series && SERIES_CHART_TYPES.includes(type)) {
        const ordered = chartSort({ ...item, sortOrder: item.sortOrder?.startsWith('axis') ? item.sortOrder : 'axis_asc' }, type);
        return {
          ...query, dimensions: [item.dimensions[0], item.series, ...ordered.extra], topN: SERIES_ROW_LIMIT, sort: ordered.sort,
          // The legend keeps its biggest values, and a bar or column axis its biggest categories, so the row limit is not
          // used up by the first category alone. A line or area axis keeps every value in order.
          filters: [
            ...(query.filters ?? []),
            { field: item.series, op: 'top', values: [String(MAX_SERIES), item.measures[0]] },
            ...(IN_FIELD_ORDER.includes(type) ? [] : [{ field: item.dimensions[0], op: 'top' as const, values: [String(CHART_ROW_LIMIT), item.measures[0]] }]),
          ],
        };
      }
      // Tooltip measures ride along in the same query, so they describe the same rows.
      const tips = item.tooltips ?? [];
      const ordered = chartSort(item, type);
      return {
        ...query,
        ...(ordered.extra.length ? { dimensions: [...query.dimensions, ...ordered.extra] } : {}),
        ...(tips.length ? { measures: unique([...query.measures, ...tips]) } : {}),
        // A bullet chart reads its target in the same query, as a card does.
        ...(type === 'bullet' ? { measures: unique([...item.measures, item.target, ...tips]) } : {}),
        ...(type === 'scatter' || type === 'bubble'
          ? { measures: unique([item.xMeasure, ...item.measures, type === 'bubble' ? item.sizeMeasure : undefined, ...tips]) } : {}),
        topN: type === 'scatter' || type === 'bubble' ? POINT_ROW_LIMIT : CHART_ROW_LIMIT,
        sort: ordered.sort,
      };
    }
    default:
      return null;
  }
}

/**
 * The filters an object gets (P10-2, P10-3): the Filters pane's filters on all pages, on the sheet and on the object,
 * every slicer on the canvas dataset that has a choice, and the point clicked on another chart. An object is never
 * filtered by its own slicer or its own click, and an object on another dataset gets none, because the fields belong
 * to the canvas dataset. scoped holds the filters on all pages and on the sheet.
 */
export function sheetFilters(
  items: CanvasItem[], target: CanvasItem, datasetId: number | null, cross: CrossFilter | null, scoped: CanvasFilter[] = [],
  synced: CanvasItem[] = [],
): QueryFilter[] {
  if (!isDataItem(target.type) || isForeign(target, datasetId)) return [];
  const filters = [...filtersQuery(scoped), ...filtersQuery(target.filters)];
  // Slicers of other sheets that sync to this one (item 21) filter it as its own slicers do.
  filters.push(...[...items, ...synced]
    .filter(item => item.type === 'slicer' && item.id !== target.id && !isForeign(item, datasetId) && item.dimensions.length === 1)
    .flatMap(item => slicerFilters(item.dimensions[0], item.slicer)));
  if (cross && cross.sourceId !== target.id && target.interaction !== 'none' && !highlightFor(target, cross)) filters.push(crossQuery(cross));
  return filters;
}

/** The chosen values as one filter; a blank value needs is_null, as "in" cannot hold it. */
export function crossQuery(cross: CrossFilter): QueryFilter {
  const values = cross.values.filter((value): value is string => value !== null);
  const blank = values.length < cross.values.length;
  const listed: QueryFilter = values.length === 1 ? { field: cross.field, op: 'eq', values } : { field: cross.field, op: 'in', values };
  if (!blank) return listed;
  return values.length ? { field: cross.field, op: 'any', any: [listed, { field: cross.field, op: 'is_null' }] } : { field: cross.field, op: 'is_null' };
}

/**
 * What a chart highlights after a click, or null when it is filtered or left alone. The clicked chart highlights its
 * own points. A chart set to Highlight dims the rest of each bar or line: one measure, not split into series, of a
 * kind that can draw it; any other visual set to Highlight is filtered, as Power BI does for tables and cards.
 */
export function highlightFor(target: CanvasItem, cross: CrossFilter | null): Highlight | null {
  if (!cross || target.type !== 'chart') return null;
  const own = cross.sourceId === target.id;
  const drawable = HIGHLIGHT_CHARTS.includes(target.chartType ?? 'column') && !target.series
    && (target.measures.length === 1 || cross.field === target.dimensions[0]);
  if (!own && (target.interaction !== 'highlight' || !drawable)) return null;
  if (own && cross.field !== target.dimensions[0]) return null;
  return { field: cross.field, values: cross.values, filter: crossQuery(cross) };
}

// ponytail: a blank value cannot be chosen in a list slicer, because "in" cannot hold a null. Add an "in or is_null" filter kind if users need it.
export function slicerFilters(field: string, state: SlicerState | undefined, today = new Date()): QueryFilter[] {
  if (!state) return [];
  if (state.kind === 'list') return state.values.length ? [{ field, op: 'in', values: state.values }] : [];
  if (state.kind === 'relative') {
    const last = state.last;
    return last && Number.isInteger(last.n) && last.n > 0
      ? [{ field, op: 'gte', values: [relativeStart(`last_${last.unit}`, last.n, today)] }] : [];
  }
  const [from = '', to = ''] = state.values.map(value => value.trim());
  if (from && to) return [{ field, op: 'between', values: [from, to] }];
  if (from) return [{ field, op: 'gte', values: [from] }];
  return to ? [{ field, op: 'lte', values: [to] }] : [];
}

/** Choosing another dataset clears the fields and measures, which belonged to the old one. */
export function withDataset(item: CanvasItem, datasetId: number | null): CanvasItem {
  if (item.datasetId === datasetId) return item;
  const { aggregates: _dropped, ...rest } = item;
  return { ...rest, datasetId, dimensions: [], measures: [] };
}

/** Every data object on the dataset; those that were on another one lose their fields and measures. */
export function moveToDataset(items: CanvasItem[], datasetId: number | null): CanvasItem[] {
  return items.map(item => (isDataItem(item.type) ? withDataset(item, datasetId) : item));
}

/** A data object that still queries another dataset than the canvas: a canvas saved before D-14. */
export function isForeign(item: CanvasItem, datasetId: number | null): boolean {
  return isDataItem(item.type) && item.datasetId !== null && item.datasetId !== datasetId;
}

/** Objects of the dataset that show the measure show it under its new name. */
export function renameMeasure(items: CanvasItem[], datasetId: number, from: string, to: string): CanvasItem[] {
  return items.map(item => (item.datasetId === datasetId && item.measures.includes(from)
    ? { ...item, measures: item.measures.map(name => (name === from ? to : name)) }
    : item));
}

/** Catalogue columns by table key, in column order: the map the Model Studio dialogs and the Data pane take. */
export function columnMap(tables: DbSchemaTable[]): Map<string, DbSchemaColumn[]> {
  return new Map(tables.map(table => [
    tableKey(table.schemaName, table.tableName),
    [...table.columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition),
  ]));
}

function stored(item: CanvasItem): CanvasItem {
  return {
    id: item.id, type: item.type, title: item.title, x: item.x, y: item.y, cols: item.cols, rows: item.rows,
    datasetId: item.datasetId, dimensions: item.dimensions, measures: item.measures,
    ...(item.type === 'chart' ? { chartType: item.chartType ?? 'column' } : {}),
    ...(item.type === 'text' ? { text: item.text ?? '' } : {}),
    ...(item.type === 'image' ? { imageUrl: item.imageUrl ?? '', alt: item.alt ?? '' } : {}),
    ...(Object.fromEntries(EXTRA_KEYS.filter(key => item[key] !== undefined).map(key => [key, item[key]])) as Partial<CanvasItem>),
  };
}

function isPlaceable(item: CanvasItem): boolean {
  return !!item && typeof item.id === 'string' && item.id !== ''
    && ITEM_TYPES.includes(item.type)
    && [item.x, item.y, item.cols, item.rows].every(value => Number.isInteger(value) && value >= 0)
    && item.cols > 0 && item.rows > 0
    && item.x + item.cols <= CANVAS_COLUMNS && item.y + item.rows <= MAX_ROWS
    && (item.datasetId === null || Number.isInteger(item.datasetId))
    && Array.isArray(item.dimensions) && Array.isArray(item.measures)
    && (item.interaction === undefined || INTERACTIONS.includes(item.interaction))
    && (item.sortOrder === undefined || SORT_ORDERS.includes(item.sortOrder))
    && (item.sortBy === undefined || typeof item.sortBy === 'string')
    && (item.tooltips === undefined || (Array.isArray(item.tooltips) && item.tooltips.length <= 10 && item.tooltips.every(name => typeof name === 'string')))
    // A saved config is written by any canvas author, so every setting is checked for its shape.
    && [item.text, item.imageUrl, item.alt, item.series, item.target, item.compare, item.xMeasure, item.sizeMeasure]
      .every(value => value === undefined || typeof value === 'string')
    && [item.dataLabels, item.lowerIsBetter, item.gauge, item.totals].every(value => value === undefined || typeof value === 'boolean')
    && (item.chartType === undefined || CHART_TYPES.includes(item.chartType))
    && (item.stacking === undefined || item.stacking === null || item.stacking === 'normal' || item.stacking === 'percent')
    && (item.targetValue === undefined || item.targetValue === null || isFiniteNumber(item.targetValue))
    && (item.warnAt === undefined || (isFiniteNumber(item.warnAt) && item.warnAt >= 0 && item.warnAt <= 100))
    && (item.format === undefined || isFormat(item.format))
    && (item.rules === undefined || (Array.isArray(item.rules) && item.rules.length <= MAX_RULES && item.rules.every(isRule)))
    && (item.slicer === undefined || isSlicer(item.slicer))
    && (item.filters === undefined || isFilterList(item.filters))
    && (item.float === undefined || (!isDataItem(item.type) && isFloatBox(item.float)));
}

function isFloatBox(box: FloatBox): boolean {
  return typeof box === 'object' && box !== null
    && [box.x, box.y].every(value => isFiniteNumber(value) && value >= 0 && value <= 4000)
    && [box.w, box.h].every(value => isFiniteNumber(value) && value >= 16 && value <= 4000);
}

function isFormat(format: NumberFormat): boolean {
  return typeof format === 'object' && format !== null && NUMBER_STYLES.includes(format.style)
    && Number.isInteger(format.decimals) && format.decimals >= 0 && format.decimals <= 6
    && (format.currency === undefined || (typeof format.currency === 'string' && /^[A-Z]{3}$/.test(format.currency)));
}

function isRule(rule: FormatRule): boolean {
  return typeof rule === 'object' && rule !== null && typeof rule.field === 'string' && RULE_OPS.includes(rule.op)
    && RULE_TONES.includes(rule.tone) && Array.isArray(rule.values) && rule.values.length <= 2
    && rule.values.every(value => typeof value === 'string');
}

function isSlicer(state: SlicerState): boolean {
  return typeof state === 'object' && state !== null && (state.kind === 'list' || state.kind === 'range' || state.kind === 'relative')
    && Array.isArray(state.values) && state.values.length <= SLICER_VALUE_LIMIT && state.values.every(value => typeof value === 'string')
    && (state.style === undefined || state.style in SLICER_STYLE_LABELS)
    && (state.single === undefined || typeof state.single === 'boolean')
    && (state.last === undefined || (typeof state.last === 'object' && state.last !== null && Number.isInteger(state.last.n)
      && state.last.n > 0 && state.last.n <= 1000 && ['days', 'months', 'years'].includes(state.last.unit)))
    && (state.sync === undefined || state.sync === 'all'
      || (Array.isArray(state.sync) && state.sync.length <= 100 && state.sync.every(name => typeof name === 'string')));
}

/** The slicers of other sheets whose choice applies to the named sheet (item 21). */
export function syncedSlicers(sheets: CanvasSheet[], sheetName: string): CanvasItem[] {
  return sheets.filter(sheet => sheet.name !== sheetName).flatMap(sheet => sheet.items)
    .filter(item => item.type === 'slicer'
      && (item.slicer?.sync === 'all' || (Array.isArray(item.slicer?.sync) && item.slicer.sync.includes(sheetName))));
}

/** Slicers that sync to a renamed sheet follow the new name. */
export function renameSyncedSheet(items: CanvasItem[], from: string, to: string): CanvasItem[] {
  return items.map(item => (Array.isArray(item.slicer?.sync) && item.slicer.sync.includes(from)
    ? { ...item, slicer: { ...item.slicer, sync: item.slicer.sync.map(name => (name === from ? to : name)) } }
    : item));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

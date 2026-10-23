import { applyConditionalFilters, getSavedConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { DaxModelConfig, evaluateTileDaxValue, formatDaxValue, getSelectedDaxMeasure } from '../../../core/utils/dax-evaluator.util';

export type DataRow = Record<string, unknown>;
export type InteractionKind = 'chart' | 'tile';
/** What a visual does when an element of the source visual is clicked: narrow its data, emphasise matching data, or ignore it. */
export type InteractionMode = 'filter' | 'highlight' | 'none';
export type ChartShape = 'column' | 'bar' | 'line' | 'spline' | 'area' | 'pie' | 'donut' | 'stacked' | 'table';

export const INTERACTION_MODES: InteractionMode[] = ['filter', 'highlight', 'none'];

export interface InteractionVisualInput {
  id: string;
  title: string;
  designJson?: string;
  source?: string;
  sourceType?: string;
}

export interface InteractionVisualRef {
  kind: InteractionKind;
  id: string;
}

/** Persisted in the dashboard's configJson under `interactions`. */
export interface DashboardInteractionConfig {
  version: 1;
  visuals: InteractionVisualRef[];
  sourceKey: string | null;
  /** matrix[sourceKey][targetKey] */
  matrix: Record<string, Record<string, InteractionMode>>;
}

export interface InteractionSelection {
  sourceKey: string;
  dimension: string;
  values: string[];
}

export interface VisualProfile {
  key: string;
  kind: InteractionKind;
  id: string;
  title: string;
  design: Record<string, unknown>;
  sourceKey: string;
  source: string;
  sourceType: string;
  viewId: number;
  isView: boolean;
  /** Lower-cased columns the design refers to. */
  columns: string[];
  /** The field a click on this chart picks (its X axis / category). Empty when the chart has none. */
  dimension: string;
  shape: ChartShape | null;
  chartType: string;
  /** A chart can be the source of an interaction when it has a category field and renders as a categorical chart. */
  canSource: boolean;
}

export interface Connection {
  connected: boolean;
  reason: string;
}

export interface ChartSeriesData { name: string; values: number[] }
export interface ChartData { categories: string[]; series: ChartSeriesData[]; xHeader: string }

export interface TargetRows {
  rows: DataRow[];
  /** Matching subset to emphasise inside the full `rows` (highlight mode only). */
  highlightRows: DataRow[] | null;
  active: boolean;
}

const Y_AGG_FUNCTIONS = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'];
const MAX_CATEGORIES = 40;

export const visualKey = (kind: InteractionKind, id: string | number): string => `${kind}:${id}`;

export interface TileAppearance { accent: string; icon: string }

const TILE_ACCENTS: Record<string, string> = {
  blue: 'blue', green: 'green', red: 'red', purple: 'purple', orange: 'orange', amber: 'amber', teal: 'teal', gray: 'gray',
  '#2563EB': 'blue', '#12B76A': 'green', '#4ADE80': 'green', '#D92D20': 'red', '#EF4444': 'red', '#7C3AED': 'purple',
  '#F58220': 'orange', '#F59E0B': 'amber', '#14B8A6': 'teal', '#9CA3AF': 'gray',
};

const TILE_ICONS: Record<string, string> = {
  location: 'well', 'check-circle': 'check', 'alert-triangle': 'alert', 'trending-up': 'chart', users: 'crew',
};

/** The colour and icon a tile was given in the Tile Builder, so it looks the same here as on the dashboards. */
export function tileAppearance(design: Record<string, unknown>): TileAppearance {
  const color = text(design['tileColor']);
  const icon = text(design['tileIcon']);
  return { accent: TILE_ACCENTS[color] ?? 'blue', icon: TILE_ICONS[icon] ?? (icon || 'well') };
}

export function parseDesign(designJson: string | undefined): Record<string, unknown> {
  if (!designJson) return {};
  try {
    const parsed = JSON.parse(designJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shapeFor(chartType: string): ChartShape | null {
  switch (chartType) {
    case 'pie': return 'pie';
    case 'donut': case 'doughnut': return 'donut';
    case 'line': case 'multiline': return 'line';
    case 'spline': return 'spline';
    case 'area': return 'area';
    case 'bar': case 'grouped': case 'combo': return 'bar';
    case 'column': return 'column';
    case 'stacked': return 'stacked';
    case 'table': return 'table';
    default: return null;
  }
}

export function buildVisualProfile(kind: InteractionKind, input: InteractionVisualInput): VisualProfile {
  const design = parseDesign(input.designJson);
  const source = text(design['source']) || text(input.source);
  const sourceType = text(design['sourceType']) || text(input.sourceType) || 'Table';
  const viewId = Number(design['viewId']) || 0;
  const isView = design['dataSourceMode'] === 'view' && viewId > 0;
  const chartType = text(design['chartType']).toLowerCase();
  const dimension = kind === 'chart' ? text(design['xAxis']) : '';
  const shape = kind === 'chart' ? shapeFor(chartType) : null;

  const columns = new Set<string>();
  const add = (value: unknown) => { const name = text(value).toLowerCase(); if (name) columns.add(name); };
  add(design['xAxis']);
  add(design['yAggColumn']);
  add(design['valueField']);
  const yAxis = text(design['yAxis']);
  if (!Y_AGG_FUNCTIONS.includes(yAxis)) add(yAxis);
  for (const key of ['multiYColumns', 'comboLineColumns']) {
    const list = design[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  for (const key of ['interactiveFilters', 'conditionalFilters']) {
    const list = design[key];
    if (Array.isArray(list)) list.forEach(filter => add((filter as { sourceColumn?: unknown })?.sourceColumn));
  }

  return {
    key: visualKey(kind, input.id), kind, id: input.id, title: input.title, design,
    sourceKey: isView ? `view:${viewId}` : `${sourceType.toLowerCase()}:${source.toLowerCase()}`,
    source, sourceType, viewId, isView,
    columns: [...columns], dimension, shape, chartType,
    canSource: kind === 'chart' && !!dimension && shape !== null && !!(source || isView),
  };
}

/** Whether a click on `source` can narrow or highlight `target`: the same data source, or a target that uses the clicked field. */
export function connectionBetween(source: VisualProfile, target: VisualProfile): Connection {
  if (source.key === target.key) return { connected: false, reason: 'This is the source visual' };
  if (!source.canSource) return { connected: false, reason: 'The source has no category field to pick' };
  if (target.kind === 'chart' && !target.shape) return { connected: false, reason: 'This chart type cannot be previewed here' };
  if (source.sourceKey === target.sourceKey) return { connected: true, reason: 'Same data source' };
  if (target.columns.includes(source.dimension.toLowerCase())) {
    return { connected: true, reason: `Shares the "${source.dimension}" field` };
  }
  return { connected: false, reason: `No "${source.dimension}" field in this data source` };
}

export function defaultMatrix(profiles: VisualProfile[]): Record<string, Record<string, InteractionMode>> {
  const matrix: Record<string, Record<string, InteractionMode>> = {};
  for (const source of profiles.filter(profile => profile.canSource)) {
    matrix[source.key] = {};
    for (const target of profiles) {
      if (target.key === source.key) continue;
      matrix[source.key][target.key] = connectionBetween(source, target).connected ? 'filter' : 'none';
    }
  }
  return matrix;
}

/** Keeps saved choices for visuals that are still connected and falls back to the defaults for everything else. */
export function mergeMatrix(
  profiles: VisualProfile[],
  saved: DashboardInteractionConfig['matrix'] | null | undefined,
): Record<string, Record<string, InteractionMode>> {
  const matrix = defaultMatrix(profiles);
  for (const [sourceKey, targets] of Object.entries(matrix)) {
    const source = profiles.find(profile => profile.key === sourceKey)!;
    for (const targetKey of Object.keys(targets)) {
      const mode = saved?.[sourceKey]?.[targetKey];
      const target = profiles.find(profile => profile.key === targetKey)!;
      if (mode && INTERACTION_MODES.includes(mode) && connectionBetween(source, target).connected) targets[targetKey] = mode;
    }
  }
  return matrix;
}

export function readInteractionConfig(raw: unknown): DashboardInteractionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<DashboardInteractionConfig>;
  const visuals = (Array.isArray(value.visuals) ? value.visuals : [])
    .filter(ref => !!ref && (ref.kind === 'chart' || ref.kind === 'tile') && !!ref.id)
    .map(ref => ({ kind: ref.kind, id: String(ref.id) }));
  if (!visuals.length) return null;
  return {
    version: 1, visuals,
    sourceKey: typeof value.sourceKey === 'string' ? value.sourceKey : null,
    matrix: value.matrix && typeof value.matrix === 'object' ? value.matrix : {},
  };
}

export function resolveColumn(rows: DataRow[], name: string): string | null {
  const sample = rows[0];
  if (!sample || !name) return null;
  if (name in sample) return name;
  const lower = name.toLowerCase();
  return Object.keys(sample).find(key => key.toLowerCase() === lower) ?? null;
}

export function cellKey(value: unknown): string {
  return value !== null && value !== undefined && typeof value !== 'object' ? `${value}` : '(empty)';
}

function normalize(value: unknown): string {
  return cellKey(value).trim().toLowerCase();
}

export function filterRowsBySelection(rows: DataRow[], column: string, values: string[]): DataRow[] {
  const wanted = new Set(values.map(value => value.trim().toLowerCase()));
  return rows.filter(row => wanted.has(normalize(row[column])));
}

/** Distinct, normalised values of a field across the rows (empty when the rows have no such field). */
export function distinctValues(rows: DataRow[], field: string): Set<string> {
  const column = resolveColumn(rows, field);
  return new Set(column ? rows.map(row => normalize(row[column])) : []);
}

/** Whether any row of a visual carries one of the source's category values, i.e. clicking the source can actually reach it. */
export function sharesValues(rows: DataRow[], field: string, values: Set<string>): boolean {
  const column = resolveColumn(rows, field);
  return !!column && values.size > 0 && rows.some(row => values.has(normalize(row[column])));
}

/** Applies a click on the source visual to one target's rows, according to the configured mode. */
export function resolveTargetRows(
  rows: DataRow[],
  target: VisualProfile,
  source: VisualProfile | null,
  selection: InteractionSelection | null,
  mode: InteractionMode,
): TargetRows {
  const unchanged: TargetRows = { rows, highlightRows: null, active: false };
  if (!source || !selection || !selection.values.length || mode === 'none') return unchanged;
  if (source.key !== selection.sourceKey || !connectionBetween(source, target).connected) return unchanged;
  const column = resolveColumn(rows, selection.dimension);
  if (!column) return unchanged;
  const matched = filterRowsBySelection(rows, column, selection.values);
  return mode === 'filter'
    ? { rows: matched, highlightRows: null, active: true }
    : { rows, highlightRows: matched, active: true };
}

/** Row-level filters saved with the chart design that the chart itself applies before drawing. */
export function applyDesignRowFilters(rows: DataRow[], design: Record<string, unknown>): DataRow[] {
  if (!rows.length) return rows;
  let out = applyConditionalFilters(rows, getSavedConditionalFilters(design));
  const filters = (design['interactiveFilters'] as { sourceColumn?: string; controlType?: string; locked?: boolean; lockedValue?: string; lockedValues?: string[] }[]) ?? [];
  for (const filter of filters) {
    if (!filter?.locked || !filter.sourceColumn || !out.length) continue;
    const column = resolveColumn(out, filter.sourceColumn);
    if (!column) continue;
    let next = out;
    if (filter.controlType === 'MultiSelect') {
      if (!filter.lockedValues?.length) continue;
      next = filterRowsBySelection(out, column, filter.lockedValues);
    } else if (filter.lockedValue) {
      const wanted = filter.lockedValue.trim().toLowerCase();
      next = out.filter(row => normalize(row[column]).includes(wanted));
    }
    // A stale locked value must not blank the whole visual.
    if (next.length) out = next;
  }
  return out;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Category → value aggregation of a chart's rows, following the chart design (X axis, Y function / columns, Top N). */
export function aggregateChartData(rows: DataRow[], design: Record<string, unknown>): ChartData {
  const xAxis = text(design['xAxis']);
  const xColumn = resolveColumn(rows, xAxis) ?? xAxis;
  const xHeader = text(design['xAxisTitle']) || xAxis || 'Category';
  const multi = Array.isArray(design['multiYColumns']) ? (design['multiYColumns'] as string[]) : [];
  const grouped = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = cellKey(row[xColumn]);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row); else grouped.set(key, [row]);
  }

  if (multi.length) {
    const columns = [...multi];
    const comboLine = Array.isArray(design['comboLineColumns']) ? (design['comboLineColumns'] as string[]) : [];
    for (const column of comboLine) if (!columns.includes(column)) columns.push(column);
    const categories = [...grouped.keys()].slice(0, MAX_CATEGORIES);
    return {
      categories, xHeader,
      series: columns.map(name => {
        const column = resolveColumn(rows, name) ?? name;
        return { name, values: categories.map(category => sum(grouped.get(category)!.map(row => numeric(row[column])))) };
      }),
    };
  }

  const yAxis = text(design['yAxis']) || 'Count (F)';
  const aggregateColumn = text(design['yAggColumn']);
  const column = aggregateColumn || (Y_AGG_FUNCTIONS.includes(yAxis) ? '' : yAxis);
  const resolved = column ? (resolveColumn(rows, column) ?? column) : '';
  let categories: string[] = [];
  let values: number[] = [];
  for (const [category, bucket] of grouped) {
    const nums = resolved ? bucket.map(row => numeric(row[resolved])) : [];
    categories.push(category);
    if (yAxis === 'Count (F)') values.push(bucket.length);
    else if (yAxis === 'Count Distinct (F)') values.push(new Set(bucket.map(row => normalize(row[resolved || xColumn]))).size);
    else if (yAxis === 'Average (F)') values.push(nums.length ? sum(nums) / nums.length : 0);
    else if (yAxis === 'Min (F)') values.push(nums.length ? Math.min(...nums) : 0);
    else if (yAxis === 'Max (F)') values.push(nums.length ? Math.max(...nums) : 0);
    else values.push(nums.length ? sum(nums) : bucket.length);
  }

  const topN = Number(design['topN']) || 0;
  if (topN > 0 && categories.length > topN) {
    const ranked = categories.map((category, index) => ({ category, value: values[index] }))
      .sort((left, right) => right.value - left.value).slice(0, topN);
    categories = ranked.map(item => item.category);
    values = ranked.map(item => item.value);
  } else if (categories.length > MAX_CATEGORIES) {
    categories = categories.slice(0, MAX_CATEGORIES);
    values = values.slice(0, MAX_CATEGORIES);
  }
  return { categories, xHeader, series: [{ name: aggregateColumn || (Y_AGG_FUNCTIONS.includes(yAxis) ? 'Value' : yAxis), values }] };
}

/** Re-aligns the highlighted subset's values to the full chart's categories (0 where the subset has none). */
export function alignHighlight(base: ChartData, subset: ChartData): ChartData {
  return {
    categories: base.categories, xHeader: base.xHeader,
    series: base.series.map((series, index) => ({
      name: series.name,
      values: base.categories.map(category => {
        const at = subset.categories.indexOf(category);
        return at >= 0 ? subset.series[index]?.values[at] ?? 0 : 0;
      }),
    })),
  };
}

export interface TileResult { number: number; text: string }

function formatTile(result: number, design: Record<string, unknown>): string {
  const model = design['daxModel'] as DaxModelConfig | undefined;
  const prefix = text(design['prefix']);
  const suffix = text(design['suffix']);
  if (model?.enabled) return `${prefix}${formatDaxValue(result, getSelectedDaxMeasure(model))}${suffix}`;
  const places = Number(design['decimalPlaces']) || 0;
  const shorten = design['shortenBigNumbers'] === true;
  let formatted = result.toFixed(places);
  if (shorten && result >= 1_000_000) formatted = `${(result / 1_000_000).toFixed(1)}M`;
  else if (shorten && result >= 1000) formatted = `${(result / 1000).toFixed(1)}K`;
  return `${prefix}${formatted}${suffix}`;
}

/** KPI value of a tile over the given rows, following the tile design (aggregation, value field, DAX, formatting). */
export function computeTileResult(rows: DataRow[], design: Record<string, unknown>): TileResult {
  const model = design['daxModel'] as DaxModelConfig | undefined;
  const dax = model?.enabled ? evaluateTileDaxValue(rows, model) : undefined;
  if (dax !== undefined) return { number: dax, text: formatTile(dax, design) };

  const aggregation = text(design['aggregation']) || 'count';
  const field = text(design['valueField']);
  const column = field ? (resolveColumn(rows, field) ?? field) : '';
  let result: number;
  if (aggregation === 'count' && column) {
    result = rows.filter(row => { const value = row[column]; return value !== null && value !== undefined && value !== ''; }).length;
  } else if (aggregation === 'count' || !column) {
    result = rows.length;
  } else if (aggregation === 'value') {
    result = numeric(rows[0]?.[column]);
  } else if (aggregation === 'countDistinct') {
    result = new Set(rows.map(row => row[column]).filter(value => value !== null && value !== undefined && value !== '')).size;
  } else {
    const nums = rows.map(row => numeric(row[column]));
    if (aggregation === 'total') result = sum(nums);
    else if (aggregation === 'average') result = nums.length ? sum(nums) / nums.length : 0;
    else result = rows.length;
  }
  return { number: result, text: formatTile(result, design) };
}

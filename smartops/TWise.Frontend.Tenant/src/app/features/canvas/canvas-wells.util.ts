import {
  CanvasChartType, CanvasItem, CanvasItemType, FieldAggregate, MATRIX_MAX_ROW_FIELDS, ONE_MEASURE_CHARTS, SERIES_CHART_TYPES, ValueFn,
  DATE_LEVELS, MAX_DRILL_LEVELS, canDrill, isDataItem,
} from './canvas-config.util';

/** What is dragged or clicked in the Data pane: a field as "alias.column" with the kind of its values, or a measure name. */
export interface DataDrag { kind: 'field' | 'measure'; name: string; fieldKind?: FieldAggregate['kind']; }

export const VALUE_FN_LABELS: Record<ValueFn, string> = {
  sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum', count: 'Count', count_distinct: 'Count (distinct)',
};

/** How a field can be added up: every way for numbers; counts, minimum and maximum for dates and text. */
export function valueFns(kind: FieldAggregate['kind']): ValueFn[] {
  return kind === 'number' ? ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'] : ['count', 'count_distinct', 'min', 'max'];
}

/** The name a field value shows under, for example "Sum of data_hours". */
export function valueName(aggregate: FieldAggregate): string {
  return `${VALUE_FN_LABELS[aggregate.fn]} of ${aggregate.field.slice(aggregate.field.indexOf('.') + 1)}`;
}

/** The object with a field value added up another way: renamed in its well and kept in aggregates under the new name. */
export function setValueFn(item: CanvasItem, name: string, fn: ValueFn): CanvasItem {
  const current = item.aggregates?.[name];
  if (!current || current.fn === fn) return item;
  const next: FieldAggregate = { ...current, fn };
  const renamed = valueName(next);
  const swap = (entry: string | undefined) => (entry === name ? renamed : entry);
  const aggregates = { ...item.aggregates };
  delete aggregates[name];
  aggregates[renamed] = next;
  return {
    ...item, aggregates, measures: item.measures.map(entry => swap(entry)!),
    ...(item.target !== undefined ? { target: swap(item.target) } : {}),
    ...(item.compare !== undefined ? { compare: swap(item.compare) } : {}),
    ...(item.xMeasure !== undefined ? { xMeasure: swap(item.xMeasure) } : {}),
    ...(item.sizeMeasure !== undefined ? { sizeMeasure: swap(item.sizeMeasure) } : {}),
    ...(item.tooltips ? { tooltips: item.tooltips.map(entry => swap(entry)!) } : {}),
  };
}

export type WellId =
  | 'axis' | 'legend' | 'category' | 'values' | 'value' | 'rows' | 'series' | 'target' | 'compare' | 'field' | 'details' | 'x' | 'y' | 'size' | 'tooltips'
  | 'sort';

/** The object property a well reads and writes: a list, or one name. */
type WellKey = 'dimensions' | 'measures' | 'series' | 'target' | 'compare' | 'xMeasure' | 'sizeMeasure' | 'tooltips' | 'sortBy';

/** A field well: what it takes, whether it holds one entry or several, what it holds now, and a line of help. */
export interface Well { id: WellId; label: string; accepts: DataDrag['kind']; single: boolean; entries: string[]; key: WellKey; hint?: string; }

export type VisualId = CanvasChartType | Exclude<CanvasItemType, 'chart'> | 'gauge' | 'spline' | 'stacked-column' | 'stacked-bar';

/**
 * One tile of the Visualizations pane: its full name, the short name under its icon, what it adds, and the Charts and
 * Tiles picture of that type (item 12); slicer, text and image keep their own icon. The Charts and Tiles pictures
 * are named the other way round: bar.png shows upright columns and column.png shows horizontal bars.
 */
export interface Visual {
  id: VisualId; label: string; short: string; type: CanvasItemType; chartType?: CanvasChartType; gauge?: boolean; image?: string;
  /** A line chart drawn as a smooth curve (the Smoothed line tile). */
  smooth?: boolean;
  /** A column or bar chart with its series stacked (the Stacked tiles). */
  stacking?: 'normal';
}

export const VISUALS: Visual[] = [
  { id: 'column', label: 'Column chart', short: 'Column', type: 'chart', chartType: 'column', image: 'assets/images/chart-types/bar.png' },
  { id: 'bar', label: 'Bar chart', short: 'Bar', type: 'chart', chartType: 'bar', image: 'assets/images/chart-types/column.png' },
  { id: 'stacked-column', label: 'Stacked column chart', short: 'Stacked col', type: 'chart', chartType: 'column', stacking: 'normal', image: 'assets/images/chart-types/stacked.png' },
  { id: 'stacked-bar', label: 'Stacked bar chart', short: 'Stacked bar', type: 'chart', chartType: 'bar', stacking: 'normal', image: 'assets/images/chart-types/grouped.png' },
  { id: 'line', label: 'Line chart', short: 'Line', type: 'chart', chartType: 'line', image: 'assets/images/chart-types/line.png' },
  { id: 'spline', label: 'Smoothed line chart', short: 'Smooth line', type: 'chart', chartType: 'line', smooth: true, image: 'assets/images/chart-types/spline.png' },
  { id: 'area', label: 'Area chart', short: 'Area', type: 'chart', chartType: 'area', image: 'assets/images/chart-types/area.png' },
  { id: 'combo', label: 'Combo chart: columns and lines', short: 'Combo', type: 'chart', chartType: 'combo', image: 'assets/images/chart-types/combo.png' },
  { id: 'pie', label: 'Pie chart', short: 'Pie', type: 'chart', chartType: 'pie', image: 'assets/images/chart-types/pie.png' },
  { id: 'donut', label: 'Donut chart', short: 'Donut', type: 'chart', chartType: 'donut', image: 'assets/images/chart-types/donut.png' },
  { id: 'treemap', label: 'Treemap', short: 'Treemap', type: 'chart', chartType: 'treemap', image: 'assets/images/chart-types/treemap.svg' },
  { id: 'waterfall', label: 'Waterfall chart', short: 'Waterfall', type: 'chart', chartType: 'waterfall', image: 'assets/images/chart-types/waterfall.svg' },
  { id: 'funnel', label: 'Funnel', short: 'Funnel', type: 'chart', chartType: 'funnel', image: 'assets/images/chart-types/funnel.png' },
  { id: 'scatter', label: 'Scatter chart: two measures against each other', short: 'Scatter', type: 'chart', chartType: 'scatter', image: 'assets/images/chart-types/scatter.svg' },
  { id: 'bubble', label: 'Bubble chart: a scatter chart with a size', short: 'Bubble', type: 'chart', chartType: 'bubble', image: 'assets/images/chart-types/bubble.svg' },
  { id: 'bullet', label: 'Bullet chart: a measure against its target', short: 'Bullet', type: 'chart', chartType: 'bullet', image: 'assets/images/chart-types/bullet.svg' },
  { id: 'tile', label: 'Card: a number with its target', short: 'Card', type: 'tile', image: 'assets/images/kpitile.svg' },
  { id: 'gauge', label: 'Gauge', short: 'Gauge', type: 'tile', gauge: true, image: 'assets/images/chart-types/gauge.svg' },
  { id: 'table', label: 'Table', short: 'Table', type: 'table', image: 'assets/images/chart-types/table.png' },
  { id: 'matrix', label: 'Matrix with subtotals', short: 'Matrix', type: 'matrix', image: 'assets/images/chart-types/matrix.png' },
  { id: 'slicer', label: 'Slicer', short: 'Slicer', type: 'slicer' },
  { id: 'text', label: 'Text', short: 'Text', type: 'text' },
  { id: 'image', label: 'Image', short: 'Image', type: 'image' },
];

export function visualOf(item: CanvasItem): VisualId {
  if (item.type === 'chart') {
    if (item.chartType === 'line' && item.style?.smooth) return 'spline';
    if (item.stacking && (item.chartType ?? 'column') === 'column') return 'stacked-column';
    if (item.stacking && item.chartType === 'bar') return 'stacked-bar';
    return item.chartType ?? 'column';
  }
  return item.type === 'tile' && item.gauge ? 'gauge' : item.type;
}

/**
 * The wells of an object, filled from its fields, measures and single-name settings. Text and images have none. A
 * chart also has Tooltips, unless it is split into series.
 */
export function wellsFor(item: CanvasItem): Well[] {
  // A drillable chart's axis holds a hierarchy: each more field is a level to drill down to.
  const wells = ownWells(item).map(well => canDrill(item) && well.key === 'dimensions' && well.accepts === 'field'
    ? { ...well, single: false, hint: 'Add more fields to drill down, level by level. A date gives year, quarter, month and day.' } : well);
  if (item.type !== 'chart') return wells;
  const type = item.chartType ?? 'column';
  const sorts = !['scatter', 'bubble', 'pie', 'donut', 'treemap', 'funnel'].includes(type);
  return [
    ...wells,
    ...(item.series ? [] : [{
      id: 'tooltips' as const, label: 'Tooltips', accepts: 'measure' as const, single: false, key: 'tooltips' as const, entries: item.tooltips ?? [],
      hint: 'More values shown when pointing at a bar, slice or point.',
    }]),
    ...(sorts ? [{
      id: 'sort' as const, label: 'Sort by', accepts: 'field' as const, single: true, key: 'sortBy' as const, entries: item.sortBy ? [item.sortBy] : [],
      hint: 'Orders the X-axis by another field, such as a month number for month names. Set the direction under Format, Sort.',
    }] : []),
  ];
}

function ownWells(item: CanvasItem): Well[] {
  const field = (id: WellId, label: string, key: 'dimensions' | 'series', single: boolean, hint?: string): Well =>
    ({ id, label, accepts: 'field', single, key, entries: entriesOf(item, key), ...(hint ? { hint } : {}) });
  const measure = (id: WellId, label: string, key: 'measures' | 'target' | 'compare' | 'xMeasure' | 'sizeMeasure' | 'tooltips', single: boolean, hint?: string): Well =>
    ({ id, label, accepts: 'measure', single, key, entries: entriesOf(item, key), ...(hint ? { hint } : {}) });
  switch (item.type) {
    case 'chart': {
      const type = item.chartType ?? 'column';
      if (type === 'pie' || type === 'donut') return [field('legend', 'Legend', 'dimensions', true), measure('values', 'Values', 'measures', true)];
      if (ONE_MEASURE_CHARTS.includes(type)) return [field('category', 'Category', 'dimensions', true), measure('values', 'Values', 'measures', true)];
      if (type === 'scatter' || type === 'bubble') {
        return [
          field('details', 'Details', 'dimensions', true, 'One point for each value of this field.'),
          measure('x', 'X-axis', 'xMeasure', true),
          measure('y', 'Y-axis', 'measures', true),
          ...(type === 'bubble' ? [measure('size', 'Size', 'sizeMeasure', true, 'Bigger values draw bigger bubbles.')] : []),
        ];
      }
      if (type === 'bullet') {
        return [
          field('category', 'Category', 'dimensions', true),
          measure('value', 'Value', 'measures', true),
          measure('target', 'Target', 'target', true, 'Drawn as a line across each bar.'),
        ];
      }
      if (type === 'combo') {
        return [
          field('axis', 'X-axis', 'dimensions', true),
          measure('values', 'Y-axis', 'measures', false, 'The first measure is drawn as columns, the others as lines on a second axis.'),
        ];
      }
      return [
        field('axis', 'X-axis', 'dimensions', true),
        measure('values', 'Y-axis', 'measures', false),
        field('series', 'Legend', 'series', true, 'Splits the measure into one coloured series per value of this field, as a legend.'),
      ];
    }
    case 'tile':
      return item.gauge
        ? [measure('value', 'Value', 'measures', true), measure('target', 'Target', 'target', true)]
        : [
            measure('value', 'Value', 'measures', true),
            measure('target', 'Target', 'target', true),
            measure('compare', 'Compare with', 'compare', true, 'For example last month, to show the change.'),
          ];
    case 'table':
      return [field('rows', 'Rows', 'dimensions', false), measure('values', 'Values', 'measures', false)];
    case 'matrix':
      return [
        field('rows', 'Rows', 'dimensions', false, `Up to ${MATRIX_MAX_ROW_FIELDS} fields; each one gets a subtotal.`),
        measure('values', 'Values', 'measures', false),
      ];
    case 'slicer':
      return [field('field', 'Field', 'dimensions', true)];
    default:
      return [];
  }
}

/** The object with the entry in the well, or why the well refuses it. A one-entry well swaps its entry. */
export function dropOnWell(item: CanvasItem, wellId: WellId, drag: DataDrag): { item: CanvasItem } | { problem: string } {
  const well = wellsFor(item).find(candidate => candidate.id === wellId);
  if (!well) return { problem: 'This object has no such well.' };
  // A field in a value well is added up, as Power BI does: numbers are summed, other fields counted.
  if (well.accepts === 'measure' && drag.kind === 'field') {
    const kind = drag.fieldKind ?? 'text';
    const aggregate: FieldAggregate = { field: drag.name, fn: kind === 'number' ? 'sum' : 'count', kind };
    const name = valueName(aggregate);
    const withValue = { ...item, aggregates: { ...item.aggregates, [name]: aggregate } };
    const next = well.single ? [name] : well.entries.includes(name) ? well.entries : [...well.entries, name];
    return { item: withEntries(withValue, well.key, next) };
  }
  if (well.accepts !== drag.kind) {
    return {
      problem: well.accepts === 'measure'
        ? `${well.label} takes measures. Drag a measure here, or create one with New measure.`
        : `${well.label} takes fields. Drag a field of a table here.`,
    };
  }
  // A date on an empty drillable axis becomes its year, quarter, month and day levels.
  if (!well.single && well.key === 'dimensions' && item.type === 'chart' && drag.fieldKind === 'date' && !well.entries.length) {
    return { item: withEntries(item, 'dimensions', DATE_LEVELS.map(level => `${drag.name}@${level}`)) };
  }
  const full = !well.single && well.key === 'dimensions' && item.type === 'chart' && well.entries.length >= MAX_DRILL_LEVELS;
  if (full && !well.entries.includes(drag.name)) return { problem: `A chart drills through up to ${MAX_DRILL_LEVELS} fields.` };
  const next = well.single ? [drag.name] : well.entries.includes(drag.name) ? well.entries : [...well.entries, drag.name];
  return { item: withEntries(item, well.key, next) };
}

export function removeFromWell(item: CanvasItem, wellId: WellId, name: string): CanvasItem {
  const well = wellsFor(item).find(candidate => candidate.id === wellId);
  return well ? withEntries(item, well.key, well.entries.filter(entry => entry !== name)) : item;
}

/** A click on a Data pane entry: into the first empty well that takes it, or else the first well that takes it. */
export function addToFirstWell(item: CanvasItem, drag: DataDrag): { item: CanvasItem } | { problem: string } {
  const wells = wellsFor(item);
  const same = wells.filter(candidate => candidate.accepts === drag.kind);
  // A field goes to a value well, added up, when the object has no field well (a card or a gauge).
  const taking = same.length || drag.kind === 'measure' ? same : wells.filter(candidate => candidate.accepts === 'measure');
  const well = taking.find(candidate => !candidate.entries.length) ?? taking[0];
  if (well) return dropOnWell(item, well.id, drag);
  return {
    problem: isDataItem(item.type)
      ? `A ${item.type} takes no ${drag.kind === 'field' ? 'fields' : 'measures'}.`
      : 'Text and image objects show no data.',
  };
}

/**
 * A data object shown as another data visual. What the new visual cannot hold is dropped: a chart keeps its
 * first field (and its series only if it can split), a one-measure chart, a tile and a gauge keep their first
 * measure, a matrix keeps up to three fields, a slicer keeps its first field and no measure.
 */
export function applyVisual(item: CanvasItem, visual: Visual): CanvasItem {
  const next: CanvasItem = { ...common(item), type: visual.type, chartType: visual.chartType };
  const first = item.dimensions.slice(0, 1);
  switch (visual.type) {
    case 'chart': {
      const type = visual.chartType ?? 'column';
      const splits = SERIES_CHART_TYPES.includes(type);
      const points = type === 'scatter' || type === 'bubble';
      const kept = ONE_MEASURE_CHARTS.includes(type) || type === 'bullet' || points ? 1 : item.measures.length;
      return {
        ...next,
        dimensions: first,
        measures: item.measures.slice(0, kept),
        // A second measure goes on the X-axis of a scatter or bubble chart.
        ...(points && (item.xMeasure ?? item.measures[1]) ? { xMeasure: item.xMeasure ?? item.measures[1] } : {}),
        ...(type === 'bubble' && item.sizeMeasure ? { sizeMeasure: item.sizeMeasure } : {}),
        ...(splits && item.series ? { series: item.series } : {}),
        // A stacked tile stacks; a plain column or bar tile is clustered; the other kinds keep the setting.
        ...(visual.stacking ? { stacking: visual.stacking }
          : splits && item.stacking && type !== 'column' && type !== 'bar' ? { stacking: item.stacking } : {}),
        ...(type === 'bullet' && item.target ? { target: item.target } : {}),
        ...(visual.smooth ? { style: { ...item.style, smooth: true } } : type === 'line' && item.style?.smooth ? { style: { ...item.style, smooth: false } } : {}),
      };
    }
    case 'tile':
      return {
        ...next,
        dimensions: [],
        measures: item.measures.slice(0, 1),
        ...(item.target ? { target: item.target } : {}),
        ...(item.compare && !visual.gauge ? { compare: item.compare } : {}),
        ...(visual.gauge ? { gauge: true } : {}),
        ...(item.targetValue !== undefined ? { targetValue: item.targetValue } : {}),
        ...(item.warnAt !== undefined ? { warnAt: item.warnAt } : {}),
        ...(item.lowerIsBetter !== undefined ? { lowerIsBetter: item.lowerIsBetter } : {}),
      };
    case 'table':
      return { ...next, ...(item.rules ? { rules: item.rules } : {}) };
    case 'matrix':
      return { ...next, dimensions: item.dimensions.slice(0, MATRIX_MAX_ROW_FIELDS), ...(item.rules ? { rules: item.rules } : {}), totals: item.totals ?? true };
    case 'slicer':
      return { ...next, dimensions: first, measures: [], slicer: item.slicer ?? { kind: 'list', values: [] } };
    default:
      return next;
  }
}

/** What every data visual keeps: the place, the fields, the number format and the data labels setting. */
function common(item: CanvasItem): CanvasItem {
  const { id, type, title, x, y, cols, rows, datasetId, dimensions, measures, format, dataLabels } = item;
  return {
    id, type, title, x, y, cols, rows, datasetId, dimensions, measures,
    ...(format ? { format } : {}), ...(dataLabels !== undefined ? { dataLabels } : {}),
  };
}

function entriesOf(item: CanvasItem, key: WellKey): string[] {
  const value = item[key];
  return Array.isArray(value) ? value : value ? [value] : [];
}

/**
 * Stacking applies to column and bar charts, which the Stacked tiles make, and to area charts with more than one
 * series (P10-4).
 */
export function canStack(item: CanvasItem): boolean {
  const type = item.type === 'chart' ? item.chartType ?? 'column' : null;
  return type === 'column' || type === 'bar' || (type === 'area' && (!!item.series || item.measures.length > 1));
}

/** The object with the well's new entries. Stacking goes with the last extra series, or it would stay on with no control left to turn it off. */
function withEntries(item: CanvasItem, key: WellKey, entries: string[]): CanvasItem {
  const next: CanvasItem = key === 'dimensions' || key === 'measures' ? { ...item, [key]: entries }
    : key === 'tooltips' ? { ...item, tooltips: entries.length ? entries : undefined } : { ...item, [key]: entries[0] };
  if (next.stacking && !canStack(next)) delete next.stacking;
  // Field values no well holds any more are forgotten.
  if (next.aggregates) {
    const used = new Set([...next.measures, next.target, next.compare, next.xMeasure, next.sizeMeasure, ...(next.tooltips ?? [])]);
    const kept = Object.fromEntries(Object.entries(next.aggregates).filter(([name]) => used.has(name)));
    if (Object.keys(kept).length) next.aggregates = kept;
    else delete next.aggregates;
  }
  return next;
}

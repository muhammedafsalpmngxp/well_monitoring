import { CustomVisualDataRole } from './marketplace.service';

/**
 * The data a template is bound against. Both render pipelines supply this shape, which is what
 * keeps a visual looking the same in the builder preview and in the saved widget.
 */
export interface CustomVisualBindingData {
  /** Category labels, bound to dimension roles. */
  labels: string[];
  /** Numeric values, bound to measure roles. Null where a category has no value. */
  values: (number | null)[];
  /** Column name shown for dimension roles; falls back to the role's own label. */
  dimensionLabel?: string;
  /** Column name shown for measure roles; falls back to the role's own label. */
  measureLabel?: string;
}

/**
 * Series types that label each point themselves instead of through an x-axis, and the point shape
 * each one expects. Anything not listed takes a plain numeric array against the category axis.
 */
const NAMED_POINT_SHAPES: Record<string, (name: string, y: number | null) => Record<string, unknown>> = {
  pie: (name, y) => ({ name, y }),
  funnel: (name, y) => ({ name, y }),
  pyramid: (name, y) => ({ name, y }),
  variablepie: (name, y) => ({ name, y, z: y }),
  item: (name, y) => ({ name, y }),
  wordcloud: (name, y) => ({ name, weight: y ?? 0 }),
  packedbubble: (name, y) => ({ name, value: y }),
  sunburst: (name, y) => ({ id: name, name, value: y }),
};

/** Series that compute their points from another series (baseSeries) and must not be given data. */
const DERIVED_SERIES = new Set(['pareto', 'bellcurve', 'histogram', 'tiledwebmap']);

/** Matches a string that is EXACTLY a placeholder, optionally with the `.label` suffix. */

const PLACEHOLDER = /^\s*\{\{\s*([a-zA-Z0-9_]+)(?:\.(label))?\s*\}\}\s*$/;

/**
 * Binds data into a custom visual's options template.
 *
 * Deliberately a pure function with no Angular dependencies: it is the piece that decides whether
 * a visual renders at all, so it has to be directly testable. The service and both render
 * pipelines call it rather than each doing their own substitution, which would let the builder
 * preview drift from what the saved widget draws.
 *
 * Binding contract — explicit, so what a placeholder resolves to never depends on where it sits:
 *
 *   {{role}}        the role's DATA: category labels for a dimension, numbers for a measure.
 *   {{role.label}}  the role's COLUMN NAME as text, for titles and series names.
 *
 * Only a string that is EXACTLY a placeholder is substituted, and it is replaced by a real value
 * rather than by text, so an array arrives at Highcharts as an array. The template is pure JSON —
 * validated server-side — so nothing here is evaluated.
 *
 * Returns null when the template is unusable; callers render that as an empty chart rather than
 * throwing inside a render cycle and blanking the page.
 */
export function bindCustomVisualTemplate(
  optionsTemplateJson: string,
  dataRoles: CustomVisualDataRole[],
  data: CustomVisualBindingData,
): Record<string, any> | null {
  const template = parseTemplate(optionsTemplateJson);
  if (!template) return null;

  const bindings = new Map<string, { data: unknown; label: string }>();
  for (const role of dataRoles ?? []) {
    bindings.set(role.key.toLowerCase(), role.type === 'measure'
      ? { data: data.values, label: data.measureLabel || role.label }
      : { data: data.labels, label: data.dimensionLabel || role.label });
  }

  const bound = substitute(template, bindings) as Record<string, any>;

  if (Array.isArray(bound['series'])) {
    const chartType = (bound['chart'] as any)?.type;

    bound['series'] = bound['series'].map((entry: any) => {
      if (!entry || typeof entry !== 'object') return entry;
      const next = { ...entry };

      // Highcharts needs a concrete series type. A template that sets only chart.type leaves
      // the series untyped, which silently renders nothing.
      if (!next.type && chartType) next.type = chartType;

      // A series with no data gets the measure values, so the common single-measure template
      // does not have to repeat the binding on every series entry. Slice-based series have no
      // x-axis to take category names from, so they get named points instead.
      if (next.data === undefined && !DERIVED_SERIES.has(next.type)) {
        const shape = NAMED_POINT_SHAPES[next.type];
        next.data = shape ? data.values.map((y, i) => shape(data.labels[i], y)) : data.values;
      }

      return next;
    });
  }

  return bound;
}

function parseTemplate(optionsTemplateJson: string): Record<string, unknown> | null {
  try {
    const template = JSON.parse(optionsTemplateJson);
    return template && typeof template === 'object' && !Array.isArray(template) ? template : null;
  } catch {
    return null;
  }
}

/**
 * True when a visual needs more than one category and one value — several measures, a split-by,
 * X/Y, OHLC or hierarchy levels — so it is bound against the rows (bindCustomVisualRows).
 */
export function isMultiRoleVisual(roles: CustomVisualDataRole[] | null | undefined): boolean {
  const list = roles ?? [];
  return list.some(role => role.allowMultiple)
    || list.filter(role => role.type === 'measure').length !== 1
    || list.filter(role => role.type !== 'measure').length !== 1;
}

/** Rows and the columns mapped to each data role (one column, or several for allowMultiple roles). */
export interface CustomVisualRowData {
  rows: Record<string, unknown>[];
  columns: Record<string, string[]>;
  /** Aggregates the values of one category (sum, average, …) as the chart's Aggregation says. */
  aggregate: (values: unknown[]) => number | null;
}

/**
 * Binds a multi-role visual. The template stays plain Highcharts JSON: placeholders work as in
 * bindCustomVisualTemplate, and a series without data is filled from the mapped columns by type:
 *
 *   ohlc / candlestick          [date, open, high, low, close] per row (roles date, open, high, low, close)
 *   sunburst / treemap + levels  one node per level value, leaves sized by the measure
 *   any type + roles x and y    one point per row {x, y, z: size, colorValue: color, name: label}
 *   several measures / split    one series per measure (and split value), aggregated per category
 *
 * Throws an Error with a user-facing message when the mapped data cannot be drawn.
 */
export function bindCustomVisualRows(
  optionsTemplateJson: string,
  dataRoles: CustomVisualDataRole[],
  data: CustomVisualRowData,
): Record<string, any> | null {
  const template = parseTemplate(optionsTemplateJson);
  if (!template) return null;

  const roles = dataRoles ?? [];
  const cols = (key: string): string[] => data.columns[key]?.filter(Boolean) ?? [];
  const col = (key: string): string | undefined => cols(key)[0];
  const text = (value: unknown): string => value === null || value === undefined || value === '' ? '(Blank)' : String(value);
  const unique = (column: string): string[] => [...new Set(data.rows.map(row => text(row[column])))];

  const categoryColumn = col('category');
  const categories = categoryColumn ? unique(categoryColumn) : [];
  const perCategory = (column: string, rows = data.rows): (number | null)[] => {
    const groups = new Map<string, unknown[]>(categories.map(category => [category, []]));
    for (const row of rows) groups.get(text(row[categoryColumn!]))?.push(row[column]);
    return [...groups.values()].map(values => values.length ? data.aggregate(values) : null);
  };

  const bindings = new Map<string, { data: unknown; label: string }>();
  for (const role of roles) {
    const mapped = cols(role.key);
    const label = mapped.join(', ') || role.label;
    if (role.type === 'measure') {
      const values = !mapped.length ? [] : categoryColumn ? perCategory(mapped[0]) : data.rows.map(row => toNumber(row[mapped[0]]));
      bindings.set(role.key.toLowerCase(), { data: values, label });
    } else {
      bindings.set(role.key.toLowerCase(), { data: role.key === 'category' ? categories : mapped.length ? unique(mapped[0]) : [], label });
    }
  }

  const bound = substitute(template, bindings) as Record<string, any>;
  // A colour axis without a mapped Color column would grey out every point.
  if (roles.some(role => role.key === 'color') && !col('color')) delete bound['colorAxis'];

  const measureColumns = roles.filter(role => role.type === 'measure').flatMap(role => cols(role.key));
  const firstMeasure = measureColumns[0];

  const fill = (entry: Record<string, any>): Record<string, any>[] => {
    const type = entry['type'];
    if (['ohlc', 'candlestick'].includes(type)) return [{ ...entry, data: ohlcPoints() }];
    if (type === 'heatmap' && col('x') && col('y')) return [densityGrid(entry, 'x', 'y')];
    if (type === 'geoheatmap') return [densityGrid(entry, 'longitude', 'latitude')];
    if (['sunburst', 'treemap'].includes(type) && cols('levels').length) {
      const split = col('split');
      if (!split || type !== 'sunburst') return [{ ...entry, data: shadeSunburst(type, treeNodes(data.rows)) }];
      // One small sunburst per split value, laid out in a grid.
      const groups = unique(split);
      if (groups.length > 9) throw new Error(`Split By has ${groups.length} values; choose a column with 9 or fewer.`);
      const columns = Math.ceil(Math.sqrt(groups.length)), rowsCount = Math.ceil(groups.length / columns);
      return groups.map((value, i) => ({
        ...entry, name: value,
        center: [`${((i % columns) + 0.5) * 100 / columns}%`, `${(Math.floor(i / columns) + 0.5) * 100 / rowsCount}%`],
        size: `${Math.floor(90 / Math.max(columns, rowsCount))}%`,
        data: shadeSunburst(type, treeNodes(data.rows.filter(row => text(row[split]) === value))),
      }));
    }
    if (type === 'heatmap' && categoryColumn && col('row')) return [categoryMatrix(entry)];
    if (col('x') && col('y')) return [{ ...entry, data: xyPoints(type) }];
    const shape = NAMED_POINT_SHAPES[type];
    if (shape && categoryColumn && firstMeasure) {
      return [{ ...entry, data: perCategory(firstMeasure).map((y, i) => shape(categories[i], y)) }];
    }
    if (!categoryColumn) throw new Error('Select a column for Category.');
    const split = col('split');
    if (split) {
      const groups = unique(split);
      if (groups.length > 50) throw new Error(`Split By has ${groups.length} values; choose a column with 50 or fewer.`);
      return groups.flatMap(value => {
        const rows = data.rows.filter(row => text(row[split]) === value);
        return measureColumns.map(measure => ({
          ...entry, name: measureColumns.length > 1 ? `${value} · ${measure}` : value, data: perCategory(measure, rows),
        }));
      });
    }
    return measureColumns.map(measure => ({ ...entry, name: measureColumns.length > 1 ? measure : entry['name'] ?? measure, data: perCategory(measure) }));
  };

  const ohlcPoints = (): number[][] => {
    const [date, open, high, low, close] = ['date', 'open', 'high', 'low', 'close'].map(col);
    if (!date || !open || !high || !low || !close) throw new Error('Select columns for Date, Open, High, Low and Close.');
    return data.rows.map(row => {
      const time = toTime(row[date]);
      const values = [open, high, low, close].map(column => toNumber(row[column]));
      if (time === null || values.some(value => value === null)) throw new Error('Every row needs a date and numeric Open, High, Low and Close.');
      return [time, ...values] as number[];
    }).sort((a, b) => a[0] - b[0]);
  };

  const treeNodes = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
    const levels = cols('levels');
    const color = col('color');
    if (!firstMeasure) throw new Error('Select a column for the size measure.');
    const nodes = new Map<string, Record<string, unknown>>();
    const leaves = new Map<string, unknown[]>();
    const colors = new Map<string, unknown[]>();
    for (const row of rows) {
      let parent: string | undefined;
      levels.forEach((level, depth) => {
        const id = `${parent ?? ''}|${text(row[level])}`;
        if (!nodes.has(id)) nodes.set(id, { id, parent, name: text(row[level]) });
        if (depth === levels.length - 1) leaves.set(id, [...(leaves.get(id) ?? []), row[firstMeasure]]);
        // Color by value: every node (not only leaves) gets the aggregate of the rows under it.
        if (color) colors.set(id, [...(colors.get(id) ?? []), row[color]]);
        parent = id;
      });
    }
    if (nodes.size > 2000) throw new Error('Too many groups to draw (over 2,000). Filter the source or select fewer levels.');
    for (const [id, values] of leaves) nodes.get(id)!['value'] = data.aggregate(values);
    for (const [id, values] of colors) nodes.get(id)!['colorValue'] = data.aggregate(values);
    return [...nodes.values()];
  };

  /**
   * Sunburst does not colour its points from colorAxis (treemap does), so with a Color role each
   * node gets its colour on the template's colorAxis scale (minColor -> maxColor) here.
   */
  const shadeSunburst = (type: string, nodes: Record<string, unknown>[]): Record<string, unknown>[] => {
    const axis = bound['colorAxis'] as { minColor?: string; maxColor?: string } | undefined;
    if (type !== 'sunburst' || !col('color') || !axis?.minColor || !axis?.maxColor) return nodes;
    const values = nodes.map(node => node['colorValue']).filter((value): value is number => typeof value === 'number');
    const min = Math.min(...values), span = (Math.max(...values) - min) || 1;
    const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [from, to] = [rgb(axis.minColor), rgb(axis.maxColor)];
    return nodes.map(node => {
      if (typeof node['colorValue'] !== 'number') return node;
      const t = ((node['colorValue'] as number) - min) / span;
      return { ...node, color: `rgb(${from.map((c, i) => Math.round(c + (to[i] - c) * t)).join(',')})` };
    });
  };

  /** Category heatmap: X = Category values, Y = Row values (same order as {{category}} / {{row}}), cell = aggregated measure. */
  const categoryMatrix = (entry: Record<string, any>): Record<string, any> => {
    if (!firstMeasure) throw new Error('Select a column for the cell measure.');
    const rowValues = unique(col('row')!);
    if (categories.length * rowValues.length > 10000) throw new Error('Too many cells to draw (over 10,000). Filter the source or choose columns with fewer values.');
    const cells = new Map<string, unknown[]>();
    for (const row of data.rows) {
      const key = `${categories.indexOf(text(row[categoryColumn!]))}:${rowValues.indexOf(text(row[col('row')!]))}`;
      cells.set(key, [...(cells.get(key) ?? []), row[firstMeasure]]);
    }
    return { ...entry, data: [...cells].map(([key, values]) => [...key.split(':').map(Number), data.aggregate(values)]) };
  };

  /**
   * Density: rows grouped into a 25 x 25 grid over X (or longitude) and Y (or latitude); each cell
   * holds the row count, or the aggregated Weight when one is mapped.
   */
  const densityGrid = (entry: Record<string, any>, xKey: string, yKey: string): Record<string, any> => {
    const [xCol, yCol, weight] = [col(xKey), col(yKey), col('weight')];
    if (!xCol || !yCol) throw new Error(`Select columns for ${xKey === 'x' ? 'X and Y' : 'Latitude and Longitude'}.`);
    const points = data.rows
      .map(row => ({ x: toNumber(row[xCol]), y: toNumber(row[yCol]), w: weight ? row[weight] : 1 }))
      .filter(point => point.x !== null && point.y !== null && (xKey === 'x' || (Math.abs(point.x!) <= 180 && Math.abs(point.y!) <= 90)));
    if (!points.length) throw new Error(xKey === 'x' ? 'X and Y need numeric values.' : 'Latitude must be -90..90 and longitude -180..180.');
    // About one cell per row for small sources, up to a 25 x 25 grid.
    const bins = Math.max(5, Math.min(25, Math.round(Math.sqrt(points.length) * 2)));
    const range = (values: number[]) => { const min = Math.min(...values), max = Math.max(...values); return { min, size: (max - min) / bins || 1 }; };
    const xr = range(points.map(p => p.x!)), yr = range(points.map(p => p.y!));
    const cells = new Map<string, { x: number; y: number; values: unknown[] }>();
    for (const point of points) {
      const i = Math.min(bins - 1, Math.floor((point.x! - xr.min) / xr.size));
      const j = Math.min(bins - 1, Math.floor((point.y! - yr.min) / yr.size));
      const cell = cells.get(`${i}:${j}`) ?? { x: xr.min + (i + 0.5) * xr.size, y: yr.min + (j + 0.5) * yr.size, values: [] };
      cell.values.push(point.w);
      cells.set(`${i}:${j}`, cell);
    }
    const value = (values: unknown[]) => weight ? data.aggregate(values) : values.length;
    const cellData = [...cells.values()].map(cell => xKey === 'x'
      ? { x: cell.x, y: cell.y, value: value(cell.values) }
      : { lon: cell.x, lat: cell.y, value: value(cell.values) });
    if (xKey !== 'x') {
      // Fit the map to the data, keeping any projection the template sets.
      bound['mapView'] = { ...bound['mapView'], fitToGeometry: { type: 'MultiPoint', coordinates: cellData.map(cell => [cell['lon'], cell['lat']]) } };
    }
    return { ...entry, colsize: xr.size, rowsize: yr.size, data: cellData };
  };

  const xyPoints = (type: string): Record<string, unknown>[] => {
    const [x, y, size, color, label] = ['x', 'y', 'size', 'color', 'label'].map(col);
    const points = data.rows.map(row => ({
      x: toNumber(row[x!]) ?? toTime(row[x!]), y: toNumber(row[y!]),
      ...(size ? { z: toNumber(row[size]) } : {}),
      ...(color ? { colorValue: toNumber(row[color]) } : {}),
      ...(label ? { name: text(row[label]) } : {}),
    })).filter(point => point.x !== null && point.y !== null);
    if (!points.length) throw new Error('X and Y need numeric (or date) values.');
    // Lines join points in X order.
    return ['line', 'spline', 'area', 'areaspline'].includes(type) ? points.sort((a, b) => a.x! - b.x!) : points;
  };

  if (Array.isArray(bound['series'])) {
    const chartType = (bound['chart'] as any)?.type;
    bound['series'] = bound['series'].flatMap((entry: any) => {
      if (!entry || typeof entry !== 'object') return [entry];
      const next = { ...entry };
      if (!next.type && chartType) next.type = chartType;
      return next.data === undefined && !DERIVED_SERIES.has(next.type) ? fill(next) : [next];
    });
  }
  return bound;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function toTime(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : null;
}

/** Recursively replaces exact-match placeholders with their bound value. */
function substitute(node: unknown, bindings: Map<string, { data: unknown; label: string }>): unknown {
  if (typeof node === 'string') {
    const match = PLACEHOLDER.exec(node);
    if (!match) return node;

    const binding = bindings.get(match[1].toLowerCase());
    if (!binding) return node;           // unbound: leave the literal text so it is visible
    return match[2] ? binding.label : binding.data;
  }

  if (Array.isArray(node)) return node.map(item => substitute(item, bindings));

  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = substitute(value, bindings);
    }
    return out;
  }

  return node;
}

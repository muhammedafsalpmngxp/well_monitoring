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
  return list.some(role => role.allowMultiple || ROW_ROLE_KEYS.has(role.key))
    || list.filter(role => role.type === 'measure').length !== 1
    || list.filter(role => role.type !== 'measure').length !== 1;
}

/** Role keys only the rows binding understands, e.g. Price Candlestick's single Time + Price. */
const ROW_ROLE_KEYS = new Set(['date', 'price', 'x', 'y', 'latitude', 'longitude', 'levels', 'groups', 'split', 'row',
  'open', 'high', 'low', 'close', 'size', 'color', 'weight', 'label', 'measures', 'measure2']);

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

  // Binding options a template may set under "tw" (removed before Highcharts sees them):
  //   sort: 'desc' | 'asc'     order categories by their total
  //   bucket: 'auto'           group a Date role into year / month / day / hour / minute buckets
  //   centerZero: true         colour axis symmetric around 0 (diverging scales)
  //   negateFirstSplit: true   first split value drawn negative (buy vs sell)
  const tw = (template['tw'] ?? {}) as { sort?: string; bucket?: string; centerZero?: boolean; negateFirstSplit?: boolean };
  delete template['tw'];

  const dateColumn = col('date');
  const times = dateColumn && tw.bucket ? data.rows.map(row => toTime(row[dateColumn])).filter((t): t is number => t !== null) : [];
  const bucket = timeBucket(times);
  const groupColumns = cols('groups');
  const categoryColumn = col('category');
  const hasCategory = !!categoryColumn || groupColumns.length > 0 || times.length > 0;
  const categoryOf = (row: Record<string, unknown>): string => groupColumns.length
    ? groupColumns.map(column => text(row[column])).join(' › ')
    : categoryColumn ? text(row[categoryColumn]) : bucket.label(toTime(row[dateColumn!]));
  const categories = hasCategory ? [...new Set(data.rows.map(categoryOf))] : [];
  if (times.length && !categoryColumn && !groupColumns.length) categories.sort();
  const perCategory = (column: string, rows = data.rows): (number | null)[] => {
    const groups = new Map<string, unknown[]>(categories.map(category => [category, []]));
    for (const row of rows) groups.get(categoryOf(row))?.push(row[column]);
    return [...groups.values()].map(values => values.length ? data.aggregate(values) : null);
  };

  const bindings = new Map<string, { data: unknown; label: string }>();
  for (const role of roles) {
    const mapped = cols(role.key);
    const label = mapped.join(', ') || role.label;
    if (role.type === 'measure') {
      const values = !mapped.length ? [] : hasCategory ? perCategory(mapped[0]) : data.rows.map(row => toNumber(row[mapped[0]]));
      bindings.set(role.key.toLowerCase(), { data: values, label });
    } else {
      const isAxis = role.key === 'category' || role.key === 'groups' || (role.key === 'date' && times.length > 0);
      bindings.set(role.key.toLowerCase(), { data: isAxis ? categories : mapped.length ? unique(mapped[0]) : [], label });
    }
  }

  const bound = substitute(template, bindings) as Record<string, any>;
  // A colour axis without a mapped Color column would grey out every point.
  if (roles.some(role => role.key === 'color') && !col('color')) delete bound['colorAxis'];

  const measureColumns = roles.filter(role => role.type === 'measure').flatMap(role => cols(role.key));
  const firstMeasure = measureColumns[0];

  const fill = (entry: Record<string, any>): Record<string, any>[] => {
    const type = entry['type'];
    if (['ohlc', 'candlestick'].includes(type)) return [{ ...entry, data: col('open') || !col('price') ? ohlcPoints() : priceCandles() }];
    if (['bar', 'column'].includes(type) && col('price') && !col('date')) return orderBook(entry);
    if (type === 'heatmap' && col('x') && col('y')) return [densityGrid(entry, 'x', 'y')];
    if (type === 'geoheatmap') return [densityGrid(entry, 'longitude', 'latitude')];
    if (['sunburst', 'treemap'].includes(type) && cols('levels').length) {
      const split = col('split');
      // Treemap by Group: the split column becomes the top level, so each group is one coloured block.
      if (split && type === 'treemap') return [{ ...entry, data: treeNodes(data.rows, [split, ...cols('levels')]) }];
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
    if (type === 'heatmap' && hasCategory && col('row')) return [categoryMatrix(entry)];
    if (col('x') && col('y')) {
      const split = col('split');
      if (!split) return [{ ...entry, data: xyPoints(type, data.rows) }];
      // X/Y Scatter by Group: one series (colour) per split value.
      const groups = unique(split);
      if (groups.length > 50) throw new Error(`Split By has ${groups.length} values; choose a column with 50 or fewer.`);
      return groups.map(value => ({ ...entry, name: value, data: xyPoints(type, data.rows.filter(row => text(row[split]) === value)) }));
    }
    const shape = NAMED_POINT_SHAPES[type];
    if (shape && hasCategory && firstMeasure) {
      return [{ ...entry, data: perCategory(firstMeasure).map((y, i) => shape(categories[i], y)) }];
    }
    if (!hasCategory) throw new Error('Select a column for Category.');
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

  /** Candlestick from a single Price column: open = first, close = last, high / low per time bucket. */
  const priceCandles = (): number[][] => {
    const price = col('price');
    if (!dateColumn || !price) throw new Error('Select columns for Date and Price.');
    const ticks = data.rows.map(row => ({ t: toTime(row[dateColumn]), p: toNumber(row[price]) }))
      .filter((tick): tick is { t: number; p: number } => tick.t !== null && tick.p !== null).sort((a, b) => a.t - b.t);
    if (!ticks.length) throw new Error('Every row needs a date and a numeric Price.');
    const step = timeBucket(ticks.map(tick => tick.t));
    const candles = new Map<number, number[]>();
    for (const { t, p } of ticks) {
      const start = step.start(t);
      const candle = candles.get(start);
      if (!candle) candles.set(start, [start, p, p, p, p]);
      else { candle[2] = Math.max(candle[2], p); candle[3] = Math.min(candle[3], p); candle[4] = p; }
    }
    return [...candles.values()];
  };

  /** Order book: Price grouped into about 30 buckets, one bar series per Split value (e.g. buy / sell). */
  const orderBook = (entry: Record<string, any>): Record<string, any>[] => {
    const [price, split, weight] = [col('price')!, col('split'), col('weight')];
    const prices = data.rows.map(row => toNumber(row[price])).filter((p): p is number => p !== null);
    if (!prices.length) throw new Error('Price needs numeric values.');
    const min = Math.min(...prices), size = niceStep((Math.max(...prices) - min) / 30);
    const start = Math.floor(min / size) * size;
    const index = (p: number) => Math.floor((p - start) / size + 1e-9);
    const count = index(Math.max(...prices)) + 1;
    bound['xAxis'] = { ...bound['xAxis'], categories: Array.from({ length: count }, (_, i) => String(+(start + i * size).toFixed(6))) };
    const groups = split ? unique(split) : [entry['name'] ?? price];
    return groups.map((value, g) => {
      const cells: unknown[][] = Array.from({ length: count }, () => []);
      for (const row of data.rows) {
        const p = toNumber(row[price]);
        if (p === null || (split && text(row[split]) !== value)) continue;
        cells[index(p)].push(weight ? row[weight] : 1);
      }
      const sign = tw.negateFirstSplit && g === 0 && groups.length > 1 ? -1 : 1;
      return { ...entry, name: value, data: cells.map(values => values.length ? sign * ((weight ? data.aggregate(values) : values.length) ?? 0) : null) };
    });
  };

  const treeNodes = (rows: Record<string, unknown>[], levels = cols('levels')): Record<string, unknown>[] => {
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
      const key = `${categories.indexOf(categoryOf(row))}:${rowValues.indexOf(text(row[col('row')!]))}`;
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
      .map(row => ({ x: toNumber(row[xCol]) ?? (xKey === 'x' ? toTime(row[xCol]) : null), y: toNumber(row[yCol]), w: weight ? row[weight] : 1 }))
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
    if (xKey === 'x' && data.rows.some(row => toNumber(row[xCol]) === null && toTime(row[xCol]) !== null)) {
      bound['xAxis'] = { ...bound['xAxis'], type: 'datetime' };
    }
    if (xKey !== 'x') {
      // Fit the map to the data, keeping any projection the template sets.
      bound['mapView'] = { ...bound['mapView'], fitToGeometry: { type: 'MultiPoint', coordinates: cellData.map(cell => [cell['lon'], cell['lat']]) } };
    }
    return { ...entry, colsize: xr.size, rowsize: yr.size, data: cellData };
  };

  /** A text X or Y (e.g. State) becomes a category axis; its values are plotted at their index. */
  const axisValues = (column: string, axis: 'xAxis' | 'yAxis', allowDate: boolean): ((value: unknown) => number | null) => {
    const textual = data.rows.some(row => row[column] !== null && row[column] !== undefined && row[column] !== ''
      && toNumber(row[column]) === null && !(allowDate && toTime(row[column]) !== null));
    if (!textual) return value => toNumber(value) ?? (allowDate ? toTime(value) : null);
    const names = unique(column);
    bound[axis] = { ...bound[axis], categories: names };
    return value => names.indexOf(text(value));
  };

  const xyPoints = (type: string, rows: Record<string, unknown>[]): Record<string, unknown>[] => {
    const [x, y, size, color, label] = ['x', 'y', 'size', 'color', 'label'].map(col);
    const xOf = axisValues(x!, 'xAxis', true), yOf = axisValues(y!, 'yAxis', false);
    const points = rows.map(row => ({
      x: xOf(row[x!]), y: yOf(row[y!]),
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
  if (tw.sort && Array.isArray(bound['xAxis']?.categories)) sortCategories(bound, tw.sort === 'asc' ? 1 : -1);
  if (tw.centerZero && bound['colorAxis']) {
    const values = (bound['series'] ?? []).flatMap((s: any) => (s?.data ?? []).map((p: any) => Array.isArray(p) ? p[2] : p?.value))
      .filter((v: unknown): v is number => typeof v === 'number');
    const max = Math.max(...values.map(Math.abs), 1);
    bound['colorAxis'] = { ...bound['colorAxis'], min: -max, max };
  }
  return bound;
}

/** Orders the category axis (and every series' values with it) by the categories' totals. */
function sortCategories(options: Record<string, any>, direction: 1 | -1): void {
  const categories: string[] = options['xAxis'].categories;
  const series = (options['series'] ?? []).filter((s: any) => Array.isArray(s?.data) && s.data.length === categories.length && s.data.every((v: unknown) => v === null || typeof v === 'number'));
  if (!series.length) return;
  const total = (i: number) => series.reduce((sum: number, s: any) => sum + (s.data[i] ?? 0), 0);
  const order = categories.map((_, i) => i).sort((a, b) => direction * (total(a) - total(b)));
  options['xAxis'] = { ...options['xAxis'], categories: order.map(i => categories[i]) };
  for (const s of series) s.data = order.map(i => s.data[i]);
}

/** A round bucket size (1, 2, 2.5 or 5 x a power of ten) at least `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find(step => step * power >= raw) ?? 10) * power;
}

/** Picks year / month / day / hour / minute buckets for the span of the times (about 30–60 buckets). */
function timeBucket(times: number[]): { start: (t: number) => number; label: (t: number | null) => string } {
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  const day = 86_400_000;
  const unit = span > 3 * 365 * day ? 'year' : span > 90 * day ? 'month' : span > 3 * day ? 'day' : span > 6 * 3_600_000 ? 'hour' : 'minute';
  const start = (t: number): number => {
    const d = new Date(t);
    if (unit === 'year') return Date.UTC(d.getUTCFullYear(), 0, 1);
    if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (unit === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor(t / (unit === 'hour' ? 3_600_000 : 60_000)) * (unit === 'hour' ? 3_600_000 : 60_000);
  };
  const label = (t: number | null): string => {
    if (t === null) return '(Blank)';
    const iso = new Date(start(t)).toISOString();
    return unit === 'year' ? iso.slice(0, 4) : unit === 'month' ? iso.slice(0, 7) : unit === 'day' ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  };
  return { start, label };
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

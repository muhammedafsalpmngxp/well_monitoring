import type Highcharts from 'highcharts';
import { buildWellMapOptions, defaultWellMapConfig, readWellMapConfig, WellMapConfig } from './well-map.util';
import { DaxMeasureConfig, evaluateDaxMeasure, evaluateDaxMeasureForRow } from './dax-evaluator.util';
import type { CustomVisualDataRole } from '../services/marketplace.service';

export const ADVANCED_CHART_LABELS = {
  boxplot: 'Boxplot', candlestick: 'Candlestick', stackedarea100: '100% Stacked Area',
  filledmap: 'Filled Map', linemap: 'Line Map', connectionmap: 'Connection Map',
  combomap: 'Combo Map', bubblemap: 'Bubble Map', geochart: 'Geo Chart', map: 'Map', wellmap: 'Well Map',
  pivottable: 'Pivot Table', matrix: 'Matrix', decompositiontree: 'Decomposition Tree',
  keyinfluencers: 'Key Influencers', customvisual: 'Custom Visual / Extensibility',
} as const;

export type AdvancedChartType = keyof typeof ADVANCED_CHART_LABELS;
export interface AdvancedChartPayload {
  type: AdvancedChartType;
  config: AdvancedChartConfig;
  rows: Record<string, unknown>[];
  daxMeasures?: DaxMeasureConfig[];
}
export interface AdvancedChartConfig {
  fields: Record<string, string>;
  dimensions: string[];
  measures: string[];
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  minimumGroupSize: number;
  customRenderer: string;
  /** Well Map: coordinate system, marker size / colour columns, tooltip columns, background. */
  map: WellMapConfig;
}

export function defaultAdvancedConfig(): AdvancedChartConfig {
  return { fields: {}, dimensions: [], measures: [], aggregation: 'sum', minimumGroupSize: 5, customRenderer: 'column', map: defaultWellMapConfig() };
}

export function isAdvancedChart(type: unknown): type is AdvancedChartType {
  return typeof type === 'string' && Object.hasOwn(ADVANCED_CHART_LABELS, type);
}

export function normalizeAdvancedChartType(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/chart$/, '');
  const aliases: Record<string, AdvancedChartType> = {
    '100stackedarea': 'stackedarea100', stackedarea100: 'stackedarea100',
    geo: 'geochart', customvisualextensibility: 'customvisual',
  };
  return aliases[key] ?? key;
}

type DataRow = Record<string, unknown>;

export const ADVANCED_FIELD_ROLES: Record<AdvancedChartType, string[]> = {
  boxplot: ['category', 'low', 'q1', 'median', 'q3', 'high'],
  candlestick: ['date', 'open', 'high', 'low', 'close'],
  stackedarea100: ['category', 'series', 'value'],
  filledmap: ['region', 'value'], geochart: ['region', 'value'],
  map: ['category', 'latitude', 'longitude'], bubblemap: ['category', 'latitude', 'longitude', 'value'],
  linemap: ['category', 'latitude', 'longitude', 'destinationLatitude', 'destinationLongitude'],
  connectionmap: ['category', 'latitude', 'longitude', 'destinationLatitude', 'destinationLongitude', 'value'],
  combomap: ['region', 'value', 'latitude', 'longitude'],
  wellmap: ['category', 'x', 'y'],
  pivottable: ['column'], matrix: [], decompositiontree: ['value'], keyinfluencers: ['value'],
  customvisual: ['category', 'value'],
};

/** Only additive aggregations let child nodes add up to their parent. */
export const DECOMPOSITION_AGGREGATIONS: AdvancedChartConfig['aggregation'][] = ['sum', 'count'];

/** A 100% stacked area saved with one band per measure (before Series and Value existed) keeps that shape. */
export function usesMeasureBands(type: string | null, config: AdvancedChartConfig): boolean {
  return type === 'stackedarea100' && config.measures.length > 0 && !config.fields['series'] && !config.fields['value'];
}


export const MAP_CHART_TYPES = new Set<string>(['filledmap', 'linemap', 'connectionmap', 'combomap', 'bubblemap', 'geochart', 'map']);

export function applyAdvancedDefaultMapping(type: AdvancedChartType, rows: DataRow[], columns: string[], config: AdvancedChartConfig): AdvancedChartConfig {
  const next = readAdvancedConfig(config);
  const roles = advancedFieldRoles(type, next);
  const visualRoles = multiRoleVisualRoles(type, next);
  next.fields = Object.fromEntries(Object.entries(next.fields).filter(([role]) => roles.includes(role)));
  // A Value carried over from another visual may hold negatives, which a percent stack cannot draw.
  if (type === 'stackedarea100' && next.fields['value'] && rows.some(row => (numeric(row[next.fields['value']]) ?? 0) < 0)) delete next.fields['value'];
  if (!['pivottable', 'matrix', 'decompositiontree', 'keyinfluencers'].includes(type) && !visualRoles.some(role => role.allowMultiple && role.type !== 'measure')) next.dimensions = [];
  if (!['pivottable', 'matrix', 'stackedarea100'].includes(type) && !visualRoles.some(role => role.allowMultiple && role.type === 'measure')) next.measures = [];
  if (type === 'decompositiontree' && !DECOMPOSITION_AGGREGATIONS.includes(next.aggregation)) next.aggregation = 'sum';
  const values = (column: string): unknown[] => rows.map(row => row[column]).filter(value => value !== null && value !== undefined && value !== '');
  const numericColumns = columns.filter(column => {
    const entries = values(column);
    return entries.length > 0 && entries.every(value => numeric(value) !== null);
  });
  const categoryColumns = [...columns.filter(column => !numericColumns.includes(column)), ...numericColumns];
  const mostlyNumericColumns = columns.filter(column => {
    const entries = values(column);
    return entries.length > 0 && entries.filter(value => numeric(value) !== null).length >= entries.length * 0.9;
  });
  const aliases: Record<string, string[]> = {
    low: ['low', 'minimum', 'min', 'lowprice'], high: ['high', 'maximum', 'max', 'highprice'],
    q1: ['q1', 'firstquartile', 'lowerquartile'], q3: ['q3', 'thirdquartile', 'upperquartile'],
    median: ['median', 'q2'], open: ['open', 'openprice'], close: ['close', 'closeprice'],
    latitude: ['latitude', 'lat', 'sourcelatitude', 'fromlat'],
    longitude: ['longitude', 'lon', 'lng', 'sourcelongitude', 'fromlon'],
    destinationLatitude: ['destinationlatitude', 'destinationlat', 'tolatitude', 'tolat'],
    destinationLongitude: ['destinationlongitude', 'destinationlon', 'tolongitude', 'tolon', 'tolng'],
    region: ['countryiso', 'countryisocode', 'isocode', 'iso2', 'countrycode', 'hckey', 'country', 'region'],
    x: ['easting', 'east', 'xcoord', 'x', 'longitude', 'lon', 'lng'],
    y: ['northing', 'north', 'ycoord', 'y', 'latitude', 'lat'],
  };
  const normalized = (column: string): string => column.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const role of roles) {
    if (next.fields[role] || !aliases[role]) continue;
    // Coordinates often carry a stray text value ("N/A"): a mostly numeric column still qualifies for X / Y.
    const candidates = role === 'region' ? columns : (role === 'x' || role === 'y') ? mostlyNumericColumns : numericColumns;
    const matched = aliases[role].map(alias => candidates.find(column => normalized(column) === alias)).find(column => {
      if (!column) return false;
      if (role === 'region') return values(column).length > 0 && values(column).every(value => /^[a-z]{2}$/i.test(String(value).trim()));
      if (/latitude|longitude/i.test(role)) {
        const limit = /latitude/i.test(role) ? 90 : 180;
        return values(column).every(value => Math.abs(numeric(value)!) <= limit);
      }
      return true;
    });
    if (matched) next.fields[role] = matched;
  }
  // Well Map: X / Y within degree ranges are longitude / latitude, otherwise projected Easting / Northing.
  if (type === 'wellmap' && next.fields['x'] && next.fields['y']) {
    const numbers = (column: string) => values(column).map(numeric).filter((value): value is number => value !== null);
    const degrees = numbers(next.fields['x']).every(value => Math.abs(value) <= 180)
      && numbers(next.fields['y']).every(value => Math.abs(value) <= 90);
    if (degrees) next.map = { ...next.map, coordinates: 'latlng' };
    else if (next.map.coordinates === 'latlng') next.map = { ...next.map, coordinates: defaultWellMapConfig().coordinates };
  }
  if (roles.includes('date') && !next.fields['date']) {
    const date = columns.find(column => values(column).length > 0 && values(column).every(value =>
      typeof value === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ t]|$)/i.test(value) && Number.isFinite(Date.parse(value))));
    if (date) next.fields['date'] = date;
  }
  const unused = (column: string): boolean => !Object.values(next.fields).includes(column) && !next.dimensions.includes(column) && !next.measures.includes(column);
  if (roles.includes('category') && !next.fields['category']) {
    const category = categoryColumns.find(unused);
    if (category) next.fields['category'] = category;
  }
  if (roles.includes('series') && !next.fields['series']) {
    const series = categoryColumns.find(column => !numericColumns.includes(column) && unused(column));
    if (series) next.fields['series'] = series;
  }
  if (roles.includes('value') && !next.fields['value']) {
    const value = numericColumns.find(column => unused(column) && (type !== 'stackedarea100' || values(column).every(entry => numeric(entry)! >= 0)));
    if (value) next.fields['value'] = value;
  }
  // Multi-role custom visual: fill its required roles with the first unused text / numeric columns.
  // Grouping roles (Split By, Levels) prefer columns with few distinct values, so a row id never becomes 1,000 series.
  const fewValues = (column: string) => new Set(values(column).map(String)).size <= 30;
  for (const role of visualRoles.filter(entry => entry.required)) {
    const pick = role.type === 'measure' ? numericColumns.find(unused)
      : role.key === 'category' ? categoryColumns.find(unused) : categoryColumns.find(column => unused(column) && fewValues(column));
    if (!pick) continue;
    if (!role.allowMultiple) { if (!next.fields[role.key]) next.fields[role.key] = pick; }
    else if (role.type === 'measure') { if (!next.measures.length) next.measures = [pick]; }
    else if (!next.dimensions.length) next.dimensions = [pick];
  }
  if (['pivottable', 'matrix', 'decompositiontree', 'keyinfluencers'].includes(type) && !next.dimensions.length) {
    const dimension = categoryColumns.find(column => unused(column) && (type !== 'keyinfluencers' || (() => {
      const counts = new Map<unknown, number>();
      const valid = rows.filter(row => numeric(row[next.fields['value']]) !== null);
      for (const row of valid) counts.set(row[column], (counts.get(row[column]) ?? 0) + 1);
      return [...counts.values()].some(count => count >= next.minimumGroupSize && valid.length - count >= next.minimumGroupSize);
    })()));
    if (dimension) next.dimensions = [dimension];
  }
  if (type === 'pivottable' && !next.fields['column']) {
    const column = categoryColumns.find(unused);
    if (column) next.fields['column'] = column;
  }
  if (['pivottable', 'matrix'].includes(type) && !next.measures.length) {
    next.measures = numericColumns.filter(unused).slice(0, 1);
  }
  return next;
}

export function readAdvancedConfig(value: unknown): AdvancedChartConfig {
  const defaults = defaultAdvancedConfig();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;
  const stringArray = (input: unknown): string[] => Array.isArray(input) ? [...new Set(input.filter((entry): entry is string => typeof entry === 'string'))] : [];
  return {
    fields: raw['fields'] && typeof raw['fields'] === 'object' ? Object.fromEntries(Object.entries(raw['fields']).filter(([, field]) => typeof field === 'string')) : {},
    dimensions: stringArray(raw['dimensions']), measures: stringArray(raw['measures']),
    aggregation: ['sum', 'avg', 'count', 'min', 'max'].includes(String(raw['aggregation'])) ? raw['aggregation'] as AdvancedChartConfig['aggregation'] : defaults.aggregation,
    minimumGroupSize: Math.max(2, Math.floor(numeric(raw['minimumGroupSize']) ?? defaults.minimumGroupSize)),
    customRenderer: typeof raw['customRenderer'] === 'string' ? raw['customRenderer'] : defaults.customRenderer,
    map: readWellMapConfig(raw['map']),
  };
}

export interface AdvancedCustomRenderer {
  id: string;
  label: string;
  render: (categories: string[], values: (number | null)[]) => Highcharts.Options;
  /** Multi-role visuals (several measures, split-by, X/Y, OHLC, levels): their roles, drawn from the rows. */
  roles?: CustomVisualDataRole[];
  renderRows?: (rows: DataRow[], config: AdvancedChartConfig) => Highcharts.Options;
}

const customRenderers = new Map<string, AdvancedCustomRenderer>([
  ['column', { id: 'column', label: 'Column', render: (categories, values) => ({ xAxis: { categories }, series: [{ type: 'column', data: values }] }) }],
  ['line', { id: 'line', label: 'Line', render: (categories, values) => ({ xAxis: { categories }, series: [{ type: 'line', data: values }] }) }],
  ['pie', { id: 'pie', label: 'Pie', render: (categories, values) => ({ series: [{ type: 'pie', data: categories.map((name, index) => ({ name, y: values[index] })) }] }) }],
]);

export function registerAdvancedCustomRenderer(renderer: AdvancedCustomRenderer): void {
  if (!/^[a-z][a-z0-9-]*$/.test(renderer.id) || customRenderers.has(renderer.id)) throw new Error('Renderer ID must be unique and contain lowercase letters, numbers or hyphens.');
  customRenderers.set(renderer.id, renderer);
}

export function getAdvancedCustomRenderers(): { id: string; label: string }[] {
  return [...customRenderers.values()].map(({ id, label }) => ({ id, label }));
}

/** The data roles of the selected custom visual when it is multi-role; empty otherwise. */
export function multiRoleVisualRoles(type: string | null, config: AdvancedChartConfig): CustomVisualDataRole[] {
  if (type !== 'customvisual') return [];
  const renderer = customRenderers.get(config.customRenderer);
  return renderer?.renderRows ? renderer.roles ?? [] : [];
}

/** Single-column roles shown as dropdowns: the multi-role visual's own, else the type's fixed roles. */
export function advancedFieldRoles(type: AdvancedChartType, config: AdvancedChartConfig): string[] {
  if (usesMeasureBands(type, config)) return ['category'];
  const visualRoles = multiRoleVisualRoles(type, config);
  return visualRoles.length ? visualRoles.filter(role => !role.allowMultiple).map(role => role.key) : ADVANCED_FIELD_ROLES[type];
}

export function validateAdvancedConfig(type: AdvancedChartType, rows: DataRow[], config: AdvancedChartConfig): void {
  const visualRoles = multiRoleVisualRoles(type, config);
  const roles = advancedFieldRoles(type, config);
  if (visualRoles.length) {
    const missing = visualRoles.filter(role => role.required && (role.allowMultiple
      ? !(role.type === 'measure' ? config.measures : config.dimensions).length
      : !config.fields[role.key])).map(role => role.label);
    if (missing.length) throw new Error(`Select columns for: ${missing.join(', ')}.`);
  } else {
    requireFields(config, roles);
  }
  if (['pivottable', 'matrix', 'decompositiontree', 'keyinfluencers'].includes(type) && !config.dimensions.length) throw new Error('Select at least one dimension.');
  if (['pivottable', 'matrix'].includes(type) && !config.measures.length) throw new Error('Select measures.');
  const columns = new Set(rows.flatMap(row => Object.keys(row)));
  const selected = [...roles.map(role => config.fields[role]).filter(Boolean), ...config.dimensions, ...config.measures];
  if (rows.length && selected.some(column => !columns.has(column))) throw new Error('A mapped column is missing from the source. Update the data mapping.');
  if (['pivottable', 'matrix'].includes(type) && config.dimensions.some(column => config.measures.includes(column) || column === config.fields['column'])) throw new Error('Rows, Columns and Values must be different columns.');
  if (type === 'decompositiontree' && config.dimensions.includes(config.fields['value'])) throw new Error('The Target metric cannot also be a Breakdown dimension. Untick it under Breakdown dimensions.');
}

export interface InfluencerResult {
  label: string;
  count: number;
  mean: number;
  comparisonMean: number;
  difference: number;
}

export function calculateInfluencers(rows: DataRow[], config: AdvancedChartConfig): InfluencerResult[] {
  const valid = rows.filter(row => numeric(row[config.fields['value']]) !== null);
  const total = valid.reduce((sum, row) => sum + numeric(row[config.fields['value']])!, 0);
  const results: InfluencerResult[] = [];
  for (const dimension of config.dimensions) {
    const groups = new Map<string, { count: number; sum: number }>();
    for (const row of valid) {
      const label = String(row[dimension] ?? '(Blank)');
      const group = groups.get(label) ?? { count: 0, sum: 0 };
      group.count++;
      group.sum += numeric(row[config.fields['value']])!;
      groups.set(label, group);
    }
    for (const [label, group] of groups) {
      const others = valid.length - group.count;
      if (group.count < config.minimumGroupSize || others < config.minimumGroupSize) continue;
      const mean = group.sum / group.count;
      const comparisonMean = (total - group.sum) / others;
      results.push({ label: `${dimension}: ${label}`, count: group.count, mean, comparisonMean, difference: mean - comparisonMean });
    }
  }
  return results.sort((first, second) => Math.abs(second.difference) - Math.abs(first.difference)).slice(0, 20);
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const result = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) ? result : null;
}

function requireFields(config: AdvancedChartConfig, roles: string[]): void {
  const missing = roles.filter(role => !config.fields[role]);
  if (missing.length) throw new Error(`Select columns for: ${missing.join(', ')}.`);
}

export function aggregateAdvancedValues(values: unknown[], operation: AdvancedChartConfig['aggregation']): number | null {
  if (operation === 'count') return values.length;
  const numbers = values.map(numeric).filter((value): value is number => value !== null);
  if (!numbers.length) return null;
  if (operation === 'min') return Math.min(...numbers);
  if (operation === 'max') return Math.max(...numbers);
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return operation === 'avg' ? total / numbers.length : total;
}

export function buildAdvancedOptions(type: AdvancedChartType, rows: DataRow[], config: AdvancedChartConfig, mapData?: unknown): Highcharts.Options {
  validateAdvancedConfig(type, rows, config);
  const base: Highcharts.Options = {
    title: { text: undefined }, credits: { enabled: false },
    chart: { animation: false, backgroundColor: 'transparent' },
    // Accessibility stays ON so advanced and custom visuals get keyboard navigation and
    // screen-reader descriptions like the built-in charts. The module is loaded in app.config.
    accessibility: { enabled: true },
  };
  const fields = config.fields;
  if (type === 'boxplot') {
    requireFields(config, ['category', 'low', 'q1', 'median', 'q3', 'high']);
    const data = rows.map(row => {
      const values = ['low', 'q1', 'median', 'q3', 'high'].map(role => numeric(row[fields[role]]));
      if (values.some(value => value === null) || values.some((value, index) => index > 0 && value! < values[index - 1]!)) {
        throw new Error('Boxplot requires low <= Q1 <= median <= Q3 <= high in every row.');
      }
      return values as number[];
    });
    return { ...base, xAxis: { categories: rows.map(row => String(row[fields['category']] ?? '')) }, series: [{ type: 'boxplot', name: 'Distribution', data }] };
  }
  if (type === 'candlestick') {
    requireFields(config, ['date', 'open', 'high', 'low', 'close']);
    const data = rows.map(row => {
      const dateValue = row[fields['date']];
      const date = typeof dateValue === 'number' ? dateValue : Date.parse(String(dateValue ?? ''));
      const values = ['open', 'high', 'low', 'close'].map(role => numeric(row[fields[role]]));
      const [open, high, low, close] = values;
      if (!Number.isFinite(date) || values.some(value => value === null) || low! > Math.min(open!, close!) || high! < Math.max(open!, close!) || low! > high!) {
        throw new Error('Candlestick requires valid dates and low <= open/close <= high.');
      }
      return [date, ...values] as number[];
    }).sort((first, second) => first[0] - second[0]);
    if (data.some((point, index) => index > 0 && point[0] === data[index - 1][0])) throw new Error('Candlestick dates must be unique; aggregate duplicate periods first.');
    return { ...base, xAxis: { type: 'datetime' }, series: [{ type: 'candlestick', name: 'OHLC', data }] };
  }
  if (type === 'stackedarea100') {
    const tooltip = { pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b> ({point.y})' };
    const percentAxis = { min: 0, max: 100, title: { text: 'Percent' } };
    if (!usesMeasureBands(type, config)) {
      // X-axis x Series cells hold the aggregated Value; a missing cell is an empty band at that X.
      requireFields(config, ['category', 'series', 'value']);
      const xLabels: string[] = [];
      const seriesNames: string[] = [];
      const cells = new Map<string, unknown[]>();
      for (const row of rows) {
        const x = String(row[fields['category']] ?? '(Blank)');
        const name = String(row[fields['series']] ?? '(Blank)');
        if (!xLabels.includes(x)) xLabels.push(x);
        if (!seriesNames.includes(name)) seriesNames.push(name);
        const key = `${name}\u0000${x}`;
        cells.set(key, [...(cells.get(key) ?? []), row[fields['value']]]);
      }
      if (seriesNames.length < 2) throw new Error('The Series column needs at least two different values.');
      const series: Highcharts.SeriesOptionsType[] = seriesNames.map(name => ({
        type: 'area', name,
        data: xLabels.map(x => {
          const value = aggregateAdvancedValues(cells.get(`${name}\u0000${x}`) ?? [], config.aggregation) ?? 0;
          if (value < 0) throw new Error(`100% Stacked Area requires non-negative values; "${fields['value']}" has negative values for "${name}" at "${x}". Filter those rows out or choose another Value column.`);
          return value;
        }),
      }));
      return { ...base, xAxis: { categories: xLabels, title: { text: fields['category'] } }, yAxis: percentAxis, plotOptions: { area: { stacking: 'percent' } }, tooltip, series };
    }
    requireFields(config, ['category']);
    if (config.measures.length < 2) throw new Error('Select at least two measures.');
    const grouped = new Map<string, DataRow[]>();
    for (const row of rows) {
      const category = String(row[fields['category']] ?? '(Blank)');
      grouped.set(category, [...(grouped.get(category) ?? []), row]);
    }
    const series: Highcharts.SeriesOptionsType[] = config.measures.map(measure => ({
      type: 'area', name: measure,
      data: [...grouped.values()].map(group => {
        const value = aggregateAdvancedValues(group.map(row => row[measure]), config.aggregation);
        if (value !== null && value < 0) throw new Error('100% Stacked Area requires non-negative values.');
        return value;
      }),
    }));
    return { ...base, xAxis: { categories: [...grouped.keys()] }, yAxis: percentAxis, plotOptions: { area: { stacking: 'percent' } }, tooltip, series };
  }
  if (type === 'wellmap') return buildWellMapOptions(rows, fields, config.map).options;
  if (MAP_CHART_TYPES.has(type)) {
    if (!mapData) throw new Error('Map boundaries are unavailable.');
    const coordinates = (row: DataRow, destination = false): [number, number] => {
      const latitude = numeric(row[fields[destination ? 'destinationLatitude' : 'latitude']]);
      const longitude = numeric(row[fields[destination ? 'destinationLongitude' : 'longitude']]);
      if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Map coordinates must be latitude -90..90 and longitude -180..180.');
      return [longitude, latitude];
    };
    const mapSeries: Highcharts.SeriesOptionsType[] = [{ type: 'map', name: 'Regions', mapData: mapData as Highcharts.SeriesMapOptions['mapData'], allAreas: true, nullColor: '#eef2f4', borderColor: '#bcc6cd', showInLegend: false, enableMouseTracking: false }];
    if (['filledmap', 'geochart', 'combomap'].includes(type)) {
      const groups = new Map<string, unknown[]>();
      for (const row of rows) {
        const key = String(row[fields['region']] ?? '').trim().toLowerCase();
        if (!/^[a-z]{2}$/.test(key)) throw new Error('World regions require two-letter ISO country codes (for example IN, OM, US).');
        groups.set(key, [...(groups.get(key) ?? []), row[fields['value']]]);
      }
      mapSeries[0] = { ...mapSeries[0] as Highcharts.SeriesMapOptions, enableMouseTracking: true, joinBy: 'hc-key', data: [...groups].map(([key, values]) => ({ 'hc-key': key, value: aggregateAdvancedValues(values, config.aggregation) })) };
    }
    if (['map', 'bubblemap', 'combomap'].includes(type)) {
      const data = rows.map(row => {
        const [lon, lat] = coordinates(row);
        const value = numeric(row[fields['value']]);
        if (type !== 'map' && (value === null || value < 0)) throw new Error('Bubble sizes require non-negative numeric values.');
        return { name: String(row[fields['category']] ?? row[fields['region']] ?? ''), lon, lat, z: value ?? 1 };
      });
      mapSeries.push(type === 'map' ? { type: 'mappoint', name: 'Locations', data } : { type: 'mapbubble', name: fields['value'], minSize: 5, maxSize: '12%', data });
    }
    if (type === 'linemap' || type === 'connectionmap') {
      if (type === 'linemap') {
        mapSeries.push({ type: 'mapline', name: 'Routes', color: '#168675', lineWidth: 2, data: rows.map(row => ({ name: String(row[fields['category']] ?? ''), geometry: { type: 'LineString', coordinates: [coordinates(row), coordinates(row, true)] } })) });
      } else {
        mapSeries.push({ type: 'flowmap', name: 'Connections', data: rows.map(row => {
          const [lon, lat] = coordinates(row);
          const [toLon, toLat] = coordinates(row, true);
          const weight = numeric(row[fields['value']]);
          if (weight === null || weight <= 0) throw new Error('Connection weights must be positive numbers.');
          return { name: String(row[fields['category']] ?? ''), from: { lon, lat }, to: { lon: toLon, lat: toLat }, weight };
        }) });
      }
    }
    return { ...base, chart: { ...base.chart, map: mapData as Highcharts.ChartOptions['map'] }, mapNavigation: { enabled: true, enableMouseWheelZoom: false }, colorAxis: { minColor: '#e5f3ee', maxColor: '#127a65' }, series: mapSeries };
  }
  if (type === 'decompositiontree') {
    if (!DECOMPOSITION_AGGREGATIONS.includes(config.aggregation)) throw new Error('Decomposition Tree needs Sum or Count so child values add up to their parent.');
    const formatValue = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const valueFor = (group: DataRow[]) => aggregateAdvancedValues(group.map(row => row[fields['value']]), config.aggregation) ?? 0;
    const total = valueFor(rows);
    const nodes: { id: string; parent?: string; name: string; value: number; custom: Record<string, string> }[] = [
      { id: 'root', name: 'Total', value: total, custom: { detail: formatValue(total), tooltip: `Total: <b>${formatValue(total)}</b>` } },
    ];
    let leaves = 0;
    const visit = (group: DataRow[], level: number, parent: string, parentValue: number): void => {
      if (level >= config.dimensions.length) { leaves++; return; }
      const dimension = config.dimensions[level];
      const grouped = new Map<string, DataRow[]>();
      for (const row of group) {
        const label = String(row[dimension] ?? '(Blank)');
        grouped.set(label, [...(grouped.get(label) ?? []), row]);
      }
      for (const [label, children] of grouped) {
        if (nodes.length >= 1000) throw new Error('Decomposition exceeds 1,000 nodes. Filter the source or select fewer dimensions.');
        const id = `node-${nodes.length}`;
        const value = valueFor(children);
        const share = parentValue ? `${(value / parentValue * 100).toFixed(1)}%` : 'n/a';
        nodes.push({ id, parent, name: label, value, custom: {
          detail: `${formatValue(value)} · ${share} of parent`,
          tooltip: `${dimension}: <b>${label}</b><br/>Value: <b>${formatValue(value)}</b><br/>Contribution to parent: <b>${share}</b>`,
        } });
        visit(children, level + 1, id, value);
      }
    };
    visit(rows, 0, 'root', total);
    // Treegraph lays nodes out over the real chart height (scrollablePlotArea is not honoured), so each leaf
    // needs ~40px for its two-line label; the host scrolls when this exceeds the visible area.
    const height = leaves * 40 + 120;
    return { ...base, chart: { ...base.chart, marginRight: 210, ...(height > 300 ? { height } : {}) },
      subtitle: { text: `Breakdown: ${config.dimensions.join(' \u2192 ')}` },
      series: [{ type: 'treegraph', data: nodes as Highcharts.SeriesTreegraphOptions['data'], marker: { radius: 6 },
        dataLabels: { enabled: true, pointFormat: '{point.name}<br/>{point.custom.detail}', align: 'left', x: 14, crop: false, overflow: 'allow',
          backgroundColor: '#ffffff', padding: 2,
          style: { width: 190, textOverflow: 'ellipsis', whiteSpace: 'nowrap', textOutline: 'none', textTransform: 'none', fontSize: '11px', fontWeight: 'normal' } },
        collapseButton: { enabled: true }, tooltip: { pointFormat: '{point.custom.tooltip}' } }] };
  }
  if (type === 'keyinfluencers') {
    const influences = calculateInfluencers(rows, config);
    if (!influences.length) throw new Error('No comparable groups meet the minimum sample size.');
    return { ...base, chart: { ...base.chart, type: 'bar' }, subtitle: { text: 'Mean difference vs other rows; association, not causation' }, xAxis: { categories: influences.map(result => result.label) }, yAxis: { title: { text: `Difference in mean ${fields['value']}` }, plotLines: [{ value: 0, width: 1, color: '#777777' }] }, legend: { enabled: false }, tooltip: { pointFormat: 'Difference: <b>{point.y:.2f}</b><br/>Group rows: {point.custom.count}<br/>Group mean: {point.custom.mean:.2f}<br/>Other rows mean: {point.custom.comparisonMean:.2f}' }, series: [{ type: 'bar', name: 'Mean difference', data: influences.map(result => ({ y: result.difference, color: result.difference >= 0 ? '#168675' : '#d45a59', custom: { ...result } })) }] };
  }
  if (type === 'customvisual') {
    const renderer = customRenderers.get(config.customRenderer);
    if (!renderer) throw new Error('The saved custom renderer is not installed.');
    if (renderer.renderRows) return { ...base, ...renderer.renderRows(rows, config) };
    const groups = new Map<string, unknown[]>();
    for (const row of rows) {
      const category = String(row[fields['category']] ?? '(Blank)');
      groups.set(category, [...(groups.get(category) ?? []), row[fields['value']]]);
    }
    return { ...base, ...renderer.render([...groups.keys()], [...groups.values()].map(values => aggregateAdvancedValues(values, config.aggregation))) };
  }
  throw new Error('This visual requires the grid renderer.');
}

export function remapAdvancedColumns(value: unknown, fromColumn: string, toColumn: string): AdvancedChartConfig {
  const config = readAdvancedConfig(value);
  const rename = (column: string) => column === fromColumn ? toColumn : column;
  return {
    ...config, fields: Object.fromEntries(Object.entries(config.fields).map(([role, column]) => [role, rename(column)])),
    dimensions: config.dimensions.map(rename), measures: config.measures.map(rename),
    map: { ...config.map, size: rename(config.map.size), color: rename(config.map.color), tooltip: config.map.tooltip.map(rename) },
  };
}

export function prepareAdvancedDax(rows: DataRow[], measures: DaxMeasureConfig[] = []) {
  const active = measures.filter(measure => measure.includeInSeries !== false && measure.expression?.trim());
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const usedFields = new Set(columns);
  const rowMeasures = active.filter(measure => measure.evaluationScope === 'row').map(measure => {
    const name = measure.name?.trim() || 'New Metric';
    let field = name;
    let suffix = 2;
    while (usedFields.has(field)) field = `${name} (${suffix++})`;
    usedFields.add(field);
    return { field, measure };
  });
  return {
    rows: rowMeasures.length ? rows.map(row => ({ ...row, ...Object.fromEntries(rowMeasures.map(({ field, measure }) =>
      [field, evaluateDaxMeasureForRow(measure, row, rows, columns)])) })) : rows,
    rowMeasures,
    summaries: active.map(measure => ({ measure, value: evaluateDaxMeasure(measure, rows, columns) })),
  };
}

export function advancedChartExport(payload: AdvancedChartPayload): { headers: string[]; rows: (string | number)[][] } {
  const dax = prepareAdvancedDax(payload.rows, payload.daxMeasures);
  const headers = [...new Set([...Object.values(payload.config.fields), ...payload.config.dimensions, ...payload.config.measures, ...dax.rowMeasures.map(entry => entry.field)])].filter(Boolean);
  const summaries = dax.summaries.filter(entry => entry.measure.evaluationScope !== 'row');
  if (summaries.length && headers.length < 2) headers.push(...['Metric', 'Value'].slice(headers.length));
  const rows = dax.rows.map(row => headers.map(column => {
    const value = row[column];
    return typeof value === 'number' ? value : value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }));
  for (const { measure, value } of summaries) {
    rows.push(headers.map((_, index) => index === 0 ? measure.name?.trim() || 'New Metric' : index === 1 ? value : ''));
  }
  return { headers, rows };
}
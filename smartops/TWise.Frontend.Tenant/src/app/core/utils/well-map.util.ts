import proj4 from 'proj4';
import type Highcharts from 'highcharts';

/** How the X / Y columns of a Well Map are read. */
export type WellMapCoordinates = 'utm-psd93-40n' | 'utm-wgs84-40n' | 'utm-wgs84-39n' | 'latlng';

export const WELL_MAP_COORDINATES: { value: WellMapCoordinates; label: string }[] = [
  { value: 'utm-psd93-40n', label: 'Easting / Northing — PSD93 / UTM 40N (Oman)' },
  { value: 'utm-wgs84-40n', label: 'Easting / Northing — WGS 84 / UTM 40N' },
  { value: 'utm-wgs84-39n', label: 'Easting / Northing — WGS 84 / UTM 39N' },
  { value: 'latlng', label: 'Longitude / Latitude (degrees)' },
];

/** EPSG definitions (epsg.io: 3440, 32640, 32639). PSD93 differs from WGS 84 by about 370 m in Oman. */
const PROJECTIONS: Record<Exclude<WellMapCoordinates, 'latlng'>, string> = {
  'utm-psd93-40n': '+proj=utm +zone=40 +a=6378249.145 +rf=293.465 +towgs84=-180.624,-225.516,173.919,-0.81,-1.898,8.336,16.71006 +units=m +no_defs',
  'utm-wgs84-40n': '+proj=utm +zone=40 +datum=WGS84 +units=m +no_defs',
  'utm-wgs84-39n': '+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs',
};

export interface WellMapConfig {
  coordinates: WellMapCoordinates;
  /** Optional numeric column for marker size. */
  size: string;
  /** Optional column whose values colour the markers (one legend entry per value). */
  color: string;
  /** Extra columns shown in the marker tooltip. */
  tooltip: string[];
  background: WellMapBackground;
}

export type WellMapBackground = 'osm' | 'satellite' | 'topo' | 'none';

/** Map backgrounds: tile provider for Highcharts tiledwebmap, and the attribution its licence requires. */
export const WELL_MAP_BACKGROUNDS: { value: WellMapBackground; label: string }[] = [
  { value: 'osm', label: 'Street (OpenStreetMap)' },
  { value: 'satellite', label: 'Satellite (Esri World Imagery)' },
  { value: 'topo', label: 'Terrain (Esri World Topo)' },
  { value: 'none', label: 'None (offline)' },
];
const TILE_PROVIDERS: Record<Exclude<WellMapBackground, 'none'>, { provider: Record<string, string>; credit: string; href: string }> = {
  osm: { provider: { type: 'OpenStreetMap' }, credit: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  satellite: { provider: { type: 'Esri', theme: 'WorldImagery' }, credit: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics', href: 'https://www.esri.com' },
  topo: { provider: { type: 'Esri', theme: 'WorldTopoMap' }, credit: 'Tiles © Esri — Esri, HERE, Garmin, OpenStreetMap contributors', href: 'https://www.esri.com' },
};

export function defaultWellMapConfig(): WellMapConfig {
  return { coordinates: 'utm-psd93-40n', size: '', color: '', tooltip: [], background: 'osm' };
}

export function readWellMapConfig(value: unknown): WellMapConfig {
  const defaults = defaultWellMapConfig();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;
  const text = (input: unknown) => (typeof input === 'string' ? input : '');
  return {
    coordinates: WELL_MAP_COORDINATES.some(option => option.value === raw['coordinates']) ? raw['coordinates'] as WellMapCoordinates : defaults.coordinates,
    size: text(raw['size']),
    color: text(raw['color']),
    tooltip: Array.isArray(raw['tooltip']) ? [...new Set(raw['tooltip'].filter((entry): entry is string => typeof entry === 'string'))] : [],
    background: WELL_MAP_BACKGROUNDS.some(option => option.value === raw['background']) ? raw['background'] as WellMapBackground : defaults.background,
  };
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** [longitude, latitude] in WGS 84, or null when the values are missing or not a valid position. */
export function toLonLat(x: unknown, y: unknown, coordinates: WellMapCoordinates): [number, number] | null {
  const easting = toNumber(x);
  const northing = toNumber(y);
  if (easting === null || northing === null || (easting === 0 && northing === 0)) return null;
  const [lon, lat] = coordinates === 'latlng' ? [easting, northing] : proj4(PROJECTIONS[coordinates], 'EPSG:4326', [easting, northing]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Points further than this from the median position are treated as bad coordinates. A dropped Northing digit puts a
 * well ~16° away; 10° still keeps maps spanning neighbouring regions (e.g. Oman and Qatar, ~6° apart).
 */
const OUTLIER_DEGREES = 10;

const MARKER_COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#4D7C0F', '#9333EA', '#EA580C'];

/** North arrow in the map's top-left corner (always in view; the zoom buttons sit bottom-left) (the Web Mercator view is always north-up), redrawn on every render. */
function drawCompass(chart: Highcharts.Chart): void {
  const host = chart as Highcharts.Chart & { wellMapCompass?: Highcharts.SVGElement };
  host.wellMapCompass?.destroy();
  const renderer = chart.renderer;
  const group = renderer.g('well-map-compass')
    .attr({ zIndex: 7, translateX: chart.plotLeft + 10, translateY: chart.plotTop + 16, 'aria-label': 'Compass: north is up', role: 'img' })
    .add();
  renderer.circle(18, 22, 17).attr({ fill: 'rgba(255, 255, 255, 0.9)', stroke: '#98A2B3', 'stroke-width': 1 }).add(group);
  renderer.path(['M', 18, 8, 'L', 24, 24, 'L', 18, 21, 'Z'] as unknown as Highcharts.SVGPathArray).attr({ fill: '#B42318' }).add(group);
  renderer.path(['M', 18, 8, 'L', 12, 24, 'L', 18, 21, 'Z'] as unknown as Highcharts.SVGPathArray).attr({ fill: '#D92D20' }).add(group);
  renderer.path(['M', 18, 36, 'L', 24, 24, 'L', 18, 27, 'Z'] as unknown as Highcharts.SVGPathArray).attr({ fill: '#667085' }).add(group);
  renderer.path(['M', 18, 36, 'L', 12, 24, 'L', 18, 27, 'Z'] as unknown as Highcharts.SVGPathArray).attr({ fill: '#98A2B3' }).add(group);
  renderer.text('N', 18, 7).attr({ align: 'center' }).css({ fontSize: '10px', fontWeight: '700', color: '#101828' }).add(group);
  host.wellMapCompass = group;
}

/** Google Maps URLs (no API key): Street View and the map at a position, opened in a new tab. */
export function streetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Highcharts map options for wells (or any located rows): markers on an OpenStreetMap background, sized by a
 * measure and coloured by a category, with the chosen columns in the tooltip. Rows whose coordinates are missing
 * or far from the others are left out and counted in the caption.
 */
export function buildWellMapOptions(
  rows: Record<string, unknown>[], fields: Record<string, string>, map: WellMapConfig,
): { options: Highcharts.Options; shown: number; skipped: number } {
  const located = rows.flatMap(row => {
    const position = toLonLat(row[fields['x']], row[fields['y']], map.coordinates);
    return position ? [{ row, lon: position[0], lat: position[1] }] : [];
  });
  const centreLon = located.length ? median(located.map(point => point.lon)) : 0;
  const centreLat = located.length ? median(located.map(point => point.lat)) : 0;
  const points = located.filter(point => Math.abs(point.lon - centreLon) <= OUTLIER_DEGREES && Math.abs(point.lat - centreLat) <= OUTLIER_DEGREES);
  const skipped = rows.length - points.length;
  if (!points.length) throw new Error('No row has valid coordinates. Check the X / Y columns and the coordinate system.');

  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = map.color ? String(point.row[map.color] ?? '(Blank)') : 'Wells';
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const tooltipColumns = [...new Set([map.size, map.color, ...map.tooltip].filter(Boolean))];
  const series: Highcharts.SeriesOptionsType[] = [...groups].map(([name, group], index) => ({
    type: map.size ? 'mapbubble' : 'mappoint',
    name,
    color: MARKER_COLORS[index % MARKER_COLORS.length],
    // Colour carries the meaning: every group uses a circle (Highcharts would cycle shapes per series).
    ...(map.size ? { minSize: 6, maxSize: '8%', marker: { symbol: 'circle' } } : { marker: { symbol: 'circle', radius: 5, lineColor: '#FFFFFF', lineWidth: 1 } }),
    dataLabels: { enabled: false },
    data: group.map(point => ({
      name: String(point.row[fields['category']] ?? ''),
      lon: point.lon,
      lat: point.lat,
      ...(map.size ? { z: Math.max(0, toNumber(point.row[map.size]) ?? 0) } : {}),
      custom: Object.fromEntries(tooltipColumns.map(column => [column, point.row[column]])),
    })),
  } as Highcharts.SeriesOptionsType));
  const tiles = map.background === 'none' ? null : TILE_PROVIDERS[map.background];
  if (tiles) series.unshift({ type: 'tiledwebmap', name: 'Map', provider: tiles.provider, showInLegend: false } as Highcharts.SeriesOptionsType);

  const options: Highcharts.Options = {
    title: { text: undefined },
    credits: tiles ? { enabled: true, text: tiles.credit, href: tiles.href } : { enabled: false },
    chart: {
      animation: false, backgroundColor: tiles ? 'transparent' : '#F8FAFC',
      events: { render() { drawCompass(this); } },
    },
    accessibility: { enabled: true },
    mapView: {
      projection: { name: 'WebMercator' },
      fitToGeometry: { type: 'MultiPoint', coordinates: points.map(point => [point.lon, point.lat]) },
      padding: 30,
      maxZoom: 16,
    } as Highcharts.MapViewOptions,
    // Zoom with the mouse wheel, the +/- buttons or a double click; drag to pan.
    mapNavigation: { enabled: true, enableMouseWheelZoom: true, enableDoubleClickZoom: true, buttonOptions: { verticalAlign: 'bottom' } },
    legend: { enabled: !!map.color },
    tooltip: {
      useHTML: true,
      // Stays open while the pointer moves into it, so its Street View / Google Maps links can be clicked.
      stickOnContact: true,
      headerFormat: '',
      pointFormatter(this: Highcharts.Point) {
        const custom = ((this as unknown as { custom?: Record<string, unknown> }).custom) ?? {};
        const lines = Object.entries(custom)
          .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
          .map(([column, value]) => `${escapeHtml(column)}: <b>${escapeHtml(value)}</b>`);
        const { lat, lon } = this.options as { lat?: number; lon?: number };
        const links = typeof lat === 'number' && typeof lon === 'number'
          ? `<br/><a href="${streetViewUrl(lat, lon)}" target="_blank" rel="noopener noreferrer" style="color:#9EC5FF">Street View ↗</a>`
            + ` &nbsp; <a href="${googleMapsUrl(lat, lon)}" target="_blank" rel="noopener noreferrer" style="color:#9EC5FF">Google Maps ↗</a>`
          : '';
        return `<b>${escapeHtml(this.name)}</b>${lines.length ? '<br/>' + lines.join('<br/>') : ''}${links}`;
      },
    },
    caption: skipped ? { text: `${skipped} of ${rows.length} rows not shown: missing or out-of-area coordinates.` } : undefined,
    series,
  };
  return { options, shown: points.length, skipped };
}

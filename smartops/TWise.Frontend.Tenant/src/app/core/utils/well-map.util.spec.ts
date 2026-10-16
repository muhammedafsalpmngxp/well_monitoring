import { describe, expect, it } from 'vitest';
import { buildWellMapOptions, defaultWellMapConfig, googleMapsUrl, readWellMapConfig, streetViewUrl, toLonLat } from './well-map.util';

const fields = { category: 'well_id', x: 'easting', y: 'northing' };
const rows = [
  { well_id: '32580', easting: 309007.0, northing: 2013085.99, status: 'Active', progress: 80 },
  { well_id: '36810', easting: 289192.77, northing: 1976087.73, status: 'Pending', progress: 20 },
  { well_id: '35593', easting: 338377.9, northing: 2003003.97, status: 'Active', progress: 55 },
  { well_id: '32588', easting: 334839.13, northing: 200234.21, status: 'Active', progress: 10 }, // dropped digit
  { well_id: '40000', easting: null, northing: null, status: 'Active', progress: 0 },
];

describe('well map', () => {
  it('converts PSD93 / UTM 40N Easting/Northing to WGS 84 (Nimr area, about 18°N 55°E)', () => {
    const [lon, lat] = toLonLat(309007.0, 2013085.99, 'utm-psd93-40n')!;
    expect(lat).toBeCloseTo(18.2006, 3);
    expect(lon).toBeCloseTo(55.1968, 3);
  });

  it('differs from WGS 84 UTM by the PSD93 datum shift (a few hundred metres)', () => {
    const psd = toLonLat(309007.0, 2013085.99, 'utm-psd93-40n')!;
    const wgs = toLonLat(309007.0, 2013085.99, 'utm-wgs84-40n')!;
    const metres = Math.hypot((psd[0] - wgs[0]) * 111320 * Math.cos(psd[1] * Math.PI / 180), (psd[1] - wgs[1]) * 110540);
    expect(metres).toBeGreaterThan(300);
    expect(metres).toBeLessThan(450);
  });

  it('reads degrees as they are and rejects missing values', () => {
    expect(toLonLat(55.2, 18.2, 'latlng')).toEqual([55.2, 18.2]);
    expect(toLonLat(null, 18.2, 'latlng')).toBeNull();
    expect(toLonLat(0, 0, 'utm-psd93-40n')).toBeNull();
  });

  it('plots valid wells, skips missing and far-off coordinates, and colours by a column', () => {
    const map = { ...defaultWellMapConfig(), color: 'status', size: 'progress', tooltip: ['well_id'] };
    const { options, shown, skipped } = buildWellMapOptions(rows, fields, map);
    expect(shown).toBe(3);
    expect(skipped).toBe(2);
    const series = options.series as { type: string; name: string; data?: unknown[] }[];
    expect(series[0].type).toBe('tiledwebmap');
    expect(series.slice(1).map(item => [item.type, item.name, item.data!.length])).toEqual([['mapbubble', 'Active', 2], ['mapbubble', 'Pending', 1]]);
    expect(options.caption?.text).toContain('2 of 5 rows not shown');
  });

  it('draws plain points without a background when asked', () => {
    const { options } = buildWellMapOptions(rows.slice(0, 3), fields, { ...defaultWellMapConfig(), background: 'none' });
    const series = options.series as { type: string }[];
    expect(series.map(item => item.type)).toEqual(['mappoint']);
    expect(options.legend?.enabled).toBe(false);
  });

  it('keeps neighbouring regions on one map (Oman and Qatar)', () => {
    const fields = [
      { name: 'Fahud', lat: 22.35, lon: 56.48 }, { name: 'Yibal', lat: 22.2, lon: 56.03 },
      { name: 'Marmul', lat: 18.15, lon: 55.25 }, { name: 'Dukhan', lat: 25.42, lon: 50.78 },
    ];
    const { shown, skipped } = buildWellMapOptions(fields, { category: 'name', x: 'lon', y: 'lat' }, { ...defaultWellMapConfig(), coordinates: 'latlng' });
    expect([shown, skipped]).toEqual([4, 0]);
  });

  it('uses Esri satellite tiles with their attribution', () => {
    const { options } = buildWellMapOptions(rows.slice(0, 3), fields, { ...defaultWellMapConfig(), background: 'satellite' });
    const tiles = (options.series as { type: string; provider?: { type: string; theme?: string } }[])[0];
    expect(tiles).toMatchObject({ type: 'tiledwebmap', provider: { type: 'Esri', theme: 'WorldImagery' } });
    expect(String(options.credits && (options.credits as { text?: string }).text)).toContain('Esri');
  });

  it('links each position to Google Street View and Google Maps', () => {
    expect(streetViewUrl(18.2006, 55.1968)).toBe('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=18.200600,55.196800');
    expect(googleMapsUrl(18.2006, 55.1968)).toBe('https://www.google.com/maps/search/?api=1&query=18.200600,55.196800');
  });

  it('fails clearly when no row can be placed', () => {
    expect(() => buildWellMapOptions([rows[4]], fields, defaultWellMapConfig())).toThrow('No row has valid coordinates');
  });

  it('keeps only known settings when reading a saved config', () => {
    expect(readWellMapConfig({ coordinates: 'bogus', background: 'none', tooltip: ['a', 'a', 3] })).toEqual({ ...defaultWellMapConfig(), background: 'none', tooltip: ['a'] });
  });
});

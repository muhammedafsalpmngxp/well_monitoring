import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_COLUMNS,
  buildLayoutFromLegacySlots,
  matchPersistedLayoutItems,
  migrateLegacyWidgetsToLayout,
  sanitizePersistedLayout,
} from './dashboard-layout.util';

describe('migrateLegacyWidgetsToLayout', () => {
  it('keeps legacy order and chart dimensions while assigning deterministic positions', () => {
    const layout = migrateLegacyWidgetsToLayout([
      { chartId: 20, sortOrder: 2, type: 'chart', width: 640, height: 320 },
      { chartId: 10, sortOrder: 1, type: 'tile', width: null, height: null },
      { chartId: 30, sortOrder: 3, type: 'chart', width: null, height: null },
    ], 2);

    expect(layout.version).toBe(1);
    expect(layout.columns).toBe(DEFAULT_LAYOUT_COLUMNS);
    expect(layout.items.map(item => item.id)).toEqual([10, 20, 30]);
    expect(layout.items[0]).toMatchObject({ type: 'tile', x: 0, y: 0, cols: 4, rows: 5 });
    expect(layout.items[1]).toMatchObject({ type: 'chart', x: 0, y: 5, cols: 10, rows: 16, width: 640, height: 320 });
    expect(layout.items[2]).toMatchObject({ type: 'chart', x: 10, y: 5, cols: 10, rows: 16 });
  });

  it('clamps invalid chart-column counts instead of producing invalid coordinates', () => {
    const layout = migrateLegacyWidgetsToLayout([
      { chartId: 1, sortOrder: 1, type: 'chart' },
    ], 0);

    expect(layout.items[0]).toMatchObject({ x: 0, y: 5, cols: DEFAULT_LAYOUT_COLUMNS });
  });

  it('adapts URL2 tile and chart slots without changing their source arrays', () => {
    const tiles = [
      { id: '11', title: 'Wells' },
      null,
      { id: '12', title: 'Alerts', chartType: 'bar' },
    ];
    const charts = [{ id: '21', title: 'Production', chartType: 'line', width: 720, height: 360 }];

    const layout = buildLayoutFromLegacySlots(tiles, charts, 2);

    expect(layout.items.map(item => item.id)).toEqual([11, 12, 21]);
    expect(layout.items.map(item => item.type)).toEqual(['tile', 'chart', 'chart']);
    expect(layout.items[2]).toMatchObject({ width: 720, height: 360, x: 10, y: 5 });
    expect(tiles).toHaveLength(3);
    expect(charts).toHaveLength(1);
  });

  it('rejects duplicate positions by type and order while allowing cloned widget IDs', () => {
    const layout = sanitizePersistedLayout({
      version: 1,
      columns: 20,
      items: [
        { id: 1, type: 'tile', sortOrder: 1, x: 0, y: 0, cols: 4, rows: 5 },
        { id: 1, type: 'tile', sortOrder: 1, x: 4, y: 0, cols: 4, rows: 5 },
        { id: 2, type: 'chart', sortOrder: 3, x: 19, y: 5, cols: 2, rows: 16 },
        { id: 3, type: 'chart', sortOrder: 4, x: 0, y: 5, cols: 10, rows: 16 },
      ],
    });

    expect(layout?.items.map(item => item.id)).toEqual([1, 3]);
  });

  it('keeps cloned charts with the same widget ID when their sort orders differ', () => {
    const layout = sanitizePersistedLayout({
      version: 1,
      columns: 20,
      items: [
        { id: 7, type: 'chart', sortOrder: 1, x: 0, y: 5, cols: 10, rows: 16 },
        { id: 7, type: 'chart', sortOrder: 2, x: 10, y: 5, cols: 10, rows: 16 },
      ],
    });

    expect(layout?.items).toHaveLength(2);
  });
});

describe('matchPersistedLayoutItems', () => {
  const saved = {
    version: 1 as const,
    columns: 20,
    items: [
      { id: 101, type: 'chart' as const, sortOrder: 1, x: 0, y: 0, cols: 13, rows: 18 },
      { id: 102, type: 'chart' as const, sortOrder: 2, x: 13, y: 0, cols: 7, rows: 18 },
      { id: 103, type: 'chart' as const, sortOrder: 3, x: 13, y: 18, cols: 7, rows: 9 },
    ],
  };

  it('restores every widget to its own saved spot', () => {
    const matches = matchPersistedLayoutItems(saved, [
      { id: 101, type: 'chart', sortOrder: 1 },
      { id: 102, type: 'chart', sortOrder: 2 },
      { id: 103, type: 'chart', sortOrder: 3 },
    ]);

    expect(matches.map(item => item?.x)).toEqual([0, 13, 13]);
    expect(matches.map(item => item?.rows)).toEqual([18, 18, 9]);
  });

  it('does not shift later widgets onto a neighbour when an earlier saved widget no longer loads', () => {
    // Widget 101 was deleted from the library, so the remaining two are renumbered 1 and 2.
    const matches = matchPersistedLayoutItems(saved, [
      { id: 102, type: 'chart', sortOrder: 1 },
      { id: 103, type: 'chart', sortOrder: 2 },
    ]);

    expect(matches[0]).toMatchObject({ id: 102, x: 13, y: 0, rows: 18 });
    expect(matches[1]).toMatchObject({ id: 103, x: 13, y: 18, rows: 9 });
  });

  it('keeps clones of the same chart on their own saved spots', () => {
    const clones = {
      version: 1 as const,
      columns: 20,
      items: [
        { id: 7, type: 'chart' as const, sortOrder: 1, x: 0, y: 0, cols: 10, rows: 16 },
        { id: 7, type: 'chart' as const, sortOrder: 2, x: 10, y: 0, cols: 10, rows: 12 },
      ],
    };

    const matches = matchPersistedLayoutItems(clones, [
      { id: 7, type: 'chart', sortOrder: 1 },
      { id: 7, type: 'chart', sortOrder: 2 },
    ]);

    expect(matches.map(item => item?.x)).toEqual([0, 10]);
    expect(matches.map(item => item?.rows)).toEqual([16, 12]);
  });

  it('leaves a widget with no saved entry unmatched so it gets a fresh default spot', () => {
    const matches = matchPersistedLayoutItems(saved, [{ id: 999, type: 'chart', sortOrder: 4 }]);

    expect(matches).toEqual([undefined]);
  });
});

describe('v1 dashboard reader beside the canvas', () => {
  it('keeps a stored v1 layout exactly as it was', () => {
    const layout = {
      version: 1 as const,
      columns: 20,
      items: [
        { id: 12, type: 'tile' as const, sortOrder: 1, x: 0, y: 0, cols: 4, rows: 5 },
        { id: 30, type: 'chart' as const, sortOrder: 2, x: 0, y: 5, cols: 10, rows: 16, width: 640, height: 320 },
      ],
    };

    expect(sanitizePersistedLayout(structuredClone(layout))).toEqual(layout);
  });

  it('ignores a canvas layout, so a canvas never renders as a dashboard', () => {
    const canvas = JSON.parse('{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[{"name":"Sheet 1","items":[]}]}}');

    expect(sanitizePersistedLayout(canvas.layout)).toBeNull();
  });
});
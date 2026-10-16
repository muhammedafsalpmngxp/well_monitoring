import {
  DashboardConfigWidget,
  DashboardLayoutConfig,
  DashboardLayoutItem,
  DashboardLayoutItemType,
} from '../models/dashboard.model';

export const DEFAULT_LAYOUT_COLUMNS = 20;
export const DEFAULT_TILE_COLUMNS = 4;
export const DEFAULT_TILE_ROWS = 5;
export const DEFAULT_CHART_ROWS = 16;
export const DEFAULT_CHART_COLUMNS = 2;
export const MAX_LAYOUT_ROWS = 200;

/**
 * Converts URL2's fixed-slot widget list into deterministic grid coordinates.
 * This is intentionally pure and does not alter the legacy payload.
 */
interface PlacedRect { x: number; y: number; cols: number; rows: number }

function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return a.x < b.x + b.cols && a.x + a.cols > b.x && a.y < b.y + b.rows && a.y + a.rows > b.y;
}

/** Scans row-by-row (in increments of `rows`, from `startY`), trying every column slot within
 *  that row, and returns the first `cols`x`rows` spot that doesn't overlap anything already in
 *  `occupied`. Used to place a never-before-positioned tile/chart without landing on top of a
 *  widget of the OTHER kind that already persists an arbitrary (possibly overlapping) position —
 *  neither kind's own position math looked at the other's placements before this. */
function findFreeSlot(occupied: readonly PlacedRect[], cols: number, rows: number, startY: number): PlacedRect {
  const safetyRows = occupied.reduce((bottom, rect) => Math.max(bottom, rect.y + rect.rows), startY) + rows;
  for (let y = startY; y < safetyRows; y += rows) {
    for (let x = 0; x + cols <= DEFAULT_LAYOUT_COLUMNS; x += cols) {
      const candidate: PlacedRect = { x, y, cols, rows };
      if (!occupied.some(o => rectsOverlap(candidate, o))) return candidate;
    }
  }
  return { x: 0, y: safetyRows, cols, rows };
}

export function migrateLegacyWidgetsToLayout(
  widgets: readonly DashboardConfigWidget[],
  chartColumns = DEFAULT_CHART_COLUMNS,
): DashboardLayoutConfig {
  const normalizedChartColumns = clampInteger(chartColumns, 1, DEFAULT_LAYOUT_COLUMNS);
  // The default (unresized) width for a brand-new chart under the current 2x2/3x3/4x4 layout
  // setting — only ever used for a chart that has no stored position yet.
  const baseChartWidth = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / normalizedChartColumns));
  const sortedWidgets = [...widgets].sort((left, right) => left.sortOrder - right.sortOrder);
  const tilesPerRow = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / DEFAULT_TILE_COLUMNS));
  const totalTiles = widgets.filter(widget => widget.type === 'tile').length;
  const tileRowCount = totalTiles ? Math.ceil(totalTiles / tilesPerRow) : 0;
  const chartStartY = tileRowCount * DEFAULT_TILE_ROWS;

  // Both a tile's and a chart's position are persistent user state, not something recomputed on
  // every sync: once a widget has a stored x/y (set the first time the user drags/resizes it —
  // see onProductionGridItemChange), that exact spot (and, for charts, size) is reused verbatim,
  // however many other tiles/charts get added or removed elsewhere. A widget that's never been
  // touched instead gets a default spot — but that default is chosen by scanning for a slot that
  // doesn't overlap anything ALREADY placed, of either kind. Previously tiles always recomputed
  // a purely index-based position with no awareness of charts at all (and vice versa for a new
  // chart with respect to tiles), so removing/adding a widget elsewhere could silently re-land a
  // tile exactly where an already-placed chart sat, or vice versa — this is what actually caused
  // one widget to render underneath the other.
  const occupied: PlacedRect[] = [];
  const layoutByWidget = new Map<DashboardConfigWidget, PlacedRect>();

  // Placed (already-positioned) widgets first, in sortOrder, so a later "new" widget's scan sees
  // every existing placement regardless of kind.
  for (const widget of sortedWidgets) {
    if (widget.x == null || widget.y == null) continue;
    const cols = widget.type === 'tile' ? (widget.width ?? DEFAULT_TILE_COLUMNS) : (widget.width ?? baseChartWidth);
    const rows = widget.type === 'tile' ? (widget.height ?? DEFAULT_TILE_ROWS) : (widget.height ?? DEFAULT_CHART_ROWS);
    const rect: PlacedRect = { x: widget.x, y: widget.y, cols, rows };
    layoutByWidget.set(widget, rect);
    occupied.push(rect);
  }

  // Then every not-yet-placed widget gets a freshly scanned default slot, added to `occupied` as
  // it's assigned so later new widgets (of either kind) don't collide with it either.
  for (const widget of sortedWidgets) {
    if (layoutByWidget.has(widget)) continue;
    const isTile = widget.type === 'tile';
    const cols = gridDimension(widget.width, isTile ? DEFAULT_TILE_COLUMNS : baseChartWidth, DEFAULT_LAYOUT_COLUMNS);
    const rows = gridDimension(widget.height, isTile ? DEFAULT_TILE_ROWS : DEFAULT_CHART_ROWS, MAX_LAYOUT_ROWS);
    const startY = isTile ? 0 : chartStartY;
    const rect = findFreeSlot(occupied, cols, rows, startY);
    layoutByWidget.set(widget, rect);
    occupied.push(rect);
  }

  const items: DashboardLayoutItem[] = sortedWidgets.map(widget => {
    const { x, y, cols, rows } = layoutByWidget.get(widget)!;
    return {
      id: widget.chartId,
      type: widget.type,
      sortOrder: widget.sortOrder,
      x, y, cols, rows,
      width: widget.width ?? null,
      height: widget.height ?? null,
    };
  });

  return {
    version: 1,
    columns: DEFAULT_LAYOUT_COLUMNS,
    items,
  };
}

/** Builds the shadow layout from URL2's existing tile and chart slot arrays. */
export function buildLayoutFromLegacySlots(
  tileSlots: readonly ({ id: string; chartType?: string; width?: number; height?: number; x?: number; y?: number } | null)[],
  chartSlots: readonly ({ id: string; chartType?: string; width?: number; height?: number; x?: number; y?: number })[],
  chartColumns = DEFAULT_CHART_COLUMNS,
): DashboardLayoutConfig {
  const widgets: DashboardConfigWidget[] = [
    ...tileSlots.filter((slot): slot is NonNullable<typeof slot> => slot !== null).map((slot, index) => ({
      chartId: Number(slot.id) || 0,
      sortOrder: index + 1,
      type: slot.chartType ? ('chart' as const) : ('tile' as const),
      width: slot.width ?? null,
      height: slot.height ?? null,
      x: slot.x ?? null,
      y: slot.y ?? null,
    })),
    ...chartSlots.map((slot, index) => ({
      chartId: Number(slot.id) || 0,
      sortOrder: tileSlots.filter(Boolean).length + index + 1,
      type: slot.chartType ? ('chart' as const) : ('tile' as const),
      width: slot.width ?? null,
      height: slot.height ?? null,
      x: slot.x ?? null,
      y: slot.y ?? null,
    })),
  ];

  return migrateLegacyWidgetsToLayout(widgets, chartColumns);
}

export function getLayoutRowLimit(items: readonly Pick<DashboardLayoutItem, 'rows'>[]): number {
  return Math.max(MAX_LAYOUT_ROWS, items.reduce((total, item) => total + (
    Number.isInteger(item.rows) && item.rows > 0 && item.rows <= MAX_LAYOUT_ROWS ? item.rows : 0
  ), 0));
}

/** Keeps only safe, unique persisted positions before they reach Gridster. */
export function sanitizePersistedLayout(layout: DashboardLayoutConfig | undefined): DashboardLayoutConfig | null {
  if (layout?.version !== 1 || !Array.isArray(layout?.items)) return null;
  const columns = clampInteger(layout.columns, 1, DEFAULT_LAYOUT_COLUMNS);
  const maxRows = getLayoutRowLimit(layout.items);
  const seen = new Set<string>();
  const items = layout.items.filter(item => {
    const key = `${item.type}:${item.sortOrder}`;
    const valid = Number.isInteger(item.id) && item.id > 0
      && (item.type === 'tile' || item.type === 'chart')
      && [item.x, item.y, item.cols, item.rows].every(value => Number.isInteger(value) && value >= 0)
      && item.cols > 0 && item.rows > 0 && item.rows <= MAX_LAYOUT_ROWS
      && item.x + item.cols <= columns
      && item.y + item.rows <= maxRows;
    if (!valid || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { version: 1, columns, items };
}

/** A widget currently on a builder canvas, identified by its stable widget id (never its array index). */
export interface LayoutWidgetRef {
  id: number;
  type: DashboardLayoutItemType;
  sortOrder: number;
}

/**
 * Pairs each on-canvas widget with its saved layout entry by STABLE widget id, so a restored
 * position/size always lands on the widget it was saved for — even when a saved widget no longer
 * loads (deleted from the library), or a chart was dragged into the tile row (so its type no
 * longer matches its zone). Matching by array index or zone-relative position silently shifted
 * every later widget onto its neighbour's saved spot in those cases.
 *
 * Pass 1 takes the exact (id, sortOrder) entry; pass 2 gives any widget still unmatched the
 * lowest-sortOrder unused entry with the same id (clones of one chart share an id, and sortOrders
 * shift when an earlier widget is dropped). Returns one entry per widget, in the same order.
 */
export function matchPersistedLayoutItems(
  layout: DashboardLayoutConfig | null,
  widgets: readonly LayoutWidgetRef[],
): (DashboardLayoutItem | undefined)[] {
  const result: (DashboardLayoutItem | undefined)[] = widgets.map(() => undefined);
  if (!layout) return result;
  const used = new Set<DashboardLayoutItem>();
  widgets.forEach((widget, index) => {
    const exact = layout.items.find(item => !used.has(item) && item.id === widget.id && item.sortOrder === widget.sortOrder);
    if (exact) { used.add(exact); result[index] = exact; }
  });
  const remaining = [...layout.items].sort((left, right) => left.sortOrder - right.sortOrder);
  widgets.forEach((widget, index) => {
    if (result[index]) return;
    const byId = remaining.find(item => !used.has(item) && item.id === widget.id);
    if (byId) { used.add(byId); result[index] = byId; }
  });
  return result;
}

function gridDimension(value: number | null | undefined, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
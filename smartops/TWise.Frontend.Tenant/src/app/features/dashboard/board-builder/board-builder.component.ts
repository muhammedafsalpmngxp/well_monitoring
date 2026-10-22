import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { isPlantFilter } from '../../../core/utils/plant-filter.util';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { applyChartSort } from '../../../core/utils/chart-sort.util';
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { Observable, of, Subject, Subscription, from, timer } from 'rxjs';
import { catchError, map, mergeMap, shareReplay, switchMap, takeUntil, tap } from 'rxjs/operators';
import type Highcharts from 'highcharts';
import { AdvancedChartPayload, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { Gridster, GridsterConfig, GridsterItemConfig, GridType, DisplayGrid, CompactType } from 'angular-gridster2';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { DashboardBranding, normalizeDashboardBranding, DashboardLayoutConfig, DashboardLayoutItem, SaveDashboardRequest, WidgetLibraryItem } from '../../../core/models/dashboard.model';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardSavedFilterService } from '../../../core/services/dashboard-saved-filter.service';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { AuthService } from '../../../core/services/auth.service';
import { ChartView, ChartViewIcon, chartSwitchOptions, chartViewIcon, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { appendDaxToChartData, getActiveDaxMeasures, appendDaxToTableRows, getDaxRowColumnMeasures, DaxModelConfig, evaluateTileDaxValue, formatDaxValue, getSelectedDaxMeasure } from '../../../core/utils/dax-evaluator.util';
import { applyConditionalFilters, getSavedConditionalFilters, SavedConditionalFilter } from '../../../core/utils/conditional-filter.util';
import { applyParameterFilters, getSavedParameterFilters, remapDesignColumns } from '../../../core/utils/parameter-filter.util';
import { appendLockedFilterTitle } from '../../../core/utils/locked-filter-title.util';
import { CustomDashboardFilter, mergeDashboardSharedFilters } from '../../../core/utils/dashboard-shared-filter.util';
import { buildLayoutFromLegacySlots, getLayoutRowLimit, matchPersistedLayoutItems, sanitizePersistedLayout, DEFAULT_TILE_COLUMNS, DEFAULT_TILE_ROWS, DEFAULT_LAYOUT_COLUMNS } from '../../../core/utils/dashboard-layout.util';
import { CHART_AUTO_COLORS, chartFallbackColor, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';

const CHART_COLORS = [...CHART_AUTO_COLORS];
const ROW_BG_COLORS  = ['#F3F6FF', '#EBFFF2', '#FFFAF1', '#FFF1F1', '#E8F8FF'];
const ROW_DOT_COLORS = ['#1E3A8A', '#49D67D', '#F5A623', '#DC2626', '#38BDF8'];
type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES = new Set(['line', 'multiline', 'grouped', 'stacked', 'area']);

export interface SavedFilterPreset {
  id: number;
  name: string;
  accent: 'purple' | 'green' | 'orange' | 'yellow';
  country: string;
  sector: string;
  businessUnit: string;
  division: string;
  cluster: string;
  plant: string;
  quickRange: string;
  fromDate: string;
  toDate: string;
  lastUsed: string;
  isFavorite: boolean;
}

export interface TileSelectorItem {
  id: string;
  title: string;
  value: string;
  accent: 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'amber' | 'teal' | 'gray';
  icon: 'well' | 'check' | 'alert' | 'chart' | 'crew' | 'gauge' | 'calendar' | 'derrick' | 'trend';
  active: number;
  inactive: number;
  activeLabel: string;
  inactiveLabel: string;
  /** Optional status label (e.g. "CRITICAL") configured on the tile in Tile Builder. */
  badgeText?: string;
  /** One of tile-builder's badgeColorOptions: none/blue/green/orange/red. */
  badgeColor?: string;
  designJson?: string;
  categoryName?: string;
  /** User-placed position/size (drag or resize) — persisted so the layout builder reuses it
   *  verbatim instead of recomputing it from array index whenever another tile/chart is added or
   *  removed. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface ChartLocalFilter {
  label: string;
  sourceTable: string;
  sourceColumn: string;
  controlType: string;
  hidden: boolean;
  locked: boolean;
  value: string;
  values: string[];
  options: string[];
  conditional?: boolean;
  operator?: string;
  valueText?: string;
  mode?: string;
}

export interface ChartSelectorItem {
  id: string;
  widgetId?: number;
  presetColumn?: string;
  presetValue?: string;
  title: string;
  description: string;
  chartType: string;
  source: string;
  sourceType: string;
  designJson?: string;
  categoryName?: string;
  width?: number;
  height?: number;
  /** User-placed position (drag or resize) — persisted so the layout builder reuses it verbatim
   *  instead of recomputing it whenever another tile/chart is added or removed. */
  x?: number;
  y?: number;
}

export interface BoardBuilderTab {
  id: string;
  label: string;
}

interface ProductionGridItem extends GridsterItemConfig {
  id: string;
  zone: 'tile' | 'chart';
  index: number;
}

interface BoardSnapshot {
  tileSlots: (TileSelectorItem | ChartSelectorItem | null)[];
  chartSlotsData: (ChartSelectorItem | TileSelectorItem)[];
}

@Component({
  selector: 'app-board-builder',
  standalone: false,
  templateUrl: './board-builder.component.html',
  styleUrls: ['./board-builder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardBuilderComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(Gridster) private productionGridster?: Gridster;
  // ── Filters bar ───────────────────────────────────────────
  filterBarVisible = true;
  country = 'All';
  sector = 'All';
  businessUnit = 'All';
  division = 'All';
  cluster = 'All';
  plant = 'All';
  // Same default as the dashboard view page: from Jan 1 of this year to the last Tuesday.
  fromDate = `${new Date().getFullYear()}-01-01`;
  toDate = this.lastTuesday(new Date());
  quickRange = '';
  openFilterName: string | null = null;
  customFilters: CustomDashboardFilter[] = [];
  private pendingCustomFilterValues: Record<string, string> = {};

  countryOptions:  string[] = [];
  sectorOptions:   string[] = [];
  buOptions:       string[] = [];
  divisionOptions: string[] = [];
  clusterOptions:  string[] = [];
  plantOptions:    string[] = [];
  quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After', 'Custom'];
  private allPlants: PlantFilterDto[] = [];

  // ── Date range popup (From/To dual-calendar picker) ─────
  showDateRangePopup = false;
  dateRangeAnchorTop = 0;
  dateRangeAnchorLeft = 0;
  dateRangeMaxHeight = 0;

  openDateRangePopup(event: Event): void {
    event.stopPropagation();

    // Anchor to the clicked From/To field and keep the popup inside the viewport on any screen size.
    const placement = dateRangePopupPlacement(event);
    this.dateRangeAnchorLeft = placement.left;
    this.dateRangeAnchorTop = placement.top;
    this.dateRangeMaxHeight = placement.maxHeight;
    this.showDateRangePopup = true;
  }

  onDateRangeApply(range: { from: string; to: string }): void {
    this.fromDate = range.from;
    this.toDate = range.to;
    this.showDateRangePopup = false;
    this.reloadPlacedPreviews();
    this.persistFilterState();
  }

  onDateRangeCancel(): void {
    this.showDateRangePopup = false;
  }

  /** mm-dd-yyyy display for the From/To trigger fields (matches app-date-input formatting). */
  formatFilterDate(iso: string): string {
    const parts = (iso || '').split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    if (!y || !m || !d) return '';
    return `${m}-${d}-${y}`;
  }

  // ── Saved Filter presets ─────────────────────────────────
  showSavedFilterList = false;
  showSaveFilterModal = false;
  savedFilterSearch = '';
  newFilterName = '';
  /** Set while the Save Filter modal is reused for renaming an existing preset (null = normal save). */
  renamingPresetId: number | null = null;
  savedFilterPresets: SavedFilterPreset[] = [];
  private readonly presetAccents: SavedFilterPreset['accent'][] = ['purple', 'green', 'orange', 'yellow'];
  // Only one saved-filter row (or none, when Default view applies) is ever highlighted as active.
  activePresetId: number | null = null;

  get filteredSavedFilterPresets(): SavedFilterPreset[] {
    const term = this.savedFilterSearch.trim().toLowerCase();
    const list = term ? this.savedFilterPresets.filter(p => p.name.toLowerCase().includes(term)) : this.savedFilterPresets;
    // Favorited presets always float to the top, regardless of search/sort.
    return [...list].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));
  }

  get currentFilterChips(): { label: string; value: string }[] {
    return [
      { label: 'Country', value: this.country },
      { label: 'Sector', value: this.sector },
      { label: 'Business Unit', value: this.businessUnit },
      { label: 'Division', value: this.division },
      { label: 'Cluster', value: this.cluster },
      { label: 'Plant', value: this.plant },
      { label: 'Quick Range', value: this.quickRange },
      { label: 'From Date', value: this.fromDate },
      { label: 'To Date', value: this.toDate },
    ];
  }

  presetMeta(preset: SavedFilterPreset): string {
    return [preset.country, preset.sector, preset.businessUnit, preset.division, preset.cluster]
      .filter(v => v && v !== 'All').join(' • ');
  }

  /** Whether this preset is the one currently applied — only ever true for a single row. */
  isActivePreset(preset: SavedFilterPreset): boolean {
    return preset.id === this.activePresetId;
  }

  openPresetMenuId: number | null = null;

  togglePresetMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.openPresetMenuId = this.openPresetMenuId === id ? null : id;
    this.cdr.markForCheck();
  }

  renamePreset(preset: SavedFilterPreset, event: Event): void {
    event.stopPropagation();
    this.openPresetMenuId = null;
    this.newFilterName = preset.name;
    this.renamingPresetId = preset.id;
    this.showSaveFilterModal = true;
    this.showSavedFilterList = false;
    this.cdr.markForCheck();
  }

  showDeletePresetConfirm = false;
  presetPendingDelete: SavedFilterPreset | null = null;

  deletePreset(id: number, event: Event): void {
    event.stopPropagation();
    this.openPresetMenuId = null;
    this.presetPendingDelete = this.savedFilterPresets.find(p => p.id === id) ?? null;
    this.showDeletePresetConfirm = true;
    this.cdr.markForCheck();
  }

  cancelDeletePreset(): void {
    this.showDeletePresetConfirm = false;
    this.presetPendingDelete = null;
  }

  confirmDeletePreset(): void {
    const preset = this.presetPendingDelete;
    if (!preset || !this.dashboardId) { this.cancelDeletePreset(); return; }

    this.savedFilterService.delete(this.dashboardId, preset.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savedFilterPresets = this.savedFilterPresets.filter(p => p.id !== preset.id);
        if (this.activePresetId === preset.id) this.activePresetId = null;
        this.persistFilterState();
        this.showDeletePresetConfirm = false;
        this.presetPendingDelete = null;
        this.saveSuccess = `'${preset.name}' deleted successfully.`;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showDeletePresetConfirm = false;
        this.presetPendingDelete = null;
        this.saveError = err?.error?.message || err?.message || 'Failed to delete filter.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Toggles a preset's favorite state; favorited presets sort to the top of the list. */
  toggleFavorite(preset: SavedFilterPreset, event: Event): void {
    event.stopPropagation();
    if (!this.dashboardId) return;
    const next = !preset.isFavorite;
    this.savedFilterService.setFavorite(this.dashboardId, preset.id, next).pipe(takeUntil(this.destroy$)).subscribe(() => {
      preset.isFavorite = next;
      this.cdr.markForCheck();
    });
  }

  // Add Tiles/Add Charts modal dropdowns show an 'All' entry so users can clear a level back to unfiltered.
  get countryOptionsWithAll():  string[] { return ['All', ...this.countryOptions]; }
  get sectorOptionsWithAll():   string[] { return ['All', ...this.sectorOptions]; }
  get buOptionsWithAll():       string[] { return ['All', ...this.buOptions]; }
  get divisionOptionsWithAll(): string[] { return ['All', ...this.divisionOptions]; }
  get clusterOptionsWithAll():  string[] { return ['All', ...this.clusterOptions]; }
  get plantOptionsWithAll():    string[] { return ['All', ...this.plantOptions]; }

  // ── Toolbar ───────────────────────────────────────────────
  pageName = 'Overview';
  nameValidationError = '';
  dashboardValidationMessage = '';
  dashboardDescription = '';
  descriptionValidationError = '';
  editingPageName = false;
  category = '';
  showCategoryDropdown = false;
  locked = false;
  zoomLevel = 100;
  panelCollapsed = false;

  /** Initial page load — categories + widget/chart library. */
  pageLoading = true;

  categories: string[] = [];
  apiCategories: CategoryDropdown[] = [];
  private categorySub!: Subscription;
  private readonly destroy$ = new Subject<void>();
  private _prevSidebarState: boolean | undefined;

  // ── Canvas layout ─────────────────────────────────────────
  layout: '2x2' | '3x3' | '4x4' = '2x2';
  layoutExplicitlySet = false;

  // Slots can hold the "wrong" item type once a tile/chart has been dragged
  // across rows (see the KPI tile <-> chart-card cross-row swap below) — the
  // template branches on isChartItem()/isTileItem() to render whichever
  // shape actually landed in a given slot.
  tileSlots: (TileSelectorItem | ChartSelectorItem | null)[] = [];
  chartSlotsData: (ChartSelectorItem | TileSelectorItem)[] = [];
  /** Shadow layout for Phase 2; URL2 rendering and persistence still use the legacy slots. */
  unifiedLayout: DashboardLayoutConfig = { version: 1, columns: 20, items: [] };
  productionGridItems: ProductionGridItem[] = [];
  readonly emptyCanvasItem: ProductionGridItem = { id: 'empty-canvas', zone: 'chart', index: -1, x: 0, y: 0, cols: 20, rows: 21, dragEnabled: false, resizeEnabled: false };
  productionGridsterOptions: GridsterConfig = {};
  /** Height of all grid rows (rows x (row height + margin) + outer margin). Gridster is
   *  `height: 100%` with absolutely-positioned items, so without this it collapses to 0 once
   *  the page scrolls as a whole (tablet/phone) instead of inside the canvas. */
  get productionGridMinHeight(): number {
    const { minRows = 0, fixedRowHeight = 24, margin = 8 } = this.productionGridsterOptions;
    return minRows * (fixedRowHeight + margin) + margin;
  }
  isChartItem(item: TileSelectorItem | ChartSelectorItem | null): item is ChartSelectorItem {
    return !!item && 'chartType' in item;
  }

  isTileItem(item: TileSelectorItem | ChartSelectorItem | null): item is TileSelectorItem {
    return !!item && 'accent' in item;
  }

  // Without trackBy, OnPush + swapping array entries in place (see the drag
  // handlers below) can leave Angular's default NgForOf differ reconciling
  // stale and new nodes in the same pass, which renders as duplicated/
  // overlapping cards for a tick. Tracking by the item's own id (falling
  // back to position for an empty tile slot, which has no identity anyway)
  // lets Angular correctly recognize a "move" instead of remove+add.
  trackByTileSlot(index: number, slot: TileSelectorItem | ChartSelectorItem | null): string {
    return slot ? slot.id : `empty-${index}`;
  }

  trackByChartSlot(_index: number, slot: ChartSelectorItem | TileSelectorItem): string {
    return slot.id;
  }

  // emptyChartSlots is a plain null[] whose length shrinks as real charts get added, which shifts
  // the absolute grid index (chartSlotsData.length + i) of the remaining placeholders. Tracking by
  // that absolute index (not the loop-relative one) forces Gridster to get a fresh item instance
  // instead of reusing a stale one stuck at its old position, which caused overlapping cards.
  // Declared as an arrow property (not a regular method) since Angular invokes trackBy as an
  // unbound function reference, which would otherwise lose `this` and throw on `this.chartSlotsData`.
  trackByEmptyChartSlot = (i: number): number => this.chartSlotsData.length + i;

  get chartSlotCount(): number {
    if (this.layout === '4x4') return 4;
    return this.layout === '3x3' ? 3 : 2;
  }
  /** Render one centred empty state only when the board has no content. */
  get emptyChartSlots(): null[] { return !this.tileSlots.length && !this.chartSlotsData.length ? [null] : []; }
  get effectiveColumns(): number {
    if (this.layout === '4x4') return 4;
    return this.layout === '3x3' ? 3 : 2;
  }

  setLayout(layout: '2x2' | '3x3' | '4x4'): void {
    this.layout = layout;
    this.layoutExplicitlySet = true;
    this.syncUnifiedLayout();
  }

  private syncUnifiedLayout(): void {
    // Each chart's x/y/width/height is persistent user state (see onProductionGridItemChange),
    // carried on the slot itself and reused verbatim by migrateLegacyWidgetsToLayout — adding or
    // removing a tile/chart elsewhere must never recompute or reflow an already-placed chart.
    // Only a chart with no stored position yet (brand new) gets a default spot assigned.
    this.unifiedLayout = buildLayoutFromLegacySlots(
      this.tileSlots.map(slot => slot && this.isChartItem(slot) ? { ...slot, id: String(slot.widgetId ?? slot.id) } : slot),
      this.chartSlotsData.map(slot => this.isChartItem(slot) ? { ...slot, id: String(slot.widgetId ?? slot.id) } : slot),
      this.effectiveColumns,
    );
    this.syncProductionGridItems();
  }

  private syncProductionGridItems(): void {
    const items: ProductionGridItem[] = [];
    const tileCount = Math.max(5, this.tileSlots.length);
    // Tiles fill a 20-col-wide row, 4 cols each — 5 per row — before wrapping
    // to the next row, so a 6th/7th tile stays in the tile section instead of
    // overlapping the first row (and getting pushed down past the charts).
    const tilesPerRow = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / DEFAULT_TILE_COLUMNS));
    // Based on the actual tile count, not the padded tileCount floor — otherwise a board
    // with zero tiles still reserves a full tile row of blank space above the charts.
    const tileRowCount = this.tileSlots.length ? Math.ceil(this.tileSlots.length / tilesPerRow) : 0;
    // Looked up by sortOrder alone (unique across both kinds): a slot's layout entry carries the
    // type of what's IN it, so a chart dragged into the tile row (or a tile into the chart row)
    // would never match a type filter and would snap back to a default spot. A tile's sortOrder
    // counts only populated slots, so an empty slot must not shift later tiles' positions.
    let tileOrdinal = 0;
    for (let index = 0; index < tileCount; index += 1) {
      const sortOrder = this.tileSlots[index] ? ++tileOrdinal : -1;
      const layout = this.unifiedLayout.items.find(item => item.sortOrder === sortOrder);
      items.push({
        id: `tile-${index}`,
        zone: 'tile',
        index,
        x: layout?.x ?? (index % tilesPerRow) * DEFAULT_TILE_COLUMNS,
        y: layout?.y ?? Math.floor(index / tilesPerRow) * DEFAULT_TILE_ROWS,
        cols: layout?.cols ?? DEFAULT_TILE_COLUMNS,
        rows: layout?.rows ?? DEFAULT_TILE_ROWS,
        dragEnabled: true,
        resizeEnabled: true,
      });
    }
    // Charts always start right after however many tile rows are actually in use.
    const chartStartY = tileRowCount * DEFAULT_TILE_ROWS;
    const chartCount = Math.max(this.chartSlotCount, this.chartSlotsData.length);
    const chartWidth = Math.max(1, Math.floor(20 / this.chartSlotCount));
    for (let index = 0; index < chartCount; index += 1) {
      const layout = this.unifiedLayout.items.find(item => item.sortOrder === tileOrdinal + index + 1);
      items.push({
        id: `chart-${index}`,
        zone: 'chart',
        index,
        x: layout?.x ?? (index % this.chartSlotCount) * chartWidth,
        y: layout?.y ?? chartStartY + Math.floor(index / this.chartSlotCount) * 16,
        cols: layout?.cols ?? chartWidth,
        rows: layout?.rows ?? 16,
        dragEnabled: true,
        resizeEnabled: true,
      });
    }
    this.productionGridItems = items;
    // Reassign (new object reference, so the OnPush [options] input actually picks it up) with
    // the row count the current content needs, instead of a fixed floor — otherwise deleting a
    // tile/chart leaves the canvas reserving its old height as blank space below.
    this.productionGridsterOptions = { ...this.productionGridsterOptions, minRows: this.computeMinRows(), maxRows: getLayoutRowLimit(this.unifiedLayout.items) };
    this.refreshProductionGridster();
  }

  private computeMinRows(): number {
    // Charts can be freely dragged/resized to arbitrary positions now (not packed N-per-row), so
    // the canvas height has to come from the actual lowest edge among placed items, not a
    // row-count estimate — otherwise a chart dragged out past its "expected" row would get
    // clipped or the canvas would reserve the wrong amount of space.
    const tilesPerRow = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / DEFAULT_TILE_COLUMNS));
    const tileRowCount = this.tileSlots.length ? Math.ceil(this.tileSlots.length / tilesPerRow) : 0;
    // Only real (rendered) slots — productionGridItems also carries unrendered placeholder
    // entries out past the actual tile/chart count, which would otherwise skew this estimate.
    const contentBottom = this.productionGridItems.reduce((max, item) => {
      const isReal = item.zone === 'tile' ? item.index < this.tileSlots.length : item.index < this.chartSlotsData.length;
      return isReal ? Math.max(max, item.y + item.rows) : max;
    }, 0);
    return Math.max(DEFAULT_TILE_ROWS, tileRowCount * DEFAULT_TILE_ROWS, contentBottom);
  }

  trackByProductionGridItem(_index: number, item: ProductionGridItem): string { return item.id; }

  productionGridItem(zone: 'tile' | 'chart', index: number): ProductionGridItem {
    return this.productionGridItems.find(item => item.zone === zone && item.index === index)!;
  }
  /**
   * The inline data table only fits when the card is tall enough for header, chart, legend and
   * table together; below that it would squeeze the chart out, so it is dropped.
   * 14 rows × 24px ≈ 340px of content.
   */
  hasRoomForDataTable(chartIndex: number): boolean {
    return (this.productionGridItem('chart', chartIndex)?.rows ?? 16) >= 14;
  }


  private buildProductionGridsterOptions(): GridsterConfig {
    return {
      gridType: GridType.VerticalFixed,
      fixedRowHeight: 24,
      displayGrid: DisplayGrid.OnDragAndResize,
      compactType: CompactType.None,
      minCols: 20,
      maxCols: 20,
      minRows: this.computeMinRows(),
      maxRows: getLayoutRowLimit(this.unifiedLayout?.items ?? []),
      outerMargin: true,
      margin: 8,
      disableScrollVertical: true,
      pushItems: true,
      swap: true,
      draggable: { enabled: true, ignoreContentClass: 'board-no-drag', ignoreContent: false },
      resizable: { enabled: true },
      itemChangeCallback: this.onProductionGridItemChange,
      itemResizeCallback: this.onProductionGridItemChange,
    };
  }

  /** True for one click right after a Gridster drag/resize, so the resulting native click
   *  doesn't reopen the tile/chart selector on an empty slot that was just repositioned. */
  suppressEmptySlotClick = false;

  private onProductionGridItemChange = (item: GridsterItemConfig): void => {
    this.suppressEmptySlotClick = true;
    setTimeout(() => { this.suppressEmptySlotClick = false; }, 0);
    const productionItem = this.productionGridItems.find(candidate => candidate.id === item['id']);
    if (!productionItem) return;
    if (!this.restoringUndo && !this.pendingGridUndo) {
      this.pendingGridUndo = this.captureBoardSnapshot();
      setTimeout(() => {
        const before = this.pendingGridUndo;
        this.pendingGridUndo = null;
        if (before) this.recordUndo(before);
      }, 0);
    }
    productionItem.x = item.x;
    productionItem.y = item.y;
    productionItem.cols = item.cols;
    productionItem.rows = item.rows;
    const layoutItem = this.unifiedLayout.items.find(candidate => this.gridItemForSortOrder(candidate.sortOrder) === productionItem);
    if (layoutItem) {
      layoutItem.x = item.x ?? layoutItem.x;
      layoutItem.y = item.y ?? layoutItem.y;
      layoutItem.cols = item.cols ?? layoutItem.cols;
      layoutItem.rows = item.rows ?? layoutItem.rows;
    }
    // Persisted on the widget itself (not just unifiedLayout, which gets rebuilt from scratch on
    // every syncUnifiedLayout call) so a manual drag or resize survives adding/removing an
    // unrelated tile or chart elsewhere instead of snapping back to a recomputed spot/size — and,
    // for a tile, so its position is no longer purely a function of array index (which could
    // silently re-land a tile on top of an already-placed chart whenever some other tile was
    // added/removed and shifted every later tile's index).
    if (productionItem.zone === 'chart') {
      const slot = this.chartSlotsData[productionItem.index];
      if (slot && this.isChartItem(slot)) {
        slot.width = item.cols;
        slot.height = item.rows;
        slot.x = item.x;
        slot.y = item.y;
      }
    } else {
      const slot = this.tileSlots[productionItem.index];
      if (slot) {
        slot.x = item.x;
        slot.y = item.y;
        slot.width = item.cols;
        slot.height = item.rows;
      }
    }
    this.cdr.markForCheck();
    // Highcharts only reflows on window resize, so nudge it to keep the
    // chart in sync with the card's new Gridster cell size.
    this.scheduleChartReflow();
  };

  /** Reflow every Highcharts instance after Gridster has committed the new
   *  cell size. Two frames: the first lets the DOM apply the new dimensions,
   *  the second reflows charts into the settled box so they grow/shrink with
   *  the card instead of keeping a stale (shrinking) size. */
  private scheduleChartReflow(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
  }

  onLibraryDragStart(event: DragEvent, item: TileSelectorItem | ChartSelectorItem, kind: 'tile' | 'chart'): void {
    event.dataTransfer?.setData('application/x-smartops-dashboard-item', JSON.stringify({ kind, id: item.id }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  onLibraryDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  onLibraryDrop(event: DragEvent, expectedKind?: 'tile' | 'chart', targetIndex?: number): void {
    event.preventDefault();
    const raw = event.dataTransfer?.getData('application/x-smartops-dashboard-item');
    if (!raw) return;
    let payload: { kind?: string; id?: string };
    try { payload = JSON.parse(raw) as { kind?: string; id?: string }; } catch { return; }
    if ((payload.kind !== 'tile' && payload.kind !== 'chart') || (expectedKind && payload.kind !== expectedKind) || !payload.id) return;
    const before = this.captureBoardSnapshot();

    if (payload.kind === 'tile') {
      const tile = [...this.standardTiles, ...this.myTiles].find(candidate => candidate.id === payload.id);
      if (tile) {
        if (this.tileSlots.some(candidate => candidate?.id === tile.id)) return;
        if (targetIndex !== undefined && targetIndex >= 0 && targetIndex < this.tileSlots.length && !this.tileSlots[targetIndex]) {
          this.tileSlots[targetIndex] = tile;
        } else {
          const emptyIndex = this.tileSlots.indexOf(null);
          if (emptyIndex >= 0) this.tileSlots[emptyIndex] = tile;
          else this.tileSlots.push(tile);
        }
        this.loadTilePreview(tile);
      }
    } else {
      const chart = [...this.standardCharts, ...this.myCharts].find(candidate => candidate.id === payload.id);
      if (chart && !this.chartSlotsData.some(candidate => candidate.id === chart.id)) {
        if (targetIndex !== undefined && targetIndex >= 0 && targetIndex <= this.chartSlotsData.length) {
          this.chartSlotsData.splice(targetIndex, 0, chart);
        } else {
          this.chartSlotsData.push(chart);
        }
        this.loadChartPreview(chart);
      }
    }
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    this.refreshProductionGridster();
  }

  private refreshProductionGridster(): void {
    setTimeout(() => this.productionGridster?.updateGrid(), 320);
  }

  // ── Right panel ───────────────────────────────────────────
  activePanel: 'widgets' | 'filters' | 'tiles' | 'charts' | 'styling' | null = null;

  // ── Page tabs ─────────────────────────────────────────────
  tabs: BoardBuilderTab[] = [{ id: 'tab-1', label: 'Overview' }];
  activeTabId = 'tab-1';
  private nextTabIndex = 2;

  get breadcrumbs() {
    const label = this.authService.isAdmin() ? 'WIP Boards' : 'My Boards';
    return [
      { label: 'Home', route: '/' },
      { label: 'Dashboard' },
      { label, route: '/dashboard/wip-boards' },
      { label: this.isDashboardSaved ? 'Update Dashboard' : 'Build Dashboard' },
    ];
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly savedFilterService: DashboardSavedFilterService,
    private readonly layoutState: LayoutStateService,
    private readonly cdr: ChangeDetectorRef,
    private readonly authService: AuthService,
    private readonly location: Location,
  ) {}

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get wipChartsLabel(): string { return this.isAdmin ? 'WIP Charts' : 'My Charts'; }

  ngOnInit(): void {
    this.productionGridsterOptions = this.buildProductionGridsterOptions();
    this.syncUnifiedLayout();
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();

    this.layoutState.sidebarCollapsed$
      .pipe(takeUntil(this.destroy$))
      .subscribe(collapsed => {
        this.panelCollapsed = !collapsed;
        this.refreshProductionGridster();
        this.cdr.markForCheck();
      });

    this.categorySub = this.categoryService.getCategoriesByType('dashboard').subscribe(cats => {
      this.apiCategories = cats;
      this.categories = cats.map(c => c.categoryName);
      if (!this.category && this.categories.length > 0) this.category = this.categories[0];
      this.cdr.markForCheck();
    });

    const params = this.route.snapshot.queryParamMap;
    const dashboardId = Number(params.get('dashboardId'));
    if (Number.isInteger(dashboardId) && dashboardId > 0) this.dashboardId = dashboardId;
    const category = params.get('category');
    if (category) this.category = category;
    const name = params.get('name');
    if (name) this.pageName = name;
    const description = params.get('description');
    if (description) this.dashboardDescription = description;

    let state = this.router.currentNavigation()?.extras.state ?? window.history.state;
    const cloneTransfer = params.get('cloneTransfer');
    if (!this.dashboardId && cloneTransfer?.startsWith('dashboard-clone-')) {
      try {
        const transferredCharts = JSON.parse(sessionStorage.getItem(cloneTransfer) ?? 'null');
        if (Array.isArray(transferredCharts)) {
          state = { ...state, clonedCharts: transferredCharts };
          window.history.replaceState(state, '', window.location.href);
          sessionStorage.removeItem(cloneTransfer);
        }
      } catch {
        this.saveError = 'Unable to load the copied charts. Please try again from the source dashboard.';
      }
    }
    if (!this.dashboardId && Array.isArray(state?.clonedCharts)) {
      this.pageName = '';
      this.dashboardDescription = '';
      this.editingPageName = true;
      this.chartSlotsData = state.clonedCharts.map((chart: ChartSelectorItem) => ({ ...chart }));
      this.syncUnifiedLayout();
      this.chartSlotsData.forEach(chart => {
        if (this.isChartItem(chart)) this.loadChartPreview(chart);
      });
    }
    this.loadTilesFromApi();
    this.loadPlantFilters();
    // A brand-new (unsaved) dashboard has no dashboardId yet — don't restore a stale draft
    // left over from a different "new dashboard" attempt in this same browser tab.
    if (this.dashboardId) this.restoreFilterState();
  }

  ngOnDestroy(): void {
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.categorySub?.unsubscribe();
    if (this.draftSavedTimeout) clearTimeout(this.draftSavedTimeout);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Toolbar ───────────────────────────────────────────────
  startEditPageName(): void { this.editingPageName = true; }
  stopEditPageName(): void  { this.editingPageName = false; this.cdr.markForCheck(); }

  toggleCategoryDropdown(): void { this.showCategoryDropdown = !this.showCategoryDropdown; }
  selectCategory(cat: string): void {
    this.category = cat;
    this.showCategoryDropdown = false;
    this.cdr.markForCheck();
  }

  // ── Filter dropdown ──────────────────────────────────────
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openFilterName) { this.openFilterName = null; this.cdr.markForCheck(); }
    if (this.showSavedFilterList) { this.showSavedFilterList = false; this.cdr.markForCheck(); }
    if (this.openPresetMenuId) { this.openPresetMenuId = null; this.cdr.markForCheck(); }
    if (this.showTilesCategoryDropdown || this.showTilesSortDropdown || this.showChartsCategoryDropdown || this.showChartsSortDropdown) {
      this.showTilesCategoryDropdown = false;
      this.showTilesSortDropdown = false;
      this.showChartsCategoryDropdown = false;
      this.showChartsSortDropdown = false;
      this.cdr.markForCheck();
    }
  }

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
    this.cdr.markForCheck();
  }

  /** Snap a date to the last Tuesday on or before it (ISO string) — same default as the dashboard view page. */
  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const diff = (d.getDay() + 5) % 7;
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Derives From/To dates for a selected Quick Range option — matches the Edit Dashboard page. */
  private applyQuickRange(range: string): void {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    switch (range) {
      case 'Today':
        this.fromDate = iso(today);
        this.toDate = iso(today);
        break;
      case 'Till Last Tuesday':
        this.fromDate = iso(new Date(today.getFullYear(), 0, 1));
        this.toDate = this.lastTuesday(today);
        break;
      case 'This Week': {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay());
        this.fromDate = iso(d);
        this.toDate = iso(today);
        break;
      }
      case 'This Month':
        this.fromDate = iso(new Date(today.getFullYear(), today.getMonth(), 1));
        this.toDate = iso(today);
        break;
      case 'Last Month':
        this.fromDate = iso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        this.toDate = iso(new Date(today.getFullYear(), today.getMonth(), 0));
        break;
      case 'This Quarter': {
        const qm = Math.floor(today.getMonth() / 3) * 3;
        this.fromDate = iso(new Date(today.getFullYear(), qm, 1));
        this.toDate = iso(today);
        break;
      }
      case 'This Year':
        this.fromDate = iso(new Date(today.getFullYear(), 0, 1));
        this.toDate = iso(today);
        break;
      case 'After':
        this.toDate = '';
        break;
    }
  }

  selectFilterOption(field: string, value: string): void {
    (this as Record<string, unknown>)[field] = value || 'All';
    switch (field) {
      case 'country':      this.sector = 'All'; this.businessUnit = 'All'; this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'sector':       this.businessUnit = 'All'; this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'businessUnit': this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'division':     this.cluster = 'All'; this.plant = 'All'; break;
      case 'cluster':      this.plant = 'All'; break;
      case 'quickRange':   this.applyQuickRange(value); break;
    }
    this.rebuildCascadingOptions();
    this.openFilterName = null;
    this.persistFilterState();
    this.reloadPlacedPreviews();
    this.cdr.markForCheck();
  }

  /** Re-fetches every placed tile/chart's value using the current global filters — and also
   *  any Add Charts/Add Tiles library card already lazy-loaded (scrolled into view), since
   *  those otherwise never refresh once their preview request is cached. */
  private reloadPlacedPreviews(): void {
    const previouslyLoadedChartIds = new Set(this.loadedChartPreviewIds);
    const previouslyCachedTileKeys = new Set(this.tilePreviewRequests.keys());
    this.tilePreviewRequests.clear();
    this.loadedBreakdownKeys.clear();
    this.tileSlots.forEach(slot => {
      if (this.isTileItem(slot)) this.loadTilePreview(slot);
      else if (this.isChartItem(slot)) { this.loadedChartPreviewIds.delete(slot.id); this.loadChartPreview(slot); }
    });
    this.chartSlotsData.forEach(slot => {
      if (this.isChartItem(slot)) { this.loadedChartPreviewIds.delete(slot.id); this.loadChartPreview(slot); }
      else if (this.isTileItem(slot)) this.loadTilePreview(slot);
    });
    // Staggered (not all at once) — refreshing every already-loaded library card in parallel
    // was firing dozens of simultaneous previewView requests and leaving some stuck pending.
    // loadChartPreview/loadTilePreview kick off their own internal subscription and return void,
    // so a mergeMap concurrency limit alone wouldn't actually cap real in-flight requests —
    // spacing out *when* each one is dispatched does.
    const staggerMs = 120;
    const chartsToRefresh = [...this.standardCharts, ...this.myCharts].filter(chart => previouslyLoadedChartIds.has(chart.id));
    from(chartsToRefresh).pipe(
      mergeMap((chart, i) => timer(i * staggerMs).pipe(tap(() => {
        this.loadedChartPreviewIds.delete(chart.id);
        this.loadChartPreview(chart);
      }))),
      takeUntil(this.destroy$),
    ).subscribe();
    const tilesToRefresh = [...this.standardTiles, ...this.myTiles]
      .filter(tile => previouslyCachedTileKeys.has(JSON.stringify([tile.id, tile.designJson])));
    from(tilesToRefresh).pipe(
      mergeMap((tile, i) => timer(i * staggerMs).pipe(tap(() => this.loadTilePreview(tile)))),
      takeUntil(this.destroy$),
    ).subscribe();
  }

  private injectGlobalFilterParams(sql: string): string {
    const declarations: Record<string, string> = {
      country: this.country, sector: this.sector, businessUnit: this.businessUnit,
      division: this.division, cluster: this.cluster, plant: this.plant,
    };
    for (const [name, value] of Object.entries(declarations)) {
      if (!value || value === 'All' || !/^[A-Za-z0-9\s\-_.,()]+$/.test(value)) continue;
      const parameter = `@${name}`;
      const declaration = new RegExp(`DECLARE\\s+${parameter}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
      if (declaration.test(sql)) {
        sql = sql.replace(declaration, `DECLARE ${parameter} $1 = '${value}';`);
      } else if (new RegExp(`\\b${parameter}\\b`, 'i').test(sql)) {
        sql = `DECLARE ${parameter} VARCHAR(100) = '${value}';\n${sql}`;
      }
    }
    for (const [parameter, value] of [['start_date', this.fromDate], ['end_date', this.toDate]] as const) {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const declaration = new RegExp(`DECLARE\\s+@${parameter}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
      if (declaration.test(sql)) sql = sql.replace(declaration, `DECLARE @${parameter} $1 = '${value}';`);
    }
    return sql;
  }

  /** Finds a row's column whose name matches (or contains) the given keyword, case-insensitive. */
  private findColumn(row: Record<string, unknown>, keyword: string): string | null {
    const lower = keyword.toLowerCase();
    const exact = Object.keys(row).find(k => k.toLowerCase() === lower);
    if (exact) return exact;
    return Object.keys(row).find(k => k.toLowerCase().includes(lower)) ?? null;
  }

  /**
   * Client-side Cluster/Plant filter for Table-sourced rows (table sources have no SQL @cluster/
   * @plant params to piggyback on, unlike views).
   */
  private applyGlobalRowFilter(rows: Record<string, unknown>[], plantClone = false): Record<string, unknown>[] {
    const cluster = this.cluster !== 'All' ? this.cluster : '';
    const plant = !plantClone && this.plant !== 'All' ? this.plant : '';
    if (!cluster && !plant) return rows;
    return rows.filter(row => {
      if (cluster) {
        const col = this.findColumn(row, 'cluster');
        if (col && String(row[col]).toLowerCase() !== cluster.toLowerCase()) return false;
      }
      if (plant) {
        const col = this.findColumn(row, 'plant');
        if (col && String(row[col]).toLowerCase() !== plant.toLowerCase()) return false;
      }
      return true;
    });
  }

  /**
   * Country→Plant hierarchy as request filters — view sources only (a view's SQL matches these to
   * its DECLARE @cluster/@plant placeholders; a table source would turn them into bogus WHERE
   * clauses, so table filtering instead happens client-side in applyGlobalRowFilter). Trend/
   * aggregated rows have no cluster/plant column left to filter afterwards, so this hierarchy must
   * travel with the request itself or a filter change silently does nothing.
   */
  private globalHierarchyFilterPayload(isView: boolean): { sourceTable: string; sourceColumn: string; controlType: string; value: string; label: string }[] {
    if (!isView) return [];
    const values: Record<string, string> = {
      country: this.country, sector: this.sector, businessUnit: this.businessUnit,
      division: this.division, cluster: this.cluster, plant: this.plant,
    };
    return Object.entries(values)
      .filter(([, value]) => value && value !== 'All')
      .map(([key, value]) => ({ sourceTable: key, sourceColumn: key, controlType: 'Dropdown', value, label: key }));
  }

  /** Resets the Add Tiles/Add Charts modal's filter row (shared fields) to their defaults. */
  clearAdvancedFilters(event?: Event): void {
    event?.stopPropagation();
    this.country = 'All';
    this.sector = 'All';
    this.businessUnit = 'All';
    this.division = 'All';
    this.cluster = 'All';
    this.plant = 'All';
    this.customFilters.forEach(filter => filter.value = 'All');
    this.fromDate = `${new Date().getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(new Date());
    this.quickRange = '';
    this.openFilterName = null;
    this.activePresetId = null;
    this.autoSelectSingle();
    this.rebuildCascadingOptions();
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  toggleSavedFilterList(event: Event): void {
    event.stopPropagation();
    this.showSavedFilterList = !this.showSavedFilterList;
    if (this.showSavedFilterList && this.dashboardId) {
      this.savedFilterService.getAll(this.dashboardId).pipe(takeUntil(this.destroy$)).subscribe(filters => {
        this.savedFilterPresets = filters.map((f, i) => ({
          id: f.id,
          name: f.filterName,
          accent: this.presetAccents[i % this.presetAccents.length],
          country: f.country ?? 'All',
          sector: f.sector ?? 'All',
          businessUnit: f.businessUnit ?? 'All',
          division: f.division ?? 'All',
          cluster: f.cluster ?? 'All',
          plant: f.plant ?? 'All',
          quickRange: f.quickRange ?? '',
          fromDate: f.fromDate ?? '',
          toDate: f.toDate ?? '',
          lastUsed: this.formatPresetDate(f.updatedOn),
          isFavorite: f.isFavorite ?? false,
        }));
        this.cdr.markForCheck();
      });
    }
    this.cdr.markForCheck();
  }

  openSaveFilterModal(event: Event): void {
    event.stopPropagation();
    this.newFilterName = '';
    this.renamingPresetId = null;
    this.showSaveFilterModal = true;
    this.showSavedFilterList = false;
    this.cdr.markForCheck();
  }

  closeSaveFilterModal(): void {
    this.showSaveFilterModal = false;
    this.renamingPresetId = null;
    this.cdr.markForCheck();
  }

  applySavedFilterPreset(preset: SavedFilterPreset): void {
    this.country = preset.country;
    this.sector = preset.sector;
    this.businessUnit = preset.businessUnit;
    this.division = preset.division;
    this.cluster = preset.cluster;
    this.plant = preset.plant;
    this.quickRange = preset.quickRange;
    if (preset.fromDate) this.fromDate = this.toDateOnly(preset.fromDate);
    if (preset.toDate) this.toDate = this.toDateOnly(preset.toDate);
    this.activePresetId = preset.id;
    this.rebuildCascadingOptions();
    this.showSavedFilterList = false;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  /** Backend returns full ISO datetime strings for saved-filter dates; the date inputs need plain YYYY-MM-DD. */
  private toDateOnly(iso: string): string {
    return iso.slice(0, 10);
  }

  saveNewFilter(): void {
    const name = this.newFilterName.trim();
    if (!name || !this.dashboardId) return;

    if (this.renamingPresetId) {
      const id = this.renamingPresetId;
      this.savedFilterService.rename(this.dashboardId, id, name).pipe(takeUntil(this.destroy$)).subscribe(() => {
        const preset = this.savedFilterPresets.find(p => p.id === id);
        if (preset) preset.name = name;
        this.renamingPresetId = null;
        this.showSaveFilterModal = false;
        this.cdr.markForCheck();
      });
      return;
    }

    this.savedFilterService.save(this.dashboardId, {
      filterName: name,
      country: this.country,
      sector: this.sector,
      businessUnit: this.businessUnit,
      division: this.division,
      cluster: this.cluster,
      plant: this.plant,
      quickRange: this.quickRange,
      fromDate: this.fromDate,
      toDate: this.toDate,
    }).pipe(takeUntil(this.destroy$)).subscribe(saved => {
      const mapped: SavedFilterPreset = {
        id: saved.id,
        name: saved.filterName,
        accent: this.presetAccents[this.savedFilterPresets.length % this.presetAccents.length],
        country: saved.country ?? 'All',
        sector: saved.sector ?? 'All',
        businessUnit: saved.businessUnit ?? 'All',
        division: saved.division ?? 'All',
        cluster: saved.cluster ?? 'All',
        plant: saved.plant ?? 'All',
        quickRange: saved.quickRange ?? '',
        fromDate: saved.fromDate ?? '',
        toDate: saved.toDate ?? '',
        lastUsed: this.formatPresetDate(saved.updatedOn),
        isFavorite: saved.isFavorite ?? false,
      };
      const existingIndex = this.savedFilterPresets.findIndex(p => p.id === saved.id);
      if (existingIndex >= 0) this.savedFilterPresets[existingIndex] = mapped;
      else this.savedFilterPresets.unshift(mapped);
      this.activePresetId = saved.id;
      this.showSaveFilterModal = false;
      this.persistFilterState();
      this.cdr.markForCheck();
    });
  }

  private formatPresetDate(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }

  /** sessionStorage key for the live filter bar — per-dashboard once saved, shared draft bucket before that. */
  private filterStorageKey(): string {
    const id = this.dashboardId || Number(this.route.snapshot.queryParamMap.get('dashboardId')) || 'new';
    return `board-builder-filters-${id}`;
  }

  /** Persists the current filter bar selection so it survives a page refresh (same tab only). */
  private persistFilterState(): void {
    const state = {
      country: this.country, sector: this.sector, businessUnit: this.businessUnit, division: this.division,
      cluster: this.cluster, plant: this.plant, quickRange: this.quickRange,
      fromDate: this.fromDate, toDate: this.toDate, activePresetId: this.activePresetId,
      customFilters: Object.fromEntries(this.customFilters.map(filter => [filter.id, filter.value])),
    };
    try {
      sessionStorage.setItem(this.filterStorageKey(), JSON.stringify(state));
    } catch {
      // sessionStorage unavailable — filter bar simply won't persist across a refresh.
    }
  }

  /** Restores a previously persisted filter bar selection, if any (runs before plant-filter data loads). */
  private restoreFilterState(): void {
    try {
      const raw = sessionStorage.getItem(this.filterStorageKey());
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.country) this.country = state.country;
      if (state.sector) this.sector = state.sector;
      if (state.businessUnit) this.businessUnit = state.businessUnit;
      if (state.division) this.division = state.division;
      if (state.cluster) this.cluster = state.cluster;
      if (state.plant) this.plant = state.plant;
      if (state.quickRange) this.quickRange = state.quickRange;
      if (state.fromDate) this.fromDate = state.fromDate;
      if (state.toDate) this.toDate = state.toDate;
      if (state.activePresetId != null) this.activePresetId = state.activePresetId;
      this.pendingCustomFilterValues = state.customFilters ?? {};
    } catch {
      // Corrupt/incompatible stored state — ignore and keep defaults.
    }
  }

  private loadPlantFilters(): void {
    this.commonApi.getPlantFilters().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe(plants => {
      this.allPlants = plants;
      this.countryOptions = this.distinctValues(plants, p => p.country);
      this.autoSelectSingle();
      this.rebuildCascadingOptions();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingle(): void {
    const active = (v: string) => v && v !== 'All';
    if (this.countryOptions.length === 1) this.country = this.countryOptions[0];
    let filtered = this.allPlants;
    if (active(this.country)) filtered = filtered.filter(p => p.country === this.country);
    const sectors = this.distinctValues(filtered, p => p.sector);
    if (sectors.length === 1) this.sector = sectors[0];
    if (active(this.sector)) filtered = filtered.filter(p => p.sector === this.sector);
    const bus = this.distinctValues(filtered, p => p.businessUnit);
    if (bus.length === 1) this.businessUnit = bus[0];
    if (active(this.businessUnit)) filtered = filtered.filter(p => p.businessUnit === this.businessUnit);
    const divs = this.distinctValues(filtered, p => p.division);
    if (divs.length === 1) this.division = divs[0];
  }

  private rebuildCascadingOptions(): void {
    const active = (v: string) => v && v !== 'All';
    let filtered = this.allPlants;
    if (active(this.country)) filtered = filtered.filter(p => p.country === this.country);
    this.sectorOptions = active(this.country) ? this.distinctValues(filtered, p => p.sector) : [];
    if (active(this.sector)) filtered = filtered.filter(p => p.sector === this.sector);
    this.buOptions = active(this.sector) ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (active(this.businessUnit)) filtered = filtered.filter(p => p.businessUnit === this.businessUnit);
    this.divisionOptions = active(this.businessUnit) ? this.distinctValues(filtered, p => p.division) : [];
    if (active(this.division)) filtered = filtered.filter(p => p.division === this.division);
    this.clusterOptions = active(this.division) ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    if (!active(this.cluster) && this.clusterOptions.length === 1) this.cluster = this.clusterOptions[0];
    if (active(this.cluster)) filtered = filtered.filter(p => p.cluster === this.cluster);
    this.plantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (!active(this.plant) && this.plantOptions.length === 1) this.plant = this.plantOptions[0];
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  toggleLock():  void { this.locked = !this.locked; }
  zoomIn():      void { this.zoomLevel = Math.min(this.zoomLevel + 10, 200); this.refreshProductionGridster(); }
  zoomOut():     void { this.zoomLevel = Math.max(this.zoomLevel - 10, 50); this.refreshProductionGridster(); }
  togglePanel(): void { this.panelCollapsed = !this.panelCollapsed; this.refreshProductionGridster(); }

  addPage(): void {
    const id = `tab-${Date.now()}`;
    this.tabs = [...this.tabs, { id, label: `Page ${this.nextTabIndex++}` }];
    this.activeTabId = id;
    this.cdr.markForCheck();
  }

  setActiveTab(id: string): void { this.activeTabId = id; }

  closeTab(tab: BoardBuilderTab): void {
    if (this.tabs.length === 1) return;
    this.tabs = this.tabs.filter(t => t.id !== tab.id);
    if (this.activeTabId === tab.id) this.activeTabId = this.tabs[0].id;
    this.cdr.markForCheck();
  }

  // ── Header actions ────────────────────────────────────────
  discard():     void { this.router.navigate(['/dashboard/wip-boards']); }
  isSaving = false;
  saveSuccess = '';
  private draftSavedTimeout: ReturnType<typeof setTimeout> | null = null;
  saveError = '';
  /** Id of the dashboard once the first save succeeds — null until then (create-only builder, no edit route). */
  private dashboardId: number | null = null;

  /** Save Filter requires a persisted dashboard to attach the filter to. */
  get isDashboardSaved(): boolean {
    return !!this.dashboardId;
  }

  save(): void { this.saveDashboard(false); }
  saveAndClose(): void { this.saveDashboard(false, true); }
  publish(): void {
    if (!this.isAdmin) return;
    this.saveDashboard(true);
  }

  closeDashboardValidation(): void {
    this.dashboardValidationMessage = '';
    this.cdr.markForCheck();
  }

  private saveDashboard(publishAfter = false, closeAfterSave = false): void {
    if (this.isSaving) return;

    const cat = this.apiCategories.find(c => c.categoryName === this.category);
    if (!cat) { this.saveError = 'Please select a valid category.'; this.cdr.markForCheck(); return; }
    this.nameValidationError = this.pageName.trim() ? '' : 'Please enter a dashboard name.';
    this.descriptionValidationError = this.dashboardDescription.trim() ? '' : 'Please enter a description.';
    if (this.nameValidationError || this.descriptionValidationError) {
      this.dashboardValidationMessage = this.nameValidationError && this.descriptionValidationError
        ? 'Please enter dashboard name and description. You can also change the dashboard category if needed.'
        : this.nameValidationError ? 'Please enter dashboard name.' : 'Please enter dashboard description.';
      if (this.nameValidationError) this.editingPageName = true;
      this.cdr.markForCheck();
      return;
    }

    this.dashboardValidationMessage = '';
    this.isSaving = true;
    this.saveError = '';
    this.saveSuccess = '';

    // A slot's saved type reflects what's actually in it (not which row it's
    // sitting in), since dragging can swap a tile and a chart across rows.
    const tileCount = this.tileSlots.filter(Boolean).length;
    const widgets = [
      ...this.tileSlots.filter(Boolean).map((t, i) => ({
        chartId: Number(this.isChartItem(t) ? (t.widgetId ?? t.id) : t!.id) || 0,
        sortOrder: i + 1,
        type: this.isChartItem(t) ? 'chart' : 'tile',
        width: this.isChartItem(t) ? (t.width || null) : null,
        height: this.isChartItem(t) ? (t.height || null) : null,
        ...(this.isChartItem(t) && t.presetColumn ? { presetColumn: t.presetColumn, presetValue: t.presetValue ?? '' } : {}),
      })),
      ...this.chartSlotsData.map((c, i) => ({
        chartId: Number(this.isChartItem(c) ? (c.widgetId ?? c.id) : c.id) || 0,
        sortOrder: tileCount + i + 1,
        type: this.isChartItem(c) ? 'chart' : 'tile',
        width: this.isChartItem(c) ? (c.width || null) : null,
        height: this.isChartItem(c) ? (c.height || null) : null,
        ...(this.isChartItem(c) && c.presetColumn ? { presetColumn: c.presetColumn, presetValue: c.presetValue ?? '' } : {}),
      })),
    ];

    const request: SaveDashboardRequest = {
      dashboardName: this.pageName.trim(),
      categoryId: cat.categoryId,
      description: this.dashboardDescription.trim() || undefined,
      configJson: JSON.stringify({
        widgets, chartColumns: this.effectiveColumns, layout: this.buildPersistedLayout(), branding: this.branding,
        customFilters: this.customFilters.map(({ value, ...filter }) => filter),
      }),
    };

    const obs$ = this.dashboardId
      ? this.dashboardService.updateDashboard(this.dashboardId, request)
      : this.dashboardService.createDashboard(request);

    const wasExisting = this.isDashboardSaved;
    obs$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.isSaving = false;
        const name = response.data?.dashboardName || this.pageName;
        const draftSavedMessage = wasExisting ? `'${name}' updated successfully.` : `'${name}' saved as draft.`;
        this.saveSuccess = draftSavedMessage;
        if (this.draftSavedTimeout) clearTimeout(this.draftSavedTimeout);
        this.draftSavedTimeout = setTimeout(() => {
          this.draftSavedTimeout = null;
          // Clear only this draft confirmation, not a later publish/delete message.
          if (this.saveSuccess === draftSavedMessage) {
            this.saveSuccess = '';
            this.cdr.markForCheck();
          }
        }, 4000);
        // First save of a new dashboard: switch to edit mode so subsequent saves update instead of re-creating (avoids duplicate-name error)
        if (!this.dashboardId && response.data?.dashboardId) {
          this.dashboardId = response.data.dashboardId;
          // Reflect the new id in the URL (route has no :id segment) so a refresh still resolves it and the Saved Filter list remains visible.
          this.location.replaceState('/dashboard/board-builder', `dashboardId=${this.dashboardId}`);
          // Migrate the pre-save filter draft to the now-known dashboard id so a refresh restores it too.
          this.persistFilterState();
          try { sessionStorage.removeItem('board-builder-filters-new'); } catch { /* ignore */ }
        }
        const savedDashboardId = this.dashboardId ?? response.data?.dashboardId;
        if (savedDashboardId) {
          this.savedFilterService.saveDefault(savedDashboardId, {
            country: this.country, sector: this.sector, businessUnit: this.businessUnit,
            division: this.division, cluster: this.cluster, plant: this.plant,
            quickRange: this.quickRange, fromDate: this.fromDate, toDate: this.toDate,
          }).pipe(takeUntil(this.destroy$)).subscribe({ error: () => {} });
        }
        this.cdr.markForCheck();

        if (publishAfter && response.data?.dashboardId) {
          this.dashboardService.publishDashboard(response.data.dashboardId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.saveSuccess = `'${name}' published successfully.`;
                this.cdr.markForCheck();
                setTimeout(() => this.router.navigate(['/dashboard/wip-boards']), 800);
              },
              error: () => {
                this.saveError = 'Dashboard saved but publishing failed.';
                this.cdr.markForCheck();
              },
            });
        } else if (closeAfterSave && response.data?.dashboardId) {
          setTimeout(() => this.router.navigate(['/dashboard/operations-dashboard', response.data!.dashboardId], { queryParams: { from: 'wip' } }), 800);
        }
      },
      error: (err) => {
        this.isSaving = false;
        this.saveError = err?.error?.message || err?.message || 'Failed to save dashboard.';
        this.cdr.markForCheck();
      },
    });
  }

  /** The tile/chart zone slot a layout entry's sortOrder refers to (see the save payload's widgets). */
  private gridItemForSortOrder(sortOrder: number): ProductionGridItem | undefined {
    const tileIndexes = this.tileSlots
      .map((slot, index) => slot ? index : -1)
      .filter(index => index >= 0);
    const [zone, index] = sortOrder <= tileIndexes.length
      ? ['tile', tileIndexes[sortOrder - 1]] as const
      : ['chart', sortOrder - tileIndexes.length - 1] as const;
    return this.productionGridItems.find(candidate => candidate.zone === zone && candidate.index === index);
  }

  private buildPersistedLayout(): DashboardLayoutConfig {
    // Paired by sortOrder (i.e. by which zone slot the widget sits in), not by item.type — a chart
    // dragged into the tile row keeps type 'chart', and a type-based pairing would save the wrong
    // Gridster item's position/size for it and every widget after it.
    const items: DashboardLayoutItem[] = this.unifiedLayout.items.map(item => {
      const gridItem = this.gridItemForSortOrder(item.sortOrder);
      return {
        ...item,
        x: gridItem?.x ?? item.x,
        y: gridItem?.y ?? item.y,
        cols: gridItem?.cols ?? item.cols,
        rows: gridItem?.rows ?? item.rows,
      };
    });
    return { version: 1, columns: 20, items };
  }

  selectPanel(panel: 'widgets' | 'filters' | 'tiles' | 'charts' | 'styling'): void {
    this.activePanel = this.activePanel === panel ? null : panel;
    if (panel === 'tiles') { this.syncTileSelectionFromSlots(); this.showTilesModal = true; }
    if (panel === 'charts') { this.syncChartSelectionFromSlots(); this.showChartsModal = true; }
    if (panel === 'filters') this.showFiltersModal = true;
    if (panel === 'styling') { this.showStylingModal = true; }
    this.cdr.markForCheck();
  }

  showFiltersModal = false;

  closeFiltersModal(): void {
    this.showFiltersModal = false;
    this.activePanel = null;
    this.cdr.markForCheck();
  }

  private customFilterId(sourceTable: string, sourceColumn: string): string {
    return `${sourceTable}::${sourceColumn}`;
  }

  get availableCustomFilterCandidates(): { label: string; sourceTable: string; sourceColumn: string }[] {
    const added = new Set(this.customFilters.map(filter => filter.id));
    const seen = new Set<string>();
    const candidates: { label: string; sourceTable: string; sourceColumn: string }[] = [];
    const charts = [...this.tileSlots, ...this.chartSlotsData].filter((slot): slot is ChartSelectorItem =>
      this.isChartItem(slot));

    for (const chart of charts) {
      for (const filter of this.getChartLocalFilters(chart)) {
        if (filter.controlType !== 'Dropdown' || filter.hidden || filter.locked || filter.sourceColumn === chart.presetColumn) continue;
        const id = this.customFilterId(filter.sourceTable, filter.sourceColumn);
        if (added.has(id) || seen.has(id)) continue;
        seen.add(id);
        candidates.push({ label: filter.label, sourceTable: filter.sourceTable, sourceColumn: filter.sourceColumn });
      }
    }
    return candidates;
  }

  getCustomFilterOptions(filter: CustomDashboardFilter): string[] {
    const key = (value: string) => value.trim().toLowerCase();
    const options = [...this.tileSlots, ...this.chartSlotsData]
      .filter((slot): slot is ChartSelectorItem => this.isChartItem(slot))
      .flatMap(chart => this.getChartLocalFilters(chart))
      .filter(local => key(local.sourceTable) === key(filter.sourceTable) && key(local.sourceColumn) === key(filter.sourceColumn))
      .flatMap(local => local.options);
    return [...new Set(options)].sort((left, right) => left.localeCompare(right));
  }

  addCustomFilter(filter: { label: string; sourceTable: string; sourceColumn: string }): void {
    const id = this.customFilterId(filter.sourceTable, filter.sourceColumn);
    if (this.customFilters.some(existing => existing.id === id)) return;
    this.customFilters = [...this.customFilters, { ...filter, id, value: 'All' }];
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  removeCustomFilter(id: string): void {
    this.customFilters = this.customFilters.filter(filter => filter.id !== id);
    if (this.openFilterName === `custom_${id}`) this.openFilterName = null;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  selectCustomFilterOption(id: string, value: string): void {
    this.customFilters = this.customFilters.map(filter =>
      filter.id === id ? { ...filter, value } : filter);
    this.openFilterName = null;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  private applyPendingCustomFilterValues(): void {
    this.customFilters = this.customFilters.map(filter => ({
      ...filter,
      value: this.pendingCustomFilterValues[filter.id] || filter.value,
    }));
  }

  // ── Styling modal ─────────────────────────────────────────
  showStylingModal = false;
  branding: DashboardBranding = {};

  applyBranding(branding: DashboardBranding): void {
    this.branding = normalizeDashboardBranding(branding);
    this.closeStylingModal();
  }

  closeStylingModal(): void {
    this.showStylingModal = false;
    this.activePanel = null;
    this.cdr.markForCheck();
  }

  // ── Tiles modal ───────────────────────────────────────────
  showTilesModal = false;
  tilesModalTab: 'standard' | 'my' = 'standard';
  tilesSearchTerm = '';
  selectedTileIds = new Set<string>();
  tilesLoading = false;

  tilesCategoryFilter = 'all';
  tilesSortOption: 'name-asc' | 'name-desc' = 'name-asc';
  showTilesCategoryDropdown = false;
  showTilesSortDropdown = false;

  get tileCategoryOptions(): string[] {
    const source = this.tilesModalTab === 'standard' ? this.standardTiles : this.myTiles;
    return [...new Set(source.map(t => t.categoryName).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  }

  get tilesCategoryLabel(): string { return this.tilesCategoryFilter === 'all' ? 'All Category' : this.tilesCategoryFilter; }
  get tilesSortLabel(): string { return this.tilesSortOption === 'name-asc' ? 'Name (A-Z)' : 'Name (Z-A)'; }

  toggleTilesCategoryDropdown(event: Event): void {
    event.stopPropagation();
    const opening = !this.showTilesCategoryDropdown;
    this.showTilesCategoryDropdown = false;
    this.showTilesSortDropdown = false;
    this.showChartsCategoryDropdown = false;
    this.showChartsSortDropdown = false;
    if (opening) { this.showTilesCategoryDropdown = true; }
  }

  selectTilesCategory(cat: string): void {
    this.tilesCategoryFilter = cat;
    this.showTilesCategoryDropdown = false;
  }

  toggleTilesSortDropdown(event: Event): void {
    event.stopPropagation();
    const opening = !this.showTilesSortDropdown;
    this.showTilesCategoryDropdown = false;
    this.showTilesSortDropdown = false;
    this.showChartsCategoryDropdown = false;
    this.showChartsSortDropdown = false;
    if (opening) { this.showTilesSortDropdown = true; }
  }

  selectTilesSort(opt: 'name-asc' | 'name-desc'): void {
    this.tilesSortOption = opt;
    this.showTilesSortDropdown = false;
  }

  standardTiles: TileSelectorItem[] = [];
  myTiles: TileSelectorItem[] = [];

  private readonly accentCycle: TileSelectorItem['accent'][] = ['blue', 'green', 'red', 'purple', 'orange'];

  get filteredTiles(): TileSelectorItem[] {
    const source = this.tilesModalTab === 'standard' ? this.standardTiles : this.myTiles;
    const term = this.tilesSearchTerm.toLowerCase();
    const result = source.filter(t =>
      (!term || t.title.toLowerCase().includes(term)) &&
      (this.tilesCategoryFilter === 'all' || t.categoryName === this.tilesCategoryFilter));
    return [...result].sort((a, b) => this.tilesSortOption === 'name-asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
  }

  private loadTilesFromApi(): void {
    this.tilesLoading = true;
    this.chartsLoading = true;
    this.dashboardService.getWidgetLibrary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (library) => {
          this.standardTiles = (library.tiles ?? [])
            .filter(t => t.status?.toLowerCase() === 'published')
            .map((t, i) => this.mapWidgetToTileItem(t, i));
          this.myTiles = (library.tiles ?? [])
            .filter(t => t.status?.toLowerCase() === 'draft')
            .map((t, i) => this.mapWidgetToTileItem(t, i));
          this.standardCharts = (library.charts ?? [])
            .filter(c => c.status?.toLowerCase() === 'published')
            .map(c => this.mapWidgetToChartItem(c));
          this.myCharts = (library.charts ?? [])
            .filter(c => c.status?.toLowerCase() === 'draft')
            .map(c => this.mapWidgetToChartItem(c));
          this.tilesLoading = false;
          this.chartsLoading = false;
          this.pageLoading = false;
          if (this.dashboardId) this.loadExistingDashboard(library);
          // Previews are loaded lazily as cards scroll into view (see onTileVisible/onChartVisible).
          this.cdr.markForCheck();
        },
        error: () => {
          this.tilesLoading = false;
          this.chartsLoading = false;
          this.pageLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  private loadExistingDashboard(library: { tiles?: WidgetLibraryItem[]; charts?: WidgetLibraryItem[] }): void {
    if (!this.dashboardId) return;
    this.dashboardService.getDashboardById(this.dashboardId).pipe(takeUntil(this.destroy$)).subscribe({
      next: response => {
        const dashboard = response.data;
        if (!dashboard) return;
        this.pageName = dashboard.dashboardName || this.pageName;
        this.dashboardDescription = dashboard.description || '';
        this.category = dashboard.categoryName || this.category;

        let config: {
          widgets?: Array<{ chartId?: number; sortOrder?: number; type?: string; width?: number | null; height?: number | null; presetColumn?: string; presetValue?: string }>;
          chartColumns?: number;
          layout?: DashboardLayoutConfig;
          branding?: DashboardBranding;
          customFilters?: Omit<CustomDashboardFilter, 'value'>[];
        } = {};
        try { config = dashboard.configJson ? JSON.parse(dashboard.configJson) : {}; } catch { config = {}; }
        this.branding = normalizeDashboardBranding(config.branding);
        this.customFilters = (config.customFilters ?? []).map(filter => ({ ...filter, value: 'All' }));
        this.applyPendingCustomFilterValues();

        const savedColumns = Number(config.chartColumns);
        if (savedColumns === 3 || savedColumns === 4) this.layout = savedColumns === 4 ? '4x4' : '3x3';
        else this.layout = '2x2';
        this.layoutExplicitlySet = true;

        const tileMap = new Map((library.tiles ?? []).map(widget => [widget.id, widget]));
        const chartMap = new Map((library.charts ?? []).map(widget => [widget.id, widget]));
        const widgets = [...(config.widgets ?? [])].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
        this.tileSlots = [];
        this.chartSlotsData = [];
        let tileIndex = 0;
        for (const saved of widgets) {
          const widgetId = Number(saved.chartId);
          if (!Number.isInteger(widgetId) || widgetId <= 0) continue;
          if (saved.type === 'tile') {
            const widget = tileMap.get(widgetId);
            if (!widget) continue;
            const tile = this.mapWidgetToTileItem(widget, tileIndex++);
            const emptyIndex = this.tileSlots.indexOf(null);
            if (emptyIndex >= 0) this.tileSlots[emptyIndex] = tile;
            else this.tileSlots.push(tile);
          } else {
            const widget = chartMap.get(widgetId);
            if (!widget) continue;
            const chart = this.mapWidgetToChartItem(widget);
            chart.width = this.validDimension(saved.width);
            chart.height = this.validDimension(saved.height);
            if (saved.presetColumn) {
              chart.widgetId = widgetId;
              chart.id = `clone_${widgetId}_${this.chartSlotsData.length}`;
              chart.presetColumn = saved.presetColumn;
              chart.presetValue = saved.presetValue ?? '';
              chart.title = `${chart.title}-${chart.presetValue}`;
            }
            this.chartSlotsData.push(chart);
          }
        }

        this.syncUnifiedLayout();
        this.applyPersistedLayout(config.layout);
        this.resetUndoHistory();
        this.refreshProductionGridster();
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  private validDimension(value: number | null | undefined): number | undefined {
    return Number.isFinite(value) && (value as number) > 0 ? Math.round(value as number) : undefined;
  }

  private applyPersistedLayout(layout: DashboardLayoutConfig | undefined): void {
    const sanitized = sanitizePersistedLayout(layout);
    if (!sanitized) return;
    // Matched by stable widget id (see matchPersistedLayoutItems): a saved widget that no longer
    // loads renumbers every later widget's sortOrder, and an exact-sortOrder-only match then
    // dropped all of their saved positions back to the defaults.
    const placed = [
      ...this.tileSlots.map((slot, index) => ({ slot, zone: 'tile' as const, index })).filter(entry => entry.slot),
      ...this.chartSlotsData.map((slot, index) => ({ slot, zone: 'chart' as const, index })),
    ];
    const matches = matchPersistedLayoutItems(sanitized, placed.map(({ slot }, position) => ({
      id: Number(this.isChartItem(slot) ? (slot.widgetId ?? slot.id) : slot!.id),
      type: this.isChartItem(slot) ? 'chart' as const : 'tile' as const,
      sortOrder: position + 1,
    })));
    for (const [position, item] of matches.entries()) {
      if (!item) continue;
      const target = this.productionGridItems.find(candidate => candidate.zone === placed[position].zone && candidate.index === placed[position].index);
      if (!target) continue;
      target.x = item.x;
      target.y = item.y;
      target.cols = item.cols;
      target.rows = item.rows;
      // Also written onto the tile/chart slot itself (not just this transient productionGridItems
      // entry), so migrateLegacyWidgetsToLayout treats it as already placed on the very next
      // syncUnifiedLayout — otherwise adding/removing anything after load would treat every
      // reloaded widget as brand new and rescan/reset all of their positions.
      const slot = target.zone === 'tile' ? this.tileSlots[target.index] : this.chartSlotsData[target.index];
      if (slot) {
        slot.x = item.x;
        slot.y = item.y;
        slot.width = item.cols;
        slot.height = item.rows;
      }
    }
    // Rebuild from the restored slots so unifiedLayout and the canvas height (minRows) reflect the
    // saved layout rather than the default positions assigned before it was applied.
    this.syncUnifiedLayout();
  }

  private mapWidgetToTileItem(widget: WidgetLibraryItem, index: number): TileSelectorItem {
    let title = widget.name;
    let value = '—';
    let accent = this.accentCycle[index % this.accentCycle.length];
    let icon: TileSelectorItem['icon'] = 'well';
    let active = 0;
    let inactive = 0;
    let activeLabel   = 'Active';
    let inactiveLabel = 'Inactive';
    let badgeText: string | undefined;
    let badgeColor: string | undefined;

    if (widget.designJson) {
      try {
        const design = JSON.parse(widget.designJson);
        if (design.title) title = design.title;
        if (design.tileColor) {
          const colorMap: Record<string, TileSelectorItem['accent']> = {
            blue: 'blue', green: 'green', red: 'red', amber: 'amber', teal: 'teal', gray: 'gray',
            '#4ADE80': 'green', '#EF4444': 'red', '#F59E0B': 'amber', '#14B8A6': 'teal', '#9CA3AF': 'gray',
            '#2563EB': 'blue', '#12B76A': 'green', '#D92D20': 'red',
            '#7C3AED': 'purple', '#F58220': 'orange',
          };
          accent = colorMap[design.tileColor] ?? accent;
        }
        // Tile Builder already saves one of TileIconComponent's own icon names (well/gauge/crew/
        // calendar/derrick/trend/check/alert) — that shared component also aliases legacy names
        // (location, chart, etc.), so it's passed through as-is rather than re-mapped here.
        if (design.tileIcon) icon = design.tileIcon;
        if (design.breakdownRows?.length >= 2) {
          active = Number(design.breakdownRows[0]?.value) || 0;
          inactive = Number(design.breakdownRows[1]?.value) || 0;
          activeLabel   = design.breakdownRows[0]?.label || activeLabel;
          inactiveLabel = design.breakdownRows[1]?.label || inactiveLabel;
        }
        if (design.badgeText) badgeText = design.badgeText;
        if (design.badgeColor && design.badgeColor !== 'none') badgeColor = design.badgeColor;
      } catch { /* ignore bad JSON */ }
    }

    return { id: String(widget.id), title, value, accent, icon, active, inactive, activeLabel, inactiveLabel, badgeText, badgeColor, designJson: widget.designJson, categoryName: widget.categoryName };
  }

  private readonly tilePreviewRequests = new Map<string, Observable<string>>();
  /** Cancels a tile's previous in-flight preview request so a stale (pre-filter-change) response
   *  can never arrive later and overwrite a fresher one with outdated data. */
  private readonly tilePreviewCancel = new Map<string, Subject<void>>();
  private readonly loadedBreakdownKeys = new Set<string>();
  /** Live breakdown row values per tile id, overlaying the static values saved in designJson. */
  private tileBreakdownValues: Record<string, { label: string; value: string; color?: string }[]> = {};

  /** Loads a single tile's KPI value on demand when its card scrolls into view. */
  onTileVisible(tile: TileSelectorItem): void { this.loadTilePreview(tile); }

  private loadTilePreview(tile: TileSelectorItem): void {
    if (!tile.designJson) return;
    const key = JSON.stringify([tile.id, tile.designJson]);
    let design: any;
    try { design = JSON.parse(tile.designJson); } catch { return; }
    const source = design.source ?? '';
    const sourceType = design.sourceType ?? 'Table';

    const viewId = design.viewId ?? 0;
    const isView = (design.dataSourceMode === 'view' || sourceType.toLowerCase() === 'view') && viewId > 0;
    if (!source && !isView) return;

    this.loadTileBreakdownValues(tile.id, key, design.breakdownRows ?? []);

    let request$ = this.tilePreviewRequests.get(key);
    if (!request$) {
      const value$ = !isView && sourceType.toLowerCase() === 'table'
        ? this.getTileAggregate(source, design)
            .pipe(map(res => this.formatTileNumber(res.value ?? 0, design)))
        : (isView
            ? this.commonApi.getDatabaseViewById(viewId).pipe(
                switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: this.injectGlobalFilterParams(view.generatedSql), viewId: view.id, maxRows: 1000 })),
              )
            : this.widgetService.getTableData(source, sourceType)
          ).pipe(map(res => this.computeTileValue(this.applyGlobalRowFilter(res.rows ?? []), design)));
      request$ = value$.pipe(takeUntil(this.destroy$), shareReplay({ bufferSize: 1, refCount: true }));
      this.tilePreviewRequests.set(key, request$);
    }
    this.tilePreviewCancel.get(tile.id)?.next();
    const cancel$ = new Subject<void>();
    this.tilePreviewCancel.set(tile.id, cancel$);
    request$.pipe(takeUntil(cancel$), takeUntil(this.destroy$)).subscribe({
      next: value => { tile.value = value; this.cdr.markForCheck(); },
      error: () => {
        this.tilePreviewRequests.delete(key);
        if (design.daxModel?.enabled) { tile.value = 'DAX error'; this.cdr.markForCheck(); }
      },
    });
  }

  /** Re-fetches each breakdown row's "1st value" live, honoring Cluster/Plant for view sources. */
  private loadTileBreakdownValues(tileId: string, key: string, rawRows: { label?: string; value?: unknown; color?: string; sourceName?: string; sourceType?: string; column?: string }[]): void {
    const rows = rawRows.filter(row => row && (row.label || (row.value !== undefined && row.value !== '')));
    this.tileBreakdownValues[tileId] = rows.map(row => ({ label: row.label || 'Component', value: String(row.value ?? ''), color: row.color }));
    if (this.loadedBreakdownKeys.has(key)) return;
    this.loadedBreakdownKeys.add(key);
    rows.forEach((row, i) => {
      if (!row.sourceName || !row.column) return;
      const sourceType = row.sourceType ?? 'Table';
      const isView = sourceType.toLowerCase() === 'view';
      const value$ = isView
        ? this.commonApi.getDatabaseViews('view').pipe(
            switchMap(views => {
              const view = views.find(v => v.viewName === row.sourceName);
              if (!view) return of(0);
              return this.commonApi.getDatabaseViewById(view.id).pipe(
                switchMap(detail => this.commonApi.previewView({ connectionId: detail.connectionId, sql: this.injectGlobalFilterParams(detail.generatedSql), viewId: detail.id, maxRows: 1000 })),
                map(res => Number(this.applyGlobalRowFilter(res.rows ?? [])[0]?.[row.column!] ?? 0) || 0),
              );
            }),
            catchError(() => of(0)),
          )
        : this.commonApi.getBreakdownValue(row.sourceName!, sourceType, row.column!);
      value$.pipe(takeUntil(this.destroy$)).subscribe(v => {
        const list = this.tileBreakdownValues[tileId];
        if (list?.[i]) { list[i] = { ...list[i], value: String(Math.round(v * 100) / 100) }; this.cdr.markForCheck(); }
      });
    });
  }

  private computeTileValue(rows: Record<string, unknown>[], design: any): string {
    const daxValue = evaluateTileDaxValue(rows, design.daxModel);
    if (daxValue !== undefined) return this.formatTileNumber(daxValue, design);
    const aggregation = design.aggregation ?? 'count';
    const valueField = design.valueField ?? '';
    let result: number;
    if (aggregation === 'count' && valueField) {
      const resolved = rows.length ? this.resolveCol(rows[0], valueField) : valueField;
      result = rows.filter(r => { const v = r[resolved]; return v !== null && v !== undefined && v !== ''; }).length;
    } else if (aggregation === 'count' || !valueField) {
      result = rows.length;
    } else {
      const resolved = rows.length ? this.resolveCol(rows[0], valueField) : valueField;
      if (aggregation === 'value') {
        result = Number(rows[0]?.[resolved] ?? 0) || 0;
      } else if (aggregation === 'countDistinct') {
        result = new Set(rows.map(r => r[resolved]).filter(v => v !== null && v !== undefined && v !== '')).size;
      } else {
        const nums = rows.map(r => Number(r[resolved] ?? 0)).filter(n => !Number.isNaN(n));
        if (aggregation === 'total') result = nums.reduce((a, b) => a + b, 0);
        else if (aggregation === 'average') result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else result = rows.length;
      }
    }
    return this.formatTileNumber(result, design);
  }

  private formatTileNumber(result: number, design: any): string {
    if (design.daxModel?.enabled) return `${design.prefix ?? ''}${formatDaxValue(result, getSelectedDaxMeasure(design.daxModel))}${design.suffix ?? ''}`;
    const places = Number(design.decimalPlaces) || 0;
    const shorten = design.shortenBigNumbers ?? false;
    let formatted = result.toFixed(places);
    if (shorten && result >= 1_000_000) formatted = (result / 1_000_000).toFixed(1) + 'M';
    else if (shorten && result >= 1000) formatted = (result / 1000).toFixed(1) + 'K';
    return `${design.prefix ?? ''}${formatted}${design.suffix ?? ''}`;
  }

  private getTileAggregate(source: string, design: any) {
    if (design.daxModel?.enabled) {
      return this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
        filters: this.globalHierarchyFilterPayload(false), fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
        aggregation: design.aggregation ?? 'count', daxModel: design.daxModel,
      }).pipe(map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })));
    }
    return this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation: design.aggregation ?? 'count', valueField: design.valueField || undefined });
  }
  getTileBreakdownRows(tile: TileSelectorItem): { label: string; value: string; color?: string }[] {
    if (this.tileBreakdownValues[tile.id]) return this.tileBreakdownValues[tile.id];
    if (!tile.designJson) return [];
    try {
      const design = JSON.parse(tile.designJson) as { breakdownRows?: { label?: string; value?: unknown; color?: string }[] };
      return (design.breakdownRows ?? [])
        .filter(row => row && (row.label || row.value !== undefined && row.value !== ''))
        .map(row => ({ label: row.label || 'Component', value: String(row.value ?? ''), color: row.color }));
    } catch {
      return [];
    }
  }

  /** Maps a tile's configured color (breakdown row or badge) to its display hex, matching Tile Builder's own preview. */
  tileColorHex(color: string | undefined, fallback = '#344054'): string {
    const map: Record<string, string> = {
      blue: '#2563EB', green: '#16A34A', red: '#DC2626', amber: '#D97706', teal: '#0D9488',
    };
    return (color && map[color]) || fallback;
  }

  /** Badge background, matching Tile Builder's own preview color scheme. */
  tileBadgeBackground(color: string | undefined): string {
    const map: Record<string, string> = { red: '#FEE2E2', green: '#DCFCE7', orange: '#FFEDD5', blue: '#DBEAFE' };
    return (color && map[color]) || '#F3F4F6';
  }

  /** Badge text color, matching Tile Builder's own preview color scheme. */
  tileBadgeColor(color: string | undefined): string {
    const map: Record<string, string> = { red: '#DC2626', green: '#16A34A', orange: '#EA580C', blue: '#2563EB' };
    return (color && map[color]) || '#374151';
  }

  get selectedTilesCount(): number { return this.selectedTileIds.size; }

  isTileSelected(id: string): boolean { return this.selectedTileIds.has(id); }

  /** True when this tile already occupies a slot on the dashboard (prevents adding duplicates). */
  isTileOnDashboard(id: string): boolean {
    return [...this.tileSlots, ...this.chartSlotsData].some(item => item && this.isTileItem(item) && item.id === id);
  }

  /** Rebuilds selected ids from current slot contents (cross-row: tile can live in chartSlotsData and vice versa)
   *  so checkboxes reflect items already placed on the board when the modal reopens. */
  private syncTileSelectionFromSlots(): void {
    this.selectedTileIds.clear();
    [...this.tileSlots, ...this.chartSlotsData].forEach(item => {
      if (item && this.isTileItem(item)) this.selectedTileIds.add(String(item.id));
    });
  }

  private syncChartSelectionFromSlots(): void {
    this.selectedChartIds.clear();
    [...this.tileSlots, ...this.chartSlotsData].forEach(item => {
      if (item && this.isChartItem(item)) this.selectedChartIds.add(String(item.id));
    });
  }

  toggleTileSelection(id: string): void {
    this.selectedTileIds.has(id) ? this.selectedTileIds.delete(id) : this.selectedTileIds.add(id);
    this.cdr.markForCheck();
  }

  clearTileSelection(): void { this.selectedTileIds.clear(); this.cdr.markForCheck(); }

  closeTilesModal(): void {
    this.showTilesModal = false;
    this.activePanel = null;
    this.tilesSearchTerm = '';
    this.cdr.markForCheck();
  }

  addTilesToDashboard(): void {
    const before = this.captureBoardSnapshot();
    this.tileSlots = this.tileSlots.filter(item => !item || !this.isTileItem(item) || this.selectedTileIds.has(item.id));
    this.chartSlotsData = this.chartSlotsData.filter(item => !item || !this.isTileItem(item) || this.selectedTileIds.has(item.id));
    const allTiles = [...this.standardTiles, ...this.myTiles];
    const selected = allTiles.filter(t => this.selectedTileIds.has(t.id) && !this.isTileOnDashboard(t.id));

    for (const tile of selected) {
      const emptyIdx = this.tileSlots.indexOf(null);
      if (emptyIdx !== -1) this.tileSlots[emptyIdx] = tile;
      else this.tileSlots.push(tile);
      // Ensure a value exists for the placed tile even if its card was never scrolled to.
      this.loadTilePreview(tile);
    }

    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.selectedTileIds.clear();
    this.closeTilesModal();
  }

  removeTileFromSlot(index: number): void {
    const before = this.captureBoardSnapshot();
    this.tileSlots.splice(index, 1);
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.cdr.markForCheck();
  }

  /** Removes an unused (empty) tile slot from the grid entirely, shrinking the row. */
  removeEmptyTileSlot(index: number): void {
    const before = this.captureBoardSnapshot();
    this.tileSlots.splice(index, 1);
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.cdr.markForCheck();
  }

  // ── Charts modal ──────────────────────────────────────────
  showChartsModal = false;
  chartsModalTab: 'standard' | 'my' = 'standard';
  chartsSearchTerm = '';
  selectedChartIds = new Set<string>();
  chartsLoading = false;

  standardCharts: ChartSelectorItem[] = [];
  myCharts: ChartSelectorItem[] = [];

  private mapWidgetToChartItem(widget: WidgetLibraryItem): ChartSelectorItem {
    let chartType = 'Pie';
    let design: Record<string, unknown> | undefined;
    if (widget.designJson) {
      try {
        design = JSON.parse(widget.designJson);
        if (design?.['chartType']) chartType = design['chartType'] as string;
      } catch { /* ignore */ }
    }
    return {
      id: String(widget.id),
      title: appendLockedFilterTitle(widget.name, design),
      description: widget.categoryName || widget.source || '',
      chartType,
      source: widget.source,
      sourceType: widget.sourceType,
      designJson: widget.designJson,
      categoryName: widget.categoryName,
    };
  }

  private matchesChartsFilter(c: ChartSelectorItem): boolean {
    const term = this.chartsSearchTerm.toLowerCase();
    return (!term || c.title.toLowerCase().includes(term)) &&
      (this.chartsCategoryFilter === 'all' || c.categoryName === this.chartsCategoryFilter);
  }

  get filteredCharts(): ChartSelectorItem[] {
    const source = this.chartsModalTab === 'standard' ? this.standardCharts : this.myCharts;
    const result = source.filter(c => this.matchesChartsFilter(c));
    return [...result].sort((a, b) => this.chartsSortOption === 'name-asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
  }

  // Tab badges: same search/category filter as filteredCharts, but each counts its OWN tab's
  // source regardless of which tab is active, so the count never contradicts what that tab would show.
  get standardChartsCount(): number { return this.standardCharts.filter(c => this.matchesChartsFilter(c)).length; }
  get myChartsCount(): number { return this.myCharts.filter(c => this.matchesChartsFilter(c)).length; }

  chartsCategoryFilter = 'all';
  chartsSortOption: 'name-asc' | 'name-desc' = 'name-asc';
  showChartsCategoryDropdown = false;
  showChartsSortDropdown = false;

  get chartCategoryOptions(): string[] {
    const source = this.chartsModalTab === 'standard' ? this.standardCharts : this.myCharts;
    return [...new Set(source.map(c => c.categoryName).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  }

  get chartsCategoryLabel(): string { return this.chartsCategoryFilter === 'all' ? 'All Category' : this.chartsCategoryFilter; }
  get chartsSortLabel(): string { return this.chartsSortOption === 'name-asc' ? 'Name (A-Z)' : 'Name (Z-A)'; }

  toggleChartsCategoryDropdown(event: Event): void {
    event.stopPropagation();
    const opening = !this.showChartsCategoryDropdown;
    this.showTilesCategoryDropdown = false;
    this.showTilesSortDropdown = false;
    this.showChartsCategoryDropdown = false;
    this.showChartsSortDropdown = false;
    if (opening) { this.showChartsCategoryDropdown = true; }
  }

  selectChartsCategory(cat: string): void {
    this.chartsCategoryFilter = cat;
    this.showChartsCategoryDropdown = false;
  }

  toggleChartsSortDropdown(event: Event): void {
    event.stopPropagation();
    const opening = !this.showChartsSortDropdown;
    this.showTilesCategoryDropdown = false;
    this.showTilesSortDropdown = false;
    this.showChartsCategoryDropdown = false;
    this.showChartsSortDropdown = false;
    if (opening) { this.showChartsSortDropdown = true; }
  }

  selectChartsSort(opt: 'name-asc' | 'name-desc'): void {
    this.chartsSortOption = opt;
    this.showChartsSortDropdown = false;
  }

  chartPreviewOptions: Record<string, Highcharts.Options> = {};
  advancedCharts: Record<string, AdvancedChartPayload> = {};
  chartPreviewLoading: Record<string, boolean> = {};
  chartPreviewErrors: Record<string, string> = {};
  chartTrendModes: Record<string, TrendMode> = {};
  trendChartPreviews: Record<string, boolean> = {};
  private chartAggData: Record<string, { cats: string[]; vals: number[]; title: string; seriesName?: string; multiSeries?: Highcharts.SeriesOptionsType[]; tableHeaders?: string[]; tableRows?: (string | number)[][] }> = {};
  private chartDesigns: Record<string, any> = {};
  private chartTableCache: Record<string, { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] }> = {};
  private defaultChartType: Record<string, ChartView> = {};
  private defaultChartOptions: Record<string, Highcharts.Options> = {};
  /** Per-chart "Show Data Labels" preference (default true) so board re-renders honour the saved flag. */
  private chartShowDataLabels: Record<string, boolean> = {};

  /** True once a chart preview has actually resolved data to draw (not just an empty options object). */
  hasChartPreviewData(chartId: string): boolean {
    if (this.advancedCharts[chartId]) return true;
    const agg = this.chartAggData[chartId];
    if (!agg) return false;
    return agg.cats.length > 0 || (agg.multiSeries?.length ?? 0) > 0;
  }

  private readonly loadedChartPreviewIds = new Set<string>();
  /** Cancels a chart's previous in-flight preview request so a stale (pre-filter-change) response
   *  can never arrive later and overwrite a fresher one with outdated data. */
  private readonly chartPreviewCancel = new Map<string, Subject<void>>();
  private readonly chartLocalFilters = new WeakMap<ChartSelectorItem, {
    designJson?: string;
    filters: ChartLocalFilter[];
  }>();

  getChartLocalFilters(chart: ChartSelectorItem): ChartLocalFilter[] {
    const cached = this.chartLocalFilters.get(chart);
    if (cached && cached.designJson === chart.designJson) return cached.filters;
    let design: any;
    try { design = JSON.parse(chart.designJson ?? '{}'); } catch { design = {}; }
    const filters: ChartLocalFilter[] = (chart.presetColumn ? [] : (design.interactiveFilters ?? []))
      .filter((filter: { sourceColumn?: string }) => !!filter.sourceColumn)
      .map((filter: { label?: string; sourceTable?: string; sourceColumn: string; controlType: string; hidden?: boolean; locked?: boolean; lockedValue?: string; lockedValues?: string[] }) => ({
        label: filter.label || filter.sourceColumn,
        sourceTable: filter.sourceTable || design.source || chart.source,
        sourceColumn: filter.sourceColumn,
        controlType: filter.controlType,
        hidden: !!filter.hidden,
        locked: !!filter.locked,
        value: filter.locked ? (filter.lockedValue ?? '') : '',
        values: filter.locked ? [...(filter.lockedValues ?? [])] : [] as string[],
        options: filter.locked ? [...(filter.lockedValues ?? (filter.lockedValue ? [filter.lockedValue] : []))] : [] as string[],
      }));
    if (!chart.presetColumn) {
      filters.push(...((design.conditionalFilters ?? []) as SavedConditionalFilter[])
        .filter(filter => !!filter.sourceColumn)
        .map(filter => ({
          ...filter,
          label: filter.label || filter.sourceColumn,
          sourceTable: filter.sourceTable || design.source || chart.source,
          controlType: 'MultiSelect',
          hidden: !!filter.hidden,
          locked: false,
          value: '',
          values: [...(filter.values ?? [])],
          options: [...(filter.values ?? [])],
          conditional: true,
        })));
    }
    this.chartLocalFilters.set(chart, { designJson: chart.designJson, filters });
    for (const filter of filters) {
      if (filter.hidden || filter.locked || !['Dropdown', 'MultiSelect'].includes(filter.controlType)) continue;
      this.widgetService.getTableData(filter.sourceTable, 'Table').pipe(
        catchError(() => this.widgetService.getTableData(filter.sourceTable, 'View')),
        takeUntil(this.destroy$),
      ).subscribe({
        next: result => {
          const rows = result.rows ?? [];
          const column = rows.length ? this.resolveCol(rows[0], filter.sourceColumn) : filter.sourceColumn;
          filter.options = [...new Set([...filter.values, ...rows.map(row => String(row[column] ?? '')).filter(value => value !== '')])]
            .sort((left, right) => left.localeCompare(right));
          this.cdr.markForCheck();
        },
        error: () => this.cdr.markForCheck(),
      });
    }
    return filters;
  }

  hasVisibleChartLocalFilters(chart: ChartSelectorItem): boolean {
    return this.getChartLocalFilters(chart).some(filter => !filter.hidden);
  }

  setChartLocalFilter(chart: ChartSelectorItem): void {
    this.loadedChartPreviewIds.delete(chart.id);
    this.loadChartPreview(chart);
  }

  /** Loads a single chart's preview on demand when its card scrolls into view. */
  onChartVisible(chart: ChartSelectorItem): void { this.loadChartPreview(chart); }

  private loadChartPreview(chart: ChartSelectorItem): void {
    if (this.loadedChartPreviewIds.has(chart.id)) return;
    delete this.chartPreviewErrors[chart.id];
    if (!chart.designJson || !chart.source) {
      this.chartPreviewErrors[chart.id] = 'Chart source or design is missing.';
      return;
    }
    this.loadedChartPreviewIds.add(chart.id);
    this.chartPreviewLoading[chart.id] = true;
    let design: any;
    try { design = JSON.parse(chart.designJson); } catch {
      this.chartPreviewLoading[chart.id] = false;
      this.chartPreviewErrors[chart.id] = 'Chart design could not be read.';
      this.loadedChartPreviewIds.delete(chart.id);
      return;
    }

    const source = design.source ?? chart.source;
    const sourceType = design.sourceType ?? chart.sourceType ?? 'Table';
    const viewId = design.viewId ?? 0;
    const isView = (design.dataSourceMode === 'view' || sourceType.toLowerCase() === 'view') && viewId > 0;
    const isTrend = TREND_CHART_TYPES.has(design.chartType);
    this.trendChartPreviews[chart.id] = isTrend;
    this.chartTrendModes[chart.id] ??= design.trendMode ?? 'monthly';

    const chartFilters = this.getChartLocalFilters(chart);
    const clonePlant = !!chart.presetColumn && isPlantFilter((design.interactiveFilters ?? [])
      .find((filter: { sourceColumn?: string }) => filter.sourceColumn === chart.presetColumn) ?? { sourceColumn: chart.presetColumn });
    if (!chart.presetColumn) {
      design.conditionalFilters = chartFilters.filter(filter => filter.conditional);
    }
    const localFilters = mergeDashboardSharedFilters(
      chartFilters.filter(filter => !filter.conditional && !filter.locked),
      this.customFilters,
    ).map(filter => ({
      sourceTable: filter.sourceTable,
      sourceColumn: filter.sourceColumn,
      controlType: filter.controlType,
      label: filter.label,
      value: filter.value,
      values: filter.values,
    })).filter(filter => filter.value || filter.values.length);
    const serverFilters = localFilters.filter(filter =>
      filter.sourceTable.toLowerCase() !== source.toLowerCase());

    let data$;
    if (serverFilters.length) {
      data$ = this.widgetService.getFilteredChartData({
        chartSource: source, chartSourceType: sourceType, viewId: isView ? viewId : null,
        filters: [...serverFilters, ...this.globalHierarchyFilterPayload(isView)],
        fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
        ...(isTrend ? { mode: this.chartTrendModes[chart.id] } : {}),
      });
    } else if (isView && chart.presetColumn) {
      const filter = (design.interactiveFilters ?? []).find((candidate: { sourceColumn?: string }) =>
        candidate.sourceColumn?.toLowerCase() === chart.presetColumn!.toLowerCase());
      data$ = this.widgetService.getFilteredChartData({
        chartSource: source,
        chartSourceType: sourceType,
        viewId,
        filters: [{
          sourceTable: filter?.sourceTable || source,
          sourceColumn: chart.presetColumn,
          controlType: filter?.controlType || 'Dropdown',
          label: filter?.label || chart.presetColumn,
          value: chart.presetValue ?? '',
        }, ...this.globalHierarchyFilterPayload(isView).filter(filter => !clonePlant || !isPlantFilter(filter))],
        fromDate: this.fromDate || undefined,
        toDate: this.toDate || undefined,
        ...(isTrend ? { mode: this.chartTrendModes[chart.id] } : {}),
      });
    } else if (isView && isTrend) {
      data$ = this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: sourceType, viewId, filters: this.globalHierarchyFilterPayload(isView), mode: this.chartTrendModes[chart.id], fromDate: this.fromDate || undefined, toDate: this.toDate || undefined });
    } else if (isView) {
      data$ = this.commonApi.getDatabaseViewById(viewId).pipe(
          switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: this.injectGlobalFilterParams(view.generatedSql), viewId: view.id, maxRows: 1000 })),
        );
    } else {
      data$ = this.widgetService.getTableData(source, sourceType);
    }

    this.chartPreviewCancel.get(chart.id)?.next();
    const cancel$ = new Subject<void>();
    this.chartPreviewCancel.set(chart.id, cancel$);
    data$.pipe(takeUntil(cancel$), takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const paramFilters = getSavedParameterFilters(design);
        const activeDesign = remapDesignColumns(design, paramFilters);
        this.chartDesigns[chart.id] = activeDesign;
        const { rows: transformedRows, columns: transformedCols } = applyParameterFilters(this.applyGlobalRowFilter(res.rows ?? [], clonePlant), paramFilters, res.columns ?? []);
        let rows = applyConditionalFilters(transformedRows, getSavedConditionalFilters(activeDesign));
        rows = this.applyLockedInteractiveFilters(rows, activeDesign);
        rows = applyConditionalFilters(rows, localFilters
          .filter(filter => filter.sourceTable.toLowerCase() === source.toLowerCase())
          .map(filter => ({
            sourceColumn: filter.sourceColumn,
            operator: filter.controlType === 'MultiSelect' || filter.controlType === 'Dropdown'
              ? 'equals' : filter.controlType === 'Date' ? 'starts with' : 'contains',
            values: filter.controlType === 'MultiSelect' ? filter.values : [filter.value],
          })));
        if (chart.presetColumn && !isView) {
          const column = rows.length ? this.resolveCol(rows[0], chart.presetColumn) : chart.presetColumn;
          const value = (chart.presetValue ?? '').toLowerCase();
          rows = rows.filter(row => String(row[column] ?? '').toLowerCase() === value);
        }
        const columns = transformedCols;
        const daxMeasures = getActiveDaxMeasures(activeDesign);
        const multiY = activeDesign['multiYColumns'] ?? [];
        const chartType = activeDesign['chartType'] ?? 'bar';
        const specialTypes = ['gauge', 'histogram', 'sankey', 'timeline', 'bullet', 'bubble', 'heatmap'];
        const showDataLabels = activeDesign['showDataLabels'] as boolean | undefined;
        this.chartShowDataLabels[chart.id] = showDataLabels !== false;
        delete this.advancedCharts[chart.id];
        if (isAdvancedChart(chartType)) {
          this.advancedCharts[chart.id] = { type: chartType, rows, config: readAdvancedConfig(activeDesign['advancedConfig']), daxMeasures };
          this.chartAggData[chart.id] = { cats: [], vals: [], title: chart.title };
          this.chartPreviewOptions[chart.id] = {};
        } else if (specialTypes.includes(chartType)) {
          this.chartAggData[chart.id] = { cats: [], vals: [], title: chart.title };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyDataLabelPreference(this.buildSpecialChartOptions(chartType, rows, activeDesign, chart.title), showDataLabels);
        } else if (multiY.length > 0) {
          const { categories, series } = this.buildMultiSeries(rows, activeDesign);
          appendDaxToChartData(daxMeasures, rows, columns, categories, [], series as { data?: unknown }[],
            activeDesign['chartType'] === 'stacked' && activeDesign['showStackTotal'] !== false ? series.length - 1 : -1);
          const xAxis = activeDesign['xAxis'] as string ?? '';
          const tableColumns = multiY.filter((column: string) => column !== xAxis);
          const displayRows = rows.slice(0, 100);
          const tableRows = chartType === 'table'
            ? displayRows.map(row => [
                this.formatTableCell(row[xAxis]),
                ...tableColumns.map((column: string) => this.formatTableCell(row[column])),
              ])
            : undefined;
          // DAX measures as the builder shows them: summary rows (Column) and extra columns (Row).
          if (tableRows) appendDaxToTableRows(daxMeasures, rows, columns, tableRows, tableColumns.length, displayRows.map(row => [row]), tableColumns);
          const rowMeasureHeaders = getDaxRowColumnMeasures(daxMeasures).map(m => m.name?.trim() || 'New Metric');
          this.chartAggData[chart.id] = {
            cats: categories,
            vals: [],
            title: chart.title,
            multiSeries: series,
            tableHeaders: tableRows ? [xAxis || 'Category', ...tableColumns, ...rowMeasureHeaders] : undefined,
            tableRows,
          };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(chartType, categories, [], chart.title, series, activeDesign), activeDesign['sortOrder']), showDataLabels));
        } else {
          const { cats, vals } = this.aggregateChart(rows, activeDesign);
          appendDaxToChartData(daxMeasures, rows, columns, cats, vals);
          this.chartAggData[chart.id] = { cats, vals, title: chart.title, seriesName: (activeDesign['yAxis'] as string) || (activeDesign['yAggColumn'] as string) || 'Value' };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(chartType, cats, vals, chart.title, undefined, activeDesign), activeDesign['sortOrder']), showDataLabels));
        }
        if (!this.cardChartType[chart.id]) this.cardChartType[chart.id] = toChartView(design.chartType);
        this.cardChartTypeOptions[chart.id] = chartSwitchOptions(this.cardChartType[chart.id], design);
        this.defaultChartType[chart.id] = this.cardChartType[chart.id];
        this.defaultChartOptions[chart.id] = this.chartPreviewOptions[chart.id];
        this.chartPreviewLoading[chart.id] = false;
        this.loadInlineTilesForChart(chart.id, (activeDesign['attachedTileIds'] as number[]) ?? [], chart, localFilters);
        this.cdr.markForCheck();
      },
      error: () => {
        this.chartPreviewLoading[chart.id] = false;
        this.chartPreviewErrors[chart.id] = 'Unable to load chart data.';
        this.loadedChartPreviewIds.delete(chart.id);
        this.cdr.markForCheck();
      },
    });
  }

  chartInlineTiles: Record<string, { label: string; value: string; color: string; icon: string; breakdown: { label: string; value: string; color: string }[] }[]> = {};

  /** Accent colors for the attached-tile strip (shared by board slot + Add Charts modal). */
  tileValueColor(color: string): string {
    const map: Record<string, string> = { blue: '#2563EB', green: '#16A34A', red: '#DC2626', amber: '#D97706', teal: '#0D9488' };
    return map[color] ?? '#374151';
  }
  tileBreakdownBg(color: string): string {
    const map: Record<string, string> = { blue: '#DBEAFE', green: '#DCFCE7', red: '#FEE2E2', amber: '#FEF9C3', teal: '#CCFBF1' };
    return map[color] ?? '#F3F4F6';
  }
  tileBreakdownFg(color: string): string {
    const map: Record<string, string> = { blue: '#1D4ED8', green: '#15803D', red: '#B91C1C', amber: '#A16207', teal: '#0F766E' };
    return map[color] ?? '#374151';
  }

  /** Loads a chart's attached KPI tiles so they render above the chart (board slot + Add Charts modal). */
  private loadInlineTilesForChart(chartId: string, tileIds: number[], chart: ChartSelectorItem, localFilters: { sourceTable: string; sourceColumn: string; controlType: string; label: string; value: string; values: string[] }[] = []): void {
    if (!tileIds?.length) { this.chartInlineTiles[chartId] = []; return; }
    // Chart's active local (interactive) filters, forwarded to attached view tiles so they filter with the chart.
    const viewLocalFilters = localFilters.filter(f => f.value || f.values.length);
    const localScopedGlobals = this.globalHierarchyFilterPayload(true).filter(g =>
      !viewLocalFilters.some(l => l.sourceColumn.toLowerCase() === g.sourceColumn.toLowerCase()
        || l.label.toLowerCase() === g.label.toLowerCase()));
    let design: { interactiveFilters?: { sourceColumn?: string; sourceTable?: string; controlType?: string; label?: string }[] } = {};
    try { design = JSON.parse(chart.designJson ?? '{}'); } catch {}
    const preset = design.interactiveFilters?.find(filter =>
      filter.sourceColumn?.toLowerCase() === chart.presetColumn?.toLowerCase());
    type InlineTile = { label: string; value: string; color: string; icon: string; breakdown: { label: string; value: string; color: string }[] };
    const slots: (InlineTile | null)[] = tileIds.map(() => null);
    const rebuild = () => {
      this.chartInlineTiles[chartId] = slots.filter((s): s is InlineTile => s !== null);
      this.cdr.markForCheck();
    };
    tileIds.forEach((tileId, slotIdx) => {
      this.widgetService.getWidgetById(tileId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (tile) => {
          let d: Record<string, unknown> = {};
          try { d = JSON.parse(tile.designJson ?? '{}'); } catch { /* ignore */ }
          const source = (tile.source ?? (d['source'] as string)) ?? '';
          const sourceType = (tile.sourceType ?? (d['sourceType'] as string)) ?? 'Table';
          const label = ((d['title'] as string) || tile.name) ?? '';
          const color = (d['tileColor'] as string) ?? 'blue';
          const icon = (d['tileIcon'] as string) ?? 'well';
          const breakdown = ((d['breakdownRows'] as { label?: string; value?: unknown; color?: string }[]) ?? [])
            .filter(r => r && (r.label || r.value))
            .map(r => ({ label: r.label ?? '', value: String(r.value ?? ''), color: r.color ?? 'blue' }));
          if (!source) { rebuild(); return; }
          const viewId = (tile as { sourceId?: number }).sourceId ?? (d['viewId'] as number) ?? 0;
          const isView = sourceType.toLowerCase() === 'view' && viewId > 0;
          const isTable = sourceType.toLowerCase() === 'table';
          const cloneFilter = chart.presetColumn ? {
            sourceTable: !preset?.sourceTable || preset.sourceTable.toLowerCase() === chart.source.toLowerCase() ? source : preset.sourceTable,
            sourceColumn: chart.presetColumn,
            controlType: preset?.controlType || 'Dropdown',
            label: preset?.label || chart.presetColumn,
            value: chart.presetValue ?? '',
          } : null;
          const value$ = cloneFilter
            ? this.widgetService.getFilteredChartData({
                chartSource: source, chartSourceType: sourceType, viewId: isView ? viewId : null,
                filters: [cloneFilter, ...this.globalHierarchyFilterPayload(isView).filter(filter =>
                  filter.sourceColumn.toLowerCase() !== cloneFilter.sourceColumn.toLowerCase() &&
                  filter.label.toLowerCase() !== cloneFilter.label.toLowerCase())],
                fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
                ...(isTable ? { aggregation: (d['aggregation'] as string) ?? 'count', valueField: (d['valueField'] as string) || undefined, daxModel: d['daxModel'] as DaxModelConfig } : {}),
              }).pipe(map(res => {
                if (isTable) return this.formatTileNumber(Number(res.rows?.[0]?.['Value'] ?? 0), d);
                let rows = res.rows ?? [];
                if (rows.length) {
                  const column = this.resolveCol(rows[0], cloneFilter.sourceColumn);
                  if (column in rows[0]) rows = rows.filter(row =>
                    String(row[column] ?? '').trim().toLowerCase() === cloneFilter.value.trim().toLowerCase());
                }
                return this.computeTileValue(rows, d);
              }))
            : (isView && viewLocalFilters.length)
            ? this.widgetService.getFilteredChartData({
                chartSource: source, chartSourceType: sourceType, viewId,
                filters: [...viewLocalFilters, ...localScopedGlobals],
                fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
              }).pipe(map(res => this.computeTileValue(res.rows ?? [], d)))
            : (!isView && isTable)
            ? this.getTileAggregate(source, d)
                .pipe(map(res => this.formatTileNumber(res.value ?? 0, d)))
            : (isView
                ? this.commonApi.getDatabaseViewById(viewId).pipe(
                    switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: this.injectGlobalFilterParams(view.generatedSql), viewId: view.id, maxRows: 1000 })),
                  )
                : this.widgetService.getTableData(source, sourceType)
              ).pipe(map(res => this.computeTileValue(res.rows ?? [], d)));
          value$.pipe(takeUntil(this.destroy$)).subscribe({
            next: (value) => { slots[slotIdx] = { label, value, color, icon, breakdown }; rebuild(); },
            error: () => {
              if ((d['daxModel'] as DaxModelConfig)?.enabled) slots[slotIdx] = { label, value: 'DAX error', color, icon, breakdown };
              rebuild();
            },
          });
        },
        error: () => { rebuild(); },
      });
    });
  }

  setPreviewTrendMode(chart: ChartSelectorItem, mode: TrendMode): void {
    if (this.chartTrendModes[chart.id] === mode) return;
    this.chartTrendModes[chart.id] = mode;
    this.loadedChartPreviewIds.delete(chart.id);
    delete this.chartPreviewOptions[chart.id];
    this.loadChartPreview(chart);
  }

  trendMenuOpen: Record<string, boolean> = {};

  toggleTrendMenu(id: string, e: Event): void {
    e.stopPropagation();
    const wasOpen = this.trendMenuOpen[id];
    this.trendMenuOpen = {};
    if (!wasOpen) this.trendMenuOpen[id] = true;
    this.cdr.markForCheck();
  }

  selectTrendMode(chart: ChartSelectorItem, mode: TrendMode): void {
    this.trendMenuOpen = {};
    this.controlsPopoverOpen = {};
    this.setPreviewTrendMode(chart, mode);
  }

  @HostListener('document:click')
  closeAllTrendMenus(): void {
    if (Object.keys(this.trendMenuOpen).length) {
      this.trendMenuOpen = {};
      this.cdr.markForCheck();
    }
  }

  // ── Narrow-card combined controls popover ──────────────────
  // Below a width threshold (see the chart-slot container query in the stylesheet) the per-card
  // chart-type dropdown and the trend-period dropdown no longer fit side by side, so both are
  // hidden in favor of a single toggle button that opens one popover holding both pickers.
  controlsPopoverOpen: Record<string, boolean> = {};

  toggleControlsPopover(id: string, e: Event): void {
    e.stopPropagation();
    const wasOpen = this.controlsPopoverOpen[id];
    this.controlsPopoverOpen = {};
    this.chartTypeMenuOpen = {};
    this.trendMenuOpen = {};
    if (!wasOpen) this.controlsPopoverOpen[id] = true;
    this.cdr.markForCheck();
  }

  @HostListener('document:click')
  closeAllControlsPopovers(): void {
    if (Object.keys(this.controlsPopoverOpen).length) {
      this.controlsPopoverOpen = {};
      this.cdr.markForCheck();
    }
  }

  private aggregateChart(rows: Record<string, unknown>[], design: any): { cats: string[]; vals: number[] } {
    const xAxis = design.xAxis ?? '';
    const yAxis = design.yAxis ?? 'Count (F)';
    const aggCol = design.yAggColumn ?? '';
    const isFn = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'].includes(yAxis);
    const col = aggCol || (isFn ? '' : yAxis);
    const grouped = new Map<string, { count: number; nums: number[] }>();

    const resolvedX = rows.length && xAxis ? this.resolveCol(rows[0], xAxis) : xAxis;
    const resolvedCol = rows.length && col ? this.resolveCol(rows[0], col) : col;

    for (const row of rows) {
      const raw = row[resolvedX];
      const key = (raw !== null && raw !== undefined && typeof raw !== 'object') ? `${raw}` : '(empty)';
      if (!grouped.has(key)) grouped.set(key, { count: 0, nums: [] });
      const g = grouped.get(key)!;
      g.count++;
      if (resolvedCol) { const v = Number(row[resolvedCol] ?? 0); g.nums.push(Number.isNaN(v) ? 0 : v); }
    }

    const cats: string[] = [];
    const vals: number[] = [];
    for (const [k, g] of grouped) {
      cats.push(k);
      if (yAxis === 'Count (F)') vals.push(g.count);
      else if (yAxis === 'Sum (F)') vals.push(g.nums.reduce((a, b) => a + b, 0));
      else if (yAxis === 'Average (F)') vals.push(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0);
      else if (yAxis === 'Min (F)') vals.push(g.nums.length ? Math.min(...g.nums) : 0);
      else if (yAxis === 'Max (F)') vals.push(g.nums.length ? Math.max(...g.nums) : 0);
      else vals.push(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) : g.count);
    }

    const limitN = design.topN || 0;
    if (limitN > 0 && cats.length > limitN) {
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => b.v - a.v).slice(0, limitN);
      return { cats: pairs.map(p => p.c), vals: pairs.map(p => p.v) };
    }
    return { cats, vals };
  }

  private resolveCol(row: Record<string, unknown>, name: string): string {
    if (name in row) return name;
    const lower = name.toLowerCase();
    return Object.keys(row).find(k => k.toLowerCase() === lower) ?? name;
  }

  /** Narrows preview rows by any interactive filter locked in the chart builder, mirroring Widget/Dashboard View. */
  private applyLockedInteractiveFilters(rows: Record<string, unknown>[], design: Record<string, unknown>): Record<string, unknown>[] {
    const filters = (design['interactiveFilters'] as { sourceColumn?: string; controlType?: string; locked?: boolean; lockedValue?: string; lockedValues?: string[] }[]) ?? [];
    let out = rows;
    for (const f of filters) {
      if (!f.locked || !f.sourceColumn || !out.length) continue;
      const col = this.resolveCol(out[0], f.sourceColumn);
      // Skip silently if this preview's rows don't have that column (e.g. cross-table filter) rather than wiping all data.
      if (!(col in out[0])) continue;
      let next = out;
      if (f.controlType === 'MultiSelect') {
        if (!f.lockedValues?.length) continue;
        const set = new Set(f.lockedValues.map(v => v.trim().toLowerCase()));
        next = out.filter(r => set.has(String(r[col] ?? '').trim().toLowerCase()));
      } else if (f.lockedValue) {
        const val = f.lockedValue.trim().toLowerCase();
        next = f.controlType === 'Date'
          ? out.filter(r => String(r[col] ?? '').trim().toLowerCase().startsWith(val))
          : out.filter(r => String(r[col] ?? '').trim().toLowerCase().includes(val));
      }
      // Don't let a mismatched/stale locked value blank the whole preview — keep prior rows instead.
      if (next.length) out = next;
    }
    return out;
  }

  /** Applies the saved Top N / Bottom N / "Group as Others" limit to a multi-series category list. */
  private limitMultiSeriesCategories(categories: string[], grouped: Map<string, Record<string, unknown>[]>, allCols: string[], rows: Record<string, unknown>[], design: any): string[] {
    const limitCat = design.limitCategory ?? 'all';
    const wantTop = limitCat === 'top' && (design.topN ?? 0) > 0;
    const wantBottom = limitCat === 'bottom' && (design.bottomN ?? 0) > 0;
    if (!wantTop && !wantBottom) return categories;
    const n = wantTop ? design.topN : design.bottomN;
    if (categories.length <= n) return categories;
    const resolved = allCols.map(c => rows.length ? this.resolveCol(rows[0], c) : c);
    const total = (cat: string) => (grouped.get(cat) ?? []).reduce((s, r) => s + resolved.reduce((cs, rc) => cs + (Number(r[rc]) || 0), 0), 0);
    const pairs = categories.map(c => ({ c, v: total(c) })).sort((a, b) => wantTop ? b.v - a.v : a.v - b.v);
    const kept = pairs.slice(0, n).map(p => p.c);
    const rest = pairs.slice(n).map(p => p.c);
    if ((design.groupRestAsOthers ?? false) && rest.length) {
      grouped.set('Others', rest.flatMap(rc => grouped.get(rc) ?? []));
      return [...kept, 'Others'];
    }
    return kept;
  }

  private buildMultiSeries(rows: Record<string, unknown>[], design: any): { categories: string[]; series: Highcharts.SeriesOptionsType[] } {
    const xAxis = design.xAxis ?? '';
    const resolvedX = rows.length && xAxis ? this.resolveCol(rows[0], xAxis) : xAxis;
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const v = row[resolvedX];
      const key = (v != null && typeof v !== 'object') ? `${v}` : '(empty)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    const categories = [...grouped.keys()];
    const allCols: string[] = [...(design.multiYColumns ?? [])];
    const comboLineCols: string[] = (design as any).comboLineColumns ?? [];
    const hasDualY = comboLineCols.length > 0 && (design.chartType === 'combo' || design.chartType === 'multiline');
    if (hasDualY) {
      for (const col of comboLineCols) {
        if (!allCols.includes(col)) allCols.push(col);
      }
    }
    const limitedCategories = this.limitMultiSeriesCategories(categories, grouped, allCols, rows, design);
    const isStacked = design.chartType === 'stacked';
    const isCombo = design.chartType === 'combo';
    const isGrouped = design.chartType === 'grouped';
    const hcType = (isStacked || isCombo || isGrouped) ? 'column' : (design.chartType === 'area' ? 'area' : 'line');

    const series: Highcharts.SeriesOptionsType[] = allCols.map((col, i) => {
      const resolved = rows.length ? this.resolveCol(rows[0], col) : col;
      const isLineSeries = isCombo && comboLineCols.includes(col);
      const isRightAxis = hasDualY && comboLineCols.includes(col);
      const s: any = {
        type: isLineSeries ? 'line' : hcType, name: col,
        data: limitedCategories.map(cat => {
          const catRows = grouped.get(cat) ?? [];
          const nums = catRows.map(r => Number(r[resolved] ?? 0)).filter(n => !Number.isNaN(n));
          return nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
        }),
        color: getSeriesColorByName(col, i),
        stacking: (isStacked || (isCombo && !isLineSeries)) ? 'normal' as any : undefined,
        marker: { enabled: true },
      };
      if (hasDualY) { s.yAxis = isRightAxis ? 1 : 0; }
      return s as Highcharts.SeriesOptionsType;
    });

    if (isStacked && design.showStackTotal !== false) {
      const totals = limitedCategories.map((_cat, ci) =>
        series.reduce((sum, s) => sum + (((s as any).data as number[])[ci] ?? 0), 0)
      );
      series.push({
        type: 'line' as any, name: 'Total', data: totals, color: '#374151',
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600' } } as any,
      });
    }

    return { categories: limitedCategories, series };
  }

  private mapDesignChartType(type?: string): ChartView {
    return toChartView(type);
  }

  chartViewLabel(view: string): string { return chartViewLabel(view as ChartView); }
  chartViewIcon(view: string): ChartViewIcon { return chartViewIcon(view as ChartView); }

  private static readonly ICON_CASE: Record<ChartViewIcon, string> = {
    pie: 'Pie', donut: 'Doughnut', bar: 'Bar', line: 'Line', trend: 'Trend', combo: 'Combo', grouped: 'Grouped', table: 'Table',
  };
  /** Maps a chart view to the existing icon case label used by the template ngSwitch blocks. */
  chartIconCase(view: string): string { return BoardBuilderComponent.ICON_CASE[chartViewIcon(view as ChartView)]; }
  /** The effective chart type of a selector card (user selection, else its saved default). */
  resolvedCardType(chart: ChartSelectorItem): ChartView { return this.cardChartType[chart.id] ?? toChartView(chart.chartType); }

  private colorOverrideFor(category: string, design: any, seriesName = ''): string | undefined {
    const overrides = design?.colorOverrides as Record<string, string> | undefined;
    if (!overrides) return undefined;
    const names = [seriesName, design?.yAggColumn, design?.yAxis, '']
      .filter((name, index, all) => name !== undefined && name !== null && all.indexOf(name) === index);
    for (const name of names) {
      const color = overrides[`${name}:${category}`];
      if (color) return color;
    }
    return undefined;
  }

  private colorAssignmentFor(category: string, design: any, seriesName = ''): string | undefined {
    return design?.colorAssignments?.[`${seriesName}:${category}`];
  }

  private categoryColorFor(category: string, design: any, seriesName = ''): string | undefined {
    const usesSeriesCategory = usesSeriesCategoryColorRules(design?.chartType, design?.xAxis);
    const normalizedCategory = (usesSeriesCategory ? seriesName : category).trim().toLowerCase();
    return (design?.colorRules ?? []).find((rule: any) => String(rule.field ?? '').trim().toLowerCase() === 'category'
      && (rule.categories ?? []).some((selected: string) => selected.trim().toLowerCase() === normalizedCategory))?.color;
  }

  private matchesColorRule(raw: unknown, operator: string, expected: string, expectedUpper?: string): boolean {
    const actualText = String(raw ?? '').trim();
    const expectedText = expected.trim();
    const actualNumber = Number(actualText);
    const expectedNumber = Number(expectedText);
    const upperNumber = Number(expectedUpper?.trim());
    const numeric = actualText !== '' && expectedText !== '' && Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
    switch (operator) {
      case '>=': return numeric && actualNumber >= expectedNumber;
      case '<=': return numeric && actualNumber <= expectedNumber;
      case '>': return numeric && actualNumber > expectedNumber;
      case '<': return numeric && actualNumber < expectedNumber;
      case 'Between': return numeric && Number.isFinite(upperNumber) && actualNumber >= Math.min(expectedNumber, upperNumber) && actualNumber <= Math.max(expectedNumber, upperNumber);
      case 'Not Equal': return actualText.toLowerCase() !== expectedText.toLowerCase();
      case 'Equal':
      case 'equals': return numeric ? actualNumber === expectedNumber : actualText.toLowerCase() === expectedText.toLowerCase();
      default: return false;
    }
  }

  private colorForRule(category: string, value: number, design: any, seriesName = '', includeCategoryRule = true): string | undefined {
    const rules = design?.colorRules ?? [];
    const xField = design?.xAxis ?? '';
    const yField = design?.yAggColumn ?? design?.yAxis ?? '';
    for (const rule of rules) {
      const field = String(rule.field ?? '').trim().toLowerCase();
      if (field === 'category') {
        if (!includeCategoryRule) continue;
        const usesSeriesCategory = usesSeriesCategoryColorRules(design?.chartType, design?.xAxis);
        const target = usesSeriesCategory ? seriesName : category;
        if ((rule.categories ?? []).some((selected: string) => selected.trim().toLowerCase() === target.trim().toLowerCase())) return rule.color;
        continue;
      }
      const candidates: unknown[] = [category, value];
      if (field === xField.toLowerCase() || field === String(design?.xAxisTitle ?? '').toLowerCase()) candidates.splice(1, 1);
      else if (field === yField.toLowerCase() || field === String(design?.yAxisTitle ?? '').toLowerCase() || field === seriesName.toLowerCase()) candidates.splice(0, 1);
      if (rule.operator === 'Between' && this.matchesColorRule(value, rule.operator, rule.value, rule.value2)) return rule.color;
      if (candidates.some(candidate => this.matchesColorRule(candidate, rule.operator, rule.value, rule.value2))) return rule.color;
    }
    return undefined;
  }

  private fallbackColor(seed: string, index: number): string {
    return chartFallbackColor(seed, index);
  }

  private pointColor(category: string, value: number, design: any, index: number, seriesName = '', includeCategoryRule = true): string {
    return this.pointColorOverride(category, value, design, seriesName, true, includeCategoryRule)
      ?? this.fallbackColor(`${seriesName}:${category}`, index);
  }

  private pointColorOverride(
    category: string, value: number, design: any, seriesName = '', includeAssignment = true, includeCategoryRule = true,
  ): string | undefined {
    return (includeCategoryRule ? this.categoryColorFor(category, design, seriesName) : undefined)
      ?? this.colorOverrideFor(category, design, seriesName)
      ?? this.colorForRule(category, value, design, seriesName, includeCategoryRule)
      ?? (includeAssignment ? this.colorAssignmentFor(category, design, seriesName) : undefined);
  }

  private applyColorRulesToSeries(series: Highcharts.SeriesOptionsType[], cats: string[], design: any, preserveSeriesColor = false): Highcharts.SeriesOptionsType[] {
    return (series as any[]).map(item => {
      const lineCategoryColor = usesPeriodLineCategoryColorRules(design?.chartType, design?.xAxis, item.type)
        ? this.categoryColorFor('', design, item.name) : undefined;
      return {
      ...item,
      color: lineCategoryColor ?? item.color,
      data: Array.isArray(item.data) ? item.data.map((raw: any, index: number) => {
        const value = typeof raw === 'number' ? raw : Number(raw?.y ?? raw?.value ?? 0);
        const category = cats[index] ?? raw?.name ?? '';
        if (lineCategoryColor) {
          const override = this.pointColorOverride(category, value, design, item.name, false, false);
          const originalColor = typeof raw === 'object' ? raw.color : undefined;
          if (override) return { ...(typeof raw === 'object' ? raw : { y: raw }), color: override };
          const point = typeof raw === 'object' ? raw : { y: raw };
          return {
            ...point,
            color: originalColor ?? this.pointColor(category, value, design, index, item.name, false),
          };
        }
        if (preserveSeriesColor) {
          const override = this.pointColorOverride(category, value, design, item.name, false);
          return override ? { ...(typeof raw === 'object' ? raw : { y: raw }), color: override } : raw;
        }
        const point = typeof raw === 'object' ? raw : { y: raw };
        return { ...point, color: this.pointColor(category, value, design, index, item.name) };
      }) : item.data,
      } as Highcharts.SeriesOptionsType;
    });
  }

  private buildChartOptions(chartType: string, cats: string[], vals: number[], title: string, multiSeries?: Highcharts.SeriesOptionsType[], design?: any): Highcharts.Options {
    if (chartType === 'funnel') return buildFunnelOptions(cats, vals, cats.map((category, index) => this.pointColor(category, vals[index] ?? 0, design, index, design?.yAxis ?? 'Value')), 220, title, false);
    const hasMulti = multiSeries && multiSeries.length > 0;
    const preserveSeriesColor = chartType === 'stacked' || chartType === 'grouped' || chartType === 'combo';
    const series = hasMulti
      ? this.applyColorRulesToSeries(this.seriesForView(chartType as ChartView, multiSeries!, design), cats, design, preserveSeriesColor)
      : undefined;
    const showAxis = design?.showAxisTitle as boolean | undefined;
    const xTitle = showAxis ? ((design?.xAxisTitle as string) || undefined) : undefined;
    const yTitle = showAxis ? ((design?.yAxisTitle as string) || undefined) : undefined;
    const legendStyle: Highcharts.LegendOptions = {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      layout: 'horizontal',
      itemStyle: { fontSize: '11px', fontWeight: '400', color: '#344054' },
      symbolRadius: 6,
      itemMarginBottom: 4,
    };

    if (chartType === 'pie' || chartType === 'donut') {
      return {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
        plotOptions: { pie: { innerSize: chartType === 'donut' ? '55%' : '0%', borderWidth: 2, borderColor: '#fff', showInLegend: false, dataLabels: { enabled: true, distance: -28, format: '{point.y}', style: { color: '#fff', fontWeight: '700', fontSize: '11px', textOutline: 'none' } } } },
        series: [{ type: 'pie', name: title, data: cats.map((c, i) => ({ name: c, y: vals[i], color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') })).filter(d => d.y !== 0) }],
      };
    }

    const axes: Highcharts.Options = {
      xAxis: { categories: cats, title: { text: xTitle }, labels: { style: { fontSize: '10px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6', endOnTick: false, maxPadding: 0.05 },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
    };

    if (chartType === 'line' || chartType === 'multiline' || chartType === 'spline') {
      const hcType = chartType === 'spline' ? 'spline' : 'line';
      const hasDualY = hasMulti && series!.some((s: any) => s.yAxis === 1);
      const seriesName = design?.yAggColumn ?? design?.yAxis ?? 'Value';
      const lineCategoryColor = usesPeriodLineCategoryColorRules(chartType, design?.xAxis, hcType)
        ? this.categoryColorFor('', design, seriesName) : undefined;
      const opts: Highcharts.Options = {
        chart: { type: hcType, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        ...axes,
        plotOptions: { [hcType]: { marker: { radius: 3 }, dataLabels: { enabled: false } } },
        series: hasMulti ? series : [{ type: hcType, name: title, color: lineCategoryColor, data: vals.map((value, i) => ({
          y: value, color: this.pointColor(cats[i] ?? '', value, design, i, seriesName, !lineCategoryColor),
        })), showInLegend: false }],
      };
      if (hasDualY) {
        opts.yAxis = [
          { title: { text: undefined }, gridLineColor: '#F1F3F6', endOnTick: false, maxPadding: 0.05 },
          { title: { text: undefined }, opposite: true, gridLineWidth: 0, endOnTick: false, maxPadding: 0.05 },
        ];
        opts.tooltip = { shared: true };
      }
      return opts;
    }

    if (chartType === 'trend' || chartType === 'area') {
      const seriesName = design?.yAggColumn ?? design?.yAxis ?? 'Value';
      const lineCategoryColor = usesPeriodLineCategoryColorRules(chartType, design?.xAxis, 'areaspline')
        ? this.categoryColorFor('', design, seriesName) : undefined;
      return {
        chart: { type: 'areaspline', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        ...axes,
        plotOptions: { areaspline: { fillOpacity: 0.15, marker: { radius: 3 }, dataLabels: { enabled: false } } },
        series: hasMulti ? series : [{ type: 'areaspline', name: title, color: lineCategoryColor, data: vals.map((value, i) => ({
          y: value, color: this.pointColor(cats[i] ?? '', value, design, i, seriesName, !lineCategoryColor),
        })), showInLegend: false }],
      };
    }

    if (chartType === 'treemap') {
      return {
        chart: { type: 'treemap' as any, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        series: [{
          type: 'treemap' as any, name: title, layoutAlgorithm: 'squarified', dataLabels: { enabled: true },
          data: cats.map((c, i) => ({ name: c, value: vals[i] ?? 0, color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') })),
        }],
      };
    }

    if (chartType === 'waterfall' || chartType === 'scatter') {
      return {
        chart: { type: chartType as any, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        ...axes,
        series: [{ type: chartType as any, name: title, data: vals, showInLegend: false }],
      };
    }

    // Default: column/bar/stacked/combo
    const isStacked = chartType === 'stacked';
    const isCombo = chartType === 'combo';

    if (isCombo && hasMulti) {
      return {
        chart: { type: 'column', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: cats, labels: { style: { fontSize: '10px', color: '#667085' } }, lineColor: '#E7ECF3' },
        yAxis: [
          { title: { text: undefined }, gridLineColor: '#F1F3F6', endOnTick: false, maxPadding: 0.05 },
          { title: { text: undefined }, opposite: true, gridLineWidth: 0, endOnTick: false, maxPadding: 0.05 },
        ],
        tooltip: { shared: true },
        plotOptions: {
          column: { stacking: 'normal' as any, borderRadius: 0, borderWidth: 0, dataLabels: { enabled: false } },
          line: { marker: { enabled: true, radius: 3 } },
        },
        series: series!,
      };
    }

    if (chartType === 'grouped' && hasMulti) {
      return {
        chart: { type: 'column', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        ...axes,
        plotOptions: { column: { grouping: true, borderRadius: 4, borderWidth: 0, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } } },
        series: series!,
      };
    }

    // 'column' renders horizontally, matching the Chart Details page.
    const hcBarType = chartType === 'column' ? 'bar' : 'column';
    return {
      chart: { type: hcBarType, backgroundColor: 'transparent' },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      ...axes,
      plotOptions: { [hcBarType]: { borderRadius: isStacked ? 0 : 3, borderWidth: 0, colorByPoint: !hasMulti, colors: hasMulti ? undefined : cats.map((c, i) => this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value')), stacking: isStacked ? 'normal' as any : undefined, dataLabels: { enabled: false } } },
      series: hasMulti ? series : [{ type: hcBarType, name: title, data: vals.map((value, i) => ({ y: value, color: this.pointColor(cats[i] ?? '', value, design, i, design?.yAxis ?? 'Value') })), showInLegend: false }],
    };
  }

  /** Types with their own field set instead of the plain xAxis/yAxis category+value shape. */
  private buildSpecialChartOptions(chartType: string, rows: Record<string, unknown>[], design: any, title: string): Highcharts.Options {
    const safeStr = (v: unknown): string => (v == null ? '' : (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v) : '');
    const groupByXAxis = (xAxis: string): Map<string, Record<string, unknown>[]> => {
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = safeStr(row[xAxis]) || '(empty)';
        const bucket = grouped.get(key) ?? [];
        bucket.push(row);
        grouped.set(key, bucket);
      }
      return grouped;
    };

    if (chartType === 'kpi') return buildKpiChartOptions(computeKpiValue(rows, design));

    if (chartType === 'gauge') {
      const yAxis = design.yAxis ?? '';
      const col = design.yAggColumn || yAxis;
      const nums = rows.map(r => Number(r[col])).filter(v => !Number.isNaN(v));
      let value: number;
      if (yAxis === 'Average (F)') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (yAxis === 'Min (F)') value = nums.length ? Math.min(...nums) : 0;
      else if (yAxis === 'Max (F)') value = nums.length ? Math.max(...nums) : 0;
      else if (yAxis === 'Count (F)' || yAxis === 'Count Distinct (F)') value = rows.length;
      else value = nums.reduce((a, b) => a + b, 0);
      return {
        chart: { type: 'solidgauge' as any, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        pane: { startAngle: -90, endAngle: 90, background: [{ backgroundColor: '#EEE', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }] } as any,
        yAxis: { min: design.gaugeMin ?? 0, max: design.gaugeMax ?? 100, stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']], lineWidth: 0, tickWidth: 0, minorTickInterval: null as any, labels: { enabled: false } } as any,
        plotOptions: { solidgauge: { dataLabels: { y: -25, borderWidth: 0, format: '<div style="text-align:center"><span style="font-size:18px;font-weight:600">{y}</span></div>' } } } as any,
        series: [{ type: 'solidgauge' as any, name: col || 'Value', data: [value] }],
      };
    }

    if (chartType === 'histogram') {
      const col = design.yAggColumn || design.yAxis || '';
      const rawValues = rows.map(r => Number(r[col])).filter(v => !Number.isNaN(v));
      return {
        chart: { backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: [{ alignTicks: false }, { title: { text: 'Histogram' }, alignTicks: false, opposite: true }],
        yAxis: [{ title: { text: undefined } }, { title: { text: 'Frequency' }, opposite: true }],
        series: [
          { name: col || 'Raw data', type: 'scatter' as const, data: rawValues, visible: false, id: 'bb-histogram-raw' },
          { name: col || 'Histogram', type: 'histogram' as any, xAxis: 1, yAxis: 1, baseSeries: 'bb-histogram-raw', zIndex: -1, color: chartFallbackColor(`${col || 'Histogram'}:`, 0) },
        ],
      };
    }

    if (chartType === 'bullet') {
      const measureCol = design.yAggColumn || design.yAxis || '';
      const targetCol = design.bulletTargetColumn ?? '';
      const grouped = groupByXAxis(design.xAxis ?? '');
      const categories: string[] = [];
      const data: Array<{ y: number; target?: number }> = [];
      for (const [k, groupRows] of grouped) {
        categories.push(k);
        const y = groupRows.reduce((sum, r) => sum + (Number(r[measureCol]) || 0), 0);
        const target = targetCol ? groupRows.reduce((sum, r) => sum + (Number(r[targetCol]) || 0), 0) : undefined;
        data.push(target !== undefined ? { y, target } : { y });
      }
      return {
        chart: { type: 'bullet' as any, inverted: true, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories, title: { text: undefined } },
        yAxis: { title: { text: undefined }, gridLineWidth: 0 },
        plotOptions: { series: { pointPadding: 0.25, borderWidth: 0, color: chartFallbackColor(`${measureCol || 'Value'}:`, 0), targetOptions: { width: '200%' } } } as any,
        series: [{ type: 'bullet' as any, name: measureCol || 'Value', data }],
      };
    }

    if (chartType === 'bubble') {
      const measureCol = design.yAggColumn || design.yAxis || '';
      const sizeCol = design.bubbleSizeColumn ?? '';
      const grouped = groupByXAxis(design.xAxis ?? '');
      const data: Array<{ x: number; y: number; z: number; name: string; color: string }> = [];
      let i = 0;
      for (const [k, groupRows] of grouped) {
        const y = groupRows.reduce((sum, r) => sum + (Number(r[measureCol]) || 0), 0);
        const z = sizeCol ? groupRows.reduce((sum, r) => sum + (Number(r[sizeCol]) || 0), 0) : 1;
        data.push({ x: i, y, z, name: k, color: chartFallbackColor(`${measureCol || 'Value'}:${k}`, i) });
        i++;
      }
      return {
        chart: { type: 'bubble', zoomType: 'xy', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: [...grouped.keys()], title: { text: undefined } },
        yAxis: { title: { text: undefined } },
        plotOptions: { bubble: { minSize: 6, maxSize: 40 } },
        series: [{ type: 'bubble' as const, name: measureCol || 'Value', data }],
      };
    }

    if (chartType === 'heatmap') {
      const xAxis = design.xAxis ?? '';
      const yCol = design.heatmapYColumn ?? '';
      const valueCol = design.yAggColumn || design.yAxis || '';
      const xCats = [...new Set(rows.map(r => safeStr(r[xAxis])))];
      const yCats = [...new Set(rows.map(r => safeStr(r[yCol])))];
      const cellMap = new Map<string, number>();
      for (const row of rows) {
        const xi = xCats.indexOf(safeStr(row[xAxis]));
        const yi = yCats.indexOf(safeStr(row[yCol]));
        if (xi < 0 || yi < 0) continue;
        const key = `${xi}-${yi}`;
        cellMap.set(key, (cellMap.get(key) ?? 0) + (Number(row[valueCol]) || 0));
      }
      const data = [...cellMap.entries()].map(([key, v]) => {
        const [xi, yi] = key.split('-').map(Number);
        return [xi, yi, v] as [number, number, number];
      });
      return {
        chart: { type: 'heatmap', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: xCats, title: { text: undefined } },
        yAxis: { categories: yCats, title: { text: undefined }, reversed: true },
        colorAxis: { minColor: '#EAF2FF', maxColor: '#2563EB' } as any,
        series: [{ type: 'heatmap' as const, name: valueCol || 'Value', data, dataLabels: { enabled: true } }],
      };
    }

    if (chartType === 'sankey') {
      const from = design.sankeyFromColumn ?? '';
      const to = design.sankeyToColumn ?? '';
      const weightCol = design.sankeyWeightColumn ?? '';
      const weightMap = new Map<string, number>();
      for (const row of rows) {
        const f = safeStr(row[from]), t = safeStr(row[to]);
        if (!f || !t) continue;
        const key = `${f}\u2192${t}`;
        weightMap.set(key, (weightMap.get(key) ?? 0) + (Number(row[weightCol]) || 0));
      }
      const data = [...weightMap.entries()].map(([key, weight]) => {
        const [f, t] = key.split('\u2192');
        return [f, t, weight] as [string, string, number];
      });
      return {
        chart: { type: 'sankey', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false },
        series: [{ type: 'sankey' as const, name: weightCol || 'Flow', keys: ['from', 'to', 'weight'], data } as any],
      };
    }

    // timeline
    const dateCol = design.timelineDateColumn ?? '';
    const labelCol = design.timelineLabelColumn ?? '';
    const data = rows.map(r => ({ name: safeStr(r[labelCol]), label: safeStr(r[dateCol]) }));
    return {
      chart: { type: 'timeline' as any, backgroundColor: 'transparent' },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { visible: false }, yAxis: { visible: false },
      series: [{ type: 'timeline' as any, name: labelCol || 'Timeline', data }],
    };
  }

  /** Re-type the cached multi-series data for the chart type currently being previewed. */
  private seriesForView(view: ChartView, series: Highcharts.SeriesOptionsType[], design?: any): Highcharts.SeriesOptionsType[] {
    const comboLineCols: string[] = design?.comboLineColumns ?? [];
    const kept = (series as any[]).filter(s => s.name !== 'Total' || view === 'stacked');
    return kept.map(s => {
      const out: any = { ...s, stacking: undefined, yAxis: undefined };
      const isComboLine = comboLineCols.includes(s.name);
      switch (view) {
        case 'combo':
          out.type = isComboLine ? 'line' : 'column';
          out.stacking = isComboLine ? undefined : 'normal';
          out.yAxis = isComboLine ? 1 : 0;
          break;
        case 'stacked':
          out.type = s.name === 'Total' ? 'line' : 'column';
          out.stacking = s.name === 'Total' ? undefined : 'normal';
          break;
        case 'grouped': case 'bar':
          out.type = 'column';
          break;
        case 'column':
          out.type = 'bar';
          break;
        case 'area':
          out.type = 'area';
          break;
        case 'trend':
          out.type = 'areaspline';
          break;
        case 'spline':
          out.type = 'spline';
          break;
        default:
          out.type = 'line';
          if (view === 'multiline' && isComboLine) out.yAxis = 1;
      }
      return out as Highcharts.SeriesOptionsType;
    });
  }

  private readonly _pieOpts = (colors: string[]): Highcharts.Options => ({
    chart: { type: 'pie', backgroundColor: 'transparent', height: 170, margin: [0, 0, 0, 0], spacing: [4, 4, 4, 4] },
    title: { text: undefined }, credits: { enabled: false },
    tooltip: { pointFormat: '<b>{point.y}</b>' },
    legend: { enabled: false },
    plotOptions: { pie: {
      center: ['50%', '50%'], size: '80%',
      borderWidth: 2, borderColor: '#fff',
      dataLabels: { enabled: false },
      showInLegend: false,
    }},
    series: [{ type: 'pie', data: [
      { name: 'Not due because of FLAF/SCR& Other', y: 87, color: colors[0] ?? '#168BCB' },
      { name: 'Not Due (Issued to be resolved by PDO)', y: 37, color: colors[1] ?? '#F58220' },
      { name: 'Backlog',                            y: 8,  color: '#D92D20' },
      { name: 'Actual-Due Wells Completed',         y: 7,  color: '#7FBE3F' },
      { name: 'Suspended Wells',                    y: 17, color: colors[2] ?? '#3F7D32' },
      { name: 'Actual-Not Due Wells Completed',     y: 17, color: '#3F7D32' },
    ]}],
  });

  readonly pieLegendItems = [
    { name: 'Not due because of FLAF/SCR& Other',    y: 17, color: '#168BCB' },
    { name: 'Suspended Wells',                        y: 17, color: '#3F7D32' },
    { name: 'Not Due (Issued to be resolved by PDO)', y: 17, color: '#F58220' },
    { name: 'Backlog',                                y: 17, color: '#D92D20' },
    { name: 'Actual-Due Wells Completed',             y: 17, color: '#7FBE3F' },
    { name: 'Actual-Not Due Wells Completed',         y: 17, color: '#3F7D32' },
  ];

  private readonly _lineOpts = (): Highcharts.Options => ({
    chart: { type: 'line', backgroundColor: 'transparent', height: 200, margin: [20, 10, 30, 40], spacing: [4, 4, 4, 4] },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    xAxis: {
      categories: ['Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26'],
      labels: { style: { fontSize: '9px', color: '#667085' } },
      lineColor: '#E7ECF3', tickColor: 'transparent',
    },
    yAxis: {
      title: { text: undefined },
      gridLineColor: '#F1F3F6',
      labels: { style: { fontSize: '9px', color: '#667085' } },
      tickAmount: 3,
    },
    tooltip: { shared: true },
    plotOptions: { line: { marker: { radius: 4, symbol: 'circle' }, dataLabels: { enabled: false } } },
    series: [
      { type: 'line', name: 'Plan - Due Well',          color: '#168BCB', marker: { symbol: 'circle',  radius: 4 }, data: [100, 130, 155, 170, 185, 195, 200, 205] },
      { type: 'line', name: 'Total Drilled Wells',       color: '#3F7D32', marker: { symbol: 'diamond', radius: 4 }, data: [120, 155, 175, 195, 215, 230, 245, 255] },
      { type: 'line', name: 'Actual - Wells Completed',  color: '#F58220', marker: { symbol: 'square',  radius: 4 }, data: [60,  90, 115, 135, 155, 165, 180, 195] },
    ],
  });

  readonly lineLegendItems = [
    { name: 'Plan - Due Well',          color: '#168BCB', symbol: 'circle'  },
    { name: 'Total Drilled Wells',      color: '#3F7D32', symbol: 'diamond' },
    { name: 'Actual - Wells Completed', color: '#F58220', symbol: 'square'  },
  ];

  private readonly _barOpts = (): Highcharts.Options => ({
    chart: { type: 'column', backgroundColor: 'transparent', height: 210, margin: [20, 4, 40, 30], spacing: [4, 4, 4, 4] },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    xAxis: {
      categories: ['As per Reg.', 'Not Drilled', 'Excluded', 'Date < now', 'Issues', 'Wells Due', 'Part Due', 'Actual', 'Shortfall'],
      labels: { style: { fontSize: '8px', color: '#667085' }, rotation: -45 },
      lineColor: '#E7ECF3', tickColor: 'transparent',
    },
    yAxis: {
      title: { text: undefined }, gridLineColor: '#F1F3F6',
      labels: { style: { fontSize: '8px', color: '#667085' } },
    },
    tooltip: { shared: true },
    plotOptions: {
      column: {
        borderRadius: 2, borderWidth: 0,
        dataLabels: { enabled: true, style: { fontSize: '8px', fontWeight: '700', textOutline: 'none', color: '#344054' } },
      },
    },
    series: [
      { type: 'column', name: 'Plan',   color: '#168BCB', data: [420, 10, 4, 0, 0, 361, 0, 0,   0] },
      { type: 'column', name: 'Actual', color: '#3F7D32', data: [315, 17, 0, 0, 0, 267, 0, 180, -94] },
    ],
  });

  readonly barLegendItems = [
    { name: 'Plan',   color: '#168BCB', symbol: 'square' },
    { name: 'Actual', color: '#3F7D32', symbol: 'square' },
  ];

  // 2-segment pie with data labels on slices (Commissioned / Not Commissioned)
  private readonly _pie2Opts = (): Highcharts.Options => ({
    chart: { type: 'pie', backgroundColor: 'transparent', height: 170, margin: [0, 0, 0, 0], spacing: [4, 4, 4, 4] },
    title: { text: undefined }, credits: { enabled: false },
    tooltip: { pointFormat: '<b>{point.y}</b>' },
    legend: { enabled: false },
    plotOptions: { pie: {
      center: ['50%', '50%'], size: '80%',
      borderWidth: 2, borderColor: '#fff',
      dataLabels: {
        enabled: true,
        format: '{point.y}',
        style: { color: '#fff', fontWeight: '700', fontSize: '13px', textOutline: 'none' },
        distance: -28,
      },
      showInLegend: false,
    }},
    series: [{ type: 'pie', data: [
      { name: 'Not Commissioned', y: 37, color: '#168BCB' },
      { name: 'Commissioned',     y: 67, color: '#3F7D32' },
    ]}],
  });

  readonly pie2LegendItems = [
    { name: 'Commissioned',     color: '#3F7D32' },
    { name: 'Not Commissioned', color: '#168BCB' },
  ];

  // Compact chart options sized for 64×64 thumbnail display
  private readonly _pieThumbnail = (colors: string[]): Highcharts.Options => ({
    chart: { type: 'pie', backgroundColor: 'transparent', height: 64, margin: [2, 2, 2, 2], spacing: [0, 0, 0, 0] },
    title: { text: undefined }, credits: { enabled: false },
    tooltip: { enabled: false }, legend: { enabled: false },
    plotOptions: { pie: { center: ['50%', '50%'], size: '95%', borderWidth: 1, borderColor: '#fff', dataLabels: { enabled: false } } },
    series: [{ type: 'pie', data: [
      { y: 87, color: colors[0] ?? '#168BCB' }, { y: 37, color: colors[1] ?? '#F58220' },
      { y: 8,  color: '#D92D20' }, { y: 7, color: '#7FBE3F' },
      { y: 17, color: colors[2] ?? '#3F7D32' }, { y: 17, color: '#3F7D32' },
    ]}],
  });

  private readonly _lineThumbnail = (): Highcharts.Options => ({
    chart: { type: 'line', backgroundColor: 'transparent', height: 64, margin: [4, 4, 4, 4], spacing: [0, 0, 0, 0] },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    tooltip: { enabled: false },
    xAxis: { visible: false }, yAxis: { visible: false, gridLineWidth: 0 },
    plotOptions: { line: { marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } },
    series: [
      { type: 'line', color: '#168BCB', data: [100, 130, 155, 170, 185, 195, 200, 205] },
      { type: 'line', color: '#3F7D32', data: [120, 155, 175, 195, 215, 230, 245, 255] },
      { type: 'line', color: '#F58220', data: [60, 90, 115, 135, 155, 165, 180, 195] },
    ] as Highcharts.SeriesOptionsType[],
  });

  private readonly _barThumbnail = (): Highcharts.Options => ({
    chart: { type: 'column', backgroundColor: 'transparent', height: 64, margin: [4, 2, 4, 2], spacing: [0, 0, 0, 0] },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    tooltip: { enabled: false },
    xAxis: { visible: false }, yAxis: { visible: false, gridLineWidth: 0 },
    plotOptions: { column: { borderWidth: 0, dataLabels: { enabled: false }, enableMouseTracking: false } },
    series: [
      { type: 'column', color: '#168BCB', data: [420, 10, 4, 0, 0, 361, 0, 0, 0] },
      { type: 'column', color: '#3F7D32', data: [315, 17, 0, 0, 0, 267, 0, 180, 10] },
    ],
  });

  private readonly _pie2Thumbnail = (): Highcharts.Options => ({
    chart: { type: 'pie', backgroundColor: 'transparent', height: 64, margin: [2, 2, 2, 2], spacing: [0, 0, 0, 0] },
    title: { text: undefined }, credits: { enabled: false },
    tooltip: { enabled: false }, legend: { enabled: false },
    plotOptions: { pie: { center: ['50%', '50%'], size: '95%', borderWidth: 1, borderColor: '#fff', dataLabels: { enabled: false } } },
    series: [{ type: 'pie', data: [{ y: 37, color: '#168BCB' }, { y: 67, color: '#3F7D32' }] }],
  });

  get selectedChartsCount(): number { return this.selectedChartIds.size; }

  isChartSelected(id: string): boolean { return this.selectedChartIds.has(id); }

  toggleChartSelection(id: string): void {
    this.selectedChartIds.has(id) ? this.selectedChartIds.delete(id) : this.selectedChartIds.add(id);
    this.cdr.markForCheck();
  }

  clearChartSelection(): void { this.selectedChartIds.clear(); this.cdr.markForCheck(); }

  removeChartFromSelection(id: string): void {
    this.selectedChartIds.delete(id);
    this.cdr.markForCheck();
  }

  getChartById(id: string): ChartSelectorItem | undefined {
    return [...this.standardCharts, ...this.myCharts].find(c => c.id === id);
  }

  get selectedChartIdsArray(): string[] { return Array.from(this.selectedChartIds); }

  // ── Per-card chart type selector (mirrors ops-dashboard) ──────────
  chartTypeMenuOpen: Record<string, boolean> = {};
  cardChartType: Record<string, ChartView> = {};
  cardChartTypeOptions: Record<string, ChartView[]> = {};

  // Live chart options — overwritten when user picks a new type
  private readonly _liveChartOptions: Record<string, Highcharts.Options> = {};

  // Raw chart data for each card so we can rebuild for any type
  private readonly _cardRawData: Record<string, { cats: string[]; vals: number[]; colors: string[]; multi?: Highcharts.SeriesOptionsType[] }> = {
    c1: { cats: ['Not due/FLAF', 'Not Due/PDO', 'Backlog', 'Actual-Due', 'Suspended', 'Actual-Not-Due'], vals: [87, 37, 8, 7, 17, 17], colors: ['#168BCB','#F58220','#D92D20','#7FBE3F','#3F7D32','#3F7D32'] },
    c2: { cats: ['Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26','Jul-26','Aug-26'], vals: [], colors: [], multi: [
      { type: 'line', name: 'Plan - Due Well', color: '#168BCB', data: [100,130,155,170,185,195,200,205] } as Highcharts.SeriesOptionsType,
      { type: 'line', name: 'Total Drilled',   color: '#3F7D32', data: [120,155,175,195,215,230,245,255] } as Highcharts.SeriesOptionsType,
      { type: 'line', name: 'Actual',          color: '#F58220', data: [60, 90,115,135,155,165,180,195] } as Highcharts.SeriesOptionsType,
    ]},
    c3: { cats: ['Not Commissioned','Commissioned'], vals: [37, 67], colors: ['#168BCB','#3F7D32'] },
    c4: { cats: ['Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26','Jul-26','Aug-26'], vals: [], colors: [], multi: [
      { type: 'line', name: 'Plan - Due Well', color: '#168BCB', data: [100,130,155,170,185,195,200,205] } as Highcharts.SeriesOptionsType,
      { type: 'line', name: 'Total Drilled',   color: '#3F7D32', data: [120,155,175,195,215,230,245,255] } as Highcharts.SeriesOptionsType,
      { type: 'line', name: 'Actual',          color: '#F58220', data: [60, 90,115,135,155,165,180,195] } as Highcharts.SeriesOptionsType,
    ]},
    c5: { cats: ['As per Reg.','Not Drilled','Excluded','Date<now','Issues','Wells Due','Part Due','Actual','Shortfall'], vals: [], colors: [], multi: [
      { type: 'column', name: 'Plan',   color: '#168BCB', data: [420,10,4,0,0,361,0,0,0]   } as Highcharts.SeriesOptionsType,
      { type: 'column', name: 'Actual', color: '#3F7D32', data: [315,17,0,0,0,267,0,180,-94] } as Highcharts.SeriesOptionsType,
    ]},
    c6: { cats: ['Not due/FLAF','Not Due/PDO','Backlog','Actual-Due','Suspended','Actual-Not-Due'], vals: [87,37,8,7,17,17], colors: ['#168BCB','#F58220','#D92D20','#7FBE3F','#3F7D32','#3F7D32'] },
  };

  private _buildForType(type: string, id: string): Highcharts.Options {
    const d = this._cardRawData[id];
    if (!d) return {};
    const hasMulti = d.multi && d.multi.length > 0;
    const base: Highcharts.Options = {
      chart: { backgroundColor: 'transparent', height: 200, margin: [10, 10, 30, 40], spacing: [4,4,4,4] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
    };

    if (type === 'Doughnut' || type === 'Pie') {
      const pieData = hasMulti
        ? (d.multi as Highcharts.SeriesLineOptions[]).map((s, i) => ({ name: s.name ?? `S${i}`, y: ((s.data as number[]) ?? []).reduce((a, b) => a + (b as number), 0), color: s.color as string }))
        : d.cats.map((c, i) => ({ name: c, y: d.vals[i] ?? 0, color: d.colors[i] ?? '#168BCB' }));
      return { ...base, chart: { ...base.chart, type: 'pie', height: 200, margin: [0,0,0,0] },
        plotOptions: { pie: { center: ['50%','50%'], size: '70%', borderWidth: 2, borderColor: '#fff', innerSize: type === 'Doughnut' ? '50%' : '0%', dataLabels: { enabled: false } } },
        series: [{ type: 'pie', data: pieData }] };
    }

    const axes: Partial<Highcharts.Options> = {
      xAxis: { categories: d.cats, labels: { style: { fontSize: '9px', color: '#667085' } }, lineColor: '#E7ECF3', tickColor: 'transparent' },
      yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6', labels: { style: { fontSize: '9px', color: '#667085' } } },
      tooltip: { shared: true },
    };

    if (type === 'Line') {
      const series: Highcharts.SeriesOptionsType[] = hasMulti ? d.multi! : [{ type: 'line', color: '#168BCB', data: d.vals, showInLegend: false } as Highcharts.SeriesOptionsType];
      return { ...base, ...axes, chart: { ...base.chart, type: 'line' }, plotOptions: { line: { marker: { radius: 3 }, dataLabels: { enabled: false } } }, series };
    }
    if (type === 'Trend') {
      const series: Highcharts.SeriesOptionsType[] = hasMulti ? d.multi! : [{ type: 'areaspline', color: '#168BCB', data: d.vals, showInLegend: false } as Highcharts.SeriesOptionsType];
      return { ...base, ...axes, chart: { ...base.chart, type: 'areaspline' }, plotOptions: { areaspline: { fillOpacity: 0.12, marker: { radius: 3 }, dataLabels: { enabled: false } } }, series };
    }
    // Bar (default)
    const series: Highcharts.SeriesOptionsType[] = hasMulti ? d.multi! :
      [{ type: 'column', data: d.cats.map((_, i) => ({ y: d.vals[i] ?? 0, color: d.colors[i] ?? '#168BCB' })), showInLegend: false } as Highcharts.SeriesOptionsType];
    return { ...base, ...axes, chart: { ...base.chart, type: 'column' }, plotOptions: { column: { borderWidth: 0, borderRadius: 2, dataLabels: { enabled: false } } }, series };
  }

  getCardChartOptions(id: string): Highcharts.Options {
    return this._liveChartOptions[id] ?? {};
  }

  getCardTableData(id: string): { headers: string[]; rows: (string | number)[][] } {
    const d = this._cardRawData[id];
    if (!d) return { headers: [], rows: [] };
    if (d.multi && d.multi.length) {
      const headers = ['Category', ...(d.multi as Highcharts.SeriesLineOptions[]).map(s => s.name ?? 'Series')];
      const rows = d.cats.map((cat, i) => [
        cat,
        ...(d.multi as Highcharts.SeriesLineOptions[]).map(s => (s.data as number[])[i] ?? 0),
      ]);
      return { headers, rows };
    }
    return {
      headers: ['Category', 'Value'],
      rows: d.cats.map((cat, i) => [cat, d.vals[i] ?? 0]),
    };
  }

  toggleChartTypeMenu(id: string, e: Event): void {
    e.stopPropagation();
    const wasOpen = this.chartTypeMenuOpen[id];
    this.chartTypeMenuOpen = {};
    if (!wasOpen) this.chartTypeMenuOpen[id] = true;
    this.cdr.markForCheck();
  }

  selectCardChartType(id: string, type: ChartView): void {
    this.cardChartType[id] = type;
    this.chartTypeMenuOpen = {};
    this.controlsPopoverOpen = {};
    if (type === 'table') {
      this.cdr.markForCheck();
      return;
    }
    // Special types (gauge/histogram/sankey/timeline/bullet/bubble/heatmap) only ever offer
    // themselves + 'table' as switch options — their preview is already correct from initial load.
    if (['gauge', 'histogram', 'sankey', 'timeline', 'bullet', 'bubble', 'heatmap'].includes(type)) {
      this.cdr.markForCheck();
      return;
    }
    const data = this.chartAggData[id];
    if (data) {
      this.chartPreviewOptions[id] = {};
      this.cdr.detectChanges();
      this.chartPreviewOptions[id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(type, data.cats, data.vals, data.title, data.multiSeries, this.chartDesigns[id]), this.chartDesigns[id]?.sortOrder), this.chartShowDataLabels[id]));
    }
    this.cdr.markForCheck();
  }

  getChartLegendItems(id: string): { name: string; color: string }[] {
    const data = this.chartAggData[id];
    if (!data) return [];
    const design = this.chartDesigns[id];
    if (data.multiSeries?.length) {
      return data.multiSeries.map((s, i) => {
        const name = (s as any).name ?? `Series ${i + 1}`;
        return {
          name,
          color: this.categoryColorFor('', design, name)
            ?? (s as any).color
            ?? this.fallbackColor(`${name}:`, i),
        };
      });
    }
    const ct = (this.cardChartType[id] ?? '').toLowerCase();
    if (ct === 'pie' || ct === 'doughnut') {
      return data.cats.map((c, i) => ({ name: c, color: this.pointColor(c, data.vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') }));
    }
    return [];
  }

  shouldIncludeDataTable(id: string): boolean {
    return this.chartDesigns[id]?.includeDataTable === true;
  }

  getChartTableData(id: string): { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] } {
    return this.chartTableCache[id] ?? { headers: [], rows: [], rowColors: [], rowBgColors: [] };
  }

  getChartThumbnailOptions(id: string): Highcharts.Options {
    const data = this.chartAggData[id];
    if (!data) return this.chartPreviewOptions[id] ?? {};
    const type = (this.cardChartType[id] ?? 'bar').toLowerCase();

    const base: Highcharts.Options = {
      chart: { backgroundColor: 'transparent', height: 62, margin: [2, 2, 2, 2], spacing: [0, 0, 0, 0] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      tooltip: { enabled: false },
      xAxis: { visible: false },
      yAxis: { visible: false, gridLineWidth: 0 },
    };

    if (type === 'pie' || type === 'doughnut') {
      return {
        ...base,
        chart: { ...base.chart, type: 'pie' },
        plotOptions: { pie: { center: ['50%', '50%'], size: '90%', borderWidth: 1, borderColor: '#fff', dataLabels: { enabled: false }, enableMouseTracking: false } },
        series: [{ type: 'pie', data: data.cats.map((category, i) => ({ name: category, y: data.vals[i] ?? 0, color: this.pointColor(category, data.vals[i] ?? 0, this.chartDesigns[id], i, data.seriesName ?? 'Value') })).filter(d => d.y !== 0) }],
      };
    }

    if (type === 'line' || type === 'multiline' || type === 'spline') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'line' as any, data: data.vals.map((value, i) => ({ y: value, color: this.pointColor(data.cats[i] ?? '', value, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'line' }, plotOptions: { line: { marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }

    if (type === 'trend' || type === 'area') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'areaspline' as any, data: data.vals.map((value, i) => ({ y: value, color: this.pointColor(data.cats[i] ?? '', value, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), fillOpacity: 0.15, marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'areaspline' }, plotOptions: { areaspline: { fillOpacity: 0.15, marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }

    const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
      ? data.multiSeries.map(s => ({ ...s } as Highcharts.SeriesOptionsType))
      : [{ type: 'column' as any, data: data.cats.map((category, i) => ({ y: data.vals[i] ?? 0, color: this.pointColor(category, data.vals[i] ?? 0, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), enableMouseTracking: false } as Highcharts.SeriesOptionsType];
    return { ...base, chart: { ...base.chart, type: 'column' }, plotOptions: { column: { borderWidth: 0, borderRadius: 1, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
  }

  private formatTableCell(value: unknown): string | number {
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'number' ? value : String(value);
  }

  private buildChartTableData(id: string): { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] } {
    const data = this.chartAggData[id];
    if (!data) return { headers: [], rows: [], rowColors: [], rowBgColors: [] };
    if (data.tableHeaders && data.tableRows) {
      return {
        headers: data.tableHeaders,
        rows: data.tableRows,
        rowColors: data.tableRows.map((_row, index) => ROW_DOT_COLORS[index % ROW_DOT_COLORS.length]),
        rowBgColors: data.tableRows.map((_row, index) => ROW_BG_COLORS[index % ROW_BG_COLORS.length]),
      };
    }
    if (data.multiSeries?.length) {
      const headers = ['Category', ...data.multiSeries.map(s => (s as any).name ?? 'Series')];
      const rows = data.cats.map((cat, i) => [
        cat,
        ...data.multiSeries!.map(s => ((s as any).data as number[])?.[i] ?? 0),
      ]);
      const rowColors   = data.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]);
      const rowBgColors = data.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]);
      return { headers, rows, rowColors, rowBgColors };
    }
    const rowColors   = data.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]);
    const rowBgColors = data.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]);
    return {
      headers: ['Category', 'Value'],
      rows: data.cats.map((cat, i) => [cat, data.vals[i] ?? 0]),
      rowColors,
      rowBgColors,
    };
  }

  @HostListener('document:click')
  closeAllChartTypeMenus(): void {
    if (Object.keys(this.chartTypeMenuOpen).length) {
      this.chartTypeMenuOpen = {};
      this.cdr.markForCheck();
    }
  }

  closeChartsModal(): void {
    this.showChartsModal = false;
    this.activePanel = null;
    this.chartsSearchTerm = '';
    // Reset chart types and previews to saved defaults
    for (const id of Object.keys(this.defaultChartType)) {
      this.cardChartType[id] = this.defaultChartType[id];
      if (this.defaultChartOptions[id]) {
        this.chartPreviewOptions[id] = this.defaultChartOptions[id];
      }
    }
    this.selectedChartIds.clear();
    this.cdr.markForCheck();
  }

  addChartsToDashboard(): void {
    const before = this.captureBoardSnapshot();
    this.tileSlots = this.tileSlots.filter(item => !item || !this.isChartItem(item) || this.selectedChartIds.has(item.id));
    this.chartSlotsData = this.chartSlotsData.filter(item => !this.isChartItem(item) || this.selectedChartIds.has(item.id));
    const allCharts = [...this.standardCharts, ...this.myCharts];
    const selected = allCharts.filter(c => this.selectedChartIds.has(c.id));

    for (const chart of selected) {
      if (![...this.tileSlots, ...this.chartSlotsData].some(item => item && this.isChartItem(item) && item.id === chart.id)) {
        this.chartSlotsData.push(chart);
      }
      // Ensure a preview exists for the placed chart even if its card was never scrolled to.
      this.loadChartPreview(chart);
    }

    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.selectedChartIds.clear();
    this.closeChartsModal();
  }

  removeChartFromSlot(index: number): void {
    const before = this.captureBoardSnapshot();
    this.chartSlotsData.splice(index, 1);
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.cdr.markForCheck();
  }

  // ─── Undo ─────────────────────────────────────────────────
  // Snapshots copy each slot object because a drag/resize writes x/y/width/height onto the
  // slot itself (see onProductionGridItemChange) — sharing references would let later moves
  // rewrite the history entries too.
  private undoStack: BoardSnapshot[] = [];
  private readonly maxUndoSteps = 50;
  /** Pre-change snapshot for the Gridster drag/resize in progress; one drag can fire the change
   *  callback for several pushed items, which should all undo as a single step. */
  private pendingGridUndo: BoardSnapshot | null = null;
  /** Set while an undo is being applied, so the Gridster callbacks it triggers aren't recorded. */
  private restoringUndo = false;

  get canUndo(): boolean { return this.undoStack.length > 0; }

  private captureBoardSnapshot(): BoardSnapshot {
    return {
      tileSlots: this.tileSlots.map(slot => slot ? { ...slot } : null),
      chartSlotsData: this.chartSlotsData.map(slot => ({ ...slot })),
    };
  }

  private boardSignature(snapshot: BoardSnapshot): string {
    const key = (slot: TileSelectorItem | ChartSelectorItem | null) =>
      slot ? [slot.id, slot.x, slot.y, slot.width, slot.height] : null;
    return JSON.stringify([snapshot.tileSlots.map(key), snapshot.chartSlotsData.map(key)]);
  }

  /** Pushes `before` onto the undo stack if the board actually changed since it was taken. */
  private recordUndo(before: BoardSnapshot): void {
    if (this.restoringUndo) return;
    if (this.boardSignature(before) === this.boardSignature(this.captureBoardSnapshot())) return;
    this.undoStack.push(before);
    if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    this.cdr.markForCheck();
  }

  private resetUndoHistory(): void {
    this.undoStack = [];
    this.pendingGridUndo = null;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.pendingGridUndo = null;
    this.restoringUndo = true;
    this.tileSlots = previous.tileSlots;
    this.chartSlotsData = previous.chartSlotsData;
    this.syncUnifiedLayout();
    this.cdr.markForCheck();
    this.scheduleChartReflow();
    // Outlast refreshProductionGridster's delayed updateGrid, which can re-fire item callbacks.
    setTimeout(() => { this.restoringUndo = false; }, 400);
  }

  // ─── Clear All ────────────────────────────────────────────
  requestClearAll(): void {
    const before = this.captureBoardSnapshot();
    this.tileSlots      = [];
    this.chartSlotsData = [];
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.clearAdvancedFilters();
    this.cdr.markForCheck();
  }

  // ── KPI tile / chart-card drag-to-reorder — including across rows ──
  // tileSlots is a fixed 5-slot array (nulls = empty); chartSlotsData is a
  // variable-length array with no holes. Dropping a card onto the OTHER
  // row's slot swaps the two items between the arrays (adapting for the
  // fixed-vs-variable shape below) rather than just reordering in place;
  // the template then renders whichever shape actually ended up in a slot
  // via isChartItem()/isTileItem().
  dragSource: { zone: 'tile' | 'chart'; index: number } | null = null;
  dropTarget: { zone: 'tile' | 'chart'; index: number } | null = null;

  isTileDragging(index: number): boolean {
    return this.dragSource?.zone === 'tile' && this.dragSource.index === index;
  }

  isTileDropTarget(index: number): boolean {
    return this.dropTarget?.zone === 'tile' && this.dropTarget.index === index
      && !(this.dragSource?.zone === 'tile' && this.dragSource.index === index);
  }

  isChartDragging(index: number): boolean {
    return this.dragSource?.zone === 'chart' && this.dragSource.index === index;
  }

  isChartDropTarget(index: number): boolean {
    return this.dropTarget?.zone === 'chart' && this.dropTarget.index === index
      && !(this.dragSource?.zone === 'chart' && this.dragSource.index === index);
  }

  onSlotDragStart(zone: 'tile' | 'chart', index: number): void {
    if (zone === 'tile' && !this.tileSlots[index]) return;
    this.dragSource = { zone, index };
  }

  onSlotDragOver(event: DragEvent, zone: 'tile' | 'chart', index: number): void {
    if (!this.dragSource) return;
    event.preventDefault();
    this.dropTarget = { zone, index };
  }

  onSlotDragLeave(): void {
    this.dropTarget = null;
  }

  onSlotDrop(zone: 'tile' | 'chart', index: number): void {
    const before = this.captureBoardSnapshot();
    const from = this.dragSource;
    if (from && !(from.zone === zone && from.index === index)) {
      if (from.zone === 'tile' && zone === 'tile') {
        [this.tileSlots[from.index], this.tileSlots[index]] = [this.tileSlots[index], this.tileSlots[from.index]];
      } else if (from.zone === 'chart' && zone === 'chart') {
        [this.chartSlotsData[from.index], this.chartSlotsData[index]] =
          [this.chartSlotsData[index], this.chartSlotsData[from.index]];
      } else if (from.zone === 'tile' && zone === 'chart') {
        const draggedTile = this.tileSlots[from.index];
        const displacedChart = this.chartSlotsData[index];
        this.chartSlotsData[index] = draggedTile!;
        this.tileSlots[from.index] = displacedChart ?? null;
      } else {
        // from.zone === 'chart' && zone === 'tile'
        const draggedChart = this.chartSlotsData[from.index];
        const displacedTile = this.tileSlots[index];
        this.tileSlots[index] = draggedChart;
        if (displacedTile) {
          this.chartSlotsData[from.index] = displacedTile;
        } else {
          this.chartSlotsData.splice(from.index, 1);
        }
      }
    }
    this.syncUnifiedLayout();
    this.recordUndo(before);
    this.dragSource = null;
    this.dropTarget = null;
    this.cdr.markForCheck();
    // Swapped slots can carry over a different width/height, so nudge
    // Highcharts to reflow into its (possibly new) card size.
    this.scheduleChartReflow();
  }

  onSlotDragEnd(): void {
    this.dragSource = null;
    this.dropTarget = null;
    this.cdr.markForCheck();
  }

  // ─── Help modal ───────────────────────────────────────────
  showHelpModal        = false;
  helpExpandedArticle: number | null = 0;

  openHelpModal(): void  { this.showHelpModal = true; }
  closeHelpModal(): void { this.showHelpModal = false; }

  toggleHelpArticle(index: number): void {
    this.helpExpandedArticle = this.helpExpandedArticle === index ? null : index;
  }

  // ─── Learn modal ───────────────────────────────────────────
  showLearnModal = false;

  openLearnModal(): void  { this.showLearnModal = true; }
  closeLearnModal(): void { this.showLearnModal = false; }
}

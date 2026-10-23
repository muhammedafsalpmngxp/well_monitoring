import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';
import { AdvancedFilterComponent, type AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { applyChartSort } from '../../../core/utils/chart-sort.util';
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, map, shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import type Highcharts from 'highcharts';
import { AdvancedChartPayload, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { Gridster, GridsterConfig, GridsterItemConfig, GridType, DisplayGrid, CompactType } from 'angular-gridster2';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { SaveDashboardRequest, WidgetLibraryItem } from '../../../core/models/dashboard.model';
import { WidgetService } from '../../../core/services/widget.service';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  hasGlobalSelection,
  matchesGlobalSelection,
  GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
import { AuthService } from '../../../core/services/auth.service';
import { ChartView, ChartViewIcon, chartSwitchOptions, chartViewIcon, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { appendDaxToChartData, getActiveDaxMeasures, evaluateTileDaxValue, formatDaxValue, getSelectedDaxMeasure } from '../../../core/utils/dax-evaluator.util';
import { CHART_AUTO_COLORS } from '../../../core/utils/chart-color.util';
import { legendLayoutClass, LegendPosition, readLegendPosition } from '../../../core/utils/chart-legend-position.util';
import { applyConditionalFilters, getSavedConditionalFilters } from '../../../core/utils/conditional-filter.util';

const CHART_COLORS = [...CHART_AUTO_COLORS];
const ROW_BG_COLORS  = ['#F3F6FF', '#EBFFF2', '#FFFAF1', '#FFF1F1', '#E8F8FF'];
const ROW_DOT_COLORS = ['#1E3A8A', '#49D67D', '#F5A623', '#DC2626', '#38BDF8'];
type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES = new Set(['line', 'multiline', 'grouped', 'stacked', 'area']);

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
  designJson?: string;
  categoryName?: string;
  width?: number;
  height?: number;
}

export interface ChartSelectorItem {
  id: string;
  title: string;
  description: string;
  chartType: string;
  source: string;
  sourceType: string;
  designJson?: string;
  categoryName?: string;
  width?: number;
  height?: number;
}

export interface BoardBuilderTab {
  id: string;
  label: string;
}

/** One cell on the single gridster canvas — either an empty "Select Tile/Chart"
 *  placeholder (`empty: true`, no `data`) or a filled tile/chart card. */
export interface BoardGridItem extends GridsterItemConfig {
  id: string;
  kind: 'tile' | 'chart';
  empty?: boolean;
  data?: TileSelectorItem | ChartSelectorItem;
}

@Component({
  selector: 'app-board-builder-test',
  standalone: false,
  templateUrl: './board-builder-test.component.html',
  styleUrls: ['./board-builder-test.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardBuilderTestComponent implements OnInit, AfterViewInit, OnDestroy {
  // angular-gridster2 only recalculates its column width on a window resize event — it has no
  // ResizeObserver on its own host, so when THIS container gets wider/narrower for any other
  // reason (the app sidebar collapsing, the right panel opening/closing, the zoom transform),
  // the grid keeps using its stale first-measured width and leaves a dead gap on one side.
  // `refreshGridSize()` (called after those layout shifts settle) forces it to re-measure.
  @ViewChild(Gridster) private gridsterRef?: Gridster;

  private refreshGridSize(): void {
    setTimeout(() => this.gridsterRef?.updateGrid(), 320);
  }
  // ── Filters bar ───────────────────────────────────────────
  filterBarVisible = true;
  country: GlobalFilterSelection = 'All';
  sector: GlobalFilterSelection = 'All';
  businessUnit: GlobalFilterSelection = 'All';
  division: GlobalFilterSelection = 'All';
  cluster: GlobalFilterSelection = 'All';
  plant: GlobalFilterSelection = 'All';
  fromDate = '2026-12-12';
  toDate = '2026-12-12';
  quickRange = '';
  private globalFilterClearState?: GlobalFilterClearState;

  get globalFilterClear(): GlobalFilterClearState {
    return this.globalFilterClearState ??= new GlobalFilterClearState();
  }
  private openFilterNameValue: string | null = null;

  get openFilterName(): string | null {
    return this.openFilterNameValue;
  }

  set openFilterName(name: string | null) {
    this.openFilterNameValue = name;
    // Closing a dropdown left in the "Clear all" state reverts that filter to All.
    const abandoned = this.globalFilterClear.release(name);
    if (abandoned) this.revertClearedGlobalFilter(abandoned.key);
  }

  clearGlobalFilterSelection(key: unknown, event: Event): void {
    event.stopPropagation();
    this.globalFilterClear.clear(key, this.openFilterName);
  }

  isGlobalFilterCleared(key: unknown): boolean {
    return this.globalFilterClear.isCleared(key);
  }

  private revertClearedGlobalFilter(key: unknown): void {
    if (!['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'].includes(String(key))) return;
    const field = key as 'country' | 'sector' | 'businessUnit' | 'division' | 'cluster' | 'plant';
    if (hasGlobalSelection(this[field])) this.selectFilterOption(field, 'All');
  }

  countryOptions:  string[] = [];
  sectorOptions:   string[] = [];
  buOptions:       string[] = [];
  divisionOptions: string[] = [];
  clusterOptions:  string[] = [];
  plantOptions:    string[] = [];
  quickRangeOptions = ['Last 7 days', 'Till Last Tuesday', 'Last 30 days', 'Last 90 days', 'This year'];
  private allPlants: PlantFilterDto[] = [];

  // Add Tiles/Add Charts modal dropdowns show an 'All' entry so users can clear a level back to unfiltered.
  get countryOptionsWithAll():  string[] { return ['All', ...this.countryOptions]; }
  get sectorOptionsWithAll():   string[] { return ['All', ...this.sectorOptions]; }
  get buOptionsWithAll():       string[] { return ['All', ...this.buOptions]; }
  get divisionOptionsWithAll(): string[] { return ['All', ...this.divisionOptions]; }
  get clusterOptionsWithAll():  string[] { return ['All', ...this.clusterOptions]; }
  get plantOptionsWithAll():    string[] { return ['All', ...this.plantOptions]; }

  // ── Toolbar ───────────────────────────────────────────────
  pageName = 'Overview';
  dashboardDescription = '';
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

  isChartItem(item: TileSelectorItem | ChartSelectorItem | null | undefined): item is ChartSelectorItem {
    return !!item && 'chartType' in item;
  }

  isTileItem(item: TileSelectorItem | ChartSelectorItem | null | undefined): item is TileSelectorItem {
    return !!item && 'accent' in item;
  }

  // ── Single gridster canvas ─────────────────────────────────
  // Every KPI tile / chart card (filled or empty placeholder) lives in this
  // one flat array; angular-gridster2 owns dragging, resizing and collision
  // handling for it (see gridsterOptions below), replacing the old custom
  // HTML5-drag + mousedown-resize implementation.
  boardItems: BoardGridItem[] = [];
  gridsterOptions: GridsterConfig = {};

  private boardItemSeq = 0;
  // 20 (not 12) so both rows divide evenly with zero remainder — 5 tiles * 4 cols and
  // 2 charts * 10 cols each land on exactly 20/20 columns. A previous version reserved
  // slack columns to give the resize handle room to push a neighbor over, but nothing
  // ever filled that reserved strip, so it just showed up as permanent dead space on
  // the right. Exact-fill avoids the gap; resizing wider now works by first shrinking
  // or moving the sibling in that row, same as any other packed grid.
  private readonly GRID_COLS = 20;
  private readonly TILE_COLS = 4;
  // Fixed row height (px) — rows() * ROW_HEIGHT gives each card's real pixel height, so a
  // chart's actual Highcharts height (200-220px) + header/type-switcher/trend-buttons chrome
  // maps to a whole number of rows instead of GridType.Fit force-stretching every row to fill
  // a fixed container height (which either left huge blank gaps or clipped taller cards).
  private readonly ROW_HEIGHT = 24;
  private readonly TILE_ROWS = 5;   // ~120px, close to the old fixed KPI card height
  private readonly CHART_ROWS = 16; // ~384px, close to the old fixed chart card height
  // Board always starts with this many chart placeholders — there's no layout preset to drive it
  // anymore; drag more charts in from the library (or resize/duplicate rows) to add more.
  private readonly CHART_SLOT_COUNT = 2;

  trackByBoardItem(_index: number, item: BoardGridItem): string { return item.id; }

  /** Chart placeholder/card width (in grid columns) — exactly fills the row (GRID_COLS / count)
   *  so there's no dead strip on the right. */
  private get chartCols(): number {
    return Math.max(2, Math.floor(this.GRID_COLS / this.CHART_SLOT_COUNT));
  }

  private makeEmptyItem(kind: 'tile' | 'chart'): BoardGridItem {
    return {
      id: `empty-${kind}-${++this.boardItemSeq}`,
      kind,
      empty: true,
      data: undefined,
      x: 0, y: 0,
      cols: kind === 'tile' ? this.TILE_COLS : this.chartCols,
      rows: kind === 'tile' ? this.TILE_ROWS : this.CHART_ROWS,
      // Empty "Select Tile/Chart" placeholders are draggable/resizable on the grid just like a
      // filled card — only the library-modal drag-drop / addTilesToDashboard() fill path and the
      // click-to-open-modal handler care whether `empty` is true, not gridster's drag/resize gate.
      dragEnabled: true,
      resizeEnabled: true,
    };
  }

  private makeFilledItem(kind: 'tile' | 'chart', data: TileSelectorItem | ChartSelectorItem): BoardGridItem {
    if (kind === 'tile') {
      // Wrap into additional tile rows (same 5-per-row layout the initial seed uses), scoped to
      // other TILE items only. Using the whole board's lowest edge here (as before) meant a new
      // tile past the first 5 empty placeholders landed at the CHART section's bottom edge —
      // overlapping it — since a chart's rows are much taller and dominate that max.
      const tilesPerRow = Math.max(1, Math.floor(this.GRID_COLS / this.TILE_COLS));
      const tileCount = this.boardItems.filter(i => i.kind === 'tile').length;
      return {
        id: `tile-${data.id}-${++this.boardItemSeq}`,
        kind, empty: false, data,
        x: (tileCount % tilesPerRow) * this.TILE_COLS,
        y: Math.floor(tileCount / tilesPerRow) * this.TILE_ROWS,
        cols: this.TILE_COLS, rows: this.TILE_ROWS,
        dragEnabled: true, resizeEnabled: true,
      };
    }
    const chartItems = this.boardItems.filter(i => i.kind === 'chart');
    const maxY = chartItems.length ? Math.max(...chartItems.map(i => i.y + i.rows)) : this.tileSectionRows;
    return {
      id: `chart-${data.id}-${++this.boardItemSeq}`,
      kind, empty: false, data,
      x: 0, y: maxY,
      cols: this.chartCols, rows: this.CHART_ROWS,
      dragEnabled: true, resizeEnabled: true,
    };
  }

  /** How many rows the tile section currently occupies (0 if there are no tiles at all), so a
   *  chart never gets placed starting inside it. */
  private get tileSectionRows(): number {
    const tilesPerRow = Math.max(1, Math.floor(this.GRID_COLS / this.TILE_COLS));
    const tileCount = this.boardItems.filter(i => i.kind === 'tile').length;
    return tileCount ? Math.ceil(tileCount / tilesPerRow) * this.TILE_ROWS : 0;
  }

  /** Seeds the board with 5 KPI-tile placeholders (y:0) followed by CHART_SLOT_COUNT chart placeholders (y:1+). */
  private initBoardLayout(): void {
    const items: BoardGridItem[] = [];
    for (let i = 0; i < 5; i++) {
      const item = this.makeEmptyItem('tile');
      item.x = i * this.TILE_COLS;
      item.y = 0;
      items.push(item);
    }
    this.boardItems = items;
    this.syncChartPlaceholders();
  }

  /** Adds/removes empty chart placeholders so (filled + empty) chart items == CHART_SLOT_COUNT,
   *  then lays out just the empty ones in a tidy row — filled items are never touched. */
  private syncChartPlaceholders(): void {
    const chartItems = this.boardItems.filter(i => i.kind === 'chart');
    const filled = chartItems.filter(i => !i.empty);
    const empties = chartItems.filter(i => i.empty);
    const needed = Math.max(0, this.CHART_SLOT_COUNT - filled.length);

    if (empties.length > needed) {
      const remove = new Set(empties.slice(needed));
      this.boardItems = this.boardItems.filter(i => !remove.has(i));
    } else if (empties.length < needed) {
      for (let k = empties.length; k < needed; k++) {
        this.boardItems.push(this.makeEmptyItem('chart'));
      }
    }

    const cols = this.chartCols;
    // Was a hardcoded `1` — barely below y:0, so with tiles occupying a full row (0-5) the
    // very first (empty) chart placeholders started already overlapping the tile row.
    const startY = filled.length ? Math.max(...filled.map(i => i.y + i.rows)) : this.tileSectionRows;
    let x = 0;
    let y = startY;
    for (const item of this.boardItems.filter(i => i.kind === 'chart' && i.empty)) {
      if (x + cols > this.GRID_COLS) { x = 0; y += this.CHART_ROWS; }
      item.x = x; item.y = y; item.cols = cols; item.rows = this.CHART_ROWS;
      x += cols;
    }
    this.cdr.markForCheck();
  }

  gridsterItemChange = (): void => { this.cdr.markForCheck(); };
  gridsterItemResize = (): void => { this.cdr.markForCheck(); };

  private buildGridsterOptions(): GridsterConfig {
    return {
      // VerticalFixed: columns still scale to the container width (like Fit does
      // horizontally), but each row is a real fixedRowHeight in px instead of the
      // container's total height being divided across all rows — so a card's height
      // matches what it actually needs instead of every row being force-stretched.
      gridType: GridType.VerticalFixed,
      fixedRowHeight: this.ROW_HEIGHT,
      displayGrid: DisplayGrid.OnDragAndResize,
      compactType: CompactType.None,
      minCols: this.GRID_COLS,
      maxCols: this.GRID_COLS,
      minRows: this.TILE_ROWS + this.CHART_ROWS,
      outerMargin: true,
      margin: 8,
      pushItems: true,
      swap: true,
      draggable: { enabled: true, ignoreContentClass: 'board-no-drag', ignoreContent: false },
      resizable: { enabled: true },
      itemChangeCallback: this.gridsterItemChange,
      itemResizeCallback: this.gridsterItemResize,
    };
  }

  // ── Library-card → canvas drag-and-drop ─────────────────────
  libraryDragItem: { kind: 'tile' | 'chart'; item: TileSelectorItem | ChartSelectorItem } | null = null;

  onLibraryDragStart(event: DragEvent, item: TileSelectorItem | ChartSelectorItem, kind: 'tile' | 'chart' = 'tile'): void {
    this.libraryDragItem = { kind, item };
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  onCanvasDragOver(event: DragEvent): void {
    if (!this.libraryDragItem) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  /** Drops a card dragged out of the Add Tiles/Add Charts modal onto the canvas — fills the exact
   *  placeholder dropped on (if it's empty and of the matching kind), otherwise falls back to the
   *  first empty placeholder of that kind, else appends a brand-new item at the next free row. */
  onCanvasDrop(event: DragEvent, targetItem?: BoardGridItem): void {
    event.preventDefault();
    const drag = this.libraryDragItem;
    if (!drag) return;

    if (targetItem && targetItem.empty && targetItem.kind === drag.kind) {
      targetItem.data = drag.item;
      targetItem.empty = false;
      targetItem.dragEnabled = true;
      targetItem.resizeEnabled = true;
    } else {
      const slot = this.boardItems.find(i => i.kind === drag.kind && i.empty);
      if (slot) {
        slot.data = drag.item;
        slot.empty = false;
        slot.dragEnabled = true;
        slot.resizeEnabled = true;
      } else {
        this.boardItems.push(this.makeFilledItem(drag.kind, drag.item));
      }
    }

    if (drag.kind === 'tile') this.loadTilePreview(drag.item as TileSelectorItem);
    else this.loadChartPreview(drag.item as ChartSelectorItem);
    if (drag.kind === 'chart') this.syncChartPlaceholders();

    this.libraryDragItem = null;
    this.cdr.markForCheck();
  }

  /** Removes a card from the board — resets its grid position back to an empty placeholder of the
   *  same kind rather than splicing it out, so the board never shows a "hole" (same UX as before). */
  removeBoardItem(item: BoardGridItem): void {
    item.data = undefined;
    item.empty = true;
    // Stays draggable/resizable as an empty placeholder too — see makeEmptyItem().
    item.dragEnabled = true;
    item.resizeEnabled = true;
    if (item.kind === 'chart') this.syncChartPlaceholders();
    this.cdr.markForCheck();
  }

  // ── Right panel ───────────────────────────────────────────
  activePanel: 'widgets' | 'filters' | 'tiles' | 'charts' | null = null;

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
      { label: 'Build Dashboard' },
    ];
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly layoutState: LayoutStateService,
    private readonly cdr: ChangeDetectorRef,
    private readonly authService: AuthService,
  ) {}

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get wipChartsLabel(): string { return this.isAdmin ? 'WIP Charts' : 'My Charts'; }

  ngOnInit(): void {
    this.gridsterOptions = this.buildGridsterOptions();
    this.initBoardLayout();

    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();

    this.layoutState.sidebarCollapsed$
      .pipe(takeUntil(this.destroy$))
      .subscribe(collapsed => {
        this.panelCollapsed = !collapsed;
        this.cdr.markForCheck();
        this.refreshGridSize();
      });

    this.categorySub = this.categoryService.getCategoriesByType('dashboard').subscribe(cats => {
      this.apiCategories = cats;
      this.categories = cats.map(c => c.categoryName);
      if (!this.category && this.categories.length > 0) this.category = this.categories[0];
      this.cdr.markForCheck();
    });

    this.loadTilesFromApi();
    this.loadPlantFilters();

    const params = this.route.snapshot.queryParamMap;
    const category = params.get('category');
    if (category) this.category = category;
    const name = params.get('name');
    if (name) this.pageName = name;
    const description = params.get('description');
    if (description) this.dashboardDescription = description;
  }

  ngOnDestroy(): void {
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.categorySub?.unsubscribe();
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

  filterLabel(selection: GlobalFilterSelection): string {
    return globalSelectionLabel(selection);
  }

  isFilterOptionSelected(selection: GlobalFilterSelection, value: string): boolean {
    return value === 'All' ? selection === 'All' : matchesGlobalSelection(value, selection);
  }

  private globalFilterOptions(field: string): string[] {
    switch (field) {
      case 'country': return this.countryOptions;
      case 'sector': return this.sectorOptions;
      case 'businessUnit': return this.buOptions;
      case 'division': return this.divisionOptions;
      case 'cluster': return this.clusterOptions;
      case 'plant': return this.plantOptions;
      default: return [];
    }
  }

  selectFilterOption(field: string, value: string): void {
    if (field === 'quickRange') {
      this.quickRange = value;
      this.openFilterName = null;
      this.cdr.markForCheck();
      return;
    }
    const current = this[field as 'country' | 'sector' | 'businessUnit' | 'division' | 'cluster' | 'plant'];
    const next = value === 'All' ? 'All' : toggleGlobalSelection(current, value, this.globalFilterOptions(field), this.globalFilterClear.consume(field));
    switch (field) {
      case 'country':      this.country = next; this.sector = 'All'; this.businessUnit = 'All'; this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'sector':       this.sector = next; this.businessUnit = 'All'; this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'businessUnit': this.businessUnit = next; this.division = 'All'; this.cluster = 'All'; this.plant = 'All'; break;
      case 'division':     this.division = next; this.cluster = 'All'; this.plant = 'All'; break;
      case 'cluster':      this.cluster = next; this.plant = 'All'; break;
      case 'plant':        this.plant = next; break;
    }
    const resetCluster = field === 'cluster' && !hasGlobalSelection(this.cluster);
    const resetPlant = resetCluster || (field === 'plant' && !hasGlobalSelection(this.plant));
    this.rebuildCascadingOptions(resetCluster, resetPlant);
    this.openFilterName = null;
    this.cdr.markForCheck();
  }

  /** Resets the Add Tiles/Add Charts modal's filter row (shared fields) to their defaults. */
  clearAdvancedFilters(event?: Event): void {
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
    event?.stopPropagation();
    this.country = 'All';
    this.sector = 'All';
    this.businessUnit = 'All';
    this.division = 'All';
    this.cluster = 'All';
    this.plant = 'All';
    this.fromDate = '2026-12-12';
    this.toDate = '2026-12-12';
    this.quickRange = '';
    this.openFilterName = null;
    this.rebuildCascadingOptions();
    this.reloadAdvancedPreviews();
    this.cdr.markForCheck();
  }

  private advancedFilters: ReturnType<typeof advancedHierarchyFilters> = [];
  @ViewChild('advancedFilter') private advancedFilterRef?: AdvancedFilterComponent;
  private readonly advancedFilterReload$ = new Subject<void>();

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.reloadAdvancedPreviews();
  }

  private reloadAdvancedPreviews(): void {
    this.advancedFilterReload$.next();
    const chartIds = new Set(this.loadedChartPreviewIds);
    const tileKeys = new Set(this.tilePreviewRequests.keys());
    this.loadedChartPreviewIds.clear();
    this.tilePreviewRequests.clear();
    const charts = [...this.standardCharts, ...this.myCharts];
    const tiles = [...this.standardTiles, ...this.myTiles];
    for (const item of this.boardItems) {
      if (!item.data || item.empty) continue;
      if (item.kind === 'chart' && 'source' in item.data) charts.push(item.data);
      else if (item.kind === 'tile' && 'value' in item.data) tiles.push(item.data);
    }
    for (const chart of new Map(charts.filter(chart => chartIds.has(chart.id)).map(chart => [chart.id, chart])).values())
      this.loadChartPreview(chart);
    for (const tile of new Map(tiles.filter(tile => tileKeys.has(JSON.stringify([tile.id, tile.designJson]))).map(tile => [tile.id, tile])).values())
      this.loadTilePreview(tile);
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
    if (this.countryOptions.length === 1) this.country = this.countryOptions[0];
    let filtered = this.allPlants;
    if (this.country !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.country));
    const sectors = this.distinctValues(filtered, p => p.sector);
    if (sectors.length === 1) this.sector = sectors[0];
    if (this.sector !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.sector));
    const bus = this.distinctValues(filtered, p => p.businessUnit);
    if (bus.length === 1) this.businessUnit = bus[0];
    if (this.businessUnit !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.businessUnit));
    const divs = this.distinctValues(filtered, p => p.division);
    if (divs.length === 1) this.division = divs[0];
  }

  private rebuildCascadingOptions(suppressAutoCluster = false, suppressAutoPlant = false): void {
    let filtered = this.allPlants;
    if (this.country !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.country));
    this.sectorOptions = this.country !== 'All' ? this.distinctValues(filtered, p => p.sector) : [];
    if (this.sector !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.sector));
    this.buOptions = this.sector !== 'All' ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (this.businessUnit !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.businessUnit));
    this.divisionOptions = this.businessUnit !== 'All' ? this.distinctValues(filtered, p => p.division) : [];
    if (this.division !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.division, this.division));
    this.clusterOptions = this.division !== 'All' ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    if (!suppressAutoCluster && this.cluster === 'All' && this.clusterOptions.length === 1) this.cluster = this.clusterOptions[0];
    if (this.cluster !== 'All') filtered = filtered.filter(p => matchesGlobalSelection(p.cluster, this.cluster));
    this.plantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (!suppressAutoPlant && this.plant === 'All' && this.plantOptions.length === 1) this.plant = this.plantOptions[0];
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  toggleLock():  void { this.locked = !this.locked; }
  zoomIn():      void { this.zoomLevel = Math.min(this.zoomLevel + 10, 200); }
  zoomOut():     void { this.zoomLevel = Math.max(this.zoomLevel - 10, 50); }
  togglePanel(): void { this.panelCollapsed = !this.panelCollapsed; this.refreshGridSize(); }

  ngAfterViewInit(): void {
    // Covers the ngOnInit()-triggered sidebar collapse, whose CSS transition is still running
    // when this component first mounts.
    this.refreshGridSize();
  }

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
  saveError = '';
  /** Id of the dashboard once the first save succeeds — null until then (create-only builder, no edit route). */
  private dashboardId: number | null = null;

  save(): void { this.saveDashboard(false); }
  saveAndClose(): void { this.saveDashboard(false, true); }
  publish(): void {
    if (!this.isAdmin) return;
    this.saveDashboard(true);
  }

  private saveDashboard(publishAfter = false, closeAfterSave = false): void {
    if (this.isSaving) return;

    const cat = this.apiCategories.find(c => c.categoryName === this.category);
    if (!cat) { this.saveError = 'Please select a valid category.'; this.cdr.markForCheck(); return; }

    this.isSaving = true;
    this.saveError = '';
    this.saveSuccess = '';

    // A widget's saved type reflects what's actually placed in that grid cell (not
    // whether it's in the tile or chart section), since gridster's swap can move a
    // tile into what was a chart placeholder and vice versa. Sort order follows the
    // items' grid position (top-to-bottom, left-to-right).
    const filledItems = [...this.boardItems.filter(i => !i.empty && i.data)]
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const widgets = filledItems.map((item, i) => ({
      chartId: Number(item.data!.id) || 0,
      sortOrder: i + 1,
      type: this.isChartItem(item.data) ? 'chart' : 'tile',
      width: item.cols ?? null,
      height: item.rows ?? null,
    }));

    const request: SaveDashboardRequest = {
      dashboardName: this.pageName.trim() || 'Untitled Dashboard',
      categoryId: cat.categoryId,
      description: this.dashboardDescription.trim() || undefined,
      configJson: JSON.stringify({ widgets }),
    };

    const obs$ = this.dashboardId
      ? this.dashboardService.updateDashboard(this.dashboardId, request)
      : this.dashboardService.createDashboard(request);

    obs$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.isSaving = false;
        const name = response.data?.dashboardName || this.pageName;
        this.saveSuccess = `'${name}' saved as draft.`;
        // First save of a new dashboard: switch to edit mode so subsequent saves update instead of re-creating (avoids duplicate-name error)
        if (!this.dashboardId && response.data?.dashboardId) {
          this.dashboardId = response.data.dashboardId;
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

  selectPanel(panel: 'widgets' | 'filters' | 'tiles' | 'charts'): void {
    this.activePanel = this.activePanel === panel ? null : panel;
    if (panel === 'tiles') this.showTilesModal = true;
    if (panel === 'charts') this.showChartsModal = true;
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
  /** Viewport-relative position for the currently open filter menu; rendered via position:fixed
   *  so the modal's overflow:hidden body can never clip or mis-size the popup. */
  filterMenuPos = { top: 0, left: 0, width: 220 };

  get tileCategoryOptions(): string[] {
    const source = this.tilesModalTab === 'standard' ? this.standardTiles : this.myTiles;
    return [...new Set(source.map(t => t.categoryName).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  }

  get tilesCategoryLabel(): string { return this.tilesCategoryFilter === 'all' ? 'All Category' : this.tilesCategoryFilter; }
  get tilesSortLabel(): string { return this.tilesSortOption === 'name-asc' ? 'Name (A-Z)' : 'Name (Z-A)'; }

  private positionFilterMenu(event: Event, minWidth = 220): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.filterMenuPos = { top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, minWidth) };
  }

  toggleTilesCategoryDropdown(event: Event): void {
    event.stopPropagation();
    const opening = !this.showTilesCategoryDropdown;
    this.showTilesCategoryDropdown = false;
    this.showTilesSortDropdown = false;
    this.showChartsCategoryDropdown = false;
    this.showChartsSortDropdown = false;
    if (opening) { this.positionFilterMenu(event); this.showTilesCategoryDropdown = true; }
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
    if (opening) { this.positionFilterMenu(event, 0); this.showTilesSortDropdown = true; }
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

  private mapWidgetToTileItem(widget: WidgetLibraryItem, index: number): TileSelectorItem {
    let title = widget.name;
    let value = '—';
    let accent = this.accentCycle[index % this.accentCycle.length];
    let icon: TileSelectorItem['icon'] = 'well';
    let active = 0;
    let inactive = 0;
    let activeLabel   = 'Active';
    let inactiveLabel = 'Inactive';

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
        if (design.tileIcon) {
          const iconMap: Record<string, TileSelectorItem['icon']> = {
            'location': 'well', 'check-circle': 'check', 'alert-triangle': 'alert',
            'trending-up': 'chart', 'users': 'crew',
          };
          icon = iconMap[design.tileIcon] ?? design.tileIcon;
        }
        if (design.breakdownRows?.length >= 2) {
          active = Number(design.breakdownRows[0]?.value) || 0;
          inactive = Number(design.breakdownRows[1]?.value) || 0;
          activeLabel   = design.breakdownRows[0]?.label || activeLabel;
          inactiveLabel = design.breakdownRows[1]?.label || inactiveLabel;
        }
      } catch { /* ignore bad JSON */ }
    }

    return { id: String(widget.id), title, value, accent, icon, active, inactive, activeLabel, inactiveLabel, designJson: widget.designJson, categoryName: widget.categoryName };
  }

  private readonly tilePreviewRequests = new Map<string, Observable<string>>();

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
    const isView = design.dataSourceMode === 'view' && viewId > 0;
    if (!source && !isView) return;

    let request$ = this.tilePreviewRequests.get(key);
    if (!request$) {
      const data$ = isView
        ? this.commonApi.getDatabaseViewById(viewId).pipe(
            switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: view.generatedSql, viewId: view.id, maxRows: 1000, filters: this.advancedFilters ?? [] })),
          )
        : this.widgetService.getTableData(source, sourceType);
      const value$ = !isView && sourceType.toLowerCase() === 'table' && design.daxModel?.enabled
        ? this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation: design.aggregation ?? 'count', daxModel: design.daxModel }).pipe(
            map(res => `${design.prefix ?? ''}${formatDaxValue(res.value ?? 0, getSelectedDaxMeasure(design.daxModel))}${design.suffix ?? ''}`))
        : data$.pipe(map(res => this.computeTileValue(res.rows ?? [], design)));
      request$ = value$.pipe(
        takeUntil(this.advancedFilterReload$), takeUntil(this.destroy$), shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.tilePreviewRequests.set(key, request$);
    }
    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: value => { tile.value = value; this.cdr.markForCheck(); },
      error: () => {
        this.tilePreviewRequests.delete(key);
        if (isView && this.advancedFilters?.length)
          this.saveError = `Failed to apply Advanced Filters to tile: ${tile.title}`;
        this.cdr.markForCheck();
        if (design.daxModel?.enabled) { tile.value = 'DAX error'; this.cdr.markForCheck(); }
      },
    });
  }

  private computeTileValue(rows: Record<string, unknown>[], design: any): string {
    const daxValue = evaluateTileDaxValue(rows, design.daxModel);
    if (daxValue !== undefined) return `${design.prefix ?? ''}${formatDaxValue(daxValue, getSelectedDaxMeasure(design.daxModel))}${design.suffix ?? ''}`;
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
    const places = Number(design.decimalPlaces) || 0;
    const shorten = design.shortenBigNumbers ?? false;
    let formatted = result.toFixed(places);
    if (shorten && result >= 1_000_000) formatted = (result / 1_000_000).toFixed(1) + 'M';
    else if (shorten && result >= 1000) formatted = (result / 1000).toFixed(1) + 'K';
    return `${design.prefix ?? ''}${formatted}${design.suffix ?? ''}`;
  }

  get selectedTilesCount(): number { return this.selectedTileIds.size; }

  isTileSelected(id: string): boolean { return this.selectedTileIds.has(id); }

  /** True when this tile already occupies a slot on the dashboard (prevents adding duplicates). */
  isTileOnDashboard(id: string): boolean {
    return this.boardItems.some(i => i.kind === 'tile' && !i.empty && i.data?.id === id);
  }

  toggleTileSelection(id: string): void {
    if (this.isTileOnDashboard(id)) return;
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
    const allTiles = [...this.standardTiles, ...this.myTiles];
    const selected = allTiles.filter(t => this.selectedTileIds.has(t.id) && !this.isTileOnDashboard(t.id));
    const rowsBefore = this.tileSectionRows;

    for (const tile of selected) {
      const emptySlot = this.boardItems.find(i => i.kind === 'tile' && i.empty);
      if (emptySlot) {
        emptySlot.data = tile;
        emptySlot.empty = false;
        emptySlot.dragEnabled = true;
        emptySlot.resizeEnabled = true;
      } else {
        this.boardItems.push(this.makeFilledItem('tile', tile));
      }
      // Ensure a value exists for the placed tile even if its card was never scrolled to.
      this.loadTilePreview(tile);
    }

    // Filling the last of the 5 seeded placeholders doesn't grow the tile section, but spilling
    // past them onto a 2nd tile row does — push every chart (filled ones included, which
    // syncChartPlaceholders below otherwise never repositions) down by that many rows so the new
    // tile row can't land on top of a chart that already started right where row 2 now begins.
    const rowsAfter = this.tileSectionRows;
    if (rowsAfter > rowsBefore) {
      const delta = rowsAfter - rowsBefore;
      for (const item of this.boardItems) {
        if (item.kind === 'chart') item.y += delta;
      }
      // Keeps any still-empty chart placeholders flush below the just-shifted filled ones.
      this.syncChartPlaceholders();
    }

    this.selectedTileIds.clear();
    this.closeTilesModal();
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
    if (widget.designJson) {
      try {
        const design = JSON.parse(widget.designJson);
        if (design.chartType) chartType = design.chartType;
      } catch { /* ignore */ }
    }
    return {
      id: String(widget.id),
      title: widget.name,
      description: widget.categoryName || widget.source || '',
      chartType,
      source: widget.source,
      sourceType: widget.sourceType,
      designJson: widget.designJson,
      categoryName: widget.categoryName,
    };
  }

  get filteredCharts(): ChartSelectorItem[] {
    const source = this.chartsModalTab === 'standard' ? this.standardCharts : this.myCharts;
    const term = this.chartsSearchTerm.toLowerCase();
    const result = source.filter(c =>
      (!term || c.title.toLowerCase().includes(term)) &&
      (this.chartsCategoryFilter === 'all' || c.categoryName === this.chartsCategoryFilter));
    return [...result].sort((a, b) => this.chartsSortOption === 'name-asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
  }

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
    if (opening) { this.positionFilterMenu(event); this.showChartsCategoryDropdown = true; }
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
    if (opening) { this.positionFilterMenu(event, 0); this.showChartsSortDropdown = true; }
  }

  selectChartsSort(opt: 'name-asc' | 'name-desc'): void {
    this.chartsSortOption = opt;
    this.showChartsSortDropdown = false;
  }

  chartPreviewOptions: Record<string, Highcharts.Options> = {};
  advancedCharts: Record<string, AdvancedChartPayload> = {};
  chartPreviewLoading: Record<string, boolean> = {};
  chartTrendModes: Record<string, TrendMode> = {};
  trendChartPreviews: Record<string, boolean> = {};
  chartIncludeDataTable: Record<string, boolean> = {};
  chartLegendPositions: Record<string, LegendPosition> = {};
  readonly legendLayoutClass = legendLayoutClass;
  private chartAggData: Record<string, { cats: string[]; vals: number[]; title: string; multiSeries?: Highcharts.SeriesOptionsType[]; sort?: string }> = {};
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

  /** Loads a single chart's preview on demand when its card scrolls into view. */
  onChartVisible(chart: ChartSelectorItem): void { this.loadChartPreview(chart); }

  private loadChartPreview(chart: ChartSelectorItem): void {
    if (this.loadedChartPreviewIds.has(chart.id)) return;
    if (!chart.designJson || !chart.source) return;
    this.loadedChartPreviewIds.add(chart.id);
    this.chartPreviewLoading[chart.id] = true;
    let design: any;
    try { design = JSON.parse(chart.designJson); } catch { return; }

    this.chartIncludeDataTable[chart.id] = design.includeDataTable === true;
    this.chartLegendPositions[chart.id] = readLegendPosition(design);
    const source = design.source ?? chart.source;
    const sourceType = design.sourceType ?? chart.sourceType ?? 'Table';
    const viewId = design.viewId ?? 0;
    const isView = design.dataSourceMode === 'view' && viewId > 0;
    const isTrend = TREND_CHART_TYPES.has(design.chartType);
    this.trendChartPreviews[chart.id] = isTrend;
    this.chartTrendModes[chart.id] ??= design.trendMode ?? 'monthly';

    let data$;
    if (isView && isTrend) {
      data$ = this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: sourceType, viewId, filters: this.advancedFilters ?? [], mode: this.chartTrendModes[chart.id] });
    } else if (isView) {
      data$ = this.commonApi.getDatabaseViewById(viewId).pipe(
          switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: view.generatedSql, viewId: view.id, maxRows: 1000, filters: this.advancedFilters ?? [] })),
        );
    } else {
      data$ = this.widgetService.getTableData(source, sourceType).pipe(
        catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
      );
    }

    data$.pipe(takeUntil(this.advancedFilterReload$), takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const rows = applyConditionalFilters(res.rows ?? [], getSavedConditionalFilters(design));
        const columns = res.columns ?? [];
        const daxMeasures = getActiveDaxMeasures(design);
        const multiY = design.multiYColumns ?? [];
        const showDataLabels = design.showDataLabels as boolean | undefined;
        this.chartShowDataLabels[chart.id] = showDataLabels !== false;
        if (isAdvancedChart(design.chartType)) {
          this.advancedCharts[chart.id] = { type: design.chartType, rows, config: readAdvancedConfig(design.advancedConfig), daxMeasures };
          this.chartAggData[chart.id] = { cats: [], vals: [], title: chart.title };
          this.chartPreviewOptions[chart.id] = {};
        } else if (multiY.length > 0) {
          const { categories, series } = this.buildMultiSeries(rows, design);
          appendDaxToChartData(daxMeasures, rows, columns, categories, [], series as { data?: unknown }[],
            design.chartType === 'stacked' && design.showStackTotal !== false ? series.length - 1 : -1);
          this.chartAggData[chart.id] = { cats: categories, vals: [], title: chart.title, multiSeries: series, sort: design.sortOrder };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(design.chartType ?? 'bar', categories, [], chart.title, series, design), design.sortOrder), showDataLabels));
        } else {
          const { cats, vals } = this.aggregateChart(rows, design);
          appendDaxToChartData(daxMeasures, rows, columns, cats, vals);
          this.chartAggData[chart.id] = { cats, vals, title: chart.title, sort: design.sortOrder };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(design.chartType ?? 'bar', cats, vals, chart.title, undefined, design), design.sortOrder), showDataLabels));
        }
        if (!this.cardChartType[chart.id]) this.cardChartType[chart.id] = toChartView(design.chartType);
        this.cardChartTypeOptions[chart.id] = chartSwitchOptions(this.cardChartType[chart.id], design);
        this.defaultChartType[chart.id] = this.cardChartType[chart.id];
        this.defaultChartOptions[chart.id] = this.chartPreviewOptions[chart.id];
        this.chartPreviewLoading[chart.id] = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.chartPreviewLoading[chart.id] = false;
        this.saveError = `Failed to load chart data: ${chart.title}`;
        this.cdr.markForCheck();
      },
    });
  }

  setPreviewTrendMode(chart: ChartSelectorItem, mode: TrendMode): void {
    if (this.chartTrendModes[chart.id] === mode) return;
    this.chartTrendModes[chart.id] = mode;
    this.loadedChartPreviewIds.delete(chart.id);
    delete this.chartPreviewOptions[chart.id];
    this.loadChartPreview(chart);
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
    const hasDualY = comboLineCols.length > 0 && (design.chartType === 'combo' || design.chartType === 'multiline' || design.chartType === 'grouped');
    if (hasDualY) {
      for (const col of comboLineCols) {
        if (!allCols.includes(col)) allCols.push(col);
      }
    }
    const isStacked = design.chartType === 'stacked';
    const isCombo = design.chartType === 'combo';
    const isGrouped = design.chartType === 'grouped';
    const hcType = (isStacked || isCombo || isGrouped) ? 'column' : (design.chartType === 'area' ? 'area' : 'line');
    const limitedCategories = this.limitMultiSeriesCategories(categories, grouped, allCols, rows, design);

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
        color: CHART_COLORS[i % CHART_COLORS.length],
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
        type: 'line' as any, name: 'Total', data: totals, color: '#16A34A',
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600' } } as any,
      });
    }

    return { categories: limitedCategories, series };
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

  private mapDesignChartType(type?: string): ChartView {
    return toChartView(type);
  }

  chartViewLabel(view: string): string { return chartViewLabel(view as ChartView); }
  chartViewIcon(view: string): ChartViewIcon { return chartViewIcon(view as ChartView); }

  private static readonly ICON_CASE: Record<ChartViewIcon, string> = {
    pie: 'Pie', donut: 'Doughnut', bar: 'Bar', line: 'Line', trend: 'Trend', combo: 'Combo', grouped: 'Grouped', table: 'Table',
  };
  /** Maps a chart view to the existing icon case label used by the template ngSwitch blocks. */
  chartIconCase(view: string): string { return BoardBuilderTestComponent.ICON_CASE[chartViewIcon(view as ChartView)]; }
  /** The effective chart type of a selector card (user selection, else its saved default). */
  resolvedCardType(chart: ChartSelectorItem): ChartView { return this.cardChartType[chart.id] ?? toChartView(chart.chartType); }

  private buildChartOptions(chartType: string, cats: string[], vals: number[], title: string, multiSeries?: Highcharts.SeriesOptionsType[], design?: any): Highcharts.Options {
    if (chartType === 'funnel') return buildFunnelOptions(cats, vals, CHART_COLORS, 220, title, false);
    const hasMulti = multiSeries && multiSeries.length > 0;
    const series = hasMulti ? this.seriesForView(chartType as ChartView, multiSeries!, design) : undefined;
    const showAxis = design?.showAxisTitle as boolean | undefined;
    const xTitle = showAxis ? ((design?.xAxisTitle as string) || undefined) : undefined;
    const yTitle = showAxis ? ((design?.yAxisTitle as string) || undefined) : undefined;
    const y2Title = showAxis ? ((design?.yAxis2Title as string) || undefined) : undefined;
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
        chart: { type: 'pie', backgroundColor: 'transparent', height: 220 },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
        plotOptions: { pie: { innerSize: chartType === 'donut' ? '55%' : '0%', borderWidth: 2, borderColor: '#fff', showInLegend: false, dataLabels: { enabled: true, distance: chartType === 'donut' ? '-20%' : -28, format: '{point.y}', allowOverlap: true, crop: false, overflow: 'allow', style: { color: '#fff', fontWeight: '700', fontSize: '11px', textOutline: 'none' } } as any } },
        series: [{ type: 'pie', name: title, data: cats.map((c, i) => ({ name: c, y: vals[i], color: CHART_COLORS[i % CHART_COLORS.length] })).filter(d => d.y !== 0) }],
      };
    }

    const axes: Highcharts.Options = {
      xAxis: { categories: cats, title: { text: xTitle }, labels: { style: { fontSize: '10px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
    };

    if (chartType === 'line' || chartType === 'multiline' || chartType === 'spline') {
      const hcType = chartType === 'spline' ? 'spline' : 'line';
      const hasDualY = hasMulti && series!.some((s: any) => s.yAxis === 1);
      const opts: Highcharts.Options = {
        chart: { type: hcType, backgroundColor: 'transparent', height: 200 },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        ...axes,
        plotOptions: { [hcType]: { marker: { radius: 3 }, dataLabels: { enabled: false } } },
        series: hasMulti ? series : [{ type: hcType, name: title, color: CHART_COLORS[0], data: vals, showInLegend: false }],
      };
      if (hasDualY) {
        opts.yAxis = [
          { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
          { title: { text: y2Title }, opposite: true, gridLineWidth: 0 },
        ];
        opts.tooltip = { shared: true };
      }
      return opts;
    }

    if (chartType === 'trend' || chartType === 'area') {
      return {
        chart: { type: 'areaspline', backgroundColor: 'transparent', height: 200 },
        title: { text: undefined }, credits: { enabled: false },
        legend: { enabled: false },
        ...axes,
        plotOptions: { areaspline: { fillOpacity: 0.15, marker: { radius: 3 }, dataLabels: { enabled: false } } },
        series: hasMulti ? series : [{ type: 'areaspline', name: title, color: CHART_COLORS[0], data: vals, showInLegend: false }],
      };
    }

    // Default: column/bar/stacked/combo
    const isStacked = chartType === 'stacked';
    const isCombo = chartType === 'combo';

    if (isCombo && hasMulti) {
      return {
        chart: { type: 'column', backgroundColor: 'transparent', height: 200 },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: cats, title: { text: xTitle }, labels: { style: { fontSize: '10px', color: '#667085' } }, lineColor: '#E7ECF3' },
        yAxis: [
          { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
          { title: { text: y2Title }, opposite: true, gridLineWidth: 0 },
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
      const hasDualY = series!.some((s: any) => s.yAxis === 1);
      return {
        chart: { type: 'column', backgroundColor: 'transparent', height: 200 },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        ...axes,
        ...(hasDualY ? {
          yAxis: [
            { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
            { title: { text: y2Title }, opposite: true, gridLineWidth: 0 },
          ],
          tooltip: { shared: true },
        } : {}),
        plotOptions: { column: { grouping: true, borderRadius: 4, borderWidth: 0, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } } },
        series: series!,
      };
    }

    // 'column' renders horizontally, matching the Chart Details page.
    const hcBarType = chartType === 'column' ? 'bar' : 'column';
    return {
      chart: { type: hcBarType, backgroundColor: 'transparent', height: 200 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      ...axes,
      plotOptions: { [hcBarType]: { borderRadius: isStacked ? 0 : 3, borderWidth: 0, colorByPoint: !hasMulti, colors: hasMulti ? undefined : cats.map((_c, i) => CHART_COLORS[i % CHART_COLORS.length]), stacking: isStacked ? 'normal' as any : undefined, dataLabels: { enabled: false } } },
      series: hasMulti ? series : [{ type: hcBarType, name: title, data: vals, showInLegend: false }],
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
        case 'grouped':
          out.type = 'column';
          if (isComboLine) out.yAxis = 1;
          break;
        case 'bar':
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
    if (type === 'table') {
      this.cdr.markForCheck();
      return;
    }
    const data = this.chartAggData[id];
    if (data) {
      this.chartPreviewOptions[id] = {};
      this.cdr.detectChanges();
      this.chartPreviewOptions[id] = applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(type, data.cats, data.vals, data.title, data.multiSeries), data.sort), this.chartShowDataLabels[id]));
    }
    this.cdr.markForCheck();
  }

  getChartLegendItems(id: string): { name: string; color: string }[] {
    const data = this.chartAggData[id];
    if (!data) return [];
    if (data.multiSeries?.length) {
      return data.multiSeries.map((s, i) => ({
        name: (s as any).name ?? `Series ${i + 1}`,
        color: (s as any).color ?? CHART_COLORS[i % CHART_COLORS.length],
      }));
    }
    const ct = (this.cardChartType[id] ?? '').toLowerCase();
    if (ct === 'pie' || ct === 'doughnut') {
      return data.cats.map((c, i) => ({ name: c, color: CHART_COLORS[i % CHART_COLORS.length] }));
    }
    return [];
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
        series: [{ type: 'pie', data: data.cats.map((c, i) => ({ name: c, y: data.vals[i] ?? 0, color: CHART_COLORS[i % CHART_COLORS.length] })).filter(d => d.y !== 0) }],
      };
    }

    if (type === 'line' || type === 'multiline' || type === 'spline') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'line' as any, color: CHART_COLORS[0], data: data.vals, marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'line' }, plotOptions: { line: { marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }

    if (type === 'trend' || type === 'area') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'areaspline' as any, color: CHART_COLORS[0], fillOpacity: 0.15, data: data.vals, marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'areaspline' }, plotOptions: { areaspline: { fillOpacity: 0.15, marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }

    const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
      ? data.multiSeries.map(s => ({ ...s } as Highcharts.SeriesOptionsType))
      : [{ type: 'column' as any, data: data.cats.map((_c, i) => ({ y: data.vals[i] ?? 0, color: CHART_COLORS[i % CHART_COLORS.length] })), enableMouseTracking: false } as Highcharts.SeriesOptionsType];
    return { ...base, chart: { ...base.chart, type: 'column' }, plotOptions: { column: { borderWidth: 0, borderRadius: 1, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
  }

  private buildChartTableData(id: string): { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] } {
    const data = this.chartAggData[id];
    if (!data) return { headers: [], rows: [], rowColors: [], rowBgColors: [] };
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
    const allCharts = [...this.standardCharts, ...this.myCharts];
    const selected = allCharts.filter(c => this.selectedChartIds.has(c.id));

    for (const chart of selected) {
      if (this.boardItems.some(i => i.kind === 'chart' && !i.empty && i.data?.id === chart.id)) continue;
      const emptySlot = this.boardItems.find(i => i.kind === 'chart' && i.empty);
      if (emptySlot) {
        emptySlot.data = chart;
        emptySlot.empty = false;
        emptySlot.dragEnabled = true;
        emptySlot.resizeEnabled = true;
      } else {
        this.boardItems.push(this.makeFilledItem('chart', chart));
      }
      // Ensure a preview exists for the placed chart even if its card was never scrolled to.
      this.loadChartPreview(chart);
    }

    this.selectedChartIds.clear();
    this.closeChartsModal();
    this.syncChartPlaceholders();
  }

  // ─── Clear All ────────────────────────────────────────────
  requestClearAll(): void {
    this.initBoardLayout();
    this.clearAdvancedFilters();
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

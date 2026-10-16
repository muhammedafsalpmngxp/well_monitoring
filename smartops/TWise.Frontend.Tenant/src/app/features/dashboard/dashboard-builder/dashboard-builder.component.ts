import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { inferPlantFilter, isPlantFilter } from '../../../core/utils/plant-filter.util';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, takeUntil, tap } from 'rxjs/operators';
import { waitForDashboardRender } from '../../../core/utils/dashboard-render-ready.util';
import type Highcharts from 'highcharts';
import { AdvancedChartPayload, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { CompactType, DisplayGrid, Gridster, GridsterConfig, GridsterItemConfig, GridType } from 'angular-gridster2';
import { CategoryService } from '../../../core/services/category.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { ChartSource, WidgetService } from '../../../core/services/widget.service';
import { AiDataset, AiFilterSuggestChart, AiFilterSuggestion, AiService } from '../../../core/services/ai.service';
import { AiChartPresetService } from '../../../core/services/ai-chart-preset.service';
import { ImportedDatasetService } from '../../../core/services/imported-dataset.service';
import { normalizeAdvancedChartType } from '../../../core/utils/advanced-chart.util';
import { DashboardSavedFilterService } from '../../../core/services/dashboard-saved-filter.service';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { AuthService } from '../../../core/services/auth.service';
import { DashboardBranding, normalizeDashboardBranding, DashboardConfigWidget, DashboardLayoutConfig, DashboardLayoutItem, SaveDashboardRequest, WidgetLibraryItem } from '../../../core/models/dashboard.model';
import { CategoryDropdown } from '../../../core/models/category.model';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { ChartView, ChartViewIcon, chartSwitchOptions, chartViewIcon, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { appendDaxToChartData, getActiveDaxMeasures, appendDaxToTableRows, getDaxRowColumnMeasures, DaxModelConfig, evaluateTileDaxValue, formatDaxValue, getSelectedDaxMeasure } from '../../../core/utils/dax-evaluator.util';
import { applyConditionalFilters, getSavedConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { applyParameterFilters, getSavedParameterFilters, remapDesignColumns } from '../../../core/utils/parameter-filter.util';
import { appendLockedFilterTitle } from '../../../core/utils/locked-filter-title.util';
import { CustomDashboardFilter, DashboardChartFilter, mergeDashboardSharedFilters } from '../../../core/utils/dashboard-shared-filter.util';
import { hasFutureDateParameter } from '../../../core/utils/view-date-parameters.util';
import { getLayoutRowLimit, matchPersistedLayoutItems, migrateLegacyWidgetsToLayout, sanitizePersistedLayout, DEFAULT_LAYOUT_COLUMNS, DEFAULT_TILE_COLUMNS, DEFAULT_TILE_ROWS, DEFAULT_CHART_ROWS } from '../../../core/utils/dashboard-layout.util';
import { CHART_AUTO_COLORS, chartFallbackColor, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';

const CHART_COLORS = [...CHART_AUTO_COLORS];
const ROW_BG_COLORS  = ['#F3F6FF', '#EBFFF2', '#FFFAF1', '#FFF1F1', '#E8F8FF'];
const ROW_DOT_COLORS = ['#1E3A8A', '#49D67D', '#F5A623', '#DC2626', '#38BDF8'];
type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES = new Set(['line', 'multiline', 'grouped', 'stacked', 'area']);

export type TileAccent = 'blue' | 'green' | 'red' | 'purple';

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

/** A dashboard-wide filter added from the "Filters" panel, promoted from one of the placed charts' dropdown filters. */
export type { CustomDashboardFilter } from '../../../core/utils/dashboard-shared-filter.util';

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

export interface ChartSelectorItem {
  id: string;               // unique per-slot key (used for preview/UI keying)
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
  widgetId?: number;        // real widget-library id persisted as chartId
  baseTitle?: string;       // original widget name; title may add a "-value" suffix on clones
  presetColumn?: string;    // clone: local-filter column to pre-filter by
  presetValue?: string;     // clone: value to pre-filter to
  isClone?: boolean;        // clones can't be re-cloned
}

export interface BuilderTab {
  id: string;
  label: string;
}

interface EditorGridItem extends GridsterItemConfig {
  id: string;
  zone: 'tile' | 'chart';
  index: number;
  chartSlotId?: string;
}

interface BuilderBoardSnapshot {
  tileSlots: (TileSelectorItem | null)[];
  chartSlotsData: ChartSelectorItem[];
}

@Component({
  selector: 'app-dashboard-builder',
  standalone: false,
  templateUrl: './dashboard-builder.component.html',
  styleUrls: ['./dashboard-builder.component.scss'],
})
export class DashboardBuilderComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(Gridster) private editorGridster?: Gridster;
  private pendingRevealChartId: string | null = null;
  // ─── Filter bar ───────────────────────────────────────────
  filterBarVisible = true;
  country = '';
  sector = '';
  businessUnit = '';
  division = '';
  cluster = 'All';
  plant = 'All';
  // Same default as the dashboard view page: from Jan 1 of this year to the last Tuesday.
  fromDate = `${new Date().getFullYear()}-01-01`;
  toDate = this.lastTuesday(new Date());
  quickRange = '';
  openFilterName: string | null = null;
  /** Extra dashboard-wide filters the editor adds from the right-side "Filters" panel (on top of country/sector/etc). */
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
    this.onGlobalDateChange();
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
  activePresetId: number | null = null;
  openPresetMenuId: number | null = null;
  savedFilterPresets: SavedFilterPreset[] = [];
  private readonly presetAccents: SavedFilterPreset['accent'][] = ['purple', 'green', 'orange', 'yellow'];

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

  toggleSavedFilterList(event: Event): void {
    event.stopPropagation();
    this.showSavedFilterList = !this.showSavedFilterList;
    if (this.showSavedFilterList && this.dashboardId) {
      this.savedFilterService.getAll(this.dashboardId).pipe(takeUntil(this.destroy$)).subscribe(filters => {
        this.savedFilterPresets = filters.map((f, i) => ({
          id: f.id,
          name: f.filterName,
          accent: this.presetAccents[i % this.presetAccents.length],
          country: f.country ?? '',
          sector: f.sector ?? '',
          businessUnit: f.businessUnit ?? '',
          division: f.division ?? '',
          cluster: f.cluster ?? '',
          plant: f.plant ?? '',
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
        this.notify.showSuccess(`'${preset.name}' deleted successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showDeletePresetConfirm = false;
        this.presetPendingDelete = null;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to delete filter.');
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
        country: saved.country ?? '',
        sector: saved.sector ?? '',
        businessUnit: saved.businessUnit ?? '',
        division: saved.division ?? '',
        cluster: saved.cluster ?? '',
        plant: saved.plant ?? '',
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

  // ─── Toolbar ─────────────────────────────────────────────
  pageName = 'Overview';
  dashboardDescription = '';
  descriptionValidationError = '';
  editingPageName = false;
  editingDescription = false;
  category = '';
  showCategoryDropdown = false;
  locked = false;
  zoomLevel = 100;
  panelCollapsed = false;

  categories: string[] = [];
  apiCategories: CategoryDropdown[] = [];
  private categorySub!: Subscription;
  private readonly destroy$ = new Subject<void>();
  private _prevSidebarState: boolean | undefined;
  private returnUrl = '/dashboard/wip-boards';

  // ─── Edit mode ────────────────────────────────────────────
  dashboardId: number | null = null;
  isEditMode = false;
  private loadedCategoryId: number | null = null;
  private isInternalSharedDashboard = false;
  dashboardStatus = '';
  isSaving = false;
  isLoadingDashboard = false;

  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  get saveError(): string { return this.notify.error; }

  // ─── Canvas layout ────────────────────────────────────────
  layout: '2x2' | '3x3' | '4x4' = '2x2';
  layoutExplicitlySet = false;

  tileSlots: (TileSelectorItem | null)[] = [null, null, null, null, null];
  chartSlotsData: ChartSelectorItem[] = [];
  unifiedLayout: DashboardLayoutConfig = { version: 1, columns: 20, items: [] };
  editorGridItems: EditorGridItem[] = [];
  editorGridsterOptions: GridsterConfig = {};
  /** Height of all grid rows (rows x (row height + margin) + outer margin). Gridster is
   *  `height: 100%` with absolutely-positioned items, so without this it collapses to 0 once
   *  the page scrolls as a whole (tablet/phone) instead of inside the canvas. */
  get editorGridMinHeight(): number {
    const { minRows = 0, fixedRowHeight = 24, margin = 8 } = this.editorGridsterOptions;
    return minRows * (fixedRowHeight + margin) + margin;
  }

  // Without trackBy, Angular's default NgForOf differ can't tell several
  // simultaneous null→object slot changes apart (nulls have no identity),
  // so only some of the newly-added tiles get rendered. Tracking by the
  // item's own id (falling back to position for an empty slot) fixes it.
  trackByTileSlot(index: number, slot: TileSelectorItem | null): string {
    return slot ? slot.id : `empty-${index}`;
  }

  trackByChartSlot(_index: number, slot: ChartSelectorItem): string {
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
  get emptyChartSlots(): null[] { return new Array(Math.max(0, this.chartSlotCount - this.chartSlotsData.length)).fill(null); }
  get effectiveColumns(): number {
    if (this.layout === '4x4') return 4;
    return this.layout === '3x3' ? 3 : 2;
  }

  private buildLegacyWidgets(): Array<{ chartId: number; sortOrder: number; type: 'tile' | 'chart'; width?: number | null; height?: number | null; x?: number | null; y?: number | null }> {
    const tileCount = this.tileSlots.filter(Boolean).length;
    return [
      ...this.tileSlots.filter(Boolean).map((tile, index) => ({
        chartId: Number(tile!.id) || 0,
        sortOrder: index + 1,
        type: 'tile' as const,
        width: tile!.width ?? null,
        height: tile!.height ?? null,
        x: tile!.x ?? null,
        y: tile!.y ?? null,
      })),
      ...this.chartSlotsData.map((chart, index) => ({
        chartId: Number(chart.widgetId ?? chart.id) || 0,
        sortOrder: tileCount + index + 1,
        type: 'chart' as const,
        width: chart.width ?? null,
        height: chart.height ?? null,
        x: chart.x ?? null,
        y: chart.y ?? null,
      })),
    ];
  }

  private syncUnifiedLayout(): void {
    // Each chart's x/y/width/height is persistent user state (see onEditorGridItemChange),
    // carried on the slot itself and reused verbatim by migrateLegacyWidgetsToLayout — adding or
    // removing a tile/chart elsewhere must never recompute or reflow an already-placed chart.
    // Only a chart with no stored position yet (brand new) gets a default spot assigned, right
    // below the lowest edge of whatever's already placed — see the shared util for that math.
    // (This replaces an older per-pixel collision-scan that incremented y one row-unit at a time
    // to dodge existing 16-row-tall charts, which is what produced the large empty gaps and
    // uneven positions once a 3rd chart was added.)
    this.unifiedLayout = migrateLegacyWidgetsToLayout(this.buildLegacyWidgets(), this.effectiveColumns);
    const tilesPerRow = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / DEFAULT_TILE_COLUMNS));
    const tileCount = Math.max(5, this.tileSlots.length);
    const chartCount = Math.max(this.chartSlotCount, this.chartSlotsData.length);
    const chartWidth = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / this.chartSlotCount));
    const tileRowCount = this.tileSlots.length ? Math.ceil(this.tileSlots.length / tilesPerRow) : 0;
    const chartStartY = tileRowCount * DEFAULT_TILE_ROWS;
    const items: EditorGridItem[] = [];
    let tileOrdinal = 0;
    for (let index = 0; index < tileCount; index += 1) {
      // A tile's sortOrder counts only populated slots (see buildLegacyWidgets), so an empty slot
      // earlier in tileSlots must not shift every later tile onto its neighbour's saved position.
      const sortOrder = this.tileSlots[index] ? ++tileOrdinal : -1;
      const layout = this.unifiedLayout.items.find(item => item.type === 'tile' && item.sortOrder === sortOrder);
      items.push({
        id: `tile-${index}`, zone: 'tile', index,
        x: layout?.x ?? (index % tilesPerRow) * DEFAULT_TILE_COLUMNS,
        y: layout?.y ?? Math.floor(index / tilesPerRow) * DEFAULT_TILE_ROWS,
        cols: layout?.cols ?? DEFAULT_TILE_COLUMNS,
        rows: layout?.rows ?? DEFAULT_TILE_ROWS,
        dragEnabled: true, resizeEnabled: true,
      });
    }
    for (let index = 0; index < chartCount; index += 1) {
      const layout = this.unifiedLayout.items.find(item => item.type === 'chart' && item.sortOrder === this.tileSlots.filter(Boolean).length + index + 1);
      items.push({
        id: `chart-${index}`, zone: 'chart', index, chartSlotId: this.chartSlotsData[index]?.id,
        x: layout?.x ?? (index % this.chartSlotCount) * chartWidth,
        y: layout?.y ?? chartStartY + Math.floor(index / this.chartSlotCount) * DEFAULT_CHART_ROWS,
        cols: layout?.cols ?? chartWidth,
        rows: layout?.rows ?? DEFAULT_CHART_ROWS,
        dragEnabled: true, resizeEnabled: true,
      });
    }
    this.editorGridItems = items;
    // Reassign (new object reference, so the OnPush [options] input actually picks it up) with
    // the row count the current content needs, instead of the fixed minRows:21 floor — otherwise
    // a board with only a couple of charts still reserves a near-empty canvas below them.
    this.editorGridsterOptions = { ...this.editorGridsterOptions, minRows: this.computeEditorMinRows(), maxRows: getLayoutRowLimit(this.unifiedLayout.items) };
    this.refreshEditorGrid();
    this.commitUndoPoint();
  }

  private computeEditorMinRows(): number {
    const tilesPerRow = Math.max(1, Math.floor(DEFAULT_LAYOUT_COLUMNS / DEFAULT_TILE_COLUMNS));
    const tileRowCount = this.tileSlots.length ? Math.ceil(this.tileSlots.length / tilesPerRow) : 0;
    // Only real (rendered) slots — editorGridItems also carries unrendered placeholder entries
    // out past the actual tile/chart count, which would otherwise skew this estimate.
    const contentBottom = this.editorGridItems.reduce((max, item) => {
      const isReal = item.zone === 'tile' ? item.index < this.tileSlots.length : item.index < this.chartSlotsData.length;
      return isReal ? Math.max(max, item.y + item.rows) : max;
    }, 0);
    return Math.max(DEFAULT_TILE_ROWS, tileRowCount * DEFAULT_TILE_ROWS, contentBottom);
  }

  editorGridItem(zone: 'tile' | 'chart', index: number): EditorGridItem {
    return this.editorGridItems.find(item => item.zone === zone && item.index === index)!;
  }

  /**
   * The inline data table only fits when the card is tall enough for header, chart (180px floor),
   * legend and table together; below that the table would squeeze the chart out, so it is dropped.
   * 14 rows × 24px ≈ 340px of content.
   */
  hasRoomForDataTable(chartIndex: number): boolean {
    return (this.editorGridItem('chart', chartIndex)?.rows ?? 16) >= 14;
  }

  private buildEditorGridsterOptions(): GridsterConfig {
    return {
      gridType: GridType.VerticalFixed, fixedRowHeight: 24, displayGrid: DisplayGrid.OnDragAndResize,
      compactType: CompactType.None, minCols: 20, maxCols: 20, minRows: this.computeEditorMinRows(), maxRows: getLayoutRowLimit(this.unifiedLayout?.items ?? []),
      outerMargin: true, margin: 8, pushItems: true, swap: true,
      disableScrollVertical: true,
      draggable: { enabled: true, ignoreContentClass: 'board-no-drag', ignoreContent: false },
      resizable: { enabled: true }, itemChangeCallback: this.onEditorGridItemChange,
      itemResizeCallback: this.onEditorGridItemChange,
    };
  }

  /** True for one click right after a Gridster drag/resize, so the resulting native click
   *  doesn't reopen the tile/chart selector on an empty slot that was just repositioned. */
  suppressEmptySlotClick = false;

  private onEditorGridItemChange = (item: GridsterItemConfig): void => {
    this.suppressEmptySlotClick = true;
    setTimeout(() => { this.suppressEmptySlotClick = false; }, 0);
    const gridItem = this.editorGridItems.find(candidate => candidate.id === item['id']);
    if (!gridItem) return;
    this.scheduleGridUndoPoint();
    gridItem.x = item.x; gridItem.y = item.y; gridItem.cols = item.cols; gridItem.rows = item.rows;
    // Persisted on the chart itself (not just editorGridItems, which gets rebuilt from scratch
    // on every syncUnifiedLayout call) so a manual drag or resize survives adding/removing an
    // unrelated tile or chart elsewhere instead of snapping back to a recomputed spot/size.
    if (gridItem.zone === 'chart') {
      const slot = this.chartSlotsData[gridItem.index];
      if (slot) {
        slot.width = item.cols;
        slot.height = item.rows;
        slot.x = item.x;
        slot.y = item.y;
      }
    } else {
      const slot = this.tileSlots[gridItem.index];
      if (slot) {
        slot.x = item.x;
        slot.y = item.y;
        slot.width = item.cols;
        slot.height = item.rows;
      }
    }
    this.cdr.markForCheck();
    // Charts are decoupled from flow (position:absolute); nudge Highcharts to
    // redraw into the card's new Gridster size once the layout has settled.
    this.scheduleChartReflow();
  };

  /** Reflow Highcharts after Gridster commits the new cell size (two frames:
   *  apply the new dimensions, then reflow into the settled box). */
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
    if (payload.kind === 'tile') {
      const tile = [...this.standardTiles, ...this.myTiles].find(candidate => candidate.id === payload.id);
      if (!tile || this.tileSlots.some(candidate => candidate?.id === tile.id)) return;
      const index = targetIndex !== undefined && !this.tileSlots[targetIndex] ? targetIndex : this.tileSlots.indexOf(null);
      if (index >= 0) this.tileSlots[index] = tile;
      else this.tileSlots.push(tile);
      this.loadTilePreview(tile);
    } else {
      const chart = [...this.standardCharts, ...this.myCharts].find(candidate => candidate.id === payload.id);
      if (!chart || this.chartSlotsData.some(candidate => candidate.id === chart.id)) return;
      const index = targetIndex !== undefined ? Math.min(targetIndex, this.chartSlotsData.length) : this.chartSlotsData.length;
      this.chartSlotsData.splice(index, 0, { ...chart });
      this.loadChartPreview(chart);
    }
    this.syncUnifiedLayout();
    this.cdr.markForCheck();
  }

  private refreshEditorGrid(): void { setTimeout(() => this.editorGridster?.updateGrid(), 320); }

  ngAfterViewInit(): void { this.refreshEditorGrid(); }

  private get defaultChartCardWidth(): number {
    if (this.layout === '4x4') return 260;
    if (this.layout === '3x3') return 340;
    return 500;
  }

  private get defaultChartCardHeight(): number {
    if (this.layout === '4x4') return 230;
    if (this.layout === '3x3') return 260;
    return 300;
  }

  normalizeChartSlotSizes(): void {
    this.chartSlotsData.forEach((slot) => {
      if (!slot.width) slot.width = this.defaultChartCardWidth;
      if (!slot.height) slot.height = this.defaultChartCardHeight;
    });
    this.cdr.markForCheck();
  }

  // ─── Right panel ──────────────────────────────────────────
  activePanel: 'widgets' | 'filters' | 'tiles' | 'charts' | 'styling' | null = null;

  // ─── Page tabs ────────────────────────────────────────────
  tabs: BuilderTab[] = [{ id: 'tab-1', label: 'Overview' }];
  activeTabId = 'tab-1';
  private nextTabIndex = 2;

  get breadcrumbs() {
    return [
      { label: 'Home', route: '/' },
      { label: 'Dashboard' },
      { label: this.isAdmin ? 'WIP Boards' : 'My Boards', route: '/dashboard/wip-boards' },
      { label: this.isEditMode ? 'Edit Dashboard' : 'New Dashboard' },
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
    private readonly authService: AuthService,
    private readonly layoutState: LayoutStateService,
    private readonly cdr: ChangeDetectorRef,
    private readonly location: Location,
    private readonly ai: AiService,
    private readonly presets: AiChartPresetService,
    private readonly importedDatasets: ImportedDatasetService,
  ) {
    this.notify = new NotificationHelper(cdr);
    this.ai.features().pipe(takeUntil(this.destroy$)).subscribe(f => {
      this.canSuggestFilters = f.enabled.includes('filters');
      this.canGenerate = f.enabled.includes('dashboard');
      this.cdr.markForCheck();
    });
  }

  /** Every placed chart with its rendered options, for the dashboard-level Explain. */
  get explainCharts(): { title: string; options: Highcharts.Options | null }[] {
    return this.chartSlotsData.map(s => ({ title: s.baseTitle ?? s.title, options: this.chartPreviewOptions[s.id] ?? null }));
  }

  // ── Dashboard from a prompt ────────────────────────────────────────────────
  canGenerate = false;
  showGenerateModal = false;
  generateDatasets: AiDataset[] = [];
  generateKey = '';
  generateGoal = '';
  generateBusy = false;
  generateStatus = '';
  generateError = '';

  openGenerate(): void {
    this.showGenerateModal = true;
    this.generateError = this.generateStatus = '';
    this.cdr.markForCheck();
    if (!this.generateDatasets.length)
      this.ai.datasets().pipe(takeUntil(this.destroy$)).subscribe({ next: d => { this.generateDatasets = d; this.cdr.markForCheck(); }, error: () => {} });
  }

  /**
   * Profile the chosen dataset → ask for a title and up to six charts → create each as a draft chart
   * widget → place them on the canvas like a library selection. Nothing is saved until the user saves.
   */
  generateDashboard(): void {
    const [type, idText] = this.generateKey.split(':');
    const goal = this.generateGoal.trim();
    if (!type || !goal || this.generateBusy) return;
    const sourceId = Number(idText);
    const dataset = this.generateDatasets.find(d => `${d.sourceType}:${d.sourceId}` === this.generateKey);
    const isView = type === 'view';
    this.generateBusy = true;
    this.generateError = '';
    this.generateStatus = 'Reading the dataset…';
    this.cdr.markForCheck();

    const rows$ = isView
      ? this.commonApi.getDatabaseViewById(sourceId).pipe(switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: view.generatedSql, viewId: view.id, maxRows: 1000 })))
      : this.importedDatasets.getData(sourceId);
    rows$.pipe(
      switchMap(res => {
        const rows = (res.rows ?? []).slice(0, 1000);
        const columns: AiFilterSuggestChart['columns'] = {};
        for (const col of res.columns ?? []) {
          const distinct = new Set(rows.map(r => String(r[col] ?? '')).filter(v => v !== ''));
          columns[col] = { distinct: distinct.size, samples: [...distinct].slice(0, 5) };
        }
        this.generateStatus = 'Designing the dashboard…'; this.cdr.markForCheck();
        return forkJoin({
          plan: this.ai.dashboardSuggest({ sourceName: dataset?.name ?? String(sourceId), rowCount: rows.length, columns, chartTypes: ['table', 'pie', 'donut', 'bar', 'line', 'stacked', 'area', 'column'], goal }),
          library: this.widgetService.getWidgetLibraryCharts(),
          categories: this.categoryService.getCategoriesByType('chart'),
        });
      }),
      switchMap(({ plan, library, categories }) => {
        if (!plan.charts.length) throw new Error('The AI could not propose any chart for this dataset.');
        this.generateStatus = `Creating ${plan.charts.length} charts…`; this.cdr.markForCheck();
        if (!this.pageName.trim() || this.pageName === 'Overview') this.pageName = plan.title;
        const creates = plan.charts.map(s => {
          const lib = library.find(i => normalizeAdvancedChartType(i.widgetName) === s.patch.chartType);
          if (!lib) return of(null);
          const payload = this.presets.widgetPayload({
            sourceType: type as 'view' | 'import', sourceId, sourceName: dataset?.name ?? '', title: s.patch.title || 'Chart',
            chartType: s.patch.chartType!, xAxis: s.patch.xAxis!, yAxis: s.patch.yAxis ?? 'Count (F)', yAggColumn: s.patch.yAggColumn ?? '', topN: s.patch.topN ?? null,
          });
          return this.widgetService.createWidget({
            name: s.patch.title || 'Chart', description: s.reason, type: 'chart', libraryId: lib.id,
            source: payload.source, sourceType: payload.sourceType, sourceId: payload.sourceId, designJson: payload.designJson,
            categoryId: categories[0]?.categoryId || 2,
          }).pipe(catchError(() => of(null)));
        });
        return forkJoin(creates);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: widgets => {
        const created = widgets.filter((w): w is NonNullable<typeof w> => !!w);
        for (const w of created) {
          const item = this.mapWidgetToChartItem({ ...w, status: w.status ?? 'draft' } as unknown as WidgetLibraryItem);
          this.myCharts = [item, ...this.myCharts];
          if (!this.chartSlotsData.some(s => s.id === item.id)) { this.chartSlotsData.push({ ...item }); this.loadChartPreview(item); }
        }
        this.syncUnifiedLayout();
        this.generateBusy = false;
        this.showGenerateModal = false;
        this.notify.showSuccess(`${created.length} charts placed. Arrange them and save the dashboard.`);
        this.cdr.markForCheck();
      },
      error: err => { this.generateBusy = false; this.generateStatus = ''; this.generateError = err?.error?.message ?? err?.message ?? 'The dashboard could not be generated.'; this.cdr.markForCheck(); },
    });
  }

  // ── AI-suggested dashboard filters ─────────────────────────────────────────
  canSuggestFilters = false;
  suggestingFilters = false;
  filterSuggestions: AiFilterSuggestion[] | null = null;
  filterSuggestError = '';

  /**
   * Profiles every distinct source of the placed charts (distinct count + samples per column, from
   * the first 1000 rows) and asks the AI which columns deserve a dashboard-wide filter.
   */
  suggestFilters(): void {
    const sources = new Map<string, { title: string; sourceTable: string; sourceType: string }>();
    for (const slot of this.chartSlotsData) {
      if (!slot.source || sources.has(slot.source)) continue;
      sources.set(slot.source, { title: slot.baseTitle ?? slot.title, sourceTable: slot.source, sourceType: slot.sourceType || 'Table' });
    }
    if (!sources.size) { this.filterSuggestError = 'Place a chart first.'; return; }
    this.suggestingFilters = true;
    this.filterSuggestError = '';
    this.filterSuggestions = null;
    const loads = [...sources.values()].map(s => this.widgetService.getTableData(s.sourceTable, s.sourceType).pipe(
      catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
    ));
    forkJoin(loads).pipe(
      switchMap(results => {
        const charts: AiFilterSuggestChart[] = [...sources.values()].map((s, i) => {
          const rows = (results[i].rows ?? []).slice(0, 1000);
          const columns: AiFilterSuggestChart['columns'] = {};
          for (const col of results[i].columns ?? []) {
            const values = rows.map(r => String(r[col] ?? '')).filter(v => v !== '');
            const distinct = new Set(values);
            columns[col] = { distinct: distinct.size, samples: [...distinct].slice(0, 5) };
          }
          return { title: s.title, sourceTable: s.sourceTable, sourceType: s.sourceType, columns };
        }).filter(c => Object.keys(c.columns).length);
        return this.ai.suggestFilters({ dashboardName: this.pageName?.trim() || 'Dashboard', charts, alreadyAdded: this.customFilters.map(f => `${f.sourceTable}.${f.sourceColumn}`) });
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: s => { this.filterSuggestions = s.filter(x => !this.customFilters.some(f => f.id === this.customFilterId(x.sourceTable, x.sourceColumn))); this.suggestingFilters = false; this.cdr.markForCheck(); },
      error: err => { this.filterSuggestError = err?.error?.message ?? 'Suggestions could not be loaded.'; this.suggestingFilters = false; this.cdr.markForCheck(); },
    });
  }

  addSuggestedFilter(s: AiFilterSuggestion): void {
    this.addCustomFilter({ label: s.label, sourceTable: s.sourceTable, sourceColumn: s.sourceColumn });
    this.filterSuggestions = (this.filterSuggestions ?? []).filter(x => x !== s);
  }

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get wipChartsLabel(): string { return this.isAdmin ? 'WIP Charts' : 'My Charts'; }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const idParam = this.route.snapshot.paramMap.get('id') || params.get('dashboardId');
    if (idParam) {
      this.dashboardId = Number(idParam);
      this.isEditMode = true;
    }
    this.returnUrl = params.get('returnUrl') || this.returnUrl;
    const category = params.get('category');
    if (category) this.category = category;
    this.pageName = params.get('name') || (this.isEditMode ? '' : 'Overview');
    this.tabs[0].label = this.pageName;
    const description = params.get('description');
    if (description) this.dashboardDescription = description;
    // AI "add to dashboard": the chart to add once the dashboard has loaded.
    this.pendingAddChartId = params.get('addChartId');

    this.editorGridsterOptions = this.buildEditorGridsterOptions();
    this.syncUnifiedLayout();
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();

    this.layoutState.sidebarCollapsed$.pipe(takeUntil(this.destroy$)).subscribe(collapsed => {
      this.panelCollapsed = !collapsed;
      this.refreshEditorGrid();
      this.cdr.markForCheck();
    });

    this.categorySub = this.categoryService.getCategoriesByType('dashboard').subscribe(cats => {
      const currentCategory = this.apiCategories.find(category => category.categoryName === this.category);
      this.apiCategories = currentCategory && !cats.some(category => category.categoryId === currentCategory.categoryId)
        ? [...cats, currentCategory]
        : cats;
      this.categories = this.apiCategories.map(category => category.categoryName);
      // In edit mode the saved dashboard's own category is authoritative – never pre-fill the first list entry.
      if (!this.isEditMode && !this.category && this.categories.length > 0) this.category = this.categories[0];
      this.cdr.markForCheck();
    });

    if (this.dashboardId !== null) {
      this.loadDashboard(this.dashboardId);
    } else {
      this.loadWidgetLibrary();
    }
    this.restoreFilterState();
    this.loadPlantFilters();
  }

  ngOnDestroy(): void {
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.categorySub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.additionalFilterColumnRequests.complete();
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
    this.notify.destroy();
  }

  // ─── Toolbar ─────────────────────────────────────────────
  startEditPageName(): void { this.editingPageName = true; }
  stopEditPageName(): void  { this.editingPageName = false; if (!this.pageName.trim()) this.pageName = 'Overview'; }

  startEditDescription(): void { this.editingDescription = true; }
  stopEditDescription(): void  { this.editingDescription = false; }

  toggleCategoryDropdown(): void { this.showCategoryDropdown = !this.showCategoryDropdown; }
  selectCategory(cat: string): void {
    this.category = cat;
    this.showCategoryDropdown = false;
    this.cdr.markForCheck();
  }

  // ─── Filter dropdown ─────────────────────────────────────
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openFilterName) { this.openFilterName = null; this.cdr.markForCheck(); }
    if (this.showSavedFilterList) { this.showSavedFilterList = false; this.cdr.markForCheck(); }
    if (this.openPresetMenuId) { this.openPresetMenuId = null; this.cdr.markForCheck(); }
    if (Object.keys(this.chartTypeMenuOpen).length) { this.chartTypeMenuOpen = {}; this.cdr.markForCheck(); }
    if (Object.keys(this.trendMenuOpen).length) { this.trendMenuOpen = {}; this.cdr.markForCheck(); }
    if (Object.keys(this.chartMenuOpen).length) { this.closeChartMenu(); this.cdr.markForCheck(); }
    if (Object.keys(this.controlsPopoverOpen).length) { this.controlsPopoverOpen = {}; this.cdr.markForCheck(); }
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

  /** Snap a date to the last Tuesday on or before it (ISO string). */
  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const diff = (d.getDay() + 5) % 7;
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

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
    (this as Record<string, unknown>)[field] = value;
    switch (field) {
      case 'country':      this.sector = ''; this.businessUnit = ''; this.division = ''; this.cluster = 'All'; this.plant = 'All'; break;
      case 'sector':       this.businessUnit = ''; this.division = ''; this.cluster = 'All'; this.plant = 'All'; break;
      case 'businessUnit': this.division = ''; this.cluster = 'All'; this.plant = 'All'; break;
      case 'division':     this.cluster = 'All'; this.plant = 'All'; break;
      case 'cluster':      this.plant = 'All'; break;
      case 'quickRange':   this.applyQuickRange(value); break;
    }
    this.rebuildCascadingOptions();
    this.openFilterName = null;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  /** Re-fetches every placed tile/chart's value using the current global filters (view-based sources only, same as the Dashboard viewer). */
  onGlobalDateChange(): void {
    this.reloadPlacedPreviews();
    this.persistFilterState();
  }

  private reloadPlacedPreviews(): void {
    this.tilePreviewReload$.next();
    this.tilePreviewRequests.clear();
    this.tileSlots.forEach(tile => {
      if (!tile) return;
      this.loadTilePreview(tile);
    });
    this.chartSlotsData.forEach(chart => {
      this.loadedChartPreviewIds.delete(chart.id);
      this.loadChartPreview(chart);
    });
  }

  private injectGlobalFilterParams(sql: string, preserveFutureDateRange = false): string {
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
    if (preserveFutureDateRange && hasFutureDateParameter(sql)) return sql;
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
   * @plant params to piggyback on, unlike views) — same mechanism as the live Operations Dashboard.
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

  /** Resets the Add Tiles/Add Charts modal's filter row (shared fields) to their defaults. */
  clearAdvancedFilters(event?: Event): void {
    event?.stopPropagation();
    this.country = '';
    this.sector = '';
    this.businessUnit = '';
    this.division = '';
    this.cluster = 'All';
    this.plant = 'All';
    this.customFilters.forEach(f => f.value = 'All');
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

  /** sessionStorage key for the live filter bar — per-dashboard once known, shared draft bucket before that. */
  private filterStorageKey(): string {
    return `dashboard-builder-filters-${this.dashboardId ?? 'new'}`;
  }

  /** Persists the current filter bar selection so it survives a page refresh (same tab only). */
  private persistFilterState(): void {
    const state = {
      country: this.country, sector: this.sector, businessUnit: this.businessUnit, division: this.division,
      cluster: this.cluster, plant: this.plant, quickRange: this.quickRange,
      fromDate: this.fromDate, toDate: this.toDate, activePresetId: this.activePresetId,
      customFilters: Object.fromEntries(this.customFilters.map(f => [f.id, f.value])),
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
      this.hasRestoredFilterState = true;
      if (state.customFilters) { this.pendingCustomFilterValues = state.customFilters; this.applyPendingCustomFilterValues(); }
    } catch {
      // Corrupt/incompatible stored state — ignore and keep defaults.
    }
  }

  /** Set when restoreFilterState() found a persisted selection — skips the saved default filter fetch on load. */
  private hasRestoredFilterState = false;

  /** Applies the dashboard's shared default filter (set from a previous save), unless a local session state won. */
  private applyDefaultFilterIfAny(dashboardId: number): void {
    if (this.hasRestoredFilterState) return;
    this.savedFilterService.getDefault(dashboardId).pipe(takeUntil(this.destroy$)).subscribe(def => {
      if (!def) return;
      this.country = def.country ?? this.country;
      this.sector = def.sector ?? this.sector;
      this.businessUnit = def.businessUnit ?? this.businessUnit;
      this.division = def.division ?? this.division;
      this.cluster = def.cluster ?? this.cluster;
      this.plant = def.plant ?? this.plant;
      this.quickRange = def.quickRange ?? this.quickRange;
      if (def.fromDate) this.fromDate = this.toDateOnly(def.fromDate);
      if (def.toDate) this.toDate = this.toDateOnly(def.toDate);
      this.cdr.markForCheck();
    });
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
    let filtered = this.allPlants;
    if (this.country) filtered = filtered.filter(p => p.country === this.country);
    this.sectorOptions = this.country ? this.distinctValues(filtered, p => p.sector) : [];
    if (this.sector) filtered = filtered.filter(p => p.sector === this.sector);
    this.buOptions = this.sector ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (this.businessUnit) filtered = filtered.filter(p => p.businessUnit === this.businessUnit);
    this.divisionOptions = this.businessUnit ? this.distinctValues(filtered, p => p.division) : [];
    if (this.division) filtered = filtered.filter(p => p.division === this.division);
    this.clusterOptions = this.division ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving it on 'All'.
    if (this.cluster === 'All' && this.clusterOptions.length === 1) this.cluster = this.clusterOptions[0];
    if (this.cluster && this.cluster !== 'All') filtered = filtered.filter(p => p.cluster === this.cluster);
    this.plantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (this.plant === 'All' && this.plantOptions.length === 1) this.plant = this.plantOptions[0];
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  zoomIn():      void { this.zoomLevel = Math.min(200, this.zoomLevel + 10); this.refreshEditorGrid(); }
  zoomOut():     void { this.zoomLevel = Math.max(50,  this.zoomLevel - 10); this.refreshEditorGrid(); }
  togglePanel(): void { this.panelCollapsed = !this.panelCollapsed; this.refreshEditorGrid(); }

  addPage(): void {
    const id = `tab-${Date.now()}`;
    this.tabs = [...this.tabs, { id, label: `Page ${this.nextTabIndex++}` }];
    this.activeTabId = id;
    this.cdr.markForCheck();
  }

  setActiveTab(id: string): void { this.activeTabId = id; }

  closeTab(tab: BuilderTab): void {
    if (this.tabs.length === 1) return;
    this.tabs = this.tabs.filter(t => t.id !== tab.id);
    if (this.activeTabId === tab.id) this.activeTabId = this.tabs[0].id;
    this.cdr.markForCheck();
  }

  // ─── Header actions ───────────────────────────────────────
  discard(): void { this.router.navigateByUrl(this.returnUrl); }

  saveAndClose(): void { this.saveDashboard(true); }
  saveAsDraft(): void { this.saveDashboard(false); }
  save():        void { this.saveDashboard(false); }

  private saveDashboard(closeAfterSave = false): void {
    if (this.isSaving || this.isLoadingDashboard) return;

    const cat = this.apiCategories.find(c => c.categoryName === this.category);
    const isSharedSave = this.isEditMode && !!this.dashboardId && this.isInternalSharedDashboard;
    const categoryId = cat?.categoryId ?? (isSharedSave ? this.loadedCategoryId : null);
    if (!categoryId) { this.notify.showError('Please select a valid category.'); return; }
    if (!isSharedSave && !this.dashboardDescription.trim()) { this.descriptionValidationError = 'Please enter a description.'; return; }
    this.descriptionValidationError = '';

    this.isSaving = true;
    this.notify.clearError();

    const tileCount = this.tileSlots.filter(Boolean).length;
    const widgets = [
      ...this.tileSlots.filter(Boolean).map((t, i) => ({ chartId: Number(t!.id) || 0, sortOrder: i + 1, type: 'tile' })),
      ...this.chartSlotsData.map((c, i) => ({
        chartId: Number(c.widgetId ?? c.id) || 0,
        sortOrder: tileCount + i + 1,
        type: 'chart',
        width: c.width || null,
        height: c.height || null,
        ...(c.presetColumn ? { presetColumn: c.presetColumn, presetValue: c.presetValue ?? '' } : {}),
      })),
    ];

    const request: SaveDashboardRequest = {
      dashboardName: this.pageName.trim() || 'Untitled Dashboard',
      categoryId,
      description: this.dashboardDescription.trim() || undefined,
      configJson: JSON.stringify({
        widgets, chartColumns: this.effectiveColumns, layout: this.buildPersistedLayout(), branding: this.branding,
        customFilters: this.customFilters.map(({ value, ...filter }) => filter),
      }),
    };

    const wasEditMode = this.isEditMode && !!this.dashboardId;
    const obs$ = wasEditMode
      ? this.dashboardService.updateDashboard(this.dashboardId!, request)
      : this.dashboardService.createDashboard(request);

    obs$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.isSaving = false;
        const savedCopy = wasEditMode && !!response.data?.dashboardId && response.data.dashboardId !== this.dashboardId;
        const action = wasEditMode ? 'updated' : 'saved as draft';
        const name = response.data?.dashboardName || this.pageName;
        this.notify.showSuccess(savedCopy ? response.data!.message : `'${name}' ${action} successfully.`);
        // First save of a new dashboard: switch to edit mode so subsequent saves update instead of re-creating (avoids duplicate-name error)
        if ((!wasEditMode || savedCopy) && response.data?.dashboardId) {
          this.dashboardId = response.data.dashboardId;
          this.isEditMode = true;
          this.location.replaceState(`/dashboard/builder/${response.data.dashboardId}`);
          // Migrate the pre-save filter draft to the now-known dashboard id so a refresh restores it too.
          this.persistFilterState();
          try { sessionStorage.removeItem('dashboard-builder-filters-new'); } catch { /* ignore */ }
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
        if (closeAfterSave) {
          const savedId = this.dashboardId ?? response.data?.dashboardId;
          if (savedId) {
            setTimeout(() => this.router.navigate(['/dashboard/operations-dashboard', savedId], { queryParams: { from: 'wip' } }), 800);
          }
        }
      },
      error: (err) => {
        this.isSaving = false;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to save dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  private buildPersistedLayout(): DashboardLayoutConfig {
    const layout = migrateLegacyWidgetsToLayout(this.buildLegacyWidgets(), this.effectiveColumns);
    const tileIndexes = this.tileSlots.map((slot, index) => slot ? index : -1).filter(index => index >= 0);
    let tileOrdinal = 0;
    let chartOrdinal = 0;
    const items: DashboardLayoutItem[] = layout.items.map(item => {
      const sourceIndex = item.type === 'tile' ? tileIndexes[tileOrdinal++] : chartOrdinal++;
      const gridItem = this.editorGridItems.find(candidate => candidate.zone === item.type && candidate.index === sourceIndex);
      return { ...item, x: gridItem?.x ?? item.x, y: gridItem?.y ?? item.y,
        cols: gridItem?.cols ?? item.cols, rows: gridItem?.rows ?? item.rows };
    });
    return { version: 1, columns: 20, items };
  }

  // ─── Load existing dashboard ──────────────────────────────
  private loadDashboard(id: number): void {
    this.isLoadingDashboard = true;
    forkJoin({
      dashboard: this.dashboardService.getDashboardById(id).pipe(tap(response => {
        if (!response.data) return;
        this.pageName = response.data.dashboardName;
        this.tabs[0].label = response.data.dashboardName || 'Dashboard';
        this.cdr.markForCheck();
      })),
      library:   this.dashboardService.getWidgetLibrary(),
      placedWidgets: this.dashboardService.getDashboardWidgets(id),
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => {
        this.isLoadingDashboard = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: ({ dashboard, library, placedWidgets }) => {
        this.isSaving = false;
        const d = dashboard.data;
        if (!d) {
          this.notify.showError('Failed to load dashboard.');
          return;
        }

        this.populateLibraryArrays(library.tiles ?? [], library.charts ?? []);

        this.category            = d.categoryName;
        this.loadedCategoryId = d.categoryId;
        this.isInternalSharedDashboard = d.categoryName.trim().toLowerCase() === 'shared dashboard';
        if (!this.apiCategories.some(category => category.categoryId === d.categoryId)) {
          this.apiCategories = [...this.apiCategories, { categoryId: d.categoryId, categoryName: d.categoryName }];
          this.categories = this.apiCategories.map(category => category.categoryName);
        }
        this.dashboardStatus     = d.status;
        this.dashboardDescription = d.description || '';

        const tileMap  = new Map([...(library.tiles ?? []), ...(placedWidgets.tiles ?? [])].map(t => [t.id, t]));
        const chartMap = new Map([...(library.charts ?? []), ...(placedWidgets.charts ?? [])].map(c => [c.id, c]));

        let configWidgets: { chartId: number; sortOrder: number; type?: string; width?: number; height?: number; presetColumn?: string; presetValue?: string }[] = [];
        let persistedLayout: DashboardLayoutConfig | undefined;
        this.branding = {};
        if (d.configJson) {
          try {
            const cfg = JSON.parse(d.configJson);
            const userId = Number(this.authService.getCurrentUser()?.userId);
            const sharedUserIds: unknown = cfg._meta?.sharedWithUserIds;
            this.isInternalSharedDashboard ||= Number.isFinite(userId) && Array.isArray(sharedUserIds)
              && sharedUserIds.some(sharedUserId => Number(sharedUserId) === userId);
            this.branding = normalizeDashboardBranding(cfg.branding);
            this.customFilters = ((cfg.customFilters ?? []) as Omit<CustomDashboardFilter, 'value'>[])
              .map(f => ({ ...f, value: 'All' }));
            configWidgets = (cfg.widgets ?? []).sort((a: { sortOrder?: number }, b: { sortOrder?: number }) => (a.sortOrder || 0) - (b.sortOrder || 0));
            persistedLayout = cfg.layout as DashboardLayoutConfig | undefined;

            const normalizedCols = Number(cfg.chartColumns);
            const savedCols = normalizedCols === 4 || normalizedCols === 3 || normalizedCols === 2
              ? normalizedCols
              : 2;

            this.layout = savedCols === 4 ? '4x4' : savedCols === 3 ? '3x3' : '2x2';
            this.layoutExplicitlySet = true;
          } catch { /* ignore */ }
        }

        this.tileSlots    = [null, null, null, null, null];
        this.chartSlotsData = [];
        let tileIdx = 0;

        for (const cw of configWidgets) {
          if (cw.type === 'tile') {
            const w = tileMap.get(cw.chartId);
            if (w) {
              tileIdx += 1;
              const mappedTile = this.mapWidgetToTileItem(w, tileIdx);
              const emptyIdx = this.tileSlots.indexOf(null);
              if (emptyIdx !== -1) this.tileSlots[emptyIdx] = mappedTile;
              else this.tileSlots.push(mappedTile);
            }
          } else {
            const w = chartMap.get(cw.chartId);
            if (w) {
              const item = this.mapWidgetToChartItem(w);
              if (this.chartSlotsData.some(chart => chart.id === item.id)) item.id = this.newCloneSlotId();
              item.width  = cw.width  || undefined;
              item.height = cw.height || undefined;
              if (cw.presetColumn) {
                // Rebuild a clone slot: unique key, preset filter, and "-value" title suffix
                item.id = this.newCloneSlotId();
                item.presetColumn = cw.presetColumn;
                item.presetValue  = cw.presetValue ?? '';
                item.isClone = true;
                item.title = `${item.baseTitle ?? item.title}-${item.presetValue}`;
              }
              this.chartSlotsData.push(item);
            }
          }
        }

        this.applyPendingCustomFilterValues();
        this.syncUnifiedLayout();
        this.applyPersistedLayout(persistedLayout);
        this.resetUndoHistory();
        this.refreshEditorGrid();
        this.applyDefaultFilterIfAny(id);

        // Placed board widgets load their previews lazily as their canvas slots
        // scroll into view (appLazyVisible → onChartVisible / onTileVisible).
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSaving = false;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to load dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  private applyPersistedLayout(layout: DashboardLayoutConfig | undefined): void {
    const sanitized = sanitizePersistedLayout(layout);
    if (!sanitized) return;
    // Matched by stable widget id (see matchPersistedLayoutItems), never by array position — a
    // saved widget that no longer loads must not shift every later widget onto its neighbour's spot.
    const placed = this.buildLegacyWidgets();
    const zoneIndexes = [
      ...this.tileSlots.map((slot, index) => slot ? index : -1).filter(index => index >= 0)
        .map(index => ({ zone: 'tile' as const, index })),
      ...this.chartSlotsData.map((_, index) => ({ zone: 'chart' as const, index })),
    ];
    const matches = matchPersistedLayoutItems(sanitized, placed.map(widget => ({ id: widget.chartId, type: widget.type, sortOrder: widget.sortOrder })));
    matches.forEach((item, position) => {
      if (!item) return;
      const { zone, index } = zoneIndexes[position];
      const target = this.editorGridItems.find(candidate => candidate.zone === zone && candidate.index === index);
      if (!target) return;
      target.x = item.x; target.y = item.y; target.cols = item.cols; target.rows = item.rows;
      // Also written onto the tile/chart slot itself (not just the transient editorGridItems
      // entry), so migrateLegacyWidgetsToLayout treats this widget as already placed on the very
      // next syncUnifiedLayout — otherwise adding/removing anything after load would treat every
      // reloaded tile/chart as brand new and stack them all back at the default position/size.
      const slot = zone === 'chart' ? this.chartSlotsData[index] : this.tileSlots[index];
      if (slot) { slot.x = item.x; slot.y = item.y; slot.width = item.cols; slot.height = item.rows; }
    });

    const maxSavedRow = sanitized.items.reduce((maximum, item) => Math.max(maximum, item.y + item.rows), 0);
    let placeholderX = 0;
    let placeholderY = maxSavedRow;
    let placeholderRowHeight = 0;
    for (const target of this.editorGridItems) {
      const populated = target.zone === 'tile'
        ? !!this.tileSlots[target.index]
        : target.index < this.chartSlotsData.length;
      if (populated) continue;
      const columns = target.cols ?? 1;
      const rows = target.rows ?? 1;
      if (placeholderX + columns > 20) {
        placeholderX = 0;
        placeholderY += placeholderRowHeight;
        placeholderRowHeight = 0;
      }
      target.x = placeholderX;
      target.y = placeholderY;
      placeholderX += columns;
      placeholderRowHeight = Math.max(placeholderRowHeight, rows);
    }
    // minRows was computed from the default positions syncUnifiedLayout assigned before the saved
    // ones were restored; size the canvas to the restored layout instead.
    this.editorGridsterOptions = { ...this.editorGridsterOptions, minRows: this.computeEditorMinRows(), maxRows: getLayoutRowLimit(sanitized.items) };
  }

  private loadWidgetLibrary(): void {
    this.tilesLoading = true;
    this.chartsLoading = true;
    this.dashboardService.getWidgetLibrary().pipe(takeUntil(this.destroy$)).subscribe({
      next: (library) => {
        this.populateLibraryArrays(library.tiles ?? [], library.charts ?? []);
        this.tilesLoading  = false;
        this.chartsLoading = false;
        // Previews are loaded lazily as modal cards scroll into view (onTileVisible/onChartVisible).
        this.cdr.markForCheck();
      },
      error: () => {
        this.tilesLoading  = false;
        this.chartsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private populateLibraryArrays(tiles: WidgetLibraryItem[], charts: WidgetLibraryItem[]): void {
    this.standardTiles  = tiles.filter(t => t.status?.toLowerCase() === 'published').map((t, i) => this.mapWidgetToTileItem(t, i));
    this.myTiles        = tiles.filter(t => t.status?.toLowerCase() === 'draft').map((t, i) => this.mapWidgetToTileItem(t, i));
    this.standardCharts = charts.filter(c => c.status?.toLowerCase() === 'published').map(c => this.mapWidgetToChartItem(c));
    this.myCharts       = charts.filter(c => c.status?.toLowerCase() === 'draft').map(c => this.mapWidgetToChartItem(c));
    this.placePendingChart();
  }

  /** Chart id handed over by the Ask AI panel (?addChartId=): placed once, like a library selection. */
  private pendingAddChartId: string | null = null;

  private placePendingChart(): void {
    const id = this.pendingAddChartId;
    if (!id) return;
    this.pendingAddChartId = null;
    const chart = [...this.myCharts, ...this.standardCharts].find(c => c.id === id);
    if (!chart) { this.notify.showError('The chart to add was not found in your library.'); return; }
    if (!this.chartSlotsData.some(s => s.id === chart.id)) {
      this.chartSlotsData.push({ ...chart });
      this.loadChartPreview(chart);
      this.syncUnifiedLayout();
    }
    this.notify.showSuccess(`'${chart.baseTitle ?? chart.title}' added. Save the dashboard to keep it.`);
    this.cdr.markForCheck();
  }

  selectPanel(panel: 'widgets' | 'filters' | 'tiles' | 'charts' | 'styling'): void {
    this.activePanel = this.activePanel === panel ? null : panel;
    if (panel === 'tiles')   { this.syncTileSelectionFromSlots(); this.showTilesModal  = true; }
    if (panel === 'charts')  { this.syncChartSelectionFromSlots(); this.showChartsModal = true; }
    if (panel === 'filters') { this.showFiltersModal = true; }
    if (panel === 'styling') { this.showStylingModal = true; }
    this.cdr.markForCheck();
  }

  // ─── Styling modal ─────────────────────────────────────────
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

  // ─── Filters panel ─────────────────────────────────────────
  showFiltersModal = false;
  showAdditionalFilterForm = false;
  additionalFilterSources: ChartSource[] = [];
  additionalFilterColumns: string[] = [];
  additionalFilterSource = '';
  additionalFilterColumn = '';
  additionalFilterLabel = '';
  additionalFilterSourcesLoading = false;
  additionalFilterColumnsLoading = false;
  additionalFilterError = '';
  additionalFilterRetry: 'sources' | 'columns' | null = null;
  private additionalFilterRows: Record<string, unknown>[] = [];
  private additionalFilterSourcesLoaded = false;
  private readonly additionalFilterColumnRequests = new Subject<void>();

  openAdditionalFilters(): void {
    this.showAdditionalFilterForm = true;
    this.additionalFilterError = '';
    this.additionalFilterRetry = null;
    if (this.additionalFilterSourcesLoaded || this.additionalFilterSourcesLoading) return;
    this.additionalFilterSourcesLoading = true;
    this.widgetService.getBISources().pipe(
      takeUntil(this.destroy$),
      finalize(() => {
        this.additionalFilterSourcesLoading = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: sources => {
        this.additionalFilterSources = sources;
        this.additionalFilterSourcesLoaded = true;
      },
      error: () => {
        this.additionalFilterError = 'Failed to load filter sources. Please try again.';
        this.additionalFilterRetry = 'sources';
      },
    });
  }

  selectAdditionalFilterSource(sourceName: string): void {
    this.additionalFilterColumnRequests.next();
    this.additionalFilterSource = sourceName;
    this.additionalFilterColumn = '';
    this.additionalFilterColumns = [];
    this.additionalFilterRows = [];
    this.additionalFilterError = '';
    this.additionalFilterRetry = null;
    const source = this.additionalFilterSources.find(candidate => candidate.name === sourceName);
    if (!source) return;
    this.additionalFilterColumnsLoading = true;
    this.widgetService.getTableData(source.name, source.sourceType).pipe(
      takeUntil(this.additionalFilterColumnRequests),
      takeUntil(this.destroy$),
      finalize(() => {
        this.additionalFilterColumnsLoading = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: data => {
        this.additionalFilterColumns = data.columns;
        this.additionalFilterRows = data.rows;
      },
      error: () => {
        this.additionalFilterError = 'Failed to load filter columns. Please try again.';
        this.additionalFilterRetry = 'columns';
      },
    });
  }

  addAdditionalFilter(): void {
    this.additionalFilterRetry = null;
    if (!this.additionalFilterSources.some(source => source.name === this.additionalFilterSource) ||
        !this.additionalFilterColumns.includes(this.additionalFilterColumn)) {
      this.additionalFilterError = 'Please select a valid source and column.';
      return;
    }
    const id = this.customFilterId(this.additionalFilterSource, this.additionalFilterColumn);
    if (this.customFilters.some(filter => filter.id.toLowerCase() === id.toLowerCase())) {
      this.additionalFilterError = 'This field is already added to the dashboard.';
      return;
    }
    this.filterValuesCache[id] = [...new Set(
      this.additionalFilterRows.map(row => String(row[this.additionalFilterColumn] ?? '')).filter(value => value !== ''),
    )].sort((left, right) => left.localeCompare(right));
    this.addCustomFilter({
      label: this.additionalFilterLabel.trim() || this.additionalFilterColumn,
      sourceTable: this.additionalFilterSource, sourceColumn: this.additionalFilterColumn,
      additional: true,
    });
    this.additionalFilterColumn = '';
    this.additionalFilterLabel = '';
    this.additionalFilterError = '';
    this.showAdditionalFilterForm = false;
  }

  retryAdditionalFilterLoading(): void {
    if (this.additionalFilterRetry === 'sources') this.openAdditionalFilters();
    else if (this.additionalFilterRetry === 'columns') this.selectAdditionalFilterSource(this.additionalFilterSource);
  }

  closeFiltersModal(): void {
    this.showFiltersModal = false;
    this.showAdditionalFilterForm = false;
    this.additionalFilterColumnRequests.next();
    this.additionalFilterSource = '';
    this.additionalFilterColumn = '';
    this.additionalFilterLabel = '';
    this.additionalFilterColumns = [];
    this.additionalFilterRows = [];
    this.additionalFilterError = '';
    this.additionalFilterRetry = null;
    this.activePanel = null;
    this.cdr.markForCheck();
  }

  private customFilterId(sourceTable: string, sourceColumn: string): string {
    return `${sourceTable}::${sourceColumn}`;
  }

  /** Dropdown filters already defined on placed charts that aren't yet promoted to a dashboard-wide filter. */
  get availableCustomFilterCandidates(): { label: string; sourceTable: string; sourceColumn: string }[] {
    const added = new Set(this.customFilters.map(f => f.id));
    const seen = new Set<string>();
    const candidates: { label: string; sourceTable: string; sourceColumn: string }[] = [];
    for (const slot of this.chartSlotsData) {
      for (const filter of this.getSlotDropdownFilters(slot)) {
        const id = this.customFilterId(filter.sourceTable, filter.sourceColumn);
        if (added.has(id) || seen.has(id)) continue;
        seen.add(id);
        candidates.push(filter);
      }
    }
    return candidates;
  }

  /** Promotes a chart-local dropdown filter to a shared filter shown in the top filter bar. */
  addCustomFilter(filter: { label: string; sourceTable: string; sourceColumn: string; additional?: boolean }): void {
    const id = this.customFilterId(filter.sourceTable, filter.sourceColumn);
    if (this.customFilters.some(f => f.id === id)) return;
    this.customFilters = [...this.customFilters, { id, ...filter, value: 'All' }];
    this.getFilterValues(filter); // prewarm dropdown options
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  removeCustomFilter(id: string): void {
    this.customFilters = this.customFilters.filter(f => f.id !== id);
    if (this.openFilterName === `custom_${id}`) this.openFilterName = null;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  selectCustomFilterOption(id: string, value: string): void {
    const filter = this.customFilters.find(f => f.id === id);
    if (!filter) return;
    filter.value = value;
    this.openFilterName = null;
    this.reloadPlacedPreviews();
    this.persistFilterState();
    this.cdr.markForCheck();
  }

  private applyPendingCustomFilterValues(): void {
    for (const filter of this.customFilters) {
      const value = this.pendingCustomFilterValues[filter.id];
      if (value) filter.value = value;
    }
  }

  // ─── Tiles modal ──────────────────────────────────────────
  showTilesModal   = false;
  tilesModalTab: 'standard' | 'my' = 'standard';
  tilesSearchTerm  = '';
  selectedTileIds  = new Set<string>();
  tilesLoading     = false;

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
  myTiles:       TileSelectorItem[] = [];

  private readonly accentCycle: TileSelectorItem['accent'][] = ['blue', 'green', 'red', 'purple', 'orange'];

  get filteredTiles(): TileSelectorItem[] {
    const source = this.tilesModalTab === 'standard' ? this.standardTiles : this.myTiles;
    const term   = this.tilesSearchTerm.toLowerCase();
    const result = source.filter(t =>
      (!term || t.title.toLowerCase().includes(term)) &&
      (this.tilesCategoryFilter === 'all' || t.categoryName === this.tilesCategoryFilter));
    return [...result].sort((a, b) => this.tilesSortOption === 'name-asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
  }

  private mapWidgetToTileItem(widget: WidgetLibraryItem, index: number): TileSelectorItem {
    let title    = widget.name;
    let value    = '\u2014';
    let accent   = this.accentCycle[index % this.accentCycle.length];
    let icon: TileSelectorItem['icon'] = 'well';
    let active   = 0;
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
            '#2563EB': 'blue', '#12B76A': 'green', '#D92D20': 'red', '#7C3AED': 'purple', '#F58220': 'orange',
          };
          accent = colorMap[design.tileColor] ?? accent;
        }
        if (design.tileIcon) {
          const iconMap: Record<string, TileSelectorItem['icon']> = {
            'location': 'well', 'check-circle': 'check', 'alert-triangle': 'alert', 'trending-up': 'chart', 'users': 'crew',
          };
          icon = iconMap[design.tileIcon] ?? design.tileIcon;
        }
        if (design.breakdownRows?.length >= 2) {
          active   = Number(design.breakdownRows[0]?.value) || 0;
          inactive = Number(design.breakdownRows[1]?.value) || 0;
          activeLabel   = design.breakdownRows[0]?.label || activeLabel;
          inactiveLabel = design.breakdownRows[1]?.label || inactiveLabel;
        }
        if (design.badgeText) badgeText = design.badgeText;
        if (design.badgeColor && design.badgeColor !== 'none') badgeColor = design.badgeColor;
      } catch { /* ignore bad JSON */ }
    }

    return { id: String(widget.id), title, value: '\u2014', accent, icon, active, inactive, activeLabel, inactiveLabel, badgeText, badgeColor, designJson: widget.designJson, categoryName: widget.categoryName };
  }

  private readonly tilePreviewRequests = new Map<string, Observable<string>>();
  private readonly tilePreviewReload$ = new Subject<void>();
  private readonly pendingTilePreviews = new Set<string>();

  readonly prepareDashboardPreview = async (): Promise<void> => {
    this.tileSlots.forEach(tile => { if (tile) this.loadTilePreview(tile); });
    this.chartSlotsData.forEach(chart => this.loadChartPreview(chart));
    await waitForDashboardRender(() => this.pendingTilePreviews.size === 0
      && this.chartSlotsData.every(chart => !this.chartPreviewLoading[chart.id] && !!this.chartPreviewOptions[chart.id]));
    this.cdr.detectChanges();
  };

  /** Loads a single tile's KPI value on demand when its card scrolls into view. */
  onTileVisible(tile: TileSelectorItem | null): void { if (tile) this.loadTilePreview(tile); }

  private loadTilePreview(tile: TileSelectorItem): void {
    if (!tile.designJson) return;
    const key = JSON.stringify([tile.id, tile.designJson]);
    let design: Record<string, unknown>;
    try { design = JSON.parse(tile.designJson); } catch { return; }
    const source     = (design['source'] as string) ?? '';
    const sourceType = (design['sourceType'] as string) ?? 'Table';
    const viewId     = (design['viewId'] as number) ?? 0;
    const isView     = design['dataSourceMode'] === 'view' && viewId > 0;
    if (!source && !isView) return;

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
      this.pendingTilePreviews.add(key);
      request$ = value$.pipe(
        takeUntil(this.tilePreviewReload$), takeUntil(this.destroy$),
        finalize(() => this.pendingTilePreviews.delete(key)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.tilePreviewRequests.set(key, request$);
    }
    request$.pipe(takeUntil(this.tilePreviewReload$), takeUntil(this.destroy$)).subscribe({
      next: value => { tile.value = value; this.cdr.markForCheck(); },
      error: () => {
        this.tilePreviewRequests.delete(key);
        if ((design['daxModel'] as DaxModelConfig)?.enabled) { tile.value = 'DAX error'; this.cdr.markForCheck(); }
      },
    });
  }

  private computeTileValue(rows: Record<string, unknown>[], design: Record<string, unknown>): string {
    const daxValue = evaluateTileDaxValue(rows, design['daxModel'] as DaxModelConfig);
    if (daxValue !== undefined) return this.formatTileNumber(daxValue, design);
    const aggregation = (design['aggregation'] as string) ?? 'count';
    const valueField  = (design['valueField']  as string) ?? '';
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
        if      (aggregation === 'total')   result = nums.reduce((a, b) => a + b, 0);
        else if (aggregation === 'average') result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else result = rows.length;
      }
    }
    const places  = Number(design['decimalPlaces']) || 0;
    const shorten = (design['shortenBigNumbers'] as boolean) ?? false;
    let formatted = result.toFixed(places);
    if (shorten && result >= 1_000_000) formatted = (result / 1_000_000).toFixed(1) + 'M';
    else if (shorten && result >= 1000) formatted = (result / 1000).toFixed(1) + 'K';
    return `${(design['prefix'] as string) ?? ''}${formatted}${(design['suffix'] as string) ?? ''}`;
  }

  private formatTileNumber(result: number, design: Record<string, unknown>): string {
    const model = design['daxModel'] as DaxModelConfig;
    if (model?.enabled) return `${design['prefix'] ?? ''}${formatDaxValue(result, getSelectedDaxMeasure(model))}${design['suffix'] ?? ''}`;
    const places  = Number(design['decimalPlaces']) || 0;
    const shorten = (design['shortenBigNumbers'] as boolean) ?? false;
    let formatted = result.toFixed(places);
    if (shorten && result >= 1_000_000) formatted = (result / 1_000_000).toFixed(1) + 'M';
    else if (shorten && result >= 1000) formatted = (result / 1000).toFixed(1) + 'K';
    return `${(design['prefix'] as string) ?? ''}${formatted}${(design['suffix'] as string) ?? ''}`;
  }

  private getTileAggregate(source: string, design: Record<string, unknown>) {
    const daxModel = design['daxModel'] as DaxModelConfig;
    if (daxModel?.enabled) {
      return this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
        filters: this.globalHierarchyFilterPayload(false), fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
        aggregation: (design['aggregation'] as string) ?? 'count', daxModel,
      }).pipe(map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })));
    }
    return this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation: (design['aggregation'] as string) ?? 'count', valueField: (design['valueField'] as string) || undefined });
  }

  getTileBreakdownRows(tile: TileSelectorItem): { label: string; value: string; color?: string }[] {
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
  isTileOnDashboard(id: string): boolean { return this.tileSlots.some(t => t?.id === id); }

  /** Rebuilds selected ids from current slot contents so checkboxes reflect items already
   *  placed on the board when the modal reopens. */
  private syncTileSelectionFromSlots(): void {
    this.selectedTileIds.clear();
    this.tileSlots.forEach(tile => { if (tile) this.selectedTileIds.add(String(tile.id)); });
  }

  private syncChartSelectionFromSlots(): void {
    this.selectedChartIds.clear();
    this.chartSlotsData.forEach(chart => this.selectedChartIds.add(String(chart.id)));
  }

  toggleTileSelection(id: string): void {
    if (this.selectedTileIds.has(id)) {
      this.selectedTileIds.delete(id);
      this.removeTileFromBoardById(id);
    } else {
      this.selectedTileIds.add(id);
    }
    this.cdr.markForCheck();
  }

  /** Removes a tile from the board immediately when it is unchecked in the Add Tiles modal. */
  private removeTileFromBoardById(id: string): void {
    const idx = this.tileSlots.findIndex(t => t?.id === id);
    if (idx !== -1) this.removeTileFromSlot(idx);
  }

  clearTileSelection(): void { this.selectedTileIds.clear(); this.cdr.markForCheck(); }

  closeTilesModal(): void {
    this.showTilesModal = false;
    this.activePanel    = null;
    this.tilesSearchTerm = '';
    this.cdr.markForCheck();
  }

  addTilesToDashboard(): void {
    const allTiles = [...this.standardTiles, ...this.myTiles];
    const selected = allTiles.filter(t => this.selectedTileIds.has(t.id) && !this.isTileOnDashboard(t.id));
    for (const tile of selected) {
      const emptyIdx = this.tileSlots.indexOf(null);
      if (emptyIdx !== -1) this.tileSlots[emptyIdx] = tile;
      else this.tileSlots.push(tile);
      this.loadTilePreview(tile);
    }
    this.syncUnifiedLayout();
    this.selectedTileIds.clear();
    this.closeTilesModal();
  }

  removeTileFromSlot(index: number): void {
    this.tileSlots[index] = null;
    this.syncUnifiedLayout();
    this.cdr.markForCheck();
  }

  // ─── Charts modal ─────────────────────────────────────────
  showChartsModal  = false;
  chartsModalTab: 'standard' | 'my' = 'standard';
  chartsSearchTerm = '';
  selectedChartIds = new Set<string>();
  chartsLoading    = false;

  standardCharts: ChartSelectorItem[] = [];
  myCharts:       ChartSelectorItem[] = [];

  private mapWidgetToChartItem(widget: WidgetLibraryItem): ChartSelectorItem {
    let chartType = 'Pie';
    let design: Record<string, unknown> | undefined;
    if (widget.designJson) {
      try { design = JSON.parse(widget.designJson); if (design?.['chartType']) chartType = design['chartType'] as string; }
      catch { /* ignore */ }
    }
    return {
      id: String(widget.id), title: appendLockedFilterTitle(widget.name, design),
      description: widget.categoryName || widget.source || '',
      chartType, source: widget.source, sourceType: widget.sourceType,
      designJson: widget.designJson, categoryName: widget.categoryName,
      widgetId: widget.id, baseTitle: widget.name,
    };
  }

  get filteredCharts(): ChartSelectorItem[] {
    const source = this.chartsModalTab === 'standard' ? this.standardCharts : this.myCharts;
    const term   = this.chartsSearchTerm.toLowerCase();
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

  chartPreviewOptions:  Record<string, Highcharts.Options> = {};
  advancedCharts: Record<string, AdvancedChartPayload> = {};
  chartPreviewLoading:  Record<string, boolean>           = {};
  chartAdditionalFilterNoData: Record<string, boolean> = {};
  chartLocalFilterErrors: Record<string, string> = {};
  chartTrendModes: Record<string, TrendMode> = {};
  trendChartPreviews: Record<string, boolean> = {};
  chartLocalFilterValues: Record<string, Record<string, string>> = {};
  /** Attached KPI tiles rendered above each chart card (board slot + Add Charts modal), keyed by chart.id. */
  chartInlineTiles: Record<string, { label: string; value: string; color: string; icon: string; breakdown: { label: string; value: string; color: string }[] }[]> = {};
  private slotPreviewFiltersCache = new WeakMap<ChartSelectorItem, {
    designJson: ChartSelectorItem['designJson'];
    source: string;
    isClone: ChartSelectorItem['isClone'];
    filters: ReturnType<DashboardBuilderComponent['getSlotPreviewFilters']>;
  }>();

  getSlotPreviewFilters(slot: ChartSelectorItem): { label: string; sourceColumn: string; sourceTable: string; hidden: boolean; locked: boolean; lockedValue: string }[] {
    const cached = this.slotPreviewFiltersCache.get(slot);
    if (cached && cached.designJson === slot.designJson && cached.source === slot.source && cached.isClone === slot.isClone) {
      return cached.filters;
    }
    let filters: ReturnType<DashboardBuilderComponent['getSlotPreviewFilters']> = [];
    try {
      const design = JSON.parse(slot.designJson ?? '{}');
      filters = (slot.isClone ? [] : (design.interactiveFilters ?? []))
        .filter((filter: { controlType?: string; sourceColumn?: string }) => filter.controlType === 'Dropdown' && !!filter.sourceColumn)
        .map((filter: { label?: string; sourceColumn: string; sourceTable?: string; hidden?: boolean; locked?: boolean; lockedValue?: string }) => ({
          label: filter.label || filter.sourceColumn,
          sourceColumn: filter.sourceColumn,
          sourceTable: filter.sourceTable || slot.source,
          hidden: !!filter.hidden,
          locked: !!filter.locked,
          lockedValue: filter.lockedValue ?? '',
        }));
    } catch { filters = []; }
    this.slotPreviewFiltersCache.set(slot, { designJson: slot.designJson, source: slot.source, isClone: slot.isClone, filters });
    return filters;
  }

  setChartLocalFilter(slot: ChartSelectorItem, column: string, value: string): void {
    if (this.chartPreviewLoading[slot.id]) return;
    this.chartLocalFilterValues[slot.id] = { ...this.chartLocalFilterValues[slot.id], [column]: value };
    delete this.chartLocalFilterErrors[slot.id];
    this.loadedChartPreviewIds.delete(slot.id);
    delete this.chartPreviewOptions[slot.id];
    this.loadChartPreview(slot);
  }

  private chartAggData: Record<string, { cats: string[]; vals: number[]; title: string; seriesName?: string; xHeader?: string; multiSeries?: Highcharts.SeriesOptionsType[]; tableHeaders?: string[]; tableRows?: (string | number)[][] }> = {};
  private chartDesigns: Record<string, any> = {};
  private chartTableCache: Record<string, { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] }> = {};
  private defaultChartType:    Record<string, ChartView>          = {};
  private defaultChartOptions: Record<string, Highcharts.Options> = {};
  /** Per-chart "Show Data Labels" preference (default true) so board re-renders honour the saved flag. */
  private chartShowDataLabels: Record<string, boolean> = {};

  private readonly loadedChartPreviewIds = new Set<string>();
  private readonly chartPreviewGenerations: Record<string, number> = {};

  /**
   * Country→Plant hierarchy as request filters — view sources only. A view's SQL matches these to
   * its DECLARE @cluster/@plant placeholders and ignores the rest; a table source would turn them
   * into WHERE clauses against literal columns named "country"/"plant" etc. that don't exist (table
   * filtering instead happens client-side in applyGlobalRowFilter). Trend/aggregated rows have no
   * cluster/plant column left to filter afterwards, so this hierarchy must travel with the request
   * itself or a filter change silently does nothing.
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

  /** Loads a single chart's preview on demand when its card scrolls into view. */
  onChartVisible(chart: ChartSelectorItem): void { this.loadChartPreview(chart); }

  private loadChartPreview(chart: ChartSelectorItem): void {
    if (this.loadedChartPreviewIds.has(chart.id)) return;
    if (!chart.designJson || !chart.source) return;
    this.loadedChartPreviewIds.add(chart.id);
    const generation = (this.chartPreviewGenerations[chart.id] ?? 0) + 1;
    this.chartPreviewGenerations[chart.id] = generation;
    this.chartPreviewLoading[chart.id] = true;
    this.chartAdditionalFilterNoData[chart.id] = false;
    let design: Record<string, unknown>;
    try { design = JSON.parse(chart.designJson); } catch { return; }

    const source     = (design['source']     as string) ?? chart.source;
    const sourceType = (design['sourceType'] as string) ?? chart.sourceType ?? 'Table';
    const viewId     = (design['viewId']     as number) ?? 0;
    const isView     = design['dataSourceMode'] === 'view' && viewId > 0;
    const isTrend    = TREND_CHART_TYPES.has((design['chartType'] as string) ?? '');
    this.trendChartPreviews[chart.id] = isTrend;
    this.chartTrendModes[chart.id] ??= (design['trendMode'] as TrendMode) ?? 'monthly';
    const presetFilter = chart.presetColumn
      ? (design['interactiveFilters'] as { sourceTable?: string; sourceColumn: string; controlType?: string; label?: string }[] | undefined)
        ?.find(filter => filter.sourceColumn === chart.presetColumn)
      : undefined;
    const clonePlant = !!chart.presetColumn && isPlantFilter(presetFilter ?? { sourceColumn: chart.presetColumn });
    const serverPreset = chart.presetColumn && isView && clonePlant
      ? { sourceTable: presetFilter?.sourceTable || source, sourceColumn: chart.presetColumn,
          controlType: presetFilter?.controlType || 'Dropdown', label: presetFilter?.label || chart.presetColumn }
      : presetFilter?.sourceTable && presetFilter.sourceTable.toLowerCase() !== source.toLowerCase() ? presetFilter : undefined;
    const savedFilters = (design['interactiveFilters'] as {
      sourceTable?: string; sourceColumn?: string; controlType?: string; locked?: boolean;
    }[] | undefined) ?? [];
    const sharedFilters = this.customFilters.filter(shared => {
      if (!shared.additional) return true;
      if (clonePlant && isPlantFilter(shared)) return false;
      return !savedFilters.some(filter =>
        (filter.sourceTable || source).trim().toLowerCase() === shared.sourceTable.trim().toLowerCase() &&
        filter.sourceColumn?.trim().toLowerCase() === shared.sourceColumn.trim().toLowerCase() &&
        (filter.controlType !== 'Dropdown' || filter.locked || chart.presetColumn === filter.sourceColumn));
    });
    const localFilters = mergeDashboardSharedFilters<DashboardChartFilter & { label: string }>(this.getSlotPreviewFilters(chart).map(filter => ({
      sourceTable: filter.sourceTable, sourceColumn: filter.sourceColumn,
      label: filter.label, controlType: 'Dropdown', locked: filter.locked,
      value: filter.locked ? filter.lockedValue : (this.chartLocalFilterValues?.[chart.id]?.[filter.sourceColumn] ?? ''),
    })), sharedFilters, filter => ({
      sourceTable: filter.sourceTable, sourceColumn: filter.sourceColumn, label: filter.label,
      controlType: 'Dropdown', locked: false, value: filter.value, dashboardAdditional: true,
    })).filter(filter => !!filter.value);
    if (localFilters.length && serverPreset) {
      localFilters.push({
        sourceTable: serverPreset.sourceTable!, sourceColumn: serverPreset.sourceColumn,
        label: serverPreset.label || serverPreset.sourceColumn, controlType: serverPreset.controlType || 'Dropdown',
        locked: true, value: chart.presetValue ?? '',
      });
    }

    let data$;
    if (localFilters.length) {
      data$ = this.widgetService.getFilteredChartData({
        chartSource: source, chartSourceType: sourceType, viewId: isView ? viewId : null,
        preserveFutureDateRange: true,
        filters: [...localFilters, ...this.globalHierarchyFilterPayload(isView).filter(filter => !clonePlant || !isPlantFilter(filter))],
        fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
        ...(isTrend ? { mode: this.chartTrendModes[chart.id] } : {}),
      });
    } else if (serverPreset) {
      data$ = this.widgetService.getFilteredChartData({
        chartSource: source, chartSourceType: sourceType, viewId: isView ? viewId : null,
        preserveFutureDateRange: true,
        filters: [{ sourceTable: serverPreset.sourceTable!, sourceColumn: serverPreset.sourceColumn,
          controlType: serverPreset.controlType || 'Dropdown', label: serverPreset.label, value: chart.presetValue ?? '' }, ...this.globalHierarchyFilterPayload(isView).filter(filter => !clonePlant || !isPlantFilter(filter))],
        fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
        ...(isTrend ? { mode: this.chartTrendModes[chart.id] } : {}),
      });
    } else if (isView && isTrend) {
      data$ = this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: sourceType, viewId, preserveFutureDateRange: true, filters: this.globalHierarchyFilterPayload(isView), mode: this.chartTrendModes[chart.id], fromDate: this.fromDate || undefined, toDate: this.toDate || undefined });
    } else if (isView) {
      data$ = this.commonApi.getDatabaseViewById(viewId).pipe(
          switchMap(view => this.commonApi.previewView({ connectionId: view.connectionId, sql: this.injectGlobalFilterParams(view.generatedSql, true), viewId: view.id, maxRows: 1000 })),
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
        );
    } else {
      data$ = this.widgetService.getTableData(source, sourceType).pipe(
        catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
      );
    }

    data$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (this.chartPreviewGenerations[chart.id] !== generation) return;
        delete this.chartLocalFilterErrors[chart.id];
        const paramFilters = getSavedParameterFilters(design);
        const activeDesign = remapDesignColumns(design, paramFilters);
        this.chartDesigns[chart.id] = activeDesign;
        const { rows: transformedRows, columns: transformedCols } = applyParameterFilters(this.applyGlobalRowFilter(res.rows ?? [], clonePlant), paramFilters, res.columns ?? []);
        let rows   = applyConditionalFilters(transformedRows, getSavedConditionalFilters(activeDesign));
        rows = this.applyLockedInteractiveFilters(rows, activeDesign);
        const columns = transformedCols;
        const daxMeasures = getActiveDaxMeasures(activeDesign);
        if (chart.presetColumn && !serverPreset) {
          const col = rows.length ? this.resolveCol(rows[0], chart.presetColumn) : chart.presetColumn;
          const val = (chart.presetValue ?? '').toLowerCase();
          rows = rows.filter(r => String(r[col] ?? '').toLowerCase() === val);
        }
        this.chartAdditionalFilterNoData[chart.id] = rows.length === 0 &&
          localFilters.some(filter => filter.dashboardAdditional);
        const multiY = (activeDesign['multiYColumns'] as string[]) ?? [];
        const chartTypeVal = (activeDesign['chartType'] as string) ?? 'bar';
        const specialTypes = ['gauge', 'histogram', 'sankey', 'timeline', 'bullet', 'bubble', 'heatmap'];
        const showDataLabels = activeDesign['showDataLabels'] as boolean | undefined;
        this.chartShowDataLabels[chart.id] = showDataLabels !== false;
        delete this.advancedCharts[chart.id];
        if (isAdvancedChart(chartTypeVal)) {
          this.advancedCharts[chart.id] = { type: chartTypeVal, rows, config: readAdvancedConfig(activeDesign['advancedConfig']), daxMeasures };
          this.chartAggData[chart.id] = { cats: [], vals: [], title: chart.title };
          this.chartPreviewOptions[chart.id] = {};
        } else if (specialTypes.includes(chartTypeVal)) {
          this.chartAggData[chart.id] = { cats: [], vals: [], title: chart.title };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyDataLabelPreference(this.buildSpecialChartOptions(chartTypeVal, rows, activeDesign, chart.title), showDataLabels);
        } else if (multiY.length > 0) {
          const { categories, series } = this.buildMultiSeries(rows, activeDesign);
          appendDaxToChartData(daxMeasures, rows, columns, categories, [], series as { data?: unknown }[],
            activeDesign['chartType'] === 'stacked' && activeDesign['showStackTotal'] !== false ? series.length - 1 : -1);
          const xAxis = (activeDesign['xAxis'] as string) ?? '';
          const tableColumns = multiY.filter(column => column !== xAxis);
          const displayRows = rows.slice(0, 100);
          const tableRows = (activeDesign['chartType'] as string) === 'table'
            ? displayRows.map(row => [
                this.formatTableCell(row[xAxis]),
                ...tableColumns.map(column => this.formatTableCell(row[column])),
              ])
            : undefined;
          // DAX measures as the builder shows them: summary rows (Column) and extra columns (Row).
          if (tableRows) appendDaxToTableRows(daxMeasures, rows, columns, tableRows, tableColumns.length, displayRows.map(row => [row]), tableColumns);
          const rowMeasureHeaders = getDaxRowColumnMeasures(daxMeasures).map(m => m.name?.trim() || 'New Metric');
          this.chartAggData[chart.id] = {
            cats: categories,
            vals: [],
            title: chart.title,
            xHeader: (activeDesign['xAxisTitle'] as string) || xAxis || 'Parameter',
            multiSeries: series,
            tableHeaders: tableRows ? [(activeDesign['xAxisTitle'] as string) || xAxis || 'Parameter', ...tableColumns, ...rowMeasureHeaders] : undefined,
            tableRows,
          };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(this.buildChartOptions((activeDesign['chartType'] as string) ?? 'bar', categories, [], chart.title, series, activeDesign), showDataLabels));
        } else {
          const { cats, vals } = this.aggregateChart(rows, activeDesign);
          appendDaxToChartData(daxMeasures, rows, columns, cats, vals);
          this.chartAggData[chart.id]   = { cats, vals, title: chart.title, seriesName: (activeDesign['yAxis'] as string) || (activeDesign['yAggColumn'] as string) || 'Value', xHeader: (activeDesign['xAxisTitle'] as string) || (activeDesign['xAxis'] as string) || 'Parameter' };
          this.chartTableCache[chart.id] = this.buildChartTableData(chart.id);
          this.chartPreviewOptions[chart.id] = applyChartZoom(applyDataLabelPreference(this.buildChartOptions((activeDesign['chartType'] as string) ?? 'bar', cats, vals, chart.title, undefined, activeDesign), showDataLabels));
        }
        if (!this.cardChartType[chart.id]) this.cardChartType[chart.id] = toChartView((design['chartType'] as string));
        this.cardChartTypeOptions[chart.id] = chartSwitchOptions(this.cardChartType[chart.id], design);
        this.defaultChartType[chart.id]    = this.cardChartType[chart.id];
        this.defaultChartOptions[chart.id] = this.chartPreviewOptions[chart.id];
        this.chartPreviewLoading[chart.id] = false;
        this.loadInlineTilesForChart(chart.id, (activeDesign['attachedTileIds'] as number[]) ?? [], chart, localFilters);
        this.cdr.markForCheck();
      },
      error: () => {
        if (this.chartPreviewGenerations[chart.id] !== generation) return;
        this.chartPreviewLoading[chart.id] = false;
        this.chartLocalFilterErrors[chart.id] = 'Unable to load chart data. Please retry.';
        this.loadedChartPreviewIds.delete(chart.id);
        this.cdr.markForCheck();
      },
    });
  }

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

  /** Loads a chart's attached KPI tiles so they render above the chart in the builder (board slot + Add Charts modal). */
  private loadInlineTilesForChart(chartId: string, tileIds: number[], chart: ChartSelectorItem, localFilters: { sourceTable: string; sourceColumn: string; controlType: string; label: string; value: string; values?: string[] }[] = []): void {
    if (!tileIds?.length) { this.chartInlineTiles[chartId] = []; return; }
    // Chart's active local (interactive) filters, forwarded to attached view tiles so they filter with the chart.
    const viewLocalFilters = localFilters.filter(f => f.value || (f.values?.length ?? 0));
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

  private aggregateChart(rows: Record<string, unknown>[], design: Record<string, unknown>): { cats: string[]; vals: number[] } {
    const xAxis  = (design['xAxis']      as string) ?? '';
    const yAxis  = (design['yAxis']      as string) ?? 'Count (F)';
    const aggCol = (design['yAggColumn'] as string) ?? '';
    const isFn   = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'].includes(yAxis);
    const col    = aggCol || (isFn ? '' : yAxis);
    const grouped = new Map<string, { count: number; nums: number[] }>();

    const resolvedX   = rows.length && xAxis ? this.resolveCol(rows[0], xAxis) : xAxis;
    const resolvedCol = rows.length && col   ? this.resolveCol(rows[0], col)   : col;

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
      if      (yAxis === 'Count (F)')   vals.push(g.count);
      else if (yAxis === 'Sum (F)')     vals.push(g.nums.reduce((a, b) => a + b, 0));
      else if (yAxis === 'Average (F)') vals.push(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0);
      else if (yAxis === 'Min (F)')     vals.push(g.nums.length ? Math.min(...g.nums) : 0);
      else if (yAxis === 'Max (F)')     vals.push(g.nums.length ? Math.max(...g.nums) : 0);
      else vals.push(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) : g.count);
    }

    const limitN = (design['topN'] as number) || 0;
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

  private buildMultiSeries(rows: Record<string, unknown>[], design: Record<string, unknown>): { categories: string[]; series: Highcharts.SeriesOptionsType[] } {
    const xAxis     = (design['xAxis'] as string) ?? '';
    const resolvedX = rows.length && xAxis ? this.resolveCol(rows[0], xAxis) : xAxis;
    const grouped   = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const v   = row[resolvedX];
      const key = (v != null && typeof v !== 'object') ? `${v}` : '(empty)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    const categories = [...grouped.keys()];
    const allCols    = [...((design['multiYColumns'] as string[]) ?? [])];
    const comboLineCols: string[] = (design['comboLineColumns'] as string[]) ?? [];
    const hasDualY = comboLineCols.length > 0 && (design['chartType'] === 'combo' || design['chartType'] === 'multiline');
    if (hasDualY) {
      for (const col of comboLineCols) {
        if (!allCols.includes(col)) allCols.push(col);
      }
    }
    const isStacked  = design['chartType'] === 'stacked';
    const isCombo    = design['chartType'] === 'combo';
    const isGrouped  = design['chartType'] === 'grouped';
    const hcType     = (isStacked || isCombo || isGrouped) ? 'column' : (design['chartType'] === 'area' ? 'area' : 'line');
    const limitedCategories = this.limitMultiSeriesCategories(categories, grouped, allCols, rows, design);

    const series: Highcharts.SeriesOptionsType[] = allCols.map((col, i) => {
      const resolved = rows.length ? this.resolveCol(rows[0], col) : col;
      const isLineSeries = isCombo && comboLineCols.includes(col);
      const isRightAxis = hasDualY && comboLineCols.includes(col);
      const s: any = {
        type: isLineSeries ? 'line' : hcType, name: col,
        data: limitedCategories.map(cat => {
          const catRows = grouped.get(cat) ?? [];
          const nums    = catRows.map(r => Number(r[resolved] ?? 0)).filter(n => !Number.isNaN(n));
          return nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
        }),
        color: getSeriesColorByName(col, i),
        stacking: (isStacked || (isCombo && !isLineSeries)) ? 'normal' as Highcharts.OptionsStackingValue : undefined,
        marker: { enabled: true },
      };
      if (hasDualY) { s.yAxis = isRightAxis ? 1 : 0; }
      return s as Highcharts.SeriesOptionsType;
    });

    if (isStacked && design['showStackTotal'] !== false) {
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

  /** Applies the saved Top N / Bottom N / "Group as Others" limit to a multi-series category list. */
  private limitMultiSeriesCategories(categories: string[], grouped: Map<string, Record<string, unknown>[]>, allCols: string[], rows: Record<string, unknown>[], design: Record<string, unknown>): string[] {
    const limitCat = (design['limitCategory'] as string) ?? 'all';
    const wantTop = limitCat === 'top' && ((design['topN'] as number) ?? 0) > 0;
    const wantBottom = limitCat === 'bottom' && ((design['bottomN'] as number) ?? 0) > 0;
    if (!wantTop && !wantBottom) return categories;
    const n = wantTop ? (design['topN'] as number) : (design['bottomN'] as number);
    if (categories.length <= n) return categories;
    const resolved = allCols.map(c => rows.length ? this.resolveCol(rows[0], c) : c);
    const total = (cat: string) => (grouped.get(cat) ?? []).reduce((s, r) => s + resolved.reduce((cs, rc) => cs + (Number(r[rc]) || 0), 0), 0);
    const pairs = categories.map(c => ({ c, v: total(c) })).sort((a, b) => wantTop ? b.v - a.v : a.v - b.v);
    const kept = pairs.slice(0, n).map(p => p.c);
    const rest = pairs.slice(n).map(p => p.c);
    if (((design['groupRestAsOthers'] as boolean) ?? false) && rest.length) {
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
  chartIconCase(view: string): string { return DashboardBuilderComponent.ICON_CASE[chartViewIcon(view as ChartView)]; }
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

    if (chartType === 'pie' || chartType === 'donut') {
      return {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
        plotOptions: { pie: { innerSize: chartType === 'donut' ? '55%' : '0%', borderWidth: 2, borderColor: '#fff',
          dataLabels: { enabled: true, distance: -28, format: '{point.y}',
            style: { color: '#fff', fontWeight: '700', fontSize: '11px', textOutline: 'none' } } } },
        series: [{ type: 'pie', name: title,
          data: cats.map((c, i) => ({ name: c, y: vals[i], color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') })).filter(d => d.y !== 0) }],
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
      const seriesName = design?.yAggColumn ?? design?.yAxis ?? 'Value';
      const lineCategoryColor = usesPeriodLineCategoryColorRules(chartType, design?.xAxis, hcType)
        ? this.categoryColorFor('', design, seriesName) : undefined;
      const opts: Highcharts.Options = {
        chart: { type: hcType, backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        ...axes,
        plotOptions: { [hcType]: { marker: { radius: 3 }, dataLabels: { enabled: false } } },
        series: hasMulti ? series : [{ type: hcType, name: title, color: lineCategoryColor, data: vals.map((value, i) => ({
          y: value, color: this.pointColor(cats[i] ?? '', value, design, i, seriesName, !lineCategoryColor),
        })), showInLegend: false }],
      };
      if (hasDualY) {
        opts.yAxis = [
          { title: { text: undefined }, gridLineColor: '#F1F3F6' },
          { title: { text: undefined }, opposite: true, gridLineWidth: 0 },
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
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
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

    const isStacked = chartType === 'stacked';
    const isCombo = chartType === 'combo';

    if (isCombo && hasMulti) {
      return {
        chart: { type: 'column', backgroundColor: 'transparent' },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: cats, labels: { style: { fontSize: '10px', color: '#667085' } }, lineColor: '#E7ECF3' },
        yAxis: [
          { title: { text: undefined }, gridLineColor: '#F1F3F6' },
          { title: { text: undefined }, opposite: true, gridLineWidth: 0 },
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
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      ...axes,
      plotOptions: { [hcBarType]: {
        borderRadius: isStacked ? 0 : 3, borderWidth: 0,
        colorByPoint: !hasMulti,
        colors: hasMulti ? undefined : cats.map((c, i) => this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value')),
        stacking: isStacked ? 'normal' as Highcharts.OptionsStackingValue : undefined,
        dataLabels: { enabled: false },
      } },
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
          { name: col || 'Raw data', type: 'scatter' as const, data: rawValues, visible: false, id: 'db-histogram-raw' },
          { name: col || 'Histogram', type: 'histogram' as any, xAxis: 1, yAxis: 1, baseSeries: 'db-histogram-raw', zIndex: -1, color: chartFallbackColor(`${col || 'Histogram'}:`, 0) },
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

  get selectedChartsCount(): number { return this.selectedChartIds.size; }
  isChartSelected(id: string): boolean { return this.selectedChartIds.has(id); }

  toggleChartSelection(id: string): void {
    this.selectedChartIds.has(id) ? this.selectedChartIds.delete(id) : this.selectedChartIds.add(id);
    this.cdr.markForCheck();
  }

  clearChartSelection():         void { this.selectedChartIds.clear(); this.cdr.markForCheck(); }
  removeChartFromSelection(id: string): void { this.selectedChartIds.delete(id); this.cdr.markForCheck(); }

  getChartById(id: string): ChartSelectorItem | undefined {
    return [...this.standardCharts, ...this.myCharts].find(c => c.id === id);
  }

  get selectedChartIdsArray(): string[] { return Array.from(this.selectedChartIds); }

  getChartThumbnailOptions(id: string): Highcharts.Options {
    const data = this.chartAggData[id];
    if (!data) return this.chartPreviewOptions[id] ?? {};
    const type = (this.cardChartType[id] ?? 'bar').toLowerCase();
    const base: Highcharts.Options = {
      chart: { backgroundColor: 'transparent', height: 62, margin: [2, 2, 2, 2], spacing: [0, 0, 0, 0] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      tooltip: { enabled: false }, xAxis: { visible: false },
      yAxis: { visible: false, gridLineWidth: 0 },
    };
    if (type === 'pie' || type === 'doughnut') {
      return { ...base, chart: { ...base.chart, type: 'pie' },
        plotOptions: { pie: { center: ['50%', '50%'], size: '90%', borderWidth: 1, borderColor: '#fff', dataLabels: { enabled: false }, enableMouseTracking: false } },
        series: [{ type: 'pie', data: data.cats.map((category, i) => ({ name: category, y: data.vals[i] ?? 0, color: this.pointColor(category, data.vals[i] ?? 0, this.chartDesigns[id], i, data.seriesName ?? 'Value') })).filter(d => d.y !== 0) }] };
    }
    if (type === 'line' || type === 'multiline' || type === 'spline') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'line' as any, data: data.vals.map((value, i) => ({ y: value, color: this.pointColor(data.cats[i] ?? '', value, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'line' },
        plotOptions: { line: { marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }
    if (type === 'trend' || type === 'area') {
      const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
        ? data.multiSeries.map(s => ({ ...s, marker: { enabled: false } } as Highcharts.SeriesOptionsType))
        : [{ type: 'areaspline' as any, data: data.vals.map((value, i) => ({ y: value, color: this.pointColor(data.cats[i] ?? '', value, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), fillOpacity: 0.15, marker: { enabled: false }, enableMouseTracking: false } as Highcharts.SeriesOptionsType];
      return { ...base, chart: { ...base.chart, type: 'areaspline' },
        plotOptions: { areaspline: { fillOpacity: 0.15, marker: { enabled: false }, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
    }
    const series: Highcharts.SeriesOptionsType[] = data.multiSeries?.length
      ? data.multiSeries.map(s => ({ ...s } as Highcharts.SeriesOptionsType))
      : [{ type: 'column' as any, data: data.cats.map((category, i) => ({ y: data.vals[i] ?? 0, color: this.pointColor(category, data.vals[i] ?? 0, this.chartDesigns[id], i, data.seriesName ?? 'Value') })), enableMouseTracking: false } as Highcharts.SeriesOptionsType];
    return { ...base, chart: { ...base.chart, type: 'column' },
      plotOptions: { column: { borderWidth: 0, borderRadius: 1, dataLabels: { enabled: false }, enableMouseTracking: false } }, series };
  }

  // ─── Per-card chart type ──────────────────────────────────
  chartTypeMenuOpen: Record<string, boolean> = {};
  cardChartType:     Record<string, ChartView>  = {};
  cardChartTypeOptions: Record<string, ChartView[]> = {};

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

    const chartSlot = this.chartSlotsData.find(slot => slot.id === id);
    if (chartSlot) {
      chartSlot.width = this.defaultChartCardWidth;
      chartSlot.height = this.defaultChartCardHeight;
    }

    if (type === 'table') { this.cdr.markForCheck(); return; }
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
      this.chartPreviewOptions[id] = applyChartZoom(applyDataLabelPreference(this.buildChartOptions(type, data.cats, data.vals, data.title, data.multiSeries, this.chartDesigns[id]), this.chartShowDataLabels[id]));
    }
    this.cdr.markForCheck();
  }

  getChartLegendItems(id: string): { name: string; color: string }[] {
    const data = this.chartAggData[id];
    if (!data) return [];
    const design = this.chartDesigns[id];
    if (data.multiSeries?.length) {
      return data.multiSeries.map((s, i) => {
        const name = (s as { name?: string }).name ?? `Series ${i + 1}`;
        return {
          name,
          color: this.categoryColorFor('', design, name)
            ?? this.colorOverrideFor('', design, name)
            ?? (s as { color?: string }).color
            ?? this.fallbackColor(`${name}:`, i),
        };
      });
    }
    return data.cats.map((category, index) => ({
      name: category,
      color: this.pointColor(category, data.vals[index] ?? 0, design, index, design?.yAxis ?? 'Value'),
    }));
  }

  shouldIncludeDataTable(id: string): boolean {
    return this.chartDesigns[id]?.includeDataTable === true;
  }

  shouldShowLegend(id: string): boolean {
    return this.chartDesigns[id]?.showLegend !== false;
  }

  getChartTableData(id: string): { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] } {
    return this.chartTableCache[id] ?? { headers: [], rows: [], rowColors: [], rowBgColors: [] };
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
      const headers    = [data.xHeader ?? 'Parameter', ...data.multiSeries.map(s => (s as { name?: string }).name ?? 'Series')];
      const rows       = data.cats.map((cat, i) => [cat, ...data.multiSeries!.map(s => ((s as { data?: number[] }).data ?? [])[i] ?? 0)]);
      const rowColors  = data.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]);
      const rowBgColors = data.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]);
      return { headers, rows, rowColors, rowBgColors };
    }
    return {
      headers:   [data.xHeader ?? 'Parameter', 'Value'],
      rows:      data.cats.map((cat, i) => [cat, data.vals[i] ?? 0]),
      rowColors:  data.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]),
      rowBgColors: data.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]),
    };
  }

  closeChartsModal(): void {
    this.showChartsModal = false;
    this.activePanel     = null;
    this.chartsSearchTerm = '';
    for (const id of Object.keys(this.defaultChartType)) {
      this.cardChartType[id] = this.defaultChartType[id];
      if (this.defaultChartOptions[id]) this.chartPreviewOptions[id] = this.defaultChartOptions[id];
    }
    this.selectedChartIds.clear();
    this.cdr.markForCheck();
  }

  addChartsToDashboard(): void {
    const allCharts = [...this.standardCharts, ...this.myCharts];
    const selected  = allCharts.filter(c => this.selectedChartIds.has(c.id));
    for (const chart of selected) {
      if (!this.chartSlotsData.some(s => s.id === chart.id)) {
        const chartItem = { ...chart };
        this.chartSlotsData.push(chartItem);
      }
      this.loadChartPreview(chart);
    }
    this.syncUnifiedLayout();
    this.selectedChartIds.clear();
    this.closeChartsModal();
  }

  removeChartFromSlot(index: number): void {
    this.chartSlotsData.splice(index, 1);
    this.syncUnifiedLayout();
    this.cdr.markForCheck();
  }

  // ─── Chart clone / copy-to-dashboard (3-dot menu) ─────────
  chartMenuOpen: Record<string, boolean> = {};
  cloneValueOpenFor: Record<string, string | null> = {};
  cloneValuePosition: Record<string, { side: 'left' | 'right' }> = {};
  copyToOpen: Record<string, boolean> = {};
  copyTargets: { dashboardId: number; dashboardName: string }[] = [];
  copyTargetsLoading = false;
  existingDestinationOpen = false;
  destinationSearch = '';
  destinationError = '';
  private copyTargetsRequest = 0;
  copyConfirmOpen = false;
  pendingCopyDestination: ChartSelectorItem | null = null;
  copySaving = false;
  private pendingCopyTab: Window | null = null;
  private pendingCopy: { slots: ChartSelectorItem[]; target: { dashboardId: number; dashboardName: string } } | null = null;
  private cloneSeq = 0;
  pendingCloneAll: { slot: ChartSelectorItem; filter: { label: string; sourceColumn: string; sourceTable: string }; value?: string } | null = null;
  private readonly slotFiltersCache: Record<string, { label: string; sourceColumn: string; sourceTable: string }[]> = {};
  private readonly filterValuesCache: Record<string, string[]> = {};
  private readonly filterValuesLoading = new Set<string>();
  private readonly plantCloneFilterLoading = new Set<string>();

  private newCloneSlotId(): string { return `clone_${Date.now()}_${this.cloneSeq++}`; }

  toggleChartMenu(slot: ChartSelectorItem, e: Event): void {
    e.stopPropagation();
    const wasOpen = this.chartMenuOpen[slot.id];
    this.closeChartMenu();
    if (!wasOpen) {
      this.chartMenuOpen[slot.id] = true;
      this.loadGlobalPlantCloneFilter(slot);
      for (const f of this.getSlotDropdownFilters(slot)) this.getFilterValues(f); // prewarm values
    }
    this.cdr.markForCheck();
  }

  closeChartMenu(): void {
    this.chartMenuOpen = {};
    this.cloneValueOpenFor = {};
    this.cloneValuePosition = {};
    this.copyToOpen = {};
  }

  private loadGlobalPlantCloneFilter(slot: ChartSelectorItem): void {
    if (slot.isClone || this.getSlotDropdownFilters(slot).some(isPlantFilter) || this.plantCloneFilterLoading.has(slot.id)) return;
    let design: Record<string, any>;
    try { design = JSON.parse(slot.designJson ?? '{}'); } catch { return; }
    const source = design['source'] || slot.source;
    const sourceType = design['sourceType'] || slot.sourceType || 'Table';
    const viewId = design['viewId'] || 0;
    const metadata$ = viewId > 0
      ? this.commonApi.getDatabaseViewById(viewId).pipe(map(view => {
          let columns: string[] = [];
          try {
            const parsed: unknown = JSON.parse(view.previewColumnsJson ?? '[]');
            if (Array.isArray(parsed)) columns = parsed.filter((column): column is string => typeof column === 'string');
          } catch {}
          return inferPlantFilter(source, columns, view.generatedSql);
        }))
      : this.widgetService.getTableData(source, sourceType).pipe(map(data => inferPlantFilter(source, data.columns ?? [])));
    this.plantCloneFilterLoading.add(slot.id);
    metadata$.pipe(takeUntil(this.destroy$), finalize(() => this.plantCloneFilterLoading.delete(slot.id))).subscribe({
      next: filter => {
        if (!filter || this.getSlotDropdownFilters(slot).some(isPlantFilter)) return;
        this.slotFiltersCache[slot.id] = [...this.getSlotDropdownFilters(slot), filter];
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  /** Clone dimensions from configured local filters and supported global Plant filtering. */
  getSlotDropdownFilters(slot: ChartSelectorItem): { label: string; sourceColumn: string; sourceTable: string }[] {
    if (slot.isClone) return [];
    if (this.slotFiltersCache[slot.id]) return this.slotFiltersCache[slot.id];
    let filters: { label: string; sourceColumn: string; sourceTable: string }[] = [];
    try {
      const d = JSON.parse(slot.designJson ?? '{}');
      const list = (d.interactiveFilters ?? []) as { label?: string; controlType?: string; sourceColumn?: string; sourceTable?: string }[];
      filters = list
        .filter(f => (f.controlType ?? '') === 'Dropdown' && !!f.sourceColumn)
        .map(f => ({ label: f.label || f.sourceColumn!, sourceColumn: f.sourceColumn!, sourceTable: f.sourceTable || slot.source }));
    } catch { /* ignore */ }
    this.slotFiltersCache[slot.id] = filters;
    return filters;
  }

  /** Distinct values for a filter column (cached; lazily fetched from its source). */
  getFilterValues(filter: { label?: string; sourceColumn: string; sourceTable: string }): string[] {
    const column = filter.sourceColumn.replace(/[\s_-]/g, '').toLowerCase();
    if (filter.label?.trim().toLowerCase() === 'plant' || column === 'plant' || column === 'plantdescription') {
      return this.plantOptions.filter(value => {
        const plant = value.trim().replace(/\s+/g, ' ').toLowerCase();
        return plant !== '' && plant !== 'all' && plant !== 'marmul projects';
      });
    }
    const key = `${filter.sourceTable}::${filter.sourceColumn}`;
    if (this.filterValuesCache[key]) return this.filterValuesCache[key];
    if (!this.filterValuesLoading.has(key)) {
      this.filterValuesLoading.add(key);
      this.filterValuesCache[key] = [];
      this.widgetService.getTableData(filter.sourceTable, 'Table').pipe(
        catchError(() => this.widgetService.getTableData(filter.sourceTable, 'View')),
        catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
        takeUntil(this.destroy$),
      ).subscribe(res => {
        const rows = res.rows ?? [];
        const col = rows.length ? this.resolveCol(rows[0], filter.sourceColumn) : filter.sourceColumn;
        this.filterValuesCache[key] = [...new Set(rows.map(r => String(r[col] ?? '')).filter(v => v !== ''))]
          .sort((a, b) => a.localeCompare(b));
        this.cdr.markForCheck();
      });
    }
    return this.filterValuesCache[key];
  }

  /** Flyout is a plain CSS-anchored absolute panel next to its trigger `<li>` (not a
   * fixed/popover overlay), so it scrolls and zooms together with the rest of the menu
   * instead of drifting — only the left/right side still needs a one-off viewport check. */
  toggleCloneValue(slotId: string, column: string, e: Event): void {
    e.stopPropagation();
    this.cloneValueOpenFor[slotId] = this.cloneValueOpenFor[slotId] === column ? null : column;
    this.copyToOpen[slotId] = false;
    const parent = (e.currentTarget as HTMLElement | null)?.parentElement;
    if (this.cloneValueOpenFor[slotId] && parent) {
      const bounds = parent.getBoundingClientRect();
      const rightSpace = Math.max(0, window.innerWidth - bounds.right - 16);
      const leftSpace = Math.max(0, bounds.left - 16);
      const side = rightSpace >= 190 || rightSpace >= leftSpace ? 'right' : 'left';
      this.cloneValuePosition[slotId] = { side };
    }
  }

  @HostListener('document:keydown.escape')
  closeChartMenuOnEscape(): void {
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  private buildCloneSlot(origin: ChartSelectorItem, column: string, value: string): ChartSelectorItem {
    const base = origin.baseTitle ?? origin.title;
    let designJson = origin.designJson;
    const filter = this.getSlotDropdownFilters(origin).find(filter => filter.sourceColumn === column);
    if (filter) {
      const design = JSON.parse(designJson ?? '{}');
      if (!(design.interactiveFilters ?? []).some((existing: { sourceColumn?: string }) => existing.sourceColumn === column)) {
        design.interactiveFilters = [...(design.interactiveFilters ?? []), {
          ...filter, controlType: 'Dropdown', hidden: true,
          id: Math.max(0, ...(design.interactiveFilters ?? []).map((existing: { id?: number }) => existing.id || 0)) + 1,
        }];
        designJson = JSON.stringify(design);
      }
    }
    return {
      ...origin,
      designJson,
      id: this.newCloneSlotId(),
      widgetId: origin.widgetId ?? (Number(origin.id) || 0),
      baseTitle: base,
      title: `${base}-${value}`,
      presetColumn: column,
      presetValue: value,
      isClone: true,
    };
  }

  requestClonePerAllFilter(slot: ChartSelectorItem, filter: { label: string; sourceColumn: string; sourceTable: string }): void {
    this.cancelDestination();
    this.pendingCloneAll = { slot, filter };
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  requestClonePerValue(slot: ChartSelectorItem, filter: { label: string; sourceColumn: string; sourceTable: string }, value: string): void {
    this.cancelDestination();
    this.pendingCloneAll = { slot, filter, value };
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  cancelCloneAll(): void {
    this.pendingCloneAll = null;
    this.cdr.markForCheck();
  }

  cloneAllToExistingDashboard(): void {
    if (!this.pendingCloneAll) return;
    const { slot, filter, value } = this.pendingCloneAll;
    if (value !== undefined) {
      this.clonePerValue(slot, filter, value);
      this.cancelCloneAll();
    } else if (this.clonePerAllFilter(slot, filter)) this.cancelCloneAll();
  }

  cloneAllToNewDashboard(): void {
    if (!this.pendingCloneAll) return;
    const { slot, filter, value } = this.pendingCloneAll;
    const values = value !== undefined ? [value] : this.getFilterValues(filter);
    if (!values.length) { this.notify.showError('Filter values are still loading - please try again in a moment.'); return; }
    const clonedCharts = values.map(value => this.buildCloneSlot(slot, filter.sourceColumn, value));
    this.openNewDashboardTab(clonedCharts);
  }

  clonePerAllFilter(slot: ChartSelectorItem, filter: { label: string; sourceColumn: string; sourceTable: string }): boolean {
    const values = this.getFilterValues(filter);
    if (!values.length) { this.notify.showError('Filter values are still loading — please try again in a moment.'); return false; }
    const idx = this.chartSlotsData.findIndex(s => s.id === slot.id);
    const clones = values.map(v => this.buildCloneSlot(slot, filter.sourceColumn, v));
    this.chartSlotsData.splice(idx + 1, 0, ...clones);
    this.syncUnifiedLayout();
    for (const c of clones) this.loadChartPreview(c);
    this.closeChartMenu();
    this.cdr.markForCheck();
    return true;
  }

  clonePerValue(slot: ChartSelectorItem, filter: { sourceColumn: string }, value: string): void {
    const idx = this.chartSlotsData.findIndex(s => s.id === slot.id);
    const clone = this.buildCloneSlot(slot, filter.sourceColumn, value);
    this.chartSlotsData.splice(idx + 1, 0, clone);
    this.syncUnifiedLayout();
    this.loadChartPreview(clone);
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  requestCopyDestination(slot: ChartSelectorItem): void {
    this.cancelDestination();
    this.pendingCopyDestination = slot;
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  cancelCopyDestination(): void {
    this.pendingCopyDestination = null;
    this.cdr.markForCheck();
  }

  chooseCopyToNewDashboard(): void {
    if (!this.pendingCopyDestination) return;
    this.copyToNewDashboard(this.pendingCopyDestination);
  }

  chooseCopyToExistingDashboard(): void {
    if ((!this.pendingCopyDestination && !this.pendingCloneAll) || this.copySaving) return;
    this.existingDestinationOpen = !this.existingDestinationOpen;
    if (!this.existingDestinationOpen) return;
    this.destinationSearch = '';
    this.loadCopyTargets();
  }

  get filteredCopyTargets(): { dashboardId: number; dashboardName: string }[] {
    const search = this.destinationSearch.trim().toLowerCase();
    return this.copyTargets.filter(target => target.dashboardName.toLowerCase().includes(search));
  }

  cancelDestination(): void {
    if (this.copySaving) return;
    this.cancelCloneAll();
    this.cancelCopyDestination();
    this.existingDestinationOpen = false;
    this.destinationSearch = '';
    this.destinationError = '';
    this.copyTargets = [];
    this.copyTargetsLoading = false;
    this.copyTargetsRequest = (this.copyTargetsRequest || 0) + 1;
  }

  chooseCurrentDashboard(): void {
    if (this.copySaving) return;
    const existingIds = new Set(this.chartSlotsData.map(chart => chart.id));
    if (this.pendingCloneAll) {
      this.cloneAllToExistingDashboard();
    } else if (this.pendingCopyDestination) {
      const slot = this.pendingCopyDestination;
      const copy = { ...slot, id: this.newCloneSlotId(), widgetId: slot.widgetId ?? (Number(slot.id) || 0) };
      const index = this.chartSlotsData.findIndex(chart => chart.id === slot.id);
      this.chartSlotsData.splice(index + 1, 0, copy);
      this.syncUnifiedLayout();
      this.loadChartPreview(copy);
      this.cancelCopyDestination();
    }
    if (!this.pendingCloneAll && !this.pendingCopyDestination) this.cancelDestination();
    const addedChart = this.chartSlotsData.find(chart => !existingIds.has(chart.id));
    if (addedChart) this.pendingRevealChartId = addedChart.id;
  }

  onChartGridItemInit(chartId: string, element: HTMLElement): void {
    if (this.pendingRevealChartId !== chartId) return;
    this.pendingRevealChartId = null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  chooseNewDashboard(): void {
    if (this.copySaving) return;
    if (this.pendingCloneAll) this.cloneAllToNewDashboard();
    else this.chooseCopyToNewDashboard();
  }

  selectExistingDashboard(target: { dashboardId: number; dashboardName: string }): void {
    if (this.copySaving || target.dashboardId === this.dashboardId) return;
    let slots: ChartSelectorItem[];
    if (this.pendingCloneAll) {
      const { slot, filter, value } = this.pendingCloneAll;
      const values = value !== undefined ? [value] : this.getFilterValues(filter);
      if (!values.length) {
        this.destinationError = 'Filter values are still loading. Please try again.';
        return;
      }
      slots = values.map(plant => this.buildCloneSlot(slot, filter.sourceColumn, plant));
    } else if (this.pendingCopyDestination) {
      slots = [{ ...this.pendingCopyDestination }];
    } else return;
    this.pendingCopy = { slots, target };
    this.confirmCopyToDashboard();
  }

  copyToNewDashboard(slot: ChartSelectorItem): void {
    const copy = { ...slot, widgetId: slot.widgetId ?? (Number(slot.id) || 0) };
    this.openNewDashboardTab([copy]);
  }

  private openDashboardTab(): Window | null {
    const tab = window.open('', '_blank');
    if (!tab) {
      this.destinationError = 'Please allow pop-ups to open the dashboard in a new tab.';
      this.notify.showError(this.destinationError);
      this.cdr.markForCheck();
      return null;
    }
    tab.opener = null;
    return tab;
  }

  private openNewDashboardTab(clonedCharts: ChartSelectorItem[]): void {
    const tab = this.openDashboardTab();
    if (!tab) return;
    try {
      const cloneTransfer = `dashboard-clone-${crypto.randomUUID()}`;
      tab.sessionStorage.setItem(cloneTransfer, JSON.stringify(clonedCharts));
      const url = this.router.serializeUrl(this.router.createUrlTree(['/dashboard/board-builder'], {
        queryParams: { category: this.category, cloneTransfer },
      }));
      tab.location.replace(this.location.prepareExternalUrl(url));
      this.cancelDestination();
      this.closeChartMenu();
    } catch {
      tab.close();
      this.destinationError = 'Unable to open the dashboard in a new tab. Please try again.';
      this.notify.showError(this.destinationError);
      this.cdr.markForCheck();
    }
  }

  private loadCopyTargets(): void {
    const request = this.copyTargetsRequest = (this.copyTargetsRequest || 0) + 1;
    this.destinationError = '';
    this.copyTargets = [];
    this.copyTargetsLoading = true;
    this.dashboardService.getWipDashboardsMinimal().pipe(takeUntil(this.destroy$)).subscribe({
      next: (list) => {
        if (request !== this.copyTargetsRequest) return;
        this.copyTargets = list.filter(d => d.dashboardId !== this.dashboardId);
        this.copyTargetsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (request !== this.copyTargetsRequest) return;
        this.destinationError = 'Unable to load dashboards. Please try again.';
        this.copyTargetsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  requestCopyToDashboard(slot: ChartSelectorItem, target: { dashboardId: number; dashboardName: string }): void {
    this.pendingCopy = { slots: [slot], target };
    this.copyConfirmOpen = true;
    this.closeChartMenu();
    this.cdr.markForCheck();
  }

  get copyConfirmMessage(): string {
    if (!this.pendingCopy) return '';
    return `${this.pendingCopy.slots.length} chart(s) will be added to "${this.pendingCopy.target.dashboardName}". The source charts stay on this board.`;
  }

  cancelCopy(): void {
    this.copyConfirmOpen = false;
    this.pendingCopy = null;
    this.cdr.markForCheck();
  }

  confirmCopyToDashboard(): void {
    if (!this.pendingCopy || this.copySaving) return;
    const { slots, target } = this.pendingCopy;
    this.pendingCopyTab = this.openDashboardTab();
    if (!this.pendingCopyTab) return;
    this.copySaving = true;
    this.destinationError = '';
    this.dashboardService.getDashboardById(target.dashboardId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const d = res.data;
        if (!d) { this.failDestinationCopy('Target dashboard not found.'); return; }
        let cfg: { widgets?: unknown[]; layout?: DashboardLayoutConfig; chartColumns?: number; [k: string]: unknown } = {};
        try {
          cfg = d.configJson ? JSON.parse(d.configJson) : {};
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || (cfg.widgets !== undefined && !Array.isArray(cfg.widgets))) throw new Error();
        } catch { this.failDestinationCopy('Target dashboard configuration is invalid. No changes were saved.'); return; }
        const widgets = Array.isArray(cfg.widgets) ? [...cfg.widgets] as DashboardConfigWidget[] : [];
        const maxSort = widgets.reduce((m, w) => Math.max(m, w.sortOrder ?? 0), 0);
        slots.forEach((slot, index) => widgets.push({
          chartId: slot.widgetId ?? (Number(slot.id) || 0),
          sortOrder: maxSort + index + 1,
          type: 'chart',
          width: slot.width || null,
          height: slot.height || null,
          ...(slot.presetColumn ? { presetColumn: slot.presetColumn, presetValue: slot.presetValue ?? '' } : {}),
        }));
        if (cfg.layout) {
          const savedLayout = sanitizePersistedLayout(cfg.layout as DashboardLayoutConfig);
          if (!savedLayout) { this.failDestinationCopy('Target dashboard layout is invalid. No changes were saved.'); return; }
          const legacy = migrateLegacyWidgetsToLayout(widgets, Number(cfg.chartColumns) || 2);
          const existingItems = legacy.items.slice(0, widgets.length - slots.length).map(item =>
            savedLayout.items.find(saved => saved.type === item.type && saved.sortOrder === item.sortOrder) ?? item);
          const bottom = existingItems.reduce((maximum, item) => Math.max(maximum, item.y + item.rows), 0);
          const columns = Math.max(1, Math.min(savedLayout.columns, Number(cfg.chartColumns) || 2));
          const chartWidth = Math.max(1, Math.floor(savedLayout.columns / columns));
          const addedItems = legacy.items.slice(widgets.length - slots.length).map((item, index) => ({
            ...item, x: (index % columns) * chartWidth, y: bottom + Math.floor(index / columns) * item.rows, cols: chartWidth,
          }));
          if (addedItems.some(item => item.y + item.rows > getLayoutRowLimit([...existingItems, ...addedItems]))) {
            this.failDestinationCopy('Target dashboard has no space for these charts. Choose another dashboard.');
            return;
          }
          cfg.layout = { ...savedLayout, items: [...existingItems, ...addedItems] };
        }
        const request: SaveDashboardRequest = {
          dashboardName: d.dashboardName,
          categoryId: d.categoryId,
          description: d.description || undefined,
          configJson: JSON.stringify({ ...cfg, widgets }),
        };
        this.dashboardService.updateDashboard(target.dashboardId, request).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            this.notify.showSuccess(`${slots.length} chart(s) added to '${target.dashboardName}'.`);
            const tab = this.pendingCopyTab;
            this.pendingCopyTab = null;
            if (tab && !tab.closed) {
              const url = this.router.serializeUrl(this.router.createUrlTree(['/dashboard/builder', target.dashboardId], {
                queryParams: { name: d.dashboardName },
              }));
              tab.location.replace(this.location.prepareExternalUrl(url));
            }
            this.copySaving = false;
            this.cancelCopy();
            this.cancelDestination();
          },
          error: (err) => this.failDestinationCopy(err?.error?.message || err?.message || 'Failed to copy chart.'),
        });
      },
      error: () => this.failDestinationCopy('Failed to load target dashboard.'),
    });
  }

  private failDestinationCopy(message: string): void {
    this.pendingCopyTab?.close();
    this.pendingCopyTab = null;
    this.destinationError = message;
    this.notify.showError(message);
    this.copySaving = false;
    this.cancelCopy();
  }

  // ─── Undo ─────────────────────────────────────────────────
  // Every board change (add/remove/clone/copy/reorder/clear) ends in syncUnifiedLayout, so undo
  // points are recorded there centrally rather than in each handler: the board is compared with
  // the last recorded state, and if it differs that previous state becomes an undo step. Gridster
  // drag/resize (which never calls sync) records the same way via onEditorGridItemChange.
  // Snapshots copy each slot object, since a drag/resize writes x/y/width/height onto the slot.
  private undoStack: BuilderBoardSnapshot[] = [];
  private undoBaseline: BuilderBoardSnapshot | null = null;
  private readonly maxUndoSteps = 50;
  /** Set while a dashboard loads or an undo is applied, so those changes aren't recorded. */
  private undoSuspended = false;
  private gridUndoTimer: ReturnType<typeof setTimeout> | null = null;

  get canUndo(): boolean { return this.undoStack.length > 0; }

  private captureBoardSnapshot(): BuilderBoardSnapshot {
    return {
      tileSlots: this.tileSlots.map(slot => slot ? { ...slot } : null),
      chartSlotsData: this.chartSlotsData.map(slot => ({ ...slot })),
    };
  }

  private boardSignature(snapshot: BuilderBoardSnapshot): string {
    const key = (slot: TileSelectorItem | ChartSelectorItem | null) =>
      slot ? [slot.id, slot.x, slot.y, slot.width, slot.height] : null;
    return JSON.stringify([snapshot.tileSlots.map(key), snapshot.chartSlotsData.map(key)]);
  }

  /** Records the previous board state as an undo step if the board changed since it was taken. */
  private commitUndoPoint(): void {
    if (this.undoSuspended) return;
    const current = this.captureBoardSnapshot();
    if (this.undoBaseline && this.boardSignature(this.undoBaseline) !== this.boardSignature(current)) {
      this.undoStack.push(this.undoBaseline);
      if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    }
    this.undoBaseline = current;
  }

  /** One Gridster drag can fire the change callback for several pushed items — record it once. */
  private scheduleGridUndoPoint(): void {
    if (this.gridUndoTimer) return;
    this.gridUndoTimer = setTimeout(() => {
      this.gridUndoTimer = null;
      this.commitUndoPoint();
      this.cdr.markForCheck();
    }, 0);
  }

  private resetUndoHistory(): void {
    this.undoStack = [];
    this.undoBaseline = this.captureBoardSnapshot();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.undoSuspended = true;
    this.tileSlots = previous.tileSlots.map(slot => slot ? { ...slot } : null);
    this.chartSlotsData = previous.chartSlotsData.map(slot => ({ ...slot }));
    this.syncUnifiedLayout();
    this.undoBaseline = previous;
    this.cdr.markForCheck();
    this.scheduleChartReflow();
    // Outlast refreshEditorGrid's delayed updateGrid, which can re-fire Gridster item callbacks.
    setTimeout(() => {
      this.undoSuspended = false;
      this.undoBaseline = this.captureBoardSnapshot();
    }, 400);
  }

  // ─── Clear All ────────────────────────────────────────────
  requestClearAll(): void {
    this.tileSlots    = [null, null, null, null, null];
    this.chartSlotsData = [];
    this.syncUnifiedLayout();
    this.clearAdvancedFilters();
    this.cdr.markForCheck();
  }

  // ─── Chart slot drag-to-reorder ───────────────────────────
  chartDragIndex: number | null = null;
  chartDropIndex: number | null = null;

  onChartDragStart(index: number): void { this.chartDragIndex = index; }

  onChartDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    this.chartDropIndex = index;
  }

  onChartDragLeave(): void { this.chartDropIndex = null; }

  onChartDrop(index: number): void {
    if (this.chartDragIndex !== null && this.chartDragIndex !== index) {
      const item = this.chartSlotsData.splice(this.chartDragIndex, 1)[0];
      this.chartSlotsData.splice(index, 0, item);
      this.syncUnifiedLayout();
    }
    this.chartDragIndex = null;
    this.chartDropIndex = null;
    this.cdr.markForCheck();
  }

  onChartDragEnd(): void {
    this.chartDragIndex = null;
    this.chartDropIndex = null;
    this.cdr.markForCheck();
  }

  // ─── Chart resize ─────────────────────────────────────────
  private resizingIndex: number | null = null;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeStartW = 0;
  private resizeStartH = 0;

  onResizeStart(event: MouseEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizingIndex = index;
    this.resizeStartX  = event.clientX;
    this.resizeStartY  = event.clientY;
    const chart = this.chartSlotsData[index];
    const el    = (event.target as HTMLElement).closest('.board-chart-slot') as HTMLElement;
    this.resizeStartW = chart.width  || el?.offsetWidth  || 400;
    this.resizeStartH = chart.height || el?.offsetHeight || 300;
    document.addEventListener('mousemove', this.onResizeMove);
    document.addEventListener('mouseup',   this.onResizeEnd);
  }

  private onResizeMove = (event: MouseEvent): void => {
    if (this.resizingIndex === null) return;
    const chart   = this.chartSlotsData[this.resizingIndex];
    chart.width   = Math.max(250, this.resizeStartW + (event.clientX - this.resizeStartX));
    chart.height  = Math.max(200, this.resizeStartH + (event.clientY - this.resizeStartY));
    this.cdr.markForCheck();
  };

  private onResizeEnd = (): void => {
    this.resizingIndex = null;
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup',   this.onResizeEnd);
    this.cdr.markForCheck();
  };

  // ─── Help modal ───────────────────────────────────────────
  showHelpModal        = false;
  helpExpandedArticle: number | null = 0;

  openHelpModal(): void  { this.showHelpModal = true; }
  closeHelpModal(): void { this.showHelpModal = false; }

  toggleHelpArticle(index: number): void {
    this.helpExpandedArticle = this.helpExpandedArticle === index ? null : index;
  }

  // ─── Learn modal ──────────────────────────────────────────────────────────
  showLearnModal = false;

  openLearnModal(): void  { this.showLearnModal = true; }
  closeLearnModal(): void { this.showLearnModal = false; }
}

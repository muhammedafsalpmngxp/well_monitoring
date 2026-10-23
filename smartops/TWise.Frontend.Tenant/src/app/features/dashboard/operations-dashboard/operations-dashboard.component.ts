import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { resolveTileLayout, type TileLayout } from '../../../core/utils/tile-layout.util';
import { buildTimelineOptions } from '../../../core/utils/timeline-chart.util';
import { buildHistogramOptions } from '../../../core/utils/histogram-chart.util';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { isPlantFilter } from '../../../core/utils/plant-filter.util';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { applyChartSort } from '../../../core/utils/chart-sort.util';
import { highlightLegendPoint } from '../../../core/utils/chart-legend-hover.util';
import { legendLayoutClass, LegendPosition, readLegendPosition } from '../../../core/utils/chart-legend-position.util';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Lock, createElement } from 'lucide';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { consumeReliabilityReturn } from '../../../shared/components/reliability-details/reliability-navigation';
import type Highcharts from 'highcharts';
import { AdvancedChartPayload, advancedChartExport, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { concat, forkJoin, of, Subject, Subscription, firstValueFrom } from 'rxjs';
import { catchError, debounceTime, finalize, shareReplay, switchMap, takeUntil, tap, map } from 'rxjs/operators';
import { DashboardService } from '../../../core/services/dashboard.service';
import { WidgetService, WidgetDataFilter } from '../../../core/services/widget.service';
import { DashboardSavedFilterService } from '../../../core/services/dashboard-saved-filter.service';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { CommentService, CommentDto as CommentApiDto } from '../../../core/services/comment.service';
import { UserManagementService, TenantUserDto } from '../../../core/services/user-management.service';
import { DashboardBranding, normalizeDashboardBranding, DashboardLayoutConfig, WidgetLibraryItem, DashboardVersionSummaryResponse } from '../../../core/models/dashboard.model';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SCHEDULES_MODULE } from '../../../core/services/schedule.service';
import { ToastService } from '../../../core/services/toast.service';
import { ChartView, ChartViewIcon, chartSwitchOptions, chartViewIcon, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { DaxModelConfig, appendDaxToChartData, getActiveDaxMeasures, appendDaxToTableRows, getDaxRowColumnMeasures, formatDaxValue, evaluateTileDaxValue, getSelectedDaxMeasure, getSelectableDaxMeasures, withViewerMeasure } from '../../../core/utils/dax-evaluator.util';
import { SavedConditionalFilter, applyConditionalFilters, getSavedConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { ParameterFilterRule, applyParameterFilters, getSavedParameterFilters, remapDesignColumns } from '../../../core/utils/parameter-filter.util';
import { appendLockedFilterTitle } from '../../../core/utils/locked-filter-title.util';
import { CustomDashboardFilter, mergeDashboardSharedFilters } from '../../../core/utils/dashboard-shared-filter.util';
import { GlobalFilterSelection, globalSelectionValues, hasGlobalSelection, isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection, matchesGlobalSelection,
  globalSelectionLabel, globalSelectionPayload, globalSelectionQueryValue, parseGlobalSelection } from '../../../core/utils/global-filter-selection.util';
import { getViewDateRangeDefaults, hasFutureDateParameter } from '../../../core/utils/view-date-parameters.util';
import { sanitizePersistedLayout } from '../../../core/utils/dashboard-layout.util';
import { createDashboardExportHeader } from '../../../core/utils/dashboard-export-header.util';
import { waitForDashboardRender } from '../../../core/utils/dashboard-render-ready.util';
import { dashboardExportSafeCutYs, splitDashboardExport } from '../../../core/utils/dashboard-export-pages.util';
import { captureVisibleDashboardWidget, DashboardWidgetBounds, DashboardWidgetImage, expandDashboardChartScrollAreas, loadCloneFonts, measureDashboardWidgetCaptureWidth, onlyDashboardWidget, positionDashboardWidgets, prepareIndividualChartExportClone } from '../../../core/utils/dashboard-export-layout.util';
import { CHART_AUTO_COLORS, chartFallbackColor, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import { AiService } from '../../../core/services/ai.service';
import { chartDataFromOptions } from '../../../core/utils/chart-data.util';
import { canvasImage, writeAiDeck } from '../../../core/utils/ai-deck.util';
import { buildScatterOptions } from '../../../core/utils/scatter-chart.util';
import { buildHeatmapOptions, resolveHeatmapMeasure } from '../../../core/utils/heatmap-chart.util';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';
import type { InteractionDataAdapter } from '../interaction-config/interaction-config.component';
import { DashboardInteractionConfig, InteractionVisualInput, readInteractionConfig } from '../interaction-config/interaction.util';
import { tableClusterPlantFilters } from '../../../core/utils/table-global-filter.util';
import { AdvancedFilterComponent, type AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';

export type BoardAccent = 'purple' | 'blue' | 'green' | 'orange';
export type BoardIcon = 'gauge' | 'calendar' | 'crew';

export interface SavedFilterPreset {
  id: number;
  name: string;
  accent: 'purple' | 'green' | 'orange' | 'yellow';
  country: GlobalFilterSelection;
  sector: GlobalFilterSelection;
  businessUnit: GlobalFilterSelection;
  division: GlobalFilterSelection;
  cluster: GlobalFilterSelection;
  plant: GlobalFilterSelection;
  quickRange: string;
  fromDate: string;
  toDate: string;
  lastUsed: string;
  isFavorite: boolean;
}

const CHART_COLORS = [...CHART_AUTO_COLORS];
const ROW_BG_COLORS  = ['#F3F6FF', '#EBFFF2', '#FFFAF1', '#FFF1F1', '#E8F8FF'];
const ROW_DOT_COLORS = ['#1E3A8A', '#49D67D', '#F5A623', '#DC2626', '#38BDF8'];

const GRAPH_IMAGE_BY_ACCENT: Record<BoardAccent, string> = {
  purple: 'assets/images/graph-img1.svg',
  blue: 'assets/images/graph-img2.svg',
  green: 'assets/images/graph-img3.svg',
  orange: 'assets/images/graph-img4.svg',
};

interface TileDesign {
  daxModel?: DaxModelConfig;
  tileType?: string;
  title?: string;
  source?: string;
  sourceType?: string;
  valueField?: string;
  aggregation?: string;
  decimalPlaces?: number | string;
  shortenBigNumbers?: boolean;
  tileColor?: string;
  tileIcon?: string;
  badgeText?: string;
  badgeColor?: string;
  prefix?: string;
  suffix?: string;
  breakdownRows?: { id: number; label: string; value: string; color: string; sourceName?: string; sourceType?: string; column?: string }[];
  viewId?: number;
  drillDownViewId?: number | null;
  showTileIcon?: boolean;
  tileLayout?: TileLayout;
  valueBold?: boolean;
  valueItalic?: boolean;
  valueColor?: string;
  dataSourceMode?: string;
}

type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES = new Set(['line', 'multiline', 'grouped', 'stacked', 'area']);

interface ChartDesign {
  chartType?: string;
  tableHeaderColor?: string;
  tableHeaderTextColor?: string;
  tableRowColors?: string[];
  tableRowTextColors?: string[];
  tableGrid?: Partial<import('../../../core/utils/table-grid-features.util').TableGridOptions>;
  xAxis?: string;
  yAxis?: string;
  yAggColumn?: string;
  source?: string;
  sourceType?: string;
  topN?: number;
  bottomN?: number;
  limitCategory?: string;
  groupRestAsOthers?: boolean;
  sortOrder?: string;
  dataSourceMode?: string;
  viewId?: number;
  interactiveFilters?: { id: number; label: string; controlType: string; sourceTable: string; sourceColumn: string; hidden?: boolean; locked?: boolean; lockedValue?: string; lockedValues?: string[] }[];
  attachedTileIds?: number[];
  multiYColumns?: string[];
  comboLineColumns?: string[];
  showAxisTitle?: boolean;
  includeDataTable?: boolean;
  showStackTotal?: boolean;
  showDataLabels?: boolean;
  showLegend?: boolean;
  legendPosition?: LegendPosition;
  xAxisTitle?: string;
  yAxisTitle?: string;
  yAxis2Title?: string;
  drillDownViewId?: number;
  trendMode?: TrendMode;
  daxModel?: DaxModelConfig;
  conditionalFilters?: SavedConditionalFilter[];
  parameterFilters?: ParameterFilterRule[];
  gaugeMin?: number;
  gaugeMax?: number;
  bulletTargetColumn?: string;
  bubbleSizeColumn?: string;
  scatterCategoryColumn?: string;
  heatmapYColumn?: string;
  sankeyFromColumn?: string;
  sankeyToColumn?: string;
  sankeyWeightColumn?: string;
  timelineDateColumn?: string;
  timelineEndColumn?: string;
  histogramBins?: number;
  timelineLabelColumn?: string;
  colorRules?: ColorRule[];
  colorOverrides?: Record<string, string>;
  colorAssignments?: Record<string, string>;
}

/** Widget rectangles are fractions of the dashboard width, measured before capture. */
interface DashboardLayoutGeometry {
  rects: Map<string, DashboardWidgetBounds>;
}

interface ColorRule {
  field: string;
  operator: string;
  value: string;
  value2?: string;
  categories?: string[];
  color: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  chartCount: number;
  modifiedLabel: string;
  accent: BoardAccent;
  icon: BoardIcon;
  favorite: boolean;
}

export type KpiIcon = 'pin' | 'check' | 'alert' | 'image' | 'crew' | 'well' | 'gauge' | 'calendar' | 'derrick' | 'trend';
export type KpiAccent = 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'amber' | 'teal' | 'gray';
export type KpiStatus = 'default' | 'critical' | 'good';

export interface KpiFooterPart {
  label: string;
  value: string;
  highlight?: boolean;
  color?: string;
}

export interface Kpi {
  widgetId: number;
  /** Optional database view opened when a viewer clicks this tile. */
  drillDownViewId?: number | null;
  showIcon?: boolean;
  tileLayout?: TileLayout;
  valueBold?: boolean;
  valueItalic?: boolean;
  valueColor?: string;
  /** Exact sortOrder saved in configJson.widgets — used to look up its saved layout entry. */
  sortOrder: number;
  icon: KpiIcon;
  accent: KpiAccent;
  label: string;
  value: string;
  status: KpiStatus;
  footerParts?: KpiFooterPart[];
  footerText?: string;
  footerColor?: string;
}

/** An attached tile shown inline under a chart card; may open its own drill-down view when clicked. */
interface DashInlineTile {
  widgetId: number;
  drillDownViewId?: number | null;
  showIcon?: boolean;
  tileLayout?: TileLayout;
  valueBold?: boolean;
  valueItalic?: boolean;
  valueColor?: string;
  label: string;
  value: string;
  color: string;
  icon: string;
  breakdown: { label: string; value: string; color: string }[];
}

/** A single reply nested under a dashboard comment thread. */
export interface DashboardCommentReply {
  id: number;
  userId?: number;
  author: string;
  initials: string;
  avatarColor: string;
  timeAgo: string;
  text: string;
}

/** A comment thread anchored to a KPI/chart on the dashboard, shown in the right-side Comments panel. */
export interface DashboardComment {
  id: number;
  userId?: number;
  author: string;
  initials: string;
  avatarColor: string;
  timeAgo: string;
  text: string;
  /** Snapshot of what the comment was pinned to, shown as a small reference card. */
  targetLabel?: string;
  targetChips?: string[];
  replies: DashboardCommentReply[];
}

export type MetricColor = 'green' | 'orange' | 'red' | 'blue' | 'gray';

export interface MetricRow {
  label: string;
  value: number;
  percent: number;
  color: MetricColor;
}

export interface MetricColumn {
  title: string;
  icon: 'check' | 'clock' | 'alert';
  accent: 'green' | 'orange' | 'red';
  rows: MetricRow[];
}

export interface BoardChip {
  label: string;
  icon: 'gauge' | 'calendar' | 'crew' | 'more';
  accent: BoardAccent;
  active?: boolean;
  chevron?: boolean;
}

export interface StatTile {
  icon: 'plan' | 'excluded' | 'target' | 'delivered';
  accent: 'blue' | 'orange' | 'amber' | 'green';
  title: string;
  value: string;
  label: string;
  badge?: string;
}

export interface FunnelStage {
  label: string;
  value: number;
  tag: string;
  color: string;
}

export interface BreakdownRow {
  num: number;
  label: string;
  value: number;
  tag: string;
  color: string;
}

export interface BacklogSlice {
  label: string;
  value: number;
  percent: number;
  color: string;
}

export interface MiniStat {
  icon: 'trend-down' | 'trend-up' | 'target';
  accent: 'red' | 'green' | 'blue';
  label: string;
  value: string;
  subtitle: string;
}

export interface ClusterHealthRow {
  cluster: string;
  targetLabel: string;
  healthScore: number;
  planPct: number;
  actualPct: number;
  criticalWells: number;
  atRiskWells: number;
}

@Component({
  selector: 'app-operations-dashboard',
  standalone: false,
  templateUrl: './operations-dashboard.component.html',
  styleUrls: ['./operations-dashboard.component.scss'],
  host: { '[class.ops-dashboard-public]': 'isAnonymousShareView' },
})
export class OperationsDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  scoreValue(score: number | null | undefined): number { return score ?? -1; }
  scoreLabel(score: number | null | undefined): string { return score == null ? 'N/a' : String(score); }

  showReliabilityDialog = false;
  reliabilityDialogTitle = '';
  reliabilityDialogTable: string | null = null;
  reliabilityDialogViewId: number | null = null;

  openReliabilityDialog(card: { title: string; reliabilityTable?: string; reliabilityViewId?: number }, event: Event): void {
    event.stopPropagation();
    this.reliabilityDialogTitle = card.title;
    this.reliabilityDialogTable = card.reliabilityTable ?? null;
    this.reliabilityDialogViewId = card.reliabilityViewId ?? null;
    this.showReliabilityDialog = true;
  }

  closeReliabilityDialog(): void { this.showReliabilityDialog = false; }
  isLoading = false;
  /** An interactive dashboard (charts and tiles that filter or highlight each other), when this board was built as one. */
  interactionConfig: DashboardInteractionConfig | null = null;
  interactionCharts: InteractionVisualInput[] = [];
  interactionTiles: InteractionVisualInput[] = [];
  interactionReloadToken = 0;
  readonly interactionAdapter: InteractionDataAdapter = {
    transformSql: sql => this.injectDateParams(sql, true),
    previewFilters: viewId => this.globalPreviewFilters(viewId),
    filterRows: rows => this.applyGlobalRowFilter(rows),
  };
  dashboardStatus = '';
  isReadOnlyShareView = false;
  isInternalShareView = false;
  /** True only for the anonymous (no-JWT) external share-token link — data requests must carry the share token to authenticate. */
  isAnonymousShareView = false;
  shareToken = '';

  /** Share-token params to attach to table/view data requests when viewing an anonymous shared dashboard; undefined otherwise (normal authenticated requests are unaffected). */
  get shareDataContext(): { dashboardId: number; token: string } | undefined {
    return this.isAnonymousShareView && this.currentDashboardId
      ? { dashboardId: this.currentDashboardId, token: this.shareToken }
      : undefined;
  }
  isPublishing = false;
  /** Published version history for the current dashboard's series; empty until loaded. */
  versions: DashboardVersionSummaryResponse[] = [];
  /** DashboardId of the version currently shown (drives the version dropdown selection). */
  currentDashboardId: number | null = null;
  get currentVersionNo(): number | string {
    return this.versions.find(v => v.dashboardId === this.currentDashboardId)?.versionNo ?? '';
  }
  get isCurrentVersionLatest(): boolean {
    return !!this.versions.find(v => v.dashboardId === this.currentDashboardId)?.isLatestVersion;
  }
  /** Count of chart/tile data requests still in flight for the current dashboard load. */
  private pendingLoads = 0;
  private loadSub?: Subscription;
  private readonly notify: NotificationHelper;

  get error(): string { return this.notify.error; }
  get successMessage(): string { return this.notify.successMessage; }

  board: BoardSummary = {
    id: '',
    title: '',
    description: 'Cluster-wide well operations overview — KPIs, OOC alerts, and crew activity.',
    category: 'Operations',
    chartCount: 10,
    modifiedLabel: 'just now',
    accent: 'purple',
    icon: 'gauge',
    favorite: false,
  };

  kpis: Kpi[] = [];
  private kpiTileDefs: { widget: WidgetLibraryItem; design: TileDesign }[] = [];

  showFilterPanel = true;

  filterCountryOptions: string[] = [];
  filterCountry: GlobalFilterSelection = 'All';

  filterSectorOptions: string[] = [];
  filterSector: GlobalFilterSelection = 'All';

  filterBusinessUnitOptions: string[] = [];
  filterBusinessUnit: GlobalFilterSelection = 'All';

  filterDivisionOptions: string[] = [];
  filterDivision: GlobalFilterSelection = 'All';

  filterClusterOptions: string[] = [];
  filterCluster: GlobalFilterSelection = 'All';

  filterPlantOptions: string[] = [];
  filterPlant: GlobalFilterSelection = 'All';
  readonly globalSelectionLabel = globalSelectionLabel;
  readonly globalSelectionValues = globalSelectionValues;
  readonly isGlobalFilterOptionChecked = isGlobalFilterOptionChecked;

  private allPlants: PlantFilterDto[] = [];

  filterFrom = '';
  filterTo = '';

  /** Snap a date to the last Tuesday on or before it (ISO string). */
  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun … 2=Tue … 6=Sat
    const diff = (day + 5) % 7; // days since last Tuesday
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  onToDateChange(): void {
    this.onGlobalDateChange();
  }

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
    this.filterFrom = range.from;
    this.filterTo = range.to;
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

  private applyQuickRange(range: string): void {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    switch (range) {
      case 'Today':
        this.filterFrom = iso(today);
        this.filterTo = iso(today);
        break;
      case 'Till Last Tuesday':
        this.filterFrom = iso(new Date(today.getFullYear(), 0, 1));
        this.filterTo = this.lastTuesday(today);
        break;
      case 'This Week': {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay());
        this.filterFrom = iso(d);
        this.filterTo = iso(today);
        break;
      }
      case 'This Month':
        this.filterFrom = iso(new Date(today.getFullYear(), today.getMonth(), 1));
        this.filterTo = iso(today);
        break;
      case 'Last Month':
        this.filterFrom = iso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        this.filterTo = iso(new Date(today.getFullYear(), today.getMonth(), 0));
        break;
      case 'This Quarter': {
        const qm = Math.floor(today.getMonth() / 3) * 3;
        this.filterFrom = iso(new Date(today.getFullYear(), qm, 1));
        this.filterTo = iso(today);
        break;
      }
      case 'This Year':
        this.filterFrom = iso(new Date(today.getFullYear(), 0, 1));
        this.filterTo = iso(today);
        break;
      case 'After':
        this.filterTo = '';
        break;
    }
  }

  filterQuickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After', 'Custom'];
  filterQuickRange = '';

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
    if (typeof key !== 'string') {
      const filter = key as CustomDashboardFilter;
      if (hasGlobalSelection(filter.value)) this.selectCustomFilterOption(filter, 'All');
      return;
    }
    const selections: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector, businessUnit: this.filterBusinessUnit,
      division: this.filterDivision, cluster: this.filterCluster, plant: this.filterPlant,
    };
    if (hasGlobalSelection(selections[key])) this.selectFilterOption(key, 'All');
  }

  // ── Saved Filter presets ───────────────────────────────
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
      { label: 'Country', value: globalSelectionLabel(this.filterCountry) },
      { label: 'Sector', value: globalSelectionLabel(this.filterSector) },
      { label: 'Business Unit', value: globalSelectionLabel(this.filterBusinessUnit) },
      { label: 'Division', value: globalSelectionLabel(this.filterDivision) },
      { label: 'Cluster', value: globalSelectionLabel(this.filterCluster) },
      { label: 'Plant', value: globalSelectionLabel(this.filterPlant) },
      { label: 'Quick Range', value: this.filterQuickRange },
      { label: 'From Date', value: this.filterFrom },
      { label: 'To Date', value: this.filterTo },
    ];
  }

  presetMeta(preset: SavedFilterPreset): string {
    return [preset.country, preset.sector, preset.businessUnit, preset.division, preset.cluster]
      .filter(hasGlobalSelection).map(globalSelectionLabel).join(' • ');
  }

  /** Whether this preset is the one currently applied — only ever true for a single row. */
  isActivePreset(preset: SavedFilterPreset): boolean {
    return preset.id === this.activePresetId;
  }

  toggleSavedFilterList(event: Event): void {
    event.stopPropagation();
    this.showSavedFilterList = !this.showSavedFilterList;
    if (this.showSavedFilterList && this.currentDashboardId) {
      this.savedFilterService.getAll(this.currentDashboardId).pipe(takeUntil(this.destroy$)).subscribe(filters => {
        this.savedFilterPresets = filters.map((f, i) => ({
          id: f.id,
          name: f.filterName,
          accent: this.presetAccents[i % this.presetAccents.length],
          country: parseGlobalSelection(f.country ?? 'All'),
          sector: parseGlobalSelection(f.sector ?? 'All'),
          businessUnit: parseGlobalSelection(f.businessUnit ?? 'All'),
          division: parseGlobalSelection(f.division ?? 'All'),
          cluster: parseGlobalSelection(f.cluster ?? 'All'),
          plant: parseGlobalSelection(f.plant ?? 'All'),
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
    this.filterCountry = preset.country;
    this.filterSector = preset.sector;
    this.filterBusinessUnit = preset.businessUnit;
    this.filterDivision = preset.division;
    this.filterCluster = preset.cluster;
    this.filterPlant = preset.plant;
    this.filterQuickRange = preset.quickRange;
    if (preset.fromDate) this.filterFrom = this.toDateOnly(preset.fromDate);
    if (preset.toDate) this.filterTo = this.toDateOnly(preset.toDate);
    this.activePresetId = preset.id;
    this.rebuildCascadingOptions();
    this.onClusterChange();
    this.onGlobalDateChange();
    this.showSavedFilterList = false;
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
    if (!preset || !this.currentDashboardId) { this.cancelDeletePreset(); return; }

    this.savedFilterService.delete(this.currentDashboardId, preset.id).pipe(takeUntil(this.destroy$)).subscribe({
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
    if (!this.currentDashboardId) return;
    const next = !preset.isFavorite;
    this.savedFilterService.setFavorite(this.currentDashboardId, preset.id, next).pipe(takeUntil(this.destroy$)).subscribe(() => {
      preset.isFavorite = next;
      this.cdr.markForCheck();
    });
  }

  saveNewFilter(): void {
    const name = this.newFilterName.trim();
    if (!name || !this.currentDashboardId) return;

    if (this.renamingPresetId) {
      const id = this.renamingPresetId;
      this.savedFilterService.rename(this.currentDashboardId, id, name).pipe(takeUntil(this.destroy$)).subscribe(() => {
        const preset = this.savedFilterPresets.find(p => p.id === id);
        if (preset) preset.name = name;
        this.renamingPresetId = null;
        this.showSaveFilterModal = false;
        this.notify.showSuccess(`'${name}' updated successfully.`);
        this.cdr.markForCheck();
      });
      return;
    }

    this.savedFilterService.save(this.currentDashboardId, {
      filterName: name,
      country: globalSelectionQueryValue(this.filterCountry),
      sector: globalSelectionQueryValue(this.filterSector),
      businessUnit: globalSelectionQueryValue(this.filterBusinessUnit),
      division: globalSelectionQueryValue(this.filterDivision),
      cluster: globalSelectionQueryValue(this.filterCluster),
      plant: globalSelectionQueryValue(this.filterPlant),
      quickRange: this.filterQuickRange,
      fromDate: this.filterFrom,
      toDate: this.filterTo,
    }).pipe(takeUntil(this.destroy$)).subscribe(saved => {
      const mapped: SavedFilterPreset = {
        id: saved.id,
        name: saved.filterName,
        accent: this.presetAccents[this.savedFilterPresets.length % this.presetAccents.length],
        country: parseGlobalSelection(saved.country ?? 'All'),
        sector: parseGlobalSelection(saved.sector ?? 'All'),
        businessUnit: parseGlobalSelection(saved.businessUnit ?? 'All'),
        division: parseGlobalSelection(saved.division ?? 'All'),
        cluster: parseGlobalSelection(saved.cluster ?? 'All'),
        plant: parseGlobalSelection(saved.plant ?? 'All'),
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
      this.notify.showSuccess(`'${name}' saved successfully.`);
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

  showExportModal = false;
  // Export Options popup: whether the full dashboard export (PDF/PPTX/PNG) includes each card's
  // data table / legend, independent of that card's own show/hide-table-or-legend setting.
  exportShowTable = true;
  exportShowLegends = true;
  activeCardExportIndex: number | null = null;
  versionDropdownOpen = false;
  // Narrow-card fallback: below a width threshold (see the card container query in the
  // stylesheet) the chart-type dropdown, export button, and expand button no longer fit side by
  // side, so all three are hidden in favor of a single toggle that opens one popover with all
  // three actions. Index of the card whose popover is open, or null.
  controlsPopoverIndex: number | null = null;

  toggleCardControlsPopover(i: number, event: Event): void {
    event.stopPropagation();
    this.controlsPopoverIndex = this.controlsPopoverIndex === i ? null : i;
    this.chartCards.forEach(c => c.showMenu = false);
    this.activeCardExportIndex = null;
  }

  @ViewChild('versionLockIcon') set versionLockIcon(element: ElementRef<HTMLElement> | undefined) {
    element?.nativeElement.replaceChildren(createElement(Lock, { width: 16, height: 16, 'aria-hidden': 'true' }));
  }
  isExporting = false;
  isDownloading = false;

  // ---- Comments panel ----
  showCommentsPanel = false;
  commentSearchText = '';
  newCommentText = '';
  activeReplyId: number | null = null;
  replyDraft: Record<number, string> = {};
  openCommentMenuId: number | null = null;
  /** True while the Post request is in flight — gives instant feedback on click instead of an apparent delay. */
  postingComment = false;
  /** CommentId currently posting a reply, if any (only one reply box can be active at a time anyway). */
  postingReplyId: number | null = null;
  /** Set from a notification deep link (?openComments=1&commentId=X); consumed once loadComments() resolves. */
  private pendingHighlightCommentId: number | null = null;
  /** CommentId to scroll to + visually flash, briefly, after a notification deep link. */
  highlightedCommentId: number | null = null;

  comments: DashboardComment[] = [];

  // ---- @mention autocomplete ----
  private tenantUsers: TenantUserDto[] = [];
  private tenantUsersLoaded = false;
  showMentionDropdown = false;
  mentionResults: TenantUserDto[] = [];
  mentionTarget: 'new' | number = 'new';
  private newCommentMentions: { userId: number; displayName: string }[] = [];
  private replyMentions: Record<number, { userId: number; displayName: string }[]> = {};

  /** Total comment + reply count shown on the header badge. */
  get commentsCount(): number {
    return this.comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);
  }

  get filteredComments(): DashboardComment[] {
    const q = this.commentSearchText.trim().toLowerCase();
    if (!q) return this.comments;
    return this.comments.filter(c =>
      c.author.toLowerCase().includes(q) ||
      c.text.toLowerCase().includes(q) ||
      c.replies.some(r => r.author.toLowerCase().includes(q) || r.text.toLowerCase().includes(q))
    );
  }

  get currentUserInitials(): string {
    const name = this.authService.getCurrentUser()?.displayName || '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  toggleCommentsPanel(): void {
    if (!this.canViewComments) return;
    this.showCommentsPanel = !this.showCommentsPanel;
    if (this.showCommentsPanel) {
      this.showExportModal = false;
      this.versionDropdownOpen = false;
      this.loadComments();
      this.loadTenantUsersForMentions();
    }
  }

  closeCommentsPanel(): void {
    this.showCommentsPanel = false;
    this.newCommentText = '';
    this.activeReplyId = null;
    this.showMentionDropdown = false;
  }

  /** Opens the panel and briefly flashes/scrolls to the comment a notification deep-linked to. */
  private openAndHighlightComment(commentId: number): void {
    if (!this.canViewComments) return;
    this.showCommentsPanel = true;
    this.highlightedCommentId = commentId;
    // Wait a tick for the *ngIf panel + comment list to actually render before querying the DOM.
    setTimeout(() => {
      document.getElementById(`comment-${commentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    setTimeout(() => {
      if (this.highlightedCommentId === commentId) this.highlightedCommentId = null;
    }, 3000);
  }

  private loadComments(): void {
    if (!this.canViewComments || !this.currentDashboardId) return;
    const dashboardId = this.currentDashboardId;
    this.commentService.getThread('Dashboard', dashboardId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: dtos => {
          if (this.currentDashboardId !== dashboardId || !this.canViewComments) return;
          // Keep any not-yet-reconciled optimistic comment (negative id, see postComment) on top —
          // a slow GET finishing after a fresh Post must not wipe out what the user just posted.
          const pendingOptimistic = this.comments.filter(c => c.id < 0);
          this.comments = [...pendingOptimistic, ...dtos.map(d => this.toCommentView(d))];
          if (this.pendingHighlightCommentId != null) {
            this.openAndHighlightComment(this.pendingHighlightCommentId);
            this.pendingHighlightCommentId = null;
          }
        },
        error: err => {
          console.error('Failed to load comments', err);
          this.notify.showError('Could not load comments. Please try again.');
        },
      });
  }

  postComment(): void {
    if (!this.canCreateComments) return;
    const text = this.newCommentText.trim();
    if (!text || this.postingComment) return;
    if (!this.currentDashboardId) {
      this.notify.showError('Comments are unavailable — dashboard not fully loaded yet.');
      return;
    }

    // Optimistic insert: show it immediately instead of waiting on the (remote DB) round-trip —
    // reconciled with the real row on success, rolled back on failure.
    const mentionedUserIds = this.extractMentionedUserIds(text, this.newCommentMentions);
    const user = this.authService.getCurrentUser();
    const tempId = -Date.now();
    this.comments.unshift({
      id: tempId,
      userId: user?.userId,
      author: user?.displayName || 'You',
      initials: this.currentUserInitials,
      avatarColor: this.colorForUser(user?.userId ?? 0),
      timeAgo: 'Just now',
      text,
      replies: [],
    });
    this.newCommentText = '';
    this.newCommentMentions = [];
    this.postingComment = true;

    this.commentService.create({
      targetType: 'Dashboard',
      targetId: this.currentDashboardId,
      body: text,
      mentionedUserIds,
    }).subscribe({
      next: dto => {
        const idx = this.comments.findIndex(c => c.id === tempId);
        if (idx !== -1) this.comments[idx] = this.toCommentView(dto);
        this.postingComment = false;
      },
      error: err => {
        console.error('Failed to post comment', err);
        this.notify.showError(err?.error?.message || 'Could not post comment. Please try again.');
        this.comments = this.comments.filter(c => c.id !== tempId);
        this.newCommentText = text;
        this.postingComment = false;
      },
    });
  }

  cancelNewComment(): void {
    this.newCommentText = '';
    this.newCommentMentions = [];
    this.showMentionDropdown = false;
  }

  toggleReplyBox(commentId: number): void {
    if (!this.canCreateComments) return;
    this.activeReplyId = this.activeReplyId === commentId ? null : commentId;
  }

  toggleCommentMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.openCommentMenuId = this.openCommentMenuId === id ? null : id;
  }

  deleteComment(id: number): void {
    const comment = this.comments.find(item => item.id === id);
    if (!comment || !this.canDeleteComment(comment)) return;
    this.commentService.delete(id).subscribe({
      next: () => {
        this.comments = this.comments.filter(c => c.id !== id);
        this.cdr.markForCheck();
      },
      error: err => {
        console.error('Failed to delete comment', err);
        this.notify.showError('Could not delete comment. Please try again.');
      },
    });
    this.openCommentMenuId = null;
  }

  deleteReply(comment: DashboardComment, replyId: number): void {
    const reply = comment.replies.find(item => item.id === replyId);
    if (!reply || !this.canDeleteComment(reply)) return;
    this.commentService.delete(replyId).subscribe({
      next: () => {
        this.comments = this.comments.map(current => current.id === comment.id
          ? { ...current, replies: current.replies.filter(reply => reply.id !== replyId) }
          : current);
        this.cdr.markForCheck();
      },
      error: err => {
        console.error('Failed to delete reply', err);
        this.notify.showError('Could not delete reply. Please try again.');
      },
    });
    this.openCommentMenuId = null;
  }

  postReply(comment: DashboardComment): void {
    if (!this.canCreateComments) return;
    const text = (this.replyDraft[comment.id] || '').trim();
    if (!text || this.postingReplyId === comment.id) return;
    if (!this.currentDashboardId) {
      this.notify.showError('Comments are unavailable — dashboard not fully loaded yet.');
      return;
    }

    // Optimistic insert (see postComment) — appears instantly, reconciled/rolled back below.
    const mentions = this.replyMentions[comment.id] || [];
    const mentionedUserIds = this.extractMentionedUserIds(text, mentions);
    const user = this.authService.getCurrentUser();
    const tempId = -Date.now();
    comment.replies.push({
      id: tempId,
      userId: user?.userId,
      author: user?.displayName || 'You',
      initials: this.currentUserInitials,
      avatarColor: this.colorForUser(user?.userId ?? 0),
      timeAgo: 'Just now',
      text,
    });
    this.replyDraft[comment.id] = '';
    this.replyMentions[comment.id] = [];
    this.activeReplyId = null;
    this.postingReplyId = comment.id;

    this.commentService.create({
      targetType: 'Dashboard',
      targetId: this.currentDashboardId,
      parentCommentId: comment.id,
      body: text,
      mentionedUserIds,
    }).subscribe({
      next: dto => {
        const idx = comment.replies.findIndex(r => r.id === tempId);
        if (idx !== -1) comment.replies[idx] = this.toReplyView(dto);
        this.postingReplyId = null;
      },
      error: err => {
        console.error('Failed to post reply', err);
        this.notify.showError(err?.error?.message || 'Could not post reply. Please try again.');
        comment.replies = comment.replies.filter(r => r.id !== tempId);
        this.replyDraft[comment.id] = text;
        this.postingReplyId = null;
      },
    });
  }

  // ── Comment API <-> view-model mapping ─────────────────────────────────────

  private readonly avatarPalette = ['#7C3AED', '#2563EB', '#F97316', '#16A34A', '#DC2626', '#0891B2'];

  private colorForUser(userId: number): string {
    return this.avatarPalette[Math.abs(userId) % this.avatarPalette.length];
  }

  private initialsFor(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  private timeAgoFrom(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  private toReplyView(dto: CommentApiDto): DashboardCommentReply {
    return {
      id: dto.commentId,
      userId: dto.userId,
      author: dto.authorDisplayName,
      initials: this.initialsFor(dto.authorDisplayName),
      avatarColor: this.colorForUser(dto.userId),
      timeAgo: this.timeAgoFrom(dto.createdAt),
      text: dto.body,
    };
  }

  private toCommentView(dto: CommentApiDto): DashboardComment {
    return {
      id: dto.commentId,
      userId: dto.userId,
      author: dto.authorDisplayName,
      initials: this.initialsFor(dto.authorDisplayName),
      avatarColor: this.colorForUser(dto.userId),
      timeAgo: this.timeAgoFrom(dto.createdAt),
      text: dto.body,
      replies: dto.replies.map(r => this.toReplyView(r)),
    };
  }

  // ── @mention autocomplete ───────────────────────────────────────────────────

  private loadTenantUsersForMentions(onLoaded?: () => void): void {
    if (!this.canCreateComments) return;
    if (this.tenantUsersLoaded) { onLoaded?.(); return; }
    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (!tenantId) return;
    this.userManagementService.listUsersByTenant(tenantId).subscribe({
      next: res => {
        this.tenantUsers = res.items;
        this.tenantUsersLoaded = true;
        onLoaded?.();
      },
      error: err => console.error('Failed to load tenant users for @mention', err),
    });
  }

  private extractMentionedUserIds(text: string, mentions: { userId: number; displayName: string }[]): number[] {
    // Only keep mentions whose "@Name" text the user didn't delete before posting.
    return mentions.filter(m => text.includes('@' + m.displayName)).map(m => m.userId);
  }

  onComposerInput(): void {
    this.checkMentionTrigger(this.newCommentText, 'new');
  }

  onReplyInput(commentId: number): void {
    this.checkMentionTrigger(this.replyDraft[commentId] || '', commentId);
  }

  private checkMentionTrigger(text: string, target: 'new' | number): void {
    const match = /@([\w.]{0,30})$/.exec(text);
    if (!match) {
      this.showMentionDropdown = false;
      return;
    }
    this.mentionTarget = target;

    // First "@" may fire before the (slow, ~1-2s) tenant-users fetch finishes — retry once it lands
    // instead of silently showing an empty dropdown.
    if (!this.tenantUsersLoaded) {
      this.loadTenantUsersForMentions(() => this.checkMentionTrigger(text, target));
      return;
    }

    const term = match[1].toLowerCase();
    this.mentionResults = this.tenantUsers
      .filter(u => u.displayName?.toLowerCase().includes(term))
      .slice(0, 8);
    this.showMentionDropdown = this.mentionResults.length > 0;
  }

  selectMention(user: TenantUserDto): void {
    const name = user.displayName || user.email;
    const replaceTrailing = (text: string) => text.replace(/@([\w.]{0,30})$/, `@${name} `);

    if (this.mentionTarget === 'new') {
      this.newCommentText = replaceTrailing(this.newCommentText);
      this.newCommentMentions.push({ userId: user.userId, displayName: name });
    } else {
      const id = this.mentionTarget;
      this.replyDraft[id] = replaceTrailing(this.replyDraft[id] || '');
      (this.replyMentions[id] ??= []).push({ userId: user.userId, displayName: name });
    }
    this.showMentionDropdown = false;
  }

  /** Manually triggered from the composer's "Mention" icon button — appends "@" to open the picker. */
  insertMentionTrigger(target: 'new' | number): void {
    if (target === 'new') {
      this.newCommentText += (this.newCommentText && !this.newCommentText.endsWith(' ') ? ' ' : '') + '@';
      this.checkMentionTrigger(this.newCommentText, 'new');
    } else {
      const cur = this.replyDraft[target] || '';
      this.replyDraft[target] = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + '@';
      this.checkMentionTrigger(this.replyDraft[target], target);
    }
  }

  private detectColsPerRow(): number {
    return this.chartColumns === 4 ? 4 : this.chartColumns === 3 ? 3 : 2;
  }

  get allCardsReady(): boolean {
    return this.chartCards.length > 0 && this.chartCards.every(c => c.dataReady);
  }

  toggleExportModal(): void {
    this.showExportModal = !this.showExportModal;
    this.activeCardExportIndex = null;
    // Each fresh open defaults back to "show everything" rather than remembering the last choice.
    if (this.showExportModal) { this.exportShowTable = true; this.exportShowLegends = true; }
  }

  toggleVersionDropdown(event: Event): void {
    event.stopPropagation();
    if (!this.canViewVersionHistory) return;
    this.versionDropdownOpen = !this.versionDropdownOpen;
  }

  selectVersion(dashboardId: number): void {
    this.versionDropdownOpen = false;
    this.onVersionSelect(dashboardId);
  }

  exportAs(_format: string): void { this.showExportModal = false; }

  toggleCardExport(i: number, event: Event): void {
    event.stopPropagation();
    this.activeCardExportIndex = this.activeCardExportIndex === i ? null : i;
    this.showExportModal = false;
  }

  exportCardAs(format: string): void {
    const idx = this.activeCardExportIndex;
    this.activeCardExportIndex = null;
    if (idx == null || !this.chartCards[idx]) return;
    const card = this.chartCards[idx];
    if (!card.dataReady) return;
    const title = card.title || 'Chart';
    this.cdr.detectChanges();
    setTimeout(() => {
      switch (format) {
        case 'pdf': this.exportCardPdf(idx, title); break;
        case 'png': this.exportCardPng(idx, title); break;
        case 'csv': this.exportCardCsv(card, title); break;
        case 'xlsx': this.exportCardXlsx(idx, card, title); break;
      }
    }, 100);
  }

  /** Export Options' Show Table/Show Legends checkboxes: force-hides a card's table/legend for
   *  this capture only, regardless of that card's own show/hide setting. Returns the elements'
   *  saved inline style (if any) so the caller can restore them - a no-op if both flags are true. */
  private hideExportTableAndLegends(root: HTMLElement, showTable: boolean, showLegends: boolean): { el: HTMLElement; css: string }[] {
    const saved: { el: HTMLElement; css: string }[] = [];
    const hide = (selector: string) => root.querySelectorAll<HTMLElement>(selector).forEach(el => {
      saved.push({ el, css: el.getAttribute('style') || '' });
      el.style.setProperty('display', 'none', 'important');
    });
    if (!showTable) hide('.ops-dashboard__chart-data-table, .ops-dashboard__table-grid');
    if (!showLegends) hide('.ops-dashboard__chart-legend');
    return saved;
  }

  private captureCard(idx: number, includeControls = false, keepFullTitle = true, matchDashboardView = false, includeScrollableContent = keepFullTitle, showTable = true, showLegends = true): Promise<HTMLCanvasElement> | null {
    const cards = this.exportHost.nativeElement.querySelectorAll('.ops-dashboard__card');
    const el = cards[idx] as HTMLElement;
    if (!el) return null;
    if (matchDashboardView) {
      // Export Options' Show Table/Show Legends checkboxes override each card's own setting - applied to
      // html2canvas's copy only, so the live card never changes during export (DFCT0010878).
      return captureVisibleDashboardWidget(el, keepFullTitle && el.querySelector('app-chart-table') ? this.buildStaticExportTable(idx) : null, includeScrollableContent,
        clone => this.hideExportTableAndLegends(clone, showTable, showLegends));
    }
    // Expand a hidden copy, never the live card: restyling the live card and its ancestors resized
    // the grid and dropped the scrollbar, so the dashboard shifted and flickered during export (DFCT0010301).
    // The stage is fixed-position and off-screen, so it takes no space in the layout and is never seen.
    // (html2canvas keeps visibility:hidden even when it is undone in its copy, so it is not hidden that way.)
    const individualExport = keepFullTitle && !includeControls;
    // Capture in layout pixels: html2canvas does not consistently render CSS zoom.
    // Only individual downloads grow to a wide table. Dashboard captures retain the slot width
    // and wrap headers so compositing does not squeeze the chart, title and labels.
    const baseCaptureW = el.offsetWidth;
    const captureW = includeScrollableContent && individualExport ? measureDashboardWidgetCaptureWidth(el, baseCaptureW) : baseCaptureW;
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${captureW}px;pointer-events:none;`;
    const copy = el.cloneNode(true) as HTMLElement;
    // The expanded popup lays the chart out beside the data table (more columns need more width
    // than that side-by-side layout spares) - exports always use the normal stacked layout instead.
    copy.classList.remove('ops-dashboard__card--expanded');
    // cloneNode does not copy canvas pixels.
    const liveCanvases = el.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((c, i) => c.getContext('2d')?.drawImage(liveCanvases[i], 0, 0));
    stage.appendChild(copy);
    el.parentElement!.appendChild(stage);
    // Expand so scrollable content (legend/data table) is fully captured instead of clipped like on-screen.
    copy.style.setProperty('height', 'auto', 'important');
    copy.style.setProperty('max-height', 'none', 'important');
    copy.style.setProperty('overflow', 'visible', 'important');
    const controlsEl = copy.querySelector('.ops-dashboard__card-controls') as HTMLElement | null;
    if (controlsEl && !includeControls) controlsEl.style.setProperty('display', 'none', 'important');
    // The global filter row appears only in the expanded card — exclude it from exports.
    (copy.querySelector('.ops-dashboard__card-inline-filter') as HTMLElement | null)?.style.setProperty('display', 'none', 'important');
    // .ops-dashboard__chart-body/.ops-dashboard__chart-table have their own fixed height + internal scroll —
    // override so the full legend and data table render instead of being clipped to the on-screen scroll area.
    const chartBodyEl = copy.querySelector('.ops-dashboard__chart-body') as HTMLElement | null;
    if (chartBodyEl) {
      chartBodyEl.style.setProperty('max-height', 'none', 'important');
      chartBodyEl.style.setProperty('overflow', 'visible', 'important');
    }
    const chartTableEl = copy.querySelector('.ops-dashboard__chart-table') as HTMLElement | null;
    if (chartTableEl) {
      chartTableEl.style.setProperty('height', 'auto', 'important');
      chartTableEl.style.setProperty('max-height', 'none', 'important');
      chartTableEl.style.setProperty('overflow', 'visible', 'important');
    }
    // html2canvas hangs on AG Grid (the Table chart type), which broke every PNG/PDF/PPTX export of a
    // card switched to Table. For the capture only, the grid is swapped for a plain table of the same data.
    const gridHost = copy.querySelector('app-chart-table') as HTMLElement | null;
    const staticTable = gridHost ? this.buildStaticExportTable(idx) : null;
    if (gridHost && staticTable) {
      gridHost.style.setProperty('display', 'none', 'important');
      gridHost.insertAdjacentElement('afterend', staticTable);
    }
    // A table wider than the card (horizontal scroll on screen) would otherwise just get clipped at
    // the fixed capture width — wrap its columns to fit instead so every column is still visible.
    if (includeScrollableContent) expandDashboardChartScrollAreas(copy);
    // Export Options' Show Table/Show Legends checkboxes override each card's own setting - the
    // clone is discarded after capture, so no restore is needed here (unlike the live `el` above).
    this.hideExportTableAndLegends(copy, showTable, showLegends);
    // '.ops-dashboard__chart-legend-item' is just the pill wrapper - the ellipsis/tooltip truncation
    // lives on its child '.ops-dashboard__chart-legend-label', which also needs un-clipping here.
    copy.querySelectorAll<HTMLElement>('.ops-dashboard__chart-legend-item, .ops-dashboard__chart-legend-label').forEach(li => {
      li.style.setProperty('overflow', 'visible', 'important');
      li.style.setProperty('text-overflow', 'unset', 'important');
      li.style.setProperty('max-width', 'none', 'important');
      li.style.setProperty('white-space', 'normal', 'important');
      li.style.setProperty('overflow-wrap', 'anywhere', 'important');
    });
    // The on-screen title is ellipsis-truncated to fit the card width. For a real downloadable
    // export (keepFullTitle, the default), un-clip it so the full name is captured instead of
    // baking the truncation into the exported image. The live "Preview" popup instead wants the
    // capture to look exactly like the on-screen card, so it passes keepFullTitle=false and keeps
    // the truncation.
    const titleTextEl = copy.querySelector('.ops-dashboard__card-title-text') as HTMLElement | null;
    if (titleTextEl && keepFullTitle) {
      titleTextEl.style.setProperty('overflow', 'visible', 'important');
      titleTextEl.style.setProperty('text-overflow', 'unset', 'important');
      titleTextEl.style.setProperty('white-space', 'normal', 'important');
    }
    // Inline tiles within a chart card (e.g. "Total/Actual/Plan" above a pie chart) are
    // ellipsis-truncated like the title - un-clip for every real export, not just individual ones
    // (the block below only ran for individual exports, so this was missing from full-dashboard ones).
    if (keepFullTitle) {
      copy.querySelectorAll<HTMLElement>('.board-inline-tile__label').forEach(span => {
        span.style.setProperty('overflow', 'visible', 'important');
        span.style.setProperty('text-overflow', 'unset', 'important');
        span.style.setProperty('white-space', 'nowrap', 'important');
        // Shrinking the font (instead of wrapping to 2 lines) keeps the label on one line, so
        // it can never overlap the value below it, while still showing the full name.
        const available = span.parentElement?.clientWidth ?? 0;
        if (available > 0 && span.scrollWidth > available) {
          const currentSize = parseFloat(getComputedStyle(span).fontSize) || 12;
          span.style.setProperty('font-size', `${Math.max(8, Math.floor(currentSize * (available / span.scrollWidth)))}px`, 'important');
        }
      });
      // Without wrapping, a row of several tiles overflows the card width and the excess tiles'
      // names get cut off at the fixed capture edge instead of just wrapping to a new line.
      const cardStatsEl = copy.querySelector('.board-inline-tiles') as HTMLElement | null;
      cardStatsEl?.style.setProperty('flex-wrap', 'wrap', 'important');
    }
    if (individualExport) {
      // Wrap long titles, stats and legend labels instead of clipping them (on the copy only).
      const setExportStyle = (selector: string, properties: Record<string, string>) =>
        copy.querySelectorAll<HTMLElement>(selector).forEach(element => {
          for (const [property, value] of Object.entries(properties)) element.style.setProperty(property, value, 'important');
        });
      setExportStyle('.ops-dashboard__card-title-row, .board-inline-tiles', { 'flex-wrap': 'wrap' });
      setExportStyle('.ops-dashboard__card-title-text, .board-inline-tile__label, .ops-dashboard__chart-legend-label',
        { 'white-space': 'normal', 'overflow': 'visible', 'text-overflow': 'unset', 'overflow-wrap': 'anywhere' });
      setExportStyle('.board-inline-tile__icon', { 'flex-shrink': '0' });
    }
    const captureH = individualExport ? Math.max(el.offsetHeight, copy.scrollHeight) : copy.scrollHeight;
    return html2canvas(copy, {
      scale: individualExport ? 2 : 2 * el.getBoundingClientRect().width / baseCaptureW,
      useCORS: true, backgroundColor: '#ffffff', x: 0, y: 0, width: captureW, height: captureH, scrollX: 0, scrollY: 0,
      // Lay the copy out at the real window size so the page around the stage renders as on screen.
      windowWidth: document.documentElement.clientWidth, windowHeight: Math.max(document.documentElement.clientHeight, captureH),
      ignoreElements: onlyDashboardWidget(copy),
      // html2canvas renders its own copy of the page: bring the stage into view there.
      onclone: (doc, clone) => {
        if (clone.parentElement) clone.parentElement.style.cssText = `position:fixed;left:0;top:0;width:${captureW}px;`;
        prepareIndividualChartExportClone(clone, captureW);
        // Last, after every restyle above: otherwise the title's words overlap in the PDF/PNG.
        return loadCloneFonts(doc, clone);
      },
    }).finally(() => stage.remove());
  }

  /** Plain-HTML copy of a Table card's grid (same data, header and row colours) for image export. */
  private buildStaticExportTable(idx: number): HTMLTableElement | null {
    const card = this.chartCards[idx];
    const data = this.getCardTableData(idx);
    if (!card || !data.headers.length) return null;
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px;font-family:inherit;';
    const head = table.createTHead().insertRow();
    for (const header of data.headers) {
      const th = document.createElement('th');
      th.textContent = header;
      th.style.cssText = `text-align:left;padding:10px 12px;font-weight:600;background:${card.design.tableHeaderColor || '#2948A3'};color:${card.design.tableHeaderTextColor || '#FFFFFF'};`;
      head.appendChild(th);
    }
    const body = table.createTBody();
    data.rows.forEach((row, index) => {
      const tr = body.insertRow();
      const background = data.ruleRowColors[index] || data.rowBgColors[index] || '#FFFFFF';
      const color = card.design.tableRowTextColors?.[index] || '#101828';
      for (const value of row) {
        const td = tr.insertCell();
        td.textContent = value === null || value === undefined ? '' : String(value);
        td.style.cssText = `padding:9px 12px;border-bottom:1px solid #EAECF0;background:${background};color:${color};`;
      }
    });
    return table;
  }

  /** Captures a single KPI tile at its true on-screen width (full height, un-clipped), scroll-position independent. */
  private captureKpiTile(el: HTMLElement, matchDashboardView = false): Promise<HTMLCanvasElement | null> {
    // Both paths capture the tile the same way; the composite step positions/scales this canvas either way.
    void matchDashboardView;
    // Capture an off-screen copy, never the live tile: restyling the live tile and every ancestor up to
    // <body> made the dashboard shift and flicker once per tile during export (DFCT0010878, as DFCT0010301).
    // The tile's real box is measured on the live tile, which is only read.
    const originalClientW = el.clientWidth;
    const originalClientH = el.clientHeight;
    const tileW = el.offsetWidth;
    if (!tileW) return Promise.resolve(null);
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${tileW}px;pointer-events:none;`;
    const copy = el.cloneNode(true) as HTMLElement;
    stage.appendChild(copy);
    el.parentElement!.appendChild(stage);
    copy.style.setProperty('width', `${tileW}px`, 'important');
    copy.style.setProperty('height', 'auto', 'important');
    copy.style.setProperty('max-height', 'none', 'important');
    copy.style.setProperty('overflow', 'visible', 'important');
    // The on-screen label is ellipsis-truncated (+ tooltip) to fit the tile width - un-clip it so the
    // full name is captured; measuring scrollWidth/scrollHeight below already accounts for any wrap.
    copy.querySelectorAll<HTMLElement>('.ops-dashboard__kpi-label').forEach(label => {
      label.style.setProperty('overflow', 'visible', 'important');
      label.style.setProperty('text-overflow', 'unset', 'important');
      label.style.setProperty('white-space', 'normal', 'important');
    });
    // '.ops-dashboard__kpi-content' is the tile's inner scroll box (height:100%, overflow-y:auto) that
    // still clips the un-clipped label - un-clip it on the copy too.
    const contentEl = copy.querySelector<HTMLElement>('.ops-dashboard__kpi-content');
    contentEl?.style.setProperty('height', 'auto', 'important');
    contentEl?.style.setProperty('overflow', 'visible', 'important');
    // A tile sized smaller than its neighbors (saved custom layout) can leave too little room for
    // the wrapped label - if the un-clipped content does not fit the tile's ORIGINAL box, shrink
    // the icon/value too rather than the label alone overflowing past the rounded border.
    if (originalClientW > 0 && originalClientH > 0 && (copy.scrollWidth > originalClientW || copy.scrollHeight > originalClientH)) {
      copy.querySelectorAll<HTMLElement>('.ops-dashboard__kpi-icon, .ops-dashboard__kpi-icon svg, .ops-dashboard__kpi-value').forEach(shrinkEl => {
        if (shrinkEl.classList.contains('ops-dashboard__kpi-value')) {
          shrinkEl.style.setProperty('font-size', '16px', 'important');
        } else {
          const size = shrinkEl.tagName === 'svg' ? '18px' : '36px';
          shrinkEl.style.setProperty('width', size, 'important');
          shrinkEl.style.setProperty('height', size, 'important');
        }
      });
    }
    const captureW = copy.scrollWidth;
    const captureH = copy.scrollHeight;
    if (!captureW || !captureH) { stage.remove(); return Promise.resolve(null); }
    return html2canvas(copy, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff', x: 0, y: 0, width: captureW, height: captureH, scrollX: 0, scrollY: 0,
      windowWidth: document.documentElement.clientWidth, windowHeight: Math.max(document.documentElement.clientHeight, captureH),
      ignoreElements: onlyDashboardWidget(copy),
      // html2canvas renders its own copy of the page: bring the stage into view there.
      onclone: (doc, clone) => {
        if (clone.parentElement) clone.parentElement.style.cssText = `position:fixed;left:0;top:0;width:${tileW}px;`;
        prepareIndividualChartExportClone(clone, captureW);
        return loadCloneFonts(doc, clone);
      },
    }).then((canvas: HTMLCanvasElement) => canvas.width && canvas.height ? canvas : null)
      .finally(() => stage.remove());
  }

  /**
   * Captures each `.ops-dashboard__kpi` tile individually (not the `.ops-dashboard__kpis` wrapper, which
   * collapses to `display: contents` — zero size — in the saved custom-layout grid mode), tagged with its
   * saved sortOrder so exports can reproduce the tile's exact on-screen position/size.
   * Tiles are captured one at a time (not concurrently with card capture) to avoid two capture passes
   * fighting over the same shared ancestor elements' temporarily-overridden styles.
   */
  private async captureKpiTiles(ui: DashboardLayoutGeometry | null = null): Promise<{ canvas: HTMLCanvasElement; sortOrder: number }[]> {
    const els = Array.from(this.exportHost.nativeElement.querySelectorAll('.ops-dashboard__kpi')) as HTMLElement[];
    const tiles: { canvas: HTMLCanvasElement; sortOrder: number }[] = [];
    for (let i = 0; i < els.length; i++) {
      const kpi = this.kpis[i];
      if (!kpi) continue;
      try {
        const canvas = await this.captureKpiTile(els[i], ui?.rects.has(`tile:${kpi.sortOrder}`));
        if (canvas) tiles.push({ canvas, sortOrder: kpi.sortOrder });
        else console.error(`captureKpiTile returned null (zero size) for kpi idx=${i}, label=${kpi.label}`);
      } catch (err) { console.error(`captureKpiTile failed for kpi idx=${i}, label=${kpi.label}:`, err); }
    }
    return tiles;
  }

  /** Composites captured KPI tiles into a single row image — used when there's no saved custom layout to follow. */
  private compositeKpiRow(tiles: HTMLCanvasElement[]): HTMLCanvasElement | null {
    if (!tiles.length) return null;
    const gap = 24;
    const tileH = Math.max(...tiles.map(t => t.height));
    const totalW = tiles.reduce((sum, t) => sum + t.width, 0) + gap * (tiles.length - 1);
    const composite = document.createElement('canvas');
    composite.width = totalW;
    composite.height = tileH;
    const ctx = composite.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, composite.width, composite.height);
    let cx = 0;
    tiles.forEach(t => {
      ctx.drawImage(t, cx, 0, t.width, t.height);
      cx += t.width + gap;
    });
    return composite;
  }

  /**
   * Snapshot the displayed widget rectangles, including layouts without a saved builder grid.
   */
  private measureDashboardGeometry(): DashboardLayoutGeometry | null {
    const grid = this.exportHost.nativeElement.querySelector('.ops-dashboard__saved-layout') as HTMLElement | null;
    if (!grid) return null;
    const gridRect = grid.getBoundingClientRect();
    if (!gridRect.width || !grid.clientWidth) return null;
    // Scroll offsets use layout pixels; widget rectangles include the application's CSS zoom.
    const scrollScale = gridRect.width / grid.offsetWidth;
    const rects = new Map<string, DashboardWidgetBounds>();
    const add = (key: string, el: Element | undefined) => {
      if (!(el instanceof HTMLElement)) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      rects.set(key, {
        x: (rect.left - gridRect.left + grid.scrollLeft * scrollScale) / gridRect.width,
        y: (rect.top - gridRect.top + grid.scrollTop * scrollScale) / gridRect.width,
        w: rect.width / gridRect.width,
        h: rect.height / gridRect.width,
      });
    };
    const kpiEls = grid.querySelectorAll('.ops-dashboard__kpi');
    this.kpis.forEach((kpi, i) => add(`tile:${kpi.sortOrder}`, kpiEls[i]));
    const cardEls = this.exportHost.nativeElement.querySelectorAll('.ops-dashboard__card');
    this.chartCards.forEach((card, i) => add(`chart:${card.sortOrder ?? `index-${i}`}`, cardEls[i]));
    return { rects };
  }

  /**
   * Use displayed rectangles when available. Keep the legacy packing only as a fallback.
   */
  private packSavedLayout(
    kpiTiles: { canvas: HTMLCanvasElement; sortOrder: number }[],
    readyCards: typeof this.chartCards,
    cardCanvases: (HTMLCanvasElement | null)[],
    usableW: number,
    gap: number,
    ui: DashboardLayoutGeometry | null = null,
    includeScrollableContent = false,
  ): { items: { x: number; y: number; w: number; h: number; canvas: HTMLCanvasElement }[]; totalHeight: number } | null {
    if (ui) {
      const images: DashboardWidgetImage[] = [];
      kpiTiles.forEach(tile => {
        const bounds = ui.rects.get(`tile:${tile.sortOrder}`);
        if (!bounds) throw new Error(`Dashboard export geometry is missing for tile ${tile.sortOrder}.`);
        images.push({ bounds, canvas: tile.canvas });
      });
      readyCards.forEach((card, index) => {
        const canvas = cardCanvases[index];
        if (!canvas) return;
        const bounds = ui.rects.get(`chart:${card.sortOrder ?? `index-${this.chartCards.indexOf(card)}`}`);
        if (!bounds) throw new Error(`Dashboard export geometry is missing for chart ${card.sortOrder}.`);
        images.push({ bounds, canvas });
      });
      return positionDashboardWidgets(images, usableW, includeScrollableContent);
    }
    const layout = this.savedLayout;
    if (!layout) return null;
    const gridCols = layout.columns || 20;
    const colPx = (usableW + gap) / gridCols;

    type Entry = { gx: number; gy: number; cols: number; x: number; w: number; h: number; canvas: HTMLCanvasElement };
    const entries: Entry[] = [];
    kpiTiles.forEach(t => {
      const item = layout.items.find(it => it.type === 'tile' && it.sortOrder === t.sortOrder);
      if (!item) return;
      const w = item.cols * colPx - gap;
      const h = (t.canvas.height * w) / t.canvas.width;
      entries.push({ gx: item.x, gy: item.y, cols: item.cols, x: item.x * colPx, w, h, canvas: t.canvas });
    });
    readyCards.forEach((card, i) => {
      const canvas = cardCanvases[i];
      if (!canvas || card.sortOrder === undefined) return;
      const item = layout.items.find(it => it.type === 'chart' && it.sortOrder === card.sortOrder);
      if (!item) return;
      const w = item.cols * colPx - gap;
      const h = (canvas.height * w) / canvas.width;
      entries.push({ gx: item.x, gy: item.y, cols: item.cols, x: item.x * colPx, w, h, canvas });
    });
    if (!entries.length) return null;
    entries.sort((a, b) => a.gy - b.gy || a.gx - b.gx);

    // Masonry packing: track the lowest free y per grid column, place each item just below the
    // tallest neighbor it overlaps horizontally, then push that whole column span down by its height.
    const colBottom = new Array(gridCols).fill(0);
    const items = entries.map(e => {
      const colStart = Math.max(0, Math.min(gridCols - 1, e.gx));
      const colEnd = Math.max(colStart + 1, Math.min(gridCols, e.gx + e.cols));
      let y = 0;
      for (let c = colStart; c < colEnd; c++) y = Math.max(y, colBottom[c]);
      for (let c = colStart; c < colEnd; c++) colBottom[c] = y + e.h + gap;
      return { x: e.x, y, w: e.w, h: e.h, canvas: e.canvas };
    });
    return { items, totalHeight: Math.max(...colBottom) - gap };
  }

  private exportCardPdf(idx: number, title: string): void {
    const p = this.captureCard(idx);
    if (!p) return;
    p.then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdfW = 297;
      const pdfH = (canvas.height * pdfW) / canvas.width;
      const pageH = pdfH + 10;
      const pdf = new jsPDF({ orientation: pageH > pdfW ? 'portrait' : 'landscape', unit: 'mm', format: [pdfW, pageH] });
      pdf.addImage(imgData, 'PNG', 0, 5, pdfW, pdfH);
      pdf.save(`${title}.pdf`);
    });
  }

  private exportCardPng(idx: number, title: string): void {
    const p = this.captureCard(idx);
    if (!p) return;
    p.then(canvas => {
      const link = document.createElement('a');
      link.download = `${title}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  }

  private getExportTableData(card: { cats: string[]; vals: number[]; multiSeries: Highcharts.SeriesOptionsType[]; title: string; design?: ChartDesign; tableHeaders?: string[]; tableRows?: (string | number)[][]; advanced?: AdvancedChartPayload }): { headers: string[]; rows: (string | number)[][] } {
    if (card.advanced) return advancedChartExport(card.advanced);
    if (card.tableHeaders && card.tableRows) {
      return { headers: card.tableHeaders, rows: card.tableRows };
    }
    const headers = [card.design?.xAxisTitle || card.design?.xAxis || 'Parameter'];
    const rows: (string | number)[][] = [];
    if (card.multiSeries?.length) {
      headers.push(...card.multiSeries.map((s: any) => s.name ?? 'Series'));
      for (let i = 0; i < card.cats.length; i++) {
        rows.push([card.cats[i], ...card.multiSeries.map((s: any) => (s.data as number[])?.[i] ?? 0)]);
      }
    } else {
      headers.push('Value');
      for (let i = 0; i < card.cats.length; i++) {
        rows.push([card.cats[i], card.vals[i] ?? 0]);
      }
    }
    return { headers, rows };
  }

  private exportCardCsv(card: any, title: string): void {
    const { headers, rows } = this.getExportTableData(card);
    const escapeCsv = (v: string | number) => { const raw = String(v); const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; };
    const csvRows = [headers.map(escapeCsv).join(','), ...rows.map((r: (string | number)[]) => r.map(escapeCsv).join(','))];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private exportCardXlsx(idx: number, card: any, title: string): void {
    const cards = document.querySelectorAll('.ops-dashboard__card');
    const tableEl = cards[idx]?.querySelector('table') as HTMLTableElement | null;
    const sheetName = (title.replace(/[:\\//?*[\]]/g, '_').substring(0, 31)) || 'Sheet';
    if (tableEl) {
      const wb = XLSX.utils.table_to_book(tableEl, { sheet: sheetName });
      XLSX.writeFile(wb, `${title}.xlsx`);
      return;
    }
    const { headers, rows } = this.getExportTableData(card);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 25 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${title}.xlsx`);
  }

  @HostListener('document:click')
  closeExportModal(): void { this.showExportModal = false; this.activeCardExportIndex = null; this.versionDropdownOpen = false; this.openCommentMenuId = null; }

  exportDashboardPdf(): void {
    void this.exportDashboardVisual('pdf');
  }

  exportDashboardPng(): void {
    void this.exportDashboardVisual('png');
  }

  /**
   * AI slide deck (writeAiDeck): the narrative and key figures come from one AI call over the charts'
   * rendered rows; the slides use each card's captured image and the KPI tiles.
   */
  async exportDashboardDeck(): Promise<void> {
    if (this.isExporting) return;
    this.showExportModal = false;
    const ready = this.chartCards.map((c, idx) => ({ card: c, idx })).filter(x => x.card.dataReady);
    const charts = ready.map(x => ({ title: x.card.title, data: chartDataFromOptions(x.card.options), idx: x.idx })).filter(x => x.data?.rows.length);
    if (!charts.length) { this.notify.showError('No chart has data for a deck yet.'); return; }
    this.isExporting = true;
    this.cdr.markForCheck();
    try {
      const deck = await firstValueFrom(this.ai.deck({ title: this.board.title, charts: charts.map(c => ({ title: c.title, columns: c.data!.columns, rows: c.data!.rows, context: null })) }));
      const kpiTiles = await this.captureKpiTiles();
      const images: (HTMLCanvasElement | null)[] = [];
      for (const c of charts) {
        try { images.push(await (this.captureCard(c.idx, false, true) ?? Promise.resolve(null))); }
        catch (err) { console.error(`captureCard failed for deck, idx=${c.idx}:`, err); images.push(null); }
      }

      const kpiRow = this.compositeKpiRow(kpiTiles.sort((a, b) => a.sortOrder - b.sortOrder).map(t => t.canvas));
      await writeAiDeck(deck, { title: this.board.title, chartTitles: charts.map(c => c.title), images: images.map(canvasImage), kpiTiles: canvasImage(kpiRow) });
    } catch (err: unknown) {
      console.error('AI deck export failed:', err);
      const e = err as { error?: { message?: string }; message?: string };
      this.notify.showError(e?.error?.message || 'The AI deck could not be built. Please try again.');
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  // Exact Y positions (source canvas pixels) in a gap between composited cards/tiles, recorded
  // while renderDashboardPng() draws them, so page breaks never cut through a card.
  private lastExportSafeCutYs: number[] = [];
  private dashboardCaptureGeneration = 0;
  private dashboardRenderCompletion?: Promise<void>;

  // Preview can reveal inner scroll content independently of title handling; export defaults stay unchanged.
  // keepFullTitle is retained for the legacy fallback when the displayed layout cannot be measured.
  readonly captureDashboardPreview = (keepFullTitle = false, signal?: AbortSignal, includeScrollableContent = keepFullTitle, showTable = true, showLegends = true): Promise<HTMLCanvasElement> =>
    this.captureDashboard(keepFullTitle, signal, includeScrollableContent, showTable, showLegends);

  private async captureDashboard(keepFullTitle: boolean, signal?: AbortSignal, includeScrollableContent = keepFullTitle, showTable = true, showLegends = true): Promise<HTMLCanvasElement> {
    signal?.throwIfAborted();
    const generation = ++this.dashboardCaptureGeneration;
    const clearBusy = (): void => {
      if (generation === this.dashboardCaptureGeneration) {
        this.isExporting = false;
        this.cdr.markForCheck();
      }
    };
    signal?.addEventListener('abort', clearBusy, { once: true });
    this.isExporting = true;
    try {
      this.chartLoaders.forEach((_, index) => this.lazyLoadChart(index));
      this.kpiLoaders.forEach((_, index) => this.lazyLoadKpi(index));
      await waitForDashboardRender(() => this.pendingLoads === 0 && this.chartCards.every(card => card.dataReady), signal);
      // An interrupted canvas capture still restores temporary styles before the next one starts.
      await this.dashboardRenderCompletion;
      signal?.throwIfAborted();
      this.cdr.detectChanges();
      await loadCloneFonts(document, this.exportHost.nativeElement);
      signal?.throwIfAborted();
      const render = this.renderDashboardPng(keepFullTitle, includeScrollableContent, showTable, showLegends);
      this.dashboardRenderCompletion = render.then(() => undefined, () => undefined);
      const canvas = await render;
      signal?.throwIfAborted();
      return canvas;
    } finally {
      signal?.removeEventListener('abort', clearBusy);
      clearBusy();
    }
  }

  private renderDashboardPng(keepFullTitle = true, includeScrollableContent = keepFullTitle, showTable = true, showLegends = true): Promise<HTMLCanvasElement> {
    this.showExportModal = false;
    const cols = this.detectColsPerRow();
    const readyCards = this.chartCards.filter(c => c.dataReady);

    const ui = this.measureDashboardGeometry();
    // Capture cards sequentially to avoid ancestor style conflicts
    const origIndices = readyCards.map(c => this.chartCards.indexOf(c));
    const captureSequentially = async (): Promise<(HTMLCanvasElement | null)[]> => {
      const results: (HTMLCanvasElement | null)[] = [];
      for (const idx of origIndices) {
        try { results.push(await (this.captureCard(idx, true, keepFullTitle, !!ui, includeScrollableContent, showTable, showLegends) ?? Promise.resolve(null))); }
        catch (err) { console.error(`captureCard failed for chart card idx=${idx}:`, err); results.push(null); }
      }
      return results;
    };

    // Capture KPI tiles first, then cards — sequential (not Promise.all) so the two passes never
    // fight over the same shared ancestor elements' temporarily-overridden styles.
    return this.captureKpiTiles(ui).then(kpiTiles => captureSequentially().then(canvases => [kpiTiles, canvases] as const)).then(async ([kpiTiles, canvases]) => {
      // A tile/card that fails to capture (e.g. broken image, transient zero-size render) is simply
      // omitted from the export rather than aborting the whole thing - losing one tile is far better
      // than the user getting no export at all. packSavedLayout/the generic-grid branch below already
      // skip any `!canvas` entry, so this is safe to just log instead of throw.
      if (canvases.some(canvas => !canvas) || kpiTiles.length !== this.kpis.length) {
        const failedCardIndices = origIndices.filter((_, i) => !canvases[i]);
        console.warn('Dashboard capture incomplete - continuing with what was captured:', { expectedKpis: this.kpis.length, capturedKpis: kpiTiles.length, failedCardIndices });
      }
      const margin = 48;
      const gap = 36;
      const pageW = 3200;
      const usableW = pageW - margin * 2;
      const cardW = (usableW - gap * (cols - 1)) / cols;
      const header = await createDashboardExportHeader(this.board.title, this.exportHost.nativeElement, usableW);
      const headerH = header.height + 24;

      const saved = this.packSavedLayout(kpiTiles, readyCards, canvases, usableW, gap, ui, includeScrollableContent);

      const finalCanvas = document.createElement('canvas');

      if (saved) {
        // Keep the displayed widths on one common scale; downloads may need taller cards.
        // No page-height limit for PNG, so nothing needs to be scaled down.
        const pageH = margin + headerH + saved.totalHeight + margin;
        finalCanvas.width = pageW;
        finalCanvas.height = pageH;
        const ctx = finalCanvas.getContext('2d')!;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        ctx.drawImage(header, margin, margin);

        const y = margin + headerH;
        saved.items.forEach(it => ctx.drawImage(it.canvas, margin + it.x, y + it.y, it.w, it.h));

        this.lastExportSafeCutYs = dashboardExportSafeCutYs(saved.items, y, finalCanvas.height);

        return finalCanvas;
      }

      // No saved layout — fall back to a generic KPI row + uniform card grid.
      const kpiCanvas = this.compositeKpiRow(kpiTiles.map(t => t.canvas));
      const kpiH = kpiCanvas ? (kpiCanvas.height * usableW) / kpiCanvas.width : 0;

      const cardMetrics = readyCards.map((card, i) => {
        const canvas = canvases[i];
        const imgH = canvas ? (canvas.height * cardW) / canvas.width : 0;
        return { imgH, totalH: imgH + 16 };
      });

      const rowsCount = Math.ceil(readyCards.length / cols);
      let pageH = margin + headerH + (kpiH ? kpiH + gap : 0);
      for (let r = 0; r < rowsCount; r++) {
        let rowMax = 0;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx < cardMetrics.length) rowMax = Math.max(rowMax, cardMetrics[idx].totalH);
        }
        pageH += rowMax + gap;
      }
      pageH += margin;

      finalCanvas.width = pageW;
      finalCanvas.height = pageH;
      const ctx = finalCanvas.getContext('2d')!;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      ctx.drawImage(header, margin, margin);

      let y = margin + headerH;
      // Do NOT include the header-bottom boundary itself as a cut candidate - a break there
      // would produce a page containing only the header, with everything else pushed later.
      this.lastExportSafeCutYs = [];

      // KPI tiles row - captured from the live DOM so icons/colors match the UI exactly
      if (kpiCanvas) {
        ctx.drawImage(kpiCanvas, margin, y, usableW, kpiH);
        y += kpiH + gap;
        this.lastExportSafeCutYs.push(y - gap / 2);
      }

      let x = margin;
      let colIdx = 0;
      let rowMaxH = 0;

      readyCards.forEach((card, i) => {
        const canvas = canvases[i];
        const metrics = cardMetrics[i];
        if (!canvas) {
          colIdx++;
          if (colIdx >= cols) { colIdx = 0; x = margin; y += rowMaxH + gap; rowMaxH = 0; this.lastExportSafeCutYs.push(y - gap / 2); }
          else { x += cardW + gap; }
          return;
        }

        // Chart card image - captured from the DOM (title, chart, legend, data table) as-is
        ctx.drawImage(canvas, x, y, cardW, metrics.imgH);

        if (metrics.totalH > rowMaxH) rowMaxH = metrics.totalH;
        colIdx++;
        if (colIdx >= cols) { colIdx = 0; x = margin; y += rowMaxH + gap; rowMaxH = 0; this.lastExportSafeCutYs.push(y - gap / 2); }
        else { x += cardW + gap; }
      });
      this.lastExportSafeCutYs.push(pageH);

      return finalCanvas;
    });
  }

  exportDashboardPptx(): void {
    void this.exportDashboardVisual('pptx');
  }

  private async exportDashboardVisual(format: 'pdf' | 'png' | 'pptx'): Promise<void> {
    if (this.isExporting) return;
    this.showExportModal = false;
    this.isDownloading = true;
    try {
      const canvas = await this.captureDashboardPreview(true, undefined, undefined, this.exportShowTable, this.exportShowLegends);
      this.isExporting = true;
      if (format === 'png') {
        const link = document.createElement('a');
        link.download = `${this.board.title}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } else if (format === 'pdf') {
        const width = 297;
        const pages = splitDashboardExport(canvas, 210 / width, this.lastExportSafeCutYs);
        const firstPage = pages[0];
        if (!firstPage) throw new Error('Dashboard PDF has no content.');
        const firstHeight = firstPage.height * width / firstPage.width;
        const pdf = new jsPDF({
          orientation: firstHeight > width ? 'portrait' : 'landscape',
          unit: 'mm',
          format: [width, firstHeight],
        });
        pages.forEach((page, index) => {
          // Match the page to its complete card group, without blank A4 space or resizing charts.
          const height = page.height * width / page.width;
          if (index) pdf.addPage([width, height], height > width ? 'portrait' : 'landscape');
          pdf.setFillColor(248, 250, 252);
          pdf.rect(0, 0, width, height, 'F');
          pdf.addImage(page.toDataURL('image/png'), 'PNG', 0, 0, width, height);
        });
        pdf.save(`${this.board.title}.pdf`);
      } else {
        const presentation = new PptxGenJS();
        const width = 13.333333;
        // One slide sized to the whole dashboard, not a fixed widescreen page per safe-cut group -
        // avoids the mostly-blank slides a short card group left on a fixed-height page/slide.
        // PowerPoint's custom layout height is capped around 56in; still scale down past that.
        const height = Math.min(56, width * canvas.height / canvas.width);
        presentation.defineLayout({ name: 'DASHBOARD', width, height });
        presentation.layout = 'DASHBOARD';
        const slide = presentation.addSlide();
        slide.background = { color: 'F8FAFC' };
        slide.addImage({ data: canvas.toDataURL('image/png'), x: 0, y: 0, w: width, h: height });
        await presentation.writeFile({ fileName: `${this.board.title}.pptx` });
      }
    } catch (err) {
      console.error('Dashboard export failed:', err);
      this.notify.showError('Dashboard export failed. Please try again.');
    } finally {
      this.isDownloading = false;
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  private injectDrillDownClick(
    options: Highcharts.Options, widgetId: number, trendMode?: TrendMode, card?: OperationsDashboardComponent['chartCards'][number],
  ): Highcharts.Options {
    return {
      ...options,
      plotOptions: {
        ...(options.plotOptions ?? {}),
        series: {
          ...((options.plotOptions as any)?.series ?? {}),
          cursor: 'pointer',
          events: { ...options.plotOptions?.series?.events, click: (e: any) => {
            const p = e?.point; const isCircular = p?.series?.type === 'pie' || p?.series?.type === 'funnel'; const cat = (isCircular ? (p?.name ?? p?.category) : (p?.category ?? p?.name)) ?? '';
            const seriesName = !isCircular && (options.series?.length ?? 0) > 1 ? String(p?.series?.name ?? '') : '';
            this.drillDownTo(widgetId, String(cat), trendMode, card, seriesName);
          } },
        },
      },
    };
  }

  private drillDownTo(widgetId: number, cat: string, trendMode?: TrendMode, source?: { sortOrder?: number; widgetId?: number }, seriesName?: string): void {
    const queryParams: Record<string, string> = {};
    if (String(cat)) queryParams['filter'] = String(cat);
    if (seriesName) queryParams['series'] = seriesName;
    if (trendMode) queryParams['mode'] = trendMode;
    const globalFilters: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector,
      businessUnit: this.filterBusinessUnit, division: this.filterDivision,
      cluster: this.filterCluster, plant: this.filterPlant,
    };
    for (const [key, value] of Object.entries(globalFilters)) {
      if (hasGlobalSelection(value)) queryParams[key] = globalSelectionQueryValue(value);
    }
    if (this.filterFrom) queryParams['fromDate'] = this.filterFrom;
    if (this.filterTo) queryParams['toDate'] = this.filterTo;
    // Clones of one chart share its widgetId: take the clicked card (by its dashboard slot), not the first clone.
    const slot = (c: { sortOrder?: number; widgetId?: number }) => String(c.sortOrder ?? c.widgetId ?? '');
    const clicked = (source && this.chartCards.find(card => slot(card) === slot(source)))
      ?? this.chartCards.find(card => card.widgetId === widgetId);
    const activeLocalFilters = (clicked?.localFilters ?? [])
      .filter(filter => filter.value || (filter.values?.length ?? 0) > 0)
      .map(filter => ({
        label: filter.label,
        sourceColumn: filter.sourceColumn,
        value: filter.controlType === 'MultiSelect' ? (filter.values ?? []).join(',') : filter.value,
      }));
    if (activeLocalFilters.length) queryParams['localFilters'] = JSON.stringify(activeLocalFilters);
    // Carry the originating board context so the drilldown page's breadcrumb can point
    // back to this dashboard board instead of defaulting to the Charts & Tiles trail.
    queryParams['boardFrom'] = this.isStandardDetailContext ? 'standard' : 'wip';
    if (this.currentDashboardId) queryParams['boardId'] = String(this.currentDashboardId);
    if (this.board?.title) queryParams['boardTitle'] = this.board.title;
    this.router.navigate(['/charts-tiles/view', widgetId, 'drilldown'], { queryParams });
  }

  /** Standalone KPI tile → open its drill-down view (if configured), carrying active global/date filters. */
  kpiDrillDown(kpi: Kpi): void {
    if (kpi.drillDownViewId) this.navigateWidgetDrillDown(kpi.widgetId);
  }

  /** Attached (inline) tile under a chart card → open the tile's own drill-down view. */
  inlineTileDrillDown(tile: DashInlineTile): void {
    if (tile.drillDownViewId) this.navigateWidgetDrillDown(tile.widgetId);
  }

  private navigateWidgetDrillDown(widgetId: number): void {
    const queryParams: Record<string, string> = {};
    const globalFilters: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector,
      businessUnit: this.filterBusinessUnit, division: this.filterDivision,
      cluster: this.filterCluster, plant: this.filterPlant,
    };
    for (const [key, value] of Object.entries(globalFilters)) {
      if (hasGlobalSelection(value)) queryParams[key] = globalSelectionQueryValue(value);
    }
    if (this.filterFrom) queryParams['fromDate'] = this.filterFrom;
    if (this.filterTo) queryParams['toDate'] = this.filterTo;
    queryParams['boardFrom'] = this.isStandardDetailContext ? 'standard' : 'wip';
    if (this.currentDashboardId) queryParams['boardId'] = String(this.currentDashboardId);
    if (this.board?.title) queryParams['boardTitle'] = this.board.title;
    this.router.navigate(['/charts-tiles/view', widgetId, 'drilldown'], { queryParams });
  }

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  selectFilterOption(name: string, value: string): void {
    const selections: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector, businessUnit: this.filterBusinessUnit,
      division: this.filterDivision, cluster: this.filterCluster, plant: this.filterPlant,
    };
    const options: Record<string, string[]> = {
      country: this.filterCountryOptions, sector: this.filterSectorOptions, businessUnit: this.filterBusinessUnitOptions,
      division: this.filterDivisionOptions, cluster: this.filterClusterOptions, plant: this.filterPlantOptions,
    };
    const v = toggleGlobalSelection(selections[name] ?? 'All', value, options[name], this.globalFilterClear.consume(name));
    switch (name) {
      case 'country':
        this.filterCountry = v;
        this.filterSector = 'All'; this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All';
        break;
      case 'sector':
        this.filterSector = v;
        this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All';
        break;
      case 'businessUnit':
        this.filterBusinessUnit = v;
        this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All';
        break;
      case 'division':
        this.filterDivision = v;
        this.filterCluster = 'All'; this.filterPlant = 'All';
        break;
      case 'cluster':
        this.filterCluster = v;
        this.filterPlant = 'All';
        break;
      case 'plant':
        this.filterPlant = v;
        break;
      case 'quickRange':
        this.filterQuickRange = value;
        this.applyQuickRange(value);
        this.onGlobalDateChange();
        break;
    }
    // Rebuild options (and auto-select any level that narrows to a single value) BEFORE
    // reloading chart data, so a cluster change that leaves only one plant reloads with
    // that plant already selected instead of a stale 'All'. When the user explicitly picks
    // "All" for cluster/plant, suppress that auto-select so the reset actually sticks.
    const resetToAll = v === 'All';
    this.rebuildCascadingOptions(
      resetToAll && name === 'cluster',
      resetToAll && (name === 'cluster' || name === 'plant'),
    );
    this.openFilterName = null;
    if (name !== 'quickRange') this.onClusterChange();
    this.persistFilterState();
  }

  /** Reset every filter field back to its default and refresh KPIs/charts. */
  clearAllFilters(): void {
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
    this.filterCountry = 'All';
    this.filterSector = 'All';
    this.filterBusinessUnit = 'All';
    this.filterDivision = 'All';
    this.filterCluster = 'All';
    this.filterPlant = 'All';
    this.filterQuickRange = '';
    this.customFilters.forEach(filter => filter.value = 'All');
    this.filterFrom = `${new Date().getFullYear()}-01-01`;
    this.filterTo = this.lastTuesday(new Date());
    this.openFilterName = null;
    this.activePresetId = null;
    this.autoSelectSingle();
    this.rebuildCascadingOptions();
    this.onClusterChange();
    this.onGlobalDateChange();
    this.persistFilterState();
  }

  /** Column count saved from the builder layout selection. */
  chartColumns = 2;
  savedLayout: DashboardLayoutConfig | null = null;

  /** Every rendered chart card with its options, for the dashboard-level Explain. */
  get explainCharts(): { title: string; options: Highcharts.Options | null }[] {
    return this.chartCards.filter(c => c.dataReady).map(c => ({ title: c.title, options: c.options ?? null }));
  }

  /** Dynamic chart cards rendered from configJson widgets. */
  chartCards: {
    title: string; chartType: ChartView; chartTypeOptions: ChartView[]; showMenu: boolean; options: Highcharts.Options;
    cats: string[]; vals: number[]; multiSeries: Highcharts.SeriesOptionsType[]; dataReady: boolean;
    additionalFilterNoData?: boolean;
    design: ChartDesign;
    hideDataTableOverride?: boolean;
    advanced?: AdvancedChartPayload;
    daxSummaries?: { name: string; value: number; formattedValue: string }[];
    tableHeaders?: string[]; tableRows?: (string | number)[][];
    localFilters: { label: string; controlType: string; sourceTable: string; sourceColumn: string; value: string; values?: string[]; options: string[]; hidden?: boolean; locked?: boolean; operator?: string; valueText?: string; mode?: string; dashboardAdditional?: boolean }[];
    inlineTiles: DashInlineTile[];
    rawRows?: Record<string, unknown>[];
    viewSql?: string; viewConnectionId?: number; viewIdForPreview?: number;
    width?: number; height?: number;
    score?: number | null; reliabilityBreakdown?: string; description?: string;
    reliabilityTable?: string; reliabilityViewId?: number;
    widgetId?: number;
    /** Exact sortOrder saved in configJson.widgets — used to look up its saved layout entry. */
    sortOrder?: number;
    isClone?: boolean;
    trendMode: TrendMode;
    /** Only these periods (x-axis values of the current trend mode) are shown; unset = all. */
    customPeriods?: string[];
    /** Trend mode the rawRows were loaded for. */
    rowsMode?: TrendMode;
    /** Local filter values the dashboard opened with, for the card's reset button. */
    defaultFilters?: { value: string; values: string[] }[];
    defaultChartType?: ChartView;
    /** Bar/column "Switch Metrics": switchable Y columns, the active one, and the open state. */
    metricSwitchColumns?: string[];
    activeMetric?: string;
    openMetricSwitch?: boolean;
  }[] = [];
  readonly chartColors = CHART_COLORS;
  /** Open MultiSelect card filter, keyed as "cardIdx:filterIdx". */
  openCardMultiFilter: string | null = null;

  chartViewLabel(view: ChartView): string { return chartViewLabel(view); }
  chartViewIcon(view: ChartView): ChartViewIcon { return chartViewIcon(view); }
  isTrendChart(design: ChartDesign): boolean { return TREND_CHART_TYPES.has(design.chartType ?? ''); }
  readonly legendLayoutClass = legendLayoutClass;
  legendPositionOf(card: { design?: ChartDesign }): LegendPosition { return readLegendPosition(card.design); }
  isSideLegend(card: { design?: ChartDesign }): boolean {
    const position = this.legendPositionOf(card);
    return position === 'left' || position === 'right';
  }

  tileValueColor(color: string): string {
    const colors: Record<string, string> = { blue: '#2563EB', green: '#16A34A', red: '#DC2626', amber: '#D97706', teal: '#0D9488' };
    return colors[color] ?? '#374151';
  }

  tileBreakdownBg(color: string): string {
    const colors: Record<string, string> = { blue: '#DBEAFE', green: '#DCFCE7', red: '#FEE2E2', amber: '#FEF9C3', teal: '#CCFBF1' };
    return colors[color] ?? '#F3F4F6';
  }

  tileBreakdownFg(color: string): string {
    const colors: Record<string, string> = { blue: '#1D4ED8', green: '#15803D', red: '#B91C1C', amber: '#A16207', teal: '#0F766E' };
    return colors[color] ?? '#374151';
  }

  savedGridStyle(type: 'tile' | 'chart', sortOrder: number | undefined): Record<string, string> | null {
    if (!this.savedLayout || sortOrder === undefined) return null;
    const item = this.savedLayout.items.find(candidate => candidate.type === type && candidate.sortOrder === sortOrder);
    if (!item) return null;
    return {
      'grid-column': `${item.x + 1} / span ${item.cols}`,
      'grid-row': `${item.y + 1} / span ${item.rows}`,
      // Reading order (top-to-bottom, then left-to-right) for the stacked tablet/phone layout,
      // where the saved grid placement is switched off.
      'order': String(item.y * 20 + item.x),
    };
  }

  /** Live Highcharts chart instances for reflow on fullscreen toggle. */
  private chartInstances: Highcharts.Chart[] = [];

  hasExpandedCard = false;
  expandedCardIndex: number | null = null;
  expandedCardShowFilter = false;

  onChartInstance(chart: Highcharts.Chart, idx: number): void {
    this.chartInstances[idx] = chart;
    // The chart height is responsive (fills its section); reflow once layout
    // has settled so it renders at the card's real height, not a stale size.
    requestAnimationFrame(() => { try { chart.reflow(); } catch { /* disposed */ } });
  }

  /** Strip the fixed pixel height so the chart fills its card section instead
   *  of rendering as a short, fixed box. */
  private fillCardChartHeight(options: Highcharts.Options): Highcharts.Options {
    return { ...options, chart: { ...(options.chart ?? {}), height: null as unknown as number } };
  }

  highlightSeries(cardIdx: number, seriesIdx: number): void {
    const chart = this.chartInstances[cardIdx];
    if (!chart) return;
    const card = this.chartCards[cardIdx];
    if (card && (card.chartType === 'pie' || card.chartType === 'donut' || card.multiSeries.length === 0)) {
      const target = card.chartType === 'pie' || card.chartType === 'donut'
        ? this.pieLegendPoint(cardIdx, seriesIdx)
        : chart.series[0]?.points?.find(point => point.index === seriesIdx);
      if (!target) {
        const isOmittedPieCategory = (card.chartType === 'pie' || card.chartType === 'donut')
          && seriesIdx >= 0
          && seriesIdx < (card.multiSeries.length || card.cats.length);
        if (isOmittedPieCategory) {
          chart.series[0]?.points?.forEach(point => point.setState('inactive'));
        } else {
          this.resetSeriesHighlight(cardIdx);
        }
        return;
      }
      chart.series[0]?.points?.forEach(point => {
        if (point !== target) point.setState('inactive');
      });
      // Highcharts shares the hover halo between points, so highlight the target last.
      highlightLegendPoint(target);
      return;
    }
    chart.series.forEach((s, i) => { s.setState(i === seriesIdx ? 'hover' : 'inactive'); });
  }

  resetSeriesHighlight(cardIdx: number): void {
    const chart = this.chartInstances[cardIdx];
    if (!chart) return;
    const card = this.chartCards[cardIdx];
    if (card && (card.chartType === 'pie' || card.chartType === 'donut' || card.multiSeries.length === 0)) {
      chart.series[0]?.points?.forEach(point => point.setState('normal'));
      return;
    }
    chart.series.forEach(s => s.setState('normal'));
  }

  /** Legend click: toggle a series (multi-series) or a category point (single-series) on the chart. */
  toggleSeries(cardIdx: number, index: number): void {
    const chart = this.chartInstances[cardIdx];
    const card = this.chartCards[cardIdx];
    if (!chart || !card || !chart.series) return;
    if (card.chartType === 'pie' || card.chartType === 'donut') {
      const point = this.pieLegendPoint(cardIdx, index);
      if (point) point.setVisible(!point.visible, true);
      return;
    }
    if (card.multiSeries.length > 0) {
      const s = chart.series[index];
      if (s) s.setVisible(!s.visible, true);
    } else {
      const pt = chart.series[0]?.points?.[index];
      if (pt) pt.setVisible(!pt.visible, true);
    }
  }

  isSeriesHidden(cardIdx: number, index: number): boolean {
    const chart = this.chartInstances[cardIdx];
    const card = this.chartCards[cardIdx];
    if (!chart || !card || !chart.series) return false;
    if (card.chartType === 'pie' || card.chartType === 'donut') {
      return this.pieLegendPoint(cardIdx, index)?.visible === false;
    }
    if (card.multiSeries.length > 0) {
      return chart.series[index]?.visible === false;
    }
    return chart.series[0]?.points?.[index]?.visible === false;
  }

  pieLegendColor(cardIdx: number, legendIndex: number): string {
    const point = this.pieLegendPoint(cardIdx, legendIndex);
    return point ? String(point.color) : this.chartColors[legendIndex % this.chartColors.length];
  }

  private pieLegendPoint(cardIdx: number, legendIndex: number): Highcharts.Point | undefined {
    const chart = this.chartInstances[cardIdx];
    const card = this.chartCards[cardIdx];
    if (!chart || !card) return undefined;
    const key = card.multiSeries.length > 0
      ? String((card.multiSeries[legendIndex] as any)?.name ?? '')
      : card.cats[legendIndex] ?? '';
    // A destroyed chart instance has no series; the template asks for every legend dot.
    return chart.series?.[0]?.points?.find(point => String(point.options.id ?? '') === key);
  }

  constructor(
    private readonly exportHost: ElementRef<HTMLElement>,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly location: Location,
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly layoutState: LayoutStateService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly toastService: ToastService,
    private readonly commentService: CommentService,
    private readonly userManagementService: UserManagementService,
    private readonly savedFilterService: DashboardSavedFilterService,
    private readonly ai: AiService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  /** Export → AI slide deck is offered only to roles with the Explain charts feature. */
  aiDeckAllowed = false;
  private aiFeaturesSub?: Subscription;

  get canCreate(): boolean { return this.permissionService.canCreate('dashboard.standard-boards'); }
  get canViewComments(): boolean { return !this.isAnonymousShareView && this.permissionService.canView('dashboard.comments'); }
  get canCreateComments(): boolean { return this.canViewComments && this.permissionService.canCreate('dashboard.comments'); }
  get canModifyComments(): boolean { return this.canViewComments && this.permissionService.canModify('dashboard.comments'); }
  get canViewVersionHistory(): boolean { return !this.isAnonymousShareView && this.permissionService.canView('dashboard.versions'); }

  canDeleteComment(comment: DashboardComment | DashboardCommentReply): boolean {
    return comment.id > 0 && this.canModifyComments
      && (this.permissionService.isAdminUser || (comment.userId != null && comment.userId === this.authService.getCurrentUser()?.userId));
  }
  get canEditDashboard(): boolean { return this.permissionService.canModify('dashboard.wip-boards'); }
  get canModify(): boolean { return this.permissionService.canModify('dashboard.standard-boards'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('dashboard.standard-boards'); }

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get isWipDetailContext(): boolean { return this.route.snapshot.queryParamMap.get('from') === 'wip'; }
  get isStandardDetailContext(): boolean { return this.route.snapshot.queryParamMap.get('from') === 'standard' || (!this.isWipDetailContext && this.dashboardStatus === 'Published'); }
  get canPublishDashboard(): boolean { return !this.isReadOnlyShareView && this.isAdmin && this.dashboardStatus === 'Draft'; }
  scheduleOpen = false;
  get canSchedule(): boolean {
    return !this.isLoading && !this.isAnonymousShareView && this.currentDashboardId !== null && this.permissionService.canCreate(SCHEDULES_MODULE);
  }
  get canUnpublishDashboard(): boolean { return this.isAdmin && this.dashboardStatus === 'Published' && this.isStandardDetailContext; }

  get parentBoardLabel(): string {
    if (this.isStandardDetailContext) return 'Standard Boards';
    return this.isAdmin ? 'WIP Boards' : 'My Boards';
  }
  get parentBoardRoute(): string {
    return this.isStandardDetailContext ? '/dashboard/standard-boards' : '/dashboard/wip-boards';
  }
  get breadcrumbs() { return [{label:'Home', route:'/'}, {label:'Dashboard', route:'/dashboard'}, {label: this.parentBoardLabel, route: this.parentBoardRoute}, {label: this.board.title}]; }

  get boardSubtitle(): string {
    const toMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(this.filterTo || '');
    const now = toMatch ? new Date(+toMatch[1], +toMatch[2] - 1, +toMatch[3]) : new Date();
    const day = now.getDate();
    const month = now.toLocaleString('en-GB', { month: 'long' });
    const year = now.getFullYear();
    const d = new Date(Date.UTC(year, now.getMonth(), day));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `As on ${day} ${month} ${year} (Week-${week})`;
  }

  private readonly destroy$ = new Subject<void>();
  private readonly dateChange$ = new Subject<void>();
  private readonly cancelReload$ = new Subject<void>();
  private rafId: number | null = null;
  private prevSidebarState: boolean | undefined;

  // ── Viewport lazy loading ──────────────────────────────────────────────────
  // Charts/tiles only fetch their data once their card scrolls near the viewport,
  // so opening a large board no longer fires every widget's request at once.
  @ViewChildren('lazyCardEl') private cardEls?: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('lazyKpiEl') private kpiEls?: QueryList<ElementRef<HTMLElement>>;
  private lazyObserver?: IntersectionObserver;
  private readonly chartLoaders: Array<(() => void) | undefined> = [];
  private readonly kpiLoaders: Array<(() => void) | undefined> = [];
  private readonly loadedChartIdx = new Set<number>();
  private readonly loadedKpiIdx = new Set<number>();

  ngOnInit(): void {
    this.aiFeaturesSub = this.ai.features().subscribe({ next: f => { this.aiDeckAllowed = f.enabled.includes('summary'); this.cdr.markForCheck(); }, error: () => { /* option stays hidden */ } });
    const id = this.route.snapshot.paramMap.get('id');
    this.initializeShareContext(id && !Number.isNaN(Number(id)) ? Number(id) : null);
    const reliabilitySource = consumeReliabilityReturn(this.router, this.location);
    if (reliabilitySource && !this.shareDataContext) {
      this.reliabilityDialogTitle = reliabilitySource.sourceLabel;
      this.reliabilityDialogTable = reliabilitySource.tableName;
      this.reliabilityDialogViewId = reliabilitySource.viewId;
      this.showReliabilityDialog = true;
    }
    this.prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();

    this.filterFrom = `${new Date().getFullYear()}-01-01`;
    this.filterTo = this.lastTuesday(new Date());
    this.dateChange$.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => this.executeGlobalDateRefresh());
    this.loadClusterOptions();
    // Prefetch early (this call is ~1-2s) so the @mention list is usually ready by the time the
    // Comments panel is opened, instead of racing the user's first "@" keystroke.
    this.loadTenantUsersForMentions();

    // Deep link from a comment-reply/mention notification (?openComments=1&commentId=X) — auto-open
    // the panel and scroll/highlight that comment once loadComments() below resolves.
    const params = this.route.snapshot.queryParamMap;
    if (this.canViewComments && params.get('openComments') === '1' && params.get('commentId')) {
      this.pendingHighlightCommentId = Number(params.get('commentId'));
    }

    if (id && !Number.isNaN(Number(id))) {
      this.loadDashboardData(Number(id));
    } else {
      // Fallback: read from query params (legacy navigation)
      const params = this.route.snapshot.queryParamMap;
      this.board = {
        id: id ?? this.board.id,
        title: params.get('title') ?? this.board.title,
        description: params.get('description') ?? this.board.description,
        category: params.get('category') ?? this.board.category,
        chartCount: Number(params.get('chartCount') ?? this.board.chartCount),
        modifiedLabel: params.get('modifiedLabel') ?? this.board.modifiedLabel,
        accent: (params.get('accent') as BoardAccent) ?? this.board.accent,
        icon: (params.get('icon') as BoardIcon) ?? this.board.icon,
        favorite: params.get('favorite') === 'true',
      };
    }
    this.restoreFilterState();
  }

  ngOnDestroy(): void {
    // Leaving the dashboard via in-app navigation resets filters so it reopens with defaults;
    // a hard page refresh doesn't run this, keeping the intended refresh-survival behavior.
    this.clearFilterState();
    this.loadSub?.unsubscribe();
    this.aiFeaturesSub?.unsubscribe();
    this.cancelReload$.next();
    this.cancelReload$.complete();
    this.destroy$.next();
    this.destroy$.complete();
    this.lazyObserver?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.expandedCard) {
      this.expandedCard.classList.remove('ops-dashboard__card--expanded');
      document.body.classList.remove('has-fullscreen-card');
      this.removeBackdrop();
      this.expandedCard = null;
      this.expandedCardIndex = null;
    }
    this.layoutState.setActiveNavOverride(null);
    if (this.prevSidebarState !== undefined) {
      this.prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.notify.destroy();
  }

  ngAfterViewInit(): void {
    this.setupLazyObserver();
    // Cards/tiles render asynchronously after the board loads, so re-observe
    // whenever the *ngFor lists change (initial render, clones, version switch).
    this.cardEls?.changes.pipe(takeUntil(this.destroy$)).subscribe(() => this.observeLazyElements());
    this.kpiEls?.changes.pipe(takeUntil(this.destroy$)).subscribe(() => this.observeLazyElements());
    this.observeLazyElements();
  }

  private setupLazyObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.lazyObserver = undefined;
      return;
    }
    this.lazyObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const idxAttr = el.dataset['lazyIdx'];
          if (idxAttr === undefined) { this.lazyObserver?.unobserve(el); continue; }
          const idx = Number(idxAttr);
          const loaded = el.dataset['lazyKpi'] !== undefined ? this.lazyLoadKpi(idx) : this.lazyLoadChart(idx);
          if (loaded) this.lazyObserver?.unobserve(el);
        }
      },
      // Preload a little before the card is actually visible for a smooth reveal.
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    );
  }

  /** (Re)observe every card/tile element that hasn't loaded its data yet. */
  private observeLazyElements(): void {
    if (this.savedLayout) {
      requestAnimationFrame(() => this.chartInstances.forEach(chart => chart?.reflow()));
    }
    if (!this.lazyObserver) {
      // No IntersectionObserver support — fall back to loading everything.
      this.chartLoaders.forEach((_, i) => this.lazyLoadChart(i));
      this.kpiLoaders.forEach((_, i) => this.lazyLoadKpi(i));
      return;
    }
    this.cardEls?.forEach(ref => {
      const el = ref.nativeElement;
      const idx = Number(el.dataset['lazyIdx']);
      if (!this.loadedChartIdx.has(idx)) this.lazyObserver!.observe(el);
    });
    this.kpiEls?.forEach(ref => {
      const el = ref.nativeElement;
      const idx = Number(el.dataset['lazyIdx']);
      if (!this.loadedKpiIdx.has(idx)) this.lazyObserver!.observe(el);
    });
  }

  /** Run a chart card's deferred data load once. Returns true once the loader has run. */
  private lazyLoadChart(idx: number): boolean {
    if (this.loadedChartIdx.has(idx)) return true;
    const loader = this.chartLoaders[idx];
    if (!loader) return false;
    this.loadedChartIdx.add(idx);
    loader();
    return true;
  }

  /** Run a KPI tile's deferred data load once. Returns true once the loader has run. */
  private lazyLoadKpi(idx: number): boolean {
    if (this.loadedKpiIdx.has(idx)) return true;
    const loader = this.kpiLoaders[idx];
    if (!loader) return false;
    this.loadedKpiIdx.add(idx);
    loader();
    return true;
  }

  /**
   * Mark a chart card / KPI tile as already loaded and stop observing it.
   * Called when a filter reload fetches its data directly, so the lazy observer
   * won't fire a second (and stale, unfiltered) fetch when it later scrolls into view.
   */
  private markChartLoaded(idx: number): void {
    this.loadedChartIdx.add(idx);
    const ref = this.cardEls?.find(r => Number(r.nativeElement.dataset['lazyIdx']) === idx);
    if (ref) this.lazyObserver?.unobserve(ref.nativeElement);
  }

  private markKpiLoaded(idx: number): void {
    this.loadedKpiIdx.add(idx);
    const ref = this.kpiEls?.find(r => Number(r.nativeElement.dataset['lazyIdx']) === idx);
    if (ref) this.lazyObserver?.unobserve(ref.nativeElement);
  }

  branding: DashboardBranding = {};

  goBack(): void {
    this.location.back();
  }

  private initializeShareContext(id: number | null): void {
    const routePath = this.route.snapshot.routeConfig?.path;
    this.currentDashboardId = id;
    this.isAnonymousShareView = routePath === 'public/:id';
    this.isInternalShareView = routePath === 'shared/:id';
    this.isReadOnlyShareView = this.isAnonymousShareView;
    this.shareToken = this.route.snapshot.queryParamMap.get('token') ?? '';
  }

  /** Loads the charts and tiles an interactive dashboard was built from (they need not be placed on the board grid). */
  private loadInteractionVisuals(config: DashboardInteractionConfig): void {
    const toInput = (widget: { id: number; name: string; designJson?: string; source?: string; sourceType?: string }): InteractionVisualInput => ({
      id: String(widget.id), title: widget.name, designJson: widget.designJson, source: widget.source, sourceType: widget.sourceType,
    });
    forkJoin(config.visuals.map(ref => this.widgetService.getWidgetById(Number(ref.id), this.shareDataContext).pipe(
      map(widget => ({ ref, widget })),
      catchError(() => of({ ref, widget: null })),
    ))).pipe(takeUntil(this.destroy$)).subscribe(results => {
      const loaded = results.filter(result => !!result.widget);
      this.interactionCharts = loaded.filter(result => result.ref.kind === 'chart').map(result => toInput(result.widget!));
      this.interactionTiles = loaded.filter(result => result.ref.kind === 'tile').map(result => toInput(result.widget!));
      this.cdr.markForCheck();
    });
  }

  /** Loads a specific dashboard version's content (widgets + config) in place. */
  private loadDashboardData(id: number): void {
    this.resetDashboardChartDates();
    this.isLoading = true;
    this.branding = {};
    this.interactionConfig = null;
    this.interactionCharts = [];
    this.interactionTiles = [];
    this.initializeShareContext(id);
    this.comments = [];
    this.activeReplyId = null;
    this.openCommentMenuId = null;
    const shareToken = this.shareToken;
    const isSharedView = this.isAnonymousShareView;
    this.loadSub = forkJoin({
      dashboard: isSharedView
        ? this.dashboardService.getSharedDashboard(id, shareToken)
        : this.dashboardService.getDashboardById(id),
      library: (isSharedView
        ? this.dashboardService.getSharedDashboardWidgets(id, shareToken)
        : this.dashboardService.getDashboardWidgets(id)).pipe(catchError(() => of({ tiles: [], charts: [] }))),
    }).subscribe({
      next: ({ dashboard: response, library }) => {
        const d = response.data;
        if (d) {
          this.currentDashboardId = d.dashboardId;
          if (d.dashboardId !== id) {
            this.pendingHighlightCommentId = null;
            const tree = this.router.createUrlTree(['/dashboard/operations-dashboard', d.dashboardId], {
              queryParams: this.route.snapshot.queryParams,
            });
            this.location.replaceState(this.router.serializeUrl(tree));
          }
          this.loadComments();
          this.dashboardStatus = d.status;
          // Keep the sidebar's "Published Boards"/"WIP Boards" section highlighted
          // while viewing this board — its own URL doesn't match either list route.
          this.layoutState.setActiveNavOverride(this.parentBoardRoute);

          // Build widget lookup from library
          const allLibraryWidgets: WidgetLibraryItem[] = [...(library.tiles ?? []), ...(library.charts ?? [])];
          const widgetMap = new Map(allLibraryWidgets.map(w => [w.id, w]));

          // Parse configJson widgets
          let configWidgets: { chartId: number; sortOrder: number; width?: number; height?: number; presetColumn?: string; presetValue?: string; hideDataTableOverride?: boolean }[] = [];
          this.savedLayout = null;
          this.customFilters = [];
          if (d.configJson) {
            try {
              const cfg = JSON.parse(d.configJson);
              this.customFilters = (cfg.customFilters ?? []).map((filter: Omit<CustomDashboardFilter, 'value'>) => ({
                ...filter, value: this.pendingCustomFilterValues[filter.id] || 'All',
              }));
              this.branding = normalizeDashboardBranding(cfg.branding);
              this.interactionConfig = readInteractionConfig(cfg.interactions);
              if (this.interactionConfig) this.loadInteractionVisuals(this.interactionConfig);
              configWidgets = cfg.widgets ?? [];
              this.chartColumns = cfg.chartColumns === 4 ? 4 : cfg.chartColumns === 3 ? 3 : 2;
              this.savedLayout = sanitizePersistedLayout(cfg.layout as DashboardLayoutConfig | undefined);
            } catch { /* ignore */ }
          }
          configWidgets = configWidgets.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

          this.board = {
            id: String(d.dashboardId),
            title: d.dashboardName,
            description: d.description || this.board.description,
            category: d.categoryName,
            chartCount: configWidgets.length,
            modifiedLabel: 'just now',
            accent: this.board.accent,
            icon: this.board.icon,
            favorite: false,
          };

          // Separate tile and chart widgets
          const tileWidgets: { widget: WidgetLibraryItem; design: TileDesign; sortOrder: number }[] = [];
          const chartWidgets: { widget: WidgetLibraryItem; design: ChartDesign; width?: number; height?: number; presetColumn?: string; presetValue?: string; sortOrder: number; hideDataTableOverride?: boolean }[] = [];

          for (const cw of configWidgets) {
            const lw = widgetMap.get(cw.chartId);
            if (!lw || !lw.designJson) continue;
            try {
              const parsed = JSON.parse(lw.designJson);
              if (lw.type === 'tile') {
                tileWidgets.push({ widget: lw, design: parsed as TileDesign, sortOrder: cw.sortOrder });
              } else {
                chartWidgets.push({ widget: lw, design: parsed as ChartDesign, width: cw.width, height: cw.height, presetColumn: cw.presetColumn, presetValue: cw.presetValue, sortOrder: cw.sortOrder, hideDataTableOverride: cw.hideDataTableOverride });
              }
            } catch { /* skip bad JSON */ }
          }

          // Load KPI tiles
          this.loadKpiTiles(tileWidgets);

          // Load chart widgets
          this.loadChartWidgets(chartWidgets);

          // A restored filter isn't applied by the tiles/charts' initial loaders (cluster/plant
          // row-filtering only runs on an explicit change) — force that one reload now so the
          // restored selection is actually reflected in the data, not just the dropdowns.
          if (this.pendingFilterReload) {
            this.pendingFilterReload = false;
            this.onClusterChange();
          } else if (!this.isAnonymousShareView) {
            // No locally-persisted filter — fall back to the dashboard's saved default filter (set from Build/Edit Dashboard).
            this.savedFilterService.getDefault(d.dashboardId).pipe(takeUntil(this.destroy$)).subscribe(def => {
              if (!def) return;
              if (def.country != null) this.filterCountry = parseGlobalSelection(def.country);
              if (def.sector != null) this.filterSector = parseGlobalSelection(def.sector);
              if (def.businessUnit != null) this.filterBusinessUnit = parseGlobalSelection(def.businessUnit);
              if (def.division != null) this.filterDivision = parseGlobalSelection(def.division);
              if (def.cluster != null) this.filterCluster = parseGlobalSelection(def.cluster);
              if (def.plant != null) this.filterPlant = parseGlobalSelection(def.plant);
              this.filterQuickRange = def.quickRange ?? this.filterQuickRange;
              if (def.fromDate) this.filterFrom = this.toDateOnly(def.fromDate);
              if (def.toDate) this.filterTo = this.toDateOnly(def.toDate);
              this.applyDashboardChartDates();
              this.onClusterChange();
              this.cdr.markForCheck();
            });
          }

          // Only published boards carry version history; a plain Draft/Completed board has none.
          if (!this.isAnonymousShareView && (d.status === 'Published' || d.status === 'Inactive')) {
            this.dashboardService.getVersionHistory(d.dashboardId).subscribe({
              next: (versions) => { this.versions = versions; this.cdr.markForCheck(); },
              error: () => { this.versions = []; },
            });
          } else {
            this.versions = [];
          }
        }
        // Reveal the grid once the board itself has loaded — each KPI/chart card
        // shows its own placeholder (skeleton / '—') while its own data streams in.
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to load dashboard.');
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** Called when the user picks a past/current version from the version dropdown. */
  onVersionSelect(dashboardId: number): void {
    if (!this.canViewVersionHistory || !dashboardId || dashboardId === this.currentDashboardId) return;
    this.loadDashboardData(dashboardId);
    // Keep the address bar in sync without re-running route resolution/ngOnInit.
    const tree = this.router.createUrlTree(['/dashboard/operations-dashboard', dashboardId], {
      queryParams: this.route.snapshot.queryParams,
    });
    this.location.replaceState(this.router.serializeUrl(tree));
  }

  editInBuilder(): void {
    if (this.isAnonymousShareView) return;
    if (this.board.id && !Number.isNaN(Number(this.board.id))) {
      this.router.navigate(['/dashboard/builder', this.board.id], {
        queryParams: { name: this.board.title, returnUrl: this.router.url },
      });
    } else {
      this.router.navigate(['/dashboard/builder'], {
        queryParams: { name: this.board.title, category: this.board.category, returnUrl: this.router.url },
      });
    }
  }

  publishDashboard(): void {
    if (!this.canPublishDashboard || !this.board.id || this.isPublishing) return;

    this.isPublishing = true;
    this.dashboardService.publishDashboard(Number(this.board.id)).subscribe({
      next: (response) => {
        this.isPublishing = false;
        this.dashboardStatus = 'Published';
        this.layoutState.setActiveNavOverride(this.parentBoardRoute);
        this.notify.showSuccess(response.data?.message || `'${this.board.title}' published successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPublishing = false;
        const status = err?.status;
        this.notify.showError(status === 403
          ? 'Dashboards can only be published by Admin users.'
          : err?.error?.message || err?.message || 'Failed to publish dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  unpublishDashboard(): void {
    if (!this.canUnpublishDashboard || !this.board.id || this.isPublishing) return;

    this.isPublishing = true;
    this.dashboardService.unpublishDashboard(Number(this.board.id)).subscribe({
      next: (response) => {
        this.isPublishing = false;
        this.toastService.pending = response.data?.message || `'${this.board.title}' moved to Draft.`;
        this.router.navigate(['/dashboard/wip-boards']);
      },
      error: (err) => {
        this.isPublishing = false;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to unpublish dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  toggleFilterPanel(): void {
    this.showFilterPanel = !this.showFilterPanel;
  }

  /** Toggle chart type menu for a specific chart card. */
  toggleChartMenu(idx: number, event: MouseEvent): void {
    event.stopPropagation();
    this.chartCards.forEach((c, i) => { if (i !== idx) c.showMenu = false; });
    this.chartCards[idx].showMenu = !this.chartCards[idx].showMenu;
  }

  /** Switch chart type for a specific chart card (not saved to DB). */
  selectChartType(idx: number, type: ChartView): void {
    const card = this.chartCards[idx];
    if (type === 'table') {
      this.chartCards[idx] = { ...card, chartType: type, showMenu: false };
      this.cdr.markForCheck();
      return;
    }
    const newOptions = this.fillCardChartHeight(applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(type, card.cats, card.vals, card.title, card.design, card.multiSeries), card.design.sortOrder), card.design.showDataLabels)));
    this.chartCards[idx] = { ...card, chartType: type, showMenu: false, dataReady: false };
    this.cdr.detectChanges();
    this.chartCards[idx] = { ...this.chartCards[idx], dataReady: true, options: newOptions };
    this.cdr.detectChanges();
  }

  private cardTableCache: Record<number, { ref: object; headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[]; ruleRowColors: string[] }> = {};

  hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  getCardTableData(idx: number): { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[]; ruleRowColors: string[] } {
    const card = this.chartCards[idx];
    if (!card) return { headers: [], rows: [], rowColors: [], rowBgColors: [], ruleRowColors: [] };
    const cached = this.cardTableCache[idx];
    if (cached && cached.ref === card) return cached;
    let result: { headers: string[]; rows: (string | number)[][]; rowColors: string[]; rowBgColors: string[] };
    if (card.tableHeaders && card.tableRows) {
      result = {
        headers: card.tableHeaders,
        rows: card.tableRows,
        rowColors: card.tableRows.map((_row, index) => ROW_DOT_COLORS[index % ROW_DOT_COLORS.length]),
        rowBgColors: card.tableRows.map((_row, index) => ROW_BG_COLORS[index % ROW_BG_COLORS.length]),
      };
    } else if (card.multiSeries?.length) {
      const headers = [card.design?.xAxisTitle || card.design?.xAxis || 'Parameter', ...card.multiSeries.map(s => (s as any).name ?? 'Series')];
      const rows = card.cats.map((cat, i) => [
        cat,
        ...card.multiSeries.map(s => ((s as any).data as number[])?.[i] ?? 0),
      ]);
      const rowColors   = card.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]);
      const rowBgColors = card.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]);
      result = { headers, rows, rowColors, rowBgColors };
    } else {
      const rowColors   = card.cats.map((_c, i) => ROW_DOT_COLORS[i % ROW_DOT_COLORS.length]);
      const rowBgColors = card.cats.map((_c, i) => ROW_BG_COLORS[i % ROW_BG_COLORS.length]);
      result = {
        headers: [card.design?.xAxisTitle || card.design?.xAxis || 'Parameter', 'Value'],
        rows: card.cats.map((cat, i) => [cat, card.vals[i] ?? 0]),
        rowColors,
        rowBgColors,
      };
    }
    // Row background for the table: a colour rule (category list or value condition) first, then the
    // per-row colours chosen in the builder; the palette stays the fallback inside the grid.
    const ruleRowColors = result.rows.map((row, index) => {
      const category = String(row[0] ?? '');
      const value = Number(row[1]);
      return this.categoryColorFor(category, card.design) ?? this.colorForRule(category, Number.isFinite(value) ? value : NaN, card.design)
        ?? card.design?.tableRowColors?.[index] ?? '';
    });
    const full = { ...result, ruleRowColors };
    this.cardTableCache[idx] = { ref: card, ...full };
    return full;
  }

  trackByCardTitle(_index: number, card: { title: string }): string {
    return card.title;
  }

  // A tile's value arrives as a new object; keep its element so it updates in place instead of
  // being rebuilt (which flickered and broke an export already holding the old element).
  trackByTileOrder(_index: number, tile: { sortOrder: number }): number {
    return tile.sortOrder;
  }

  @HostListener('document:click')
  closeAllMenus(): void {
    this.openCardMultiFilter = null;
    this.chartCards.forEach(c => c.showMenu = false);
    this.openFilterName = null;
    this.controlsPopoverIndex = null;
    if (Object.keys(this.trendMenuOpen).length) this.trendMenuOpen = {};
    this.pickerCard = null;
  }

  private expandedCard: HTMLElement | null = null;
  private backdropEl: HTMLDivElement | null = null;
  private sidebarWasCollapsed = false;

  private showBackdrop(): void {
    const el = document.createElement('div');
    el.className = 'ops-fs-backdrop';
    el.addEventListener('click', () => this.closeExpandedCard());
    document.body.appendChild(el);
    this.backdropEl = el;
  }

  private removeBackdrop(): void {
    this.backdropEl?.remove();
    this.backdropEl = null;
  }

  closeExpandedCard(): void {
    if (this.expandedCard) {
      this.expandedCard.classList.remove('ops-dashboard__card--expanded');
      document.body.classList.remove('has-fullscreen-card');
      this.removeBackdrop();
      if (!this.sidebarWasCollapsed) { this.layoutState.expand(); }
      this.expandedCard = null;
      this.hasExpandedCard = false;
      this.expandedCardIndex = null;
      this.rebuildAllChartOptions();
    }
  }

  toggleExpandedFilter(): void {
    this.expandedCardShowFilter = !this.expandedCardShowFilter;
  }

  toggleFullscreen(event: MouseEvent, index?: number): void {
    const card = (event.currentTarget as HTMLElement)
      .closest('.ops-dashboard__card') as HTMLElement | null;
    if (!card) return;

    if (card.classList.contains('ops-dashboard__card--expanded')) {
      card.classList.remove('ops-dashboard__card--expanded');
      document.body.classList.remove('has-fullscreen-card');
      this.removeBackdrop();
      if (!this.sidebarWasCollapsed) { this.layoutState.expand(); }
      this.expandedCard = null;
      this.expandedCardIndex = null;
      this.hasExpandedCard = false;
      this.expandedCardShowFilter = false;
      this.rebuildAllChartOptions();
    } else {
      this.expandedCard?.classList.remove('ops-dashboard__card--expanded');
      this.removeBackdrop();
      card.classList.add('ops-dashboard__card--expanded');
      document.body.classList.add('has-fullscreen-card');
      this.showBackdrop();
      this.sidebarWasCollapsed = this.layoutState.isCollapsed;
      this.layoutState.collapse();
      this.expandedCard = card;
      this.expandedCardIndex = index ?? null;
      this.hasExpandedCard = true;
      this.expandedCardShowFilter = true;
      // A card can be expanded before it has scrolled into view — make sure its data loads.
      if (index !== undefined) this.lazyLoadChart(index);
      // Double RAF: first frame applies CSS flex layout, second lets Highcharts measure
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.chartInstances.forEach(c => {
            try {
              const el = (c as any).container?.closest('highcharts-chart') as HTMLElement | null;
              const w = el ? el.clientWidth : 0;
              const h = el ? el.clientHeight : 0;
              if (h > 0) {
                c?.setSize(w || undefined, h, false);
              } else {
                c?.reflow();
              }
            } catch { /* ignore */ }
          });
        });
      });
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.expandedCard) {
      this.expandedCard.classList.remove('ops-dashboard__card--expanded');
      document.body.classList.remove('has-fullscreen-card');
      this.removeBackdrop();
      if (!this.sidebarWasCollapsed) { this.layoutState.expand(); }
      this.expandedCard = null;
      this.expandedCardIndex = null;
      this.hasExpandedCard = false;
      this.rebuildAllChartOptions();
    }
  }

  /** Rebuild chart options for all cards to force Highcharts to re-render at original size. */
  private rebuildAllChartOptions(): void {
    // Destroy charts by toggling dataReady off
    this.chartCards.forEach((card, idx) => {
      this.chartCards[idx] = { ...card, dataReady: false };
    });
    this.cdr.detectChanges();

    // After DOM reflows (class removed + charts destroyed), recreate with fresh options
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.chartCards.forEach((card, idx) => {
        this.chartCards[idx] = { ...card, dataReady: true, options: this.fillCardChartHeight(applyChartZoom(applyDataLabelPreference(applyChartSort(this.buildChartOptions(card.chartType, card.cats, card.vals, card.title, card.design, card.multiSeries), card.design.sortOrder), card.design.showDataLabels))) };
      });
      this.cdr.detectChanges();
    });
  }

  get activeFilterChips(): { key: string; label: string }[] {
    const chips: { key: string; label: string }[] = [];
    if (this.filterCountry) chips.push({ key: 'country', label: `Country: ${this.filterCountry}` });
    if (this.filterSector) chips.push({ key: 'sector', label: `Sector: ${this.filterSector}` });
    if (this.filterBusinessUnit) chips.push({ key: 'businessUnit', label: `Business Unit: ${this.filterBusinessUnit}` });
    if (this.filterDivision) chips.push({ key: 'division', label: `Division: ${this.filterDivision}` });
    if (this.filterCluster) chips.push({ key: 'cluster', label: `Cluster: ${this.filterCluster}` });
    if (this.filterPlant) chips.push({ key: 'plant', label: `Plant: ${this.filterPlant}` });
    return chips;
  }

  removeFilterChip(key: string): void {
    switch (key) {
      case 'country': this.filterCountry = ''; break;
      case 'sector': this.filterSector = ''; break;
      case 'businessUnit': this.filterBusinessUnit = ''; break;
      case 'division': this.filterDivision = ''; break;
      case 'cluster': this.filterCluster = ''; break;
      case 'plant': this.filterPlant = ''; break;
    }
  }

  previewImage(): string {
    return GRAPH_IMAGE_BY_ACCENT[this.board.accent];
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────────

  private loadKpiTiles(tiles: { widget: WidgetLibraryItem; design: TileDesign; sortOrder: number }[]): void {
    this.kpiLoaders.length = 0;
    this.loadedKpiIdx.clear();
    if (!tiles.length) { this.kpis = []; return; }
    this.kpiTileDefs = tiles;

    const kpiAccents: KpiAccent[] = ['blue', 'green', 'red', 'purple', 'orange'];
    const kpiIconMap: Record<string, KpiIcon> = {
      'location': 'pin', 'check-circle': 'check', 'alert-triangle': 'alert', 'trending-up': 'image', 'users': 'crew',
    };
    const kpiColorMap: Record<string, KpiAccent> = {
      blue: 'blue', green: 'green', red: 'red', amber: 'amber', teal: 'teal', gray: 'gray',
      '#4ADE80': 'green', '#EF4444': 'red', '#F59E0B': 'amber', '#14B8A6': 'teal', '#9CA3AF': 'gray',
      '#2563EB': 'blue', '#12B76A': 'green', '#D92D20': 'red', '#7C3AED': 'purple', '#F58220': 'orange',
    };

    this.kpis = tiles.map((t, i) => ({
      widgetId: t.widget.id,
      drillDownViewId: t.design.drillDownViewId ?? null,
      showIcon: t.design.showTileIcon !== false,
      tileLayout: resolveTileLayout(t.design.tileLayout),
      valueBold: t.design.valueBold === true,
      valueItalic: t.design.valueItalic === true,
      valueColor: t.design.valueColor || '',
      sortOrder: t.sortOrder,
      icon: kpiIconMap[t.design.tileIcon ?? ''] ?? (t.design.tileIcon as KpiIcon) ?? 'well',
      accent: (t.design.tileColor && kpiColorMap[t.design.tileColor]) || kpiAccents[i % kpiAccents.length],
      label: t.design.title || t.widget.name,
      value: '—',
      status: 'default' as KpiStatus,
      footerParts: t.design.breakdownRows?.length
        ? t.design.breakdownRows.map((r, ri) => ({ label: r.label, value: r.value, highlight: ri === 0, color: r.color }))
        : undefined,
      footerText: t.design.badgeText || undefined,
      footerColor: t.design.badgeColor,
    }));

    // Breakdown values are the live "1st value" of each row's column — recompute them from the source.
    tiles.forEach((t, i) => { const fp = this.kpis[i]?.footerParts; if (fp) this.hydrateBreakdown(fp, t.design.breakdownRows ?? []); });

    // Defer each tile's data fetch until its card scrolls into view (see lazyLoadKpi).
    tiles.forEach((t, i) => {
      const source = t.design.source ?? '';
      const sourceType = t.design.sourceType ?? 'Table';
      const viewId = t.design.viewId ?? 0;
      const isView = t.design.dataSourceMode === 'view' && viewId > 0;
      if (!source && !isView) return;

      this.kpiLoaders[i] = () => {
        let valueLoaded = false;
        const finishLoad = () => {
          if (!valueLoaded) this.loadedKpiIdx.delete(i);
          this.finishPendingLoad();
        };
        const isTable = !isView && sourceType.toLowerCase() === 'table';
        // Non-DAX Table tiles apply the global Cluster/Plant as best-effort FK-joined filters; DAX
        // tiles keep their getTileAggregate path (server-side DAX) unchanged.
        if (isTable && source) {
          this.pendingLoads++;
          const tableGlobals = t.design.daxModel?.enabled ? [] : tableClusterPlantFilters(this.filterCluster, this.filterPlant);
          const value$ = tableGlobals.length
            ? this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
                filters: tableGlobals, aggregation: t.design.aggregation ?? 'count', valueField: t.design.valueField || undefined }, this.shareDataContext)
                .pipe(map(r => ({ value: Number(r.rows?.[0]?.['Value'] ?? 0) })))
            : this.getTileAggregate(source, t.design);
          value$
            .pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$), finalize(finishLoad)).subscribe({
              next: res => { valueLoaded = true; this.kpis[i] = { ...this.kpis[i], value: this.formatTileNumber(res.value ?? 0, t.design) }; this.cdr.detectChanges(); },
              error: () => { this.kpis[i] = { ...this.kpis[i], value: t.design.daxModel?.enabled ? 'DAX error' : '\u2014' }; this.cdr.detectChanges(); },
            });
          return;
        }
        this.pendingLoads++;

        const data$ = isView
          ? this.commonApi.getDatabaseViewById(viewId, this.shareDataContext).pipe(
              switchMap(view => {
                const sql = this.injectDateParams(view.generatedSql);
                return this.commonApi.previewView({ connectionId: view.connectionId, sql, viewId: view.id, maxRows: 1000, filters: this.globalPreviewFilters(view.id) }, this.shareDataContext);
              }),
              catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[], daxError: !!t.design.daxModel?.enabled })),
            )
          : this.widgetService.getTableData(source, sourceType, this.shareDataContext).pipe(
              catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[], daxError: !!t.design.daxModel?.enabled })),
            );

        data$.pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$), finalize(finishLoad)).subscribe({
          next: (res) => {
            valueLoaded = true;
            const rows = res.rows ?? [];
            this.kpis[i] = { ...this.kpis[i], value: 'daxError' in res && res.daxError ? 'DAX error' : this.computeTileValue(rows, t.design) };
            this.cdr.detectChanges();
          },
          error: () => {
            this.kpis[i] = { ...this.kpis[i], value: '—' };
            this.cdr.detectChanges();
          },
        });
      };
    });
    this.kpiLoaders.slice(0, 5).forEach((_, index) => this.lazyLoadKpi(index));
  }

  /** Decrement the in-flight dashboard-load counter; reveal content once every request has settled. */
  private finishPendingLoad(): void {
    this.pendingLoads = Math.max(0, this.pendingLoads - 1);
    if (this.pendingLoads === 0) {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private loadChartWidgets(charts: { widget: WidgetLibraryItem; design: ChartDesign; width?: number; height?: number; presetColumn?: string; presetValue?: string; sortOrder: number; hideDataTableOverride?: boolean }[]): void {
    this.chartLoaders.length = 0;
    this.loadedChartIdx.clear();
    if (!charts.length) { this.chartCards = []; return; }

    // Enrich design with widget-level source info so downstream code can rely on design alone
    for (const ch of charts) {
      ch.design = {
        ...ch.design,
        source: ch.design.source || ch.widget.source,
        sourceType: ch.design.sourceType || ch.widget.sourceType,
        viewId: ch.design.viewId || ch.widget.sourceId || undefined,
      };
      if (ch.presetColumn && isPlantFilter({ sourceColumn: ch.presetColumn }) &&
          !ch.design.interactiveFilters?.some(filter => filter.sourceColumn === ch.presetColumn)) {
        ch.design.interactiveFilters = [...(ch.design.interactiveFilters ?? []), {
          id: Math.max(0, ...(ch.design.interactiveFilters ?? []).map(filter => filter.id || 0)) + 1,
          label: 'Plant', controlType: 'Dropdown', sourceTable: ch.design.source ?? '',
          sourceColumn: ch.presetColumn, hidden: true,
        }];
      }
    }

    const defaultCardWidth = this.chartColumns === 4 ? 260 : this.chartColumns === 3 ? 340 : 500;
    const defaultCardHeight = this.chartColumns === 4 ? 415 : this.chartColumns === 3 ? 260 : 300;

    // Legacy dashboards use layout defaults; new layouts use persisted grid coordinates.
    this.chartCards = charts.map(ch => ({
      title: ch.presetColumn
        ? `${ch.widget.name}-${ch.presetValue ?? ''}`
        : appendLockedFilterTitle(ch.widget.name, ch.design as Record<string, unknown>),
      widgetId: ch.widget.id,
      sortOrder: ch.sortOrder,
      chartType: toChartView(ch.design.chartType),
      chartTypeOptions: chartSwitchOptions(toChartView(ch.design.chartType), ch.design as Record<string, unknown>),
      showMenu: false,
      options: {} as Highcharts.Options,
      cats: [] as string[],
      vals: [] as number[],
      multiSeries: [] as Highcharts.SeriesOptionsType[],
      dataReady: false,
      design: ch.design,
      hideDataTableOverride: ch.hideDataTableOverride,
      width: ch.width ?? defaultCardWidth,
      height: ch.height ?? defaultCardHeight,
      localFilters: [
        ...(ch.design.interactiveFilters ?? []).map(f => ({
          label: f.label || f.sourceColumn,
          controlType: f.controlType,
          sourceTable: f.sourceTable ?? (ch.design.source ?? ''),
          sourceColumn: f.sourceColumn,
          value: ch.presetColumn === f.sourceColumn ? (ch.presetValue ?? '') : (f.locked ? (f.lockedValue ?? '') : ''),
          values: f.locked ? [...(f.lockedValues ?? [])] : ([] as string[]),
          options: [] as string[],
          hidden: !!f.hidden,
          locked: !!f.locked || ch.presetColumn === f.sourceColumn,
        })),
        ...(ch.design.conditionalFilters ?? []).filter(f => !!f.sourceColumn).map(f => ({
          label: f.label || f.sourceColumn,
          controlType: 'MultiSelect',
          sourceTable: f.sourceTable ?? (ch.design.source ?? ''),
          sourceColumn: f.sourceColumn,
          value: '',
          values: [...(f.values ?? [])],
          options: [] as string[],
          hidden: !!f.hidden,
          locked: false,
          operator: f.operator || 'equals',
          valueText: f.valueText ?? '',
          mode: f.mode || 'Include',
        })),
      ],
      inlineTiles: [] as DashInlineTile[],
      isClone: !!ch.presetColumn,
      trendMode: ch.design.trendMode ?? 'monthly',
    }));
    this.chartCards.forEach(card => {
      card.defaultFilters = card.localFilters.map(f => ({ value: f.value, values: [...(f.values ?? [])] }));
      card.defaultChartType = card.chartType;
    });

    const chartViews = this.initializeDashboardChartDates();

    // Defer each chart's data fetch until its card scrolls into view (see lazyLoadChart).
    charts.forEach((ch, idx) => {
      const source = ch.design.source ?? '';
      const sourceType = ch.design.sourceType ?? 'Table';
      if (!source) return;

      this.chartLoaders[idx] = () => {
        if (sourceType.toLowerCase() === 'table') {
          this.chartCards[idx].reliabilityTable = source;
          this.commonApi.getTableReliability(source, this.shareDataContext).pipe(takeUntil(this.destroy$)).subscribe(reliability => {
            this.chartCards[idx] = {
              ...this.chartCards[idx],
              score: reliability.reliability,
              reliabilityBreakdown: reliability.reliability_breakdown,
            };
            this.cdr.detectChanges();
          });
        }

        // Load attached inline tiles
        const tileIds = ch.design.attachedTileIds ?? [];
        if (tileIds.length) {
        this.pendingLoads++;
        this.loadInlineTilesForCard(idx, tileIds, () => this.finishPendingLoad());
      }

      const viewId = ch.design.viewId ?? 0;
      const isView = sourceType.toLowerCase() === 'view' && viewId > 0;

      this.pendingLoads++;
      let loadMode = this.chartCards[idx].trendMode;
      if (isView) {
        this.chartCards[idx].reliabilityViewId = viewId;
        (chartViews.get(viewId) ?? this.commonApi.getDatabaseViewById(viewId, this.shareDataContext)).pipe(
          switchMap(view => {
            this.chartCards[idx].score = view.reliability;
            this.chartCards[idx].reliabilityBreakdown = view.reliability_breakdown;
            this.chartCards[idx].viewSql = view.generatedSql;
            this.chartCards[idx].viewConnectionId = view.connectionId;
            this.chartCards[idx].viewIdForPreview = view.id;
            if (this.isTrendChart(ch.design)) {
              loadMode = this.chartCards[idx].trendMode;
              return this.widgetService.getFilteredChartData({
                chartSource: source,
                chartSourceType: sourceType,
                viewId,
                preserveFutureDateRange: true,
                filters: this.globalHierarchyFilterPayload(viewId),
                mode: loadMode,
                fromDate: this.filterFrom || undefined,
                toDate: this.filterTo || undefined,
              }, this.shareDataContext);
            }
            return this.commonApi.previewView({
              connectionId: view.connectionId,
              sql: this.injectDateParams(view.generatedSql, true),
              viewId: view.id,
              maxRows: 1000,
              filters: this.globalPreviewFilters(view.id),
            }, this.shareDataContext);
          }),
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
          takeUntil(this.destroy$),
          // finalize: an error while rendering must not leave the load counted (export waits on it).
          finalize(() => this.finishPendingLoad()),
        ).subscribe(res => {
          const rows = res.rows ?? [];
          const card = this.chartCards[idx];
          this.populateFilterOptions(card, rows, source, idx);
          // The user changed the period while this first load ran; that request draws the chart instead.
          if (card.trendMode !== loadMode) return;
          const result = this.buildCardResult(rows, card);
          this.chartCards[idx] = { ...card, ...result, rawRows: rows, rowsMode: loadMode, dataReady: true };
          this.cdr.detectChanges();
          this.applyPresetIfAny(idx);
        });
      } else {
        this.widgetService.getTableData(source, sourceType, this.shareDataContext).pipe(
          catchError(() => of({ rows: [] as Record<string, unknown>[], columns: [] as string[] })),
          takeUntil(this.destroy$),
          finalize(() => this.finishPendingLoad()),
        ).subscribe(res => {
          const rows = res.rows ?? [];
          const card = this.chartCards[idx];
          this.populateFilterOptions(card, rows, source, idx);
          const result = this.buildCardResult(rows, card);
          this.chartCards[idx] = { ...card, ...result, rawRows: rows, rowsMode: card.trendMode, dataReady: true };
          this.cdr.detectChanges();
          this.applyPresetIfAny(idx);
        });
      }
      };
    });
  }

  /** Chart-data request for a trend card in the given mode, with the filters the card shows. */
  private trendDataRequest(card: OperationsDashboardComponent['chartCards'][number], mode: TrendMode) {
    return {
      chartSource: card.design.source ?? '',
      chartSourceType: card.design.sourceType ?? 'View',
      viewId: card.design.viewId ?? null,
      preserveFutureDateRange: true,
      filters: [...this.serverCardFilters(card), ...this.globalHierarchyFilterPayload(card.design.viewId).filter(filter => !card.isClone || !card.localFilters.some(isPlantFilter) || !isPlantFilter(filter))],
      mode,
      fromDate: this.filterFrom || undefined,
      toDate: this.filterTo || undefined,
    };
  }

  setCardTrendMode(idx: number, mode: TrendMode): void {
    const card = this.chartCards[idx];
    if (card.trendMode === mode) return;
    this.loadTrendMode(idx, mode);
  }

  /** Loads the card's trend rows for a mode, with its current filters. */
  private loadTrendMode(idx: number, mode: TrendMode): void {
    const card = this.chartCards[idx];
    card.trendMode = mode;
    this.widgetService.getFilteredChartData(this.trendDataRequest(card, mode), this.shareDataContext).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        // A slower response for a period the user has since changed must not overwrite the chart.
        const current = this.chartCards[idx];
        if (current.trendMode !== mode) return;
        const result = this.buildCardResult(res.rows ?? [], current);
        this.chartCards[idx] = { ...current, ...result, rawRows: res.rows ?? [], rowsMode: mode, dataReady: true };
        this.cdr.detectChanges();
      },
      error: () => {
        console.error(`Failed to change trend mode for chart: ${card.title}`);
        this.chartCards[idx] = { ...this.chartCards[idx], dataReady: true };
        this.cdr.markForCheck();
      },
    });
  }

  private readonly trendModeIcons: Record<TrendMode, string> = {
    weekly: 'assets/images/weekly.svg',
    monthly: 'assets/images/monthly.svg',
    quarterly: 'assets/images/quarterly.svg',
    yearly: 'assets/images/download.svg',
  };

  trendModeIcon(mode: TrendMode): string {
    return this.trendModeIcons[mode];
  }

  trendMenuOpen: Record<number, boolean> = {};

  toggleTrendMenu(idx: number, e: Event): void {
    e.stopPropagation();
    const wasOpen = this.trendMenuOpen[idx];
    this.trendMenuOpen = {};
    this.pickerCard = null;
    if (!wasOpen) {
      this.trendMenuOpen[idx] = true;
      this.loadAllPeriods(idx);
    }
    this.cdr.markForCheck();
  }

  selectTrendMode(idx: number, mode: TrendMode): void {
    this.trendMenuOpen = {};
    this.pickerCard = null;
    const card = this.chartCards[idx];
    if (card.customPeriods && card.trendMode === mode) {
      this.setCustomPeriods(idx, undefined);
      return;
    }
    card.customPeriods = undefined;
    this.setCardTrendMode(idx, mode);
  }

  /** Period submenu (Weekly / Monthly / ... ›): which card and mode it is open for; null draft = all ticked. */
  pickerCard: number | null = null;
  pickerMode: TrendMode | null = null;
  pickerDraft: string[] | null = null;
  readonly periodNoun: Record<string, string> = { weekly: 'weeks', monthly: 'months', quarterly: 'quarters', yearly: 'years' };
  private readonly trendModes: TrendMode[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

  /** Each card's rows per mode for the submenus; `key` is the request without its mode, so a filter change refetches. */
  private periodRows = new Map<number, Partial<Record<TrendMode, { key: string; rows?: Record<string, unknown>[]; failed?: boolean }>>>();

  /** Loads every mode's rows in the background (the chart is untouched), so all submenus can list their periods. */
  private loadAllPeriods(idx: number): void {
    const card = this.chartCards[idx];
    const byMode = this.periodRows.get(idx) ?? {};
    this.periodRows.set(idx, byMode);
    for (const mode of this.trendModes) {
      const request = this.trendDataRequest(card, mode);
      const key = JSON.stringify({ ...request, mode: undefined });
      if (byMode[mode]?.key === key && !byMode[mode]?.failed) continue;
      if (card.rowsMode === mode && card.rawRows) {
        byMode[mode] = { key, rows: card.rawRows };
        continue;
      }
      const entry: { key: string; rows?: Record<string, unknown>[]; failed?: boolean } = { key };
      byMode[mode] = entry;
      this.widgetService.getFilteredChartData(request, this.shareDataContext).pipe(takeUntil(this.destroy$)).subscribe({
        next: res => { entry.rows = res.rows ?? []; this.cdr.detectChanges(); },
        error: () => { entry.failed = true; this.cdr.detectChanges(); },
      });
    }
  }

  /** Periods of a mode, in data order; empty until that mode's rows have arrived. */
  periodOptions(idx: number, mode: string): string[] {
    const rows = this.periodRows.get(idx)?.[mode as TrendMode]?.rows;
    const x = this.chartCards[idx].design.xAxis ?? '';
    return rows ? [...new Set(rows.map(row => String(row[x] ?? '')).filter(Boolean))] : [];
  }

  periodMessage(idx: number, mode: string): string {
    const entry = this.periodRows.get(idx)?.[mode as TrendMode];
    return entry?.failed ? 'Could not load these periods. Try again.' : entry?.rows ? 'No data for this period type.' : 'Loading…';
  }

  openPeriodPicker(idx: number, mode: TrendMode): void {
    const card = this.chartCards[idx];
    this.pickerCard = idx;
    this.pickerMode = mode;
    this.pickerDraft = card.trendMode === mode && card.customPeriods ? [...card.customPeriods] : null;
    this.loadAllPeriods(idx);
  }

  isPeriodChecked(period: string): boolean {
    return this.pickerDraft === null || this.pickerDraft.includes(period);
  }

  togglePeriod(idx: number, period: string): void {
    const draft = this.pickerDraft ?? this.periodOptions(idx, this.pickerMode ?? '');
    this.pickerDraft = draft.includes(period) ? draft.filter(p => p !== period) : [...draft, period];
  }

  /** Shows the ticked periods; switches the chart to the submenu's mode using the rows already loaded. */
  applyPeriods(idx: number): void {
    const mode = this.pickerMode!;
    const all = this.periodOptions(idx, mode);
    const picked = this.pickerDraft === null ? all : all.filter(p => this.pickerDraft!.includes(p));
    const periods = picked.length === all.length ? undefined : picked;
    this.pickerCard = null;
    this.trendMenuOpen = {};
    const card = this.chartCards[idx];
    if (card.trendMode === mode && card.rowsMode === mode) {
      this.setCustomPeriods(idx, periods);
      return;
    }
    const rows = this.periodRows.get(idx)?.[mode]?.rows ?? [];
    const next = { ...card, trendMode: mode, customPeriods: periods };
    this.chartCards[idx] = { ...next, ...this.buildCardResult(rows, next), rawRows: rows, rowsMode: mode, dataReady: true };
    this.cdr.detectChanges();
  }

  /** True when the card's chart type, own filters, trend mode or picked periods differ from how the dashboard opened. */
  isCardFiltered(card: typeof this.chartCards[0]): boolean {
    return !!card.customPeriods || card.chartType !== (card.defaultChartType ?? card.chartType) || card.trendMode !== (card.design.trendMode ?? 'monthly')
      || card.localFilters.some((f, i) => f.value !== (card.defaultFilters?.[i]?.value ?? '')
        || (f.values ?? []).join('\u0001') !== (card.defaultFilters?.[i]?.values ?? []).join('\u0001'));
  }

  /** Resets only this card's chart type, filters and trend period; the page filters stay as they are. */
  resetCardFilters(idx: number): void {
    const card = this.chartCards[idx];
    card.localFilters.forEach((f, i) => {
      f.value = card.defaultFilters?.[i]?.value ?? '';
      f.values = [...(card.defaultFilters?.[i]?.values ?? [])];
    });
    card.customPeriods = undefined;
    card.chartType = card.defaultChartType ?? card.chartType;
    // Placeholder until the reload arrives, so the old rows are not shown under the reset controls.
    card.dataReady = false;
    this.trendMenuOpen = {};
    this.pickerCard = null;
    this.openCardMultiFilter = null;
    // Trend charts reload the way the period menu does, so the rows always match the reset mode.
    if (this.isTrendChart(card.design)) this.loadTrendMode(idx, card.design.trendMode ?? 'monthly');
    else this.reloadCardData(idx);
  }

  private setCustomPeriods(idx: number, periods: string[] | undefined): void {
    const card = { ...this.chartCards[idx], customPeriods: periods };
    this.chartCards[idx] = { ...card, ...this.buildCardResult(card.rawRows ?? [], card) };
    this.cdr.detectChanges();
  }

  toggleCardMetricSwitch(idx: number, event: Event): void {
    event.stopPropagation();
    const card = this.chartCards[idx];
    this.chartCards[idx] = { ...card, openMetricSwitch: !card.openMetricSwitch };
    this.cdr.detectChanges();
  }

  switchCardMetric(idx: number, col: string): void {
    const card = { ...this.chartCards[idx], activeMetric: col, openMetricSwitch: false };
    this.chartCards[idx] = { ...card, ...this.buildCardResult(card.rawRows ?? [], card) };
    this.cdr.detectChanges();
  }

  private colorForRule(
    category: string, value: number, design: ChartDesign | undefined, seriesName?: string, includeCategoryRule = true,
  ): string | undefined {
    const rules = design?.colorRules ?? [];
    const xField = design?.xAxis ?? '';
    const yField = design?.yAggColumn ?? design?.yAxis ?? '';
    for (const rule of rules) {
      const ruleField = rule.field.trim().toLowerCase();
      if (ruleField === 'category') {
        if (!includeCategoryRule) continue;
        const target = usesSeriesCategoryColorRules(design?.chartType, design?.xAxis) ? (seriesName ?? '') : category;
        if ((rule.categories ?? []).some(selected => selected.trim().toLowerCase() === target.trim().toLowerCase())) return rule.color;
        continue;
      }
      const candidates: unknown[] = [category, value];
      if (ruleField === xField.toLowerCase() || ruleField === (design?.xAxisTitle ?? '').toLowerCase()) {
        candidates.splice(1, 1);
      } else if (ruleField === yField.toLowerCase() || ruleField === (design?.yAxisTitle ?? '').toLowerCase() || ruleField === (seriesName ?? '').toLowerCase()) {
        candidates.splice(0, 1);
      }
      if (rule.operator === 'Between' && this.matchesColorRule(value, rule.operator, rule.value, rule.value2)) return rule.color;
      if (candidates.some(candidate => this.matchesColorRule(candidate, rule.operator, rule.value, rule.value2))) return rule.color;
    }
    return undefined;
  }

  private colorOverrideFor(category: string, design: ChartDesign | undefined, seriesName = ''): string | undefined {
    const overrides = design?.colorOverrides;
    if (!overrides) return undefined;
    const names = [seriesName, design?.yAggColumn, design?.yAxis, '']
      .filter((name, index, all) => name !== undefined && name !== null && all.indexOf(name) === index);
    for (const name of names) {
      const color = overrides[`${name}:${category}`];
      if (color) return color;
    }
    return undefined;
  }

  private colorAssignmentFor(category: string, design: ChartDesign | undefined, seriesName = ''): string | undefined {
    return design?.colorAssignments?.[`${seriesName}:${category}`];
  }

  private categoryColorFor(category: string, design: ChartDesign | undefined, seriesName = ''): string | undefined {
    const usesSeriesCategory = usesSeriesCategoryColorRules(design?.chartType, design?.xAxis);
    const normalizedCategory = (usesSeriesCategory ? seriesName : category).trim().toLowerCase();
    return (design?.colorRules ?? []).find(rule => rule.field.trim().toLowerCase() === 'category'
      && (rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalizedCategory))?.color;
  }

  private matchesColorRule(raw: unknown, operator: string, expected: string, expectedUpper?: string): boolean {
    const actualText = String(raw ?? '').trim();
    const expectedText = expected.trim();
    const actualNumber = Number(actualText);
    const expectedNumber = Number(expectedText);
    const expectedUpperNumber = Number(expectedUpper?.trim());
    const numeric = actualText !== '' && expectedText !== '' && Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
    switch (operator) {
      case '>=': return numeric && actualNumber >= expectedNumber;
      case '<=': return numeric && actualNumber <= expectedNumber;
      case '>': return numeric && actualNumber > expectedNumber;
      case '<': return numeric && actualNumber < expectedNumber;
      case 'Between': return numeric && Number.isFinite(expectedUpperNumber)
        && actualNumber >= Math.min(expectedNumber, expectedUpperNumber)
        && actualNumber <= Math.max(expectedNumber, expectedUpperNumber);
      case 'Not Equal': return actualText.toLowerCase() !== expectedText.toLowerCase();
      case 'Equal':
      case 'equals': return numeric ? actualNumber === expectedNumber : actualText.toLowerCase() === expectedText.toLowerCase();
      default: return false;
    }
  }

  private fallbackColor(seed: string, index: number): string {
    return chartFallbackColor(seed, index);
  }

  private pointColor(
    category: string, value: number, design: ChartDesign | undefined, index: number, seriesName = '', includeCategoryRule = true,
  ): string {
    return (includeCategoryRule ? this.categoryColorFor(category, design, seriesName) : undefined)
      ?? this.colorOverrideFor(category, design, seriesName)
      ?? this.colorForRule(category, value, design, seriesName, includeCategoryRule)
      ?? this.colorAssignmentFor(category, design, seriesName)
      ?? this.fallbackColor(`${seriesName}:${category}`, index);
  }

  private applyColorRulesToSeries(series: Highcharts.SeriesOptionsType[], cats: string[], design?: ChartDesign, preserveSeriesColor = false): Highcharts.SeriesOptionsType[] {
    return (series as any[]).map(item => {
      const lineCategoryColor = usesPeriodLineCategoryColorRules(design?.chartType, design?.xAxis, item.type)
        ? this.categoryColorFor('', design, item.name) : undefined;
      return {
        ...item,
        color: lineCategoryColor ?? item.color,
        data: Array.isArray(item.data) ? item.data.map((raw: any, index: number) => {
          const category = cats[index] ?? raw?.name ?? '';
          const value = typeof raw === 'number' ? raw : Number(raw?.y ?? raw?.value ?? 0);
          const categoryColor = lineCategoryColor ? undefined : this.categoryColorFor(category, design, item.name);
          const override = this.colorOverrideFor(category, design, item.name);
          const color = this.colorForRule(category, value, design, item.name, !lineCategoryColor);
          if (preserveSeriesColor) {
            const explicitColor = override ?? color ?? categoryColor
              ?? (lineCategoryColor ? raw?.color ?? item.color : undefined);
            return explicitColor ? { ...(typeof raw === 'object' ? raw : { y: raw }), color: explicitColor } : raw;
          }
          const point = typeof raw === 'object' ? raw : { y: raw };
          const assignment = this.colorAssignmentFor(category, design, item.name);
          if (lineCategoryColor) {
            return {
              ...point,
              color: override ?? color ?? assignment ?? raw?.color
                ?? this.fallbackColor(`${item.name ?? ''}:${cats[index] ?? ''}`, index),
            };
          }
          return { ...point, color: categoryColor ?? override ?? color ?? assignment ?? this.fallbackColor(`${item.name ?? ''}:${cats[index] ?? ''}`, index) };
        }) : item.data,
      } as Highcharts.SeriesOptionsType;
    });
  }

  /** Re-type the cached multi-series data for the chart type currently being rendered. */
  private seriesForView(
    view: ChartView, series: Highcharts.SeriesOptionsType[], design?: ChartDesign,
  ): Highcharts.SeriesOptionsType[] {
    const comboLineCols = design?.comboLineColumns ?? [];
    // The stacked "Total" overlay only belongs to the stacked view.
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

  /** Build Highcharts options for any chart type. */
  private buildChartOptions(
    chartType: ChartView, cats: string[], vals: number[], title: string,
    design?: ChartDesign, multiSeries?: Highcharts.SeriesOptionsType[],
  ): Highcharts.Options {
    if (chartType === 'funnel') return buildFunnelOptions(cats, vals, cats.map((category, index) => this.pointColor(category, vals[index] ?? 0, design, index)), 280, title, false);
    const hasMulti = multiSeries && multiSeries.length > 0;
    const series = hasMulti ? this.seriesForView(chartType, multiSeries!, design) : [];
    const legendOpts: Highcharts.LegendOptions = {
      enabled: false,
      maxHeight: 0,
    };
    const base: Highcharts.Options = {
      chart: { backgroundColor: 'transparent', height: 280 },
      title: { text: undefined },
      credits: { enabled: false },
      legend: legendOpts,
    };

    if (chartType === 'donut' || chartType === 'pie') {
      // For multiline data, aggregate each series into a single pie slice
      let pieData: { id: string; name: string; y: number; color: string }[];
      if (hasMulti) {
        pieData = (series as any[]).map((s, i) => ({
          id: s.name ?? `Series ${i + 1}`,
          name: s.name ?? `Series ${i + 1}`,
          y: ((s.data as number[]) ?? []).reduce((a: number, b: number) => a + (Number(b) || 0), 0),
          color: this.pointColor(s.name ?? `Series ${i + 1}`, ((s.data as number[]) ?? []).reduce((a: number, b: number) => a + (Number(b) || 0), 0), design, i, s.name),
        }));
      } else {
        pieData = cats.map((c, i) => ({ id: c, name: c, y: vals[i] ?? 0, color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') }));
      }
      return {
        ...base,
        chart: { ...base.chart, type: 'pie' },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
        plotOptions: {
          pie: {
            innerSize: chartType === 'donut' ? '55%' : '0%',
            borderWidth: 2,
            borderColor: '#fff',
            showInLegend: false,
            dataLabels: { enabled: true, distance: chartType === 'donut' ? '-20%' : -28, format: '{point.y}', allowOverlap: true, crop: false, overflow: 'allow',
              style: { color: '#fff', fontWeight: '700', fontSize: '12px', textOutline: 'none' } } as any,
          },
        },
        series: [{ type: 'pie', name: title, data: pieData.filter(d => d.y !== 0) }],
      };
    }

    const showAxis = design?.showAxisTitle as boolean | undefined;
    const xTitle = showAxis ? ((design?.xAxisTitle as string) || undefined) : undefined;
    const yTitle = showAxis ? ((design?.yAxisTitle as string) || undefined) : undefined;
    const y2Title = showAxis ? ((design?.yAxis2Title as string) || undefined) : undefined;
    const axes: Highcharts.Options = {
      xAxis: {
        categories: cats,
        title: { text: xTitle },
        lineColor: '#E7ECF3',
        // SVG labels: Highcharts truncates long names with an ellipsis and shows the full text on hover.
        labels: { style: { fontSize: '11px', color: '#667085', textOverflow: 'ellipsis' } },
      },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
    };

    if (chartType === 'line' || chartType === 'multiline' || chartType === 'spline') {
      const hcType = chartType === 'spline' ? 'spline' : 'line';
      const hasDualY = hasMulti && series.some((s: any) => s.yAxis === 1);
      const seriesName = design?.yAggColumn ?? design?.yAxis ?? 'Value';
      const lineCategoryColor = usesPeriodLineCategoryColorRules(chartType, design?.xAxis, hcType)
        ? this.categoryColorFor('', design, seriesName) : undefined;
      const opts: Highcharts.Options = {
        ...base,
        ...axes,
        chart: { ...base.chart, type: hcType },
        plotOptions: { [hcType]: { marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } } },
        series: hasMulti
          ? this.applyColorRulesToSeries(series, cats, design)
          : [{ type: hcType, name: title, color: lineCategoryColor, data: vals.map((value, i) => ({
              y: value, color: this.pointColor(cats[i] ?? '', value, design, i, seriesName, !lineCategoryColor),
            })), showInLegend: false }],
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
      const seriesName = design?.yAggColumn ?? design?.yAxis ?? 'Value';
      const lineCategoryColor = usesPeriodLineCategoryColorRules(chartType, design?.xAxis, 'areaspline')
        ? this.categoryColorFor('', design, seriesName) : undefined;
      return {
        ...base,
        ...axes,
        chart: { ...base.chart, type: 'areaspline' },
        plotOptions: { areaspline: { fillOpacity: 0.15, marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } } },
        series: hasMulti
          ? this.applyColorRulesToSeries(series, cats, design)
          : [{ type: 'areaspline', name: title, color: lineCategoryColor, data: vals.map((value, i) => ({
              y: value, color: this.pointColor(cats[i] ?? '', value, design, i, seriesName, !lineCategoryColor),
            })), showInLegend: false }],
      };
    }

    if (chartType === 'treemap') {
      return {
        ...base,
        chart: { ...base.chart, type: 'treemap' as any },
        series: [{
          type: 'treemap' as any, name: title, layoutAlgorithm: 'squarified', dataLabels: { enabled: true },
          data: cats.map((c, i) => ({ name: c, value: vals[i] ?? 0, color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') })),
        }],
      };
    }

    if (chartType === 'waterfall' || chartType === 'scatter') {
      return {
        ...base,
        ...axes,
        chart: { ...base.chart, type: chartType as any },
        series: [{ type: chartType as any, name: title, data: vals, showInLegend: false }],
      };
    }

    // Default: Bar (column)
    const isStacked = chartType === 'stacked';
    const isCombo = chartType === 'combo';

    if (isCombo && hasMulti) {
      return {
        ...base,
        ...axes,
        chart: { ...base.chart, type: 'column' },
        yAxis: [
          { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
          { title: { text: y2Title }, opposite: true, gridLineWidth: 0 },
        ],
        tooltip: { shared: true },
        plotOptions: {
          column: { stacking: 'normal' as any, borderRadius: 0, borderWidth: 0, dataLabels: { enabled: false } },
          line: { marker: { enabled: true, radius: 3 } },
        },
        series: this.applyColorRulesToSeries(series, cats, design, true),
      };
    }

    const isGrouped = chartType === 'grouped';

    if (isGrouped && hasMulti) {
      const hasDualY = series.some((s: any) => s.yAxis === 1);
      return {
        ...base,
        ...axes,
        chart: { ...base.chart, type: 'column' },
        ...(hasDualY ? {
          yAxis: [
            { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
            { title: { text: y2Title }, opposite: true, gridLineWidth: 0 },
          ],
          tooltip: { shared: true },
        } : {}),
        plotOptions: {
          column: { grouping: true, borderRadius: 4, borderWidth: 0,
            dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        },
        series: this.applyColorRulesToSeries(series, cats, design, true),
      };
    }

    // 'column' renders horizontally, matching the Chart Details page.
    const hcBarType = chartType === 'column' ? 'bar' : 'column';
    const barSeries: Highcharts.SeriesOptionsType[] = hasMulti
      ? this.applyColorRulesToSeries(series, cats, design, isStacked)
      : [{ type: hcBarType, name: title, colorByPoint: true, showInLegend: false,
          data: cats.map((c, i) => ({ name: c, y: vals[i] ?? 0, color: this.pointColor(c, vals[i] ?? 0, design, i, design?.yAxis ?? 'Value') })) }];
    return {
      ...base,
      ...axes,
      chart: { ...base.chart, type: hcBarType },
      plotOptions: {
        [hcBarType]: { borderRadius: isStacked ? 0 : 4, borderWidth: 0,
          stacking: isStacked ? 'normal' as any : undefined,
          dataLabels: { enabled: isStacked, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600', color: '#fff' } } },
      },
      series: barSeries,
    };
  }

  /** Build chart card data (cats, vals, multiSeries, options) from rows. */
  private buildCardResult(rows: Record<string, unknown>[], card: OperationsDashboardComponent['chartCards'][number]) {
    const periods = card.customPeriods;
    if (periods) rows = rows.filter(row => periods.includes(String(row[card.design.xAxis ?? ''] ?? '')));
    const paramFilters = getSavedParameterFilters(card.design as unknown as Record<string, unknown>);
    const design = remapDesignColumns(card.design as unknown as Record<string, any>, paramFilters) as unknown as ChartDesign;
    const { rows: transformedRows } = applyParameterFilters(rows, paramFilters);
    rows = applyConditionalFilters(transformedRows, getSavedConditionalFilters(design as unknown as Record<string, unknown>));
    // Bar/column "Switch Metrics": aggregate the viewer-selected column instead of the saved one.
    const metricCols = (card.chartType === 'bar' || card.chartType === 'column')
      ? (((card.design as unknown as Record<string, unknown>)['metricColumns'] as string[] | undefined) ?? []) : [];
    card.metricSwitchColumns = metricCols.length > 1 ? metricCols : [];
    if (card.metricSwitchColumns.length && (!card.activeMetric || !card.metricSwitchColumns.includes(card.activeMetric)))
      card.activeMetric = card.metricSwitchColumns[0];
    const effectiveDesign = card.metricSwitchColumns.length ? { ...design, yAggColumn: card.activeMetric } : design;
    const result = { daxSummaries: [], ...this.buildCardData(rows, effectiveDesign, card.title, card.chartType) };
    if (card.design.drillDownViewId && card.widgetId) {
      result.options = this.injectDrillDownClick(result.options, card.widgetId, this.isTrendChart(card.design) ? card.trendMode : undefined, card);
    }
    result.options = this.fillCardChartHeight(applyChartZoom(applyDataLabelPreference(applyChartSort(result.options, card.design.sortOrder), card.design.showDataLabels)));
    return { ...result, additionalFilterNoData: rows.length === 0 &&
      this.effectiveCardFilters(card).some(filter => filter.dashboardAdditional) };
  }

  private buildCardData(
    rows: Record<string, unknown>[], design: ChartDesign, title: string, chartType: ChartView,
  ): { cats: string[]; vals: number[]; multiSeries: Highcharts.SeriesOptionsType[]; options: Highcharts.Options; tableHeaders?: string[]; tableRows?: (string | number)[][]; advanced?: AdvancedChartPayload; daxSummaries?: { name: string; value: number; formattedValue: string }[] } {
    const multiY = design.multiYColumns ?? [];
    const daxMeasures = getActiveDaxMeasures(design as unknown as Record<string, unknown>);

    if (isAdvancedChart(chartType)) {
      return { cats: [], vals: [], multiSeries: [], options: {}, advanced: { type: chartType, rows, config: readAdvancedConfig((design as unknown as Record<string, unknown>)['advancedConfig']), daxMeasures } };
    }

    const withDaxSummaries = (result: ReturnType<OperationsDashboardComponent['cardResult']>) => {
      const names: string[] = [];
      const values: number[] = [];
      appendDaxToChartData(daxMeasures, rows, undefined, names, values);
      return { ...result, daxSummaries: names.map((name, index) => ({
        name, value: values[index], formattedValue: formatDaxValue(values[index], daxMeasures[index]),
      })) };
    };

    // Chart types with their own field set instead of the plain xAxis/yAxis category+value shape.
    if (chartType === 'kpi') return withDaxSummaries(this.cardResult(buildKpiChartOptions(computeKpiValue(rows, design), 280)));
    if (chartType === 'gauge') return withDaxSummaries(this.buildGaugeCardData(rows, design));
    if (chartType === 'histogram') return withDaxSummaries(this.buildHistogramCardData(rows, design));
    if (chartType === 'sankey') return withDaxSummaries(this.buildSankeyCardData(rows, design));
    if (chartType === 'timeline') return withDaxSummaries(this.buildTimelineCardData(rows, design));
    if (chartType === 'bullet') return withDaxSummaries(this.buildBulletCardData(rows, design));
    if (chartType === 'bubble') return withDaxSummaries(this.buildBubbleCardData(rows, design));
    if (chartType === 'scatter') {
      const resolve = (column?: string): string => rows.length && column ? this.resolveColumn(rows[0], column) : column ?? '';
      return withDaxSummaries(this.cardResult(buildScatterOptions({
        rows, xColumn: resolve(design.xAxis), yColumn: resolve(design.yAggColumn || design.yAxis),
        categoryColumn: resolve(design.scatterCategoryColumn) || undefined, height: 280,
      })));
    }
    if (chartType === 'heatmap') return withDaxSummaries(this.buildHeatmapCardData(rows, design));

    if (multiY.length > 0) {
      const { categories, series } = this.buildMultiSeries(rows, design);
      appendDaxToChartData(daxMeasures, rows, undefined, categories, [], series as { data?: unknown }[],
        design.chartType === 'stacked' && design.showStackTotal !== false ? series.length - 1 : -1);
      const xAxis = design.xAxis ?? '';
      const tableColumns = multiY.filter(column => column !== xAxis);
      const displayRows = rows.slice(0, 100);
      const tableRows = design.chartType === 'table'
        ? displayRows.map(row => [
            this.formatTableCell(row[xAxis]),
            ...tableColumns.map(column => this.formatTableCell(row[column])),
          ])
        : undefined;
      // DAX measures as the builder shows them: summary rows (Column) and extra columns (Row).
      if (tableRows) appendDaxToTableRows(daxMeasures, rows, undefined, tableRows, tableColumns.length, displayRows.map(row => [row]), tableColumns);
      const rowMeasureHeaders = getDaxRowColumnMeasures(daxMeasures).map(m => m.name?.trim() || 'New Metric');
      return {
        cats: categories,
        vals: [],
        multiSeries: series,
        options: this.buildChartOptions(chartType, categories, [], title, design, series),
        tableHeaders: tableRows ? [design.xAxisTitle || xAxis || 'Parameter', ...tableColumns, ...rowMeasureHeaders] : undefined,
        tableRows,
      };
    }
    const { cats, vals } = this.aggregateChart(rows, design);
    appendDaxToChartData(daxMeasures, rows, undefined, cats, vals);
    return { cats, vals, multiSeries: [], options: this.buildChartOptions(chartType, cats, vals, title, design) };
  }

  private cardResult(options: Highcharts.Options): { cats: string[]; vals: number[]; multiSeries: Highcharts.SeriesOptionsType[]; options: Highcharts.Options } {
    return { cats: [], vals: [], multiSeries: [], options };
  }

  private groupRowsByCategory(rows: Record<string, unknown>[], xAxis: string): Map<string, Record<string, unknown>[]> {
    const resolvedX = rows.length && xAxis ? this.resolveColumn(rows[0], xAxis) : xAxis;
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const raw = row[resolvedX];
      const key = (raw !== null && raw !== undefined && typeof raw !== 'object') ? `${raw as string | number | boolean}` : '(empty)';
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  private toStr(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  /** Single aggregated number, no axes — solid-gauge needs a min/max range. */
  private buildGaugeCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const col = design.yAggColumn || design.yAxis || '';
    const resolvedCol = rows.length && col ? this.resolveColumn(rows[0], col) : col;
    const nums = rows.map(r => Number(r[resolvedCol])).filter(v => !Number.isNaN(v));
    let value: number;
    if (design.yAxis === 'Average (F)') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (design.yAxis === 'Min (F)') value = nums.length ? Math.min(...nums) : 0;
    else if (design.yAxis === 'Max (F)') value = nums.length ? Math.max(...nums) : 0;
    else if (design.yAxis === 'Count (F)' || design.yAxis === 'Count Distinct (F)') value = rows.length;
    else value = nums.reduce((a, b) => a + b, 0);
    const min = design.gaugeMin ?? 0;
    const max = design.gaugeMax ?? 100;
    return this.cardResult({
      chart: { type: 'solidgauge' as any, backgroundColor: 'transparent', height: 280 },
      title: { text: undefined }, credits: { enabled: false },
      pane: { startAngle: -90, endAngle: 90, background: [{ backgroundColor: '#EEE', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }] } as any,
      yAxis: { min, max, stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']], lineWidth: 0, tickWidth: 0, minorTickInterval: null as any, labels: { enabled: false } } as any,
      plotOptions: { solidgauge: { dataLabels: { y: -30, borderWidth: 0, format: '<div style="text-align:center"><span style="font-size:22px;font-weight:600">{y}</span></div>' } } } as any,
      series: [{ type: 'solidgauge' as any, name: col || 'Value', data: [value] }],
    });
  }

  private buildHistogramCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const col = design.yAggColumn || design.yAxis || '';
    const resolvedCol = rows.length && col ? this.resolveColumn(rows[0], col) : col;
    return this.cardResult(buildHistogramOptions(rows, resolvedCol, design.histogramBins, 280, CHART_AUTO_COLORS));
  }

  /** Reuses X-axis category + Y-axis value, adds an optional Target column per category. */
  private buildBulletCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const xAxis = design.xAxis ?? '';
    const measureCol = design.yAggColumn || design.yAxis || '';
    const targetCol = design.bulletTargetColumn ?? '';
    const resolvedMeasure = rows.length && measureCol ? this.resolveColumn(rows[0], measureCol) : measureCol;
    const resolvedTarget = rows.length && targetCol ? this.resolveColumn(rows[0], targetCol) : targetCol;
    const grouped = this.groupRowsByCategory(rows, xAxis);
    const categories: string[] = [];
    const data: Array<{ y: number; target?: number }> = [];
    for (const [k, groupRows] of grouped) {
      categories.push(k);
      const y = groupRows.reduce((sum, r) => sum + (Number(r[resolvedMeasure]) || 0), 0);
      const target = targetCol ? groupRows.reduce((sum, r) => sum + (Number(r[resolvedTarget]) || 0), 0) : undefined;
      data.push(target !== undefined ? { y, target } : { y });
    }
    return this.cardResult({
      chart: { type: 'bullet' as any, inverted: true, backgroundColor: 'transparent', height: 280 },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories, title: { text: undefined } },
      yAxis: { title: { text: undefined }, gridLineWidth: 0 },
      plotOptions: { series: { pointPadding: 0.25, borderWidth: 0, color: chartFallbackColor(`${measureCol || 'Value'}:`, 0), targetOptions: { width: '200%' } } } as any,
      series: [{ type: 'bullet' as any, name: measureCol || 'Value', data }],
    });
  }

  /** Reuses X-axis category + Y-axis value (aggregated), adds a required Size column (aggregated) per category. */
  private buildBubbleCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const xAxis = design.xAxis ?? '';
    const measureCol = design.yAggColumn || design.yAxis || '';
    const sizeCol = design.bubbleSizeColumn ?? '';
    const resolvedMeasure = rows.length && measureCol ? this.resolveColumn(rows[0], measureCol) : measureCol;
    const resolvedSize = rows.length && sizeCol ? this.resolveColumn(rows[0], sizeCol) : sizeCol;
    const grouped = this.groupRowsByCategory(rows, xAxis);
    const data: Array<{ x: number; y: number; z: number; name: string; color: string }> = [];
    let i = 0;
    for (const [k, groupRows] of grouped) {
      const y = groupRows.reduce((sum, r) => sum + (Number(r[resolvedMeasure]) || 0), 0);
      const z = sizeCol ? groupRows.reduce((sum, r) => sum + (Number(r[resolvedSize]) || 0), 0) : 1;
      data.push({ x: i, y, z, name: k, color: chartFallbackColor(`${measureCol || 'Value'}:${k}`, i) });
      i++;
    }
    return this.cardResult({
      chart: { type: 'bubble', zoomType: 'xy', backgroundColor: 'transparent', height: 280 },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: [...grouped.keys()], title: { text: undefined } },
      yAxis: { title: { text: undefined } },
      plotOptions: { bubble: { minSize: 6, maxSize: 40 } },
      series: [{ type: 'bubble' as const, name: measureCol || 'Value', data }],
    });
  }

  /** X dimension x Y dimension grid, coloured by the aggregated Intensity / Value. */
  private buildHeatmapCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const resolve = (column?: string): string => rows.length && column ? this.resolveColumn(rows[0], column) : column ?? '';
    const measure = resolveHeatmapMeasure(design.yAggColumn, design.yAxis);
    return this.cardResult(buildHeatmapOptions({
      rows, xColumn: resolve(design.xAxis), yColumn: resolve(design.heatmapYColumn), valueColumn: resolve(measure.valueColumn), operation: measure.operation,
      xTitle: design.xAxisTitle || undefined, yTitle: design.yAxisTitle || undefined, height: 280, showLegend: design.showLegend !== false,
    }));
  }

  /** From/To/Weight relationship — no xAxis/yAxis at all. */
  private buildSankeyCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const from = design.sankeyFromColumn ?? '';
    const to = design.sankeyToColumn ?? '';
    const weightCol = design.sankeyWeightColumn ?? '';
    const resolvedFrom = rows.length && from ? this.resolveColumn(rows[0], from) : from;
    const resolvedTo = rows.length && to ? this.resolveColumn(rows[0], to) : to;
    const resolvedWeight = rows.length && weightCol ? this.resolveColumn(rows[0], weightCol) : weightCol;
    const weightMap = new Map<string, number>();
    for (const row of rows) {
      const f = this.toStr(row[resolvedFrom]), t = this.toStr(row[resolvedTo]);
      if (!f || !t) continue;
      const key = `${f}\u2192${t}`;
      weightMap.set(key, (weightMap.get(key) ?? 0) + (Number(row[resolvedWeight]) || 0));
    }
    const data = [...weightMap.entries()].map(([key, weight]) => {
      const [f, t] = key.split('\u2192');
      return [f, t, weight] as [string, string, number];
    });
    return this.cardResult({
      chart: { type: 'sankey', backgroundColor: 'transparent', height: 280 },
      title: { text: undefined }, credits: { enabled: false },
      series: [{ type: 'sankey' as const, name: weightCol || 'Flow', keys: ['from', 'to', 'weight'], data } as any],
    });
  }

  private buildTimelineCardData(rows: Record<string, unknown>[], design: ChartDesign) {
    const resolve = (col: string | undefined): string => (rows.length && col ? this.resolveColumn(rows[0], col) : col ?? '');
    return this.cardResult(buildTimelineOptions(rows, {
      start: resolve(design.timelineDateColumn), end: resolve(design.timelineEndColumn), task: resolve(design.timelineLabelColumn),
    }, 280));
  }

  private formatTableCell(value: unknown): string | number {
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'number' ? value : String(value);
  }

  /** Build multi-series data for multiline/area/stacked charts. */
  private round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

  private buildMultiSeries(rows: Record<string, unknown>[], design: ChartDesign): { categories: string[]; series: Highcharts.SeriesOptionsType[] } {
    const xAxis = design.xAxis ?? '';
    const resolvedX = rows.length && xAxis ? this.resolveColumn(rows[0], xAxis) : xAxis;

    // Group rows by x-axis category
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const v = row[resolvedX];
      const key = (v != null && typeof v !== 'object') ? `${v as string | number | boolean}` : '(empty)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    const categories = [...grouped.keys()];

    const isFn = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'].includes(design.yAxis ?? '');
    const allCols: string[] = [];
    if (!isFn && design.yAxis && !(design.multiYColumns ?? []).includes(design.yAxis)) {
      allCols.push(design.yAxis);
    }
    allCols.push(...(design.multiYColumns ?? []));
    const comboLineCols = design.comboLineColumns ?? [];
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
      const resolved = rows.length ? this.resolveColumn(rows[0], col) : col;
      const isLineSeries = isCombo && comboLineCols.includes(col);
      const isRightAxis = hasDualY && comboLineCols.includes(col);
      const s: any = {
        type: isLineSeries ? 'line' : hcType,
        name: col,
        showInLegend: false,
        data: limitedCategories.map(cat => {
          const catRows = grouped.get(cat) ?? [];
          const nums = catRows.map(r => Number(r[resolved] ?? 0)).filter(n => !Number.isNaN(n));
          return this.round2(nums.length ? nums.reduce((a, b) => a + b, 0) : 0);
        }),
        color: getSeriesColorByName(col, i),
        stacking: (isStacked || (isCombo && !isLineSeries)) ? 'normal' as any : undefined,
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } as any,
      };
      if (hasDualY) { s.yAxis = isRightAxis ? 1 : 0; }
      return s as Highcharts.SeriesOptionsType;
    });

    if (isStacked && design.showStackTotal !== false) {
      const totals = limitedCategories.map((cat, ci) =>
        this.round2(series.reduce((sum, s) => sum + (((s as any).data as number[])[ci] ?? 0), 0))
      );
      series.push({
        type: 'line' as any,
        name: 'Total',
        showInLegend: false,
        data: totals,
        color: '#374151',
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600' } } as any,
      });
    }

    return { categories: limitedCategories, series };
  }

  /** Applies the saved Top N / Bottom N / "Group as Others" limit to a multi-series category list. */
  private limitMultiSeriesCategories(categories: string[], grouped: Map<string, Record<string, unknown>[]>, allCols: string[], rows: Record<string, unknown>[], design: ChartDesign): string[] {
    const limitCat = design.limitCategory ?? 'all';
    const wantTop = limitCat === 'top' && (design.topN ?? 0) > 0;
    const wantBottom = limitCat === 'bottom' && (design.bottomN ?? 0) > 0;
    if (!wantTop && !wantBottom) return categories;
    const n = wantTop ? design.topN! : design.bottomN!;
    if (categories.length <= n) return categories;
    const resolved = allCols.map(c => rows.length ? this.resolveColumn(rows[0], c) : c);
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

  private computeTileValue(rows: Record<string, unknown>[], design: TileDesign): string {
    try {
      const daxValue = evaluateTileDaxValue(rows, design.daxModel);
      if (daxValue !== undefined) return this.formatTileNumber(daxValue, design);
    } catch { return 'DAX error'; }
    const aggregation = design.aggregation ?? 'count';
    const valueField = design.valueField ?? '';
    let result: number;
    if (aggregation === 'count' && valueField) {
      const resolved = rows.length ? this.resolveColumn(rows[0], valueField) : valueField;
      result = rows.filter(r => { const v = r[resolved]; return v !== null && v !== undefined && v !== ''; }).length;
    } else if (aggregation === 'count' || !valueField) {
      result = rows.length;
    } else {
      const resolved = rows.length ? this.resolveColumn(rows[0], valueField) : valueField;
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

  /** Format a raw aggregate number with the tile's prefix/suffix/decimals/shorten settings. */
  private formatTileNumber(result: number, design: TileDesign): string {
    if (design.daxModel?.enabled) return `${design.prefix ?? ''}${formatDaxValue(result, getSelectedDaxMeasure(design.daxModel))}${design.suffix ?? ''}`;
    const places = Number(design.decimalPlaces) || 0;
    const shorten = design.shortenBigNumbers ?? false;
    let formatted = result.toFixed(places);
    if (shorten && result >= 1_000_000) formatted = (result / 1_000_000).toFixed(1) + 'M';
    else if (shorten && result >= 1000) formatted = (result / 1000).toFixed(1) + 'K';
    return `${design.prefix ?? ''}${formatted}${design.suffix ?? ''}`;
  }

  private getTileAggregate(source: string, design: TileDesign) {
    if (design.daxModel?.enabled) {
      return this.widgetService.getFilteredChartData({
        chartSource: source, chartSourceType: 'Table', viewId: null,
        filters: this.globalHierarchyFilterPayload(null),
        fromDate: this.filterFrom || undefined, toDate: this.filterTo || undefined,
        aggregation: design.aggregation ?? 'count', daxModel: design.daxModel,
      }, this.shareDataContext).pipe(map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })));
    }
    return this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation: design.aggregation ?? 'count', valueField: design.valueField || undefined }, this.shareDataContext);
  }

  /** Recompute each breakdown row's value live, mirroring the tile's main value: a chart card's
   *  active local/clone filters (passed in) flow to the breakdown; global hierarchy applies to View
   *  sources only. Standalone KPI tiles pass no local filters (independent tiles have none). */
  private hydrateBreakdown(target: { value: string }[], defs: ({ sourceName?: string; sourceType?: string; column?: string } | undefined)[],
    localFilters: { sourceTable: string; sourceColumn: string; controlType: string; value: string; label: string }[] = [], chartSource = ''): void {
    defs.forEach((d, i) => {
      if (!d?.sourceName || !d?.column) return;
      const isView = (d.sourceType ?? 'Table').toLowerCase() === 'view';
      const locals = localFilters.map(f => ({
        sourceTable: !f.sourceTable || f.sourceTable.toLowerCase() === chartSource.toLowerCase() ? d.sourceName! : f.sourceTable,
        sourceColumn: f.sourceColumn, controlType: f.controlType, value: f.value, label: f.label,
      }));
      // Global hierarchy applies to View sources (via the SQL params); Table sources get the global
      // Cluster/Plant as best-effort FK-joined filters.
      const globals = isView ? this.globalHierarchyFilterPayload(1).filter(g => g.advancedHierarchy || !locals.some(l =>
        l.sourceColumn.toLowerCase() === g.sourceColumn.toLowerCase() || l.label.toLowerCase() === g.label.toLowerCase()))
        : tableClusterPlantFilters(this.filterCluster, this.filterPlant);
      this.commonApi.getBreakdownValueFiltered({
        sourceName: d.sourceName, sourceType: d.sourceType ?? 'Table', column: d.column,
        filters: [...locals, ...globals],
        fromDate: this.filterFrom || undefined, toDate: this.filterTo || undefined,
        shareContext: this.shareDataContext,
      }).pipe(takeUntil(this.destroy$))
        .subscribe(v => { if (target[i]) { target[i].value = String(Math.round(v * 100) / 100); this.cdr.detectChanges(); } });
    });
  }

  /** Resolve a column name case-insensitively from the row's actual keys. */
  private resolveColumn(row: Record<string, unknown>, name: string): string {
    if (name in row) return name;
    const lower = name.toLowerCase();
    return Object.keys(row).find(k => k.toLowerCase() === lower) ?? name;
  }

  private aggregateChart(rows: Record<string, unknown>[], design: ChartDesign): { cats: string[]; vals: number[] } {
    const xAxis = design.xAxis ?? '';
    const yAxis = design.yAxis ?? 'Count (F)';
    const aggCol = design.yAggColumn ?? '';
    const isFn = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'].includes(yAxis);
    const grouped = new Map<string, { count: number; colCount: number; set: Set<string>; nums: number[] }>();

    // Resolve actual column keys from the first row (case-insensitive)
    const resolvedX = rows.length && xAxis ? this.resolveColumn(rows[0], xAxis) : xAxis;
    const col = aggCol || (isFn ? '' : yAxis);
    const resolvedCol = rows.length && col ? this.resolveColumn(rows[0], col) : col;

    for (const row of rows) {
      const raw = row[resolvedX];
      const key = (raw !== null && raw !== undefined && typeof raw !== 'object')
        ? `${raw as string | number | boolean}` : '(empty)';
      if (!grouped.has(key)) grouped.set(key, { count: 0, colCount: 0, set: new Set(), nums: [] });
      const g = grouped.get(key)!;
      g.count++;
      if (resolvedCol) {
        const rawV = row[resolvedCol];
        if (rawV !== null && rawV !== undefined && rawV !== '') { g.colCount++; g.set.add(String(rawV)); }
        const v = Number(rawV ?? 0);
        g.nums.push(Number.isNaN(v) ? 0 : v);
      }
    }

    const hasCol = !!resolvedCol;
    const cats: string[] = [];
    const vals: number[] = [];
    for (const [k, g] of grouped) {
      cats.push(k);
      if (yAxis === 'Count (F)') vals.push(hasCol ? g.colCount : g.count);
      else if (yAxis === 'Count Distinct (F)') vals.push(hasCol ? g.set.size : g.count);
      else if (yAxis === 'Sum (F)') vals.push(this.round2(g.nums.reduce((a, b) => a + b, 0)));
      else if (yAxis === 'Average (F)') vals.push(this.round2(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0));
      else if (yAxis === 'Min (F)') vals.push(this.round2(g.nums.length ? Math.min(...g.nums) : 0));
      else if (yAxis === 'Max (F)') vals.push(this.round2(g.nums.length ? Math.max(...g.nums) : 0));
      else vals.push(this.round2(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) : g.count));
    }

    const limitN = design.topN ?? 0;
    if (limitN > 0 && cats.length > limitN) {
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => b.v - a.v).slice(0, limitN);
      return { cats: pairs.map(p => p.c), vals: pairs.map(p => p.v) };
    }
    return { cats, vals };
  }

  private showError(message: string): void { this.notify.showError(message); }

  /** Plant/site source columns must respect the viewer's Plant Access. The display label is not
   * authoritative because users can change a filter's column without renaming its label. */
  isPlantLocalFilter(lf: { label: string; sourceColumn: string }): boolean {
    const column = lf.sourceColumn.replace(/[\s_-]/g, '').toLowerCase();
    return column.includes('plant') || column === 'site' || column.startsWith('sitecode');
  }

  private restrictLocalFilterOptions(lf: { label: string; sourceColumn: string }, values: string[]): string[] {
    if (!this.isPlantLocalFilter(lf) || !this.allPlants.length) return values;
    const assigned = new Set(this.allPlants.flatMap(p => [p.plantDescription, String(p.plantCode)]));
    return values.filter(v => assigned.has(v));
  }

  hasVisibleLocalFilters(card: { localFilters?: { hidden?: boolean }[] } | null | undefined): boolean {
    return !!card?.localFilters?.some(filter => !filter.hidden);
  }

  private populateFilterOptions(card: typeof this.chartCards[0], rows: Record<string, unknown>[], chartSource: string, idx: number): void {
    for (const lf of card.localFilters) {
      if (lf.controlType !== 'Dropdown' && lf.controlType !== 'MultiSelect') continue;
      // Locked filters only ever offer their frozen selection — viewers can still open/re-pick
      // it, but can't widen the choice beyond what was locked in.
      if (lf.locked) {
        lf.options = lf.controlType === 'MultiSelect' ? [...(lf.values ?? [])] : (lf.value ? [lf.value] : []);
        continue;
      }
      if (!lf.sourceTable || lf.sourceTable === chartSource) {
        const resolved = rows.length ? this.resolveColumn(rows[0], lf.sourceColumn) : lf.sourceColumn;
        const unique = [...new Set(rows.map(r => String(r[resolved] ?? '')).filter(v => v))];
        lf.options = this.restrictLocalFilterOptions(lf, unique).sort();
        this.autoSelectLocalFilterIfSingle(lf, idx);
      } else {
        this.widgetService.getTableData(lf.sourceTable, 'Table', this.shareDataContext).pipe(
          catchError(() => this.widgetService.getTableData(lf.sourceTable, 'View', this.shareDataContext)),
          catchError(() => of({ rows: [] as Record<string, unknown>[], columns: [] as string[] })),
          takeUntil(this.destroy$),
        ).subscribe(res => {
          const resRows = res.rows ?? [];
          const resolved = resRows.length ? this.resolveColumn(resRows[0], lf.sourceColumn) : lf.sourceColumn;
          const unique = [...new Set(resRows.map(r => String(r[resolved] ?? '')).filter(v => v))];
          lf.options = this.restrictLocalFilterOptions(lf, unique).sort();
          this.autoSelectLocalFilterIfSingle(lf, idx);
          this.cdr.detectChanges();
        });
      }
    }
  }

  /** Mirrors the global filter bar's auto-select-when-locked behavior, but only for Plant
   * local filters (e.g. narrowed to the viewer's single assigned plant) — other local filter
   * types (Region, Status, etc.) keep their original "stays on All until picked" behavior. */
  private autoSelectLocalFilterIfSingle(lf: { label: string; sourceColumn: string; value: string; options: string[] }, idx: number): void {
    if (!this.isPlantLocalFilter(lf) || lf.value || lf.options.length !== 1) return;
    lf.value = lf.options[0];
    // Defer until the card's initial data assignment (right after populateFilterOptions
    // returns) has settled, so applyLocalFilter reads the up-to-date chartCards[idx].
    setTimeout(() => this.applyLocalFilter(idx));
  }

  /** The global plant list can arrive after a card's own data already loaded (parallel
   * requests), leaving that card's local Plant filter unrestricted — re-narrow it here. */
  private reapplyPlantAccessToLocalFilters(): void {
    this.chartCards.forEach((card, idx) => {
      for (const lf of card.localFilters) {
        if (lf.controlType !== 'Dropdown' && lf.controlType !== 'MultiSelect') continue;
        lf.options = this.restrictLocalFilterOptions(lf, lf.options).sort();
        this.autoSelectLocalFilterIfSingle(lf, idx);
      }
    });
    this.cdr.detectChanges();
  }

  private loadInlineTilesForCard(idx: number, tileIds: number[], onAllLoaded?: () => void): void {
    // Pre-allocate slots to preserve tileIds order regardless of response timing
    const slots: (DashInlineTile | null)[] = tileIds.map(() => null);
    let completed = 0;

    tileIds.forEach((tileId, slotIdx) => {
      this.widgetService.getWidgetById(tileId, this.shareDataContext).pipe(takeUntil(this.destroy$)).subscribe({
        next: (tile) => {
          let d: TileDesign = {};
          try { d = JSON.parse(tile.designJson ?? '{}'); } catch { /* ignore */ }
          const source = tile.source ?? d.source ?? '';
          const sourceType = tile.sourceType ?? d.sourceType ?? 'Table';
          const label = (d.title || tile.name) ?? '';
          const color = d.tileColor ?? 'blue';
          const icon = d.tileIcon ?? 'well';
          const drillDownViewId = d.drillDownViewId ?? null;
          const showIcon = d.showTileIcon !== false;
          const tileLayout = resolveTileLayout(d.tileLayout);
          const valueBold = d.valueBold === true;
          const valueItalic = d.valueItalic === true;
          const valueColor = d.valueColor || '';
          const breakdownDefs = (d.breakdownRows ?? []).filter(r => r && (r.label || r.value));
          const breakdown = breakdownDefs.map(r => ({ label: r.label ?? '', value: r.value ?? '', color: r.color ?? 'blue' }));
          const breakdownCard = this.chartCards[idx];
          // A chart card's active local/clone filters flow to its tiles' breakdowns too (independent KPI tiles pass none).
          const breakdownLocals = breakdownCard.localFilters.filter(f => f.value && f.controlType !== 'MultiSelect')
            .map(f => ({ sourceTable: f.sourceTable, sourceColumn: f.sourceColumn, controlType: f.controlType, value: f.value, label: f.label }));
          this.hydrateBreakdown(breakdown, breakdownDefs, breakdownLocals, breakdownCard.design.source ?? '');
          if (!source) { completed++; this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded); return; }

          const card = this.chartCards[idx];
          const cloneFilters = card.isClone
            ? card.localFilters.filter(filter => filter.value && filter.controlType !== 'MultiSelect').map(filter => ({
                sourceTable: !filter.sourceTable || filter.sourceTable.toLowerCase() === (card.design.source ?? '').toLowerCase()
                  ? source : filter.sourceTable,
                sourceColumn: filter.sourceColumn,
                controlType: filter.controlType,
                value: filter.value,
                label: filter.label,
              }))
            : [];

          // A non-clone card's active local filter must flow to its Table tiles (including DAX ones).
          // Take the plain/DAX aggregate (via getTileAggregate) only when there's no clone filter AND
          // no active local filter; with an active local filter, fall through to the filtered path
          // below, which sends the local filters together with the daxModel.
          const hasActiveNonCloneLocal = !card.isClone
            && card.localFilters.some(filter => filter.value && filter.controlType !== 'MultiSelect');
          if (sourceType.toLowerCase() === 'table' && !cloneFilters.length && !hasActiveNonCloneLocal) {
            // Inline tiles follow the chart's global Cluster/Plant: non-DAX Table tiles aggregate
            // server-side via FK when a global is active, else take the plain/DAX aggregate.
            const inlineTableGlobals = d.daxModel?.enabled ? [] : tableClusterPlantFilters(this.filterCluster, this.filterPlant);
            const value$ = inlineTableGlobals.length
              ? this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
                  filters: inlineTableGlobals, fromDate: this.filterFrom || undefined, toDate: this.filterTo || undefined,
                  aggregation: d.aggregation ?? 'count', valueField: d.valueField || undefined,
                }, this.shareDataContext).pipe(map(res => ({ value: Number(res.rows?.[0]?.['Value'] ?? 0) })))
              : this.getTileAggregate(source, d);
            value$
              .pipe(takeUntil(this.destroy$)).subscribe({
                next: res => {
                  slots[slotIdx] = { widgetId: tileId, drillDownViewId, tileLayout, showIcon, valueBold, valueItalic, valueColor, label, value: this.formatTileNumber(res.value ?? 0, d), color, icon, breakdown };
                  completed++;
                  this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded);
                },
                error: () => {
                  if (d.daxModel?.enabled) slots[slotIdx] = { widgetId: tileId, drillDownViewId, tileLayout, showIcon, valueBold, valueItalic, valueColor, label, value: 'DAX error', color, icon, breakdown };
                  completed++; this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded);
                },
              });
            return;
          }

          const viewId = sourceType.toLowerCase() === 'view' ? (tile.sourceId ?? d.viewId ?? null) : null;
          // Non-clone cards: forward the card's active local filters to attached View/Table tiles so they filter with the chart.
          const nonCloneLocal = (!card.isClone && ((sourceType.toLowerCase() === 'view' && !!viewId) || sourceType.toLowerCase() === 'table'))
            ? card.localFilters.filter(filter => filter.value && filter.controlType !== 'MultiSelect').map(filter => ({
                sourceTable: !filter.sourceTable || filter.sourceTable.toLowerCase() === (card.design.source ?? '').toLowerCase()
                  ? source : filter.sourceTable,
                sourceColumn: filter.sourceColumn,
                controlType: filter.controlType,
                value: filter.value,
                label: filter.label,
              }))
            : [];
          const serverLocalFilters = cloneFilters.length ? cloneFilters : nonCloneLocal;
          const aggregateTile = sourceType.toLowerCase() === 'table' && serverLocalFilters.length > 0;
          const data$ = serverLocalFilters.length
            ? this.widgetService.getFilteredChartData({
                chartSource: source,
                chartSourceType: sourceType,
                viewId,
                filters: [
                  ...this.globalHierarchyFilterPayload(viewId).filter(global => global.advancedHierarchy || !serverLocalFilters.some(local =>
                    local.label.toLowerCase() === global.label.toLowerCase()
                    || local.sourceColumn.toLowerCase() === global.sourceColumn.toLowerCase())),
                  ...serverLocalFilters,
                  ...(aggregateTile && !d.daxModel?.enabled ? tableClusterPlantFilters(this.filterCluster, this.filterPlant) : []),
                ],
                fromDate: this.filterFrom || undefined,
                toDate: this.filterTo || undefined,
                ...(aggregateTile ? { aggregation: d.aggregation ?? 'count', valueField: d.valueField || undefined, daxModel: d.daxModel } : {}),
              }, this.shareDataContext)
            : (sourceType === 'View' && viewId)
            ? this.commonApi.getDatabaseViewById(viewId, this.shareDataContext).pipe(
                switchMap(view => {
                  const sql = this.injectDateParams(view.generatedSql);
                  return this.commonApi.previewView({ connectionId: view.connectionId, sql, viewId: view.id, maxRows: 1000, filters: this.globalPreviewFilters(view.id) }, this.shareDataContext);
                })
              )
            : this.widgetService.getTableData(source, sourceType, this.shareDataContext);

          data$.pipe(takeUntil(this.destroy$)).subscribe({
            next: (res) => {
              let rows = aggregateTile && d.daxModel?.enabled ? res.rows ?? [] : this.applyGlobalRowFilter(res.rows ?? [], card.isClone && serverLocalFilters.some(isPlantFilter));
              for (const filter of aggregateTile && d.daxModel?.enabled ? [] : serverLocalFilters) {
                const column = rows.length ? this.resolveColumn(rows[0], filter.sourceColumn) : filter.sourceColumn;
                if (!rows.length || !(column in rows[0])) continue;
                const value = filter.value.trim().toLowerCase();
                rows = rows.filter(row => String(row[column] ?? '').trim().toLowerCase() === value);
              }
              const formatted = aggregateTile
                ? this.formatTileNumber(Number(rows[0]?.['Value'] ?? 0), d)
                : this.computeTileValue(rows, d);
              slots[slotIdx] = { widgetId: tileId, drillDownViewId, tileLayout, showIcon, valueBold, valueItalic, valueColor, label, value: formatted, color, icon, breakdown };
              completed++;
              this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded);
            },
            error: () => {
              if (d.daxModel?.enabled) slots[slotIdx] = { widgetId: tileId, drillDownViewId, tileLayout, showIcon, valueBold, valueItalic, valueColor, label, value: 'DAX error', color, icon, breakdown };
              completed++; this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded);
            },
          });
        },
        error: () => { completed++; this.rebuildInlineTiles(idx, slots, completed, tileIds.length, onAllLoaded); },
      });
    });
  }

  private rebuildInlineTiles(
    idx: number, slots: (DashInlineTile | null)[],
    completed: number, total: number, onAllLoaded?: () => void,
  ): void {
    this.chartCards[idx].inlineTiles = slots.filter((s): s is DashInlineTile => s !== null);
    if (completed >= total) { this.cdr.detectChanges(); onAllLoaded?.(); }
  }

  /** After a chart's data loads, apply any preset/locked local-filter selection so it shows filtered by default. */
  private applyPresetIfAny(idx: number): void {
    const card = this.chartCards[idx];
    if (card && this.effectiveCardFilters(card).some(f => f.value || f.valueText || (f.values?.length ?? 0) > 0)) this.applyLocalFilter(idx);
  }

  kpiMeasures(index: number) { return getSelectableDaxMeasures(this.kpiTileDefs[index]?.design.daxModel); }

  kpiMetricId(index: number): string | null {
    const model = this.kpiTileDefs[index]?.design.daxModel;
    return model?.viewerMeasureId ?? model?.selectedMeasureId ?? null;
  }

  selectKpiMetric(index: number, id: string | null): void {
    const design = this.kpiTileDefs[index]?.design;
    if (!design?.daxModel) return;
    design.daxModel = withViewerMeasure(design.daxModel, id);
    this.kpis[index] = { ...this.kpis[index], value: '—' };
    this.reloadKpiTiles(index);
  }

  cardMeasures(card: OperationsDashboardComponent['chartCards'][number]) { return getSelectableDaxMeasures(card.design.daxModel); }

  selectCardMetric(idx: number, id: string | null): void {
    const card = this.chartCards[idx];
    if (!card.design.daxModel) return;
    this.chartCards[idx] = { ...card, design: { ...card.design, daxModel: withViewerMeasure(card.design.daxModel, id) } };
    this.applyLocalFilter(idx);
  }

  applyLocalFilter(idx: number): void {
    const card = this.chartCards[idx];
    const singleActive = this.serverCardFilters(card);
    const multiActive = card.localFilters.filter(f => f.controlType === 'MultiSelect' && (f.valueText || (f.values?.length ?? 0) > 0));
    const source = card.design.source ?? '';
    const sourceType = card.design.sourceType ?? 'Table';

    if (!singleActive.length && !multiActive.length) {
      this.reloadCardData(idx);
      return;
    }

    const hasCrossTableFilter = singleActive.some(filter =>
      !!filter.sourceTable && filter.sourceTable.toLowerCase() !== source.toLowerCase());

    // Same-source locked filters can be applied to the loaded rows directly. This avoids
    // replacing a valid preview with an empty server response for a local Plant filter.
  if (!hasCrossTableFilter && !this.hasActiveSharedFilter(card) && !this.hasAdvancedViewFilters(card) && !(card.isClone && card.design.viewId && singleActive.some(isPlantFilter))) {
      let rows = card.rawRows ?? [];
      for (const filter of singleActive) {
        const resolved = rows.length ? this.resolveColumn(rows[0], filter.sourceColumn) : filter.sourceColumn;
        const value = filter.value.trim().toLowerCase();
        rows = filter.controlType === 'Date'
          ? rows.filter(row => String(row[resolved] ?? '').trim().toLowerCase().startsWith(value))
          : rows.filter(row => String(row[resolved] ?? '').trim().toLowerCase().includes(value));
      }
      rows = this.applyCardMultiFilters(rows, multiActive);
      const result = this.buildCardResult(rows, card);
      this.chartCards[idx] = { ...card, ...result, dataReady: true };
      const tileIds = card.design.attachedTileIds ?? [];
      if (tileIds.length) this.loadInlineTilesForCard(idx, tileIds);
      this.cdr.detectChanges();
      return;
    }

    this.widgetService.getFilteredChartData({
      chartSource: source,
      chartSourceType: sourceType,
      viewId: card.design.viewId ?? null,
      preserveFutureDateRange: true,
      filters: [...singleActive.map(f => ({
        sourceTable: f.sourceTable || source,
        sourceColumn: f.sourceColumn,
        controlType: f.controlType,
        value: f.value,
        values: f.values,
        label: f.label,
        dashboardAdditional: f.dashboardAdditional,
      })), ...(this.isTrendChart(card.design) || this.hasActiveSharedFilter(card) || this.hasAdvancedViewFilters(card) || (card.isClone && singleActive.some(isPlantFilter))
        ? this.globalHierarchyFilterPayload(card.design.viewId).filter(filter => !card.isClone || !singleActive.some(isPlantFilter) || !isPlantFilter(filter)) : [])],
      fromDate: this.filterFrom || undefined,
      toDate: this.filterTo || undefined,
      ...(this.isTrendChart(card.design) ? { mode: card.trendMode } : {}),
    }, this.shareDataContext).pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const rows = this.applyCardMultiFilters(this.applyGlobalRowFilter(res.rows ?? [], card.isClone && singleActive.some(isPlantFilter)), multiActive);
        const result = this.buildCardResult(rows, card);
        this.chartCards[idx] = { ...card, ...result, dataReady: true };
        const tileIds = card.design.attachedTileIds ?? [];
        if (tileIds.length) this.loadInlineTilesForCard(idx, tileIds);
        this.cdr.detectChanges();
      },
      error: () => this.notify.showError(`Failed to apply filter for chart: ${card.title}`),
    });
  }

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.cancelReload$.next();
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.reloadKpiTiles();
    this.chartCards.forEach((card, index) => {
      if (card.design.viewId) this.reloadCardData(index);
      else if (card.design.attachedTileIds?.length)
        this.loadInlineTilesForCard(index, card.design.attachedTileIds);
    });
  }

  private advancedFilters: (WidgetDataFilter & { label: string })[] = [];
  @ViewChild('advancedFilter') private advancedFilterRef?: AdvancedFilterComponent;

  private hasAdvancedViewFilters(card: OperationsDashboardComponent['chartCards'][number]): boolean {
    return !!card.design.viewId && !!this.advancedFilters?.length;
  }

  /** Apply interactive and conditional MultiSelect filters to the card's rows. */
  private applyCardMultiFilters(rows: Record<string, unknown>[], multiActive: { sourceColumn: string; values?: string[]; operator?: string; valueText?: string; mode?: string }[]): Record<string, unknown>[] {
    let out = rows;
    for (const f of multiActive) {
      if (f.operator) {
        out = applyConditionalFilters(out, [f]);
        continue;
      }
      if (!f.sourceColumn || !(f.values?.length)) continue;
      const resolved = out.length ? this.resolveColumn(out[0], f.sourceColumn) : f.sourceColumn;
      const set = new Set(f.values.map(v => v.toLowerCase()));
      out = out.filter(r => set.has(String(r[resolved] ?? '').toLowerCase()));
    }
    return out;
  }

  toggleCardMultiFilter(cardIdx: number, filterIdx: number): void {
    const key = `${cardIdx}:${filterIdx}`;
    this.openCardMultiFilter = this.openCardMultiFilter === key ? null : key;
  }

  isCardMultiFilterOpen(cardIdx: number, filterIdx: number): boolean {
    return this.openCardMultiFilter === `${cardIdx}:${filterIdx}`;
  }

  isCardMultiChecked(lf: { values?: string[] }, option: string): boolean {
    return (lf.values ?? []).includes(option);
  }

  toggleCardMultiValue(cardIdx: number, lf: { values?: string[]; locked?: boolean }, option: string): void {
    const cur = lf.values ?? [];
    lf.values = cur.includes(option) ? cur.filter(v => v !== option) : [...cur, option];
    this.applyLocalFilter(cardIdx);
  }

  cardMultiSummary(lf: { values?: string[] }): string {
    const n = (lf.values ?? []).length;
    return n ? `${n} selected` : 'All';
  }

  private dashboardChartDateRange?: { fromDate: string; toDate: string };
  private chartDateRangeSub?: Subscription;

  private resetDashboardChartDates(): void {
    this.chartDateRangeSub?.unsubscribe();
    if (this.dashboardChartDateRange) {
      this.filterFrom = `${new Date().getFullYear()}-01-01`;
      this.filterTo = this.lastTuesday(new Date());
      this.filterQuickRange = '';
    }
    this.dashboardChartDateRange = undefined;
  }

  private applyDashboardChartDates(): void {
    if (!this.dashboardChartDateRange) return;
    this.filterFrom = this.dashboardChartDateRange.fromDate;
    this.filterTo = this.dashboardChartDateRange.toDate;
    this.filterQuickRange = 'Custom';
  }

  private initializeDashboardChartDates(): Map<number, ReturnType<CommonApiService['getDatabaseViewById']>> {
    this.resetDashboardChartDates();
    const views = new Map<number, ReturnType<CommonApiService['getDatabaseViewById']>>();
    const cards = this.chartCards;
    if (!cards.length || cards.some(card =>
      card.design.sourceType?.toLowerCase() !== 'view' || !(card.design.viewId && card.design.viewId > 0))) {
      return views;
    }

    for (const card of cards) {
      const viewId = card.design.viewId!;
      if (!views.has(viewId)) {
        views.set(viewId, this.commonApi.getDatabaseViewById(viewId, this.shareDataContext).pipe(
          shareReplay({ bufferSize: 1, refCount: true }),
        ));
      }
    }
    // Inspect all chart metadata, not just visible cards, before changing the displayed dates.
    this.chartDateRangeSub = forkJoin([...views.values()]).pipe(takeUntil(this.destroy$)).subscribe({
      next: chartViews => {
        if (this.chartCards !== cards || !chartViews.every(view => hasFutureDateParameter(view.generatedSql))) return;
        const range = getViewDateRangeDefaults(chartViews[0].generatedSql);
        if (!range.fromDate || !range.toDate) {
          this.showError('Unable to resolve the first chart\'s future-date range from its view.');
          return;
        }
        this.dashboardChartDateRange = { fromDate: range.fromDate, toDate: range.toDate };
        this.applyDashboardChartDates();
        this.cdr.markForCheck();
      },
      error: err => this.showError(err?.error?.message || err?.message || 'Failed to load chart date ranges.'),
    });
    return views;
  }

  private readonly datePattern = /^\d{4}-\d{2}-\d{2}$/;
  private readonly safeValuePattern = /^[A-Za-z0-9\s\-_.,()]+$/;

  private injectDateParams(sql: string, preserveFutureDateRange = false): string {
    const preserveDates = preserveFutureDateRange && hasFutureDateParameter(sql);
    if (!preserveDates && this.filterFrom && this.datePattern.test(this.filterFrom)) {
      sql = sql.replace(
        /DECLARE\s+@start_date\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
        `DECLARE @start_date $1 = '${this.filterFrom}';`,
      );
    }
    if (!preserveDates && this.filterTo && this.datePattern.test(this.filterTo)) {
      sql = sql.replace(
        /DECLARE\s+@end_date\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
        `DECLARE @end_date $1 = '${this.filterTo}';`,
      );
    }
    if (typeof this.filterCluster === 'string' && this.filterCluster && this.filterCluster !== 'All' && this.safeValuePattern.test(this.filterCluster)) {
      const hasDeclare = /DECLARE\s+@cluster\s/i.test(sql);
      if (hasDeclare) {
        sql = sql.replace(
          /DECLARE\s+@cluster\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
          `DECLARE @cluster $1 = '${this.filterCluster}';`,
        );
      } else if (/@cluster\b/i.test(sql)) {
        sql = `DECLARE @cluster NVARCHAR(100) = '${this.filterCluster}';\n${sql}`;
      }
    }
    if (typeof this.filterPlant === 'string' && this.filterPlant && this.filterPlant !== 'All' && this.safeValuePattern.test(this.filterPlant)) {
      const hasDeclare = /DECLARE\s+@plant\s/i.test(sql);
      if (hasDeclare) {
        sql = sql.replace(
          /DECLARE\s+@plant\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
          `DECLARE @plant $1 = '${this.filterPlant}';`,
        );
      } else if (/@plant\b/i.test(sql)) {
        sql = `DECLARE @plant NVARCHAR(100) = '${this.filterPlant}';\n${sql}`;
      }
    }
    return sql;
  }

  /** sessionStorage key for the live filter bar — per-dashboard once known, shared draft bucket before that. */
  private filterStorageKey(): string {
    return `operations-dashboard-filters-${this.currentDashboardId ?? 'new'}`;
  }

  /** Set by restoreFilterState() when a stored selection was actually applied; consumed once the initial tiles/charts populate. */
  private pendingFilterReload = false;
  customFilters: CustomDashboardFilter[] = [];
  private pendingCustomFilterValues: Record<string, GlobalFilterSelection> = {};
  private customFilterOptions: Record<string, string[]> = {};

  private effectiveCardFilters(card: typeof this.chartCards[0]): typeof card.localFilters {
    return mergeDashboardSharedFilters(card.localFilters, this.customFilters, filter => ({
      label: filter.label, sourceTable: filter.sourceTable, sourceColumn: filter.sourceColumn,
      ...globalSelectionPayload(filter.value), options: [], dashboardAdditional: true,
    }));
  }

  private hasActiveSharedFilter(card: typeof this.chartCards[0]): boolean {
    return this.effectiveCardFilters(card).some((filter, index) => filter !== card.localFilters[index]);
  }

  private serverCardFilters(card: typeof this.chartCards[0]): typeof card.localFilters {
    return this.effectiveCardFilters(card).filter(filter =>
      (filter.controlType !== 'MultiSelect' && !!filter.value) ||
      (!card.localFilters.includes(filter) && !!filter.values?.length));
  }

  selectCustomFilterOption(filter: CustomDashboardFilter, value: string): void {
    filter.value = toggleGlobalSelection(filter.value, value, this.getCustomFilterOptions(filter), this.globalFilterClear.consume(filter));
    this.persistFilterState();
    this.onClusterChange();
  }

  getCustomFilterOptions(filter: CustomDashboardFilter): string[] {
    if (this.isPlantLocalFilter(filter)) return this.filterPlantOptions;
    if (!this.customFilterOptions[filter.id]) {
      this.customFilterOptions[filter.id] = [];
      this.widgetService.getTableData(filter.sourceTable, 'Table', this.shareDataContext).pipe(
        catchError(() => this.widgetService.getTableData(filter.sourceTable, 'View', this.shareDataContext)),
        takeUntil(this.destroy$),
      ).subscribe({
        next: res => {
          const rows = res.rows ?? [];
          const column = rows.length ? this.resolveColumn(rows[0], filter.sourceColumn) : filter.sourceColumn;
          this.customFilterOptions[filter.id] = [...new Set(rows.map(row => String(row[column] ?? '')).filter(Boolean))].sort();
          this.cdr.markForCheck();
        },
        error: () => {
          this.notify.showError(`Failed to load dashboard filter options: ${filter.label}`);
        },
      });
    }
    return this.customFilterOptions[filter.id] ?? [];
  }

  /** Persists the current filter bar selection so it survives a page refresh (same tab only). */
  private persistFilterState(): void {
    const state = {
      country: this.filterCountry, sector: this.filterSector, businessUnit: this.filterBusinessUnit, division: this.filterDivision,
      cluster: this.filterCluster, plant: this.filterPlant,
      fromDate: this.filterFrom, toDate: this.filterTo, activePresetId: this.activePresetId,
      customFilters: Object.fromEntries(this.customFilters.map(filter => [filter.id, filter.value])),
    };
    try {
      sessionStorage.setItem(this.filterStorageKey(), JSON.stringify(state));
    } catch {
      // sessionStorage unavailable — filter bar simply won't persist across a refresh.
    }
  }

  /** Clears the persisted filter bar selection so reopening the dashboard starts from defaults. */
  private clearFilterState(): void {
    try {
      sessionStorage.removeItem(this.filterStorageKey());
    } catch {
      // sessionStorage unavailable — nothing to clear.
    }
  }

  /** Restores a previously persisted filter bar selection, if any (runs before plant-filter data loads). */
  private restoreFilterState(): void {
    try {
      const raw = sessionStorage.getItem(this.filterStorageKey());
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.country) this.filterCountry = state.country;
      if (state.sector) this.filterSector = state.sector;
      if (state.businessUnit) this.filterBusinessUnit = state.businessUnit;
      if (state.division) this.filterDivision = state.division;
      if (state.cluster) this.filterCluster = state.cluster;
      if (state.plant) this.filterPlant = state.plant;
      if (state.fromDate) this.filterFrom = state.fromDate;
      if (state.toDate) this.filterTo = state.toDate;
      if (state.activePresetId != null) this.activePresetId = state.activePresetId;
      this.pendingCustomFilterValues = state.customFilters ?? {};
      // Initial tile/chart loaders skip cluster/plant row-filtering (only the explicit
      // onClusterChange() reload path applies it) — flag it so the freshly-loaded data gets
      // re-filtered once ready, instead of the dropdowns showing a selection the data ignores.
      this.pendingFilterReload = true;
    } catch {
      // Corrupt/incompatible stored state — ignore and keep defaults.
    }
  }

  private loadClusterOptions(): void {
    this.commonApi.getPlantFilters(this.shareDataContext).pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (plants) => {
        this.allPlants = plants;
        this.filterCountryOptions = this.distinct(plants, p => p.country);
        this.autoSelectSingle();
        this.rebuildCascadingOptions();
        // Per-card data can load in parallel and finish before this plant list arrives,
        // in which case each card's local Plant filter was left unrestricted — re-narrow
        // any already-populated cards now that the assigned plants are known.
        this.reapplyPlantAccessToLocalFilters();
        this.cdr.markForCheck();
      },
    });
  }

  private autoSelectSingle(): void {
    if (this.filterCountryOptions.length === 1) this.filterCountry = this.filterCountryOptions[0];
    const active = hasGlobalSelection;
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.filterCountry));
    const sectors = this.distinct(filtered, p => p.sector);
    if (sectors.length === 1) this.filterSector = sectors[0];
    if (active(this.filterSector)) filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.filterSector));
    const bus = this.distinct(filtered, p => p.businessUnit);
    if (bus.length === 1) this.filterBusinessUnit = bus[0];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.filterBusinessUnit));
    const divs = this.distinct(filtered, p => p.division);
    if (divs.length === 1) this.filterDivision = divs[0];
    if (active(this.filterDivision)) filtered = filtered.filter(p => matchesGlobalSelection(p.division, this.filterDivision));
    const clusters = this.distinct(filtered, p => p.cluster);
    if (clusters.length === 1) this.filterCluster = clusters[0];
    if (active(this.filterCluster)) filtered = filtered.filter(p => matchesGlobalSelection(p.cluster, this.filterCluster));
    const plantNames = this.distinct(filtered, p => p.plantDescription);
    if (plantNames.length === 1) this.filterPlant = plantNames[0];
  }

  private rebuildCascadingOptions(suppressAutoCluster = false, suppressAutoPlant = false): void {
    const active = hasGlobalSelection;
    let filtered = this.allPlants;

    if (active(this.filterCountry)) filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.filterCountry));
    this.filterSectorOptions = active(this.filterCountry) ? this.distinct(filtered, p => p.sector) : [];

    if (active(this.filterSector)) filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.filterSector));
    this.filterBusinessUnitOptions = active(this.filterSector) ? this.distinct(filtered, p => p.businessUnit) : [];

    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.filterBusinessUnit));
    this.filterDivisionOptions = active(this.filterBusinessUnit) ? this.distinct(filtered, p => p.division) : [];

    if (active(this.filterDivision)) filtered = filtered.filter(p => matchesGlobalSelection(p.division, this.filterDivision));
    this.filterClusterOptions = active(this.filterDivision) ? this.distinct(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it (not leave the field
    // showing "All") so the lock UI's displayed value matches what's actually being filtered.
    // Skip when the user explicitly reset to "All", otherwise the reset can never stick.
    if (!suppressAutoCluster && !active(this.filterCluster) && this.filterClusterOptions.length === 1) this.filterCluster = this.filterClusterOptions[0];

    if (active(this.filterCluster)) filtered = filtered.filter(p => matchesGlobalSelection(p.cluster, this.filterCluster));
    this.filterPlantOptions = this.distinct(filtered, p => p.plantDescription);
    if (!suppressAutoPlant && !active(this.filterPlant) && this.filterPlantOptions.length === 1) this.filterPlant = this.filterPlantOptions[0];
  }

  private distinct(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  onClusterChange(): void {
    this.interactionReloadToken++;
    this.cancelReload$.next();
    this.reloadKpiTiles();

    const indicesToReload = this.chartCards
      .map((card, idx) => ({ card, idx }))
      .filter(({ card }) => {
        const isView = card.design.dataSourceMode === 'view' && (card.design.viewId ?? 0) > 0;
        return isView || card.design.source;
      });

    if (!indicesToReload.length) return;

    indicesToReload.forEach(({ card, idx }) => {
      this.chartCards[idx] = { ...card, dataReady: false };
      this.markChartLoaded(idx);
    });
    this.cdr.detectChanges();

    const reloads$ = indicesToReload.map(({ idx }) => this.reloadCardData$(idx));
    concat(...reloads$).pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe();
  }

  private reloadKpiTiles(only?: number): void {
    if (!this.kpiTileDefs.length) return;
    this.kpiTileDefs.forEach((t, i) => {
      if (only !== undefined && only !== i) return;
      // Re-hydrate the breakdown so it tracks the global filter too (standalone KPI = no local filter).
      const fp = this.kpis[i]?.footerParts;
      if (fp) this.hydrateBreakdown(fp, t.design.breakdownRows ?? []);
      const viewId = t.design.viewId ?? 0;
      const isView = t.design.dataSourceMode === 'view' && viewId > 0;
      const source = t.design.source ?? '';
      const sourceType = t.design.sourceType ?? 'Table';
      if (!source && !isView) return;
      // Only marked loaded once this reload actually lands a value — otherwise a failed/cancelled
      // reload (e.g. a filter-driven query the backend rejects, or a second reload superseding
      // this one via cancelReload$) would permanently disable the tile's own lazy-load fallback
      // via markKpiLoaded, leaving it stuck at its placeholder dash forever with nothing left to
      // retry it.
      const isTable = !isView && sourceType.toLowerCase() === 'table';
      // Non-DAX Table tiles apply the global Cluster/Plant as best-effort FK-joined filters.
      if (isTable && source) {
        const tableGlobals = t.design.daxModel?.enabled ? [] : tableClusterPlantFilters(this.filterCluster, this.filterPlant);
        const value$ = tableGlobals.length
          ? this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
              filters: tableGlobals, aggregation: t.design.aggregation ?? 'count', valueField: t.design.valueField || undefined }, this.shareDataContext)
              .pipe(map(r => ({ value: Number(r.rows?.[0]?.['Value'] ?? 0) })))
          : this.getTileAggregate(source, t.design);
        value$
          .pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe({
            next: res => { this.kpis[i] = { ...this.kpis[i], value: this.formatTileNumber(res.value ?? 0, t.design) }; this.markKpiLoaded(i); this.cdr.detectChanges(); },
            error: () => {
              if (t.design.daxModel?.enabled) {
                this.kpis[i] = { ...this.kpis[i], value: 'DAX error' };
                this.cdr.detectChanges();
                return;
              }
              if (this.loadedKpiIdx.has(i)) return;
              const ref = this.kpiEls?.find(element => Number(element.nativeElement.dataset['lazyIdx']) === i);
              if (this.lazyObserver) {
                if (ref) this.lazyObserver.observe(ref.nativeElement);
              } else {
                this.lazyLoadKpi(i);
              }
            },
          });
        return;
      }

      const data$ = isView
        ? this.commonApi.getDatabaseViewById(viewId, this.shareDataContext).pipe(
            switchMap(view => {
              const sql = this.injectDateParams(view.generatedSql);
              return this.commonApi.previewView({ connectionId: view.connectionId, sql, viewId: view.id, maxRows: 1000, filters: this.globalPreviewFilters(view.id) }, this.shareDataContext);
            }),
            catchError(error => {
              if (this.advancedFilters?.length) {
                console.error('Failed to apply Advanced Filters to dashboard tile', error);
                this.notify.showError('Failed to apply Advanced Filters to dashboard tile.');
                return of();
              }
              return of({ columns: [] as string[], rows: [] as Record<string, unknown>[], daxError: !!t.design.daxModel?.enabled });
            }),
          )
        : this.widgetService.getTableData(source, sourceType, this.shareDataContext).pipe(
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[], daxError: !!t.design.daxModel?.enabled })),
          );

      data$.pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe(res => {
        const rows = this.applyGlobalRowFilter(res.rows ?? []);
        this.kpis[i] = { ...this.kpis[i], value: 'daxError' in res && res.daxError ? 'DAX error' : this.computeTileValue(rows, t.design) };
        this.markKpiLoaded(i);
        this.cdr.detectChanges();
      });
    });
  }

  /** Re-execute all view-based charts when global From/To dates change */
  onGlobalDateChange(): void {
    this.interactionReloadToken++;
    this.dateChange$.next();
    this.persistFilterState();
  }

  private executeGlobalDateRefresh(): void {
    const hasFrom = this.datePattern.test(this.filterFrom);
    const hasTo = this.datePattern.test(this.filterTo);
    if (!hasFrom && !hasTo) return;

    // Cancel any in-flight reload from a previous date change
    this.cancelReload$.next();
    this.reloadKpiTiles();

    const indicesToReload = this.chartCards
      .map((card, idx) => ({ card, idx }))
      .filter(({ card }) => card.viewSql && card.viewConnectionId);

    if (!indicesToReload.length) return;

    // Mark cards as loading, then reload sequentially to avoid overwhelming the DB
    indicesToReload.forEach(({ card, idx }) => {
      this.chartCards[idx] = { ...card, dataReady: false };
    });
    this.cdr.detectChanges();

    const reloads$ = indicesToReload.map(({ idx }) => this.reloadCardData$(idx));
    concat(...reloads$).pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe();
  }

  private reloadCardData(idx: number): void {
    this.reloadCardData$(idx).pipe(takeUntil(this.cancelReload$), takeUntil(this.destroy$)).subscribe();
  }

  /** Filter rows by global filter selections (cluster, plant, etc.) based on matching column names. */
  private applyGlobalRowFilter(rows: Record<string, unknown>[], plantClone = false): Record<string, unknown>[] {
    const selections: [string, GlobalFilterSelection][] = [
      ['country', this.filterCountry], ['sector', this.filterSector], ['businessUnit', this.filterBusinessUnit],
      ['division', this.filterDivision], ['cluster', this.filterCluster], ['plant', plantClone ? 'All' : this.filterPlant],
    ];
    return rows.filter(row => selections.every(([field, selection]) => {
      const column = this.findColumn(row, field);
      return !column || matchesGlobalSelection(row[column], selection);
    }));
  }

  private findColumn(row: Record<string, unknown>, keyword: string): string | null {
    const lower = keyword.toLowerCase();
    const exact = Object.keys(row).find(k => k.toLowerCase() === lower);
    if (exact) return exact;
    return Object.keys(row).find(k => k.toLowerCase().includes(lower)) ?? null;
  }

  /**
   * Country → Plant selections as request filters. Trend data comes from the aggregated trend
   * endpoint, whose period rows have no cluster/plant column to filter on afterwards, so the
   * hierarchy must travel with the request or a date change silently drops it.
   */
  private globalHierarchyFilterPayload(viewId: number | null | undefined): (WidgetDataFilter & { label: string })[] {
    // Only with the view id the request sends: view SQL matches these to its DECLARE @cluster/@plant
    // placeholders and ignores the rest, while a table source would turn them into WHERE clauses.
    if (!viewId || viewId <= 0) return [];
    const values: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector, businessUnit: this.filterBusinessUnit,
      division: this.filterDivision, cluster: this.filterCluster, plant: this.filterPlant,
    };
    return [...Object.entries(values)
      .filter(([, value]) => hasGlobalSelection(value))
      .map(([key, value]) => ({ sourceTable: key, sourceColumn: key, ...globalSelectionPayload(value), label: key })),
      ...(this.advancedFilters ?? [])];
  }

  private globalPreviewFilters(viewId: number) {
    return this.globalHierarchyFilterPayload(viewId).filter(filter => filter.advancedHierarchy || (filter.values?.length ?? 0) > 1);
  }

  private reloadCardData$(idx: number) {
    const card = this.chartCards[idx];
    const source = card.design.source ?? '';
    const sourceType = card.design.sourceType ?? 'Table';
    const isView = (card.design.dataSourceMode === 'view' || sourceType.toLowerCase() === 'view')
      && (card.design.viewId ?? 0) > 0;

    const apply = (res: { rows?: Record<string, unknown>[]; columns?: string[] }, serverFiltered = false) => {
      const rows = serverFiltered ? (res.rows ?? []) : this.applyGlobalRowFilter(res.rows ?? [], card.isClone && card.localFilters.some(isPlantFilter));
      const hasSharedFilter = this.hasActiveSharedFilter(card);
      const displayRows = hasSharedFilter
        ? this.applyCardMultiFilters(rows, card.localFilters.filter(filter => filter.controlType === 'MultiSelect'))
        : rows;
      const result = this.buildCardResult(displayRows, card);
      this.chartCards[idx] = { ...card, ...result, rawRows: rows, rowsMode: card.trendMode, dataReady: true };
      const tileIds = card.design.attachedTileIds ?? [];
      if (tileIds.length) this.loadInlineTilesForCard(idx, tileIds);
      this.cdr.detectChanges();
      if (!hasSharedFilter) this.applyPresetIfAny(idx);
    };

    if (this.hasActiveSharedFilter(card) || this.hasAdvancedViewFilters(card)) {
      return this.widgetService.getFilteredChartData({
        chartSource: source,
        chartSourceType: sourceType,
        viewId: isView ? (card.design.viewId ?? null) : null,
        preserveFutureDateRange: true,
        filters: [...this.serverCardFilters(card),
          ...this.globalHierarchyFilterPayload(isView ? card.design.viewId : null).filter(filter => !card.isClone || !card.localFilters.some(isPlantFilter) || !isPlantFilter(filter))],
        fromDate: this.filterFrom || undefined,
        toDate: this.filterTo || undefined,
        ...(this.isTrendChart(card.design) ? { mode: card.trendMode } : {}),
      }, this.shareDataContext).pipe(
        tap(apply),
        catchError(error => {
          console.error(`Failed to apply dashboard filter for chart: ${card.title}`, error);
          this.notify.showError(`Failed to apply dashboard filter for chart: ${card.title}`);
          this.chartCards[idx] = { ...this.chartCards[idx], dataReady: true };
          this.cdr.markForCheck();
          return of();
        }),
      );
    }
    if (isView) {
      if (this.isTrendChart(card.design) || (card.isClone && card.localFilters.some(isPlantFilter))) {
        return this.widgetService.getFilteredChartData({
          chartSource: source,
          chartSourceType: sourceType,
          viewId: card.design.viewId ?? null,
          preserveFutureDateRange: true,
          filters: [...this.serverCardFilters(card), ...this.globalHierarchyFilterPayload(card.design.viewId).filter(filter => !card.isClone || !card.localFilters.some(isPlantFilter) || !isPlantFilter(filter))],
          ...(this.isTrendChart(card.design) ? { mode: card.trendMode } : {}),
          fromDate: this.filterFrom || undefined,
          toDate: this.filterTo || undefined,
        }, this.shareDataContext).pipe(
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
          tap(apply),
        );
      }

      const sql = card.viewSql ? this.injectDateParams(card.viewSql, true) : '';
      const connId = card.viewConnectionId;
      if (sql && connId) {
        return this.commonApi.previewView({ connectionId: connId, sql, viewId: card.viewIdForPreview ?? 0, maxRows: 1000, filters: this.globalPreviewFilters(card.design.viewId ?? 0) }, this.shareDataContext).pipe(
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
          tap(apply),
        );
      } else {
        return this.commonApi.getDatabaseViewById(card.design.viewId!, this.shareDataContext).pipe(
          switchMap(view => {
            this.chartCards[idx].viewSql = view.generatedSql;
            this.chartCards[idx].viewConnectionId = view.connectionId;
            this.chartCards[idx].viewIdForPreview = view.id;
            const sql = this.injectDateParams(view.generatedSql, true);
            return this.commonApi.previewView({ connectionId: view.connectionId, sql, viewId: view.id, maxRows: 1000, filters: this.globalPreviewFilters(view.id) }, this.shareDataContext);
          }),
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
          tap(apply),
        );
      }
    } else {
      // Table chart: apply the global Cluster/Plant server-side (FK join) so the capped rows come
      // back already filtered; a table with no FK is returned unfiltered (optional filter skipped).
      const tableGlobals = tableClusterPlantFilters(this.filterCluster, this.filterPlant);
      if (tableGlobals.length) {
        return this.widgetService.getFilteredChartData({
          chartSource: source, chartSourceType: sourceType, viewId: null, preserveFutureDateRange: true,
          filters: [...this.effectiveCardFilters(card).filter(filter => filter.value && filter.controlType !== 'MultiSelect'), ...tableGlobals],
          fromDate: this.filterFrom || undefined, toDate: this.filterTo || undefined,
        }, this.shareDataContext).pipe(
          catchError(() => of({ columns: [] as string[], rows: [] as Record<string, unknown>[] })),
          tap(res => apply(res, true)),
        );
      }
      return this.widgetService.getTableData(source, sourceType, this.shareDataContext).pipe(
        catchError(() => of({ rows: [] as Record<string, unknown>[], columns: [] as string[] })),
        tap(apply),
      );
    }
  }
}

import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, ViewChild, signal } from '@angular/core';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { resolveTileLayout, type TileLayout } from '../../../core/utils/tile-layout.util';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { of, Subject } from 'rxjs';
import { catchError, switchMap, takeUntil, map } from 'rxjs/operators';
import type Highcharts from 'highcharts';
import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { buildTimelineOptions } from '../../../core/utils/timeline-chart.util';
import { buildHistogramOptions } from '../../../core/utils/histogram-chart.util';
import { buildScatterOptions } from '../../../core/utils/scatter-chart.util';
import { buildHeatmapOptions, resolveHeatmapMeasure } from '../../../core/utils/heatmap-chart.util';
import { forecastScenarioPeriods, hasScenarioDatePeriods } from '../../../core/utils/scenario-forecast.util';
import { predictScenarioCategoryChanges } from '../../../core/utils/scenario-category-prediction.util';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyLineDataLabelLayout } from '../../../core/utils/line-data-label-layout.util';
import { applyScenarioChartReadability } from '../../../core/utils/scenario-chart-readability.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { applyChartSort } from '../../../core/utils/chart-sort.util';
import { highlightLegendPoint } from '../../../core/utils/chart-legend-hover.util';
import { legendLayoutClass, LegendPosition, readLegendPosition } from '../../../core/utils/chart-legend-position.util';
import { WidgetService, Widget, WidgetDataFilter } from '../../../core/services/widget.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { tableClusterPlantFilters } from '../../../core/utils/table-global-filter.util';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ToastService } from '../../../core/services/toast.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import { consumeReliabilityReturn, ReliabilitySource } from '../../../shared/components/reliability-details/reliability-navigation';
import { ChartView, ChartViewIcon, CHART_VIEW_LABELS, chartSwitchOptions, chartViewIcon, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { appendDaxToTableRows, appendDaxTotalToSeries, evaluateDaxMeasure, getActiveDaxMeasures, getDaxRowColumnMeasures, DaxModelConfig, evaluateTileDaxValue, formatDaxValue, getSelectedDaxMeasure, getSelectableDaxMeasures, withViewerMeasure } from '../../../core/utils/dax-evaluator.util';
import { applyConditionalFilters, matchesConditionalFilter } from '../../../core/utils/conditional-filter.util';
import { applyParameterFilters, getRenamedColumnNames, getSavedParameterFilters, remapDesignColumns } from '../../../core/utils/parameter-filter.util';
import { appendLockedFilterTitle } from '../../../core/utils/locked-filter-title.util';
import { getViewDateRangeDefaults, replaceViewDateRangeParameters } from '../../../core/utils/view-date-parameters.util';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  globalSelectionPayload,
  globalSelectionQueryValue,
  hasGlobalSelection,
  matchesGlobalSelection,
  isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
import { AdvancedChartPayload, advancedChartExport, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { CHART_AUTO_COLORS, chartFallbackColor, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { createTablePdf } from '../../../core/utils/table-pdf.util';
import { createTableImage } from '../../../core/utils/table-image.util';
import { loadCloneFonts, prepareIndividualChartExportClone } from '../../../core/utils/dashboard-export-layout.util';
import * as XLSX from 'xlsx';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';
import type { TableGridOptions } from '../../../core/utils/table-grid-features.util';
import { AdvancedFilterComponent, type AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { advancedHierarchyFilters, advancedHierarchySourceColumns } from '../../../core/utils/advanced-hierarchy-filter.util';
import { aggregateChartRows } from '../../../core/utils/chart-aggregation.util';
import type { ReportFilter } from '../../../core/utils/report-filter.util';

export type ChartAccent = 'purple' | 'blue' | 'green' | 'orange';
export interface ChartSummary { id: string; title: string; description: string; category: string; accent: ChartAccent; favorite: boolean; score?: number | null; reliabilityBreakdown?: string; }
interface FilterControl { id: number; label: string; controlType: string; sourceTable: string; sourceColumn: string; value: string; values: string[]; dateFrom: string; dateTo: string; options: string[]; hidden?: boolean; locked?: boolean; operator?: string; valueText?: string; mode?: string; }
export interface WidgetCategory { key: string; label: string; value: number; color: string; }
interface ScenarioItem { id: number; name: string; value: number; target: string; }

export interface ScenarioBuilderPreview {
  key: string;
  design: Record<string, unknown>;
  rows: Record<string, unknown>[];
  columns: string[];
  fromDate: string;
  toDate: string;
  hierarchyFilters: WidgetDataFilter[];
  filters: WidgetDataFilter[];
  reportFilters: ReportFilter[];
}

export interface ScenarioBuilderResult {
  options: Highcharts.Options;
  categories: string[];
  values: number[];
  series: { name: string; data: number[] }[];
}

type ChartSize = 'S' | 'M' | 'L';
type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES = new Set(['line', 'multiline', 'grouped', 'stacked', 'area']);

const CHART_HEIGHT_BY_SIZE: Record<ChartSize, number> = { S: 260, M: 340, L: 420 };
const COLORS = [...CHART_AUTO_COLORS];

function safeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function designTypeToChartView(ct: string | undefined): ChartView {
  // Unknown / kpi designs fall back to donut on this page.
  if (!ct || !(ct.toLowerCase() in CHART_VIEW_LABELS) && ct.toLowerCase() !== 'doughnut') return 'donut';
  return toChartView(ct);
}

@Component({
  selector: 'app-widget-view', standalone: false,
  templateUrl: './widget-view.component.html', styleUrls: ['./widget-view.component.scss'],
  host: { '[class.wv-builder-scenario-host]': '!!scenarioBuilderPreview' },
})
export class WidgetViewComponent implements OnInit, OnDestroy, OnChanges {
  @Input() scenarioBuilderPreview: ScenarioBuilderPreview | null = null;
  @Output() scenarioPreviewChange = new EventEmitter<ScenarioBuilderResult | null>(true);
  private scenarioBuilderKey = '';

  ngOnChanges(): void {
    const preview = this.scenarioBuilderPreview;
    if (!preview) return;
    this.cancelScenarioMonthly$.next();
    this.scenarioMonthlyRows = null;
    this.scenarioMonthlyRequested = false;
    this.scenarioMonthlyLoading = false;
    this.scenarioMonthlyError = '';
    if (preview.key !== this.scenarioBuilderKey) {
      this.scenarioBuilderKey = preview.key;
      this.scenarioTargetMode = 'category';
      this.scenarioPlanAdjustmentMode = 'percentage';
      this.scenarioPlanAdjustments = 0;
      this.scenarioScheduleSlippage = 0;
      this.scenarioCategoryTarget = '';
      this.scenarioItems = [];
    }
    this.design = preview.design;
    this.filteredRows = preview.rows;
    this.tableColumns = preview.columns;
    this.fromDate = preview.fromDate;
    this.toDate = preview.toDate;
    this.trendMode = (this.design['trendMode'] as TrendMode) ?? 'monthly';
    this.chartView = designTypeToChartView(this.design['chartType'] as string);
    this.chart.title = String(this.design['chartTitle'] ?? '');
    this.baseCategories = [];
    this.showScenarioPanel = true;
    this.loading = false;
    this.rebuildChart();
  }

  get scenarioEnabled(): boolean {
    return !this.isTile && this.design['scenarioParametersEnabled'] === true;
  }

  advanced: AdvancedChartPayload | null = null;
  scoreValue(score: number | null | undefined): number { return score ?? -1; }
  scoreLabel(score: number | null | undefined): string { return score == null ? 'N/a' : String(score); }

  // Source behind the reliability score, used by the details popup.
  reliabilityTable: string | null = null;
  reliabilityViewId: number | null = null;
  showReliabilityDialog = false;
  reliabilityReturnSource: ReliabilitySource | null = null;

  openReliabilityDialog(): void {
    this.reliabilityReturnSource = null;
    this.showReliabilityDialog = true;
  }
  closeReliabilityDialog(): void {
    this.showReliabilityDialog = false;
    this.reliabilityReturnSource = null;
  }
  private readonly destroy$ = new Subject<void>();
  private readonly cancelGlobalFilter$ = new Subject<void>();
  chart: ChartSummary = { id: '', title: '', description: '', category: '', accent: 'purple', favorite: false };

  // Global filter row — cascading from PlantDescription table
  filterFields = [
    { key: 'country',      label: 'Country',       options: [] as string[] },
    { key: 'sector',       label: 'Sector',        options: [] as string[] },
    { key: 'businessUnit', label: 'Business Unit',  options: [] as string[] },
    { key: 'division',     label: 'Division',      options: [] as string[] },
    { key: 'cluster',      label: 'Cluster',       options: [] as string[] },
    { key: 'plant',        label: 'Plant',         options: [] as string[] },
  ];
  readonly quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After'];
  filterValues: Record<string, GlobalFilterSelection> = { country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All' };
  quickRange = ''; fromDate = ''; toDate = ''; pinned = false;
  trendMode: TrendMode = 'monthly';
  openLocalFilterId: number | null = null;
  // Bar/column "Switch Metrics": columns the viewer can switch between, and the active one.
  metricSwitchColumns: string[] = [];
  activeMetric = '';
  openMetricSwitch = false;

  setTrendMode(mode: TrendMode): void {
    if (this.trendMode === mode) return;
    this.trendMode = mode;
    this.loadTrendData();
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

  trendMenuOpen = false;

  toggleTrendMenu(e: Event): void {
    e.stopPropagation();
    this.trendMenuOpen = !this.trendMenuOpen;
  }

  selectTrendMode(mode: TrendMode): void {
    this.trendMenuOpen = false;
    this.setTrendMode(mode);
  }

  get isTrendChart(): boolean {
    return TREND_CHART_TYPES.has((this.design['chartType'] as string) ?? '');
  }
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
    if (hasGlobalSelection(this.filterValues[String(key)])) this.selectFilterOption(String(key), 'All');
  }
  private allPlants: PlantFilterDto[] = [];

  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const diff = (d.getDay() + 5) % 7;
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    this.fromDate = range.from;
    this.toDate = range.to;
    this.showDateRangePopup = false;
    this.onDateChange();
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

  onToDateChange(): void {
    this.onDateChange();
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

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    const index = this.filterFields.findIndex(field => field.key === name);
    if (index >= 0 && this.isGlobalFilterLocked(index)) return;
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  toggleScenarioPanel(): void {
    if (!this.scenarioEnabled) return;
    this.showScenarioPanel = !this.showScenarioPanel;
  }

  addScenarioItem(): void {
    this.scenarioItems = [{
      id: this.nextScenarioItemId++,
      name: 'Plan Adjustments',
      value: 0,
      target: '',
    }, ...this.scenarioItems];
    this.onScenarioChange();
  }

  get canRemoveScenarioParameter(): boolean {
    return this.scenarioItems.length + 1 + (this.showScenarioScheduleSlippage ? 1 : 0) > 1;
  }

  removeScenarioParameter(parameter: 'plan' | 'slippage' | number): void {
    if (!this.canRemoveScenarioParameter) return;
    if (parameter === 'plan') {
      this.scenarioPlanAdjustments = 0;
      this.scenarioPlanAdjustmentMode = 'percentage';
      this.scenarioCategoryTarget = '';
    } else if (parameter === 'slippage') {
      this.scenarioScheduleSlippage = 0;
    } else {
      this.scenarioItems = this.scenarioItems.filter(item => item.id !== parameter);
    }
    this.onScenarioChange();
  }

  get scenarioCategoryOptions(): string[] {
    if (this.scenarioUsesSeriesCategories) {
      const series = this.design['chartType'] === 'stacked' && this.design['showStackTotal'] !== false
        ? this.multiSeriesData.slice(0, -1) : this.multiSeriesData;
      const names = series.length
        ? series.map(series => series.name)
        : [this.scenarioSingleSeriesName];
      return [...new Set(names.filter(name => name.trim().length > 0))];
    }
    const chartCategories = this.categories.map(category => category.label).filter(Boolean);
    if (chartCategories.length) return [...new Set(chartCategories)];

    const xAxis = this.design['xAxis'] as string ?? '';
    if (!xAxis) return [];
    return [...new Set(this.filteredRows.map(row => safeString(row[xAxis])).filter(Boolean))];
  }

  private get scenarioUsesSeriesCategories(): boolean {
    if (this.scenarioHasPeriodAxis && this.scenarioTargetMode === 'period') return false;
    return usesSeriesCategoryColorRules(this.design['chartType'] as string, this.design['xAxis'] as string);
  }

  scenarioTargetMode: 'category' | 'period' = 'category';
  scenarioPlanAdjustmentMode: 'percentage' | 'absolute' = 'percentage';
  scenarioForecastError = '';
  scenarioForecastLabels: string[] = [];
  scenarioPredictionMessages: string[] = [];
  private scenarioMonthlyRows: Record<string, unknown>[] | null = null;
  private scenarioMonthlyRequested = false;
  private scenarioMonthlyLoading = false;
  private scenarioMonthlyError = '';
  private readonly cancelScenarioMonthly$ = new Subject<void>();

  get scenarioHasPeriodAxis(): boolean {
    return (this.design['xAxis'] as string | undefined)?.trim().toLowerCase() === 'period';
  }

  get showScenarioScheduleSlippage(): boolean {
    const chartType = this.design['chartType'];
    if (chartType === 'table' || isAdvancedChart(chartType)) return false;
    const xAxis = this.design['xAxis'] as string | undefined;
    return !!xAxis && hasScenarioDatePeriods(this.filteredRows.map(row => safeString(row[xAxis])),
      this.isTrendChart ? this.trendMode ?? 'monthly' : 1);
  }

  get scenarioAllTargetsLabel(): string {
    return this.scenarioHasPeriodAxis && this.scenarioTargetMode === 'period' ? 'All periods' : 'All categories';
  }

  onScenarioTargetModeChange(): void {
    this.scenarioCategoryTarget = '';
    for (const item of this.scenarioItems) item.target = '';
    this.onScenarioChange();
  }

  // Custom search + list dropdown shared by Target by / Apply to / Adjustment (replaces native <select>s).
  scenarioDropdownOpen: string | null = null;
  scenarioDropdownSearch = '';

  toggleScenarioDropdown(key: string, event: Event): void {
    event.stopPropagation();
    this.scenarioDropdownSearch = '';
    this.scenarioDropdownOpen = this.scenarioDropdownOpen === key ? null : key;
  }

  matchesScenarioSearch(label: string): boolean {
    const term = this.scenarioDropdownSearch.trim().toLowerCase();
    return !term || label.toLowerCase().includes(term);
  }

  filteredScenarioCategoryOptions(): string[] {
    return this.scenarioCategoryOptions.filter(option => this.matchesScenarioSearch(option));
  }

  selectScenarioTargetMode(mode: 'category' | 'period'): void {
    this.scenarioTargetMode = mode;
    this.scenarioDropdownOpen = null;
    this.onScenarioTargetModeChange();
  }

  selectScenarioItemTarget(item: { target: string }, value: string): void {
    item.target = value;
    this.scenarioDropdownOpen = null;
    this.onScenarioChange();
  }

  selectScenarioPlanTarget(value: string): void {
    this.scenarioCategoryTarget = value;
    this.scenarioDropdownOpen = null;
    this.onScenarioChange();
  }

  selectScenarioPlanAdjustmentMode(mode: 'percentage' | 'absolute'): void {
    this.scenarioPlanAdjustmentMode = mode;
    this.scenarioDropdownOpen = null;
    this.onScenarioChange();
  }

  private get scenarioSingleSeriesName(): string {
    return String(this.design['yAggColumn'] || this.design['yAxis'] || this.chart.title);
  }

  private scenarioPlanValue(value: number, target: string): number {
    const matches = !this.scenarioCategoryTarget || this.scenarioCategoryTarget === target;
    if (matches) {
      value = this.scenarioPlanAdjustmentMode === 'absolute'
        ? value + this.scenarioPlanAdjustments
        : value * (1 + this.scenarioPlanAdjustments / 100);
    }
    for (const item of this.scenarioItems) {
      if (!item.target || item.target === target) value *= 1 + item.value / 100;
    }
    return value;
  }

  private scenarioValue(value: number, target: string, predictedDelta = 0): number {
    value = this.scenarioPlanValue(value + predictedDelta, target);
    return this.round2(value);
  }

  resetScenarioParameters(): void {
    this.scenarioTargetMode = 'category';
    this.scenarioPlanAdjustmentMode = 'percentage';
    this.scenarioPlanAdjustments = 0;
    this.scenarioScheduleSlippage = 0;
    this.scenarioCategoryTarget = '';
    this.scenarioItems = [];
    this.applyScenarioPreview();
  }

  onScenarioChange(): void {
    this.applyScenarioPreview();
  }

  private applyScenarioPreview(): void {
    if (!this.showScenarioPanel || this.isTile) return;
    this.rebuildChart();
  }

  toggleLocalFilter(filterId: number, event: Event): void {
    event.stopPropagation();
    this.openLocalFilterId = this.openLocalFilterId === filterId ? null : filterId;
  }

  selectLocalFilter(filter: FilterControl, value: string): void {
    filter.value = value;
    this.openLocalFilterId = null;
    this.onFilterChange();
  }

  toggleMetricSwitch(event: Event): void {
    event.stopPropagation();
    this.openMetricSwitch = !this.openMetricSwitch;
  }

  switchMetric(col: string): void {
    this.openMetricSwitch = false;
    if (col === this.activeMetric) return;
    this.activeMetric = col;
    this.rebuildChart();
  }

  clearAllFilters(): void {
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
    this.filterValues = {
      country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
    };
    this.quickRange = '';
    const today = new Date();
    this.fromDate = `${today.getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(today);
    this.openFilterName = null;
    this.showDateRangePopup = false;
    this.autoSelectSingleOptions();
    this.rebuildGlobalFilterOptions();
    this.applyGlobalFilter();
  }

  selectFilterOption(name: string, value: string): void {
    if (name === 'quickRange') {
      this.quickRange = value;
      this.applyQuickRange(value);
      this.onDateChange();
    }
    else {
      const index = this.filterFields.findIndex(field => field.key === name);
      if (this.isGlobalFilterLocked(index)) return;
      this.filterValues[name] = value === 'All'
        ? 'All'
        : toggleGlobalSelection(this.filterValues[name] ?? 'All', value, this.filterFields.find(field => field.key === name)?.options, this.globalFilterClear.consume(name));
      const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
      const idx = hierarchy.indexOf(name);
      for (let i = idx + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
      // When the user explicitly picks "All" for cluster/plant, suppress the single-option
      // auto-select so the reset back to All actually sticks.
      const resetToAll = !hasGlobalSelection(this.filterValues[name]);
      this.rebuildGlobalFilterOptions(
        resetToAll && name === 'cluster',
        resetToAll && (name === 'cluster' || name === 'plant'),
      );
      this.openFilterName = null;
      this.applyGlobalFilter();
      return;
    }
    this.openFilterName = null;
  }

  isGlobalFilterLocked(index: number): boolean {
    return !this.isAdmin && (this.filterFields[index]?.options.length ?? 0) <= 1;
  }

  globalSelectionLabel(selection: GlobalFilterSelection | null | undefined): string {
    return globalSelectionLabel(selection);
  }

  hasSelectedGlobalFilter(name: string): boolean {
    return hasGlobalSelection(this.filterValues[name]);
  }

  isGlobalFilterOptionSelected(name: string, option: string): boolean {
    return isGlobalFilterOptionChecked(this.filterValues[name], option);
  }

  /** Global hierarchy filters (country/sector/.../cluster/plant), formatted for the
   *  view's DECLARE @placeholder overrides so trend requests honor them too.
   *  WidgetService remaps table-source hierarchy filters to matching source columns.
   *  sourceTable is set to the key itself (not the chart source) since the backend matches
   *  placeholders by Label/SourceColumn first, and the chart source name may contain spaces
   *  or other characters that fail the strict SourceTable identifier validation. */
  private advancedFilters: (WidgetDataFilter & { label: string })[] = [];
  @ViewChild('advancedFilter') protected advancedFilterRef?: AdvancedFilterComponent;

  private globalHierarchyFilterPayload(isView = !!this.viewIdForPreview): (WidgetDataFilter & { label: string })[] {
    const columns: Record<string, string> = {
      country: 'country', sector: 'sector', businessUnit: 'business_unit', division: 'division',
      cluster: 'cluster', plant: 'plant_description',
    };
    return [...Object.entries(columns)
      .filter(([key]) => hasGlobalSelection(this.filterValues[key]))
      .map(([key, column]) => ({
        globalHierarchy: true,
        sourceTable: column,
        sourceColumn: column,
        ...globalSelectionPayload(this.filterValues[key]),
        label: column,
      })), ...(isView ? this.advancedFilters ?? [] : [])];
  }


  private tableHierarchyFilterPayload(source: string, columns: string[]): ReturnType<WidgetViewComponent['globalHierarchyFilterPayload']> {
    const normalize = (value: string) => value.toLowerCase().replace(/[\s_]/g, '');
    return this.globalHierarchyFilterPayload().filter(filter => !filter.advancedHierarchy).flatMap(filter => {
      const key = normalize(filter.sourceColumn);
      const column = columns.find(candidate => normalize(candidate) === key)
        ?? (key === 'cluster' || key === 'plant' ? columns.find(candidate => normalize(candidate).includes(key)) : undefined);
      return column ? [{ ...filter, sourceTable: source, sourceColumn: column }] : [];
    });
  }

  private applyGlobalFilter(): void {
    this.cancelGlobalFilter$.next();
    if (this.isTrendChart) {
      this.loadTrendData();
      return;
    }
    if (!this.isTile && this.viewIdForPreview && this.viewSql) {
      this.loadViewChartData();
      return;
    }
    if (this.viewSql && this.viewConnectionId) {
      this.loading = true;
      this.cdr.markForCheck();
      const sql = this.injectDateParams(this.viewSql);
      this.commonApi.previewView({
        connectionId: this.viewConnectionId,
        sql,
        viewId: this.viewIdForPreview,
        maxRows: 1000,
        filters: this.globalHierarchyFilterPayload(),
      }).pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.applyLoadedData(res.columns ?? [], res.rows ?? []);
          this.reapplyActiveLocalFilters();
          if (this.isTile) {
            this.refreshTileValue(this.filteredRows);
            this.hydrateBreakdownValues(this.breakdownRows, this.breakdownDefs);
          } else { this.rebuildChart(); this.reloadInlineTilesForGlobal(); }
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Failed to reload view data with the selected filters.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
    } else if (this.isTile) {
      // Table tiles compute their value (and breakdown) directly with the global filter applied.
      this.refreshTileValue(this.filteredRows);
      this.hydrateBreakdownValues(this.breakdownRows, this.breakdownDefs);
      this.cdr.markForCheck();
    } else {
      const source = this.savedWidget?.source ?? (this.design['source'] as string ?? '');
      const sourceType = this.savedWidget?.sourceType ?? (this.design['sourceType'] as string ?? 'Table');
      const globals = this.globalHierarchyFilterPayload();
      if (source && sourceType.toLowerCase() !== 'import') {
        this.loading = true;
        this.cdr.markForCheck();
        this.widgetService.getFilteredChartData({
          chartSource: source,
          chartSourceType: sourceType,
          viewId: this.viewIdForPreview || this.savedWidget?.sourceId || (this.design['viewId'] as number | undefined) || null,
          // dev's global hierarchy (view SQL / column-match) + our FK Cluster/Plant for code-based tables.
          filters: [...this.savedInteractiveFilterPayload(source), ...globals,
            ...tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant'])],
          fromDate: this.fromDate || undefined,
          toDate: this.toDate || undefined,
        }).pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$)).subscribe({
          next: res => {
            const transformed = applyParameterFilters(
              res.rows ?? [], getSavedParameterFilters(this.design), res.columns ?? [],
            );
            this.allRows = transformed.rows;
            this.tableColumns = transformed.columns;
            this.filteredRows = this.globalFilteredBaseRows();
            this.reapplyActiveLocalFilters();
            if (this.isTile) this.refreshTileValue(this.filteredRows);
            else { this.rebuildChart(); this.reloadInlineTilesForGlobal(); }
            this.loading = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.loading = false;
            this.error = 'Failed to reload data with the selected filters.';
            this.cdr.markForCheck();
          },
        });
        return;
      }
      const process = () => {
        this.filteredRows = this.globalFilteredBaseRows();
        this.reapplyActiveLocalFilters();
        if (this.isTile) {
          this.refreshTileValue(this.filteredRows);
          this.hydrateBreakdownValues(this.breakdownRows, this.breakdownDefs);
        } else { this.rebuildChart(); }
        this.cdr.markForCheck();
      };
      // Table tiles read their value from the aggregate API (global filter ignored for now); view
      // tiles already have their rows loaded, so just re-apply the filters over them.
      process();
    }
  }

  /** Narrows `allRows` by any global hierarchy selections not already applied by the source query. */
  private globalFilteredBaseRows(): Record<string, unknown>[] {
    return this.filterRowsByGlobalHierarchy(this.allRows);
  }

  /** Keep only rows matching the active global hierarchy selections. */
  private filterRowsByGlobalHierarchy(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const columns: Record<string, string[]> = {
      country: ['country'], sector: ['sector'], businessUnit: ['business_unit', 'businessunit'],
      division: ['division'], cluster: ['cluster'], plant: ['plant_description', 'plantdescription', 'plant'],
    };
    return rows.filter(row => Object.entries(columns).every(([key, names]) => {
      const selection = this.filterValues[key];
      if (!hasGlobalSelection(selection)) return true;
      const normalizedNames = names.map(name => name.replace(/[_\s-]/g, '').toLowerCase());
      const column = Object.keys(row).find(name => normalizedNames.includes(name.replace(/[_\s-]/g, '').toLowerCase()));
      return !column || matchesGlobalSelection(row[column], selection);
    }));
  }

  /** Inline tiles on a chart re-aggregate with the global Cluster/Plant when it changes. */
  private reloadInlineTilesForGlobal(): void {
    const tileIds = (this.design['attachedTileIds'] as number[]) ?? [];
    if (tileIds.length && !this.isTile) { this.inlineTiles = []; this.loadInlineTiles(tileIds); }
  }

  /** Re-filter filteredRows by any active local (interactive) filters. */
  private reapplyActiveLocalFilters(): void {
    for (const f of this.filters) {
      if (!f.value || f.controlType === 'MultiSelect') continue;
      const col = Object.keys(this.filteredRows[0] ?? {}).find(k => k.toLowerCase() === f.sourceColumn.toLowerCase());
      if (col) this.filteredRows = this.filteredRows.filter(r => String(r[col]).toLowerCase() === f.value.toLowerCase());
    }
    this.filteredRows = this.applyMultiLocalFilters(this.filteredRows);
  }

  /** Keep only rows whose column value is one of the selected MultiSelect values (include-only). */
  private applyMultiLocalFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let out = rows;
    for (const f of this.filters) {
      if (f.controlType !== 'MultiSelect') continue;
      if (f.operator) {
        out = applyConditionalFilters(out, [{
          sourceColumn: f.sourceColumn,
          operator: f.operator,
          valueText: f.valueText,
          mode: f.mode,
          values: f.values ?? [],
        }]);
        continue;
      }
      if (!f.values?.length) continue;
      const set = new Set(f.values.map(v => v.toLowerCase()));
      out = out.filter(r => set.has(this.rowVal(r, f.sourceColumn).toLowerCase()));
    }
    return out;
  }

  isLocalMultiChecked(filter: FilterControl, option: string): boolean {
    return (filter.values ?? []).includes(option);
  }

  toggleLocalMultiValue(filter: FilterControl, option: string): void {
    const cur = filter.values ?? [];
    filter.values = cur.includes(option) ? cur.filter(v => v !== option) : [...cur, option];
    this.onFilterChange();
  }

  localMultiSummary(filter: FilterControl): string {
    const n = (filter.values ?? []).length;
    return n ? `${n} selected` : 'All';
  }

  areAllLocalMultiSelected(filter: FilterControl): boolean {
    const options = this.getFilterOptions(filter);
    const selected = filter.values ?? [];
    return options.length > 0 && options.every(option => selected.includes(option));
  }

  toggleAllLocalMultiValues(filter: FilterControl): void {
    const options = this.getFilterOptions(filter);
    filter.values = this.areAllLocalMultiSelected(filter) ? [] : [...options];
    this.onFilterChange();
  }

  private loadGlobalFilters(): void {
    this.commonApi.getPlantFilters().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe(plants => {
      this.allPlants = plants;
      this.filterFields[0].options = this.distinctPlant(plants, p => p.country);
      this.autoSelectSingleOptions();
      this.rebuildGlobalFilterOptions();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingleOptions(): void {
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    const fields = this.filterFields;
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const selectors: ((p: PlantFilterDto) => string)[] = [p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription];

    if (fields[0].options.length === 1) this.filterValues['country'] = fields[0].options[0];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(p => matchesGlobalSelection(selectors[i](p), this.filterValues[keys[i]]));
      const opts = this.distinctPlant(filtered, selectors[i + 1]);
      fields[i + 1].options = active(this.filterValues[keys[i]]) ? opts : [];
      if (opts.length === 1 && active(this.filterValues[keys[i]])) this.filterValues[keys[i + 1]] = opts[0];
    }
  }

  private rebuildGlobalFilterOptions(suppressAutoCluster = false, suppressAutoPlant = false): void {
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    let filtered = this.allPlants;
    if (active(this.filterValues['country'])) filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.filterValues['country']));
    this.filterFields[1].options = active(this.filterValues['country']) ? this.distinctPlant(filtered, p => p.sector) : [];
    // A country with a single sector/business unit/division should cascade automatically, otherwise cluster never gets populated.
    if (!active(this.filterValues['sector']) && this.filterFields[1].options.length === 1) this.filterValues['sector'] = this.filterFields[1].options[0];
    if (active(this.filterValues['sector'])) filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.filterValues['sector']));
    this.filterFields[2].options = active(this.filterValues['sector']) ? this.distinctPlant(filtered, p => p.businessUnit) : [];
    if (!active(this.filterValues['businessUnit']) && this.filterFields[2].options.length === 1) this.filterValues['businessUnit'] = this.filterFields[2].options[0];
    if (active(this.filterValues['businessUnit'])) filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.filterValues['businessUnit']));
    this.filterFields[3].options = active(this.filterValues['businessUnit']) ? this.distinctPlant(filtered, p => p.division) : [];
    if (!active(this.filterValues['division']) && this.filterFields[3].options.length === 1) this.filterValues['division'] = this.filterFields[3].options[0];
    if (active(this.filterValues['division'])) filtered = filtered.filter(p => matchesGlobalSelection(p.division, this.filterValues['division']));
    this.filterFields[4].options = active(this.filterValues['division']) ? this.distinctPlant(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    // Skip when the user explicitly reset to "All", otherwise the reset can never stick.
    if (!suppressAutoCluster && !active(this.filterValues['cluster']) && this.filterFields[4].options.length === 1) this.filterValues['cluster'] = this.filterFields[4].options[0];
    if (active(this.filterValues['cluster'])) filtered = filtered.filter(p => matchesGlobalSelection(p.cluster, this.filterValues['cluster']));
    this.filterFields[5].options = this.distinctPlant(filtered, p => p.plantDescription);
    if (!suppressAutoPlant && !active(this.filterValues['plant']) && this.filterFields[5].options.length === 1) this.filterValues['plant'] = this.filterFields[5].options[0];
  }

  private distinctPlant(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }
  // Stored view SQL + connection for re-execution when dates change
  private viewSql = '';
  private viewConnectionId = 0;
  private viewIdForPreview = 0;
  /** True when the view SQL contains DECLARE @...DATE variables */
  hasDateParams = false;
  filters: FilterControl[] = [];

  /** Filters rendered as controls; hidden conditional filters are applied silently. */
  get visibleFilters(): FilterControl[] { return this.filters.filter(f => !f.hidden); }
  loading = true; error = '';
  savedWidget: Widget | null = null; isPublished = false;
  showFilterPanel: boolean = true;
  showScenarioPanel = false;
  scenarioItems: ScenarioItem[] = [];
  private nextScenarioItemId = 1;
  scenarioCategoryTarget = '';
  scenarioPlanAdjustments = 0;
  scenarioScheduleSlippage = 0;
  readonly isPublishing = signal(false);
  readonly isDeleting = signal(false);
  showDeleteConfirm = false;
  design: Record<string, unknown> = {}; widgetType = 'chart';
  readonly legendLayoutClass = legendLayoutClass;
  get legendPosition(): LegendPosition { return readLegendPosition(this.design); }
  get isTile(): boolean { return this.widgetType === 'tile'; }
  // Optional tile icon + value font styling (default: icon shown, no extra styling) so existing tiles are unchanged.
  get tileShowIcon(): boolean { return this.design['showTileIcon'] !== false; }
  get tileLayout(): TileLayout { return resolveTileLayout(this.design['tileLayout']); }
  get tileValueBold(): boolean { return this.design['valueBold'] === true; }
  get tileValueItalic(): boolean { return this.design['valueItalic'] === true; }
  get tileValueColor(): string { return (this.design['valueColor'] as string) || ''; }
  get pageTitle(): string { return this.isTile ? 'Tile Details' : 'Chart Details'; }
  get isAdmin(): boolean { return this.authService.isAdmin(); }
  /** Same rule as the WIP list menus: modify permission on the module, never a published item. */
  get canEditWidget(): boolean {
    return !!this.savedWidget && !this.isPublished
      && this.permissionService.canModify(this.isTile ? 'charts.wip-tiles' : 'charts.wip-charts');
  }
  get isOwner(): boolean { return !!this.savedWidget && this.savedWidget.createdBy === this.authService.getCurrentUser()?.userId; }
  get isWipDetailContext(): boolean { return this.route.snapshot.queryParamMap.get('from') === 'wip'; }
  get isStandardDetailContext(): boolean { return this.route.snapshot.queryParamMap.get('from') === 'standard' || (!this.isWipDetailContext && this.isPublished); }
  get canUnpublishWidget(): boolean { return this.isAdmin && this.isPublished && this.isStandardDetailContext; }

  get parentRoute(): string {
    if (this.isTile) return this.isStandardDetailContext ? '/charts-tiles/standard-tiles' : '/charts-tiles/wip-tiles';
    return this.isStandardDetailContext ? '/charts-tiles/standard-charts' : '/charts-tiles/wip-charts';
  }

  get viewBreadcrumbs() {
    let parentLabel: string;
    const wipLabel = this.isAdmin ? 'WIP' : 'My';
    if (this.isTile) parentLabel = this.isStandardDetailContext ? 'Standard Tiles' : `${wipLabel} Tiles`;
    else parentLabel = this.isStandardDetailContext ? 'Standard Charts' : `${wipLabel} Charts`;
    return [
      { label: 'Charts & Tiles', route: '/charts-tiles' },
      { label: parentLabel, route: this.parentRoute },
      { label: this.chart.title },
    ];
  }
  private allRows: Record<string, unknown>[] = [];
  // Stable row snapshot for computing local-filter dropdown options. Trend charts filter
  // server-side, so allRows shrinks (or empties) with the selection — this must not.
  private optionSourceRows: Record<string, unknown>[] = [];
  filteredRows: Record<string, unknown>[] = []; tableColumns: string[] = [];
  inlineTiles: { id: number; label: string; value: string; color: string; icon: string; tileLayout?: TileLayout; drillDownViewId?: number | null; showIcon?: boolean; valueBold?: boolean; valueItalic?: boolean; valueColor?: string; breakdown: { label: string; value: string; color: string }[] }[] = [];
  tileValue: number | null = null; tileColor = 'blue'; tileLabel = '';

  get selectableMeasures() { return getSelectableDaxMeasures(this.design['daxModel'] as DaxModelConfig); }

  get selectedMetricId(): string | null {
    const model = this.design['daxModel'] as DaxModelConfig;
    return model?.viewerMeasureId ?? (this.isTile ? model?.selectedMeasureId ?? null : null);
  }

  selectViewerMeasure(id: string | null): void {
    this.design = { ...this.design, daxModel: withViewerMeasure(this.design['daxModel'] as DaxModelConfig, id) };
    if (this.isTile) this.refreshTileValue(this.filteredRows); else this.rebuildChart();
  }
  tileIcon = 'well';
  tilePrefix = ''; tileSuffix = '';
  badgeText = ''; badgeColor = 'none';
  breakdownRows: { label: string; value: string; color: string }[] = [];
  private breakdownDefs: any[] = [];
  get formattedTileValue(): string {
    if (this.tileValue === null) return '—';
    if (!Number.isFinite(this.tileValue)) return 'DAX error';
    const model = this.design['daxModel'] as DaxModelConfig;
    if (model?.enabled) return formatDaxValue(this.tileValue, getSelectedDaxMeasure(model));
    const places = (this.design['decimalPlaces'] as number) ?? 0;
    const shorten = (this.design['shortenBigNumbers'] as boolean) ?? false;
    const v = this.tileValue;
    if (shorten && v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (shorten && v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toFixed(places);
  }
  categories: WidgetCategory[] = []; selectedCategory: string | null = null; selectedCategory2: string | null = null;

  /** Histogram legends list its bins (the X-axis categories are the source rows, not the bins). */
  get legendCategories(): WidgetCategory[] {
    // Scatter points are rows, not categories; its legend is the Category series (multiSeriesData).
    if (this.design['chartType'] === 'scatter') return [];
    if (this.design['chartType'] !== 'histogram') return this.categories;
    const points = ((this.chartOptions.series?.[0] as { data?: { id?: string; y?: number; color?: string }[] })?.data ?? []);
    return points.map(point => ({ key: point.id ?? '', label: point.id ?? '', value: point.y ?? 0, color: point.color ?? COLORS[0] }));
  }
  private baseCategories: WidgetCategory[] = [];
  multiSeriesData: { name: string; data: number[]; color: string }[] = [];
  tableDisplayRows: { category: string; values: unknown[]; color: string }[] = [];
  /** Source record behind each displayed table row, for the table's drill to detail. */
  tableRecords: Record<string, unknown>[] = [];
  get savedTableGrid(): Partial<TableGridOptions> | null { return (this.design['tableGrid'] as Partial<TableGridOptions> | undefined) ?? null; }
  chartViewOptions: ChartView[] = ['donut', 'table'];
  chartView: ChartView = 'donut'; chartViewMenuOpen = false;
  viewTab: 'chart' | 'table' = 'chart';
  chartView2: ChartView = 'donut'; chartViewMenuOpen2 = false;
  chartVisible = true;
  readonly chartSizes: ChartSize[] = ['S', 'M', 'L'];
  chartSize: ChartSize = 'S'; isExpanded = false;
  chartSize2: ChartSize = 'S'; isExpanded2 = false;
  chartOptions: Highcharts.Options = {};

  private readonly wvRowBgColors  = ['#F3F6FF', '#EBFFF2', '#FFFAF1', '#FFF1F1', '#E8F8FF'];
  getWvRowBg(i: number): string  { return this.wvRowBgColors[i  % this.wvRowBgColors.length]; }
  chartOptions2: Highcharts.Options = {};

  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  private _prevSidebarState = false;

  constructor(
    private readonly route: ActivatedRoute, private readonly router: Router,
    private readonly location: Location, private readonly widgetService: WidgetService,
    private readonly authService: AuthService, private readonly permissionService: PermissionService,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef, private readonly toastService: ToastService,
    private readonly layoutState: LayoutStateService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  ngOnDestroy(): void {
    if (!this.scenarioBuilderPreview) {
      this.layoutState.expand();
      this.layoutState.setActiveNavOverride(null);
    }
    this.chartResizeObserver?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    if (this.scenarioBuilderPreview) return;
    this.reliabilityReturnSource = consumeReliabilityReturn(this.router, this.location);
    if (this.reliabilityReturnSource) this.showReliabilityDialog = true;
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();
    // Show the save toast on this detail page (the landing page after Save & Close) instead of
    // deferring it to whichever list route is opened next.
    const pendingToast = this.toastService.consume();
    if (pendingToast) this.notify.showSuccess(pendingToast);
    this.fromDate = `${new Date().getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(new Date());
    this.loadGlobalFilters();
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.error = 'Invalid widget ID'; this.loading = false; return; }
    // Pre-set from the caller's query param so the heading is correct while the widget is still loading.
    const typeParam = this.route.snapshot.queryParamMap.get('type');
    if (typeParam === 'tile' || typeParam === 'chart') this.widgetType = typeParam;
    this.widgetService.getWidgetById(id).subscribe({
      next: (widget) => {
        this.savedWidget = widget; this.isPublished = widget.status === 'published';
        this.widgetType = widget.type?.toLowerCase() ?? 'chart';
        this.layoutState.setActiveNavOverride(this.parentRoute);

        // Track this view (ControlTypeId: 2=Chart, 3=Tile)
        const ctrlType = this.widgetType === 'tile' ? 3 : 2;
        this.widgetService.trackView(ctrlType, widget.id).subscribe({ error: () => {} });

        try { this.design = JSON.parse(widget.designJson ?? '{}'); } catch { /* ignore */ }
        const params = this.route.snapshot.queryParamMap;
        this.chart = { id: String(widget.id), title: appendLockedFilterTitle(params.get('title') ?? widget.name, this.design),
          description: params.get('description') ?? (this.design['description'] as string ?? ''),
          category: params.get('category') ?? widget.categoryName ?? '',
          accent: (params.get('accent') as ChartAccent) ?? 'purple', favorite: params.get('favorite') === 'true' };
        // Fetch the real favourite state after `chart` is built so it isn't clobbered by the assignment above.
        this.widgetService.getFavourites(ctrlType).subscribe({
          next: (prefs) => { this.chart.favorite = prefs.some(p => p.controlId === widget.id); this.cdr.markForCheck(); },
          error: () => { /* suppress */ },
        });
        this.tileColor = (this.design['tileColor'] as string) ?? 'blue';
        this.tileLabel = (this.design['label'] as string) || widget.name;
        this.tileIcon  = (this.design['tileIcon'] as string) ?? 'well';
        this.tilePrefix = (this.design['prefix'] as string) ?? '';
        this.tileSuffix = (this.design['suffix'] as string) ?? '';
        this.badgeText  = (this.design['badgeText'] as string) ?? '';
        this.badgeColor = (this.design['badgeColor'] as string) ?? 'none';
        const breakdownDefs = (this.design['breakdownRows'] as any[]) ?? [];
        this.breakdownDefs = breakdownDefs;
        this.breakdownRows = breakdownDefs.map(r => ({ label: r.label, value: r.value, color: r.color }));
        this.hydrateBreakdownValues(this.breakdownRows, breakdownDefs);

        // Set chart view to match the created chart type
        const createdType = (this.design['chartType'] as string | undefined);
        this.trendMode = (this.design['trendMode'] as TrendMode) ?? 'monthly';
        const mappedView = designTypeToChartView(createdType);
        this.chartViewOptions = this.computeChartViewOptions(mappedView);
        this.chartView = mappedView;
        this.chartView2 = mappedView;
        const rawFilters = (this.design['interactiveFilters'] as any[]) ?? [];
        this.filters = rawFilters.filter((f: any) => f.sourceColumn && f.controlType).map((f: any) => ({
          id: f.id, label: f.label || f.sourceColumn, controlType: f.controlType, sourceTable: f.sourceTable ?? '', sourceColumn: f.sourceColumn,
          value: f.locked ? (f.lockedValue ?? '') : '', values: f.locked ? [...(f.lockedValues ?? [])] : [],
          dateFrom: '', dateTo: '', options: [], hidden: !!f.hidden, locked: !!f.locked }));
        const rawConditional = (this.design['conditionalFilters'] as any[]) ?? [];
        this.filters.push(...rawConditional.filter((f: any) => f.sourceColumn).map((f: any) => ({
          id: f.id, label: f.label || f.sourceColumn, controlType: 'MultiSelect', sourceTable: f.sourceTable ?? '',
          sourceColumn: f.sourceColumn, value: '', values: [...(f.values ?? [])], dateFrom: '', dateTo: '', options: [],
          hidden: !!f.hidden, operator: f.operator || 'equals', valueText: f.valueText ?? '', mode: f.mode || 'Include' })));
        const source = widget.source ?? (this.design['source'] as string ?? '');
        const sourceType = widget.sourceType ?? (this.design['sourceType'] as string ?? 'Table');
          const configuredViewId = Number(this.design['viewId']);
          const widgetViewId = Number(widget.sourceId);
          const viewId = this.design['dataSourceMode'] === 'view' && configuredViewId > 0
            ? configuredViewId
            : widgetViewId > 0 ? widgetViewId : configuredViewId > 0 ? configuredViewId : undefined;
          const isViewSource = sourceType.toLowerCase() === 'view' ||
            this.design['dataSourceMode'] === 'view' ||
            (viewId != null && sourceType.toLowerCase() !== 'import');
        if (sourceType.toLowerCase() === 'import') {
          if (typeof this.design['fromDate'] === 'string') this.fromDate = this.design['fromDate'];
          if (typeof this.design['toDate'] === 'string') this.toDate = this.design['toDate'];
          if (typeof this.design['quickRange'] === 'string') this.quickRange = this.design['quickRange'];
        }
        if (!source) { this.loading = false; this.cdr.markForCheck(); return; }

        if (sourceType.toLowerCase() === 'table') {
          this.reliabilityTable = source;
          this.commonApi.getTableReliability(sourceType ? source : '').subscribe({
            next: reliability => {
              this.chart.score = reliability.reliability;
              this.chart.reliabilityBreakdown = reliability.reliability_breakdown;
              this.cdr.markForCheck();
            },
          });
        }

        // View source with sourceId → fetch view details then preview with generatedSql
        if (isViewSource && viewId) {
          this.reliabilityViewId = viewId;
          // Dropdown options from another table don't depend on the chart data: fetch them now
          // rather than after the data arrives (DFCT0010633 — each hop was ~1 s on QA).
          this.prefetchForeignFilterOptions(source);
          // Attached tiles don't need the chart's rows either: start them now instead of after
          // the view data (on a slow view that was the whole wait again). applyLoadedData skips
          // its own tile reload once for this primed load.
          const primedTileIds = (this.design['attachedTileIds'] as number[]) ?? [];
          if (primedTileIds.length) {
            this.toDate = this.lastTuesday(new Date());
            this.tilesPrimed = true;
            this.inlineTiles = [];
            this.loadInlineTiles(primedTileIds);
          }
          const onData = {
            next: (res: { columns?: string[]; rows?: Record<string, unknown>[] }) => this.applyLoadedData(res.columns ?? [], res.rows ?? []),
            error: () => { this.error = 'Failed to load view data.'; this.loading = false; this.cdr.markForCheck(); },
          };
          const isTrend = TREND_CHART_TYPES.has(createdType ?? '');
          this.commonApi.getDatabaseViewById(viewId).subscribe({
            next: (view) => {
              this.chart.score = view.reliability;
              this.chart.reliabilityBreakdown = view.reliability_breakdown;
              this.viewSql = view.generatedSql;
              this.viewConnectionId = view.connectionId;
              this.viewIdForPreview = view.id;
              this.initDateParamsFromSql(view.generatedSql);
              if (isTrend) {
                this.loadTrendData();
                return;
              }
              if (!this.isTile) {
                this.loadViewChartData();
                return;
              }
              this.commonApi.previewView({
                connectionId: view.connectionId,
                sql: this.hasDateParams ? this.injectDateParams(view.generatedSql) : view.generatedSql,
                viewId: view.id,
                maxRows: 1000,
                filters: this.globalHierarchyFilterPayload(),
              }).subscribe(onData);
            },
            error: () => { this.error = 'Failed to load view details.'; this.loading = false; this.cdr.markForCheck(); },
          });
        } else if (this.isTile && sourceType.toLowerCase() === 'table') {
          // Table tiles always read their value from the aggregate API (correct on huge tables).
          // Filtered table tiles also aggregate on the server, never over capped preview rows.
          this.allRows = []; this.filteredRows = []; this.tableColumns = [];
          this.optionSourceRows = [];
          this.refreshTileValue([]);
          this.inlineTiles = [];
          const tileIds = (this.design['attachedTileIds'] as number[]) ?? [];
          if (tileIds.length) this.loadInlineTiles(tileIds, () => { this.loading = false; this.cdr.markForCheck(); });
          else this.loading = false;
          this.cdr.markForCheck();
        } else {
          // Import datasets aren't real SQL tables/views — the cross-table filtered-chart-data
          // endpoint 404s trying to resolve their schema, so fetch them directly instead.
          const data$ = sourceType.toLowerCase() === 'import'
            ? this.widgetService.getTableData(source, sourceType)
            : this.widgetService.getFilteredChartData({
                chartSource: source,
                chartSourceType: sourceType,
                viewId: null,
                filters: [
                  ...this.savedInteractiveFilterPayload(source),
                  ...(sourceType.toLowerCase() === 'import' ? [] : this.globalHierarchyFilterPayload()),
                  ...tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant']),
                ],
                fromDate: this.fromDate || undefined,
                toDate: this.toDate || undefined,
              });
          data$.subscribe({
            next: (res) => this.applyLoadedData(res.columns ?? [], res.rows ?? []),
            error: () => { this.error = 'Failed to load data.'; this.loading = false; this.cdr.markForCheck(); },
          });
        }
      },
      error: () => { this.error = 'Failed to load widget.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private loadTrendData(): void {
    this.cancelScenarioMonthly$.next();
    this.scenarioMonthlyRows = null;
    this.scenarioMonthlyRequested = false;
    this.scenarioMonthlyLoading = false;
    this.scenarioMonthlyError = '';
    const request = this.trendDataRequest(this.trendMode);
    if (!request) return;
    this.loading = true;
    this.widgetService.getFilteredChartData(request)
      .pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$))
      .subscribe({
        next: res => this.applyLoadedData(res.columns ?? [], res.rows ?? []),
        error: () => { this.error = 'Failed to load trend data.'; this.loading = false; this.cdr.markForCheck(); },
      });
  }

  private viewChartDataRequest() {
    const chartSource = (this.design['source'] as string) || this.savedWidget?.source || '';
    const dates = getViewDateRangeDefaults(this.viewSql);
    return {
      chartSource,
      chartSourceType: 'View',
      viewId: this.viewIdForPreview,
      filters: [
        ...this.savedInteractiveFilterPayload(chartSource, true),
        ...this.globalHierarchyFilterPayload(),
      ],
      fromDate: dates.hasStartDate && this.fromDate ? this.fromDate : undefined,
      toDate: (dates.hasEndDate || dates.hasFutureDate) && this.toDate ? this.toDate : undefined,
      mode: undefined,
    };
  }

  private loadViewChartData(): void {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.widgetService.getFilteredChartData(this.viewChartDataRequest())
      .pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.applyLoadedData(res.columns ?? [], res.rows ?? [], true);
        },
        error: () => {
          this.error = 'Failed to load chart data with the selected filters.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  private trendDataRequest(mode: TrendMode) {
    const source = this.savedWidget?.source ?? (this.design['source'] as string ?? '');
    const sourceType = this.savedWidget?.sourceType ?? (this.design['sourceType'] as string ?? 'View');
    const viewId = this.viewIdForPreview || (this.design['viewId'] as number | undefined) || this.savedWidget?.sourceId || null;
    if (!source || !viewId) return null;
    return {
      chartSource: source,
      chartSourceType: sourceType.toLowerCase() === 'view' ? 'View' : sourceType,
      viewId,
      filters: [
        ...this.filters.filter(filter => filter.value && !this.isRenamedLocalFilter(filter, source)).map(filter => ({
          sourceTable: filter.sourceTable || source,
          sourceColumn: filter.sourceColumn,
          controlType: filter.controlType,
          value: filter.value,
          label: filter.label,
        })),
        ...this.globalHierarchyFilterPayload(),
      ],
      mode,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined,
    };
  }

  private loadScenarioMonthlyHistory(): void {
    if (!this.isTrendChart || this.trendMode !== 'yearly' || this.scenarioMonthlyRequested
      || this.categories.length !== 1 || !this.scenarioForecastError.startsWith('At least two existing periods')) return;
    this.scenarioMonthlyRequested = true;
    const preview = this.scenarioBuilderPreview;
    const request = preview ? {
      chartSource: String(preview.design['source'] ?? ''),
      chartSourceType: String(preview.design['sourceType'] ?? 'Table'),
      viewId: (preview.design['viewId'] as number | null | undefined) ?? null,
      mode: 'monthly' as const,
      fromDate: preview.fromDate || undefined,
      toDate: preview.toDate || undefined,
      filters: [...preview.filters, ...preview.hierarchyFilters],
      reportFilters: preview.reportFilters,
    } : this.trendDataRequest('monthly');
    if (!request) {
      this.scenarioMonthlyError = 'Monthly history requires a saved view source to forecast a single year.';
      this.scenarioForecastError = this.scenarioMonthlyError;
      this.cdr.markForCheck();
      return;
    }
    this.scenarioMonthlyLoading = true;
    this.scenarioForecastError = 'Loading monthly history for the yearly forecast.';
    this.widgetService.getFilteredChartData(request)
      .pipe(takeUntil(this.cancelScenarioMonthly$), takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          const transformed = applyParameterFilters(res.rows ?? [], getSavedParameterFilters(this.design), res.columns ?? []);
          const requiredColumns = this.multiSeriesData.length
            ? this.multiSeriesData.filter(series => !(this.design['chartType'] === 'stacked'
              && this.design['showStackTotal'] !== false && series.name === 'Total')).map(series => series.name)
            : [String(this.design['yAggColumn'] || '')].filter(Boolean);
          if (requiredColumns.some(column => !transformed.columns.includes(column)
            || transformed.rows.some(row => row[column] == null || !Number.isFinite(Number(row[column]))))) {
            this.scenarioMonthlyError = 'Monthly history must contain finite numeric values for every plotted series.';
          }
          this.scenarioMonthlyRows = preview ? transformed.rows : this.applyRenamedInteractiveFilters(
            this.applyMultiLocalFilters(transformed.rows), request.chartSource);
          this.scenarioMonthlyLoading = false;
          this.rebuildChart();
          this.cdr.markForCheck();
        },
        error: () => {
          this.scenarioMonthlyLoading = false;
          this.scenarioMonthlyError = 'Failed to load monthly history for the yearly forecast. Change filters or reselect Yearly to retry.';
          this.rebuildChart();
          this.cdr.markForCheck();
        },
      });
  }

  private savedInteractiveFilterPayload(chartSource: string, lockedOnly = false) {
    return this.filters
      .filter(filter => (!lockedOnly || filter.locked) && filter.sourceColumn && (filter.value || (filter.values?.length ?? 0) > 0)
        && !this.isRenamedLocalFilter(filter, chartSource))
      .map(filter => ({
        sourceTable: filter.sourceTable || chartSource,
        sourceColumn: filter.sourceColumn,
        controlType: filter.controlType,
        value: filter.controlType === 'MultiSelect' ? (filter.values ?? []).join(',') : filter.value,
        values: filter.controlType === 'MultiSelect' ? [...(filter.values ?? [])] : undefined,
        label: filter.label,
      }));
  }

  private isRenamedLocalFilter(filter: { sourceTable: string; sourceColumn: string }, chartSource: string): boolean {
    return (!filter.sourceTable || filter.sourceTable === chartSource)
      && getRenamedColumnNames(getSavedParameterFilters(this.design)).includes(filter.sourceColumn);
  }

  private applyRenamedInteractiveFilters(rows: Record<string, unknown>[], chartSource: string): Record<string, unknown>[] {
    return this.filters.reduce((filtered, filter) => {
      if (!filter.value || filter.controlType === 'MultiSelect' || !this.isRenamedLocalFilter(filter, chartSource)) return filtered;
      return filtered.filter(row => this.rowVal(row, filter.sourceColumn).toLowerCase().includes(filter.value.toLowerCase()));
    }, rows);
  }

  private applyLoadedData(columns: string[], rows: Record<string, unknown>[], viewFiltersApplied = false): void {
    const paramFilters = getSavedParameterFilters(this.design);
    this.design = remapDesignColumns(this.design, paramFilters);
    const { rows: transformedRows, columns: transformedCols } = applyParameterFilters(rows, paramFilters, columns);
    this.allRows = transformedRows; this.tableColumns = transformedCols;
    // Only trend charts send local filters to the server, so only their response is pre-narrowed;
    // keep the last unfiltered dataset as the source for dropdown option lists.
    const responseIsLocallyFiltered = this.isTrendChart && this.filters.some(f =>
      (f.controlType === 'Dropdown' || f.controlType === 'MultiSelect') && !f.locked
      && (!!f.value || (f.values?.length ?? 0) > 0));
    if (!responseIsLocallyFiltered || this.optionSourceRows.length === 0) this.optionSourceRows = transformedRows;
    const chartSource = this.savedWidget?.source ?? (this.design['source'] as string ?? '');
    this.filters.forEach(f => {
      if (f.controlType !== 'Dropdown' && f.controlType !== 'MultiSelect') return;
      // Locked filters only ever offer their frozen selection — viewers can still open/re-pick
      // it, but can't widen the choice beyond what was locked in.
      if (f.locked) {
        f.options = f.controlType === 'MultiSelect' ? [...(f.values ?? [])] : (f.value ? [f.value] : []);
        return;
      }
      if (!f.sourceTable || f.sourceTable === chartSource) {
        f.options = this.getDropdownOptions(f.sourceColumn);
      } else if (!this.filterOptionsRequested.has(f.id)) {
        this.loadFilterOptionsFromSource(f);
      }
    });
    this.filteredRows = this.applyMultiLocalFilters(viewFiltersApplied ? this.globalFilteredBaseRows() : [...this.allRows]);
    if (viewFiltersApplied) this.reapplyActiveLocalFilters();
    if (this.isTrendChart) this.filteredRows = this.applyRenamedInteractiveFilters(this.filteredRows, chartSource);
    // Render immediately with the base dataset so the chart never disappears, then
    // narrow it further if a locked filter has a frozen selection (may be async).
    if (this.isTile) { this.refreshTileValue(this.filteredRows); } else { this.rebuildChart(); }
    const hasLockedActive = this.filters.some(f => f.locked && (f.value || (f.values?.length ?? 0) > 0));
    // Trend charts already send every active filter (locked or not) as part of the
    // loadTrendData() request itself, so re-invoking onFilterChange here would just
    // re-trigger loadTrendData() forever.
    if (hasLockedActive && !this.isTrendChart && !viewFiltersApplied) this.onFilterChange();
    const tileIds = (this.design['attachedTileIds'] as number[]) ?? [];
    if (this.tilesPrimed) {
      // Tiles were requested together with the view data; they fill in as they arrive.
      this.tilesPrimed = false;
      this.loading = false;
    } else if (tileIds.length) {
      this.inlineTiles = [];
      this.loadInlineTiles(tileIds, () => { this.loading = false; this.cdr.markForCheck(); });
    } else {
      this.loading = false;
    }
    this.cdr.markForCheck();
  }

  /** True while the first tile load (started alongside the view data) is still the current one. */
  private tilesPrimed = false;

  onFilterChange(): void {
    // Attached view tiles follow the chart's local filter change too.
    const attachedTileIds = (this.design['attachedTileIds'] as number[]) ?? [];
    if (attachedTileIds.length && this.inlineTiles.length) this.loadInlineTiles(attachedTileIds);
    // Trend charts only hold pre-aggregated (weekly/monthly/...) rows client-side, so any
    // interactive/cross-table filter must be re-applied server-side against the raw view SQL —
    // filtering `allRows` locally silently no-ops since the granular filter column isn't present
    // in the aggregated result set.
    if (this.isTrendChart) {
      this.loadTrendData();
      return;
    }

    const hasSingle = this.filters.some(f => f.value && f.controlType !== 'MultiSelect');
    const hasMulti = this.filters.some(f => f.controlType === 'MultiSelect' && (f.values?.length ?? 0) > 0);
    if (!hasSingle && !hasMulti) {
      this.filteredRows = [...this.allRows];
      if (this.isTile) { this.refreshTileValue(this.filteredRows); } else { this.rebuildChart(); }
      this.cdr.markForCheck();
      return;
    }

    const chartSource = this.savedWidget?.source ?? (this.design['source'] as string ?? '');
    const chartSourceType = this.savedWidget?.sourceType ?? (this.design['sourceType'] as string ?? 'Table');
    const singleActive = this.filters.filter(f => f.value && f.controlType !== 'MultiSelect');
    // Import datasets have no other real tables to cross-join against — the filtered-chart-data
    // endpoint would 404 trying to resolve them, so always filter locally for Import sources.
    const hasCrossTable = chartSourceType !== 'Import' && singleActive.some(f => f.sourceTable && f.sourceTable !== chartSource);

    if (hasCrossTable) {
      this.widgetService.getFilteredChartData({
        chartSource,
        chartSourceType,
        viewId: this.savedWidget?.sourceId ?? (this.design['viewId'] as number | undefined) ?? null,
        filters: [
          ...singleActive.filter(f => !this.isRenamedLocalFilter(f, chartSource)).map(f => ({
            sourceTable: f.sourceTable || chartSource,
            sourceColumn: f.sourceColumn,
            controlType: f.controlType,
            value: f.value,
            label: f.label,
          })),
          ...this.globalHierarchyFilterPayload(),
        ],
        ...(this.viewIdForPreview ? {
          fromDate: this.viewChartDataRequest().fromDate,
          toDate: this.viewChartDataRequest().toDate,
        } : {}),
      }).pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$)).subscribe({
        next: (res: { rows?: Record<string, unknown>[] }) => {
          const transformed = applyParameterFilters(res.rows ?? [], getSavedParameterFilters(this.design));
          this.filteredRows = this.applyMultiLocalFilters(this.applyRenamedInteractiveFilters(transformed.rows, chartSource));
          if (this.isTile) { this.refreshTileValue(this.filteredRows); } else { this.rebuildChart(); }
          this.cdr.markForCheck();
        },
        error: () => {
          this.error = 'Failed to apply cross-table filter.';
          this.cdr.markForCheck();
        },
      });
      return;
    }

    let rows = [...this.allRows];
    for (const f of this.filters) {
      const col = f.sourceColumn;
      if (f.controlType === 'MultiSelect') continue;
      if (f.controlType === 'Date') {
        if (f.value) rows = rows.filter(r => this.rowVal(r, col).startsWith(f.value));
      } else if (f.value) {
        rows = rows.filter(r => this.rowVal(r, col).toLowerCase().includes(f.value.toLowerCase()));
      }
    }
    rows = this.applyMultiLocalFilters(rows);
    this.filteredRows = rows;
    if (this.isTile) { this.refreshTileValue(rows); } else { this.rebuildChart(); }
    this.cdr.markForCheck();
  }

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.syncLocalFiltersWithAdvancedSelection(value.hierarchy);
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.applyGlobalFilter();
  }

  private syncLocalFiltersWithAdvancedSelection(hierarchy: Record<string, string[]>): void {
    const normalize = (column: string) => column.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const selections = Object.entries(hierarchy).map(([field, values]) => ({
      columns: advancedHierarchySourceColumns(field).map(normalize),
      values: [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))],
    })).filter(selection => selection.columns.length > 0);

    for (const filter of this.filters ?? []) {
      if (filter.locked || !filter.sourceColumn) continue;
      const sourceColumn = normalize(filter.sourceColumn);
      const selection = selections.find(item => item.columns.includes(sourceColumn));
      if (!selection) continue;

      if (filter.controlType === 'MultiSelect') {
        filter.values = [...selection.values];
      } else if (filter.controlType === 'Dropdown') {
        filter.value = selection.values.length === 1 ? selection.values[0] : '';
      }
    }
  }

  /** Extract default dates from the view's declared date parameters. */
  private initDateParamsFromSql(sql: string): void {
    const defaults = getViewDateRangeDefaults(sql);
    this.hasDateParams = defaults.hasStartDate || defaults.hasEndDate || defaults.hasFutureDate;

    if (defaults.hasFutureDate) {
      if (defaults.fromDate) this.fromDate = defaults.fromDate;
      this.toDate = defaults.toDate ?? this.lastTuesday(new Date());
      return;
    }
    if (this.isTile) {
      const startVal = /DECLARE\s+@start_date\s+\w+\s*=\s*'(\d{4}-\d{2}-\d{2})'/i.exec(sql);
      if (startVal) this.fromDate = startVal[1];
      this.toDate = this.lastTuesday(new Date());
    }
  }

  private readonly datePattern = /^\d{4}-\d{2}-\d{2}$/;
  private readonly safeValuePattern = /^[A-Za-z0-9\s\-_.,()]+$/;

  /** Replace or add DECLARE date variable values in SQL with the filter dates */
  private injectDateParams(sql: string): string {
    sql = replaceViewDateRangeParameters(sql, this.fromDate, this.toDate);
    const cluster = this.filterValues['cluster'];
    if (typeof cluster === 'string' && cluster && cluster !== 'All' && this.safeValuePattern.test(cluster)) {
      const hasDeclare = /DECLARE\s+@cluster\s/i.test(sql);
      if (hasDeclare) {
        sql = sql.replace(
          /DECLARE\s+@cluster\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
          `DECLARE @cluster $1 = '${cluster}';`,
        );
      } else if (/@cluster\b/i.test(sql)) {
        sql = `DECLARE @cluster VARCHAR(100) = '${cluster}';\n${sql}`;
      }
    }
    const plant = this.filterValues['plant'];
    if (typeof plant === 'string' && plant && plant !== 'All' && this.safeValuePattern.test(plant)) {
      const hasDeclare = /DECLARE\s+@plant\s/i.test(sql);
      if (hasDeclare) {
        sql = sql.replace(
          /DECLARE\s+@plant\s+(\w+(?:\s*\([^)]*\))?)(?:\s*=[^;]+)?;/i,
          `DECLARE @plant $1 = '${plant}';`,
        );
      } else if (/@plant\b/i.test(sql)) {
        sql = `DECLARE @plant VARCHAR(100) = '${plant}';\n${sql}`;
      }
    }
    const hierarchy: Record<string, GlobalFilterSelection> = {
      country: this.filterValues['country'],
      sector: this.filterValues['sector'],
      businessUnit: this.filterValues['businessUnit'],
      division: this.filterValues['division'],
    };
    for (const [name, value] of Object.entries(hierarchy)) {
      if (typeof value !== 'string' || !value || value === 'All' || !this.safeValuePattern.test(value)) continue;
      const parameter = `@${name}`;
      const declaration = new RegExp(`DECLARE\\s+${parameter}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
      if (declaration.test(sql)) sql = sql.replace(declaration, `DECLARE ${parameter} $1 = '${value}';`);
      else if (new RegExp(`\\b${parameter}\\b`, 'i').test(sql)) sql = `DECLARE ${parameter} VARCHAR(100) = '${value}';\n${sql}`;
    }
    return sql;
  }

  onDateChange(): void {
    if (!this.hasDateParams || !this.viewSql || !this.viewConnectionId) return;
    // Reject non-empty invalid values; proceed if at least one date is valid
    const fromValid = !this.fromDate || this.datePattern.test(this.fromDate);
    const toValid = !this.toDate || this.datePattern.test(this.toDate);
    if (!fromValid || !toValid) return;
    if (!this.fromDate && !this.toDate) return;
    if (!this.isTile) {
      this.applyGlobalFilter();
      return;
    }
    if (this.isTrendChart) {
      this.loadTrendData();
      return;
    }
    this.cancelGlobalFilter$.next();
    this.loading = true;
    this.cdr.markForCheck();
    const sql = this.injectDateParams(this.viewSql);
    this.commonApi.previewView({
      connectionId: this.viewConnectionId,
      sql,
      viewId: this.viewIdForPreview,
      maxRows: 1000,
    }).pipe(takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$)).subscribe({
      next: (res) => this.applyLoadedData(res.columns ?? [], res.rows ?? []),
      error: () => { this.loading = false; this.error = 'Failed to reload data with new dates.'; this.cdr.markForCheck(); },
    });
  }

  private round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

  private rowVal(row: Record<string, unknown>, col: string): string {
    const v = row[col];
    if (v === null || v === undefined || typeof v === 'object') return '';
    return (v as string | number | boolean).toString();
  }

  private getDropdownOptions(col: string): string[] {
    const source = this.optionSourceRows.length ? this.optionSourceRows : this.allRows;
    const vals = source
      .map(r => this.rowVal(r, col))
      .filter(v => v !== '');
    return [...new Set(vals)].sort((a, b) => a.localeCompare(b));
  }

  /** Live option list for a filter's own dropdown/checklist: applies every other active filter
   *  (single, MultiSelect, conditional) plus this filter's own typed condition, so the choices
   *  shown always reflect the data that would remain after the filters currently applied —
   *  mirroring the chart builder's cascading preview instead of a static, unfiltered snapshot. */
  getFilterOptions(filter: FilterControl): string[] {
    if (!filter.sourceColumn) return [];
    if (filter.locked) {
      return filter.controlType === 'MultiSelect' ? [...(filter.values ?? [])] : (filter.value ? [filter.value] : []);
    }
    // A filter is only genuinely cross-table when its column doesn't actually exist in the
    // loaded rows — comparing sourceTable strings is unreliable since a conditional filter's
    // saved sourceTable, or an interactive filter picked against the same model, can end up
    // stored under a slightly different identifier than the widget's own source.
    if (!this.columnExistsLocally(filter.sourceColumn)) return filter.options;
    let rows = this.rowsNarrowedByOtherLocalFilters(filter.id);
    const typed = filter.valueText?.trim();
    if (typed) {
      const exclude = filter.mode === 'Exclude';
      rows = rows.filter(r => matchesConditionalFilter(this.rowVal(r, filter.sourceColumn), filter.operator || 'equals', [typed]) !== exclude);
    }
    return [...new Set(rows.map(r => this.rowVal(r, filter.sourceColumn)).filter(v => v !== ''))]
      .sort((a, b) => a.localeCompare(b));
  }

  /** True when `col` is an actual key of the loaded rows (case-insensitive), i.e. the filter can
   *  be resolved against `allRows` directly instead of needing a separate cross-table fetch. */
  private columnExistsLocally(col: string): boolean {
    // Fall back to the stable snapshot so an empty filtered result (e.g. a selection with no data)
    // doesn't flip a genuine cross-table filter into "local" and collapse its option list.
    const sample = this.allRows[0] ?? this.optionSourceRows[0];
    if (!sample) return true; // nothing loaded yet — don't wrongly treat it as cross-table
    return Object.keys(sample).some(k => k.toLowerCase() === col.toLowerCase());
  }

  /** Applies every other same-source local filter's current selection to `allRows`, excluding
   *  `excludeId`'s own selection — used to compute what that one filter should still offer. */
  private rowsNarrowedByOtherLocalFilters(excludeId?: number): Record<string, unknown>[] {
    // Options come from the stable snapshot, not the (possibly server-filtered) allRows.
    let rows = this.filterRowsByGlobalHierarchy(this.optionSourceRows.length ? this.optionSourceRows : this.allRows);
    for (const f of this.filters) {
      if (f.id === excludeId) continue;
      if (!this.columnExistsLocally(f.sourceColumn)) continue;
      if (f.controlType === 'MultiSelect') {
        if (f.operator) {
          if (!f.values?.length && !f.valueText?.trim()) continue;
          rows = applyConditionalFilters(rows, [{ sourceColumn: f.sourceColumn, operator: f.operator, valueText: f.valueText, mode: f.mode, values: f.values ?? [] }]);
        } else if (f.values?.length) {
          const set = new Set(f.values.map(v => v.toLowerCase()));
          rows = rows.filter(r => set.has(this.rowVal(r, f.sourceColumn).toLowerCase()));
        }
      } else if (f.controlType === 'Date') {
        if (f.value) rows = rows.filter(r => this.rowVal(r, f.sourceColumn).startsWith(f.value));
      } else if (f.value) {
        rows = rows.filter(r => this.rowVal(r, f.sourceColumn).toLowerCase().includes(f.value.toLowerCase()));
      }
    }
    return rows;
  }

  /** Filter ids whose options are already being fetched, so applyLoadedData doesn't ask twice. */
  private readonly filterOptionsRequested = new Set<number>();

  /** Start the option fetch for every unlocked dropdown sourced from another table. */
  private prefetchForeignFilterOptions(chartSource: string): void {
    this.filters
      .filter(f => (f.controlType === 'Dropdown' || f.controlType === 'MultiSelect') && !f.locked
        && !!f.sourceTable && f.sourceTable !== chartSource)
      .forEach(f => this.loadFilterOptionsFromSource(f));
  }

  /** Fetch distinct values for a filter whose source table differs from the chart source. */
  private loadFilterOptionsFromSource(f: FilterControl): void {
    this.filterOptionsRequested.add(f.id);
    this.widgetService.getTableData(f.sourceTable, 'Table').pipe(
      catchError(() => this.widgetService.getTableData(f.sourceTable, 'View')),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (res) => {
        const vals = (res.rows ?? []).map(r => safeString(r[f.sourceColumn])).filter(v => v !== '');
        f.options = [...new Set(vals)].sort((a, b) => a.localeCompare(b));
        this.cdr.markForCheck();
      },
      error: () => console.error(`Failed to load filter options for ${f.sourceTable}.${f.sourceColumn}`),
    });
  }

  /**
   * Set the tile value. A Table source always computes the number in SQL via the aggregate API
  * (correct on multi-million-row tables); DAX tiles apply matching source-column filters.
   * Views always use rows, so their local + global filters keep working.
   */
  private tileValueLoad = 0;

  private refreshTileValue(rows: Record<string, unknown>[]): void {
    const load = ++this.tileValueLoad;
    const daxModel = this.design['daxModel'] as DaxModelConfig;
    this.tileValue = null;
    const source = this.savedWidget?.source ?? (this.design['source'] as string ?? '');
    const sourceType = this.savedWidget?.sourceType ?? (this.design['sourceType'] as string ?? 'Table');
    if (source && sourceType.toLowerCase() === 'table') {
      const aggregation = (this.design['aggregation'] as string) ?? 'count';
      const valueField = (this.design['valueField'] as string) ?? '';
      const filters = [
        ...this.filters.filter(filter => filter.value || filter.values?.length).map(filter => ({
          sourceTable: filter.sourceTable || source, sourceColumn: filter.sourceColumn,
          controlType: filter.controlType, value: filter.value, values: filter.values, label: filter.label,
        })),
        ...this.globalHierarchyFilterPayload(),
        ...(daxModel?.enabled ? [] : tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant'])),
      ];
      const value$ = filters.length || (daxModel?.enabled && (this.fromDate || this.toDate))
        ? this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
            filters, fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
            aggregation, valueField: valueField || undefined, daxModel })
            .pipe(map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })))
        : this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation, valueField: valueField || undefined, daxModel });
      value$
        .pipe(takeUntil(this.destroy$)).subscribe({
          next: res => { if (load === this.tileValueLoad) { this.tileValue = res.value ?? 0; this.cdr.markForCheck(); } },
          error: () => {
            if (load !== this.tileValueLoad) return;
            this.tileValue = daxModel?.enabled ? NaN : null;
            this.error = 'Failed to calculate tile value.';
            this.cdr.markForCheck();
          },
        });
      return;
    }
    this.tileValue = this.computeTileValue(rows);
  }

  /** Recompute each breakdown row's value live, using the SAME filter logic as the tile's main
   *  value: the chart's active local filters (present only when the tile sits in a chart) flow to
   *  the breakdown too; global hierarchy is applied for View sources, Cluster/Plant via FK for
   *  Table sources, mirroring the main value. */
  private hydrateBreakdownValues(target: { label: string; value: string; color: string }[], defs: any[]): void {
    const setValue = (i: number, v: number) => { if (target[i]) { target[i].value = String(Math.round(v * 100) / 100); this.cdr.markForCheck(); } };
    defs.forEach((d, i) => {
      if (!d?.sourceName || !d?.column) return;
      const sourceType = d.sourceType ?? 'Table';
      const isView = sourceType.toLowerCase() === 'view';
      const locals = this.filters.filter(f => f.value || (f.values?.length ?? 0) > 0).map(f => ({
        sourceTable: f.sourceTable || d.sourceName,
        sourceColumn: f.sourceColumn,
        controlType: f.controlType,
        value: f.controlType === 'MultiSelect' ? (f.values ?? []).join(',') : f.value,
        label: f.label,
      }));
      const globals = isView
        ? this.globalHierarchyFilterPayload(true).filter(g => g.advancedHierarchy || !locals.some(l =>
            l.sourceColumn.toLowerCase() === g.sourceColumn.toLowerCase() || (l.label ?? '').toLowerCase() === (g.label ?? '').toLowerCase()))
        : tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant']);
      this.commonApi.getBreakdownValueFiltered({
        sourceName: d.sourceName, sourceType, column: d.column,
        filters: [...locals, ...globals],
        fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
      }).pipe(takeUntil(this.destroy$)).subscribe({ next: v => setValue(i, v), error: () => setValue(i, 0) });
    });
  }

  private computeTileValue(rows: Record<string, unknown>[]): number {
    try {
      const daxValue = evaluateTileDaxValue(rows, this.design['daxModel'] as DaxModelConfig);
      if (daxValue !== undefined) return daxValue;
    } catch { return NaN; }
    const aggregation = (this.design['aggregation'] as string) ?? 'count';
    const valueField = (this.design['valueField'] as string) ?? '';
    if (aggregation === 'count') return valueField ? rows.filter(r => { const v = r[valueField]; return v !== null && v !== undefined && v !== ''; }).length : rows.length;
    if (!valueField) return rows.length;
    if (aggregation === 'countDistinct') return new Set(rows.map(r => r[valueField]).filter(v => v !== null && v !== undefined && v !== '')).size;
    if (aggregation === 'value') return Number(rows[0]?.[valueField] ?? 0) || 0;
    const nums = rows.map(r => Number(r[valueField] ?? 0)).filter(n => !Number.isNaN(n));
    if (aggregation === 'total') return nums.reduce((a, b) => a + b, 0);
    if (aggregation === 'average') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    return rows.length;
  }

  /** Bumped on every reload so tile responses from a superseded load are dropped (DFCT0010620). */
  private inlineTilesLoad = 0;

  private loadInlineTiles(tileIds: number[], onAllLoaded?: () => void): void {
    const load = ++this.inlineTilesLoad;
    let completed = 0;
    const checkDone = () => { completed++; if (completed >= tileIds.length) onAllLoaded?.(); };
    // Replace an existing entry for the tile rather than appending a second copy, and keep
    // the tiles in their saved order whatever order the responses arrive in.
    const setInlineTile = (tile: typeof this.inlineTiles[number]) => {
      if (load !== this.inlineTilesLoad) return;
      const i = this.inlineTiles.findIndex(t => t.id === tile.id);
      if (i >= 0) this.inlineTiles[i] = tile; else this.inlineTiles.push(tile);
      this.inlineTiles.sort((a, b) => tileIds.indexOf(a.id) - tileIds.indexOf(b.id));
    };

    // The chart response already carries its attached tiles; only fall back to a request
    // per tile when it doesn't (older API or a tile added since).
    const prefetched = new Map((this.savedWidget?.attachedTiles ?? []).map(t => [t.id, t]));
    const loadTile = (tileId: number) => {
      const tile$ = prefetched.has(tileId) ? of(prefetched.get(tileId)!) : this.widgetService.getWidgetById(tileId);
      tile$.subscribe({
        next: (tile) => {
          let d: Record<string, unknown> = {};
          try { d = JSON.parse(tile.designJson ?? '{}'); } catch { /* ignore */ }
          const aggregation = (d['aggregation'] as string) ?? 'count';
          const valueField = (d['valueField'] as string) ?? '';
          const source = tile.source;
          const sourceType = tile.sourceType ?? 'Table';
          const color = (d['tileColor'] as string) ?? 'blue';
          const icon = (d['tileIcon'] as string) ?? 'well';
          const drillDownViewId = (d['drillDownViewId'] as number | null) ?? null;
          const showIcon = d['showTileIcon'] !== false;
          const tileLayout = resolveTileLayout(d['tileLayout']);
          const valueBold = d['valueBold'] === true;
          const valueItalic = d['valueItalic'] === true;
          const valueColor = (d['valueColor'] as string) || '';
          const label = (d['label'] as string) || tile.name;
          const prefix = (d['prefix'] as string) ?? '';
          const suffix = (d['suffix'] as string) ?? '';
          const places = (d['decimalPlaces'] as number) ?? 0;
          const shorten = (d['shortenBigNumbers'] as boolean) ?? false;
          const breakdownDefs = ((d['breakdownRows'] as any[]) ?? []).filter(r => r && (r.label || r.value));
          const breakdown = breakdownDefs.map(r => ({ label: r.label ?? '', value: r.value ?? '', color: r.color ?? 'blue' }));
          this.hydrateBreakdownValues(breakdown, breakdownDefs);

          const viewId = tile.sourceId ?? (d['viewId'] as number | undefined);

          const pushInlineTile = (val: number) => {
            let formatted: string;
            if (!Number.isFinite(val)) formatted = 'DAX error';
            else if ((d['daxModel'] as DaxModelConfig)?.enabled) formatted = formatDaxValue(val, getSelectedDaxMeasure(d['daxModel'] as DaxModelConfig));
            else if (shorten && val >= 1_000_000) formatted = (val / 1_000_000).toFixed(1) + 'M';
            else if (shorten && val >= 1000) formatted = (val / 1000).toFixed(1) + 'K';
            else formatted = val.toFixed(places);
            setInlineTile({ id: tileId, label, value: prefix + formatted + suffix, color, icon, tileLayout, drillDownViewId, showIcon, valueBold, valueItalic, valueColor, breakdown });
            this.cdr.markForCheck();
            checkDone();
          };

          // DAX tiles always resolve server-side (their own filter + hierarchy handling). Non-DAX
          // Table tiles take the plain aggregate only when no local filter is active; with an active
          // local filter they fall through to the filtered path below (server-side, no 1000-row cap).
          const daxModel = d['daxModel'] as DaxModelConfig;
          const hasActiveLocal = this.filters.some(f => f.value || (f.values?.length ?? 0) > 0);
          // Inline tiles follow the chart's global Cluster/Plant too: non-DAX Table tiles with an
          // active global (and no local filter) aggregate server-side via FK instead of the plain total.
          const inlineTableGlobals = daxModel?.enabled ? [] : tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant']);
          if (sourceType !== 'View' && sourceType !== 'Import' && source && (daxModel?.enabled || !hasActiveLocal)) {
            const value$ = daxModel?.enabled
              ? this.widgetService.getTableData(source, 'Table').pipe(switchMap(metadata =>
                this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
                  filters: [
                    ...this.filters.filter(filter => filter.value || filter.values?.length).map(filter => ({
                      sourceTable: filter.sourceTable || source, sourceColumn: filter.sourceColumn,
                      controlType: filter.controlType, value: filter.value, values: filter.values, label: filter.label,
                    })), ...this.tableHierarchyFilterPayload(source, metadata.columns ?? []),
                  ], fromDate: this.fromDate || undefined, toDate: this.toDate || undefined, aggregation, daxModel,
                })), map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })))
              : inlineTableGlobals.length
                ? this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'Table', viewId: null,
                    filters: inlineTableGlobals, fromDate: this.fromDate || undefined, toDate: this.toDate || undefined,
                    aggregation, valueField: valueField || undefined,
                  }).pipe(map(result => ({ value: Number(result.rows?.[0]?.['Value'] ?? 0) })))
                : this.commonApi.getAggregate({ sourceName: source, sourceType: 'Table', aggregation, valueField: valueField || undefined });
            value$
              .subscribe({ next: res => pushInlineTile(res.value ?? 0), error: () => (d['daxModel'] as DaxModelConfig)?.enabled ? pushInlineTile(NaN) : checkDone() });
            return;
          }

          // Attached View/Table tiles follow the chart's active local (interactive) filters too, not just global.
          const localFilters = (sourceType === 'View' || sourceType === 'Table')
            ? this.filters.filter(f => f.value || (f.values?.length ?? 0) > 0).map(f => ({
                sourceTable: f.sourceTable || source,
                sourceColumn: f.sourceColumn,
                controlType: f.controlType,
                value: f.controlType === 'MultiSelect' ? (f.values ?? []).join(',') : f.value,
                label: f.label,
              }))
            : [];
          const tileGlobals = this.globalHierarchyFilterPayload(sourceType === 'View').filter(g =>
            (sourceType === 'View' || !g.advancedHierarchy) && (g.advancedHierarchy || !localFilters.some(l =>
              l.sourceColumn.toLowerCase() === g.sourceColumn.toLowerCase() || (l.label ?? '').toLowerCase() === (g.label ?? '').toLowerCase())));
          // Table tile with an active filter → aggregate server-side in the filtered query (value in rows[0].Value).
          const aggregateTile = sourceType === 'Table' && hasActiveLocal;
          // Import datasets aren't real SQL tables/views — fetch rows directly instead of the
          // cross-table filtered-chart-data endpoint, which would 404 trying to resolve them.
          const data$ = sourceType === 'Import'
            ? this.widgetService.getTableData(source, sourceType)
            : this.widgetService.getFilteredChartData({
                chartSource: source,
                chartSourceType: sourceType,
                viewId: sourceType === 'View' ? (viewId ?? null) : null,
                // Same Country → Plant selection the chart uses, plus the chart's active local filters,
                // so a tile on a view follows both instead of always showing the unfiltered total.
                // Table aggregate tiles FK-join their filters, but the global hierarchy levels
                // (country/sector/…) aren't real tables — including them 404s — so send locals only.
                filters: aggregateTile ? [...localFilters, ...inlineTableGlobals] : [...localFilters, ...tileGlobals],
                fromDate: this.fromDate || undefined,
                toDate: this.toDate || undefined,
                ...(aggregateTile ? { aggregation, valueField: valueField || undefined } : {}),
              });

          data$.subscribe({
            next: (res) => {
              if (sourceType.toLowerCase() === 'table') {
                pushInlineTile(Number(res.rows[0]?.['Value'] ?? 0));
                return;
              }
              const rows = res.rows ?? [];
              try {
                const daxValue = evaluateTileDaxValue(rows, d['daxModel'] as DaxModelConfig, res.columns);
                if (daxValue !== undefined) { pushInlineTile(daxValue); return; }
              } catch { pushInlineTile(NaN); return; }
              let val: number;
              if (aggregateTile) val = Number(rows[0]?.['Value'] ?? 0) || 0;
              else if (aggregation === 'count') val = valueField ? rows.filter((r: Record<string, unknown>) => { const v = r[valueField]; return v !== null && v !== undefined && v !== ''; }).length : rows.length;
              else if (!valueField) val = rows.length;
              else if (aggregation === 'countDistinct') val = new Set(rows.map((r: Record<string, unknown>) => r[valueField]).filter((v: unknown) => v !== null && v !== undefined && v !== '')).size;
              else if (aggregation === 'value') val = Number(rows[0]?.[valueField] ?? 0) || 0;
              else {
                const nums = rows.map((r: Record<string, unknown>) => Number(r[valueField] ?? 0)).filter((n: number) => !Number.isNaN(n));
                if (aggregation === 'total') val = nums.reduce((a: number, b: number) => a + b, 0);
                else if (aggregation === 'average' && nums.length) val = nums.reduce((a: number, b: number) => a + b, 0) / nums.length;
                else val = rows.length;
              }
              let formatted: string;
              if (shorten && val >= 1_000_000) formatted = (val / 1_000_000).toFixed(1) + 'M';
              else if (shorten && val >= 1000) formatted = (val / 1000).toFixed(1) + 'K';
              else formatted = val.toFixed(places);

              setInlineTile({ id: tileId, label, value: prefix + formatted + suffix, color, icon, tileLayout, drillDownViewId, showIcon, valueBold, valueItalic, valueColor, breakdown });
              this.cdr.markForCheck();
              checkDone();
            },
            error: () => { checkDone(); },
          });
        },
        error: () => { checkDone(); },
      });
    };
    tileIds.forEach(id => loadTile(id));
  }

  private rebuildChart(): void {
    this.scenarioForecastError = '';
    this.scenarioForecastLabels = [];
    this.scenarioPredictionMessages = [];
    this.advanced = null;
    const advancedType = this.design['chartType'];
    if (isAdvancedChart(advancedType)) {
      this.advanced = { type: advancedType, config: readAdvancedConfig(this.design['advancedConfig']), rows: this.filteredRows, daxMeasures: getActiveDaxMeasures(this.design) };
      this.categories = [];
      this.multiSeriesData = [];
      this.tableDisplayRows = [];
      return;
    }
    const xAxis        = this.design['xAxis'] as string ?? '';
    const yAxis        = this.design['yAxis'] as string ?? 'Count (F)';
    const yAggCol      = this.design['yAggColumn'] as string ?? '';
    const limitCat     = (this.design['limitCategory'] as string) ?? 'all';
    const topN         = (this.design['topN'] as number) ?? 10;
    const bottomN      = (this.design['bottomN'] as number) ?? 10;
    const groupOthers  = (this.design['groupRestAsOthers'] as boolean) ?? false;
    const multiYColumns = (this.design['multiYColumns'] as string[]) ?? [];
    const chartType    = (this.design['chartType'] as string) ?? '';

    // Bar/column "Switch Metrics": the viewer picks which single Y column feeds the bars.
    const metricCols = (chartType === 'bar' || chartType === 'column') ? ((this.design['metricColumns'] as string[]) ?? []) : [];
    this.metricSwitchColumns = metricCols.length > 1 ? metricCols : [];
    if (this.metricSwitchColumns.length && (!this.activeMetric || !this.metricSwitchColumns.includes(this.activeMetric)))
      this.activeMetric = this.metricSwitchColumns[0];
    const effYAggCol = this.metricSwitchColumns.length ? this.activeMetric : yAggCol;

    // for combo (and grouped with a right Y-axis), the union of left + right columns determines multi-series rendering
    const comboLineCols = (chartType === 'combo' || chartType === 'multiline' || chartType === 'grouped') ? ((this.design['comboLineColumns'] as string[]) ?? []) : [];
    const effectiveCols = (chartType === 'combo' || ((chartType === 'multiline' || chartType === 'grouped') && comboLineCols.length > 0)) ? [...new Set([...multiYColumns, ...comboLineCols])] : multiYColumns;
    const isMultiSeries = (chartType === 'multiline' || chartType === 'area' || chartType === 'stacked' || chartType === 'table' || chartType === 'combo' || chartType === 'grouped') && effectiveCols.length > 0;

    this.tableDisplayRows = chartType === 'table'
      ? this.buildTableDisplayRows(xAxis, multiYColumns)
      : [];
    this.tableRecords = this.tableDisplayRows.length ? this.filteredRows.slice(0, 100) : [];

    if (isMultiSeries) {
      if (chartType === 'combo' || ((chartType === 'multiline' || chartType === 'grouped') && comboLineCols.length > 0)) {
        this.buildMultiSeries(xAxis, yAxis, effectiveCols);
      } else {
        this.buildMultiSeries(xAxis, yAxis, multiYColumns);
      }
    } else {
      this.multiSeriesData = [];
      let { cats, vals } = this.aggregate(this.filteredRows, xAxis, yAxis, effYAggCol);
      ({ cats, vals } = this.applyLimit(cats, vals, limitCat, topN, bottomN, groupOthers));
      if (cats.length > 0) {
        this.categories = cats.map((label, i) => ({ key: label, label, value: vals[i] ?? 0, color: COLORS[i % COLORS.length] }));
        if (!this.baseCategories.length) this.baseCategories = [...this.categories];
      } else if (this.baseCategories.length) {
        this.categories = this.baseCategories.map(c => ({ ...c, value: 0 }));
      } else {
        this.categories = [];
      }
    }

    const hasStackTotal = chartType === 'stacked' && this.design['showStackTotal'] !== false;
    const baselineSeries = hasStackTotal ? this.multiSeriesData.slice(0, -1) : this.multiSeriesData;
    const hasTargetedPlanChange = (!!this.scenarioCategoryTarget && this.scenarioPlanAdjustments !== 0)
      || this.scenarioItems.some(item => !!item.target && item.value !== 0);
    const predictCategories = hasTargetedPlanChange
      && !(this.scenarioHasPeriodAxis && this.scenarioTargetMode === 'period');
    const canPredictCategories = predictCategories && this.scenarioUsesSeriesCategories
      && baselineSeries.length > 1 && this.showScenarioScheduleSlippage;
    const sourcePeriods = new Set(this.filteredRows.map(row => safeString(row[xAxis])));
    const predictionHistory = canPredictCategories ? baselineSeries.map(series => {
      const invalidPeriods = new Set(this.filteredRows.filter(row => {
        const value = row[series.name];
        return (typeof value !== 'number' && typeof value !== 'string')
          || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value));
      }).map(row => safeString(row[xAxis])));
      return series.data.map((value, index) => {
        const period = this.categories[index].label;
        return !sourcePeriods.has(period) || invalidPeriods.has(period) ? null : value;
      });
    }) : [];

    if (this.scenarioScheduleSlippage > 0 && this.showScenarioScheduleSlippage) {
      if (chartType === 'table') {
        this.scenarioForecastError = 'Schedule Slippage forecasting requires a plotted date axis, not a table.';
      } else {
        const hasStackTotal = chartType === 'stacked' && this.design['showStackTotal'] !== false;
        const dataSeries = hasStackTotal ? this.multiSeriesData.slice(0, -1) : this.multiSeriesData;
        const monthlyRows = this.scenarioMonthlyError ? null : this.scenarioMonthlyRows;
        const monthlyAggregates = monthlyRows
          ? (dataSeries.length
            ? dataSeries.map(series => this.aggregate(monthlyRows, xAxis, 'Sum (F)', series.name))
            : [this.aggregate(monthlyRows, xAxis, yAxis, yAggCol)])
          : null;
        const forecast = forecastScenarioPeriods(
          this.categories.map(category => category.label),
          dataSeries.length ? dataSeries.map(series => series.data) : [this.categories.map(category => category.value)],
          this.scenarioScheduleSlippage,
          this.isTrendChart ? this.trendMode ?? 'monthly' : 1,
          this.isTrendChart && this.trendMode === 'yearly' ? this.toDate : undefined,
          monthlyAggregates ? { labels: monthlyAggregates[0].cats, values: monthlyAggregates.map(data => data.vals) } : undefined,
        );
        if (forecast.error !== null) {
          this.scenarioForecastError = this.scenarioMonthlyError
            || (this.scenarioMonthlyLoading ? 'Loading monthly history for the yearly forecast.' : forecast.error);
        } else {
          this.scenarioForecastLabels = forecast.labels;
          for (const [index, series] of dataSeries.entries()) series.data.push(...forecast.values[index]);
          const startIndex = this.categories.length;
          this.categories.push(...forecast.labels.map((label, index) => ({
            key: label, label,
            value: this.round2(forecast.values.reduce((sum, values) => sum + values[index], 0)),
            color: COLORS[(startIndex + index) % COLORS.length],
          })));
        }
      }
    }

    const predictionDeltas = new Map<string, number[]>();
    if (predictCategories) {
      if (canPredictCategories) {
        const prediction = predictScenarioCategoryChanges(baselineSeries.map((series, index) => ({
          name: series.name,
          history: predictionHistory[index],
          planDeltas: series.data.map(value => this.scenarioPlanValue(value, series.name) - value),
          explicitlyAdjusted: (!this.scenarioCategoryTarget && this.scenarioPlanAdjustments !== 0)
            || (this.scenarioCategoryTarget === series.name && this.scenarioPlanAdjustments !== 0)
            || this.scenarioItems.some(item => (!item.target || item.target === series.name) && item.value !== 0),
        })));
        for (const [name, deltas] of prediction.deltas) predictionDeltas.set(name, deltas);
        this.scenarioPredictionMessages = prediction.messages;
      } else {
        this.scenarioPredictionMessages = [
          'Related-category prediction is unavailable: this chart needs multiple category series with paired historical date periods. Only direct adjustments are applied.',
        ];
      }
    }

    // Tables show measures as summary rows/columns (buildTableDisplayRows), not as categories.
    if (chartType !== 'table') {
      for (const measure of getActiveDaxMeasures(this.design)) {
        const totalValue = evaluateDaxMeasure(measure, this.filteredRows, this.tableColumns);
        const measureName = measure.name?.trim() || 'New Metric';
        this.categories.push({
          key: measureName,
          label: measureName,
          value: totalValue,
          color: COLORS[this.categories.length % COLORS.length],
        });
        if (isMultiSeries && this.multiSeriesData.length > 0) {
          appendDaxTotalToSeries(totalValue, this.multiSeriesData,
            chartType === 'stacked' && this.design['showStackTotal'] !== false ? this.multiSeriesData.length - 1 : -1);
        }
      }
    }

    if (this.multiSeriesData.length) {
      const hasStackTotal = chartType === 'stacked' && this.design['showStackTotal'] !== false;
      const dataSeries = hasStackTotal ? this.multiSeriesData.slice(0, -1) : this.multiSeriesData;
      for (const series of dataSeries) {
        series.data = series.data.map((value, index) => this.scenarioValue(value,
          this.scenarioUsesSeriesCategories ? series.name : this.categories[index].label,
          predictionDeltas.get(series.name)?.[index] ?? 0));
      }
      this.categories = this.categories.map((category, index) => ({
        ...category, value: this.round2(dataSeries.reduce((sum, series) => sum + (series.data[index] ?? 0), 0)),
      }));
      if (hasStackTotal) {
        this.multiSeriesData[this.multiSeriesData.length - 1].data = this.categories.map(category => category.value);
      }
    } else {
      this.categories = this.categories.map(category => ({
        ...category, value: this.scenarioValue(category.value,
          this.scenarioUsesSeriesCategories ? this.scenarioSingleSeriesName : category.label),
      }));
    }

    const singleSeriesName = yAxis || 'Value';
    this.categories = this.categories.map(category => ({
      ...category,
      color: this.categoryColorForRule(category.label)
        ?? this.colorOverrideFor(category.label, singleSeriesName)
        ?? this.colorForRule(category.label, category.value, singleSeriesName)
        ?? this.fallbackColor(`${singleSeriesName}:${category.label}`, this.categories.indexOf(category)),
    }));

    this.rebuildChartOptions();
    this.rebuildChartOptions2();
    if (this.scenarioBuilderPreview) {
      const modified = this.scenarioPlanAdjustments !== 0 || this.scenarioScheduleSlippage !== 0
        || this.scenarioItems.some(item => item.value !== 0);
      this.scenarioPreviewChange.emit(modified ? {
        options: this.chartOptions,
        categories: this.categories.map(category => category.label),
        values: this.categories.map(category => category.value),
        series: this.multiSeriesData.map(series => ({ name: series.name, data: [...series.data] })),
      } : null);
    }
    this.loadScenarioMonthlyHistory();
  }

  private buildTableDisplayRows(xAxis: string, columns: string[]): { category: string; values: unknown[]; color: string }[] {
    if (!xAxis || !columns.length) return [];

    const valueColumns = columns.filter(column => column !== xAxis);
    const displayRows = this.filteredRows.slice(0, 100);
    const cells: (string | number)[][] = displayRows.map(row => [safeString(row[xAxis]) || '(empty)',
      ...valueColumns.map(column => row[column] as string | number)]);
    // Same DAX rows/columns as the builder preview: Column-scope measures as summary rows,
    // Row-scope measures as extra columns (they were dropped here, so saved tables lost them).
    appendDaxToTableRows(getActiveDaxMeasures(this.design), this.filteredRows, this.tableColumns, cells,
      valueColumns.length, displayRows.map(row => [row]), valueColumns);
    return cells.map(([category, ...values], index) => ({
      category: String(category), values, color: COLORS[index % COLORS.length],
    }));
  }

  get tableDisplayColumns(): string[] {
    const xAxis = this.design['xAxis'] as string ?? '';
    const rowMeasures = getDaxRowColumnMeasures(getActiveDaxMeasures(this.design)).map(m => m.name?.trim() || 'New Metric');
    return [...((this.design['multiYColumns'] as string[]) ?? []).filter(column => column !== xAxis), ...rowMeasures];
  }

  get savedTableHeaders(): string[] {
    if (this.advanced) return advancedChartExport(this.advanced).headers;
    return [this.xAxisHeader, ...(this.tableDisplayRows.length ? this.tableDisplayColumns
      : this.multiSeriesData.length ? this.multiSeriesData.map(series => series.name)
      : [this.yAxisHeader, '% of Total'])];
  }

  get savedTableRows(): unknown[][] {
    if (this.advanced) return advancedChartExport(this.advanced).rows;
    if (this.tableDisplayRows.length) {
      return this.tableDisplayRows.map(row => [row.category, ...row.values]);
    }
    return this.categories.map((category, index) => [category.label,
      ...(this.multiSeriesData.length ? this.multiSeriesData.map(series => series.data[index] ?? 0)
        : [category.value, `${this.percentOf(category)}%`])]);
  }

  get savedTableRowColors(): string[] {
    const manual = this.design['tableRowColors'] as string[] ?? [];
    if (!(this.design['colorRules'] as unknown[] | undefined)?.length) return manual;
    // Colour rules apply to table rows as they do to chart points: category list first, then value conditions.
    return this.savedTableRows.map((row, index) => {
      const category = String(row[0] ?? '');
      const value = Number(row[1]);
      return this.categoryColorForRule(category) ?? this.colorForRule(category, Number.isFinite(value) ? value : NaN) ?? manual[index] ?? '';
    });
  }
  get savedTableRowTextColors(): string[] { return this.design['tableRowTextColors'] as string[] ?? []; }

  private applyLimit(cats: string[], vals: number[], limitCat: string, topN: number, bottomN: number, groupOthers: boolean): { cats: string[]; vals: number[] } {
    if (limitCat === 'top' && cats.length > topN) {
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => b.v - a.v);
      const kept = pairs.slice(0, topN);
      const rest = pairs.slice(topN);
      cats = kept.map(p => p.c);
      vals = kept.map(p => p.v);
      if (groupOthers && rest.length) { cats.push('Others'); vals.push(rest.reduce((s, p) => s + p.v, 0)); }
    } else if (limitCat === 'bottom' && cats.length > bottomN) {
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => a.v - b.v);
      const kept = pairs.slice(0, bottomN);
      const rest = pairs.slice(bottomN);
      cats = kept.map(p => p.c);
      vals = kept.map(p => p.v);
      if (groupOthers && rest.length) { cats.push('Others'); vals.push(rest.reduce((s, p) => s + p.v, 0)); }
    }
    return { cats, vals };
  }

  /** Applies the saved Top N / Bottom N / "Group as Others" limit to a multi-series category list. */
  private limitMultiSeriesCats(cats: string[], byCat: Map<string, Record<string, number>>, allCols: string[]): string[] {
    const limitCat = (this.design['limitCategory'] as string) ?? 'all';
    const wantTop = limitCat === 'top' && ((this.design['topN'] as number) ?? 0) > 0;
    const wantBottom = limitCat === 'bottom' && ((this.design['bottomN'] as number) ?? 0) > 0;
    if (!wantTop && !wantBottom) return cats.slice(0, 100);
    const n = wantTop ? (this.design['topN'] as number) : (this.design['bottomN'] as number);
    if (cats.length <= n) return cats;
    const total = (cat: string) => allCols.reduce((s, c) => s + (byCat.get(cat)?.[c] ?? 0), 0);
    const pairs = cats.map(c => ({ c, v: total(c) })).sort((a, b) => wantTop ? b.v - a.v : a.v - b.v);
    const kept = pairs.slice(0, n).map(p => p.c);
    const rest = pairs.slice(n).map(p => p.c);
    if (((this.design['groupRestAsOthers'] as boolean) ?? false) && rest.length) {
      const merged: Record<string, number> = Object.fromEntries(allCols.map(c => [c, 0]));
      for (const rc of rest) { const row = byCat.get(rc)!; for (const c of allCols) merged[c] += row[c] ?? 0; }
      byCat.set('Others', merged);
      return [...kept, 'Others'];
    }
    return kept;
  }

  private buildMultiSeries(xAxis: string, yAxis: string, multiYColumns: string[]): void {
    const isFn = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'].includes(yAxis);
    const allCols: string[] = [];
    if (!isFn && yAxis && !multiYColumns.includes(yAxis)) {
      allCols.push(yAxis);
    }
    allCols.push(...multiYColumns);

    const byCat = new Map<string, Record<string, number>>();
    for (const r of this.filteredRows) {
      const k = safeString(r[xAxis]);
      if (!byCat.has(k)) byCat.set(k, Object.fromEntries(allCols.map(c => [c, 0])));
      const agg = byCat.get(k)!;
      for (const col of allCols) agg[col] += Number(r[col]) || 0;
    }
    const cats = this.limitMultiSeriesCats([...byCat.keys()], byCat, allCols);
    this.multiSeriesData = allCols.map((col, i) => ({
      name: col,
      data: cats.map(cat => this.round2(byCat.get(cat)![col] ?? 0)),
      color: getSeriesColorByName(col, i),
    }));
    this.categories = cats.map((label, i) => {
      const total = this.multiSeriesData.reduce((sum, s) => sum + (s.data[i] ?? 0), 0);
      return { key: label, label, value: total, color: COLORS[i % COLORS.length] };
    });

    // For stacked charts, add a total line series (optional — off only when explicitly disabled).
    const chartType = (this.design['chartType'] as string) ?? '';
    if (chartType === 'stacked' && this.design['showStackTotal'] !== false) {
      const totals = cats.map(cat => this.round2(allCols.reduce((sum, col) => sum + (byCat.get(cat)![col] ?? 0), 0)));
      // Dark color matches how the Total line renders (and the dashboards), so the legend swatch matches the line.
      this.multiSeriesData.push({ name: 'Total', data: totals, color: '#374151' });
    }
  }

  private aggregate(rows: Record<string, unknown>[], xAxis: string, yAxis: string, aggCol: string): { cats: string[]; vals: number[] } {
    const { categories, values } = aggregateChartRows(rows, xAxis, yAxis, aggCol);
    return { cats: categories, vals: values };
  }

  private computeAggVal(g: { count: number; colCount: number; set: Set<string>; nums: number[] }, yAxis: string, hasCol: boolean): number {
    if (yAxis === 'Count (F)')           return hasCol ? g.colCount : g.count;
    if (yAxis === 'Count Distinct (F)')  return hasCol ? g.set.size  : g.count;
    if (yAxis === 'Sum (F)')             return this.round2(g.nums.reduce((a, b) => a + b, 0));
    if (yAxis === 'Average (F)')         return this.round2(g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0);
    if (yAxis === 'Min (F)')             return this.round2(g.nums.length ? Math.min(...g.nums) : 0);
    if (yAxis === 'Max (F)')             return this.round2(g.nums.length ? Math.max(...g.nums) : 0);
    return this.round2(g.nums.reduce((a, b) => a + b, 0));
  }

  get totalWells(): number { return this.categories.reduce((sum, cat) => sum + cat.value, 0); }
  percentOf(cat: WidgetCategory): number { return this.totalWells ? Math.round((cat.value / this.totalWells) * 100) : 0; }

  tableRowColor(i: number): string | null {
    const colors = this.design['tableRowColors'] as string[] | undefined;
    return colors?.[i] || null;
  }

  /** Dynamic grid columns: first column wide (category), rest equal */
  get tableGridColumns(): string {
    if (this.multiSeriesData.length === 0) return '';
    return `minmax(160px, 2fr) repeat(${this.multiSeriesData.length}, minmax(70px, 1fr))`;
  }

  tableRowTextColor(i: number): string | null {
    const colors = this.design['tableRowTextColors'] as string[] | undefined;
    return colors?.[i] || null;
  }

  get tableHeaderColor(): string | null {
    return (this.design['tableHeaderColor'] as string) || null;
  }

  get tableHeaderTextColor(): string | null {
    return (this.design['tableHeaderTextColor'] as string) || null;
  }

  private colorOverrideFor(category: string, seriesName = ''): string | undefined {
    const overrides = this.design['colorOverrides'] as Record<string, string> | undefined;
    if (!overrides) return undefined;
    const names = [seriesName, this.design['yAggColumn'] as string, this.design['yAxis'] as string, '']
      .filter((name, index, all) => name !== undefined && name !== null && all.indexOf(name) === index);
    for (const name of names) {
      const color = overrides[`${name}:${category}`];
      if (color) return color;
    }
    return undefined;
  }

  private colorAssignmentFor(category: string, seriesName = ''): string | undefined {
    const assignments = this.design['colorAssignments'] as Record<string, string> | undefined;
    return assignments?.[`${seriesName}:${category}`];
  }

  private categoryColorForRule(category: string, seriesName = ''): string | undefined {
    const chartType = (this.design['chartType'] as string) ?? '';
    const usesSeriesCategory = usesSeriesCategoryColorRules(chartType, this.design['xAxis'] as string | undefined);
    const normalizedCategory = (usesSeriesCategory ? seriesName : category).trim().toLowerCase();
    const rules = (this.design['colorRules'] as Array<{
      field: string; categories?: string[]; color: string;
    }> | undefined) ?? [];
    return rules.find(rule => rule.field.trim().toLowerCase() === 'category'
      && (rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalizedCategory))?.color;
  }

  private colorForRule(category: string, value: number, seriesName = '', includeCategoryRule = true): string | undefined {
    const rules = (this.design['colorRules'] as Array<{
      field: string; operator: string; value: string; value2?: string; categories?: string[]; color: string;
    }> | undefined) ?? [];
    const xField = (this.design['xAxis'] as string) ?? '';
    const yField = ((this.design['yAggColumn'] as string) || (this.design['yAxis'] as string)) ?? '';
    const prioritizedRules = [...rules].sort((left, right) =>
      Number(right.field.trim().toLowerCase() === 'category')
      - Number(left.field.trim().toLowerCase() === 'category'));
    for (const rule of prioritizedRules) {
      const ruleField = rule.field.trim().toLowerCase();
      if (ruleField === 'category') {
        if (!includeCategoryRule) continue;
        const chartType = (this.design['chartType'] as string) ?? '';
        const usesSeriesCategory = usesSeriesCategoryColorRules(chartType, xField);
        const normalizedCategory = (usesSeriesCategory ? seriesName : category).trim().toLowerCase();
        if ((rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalizedCategory)) return rule.color;
        continue;
      }
      const candidates: unknown[] = [category, value];
      if (ruleField === xField.toLowerCase() || ruleField === ((this.design['xAxisTitle'] as string) ?? '').toLowerCase()) {
        candidates.splice(1, 1);
      } else if (ruleField === yField.toLowerCase()
        || ruleField === ((this.design['yAxisTitle'] as string) ?? '').toLowerCase()
        || ruleField === seriesName.toLowerCase()) {
        candidates.splice(0, 1);
      }
      if (rule.operator === 'Between' && this.matchesColorRule(value, rule.operator, rule.value, rule.value2)) return rule.color;
      if (candidates.some(candidate => this.matchesColorRule(candidate, rule.operator, rule.value, rule.value2))) return rule.color;
    }
    return undefined;
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

  private pointDataWithOverrides(
    data: number[], seriesName: string, useCategoryFallback = true, includeCategoryRule = true,
  ): (number | { y: number; color: string })[] {
    return data.map((value, index) => {
      const category = this.categories[index]?.label ?? '';
      const color = (includeCategoryRule ? this.categoryColorForRule(category, seriesName) : undefined)
        ?? this.colorOverrideFor(category, seriesName)
        ?? this.colorForRule(category, value, seriesName, includeCategoryRule)
        ?? (useCategoryFallback ? this.colorAssignmentFor(category, seriesName) : undefined);
      if (color) return { y: value, color };
      return useCategoryFallback
        ? { y: value, color: this.fallbackColor(`${seriesName}:${category}`, index) }
        : value;
    });
  }

  private rebuildChartOptions(): void {
    this.chartOptions = applyDataLabelPreference(
      applyScenarioChartReadability(
        applyChartSort(this.buildOptionsFor(this.chartView, this.chartSize, key => this.selectCategory(key)), this.design['sortOrder'] as string | undefined),
        this.scenarioForecastLabels.length > 0,
      ),
      this.design['showDataLabels'] as boolean | undefined,
    );
    if (this.hasDrillDown) {
      const self = this;
      // Make each x-axis category label clickable: unlike a point click (which also passes the
      // series), a label click drills down by that category only → totals for that month.
      const bindAxisLabelDrilldown = function (this: Highcharts.Chart): void {
        const axis = (this as any).xAxis?.[0];
        if (!axis?.ticks) return;
        Object.keys(axis.ticks).forEach((key: string) => {
          const tick = axis.ticks[key];
          const label = tick?.label;
          if (!label?.element || label.ddBound) return;
          label.ddBound = true;
          label.css({ cursor: 'pointer' });
          label.on('click', () => {
            const category = (axis.categories && axis.categories[tick.pos]) || label.textStr || '';
            if (category) self.navigateToDrillDown(category, undefined);
          });
        });
      };
      this.chartOptions = {
        ...this.chartOptions,
        chart: {
          ...((this.chartOptions.chart as object) ?? {}),
          events: {
            ...((this.chartOptions.chart as any)?.events ?? {}),
            render: bindAxisLabelDrilldown,
          },
        } as Highcharts.ChartOptions,
        plotOptions: {
          ...(this.chartOptions.plotOptions ?? {}),
          series: {
            ...((this.chartOptions.plotOptions as any)?.series ?? {}),
            cursor: 'pointer',
            events: { click: function(e: any) { const p = e?.point; const isCircular = p?.series?.type === 'pie' || p?.series?.type === 'funnel'; const cat = (isCircular ? (p?.name ?? p?.category) : (p?.category ?? p?.name)) ?? ''; const seriesName = (!isCircular && self.multiSeriesData.length > 0) ? (p?.series?.name ?? '') : ''; self.navigateToDrillDown(cat || undefined, seriesName || undefined); } },
          },
        },
      };
    }
    this.chartOptions = applyLineDataLabelLayout(applyChartZoom(this.chartOptions));
    if (this.design['chartType'] === 'scatter') {
      const showSeries = this.chartView === 'scatter' && !!this.design['scatterCategoryColumn'];
      this.multiSeriesData = showSeries
        ? (this.chartOptions.series as { name?: string; color?: string }[]).map(s => ({ name: s.name ?? '', data: [], color: s.color ?? '' }))
        : [];
    }
    this.chartOptions = {
      ...this.chartOptions,
      chart: { ...(this.chartOptions.chart as object), height: null },
    };
  }

  private rebuildChartOptions2(): void {
    this.chartOptions2 = applyLineDataLabelLayout(applyChartZoom(applyDataLabelPreference(
      applyScenarioChartReadability(
        applyChartSort(this.buildOptionsFor(this.chartView2, this.chartSize2, key => this.selectCategory2(key)), this.design['sortOrder'] as string | undefined),
        this.scenarioForecastLabels.length > 0,
      ),
      this.design['showDataLabels'] as boolean | undefined,
    )));
  }

  private buildOptionsFor(view: ChartView, size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    switch (view) {
      case 'table':   return {};
      case 'combo':   return this.buildComboOptions(size);
      case 'grouped': return this.buildGroupedOptions(size);
      case 'stacked': return this.buildStackedOptions(size);
      case 'donut':   return this.buildDonutOptions(size, onSelect);
      case 'pie':     return this.buildPieOptions(size, onSelect);
      case 'funnel':  return this.buildFunnelOptions(size, onSelect);
      case 'bar':     return this.buildColumnOptions(size, onSelect);
      case 'column':  return this.buildHorizontalBarOptions(size, onSelect);
      case 'trend':
      case 'area':    return this.buildLineOptions('areaspline', size, onSelect);
      case 'spline':  return this.buildLineOptions('spline', size, onSelect);
      case 'treemap': return this.buildTreemapOptions(size);
      case 'waterfall': return this.buildWaterfallOrScatterOptions(view, size);
      case 'scatter': return this.buildScatterOptions(size);
      case 'kpi':       return buildKpiChartOptions(computeKpiValue(this.filteredRows, this.design), CHART_HEIGHT_BY_SIZE[size]);
      case 'gauge':     return this.buildGaugeOptions(size);
      case 'histogram': return this.buildHistogramOptions(size);
      case 'bullet':    return this.buildBulletOptions(size);
      case 'bubble':    return this.buildBubbleOptions(size);
      case 'heatmap':   return this.buildHeatmapOptions(size);
      case 'sankey':    return this.buildSankeyOptions(size);
      case 'timeline':  return this.buildTimelineOptions(size);
      default:        return this.buildLineOptions('line', size, onSelect);
    }
  }

  private buildTreemapOptions(size: ChartSize): Highcharts.Options {
    return {
      chart: { type: 'treemap' as any, backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false },
      series: [{
        type: 'treemap' as any, name: this.chart.title, layoutAlgorithm: 'squarified', dataLabels: { enabled: true },
        data: this.categories.map(c => ({ name: c.label, value: c.value, color: c.color })),
      }],
    };
  }

  private buildFunnelOptions(size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    const options = buildFunnelOptions(
      this.categories.map(category => category.label), this.categories.map(category => category.value),
      this.categories.map(category => category.color), CHART_HEIGHT_BY_SIZE[size], this.chart.title, false,
    );
    options.xAxis = { visible: false };
    options.yAxis = { visible: false, title: { text: undefined } };
    // Funnel stages are re-ordered by value, so match the clicked stage by name, not by position.
    options.plotOptions!.funnel!.point = {
      events: { click: event => onSelect(this.categories.find(category => category.label === event.point.name)?.key ?? '') },
    };
    return options;
  }

  /** One point per row at (numeric X, numeric Y); an optional Category column colours the points. */
  private buildScatterOptions(size: ChartSize): Highcharts.Options {
    const xColumn = this.design['xAxis'] as string ?? '';
    const yColumn = (this.design['yAggColumn'] as string) || (this.design['yAxis'] as string) || '';
    const showAxis = this.design['showAxisTitle'] as boolean;
    return buildScatterOptions({
      rows: this.filteredRows, xColumn, yColumn,
      categoryColumn: (this.design['scatterCategoryColumn'] as string) || undefined,
      xTitle: showAxis ? ((this.design['xAxisTitle'] as string) || xColumn) : undefined,
      yTitle: showAxis ? ((this.design['yAxisTitle'] as string) || yColumn) : undefined,
      height: CHART_HEIGHT_BY_SIZE[size],
      colorFor: category => category
        ? (this.categoryColorForRule(category, yColumn) ?? this.colorOverrideFor(category, yColumn) ?? this.colorAssignmentFor(category, yColumn))
        : undefined,
    });
  }

  private buildWaterfallOrScatterOptions(view: 'waterfall' | 'scatter', size: ChartSize): Highcharts.Options {
    return {
      chart: { type: view as any, backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: this.categories.map(c => c.label), lineColor: '#E7ECF3' },
      yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6' },
      series: [{ type: view as any, name: this.chart.title, data: this.categories.map((category, index) => ({
        y: category.value, color: this.categoryColorForRule(category.label)
          ?? this.colorOverrideFor(category.label, this.design['yAxis'] as string ?? 'Value')
          ?? this.colorForRule(category.label, category.value, this.design['yAxis'] as string ?? 'Value')
          ?? this.colorAssignmentFor(category.label, this.design['yAxis'] as string ?? 'Value')
          ?? this.fallbackColor(`${this.design['yAxis'] as string ?? 'Value'}:${category.label}`, index),
      })), showInLegend: false }],
    };
  }

  /** Single aggregated number, no axes — solid-gauge needs a min/max range. */
  private buildGaugeOptions(size: ChartSize): Highcharts.Options {
    const yAxis = this.design['yAxis'] as string ?? '';
    const col = (this.design['yAggColumn'] as string) || yAxis;
    const nums = this.filteredRows.map(r => Number(r[col])).filter(v => !Number.isNaN(v));
    let value: number;
    if (yAxis === 'Average (F)') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (yAxis === 'Min (F)') value = nums.length ? Math.min(...nums) : 0;
    else if (yAxis === 'Max (F)') value = nums.length ? Math.max(...nums) : 0;
    else if (yAxis === 'Count (F)' || yAxis === 'Count Distinct (F)') value = this.filteredRows.length;
    else value = nums.reduce((a, b) => a + b, 0);
    const min = (this.design['gaugeMin'] as number) ?? 0;
    const max = (this.design['gaugeMax'] as number) ?? 100;
    return {
      chart: { type: 'solidgauge' as any, backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false },
      pane: { startAngle: -90, endAngle: 90, background: [{ backgroundColor: '#EEE', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }] } as any,
      yAxis: { min, max, stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']], lineWidth: 0, tickWidth: 0, minorTickInterval: null as any, labels: { enabled: false } } as any,
      plotOptions: { solidgauge: { dataLabels: { y: -30, borderWidth: 0, format: '<div style="text-align:center"><span style="font-size:22px;font-weight:600">{y}</span></div>' } } } as any,
      series: [{ type: 'solidgauge' as any, name: col || 'Value', data: [value] }],
    };
  }

  private buildHistogramOptions(size: ChartSize): Highcharts.Options {
    const col = (this.design['yAggColumn'] as string) || (this.design['yAxis'] as string) || '';
    return buildHistogramOptions(this.filteredRows, col, this.design['histogramBins'] as number | undefined, CHART_HEIGHT_BY_SIZE[size], COLORS);
  }

  /** Reuses X-axis category + Y-axis value, adds an optional Target column per category. */
  private buildBulletOptions(size: ChartSize): Highcharts.Options {
    const xAxis = this.design['xAxis'] as string ?? '';
    const measureCol = (this.design['yAggColumn'] as string) || (this.design['yAxis'] as string) || '';
    const targetCol = (this.design['bulletTargetColumn'] as string) ?? '';
    const grouped = this.groupRowsByXAxis(xAxis);
    const categories: string[] = [];
    const data: Array<{ y: number; target?: number; color: string }> = [];
    for (const [k, rows] of grouped) {
      categories.push(k);
      const y = this.aggregate(rows, xAxis, this.design['yAxis'] as string ?? '', this.design['yAggColumn'] as string ?? '').vals[0] ?? 0;
      const target = targetCol ? rows.reduce((sum, r) => sum + (Number(r[targetCol]) || 0), 0) : undefined;
      const seriesName = measureCol || 'Value';
      const color = this.categoryColorForRule(k, seriesName)
        ?? this.colorOverrideFor(k, seriesName)
        ?? this.colorForRule(k, y, seriesName)
        ?? this.colorAssignmentFor(k, seriesName)
        ?? this.fallbackColor(`${seriesName}:${k}`, data.length);
      data.push(target !== undefined ? { y, target, color } : { y, color });
    }
    return {
      chart: {
        type: 'bullet' as any, inverted: true, backgroundColor: '#FFFFFF', height: CHART_HEIGHT_BY_SIZE[size],
        scrollablePlotArea: { minHeight: Math.max(CHART_HEIGHT_BY_SIZE[size], categories.length * 28 + 80), opacity: 1 },
      },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories, title: { text: undefined } },
      yAxis: { title: { text: undefined }, gridLineWidth: 0 },
      plotOptions: { series: { pointPadding: 0.25, borderWidth: 0, color: COLORS[0], targetOptions: { width: '200%' } } } as any,
      series: [{ type: 'bullet' as any, name: measureCol || 'Value', data }],
    };
  }

  /** Reuses X-axis category + Y-axis value (aggregated), adds a required Size column (aggregated) per category. */
  private buildBubbleOptions(size: ChartSize): Highcharts.Options {
    const xAxis = this.design['xAxis'] as string ?? '';
    const measureCol = (this.design['yAggColumn'] as string) || (this.design['yAxis'] as string) || '';
    const sizeCol = (this.design['bubbleSizeColumn'] as string) ?? '';
    const grouped = this.groupRowsByXAxis(xAxis);
    const data: Array<{ x: number; y: number; z: number; name: string; color: string }> = [];
    let i = 0;
    for (const [k, rows] of grouped) {
      const y = rows.reduce((sum, r) => sum + (Number(r[measureCol]) || 0), 0);
      const z = sizeCol ? rows.reduce((sum, r) => sum + (Number(r[sizeCol]) || 0), 0) : 1;
      data.push({ x: i, y, z, name: k, color: COLORS[i % COLORS.length] });
      i++;
    }
    return {
      chart: { type: 'bubble', zoomType: 'xy', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: [...grouped.keys()], title: { text: undefined } },
      yAxis: { title: { text: undefined } },
      plotOptions: { bubble: { minSize: 6, maxSize: 40 } },
      series: [{ type: 'bubble' as const, name: measureCol || 'Value', data }],
    };
  }

  /** X dimension x Y dimension grid, coloured by the aggregated Intensity / Value. */
  private buildHeatmapOptions(size: ChartSize): Highcharts.Options {
    const xColumn = this.design['xAxis'] as string ?? '';
    const yColumn = (this.design['heatmapYColumn'] as string) ?? '';
    return buildHeatmapOptions({
      rows: this.filteredRows, xColumn, yColumn,
      ...resolveHeatmapMeasure(this.design['yAggColumn'] as string, this.design['yAxis'] as string),
      xTitle: (this.design['xAxisTitle'] as string) || undefined, yTitle: (this.design['yAxisTitle'] as string) || undefined,
      height: CHART_HEIGHT_BY_SIZE[size], showLegend: this.design['showLegend'] !== false,
    });
  }

  /** From/To/Weight relationship — no xAxis/yAxis at all. */
  private buildSankeyOptions(size: ChartSize): Highcharts.Options {
    const from = (this.design['sankeyFromColumn'] as string) ?? '';
    const to = (this.design['sankeyToColumn'] as string) ?? '';
    const weightCol = (this.design['sankeyWeightColumn'] as string) ?? '';
    const weightMap = new Map<string, number>();
    for (const row of this.filteredRows) {
      const f = safeString(row[from]), t = safeString(row[to]);
      if (!f || !t) continue;
      const key = `${f}\u2192${t}`;
      weightMap.set(key, (weightMap.get(key) ?? 0) + (Number(row[weightCol]) || 0));
    }
    const data = [...weightMap.entries()].map(([key, weight]) => {
      const [f, t] = key.split('\u2192');
      return [f, t, weight] as [string, string, number];
    });
    // Nodes stack per column, so only the tallest column needs vertical room.
    const columnSize = Math.max(new Set(data.map(([f]) => f)).size, new Set(data.map(([, t]) => t)).size);
    const minHeight = columnSize * 24 + 40;
    const scroll = minHeight > CHART_HEIGHT_BY_SIZE[size];
    return {
      chart: {
        type: 'sankey', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size],
        // Keeps right-column labels clear of the scrollbar.
        ...(scroll ? { spacingRight: 24, scrollablePlotArea: { minHeight } } : {}),
      },
      title: { text: undefined }, credits: { enabled: false },
      series: [{ type: 'sankey' as const, name: weightCol || 'Flow', keys: ['from', 'to', 'weight'], minLinkWidth: 1, data } as any],
    };
  }

  private buildTimelineOptions(size: ChartSize): Highcharts.Options {
    return buildTimelineOptions(this.filteredRows, {
      start: (this.design['timelineDateColumn'] as string) ?? '',
      end: (this.design['timelineEndColumn'] as string) ?? '',
      task: (this.design['timelineLabelColumn'] as string) ?? '',
    }, CHART_HEIGHT_BY_SIZE[size]);
  }

  private groupRowsByXAxis(xAxis: string): Map<string, Record<string, unknown>[]> {
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of this.filteredRows) {
      const key = safeString(row[xAxis]) || '(empty)';
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  chartViewLabel(view: ChartView): string { return chartViewLabel(view); }
  chartViewIcon(view: ChartView): ChartViewIcon { return chartViewIcon(view); }
  get showChartViewDropdown(): boolean { return this.chartViewOptions.length > 1; }

  private computeChartViewOptions(saved: ChartView): ChartView[] {
    if (saved === 'decompositiontree') return [saved, 'table'];
    return chartSwitchOptions(saved, this.design);
  }

  private buildStackedOptions(size: ChartSize): Highcharts.Options {
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xTitle = showAxis ? ((this.design['xAxisTitle'] as string) || undefined) : undefined;
    const yTitle = showAxis ? ((this.design['yAxisTitle'] as string) || undefined) : undefined;
    const isMulti = this.multiSeriesData.length > 0;
    return {
      chart: { type: 'column', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      xAxis: { categories: this.categories.map(c => c.label), title: { text: xTitle }, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6', stackLabels: { enabled: this.design['showStackTotal'] !== false } },
      tooltip: { shared: true },
      plotOptions: {
        column: { stacking: 'normal', borderWidth: 0, borderRadius: 0,
          dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600', textOutline: 'none', color: '#fff' } } },
      },
      series: isMulti
        ? this.multiSeriesData.map(s => s.name === 'Total'
            ? ({ type: 'line' as any, name: s.name, data: this.pointDataWithOverrides(s.data, s.name, false), color: '#374151', yAxis: 0, marker: { enabled: true, radius: 3 }, lineWidth: 2, dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '700', textOutline: 'none' } } } as Highcharts.SeriesOptionsType)
            : ({ type: 'column' as const, name: s.name, data: this.pointDataWithOverrides(s.data, s.name, false), color: s.color } as Highcharts.SeriesOptionsType))
        : [{ type: 'column' as const, name: this.chart.title, data: this.categories.map(category => ({ y: category.value, color: category.color })), colorByPoint: true, showInLegend: false }],
    };
  }

  private buildGroupedOptions(size: ChartSize): Highcharts.Options {
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xAxisTitle = showAxis ? ((this.design['xAxisTitle'] as string) || undefined) : undefined;
    const yAxisTitle = showAxis ? ((this.design['yAxisTitle'] as string) || undefined) : undefined;
    const yAxis2Title = (this.design['yAxis2Title'] as string) || '';
    // Grouped bars with a secondary (right) Y-axis: series in comboLineColumns render as bars on axis 1.
    const comboLineCols = (this.design['comboLineColumns'] as string[]) ?? [];
    const isMulti = this.multiSeriesData.length > 0;
    const hasDualY = isMulti && comboLineCols.length > 0;
    return {
      chart: { type: 'column', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: this.categories.map(c => c.label),
        title: xAxisTitle ? { text: xAxisTitle } : { text: undefined },
        labels: { style: { fontSize: '11px', color: '#667085' } },
        lineColor: '#E7ECF3',
      },
      yAxis: hasDualY
        ? [
            { title: yAxisTitle ? { text: yAxisTitle } : { text: undefined }, gridLineColor: '#F1F3F6' },
            { title: { text: yAxis2Title || undefined }, opposite: true, gridLineWidth: 0 },
          ]
        : {
            title: yAxisTitle ? { text: yAxisTitle } : { text: undefined },
            gridLineColor: '#F1F3F6',
          },
      tooltip: { shared: true },
      plotOptions: {
        column: {
          grouping: true,
          borderWidth: 0,
          borderRadius: 2,
          dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600', textOutline: 'none' } },
        },
      },
      series: isMulti
        ? this.multiSeriesData.map(s => ({ type: 'column' as const, name: s.name, data: this.pointDataWithOverrides(s.data, s.name, false), color: s.color, ...(hasDualY ? { yAxis: comboLineCols.includes(s.name) ? 1 : 0 } : {}) }))
        : [{ type: 'column' as const, name: this.chart.title, data: this.categories.map(category => ({ y: category.value, color: category.color })), colorByPoint: true, showInLegend: false }],
    };
  }

  private buildComboOptions(size: ChartSize): Highcharts.Options {
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xAxisTitle  = showAxis ? ((this.design['xAxisTitle']  as string) || undefined) : undefined;
    const yAxisTitle  = showAxis ? ((this.design['yAxisTitle']  as string) || undefined) : undefined;
    const yAxis2Title = (this.design['yAxis2Title'] as string) || '';
    const comboLineCols = (this.design['comboLineColumns'] as string[]) ?? [];
    const xCats = this.categories.map(c => c.label);

    const barSeries: Highcharts.SeriesOptionsType[] = this.multiSeriesData
      .filter(s => !comboLineCols.includes(s.name))
      .map(s => ({
        type: 'column' as const,
        name: s.name,
        data: this.pointDataWithOverrides(s.data, s.name, false),
        color: s.color,
        yAxis: 0,
        stack: 'main',
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600', textOutline: 'none' } },
      }));

    const lineSeries: Highcharts.SeriesOptionsType[] = this.multiSeriesData
      .filter(s => comboLineCols.includes(s.name))
      .map(s => ({
        type: 'line' as const,
        name: s.name,
        data: this.pointDataWithOverrides(s.data, s.name, false),
        color: s.color,
        yAxis: 1,
        marker: { enabled: true, radius: 4 },
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '700', textOutline: 'none', color: s.color } },
      }));

    // fallback: no multi-series data configured — render as simple column
    if (barSeries.length === 0 && lineSeries.length === 0) {
      return this.buildColumnOptions(size, () => {});
    }

    return {
      chart: { zoomType: 'xy' as any, backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: xCats,
        title: xAxisTitle ? { text: xAxisTitle } : { text: undefined },
        labels: { style: { fontSize: '11px', color: '#667085' } },
        lineColor: '#E7ECF3',
      },
      yAxis: [
        {
          title: { text: yAxisTitle || undefined },
          gridLineColor: '#F1F3F6',
          labels: { style: { color: '#667085' } },
        },
        {
          title: { text: yAxis2Title || undefined },
          opposite: true,
          gridLineWidth: 0,
          labels: { style: { color: '#667085' } },
        },
      ],
      tooltip: { shared: true },
      plotOptions: {
        column: {
          stacking: 'normal',
          borderWidth: 0,
          groupPadding: 0.1,
        },
      },
      series: [...barSeries, ...lineSeries],
    };
  }

  private buildDonutOptions(size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    return {
      chart: { type: 'pie', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size], spacing: [8, 8, 8, 8] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      // Pie/donut charts have no axes — clearing them explicitly stops a stray axis title
      // (e.g. left over from a bar/line view) from reserving space and de-centering the pie.
      xAxis: { visible: false }, yAxis: { visible: false, title: { text: undefined } },
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
      plotOptions: { pie: { innerSize: '60%', borderWidth: 2, borderColor: '#fff', center: ['50%', '50%'],
        dataLabels: { enabled: true, distance: -28, format: '{point.y}', allowOverlap: true, crop: false, overflow: 'allow',
          style: { color: '#fff', fontWeight: '700', fontSize: '12px', textOutline: 'none' } } as any,
        point: { events: { click: (event) => onSelect(String(event.point.options.id ?? '')) } } } },
      series: [{ type: 'pie', name: this.chart.title,
        data: this.categories.map(c => ({ id: c.key, name: c.label, y: c.value, color: c.color,
          ...(c.value === 0 ? { dataLabels: { enabled: false } } : {}) })) }],
    };
  }

  private buildPieOptions(size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    return {
      chart: { type: 'pie', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size], spacing: [8, 8, 8, 8] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { visible: false }, yAxis: { visible: false, title: { text: undefined } },
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
      plotOptions: { pie: { innerSize: '0%', borderWidth: 2, borderColor: '#fff', center: ['50%', '50%'],
        dataLabels: { enabled: true, distance: -28, format: '{point.y}', allowOverlap: true, crop: false, overflow: 'allow',
          style: { color: '#fff', fontWeight: '700', fontSize: '12px', textOutline: 'none' } } as any,
        point: { events: { click: (event) => onSelect(String(event.point.options.id ?? '')) } } } },
      series: [{ type: 'pie', name: this.chart.title,
        data: this.categories.map(c => ({ id: c.key, name: c.label, y: c.value, color: c.color,
          ...(c.value === 0 ? { dataLabels: { enabled: false } } : {}) })) }],
    };
  }

  private buildColumnOptions(size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    const chartType = (this.design['chartType'] as string) ?? '';
    const isStacked = chartType === 'stacked';
    const isMulti = this.multiSeriesData.length > 0;
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xTitle = showAxis ? ((this.design['xAxisTitle'] as string) || undefined) : undefined;
    const yTitle = showAxis ? ((this.design['yAxisTitle'] as string) || undefined) : undefined;
    return {
      chart: { type: 'column', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: this.categories.map(c => c.label), title: { text: xTitle }, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
      plotOptions: { column: { borderRadius: isStacked ? 0 : 4, borderWidth: 0, colorByPoint: !isMulti, colors: isMulti ? undefined : this.categories.map(c => c.color),
        stacking: isStacked ? 'normal' as any : undefined,
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } },
        point: { events: { click: (event) => onSelect(this.categories[event.point.index]?.key ?? '') } } } },
      series: isMulti
        ? this.multiSeriesData.map(s => s.name === 'Total'
          ? { type: 'line' as any, name: s.name, data: this.pointDataWithOverrides(s.data, s.name, !isStacked), color: s.color, marker: { enabled: true }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } as any }
          : { type: 'column' as any, name: s.name, data: this.pointDataWithOverrides(s.data, s.name, !isStacked), color: s.color, stacking: isStacked ? 'normal' as any : undefined, showInLegend: true })
        : [{ type: 'column', name: this.chart.title, data: this.categories.map(category => ({ id: category.key, y: category.value, color: category.color })), showInLegend: false }],
    };
  }

  private buildHorizontalBarOptions(size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xTitle = showAxis ? ((this.design['xAxisTitle'] as string) || undefined) : undefined;
    const yTitle = showAxis ? ((this.design['yAxisTitle'] as string) || undefined) : undefined;
    return {
      chart: { type: 'bar', backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: this.categories.map(c => c.label), title: { text: xTitle }, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: { title: { text: yTitle }, gridLineColor: '#F1F3F6' },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
      plotOptions: { bar: { borderRadius: 4, borderWidth: 0, colorByPoint: true, colors: this.categories.map(c => c.color),
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600' } },
        point: { events: { click: (event) => onSelect(this.categories[event.point.index]?.key ?? '') } } } },
      series: [{ type: 'bar', name: this.chart.title, data: this.categories.map(category => ({ id: category.key, y: category.value, color: category.color })), showInLegend: false }],
    };
  }

  private buildLineOptions(hcType: 'line' | 'areaspline' | 'area' | 'spline', size: ChartSize, onSelect: (key: string) => void): Highcharts.Options {
    const isMulti = this.multiSeriesData.length > 0;
    const comboLineCols = (this.design['comboLineColumns'] as string[]) ?? [];
    const hasDualY = isMulti && comboLineCols.length > 0;
    const showAxis = this.design['showAxisTitle'] as boolean;
    const xAxisTitle  = showAxis ? ((this.design['xAxisTitle']  as string) || undefined) : undefined;
    const yAxisTitle  = showAxis ? ((this.design['yAxisTitle']  as string) || undefined) : undefined;
    const yAxis2Title = (this.design['yAxis2Title'] as string) || '';
    const yAxisConfig: any = hasDualY
      ? [
          { title: yAxisTitle ? { text: yAxisTitle } : { text: undefined }, gridLineColor: '#F1F3F6' },
          { title: yAxis2Title ? { text: yAxis2Title } : { text: undefined }, opposite: true, gridLineWidth: 0 },
        ]
      : { title: { text: yAxisTitle }, gridLineColor: '#F1F3F6' };
    return {
      chart: { type: hcType, backgroundColor: 'transparent', height: CHART_HEIGHT_BY_SIZE[size] },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: this.categories.map(c => c.label), title: { text: xAxisTitle }, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: yAxisConfig,
      // Multi-series (e.g. area after switching from stacked/grouped) shows every series for the
      // hovered category in one tooltip, matching stacked/grouped/multiline.
      tooltip: isMulti ? { shared: true } : { pointFormat: '<b>{point.y}</b>' },
      plotOptions: {
        line:       { marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        areaspline: { fillOpacity: 0.15, marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        area:       { fillOpacity: 0.15, marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        spline:     { marker: { radius: 4 }, dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
      },
      series: isMulti
        ? this.multiSeriesData.map(s => {
            const categoryColor = usesPeriodLineCategoryColorRules(
              this.design['chartType'] as string, this.design['xAxis'] as string, hcType,
            ) ? this.categoryColorForRule('', s.name) : undefined;
            return {
              type: hcType as any, name: s.name,
              data: this.pointDataWithOverrides(s.data, s.name, true, !categoryColor),
              color: categoryColor ?? s.color, showInLegend: true,
              yAxis: hasDualY && comboLineCols.includes(s.name) ? 1 : 0,
            } as Highcharts.SeriesOptionsType;
          })
        : (() => {
            const seriesName = String(this.design['yAggColumn'] || this.design['yAxis'] || this.chart.title);
            const categoryColor = usesPeriodLineCategoryColorRules(
              this.design['chartType'] as string, this.design['xAxis'] as string, hcType,
            ) ? this.categoryColorForRule('', seriesName) : undefined;
            return [{
              type: hcType, name: this.chart.title,
              data: this.categories.map(category => ({ id: category.key, y: category.value, color: category.color })),
              color: categoryColor, showInLegend: false,
            }];
          })(),
    };
  }

  selectCategory(key: string): void { this.selectedCategory = this.selectedCategory === key ? null : key; }

  // ─── Custom legend (mirrors the dashboard: hover-highlight, click-toggle) ─────
  readonly chartColors = COLORS;
  private chartInstance?: Highcharts.Chart;
  private chartResizeObserver?: ResizeObserver;

  onChartInstance(chart: Highcharts.Chart): void {
    this.chartInstance = chart;
    // The chart can initialise while the sidebar-collapse animation is still changing the page
    // width, so it renders blank until a manual reload. Reflow once layout settles, and keep
    // reflowing on any container resize so it always fits. (Reflow only re-measures/redraws —
    // it doesn't touch data, filters, or drilldown handlers.)
    requestAnimationFrame(() => requestAnimationFrame(() => { try { chart.reflow(); } catch { /* ignore */ } }));
    this.chartResizeObserver?.disconnect();
    const host = chart.container?.parentElement;
    if (host && typeof ResizeObserver !== 'undefined') {
      this.chartResizeObserver = new ResizeObserver(() => { try { chart.reflow(); } catch { /* ignore */ } });
      this.chartResizeObserver.observe(host);
    }
  }

  highlightSeries(index: number): void {
    const chart = this.chartInstance;
    if (!chart?.series) return;
    if (this.multiSeriesData.length > 0) {
      chart.series.forEach((s, i) => s.setState(i === index ? 'hover' : 'inactive'));
    } else {
      chart.series[0]?.points?.forEach((p, i) => p.setState((i === index ? 'hover' : 'inactive') as any));
    }
  }

  highlightCategory(key: string): void {
    const chart = this.chartInstance;
    if (!chart?.series || this.multiSeriesData.length > 0) return;
    const series = chart.series[0];
    const categoryIndex = this.categories.findIndex(category => category.key === key);
    const target = this.categoryPoint(key)
      ?? (series?.type !== 'pie'
        ? series?.points?.find(point => point.index === categoryIndex)
        : undefined);
    if (!target) {
      if (series?.type === 'pie' && this.categories[categoryIndex]?.value === 0) {
        series.points?.forEach(point => point.setState('inactive'));
      } else {
        this.resetSeriesHighlight();
      }
      return;
    }
    series?.points?.forEach(point => {
      if (point !== target) point.setState('inactive');
    });
    // Highcharts shares the hover halo between points, so highlight the target last.
    highlightLegendPoint(target);
  }

  resetSeriesHighlight(): void {
    const chart = this.chartInstance;
    if (!chart?.series) return;
    if (this.multiSeriesData.length > 0) chart.series.forEach(s => s.setState('normal'));
    else chart.series[0]?.points?.forEach(p => p.setState('' as any));
  }

  toggleSeries(index: number): void {
    const chart = this.chartInstance;
    if (!chart?.series) return;
    if (this.multiSeriesData.length > 0) {
      const s = chart.series[index];
      if (s) s.setVisible(!s.visible, true);
    } else {
      const pt = chart.series[0]?.points?.[index];
      if (pt) pt.setVisible(!pt.visible, true);
    }
  }

  toggleCategory(key: string): void {
    const point = this.categoryPoint(key);
    if (point) point.setVisible(!point.visible, true);
  }

  isSeriesHidden(index: number): boolean {
    const chart = this.chartInstance;
    if (!chart?.series) return false;
    if (this.multiSeriesData.length > 0) return chart.series[index]?.visible === false;
    return chart.series[0]?.points?.[index]?.visible === false;
  }

  isCategoryHidden(key: string): boolean {
    return this.categoryPoint(key)?.visible === false;
  }

  private categoryPoint(key: string): Highcharts.Point | undefined {
    return this.chartInstance?.series?.[0]?.points?.find(point => String(point.options.id ?? '') === key);
  }

  toggleChartViewMenu(): void { this.chartViewMenuOpen = !this.chartViewMenuOpen; }
  selectChartView(view: ChartView): void { this.chartView = view; this.chartViewMenuOpen = false; this.rebuildChartOptions(); this.forceChartRecreate(); }

  // Destroy + recreate the chart so Highcharts renders fresh options instead of deep-merging them
  // (a plain [options] update leaks e.g. a stacked view's `stacking` into the grouped view).
  // Synchronous detectChanges (not setTimeout) so the recreate paints in the same frame as the
  // table/legend — avoids the "table shows first, chart appears a tick later" gap.
  private forceChartRecreate(): void {
    this.chartInstance = undefined;
    this.chartVisible = false;
    this.cdr.detectChanges();
    this.chartVisible = true;
    this.cdr.detectChanges();
  }

  selectCategory2(key: string): void { this.selectedCategory2 = this.selectedCategory2 === key ? null : key; }
  toggleChartViewMenu2(): void { this.chartViewMenuOpen2 = !this.chartViewMenuOpen2; }
  selectChartView2(view: ChartView): void { this.chartView2 = view; this.chartViewMenuOpen2 = false; this.rebuildChartOptions2(); }

  @HostListener('document:click')
  onDocumentClick(): void { this.chartViewMenuOpen = false; this.chartViewMenuOpen2 = false; this.openFilterName = null; this.openLocalFilterId = null; this.showExportModal = false; this.trendMenuOpen = false; this.scenarioDropdownOpen = null; }

  showExportModal = false;
  isDownloading = false;
  toggleExportModal(): void { this.showExportModal = !this.showExportModal; }

  async exportAs(format: string): Promise<void> {
    if (this.isDownloading) return;
    this.showExportModal = false;
    const title = this.chart?.title ?? 'Chart';
    this.isDownloading = true;
    this.cdr.detectChanges();
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      switch (format) {
        case 'pdf': await this.exportPdf(title); break;
        case 'png': await this.exportPng(title); break;
        case 'csv': this.exportCsv(title); break;
        case 'xlsx': this.exportXlsx(title); break;
      }
    } catch (error) {
      console.error('Chart export failed:', error);
      this.notify.showError('Chart export failed. Please try again.');
    } finally {
      this.isDownloading = false;
      this.cdr.markForCheck();
    }
  }

  get hasDrillDown(): boolean { return !!(this.design['drillDownViewId']); }

  navigateToDrillDown(category?: string, series?: string): void {
    if (!this.hasDrillDown) return;
    const queryParams: Record<string, string> = { from: this.isStandardDetailContext ? 'standard' : 'wip' };
    if (category) queryParams['filter'] = category;
    if (series) queryParams['series'] = series;
    if (this.isTrendChart) queryParams['mode'] = this.trendMode;
    // Carry over the active global filter selections and date range so the drilldown reflects
    // the same slice of data the user was looking at on the chart.
    for (const key of ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']) {
      const value = this.filterValues[key];
      if (hasGlobalSelection(value)) queryParams[key] = globalSelectionQueryValue(value);
    }
    if (this.fromDate) queryParams['fromDate'] = this.fromDate;
    if (this.toDate) queryParams['toDate'] = this.toDate;
    // Carry over active local (interactive) filter selections too.
    const activeLocalFilters = this.filters
      .filter(f => f.value || (f.values?.length ?? 0) > 0)
      .map(f => ({
        label: f.label,
        sourceColumn: f.sourceColumn,
        value: f.controlType === 'MultiSelect' ? (f.values ?? []).join(',') : f.value,
      }));
    if (activeLocalFilters.length) queryParams['localFilters'] = JSON.stringify(activeLocalFilters);
    this.router.navigate(['/charts-tiles/view', this.chart.id, 'drilldown'], { queryParams });
  }

  /** Attached (inline) tile drill-down: opens the tile's own view, carrying the active global/date filters. */
  navigateInlineTileDrillDown(tile: { id: number; drillDownViewId?: number | null }): void {
    if (!tile.drillDownViewId) return;
    const queryParams: Record<string, string> = { from: this.isStandardDetailContext ? 'standard' : 'wip' };
    for (const key of ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']) {
      const value = this.filterValues[key];
      if (hasGlobalSelection(value)) queryParams[key] = globalSelectionQueryValue(value);
    }
    if (this.fromDate) queryParams['fromDate'] = this.fromDate;
    if (this.toDate) queryParams['toDate'] = this.toDate;
    this.router.navigate(['/charts-tiles/view', tile.id, 'drilldown'], { queryParams });
  }

  private prepareExportClone(document: Document, panel: HTMLElement, hideDataTable: boolean, expandPanel = false): void {
    if (expandPanel) {
      prepareIndividualChartExportClone(panel, panel.offsetWidth);
      for (let ancestor = panel.parentElement; ancestor; ancestor = ancestor.parentElement) {
        ancestor.style.setProperty('overflow', 'visible', 'important');
        ancestor.scrollTop = 0;
        ancestor.scrollLeft = 0;
      }
      const containers = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>(
        '.maxWidthmainall1, .wv-scenario-layout, .wv-scenario-layout__main, .wv-chart-inner, .odc-status__chart-card, .odc-status__chart-body, .wv-chart-visual, .wv-chart-table',
      ))];
      for (const container of containers) {
        container.style.setProperty('height', 'auto', 'important');
        container.style.setProperty('max-height', 'none', 'important');
        container.style.setProperty('overflow', 'visible', 'important');
        container.style.setProperty('flex', 'none', 'important');
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
      panel.style.setProperty('position', 'relative', 'important');
      panel.style.setProperty('inset', 'auto', 'important');
      for (const container of panel.querySelectorAll<HTMLElement>('.wv-chart-visual, .wv-chart-table')) {
        container.style.setProperty('width', '100%', 'important');
      }
      // Release the legend's copied on-screen dimensions when the export widens the chart.
      for (const legend of panel.querySelectorAll<HTMLElement>('.wv-chart-visual .wv-chart-legend')) {
        legend.style.setProperty('width', '100%', 'important');
        legend.style.setProperty('height', 'auto', 'important');
      }
    }
    if (hideDataTable && this.chartView !== 'table') {
      const table = panel.querySelector<HTMLElement>('.wv-chart-table');
      if (table) table.style.display = 'none';
      const visual = panel.querySelector<HTMLElement>('.wv-chart-visual');
      visual?.style.setProperty('flex', '1 1 100%', 'important');
      visual?.style.setProperty('width', '100%', 'important');
    } else {
      // Keep the table below the chart in exports, not beside it (its on-screen position) - side
      // by side leaves too little width per column once there are more than a couple of series.
      // (height/overflow/flex reset for .wv-chart-visual/.wv-chart-table already happens above.)
      panel.querySelector<HTMLElement>('.odc-status__chart-body')?.style.setProperty('flex-direction', 'column', 'important');
    }
    if (expandPanel) {
      for (const svg of panel.querySelectorAll<SVGSVGElement>('.wv-chart-visual svg.highcharts-root')) {
        const visual = svg.closest<HTMLElement>('.wv-chart-visual')!;
        const viewBox = svg.viewBox.baseVal;
        const sourceWidth = viewBox.width || svg.width.baseVal.value;
        const sourceHeight = viewBox.height || svg.height.baseVal.value;
        const width = visual.clientWidth;
        if (!width || !sourceWidth || !sourceHeight) continue;
        const height = width * sourceHeight / sourceWidth;
        if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${sourceWidth} ${sourceHeight}`);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.style.setProperty('width', `${width}px`, 'important');
        svg.style.setProperty('height', `${height}px`, 'important');
        svg.style.setProperty('display', 'block', 'important');
        // html2canvas replaces the chart's custom element with a fixed-size wrapper.
        // Resize every chart wrapper and reserve its height before the legend and table.
        for (let wrapper = svg.parentElement; wrapper && wrapper !== visual; wrapper = wrapper.parentElement) {
          wrapper.style.setProperty('width', `${width}px`, 'important');
          wrapper.style.setProperty('height', `${height}px`, 'important');
          wrapper.style.setProperty('min-height', '0', 'important');
          wrapper.style.setProperty('max-height', 'none', 'important');
          wrapper.style.setProperty('flex', 'none', 'important');
        }
        this.positionExportDonutCenter(svg, width / sourceWidth);
      }
    }
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!context || !document.defaultView) return;
    const properties = ['color', 'background-color', 'border-top-color', 'border-right-color',
      'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
      'box-shadow', 'text-shadow', 'background-image'];
    for (const element of [panel, ...Array.from(panel.querySelectorAll<HTMLElement>('*'))]) {
      const computed = document.defaultView.getComputedStyle(element);
      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        const normalized = value.replace(/(?:color|oklab|oklch|lab|lch)\([^()]*\)/g, color => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
          return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
        });
        if (normalized !== value) element.style.setProperty(property, normalized, 'important');
      }
    }
    void panel.offsetHeight;
  }

  /**
   * html2canvas freezes the "Total 100%" overlay at its on-screen pixel offset (and drops its
   * translate), so once the export widens the donut the label no longer sits in the hole.
   * Pin it explicitly to the pie centre, scaled the same way as the SVG.
   */
  private positionExportDonutCenter(svg: SVGSVGElement, scale: number): void {
    const donut = svg.closest<HTMLElement>('.odc-status__donut');
    const center = donut?.querySelector<HTMLElement>('.odc-status__donut-center');
    if (!donut || !center) return;
    const chart = this.chartInstance;
    const pieCenter = (chart?.series?.[0] as unknown as { center?: number[] } | undefined)?.center;
    const svgRect = svg.getBoundingClientRect();
    const donutRect = donut.getBoundingClientRect();
    const x = chart && pieCenter ? (chart.plotLeft + pieCenter[0]) * scale : svgRect.width / 2;
    const y = chart && pieCenter ? (chart.plotTop + pieCenter[1]) * scale : svgRect.height / 2;
    const left = svgRect.left - donutRect.left + x - center.offsetWidth / 2;
    const top = svgRect.top - donutRect.top + y - center.offsetHeight / 2;
    center.style.setProperty('left', `${left}px`, 'important');
    center.style.setProperty('top', `${top}px`, 'important');
    center.style.setProperty('transform', 'none', 'important');
  }

  private async exportPdf(title: string): Promise<void> {
    if (this.chartView === 'table') {
      createTablePdf(title, this.savedTableHeaders, this.savedTableRows, {
        headerColor: this.tableHeaderColor,
        headerTextColor: this.tableHeaderTextColor,
        rowColors: this.savedTableRowColors,
        rowTextColors: this.savedTableRowTextColors,
      }).save(`${title}.pdf`);
      return;
    }
    const el = document.querySelector('.wv-top-panel') as HTMLElement;
    if (!el) return;
    this.cdr.detectChanges();
    await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff',
      scrollX: 0, scrollY: 0,
      onclone: (document, panel) => { this.prepareExportClone(document, panel, false, true); return loadCloneFonts(document, panel); },
    }).then((canvas: HTMLCanvasElement) => {
      const imgData = canvas.toDataURL('image/png');
      const imgW = canvas.width;
      const imgH = canvas.height;
      const pdfW = 297;
      const pdfH = (imgH * pdfW) / imgW;
      const pageH = Math.max(pdfH + 20, 210);
      const pdf = new jsPDF({ orientation: pageH > pdfW ? 'portrait' : 'landscape', unit: 'mm', format: [pdfW, pageH] });
      pdf.addImage(imgData, 'PNG', 0, 10, pdfW, pdfH);
      pdf.save(`${title}.pdf`);
    });
  }

  private async exportPng(title: string): Promise<void> {
    if (this.chartView === 'table') {
      await createTableImage(title, this.savedTableHeaders, this.savedTableRows, {
        headerColor: this.tableHeaderColor,
        headerTextColor: this.tableHeaderTextColor,
        rowColors: this.savedTableRowColors,
        rowTextColors: this.savedTableRowTextColors,
      }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${title}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      });
      return;
    }
    const el = document.querySelector('.wv-top-panel') as HTMLElement;
    if (!el) return;
    this.cdr.detectChanges();
    await this.captureChartPng(el, title);
  }

  private async captureChartPng(panel: HTMLElement, title: string): Promise<void> {
    try {
      const canvas = await html2canvas(panel, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        onclone: (document, clone) => {
          this.prepareExportClone(document, clone, false, true);
          return loadCloneFonts(document, clone);
        },
      });
      const link = document.createElement('a');
      link.download = `${title}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Chart PNG export failed:', error);
      this.notify.showError('Chart PNG export failed. Please try again.');
    }
  }

  /** First data-table column header: the chosen X-axis (title or column), falling back to 'Parameter'. */
  get xAxisHeader(): string {
    return (this.design?.['xAxisTitle'] as string) || (this.design?.['xAxis'] as string) || 'Parameter';
  }

  get yAxisHeader(): string {
    return (this.design?.['yAxisTitle'] as string) || (this.design?.['yAxis'] as string) || 'Value';
  }

  private getTableData(): { headers: string[]; rows: (string | number)[][] } {
    if (this.advanced) return advancedChartExport(this.advanced);
    if (this.design['chartType'] === 'table') {
      return {
        headers: this.savedTableHeaders,
        rows: this.savedTableRows.map(row => row.map(value => typeof value === 'number' ? value : String(value ?? '\u2014'))),
      };
    }
    const headers = [this.xAxisHeader];
    const rows: (string | number)[][] = [];
    if (this.multiSeriesData.length > 0) {
      headers.push(...this.multiSeriesData.map(s => s.name));
      for (let i = 0; i < this.categories.length; i++) {
        rows.push([this.categories[i].label, ...this.multiSeriesData.map(s => s.data[i] ?? 0)]);
      }
    } else {
      headers.push(this.yAxisHeader);
      for (const cat of this.categories) {
        rows.push([cat.label, cat.value]);
      }
    }
    return { headers, rows };
  }

  private escapeCsv(value: string | number): string {
    const raw = String(value);
    const safeVal = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safeVal.replaceAll('"', '""')}"`;
  }

  private sanitizeSheetName(name: string): string {
    return (name.replace(/[:\\//?*[\]]/g, '_').substring(0, 31)) || 'Sheet';
  }

  private exportCsv(title: string): void {
    const { headers, rows } = this.getTableData();
    const csvRows = [headers.map(h => this.escapeCsv(h)).join(','), ...rows.map(r => r.map(v => this.escapeCsv(v)).join(','))];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private exportXlsx(title: string): void {
    const tableEl = document.querySelector('.wv-top-panel .wv-chart-table table') as HTMLTableElement
      ?? document.querySelector('.wv-data-table') as HTMLElement;
    if (!this.advanced && tableEl?.tagName === 'TABLE') {
      const wb = XLSX.utils.table_to_book(tableEl, { sheet: this.sanitizeSheetName(title) });
      XLSX.writeFile(wb, `${title}.xlsx`);
      return;
    }
    const { headers, rows } = this.getTableData();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 25 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.sanitizeSheetName(title));
    XLSX.writeFile(wb, `${title}.xlsx`);
  }

  setChartSize(size: ChartSize): void { this.chartSize = size; this.rebuildChartOptions(); }
  toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
      // Let Highcharts fill the CSS container height instead of the fixed size value
      this.chartOptions = { ...this.chartOptions, chart: { ...(this.chartOptions.chart as object), height: null } };
    } else {
      this.rebuildChartOptions();
    }
  }

  setChartSize2(size: ChartSize): void { this.chartSize2 = size; this.rebuildChartOptions2(); }
  toggleExpand2(): void { this.isExpanded2 = !this.isExpanded2; }
  togglePin(): void     { this.pinned = !this.pinned; }
  toggleFavorite(): void {
    if (!this.savedWidget) return;
    const ctrlType = this.isTile ? 3 : 2;
    const newState = !this.chart.favorite;
    this.chart.favorite = newState; // optimistic
    this.widgetService.toggleFavourite(ctrlType, this.savedWidget.id).subscribe({
      next: (pref) => { this.chart.favorite = pref.isFavourite; this.cdr.markForCheck(); },
      error: () => { this.chart.favorite = !newState; this.cdr.markForCheck(); },
    });
  }
  goBack(): void        { this.location.back(); }

  publishWidget(): void {
    if (!this.savedWidget || this.isPublishing()) return;
    this.isPublishing.set(true);
    this.widgetService.updateWidget(this.savedWidget.id, {
      name: this.savedWidget.name, type: this.savedWidget.type, libraryId: this.savedWidget.libraryId ?? 0,
      source: this.savedWidget.source ?? '', sourceType: this.savedWidget.sourceType ?? 'Table',
      designJson: this.savedWidget.designJson ?? '', categoryId: this.savedWidget.categoryId ?? 2, status: 'published',
    }).subscribe({
      next: (publishedWidget) => {
        this.isPublished = true;
        if (this.savedWidget) { this.savedWidget.status = 'published'; }
        this.isPublishing.set(false);
        const wasDraftCopy = publishedWidget.id !== this.savedWidget?.id;
        const publishedName = wasDraftCopy ? publishedWidget.name : this.savedWidget?.name;
        this.notify.showSuccess(`'${publishedName}' published successfully.`);
        if (wasDraftCopy) {
          this.toastService.pending = `'${publishedName}' updated successfully.`;
          this.router.navigate(['/charts-tiles/standard-charts']);
        }
        this.cdr.markForCheck();
      },
      error: () => { this.isPublishing.set(false); this.cdr.markForCheck(); },
    });
  }

  unpublishWidget(): void {
    if (!this.savedWidget || !this.canUnpublishWidget || this.isPublishing()) return;
    this.isPublishing.set(true);
    this.widgetService.updateWidget(this.savedWidget.id, {
      name: this.savedWidget.name,
      type: this.savedWidget.type,
      libraryId: this.savedWidget.libraryId,
      source: this.savedWidget.source,
      sourceType: this.savedWidget.sourceType,
      sourceId: this.savedWidget.sourceId ?? null,
      description: this.savedWidget.description ?? '',
      designJson: this.savedWidget.designJson,
      categoryId: this.savedWidget.categoryId,
      status: 'draft',
    }).subscribe({
      next: () => {
        this.listRouteReuse.invalidate(this.isTile ? 'wip-tiles' : 'wip-charts');
        this.listRouteReuse.invalidate(this.isTile ? 'standard-tiles' : 'standard-charts');
        this.toastService.pending = `'${this.savedWidget?.name}' moved to Draft.`;
        this.router.navigate([this.isTile ? '/charts-tiles/wip-tiles' : '/charts-tiles/wip-charts']);
      },
      error: () => {
        this.isPublishing.set(false);
        this.notify.showError(`Failed to unpublish '${this.savedWidget?.name ?? 'widget'}'.`);
        this.cdr.markForCheck();
      },
    });
  }

  editInBuilder(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    if (this.isTile) {
      this.router.navigate(['/charts-tiles/tile-builder'], { queryParams: { editId: id, returnUrl: this.router.url } });
    } else {
      this.router.navigate(['/charts-tiles/edit', id], { queryParams: { returnUrl: this.router.url } });
    }
  }

  confirmDelete(): void { this.showDeleteConfirm = true; }
  cancelDelete(): void  { this.showDeleteConfirm = false; }

  deleteWidget(): void {
    if (!this.savedWidget || this.isDeleting()) return;
    this.showDeleteConfirm = false;
    this.isDeleting.set(true);
    const name = this.savedWidget.name;
    this.widgetService.deleteWidget(this.savedWidget.id).subscribe({
      next: () => {
        this.toastService.pending = `'${name}' deleted successfully.`;
        this.router.navigate([this.isTile ? '/charts-tiles/wip-tiles' : '/charts-tiles/wip-charts']);
      },
      error: () => { this.isDeleting.set(false); this.cdr.markForCheck(); },
    });
  }
}

import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartZoom } from '../../../core/utils/chart-zoom.util';
import { highlightLegendPoint } from '../../../core/utils/chart-legend-hover.util';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import type Highcharts from 'highcharts';
import { CellMouseOutEvent, CellMouseOverEvent, ColDef, RowClassParams, themeQuartz } from 'ag-grid-community';
import { DateUtil } from '../../../core/utils/date.util';
import { getViewDateRangeDefaults, replaceViewDateRangeParameters } from '../../../core/utils/view-date-parameters.util';
import { CategoryService } from '../../../core/services/category.service';
import { Widget, WidgetService } from '../../../core/services/widget.service';
import { CommonApiService, DatabaseViewListItem, PlantFilterDto } from '../../../core/services/common-api.service';
import { MarketplaceService } from '../../../core/services/marketplace.service';
import { ImportedDatasetService, ImportedDatasetListItem } from '../../../core/services/imported-dataset.service';
import { AiChartPreset, AiChartPresetService } from '../../../core/services/ai-chart-preset.service';
import { AiChartState, AiChartSuggestRequest, AiChartSuggestion, AiService } from '../../../core/services/ai.service';
import { LearnVideoService } from '../../../core/services/learn-video.service';
import { ChartTemplatesService, ChartTemplateDto } from '../../../core/services/chart-templates.service';
import { ToastService } from '../../../core/services/toast.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import {
  createDefaultDaxMeasure,
  createDefaultDaxModel,
  cloneDaxModel,
  parseDaxExpression,
  validateDaxExpression,
  evaluateDaxMeasure,
  appendDaxTotalToSeries,
  evaluateDaxMeasureForRow,
  formatDaxValue,
  getDaxReferencedColumns,
  daxSummaryCells,
  renameDaxColumn,
  DAX_FUNCTION_SNIPPETS,
  buildDaxOperationExpression,
  restoreDaxOperation,
  validateDaxMeasureDraft,
} from '../../../core/utils/dax-evaluator.util';
import type { DaxMeasureConfig, DaxDisplayPreference, DaxEvaluationScope, DaxModelConfig, DaxAstNode } from '../../../core/utils/dax-evaluator.util';
import { DaxModelService, SavedDaxModelDto, DaxModelSaveRequest } from '../../../core/services/dax-model.service';
import { CONDITIONAL_FILTER_OPERATORS, applyConditionalFilters, matchesConditionalFilter } from '../../../core/utils/conditional-filter.util';
import { toReportFilters } from '../../../core/utils/report-filter.util';
import { ParameterFilterRule, ParameterFilterAction, applyParameterFilters, getSavedParameterFilters, getRuleSourceColumns, getParameterRuleError, countJsonPathMatches, getTransformationSourceColumns, getParameterSelectionError } from '../../../core/utils/parameter-filter.util';
import { appendLockedFilterTitle } from '../../../core/utils/locked-filter-title.util';
import { getSuggestedChartTypeIds } from '../../../core/utils/chart-suggestions.util';
import { CHART_AUTO_COLORS, chartFallbackColor, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import { AdvancedFilterComponent } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { ADVANCED_CHART_LABELS, AdvancedChartConfig, AdvancedChartType, applyAdvancedDefaultMapping, defaultAdvancedConfig, isAdvancedChart, normalizeAdvancedChartType, readAdvancedConfig, remapAdvancedColumns, validateAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';

export type { DaxMeasureConfig, DaxCalculatedColumnConfig, DaxDisplayPreference, DaxEvaluationScope, DaxModelConfig, DaxAstNode, DaxToken } from '../../../core/utils/dax-evaluator.util';

export type ChartTypeId = AdvancedChartType | 'bar' | 'line' | 'pie' | 'donut' | 'kpi' | 'table' | 'trend' | 'multiline' | 'area' | 'spline' | 'column' | 'funnel' | 'stacked' | 'combo' | 'grouped' | 'waterfall' | 'treemap' | 'scatter' | 'histogram' | 'gauge' | 'bullet' | 'sankey' | 'timeline' | 'bubble' | 'heatmap';
export type LimitCategory = 'all' | 'top' | 'bottom';

/** Shown when no valid category can be resolved — see resolvedCategoryId. */
const CATEGORY_REQUIRED_MESSAGE =
  'Select a category before saving. If the category list is empty, reload the page — categories could not be loaded.';
export type TrendMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const TREND_CHART_TYPES: ChartTypeId[] = ['line', 'multiline', 'grouped', 'stacked', 'area'];

export interface InteractiveFilter {
  id: number;
  label: string;
  controlType: string;
  sourceTable: string;
  sourceColumn: string;
  /** When true the control's value can't be changed in the chart view. */
  locked?: boolean;
  /** When true the control is not rendered in chart view; only its saved value is applied. */
  hidden?: boolean;
  /** Value frozen at lock-time (single-value control types); applied wherever this filter is rendered. */
  lockedValue?: string;
  /** Values frozen at lock-time (MultiSelect); applied wherever this filter is rendered. */
  lockedValues?: string[];
}

export interface ConditionalFilter {
  id: number;
  label: string;
  sourceTable: string;
  sourceColumn: string;
  operator: string;
  /** Free-text condition value; when set it overrides the picked values. */
  valueText: string;
  /** 'Exclude' inverts the condition result. */
  mode: string;
  /** When true the control is not rendered in chart view; only its saved values are applied. */
  hidden: boolean;
  values: string[];
}

export interface ChartTypeOption {
  id: ChartTypeId;
  label: string;
  /** Installed marketplace visual: selecting the option picks 'customvisual' with this renderer. */
  renderer?: string;
  image?: string;
}

/** A single "Color Rules" row: highlight a color when a field matches a condition. Mock data only, no backend yet. */
export interface ColorRule {
  id: number;
  field: string;
  operator: string;
  value: string;
  value2?: string;
  categories?: string[];
  color: string;
}

/** A previously-saved Data Mapping / Display & Ranking preset, applied via "Setup Options". */
export interface SavedChartSetupConfig {
  xAxis: string;
  yAxis: string;
  xAxisTitle: string;
  yAxisTitle: string;
  showLegend: boolean;
  includeDataTable: boolean;
  showAxisTitle: boolean;
  limitCategory: LimitCategory;
  topN: number;
  bottomN: number;
  rankBy: string;
}

/** Read-only summaries of setup sections 4-9 shown in the Use Saved Setup preview. */
export interface SavedChartSetupPreview {
  interactiveFilters: string[];
  conditionalFilters: string[];
  transformations: string[];
  attachedTiles: string[];
  drillDownView: string;
  daxEnabled: boolean;
  daxMeasures: string[];
}

export interface SavedChartSetup {
  id: string;
  customName: string;
  name: string;
  chartTypeLabel: string;
  source: string;
  lastUsed: string;
  accent: 'blue' | 'green' | 'purple' | 'orange' | 'yellow';
  config: SavedChartSetupConfig;
  /** Read-only summaries of setup sections 4-9 for the preview panel. */
  preview: SavedChartSetupPreview;
  /** Full design blob (chart's chartJson) used to restore every setup section on apply. */
  templateJson?: string;
}

export interface ChartModelOption {
  id: string;
  label: string;
  icon: 'derrick' | 'gauge' | 'crew' | 'calendar' | 'trend';
  columns: number;
  modelType: 'Table' | 'View' | 'Import';
  iconBg: string;
}

export interface BuilderTab {
  id: string;
  label: string;
}

/** Dummy "Saved Models" card shown in the DAX Model section's Saved Models tab. */
function savedModelSubtitle(calculatedBy: string, operation: string | null | undefined, columnCount: number): string {
  return `${calculatedBy} · ${operation || 'Expression'} · ${columnCount} ${columnCount === 1 ? 'column' : 'columns'}`;
}

function toSavedModelCard(m: SavedDaxModelDto): DaxSavedModelCard {
  return { id: String(m.id), name: m.name, subtitle: savedModelSubtitle(m.calculatedBy, m.operation, m.columns.length), tags: m.columns, expression: m.expression };
}

interface DaxSavedModelCard {
  id: string;
  name: string;
  subtitle: string;
  tags: string[];
  expression: string;
  sourceId?: string;
}

/** Per-tab chart configuration snapshot */
interface ChartTabState {
  chartTitle: string;
  chartDescription: string;
  selectedChartType: ChartTypeId | null;
  selectedLibraryId: number | null;
  selectedChartModelId: string;
  dataSourceMode: 'table' | 'view' | 'import';
  xAxis: string;
  yAxis: string;
  yAggColumn: string;
  xAxisTitle: string;
  yAxisTitle: string;
  showLegend: boolean;
  includeDataTable: boolean;
  showAxisTitle: boolean;
  showDataLabels: boolean;
  showStackTotal: boolean;
  limitCategory: LimitCategory;
  topN: number;
  bottomN: number;
  groupRestAsOthers: boolean;
  multiYColumns: string[];
  interactiveFilters: InteractiveFilter[];
  conditionalFilters: ConditionalFilter[];
  parameterFilters: ParameterFilterRule[];
  attachedTileIds: number[];
  selectedCategoryId: number;
  category: string;
  viewId: number | null;
  tableRowColors: string[];
  tableHeaderColor: string;
  tableHeaderTextColor: string;
  tableRowTextColors: string[];
  comboLineColumns: string[];
  yAxis2Title: string;
  drillDownViewId: number | null;
  trendMode: TrendMode;
  daxModel: DaxModelConfig;
  gaugeMin: number;
  gaugeMax: number;
  bulletTargetColumn: string;
  bubbleSizeColumn: string;
  heatmapYColumn: string;
  sankeyFromColumn: string;
  sankeyToColumn: string;
  sankeyWeightColumn: string;
  timelineDateColumn: string;
  timelineLabelColumn: string;
  colorRules: ColorRule[];
  colorOverrides: Record<string, string>;
  advancedConfig?: AdvancedChartConfig;
  previewFilterValues?: Record<number, string>;
  previewFilterMultiValues?: Record<number, string[]>;
}

/** Row key in core.LearnVideos for this screen's Learn video. */
const LEARN_SCREEN_KEY = 'chart-builder';

export interface LearnChapter {
  id: string;
  label: string;
  time: number;
  durationLabel: string;
}

export interface HelpArticle {
  id: string;
  question: string;
  steps: string[];
  expanded: boolean;
}

const GROUP_LABELS = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E'];
const GROUP_COLORS = [...CHART_AUTO_COLORS];
const GROUP_VALUES = [88, 57, 94, 51, 68];

function safeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

@Component({
  selector: 'app-chart-builder',
  standalone: false,
  templateUrl: './chart-builder.component.html',
  styleUrls: ['./chart-builder.component.scss'],
})
export class ChartBuilderComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  @ViewChild('advancedFilter') private advancedFilter?: AdvancedFilterComponent;
  chartTitle = 'Chart Name';
  chartDescription = '';
  editingDescription = false;

  get displayChartTitle(): string {
    return appendLockedFilterTitle(this.chartTitle, { interactiveFilters: this.interactiveFilters });
  }
  editingTitle = false;

  categories: string[] = [];
  private apiCategories: { categoryId: number; categoryName: string }[] = [];
  category = '';
  showCategoryDropdown = false;

  private categorySub!: Subscription;

  tabs: BuilderTab[] = [{ id: 'chart-1', label: 'Chart' }];
  activeTabId = 'chart-1';
  private nextTabIndex = 2;
  private readonly tabStates = new Map<string, ChartTabState>();
  private readonly savedChartIds = new Map<string, number>();
  private draftStorageKey = '';
  private draftReady = false;
  private discardDraftOnExit = false;
  private savedDraftBaseline = '';
  private sourceLoadVersion = 0;
  private previewFilterVersion = 0;
  private previewFilterPending = false;
  sourceError = '';
  showAddPageConfirm = false;

  locked = false;
  zoomLevel = 100;
  panelCollapsed = false;
  openSections = new Set<number>([1]);
  private _prevSidebarState: boolean | undefined;
  private returnUrl = '/charts-tiles/wip-charts';

  isSectionOpen(n: number): boolean { return this.openSections.has(n); }
  toggleSection(n: number): void {
    // Display & Ranking has no table-relevant options, so it stays collapsed for tables.
    if (n === 3 && this.selectedChartType === 'table') return;
    if (this.openSections.has(n)) { this.openSections.delete(n); }
    else { this.openSections.add(n); }
  }

  // ─── Color Rules: highlight a color when a field matches a condition. ──
  colorRuleFields = ['Category', 'Progress%', 'Status', 'Quantity', 'Priority'];
  colorRuleOperators = ['>=', '<=', '>', '<', 'Equal', 'Not Equal', 'Between'];
  colorRuleValueOptions = ['Active', 'Inactive', 'Pending', 'Completed'];
  private nextColorRuleId = 1;
  colorRules: ColorRule[] = [];
  colorOverrides: Record<string, string> = {};
  colorPickerOpen = false;
  colorPickerX = 0;
  colorPickerY = 0;
  colorPickerValue = '#3B82F6';
  private colorPickerKey = '';
  categoryRuleMenuId: number | null = null;

  isColorRuleValueField(rule: ColorRule): boolean {
    return rule.field === 'Status';
  }

  isPeriodColorRule(rule: ColorRule): boolean {
    return rule.field.toLowerCase() === 'period' && this.xAxis.trim().toLowerCase() === 'period';
  }

  get periodColorRuleValues(): string[] {
    const previewPeriods = this.previewData.categories;
    const rowPeriods = this.previewRows.map(row => String(row[this.xAxis] ?? ''));
    return [...new Set((previewPeriods.length ? previewPeriods : rowPeriods).filter(period => period.trim().length > 0))];
  }

  get colorRuleCategories(): string[] {
    if (this.xAxis.trim().toLowerCase() === 'period') {
      const seriesNames = this.chartPreviewOptions?.series?.map(series => series.name ?? '') ?? [];
      const mappedNames = [
        ...(this.isMultiSeriesType ? this.multiYColumns : []),
        ...this.comboLineColumns,
      ];
      return [...new Set((seriesNames.length ? seriesNames
        : mappedNames.length ? mappedNames : [this.getPreviewSeriesName()]).filter(Boolean))];
    }
    if (this.usesSemanticSeriesColors) {
      return [...new Set([
        this.yAxisExtraColumn,
        ...this.multiYColumns,
        ...this.comboLineColumns,
      ].filter(Boolean))];
    }
    // Before a preview is built, offer the X-axis values of the loaded rows — never
    // `this.categories`, which is the list of chart folders (DFCT0010592).
    const fromRows = this.xAxis ? this.previewRows.map(row => String(row[this.xAxis] ?? '')) : [];
    return [...new Set(this.previewData.categories.length ? this.previewData.categories : fromRows)].filter(Boolean);
  }

  isCategoryColorRule(rule: ColorRule): boolean {
    return rule.field === 'Category';
  }

  onColorRuleFieldChange(rule: ColorRule): void {
    if (this.isCategoryColorRule(rule)) {
      rule.operator = '';
      rule.value = '';
      rule.value2 = undefined;
      rule.categories = rule.categories ?? [];
    } else {
      rule.categories = undefined;
      if (this.isPeriodColorRule(rule)) {
        if (rule.operator !== 'Equal' && rule.operator !== 'Not Equal') rule.operator = 'Equal';
        rule.value = '';
        rule.value2 = undefined;
      }
    }
    this.onColorRuleChange();
  }

  filteredColorRuleFields(): string[] {
    const fields = this.xAxis.trim().toLowerCase() === 'period'
      ? [this.colorRuleFields[0], 'Period', ...this.colorRuleFields.slice(1)]
      : this.colorRuleFields;
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? fields.filter(o => o.toLowerCase().includes(t)) : fields;
  }

  selectColorRuleField(rule: ColorRule, value: string): void {
    rule.field = value;
    this.onColorRuleFieldChange(rule);
    this.openFilterField = null;
  }

  filteredColorRuleOperators(rule?: ColorRule): string[] {
    const operators = rule && this.isPeriodColorRule(rule)
      ? ['Equal', 'Not Equal']
      : this.colorRuleOperators;
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? operators.filter(o => o.toLowerCase().includes(t)) : operators;
  }

  selectColorRuleOperator(rule: ColorRule, value: string): void {
    rule.operator = value;
    this.onColorRuleChange();
    this.openFilterField = null;
  }

  categoryRuleMenuPos: { top: number; left: number; minWidth: number } = { top: 0, left: 0, minWidth: 220 };

  toggleCategoryRuleMenu(rule: ColorRule, event?: Event): void {
    const willOpen = this.categoryRuleMenuId !== rule.id;
    if (event) {
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        const zoom = this.appZoomFactor();
        this.categoryRuleMenuPos = {
          top: (rect.bottom + 4) / zoom,
          left: rect.left / zoom,
          minWidth: Math.max(220, rect.width / zoom),
        };
      }
    }
    // Close any other open dropdown so only one stays open at a time.
    this.closeAllDropdowns();
    this.categoryRuleMenuId = willOpen ? rule.id : null;
  }

  isCategoryRuleMenuOpen(rule: ColorRule): boolean {
    return this.categoryRuleMenuId === rule.id;
  }

  toggleColorRuleCategory(rule: ColorRule, category: string): void {
    const selected = new Set(rule.categories ?? []);
    if (selected.has(category)) selected.delete(category);
    else selected.add(category);
    rule.categories = [...selected];
    this.onColorRuleChange();
  }

  colorRuleCategoryLabel(rule: ColorRule): string {
    const count = rule.categories?.length ?? 0;
    return count ? `${count} selected` : 'Select categories';
  }

  addColorRule(): void {
    this.colorRules.push({ id: this.nextColorRuleId++, field: '', operator: '', value: '', value2: '', color: '#3B82F6' });
    this.cdr.markForCheck();
    this.refreshPreview();
  }

  removeColorRule(id: number): void {
    this.colorRules = this.colorRules.filter(r => r.id !== id);
    this.cdr.markForCheck();
    this.refreshPreview();
  }

  onColorRuleChange(): void {
    this.refreshPreview();
  }

  openPointColorPicker(category: string, seriesName: string, event: Event, anchor?: { left: number; right: number; top: number }): void {
    event.preventDefault();
    event.stopPropagation();
    this.colorPickerKey = `${seriesName}:${category}`;
    this.colorPickerValue = this.colorOverrides[this.colorPickerKey] ?? '#3B82F6';
    const mouse = event as MouseEvent;
    const pickerWidth = 260;
    const pickerHeight = 56;
    const targetBounds = anchor;
    const preferredX = targetBounds ? targetBounds.right + 8 : mouse.clientX;
    const rightAlignedX = targetBounds ? targetBounds.left - pickerWidth - 8 : preferredX;
    const pickerX = preferredX + pickerWidth > window.innerWidth - 8 ? rightAlignedX : preferredX;
    const preferredY = targetBounds?.top ?? mouse.clientY;
    this.colorPickerX = Math.max(8, Math.min(pickerX, window.innerWidth - pickerWidth - 8));
    this.colorPickerY = Math.max(8, Math.min(preferredY, window.innerHeight - pickerHeight - 8));
    this.colorPickerOpen = true;
    this.cdr.markForCheck();
  }

  applyPointColor(color: string): void {
    if (!this.colorPickerKey) return;
    this.colorOverrides = { ...this.colorOverrides, [this.colorPickerKey]: color };
    this.colorPickerOpen = false;
    this.refreshPreview();
  }

  clearPointColor(): void {
    if (!this.colorPickerKey) return;
    const colorOverrides = { ...this.colorOverrides };
    delete colorOverrides[this.colorPickerKey];
    this.colorOverrides = colorOverrides;
    this.closePointColorPicker();
    this.refreshPreview();
  }

  closePointColorPicker(): void {
    this.colorPickerOpen = false;
    this.colorPickerKey = '';
  }

  // ─── Saved Setup modal: accordion state for its preview panel (mirrors isSectionOpen/toggleSection) ──
  savedSetupOpenSections = new Set<number>([2]);
  isSavedSetupSectionOpen(n: number): boolean { return this.savedSetupOpenSections.has(n); }
  toggleSavedSetupSection(n: number): void {
    if (this.savedSetupOpenSections.has(n)) { this.savedSetupOpenSections.delete(n); }
    else { this.savedSetupOpenSections.add(n); }
  }
  showClearAllConfirm = false;

  showGlobalFilter = true;
  filterFields: { key: string; label: string; options: string[] }[] = [
    { key: 'country', label: 'Country', options: [] },
    { key: 'sector', label: 'Sector', options: [] },
    { key: 'businessUnit', label: 'Business Unit', options: [] },
    { key: 'division', label: 'Division', options: [] },
    { key: 'cluster', label: 'Cluster', options: [] },
    { key: 'plant', label: 'Plant', options: [] },
  ];
  readonly quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After'];
  filterValues: Record<string, string> = {
    country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
  };
  quickRange = '';
  fromDate = '';
  toDate = '';
  openGlobalFilterName: string | null = null;
  private allPlants: PlantFilterDto[] = [];
  private readonly viewDateParameters = new Map<number, { fromDate: boolean; toDate: boolean }>();
  private readonly viewSqlCache = new Map<number, string>();

  toggleGlobalFilter(): void { this.showGlobalFilter = !this.showGlobalFilter; }

  clearAllFilters(): void {
    this.quickRange = '';
    this.resetGlobalFilterDateRange();
    this.openGlobalFilterName = null;
    this.showDateRangePopup = false;
    this.resetGlobalFiltersToDefaults();
    this.reloadGlobalViewPreview();
    this.persistEditorDraft();
  }

  toggleGlobalFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openGlobalFilterName = this.openGlobalFilterName === name ? null : name;
  }

  selectGlobalFilterOption(name: string, value: string): void {
    if (name === 'quickRange') {
      this.quickRange = value;
      this.applyQuickRange(value);
      this.openGlobalFilterName = null;
      this.reloadGlobalViewPreview();
      return;
    }
    this.filterValues[name] = value || 'All';
    const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const index = hierarchy.indexOf(name);
    for (let i = index + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
    this.rebuildGlobalFilterOptions();
    this.openGlobalFilterName = null;
    this.reloadGlobalViewPreview();
  }

  isGlobalFilterLocked(index: number): boolean {
    return !this.isAdmin && this.filterFields[index].options.length === 1;
  }

  private loadGlobalFilters(): void {
    this.commonApi.getPlantFilters().pipe(takeUntil(this.destroy$)).subscribe({
      next: plants => {
        this.allPlants = plants;
        this.filterFields[0].options = this.distinctPlantValues(plants, p => p.country);
        this.resetGlobalFiltersToDefaults();
        this.refreshPreview();
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  private resetGlobalFiltersToDefaults(): void {
    this.filterValues = {
      country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
    };
    this.autoSelectGlobalFilters();
    this.rebuildGlobalFilterOptions();
  }

  private rebuildGlobalFilterOptions(): void {
    const active = (value: string) => value && value !== 'All';
    const selectors: ((plant: PlantFilterDto) => string)[] = [
      p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription,
    ];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(plant => selectors[i](plant) === this.filterValues[keys[i]]);
      this.filterFields[i + 1].options = active(this.filterValues[keys[i]])
        ? this.distinctPlantValues(filtered, selectors[i + 1])
        : [];
    }
    if (!active(this.filterValues['cluster']) && this.filterFields[4].options.length === 1) {
      this.filterValues['cluster'] = this.filterFields[4].options[0];
    }
    if (active(this.filterValues['cluster'])) filtered = filtered.filter(plant => plant.cluster === this.filterValues['cluster']);
    this.filterFields[5].options = this.distinctPlantValues(filtered, selectors[5]);
    if (!active(this.filterValues['plant']) && this.filterFields[5].options.length === 1) {
      this.filterValues['plant'] = this.filterFields[5].options[0];
    }
  }

  private autoSelectGlobalFilters(): void {
    const active = (value: string) => value && value !== 'All';
    const selectors: ((plant: PlantFilterDto) => string)[] = [
      p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription,
    ];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    if (this.filterFields[0].options.length === 1) this.filterValues['country'] = this.filterFields[0].options[0];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(plant => selectors[i](plant) === this.filterValues[keys[i]]);
      const options = this.distinctPlantValues(filtered, selectors[i + 1]);
      if (options.length === 1 && active(this.filterValues[keys[i]])) this.filterValues[keys[i + 1]] = options[0];
    }
  }

  private applyQuickRange(range: string): void {
    const today = new Date();
    const start = new Date(today);
    if (range === 'Today') {
      // Keep today's date in both fields.
    } else if (range === 'Till Last Tuesday') {
      const daysSinceTuesday = (today.getDay() + 5) % 7;
      start.setDate(today.getDate() - daysSinceTuesday - 7);
    } else if (range === 'This Week') {
      start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    } else if (range === 'This Month') {
      start.setDate(1);
    } else if (range === 'Last Month') {
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      start.setFullYear(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
      this.fromDate = this.toInputDate(start);
      this.toDate = this.toInputDate(lastMonthEnd);
      return;
    } else if (range === 'This Quarter') {
      start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
    } else if (range === 'This Year') {
      start.setMonth(0, 1);
    } else if (range === 'After') {
      this.toDate = '';
      return;
    } else {
      return;
    }
    this.fromDate = this.toInputDate(start);
    this.toDate = this.toInputDate(today);
  }

  private resetGlobalFilterDateRange(): void {
    const today = new Date();
    this.fromDate = `${today.getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(today);
  }

  private toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

  onGlobalDateChange(): void {
    this.reloadGlobalViewPreview();
  }

  private reloadGlobalViewPreview(): void {
    this.chartPreviewOptions = null;
    this.chartRenderVisible = false;
    if (this.dataSourceMode === 'table' && this.selectedChartModelId) {
      this.chartRenderVisible = true;
      this.sourceLoading = true;
      this.loadColumnsForSource({ name: this.selectedChartModelId, sourceType: 'Table' }, {
        xAxis: this.xAxis, yAxis: this.yAxis, yAggColumn: this.yAggColumn,
      });
      return;
    }
    if (this.dataSourceMode !== 'view' || !this.selectedView?.id) {
      this.chartRenderVisible = true;
      this.refreshPreview();
      return;
    }
    this.sourceLoading = true;
    this.widgetService.getFilteredChartData({
      chartSource: this.selectedChartModelId,
      chartSourceType: 'View',
      viewId: this.selectedView.id,
      filters: [...this.lockedInteractiveFilterPayload(), ...this.globalHierarchyFilterPayload()],
      ...this.viewDatePayload(this.selectedView.id),
      mode: this.isTrendChart ? this.trendMode : undefined,
    }).pipe(
      takeUntil(this.destroy$),
    ).subscribe({
      next: res => {
        this.sourceLoading = false;
        this.rawLoadedColumns = res.columns ?? [];
        this.rawLoadedRows = res.rows ?? [];
        this.applyParameterDrivenTransformations();
        // detectChanges (not markForCheck) so the chart repaints immediately when data arrives,
        // instead of waiting for the next user event to trigger change detection.
        this.cdr.detectChanges();
      },
      error: () => {
        this.sourceLoading = false;
        this.refreshPreview();
        this.cdr.detectChanges();
      },
    });
  }

  private lastTuesday(date: Date): string {
    const result = new Date(date);
    const daysSinceTuesday = (result.getDay() + 5) % 7;
    result.setDate(result.getDate() - daysSinceTuesday);
    return this.toInputDate(result);
  }

  private injectGlobalFilterParams(sql: string): string {
    const declarations: Record<string, string> = {
      country: this.filterValues['country'],
      sector: this.filterValues['sector'],
      businessUnit: this.filterValues['businessUnit'],
      division: this.filterValues['division'],
      cluster: this.filterValues['cluster'],
      plant: this.filterValues['plant'],
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
    return replaceViewDateRangeParameters(sql, this.fromDate, this.toDate);
  }

  private loadViewDateParameters(viewId: number, completed?: () => void): void {
    if (this.viewDateParameters.has(viewId)) {
      completed?.();
      return;
    }
    this.commonApi.getDatabaseViewById(viewId).pipe(takeUntil(this.destroy$)).subscribe({
      next: view => {
        this.viewSqlCache.set(viewId, view.generatedSql ?? '');
        const defaults = getViewDateRangeDefaults(view.generatedSql ?? '');
        this.viewDateParameters.set(viewId, {
          fromDate: defaults.hasStartDate,
          toDate: defaults.hasEndDate || defaults.hasFutureDate,
        });
        if (defaults.hasFutureDate) {
          if (defaults.fromDate) this.fromDate = defaults.fromDate;
          if (defaults.toDate) this.toDate = defaults.toDate;
          this.quickRange = '';
        }
        completed?.();
        this.cdr.markForCheck();
      },
      error: () => {
        this.viewDateParameters.set(viewId, { fromDate: false, toDate: false });
        completed?.();
      },
    });
  }

  private viewDatePayload(viewId: number | null): { fromDate?: string; toDate?: string } {
    const parameters = viewId == null ? undefined : this.viewDateParameters.get(viewId);
    return {
      fromDate: parameters?.fromDate && this.fromDate ? this.fromDate : undefined,
      toDate: parameters?.toDate && this.toDate ? this.toDate : undefined,
    };
  }

  // Loads the initial preview for a saved chart whose source is a view, applying the
  // chart's saved locked filters/date params — same request shape used while editing.
  private hydrateViewSourcePreview(source: string, viewId: number, d: any): void {
    this.loadViewDateParameters(viewId, () => this.widgetService.getFilteredChartData({
      chartSource: source,
      chartSourceType: 'View',
      viewId,
      filters: [...this.lockedInteractiveFilterPayload(), ...this.globalHierarchyFilterPayload()],
      ...this.viewDatePayload(viewId),
      mode: this.isTrendChart ? this.trendMode : undefined,
    }).subscribe({
      next: (res) => {
        if (res?.columns?.length) {
          this.rawLoadedColumns = res.columns;
          this.rawLoadedRows = res.rows ?? [];
          this.applyParameterDrivenTransformations();
          this.xAxis = d.xAxis || (res.columns[0] ?? ''); this.yAxis = d.yAxis ?? 'Count (F)'; this.yAggColumn = d.yAggColumn ?? '';
          if (this.selectedChartType) this.refreshPreview(); else this.chartPreviewOptions = null;
          this.cdr.markForCheck();
        }
      },
      error: () => {},
    }));
  }

  private distinctPlantValues(plants: PlantFilterDto[], selector: (plant: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(value => !!value))].sort((a, b) => a.localeCompare(b));
  }

  private readonly undoStack: ChartTabState[] = [];
  private readonly redoStack: ChartTabState[] = [];
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  // Learn video modal
  @ViewChild('learnVideo') private readonly learnVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('daxFormError') private readonly daxFormErrorRef?: ElementRef<HTMLElement>;
  showLearnModal = false;
  learnVideoUrl = 'assets/videos/chart-builder-overview.mp4';
  learnVideoPoster = 'assets/images/learn-video-poster.jpg';
  learnChapters: LearnChapter[] = [
    { id: 'choose-type',  label: 'Choose Chart Type', time: 0,   durationLabel: '1:20' },
    { id: 'add-data',     label: 'Add Data',          time: 80,  durationLabel: '1:20' },
    { id: 'use-filters',  label: 'Use Filters',       time: 160, durationLabel: '1:20' },
    { id: 'save-publish', label: 'Save & Publish',    time: 240, durationLabel: '1:20' },
  ];
  isVideoPlaying = false;
  videoCurrentTime = 0;
  videoDuration = 0;
  videoMuted = false;
  playbackRate = 1;
  helpfulVote: 'yes' | 'no' | null = null;

  // Help modal
  showHelpModal = false;
  helpSearchTerm = '';
  helpVote: 'yes' | 'no' | null = null;
  helpArticles: HelpArticle[] = [
    {
      id: 'deduplicate-rows',
      question: 'How do I choose which duplicate rows to keep?',
      expanded: false,
      steps: [
        'Choose Deduplicate Rows and select the source columns.',
        'Rule Parameters starts at Select. Choose Keep First, Keep Last or Keep Unique Only.',
        'An enabled rule does not run and cannot be saved until a strategy is selected.',
      ],
    },
    {
      id: 'change-data-type',
      question: 'How do I choose a data type?',
      expanded: false,
      steps: [
        'Choose Change Data Type in Data Transformation and select the source columns.',
        'The Rule Parameters dropdown starts at Select. Choose Number, Text, Date or Boolean.',
        'An enabled rule does not run and cannot be saved until a target data type is selected.',
      ],
    },
    {
      id: 'choose-chart-type',
      question: 'How do I choose a chart type?',
      expanded: false,
      steps: [
        'Pick a chart model from the list on the right panel.',
        'Select the chart type (bar, line, pie, donut, KPI, table, or trend).',
        'The canvas updates with a live preview as you configure it.',
      ],
    },
    {
      id: 'add-data-fields',
      question: 'How do I add data fields?',
      expanded: false,
      steps: [
        'Choose a data source/model for the chart.',
        'Map the axis, value, or aggregation fields you want to visualize.',
        'The preview refreshes automatically as fields are mapped.',
      ],
    },
    {
      id: 'apply-filters',
      question: 'How do I apply filters?',
      expanded: false,
      steps: [
        'Open the interactive filters section for this chart.',
        'Add a filter and pick its source column and control type.',
        'Filters narrow down the data shown in the chart preview.',
      ],
    },
    {
      id: 'save-chart',
      question: 'How do I save the chart?',
      expanded: false,
      steps: [
        'Click Save once the chart type and data look right.',
        'Give the chart a name and pick a category.',
        'Confirm to publish it to WIP Charts.',
      ],
    },
  ];

  get filteredHelpArticles(): HelpArticle[] {
    const term = this.helpSearchTerm.trim().toLowerCase();
    if (!term) return this.helpArticles;
    return this.helpArticles.filter(a => a.question.toLowerCase().includes(term));
  }

  chartModels: ChartModelOption[] = [
    { id: 'wells',           label: 'Wells',           icon: 'gauge',    columns: 24, modelType: 'Table', iconBg: 'linear-gradient(135deg,#FCD34D,#F59E0B)' },
    { id: 'crew',            label: 'Crew',            icon: 'crew',     columns: 24, modelType: 'View',  iconBg: 'linear-gradient(135deg,#818CF8,#4338CA)' },
    { id: 'ph-productivity', label: 'PH Productivity', icon: 'trend',    columns: 24, modelType: 'View',  iconBg: 'linear-gradient(135deg,#60A5FA,#3B82F6)' },
    { id: 'activities',      label: 'Activities',      icon: 'derrick',  columns: 24, modelType: 'Table', iconBg: 'linear-gradient(135deg,#FCD34D,#F59E0B)' },
    { id: 'daily-plan',      label: 'Daily Plan',      icon: 'calendar', columns: 24, modelType: 'View',  iconBg: 'linear-gradient(135deg,#4ADE80,#16A34A)' },
  ];
  selectedChartModelId = '';
  showChartModelDropdown = false;
  chartModelSearch = '';

  /** Toggle between Table (common sources), View (database views), and Import (uploaded files) */
  dataSourceMode: 'table' | 'view' | 'import' = 'table';
  availableViews: DatabaseViewListItem[] = [];
  viewSearch = '';

  // Imported (CSV/XLSX/XLS/JSON) file data sources — kept separate from chartModels so the
  // getBISources() refresh (below) never wipes out uploaded datasets.
  importedChartModels: ChartModelOption[] = [];
  availableImportDatasets: ImportedDatasetListItem[] = [];
  importUploading = false;
  importUploadError: string | null = null;
  importDragOver = false;
  importPasteMode = false;
  importPasteText = '';
  /** User must pick a format badge first so they know what they're about to upload. */

  get filteredViews(): DatabaseViewListItem[] {
    const term = this.viewSearch.trim().toLowerCase();
    if (!term) return this.availableViews;
    return this.availableViews.filter(v => v.viewName.toLowerCase().includes(term));
  }

  get selectedView(): DatabaseViewListItem | undefined {
    return this.availableViews.find(v => v.viewName === this.selectedChartModelId);
  }

  get filteredChartModels(): ChartModelOption[] {
    const term = this.chartModelSearch.trim().toLowerCase();
    if (!term) return this.chartModels;
    return this.chartModels.filter(m => m.label.toLowerCase().includes(term));
  }

  get filteredImportedDatasets(): ImportedDatasetListItem[] {
    const term = this.chartModelSearch.trim().toLowerCase();
    if (!term) return this.availableImportDatasets;
    return this.availableImportDatasets.filter(d => d.datasetName.toLowerCase().includes(term));
  }

  get selectedChartModel(): ChartModelOption | undefined {
    return this.chartModels.find(m => m.id === this.selectedChartModelId)
        ?? this.importedChartModels.find(m => m.id === this.selectedChartModelId);
  }

  get selectedImportDataset(): ImportedDatasetListItem | undefined {
    return this.availableImportDatasets.find(d => String(d.id) === this.selectedChartModelId);
  }

  /** Display order: table first, then pie/donut, bar family, line family. */
  private readonly chartTypeOrder: ChartTypeId[] = [
    'table',
    'pie', 'donut',
    'bar', 'stacked', 'grouped', 'combo', 'column', 'waterfall',
    'line', 'area', 'multiline', 'spline', 'scatter', 'bubble',
    'trend', 'kpi',
    'funnel', 'treemap', 'histogram', 'gauge', 'bullet', 'sankey', 'timeline', 'heatmap',
    ...Object.keys(ADVANCED_CHART_LABELS) as AdvancedChartType[],
  ];

  chartTypeSearch = '';
  chartTypeFilterMode: 'all' | 'suggested' = 'all';
  private chartSuggestionCache?: { columns: string[]; rows: Record<string, unknown>[]; ids: string[] };
  chartTypes: ChartTypeOption[] = [
    { id: 'table', label: 'Table' },
    { id: 'pie', label: 'Pie' },
    { id: 'donut', label: 'Donut' },
    { id: 'bar', label: 'Bar' },
    { id: 'line', label: 'Line' },
    { id: 'trend', label: 'Trend' },
  ];
  selectedChartType: ChartTypeId | null = null;
  trendMode: TrendMode = 'monthly';
  selectedLibraryId: number | null = null;
  selectedCategoryId = 0;

  /** Columns from the selected source — X-axis options */
  xAxisOptions: string[] = [];
  /** Columns from the selected source — Y-axis column section */
  yAxisColumns: string[] = [];

  readonly yAxisFunctions: { value: string; label: string; requiresColumn: boolean; allowsColumn: boolean; requiresNumeric: boolean }[] = [
    { value: 'Count (F)',          label: 'Count (F)',          requiresColumn: false, allowsColumn: true, requiresNumeric: false },
    { value: 'Count Distinct (F)', label: 'Count Distinct (F)', requiresColumn: false, allowsColumn: true, requiresNumeric: false },
    { value: 'Sum (F)',            label: 'Sum (F)',             requiresColumn: true,  allowsColumn: true, requiresNumeric: true  },
    { value: 'Average (F)',        label: 'Average (F)',         requiresColumn: true,  allowsColumn: true, requiresNumeric: true  },
    { value: 'Min (F)',            label: 'Min (F)',             requiresColumn: true,  allowsColumn: true, requiresNumeric: true  },
    { value: 'Max (F)',            label: 'Max (F)',             requiresColumn: true,  allowsColumn: true, requiresNumeric: true  },
  ];

  readonly daxFunctionSnippets = [...DAX_FUNCTION_SNIPPETS];

  xAxis = '';
  yAxis = 'Count (F)';
  yAggColumn = '';
  showYAggDropdown = false;
  yAxisColumnError = '';
  private nextDaxMeasureIndex = 1;
  selectedDaxSnippet = '';
  selectedDaxColumns: string[] = [];
  showDaxColumnDropdown = false;
  showDaxOperationDropdown = false;
  daxOperationSearch = '';
  showDaxNumeratorDropdown = false;
  showDaxDenominatorDropdown = false;
  daxMeasureApplied = false;
  daxMeasureMessage = 'Measure Saved';
  private daxMeasureAppliedTimer: ReturnType<typeof setTimeout> | null = null;
  daxModel: DaxModelConfig = this.createDefaultDaxModel();
  daxMeasureDraft: DaxMeasureConfig = { ...this.daxModel.measures[0] };
  daxExpressionError = '';
  /** Missing measure name or Calculate By, shown under those two fields on Save. */
  daxMeasureFormError = '';

  // --- DAX Model section tabs: "Saved Models" (dummy catalog) and "Create New" (existing editor). ---
  daxActiveTab: 'saved' | 'create' = 'saved';
  daxSavedModelsSearch = '';
  private daxSavedModelSelectedIds = new Set<string>();
  /** Active saved models from GET /api/dax-models, shown as cards on the Saved Models tab. */
  daxSavedModelsCatalog: DaxSavedModelCard[] = [];
  private readonly daxSavedModelsById = new Map<string, SavedDaxModelDto>();
  daxSavedModelsLoading = false;
  /** Why some selected models were not added (load failure, missing columns, no data source). */
  daxSavedModelsMessage = '';
  xAxisOpen = false;
  yAxisOpen = false;
  xAxisTitle = '';
  yAxisTitle = '';
  xAxisSearch = '';
  yAxisSearch = '';
  yAggSearch = '';

  // Simple single-column mapping fields (Bullet target, Bubble size, Heatmap Y-category, Sankey
  // from/to/weight, Timeline date/label) share one custom dropdown instead of a native <select> —
  // a native select's own open popup can't be styled to match the app's rounded dropdown panels
  // (see repo memory: chart-builder-select-opens-wrong-direction / dropdown corner consistency).
  mappingDropdownOpen: string | null = null;

  get availableMappingColumns(): string[] {
    const allColumns = [...new Set([...this.xAxisOptions, ...this.yAxisColumns])];
    // Well Map reads its coordinate columns from the whole source, not only the columns ticked for the table.
    if (this.selectedChartType === 'table' || this.selectedChartType === 'wellmap') return allColumns;
    const sourceKey = `${this.activeTabId}:${this.dataSourceMode}:${this.selectedChartModelId}:table`;
    const tableState = this.chartTypeStates.get(sourceKey);
    if (!tableState) return allColumns;
    const selected = new Set(tableState.multiYColumns);
    return allColumns.filter(column => selected.has(column));
  }

  get filteredXAxisOptions(): string[] {
    const t = this.xAxisSearch.trim().toLowerCase();
    return t ? this.availableMappingColumns.filter(o => o.toLowerCase().includes(t)) : this.availableMappingColumns;
  }
  get filteredYAxisColumns(): string[] {
    const t = this.yAxisSearch.trim().toLowerCase();
    return t ? this.availableMappingColumns.filter(o => o.toLowerCase().includes(t)) : this.availableMappingColumns;
  }
  get filteredYAxisFunctions(): { value: string; label: string; requiresColumn: boolean; allowsColumn: boolean }[] {
    const t = this.yAxisSearch.trim().toLowerCase();
    return t ? this.yAxisFunctions.filter(f => f.label.toLowerCase().includes(t)) : this.yAxisFunctions;
  }
  get filteredYAggColumns(): string[] {
    const t = this.yAggSearch.trim().toLowerCase();
    return t ? this.availableMappingColumns.filter(o => o.toLowerCase().includes(t)) : this.availableMappingColumns;
  }

  get daxEnabled(): boolean { return this.daxModel.enabled; }

  get selectedDaxMeasure(): DaxMeasureConfig | undefined {
    return this.daxModel.measures.find(m => m.id === this.daxModel.selectedMeasureId);
  }

  get daxMeasureName(): string {
    return this.selectedDaxMeasure?.name?.trim() || 'DAX Measure';
  }

  get selectedDaxSeriesMeasures(): DaxMeasureConfig[] {
    // Same rule as the saved views: only measures with "Show this Measure in Chart" ticked.
    return this.daxModel.measures.filter(m => m.includeInSeries !== false && m.expression.trim());
  }

  get daxPreviewMeasures(): DaxMeasureConfig[] {
    return this.daxEnabled ? this.selectedDaxSeriesMeasures : [];
  }

  /** Percentage needs separate numerator/denominator column pickers instead of the single Column picker. */
  get isDaxPercentageOperation(): boolean {
    return this.selectedDaxSnippet.split('(')[0].trim().toUpperCase() === 'PERCENTAGE';
  }

  /** Column-scope DAX measures render as a summary row appended at the end of the preview table. */
  get daxRowSummaryMeasures(): DaxMeasureConfig[] {
    return this.daxPreviewMeasures.filter(m => (m.evaluationScope ?? 'column') !== 'row');
  }

  /** Row-scope DAX measures render as an extra column, computed per table row instead of a trailing row. */
  get daxRowWiseMeasures(): DaxMeasureConfig[] {
    return this.daxPreviewMeasures.filter(m => (m.evaluationScope ?? 'column') === 'row');
  }

  /** Evaluates a row-scope DAX measure against a single preview row for the extra-column table cell. */
  daxMeasureRowValue(measure: DaxMeasureConfig, row: Record<string, unknown>): string {
    return formatDaxValue(evaluateDaxMeasureForRow(measure, row, this.previewRows, this.yAxisColumns), measure);
  }

  get daxDisplayPreference(): DaxDisplayPreference {
    return this.daxModel.displayPreference ?? 'result';
  }

  get daxDisplayPreferenceOptions(): { value: DaxDisplayPreference; label: string }[] {
    return [
      { value: 'result', label: 'Display only Result' },
      { value: 'all', label: 'Display All' },
      ...this.selectedDaxColumns.map(column => ({
        value: `selected:${column}` as DaxDisplayPreference,
        label: `Display only ${column} and Result`,
      })),
    ];
  }

  get daxColumnReferencePrefix(): string {
    return this.selectedChartModelId || this.selectedView?.viewName || 'Source';
  }

  private createDefaultDaxMeasure(): DaxMeasureConfig {
    let id: string;
    do {
      id = `measure-${this.nextDaxMeasureIndex++}`;
    } while (this.daxModel.measures.some(measure => measure.id === id));
    return createDefaultDaxMeasure(id);
  }

  private createDefaultDaxModel(): DaxModelConfig {
    return createDefaultDaxModel();
  }

  private cloneDaxModel(model: DaxModelConfig | undefined): DaxModelConfig {
    return cloneDaxModel(model);
  }

  /**
   * Operation/Column pickers follow the selected measure. Measures saved before they stored their
   * own picks fall back to the model-wide values that were kept then.
   */
  private syncDaxSelectionFromModel(): void {
    const measure = this.daxModel.measures.find(m => m.id === this.daxModel.selectedMeasureId);
    // The model-wide picks can only belong to the measure when it is the sole (older) one.
    const legacy = this.daxModel.measures.length === 1 && !measure?.operation && !measure?.columns;
    this.selectedDaxColumns = [...(measure?.columns ?? (legacy ? this.daxModel.selectedColumns ?? [] : []))];
    this.selectedDaxSnippet = restoreDaxOperation(measure?.operation, measure?.expression ?? '') || (legacy ? this.daxModel.selectedOperation ?? '' : '');
  }

  clearYAggColumn(): void {
    this.pushUndo();
    this.yAggColumn = '';
    this.yAxisOpen = false; this.showYAggDropdown = false;
    this.yAggSearch = ''; this.yAxisSearch = '';
    this.yAxisColumnError = '';
    this.refreshPreview();
  }

  /** Multi-Y columns for multiline/area chart types */
  multiYColumns: string[] = [];
  showMultiYDropdown = false;
  comboLineColumns: string[] = [];
  showComboLineDropdown = false;
  yAxis2Title = '';
  tableRowColors: string[] = [];
  tableHeaderColor = '';
  tableHeaderTextColor = '';
  tableRowTextColors: string[] = [];

  // Extra mapping fields for gauge/bullet/sankey/timeline/bubble/heatmap — none of these
  // reuse the plain xAxis/yAxis category+value shape, so each gets its own small field(s).
  gaugeMin = 0;
  gaugeMax = 100;
  bulletTargetColumn = '';
  bubbleSizeColumn = '';
  heatmapYColumn = '';
  sankeyFromColumn = '';
  sankeyToColumn = '';
  sankeyWeightColumn = '';
  timelineDateColumn = '';
  timelineLabelColumn = '';
  advancedConfig: AdvancedChartConfig = defaultAdvancedConfig();
  advancedRows: Record<string, unknown>[] = [];
  get isAdvancedType(): boolean { return isAdvancedChart(this.selectedChartType); }

  updateAdvancedConfig(config: AdvancedChartConfig): void {
    this.pushUndo();
    this.advancedConfig = config;
    this.refreshPreview();
  }

  /** Whether current chart type supports multiple Y series */
  get isMultiSeriesType(): boolean {
    return this.selectedChartType === 'multiline' || this.selectedChartType === 'area' || this.selectedChartType === 'stacked' || this.selectedChartType === 'table' || this.selectedChartType === 'combo' || this.selectedChartType === 'grouped';
  }

  /** Types whose series come from the Y-axis columns picker, so the Y-axis function dropdown is irrelevant. */
  get isSeriesManagedType(): boolean {
    return this.selectedChartType === 'multiline' || this.selectedChartType === 'stacked' || this.selectedChartType === 'combo' || this.selectedChartType === 'grouped';
  }

  /** Pie/Donut have no real axes — label the fields as Category/Value and hide axis-title inputs. */
  get isCircularChart(): boolean {
    return this.selectedChartType === 'pie' || this.selectedChartType === 'donut';
  }

  get isTrendChart(): boolean {
    return this.selectedChartType !== null && TREND_CHART_TYPES.includes(this.selectedChartType);
  }

  /** Single value + min/max, no axes at all. */
  get isGaugeType(): boolean { return this.selectedChartType === 'gauge'; }

  /** The KPI chart's value from the previewed rows, or the enabled DAX measure. */
  get kpiPreview(): { text: string; label: string } {
    return computeKpiValue(this.previewRows, {
      yAxis: this.yAxis,
      yAggColumn: this.yAggColumn,
      daxModel: this.daxModel.enabled ? this.daxModel : undefined,
    }, this.yAxisColumns);
  }
  /** Reuses X-axis/Y-axis, adds an optional Target column. */
  get isBulletType(): boolean { return this.selectedChartType === 'bullet'; }
  /** Reuses X-axis/Y-axis, adds a required Size column. */
  get isBubbleType(): boolean { return this.selectedChartType === 'bubble'; }
  /** Reuses X-axis (row category) + Y-axis (value), adds a 2nd category (Y-category) column. */
  get isHeatmapType(): boolean { return this.selectedChartType === 'heatmap'; }
  /** From/To/Weight relationship — no xAxis/yAxis at all. */
  get isSankeyType(): boolean { return this.selectedChartType === 'sankey'; }
  /** Date/Label columns — no xAxis/yAxis at all. */
  get isTimelineType(): boolean { return this.selectedChartType === 'timeline'; }
  /** Types that hide the normal X-axis/Y-axis row entirely (they have their own field set). */
  get hasCustomMapping(): boolean { return this.isGaugeType || this.isSankeyType || this.isTimelineType; }

  /** Blocks picking the same column for two different Sankey fields (From/To/Weight). */
  isSankeyFieldConflict(field: 'from' | 'to' | 'weight', col: string): boolean {
    if (!col) return false;
    const others = {
      from: [this.sankeyToColumn, this.sankeyWeightColumn],
      to: [this.sankeyFromColumn, this.sankeyWeightColumn],
      weight: [this.sankeyFromColumn, this.sankeyToColumn],
    }[field];
    return others.includes(col);
  }

  /** Blocks picking the same column for both Timeline fields (Date/Label). */
  isTimelineFieldConflict(field: 'date' | 'label', col: string): boolean {
    if (!col) return false;
    return field === 'date' ? col === this.timelineLabelColumn : col === this.timelineDateColumn;
  }

  /** Bullet/Bubble reuse X-axis + Y-axis, so their extra column (Target/Size) must not repeat either one. */
  isExtraColumnConflict(col: string): boolean {
    if (!col) return false;
    return col === this.xAxis || col === this.yAggColumn;
  }

  /** Heatmap's 2nd category column must differ from both the X-axis category and the Y-axis value column. */
  isHeatmapYConflict(col: string): boolean {
    return !!col && (col === this.xAxis || col === this.yAggColumn);
  }

  setTrendMode(mode: TrendMode): void {
    if (this.trendMode === mode) return;
    this.pushUndo();
    this.trendMode = mode;
    this.loadTrendModePreview();
  }

  private loadTrendModePreview(): void {
    if (this.dataSourceMode !== 'view' || !this.selectedView?.id) return;

    this.widgetService.getFilteredChartData({
      chartSource: this.selectedChartModelId,
      chartSourceType: 'View',
      viewId: this.selectedView.id,
      filters: [...this.lockedInteractiveFilterPayload(), ...this.globalHierarchyFilterPayload()],
      ...this.viewDatePayload(this.selectedView.id),
      mode: this.trendMode,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.rawLoadedRows = res.rows ?? [];
        this.rawLoadedColumns = res.columns ?? [];
        this.applyParameterDrivenTransformations();
        this.cdr.markForCheck();
      },
      error: () => this.saveError.set('Failed to load trend data for the selected period.'),
    });
  }

  get selectedFunctionRequiresColumn(): boolean {
    return this.yAxisFunctions.find(f => f.value === this.yAxis)?.requiresColumn ?? false;
  }

  /** Whether the selected function can take an optional aggregation column (Count / Count Distinct). */
  get selectedFunctionAllowsColumn(): boolean {
    return this.yAxisFunctions.find(f => f.value === this.yAxis)?.allowsColumn ?? false;
  }

  /** True when the aggregation column is optional (Count / Count Distinct), not required. */
  get selectedFunctionColumnOptional(): boolean {
    const fn = this.yAxisFunctions.find(f => f.value === this.yAxis);
    return !!fn && fn.allowsColumn && !fn.requiresColumn;
  }

  /** True only for math operations (Sum/Average/Min/Max) — Count / Count Distinct work on any column. */
  get selectedFunctionRequiresNumeric(): boolean {
    return this.yAxisFunctions.find(f => f.value === this.yAxis)?.requiresNumeric ?? false;
  }

  /**
   * The type a Change Data Type rule gives this column, or null when no enabled rule does.
   * Values such as "65" still parse as numbers after a Number → Text change, so without this the
   * column kept behaving as numeric and the change looked like it was not applied.
   */
  private explicitColumnType(col: string): 'text' | 'number' | 'date' | null {
    let type: 'text' | 'number' | 'date' | null = null;
    for (const rule of this.parameterFilters) {
      if (rule.action !== 'type_change' || rule.enabled === false || getParameterRuleError(rule)) continue;
      if (!getRuleSourceColumns(rule).some(c => c.toLowerCase() === col.toLowerCase())) continue;
      if (rule.targetType === 'Text') type = 'text';
      else if (rule.targetType === 'Number') type = 'number';
      else if (rule.targetType === 'Date') type = 'date';
    }
    return type;
  }

  /** True when every value in the source rows parses as a number, ignoring any type rule. */
  private hasNumericValues(col: string): boolean {
    const values = this.rawLoadedRows.map(row => row[col]).filter(v => v !== null && v !== undefined && v !== '');
    return values.length > 0 && values.every(v => !Number.isNaN(Number(v)));
  }

  /** True when every value in the column is blank or parses as a number, or a rule made it Number. */
  private isColumnNumeric(col: string): boolean {
    const explicit = this.explicitColumnType(col);
    if (explicit) return explicit === 'number';
    return !this.tableRows.length || this.tableRows.every(row => {
      const val = row[col];
      return val === null || val === undefined || val === '' || !Number.isNaN(Number(val));
    });
  }

  /** Best-effort data type guess (from column name + sample values) for the icon shown next to a column in pickers. */
  getColumnIconType(col: string): 'date' | 'number' | 'text' {
    if (!col) return 'text';
    const explicit = this.explicitColumnType(col);
    if (explicit) return explicit;
    const samples = this.tableRows.map(row => row?.[col]).filter(v => v !== null && v !== undefined && v !== '').slice(0, 20);
    if (!samples.length) {
      return /date|day|time|week/.test(col.replace(/[ _-]/g, '').toLowerCase()) ? 'date' : 'text';
    }
    if (samples.every(v => this.looksLikeDate(v))) return 'date';
    if (samples.every(v => !Number.isNaN(Number(v)))) return 'number';
    return 'text';
  }

  private looksLikeDate(value: unknown): boolean {
    if (value instanceof Date) return !Number.isNaN(value.getTime());
    const text = String(value).trim();
    if (!text || !Number.isNaN(Number(text))) return false; // plain numbers aren't dates
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ t]|$)/i.test(text) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}([ t]|$)/i.test(text);
  }

  /** First loaded column (option B: category default is simply the first column). */
  private defaultCategoryColumn(): string {
    return this.availableMappingColumns[0] ?? '';
  }

  /** First numeric column if any, else the first column. */
  private defaultNumericColumn(exclude: string[] = []): string {
    const cols = this.availableMappingColumns.filter(c => !exclude.includes(c));
    return cols.find(c => this.isColumnNumeric(c)) ?? cols[0] ?? '';
  }

  /** First column not already used, for a second category/label slot. */
  private defaultOtherColumn(exclude: string[] = []): string {
    return this.availableMappingColumns.find(c => !exclude.includes(c)) ?? '';
  }

  /** First date-like column if any, else the first column. */
  private defaultDateColumn(): string {
    return this.availableMappingColumns.find(c => this.getColumnIconType(c) === 'date') ?? this.availableMappingColumns[0] ?? '';
  }

  /** Fill only currently-empty mapping fields so a preview renders immediately after a chart type is picked. */
  private applyDefaultMapping(): void {
    if (!this.availableMappingColumns.length) return;
    if (isAdvancedChart(this.selectedChartType)) {
      this.advancedConfig = applyAdvancedDefaultMapping(this.selectedChartType, this.previewRows,
        this.availableMappingColumns, this.advancedConfig);
      return;
    }
    const cat = this.defaultCategoryColumn();
    if (this.isGaugeType) {
      if (!this.yAggColumn) this.yAggColumn = this.defaultNumericColumn();
      return;
    }
    if (this.isSankeyType) {
      if (!this.sankeyFromColumn) this.sankeyFromColumn = cat;
      if (!this.sankeyToColumn) this.sankeyToColumn = this.defaultOtherColumn([this.sankeyFromColumn]);
      if (!this.sankeyWeightColumn) this.sankeyWeightColumn = this.defaultNumericColumn();
      return;
    }
    if (this.isTimelineType) {
      if (!this.timelineDateColumn) this.timelineDateColumn = this.defaultDateColumn();
      if (!this.timelineLabelColumn) this.timelineLabelColumn = this.defaultOtherColumn([this.timelineDateColumn]);
      return;
    }
    if (!this.xAxis) this.xAxis = cat;
    if (this.isSeriesManagedType) {
      if (!this.multiYColumns.length) {
        const col = this.defaultNumericColumn([this.xAxis]);
        if (col) this.multiYColumns = [col];
      }
      return;
    }
    if (this.isBubbleType) {
      if (!this.yAggColumn) this.yAggColumn = this.defaultNumericColumn([this.xAxis]);
      if (!this.bubbleSizeColumn) this.bubbleSizeColumn = this.defaultNumericColumn([this.xAxis, this.yAggColumn]);
      return;
    }
    if (this.isHeatmapType) {
      if (!this.heatmapYColumn) this.heatmapYColumn = this.defaultOtherColumn([this.xAxis]);
      if (!this.yAxis && !this.yAggColumn) this.yAxis = 'Count (F)';
      return;
    }
    // Single-series charts with an operation: Count of rows per category needs no value column.
    if (!this.yAxis && !this.yAggColumn) this.yAxis = 'Count (F)';
  }

  /**
   * Whether the Value column must hold numbers: "None" plots the column's values as they are,
   * and Sum/Average/Min/Max do arithmetic on them. Only Count / Count Distinct accept text.
   */
  get valueNeedsNumeric(): boolean {
    return !this.yAxis || this.selectedFunctionRequiresNumeric;
  }

  /** Text columns are offered but not selectable as Value unless the operation is a count. */
  valueColumnUsable(col: string): boolean {
    if (this.isXAxisConflict(col)) return false;
    if (col && (col === this.heatmapYColumn || col === this.bulletTargetColumn || col === this.bubbleSizeColumn)) return false;
    return !this.valueNeedsNumeric || this.isColumnNumeric(col);
  }

  /**
   * Whether `col` is already used as the X-axis/category column, so it should be blocked on the Y-axis side.
   * Table charts derive their X-axis from the first picked column, so they're excluded from this rule.
   * Gauge hides the X-axis field entirely (xAxis is only set internally), so it's excluded too.
   */
  isXAxisConflict(col: string): boolean {
    return !!this.xAxis && col === this.xAxis && this.selectedChartType !== 'table' && !this.isGaugeType;
  }

  /** Whether `col` is already picked on the Left Y-axis (bar series), so the Right Y-axis (line) picker should block it. */
  isLeftYAxisColumn(col: string): boolean {
    return this.multiYColumns.includes(col);
  }

  /** Reverse of isLeftYAxisColumn: blocks the Left Y-axis picker from reusing a column already on the Right Y-axis. */
  isRightYAxisColumn(col: string): boolean {
    return this.comboLineColumns.includes(col);
  }

  /**
   * Blocks picking the same column for X-axis that's already chosen as the Y-axis Value column, Heatmap's
   * Y-Category column, or Bullet/Bubble's extra column. Series-managed types (multiline/stacked/combo/grouped)
   * hide the Value field, so a leftover yAggColumn from a previous chart type must not block the X-axis there;
   * instead, those (and area/table, which also use the Y-axis Columns picker) must exclude the Left/Right
   * Y-axis series columns from the X-axis.
   */
  isYAxisConflict(col: string): boolean {
    if (!col) return false;
    if (this.isMultiSeriesType && this.selectedChartType !== 'table') {
      return this.multiYColumns.includes(col) || this.comboLineColumns.includes(col);
    }
    return col === this.yAggColumn || col === this.heatmapYColumn || col === this.bulletTargetColumn || col === this.bubbleSizeColumn;
  }

  /** Numeric columns of the source, for pickers that plot values directly. */
  get numericMappingColumns(): string[] {
    return this.availableMappingColumns.filter(col => this.isColumnNumeric(col));
  }

  /** Set/clear the Value-column error: a text column only works with Count / Count Distinct. */
  private updateYAxisColumnError(): void {
    this.yAxisColumnError = (this.yAggColumn && !this.valueColumnUsable(this.yAggColumn))
      ? `"${this.yAggColumn}" is a text column. Choose a numeric column, or set Operation to Count.`
      : '';
  }

  /** Y-axis column to prepend to multi-Y series (empty when it's a function or already in multiYColumns) */
  get yAxisExtraColumn(): string {
    const isFn = this.yAxisFunctions.some(f => f.value === this.yAxis);
    return (!isFn && this.yAxis && !this.multiYColumns.includes(this.yAxis)) ? this.yAxis : '';
  }

  readonly chartTypeImages: Record<ChartTypeId, string> = {
    ...Object.fromEntries(Object.keys(ADVANCED_CHART_LABELS).map(type => [type,
      type === 'stackedarea100' ? 'assets/images/chart-types/area.png' :
      type === 'wellmap' ? 'assets/images/chart-types/map.png' :
      type === 'boxplot' || type === 'candlestick' ? `assets/images/chart-types/${type}.svg` :
      `assets/images/chart-types/${type}.png`,
    ])) as Record<AdvancedChartType, string>,
    bar:       'assets/images/chart-types/bar.png',
    line:      'assets/images/chart-types/line.png',
    pie:       'assets/images/chart-types/pie.png',
    donut:     'assets/images/chart-types/donut.png',
    kpi:       'assets/images/kpitile.svg',
    table:     'assets/images/chart-types/table.png',
    trend:     'assets/images/trend.svg',
    multiline: 'assets/images/chart-types/multiline.png',
    area:      'assets/images/chart-types/area.png',
    spline:    'assets/images/chart-types/spline.png',
    column:    'assets/images/chart-types/column.png',
    funnel:    'assets/images/chart-types/funnel.png',
    stacked:   'assets/images/chart-types/stacked.png',
    combo:     'assets/images/chart-types/combo.png',
    grouped:   'assets/images/chart-types/grouped.png',
    waterfall: 'assets/images/chart-types/waterfall.svg', // dedicated icon, no collision with any other type
    treemap:   'assets/images/chart-types/treemap.svg', // dedicated icon, no collision with any other type
    scatter:   'assets/images/chart-types/scatter.svg', // dedicated icon, no collision with any other type
    histogram: 'assets/images/chart-types/histogram.svg', // dedicated icon, no collision with any other type
    gauge:     'assets/images/chart-types/gauge.svg', // dedicated icon, no collision with any other type
    bullet:    'assets/images/chart-types/bullet.svg', // dedicated icon, no collision with any other type
    sankey:    'assets/images/chart-types/sankey.svg', // dedicated icon, no collision with any other type
    timeline:  'assets/images/chart-types/timeline.svg', // dedicated icon, no collision with any other type
    bubble:    'assets/images/chart-types/bubble.svg', // dedicated icon, no collision with any other type
    heatmap:   'assets/images/chart-types/heatmap.svg', // dedicated icon, no collision with any other type
  };

  // Legend is always enabled; the Show Legend toggle was removed from the UI.
  showLegend = true;
  includeDataTable = false;
  showAxisTitle = false;
  /** Optional value labels on the chart. Defaults on so legacy charts (no flag saved) keep showing labels. */
  showDataLabels = true;
  /** Once the user turns the axis-title toggle off (or it was auto-enabled), stop auto-enabling until titles are cleared. */
  private axisTitleAutoApplied = false;
  /** Stacked charts only: whether to overlay the per-category Total line. Default on for legacy charts. */
  showStackTotal = true;
  limitCategory: LimitCategory = 'top';
  topN = 100;
  bottomN = 0;
  groupRestAsOthers = false;
  rankByOptions = ['Actual Qty', 'Planned Qty', 'Variance'];
  rankBy = 'Actual Qty';

  // ─── Setup Options: apply a previously-saved chart template preset ──
  showSavedSetupModal = false;
  savedSetupModalMode: 'use' | 'save' = 'use';
  savedSetupSearch = '';
  customSetupName = '';
  saveSetupValidationError = '';
  selectedSavedSetupId: string | null = null;

  savedChartSetups: SavedChartSetup[] = [];
  savedSetupsLoading = false;
  private readonly savedSetupAccents: SavedChartSetup['accent'][] = ['blue', 'green', 'purple', 'orange', 'yellow'];
  private readonly tileNameCache = new Map<number, string>();
  private readonly viewNameCache = new Map<number, string>();

  get filteredSavedSetups(): SavedChartSetup[] {
    const t = this.savedSetupSearch.trim().toLowerCase();
    return t ? this.savedChartSetups.filter(s => s.name.toLowerCase().includes(t)) : this.savedChartSetups;
  }

  get selectedSavedSetup(): SavedChartSetup | null {
    return this.savedChartSetups.find(s => s.id === this.selectedSavedSetupId) ?? this.savedChartSetups[0] ?? null;
  }

  openSavedSetupModal(): void {
    this.savedSetupModalMode = 'use';
    this.savedSetupSearch = '';
    this.savedSetupOpenSections = new Set<number>([2]);
    this.showSavedSetupModal = true;
    this.loadSavedSetups();
  }

  /** Opens the modal in "save" mode: asks for a mandatory custom name and shows a review of the current setup. */
  openSaveSetupModal(): void {
    this.savedSetupModalMode = 'save';
    this.customSetupName = (this.selectedSavedSetup?.customName ?? this.customSetupName ?? '').trim();
    this.saveSetupValidationError = '';
    this.savedSetupOpenSections = new Set<number>([2]);
    this.saveSetupReview = this.computeSaveSetupPreview();
    this.showSavedSetupModal = true;
  }

  /** Sanitizes and validates the custom setup name as the user types (same rules as report builder). */
  onCustomSetupNameChange(value: string): void {
    const name = value ?? '';
    const sanitized = name.replace(/[^A-Za-z0-9_-]/g, '');
    this.customSetupName = sanitized;
    if (sanitized !== name) {
      this.saveSetupValidationError = 'Setup name may contain only letters, numbers, hyphens, and underscores.';
    } else if (sanitized.length > 0 && sanitized.length < 5) {
      this.saveSetupValidationError = 'Setup name must be at least 5 characters.';
    } else if (sanitized.length > 30) {
      this.saveSetupValidationError = 'Setup name must be no more than 30 characters.';
    } else {
      this.saveSetupValidationError = '';
    }
  }

  /** Data source name shown (read-only) in the save form. */
  get saveSetupSourceName(): string {
    if (this.dataSourceMode === 'view') return this.selectedView?.viewName ?? this.selectedChartModelId;
    if (this.dataSourceMode === 'import') return this.selectedImportDataset?.datasetName ?? this.selectedChartModelId;
    return this.selectedChartModelId;
  }

  /** Snapshot of the current setup's review summary, computed once when the save modal opens. */
  saveSetupReview: SavedChartSetupPreview = { interactiveFilters: [], conditionalFilters: [], transformations: [], attachedTiles: [], drillDownView: '', daxEnabled: false, daxMeasures: [] };

  private computeSaveSetupPreview(): SavedChartSetupPreview {
    let cfg: Record<string, any> = {};
    try { cfg = JSON.parse(this.buildDesignJson()); } catch { cfg = {}; }
    return this.buildSetupPreview(cfg);
  }

  /** Fetches saved chart templates (getBySource) and lists them in the modal. */
  private loadSavedSetups(): void {
    this.savedSetupsLoading = true;
    this.savedChartSetups = [];
    this.selectedSavedSetupId = null;
    this.cdr.markForCheck();
    this.chartTemplates.getBySource('Chart')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (tpls) => {
          this.savedChartSetups = (tpls ?? [])
            .slice()
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .map((t, i) => this.templateToSavedSetup(t, i));
          this.selectedSavedSetupId = this.savedChartSetups[0]?.id ?? null;
          this.savedSetupsLoading = false;
          this.resolveSetupNames();
          this.cdr.markForCheck();
        },
        error: () => {
          this.savedChartSetups = [];
          this.selectedSavedSetupId = null;
          this.savedSetupsLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /** Maps a saved chart template DTO into the modal's display + apply shape. */
  private templateToSavedSetup(t: ChartTemplateDto, index: number): SavedChartSetup {
    let cfg: Record<string, any> = {};
    try { cfg = JSON.parse(t.templateJson ?? '{}'); } catch { cfg = {}; }
    const chartTypeLabel = this.chartTypes.find(ct => ct.id === cfg['chartType'])?.label
      ?? (cfg['chartType'] ? String(cfg['chartType']) : 'Chart');
    const customName = t.customName?.trim() || t.sourceName;
    return {
      id: String(t.id),
      customName,
      name: customName,
      chartTypeLabel,
      source: t.sourceName,
      lastUsed: this.formatSetupDate(t.updatedAt),
      accent: this.savedSetupAccents[index % this.savedSetupAccents.length],
      templateJson: t.templateJson,
      config: {
        xAxis: cfg['xAxis'] ?? '',
        yAxis: cfg['yAxis'] ?? '',
        xAxisTitle: cfg['xAxisTitle'] ?? '',
        yAxisTitle: cfg['yAxisTitle'] ?? '',
        showLegend: cfg['showLegend'] ?? true,
        includeDataTable: !!cfg['includeDataTable'],
        showAxisTitle: !!cfg['showAxisTitle'],
        limitCategory: (cfg['limitCategory'] ?? 'top') as LimitCategory,
        topN: cfg['topN'] ?? 100,
        bottomN: cfg['bottomN'] ?? 0,
        rankBy: cfg['rankBy'] ?? this.rankBy,
      },
      preview: this.buildSetupPreview(cfg),
    };
  }

  /** Summarizes setup sections 4-9 from a template's design blob for the preview panel. */
  private buildSetupPreview(cfg: Record<string, any>): SavedChartSetupPreview {
    const interactiveFilters: string[] = (cfg['interactiveFilters'] ?? []).map((f: any) => {
      const parts = [f.label || f.sourceColumn || 'Filter'];
      if (f.controlType) parts.push(f.controlType);
      if (f.sourceColumn) parts.push(f.sourceColumn);
      return parts.join(' · ');
    });
    const conditionalFilters: string[] = (cfg['conditionalFilters'] ?? []).map((f: any) => {
      const op = f.operator ? this.formatOperatorLabel(f.operator) : '';
      const mode = f.mode ? ` (${f.mode})` : '';
      return `${f.label || f.sourceColumn || 'Filter'}: ${f.sourceColumn ?? ''} ${op} ${f.valueText ?? ''}${mode}`
        .replace(/\s+/g, ' ').trim();
    });
    const transformations: string[] = getSavedParameterFilters(cfg).map((r) => {
      const cols = getRuleSourceColumns(r).join(', ');
      return `${this.getParameterActionLabel(r.action)}${cols ? ' · ' + cols : ''}`;
    });
    const daxModel = cfg['daxModel'];
    const daxMeasures: string[] = (daxModel?.measures ?? [])
      .filter((m: any) => m?.expression?.trim())
      .map((m: any) => `${m.name || 'Measure'}: ${m.expression}`);
    const attachedTileIds: number[] = cfg['attachedTileIds'] ?? [];
    return {
      interactiveFilters,
      conditionalFilters,
      transformations,
      attachedTiles: attachedTileIds.map(id => this.tileNameCache.get(id) ?? `Tile #${id}`),
      drillDownView: cfg['drillDownViewId'] ? (this.viewNameCache.get(cfg['drillDownViewId']) ?? `View #${cfg['drillDownViewId']}`) : '',
      daxEnabled: !!daxModel?.enabled,
      daxMeasures,
    };
  }

  private formatSetupDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  /** Resolves attached-tile and drill-down-view ids to display names, patching each setup's preview. */
  private resolveSetupNames(): void {
    const tileIds = new Set<number>();
    let needViews = false;
    for (const s of this.savedChartSetups) {
      for (const id of this.getSetupTileIds(s)) tileIds.add(id);
      if (this.getSetupDrillDownId(s) != null) needViews = true;
    }
    if (needViews) {
      this.commonApi.getDatabaseViews('view').pipe(takeUntil(this.destroy$)).subscribe({
        next: (views) => {
          for (const v of views) this.viewNameCache.set(v.id, v.viewName);
          for (const s of this.savedChartSetups) {
            const vid = this.getSetupDrillDownId(s);
            if (vid != null) s.preview = { ...s.preview, drillDownView: this.viewNameCache.get(vid) ?? `View #${vid}` };
          }
          this.cdr.markForCheck();
        },
      });
    }
    for (const id of tileIds) {
      if (this.tileNameCache.has(id)) { this.patchTileNames(id); continue; }
      this.widgetService.getWidgetById(id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (w) => { this.tileNameCache.set(id, w?.name ?? `Tile #${id}`); this.patchTileNames(id); this.cdr.markForCheck(); },
        error: () => { this.tileNameCache.set(id, `Tile #${id}`); this.patchTileNames(id); this.cdr.markForCheck(); },
      });
    }
  }

  /** Rebuilds the attached-tile name list for every setup that references the resolved tile id. */
  private patchTileNames(id: number): void {
    for (const s of this.savedChartSetups) {
      const ids = this.getSetupTileIds(s);
      if (ids.includes(id)) s.preview = { ...s.preview, attachedTiles: ids.map(tid => this.tileNameCache.get(tid) ?? `Tile #${tid}`) };
    }
  }

  private getSetupTileIds(s: SavedChartSetup): number[] {
    try { return (JSON.parse(s.templateJson ?? '{}')['attachedTileIds'] ?? []) as number[]; }
    catch { return []; }
  }

  private getSetupDrillDownId(s: SavedChartSetup): number | null {
    try { return JSON.parse(s.templateJson ?? '{}')['drillDownViewId'] ?? null; }
    catch { return null; }
  }

  closeSavedSetupModal(): void {
    this.showSavedSetupModal = false;
    this.saveSetupValidationError = '';
  }

  selectSavedSetup(id: string): void {
    this.selectedSavedSetupId = id;
    const selected = this.savedChartSetups.find(s => s.id === id);
    if (selected?.customName) this.customSetupName = selected.customName;
  }

  applySavedSetup(): void {
    const setup = this.selectedSavedSetup;
    if (!setup) { this.closeSavedSetupModal(); return; }
    this.pushUndo();
    let d: Record<string, any> | null = null;
    if (setup.templateJson) {
      try { d = JSON.parse(setup.templateJson); } catch { d = null; }
    }
    if (d) {
      this.applyTemplateConfig(d);
    } else {
      const c = setup.config;
      this.xAxis = c.xAxis;
      this.yAxis = c.yAxis;
      this.xAxisTitle = c.xAxisTitle;
      this.yAxisTitle = c.yAxisTitle;
      this.showLegend = c.showLegend ?? true;
      this.includeDataTable = c.includeDataTable;
      this.showAxisTitle = c.showAxisTitle;
      this.limitCategory = c.limitCategory;
      this.topN = c.topN;
      this.bottomN = c.bottomN;
      this.rankBy = c.rankBy;
    }
    // Re-run data-transformation rules so the restored xAxis/yAxis (which may point at renamed
    // or transformed columns) resolve against freshly computed rows — otherwise the chart renders
    // off stale tableRows and the applied setup doesn't take effect.
    this.applyParameterDrivenTransformations();
    this.showSavedSetupModal = false;
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  /** Restores setup sections 2-9 from a saved template's design blob (chart type and source are left untouched). */
  private applyTemplateConfig(d: Record<string, any>): void {
    // Section 2 — Data Mapping
    const seriesManaged = ['multiline', 'stacked', 'combo', 'grouped'].includes(d['chartType']);
    if (d['yAxis'] && !seriesManaged && !this.yAxisFunctions.some(f => f.value === d['yAxis'])) {
      d['yAggColumn'] = d['yAxis']; d['yAxis'] = 'Sum (F)';
    }
    this.xAxis = d['xAxis'] ?? '';
    this.yAxis = d['yAxis'] ?? 'Count (F)';
    this.yAggColumn = d['yAggColumn'] ?? '';
    this.xAxisTitle = d['xAxisTitle'] ?? '';
    this.yAxisTitle = d['yAxisTitle'] ?? '';
    this.multiYColumns = d['multiYColumns'] ?? [];
    this.comboLineColumns = d['comboLineColumns'] ?? [];
    this.yAxis2Title = d['yAxis2Title'] ?? '';
    this.gaugeMin = d['gaugeMin'] ?? 0;
    this.gaugeMax = d['gaugeMax'] ?? 100;
    this.bulletTargetColumn = d['bulletTargetColumn'] ?? '';
    this.bubbleSizeColumn = d['bubbleSizeColumn'] ?? '';
    this.heatmapYColumn = d['heatmapYColumn'] ?? '';
    this.sankeyFromColumn = d['sankeyFromColumn'] ?? '';
    this.sankeyToColumn = d['sankeyToColumn'] ?? '';
    this.sankeyWeightColumn = d['sankeyWeightColumn'] ?? '';
    this.timelineDateColumn = d['timelineDateColumn'] ?? '';
    this.timelineLabelColumn = d['timelineLabelColumn'] ?? '';
    this.advancedConfig = readAdvancedConfig(d['advancedConfig']);
    this.tableRowColors = d['tableRowColors'] ?? [];
    this.tableHeaderColor = d['tableHeaderColor'] ?? '';
    this.tableHeaderTextColor = d['tableHeaderTextColor'] ?? '';
    this.tableRowTextColors = d['tableRowTextColors'] ?? [];
    this.colorRules = (d['colorRules'] ?? []).map((rule: ColorRule) => ({ ...rule }));
    this.nextColorRuleId = this.colorRules.reduce((max, rule) => Math.max(max, rule.id + 1), 1);
    this.colorOverrides = { ...(d['colorOverrides'] ?? {}) };

    // Section 3 — Display & Ranking
    this.showLegend = d['showLegend'] ?? true;
    this.includeDataTable = d['includeDataTable'] ?? false;
    this.showAxisTitle = d['showAxisTitle'] ?? false;
    this.showDataLabels = d['showDataLabels'] ?? true;
    this.showStackTotal = d['showStackTotal'] ?? true;
    this.limitCategory = d['limitCategory'] ?? 'top';
    this.topN = d['topN'] ?? 100;
    this.bottomN = d['bottomN'] ?? 0;
    this.groupRestAsOthers = d['groupRestAsOthers'] ?? false;

    // Section 4 — Interactive Filters
    this.interactiveFilters = d['interactiveFilters'] ?? [];
    this.syncInteractiveFilterSelections();

    // Section 5 — Conditional Filters
    this.conditionalFilters = (d['conditionalFilters'] ?? []).map((f: ConditionalFilter) => ({
      ...f,
      operator: f.operator || 'equals',
      valueText: f.valueText ?? '',
      mode: f.mode || 'Include',
      hidden: f.hidden ?? true,
      values: [...(f.values ?? [])],
    }));
    this.syncConditionalFilterSelections();

    // Section 6 — Data Transformation
    this.parameterFilters = getSavedParameterFilters(d).map(r => ({ ...r, sourceColumns: getRuleSourceColumns(r) }));
    this.syncParameterFilterIds();

    // Section 9 — DAX Model
    this.daxModel = this.cloneDaxModel(d['daxModel'] as DaxModelConfig | undefined);
    this.syncDaxSelectionFromModel();
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';

    // Section 7 — Attached Tiles
    this.attachedTileIds = d['attachedTileIds'] ?? [];
    for (const tId of this.attachedTileIds) {
      this.widgetService.getWidgetById(tId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (t) => this.loadTilePreview(t),
        error: () => {},
      });
    }

    // Section 8 — Drill Down
    this.drillDownViewId = d['drillDownViewId'] ?? null;
    this.drillDownViewName = '';
    if (this.drillDownViewId) {
      this.commonApi.getDatabaseViews('view').pipe(takeUntil(this.destroy$)).subscribe({
        next: (views) => {
          this.drillDownViews = views;
          const match = views.find(v => v.id === this.drillDownViewId);
          if (match) this.drillDownViewName = match.viewName;
          this.cdr.markForCheck();
        },
      });
    }
  }

  // ─── "Save as Reusable Setup" — bundles the full chart setup for future reuse ──
  reusableSetupSaved = false;
  reusableSetupSaving = false;
  private reusableSetupSavedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opens the save modal so the user names the setup and reviews it before saving. */
  saveReusableSetup(): void {
    if (!this.selectedChartModelId) return;
    this.openSaveSetupModal();
  }

  /** Validates the mandatory custom name (report-builder rules) then persists the template. */
  confirmSaveReusableSetup(): void {
    if (this.reusableSetupSaving) return;
    const customName = this.customSetupName.trim();
    if (!customName) {
      this.saveSetupValidationError = 'Enter a setup name.';
      return;
    }
    if (customName.length < 5) {
      this.saveSetupValidationError = 'Setup name must be at least 5 characters.';
      return;
    }
    if (customName.length > 30) {
      this.saveSetupValidationError = 'Setup name must be no more than 30 characters.';
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(customName)) {
      this.saveSetupValidationError = 'Setup name may contain only letters, numbers, hyphens, and underscores.';
      return;
    }
    if (!this.saveSetupSourceName) {
      this.saveSetupValidationError = 'Select a source before saving a setup.';
      return;
    }
    const selectionError = getParameterSelectionError(this.parameterFilters);
    if (selectionError) {
      this.saveSetupValidationError = selectionError;
      return;
    }
    this.saveSetupValidationError = '';
    this.persistTemplate(customName);
  }

  /** Persists the current chart setup as a reusable template (POST) under the given custom name. */
  private persistTemplate(customName: string): void {
    if (!this.selectedChartModelId) return;
    const sourceName = this.selectedChartModelId;
    const sourceType = this.dataSourceMode === 'view' ? 'View'
      : this.dataSourceMode === 'import' ? 'Import'
      : (this.selectedChartModel?.modelType ?? 'Table');
    const viewId = this.dataSourceMode === 'view' ? (this.selectedView?.id ?? 0)
      : this.dataSourceMode === 'import' ? (this.selectedImportDataset?.id ?? 0)
      : 0;
    // Reuse the chart's design serializer so the template carries every setup section
    // (data mapping, display & ranking, interactive/conditional filters, data transformation, tiles, drilldown, DAX).
    const templateJson = this.buildDesignJson();
    this.reusableSetupSaving = true;
    this.cdr.markForCheck();
    this.chartTemplates.save({ customName, sourceName, sourceType, templateJson, type: 'Chart', viewId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.customSetupName = customName;
          this.reusableSetupSaving = false;
          this.showSavedSetupModal = false;
          this.showReusableSetupSaved();
          this.cdr.markForCheck();
        },
        error: () => {
          this.reusableSetupSaving = false;
          this.saveError.set('Failed to save the chart setup.');
          this.cdr.markForCheck();
        },
      });
  }

  /** Briefly flashes a "Saved" confirmation next to the Save Setup button. */
  private showReusableSetupSaved(): void {
    if (this.reusableSetupSavedTimer) clearTimeout(this.reusableSetupSavedTimer);
    this.reusableSetupSaved = false;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.reusableSetupSaved = true;
      this.cdr.markForCheck();
      this.reusableSetupSavedTimer = setTimeout(() => {
        this.reusableSetupSaved = false;
        this.reusableSetupSavedTimer = null;
        this.cdr.markForCheck();
      }, 2400);
    });
  }

  controlTypeOptions = ['Dropdown', 'MultiSelect'];
  interactiveFilters: InteractiveFilter[] = [];
  showFilterPanel = true;

  openAdvancedFilter(): void {
    this.advancedFilter?.open();
  }
  private nextFilterId = 1;
  filterColumnsCache: Record<string, string[]> = {};
  private filterRowsCache: Record<string, Record<string, unknown>[]> = {};
  previewFilterValues: Record<number, string> = {};
  /** Selected values per MultiSelect filter (table sources, include-only). */
  previewFilterMultiValues: Record<number, string[]> = {};
  openMultiFilterId: number | null = null;
  /** Rows after applying active interactive filters (server-joined for cross-table filters); null = no active filter */
  private crossTableFilterRows: Record<string, unknown>[] | null = null;

  get filterSourceOptions(): string[] { return this.chartModels.map(m => m.id); }

  getFilterSourceLabel(sourceTable: string): string {
    const model = this.chartModels.find(source => source.id === sourceTable)
      ?? this.importedChartModels.find(source => source.id === sourceTable);
    return model?.label
      || this.availableImportDatasets.find(dataset => String(dataset.id) === sourceTable)?.datasetName
      || sourceTable;
  }

  getSourceColumns(sourceTable: string): string[] {
    if (!sourceTable) return [];
    if (this.filterColumnsCache[sourceTable]) return this.filterColumnsCache[sourceTable];
    this.loadFilterColumns(sourceTable);
    return [];
  }

  private loadFilterColumns(sourceTable: string): void {
    if (this.filterColumnsCache[sourceTable]) return;
    this.filterColumnsCache[sourceTable] = []; // prevent duplicate requests
    const model = this.chartModels.find(m => m.id === sourceTable)
               ?? this.importedChartModels.find(m => m.id === sourceTable);
    const sourceType = model?.modelType ?? 'Table';
    this.widgetService.getTableData(sourceTable, sourceType).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.filterColumnsCache[sourceTable] = res?.columns ?? [];
        this.filterRowsCache[sourceTable] = res?.rows ?? [];
        this.cdr.markForCheck();
      }
    });
  }

  onFilterSourceChange(filter: InteractiveFilter): void {
    filter.sourceColumn = '';
    delete this.previewFilterValues[filter.id];
    delete this.previewFilterMultiValues[filter.id];
    this.loadFilterColumns(filter.sourceTable);
    this.applyPreviewFilters();
  }

  // ─── Searchable Source Table / Source Column dropdowns (interactive filters) ──
  openFilterField: string | null = null;
  filterFieldSearch = '';
  filterMenuPos = { top: 0, left: 0, width: 220, listMaxHeight: 220 };
  // Set while toggleFilterField's own scrollIntoView() is settling, so onAnyScroll
  // doesn't mistake that programmatic scroll for a user scroll and close the panel.
  private suppressScrollClose = false;

  /** app-root is scaled via CSS `zoom` (FontSizeService); fixed panels placed from
   *  getBoundingClientRect() must divide by this factor or they drift by rect×zoom. */
  private appZoomFactor(): number {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor'));
    return value > 0 ? value : 1;
  }

  // The table also scrolls horizontally (via scrollIntoView's default inline:'nearest') when the
  // trigger button isn't fully in view, which fires this element's own 'scroll' event directly —
  // separate from the window-level onAnyScroll — so it needs the same suppression guard.
  onFilterTableScroll(): void {
    if (this.suppressScrollClose) return;
    // Drill Down's menu is absolutely positioned inside the scrolled content, so it tracks its
    // trigger and never needs closing on scroll. Opening it low in the panel grows the scroll
    // area, which fires this handler and would otherwise close it the instant it appears.
    const drillDownWasOpen = this.showDrillDownDropdown;
    this.closeAllDropdowns();
    this.showDrillDownDropdown = drillDownWasOpen;
  }

  toggleFilterField(key: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.openFilterField === key) { this.openFilterField = null; return; }
    // Close any dropdown left open in another section (e.g. Data Mapping) — its click never reached
    // document since this row already stops propagation, so it would otherwise stay open and overlap.
    this.closeAllDropdowns();
    const button = event.currentTarget as HTMLElement;
    // Centering the trigger in its scrollable panel before measuring balances space above/below,
    // so the panel opens downward in the common case instead of flipping up over sibling sections.
    // This can itself fire a native 'scroll' event on an ancestor, which onAnyScroll would otherwise
    // treat as the user scrolling and use to immediately close the panel we're about to open.
    this.suppressScrollClose = true;
    button.scrollIntoView({ block: 'center', behavior: 'auto' });
    requestAnimationFrame(() => { this.suppressScrollClose = false; });
    const rect = button.getBoundingClientRect();
    const GAP = 4;
    const EDGE_PADDING = 12;
    const SEARCH_BOX_RESERVE = 56; // search input + spacing above the scrollable list
    const DEFAULT_LIST_HEIGHT = 220;
    const MIN_LIST_HEIGHT = 80;
    const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE_PADDING;
    const spaceAbove = rect.top - GAP - EDGE_PADDING;
    let top: number;
    let listMaxHeight: number;
    if (spaceBelow - SEARCH_BOX_RESERVE >= MIN_LIST_HEIGHT || spaceBelow >= spaceAbove) {
      top = rect.bottom + GAP;
      listMaxHeight = Math.max(MIN_LIST_HEIGHT, Math.min(DEFAULT_LIST_HEIGHT, spaceBelow - SEARCH_BOX_RESERVE));
    } else {
      listMaxHeight = Math.max(MIN_LIST_HEIGHT, Math.min(DEFAULT_LIST_HEIGHT, spaceAbove - SEARCH_BOX_RESERVE));
      top = rect.top - GAP - (listMaxHeight + SEARCH_BOX_RESERVE);
    }
    // Shrink to whatever truly fits the viewport rather than forcing MIN_LIST_HEIGHT and
    // spilling over unrelated sections above/below when the window is short (e.g. DevTools open).
    const maxTotalHeight = Math.max(SEARCH_BOX_RESERVE + 40, window.innerHeight - EDGE_PADDING * 2);
    const totalHeight = listMaxHeight + SEARCH_BOX_RESERVE;
    if (totalHeight > maxTotalHeight) { listMaxHeight = maxTotalHeight - SEARCH_BOX_RESERVE; }
    top = Math.min(Math.max(top, EDGE_PADDING), window.innerHeight - EDGE_PADDING - (listMaxHeight + SEARCH_BOX_RESERVE));
    // Clamp horizontally to the visible, bordered `.chart-setup__filter-table` card the trigger
    // lives in (not just the browser viewport) — that table scrolls horizontally when its columns
    // (Control Type/Source Table/Source Column/Action) don't fit the narrow side panel, so a
    // narrow column's button can be much slimmer than the panel's 200px minimum width; clamping
    // only to window.innerWidth let the panel spill past the table's own rounded border into the
    // canvas area beside it.
    const container = (button.closest('.chart-setup__filter-table') as HTMLElement | null)?.getBoundingClientRect() ?? null;
    const boundsLeft = Math.max(EDGE_PADDING, container ? container.left + EDGE_PADDING : EDGE_PADDING);
    const boundsRight = Math.min(window.innerWidth - EDGE_PADDING, container ? container.right - EDGE_PADDING : window.innerWidth - EDGE_PADDING);
    const width = Math.min(Math.max(rect.width, 200), Math.max(160, boundsRight - boundsLeft));
    const maxLeft = boundsRight - width;
    const left = Math.min(rect.left, Math.max(boundsLeft, maxLeft));
    const zoom = this.appZoomFactor();
    this.filterMenuPos = { top: top / zoom, left: left / zoom, width: width / zoom, listMaxHeight: listMaxHeight / zoom };
    this.openFilterField = key;
    this.filterFieldSearch = '';
  }

  filteredFilterSources(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.filterSourceOptions;
    return t ? opts.filter(source => source.toLowerCase().includes(t)
      || this.getFilterSourceLabel(source).toLowerCase().includes(t)) : opts;
  }

  filteredFilterControlTypes(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.controlTypeOptions;
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  selectFilterControlType(filter: InteractiveFilter, value: string): void {
    filter.controlType = value;
    this.openFilterField = null;
  }

  filteredFilterColumns(filter: InteractiveFilter): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = filter.sourceTable === this.selectedChartModelId
      ? this.availableSourceColumns : this.getSourceColumns(filter.sourceTable);
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  selectFilterSourceTable(filter: InteractiveFilter, value: string): void {
    filter.sourceTable = value;
    this.onFilterSourceChange(filter);
    this.openFilterField = null;
  }

  selectFilterSourceColumn(filter: InteractiveFilter, value: string): void {
    filter.sourceColumn = value;
    this.openFilterField = null;
  }

  /** "Terrain Type" -> "Terrain_Type" so it can match a view's DECLARE @terrain_type variable. */
  private normalizePlaceholderName(name: string | undefined | null): string | null {
    return name?.trim() ? name.trim().replace(/[\s-]+/g, '_') : null;
  }

  /** Mirrors the backend's FindDeclaredPlaceholder — returns the declared variable name, if any. */
  private findDeclaredPlaceholder(sql: string, name: string | undefined | null): string | null {
    if (!name?.trim()) return null;
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`DECLARE\\s+@(${escaped})\\b`, 'i').exec(sql);
    return match ? match[1] : null;
  }

  /** For View-sourced interactive filters, warns when no @placeholder in the view's SQL matches
   *  the chosen column, mirroring the server-side matching so the filter isn't silently ignored. */
  interactiveFilterPlaceholderError(filter: InteractiveFilter): string | null {
    if (this.isLocalRenamedFilter(filter)) return null;
    if (this.dataSourceMode !== 'view' || !filter.sourceColumn) return null;
    const view = this.selectedView;
    if (!view?.id) return null;
    if (!this.viewSqlCache.has(view.id)) { this.loadViewDateParameters(view.id); return null; }
    const sql = this.viewSqlCache.get(view.id) ?? '';
    const found = this.findDeclaredPlaceholder(sql, filter.label)
      ?? this.findDeclaredPlaceholder(sql, this.normalizePlaceholderName(filter.label))
      ?? this.findDeclaredPlaceholder(sql, filter.sourceColumn)
      ?? this.findDeclaredPlaceholder(sql, this.normalizePlaceholderName(filter.sourceColumn));
    if (found) return null;
    return 'Selected parameter is missing from or does not match the view.';
  }

  /** The server binds a view parameter by the control name before the source column. When only
   *  the name matches, say so instead of silently clearing the error above (DFCT0010621). */
  interactiveFilterPlaceholderNote(filter: InteractiveFilter): string | null {
    if (this.isLocalRenamedFilter(filter) || this.dataSourceMode !== 'view' || !filter.sourceColumn) return null;
    const sql = this.viewSqlCache.get(this.selectedView?.id ?? -1) ?? '';
    if (!sql) return null;
    const byColumn = this.findDeclaredPlaceholder(sql, filter.sourceColumn)
      ?? this.findDeclaredPlaceholder(sql, this.normalizePlaceholderName(filter.sourceColumn));
    if (byColumn) return null;
    const byLabel = this.findDeclaredPlaceholder(sql, filter.label)
      ?? this.findDeclaredPlaceholder(sql, this.normalizePlaceholderName(filter.label));
    return byLabel
      ? `Bound to the view parameter @${byLabel} by control name; the column "${filter.sourceColumn}" has no matching parameter.`
      : null;
  }

  // ─── Searchable dropdowns for Conditional Filters (Source Table/Column/Condition/Mode) ──
  filteredConditionalSourceTables(): string[] {
    return this.filteredFilterSources();
  }

  filteredConditionalSourceColumns(filter: ConditionalFilter): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    // Conditional filters always target the currently selected model (the Source Table picker is
    // disabled), so reuse the Data Mapping column list — it reflects transform/rename rules —
    // instead of re-fetching the raw, untransformed schema via getSourceColumns.
    const sourceTable = this.selectedChartModelId || filter.sourceTable;
    const opts = sourceTable === this.selectedChartModelId
      ? this.availableSourceColumns
      : this.getSourceColumns(sourceTable);
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  filteredConditionalOperators(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.conditionalOperatorOptions;
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : [...opts];
  }

  /** Displays operator values (stored lowercase for matching) in Title Case, e.g. "does not contain" -> "Does Not Contain". */
  formatOperatorLabel(operator: string): string {
    return operator.replace(/\b\w/g, c => c.toUpperCase());
  }

  filteredConditionalModes(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.conditionalModeOptions;
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  selectConditionalSourceTable(filter: ConditionalFilter, value: string): void {
    filter.sourceTable = value;
    this.onConditionalFilterSourceChange(filter);
    this.openFilterField = null;
  }

  selectConditionalSourceColumn(filter: ConditionalFilter, value: string): void {
    filter.sourceTable = this.selectedChartModelId || filter.sourceTable;
    filter.sourceColumn = value;
    this.onPreviewFilterChange();
    this.openFilterField = null;
  }

  selectConditionalOperator(filter: ConditionalFilter, value: string): void {
    filter.operator = value;
    this.onPreviewFilterChange();
    this.openFilterField = null;
  }

  selectConditionalMode(filter: ConditionalFilter, value: string): void {
    if (!this.isConditionalModeEnabled(filter)) return;
    filter.mode = value;
    this.onPreviewFilterChange();
    this.openFilterField = null;
  }

  // ─── Searchable dropdowns for Data Transformation (Action / Rule Parameters) ──
  readonly parameterActionOptions: { value: ParameterFilterAction; label: string }[] = [
    { value: 'type_change', label: 'Change Data Type' },
    { value: 'rename_column', label: 'Rename Column' },
    { value: 'replace_nulls', label: 'Replace Nulls' },
    { value: 'deduplicate', label: 'Deduplicate Rows' },
    { value: 'split_column', label: 'Split Column' },
    { value: 'merge_columns', label: 'Merge Columns' },
    { value: 'text_operation', label: 'Text Operation' },
    { value: 'json_extract', label: 'JSON Extraction' },
    { value: 'math_transform', label: 'Math Operation' },
    { value: 'date_operation', label: 'Date Operation' },
  ];
  readonly dedupStrategyOptions: { value: string; label: string }[] = [
    { value: 'Keep First', label: 'Keep First' },
    { value: 'Keep Last', label: 'Keep Last' },
    { value: 'Keep Unique', label: 'Keep Unique Only' },
  ];
  readonly targetTypeOptions = ['Number', 'Text', 'Date', 'Boolean'];
  readonly textTransformOptions = ['Trim Whitespace', 'UPPERCASE', 'lowercase', 'Title Case'];
  readonly textOperationOptions = ['Trim Whitespace', 'UPPERCASE', 'lowercase', 'Title Case', 'Replace Text', 'Concatenate', 'First N Chars', 'Last N Chars', 'Substring', 'Pad', 'Remove Characters', 'Regex Extract'];
  readonly dateOperationOptions = ['Format Date', 'Extract Date Part', 'Add/Subtract Duration', 'Start of Period', 'End of Period', 'Date Difference'];
  readonly datePartOptions = ['Year', 'Quarter', 'Month', 'Week', 'Day'];
  readonly dateUnitOptions = ['Days', 'Weeks', 'Months', 'Years'];
  readonly dateFormatOptions = [
    'YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY',
    'YYYY/MM/DD', 'DD/MM/YYYY', 'MM/DD/YYYY',
    'YYYY.MM.DD', 'DD.MM.YYYY', 'MM.DD.YYYY',
    'DD MMM YYYY', 'MMM DD, YYYY', 'MMMM DD, YYYY',
    'DD MMMM YYYY', 'MMMM DD, YY', 'DD MMM YY',
  ];
  readonly extractModeOptions = ['First N Chars', 'Last N Chars', 'Substring'];

  readonly mathOperatorOptions: { value: string; label: string }[] = [
    { value: '+', label: '(+) Addition' },
    { value: '-', label: '(-) Subtraction' },
    { value: '*', label: '(*) Multiplication' },
    { value: '/', label: '(/) Division' },
    { value: 'average', label: '(x̄) Average' },
    { value: '%', label: '(%) Modulo' },
    { value: 'power', label: '(^) Power' },
    { value: 'abs', label: '(|x|) Absolute Value' },
    { value: 'sqrt', label: '(√) Square Root' },
    { value: 'percentage', label: '(%) Percentage' },
  ];

  getParameterActionLabel(action: ParameterFilterAction | ''): string {
    return this.parameterActionOptions.find(o => o.value === action)?.label ?? (action || 'Select');
  }

  getDedupStrategyLabel(value: string | undefined): string {
    return this.dedupStrategyOptions.find(o => o.value === value)?.label ?? (value || 'Select');
  }

  filteredParameterActions(): { value: ParameterFilterAction; label: string }[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.parameterActionOptions.filter(o => o.label.toLowerCase().includes(t)) : this.parameterActionOptions;
  }

  filteredDedupStrategies(): { value: string; label: string }[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.dedupStrategyOptions.filter(o => o.label.toLowerCase().includes(t)) : this.dedupStrategyOptions;
  }

  filteredTargetTypes(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.targetTypeOptions.filter(o => o.toLowerCase().includes(t)) : this.targetTypeOptions;
  }

  filteredTextTransforms(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.textTransformOptions.filter(o => o.toLowerCase().includes(t)) : this.textTransformOptions;
  }

  filteredTextOperations(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.textOperationOptions.filter(o => o.toLowerCase().includes(t)) : this.textOperationOptions;
  }

  filteredExtractModes(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.extractModeOptions.filter(o => o.toLowerCase().includes(t)) : this.extractModeOptions;
  }

  filteredDateFormats(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.dateFormatOptions.filter(o => o.toLowerCase().includes(t)) : this.dateFormatOptions;
  }

  filteredSecondaryColumns(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.availableSourceColumns;
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  selectParameterAction(rule: ParameterFilterRule, value: ParameterFilterAction): void {
    const actionChanged = rule.action !== value;
    rule.action = value;
    if (actionChanged) {
      // Starting a (re)selected action fresh: drop the previous action's source columns and all of
      // its parameters so no stale selection — or validation message derived from one — carries over.
      Object.assign(rule, this.defaultParameterRuleFields());
    } else {
      this.normalizeParameterFilterColumns(rule);
    }
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectTargetType(rule: ParameterFilterRule, value: string): void {
    rule.targetType = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectDedupStrategy(rule: ParameterFilterRule, value: string): void {
    rule.dedupStrategy = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectSecondaryColumn(rule: ParameterFilterRule, value: string): void {
    rule.secondaryColumn = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectTextTransform(rule: ParameterFilterRule, value: string): void {
    rule.textTransform = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectTextOperation(rule: ParameterFilterRule, value: string): void {
    rule.textOperation = value;
    this.normalizeParameterFilterColumns(rule);
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectExtractMode(rule: ParameterFilterRule, value: string): void {
    rule.extractMode = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  selectDateFormat(rule: ParameterFilterRule, value: string): void {
    rule.dateFormat = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  getMathOperatorLabel(value: string | undefined): string {
    return this.mathOperatorOptions.find(o => o.value === value)?.label ?? (value || 'Select…');
  }

  filteredMathOperators(): { value: string; label: string }[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.mathOperatorOptions.filter(o => o.label.toLowerCase().includes(t)) : this.mathOperatorOptions;
  }

  selectMathOperator(rule: ParameterFilterRule, value: string): void {
    rule.mathOperator = value;
    this.onParameterFilterChange();
    this.openFilterField = null;
  }

  addFilter(): void {
    this.interactiveFilters.push({ id: this.nextFilterId++, label: '', controlType: '', sourceTable: '', sourceColumn: '', locked: false, hidden: false });
    this.cdr.markForCheck();
  }

  removeFilter(id: number): void {
    this.interactiveFilters = this.interactiveFilters.filter(f => f.id !== id);
    delete this.previewFilterValues[id];
    delete this.previewFilterMultiValues[id];
    this.applyPreviewFilters();
    this.cdr.markForCheck();
  }

  toggleFilterLocked(filter: InteractiveFilter): void {
    filter.locked = !filter.locked;
    if (filter.locked) {
      // Freeze whatever selection is active in the preview right now.
      if (filter.controlType === 'MultiSelect') {
        filter.lockedValues = [...(this.previewFilterMultiValues[filter.id] ?? [])];
      } else {
        filter.lockedValue = this.previewFilterValues[filter.id] ?? '';
      }
    } else {
      delete filter.lockedValue;
      delete filter.lockedValues;
    }
    this.cdr.markForCheck();
  }

  toggleFilterHidden(filter: InteractiveFilter): void {
    filter.hidden = !filter.hidden;
    this.cdr.markForCheck();
  }

  conditionalFilters: ConditionalFilter[] = [];
  readonly conditionalOperatorOptions = CONDITIONAL_FILTER_OPERATORS;
  readonly conditionalModeOptions = ['Include', 'Exclude'];

  rawLoadedRows: Record<string, unknown>[] = [];
  rawLoadedColumns: string[] = [];

  // Import mode: raw data-grid preview (ag-grid), shown instead of the mapped Table chart preview.
  readonly importGridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    headerBackgroundColor: '#2948A3',
    headerTextColor: '#FFFFFF',
    headerFontWeight: 600,
    rowHoverColor: '#F5F8FF',
  });
  readonly importGridDefaultColDef: ColDef = {
    sortable: true, resizable: true, filter: true, flex: 1, minWidth: 170,
    valueFormatter: params => DateUtil.formatCellValue(params.value),
    headerStyle: { background: 'linear-gradient(180deg, #2948A3 0%, #3B58B6 100%)', color: '#FFFFFF' },
  };

  readonly importGridRowStyle = (params: RowClassParams) => ({
    backgroundColor: this.CB_ROW_BG[(params.node.rowIndex ?? 0) % this.CB_ROW_BG.length],
    color: '#101828',
  });

  private importGridColumnsKey = '';
  private importGridColumnsCache: ColDef[] = [];

  get importGridColumnDefs(): ColDef[] {
    // Derive from the actual (possibly transformed) row shape, not rawLoadedColumns, so Data
    // Transformation rules (rename/split/merge/extract) are reflected in the grid headers.
    const cols = this.tableRows.length ? Object.keys(this.tableRows[0]) : this.rawLoadedColumns;
    const key = JSON.stringify(cols);
    // Cache by column set so [columnDefs] keeps the same array reference across change-detection
    // cycles — a fresh array on every read makes ag-grid re-apply defaults, undoing user column resizes.
    if (key === this.importGridColumnsKey) return this.importGridColumnsCache;
    this.importGridColumnsKey = key;
    this.importGridColumnsCache = cols.map(col => ({ field: col, headerName: col, headerTooltip: col }));
    return this.importGridColumnsCache;
  }

  private importGridRowsKey = '';
  private importGridRowsSource: Record<string, unknown>[] | null = null;
  private importGridRowsTable: Record<string, unknown>[] | null = null;
  private importGridRowsCache: Record<string, unknown>[] = [];

  get importGridRowData(): Record<string, unknown>[] {
    const sourceRows = this.crossTableFilterRows ?? this.tableRows;
    const key = JSON.stringify([this.dataSourceMode, this.xAxis, this.timelineDateColumn,
      this.fromDate, this.toDate, this.filterValues]);
    if (sourceRows === this.importGridRowsSource && this.tableRows === this.importGridRowsTable &&
      key === this.importGridRowsKey) return this.importGridRowsCache;
    this.importGridRowsSource = sourceRows;
    this.importGridRowsTable = this.tableRows;
    this.importGridRowsKey = key;
    const rows = this.previewRows;
    // Filters that exclude every row: keep the category names with empty values (DFCT0010362),
    // the same as the Table/View preview.
    if (!this.tableRows.length || rows.length) {
      this.importGridRowsCache = rows;
      return this.importGridRowsCache;
    }
    const category = this.xAxis;
    this.importGridRowsCache = this.tableRows.map(row => Object.fromEntries(
      Object.keys(row).map(col => [col, col === category ? row[col] : '—'])));
    return this.importGridRowsCache;
  }

  private tablePreviewColumnsKey = '';
  private tablePreviewColumnsCache: ColDef[] = [];
  private tablePreviewRowsKey = '';
  private tablePreviewRowsSource: Record<string, unknown>[] | null = null;
  private tablePreviewRowsCache: {
    values: unknown[];
    index: number;
    summary?: boolean;
    summaryMeasureId?: string;
    summaryReferencedIndexes?: number[];
    summaryResultIndex?: number;
    summaryTooltip?: string;
  }[] = [];
  private hoveredDaxSummaryMeasureId: string | null = null;

  get tablePreviewColumnDefs(): ColDef[] {
    const extraColumns = this.tableExtraColumns;
    const headers = [
      this.xAxisTitle || this.xAxis || 'Parameter',
      ...(extraColumns.length ? extraColumns : [this.yAxisTitle || this.yAxis || 'Value']),
      ...this.daxRowWiseMeasures.map(measure => measure.name?.trim() || 'New Measure'),
    ];
    const key = JSON.stringify([headers, this.xAxis, extraColumns, this.yAxis,
      this.tableHeaderColor, this.tableHeaderTextColor]);
    if (key === this.tablePreviewColumnsKey) return this.tablePreviewColumnsCache;
    this.tablePreviewColumnsKey = key;
    this.tablePreviewColumnsCache = headers.map((headerName, index) => ({
      colId: `preview-${index}`,
      headerName,
      headerTooltip: headerName,
      valueGetter: params => params.data?.values[index],
      valueFormatter: params => DateUtil.formatCellValue(params.value),
      cellStyle: params => {
        const isRelatedColumn = this.isDaxHighlightedColumn(index);
        return isRelatedColumn ? {
          backgroundColor: '#EAF1FF',
          color: '#21409A',
          fontWeight: '600',
        } : null;
      },
      tooltip: params => {
        const data = params.data as typeof this.tablePreviewRowsCache[number] | undefined;
        return data?.summaryResultIndex === index ? data.summaryTooltip : undefined;
      },
      headerStyle: {
        background: this.tableHeaderColor || 'linear-gradient(180deg, #2948A3 0%, #3B58B6 100%)',
        color: this.tableHeaderTextColor || '#FFFFFF',
      },
    }));
    return this.tablePreviewColumnsCache;
  }

  get tablePreviewRowData(): typeof this.tablePreviewRowsCache {
    // Never fall back to the "Row 1, Row 2…" sample while a real fetch is in flight — the
    // *ngIf guard around the grid should already prevent this, but this is a direct, timing
    // -independent safeguard against the placeholder ever flashing before real data arrives.
    if (this.sourceLoading) return [];
    const sourceRows = this.crossTableFilterRows ?? this.tableRows;
    const rows = this.previewRows;
    const extraColumns = this.tableExtraColumns;
    const valueColumns = extraColumns.length ? extraColumns : [this.yAxis];
    const measures = this.daxRowWiseMeasures;
    const summaryMeasures = this.daxRowSummaryMeasures;
    // Keep the cache key lightweight. Serializing every source row here runs on each Angular
    // change-detection pass and can freeze or crash the browser for large table sources.
    const key = JSON.stringify([this.xAxis, valueColumns, measures, summaryMeasures,
      this.yAxisColumns, this.tableRowColors, this.tableRowTextColors, this.colorRules, this.filterValues,
      this.previewFilterMultiValues, this.fromDate, this.toDate]);
    if (sourceRows === this.tablePreviewRowsSource && key === this.tablePreviewRowsKey) return this.tablePreviewRowsCache;
    this.tablePreviewRowsSource = sourceRows;
    this.tablePreviewRowsKey = key;
    // Filters that exclude every row: keep the real category names with empty values, rather
    // than the "Row 1, Row 2…" sample meant for a chart with no data mapped yet.
    if (this.tableRows.length && this.xAxis && !rows.length) {
      const categories = [...new Set(this.tableRows.map(row => row[this.xAxis]).filter(value => value !== null && value !== undefined && value !== ''))];
      this.tablePreviewRowsCache = categories.map((category, index) => ({
        index,
        values: [category, ...valueColumns.map(() => '—'), ...measures.map(() => '—')],
      }));
      return this.tablePreviewRowsCache;
    }
    if (!rows.length || !this.xAxis) {
      this.tablePreviewRowsCache = [88, 57, 94, 51, 68].map((value, index) => ({
        index,
        values: [
          `Row ${index + 1}`,
          ...valueColumns.map(() => extraColumns.length ? '—' : value),
          ...measures.map(() => '—'),
        ],
      }));
      return this.tablePreviewRowsCache;
    }
    this.tablePreviewRowsCache = [
      ...rows.map((row, index) => ({
        index,
        values: [row[this.xAxis], ...valueColumns.map(column => row[column] ?? '—'),
          ...measures.map(measure => this.daxMeasureRowValue(measure, row))],
      })),
      ...summaryMeasures.map(measure => ({
        index: 0,
        summary: true,
        summaryMeasureId: measure.id,
        // Grid index 0 is the category column; DAX value-column indexes start at 1.
        summaryReferencedIndexes: this.daxSummaryColumnIndexes(measure, valueColumns).map(index => index + 1),
        summaryResultIndex: this.daxSummaryColumnIndex(measure, valueColumns) + 1,
        summaryTooltip: this.daxSummaryTooltip(measure, valueColumns),
        // Same cells the saved views render (one result per column for e.g. COUNT([A], [B])).
        values: [measure.name?.trim() || 'New Measure',
          ...daxSummaryCells(measure, this.previewRows, valueColumns, this.yAxisColumns),
          ...measures.map(() => '—')],
      })),
    ];
    return this.tablePreviewRowsCache;
  }

  private daxSummaryColumnIndex(measure: DaxMeasureConfig, valueColumns: string[]): number {
    const referencedColumns = getDaxReferencedColumns(measure);
    let resultIndex = -1;
    valueColumns.forEach((column, index) => {
      if (referencedColumns.includes(column)) resultIndex = index;
    });
    return resultIndex >= 0 ? resultIndex : valueColumns.length - 1;
  }

  private daxSummaryColumnIndexes(measure: DaxMeasureConfig, valueColumns: string[]): number[] {
    const referencedColumns = getDaxReferencedColumns(measure);
    return valueColumns.reduce<number[]>((indexes, column, index) => {
      if (referencedColumns.includes(column)) indexes.push(index);
      return indexes;
    }, []);
  }

  private daxSummaryTooltip(measure: DaxMeasureConfig, valueColumns: string[]): string {
    const operation = /^([A-Za-z]\w*)/.exec(measure.expression.trim())?.[1] || 'DAX expression';
    const columns = getDaxReferencedColumns(measure);
    const displayedColumns = valueColumns.filter(column => columns.includes(column));
    return `Operation: ${operation}\nColumns: ${displayedColumns.length ? displayedColumns.join(' + ') : columns.join(' + ') || 'Not specified'}`;
  }

  private isDaxHighlightedColumn(index: number): boolean {
    const summaryRow = this.tablePreviewRowsCache.find(row => row.summaryMeasureId === this.hoveredDaxSummaryMeasureId);
    return summaryRow?.summaryReferencedIndexes?.includes(index) ?? false;
  }

  tablePreviewCellMouseOver(event: CellMouseOverEvent): void {
    const measureId = event.node.data?.summaryMeasureId as string | undefined;
    const resultIndex = event.node.data?.summaryResultIndex as number | undefined;
    const columnIndex = Number(event.column.getColId().replace('preview-', ''));
    if (!measureId || resultIndex !== columnIndex || measureId === this.hoveredDaxSummaryMeasureId) return;
    this.hoveredDaxSummaryMeasureId = measureId;
    event.api.refreshCells({ force: true });
  }

  tablePreviewCellMouseOut(event: CellMouseOutEvent): void {
    if (!this.hoveredDaxSummaryMeasureId) return;
    this.hoveredDaxSummaryMeasureId = null;
    event.api.refreshCells({ force: true });
  }

  readonly tablePreviewRowStyle = (params: RowClassParams) => {
    const index = params.data?.index ?? 0;
    // A colour rule (category list or value condition) wins over the per-row palette, as it does on charts.
    const ruleColor = params.data?.summary ? undefined : this.tableRowRuleColor(params.data?.values ?? []);
    const customColor = params.data?.summary ? undefined : ruleColor || this.tableRowColors[index];
    return {
      backgroundColor: params.data?.summary ? this.CB_ROW_BG[0] : ruleColor || this.tableRowColors[index] || this.CB_ROW_BG[index % this.CB_ROW_BG.length],
      '--ag-row-hover-color': customColor ? 'transparent' : '#F5F8FF',
      color: this.tableRowTextColors[index] || '#101828',
    };
  };

  /** Colour from the rules for a table row: the first cell is the category, the second the value. */
  private tableRowRuleColor(values: readonly unknown[]): string | undefined {
    if (!this.colorRules.length || !values.length) return undefined;
    const category = String(values[0] ?? '');
    const value = Number(values[1]);
    return this.previewCategoryColorFor(category) ?? this.previewColorFor(category, Number.isFinite(value) ? value : NaN);
  }

  parameterFilters: ParameterFilterRule[] = [];
  private appliedRenameMap: Record<number, { sourceColumn: string; appliedName: string }> = {};

  get availableSourceColumns(): string[] {
    const columns = this.rawLoadedColumns.length ? this.rawLoadedColumns
      : this.xAxisOptions.length ? this.xAxisOptions : this.yAxisColumns;
    return getTransformationSourceColumns(columns, this.parameterFilters);
  }

  private isLocalRenamedFilter(filter: { sourceTable: string; sourceColumn: string }): boolean {
    return filter.sourceTable === this.selectedChartModelId
      && !this.rawLoadedColumns.includes(filter.sourceColumn)
      && this.availableSourceColumns.includes(filter.sourceColumn);
  }

  /** Default values for every parameter field of a transformation rule (everything except id/action/enabled).
   *  Shared by new-rule creation and the action-change reset so both stay in sync. */
  private defaultParameterRuleFields(): Partial<ParameterFilterRule> {
    return {
      sourceColumn: '',
      sourceColumns: [],
      secondaryColumn: '',
      targetType: '',
      newColumnName: '',
      replaceValue: '',
      valueText: '',
      dedupStrategy: '',
      delimiter: '-',
      separator: '',
      textTransform: 'Trim Whitespace',
      textOperation: 'Trim Whitespace',
      literalText: '',
      findText: '',
      replaceText: '',
      textLength: 3,
      padDirection: 'Right',
      padCharacter: '0',
      dateOperation: '',
      dateFormat: 'YYYY-MM-DD',
      datePart: 'Year',
      dateAmount: null,
      dateUnit: 'Days',
      extractMode: 'First N Chars',
      extractLength: 3,
      startIndex: 0,
      jsonPath: '$',
      mathOperator: '+',
      mathValue: null,
    };
  }

  addParameterFilter(): void {
    this.parameterFilters.push({
      id: this.nextFilterId++,
      action: '',
      enabled: true,
      ...this.defaultParameterRuleFields(),
    });
    this.applyParameterDrivenTransformations();
    this.cdr.markForCheck();
  }

  toggleParameterFilterEnabled(rule: ParameterFilterRule): void {
    rule.enabled = rule.enabled === false ? true : false;
    this.applyParameterDrivenTransformations();
    this.cdr.markForCheck();
  }

  removeParameterFilter(id: number): void {
    const index = this.parameterFilters.findIndex(rule => rule.id === id);
    if (index < 0) return;
    delete this.paramColSearch[id];
    if (this.openParamColDropdownId === id) this.openParamColDropdownId = null;
    this.parameterFilters = [
      ...this.parameterFilters.slice(0, index),
      ...this.parameterFilters.slice(index + 1),
    ];
    this.applyParameterDrivenTransformations();
    this.cdr.markForCheck();
  }

  trackParameterFilter(_index: number, rule: ParameterFilterRule): number {
    return rule.id;
  }

  openParamColDropdownId: number | null = null;
  paramColSearch: Record<number, string> = {};
  paramDropdownPos: { top: number; left: number; minWidth: number } = { top: 0, left: 0, minWidth: 220 };

  getParamColSummary(rule: ParameterFilterRule): string {
    const cols = getRuleSourceColumns(rule);
    if (!cols.length) return this.isSingleColumnRule(rule) ? 'Select Column' : 'Select columns...';
    if (cols.length === 1) return cols[0];
    return `${cols.length} columns selected`;
  }

  toggleParamColDropdown(id: number, event?: Event): void {
    const willOpen = this.openParamColDropdownId !== id;
    if (event) {
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        const zoom = this.appZoomFactor();
        this.paramDropdownPos = {
          top: (rect.bottom + 4) / zoom,
          left: rect.left / zoom,
          minWidth: Math.max(220, rect.width / zoom),
        };
      }
    }
    // Close any other open dropdown (e.g. the Action dropdown) so only one stays open at a time.
    this.closeAllDropdowns();
    this.openParamColDropdownId = willOpen ? id : null;
  }

  getFilteredSourceColumns(ruleId: number): string[] {
    const search = (this.paramColSearch[ruleId] ?? '').toLowerCase().trim();
    const allCols = this.availableSourceColumns;
    if (!search) return allCols;
    return allCols.filter(col => col.toLowerCase().includes(search));
  }

  isParamColSelected(rule: ParameterFilterRule, col: string): boolean {
    return getRuleSourceColumns(rule).includes(col);
  }

  /** The only actions that genuinely consume several source columns at once. */
  private supportsMultipleSourceColumns(rule: ParameterFilterRule): boolean {
    return rule.action === 'merge_columns' ||
      (rule.action === 'text_operation' && rule.textOperation === 'Concatenate');
  }

  /** Actions that act on exactly one column, so the source picker renders as a single-select list. */
  isSingleColumnRule(rule: ParameterFilterRule): boolean {
    return !this.supportsMultipleSourceColumns(rule);
  }

  selectParamCol(rule: ParameterFilterRule, col: string): void {
    rule.sourceColumns = [col];
    rule.sourceColumn = col;
    this.openParamColDropdownId = null;
    this.onParameterFilterChange();
  }

  toggleParamCol(rule: ParameterFilterRule, col: string): void {
    const current = getRuleSourceColumns(rule);
    const supportsMultiple = this.supportsMultipleSourceColumns(rule);
    const next = supportsMultiple
      ? (current.includes(col) ? current.filter(c => c !== col) : [...current, col])
      : (current.length === 1 && current[0] === col ? [] : [col]);
    rule.sourceColumns = next;
    rule.sourceColumn = next[0] ?? '';
    this.onParameterFilterChange();
    this.cdr.markForCheck();
  }

  toggleAllParamCols(rule: ParameterFilterRule): void {
    const filtered = this.getFilteredSourceColumns(rule.id);
    const current = getRuleSourceColumns(rule);
    const supportsMultiple = this.supportsMultipleSourceColumns(rule);
    if (!supportsMultiple) {
      const next = current.length === 1 && filtered.includes(current[0]) ? [] : (filtered[0] ? [filtered[0]] : []);
      rule.sourceColumns = next;
      rule.sourceColumn = next[0] ?? '';
      this.onParameterFilterChange();
      this.cdr.markForCheck();
      return;
    }
    const allSelected = filtered.length > 0 && filtered.every(c => current.includes(c));
    if (allSelected) {
      rule.sourceColumns = current.filter(c => !filtered.includes(c));
    } else {
      rule.sourceColumns = [...new Set([...current, ...filtered])];
    }
    rule.sourceColumn = rule.sourceColumns[0] ?? '';
    this.onParameterFilterChange();
    this.cdr.markForCheck();
  }

  areAllParamColsSelected(rule: ParameterFilterRule): boolean {
    const filtered = this.getFilteredSourceColumns(rule.id);
    if (!filtered.length) return false;
    const current = getRuleSourceColumns(rule);
    return filtered.every(c => current.includes(c));
  }

  private syncParameterFilterIds(): void {
    for (const rule of this.parameterFilters) {
      // Preserve the evaluator defaults of older saved rules without explicit selections.
      if (rule.action === 'type_change' && rule.targetType == null) rule.targetType = 'Text';
      if (rule.action === 'deduplicate' && rule.dedupStrategy == null) rule.dedupStrategy = 'Keep First';
      this.normalizeParameterFilterColumns(rule);
      this.nextFilterId = Math.max(this.nextFilterId, rule.id + 1);
    }
  }

  private normalizeParameterFilterColumns(rule: ParameterFilterRule): void {
    if (this.supportsMultipleSourceColumns(rule)) return;
    const first = getRuleSourceColumns(rule)[0] ?? '';
    rule.sourceColumns = first ? [first] : [];
    rule.sourceColumn = first;
  }

  /**
   * Message shown under a transformation rule: a blocking error while the rule is incomplete,
   * or a warning when a numeric column is about to become text and lose aggregation.
   */
  parameterRuleMessage(rule: ParameterFilterRule): { text: string; warning: boolean } | null {
    const error = getParameterRuleError(rule);
    if (error) return { text: error, warning: false };
    if (rule.action === 'json_extract' && this.tableRows.length) {
      const path = rule.jsonPath?.trim() || '$';
      const empty = getRuleSourceColumns(rule).filter(col => countJsonPathMatches(this.tableRows, col, path) === 0);
      if (empty.length) {
        return {
          text: `No value found at ${path} in ${empty.join(', ')}. Check the path and that the column holds JSON such as {"count": 5}.`,
          warning: false,
        };
      }
    }
    if (rule.action === 'type_change' && rule.targetType === 'Text') {
      const numeric = getRuleSourceColumns(rule).filter(col => this.hasNumericValues(col));
      if (numeric.length) {
        const cols = numeric.join(', ');
        const plural = numeric.length > 1;
        return {
          text: `${cols} ${plural ? 'are' : 'is'} now Text. ${plural ? 'They' : 'It'} can be used as a category or counted, but no longer summed or averaged as a chart value.`,
          warning: true,
        };
      }
    }
    return null;
  }

  paramFilterMissingTargetType(rule: ParameterFilterRule): boolean {
    return rule.enabled !== false && rule.action === 'type_change' && rule.targetType === '';
  }

  onParameterFilterChange(): void {
    this.applyParameterDrivenTransformations();
    this.cdr.markForCheck();
  }

  private applyParameterDrivenTransformations(): void {
    if (!this.rawLoadedRows.length) {
      this.tableRows = [];
      this.crossTableFilterRows = null;
      this.xAxisOptions = [...this.rawLoadedColumns];
      this.yAxisColumns = [...this.rawLoadedColumns];
      this.applyPreviewFilters();
      return;
    }

    this.syncActiveColumnRenames();

    const res = applyParameterFilters(this.rawLoadedRows, this.parameterFilters, this.rawLoadedColumns);
    this.tableRows = res.rows;
    if (res.columns.length) {
      this.xAxisOptions = res.columns;
      this.yAxisColumns = res.columns;
    }
    this.applyPreviewFilters();
  }

  private syncActiveColumnRenames(): void {
    const currentRuleIds = new Set(this.parameterFilters.map(r => r.id));

    // Handle removed rules: revert their rename
    for (const [idStr, prev] of Object.entries(this.appliedRenameMap)) {
      const id = Number(idStr);
      if (!currentRuleIds.has(id)) {
        if (prev.appliedName && prev.sourceColumn && prev.appliedName !== prev.sourceColumn) {
          this.remapActiveColumns(prev.appliedName, prev.sourceColumn);
        }
        delete this.appliedRenameMap[id];
      }
    }

    // Handle existing rules
    for (const rule of this.parameterFilters) {
      this.syncSingleRuleRename(rule);
    }
  }

  private syncSingleRuleRename(rule: ParameterFilterRule): void {
    const prev = this.appliedRenameMap[rule.id];
    const sourceCols = getRuleSourceColumns(rule);
    const primarySource = sourceCols[0] ?? rule.sourceColumn ?? '';
    const isRename = rule.action === 'rename_column' && rule.enabled !== false && !!primarySource && !!rule.newColumnName?.trim() && rule.newColumnName.trim() !== primarySource;
    const desiredName = isRename ? rule.newColumnName!.trim() : primarySource;

    if (!isRename) {
      if (prev?.appliedName && prev?.sourceColumn && prev.appliedName !== prev.sourceColumn) {
        this.remapActiveColumns(prev.appliedName, prev.sourceColumn);
      }
      delete this.appliedRenameMap[rule.id];
      return;
    }

    if (prev) {
      if (prev.sourceColumn !== primarySource) {
        if (prev.appliedName !== prev.sourceColumn) {
          this.remapActiveColumns(prev.appliedName, prev.sourceColumn);
        }
        this.remapActiveColumns(primarySource, desiredName);
      } else if (prev.appliedName !== desiredName) {
        this.remapActiveColumns(prev.appliedName, desiredName);
      }
    } else {
      this.remapActiveColumns(primarySource, desiredName);
    }

    this.appliedRenameMap[rule.id] = {
      sourceColumn: primarySource,
      appliedName: desiredName,
    };
  }

  private remapActiveColumns(fromCol: string, toCol: string): void {
    if (!fromCol || !toCol || fromCol === toCol) return;
    this.advancedConfig = remapAdvancedColumns(this.advancedConfig, fromCol, toCol);
    // Measures referencing the old name would otherwise evaluate to 0 with no error.
    this.daxModel = { ...this.daxModel, measures: this.daxModel.measures.map(m => renameDaxColumn(m, fromCol, toCol)) };
    this.daxMeasureDraft = renameDaxColumn(this.daxMeasureDraft, fromCol, toCol);
    this.selectedDaxColumns = this.selectedDaxColumns.map(c => c === fromCol ? toCol : c);

    if (this.xAxis === fromCol) {
      this.xAxis = toCol;
      if (this.xAxisTitle === fromCol || !this.xAxisTitle) {
        this.xAxisTitle = toCol;
      }
    }
    if (this.yAxis === fromCol) {
      this.yAxis = toCol;
      if (this.yAxisTitle === fromCol || !this.yAxisTitle) {
        this.yAxisTitle = toCol;
      }
    }
    if (this.yAggColumn === fromCol) {
      this.yAggColumn = toCol;
    }
    if (this.multiYColumns.includes(fromCol)) {
      this.multiYColumns = [...new Set(this.multiYColumns.map(c => c === fromCol ? toCol : c))];
    }
    if (this.comboLineColumns.includes(fromCol)) {
      this.comboLineColumns = [...new Set(this.comboLineColumns.map(c => c === fromCol ? toCol : c))];
    }
  }

  addConditionalFilter(): void {
    const source = this.selectedChartModelId || (this.chartModels[0]?.id ?? '');
    this.conditionalFilters.push({
      id: this.nextFilterId++,
      label: '',
      sourceTable: source,
      sourceColumn: '',
      operator: '',
      valueText: '',
      mode: '',
      hidden: true,
      values: [],
    });
    this.cdr.markForCheck();
  }

  toggleConditionalFilterHidden(filter: ConditionalFilter): void {
    filter.hidden = !filter.hidden;
    this.cdr.markForCheck();
  }

  isConditionalModeEnabled(filter: ConditionalFilter): boolean {
    const hasValue = !!filter.valueText?.trim() ||
      (this.previewFilterMultiValues[filter.id]?.length ?? 0) > 0 ||
      (filter.values?.length ?? 0) > 0;
    return !!filter.sourceColumn && hasValue;
  }

  /** Mirrors saved conditional filter values back into the live preview selections. */
  private syncConditionalFilterSelections(): void {
    for (const filter of this.conditionalFilters) {
      filter.values ??= [];
      this.previewFilterMultiValues[filter.id] = [...filter.values];
      this.nextFilterId = Math.max(this.nextFilterId, filter.id + 1);
    }
  }

  /** Seeds the live preview selections from any locked interactive filter's frozen value so the canvas reflects it. */
  private syncInteractiveFilterSelections(): void {
    for (const filter of this.interactiveFilters) {
      // A saved chart's filters keep their original ids; without this, a newly added filter
      // could reuse an id already in use by a loaded one (both default-start at 1), corrupting
      // the id-keyed preview/dropdown state shared between them.
      this.nextFilterId = Math.max(this.nextFilterId, filter.id + 1);
      if (!filter.locked) continue;
      if (filter.controlType === 'MultiSelect') {
        this.previewFilterMultiValues[filter.id] = [...(filter.lockedValues ?? [])];
      } else {
        this.previewFilterValues[filter.id] = filter.lockedValue ?? '';
      }
    }
  }

  onConditionalFilterSourceChange(filter: ConditionalFilter): void {
    filter.sourceColumn = '';
    delete this.previewFilterMultiValues[filter.id];
    this.loadFilterColumns(filter.sourceTable);
    this.applyPreviewFilters();
  }

  removeConditionalFilter(id: number): void {
    this.conditionalFilters = this.conditionalFilters.filter(f => f.id !== id);
    delete this.previewFilterMultiValues[id];
    this.applyPreviewFilters();
    this.cdr.markForCheck();
  }

  // -- MultiSelect local filter (table sources, include-only) --------------
  toggleMultiFilter(id: number): void {
    this.openMultiFilterId = this.openMultiFilterId === id ? null : id;
    if (this.openMultiFilterId === id) this.filterOptionSearch[id] = '';
  }

  /** Per-filter search text for the preview widget's value list (Dropdown and MultiSelect) —
   *  keeps huge "large data" columns usable instead of a long unsearchable scroll. */
  filterOptionSearch: Record<number, string> = {};

  filteredPreviewFilterOptions(filter: { id: number; sourceTable: string; sourceColumn: string; locked?: boolean; lockedValue?: string; lockedValues?: string[]; controlType?: string }): string[] {
    const term = (this.filterOptionSearch[filter.id] ?? '').trim().toLowerCase();
    const options = this.getPreviewFilterOptions(filter);
    return term ? options.filter(option => option.toLowerCase().includes(term)) : options;
  }

  /** Dropdown (single-select) preview widget: picks one value or clears back to "All". */
  selectPreviewFilterValue(filter: { id: number; locked?: boolean }, option: string): void {
    if (filter.locked) return;
    this.previewFilterValues[filter.id] = option;
    this.openMultiFilterId = null;
    this.onPreviewFilterChange();
  }

  isMultiChecked(id: number, option: string): boolean {
    return (this.previewFilterMultiValues[id] ?? []).includes(option);
  }

  toggleMultiValue(id: number, option: string): void {
    const current = this.previewFilterMultiValues[id] ?? [];
    this.previewFilterMultiValues[id] = current.includes(option)
      ? current.filter(v => v !== option)
      : [...current, option];
    const conditional = this.conditionalFilters.find(f => f.id === id);
    if (conditional) conditional.values = [...this.previewFilterMultiValues[id]];
    this.onPreviewFilterChange();
  }

  multiFilterSummary(id: number): string {
    const count = (this.previewFilterMultiValues[id] ?? []).length;
    return count ? `${count} selected` : 'All';
  }

  areAllMultiSelected(filter: { id: number; sourceTable: string; sourceColumn: string; locked?: boolean; lockedValues?: string[]; controlType?: string }): boolean {
    const options = this.getPreviewFilterOptions(filter);
    const selected = this.previewFilterMultiValues[filter.id] ?? [];
    return options.length > 0 && options.every(option => selected.includes(option));
  }

  toggleAllMultiValues(filter: { id: number; sourceTable: string; sourceColumn: string; locked?: boolean; lockedValues?: string[]; controlType?: string }): void {
    const options = this.getPreviewFilterOptions(filter);
    this.previewFilterMultiValues[filter.id] = this.areAllMultiSelected(filter) ? [] : [...options];
    const conditional = this.conditionalFilters.find(f => f.id === filter.id);
    if (conditional) conditional.values = [...this.previewFilterMultiValues[filter.id]];
    this.onPreviewFilterChange();
  }

  getPreviewFilterOptions(filter: { id?: number; sourceTable: string; sourceColumn: string; locked?: boolean; lockedValue?: string; lockedValues?: string[]; controlType?: string }): string[] {
    if (!filter.sourceColumn) return [];
    // Locked filters only ever offer their frozen selection — the builder preview can still
    // open/re-pick it, but can't widen the choice beyond what was locked in (same as the view page).
    if (filter.locked) {
      return filter.controlType === 'MultiSelect' ? [...(filter.lockedValues ?? [])] : (filter.lockedValue ? [filter.lockedValue] : []);
    }
    const isSameTable = filter.sourceTable === this.selectedChartModelId;
    if (!isSameTable && !this.filterRowsCache[filter.sourceTable]) {
      this.loadFilterColumns(filter.sourceTable);
    }
    let rows = isSameTable ? this.tableRows : (this.filterRowsCache[filter.sourceTable] ?? []);
    // Cascade: once another filter narrows the data, every other dropdown should only list
    // values that still occur in that narrowed subset — not the whole unfiltered source.
    if (isSameTable) rows = this.rowsNarrowedByOtherFilters(rows, filter.id);
    // A conditional filter's own typed condition (operator + valueText) also scopes its
    // dropdown, so it only offers the values that condition actually resolves to.
    rows = this.applyOwnConditionalTypedCondition(rows, filter.id);
    return [...new Set(rows.map(row => safeString(row[filter.sourceColumn])).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  /** Narrows `rows` by a conditional filter's own operator + typed valueText (not its checkbox
   *  selections, which is what this method's result is used to populate). */
  private applyOwnConditionalTypedCondition(rows: Record<string, unknown>[], filterId?: number): Record<string, unknown>[] {
    const conditional = this.conditionalFilters.find(f => f.id === filterId);
    const typed = conditional?.valueText?.trim();
    if (!conditional || !typed) return rows;
    const exclude = conditional.mode === 'Exclude';
    return rows.filter(row => matchesConditionalFilter(row[conditional.sourceColumn], conditional.operator || 'equals', [typed]) !== exclude);
  }

  /** Applies every other active local (same-table) interactive/conditional filter to `rows`,
   *  excluding `excludeFilterId`'s own selection, so a filter's dropdown reflects the data
   *  that remains after the currently applied filters rather than the whole source table. */
  private rowsNarrowedByOtherFilters(rows: Record<string, unknown>[], excludeFilterId?: number): Record<string, unknown>[] {
    const isLocal = (sourceTable: string) => sourceTable === this.selectedChartModelId;
    const singleActive = this.interactiveFilters
      .filter(f => f.id !== excludeFilterId && f.controlType !== 'MultiSelect' && isLocal(f.sourceTable))
      .map(f => ({ filter: f, value: this.previewFilterValues[f.id] }))
      .filter((x): x is { filter: InteractiveFilter; value: string } => !!x.value);
    const multiActive = this.interactiveFilters
      .filter(f => f.id !== excludeFilterId && f.controlType === 'MultiSelect' && isLocal(f.sourceTable) && (this.previewFilterMultiValues[f.id]?.length ?? 0) > 0)
      .map(f => ({ filter: f, values: this.previewFilterMultiValues[f.id] }));
    const conditionalActive = this.conditionalFilters
      .filter(f => f.id !== excludeFilterId && f.sourceColumn && this.conditionalFilterValues(f).length > 0);

    let out = rows;
    for (const { filter, value } of singleActive) {
      out = filter.controlType === 'Date'
        ? out.filter(row => safeString(row[filter.sourceColumn]).startsWith(value))
        : out.filter(row => safeString(row[filter.sourceColumn]).toLowerCase().includes(value.toLowerCase()));
    }
    out = this.applyMultiFilters(out, multiActive);
    return this.applyConditionalFilters(out, conditionalActive);
  }

  onPreviewFilterChange(): void {
    this.applyPreviewFilters();
    // Attached view tiles follow the same local filter change as the chart.
    for (const tile of this.attachedTiles) this.loadTilePreview(tile);
  }

  setPreviewFilterValue(filterId: number, value: string): void {
    this.previewFilterValues[filterId] = value;
    this.onPreviewFilterChange();
  }

  /** Applies active interactive filters to the live preview, joining via the API for cross-table filters. */
  private applyPreviewFilters(): void {
    this.sourceError = '';
    const requestVersion = ++this.previewFilterVersion;
    const sourceVersion = this.sourceLoadVersion;
    if (this.previewFilterPending) this.sourceLoading = false;
    this.previewFilterPending = false;
    const chartSource = this.selectedChartModelId;
    // A filter with no matching @placeholder in the view's SQL can never actually apply —
    // exclude it instead of sending it as an active filter.
    const isUsable = (f: InteractiveFilter) => !this.interactiveFilterPlaceholderError(f);
    const singleActive = this.interactiveFilters
      .filter(f => f.controlType !== 'MultiSelect' && isUsable(f))
      .map(f => ({ filter: f, value: this.previewFilterValues[f.id] }))
      .filter((x): x is { filter: InteractiveFilter; value: string } => !!x.value);
    const multiActive = this.interactiveFilters
      .filter(f => f.controlType === 'MultiSelect' && isUsable(f) && (this.previewFilterMultiValues[f.id]?.length ?? 0) > 0)
      .map(f => ({ filter: f, values: this.previewFilterMultiValues[f.id] }));
    const conditionalActive = this.conditionalFilters
      .filter(f => f.sourceColumn && this.conditionalFilterValues(f).length > 0);

    if (!singleActive.length && !multiActive.length && !conditionalActive.length) {
      this.crossTableFilterRows = null;
      this.refreshPreview();
      return;
    }

    const isForeign = (filter: InteractiveFilter) => !!filter.sourceTable && filter.sourceTable !== chartSource;
    const foreignSingles = singleActive.filter(selection => isForeign(selection.filter));
    const foreignMultis = multiActive.filter(selection => isForeign(selection.filter));
    const localSingles = singleActive.filter(selection => !isForeign(selection.filter));
    const localMultis = multiActive.filter(selection => !isForeign(selection.filter));
    const filterLocalRows = (rows: Record<string, unknown>[]) => {
      for (const { filter, value } of localSingles) {
        if (!filter.sourceColumn) continue;
        rows = filter.controlType === 'Date'
          ? rows.filter(row => safeString(row[filter.sourceColumn]).startsWith(value))
          : rows.filter(row => safeString(row[filter.sourceColumn]).toLowerCase().includes(value.toLowerCase()));
      }
      return this.applyConditionalFilters(this.applyMultiFilters(rows, localMultis), conditionalActive);
    };

    if (foreignSingles.length || foreignMultis.length) {
      this.sourceLoading = true;
      this.previewFilterPending = true;
      this.widgetService.getFilteredChartData({
        chartSource,
        chartSourceType: this.dataSourceMode === 'view' ? 'View' : (this.selectedChartModel?.modelType ?? 'Table'),
        viewId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null) : null,
        fromDate: this.fromDate || undefined,
        toDate: this.toDate || undefined,
        mode: this.isTrendChart ? this.trendMode : undefined,
        // Also push the conditional filters into SQL. They still run in the browser, but that
        // pass only sees the first page of rows the endpoint returns; the server-side predicate
        // sees every row. The two are equivalent, so applying both changes nothing but coverage.
        reportFilters: toReportFilters(conditionalActive.map(f => ({
          sourceColumn: f.sourceColumn,
          sourceTable: f.sourceTable,
          operator: f.operator,
          mode: f.mode,
          values: this.conditionalFilterValues(f),
        }))),
        filters: [...foreignSingles.map(x => ({
          sourceTable: x.filter.sourceTable || chartSource,
          sourceColumn: x.filter.sourceColumn,
          controlType: x.filter.controlType,
          value: x.value,
          label: x.filter.label,
        })), ...foreignMultis.map(selection => ({
          sourceTable: selection.filter.sourceTable,
          sourceColumn: selection.filter.sourceColumn,
          controlType: selection.filter.controlType,
          value: selection.values.join(','),
          values: [...selection.values],
          label: selection.filter.label,
        })), ...(this.dataSourceMode === 'view' ? this.globalHierarchyFilterPayload() : [])],
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          if (requestVersion !== this.previewFilterVersion || sourceVersion !== this.sourceLoadVersion || chartSource !== this.selectedChartModelId) return;
          this.sourceLoading = false;
          this.previewFilterPending = false;
          const transformed = applyParameterFilters(res.rows ?? [], this.parameterFilters, res.columns ?? this.rawLoadedColumns);
          this.crossTableFilterRows = filterLocalRows(transformed.rows);
          this.refreshPreview();
          this.cdr.detectChanges();
        },
        error: () => {
          if (requestVersion !== this.previewFilterVersion || sourceVersion !== this.sourceLoadVersion || chartSource !== this.selectedChartModelId) return;
          this.sourceLoading = false;
          this.previewFilterPending = false;
          this.sourceError = 'Unable to apply the selected filters. Check the source relationship, date parameters, and connection.';
          this.crossTableFilterRows = [];
          this.refreshPreview();
          this.cdr.detectChanges();
        },
      });
      return;
    }

    this.crossTableFilterRows = filterLocalRows([...this.tableRows]);
    this.refreshPreview();
  }

  /** Keep only rows whose column value is one of the selected values (include-only). */
  private applyMultiFilters(rows: Record<string, unknown>[], multiActive: { filter: { sourceColumn: string }; values: string[] }[]): Record<string, unknown>[] {
    let out = rows;
    for (const { filter, values } of multiActive) {
      if (!filter.sourceColumn || !values.length) continue;
      const set = new Set(values.map(v => v.toLowerCase()));
      out = out.filter(r => set.has(safeString(r[filter.sourceColumn]).toLowerCase()));
    }
    return out;
  }

  /** Typed text is evaluated against the picked values' subset, so both together narrow the data. */
  private conditionalFilterValues(filter: ConditionalFilter): string[] {
    const typed = filter.valueText?.trim();
    return typed ? [typed, ...(this.previewFilterMultiValues[filter.id] ?? [])] : (this.previewFilterMultiValues[filter.id] ?? []);
  }

  private applyConditionalFilters(rows: Record<string, unknown>[], filters: ConditionalFilter[]): Record<string, unknown>[] {
    return applyConditionalFilters(rows, filters.map(filter => ({
      sourceColumn: filter.sourceColumn,
      operator: filter.operator,
      valueText: filter.valueText,
      mode: filter.mode,
      values: this.previewFilterMultiValues[filter.id] ?? [],
    })));
  }

  // Attached tiles (optional KPI tiles shown above the chart)
  availableTiles: Widget[] = [];
  attachedTileIds: number[] = [];
  showTileDropdown = false;
  tileSearch = '';

  get filteredAvailableTiles(): Widget[] {
    const term = this.tileSearch.trim().toLowerCase();
    const tiles = this.availableTiles.filter(t => !this.attachedTileIds.includes(t.id));
    return term ? tiles.filter(t => t.name.toLowerCase().includes(term)) : tiles;
  }

  get attachedTiles(): Widget[] {
    return this.attachedTileIds.map(id => this.availableTiles.find(t => t.id === id)).filter((t): t is Widget => !!t);
  }

  attachTile(tile: Widget): void {
    if (this.attachedTileIds.length >= 3) return;
    if (!this.attachedTileIds.includes(tile.id)) {
      this.attachedTileIds.push(tile.id);
      this.loadTilePreview(tile);
    }
    this.showTileDropdown = false;
    this.tileSearch = '';
    this.cdr.markForCheck();
  }

  detachTile(id: number): void {
    this.attachedTileIds = this.attachedTileIds.filter(tid => tid !== id);
    this.previewInlineTiles = this.previewInlineTiles.filter(t => t.id !== id);
    this.cdr.markForCheck();
  }

  toggleTileDropdown(): void {
    this.showTileDropdown = !this.showTileDropdown;
    this.cdr.markForCheck();
  }

  // Drill Down (optional view for chart click-through)
  drillDownViewId: number | null = null;
  drillDownViewName = '';
  showDrillDownDropdown = false;
  drillDownSearch = '';
  drillDownViews: DatabaseViewListItem[] = [];

  get filteredDrillDownViews(): DatabaseViewListItem[] {
    const term = this.drillDownSearch.trim().toLowerCase();
    return term ? this.drillDownViews.filter(v => v.viewName.toLowerCase().includes(term)) : this.drillDownViews;
  }

  toggleDrillDownDropdown(): void {
    this.showDrillDownDropdown = !this.showDrillDownDropdown;
    if (this.showDrillDownDropdown && !this.drillDownViews.length) {
      this.commonApi.getDatabaseViews('view').subscribe({ next: (views) => { this.drillDownViews = views; this.cdr.markForCheck(); } });
    }
    this.cdr.markForCheck();
  }

  selectDrillDownView(view: DatabaseViewListItem): void {
    this.pushUndo();
    this.drillDownViewId = view.id;
    this.drillDownViewName = view.viewName;
    this.showDrillDownDropdown = false;
    this.drillDownSearch = '';
    this.cdr.markForCheck();
  }

  removeDrillDownView(): void {
    this.pushUndo();
    this.drillDownViewId = null;
    this.drillDownViewName = '';
    this.cdr.markForCheck();
  }

  // Preview inline tiles in the builder canvas
  previewInlineTiles: { id: number; label: string; value: string; color: string; icon: string; breakdown: { label: string; value: string; color: string }[] }[] = [];

  private loadTilePreview(tile: Widget): void {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(tile.designJson ?? '{}'); } catch { return; }
    const aggregation = (d['aggregation'] as string) ?? 'count';
    const valueField = (d['valueField'] as string) ?? '';
    const source = tile.source;
    const sourceType = tile.sourceType ?? 'Table';
    const color = (d['tileColor'] as string) ?? 'blue';
    const icon = (d['tileIcon'] as string) ?? 'well';
    const label = (d['label'] as string) || tile.name;
    const prefix = (d['prefix'] as string) ?? '';
    const suffix = (d['suffix'] as string) ?? '';
    const places = (d['decimalPlaces'] as number) ?? 0;
    const shorten = (d['shortenBigNumbers'] as boolean) ?? false;
    const breakdown = ((d['breakdownRows'] as { label: string; value: string; color: string }[]) ?? [])
      .filter(r => r && (r.label || r.value))
      .map(r => ({ label: r.label ?? '', value: r.value ?? '', color: r.color ?? 'blue' }));

    const viewId = tile.sourceId ?? (d['viewId'] as number | undefined);
    const isViewTile = sourceType === 'View' && (viewId ?? 0) > 0;
    // Mirror the chart's own local (and global) filters on attached view tiles so they filter with the chart.
    const previewLocal = isViewTile
      ? this.interactiveFilters.filter(f => f.sourceColumn && !f.locked).map(f => ({
          sourceTable: f.sourceTable || source,
          sourceColumn: f.sourceColumn,
          controlType: f.controlType,
          label: f.label || f.sourceColumn,
          value: this.previewFilterValues[f.id] ?? '',
          values: this.previewFilterMultiValues[f.id] ?? [],
        })).filter(f => f.value || f.values.length)
      : [];
    const tileFilters = isViewTile
      ? [...this.lockedInteractiveFilterPayload(), ...previewLocal,
         ...this.globalHierarchyFilterPayload().filter(g => !previewLocal.some(l =>
           l.sourceColumn.toLowerCase() === g.sourceColumn.toLowerCase() || l.label.toLowerCase() === (g.label ?? '').toLowerCase()))]
      : [];
    const data$ = this.widgetService.getFilteredChartData({
      chartSource: source,
      chartSourceType: sourceType,
      viewId: sourceType === 'View' ? (viewId ?? null) : null,
      filters: tileFilters,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined,
    });

    data$.subscribe({
      next: (res) => {
        const rows = res.rows ?? [];
        let val: number;
        if (aggregation === 'count') {
          val = valueField ? rows.filter(r => { const v = r[valueField]; return v !== null && v !== undefined && v !== ''; }).length : rows.length;
        } else if (!valueField) {
          val = rows.length;
        } else if (aggregation === 'countDistinct') {
          val = new Set(rows.map(r => r[valueField]).filter(v => v !== null && v !== undefined && v !== '')).size;
        } else if (aggregation === 'value') {
          val = Number(rows[0]?.[valueField] ?? 0) || 0;
        } else {
          const nums = rows.map(r => Number(r[valueField] ?? 0)).filter(n => !Number.isNaN(n));
          if (aggregation === 'total') val = nums.reduce((a, b) => a + b, 0);
          else if (aggregation === 'average' && nums.length) val = nums.reduce((a, b) => a + b, 0) / nums.length;
          else val = rows.length;
        }
        let formatted: string;
        if (shorten && val >= 1_000_000) formatted = (val / 1_000_000).toFixed(1) + 'M';
        else if (shorten && val >= 1000) formatted = (val / 1000).toFixed(1) + 'K';
        else formatted = val.toFixed(places);

        this.previewInlineTiles = this.previewInlineTiles.filter(t => t.id !== tile.id);
        this.previewInlineTiles.push({ id: tile.id, label, value: prefix + formatted + suffix, color, icon, breakdown });
        this.cdr.detectChanges();
      },
      error: () => {},
    });
  }

  private _chartPreviewOptions: Highcharts.Options | null = null;
  /** Assignments flow through here so the optional "Show Data Labels" preference is applied centrally. */
  get chartPreviewOptions(): Highcharts.Options | null { return this._chartPreviewOptions; }
  set chartPreviewOptions(value: Highcharts.Options | null) {
    this._chartPreviewOptions = applyChartZoom(applyDataLabelPreference(value, this.showDataLabels));
  }
  chartRenderVisible = true;
  previewLegendItems: {
    label: string;
    color: string;
    value?: number;
    target: Highcharts.Point | Highcharts.Series;
  }[] = [];

  get usesCustomPreviewLegend(): boolean {
    return ['bar', 'column', 'pie', 'donut', 'line', 'multiline', 'trend', 'area',
      'spline', 'stacked', 'grouped', 'combo', 'funnel', 'treemap', 'waterfall']
      .includes(this.selectedChartType ?? '');
  }

  onPreviewChartInstance(chart: Highcharts.Chart): void {
    let hasColorUpdates = false;
    for (const series of chart.series) {
      for (const point of series.points) {
        // Pie/donut/funnel points carry a numeric category (their index) and the label in
        // name; looking the rules up by "0"/"1" matched nothing and painted the fallback
        // colour over the rule colour (DFCT0010624).
        const category = String(typeof point.category === 'string' ? point.category : (point.name ?? point.category ?? ''));
        const lineCategoryColor = usesPeriodLineCategoryColorRules(this.selectedChartType, this.xAxis, series.type)
          && !!this.previewCategoryColorFor('', series.name);
        const color = this.usesSemanticSeriesColors
          ? this.previewPointOverride(category, point.y ?? 0, series.name, !lineCategoryColor)
          : lineCategoryColor
            ? this.previewPointOverride(category, point.y ?? 0, series.name, false)
            : this.previewPointColor(category, point.y ?? 0, point.index, series.name);
        if (!color || point.color === color) continue;
        point.update({ color }, false);
        hasColorUpdates = true;
      }
    }
    if (hasColorUpdates) chart.redraw();

    this.previewLegendItems = [];
    if (!this.usesCustomPreviewLegend) return;
    const series = chart.series;
    const isMultiSeries = this.xAxis.trim().toLowerCase() === 'period' || series.length > 1 ||
      (this.isMultiSeriesType && this.multiYColumns.length > 0) ||
      this.selectedChartType === 'combo';
    this.previewLegendItems = isMultiSeries
      ? series.map(seriesItem => ({
          label: seriesItem.name,
          color: String(seriesItem.color),
          target: seriesItem,
        }))
      : (series[0]?.points ?? []).map(point => ({
          label: String(point.name || point.category),
          color: String(point.color || series[0].color),
          value: point.y ?? point.options.value ?? 0,
          target: point,
        }));
    this.cdr.detectChanges();
  }

  highlightPreviewLegend(index: number): void {
    const target = this.previewLegendItems[index]?.target;
    if (!target) {
      this.resetPreviewLegendHighlight();
      return;
    }
    this.previewLegendItems.forEach(item => {
      if (item.target !== target) item.target.setState('inactive');
    });
    // Highcharts shares the hover halo between points, so highlight the target last.
    if ('series' in target) highlightLegendPoint(target);
    else target.setState('hover');
  }

  resetPreviewLegendHighlight(): void {
    this.previewLegendItems.forEach(item => item.target.setState(''));
  }

  togglePreviewLegend(index: number): void {
    const item = this.previewLegendItems[index];
    if (item) item.target.setVisible(item.target.visible === false, true);
  }

  previewData: { categories: string[]; values: number[] } = { categories: [], values: [] };
  previewMultiSeries: { name: string; data: number[] }[] = [];
  readonly CB_ROW_DOT = ['#1E40AF','#F97316','#16A34A','#EAB308','#DC2626','#8B5CF6','#94A3B8','#14B8A6','#EC4899','#6366F1'];
  readonly CB_ROW_BG  = ['#EFF6FF','#FFF7ED','#F0FDF4','#FEFCE8','#FEF2F2','#F5F3FF','#F8FAFC','#F0FDFA','#FDF2F8','#EEF2FF'];
  tableRows: Record<string, unknown>[] = [];
  /** True while a newly-picked source's preview data is loading. */
  sourceLoading = false;

  get previewRows(): Record<string, unknown>[] {
    const rows = this.crossTableFilterRows ?? this.tableRows;
    return rows.filter(row => this.matchesGlobalFilters(row));
  }

  /**
   * The workspace filters (Country/Sector/…, From/To) describe the plant hierarchy of warehouse
   * views. An uploaded or imported file is not that data: its columns are whatever the user
   * put in it, so guessing a date column and hiding rows behind the default "this year" range
   * only produces empty charts. Imported datasets are therefore filtered by date only when a
   * date column has been mapped explicitly (timeline charts), and never by the dimensions.
   */
  private get globalFiltersApply(): boolean {
    return this.dataSourceMode !== 'import';
  }

  private matchesGlobalFilters(row: Record<string, unknown>): boolean {
    if (!this.globalFiltersApply) return !this.timelineDateColumn || this.matchesGlobalDateRange(row);
    return this.matchesGlobalDimensions(row) && this.matchesGlobalDateRange(row);
  }

  /** Country/Sector/Business Unit/Division/Cluster/Plant. A column the source lacks is ignored. */
  private matchesGlobalDimensions(row: Record<string, unknown>): boolean {
    const values: Record<string, string> = {
      country: this.filterValues['country'],
      sector: this.filterValues['sector'],
      businessUnit: this.filterValues['businessUnit'],
      division: this.filterValues['division'],
      cluster: this.filterValues['cluster'],
      plant: this.filterValues['plant'],
    };
    for (const [key, selected] of Object.entries(values)) {
      const actual = this.findRowValue(row, key);
      if (actual == null) continue;
      if (selected && selected !== 'All' && String(actual).toLowerCase() !== selected.toLowerCase()) return false;
    }
    return true;
  }

  /**
   * The From/To window, matched against the row's auto-detected date column. Split out from
   * matchesGlobalFilters so previewEmptyReason can explain an empty preview using the SAME
   * predicate that produced it — a separate copy would eventually disagree with reality.
   */
  private matchesGlobalDateRange(row: Record<string, unknown>): boolean {
    if (!this.fromDate && !this.toDate) return true;
    const dateValue = this.findRowDate(row);
    if (!dateValue) return true;
    if (this.fromDate && dateValue < this.fromDate) return false;
    if (this.toDate && dateValue > this.toDate) return false;
    return true;
  }

  /**
   * Why the preview has no rows even though the source returned some.
   *
   * Without this the builder renders an empty chart and says nothing, so a filter that legitimately
   * excludes every row is indistinguishable from a broken chart. Returns null when there is nothing
   * to explain (no source yet, or rows are present).
   */
  get previewEmptyReason(): string | null {
    const loaded = this.tableRows.length;
    if (loaded === 0) return null;          // "no source data" is a separate, existing state
    if (this.previewRows.length > 0) return null;

    // crossTableFilterRows is the result of the interactive/parameter filters. If they emptied
    // the set, the global filters never saw a row, so report that instead.
    const afterInteractive = this.crossTableFilterRows;
    if (afterInteractive !== null && afterInteractive.length === 0) {
      return `All ${loaded} rows were excluded by the interactive or conditional filters. Clear or widen them to see data.`;
    }

    const rows = afterInteractive ?? this.tableRows;
    const failsDate = rows.filter(r => !this.matchesGlobalDateRange(r)).length;
    if (failsDate === rows.length && (this.fromDate || this.toDate)) {
      const from = this.fromDate || 'the earliest date';
      const to = this.toDate || 'the latest date';
      return `All ${rows.length} rows fall outside the selected date range (${from} to ${to}). ` +
             `Widen the From/To dates above to see them.`;
    }

    const failsDimension = rows.filter(r => !this.matchesGlobalDimensions(r)).length;
    if (failsDimension === rows.length) {
      return `All ${rows.length} rows were excluded by the Country/Sector/Business Unit/Division filters above.`;
    }

    return `All ${rows.length} rows were excluded by the current filters.`;
  }

  private findRowValue(row: Record<string, unknown>, key: string): unknown {
    const aliases: Record<string, string[]> = {
      businessUnit: ['businessunit', 'business unit'],
      plant: ['plant', 'plantdescription', 'plant description'],
    };
    const names = [key, ...(aliases[key] ?? [])];
    const entry = Object.entries(row).find(([name]) => names.includes(name.replace(/[ _-]/g, '').toLowerCase()) || names.includes(name.toLowerCase()));
    return entry?.[1];
  }

  private findRowDate(row: Record<string, unknown>): string {
    const preferredColumns = [this.timelineDateColumn, this.xAxis].filter(Boolean);
    const entries = Object.entries(row).filter(([name, value]) => {
      if (value == null || value === '') return false;
      const normalizedName = name.replace(/[ _-]/g, '').toLowerCase();
      return preferredColumns.some(column => column.toLowerCase() === name.toLowerCase()) ||
        /date|day|time|week/.test(normalizedName);
    });
    for (const [, value] of entries) {
      const parsed = this.parseFilterDate(value);
      if (parsed) return parsed;
    }
    return '';
  }

  private parseFilterDate(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return this.toInputDate(value);
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text || /^[+-]?\d+(?:\.\d+)?$/.test(text)) return '';
    const iso = text.match(/^(\d{4})[-/]([01]\d)[-/]([0-3]\d)/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dayFirst = text.match(/^([0-3]\d)[-/]([01]\d)[-/](\d{4})/);
    if (dayFirst) return `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
    // Monthly trend labels like "Jan-26" / "January 2026" map to the 1st of that month, so the whole
    // month counts as in-range for the From/To filter instead of being mis-parsed by new Date().
    const monthYear = /^([a-z]{3,9})[-/ ](\d{2}|\d{4})$/i.exec(text);
    if (monthYear) {
      const monthIdx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(monthYear[1].slice(0, 3).toLowerCase());
      if (monthIdx >= 0) {
        const year = monthYear[2].length === 2 ? 2000 + Number(monthYear[2]) : Number(monthYear[2]);
        return this.toInputDate(new Date(year, monthIdx, 1));
      }
    }
    // Only free-form date shapes ("15 Jan 2024", "Jan 15, 2024", ISO with time) reach new Date():
    // Chrome would otherwise read an id like "ORD-00100" as the year 100.
    const looksLikeDate = /^\d{4}-\d{2}-\d{2}T/.test(text)
      || /^\d{1,2}\s+[a-z]{3,9},?\s+\d{4}/i.test(text)
      || /^[a-z]{3,9}\s+\d{1,2},?\s+\d{4}/i.test(text);
    if (!looksLikeDate) return '';
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 1900 ? '' : this.toInputDate(parsed);
  }

  /** Row total across the selected numeric columns — the Total column of the table preview. */
  rowTotal(row: Record<string, unknown>): number {
    return this.multiYColumns.reduce((sum, col) => {
      const n = Number(row[col]);
      return sum + (Number.isNaN(n) ? 0 : n);
    }, 0);
  }

  /** Selected table columns excluding the X-axis column, so it isn't rendered twice. */
  get tableExtraColumns(): string[] {
    const transformedColumns = this.yAxisColumns.filter(col => !this.rawLoadedColumns.includes(col));
    const mergedSourceColumns = new Set(this.parameterFilters
      .filter(rule => rule.action === 'merge_columns' && rule.enabled !== false)
      .flatMap(rule => [...getRuleSourceColumns(rule), ...(rule.secondaryColumn ? [rule.secondaryColumn] : [])]));
    return [...new Set([...this.multiYColumns, ...transformedColumns])]
      .filter(col => col !== this.xAxis && !mergedSourceColumns.has(col));
  }

  get daxTableColumns(): string[] {
    return [];
  }

  get daxTotalValue(): number {
    if (!this.daxEnabled || !this.selectedDaxMeasure?.expression.trim()) return 0;
    return evaluateDaxMeasure(this.selectedDaxMeasure, this.previewRows, this.yAxisColumns);
  }

  daxMeasureTotal(measure: DaxMeasureConfig): string {
    return formatDaxValue(evaluateDaxMeasure(measure, this.previewRows, this.yAxisColumns), measure);
  }

  daxTableValue(row: Record<string, unknown>, column: string): unknown {
    return row[column] ?? '—';
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly location: Location,
    private readonly categoryService: CategoryService,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly importedDatasetService: ImportedDatasetService,
    private readonly marketplaceService: MarketplaceService,
    private readonly learnVideoService: LearnVideoService,
    private readonly chartTemplates: ChartTemplatesService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
    private readonly layoutState: LayoutStateService,
    private readonly authService: AuthService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
    private readonly aiPreset: AiChartPresetService,
    private readonly ai: AiService,
    private readonly daxModelService: DaxModelService,
  ) {}

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get wipLabel(): string { return this.isAdmin ? 'WIP Charts' : 'My Charts'; }

  ngOnInit(): void {
    this.loadInstalledVisualTypes();
    this.loadSavedDaxModels();
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();
    this.resetGlobalFilterDateRange();
    this.loadGlobalFilters();
    // Close the fixed-position filter dropdown on any scroll (except inside its own list).
    window.addEventListener('scroll', this.onAnyScroll, true);
    this.layoutState.sidebarCollapsed$.pipe(takeUntil(this.destroy$)).subscribe(collapsed => {
      this.panelCollapsed = !collapsed;
      this.cdr.markForCheck();
    });

    const params = this.route.snapshot.queryParamMap;
    this.returnUrl = params.get('returnUrl') || this.returnUrl;
    const name = params.get('name');
    const description = params.get('description');
    const category = params.get('category');
    const categoryIdParam = params.get('categoryId');
    if (name) this.chartTitle = name;
    if (description) this.chartDescription = description;
    if (category) this.category = category;
    if (categoryIdParam) this.selectedCategoryId = Number(categoryIdParam);

    this.categorySub = this.categoryService.getCategoriesByType('chart').subscribe((cats) => {
      this.apiCategories = cats;
      this.categories = cats.map(c => c.categoryName);
      if (this.selectedCategoryId) {
        const match = cats.find(c => c.categoryId === this.selectedCategoryId);
        if (match) this.category = match.categoryName;
      } else if (!this.category && cats.length > 0) { this.category = cats[0].categoryName; this.selectedCategoryId = cats[0].categoryId; }
    });

    const validIds = new Set<ChartTypeId>(['bar', 'line', 'pie', 'donut', 'funnel', 'multiline', 'area', 'spline', 'column', 'stacked', 'table', 'combo', 'grouped', 'waterfall', 'treemap', 'scatter', 'histogram', 'gauge', 'kpi', 'bullet', 'sankey', 'timeline', 'bubble', 'heatmap']);
    for (const type of Object.keys(ADVANCED_CHART_LABELS) as AdvancedChartType[]) validIds.add(type);
    this.widgetService.getWidgetLibraryCharts().subscribe({
      next: (items) => {
        if (items?.length) {
          const mapped = items
            .map(item => {
              const id = normalizeAdvancedChartType(item.widgetName) as ChartTypeId;
              return { id, label: isAdvancedChart(id) ? ADVANCED_CHART_LABELS[id] : item.widgetName, widgetLibraryId: item.id };
            })
            .filter(t => validIds.has(t.id))
            .sort((a, b) => this.chartTypeOrder.indexOf(a.id) - this.chartTypeOrder.indexOf(b.id));
          // Well Map is not a widget-library entry of its own: it is offered beside Map and saved under Map's library id
          // (the design keeps chartType 'wellmap').
          const mapEntry = mapped.find(t => t.id === 'map');
          if (mapEntry && !mapped.some(t => t.id === 'wellmap')) {
            mapped.splice(mapped.indexOf(mapEntry) + 1, 0, { id: 'wellmap', label: ADVANCED_CHART_LABELS.wellmap, widgetLibraryId: mapEntry.widgetLibraryId });
          }
          if (mapped.length) { this.chartTypes = mapped; this.cdr.markForCheck(); }
        }
      },
      error: () => {},
    });

    // Load chart models (sources) from AlTasnimBI — temporary
    this.widgetService.getBISources().subscribe({
      next: (sources) => {
        if (sources?.length) {
          this.chartModels = sources.map(s => ({ id: s.name, label: s.name, icon: 'derrick' as const, columns: s.columnCount, modelType: s.sourceType as 'Table' | 'View', iconBg: '#FEF3C7' }));
          // Leave the source unselected so the dropdown shows its "Select a table" placeholder.
          this.cdr.markForCheck();
        }
      },
      error: () => {},
    });

    // Load tiles available to attach: the user's own tiles plus every published tile
    // (published tiles are shared, e.g. created by admins), merged and de-duplicated.
    forkJoin({
      own: this.widgetService.getWidgets(undefined, 'tile'),
      published: this.widgetService.getWidgets('published', 'tile'),
    }).subscribe({
      next: ({ own, published }) => {
        const byId = new Map<number, Widget>();
        for (const t of own) byId.set(t.id, t);
        for (const t of published) if (!byId.has(t.id)) byId.set(t.id, t);
        this.availableTiles = [...byId.values()];
        this.cdr.markForCheck();
        if (this.attachedTileIds.length) {
          for (const tId of this.attachedTileIds) {
            const t = this.availableTiles.find(tile => tile.id === tId);
            if (t) this.loadTilePreview(t);
          }
        }
      },
      error: () => {},
    });

    // If viewing saved chart (/view/:id), load it (read-only reference)
    const chartId = this.route.snapshot.paramMap.get('id');
    this.draftStorageKey = this.getDraftStorageKey();
    // An Ask AI hand-off wins over an unsaved draft: the user explicitly asked to open this chart.
    this.ai.features().pipe(takeUntil(this.destroy$)).subscribe(f => { this.canAiEdit = f.enabled.includes('edit'); this.canAiRecommend = f.enabled.includes('recommend'); this.cdr.markForCheck(); });
    const aiPreset = chartId ? null : this.aiPreset.take();
    if (!aiPreset && this.restoreEditorDraft()) {
      this.draftReady = true;
      return;
    }
    if (chartId) {
      this.editId = Number(chartId);
      this.savedChartIds.set(this.activeTabId, this.editId);
      this.isLoadingChart.set(true);
      this.loadSavedChart(this.editId);
    } else {
      this.draftReady = true;
      if (aiPreset) this.applyAiPreset(aiPreset);
    }
  }

  /** Axis mapping handed over by the Ask AI panel; applied once the dataset's columns arrive. */
  private pendingAiPreset: AiChartPreset | null = null;

  // ── Recommend charts ───────────────────────────────────────────────────────
  canAiRecommend = false;
  aiRecommendBusy = false;
  aiRecommendations: AiChartSuggestion[] | null = null;
  aiRecommendError = '';

  /** Profiles the loaded columns (first 1000 rows) and asks for three charts; clicking one applies it like an AI edit. */
  aiRecommend(): void {
    if (this.aiRecommendBusy || !this.rawLoadedColumns.length) return;
    this.aiRecommendBusy = true;
    this.aiRecommendError = '';
    this.aiRecommendations = null;
    const rows = this.rawLoadedRows.slice(0, 1000);
    const columns: AiChartSuggestRequest['columns'] = {};
    for (const col of this.rawLoadedColumns) {
      const distinct = new Set(rows.map(r => String(r[col] ?? '')).filter(v => v !== ''));
      columns[col] = { distinct: distinct.size, samples: [...distinct].slice(0, 5) };
    }
    this.ai.chartSuggest({ sourceName: this.selectedChartModelId || 'Dataset', rowCount: this.rawLoadedRows.length, columns, chartTypes: this.chartTypes.map(t => t.id) })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: s => { this.aiRecommendations = s; this.aiRecommendBusy = false; this.cdr.markForCheck(); },
        error: err => { this.aiRecommendError = err?.error?.message ?? 'Suggestions could not be loaded.'; this.aiRecommendBusy = false; this.cdr.markForCheck(); },
      });
  }

  applyAiRecommendation(s: AiChartSuggestion): void {
    this.applyAiPatch(s.patch);
    this.aiRecommendations = null;
  }

  // ── Edit chart by chat ─────────────────────────────────────────────────────
  canAiEdit = false;
  aiEditOpen = false;
  aiEditText = '';
  aiEditBusy = false;
  aiEditMessage = '';
  aiEditError = '';

  /** Sends the instruction with the current mapping; applies the validated patch to the live builder state. */
  aiEdit(): void {
    const instruction = this.aiEditText.trim();
    if (!instruction || this.aiEditBusy) return;
    this.aiEditBusy = true;
    this.aiEditMessage = this.aiEditError = '';
    const current: AiChartState = {
      chartType: this.selectedChartType, xAxis: this.xAxis, yAxis: this.yAxis, yAggColumn: this.yAggColumn,
      title: this.chartTitle, xAxisTitle: this.xAxisTitle, yAxisTitle: this.yAxisTitle,
      showLegend: this.showLegend, showDataLabels: this.showDataLabels, showAxisTitle: this.showAxisTitle, includeDataTable: this.includeDataTable,
      limitCategory: this.limitCategory, topN: this.topN, bottomN: this.bottomN, groupRestAsOthers: this.groupRestAsOthers,
    };
    this.ai.chartEdit({ instruction, current, columns: this.rawLoadedColumns, chartTypes: this.chartTypes.map(t => t.id) })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.applyAiPatch(r.patch); this.aiEditMessage = r.message; this.aiEditText = ''; this.aiEditBusy = false; this.cdr.markForCheck(); },
        error: err => { this.aiEditError = err?.error?.message ?? 'The edit could not be applied.'; this.aiEditBusy = false; this.cdr.markForCheck(); },
      });
  }

  private applyAiPatch(p: AiChartState): void {
    this.pushUndo();
    if (p.chartType && p.chartType !== this.selectedChartType) {
      this.selectedChartType = p.chartType as ChartTypeId;
      this.selectedLibraryId = (this.chartTypes as { id: ChartTypeId; widgetLibraryId?: number }[]).find(t => t.id === p.chartType)?.widgetLibraryId ?? null;
    }
    if (p.xAxis) this.xAxis = p.xAxis;
    if (p.yAxis) this.yAxis = p.yAxis;
    if (p.yAggColumn) this.yAggColumn = p.yAggColumn;
    if (p.title) this.chartTitle = p.title;
    if (p.xAxisTitle) { this.xAxisTitle = p.xAxisTitle; this.showAxisTitle = true; }
    if (p.yAxisTitle) { this.yAxisTitle = p.yAxisTitle; this.showAxisTitle = true; }
    if (p.showLegend != null) this.showLegend = p.showLegend;
    if (p.showDataLabels != null) this.showDataLabels = p.showDataLabels;
    if (p.showAxisTitle != null) this.showAxisTitle = p.showAxisTitle;
    if (p.includeDataTable != null) this.includeDataTable = p.includeDataTable;
    if (p.limitCategory) this.limitCategory = p.limitCategory as LimitCategory;
    if (p.topN) { this.topN = p.topN; this.limitCategory = 'top'; }
    if (p.bottomN) { this.bottomN = p.bottomN; this.limitCategory = 'bottom'; }
    if (p.groupRestAsOthers != null) this.groupRestAsOthers = p.groupRestAsOthers;
    if (this.selectedChartType === 'table' && !this.multiYColumns.length) this.multiYColumns = [...this.rawLoadedColumns];
    this.refreshPreview();
  }

  /** Opens the dataset an AI answer used; the mapping itself is applied in applyPendingAiPreset. */
  private applyAiPreset(preset: AiChartPreset): void {
    this.chartTitle = preset.title;
    this.pendingAiPreset = preset;
    this.switchDataSourceMode(preset.sourceType);
    if (preset.sourceType === 'view') {
      this.commonApi.getDatabaseViews('view').pipe(takeUntil(this.destroy$)).subscribe(views => {
        const view = views.find(v => v.id === preset.sourceId);
        if (view) this.selectView(view); else this.pendingAiPreset = null;
      });
    } else {
      this.importedDatasetService.list().pipe(takeUntil(this.destroy$)).subscribe(items => {
        const item = items.find(i => i.id === preset.sourceId);
        if (item) this.selectImportDataset(item); else this.pendingAiPreset = null;
      });
    }
  }

  /** Called after a source's columns load: replaces the default table/first-column mapping with the AI one. */
  private applyPendingAiPreset(columns: string[]): boolean {
    const p = this.pendingAiPreset;
    if (!p) return false;
    this.pendingAiPreset = null;
    if (!columns.includes(p.xAxis)) return false;
    this.selectedChartType = p.chartType as ChartTypeId;
    this.selectedLibraryId = (this.chartTypes as { id: ChartTypeId; widgetLibraryId?: number }[]).find(t => t.id === p.chartType)?.widgetLibraryId ?? null;
    this.xAxis = p.xAxis;
    this.yAxis = p.yAxis;
    this.yAggColumn = p.yAggColumn;
    this.multiYColumns = p.chartType === 'table' ? [...columns] : [];
    if (p.topN) { this.limitCategory = 'top'; this.topN = p.topN; }
    return true;
  }

  ngOnDestroy(): void {
    // Draft is persisted only on real browser unload (beforeunload/pagehide), not on in-app
    // navigation — so leaving via Back discards unsaved edits instead of resurfacing them.
    this.sourceLoadVersion++;
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    window.removeEventListener('scroll', this.onAnyScroll, true);
    this.destroy$.next();
    this.destroy$.complete();
    this.categorySub?.unsubscribe();
  }

  private getDraftStorageKey(): string {
    const user = this.authService.getCurrentUser();
    if (!user) return '';
    const route = this.route.snapshot;
    const chart = route.paramMap.get('id');
    const identity = chart ? `edit:${chart}` : `new:${JSON.stringify(
      ['name', 'description', 'categoryId'].map(key => route.queryParamMap.get(key) ?? ''),
    )}`;
    return `tw_chart_builder_draft:${user.tenantId}:${user.userId}:${identity}`;
  }

  private createEditorDraft() {
    this.saveCurrentTabState();
    return {
      version: 1,
      tabs: this.tabs, activeTabId: this.activeTabId, nextTabIndex: this.nextTabIndex,
      tabStates: [...this.tabStates], savedChartIds: [...this.savedChartIds],
      sourceModeStates: [...this.sourceModeStates],
      chartTypeStates: [...this.chartTypeStates],
      importedChartModels: this.importedChartModels,
      availableImportDatasets: this.availableImportDatasets,
      filterValues: this.filterValues, fromDate: this.fromDate, toDate: this.toDate,
      quickRange: this.quickRange, openSections: [...this.openSections],
      nextFilterId: this.nextFilterId,
    };
  }

  @HostListener('window:beforeunload')
  @HostListener('window:pagehide')
  persistEditorDraft(): void {
    if (!this.draftReady || this.discardDraftOnExit || !this.draftStorageKey
      || this.getDraftStorageKey() !== this.draftStorageKey) return;
    try {
      const draft = JSON.stringify(this.createEditorDraft());
      if (draft === this.savedDraftBaseline) {
        this.clearEditorDraft();
        return;
      }
      sessionStorage.setItem(this.draftStorageKey, draft);
    } catch {}
  }

  private clearEditorDraft(): void {
    if (!this.draftStorageKey) return;
    try { sessionStorage.removeItem(this.draftStorageKey); } catch {}
  }

  private restoreEditorDraft(): boolean {
    if (!this.draftStorageKey) return false;
    let draft: ReturnType<ChartBuilderComponent['createEditorDraft']>;
    try {
      const stored = sessionStorage.getItem(this.draftStorageKey);
      if (!stored) return false;
      draft = JSON.parse(stored);
      if (!this.isValidEditorDraft(draft)) {
        this.clearEditorDraft();
        return false;
      }
    } catch { this.clearEditorDraft(); return false; }
    this.tabs = draft.tabs;
    this.activeTabId = draft.activeTabId;
    this.nextTabIndex = draft.nextTabIndex;
    for (const [id, state] of draft.tabStates) this.tabStates.set(id, state);
    for (const [id, savedId] of draft.savedChartIds) this.savedChartIds.set(id, savedId);
    this.sourceModeStates = new Map(draft.sourceModeStates);
    this.chartTypeStates = new Map(draft.chartTypeStates ?? []);
    this.importedChartModels = draft.importedChartModels ?? [];
    this.availableImportDatasets = draft.availableImportDatasets ?? [];
    this.filterValues = draft.filterValues;
    this.fromDate = draft.fromDate; this.toDate = draft.toDate; this.quickRange = draft.quickRange;
    this.openSections = new Set(draft.openSections);
    this.nextFilterId = draft.nextFilterId;
    this.editId = this.savedChartIds.get(this.activeTabId) ?? null;
    this.restoreTabState(this.activeTabId);
    this.cdr.markForCheck();
    return true;
  }

  private isValidEditorDraft(value: unknown): value is ReturnType<ChartBuilderComponent['createEditorDraft']> {
    const isRecord = (item: unknown): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item);
    const isString = (item: unknown): item is string => typeof item === 'string';
    const isNumber = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item);
    const isList = (item: unknown, valid: (entry: unknown) => boolean): item is unknown[] =>
      Array.isArray(item) && item.every(valid);
    const isStringMap = (item: unknown) => isRecord(item) && Object.values(item).every(isString);
    const isFilter = (item: unknown) => isRecord(item) && isNumber(item['id'])
      && isString(item['sourceTable']) && isString(item['sourceColumn'])
      && (item['values'] == null || isList(item['values'], isString))
      && (item['lockedValues'] == null || isList(item['lockedValues'], isString));
    const isState = (item: unknown): boolean => {
      if (!isRecord(item)) return false;
      const strings = ['chartTitle', 'chartDescription', 'selectedChartModelId', 'xAxis', 'yAxis',
        'yAggColumn', 'xAxisTitle', 'yAxisTitle', 'category'];
      const stringLists = ['multiYColumns', 'tableRowColors', 'tableRowTextColors', 'comboLineColumns'];
      return strings.every(key => isString(item[key]))
        && ['table', 'view', 'import'].includes(String(item['dataSourceMode']))
        && (item['selectedChartType'] === null || isString(item['selectedChartType']))
        && (item['selectedLibraryId'] === null || isNumber(item['selectedLibraryId']))
        && stringLists.every(key => isList(item[key], isString))
        && isList(item['attachedTileIds'], isNumber)
        && isList(item['interactiveFilters'], isFilter)
        && isList(item['conditionalFilters'], entry => isFilter(entry) && isRecord(entry)
          && (entry['valueText'] == null || isString(entry['valueText'])))
        && isList(item['parameterFilters'], entry => isRecord(entry)
          && (entry['sourceColumns'] == null || isList(entry['sourceColumns'], isString))
          && (entry['newColumnName'] == null || isString(entry['newColumnName'])))
        && isRecord(item['daxModel']) && isList(item['daxModel']['measures'], isRecord)
        && (item['previewFilterValues'] == null || isStringMap(item['previewFilterValues']))
        && (item['previewFilterMultiValues'] == null || (isRecord(item['previewFilterMultiValues'])
          && Object.values(item['previewFilterMultiValues']).every(entry => isList(entry, isString))));
    };
    const isEntries = (item: unknown, valid: (entry: unknown) => boolean): item is [string, unknown][] =>
      isList(item, entry => Array.isArray(entry) && entry.length === 2 && isString(entry[0]) && valid(entry[1]));
    if (!isRecord(value) || value['version'] !== 1
      || !isList(value['tabs'], tab => isRecord(tab) && isString(tab['id']) && isString(tab['label']))
      || !value['tabs'].length || !isString(value['activeTabId'])
      || !isEntries(value['tabStates'], isState) || !isEntries(value['sourceModeStates'], isState)
      || !isEntries(value['savedChartIds'], isNumber)
      || (value['chartTypeStates'] != null && !isEntries(value['chartTypeStates'], isState))
      || !isNumber(value['nextTabIndex']) || !isNumber(value['nextFilterId'])
      || !isList(value['openSections'], isNumber) || !isStringMap(value['filterValues'])
      || !['fromDate', 'toDate', 'quickRange'].every(key => isString(value[key]))
      || (value['importedChartModels'] != null && !isList(value['importedChartModels'], item =>
        isRecord(item) && isString(item['id']) && isString(item['label'])))
      || (value['availableImportDatasets'] != null && !isList(value['availableImportDatasets'], item =>
        isRecord(item) && isNumber(item['id']) && isString(item['datasetName'])))) return false;
    const tabIds = value['tabs'].map(tab => (tab as Record<string, unknown>)['id']);
    const tabStates = value['tabStates'];
    return new Set(tabIds).size === tabIds.length && tabIds.includes(value['activeTabId'])
      && tabIds.every(id => tabStates.some(([tabId]) => tabId === id));
  }

  /** Close the fixed filter dropdown when the page/panel scrolls, so it can't detach from its field. */
  private readonly onAnyScroll = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    // Like .chart-setup__filter-dd-panel below, this fixed-position panel is measured once
    // (from the trigger's getBoundingClientRect()) when opened, so it has no way to track its
    // anchor if the page/table scrolls under it afterwards — close it instead of letting it
    // drift out of alignment with the "Value" cell it was opened from.
    if (this.categoryRuleMenuId !== null && !target?.closest?.('.chart-setup__category-rule-menu')) {
      this.categoryRuleMenuId = null;
      this.cdr.markForCheck();
    }
    if (!this.openFilterField) return;
    if (this.suppressScrollClose) return;
    if (target?.closest?.('.chart-setup__filter-dd-panel')) return;
    this.openFilterField = null;
    this.cdr.markForCheck();
  };

  // Learn video modal
  private get learnVideoEl(): HTMLVideoElement | undefined {
    return this.learnVideoRef?.nativeElement;
  }

  openLearnModal(): void {
    this.showLearnModal = true;
    this.loadLearnVideo();
  }

  /**
   * The video lives in object storage and its URL in core.LearnVideos, so it can be replaced
   * without a release. Loaded once per screen; the built-in defaults stay if none is configured.
   */
  private learnVideoLoaded = false;
  private loadLearnVideo(): void {
    if (this.learnVideoLoaded) return;
    this.learnVideoService.get(LEARN_SCREEN_KEY).subscribe({
      next: (video) => {
        this.learnVideoLoaded = true;
        this.learnVideoUrl = video.videoUrl;
        if (video.posterUrl) this.learnVideoPoster = video.posterUrl;
        if (video.chapters?.length) this.learnChapters = video.chapters;
        this.cdr.markForCheck();
        this.learnVideoEl?.load();
      },
      error: () => { this.learnVideoLoaded = true; },
    });
  }

  closeLearnModal(): void {
    this.showLearnModal = false;
    this.learnVideoEl?.pause();
  }

  toggleVideoPlay(): void {
    const video = this.learnVideoEl;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }

  onVideoPlay(): void {
    this.isVideoPlaying = true;
  }

  onVideoPause(): void {
    this.isVideoPlaying = false;
  }

  onVideoTimeUpdate(): void {
    const video = this.learnVideoEl;
    if (!video) return;
    this.videoCurrentTime = video.currentTime;
    this.cdr.markForCheck();
  }

  onVideoLoadedMetadata(): void {
    const video = this.learnVideoEl;
    if (!video) return;
    this.videoDuration = video.duration || 0;
    this.cdr.markForCheck();
  }

  seekVideo(event: Event): void {
    const video = this.learnVideoEl;
    if (!video) return;
    video.currentTime = Number((event.target as HTMLInputElement).value);
  }

  seekToChapter(chapter: LearnChapter): void {
    const video = this.learnVideoEl;
    if (!video) return;
    video.currentTime = chapter.time;
    video.play();
  }

  toggleVideoMute(): void {
    const video = this.learnVideoEl;
    if (!video) return;
    video.muted = !video.muted;
    this.videoMuted = video.muted;
  }

  cyclePlaybackRate(): void {
    const video = this.learnVideoEl;
    const rates = [1, 1.5, 2];
    this.playbackRate = rates[(rates.indexOf(this.playbackRate) + 1) % rates.length];
    if (video) video.playbackRate = this.playbackRate;
  }

  requestVideoFullscreen(): void {
    this.learnVideoEl?.requestFullscreen?.();
  }

  formatVideoTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  setHelpfulVote(vote: 'yes' | 'no'): void {
    this.helpfulVote = vote;
  }

  // Help modal
  openHelpModal(): void {
    this.showHelpModal = true;
  }

  closeHelpModal(): void {
    this.showHelpModal = false;
  }

  toggleHelpArticle(article: HelpArticle): void {
    const shouldExpand = !article.expanded;
    this.helpArticles.forEach(a => (a.expanded = a.id === article.id && shouldExpand));
  }

  setHelpVote(vote: 'yes' | 'no'): void {
    this.helpVote = vote;
  }

  get activeTab(): BuilderTab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  /** Visuals installed from the marketplace, shown in the palette beside the built-in types. */
  installedVisualTypes: ChartTypeOption[] = [];

  private loadInstalledVisualTypes(): void {
    this.marketplaceService.getInstalled().subscribe({
      next: (visuals) => {
        this.installedVisualTypes = visuals
          .filter(v => v.renderKind === 'highcharts-template')
          .map(v => ({
            id: 'customvisual' as ChartTypeId,
            label: v.displayName,
            renderer: v.visualKey,
            image: this.chartTypeImages[(v.icon ?? '') as ChartTypeId] ?? this.chartTypeImages['customvisual'],
          }));
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /** Palette click: a marketplace visual is the Custom Visual type with its renderer preset. */
  selectChartTypeOption(type: ChartTypeOption): void {
    this.selectChartType(type.id);
    if (type.renderer) this.updateAdvancedConfig({ ...this.advancedConfig, customRenderer: type.renderer });
  }

  isChartTypeActive(type: ChartTypeOption): boolean {
    if (this.selectedChartType !== type.id) return false;
    const renderer = this.advancedConfig.customRenderer;
    const installed = this.installedVisualTypes.some(t => t.renderer === renderer);
    // The generic "Custom Visual" card owns the built-in renderers; a marketplace card owns its own.
    return type.renderer ? renderer === type.renderer : !installed;
  }

  get filteredChartTypes(): ChartTypeOption[] {
    const term = this.chartTypeSearch.trim().toLowerCase();
    const suggestedIds = this.chartTypeFilterMode === 'suggested' ? this.suggestedChartTypeIds : [];
    const all = [...this.chartTypes, ...this.installedVisualTypes];
    const base = this.chartTypeFilterMode === 'suggested'
      ? all.filter(t => suggestedIds.includes(t.id))
      : all;
    if (!term) return base;
    return base.filter(t => t.label.toLowerCase().includes(term));
  }

  private get suggestedChartTypeIds(): string[] {
    if (!this.selectedChartModelId || this.sourceLoading || this.sourceError) return [];
    const columns = this.xAxisOptions;
    const rows = this.tableRows;
    if (this.chartSuggestionCache?.columns !== columns || this.chartSuggestionCache?.rows !== rows) {
      this.chartSuggestionCache = { columns, rows, ids: getSuggestedChartTypeIds(columns, rows) };
    }
    return this.chartSuggestionCache.ids;
  }

  get chartTypeEmptyMessage(): string {
    if (this.chartTypeFilterMode === 'all') return 'No matching chart types';
    if (!this.selectedChartModelId) return 'No data source selected';
    if (this.sourceLoading) return 'Loading chart suggestions...';
    if (this.sourceError) return 'Chart suggestions unavailable';
    return 'No matching chart types';
  }

  selectChartTypeFilterMode(mode: 'all' | 'suggested'): void {
    this.chartTypeFilterMode = mode;
    this.cdr.markForCheck();
  }

  get canGeneratePreview(): boolean {
    if (this.dataSourceMode === 'import' && !this.selectedChartModelId) return false;
    if (!this.selectedChartType) return false;
    if (this.isAdvancedType) return !!this.selectedChartModelId;
    // Types with their own field set instead of xAxis/yAxis — checked before the xAxis gate below.
    if (this.isGaugeType) return !!this.yAggColumn;
    if (this.isSankeyType) return !!this.sankeyFromColumn && !!this.sankeyToColumn && !!this.sankeyWeightColumn;
    if (this.isTimelineType) return !!this.timelineDateColumn && !!this.timelineLabelColumn;
    if (!this.xAxis) return false;
    // Table renders from xAxis + selected Table Columns, not the Y-axis operation/column.
    if (this.selectedChartType === 'table') return true;
    // Combo/multiline can render from right-Y (line) columns alone, so accept either picker.
    if (this.selectedChartType === 'combo' || this.selectedChartType === 'multiline')
      return this.multiYColumns.length > 0 || this.comboLineColumns.length > 0;
    // Series-managed charts (grouped/stacked/multiline/combo) render from the Y-axis columns picker.
    if (this.isSeriesManagedType) return this.multiYColumns.length > 0;
    if (this.isBubbleType) return (!!this.yAxis || !!this.yAggColumn) && !!this.bubbleSizeColumn;
    if (this.isHeatmapType) return (!!this.yAxis || !!this.yAggColumn) && !!this.heatmapYColumn;
    return !!this.yAxis || !!this.yAggColumn;
  }

  get isChartlessPreview(): boolean {
    return this.selectedChartType === 'kpi' || this.selectedChartType === 'table';
  }

  startEditTitle(): void {
    this.editingTitle = true;
  }

  stopEditTitle(): void {
    this.editingTitle = false;
    if (!this.chartTitle.trim()) this.chartTitle = 'Chart Name';
  }

  toggleCategoryDropdown(): void {
    this.showCategoryDropdown = !this.showCategoryDropdown;
  }

  selectCategory(category: string): void {
    this.pushUndo();
    this.category = category;
    const cat = this.apiCategories.find(c => c.categoryName === category);
    if (cat) this.selectedCategoryId = cat.categoryId;
    this.showCategoryDropdown = false;
  }

  toggleChartModelDropdown(): void {
    this.showChartModelDropdown = !this.showChartModelDropdown;
    if (this.showChartModelDropdown) { this.xAxisOpen = false; this.yAxisOpen = false; }
  }

  selectChartModel(model: ChartModelOption): void {
    this.pushUndo();
    const sourceChanged = this.selectedChartModelId !== model.id;
    this.selectedChartModelId = model.id;
    this.clearMissingSourceError();
    this.chartTypeFilterMode = 'suggested';
    this.chartTypeSearch = '';
    this.showChartModelDropdown = false;
    this.chartModelSearch = '';
    // A different source has different columns, so drop the old column mapping.
    if (sourceChanged) {
      this.advancedConfig = defaultAdvancedConfig();
      this.advancedRows = [];
      this.multiYColumns = [];
      this.comboLineColumns = [];
      this.yAggColumn = '';
      // Clear the previous source's data so the preview doesn't flash stale rows while the new one loads.
      this.rawLoadedColumns = []; this.rawLoadedRows = [];
      this.xAxisOptions = []; this.yAxisColumns = []; this.tableRows = [];
      this.xAxis = ''; this.yAxis = 'Count (F)';
      this.chartPreviewOptions = null;
    }
    // On a new chart, default to the Table chart type once a source is chosen.
    if (!this.editId) {
      this.selectedChartType = 'table';
      this.selectedLibraryId = (this.chartTypes as { id: ChartTypeId; widgetLibraryId?: number }[]).find(t => t.id === 'table')?.widgetLibraryId ?? null;
    }
    this.sourceLoading = true;
    this.loadColumnsForSource({ name: model.id, sourceType: model.modelType });
    this.interactiveFilters = this.interactiveFilters.map(f => ({ ...f, sourceTable: model.id, sourceColumn: '' }));
    this.conditionalFilters = this.conditionalFilters.map(f => ({ ...f, sourceTable: model.id, sourceColumn: '' }));
    this.cdr.markForCheck();
  }

  private sourceModeStates = new Map<string, ChartTabState>();
  private chartTypeStates = new Map<string, ChartTabState>();

  switchDataSourceMode(mode: 'table' | 'view' | 'import'): void {
    if (this.dataSourceMode === mode) return;
    this.sourceLoadVersion++;
    this.sourceLoading = false;
    this.pushUndo();
    this.sourceModeStates.set(`${this.activeTabId}:${this.dataSourceMode}`, this.snapshotState());
    this.dataSourceMode = mode;
    this.showChartModelDropdown = false;
    this.chartModelSearch = '';
    this.viewSearch = '';
    if (mode === 'view' && !this.availableViews.length) {
      this.loadDatabaseViews();
    }
    if (mode === 'import' && !this.availableImportDatasets.length) {
      this.loadImportedDatasets();
    }
    const previous = this.sourceModeStates.get(`${this.activeTabId}:${mode}`);
    if (previous) {
      this.restoreChartState({ ...previous, chartTitle: this.chartTitle,
        chartDescription: this.chartDescription, category: this.category,
        selectedCategoryId: this.selectedCategoryId });
      this.clearMissingSourceError();
      this.cdr.markForCheck();
      return;
    }
    // Reset selection
    this.selectedChartModelId = '';
    this.rawLoadedColumns = []; this.rawLoadedRows = [];
    this.xAxisOptions = []; this.yAxisColumns = []; this.tableRows = [];
    this.xAxis = ''; this.yAxis = 'Count (F)'; this.yAggColumn = '';
    this.multiYColumns = []; this.comboLineColumns = [];
    this.chartPreviewOptions = null;
    this.cdr.markForCheck();
  }

  private loadDatabaseViews(): void {
    this.commonApi.getDatabaseViews('view').subscribe({
      next: (views) => {
        this.availableViews = views;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  private loadImportedDatasets(): void {
    this.importedDatasetService.list().subscribe({
      next: (datasets) => {
        this.availableImportDatasets = datasets;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  private toImportChartModel(item: { id: number; datasetName: string; rowCount?: number; columns?: { name: string }[] }): ChartModelOption {
    return {
      id: String(item.id),
      label: item.datasetName,
      icon: 'derrick',
      columns: item.columns?.length ?? 0,
      modelType: 'Import',
      iconBg: 'linear-gradient(135deg,#34D399,#059669)',
    };
  }

  /** Picks a previously uploaded dataset as the chart's data source (no re-upload needed). */
  selectImportDataset(item: ImportedDatasetListItem): void {
    const model = this.toImportChartModel(item);
    this.importedChartModels = [...this.importedChartModels.filter(m => m.id !== model.id), model];
    this.selectChartModel(model);
  }

  /** Clears the current import selection so the dropzone is shown again. */
  clearImportSelection(): void {
    this.sourceLoadVersion++;
    this.sourceLoading = false;
    this.selectedChartModelId = '';
    this.rawLoadedColumns = []; this.rawLoadedRows = [];
    this.xAxisOptions = []; this.yAxisColumns = []; this.tableRows = [];
    this.chartPreviewOptions = null;
    this.cdr.markForCheck();
  }

  pendingImportDelete: ImportedDatasetListItem | null = null;
  importDeleteBusy = false;
  importDeleteError: string | null = null;

  deleteImportDataset(item: ImportedDatasetListItem, event: Event): void {
    event.stopPropagation();
    if (this.importDeleteBusy) return;
    this.pendingImportDelete = item;
    this.importDeleteError = null;
  }

  cancelDeleteImportDataset(): void {
    if (this.importDeleteBusy) return;
    this.pendingImportDelete = null;
    this.importDeleteError = null;
  }

  confirmDeleteImportDataset(): void {
    const item = this.pendingImportDelete;
    if (!item || this.importDeleteBusy) return;
    this.importDeleteBusy = true;
    this.importDeleteError = null;
    this.importedDatasetService.delete(item.id).subscribe({
      next: () => {
        this.availableImportDatasets = this.availableImportDatasets.filter(d => d.id !== item.id);
        this.importedChartModels = this.importedChartModels.filter(m => m.id !== String(item.id));
        if (this.selectedChartModelId === String(item.id)) this.clearImportSelection();
        this.importDeleteBusy = false;
        this.pendingImportDelete = null;
        this.showSaveSuccess(`Imported dataset "${item.datasetName}" deleted successfully.`);
        this.cdr.markForCheck();
      },
      error: () => {
        this.importDeleteBusy = false;
        this.importDeleteError = 'Could not delete the imported dataset. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  onImportDragOver(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = true;
  }

  onImportDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = false;
  }

  onImportDrop(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadImportFile(file);
  }

  onImportFileInputChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.uploadImportFile(file);
    (event.target as HTMLInputElement).value = '';
  }

  toggleImportPasteMode(): void {
    this.importPasteMode = !this.importPasteMode;
    this.importPasteText = '';
    this.importUploadError = null;
  }

  submitPastedJson(): void {
    if (!this.importPasteText.trim()) return;
    try {
      JSON.parse(this.importPasteText);
    } catch {
      this.importUploadError = 'That is not valid JSON.';
      return;
    }
    const file = new File([this.importPasteText], 'pasted-data.json', { type: 'application/json' });
    this.importPasteMode = false;
    this.uploadImportFile(file);
  }

  get importAcceptAttr(): string {
    return this.importAllowedExtensions.join(',');
  }

  private readonly importAllowedExtensions = ['.csv', '.xlsx', '.xls', '.json'];
  private readonly importMaxFileSizeBytes = 8 * 1024 * 1024; // 8 MB, mirrors the backend limit

  uploadImportFile(file: File): void {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!this.importAllowedExtensions.includes(ext)) {
      this.importUploadError = `Unsupported file type '${ext}'. Allowed: csv, xlsx, xls, json.`;
      return;
    }
    if (file.size > this.importMaxFileSizeBytes) {
      this.importUploadError = `File exceeds the ${this.importMaxFileSizeBytes / (1024 * 1024)}MB limit.`;
      return;
    }
    this.importUploadError = null;
    this.importUploading = true;
    this.importedDatasetService.upload(file).subscribe({
      next: (dto) => {
        this.importUploading = false;
        const model = this.toImportChartModel(dto);
        this.importedChartModels = [...this.importedChartModels.filter(m => m.id !== model.id), model];
        this.availableImportDatasets = [
          { id: dto.id, datasetName: dto.datasetName, fileName: dto.fileName, fileType: dto.fileType, rowCount: dto.rowCount, status: dto.status, createdAt: new Date().toISOString() },
          ...this.availableImportDatasets.filter(d => d.id !== dto.id),
        ];
        this.selectChartModel(model);
      },
      error: (err) => {
        this.importUploading = false;
        this.importUploadError = err?.error?.error ?? 'Failed to import file.';
        this.cdr.markForCheck();
      },
    });
  }

  selectView(view: DatabaseViewListItem): void {
    this.pushUndo();
    const requestVersion = ++this.sourceLoadVersion;
    this.sourceError = '';
    const sourceChanged = this.selectedChartModelId !== view.viewName;
    this.selectedChartModelId = view.viewName;
    this.clearMissingSourceError();
    this.chartTypeFilterMode = 'suggested';
    this.chartTypeSearch = '';
    this.showChartModelDropdown = false;
    this.viewSearch = '';
    // A different view has different columns, so drop the old column mapping.
    if (sourceChanged) {
      this.multiYColumns = [];
      this.comboLineColumns = [];
      this.yAggColumn = '';
      // Clear the previous view's data so the preview doesn't flash stale rows while the new view loads.
      this.rawLoadedColumns = []; this.rawLoadedRows = [];
      this.xAxisOptions = []; this.yAxisColumns = []; this.tableRows = [];
      this.xAxis = ''; this.yAxis = 'Count (F)';
      this.chartPreviewOptions = null;
    }
    // On a new chart, default to the Table chart type once a source is chosen.
    if (!this.editId) {
      this.selectedChartType = 'table';
      this.selectedLibraryId = (this.chartTypes as { id: ChartTypeId; widgetLibraryId?: number }[]).find(t => t.id === 'table')?.widgetLibraryId ?? null;
    }
    this.sourceLoading = true;
    this.loadViewDateParameters(view.id, () => this.widgetService.getFilteredChartData({
      chartSource: view.viewName,
      chartSourceType: 'View',
      viewId: view.id,
      filters: [...this.lockedInteractiveFilterPayload(), ...this.globalHierarchyFilterPayload()],
      ...this.viewDatePayload(view.id),
      mode: this.isTrendChart ? this.trendMode : undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (requestVersion !== this.sourceLoadVersion || this.dataSourceMode !== 'view' || this.selectedChartModelId !== view.viewName) return;
        this.sourceLoading = false;
        this.rawLoadedColumns = res?.columns ?? [];
        this.rawLoadedRows = res?.rows ?? [];
        this.applyParameterDrivenTransformations();
        if (res?.columns?.length) {
          if (!this.applyPendingAiPreset(res.columns)) {
            this.xAxis = res.columns[0] ?? '';
            this.yAxis = 'Count (F)';
            // Table shows every column — pre-select them once the view data arrives.
            if (this.selectedChartType === 'table' && !this.multiYColumns.length) this.multiYColumns = [...res.columns];
          }
          if (this.selectedChartType) this.refreshPreview(); else this.chartPreviewOptions = null;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestVersion !== this.sourceLoadVersion) return;
        this.sourceLoading = false;
        this.sourceError = 'Unable to load the selected source. Check the source, filters, and connection.';
        this.cdr.markForCheck();
      },
    }));
    this.interactiveFilters = this.interactiveFilters.map(f => ({ ...f, sourceTable: view.viewName, sourceColumn: '' }));
    this.conditionalFilters = this.conditionalFilters.map(f => ({ ...f, sourceTable: view.viewName, sourceColumn: '' }));
    this.cdr.markForCheck();
  }

  /** Closes every Data Mapping dropdown (X-axis, Y-axis, Operation, Multi-Y, Combo Line) so only one can be open at a time. */
  private closeDataMappingDropdowns(): void {
    this.xAxisOpen = false;
    this.yAxisOpen = false;
    this.showYAggDropdown = false;
    this.showMultiYDropdown = false;
    this.showComboLineDropdown = false;
    this.mappingDropdownOpen = null;
  }

  toggleXAxisDropdown(): void {
    const next = !this.xAxisOpen;
    this.closeDataMappingDropdowns();
    this.showChartModelDropdown = false;
    this.xAxisOpen = next;
    this.xAxisSearch = '';
  }

  selectXAxis(option: string): void {
    this.pushUndo();
    this.xAxis = option;
    this.xAxisOpen = false;
    this.xAxisSearch = '';
    this.refreshPreview();
  }

  toggleYAxisDropdown(): void {
    if (this.isSeriesManagedType) return; // Y-axis fixed to "Value" for series-managed charts.
    const next = !this.yAxisOpen;
    this.closeDataMappingDropdowns();
    this.showChartModelDropdown = false;
    this.yAxisOpen = next;
    this.yAxisSearch = '';
  }

  toggleYAggDropdown(): void {
    const next = !this.showYAggDropdown;
    this.closeDataMappingDropdowns();
    this.showYAggDropdown = next;
  }

  /** Single-column mapping fields (bullet/bubble/heatmap/sankey/timeline) — see `mappingDropdownOpen`. */
  toggleMappingDropdown(key: string): void {
    const next = this.mappingDropdownOpen === key ? null : key;
    this.closeDataMappingDropdowns();
    this.mappingDropdownOpen = next;
  }

  mappingColumnValue(key: string): string {
    switch (key) {
      case 'bulletTarget': return this.bulletTargetColumn;
      case 'bubbleSize': return this.bubbleSizeColumn;
      case 'heatmapY': return this.heatmapYColumn;
      case 'sankeyFrom': return this.sankeyFromColumn;
      case 'sankeyTo': return this.sankeyToColumn;
      case 'sankeyWeight': return this.sankeyWeightColumn;
      case 'timelineDate': return this.timelineDateColumn;
      case 'timelineLabel': return this.timelineLabelColumn;
      default: return '';
    }
  }

  selectMappingColumn(key: string, value: string): void {
    switch (key) {
      case 'bulletTarget': this.bulletTargetColumn = value; break;
      case 'bubbleSize': this.bubbleSizeColumn = value; break;
      case 'heatmapY': this.heatmapYColumn = value; break;
      case 'sankeyFrom': this.sankeyFromColumn = value; break;
      case 'sankeyTo': this.sankeyToColumn = value; break;
      case 'sankeyWeight': this.sankeyWeightColumn = value; break;
      case 'timelineDate': this.timelineDateColumn = value; break;
      case 'timelineLabel': this.timelineLabelColumn = value; break;
    }
    this.mappingDropdownOpen = null;
    this.refreshPreview();
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.xAxisOpen = false;
    this.yAxisOpen = false;
    this.showYAggDropdown = false;
    this.mappingDropdownOpen = null;
    this.showChartModelDropdown = false;
    this.showCategoryDropdown = false;
    this.showDrillDownDropdown = false;
    this.showDaxColumnDropdown = false;
    if (this.showDaxOperationDropdown) this.daxOperationSearch = '';
    this.showDaxOperationDropdown = false;
    this.showDaxNumeratorDropdown = false;
    this.showDaxDenominatorDropdown = false;
    this.showMultiYDropdown = false;
    this.showComboLineDropdown = false;
    this.showTileDropdown = false;
    this.openMultiFilterId = null;
    this.openParamColDropdownId = null;
    this.openFilterField = null;
    this.openGlobalFilterName = null;
    this.categoryRuleMenuId = null;
  }

  toggleDaxColumnDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxColumnDropdown = !this.showDaxColumnDropdown;
  }

  toggleDaxOperationDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxOperationDropdown = !this.showDaxOperationDropdown;
    if (!this.showDaxOperationDropdown) this.daxOperationSearch = '';
  }

  selectDaxOperation(fn: string): void {
    this.insertDaxSnippet(fn);
    this.showDaxOperationDropdown = false;
    this.daxOperationSearch = '';
  }

  daxOperationLabel(fn: string): string {
    if (fn === 'STDEV([Column])') return 'STANDARD DEVIATION';
    if (fn === 'VARIANCE([Column])') return 'VARIANCE';
    return fn;
  }

  get filteredDaxFunctionSnippets(): string[] {
    const query = this.daxOperationSearch.trim().toLowerCase();
    if (!query) return this.daxFunctionSnippets;
    return this.daxFunctionSnippets.filter(fn => this.daxOperationLabel(fn).toLowerCase().includes(query));
  }

  toggleDaxNumeratorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxNumeratorDropdown = !this.showDaxNumeratorDropdown;
  }

  toggleDaxDenominatorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxDenominatorDropdown = !this.showDaxDenominatorDropdown;
  }

  selectChartType(type: ChartTypeId): void {
    this.pushUndo();
    const prev = this.selectedChartType;

    // The Data Mapping the user has already chosen follows them to whatever chart type they
    // click next. Captured before the branches below, because several of them reset these
    // fields (leaving Table blanks the axes; selecting a previously-configured type restores
    // that type's own mapping). Re-applied afterwards so the user's most recent choice wins.
    const carried = {
      xAxis: this.xAxis,
      yAxis: this.yAxis,
      yAggColumn: this.yAggColumn,
      xAxisTitle: this.xAxisTitle,
      yAxisTitle: this.yAxisTitle,
    };
    const sourceKey = `${this.activeTabId}:${this.dataSourceMode}:${this.selectedChartModelId}:`;
    if (prev) this.chartTypeStates.set(`${sourceKey}${prev}`, this.snapshotState());
    this.selectedChartType = this.selectedChartType === type ? null : type;
    const found = (this.chartTypes as any[]).find((t: any) => t.id === type);
    this.selectedLibraryId = found?.widgetLibraryId ?? null;
    const previousType = this.selectedChartType ? this.chartTypeStates.get(`${sourceKey}${type}`) : undefined;
    if (previousType) {
      this.advancedConfig = readAdvancedConfig(previousType.advancedConfig);
      this.xAxis = previousType.xAxis;
      this.yAxis = previousType.yAxis;
      this.yAggColumn = previousType.yAggColumn;
      this.xAxisTitle = previousType.xAxisTitle;
      this.yAxisTitle = previousType.yAxisTitle;
      this.multiYColumns = [...previousType.multiYColumns];
      this.comboLineColumns = [...previousType.comboLineColumns];
      this.yAxis2Title = previousType.yAxis2Title;
    } else if (this.selectedChartType === 'table') {
      // Table shows every column, so pre-select them all as series.
      if (this.yAxisColumns.length) this.multiYColumns = [...this.yAxisColumns];
      if (!this.xAxis) this.xAxis = this.yAxisColumns[0] ?? '';
    } else if (prev === 'table') {
      // Leaving table: don't carry its all-columns selection into other chart types.
      this.multiYColumns = [];
      // Aggregating charts start with blank axes so the user chooses them explicitly.
      this.xAxis = '';
      this.yAxis = '';
    } else if (this.isMultiSeriesType && !this.multiYColumns.length && this.yAggColumn) {
      // Switching into a multi-series type: carry the already-picked Y column forward so the
      // preview isn't blank and the user isn't forced to re-map the same column again.
      this.multiYColumns = [this.yAggColumn];
    } else if (!this.isMultiSeriesType && !this.yAggColumn && this.multiYColumns.length) {
      // Switching back to a single-series type: carry the first series column into the Y-axis slot.
      this.yAggColumn = this.multiYColumns[0];
    }
    // Carry the mapping forward. Guarded against the current source: a column that no longer
    // exists here is dropped rather than applied, leaving applyDefaultMapping to fill the gap.
    // Type-specific slots (series lists, sankey/bubble/heatmap columns) stay per-type and are
    // deliberately not carried, since they mean different things for different chart types.
    if (this.selectedChartType && !isAdvancedChart(this.selectedChartType)) {
      if (carried.xAxis && this.xAxisOptions.includes(carried.xAxis)) this.xAxis = carried.xAxis;
      if (carried.yAggColumn && this.yAxisColumns.includes(carried.yAggColumn)) this.yAggColumn = carried.yAggColumn;
      if (carried.yAxis) this.yAxis = carried.yAxis;
      if (carried.xAxisTitle) this.xAxisTitle = carried.xAxisTitle;
      if (carried.yAxisTitle) this.yAxisTitle = carried.yAxisTitle;
    }

    this.removeDeselectedColumnMappings();
    // In single-series mode the "Operation" field must hold an aggregation function — never a stale
    // column name carried over from a prior series-managed config (which hides the Operation row).
    if (this.selectedChartType && !this.isSeriesManagedType && this.yAxis
        && !this.yAxisFunctions.some(f => f.value === this.yAxis)) {
      this.yAxis = this.yAggColumn ? 'Sum (F)' : 'Count (F)';
    }
    // Fresh chart type (no saved state for it): seed sensible defaults so a preview shows right away.
    if (this.selectedChartType && !previousType && this.selectedChartType !== 'table') {
      this.applyDefaultMapping();
    }
    if (this.isTrendChart) this.loadTrendModePreview();
    this.refreshPreview();
  }

  private removeDeselectedColumnMappings(): void {
    if (!this.selectedChartType || this.selectedChartType === 'table') return;
    const allowed = new Set(this.availableMappingColumns);
    const retain = (column: string): string => !column || allowed.has(column) ? column : '';
    this.xAxis = retain(this.xAxis);
    this.yAggColumn = retain(this.yAggColumn);
    this.bulletTargetColumn = retain(this.bulletTargetColumn);
    this.bubbleSizeColumn = retain(this.bubbleSizeColumn);
    this.heatmapYColumn = retain(this.heatmapYColumn);
    this.sankeyFromColumn = retain(this.sankeyFromColumn);
    this.sankeyToColumn = retain(this.sankeyToColumn);
    this.sankeyWeightColumn = retain(this.sankeyWeightColumn);
    this.timelineDateColumn = retain(this.timelineDateColumn);
    this.timelineLabelColumn = retain(this.timelineLabelColumn);
    this.multiYColumns = this.multiYColumns.filter(column => allowed.has(column));
    this.comboLineColumns = this.comboLineColumns.filter(column => allowed.has(column));
    this.selectedDaxColumns = this.selectedDaxColumns.filter(column => allowed.has(column));
  }

  addPage(): void {
    this.showAddPageConfirm = true;
  }

  cancelAddPage(): void {
    this.showAddPageConfirm = false;
  }

  confirmAddPageDiscard(): void {
    this.showAddPageConfirm = false;
    this.openNewChartTab();
  }

  confirmAddPageSave(): void {
    if (this.isSaving()) return;
    this.showAddPageConfirm = false;
    const chartName = this.chartTitle.trim();
    if (!chartName || chartName === 'Chart Name') { this.saveError.set('Please enter a chart name.'); return; }
    if (!this.selectedLibraryId) { this.saveError.set('Please select a chart type first.'); return; }
    if (!this.chartDescription.trim()) { this.descriptionValidationError.set('Please enter a description.'); return; }
    this.descriptionValidationError.set('');
    const selectionError = getParameterSelectionError(this.parameterFilters);
    if (selectionError) {
      this.openSections.add(4);
      this.saveError.set(selectionError);
      return;
    }
    const categoryId = this.resolvedCategoryId;
    if (categoryId === null) { this.saveError.set(CATEGORY_REQUIRED_MESSAGE); return; }

    this.isSaving.set(true); this.saveError.set('');
    const payload = {
      name: this.chartTitle, description: this.chartDescription, type: 'chart',
      libraryId: this.selectedLibraryId,
      source: this.selectedChartModelId,
      sourceType: this.dataSourceMode === 'view' ? 'View' : (this.selectedChartModel?.modelType ?? 'Table'),
      sourceId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null)
              : this.dataSourceMode === 'import' ? (this.selectedImportDataset?.id ?? null)
              : null,
      designJson: this.buildDesignJson(),
      categoryId,
    };
    const tabId = this.activeTabId;
    const existingId = this.savedChartIds.get(tabId);
    const request$ = existingId
      ? this.widgetService.updateWidget(existingId, payload)
      : this.widgetService.createWidget(payload);
    request$.subscribe({
      next: (saved) => {
        this.savedChartIds.set(tabId, saved.id);
        if (this.activeTabId === tabId) this.editId = saved.id;
        this.isSaving.set(false);
        const currentTab = this.tabs.find(t => t.id === this.activeTabId);
        if (currentTab) currentTab.label = this.chartTitle;
        this.openNewChartTab();
      },
      error: (err: unknown) => {
        this.isSaving.set(false);
        const msg = (err as any)?.error?.error ?? (err as any)?.message ?? 'Failed to save chart. Please try again.';
        this.saveError.set(msg);
        this.cdr.markForCheck();
      },
    });
  }

  private openNewChartTab(): void {
    this.saveCurrentTabState();
    const id = `chart-${this.nextTabIndex}`;
    this.tabs.push({ id, label: `Chart ${this.nextTabIndex}` });
    this.nextTabIndex += 1;
    this.activeTabId = id;
    this.editId = null;
    this.resetChartState();
    this.cdr.markForCheck();
  }

  setActiveTab(id: string): void {
    if (id === this.activeTabId) return;
    this.saveCurrentTabState();
    this.activeTabId = id;
    this.editId = this.savedChartIds.get(id) ?? null;
    this.restoreTabState(id);
    this.cdr.markForCheck();
  }

  closeTab(tab: BuilderTab): void {
    if (this.tabs.length <= 1) return;
    for (const key of this.sourceModeStates.keys()) {
      if (key.startsWith(`${tab.id}:`)) this.sourceModeStates.delete(key);
    }
    for (const key of this.chartTypeStates.keys()) {
      if (key.startsWith(`${tab.id}:`)) this.chartTypeStates.delete(key);
    }
    this.tabStates.delete(tab.id);
    this.savedChartIds.delete(tab.id);
    const index = this.tabs.findIndex(t => t.id === tab.id);
    this.tabs = this.tabs.filter(t => t.id !== tab.id);
    if (this.activeTabId === tab.id) {
      const next = this.tabs[Math.max(0, index - 1)];
      this.activeTabId = next.id;
      this.editId = this.savedChartIds.get(next.id) ?? null;
      this.restoreTabState(next.id);
    }
    this.cdr.markForCheck();
  }

  private saveCurrentTabState(): void {
    this.tabStates.set(this.activeTabId, {
      chartTitle: this.chartTitle,      chartDescription: this.chartDescription,
      selectedChartType: this.selectedChartType,
      selectedLibraryId: this.selectedLibraryId,
      selectedChartModelId: this.selectedChartModelId,
      dataSourceMode: this.dataSourceMode,
      xAxis: this.xAxis,
      yAxis: this.yAxis,
      yAggColumn: this.yAggColumn,
      xAxisTitle: this.xAxisTitle,
      yAxisTitle: this.yAxisTitle,
      showLegend: this.showLegend,
      includeDataTable: this.includeDataTable,
      showAxisTitle: this.showAxisTitle,
      showDataLabels: this.showDataLabels,
      showStackTotal: this.showStackTotal,
      limitCategory: this.limitCategory,
      topN: this.topN,
      bottomN: this.bottomN,
      groupRestAsOthers: this.groupRestAsOthers,
      multiYColumns: [...this.multiYColumns],
      interactiveFilters: this.interactiveFilters.map(f => ({ ...f })),
      conditionalFilters: this.conditionalFilters.map(f => ({ ...f })),
      parameterFilters: this.parameterFilters.map(r => ({ ...r, sourceColumns: getRuleSourceColumns(r) })),
      attachedTileIds: [...this.attachedTileIds],
      selectedCategoryId: this.selectedCategoryId,
      category: this.category,
      viewId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null)
            : this.dataSourceMode === 'import' ? (this.selectedImportDataset?.id ?? null)
            : null,
      tableRowColors: [...this.tableRowColors],
      tableHeaderColor: this.tableHeaderColor,
      tableHeaderTextColor: this.tableHeaderTextColor,
      tableRowTextColors: [...this.tableRowTextColors],
      comboLineColumns: [...this.comboLineColumns],
      yAxis2Title: this.yAxis2Title,
      drillDownViewId: this.drillDownViewId,
      trendMode: this.trendMode,
      daxModel: this.cloneDaxModel(this.daxModel),
      gaugeMin: this.gaugeMin,
      gaugeMax: this.gaugeMax,
      bulletTargetColumn: this.bulletTargetColumn,
      bubbleSizeColumn: this.bubbleSizeColumn,
      heatmapYColumn: this.heatmapYColumn,
      sankeyFromColumn: this.sankeyFromColumn,
      sankeyToColumn: this.sankeyToColumn,
      sankeyWeightColumn: this.sankeyWeightColumn,
      timelineDateColumn: this.timelineDateColumn,
      timelineLabelColumn: this.timelineLabelColumn,
      colorRules: this.colorRules.map(rule => ({ ...rule })),
      colorOverrides: { ...this.colorOverrides },
      advancedConfig: structuredClone(this.advancedConfig),
      previewFilterValues: { ...this.previewFilterValues },
      previewFilterMultiValues: structuredClone(this.previewFilterMultiValues),
    });
  }

  private restoreTabState(tabId: string): void {
    const s = this.tabStates.get(tabId);
    if (!s) { this.resetChartState(); return; }
    this.restoreChartState(s);
  }

  private restoreChartState(s: ChartTabState): void {
    this.sourceLoadVersion++;
    this.sourceLoading = false;
    this.chartTitle = s.chartTitle;
    this.chartDescription = s.chartDescription;
    this.selectedChartType = s.selectedChartType;
    this.selectedLibraryId = s.selectedLibraryId;
    this.selectedChartModelId = s.selectedChartModelId;
    this.dataSourceMode = s.dataSourceMode;
    this.xAxis = s.xAxis;
    this.yAxis = s.yAxis;
    this.yAggColumn = s.yAggColumn;
    this.xAxisTitle = s.xAxisTitle;
    this.yAxisTitle = s.yAxisTitle;
    this.showLegend = s.showLegend;
    this.includeDataTable = s.includeDataTable;
    this.showAxisTitle = s.showAxisTitle;
    this.axisTitleAutoApplied = false;
    this.showDataLabels = s.showDataLabels ?? true;
    this.showStackTotal = s.showStackTotal ?? true;
    this.limitCategory = s.limitCategory;
    this.topN = s.topN;
    this.bottomN = s.bottomN;
    this.groupRestAsOthers = s.groupRestAsOthers;
    this.multiYColumns = [...s.multiYColumns];
    this.interactiveFilters = s.interactiveFilters.map(f => ({ ...f }));
    this.conditionalFilters = (s.conditionalFilters ?? []).map(f => ({
      ...f,
      hidden: f.hidden ?? true,
      values: [...(f.values ?? [])],
    }));
    this.syncConditionalFilterSelections();
    this.parameterFilters = (s.parameterFilters ?? []).map(r => ({
      ...r,
      separator: r.separator?.trim() ? r.separator : '',
      sourceColumns: getRuleSourceColumns(r),
    }));
    this.appliedRenameMap = {};
    for (const rule of this.parameterFilters) {
      if (rule.action === 'rename_column' && rule.sourceColumn && rule.newColumnName?.trim() && rule.newColumnName.trim() !== rule.sourceColumn) {
        this.appliedRenameMap[rule.id] = {
          sourceColumn: rule.sourceColumn,
          appliedName: rule.newColumnName.trim(),
        };
      }
    }
    this.syncParameterFilterIds();
    this.previewFilterValues = { ...s.previewFilterValues };
    this.previewFilterMultiValues = structuredClone(s.previewFilterMultiValues ?? {});
    this.syncConditionalFilterSelections();
    this.crossTableFilterRows = null;
    this.syncInteractiveFilterSelections();
    this.attachedTileIds = [...s.attachedTileIds];
    this.selectedCategoryId = s.selectedCategoryId;
    this.category = s.category;
    this.tableRowColors = s.tableRowColors ? [...s.tableRowColors] : [];
    this.tableHeaderColor = s.tableHeaderColor ?? '';
    this.tableHeaderTextColor = s.tableHeaderTextColor ?? '';
    this.tableRowTextColors = s.tableRowTextColors ? [...s.tableRowTextColors] : [];
    this.comboLineColumns = s.comboLineColumns ? [...s.comboLineColumns] : [];
    this.yAxis2Title = s.yAxis2Title ?? '';
    this.drillDownViewId = s.drillDownViewId ?? null;
    this.trendMode = s.trendMode ?? 'monthly';
    this.gaugeMin = s.gaugeMin ?? 0;
    this.gaugeMax = s.gaugeMax ?? 100;
    this.bulletTargetColumn = s.bulletTargetColumn ?? '';
    this.bubbleSizeColumn = s.bubbleSizeColumn ?? '';
    this.heatmapYColumn = s.heatmapYColumn ?? '';
    this.sankeyFromColumn = s.sankeyFromColumn ?? '';
    this.sankeyToColumn = s.sankeyToColumn ?? '';
    this.sankeyWeightColumn = s.sankeyWeightColumn ?? '';
    this.timelineDateColumn = s.timelineDateColumn ?? '';
    this.timelineLabelColumn = s.timelineLabelColumn ?? '';
    this.colorRules = (s.colorRules ?? []).map(rule => ({ ...rule }));
    this.nextColorRuleId = this.colorRules.reduce((max, rule) => Math.max(max, rule.id + 1), 1);
    this.colorOverrides = { ...(s.colorOverrides ?? {}) };
    this.advancedConfig = readAdvancedConfig(s.advancedConfig);
    this.daxModel = this.cloneDaxModel(s.daxModel);
    this.syncDaxSelectionFromModel();
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    if (this.drillDownViewId) {
      const match = this.drillDownViews.find(v => v.id === this.drillDownViewId);
      this.drillDownViewName = match?.viewName ?? '';
    } else { this.drillDownViewName = ''; }
    // viewId is restored via selectedView lookup after view list loads
    // Reload data for the restored source
    const src = this.chartModels.find(m => m.id === this.selectedChartModelId)
             ?? this.importedChartModels.find(m => m.id === this.selectedChartModelId);
    this.rawLoadedColumns = []; this.rawLoadedRows = [];
    this.xAxisOptions = []; this.yAxisColumns = []; this.tableRows = [];
    this.chartPreviewOptions = null;
    if (this.selectedChartModelId) {
      this.sourceLoading = true;
      const restoredSource = this.selectedChartModelId;
      const restoredTab = this.activeTabId;
      const loadSource = () => this.loadColumnsForSource({ name: restoredSource,
        sourceType: this.dataSourceMode === 'import' ? 'Import'
          : this.dataSourceMode === 'view' ? 'View' : (src?.modelType ?? 'Table') },
        { xAxis: s.xAxis, yAxis: s.yAxis, yAggColumn: s.yAggColumn });
      if (this.dataSourceMode === 'view' && !this.selectedView) {
        this.commonApi.getDatabaseViews('view').pipe(takeUntil(this.destroy$)).subscribe({
          next: views => {
            this.availableViews = views;
            if (this.activeTabId === restoredTab && this.selectedChartModelId === restoredSource
              && this.dataSourceMode === 'view') loadSource();
          },
          error: () => { this.sourceLoading = false; this.cdr.markForCheck(); },
        });
      } else { loadSource(); }
    }
  }

  private resetChartState(): void {
    this.sourceLoadVersion++;
    this.sourceLoading = false;
    this.chartTitle = 'Chart Name';
    this.chartDescription = '';
    this.selectedChartType = null;
    this.selectedLibraryId = null;
    this.selectedChartModelId = '';
    this.dataSourceMode = 'table';
    this.xAxis = '';
    this.yAxis = 'Count (F)';
    this.yAggColumn = '';
    this.xAxisTitle = '';
    this.yAxisTitle = '';
    this.showLegend = true;
    this.includeDataTable = false;
    this.showAxisTitle = false;
    this.axisTitleAutoApplied = false;
    this.showDataLabels = true;
    this.showStackTotal = true;
    this.limitCategory = 'top';
    this.topN = 100;
    this.bottomN = 0;
    this.groupRestAsOthers = false;
    this.multiYColumns = [];
    this.interactiveFilters = [];
    this.conditionalFilters = [];
    this.parameterFilters = [];
    this.appliedRenameMap = {};
    this.rawLoadedRows = [];
    this.rawLoadedColumns = [];
    this.previewFilterValues = {};
    this.previewFilterMultiValues = {};
    this.crossTableFilterRows = null;
    this.attachedTileIds = [];
    this.drillDownViewId = null;
    this.drillDownViewName = '';
    this.tableRowColors = [];
    this.tableHeaderColor = '';
    this.tableHeaderTextColor = '';
    this.tableRowTextColors = [];
    this.comboLineColumns = [];
    this.yAxis2Title = '';
    this.trendMode = 'monthly';
    this.gaugeMin = 0;
    this.gaugeMax = 100;
    this.bulletTargetColumn = '';
    this.bubbleSizeColumn = '';
    this.heatmapYColumn = '';
    this.sankeyFromColumn = '';
    this.sankeyToColumn = '';
    this.sankeyWeightColumn = '';
    this.timelineDateColumn = '';
    this.timelineLabelColumn = '';
    this.colorRules = [];
    this.nextColorRuleId = 1;
    this.colorOverrides = {};
    this.advancedConfig = defaultAdvancedConfig();
    this.advancedRows = [];
    this.daxModel = this.createDefaultDaxModel();
    this.syncDaxSelectionFromModel();
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    this.previewInlineTiles = [];
    this.chartPreviewOptions = null;
    this.tableRows = [];
    this.xAxisOptions = [];
    this.yAxisColumns = [];
    // Keep category from first tab as default
  }

  toggleLock(): void {
    this.locked = !this.locked;
  }

  private snapshotState(): ChartTabState {
    return {
      chartTitle: this.chartTitle,
      chartDescription: this.chartDescription,
      selectedChartType: this.selectedChartType,
      selectedLibraryId: this.selectedLibraryId,
      selectedChartModelId: this.selectedChartModelId,
      dataSourceMode: this.dataSourceMode,
      xAxis: this.xAxis,
      yAxis: this.yAxis,
      yAggColumn: this.yAggColumn,
      xAxisTitle: this.xAxisTitle,
      yAxisTitle: this.yAxisTitle,
      showLegend: this.showLegend,
      includeDataTable: this.includeDataTable,
      showAxisTitle: this.showAxisTitle,
      showDataLabels: this.showDataLabels,
      showStackTotal: this.showStackTotal,
      limitCategory: this.limitCategory,
      topN: this.topN,
      bottomN: this.bottomN,
      groupRestAsOthers: this.groupRestAsOthers,
      multiYColumns: [...this.multiYColumns],
      interactiveFilters: this.interactiveFilters.map(f => ({ ...f })),
      conditionalFilters: this.conditionalFilters.map(f => ({ ...f })),
      parameterFilters: this.parameterFilters.map(r => ({ ...r, sourceColumns: getRuleSourceColumns(r) })),
      attachedTileIds: [...this.attachedTileIds],
      selectedCategoryId: this.selectedCategoryId,
      category: this.category,
      viewId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null)
            : this.dataSourceMode === 'import' ? (this.selectedImportDataset?.id ?? null)
            : null,
      tableRowColors: [...this.tableRowColors],
      tableHeaderColor: this.tableHeaderColor,
      tableHeaderTextColor: this.tableHeaderTextColor,
      tableRowTextColors: [...this.tableRowTextColors],
      comboLineColumns: [...this.comboLineColumns],
      yAxis2Title: this.yAxis2Title,
      drillDownViewId: this.drillDownViewId,
      trendMode: this.trendMode,
      gaugeMin: this.gaugeMin,
      gaugeMax: this.gaugeMax,
      bulletTargetColumn: this.bulletTargetColumn,
      bubbleSizeColumn: this.bubbleSizeColumn,
      heatmapYColumn: this.heatmapYColumn,
      sankeyFromColumn: this.sankeyFromColumn,
      sankeyToColumn: this.sankeyToColumn,
      sankeyWeightColumn: this.sankeyWeightColumn,
      timelineDateColumn: this.timelineDateColumn,
      timelineLabelColumn: this.timelineLabelColumn,
      colorRules: this.colorRules.map(rule => ({ ...rule })),
      colorOverrides: { ...this.colorOverrides },
      advancedConfig: structuredClone(this.advancedConfig),
      daxModel: this.cloneDaxModel(this.daxModel),
      previewFilterValues: { ...this.previewFilterValues },
      previewFilterMultiValues: structuredClone(this.previewFilterMultiValues),
    };
  }

  private applyState(s: ChartTabState): void {
    this.advancedConfig = readAdvancedConfig(s.advancedConfig);
    if (this.selectedChartModelId !== s.selectedChartModelId || this.dataSourceMode !== s.dataSourceMode) {
      this.restoreChartState(s);
      this.cdr.markForCheck();
      return;
    }
    this.chartTitle = s.chartTitle;    this.chartDescription = s.chartDescription;
    this.selectedChartType = s.selectedChartType;
    this.selectedLibraryId = s.selectedLibraryId;
    this.selectedChartModelId = s.selectedChartModelId;
    this.dataSourceMode = s.dataSourceMode;
    this.xAxis = s.xAxis;
    this.yAxis = s.yAxis;
    this.yAggColumn = s.yAggColumn;
    this.xAxisTitle = s.xAxisTitle;
    this.yAxisTitle = s.yAxisTitle;
    this.showLegend = s.showLegend;
    this.includeDataTable = s.includeDataTable;
    this.showAxisTitle = s.showAxisTitle;
    this.axisTitleAutoApplied = false;
    this.showDataLabels = s.showDataLabels ?? true;
    this.showStackTotal = s.showStackTotal ?? true;
    this.limitCategory = s.limitCategory;
    this.topN = s.topN;
    this.bottomN = s.bottomN;
    this.groupRestAsOthers = s.groupRestAsOthers;
    this.multiYColumns = [...s.multiYColumns];
    this.interactiveFilters = s.interactiveFilters.map(f => ({ ...f }));
    this.conditionalFilters = (s.conditionalFilters ?? []).map(f => ({
      ...f,
      hidden: f.hidden ?? true,
      values: [...(f.values ?? [])],
    }));
    this.syncConditionalFilterSelections();
    this.parameterFilters = (s.parameterFilters ?? []).map(r => ({
      ...r,
      separator: r.separator?.trim() ? r.separator : '',
      sourceColumns: getRuleSourceColumns(r),
    }));
    this.appliedRenameMap = {};
    for (const rule of this.parameterFilters) {
      if (rule.action === 'rename_column' && rule.sourceColumn && rule.newColumnName?.trim() && rule.newColumnName.trim() !== rule.sourceColumn) {
        this.appliedRenameMap[rule.id] = {
          sourceColumn: rule.sourceColumn,
          appliedName: rule.newColumnName.trim(),
        };
      }
    }
    this.syncParameterFilterIds();
    this.applyParameterDrivenTransformations();
    this.previewFilterValues = {};
    this.crossTableFilterRows = null;
    this.syncInteractiveFilterSelections();
    this.applyPreviewFilters();
    this.attachedTileIds = [...s.attachedTileIds];
    this.selectedCategoryId = s.selectedCategoryId;
    this.category = s.category;
    this.tableRowColors = s.tableRowColors ? [...s.tableRowColors] : [];
    this.tableHeaderColor = s.tableHeaderColor ?? '';
    this.tableHeaderTextColor = s.tableHeaderTextColor ?? '';
    this.tableRowTextColors = s.tableRowTextColors ? [...s.tableRowTextColors] : [];
    this.colorRules = (s.colorRules ?? []).map(rule => ({ ...rule }));
    this.nextColorRuleId = this.colorRules.reduce((max, rule) => Math.max(max, rule.id + 1), 1);
    this.colorOverrides = { ...(s.colorOverrides ?? {}) };
    this.comboLineColumns = s.comboLineColumns ? [...s.comboLineColumns] : [];
    this.yAxis2Title = s.yAxis2Title ?? '';
    this.trendMode = s.trendMode ?? 'monthly';
    this.daxModel = this.cloneDaxModel(s.daxModel);
    this.syncDaxSelectionFromModel();
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    this.drillDownViewId = s.drillDownViewId ?? null;
    this.drillDownViewName = this.drillDownViewId
      ? this.drillDownViews.find(v => v.id === this.drillDownViewId)?.viewName ?? ''
      : '';
    this.refreshPreview();
  }

  pushUndo(): void {
    if (this.locked) return;
    this.undoStack.push(this.snapshotState());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshotState());
    this.applyState(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshotState());
    this.applyState(next);
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(200, this.zoomLevel + 10);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(50, this.zoomLevel - 10);
  }

  togglePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
  }

  // ─── Resizable divider between the canvas and the Chart Components panel ──
  chartSetupWidth = 530;
  private readonly MIN_CHART_SETUP_WIDTH = 360;
  private readonly MAX_CHART_SETUP_WIDTH = 760;
  panelResizing = false;
  private panelResizeStartX = 0;
  private panelResizeStartWidth = 0;
  isDesktopViewport = typeof window !== 'undefined' ? window.innerWidth > 768 : true;

  @HostListener('window:resize')
  onWindowResizeForPanel(): void {
    this.isDesktopViewport = window.innerWidth > 768;
  }

  onPanelResizeStart(event: MouseEvent): void {
    this.panelResizing = true;
    this.panelResizeStartX = event.clientX;
    this.panelResizeStartWidth = this.chartSetupWidth;
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onPanelResizeMove(event: MouseEvent): void {
    if (!this.panelResizing) return;
    const delta = this.panelResizeStartX - event.clientX;
    this.chartSetupWidth = Math.min(
      this.MAX_CHART_SETUP_WIDTH,
      Math.max(this.MIN_CHART_SETUP_WIDTH, this.panelResizeStartWidth + delta)
    );
  }

  @HostListener('document:mouseup')
  onPanelResizeEnd(): void {
    this.panelResizing = false;
  }

  requestClearAll(): void {
    this.showClearAllConfirm = true;
  }

  confirmClearAll(): void {
    this.pushUndo();
    for (const key of this.sourceModeStates.keys()) {
      if (key.startsWith(`${this.activeTabId}:`)) this.sourceModeStates.delete(key);
    }
    for (const key of this.chartTypeStates.keys()) {
      if (key.startsWith(`${this.activeTabId}:`)) this.chartTypeStates.delete(key);
    }
    this.resetChartState();
    this.resetGlobalFiltersToDefaults();
    this.quickRange = '';
    this.resetGlobalFilterDateRange();
    this.reloadGlobalViewPreview();
    this.clearEditorDraft();
    this.persistEditorDraft();
    this.showClearAllConfirm = false;
  }

  cancelClearAll(): void {
    this.showClearAllConfirm = false;
  }

  /** Giving an axis title implies the user wants it shown, so auto-enable the toggle the first time. */
  onAxisTitleChange(): void {
    const hasTitle = !!(this.xAxisTitle.trim() || this.yAxisTitle.trim());
    if (!hasTitle) this.axisTitleAutoApplied = false;
    else if (!this.showAxisTitle && !this.axisTitleAutoApplied) {
      this.showAxisTitle = true;
      this.axisTitleAutoApplied = true;
    }
    this.refreshPreview();
  }

  /** A manual toggle is an explicit choice; don't fight it by auto-enabling on further typing. */
  onShowAxisTitleChange(): void {
    this.axisTitleAutoApplied = true;
    this.refreshPreview();
  }

  /** Limit-category / Top-N / Bottom-N change: for stacked charts a large or unbounded set makes
   *  data labels unreadable, so untick Show Data Labels automatically. */
  onLimitChange(): void {
    if (this.selectedChartType === 'stacked' && this.showDataLabels) {
      const unbounded =
        this.limitCategory === 'all' ||
        (this.limitCategory === 'top' && (this.topN === 0 || this.topN > 100)) ||
        (this.limitCategory === 'bottom' && (this.bottomN === 0 || this.bottomN > 100));
      if (unbounded) this.showDataLabels = false;
    }
    this.refreshPreview();
  }

  refreshPreview(): void {
    this.previewLegendItems = [];
    if (this.isAdvancedType) {
      this.chartPreviewOptions = null;
      this.advancedRows = this.previewRows.map(row => ({ ...row }));
      this.previewData = { categories: [], values: [] };
      return;
    }
    if (!this.canGeneratePreview || this.isChartlessPreview || this.yAxisColumnError) {
      this.chartPreviewOptions = null;
      return;
    }

    const ct = this.selectedChartType;

    const isStacked = ct === 'stacked';
    const isCombo      = ct === 'combo';
    const isMultiDualY = ct === 'multiline' && this.comboLineColumns.length > 0;
    const isHistogram  = ct === 'histogram';
    const HC_TYPE_MAP: Partial<Record<string, Highcharts.SeriesOptionsType['type']>> =
      { bar: 'column', donut: 'pie', trend: 'areaspline', multiline: 'line', area: 'area', spline: 'spline', column: 'bar', stacked: 'column', combo: 'column', grouped: 'column' };
    const chartType = (HC_TYPE_MAP[ct ?? ''] ?? ct) as Highcharts.SeriesOptionsType['type'];

    const isPie = chartType === 'pie';
    const isTreemap = chartType === 'treemap';
    let isMultiSeries = this.isMultiSeriesType && this.multiYColumns.length > 0;

    if (isCombo) {
      this.chartPreviewOptions = this.buildComboPreviewOptions();
      this.syncInlineDataTable(this.chartPreviewOptions);
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (isMultiDualY) {
      this.chartPreviewOptions = this.buildMultiLineDualYPreviewOptions();
      this.syncInlineDataTable(this.chartPreviewOptions);
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (isHistogram) {
      this.chartPreviewOptions = this.buildHistogramPreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isGaugeType) {
      this.chartPreviewOptions = this.buildGaugePreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isBulletType) {
      this.chartPreviewOptions = this.buildBulletPreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isBubbleType) {
      this.chartPreviewOptions = this.buildBubblePreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isHeatmapType) {
      this.chartPreviewOptions = this.buildHeatmapPreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isSankeyType) {
      this.chartPreviewOptions = this.buildSankeyPreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    if (this.isTimelineType) {
      this.chartPreviewOptions = this.buildTimelinePreviewOptions();
      this.chartRenderVisible = false;
      this.cdr.detectChanges();
      this.chartRenderVisible = true;
      this.cdr.detectChanges();
      return;
    }

    let categories: string[];
    let values: number[];
    let multiSeries: Highcharts.SeriesOptionsType[] = [];

    if (isMultiSeries) {
      const result = this.buildMultiSeriesPreview(chartType);
      categories = result.categories;
      values = [];
      multiSeries = result.series;
    } else {
      const computed = this.computeChartData();
      categories = computed.categories;
      values = computed.values;
    }

    if (this.daxEnabled && this.selectedDaxSeriesMeasures.length > 0) {
      for (const measure of this.selectedDaxSeriesMeasures) {
        const expression = this.parseDaxExpression(measure.expression);
        if (!expression) continue;
        const totalValue = evaluateDaxMeasure(measure, this.previewRows, this.yAxisColumns);
        const measureName = measure.name || this.daxMeasureName || 'New Measure';

        categories.push(measureName);
        if (isPie) {
          values.push(totalValue);
        } else if (isMultiSeries) {
          appendDaxTotalToSeries(totalValue, multiSeries as { data?: unknown }[],
            isStacked && this.showStackTotal ? multiSeries.length - 1 : -1);
        } else {
          values.push(totalValue);
        }
      }
    }

    this.previewData = { categories, values };
    this.previewMultiSeries = (multiSeries as any[]).map(s => ({ name: s.name ?? '', data: s.data ?? [] }));
    this.chartPreviewOptions = this.buildPreviewOptions(chartType, isPie, isStacked, isMultiSeries, categories, values, multiSeries, isTreemap);
    this.chartRenderVisible = false;
    this.cdr.detectChanges();
    this.chartRenderVisible = true;
    this.cdr.detectChanges();
  }

  // Combo/dual-Y branches build their own options and return early, so mirror their
  // categories + series into the fields the inline data table reads (left + right columns).
  private syncInlineDataTable(options: Highcharts.Options): void {
    const xAxis = Array.isArray(options.xAxis) ? options.xAxis[0] : options.xAxis;
    const categories = [...((xAxis?.categories as string[]) ?? [])];
    const series = (options.series as { name?: string; data?: unknown[] }[]) ?? [];
    // Clone into fresh numeric arrays — Highcharts rewrites series data into Point objects in place
    // when it renders, which would otherwise surface as "[object Object]" in the table.
    this.previewMultiSeries = series.map(s => ({
      name: s.name ?? '',
      data: (s.data ?? []).map(v => (v && typeof v === 'object') ? (Number((v as { y?: unknown }).y) || 0) : (Number(v) || 0)),
    }));
    this.previewData = { categories, values: [] };
  }

  private buildPreviewOptions(
    chartType: any, isPie: boolean, isStacked: boolean, isMultiSeries: boolean,
    categories: string[], values: number[], multiSeries: Highcharts.SeriesOptionsType[],
    isTreemap = false,
  ): Highcharts.Options {
    if (chartType === 'funnel') {
      return buildFunnelOptions(categories, values, categories.map((category, index) => this.previewPointColor(category, values[index] ?? 0, index)), 320, this.getPreviewSeriesName(), false);
    }
    const xTitle = this.showAxisTitle ? (this.xAxisTitle || this.xAxis || undefined) : undefined;
    let yTitle: string | undefined;
    if (this.showAxisTitle) {
      yTitle = this.yAxisTitle || (isMultiSeries ? '' : this.yAxis) || undefined;
    }
    const singleSeriesName = this.getPreviewSeriesName();
    const noAxisChart = isPie || isTreemap;
    const thisBuilder = this;

    return {
      chart: {
        type: chartType,
        backgroundColor: 'transparent',
        height: 320,
        events: {
          load: function (this: Highcharts.Chart) {
            const openPointPicker = (event: MouseEvent): void => {
              for (const chartSeries of this.series) {
                const point = chartSeries.points.find(candidate => candidate.graphic?.element.contains(event.target as Node));
                if (point) {
                  const pointBounds = point.graphic?.element.getBoundingClientRect();
                  const anchor = pointBounds
                    ? { left: pointBounds.left, right: pointBounds.right, top: pointBounds.top }
                    : undefined;
                  thisBuilder.openPointColorPicker(String(point.name ?? point.category ?? ''), String(chartSeries.name ?? ''), event, anchor);
                  return;
                }
              }
            };
            this.container.addEventListener('click', openPointPicker);
            this.container.addEventListener('contextmenu', openPointPicker);
          },
        },
      },
      title: { text: undefined },
      subtitle: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: this.showLegend && !this.usesCustomPreviewLegend, squareSymbol: false, symbolRadius: 6 },
      tooltip: isTreemap
        ? { headerFormat: '<span style="font-size: 0.8em">{point.name}</span><br/>', pointFormat: '<b>{point.value}</b>' }
        : { pointFormat: '<b>{point.y}</b>' },
      xAxis: noAxisChart ? undefined : {
        categories,
        title: { text: xTitle },
        lineColor: '#E7ECF3',
      },
      yAxis: noAxisChart ? undefined : {
        title: { text: yTitle },
        gridLineColor: '#F1F3F6',
      },
      plotOptions: {
        pie: { innerSize: this.selectedChartType === 'donut' ? '60%' : '0%', borderWidth: 2, borderColor: '#fff', showInLegend: this.showLegend,
          dataLabels: { enabled: this.showDataLabels, distance: -28, format: '{point.y}', style: { color: '#fff', fontWeight: '700', fontSize: '12px', textOutline: 'none' } } },
        column: { borderRadius: isStacked ? 0 : 4, borderWidth: 0, colorByPoint: false, stacking: isStacked ? 'normal' as any : undefined,
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        bar: { borderRadius: 4, borderWidth: 0, colorByPoint: false,
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        areaspline: { color: chartFallbackColor(`${this.getPreviewSeriesName()}:`, 0), fillOpacity: 0.15,
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        line: { marker: { enabled: true },
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        spline: { marker: { enabled: true },
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        area: { fillOpacity: 0.15,
          dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        waterfall: { borderRadius: 4, dataLabels: { enabled: this.showDataLabels, style: { fontSize: '11px', fontWeight: '600' } } },
        treemap: { layoutAlgorithm: 'squarified' as any,
          dataLabels: { enabled: this.showDataLabels, format: '{point.name}',
            style: { fontSize: '11px', fontWeight: '400', textOutline: 'none' } } },
      },
      series: isMultiSeries
        ? this.applyPreviewColorRules(multiSeries, categories)
        : this.applyPreviewColorRules(
          [this.buildSinglePreviewSeries(chartType, isPie, singleSeriesName, categories, values, isTreemap)],
          categories,
        ),
    };
  }

  private matchesPreviewColorRule(raw: unknown, operator: string, expected: string, expectedUpper?: string): boolean {
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

  private previewColorFor(category: string, value: number, seriesName = '', includeCategoryRule = true): string | undefined {
    const normalizedCategory = (usesSeriesCategoryColorRules(this.selectedChartType, this.xAxis) ? seriesName : category).trim().toLowerCase();
    const prioritizedRules = [...this.colorRules].sort((left, right) =>
      Number(this.isCategoryColorRule(right)) - Number(this.isCategoryColorRule(left)));
    for (const rule of prioritizedRules) {
      const field = rule.field.trim().toLowerCase();
      if (field === 'category') {
        if (!includeCategoryRule) continue;
        if ((rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalizedCategory)) return rule.color;
        continue;
      }
      const candidates: unknown[] = [category, value];
      if (field === this.xAxis.toLowerCase() || field === this.xAxisTitle.toLowerCase()) candidates.splice(1, 1);
      else if (field === this.yAggColumn.toLowerCase() || field === this.yAxis.toLowerCase() || field === seriesName.toLowerCase()) candidates.splice(0, 1);
      if (rule.operator === 'Between' && this.matchesPreviewColorRule(value, rule.operator, rule.value, rule.value2)) return rule.color;
      if (candidates.some(candidate => this.matchesPreviewColorRule(candidate, rule.operator, rule.value, rule.value2))) return rule.color;
    }
    return undefined;
  }

  private previewCategoryColorFor(category: string, seriesName = '', includeCategoryRule = true): string | undefined {
    if (!includeCategoryRule) return undefined;
    const normalizedCategory = (usesSeriesCategoryColorRules(this.selectedChartType, this.xAxis) ? seriesName : category).trim().toLowerCase();
    return this.colorRules.find(rule => this.isCategoryColorRule(rule)
      && (rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalizedCategory))?.color;
  }

  private previewFallbackColor(seed: string, index: number): string {
    return chartFallbackColor(seed, index);
  }

  private previewPointColor(category: string, value: number, index: number, seriesName = '', includeCategoryRule = true): string {
    const effectiveSeriesName = seriesName || this.getBasePreviewSeriesName();
    const key = `${effectiveSeriesName}:${category}`;
    return this.previewPointOverride(category, value, effectiveSeriesName, includeCategoryRule)
      ?? this.previewFallbackColor(key, index);
  }

  private previewPointOverride(category: string, value: number, seriesName: string, includeCategoryRule = true): string | undefined {
    const key = `${seriesName}:${category}`;
    return this.previewCategoryColorFor(category, seriesName, includeCategoryRule)
      ?? this.colorOverrides[key]
      ?? this.previewColorFor(category, value, seriesName, includeCategoryRule);
  }

  private get usesSemanticSeriesColors(): boolean {
    return this.selectedChartType === 'stacked'
      || this.selectedChartType === 'grouped'
      || this.selectedChartType === 'combo';
  }

  private applyPreviewColorRules(series: Highcharts.SeriesOptionsType[], categories: string[]): Highcharts.SeriesOptionsType[] {
    return (series as any[]).map(item => {
      const categoryColor = this.previewCategoryColorFor('', item.name ?? '');
      const lineCategoryColor = usesPeriodLineCategoryColorRules(this.selectedChartType, this.xAxis, item.type)
        ? categoryColor : undefined;
      return {
        ...item,
        color: lineCategoryColor ?? categoryColor ?? item.color,
        data: Array.isArray(item.data) ? item.data.map((raw: any, index: number) => {
        const value = typeof raw === 'number' ? raw : Number(raw?.y ?? raw?.value ?? 0);
        const category = categories[index] ?? raw?.name ?? '';
        if (lineCategoryColor) {
          const pointOverride = this.previewPointOverride(category, value, item.name ?? '', false);
          if (pointOverride) return { ...(typeof raw === 'object' ? raw : { y: raw }), color: pointOverride };
          const pointColor = typeof raw === 'object' && raw.color
            ? raw.color
            : this.previewPointColor(category, value, index, item.name, false);
          return { ...(typeof raw === 'object' ? raw : { y: raw }), color: pointColor };
        }
        if (this.usesSemanticSeriesColors) {
          const override = this.previewPointOverride(category, value, item.name ?? '');
          return override ? { ...(typeof raw === 'object' ? raw : { y: raw }), color: override } : raw;
        }
        const point = typeof raw === 'object' ? raw : { y: raw };
        return { ...point, color: this.previewPointColor(category, value, index, item.name) };
        }) : item.data,
      };
    }) as Highcharts.SeriesOptionsType[];
  }

  get basePreviewSeriesName(): string {
    return this.getBasePreviewSeriesName();
  }

  private getBasePreviewSeriesName(): string {
    return this.yAxis || 'Value';
  }

  private getPreviewSeriesName(): string {
    return this.getBasePreviewSeriesName();
  }

  private buildSinglePreviewSeries(chartType: any, isPie: boolean, name: string, categories: string[], values: number[], isTreemap = false): Highcharts.SeriesOptionsType {
    const categoryRuleAppliesToLine = usesPeriodLineCategoryColorRules(this.selectedChartType, this.xAxis);
    if (isPie) {
      return {
        type: chartType as any,
        name,
        showInLegend: this.showLegend,
        data: categories.map((category, i) => ({ name: category, y: values[i] ?? 0, color: this.previewPointColor(category, values[i] ?? 0, i) })),
      } as Highcharts.SeriesOptionsType;
    }
    if (isTreemap) {
      return {
        type: chartType as any,
        name,
        data: categories.map((category, i) => ({ name: category, value: values[i] ?? 0, color: this.previewPointColor(category, values[i] ?? 0, i) })),
      } as Highcharts.SeriesOptionsType;
    }
    return {
      type: chartType, name,
      data: values.map((value, i) => ({
        y: value,
        color: this.previewPointColor(categories[i] ?? '', value, i, name, !categoryRuleAppliesToLine),
      })),
    } as Highcharts.SeriesOptionsType;
  }

  /** Applies the Top N / Bottom N / "Group as Others" limit to a multi-series category list. */
  private limitPreviewCategories(categories: string[], catTotal: (cat: string) => number): { categories: string[]; othersSet: Set<string> } {
    const wantTop = this.limitCategory === 'top' && (this.topN ?? 0) > 0;
    const wantBottom = this.limitCategory === 'bottom' && (this.bottomN ?? 0) > 0;
    if (!wantTop && !wantBottom) return { categories, othersSet: new Set<string>() };
    const n = wantTop ? this.topN : this.bottomN;
    if (categories.length <= n) return { categories, othersSet: new Set<string>() };
    const pairs = categories.map(c => ({ c, v: catTotal(c) }));
    pairs.sort((a, b) => wantTop ? b.v - a.v : a.v - b.v);
    const kept = pairs.slice(0, n).map(p => p.c);
    const rest = pairs.slice(n).map(p => p.c);
    if (this.groupRestAsOthers && rest.length) return { categories: [...kept, 'Others'], othersSet: new Set(rest) };
    return { categories: kept, othersSet: new Set<string>() };
  }

  private buildMultiSeriesPreview(chartType: any): { categories: string[]; series: Highcharts.SeriesOptionsType[] } {
    const isFn = this.yAxisFunctions.some(f => f.value === this.yAxis);
    const allCols: string[] = [];
    if (!isFn && this.yAxis && !this.multiYColumns.includes(this.yAxis)) {
      allCols.push(this.yAxis);
    }
    allCols.push(...this.multiYColumns);

    const isStacked = this.selectedChartType === 'stacked';

    // Aggregate once per category (O(rows × cols)) instead of an O(rows) find per cell — a
    // high-cardinality x-axis (e.g. a unique id) would otherwise make the preview O(rows²) and hang.
    const byCat = new Map<string, Record<string, number>>();
    for (const r of this.previewRows) {
      const key = safeString(r[this.xAxis]);
      let agg = byCat.get(key);
      if (!agg) { agg = Object.fromEntries(allCols.map(c => [c, 0])); byCat.set(key, agg); }
      for (const col of allCols) agg[col] += Number(r[col]) || 0;
    }

    const catTotal = (cat: string): number => allCols.reduce((s, col) => s + (byCat.get(cat)?.[col] ?? 0), 0);
    // Category count is bounded by the Top N / Bottom N limit (default Top 100); no hidden hard cap.
    const { categories, othersSet } = this.limitPreviewCategories([...byCat.keys()], catTotal);
    // Resolves a cell value, summing the folded-away categories when rendering the "Others" bucket.
    const cellValue = (cat: string, col: string): number => {
      if (cat === 'Others') {
        return [...othersSet].reduce((sum, oc) => sum + (byCat.get(oc)?.[col] ?? 0), 0);
      }
      return byCat.get(cat)?.[col] ?? 0;
    };

    const series: Highcharts.SeriesOptionsType[] = allCols.map((col, i) => ({
      type: (isStacked ? 'column' : chartType) as any,
      name: col,
      data: categories.map(cat => cellValue(cat, col)),
      color: getSeriesColorByName(col, i),
    }));

    // For stacked charts, add a total line series (optional — controlled by the Show Total toggle).
    if (isStacked && this.showStackTotal) {
      const totals = categories.map(cat => allCols.reduce((sum, col) => sum + cellValue(cat, col), 0));
      series.push({
        type: 'line' as any,
        name: 'Total',
        data: totals,
        color: '#374151',
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600' } } as any,
      });
    }

    return { categories, series };
  }

  private buildMultiLineDualYPreviewOptions(): Highcharts.Options {
    const cats = [...new Set(this.previewRows.map(r => safeString(r[this.xAxis])))];
    const rowByKey = new Map(this.previewRows.map(r => [safeString(r[this.xAxis]), r]));
    const extraY   = this.yAxisExtraColumn;
    const leftCols = [...(extraY ? [extraY] : []), ...this.multiYColumns.filter(c => !this.comboLineColumns.includes(c))];
    const rightCols = this.comboLineColumns;
    const allCols   = [...leftCols, ...rightCols];

    const series: Highcharts.SeriesOptionsType[] = allCols.map((col, i) => ({
      type: 'line' as const,
      name: col,
      yAxis: rightCols.includes(col) ? 1 : 0,
      data: cats.map(cat => { const r = rowByKey.get(cat); return r ? Number(r[col]) || 0 : 0; }),
      color: chartFallbackColor(`${col}:`, i),
      marker: { enabled: true, radius: 4 },
    }));

    return {
      chart: { type: 'line', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      xAxis: { categories: cats, lineColor: '#E7ECF3' },
      yAxis: [
        { title: { text: this.yAxisTitle || undefined }, gridLineColor: '#F1F3F6' },
        { title: { text: this.yAxis2Title || undefined }, opposite: true, gridLineWidth: 0 },
      ],
      tooltip: { shared: true },
      plotOptions: { line: { marker: { radius: 4 }, dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } } },
      series,
    };
  }

  private buildComboPreviewOptions(): Highcharts.Options {
    const cats = [...new Set(this.previewRows.map(r => safeString(r[this.xAxis])))];
    // precompute lookup map to avoid O(series × categories × rows) repeated finds
    const rowByKey = new Map(this.previewRows.map(r => [safeString(r[this.xAxis]), r]));
    const extraY = this.yAxisExtraColumn;
    const allBarCols = [...(extraY ? [extraY] : []), ...this.multiYColumns.filter(c => !this.comboLineColumns.includes(c))];
    const lineCols   = this.comboLineColumns;

    const barSeries: Highcharts.SeriesOptionsType[] = allBarCols.map((col, i) => ({
      type: 'column' as const,
      name: col,
      yAxis: 0,
      stack: 'main',
      data: cats.map(cat => { const r = rowByKey.get(cat); return r ? Number(r[col]) || 0 : 0; }),
      color: getSeriesColorByName(col, i),
    }));

    const lineSeries: Highcharts.SeriesOptionsType[] = lineCols.map((col, i) => ({
      type: 'line' as const,
      name: col,
      yAxis: 1,
      data: cats.map(cat => { const r = rowByKey.get(cat); return r ? Number(r[col]) || 0 : 0; }),
      color: getSeriesColorByName(col, allBarCols.length + i),
      marker: { enabled: true, radius: 4 },
    }));

    return {
      chart: { backgroundColor: 'transparent', height: 320 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },
      xAxis: { categories: cats, lineColor: '#E7ECF3' },
      yAxis: [
        { title: { text: this.yAxisTitle || undefined }, gridLineColor: '#F1F3F6' },
        { title: { text: this.yAxis2Title || undefined }, opposite: true, gridLineWidth: 0 },
      ],
      tooltip: { shared: true },
      plotOptions: {
        column: { stacking: 'normal' as any, borderWidth: 0, dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
        line: { dataLabels: { enabled: this.showDataLabels, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600' } } },
      },
      series: [...barSeries, ...lineSeries],
    };
  }

  /** Histogram bins raw numeric values itself — needs a hidden "raw data" series the histogram series references via baseSeries. */
  private buildHistogramPreviewOptions(): Highcharts.Options {
    const col = this.yAggColumn || this.yAxis;
    const rawValues = this.previewRows
      .map(r => Number(r[col]))
      .filter(v => !Number.isNaN(v));

    return {
      chart: { backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: this.showLegend },
      xAxis: [
        { title: { text: this.xAxisTitle || undefined }, alignTicks: false },
        { title: { text: 'Histogram' }, alignTicks: false, opposite: true },
      ],
      yAxis: [
        { title: { text: this.yAxisTitle || undefined } },
        { title: { text: 'Frequency' }, opposite: true },
      ],
      series: [
        { name: col || 'Raw data', type: 'scatter' as const, data: rawValues, visible: false, id: 'histogram-raw-data' },
        { name: col || 'Histogram', type: 'histogram' as any, xAxis: 1, yAxis: 1, baseSeries: 'histogram-raw-data', zIndex: -1, color: chartFallbackColor(`${col || 'Histogram'}:`, 0) },
      ],
    };
  }

  /** Single aggregated number, no axes — solid-gauge needs a min/max range. */
  private buildGaugePreviewOptions(): Highcharts.Options {
    const col = this.yAggColumn || this.yAxis;
    const nums = this.previewRows.map(r => Number(r[col])).filter(v => !Number.isNaN(v));
    let value: number;
    if (this.yAxis === 'Average (F)') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (this.yAxis === 'Min (F)') value = nums.length ? Math.min(...nums) : 0;
    else if (this.yAxis === 'Max (F)') value = nums.length ? Math.max(...nums) : 0;
    else if (this.yAxis === 'Count (F)' || this.yAxis === 'Count Distinct (F)') value = this.previewRows.length;
    else value = nums.reduce((a, b) => a + b, 0);

    return {
      chart: { type: 'solidgauge' as any, backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      pane: { startAngle: -90, endAngle: 90, background: [{ backgroundColor: '#EEE', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }] } as any,
      yAxis: {
        min: this.gaugeMin, max: this.gaugeMax || 100,
        stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']],
        lineWidth: 0, tickWidth: 0, minorTickInterval: null as any, labels: { enabled: false },
      } as any,
      plotOptions: {
        solidgauge: { dataLabels: { y: -30, borderWidth: 0, format: '<div style="text-align:center"><span style="font-size:22px;font-weight:600">{y}</span></div>' } },
      } as any,
      series: [{ type: 'solidgauge' as any, name: col || 'Value', data: [value] }],
    };
  }

  /** Reuses X-axis category + Y-axis value, adds an optional Target column per category. */
  private buildBulletPreviewOptions(): Highcharts.Options {
    const measureCol = this.yAggColumn || this.yAxis;
    const grouped = this.groupRows(measureCol);
    const targetGrouped = this.bulletTargetColumn ? this.groupRows(this.bulletTargetColumn) : null;
    const categories: string[] = [];
    const data: Array<{ y: number; target?: number }> = [];
    for (const [k, g] of grouped) {
      categories.push(k);
      const y = this.aggregateValue(g, !!this.yAggColumn);
      const targetGroup = targetGrouped?.get(k);
      const target = targetGroup ? targetGroup.nums.reduce((a, b) => a + b, 0) : undefined;
      data.push(target !== undefined ? { y, target } : { y });
    }
    return {
      chart: {
        type: 'bullet' as any, inverted: true, backgroundColor: 'transparent', height: 320,
        scrollablePlotArea: { minHeight: Math.max(320, categories.length * 28 + 80) },
      },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories, title: { text: this.xAxisTitle || undefined } },
      yAxis: { title: { text: this.yAxisTitle || undefined }, gridLineWidth: 0 },
      legend: { enabled: false },
      plotOptions: { series: { pointPadding: 0.25, borderWidth: 0, color: chartFallbackColor(`${measureCol || 'Value'}:`, 0), targetOptions: { width: '200%' } } } as any,
      series: [{ type: 'bullet' as any, name: measureCol || 'Value', data }],
    };
  }

  /** Reuses X-axis category + Y-axis value (aggregated), adds a required Size column (aggregated) per category. */
  private buildBubblePreviewOptions(): Highcharts.Options {
    const measureCol = this.yAggColumn || this.yAxis;
    const grouped = this.groupRows(measureCol);
    const sizeGrouped = this.bubbleSizeColumn ? this.groupRows(this.bubbleSizeColumn) : null;
    const categories: string[] = [];
    const data: Array<{ x: number; y: number; z: number; name: string; color: string }> = [];
    let i = 0;
    for (const [k, g] of grouped) {
      categories.push(k);
      const y = g.nums.reduce((a, b) => a + b, 0);
      const sizeGroup = sizeGrouped?.get(k);
      const z = sizeGroup ? sizeGroup.nums.reduce((a, b) => a + b, 0) : 1;
      data.push({ x: i, y, z, name: k, color: chartFallbackColor(`${measureCol || 'Value'}:${k}`, i) });
      i++;
    }
    return {
      chart: { type: 'bubble', zoomType: 'xy', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories, title: { text: this.xAxisTitle || undefined } },
      yAxis: { title: { text: this.yAxisTitle || undefined } },
      legend: { enabled: this.showLegend },
      plotOptions: { bubble: { minSize: 8, maxSize: 50 } },
      series: [{ type: 'bubble' as const, name: measureCol || 'Value', data }],
    };
  }

  /** Grid of X-axis category × Y-category, colored by aggregated Y-axis value. */
  private buildHeatmapPreviewOptions(): Highcharts.Options {
    const valueCol = this.yAggColumn || this.yAxis;
    const xCats = [...new Set(this.previewRows.map(r => safeString(r[this.xAxis])))];
    const yCats = [...new Set(this.previewRows.map(r => safeString(r[this.heatmapYColumn])))];
    const cellMap = new Map<string, number>();
    for (const row of this.previewRows) {
      const xi = xCats.indexOf(safeString(row[this.xAxis]));
      const yi = yCats.indexOf(safeString(row[this.heatmapYColumn]));
      if (xi < 0 || yi < 0) continue;
      const key = `${xi}-${yi}`;
      cellMap.set(key, (cellMap.get(key) ?? 0) + (Number(row[valueCol]) || 0));
    }
    const data = [...cellMap.entries()].map(([key, v]) => {
      const [xi, yi] = key.split('-').map(Number);
      return [xi, yi, v] as [number, number, number];
    });
    return {
      chart: { type: 'heatmap', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories: xCats, title: { text: this.xAxisTitle || undefined } },
      yAxis: { categories: yCats, title: { text: undefined }, reversed: true },
      colorAxis: { minColor: '#EAF2FF', maxColor: '#2563EB' } as any,
      legend: { enabled: this.showLegend, align: 'right' as const, layout: 'vertical' as const },
      series: [{ type: 'heatmap' as const, name: valueCol || 'Value', data, dataLabels: { enabled: true } }],
    };
  }

  /** From/To/Weight relationship — no xAxis/yAxis at all. */
  private buildSankeyPreviewOptions(): Highcharts.Options {
    const from = this.sankeyFromColumn, to = this.sankeyToColumn, weightCol = this.sankeyWeightColumn;
    const weightMap = new Map<string, number>();
    for (const row of this.previewRows) {
      const f = safeString(row[from]), t = safeString(row[to]);
      if (!f || !t) continue;
      const key = `${f}\u2192${t}`;
      weightMap.set(key, (weightMap.get(key) ?? 0) + (Number(row[weightCol]) || 0));
    }
    const data = [...weightMap.entries()].map(([key, weight]) => {
      const [f, t] = key.split('\u2192');
      return [f, t, weight] as [string, string, number];
    });
    const nodeCount = new Set(data.flatMap(([fromNode, toNode]) => [fromNode, toNode])).size;
    return {
      chart: {
        type: 'sankey', backgroundColor: 'transparent', height: 320,
        scrollablePlotArea: { minHeight: Math.max(320, nodeCount * 24 + 40) },
      },
      title: { text: undefined },
      credits: { enabled: false },
      series: [{ type: 'sankey' as const, name: weightCol || 'Flow', keys: ['from', 'to', 'weight'], minLinkWidth: 1, data } as any],
    };
  }

  /** Date + Label columns — no xAxis/yAxis at all. */
  private buildTimelinePreviewOptions(): Highcharts.Options {
    const dateCol = this.timelineDateColumn, labelCol = this.timelineLabelColumn;
    const data = this.previewRows.map(r => ({ name: safeString(r[labelCol]), label: safeString(r[dateCol]) }));
    return {
      chart: { type: 'timeline' as any, backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { visible: false },
      yAxis: { visible: false },
      legend: { enabled: false },
      series: [{ type: 'timeline' as any, name: labelCol || 'Timeline', data }],
    };
  }

  private aggregateValue(g: { count: number; colCount: number; set: Set<string>; nums: number[] }, hasCol: boolean): number {
    if (this.yAxis === 'Count (F)')            return hasCol ? g.colCount : g.count;
    if (this.yAxis === 'Count Distinct (F)')   return hasCol ? g.set.size  : g.count;
    if (this.yAxis === 'Sum (F)')              return g.nums.reduce((a, b) => a + b, 0);
    if (this.yAxis === 'Average (F)')          return g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0;
    if (this.yAxis === 'Min (F)')              return g.nums.length ? Math.min(...g.nums) : 0;
    if (this.yAxis === 'Max (F)')              return g.nums.length ? Math.max(...g.nums) : 0;
    return g.nums.reduce((a, b) => a + b, 0);
  }

  private applyLimit(cats: string[], vals: number[]): { categories: string[]; values: number[] } {
    // Only rank/trim when there are more categories than the limit; otherwise keep natural order.
    if (this.limitCategory === 'top' && (this.topN ?? 0) > 0 && cats.length > this.topN) {
      const n = this.topN;
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => b.v - a.v);
      const top = pairs.slice(0, n);
      if (this.groupRestAsOthers && pairs.length > n) { top.push({ c: 'Others', v: pairs.slice(n).reduce((s, x) => s + x.v, 0) }); }
      return { categories: top.map(x => x.c), values: top.map(x => x.v) };
    }
    if (this.limitCategory === 'bottom' && this.bottomN > 0 && cats.length > this.bottomN) {
      const n = this.bottomN;
      const pairs = cats.map((c, i) => ({ c, v: vals[i] })).sort((a, b) => a.v - b.v);
      const bot = pairs.slice(0, n);
      if (this.groupRestAsOthers && pairs.length > n) { bot.push({ c: 'Others', v: pairs.slice(n).reduce((s, x) => s + x.v, 0) }); }
      return { categories: bot.map(x => x.c), values: bot.map(x => x.v) };
    }
    return { categories: cats, values: vals };
  }

  private groupRows(aggCol: string): Map<string, { count: number; colCount: number; set: Set<string>; nums: number[] }> {
    const grouped = new Map<string, { count: number; colCount: number; set: Set<string>; nums: number[] }>();
    for (const row of this.previewRows) {
      const rawKey = row[this.xAxis];
      const key = (rawKey !== null && rawKey !== undefined && typeof rawKey !== 'object')
        ? (rawKey as string | number | boolean).toString() : '(empty)';
      if (!grouped.has(key)) grouped.set(key, { count: 0, colCount: 0, set: new Set(), nums: [] });
      const g = grouped.get(key)!;
      g.count++;
      if (aggCol) {
        const raw = row[aggCol];
        if (raw !== null && raw !== undefined && raw !== '') { g.colCount++; g.set.add(String(raw)); }
        const v = Number(raw ?? 0);
        g.nums.push(Number.isNaN(v) ? 0 : v);
      }
    }
    return grouped;
  }

  private computeChartData(): { categories: string[]; values: number[] } {
    if (!this.tableRows.length || !this.xAxis) {
      return { categories: GROUP_LABELS, values: GROUP_VALUES };
    }
    if (!this.previewRows.length) return { categories: [], values: [] };
    const fn = this.yAxisFunctions.find(f => f.value === this.yAxis);
    // No operation chosen: plot the Y column's value per X (no aggregation); nothing if no column.
    if (!fn) {
      if (!this.yAggColumn) return { categories: [], values: [] };
      const rawGrouped = this.groupRows(this.yAggColumn);
      const rcats: string[] = [], rvals: number[] = [];
      for (const [k, g] of rawGrouped) { rcats.push(k); rvals.push(g.nums.length ? g.nums[0] : 0); }
      return this.applyLimit(rcats.slice(0, 100), rvals.slice(0, 100));
    }
    const aggCol = this.yAggColumn;
    if (fn.requiresColumn && !aggCol) return { categories: [], values: [] };

    const grouped = this.groupRows(aggCol);
    const cats: string[] = [], vals: number[] = [];
    for (const [k, g] of grouped) { cats.push(k); vals.push(this.aggregateValue(g, !!aggCol)); }
    return this.applyLimit(cats.slice(0, 100), vals.slice(0, 100));
  }

  private computeDaxChartData(): { categories: string[]; values: number[] } {
    if (!this.tableRows.length || !this.xAxis) return { categories: GROUP_LABELS, values: GROUP_VALUES };
    const rows = this.previewRows;
    if (!rows.length) return { categories: [], values: [] };
    const measure = this.selectedDaxMeasure;
    if (!measure?.expression.trim()) {
      this.daxExpressionError = 'Enter a DAX measure expression.';
      return { categories: [], values: [] };
    }
    const expression = this.parseDaxExpression(measure.expression);
    if (!expression) return { categories: [], values: [] };
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = safeString(row[this.xAxis]) || '(empty)';
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const cats: string[] = [];
    const vals: number[] = [];
    for (const [key, groupRows] of grouped) {
      cats.push(key);
      vals.push(evaluateDaxMeasure(measure, groupRows, this.yAxisColumns));
    }
    return this.applyLimit(cats.slice(0, 100), vals.slice(0, 100));
  }

  private buildDaxMultiSeriesPreview(chartType: any): { categories: string[]; series: Highcharts.SeriesOptionsType[] } {
    const rows = this.previewRows;
    const categories = [...new Set(rows.map(row => safeString(row[this.xAxis]) || '(empty)'))];
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = safeString(row[this.xAxis]) || '(empty)';
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const series: Highcharts.SeriesOptionsType[] = [];
    const selectedPreferenceColumn = this.daxDisplayPreference.startsWith('selected:')
      ? this.daxDisplayPreference.slice('selected:'.length)
      : '';
    const includeRawColumns = this.daxDisplayPreference !== 'result';
    let columns: string[] = [];
    if (this.daxDisplayPreference === 'all') columns = this.selectedDaxColumns;
    else if (selectedPreferenceColumn) columns = [selectedPreferenceColumn];
    if (includeRawColumns) {
      for (const [i, column] of columns.entries()) {
        series.push({
          type: (this.selectedChartType === 'stacked' ? 'column' : chartType) as any,
          name: column,
          data: categories.map(category => {
            const values = (grouped.get(category) ?? []).map(row => Number(row[column])).filter(Number.isFinite);
            return values.reduce((sum, value) => sum + value, 0);
          }),
          color: getSeriesColorByName(column, i),
        });
      }
    }
    const measureOffset = series.length;
    for (const [i, measure] of this.selectedDaxSeriesMeasures.entries()) {
      const expression = this.parseDaxExpression(measure.expression);
      if (!expression) continue;
      const totalValue = evaluateDaxMeasure(measure, rows, this.yAxisColumns);
      const isRowScope = (measure.evaluationScope ?? 'column') === 'row';
      const measureName = measure.name || `Measure ${i + 1}`;
      series.push({
        type: (this.selectedChartType === 'stacked' ? 'column' : chartType) as any,
        name: measureName,
        data: categories.map(category => isRowScope ? evaluateDaxMeasure(measure, grouped.get(category) ?? [], this.yAxisColumns) : totalValue),
        color: getSeriesColorByName(measureName, measureOffset + i),
      });
    }
    return { categories, series };
  }

  private parseDaxExpression(expression: string): DaxAstNode | null {
    const { ast, error } = parseDaxExpression(expression);
    // Only report errors here: preview renders must not clear a validation message the editor set.
    if (error) this.daxExpressionError = error;
    return ast;
  }

  discard(): void {
    this.discardDraftOnExit = true;
    this.clearEditorDraft();
    this.router.navigateByUrl(this.returnUrl);
  }

  readonly isSaving = signal(false);
  readonly saveError = signal('');
  readonly saveSuccess = signal('');
  private saveSuccessTimeout: ReturnType<typeof setTimeout> | null = null;

  private static readonly MISSING_SOURCE_ERROR = 'Please select a source first.';

  /** The save-time "no source" complaint is stale the moment a source is picked. */
  private clearMissingSourceError(): void {
    if (this.selectedChartModelId && this.saveError() === ChartBuilderComponent.MISSING_SOURCE_ERROR) this.saveError.set('');
  }

  /** Shows a transient success toast on the builder page (used when the user saves without navigating away). */
  private showSaveSuccess(message: string): void {
    this.saveSuccess.set(message);
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
    this.saveSuccessTimeout = setTimeout(() => { this.saveSuccess.set(''); this.cdr.markForCheck(); }, 4000);
  }
  readonly descriptionValidationError = signal('');
  readonly isLoadingChart = signal(false);
  editId: number | null = null;

  get isEditMode(): boolean { return !!this.editId; }

  /** True when the measure being edited differs from what is stored for it. */
  private get isDaxDraftDirty(): boolean {
    const stored = this.daxModel.measures.find(m => m.id === this.daxMeasureDraft.id);
    const draft = this.daxMeasureDraft;
    const hasContent = !!(draft.name?.trim() || draft.expression?.trim());
    if (!stored) return hasContent;
    return (stored.name ?? '') !== (draft.name ?? '') || (stored.expression ?? '') !== (draft.expression ?? '')
      || (stored.evaluationScope ?? '') !== (draft.evaluationScope ?? '') || stored.includeInSeries !== draft.includeInSeries;
  }

  /**
   * Folds an edited, valid measure into the model before the chart is saved. The DAX on/off
   * switch is left as the user set it (it used to be forced on, so DAX could never be turned off),
   * and an invalid draft is never saved.
   */
  private syncDaxModelBeforeSave(): void {
    const draft = { ...this.daxMeasureDraft };
    if (this.daxModel.enabled && this.isDaxDraftDirty && this.validateDaxDraft()) {
      const activeMeasureId = this.daxModel.selectedMeasureId;
      const measures = this.daxModel.measures.map(measure =>
        measure.id === activeMeasureId ? { ...draft, id: activeMeasureId, name: draft.name.trim(), expression: draft.expression.trim() } : measure);
      this.daxModel = { ...this.daxModel, selectedMeasureId: activeMeasureId, measures };
    }
    this.daxModel = {
      ...this.daxModel,
      selectedColumns: [...this.selectedDaxColumns],
      selectedOperation: this.selectedDaxSnippet,
      displayPreference: this.daxDisplayPreference,
    };
  }

  /**
   * The category the widget will be filed under, or null when none is resolvable.
   *
   * There used to be a hardcoded `|| 2` fallback here. Category 2 does not exist in every
   * tenant, so when the category list failed to load the save was sent with an invalid FK and
   * died with an opaque "references a record that does not exist" database error. Blocking the
   * save with a clear message is both safer and diagnosable.
   */
  private get resolvedCategoryId(): number | null {
    return this.selectedCategoryId > 0 ? this.selectedCategoryId : null;
  }

  private buildDesignJson(): string {
    this.syncDaxModelBeforeSave();
    const hasDax = this.daxModel.enabled || this.selectedDaxColumns.length > 0 || !!this.selectedDaxSnippet || this.daxModel.measures.some(m => !!m.expression?.trim());
    const colorAssignments = this.buildColorAssignments();
    return JSON.stringify({
      chartType: this.selectedChartType, xAxis: this.xAxis, yAxis: this.yAxis, yAggColumn: this.yAggColumn,
      xAxisTitle: this.xAxisTitle, yAxisTitle: this.yAxisTitle, showLegend: this.showLegend,
      includeDataTable: this.includeDataTable, showAxisTitle: this.showAxisTitle, showDataLabels: this.showDataLabels, showStackTotal: this.showStackTotal, limitCategory: this.limitCategory,
      topN: this.topN, bottomN: this.bottomN, groupRestAsOthers: this.groupRestAsOthers,
      source: this.selectedChartModelId,
      sourceType: this.dataSourceMode === 'view' ? 'View' : (this.selectedChartModel?.modelType ?? 'Table'),
      dataSourceMode: this.dataSourceMode,
      fromDate: this.dataSourceMode === 'import' ? this.fromDate : undefined,
      toDate: this.dataSourceMode === 'import' ? this.toDate : undefined,
      quickRange: this.dataSourceMode === 'import' ? this.quickRange : undefined,
      viewId: this.dataSourceMode === 'view' ? this.selectedView?.id
            : this.dataSourceMode === 'import' ? this.selectedImportDataset?.id
            : undefined,
      interactiveFilters: this.interactiveFilters,
      conditionalFilters: this.conditionalFilters.length > 0 ? this.conditionalFilters : undefined,
      parameterFilters: this.parameterFilters.length > 0
        ? this.parameterFilters.map(rule => ({ ...rule, sourceColumns: getRuleSourceColumns(rule) }))
        : undefined,
      multiYColumns: this.multiYColumns.length > 0 ? this.multiYColumns : undefined,
      ...this.buildChartTypeExtras(this.selectedChartType),
      attachedTileIds: this.attachedTileIds.length > 0 ? this.attachedTileIds : undefined,
      drillDownViewId: this.drillDownViewId ?? undefined,
      trendMode: this.isTrendChart ? this.trendMode : undefined,
      colorRules: this.colorRules.length > 0 ? this.colorRules : undefined,
      colorOverrides: Object.keys(this.colorOverrides).length > 0 ? this.colorOverrides : undefined,
      colorAssignments: Object.keys(colorAssignments).length > 0 ? colorAssignments : undefined,
      daxModel: hasDax ? this.cloneDaxModel(this.daxModel) : undefined,
    });
  }

  private buildColorAssignments(): Record<string, string> {
    if (this.usesSemanticSeriesColors) return {};

    const assignments: Record<string, string> = {};
    const categories = this.previewData.categories;
    const series = ((this.chartPreviewOptions?.series ?? []) as any[]).filter(item => Array.isArray(item.data));
    const seriesNames = series.length > 0
      ? series.map(item => String(item.name ?? this.getBasePreviewSeriesName()))
      : [this.getBasePreviewSeriesName()];
    for (const seriesName of seriesNames) {
      categories.forEach((category, index) => {
        const key = `${seriesName}:${category}`;
        const renderedSeries = series.find(item => String(item.name ?? this.getBasePreviewSeriesName()) === seriesName);
        const renderedPoint = renderedSeries?.data?.[index] as any;
        const renderedColor = renderedPoint && typeof renderedPoint === 'object' ? renderedPoint.color : undefined;
        assignments[key] = typeof renderedColor === 'string' && renderedColor.trim()
          ? renderedColor
          : this.previewFallbackColor(key, index);
      });
    }
    return assignments;
  }

  private buildChartTypeExtras(ct: string | null): Record<string, unknown> {
    if (isAdvancedChart(ct)) return { advancedConfig: structuredClone(this.advancedConfig) };
    if (ct === 'table') {
      return {
        tableRowColors: this.tableRowColors.length > 0 ? this.tableRowColors : undefined,
        tableHeaderColor: this.tableHeaderColor || undefined,
        tableHeaderTextColor: this.tableHeaderTextColor || undefined,
        tableRowTextColors: this.tableRowTextColors.length > 0 ? this.tableRowTextColors : undefined,
      };
    }
    if (ct === 'combo' || ct === 'multiline') {
      return {
        comboLineColumns: this.comboLineColumns.length > 0 ? this.comboLineColumns : undefined,
        yAxis2Title: this.yAxis2Title || undefined,
      };
    }
    if (ct === 'gauge') {
      return { gaugeMin: this.gaugeMin, gaugeMax: this.gaugeMax };
    }
    if (ct === 'bullet') {
      return { bulletTargetColumn: this.bulletTargetColumn || undefined };
    }
    if (ct === 'bubble') {
      return { bubbleSizeColumn: this.bubbleSizeColumn || undefined };
    }
    if (ct === 'heatmap') {
      return { heatmapYColumn: this.heatmapYColumn || undefined };
    }
    if (ct === 'sankey') {
      return {
        sankeyFromColumn: this.sankeyFromColumn || undefined,
        sankeyToColumn: this.sankeyToColumn || undefined,
        sankeyWeightColumn: this.sankeyWeightColumn || undefined,
      };
    }
    if (ct === 'timeline') {
      return {
        timelineDateColumn: this.timelineDateColumn || undefined,
        timelineLabelColumn: this.timelineLabelColumn || undefined,
      };
    }
    return {};
  }

  private saveChart(closeAfterSave = false): void {
    if (this.isSaving()) return;
    // Block the placeholder label 'Chart Name' (and empty) from being saved as the actual name.
    const chartName = this.chartTitle.trim();
    if (!chartName || chartName === 'Chart Name') { this.saveError.set('Please enter a chart name.'); return; }
    if (isAdvancedChart(this.selectedChartType)) {
      try { validateAdvancedConfig(this.selectedChartType, this.advancedRows, this.advancedConfig); }
      catch (error) { this.saveError.set(error instanceof Error ? error.message : 'Invalid visual mapping.'); return; }
    }
    // Picking a source is the first step and auto-selects a chart type, so a missing library means no source yet.
    if (!this.selectedLibraryId) {
      this.saveError.set(this.selectedChartModelId ? 'Please select a chart type first.' : ChartBuilderComponent.MISSING_SOURCE_ERROR);
      return;
    }
    if (!this.chartDescription.trim()) { this.descriptionValidationError.set('Please enter a description.'); return; }
    this.descriptionValidationError.set('');
    const selectionError = getParameterSelectionError(this.parameterFilters);
    if (selectionError) {
      this.openSections.add(4);
      this.saveError.set(selectionError);
      return;
    }
    // An unsaved DAX measure with errors would otherwise be dropped (or saved broken) silently.
    if (this.daxModel.enabled && this.isDaxDraftDirty && !this.validateDaxDraft()) {
      this.saveError.set(`Fix the DAX measure before saving: ${this.daxMeasureFormError || this.daxExpressionError}`);
      return;
    }
    this.isSaving.set(true); this.saveError.set('');

    // Save state of current tab before collecting all
    this.syncDaxModelBeforeSave();
    this.saveCurrentTabState();

    // Collect all tabs to save
    const tabsToSave: { tabId: string; state: ChartTabState }[] = [];
    for (const tab of this.tabs) {
      const state = this.tabStates.get(tab.id);
      if (state?.selectedLibraryId) {
        tabsToSave.push({ tabId: tab.id, state });
      }
    }

    // If only active tab (no saved states yet or single tab), save current directly
    if (tabsToSave.length === 0) {
      tabsToSave.push({ tabId: this.activeTabId, state: this.tabStates.get(this.activeTabId)! });
    }

    const missingParameterTab = tabsToSave.map(tab => ({
      ...tab, error: getParameterSelectionError(tab.state.parameterFilters ?? []),
    })).find(tab => tab.error);
    if (missingParameterTab) {
      const label = this.tabs.find(tab => tab.id === missingParameterTab.tabId)?.label;
      this.isSaving.set(false);
      this.saveError.set(`${missingParameterTab.error}${label ? ` Check "${label}".` : ''}`);
      return;
    }

    let completed = 0;
    let hasError = false;
    let savedId: number | null = null;
    const totalTabs = tabsToSave.length;
    const closingTabId = this.activeTabId;

    for (const { tabId, state } of tabsToSave) {
      const hasDax = state.daxModel?.enabled || (state.daxModel?.selectedColumns?.length ?? 0) > 0 || !!state.daxModel?.selectedOperation || state.daxModel?.measures?.some(m => !!m.expression?.trim());
      const colorAssignments = this.buildColorAssignments();
      const designJson = JSON.stringify({
        chartType: state.selectedChartType, xAxis: state.xAxis, yAxis: state.yAxis, yAggColumn: state.yAggColumn,
        advancedConfig: isAdvancedChart(state.selectedChartType) ? state.advancedConfig : undefined,
        xAxisTitle: state.xAxisTitle, yAxisTitle: state.yAxisTitle, showLegend: state.showLegend,
        includeDataTable: state.includeDataTable, showAxisTitle: state.showAxisTitle, showDataLabels: state.showDataLabels, showStackTotal: state.showStackTotal, limitCategory: state.limitCategory,
        topN: state.topN, bottomN: state.bottomN, groupRestAsOthers: state.groupRestAsOthers,
        source: state.selectedChartModelId,
        sourceType: state.dataSourceMode === 'view' ? 'View'
          : state.dataSourceMode === 'import' ? 'Import'
          : (this.chartModels.find(m => m.id === state.selectedChartModelId)?.modelType ?? 'Table'),
        dataSourceMode: state.dataSourceMode,
        fromDate: state.dataSourceMode === 'import' ? this.fromDate : undefined,
        toDate: state.dataSourceMode === 'import' ? this.toDate : undefined,
        quickRange: state.dataSourceMode === 'import' ? this.quickRange : undefined,
        viewId: state.dataSourceMode === 'view' || state.dataSourceMode === 'import' ? state.viewId : undefined,
        interactiveFilters: state.interactiveFilters,
        conditionalFilters: state.conditionalFilters?.length ? state.conditionalFilters : undefined,
        parameterFilters: state.parameterFilters?.length
          ? state.parameterFilters.map(rule => ({ ...rule, sourceColumns: getRuleSourceColumns(rule) }))
          : undefined,
        multiYColumns: state.multiYColumns.length > 0 ? state.multiYColumns : undefined,
        tableRowColors: state.selectedChartType === 'table' && state.tableRowColors && state.tableRowColors.length > 0 ? state.tableRowColors : undefined,
        tableHeaderColor: state.selectedChartType === 'table' && state.tableHeaderColor ? state.tableHeaderColor : undefined,
        tableHeaderTextColor: state.selectedChartType === 'table' && state.tableHeaderTextColor ? state.tableHeaderTextColor : undefined,
        tableRowTextColors: state.selectedChartType === 'table' && state.tableRowTextColors && state.tableRowTextColors.length > 0 ? state.tableRowTextColors : undefined,
        comboLineColumns: (state.selectedChartType === 'combo' || state.selectedChartType === 'multiline') && state.comboLineColumns && state.comboLineColumns.length > 0 ? state.comboLineColumns : undefined,
        yAxis2Title: (state.selectedChartType === 'combo' || state.selectedChartType === 'multiline') && state.yAxis2Title ? state.yAxis2Title : undefined,
        bulletTargetColumn: state.selectedChartType === 'bullet' ? state.bulletTargetColumn : undefined,
        sankeyFromColumn: state.selectedChartType === 'sankey' ? state.sankeyFromColumn : undefined,
        sankeyToColumn: state.selectedChartType === 'sankey' ? state.sankeyToColumn : undefined,
        sankeyWeightColumn: state.selectedChartType === 'sankey' ? state.sankeyWeightColumn : undefined,
        timelineDateColumn: state.selectedChartType === 'timeline' ? state.timelineDateColumn : undefined,
        timelineLabelColumn: state.selectedChartType === 'timeline' ? state.timelineLabelColumn : undefined,
        attachedTileIds: state.attachedTileIds.length > 0 ? state.attachedTileIds : undefined,
        drillDownViewId: state.drillDownViewId ?? undefined,
        trendMode: state.selectedChartType !== null && TREND_CHART_TYPES.includes(state.selectedChartType) ? state.trendMode : undefined,
        colorRules: state.colorRules.length > 0 ? state.colorRules : undefined,
        colorOverrides: Object.keys(state.colorOverrides).length > 0 ? state.colorOverrides : undefined,
        colorAssignments: Object.keys(colorAssignments).length > 0 ? colorAssignments : undefined,
        daxModel: hasDax ? this.cloneDaxModel(state.daxModel) : undefined,
      });

      const sourceModel = this.chartModels.find(m => m.id === state.selectedChartModelId)
                       ?? this.importedChartModels.find(m => m.id === state.selectedChartModelId);
      const categoryId = state.selectedCategoryId > 0 ? state.selectedCategoryId : this.resolvedCategoryId;
      if (categoryId === null) { this.saveError.set(CATEGORY_REQUIRED_MESSAGE); this.isSaving.set(false); return; }

      const payload = {
        name: state.chartTitle, description: state.chartDescription, type: 'chart',
        libraryId: state.selectedLibraryId!,
        source: state.selectedChartModelId,
        sourceType: state.dataSourceMode === 'view' ? 'View'
          : state.dataSourceMode === 'import' ? 'Import'
          : (sourceModel?.modelType ?? 'Table'),
        sourceId: (state.dataSourceMode === 'view' || state.dataSourceMode === 'import') ? (state.viewId ?? null) : null,
        designJson,
        categoryId,
      };

      const existingId = this.savedChartIds.get(tabId);
      const request$ = existingId
        ? this.widgetService.updateWidget(existingId, payload)
        : this.widgetService.createWidget(payload);

      request$.subscribe({
        next: (saved) => {
          this.savedChartIds.set(tabId, saved.id);
          if (this.activeTabId === tabId) this.editId = saved.id;
          savedId = savedId ?? saved.id;
          completed++;
          if (completed === totalTabs) this.isSaving.set(false);
          if (completed === totalTabs && !hasError) {
            this.clearEditorDraft();
            this.savedDraftBaseline = JSON.stringify(this.createEditorDraft());
            // Drop the cached chart list routes so they reload and show the new/updated
            // chart on return, instead of reattaching the stale (pre-save) list instance.
            this.listRouteReuse.invalidate('wip-charts');
            this.listRouteReuse.invalidate('standard-charts');
            let msg: string;
            if (totalTabs > 1) msg = `${totalTabs} charts saved successfully.`;
            else if (existingId) msg = `'${state.chartTitle}' updated successfully.`;
            else msg = `'${state.chartTitle}' created successfully.`;
            if (closeAfterSave && savedId) {
              this.toastService.pending = msg;
              this.router.navigate(['/charts-tiles/view', this.savedChartIds.get(closingTabId) ?? savedId], { queryParams: { type: 'chart', from: 'wip' } });
            } else {
              // Staying on the builder — show the success toast here since no page navigation occurs.
              this.showSaveSuccess(msg);
            }
          }
        },
        error: (err: unknown) => {
          completed++;
          if (completed === totalTabs) this.isSaving.set(false);
          if (!hasError) {
            hasError = true;
            const msg = (err as any)?.error?.error ?? (err as any)?.message ?? 'Failed to save chart. Please try again.';
            this.saveError.set(msg);
            this.cdr.markForCheck();
          }
        },
      });
    }
  }

  saveAndClose(): void { this.saveChart(true); }
  saveAsDraft(): void { this.saveChart(false); }
  addChart():    void { this.saveChart(false); }

  // View-only: matched server-side to DECLARE @placeholders; Table sources would interpolate these as real columns.
  private globalHierarchyFilterPayload(): { sourceTable: string; sourceColumn: string; controlType: string; value: string; label?: string }[] {
    return ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']
      .map(key => ({ key, value: this.filterValues[key] }))
      .filter(f => f.value && f.value !== 'All')
      .map(f => ({ sourceTable: f.key, sourceColumn: f.key, controlType: 'Dropdown', value: f.value, label: f.key }));
  }

  private lockedInteractiveFilterPayload(): { sourceTable: string; sourceColumn: string; controlType: string; value: string; values?: string[]; label?: string }[] {
    return this.interactiveFilters
      .filter(filter => filter.locked && filter.sourceColumn && (filter.lockedValue || filter.lockedValues?.length)
        && !this.interactiveFilterPlaceholderError(filter) && !this.isLocalRenamedFilter(filter))
      .map(filter => ({
        sourceTable: filter.sourceTable || this.selectedChartModelId,
        sourceColumn: filter.sourceColumn,
        controlType: filter.controlType,
        value: filter.controlType === 'MultiSelect' ? (filter.lockedValues ?? []).join(',') : (filter.lockedValue ?? ''),
        values: filter.controlType === 'MultiSelect' ? [...(filter.lockedValues ?? [])] : undefined,
        label: filter.label,
      }));
  }

  private loadColumnsForSource(source: { name: string; sourceType: string }, preserveAxes?: { xAxis: string; yAxis: string; yAggColumn: string }): void {
    this.sourceError = '';
    // Without this, the table preview's *ngIf="!sourceLoading" guard stays open while this
    // fetch (e.g. on Edit page load) is in flight, briefly rendering the "Row 1, Row 2…" sample.
    this.sourceLoading = true;
    const requestVersion = ++this.sourceLoadVersion;
    // Imported files aren't resolvable as a real SQL table/view, so they bypass the
    // cross-table filtered endpoint and go straight to the simple table-data fetch.
    const data$ = source.sourceType === 'Import'
      ? this.widgetService.getTableData(source.name, source.sourceType)
      : this.widgetService.getFilteredChartData({
          chartSource: source.name,
          chartSourceType: source.sourceType,
          viewId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null) : null,
          filters: [...this.lockedInteractiveFilterPayload(), ...(this.dataSourceMode === 'view' ? this.globalHierarchyFilterPayload() : [])],
          fromDate: this.fromDate || undefined,
          toDate: this.toDate || undefined,
          mode: this.isTrendChart ? this.trendMode : undefined,
        });
    data$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
      if (requestVersion !== this.sourceLoadVersion || this.selectedChartModelId !== source.name) return;
        this.sourceLoading = false;
        if (res?.columns?.length) {
          this.rawLoadedColumns = res.columns;
          this.rawLoadedRows = res.rows ?? [];
          this.applyParameterDrivenTransformations();
          // When restoring a saved chart, keep the saved axes; otherwise default to first column.
          // Use ?? (not ||) so a deliberately blank Operation ('' = "None") isn't forced back to Count (F).
          if (preserveAxes) {
            this.xAxis = preserveAxes.xAxis || (res.columns[0] ?? '');
            this.yAxis = preserveAxes.yAxis ?? 'Count (F)';
            this.yAggColumn = preserveAxes.yAggColumn ?? '';
          } else if (!this.applyPendingAiPreset(res.columns)) {
            this.xAxis = res.columns[0] ?? ''; this.yAxis = 'Count (F)';
            // Table charts default to all columns selected as series.
            if (this.selectedChartType === 'table') this.multiYColumns = [...res.columns];
            if (this.isAdvancedType) this.applyDefaultMapping();
          }
          if (this.selectedChartType) this.applyPreviewFilters(); else this.chartPreviewOptions = null;
          this.cdr.markForCheck();
        } else {
          this.rawLoadedRows = [];
          this.rawLoadedColumns = [];
          this.tableRows = [];
          this.crossTableFilterRows = null;
          this.xAxisOptions = [];
          this.yAxisColumns = [];
          this.refreshPreview();
          this.cdr.markForCheck();
        }
      },
      error: () => {
        if (requestVersion !== this.sourceLoadVersion) return;
        this.rawLoadedRows = [];
        this.tableRows = [];
        this.crossTableFilterRows = null;
        this.sourceLoading = false;
        this.sourceError = 'Unable to load the selected source. Check the source, filters, and connection.';
        this.refreshPreview();
        this.cdr.markForCheck();
      },
    });
  }

  private loadSavedChart(id: number): void {
    this.widgetService.getWidgetById(id).subscribe({
      next: (widget) => {
        if (!widget) { this.isLoadingChart.set(false); return; }
        this.chartTitle = widget.name; this.chartDescription = widget.description ?? ''; this.selectedLibraryId = widget.libraryId ?? null;
        this.selectedCategoryId = widget.categoryId ?? 0;
        const matchedCat = this.apiCategories.find(c => c.categoryId === widget.categoryId);
        if (matchedCat) this.category = matchedCat.categoryName;
        try {
          const d = JSON.parse(widget.designJson ?? '{}');
          // Legacy single-series charts stored the value column directly in yAxis (= Sum of it). Normalize once so all load paths use it.
          const seriesManaged = ['multiline', 'stacked', 'combo', 'grouped'].includes(d.chartType);
          if (d.yAxis && !seriesManaged && !this.yAxisFunctions.some(f => f.value === d.yAxis)) {
            d.yAggColumn = d.yAxis; d.yAxis = 'Sum (F)';
          }
          this.selectedChartType = d.chartType ?? null; this.xAxis = d.xAxis ?? ''; this.yAxis = d.yAxis ?? 'Count (F)';
          this.yAggColumn = d.yAggColumn ?? ''; this.xAxisTitle = d.xAxisTitle ?? ''; this.yAxisTitle = d.yAxisTitle ?? '';
          this.showLegend = d.showLegend ?? true; this.includeDataTable = d.includeDataTable ?? false;
          this.showAxisTitle = d.showAxisTitle ?? false; this.showDataLabels = d.showDataLabels ?? true; this.showStackTotal = d.showStackTotal ?? true; this.limitCategory = d.limitCategory ?? 'top';
          this.axisTitleAutoApplied = false;
          this.topN = d.topN ?? 100; this.bottomN = d.bottomN ?? 0; this.groupRestAsOthers = d.groupRestAsOthers ?? false;
          this.interactiveFilters = d.interactiveFilters ?? [];
          this.syncInteractiveFilterSelections();
          this.conditionalFilters = (d.conditionalFilters ?? []).map((f: ConditionalFilter) => ({
            ...f,
            operator: f.operator || 'equals',
            valueText: f.valueText ?? '',
            mode: f.mode || 'Include',
            hidden: f.hidden ?? true,
            values: [...(f.values ?? [])],
          }));
          this.syncConditionalFilterSelections();
          this.parameterFilters = getSavedParameterFilters(d).map(r => ({
            ...r,
            sourceColumns: getRuleSourceColumns(r),
          }));
          this.syncParameterFilterIds();
          this.multiYColumns = d.multiYColumns ?? [];
          this.tableRowColors = d.tableRowColors ?? [];
          this.tableHeaderColor = d.tableHeaderColor ?? '';
          this.tableHeaderTextColor = d.tableHeaderTextColor ?? '';
          this.tableRowTextColors = d.tableRowTextColors ?? [];
          this.colorRules = (d.colorRules ?? []).map((rule: ColorRule) => ({ ...rule }));
          this.nextColorRuleId = this.colorRules.reduce((max, rule) => Math.max(max, rule.id + 1), 1);
          this.comboLineColumns = d.comboLineColumns ?? [];
          this.yAxis2Title = d.yAxis2Title ?? '';
          this.gaugeMin = d.gaugeMin ?? 0;
          this.gaugeMax = d.gaugeMax ?? 100;
          this.bulletTargetColumn = d.bulletTargetColumn ?? '';
          this.bubbleSizeColumn = d.bubbleSizeColumn ?? '';
          this.heatmapYColumn = d.heatmapYColumn ?? '';
          this.sankeyFromColumn = d.sankeyFromColumn ?? '';
          this.sankeyToColumn = d.sankeyToColumn ?? '';
          this.sankeyWeightColumn = d.sankeyWeightColumn ?? '';
          this.timelineDateColumn = d.timelineDateColumn ?? '';
          this.timelineLabelColumn = d.timelineLabelColumn ?? '';
          this.advancedConfig = readAdvancedConfig(d.advancedConfig);
          this.trendMode = d.trendMode ?? 'monthly';
          this.daxModel = this.cloneDaxModel(d.daxModel as DaxModelConfig | undefined);
          this.syncDaxSelectionFromModel();
          this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
          this.daxExpressionError = '';
          this.attachedTileIds = d.attachedTileIds ?? [];
          // Load drill down view
          if (d.drillDownViewId) {
            this.drillDownViewId = d.drillDownViewId;
            this.commonApi.getDatabaseViews('view').subscribe({
              next: (views) => {
                this.drillDownViews = views;
                const match = views.find(v => v.id === d.drillDownViewId);
                if (match) this.drillDownViewName = match.viewName;
                this.cdr.markForCheck();
              },
            });
          }
          // Load tile previews for attached tiles (fetch directly — availableTiles list may not have loaded yet)
          for (const tId of this.attachedTileIds) {
            this.widgetService.getWidgetById(tId).subscribe({
              next: (t) => this.loadTilePreview(t),
              error: () => {},
            });
          }
          // Fall back to the widget's own Source/SourceType columns (always populated on create/copy)
          // when the saved DesignJson blob doesn't carry a "source" key — e.g. an older standard
          // chart whose DesignJson predates this field; otherwise Copy to Draft → Edit shows no source.
          const source = d.source ?? widget.source ?? ''; const sourceType = d.sourceType ?? widget.sourceType ?? 'Table';
          this.dataSourceMode = d.dataSourceMode ?? (sourceType.toLowerCase() === 'view' ? 'view' : 'table');
          if (sourceType.toLowerCase() === 'import' || this.dataSourceMode === 'import') {
            if (typeof d.fromDate === 'string') this.fromDate = d.fromDate;
            if (typeof d.toDate === 'string') this.toDate = d.toDate;
            if (typeof d.quickRange === 'string') this.quickRange = d.quickRange;
          }
          const configuredViewId = Number(d.viewId);
          const widgetViewId = Number(widget.sourceId);
          const viewId = this.dataSourceMode === 'view' && configuredViewId > 0
            ? configuredViewId
            : widgetViewId > 0 ? widgetViewId : configuredViewId > 0 ? configuredViewId : undefined;
          if (source) {
            this.selectedChartModelId = source;
            if (sourceType.toLowerCase() === 'import') this.loadImportedDatasets();
            if (this.dataSourceMode === 'view' && viewId) {
              // Load the pickable 'view'-type list for the source-switcher UI.
              this.commonApi.getDatabaseViews('view').subscribe({
                next: (views) => {
                  this.availableViews = views;
                  const matchedView = views.find(v => v.id === viewId) ?? views.find(v => v.viewName === source);
                  if (matchedView) {
                    this.hydrateViewSourcePreview(source, matchedView.id, d);
                  } else {
                    // Not in the 'view'-type list — the chart's source may be a CTE/component
                    // view, so resolve it directly by ID (mirrors the chart view page's lookup)
                    // instead of leaving the preview empty.
                    this.commonApi.getDatabaseViewById(viewId).subscribe({
                      next: (view) => {
                        this.availableViews = [...this.availableViews, view as unknown as DatabaseViewListItem];
                        this.hydrateViewSourcePreview(source, view.id, d);
                      },
                      error: () => {},
                    });
                  }
                  this.cdr.markForCheck();
                },
                error: () => {
                  this.commonApi.getDatabaseViewById(viewId).subscribe({
                    next: (view) => {
                      this.availableViews = [view as unknown as DatabaseViewListItem];
                      this.hydrateViewSourcePreview(source, view.id, d);
                    },
                    error: () => {},
                  });
                },
              });
            } else {
              this.loadColumnsForSource({ name: source, sourceType }, {
                xAxis: d.xAxis ?? '',
                yAxis: d.yAxis ?? 'Count (F)',
                yAggColumn: d.yAggColumn ?? '',
              });
            }
          }
        } catch { /* ignore */ }
        this.isLoadingChart.set(false);
        this.draftReady = true;
        this.savedDraftBaseline = JSON.stringify(this.createEditorDraft());
        this.cdr.markForCheck();
      },
      error: () => { this.isLoadingChart.set(false); },
    });
  }

  selectYAxis(option: string): void {
    this.pushUndo();
    this.yAxis = option;
    this.showYAggDropdown = false;
    this.yAggSearch = '';
    // Operation changed — a non-numeric Value is fine for Count/Count Distinct but not for math ops.
    this.updateYAxisColumnError();
    this.refreshPreview();
  }

  selectYAggColumn(col: string): void {
    this.pushUndo();
    this.yAggColumn = col;
    this.yAxisOpen = false; this.showYAggDropdown = false;
    this.yAggSearch = ''; this.yAxisSearch = '';
    this.updateYAxisColumnError();
    this.cdr.markForCheck(); this.refreshPreview();
  }

  toggleDaxModel(): void {
    this.pushUndo();
    this.daxModel = { ...this.daxModel, enabled: !this.daxModel.enabled };
    if (this.daxModel.enabled && !this.daxModel.measures.length) {
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { schemaVersion: 1, enabled: true, selectedMeasureId: measure.id, measures: [measure] };
    }
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  // --- DAX Model section tabs (dummy "Saved Models" catalog; "Create New" reuses the existing editor below) ---
  setDaxTab(tab: 'saved' | 'create'): void {
    this.daxActiveTab = tab;
    this.cdr.markForCheck();
  }

  get filteredDaxSavedModels(): DaxSavedModelCard[] {
    const query = this.daxSavedModelsSearch.trim().toLowerCase();
    const addedIds = new Set(this.daxModel.measures
      .filter(measure => measure.savedModelId != null)
      .map(measure => String(measure.savedModelId)));
    return this.daxSavedModelsCatalog.filter(model =>
      !addedIds.has(model.id) && model.name.toLowerCase().includes(query));
  }

  isDaxSavedModelSelected(id: string): boolean {
    return this.daxSavedModelSelectedIds.has(id);
  }

  toggleDaxSavedModelSelection(id: string): void {
    const next = new Set(this.daxSavedModelSelectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.daxSavedModelSelectedIds = next;
    this.cdr.markForCheck();
  }

  get daxSavedModelsAllSelected(): boolean {
    return this.filteredDaxSavedModels.length > 0
      && this.filteredDaxSavedModels.every(model => this.daxSavedModelSelectedIds.has(model.id));
  }

  toggleSelectAllDaxSavedModels(): void {
    const next = new Set(this.daxSavedModelSelectedIds);
    if (this.daxSavedModelsAllSelected) {
      this.filteredDaxSavedModels.forEach(model => next.delete(model.id));
    } else {
      this.filteredDaxSavedModels.forEach(model => next.add(model.id));
    }
    this.daxSavedModelSelectedIds = next;
    this.cdr.markForCheck();
  }

  get daxSavedModelsSelectedCount(): number {
    return this.daxSavedModelSelectedIds.size;
  }

  /** Loads the Active saved models (one page of up to 100, newest first). */
  private loadSavedDaxModels(): void {
    this.daxSavedModelsLoading = true;
    this.daxModelService.list({ status: 'Active', page: 1, pageSize: 100 }).subscribe({
      next: page => {
        this.daxSavedModelsById.clear();
        page.items.forEach(m => this.daxSavedModelsById.set(String(m.id), m));
        this.daxSavedModelsCatalog = page.items.map(m => toSavedModelCard(m));
        this.daxSavedModelsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.daxSavedModelsCatalog = [];
        this.daxSavedModelsMessage = 'Could not load saved DAX models.';
        this.daxSavedModelsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** The chart's measures that came from saved models, shown under "Added to this chart". */
  get daxAddedToChart(): DaxSavedModelCard[] {
    return this.daxModel.measures
      .filter(m => m.savedModelId != null)
      .map(m => ({
        id: m.id,
        name: m.name,
        subtitle: savedModelSubtitle(m.evaluationScope === 'row' ? 'Row' : 'Column', m.operation, m.columns?.length ?? 0),
        tags: m.columns ?? [],
        expression: m.expression,
      }));
  }

  /**
   * Adds each selected model as a real DAX measure on this chart. A model is skipped when it is
   * already on the chart or its expression does not fit this chart's columns.
   */
  addSelectedDaxSavedModelsToChart(): void {
    if (!this.daxSavedModelsSelectedCount) return;
    if (!this.yAxisColumns.length) {
      this.daxSavedModelsMessage = 'Choose a data source first: saved models are checked against its columns.';
      this.cdr.markForCheck();
      return;
    }
    const onChart = new Set(this.daxModel.measures.map(m => m.savedModelId).filter(id => id != null));
    const names = new Set(this.daxModel.measures.map(m => m.name.trim().toLowerCase()).filter(Boolean));
    const added: DaxMeasureConfig[] = [];
    const skipped: string[] = [];
    for (const id of this.daxSavedModelSelectedIds) {
      const model = this.daxSavedModelsById.get(id);
      if (!model || onChart.has(model.id)) continue;
      const scope: DaxEvaluationScope = model.calculatedBy === 'Row' ? 'row' : 'column';
      const error = validateDaxExpression(model.expression, this.yAxisColumns, scope);
      if (error) { skipped.push(`${model.name}: ${error}`); continue; }
      let name = model.name.trim();
      for (let n = 2; names.has(name.toLowerCase()); n++) name = `${model.name.trim()} (${n})`;
      names.add(name.toLowerCase());
      added.push({
        id: `measure-${Date.now()}-${model.id}`, name, expression: model.expression, evaluationScope: scope,
        operation: restoreDaxOperation(model.operation, model.expression), columns: [...model.columns],
        format: /^\s*PERCENTAGE\s*\(/i.test(model.expression) ? 'percent' : 'number', includeInSeries: true,
        savedModelId: model.id,
      });
    }
    this.daxSavedModelSelectedIds = new Set();
    this.daxSavedModelsMessage = skipped.length ? `Not added: ${skipped.join(' ')}` : '';
    if (added.length) {
      this.pushUndo();
      // A blank starter measure is replaced rather than kept next to the added ones.
      const kept = this.daxModel.measures.filter(m => m.name.trim() || m.expression.trim());
      const measures = [...kept, ...added];
      const selectedMeasureId = kept.some(m => m.id === this.daxModel.selectedMeasureId) ? this.daxModel.selectedMeasureId : added[0].id;
      this.daxModel = { ...this.daxModel, enabled: true, selectedMeasureId, measures };
      this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? added[0]) };
      this.syncDaxSelectionFromModel();
      this.refreshPreview();
    }
    this.cdr.markForCheck();
  }

  removeDaxAddedToChartItem(id: string): void {
    this.removeDaxMeasure(id);
  }

  /** Dummy edit action for an "Added to this chart" card — jumps to the Create New tab. */
  editDaxAddedToChartItem(): void {
    this.setDaxTab('create');
  }

  updateDaxMeasureDraft(changes: Partial<DaxMeasureConfig>): void {
    this.daxMeasureDraft = { ...this.daxMeasureDraft, ...changes };
    if (changes.name?.trim()) this.daxMeasureFormError = '';
    // Validate as the user types so a bad expression is flagged before Save, not silently saved.
    const expression = this.daxMeasureDraft.expression?.trim() ?? '';
    this.daxExpressionError = expression ? validateDaxExpression(expression, this.yAxisColumns, this.daxMeasureDraft.evaluationScope) : '';
  }

  /** Name, Calculate By and expression checks shared by Save Measure and Add Measure. */
  private validateDaxDraft(): boolean {
    const { form, expression } = validateDaxMeasureDraft(this.daxMeasureDraft, this.daxModel.measures, this.yAxisColumns);
    this.daxMeasureFormError = form;
    this.daxExpressionError = expression;
    this.cdr.markForCheck();
    return !this.daxMeasureFormError && !this.daxExpressionError;
  }

  saveDaxMeasure(): void {
    if (!this.validateDaxDraft()) return;
    this.pushUndo();
    const id = this.daxModel.selectedMeasureId;
    if (!id) return;
    const activeMeasure = this.daxModel.measures.find(measure => measure.id === id);
    if (!activeMeasure) return;
    const measure: DaxMeasureConfig = {
      ...this.daxMeasureDraft,
      id,
      name: this.daxMeasureDraft.name.trim(),
      expression: this.daxMeasureDraft.expression.trim(),
    };
    const measures = this.daxModel.measures.map(m => m.id === id ? measure : m);
    this.daxModel = { ...this.daxModel, enabled: true, selectedMeasureId: id, measures };
    this.daxMeasureDraft = { ...measure };
    this.showDaxMeasureApplied();
    this.refreshPreview();
    this.cdr.markForCheck();
    this.persistDaxMeasureAsModel(measure);
  }

  /**
   * Saved measures also go to the DAX model library (Saved Models tab, Settings → DAX Model), so a
   * measure built once can be added to other charts. A measure that came from a saved model updates
   * that model; a new one creates it as Active. Imported datasets have no library source, so they
   * stay chart-only.
   */
  private persistDaxMeasureAsModel(measure: DaxMeasureConfig): void {
    if (this.dataSourceMode === 'import') return;
    const body: DaxModelSaveRequest = {
      name: measure.name,
      sourceType: this.dataSourceMode === 'view' ? 'View' : 'Table',
      dataSource: this.saveSetupSourceName,
      calculatedBy: measure.evaluationScope === 'row' ? 'Row' : 'Column',
      operation: measure.operation?.split('(')[0].trim() || null,
      columns: getDaxReferencedColumns(measure),
      expression: measure.expression,
      status: 'Active',
    };
    const request$ = measure.savedModelId != null ? this.daxModelService.update(measure.savedModelId, body) : this.daxModelService.create(body);
    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: saved => {
        // Link the chart measure to its library model so later saves update instead of duplicating.
        this.daxModel = { ...this.daxModel, measures: this.daxModel.measures.map(m => m.id === measure.id ? { ...m, savedModelId: saved.id } : m) };
        if (this.daxMeasureDraft.id === measure.id) this.daxMeasureDraft = { ...this.daxMeasureDraft, savedModelId: saved.id };
        this.loadSavedDaxModels();
        this.showDaxMeasureApplied('Measure saved to Saved Models');
      },
      error: err => {
        this.daxSavedModelsMessage = err?.error?.message ?? 'The measure was saved on this chart but could not be added to Saved Models.';
        this.cdr.markForCheck();
      },
    });
  }

  addDaxMeasure(): void {
    // A blank measure is already the "new" one - don't stack another blank beside it.
    const blank = !this.daxMeasureDraft.name?.trim() && !this.daxMeasureDraft.expression?.trim();
    if (blank) {
      this.daxMeasureFormError = 'Enter a measure name and expression, then click Add Measure.';
      this.cdr.markForCheck();
      this.revealDaxFormError();
      return;
    }
    // A started measure is kept only when it is complete and valid, never under an invented name.
    if (!this.validateDaxDraft()) {
      this.revealDaxFormError();
      return;
    }
    this.pushUndo();
    const currentMeasure: DaxMeasureConfig = {
      ...this.daxMeasureDraft,
      name: this.daxMeasureDraft.name.trim(),
      expression: this.daxMeasureDraft.expression.trim(),
    };
    const savedMeasures = this.daxModel.measures.some(measure => measure.id === currentMeasure.id)
      ? this.daxModel.measures.map(measure => measure.id === currentMeasure.id ? currentMeasure : measure)
      : [...this.daxModel.measures, currentMeasure];
    const newMeasure = this.createDefaultDaxMeasure();
    this.daxModel = {
      ...this.daxModel,
      enabled: true,
      selectedMeasureId: newMeasure.id,
      measures: [...savedMeasures, newMeasure],
    };
    this.daxMeasureDraft = { ...newMeasure };
    this.resetDaxOperationPickerState();
    this.daxExpressionError = '';
    this.showDaxMeasureApplied('Measure added. You can review it by clicking the tile above');
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  /** The form error sits by the name field, above the buttons; scroll it into view so the click visibly responds. */
  private revealDaxFormError(): void {
    setTimeout(() => this.daxFormErrorRef?.nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private resetDaxOperationPickerState(): void {
    this.selectedDaxSnippet = '';
    this.selectedDaxColumns = [];
    this.showDaxColumnDropdown = false;
    this.showDaxOperationDropdown = false;
    this.daxOperationSearch = '';
    this.showDaxNumeratorDropdown = false;
    this.showDaxDenominatorDropdown = false;
  }

  /** Briefly flashes a confirmation badge (with the given message) next to the measure actions. */
  private showDaxMeasureApplied(message = 'Measure Saved'): void {
    this.daxMeasureMessage = message;
    if (this.daxMeasureAppliedTimer) clearTimeout(this.daxMeasureAppliedTimer);
    this.daxMeasureApplied = false;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.daxMeasureApplied = true;
      this.cdr.markForCheck();
      this.daxMeasureAppliedTimer = setTimeout(() => {
        this.daxMeasureApplied = false;
        this.daxMeasureAppliedTimer = null;
        this.cdr.markForCheck();
      }, 2400);
    });
  }

  selectDaxMeasure(id: string): void {
    const measure = this.daxModel.measures.find(m => m.id === id);
    if (!measure || id === this.daxMeasureDraft.id) return;
    // Unsaved edits are kept when valid and block the switch when not, instead of being lost.
    if (this.isDaxDraftDirty && (this.daxMeasureDraft.name?.trim() || this.daxMeasureDraft.expression?.trim())) {
      if (!this.validateDaxDraft()) return;
      this.saveDaxMeasure();
    }
    this.pushUndo();
    this.daxModel = { ...this.daxModel, selectedMeasureId: id };
    this.daxMeasureDraft = { ...measure };
    this.resetDaxOperationPickerState();
    this.selectedDaxSnippet = restoreDaxOperation(measure.operation, measure.expression);
    this.selectedDaxColumns = [...(measure.columns ?? [])];
    this.daxExpressionError = '';
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  removeDaxMeasure(id: string): void {
    this.pushUndo();
    const deletedName = (id === this.daxMeasureDraft.id ? this.daxMeasureDraft.name?.trim() : '')
      || this.daxModel.measures.find(m => m.id === id)?.name?.trim();
    // An unnamed (blank) measure has no name to show.
    const deletedMessage = deletedName ? `The measure ${deletedName} is deleted` : 'Measure deleted';
    if (this.daxModel.measures.length <= 1) {
      // Only one measure exists - "delete" clears it back to a blank default instead of no-op.
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { ...this.daxModel, selectedMeasureId: measure.id, measures: [measure] };
      this.daxMeasureDraft = { ...measure };
      this.resetDaxOperationPickerState();
      this.daxExpressionError = '';
      this.showDaxMeasureApplied(deletedMessage);
      this.refreshPreview();
      this.cdr.markForCheck();
      return;
    }
    const measures = this.daxModel.measures.filter(m => m.id !== id);
    const selectedMeasureId = this.daxModel.selectedMeasureId === id ? measures[0].id : this.daxModel.selectedMeasureId;
    this.daxModel = { ...this.daxModel, selectedMeasureId, measures };
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? measures[0]) };
    // The pickers belonged to the deleted measure; show the remaining one's instead.
    this.resetDaxOperationPickerState();
    this.syncDaxSelectionFromModel();
    this.daxExpressionError = '';
    this.daxMeasureFormError = '';
    this.showDaxMeasureApplied(deletedMessage);
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  updateDaxColumns(columns: string[]): void {
    this.selectedDaxColumns = columns ?? [];
    this.daxModel = { ...this.daxModel, enabled: true, selectedColumns: [...this.selectedDaxColumns] };
    this.daxMeasureDraft = { ...this.daxMeasureDraft, columns: [...this.selectedDaxColumns] };
    if (this.daxDisplayPreference.startsWith('selected:')) {
      const selectedColumn = this.daxDisplayPreference.slice('selected:'.length);
      if (!this.selectedDaxColumns.includes(selectedColumn)) this.daxModel = { ...this.daxModel, displayPreference: 'result' };
    }
    this.applyDaxSelectedOperation();
    this.refreshPreview();
  }

  toggleDaxColumn(column: string): void {
    const columns = this.selectedDaxColumns.includes(column)
      ? this.selectedDaxColumns.filter(selected => selected !== column)
      : [...this.selectedDaxColumns, column];
    this.updateDaxColumns(columns);
  }

  selectAllDaxColumns(): void {
    this.updateDaxColumns([...this.availableMappingColumns]);
  }

  deselectAllDaxColumns(): void {
    this.updateDaxColumns([]);
  }

  toggleDaxNumeratorColumn(column: string): void {
    const columns = this.daxMeasureDraft.numeratorColumns ?? [];
    this.updateDaxNumeratorColumns(columns.includes(column) ? columns.filter(c => c !== column) : [...columns, column]);
  }

  toggleDaxDenominatorColumn(column: string): void {
    const columns = this.daxMeasureDraft.denominatorColumns ?? [];
    this.updateDaxDenominatorColumns(columns.includes(column) ? columns.filter(c => c !== column) : [...columns, column]);
  }

  updateDaxNumeratorColumns(columns: string[]): void {
    const numeratorColumns = columns ?? [];
    const expression = this.buildDaxPercentageExpression(numeratorColumns, this.daxMeasureDraft.denominatorColumns ?? []);
    this.updateDaxMeasureDraft({ numeratorColumns, expression });
  }

  updateDaxDenominatorColumns(columns: string[]): void {
    const denominatorColumns = columns ?? [];
    const expression = this.buildDaxPercentageExpression(this.daxMeasureDraft.numeratorColumns ?? [], denominatorColumns);
    this.updateDaxMeasureDraft({ denominatorColumns, expression });
  }

  selectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([...this.availableMappingColumns]); }
  deselectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([]); }
  selectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([...this.availableMappingColumns]); }
  deselectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([]); }

  /** Percentage = sum of chosen numerator columns divided by sum of chosen denominator columns. */
  private buildDaxPercentageExpression(numerator: string[], denominator: string[]): string {
    if (!numerator.length || !denominator.length) return this.selectedDaxSnippet || this.daxMeasureDraft.expression;
    const isRowScope = (this.daxMeasureDraft.evaluationScope ?? 'column') === 'row';
    const wrap = (column: string) => isRowScope ? `[${column}]` : `SUM([${column}])`;
    const numeratorExpr = numerator.map(wrap).join(' + ');
    const denominatorExpr = denominator.map(wrap).join(' + ');
    return `PERCENTAGE(${numeratorExpr}, ${denominatorExpr})`;
  }

  updateDaxDisplayPreference(preference: DaxDisplayPreference): void {
    this.daxModel = { ...this.daxModel, displayPreference: preference };
    this.refreshPreview();
  }

  updateDaxEvaluationScope(scope: DaxEvaluationScope): void {
    this.pushUndo();
    const evaluationScope: DaxEvaluationScope = scope === 'row' ? 'row' : 'column';
    const measure = { ...this.daxMeasureDraft, evaluationScope };
    this.daxMeasureDraft = measure;
    if (this.daxMeasureDraft.name?.trim()) this.daxMeasureFormError = '';
    if (this.selectedDaxSnippet) this.applyDaxSelectedOperation();
    const expression = this.daxMeasureDraft.expression?.trim() ?? '';
    this.daxExpressionError = expression ? validateDaxExpression(expression, this.yAxisColumns, evaluationScope) : '';
  }

  insertDaxSnippet(snippet: string): void {
    if (!snippet) return;
    this.selectedDaxSnippet = snippet;
    this.daxModel = { ...this.daxModel, enabled: true, selectedOperation: snippet };
    this.daxMeasureDraft = { ...this.daxMeasureDraft, operation: snippet, numeratorColumns: [], denominatorColumns: [] };
    this.applyDaxSelectedOperation();
  }

  applyDaxSelectedOperation(): void {
    if (!this.selectedDaxSnippet) return;
    const operation = this.selectedDaxSnippet.split('(')[0].trim().toUpperCase();
    // Percentage uses the dedicated numerator/denominator column pickers instead of the generic
    // Column picker; rebuild from those selections so switching row/column scope keeps them.
    const expression = operation === 'PERCENTAGE'
      ? this.buildDaxPercentageExpression(this.daxMeasureDraft.numeratorColumns ?? [], this.daxMeasureDraft.denominatorColumns ?? [])
      : this.buildDaxExpressionFromSelection();
    // Percentile ranks a value within a dataset; percentage expresses a ratio out of 100 - only
    // the latter should auto-format with a trailing %.
    let format = this.daxMeasureDraft.format;
    if (operation === 'PERCENTAGE') format = 'percent';
    else if (format === 'percent') format = 'number';
    this.updateDaxMeasureDraft({ expression, format });
  }

  private buildDaxExpressionFromSelection(): string {
    return buildDaxOperationExpression(this.selectedDaxSnippet, this.selectedDaxColumns, this.daxMeasureDraft.evaluationScope);
  }

  toggleMultiYColumn(col: string): void {
    if (this.isXAxisConflict(col) && !this.multiYColumns.includes(col)) return;
    if (this.isRightYAxisColumn(col) && !this.multiYColumns.includes(col)) return;
    this.pushUndo();
    const idx = this.multiYColumns.indexOf(col);
    if (idx >= 0) {
      this.multiYColumns.splice(idx, 1);
    } else if (this.selectedChartType === 'table') {
      // Re-selecting a table column returns it to its original source-column position
      const reference = this.yAxisColumns;
      const refIndex = reference.indexOf(col);
      let insertAt = this.multiYColumns.length;
      if (refIndex >= 0) {
        for (let i = 0; i < this.multiYColumns.length; i++) {
          if (reference.indexOf(this.multiYColumns[i]) > refIndex) { insertAt = i; break; }
        }
      }
      this.multiYColumns.splice(insertAt, 0, col);
    } else {
      this.multiYColumns.push(col);
    }
    this.syncTableXAxis();
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  /** For table charts the first column (X-axis) follows the selection, so deselecting it removes it from the table. */
  private syncTableXAxis(): void {
    if (this.selectedChartType === 'table') {
      this.xAxis = this.multiYColumns[0] ?? '';
    }
  }

  removeMultiYColumn(col: string): void {
    this.multiYColumns = this.multiYColumns.filter(c => c !== col);
    this.syncTableXAxis();
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  toggleMultiYDropdown(): void {
    const next = !this.showMultiYDropdown;
    this.closeDataMappingDropdowns();
    this.showChartModelDropdown = false;
    this.showMultiYDropdown = next;
  }

  toggleComboLineColumn(col: string): void {
    if (this.isXAxisConflict(col) && !this.comboLineColumns.includes(col)) return;
    if (this.isLeftYAxisColumn(col) && !this.comboLineColumns.includes(col)) return;
    this.pushUndo();
    const idx = this.comboLineColumns.indexOf(col);
    if (idx >= 0) { this.comboLineColumns.splice(idx, 1); } else { this.comboLineColumns.push(col); }
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  removeComboLineColumn(col: string): void {
    this.comboLineColumns = this.comboLineColumns.filter(c => c !== col);
    this.refreshPreview();
    this.cdr.markForCheck();
  }

  toggleComboLineDropdown(): void {
    const next = !this.showComboLineDropdown;
    this.closeDataMappingDropdowns();
    this.showComboLineDropdown = next;
  }
}

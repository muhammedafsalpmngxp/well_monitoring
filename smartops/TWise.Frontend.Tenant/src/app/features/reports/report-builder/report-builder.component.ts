import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, ElementRef, ViewChild, HostListener, NgZone } from '@angular/core';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';
import { AdvancedFilterComponent, type AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subscription, of, Subject } from 'rxjs';
import { switchMap, map, catchError, takeUntil, expand, reduce } from 'rxjs/operators';
import { CommonApiService, DatabaseViewListItem, SourceDto, TableDataDto, PlantFilterDto } from '../../../core/services/common-api.service';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  globalSelectionValues,
  hasGlobalSelection,
  matchesGlobalSelection,
  isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
import { TenantReportsService } from '../../../core/services/tenant-reports.service';
import { clusterBannerSelectionKey, resolveClusterBanner } from '../shared/report-cluster-banner.util';
import { DaxModelService, SavedDaxModelDto } from '../../../core/services/dax-model.service';
import { restoreDaxOperation } from '../../../core/utils/dax-evaluator.util';
import { LearnVideoService } from '../../../core/services/learn-video.service';
import { ReportTemplatesService, ReportTemplateDto } from '../../../core/services/report-templates.service';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import {
  ExcelExportModule,
  RowGroupingModule,
  AggregationModule,
  SetFilterModule,
  ClipboardModule,
  CellSelectionModule,
  MenuModule,
  SideBarModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
} from 'ag-grid-enterprise';
import {
  ClientSideRowModelModule,
  ColDef,
  ColGroupDef,
  ModuleRegistry,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  CellStyleModule,
  RowStyleModule,
  CustomFilterModule,
  PinnedRowModule,
  RenderApiModule,
  RowApiModule,
  CellSpanModule,
  PaginationModule,
  TextEditorModule,
  RowAutoHeightModule,
  TooltipModule,
  themeQuartz,
  GridReadyEvent,
  GridApi,
  GridOptions,
  IRowNode,
  ColumnRowGroupChangedEvent,
  GetContextMenuItemsParams,
  MenuItemDef,
  DefaultMenuItem,
  CellClickedEvent,
  CellValueChangedEvent,
  CellClassParams,
  ColumnHeaderClickedEvent,
  HeaderClassParams,
  ICellRendererParams,
  RowClassParams,
  RowHeightParams,
  ExcelStyle,
} from 'ag-grid-community';
import {
  ColumnConfig,
  CalculatedField,
  CalcOperation,
  ColumnGroupColorRow,
  ReportJsonConfig,
  ReportSheetConfig,
  MergedCellRange,
  RowLayoutRef,
  CellEmbed,
  TextOrientation,
  TextAlign,
  CellBorder,
  BorderType,
  TableDensity,
  ConditionalRule,
  CfOperator,
  CfScope,
  ReportConditionalFilter,
  ReportLegendItem,
} from '../shared/report-config.model';
import { coerceNumberAllowPercent } from '../../../core/utils/percent-number.util';
import {
  buildReportGridColumns,
  computeTotalsRows,
  computeGrandTotalRow,
  reconcileRowLayout,
  materializeRows,
  isNumericColumn,//row gruping
  isAggregatableColumn,
  isDateColumn,
  REPORT_AGG_FUNCS,
  MANUAL_ROW_FLAG,
  MANUAL_ROW_ID,
  SOURCE_ROW_INDEX,
  ROW_COLOR_KEY,
  getReportRowColorKey,
  getReportGroupRowColorKey,
  getReportGroupRowStyle,
  createColumnConfigResolver,
  getReportCellSetting,
  clearReportCellSettingsForRecord,
  reportCellSettingKey,
  isReportCellSettingForField,
  hasRowMerges,
  VERTICAL_CELL_ROW_HEIGHT,
  rowHasVerticalCell,
  borderSidesFor,
  unionCellBorder,
  hasAnyBorderSide,
  ROW_NUMBER_COL_ID,
  resolveHeaderBackgroundColor,
  resolveHeaderTextColor,
  TOTALS_LABEL_FIELD,
  getPinnedSummaryLabel,
  getSummaryRowStyle,
  buildReportAutoGroupColumnStyles,
  getReportColumnField,
  DUPLICATE_HIGHLIGHT_BG,
  DUPLICATE_HIGHLIGHT_TEXT,
  ReportHeaderGroupRef,
  resolveGroupHeaderAlign,
} from '../shared/report-grid-columns.util';
import { growReportColumnsToFitValues } from '../shared/report-column-autosize.util';
import {
  ReportColumnKeyedSettings,
  columnKeyRenamer,
  getRenamedColumnDisplayNames,
  renameConditionalFilterColumns,
  renameDaxModelColumns,
  renameReportColumnKeys,
  renamedOutputRenamer,
  sameColumnRenames,
  toSourceColumnKeys,
} from '../shared/report-column-rename.util';
import {
  columnNameSet,
  columnsAfterRules,
  dropMissingColumnKeys,
  mergeConditionalFilters,
  mergeDaxModels,
  mergeReportColumnKeys,
  mergeTemplateRules,
} from '../shared/report-template-merge.util';
import { ReportExportColorService, ExportCellColorSource } from '../shared/report-export-color.service';
import { positionReportPaginationPopup } from '../shared/report-grid-popup.util';
import { applyConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { ParameterFilterRule, ParameterFilterAction, applyParameterFilters, getRuleSourceColumns, getTransformationSourceColumns, getParameterSelectionError } from '../../../core/utils/parameter-filter.util';
import { ReportSheetsService, ReportSheet } from '../shared/report-sheets.service';
import { previewReportView } from '../shared/report-view-filter.util';
import { getReportGridPageSize } from '../shared/report-grid-lifecycle.util';
import { EditableHeaderComponent } from './editable-header.component';
import { EmbeddedCellComponent } from './embedded-cell.component';
import {
  createDefaultDaxMeasure,
  createDefaultDaxModel,
  cloneDaxModel,
  evaluateDaxMeasure,
  evaluateDaxMeasureForRow,
  validateDaxExpression,
  validateDaxMeasureDraft,
  getDaxReferencedColumns,
  DAX_FUNCTION_SNIPPETS,
  buildDaxOperationExpression,
  formatDaxValue,
  getActiveDaxMeasures,
} from '../../../core/utils/dax-evaluator.util';
import type { DaxMeasureConfig, DaxDisplayPreference, DaxEvaluationScope, DaxModelConfig } from '../../../core/utils/dax-evaluator.util';
import { ToastService } from '../../../core/services/toast.service';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  CellStyleModule,
  RowStyleModule,
  CustomFilterModule,
  PinnedRowModule,
  RenderApiModule,
  RowApiModule,
  CellSpanModule,
  PaginationModule,
  TextEditorModule,
  RowAutoHeightModule,
  TooltipModule,
  ExcelExportModule,
  RowGroupingModule,
  AggregationModule,
  SetFilterModule,
  ClipboardModule,
  CellSelectionModule,
  MenuModule,
  SideBarModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
]);

// 'None' (clear) plus a curated set of the colors most commonly used in reports — a
// "Custom Color…" picker (see colorMenuItems/openCustomColorPicker) covers anything
// beyond this short list, so the context-menu color submenu stays compact (no scrolling).
const CELL_COLOR_PALETTE = [
  '#FFFFFF', // None
  '#FEE2E2', // red
  '#FFEDD5', // orange
  '#FEF9C3', // yellow
  '#DCFCE7', // green
  '#D1FAE5', // emerald
  '#CFFAFE', // cyan
  '#DBEAFE', // blue
  '#E0E7FF', // indigo
  '#F3E8FF', // purple
  '#E5E7EB', // gray
];

// Readable text colors ('#FFFFFF' is the sentinel for "None"/default text color;
// the "Custom Color…" picker can still choose true white for text on dark cells).
const TEXT_COLOR_PALETTE = [
  '#FFFFFF', // None (default)
  '#111827', // near-black
  '#374151', // gray
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // amber
  '#16A34A', // green
  '#0891B2', // cyan
  '#2563EB', // blue
  '#7C3AED', // purple
  '#DB2777', // pink
];

export type ReportTypeId = 'table' | 'summary' | 'chart';

export interface ReportTypeOption {
  id: ReportTypeId;
  label: string;
}

export interface DataModelOption {
  id: string;
  label: string;
  icon: 'derrick' | 'gauge' | 'crew';
  /** Number of columns in the source, shown in the dropdown subtitle (e.g. "4 columns · Table"). */
  columns: number;
  /** Source kind ('Table' / 'View') shown after the column count in the dropdown subtitle. */
  modelType: string;
}

/** The subset of builder state that belongs to the Setup tab (report definition, not print/export styling). */
export interface SavedReportSetupConfig {
  dataSourceMode: 'table' | 'view';
  selectedDataModelId: string;
  selectedRawFields: string[];
  columnFields: string[];
  columnGroupingFields: string[];
  rowGroupFields: string[];
  subtotalAfterGroup: boolean;
  grandTotalAtBottom: boolean;
  showTotals: boolean;
  selectedReportType: ReportTypeId | null;
  metric: string;
  sortBy: string;
  limitCategory: LimitCategory;
}

export interface SavedReportSetupPreview {
  conditionalFilters: string[];
  transformations: string[];
  daxEnabled: boolean;
  daxMeasures: string[];
}

export interface SavedReportSetup {
  id: number;
  customName: string;
  sourceName: string;
  sourceType: string;
  templateJson: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  viewId: number | null;
  accent: 'blue' | 'green' | 'purple' | 'orange' | 'yellow';
  /** Read-only summaries of conditional filters, data transformation and DAX for the preview panel. */
  preview: SavedReportSetupPreview;
  /** Derived from templateJson for the modal preview panel. */
  config: SavedReportSetupConfig;
}

/** A one-click preset that recolors the banner, footer, table header and group accents together. */
export interface ReportBuiltInTheme {
  id: string;
  label: string;
  bannerBackground: string;
  bannerText: string;
  footerBackground: string;
  footerText: string;
  headerRowColor: string;
  headerRowTextColor: string;
  groupColor: string;
  subGroupColor: string;
  groupText: string;
  subGroupText: string;
  accent: string;
}

/** Saved model card shown in the DAX Model section. */
interface DaxSavedModelCard {
  id: string;
  name: string;
  subtitle: string;
  tags: string[];
  expression: string;
  sourceId?: string;
}

/** Full per-sheet builder state, captured/restored when switching Excel-like sheets.
 *  Note: reportName, category and editingReportId are report-level (shared across sheets), so they are NOT here. */
interface ReportSheetSnapshot {  dataSourceMode: 'table' | 'view';
  selectedDataModelId: string;
  selectedRawFields: string[];
  columnFields: string[];
  columnConfigs: Record<string, ColumnConfig>;
  tablePreviewData: TableDataDto | null;
  availableViews: DatabaseViewListItem[];
  rowGroupFields: string[];
  rowGroupAggs: Record<string, 'sum' | 'avg'>;
  rowGroupColors: Record<string, string>;
  subtotalAfterGroup: boolean;
  grandTotalAtBottom: boolean;
  showTotals: boolean;
  selectedReportType: ReportTypeId | null;
  metric: string;
  sortBy: string;
  limitCategory: LimitCategory;
  calculatedFields: CalculatedField[];
  nextCalculatedIndex: number;
  conditionalRules: ConditionalRule[];
  daxModel: DaxModelConfig;
  legendItems: ReportLegendItem[];
  conditionalFilters: ReportConditionalFilter[];
  parameterFilters: ParameterFilterRule[];
  headerTitle: string;
  headerSubtitle: string;
  headerSubtitle2: string;
  bannerText: string;
  clusterBannerText: string;
  clusterBannerSelection: string;
  customClusterBannerEnabled: boolean;
  headerBackgroundColor: string;
  headerTextColor: string;
  bannerBackgroundColor: string;
  bannerTextColor: string;
  groupTextColor: string;
  subGroupTextColor: string;
  headerRowColor: string;
  headerRowTextColor: string;
  headerCellColors: Record<string, string>;
  headerCellTextColors: Record<string, string>;
  rowColors: Record<number, string>;
  rowColorsByKey: Record<string, string>;
  rowTextColors: Record<number, string>;
  rowTextColorsByKey: Record<string, string>;
  summaryRowColors?: Record<string, string>;
  summaryRowTextColors?: Record<string, string>;
  pageRowColors: Record<number, string>;
  cellColors: Record<string, string>;
  cellTextColors: Record<string, string>;
  columnGroupColors: ColumnGroupColorRow[];
  groupColors: Record<string, string>;
  subGroupColors: Record<string, string>;
  groupTextColors: Record<string, string>;
  subGroupTextColors: Record<string, string>;
  pinnedColumns: string[];
  dataBarColumns?: string[];
  leftLogoUrl: string;
  rightLogoUrl: string;
  rightLogoColor: string;
  fontFamily: string;
  fontSize: number;
  headerFontSize: number;
  bannerFontSize: number;
  tableHeadingFontSize: number;
  gridHeaderHeight: number;
  selectedThemeId: string;
  brandedRows: boolean;
  gridAccentColor: string;
  mergedCellRanges: MergedCellRange[];
  rowLayout: RowLayoutRef[];
  manualRows: Record<string, Record<string, unknown>>;
  cellOverrides: Record<string, unknown>;
  deletedRowIndices: number[];
  cellEmbeds: Record<string, CellEmbed>;
  cellOrientations: Record<string, TextOrientation>;
  headerCellOrientations: Record<string, TextOrientation>;
  cellAlignments: Record<string, TextAlign>;
  headerCellAlignments: Record<string, TextAlign>;
  reportAlignment?: TextAlign;
  groupHeaderAlignments: Record<string, TextAlign>;
  subGroupHeaderAlignments: Record<string, TextAlign>;
  cellBorders: Record<string, CellBorder>;
  headerCellBorders: Record<string, CellBorder>;
  reportBorder?: BorderType;
  rowNumberHeader?: string;
  viewMode: TableDensity;
  gridRowHeight: number;
  columnSizingMode: 'auto' | 'fit';
  gridPaginationPageSize: number;
}

/** Row key in core.LearnVideos for this screen's Learn video. */
const LEARN_SCREEN_KEY = 'report-builder';

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

interface FilterField {
  key: string;
  label: string;
  options: string[];
}

interface GlobalFilterState {
  filterValues: Record<string, GlobalFilterSelection>;
  quickRange: string;
  fromDate: string;
  toDate: string;
}

type LimitCategory = 'all' | 'top';
type SetupTab = 'setup' | 'appearance';

const GROUP_LABELS = ['Cluster A', 'Cluster B', 'Cluster C', 'Cluster D', 'Cluster E'];
const GROUP_VALUES = [88, 57, 94, 51, 68];

const RAW_FIELDS_BY_MODEL: Record<string, string[]> = {
  activities: ['Sl.No', 'Activity Name', 'Well', 'Discipline', 'Status', 'Planned Date', 'Actual Date', 'Duration', 'Remarks'],
  wells: ['Sl.No', 'Well Name', 'Cluster', 'Status', 'Category', 'Progress', 'Modified'],
  crew: ['Sl.No', 'Crew Member', 'Role', 'Shift', 'Crew', 'Certification', 'Status'],
};

@Component({
  selector: 'app-report-builder',
  standalone: false,
  templateUrl: './report-builder.component.html',
  styleUrls: ['./report-builder.component.scss'],
  providers: [ReportSheetsService],
})
export class ReportBuilderComponent implements OnInit, OnDestroy {
  reportName = 'Report Name';
  reportDescription = '';
  editingDescription = false;
  editingTitle = false;
  clusterBannerText = '';
  clusterBannerSelection = '';
  private clusterBannerChoice?: { selectionKey: string; enabled: boolean };

  get customClusterBannerEnabled(): boolean {
    const selectionKey = clusterBannerSelectionKey(this.filterValues?.['cluster']);
    if (!selectionKey) return false;
    return this.clusterBannerChoice?.selectionKey === selectionKey ? this.clusterBannerChoice.enabled : true;
  }

  set customClusterBannerEnabled(enabled: boolean) {
    this.clusterBannerChoice = {
      selectionKey: clusterBannerSelectionKey(this.filterValues?.['cluster']),
      enabled,
    };
  }
  clusterBannerDraft = '';
  editingClusterBanner = false;
  private editingClusterSelection = '';

  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  get errorMessage(): string { return this.notify.error; }

  showGlobalFilter = true;

  filterFields: FilterField[] = [
    { key: 'country',      label: 'Country',       options: [] },
    { key: 'sector',       label: 'Sector',        options: [] },
    { key: 'businessUnit', label: 'Business Unit',  options: [] },
    { key: 'division',     label: 'Division',      options: [] },
    { key: 'cluster',      label: 'Cluster',       options: [] },
    { key: 'plant',        label: 'Plant',         options: [] },
  ];

  readonly quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After', 'Custom'];

  filterValues: Record<string, GlobalFilterSelection> = {
    country: 'All',
    sector: 'All',
    businessUnit: 'All',
    division: 'All',
    cluster: 'All',
    plant: 'All',
  };
  quickRange = '';
  fromDate = '';
  toDate = '';
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

  /** The selected cluster names, or '' when none ('All') is selected. */
  get selectedClusterName(): string {
    return this.clusterBanner.selectedClusterName;
  }

  private get clusterBanner() {
    return resolveClusterBanner({
      customClusterBannerEnabled: this.customClusterBannerEnabled,
      clusterBannerText: this.clusterBannerText,
      clusterBannerSelection: this.clusterBannerSelection,
    }, this.filterValues?.['cluster'], this.reportName || 'Report Name');
  }

  get showClusterBanner(): boolean {
    return this.clusterBanner.visible;
  }

  get showClusterBannerEditor(): boolean {
    return this.showClusterBanner && this.editingClusterBanner
      && this.editingClusterSelection === this.clusterBanner.selectionKey;
  }

  /** Secondary banner title, e.g. "JOB PROGRESS REPORT - NIMR". */
  get clusterBannerTitle(): string {
    return this.clusterBanner.title;
  }

  startEditClusterBanner(): void {
    if (!this.showClusterBanner || this.showClusterBannerEditor) return;
    this.clusterBannerDraft = this.clusterBannerTitle;
    this.editingClusterSelection = this.clusterBanner.selectionKey;
    this.editingClusterBanner = true;
  }

  updateClusterBannerText(text: string): void {
    if (!this.showClusterBannerEditor) return;
    this.clusterBannerDraft = text;
    this.clusterBannerText = text;
    this.clusterBannerSelection = this.editingClusterSelection;
  }

  setCustomClusterBannerEnabled(enabled: boolean): void {
    this.customClusterBannerEnabled = enabled;
    this.cancelEditClusterBanner();
  }

  cancelEditClusterBanner(): void {
    this.editingClusterBanner = false;
    this.clusterBannerDraft = '';
    this.editingClusterSelection = '';
  }
  private allPlants: PlantFilterDto[] = [];
  private readonly destroy$ = new Subject<void>();
  private initialGlobalFilterState: GlobalFilterState | null = null;
  private plantFiltersLoaded = false;
  private reportFiltersLoaded = false;
  private viewDestroyed = false;
  private returnUrl = '/reports/my-reports';

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
    this.quickRange = 'Custom';
    this.showDateRangePopup = false;
    this.refreshGlobalFilterData();
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

  get activeFilters(): { key: string; label: string; value: GlobalFilterSelection }[] {
    const hierarchyFilters = this.filterFields
      .filter(f => hasGlobalSelection(this.filterValues[f.key]))
      .map(f => ({ key: f.key, label: f.label, value: this.filterValues[f.key] }));
    if (this.fromDate) hierarchyFilters.push({ key: 'fromDate', label: 'From', value: this.fromDate });
    if (this.toDate) hierarchyFilters.push({ key: 'toDate', label: 'To', value: this.toDate });
    if (this.quickRange) hierarchyFilters.push({ key: 'quickRange', label: 'Quick Range', value: this.quickRange });
    return hierarchyFilters;
  }

  resetGlobalFilters(): void {
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
    const defaults = this.initialGlobalFilterState;
    for (const field of this.filterFields) {
      this.filterValues[field.key] = defaults?.filterValues[field.key] ?? 'All';
    }
    this.quickRange = defaults?.quickRange ?? '';
    this.fromDate = defaults?.fromDate ?? '';
    this.toDate = defaults?.toDate ?? '';
    this.openFilterName = null;
    this.showDateRangePopup = false;
    this.rebuildCascadingOptions();
    this.refreshGlobalFilterData();
    this.cdr.markForCheck();
  }

  private captureInitialGlobalFilterStateIfReady(): void {
    if (this.initialGlobalFilterState || !this.plantFiltersLoaded || !this.reportFiltersLoaded) return;
    this.initialGlobalFilterState = {
      filterValues: { ...this.filterValues },
      quickRange: this.quickRange,
      fromDate: this.fromDate,
      toDate: this.toDate,
    };
  }

  toggleGlobalFilter(): void {
    this.showGlobalFilter = !this.showGlobalFilter;
  }

  private advancedFilters: ReturnType<typeof advancedHierarchyFilters> = [];
  @ViewChild('advancedFilter') private advancedFilterRef?: AdvancedFilterComponent;

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.refreshGlobalFilterData();
  }

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  filterLabel(selection: GlobalFilterSelection): string {
    return globalSelectionLabel(selection);
  }

  hasGlobalSelection(selection: GlobalFilterSelection): boolean {
    return hasGlobalSelection(selection);
  }

  isFilterOptionSelected(selection: GlobalFilterSelection, value: string): boolean {
    return isGlobalFilterOptionChecked(selection, value);
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

  selectFilterOption(name: string, value: string): void {
    if (name === 'quickRange') {
      this.quickRange = value;
      this.applyQuickRange(value);
      this.refreshGlobalFilterData();
      this.openFilterName = null;
      this.cdr.markForCheck();
      return;
    }
    this.filterValues[name] = value === 'All'
      ? 'All'
      : toggleGlobalSelection(this.filterValues[name] ?? 'All', value, this.filterFields.find(field => field.key === name)?.options, this.globalFilterClear.consume(name));
    const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const idx = hierarchy.indexOf(name);
    for (let i = idx + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
    this.rebuildCascadingOptions();
    this.openFilterName = null;
    this.refreshGlobalFilterData();
    if (name === 'quickRange') this.openFilterName = null;
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event?: MouseEvent): void {
    if (this.openFilterName) { this.openFilterName = null; this.cdr.markForCheck(); }
    // Close the fixed-position Data Transformation dropdowns on any outside click (triggers and
    // panels stopPropagation, so this only fires for clicks elsewhere — e.g. collapsing an
    // accordion section, which would otherwise leave the fixed menu floating detached).
    if (this.openFilterField !== null || this.openParamColDropdownId !== null) {
      this.closeAllDropdowns();
      this.cdr.markForCheck();
    }
    if (this.showDaxColumnDropdown || this.showDaxNumeratorDropdown || this.showDaxDenominatorDropdown) {
      this.showDaxColumnDropdown = false;
      this.showDaxNumeratorDropdown = false;
      this.showDaxDenominatorDropdown = false;
      this.daxColumnSearch = '';
      this.cdr.markForCheck();
    }
    this.closeSheetMenu();
    // Report Components dropdowns that bubble their trigger click to the document (no
    // stopPropagation): close them when the click lands outside the dropdown (trigger + menu),
    // using closest() so clicking the trigger itself doesn't immediately re-close it.
    const clickTarget = event?.target as HTMLElement | null;
    if (this.showRawFieldFilter && !clickTarget?.closest('.report-setup__field-filter')) {
      this.showRawFieldFilter = false;
      this.cdr.markForCheck();
    }
    if (this.showDataModelDropdown && !clickTarget?.closest('.report-setup__model')) {
      this.showDataModelDropdown = false;
      this.cdr.markForCheck();
    }
    if (this.showCategoryDropdown && !clickTarget?.closest('.builder-toolbar__category')) {
      this.showCategoryDropdown = false;
      this.cdr.markForCheck();
    }
    // Clicks on empty grid space or its toolbar clear the active cell focus/selection. The context/
    // column menu now renders into document.body (popupParent, so it isn't clipped by the grid's own
    // bounded container) and is therefore no longer a DOM descendant of the grid — checked on its own
    // rather than requiring containment inside '.builder-canvas__live-table'.
    const target = event?.target as HTMLElement | null;
    const insideGrid = !!target?.closest('.builder-canvas__live-table');
    const insideGridPopup = !!target?.closest('.ag-popup, .ag-menu');
    if (target && !insideGrid && !insideGridPopup) {
      this.clearGridSelection();
    }
  }

  @HostListener('document:keydown.escape')
  onEscKey(): void {
    this.showRawFieldFilter = false;
    if (this.showExpandModal) this.closeExpandModal();
  }

  clearFilter(key: string): void {
    this.filterValues[key] = 'All';
    const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const idx = hierarchy.indexOf(key);
    for (let i = idx + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
    this.rebuildCascadingOptions();
    this.refreshGlobalFilterData();
  }

  onFilterChange(key: string): void {
    const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const idx = hierarchy.indexOf(key);
    for (let i = idx + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
    this.rebuildCascadingOptions();
    this.refreshGlobalFilterData();
  }

  private refreshGlobalFilterData(): void {
    if (this.clusterBannerChoice?.selectionKey !== clusterBannerSelectionKey(this.filterValues?.['cluster'])) {
      this.clusterBannerChoice = undefined;
    }
    if (!this.showClusterBannerEditor) this.cancelEditClusterBanner();
    if (this.dataSourceMode === 'view' && this.selectedDataModelId) {
      this.loadViewPreviewForEdit(this.selectedDataModelId, false);
    } else if (this.tablePreviewData) {
      this.rebuildPreviewGrid();
    }
  }

  private loadPlantFilters(): void {
    this.commonApi.getPlantFilters().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe(plants => {
      this.allPlants = plants;
      this.filterFields[0].options = this.distinctValues(plants, p => p.country);
      this.autoSelectSingle();
      this.rebuildCascadingOptions();
      this.refreshGlobalFilterData();
      this.plantFiltersLoaded = true;
      this.captureInitialGlobalFilterStateIfReady();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingle(): void {
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    const selectors: ((p: PlantFilterDto) => string)[] = [p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    if (this.filterFields[0].options.length === 1) this.filterValues['country'] = this.filterFields[0].options[0];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(p => matchesGlobalSelection(selectors[i](p), this.filterValues[keys[i]]));
      const opts = this.distinctValues(filtered, selectors[i + 1]);
      if (opts.length === 1 && active(this.filterValues[keys[i]])) this.filterValues[keys[i + 1]] = opts[0];
    }
  }

  private rebuildCascadingOptions(): void {
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    const selectors: ((p: PlantFilterDto) => string)[] = [p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(p => matchesGlobalSelection(selectors[i](p), this.filterValues[keys[i]]));
      this.filterFields[i + 1].options = active(this.filterValues[keys[i]]) ? this.distinctValues(filtered, selectors[i + 1]) : [];
    }
  }

  isLocked(fieldIndex: number): boolean {
    return !this.isAdmin && this.filterFields[fieldIndex].options.length <= 1 && this.filterFields[fieldIndex].options.length > 0;
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  categories = ['Wells', 'Daily Plan', 'Crew', 'Well Monitoring'];
  category = 'Wells';
  private selectedCategoryId = 0;
  showCategoryDropdown = false;

  // API-loaded data
  apiCategories: CategoryDropdown[] = [];
  availableSources: SourceDto[] = [];
  tablePreviewData: TableDataDto | null = null;
  isSaving = false;
  private readonly subs: Subscription[] = [];
  private sourcePreviewSubscription?: Subscription;

  // ─── Excel-like sheets ────────────────────────────────────────────────────
  // Sheet list/active-sheet bookkeeping lives in the injected ReportSheetsService;
  // these fields drive only the tab-bar UI (inline rename + right-click menu).
  renamingSheetId: string | null = null;
  renameSheetValue = '';
  sheetMenu: { sheet: ReportSheet; x: number; y: number } | null = null;

  get sheets(): ReportSheet[] { return this.sheetsService.sheets; }
  get activeSheetId(): string { return this.sheetsService.activeId; }
  get canDeleteSheet(): boolean { return this.sheetsService.canDelete; }

  locked = false;
  zoomLevel = 100;
  panelCollapsed = false;
  private _prevSidebarState: boolean | undefined;
  showClearAllConfirm = false;

  dataModels: DataModelOption[] = [
    { id: 'activities', label: 'Activities', icon: 'derrick', columns: 0, modelType: 'Table' },
    { id: 'wells', label: 'Wells', icon: 'gauge', columns: 0, modelType: 'Table' },
    { id: 'crew', label: 'Crew', icon: 'crew', columns: 0, modelType: 'View' },
  ];
  selectedDataModelId = '';
  showDataModelDropdown = false;
  dataSourceSearch = '';

  private templateBaselineJson: string | null = null;

  get filteredDataModels(): DataModelOption[] {
    const term = this.dataSourceSearch.trim().toLowerCase();
    if (!term) return this.dataModels;
    return this.dataModels.filter(m => m.label.toLowerCase().includes(term) || m.id.toLowerCase().includes(term));
  }

  /** Toggle between Table (common sources) and View (database views) */
  dataSourceMode: 'table' | 'view' = 'table';
  availableViews: DatabaseViewListItem[] = [];
  viewSearch = '';

  get filteredViews(): DatabaseViewListItem[] {
    const term = this.viewSearch.trim().toLowerCase();
    if (!term) return this.availableViews;
    return this.availableViews.filter(v => v.viewName.toLowerCase().includes(term));
  }

  get selectedView(): DatabaseViewListItem | undefined {
    return this.availableViews.find(v => v.viewName === this.selectedDataModelId);
  }

  get selectedDataModel(): DataModelOption {
    return this.dataModels.find(m => m.id === this.selectedDataModelId) ?? this.dataModels[0];
  }

  setupTab: SetupTab = 'setup';
  reportDetailsExpanded = false;
  rawSectionExpanded = false;

  rawFieldSearch = '';
  rawFieldFilter: 'all' | 'selected' | 'unselected' = 'all';
  showRawFieldFilter = false;
  selectedRawFields: string[] = [];

  get rawFields(): string[] {
    // Use API-loaded columns if available, fall back to hardcoded
    if (this.tablePreviewData?.columns?.length) {
      return this.tablePreviewData.columns;
    }
    return RAW_FIELDS_BY_MODEL[this.selectedDataModelId] ?? [];
  }

  get filteredRawFields(): string[] {
    const term = this.rawFieldSearch.trim().toLowerCase();
    return this.rawFields.filter(field => {
      const selected = this.isRawFieldSelected(field);
      return field.toLowerCase().includes(term)
        && (this.rawFieldFilter === 'all'
          || (this.rawFieldFilter === 'selected' ? selected : !selected));
    });
  }

  get primaryRawField(): string {
    return this.selectedRawFields[0] ?? '';
  }

  get extraRawColumns(): string[] {
    return this.selectedRawFields.slice(1);
  }

  columnSectionExpanded = false;
  totalSectionExpanded = false;

  // DAX Model: calculated measures rendered as extra grid columns (row scope) or a totals value (column scope).
  daxModelSectionExpanded = false;
  legendsSectionExpanded = false;
  legendItems: ReportLegendItem[] = [];
  readonly daxFunctionSnippets = [...DAX_FUNCTION_SNIPPETS];
  // Starts at 2: the default model already owns id 'measure-1', so the next created measure is unique.
  private nextDaxMeasureIndex = 2;
  selectedDaxSnippet = '';
  selectedDaxColumns: string[] = [];
  daxColumnSearch = '';
  showDaxColumnDropdown = false;
  showDaxNumeratorDropdown = false;
  showDaxDenominatorDropdown = false;
  daxMeasureApplied = false;
  daxMeasureMessage = 'Measure applied';
  private daxMeasureAppliedTimer: ReturnType<typeof setTimeout> | null = null;
  daxModel: DaxModelConfig = { ...createDefaultDaxModel(), enabled: false };
  daxMeasureDraft: DaxMeasureConfig = { ...this.daxModel.measures[0] };
  daxExpressionError = '';
  /** Missing/duplicate measure name or Calculate By, shown under those fields. */
  daxMeasureFormError = '';
  daxNameError = '';
  daxColumnError = '';
  daxDuplicateError = '';

  // --- DAX Model section tabs: "Saved Models" and "Create New". ---
  daxActiveTab: 'saved' | 'create' = 'saved';
  daxSavedModelsSearch = '';
  private daxSavedModelSelectedIds = new Set<string>();
  daxSavedModelsCatalog: DaxSavedModelCard[] = [];
  daxSavedModelsLoading = false;
  daxSavedModelsMessage = '';
  private readonly daxSavedModelsById = new Map<string, SavedDaxModelDto>();

  private loadSavedDaxModels(): void {
    if (this.daxSavedModelsLoading) return;
    this.daxSavedModelsLoading = true;
    this.daxSavedModelsMessage = '';
    this.daxModelService.list({ status: 'Active', page: 1, pageSize: 100 }).pipe(
      expand((page, index) => page.items.length && (index + 1) * 100 < page.total
        ? this.daxModelService.list({ status: 'Active', page: index + 2, pageSize: 100 }) : EMPTY),
      reduce((models, page) => [...models, ...page.items], [] as SavedDaxModelDto[]),
      takeUntil(this.destroy$),
    ).subscribe({
      next: models => {
        this.daxSavedModelsById.clear();
        models.filter(model => model.status === 'Active').forEach(model => this.daxSavedModelsById.set(String(model.id), model));
        this.daxSavedModelsCatalog = [...this.daxSavedModelsById.values()].map(model => ({
          id: String(model.id), name: model.name, expression: model.expression, tags: [...model.columns],
          subtitle: `${model.calculatedBy} · ${model.operation ?? ''} · ${model.columns.length} columns`,
        }));
        this.daxSavedModelsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.daxSavedModelsById.clear();
        this.daxSavedModelsCatalog = [];
        this.daxSavedModelsLoading = false;
        this.daxSavedModelsMessage = 'Could not load saved DAX models.';
        this.cdr.markForCheck();
      },
    });
  }

  get daxAddedToChart(): DaxSavedModelCard[] {
    return this.daxModel.measures.filter(measure => measure.savedModelId != null).map(measure => ({
      id: measure.id, sourceId: String(measure.savedModelId), name: measure.name, expression: measure.expression,
      tags: [...(measure.columns ?? [])],
      subtitle: `${measure.evaluationScope === 'row' ? 'Row' : 'Column'} · ${measure.operation ?? ''} · ${measure.columns?.length ?? 0} columns`,
    }));
  }

  setDaxTab(tab: 'saved' | 'create'): void {
    this.daxActiveTab = tab;
    if (tab === 'saved') this.loadSavedDaxModels();
    this.cdr.markForCheck();
  }

  get filteredDaxSavedModels(): DaxSavedModelCard[] {
    const query = this.daxSavedModelsSearch.trim().toLowerCase();
    if (!query) return this.daxSavedModelsCatalog;
    return this.daxSavedModelsCatalog.filter(model => model.name.toLowerCase().includes(query));
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

  addSelectedDaxSavedModelsToChart(): void {
    if (!this.daxSavedModelsSelectedCount) return;
    if (!this.daxSourceColumns.length) {
      this.daxSavedModelsMessage = 'Choose a data source first: saved models are checked against its columns.';
      this.cdr.markForCheck();
      return;
    }
    const existingSourceIds = new Set(this.daxModel.measures.map(measure => measure.savedModelId));
    const names = new Set(this.daxModel.measures.map(measure => measure.name.trim().toLowerCase()));
    const added: DaxMeasureConfig[] = [];
    const skipped: string[] = [];
    for (const id of this.daxSavedModelSelectedIds) {
      const model = this.daxSavedModelsById.get(id);
      if (!model || existingSourceIds.has(model.id)) continue;
      const scope: DaxEvaluationScope = model.calculatedBy === 'Row' ? 'row' : 'column';
      const error = validateDaxExpression(model.expression, this.daxSourceColumns, scope);
      if (error) { skipped.push(`${model.name}: ${error}`); continue; }
      const originalName = model.name.trim() || 'New Metric';
      let name = originalName;
      for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${originalName} (${suffix})`;
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
      const kept = this.daxModel.measures.filter(measure => measure.name.trim() || measure.expression.trim());
      this.daxModel = { ...this.daxModel, enabled: true, measures: [...kept, ...added], selectedMeasureId: added[0].id };
      this.selectDaxMeasure(added[0].id);
    }
    this.cdr.markForCheck();
  }

  removeDaxAddedToChartItem(id: string): void {
    if (this.daxAddedToChart.some(item => item.id === id)) this.removeDaxMeasure(id);
  }

  /** Opens the imported measure in the existing editor. */
  editDaxAddedToChartItem(id: string): void {
    this.selectDaxMeasure(id);
    this.setDaxTab('create');
  }

  // Conditional Filters: row-level data filters that scope which source rows the report shows.
  conditionalFiltersSectionExpanded = false;
  conditionalFilters: ReportConditionalFilter[] = [];
  readonly conditionalOperatorOptions = ['contains', 'starts with', 'ends with', 'equals', 'greater than'];
  readonly conditionalModeOptions = ['Include', 'Exclude'];
  private nextConditionalFilterId = 1;

  // Row grouping (AG Grid): ordered fields that group rows, plus per-field aggregations.
  rowGroupSectionExpanded = false;
  rowGroupFieldSearch = '';
  rowGroupFields: string[] = [];
  rowGroupAggs: Record<string, 'sum' | 'avg'> = {};
  // Per-field background color for that field's group title rows in the grid.
  rowGroupColors: Record<string, string> = {};
  // Row grouping is managed only via the right panel; hide AG Grid's drag-to-group bar.
  gridRowGroupPanelShow: 'always' | 'onlyWhenGrouping' | 'never' = 'never';
  // Row groups start fully expanded (-1 = all levels); users can still collapse/expand by clicking.
  gridGroupDefaultExpanded = -1;
  gridSideBar: Record<string, unknown> = {
    toolPanels: [
      {
        id: 'columns',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
        toolPanelParams: { suppressRowGroups: false, suppressValues: false, suppressPivots: false, suppressPivotMode: false },
      },
      {
        id: 'filters',
        labelDefault: 'Filters',
        labelKey: 'filters',
        iconKey: 'filter',
        toolPanel: 'agFiltersToolPanel',
      },
    ],
    defaultToolPanel: '',
  };
  // Numeric-coercing sum/avg so string data aggregates correctly (see REPORT_AGG_FUNCS).
  readonly gridAggFuncs = REPORT_AGG_FUNCS;

  /** A subtotal (aggregation) row rendered after each group's rows when enabled. */
  get groupTotalRow(): 'bottom' | undefined {
    return this.subtotalAfterGroup ? 'bottom' : undefined;
  }

  /** The grand total is always a controlled pinned row (contiguous with the Sum/Average rows).
   *  AG Grid's native footer floats at the viewport bottom, detaching it from the totals block. */
  get grandTotalRow(): 'bottom' | undefined {
    return undefined;
  }

  columnFieldSearch = '';
  columnFields: string[] = [];
  columnConfigs: Record<string, ColumnConfig> = {};
  private nextCalculatedIndex = 1;
  calculatedFields: CalculatedField[] = [];

  // Calculated field modal state
  showCalcModal = false;
  calcName = '';
  calcColumnA = '';
  calcColumnB = '';
  calcOperation: CalcOperation = 'add';
  readonly calcOperations: { value: CalcOperation; label: string }[] = [
    { value: 'add', label: 'A + B' },
    { value: 'subtract', label: 'A − B' },
    { value: 'multiply', label: 'A × B' },
    { value: 'divide', label: 'A ÷ B' },
    { value: 'percentage', label: '(A / B) × 100' },
  ];

  // Conditional-formatting rules + modal state
  conditionalRules: ConditionalRule[] = [];
  showConditionalModal = false;
  cfFields: string[] = [];
  cfOperator: CfOperator = 'gt';
  cfValue = '';
  cfValue2 = '';
  cfBgColor = '#FEF3C7';
  cfUseBgColor = true;
  cfTextColor = '#111827';
  cfUseTextColor = false;
  cfBold = false;
  cfScope: CfScope = 'column';
  readonly cfScopeOptions: { value: CfScope; label: string }[] = [
    { value: 'column', label: 'Column only' },
    { value: 'row', label: 'Row' },
    { value: 'report', label: 'Entire report' },
  ];
  readonly cfOperators: { value: CfOperator; label: string }[] = [
    { value: 'gt', label: 'Greater than' },
    { value: 'gte', label: 'Greater than or equal' },
    { value: 'lt', label: 'Less than' },
    { value: 'lte', label: 'Less than or equal' },
    { value: 'eq', label: 'Equal to' },
    { value: 'neq', label: 'Not equal to' },
    { value: 'between', label: 'Between' },
    { value: 'contains', label: 'Contains text' },
    { value: 'startsWith', label: 'Starts with' },
    { value: 'isEmpty', label: 'Is empty' },
    { value: 'notEmpty', label: 'Is not empty' },
    { value: 'duplicate', label: 'Duplicate values' },
  ];

  readonly totalOptions = ['Sum', 'Average', 'Count'];

  subtotalAfterGroup = false;
  grandTotalAtBottom = false;

  get filteredColumnFields(): string[] {
    const term = this.columnFieldSearch.trim().toLowerCase();
    return this.selectedRawFields.filter(f => !term || f.toLowerCase().includes(term));
  }

  get filteredRowGroupFields(): string[] {
    const term = this.rowGroupFieldSearch.trim().toLowerCase();
    return this.selectedRawFields.filter(f => !term || f.toLowerCase().includes(term));
  }

  readonly reportTypes: ReportTypeOption[] = [
    { id: 'table', label: 'Table' },
    { id: 'summary', label: 'Summary Cards' },
    { id: 'chart', label: 'Chart' },
  ];
  selectedReportType: ReportTypeId | null = null;

  readonly metricOptions = ['Count (F)', 'Sum (Qty)', 'Average'];
  metric = 'Count (F)';

  showTotals = false;
  readonly sortByOptions = ['Name A-Z', 'Newest first', 'Oldest first'];
  sortBy = 'Name A-Z';
  limitCategory: LimitCategory = 'all';

  // ─── Setup Options: apply a previously-saved Setup-tab preset ──
  showSavedSetupModal = false;
  savedSetupModalMode: 'use' | 'save' = 'use';
  savedSetupSearch = '';
  customSetupName = '';
  saveSetupValidationError = '';
  selectedSavedSetupId: number | null = null;
  savedSetupsLoading = false;

  savedReportSetups: SavedReportSetup[] = [
    //get reports come here
    // { id: 'r1', name: 'Monthly Activity Report', reportTypeLabel: 'Table', source: 'activities', lastUsed: '12-Sep-26', accent: 'blue',
    //   config: { dataSourceMode: 'table', selectedDataModelId: 'activities', selectedRawFields: ['Activity Name', 'Well', 'Discipline', 'Status'], columnFields: ['Discipline', 'Status'], rowGroupFields: [], subtotalAfterGroup: false, grandTotalAtBottom: false, showTotals: false, selectedReportType: 'table', metric: 'Count (F)', sortBy: 'Name A-Z', limitCategory: 'all' } },
    // { id: 'r2', name: 'Well Status Summary', reportTypeLabel: 'Summary Cards', source: 'wells', lastUsed: '10-Sep-26', accent: 'green',
    //   config: { dataSourceMode: 'table', selectedDataModelId: 'wells', selectedRawFields: ['Well Name', 'Cluster', 'Status'], columnFields: ['Status'], rowGroupFields: [], subtotalAfterGroup: false, grandTotalAtBottom: false, showTotals: true, selectedReportType: 'summary', metric: 'Count (F)', sortBy: 'Name A-Z', limitCategory: 'all' } },
    // { id: 'r3', name: 'Grouped Cluster Report', reportTypeLabel: 'Table', source: 'wells', lastUsed: '05-Sep-26', accent: 'purple',
    //   config: { dataSourceMode: 'table', selectedDataModelId: 'wells', selectedRawFields: ['Well Name', 'Cluster', 'Progress'], columnFields: ['Cluster'], rowGroupFields: ['Cluster'], subtotalAfterGroup: true, grandTotalAtBottom: true, showTotals: true, selectedReportType: 'table', metric: 'Sum (Qty)', sortBy: 'Newest first', limitCategory: 'all' } },
  ];

  /** Which preview accordion sections (2-5) are expanded in the Use Saved Setup modal. */
  savedSetupOpenSections = new Set<number>([2]);

  toggleSavedSetupSection(n: number): void {
    if (this.savedSetupOpenSections.has(n)) this.savedSetupOpenSections.delete(n);
    else this.savedSetupOpenSections.add(n);
  }

  isSavedSetupSectionOpen(n: number): boolean {
    return this.savedSetupOpenSections.has(n);
  }

  get filteredSavedReportSetups(): SavedReportSetup[] {
    const t = this.savedSetupSearch.trim().toLowerCase();
    return t ? this.savedReportSetups.filter(s => s.customName.toLowerCase().includes(t)) : this.savedReportSetups;
  }

  get selectedSavedReportSetup(): SavedReportSetup | null {
    return this.savedReportSetups.find(s => s.id === this.selectedSavedSetupId) ?? this.savedReportSetups[0] ?? null;
  }

  openSavedSetupModal(): void {
    this.savedSetupModalMode = 'use';
    this.savedSetupSearch = '';
    this.savedSetupOpenSections = new Set<number>([2]);
    this.showSavedSetupModal = true;
    this.loadSavedSetups();
  }
  
  openSaveSetupModal(): void {
    this.savedSetupModalMode = 'save';
    const activeSavedName = this.selectedSavedReportSetup?.customName ?? this.customSetupName;
    this.customSetupName = (activeSavedName ?? '').trim();
    this.saveSetupValidationError = '';
    this.savedSetupOpenSections = new Set<number>([2]);
    this.showSavedSetupModal = true;
  }

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

  get saveSetupSourceName(): string {
    return this.currentSource().sourceName;
  }

  get saveSetupPreview(): SavedReportSetupPreview {
    return this.buildSetupPreview({
      conditionalFilters: this.conditionalFilters,
      parameterFilters: this.parameterFilters,
      daxModel: this.daxModel,
    });
  }

  get saveSetupColumnGroupingFields(): string[] {
    return this.selectedRawFields.filter(field => {
      const config = this.columnConfigs[field];
      return !!config?.group?.trim() || !!config?.subGroup?.trim();
    });
  }

  /** Fetches the saved template for the current data source (getBySource) and lists it in the modal. */
  private loadSavedSetups(): void {
    const { type: sourceType } = this.currentSource();
    const customName = this.customSetupName.trim();
    this.savedSetupsLoading = true;
    this.savedReportSetups = [];
    this.selectedSavedSetupId = null;
    this.cdr.markForCheck();
    // if (!customName) {
    //   this.savedSetupsLoading = false;
    //   this.cdr.markForCheck();
    //   return;
    // }
    this.subs.push(this.reportTemplates.getBySource(sourceType, customName).subscribe({
      next: (tpls) => {
        this.savedReportSetups = (tpls ?? [])
          .slice()
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .map((t, i) => this.templateToSavedSetup(t, i));
        this.selectedSavedSetupId = this.savedReportSetups[0]?.id ?? null;
        this.savedSetupsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.savedReportSetups = [];
        this.selectedSavedSetupId = null;
        this.savedSetupsLoading = false;
        this.cdr.markForCheck();
      },
    }));
  }

  /** Maps a DB template into the modal's display+apply shape. */
  private readonly savedSetupAccents: SavedReportSetup['accent'][] = ['blue', 'green', 'purple', 'orange', 'yellow'];

  /** Summarizes conditional filters, data transformation and DAX from a template's config for the preview panel. */
  private buildSetupPreview(cfg: any): SavedReportSetupPreview {
    const conditionalFilters: string[] = (cfg?.conditionalFilters ?? []).map((f: any) => {
      const mode = f.mode ? ` (${f.mode})` : '';
      return `${f.label || f.sourceColumn || 'Filter'}: ${f.sourceColumn ?? ''} ${f.operator ?? ''} ${f.valueText ?? ''}${mode}`
        .replace(/\s+/g, ' ').trim();
    });
    const transformations: string[] = (cfg?.parameterFilters ?? []).map((r: ParameterFilterRule) => {
      const cols = getRuleSourceColumns(r).join(', ');
      return `${this.getParameterActionLabel(r.action)}${cols ? ' · ' + cols : ''}`;
    });
    const daxModel = cfg?.daxModel;
    const daxMeasures: string[] = (daxModel?.measures ?? [])
      .filter((m: any) => m?.expression?.trim())
      .map((m: any) => `${m.name || 'Measure'}: ${m.expression}`);
    return {
      conditionalFilters,
      transformations,
      daxEnabled: !!daxModel?.enabled,
      daxMeasures,
    };
  }

  private templateToSavedSetup(t: ReportTemplateDto, index: number): SavedReportSetup {
    let cfg: any = {};
    try { cfg = JSON.parse(t.templateJson ?? '{}'); } catch { cfg = {}; }
    const cols: any[] = Array.isArray(cfg.columns) ? cfg.columns : [];
    const selectedRawFields = cols.map(c => c.field).filter(Boolean);
    const columnFields = cols.filter(c => c.shown !== false).map(c => c.field).filter(Boolean);
    const columnGroupingFields = cols
      .filter(c => c.shown !== false && (c.group || c.subGroup))
      .map(c => c.field)
      .filter(Boolean);
    const rowGroupFields = cols.filter(c => c.rowGroup)
      .sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0))
      .map(c => c.field);
    const customName = t.customName?.trim() || t.sourceName;
    const reportType = (cfg.selectedReportType ?? null) as ReportTypeId | null;
    return {
      id: t.id,
      customName,
      sourceName: t.sourceName,
      sourceType: t.sourceType,
      templateJson: t.templateJson,
      type: t.type,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      viewId: t.viewId,
      accent: this.savedSetupAccents[index % this.savedSetupAccents.length],
      preview: this.buildSetupPreview(cfg),
      config: {
        dataSourceMode: (t.sourceType === 'View' ? 'view' : 'table'),
        selectedDataModelId: t.sourceName,
        selectedRawFields,
        columnFields: columnFields.length ? columnFields : selectedRawFields,
        columnGroupingFields,
        rowGroupFields,
        subtotalAfterGroup: cfg.subtotalAfterGroup ?? false,
        grandTotalAtBottom: cfg.grandTotalAtBottom ?? false,
        showTotals: cfg.showTotals ?? false,
        selectedReportType: reportType,
        metric: cfg.metric ?? this.metric,
        sortBy: cfg.sortBy ?? this.sortBy,
        limitCategory: 'all',
      },
    };
  }

  closeSavedSetupModal(): void {
    this.showSavedSetupModal = false;
    this.saveSetupValidationError = '';
  }

  onSavedSetupSearchChange(customName: string): void {
    this.savedSetupSearch = customName;
    this.customSetupName = customName;
    this.loadSavedSetups();
  }

  selectSavedSetup(id: number): void {
    this.selectedSavedSetupId = id;
    const selected = this.savedReportSetups.find(s => s.id === id);
    if (selected?.customName) {
      this.customSetupName = selected.customName;
    }
  }

  applySavedSetup(): void {
    const setup = this.selectedSavedReportSetup;
    if (!setup) { this.closeSavedSetupModal(); return; }
    // When the saved setup targets the same source, restore the full design (columns + row
    // groupings + settings). For a different source only the colors/style properties apply,
    // since its columns don't exist here. The report name is populated in both cases.
    if (setup.templateJson) {
      let keyedBySource = false;
      try {
        // Template formatting is keyed by source column; this report's own formatting is moved to
        // source keys while the template is overlaid, then everything is keyed by the final
        // displayed names — so renames on either side never orphan formatting.
        const cfg = toSourceColumnKeys(JSON.parse(setup.templateJson));
        const currentName = this.currentSource().sourceName;
        const sameSource = !!setup.sourceName && !!currentName
          && setup.sourceName.toLowerCase() === currentName.toLowerCase();
        const renamesBefore = this.columnKeyRenames ?? this.currentColumnRenames();
        this.renameColumnKeyedState(renamesBefore, new Map(), false);
        keyedBySource = true;

        // Keep this report's own settings; add only template items whose columns exist here.
        const own = structuredClone(this.columnKeyedState());
        const ownFilters = structuredClone(this.conditionalFilters);
        const ownDax = cloneDaxModel(this.daxModel);
        const ownRowPaint = structuredClone({
          rowColors: this.rowColors, rowTextColors: this.rowTextColors, pageRowColors: this.pageRowColors,
          summaryRowColors: this.summaryRowColors, summaryRowTextColors: this.summaryRowTextColors,
        });
        const rules = mergeTemplateRules(this.parameterFilters, cfg.parameterFilters ?? [], this.columnKeyFields);
        const available = columnNameSet([
          ...columnsAfterRules(this.columnKeyFields, rules),
          ...Object.keys(this.columnConfigs).filter(field => this.columnConfigs[field]?.custom),
          ...(sameSource ? (cfg.columns ?? []).filter(column => column.custom).map(column => column.field) : []),
          ...[...ownDax.measures, ...(cfg.daxModel?.measures ?? [])].map(measure => measure.name?.trim() ?? ''),
          ROW_NUMBER_COL_ID,
        ]);
        const template = { ...dropMissingColumnKeys(cfg, available), parameterFilters: rules, conditionalFilters: [], daxModel: undefined };

        if (sameSource) {
          this.mergeSavedSetupColumns(template);
          this.restoreFiltersFromConfig(template);
          this.restoreSettingsFromConfig(template);
          this.restoreAppearanceFromConfig(template);
        } else {
          // Different source: only colors/fonts apply. Structural, data-bound properties
          // (row layout, manual/deleted rows, merges, calculated fields) reference rows and
          // fields that don't exist here and would wipe out the grid, so they're skipped.
          this.applyStyleOnlyFromConfig(template);
          // Column grouping is keyed by column name, so it carries over to same-named columns.
          this.mergeSavedSetupGrouping(template);
        }
        this.restoreRulesFromConfig(template);
        Object.assign(this, mergeReportColumnKeys(own, this.columnKeyedState()));
        this.rowColors = { ...ownRowPaint.rowColors, ...this.rowColors };
        this.rowTextColors = { ...ownRowPaint.rowTextColors, ...this.rowTextColors };
        this.pageRowColors = { ...ownRowPaint.pageRowColors, ...this.pageRowColors };
        this.summaryRowColors = { ...ownRowPaint.summaryRowColors, ...this.summaryRowColors };
        this.summaryRowTextColors = { ...ownRowPaint.summaryRowTextColors, ...this.summaryRowTextColors };
        const renamesAfter = this.currentColumnRenames();
        this.renameColumnKeyedState(new Map(), renamesAfter, false);

        // This report's DAX / conditional filters may reference its earlier rename outputs.
        const followRenames = renamedOutputRenamer(renamesBefore, renamesAfter);
        this.conditionalFilters = mergeConditionalFilters(
          renameConditionalFilterColumns(ownFilters, followRenames), cfg.conditionalFilters ?? [], available);
        this.nextConditionalFilterId = this.conditionalFilters.reduce((max, f) => Math.max(max, f.id + 1), 1);
        this.daxModel = mergeDaxModels(renameDaxModelColumns(ownDax, followRenames, renamesBefore.values()), cfg.daxModel, available);
        this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
        this.syncDaxSelectionFromModel();
        this.columnKeyRenames = renamesAfter;
      } catch {
        // Source-keyed formatting is re-keyed to the displayed names on the next sync.
        if (keyedBySource) this.columnKeyRenames = new Map();
        this.notify.showError('Failed to apply the saved setup.');
      }
      this.showSavedSetupModal = false;
      this.rebuildPreviewGrid();
      this.cdr.markForCheck();
      return;
    }
    const c = setup.config;
    this.dataSourceMode = c.dataSourceMode;
    this.selectedDataModelId = c.selectedDataModelId;
    this.selectedRawFields = [...c.selectedRawFields];
    this.columnFields = [...c.columnFields];
    this.rowGroupFields = [...c.rowGroupFields];
    this.subtotalAfterGroup = c.subtotalAfterGroup;
    this.grandTotalAtBottom = c.grandTotalAtBottom;
    this.showTotals = c.showTotals;
    this.selectedReportType = c.selectedReportType;
    this.metric = c.metric;
    this.sortBy = c.sortBy;
    this.limitCategory = c.limitCategory;
    this.showSavedSetupModal = false;
    this.rebuildPreviewGrid();
    this.cdr.markForCheck();
  }

  // ─── "Save as Reusable Setup" — bundles sections 2-5 (Column Selection through Total) ──
  reusableSetupSaved = false;
  reusableSetupSaving = false;
  private reusableSetupSavedTimer: ReturnType<typeof setTimeout> | null = null;

  saveReusableSetup(): void {
    // const accents: SavedReportSetup['accent'][] = ['blue', 'green', 'purple', 'orange', 'yellow'];
    // const setup: SavedReportSetup = {
    //   id: `setup-${Date.now()}`,
    //   name: `${this.selectedDataModel?.label ?? 'Report'} Setup`,
    //   reportTypeLabel: this.reportTypes.find(t => t.id === this.selectedReportType)?.label ?? 'Table',
    //   source: this.selectedDataModelId || 'Source',
    //   lastUsed: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }),
    //   accent: accents[this.savedReportSetups.length % accents.length],
    //   config: {
    //     dataSourceMode: this.dataSourceMode,
    //     selectedDataModelId: this.selectedDataModelId,
    //     selectedRawFields: [...this.selectedRawFields],
    //     columnFields: [...this.columnFields],
    //     rowGroupFields: [...this.rowGroupFields],
    //     subtotalAfterGroup: this.subtotalAfterGroup,
    //     grandTotalAtBottom: this.grandTotalAtBottom,
    //     showTotals: this.showTotals,
    //     selectedReportType: this.selectedReportType,
    //     metric: this.metric,
    //     sortBy: this.sortBy,
    //     limitCategory: this.limitCategory,
    //   },
    // };
    // this.savedReportSetups = [setup, ...this.savedReportSetups];
    this.openSaveSetupModal();
  }

  confirmSaveReusableSetup(): void {
    const customName = this.customSetupName.trim();
    if (this.reusableSetupSaving) return;
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
    if (this.hasDuplicateParameterFilters) {
      this.saveSetupValidationError = 'Data Transformation with same action, source column and rule parameter cannot be repeated.';
      return;
    }
    this.saveSetupValidationError = '';
    this.persistTemplate(customName);
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

  // Appearance tab — optional print/export styling, kept separate from the
  // Setup tab's report-definition fields above.
  headerBannerExpanded = false;
  logosExpanded = false;
  colorThemeExpanded = false;
  typographyExpanded = false;

  headerRowColor = '';
  headerCellColors: Record<string, string> = {};
  rowColors: Record<number, string> = {};
  rowColorsByKey: Record<string, string> = {};
  summaryRowColors: Record<string, string> = {};
  summaryRowTextColors: Record<string, string> = {};
  // Row background by position within a page (0-based) — same position colors on every page.
  pageRowColors: Record<number, string> = {};
  cellColors: Record<string, string> = {};
  headerRowTextColor = '';
  headerCellTextColors: Record<string, string> = {};
  rowTextColors: Record<number, string> = {};
  rowTextColorsByKey: Record<string, string> = {};
  cellTextColors: Record<string, string> = {};
  pinnedColumns: string[] = [];
  dataBarColumns: string[] = [];
  /** Source records behind a cell or group row, shown by "Drill to Detail". */
  reportDrill: { subtitle: string; columns: ColDef[]; rows: Record<string, unknown>[] } | null = null;
  readonly reportDrillDefaultColDef: ColDef = { sortable: true, resizable: true, filter: true, minWidth: 140 };
  mergedCellRanges: MergedCellRange[] = [];

  //Excel-like manual row edits (insert/delete rows, edit blank cells)
  rowLayout: RowLayoutRef[] = [];
  manualRows: Record<string, Record<string, unknown>> = {};
  cellOverrides: Record<string, unknown> = {};
  deletedRowIndices: number[] = [];

  //"Split Cells" embedded sub-grids (keyed `rowIndex:field`) + its dialog
  cellEmbeds: Record<string, CellEmbed> = {};
  showEmbedDialog = false;
  embedSpan: 'horizontal' | 'vertical' = 'horizontal';
  embedCount = 2;
  private embedTargets: { rows: { rowIndex: number; rowColorKey?: string }[]; fields: string[] } | null = null;

  // Text orientation (keyed `rowIndex:field` for cells, field for headers)
  cellOrientations: Record<string, TextOrientation> = {};
  headerCellOrientations: Record<string, TextOrientation> = {};
  // Horizontal text alignment: per data cell (page-relative key) and per header column.
  cellAlignments: Record<string, TextAlign> = {};
  headerCellAlignments: Record<string, TextAlign> = {};
  // Report-wide alignment applied when no cell/header is selected (overridden by the per-cell/header maps).
  reportAlignment?: TextAlign;
  // Column group / sub-group header alignment, keyed by group / sub-group name (default center).
  groupHeaderAlignments: Record<string, TextAlign> = {};
  subGroupHeaderAlignments: Record<string, TextAlign> = {};
  // Outlined borders: per data cell (page-relative key) and per header column, stored as the set
  // of sides each cell carries (so shared edges are drawn once — no doubled lines).
  cellBorders: Record<string, CellBorder> = {};
  headerCellBorders: Record<string, CellBorder> = {};
  // Report-wide border placement applied when no cell/header is selected (overridden by the per-cell/header maps).
  reportBorder?: BorderType;
  // Custom header text for the auto '#' (row-number) column; empty/undefined = default '#'.
  rowNumberHeader?: string;
  // Open state of the toolbar border options flyout (Google-Sheets-style placement grid).
  showBorderMenu = false;

  // ─── AG Grid preview ──────────────────────────────────────────────────────
  gridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    backgroundColor: '#ffffff',
    borderColor: '#E2E7EF',
    borderRadius: 8,
    headerBackgroundColor: '#E8F0FC',
    headerTextColor: '#344054',
    headerFontWeight: 700,
    rowHoverColor: '#F0F4FF',
    oddRowBackgroundColor: '#ffffff',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
    // Header/body separator is drawn by the shared util (headerBorderStyles) so a manual bottom
    // border on a header doesn't stack with AG's own line (the doubled line users saw).
    headerRowBorder: false,
  });
  gridColumnDefs: (ColDef | ColGroupDef)[] = [];
  gridDefaultColDef: ColDef = {
    resizable: true,
    minWidth: 100,
    editable: (params) => this.isCellEditable(params),
    // Tags each body cell with color-derived class ids so AG Grid's native Excel export paints it (see gridExcelStyles).
    cellClass: (params) => this.exportCellClass(params),
    // Tags the header cell too, so a column's header color (set in Appearance) also exports.
    headerClass: (params) => this.exportHeaderClass(params.column?.getColDef().field ?? params.column?.getColId()),
  };
  // Excel-export style registry, rebuilt from the current cell/row/column colors so the exported .xlsx matches the preview.
  gridExcelStyles: ExcelStyle[] = [];
  // Size columns to their content during initial layout (before paint) so the first render doesn't flicker.
  gridAutoSizeStrategy = { type: 'fitCellContents' as const };
  gridPinnedBottomRowData: Record<string, unknown>[] = [];

  // enableCellSpan is only turned on when the report has a ROW merge — always-on span positioning
  // breaks the pinned Sum/Average/Count totals rows (they cascade diagonally). Column merges use colSpan.
  gridEnableCellSpan = false;

  /** Subtotal, grand-total and pinned total rows render bold + 2pt larger than body rows. */
  getRowClass = (params: RowClassParams): string =>
    params.node.footer || params.node.rowPinned === 'bottom' ? 'report-total-row' : '';

  /** Paints a group title row with the color the user picked for its grouping field. */
  getRowStyle = (params: RowClassParams): Record<string, string> | undefined => {
    const node = params.node;
    // Footer / pinned totals rows (Sum/Average/Total/DAX measures) keep a fixed size (set in the
    // .report-total-row rule) — they intentionally do NOT follow the "Footer Font Size" setting,
    // which only sizes the text banner.
    if (node?.footer || node?.rowPinned === 'bottom') {
      return getSummaryRowStyle(this, getPinnedSummaryLabel(node));
    }
    return getReportGroupRowStyle(this.buildLiveConfig(), node);
  };

  // Rows containing a vertical-orientation cell get an explicit tall height so the rotated
  // text can wrap into multiple columns (AG's autoHeight can't measure rotated content).
  getRowHeight = (params: RowHeightParams): number | undefined => {
    if (!params.node?.rowPinned && !params.node?.group && !params.node?.footer
      && rowHasVerticalCell(this.cellOrientations, params.node?.rowIndex, params.data)) {
      return VERTICAL_CELL_ROW_HEIGHT;
    }
    return this.gridRowHeight;
  };

  // Total/grand-total footer label reflects the grouped column's aggregation (Average/Sum),
  // falling back to "Total" when none is set.
  gridAutoGroupColumnDef: ColDef = {
    ...buildReportAutoGroupColumnStyles(() => this.buildLiveConfig()),
    minWidth: 180,
    // Long group labels are truncated with an ellipsis in a fixed-height row; the tooltip
    // exposes the full text on hover (autoHeight is intentionally avoided — see note below).
    tooltip: (params) => (params.value != null ? String(params.value) : ''),
    // NB: no autoHeight/wrapText here — autoHeight on the auto-group column uses measured row
    // heights, which desyncs the pinned totals row from the frozen '#' column (matches viewer).
    cellRendererParams: {
      footerValueGetter: (params: { colDef?: { showRowGroup?: boolean | string }; value?: unknown }) => {
        const field = typeof params?.colDef?.showRowGroup === 'string' ? params.colDef.showRowGroup : undefined;
        const agg = field ? this.rowGroupAggs[field] : undefined;
        const label = agg === 'avg' ? 'Avg' : agg === 'sum' ? 'Sum' : 'Total';
        const val = params?.value != null ? params.value : '';
        return `${label} ${val}`.trim();
      },
    },
  };
  gridPagination = true;
  gridPaginationPageSize = 20;
  gridPaginationPageSizeSelector = [10, 20, 50, 100];
  gridRowHeight = 42;
  // Popups (context menu, its Export submenu, column menu) render into <body> instead of the grid's
  // own clipped/scrollable container, so they're never cut off at its edges.
  gridPopupParent: HTMLElement = document.body;
  readonly postProcessGridPopup = positionReportPaginationPopup;
  columnSizingMode: 'auto' | 'fit' = 'auto';
  viewMode: TableDensity = 'comfortable';
  private gridApi: GridApi | null = null;
  readonly gridOptions: GridOptions = {
    onGridPreDestroyed: event => {
      if (this.gridApi === event.api) this.gridApi = null;
    },
  };
  readonly expandGridOptions: GridOptions = {
    onGridPreDestroyed: event => {
      if (this.expandGridApi === event.api) this.expandGridApi = null;
    },
  };

  // ─── Undo/redo history (per active sheet) ───────────────────────────────────
  // Debounced snapshots of the sheet state; the top of undoStack is always the current state.
  private undoStack: { snap: ReportSheetSnapshot; json: string }[] = [];
  private redoStack: { snap: ReportSheetSnapshot; json: string }[] = [];
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private isRestoringHistory = false;
  private readonly historyLimit = 50;

  get canUndo(): boolean { return this.undoStack.length > 1; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Expanded-table modal state and its own grid API. */
  showExpandModal = false;
  private expandGridApi: GridApi | null = null;

  /** The grid API only while it's alive — null once destroyed, so deferred calls no-op instead of warning. */
  private get liveGridApi(): GridApi | null {
    return this.gridApi && !this.gridApi.isDestroyed() ? this.gridApi : null;
  }

  /** The expand-modal grid API only while it's alive. */
  private get liveExpandGridApi(): GridApi | null {
    return this.expandGridApi && !this.expandGridApi.isDestroyed() ? this.expandGridApi : null;
  }

  /**
   * Closes any open AG Grid popup (column/context menu) whenever the page
   * scrolls. Registered on `document` in the capture phase so it also fires for
   * scrolls on nested containers (the builder canvas and the grid body) that
   * don't bubble. Without this, the menu — anchored to `document.body` — stays
   * put while the report scrolls, leaving it detached/floating over the content.
   *
   * Scrolls that originate INSIDE an open menu (e.g. a long color submenu list)
   * are ignored — otherwise scrolling within the submenu would dismiss the very
   * menu the user is interacting with.
   */
  private readonly hideGridMenusOnScroll = (event: Event): void => {
    const target = event.target as Node | null;
    if (target instanceof Element && target.closest('.ag-menu, .ag-popup')) return;
    this.liveGridApi?.hidePopupMenu();
    this.liveExpandGridApi?.hidePopupMenu();
  };

  /** Set on a source switch so the next data render auto-fits columns (firstDataRendered fires only once). */
  private autoSizeOnNextRender = false;

  /** Debounces the grid rebuild while a group / sub-group title is being typed (see onColumnGroupTextChanged). */
  private groupTextRebuildTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Group / sub-group titles are typed one character at a time. Rebuilding the live grid on every
   * keystroke makes AG Grid accumulate stale "split" column-group header instances that it never
   * merges back once the columns are contiguous again — leaving a ghost leftover header (e.g. a
   * stray "P" beside the real group) after a title is edited or backspaced away. Debounce the
   * rebuild and recreate the grid (tear down via *ngIf, then rebuild) once typing settles: a
   * freshly built grid has no stale group cache, so the header is always clean. The two-way
   * ngModel binding still updates the title text and the per-group color list live; only the grid
   * rebuild is deferred.
   */
  onColumnGroupTextChanged(): void {
    if (this.groupTextRebuildTimer) clearTimeout(this.groupTextRebuildTimer);
    this.groupTextRebuildTimer = setTimeout(() => {
      this.groupTextRebuildTimer = null;
      if (this.viewDestroyed) return;
      if (this.previewRows.length) {
        this.previewRows = [];
        this.gridPinnedBottomRowData = [];
        this.cdr.detectChanges();
      }
      this.autoSizeOnNextRender = true;
      this.rebuildPreviewGrid();
      this.cdr.detectChanges();
    }, 250);
  }

  /** After new data renders, fit columns so every value shows in full on one line. A source switch
   *  re-runs the full auto-size; other data changes (e.g. a global filter) only widen columns. */
  onMainRowDataUpdated(): void {
    if (this.autoSizeOnNextRender) {
      this.autoSizeOnNextRender = false;
      this.autoSizeAllColumns();
      return;
    }
    if (this.columnSizingMode === 'auto') this.growColumnsToFitValues('main');
  }

  setViewMode(mode: TableDensity): void {
    this.viewMode = mode;
    this.gridRowHeight = mode === 'comfortable' ? 42 : mode === 'compact' ? 32 : 25;
    this.liveGridApi?.resetRowHeights();
  }

  autoSizeAllColumns(): void {
    this.liveGridApi?.autoSizeAllColumns();
    this.columnSizingMode = 'auto';
    this.growColumnsToFitValues('main');
  }

  /** Widens columns to their longest value across all pages (AG autoSize only measures rendered rows). */
  private growColumnsToFitValues(grid: 'main' | 'expand'): void {
    setTimeout(() => {
      const api = grid === 'main' ? this.liveGridApi : this.liveExpandGridApi;
      growReportColumnsToFitValues(api, {
        container: document.querySelector(grid === 'main' ? '.builder-canvas__live-table ag-grid-angular' : '.rb-expand-grid'),
        skipCell: (node, column) =>
          getReportCellSetting(this.cellOrientations, node.data, node.rowIndex, column.getColDef().field ?? '') === 'vertical',
      });
    });
  }

  /** Opens the preview grid in a larger, resizable modal. */
  expandGrid(): void {
    this.showExpandModal = true;
    this.cdr.markForCheck();
  }

  /** Grabs the modal grid's API; column sizing happens on first data render. */
  onExpandGridReady(params: GridReadyEvent): void {
    this.expandGridApi = params.api;
  }

  /** Size columns to their content so all text shows fully (overflow → horizontal scroll). */
  onExpandFirstDataRendered(): void {
    this.liveExpandGridApi?.autoSizeAllColumns();
    this.growColumnsToFitValues('expand');
  }

  /** Closes the modal and persists its column widths/order back to the main grid. */
  closeExpandModal(): void {
    const state = this.liveExpandGridApi?.getColumnState();
    this.showExpandModal = false;
    this.expandGridApi = null;
    if (state?.length) {
      // Apply after the modal grid tears down and the main grid is on screen again.
      setTimeout(() => this.liveGridApi?.applyColumnState({ state, applyOrder: true }), 0);
    }
    this.cdr.markForCheck();
  }

  headerTitle = '';
  headerSubtitle = '';
  headerSubtitle2 = '';
  bannerText = '';

  headerBackgroundColor = 'linear-gradient(90.37deg, #162B6F 0%, #1B3585 30%, #21409A 58%, #2852B1 82%, #315FC2 100%)';
  headerTextColor = '#FFFFFF';
  bannerBackgroundColor = '#EDEFF4';
  bannerTextColor = '#344054';
  groupTextColor = '#FFFFFF';
  subGroupTextColor = '#FFFFFF';

  // Built-in report themes: one-click presets that recolor banner/footer/table-header/group accents together.
  selectedThemeId = '';
  // Opt-in branded zebra striping (alternate rows tinted with the theme accent). Off unless the user enables it.
  brandedRows = false;
  gridAccentColor = '#21409A';
  private gridHeaderBg = '#E8F0FC';
  readonly builtInThemes: ReportBuiltInTheme[] = [
    {
      id: 'corporate-blue', label: 'Corporate Blue',
      bannerBackground: 'linear-gradient(90.37deg, #162B6F 0%, #1B3585 30%, #21409A 58%, #2852B1 82%, #315FC2 100%)', bannerText: '#FFFFFF',
      footerBackground: '#EDEFF4', footerText: '#344054',
      headerRowColor: '#E8F0FC', headerRowTextColor: '#344054',
      groupColor: '#2563EB', subGroupColor: '#7C3AED', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#21409A',
    },
    {
      id: 'ocean-teal', label: 'Ocean Teal',
      bannerBackground: 'linear-gradient(90deg, #0F766E 0%, #0D9488 50%, #14B8A6 100%)', bannerText: '#FFFFFF',
      footerBackground: '#E0F2F1', footerText: '#134E4A',
      headerRowColor: '#CCFBF1', headerRowTextColor: '#134E4A',
      groupColor: '#0D9488', subGroupColor: '#0F766E', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#0D9488',
    },
    {
      id: 'emerald-green', label: 'Emerald Green',
      bannerBackground: 'linear-gradient(90deg, #065F46 0%, #059669 50%, #10B981 100%)', bannerText: '#FFFFFF',
      footerBackground: '#ECFDF5', footerText: '#064E3B',
      headerRowColor: '#D1FAE5', headerRowTextColor: '#064E3B',
      groupColor: '#059669', subGroupColor: '#047857', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#059669',
    },
    {
      id: 'royal-purple', label: 'Royal Purple',
      bannerBackground: 'linear-gradient(90deg, #4C1D95 0%, #6D28D9 50%, #7C3AED 100%)', bannerText: '#FFFFFF',
      footerBackground: '#F5F3FF', footerText: '#4C1D95',
      headerRowColor: '#EDE9FE', headerRowTextColor: '#4C1D95',
      groupColor: '#7C3AED', subGroupColor: '#6D28D9', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#7C3AED',
    },
    {
      id: 'sunset-orange', label: 'Sunset Orange',
      bannerBackground: 'linear-gradient(90deg, #9A3412 0%, #C2410C 50%, #EA580C 100%)', bannerText: '#FFFFFF',
      footerBackground: '#FFF7ED', footerText: '#7C2D12',
      headerRowColor: '#FFEDD5', headerRowTextColor: '#7C2D12',
      groupColor: '#EA580C', subGroupColor: '#C2410C', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#EA580C',
    },
    {
      id: 'crimson-red', label: 'Crimson Red',
      bannerBackground: 'linear-gradient(90deg, #7F1D1D 0%, #B91C1C 50%, #DC2626 100%)', bannerText: '#FFFFFF',
      footerBackground: '#FEF2F2', footerText: '#7F1D1D',
      headerRowColor: '#FEE2E2', headerRowTextColor: '#7F1D1D',
      groupColor: '#DC2626', subGroupColor: '#B91C1C', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#DC2626',
    },
    {
      id: 'slate-minimal', label: 'Slate Minimal',
      bannerBackground: '#334155', bannerText: '#FFFFFF',
      footerBackground: '#F1F5F9', footerText: '#334155',
      headerRowColor: '#E2E8F0', headerRowTextColor: '#1E293B',
      groupColor: '#475569', subGroupColor: '#64748B', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#475569',
    },
    {
      id: 'midnight-dark', label: 'Midnight Dark',
      bannerBackground: 'linear-gradient(90deg, #0F172A 0%, #1E293B 100%)', bannerText: '#F8FAFC',
      footerBackground: '#1E293B', footerText: '#E2E8F0',
      headerRowColor: '#334155', headerRowTextColor: '#F1F5F9',
      groupColor: '#334155', subGroupColor: '#475569', groupText: '#FFFFFF', subGroupText: '#FFFFFF', accent: '#38BDF8',
    },
  ];

  leftLogoUrl = '';
  rightLogoUrl = '';

  columnGroupColors: ColumnGroupColorRow[] = [
    { label: 'Group', level: 0, color: '#2563EB' },
    { label: 'Sub Group', level: 1, color: '#7C3AED' },
  ];
  // Per-sub-group background overrides, keyed by sub-group name.
  subGroupColors: Record<string, string> = {};
  // Per-group background overrides, keyed by group name.
  groupColors: Record<string, string> = {};
  // Per-group / per-sub-group text-color overrides, keyed by group / sub-group name.
  groupTextColors: Record<string, string> = {};
  subGroupTextColors: Record<string, string> = {};

  /** Distinct group names in the report, in column order (drives the per-group color pickers). */
  get groupNames(): string[] {
    const names: string[] = [];
    for (const f of this.selectedRawFields) {
      const g = this.columnConfigs[f]?.group?.trim();
      if (g && !names.includes(g)) names.push(g);
    }
    return names;
  }

  setGroupColor(name: string, color: string): void {
    if (color) this.groupColors[name] = color;
    else delete this.groupColors[name];
    this.rebuildPreviewGrid();
  }

  setGroupTextColor(name: string, color: string): void {
    if (color) this.groupTextColors[name] = color;
    else delete this.groupTextColors[name];
    this.rebuildPreviewGrid();
  }

  /** Distinct sub-group names in the report, in column order (drives the per-sub-group color pickers). */
  get subGroupNames(): string[] {
    const names: string[] = [];
    for (const f of this.selectedRawFields) {
      const sg = this.columnConfigs[f]?.subGroup?.trim();
      if (sg && !names.includes(sg)) names.push(sg);
    }
    return names;
  }

  setSubGroupColor(name: string, color: string): void {
    if (color) this.subGroupColors[name] = color;
    else delete this.subGroupColors[name];
    this.rebuildPreviewGrid();
  }

  setSubGroupTextColor(name: string, color: string): void {
    if (color) this.subGroupTextColors[name] = color;
    else delete this.subGroupTextColors[name];
    this.rebuildPreviewGrid();
  }

  readonly fontFamilyOptions = ['Inter', 'Roboto', 'Arial', 'Georgia'];
  fontFamily = 'Inter';
  fontSize = 13;
  headerFontSize = 16;
  bannerFontSize = 12;
  tableHeadingFontSize = 12;
  /** Column-header row height (px). Default matches the previous tableHeadingFontSize + 24 at font 12. */
  gridHeaderHeight = 36;
  /** Header height auto-applied the first time a header is switched to vertical, so the rotated text fits. */
  private readonly VERTICAL_HEADER_MIN_HEIGHT = 50;
  rightLogoColor = '#111827';

  readonly previewLabels = GROUP_LABELS;
  readonly previewValues = GROUP_VALUES;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly commonApi: CommonApiService,
    private readonly tenantReports: TenantReportsService,
    private readonly reportTemplates: ReportTemplatesService,
    private readonly categoryService: CategoryService,
    private readonly learnVideoService: LearnVideoService,
    private readonly cdr: ChangeDetectorRef,
    private readonly layoutState: LayoutStateService,
    private readonly authService: AuthService,
    private readonly zone: NgZone,
    private readonly exportColors: ReportExportColorService,
    private readonly sheetsService: ReportSheetsService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
    private readonly toastService: ToastService,
    private readonly daxModelService: DaxModelService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  /** ID of existing report being edited (null = new report). */
  editingReportId: number | null = null;
  //isUpdating: boolean = false;//
  savingStatus: 'saved'| 'updated' | 'published'= 'saved';

  ngOnInit(): void {
    this.loadSavedDaxModels();
    document.addEventListener('scroll', this.hideGridMenusOnScroll, true);
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();
    this.applyQuickRange('Till Last Tuesday');
    this.loadPlantFilters();
    this.updateGridTheme();
    this.sheetsService.reset('Sheet 1');

    // When sidebar expands → collapse right panel; when collapsed → show it
    this.subs.push(
      this.layoutState.sidebarCollapsed$.subscribe(collapsed => {
        this.panelCollapsed = !collapsed;
        this.cdr.markForCheck();
      }),
    );

    const params = this.route.snapshot.queryParamMap;
    this.returnUrl = params.get('returnUrl') || this.returnUrl;
    const id = params.get('id');
    const name = params.get('name')?.trim();
    const category = params.get('category');
    const categoryIdParam = params.get('categoryId');
    if (name) {
      this.reportName = name;
    }
    if (category) this.category = category;
    if (categoryIdParam) this.selectedCategoryId = Number(categoryIdParam);
    const description = params.get('description')?.trim();
    if (description) this.reportDescription = description;
    if (id) this.editingReportId = +id;
    else {
      this.reportFiltersLoaded = true;
      this.captureInitialGlobalFilterStateIfReady();
    }
    this.initColumnFields();

    // Load categories and sources
    this.subs.push(
      this.categoryService.getCategoriesByType('report').subscribe((cats) => {
        this.apiCategories = cats;
        if (cats.length) {
          this.categories = cats.map(c => c.categoryName);
        }
      }),
      this.commonApi.getBISources().subscribe((sources) => {
        this.availableSources = sources;
        if (sources.length) {
          this.dataModels = sources.map(s => ({
            id: s.name,
            label: s.name,
            icon: s.sourceType === 'View' ? 'gauge' : 'derrick' as 'derrick' | 'gauge' | 'crew',
            columns: s.columnCount,
            modelType: s.sourceType,
          }));
        }

        if (this.editingReportId) {
          // Edit mode: load report AFTER sources are available. Keep the preview
          // panel's loader up through both the report fetch and its follow-up
          // preview fetch, so the empty-state placeholder never flashes first.
          this.isLoadingPreview = true;
          this.cdr.detectChanges();
          this.loadExistingReport(this.editingReportId);
        } else {
          // New report: no data source selected by default — the user picks one before preview loads.
          this.selectedDataModelId = '';
        }
      }),
    );
  }

  /** Loads an existing report and restores all builder state. */
  private loadExistingReport(reportId: number): void {
    this.subs.push(this.tenantReports.getById(reportId).subscribe({
      next: (report) => {
      this.reportName = report.reportName;
      this.reportDescription = report.description ?? '';
      this.category = report.categoryName || '';
      this.selectedCategoryId = report.categoryId;

      const config = report.reportJson ? this.safeParseConfig(report.reportJson) : null;

      // Multi-page report: rebuild every sheet so a re-save preserves all pages.
      if (config?.sheets && config.sheets.length > 1) {
        this.loadMultiSheetReport(config.sheets);
        this.reportFiltersLoaded = true;
        this.captureInitialGlobalFilterStateIfReady();
        return;
      }

      // Match the saved source name to available data models (case-insensitive)
      const matchedSource = this.availableSources.find(
        s => s.name.toLowerCase() === report.sourceName.toLowerCase()
      );
      this.selectedDataModelId = matchedSource?.name ?? report.sourceName;

      if (config) {
        this.restoreColumnsFromConfig(config);
        this.restoreFiltersFromConfig(config);
        this.restoreParameterFiltersFromConfig(config);
        this.restoreSettingsFromConfig(config);
        this.restoreAppearanceFromConfig(config);
      }
      this.reportFiltersLoaded = true;
      this.captureInitialGlobalFilterStateIfReady();

      if (report.sourceType === 'View') {
        this.dataSourceMode = 'view';
        this.loadDatabaseViews();
        this.loadViewPreviewForEdit(report.sourceName);
      } else {
        this.dataSourceMode = 'table';
        this.loadTablePreview();
      }
      this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingPreview = false;
        this.notify.showError('Failed to load report.');
      },
    }));
  }

  private safeParseConfig(json: string): ReportJsonConfig | null {
    try { return JSON.parse(json) as ReportJsonConfig; } catch { return null; }
  }

  /**
   * Rebuilds every page of a saved multi-sheet report into the sheets service so all pages
   * survive a re-save. Each sheet's builder state is reconstructed from its config; only the
   * active (first) sheet's data is fetched up front — others load lazily on switch.
   */
  private loadMultiSheetReport(sheets: ReportSheetConfig[]): void {
    const snapshots = sheets.map(sheetCfg => {
      this.resetBuilderForNewSheet();
      this.restoreColumnsFromConfig(sheetCfg.config);
      this.restoreFiltersFromConfig(sheetCfg.config);
      this.restoreParameterFiltersFromConfig(sheetCfg.config);
      this.restoreSettingsFromConfig(sheetCfg.config);
      this.restoreAppearanceFromConfig(sheetCfg.config);
      const matched = this.availableSources.find(s => s.name.toLowerCase() === sheetCfg.sourceName.toLowerCase());
      this.dataSourceMode = sheetCfg.sourceType === 'View' ? 'view' : 'table';
      this.selectedDataModelId = matched?.name ?? sheetCfg.sourceName;
      return this.captureSheetState();
    });

    this.sheetsService.seed(sheets.map((s, i) => ({ name: s.name, state: snapshots[i] })));

    // Activate the first sheet and load its live data through the normal edit path.
    this.applySheetState(snapshots[0]);
    this.reportFiltersLoaded = true;
    this.captureInitialGlobalFilterStateIfReady();
    if (this.availableViews.length === 0) this.loadDatabaseViews();
    if (this.dataSourceMode === 'view') {
      this.loadViewPreviewForEdit(this.selectedDataModelId);
    } else {
      this.loadTablePreview();
    }
    this.cdr.detectChanges();
  }

  /** Reloads a view with current global filters without resetting its report columns. */
  private loadViewPreviewForEdit(viewName: string, resetHistory = true): void {
    this.sourcePreviewSubscription?.unsubscribe();
    this.isLoadingPreview = true;
    this.previewRows = [];
    this.cdr.detectChanges();
    this.subs.push(this.sourcePreviewSubscription = this.commonApi.getDatabaseViews().pipe(
      map(views => {
        this.availableViews = views;
        return views.find(v => v.viewName === viewName);
      }),
      switchMap(match => {
        if (!match) throw new Error(`Report source view "${viewName}" was not found.`);
        this.selectedDataModelId = match.viewName;
        return previewReportView(this.commonApi, match.id, { ...this.filterValues }, this.fromDate, this.toDate, this.advancedFilters ?? []);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: ({ columns, rows }) => {
        this.isLoadingPreview = false;
        this.tablePreviewData = { columns, rows };
        if (this.selectedRawFields.length > 0) {
          this.columnFields = [...columns];
          for (const field of this.columnFields) {
            if (!this.columnConfigs[field]) {
              this.columnConfigs[field] = { shown: false, group: '', subGroup: '', total: '', color: '' };
            }
          }
          this.appendCalculatedFields();
        } else {
          this.columnFields = [...columns];
          this.selectedRawFields = [...columns];
          this.columnConfigs = {};
          for (const field of this.columnFields) {
            this.columnConfigs[field] = { shown: true, group: '', subGroup: '', total: '', color: '' };
          }
        }
        this.rebuildPreviewGrid();
        this.cdr.detectChanges();
        if (resetHistory) this.resetHistory();
      },
      error: () => {
        this.isLoadingPreview = false;
        this.notify.showError('Failed to reload report data with the selected global filters.');
        this.cdr.detectChanges();
      },
    }));
  }

  private restoreColumnsFromConfig(config: any): void {
    if (!config.columns?.length) return;
    this.selectedRawFields = config.columns.map((c: any) => c.field);
    this.columnFields = [...this.selectedRawFields];
    this.columnConfigs = {};
    for (const col of config.columns) {
      this.columnConfigs[col.field] = {
        shown: col.shown !== false,
        group: col.group || '',
        subGroup: col.subGroup || '',
        total: col.total || '',
        color: col.color || '',
        custom: col.custom || false,
        header: col.header,
        textColor: col.textColor || '',
      };
    }
    this.restoreRowGroupingFromColumns(config.columns);
  }

  /**
   * Applies a saved setup's styling and row groupings onto the source's already-selected
   * columns without dropping any. Templates only persist styled/grouped columns, so a wholesale
   * replace would wipe the columns auto-populated when the source was picked.
   */
  private mergeSavedSetupColumns(config: any): void {
    const cols: any[] = Array.isArray(config.columns) ? config.columns : [];
    if (!cols.length) return;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (!col.field) continue;
      const present = this.selectedRawFields.includes(col.field);
      // Source fields that this source doesn't provide are skipped, but a saved *custom* column
      // (manually inserted, often renamed + grouped) has no source counterpart — recreate it so
      // its header and column grouping survive the apply, preserving its saved position.
      if (!present && !col.custom) continue;
      if (!present && col.custom) {
        this.insertSavedFieldByOrder(cols, i, col.field, this.selectedRawFields);
        if (col.shown !== false) this.insertSavedFieldByOrder(cols, i, col.field, this.columnFields);
      }
      const existing = this.columnConfigs[col.field] ?? { shown: true, group: '', subGroup: '', total: '', color: '' };
      this.columnConfigs[col.field] = {
        ...existing,
        shown: col.shown !== false,
        group: col.group || existing.group || '',
        subGroup: col.subGroup || existing.subGroup || '',
        total: col.total || existing.total || '',
        color: col.color || existing.color || '',
        custom: col.custom ?? existing.custom ?? false,
        header: col.header ?? existing.header,
        textColor: col.textColor || existing.textColor || '',
      };
    }
    const known = new Set(this.selectedRawFields);
    const savedColumns = cols.filter(c => known.has(c.field));
    // Only a template that defines row grouping changes it; aggregations/colors it doesn't mention are kept.
    if (savedColumns.some(c => c.rowGroup || c.aggFunc || c.rowGroupColor)) {
      const own = { fields: [...this.rowGroupFields], aggs: { ...this.rowGroupAggs }, colors: { ...this.rowGroupColors } };
      this.restoreRowGroupingFromColumns(savedColumns);
      if (!this.rowGroupFields.length) this.rowGroupFields = own.fields;
      this.rowGroupAggs = { ...own.aggs, ...this.rowGroupAggs };
      this.rowGroupColors = { ...own.colors, ...this.rowGroupColors };
    }
  }

  /**
   * Different-source apply: copies a template's column Group / Sub group onto this source's
   * columns with the same (case-insensitive) name. Columns this source lacks are skipped, and
   * the grouping stays keyed by the source column, so Data Transformation renames still resolve.
   */
  private mergeSavedSetupGrouping(config: any): void {
    const cols: any[] = Array.isArray(config?.columns) ? config.columns : [];
    const fieldsByName = new Map(this.selectedRawFields.map(field => [field.toLowerCase(), field]));
    for (const col of cols) {
      const group = typeof col?.group === 'string' ? col.group.trim() : '';
      const subGroup = typeof col?.subGroup === 'string' ? col.subGroup.trim() : '';
      if (!col?.field || (!group && !subGroup)) continue;
      const field = fieldsByName.get(String(col.field).toLowerCase());
      if (!field) continue;
      const existing = this.columnConfigs[field] ?? { shown: true, group: '', subGroup: '', total: '', color: '' };
      this.columnConfigs[field] = {
        ...existing,
        group: group || existing.group || '',
        subGroup: subGroup || existing.subGroup || '',
      };
    }
  }

  /**
   * Inserts a recreated custom field into `target` just after the nearest preceding saved column
   * that already exists in `target`, so the restored column keeps its saved relative position
   * (falling back to the front when no earlier saved column is present).
   */
  private insertSavedFieldByOrder(savedCols: any[], idx: number, field: string, target: string[]): void {
    let at = 0;
    for (let j = idx - 1; j >= 0; j--) {
      const prev = target.indexOf(savedCols[j]?.field);
      if (prev >= 0) { at = prev + 1; break; }
    }
    target.splice(at, 0, field);
  }

  /** Rebuilds the ordered row-group field list and per-field aggregations from saved columns. */
  private restoreRowGroupingFromColumns(columns: any[]): void {
    const grouped = (columns ?? []).filter(c => c.rowGroup);
    grouped.sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0));
    this.rowGroupFields = grouped.map(c => c.field);
    this.rowGroupAggs = {};
    this.rowGroupColors = {};
    for (const c of columns ?? []) {
      if (c.aggFunc === 'sum' || c.aggFunc === 'avg') this.rowGroupAggs[c.field] = c.aggFunc;
      if (c.rowGroupColor) this.rowGroupColors[c.field] = c.rowGroupColor;
    }
  }

  private restoreFiltersFromConfig(config: any): void {
    if (!config.filters?.length) return;
    for (const f of config.filters) {
      if (!f.key || !f.value) continue;
      if (f.key === 'fromDate') this.fromDate = f.value;
      else if (f.key === 'toDate') this.toDate = f.value;
      else if (f.key === 'quickRange') this.quickRange = f.value;
      else if (this.filterFields.some(field => field.key === f.key)) this.filterValues[f.key] = f.value;
    }
  }

  private restoreSettingsFromConfig(config: any): void {
    if (config.sortBy) this.sortBy = config.sortBy;
    if (config.metric) this.metric = config.metric;
    if (config.showTotals != null) this.showTotals = config.showTotals;
    if (config.subtotalAfterGroup != null) this.subtotalAfterGroup = config.subtotalAfterGroup;
    if (config.grandTotalAtBottom != null) this.grandTotalAtBottom = config.grandTotalAtBottom;
    if (config.selectedReportType) this.selectedReportType = config.selectedReportType;
  }

  private restoreAppearanceFromConfig(config: any): void {
    this.clusterBannerText = config.clusterBannerText ?? '';
    this.clusterBannerSelection = config.clusterBannerSelection
      ?? clusterBannerSelectionKey((config as ReportJsonConfig).filters?.find(filter => filter.key === 'cluster')?.value);
    this.setCustomClusterBannerEnabled(config.customClusterBannerEnabled !== false);
    if (config.headerTitle) this.headerTitle = config.headerTitle;
    if (config.headerSubtitle) this.headerSubtitle = config.headerSubtitle;
    if (config.headerSubtitle2) this.headerSubtitle2 = config.headerSubtitle2;
    if (config.bannerText) this.bannerText = config.bannerText;
    if (config.headerBackgroundColor && config.headerBackgroundColor !== '#D0D7E7' && config.headerBackgroundColor !== '#111827' && config.headerBackgroundColor !== '#A1AFCE') {
      this.headerBackgroundColor = config.headerBackgroundColor;
    }
    if (config.headerTextColor) this.headerTextColor = config.headerTextColor;
    if (config.bannerBackgroundColor) this.bannerBackgroundColor = config.bannerBackgroundColor;
    if (config.bannerTextColor) this.bannerTextColor = config.bannerTextColor;
    if (config.groupTextColor) this.groupTextColor = config.groupTextColor;
    if (config.subGroupTextColor) this.subGroupTextColor = config.subGroupTextColor;
    if (config.leftLogoUrl) this.leftLogoUrl = config.leftLogoUrl;
    if (config.rightLogoUrl) this.rightLogoUrl = config.rightLogoUrl;
    if (config.headerRowColor) this.headerRowColor = config.headerRowColor;
    if (config.headerCellColors) this.headerCellColors = config.headerCellColors;
    if (config.columnGroupColors) {
      const seen = new Set<string>();
      this.columnGroupColors = config.columnGroupColors.filter((r: ColumnGroupColorRow) => {
        const key = `${r.level}:${r.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (config.subGroupColors) this.subGroupColors = config.subGroupColors;
    if (config.groupColors) this.groupColors = config.groupColors;
    if (config.groupTextColors) this.groupTextColors = config.groupTextColors;
    if (config.subGroupTextColors) this.subGroupTextColors = config.subGroupTextColors;
    if (config.rightLogoColor) this.rightLogoColor = config.rightLogoColor;
    if (config.fontFamily) this.fontFamily = config.fontFamily;
    if (config.fontSize) this.fontSize = config.fontSize;
    if (config.headerFontSize) this.headerFontSize = config.headerFontSize;
    if (config.bannerFontSize) this.bannerFontSize = config.bannerFontSize;
    if (config.tableHeadingFontSize) this.tableHeadingFontSize = config.tableHeadingFontSize;
    if (config.gridHeaderHeight) this.gridHeaderHeight = config.gridHeaderHeight;
    this.updateGridTheme();
    if (config.rowColors) this.rowColors = config.rowColors;
    if (config.rowColorsByKey) this.rowColorsByKey = config.rowColorsByKey;
    this.summaryRowColors = { ...(config.summaryRowColors ?? {}) };
    this.summaryRowTextColors = { ...(config.summaryRowTextColors ?? {}) };
    if (config.pageRowColors) this.pageRowColors = config.pageRowColors;
    if (config.cellColors) this.cellColors = config.cellColors;
    if (config.headerRowTextColor) this.headerRowTextColor = config.headerRowTextColor;
    if (config.headerCellTextColors) this.headerCellTextColors = config.headerCellTextColors;
    if (config.rowTextColors) this.rowTextColors = config.rowTextColors;
    if (config.rowTextColorsByKey) this.rowTextColorsByKey = config.rowTextColorsByKey;
    if (config.cellTextColors) this.cellTextColors = config.cellTextColors;
    if (config.pinnedColumns) this.pinnedColumns = config.pinnedColumns;
    if (config.dataBarColumns) this.dataBarColumns = [...config.dataBarColumns];
    if (config.mergedCellRanges) this.mergedCellRanges = config.mergedCellRanges;
    if (config.rowLayout) this.rowLayout = config.rowLayout;
    if (config.manualRows) this.manualRows = config.manualRows;
    if (config.cellOverrides) this.cellOverrides = config.cellOverrides;
    if (config.deletedRowIndices) this.deletedRowIndices = config.deletedRowIndices;
    if (config.cellEmbeds) this.cellEmbeds = config.cellEmbeds;
    if (config.cellOrientations) this.cellOrientations = config.cellOrientations;
    if (config.headerCellOrientations) this.headerCellOrientations = config.headerCellOrientations;
    if (config.cellAlignments) this.cellAlignments = config.cellAlignments;
    if (config.headerCellAlignments) this.headerCellAlignments = config.headerCellAlignments;
    if (config.reportAlignment) this.reportAlignment = config.reportAlignment;
    if (config.groupHeaderAlignments) this.groupHeaderAlignments = { ...config.groupHeaderAlignments };
    if (config.subGroupHeaderAlignments) this.subGroupHeaderAlignments = { ...config.subGroupHeaderAlignments };
    if (config.cellBorders) this.cellBorders = config.cellBorders;
    if (config.headerCellBorders) this.headerCellBorders = config.headerCellBorders;
    if (config.reportBorder != null) this.reportBorder = config.reportBorder;
    if (config.rowNumberHeader != null) this.rowNumberHeader = config.rowNumberHeader;
    this.migrateBorders();
    if (config.themeId) this.selectedThemeId = config.themeId;
    if (config.themeAccent) this.gridAccentColor = config.themeAccent;
    if (config.headerRowColor) this.gridHeaderBg = config.headerRowColor;
    if (config.brandedRows != null) this.brandedRows = config.brandedRows;
    if (config.conditionalRules) this.conditionalRules = config.conditionalRules;
    if (Array.isArray(config.legends)) this.legendItems = structuredClone(config.legends);
    if (config.daxModel) {
      this.daxModel = cloneDaxModel(config.daxModel);
      this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
      this.syncDaxSelectionFromModel();
    }
    if (config.conditionalFilters?.length) {
      this.conditionalFilters = config.conditionalFilters.map((f: ReportConditionalFilter) => ({ ...f }));
      this.nextConditionalFilterId = this.conditionalFilters.reduce((max, f) => Math.max(max, f.id + 1), 1);
    }
    if (config.calculatedFields?.length) {
      this.calculatedFields = config.calculatedFields;
      for (const cf of this.calculatedFields) {
        if (!this.columnFields.includes(cf.name)) {
          this.columnFields.push(cf.name);
        }
        if (!this.selectedRawFields.includes(cf.name)) {
          this.selectedRawFields.push(cf.name);
        }
        if (!this.columnConfigs[cf.name]) {
          this.columnConfigs[cf.name] = { shown: true, group: '', subGroup: '', total: '', color: '' };
        }
      }
    }
  }

  /**
   * Applies only the visual/style properties (header/banner text, colors, fonts, conditional
   * rules) from a saved setup. Structural, data-bound properties are intentionally skipped so
   * a setup from a different source doesn't wipe the current grid.
   */
  private applyStyleOnlyFromConfig(config: any): void {
    this.clusterBannerText = config.clusterBannerText ?? '';
    this.clusterBannerSelection = config.clusterBannerSelection
      ?? clusterBannerSelectionKey((config as ReportJsonConfig).filters?.find(filter => filter.key === 'cluster')?.value);
    this.setCustomClusterBannerEnabled(config.customClusterBannerEnabled !== false);
    if (config.headerTitle) this.headerTitle = config.headerTitle;
    if (config.headerSubtitle) this.headerSubtitle = config.headerSubtitle;
    if (config.headerSubtitle2) this.headerSubtitle2 = config.headerSubtitle2;
    if (config.bannerText) this.bannerText = config.bannerText;
    if (config.headerBackgroundColor && config.headerBackgroundColor !== '#D0D7E7' && config.headerBackgroundColor !== '#111827' && config.headerBackgroundColor !== '#A1AFCE') {
      this.headerBackgroundColor = config.headerBackgroundColor;
    }
    if (config.headerTextColor) this.headerTextColor = config.headerTextColor;
    if (config.bannerBackgroundColor) this.bannerBackgroundColor = config.bannerBackgroundColor;
    if (config.bannerTextColor) this.bannerTextColor = config.bannerTextColor;
    if (config.groupTextColor) this.groupTextColor = config.groupTextColor;
    if (config.subGroupTextColor) this.subGroupTextColor = config.subGroupTextColor;
    if (config.leftLogoUrl) this.leftLogoUrl = config.leftLogoUrl;
    if (config.rightLogoUrl) this.rightLogoUrl = config.rightLogoUrl;
    if (config.rightLogoColor) this.rightLogoColor = config.rightLogoColor;
    if (config.headerRowColor) this.headerRowColor = config.headerRowColor;
    if (config.headerRowTextColor) this.headerRowTextColor = config.headerRowTextColor;
    if (config.fontFamily) this.fontFamily = config.fontFamily;
    if (config.fontSize) this.fontSize = config.fontSize;
    if (config.headerFontSize) this.headerFontSize = config.headerFontSize;
    if (config.bannerFontSize) this.bannerFontSize = config.bannerFontSize;
    if (config.tableHeadingFontSize) this.tableHeadingFontSize = config.tableHeadingFontSize;
    if (config.gridHeaderHeight) this.gridHeaderHeight = config.gridHeaderHeight;
    // Position/field-keyed color maps are safe — they only tint existing cells, never restructure rows.
    if (config.headerCellColors) this.headerCellColors = config.headerCellColors;
    if (config.headerCellTextColors) this.headerCellTextColors = config.headerCellTextColors;
    if (config.rowColors) this.rowColors = config.rowColors;
    if (config.rowColorsByKey) this.rowColorsByKey = config.rowColorsByKey;
    this.summaryRowColors = { ...(config.summaryRowColors ?? {}) };
    this.summaryRowTextColors = { ...(config.summaryRowTextColors ?? {}) };
    if (config.rowTextColors) this.rowTextColors = config.rowTextColors;
    if (config.rowTextColorsByKey) this.rowTextColorsByKey = config.rowTextColorsByKey;
    if (config.pageRowColors) this.pageRowColors = config.pageRowColors;
    if (config.cellColors) this.cellColors = config.cellColors;
    if (config.cellTextColors) this.cellTextColors = config.cellTextColors;
    if (config.cellOrientations) this.cellOrientations = config.cellOrientations;
    if (config.headerCellOrientations) this.headerCellOrientations = config.headerCellOrientations;
    if (config.cellAlignments) this.cellAlignments = config.cellAlignments;
    if (config.headerCellAlignments) this.headerCellAlignments = config.headerCellAlignments;
    if (config.reportAlignment) this.reportAlignment = config.reportAlignment;
    if (config.groupHeaderAlignments) this.groupHeaderAlignments = { ...config.groupHeaderAlignments };
    if (config.subGroupHeaderAlignments) this.subGroupHeaderAlignments = { ...config.subGroupHeaderAlignments };
    if (config.cellBorders) this.cellBorders = config.cellBorders;
    if (config.headerCellBorders) this.headerCellBorders = config.headerCellBorders;
    if (config.reportBorder != null) this.reportBorder = config.reportBorder;
    if (config.rowNumberHeader != null) this.rowNumberHeader = config.rowNumberHeader;
    this.migrateBorders();
    if (config.themeId) this.selectedThemeId = config.themeId;
    if (config.themeAccent) this.gridAccentColor = config.themeAccent;
    if (config.headerRowColor) this.gridHeaderBg = config.headerRowColor;
    if (config.brandedRows != null) this.brandedRows = config.brandedRows;
    if (config.columnGroupColors) this.columnGroupColors = config.columnGroupColors;
    if (config.subGroupColors) this.subGroupColors = config.subGroupColors;
    if (config.groupColors) this.groupColors = config.groupColors;
    if (config.groupTextColors) this.groupTextColors = config.groupTextColors;
    if (config.subGroupTextColors) this.subGroupTextColors = config.subGroupTextColors;
    if (config.conditionalRules) this.conditionalRules = config.conditionalRules;
    if (Array.isArray(config.legends)) this.legendItems = structuredClone(config.legends);
    this.updateGridTheme();
  }

  ngOnDestroy(): void {
    this.viewDestroyed = true;
    document.removeEventListener('scroll', this.hideGridMenusOnScroll, true);
    if (this.groupTextRebuildTimer) clearTimeout(this.groupTextRebuildTimer);
    // Restore previous sidebar state when leaving the builder
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.subs.forEach(s => s.unsubscribe());
    this.destroy$.next();
    this.destroy$.complete();
    this.notify.destroy();
    this.gridApi = null;
    this.expandGridApi = null;
  }

  /** Fetch preview data for the selected data model/source. */
  isLoadingPreview = false;

  loadTablePreview(): void {
    this.sourcePreviewSubscription?.unsubscribe();
    const source = this.availableSources.find(s => s.name.toLowerCase() === this.selectedDataModelId.toLowerCase());
    if (!source) return;
    this.isLoadingPreview = true;
    this.previewRows = [];
    // Paint the loader now — no zone.js, so the async gap won't repaint on its own.
    this.cdr.detectChanges();
    this.subs.push(this.sourcePreviewSubscription = this.commonApi.getTableData(source.name, source.sourceType).subscribe({
      next: (data) => {
        this.tablePreviewData = data;
        this.isLoadingPreview = false;
        if (data?.columns?.length) {
          // In edit mode, preserve already-restored columns/configs
          if (this.editingReportId && this.selectedRawFields.length > 0) {
            this.columnFields = [...data.columns];
            for (const field of this.columnFields) {
              if (!this.columnConfigs[field]) {
                this.columnConfigs[field] = { shown: false, group: '', subGroup: '', total: '', color: '' };
              }
            }
            this.appendCalculatedFields();
          } else {
            // New report — select all by default
            this.columnFields = [...data.columns];
            this.selectedRawFields = [...data.columns];
            this.columnConfigs = {};
            for (const field of this.columnFields) {
              this.columnConfigs[field] = { shown: true, group: '', subGroup: '', total: '', color: '' };
            }
          }
        }
        this.rebuildPreviewGrid();
        // Synchronous CD — this app has no zone.js, so a scheduled markForCheck won't render until the next event.
        this.cdr.detectChanges();
        // Zoneless: a re-created grid (new sheet) needs a follow-up pass to actually paint.
        this.deferRender();
        // Baseline the history on the freshly loaded data so the first undo can't rewind into a blank preview.
        this.resetHistory();
        // template lookup — runs last so a failure here can never block the grid render.
        // this.maybeOfferTemplate();
      },
      error: () => {
        this.isLoadingPreview = false;
        this.notify.showError('Failed to load table preview.');
        this.cdr.detectChanges();
      },
    }));
  }

  // Column section starts from the raw field set but can grow with calculated
  // columns, so it's a separate stateful copy rather than a getter off rawFields.
  private initColumnFields(): void {
    this.columnFields = [...this.rawFields];
    this.columnConfigs = {};
    for (const field of this.columnFields) {
      this.columnConfigs[field] = { shown: false, group: '', subGroup: '', total: '', color: '' };
    }
    this.nextCalculatedIndex = 1;
  }

  get canGeneratePreview(): boolean {
    return this.shownColumns.length > 0;
  }

  get hasPreviewSourceColumns(): boolean {
    return !!this.tablePreviewData?.columns?.length;
  }

  /** Columns marked as shown in the Column section, ordered by Raw section tick order. */
  get shownColumns(): string[] {
    return this.selectedRawFields.filter(f => this.columnConfigs[f]?.shown);
  }

  /** Display columns after Data Transformation rules run (renamed/split/merged/extracted), or null when no rules apply. */
  private transformedColumns: string[] | null = null;

  get previewColumns(): string[] {
    // Base columns come from Data Transformation output when rules apply; DAX row-measure columns append after.
    return [...(this.transformedColumns ?? this.shownColumns), ...this.daxMeasureColumns];
  }

  // ─── Column renames (Data Transformation `rename_column`) ──────────────────
  // Formatting is keyed by the displayed column name. This records the renames those keys
  // currently follow; when the rules change the displayed names, the keys move with them.
  // undefined = re-baseline on the next sync (after a wholesale state restore/load).
  private columnKeyRenames?: Map<string, string>;

  private get columnKeyFields(): string[] {
    return [...new Set([
      ...this.selectedRawFields,
      ...this.calculatedFields.map(field => field.name),
      ...(this.tablePreviewData?.columns ?? []),
    ])];
  }

  /** Source column → displayed name under the currently applied rename rules. */
  private currentColumnRenames(): Map<string, string> {
    return getRenamedColumnDisplayNames(this.columnKeyFields, this.applicableParameterFilters);
  }

  /** Source column behind a displayed (possibly renamed) column. */
  private columnSourceField(field: string): string {
    // The synced map is current after every rebuild; exports call this per cell, so avoid recomputing.
    for (const [source, display] of this.columnKeyRenames ?? this.currentColumnRenames()) if (display === field) return source;
    return field;
  }

  /** Re-keys formatting after rename rules change the displayed column names. */
  private syncColumnKeysWithRenames(): void {
    const next = this.currentColumnRenames();
    const previous = this.columnKeyRenames;
    this.columnKeyRenames = next;
    if (previous && !sameColumnRenames(previous, next)) this.renameColumnKeyedState(previous, next, true);
  }

  private renameColumnKeyedState(from: ReadonlyMap<string, string>, to: ReadonlyMap<string, string>, includeRules: boolean): void {
    Object.assign(this, renameReportColumnKeys(this.columnKeyedState(), columnKeyRenamer(from, to)));
    if (!includeRules) return;
    // DAX / conditional filters already resolve source names; only rename-output names need to follow.
    const renameOutputs = renamedOutputRenamer(from, to);
    this.daxModel = renameDaxModelColumns(this.daxModel, renameOutputs, from.values());
    this.conditionalFilters = renameConditionalFilterColumns(this.conditionalFilters, renameOutputs);
  }

  private columnKeyedState(): Required<ReportColumnKeyedSettings> {
    return {
      headerCellColors: this.headerCellColors,
      headerCellTextColors: this.headerCellTextColors,
      headerCellOrientations: this.headerCellOrientations,
      headerCellAlignments: this.headerCellAlignments,
      headerCellBorders: this.headerCellBorders,
      cellColors: this.cellColors,
      cellTextColors: this.cellTextColors,
      cellOrientations: this.cellOrientations,
      cellAlignments: this.cellAlignments,
      cellBorders: this.cellBorders,
      cellEmbeds: this.cellEmbeds,
      cellOverrides: this.cellOverrides,
      rowColorsByKey: this.rowColorsByKey,
      rowTextColorsByKey: this.rowTextColorsByKey,
      manualRows: this.manualRows,
      mergedCellRanges: this.mergedCellRanges,
      pinnedColumns: this.pinnedColumns,
      dataBarColumns: this.dataBarColumns,
      rowGroupFields: this.rowGroupFields,
      conditionalRules: this.conditionalRules,
    };
  }

  // Bound directly to ag-grid-angular's [rowData] — kept as a stable stored array
  // (recomputed only from rebuildPreviewGrid(), not a getter) so AG Grid doesn't see
  // a "new" rowData reference — and lose column widths/selection — on every CD tick.
  previewRows: Record<string, unknown>[] = [];

  private computePreviewRows(): Record<string, unknown>[] {
    const base = this.computeBaseRows();
    // Keep rowLayout reconciled so a grid row index maps 1:1 to a layout entry.
    this.rowLayout = reconcileRowLayout(this.rowLayout, base.length, new Set(this.deletedRowIndices));
    return materializeRows(this.rowLayout, base, this.manualRows, this.cellOverrides);
  }

  /** Source rows straight from the data (plus calculated fields), before manual row edits. */
  private computeBaseRows(): Record<string, unknown>[] {
    if (!this.tablePreviewData?.rows) return [];
    const rows = this.applyGlobalFilters(this.tablePreviewData.rows.map((row, index) => ({
      ...row,
      [ROW_COLOR_KEY]: getReportRowColorKey(row, this.tablePreviewData?.primaryKeys, index),
    })));
    let result: Record<string, unknown>[] = rows;
    if (this.calculatedFields.length) {
      // AG Grid reads values straight off the row object, so calculated fields
      // must be materialized here rather than computed per-cell at render time.
      result = result.map(row => {
        const withCalc: Record<string, unknown> = { ...row };
        for (const cf of this.calculatedFields) {
          withCalc[cf.name] = this.computeCalcRawValue(row, cf);
        }
        return withCalc;
      });
    }
    // Conditional filters scope which rows the report shows (on the original/calculated columns).
    result = this.applyReportConditionalFilters(result);
    // Data Transformation rules (type change, dedup, trim, math, rename/split/merge/extract) — their
    // output column list drives previewColumns so new/renamed columns actually render in the grid.
    if (this.parameterFilters.length) {
      const baseCols = this.shownColumns.length
        ? this.shownColumns
        : (this.tablePreviewData.columns?.length ? this.tablePreviewData.columns : Object.keys(result[0] ?? {}));
      const rules = this.applicableParameterFilters;
      const res = applyParameterFilters(result, rules, baseCols);
      this.transformedColumns = this.shownColumns.length ? res.columns : null;
      result = this.preserveDaxRenameAliases(res.rows, rules);
    } else {
      this.transformedColumns = null;
    }
    result = this.applyReportConditionalFilters(result, true);
    // Row-scope DAX measures materialize as extra columns, evaluated per row against the
    // full dataset (so aggregate references inside the expression see every row).
    const rowMeasures = this.daxRowMeasures;
    if (rowMeasures.length) {
      const source = result;
      const cols = this.shownColumns;
      result = result.map(row => {
        const withDax: Record<string, unknown> = { ...row };
        for (const m of rowMeasures) {
          try { withDax[m.name.trim()] = evaluateDaxMeasureForRow(m, row, source, cols); }
          catch { withDax[m.name.trim()] = null; }
        }
        return withDax;
      });
    }
    return result;
  }

  private applyGlobalFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!rows.length) return rows;

    const activeHierarchyFilters = this.filterFields
      .map(field => ({ key: field.key, value: this.filterValues[field.key] }))
      .filter(filter => hasGlobalSelection(filter.value));
    let filtered = rows;
    for (const filter of activeHierarchyFilters) {
      const column = this.findGlobalFilterColumn(filtered[0], filter.key);
      if (!column) continue;
      filtered = filtered.filter(row => matchesGlobalSelection(row[column], filter.value));
    }

    // View previews are already scoped by the view's server-side date parameters. A second
    // client-side pass can drop valid rows when the first inferred date column is blank or
    // contains a different planned date; the viewer intentionally avoids this re-filter too.
    if (this.dataSourceMode === 'view' || (!this.fromDate && !this.toDate)) return filtered;
    const columns = Object.keys(filtered[0] ?? {});
    const dateColumn = columns.find(column => isDateColumn(filtered, column));
    const monthColumn = columns.find(column => column.trim().toLowerCase() === 'month');
    const yearColumn = columns.find(column => column.trim().toLowerCase() === 'year');
    if (!dateColumn && !(monthColumn && yearColumn)) return filtered;

    const from = this.fromDate ? new Date(`${this.fromDate}T00:00:00`) : null;
    const to = this.toDate ? new Date(`${this.toDate}T23:59:59.999`) : null;
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    return filtered.filter(row => {
      let date: Date | null = null;
      if (dateColumn) {
        const raw = row[dateColumn];
        if (raw != null && raw !== '') {
          const parsed = new Date(String(raw));
          if (!Number.isNaN(parsed.getTime())) date = parsed;
        }
      } else {
        const monthIndex = monthNames.indexOf(String(row[monthColumn!] ?? '').trim().toLowerCase());
        const year = Number(row[yearColumn!]);
        if (monthIndex >= 0 && year) date = new Date(year, monthIndex, 1);
      }
      if (!date) return false;
      return !(from && date < from) && !(to && date > to);
    });
  }

  private findGlobalFilterColumn(row: Record<string, unknown>, field: string): string | undefined {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(field);
    const keys = Object.keys(row);
    return keys.find(key => normalize(key) === target)
      ?? keys.find(key => normalize(key).includes(target));
  }

  private preserveDaxRenameAliases(rows: Record<string, unknown>[], rules: ParameterFilterRule[]): Record<string, unknown>[] {
    const renameRules = rules.filter(rule =>
      rule.enabled !== false
      && rule.action === 'rename_column'
      && getRuleSourceColumns(rule).length === 1
      && !!rule.newColumnName?.trim(),
    );
    if (!renameRules.length) return rows;

    return rows.map(row => {
      const aliased = { ...row };
      for (const rule of renameRules) {
        const source = getRuleSourceColumns(rule)[0];
        const sourceKey = Object.keys(aliased).find(key => key.toLowerCase() === source.toLowerCase());
        if (sourceKey) continue;
        const target = rule.newColumnName!.trim();
        const targetKey = Object.keys(aliased).find(key => key.toLowerCase() === target.toLowerCase());
        if (targetKey) aliased[source] = aliased[targetKey];
      }
      return aliased;
    });
  }

  /** Blank inserted rows and custom-column cells are editable; source data stays read-only. */
  isCellEditable(params: { colDef?: ColDef; data?: Record<string, unknown> }): boolean {
    const field = params.colDef?.field;
    const isCustom = field ? this.columnConfigs[field]?.custom === true : false;
    return isCustom || params.data?.[MANUAL_ROW_FLAG] === true;
  }

  /** Raw numeric result (not display-formatted) so AG Grid's own numeric formatter applies — matches how the viewer computes calculated fields. */
  private computeCalcRawValue(row: Record<string, unknown>, cf: CalculatedField): number | null {
    const a = coerceNumberAllowPercent(row[cf.columnA]);
    const b = coerceNumberAllowPercent(row[cf.columnB]);
    if (isNaN(a) || isNaN(b)) return null;
    switch (cf.operation) {
      case 'add': return a + b;
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return b === 0 ? null : +(a / b).toFixed(2);
      case 'percentage': return b === 0 ? null : +((a / b) * 100).toFixed(2);
      default: return null;
    }
  }

  trackByIndex(index: number): number {
    return index;
  }

  // Section 6: Data Transformation (parameter-driven transforms) 
  dataTransformExpanded = false;
  parameterFilters: ParameterFilterRule[] = [];
  private nextParamFilterId = 1;

  // Searchable rule-parameter dropdowns (Action / target type / dedup / etc.).
  openFilterField: string | null = null;
  filterFieldSearch = '';
  filterMenuPos: { top: number | null; bottom: number | null; left: number; width: number; listMaxHeight: number } =
    { top: 0, bottom: null, left: 0, width: 220, listMaxHeight: 220 };

  // Multi-select "Source Column" dropdown per rule.
  openParamColDropdownId: number | null = null;
  paramColSearch: Record<number, string> = {};
  paramDropdownPos: { top: number; left: number; minWidth: number } = { top: 0, left: 0, minWidth: 220 };

  readonly parameterActionOptions: { value: ParameterFilterAction; label: string }[] = [
    { value: 'type_change', label: 'Change Data Type' },
    { value: 'rename_column', label: 'Rename Column' },
    { value: 'replace_nulls', label: 'Replace Nulls' },
    { value: 'deduplicate', label: 'Deduplicate Rows' },
    { value: 'split_column', label: 'Split Column' },
    { value: 'merge_columns', label: 'Merge Columns' },
    { value: 'trim_text', label: 'Trim / Clean Text' },
    { value: 'append_text', label: 'Append Text' },
    { value: 'prepend_text', label: 'Prepend Text' },
    { value: 'extract_value', label: 'Extract Values' },
    { value: 'math_transform', label: 'Math Operation' },
  ];

  /** Text-manipulation actions that only make sense on string columns — numeric columns are excluded. */
  private readonly textOnlyParameterActions: ReadonlySet<ParameterFilterAction> = new Set<ParameterFilterAction>([
    'trim_text', 'text_operation',
  ]);
  readonly dedupStrategyOptions: { value: string; label: string }[] = [
    { value: 'Keep First', label: 'Keep First' },
    { value: 'Keep Last', label: 'Keep Last' },
    { value: 'Keep Unique', label: 'Keep Unique Only' },
  ];
  readonly targetTypeOptions = ['Number', 'Text', 'Date', 'Boolean'];
  readonly textTransformOptions = ['Trim Whitespace', 'UPPERCASE', 'lowercase', 'Title Case'];
  readonly extractModeOptions = ['First N Chars', 'Last N Chars', 'Substring'];

  /** Selected report columns plus rename aliases from their enabled transformations. */
  get availableSourceColumns(): string[] {
    return getTransformationSourceColumns(this.selectedRawFields, this.applicableParameterFilters);
  }

  toggleDataTransformSection(): void {
    this.dataTransformExpanded = !this.dataTransformExpanded;
  }

  addParameterFilter(): void {
    // Rules start disabled — the user must flip the row toggle on to apply the transformation.
    this.parameterFilters.push({
      id: this.nextParamFilterId++,
      action: '',
      enabled: false,
      sourceColumn: '',
      sourceColumns: [],
      secondaryColumn: '',
      targetType: '',
      newColumnName: '',
      replaceValue: '',
      dedupStrategy: '',
      delimiter: '-',
      separator: ' ',
      textTransform: 'Trim Whitespace',
      extractMode: 'First N Chars',
      extractLength: 3,
      startIndex: 0,
      mathOperator: '+',
    });
    this.onParameterFilterChange();
  }

  toggleParameterFilterEnabled(rule: ParameterFilterRule): void {
    rule.enabled = rule.enabled === false ? true : false;
    this.onParameterFilterChange();
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
    this.onParameterFilterChange();
  }

  trackParameterFilter(_index: number, rule: ParameterFilterRule): number {
    return rule.id;
  }

  onParameterFilterChange(): void {
    this.rebuildPreviewGrid();
    this.cdr.markForCheck();
  }

  private syncParameterFilterIds(): void {
    for (const rule of this.parameterFilters) {
      this.nextParamFilterId = Math.max(this.nextParamFilterId, rule.id + 1);
    }
  }

  private restoreParameterFiltersFromConfig(config: any): void {
    // Loaded formatting matches the loaded rules; re-baseline instead of re-keying.
    this.columnKeyRenames = undefined;
    this.parameterFilters = (config?.parameterFilters ?? []).map((r: ParameterFilterRule) => ({
      ...r,
      sourceColumns: getRuleSourceColumns(r),
      // Normalize an unset target type / dedup strategy to '' so the dropdown shows its "Select"
      // placeholder (instead of a forced default value) and the missing-selection validation applies.
      ...(r.action === 'type_change' ? { targetType: r.targetType ?? '' } : {}),
      ...(r.action === 'deduplicate' ? { dedupStrategy: r.dedupStrategy ?? '' } : {}),
    }));
    this.syncParameterFilterIds();
  }

  /** Restores the DAX model, conditional filters and data-transformation rules from a saved template. */
  private restoreRulesFromConfig(config: any): void {
    if (config?.daxModel) {
      this.daxModel = cloneDaxModel(config.daxModel);
      this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
      this.syncDaxSelectionFromModel();
    }
    this.conditionalFilters = (config?.conditionalFilters ?? []).map((f: ReportConditionalFilter) => ({ ...f }));
    this.nextConditionalFilterId = this.conditionalFilters.reduce((max, f) => Math.max(max, f.id + 1), 1);
    this.restoreParameterFiltersFromConfig(config);
  }

  // ── Rule-parameter (searchable) dropdown option lists ──
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

  filteredExtractModes(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    return t ? this.extractModeOptions.filter(o => o.toLowerCase().includes(t)) : this.extractModeOptions;
  }

  filteredSecondaryColumns(): string[] {
    const t = this.filterFieldSearch.trim().toLowerCase();
    const opts = this.availableSourceColumns;
    return t ? opts.filter(o => o.toLowerCase().includes(t)) : opts;
  }

  selectParameterAction(rule: ParameterFilterRule, value: ParameterFilterAction): void {
    const actionChanged = rule.action !== value;
    const selectedColumns = getRuleSourceColumns(rule);
    rule.action = value;
    if (value === 'type_change' && rule.targetType == null) rule.targetType = '';
    if (value === 'deduplicate' && rule.dedupStrategy == null) rule.dedupStrategy = '';
    if (actionChanged) {
      const availableColumns = new Set(this.getFilteredSourceColumns(rule.id));
      rule.sourceColumns = selectedColumns.filter(column => availableColumns.has(column));
      rule.sourceColumn = rule.sourceColumns[0] ?? '';
    }
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  selectTargetType(rule: ParameterFilterRule, value: string): void {
    rule.targetType = value;
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  selectDedupStrategy(rule: ParameterFilterRule, value: string): void {
    rule.dedupStrategy = value;
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  selectSecondaryColumn(rule: ParameterFilterRule, value: string): void {
    rule.secondaryColumn = value;
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  selectTextTransform(rule: ParameterFilterRule, value: string): void {
    rule.textTransform = value;
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  selectExtractMode(rule: ParameterFilterRule, value: string): void {
    rule.extractMode = value;
    this.openFilterField = null;
    this.onParameterFilterChange();
  }

  toggleFilterField(key: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.openFilterField === key) { this.openFilterField = null; return; }
    // Close any other open dropdown (e.g. the Source Column multi-select) so only one stays open at a time.
    this.closeAllDropdowns();
    const trigger = event.currentTarget as HTMLElement;
    this.filterMenuPos = this.computeFilterMenuPos(trigger.getBoundingClientRect());
    this.openFilterField = key;
    this.filterFieldSearch = '';
  }

  // These dropdown panels are position:fixed at coordinates captured on open, so they'd detach from
  // their trigger if left open while scrolling — close them instead, matching chart-builder's pattern.
  onFilterTableScroll(): void {
    this.closeAllDropdowns();
  }

  /** app-root is scaled via CSS `zoom` (FontSizeService); fixed panels placed from
   *  getBoundingClientRect() must divide by this factor or they drift by rect×zoom. */
  private appZoomFactor(): number {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor'));
    return value > 0 ? value : 1;
  }

  private computeFilterMenuPos(rect: DOMRect): { top: number | null; bottom: number | null; left: number; width: number; listMaxHeight: number } {
    const GAP = 4;
    const EDGE_PADDING = 12;
    const SEARCH_BOX_RESERVE = 56;
    const DEFAULT_LIST_HEIGHT = 220;
    const MIN_LIST_HEIGHT = 120;
    const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE_PADDING;
    const spaceAbove = rect.top - GAP - EDGE_PADDING;
    let top: number | null;
    let bottom: number | null;
    let listMaxHeight: number;
    if (spaceBelow - SEARCH_BOX_RESERVE >= MIN_LIST_HEIGHT || spaceBelow >= spaceAbove) {
      listMaxHeight = Math.max(MIN_LIST_HEIGHT, Math.min(DEFAULT_LIST_HEIGHT, spaceBelow - SEARCH_BOX_RESERVE));
      top = Math.min(Math.max(rect.bottom + GAP, EDGE_PADDING),
        window.innerHeight - EDGE_PADDING - (listMaxHeight + SEARCH_BOX_RESERVE));
      bottom = null;
    } else {
      // Anchor via `bottom` (distance from the trigger's top up to the viewport bottom) instead
      // of computing `top` from an assumed full reserved height — a short list (e.g. the 4-item
      // Number/Text/Date/Boolean rule-parameter list) renders shorter than that reservation, so
      // deriving `top` from it left a visible gap between the panel and its trigger when flipped
      // upward. Anchoring the panel's bottom edge keeps it flush against the trigger regardless
      // of how tall the panel actually renders.
      listMaxHeight = Math.max(MIN_LIST_HEIGHT, Math.min(DEFAULT_LIST_HEIGHT, spaceAbove - SEARCH_BOX_RESERVE));
      bottom = Math.min(Math.max(window.innerHeight - rect.top + GAP, EDGE_PADDING), window.innerHeight - EDGE_PADDING);
      top = null;
    }
    const width = Math.max(rect.width, 200);
    const maxLeft = window.innerWidth - EDGE_PADDING - width;
    const left = Math.min(rect.left, Math.max(EDGE_PADDING, maxLeft));
    const zoom = this.appZoomFactor();
    return {
      top: top !== null ? top / zoom : null,
      bottom: bottom !== null ? bottom / zoom : null,
      left: left / zoom,
      width: width / zoom,
      listMaxHeight: listMaxHeight / zoom
    };
  }

  closeAllDropdowns(): void {
    this.openFilterField = null;
    this.openParamColDropdownId = null;
  }

  // ── "Source Column" multi-select dropdown ──
  getParamColSummary(rule: ParameterFilterRule): string {
    const cols = getRuleSourceColumns(rule);
    if (!cols.length) return 'Select columns...';
    if (cols.length === 1) return cols[0];
    return `${cols.length} columns selected`;
  }

  /** An enabled rule with no Source Column picked is invalid — drives the inline error and blocks save. */
  paramFilterMissingSource(rule: ParameterFilterRule): boolean {
    return rule.enabled !== false && getRuleSourceColumns(rule).length === 0;
  }

  paramFilterMissingTargetType(rule: ParameterFilterRule): boolean {
    return rule.enabled !== false && rule.action === 'type_change' && rule.targetType === '';
  }

  paramFilterMissingDedupStrategy(rule: ParameterFilterRule): boolean {
    return rule.enabled !== false && rule.action === 'deduplicate' && rule.dedupStrategy === '';
  }

  paramFilterMissingDelimiter(rule: ParameterFilterRule): boolean {
    return rule.enabled !== false && rule.action === 'split_column' && !rule.delimiter;
  }

  get hasInvalidParameterFilters(): boolean {
    return this.parameterFilters.some(rule => this.paramFilterMissingSource(rule))
      || !!getParameterSelectionError(this.parameterFilters);
  }

  toggleParamColDropdown(id: number, event?: Event): void {
    const willOpen = this.openParamColDropdownId !== id;
    // Close any other open dropdown (e.g. the Action dropdown) so only one stays open at a time.
    this.closeAllDropdowns();
    if (event) {
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        const zoom = this.appZoomFactor();
        this.paramDropdownPos = { top: (rect.bottom + 4) / zoom, left: rect.left / zoom, minWidth: Math.max(220, rect.width / zoom) };
      }
    }
    this.openParamColDropdownId = willOpen ? id : null;
  }

  getFilteredSourceColumns(ruleId: number): string[] {
    const search = (this.paramColSearch[ruleId] ?? '').toLowerCase().trim();
    let allCols = this.availableSourceColumns;
    const rule = this.parameterFilters.find(r => r.id === ruleId);
    if (rule?.action === 'math_transform') {
      // Math Operation is numeric-only — numeric and percentage ("12.5%") columns are offered.
      allCols = allCols.filter(col => this.isAggregatableField(col));
    } else if (rule && this.textOnlyParameterActions.has(rule.action as ParameterFilterAction)) {
      // Text operations can't run on pure numeric columns; percentage text columns stay available.
      allCols = allCols.filter(col => !this.isNumericField(col));
    }
    return search ? allCols.filter(col => col.toLowerCase().includes(search)) : allCols;
  }

  isParamColSelected(rule: ParameterFilterRule, col: string): boolean {
    return getRuleSourceColumns(rule).includes(col);
  }

  toggleParamCol(rule: ParameterFilterRule, col: string): void {
    const current = getRuleSourceColumns(rule);
    const next = current.includes(col) ? current.filter(c => c !== col) : [...current, col];
    rule.sourceColumns = next;
    rule.sourceColumn = next[0] ?? '';
    this.onParameterFilterChange();
  }

  toggleAllParamCols(rule: ParameterFilterRule): void {
    const filtered = this.getFilteredSourceColumns(rule.id);
    const current = getRuleSourceColumns(rule);
    const allSelected = filtered.length > 0 && filtered.every(c => current.includes(c));
    rule.sourceColumns = allSelected
      ? current.filter(c => !filtered.includes(c))
      : [...new Set([...current, ...filtered])];
    rule.sourceColumn = rule.sourceColumns[0] ?? '';
    this.onParameterFilterChange();
  }

  areAllParamColsSelected(rule: ParameterFilterRule): boolean {
    const filtered = this.getFilteredSourceColumns(rule.id);
    if (!filtered.length) return false;
    const current = getRuleSourceColumns(rule);
    return filtered.every(c => current.includes(c));
  }

  get maxPreviewValue(): number {
    return Math.max(...this.previewValues);
  }

  /** Same shape persisted as reportJson — reused for both save and the live AG Grid preview. */
  private buildLiveConfig(): ReportJsonConfig {
    // `this` structurally satisfies ReportSheetSnapshot (same field names), so pass it directly —
    // no clone, keeping this hot-path (called per cell render) as cheap as the original.
    return this.configFromState(this);
  }

  /** Builds a ReportJsonConfig from a per-sheet snapshot (used for the active sheet and every other sheet on save). */
  private configFromState(s: Omit<ReportSheetSnapshot, 'nextCalculatedIndex'>): ReportJsonConfig {
    const legends = s.legendItems ?? [];
    const sourceColumn = createColumnConfigResolver({
      columns: s.selectedRawFields.map(field => ({ field, header: field })),
      parameterFilters: s.parameterFilters,
    });
    const groupFields = s.rowGroupFields.map(field => sourceColumn(field)?.field ?? field);
    return {
      columns: s.selectedRawFields
        .map(f => {
          const base = { field: f, header: f, ...(s.columnConfigs[f] ?? { shown: false, group: '', subGroup: '', total: '', color: '' }) };
          // Normalize group / sub-group titles so a whitespace-only leftover (e.g. after
          // backspacing in the multiline textarea) is stored as an empty string, never a
          // ghost group that would resurface in the saved report.
          base.group = (base.group ?? '').trim();
          base.subGroup = (base.subGroup ?? '').trim();
          const groupIndex = groupFields.indexOf(f);
          return {
            ...base,
            ...(groupIndex >= 0 ? { rowGroup: true, rowGroupIndex: groupIndex } : {}),
            ...(s.rowGroupAggs[f] ? { aggFunc: s.rowGroupAggs[f] } : {}),
            ...(s.rowGroupColors?.[f] ? { rowGroupColor: s.rowGroupColors[f] } : {}),
          };
        }),
      filters: this.activeFilters,
      sortBy: s.sortBy,
      groupBy: '',
      metric: s.metric,
      showTotals: s.showTotals,
      subtotalAfterGroup: s.subtotalAfterGroup,
      grandTotalAtBottom: s.grandTotalAtBottom,
      selectedReportType: s.selectedReportType,
      headerTitle: s.headerTitle,
      headerSubtitle: s.headerSubtitle,
      headerSubtitle2: s.headerSubtitle2,
      bannerText: s.bannerText,
      clusterBannerText: s.clusterBannerText,
      clusterBannerSelection: s.clusterBannerSelection,
      customClusterBannerEnabled: s.customClusterBannerEnabled,
      headerBackgroundColor: s.headerBackgroundColor,
      headerTextColor: s.headerTextColor,
      bannerBackgroundColor: s.bannerBackgroundColor,
      bannerTextColor: s.bannerTextColor,
      groupTextColor: s.groupTextColor,
      subGroupTextColor: s.subGroupTextColor,
      leftLogoUrl: s.leftLogoUrl,
      rightLogoUrl: s.rightLogoUrl,
      headerRowColor: s.headerRowColor,
      columnGroupColors: s.columnGroupColors,
      subGroupColors: s.subGroupColors,
      groupColors: s.groupColors,
      groupTextColors: s.groupTextColors,
      subGroupTextColors: s.subGroupTextColors,
      rightLogoColor: s.rightLogoColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      headerFontSize: s.headerFontSize,
      bannerFontSize: s.bannerFontSize,
      tableHeadingFontSize: s.tableHeadingFontSize,
      gridHeaderHeight: s.gridHeaderHeight,
      themeId: s.selectedThemeId,
      brandedRows: s.brandedRows,
      themeAccent: s.gridAccentColor,
      rowColors: s.rowColors,
      rowColorsByKey: s.rowColorsByKey,
      summaryRowColors: s.summaryRowColors,
      summaryRowTextColors: s.summaryRowTextColors,
      rowTextColorsByKey: s.rowTextColorsByKey,
      pageRowColors: s.pageRowColors,
      paginationPageSize: s.gridPaginationPageSize,
      cellColors: s.cellColors,
      headerCellColors: s.headerCellColors,
      headerRowTextColor: s.headerRowTextColor,
      rowTextColors: s.rowTextColors,
      cellTextColors: s.cellTextColors,
      headerCellTextColors: s.headerCellTextColors,
      pinnedColumns: s.pinnedColumns,
      dataBarColumns: s.dataBarColumns,
      calculatedFields: s.calculatedFields,
      mergedCellRanges: s.mergedCellRanges,
      rowLayout: s.rowLayout,
      manualRows: s.manualRows,
      cellOverrides: s.cellOverrides,
      deletedRowIndices: s.deletedRowIndices,
      cellEmbeds: s.cellEmbeds,
      cellOrientations: s.cellOrientations,
      headerCellOrientations: s.headerCellOrientations,
      cellAlignments: s.cellAlignments,
      headerCellAlignments: s.headerCellAlignments,
      reportAlignment: s.reportAlignment,
      groupHeaderAlignments: s.groupHeaderAlignments,
      subGroupHeaderAlignments: s.subGroupHeaderAlignments,
      cellBorders: s.cellBorders,
      headerCellBorders: s.headerCellBorders,
      reportBorder: s.reportBorder,
      rowNumberHeader: s.rowNumberHeader,
      conditionalRules: s.conditionalRules,
      daxModel: s.daxModel,
      ...(legends.length ? { legends } : {}),
      conditionalFilters: s.conditionalFilters,
      parameterFilters: s.parameterFilters,
      pageOrientation: 'Portrait',
      pageSize: 'A4',
    };
  }

  /** Resolves the persisted source name/type for a sheet snapshot (table vs database view). */
  private resolveSourceFromState(s: ReportSheetSnapshot): { sourceName: string; sourceType: string } {
    const source = this.availableSources.find(x => x.name.toLowerCase() === s.selectedDataModelId.toLowerCase());
    const sourceType = s.dataSourceMode === 'view' ? 'View' : (source?.sourceType ?? 'Table');
    const view = s.availableViews.find(v => v.viewName === s.selectedDataModelId);
    const sourceName = s.dataSourceMode === 'view'
      ? (view?.viewName ?? s.selectedDataModelId)
      : (source?.name ?? s.selectedDataModelId);
    return { sourceName, sourceType };
  }

  /** Serializes every sheet (name + source + config) so a multi-page report persists in one record. */
  private buildAllSheets(): ReportSheetConfig[] {
    this.saveActiveSheetState();
    return this.sheetsService.sheets.map(sheet => {
      const s = (sheet.state ?? this.captureSheetState()) as ReportSheetSnapshot;
      const { sourceName, sourceType } = this.resolveSourceFromState(s);
      return { name: sheet.name, sourceName, sourceType, config: this.configFromState(s) };
    });
  }

  /**
   * Rebuilds the live AG Grid preview from current builder state. Only needed for
   * STRUCTURAL changes (columns shown/hidden, grouping, pinning, calculated fields,
   * data source) — color and merge edits use refreshGridStyles()/redrawRows() instead,
   * since resetting columnDefs here would otherwise discard any column widths the user
   * has resized or auto-sized. Column widths are captured before the rebuild and
   * reapplied after, so a structural edit never undoes manual sizing either.
   */
  rebuildPreviewGrid(): void {
    // Keep formatting attached to columns whose displayed name a rename rule just changed.
    this.syncColumnKeysWithRenames();
    // enableCellSpan is an AG Grid INITIAL property, so a change only takes effect on a fresh grid.
    // Flip it up front and, if it changed, tear the grid down (empty rows + detectChanges) so the
    // *ngIf recreates it with the new value before we push the real rows/columns below.
    const nextEnableCellSpan = hasRowMerges(this.mergedCellRanges);
    if (nextEnableCellSpan !== this.gridEnableCellSpan) {
      this.gridEnableCellSpan = nextEnableCellSpan;
      this.previewRows = [];
      this.gridPinnedBottomRowData = [];
      this.cdr.detectChanges();
    }
    const prevWidths = this.liveGridApi?.getColumnState()?.map(s => ({ colId: s.colId, width: s.width }));
    this.previewRows = this.computePreviewRows();
    console.log('Preview rows computed:', this.previewRows);
    this.gridColumnDefs = this.decorateCustomHeaders(this.decorateWithSelectionHighlight(
      this.decorateSingleLineHeaders(
        this.decorateEmbeddedCells(
        buildReportGridColumns(() => this.buildLiveConfig(), this.previewColumns, this.previewRows, this.tablePreviewData?.columnTypes),
        ),
      ),
    ));
    const pinned: Record<string, unknown>[] = [];
    if (this.showTotals) {
      // Only columns the user picked a Total for: Sum-columns land in the Sum row, Average-columns in the Average row.
      pinned.push(...computeTotalsRows(this.buildLiveConfig(), this.previewRows, this.previewColumns));
    }
    // The grand total is a controlled pinned "Total" row so it sits contiguous with the Sum/Average rows.
    if (this.grandTotalAtBottom) {
      const grand = computeGrandTotalRow(this.buildLiveConfig(), this.previewRows, this.previewColumns);
      if (grand) pinned.push(grand);
    }
    // Each column-scope DAX measure is a summary row: name on the left, value at the far right.
    const firstCol = this.previewColumns[0];
    const lastCol = this.previewColumns[this.previewColumns.length - 1];
    if (firstCol) {
      for (const m of this.daxColumnMeasures) {
        // Single-column reports have nowhere separate for the value, so fall back to "Name: value".
        pinned.push(firstCol === lastCol
          ? { [firstCol]: this.daxSummaryLabel(m) }
          : { [firstCol]: m.name?.trim() || 'New Metric', [lastCol]: this.daxSummaryValue(m) });
      }
    }
    this.gridPinnedBottomRowData = pinned;
    // Synchronous CD — no zone.js, so a scheduled markForCheck won't push the new columnDefs /
    // pinned totals into the grid until the next event.
    this.cdr.detectChanges();
    if (prevWidths?.length) {
      // Only re-apply widths for columns that still exist — a Data Transformation rename (or any
      // column change) drops the old colId, and applying stale state warns ("column X is not visible").
      const validColIds = new Set(this.displayedLeafFields());
      const widths = prevWidths.filter(s => s.colId != null && validColIds.has(s.colId));
      // When any column group exists, re-assert the group-contiguous column order from the new
      // defs. If a previously grouped column is ungrouped while the grid's displayed order still
      // has it (or another member) interleaved between the group's columns, AG Grid renders that
      // group header split into segments; re-asserting the def order keeps every group's columns
      // contiguous so the removed column cleanly leaves the group. Ungrouped reports can't split,
      // so there we preserve widths and any manual drag order.
      const hasGroups = this.gridColumnDefs.some(d => 'children' in d && !!(d as ColGroupDef).children);
      if (hasGroups) {
        const widthByCol = new Map(widths.map(s => [s.colId, s.width]));
        const state = this.displayedLeafFields().map(colId => {
          const width = widthByCol.get(colId);
          return width != null ? { colId, width } : { colId };
        });
        setTimeout(() => {
          this.liveGridApi?.applyColumnState({ state, applyOrder: true });
          this.growColumnsAfterWidthRestore();
        }, 0);
      } else if (widths.length) {
        // Runs after Angular has pushed the new columnDefs into the grid (next macrotask).
        setTimeout(() => {
          this.liveGridApi?.applyColumnState({ state: widths, applyOrder: false });
          this.growColumnsAfterWidthRestore();
        }, 0);
      }
    }
    this.updateExcelStyles();
    this.scheduleHistorySnapshot();
  }

  /** Restoring pre-rebuild widths would otherwise undo widening for longer values in the new rows. */
  private growColumnsAfterWidthRestore(): void {
    if (this.columnSizingMode === 'auto') this.growColumnsToFitValues('main');
  }

  /** Repaints cell/header colors and cell merges in place — no columnDefs reset, so column widths are untouched. */
  private refreshGridStyles(): void {
    for (const api of [this.liveGridApi, this.liveExpandGridApi]) {
      api?.refreshHeader();
      api?.refreshCells({ force: true });
      api?.redrawRows();
    }
    this.updateExcelStyles();
    this.scheduleHistorySnapshot();
    this.cdr.markForCheck();
  }

  // ─── Undo/redo ──────────────────────────────────────────────────────────────
  /** Debounced: coalesces a burst of edits into a single history entry once changes settle. */
  private scheduleHistorySnapshot(): void {
    if (this.isRestoringHistory) return;
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => { this.historyTimer = null; this.commitHistorySnapshot(); }, 400);
  }

  /** Pushes the current sheet state onto the undo stack (skipping no-op duplicates) and drops the redo branch. */
  private commitHistorySnapshot(): void {
    if (this.isRestoringHistory) return;
    const snap = this.captureSheetState();
    const json = JSON.stringify(snap);
    if (this.undoStack.length && this.undoStack[this.undoStack.length - 1].json === json) return;
    const hadHistory = this.undoStack.length > 0;
    this.undoStack.push({ snap, json });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    if (hadHistory) this.redoStack = [];
    this.cdr.markForCheck();
  }

  /** Clears history and seeds a fresh baseline (called on sheet switch / source change). */
  private resetHistory(): void {
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
    this.undoStack = [];
    this.redoStack = [];
    this.commitHistorySnapshot();
  }

  undo(): void {
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
    if (this.undoStack.length < 2) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    this.applyHistorySnapshot(this.undoStack[this.undoStack.length - 1].snap);
  }

  redo(): void {
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.applyHistorySnapshot(next.snap);
  }

  private applyHistorySnapshot(snap: ReportSheetSnapshot): void {
    this.isRestoringHistory = true;
    this.applySheetState(structuredClone(snap));
    this.rebuildPreviewGrid();
    this.refreshGridStyles();
    this.isRestoringHistory = false;
    this.cdr.detectChanges();
  }

  /** Cell/row/column color maps for exports, sourced from the builder's live state. */
  private exportColorSource(): ExportCellColorSource {
    return {
      cellColors: this.cellColors,
      pageRowColors: this.pageRowColors,
      rowColors: this.rowColors,
      rowColorsByKey: this.rowColorsByKey,
      cellTextColors: this.cellTextColors,
      rowTextColors: this.rowTextColors,
      rowTextColorsByKey: this.rowTextColorsByKey,
      getColumnColor: (field) => this.columnConfigs[this.columnSourceField(field)]?.color,
      getColumnTextColor: (field) => this.columnConfigs[this.columnSourceField(field)]?.textColor,
    };
  }

  /** Body-cell class ids encoding its bg/text color (page-relative, matching the on-screen cellStyle) so native Excel export can paint it. */
  private exportCellClass = (params: CellClassParams): string[] => {
    const style = params.node?.rowPinned
      ? getSummaryRowStyle(this, getPinnedSummaryLabel(params.node))
      : getReportGroupRowStyle(this.buildLiveConfig(), params.node);
    if (params.node?.rowPinned || style) {
      const classes: string[] = [];
      if (this.exportColors.isExportHex(style?.backgroundColor)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(style.backgroundColor)));
      if (this.exportColors.isExportHex(style?.color)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(style.color)));
      return classes;
    }
    const field = params.colDef.field;
    const rowIndex = params.node?.rowIndex;
    if (!field || params.node?.rowPinned || rowIndex == null || rowIndex < 0) return [];
    const pageSize = getReportGridPageSize(params.api);
    const src = this.exportColorSource();
    const rowData = params.data as Record<string, unknown> | undefined;
    const colorKey = typeof rowData?.[ROW_COLOR_KEY] === 'string' ? String(rowData[ROW_COLOR_KEY]) : undefined;
    const bg = this.exportColors.resolveCellBackground(rowIndex, field, pageSize, src, colorKey);
    const fg = this.exportColors.resolveCellTextColor(rowIndex, field, pageSize, src, colorKey);
    const classes: string[] = [];
    // Manual cell/row/column color wins; otherwise, when branded rows are on, odd rows carry the stripe so it persists in the export.
    let bgHex = this.exportColors.isExportHex(bg) ? this.exportColors.normalizeHex(bg) : '';
    if (this.brandedRows && !bgHex && rowIndex % 2 === 1) bgHex = this.exportColors.normalizeHex(this.tint(this.gridAccentColor, 0.06));
    if (bgHex) classes.push(this.exportColors.classId('bg', bgHex));
    if (this.exportColors.isExportHex(fg)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(fg)));
    return classes;
  };

  /** Header-cell class id encoding the column's header color (Appearance panel) so native Excel export paints it too. */
  private exportHeaderClass = (field: string | null | undefined): string[] => {
    const config = this.buildLiveConfig();
    const bg = field ? resolveHeaderBackgroundColor(config, field) : undefined;
    const fg = field ? resolveHeaderTextColor(config, field) : undefined;
    const classes: string[] = [];
    if (this.exportColors.isExportHex(bg)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(bg)));
    if (this.exportColors.isExportHex(fg)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(fg)));
    return classes;
  };

  /**
   * Rebuilds the Excel style registry so a native Excel export reproduces the preview's colors.
   * AG Grid's `excelStyles` is an INITIAL-only option (can't be updated after grid init), so we seed
   * it with every preset palette color up front — that way any color the user later picks already has
   * a registered style — and merge in any custom colors already present when the grid is first built.
   */
  private updateExcelStyles(): void {
    const bgs: string[] = [...CELL_COLOR_PALETTE, ...TEXT_COLOR_PALETTE];
    const fgs: string[] = [...CELL_COLOR_PALETTE, ...TEXT_COLOR_PALETTE];
    const add = (list: string[], v?: string) => { if (this.exportColors.isExportHex(v)) list.push(this.exportColors.normalizeHex(v)); };
    Object.values(this.cellColors).forEach(v => add(bgs, v));
    Object.values(this.rowColors).forEach(v => add(bgs, v));
    Object.values(this.rowColorsByKey).forEach(v => add(bgs, v));
    Object.values(this.pageRowColors).forEach(v => add(bgs, v));
    Object.values(this.headerCellColors).forEach(v => add(bgs, v));
    Object.values(this.summaryRowColors).forEach(v => add(bgs, v));
    Object.values(this.summaryRowTextColors).forEach(v => add(fgs, v));
    add(bgs, this.headerRowColor);
    add(fgs, this.headerRowTextColor);
    Object.values(this.headerCellTextColors).forEach(v => add(fgs, v));
    Object.values(this.cellTextColors).forEach(v => add(fgs, v));
    Object.values(this.rowTextColors).forEach(v => add(fgs, v));
    Object.values(this.rowTextColorsByKey).forEach(v => add(fgs, v));
    Object.values(this.columnConfigs).forEach(c => { add(bgs, c?.color); add(fgs, c?.textColor); });
    // Pre-register every built-in theme's branded stripe (excelStyles is INITIAL-only) so exports keep striping.
    this.builtInThemes.forEach(t => add(bgs, this.tint(t.accent, 0.06)));
    add(bgs, '#F2F4F9');
    this.gridExcelStyles = this.exportColors.buildExcelStyles(bgs, fgs);
  }

  /**
   * AG Grid computes a cell's colSpan/spanRows only once, when that cell's controller is
   * first created — it's cached from then on and only recalculated when a structural change
   * fires AG Grid's own `displayedColumnsChanged` event (reorder/pin/visibility). A merge or
   * unmerge changes what the *same* colSpan callback returns for *already-rendered* cells,
   * without altering column structure, so that event never fires and the stale cached span
   * sticks — even though rebuildPreviewGrid() correctly updates our own mergedCellRanges state
   * (confirmed by "Unmerge Cells" showing up right after a merge that visually did nothing).
   * redrawRows() destroys and recreates cell controllers, forcing a fresh colSpan read.
   *
   * Row merges (spanRows) have a second, independent cache on top of this: AG Grid detects
   * the changed spanRows callback and schedules its OWN internal rebuild of that cache via a
   * 0ms setTimeout. A same-delay setTimeout here would race it — whichever was *queued* first
   * runs first, and ours gets queued before AG Grid's (which is only scheduled once the new
   * columnDefs actually land inside AG Grid), so redrawRows() could fire against still-stale
   * span boundaries. A strictly later delay guarantees we run after it regardless of queuing
   * order, since the browser fires timers in target-time order, not queue order.
   */
  private forceSpanRecalculation(): void {
    setTimeout(() => {
      for (const api of [this.liveGridApi, this.liveExpandGridApi]) {
        if (!api) continue;
        // Reapply the definitions so AG Grid rebuilds its cell-span controllers for every range.
        api.setGridOption('columnDefs', this.gridColumnDefs);
        api.redrawRows();
      }
    }, 50);
  }

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api;
    this.rebuildPreviewGrid();
    // Zoneless app: flush the post-ready rebuild so a freshly (re)created grid
    // — e.g. after picking a data source on a new sheet — paints immediately
    // instead of waiting for the next user interaction.
    this.deferRender();
  }

  /**
   * Runs a change-detection pass on the next macrotask. Zoneless (no zone.js) means an inline
   * detectChanges() inside an async HTTP callback doesn't reliably materialize a grid that was
   * torn down and re-created via *ngIf (as happens when picking a data source on a fresh sheet) —
   * the grid then only appeared after an unrelated click. A deferred pass mirrors that click.
   */
  private deferRender(): void {
    setTimeout(() => { if (!this.viewDestroyed) this.cdr.detectChanges(); });
  }

  // ─── Cell range selection ───────────────────────────────────────────────
  // AG Grid's native `cellSelection` range-select is explicitly incompatible with
  // `colDef.spanRows` (the mechanism row-merges need — see report-grid-columns.util.ts),
  // so multi-cell selection here is implemented directly instead: click picks a single
  // cell, shift+click extends a rectangle from the last-clicked anchor. `selectionRange`
  // drives both the highlight (via decorateWithSelectionHighlight) and the context menu's
  // bulk color/merge actions.
  private selectionAnchor: { rowIndex: number; field: string } | null = null;
  private selectionRangeValue: { rows: number[]; fields: string[] } | null = null;

  get selectionRange(): { rows: number[]; fields: string[] } | null {
    return this.selectionRangeValue;
  }

  set selectionRange(range: { rows: number[]; fields: string[] } | null) {
    this.selectionRangeValue = range;
    // Cell/column selections and group-header selections are mutually exclusive.
    if (range && this.selectedGroupHeader) {
      this.selectedGroupHeader = null;
      this.refreshGroupHeaders();
    }
  }

  /** Column group / sub-group header picked by clicking it; the alignment buttons then target it. */
  selectedGroupHeader: ReportHeaderGroupRef | null = null;

  onColumnHeaderClicked(event: ColumnHeaderClickedEvent): void {
    const column = event.column;
    if (!column || !('getColGroupDef' in column)) return;
    const ref = (column.getColGroupDef()?.context as { reportHeaderGroup?: ReportHeaderGroupRef } | undefined)?.reportHeaderGroup;
    if (!ref) return;
    this.selectionRange = null;
    this.selectionAnchor = null;
    this.selectedColumnFields = [];
    this.headerSelectionAnchor = null;
    this.selectedGroupHeader = ref;
    this.refreshGroupHeaders();
    this.refreshGridStyles();
    this.cdr.markForCheck();
  }

  private isGroupHeaderSelected(ref: ReportHeaderGroupRef): boolean {
    const selected = this.selectedGroupHeader;
    return !!selected && selected.level === ref.level && selected.name === ref.name;
  }

  /** Group header classes (alignment + selection) are re-evaluated on header refresh. */
  private refreshGroupHeaders(): void {
    this.liveGridApi?.refreshHeader();
    this.liveExpandGridApi?.refreshHeader();
  }

  onCellClicked(event: CellClickedEvent): void {
    if (event.node.rowPinned || event.node.footer) return;
    const rowIndex = event.node.rowIndex;
    const field = event.column?.getColId();
    const mouseEvent = event.event as MouseEvent | null | undefined;
    if (rowIndex == null || !field) return;

    this.selectedColumnFields = [];
    this.headerSelectionAnchor = null;
    if (mouseEvent?.shiftKey && this.selectionAnchor) {
      this.selectionRange = this.buildRectangle(this.selectionAnchor, { rowIndex, field });
    } else {
      this.selectionAnchor = { rowIndex, field };
      this.selectionRange = { rows: [rowIndex], fields: [field] };
    }
    this.refreshGridStyles();
  }

  private buildRectangle(a: { rowIndex: number; field: string }, b: { rowIndex: number; field: string }): { rows: number[]; fields: string[] } {
    const startRow = Math.min(a.rowIndex, b.rowIndex);
    const endRow = Math.max(a.rowIndex, b.rowIndex);
    const rows: number[] = [];
    for (let i = startRow; i <= endRow; i++) rows.push(i);

    // Adjacency must follow the grid's actual DISPLAYED column order, not the raw shown-field
    // list — column grouping rearranges grouped fields to sit together under their group
    // header, so previewColumns and the real on-screen order diverge as soon as any column
    // is grouped, which silently merged the wrong cells.
    const cols = this.displayedLeafFields();
    const ai = cols.indexOf(a.field);
    const bi = cols.indexOf(b.field);
    const startCol = Math.min(ai, bi);
    const endCol = Math.max(ai, bi);
    const fields = ai === -1 || bi === -1 ? [a.field, b.field] : cols.slice(startCol, endCol + 1);
    return { rows, fields };
  }

  /** Flattens gridColumnDefs (including nested group/subGroup children) into field names in actual display order. */
  private displayedLeafFields(): string[] {
    const fields: string[] = [];
    const walk = (def: ColDef | ColGroupDef): void => {
      if ('children' in def && def.children) {
        def.children.forEach(walk);
        return;
      }
      const field = (def as ColDef).field;
      if (field) fields.push(field);
    };
    this.gridColumnDefs.forEach(walk);
    return fields;
  }

  /** The selection covering (rowIndex, field) for context-menu bulk actions — resets to just that cell if it clicked outside the current selection. */
  private getSelectionAround(rowIndex: number, field: string): { rows: number[]; fields: string[] } {
    const sel = this.selectionRange;
    if (sel && sel.rows.includes(rowIndex) && sel.fields.includes(field)) return sel;
    this.selectionAnchor = { rowIndex, field };
    this.selectionRange = { rows: [rowIndex], fields: [field] };
    return this.selectionRange;
  }

  /** Adds a selection-highlight outline on top of each column's own cellStyle, without touching the shared util (selection is builder-only UI state). */
  private decorateWithSelectionHighlight(defs: (ColDef | ColGroupDef)[]): (ColDef | ColGroupDef)[] {
    const isSelected = (rowIndex: number | null | undefined, field: string): boolean => {
      const sel = this.selectionRange;
      return !!sel && rowIndex != null && sel.rows.includes(rowIndex) && sel.fields.includes(field);
    };
    const decorate = (def: ColDef | ColGroupDef): ColDef | ColGroupDef => {
      if ('children' in def && def.children) {
        return { ...def, children: def.children.map(decorate) } as ColGroupDef;
      }
      const col = def as ColDef;
      if (!col.field) return col;
      const field = col.field;
      const baseCellStyle = col.cellStyle;
      return {
        ...col,
        cellStyle: (params: CellClassParams) => {
          const base = typeof baseCellStyle === 'function' ? baseCellStyle(params) : baseCellStyle;
          if (params.node?.rowPinned || params.node?.footer) return base ?? null;
          if (!isSelected(params.node?.rowIndex, field)) return base ?? null;
          return { ...(base ?? {}), outline: '2px solid #2563EB', outlineOffset: '-2px' };
        },
      };
    };
    return defs.map(decorate);
  }

  /** Forces single-line leaf headers in the builder preview so auto-size widens columns to fit them (viewer keeps the shared util's wrapping). */
  private decorateSingleLineHeaders(defs: (ColDef | ColGroupDef)[]): (ColDef | ColGroupDef)[] {
    const decorate = (def: ColDef | ColGroupDef): ColDef | ColGroupDef => {
      if ('children' in def && def.children) {
        return { ...def, children: def.children.map(decorate) } as ColGroupDef;
      }
      const col = def as ColDef;
      if (!col.field) return col;
      // Vertical headers keep auto-height so the header row grows to fit the rotated text.
      const verticalHeader = this.headerCellOrientations[col.field] === 'vertical';
      // Headers with a Shift+Enter newline keep wrap + auto height so every line stays visible.
      const multiline = typeof col.headerName === 'string' && col.headerName.includes('\n');
      const existing = Array.isArray(col.headerClass) ? col.headerClass : (typeof col.headerClass === 'string' ? [col.headerClass] : []);
      return {
        ...col,
        ...(multiline ? { headerClass: [...existing, 'rb-header-multiline'] } : {}),
        wrapHeaderText: multiline,
        autoHeaderHeight: verticalHeader || multiline,
      };
    };
    return defs.map(decorate);
  }

  /**
   * Routes every data column through the custom header. It never sorts on header click
   * (sorting stays available via the header menu button); inserted columns additionally
   * allow inline rename. The auto row-number column has no field and keeps its native header.
   */
  private decorateCustomHeaders(defs: (ColDef | ColGroupDef)[]): (ColDef | ColGroupDef)[] {
    const decorate = (def: ColDef | ColGroupDef): ColDef | ColGroupDef => {
      if ('children' in def && def.children) {
        const group = def as ColGroupDef;
        const ref = (group.context as { reportHeaderGroup?: ReportHeaderGroupRef } | undefined)?.reportHeaderGroup;
        const baseClass = group.headerClass;
        return {
          ...group,
          // Group headers are selectable (click), so add the selection highlight to their live class list.
          ...(ref ? {
            headerClass: (params: HeaderClassParams) => {
              const base = typeof baseClass === 'function' ? baseClass(params) : baseClass;
              const classes = Array.isArray(base) ? [...base] : base ? [base] : [];
              if (this.isGroupHeaderSelected(ref)) classes.push('rb-group-header--selected');
              return classes;
            },
          } : {}),
          children: group.children.map(decorate),
        } as ColGroupDef;
      }
      const col = def as ColDef;
      if (col.colId === ROW_NUMBER_COL_ID) {
        // The auto '#' column has no data field but its header text is user-editable (persisted to
        // config.rowNumberHeader). It carries no filter/menu/selection handlers.
        return {
          ...col,
          headerComponent: EditableHeaderComponent,
          headerComponentParams: {
            allowRename: true,
            onRename: (field: string, name: string) => this.renameColumn(field, name),
          },
        };
      }
      if (!col.field) return col;
      return {
        ...col,
        headerComponent: EditableHeaderComponent,
        headerComponentParams: {
          allowRename: !!this.columnConfigs[col.field]?.custom,
          onRename: (field: string, name: string) => this.renameColumn(field, name),
          onSelectColumn: (field: string, mods: { shift: boolean; ctrl: boolean }) => this.selectColumn(field, mods),
          onSelectColumnCells: (field: string) => this.selectColumnCells(field),
          isColumnSelected: (field: string) => this.selectedColumnFields.includes(field),
        },
      };
    };
    return defs.map(decorate);
  }

  /** Columns whose headers render as selected (header-click selection); drives both the highlight and header-targeted operations. */
  private selectedColumnFields: string[] = [];
  private headerSelectionAnchor: string | null = null;

  /** Clears any cell/column selection (used on click-away) so subsequent report-wide actions apply to everything. */
  private clearGridSelection(): void {
    this.liveGridApi?.clearFocusedCell();
    this.liveExpandGridApi?.clearFocusedCell();
    if (this.selectedGroupHeader) {
      this.selectedGroupHeader = null;
      this.refreshGroupHeaders();
    }
    if (!this.selectionRange && !this.selectionAnchor && !this.selectedColumnFields.length) return;
    this.selectionRange = null;
    this.selectionAnchor = null;
    this.selectedColumnFields = [];
    this.headerSelectionAnchor = null;
    this.refreshGridStyles();
  }

  /**
   * Single header click selects only that column's header. Shift+click extends the header
   * selection across a contiguous column range; Ctrl/Cmd+click toggles a column in/out.
   */
  selectColumn(field: string, mods?: { shift: boolean; ctrl: boolean }): void {
    const displayed = this.displayedLeafFields();
    const current = this.selectionRange && !this.selectionRange.rows.length ? this.selectionRange.fields : [];
    let fields: string[];
    if (mods?.shift && this.headerSelectionAnchor) {
      const ai = displayed.indexOf(this.headerSelectionAnchor);
      const bi = displayed.indexOf(field);
      fields = ai >= 0 && bi >= 0 ? displayed.slice(Math.min(ai, bi), Math.max(ai, bi) + 1) : [field];
    } else if (mods?.ctrl) {
      fields = current.includes(field) ? current.filter(f => f !== field) : [...current, field];
      this.headerSelectionAnchor = field;
    } else {
      fields = [field];
      this.headerSelectionAnchor = field;
    }
    this.selectedColumnFields = fields;
    this.selectionAnchor = null;
    this.selectionRange = fields.length ? { rows: [], fields } : null;
    this.refreshGridStyles();
  }

  /** Double header click: selects every data cell in the column so bulk cell operations apply to the whole column. */
  selectColumnCells(field: string): void {
    this.selectedColumnFields = [field];
    this.headerSelectionAnchor = field;
    const rowCount = this.previewRows.length;
    if (!rowCount) {
      this.selectionAnchor = null;
      this.selectionRange = { rows: [], fields: [field] };
    } else {
      this.selectionAnchor = { rowIndex: 0, field };
      this.selectionRange = { rows: Array.from({ length: rowCount }, (_, i) => i), fields: [field] };
    }
    this.refreshGridStyles();
  }

  /** Renames a custom column's display header (the underlying field id is unchanged). */
  renameColumn(field: string, name: string): void {
    if (field === ROW_NUMBER_COL_ID) {
      this.rowNumberHeader = name.trim() || undefined;
      this.rebuildPreviewGrid();
      return;
    }
    const cfg = this.columnConfigs[field];
    if (!cfg) return;
    cfg.header = name;
    this.rebuildPreviewGrid();
  }

  private colorMenuItems(apply: (color: string) => void, current: string | undefined, palette: readonly string[] = CELL_COLOR_PALETTE): MenuItemDef[] {
    const presets: MenuItemDef[] = palette.map(color => ({
      name: color === '#FFFFFF' ? 'None' : color,
      icon: `<span style="display:inline-block;width:12px;height:12px;border:1px solid #D0D5DD;border-radius:3px;background:${color}"></span>`,
      checked: current === color,
      action: () => { apply(color === '#FFFFFF' ? '' : color); this.refreshGridStyles(); },
    }));
    return [
      ...presets,
      {
        name: 'Custom Color…',
        icon: '<span style="display:inline-block;width:12px;height:12px;border:1px solid #D0D5DD;border-radius:3px;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"></span>',
        action: () => this.openCustomColorPicker(apply, current),
      },
    ];
  }

  getContextMenuItems = (params: GetContextMenuItemsParams): (DefaultMenuItem | MenuItemDef)[] => {
    if (params.node?.rowPinned || params.node?.footer) {
      const label = getPinnedSummaryLabel(params.node);
      const items: (DefaultMenuItem | MenuItemDef)[] = ['copy', 'export'];
      if (label) {
        items.push('separator', {
          name: `${label} row background color`,
          subMenu: this.colorMenuItems(color => {
            if (color) this.summaryRowColors[label] = color;
            else delete this.summaryRowColors[label];
          }, this.summaryRowColors[label]),
        }, {
          name: `${label} row Text color`,
          subMenu: this.colorMenuItems(color => {
            if (color) this.summaryRowTextColors[label] = color;
            else delete this.summaryRowTextColors[label];
          }, this.summaryRowTextColors[label], TEXT_COLOR_PALETTE),
        });
      }
      return this.wrapMenuActionsInZone(items) as (DefaultMenuItem | MenuItemDef)[];
    }
    // AG Grid can report no column/row when the right-click lands on a spanned (merged) cell's
    // body or just off a cell — fall back to the active selection so structural actions
    // (Insert/Delete/Merge/Unmerge/Pin) still resolve to the cell the user has selected.
    const field = params.column?.getColId() ?? this.selectionAnchor?.field ?? this.selectionRange?.fields[0];
    const rowIndex = params.node?.rowIndex ?? this.selectionAnchor?.rowIndex ?? this.selectionRange?.rows[0] ?? -1;
    const sel = rowIndex >= 0 && field ? this.getSelectionAround(rowIndex, field) : null;
    const isMultiCell = !!sel && (sel.rows.length > 1 || sel.fields.length > 1);
    const columnFields = isMultiCell ? sel!.fields : field ? [field] : [];
    const headerFieldFor = (columnField: string): string => {
      const column = columnField === params.column?.getColId() ? params.column : params.api?.getColumn?.(columnField);
      return getReportColumnField(column?.getColDef?.() ?? {}) ?? columnField;
    };
    const headerFields = columnFields.map(headerFieldFor);
    const headerField = field ? headerFieldFor(field) : undefined;

    // Offer Unmerge only when the current selection is exactly an existing merge. A new
    // multi-cell selection must still be able to merge, even when it touches an old range.
    const anchor = field && sel && (!isMultiCell || this.isExactMergeSelection(sel))
      ? this.findMergeContaining(rowIndex, field)
      : undefined;

    // --- Headers ---
    const headersChildren: MenuItemDef[] = [];
    if (headerField) {
      headersChildren.push(
        { name: 'Header color', subMenu: this.colorMenuItems(c => { headerFields.forEach(f => this.setHeaderCellColor(f, c)); }, this.headerCellColors[headerField]) },
        { name: 'Header Text color', subMenu: this.colorMenuItems(c => { headerFields.forEach(f => this.setHeaderCellTextColor(f, c)); }, this.headerCellTextColors[headerField], TEXT_COLOR_PALETTE) },
        { name: 'Header Text Orientation', subMenu: this.orientationMenuItems(o => { headerFields.forEach(f => this.setHeaderCellOrientation(f, o)); }, this.headerCellOrientations[headerField]) },
        { name: 'Header Text Alignment', subMenu: this.alignmentMenuItems(a => { headerFields.forEach(f => this.setHeaderCellAlignment(f, a)); }, this.headerCellAlignments[headerField]) },
      );
    }
    headersChildren.push({ name: 'All headers color', subMenu: this.colorMenuItems(c => { this.headerRowColor = c; }, this.headerRowColor) });
    headersChildren.push({ name: 'All headers Text color', subMenu: this.colorMenuItems(c => { this.headerRowTextColor = c; }, this.headerRowTextColor, TEXT_COLOR_PALETTE) });

    // --- Cells (colors + Text Orientation + Split + Merge/Unmerge) ---
    const cellsChildren: MenuItemDef[] = [];
    if (sel) {
      cellsChildren.push(
        { name: 'Cell color', subMenu: this.colorMenuItems(c => { for (const r of sel.rows) for (const f of sel.fields) this.setCellColor(r, f, c); }, this.getCellSetting(this.cellColors, rowIndex, field!)) },
        { name: 'Cell Text color', subMenu: this.colorMenuItems(c => { for (const r of sel.rows) for (const f of sel.fields) this.setCellTextColor(r, f, c); }, this.getCellSetting(this.cellTextColors, rowIndex, field!), TEXT_COLOR_PALETTE) },
        { name: 'Text Orientation', subMenu: this.orientationMenuItems(o => { for (const r of sel.rows) for (const f of sel.fields) this.setCellOrientation(r, f, o); }, this.getCellSetting(this.cellOrientations, rowIndex, field!)) },
        { name: 'Text Alignment', subMenu: this.alignmentMenuItems(a => { for (const r of sel.rows) for (const f of sel.fields) this.setCellAlignment(r, f, a); }, this.getCellSetting(this.cellAlignments, rowIndex, field!)) },
        { name: 'Split Cells', action: () => this.openEmbedDialog(sel) },
      );
    }
    if (!anchor && sel && isMultiCell) {
      // AG Grid can't merge across rows AND columns at once (its column-merge and row-merge
      // mechanisms are mutually exclusive on a single column) — so a selection has to be a
      // single row (column merge) or a single column (row merge).
      const canMerge = (sel.fields.length > 1) !== (sel.rows.length > 1);
      cellsChildren.push(canMerge
        ? { name: 'Merge Cells', action: () => this.mergeSelection(sel) }
        : { name: 'Merge Cells (select a single row or single column)', disabled: true });
    }
    if (anchor) cellsChildren.push({ name: 'Unmerge Cells', action: () => this.unmergeAt(anchor.rowIndex, anchor.field) });

    // --- Columns ---
    const columnsChildren: MenuItemDef[] = [];
    if (field) {
      columnsChildren.push(
        { name: 'Column color', subMenu: this.colorMenuItems(c => { columnFields.forEach(f => this.setColumnColor(f, c)); }, this.columnConfigs[this.columnSourceField(field)]?.color) },
        { name: 'Insert column to left', action: () => this.insertColumnLeft(field) },
        { name: columnFields.length > 1 ? `Delete ${columnFields.length} Columns` : 'Delete column', action: () => this.deleteColumns(columnFields) },
        { name: 'Column Text color', subMenu: this.colorMenuItems(c => { columnFields.forEach(f => this.setColumnTextColor(f, c)); }, this.columnConfigs[this.columnSourceField(field)]?.textColor, TEXT_COLOR_PALETTE) },
      );
    }

    // --- Rows ---
    const rowsChildren: MenuItemDef[] = [];
    const groupRowKey = getReportGroupRowColorKey(params.node);
    if (sel) {
      rowsChildren.push(
        { name: 'Insert Row above', action: () => this.insertRowAbove(Math.min(...sel.rows)) },
        { name: sel.rows.length > 1 ? `Delete ${sel.rows.length} Rows` : 'Delete Row', action: () => this.deleteRows(sel.rows) },
        { name: 'Row color', subMenu: this.colorMenuItems(c => {
          if (groupRowKey) this.setGroupRowColor(groupRowKey, c, false);
          else sel.rows.forEach(r => this.setRowColor(r, c));
        }, groupRowKey ? this.rowColorsByKey[groupRowKey] : this.getRowColor(rowIndex) ?? this.pageRowColors[rowIndex]) },
        { name: 'Row Text color', subMenu: this.colorMenuItems(c => {
          if (groupRowKey) this.setGroupRowColor(groupRowKey, c, true);
          else sel.rows.forEach(r => this.setRowTextColor(r, c));
        }, groupRowKey ? this.rowTextColorsByKey[groupRowKey] : this.getRowTextColor(rowIndex), TEXT_COLOR_PALETTE) },
      );
    }

    // --- Assemble: Copy, Export, Pin | Headers, Cells, Columns, Rows | Conditional Formatting ---
    const items: (DefaultMenuItem | MenuItemDef)[] = ['copy', 'export'];
    if (field) {
      const isPinned = this.pinnedColumns.includes(field);
      items.push({ name: isPinned ? 'Unpin Column' : 'Pin Column to Left', action: () => this.pinColumnToLeft(field) });
    }
    const entityMenus: MenuItemDef[] = [];
    if (headersChildren.length) entityMenus.push({ name: 'Headers', subMenu: headersChildren });
    if (cellsChildren.length) entityMenus.push({ name: 'Cells', subMenu: cellsChildren });
    if (columnsChildren.length) entityMenus.push({ name: 'Columns', subMenu: columnsChildren });
    if (rowsChildren.length) entityMenus.push({ name: 'Rows', subMenu: rowsChildren });
    if (entityMenus.length) items.push('separator', ...entityMenus);
    if (field) items.push('separator', { name: 'Conditional Formatting', action: () => this.openConditionalFormatting(columnFields) });
    if (field && field !== ROW_NUMBER_COL_ID && this.isAggregatableField(field)) {
      items.push({ name: this.dataBarColumns.includes(field) ? 'Remove Data Bars' : 'Show Data Bars', action: () => this.toggleDataBars(field) });
    }
    const drillNode = params.node;
    if (drillNode && !drillNode.rowPinned && !drillNode.footer && this.reportDrillRecords(drillNode).length) {
      items.push({ name: 'Drill to Detail', action: () => this.openReportDrill(drillNode) });
    }

    return this.wrapMenuActionsInZone(items) as (DefaultMenuItem | MenuItemDef)[];
  };

  /**
   * AG Grid's native context menu is a vanilla-JS overlay outside Angular's knowledge, so
   * its item `action` callbacks run OUTSIDE NgZone. Anything that mutates state via a plain
   * property assignment (e.g. rebuildPreviewGrid() reassigning gridColumnDefs, which the
   * [columnDefs] binding needs a change-detection pass to pick up) then silently never
   * reaches the view — which is exactly why "Merge Cells" appeared to do nothing: color
   * actions worked anyway because they call the grid API directly (refreshCells/refreshHeader),
   * bypassing Angular's binding entirely, but merge does not. Re-entering the zone here fixes
   * it for every menu action, present and future, in one place instead of one at a time.
   */
  private wrapMenuActionsInZone(items: (string | MenuItemDef)[]): (string | MenuItemDef)[] {
    const wrap = (item: string | MenuItemDef): string | MenuItemDef => {
      if (typeof item === 'string') return item;
      const wrapped: MenuItemDef = { ...item };
      if (typeof wrapped.action === 'function') {
        const original = wrapped.action;
        wrapped.action = (params) => this.zone.run(() => original(params));
      }
      if (Array.isArray(wrapped.subMenu)) {
        wrapped.subMenu = wrapped.subMenu.map(wrap);
      }
      return wrapped;
    };
    return items.map(wrap);
  }

  private mergeSelection(sel: { rows: number[]; fields: string[] }): void {
    const startRowIndex = Math.min(...sel.rows);
    const endRowIndex = Math.max(...sel.rows);
    const isColumnMerge = sel.fields.length > 1;
    const anchorField = sel.fields[0];
    const newRange: MergedCellRange = isColumnMerge
      ? { rowIndex: startRowIndex, field: anchorField, rowSpan: 1, colSpan: sel.fields.length }
      : { rowIndex: startRowIndex, field: anchorField, rowSpan: endRowIndex - startRowIndex + 1, colSpan: 1 };
    const displayedColumns = this.displayedLeafFields();
    const selectedColumnIndexes = sel.fields
      .map(field => displayedColumns.indexOf(field))
      .filter(index => index >= 0);
    const selectionStartColumn = selectedColumnIndexes.length ? Math.min(...selectedColumnIndexes) : -1;
    const selectionEndColumn = selectedColumnIndexes.length ? Math.max(...selectedColumnIndexes) : -1;
    const overlapsSelection = (range: MergedCellRange): boolean => {
      const rangeStartColumn = displayedColumns.indexOf(range.field);
      const rangeEndColumn = rangeStartColumn < 0 ? rangeStartColumn : rangeStartColumn + range.colSpan - 1;
      const rowsOverlap = range.rowIndex <= endRowIndex && range.rowIndex + range.rowSpan - 1 >= startRowIndex;
      const columnsOverlap = rangeStartColumn < 0
        ? sel.fields.includes(range.field)
        : rangeStartColumn <= selectionEndColumn && rangeEndColumn >= selectionStartColumn;
      return rowsOverlap && columnsOverlap;
    };
    this.mergedCellRanges = [
      ...this.mergedCellRanges.filter(r => !overlapsSelection(r)),
      newRange,
    ];
    // Merging can switch a column between plain/column-merge/row-merge mode, which
    // needs a fresh columnDef (rebuildPreviewGrid preserves widths across this).
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
    this.forceSpanRecalculation();
  }

  private unmergeAt(rowIndex: number, field: string): void {
    this.mergedCellRanges = this.mergedCellRanges.filter(r => !(r.field === field && r.rowIndex === rowIndex));
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
    this.forceSpanRecalculation();
  }

  private isExactMergeSelection(sel: { rows: number[]; fields: string[] }): boolean {
    const startRow = Math.min(...sel.rows);
    const endRow = Math.max(...sel.rows);
    const columns = this.displayedLeafFields();
    const selectedIndexes = sel.fields.map(field => columns.indexOf(field)).filter(index => index >= 0);
    if (!selectedIndexes.length) return false;
    const startColumn = Math.min(...selectedIndexes);
    const endColumn = Math.max(...selectedIndexes);
    return this.mergedCellRanges.some(range => {
      const rangeStartColumn = columns.indexOf(range.field);
      if (rangeStartColumn < 0) return false;
      return range.rowIndex === startRow
        && range.rowIndex + range.rowSpan - 1 === endRow
        && rangeStartColumn === startColumn
        && rangeStartColumn + range.colSpan - 1 === endColumn;
    });
  }

  /**
   * Finds the merged range that COVERS (rowIndex, field), not just the one anchored there.
   * A column merge only stores its leftmost (anchor) field but visually spans several columns;
   * a row merge only stores its top (anchor) row but spans several rows. Right-clicking any
   * covered cell must still surface "Unmerge Cells", so we test containment across the merge's
   * full extent — column merges against the actual displayed column order, row merges by row span.
   */
  private findMergeContaining(rowIndex: number, field: string): MergedCellRange | undefined {
    const cols = this.displayedLeafFields();
    const clickedCol = cols.indexOf(field);
    return this.mergedCellRanges.find(r => {
      if (r.colSpan > 1 && r.rowSpan === 1) {
        if (r.rowIndex !== rowIndex) return false;
        const anchorCol = cols.indexOf(r.field);
        return anchorCol !== -1 && clickedCol >= anchorCol && clickedCol < anchorCol + r.colSpan;
      }
      if (r.rowSpan > 1 && r.colSpan === 1) {
        return r.field === field && rowIndex >= r.rowIndex && rowIndex < r.rowIndex + r.rowSpan;
      }
      return r.field === field && r.rowIndex === rowIndex;
    });
  }

  /** Opens the browser's native color picker for a menu action that isn't covered by the preset palette. */
  @ViewChild('customColorInput') private customColorInputRef?: ElementRef<HTMLInputElement>;
  private pendingColorApply: ((color: string) => void) | null = null;

  private openCustomColorPicker(apply: (color: string) => void, current: string | undefined): void {
    const el = this.customColorInputRef?.nativeElement;
    if (!el) return;
    this.pendingColorApply = apply;
    el.value = current && /^#([0-9a-f]{3}){1,2}$/i.test(current) ? current : '#ffffff';
    el.click();
  }

  onCustomColorChosen(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pendingColorApply?.(value);
    this.pendingColorApply = null;
    this.refreshGridStyles();
  }

  startEditTitle(): void {
    this.editingTitle = true;
  }

  stopEditTitle(): void {
    this.editingTitle = false;
    if (!this.reportName.trim()) this.reportName = 'Report Name';
  }

  toggleCategoryDropdown(): void {
    this.showCategoryDropdown = !this.showCategoryDropdown;
  }

  selectCategory(category: string): void {
    this.category = category;
    const cat = this.apiCategories.find(c => c.categoryName === category);
    if (cat) this.selectedCategoryId = cat.categoryId;
    this.showCategoryDropdown = false;
  }

  toggleDataModelDropdown(): void {
    this.showDataModelDropdown = !this.showDataModelDropdown;
    if (this.showDataModelDropdown) this.dataSourceSearch = '';
  }

  selectDataModel(model: DataModelOption): void {
    this.showDataModelDropdown = false;
    this.dataSourceSearch = '';
    if (this.dataSourceMode === 'table' && this.selectedDataModelId.toLowerCase() === model.id.toLowerCase()) return;
    this.dataSourceMode = 'table';
    this.selectedDataModelId = model.id;
    this.onSourceChanged();
    this.autoSizeOnNextRender = true;
    this.loadTablePreview();
  }

  switchDataSourceMode(mode: 'table' | 'view'): void {
    if (this.dataSourceMode === mode) return;
    this.dataSourceMode = mode;
    this.showDataModelDropdown = false;
    this.viewSearch = '';
    if (mode === 'view' && !this.availableViews.length) {
      this.loadDatabaseViews();
    }
    this.selectedDataModelId = '';
    this.onSourceChanged();
  }

  private loadDatabaseViews(): void {
    this.commonApi.getDatabaseViews('view').subscribe({
      next: (views) => {
        this.availableViews = views;
        this.cdr.markForCheck();
      },
      error: () => console.error('Failed to load database views'),
    });
  }

  selectView(view: DatabaseViewListItem): void {
    this.showDataModelDropdown = false;
    this.viewSearch = '';
    if (this.dataSourceMode === 'view' && this.selectedDataModelId === view.viewName) return;
    this.dataSourceMode = 'view';
    this.selectedDataModelId = view.viewName;
    this.onSourceChanged();
    this.isLoadingPreview = true;
    this.autoSizeOnNextRender = true;
    // Paint the loader now — no zone.js, so the async gap won't repaint on its own.
    this.cdr.detectChanges();
    // Bypass cached snapshot — always load latest, full data live.
    this.runLiveViewPreview(view);
  }

  private onSourceChanged(): void {
    this.resetSourceDependentState();
    this.rebuildPreviewGrid();
    this.resetHistory();
    this.notify.showSuccess('Source changed. Previous column selections and operations were cleared.');
  }

  /** Reset source-bound setup and cell edits, keeping report metadata and overall appearance. */
  private resetSourceDependentState(): void {
    this.sourcePreviewSubscription?.unsubscribe();
    this.isLoadingPreview = false;
    this.tablePreviewData = null;
    this.previewRows = [];
    this.transformedColumns = null;
    this.gridColumnDefs = [];
    this.gridPinnedBottomRowData = [];
    this.selectedRawFields = [];
    this.columnFields = [];
    this.columnConfigs = {};
    this.rawFieldSearch = '';
    this.columnFieldSearch = '';
    this.rowGroupFieldSearch = '';
    this.rowGroupFields = [];
    this.rowGroupAggs = {};
    this.rowGroupColors = {};
    this.showTotals = false;
    this.subtotalAfterGroup = false;
    this.grandTotalAtBottom = false;
    this.selectedReportType = null;
    this.metric = 'Count (F)';
    this.sortBy = 'Name A-Z';
    this.limitCategory = 'all';
    this.calculatedFields = [];
    this.nextCalculatedIndex = 1;
    this.showCalcModal = false;
    this.calcName = '';
    this.calcColumnA = '';
    this.calcColumnB = '';
    this.conditionalFilters = [];
    this.nextConditionalFilterId = 1;
    this.conditionalRules = [];
    this.legendItems = [];
    this.showConditionalModal = false;
    this.cfFields = [];
    this.cfValue = '';
    this.cfValue2 = '';
    this.parameterFilters = [];
    this.nextParamFilterId = 1;
    this.paramColSearch = {};
    this.filterFieldSearch = '';
    this.closeAllDropdowns();
    this.daxModel = createDefaultDaxModel();
    this.daxMeasureDraft = { ...this.daxModel.measures[0] };
    this.nextDaxMeasureIndex = 2;
    this.resetDaxOperationPickerState();
    this.daxExpressionError = '';
    this.daxMeasureFormError = '';
    this.daxDuplicateError = '';
    this.daxNameError = '';
    this.daxColumnError = '';
    this.daxMeasureApplied = false;
    if (this.daxMeasureAppliedTimer) clearTimeout(this.daxMeasureAppliedTimer);
    this.daxMeasureAppliedTimer = null;
    this.daxSavedModelSelectedIds = new Set();
    this.daxSavedModelsSearch = '';
    this.pinnedColumns = [];
    this.dataBarColumns = [];
    this.mergedCellRanges = [];
    this.rowLayout = [];
    this.manualRows = {};
    this.cellOverrides = {};
    this.deletedRowIndices = [];
    this.cellEmbeds = {};
    this.headerCellColors = {};
    this.headerCellTextColors = {};
    this.rowColors = {};
    this.rowColorsByKey = {};
    this.summaryRowColors = {};
    this.summaryRowTextColors = {};
    this.rowTextColors = {};
    this.rowTextColorsByKey = {};
    this.pageRowColors = {};
    this.cellColors = {};
    this.cellTextColors = {};
    this.cellOrientations = {};
    this.headerCellOrientations = {};
    this.cellAlignments = {};
    this.headerCellAlignments = {};
    this.cellBorders = {};
    this.headerCellBorders = {};
    this.subGroupColors = {};
    this.groupColors = {};
    this.groupTextColors = {};
    this.subGroupTextColors = {};
    this.groupHeaderAlignments = {};
    this.subGroupHeaderAlignments = {};
    this.selectionRange = null;
    this.selectionAnchor = null;
    this.selectedColumnFields = [];
    this.headerSelectionAnchor = null;
    this.pendingColorApply = null;
  }

  private runLiveViewPreview(view: DatabaseViewListItem): void {
    this.sourcePreviewSubscription?.unsubscribe();
    this.subs.push(this.sourcePreviewSubscription = previewReportView(
      this.commonApi, view.id, { ...this.filterValues }, this.fromDate, this.toDate, this.advancedFilters ?? [],
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res?.columns?.length) {
          this.applyViewPreview(res.columns, res.rows ?? []);
          return;
        }
        this.isLoadingPreview = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingPreview = false;
        this.notify.showError('Failed to load preview for this view.');
        this.cdr.detectChanges();
      },
    }));
  }

  private applyViewPreview(columns: string[], rows: Record<string, unknown>[]): void {
    this.isLoadingPreview = false;
    this.tablePreviewData = { columns, rows };
    this.columnFields = [...columns];
    this.selectedRawFields = [...columns];
    this.columnConfigs = {};
    for (const field of this.columnFields) {
      this.columnConfigs[field] = { shown: true, group: '', subGroup: '', total: '', color: '' };
    }
    this.rebuildPreviewGrid();
    // Synchronous CD — this app has no zone.js, so a scheduled markForCheck won't render until the next event.
    this.cdr.detectChanges();
    // Zoneless: a re-created grid (new sheet) needs a follow-up pass to actually paint.
    this.deferRender();
    this.resetHistory();
    // Best-effort template lookup — runs last so a failure here can never block the grid render.
    // this.maybeOfferTemplate();//commenting for future 
  }

  selectReportType(type: ReportTypeId): void {
    this.selectedReportType = this.selectedReportType === type ? null : type;
  }

  setSetupTab(tab: SetupTab): void {
    this.setupTab = tab;
  }

  toggleReportDetails(): void {
    this.reportDetailsExpanded = !this.reportDetailsExpanded;
  }

  toggleRawSection(): void {
    this.rawSectionExpanded = !this.rawSectionExpanded;
  }

  get allRawFieldsSelected(): boolean {
    return this.rawFields.length > 0 && this.rawFields.every(f => this.selectedRawFields.includes(f));
  }

  get someRawFieldsSelected(): boolean {
    return this.selectedRawFields.length > 0 && !this.allRawFieldsSelected;
  }

  toggleAllRawFields(): void {
    const fields = this.allRawFieldsSelected ? [] : [
      ...this.rawFields,
      ...this.selectedRawFields.filter(field => !this.rawFields.includes(field)),
    ];
    this.updateReportColumnSelection(fields);
  }

  isRawFieldSelected(field: string): boolean {
    return this.selectedRawFields.includes(field);
  }

  // Re-selecting a field restores it to its original position in rawFields.
  toggleRawField(field: string): void {
    let fields: string[];
    if (this.isRawFieldSelected(field)) {
      fields = this.selectedRawFields.filter(f => f !== field);
    } else {
      const all = [...this.rawFields, ...this.columnFields.filter(f => !this.rawFields.includes(f))];
      const updated = [...this.selectedRawFields, field];
      fields = all.filter(f => updated.includes(f));
    }
    this.updateReportColumnSelection(fields);
  }

  private updateReportColumnSelection(fields: string[]): void {
    const previous = this.selectedRawFields;
    const removed = previous.filter(field => !fields.includes(field));
    for (const field of fields) {
      if (previous.includes(field)) continue;
      const config = this.columnConfigs[field];
      if (config) config.shown = true;
      else this.columnConfigs[field] = { shown: true, group: '', subGroup: '', total: '', color: '' };
      if (!this.columnFields.includes(field)) this.columnFields.push(field);
    }
    const unavailable = removed.length ? this.clearRemovedColumnDependencies(removed) : new Set<string>();
    this.selectedRawFields = fields.filter(field =>
      this.columnConfigs[field] && !unavailable.has(field));
    // Grid may have been torn down when the last field was unticked; defer a render so a
    // freshly re-created grid repaints (zoneless) instead of freezing on the first column.
    this.rebuildPreviewGrid();
    this.deferRender();
  }
  /**
   * Clears dependencies for columns that have been removed from the report.
   * This includes calculated fields, parameter filters, and DAX measures that reference the removed columns.
   * @param fields The list of fields that have been removed.
   * @returns A set of fields that are no longer available due to the removal.
   */
  private clearRemovedColumnDependencies(fields: string[]): Set<string> {
    const removed = new Set(fields);
    const previousPreviewColumns = this.previewColumns;
    const hasRemoved = (columns: string[]) => columns.some(column =>
      [...removed].some(field => field.toLowerCase() === column.toLowerCase()));
    const measureColumns = (measure: DaxMeasureConfig) => [
      ...getDaxReferencedColumns(measure),
      ...(measure.columns ?? []),
      ...(measure.numeratorColumns ?? []),
      ...(measure.denominatorColumns ?? []),
    ];
    const originalColumns = new Set([
      ...this.selectedRawFields,
      ...(this.transformedColumns ?? []),
      ...this.availableSourceColumns,
    ]);
    const removedCalculated = new Set<string>();
    // Removing a source can also remove a calculated field, rename alias or DAX output
    // used by another rule. Resolve that dependency chain before rebuilding or saving.
    let previousSize: number;
    do {
      previousSize = removed.size;
      this.calculatedFields = this.calculatedFields.filter(field => {
        if (!hasRemoved([field.name, field.columnA, field.columnB])) return true;
        removed.add(field.name);
        removedCalculated.add(field.name);
        return false;
      });
      this.parameterFilters = this.parameterFilters.filter(rule =>
        !hasRemoved([...getRuleSourceColumns(rule), ...(rule.secondaryColumn ? [rule.secondaryColumn] : [])]));
      const selected = this.selectedRawFields.filter(field => !hasRemoved([field]));
      const rows = (this.tablePreviewData?.rows ?? []).map(row => {
        const result = { ...row };
        for (const field of this.calculatedFields) result[field.name] = this.computeCalcRawValue(row, field);
        return result;
      });
      const remainingColumns = new Set([
        ...selected,
        ...getTransformationSourceColumns(selected, this.applicableParameterFilters),
        ...applyParameterFilters(rows, this.applicableParameterFilters, selected).columns,
      ]);
      for (const column of originalColumns) {
        if (!remainingColumns.has(column)) removed.add(column);
      }
      this.daxModel = {
        ...this.daxModel,
        calculatedColumns: this.daxModel.calculatedColumns?.filter(column => {
          if (!hasRemoved(getDaxReferencedColumns(column))) return true;
          removed.add(column.name);
          return false;
        }),
        measures: this.daxModel.measures.filter(measure => {
          if (!hasRemoved(measureColumns(measure))) return true;
          if (measure.evaluationScope === 'row' && measure.name.trim()) removed.add(measure.name.trim());
          return false;
        }),
      };
    } while (removed.size !== previousSize);

    this.selectedRawFields = this.selectedRawFields.filter(field => !hasRemoved([field]));
    this.columnFields = this.columnFields.filter(field => !removedCalculated.has(field));
    for (const field of removedCalculated) delete this.columnConfigs[field];
    for (const field of removed) {
      const config = this.columnConfigs[field];
      if (config) Object.assign(config, { group: '', subGroup: '', total: '' });
      delete this.rowGroupAggs[field];
      delete this.rowGroupColors[field];
    }
    this.rowGroupFields = this.rowGroupFields.filter(field => !hasRemoved([field]));
    this.pinnedColumns = this.pinnedColumns.filter(field => !hasRemoved([field]));
    this.dataBarColumns = this.dataBarColumns.filter(field => !hasRemoved([field]));
    this.conditionalFilters = this.conditionalFilters.filter(filter => !hasRemoved([filter.sourceColumn]));
    this.conditionalRules = this.conditionalRules.filter(rule => !hasRemoved([rule.field]));
    this.mergedCellRanges = this.mergedCellRanges.filter(range => {
      const index = previousPreviewColumns.indexOf(range.field);
      return !hasRemoved([range.field])
        && (index < 0 || !hasRemoved(previousPreviewColumns.slice(index, index + range.colSpan)));
    });
    this.selectionRange = null;
    this.closeAllDropdowns();
    if (hasRemoved([this.calcColumnA, this.calcColumnB])) {
      this.calcColumnA = '';
      this.calcColumnB = '';
      this.showCalcModal = false;
    }
    this.cfFields = this.cfFields.filter(field => !hasRemoved([field]));
    if (!this.cfFields.length) this.showConditionalModal = false;
    if (hasRemoved(measureColumns(this.daxMeasureDraft))
      || hasRemoved(this.selectedDaxColumns)
      || (this.daxModel.selectedMeasureId
        && !this.daxModel.measures.some(measure => measure.id === this.daxModel.selectedMeasureId))) {
      const measure = this.selectedDaxMeasure ?? this.daxModel.measures[0];
      this.daxMeasureDraft = { ...(measure ?? this.createDefaultDaxMeasure()) };
      this.resetDaxOperationPickerState();
      this.daxModel = {
        ...this.daxModel,
        selectedMeasureId: measure?.id,
        selectedColumns: [],
        selectedOperation: '',
      };
      this.daxExpressionError = '';
      this.daxMeasureFormError = '';
      this.daxDuplicateError = '';
      this.daxNameError = '';
      this.daxColumnError = '';
    } else {
      this.daxModel = {
        ...this.daxModel,
        selectedColumns: (this.daxModel.selectedColumns ?? []).filter(field => !hasRemoved([field])),
      };
    }
    this.notify.showSuccess('Column selection updated. Dependent grouping, filters, transformations and calculations were cleared.');
    return removed;
  }

  pinColumnToLeft(column: string): void {
    if (this.pinnedColumns.includes(column)) {
      this.pinnedColumns = this.pinnedColumns.filter(c => c !== column);
    } else {
      this.pinnedColumns.push(column);
    }
    this.rebuildPreviewGrid();
  }

  toggleDataBars(column: string): void {
    this.dataBarColumns = this.dataBarColumns.includes(column)
      ? this.dataBarColumns.filter(c => c !== column)
      : [...this.dataBarColumns, column];
    this.rebuildPreviewGrid();
  }

  private reportDrillRecords(node: IRowNode): Record<string, unknown>[] {
    const leaves = node.group ? node.allLeafChildren ?? [] : [node];
    const records: Record<string, unknown>[] = [];
    for (const leaf of leaves) {
      const data = leaf.data as Record<string, unknown> | undefined;
      if (data && !data[MANUAL_ROW_FLAG] && data[TOTALS_LABEL_FIELD] == null) records.push(data);
    }
    return records;
  }

  /** Opens the source records behind a cell (or, on a group row, behind every row in the group). */
  openReportDrill(node: IRowNode): void {
    const records = this.reportDrillRecords(node);
    if (!records.length) return;
    // Renamed rows also carry a hidden copy under the original name (for DAX); list only the renamed column.
    const renames = this.currentColumnRenames();
    const keys = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        const renamedTo = renames.get(key);
        if (!key.startsWith('__') && !(renamedTo && renamedTo in record)) keys.add(key);
      }
    }
    const columns: ColDef[] = [...keys].map((key, index) => ({
      colId: `drill-${index}`,
      headerName: key,
      headerTooltip: key,
      valueGetter: params => params.data?.[key],
    }));
    const target = node.group ? `${node.rowGroupColumn?.getColDef().headerName ?? 'Group'}: ${node.key ?? ''} \u00b7 ` : '';
    this.reportDrill = { subtitle: `${target}${records.length} ${records.length === 1 ? 'record' : 'records'}`, columns, rows: records };
    this.cdr.markForCheck();
  }

  closeReportDrill(): void {
    this.reportDrill = null;
    this.cdr.markForCheck();
  }

  setColumnColor(column: string, color: string): void {
    const cfg = this.columnConfigs[this.columnSourceField(column)];
    if (cfg) {
      cfg.color = color;
    }
    this.refreshGridStyles();
  }

  setRowColor(rowIndex: number, color: string): void {
    const groupKey = getReportGroupRowColorKey(this.liveGridApi?.getDisplayedRowAtIndex(rowIndex));
    if (groupKey) {
      this.setGroupRowColor(groupKey, color, false);
      return;
    }
    const key = this.getRowColorKeyAt(rowIndex);
    if (key) {
      clearReportCellSettingsForRecord(this.cellColors, rowIndex, key);
      delete this.rowColors[rowIndex];
      if (color) this.rowColorsByKey[key] = color;
      else delete this.rowColorsByKey[key];
    } else {
      clearReportCellSettingsForRecord(this.cellColors, rowIndex);
      if (color) this.rowColors[rowIndex] = color;
      else delete this.rowColors[rowIndex];
    }
    this.refreshGridStyles();
  }

  private getRowColorKeyAt(rowIndex: number): string | undefined {
    const groupKey = getReportGroupRowColorKey(this.liveGridApi?.getDisplayedRowAtIndex(rowIndex));
    if (groupKey) return groupKey;
    const row = this.getGridRowDataAt(rowIndex);
    const key = row?.[ROW_COLOR_KEY];
    return typeof key === 'string' ? key : undefined;
  }

  private getRowColor(rowIndex: number): string | undefined {
    const key = this.getRowColorKeyAt(rowIndex);
    if (key?.startsWith('group:')) return this.rowColorsByKey[key];
    return (key ? this.rowColorsByKey[key] : undefined) ?? this.rowColors[rowIndex];
  }

  private getRowTextColor(rowIndex: number): string | undefined {
    const key = this.getRowColorKeyAt(rowIndex);
    if (key?.startsWith('group:')) return this.rowTextColorsByKey[key];
    return (key ? this.rowTextColorsByKey[key] : undefined) ?? this.rowTextColors[rowIndex];
  }

  setHeaderCellColor(column: string, color: string): void {
    if (color) this.headerCellColors[column] = color;
    else delete this.headerCellColors[column];
    this.refreshGridStyles();
  }

  cellKey(row: number, col: string): string {
    return `${row}:${col}`;
  }

  private getGridRowDataAt(rowIndex: number): Record<string, unknown> | undefined {
    const api = this.liveGridApi;
    return (api
      ? api.getDisplayedRowAtIndex(rowIndex)?.data
      : this.previewRows[rowIndex]) as Record<string, unknown> | undefined;
  }

  private cellSettingKeyAt(rowIndex: number, field: string): string {
    const rowColorKey = this.getRowColorKeyAt(rowIndex);
    return rowColorKey ? reportCellSettingKey(rowColorKey, field) : this.cellKey(rowIndex, field);
  }

  private getCellSetting<T>(settings: Record<string, T>, rowIndex: number, field: string): T | undefined {
    return getReportCellSetting(settings, this.getGridRowDataAt(rowIndex), rowIndex, field);
  }

  setCellColor(row: number, col: string, color: string): void {
    const key = this.cellSettingKeyAt(row, col);
    if (color) this.cellColors[key] = color;
    else delete this.cellColors[key];
    this.refreshGridStyles();
  }

  // ─── Excel-like insert/delete rows & columns ────────────────────────────────

  private uid(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID?.() ?? `m${Date.now()}${Math.random().toString(36).slice(2)}`;
  }

  /** Inserts a blank, editable row above the given display row index. */
  insertRowAbove(displayIndex: number): void {
    const insId = this.uid();
    this.manualRows[insId] = {};
    const at = Math.max(0, Math.min(displayIndex, this.rowLayout.length));
    this.rowLayout.splice(at, 0, { insId });
    this.selectionRange = null;
    this.rebuildPreviewGrid();
  }

  /** Deletes the given display rows (source rows are remembered so grown data won't resurrect them). */
  deleteRows(displayIndices: number[]): void {
    const desc = [...new Set(displayIndices)].sort((a, b) => b - a);
    for (const d of desc) {
      const ref = this.rowLayout[d];
      if (!ref) continue;
      if ('insId' in ref) {
        delete this.manualRows[ref.insId];
      } else {
        this.deletedRowIndices.push(ref.src);
        this.purgeSourceOverrides(ref.src);
      }
      this.rowLayout.splice(d, 1);
    }
    this.selectionRange = null;
    this.rebuildPreviewGrid();
  }

  private purgeSourceOverrides(src: number): void {
    const prefix = `${src}:`;
    for (const k of Object.keys(this.cellOverrides)) {
      if (k.startsWith(prefix)) delete this.cellOverrides[k];
    }
  }

  private uniqueColumnName(): string {
    const existing = new Set([...this.selectedRawFields, ...Object.keys(this.columnConfigs)]);
    let n = 1;
    while (existing.has(`Column ${n}`)) n++;
    return `Column ${n}`;
  }

  /** Inserts a new blank, editable column to the left of the given field. */
  insertColumnLeft(field: string): void {
    const newField = this.uniqueColumnName();
    // The row-number (#) column has no data field, so a click there yields -1 — treat that as "before the first column" rather than falling back to the far right.
    const rawPos = this.selectedRawFields.indexOf(field);
    const at = rawPos < 0 ? 0 : rawPos;
    this.selectedRawFields.splice(at, 0, newField);
    const colPos = this.columnFields.indexOf(field);
    this.columnFields.splice(colPos < 0 ? at : colPos, 0, newField);
    this.columnConfigs[newField] = { shown: true, group: '', subGroup: '', total: '', color: '', custom: true };
    this.rebuildPreviewGrid();
  }

  /** Removes the given columns entirely, along with any styling/merges/values tied to them. */
  deleteColumns(fields: string[]): void {
    const drop = this.clearRemovedColumnDependencies(fields);
    this.selectedRawFields = this.selectedRawFields.filter(f => !drop.has(f));
    this.columnFields = this.columnFields.filter(f => !drop.has(f));
    this.pinnedColumns = this.pinnedColumns.filter(f => !drop.has(f));
    this.dataBarColumns = this.dataBarColumns.filter(f => !drop.has(f));
    this.mergedCellRanges = this.mergedCellRanges.filter(r => !drop.has(r.field));
    for (const f of drop) {
      delete this.columnConfigs[f];
      delete this.headerCellColors[f];
      for (const map of [this.cellColors, this.cellTextColors, this.cellOrientations, this.cellAlignments, this.cellEmbeds, this.cellBorders]) {
        for (const k of Object.keys(map)) if (isReportCellSettingForField(k, f)) delete map[k];
      }
      for (const k of Object.keys(this.cellOverrides)) if (k.endsWith(`:${f}`)) delete this.cellOverrides[k];
      for (const id of Object.keys(this.manualRows)) delete this.manualRows[id][f];
    }
    this.selectionRange = null;
    this.rebuildPreviewGrid();
  }

  /** Persists an edit to a blank/custom cell back into manualRows (inserted rows) or cellOverrides (source rows). */
  onCellValueChanged(event: CellValueChangedEvent): void {
    const field = event.colDef.field;
    if (!field) return;
    const data = event.data as Record<string, unknown>;
    if (data[MANUAL_ROW_FLAG] === true) {
      const id = data[MANUAL_ROW_ID] as string;
      (this.manualRows[id] ??= {})[field] = event.newValue;
    } else if (data[SOURCE_ROW_INDEX] != null) {
      this.cellOverrides[`${data[SOURCE_ROW_INDEX]}:${field}`] = event.newValue;
    }
    // An edit can create/remove duplicates in other rows of this column, so repaint them.
    const affectsDuplicates = this.conditionalRules.some(r =>
      r.operator === 'duplicate' && r.enabled !== false && (r.field === field || r.scope === 'report'));
    if (affectsDuplicates) event.api.refreshCells({ force: true });
  }

  //"Split Cells" — embed a sub-grid of blank editable cells

  openEmbedDialog(sel: { rows: number[]; fields: string[] }): void {
    this.embedTargets = {
      rows: sel.rows.map(rowIndex => ({
        rowIndex,
        rowColorKey: this.getRowColorKeyAt(rowIndex),
      })),
      fields: [...sel.fields],
    };
    this.embedSpan = 'horizontal';
    this.embedCount = 2;
    this.showEmbedDialog = true;
    this.cdr.markForCheck();
  }

  cancelEmbed(): void {
    this.showEmbedDialog = false;
    this.embedTargets = null;
  }

  /** Applies the chosen span/count to every targeted cell: horizontal → sub-columns, vertical → sub-rows. */
  applyEmbed(): void {
    const target = this.embedTargets;
    if (!target) { this.showEmbedDialog = false; return; }
    const count = Math.max(1, Math.min(20, Math.floor(this.embedCount) || 1));
    for (const row of target.rows) {
      for (const f of target.fields) {
        const key = row.rowColorKey
          ? reportCellSettingKey(row.rowColorKey, f)
          : this.cellKey(row.rowIndex, f);
        const embed = this.cellEmbeds[key] ?? { rows: 1, cols: 1 };
        if (this.embedSpan === 'horizontal') embed.cols = count;
        else embed.rows = count;
        this.cellEmbeds[key] = embed;
      }
    }
    this.showEmbedDialog = false;
    this.embedTargets = null;
    this.rebuildPreviewGrid();
  }

  /** Persists a sub-cell edit without a full rebuild (avoids losing input focus). */
  onEmbedValueChange(key: string, subRow: number, subCol: number, value: string): void {
    const embed = this.cellEmbeds[key];
    if (!embed) return;
    (embed.values ??= {})[`${subRow}:${subCol}`] = value;
  }

  //Text orientation (horizontal / vertical bottom-to-top) 

  private orientationMenuItems(apply: (o: TextOrientation) => void, current: TextOrientation | undefined): MenuItemDef[] {
    const item = (o: TextOrientation, name: string): MenuItemDef => ({
      name,
      checked: (current ?? 'horizontal') === o,
      action: () => apply(o),
    });
    return [item('horizontal', 'Horizontal'), item('vertical', 'Vertical')];
  }

  setCellOrientation(row: number, col: string, orientation: TextOrientation): void {
    const key = this.cellSettingKeyAt(row, col);
    if (orientation === 'vertical') this.cellOrientations[key] = 'vertical';
    else delete this.cellOrientations[key];
    // The cell class/renderer are baked into columnDefs, so a rebuild is needed; resetRowHeights
    // then re-runs getRowHeight so the row grows/shrinks for the vertical cell's wrapped text.
    this.rebuildPreviewGrid();
    for (const api of [this.liveGridApi, this.liveExpandGridApi]) api?.resetRowHeights();
  }

  setHeaderCellOrientation(column: string, orientation: TextOrientation): void {
    if (orientation === 'vertical') this.headerCellOrientations[column] = 'vertical';
    else delete this.headerCellOrientations[column];
    // Give vertical headers a taller row by default so the rotated/wrapped text is fully visible.
    // Only bumps up a too-short row; the Header Height stepper can freely adjust it afterward.
    if (orientation === 'vertical' && this.gridHeaderHeight < this.VERTICAL_HEADER_MIN_HEIGHT) {
      this.gridHeaderHeight = this.VERTICAL_HEADER_MIN_HEIGHT;
    }
    // headerClass is baked into columnDefs at build time, so a rebuild is needed to reflect it.
    this.rebuildPreviewGrid();
  }

  // ─── Text alignment (left/center/right) — cells and headers ─────────────────
  private alignmentMenuItems(apply: (a: TextAlign) => void, current: TextAlign | undefined): MenuItemDef[] {
    const item = (a: TextAlign, name: string): MenuItemDef => ({
      name,
      checked: (current ?? 'center') === a,
      action: () => { apply(a); this.refreshGridStyles(); },
    });
    return [item('left', 'Left'), item('center', 'Center'), item('right', 'Right')];
  }

  setCellAlignment(row: number, col: string, align: TextAlign): void {
    const key = this.cellSettingKeyAt(row, col);
    this.cellAlignments[key] = align;
    this.refreshGridStyles();
  }

  setHeaderCellAlignment(column: string, align: TextAlign): void {
    this.headerCellAlignments[column] = align;
    // headerClass is baked into columnDefs at build time, so a rebuild is needed to reflect it.
    this.rebuildPreviewGrid();
  }

  /** Alignment shared by the whole current selection, or undefined when it's mixed/none (drives the toolbar's active state). */
  get selectionAlignment(): TextAlign | undefined {
    const sel = this.selectionRange;
    if (!sel) return undefined;
    // Header-only (single-click column) selection: reflect the header's alignment.
    if (!sel.rows.length) {
      let headerCommon: TextAlign | undefined;
      for (const f of sel.fields) {
        const a = this.headerCellAlignments[f] ?? this.reportAlignment;
        if (a == null) return undefined;
        if (headerCommon == null) headerCommon = a;
        else if (headerCommon !== a) return undefined;
      }
      return headerCommon;
    }
    let common: TextAlign | undefined;
    for (const r of sel.rows) {
      for (const f of sel.fields) {
        const a = this.getCellSetting(this.cellAlignments, r, f);
        if (a == null) return undefined;
        if (common == null) common = a;
        else if (common !== a) return undefined;
      }
    }
    return common;
  }

  /** Alignment the toolbar highlights: the selection's when something is selected, otherwise the report-wide one. */
  get activeAlignment(): TextAlign | undefined {
    if (this.selectedGroupHeader) return resolveGroupHeaderAlign(this, this.selectedGroupHeader);
    return this.selectionRange ? this.selectionAlignment : this.reportAlignment;
  }

  /** Toolbar action: aligns the selected group header, cells (or a header-only selection's headers), or the whole report when nothing is selected. */
  applyTextAlign(align: TextAlign): void {
    const sel = this.selectionRange;
    const group = this.selectedGroupHeader;
    if (group) {
      // Selected column group / sub-group header → align just that header (keyed by its name).
      const target = group.level === 'group' ? this.groupHeaderAlignments : this.subGroupHeaderAlignments;
      target[group.name] = align;
    } else if (!sel) {
      // No selection → align the entire report (all cells and headers), clearing any per-cell/header overrides.
      this.reportAlignment = align;
      this.cellAlignments = {};
      this.headerCellAlignments = {};
      this.groupHeaderAlignments = {};
      this.subGroupHeaderAlignments = {};
    } else if (!sel.rows.length) {
      // Header-only column selection → align just the header(s).
      for (const f of sel.fields) this.headerCellAlignments[f] = align;
    } else {
      // Body/cell selection → align only the selected cells; leave the column headers untouched.
      for (const r of sel.rows) for (const f of sel.fields) this.cellAlignments[this.cellSettingKeyAt(r, f)] = align;
    }
    // Header alignment lives in columnDefs (headerClass), so rebuild; cells repaint with it.
    this.rebuildPreviewGrid();
    this.refreshGridStyles();
  }

  /** Report-wide placement + per-cell/header side-sets accumulate, so clicking placements builds up borders. */
  private effectiveCellSides(row: number, field: string): CellBorder {
    const key = this.cellKey(row, field);
    if (key in this.cellBorders) return this.cellBorders[key] ?? {};
    if (this.reportBorder) {
      const fields = this.previewColumns;
      return borderSidesFor(this.reportBorder, {
        firstRow: row === 0,
        lastRow: row === this.previewRows.length - 1,
        firstCol: field === fields[0],
        lastCol: field === fields[fields.length - 1],
      });
    }
    return {};
  }

  private effectiveHeaderSides(field: string): CellBorder {
    if (field in this.headerCellBorders) return this.headerCellBorders[field] ?? {};
    if (this.reportBorder) {
      const fields = this.previewColumns;
      return borderSidesFor(this.reportBorder, { firstRow: true, lastRow: true, firstCol: field === fields[0], lastCol: field === fields[fields.length - 1] });
    }
    return {};
  }

  /** Whether the toolbar border button shows as active (any border on the selection, else the report). */
  get activeBorder(): boolean {
    const sel = this.selectionRange;
    if (!sel) return !!this.reportBorder;
    if (!sel.rows.length) return sel.fields.some(f => hasAnyBorderSide(this.effectiveHeaderSides(f)));
    return sel.rows.some(r => sel.fields.some(f => hasAnyBorderSide(this.effectiveCellSides(r, f))));
  }

  /**
   * Applies a Google-Sheets-style border placement (or clears it with null) to the selected cells /
   * header(s) / column(s), or the whole report when nothing is selected. Placements accumulate; the
   * per-cell edge ownership (see borderSidesFor) keeps shared edges to a single clean line.
   */
  applyBorder(type: BorderType | null): void {
    this.showBorderMenu = false;
    const sel = this.selectionRange;
    if (!sel) {
      // No selection → border the whole report, clearing any per-cell/header overrides.
      this.reportBorder = type ?? undefined;
      this.cellBorders = {};
      this.headerCellBorders = {};
    } else if (!sel.rows.length) {
      // Header-only column selection → border just the header(s).
      this.applyBorderToHeaders(sel.fields, type);
    } else {
      // Body/cell selection → border the selected cells / column body.
      this.applyBorderToCells(sel.rows, sel.fields, type);
    }
    this.refreshGridStyles();
  }

  private applyBorderToCells(rows: number[], fields: string[], type: BorderType | null): void {
    const sortedRows = [...rows].sort((a, b) => a - b);
    const order = this.previewColumns;
    const sortedFields = [...fields].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const minRow = sortedRows[0];
    const maxRow = sortedRows[sortedRows.length - 1];
    const firstField = sortedFields[0];
    const lastField = sortedFields[sortedFields.length - 1];
    for (const r of sortedRows) {
      for (const f of sortedFields) {
        const key = this.cellKey(r, f);
        if (type === null) {
          // Clear: an explicit empty set overrides a report-wide border; otherwise drop the entry.
          if (this.reportBorder) this.cellBorders[key] = {};
          else delete this.cellBorders[key];
          continue;
        }
        const add = borderSidesFor(type, { firstRow: r === minRow, lastRow: r === maxRow, firstCol: f === firstField, lastCol: f === lastField });
        this.cellBorders[key] = unionCellBorder(this.effectiveCellSides(r, f), add);
      }
    }
  }

  private applyBorderToHeaders(fields: string[], type: BorderType | null): void {
    const order = this.previewColumns;
    const sortedFields = [...fields].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const firstField = sortedFields[0];
    const lastField = sortedFields[sortedFields.length - 1];
    for (const f of sortedFields) {
      if (type === null) {
        if (this.reportBorder) this.headerCellBorders[f] = {};
        else delete this.headerCellBorders[f];
        continue;
      }
      const add = borderSidesFor(type, { firstRow: true, lastRow: true, firstCol: f === firstField, lastCol: f === lastField });
      this.headerCellBorders[f] = unionCellBorder(this.effectiveHeaderSides(f), add);
    }
  }

  /** Migrates legacy border config ('dark'/'light' = full box) to the per-side model after load. */
  private migrateBorders(): void {
    const migMap = (m: Record<string, CellBorder>) => {
      for (const k of Object.keys(m)) {
        if (typeof (m[k] as unknown) === 'string') m[k] = { top: true, right: true, bottom: true, left: true };
      }
    };
    migMap(this.cellBorders);
    migMap(this.headerCellBorders);
    if ((this.reportBorder as unknown) === 'dark' || (this.reportBorder as unknown) === 'light') this.reportBorder = 'all';
  }

  /** Renders any cell that has an embed config as a sub-grid; other cells keep their default/base renderer. */
  private decorateEmbeddedCells(defs: (ColDef | ColGroupDef)[]): (ColDef | ColGroupDef)[] {
    if (!Object.keys(this.cellEmbeds).length) return defs;
    const decorate = (def: ColDef | ColGroupDef): ColDef | ColGroupDef => {
      if ('children' in def && def.children) {
        return { ...def, children: def.children.map(decorate) } as ColGroupDef;
      }
      const col = def as ColDef;
      if (!col.field) return col;
      const field = col.field;
      const baseRenderer = col.cellRenderer;
      return {
        ...col,
        autoHeight: true,
        cellRendererSelector: (params: ICellRendererParams) => {
          const rowColorKey = params.data?.[ROW_COLOR_KEY];
          const stableKey = typeof rowColorKey === 'string'
            ? reportCellSettingKey(rowColorKey, field)
            : `${params.node?.rowIndex}:${field}`;
          const legacyKey = `${params.node?.rowIndex}:${field}`;
          const key = this.cellEmbeds[stableKey] ? stableKey : legacyKey;
          const embed = this.cellEmbeds[key];
          if (embed) {
            return {
              component: EmbeddedCellComponent,
              params: {
                rows: embed.rows,
                cols: embed.cols,
                values: (embed.values ??= {}),
                editable: true,
                onChange: (r: number, c: number, v: string) => this.onEmbedValueChange(key, r, c, v),
              },
            };
          }
          return baseRenderer ? { component: baseRenderer } : undefined;
        },
      };
    };
    return defs.map(decorate);
  }

  setColumnTextColor(column: string, color: string): void {
    const cfg = this.columnConfigs[this.columnSourceField(column)];
    if (cfg) {
      cfg.textColor = color;
    }
    this.refreshGridStyles();
  }

  setRowTextColor(rowIndex: number, color: string): void {
    const groupKey = getReportGroupRowColorKey(this.liveGridApi?.getDisplayedRowAtIndex(rowIndex));
    if (groupKey) {
      this.setGroupRowColor(groupKey, color, true);
      return;
    }
    const rowColorKey = this.getRowColorKeyAt(rowIndex);
    if (rowColorKey) {
      clearReportCellSettingsForRecord(this.cellTextColors, rowIndex, rowColorKey);
      delete this.rowTextColors[rowIndex];
      if (color) this.rowTextColorsByKey[rowColorKey] = color;
      else delete this.rowTextColorsByKey[rowColorKey];
    } else {
      clearReportCellSettingsForRecord(this.cellTextColors, rowIndex);
      if (color) this.rowTextColors[rowIndex] = color;
      else delete this.rowTextColors[rowIndex];
    }
    this.refreshGridStyles();
  }

  private setGroupRowColor(key: string, color: string, text: boolean): void {
    const colors = text ? this.rowTextColorsByKey : this.rowColorsByKey;
    if (color) colors[key] = color;
    else delete colors[key];
    this.refreshGridStyles();
  }

  setHeaderCellTextColor(column: string, color: string): void {
    if (color) this.headerCellTextColors[column] = color;
    else delete this.headerCellTextColors[column];
    this.refreshGridStyles();
  }

  setCellTextColor(row: number, col: string, color: string): void {
    const key = this.cellSettingKeyAt(row, col);
    if (color) this.cellTextColors[key] = color;
    else delete this.cellTextColors[key];
    this.refreshGridStyles();
  }

  toggleColumnSection(): void {
    this.columnSectionExpanded = !this.columnSectionExpanded;
  }

  clearAllGrouping(): void {
    for (const field of Object.keys(this.columnConfigs)) {
      this.columnConfigs[field].group = '';
      this.columnConfigs[field].subGroup = '';
      this.columnConfigs[field].total = '';
    }
    this.rebuildPreviewGrid();
  }

  toggleTotalSection(): void {
    this.totalSectionExpanded = !this.totalSectionExpanded;
  }

  toggleRowGroupSection(): void {
    this.rowGroupSectionExpanded = !this.rowGroupSectionExpanded;
  }

  // ---------------------------------------------------------------------------
  // Conditional Filters — row-level data filters that scope the report's rows.
  // Source Table is fixed to the report's source; Source Column picks a column;
  // the condition + Include/Exclude mode decide which rows are kept. The "Show"
  // (eye) toggle enables/disables a filter in both the preview and the viewer.
  // ---------------------------------------------------------------------------

  toggleConditionalFiltersSection(): void {
    this.conditionalFiltersSectionExpanded = !this.conditionalFiltersSectionExpanded;
  }

  /** Selected report columns, including calculated fields and enabled rename aliases. */
  get conditionalFilterColumns(): string[] {
    return this.availableSourceColumns;
  }

  addConditionalFilter(): void {
    this.conditionalFilters = [
      ...this.conditionalFilters,
      {
        id: this.nextConditionalFilterId++,
        label: '',
        sourceTable: this.selectedDataModelId,
        sourceColumn: '',
        operator: 'equals',
        valueText: '',
        mode: 'Include',
        hidden: true,
      },
    ];
    this.cdr.markForCheck();
  }

  removeConditionalFilter(id: number): void {
    this.conditionalFilters = this.conditionalFilters.filter(f => f.id !== id);
    this.rebuildPreviewGrid();
  }

  toggleConditionalFilterShow(filter: ReportConditionalFilter): void {
    filter.hidden = !filter.hidden;
    this.rebuildPreviewGrid();
  }

  /** Mode only matters once the filter has a column and a value to match. */
  isConditionalModeEnabled(filter: ReportConditionalFilter): boolean {
    return !!filter.sourceColumn && !!filter.valueText?.trim();
  }

  /** Comparison operators that only make sense on numeric/date columns — hidden for pure text columns. */
  private readonly conditionalNumericOperators = ['greater than'];

  /** Condition operators available for a filter: a pure text column can't use numeric comparisons. */
  conditionalOperatorOptionsFor(filter: ReportConditionalFilter): string[] {
    if (!filter.sourceColumn || this.isComparableField(filter.sourceColumn)) return this.conditionalOperatorOptions;
    return this.conditionalOperatorOptions.filter(op => !this.conditionalNumericOperators.includes(op));
  }

  /** On column change, drop an operator that's no longer valid for the new column type, then re-render. */
  onConditionalFilterColumnChange(filter: ReportConditionalFilter): void {
    const allowed = this.conditionalOperatorOptionsFor(filter);
    if (filter.operator && !allowed.includes(filter.operator)) {
      filter.operator = allowed[0] ?? '';
    }
    this.rebuildPreviewGrid();
  }

  /** A conditional filter with a Source Column but an empty Condition Value is invalid — drives the inline error and blocks save. */
  conditionalFilterMissingValue(filter: ReportConditionalFilter): boolean {
    return !!filter.sourceColumn && !filter.valueText?.trim();
  }

  get hasInvalidConditionalFilters(): boolean {
    return this.conditionalFilters.some(f => this.conditionalFilterMissingValue(f));
  }

  /**
   * Stable, order-independent signature of an object used to detect exact duplicates.
   * String values are trimmed + lower-cased and string arrays are sorted, so two items with the
   * same meaningful configuration (ignoring the listed keys) produce the same signature.
   */
  private duplicateSignature(obj: Record<string, unknown>, ignore: string[]): string {
    const norm = (v: unknown): unknown => {
      if (typeof v === 'string') return v.trim().toLowerCase();
      if (Array.isArray(v)) return v.map(norm).sort();
      return v ?? null;
    };
    return Object.keys(obj)
      .filter(k => !ignore.includes(k))
      .sort()
      .map(k => `${k}=${JSON.stringify(norm(obj[k]))}`)
      .join('|');
  }

  // --- Conditional Filters: no two filters may share Source Column + Condition + Value + Mode. ---
  private conditionalFilterSignature(f: ReportConditionalFilter): string {
    return this.duplicateSignature(f as unknown as Record<string, unknown>, ['id', 'label', 'sourceTable', 'hidden']);
  }

  /** True when an earlier conditional filter has the exact same column/condition/value/mode. */
  isDuplicateConditionalFilter(filter: ReportConditionalFilter): boolean {
    if (!filter.sourceColumn || !filter.valueText?.trim()) return false;
    const sig = this.conditionalFilterSignature(filter);
    const first = this.conditionalFilters.findIndex(f => !!f.sourceColumn && !!f.valueText?.trim() && this.conditionalFilterSignature(f) === sig);
    return first !== -1 && this.conditionalFilters.indexOf(filter) !== first;
  }

  get hasDuplicateConditionalFilters(): boolean {
    return this.conditionalFilters.some(f => this.isDuplicateConditionalFilter(f));
  }

  // --- Data Transformation: flag only identical actions, source columns, and rule parameters. ---
  private parameterFilterSignature(rule: ParameterFilterRule): string {
    const { id: _id, enabled: _enabled, action, sourceColumn: _sourceColumn, sourceColumns: _sourceColumns, ...parameters } = rule;
    return this.duplicateSignature({
      action,
      sourceColumns: [...new Set(getRuleSourceColumns(rule).map(column => column.trim().toLowerCase()))],
      parameters,
    }, []);
  }

  private parameterFilterIsComplete(rule: ParameterFilterRule): boolean {
    return !!rule.action && getRuleSourceColumns(rule).length > 0;
  }

  /** True when another complete rule repeats the action, source columns, and rule parameters.. */
  isDuplicateParameterFilter(rule: ParameterFilterRule, rules: ParameterFilterRule[] = this.parameterFilters): boolean {
    if (!this.parameterFilterIsComplete(rule)) return false;
    const sig = this.parameterFilterSignature(rule);
    const first = rules.findIndex(r => this.parameterFilterIsComplete(r) && this.parameterFilterSignature(r) === sig);
    return first !== -1 && rules.indexOf(rule) !== first;
  }

  get hasDuplicateParameterFilters(): boolean {
    return this.parameterFilters.some(r => this.isDuplicateParameterFilter(r));
  }

  private get applicableParameterFilters(): ParameterFilterRule[] {
    return this.parameterFilters.filter(rule =>
      !this.isDuplicateParameterFilter(rule) && !getParameterSelectionError([rule]));
  }

  // --- DAX Model: no two measures may be an exact duplicate. ---
  private daxMeasureSignature(m: DaxMeasureConfig): string {
    // The measure name is just a label — two measures with the same operation but different names
    // are still duplicates, so `name` is excluded from the signature.
    return this.duplicateSignature(m as unknown as Record<string, unknown>, ['id', 'name', 'includeInSeries']);
  }

  /** True when the measure currently being edited duplicates another saved measure. */
  get daxDraftIsDuplicate(): boolean {
    if (!this.daxMeasureDraft.expression?.trim()) return false;
    const sig = this.daxMeasureSignature(this.daxMeasureDraft);
    return this.daxModel.measures.some(m => m.id !== this.daxMeasureDraft.id && !!m.expression?.trim() && this.daxMeasureSignature(m) === sig);
  }

  get hasDuplicateDaxMeasures(): boolean {
    const measures = this.daxModel.measures.filter(m => !!m.expression?.trim());
    const seen = new Set<string>();
    for (const m of measures) {
      const sig = this.daxMeasureSignature(m);
      if (seen.has(sig)) return true;
      seen.add(sig);
    }
    return false;
  }

  // --- Conditional Formatting: no two rules may be an exact duplicate. ---
  private conditionalRuleSignature(r: ConditionalRule): string {
    return this.duplicateSignature(r as unknown as Record<string, unknown>, ['id', 'enabled']);
  }

  /** True when an earlier conditional-formatting rule (for the same field) is an exact duplicate. */
  isDuplicateConditionalRule(rule: ConditionalRule): boolean {
    if (!rule.field || !rule.operator) return false;
    const sig = this.conditionalRuleSignature(rule);
    const first = this.conditionalRules.findIndex(r => !!r.field && !!r.operator && this.conditionalRuleSignature(r) === sig);
    return first !== -1 && this.conditionalRules.indexOf(rule) !== first;
  }

  get hasDuplicateConditionalRules(): boolean {
    return this.conditionalRules.some(r => this.isDuplicateConditionalRule(r));
  }

  /** Applied filter set: only hidden (eye-closed) filters with a column and a value. */
  private activeConditionalFilters(): ReportConditionalFilter[] {
    return this.conditionalFilters.filter(f => f.hidden && f.sourceColumn && f.valueText?.trim());
  }

  private applyReportConditionalFilters(rows: Record<string, unknown>[], transformed = false): Record<string, unknown>[] {
    const rawColumns = new Set(this.tablePreviewData?.columns ?? []);
    for (const field of this.calculatedFields) rawColumns.add(field.name);
    const active = this.activeConditionalFilters().filter(filter =>
      transformed !== rawColumns.has(filter.sourceColumn));
    if (!active.length) return rows;
    return applyConditionalFilters(rows, active.map(f => ({
      sourceColumn: f.sourceColumn,
      operator: f.operator,
      valueText: f.valueText,
      mode: f.mode,
      values: [],
    })));
  }

  // ---------------------------------------------------------------------------
  // DAX Model — calculated measures (ported from the chart builder). Row-scope
  // measures render as extra grid columns; column-scope measures render as a
  // value in the pinned totals row under their own column.
  // ---------------------------------------------------------------------------

  toggleDaxSection(): void {
    this.daxModelSectionExpanded = !this.daxModelSectionExpanded;
  }

  toggleLegendsSection(): void {
    this.legendsSectionExpanded = !this.legendsSectionExpanded;
  }

  addLegend(): void {
    this.legendItems = [...this.legendItems, { color: '#D9EAF7', label: '' }];
  }

  get configuredLegends(): ReportLegendItem[] {
    return this.legendItems.filter(item =>
      !!item
      && typeof item.color === 'string'
      && /^#[0-9a-fA-F]{6}$/.test(item.color)
      && typeof item.label === 'string'
      && !!item.label.trim(),
    );
  }

  removeLegend(index: number): void {
    this.legendItems = this.legendItems.filter((_, itemIndex) => itemIndex !== index);
  }

  /** Data columns selected for this report (not the DAX measures). */
  get daxSourceColumns(): string[] {
    return this.selectedRawFields;
  }

  get daxEnabled(): boolean { return this.daxModel.enabled; }

  get selectedDaxMeasure(): DaxMeasureConfig | undefined {
    return this.daxModel.measures.find(m => m.id === this.daxModel.selectedMeasureId);
  }

  get selectedDaxSeriesMeasures(): DaxMeasureConfig[] {
    // The "Show this measure in the report" checkbox is authoritative: an unchecked measure is hidden.
    return this.daxModel.measures.filter(m => m.includeInSeries !== false && m.expression.trim());
  }

  get daxPreviewMeasures(): DaxMeasureConfig[] {
    return this.daxEnabled ? this.selectedDaxSeriesMeasures : [];
  }

  /** Percentage needs separate numerator/denominator column pickers instead of the single Column picker. */
  get isDaxPercentageOperation(): boolean {
    return this.selectedDaxSnippet.split('(')[0].trim().toUpperCase() === 'PERCENTAGE';
  }

  /** Arithmetic aggregations that only make sense on numeric columns — text columns are hidden for these. */
  private readonly daxNumericOnlyOperations = new Set(['SUM', 'PRODUCT', 'AVERAGE', 'MEDIAN', 'PERCENTILE', 'DIVIDE', 'PERCENTAGE']);

  /** The current DAX operation name (e.g. SUM), or '' when none is selected. */
  get daxCurrentOperation(): string {
    return this.selectedDaxSnippet.split('(')[0].trim().toUpperCase();
  }

  /** True when the selected operation is numeric-only, so text (non-numeric) columns must be excluded. */
  get daxOperationRequiresNumeric(): boolean {
    return this.daxNumericOnlyOperations.has(this.daxCurrentOperation)
      && !/\b(IF|LEN|VALUE|DATEDIFF|ISBLANK)\s*\(/i.test(this.selectedDaxSnippet);
  }

  /** Columns offered in the DAX Column picker: numeric-only operations exclude text/non-numeric columns. */
  get daxSelectableColumns(): string[] {
    return this.daxOperationRequiresNumeric
      ? this.daxSourceColumns.filter(c => this.isAggregatableField(c))
      : this.daxSourceColumns;
  }

  /**
   * True once the DAX measure form's mandatory fields are filled: the Measure Name, plus a Column
   * when the Column picker is shown (source columns exist and the operation isn't Percentage, which
   * uses its own numerator/denominator pickers). Gates the Apply / Add / Delete actions so they stay
   * inactive on an incomplete draft.
   */
  get daxMandatoryFieldsFilled(): boolean {
    if (!this.daxMeasureDraft?.name?.trim()) return false;
    const requiresColumn = this.daxSelectableColumns.length > 0 && !this.isDaxPercentageOperation;
    return !requiresColumn || this.selectedDaxColumns.length > 0;
  }

  /** Numeric source columns — the Percentage numerator/denominator pickers only accept numeric columns. */
  get daxNumericSourceColumns(): string[] {
    return this.daxSourceColumns.filter(c => this.isAggregatableField(c));
  }

  /** Row-scope measures: one computed value per row, rendered as an extra grid column. */
  get daxRowMeasures(): DaxMeasureConfig[] {
    return this.daxPreviewMeasures.filter(m => (m.evaluationScope ?? 'column') === 'row' && !!m.name?.trim() && !!m.expression.trim());
  }

  /** Column-scope measures: one aggregate value for the whole column, rendered in the totals row. */
  get daxColumnMeasures(): DaxMeasureConfig[] {
    return this.daxPreviewMeasures.filter(m => (m.evaluationScope ?? 'column') !== 'row' && !!m.name?.trim() && !!m.expression.trim());
  }

  /** Only row-scope measures become extra grid columns; column-scope measures render as a summary row. */
  get daxMeasureColumns(): string[] {
    return this.daxRowMeasures.filter(m => !!m.name?.trim() && !!m.expression.trim()).map(m => m.name.trim());
  }

  /** Aggregate a column-scope measure over the current rows, tolerating an invalid expression. */
  private safeDaxColumnTotal(m: DaxMeasureConfig): number {
    try { return evaluateDaxMeasure(m, this.previewRows, this.shownColumns); }
    catch { return 0; }
  }

  /** "<Measure name>: <formatted value>" label shown in the summary row. */
  daxSummaryLabel(m: DaxMeasureConfig): string {
    return `${m.name?.trim() || 'New Metric'}: ${this.daxSummaryValue(m)}`;
  }

  /** Formatted aggregate value for a column-scope measure. */
  daxSummaryValue(m: DaxMeasureConfig): string {
    return formatDaxValue(this.safeDaxColumnTotal(m), m);
  }

  get daxDisplayPreference(): DaxDisplayPreference {
    return this.daxModel.displayPreference ?? 'result';
  }

  private createDefaultDaxMeasure(): DaxMeasureConfig {
    return createDefaultDaxMeasure(`measure-${this.nextDaxMeasureIndex++}`);
  }

  private syncDaxSelectionFromModel(): void {
    // Prefer the selected measure's own picker state (persisted per measure); fall back to the
    // model-level selection for legacy saves that only stored a single global operation/columns.
    const selected = this.selectedDaxMeasure;
    this.selectedDaxColumns = [...(selected?.columns ?? this.daxModel.selectedColumns ?? [])];
    this.selectedDaxSnippet = selected?.operation ?? this.daxModel.selectedOperation ?? '';
  }

  toggleDaxColumnDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxColumnDropdown = !this.showDaxColumnDropdown;
    this.daxColumnSearch = '';
    this.showDaxNumeratorDropdown = false;
    this.showDaxDenominatorDropdown = false;
  }

  toggleDaxNumeratorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxNumeratorDropdown = !this.showDaxNumeratorDropdown;
    this.showDaxColumnDropdown = false;
    this.showDaxDenominatorDropdown = false;
  }

  toggleDaxDenominatorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxDenominatorDropdown = !this.showDaxDenominatorDropdown;
    this.showDaxColumnDropdown = false;
    this.showDaxNumeratorDropdown = false;
  }

  toggleDaxModel(): void {
    this.daxModel = { ...this.daxModel, enabled: !this.daxModel.enabled };
    if (this.daxModel.enabled && !this.daxModel.measures.length) {
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { schemaVersion: 1, enabled: true, selectedMeasureId: measure.id, measures: [measure] };
    }
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    this.daxNameError = '';
    this.daxColumnError = '';
    this.rebuildPreviewGrid();
  }

  get daxSelectableMeasureCount(): number {
    return getActiveDaxMeasures({ daxModel: this.daxModel }).length;
  }

  toggleDaxMetricSelector(): void {
    this.daxModel = { ...this.daxModel, allowMetricSelector: !this.daxModel.allowMetricSelector };
    this.cdr.markForCheck();
  }

  updateDaxMeasureDraft(changes: Partial<DaxMeasureConfig>): void {
    this.daxMeasureDraft = { ...this.daxMeasureDraft, ...changes };
    if (changes.name?.trim()) this.daxMeasureFormError = '';
    this.daxDuplicateError = '';
    if (changes.name !== undefined && this.daxMeasureDraft.name.trim()) this.daxNameError = '';
    const expression = this.daxMeasureDraft.expression?.trim() ?? '';
    this.daxExpressionError = expression ? validateDaxExpression(expression, this.daxSourceColumns, this.daxMeasureDraft.evaluationScope) : '';
    // The live preview follows the draft only while its expression is valid.
    if (!this.daxExpressionError) {
      const measure = { ...this.daxMeasureDraft };
      this.daxModel = { ...this.daxModel, measures: this.daxModel.measures.map(m => m.id === measure.id ? measure : m) };
      this.rebuildPreviewGrid();
    }
  }

  /** Same checks as the Chart Builder: name (unique), Calculate By and a valid expression. */
  private validateDaxDraft(): boolean {
    const { form, expression } = validateDaxMeasureDraft(this.daxMeasureDraft, this.daxModel.measures, this.daxSourceColumns);
    this.daxMeasureFormError = form;
    this.daxExpressionError = expression;
    return !form && !expression;
  }

  saveDaxMeasure(): void {
    const name = this.daxMeasureDraft.name.trim();
    // Column is required only when the Column picker is shown (source columns exist and the
    // operation isn't Percentage, which uses its own numerator/denominator pickers instead).
    const requiresColumn = this.daxSelectableColumns.length > 0 && !this.isDaxPercentageOperation;
    this.daxNameError = name ? '' : 'Measure name is required';
    this.daxColumnError = requiresColumn && this.selectedDaxColumns.length === 0 ? 'Select at least one column' : '';
    this.daxDuplicateError = this.daxDraftIsDuplicate ? 'This measure duplicates an existing one.' : '';
    if (this.daxNameError || this.daxColumnError || this.daxDuplicateError) {
      this.cdr.markForCheck();
      return;
    }
    // Then the Chart Builder checks: unique name, Calculate By and a valid expression.
    if (!this.validateDaxDraft()) return;
    const id = this.daxMeasureDraft.id || `measure-${Date.now()}`;
    const measure: DaxMeasureConfig = {
      ...this.daxMeasureDraft,
      id,
      name,
      expression: this.daxMeasureDraft.expression.trim(),
    };
    const measures = this.daxModel.measures.some(m => m.id === id)
      ? this.daxModel.measures.map(m => m.id === id ? measure : m)
      : [...this.daxModel.measures, measure];
    this.daxModel = { ...this.daxModel, enabled: true, selectedMeasureId: id, measures };
    this.daxMeasureDraft = { ...measure };
    this.showDaxMeasureApplied();
    this.rebuildPreviewGrid();
  }

  addDaxMeasure(): void {
    // A blank measure is already the new one; a started one is kept only when valid.
    const blank = !this.daxMeasureDraft.name?.trim() && !this.daxMeasureDraft.expression?.trim();
    if (blank) {
      this.daxMeasureFormError = 'Enter a measure name and expression, then click Add Measure.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.validateDaxDraft()) return;
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
    this.daxNameError = '';
    this.daxColumnError = '';
    this.showDaxMeasureApplied('Measure added. You can review it by clicking the tile above');
    this.rebuildPreviewGrid();
  }

  private resetDaxOperationPickerState(): void {
    this.selectedDaxSnippet = '';
    this.selectedDaxColumns = [];
    this.daxColumnSearch = '';
    this.showDaxColumnDropdown = false;
    this.showDaxNumeratorDropdown = false;
    this.showDaxDenominatorDropdown = false;
  }

  /** Briefly flashes a confirmation badge (with the given message) next to the measure actions. */
  private showDaxMeasureApplied(message = 'Measure applied'): void {
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
    if (!measure) return;
    this.daxModel = { ...this.daxModel, selectedMeasureId: id };
    this.daxMeasureDraft = { ...measure };
    this.resetDaxOperationPickerState();
    // Restore the measure's own Operation and Column picker selections so returning to a saved
    // measure shows its original choices instead of blank placeholders.
    this.selectedDaxSnippet = measure.operation ?? '';
    this.selectedDaxColumns = [...(measure.columns ?? [])];
    this.daxExpressionError = '';
    this.daxNameError = '';
    this.daxColumnError = '';
    this.rebuildPreviewGrid();
  }

  removeDaxMeasure(id: string): void {
    const deletedName = (id === this.daxMeasureDraft.id ? this.daxMeasureDraft.name?.trim() : '')
      || this.daxModel.measures.find(m => m.id === id)?.name?.trim();
    // An unnamed (blank) measure has no name to show.
    const deletedMessage = deletedName ? `The measure ${deletedName} is deleted` : 'Measure deleted';
    if (this.daxModel.measures.length <= 1) {
      // Only one measure exists - "delete" clears it back to a blank default instead of a no-op.
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { ...this.daxModel, selectedMeasureId: measure.id, measures: [measure] };
      this.daxMeasureDraft = { ...measure };
      this.resetDaxOperationPickerState();
      this.daxExpressionError = '';
      this.showDaxMeasureApplied(deletedMessage);
      this.rebuildPreviewGrid();
      return;
    }
    const measures = this.daxModel.measures.filter(m => m.id !== id);
    const selectedMeasureId = this.daxModel.selectedMeasureId === id ? measures[0].id : this.daxModel.selectedMeasureId;
    this.daxModel = { ...this.daxModel, selectedMeasureId, measures };
    const nextMeasure = this.selectedDaxMeasure ?? measures[0];
    this.daxMeasureDraft = { ...nextMeasure };
    // The pickers belonged to the deleted measure; show the remaining one's instead.
    this.resetDaxOperationPickerState();
    this.selectedDaxSnippet = nextMeasure.operation ?? '';
    this.selectedDaxColumns = [...(nextMeasure.columns ?? [])];
    this.showDaxMeasureApplied(deletedMessage);
    this.rebuildPreviewGrid();
  }

  updateDaxColumns(columns: string[]): void {
    this.selectedDaxColumns = columns ?? [];
    if (this.selectedDaxColumns.length) this.daxColumnError = '';
    this.daxModel = { ...this.daxModel, enabled: true, selectedColumns: [...this.selectedDaxColumns] };
    // Persist the column selection on the measure so it survives switching between measures.
    this.daxMeasureDraft = { ...this.daxMeasureDraft, columns: [...this.selectedDaxColumns] };
    this.applyDaxSelectedOperation();
    this.rebuildPreviewGrid();
  }

  toggleDaxColumn(column: string): void {
    const columns = this.selectedDaxColumns.includes(column)
      ? this.selectedDaxColumns.filter(selected => selected !== column)
      : [...this.selectedDaxColumns, column];
    this.updateDaxColumns(columns);
  }

  selectAllDaxColumns(): void {
    this.updateDaxColumns([...new Set([...this.selectedDaxColumns, ...this.filteredDaxSelectableColumns])]);
  }

  deselectAllDaxColumns(): void {
    const visibleColumns = new Set(this.filteredDaxSelectableColumns);
    this.updateDaxColumns(this.selectedDaxColumns.filter(column => !visibleColumns.has(column)));
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

  selectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([...this.daxNumericSourceColumns]); }
  deselectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([]); }
  selectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([...this.daxNumericSourceColumns]); }
  deselectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([]); }

  // Drive the single Select-all/Deselect-all toggle: true only when every selectable column is chosen.
  get allDaxColumnsSelected(): boolean {
    const cols = this.filteredDaxSelectableColumns;
    return cols.length > 0 && cols.every(c => this.selectedDaxColumns.includes(c));
  }

  get filteredDaxSelectableColumns(): string[] {
    const search = this.daxColumnSearch.trim().toLowerCase();
    return search
      ? this.daxSelectableColumns.filter(column => column.toLowerCase().includes(search))
      : this.daxSelectableColumns;
  }
  get allDaxNumeratorColumnsSelected(): boolean {
    const sel = this.daxMeasureDraft.numeratorColumns ?? [];
    return this.daxNumericSourceColumns.length > 0 && this.daxNumericSourceColumns.every(c => sel.includes(c));
  }
  get allDaxDenominatorColumnsSelected(): boolean {
    const sel = this.daxMeasureDraft.denominatorColumns ?? [];
    return this.daxNumericSourceColumns.length > 0 && this.daxNumericSourceColumns.every(c => sel.includes(c));
  }

  /** Percentage = sum of chosen numerator columns divided by sum of chosen denominator columns. */
  private buildDaxPercentageExpression(numerator: string[], denominator: string[]): string {
    if (!numerator.length || !denominator.length) return this.selectedDaxSnippet || this.daxMeasureDraft.expression;
    const isRowScope = (this.daxMeasureDraft.evaluationScope ?? 'column') === 'row';
    const wrap = (column: string) => isRowScope ? `[${column}]` : `SUM([${column}])`;
    const numeratorExpr = numerator.map(wrap).join(' + ');
    const denominatorExpr = denominator.map(wrap).join(' + ');
    return `PERCENTAGE(${numeratorExpr}, ${denominatorExpr})`;
  }

  updateDaxEvaluationScope(scope: DaxEvaluationScope): void {
    const evaluationScope: DaxEvaluationScope = scope === 'row' ? 'row' : 'column';
    const measure = { ...this.daxMeasureDraft, evaluationScope };
    this.daxMeasureDraft = measure;
    this.daxModel = { ...this.daxModel, measures: this.daxModel.measures.map(m => m.id === measure.id ? measure : m) };
    this.daxExpressionError = '';
    if (this.selectedDaxSnippet) this.applyDaxSelectedOperation();
    this.rebuildPreviewGrid();
  }

  insertDaxSnippet(snippet: string): void {
    if (!snippet) return;
    this.selectedDaxSnippet = snippet;
    this.daxModel = { ...this.daxModel, enabled: true, selectedOperation: snippet };
    // Persist the chosen operation on the measure so it survives switching between measures.
    this.daxMeasureDraft = { ...this.daxMeasureDraft, operation: snippet, numeratorColumns: [], denominatorColumns: [] };
    // A numeric-only operation can't use text columns — drop any previously-selected ones that
    // are no longer valid so a stale text column doesn't linger in the expression.
    const allowed = new Set(this.daxSelectableColumns);
    const pruned = this.selectedDaxColumns.filter(c => allowed.has(c));
    if (pruned.length !== this.selectedDaxColumns.length) {
      this.selectedDaxColumns = pruned;
      this.daxModel = { ...this.daxModel, selectedColumns: [...pruned] };
    }
    this.applyDaxSelectedOperation();
    this.rebuildPreviewGrid();
  }

  applyDaxSelectedOperation(): void {
    if (!this.selectedDaxSnippet) return;
    const operation = this.selectedDaxSnippet.split('(')[0].trim().toUpperCase();
    const expression = operation === 'PERCENTAGE'
      ? this.buildDaxPercentageExpression(this.daxMeasureDraft.numeratorColumns ?? [], this.daxMeasureDraft.denominatorColumns ?? [])
      : this.buildDaxExpressionFromSelection();
    let format = this.daxMeasureDraft.format;
    if (operation === 'PERCENTAGE') format = 'percent';
    else if (format === 'percent') format = 'number';
    this.updateDaxMeasureDraft({ expression, format });
  }

  private buildDaxExpressionFromSelection(): string {
    if (this.daxMeasureDraft.evaluationScope === 'row' && this.selectedDaxSnippet === 'SUM([Column])' && this.selectedDaxColumns.length > 1) {
      return this.selectedDaxColumns.map(column => `[${column}]`).join(' + ');
    }
    return buildDaxOperationExpression(this.selectedDaxSnippet, this.selectedDaxColumns, this.daxMeasureDraft.evaluationScope);
  }

  /** Group/grand total rows are grid options (not columnDefs); OnPush + no zone.js needs a manual CD. */
  refreshGridTotals(): void {
    this.cdr.detectChanges();
  }

  isRowGroupField(field: string): boolean {
    return this.rowGroupFields.includes(field);
  }

  /** Numeric columns only offer aggregation (sum/average) in the row-grouping panel. */
  isNumericField(field: string): boolean {
    return isNumericColumn(this.previewRows, field);
  }

  /** Date columns can use comparison operators (e.g. "greater than") even though they aren't numeric. */
  isDateField(field: string): boolean {
    return isDateColumn(this.previewRows, field);
  }

  /** Columns that support numeric comparison ("greater than"): numeric or date. Pure text can't. */
  isComparableField(field: string): boolean {
    return this.isAggregatableField(field) || this.isDateField(field);
  }

  /** Total-row aggregations for a column: Sum/Average apply to numeric and percentage ("12.5%") columns; others get Count only. */
  totalOptionsFor(field: string): string[] {
    return this.isAggregatableField(field) ? this.totalOptions : ['Count'];
  }

  /** Numeric or percentage ("12.5%") columns — offered to every numeric operation (totals, Math, DAX, comparisons). */
  isAggregatableField(field: string): boolean {
    return isAggregatableColumn(this.previewRows, field);
  }

  toggleRowGroupField(field: string): void {
    if (this.isRowGroupField(field)) {
      this.rowGroupFields = this.rowGroupFields.filter(f => f !== field);
    } else {
      this.rowGroupFields = [...this.rowGroupFields, field];
    }
    // Fit columns after the group column appears so long group values aren't clipped.
    this.autoSizeOnNextRender = true;
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
  }

  setRowGroupAgg(field: string, value: string): void {
    if (value === 'sum' || value === 'avg') {
      this.rowGroupAggs[field] = value;
    } else {
      delete this.rowGroupAggs[field];
    }
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
  }

  /** Sets (or clears) the background color of a field's group title rows. */
  setRowGroupColor(field: string, value: string): void {
    if (value) {
      this.rowGroupColors[field] = value;
    } else {
      delete this.rowGroupColors[field];
    }
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
  }

  clearRowGrouping(): void {
    this.rowGroupFields = [];
    this.rowGroupAggs = {};
    this.rowGroupColors = {};
    this.rebuildPreviewGrid();
    this.cdr.detectChanges();
  }

  /** Keeps the accordion in sync when the user drags/reorders groups in the grid's top panel. */
  onColumnRowGroupChanged(event: ColumnRowGroupChangedEvent): void {
    if (event.source === 'gridInitializing' || event.source === 'gridOptionsChanged') return;
    const cols = event.api?.getRowGroupColumns?.() ?? [];
    const resolve = createColumnConfigResolver(this.buildLiveConfig());
    const next = cols.map(c => resolve(c.getColId())?.field ?? c.getColId());
    const changed = next.length !== this.rowGroupFields.length || next.some((f, i) => f !== this.rowGroupFields[i]);
    if (!changed) return;
    this.rowGroupFields = next;
    this.cdr.detectChanges();
  }

  toggleHeaderBanner(): void {
    this.headerBannerExpanded = !this.headerBannerExpanded;
  }

  toggleLogos(): void {
    this.logosExpanded = !this.logosExpanded;
  }

  onLogoUpload(event: Event, side: 'left' | 'right'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (side === 'left') this.leftLogoUrl = dataUrl;
      else this.rightLogoUrl = dataUrl;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  removeLogo(side: 'left' | 'right'): void {
    if (side === 'left') this.leftLogoUrl = '';
    else this.rightLogoUrl = '';
  }

  readonly DEFAULT_GRADIENT = 'linear-gradient(90.37deg, #162B6F 0%, #1B3585 30%, #21409A 58%, #2852B1 82%, #315FC2 100%)';

  toggleColorTheme(): void {
    this.colorThemeExpanded = !this.colorThemeExpanded;
  }

  useDefaultGradient(): void {
    this.headerBackgroundColor = this.DEFAULT_GRADIENT;
    this.headerTextColor = '#FFFFFF';
  }

  /** Applies a built-in theme preset: recolors banner, footer, table header and group accents in one step. */
  applyBuiltInTheme(id: string): void {
    const theme = this.builtInThemes.find(t => t.id === id);
    this.selectedThemeId = id;
    if (!theme) return;
    this.headerBackgroundColor = theme.bannerBackground;
    this.headerTextColor = theme.bannerText;
    this.bannerBackgroundColor = theme.footerBackground;
    this.bannerTextColor = theme.footerText;
    this.headerRowColor = theme.headerRowColor;
    this.headerRowTextColor = theme.headerRowTextColor;
    this.groupTextColor = theme.groupText;
    this.subGroupTextColor = theme.subGroupText;
    if (this.columnGroupColors[0]) this.columnGroupColors[0].color = theme.groupColor;
    if (this.columnGroupColors[1]) this.columnGroupColors[1].color = theme.subGroupColor;
    this.gridAccentColor = theme.accent;
    this.gridHeaderBg = theme.headerRowColor;
    this.updateGridTheme();
    this.rebuildPreviewGrid();
  }

  /** Toggles branded zebra striping on/off; repaints the grid and refreshes the export style registry. */
  applyBrandedRows(): void {
    this.updateGridTheme();
    this.rebuildPreviewGrid();
  }

  toggleTypography(): void {
    this.typographyExpanded = !this.typographyExpanded;
  }

  incrementFontSize(): void {
    this.fontSize = Math.min(72, this.fontSize + 1);
    this.updateGridTheme();
  }

  decrementFontSize(): void {
    this.fontSize = Math.max(8, this.fontSize - 1);
    this.updateGridTheme();
  }

  incrementHeaderFontSize(): void {
    this.headerFontSize = Math.min(72, this.headerFontSize + 1);
  }

  decrementHeaderFontSize(): void {
    this.headerFontSize = Math.max(8, this.headerFontSize - 1);
  }

  incrementBannerFontSize(): void {
    this.bannerFontSize = Math.min(72, this.bannerFontSize + 1);
    this.onFooterFontSizeChange();
  }

  decrementBannerFontSize(): void {
    this.bannerFontSize = Math.max(8, this.bannerFontSize - 1);
    this.onFooterFontSizeChange();
  }

  /** Footer/totals rows read the "Footer Font Size" via getRowStyle — redraw so the change paints live. */
  onFooterFontSizeChange(): void {
    for (const api of [this.liveGridApi, this.liveExpandGridApi]) api?.redrawRows();
    this.cdr.markForCheck();
  }

  incrementTableHeadingFontSize(): void {
    this.tableHeadingFontSize = Math.min(72, this.tableHeadingFontSize + 1);
    this.updateGridTheme();
  }

  decrementTableHeadingFontSize(): void {
    this.tableHeadingFontSize = Math.max(8, this.tableHeadingFontSize - 1);
    this.updateGridTheme();
  }

  /** Column-header row height — clamped to a sensible range and pushed to the live grid. */
  onGridHeaderHeightChange(): void {
    const n = Math.round(Number(this.gridHeaderHeight));
    this.gridHeaderHeight = Number.isFinite(n) ? Math.min(160, Math.max(24, n)) : 36;
    this.cdr.detectChanges();
  }

  incrementGridHeaderHeight(): void {
    this.gridHeaderHeight = Math.min(160, this.gridHeaderHeight + 2);
    this.cdr.detectChanges();
  }

  decrementGridHeaderHeight(): void {
    this.gridHeaderHeight = Math.max(24, this.gridHeaderHeight - 2);
    this.cdr.detectChanges();
  }

  /** Rebuilds the grid theme so Font Family / Table Font Size / Table Heading Size apply to the grid. */
  updateGridTheme(): void {
    this.gridTheme = themeQuartz.withParams({
      accentColor: this.gridAccentColor,
      backgroundColor: '#ffffff',
      borderColor: '#E2E7EF',
      borderRadius: 8,
      headerBackgroundColor: this.gridHeaderBg,
      headerTextColor: '#344054',
      headerFontWeight: 700,
      rowHoverColor: '#F0F4FF',
      // Branded zebra striping: a faint tint of the active theme accent (only when the user opts in).
      oddRowBackgroundColor: this.brandedRows ? this.tint(this.gridAccentColor, 0.06) : '#ffffff',
      wrapperBorder: false,
      wrapperBorderRadius: 0,
      headerRowBorder: false,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      headerFontSize: this.tableHeadingFontSize,
    });
    this.cdr.markForCheck();
  }

  /** Mixes a #RRGGBB color with white by `amount` (0-1 = share of the color); used for branded row striping. */
  private tint(hex: string, amount: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return '#F2F4F9';
    const n = parseInt(m[1], 16);
    const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount));
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
  }

  toggleColumnShown(field: string): void {
    const config = this.columnConfigs[field];
    if (config) config.shown = !config.shown;
    this.rebuildPreviewGrid();
  }

  private appendCalculatedFields(): void {
    for (const cf of this.calculatedFields) {
      if (!this.columnFields.includes(cf.name)) {
        this.columnFields.push(cf.name);
      }
      if (!this.selectedRawFields.includes(cf.name)) {
        this.selectedRawFields.push(cf.name);
      }
      if (!this.columnConfigs[cf.name]) {
        this.columnConfigs[cf.name] = { shown: true, group: '', subGroup: '', total: '', color: '' };
      }
    }
  }

  addCalculatedColumn(): void {
    this.calcName = `Calculated ${this.nextCalculatedIndex}`;
    this.calcColumnA = this.selectedRawFields[0] || '';
    this.calcColumnB = this.selectedRawFields[1] || this.selectedRawFields[0] || '';
    this.calcOperation = 'add';
    this.showCalcModal = true;
  }

  confirmCalculatedColumn(): void {
    const name = this.calcName.trim();
    if (!name || !this.calcColumnA || !this.calcColumnB) return;
    this.nextCalculatedIndex += 1;
    this.calculatedFields.push({
      name,
      columnA: this.calcColumnA,
      columnB: this.calcColumnB,
      operation: this.calcOperation,
    });
    this.columnFields = [...this.columnFields, name];
    this.selectedRawFields = [...this.selectedRawFields, name];
    this.columnConfigs[name] = { shown: true, group: '', subGroup: '', total: '', color: '' };
    this.showCalcModal = false;
    this.rebuildPreviewGrid();
    this.cdr.markForCheck();
  }

  cancelCalculatedColumn(): void {
    this.showCalcModal = false;
  }

  //  Feature: Conditional formatting
  /** Rules that target any column currently being edited in the modal. */
  get conditionalRulesForField(): ConditionalRule[] {
    return this.conditionalRules.filter(r => this.cfFields.includes(r.field));
  }

  /** Selected column headers shown in the conditional-formatting modal title. */
  get cfHeader(): string {
    return this.cfFields
      .map(field => this.gridApi?.getColumn(field)?.getColDef().headerName || field)
      .join(', ');
  }

  /** Operators that don't need a comparison value. */
  get cfNeedsValue(): boolean {
    return !this.isValuelessCfOperator(this.cfOperator);
  }

  private isValuelessCfOperator(op: CfOperator): boolean {
    return op === 'isEmpty' || op === 'notEmpty' || op === 'duplicate';
  }

  /** Picking "Duplicate values" switches to its light-red highlight with locked dark-red text, Excel-style. */
  onCfOperatorChange(op: CfOperator): void {
    const wasDuplicate = this.cfOperator === 'duplicate';
    this.cfOperator = op;
    if (op === 'duplicate') {
      this.cfBgColor = DUPLICATE_HIGHLIGHT_BG;
      this.cfUseBgColor = true;
      this.cfTextColor = DUPLICATE_HIGHLIGHT_TEXT;
      this.cfUseTextColor = true;
    } else if (wasDuplicate) {
      // Leaving the locked state: hand Text color back to the user at its usual default.
      this.cfTextColor = '#111827';
      this.cfUseTextColor = false;
    }
  }

  /** Duplicate rules always use the fixed dark-red text, so the Text color control is locked. */
  get cfTextColorLocked(): boolean {
    return this.cfOperator === 'duplicate';
  }

  /** Duplicate rules always use the fixed light-red highlight, so the Background control is locked. */
  get cfBgColorLocked(): boolean {
    return this.cfOperator === 'duplicate';
  }

  /** At least one visual format must be enabled for a rule to be addable. */
  get cfHasFormat(): boolean {
    return this.cfUseBgColor || this.cfUseTextColor || this.cfBold;
  }

  openConditionalFormatting(fields: string | string[]): void {
    this.cfFields = [...new Set(typeof fields === 'string' ? [fields] : fields)];
    this.cfOperator = 'gt';
    this.cfValue = '';
    this.cfValue2 = '';
    this.cfBgColor = '#FEF3C7';
    this.cfUseBgColor = true;
    this.cfTextColor = '#111827';
    this.cfUseTextColor = false;
    this.cfBold = false;
    this.cfScope = 'column';
    this.showConditionalModal = true;
  }

  addConditionalRule(): void {
    if (this.cfNeedsValue && this.cfValue.trim() === '') return;
    if (!this.cfHasFormat || !this.cfFields.length) return;
    const rule = {
      operator: this.cfOperator,
      value: this.cfNeedsValue ? this.cfValue.trim() : undefined,
      value2: this.cfOperator === 'between' ? this.cfValue2.trim() : undefined,
      backgroundColor: this.cfBgColorLocked
        ? DUPLICATE_HIGHLIGHT_BG
        : (this.cfUseBgColor && this.cfBgColor ? this.cfBgColor : undefined),
      textColor: this.cfTextColorLocked
        ? DUPLICATE_HIGHLIGHT_TEXT
        : (this.cfUseTextColor && this.cfTextColor ? this.cfTextColor : undefined),
      bold: this.cfBold || undefined,
      scope: this.cfScope,
    };
    this.conditionalRules = [
      ...this.conditionalRules,
      ...this.cfFields.map(field => ({
        id: this.uid(),
        field,
        ...rule,
      })),
    ];
    this.cfValue = '';
    this.cfValue2 = '';
    this.refreshGridStyles();
  }

  removeConditionalRule(id: string): void {
    this.conditionalRules = this.conditionalRules.filter(r => r.id !== id);
    this.refreshGridStyles();
  }

  closeConditionalModal(): void {
    this.showConditionalModal = false;
  }

  /** Human-readable summary of a rule for the modal's rule list. */
  conditionalRuleLabel(rule: ConditionalRule): string {
    const op = this.cfOperators.find(o => o.value === rule.operator)?.label ?? rule.operator;
    if (this.isValuelessCfOperator(rule.operator)) return op;
    if (rule.operator === 'between') return `${op} ${rule.value} and ${rule.value2}`;
    return `${op} ${rule.value}`;
  }

  /** Scope suffix shown after a rule in the modal's rule list ('' for the default column scope). */
  conditionalRuleScopeLabel(rule: ConditionalRule): string {
    const scope = rule.scope ?? (rule.applyToRow ? 'row' : 'column');
    if (scope === 'row') return 'whole row';
    if (scope === 'report') return 'entire report';
    return '';
  }

  removeCalculatedField(name: string): void {
    this.deleteColumns([name]);
    this.cdr.markForCheck();
  }

  computeCalcValue(row: Record<string, unknown>, field: string): string {
    const calc = this.calculatedFields.find(f => f.name === field);
    if (!calc) return String(row[field] ?? '—');
    const a = coerceNumberAllowPercent(row[calc.columnA]);
    const b = coerceNumberAllowPercent(row[calc.columnB]);
    if (isNaN(a) || isNaN(b)) return '—';
    switch (calc.operation) {
      case 'add': return (a + b).toLocaleString();
      case 'subtract': return (a - b).toLocaleString();
      case 'multiply': return (a * b).toLocaleString();
      case 'divide': return b === 0 ? '—' : (a / b).toFixed(2);
      case 'percentage': return b === 0 ? '—' : ((a / b) * 100).toFixed(2) + '%';
      default: return '—';
    }
  }

  isCalculatedField(field: string): boolean {
    return this.calculatedFields.some(f => f.name === field);
  }

  addPage(): void {
    this.showAddPageConfirm = true;
  }

  showAddPageConfirm = false;
  nameValidationError = '';
  descriptionValidationError = '';

  confirmAddPageSave(): void {
    this.showAddPageConfirm = false;

    const resolved = this.validateAndResolve();
    if (!resolved) return;

    this.isSaving = true;
    const { categoryId, sourceName, sourceType, reportJson } = resolved;

    const save$ = this.editingReportId
      ? this.tenantReports.update(this.editingReportId, { reportName: this.reportName, description: this.reportDescription, categoryId, sourceName, sourceType, reportJson, status: 'draft' })
      : this.tenantReports.create({ reportName: this.reportName, description: this.reportDescription, categoryId, sourceName, sourceType, reportJson });

    this.subs.push(save$.subscribe({
      next: () => {
        this.isSaving = false;

        // Show success message
        this.notify.showSuccess(`'${this.reportName}' saved successfully.`);
        this.cdr.detectChanges();

        // Add a new blank sheet to keep building
        this.addSheet();
      },
      error: (err) => {
        this.isSaving = false;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to save report.');
        this.cdr.detectChanges();
      },
    }));
  }

  confirmAddPageDiscard(): void {
    this.showAddPageConfirm = false;
    // Don't navigate away — just add a new blank sheet
    this.addSheet();
  }

  cancelAddPage(): void {
    this.showAddPageConfirm = false;
  }

  // ─── Excel-like sheet operations ──────────────────────────────────────────

  /** Adds a new blank sheet and switches to it, ready for a fresh data source. */
  addSheet(): void {
    this.saveActiveSheetState();
    this.sheetsService.add();
    this.resetBuilderForNewSheet();
    this.rebuildPreviewGrid();
    this.resetHistory();
    this.cdr.detectChanges();
  }

  /** Switches to another sheet, saving the current one and restoring the target. */
  switchSheet(id: string): void {
    if (id === this.sheetsService.activeId) return;
    this.sourcePreviewSubscription?.unsubscribe();
    this.isLoadingPreview = false;
    this.closeSheetMenu();
    this.saveActiveSheetState();
    this.sheetsService.setActive(id);
    const state = this.sheetsService.active?.state as ReportSheetSnapshot | null | undefined;
    if (state) this.applySheetState(state);
    else this.resetBuilderForNewSheet();
    // Reconstructed sheets (from an edited multi-page report) carry no preview data — fetch it now.
    if (state && !this.tablePreviewData && this.selectedDataModelId) {
      if (this.dataSourceMode === 'view') this.loadViewPreviewForEdit(this.selectedDataModelId);
      else this.loadTablePreview();
    } else {
      this.rebuildPreviewGrid();
    }
    this.resetHistory();
    this.cdr.detectChanges();
  }

  /** Begins inline rename of a sheet (double-click). */
  startRenameSheet(sheet: ReportSheet): void {
    this.closeSheetMenu();
    this.renamingSheetId = sheet.id;
    this.renameSheetValue = sheet.name;
    setTimeout(() => {
      const el = document.querySelector('.sheet-tabs__rename') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  commitRenameSheet(sheet: ReportSheet): void {
    if (this.renamingSheetId !== sheet.id) return;
    this.sheetsService.rename(sheet.id, this.renameSheetValue);
    this.renamingSheetId = null;
    this.cdr.markForCheck();
  }

  cancelRenameSheet(): void {
    this.renamingSheetId = null;
    this.cdr.markForCheck();
  }

  /** Opens the right-click context menu for a sheet at the pointer position. */
  openSheetMenu(event: MouseEvent, sheet: ReportSheet): void {
    event.preventDefault();
    event.stopPropagation();
    this.sheetMenu = { sheet, x: event.clientX, y: event.clientY };
    this.cdr.markForCheck();
  }

  closeSheetMenu(): void {
    if (this.sheetMenu) {
      this.sheetMenu = null;
      this.cdr.markForCheck();
    }
  }

  /** Deletes a sheet via the context menu (blocked when only one sheet remains). */
  deleteSheet(sheet: ReportSheet): void {
    if (!this.sheetsService.canDelete) { this.closeSheetMenu(); return; }
    const wasActive = this.sheetsService.activeId === sheet.id;
    const nextActive = this.sheetsService.remove(sheet.id);
    if (wasActive && nextActive) {
      const state = nextActive.state as ReportSheetSnapshot | null | undefined;
      if (state) this.applySheetState(state);
      else this.resetBuilderForNewSheet();
      this.rebuildPreviewGrid();
    }
    this.resetHistory();
    this.closeSheetMenu();
    this.cdr.detectChanges();
  }

  private saveActiveSheetState(): void {
    this.sheetsService.saveState(this.captureSheetState());
  }

  /** Snapshots every per-sheet builder property so it can be restored later. */
  private captureSheetState(): ReportSheetSnapshot {
    // A rename edited since the last rebuild must not leave formatting keyed by the old name.
    this.syncColumnKeysWithRenames();
    return {
      dataSourceMode: this.dataSourceMode,
      selectedDataModelId: this.selectedDataModelId,
      selectedRawFields: [...this.selectedRawFields],
      columnFields: [...this.columnFields],
      columnConfigs: structuredClone(this.columnConfigs),
      tablePreviewData: this.tablePreviewData,
      availableViews: this.availableViews,
      rowGroupFields: [...this.rowGroupFields],
      rowGroupAggs: { ...this.rowGroupAggs },
      rowGroupColors: { ...this.rowGroupColors },
      subtotalAfterGroup: this.subtotalAfterGroup,
      grandTotalAtBottom: this.grandTotalAtBottom,
      showTotals: this.showTotals,
      selectedReportType: this.selectedReportType,
      metric: this.metric,
      sortBy: this.sortBy,
      limitCategory: this.limitCategory,
      calculatedFields: structuredClone(this.calculatedFields),
      nextCalculatedIndex: this.nextCalculatedIndex,
      conditionalRules: structuredClone(this.conditionalRules),
      daxModel: cloneDaxModel(this.daxModel),
      legendItems: structuredClone(this.legendItems),
      conditionalFilters: structuredClone(this.conditionalFilters),
      parameterFilters: structuredClone(this.parameterFilters),
      headerTitle: this.headerTitle,
      headerSubtitle: this.headerSubtitle,
      headerSubtitle2: this.headerSubtitle2,
      bannerText: this.bannerText,
      clusterBannerText: this.clusterBannerText,
      clusterBannerSelection: this.clusterBannerSelection,
      customClusterBannerEnabled: this.customClusterBannerEnabled,
      headerBackgroundColor: this.headerBackgroundColor,
      headerTextColor: this.headerTextColor,
      bannerBackgroundColor: this.bannerBackgroundColor,
      bannerTextColor: this.bannerTextColor,
      groupTextColor: this.groupTextColor,
      subGroupTextColor: this.subGroupTextColor,
      headerRowColor: this.headerRowColor,
      headerRowTextColor: this.headerRowTextColor,
      headerCellColors: { ...this.headerCellColors },
      headerCellTextColors: { ...this.headerCellTextColors },
      rowColors: { ...this.rowColors },
      rowColorsByKey: { ...this.rowColorsByKey },
      summaryRowColors: { ...this.summaryRowColors },
      summaryRowTextColors: { ...this.summaryRowTextColors },
      rowTextColors: { ...this.rowTextColors },
      rowTextColorsByKey: { ...this.rowTextColorsByKey },
      pageRowColors: { ...this.pageRowColors },
      cellColors: { ...this.cellColors },
      cellTextColors: { ...this.cellTextColors },
      columnGroupColors: structuredClone(this.columnGroupColors),
      subGroupColors: { ...this.subGroupColors },
      groupColors: { ...this.groupColors },
      groupTextColors: { ...this.groupTextColors },
      subGroupTextColors: { ...this.subGroupTextColors },
      pinnedColumns: [...this.pinnedColumns],
      dataBarColumns: [...this.dataBarColumns],
      leftLogoUrl: this.leftLogoUrl,
      rightLogoUrl: this.rightLogoUrl,
      rightLogoColor: this.rightLogoColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      headerFontSize: this.headerFontSize,
      bannerFontSize: this.bannerFontSize,
      tableHeadingFontSize: this.tableHeadingFontSize,
      gridHeaderHeight: this.gridHeaderHeight,
      selectedThemeId: this.selectedThemeId,
      brandedRows: this.brandedRows,
      gridAccentColor: this.gridAccentColor,
      mergedCellRanges: structuredClone(this.mergedCellRanges),
      rowLayout: structuredClone(this.rowLayout),
      manualRows: structuredClone(this.manualRows),
      cellOverrides: structuredClone(this.cellOverrides),
      deletedRowIndices: [...this.deletedRowIndices],
      cellEmbeds: structuredClone(this.cellEmbeds),
      cellOrientations: { ...this.cellOrientations },
      headerCellOrientations: { ...this.headerCellOrientations },
      cellAlignments: { ...this.cellAlignments },
      headerCellAlignments: { ...this.headerCellAlignments },
      reportAlignment: this.reportAlignment,
      groupHeaderAlignments: { ...this.groupHeaderAlignments },
      subGroupHeaderAlignments: { ...this.subGroupHeaderAlignments },
      cellBorders: { ...this.cellBorders },
      headerCellBorders: { ...this.headerCellBorders },
      reportBorder: this.reportBorder,
      rowNumberHeader: this.rowNumberHeader,
      viewMode: this.viewMode,
      gridRowHeight: this.gridRowHeight,
      columnSizingMode: this.columnSizingMode,
      gridPaginationPageSize: this.gridPaginationPageSize,
    };
  }

  /** Restores a previously captured sheet snapshot into the live builder state. */
  private applySheetState(s: ReportSheetSnapshot): void {
    // The restored formatting already matches the restored rules; re-baseline instead of re-keying.
    this.columnKeyRenames = undefined;
    this.dataSourceMode = s.dataSourceMode;
    this.selectedDataModelId = s.selectedDataModelId;
    this.selectedRawFields = [...s.selectedRawFields];
    this.columnFields = [...s.columnFields];
    this.columnConfigs = structuredClone(s.columnConfigs);
    this.tablePreviewData = s.tablePreviewData;
    this.availableViews = s.availableViews;
    this.rowGroupFields = [...s.rowGroupFields];
    this.rowGroupAggs = { ...s.rowGroupAggs };
    this.rowGroupColors = { ...(s.rowGroupColors ?? {}) };
    this.subtotalAfterGroup = s.subtotalAfterGroup;
    this.grandTotalAtBottom = s.grandTotalAtBottom;
    this.showTotals = s.showTotals;
    this.selectedReportType = s.selectedReportType;
    this.metric = s.metric;
    this.sortBy = s.sortBy;
    this.limitCategory = s.limitCategory;
    this.calculatedFields = structuredClone(s.calculatedFields);
    this.nextCalculatedIndex = s.nextCalculatedIndex;
    this.conditionalRules = structuredClone(s.conditionalRules);
    this.daxModel = cloneDaxModel(s.daxModel);
    this.legendItems = structuredClone(s.legendItems ?? []);
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.syncDaxSelectionFromModel();
    this.conditionalFilters = structuredClone(s.conditionalFilters ?? []);
    this.nextConditionalFilterId = this.conditionalFilters.reduce((max, f) => Math.max(max, f.id + 1), 1);
    this.parameterFilters = structuredClone(s.parameterFilters ?? []);
    this.syncParameterFilterIds();
    this.headerTitle = s.headerTitle;
    this.headerSubtitle = s.headerSubtitle;
    this.headerSubtitle2 = s.headerSubtitle2;
    this.bannerText = s.bannerText;
    this.clusterBannerText = s.clusterBannerText ?? '';
    this.clusterBannerSelection = s.clusterBannerSelection ?? '';
    this.setCustomClusterBannerEnabled(s.customClusterBannerEnabled !== false);
    this.headerBackgroundColor = s.headerBackgroundColor;
    this.headerTextColor = s.headerTextColor;
    this.bannerBackgroundColor = s.bannerBackgroundColor;
    this.bannerTextColor = s.bannerTextColor;
    this.groupTextColor = s.groupTextColor;
    this.subGroupTextColor = s.subGroupTextColor;
    this.headerRowColor = s.headerRowColor;
    this.headerRowTextColor = s.headerRowTextColor;
    this.headerCellColors = { ...s.headerCellColors };
    this.headerCellTextColors = { ...s.headerCellTextColors };
    this.rowColors = { ...s.rowColors };
    this.rowColorsByKey = { ...(s.rowColorsByKey ?? {}) };
    this.summaryRowColors = { ...(s.summaryRowColors ?? {}) };
    this.summaryRowTextColors = { ...(s.summaryRowTextColors ?? {}) };
    this.rowTextColors = { ...s.rowTextColors };
    this.rowTextColorsByKey = { ...(s.rowTextColorsByKey ?? {}) };
    this.pageRowColors = { ...s.pageRowColors };
    this.cellColors = { ...s.cellColors };
    this.cellTextColors = { ...s.cellTextColors };
    this.columnGroupColors = structuredClone(s.columnGroupColors);
    this.subGroupColors = { ...(s.subGroupColors ?? {}) };
    this.groupColors = { ...(s.groupColors ?? {}) };
    this.groupTextColors = { ...(s.groupTextColors ?? {}) };
    this.subGroupTextColors = { ...(s.subGroupTextColors ?? {}) };
    this.pinnedColumns = [...s.pinnedColumns];
    this.dataBarColumns = [...(s.dataBarColumns ?? [])];
    this.leftLogoUrl = s.leftLogoUrl;
    this.rightLogoUrl = s.rightLogoUrl;
    this.rightLogoColor = s.rightLogoColor;
    this.fontFamily = s.fontFamily;
    this.fontSize = s.fontSize;
    this.headerFontSize = s.headerFontSize;
    this.bannerFontSize = s.bannerFontSize;
    this.tableHeadingFontSize = s.tableHeadingFontSize;
    this.gridHeaderHeight = s.gridHeaderHeight ?? 36;
    this.selectedThemeId = s.selectedThemeId;
    this.brandedRows = s.brandedRows;
    this.gridAccentColor = s.gridAccentColor;
    this.gridHeaderBg = s.headerRowColor || '#E8F0FC';
    this.mergedCellRanges = structuredClone(s.mergedCellRanges);
    this.rowLayout = structuredClone(s.rowLayout);
    this.manualRows = structuredClone(s.manualRows);
    this.cellOverrides = structuredClone(s.cellOverrides);
    this.deletedRowIndices = [...s.deletedRowIndices];
    this.cellEmbeds = structuredClone(s.cellEmbeds);
    this.cellOrientations = { ...s.cellOrientations };
    this.headerCellOrientations = { ...s.headerCellOrientations };
    this.cellAlignments = { ...(s.cellAlignments ?? {}) };
    this.headerCellAlignments = { ...(s.headerCellAlignments ?? {}) };
    this.reportAlignment = s.reportAlignment;
    this.groupHeaderAlignments = { ...(s.groupHeaderAlignments ?? {}) };
    this.subGroupHeaderAlignments = { ...(s.subGroupHeaderAlignments ?? {}) };
    this.cellBorders = { ...(s.cellBorders ?? {}) };
    this.headerCellBorders = { ...(s.headerCellBorders ?? {}) };
    this.reportBorder = s.reportBorder;
    this.rowNumberHeader = s.rowNumberHeader;
    this.viewMode = s.viewMode;
    this.gridRowHeight = s.gridRowHeight;
    this.columnSizingMode = s.columnSizingMode;
    this.gridPaginationPageSize = s.gridPaginationPageSize;
    this.nameValidationError = '';
    this.updateGridTheme();
  }

  /** Resets the builder to a clean slate for a brand-new sheet. Report name + category are
   *  report-level metadata (shared across sheets), so they carry over — a new sheet still
   *  saves under the same report name. */
  private resetBuilderForNewSheet(): void {
    this.columnKeyRenames = undefined;
    this.nameValidationError = '';
    this.dataSourceMode = 'table';
    this.selectedDataModelId = '';
    this.showDataModelDropdown = false;
    this.dataSourceSearch = '';
    this.viewSearch = '';
    this.resetSourceDependentState();
    this.headerTitle = '';
    this.headerSubtitle = '';
    this.headerSubtitle2 = '';
    this.bannerText = '';
    this.clusterBannerText = '';
    this.clusterBannerSelection = '';
    this.setCustomClusterBannerEnabled(true);
    this.headerBackgroundColor = 'linear-gradient(90.37deg, #162B6F 0%, #1B3585 30%, #21409A 58%, #2852B1 82%, #315FC2 100%)';
    this.headerTextColor = '#FFFFFF';
    this.bannerBackgroundColor = '#EDEFF4';
    this.bannerTextColor = '#344054';
    this.groupTextColor = '#FFFFFF';
    this.subGroupTextColor = '#FFFFFF';
    this.headerRowColor = '';
    this.headerRowTextColor = '';
    this.columnGroupColors = [
      { label: 'Group', level: 0, color: '#2563EB' },
      { label: 'Sub Group', level: 1, color: '#7C3AED' },
    ];
    this.leftLogoUrl = '';
    this.rightLogoUrl = '';
    this.rightLogoColor = '#111827';
    this.fontFamily = 'Inter';
    this.fontSize = 13;
    this.headerFontSize = 16;
    this.bannerFontSize = 12;
    this.tableHeadingFontSize = 12;
    this.gridHeaderHeight = 36;
    this.reportAlignment = undefined;
    this.groupHeaderAlignments = {};
    this.subGroupHeaderAlignments = {};
    this.reportBorder = undefined;
    this.rowNumberHeader = undefined;
    this.selectedThemeId = '';
    this.brandedRows = false;
    this.gridAccentColor = '#21409A';
    this.gridHeaderBg = '#E8F0FC';
    this.viewMode = 'comfortable';
    this.gridRowHeight = 42;
    this.columnSizingMode = 'auto';
    this.gridPaginationPageSize = 20;
    this.headerBannerExpanded = false;
    this.logosExpanded = false;
    this.colorThemeExpanded = false;
    this.typographyExpanded = false;
    this.updateGridTheme();
  }

  toggleLock(): void {
    this.locked = !this.locked;
  }

  showAiCompanion = true;

  dismissAiCompanion(): void {
    this.showAiCompanion = false;
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

  // ─── Resizable divider between the canvas and the report setup panel ──
  reportSetupWidth = 520;
  private readonly MIN_REPORT_SETUP_WIDTH = 360;
  private readonly MAX_REPORT_SETUP_WIDTH = 760;
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
    this.panelResizeStartWidth = this.reportSetupWidth;
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onPanelResizeMove(event: MouseEvent): void {
    if (!this.panelResizing) return;
    const delta = this.panelResizeStartX - event.clientX;
    this.reportSetupWidth = Math.min(
      this.MAX_REPORT_SETUP_WIDTH,
      Math.max(this.MIN_REPORT_SETUP_WIDTH, this.panelResizeStartWidth + delta)
    );
  }

  @HostListener('document:mouseup')
  onPanelResizeEnd(): void {
    this.panelResizing = false;
  }

  requestClearAll(): void {
    if (!this.selectedReportType && !this.selectedRawFields.length) return;
    this.showClearAllConfirm = true;
  }

  confirmClearAll(): void {
    this.selectedReportType = null;
    this.selectedRawFields = [];
    this.rawFieldSearch = '';
    this.metric = 'Count (F)';
    this.showTotals = false;
    this.sortBy = 'Name A-Z';
    this.limitCategory = 'all';
    this.columnFieldSearch = '';
    this.subtotalAfterGroup = false;
    this.grandTotalAtBottom = false;
    this.rowGroupFields = [];
    this.rowGroupAggs = {};
    this.rowGroupColors = {};
    this.rowGroupFieldSearch = '';
    this.initColumnFields();
    this.showClearAllConfirm = false;
    this.rebuildPreviewGrid();
    this.resetBuilderForNewSheet();
  }

  cancelClearAll(): void {
    this.showClearAllConfirm = false;
  }

  showDiscardConfirm = false;

  // Learn video modal
  @ViewChild('learnVideo') private learnVideoRef?: ElementRef<HTMLVideoElement>;
  showLearnModal = false;
  learnVideoUrl = 'assets/videos/dashboard-builder-overview.mp4';
  learnVideoPoster = 'assets/images/learn-video-poster.jpg';
  learnChapters: LearnChapter[] = [
    { id: 'add-widgets',  label: 'Add Widgets',   time: 0,   durationLabel: '1:20' },
    { id: 'charts-tile',  label: 'Charts & Tile', time: 80,  durationLabel: '1:20' },
    { id: 'use-filters',  label: 'Use Filters',   time: 160, durationLabel: '1:20' },
    { id: 'save-share',   label: 'Save & Share',  time: 240, durationLabel: '1:20' },
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
      id: 'report-source',
      question: 'How do I choose a data source?',
      expanded: false,
      steps: [
        'Open Source Details and choose Table or View, then select the data model for the report.',
        'The selected source supplies the fields used by column selection, grouping, filters, transformations, and calculations.',
        'Changing to a different source clears field selections and their dependent setup, including grouping, filters, transformations, calculations, and cell edits. The report name, category, and appearance are preserved.',
        'Selecting the same source again keeps its existing setup.',
      ],
    },
    {
      id: 'select-fields',
      question: 'How do I select report fields?',
      expanded: false,
      steps: [
        'In Column Selection, search for fields or filter the list to all, selected, or unselected columns.',
        'Tick the fields to use. The order you select them determines their nested order in the report.',
        'Use Select All or Deselect All to change the selection in one action.',
        'Deselecting a field also clears its dependent grouping, filters, transformations, and calculations. Reselecting it restores the field option only.',
      ],
    },
    {
      id: 'configure-columns',
      question: 'How do I configure columns?',
      expanded: false,
      steps: [
        'In Column Grouping, tick the selected fields you want displayed in the report.',
        'Enter the same Group name for columns that should sit under a shared heading; add a Sub group name to nest them further.',
        'Choose a total aggregation for supported columns. Use Clear All Grouping to remove column group and subgroup names.',
        'The preview updates as you change the column configuration.',
      ],
    },
    {
      id: 'group-rows-totals',
      question: 'How do I group report rows and show totals?',
      expanded: false,
      steps: [
        'In Row Grouping, select one or more fields to group the preview rows. Drag the group chips at the top of the grid to change their order.',
        'For numeric grouped fields, choose Sum or Average when you want an aggregation; choose No total to omit it.',
        'Use the Total section to enable subtotals after groups, a grand-total row at the bottom, or a totals row.',
        'You can also set a group-title row color for selected row-group fields.',
      ],
    },
    {
      id: 'calculated-columns',
      question: 'Can I add a calculated column?',
      expanded: false,
      steps: [
        'In Column Grouping, choose Add calculated column.',
        'Enter a column name, choose Column A and Column B from the selected fields, and select an operation such as addition, subtraction, multiplication, division, or percentage.',
        'Review the displayed formula, then choose Add Column. The calculation uses the selected fields and appears in the report preview.',
      ],
    },
    {
      id: 'global-filters',
      question: 'How do I apply global filters?',
      expanded: false,
      steps: [
        'Use the filter bar above the report preview to select available values such as Country, Sector, or Business Unit, and set the date range when shown.',
        'The preview refreshes with the selected global filters.',
        'Use Show Filter or Hide Filter to collapse or reopen the filter bar.',
      ],
    },
    {
      id: 'conditional-filters',
      question: 'How do conditional filters work?',
      expanded: false,
      steps: [
        'Open Conditional Filters and choose Add Filter.',
        'Choose a source column, condition, condition value, and mode to keep or exclude matching rows.',
        'Give the rule a name if needed. The preview reflects complete filter rules; a missing condition value or duplicate rule is flagged for correction.',
      ],
    },
    {
      id: 'data-transformations',
      question: 'What can I do in Data Transformation?',
      expanded: false,
      steps: [
        'Open Data Transformation and choose Add Parameter Filter, then select an action and its source column or columns.',
        'Available actions include changing a data type, renaming a column, replacing nulls, deduplicating rows, splitting or merging columns, cleaning text, extracting values, and applying a math operation.',
        'Fill in the required Rule Parameters for the selected action. An enabled rule with missing required parameters will not run and cannot be saved.',
        'Transformation rules are applied to the report data; remove or disable a rule when you no longer need it.',
      ],
    },
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
      id: 'extract-values',
      question: 'Can Extract Values use numeric columns?',
      expanded: false,
      steps: [
        'Choose Extract Values in Data Transformation and select a text or numeric column.',
        'Choose First N Chars, Last N Chars or Substring, then enter the length and start position if needed.',
        'Numeric values are read as text for extraction. For example, the first three characters of 123456 are "123".',
        'The extracted result is text. Use Change Data Type afterwards if you need a numeric result.',
        'A rule is considered repeated only when its action, source columns and rule parameters all match another rule.',
      ],
    },
    {
      id: 'saved-setups',
      question: 'How do I save or reuse a report setup?',
      expanded: false,
      steps: [
        'Use Save as Reusable Setup to store the report configuration for reuse.',
        'Open Use Saved Setup, select a saved setup, and review its configuration before applying it.',
        'A reusable setup covers the report field, grouping, total, filter, transformation, and DAX configuration. It does not replace the report name, category, or appearance.',
      ],
    },
    {
      id: 'report-appearance',
      question: 'How do I customize report appearance?',
      expanded: false,
      steps: [
        'Open the Appearance tab to configure optional presentation settings.',
        'Add header or footer text, choose logos, and adjust color theme and typography.',
        'Review the report preview as you make changes. Appearance settings are preserved when you change the data source.',
      ],
    },
    {
      id: 'save-report',
      question: 'How do I save, publish, or close the report?',
      expanded: false,
      steps: [
        'Enter the report name and description, then choose a category in the toolbar.',
        'Choose Save or Update to save a draft and remain in the builder. If available to you, choose Add Report to publish it.',
        'Choose Save & Close or Update & Close to save the draft and leave the builder. Choose Discard to leave without saving, and confirm if prompted.',
      ],
    },
    {
      id: 'clear-report-setup',
      question: 'What does Clear All do?',
      expanded: false,
      steps: [
        'Choose Clear All in the builder toolbar and confirm in the dialog.',
        'This resets the report type, data mapping, and display options. The action cannot be undone.',
      ],
    },
  ];

  get filteredHelpArticles(): HelpArticle[] {
    const term = this.helpSearchTerm.trim().toLowerCase();
    if (!term) return this.helpArticles;
    return this.helpArticles.filter(a =>
      `${a.question} ${a.steps.join(' ')}`.toLowerCase().includes(term),
    );
  }

  onHelpSearchChange(): void {
    const firstMatch = this.filteredHelpArticles[0];
    this.helpArticles.forEach(article => (article.expanded = article === firstMatch));
  }

  clearHelpSearch(): void {
    this.helpSearchTerm = '';
    this.helpArticles.forEach(article => (article.expanded = false));
  }

  discard(): void {
    this.showDiscardConfirm = true;
  }

  confirmDiscard(): void {
    this.showDiscardConfirm = false;
    this.router.navigateByUrl(this.returnUrl);
  }

  cancelDiscard(): void {
    this.showDiscardConfirm = false;
  }

  saveAndClose(): void {
    //this.savingStatus = this.editingReportId !== null ? 'updated' : 'saved';
    this.saveReport('draft', true);
  }

  saveAsDraft(): void {
    this.saveReport('draft');
  }

  addReport(): void {
    if (!this.isAdmin) return;
    this.savingStatus = 'published';
    this.saveReport('published');
  }

  private persistTemplate(customName: string): void {
    const { sourceName, type } = this.currentSource();
    if (!sourceName) return;
    const source = this.availableSources.find(s => s.name.toLowerCase() === this.selectedDataModelId.toLowerCase());
    const sourceType = this.dataSourceMode === 'view' ? 'View' : (source?.sourceType ?? 'Table');
    const viewId = this.dataSourceMode === 'view' ? (this.selectedView?.id ?? 0) : 0;
    const templateJson = this.buildReportJson();
    this.reusableSetupSaving = true;
    this.subs.push(this.reportTemplates.save({ customName, sourceName, sourceType, templateJson, type, viewId }).subscribe({
      next: () => {
        this.customSetupName = customName;
        this.templateBaselineJson = templateJson;
        this.reusableSetupSaving = false;
        this.showSavedSetupModal = false;
        this.showReusableSetupSaved();
        this.cdr.markForCheck();
      },
      error: () => {
        this.reusableSetupSaving = false;
        this.notify.showError('Failed to save the template.');
        this.cdr.markForCheck();
      },
    }));
  }

  private buildReportJson(): string {
    return JSON.stringify(this.buildTemplateConfig());
  }

  /**
   * Minimal template payload: carries only the columns/cells/rows the user actually styled
   * (bg color, text color, text orientation) plus grouping and conditional-formatting rules.
   * Empty/default styling is omitted so the saved reportJson stays small.
   */
  private buildTemplateConfig(): Record<string, unknown> {
    this.syncColumnKeysWithRenames();
    const cfg: Record<string, unknown> = {};
    const nonEmpty = (o: Record<string, unknown> | null | undefined) => !!o && Object.keys(o).length > 0;
    const liveColumns = this.buildLiveConfig().columns ?? [];

    // Preserve every selected field so a saved setup can restore its accordion selections.
    const columns = this.selectedRawFields
      .map(field => {
        const cc = this.columnConfigs[field];
        const entry: Record<string, unknown> = { field, shown: this.columnFields.includes(field) };
        if (cc?.header?.trim()) entry['header'] = cc.header.trim();
        if (cc?.color) entry['color'] = cc.color;
        if (cc?.textColor) entry['textColor'] = cc.textColor;
        if (cc?.group) entry['group'] = cc.group;
        if (cc?.subGroup) entry['subGroup'] = cc.subGroup;
        if (cc?.total) entry['total'] = cc.total;
        // Manually-inserted (custom) columns don't exist in the data source, so the flag is the
        // only thing that lets a re-applied setup recreate them along with their header/grouping.
        if (cc?.custom) entry['custom'] = true;
        const gi = liveColumns.find(column => column.field === field)?.rowGroupIndex ?? -1;
        if (gi >= 0) { entry['rowGroup'] = true; entry['rowGroupIndex'] = gi; }
        if (this.rowGroupAggs[field]) entry['aggFunc'] = this.rowGroupAggs[field];
        if (this.rowGroupColors[field]) entry['rowGroupColor'] = this.rowGroupColors[field];
        return entry;
      });
    if (columns.length) cfg['columns'] = columns;

    // Section 5 (Total) toggles — the per-column Sum/Avg/Count rows only render when showTotals is on.
    if (this.showTotals) cfg['showTotals'] = true;
    if (this.subtotalAfterGroup) cfg['subtotalAfterGroup'] = true;
    if (this.grandTotalAtBottom) cfg['grandTotalAtBottom'] = true;

    if (this.headerRowColor) cfg['headerRowColor'] = this.headerRowColor;
    if (this.headerRowTextColor) cfg['headerRowTextColor'] = this.headerRowTextColor;
    if (nonEmpty(this.headerCellColors)) cfg['headerCellColors'] = this.headerCellColors;
    if (nonEmpty(this.headerCellTextColors)) cfg['headerCellTextColors'] = this.headerCellTextColors;
    if (nonEmpty(this.headerCellOrientations)) cfg['headerCellOrientations'] = this.headerCellOrientations;
    if (nonEmpty(this.cellAlignments)) cfg['cellAlignments'] = this.cellAlignments;
    if (nonEmpty(this.headerCellAlignments)) cfg['headerCellAlignments'] = this.headerCellAlignments;
    if (this.reportAlignment) cfg['reportAlignment'] = this.reportAlignment;
    if (nonEmpty(this.cellBorders)) cfg['cellBorders'] = this.cellBorders;
    if (nonEmpty(this.headerCellBorders)) cfg['headerCellBorders'] = this.headerCellBorders;
    if (this.reportBorder) cfg['reportBorder'] = this.reportBorder;
    if (this.rowNumberHeader?.trim()) cfg['rowNumberHeader'] = this.rowNumberHeader.trim();
    if (this.selectedThemeId) cfg['themeId'] = this.selectedThemeId;
    if (this.gridAccentColor && this.gridAccentColor !== '#21409A') cfg['themeAccent'] = this.gridAccentColor;
    if (this.brandedRows) cfg['brandedRows'] = true;
    if (nonEmpty(this.cellColors)) cfg['cellColors'] = this.cellColors;
    if (nonEmpty(this.cellTextColors)) cfg['cellTextColors'] = this.cellTextColors;
    if (nonEmpty(this.cellOrientations)) cfg['cellOrientations'] = this.cellOrientations;
    if (nonEmpty(this.rowColors)) cfg['rowColors'] = this.rowColors;
    if (nonEmpty(this.rowColorsByKey)) cfg['rowColorsByKey'] = this.rowColorsByKey;
    if (nonEmpty(this.summaryRowColors)) cfg['summaryRowColors'] = this.summaryRowColors;
    if (nonEmpty(this.summaryRowTextColors)) cfg['summaryRowTextColors'] = this.summaryRowTextColors;
    if (nonEmpty(this.rowTextColors)) cfg['rowTextColors'] = this.rowTextColors;
    if (nonEmpty(this.rowTextColorsByKey)) cfg['rowTextColorsByKey'] = this.rowTextColorsByKey;
    if (nonEmpty(this.pageRowColors)) cfg['pageRowColors'] = this.pageRowColors;

    const hasGrouping = columns.some(c => c['group'] || c['subGroup']);
    if (hasGrouping && this.columnGroupColors?.length) cfg['columnGroupColors'] = this.columnGroupColors;
    if (hasGrouping && Object.keys(this.subGroupColors).length) cfg['subGroupColors'] = this.subGroupColors;
    if (hasGrouping && Object.keys(this.groupColors).length) cfg['groupColors'] = this.groupColors;
    if (hasGrouping && Object.keys(this.groupTextColors).length) cfg['groupTextColors'] = this.groupTextColors;
    if (hasGrouping && Object.keys(this.subGroupTextColors).length) cfg['subGroupTextColors'] = this.subGroupTextColors;
    if (hasGrouping && nonEmpty(this.groupHeaderAlignments)) cfg['groupHeaderAlignments'] = this.groupHeaderAlignments;
    if (hasGrouping && nonEmpty(this.subGroupHeaderAlignments)) cfg['subGroupHeaderAlignments'] = this.subGroupHeaderAlignments;
    if (this.groupTextColor && this.groupTextColor !== '#FFFFFF') cfg['groupTextColor'] = this.groupTextColor;
    if (this.subGroupTextColor && this.subGroupTextColor !== '#FFFFFF') cfg['subGroupTextColor'] = this.subGroupTextColor;

    if (this.conditionalRules?.length) cfg['conditionalRules'] = this.conditionalRules;

    if (this.daxModel?.enabled && this.daxModel.measures?.some(m => m.expression?.trim())) cfg['daxModel'] = this.daxModel;
    if (this.legendItems.length) cfg['legends'] = this.legendItems;

    if (this.conditionalFilters?.length) cfg['conditionalFilters'] = this.conditionalFilters;

    if (this.parameterFilters?.length) cfg['parameterFilters'] = this.parameterFilters;

    // Key column formatting by source column so the setup follows any target report's renames.
    const toSource = columnKeyRenamer(this.columnKeyRenames ?? this.currentColumnRenames(), new Map());
    return { ...renameReportColumnKeys(cfg as ReportColumnKeyedSettings, toSource), columnKeyBasis: 'source' };
  }

  // get source information for the current report
  private currentSource(): { sourceName: string; type: string } {
    const source = this.availableSources.find(s => s.name.toLowerCase() === this.selectedDataModelId.toLowerCase());
    // const sourceType = this.dataSourceMode === 'view' ? 'View' : (source?.sourceType ?? 'Table');
    const sourceType = "Report";
    const sourceName = this.dataSourceMode === 'view'
      ? (this.selectedView?.viewName ?? this.selectedDataModelId)
      : (source?.name ?? this.selectedDataModelId);
    return { sourceName, type: sourceType };
  }

  /** Shared validation + resolution for save operations. Returns null on validation failure. */
  private validateAndResolve(): { categoryId: number; sourceName: string; sourceType: string; reportJson: string } | null {
    if (!this.reportName || this.reportName.trim() === '' || this.reportName === 'Report Name') {
      this.nameValidationError = 'Enter the report name to save';
      return null;
    }

    const cat = this.apiCategories.find(c => c.categoryName === this.category);
    const categoryId = this.selectedCategoryId || cat?.categoryId || 0;

    if (!categoryId) {
      this.nameValidationError = 'Select a category to save';
      return null;
    }

    if (!this.reportDescription.trim()) {
      this.descriptionValidationError = 'Enter a description to save';
      return null;
    }

    if (this.hasInvalidParameterFilters) {
      this.dataTransformExpanded = true;
      this.notify.showError(this.parameterFilters.some(rule => this.paramFilterMissingSource(rule))
        ? 'Source Column is required for enabled Data Transformation rules.'
        : getParameterSelectionError(this.parameterFilters) ?? 'Select the required rule parameters.');
      return null;
    }

    if (this.hasInvalidConditionalFilters) {
      // Every Conditional Filter must have a Condition Value before the report can be saved.
      this.conditionalFiltersSectionExpanded = true;
      this.notify.showError('Condition Value is required for all Conditional Filters.');
      return null;
    }

    if (this.hasDuplicateConditionalFilters) {
      // Two Conditional Filters can't share the same Source Column, Condition, Value and Mode.
      this.conditionalFiltersSectionExpanded = true;
      this.notify.showError('Duplicate Conditional Filters are not allowed. Please remove or edit the duplicates.');
      return null;
    }

    if (this.hasDuplicateParameterFilters) {
      this.dataTransformExpanded = true;
      this.notify.showError('The same Data Transformation action, source columns, and rule parameters cannot be repeated. Remove the repeated rule or change one of those settings.');
      return null;
    }

    if (this.hasDuplicateDaxMeasures) {
      // Two DAX measures can't be exact duplicates.
      this.daxModelSectionExpanded = true;
      this.notify.showError('Duplicate DAX measures are not allowed. Please remove or edit the duplicates.');
      return null;
    }

    if (this.hasDuplicateConditionalRules) {
      // Two Conditional Formatting rules can't be exact duplicates.
      this.notify.showError('Duplicate Conditional Formatting rules are not allowed. Please remove or edit the duplicates.');
      return null;
    }

    this.nameValidationError = '';
    // Persist every sheet in one report record. The primary (first) sheet's source + config
    // become the top-level fields so single-page readers still render page 1; the full
    // `sheets` array drives the multi-page viewer.
    const sheets = this.buildAllSheets();
    const incompleteLegendSheet = sheets.find(sheet =>
      (sheet.config.legends ?? []).some(legend =>
        !legend
        || typeof legend.label !== 'string'
        || !legend.label.trim()
        || typeof legend.color !== 'string'
        || !/^#[0-9a-fA-F]{6}$/.test(legend.color),
      ),
    );
    if (incompleteLegendSheet) {
      this.legendsSectionExpanded = true;
      this.notify.showError(`Complete or remove every legend entry in "${incompleteLegendSheet.name}" before saving.`);
      return null;
    }
    const missingParameterSheet = sheets.map(sheet => ({
      sheet, error: getParameterSelectionError(sheet.config.parameterFilters ?? []),
    })).find(item => item.error);
    if (missingParameterSheet) {
      this.notify.showError(`${missingParameterSheet.error} Check "${missingParameterSheet.sheet.name}".`);
      return null;
    }
    const duplicateSheet = sheets.find(sheet => {
      const rules = sheet.config.parameterFilters ?? [];
      return rules.some(rule => this.isDuplicateParameterFilter(rule, rules));
    });
    if (duplicateSheet) {
      this.notify.showError(`Repeated Data Transformation rules exist in "${duplicateSheet.name}". The action, source columns, and rule parameters must not all match.`);
      return null;
    }
    const primary = sheets[0];
    const reportJson = JSON.stringify({ ...primary.config, sheets });
    return {
      categoryId,
      sourceName: primary.sourceName,
      sourceType: primary.sourceType,
      reportJson,
    };
  }

  private saveReport(status: string, closeAfterSave = false): void {
    if (this.isSaving) return;

    const resolved = this.validateAndResolve();
    if (!resolved) return;

    const { categoryId, sourceName, sourceType, reportJson } = resolved;
    
    this.savingStatus = this.editingReportId !== null ? 'updated' : 'saved';
    this.isSaving = true;
    const save$ = this.editingReportId
      ? this.tenantReports.update(this.editingReportId, { reportName: this.reportName, description: this.reportDescription, categoryId, sourceName, sourceType, reportJson, status })
      : this.tenantReports.create({ reportName: this.reportName, description: this.reportDescription, categoryId, sourceName, sourceType, reportJson }).pipe(
        switchMap(created => status === 'published'
          ? this.tenantReports.update(created.id, { reportName: this.reportName, description: this.reportDescription, categoryId, sourceName, sourceType, reportJson, status })
          : of(created),
        ),
      );

    this.subs.push(save$.subscribe({
      next: (savedReport) => {
        this.isSaving = false;
        this.nameValidationError = '';
        this.descriptionValidationError = '';
        //const message = this.savingStatus == 'updating' ? ` is updated` : ` is saved `;
        // Show success message
        this.notify.showSuccess(status === 'published'
          ? `'${this.reportName}' is saved and published successfully.`
          : `'${this.reportName}' is ${this.savingStatus.toLowerCase()} successfully.`);
        this.cdr.detectChanges();
        // Drop the cached WIP/standard reports list so it shows this report without a manual refresh.
        this.listRouteReuse.invalidate('my-reports');
        this.listRouteReuse.invalidate('standard-reports');
        const savedReportId = this.editingReportId ?? savedReport?.id;
        if (closeAfterSave && savedReportId) {
          let msg: string;
          if (this.editingReportId) msg = `'${this.reportName}' updated successfully.`;
          else msg = `'${this.reportName}' saved successfully.`;
          this.toastService.pending = msg;
          this.router.navigate(['/reports/view', savedReportId], { queryParams: { from: 'wip' } });
        } else if (status === 'draft') {
          if (closeAfterSave) {
            //Navigating to report url
            this.router.navigateByUrl(this.returnUrl);
          } else {
            //Staying on the current page after saving draft.
            this.editingReportId = savedReportId;
          }
        }
      },
      error: (err) => {
        this.isSaving = false;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to save report.');
        this.cdr.detectChanges();
      },
    }));
  }

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
    this.helpSearchTerm = '';
    this.helpVote = null;
    this.helpArticles.forEach(article => (article.expanded = false));
    this.showHelpModal = true;
  }

  closeHelpModal(): void {
    this.showHelpModal = false;
    this.helpSearchTerm = '';
    this.helpVote = null;
    this.helpArticles.forEach(article => (article.expanded = false));
  }

  toggleHelpArticle(article: HelpArticle): void {
    const shouldExpand = !article.expanded;
    this.helpArticles.forEach(a => (a.expanded = a.id === article.id && shouldExpand));
  }

  setHelpVote(vote: 'yes' | 'no'): void {
    this.helpVote = vote;
  }
}

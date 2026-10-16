import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, NgZone, HostListener } from '@angular/core';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, switchMap, of, map, Subject, firstValueFrom } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { TenantReportsService, TenantReportDto } from '../../../core/services/tenant-reports.service';
import { CommonApiService, PlantFilterDto, TableDataDto } from '../../../core/services/common-api.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SCHEDULES_MODULE } from '../../../core/services/schedule.service';
import {
  ExcelExportModule,
  RowGroupingModule,
  RowGroupingPanelModule,
  GroupFilterModule,
  AggregationModule,
  PivotModule,
  SetFilterModule,
  MultiFilterModule,
  ClipboardModule,
  CellSelectionModule,
  StatusBarModule,
  SideBarModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  MenuModule,
  MasterDetailModule,
  RichSelectModule,
  TreeDataModule,
  SparklinesModule,
  IntegratedChartsModule,
  FindModule,
} from 'ag-grid-enterprise';
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { PinHeaderComponent } from './pin-header.component';
import { EmbeddedCellComponent } from '../report-builder/embedded-cell.component';
import { AdvancedFilterComponent } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { ReportJsonConfig, ReportSheetConfig, TableDensity } from '../shared/report-config.model';
import { buildReportGridColumns, computeTotalsRows, computeGrandTotalRow, TOTALS_LABEL_FIELD, isBooleanColumn, isDateColumn, isNumericColumn, isSerialNumberField, reconcileRowLayout, materializeRows, REPORT_AGG_FUNCS, hasRowMerges, evaluateConditionalRules, VERTICAL_CELL_ROW_HEIGHT, rowHasVerticalCell } from '../shared/report-grid-columns.util';
import { evaluateDaxMeasure, evaluateDaxMeasureForRow, formatDaxValue } from '../../../core/utils/dax-evaluator.util';
import { applyConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { applyParameterFilters } from '../../../core/utils/parameter-filter.util';
import type { DaxMeasureConfig } from '../../../core/utils/dax-evaluator.util';
import { ReportExportColorService, ExportCellColorSource } from '../shared/report-export-color.service';
import { positionReportPaginationPopup } from '../shared/report-grid-popup.util';
import { filterReportMonthColumns, formatReportPeriod, previewReportView } from '../shared/report-view-filter.util';
import { getReportGridPageSize } from '../shared/report-grid-lifecycle.util';
import {
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  ColDef,
  ColGroupDef,
  ModuleRegistry,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ColumnAutoSizeModule,
  ColumnHoverModule,
  ColumnApiModule,
  CsvExportModule,
  QuickFilterModule,
  RowSelectionModule,
  RowDragModule,
  TooltipModule,
  PinnedRowModule,
  CellStyleModule,
  RowStyleModule,
  GridStateModule,
  TextEditorModule,
  NumberEditorModule,
  DateEditorModule,
  CustomFilterModule,
  DragAndDropModule,
  HighlightChangesModule,
  UndoRedoEditModule,
  ValidationModule,
  RowAutoHeightModule,
  LargeTextEditorModule,
  SelectEditorModule,
  CheckboxEditorModule,
  CellSpanModule,
  themeQuartz,
  GridReadyEvent,
  GridApi,
  GridOptions,
  ColumnRowGroupChangedEvent,
  FirstDataRenderedEvent,
  ProcessCellForExportParams,
  CsvExportParams,
  RowSelectionOptions,
  CellContextMenuEvent,
  ICellRendererParams,
  RowClassParams,
  RowHeightParams,
  CellClassParams,
  ExcelStyle,
} from 'ag-grid-community';
import { ToastService } from '../../../core/services/toast.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';

ModuleRegistry.registerModules([
  // Community modules
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ColumnAutoSizeModule,
  ColumnHoverModule,
  ColumnApiModule,
  CsvExportModule,
  QuickFilterModule,
  RowSelectionModule,
  RowDragModule,
  TooltipModule,
  PinnedRowModule,
  CellStyleModule,
  RowStyleModule,
  GridStateModule,
  TextEditorModule,
  NumberEditorModule,
  DateEditorModule,
  CustomFilterModule,
  DragAndDropModule,
  HighlightChangesModule,
  UndoRedoEditModule,
  ValidationModule,
  RowAutoHeightModule,
  LargeTextEditorModule,
  SelectEditorModule,
  CheckboxEditorModule,
  CellSpanModule,
  // Enterprise modules
  ExcelExportModule,
  RowGroupingModule,
  RowGroupingPanelModule,
  GroupFilterModule,
  AggregationModule,
  PivotModule,
  SetFilterModule,
  MultiFilterModule,
  ClipboardModule,
  CellSelectionModule,
  StatusBarModule,
  SideBarModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  MenuModule,
  MasterDetailModule,
  RichSelectModule,
  TreeDataModule,
  SparklinesModule.with(AgChartsEnterpriseModule),
  IntegratedChartsModule.with(AgChartsEnterpriseModule),
  FindModule,
]);

interface KpiCard {
  label: string;
  value: string;
  hint: string;
  accent: 'blue' | 'purple' | 'red' | 'green';
}

type ReportTab = 'all' | 'grouped' | 'weekly';
@Component({
  selector: 'app-report-viewer',
  standalone: false,
  templateUrl: './report-viewer.component.html',
  styleUrls: ['./report-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportViewerComponent implements OnInit, OnDestroy, AfterViewInit {
  report: TenantReportDto | null = null;
  isPublishing = false;
  config: ReportJsonConfig | null = null;
  isLoading = true;
  error = '';

  //  Excel-like multi-page reports
  //  // Populated from config.sheets when a report has >1 page; each entry carries its own
  // source + config. Switching a tab reloads that page through the normal render pipeline.
  sheets: ReportSheetConfig[] = [];
  activeSheetIndex = 0;
  get hasMultipleSheets(): boolean { return this.sheets.length > 1; }
  private viewDestroyed = false;

  // ─── AG Grid ──────────────────────────────────────────────────────────────
  gridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    backgroundColor: '#ffffff',
    borderColor: '#E2E7EF',
    borderRadius: 8,
    fontFamily: 'Inter, sans-serif',
    headerBackgroundColor: '#E8F0FC',
    headerTextColor: '#344054',
    headerFontWeight: 700,
    rowHoverColor: '#F0F4FF',
    selectedRowBackgroundColor: '#F5F8FF',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
    headerRowBorder: false,
  });
  gridColumnDefs: (ColDef | ColGroupDef)[] = [];
  gridDefaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 100,
    editable: true,
    enableCellChangeFlash: true,
    enableRowGroup: true,
    enablePivot: true,
    enableValue: true,
    headerComponent: PinHeaderComponent,
    headerComponentParams: {
      onPinToggle: (field: string, pin: boolean) => this.onHeaderPinToggle(field, pin),
    },
    tooltip: (params) => params.value != null ? String(params.value) : '',
    filterParams: { buttons: ['reset', 'apply'], closeOnApply: true },
    // Tags each body cell/header with color-derived class ids so AG Grid's native Excel export paints it (see gridExcelStyles).
    cellClass: (params) => this.exportCellClass(params),
    headerClass: (params) => this.exportHeaderClass(params.column?.getColDef().field),
  };
  // Excel-export style registry, rebuilt from the saved report config so a native Excel export matches the preview.
  gridExcelStyles: ExcelStyle[] = [];
  gridPagination = true;
  gridPaginationPageSize = 20;
  gridPaginationPageSizeSelector = [10, 20, 50, 100];
  gridRowHeight = 42;
  /** Column-header row height (px), from the saved report config; default matches the builder. */
  gridHeaderHeight = 36;
  // Popups (context menu, its Export submenu, column menu) render into <body> instead of the grid's
  // own clipped/scrollable container, so they're never cut off at its edges.
  gridPopupParent: HTMLElement = document.body;
  readonly postProcessGridPopup = positionReportPaginationPopup;
  readonly postProcessExpandGridPopup: GridOptions['postProcessPopup'] = params => {
    positionReportPaginationPopup(params);
    params.ePopup.style.zIndex = '901';
  };
  gridQuickFilterText = '';
  readonly gridRowSelection: RowSelectionOptions = {
    mode: 'multiRow',
    checkboxes: false,
    headerCheckbox: false,
  };
  gridPinnedBottomRowData: Record<string, unknown>[] = [];
  /** Marks the appended totals row so exports render a "Total" label instead of a serial number. */
  private readonly TOTALS_ROW_FLAG = '__isTotalsRow';
  /** Optional label shown in the Sl.No column for a totals/subtotal/grand-total export row. */
  private readonly TOTALS_LABEL_KEY = '__totalsLabel';

  /** Subtotal, grand-total and pinned total rows render bold + 2pt larger than body rows. */
  getRowClass = (params: RowClassParams): string =>
    params.node.footer || params.node.rowPinned === 'bottom' ? 'report-total-row' : '';

  /** Paints a group title row with the color saved for its grouping field. */
  getRowStyle = (params: RowClassParams): Record<string, string> | undefined => {
    const node = params.node;
    // Footer / pinned totals rows (Sum/Average/Total/DAX measures) keep a fixed size (set in the
    // .report-total-row rule) — they intentionally do NOT follow the "Footer Font Size" setting,
    // which only sizes the text banner.
    if (node?.footer || node?.rowPinned === 'bottom') {
      return undefined;
    }
    if (node?.group && !node.footer && typeof node.field === 'string') {
      const bg = this.config?.columns?.find(c => c.field === node.field)?.rowGroupColor;
      if (bg) return { background: bg };
    }
    return undefined;
  };

  // Rows containing a vertical-orientation cell get an explicit tall height so the rotated
  // text can wrap into multiple columns (AG's autoHeight can't measure rotated content).
  getRowHeight = (params: RowHeightParams): number | undefined => {
    if (!params.node?.rowPinned && !params.node?.group && !params.node?.footer
      && rowHasVerticalCell(this.config?.cellOrientations, params.node?.rowIndex)) {
      return VERTICAL_CELL_ROW_HEIGHT;
    }
    return this.gridRowHeight;
  };

  // Total/grand-total footer label reflects the grouped column's aggregation (Average/Sum),
  // falling back to "Total" when none is set.
  gridAutoGroupColumnDef: ColDef = {
    minWidth: 180,
    tooltip: (params) => (params.value != null ? String(params.value) : ''),
    // The auto group column isn't built by the shared util, so mirror its row-color lookup
    // here — otherwise a row color applied to a group row skips the group cell (e.g. "84 (7)").
    //color auto-groped cell too
    cellStyle: (params) => {
      const rowIndex = params.node?.rowIndex;
      if (params.node?.rowPinned || rowIndex == null || rowIndex < 0) return null;
      const bg = this.config?.pageRowColors?.[rowIndex] ?? this.config?.rowColors?.[rowIndex];
      const fg = this.config?.rowTextColors?.[rowIndex];
      if (!bg && !fg) return null;
      return { ...(bg ? { backgroundColor: bg } : {}), ...(fg ? { color: fg } : {}) };
    },
    cellRendererParams: {
      footerValueGetter: (params: { colDef?: { showRowGroup?: boolean | string }; value?: unknown }) => {
        const field = typeof params?.colDef?.showRowGroup === 'string' ? params.colDef.showRowGroup : undefined;
        const agg = field ? this.config?.columns?.find(c => c.field === field)?.aggFunc : undefined;
        const label = agg === 'avg' ? 'Avg' : agg === 'sum' ? 'Sum' : 'Total';
        const val = params?.value != null ? params.value : '';
        return `${label} ${val}`.trim();
      },
    },
  };

  // Enterprise feature configs
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
  gridStatusBar = {
    statusPanels: [
      { statusPanel: 'agAggregationComponent', align: 'right' as const },
    ],
  };
  gridGroupDefaultExpanded = 0;
  // Row grouping is managed only via the right panel; hide AG Grid's drag-to-group bar.
  gridRowGroupPanelShow: 'always' | 'onlyWhenGrouping' | 'never' = 'never';
  // Numeric-coercing sum/avg so string data aggregates correctly (see REPORT_AGG_FUNCS).
  readonly gridAggFuncs = REPORT_AGG_FUNCS;

  /** Per-group subtotal row when the report enables it. */
  get groupTotalRow(): 'bottom' | undefined {
    return this.config?.subtotalAfterGroup ? 'bottom' : undefined;
  }

  /** enableCellSpan is only on for reports with a ROW merge — always-on span positioning breaks
   *  the pinned totals rows. The viewer grid recreates on sheet switch (*ngIf), so a getter is safe. */
  get gridEnableCellSpan(): boolean {
    return hasRowMerges(this.config?.mergedCellRanges);
  }

  /** True when any column is configured as a row group. */
  private get hasRowGrouping(): boolean {
    return (this.config?.columns ?? []).some(c => c.rowGroup);
  }

  /** The grand total is always a controlled pinned row (contiguous with the Sum/Average rows).
   *  AG Grid's native footer floats at the viewport bottom, detaching it from the totals block. */
  get grandTotalRow(): 'bottom' | undefined {
    return undefined;
  }

  private activeGridApi: GridApi | null = null;

  private get gridApi(): GridApi | null {
    return this.activeGridApi && !this.activeGridApi.isDestroyed() ? this.activeGridApi : null;
  }

  readonly gridOptions: GridOptions = {
    onGridPreDestroyed: event => {
      if (this.activeGridApi === event.api) this.activeGridApi = null;
    },
  };

  /** Expanded-table modal state and its own grid API (mirrors the report-builder expand modal). */
  showExpandModal = false;
  private expandGridApi: GridApi | null = null;

  /** The expand-modal grid API only while it's alive — null once destroyed so deferred calls no-op. */
  private get liveExpandGridApi(): GridApi | null {
    return this.expandGridApi && !this.expandGridApi.isDestroyed() ? this.expandGridApi : null;
  }

  readonly expandGridOptions: GridOptions = {
    onGridPreDestroyed: event => {
      if (this.expandGridApi === event.api) this.expandGridApi = null;
    },
  };

  onGridReady(params: GridReadyEvent): void {
    this.activeGridApi = params.api;
    this.buildGridColumns();
    this.autoSizeAllColumns();
  }

  onFirstDataRendered(params: FirstDataRenderedEvent): void {
    if (params.api.isDestroyed()) return;
    params.api.autoSizeAllColumns();
    this.computePinnedBottomRow();
  }

  onColumnRowGroupChanged(event: ColumnRowGroupChangedEvent): void {
    if (event.api.isDestroyed()) return;
    event.api.collapseAll();
  }

  /** Opens the report table in a full-viewport modal with the banner and grid tool panels. */
  expandGrid(): void {
    this.showExpandModal = true;
    this.cdr.markForCheck();
  }

  /** Grabs the modal grid's API; column sizing happens on first data render. */
  onExpandGridReady(params: GridReadyEvent): void {
    this.expandGridApi = params.api;
  }

  /** Size columns to their content so all text shows fully (overflow → horizontal scroll). */
  onExpandFirstDataRendered(params: FirstDataRenderedEvent): void {
    if (params.api.isDestroyed()) return;
    params.api.autoSizeAllColumns();
  }

  /** Closes the modal and persists its column widths/order back to the main grid. */
  closeExpandModal(): void {
    const state = this.liveExpandGridApi?.getColumnState();
    this.showExpandModal = false;
    this.expandGridApi = null;
    if (state?.length) {
      // Apply after the modal grid tears down and the main grid is on screen again.
      setTimeout(() => this.gridApi?.applyColumnState({ state, applyOrder: true }), 0);
    }
    this.cdr.markForCheck();
  }

  private isNumericColumn(field: string): boolean {
    return isNumericColumn(this.allRows, field);
  }

  private isDateColumn(field: string): boolean {
    return isDateColumn(this.allRows, field);
  }

  private isBooleanColumn(field: string): boolean {
    return isBooleanColumn(this.allRows, field);
  }

  private computePinnedBottomRow(): void {
    const columnMeasures = this.daxColumnMeasures(this.config);
    const wantTotals = !!this.config?.showTotals && this.allRows.length > 0 && this.displayColumns.length > 0;
    const wantGrand = !!this.config?.grandTotalAtBottom && this.allRows.length > 0 && this.displayColumns.length > 0;
    if (!wantTotals && !wantGrand && !columnMeasures.length) {
      this.gridPinnedBottomRowData = [];
      return;
    }
    const pinned: Record<string, unknown>[] = [];
    if (wantTotals) {
      // Only columns with a Total selected: Sum-columns in the Sum row, Average-columns in the Average row.
      pinned.push(...computeTotalsRows(this.config, this.allRows, this.displayColumns));
    }
    // The grand total is a controlled pinned "Total" row so it sits contiguous with the Sum/Average rows.
    if (wantGrand) {
      const grand = computeGrandTotalRow(this.config, this.allRows, this.displayColumns);
      if (grand) pinned.push(grand);
    }
    // Each column-scope measure is a summary row: name on the left, value at the far right.
    const firstCol = this.displayColumns[0];
    const lastCol = this.displayColumns[this.displayColumns.length - 1];
    if (firstCol) {
      for (const m of columnMeasures) {
        pinned.push(firstCol === lastCol
          ? { [firstCol]: this.daxSummaryLabel(m, this.allRows, this.displayColumns) }
          : { [firstCol]: m.name?.trim() || 'New Metric', [lastCol]: this.daxSummaryValue(m, this.allRows, this.displayColumns) });
      }
    }
    this.gridPinnedBottomRowData = pinned;
  }

  private buildGridColumns(): void {
    this.gridColumnDefs = this.decorateEmbeddedCells(
      buildReportGridColumns(() => this.config, this.visibleColumns, this.allRows, this.sourceData?.columnTypes),
    );
    this.computePinnedBottomRow();
    this.cdr.markForCheck();
    setTimeout(() => this.autoSizeAllColumns(), 50);
  }

  /** Renders cells that have a saved embed config as a read-only sub-grid; others keep their base renderer. */
  private decorateEmbeddedCells(defs: (ColDef | ColGroupDef)[]): (ColDef | ColGroupDef)[] {
    const embeds = this.config?.cellEmbeds;
    if (!embeds || !Object.keys(embeds).length) return defs;
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
          const embed = embeds[`${params.node?.rowIndex}:${field}`];
          if (embed) {
            return {
              component: EmbeddedCellComponent,
              params: { rows: embed.rows, cols: embed.cols, values: embed.values ?? {}, editable: false },
            };
          }
          return baseRenderer ? { component: baseRenderer } : undefined;
        },
      };
    };
    return defs.map(decorate);
  }

  exportCsv(): void {
    if (!this.gridApi) return;
    const params: CsvExportParams = {
      fileName: `${this.report?.reportName || 'report'}.csv`,
      processCellCallback: (p: ProcessCellForExportParams) => p.value != null ? String(p.value) : '',
    };
    this.gridApi.exportDataAsCsv(params);
  }

  exportExcelGrid(): void {
    if (!this.gridApi) return;
    this.gridApi.exportDataAsExcel({
      fileName: `${this.report?.reportName || 'report'}.xlsx`,
      sheetName: 'Report',
    });
  }

  autoSizeAllColumns(): void {
    this.gridApi?.autoSizeAllColumns();
    this.columnSizingMode = 'auto';
    this.cdr.markForCheck();
  }

  sizeColumnsToFit(): void {
    // Enforce a readable minimum so columns aren't squished below the width their wrapped
    // header text needs — when the total exceeds the viewport, AG Grid shows a horizontal
    // scrollbar instead of collapsing headers to one character per line.
    this.gridApi?.sizeColumnsToFit({ defaultMinWidth: 120 });
    this.columnSizingMode = 'fit';
    this.cdr.markForCheck();
  }

  /** Pre-processed rows with only the needed columns, ready to render. */
  displayColumns: string[] = [];
  columnSizingMode: 'auto' | 'fit' = 'auto';
  /** Columns to use for export — set before calling export methods. */
  private exportColumns: string[] = [];
  displayRows: Record<string, unknown>[] = [];
  totalRowCount = 0;

  private readonly PAGE_SIZE = 20;
  private allRows: Record<string, unknown>[] = [];
  private sourceData: TableDataDto | null = null;
  private dataSubscription?: Subscription;
  private filteredRowsCache: {
    source: Record<string, unknown>[];
    key: string;
    rows: Record<string, unknown>[];
  } | null = null;
  private readonly subs: Subscription[] = [];
  private observer: IntersectionObserver | null = null;
  private loadingMore = false;
  private scrollObserverTimer: ReturnType<typeof setTimeout> | null = null;
  private loadMoreTimer: ReturnType<typeof setTimeout> | null = null;

  colContextMenuVisible = false;
  colContextMenuX = 0;
  colContextMenuY = 0;
  colContextMenuField = '';
  colContextMenuPinned = false;

  dragSourceCol = '';
  dragOverCol = '';

  // ─── Filter bar (Country / Sector / Business Unit / …) ──────────────────────
  showFilterBar = true;
  openFilterName: string | null = null;

  filterCountryOptions: string[] = [];
  filterCountry = 'All';
  filterSectorOptions: string[] = [];
  filterSector = 'All';
  filterBusinessUnitOptions: string[] = [];
  filterBusinessUnit = 'All';
  filterDivisionOptions: string[] = [];
  filterDivision = 'All';
  filterClusterOptions: string[] = [];
  filterCluster = 'All';
  filterPlantOptions: string[] = [];
  filterPlant = 'All';
  filterFrom = '';
  filterTo = '';
  filterQuickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After', 'Custom'];
  filterQuickRange = '';
  private allPlants: PlantFilterDto[] = [];
  private readonly destroy$ = new Subject<void>();

  // Snapshot of the filter values as first loaded (plant auto-selection + saved report config),
  // captured once both finish, so "Reset Filter" restores them instead of clearing to All/empty.
  private defaultFilterState: {
    country: string; sector: string; businessUnit: string; division: string;
    cluster: string; plant: string; quickRange: string; from: string; to: string;
  } | null = null;
  private plantFiltersLoaded = false;
  private reportConfigLoaded = false;

  private captureDefaultFilterStateIfReady(): void {
    if (this.defaultFilterState || !this.plantFiltersLoaded || !this.reportConfigLoaded) return;
    this.defaultFilterState = {
      country: this.filterCountry,
      sector: this.filterSector,
      businessUnit: this.filterBusinessUnit,
      division: this.filterDivision,
      cluster: this.filterCluster,
      plant: this.filterPlant,
      quickRange: this.filterQuickRange,
      from: this.filterFrom,
      to: this.filterTo,
    };
  }

  toggleFilterBar(): void {
    this.showFilterBar = !this.showFilterBar;
  }

  @ViewChild('advancedFilter') advancedFilterRef?: AdvancedFilterComponent;

  openAdvancedFilter(): void {
    this.advancedFilterRef?.open();
    this.cdr.markForCheck();
  }

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  selectFilterOption(name: string, value: string): void {
    const v = value || 'All';
    switch (name) {
      case 'country':      this.filterCountry = v; this.filterSector = 'All'; this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'sector':       this.filterSector = v; this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'businessUnit': this.filterBusinessUnit = v; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'division':     this.filterDivision = v; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'cluster':      this.filterCluster = v; this.filterPlant = 'All'; break;
      case 'plant':        this.filterPlant = v; break;
      case 'quickRange':   this.filterQuickRange = value; this.applyQuickRange(value); break;
    }
    this.rebuildCascadingOptions();
    this.applyGlobalFilter();
    this.openFilterName = null;
    this.cdr.markForCheck();
  }

  private loadPlantFilters(): void {
    this.commonApi.getPlantFilters().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe(plants => {
      this.allPlants = plants;
      this.filterCountryOptions = this.distinctValues(plants, p => p.country);
      this.autoSelectSingle();
      this.rebuildCascadingOptions();
      this.applyGlobalFilter();
      this.plantFiltersLoaded = true;
      this.captureDefaultFilterStateIfReady();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingle(): void {
    const active = (v: string) => v && v !== 'All';
    if (this.filterCountryOptions.length === 1) this.filterCountry = this.filterCountryOptions[0];
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => p.country === this.filterCountry);
    const sectors = this.distinctValues(filtered, p => p.sector);
    if (sectors.length === 1) this.filterSector = sectors[0];
    if (active(this.filterSector)) filtered = filtered.filter(p => p.sector === this.filterSector);
    const bus = this.distinctValues(filtered, p => p.businessUnit);
    if (bus.length === 1) this.filterBusinessUnit = bus[0];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => p.businessUnit === this.filterBusinessUnit);
    const divs = this.distinctValues(filtered, p => p.division);
    if (divs.length === 1) this.filterDivision = divs[0];
  }

  private rebuildCascadingOptions(): void {
    const active = (v: string) => v && v !== 'All';
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => p.country === this.filterCountry);
    this.filterSectorOptions = active(this.filterCountry) ? this.distinctValues(filtered, p => p.sector) : [];
    if (active(this.filterSector)) filtered = filtered.filter(p => p.sector === this.filterSector);
    this.filterBusinessUnitOptions = active(this.filterSector) ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => p.businessUnit === this.filterBusinessUnit);
    this.filterDivisionOptions = active(this.filterBusinessUnit) ? this.distinctValues(filtered, p => p.division) : [];
    if (active(this.filterDivision)) filtered = filtered.filter(p => p.division === this.filterDivision);
    this.filterClusterOptions = active(this.filterDivision) ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    if (!active(this.filterCluster) && this.filterClusterOptions.length === 1) this.filterCluster = this.filterClusterOptions[0];
    if (active(this.filterCluster)) filtered = filtered.filter(p => p.cluster === this.filterCluster);
    this.filterPlantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (!active(this.filterPlant) && this.filterPlantOptions.length === 1) this.filterPlant = this.filterPlantOptions[0];
  }

  private applyGlobalFilter(): void {
    const source = this.sheets[this.activeSheetIndex] ?? this.report;
    if (source?.sourceType === 'View') {
      this.loadData(source.sourceName, source.sourceType);
      return;
    }
    if (this.sourceData) {
      const { displayColumns, allRows } = this.buildRowsFromData(this.config, this.sourceData);
      this.displayColumns = displayColumns;
      this.allRows = allRows;
      this.filteredRowsCache = null;
    }
    const rows = this.filterRowsByGlobalCriteria(this.allRows);
    this.totalRowCount = rows.length;
    this.displayRows = rows.slice(0, this.PAGE_SIZE);
    this.computePinnedBottomRow();
  }

  /** Applies hierarchy and date global filters to source or display rows. */
  private filterRowsByGlobalCriteria(inRows: Record<string, unknown>[]): Record<string, unknown>[] {
    let rows = inRows;
    const hierarchyFilters: [string, string][] = [
      ['country', this.filterCountry],
      ['sector', this.filterSector],
      ['businessUnit', this.filterBusinessUnit],
      ['division', this.filterDivision],
      ['cluster', this.filterCluster],
      ['plant', this.filterPlant],
    ];
    for (const [field, selected] of hierarchyFilters) {
      if (!selected || selected === 'All' || !rows.length) continue;
      const column = this.findGlobalFilterColumn(rows[0], field);
      if (column) {
        const value = selected.trim().toLowerCase();
        rows = rows.filter(row => String(row[column] ?? '').trim().toLowerCase() === value);
      }
    }
    // The From/To date range is applied server-side through the view SQL's
    // @start_date/@end_date parameters (see applyReportViewParameters), so the
    // rows returned to the client are already scoped by date. We intentionally do
    // NOT re-filter rows by date here — doing so double-filtered and silently
    // dropped valid rows (e.g. rows whose date column is blank, or whose planned
    // date such as Target Finish falls outside the reporting period).
    return rows;
  }

  private findGlobalFilterColumn(row: Record<string, unknown>, field: string): string | undefined {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(field);
    const keys = Object.keys(row);
    return keys.find(key => normalize(key) === target)
      ?? keys.find(key => normalize(key).includes(target));
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
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
    this.filterQuickRange = 'Custom';
    this.showDateRangePopup = false;
    this.applyGlobalFilter();
    this.cdr.markForCheck();
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

  resetFilterBar(): void {
    const d = this.defaultFilterState;
    this.filterCountry = d?.country ?? 'All';
    this.filterSector = d?.sector ?? 'All';
    this.filterBusinessUnit = d?.businessUnit ?? 'All';
    this.filterDivision = d?.division ?? 'All';
    this.filterCluster = d?.cluster ?? 'All';
    this.filterPlant = d?.plant ?? 'All';
    this.filterFrom = d?.from ?? '';
    this.filterTo = d?.to ?? '';
    this.filterQuickRange = d?.quickRange ?? '';
    this.rebuildCascadingOptions();
    this.applyGlobalFilter();
    this.cdr.markForCheck();
  }

  // ─── KPI summary strip ────────────────────────────────────────────────────
  kpiCards: KpiCard[] = [
    { label: 'Wells Tracked', value: '41', hint: '36 with planned activity', accent: 'green' },
    { label: 'AVG Planned · Month', value: '28%', hint: 'Mean across all wells', accent: 'purple' },
    { label: 'AVG Actual · Month', value: '1%', hint: 'Progress recorded to date', accent: 'green' },
    { label: 'Behind Schedule', value: '34', hint: 'Actual below plan this month', accent: 'purple' },
  ];

  // ─── Tabs / search / density toolbar ─────────────────────────────────────
  activeTab: ReportTab = 'all';
  tableSearch = '';
  viewMode: TableDensity = 'comfortable';
  /** Column groups toggled off via the grouped chips row. */
  hiddenGroups = new Set<string>();
  /** "Resource Details" pinned chip in the grouped chips row — toggled like the others. */
  resourceDetailsActive = true;
  /** Currently selected group for column picking. */
  activeGroupName = '';
  /** Columns the user has explicitly selected via group column picks. */
  groupSelectedColumns = new Set<string>();

  toggleResourceDetails(): void {
    this.resourceDetailsActive = !this.resourceDetailsActive;
    this.buildGridColumns();
    this.cdr.markForCheck();
  }

  setTab(tab: ReportTab): void {
    this.activeTab = tab;
    if (tab === 'all') {
      this.activeGroupName = '';
      this.groupSelectedColumns.clear();
    }
    this.buildGridColumns();
    this.cdr.markForCheck();
  }

  switchToGroup(groupName: string): void {
    this.activeTab = 'grouped';
    this.activeGroupName = groupName;
    for (const col of this.activeGroupColumns) {
      this.groupSelectedColumns.add(col);
    }
    this.buildGridColumns();
    this.cdr.markForCheck();
  }

  setViewMode(mode: TableDensity): void {
    this.viewMode = mode;
    this.gridRowHeight = mode === 'comfortable' ? 42 : mode === 'compact' ? 32 : 25;
    this.gridApi?.resetRowHeights();
    this.cdr.markForCheck();
  }

  toggleGroupChip(name: string): void {
    if (this.hiddenGroups.has(name)) this.hiddenGroups.delete(name);
    else this.hiddenGroups.add(name);
    this.cdr.markForCheck();
  }

  selectGroup(groupName: string): void {
    if (this.activeGroupName === groupName) {
      this.activeGroupName = '';
      this.groupSelectedColumns.clear();
    } else {
      this.activeGroupName = groupName;
      this.groupSelectedColumns.clear();
      for (const col of this.activeGroupColumns) {
        this.groupSelectedColumns.add(col);
      }
    }
    this.buildGridColumns();
    this.cdr.markForCheck();
  }

  /** Columns belonging to the currently selected group. */
  get activeGroupColumns(): string[] {
    if (!this.activeGroupName) return [];
    return this.displayColumns.filter(col => {
      const grp = this.config?.columns?.find(c => c.field === col)?.group;
      return grp === this.activeGroupName;
    });
  }

  isGroupColumnSelected(col: string): boolean {
    return this.groupSelectedColumns.has(col);
  }

  toggleGroupColumn(col: string): void {
    if (this.groupSelectedColumns.has(col)) {
      this.groupSelectedColumns.delete(col);
    } else {
      this.groupSelectedColumns.add(col);
    }
    this.buildGridColumns();
    this.cdr.markForCheck();
  }

  /** Columns without a group (ungrouped / resource details). */
  get ungroupedColumns(): string[] {
    return this.displayColumns.filter(col => {
      const grp = this.config?.columns?.find(c => c.field === col)?.group;
      return !grp;
    });
  }

  /** Distinct column group names, in column order — drives the grouped-chips row. */
  get groupChipNames(): string[] {
    const names: string[] = [];
    for (const col of this.displayColumns) {
      const grp = this.config?.columns?.find(c => c.field === col)?.group;
      if (grp && !names.includes(grp)) names.push(grp);
    }
    return names;
  }

  /** Columns left after the active tab / grouped-chip selection filters them out. */
  get visibleColumns(): string[] {
    if (this.activeTab === 'all') return this.displayColumns;
    if (!this.activeGroupName) return [];
    return this.displayColumns.filter(col => this.groupSelectedColumns.has(col));
  }

  private buildSpans(cols: string[], keyFn: (col: string) => string, accentFn?: (col: string) => string): { label: string; colspan: number; accentGroup: string }[] {
    const spans: { label: string; colspan: number; accentGroup: string }[] = [];
    let i = 0;
    while (i < cols.length) {
      const key = keyFn(cols[i]);
      let span = 1;
      while (i + span < cols.length && keyFn(cols[i + span]) === key) span++;
      spans.push({ label: key, colspan: span, accentGroup: accentFn ? accentFn(cols[i]) : key });
      i += span;
    }
    return spans;
  }

  get visibleGroupHeaderSpans(): { label: string; colspan: number; accentGroup: string }[] {
    return this.buildSpans(this.visibleColumns, col => this.config?.columns?.find(c => c.field === col)?.group || '');
  }

  get visibleSubGroupHeaderSpans(): { label: string; colspan: number; accentGroup: string }[] {
    return this.buildSpans(
      this.visibleColumns,
      col => this.config?.columns?.find(c => c.field === col)?.subGroup || '',
      col => this.config?.columns?.find(c => c.field === col)?.group || '',
    );
  }

  // ─── Column-group accent colors (matches the grouped-chips row palette) ─────
  private readonly groupAccentPalette = [
    { header: '#DCFCE7', headerText: '#15803D', sub: '#ECFDF5', subText: '#15803D', cell: '#F3FDF6' },
    { header: '#CCFBF1', headerText: '#0F766E', sub: '#F0FDFA', subText: '#0F766E', cell: '#F1FDFC' },
    { header: '#DBEAFE', headerText: '#1D4ED8', sub: '#EFF6FF', subText: '#1D4ED8', cell: '#F3F8FF' },
  ];

  private groupAccent(grp: string): typeof this.groupAccentPalette[number] | null {
    if (!grp) return null;
    const idx = this.groupChipNames.indexOf(grp);
    return this.groupAccentPalette[(idx === -1 ? 0 : idx) % this.groupAccentPalette.length];
  }

  getGroupHeaderBg(grp: string): string | null {
    return this.groupAccent(grp)?.header ?? null;
  }

  getGroupHeaderColor(grp: string): string | null {
    return this.groupAccent(grp)?.headerText ?? null;
  }

  getSubGroupBg(grp: string): string | null {
    return this.groupAccent(grp)?.sub ?? null;
  }

  getSubGroupColor(grp: string): string | null {
    return this.groupAccent(grp)?.subText ?? null;
  }

  private getGroupCellBg(field: string): string | null {
    if (this.activeTab === 'all') return null;
    const grp = this.config?.columns?.find(c => c.field === field)?.group;
    return grp ? this.groupAccent(grp)?.cell ?? null : null;
  }

  get hasVisibleGroupHeaders(): boolean {
    return this.activeTab !== 'all' && this.visibleColumns.some(col => !!this.config?.columns?.find(c => c.field === col)?.group);
  }

  get hasVisibleSubGroupHeaders(): boolean {
    return this.activeTab !== 'all' && this.visibleColumns.some(col => !!this.config?.columns?.find(c => c.field === col)?.subGroup);
  }

  /** Rows matching the toolbar search box (checked across the currently visible columns). */
  get filteredRows(): Record<string, unknown>[] {
    const q = this.tableSearch.trim().toLowerCase();
    const cols = q ? this.visibleColumns : [];
    const key = JSON.stringify([
      this.filterCountry, this.filterSector, this.filterBusinessUnit, this.filterDivision,
      this.filterCluster, this.filterPlant, this.filterFrom, this.filterTo, q, cols,
    ]);
    // Replacing rowData on each change-detection pass rebuilds groups and resets manual expansion.
    if (this.filteredRowsCache?.source === this.allRows && this.filteredRowsCache.key === key) {
      return this.filteredRowsCache.rows;
    }
    const rows = this.filterRowsByGlobalCriteria(this.allRows);
    const filtered = q
      ? rows.filter(row => cols.some(col => String(row[col] ?? '').toLowerCase().includes(q)))
      : rows;
    this.filteredRowsCache = { source: this.allRows, key, rows: filtered };
    return filtered;
  }

  onCellValueChanged(): void {
    this.filteredRowsCache = null;
    this.cdr.markForCheck();
  }

  /** Short alphanumeric status codes (e.g. "P8") render as a pill instead of plain text. */
  isStatusCode(value: unknown): boolean {
    return typeof value === 'string' && /^[A-Za-z]{1,3}\d{1,3}$/.test(value.trim());
  }

  // ─── Company / job-progress banner ───────────────────────────────────────
  get companyName(): string {
    return this.config?.headerTitle || 'AL TASNIM ENTERPRISES LLC.';
  }

  get contractInfo(): string {
    return this.config?.headerSubtitle || 'Contract C3100000177 \u00B7 ';
  }

  get contractInfo2(): string {
    return this.config?.headerSubtitle2 || '';
  }

  get reportTypeLabel(): string {
    return this.report?.categoryName || 'Report';
  }

  get bannerTitle(): string {
    const fullName = this.report?.reportName || 'Report';
    const location = this.hasMultipleSheets ? this.config?.headerSubtitle?.trim() : '';
    if (!location) return fullName;
    // Multi-sheet reports share one name (e.g. "Location and Flowline Buffer Status \u2013 Nimr") but
    // each sheet covers a different location (its own headerSubtitle) — keep the shared prefix and
    // only swap the trailing "\u2013 <location>" suffix for the active sheet's own location.
    const base = fullName.replace(/\s*[-\u2013\u2014]\s*[^-\u2013\u2014]+$/, '').trim();
    return base ? `${base} \u2013 ${location}` : fullName;
  }

  get bannerPeriod(): string {
    return formatReportPeriod(this.filterFrom, this.filterTo);
  }

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef<HTMLDivElement>;
  private readonly notify: NotificationHelper;

  get successMessage(): string { return this.notify.successMessage; }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly tenantReports: TenantReportsService,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone,
    private readonly layoutState: LayoutStateService,
    private readonly authService: AuthService,
    private readonly exportColors: ReportExportColorService,
    private readonly permissions: PermissionService,
    private readonly toastService: ToastService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  scheduleOpen = false;
  get canSchedule(): boolean { return this.permissions.canCreate(SCHEDULES_MODULE); }
  get canEditReport(): boolean { return this.permissions.canModify('reports.my-reports'); }

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  get canUnpublishReport(): boolean {
    return !!this.report && this.report.status === 'published' && this.isAdmin && !this.isWipSection;
  }

  /** Whether this report belongs to the WIP/"My Reports" section. Prefers the
   *  originating section passed via the `from` query param (accurate immediately,
   *  no load flash); falls back to status — drafts and completed reports are WIP. */
  private get isWipSection(): boolean {
    const from = this.route.snapshot.queryParamMap.get('from');
    if (from === 'wip') return true;
    if (from === 'standard') return false;
    return this.report?.status === 'draft' || this.report?.status === 'completed';
  }

  get reportSectionRoute(): string {
    return this.isWipSection ? '/reports/my-reports' : '/reports/standard-reports';
  }

  get reportSectionLabel(): string {
    if (this.isWipSection) return this.isAdmin ? 'WIP Reports' : 'My Reports';
    return 'Standard Reports';
  }

  get breadcrumbs() {
    return [
      { label: 'Home', route: '/' },
      { label: 'Reports', route: '/reports' },
      { label: this.reportSectionLabel, route: this.reportSectionRoute },
      { label: this.report?.reportName || 'Viewer' },
    ];
  }

  private prevSidebarState: boolean | undefined;

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

  ngOnInit(): void {
    this.prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();
    const pendingToast = this.toastService.consume();
    if (pendingToast) this.notify.showSuccess(pendingToast);
    this.filterFrom = `${new Date().getFullYear()}-01-01`;
    this.filterTo = this.lastTuesday(new Date());
    this.loadPlantFilters();

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id || id < 1 || !Number.isInteger(id)) {
      this.error = 'Invalid report ID.';
      this.isLoading = false;
      return;
    }

    this.subs.push(
      this.tenantReports.getById(id).subscribe({
        next: (report) => {
          this.report = report;
          this.layoutState.setActiveNavOverride(this.reportSectionRoute);
          this.parseConfig(report);
          this.restoreGlobalFiltersFromConfig();
          this.reportConfigLoaded = true;
          this.captureDefaultFilterStateIfReady();
          // Multi-page report: render page 1 and show the sheet tab bar; otherwise load normally.
          if (this.config?.sheets && this.config.sheets.length > 1) {
            this.sheets = this.config.sheets;
            this.selectSheet(0);
          } else {
            this.loadData(report.sourceName, report.sourceType);
          }
        },
        error: () => {
          this.error = 'Failed to load report.';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      }),
    );
  }

  ngAfterViewInit(): void {
    this.setupScrollObserver();
  }

  ngOnDestroy(): void {
    this.viewDestroyed = true;
    if (this.prevSidebarState !== undefined) {
      this.prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this.layoutState.setActiveNavOverride(null);
    this.subs.forEach(s => s.unsubscribe());
    this.observer?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.scrollObserverTimer) clearTimeout(this.scrollObserverTimer);
    if (this.loadMoreTimer) clearTimeout(this.loadMoreTimer);
    if (this.exportToastTimer) clearTimeout(this.exportToastTimer);
  }

  private parseConfig(report: TenantReportDto): void {
    if (!report.reportJson) return;
    try {
      this.config = JSON.parse(report.reportJson);
    } catch {
      this.config = null;
    }
    this.updateGridTheme();
    this.updateExcelStyles();
  }

  private restoreGlobalFiltersFromConfig(): void {
    for (const filter of this.config?.filters ?? []) {
      const key = (filter.key || filter.label || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const value = filter.value;
      if (!value) continue;
      switch (key) {
        case 'country': this.filterCountry = value; break;
        case 'sector': this.filterSector = value; break;
        case 'businessunit': this.filterBusinessUnit = value; break;
        case 'division': this.filterDivision = value; break;
        case 'cluster': this.filterCluster = value; break;
        case 'plant': this.filterPlant = value; break;
        case 'quickrange': this.filterQuickRange = value; break;
        case 'from':
        case 'fromdate': this.filterFrom = value; break;
        case 'to':
        case 'todate': this.filterTo = value; break;
      }
    }
  }

  /** Body-cell class ids encoding its bg/text color (conditional format > manual) so native Excel export can paint it. */
  private exportCellClass = (params: CellClassParams): string[] => {
    const field = params.colDef.field;
    const rowIndex = params.node?.rowIndex;
    if (!field || params.node?.rowPinned || rowIndex == null || rowIndex < 0) return [];
    const rowData = params.data as Record<string, unknown> | undefined;
    const cf = this.getConditionalFormat(field, rowData);
    const bg = cf.backgroundColor || this.getExportCellBg(rowIndex, field);
    const fg = cf.textColor || this.getExportCellFg(rowIndex, field);
    const classes: string[] = [];
    if (this.exportColors.isExportHex(bg)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(bg)));
    if (this.exportColors.isExportHex(fg)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(fg)));
    return classes;
  };

  /** Header-cell class id encoding the column's saved header color so native Excel export paints it too. */
  private exportHeaderClass = (field: string | null | undefined): string[] => {
    const bg = field ? (this.config?.headerCellColors?.[field] || this.config?.headerRowColor) : undefined;
    return this.exportColors.isExportHex(bg) ? [this.exportColors.classId('bg', this.exportColors.normalizeHex(bg))] : [];
  };

  /** Rebuilds the Excel style registry (AG Grid's `excelStyles` is INITIAL-only) from every color in the saved config. */
  private updateExcelStyles(): void {
    const bgs: string[] = [];
    const fgs: string[] = [];
    const add = (list: string[], v?: string | null) => { if (this.exportColors.isExportHex(v)) list.push(this.exportColors.normalizeHex(v)); };
    Object.values(this.config?.cellColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.rowColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.pageRowColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.headerCellColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.cellTextColors ?? {}).forEach(v => add(fgs, v));
    Object.values(this.config?.rowTextColors ?? {}).forEach(v => add(fgs, v));
    (this.config?.columns ?? []).forEach(c => { add(bgs, c?.color); add(fgs, c?.textColor); });
    (this.config?.conditionalRules ?? []).forEach(r => { add(bgs, r.backgroundColor); add(fgs, r.textColor); });
    add(bgs, this.stripeBg(1));
    this.gridExcelStyles = this.exportColors.buildExcelStyles(bgs, fgs);
  }

  /** Rebuilds the grid theme so the report's saved typography applies to the grid. */
  private updateGridTheme(): void {
    this.gridHeaderHeight = this.config?.gridHeaderHeight ?? 36;
    this.gridTheme = themeQuartz.withParams({
      accentColor: '#21409A',
      backgroundColor: '#ffffff',
      borderColor: '#E2E7EF',
      borderRadius: 8,
      fontFamily: this.config?.fontFamily || 'Inter, sans-serif',
      fontSize: this.config?.fontSize || 13,
      headerFontSize: this.config?.tableHeadingFontSize || 12,
      headerBackgroundColor: '#E8F0FC',
      headerTextColor: '#344054',
      headerFontWeight: 700,
      rowHoverColor: '#F0F4FF',
      selectedRowBackgroundColor: '#F5F8FF',
      // Branded zebra striping: a faint tint of the report's saved theme accent (only when the user opted in).
      oddRowBackgroundColor: this.config?.brandedRows ? this.tint(this.config?.themeAccent || '#21409A', 0.06) : '#ffffff',
      wrapperBorder: false,
      wrapperBorderRadius: 0,
      headerRowBorder: false,
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

  /** Switches the viewer to a sheet/page: swaps in its config + source and reloads through the normal pipeline. */
  selectSheet(index: number): void {
    if (index < 0 || index >= this.sheets.length) return;
    this.activeSheetIndex = index;
    const sheet = this.sheets[index];
    this.config = sheet.config;
    this.updateGridTheme();
    this.updateExcelStyles();
    this.isLoading = true;
    this.error = '';
    this.displayColumns = [];
    this.sourceData = null;
    this.allRows = [];
    this.displayRows = [];
    this.gridColumnDefs = [];
    this.cdr.detectChanges();
    this.loadData(sheet.sourceName, sheet.sourceType);
  }

  private loadData(sourceName: string, sourceType: string): void {
    this.dataSubscription?.unsubscribe();
    this.isLoading = true;
    this.error = '';
    this.gridPinnedBottomRowData = [];
    const data$ = sourceType === 'View'
      ? this.loadViewData(sourceName)
      : this.commonApi.getTableData(sourceName, sourceType);

    this.subs.push(this.dataSubscription = data$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.sourceData = data;
        const { displayColumns, allRows } = this.buildRowsFromData(this.config, data);
        this.displayColumns = displayColumns;
        this.allRows = allRows;

        this.totalRowCount = this.allRows.length;
        this.displayRows = this.allRows.slice(0, this.PAGE_SIZE);
        this.buildGridColumns();
        this.isLoading = false;
        this.cdr.markForCheck();
        // Zoneless + OnPush: a grid re-created on sheet switch needs a follow-up CD pass
        // to paint its Angular-rendered header/cell components.
        setTimeout(() => { if (!this.viewDestroyed) this.cdr.detectChanges(); });
      },
      error: () => {
        this.error = 'Failed to load report data.';
        this.sourceData = null;
        this.allRows = [];
        this.displayRows = [];
        this.totalRowCount = 0;
        this.filteredRowsCache = null;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    }));
  }

  /** DAX measures the report wants displayed (only those with the "Show in report" flag set). */
  private daxSeriesMeasures(config: ReportJsonConfig | null): DaxMeasureConfig[] {
    const model = config?.daxModel;
    if (!model?.enabled) return [];
    return model.measures.filter(m => m.includeInSeries !== false && m.expression?.trim());
  }

  private daxRowMeasures(config: ReportJsonConfig | null): DaxMeasureConfig[] {
    return this.daxSeriesMeasures(config).filter(m => (m.evaluationScope ?? 'column') === 'row' && !!m.name?.trim() && !!m.expression.trim());
  }

  private daxColumnMeasures(config: ReportJsonConfig | null): DaxMeasureConfig[] {
    return this.daxSeriesMeasures(config).filter(m => (m.evaluationScope ?? 'column') !== 'row' && !!m.name?.trim() && !!m.expression.trim());
  }

  private daxMeasureColumns(config: ReportJsonConfig | null): string[] {
    // Only row-scope measures become columns; column-scope measures render as summary rows.
    return this.daxRowMeasures(config).map(m => m.name.trim());
  }

  /** Aggregate a column-scope measure over rows, tolerating an invalid expression. */
  private safeDaxColumnTotal(m: DaxMeasureConfig, rows: Record<string, unknown>[], columns: string[]): number {
    try { return evaluateDaxMeasure(m, rows, columns); }
    catch { return 0; }
  }

  /** "<Measure name>: <formatted value>" label shown in the summary row. */
  private daxSummaryLabel(m: DaxMeasureConfig, rows: Record<string, unknown>[], columns: string[]): string {
    return `${m.name?.trim() || 'New Metric'}: ${this.daxSummaryValue(m, rows, columns)}`;
  }

  /** Formatted aggregate value for a column-scope measure. */
  private daxSummaryValue(m: DaxMeasureConfig, rows: Record<string, unknown>[], columns: string[]): string {
    return formatDaxValue(this.safeDaxColumnTotal(m, rows, columns), m);
  }

  /** Computes a calculated field's value from a raw row (same rules as the builder). */
  private computeCalcFieldValue(row: Record<string, unknown>, cf: { columnA: string; columnB: string; operation: string }): number | null {
    const a = Number(row[cf.columnA]);
    const b = Number(row[cf.columnB]);
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

  /** Hidden (eye-closed) conditional filters that have a column and a value, mapped for the util. */
  private activeConditionalFilters(config: ReportJsonConfig | null): { sourceColumn: string; operator?: string; valueText?: string; mode?: string; values?: string[] }[] {
    return (config?.conditionalFilters ?? [])
      .filter(f => f.hidden && f.sourceColumn && f.valueText?.trim())
      .map(f => ({ sourceColumn: f.sourceColumn, operator: f.operator, valueText: f.valueText, mode: f.mode, values: [] }));
  }

  /** Turns raw source data into display columns + fully-materialized rows for a given sheet config. */
  private buildRowsFromData(
    config: ReportJsonConfig | null,
    data: { columns?: string[]; rows?: Record<string, unknown>[] },
  ): { displayColumns: string[]; allRows: Record<string, unknown>[] } {
    let displayColumns = config?.columns?.length
      ? this.uniqueColumns(config.columns.filter(c => c.shown !== false).map(c => c.field))
      : this.uniqueColumns(data.columns ?? []);

    const calcFields = config?.calculatedFields ?? [];
    // Conditional filters scope which rows the report shows; they run on rows enriched with
    // calculated fields so a filter can target either a source column or a calculated one.
    let sourceRows = this.filterRowsByGlobalCriteria(data.rows ?? []);
    const activeFilters = this.activeConditionalFilters(config);
    const rawColumns = new Set(data.columns?.length ? data.columns : Object.keys(sourceRows[0] ?? {}));
    for (const field of calcFields) rawColumns.add(field.name);
    const rawFilters = activeFilters.filter(filter => rawColumns.has(filter.sourceColumn));
    if (rawFilters.length) {
      const enriched = calcFields.length
        ? sourceRows.map(row => {
            const withCalc: Record<string, unknown> = { ...row };
            for (const cf of calcFields) withCalc[cf.name] = this.computeCalcFieldValue(row, cf);
            return withCalc;
          })
        : sourceRows;
      sourceRows = applyConditionalFilters(enriched, rawFilters);
    }

    let allRows = sourceRows.map(row => {
      const slim: Record<string, unknown> = {};
      for (const col of displayColumns) {
        slim[col] = row[col];
      }
      // Compute calculated fields (or reuse if the row was already enriched for filtering).
      for (const cf of calcFields) {
        if (!displayColumns.includes(cf.name)) continue;
        slim[cf.name] = (cf.name in row) ? row[cf.name] : this.computeCalcFieldValue(row, cf);
      }
      return slim;
    });

    // Data Transformation rules (type change, dedup, trim, math, rename/split/merge/extract) —
    // mirror the builder so renamed/new columns render in the viewer too; their output column
    // list becomes displayColumns (otherwise transformed columns show only in the builder).
    const parameterFilters = config?.parameterFilters ?? [];
    if (parameterFilters.length) {
      const res = applyParameterFilters(allRows, parameterFilters, displayColumns);
      allRows = res.rows;
      displayColumns = res.columns;
    }
    const transformedFilters = activeFilters.filter(filter => !rawColumns.has(filter.sourceColumn));
    if (transformedFilters.length) allRows = applyConditionalFilters(allRows, transformedFilters);

    // DAX measures: row-scope measures materialize as extra per-row columns. Column-scope
    // measures are not columns — they render as a labeled summary row in the totals/exports.
    const measureCols = this.daxMeasureColumns(config);
    if (measureCols.length) {
      const rowMeasures = this.daxRowMeasures(config);
      if (rowMeasures.length) {
        const source = allRows;
        allRows = allRows.map(row => {
          const withDax: Record<string, unknown> = { ...row };
          for (const m of rowMeasures) {
            try { withDax[m.name.trim()] = evaluateDaxMeasureForRow(m, row, source, displayColumns); }
            catch { withDax[m.name.trim()] = null; }
          }
          return withDax;
        });
      }
      for (const name of measureCols) {
        if (!displayColumns.includes(name)) displayColumns.push(name);
      }
    }

    // Apply manual Excel-like row edits (inserted/deleted rows, custom-cell values).
    const layout = reconcileRowLayout(
      config?.rowLayout,
      allRows.length,
      new Set(config?.deletedRowIndices ?? []),
    );
    allRows = materializeRows(layout, allRows, config?.manualRows, config?.cellOverrides);
    displayColumns = filterReportMonthColumns(displayColumns, config?.columns ?? [], this.filterFrom, this.filterTo);
    return { displayColumns, allRows };
  }

  /** Fetches and processes a single sheet's data without disturbing the active view. */
  private async loadSheetData(sheet: ReportSheetConfig): Promise<{ displayColumns: string[]; allRows: Record<string, unknown>[] }> {
    const data$ = sheet.sourceType === 'View'
      ? this.loadViewData(sheet.sourceName)
      : this.commonApi.getTableData(sheet.sourceName, sheet.sourceType);
    const data = await firstValueFrom(data$);
    return this.buildRowsFromData(sheet.config, data);
  }

  private uniqueColumns(columns: string[]): string[] {
    const seen = new Set<string>();
    return columns.filter(column => {
      const normalized = column.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  private loadViewData(viewName: string) {
    const hierarchy = {
      country: this.filterCountry,
      sector: this.filterSector,
      businessUnit: this.filterBusinessUnit,
      division: this.filterDivision,
      cluster: this.filterCluster,
      plant: this.filterPlant,
    };
    const fromDate = this.filterFrom;
    const toDate = this.filterTo;
    return this.commonApi.getDatabaseViews().pipe(
      map(views => views.find(v => v.viewName === viewName)),
      switchMap(view => {
        if (!view) throw new Error(`Report source view "${viewName}" was not found.`);
        return previewReportView(this.commonApi, view.id, hierarchy, fromDate, toDate);
      }),
    );
  }

  /** Load next batch of rows — mutates array in place so Angular only adds new DOM nodes. */
  loadMore(): void {
    if (!this.hasMore || this.loadingMore) return;
    this.loadingMore = true;
    const start = this.displayRows.length;
    const end = Math.min(start + this.PAGE_SIZE, this.totalRowCount);
    for (let i = start; i < end; i++) {
      this.displayRows.push(this.allRows[i]);
    }
    this.cdr.detectChanges();
    this.loadMoreTimer = setTimeout(() => { this.loadingMore = false; }, 150);
  }

  get hasMore(): boolean {
    return this.displayRows.length < this.totalRowCount;
  }

  trackByIndex(index: number): number {
    return index;
  }

  /** Auto-load more when user scrolls to the bottom. */
  private setupScrollObserver(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.scrollObserverTimer = setTimeout(() => {
      if (!this.scrollSentinel?.nativeElement) {
        this.scrollObserverTimer = setTimeout(() => this.setupScrollObserver(), 50);
        return;
      }
      this.observer?.disconnect();
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && this.hasMore && !this.loadingMore) {
            this.zone.run(() => this.loadMore());
          }
        },
        { rootMargin: '200px' },
      );
      this.observer.observe(this.scrollSentinel.nativeElement);
    }, 0);
  }

  /** Column header label — uses config header if available. */
  getColumnHeader(field: string): string {
    const col = this.config?.columns?.find(c => c.field === field);
    return col?.header || field;
  }

  /** Active filters from the global filter bar. */
  get activeFilters(): { label: string; value: string }[] {
    const filters: { label: string; value: string }[] = [];
    if (this.filterCountry && this.filterCountry !== 'All') filters.push({ label: 'Country', value: this.filterCountry });
    if (this.filterSector && this.filterSector !== 'All') filters.push({ label: 'Sector', value: this.filterSector });
    if (this.filterBusinessUnit && this.filterBusinessUnit !== 'All') filters.push({ label: 'Business Unit', value: this.filterBusinessUnit });
    if (this.filterDivision && this.filterDivision !== 'All') filters.push({ label: 'Division', value: this.filterDivision });
    if (this.filterCluster && this.filterCluster !== 'All') filters.push({ label: 'Cluster', value: this.filterCluster });
    if (this.filterPlant && this.filterPlant !== 'All') filters.push({ label: 'Plant', value: this.filterPlant });
    if (this.filterFrom) filters.push({ label: 'From', value: this.filterFrom });
    if (this.filterTo) filters.push({ label: 'To', value: this.filterTo });
    return filters;
  }

  /** Group header spans for the table. */
  get groupHeaderSpans(): { label: string; colspan: number }[] {
    const cols = this.config?.columns?.filter(c => c.shown !== false) ?? [];
    const spans: { label: string; colspan: number }[] = [];
    let i = 0;
    while (i < cols.length) {
      const grp = cols[i].group || '';
      let span = 1;
      while (i + span < cols.length && (cols[i + span].group || '') === grp) span++;
      spans.push({ label: grp, colspan: span });
      i += span;
    }
    return spans;
  }

  get subGroupHeaderSpans(): { label: string; colspan: number }[] {
    const cols = this.config?.columns?.filter(c => c.shown !== false) ?? [];
    const spans: { label: string; colspan: number }[] = [];
    let i = 0;
    while (i < cols.length) {
      const sub = cols[i].subGroup || '';
      let span = 1;
      while (i + span < cols.length && (cols[i + span].subGroup || '') === sub) span++;
      spans.push({ label: sub, colspan: span });
      i += span;
    }
    return spans;
  }

  get hasGroupHeaders(): boolean {
    return this.config?.columns?.some(c => c.shown !== false && !!c.group) ?? false;
  }

  get hasSubGroupHeaders(): boolean {
    return this.config?.columns?.some(c => c.shown !== false && !!c.subGroup) ?? false;
  }

  getColumnColor(field: string): string | null {
    const col = this.config?.columns?.find(c => c.field === field);
    return col?.color || null;
  }

  getCellBackground(rowIndex: number, field: string): string | null {
    const cellKey = `${rowIndex}:${field}`;
    return this.config?.cellColors?.[cellKey]
      || this.config?.rowColors?.[rowIndex]
      || this.getColumnColor(field)
      || this.getGroupCellBg(field);
  }

  onColContextMenu(event: MouseEvent | Event, field: string): void {
    event.preventDefault();
    this.colContextMenuField = field;
    this.colContextMenuPinned = this.gridApi?.getColumn(field)?.isPinned() ?? false;
    if (event instanceof MouseEvent) {
      this.colContextMenuX = event.clientX;
      this.colContextMenuY = event.clientY;
    }
    this.colContextMenuVisible = true;
    this.cdr.markForCheck();
  }

  onGridCellContextMenu(event: CellContextMenuEvent): void {
    const field = event.column?.getColId();
    if (!field || !event.event) return;
    const e = event.event as MouseEvent;
    e.preventDefault();
    this.colContextMenuField = field;
    this.colContextMenuPinned = event.column?.isPinned() ?? false;
    this.colContextMenuX = e.clientX;
    this.colContextMenuY = e.clientY;
    this.colContextMenuVisible = true;
    this.cdr.markForCheck();
  }

  pinColumnToLeft(field: string): void {
    if (!this.gridApi) return;
    this.gridApi.applyColumnState({ state: [{ colId: field, pinned: 'left' }] });
    this.gridApi.moveColumns([field], 1);
    this.colContextMenuVisible = false;
    this.cdr.markForCheck();
  }

  unpinColumn(_field: string): void {
    this.colContextMenuVisible = false;
  }

  onHeaderPinToggle(colId: string, pin: boolean): void {
    if (!this.gridApi || !pin) return;
    this.gridApi.applyColumnState({ state: [{ colId, pinned: 'left' }] });
    this.gridApi.moveColumns([colId], 1);
  }

  onColDragStart(field: string): void {
    this.dragSourceCol = field;
  }

  onColDragOver(event: DragEvent, field: string): void {
    event.preventDefault();
    this.dragOverCol = field;
  }

  onColDrop(field: string): void {
    if (this.dragSourceCol && this.dragSourceCol !== field) {
      const cols = [...this.displayColumns];
      const from = cols.indexOf(this.dragSourceCol);
      const to = cols.indexOf(field);
      if (from !== -1 && to !== -1) {
        cols.splice(from, 1);
        cols.splice(to, 0, this.dragSourceCol);
        this.displayColumns = cols;
        this.cdr.markForCheck();
      }
    }
    this.dragSourceCol = '';
    this.dragOverCol = '';
  }

  onColDragEnd(): void {
    this.dragSourceCol = '';
    this.dragOverCol = '';
  }

  moveColumnLeft(col: string): void {
    const idx = this.displayColumns.indexOf(col);
    if (idx <= 0) return;
    const cols = [...this.displayColumns];
    [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
    this.displayColumns = cols;
    this.cdr.markForCheck();
  }

  moveColumnRight(col: string): void {
    const idx = this.displayColumns.indexOf(col);
    if (idx === -1 || idx >= this.displayColumns.length - 1) return;
    const cols = [...this.displayColumns];
    [cols[idx], cols[idx + 1]] = [cols[idx + 1], cols[idx]];
    this.displayColumns = cols;
    this.cdr.markForCheck();
  }

  @HostListener('document:click')
  hideColContextMenu(): void {
    this.colContextMenuVisible = false;
    this.openFilterName = null;
  }

  goBack(): void {
    this.router.navigate([this.reportSectionRoute]);
  }

  editReport(): void {
    if (!this.report) return;
    this.router.navigate(['/reports/builder'], {
      queryParams: { id: this.report.id, name: this.report.reportName, category: this.report.categoryName, returnUrl: this.router.url },
    });
  }

  publishReport(): void {
    if (!this.report || this.report.status === 'published' || this.isPublishing) return;

    this.isPublishing = true;
    this.tenantReports.update(this.report.id, {
      reportName: this.report.reportName,
      categoryId: this.report.categoryId,
      sourceName: this.report.sourceName,
      sourceType: this.report.sourceType,
      reportJson: this.report.reportJson,
      status: 'published',
    }).subscribe({
      next: (report) => {
        this.report = report;
        this.isPublishing = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPublishing = false;
        this.error = err?.error?.message || err?.message || 'Failed to publish report.';
        this.cdr.markForCheck();
      },
    });
  }

  unpublishReport(): void {
    if (!this.canUnpublishReport || this.isPublishing) return;
    const report = this.report;
    if (!report) return;

    this.isPublishing = true;
    this.tenantReports.update(report.id, {
      reportName: report.reportName,
      categoryId: report.categoryId,
      sourceName: report.sourceName,
      sourceType: report.sourceType,
      reportJson: report.reportJson,
      status: 'draft',
    }).subscribe({
      next: () => {
        this.router.navigate(['/reports/my-reports']);
      },
      error: (err) => {
        this.isPublishing = false;
        this.error = err?.error?.message || err?.message || 'Failed to unpublish report.';
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Delete ───────────────────────────────────────────────────────────────
  showDeleteConfirm = false;

  confirmDelete(): void {
    this.showDeleteConfirm = true;
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
  }

  deleteReport(): void {
    if (!this.report) return;
    const reportName = this.report.reportName;
    this.subs.push(this.tenantReports.delete(this.report.id).subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.router.navigate([this.reportSectionRoute]);
      },
      error: (err) => {
        this.showDeleteConfirm = false;
        this.error = err?.error?.message || err?.message || `Failed to delete '${reportName}'.`;
        this.cdr.markForCheck();
      },
    }));
  }

  // ─── Export via RDLC Backend ─────────────────────────────────────────────────

  showExportMenu = false;
  isExporting = false;

  toggleExportMenu(): void {
    this.showExportMenu = !this.showExportMenu;
  }

  // Brief transient toast shown while an export is generating and on completion.
  exportToastVisible = false;
  exportToastMessage = '';
  exportToastError = false;
  private exportToastTimer: ReturnType<typeof setTimeout> | null = null;

  private flashExportToast(message: string, isError = false): void {
    this.exportToastMessage = message;
    this.exportToastError = isError;
    this.exportToastVisible = true;
    if (this.exportToastTimer) clearTimeout(this.exportToastTimer);
    this.exportToastTimer = setTimeout(() => {
      this.exportToastVisible = false;
      this.cdr.markForCheck();
    }, 2600);
    this.cdr.markForCheck();
  }

  async exportAs(format: 'pdf' | 'excel' | 'csv'): Promise<void> {
    this.showExportMenu = false;
    if (!this.report) return;

    this.isExporting = true;
    this.cdr.markForCheck();

    try {
      if (format === 'excel') {
        await this.exportWorkbook();
      } else if (format === 'csv') {
        await this.exportCsvFiles();
      } else {
        await this.fallbackExport('pdf');
      }
      this.flashExportToast(
        format === 'csv' ? 'CSV export ready' : format === 'excel' ? 'Excel export ready' : 'Export ready',
      );
    } catch {
      this.flashExportToast('Export failed. Please try again.', true);
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  /** Export rows/columns for a sheet: the active sheet honors the live grid sort/filter; others use their defined order. */
  private async getSheetExportData(
    sheetCfg: ReportSheetConfig,
    index: number,
  ): Promise<{ displayColumns: string[]; rows: Record<string, unknown>[]; allRows: Record<string, unknown>[] }> {
    if (index === this.activeSheetIndex && this.gridApi) {
      const displayColumns = this.getCurrentExportColumns();
      return { displayColumns, rows: this.getCurrentExportRows(), allRows: this.allRows };
    }
    const { displayColumns, allRows } = await this.loadSheetData(sheetCfg);
    return { displayColumns, rows: allRows, allRows };
  }

  private async fallbackExport(format: 'pdf' | 'excel'): Promise<void> {
    if (!this.report || !this.displayColumns.length) return;

    const cols = this.getCurrentExportColumns();
    // Interleave group subtotals + the (DAX-inclusive) totals row so the PDF mirrors the grid.
    const rows = format === 'pdf'
      ? this.buildExportRows(this.getCurrentExportRows(), cols)
      : this.getCurrentExportRows();
    const original = this.displayColumns;
    this.displayColumns = [...cols];

    const headers = this.displayColumns.map(col => this.getColumnHeader(col));

    if (format === 'excel') {
      await this.exportWorkbook();
    } else {
      const tableHtml = this.buildPrintHtml(headers, rows);
      this.printViaHiddenIframe(tableHtml);
    }

    this.displayColumns = original;
  }

  /**
   * Prints report HTML through a hidden, same-origin iframe instead of a popup window.
   * A window.open('', '_blank') popup has no URL, so the browser stamps "about:blank" in the
   * print header/footer; printing a same-origin iframe uses the app's own page URL instead.
   */
  private printViaHiddenIframe(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!win || !doc) { iframe.remove(); return; }

    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    win.addEventListener('afterprint', cleanup, { once: true });

    let printed = false;
    const print = () => {
      if (printed) return;
      printed = true;
      try { win.focus(); win.print(); } catch { cleanup(); }
    };

    doc.open();
    doc.write(html);
    doc.close();

    // Print once the logo images have loaded; a safety timeout keeps a slow or broken
    // image from ever blocking the export.
    const pending = Array.from(doc.images).filter(img => !img.complete);
    if (pending.length === 0) {
      setTimeout(print, 50);
    } else {
      let left = pending.length;
      const onDone = () => { if (--left <= 0) print(); };
      pending.forEach(img => {
        img.addEventListener('load', onDone, { once: true });
        img.addEventListener('error', onDone, { once: true });
      });
      setTimeout(print, 3000);
    }
  }

  /** Excel export: one styled worksheet per report sheet (single-sheet reports get one 'Report' tab). */
  private async exportWorkbook(): Promise<void> {
    if (!this.report) return;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartOps';
    workbook.created = new Date();
    const usedNames = new Set<string>();

    if (this.hasMultipleSheets) {
      const origConfig = this.config;
      const origCols = this.displayColumns;
      const origRows = this.allRows;
      try {
        for (let i = 0; i < this.sheets.length; i++) {
          const sheetCfg = this.sheets[i];
          const { displayColumns, rows, allRows } = await this.getSheetExportData(sheetCfg, i);
          // The sheet already renders a dedicated auto serial-number column (col A) — drop a
          // duplicate Sl.No-style data column so it isn't exported twice.
          const exportColumns = displayColumns.filter(col => !isSerialNumberField(col));
          // Swap in the sheet's context so the banner/header/getters (incl. bannerTitle) render that page.
          this.config = sheetCfg.config;
          this.displayColumns = [...exportColumns];
          this.allRows = allRows;
          const headers = exportColumns.map(c => this.getColumnHeader(c));
          await this.addStyledWorksheet(workbook, this.uniqueExcelSheetName(sheetCfg.name, usedNames), headers, this.buildExportRows(rows, displayColumns));
        }
      } finally {
        this.config = origConfig;
        this.displayColumns = origCols;
        this.allRows = origRows;
      }
    } else {
      const cols = this.getCurrentExportColumns();
      const rows = this.getCurrentExportRows();
      const origCols = this.displayColumns;
      // The sheet already renders a dedicated auto serial-number column (col A) — drop a
      // duplicate Sl.No-style data column so it isn't exported twice.
      const exportCols = cols.filter(col => !isSerialNumberField(col));
      this.displayColumns = [...exportCols];
      try {
        const headers = exportCols.map(c => this.getColumnHeader(c));
        await this.addStyledWorksheet(workbook, this.uniqueExcelSheetName('Report', usedNames), headers, this.buildExportRows(rows, cols));
      } finally {
        this.displayColumns = origCols;
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    this.downloadBlob(blob, `${this.report.reportName}.xlsx`);
  }

  /** Renders the current (this.config/displayColumns) sheet context into one styled worksheet. */
  private async addStyledWorksheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: Record<string, unknown>[]): Promise<void> {
    const sheet = workbook.addWorksheet(name, {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    const colCount = this.displayColumns.length + 1;
    sheet.columns = [{ width: 11 }, ...this.displayColumns.map(field => ({ width: Math.max(14, Math.min(26, this.getColumnHeader(field).length + 4)) }))];

    await this.addExcelBanner(workbook, sheet, colCount);
    const headerStartRow = 6;
    this.addExcelHeaders(sheet, headers, headerStartRow);
    this.addExcelDataRows(sheet, rows, headerStartRow + this.getExcelHeaderRowCount());

    sheet.eachRow(row => {
      row.eachCell(cell => {
        cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true };
      });
    });
  }

  /** Excel worksheet names must be <=31 chars, exclude []:*?/\, and be unique within the workbook. */
  private uniqueExcelSheetName(name: string, used: Set<string>): string {
    const base = (name || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let candidate = base;
    let i = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ` (${i++})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  /** CSV export: single-sheet reports download one .csv; multi-sheet reports download a .zip of one .csv per sheet. */
  private async exportCsvFiles(): Promise<void> {
    if (!this.report) return;
    const reportName = this.report.reportName || 'report';

    if (this.hasMultipleSheets) {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      const origConfig = this.config;
      try {
        for (let i = 0; i < this.sheets.length; i++) {
          const sheetCfg = this.sheets[i];
          const { displayColumns, rows } = await this.getSheetExportData(sheetCfg, i);
          // getColumnHeader reads this.config for header overrides.
          this.config = sheetCfg.config;
          const headers = displayColumns.map(c => this.getColumnHeader(c));
          const csv = this.buildCsv(headers, displayColumns, this.buildExportRows(rows, displayColumns));
          zip.file(`${this.uniqueCsvFileName(sheetCfg.name, usedNames)}.csv`, csv);
        }
      } finally {
        this.config = origConfig;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      this.downloadBlob(blob, `${reportName}.zip`);
      return;
    }

    const cols = this.getCurrentExportColumns();
    const rows = this.getCurrentExportRows();
    const headers = cols.map(c => this.getColumnHeader(c));
    const csv = this.buildCsv(headers, cols, this.buildExportRows(rows, cols));
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `${reportName}.csv`);
  }

  /** Builds a CSV string with a leading Sl.No column, matching the on-screen export shape. */
  private buildCsv(headers: string[], columns: string[], rows: Record<string, unknown>[]): string {
    const escape = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(['Sl.No', ...headers].map(escape).join(','));
    rows.forEach((row, i) => {
      const slNo = row[this.TOTALS_ROW_FLAG] ? String(row[this.TOTALS_LABEL_KEY] ?? 'Total') : String(i + 1);
      lines.push([escape(slNo), ...columns.map(col => escape(row[col]))].join(','));
    });
    return lines.join('\r\n');
  }

  private uniqueCsvFileName(name: string, used: Set<string>): string {
    const base = (name || 'Sheet').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Sheet';
    let candidate = base;
    let i = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base} (${i++})`;
    used.add(candidate.toLowerCase());
    return candidate;
  }

  private async addExcelBanner(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, colCount: number): Promise<void> {
    // .xlsx cell fills are solid, not CSS gradients — same builder color on both halves,
    // falling back to the same navy the builder's own default gradient starts from, so an
    // unmodified report still reads as "the same banner", not two arbitrary hardcoded blues.
    const hdrBg = this.sanitizeCssColor(this.config?.headerBackgroundColor || '', '#21409A');
    const hdrColor = this.sanitizeCssColor(this.config?.headerTextColor || '', '#FFFFFF');
    const fill = this.getExcelFill(hdrBg);
    const halfCols = Math.max(2, Math.ceil(colCount / 2));

    for (let row = 1; row <= 4; row++) {
      sheet.getRow(row).height = 22;
      for (let col = 1; col <= colCount; col++) {
        const cell = sheet.getCell(row, col);
        cell.fill = fill;
        cell.border = this.getExcelBorder(hdrBg);
      }
    }

    sheet.mergeCells(1, 2, 2, halfCols);
    sheet.getCell(1, 2).value = this.companyName;
    sheet.getCell(1, 2).font = this.getExcelFont(hdrColor, true, 14);
    sheet.getCell(1, 2).alignment = { vertical: 'bottom', horizontal: 'left', wrapText: true };

    sheet.mergeCells(3, 2, 4, halfCols);
    sheet.getCell(3, 2).value = [this.contractInfo, this.contractInfo2].filter(Boolean).join('\n');
    sheet.getCell(3, 2).font = this.getExcelFont(hdrColor, false, 11);
    sheet.getCell(3, 2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

    // The last column is reserved exclusively for the right logo — same as column 1 (Sl.No) is
    // exclusively reserved for the left logo — so the logo image never overlaps the report title text.
    const rightTextEndCol = Math.max(halfCols + 1, colCount - 1);

    sheet.mergeCells(1, halfCols + 1, 2, rightTextEndCol);
    const reportTitleCell = sheet.getCell(1, halfCols + 1);
    reportTitleCell.value = {
      richText: [
        { text: `${this.reportTypeLabel}\n`, font: this.getExcelFont(hdrColor, false, 10) },
        { text: this.bannerTitle, font: this.getExcelFont(hdrColor, true, 14) },
      ],
    };
    reportTitleCell.alignment = { vertical: 'bottom', horizontal: 'right', wrapText: true };

    sheet.mergeCells(3, halfCols + 1, 4, rightTextEndCol);
    sheet.getCell(3, halfCols + 1).value = this.bannerPeriod;
    sheet.getCell(3, halfCols + 1).font = this.getExcelFont(hdrColor, false, 10);
    sheet.getCell(3, halfCols + 1).alignment = { vertical: 'top', horizontal: 'right', wrapText: true };

    // Anchor both logos from real pixel dimensions (not guessed fractions) so a 68px logo always
    // fits inside its reserved column/row band without spilling onto the text next to it.
    const bannerRowPx = this.excelRowHeightToPx(22);
    const bannerHeightPx = bannerRowPx * 4;
    const verticalOffset = Math.max(0, (bannerHeightPx - this.EXCEL_LOGO_PX) / 2) / bannerRowPx;

    const leftColWidthPx = this.excelColWidthToPx(Number(sheet.getColumn(1).width) || 11);
    const leftOffset = Math.max(0, (leftColWidthPx - this.EXCEL_LOGO_PX) / 2) / leftColWidthPx;

    const lastColWidthPx = this.excelColWidthToPx(Number(sheet.getColumn(colCount).width) || 14);
    const rightMarginPx = 6;
    const rightOffset = Math.max(0, lastColWidthPx - rightMarginPx - this.EXCEL_LOGO_PX) / lastColWidthPx;

    await Promise.all([
      this.addExcelLogo(workbook, sheet, this.config?.leftLogoUrl, leftOffset, verticalOffset),
      this.addExcelLogo(workbook, sheet, this.config?.rightLogoUrl, (colCount - 1) + rightOffset, verticalOffset),
    ]);
  }

  /** Resolves a column header's background: per-cell color > uniform header row color > column color > fallback. */
  private getHeaderCellBg(field: string, fallback: string): string {
    const cfgColor = this.config?.columns?.find(c => c.field === field)?.color;
    return this.sanitizeCssColor(this.config?.headerCellColors?.[field] || this.config?.headerRowColor || cfgColor || '', fallback);
  }

  private addExcelHeaders(sheet: ExcelJS.Worksheet, headers: string[], startRow: number): void {
    const configs = this.displayColumns.map(col => this.config?.columns?.find(c => c.field === col));
    const hasGroups = configs.some(config => !!config?.group);
    const hasSubs = configs.some(config => !!config?.subGroup);
    const headerRowBg = this.sanitizeCssColor(this.config?.headerRowColor || '', '#F5F5F5');
    const groupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 0)?.color || '', '#21409A');
    const subGroupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 1)?.color || '', '#EEF4FF');
    const groupHeaderText = this.sanitizeCssColor(this.config?.groupTextColor || '', '#FFFFFF');
    const subGroupHeaderText = this.sanitizeCssColor(this.config?.subGroupTextColor || '', '#FFFFFF');
    const headerRowCount = this.getExcelHeaderRowCount(configs);
    const groupRow = startRow;
    const subGroupRow = hasGroups ? startRow + 1 : startRow;
    const headerRow = startRow + headerRowCount - 1;

    if (hasGroups || hasSubs) {
      sheet.mergeCells(startRow, 1, startRow + headerRowCount - 1, 1);
    }
    this.styleExcelHeaderCell(sheet.getCell(startRow, 1), 'Sl.No', headerRowBg, '#000000');

    if (hasGroups) {
      let colIndex = 2;
      for (let index = 0; index < configs.length;) {
        const group = configs[index]?.group || '';
        let span = 1;
        while (index + span < configs.length && (configs[index + span]?.group || '') === group) span++;
        if (group) {
          const gBg = this.sanitizeCssColor(this.config?.groupColors?.[group] || '', groupHeaderBg);
          if (span > 1) sheet.mergeCells(groupRow, colIndex, groupRow, colIndex + span - 1);
          this.styleExcelHeaderCell(sheet.getCell(groupRow, colIndex), group, gBg, groupHeaderText);
          this.styleExcelHeaderRange(sheet, groupRow, colIndex, groupRow, colIndex + span - 1, gBg, groupHeaderText);
        } else {
          for (let offset = 0; offset < span; offset++) {
            sheet.mergeCells(groupRow, colIndex + offset, groupRow + headerRowCount - 1, colIndex + offset);
            const fieldBg = this.getHeaderCellBg(this.displayColumns[index + offset], headerRowBg);
            this.styleExcelHeaderCell(sheet.getCell(groupRow, colIndex + offset), headers[index + offset], fieldBg, '#000000');
          }
        }
        index += span;
        colIndex += span;
      }
    }

    if (hasSubs) {
      let colIndex = 2;
      for (let index = 0; index < configs.length;) {
        const group = configs[index]?.group || '';
        const subGroup = configs[index]?.subGroup || '';
        let span = 1;
        while (
          index + span < configs.length
          && (configs[index + span]?.group || '') === group
          && (configs[index + span]?.subGroup || '') === subGroup
        ) span++;
        if (!group && hasGroups) {
          index += span;
          colIndex += span;
          continue;
        }
        if (subGroup) {
          const sgBg = this.sanitizeCssColor(this.config?.subGroupColors?.[subGroup] || '', subGroupHeaderBg);
          if (span > 1) sheet.mergeCells(subGroupRow, colIndex, subGroupRow, colIndex + span - 1);
          this.styleExcelHeaderCell(sheet.getCell(subGroupRow, colIndex), subGroup, sgBg, subGroupHeaderText);
          this.styleExcelHeaderRange(sheet, subGroupRow, colIndex, subGroupRow, colIndex + span - 1, sgBg, subGroupHeaderText);
        } else {
          for (let offset = 0; offset < span; offset++) {
            this.styleExcelHeaderCell(sheet.getCell(subGroupRow, colIndex + offset), '', subGroupHeaderBg, subGroupHeaderText);
          }
        }
        index += span;
        colIndex += span;
      }
    }

    for (let index = 0; index < configs.length; index++) {
      const colIndex = index + 2;
      const hasGroup = !!configs[index]?.group;
      const hasSubGroup = !!configs[index]?.subGroup;
      const fieldBg = this.getHeaderCellBg(this.displayColumns[index], headerRowBg);
      if (hasGroups && !hasGroup) continue;
      if (hasSubs && hasGroup && !hasSubGroup) {
        this.styleExcelHeaderCell(sheet.getCell(headerRow, colIndex), headers[index], fieldBg, '#000000');
        continue;
      }
      this.styleExcelHeaderCell(sheet.getCell(headerRow, colIndex), headers[index], fieldBg, '#000000');
    }

    for (let row = startRow; row < startRow + headerRowCount; row++) {
      sheet.getRow(row).height = 24;
    }

    // Vertical-orientation headers: rotate the leaf header cells and grow that row to fit the text.
    const verticalHeaderLen = this.displayColumns.reduce((max, field) =>
      this.isExportHeaderVertical(field) ? Math.max(max, this.getColumnHeader(field).length) : max, 0);
    if (verticalHeaderLen > 0) {
      for (let index = 0; index < this.displayColumns.length; index++) {
        if (this.isExportHeaderVertical(this.displayColumns[index])) {
          const cell = sheet.getCell(headerRow, index + 2);
          cell.alignment = { ...cell.alignment, textRotation: 90, wrapText: true };
        }
      }
      sheet.getRow(headerRow).height = Math.max(24, Math.min(160, verticalHeaderLen * 6 + 8));
    }
  }

  private addExcelDataRows(sheet: ExcelJS.Worksheet, rows: Record<string, unknown>[], startRow: number): void {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const excelRow = sheet.getRow(startRow + rowIndex);
      const isTotals = !!rows[rowIndex][this.TOTALS_ROW_FLAG];
      excelRow.getCell(1).value = isTotals ? String(rows[rowIndex][this.TOTALS_LABEL_KEY] ?? 'Total') : rowIndex + 1;
      excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      excelRow.getCell(1).border = this.getExcelBorder('#D9E0EA');
      if (isTotals) excelRow.getCell(1).font = { ...excelRow.getCell(1).font, bold: true };
      // Serial cell shares the branded row stripe so the whole row matches on-screen.
      if (!isTotals) { const s = this.stripeBg(rowIndex); if (s) excelRow.getCell(1).fill = this.getExcelFill(s); }

      for (let colIndex = 0; colIndex < this.displayColumns.length; colIndex++) {
        const field = this.displayColumns[colIndex];
        const cell = excelRow.getCell(colIndex + 2);
        const raw = rows[rowIndex][field];
        const dateValue = this.isDateColumn(field) && raw != null && raw !== ''
          ? new Date(raw as string | number | Date)
          : null;
        const numericValue = this.getExcelNumericValue(field, raw);
        if (dateValue && !Number.isNaN(dateValue.getTime())) {
          cell.value = dateValue;
          cell.numFmt = 'dd-mm-yyyy';
        } else if (numericValue != null) {
          cell.value = numericValue;
          if (!Number.isInteger(numericValue)) cell.numFmt = '0.##';
        } else {
          cell.value = isTotals
            ? (raw == null || raw === '' ? '' : this.getExportDisplayValue(rows[rowIndex], field))
            : this.getExportDisplayValue(rows[rowIndex], field);
        }
        cell.border = this.getExcelBorder('#D9E0EA');
        if (isTotals) {
          cell.font = { ...cell.font, bold: true };
          continue;
        }
        const rowData = rows[rowIndex];
        const bg = this.getExportCellBg(rowIndex, field, rowData);
        if (bg) cell.fill = this.getExcelFill(bg);
        const fg = this.getExportCellFg(rowIndex, field, rowData);
        if (fg) cell.font = { ...cell.font, color: { argb: this.toExcelArgb(fg) } };
        if (this.getConditionalFormat(field, rowData).bold) cell.font = { ...cell.font, bold: true };
        // Vertical-orientation cells export as rotated (bottom-to-top) text, matching the grid.
        if (this.isExportCellVertical(rowIndex, field)) {
          cell.alignment = { ...cell.alignment, textRotation: 90, wrapText: true };
        }
      }
      excelRow.commit();
    }

    this.applyExcelCellMerges(sheet, startRow, rows.length);
  }

  /** Mirrors the on-screen grid's manual cell merges (colSpan/rowSpan) as real merged Excel cells. */
  private applyExcelCellMerges(sheet: ExcelJS.Worksheet, startRow: number, rowCount: number): void {
    const ranges = this.config?.mergedCellRanges ?? [];
    for (const range of ranges) {
      const colIndex = this.displayColumns.indexOf(range.field);
      if (colIndex === -1) continue;
      if (range.rowIndex < 0 || range.rowIndex >= rowCount) continue;

      const rowSpan = Math.max(1, range.rowSpan);
      const colSpan = Math.max(1, range.colSpan);
      if (rowSpan === 1 && colSpan === 1) continue;

      const col = colIndex + 2;
      const top = startRow + range.rowIndex;
      const bottom = Math.min(startRow + range.rowIndex + rowSpan - 1, startRow + rowCount - 1);
      const right = col + colSpan - 1;

      try {
        sheet.mergeCells(top, col, bottom, right);
        const anchor = sheet.getCell(top, col);
        anchor.alignment = { ...anchor.alignment, horizontal: 'center', vertical: 'middle' };
      } catch {
        // A malformed/overlapping merge range shouldn't break the rest of the export.
      }
    }
  }

  private getExcelHeaderRowCount(configs = this.displayColumns.map(col => this.config?.columns?.find(c => c.field === col))): number {
    return (configs.some(config => !!config?.group) ? 1 : 0) + (configs.some(config => !!config?.subGroup) ? 1 : 0) + 1;
  }

  private styleExcelHeaderCell(cell: ExcelJS.Cell, value: string, bgColor: string, textColor: string): void {
    cell.value = value;
    this.styleExcelHeaderFill(cell, bgColor, textColor);
  }

  private styleExcelHeaderRange(sheet: ExcelJS.Worksheet, startRow: number, startCol: number, endRow: number, endCol: number, bgColor: string, textColor: string): void {
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        this.styleExcelHeaderFill(sheet.getCell(row, col), bgColor, textColor);
      }
    }
  }

  private styleExcelHeaderFill(cell: ExcelJS.Cell, bgColor: string, textColor: string): void {
    cell.fill = this.getExcelFill(bgColor);
    cell.font = this.getExcelFont(textColor, true, 11);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = this.getExcelBorder('#D9E0EA');
  }

  private readonly EXCEL_LOGO_PX = 68;

  /** Excel's default column-width unit (Calibri 11 "characters") to on-screen pixels. */
  private excelColWidthToPx(widthUnits: number): number {
    return Math.round(widthUnits * 7 + 5);
  }

  /** Row heights are stored in points; Excel renders at 96px/inch = 96/72 px per point. */
  private excelRowHeightToPx(points: number): number {
    return points * (96 / 72);
  }

  private async addExcelLogo(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, src: string | undefined, col: number, row: number): Promise<void> {
    const image = await this.getExcelImage(src);
    if (!image) return;
    const imageId = workbook.addImage(image);
    sheet.addImage(imageId, { tl: { col, row }, ext: { width: this.EXCEL_LOGO_PX, height: this.EXCEL_LOGO_PX } });
  }

  /**
   * ExcelJS can only embed raster png/jpeg/gif. Uploaded logos are commonly svg/webp data URLs
   * (or an http(s)/assets path), so anything not already raster is rasterized to PNG via canvas
   * first — otherwise the logo silently never made it into the workbook.
   */
  private async getExcelImage(src: string | undefined): Promise<{ base64: string; extension: 'png' | 'jpeg' | 'gif' } | null> {
    const safeSrc = this.sanitizeImageSrc(src);
    if (!safeSrc) return null;
    const rasterMatch = /^data:image\/(png|jpe?g|gif);base64,/i.exec(safeSrc);
    if (rasterMatch) {
      return {
        base64: safeSrc,
        extension: rasterMatch[1].toLowerCase() === 'jpg' ? 'jpeg' : rasterMatch[1].toLowerCase() as 'png' | 'jpeg' | 'gif',
      };
    }
    const rasterized = await this.rasterizeImageToPng(safeSrc);
    return rasterized ? { base64: rasterized, extension: 'png' } : null;
  }

  private rasterizeImageToPng(src: string): Promise<string | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 48;
          canvas.height = img.naturalHeight || 48;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  private getExcelFill(hex: string): ExcelJS.Fill {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: this.toExcelArgb(hex) } };
  }

  private getExcelFont(hex: string, bold: boolean, size: number): Partial<ExcelJS.Font> {
    return { color: { argb: this.toExcelArgb(hex) }, bold, size };
  }

  private getExcelBorder(hex: string): Partial<ExcelJS.Borders> {
    const border = { style: 'thin' as const, color: { argb: this.toExcelArgb(hex) } };
    return { top: border, right: border, bottom: border, left: border };
  }

  private toExcelArgb(hex: string): string {
    const normalized = hex.replace('#', '');
    if (normalized.length === 3) {
      return `FF${normalized.split('').map(ch => ch + ch).join('').toUpperCase()}`;
    }
    return `FF${normalized.slice(0, 6).toUpperCase()}`;
  }

  private getCurrentExportColumns(): string[] {
    if (!this.gridApi) {
      return [...new Set(this.visibleColumns.length ? this.visibleColumns : this.displayColumns)];
    }

    const visibleFields = this.gridApi.getAllDisplayedColumns()
      .map(col => col.getColId())
      .filter(colId => this.displayColumns.includes(colId));

    return visibleFields.length ? visibleFields : [...new Set(this.visibleColumns.length ? this.visibleColumns : this.displayColumns)];
  }

  private getCurrentExportRows(): Record<string, unknown>[] {
    if (!this.gridApi) return this.allRows;

    const rows: Record<string, unknown>[] = [];
    this.gridApi.forEachNodeAfterFilterAndSort(node => {
      if (node.data) rows.push(node.data as Record<string, unknown>);
    });

    return rows.length ? rows : this.allRows;
  }

  /**
   * Builds the export row set from sorted leaf rows, interleaving per-group subtotal rows and a
   * bottom grand-total row (row-grouping aggregations) plus the pinned "Show Totals Row" summary,
   * so exports mirror the on-screen grid. Summaries are computed from leaf rows to avoid double counting.
   */
  private buildExportRows(leafRows: Record<string, unknown>[], columns: string[]): Record<string, unknown>[] {
    const grouped = this.withGroupTotals(leafRows, columns);
    const columnMeasures = this.daxColumnMeasures(this.config);
    const wantTotals = !!this.config?.showTotals && leafRows.length > 0 && columns.length > 0;
    const out = [...grouped];
    if (wantTotals) {
      // One labeled row per aggregation type (Sum/Average/...), mirroring the on-screen totals.
      for (const totals of computeTotalsRows(this.config, leafRows, columns)) {
        const label = String(totals[TOTALS_LABEL_FIELD] ?? 'Total');
        const { [TOTALS_LABEL_FIELD]: _drop, ...values } = totals;
        out.push({ ...values, [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: label });
      }
    }
    // Flat reports: add the controlled "Total" grand-total row (grouped reports get it from withGroupTotals).
    if (!!this.config?.grandTotalAtBottom && !this.hasRowGrouping && leafRows.length > 0 && columns.length > 0) {
      const grand = computeGrandTotalRow(this.config, leafRows, columns);
      if (grand) {
        const { [TOTALS_LABEL_FIELD]: _drop, ...values } = grand;
        out.push({ ...values, [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: 'Total' });
      }
    }
    // Each column-scope DAX measure is a labeled summary row: name in the Sl.No column, value in the last data column.
    const lastCol = columns[columns.length - 1];
    for (const m of columnMeasures) {
      const value = formatDaxValue(this.safeDaxColumnTotal(m, leafRows, columns), m);
      out.push({
        [this.TOTALS_ROW_FLAG]: true,
        [this.TOTALS_LABEL_KEY]: m.name?.trim() || 'New Metric',
        ...(lastCol ? { [lastCol]: value } : {}),
      });
    }
    return out;
  }

  /** Interleaves per-group subtotals and a grand-total row derived from the report's row-grouping aggregations. */
  private withGroupTotals(leafRows: Record<string, unknown>[], columns: string[]): Record<string, unknown>[] {
    const groupFields = (this.config?.columns ?? [])
      .filter(c => c.rowGroup)
      .sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0))
      .map(c => c.field)
      .filter(f => columns.includes(f));
    const aggMap = new Map<string, 'sum' | 'avg'>();
    for (const c of this.config?.columns ?? []) {
      if ((c.aggFunc === 'sum' || c.aggFunc === 'avg') && columns.includes(c.field)) aggMap.set(c.field, c.aggFunc);
    }
    const wantSubtotal = !!this.config?.subtotalAfterGroup;
    const wantGrand = !!this.config?.grandTotalAtBottom;
    if (!leafRows.length || !groupFields.length || !aggMap.size || (!wantSubtotal && !wantGrand)) return leafRows;

    const aggregate = (rows: Record<string, unknown>[], field: string, fn: 'sum' | 'avg'): number | string => {
      const nums = rows.map(r => Number(r[field])).filter(n => !Number.isNaN(n));
      if (!nums.length) return '';
      const sum = nums.reduce((a, b) => a + b, 0);
      return fn === 'avg' ? +(sum / nums.length).toFixed(2) : sum;
    };
    const totalRow = (rows: Record<string, unknown>[], labelField: string | null, labelValue: unknown, slNoLabel: string): Record<string, unknown> => {
      const row: Record<string, unknown> = { [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: slNoLabel };
      for (const [field, fn] of aggMap) row[field] = aggregate(rows, field, fn);
      if (labelField) row[labelField] = labelValue;
      return row;
    };

    // Emits leaf rows grouped by groupFields[level..], with a subtotal footer after each group.
    const build = (rows: Record<string, unknown>[], level: number): Record<string, unknown>[] => {
      if (level >= groupFields.length) return rows;
      const field = groupFields[level];
      const out: Record<string, unknown>[] = [];
      let i = 0;
      while (i < rows.length) {
        const key = rows[i][field];
        let j = i;
        while (j < rows.length && rows[j][field] === key) j++;
        const groupRows = rows.slice(i, j);
        out.push(...build(groupRows, level + 1));
        if (wantSubtotal) out.push(totalRow(groupRows, field, key, 'Total'));
        i = j;
      }
      return out;
    };

    const result = build(leafRows, 0);
    if (wantGrand) result.push(totalRow(leafRows, groupFields[0], 'Grand Total', 'Grand Total'));
    return result;
  }

  /** Real numeric value for a numeric (non-boolean/non-date) column, so Excel stores/sorts/sums it
   * as a Number instead of text; null when the field isn't numeric or the cell is blank. */
  private getExcelNumericValue(field: string, raw: unknown): number | null {
    if (raw == null || raw === '') return null;
    if (this.isBooleanColumn(field) || this.isDateColumn(field) || !this.isNumericColumn(field)) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  private getExportDisplayValue(row: Record<string, unknown>, field: string): string | number {
    const value = row[field];
    if (value == null || value === '') return '—';

    if (this.isBooleanColumn(field)) {
      const boolValue = typeof value === 'string' ? value.toLowerCase() : value;
      return boolValue === true || boolValue === 'true' || boolValue === 1 ? 'true' : 'false';
    }

    if (this.isDateColumn(field)) {
      const date = new Date(value as string | number | Date);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
    }

    if (this.isNumericColumn(field)) {
      const numberValue = Number(value);
      if (!Number.isNaN(numberValue)) {
        //return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return numberValue;
      }
    }
    if(typeof value === 'number'){
      return value;
    }
    return String(value);
  }

  /** Flat single-table HTML for Excel — no nesting, no page breaks. */
  private buildFlatExcelHtml(headers: string[], rows: Record<string, unknown>[]): string {
    const colCount = this.displayColumns.length + 1;
    const companyEsc = this.escapeHtml(this.companyName);
    const contractEsc = this.escapeHtml(this.contractInfo);
    const contract2Esc = this.escapeHtml(this.contractInfo2);
    const typeEsc = this.escapeHtml(this.reportTypeLabel);
    const titleEsc = this.escapeHtml(this.bannerTitle);
    const periodEsc = this.escapeHtml(this.bannerPeriod);
    const bannerText = this.escapeHtml(this.config?.bannerText || '');
    const fontFam = this.sanitizeCssFont(this.config?.fontFamily || '', 'Inter, Arial, sans-serif');
    // Excel's HTML renderer can't paint a CSS gradient, so the on-screen gradient banner
    // falls back to one flat, sanitized hex color here \u2014 same color on both halves so the
    // banner reads as the single color the user actually picked, not two unrelated hardcoded ones.
    const hdrBg = this.sanitizeCssColor(this.config?.headerBackgroundColor || '', '#21409A');
    const hdrColor = this.sanitizeCssColor(this.config?.headerTextColor || '', '#FFFFFF');
    const hdrSubColor = this.sanitizeCssColor(this.config?.headerTextColor || '', '#D8DDE7');
    const leftLogoHtml = this.buildExportLogoHtml(this.config?.leftLogoUrl, 'Left logo', 'rv-export-logo');
    const rightLogoHtml = this.buildExportLogoHtml(this.config?.rightLogoUrl, 'Right logo', 'rv-export-logo');
    const halfCols = Math.ceil(colCount / 2);
    const otherHalf = colCount - halfCols;

    let html = '';

    // Banner \u2014 both halves share the builder's header color/text color exactly.
    html += `<tr><td colspan="${halfCols}" style="background:${hdrBg};padding:20px 24px;color:${hdrColor};vertical-align:middle;font-size:16px;font-weight:600"><table style="border-collapse:collapse"><tr>${leftLogoHtml ? '<td style="border:none;padding:0 12px 0 0;vertical-align:middle;line-height:0">' + leftLogoHtml + '</td>' : ''}<td style="border:none;padding:0;vertical-align:middle">${companyEsc}<br><span style="font-size:12px;font-weight:400;color:${hdrSubColor}">${contractEsc}</span>${contract2Esc ? '<br><span style="font-size:12px;font-weight:400;color:' + hdrSubColor + '">' + contract2Esc + '</span>' : ''}</td></tr></table></td><td colspan="${otherHalf}" style="background:${hdrBg};padding:20px 24px;color:${hdrColor};text-align:right;vertical-align:middle;font-size:20px;font-weight:700"><table style="border-collapse:collapse;width:100%"><tr><td style="border:none;padding:0;text-align:right;vertical-align:middle">${typeEsc}<br>${titleEsc}<br><span style="font-size:12px;font-weight:400;color:${hdrSubColor}">${periodEsc}</span></td><td style="border:none;padding:0 0 0 12px;text-align:right;vertical-align:middle;width:52px;line-height:0">${rightLogoHtml}</td></tr></table></td></tr>`;

    // KPIs (hidden for now)
    // const kpiCount = this.kpiCards.length;

    // Spacer
    html += `<tr><td colspan="${colCount}" style="height:8px"></td></tr>`;

    // Column headers with group/subgroup spans
    const chunkConfigs = this.displayColumns.map(col => this.config?.columns?.find(c => c.field === col));
    const hasGroups = this.hasGroupHeaders;
    const hasSubs = this.hasSubGroupHeaders;
    const headerRowBg = this.sanitizeCssColor(this.config?.headerRowColor || '', '#f5f5f5');
    const groupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 0)?.color || '', '#21409A');
    const subGroupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 1)?.color || '', '#EEF4FF');
    const groupHeaderText = this.sanitizeCssColor(this.config?.groupTextColor || '', '#FFFFFF');
    const subGroupHeaderText = this.sanitizeCssColor(this.config?.subGroupTextColor || '', '#FFFFFF');

    if (hasGroups) {
      html += '<tr>';
      html += `<th rowspan="${1 + (hasSubs ? 1 : 0) + 1}" style="border:1px solid #ddd;padding:6px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
      let ci = 0;
      while (ci < chunkConfigs.length) {
        const grp = chunkConfigs[ci]?.group || '';
        let span = 1;
        while (ci + span < chunkConfigs.length && (chunkConfigs[ci + span]?.group || '') === grp) span++;
        if (grp) {
          const gBg = this.sanitizeCssColor(this.config?.groupColors?.[grp] || '', groupHeaderBg);
          html += `<th colspan="${span}" style="border:1px solid #1a3580;padding:6px;background:${gBg};color:${groupHeaderText};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(grp)}</th>`;
        } else {
          const totalRows = 1 + (hasSubs ? 1 : 0) + 1;
          for (let j = 0; j < span; j++) {
            html += `<th rowspan="${totalRows}" style="border:1px solid #ddd;padding:6px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle;white-space:pre-line">${this.escapeHtmlWithLineBreaks(headers[ci + j])}</th>`;
          }
        }
        ci += span;
      }
      html += '</tr>';
    }

    if (hasSubs) {
      html += '<tr>';
      if (!hasGroups) {
        html += `<th rowspan="2" style="border:1px solid #ddd;padding:6px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
      }
      let ci = 0;
      while (ci < chunkConfigs.length) {
        const hasGrp = !!chunkConfigs[ci]?.group;
        const group = chunkConfigs[ci]?.group || '';
        const sub = chunkConfigs[ci]?.subGroup || '';
        let span = 1;
        while (
          ci + span < chunkConfigs.length
          && (chunkConfigs[ci + span]?.group || '') === group
          && (chunkConfigs[ci + span]?.subGroup || '') === sub
        ) span++;
        if (!hasGrp && hasGroups) { ci += span; continue; }
        if (sub) {
          const sgBg = this.sanitizeCssColor(this.config?.subGroupColors?.[sub] || '', subGroupHeaderBg);
          html += `<th colspan="${span}" style="border:1px solid #D5E3F7;padding:5px;background:${sgBg};color:${subGroupHeaderText};font-size:10px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(sub)}</th>`;
        } else {
          for (let j = 0; j < span; j++) {
            if (hasGrp) html += `<th style="border:1px solid #ddd;padding:5px;background:${subGroupHeaderBg};color:#fff;font-size:11px;font-weight:600;text-align:center"></th>`;
          }
        }
        ci += span;
      }
      html += '</tr>';
    }

    html += '<tr>';
    if (!hasGroups && !hasSubs) {
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
    }
    for (let i = 0; i < chunkConfigs.length; i++) {
      if (hasGroups && !chunkConfigs[i]?.group) continue;
      if (hasSubs && chunkConfigs[i]?.group && !chunkConfigs[i]?.subGroup) {
        html += `<th style="border:1px solid #ddd;padding:6px 10px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(headers[i])}</th>`;
        continue;
      }
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(headers[i])}</th>`;
    }
    html += '</tr>';

    // Data rows
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      html += `<tr><td style="border:1px solid #ddd;padding:5px 10px;font-size:11px;text-align:center">${ri + 1}</td>`;
      for (const col of this.displayColumns) {
        let display : string | number;
        if( typeof this.getExportDisplayValue(row, col) === 'number' ) {
          display = this.getExportDisplayValue(row, col);
        }else{
          display = this.escapeHtml(this.getExportDisplayValue(row, col).toString());

        }
        const bg = this.getExportCellBg(ri, col, row);
        const fg = this.getExportCellFg(ri, col, row);
        const bgStyle = bg ? `background:${bg};` : '';
        const fgStyle = fg ? `color:${fg};` : '';
        html += `<td style="border:1px solid #ddd;padding:5px 10px;font-size:11px;${bgStyle}${fgStyle}">${display}</td>`;
      }
      html += '</tr>';
    }

    // Footer
    if (bannerText) {
      const bannerBg = this.sanitizeCssColor(this.config?.bannerBackgroundColor || '', '#EDEFF4');
      const bannerColor = this.sanitizeCssColor(this.config?.bannerTextColor || '', '#344054');
      html += `<tr><td colspan="${colCount}" style="padding:8px;background:${bannerBg};font-size:12px;font-weight:500;text-align:center;color:${bannerColor}">${bannerText}</td></tr>`;
    }

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>body{font-family:${fontFam};font-size:12px}table{border-collapse:collapse;width:100%}.rv-export-logo{width:44px;height:44px;object-fit:contain;display:block}</style></head><body><table>${html}</table></body></html>`;
  }

  /** Max data columns per landscape page (excluding Sl.No which always shows). */
  private readonly MAX_COLS_PER_PAGE = 8;
  /** Approx rows per landscape page (accounting for header/footer). */
  private readonly MAX_ROWS_PER_PAGE = 20;

  private exportToExcel(): void {
    const cols = this.config?.columns?.filter(c => c.shown !== false) ?? [];
    const colCount = this.displayColumns.length + 1; // +1 for Sl.No
    const headers = ['Sl.No', ...this.displayColumns.map(col => this.getColumnHeader(col))];
    const rows: (string | null)[][] = [];
    const merges: XLSX.Range[] = [];
    let rowIdx = 0;

    const hasGroups = this.hasGroupHeaders;
    const hasSubs = this.hasSubGroupHeaders;
    // How many header rows: group + subgroup + column names
    const headerRowCount = (hasGroups ? 1 : 0) + (hasSubs ? 1 : 0) + 1;

    // Banner: Company Name
    const companyRow = new Array(colCount).fill(null) as (string | null)[];
    companyRow[0] = this.companyName;
    rows.push(companyRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
    rowIdx++;

    // Banner: Contract Info
    const contractRow = new Array(colCount).fill(null) as (string | null)[];
    contractRow[0] = this.contractInfo;
    rows.push(contractRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
    rowIdx++;

    // Banner: Report Type + Title
    const reportRow = new Array(colCount).fill(null) as (string | null)[];
    reportRow[0] = `${this.reportTypeLabel} \u2014 ${this.bannerTitle}`;
    rows.push(reportRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
    rowIdx++;

    // Banner: Reporting Period
    const periodRow = new Array(colCount).fill(null) as (string | null)[];
    periodRow[0] = this.bannerPeriod;
    rows.push(periodRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
    rowIdx++;

    // Spacer
    rows.push(new Array(colCount).fill(null) as (string | null)[]);
    rowIdx++;

    // KPI summary (hidden for now)

    // Spacer
    rows.push(new Array(colCount).fill(null) as (string | null)[]);
    rowIdx++;

    // Group header row
    if (hasGroups) {
      const groupRow: (string | null)[] = [];
      // Sl.No — vertically merge across all header rows
      groupRow.push('Sl.No');
      merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx + headerRowCount - 1, c: 0 } });
      let colPos = 1; // data columns start after Sl.No
      for (const span of this.groupHeaderSpans) {
        if (span.label) {
          // Horizontal merge for group label
          groupRow.push(span.label);
          for (let j = 1; j < span.colspan; j++) groupRow.push(null);
          if (span.colspan > 1) {
            merges.push({ s: { r: rowIdx, c: colPos }, e: { r: rowIdx, c: colPos + span.colspan - 1 } });
          }
        } else {
          // No group — vertically merge each col from group row down to column header row
          for (let j = 0; j < span.colspan; j++) {
            groupRow.push(headers[colPos + j]);
            merges.push({ s: { r: rowIdx, c: colPos + j }, e: { r: rowIdx + headerRowCount - 1, c: colPos + j } });
          }
        }
        colPos += span.colspan;
      }
      rows.push(groupRow);
      rowIdx++;
    }

    // SubGroup header row
    if (hasSubs) {
      const subRow: (string | null)[] = [];
      if (hasGroups) {
        subRow.push(null); // Sl.No already merged from group row
      } else {
        // Sl.No — vertically merge across subgroup + column header rows
        subRow.push('Sl.No');
        merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx + 1, c: 0 } });
      }
      let colPos = 1; // data columns start after Sl.No
      for (const span of this.subGroupHeaderSpans) {
        const ci = colPos - 1; // index into cols (config columns, no Sl.No)
        const colHasGroup = !!cols[ci]?.group;
        if (!colHasGroup && hasGroups) {
          // Already vertically merged from group row — fill nulls
          for (let j = 0; j < span.colspan; j++) subRow.push(null);
        } else if (span.label) {
          // Horizontal merge for subgroup label
          subRow.push(span.label);
          for (let j = 1; j < span.colspan; j++) subRow.push(null);
          if (span.colspan > 1) {
            merges.push({ s: { r: rowIdx, c: colPos }, e: { r: rowIdx, c: colPos + span.colspan - 1 } });
          }
        } else {
          // Has group but no subgroup — vertically merge down to column header row
          for (let j = 0; j < span.colspan; j++) {
            subRow.push(headers[colPos + j]);
            merges.push({ s: { r: rowIdx, c: colPos + j }, e: { r: rowIdx + 1, c: colPos + j } });
          }
        }
        colPos += span.colspan;
      }
      rows.push(subRow);
      rowIdx++;
    }

    // Column header row — only fill cells not already merged above
    const colHeaderRow: (string | null)[] = [];
    // Sl.No column
    colHeaderRow.push((hasGroups || hasSubs) ? null : 'Sl.No');
    // Data columns (cols[i] maps to headers[i+1] because headers[0] = Sl.No)
    for (let i = 0; i < cols.length; i++) {
      const colHasGroup = !!cols[i]?.group;
      const colHasSub = !!cols[i]?.subGroup;
      if (hasGroups && !colHasGroup) {
        colHeaderRow.push(null); // already merged from group row
      } else if (hasSubs && colHasGroup && !colHasSub) {
        colHeaderRow.push(null); // already merged from subgroup row
      } else {
        colHeaderRow.push(headers[i + 1]);
      }
    }
    rows.push(colHeaderRow);
    rowIdx++;

    // Data rows
    let slNo = 1;
    for (const row of this.allRows) {
      rows.push([String(slNo++), ...this.displayColumns.map(col => {
        const val = row[col];
        return val == null ? '' : String(val ?? '');
      })]);
      rowIdx++;
    }

    // Footer: Banner text spanning all cols
    if (this.config?.bannerText) {
      const bannerRow = new Array(colCount).fill(null) as (string | null)[];
      bannerRow[0] = this.config.bannerText;
      rows.push(bannerRow);
      merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
    }

    // Build workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;

    // Set column widths (include Sl.No)
    ws['!cols'] = [{ wch: 6 }, ...this.displayColumns.map(() => ({ wch: 18 }))];

    // Apply styling to match view (group/subgroup/column header colors)
    this.applyExcelStyling(ws, rows, rowIdx, hasGroups, hasSubs);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${this.report!.reportName}.xlsx`);
  }

  /** Apply styling to Excel worksheet to match grid view colors */
  private applyExcelStyling(ws: XLSX.WorkSheet, rows: (string | null)[][], totalRowIdx: number, hasGroups: boolean, hasSubs: boolean): void {
    const cols = this.config?.columns?.filter(c => c.shown !== false) ?? [];
    const groupColor = this.config?.columnGroupColors?.find(color => color.level === 0)?.color;
    const subGroupColor = this.config?.columnGroupColors?.find(color => color.level === 1)?.color;
    const headerRowColor = this.config?.headerRowColor;

    // Starting row for group headers (after banner)
    let currentRow = 6; // Skip: company, contract, report, period, spacer, spacer (rows 0-5)

    // Style group header row
    if (hasGroups && (groupColor || Object.keys(this.config?.groupColors ?? {}).length)) {
      let colPos = 1;
      for (const span of this.groupHeaderSpans) {
        const gColor = this.config?.groupColors?.[span.label] || groupColor;
        for (let j = 0; j < span.colspan; j++) {
          const cellAddress = XLSX.utils.encode_cell({ r: currentRow, c: colPos + j });
          if (ws[cellAddress] && gColor) {
            ws[cellAddress].s = this.getCellStyle(gColor, '#ffffff');
          }
        }
        colPos += span.colspan;
      }
      currentRow++;
    }

    // Style subgroup header row
    if (hasSubs && (subGroupColor || Object.keys(this.config?.subGroupColors ?? {}).length)) {
      let colPos = 1;
      for (const span of this.subGroupHeaderSpans) {
        const ci = colPos - 1;
        const colHasGroup = !!cols[ci]?.group;
        if (!colHasGroup && hasGroups) {
          // Skip cells already merged from group row
        } else if (span.label) {
          const sgColor = this.config?.subGroupColors?.[span.label] || subGroupColor;
          for (let j = 0; j < span.colspan; j++) {
            const cellAddress = XLSX.utils.encode_cell({ r: currentRow, c: colPos + j });
            if (ws[cellAddress] && sgColor) {
              ws[cellAddress].s = this.getCellStyle(sgColor, '#ffffff');
            }
          }
        }
        colPos += span.colspan;
      }
      currentRow++;
    }

    // Style column header row
    if (headerRowColor) {
      let colPos = 1;
      for (let i = 0; i < cols.length; i++) {
        const colHasGroup = !!cols[i]?.group;
        const colHasSub = !!cols[i]?.subGroup;
        if (hasGroups && !colHasGroup) {
          // Skip cells already merged from group row
        } else if (hasSubs && colHasGroup && !colHasSub) {
          // Skip cells already merged from subgroup row
        } else {
          const cellAddress = XLSX.utils.encode_cell({ r: currentRow, c: colPos });
          if (ws[cellAddress]) {
            ws[cellAddress].s = this.getCellStyle(headerRowColor, '#344054');
          }
        }
        colPos++;
      }
    }
  }

  /** Convert hex color to XLSX cell style format */
  private getCellStyle(bgColor: string, textColor: string = '#000000'): any {
    const rgbBg = this.hexToRgb(bgColor);
    const rgbText = this.hexToRgb(textColor);
    
    return {
      fill: {
        fgColor: { rgb: rgbBg || 'FFFFFF' },
        patternType: 'solid',
      },
      font: {
        color: { rgb: rgbText || '000000' },
        bold: true,
      },
      alignment: {
        horizontal: 'center',
        vertical: 'center',
      },
    };
  }

  /** Convert hex color to RGB format for XLSX */
  private hexToRgb(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? result[1].toUpperCase() + result[2].toUpperCase() + result[3].toUpperCase() : null;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Escape HTML special characters to prevent XSS when interpolating into raw HTML. */
  private escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private escapeHtmlWithLineBreaks(text: string): string {
    return this.escapeHtml(text)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll('\n', '<br>');
  }

  private sanitizeImageSrc(value: string | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(trimmed)) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^assets\/[\w%./-]+$/i.test(trimmed)) return trimmed;
    return '';
  }

  private buildExportLogoHtml(src: string | undefined, alt: string, className: string): string {
    const safeSrc = this.sanitizeImageSrc(src);
    // <img> defaults to baseline vertical-align, which sits a few px below true center inside
    // a table cell — set it explicitly so the logo lines up with the text next to it.
    return safeSrc ? `<img src="${this.escapeHtml(safeSrc)}" alt="${this.escapeHtml(alt)}" class="${className}" style="vertical-align:middle" />` : '';
  }

  private static readonly SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
  private static readonly SAFE_FONT = /^[\w\s,'-]+$/;
  // Broader than SAFE_COLOR — also allows `linear-gradient(...)`/`rgba(...)` syntax for
  // contexts (print/PDF) that can actually render a gradient. No `<>{};:/\`, so it can't
  // break out of a `<style>` block or inject additional CSS declarations.
  private static readonly SAFE_BACKGROUND = /^[a-zA-Z0-9#(),.%\s-]+$/;

  /** Sanitize a CSS color value — only allow hex colors. */
  private sanitizeCssColor(value: string, fallback: string): string {
    return ReportViewerComponent.SAFE_COLOR.test(value) ? value : fallback;
  }

  /** Sanitize a CSS background value — allows hex/rgb/gradient syntax, still blocks injection. */
  private sanitizeCssBackground(value: string, fallback: string): string {
    return ReportViewerComponent.SAFE_BACKGROUND.test(value) ? value : fallback;
  }

  /** Sanitize a CSS font-family value — only allow alphanumeric, spaces, commas, quotes. */
  private sanitizeCssFont(value: string, fallback: string): string {
    return ReportViewerComponent.SAFE_FONT.test(value) ? value : fallback;
  }

  /** Cell/row/column color maps for exports, sourced from the saved report config. */
  private exportColorSource(): ExportCellColorSource {
    return {
      cellColors: this.config?.cellColors,
      pageRowColors: this.config?.pageRowColors,
      rowColors: this.config?.rowColors,
      cellTextColors: this.config?.cellTextColors,
      rowTextColors: this.config?.rowTextColors,
      getColumnColor: (field) => this.config?.columns?.find(c => c.field === field)?.color,
      getColumnTextColor: (field) => this.config?.columns?.find(c => c.field === field)?.textColor,
    };
  }

  /** The grid's actual page size (matches the on-screen color keying); falls back to the default. */
  private exportPageSize(): number {
    return getReportGridPageSize(this.gridApi, this.gridPaginationPageSize);
  }

  /** Conditional-formatting match for a cell (same rule set/precedence as the on-screen grid). */
  private getConditionalFormat(field: string, rowData: Record<string, unknown> | undefined): { backgroundColor?: string; textColor?: string; bold?: boolean } {
    if (!rowData) return {};
    return evaluateConditionalRules(this.config?.conditionalRules, field, rowData);
  }

  /** Export background for a cell (conditional format > cell > row > column), safe hex only. */
  private getExportCellBg(rowIndex: number, col: string, rowData?: Record<string, unknown>): string | null {
    const cf = this.getConditionalFormat(col, rowData).backgroundColor;
    if (cf) return cf;
    const manual = this.exportColors.resolveCellBackground(rowIndex, col, this.exportPageSize(), this.exportColorSource());
    if (manual) return manual;
    // Branded zebra striping (mirrors the grid's oddRowBackgroundColor) so it persists in exports.
    return this.stripeBg(rowIndex);
  }

  /** Branded stripe color for odd data rows (a faint tint of the theme accent), else null. */
  private stripeBg(rowIndex: number): string | null {
    if (!this.config?.brandedRows) return null;
    return rowIndex % 2 === 1 ? this.tint(this.config?.themeAccent || '#21409A', 0.06) : null;
  }

  /** Export text color for a cell (conditional format > cell > row > column), safe hex only. */
  private getExportCellFg(rowIndex: number, col: string, rowData?: Record<string, unknown>): string | null {
    const cf = this.getConditionalFormat(col, rowData).textColor;
    if (cf) return cf;
    return this.exportColors.resolveCellTextColor(rowIndex, col, this.exportPageSize(), this.exportColorSource());
  }

  /** True when the given data-row/field cell was set to vertical orientation (for exports). */
  private isExportCellVertical(rowIndex: number, field: string): boolean {
    return this.config?.cellOrientations?.[`${rowIndex}:${field}`] === 'vertical';
  }

  /** True when the given column's header was set to vertical orientation (for exports). */
  private isExportHeaderVertical(field: string): boolean {
    return this.config?.headerCellOrientations?.[field] === 'vertical';
  }

  /** Single continuous table for Excel — no page breaks, no repeated header/footer. */
  private buildExcelHtml(headers: string[]): string {
    const title = this.escapeHtml(this.report?.reportName || 'Report');
    const hdrBg = this.sanitizeCssColor(this.config?.headerBackgroundColor || '', '#21409A');
    const hdrColor = this.sanitizeCssColor(this.config?.headerTextColor || '', '#FFFFFF');
    const bannerBg = this.sanitizeCssColor(this.config?.bannerBackgroundColor || '', '#EDEFF4');
    const bannerColor = this.sanitizeCssColor(this.config?.bannerTextColor || '', '#344054');
    const fontFam = this.sanitizeCssFont(this.config?.fontFamily || '', 'Inter, Arial, sans-serif');
    const fontSize = Math.max(8, Math.min(72, this.config?.fontSize || 12));
    const headerTitle = this.escapeHtml(this.config?.headerTitle || '');
    const headerSubtitle = this.escapeHtml(this.config?.headerSubtitle || '');
    const bannerText = this.escapeHtml(this.config?.bannerText || '');
    const displayTitle = headerTitle || title;
    const colCount = this.displayColumns.length + 1;

    const chunkConfigs = this.displayColumns.map(col =>
      this.config?.columns?.find(c => c.field === col)
    );
    const hasGroups = this.hasGroupHeaders;
    const hasSubs = this.hasSubGroupHeaders;

    // Title row
    let html = `<tr><td colspan="${colCount}" style="padding:10px;background:${hdrBg};color:${hdrColor};font-size:16px;font-weight:700;text-align:center">${displayTitle}${headerSubtitle ? '<br><span style="font-size:12px;font-weight:400;opacity:0.85">' + headerSubtitle + '</span>' : ''}</td></tr>`;

    // Group header row
    if (hasGroups) {
      html += '<tr>';
      html += `<th rowspan="${1 + (hasSubs ? 1 : 0) + 1}" style="border:1px solid #ddd;padding:6px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
      let ci = 0;
      while (ci < chunkConfigs.length) {
        const grp = chunkConfigs[ci]?.group || '';
        let span = 1;
        while (ci + span < chunkConfigs.length && (chunkConfigs[ci + span]?.group || '') === grp) span++;
        if (grp) {
          html += `<th colspan="${span}" style="border:1px solid #1a3580;padding:6px;background:#21409A;color:#fff;font-size:11px;font-weight:600;text-align:center">${grp}</th>`;
        } else {
          const totalRows = 1 + (hasSubs ? 1 : 0) + 1;
          for (let j = 0; j < span; j++) {
            html += `<th rowspan="${totalRows}" style="border:1px solid #ddd;padding:6px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center;vertical-align:middle">${headers[ci + j]}</th>`;
          }
        }
        ci += span;
      }
      html += '</tr>';
    }

    // SubGroup header row
    if (hasSubs) {
      html += '<tr>';
      if (!hasGroups) {
        html += `<th rowspan="2" style="border:1px solid #ddd;padding:6px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
      }
      let ci = 0;
      while (ci < chunkConfigs.length) {
        const hasGrp = !!chunkConfigs[ci]?.group;
        const sub = chunkConfigs[ci]?.subGroup || '';
        let span = 1;
        while (ci + span < chunkConfigs.length && (chunkConfigs[ci + span]?.subGroup || '') === sub) span++;
        if (!hasGrp && hasGroups) { ci += span; continue; }
        if (sub) {
          html += `<th colspan="${span}" style="border:1px solid #D5E3F7;padding:5px;background:#EEF4FF;color:#21409A;font-size:10px;font-weight:600;text-align:center">${sub}</th>`;
        } else {
          for (let j = 0; j < span; j++) {
            if (hasGrp) html += `<th rowspan="2" style="border:1px solid #ddd;padding:5px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center;vertical-align:middle">${headers[ci + j]}</th>`;
          }
        }
        ci += span;
      }
      html += '</tr>';
    }

    // Column header row
    html += '<tr>';
    if (!hasGroups && !hasSubs) {
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
    }
    for (let i = 0; i < chunkConfigs.length; i++) {
      if (hasGroups && !chunkConfigs[i]?.group) continue;
      if (hasSubs && chunkConfigs[i]?.group && !chunkConfigs[i]?.subGroup) continue;
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:#f5f5f5;font-size:11px;font-weight:600;text-align:center">${headers[i]}</th>`;
    }
    html += '</tr>';

    // All data rows — continuous, no pagination
    for (let ri = 0; ri < this.allRows.length; ri++) {
      const row = this.allRows[ri];
      html += `<tr><td style="border:1px solid #ddd;padding:5px 10px;font-size:11px;text-align:center">${ri + 1}</td>`;
      for (const col of this.displayColumns) {
        const val = row[col];
        const display = val == null ? '—' : this.escapeHtml(String(val));
        const bg = this.getExportCellBg(ri, col, row);
        const fg = this.getExportCellFg(ri, col, row);
        const bgStyle = bg ? `background:${bg};` : '';
        const fgStyle = fg ? `color:${fg};` : '';
        html += `<td style="border:1px solid #ddd;padding:5px 10px;font-size:11px;${bgStyle}${fgStyle}">${display}</td>`;
      }
      html += '</tr>';
    }

    // Banner/footer
    if (bannerText) {
      html += `<tr><td colspan="${colCount}" style="padding:8px;background:${bannerBg};font-size:12px;font-weight:500;text-align:center;color:${bannerColor}">${bannerText}</td></tr>`;
    }

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>body{font-family:${fontFam};font-size:${fontSize}px}table{border-collapse:collapse;width:100%}</style></head><body><table>${html}</table></body></html>`;
  }

  private buildPrintHtml(headers: string[], rows: Record<string, unknown>[]): string {
    const title = this.escapeHtml(this.report?.reportName || 'Report');
    // Appearance settings
    const hdrBg = this.sanitizeCssColor(this.config?.headerBackgroundColor || '', '#21409A');
    const hdrColor = this.sanitizeCssColor(this.config?.headerTextColor || '', '#FFFFFF');
    const bannerBg = this.sanitizeCssColor(this.config?.bannerBackgroundColor || '', '#EDEFF4');
    const bannerColor = this.sanitizeCssColor(this.config?.bannerTextColor || '', '#344054');
    // Print/PDF is real browser CSS, so unlike the Excel export it can render the builder's
    // actual gradient (or solid color) exactly — falling back to the builder's own default
    // gradient, not a flat hex, so an unmodified report matches the builder preview exactly.
    const richBannerBg = this.sanitizeCssBackground(
      this.config?.headerBackgroundColor || '',
      'linear-gradient(90.37deg, #162B6F 0%, #1B3585 30%, #21409A 58%, #2852B1 82%, #315FC2 100%)',
    );
    const fontFam = this.sanitizeCssFont(this.config?.fontFamily || '', 'Inter, Arial, sans-serif');
    const fontSize = Math.max(8, Math.min(72, this.config?.fontSize || 12));
    // Footer banner font size mirrors the on-screen report footer (config.bannerFontSize).
    const bannerFontSize = Math.max(8, Math.min(72, this.config?.bannerFontSize || 12));
    const headerTitle = this.escapeHtml(this.config?.headerTitle || '');
    const headerSubtitle = this.escapeHtml(this.config?.headerSubtitle || '');
    const bannerText = this.escapeHtml(this.config?.bannerText || '');
    const displayTitle = headerTitle || title;
    const hasFooter = !!bannerText;
    const headerRowBg = this.sanitizeCssColor(this.config?.headerRowColor || '', '#E8F0FC');
    const groupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 0)?.color || '', '#21409A');
    const subGroupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 1)?.color || '', '#EEF4FF');
    const groupHeaderText = this.sanitizeCssColor(this.config?.groupTextColor || '', '#FFFFFF');
    const subGroupHeaderText = this.sanitizeCssColor(this.config?.subGroupTextColor || '', '#FFFFFF');

    // Keep a single continuous table so the export mirrors the report view.
    const maxCols = this.displayColumns.length;
    const maxRows = rows.length || 1;
    const allCols = this.displayColumns;
    const allHeaders = headers;
    // Totals/subtotal rows carry a flag; they get a "Total" label instead of a serial number, and
    // the serial numbering (+ index-based cell colors) counts only real data rows.
    let dataSeqCounter = 0;
    const dataSeqByIndex = rows.map(r => (r[this.TOTALS_ROW_FLAG] ? -1 : dataSeqCounter++));
    const dataRowCount = dataSeqCounter;
    const colChunks: { cols: string[]; headers: string[]; startIdx: number }[] = [];

    for (let i = 0; i < allCols.length; i += maxCols) {
      colChunks.push({
        cols: allCols.slice(i, i + maxCols),
        headers: allHeaders.slice(i, i + maxCols),
        startIdx: i,
      });
    }

    // Split rows into batches
    const rowBatches: Record<string, unknown>[][] = [];
    for (let r = 0; r < rows.length; r += maxRows) {
      rowBatches.push(rows.slice(r, r + maxRows));
    }

    // Banner text values (used inside the per-page loop for the first page)
    const companyEsc = this.escapeHtml(this.companyName);
    const contractEsc = this.escapeHtml(this.contractInfo);
    const contract2Esc = this.escapeHtml(this.contractInfo2);
    const typeEsc = this.escapeHtml(this.reportTypeLabel);
    const titleEsc = this.escapeHtml(this.bannerTitle);
    const periodEsc = this.escapeHtml(this.bannerPeriod);
    const leftLogoHtml = this.buildExportLogoHtml(this.config?.leftLogoUrl, 'Left logo', 'rv-export-banner__logo-img');
    const rightLogoHtml = this.buildExportLogoHtml(this.config?.rightLogoUrl, 'Right logo', 'rv-export-banner__logo-img');

    // Build standalone banner (KPIs hidden for now)
    let bannerHtml = `<div class="rv-export-banner"><div class="rv-export-banner__left">${leftLogoHtml ? '<div class="rv-export-banner__logo">' + leftLogoHtml + '</div>' : ''}<div><div class="rv-export-banner__company">${companyEsc}</div><div class="rv-export-banner__contract">${contractEsc}</div>${contract2Esc ? '<div class="rv-export-banner__contract">' + contract2Esc + '</div>' : ''}</div></div><div class="rv-export-banner__right"><div><div class="rv-export-banner__type">${typeEsc}</div><div class="rv-export-banner__title">${titleEsc}</div><div class="rv-export-banner__period">${periodEsc}</div></div>${rightLogoHtml ? '<div class="rv-export-banner__logo rv-export-banner__logo--right">' + rightLogoHtml + '</div>' : ''}</div></div>`;

    // Build pages: for each row batch, output all column chunks, then move to next batch
    // Page order: batch1-cols1-9, batch1-cols10-16, batch1-cols17-24, batch2-cols1-9, ...
    let tablesHtml = '';
    let isFirstPage = true;

    for (let bi = 0; bi < rowBatches.length; bi++) {
      const rowBatch = rowBatches[bi];
      const rowStart = bi * maxRows;

      for (let ci = 0; ci < colChunks.length; ci++) {
        const chunk = colChunks[ci];
        const chunkColCount = chunk.cols.length + 1; // +1 for Sl.No
        // Fixed layout + an explicit colgroup makes the table fit the page width exactly instead of
        // overflowing (and getting clipped) when there are many columns: Sl.No keeps a small fixed
        // width and the data columns share the remaining width equally, wrapping their content.
        const colGroup = `<colgroup><col style="width:34px"/>${'<col/>'.repeat(chunk.cols.length)}</colgroup>`;
        const colLabel = colChunks.length > 1
          ? ` (Cols ${chunk.startIdx + 1}–${chunk.startIdx + chunk.cols.length})`
          : '';
        const rowLabel = rowBatches.length > 1
          ? ` · Rows ${rowStart + 1}–${rowStart + rowBatch.length}`
          : '';

        // Page break before every page except the first
        if (!isFirstPage) {
          tablesHtml += '<div style="page-break-after:always"></div>';
        }
        const isFirst = isFirstPage;
        isFirstPage = false;

        // Column header rows with group/subgroup spans for this chunk
        let thead = '';
        // Get config columns for this chunk
        const chunkConfigs = chunk.cols.map(col =>
          this.config?.columns?.find(c => c.field === col)
        );
        const hasChunkGroups = chunkConfigs.some(c => !!c?.group);
        const hasChunkSubs = chunkConfigs.some(c => !!c?.subGroup);

        // Group header row
        if (hasChunkGroups) {
          thead += '<tr>';
          thead += `<th rowspan="${1 + (hasChunkSubs ? 1 : 0) + 1}" style="border:1px solid #D9E0EA;padding:6px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
          let ci2 = 0;
          while (ci2 < chunkConfigs.length) {
            const grp = chunkConfigs[ci2]?.group || '';
            let span = 1;
            while (ci2 + span < chunkConfigs.length && (chunkConfigs[ci2 + span]?.group || '') === grp) span++;
            if (grp) {
              const gBg = this.sanitizeCssColor(this.config?.groupColors?.[grp] || '', groupHeaderBg);
              thead += `<th colspan="${span}" style="border:1px solid #D9E0EA;padding:6px;background:${gBg};color:${groupHeaderText};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(grp)}</th>`;
            } else {
              // No group — vertically merge down to column header row
              const totalHeaderRows = 1 + (hasChunkSubs ? 1 : 0) + 1;
              for (let j = 0; j < span; j++) {
                const fieldBg = this.getHeaderCellBg(chunk.cols[ci2 + j], headerRowBg);
                thead += `<th rowspan="${totalHeaderRows}" style="border:1px solid #D9E0EA;padding:6px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle;white-space:pre-line">${this.escapeHtmlWithLineBreaks(chunk.headers[ci2 + j])}</th>`;
              }
            }
            ci2 += span;
          }
          thead += '</tr>';
        }

        // SubGroup header row
        if (hasChunkSubs) {
          thead += '<tr>';
          if (!hasChunkGroups) {
            thead += `<th rowspan="2" style="border:1px solid #D9E0EA;padding:6px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
          }
          let ci2 = 0;
          while (ci2 < chunkConfigs.length) {
            const hasGrp = !!chunkConfigs[ci2]?.group;
            const group = chunkConfigs[ci2]?.group || '';
            const sub = chunkConfigs[ci2]?.subGroup || '';
            let span = 1;
            while (
              ci2 + span < chunkConfigs.length
              && (chunkConfigs[ci2 + span]?.group || '') === group
              && (chunkConfigs[ci2 + span]?.subGroup || '') === sub
            ) span++;

            if (!hasGrp && hasChunkGroups) {
              // Already vertically merged from group row
              ci2 += span;
              continue;
            }
            if (sub) {
              const sgBg = this.sanitizeCssColor(this.config?.subGroupColors?.[sub] || '', subGroupHeaderBg);
              thead += `<th colspan="${span}" style="border:1px solid #D9E0EA;padding:5px;background:${sgBg};color:${subGroupHeaderText};font-size:10px;font-weight:600;text-align:center;white-space:pre-line">${this.escapeHtmlWithLineBreaks(sub)}</th>`;
            } else {
              // Keep the subgroup band aligned; the actual column label stays below.
              for (let j = 0; j < span; j++) {
                if (hasGrp) {
                  thead += `<th style="border:1px solid #D9E0EA;padding:5px;background:${subGroupHeaderBg};color:#fff;font-size:11px;font-weight:600;text-align:center"></th>`;
                }
              }
            }
            ci2 += span;
          }
          thead += '</tr>';
        }

        // Column header row
        thead += '<tr>';
        if (!hasChunkGroups && !hasChunkSubs) {
          thead += `<th style="border:1px solid #D9E0EA;padding:6px 10px;background:${headerRowBg};font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
        }
        for (let hi = 0; hi < chunkConfigs.length; hi++) {
          const hasGrp = !!chunkConfigs[hi]?.group;
          const hasSub = !!chunkConfigs[hi]?.subGroup;
          const fieldBg = this.getHeaderCellBg(chunk.cols[hi], headerRowBg);
          // Skip cols already merged vertically
          if (hasChunkGroups && !hasGrp) continue;
          // Vertical-orientation headers render the label rotated (bottom-to-top).
          const hdrText = this.escapeHtmlWithLineBreaks(chunk.headers[hi]);
          const hdrInner = this.isExportHeaderVertical(chunk.cols[hi])
            ? `<div style="writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block;">${hdrText}</div>`
            : hdrText;
          if (hasChunkSubs && hasGrp && !hasSub) {
            thead += `<th style="border:1px solid #D9E0EA;padding:6px 10px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${hdrInner}</th>`;
            continue;
          }
          thead += `<th style="border:1px solid #D9E0EA;padding:6px 10px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${hdrInner}</th>`;
        }
        thead += '</tr>';

        // Data rows for this batch
        let tbody = '';
        for (let ri = 0; ri < rowBatch.length; ri++) {
          const row = rowBatch[ri];
          const globalRowIdx = rowStart + ri;
          if (row[this.TOTALS_ROW_FLAG]) {
            const label = this.escapeHtml(String(row[this.TOTALS_LABEL_KEY] ?? 'Total'));
            const slNoTd = `<td style="border:1px solid #D9E0EA;padding:5px 10px;font-size:12px;font-weight:700;text-align:center">${label}</td>`;
            const tds = chunk.cols.map(col => {
              // const display = this.escapeHtml(this.getExportDisplayValue(row, col));
              let display;
              if (typeof this.getExportDisplayValue(row, col) === 'string') {
                display = this.escapeHtml(this.getExportDisplayValue(row, col) as string);
              } else {
                display = this.getExportDisplayValue(row, col);
              }
              return `<td style="border:1px solid #D9E0EA;padding:5px 10px;font-size:12px;font-weight:700">${display}</td>`;
            }).join('');
            tbody += `<tr>${slNoTd}${tds}</tr>`;
            continue;
          }
          const dataIdx = dataSeqByIndex[globalRowIdx];
          const slNo = dataIdx + 1;
          const slNoTd = `<td style="border:1px solid #D9E0EA;padding:5px 10px;font-size:11px;text-align:center">${slNo}</td>`;
          const tds = chunk.cols.map(col => {
            let display;
            if (typeof this.getExportDisplayValue(row, col) === 'string') {
              display = this.escapeHtml(this.getExportDisplayValue(row, col) as string);
            } else {
              display = this.getExportDisplayValue(row, col);
            }
            const bg = this.getExportCellBg(dataIdx, col, row);
            const fg = this.getExportCellFg(dataIdx, col, row);
            const bgStyle = bg ? `background:${bg};` : '';
            const fgStyle = fg ? `color:${fg};` : '';
            // Vertical-orientation cells render the full value as rotated, wrapping text.
            const cellInner = this.isExportCellVertical(dataIdx, col)
              ? `<div style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:normal;word-break:break-word;max-height:150px;">${display}</div>`
              : display;
            const vAlign = this.isExportCellVertical(dataIdx, col) ? 'vertical-align:top;' : '';
            return `<td style="border:1px solid #D9E0EA;padding:5px 10px;font-size:11px;${bgStyle}${fgStyle}${vAlign}">${cellInner}</td>`;
          }).join('');
          tbody += `<tr>${slNoTd}${tds}</tr>`;
        }

        if (isFirst) {
          // First page: banner + KPIs + data table directly, no outer wrapper
          // The configured footer banner rides in a <tfoot> (table-footer-group) so it repeats at
          // the bottom of every printed page, matching the on-screen report footer.
          tablesHtml += `
            ${bannerHtml}
            <table style="border-collapse:collapse;width:100%;table-layout:fixed">
              ${colGroup}
              <thead>${thead}</thead>
              ${hasFooter ? '<tfoot><tr><td colspan="' + chunkColCount + '" style="padding:0"><div class="report-footer">' + bannerText + '</div></td></tr></tfoot>' : ''}
              <tbody>${tbody}</tbody>
            </table>
            <p style="color:#888;font-size:10px;margin-top:6px;text-align:right">${dataRowCount} total rows · ${allCols.length + 1} total columns${colLabel}${rowLabel}</p>
          `;
        } else {
          tablesHtml += `
            <table style="width:100%">
              <thead>
                <tr><td colspan="${chunkColCount}" style="padding:0">
                  <div class="report-header">
                    ${displayTitle}${colLabel}${rowLabel}
                    ${headerSubtitle ? '<br><span class="report-header-subtitle">' + headerSubtitle + '</span>' : ''}
                  </div>
                </td></tr>
              </thead>
              <tfoot>
                <tr><td colspan="${chunkColCount}" style="padding:0">
                  ${hasFooter ? '<div class="report-footer">' + bannerText + '</div>' : '<div style="height:3mm"></div>'}
                </td></tr>
              </tfoot>
              <tbody>
                <tr><td colspan="${chunkColCount}" style="padding:0">
                  <table style="border-collapse:collapse;width:100%;table-layout:fixed">
                    ${colGroup}
                    <thead>${thead}</thead>
                    <tbody>${tbody}</tbody>
                  </table>
                  <p style="color:#888;font-size:10px;margin-top:6px;text-align:right">${dataRowCount} total rows · ${allCols.length + 1} total columns${colLabel}${rowLabel}</p>
                </td></tr>
              </tbody>
            </table>
          `;
        }
      }
    }

    return `<!DOCTYPE html><html><head><title>${displayTitle}</title>
    <style>
      @page { size: landscape; margin: 15mm 10mm 15mm 10mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
      }
      * { box-sizing: border-box; }
      body { font-family: ${fontFam}; margin: 0; padding: 0; font-size: ${fontSize}px; }
      /* Fixed table layout clips overflow, so let long values/headers wrap within their column. */
      td, th { word-break: break-word; overflow-wrap: anywhere; }
      .report-header {
        background: ${hdrBg}; color: ${hdrColor}; padding: 10px 14px;
        font-size: 16px; font-weight: 700; text-align: center;
        margin-bottom: 8px; border-radius: 4px;
      }
      .report-header-subtitle { font-size: 12px; font-weight: 400; opacity: 0.85; }
      .report-footer {
        background: ${bannerBg}; padding: 8px 14px;
        font-size: ${bannerFontSize}px; font-weight: 500; text-align: center;
        color: ${bannerColor}; border-top: 1px solid #ddd;
        margin-top: 8px; border-radius: 4px;
      }
      .rv-export-banner {
        display: flex; justify-content: space-between; align-items: center;
        padding: 24px 28px; border-radius: 14px; color: ${hdrColor}; margin-bottom: 16px;
        background: ${richBannerBg};
      }
      .rv-export-banner__left,
      .rv-export-banner__right { display: flex; align-items: center; gap: 16px; }
      .rv-export-banner__logo {
        width: 52px; height: 52px; min-width: 52px; display: flex;
        align-items: center; justify-content: center; border-radius: 12px;
        background: rgba(255,255,255,0.92); overflow: hidden;
      }
      .rv-export-banner__logo--right { background: transparent; }
      .rv-export-banner__logo-img { max-width: 44px; max-height: 44px; object-fit: contain; display: block; }
      .rv-export-banner__company { font-size: 18px; font-weight: 600; letter-spacing: 0.01em; }
      .rv-export-banner__contract { font-size: 14px; color: #D8DDE7; margin-top: 5px; font-weight: 500; }
      .rv-export-banner__right { text-align: right; }
      .rv-export-banner__type { font-size: 13px; font-weight: 500; }
      .rv-export-banner__title { font-size: 24px; font-weight: 700; margin-top: 2px; }
      .rv-export-banner__period { font-size: 13px; color: #D9D9D9; margin-top: 3px; font-weight: 500; }
      .rv-export-kpis {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px;
      }
      .rv-export-kpi {
        padding: 19px 18px; border-radius: 12px;
        border: 1px solid #E2E7EF; background: #fff;
        box-shadow: 0 2px 8px 0 rgba(16,24,40,0.06);
      }
      .rv-export-kpi__head { display: flex; align-items: flex-start; gap: 12px; }
      .rv-export-kpi__icon {
        display: flex; width: 40px; height: 40px; min-width: 40px;
        align-items: center; justify-content: center; border-radius: 10px;
      }
      .rv-export-kpi__label { font-size: 13px; font-weight: 500; color: #344054; margin-bottom: 5px; }
      .rv-export-kpi__value { font-size: 24px; font-weight: 700; color: #101828; margin-top: 10px; line-height: 1.2; }
      .rv-export-kpi__hint { font-size: 12px; color: #667085; margin-top: 10px; }
      table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
      tr { page-break-inside: avoid; }
    </style></head>
    <body>${tablesHtml}</body></html>`;
  }
}

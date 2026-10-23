import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, NgZone, HostListener } from '@angular/core';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';
import type { AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, switchMap, of, map, Subject, firstValueFrom } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { TenantReportsService, TenantReportDto } from '../../../core/services/tenant-reports.service';
import { resolveClusterBanner } from '../shared/report-cluster-banner.util';
import { CommonApiService, PlantFilterDto, TableDataDto } from '../../../core/services/common-api.service';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  globalSelectionValues,
  hasGlobalSelection,
  matchesGlobalSelection,
  isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
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
import { buildReportAutoGroupColumnStyles, dedupeBorderSides, defaultReportCellAlign, getPinnedSummaryLabel, getSummaryRowStyle, getReportGroupRowStyle, ReportHeaderGroupRef, resolveGroupHeaderAlign, resolveReportGroupRowStyle, resolveStoredSides } from '../shared/report-grid-columns.util';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { PinHeaderComponent } from './pin-header.component';
import { EmbeddedCellComponent } from '../report-builder/embedded-cell.component';
import { AdvancedFilterComponent } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { CellBorder, ReportJsonColumn, ReportJsonConfig, ReportLegendItem, ReportSheetConfig, TableDensity, TextAlign } from '../shared/report-config.model';
import { buildReportGridColumns, formatGridNumberValue, computeTotalsRows, computeGrandTotalRow, TOTALS_LABEL_FIELD, isBooleanColumn, isDateColumn, isNumericColumn, aggregateReportValues, isSerialNumberField, reconcileRowLayout, materializeRows, REPORT_AGG_FUNCS, hasRowMerges, evaluateConditionalRules, createDuplicateValueLookup, VERTICAL_CELL_ROW_HEIGHT, rowHasVerticalCell, ROW_COLOR_KEY, ROW_NUMBER_COL_ID, getReportRowColorKey, getReportCellSetting, reportCellSettingKey, createColumnConfigResolver,resolveHeaderBackgroundColor, resolveHeaderTextColor } from '../shared/report-grid-columns.util';
import { coerceNumberAllowPercent } from '../../../core/utils/percent-number.util';
import { growReportColumnsToFitValues } from '../shared/report-column-autosize.util';
import { evaluateDaxMeasure, evaluateDaxMeasureForRow, formatDaxValue, getActiveDaxMeasures, getSelectableDaxMeasures, withViewerMeasure } from '../../../core/utils/dax-evaluator.util';
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
    headerClass: (params) => this.exportHeaderClass(params.column?.getColDef().field ?? params.column?.getColId()),
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
  /** Marks a row-group header row in an Excel export (e.g. "Nimr (12)"), mirroring the grid's group accordion. */
  private readonly GROUP_LABEL_FLAG = '__isGroupLabelRow';

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
      return getSummaryRowStyle(this.config, getPinnedSummaryLabel(node));
    }
    return getReportGroupRowStyle(this.config, node);
  };

  // Rows containing a vertical-orientation cell get an explicit tall height so the rotated
  // text can wrap into multiple columns (AG's autoHeight can't measure rotated content).
  getRowHeight = (params: RowHeightParams): number | undefined => {
    if (!params.node?.rowPinned && !params.node?.group && !params.node?.footer
      && rowHasVerticalCell(this.config?.cellOrientations, params.node?.rowIndex, params.data)) {
      return VERTICAL_CELL_ROW_HEIGHT;
    }
    return this.gridRowHeight;
  };

  // Total/grand-total footer label reflects the grouped column's aggregation (Average/Sum),
  // falling back to "Total" when none is set.
  gridAutoGroupColumnDef: ColDef = {
    ...buildReportAutoGroupColumnStyles(() => this.config),
    minWidth: 180,
    tooltip: (params) => (params.value != null ? String(params.value) : ''),
    cellRendererParams: {
      footerValueGetter: (params: { colDef?: { showRowGroup?: boolean | string }; value?: unknown }) => {
        const field = typeof params?.colDef?.showRowGroup === 'string' ? params.colDef.showRowGroup : undefined;
        const agg = field ? this.columnConfig(field)?.aggFunc : undefined;
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
  // Row groups start fully expanded (-1 = all levels). Users can still collapse/expand
  // individual groups by clicking; manual state is preserved by the filteredRowsCache.
  gridGroupDefaultExpanded = -1;
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

  /**
   * Closes any open AG Grid popup (column/context menu) and the custom column
   * context menu whenever the page scrolls. Registered on `document` in the
   * capture phase so it also fires for scrolls on nested containers (the report
   * scroll area and the grid body) that don't bubble. Without this, the menu —
   * which is anchored to `document.body` — stays put while the report scrolls,
   * leaving it detached/floating over the content.
   */
  private readonly hideGridMenusOnScroll = (): void => {
    this.gridApi?.hidePopupMenu();
    this.liveExpandGridApi?.hidePopupMenu();
    if (this.colContextMenuVisible) {
      this.colContextMenuVisible = false;
      this.cdr.markForCheck();
    }
  };

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
    this.growColumnsToFitValues('main');
    this.computePinnedBottomRow();
  }

  /** Rows can change after the first render (global filters, lazy loading); widen columns so
   *  every value stays fully visible unless the user switched to fit-to-width. */
  onMainRowDataUpdated(): void {
    if (this.columnSizingMode === 'auto') this.growColumnsToFitValues('main');
  }

  /** Widens columns to their longest value across all pages (AG autoSize only measures rendered rows). */
  private growColumnsToFitValues(grid: 'main' | 'expand'): void {
    setTimeout(() => {
      const api = grid === 'main' ? this.gridApi : this.liveExpandGridApi;
      growReportColumnsToFitValues(api, {
        container: document.querySelector(grid === 'main' ? '.rv-main-grid' : '.rv-expand-grid'),
        skipCell: (node, column) =>
          getReportCellSetting(this.config?.cellOrientations, node.data, node.rowIndex, column.getColDef().field ?? '') === 'vertical',
      });
    });
  }

  onColumnRowGroupChanged(event: ColumnRowGroupChangedEvent): void {
    if (event.api.isDestroyed()) return;
    event.api.expandAll();
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
    this.growColumnsToFitValues('expand');
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
          const rowColorKey = params.data?.[ROW_COLOR_KEY];
          const stableKey = typeof rowColorKey === 'string'
            ? reportCellSettingKey(rowColorKey, field)
            : `${params.node?.rowIndex}:${field}`;
          const legacyKey = `${params.node?.rowIndex}:${field}`;
          const embed = embeds[stableKey] ?? embeds[legacyKey];
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
    this.growColumnsToFitValues('main');
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
    const selections: Record<string, GlobalFilterSelection> = {
      country: this.filterCountry, sector: this.filterSector, businessUnit: this.filterBusinessUnit,
      division: this.filterDivision, cluster: this.filterCluster, plant: this.filterPlant,
    };
    if (hasGlobalSelection(selections[String(key)])) this.selectFilterOption(String(key), 'All');
  }

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
  filterFrom = '';
  filterTo = '';
  filterQuickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After', 'Custom'];
  filterQuickRange = '';
  private allPlants: PlantFilterDto[] = [];
  private readonly destroy$ = new Subject<void>();

  // Snapshot of the filter values as first loaded (plant auto-selection + saved report config),
  // captured once both finish, so "Reset Filter" restores them instead of clearing to All/empty.
  private defaultFilterState: {
    country: GlobalFilterSelection; sector: GlobalFilterSelection; businessUnit: GlobalFilterSelection; division: GlobalFilterSelection;
    cluster: GlobalFilterSelection; plant: GlobalFilterSelection; quickRange: string; from: string; to: string;
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

  filterLabel(selection: GlobalFilterSelection): string {
    return globalSelectionLabel(selection);
  }

  hasGlobalSelection(selection: GlobalFilterSelection): boolean {
    return hasGlobalSelection(selection);
  }

  isFilterOptionSelected(selection: GlobalFilterSelection, value: string): boolean {
    return isGlobalFilterOptionChecked(selection, value);
  }

  private globalFilterOptions(field: string): string[] {
    switch (field) {
      case 'country': return this.filterCountryOptions;
      case 'sector': return this.filterSectorOptions;
      case 'businessUnit': return this.filterBusinessUnitOptions;
      case 'division': return this.filterDivisionOptions;
      case 'cluster': return this.filterClusterOptions;
      case 'plant': return this.filterPlantOptions;
      default: return [];
    }
  }

  selectFilterOption(name: string, value: string): void {
    const v = value || 'All';
    const select = (current: GlobalFilterSelection): GlobalFilterSelection =>
      v === 'All' ? 'All' : toggleGlobalSelection(current, v, this.globalFilterOptions(name), this.globalFilterClear.consume(name));
    switch (name) {
      case 'country':      this.filterCountry = select(this.filterCountry); this.filterSector = 'All'; this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'sector':       this.filterSector = select(this.filterSector); this.filterBusinessUnit = 'All'; this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'businessUnit': this.filterBusinessUnit = select(this.filterBusinessUnit); this.filterDivision = 'All'; this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'division':     this.filterDivision = select(this.filterDivision); this.filterCluster = 'All'; this.filterPlant = 'All'; break;
      case 'cluster':      this.filterCluster = select(this.filterCluster); this.filterPlant = 'All'; break;
      case 'plant':        this.filterPlant = select(this.filterPlant); break;
      case 'quickRange':   this.filterQuickRange = value; this.applyQuickRange(value); break;
    }
    const resetCluster = name === 'cluster' && !hasGlobalSelection(this.filterCluster);
    const resetPlant = resetCluster || (name === 'plant' && !hasGlobalSelection(this.filterPlant));
    this.rebuildCascadingOptions(resetCluster, resetPlant);
    this.openFilterName = null;
    this.applyGlobalFilter();
    if (name === 'quickRange') this.openFilterName = null;
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
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    if (this.filterCountryOptions.length === 1) this.filterCountry = this.filterCountryOptions[0];
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.filterCountry));
    const sectors = this.distinctValues(filtered, p => p.sector);
    if (sectors.length === 1) this.filterSector = sectors[0];
    if (active(this.filterSector)) filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.filterSector));
    const bus = this.distinctValues(filtered, p => p.businessUnit);
    if (bus.length === 1) this.filterBusinessUnit = bus[0];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.filterBusinessUnit));
    const divs = this.distinctValues(filtered, p => p.division);
    if (divs.length === 1) this.filterDivision = divs[0];
  }

  private rebuildCascadingOptions(suppressAutoCluster = false, suppressAutoPlant = false): void {
    const active = (v: GlobalFilterSelection) => hasGlobalSelection(v);
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => matchesGlobalSelection(p.country, this.filterCountry));
    this.filterSectorOptions = active(this.filterCountry) ? this.distinctValues(filtered, p => p.sector) : [];
    if (active(this.filterSector)) filtered = filtered.filter(p => matchesGlobalSelection(p.sector, this.filterSector));
    this.filterBusinessUnitOptions = active(this.filterSector) ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => matchesGlobalSelection(p.businessUnit, this.filterBusinessUnit));
    this.filterDivisionOptions = active(this.filterBusinessUnit) ? this.distinctValues(filtered, p => p.division) : [];
    if (active(this.filterDivision)) filtered = filtered.filter(p => matchesGlobalSelection(p.division, this.filterDivision));
    this.filterClusterOptions = active(this.filterDivision) ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    if (!suppressAutoCluster && !active(this.filterCluster) && this.filterClusterOptions.length === 1) this.filterCluster = this.filterClusterOptions[0];
    if (active(this.filterCluster)) filtered = filtered.filter(p => matchesGlobalSelection(p.cluster, this.filterCluster));
    this.filterPlantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (!suppressAutoPlant && !active(this.filterPlant) && this.filterPlantOptions.length === 1) this.filterPlant = this.filterPlantOptions[0];
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
  private advancedFilters: ReturnType<typeof advancedHierarchyFilters> = [];

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.applyGlobalFilter();
  }

  private filterRowsByGlobalCriteria(inRows: Record<string, unknown>[]): Record<string, unknown>[] {
    let rows = inRows;
    const hierarchyFilters: [string, GlobalFilterSelection][] = [
      ['country', this.filterCountry],
      ['sector', this.filterSector],
      ['businessUnit', this.filterBusinessUnit],
      ['division', this.filterDivision],
      ['cluster', this.filterCluster],
      ['plant', this.filterPlant],
    ];
    for (const [field, selected] of hierarchyFilters) {
      if (!hasGlobalSelection(selected) || !rows.length) continue;
      const column = this.findGlobalFilterColumn(rows[0], field);
      if (column) rows = rows.filter(row => matchesGlobalSelection(row[column], selected));
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
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
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
      const grp = this.columnConfig(col)?.group;
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
      const grp = this.columnConfig(col)?.group;
      return !grp;
    });
  }

  /** Distinct column group names, in column order — drives the grouped-chips row. */
  get groupChipNames(): string[] {
    const names: string[] = [];
    for (const col of this.displayColumns) {
      const grp = this.columnConfig(col)?.group;
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
    return this.buildSpans(this.visibleColumns, col => this.columnConfig(col)?.group || '');
  }

  get visibleSubGroupHeaderSpans(): { label: string; colspan: number; accentGroup: string }[] {
    return this.buildSpans(
      this.visibleColumns,
      col => this.columnConfig(col)?.subGroup || '',
      col => this.columnConfig(col)?.group || '',
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
    const grp = this.columnConfig(field)?.group;
    return grp ? this.groupAccent(grp)?.cell ?? null : null;
  }

  get hasVisibleGroupHeaders(): boolean {
    return this.activeTab !== 'all' && this.visibleColumns.some(col => !!this.columnConfig(col)?.group);
  }

  get hasVisibleSubGroupHeaders(): boolean {
    return this.activeTab !== 'all' && this.visibleColumns.some(col => !!this.columnConfig(col)?.subGroup);
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

  /** The selected cluster names, or '' when none ('All') is selected. */
  get selectedClusterName(): string {
    return this.clusterBanner.selectedClusterName;
  }

  private get clusterBanner() {
    return resolveClusterBanner(this.config, this.filterCluster, this.report?.reportName || 'Report');
  }

  get showClusterBanner(): boolean {
    return this.clusterBanner.visible && !!this.report;
  }

  /** Secondary banner title, e.g. "JOB PROGRESS REPORT - NIMR". */
  get clusterBannerTitle(): string {
    return this.clusterBanner.title;
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
    document.addEventListener('scroll', this.hideGridMenusOnScroll, true);
  }

  ngOnDestroy(): void {
    this.viewDestroyed = true;
    document.removeEventListener('scroll', this.hideGridMenusOnScroll, true);
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

  get configuredLegends(): ReportLegendItem[] {
    const legends = this.config?.legends;
    return (Array.isArray(legends) ? legends : []).filter(legend =>
      !!legend
      && typeof legend.label === 'string'
      && !!legend.label.trim()
      && typeof legend.color === 'string'
      && /^#[0-9a-fA-F]{6}$/.test(legend.color),
    );
  }

  private restoreGlobalFiltersFromConfig(): void {
    for (const filter of this.config?.filters ?? []) {
      const key = (filter.key || filter.label || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const value = filter.value;
      if (!value || (Array.isArray(value) && !value.length)) continue;
      switch (key) {
        case 'country': this.filterCountry = value; break;
        case 'sector': this.filterSector = value; break;
        case 'businessunit': this.filterBusinessUnit = value; break;
        case 'division': this.filterDivision = value; break;
        case 'cluster': this.filterCluster = value; break;
        case 'plant': this.filterPlant = value; break;
        case 'quickrange': if (typeof value === 'string') this.filterQuickRange = value; break;
        case 'from':
        case 'fromdate': if (typeof value === 'string') this.filterFrom = value; break;
        case 'to':
        case 'todate': if (typeof value === 'string') this.filterTo = value; break;
      }
    }
  }

  /** Body-cell class ids encoding its bg/text color (conditional format > manual) so native Excel export can paint it. */
  private exportCellClass = (params: CellClassParams): string[] => {
    const style = params.node?.rowPinned
      ? getSummaryRowStyle(this.config, getPinnedSummaryLabel(params.node))
      : getReportGroupRowStyle(this.config, params.node);
    if (params.node?.rowPinned || style) {
      const classes: string[] = [];
      if (this.exportColors.isExportHex(style?.backgroundColor)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(style.backgroundColor)));
      if (this.exportColors.isExportHex(style?.color)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(style.color)));
      return classes;
    }
    const field = params.colDef.field;
    const rowIndex = params.node?.rowIndex;
    if (!field || params.node?.rowPinned || rowIndex == null || rowIndex < 0) return [];
    const rowData = params.data as Record<string, unknown> | undefined;
    const cf = this.getConditionalFormat(field, rowData);
    const bg = cf.backgroundColor || this.getExportCellBg(rowIndex, field, rowData);
    const fg = cf.textColor || this.getExportCellFg(rowIndex, field, rowData);
    const classes: string[] = [];
    if (this.exportColors.isExportHex(bg)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(bg)));
    if (this.exportColors.isExportHex(fg)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(fg)));
    return classes;
  };

  /** Header-cell class id encoding the column's saved header color so native Excel export paints it too. */
  private exportHeaderClass = (field: string | null | undefined): string[] => {
    const bg = field ? resolveHeaderBackgroundColor(this.config, field) : undefined;
    const fg = field ? resolveHeaderTextColor(this.config, field) : undefined;
    const classes: string[] = [];
    if (this.exportColors.isExportHex(bg)) classes.push(this.exportColors.classId('bg', this.exportColors.normalizeHex(bg)));
    if (this.exportColors.isExportHex(fg)) classes.push(this.exportColors.classId('fg', this.exportColors.normalizeHex(fg)));
    return classes;
  };

  /** Rebuilds the Excel style registry (AG Grid's `excelStyles` is INITIAL-only) from every color in the saved config. */
  private updateExcelStyles(): void {
    const bgs: string[] = [];
    const fgs: string[] = [];
    const add = (list: string[], v?: string | null) => { if (this.exportColors.isExportHex(v)) list.push(this.exportColors.normalizeHex(v)); };
    Object.values(this.config?.cellColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.rowColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.rowColorsByKey ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.pageRowColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.headerCellColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.summaryRowColors ?? {}).forEach(v => add(bgs, v));
    Object.values(this.config?.summaryRowTextColors ?? {}).forEach(v => add(fgs, v));
    add(bgs, this.config?.headerRowColor);
    add(fgs, this.config?.headerRowTextColor);
    Object.values(this.config?.headerCellTextColors ?? {}).forEach(v => add(fgs, v));
    Object.values(this.config?.cellTextColors ?? {}).forEach(v => add(fgs, v));
    Object.values(this.config?.rowTextColors ?? {}).forEach(v => add(fgs, v));
    Object.values(this.config?.rowTextColorsByKey ?? {}).forEach(v => add(fgs, v));
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
    return getActiveDaxMeasures({ daxModel: config?.daxModel });
  }

  get selectableMeasures(): DaxMeasureConfig[] { return getSelectableDaxMeasures(this.config?.daxModel); }

  selectReportMetric(id: string | null): void {
    if (!this.config?.daxModel) return;
    this.config = { ...this.config, daxModel: withViewerMeasure(this.config.daxModel, id) };
    const sheet = this.sheets[this.activeSheetIndex];
    if (sheet) sheet.config = this.config;
    this.applyGlobalFilter();
    if ((sheet ?? this.report)?.sourceType !== 'View') this.buildGridColumns();
    this.cdr.markForCheck();
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

  /** Hidden (eye-closed) conditional filters that have a column and a value, mapped for the util. */
  private activeConditionalFilters(config: ReportJsonConfig | null): { sourceColumn: string; operator?: string; valueText?: string; mode?: string; values?: string[] }[] {
    return (config?.conditionalFilters ?? [])
      .filter(f => f.hidden && f.sourceColumn && f.valueText?.trim())
      .map(f => ({ sourceColumn: f.sourceColumn, operator: f.operator, valueText: f.valueText, mode: f.mode, values: [] }));
  }

  /** Turns raw source data into display columns + fully-materialized rows for a given sheet config. */
  private buildRowsFromData(
    config: ReportJsonConfig | null,
    data: { columns?: string[]; rows?: Record<string, unknown>[]; primaryKeys?: string[] },
  ): { displayColumns: string[]; allRows: Record<string, unknown>[] } {
    let displayColumns = config?.columns?.length
      ? this.uniqueColumns(config.columns.filter(c => c.shown !== false).map(c => c.field))
      : this.uniqueColumns(data.columns ?? []);

    const calcFields = config?.calculatedFields ?? [];
    // Conditional filters scope which rows the report shows; they run on rows enriched with
    // calculated fields so a filter can target either a source column or a calculated one.
    let sourceRows = this.filterRowsByGlobalCriteria((data.rows ?? []).map((row, index) => ({
      ...row,
      [ROW_COLOR_KEY]: getReportRowColorKey(row, data.primaryKeys, index),
    })));
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

    const caseInsensitiveSource = new Map<string, string | null>();
    for (const name of rawColumns) {
      const key = name.toLowerCase();
      caseInsensitiveSource.set(key, caseInsensitiveSource.has(key) ? null : name);
    }
    const sourceFieldFor = (col: string): string => {
      if (rawColumns.has(col)) return col;
      return caseInsensitiveSource.get(col.toLowerCase()) ?? col;
    };

    let allRows = sourceRows.map(row => {
      const slim: Record<string, unknown> = {};
      for (const col of new Set([...displayColumns, ...(config?.columns ?? []).filter(c => c.rowGroup).map(c => c.field)])) {
        slim[col] = row[sourceFieldFor(col)];
      }
      slim[ROW_COLOR_KEY] = row[ROW_COLOR_KEY];
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
    const hierarchy: Record<string, GlobalFilterSelection> = {
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
        return previewReportView(this.commonApi, view.id, hierarchy, fromDate, toDate, this.advancedFilters ?? []);
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

  private columnConfigLookup?: { config: ReportJsonConfig | null; resolve: (field: string) => ReportJsonColumn | undefined };

  /** Column config for a displayed field; a Data Transformation rename resolves to its source column. */
  private columnConfig(field: string): ReportJsonColumn | undefined {
    if (this.columnConfigLookup?.config !== this.config) {
      this.columnConfigLookup = { config: this.config, resolve: createColumnConfigResolver(this.config) };
    }
    return this.columnConfigLookup.resolve(field);
  }

  /** Active filters from the global filter bar. */
  get activeFilters(): { label: string; value: string }[] {
    const filters: { label: string; value: string }[] = [];
    if (hasGlobalSelection(this.filterCountry)) filters.push({ label: 'Country', value: globalSelectionLabel(this.filterCountry) });
    if (hasGlobalSelection(this.filterSector)) filters.push({ label: 'Sector', value: globalSelectionLabel(this.filterSector) });
    if (hasGlobalSelection(this.filterBusinessUnit)) filters.push({ label: 'Business Unit', value: globalSelectionLabel(this.filterBusinessUnit) });
    if (hasGlobalSelection(this.filterDivision)) filters.push({ label: 'Division', value: globalSelectionLabel(this.filterDivision) });
    if (hasGlobalSelection(this.filterCluster)) filters.push({ label: 'Cluster', value: globalSelectionLabel(this.filterCluster) });
    if (hasGlobalSelection(this.filterPlant)) filters.push({ label: 'Plant', value: globalSelectionLabel(this.filterPlant) });
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
    const col = this.columnConfig(field);
    return col?.color || null;
  }

  getCellBackground(rowIndex: number, field: string): string | null {
    const cellKey = `${rowIndex}:${field}`;
    const row = this.gridApi?.getDisplayedRowAtIndex(rowIndex)?.data as Record<string, unknown> | undefined
      ?? this.allRows[rowIndex];
    const colorKey = typeof row?.[ROW_COLOR_KEY] === 'string' ? String(row[ROW_COLOR_KEY]) : undefined;
    return getReportCellSetting(this.config?.cellColors, row, rowIndex, field)
      || (colorKey ? this.config?.rowColorsByKey?.[colorKey] : undefined)
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
    // Interleave group labels + subtotals + the (DAX-inclusive) totals row so the PDF mirrors the grid.
    const rows = format === 'pdf'
      ? this.buildExportRows(this.getCurrentExportRows(), cols, true)
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
          await this.addStyledWorksheet(workbook, this.uniqueExcelSheetName(sheetCfg.name, usedNames), headers, this.buildExportRows(rows, displayColumns, true));
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
        await this.addStyledWorksheet(workbook, this.uniqueExcelSheetName('Report', usedNames), headers, this.buildExportRows(rows, cols, true));
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
    this.addExcelClusterBanner(sheet, colCount, 5);
    const legends = this.configuredLegends;
    const legendRow = this.showClusterBanner ? 6 : 5;
    this.addExcelLegends(sheet, colCount, legendRow);
    const headerStartRow = legends.length ? legendRow + 1 : 6;
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

  /** Secondary "report name – cluster" banner, written into the spacer row when a cluster is selected. */
  private addExcelClusterBanner(sheet: ExcelJS.Worksheet, colCount: number, row: number): void {
    if (!this.showClusterBanner) return;
    if (colCount > 1) sheet.mergeCells(row, 1, row, colCount);
    const cell = sheet.getCell(row, 1);
    cell.value = this.clusterBannerTitle;
    cell.fill = this.getExcelFill('#A6A6A6');
    cell.font = this.getExcelFont('#1A1A1A', true, 12);
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(row).height = 22;
  }

  private addExcelLegends(sheet: ExcelJS.Worksheet, colCount: number, startRow: number): void {
    const legends = this.configuredLegends;
    if (!legends.length) return;

    if (colCount > 1) sheet.mergeCells(startRow, 1, startRow, colCount);
    const cell = sheet.getCell(startRow, 1);
    cell.value = {
      richText: legends.flatMap((legend, index) => [
        ...(index ? [{ text: '    ' }] : []),
        { text: '■ ', font: this.getExcelFont(legend.color, true, 10) },
        { text: legend.label, font: this.getExcelFont('#344054', false, 10) },
      ]),
    };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    sheet.getRow(startRow).height = 20;
  }
  /** Auto serial headers use the same saved colors as the live grid, falling back to its theme. */
  private get SERIAL_HEADER_BG(): string {
    return this.getHeaderCellBg(ROW_NUMBER_COL_ID, '#E8F0FC');
  }

  private get SERIAL_HEADER_FG(): string {
    return this.getHeaderCellFg(ROW_NUMBER_COL_ID, '#344054');
  }

  /** Resolves a column header's background: per-cell color > uniform header row color > column color > fallback. */
  private getHeaderCellBg(field: string, fallback: string): string {
    return this.sanitizeCssColor(resolveHeaderBackgroundColor(this.config, field) || '', fallback);
  }

  /** Resolves a column header's text color the same way the live grid does: per-cell > uniform header row > fallback.
   *  The column's own body text color is intentionally NOT a fallback — a "Column Text color" must not bleed into the header. */
  private getHeaderCellFg(field: string, fallback: string): string {
    return this.sanitizeCssColor(resolveHeaderTextColor(this.config, field) || '', fallback);
  }

  /**
   * Maps displayed/exported column names to their saved configs. A `rename_column` data
   * transformation makes the on-screen field name differ from the stored config field, so a
   * plain `columns.find` would miss renamed columns and silently drop their group/sub-group
   * headers from exports. Resolving through the shared helper keeps exports in sync with the grid.
   */
  private resolveColumnConfigs(fields: string[]) {
    const resolve = createColumnConfigResolver(this.config);
    return fields.map(resolve);
  }

  private getExcelHeaderColumns(): ReportJsonColumn[] {
    // Excel replaces a source Sl.No column with generated numbering, but its header still
    // belongs to the source column's saved group/sub-group.
    const serial = this.config?.columns?.find(column => column.shown !== false && isSerialNumberField(column.field));
    return [
      serial ?? { field: ROW_NUMBER_COL_ID, header: 'Sl.No' },
      ...this.resolveColumnConfigs(this.displayColumns).map((column, index) =>
        column ?? { field: this.displayColumns[index], header: this.getColumnHeader(this.displayColumns[index]) }),
    ];
  }

  private addExcelHeaders(sheet: ExcelJS.Worksheet, headers: string[], startRow: number): void {
    const configs = this.getExcelHeaderColumns();
    headers = [configs[0].header || 'Sl.No', ...headers];
    const hasGroups = configs.some(config => !!config?.group);
    const hasSubs = configs.some(config => !!config?.subGroup);
    const headerRowBg = this.sanitizeCssColor(this.config?.headerRowColor || '', '#F5F5F5');
    const headerBg = (index: number) => index === 0
      ? this.SERIAL_HEADER_BG : this.getHeaderCellBg(this.displayColumns[index - 1], headerRowBg);
    const headerFg = (index: number) => index === 0
      ? this.SERIAL_HEADER_FG : this.getHeaderCellFg(this.displayColumns[index - 1], '#000000');
    const groupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 0)?.color || '', '#21409A');
    const subGroupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 1)?.color || '', '#EEF4FF');
    const groupHeaderText = this.sanitizeCssColor(this.config?.groupTextColor || '', '#FFFFFF');
    const subGroupHeaderText = this.sanitizeCssColor(this.config?.subGroupTextColor || '', '#FFFFFF');
    const headerRowCount = this.getExcelHeaderRowCount(configs);
    const groupRow = startRow;
    const subGroupRow = hasGroups ? startRow + 1 : startRow;
    const headerRow = startRow + headerRowCount - 1;

    if (hasGroups) {
      let colIndex = 1;
      for (let index = 0; index < configs.length;) {
        const group = configs[index]?.group || '';
        let span = 1;
        while (index + span < configs.length && (configs[index + span]?.group || '') === group) span++;
        if (group) {
          const gBg = this.sanitizeCssColor(this.config?.groupColors?.[group] || '', groupHeaderBg);
          const gText = this.sanitizeCssColor(this.config?.groupTextColors?.[group] || '', groupHeaderText);
          if (span > 1) sheet.mergeCells(groupRow, colIndex, groupRow, colIndex + span - 1);
          this.styleExcelHeaderCell(sheet.getCell(groupRow, colIndex), group, gBg, gText);
          this.styleExcelHeaderRange(sheet, groupRow, colIndex, groupRow, colIndex + span - 1, gBg, gText);
          this.alignExcelGroupHeader(sheet.getCell(groupRow, colIndex), 'group', group);
        } else {
          for (let offset = 0; offset < span; offset++) {
            sheet.mergeCells(groupRow, colIndex + offset, groupRow + headerRowCount - 1, colIndex + offset);
            const fieldBg = headerBg(index + offset);
            const fieldFg = headerFg(index + offset);
            this.styleExcelHeaderCell(sheet.getCell(groupRow, colIndex + offset), headers[index + offset], fieldBg, fieldFg);
          }
        }
        index += span;
        colIndex += span;
      }
    }

    if (hasSubs) {
      let colIndex = 1;
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
          const sgText = this.sanitizeCssColor(this.config?.subGroupTextColors?.[subGroup] || '', subGroupHeaderText);
          if (span > 1) sheet.mergeCells(subGroupRow, colIndex, subGroupRow, colIndex + span - 1);
          this.styleExcelHeaderCell(sheet.getCell(subGroupRow, colIndex), subGroup, sgBg, sgText);
          this.styleExcelHeaderRange(sheet, subGroupRow, colIndex, subGroupRow, colIndex + span - 1, sgBg, sgText);
          this.alignExcelGroupHeader(sheet.getCell(subGroupRow, colIndex), 'subGroup', subGroup);
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
      const colIndex = index + 1;
      const hasGroup = !!configs[index]?.group;
      const hasSubGroup = !!configs[index]?.subGroup;
      const fieldBg = headerBg(index);
      const fieldFg = headerFg(index);
      if (hasGroups && !hasGroup) continue;
      if (index === 0 && hasSubs && !hasGroups && !hasSubGroup) {
        sheet.mergeCells(startRow, colIndex, headerRow, colIndex);
        this.styleExcelHeaderCell(sheet.getCell(startRow, colIndex), headers[index], fieldBg, fieldFg);
        continue;
      }
      if (hasSubs && hasGroup && !hasSubGroup) {
        this.styleExcelHeaderCell(sheet.getCell(headerRow, colIndex), headers[index], fieldBg, fieldFg);
        continue;
      }
      this.styleExcelHeaderCell(sheet.getCell(headerRow, colIndex), headers[index], fieldBg, fieldFg);
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

    this.applyExcelHeaderBorders(sheet, startRow, headerRowCount);
  }

  private addExcelDataRows(sheet: ExcelJS.Worksheet, rows: Record<string, unknown>[], startRow: number): void {
    // Columns used for row grouping — on a grouped export their value is shown on the group-header
    // row, so leaf rows leave them blank (mirroring the grid's auto-group column).
    const groupedFields = new Set(
      (this.config?.columns ?? []).filter(c => c.rowGroup).map(c => c.field).filter(f => this.displayColumns.includes(f)),
    );
    const styleIndices = this.exportRowStyleIndices(rows);
    let dataRowIndex = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const excelRow = sheet.getRow(startRow + rowIndex);
      const rowData = rows[rowIndex];
      const styleRowIndex = styleIndices.get(rowData);
      const isTotals = !!rowData[this.TOTALS_ROW_FLAG];
      const summaryStyle = isTotals
        ? this.getExportSummaryRowStyle(rowData)
        : undefined;
      const isGroupLabel = !!rowData[this.GROUP_LABEL_FLAG];
      const colorRowIndex = isTotals || isGroupLabel ? rowIndex : dataRowIndex++;
      excelRow.getCell(1).value = isTotals ? String(rowData[this.TOTALS_LABEL_KEY] ?? 'Total') : rowIndex + 1;
      excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      this.applyExcelCellBorder(excelRow.getCell(1), rowIndex, 0, rows.length, this.displayColumns.length + 1);
      if (isTotals || isGroupLabel) excelRow.getCell(1).font = { ...excelRow.getCell(1).font, bold: true };
      if (summaryStyle?.backgroundColor) excelRow.getCell(1).fill = this.getExcelFill(summaryStyle.backgroundColor);
      if (summaryStyle?.color) excelRow.getCell(1).font = {
        ...excelRow.getCell(1).font, color: { argb: this.toExcelArgb(summaryStyle.color) },
      };
      if (isGroupLabel) {
        const bg = this.getExportCellBg(rowIndex, '', rowData);
        const fg = this.getExportCellFg(rowIndex, '', rowData);
        if (bg) excelRow.getCell(1).fill = this.getExcelFill(bg);
        if (fg) excelRow.getCell(1).font = { ...excelRow.getCell(1).font, color: { argb: this.toExcelArgb(fg) } };
      }
      // Serial cell shares the branded row stripe so the whole row matches on-screen.
      if (!isTotals && !isGroupLabel) { const s = this.stripeBg(colorRowIndex); if (s) excelRow.getCell(1).fill = this.getExcelFill(s); }

      for (let colIndex = 0; colIndex < this.displayColumns.length; colIndex++) {
        const field = this.displayColumns[colIndex];
        const cell = excelRow.getCell(colIndex + 2);

        // Group-header row: only the grouped column shows "<value> (N)"; every other column stays blank.
        if (isGroupLabel) {
          const labelVal = rowData[field];
          cell.value = (labelVal == null || labelVal === '') ? '' : String(labelVal);
          cell.alignment = { ...cell.alignment, horizontal: this.getExportCellAlign(field, undefined, undefined, true) };
          this.applyExcelCellBorder(cell, rowIndex, colIndex + 1, rows.length, this.displayColumns.length + 1);
          cell.font = { ...cell.font, bold: true };
          const bg = this.getExportCellBg(rowIndex, field, rowData);
          const fg = this.getExportCellFg(rowIndex, field, rowData);
          if (bg) cell.fill = this.getExcelFill(bg);
          if (fg) cell.font = { ...cell.font, color: { argb: this.toExcelArgb(fg) } };
          continue;
        }
        // Leaf rows leave the grouped columns blank (their value is on the group-header row above).
        if (!isTotals && groupedFields.has(field)) {
          cell.value = '';
          this.applyExcelCellBorder(cell, rowIndex, colIndex + 1, rows.length, this.displayColumns.length + 1);
          const groupBg = this.getExportCellBg(colorRowIndex, field, rowData, styleRowIndex);
          if (groupBg) cell.fill = this.getExcelFill(groupBg);
          continue;
        }

        const raw = rowData[field];
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
            ? (raw == null || raw === '' ? '' : this.getExportDisplayValue(rowData, field))
            : this.getExportDisplayValue(rowData, field);
        }
        this.applyExcelCellBorder(cell, rowIndex, colIndex + 1, rows.length, this.displayColumns.length + 1);
        cell.alignment = {
          ...cell.alignment,
          horizontal: this.getExportCellAlign(field, rowData, isTotals ? undefined : styleRowIndex),
        };
        if (isTotals) {
          cell.font = { ...cell.font, bold: true };
          if (summaryStyle?.backgroundColor) cell.fill = this.getExcelFill(summaryStyle.backgroundColor);
          if (summaryStyle?.color) cell.font = { ...cell.font, color: { argb: this.toExcelArgb(summaryStyle.color) } };
          continue;
        }
        const bg = this.getExportCellBg(colorRowIndex, field, rowData, styleRowIndex);
        if (bg) cell.fill = this.getExcelFill(bg);
        const fg = this.getExportCellFg(colorRowIndex, field, rowData, styleRowIndex);
        if (fg) cell.font = { ...cell.font, color: { argb: this.toExcelArgb(fg) } };
        if (this.getConditionalFormat(field, rowData).bold) cell.font = { ...cell.font, bold: true };
        // Vertical-orientation cells export as rotated (bottom-to-top) text, matching the grid.
        if (this.isExportCellVertical(colorRowIndex, field, rowData)) {
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

  private getExcelHeaderRowCount(configs = this.getExcelHeaderColumns()): number {
    return (configs.some(config => !!config?.group) ? 1 : 0) + (configs.some(config => !!config?.subGroup) ? 1 : 0) + 1;
  }

  private styleExcelHeaderCell(cell: ExcelJS.Cell, value: string, bgColor: string, textColor: string): void {
    cell.value = value;
    this.styleExcelHeaderFill(cell, bgColor, textColor);
  }

  /** Group / sub-group header alignment for exports (saved per name, default center). */
  private exportGroupHeaderAlign(level: ReportHeaderGroupRef['level'], name: string): TextAlign {
    return resolveGroupHeaderAlign(this.config, { level, name: name.trim() });
  }

  private alignExcelGroupHeader(cell: ExcelJS.Cell, level: ReportHeaderGroupRef['level'], name: string): void {
    cell.alignment = { ...cell.alignment, horizontal: this.exportGroupHeaderAlign(level, name) };
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

  private getPrintBorderCss(
    rowIndex: number,
    columnIndex: number,
    rowCount: number,
    columnCount: number,
    header = false,
    headerRowCount = 1,
  ): string {
    const sides = this.exportBorderSides(rowIndex, columnIndex, rowCount, columnCount, header, headerRowCount);
    if (!sides) return '';
    const borderStyle = '2px solid #334155';
    return [
      sides.top ? `border-top:${borderStyle};` : '',
      sides.right ? `border-right:${borderStyle};` : '',
      sides.bottom ? `border-bottom:${borderStyle};` : '',
      sides.left ? `border-left:${borderStyle};` : '',
    ].join('');
  }

  private exportBorderSides(
    rowIndex: number,
    columnIndex: number,
    rowCount: number,
    columnCount: number,
    header = false,
    headerRowCount = 1,
  ): CellBorder | null {
    const borderMap = header ? this.config?.headerCellBorders : this.config?.cellBorders;
    const resolveAt = (row: number, column: number): CellBorder | null => {
      if (row < 0 || row >= rowCount || column < 0 || column >= columnCount) return null;
      const targetField = column === 0 ? ROW_NUMBER_COL_ID : this.displayColumns[column - 1];
      const configField = header
        ? (row === headerRowCount - 1 ? targetField : undefined)
        : targetField;
      const key = header ? configField : `${row}:${configField}`;
      const pos = {
        firstRow: row === 0,
        lastRow: row === rowCount - 1,
        firstCol: column === 0,
        lastCol: column === columnCount - 1,
      };
      return resolveStoredSides(borderMap, this.config?.reportBorder, key ?? null, pos);
    };

    return dedupeBorderSides(
      resolveAt(rowIndex, columnIndex),
      resolveAt(rowIndex - 1, columnIndex),
      resolveAt(rowIndex, columnIndex - 1),
      rowIndex === rowCount - 1,
      columnIndex === columnCount - 1,
    );
  }

  private applyExcelCellBorder(
    cell: ExcelJS.Cell,
    rowIndex: number,
    columnIndex: number,
    rowCount: number,
    columnCount: number,
  ): void {
    cell.border = this.getExcelBorder('#D9E0EA');
    const sides = this.exportBorderSides(rowIndex, columnIndex, rowCount, columnCount);
    if (!sides) return;
    const border = { style: 'thin' as const, color: { argb: this.toExcelArgb('#334155') } };
    cell.border = {
      ...cell.border,
      ...(sides.top ? { top: border } : {}),
      ...(sides.right ? { right: border } : {}),
      ...(sides.bottom ? { bottom: border } : {}),
      ...(sides.left ? { left: border } : {}),
    };
  }

  private applyExcelHeaderBorders(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    headerRowCount: number,
  ): void {
    const columnCount = this.displayColumns.length + 1;
    for (let row = 0; row < headerRowCount; row++) {
      for (let column = 0; column < columnCount; column++) {
        const cell = sheet.getCell(startRow + row, column + 1);
        const sides = this.exportBorderSides(
          row,
          column,
          headerRowCount,
          columnCount,
          true,
          headerRowCount,
        );
        if (!sides) continue;
        const border = { style: 'thin' as const, color: { argb: this.toExcelArgb('#334155') } };
        cell.border = {
          ...cell.border,
          ...(sides.top ? { top: border } : {}),
          ...(sides.right ? { right: border } : {}),
          ...(sides.bottom ? { bottom: border } : {}),
          ...(sides.left ? { left: border } : {}),
        };
      }
    }
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
      .map(col => {
        const colId = col.getColId();
        if (this.displayColumns.includes(colId)) return colId;
        // Row grouping (groupDisplayType='multipleColumns') replaces the grouped column on-screen with an
        // auto-group column whose colId is 'ag-Grid-AutoColumn-<field>' — not the field name — so filtering
        // by displayColumns would drop the grouped column from the export entirely. Map it back to its
        // underlying field (colDef.showRowGroup holds the grouped field for multipleColumns).
        const showRowGroup = col.getColDef()?.showRowGroup;
        const groupedField = typeof showRowGroup === 'string' ? showRowGroup : undefined;
        return groupedField && this.displayColumns.includes(groupedField) ? groupedField : null;
      })
      .filter((colId): colId is string => colId != null);

    // De-dupe: with suppressHideOnGroup the original grouped column can also appear alongside its
    // auto-group column, both mapping to the same field — keep the first (leftmost) occurrence.
    const unique = [...new Set(visibleFields)];
    return unique.length ? unique : [...new Set(this.visibleColumns.length ? this.visibleColumns : this.displayColumns)];
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
  private buildExportRows(leafRows: Record<string, unknown>[], columns: string[], withGroupLabels = false): Record<string, unknown>[] {
    const grouped = this.withRowGroupStructure(leafRows, columns, withGroupLabels);
    const columnMeasures = this.daxColumnMeasures(this.config);
    const wantTotals = !!this.config?.showTotals && leafRows.length > 0 && columns.length > 0;
    const out = [...grouped];
    if (wantTotals) {
      // One labeled row per aggregation type (Sum/Average/...), mirroring the on-screen totals.
      for (const totals of computeTotalsRows(this.config, leafRows, columns)) {
        const label = String(totals[TOTALS_LABEL_FIELD] ?? 'Total');
        const { [TOTALS_LABEL_FIELD]: _drop, ...values } = totals;
        out.push({ ...values, [TOTALS_LABEL_FIELD]: label, [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: label });
      }
    }
    // Flat reports: add the controlled "Total" grand-total row (grouped reports get it from withGroupTotals).
    if (!!this.config?.grandTotalAtBottom && !this.hasRowGrouping && leafRows.length > 0 && columns.length > 0) {
      const grand = computeGrandTotalRow(this.config, leafRows, columns);
      if (grand) {
        const { [TOTALS_LABEL_FIELD]: _drop, ...values } = grand;
        out.push({ ...values, [TOTALS_LABEL_FIELD]: 'Total', [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: 'Total' });
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

  /**
   * Shapes leaf rows into the report's row-grouping structure for export. Always interleaves
   * per-group subtotals + a grand-total row when the aggregations are configured. When
   * `labels` is true (Excel/PDF), it ALSO inserts a group-header row before each group
   * (e.g. "Nimr (12)") so the export mirrors the grid's group accordions; leaf rows then leave
   * the grouped columns blank at render time (see addExcelDataRows). Returns the leaf rows
   * unchanged when the report isn't row-grouped, or when neither labels nor totals are requested.
   */
  private withRowGroupStructure(leafRows: Record<string, unknown>[], columns: string[], labels: boolean): Record<string, unknown>[] {
    const resolve = createColumnConfigResolver(this.config);
    const groupFields = (this.config?.columns ?? [])
      .filter(c => c.rowGroup)
      .sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0))
      .map(c => columns.find(field => resolve(field)?.field === c.field) ?? c.field)
      .filter(f => columns.includes(f));
    const aggMap = new Map<string, 'sum' | 'avg'>();
    for (const c of this.config?.columns ?? []) {
      if ((c.aggFunc === 'sum' || c.aggFunc === 'avg') && columns.includes(c.field)) aggMap.set(c.field, c.aggFunc);
    }
    const wantSubtotal = !!this.config?.subtotalAfterGroup && aggMap.size > 0;
    const wantGrand = !!this.config?.grandTotalAtBottom && aggMap.size > 0;
    if (!leafRows.length || !groupFields.length) return leafRows;
    if (!labels && !wantSubtotal && !wantGrand) return leafRows;

    const aggregate = (rows: Record<string, unknown>[], field: string, fn: 'sum' | 'avg'): number | string =>
      aggregateReportValues(rows.map(r => r[field]), fn) ?? '';
    const totalRow = (rows: Record<string, unknown>[], labelField: string | null, labelValue: unknown, slNoLabel: string): Record<string, unknown> => {
      const row: Record<string, unknown> = { [this.TOTALS_ROW_FLAG]: true, [this.TOTALS_LABEL_KEY]: slNoLabel };
      for (const [field, fn] of aggMap) row[field] = aggregate(rows, field, fn);
      if (labelField) row[labelField] = labelValue;
      return row;
    };
    // Group-header row: "<value> (<leaf count>)" in the grouped column, mirroring the grid accordion.
    const labelRow = (field: string, value: unknown, count: number, path: [string, string | null][]): Record<string, unknown> => ({
      [this.GROUP_LABEL_FLAG]: true,
      [ROW_COLOR_KEY]: `group:${JSON.stringify(path)}`,
      __reportGroupField: field,
      [field]: `${value == null || value === '' ? '—' : value} (${count})`,
    });

    // Emits each group's (optional) header row, its rows (nested groups or leaves), then its subtotal.
    const build = (rows: Record<string, unknown>[], level: number, parentPath: [string, string | null][] = []): Record<string, unknown>[] => {
      const field = groupFields[level];
      const out: Record<string, unknown>[] = [];
      let i = 0;
      while (i < rows.length) {
        const key = rows[i][field];
        let j = i;
        while (j < rows.length && rows[j][field] === key) j++;
        const groupRows = rows.slice(i, j);
        const path: [string, string | null][] = [...parentPath, [field, key == null || key === '' ? null : String(key)]];
        if (labels) out.push(labelRow(field, key, groupRows.length, path));
        if (level + 1 < groupFields.length) {
          out.push(...build(groupRows, level + 1, path));
        } else {
          out.push(...groupRows);
        }
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

  /** PDF/print cell text: matches the web grid (rounded decimals, thousand separators, blanks stay blank). */
  private getPrintDisplayValue(row: Record<string, unknown>, field: string): string {
    return this.escapeHtml(this.getPrintPlainValue(row, field));
  }

  /** Unescaped text of {@link getPrintDisplayValue}; used to measure column widths. */
  private getPrintPlainValue(row: Record<string, unknown>, field: string): string {
    const value = row[field];
    if (value == null || value === '') return '';
    if (this.isNumericColumn(field) && !this.isBooleanColumn(field) && !this.isDateColumn(field)) {
      return formatGridNumberValue(value, field);
    }
    return String(this.getExportDisplayValue(row, field));
  }

  private getExportDisplayValue(row: Record<string, unknown>, field: string): string | number {
    const value = row[field];
    if (value == null || value === '') return '';

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
    const chunkConfigs = this.resolveColumnConfigs(this.displayColumns);
    const hasGroups = this.hasGroupHeaders;
    const hasSubs = this.hasSubGroupHeaders;
    const headerRowBg = this.sanitizeCssColor(this.config?.headerRowColor || '', '#f5f5f5');
    const groupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 0)?.color || '', '#21409A');
    const subGroupHeaderBg = this.sanitizeCssColor(this.config?.columnGroupColors?.find(color => color.level === 1)?.color || '', '#EEF4FF');
    const groupHeaderText = this.sanitizeCssColor(this.config?.groupTextColor || '', '#FFFFFF');
    const subGroupHeaderText = this.sanitizeCssColor(this.config?.subGroupTextColor || '', '#FFFFFF');

    if (hasGroups) {
      html += '<tr>';
      html += `<th rowspan="${1 + (hasSubs ? 1 : 0) + 1}" style="border:1px solid #ddd;padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
      let ci = 0;
      while (ci < chunkConfigs.length) {
        const grp = chunkConfigs[ci]?.group || '';
        let span = 1;
        while (ci + span < chunkConfigs.length && (chunkConfigs[ci + span]?.group || '') === grp) span++;
        if (grp) {
          const gBg = this.sanitizeCssColor(this.config?.groupColors?.[grp] || '', groupHeaderBg);
          const gText = this.sanitizeCssColor(this.config?.groupTextColors?.[grp] || '', groupHeaderText);
          html += `<th colspan="${span}" style="border:1px solid #1a3580;padding:6px;background:${gBg};color:${gText};font-size:11px;font-weight:600;text-align:${this.exportGroupHeaderAlign('group', grp)};white-space:pre-line">${this.escapeHtmlWithLineBreaks(grp)}</th>`;
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
        html += `<th rowspan="2" style="border:1px solid #ddd;padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
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
          const sgText = this.sanitizeCssColor(this.config?.subGroupTextColors?.[sub] || '', subGroupHeaderText);
          html += `<th colspan="${span}" style="border:1px solid #D5E3F7;padding:5px;background:${sgBg};color:${sgText};font-size:10px;font-weight:600;text-align:${this.exportGroupHeaderAlign('subGroup', sub)};white-space:pre-line">${this.escapeHtmlWithLineBreaks(sub)}</th>`;
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
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
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
    const serialHeader = ws[XLSX.utils.encode_cell({ r: currentRow, c: 0 })];
    if (serialHeader) serialHeader.s = this.getCellStyle(this.SERIAL_HEADER_BG, this.SERIAL_HEADER_FG);

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
      rowColorsByKey: this.config?.rowColorsByKey,
      cellTextColors: this.config?.cellTextColors,
      rowTextColors: this.config?.rowTextColors,
      rowTextColorsByKey: this.config?.rowTextColorsByKey,
      getColumnColor: (field) => this.columnConfig(field)?.color,
      getColumnTextColor: (field) => this.columnConfig(field)?.textColor,
    };
  }

  /** The grid's actual page size (matches the on-screen color keying); falls back to the default. */
  private exportPageSize(): number {
    return getReportGridPageSize(this.gridApi, this.gridPaginationPageSize);
  }

  /** Conditional-formatting match for a cell (same rule set/precedence as the on-screen grid). */
  private getConditionalFormat(field: string, rowData: Record<string, unknown> | undefined): { backgroundColor?: string; textColor?: string; bold?: boolean } {
    if (!rowData) return {};
    return evaluateConditionalRules(this.config?.conditionalRules, field, rowData, createDuplicateValueLookup(this.gridApi, this.allRows));
  }

  private exportRowStyleIndices(rows: Record<string, unknown>[]): Map<Record<string, unknown>, number | null> {
    const indices = new Map<Record<string, unknown>, number | null>(rows.map((row, index) => [row, index]));
    // Positional paints use grid positions, including group headings, not leaf serial numbers.
    // Match by row object so an inactive sheet never borrows positions from the active grid.
    this.gridApi?.forEachNode(node => {
      if (node.data && !node.group && !node.footer && indices.has(node.data)) {
        indices.set(node.data, node.rowIndex);
      }
    });
    return indices;
  }

  private getExportSummaryRowStyle(rowData: Record<string, unknown>) {
    const label = rowData[this.TOTALS_LABEL_KEY];
    return getSummaryRowStyle(this.config, typeof label === 'string' ? label : undefined);
  }

  /** Export background for a cell (conditional format > cell > row > column), safe hex only. */
  private getExportCellBg(rowIndex: number, col: string, rowData?: Record<string, unknown>, styleRowIndex: number | null = rowIndex): string | null {
    if (rowData?.[this.TOTALS_ROW_FLAG]) {
      const style = this.getExportSummaryRowStyle(rowData);
      return style?.backgroundColor ? this.sanitizeCssColor(style.backgroundColor, '') || null : null;
    }
    if (rowData?.[this.GROUP_LABEL_FLAG]) {
      const key = String(rowData[ROW_COLOR_KEY] ?? '');
      const field = typeof rowData['__reportGroupField'] === 'string' ? rowData['__reportGroupField'] : undefined;
      return this.sanitizeCssColor(resolveReportGroupRowStyle(this.config, key, field).backgroundColor, '') || null;
    }
    const cf = this.getConditionalFormat(col, rowData).backgroundColor;
    if (cf) return cf;
    const colorKey = typeof rowData?.[ROW_COLOR_KEY] === 'string' ? String(rowData[ROW_COLOR_KEY]) : undefined;
    const manual = this.exportColors.resolveCellBackground(styleRowIndex, col, this.exportPageSize(), this.exportColorSource(), colorKey);
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
  private getExportCellFg(rowIndex: number, col: string, rowData?: Record<string, unknown>, styleRowIndex: number | null = rowIndex): string | null {
    if (rowData?.[this.TOTALS_ROW_FLAG]) {
      const style = this.getExportSummaryRowStyle(rowData);
      return style?.color ? this.sanitizeCssColor(style.color, '') || null : null;
    }
    if (rowData?.[this.GROUP_LABEL_FLAG]) {
      const key = String(rowData[ROW_COLOR_KEY] ?? '');
      const field = typeof rowData['__reportGroupField'] === 'string' ? rowData['__reportGroupField'] : undefined;
      return this.sanitizeCssColor(resolveReportGroupRowStyle(this.config, key, field).color, '') || null;
    }
    const cf = this.getConditionalFormat(col, rowData).textColor;
    if (cf) return cf;
    const colorKey = typeof rowData?.[ROW_COLOR_KEY] === 'string' ? String(rowData[ROW_COLOR_KEY]) : undefined;
    return this.exportColors.resolveCellTextColor(styleRowIndex, col, this.exportPageSize(), this.exportColorSource(), colorKey);
  }

  /** True when the given data-row/field cell was set to vertical orientation (for exports). */
  private isExportCellVertical(rowIndex: number, field: string, rowData?: Record<string, unknown>): boolean {
    return getReportCellSetting(this.config?.cellOrientations, rowData, rowIndex, field) === 'vertical';
  }

  /** Export cell alignment: manual cell/report alignment first, then Excel-style numbers/dates right, text left. */
  private getExportCellAlign(field: string, rowData?: Record<string, unknown>, styleRowIndex?: number | null, textLabel = false): TextAlign {
    const valid = (align: unknown): TextAlign | undefined =>
      align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    const manual = rowData && styleRowIndex !== undefined
      ? valid(getReportCellSetting(this.config?.cellAlignments, rowData, styleRowIndex, field))
      : undefined;
    return manual ?? valid(this.config?.reportAlignment) ?? defaultReportCellAlign(!textLabel
      && ((this.isNumericColumn(field) && !this.isBooleanColumn(field)) || this.isDateColumn(field)));
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

    const chunkConfigs = this.resolveColumnConfigs(this.displayColumns);
    const hasGroups = this.hasGroupHeaders;
    const hasSubs = this.hasSubGroupHeaders;

    // Title row
    let html = `<tr><td colspan="${colCount}" style="padding:10px;background:${hdrBg};color:${hdrColor};font-size:16px;font-weight:700;text-align:center">${displayTitle}${headerSubtitle ? '<br><span style="font-size:12px;font-weight:400;opacity:0.85">' + headerSubtitle + '</span>' : ''}</td></tr>`;

    // Group header row
    if (hasGroups) {
      html += '<tr>';
      html += `<th rowspan="${1 + (hasSubs ? 1 : 0) + 1}" style="border:1px solid #ddd;padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
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
        html += `<th rowspan="2" style="border:1px solid #ddd;padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
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
      html += `<th style="border:1px solid #ddd;padding:6px 10px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
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

  private readonly EXPORT_SL_WIDTH_PX = 56;
  private readonly EXPORT_MAX_NOWRAP_CHARS = 28;
  private readonly EXPORT_MAX_WRAP_CHARS = 18;

  /** Single-word values (numbers, IDs, dates) that fit the column must not be split mid-value. */
  private exportNoWrapStyle(value: unknown): string {
    const text = String(value ?? '');
    return text.length <= this.EXPORT_MAX_NOWRAP_CHARS && !/\s/.test(text) ? 'white-space:nowrap;' : '';
  }

  /**
   * Content-based widths (px) for the export table: each column is sized from its header and its
   * longest value, so short columns stay narrow and long ones get room (multi-word text wraps
   * after EXPORT_MAX_WRAP_CHARS, single-word values stay on one line).
   */
  private computeExportColumnWidths(cols: string[], headers: string[], rows: Record<string, unknown>[]): number[] {
    const charPx = 7;
    const paddingPx = 22;
    const dataRows = rows.filter(r => !r[this.GROUP_LABEL_FLAG]).slice(0, 500);
    return cols.map((col, i) => {
      const headerWords = String(headers[i] ?? '').split(/\s+/).filter(Boolean);
      let chars = Math.max(
        headerWords.reduce((m, w) => Math.max(m, w.length), 0),
        Math.min(String(headers[i] ?? '').length, 12),
      );
      for (const row of dataRows) {
        const text = this.getPrintPlainValue(row, col);
        const cap = /\s/.test(text) ? this.EXPORT_MAX_WRAP_CHARS : this.EXPORT_MAX_NOWRAP_CHARS;
        chars = Math.max(chars, Math.min(text.length, cap));
      }
      return Math.round(Math.min(Math.max(chars, 4), this.EXPORT_MAX_NOWRAP_CHARS) * charPx + paddingPx);
    });
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
    // the serial numbering (+ index-based cell colors) counts only real data rows. Group-header
    // rows (row grouping) likewise don't consume a data serial — they show the group label instead.
    let dataSeqCounter = 0;
    const dataSeqByIndex = rows.map(r => (r[this.TOTALS_ROW_FLAG] || r[this.GROUP_LABEL_FLAG] ? -1 : dataSeqCounter++));
    const dataRowCount = dataSeqCounter;
    const styleIndices = this.exportRowStyleIndices(rows);
    // Columns used for row grouping — their value is shown on the group-header row, so leaf rows
    // leave them blank (mirroring the grid's auto-group column).
    const groupedFields = new Set(
      (this.config?.columns ?? []).filter(c => c.rowGroup).map(c => c.field).filter(f => this.displayColumns.includes(f)),
    );
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

    // Secondary "report name – cluster" banner (only when a cluster is selected).
    const clusterBannerHtml = this.showClusterBanner
      ? `<div class="rv-export-cluster-banner">${this.escapeHtml(this.clusterBannerTitle)}</div>`
      : '';
    const legendsHtml = this.configuredLegends.length
      ? `<div style="display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px 18px;padding:8px 10px;margin:0 0 8px;border:1px solid #E2E7EF;font-size:11px;color:#344054;text-align:right">${this.configuredLegends.map(legend =>
          `<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:14px;height:14px;background:${legend.color};border:1px solid rgba(16,24,40,.18);border-radius:2px"></span>${this.escapeHtml(legend.label)}</span>`,
        ).join('')}</div>`
      : '';

    // Build pages: for each row batch, output all column chunks, then move to next batch
    // Page order: batch1-cols1-9, batch1-cols10-16, batch1-cols17-24, batch2-cols1-9, ...
    let tablesHtml = '';
    let isFirstPage = true;
    let maxTableWidthPx = 0;

    for (let bi = 0; bi < rowBatches.length; bi++) {
      const rowBatch = rowBatches[bi];
      const rowStart = bi * maxRows;

      for (let ci = 0; ci < colChunks.length; ci++) {
        const chunk = colChunks[ci];
        const chunkColCount = chunk.cols.length + 1; // +1 for Sl.No
        // Fixed layout + an explicit colgroup makes the table fit the page width exactly instead of
        // overflowing (and getting clipped) when there are many columns. Column widths are
        // proportional to their content (header + longest value) rather than equal.
        const chunkWidthsPx = this.computeExportColumnWidths(chunk.cols, chunk.headers, rows);
        const totalWidthPx = this.EXPORT_SL_WIDTH_PX + chunkWidthsPx.reduce((a, b) => a + b, 0);
        maxTableWidthPx = Math.max(maxTableWidthPx, totalWidthPx);
        const pct = (px: number) => `${((px / totalWidthPx) * 100).toFixed(3)}%`;
        const colGroup = `<colgroup><col style="width:${pct(this.EXPORT_SL_WIDTH_PX)}"/>${chunkWidthsPx.map(px => `<col style="width:${pct(px)}"/>`).join('')}</colgroup>`;
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
        const chunkConfigs = this.resolveColumnConfigs(chunk.cols);
        const hasChunkGroups = chunkConfigs.some(c => !!c?.group);
        const hasChunkSubs = chunkConfigs.some(c => !!c?.subGroup);
        const chunkHeaderRowCount = (hasChunkGroups ? 1 : 0) + (hasChunkSubs ? 1 : 0) + 1;

        // Group header row
        if (hasChunkGroups) {
          thead += '<tr>';
          thead += `<th rowspan="${chunkHeaderRowCount}" style="border:1px solid #D9E0EA;${this.getPrintBorderCss(0, 0, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
          let ci2 = 0;
          while (ci2 < chunkConfigs.length) {
            const grp = chunkConfigs[ci2]?.group || '';
            let span = 1;
            while (ci2 + span < chunkConfigs.length && (chunkConfigs[ci2 + span]?.group || '') === grp) span++;
            if (grp) {
              const gBg = this.sanitizeCssColor(this.config?.groupColors?.[grp] || '', groupHeaderBg);
              const gText = this.sanitizeCssColor(this.config?.groupTextColors?.[grp] || '', groupHeaderText);
              thead += `<th colspan="${span}" style="border:1px solid #D9E0EA;${this.getPrintBorderCss(0, chunk.startIdx + ci2 + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px;background:${gBg};color:${gText};font-size:11px;font-weight:600;text-align:${this.exportGroupHeaderAlign('group', grp)};white-space:pre-line">${this.escapeHtmlWithLineBreaks(grp)}</th>`;
            } else {
              // No group — vertically merge down to column header row
              const totalHeaderRows = 1 + (hasChunkSubs ? 1 : 0) + 1;
              for (let j = 0; j < span; j++) {
                const fieldBg = this.getHeaderCellBg(chunk.cols[ci2 + j], headerRowBg);
                thead += `<th rowspan="${totalHeaderRows}" style="border:1px solid #D9E0EA;${this.getPrintBorderCss(totalHeaderRows - 1, chunk.startIdx + ci2 + j + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;vertical-align:middle;white-space:pre-line">${this.escapeHtmlWithLineBreaks(chunk.headers[ci2 + j])}</th>`;
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
            thead += `<th rowspan="2" style="border:1px solid #D9E0EA;${this.getPrintBorderCss(0, 0, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center;vertical-align:middle">Sl.No</th>`;
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
              const sgText = this.sanitizeCssColor(this.config?.subGroupTextColors?.[sub] || '', subGroupHeaderText);
              thead += `<th colspan="${span}" style="border:1px solid #D9E0EA;${this.getPrintBorderCss(1, chunk.startIdx + ci2 + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:5px;background:${sgBg};color:${sgText};font-size:10px;font-weight:600;text-align:${this.exportGroupHeaderAlign('subGroup', sub)};white-space:pre-line">${this.escapeHtmlWithLineBreaks(sub)}</th>`;
            } else {
              // Keep the subgroup band aligned; the actual column label stays below.
              for (let j = 0; j < span; j++) {
                if (hasGrp) {
                  thead += `<th style="border:1px solid #D9E0EA;${this.getPrintBorderCss(1, chunk.startIdx + ci2 + j + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:5px;background:${subGroupHeaderBg};color:#fff;font-size:11px;font-weight:600;text-align:center"></th>`;
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
          thead += `<th style="border:1px solid #D9E0EA;${this.getPrintBorderCss(0, 0, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px 10px;background:${this.SERIAL_HEADER_BG};color:${this.SERIAL_HEADER_FG};font-size:11px;font-weight:600;text-align:center">Sl.No</th>`;
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
            thead += `<th style="border:1px solid #D9E0EA;${this.getPrintBorderCss(chunkHeaderRowCount - 1, this.displayColumns.indexOf(chunk.cols[hi]) + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px 10px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${hdrInner}</th>`;
            continue;
          }
          thead += `<th style="border:1px solid #D9E0EA;${this.getPrintBorderCss(chunkHeaderRowCount - 1, this.displayColumns.indexOf(chunk.cols[hi]) + 1, chunkHeaderRowCount, this.displayColumns.length + 1, true, chunkHeaderRowCount)}padding:6px 10px;background:${fieldBg};font-size:11px;font-weight:600;text-align:center;white-space:pre-line">${hdrInner}</th>`;
        }
        thead += '</tr>';

        // Data rows for this batch
        let tbody = '';
        for (let ri = 0; ri < rowBatch.length; ri++) {
          const row = rowBatch[ri];
          const globalRowIdx = rowStart + ri;
          if (row[this.GROUP_LABEL_FLAG]) {
            // Group-header row: the grouped column shows "<value> (N)" (bold), every other column blank.
            const bg = this.getExportCellBg(globalRowIdx, '', row);
            const fg = this.getExportCellFg(globalRowIdx, '', row);
            const colors = `${bg ? `background:${bg};` : ''}${fg ? `color:${fg};` : ''}`;
            const slNoTd = `<td style="border:1px solid #D9E0EA;${this.getPrintBorderCss(globalRowIdx, 0, rows.length, this.displayColumns.length + 1)}padding:5px 10px;font-size:11px;text-align:center;${colors}"></td>`;
            const tds = chunk.cols.map(col => {
              const raw = row[col];
              const label = raw == null || raw === '' ? '' : this.escapeHtml(String(raw));
              const columnIndex = this.displayColumns.indexOf(col) + 1;
              const border = this.getPrintBorderCss(globalRowIdx, columnIndex, rows.length, this.displayColumns.length + 1);
              return `<td style="border:1px solid #D9E0EA;${border}padding:5px 10px;font-size:12px;font-weight:700;text-align:${this.getExportCellAlign(col, undefined, undefined, true)};${colors}">${label}</td>`;
            }).join('');
            tbody += `<tr>${slNoTd}${tds}</tr>`;
            continue;
          }
          if (row[this.TOTALS_ROW_FLAG]) {
            const bg = this.getExportCellBg(globalRowIdx, '', row);
            const fg = this.getExportCellFg(globalRowIdx, '', row);
            const colors = `${bg ? `background:${bg};` : ''}${fg ? `color:${fg};` : ''}`;
            const label = this.escapeHtml(String(row[this.TOTALS_LABEL_KEY] ?? 'Total'));
            const slNoTd = `<td style="border:1px solid #D9E0EA;${this.getPrintBorderCss(globalRowIdx, 0, rows.length, this.displayColumns.length + 1)}padding:5px 10px;font-size:12px;font-weight:700;text-align:center;${colors}">${label}</td>`;
            const tds = chunk.cols.map(col => {
              const display = this.getPrintDisplayValue(row, col);
              const columnIndex = this.displayColumns.indexOf(col) + 1;
              const border = this.getPrintBorderCss(globalRowIdx, columnIndex, rows.length, this.displayColumns.length + 1);
              return `<td style="border:1px solid #D9E0EA;${border}padding:5px 10px;font-size:12px;font-weight:700;text-align:${this.getExportCellAlign(col)};${colors}${this.exportNoWrapStyle(this.getPrintPlainValue(row, col))}">${display}</td>`;
            }).join('');
            tbody += `<tr>${slNoTd}${tds}</tr>`;
            continue;
          }
          const dataIdx = dataSeqByIndex[globalRowIdx];
          const styleRowIndex = styleIndices.get(row);
          const slNo = dataIdx + 1;
          const slNoTd = `<td style="border:1px solid #D9E0EA;${this.getPrintBorderCss(globalRowIdx, 0, rows.length, this.displayColumns.length + 1)}padding:5px 10px;font-size:11px;text-align:center">${slNo}</td>`;
          const tds = chunk.cols.map(col => {
            const columnIndex = this.displayColumns.indexOf(col) + 1;
            // Leaf rows leave the grouped columns blank (their value is on the group-header row above).
            if (groupedFields.has(col)) {
              const bgBlank = this.getExportCellBg(dataIdx, col, row, styleRowIndex);
              const border = this.getPrintBorderCss(globalRowIdx, columnIndex, rows.length, this.displayColumns.length + 1);
              return `<td style="border:1px solid #D9E0EA;${border}padding:5px 10px;font-size:11px;${bgBlank ? `background:${bgBlank};` : ''}"></td>`;
            }
            const display = this.getPrintDisplayValue(row, col);
            const bg = this.getExportCellBg(dataIdx, col, row, styleRowIndex);
            const fg = this.getExportCellFg(dataIdx, col, row, styleRowIndex);
            const bgStyle = bg ? `background:${bg};` : '';
            const fgStyle = fg ? `color:${fg};` : '';
            // Vertical-orientation cells render the full value as rotated, wrapping text.
            const cellInner = this.isExportCellVertical(dataIdx, col, row)
              ? `<div style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:normal;word-break:break-word;max-height:150px;">${display}</div>`
              : display;
            const isVertical = this.isExportCellVertical(dataIdx, col, row);
            const vAlign = isVertical ? 'vertical-align:top;' : '';
            const noWrap = isVertical ? '' : this.exportNoWrapStyle(this.getPrintPlainValue(row, col));
            const border = this.getPrintBorderCss(globalRowIdx, columnIndex, rows.length, this.displayColumns.length + 1);
            const hAlign = `text-align:${this.getExportCellAlign(col, row, styleRowIndex)};`;
            return `<td style="border:1px solid #D9E0EA;${border}padding:5px 10px;font-size:11px;${hAlign}${bgStyle}${fgStyle}${vAlign}${noWrap}">${cellInner}</td>`;
          }).join('');
          tbody += `<tr>${slNoTd}${tds}</tr>`;
        }

        if (isFirst) {
          // First page: banner + KPIs + data table directly, no outer wrapper
          // The configured footer banner rides in a <tfoot> (table-footer-group) so it repeats at
          // the bottom of every printed page, matching the on-screen report footer.
          tablesHtml += `
            ${bannerHtml}
            ${clusterBannerHtml}
            ${legendsHtml}
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

    // Wide reports get a custom-width page sized to the table (screen viewing: the PDF viewer fits the
    // page to the window), so columns keep a readable width. Narrow reports keep standard landscape.
    // The side margin matches the body's horizontal padding below.
    const pageMarginMm = 10;
    const MAX_PAGE_WIDTH_MM = 5000;
    const PX_TO_MM = 25.4 / 96;
    const wantedPageWidthMm = Math.ceil(maxTableWidthPx * PX_TO_MM) + pageMarginMm * 2 + 2;
    const pageSizeCss = wantedPageWidthMm > 277
      ? `${Math.min(wantedPageWidthMm, MAX_PAGE_WIDTH_MM)}mm 210mm`
      : 'landscape';

    // The browser prints its own date/title/URL header & footer inside the @page margin. A zero page
    // margin suppresses them, so the real margins are rebuilt here: side padding on the body and a
    // spacer in an outer table's thead/tfoot, which repeat on every printed page.
    return `<!DOCTYPE html><html><head><title>${displayTitle}</title>
    <style>
      @page { size: ${pageSizeCss}; margin: 0; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
      }
      * { box-sizing: border-box; }
      body { font-family: ${fontFam}; margin: 0; padding: 0 ${pageMarginMm}mm; font-size: ${fontSize}px; }
      .rv-page-wrap > tbody > tr { page-break-inside: auto; break-inside: auto; }
      .rv-page-spacer { height: 15mm; padding: 0; border: 0; }
      /* Fixed table layout clips overflow, so let long values/headers wrap within their column,
         breaking inside a word only when that single word is wider than the column. */
      td, th { word-break: normal; overflow-wrap: break-word; }
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
      .rv-export-cluster-banner {
        padding: 10px 20px; margin: -8px 0 16px; border-radius: 6px;
        background: #A6A6A6; color: #1A1A1A; font-size: 15px; font-weight: 700;
        text-align: center; letter-spacing: 0.02em;
      }
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
    <body><table class="rv-page-wrap" style="width:100%"><thead><tr><td class="rv-page-spacer"></td></tr></thead><tfoot><tr><td class="rv-page-spacer"></td></tr></tfoot><tbody><tr><td style="padding:0">${tablesHtml}</td></tr></tbody></table></body></html>`;
  }
}

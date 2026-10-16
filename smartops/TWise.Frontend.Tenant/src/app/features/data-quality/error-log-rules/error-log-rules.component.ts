import { Component, HostListener, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type Highcharts from 'highcharts';
import { forkJoin } from 'rxjs';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  themeQuartz,
  PaginationModule
} from 'ag-grid-community';
import { DataQualityService } from '../../../core/services/data-quality.service';
import { CommonApiService, DatabaseViewListItem } from '../../../core/services/common-api.service';
import { Breadcrumb } from '../../../core/models/breadcrumb.model';
import { PermissionService } from '../../../core/services/permission.service';
import { NotificationRefreshService } from '../../../core/services/notification-refresh.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { VrActionsRendererComponent } from './cell-renderers/vr-actions-renderer.component';
import { VrRuleIdRendererComponent } from './cell-renderers/vr-ruleid-renderer.component';
import { SeverityRendererComponent } from './cell-renderers/severity-renderer.component';
import { positionReportPaginationPopup } from '../../reports/shared/report-grid-popup.util';

ModuleRegistry.registerModules([ClientSideRowModelModule,PaginationModule]);

export interface ErrorSummaryCard {
  icon: 'critical' | 'errors' | 'warnings' | 'info' | 'sla-breached' | 'sla-due';
  accent: 'red' | 'amber' | 'orange' | 'yellow' | 'blue' | 'green';
  label: string;
  value: number;
  description: string;
}

export interface ErrorTypeRow {
  color: string;
  bgColor: string;
  iconType: 'completeness' | 'reference' | 'data-integrity' | 'range-check' | 'calculation' | 'logical' | 'formula';
  label: string;
  count: number;
  percent: number;
}

export interface ErrorLogRow {
  errorId: string;
  date: string;
  severity: string;
  ruleId: string;
  ruleName: string;
  category: string;
  status: string;
  sla: string;
  tableName: string;
  columnsUsed: string;
  recordsPerExecution: string;
  ruleDesc: string;
}

export interface ValidationRuleRow {
  ruleId: string;
  ruleName: string;
  category: string;
  view: string;
  table: string;
  field: string;
  severity: string;
  status: string;
  triggeredOn: string;
  generatedSql: string;
}

type DashboardBreadcrumbContext = {
  boardFrom: 'wip' | 'standard';
  boardId: number;
  boardTitle: string;
  boardParentLabel: string;
};

const DQ_GRID_THEME = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#dfe6e9',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#344054',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  selectedRowBackgroundColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

@Component({
  selector: 'app-error-log-rules',
  standalone: false,
  templateUrl: './error-log-rules.component.html',
  styleUrls: ['./error-log-rules.component.scss'],
})
export class ErrorLogRulesComponent implements OnInit {
  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly dataQualityService: DataQualityService,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly permissionService: PermissionService,
    private readonly notificationRefreshService: NotificationRefreshService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  readonly notify: NotificationHelper;

  get canCreate(): boolean { return this.permissionService.canCreate('data-quality.error-log'); }
  get canModify(): boolean { return this.permissionService.canModify('data-quality.error-log'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('data-quality.error-log'); }
  get breadcrumbs(): Breadcrumb[] {
    if (!this.dashboardBreadcrumbContext) {
      return [
        { label: 'Home', route: '/' },
        { label: 'Data Quality' },
        { label: 'Error Log & Rules' },
      ];
    }

    const { boardFrom, boardId, boardTitle, boardParentLabel } = this.dashboardBreadcrumbContext;
    return [
      { label: 'Home', route: '/' },
      { label: 'Dashboard', route: '/dashboard' },
      { label: boardParentLabel, route: boardFrom === 'standard' ? '/dashboard/standard-boards' : '/dashboard/wip-boards' },
      { label: boardTitle, route: `/dashboard/operations-dashboard/${boardId}`, queryParams: { from: boardFrom } },
      { label: 'Data Quality' },
      { label: 'Error Log & Rules' },
    ];
  }

  activeTab: 'error-log' | 'validation-rules' = 'error-log';

  // Header dropdowns
  selectedPeriod = 'This Week';
  readonly periodOptions = ['Today', 'This Week', 'This Month', 'Last Month', 'Custom'];
  showPeriodDropdown = false;
  selectedSla = 'All SLA';
  readonly slaOptions = ['All SLA', 'SLA Breached', 'SLA Due Soon', 'No SLA'];
  showSlaDropdown = false;
  globalSearch = '';

  // Summary cards
  summaryCards: ErrorSummaryCard[] = [
    { icon: 'critical',    accent: 'red',    label: 'Critical',     value: 0, description: 'Needs immediate resolution'       },
    { icon: 'errors',      accent: 'amber',  label: 'High',         value: 0, description: 'Requires prompt resolution'     },
    { icon: 'warnings',    accent: 'yellow', label: 'Medium',       value: 0, description: 'Needs timely review' },
    { icon: 'info',        accent: 'blue',   label: 'Low',          value: 0, description: 'Requires routine monitoring'             },
    { icon: 'sla-breached',accent: 'orange', label: 'SLA Breached', value: 0, description: 'Resolution deadline exceeded'     },
    { icon: 'sla-due',     accent: 'green',  label: 'SLA Due Soon', value: 0, description: 'Deadline approaching soon'        },
  ];

  // Error types list
  readonly errorTypes: ErrorTypeRow[] = [
    { color: '#12B76A', bgColor: '#EEF8EE', iconType: 'completeness',   label: 'Completeness',   count: 0, percent: 0 },
    { color: '#7C3AED', bgColor: '#EAF6FF', iconType: 'reference',       label: 'Reference',      count: 0, percent: 0 },
    { color: '#2563EB', bgColor: '#FDEFFF', iconType: 'data-integrity',  label: 'Data Integrity', count: 0, percent: 0 },
    { color: '#F59E0B', bgColor: '#FFF4E8', iconType: 'range-check',     label: 'Range Check',    count: 0, percent: 0 },
    { color: '#F97316', bgColor: '#FFF8E1', iconType: 'calculation',     label: 'Calculation',    count: 0, percent: 0 },
    { color: '#0F172A', bgColor: '#F5F5F5', iconType: 'logical',         label: 'Logical',        count: 0, percent: 0 },
    { color: '#EC4899', bgColor: '#FFF1F6', iconType: 'formula',         label: 'Formula',        count: 0, percent: 0 },
  ];

  // Error Log filters
  errLogCountrySearch = '';
  errLogCategory = '';
  errLogSeverity = '';
  errLogStatus = '';

  // Validation Rules filters
  valRuleCountry = '';
  valRuleSla = '';
  valRuleCategory = '';
  valRuleSeverity = '';
  valRuleDateFrom = '';
  valRuleDateTo = '';
  valRuleStatus = '';

  readonly categoryOptions = ['All Category', 'Completeness', 'Reference', 'Data Integrity', 'Range Check', 'Calculation / Formula', 'Logical', 'Format Validation'];
  readonly severityOptions  = ['Severity', 'Critical', 'High', 'Medium', 'Low'];
  readonly statusOptions    = ['All Status', 'Open', 'In Progress', 'Close', 'On Hold', 'Invalid'];
  readonly slaFilterOptions = ['All SLA', 'SLA Breached', 'SLA Due Soon', 'No SLA'];

  // AG Grid pagination
  gridPagination = true;
  gridPaginationPageSize = 20;
  gridPaginationPageSizeSelector = [10, 20, 50, 100];
  readonly gridPopupParent: HTMLElement = document.body;
  readonly postProcessGridPopup = positionReportPaginationPopup;

  // AG Grid
  readonly gridTheme = DQ_GRID_THEME;

  private readonly errorLogTruncatedCell: ColDef<ErrorLogRow> = {
    wrapText: false,
    autoHeight: false,
    tooltip: params => String(params.value ?? ''),
  };

  readonly errorLogColumns: ColDef<ErrorLogRow>[] = [
    { headerName: 'Error ID',     field: 'errorId',     minWidth: 110,
      cellClass: 'error-id-clickable',
      onCellClicked: params => {
        if (params.data) this.openErrorLogDetails(params.data);
      } },
    { headerName: 'Date',         field: 'date',         minWidth: 160, ...this.errorLogTruncatedCell },
    { headerName: 'Severity',     field: 'severity',     minWidth: 120,
      cellRenderer: SeverityRendererComponent },
    { headerName: 'Rule ID',      field: 'ruleId',       minWidth: 110,
      cellClass: 'rule-id-clickable',
      onCellClicked: params => {
        if (params.data) this.openRuleView(params.data.ruleId, 'error-log');
      } },
    { headerName: 'Rule Name',    field: 'ruleName',     minWidth: 260, ...this.errorLogTruncatedCell },
    { headerName: 'Category',     field: 'category',     minWidth: 130, ...this.errorLogTruncatedCell },
    { headerName: 'Table Name',   field: 'tableName',    minWidth: 240, ...this.errorLogTruncatedCell },
    { headerName: 'Columns Used', field: 'columnsUsed',  minWidth: 260, ...this.errorLogTruncatedCell },
    { headerName: 'No. of Records per Execution', field: 'recordsPerExecution', minWidth: 200, ...this.errorLogTruncatedCell },
    { headerName: 'Rule Desc',    field: 'ruleDesc',     minWidth: 300, ...this.errorLogTruncatedCell },
  ];

  readonly elGridContext = {
    onStatusChange: (row: ErrorLogRow, newStatus: string) => this.updateErrorStatus(row, newStatus),
  };

  private readonly truncatedCell: ColDef<ValidationRuleRow> = {
    wrapText: false,
    autoHeight: false,
    tooltip: params => String(params.value ?? ''),
  };

  readonly validationRulesColumns: ColDef<ValidationRuleRow>[] = [
    { headerName: 'Rule ID',      field: 'ruleId',      minWidth: 110,
      cellRenderer: VrRuleIdRendererComponent },
    { headerName: 'Rule Name',    field: 'ruleName',    minWidth: 280, ...this.truncatedCell },
    { headerName: 'Category',     field: 'category',    minWidth: 130, ...this.truncatedCell },
    { headerName: 'View',         field: 'view',        minWidth: 260, ...this.truncatedCell },
    { headerName: 'Table',        field: 'table',       minWidth: 240, ...this.truncatedCell },
    { headerName: 'Field',        field: 'field',       minWidth: 240, ...this.truncatedCell },
    { headerName: 'Severity',     field: 'severity',    minWidth: 120,
      cellRenderer: SeverityRendererComponent },
    { headerName: 'Triggered on', field: 'triggeredOn', minWidth: 150, ...this.truncatedCell },
    { headerName: 'Actions', sortable: false, filter: false, minWidth: 140, maxWidth: 240,
      cellRenderer: VrActionsRendererComponent },
  ];

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, flex: 1, wrapText: true, autoHeight: true };

  readonly vrGridContext = {
    canModify: () => this.canModify,
    onTrigger: (row: ValidationRuleRow) => this.triggerRule(row),
    onEdit: (row: ValidationRuleRow) => this.editRule(row),
    onDelete: (row: ValidationRuleRow) => this.deleteRule(row),
    onViewRule: (row: ValidationRuleRow) => this.openRuleView(row.ruleId),
  };

  errorLogRows: ErrorLogRow[] = [];
  validationRulesRows: ValidationRuleRow[] = [];
  selectedErrorLog: ErrorLogRow | null = null;

  openErrorLogDetails(row: ErrorLogRow): void {
    this.selectedErrorLog = row;
    this.cdr.detectChanges();
  }

  closeErrorLogDetails(): void {
    this.selectedErrorLog = null;
  }

  /** Splits a comma-separated list field into trimmed, non-empty chips for the details modal. */
  private toChipList(value: string | null | undefined): string[] {
    return (value || '').split(',').map(v => v.trim()).filter(Boolean);
  }

  get selectedErrorLogTables(): string[] {
    return this.toChipList(this.selectedErrorLog?.tableName);
  }

  get selectedErrorLogColumns(): string[] {
    return this.toChipList(this.selectedErrorLog?.columnsUsed);
  }

  badgeClass(value: string | null | undefined): string {
    return (value || '').toLowerCase().replace(/\s+/g, '');
  }

  // Track error IDs whose status was just changed — exclude from filter until reload
  private recentlyChangedIds = new Set<string>();

  filteredErrorLogRows: ErrorLogRow[] = [];
  filteredValidationRulesRows: ValidationRuleRow[] = [];
  errorLogSubTab: 'with-records' | 'no-records' = 'with-records';
  errorLogWithRecordsCount = 0;
  errorLogNoRecordsCount = 0;

  setErrorLogSubTab(tab: 'with-records' | 'no-records'): void {
    this.errorLogSubTab = tab;
    this.applyFilters();
  }

  applyFilters(): void {
    let rows = this.errorLogRows;
    const search = this.globalSearch.trim().toLowerCase();
    if (search) rows = rows.filter(r =>
      r.errorId.toLowerCase().includes(search) || r.ruleName.toLowerCase().includes(search) ||
      r.ruleId.toLowerCase().includes(search));
    if (this.selectedSeverity && this.selectedSeverity !== 'Severity')
      rows = rows.filter(r => r.severity === this.selectedSeverity);
    if (this.selectedStatus && this.selectedStatus !== 'All Status')
      rows = rows.filter(r => r.status === this.selectedStatus || this.recentlyChangedIds.has(r.errorId));
    if (this.selectedCategory && this.selectedCategory !== 'All Category')
      rows = rows.filter(r => r.category === this.selectedCategory);
    if (this.selectedSla === 'SLA Breached') rows = rows.filter(r => r.sla?.toLowerCase() === 'breached' || this.recentlyChangedIds.has(r.errorId));
    else if (this.selectedSla === 'SLA Due Soon') rows = rows.filter(r => r.sla?.toLowerCase() === 'due soon' || this.recentlyChangedIds.has(r.errorId));
    else if (this.selectedSla === 'No SLA') rows = rows.filter(r => !r.sla || this.recentlyChangedIds.has(r.errorId));
    this.errorLogWithRecordsCount = rows.filter(row => this.recordsFound(row) > 0).length;
    this.errorLogNoRecordsCount = rows.length - this.errorLogWithRecordsCount;
    this.filteredErrorLogRows = rows.filter(row =>
      this.errorLogSubTab === 'with-records' ? this.recordsFound(row) > 0 : this.recordsFound(row) === 0);
    this.updateSummaryCards(rows);

    let vr = this.validationRulesRows;
    if (search) vr = vr.filter(r =>
      r.ruleId.toLowerCase().includes(search) || r.ruleName.toLowerCase().includes(search) ||
      r.table.toLowerCase().includes(search));
    if (this.selectedSeverity && this.selectedSeverity !== 'Severity')
      vr = vr.filter(r => r.severity === this.selectedSeverity);
    if (this.selectedStatus && this.selectedStatus !== 'All Status') {
      // Map error statuses to rule statuses: Open → Active, Close → Inactive
      const ruleStatus = this.selectedStatus === 'Open' ? 'Active' : this.selectedStatus === 'Close' ? 'Inactive' : null;
      if (ruleStatus) vr = vr.filter(r => r.status === ruleStatus);
    }
    if (this.selectedCategory && this.selectedCategory !== 'All Category')
      vr = vr.filter(r => r.category === this.selectedCategory);
    this.filteredValidationRulesRows = vr;
  }

  private updateSummaryCards(rows: ErrorLogRow[]): void {
    const rowsWithRecords = rows.filter(row => this.recordsFound(row) > 0);
    const critical = rowsWithRecords.filter(r => r.severity === 'Critical').length;
    const high     = rowsWithRecords.filter(r => r.severity === 'High').length;
    const medium   = rowsWithRecords.filter(r => r.severity === 'Medium').length;
    const low      = rowsWithRecords.filter(r => r.severity === 'Low').length;
    const open     = rows.filter(r => r.status === 'Open').length;
    const total    = rows.length;

    this.summaryCards[0].value = critical;
    this.summaryCards[1].value = high;
    this.summaryCards[2].value = medium;
    this.summaryCards[3].value = low;
    this.summaryCards[4].value = open;
    this.summaryCards[5].value = total - open;
  }

  private recordsFound(row: ErrorLogRow): number {
    const found = Number.parseInt(row.recordsPerExecution.split('/')[0], 10);
    return Number.isFinite(found) ? found : 0;
  }

  preloadedViews: DatabaseViewListItem[] = [];

  /** True until both the error-log and validation-rules initial loads have settled. */
  isLoading = true;
  private errorLogsLoaded = false;
  private validationRulesLoaded = false;

  private checkInitialLoadComplete(): void {
    if (this.errorLogsLoaded && this.validationRulesLoaded) {
      this.isLoading = false;
      const pendingError = this.pendingErrorRuleId
        ? this.errorLogRows.find(row => row.ruleId === this.pendingErrorRuleId)
        : undefined;
      if (pendingError) {
        this.setErrorLogSubTab(this.recordsFound(pendingError) > 0 ? 'with-records' : 'no-records');
        this.openErrorLogDetails(pendingError);
        this.pendingErrorRuleId = null;
      }
      this.cdr.detectChanges();
    }
  }

  private pendingErrorRuleId: string | null = null;
  private dashboardBreadcrumbContext: DashboardBreadcrumbContext | null = null;

  ngOnInit(): void {
    this.loadValidationRules();
    this.loadErrorLogs();
    this.commonApi.getDatabaseViews('view').subscribe({
      next: (views) => { this.preloadedViews = views ?? []; },
    });

    const params = this.route.snapshot.queryParamMap;
    this.returnUrl = this.safeReturnUrl(params.get('returnUrl'));
    this.dashboardBreadcrumbContext = this.readDashboardBreadcrumbContext(params);
    const viewRuleId = params.get('viewRuleId');
    this.pendingErrorRuleId = params.get('errorRuleId');
    if (viewRuleId) {
      this.activeTab = 'validation-rules';
      this.openRuleView(viewRuleId);
    }
  }

  /** Only same-app absolute paths are accepted, to avoid open redirects. */
  private safeReturnUrl(url: string | null): string | null {
    if (!url) return null;
    return /^\/(?!\/)[^\\]*$/.test(url) ? url : null;
  }

  private readDashboardBreadcrumbContext(params: { get(name: string): string | null }): DashboardBreadcrumbContext | null {
    const boardFrom = params.get('boardFrom');
    const boardIdValue = params.get('boardId');
    const boardTitle = (params.get('boardTitle') ?? '').trim();
    const boardParentLabel = (params.get('boardParentLabel') ?? '').trim();
    const boardId = Number(boardIdValue);

    if ((boardFrom !== 'wip' && boardFrom !== 'standard')
      || !Number.isInteger(boardId) || boardId <= 0
      || !boardTitle || !boardParentLabel) {
      return null;
    }

    return { boardFrom, boardId, boardTitle, boardParentLabel };
  }

  private loadErrorLogs(): void {
    this.recentlyChangedIds.clear();
    this.dataQualityService.listOpenErrors().subscribe({
      next: (res) => {
        this.errorLogRows = (res.data?.errors ?? []).map(e => ({
          errorId: e.errorId,
          date: e.createdAt ?? '',
          severity: e.severity ?? '',
          ruleId: e.ruleId,
          ruleName: e.ruleName ?? '',
          category: e.category ?? '',
          status: e.status ?? 'Open',
          sla: e.sla ?? '',
          tableName: e.tableName ?? '',
          columnsUsed: e.fields ?? '',
          recordsPerExecution: e.maxRecords != null ? `${e.recordsFound ?? 0}/${e.maxRecords}` : '',
          ruleDesc: e.ruleDesc ?? '',
        }));
        this.applyFilters();
        this.errorLogsLoaded = true;
        this.checkInitialLoadComplete();
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorLogsLoaded = true;
        this.checkInitialLoadComplete();
      },
    });
  }

  private loadValidationRules(): void {
    forkJoin({
      rules: this.dataQualityService.listRules(),
      views: this.commonApi.getDatabaseViews(),
    }).subscribe({
      next: ({ rules: res, views }) => {
        const viewNamesById = new Map(views.map(view => [view.id, view.viewName]));
        this.validationRulesRows = (res.data?.rules ?? [])
          .map(r => ({
            ruleId: r.ruleId,
            ruleName: r.ruleName,
            category: r.category,
            view: r.sourceType?.toLowerCase() === 'view' && r.viewId != null
              ? viewNamesById.get(r.viewId) ?? ''
              : 'NA',
            table: r.table,
            field: r.fields ?? '',
            severity: r.severity,
            status: r.activeYn === 'Y' ? 'Active' : 'Inactive',
            triggeredOn: r.triggeredOn ?? '',
            generatedSql: r.query ?? '',
          }))
          .sort((first, second) => this.ruleIdNumber(second.ruleId) - this.ruleIdNumber(first.ruleId));
        this.applyFilters();
        this.validationRulesLoaded = true;
        this.checkInitialLoadComplete();
        this.cdr.detectChanges();
      },
      error: () => {
        this.validationRulesLoaded = true;
        this.checkInitialLoadComplete();
      },
    });
  }

  private ruleIdNumber(ruleId: string): number {
    return Number.parseInt(ruleId.replace(/\D/g, ''), 10) || 0;
  }

  // ─── Highcharts Options ───────────────────────────────────────────────────

  /** Error Trends — multi-series line chart (8-week rolling by type) */
  readonly errorTrendsOptions: Highcharts.Options = {
    chart: { type: 'line', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      layout: 'horizontal',
      itemDistance: 20,
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#667085' },
      symbolWidth: 24,
      squareSymbol: false,
    },
    xAxis: {
      categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
      lineColor: '#E7ECF3',
      tickColor: 'transparent',
      gridLineColor: '#EEF2FF',
      gridLineWidth: 1,
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    yAxis: {
      title: { text: undefined },
      gridLineColor: '#EEF2FF',
      min: 0, max: 500, tickInterval: 125,
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    tooltip: { shared: true },
    plotOptions: {
      line: {
        marker: { radius: 5, symbol: 'circle', lineWidth: 2, lineColor: undefined },
      },
    },
    series: [
      {
        type: 'line', name: 'Completeness', color: '#66BB6A', lineWidth: 2.5,
        data: [75, 100, 80, 100, 90, 100, 55, 100],
        marker: { fillColor: '#fff', lineColor: '#66BB6A', lineWidth: 2 },
        shadow: { color: '#66BB6A', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
      {
        type: 'line', name: 'Reference', color: '#29B6F6', lineWidth: 2.5,
        data: [125, 125, 100, 130, 130, 130, 80, 120],
        marker: { fillColor: '#fff', lineColor: '#29B6F6', lineWidth: 2 },
        shadow: { color: '#29B6F6', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
      {
        type: 'line', name: 'Data Integrity', color: '#AB47BC', lineWidth: 2.5,
        data: [310, 300, 280, 330, 310, 280, 240, 280],
        marker: { fillColor: '#fff', lineColor: '#AB47BC', lineWidth: 2 },
        shadow: { color: '#AB47BC', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
      {
        type: 'line', name: 'Range Check', color: '#FFA726', lineWidth: 2.5,
        data: [230, 240, 230, 330, 330, 295, 195, 170],
        marker: { fillColor: '#fff', lineColor: '#FFA726', lineWidth: 2 },
        shadow: { color: '#FFA726', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
      {
        type: 'line', name: 'Logical', color: '#8979FF', lineWidth: 2.5,
        data: [350, 375, 320, 380, 390, 350, 280, 340],
        marker: { fillColor: '#fff', lineColor: '#8979FF', lineWidth: 2 },
        shadow: { color: '#8979FF', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
      {
        type: 'line', name: 'Formula', color: '#FF928A', lineWidth: 2.5,
        data: [380, 425, 385, 420, 430, 380, 280, 365],
        marker: { fillColor: '#fff', lineColor: '#FF928A', lineWidth: 2 },
        shadow: { color: '#FF928A', width: 12, opacity: 0.3, offsetX: 0, offsetY: 0 },
      },
    ],
  };

  /** SLA Compliance Rate — column chart (8-week rolling) */
  /** SLA Compliance Rate — column chart (8-week rolling) */
  readonly slaComplianceOptions: Highcharts.Options = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 200 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#667085' },
      symbolRadius: 6,
    },
    xAxis: {
      categories: ['W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'],
      lineColor: '#E7ECF3',
      tickColor: 'transparent',
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    yAxis: {
      title: { text: undefined },
      gridLineColor: '#EEF2FF',
      gridLineDashStyle: 'Dot',
      min: 0, max: 100, tickInterval: 25,
      labels: { format: '{value}', style: { fontSize: '11px', color: '#667085' } },
    },
    tooltip: { valueSuffix: '%' },
    plotOptions: {
      column: { borderRadius: 4, borderWidth: 0, pointPadding: 0.08, groupPadding: 0.12 },
    },
    series: [{
      type: 'column',
      name: 'SLA Percent',
      color: '#F59E0B',
      data: [
        { y: 35, color: '#EF5350' },
        { y: 70, color: '#66BB6A' },
        { y: 73, color: '#66BB6A' },
        { y: 72, color: '#66BB6A' },
        { y: 77, color: '#66BB6A' },
        { y: 76, color: '#66BB6A' },
        { y: 65, color: '#66BB6A' },
        { y: 18, color: '#EF5350' },
      ],
    }],
  };

  /** Resolution Status — horizontal stacked bar */
  /** Resolution Status — progress-bar style: gray track + colored bar per status */
  readonly resolutionStatusOptions: Highcharts.Options = {
    chart: { type: 'bar', backgroundColor: 'transparent', height: 320 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      layout: 'horizontal',
      itemDistance: 16,
      symbolRadius: 6,
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#667085' },
    },
    xAxis: {
      categories: ['Open', 'Close', 'In Progress', 'On Hold', 'Invalid'],
      lineColor: 'transparent',
      gridLineWidth: 0,
      labels: { enabled: false },
    },
    yAxis: {
      title: { text: undefined },
      gridLineWidth: 0,
      labels: { enabled: false },
      min: 0, max: 18,
    },
    tooltip: { enabled: false },
    plotOptions: {
      bar: {
        grouping: false,
        borderWidth: 0,
        borderRadius: 4,
        groupPadding: 0.08,
        pointPadding: 0.06,
      },
    },
    series: [
      // ── Gray background tracks (behind colored bars) ──
      {
        type: 'bar', name: '_bg', showInLegend: false,
        enableMouseTracking: false, color: '#F2F4F7', zIndex: 0,
        dataLabels: { enabled: false },
        data: [{ x: 0, y: 18 }, { x: 1, y: 18 }, { x: 2, y: 18 }, { x: 3, y: 18 }, { x: 4, y: 18 }],
      },
      // ── Colored bars (on top) ──
      {
        type: 'bar', name: 'Open', color: '#EF5350', zIndex: 1,
        data: [{ x: 0, y: 6 }],
        dataLabels: { enabled: true, inside: false, align: 'left', crop: false, overflow: 'allow',
          format: '6 (33%)', style: { fontSize: '11px', fontWeight: '600', color: '#344054', textOutline: 'none' } },
      },
      {
        type: 'bar', name: 'Close', color: '#66BB6A', zIndex: 1,
        data: [{ x: 1, y: 11 }],
        dataLabels: { enabled: true, inside: false, align: 'left', crop: false, overflow: 'allow',
          format: '6 (33%)', style: { fontSize: '11px', fontWeight: '600', color: '#344054', textOutline: 'none' } },
      },
      {
        type: 'bar', name: 'In Progress', color: '#FFA726', zIndex: 1,
        data: [{ x: 2, y: 13 }],
        dataLabels: { enabled: true, inside: false, align: 'left', crop: false, overflow: 'allow',
          format: '6 (33%)', style: { fontSize: '11px', fontWeight: '600', color: '#344054', textOutline: 'none' } },
      },
      {
        type: 'bar', name: 'On Hold', color: '#42A5F5', zIndex: 1,
        data: [{ x: 3, y: 18 }],
        dataLabels: { enabled: true, inside: true, align: 'right', crop: false, overflow: 'allow',
          format: '6 (33%)', style: { fontSize: '11px', fontWeight: '600', color: '#fff', textOutline: 'none' } },
      },
      {
        type: 'bar', name: 'Invalid', color: '#78909C', zIndex: 1,
        data: [{ x: 4, y: 5 }],
        dataLabels: { enabled: true, inside: false, align: 'left', crop: false, overflow: 'allow',
          format: '6 (33%)', style: { fontSize: '11px', fontWeight: '600', color: '#344054', textOutline: 'none' } },
      },
    ],
  };

  readonly wellCompleteness = [
    { name: 'TUQAA_PH1_DP_I...', percent: 97, accent: 'green' },
    { name: '34561...',           percent: 97, accent: 'green' },
    { name: 'NMR_WSW_1',         percent: 97, accent: 'green' },
    { name: 'NMR_WSW_4',         percent: 97, accent: 'green' },
    { name: '34357',              percent: 97, accent: 'amber' },
    { name: '34422',              percent: 97, accent: 'green' },
    { name: 'AMIN_OP31',          percent: 97, accent: 'amber' },
  ];

  /** Data Completeness By Well — progress-bar style with gray track */
  readonly dataCompletenessOptions: Highcharts.Options = {
    chart: { type: 'bar', backgroundColor: 'transparent', height: 320 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      symbolRadius: 6,
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#667085' },
    },
    xAxis: {
      categories: ['TUQAA_PH1_DP_I...', '34561...', 'NMR_WSW_1', 'NMR_WSW_4', '34357', '34422', 'AMIN_OP31'],
      lineColor: 'transparent',
      tickColor: 'transparent',
      gridLineWidth: 0,
      labels: { style: { fontSize: '11px', color: '#667085' }, align: 'right' },
    },
    yAxis: {
      title: { text: undefined },
      gridLineWidth: 0,
      labels: { enabled: false },
      min: 0, max: 100,
    },
    tooltip: { valueSuffix: '%' },
    plotOptions: {
      bar: {
        grouping: false,
        borderWidth: 0,
        borderRadius: 4,
        groupPadding: 0.08,
        pointPadding: 0.06,
      },
    },
    series: [
      // Gray background tracks
      {
        type: 'bar', name: '_bg', showInLegend: false,
        enableMouseTracking: false, color: '#F2F4F7', zIndex: 0,
        dataLabels: { enabled: false },
        data: [100, 100, 100, 100, 100, 100, 100],
      },
      // Colored bars (green or amber per well)
      {
        type: 'bar',
        name: 'Completeness Percent',
        color: '#66BB6A',
        zIndex: 1,
        data: [
          { y: 97, color: '#66BB6A' }, // TUQAA_PH1_DP_I...
          { y: 97, color: '#66BB6A' }, // 34561...
          { y: 97, color: '#66BB6A' }, // NMR_WSW_1
          { y: 97, color: '#66BB6A' }, // NMR_WSW_4
          { y: 97, color: '#FFA726' }, // 34357
          { y: 97, color: '#66BB6A' }, // 34422
          { y: 97, color: '#FFA726' }, // AMIN_OP31
        ],
        dataLabels: {
          enabled: true,
          format: '{y}%',
          style: { fontSize: '12px', fontWeight: '700', color: '#101828', textOutline: 'none' },
          align: 'left',
          inside: false,
          crop: false,
          overflow: 'allow',
        },
      },
    ],
  };

  /** Missing Fields By Category — donut chart */
  readonly missingFieldsOptions: Highcharts.Options = {
    chart: { type: 'pie', backgroundColor: 'transparent', height: 260 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'middle',
      layout: 'vertical',
      useHTML: true,
      symbolRadius: 6,
      itemMarginBottom: 8,
      itemStyle: { fontSize: '12px', fontWeight: '500', color: '#344054', cursor: 'default' },
      labelFormatter(this: Highcharts.Point | Highcharts.Series) {
        const pt = this as Highcharts.Point & { y: number; name: string };
        return `<span style="display:flex;align-items:center;justify-content:space-between;width:132px;gap:6px;">
          <span style="font-size:12px;font-weight:500;color:#344054;">${pt.name}</span>
          <span style="font-size:13px;font-weight:700;color:#101828;">${pt.y}</span>
        </span>`;
      },
    },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
    plotOptions: {
      pie: {
        innerSize: '55%',
        borderWidth: 2,
        borderColor: '#fff',
        dataLabels: { enabled: false },
        showInLegend: true,
      },
    },
    series: [{
      type: 'pie',
      name: 'Missing Fields',
      data: [
        { name: 'Date Missing',    y: 8, color: '#5058C9' },
        { name: 'Depth Missing:',  y: 8, color: '#42A5F5' },
        { name: 'Status Missing:', y: 8, color: '#66BB6A' },
        { name: 'Rate Missing:',   y: 8, color: '#FFA726' },
        { name: 'ID Missing:',     y: 8, color: '#FFEE58' },
      ],
    }],
  };

  selectedSeverity = 'Severity';
  showSeverityDropdown = false;
  selectedStatus = 'All Status';
  showStatusDropdown = false;
  selectedCategory = 'All Category';
  showCategoryDropdown = false;

  // ─── Event Handlers ───────────────────────────────────────────

  showExportModal = false;
  toggleExportModal(): void { this.showExportModal = !this.showExportModal; }
  exportAs(_format: string): void { this.showExportModal = false; }

  @HostListener('document:click')
  closeDropdowns(): void {
    this.showPeriodDropdown   = false;
    this.showSlaDropdown      = false;
    this.showSeverityDropdown = false;
    this.showStatusDropdown   = false;
    this.showCategoryDropdown = false;
    this.showExportModal      = false;
  }

  togglePeriodDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showPeriodDropdown = !this.showPeriodDropdown;
    this.showSlaDropdown    = false;
  }

  toggleSlaDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showSlaDropdown      = !this.showSlaDropdown;
    this.showPeriodDropdown   = false;
    this.showSeverityDropdown = false;
    this.showStatusDropdown   = false;
    this.showCategoryDropdown = false;
  }

  toggleSeverityDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showSeverityDropdown = !this.showSeverityDropdown;
    this.showSlaDropdown = false; this.showPeriodDropdown = false;
    this.showStatusDropdown = false; this.showCategoryDropdown = false;
  }

  toggleStatusDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showStatusDropdown   = !this.showStatusDropdown;
    this.showSlaDropdown = false; this.showPeriodDropdown = false;
    this.showSeverityDropdown = false; this.showCategoryDropdown = false;
  }

  toggleCategoryDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showCategoryDropdown = !this.showCategoryDropdown;
    this.showSlaDropdown = false; this.showPeriodDropdown = false;
    this.showSeverityDropdown = false; this.showStatusDropdown = false;
  }

  selectSeverityFilter(opt: string): void  { this.selectedSeverity = opt; this.showSeverityDropdown = false; this.applyFilters(); }
  selectStatusFilter(opt: string): void    { this.selectedStatus   = opt; this.showStatusDropdown   = false; this.applyFilters(); }
  selectCategoryFilter(opt: string): void  { this.selectedCategory = opt; this.showCategoryDropdown = false; this.applyFilters(); }

  selectPeriod(period: string): void {
    this.selectedPeriod = period;
    this.showPeriodDropdown = false;
  }

  selectSla(sla: string): void {
    this.selectedSla = sla;
    this.showSlaDropdown = false;
    this.applyFilters();
  }

  setTab(tab: 'error-log' | 'validation-rules'): void {
    this.activeTab = tab;
  }

  showAddRuleModal = false;
  editingRuleId: string | null = null;
  viewingRuleId: string | null = null;
  private ruleViewReturnTab: 'error-log' | 'validation-rules' = 'validation-rules';
  /** Set when the page was opened from another page's reliability popup. */
  private returnUrl: string | null = null;

  goToAddRule(): void {
    this.editingRuleId = null;
    this.viewingRuleId = null;
    this.showAddRuleModal = true;
  }

  editRule(row: ValidationRuleRow): void {
    this.editingRuleId = row.ruleId;
    this.viewingRuleId = null;
    this.showAddRuleModal = true;
  }

  viewRule(row: ValidationRuleRow): void {
    this.openRuleView(row.ruleId);
  }

  private openRuleView(ruleId: string, returnTab: 'error-log' | 'validation-rules' = 'validation-rules'): void {
    this.ruleViewReturnTab = returnTab;
    this.viewingRuleId = ruleId;
    this.editingRuleId = ruleId;
    this.showAddRuleModal = true;
    this.cdr.detectChanges();
  }

  closeAddRuleModal(): void {
    this.showAddRuleModal = false;
    this.editingRuleId = null;
    this.viewingRuleId = null;
    this.activeTab = this.ruleViewReturnTab;
    this.ruleViewReturnTab = 'validation-rules';
    this.loadValidationRules();

    if (this.returnUrl) {
      const target = this.returnUrl;
      this.returnUrl = null;
      this.router.navigateByUrl(target);
    }
  }

  showTriggerConfirm = false;
  pendingTriggerRow: ValidationRuleRow | null = null;
  isTriggering = false;

  showDeleteConfirm = false;
  pendingDeleteRow: ValidationRuleRow | null = null;
  isDeleting = false;

  triggerRule(row: ValidationRuleRow): void {
    if (this.isTriggering) return;
    this.pendingTriggerRow = row;
    this.showTriggerConfirm = true;
  }

  cancelTrigger(): void {
    this.showTriggerConfirm = false;
    this.pendingTriggerRow = null;
  }

  confirmTrigger(): void {
    const row = this.pendingTriggerRow;
    this.showTriggerConfirm = false;
    this.pendingTriggerRow = null;
    if (!row) return;

    this.isTriggering = true;
    this.dataQualityService.executeRule(row.ruleId).subscribe({
      next: (res) => {
        this.isTriggering = false;
        const msg = res.data?.message ?? 'Rule executed.';
        row.triggeredOn = new Date().toISOString().slice(0, 16).replace('T', ' ');
        this.validationRulesRows = [...this.validationRulesRows];
        this.notify.showSuccess(msg);
        this.cdr.detectChanges();
        this.activeTab = 'error-log';
        this.loadErrorLogs();
        // Tells the navbar bell to poll right now instead of waiting for its 60s timer, so the
        // acting user sees their own trigger's notification without needing to refresh.
        this.notificationRefreshService.requestRefresh();
      },
      error: (err) => {
        this.isTriggering = false;
        this.notify.showError(err?.error?.message || 'Failed to execute rule.');
        this.cdr.detectChanges();
      },
    });
  }

  updateErrorStatus(row: ErrorLogRow, newStatus: string): void {
    this.recentlyChangedIds.add(row.errorId);
    this.dataQualityService.updateErrorStatus(row.errorId, newStatus).subscribe({
      next: () => { this.applyFilters(); this.cdr.detectChanges(); },
      error: () => { this.notify.showError('Failed to update status.'); this.loadErrorLogs(); },
    });
  }

  deleteRule(row: ValidationRuleRow): void {

    if (this.isDeleting) return;
    this.pendingDeleteRow = row;
    this.showDeleteConfirm = true;    
  }

  confirmDelete(): void {
    const row = this.pendingDeleteRow;
    this.showDeleteConfirm = false;
    this.pendingDeleteRow = null;
    if (!row) return;

    this.isDeleting = true;

    this.dataQualityService.deleteRule(row.ruleId).subscribe({
      next: () => {
        // Error logs are joined to rules, so both grids are refreshed from the server
        this.isDeleting = false;
        this.loadValidationRules();
        this.loadErrorLogs();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isDeleting = false;
        this.notify.showError('Failed to delete rule.');
        this.cdr.detectChanges();
      }
    });
  }

  cancelDelete(): void{
    this.showDeleteConfirm = false;
    this.pendingDeleteRow = null;
  }

  resetErrLogFilters(): void {
    this.errLogCountrySearch = '';
    this.errLogCategory      = '';
    this.errLogSeverity      = '';
    this.errLogStatus        = '';
  }

  resetValRuleFilters(): void {
    this.valRuleCountry   = '';
    this.valRuleSla       = '';
    this.valRuleCategory  = '';
    this.valRuleSeverity  = '';
    this.valRuleDateFrom  = '';
    this.valRuleDateTo    = '';
    this.valRuleStatus    = '';
  }
}

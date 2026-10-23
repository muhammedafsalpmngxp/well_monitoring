import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { ColDef, GridApi, ModuleRegistry, ClientSideRowModelModule, TextFilterModule, PaginationModule } from 'ag-grid-community';
import { WidgetService } from '../../../core/services/widget.service';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';
import type { AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { getViewDateRangeDefaults, replaceViewDateRangeParameters } from '../../../core/utils/view-date-parameters.util';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  globalSelectionPayload,
  hasGlobalSelection,
  matchesGlobalSelection,
  parseGlobalSelection,
  isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';

ModuleRegistry.registerModules([ClientSideRowModelModule, TextFilterModule, PaginationModule]);
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { AuthService } from '../../../core/services/auth.service';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-chart-drilldown',
  standalone: false,
  templateUrl: './chart-drilldown.component.html',
  styleUrls: ['./chart-drilldown.component.scss'],
})
export class ChartDrilldownComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly cancelGlobalFilter$ = new Subject<void>();
  private gridApi?: GridApi;

  chartTitle = '';
  chartId = 0;
  loading = true;
  error = '';
  isExpanded = false;

  columnDefs: ColDef[] = [];
  rowData: Record<string, unknown>[] = [];
  allRows: Record<string, unknown>[] = [];
  defaultColDef: ColDef = { sortable: true, filter: 'agTextColumnFilter', resizable: true, minWidth: 120, flex: 1, floatingFilter: true };

  /** Round numeric decimal values to 2 places for display/export; pass through other values as-is. */
  private formatCellValue(v: unknown): unknown {
    if (typeof v === 'number' && !Number.isInteger(v)) return Math.round((v + Number.EPSILON) * 100) / 100;
    return v;
  }

  filterFields = [
    { key: 'country', label: 'Country', options: [] as string[] },
    { key: 'sector', label: 'Sector', options: [] as string[] },
    { key: 'businessUnit', label: 'Business Unit', options: [] as string[] },
    { key: 'division', label: 'Division', options: [] as string[] },
    { key: 'cluster', label: 'Cluster', options: [] as string[] },
    { key: 'plant', label: 'Plant', options: [] as string[] },
  ];
  filterValues: Record<string, GlobalFilterSelection> = { country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All' };
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
  fromDate = '';
  toDate = '';
  quickRange = '';
  readonly quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After'];
  private allPlants: PlantFilterDto[] = [];
  private viewSql = '';
  private viewConnectionId = 0;
  private viewIdForPreview = 0;
  private hasDateParams = false;
  private readonly datePattern = /^\d{4}-\d{2}-\d{2}$/;
  private readonly safeValuePattern = /^[A-Za-z0-9\s\-_.,()]+$/;

  // Tab bar: "All Data" + optional filter value from chart click
  activeTab: 'all' | 'filtered' = 'all';
  filterParam = '';
  seriesParam = '';
  private chartXAxis = '';
  searchTerm = '';

  // Trend mode (weekly/monthly/quarterly/yearly) carried over from the chart's toggle
  private readonly allowedModes = new Set(['weekly', 'monthly', 'quarterly', 'yearly']);
  private drillMode = '';

  // Global date range and interactive (local) filter selections carried over from the chart view
  private inheritedFromDate = '';
  private inheritedToDate = '';
  private inheritedLocalFilters: { label: string; sourceColumn: string; value: string }[] = [];

  showExportModal = false;

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  // When the drilldown was opened from a dashboard board (rather than from the Charts & Tiles
  // chart view), these carry the originating board's context so the breadcrumb can point back
  // to that board instead of the Charts & Tiles trail.
  private boardFrom = '';
  private boardId = '';
  private boardTitle = '';

  get breadcrumbs() {
    if (this.boardId) {
      const boardLabel = this.boardFrom === 'standard' ? 'Standard Boards' : (this.isAdmin ? 'WIP Boards' : 'My Boards');
      const boardListRoute = this.boardFrom === 'standard' ? '/dashboard/standard-boards' : '/dashboard/wip-boards';
      return [
        { label: 'Dashboard', route: '/dashboard' },
        { label: boardLabel, route: boardListRoute },
        { label: this.boardTitle || 'Board', route: `/dashboard/operations-dashboard/${this.boardId}`, queryParams: { from: this.boardFrom || 'standard' } },
        { label: this.chartTitle },
        { label: 'Drill Down' },
      ];
    }
    const from = this.route.snapshot.queryParamMap.get('from') ?? 'wip';
    const isStandard = from === 'standard';
    const chartListLabel = isStandard ? 'Standard Charts' : (this.isAdmin ? 'WIP Charts' : 'My Charts');
    return [
      { label: 'Charts & Tiles', route: '/charts-tiles' },
      { label: chartListLabel, route: isStandard ? '/charts-tiles/standard-charts' : '/charts-tiles/wip-charts' },
      { label: this.chartTitle, route: `/charts-tiles/view/${this.chartId}`, queryParams: { from } },
      { label: 'Drill Down' },
    ];
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  /** Snap a date to the last Tuesday on or before it (ISO string). */
  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const diff = (d.getDay() + 5) % 7;
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  ngOnInit(): void {
    this.toDate = this.lastTuesday(new Date());
    this.loadGlobalFilters();
    this.chartId = Number(this.route.snapshot.paramMap.get('id'));
    this.filterParam = this.route.snapshot.queryParamMap.get('filter') ?? '';
    this.seriesParam = this.route.snapshot.queryParamMap.get('series') ?? '';
    const modeParam = this.route.snapshot.queryParamMap.get('mode') ?? '';
    if (this.allowedModes.has(modeParam)) this.drillMode = modeParam;
    if (this.filterParam) this.activeTab = 'filtered';
    this.boardFrom = this.route.snapshot.queryParamMap.get('boardFrom') ?? '';
    this.boardId = this.route.snapshot.queryParamMap.get('boardId') ?? '';
    this.boardTitle = this.route.snapshot.queryParamMap.get('boardTitle') ?? '';
    if (!this.chartId) { this.error = 'Invalid chart ID'; this.loading = false; return; }

    // Inherit the global filter selections, date range and local (interactive) filters the user
    // had active on the chart so the drilldown shows a consistent slice of data.
    for (const key of ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']) {
      const value = this.route.snapshot.queryParamMap.get(key);
      if (value) {
        try {
          this.filterValues[key] = parseGlobalSelection(value);
        } catch {
          this.error = 'Invalid global filter selection.';
          this.loading = false;
          return;
        }
      }
    }
    const fromParam = this.route.snapshot.queryParamMap.get('fromDate') ?? '';
    const toParam = this.route.snapshot.queryParamMap.get('toDate') ?? '';
    if (this.datePattern.test(fromParam)) this.inheritedFromDate = fromParam;
    if (this.datePattern.test(toParam)) this.inheritedToDate = toParam;
    const localFiltersParam = this.route.snapshot.queryParamMap.get('localFilters');
    if (localFiltersParam) {
      try { this.inheritedLocalFilters = JSON.parse(localFiltersParam); } catch { /* ignore malformed param */ }
    }

    this.widgetService.getWidgetById(this.chartId).pipe(
      takeUntil(this.destroy$),
      switchMap(widget => {
        this.chartTitle = widget.name;
        let design: any = {};
        try { design = JSON.parse(widget.designJson ?? '{}'); } catch { /* ignore */ }
        this.chartXAxis = typeof design.xAxis === 'string' ? design.xAxis : '';
        const viewId = design.drillDownViewId;
        if (!viewId) { this.error = 'No drill down view configured.'; this.loading = false; throw new Error('no view'); }
        return this.commonApi.getDatabaseViewById(viewId);
      }),
      switchMap(view => {
        this.viewSql = view.generatedSql;
        this.viewConnectionId = view.connectionId;
        this.viewIdForPreview = view.id;
        this.initDateParamsFromSql(view.generatedSql);
        if (this.inheritedFromDate) this.fromDate = this.inheritedFromDate;
        if (this.inheritedToDate) this.toDate = this.inheritedToDate;
        // 0 = no cap; drill-down grids must show the full result set (some views exceed 10k rows).
        return this.commonApi.previewView({
          connectionId: view.connectionId,
          sql: this.injectDateParams(view.generatedSql),
          viewId: view.id,
          maxRows: 0,
          filters: this.globalHierarchyFilterPayload(),
        });
      }),
    ).subscribe({
      next: (res) => {
        this.columnDefs = (res.columns ?? []).map(col => ({
          field: col,
          headerName: col,
          valueFormatter: (p: { value: unknown }) => {
            const v = this.formatCellValue(p.value);
            return v === null || v === undefined ? '' : String(v);
          },
        }));
        this.allRows = res.rows ?? [];
        this.applyFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (err?.message !== 'no view') this.error = 'Failed to load drill down data.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  onGridReady(params: any): void { this.gridApi = params.api; }

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    const index = this.filterFields.findIndex(field => field.key === name);
    if (index >= 0 && this.isGlobalFilterLocked(index)) return;
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  selectFilterOption(name: string, value: string): void {
    if (name === 'quickRange') {
      this.quickRange = value;
      this.applyQuickRange(value);
      this.onDateChange();
    } else {
      const fieldIndex = this.filterFields.findIndex(field => field.key === name);
      if (this.isGlobalFilterLocked(fieldIndex)) return;
      this.filterValues[name] = value === 'All'
        ? 'All'
        : toggleGlobalSelection(this.filterValues[name] ?? 'All', value, this.filterFields.find(field => field.key === name)?.options, this.globalFilterClear.consume(name));
      const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
      const index = hierarchy.indexOf(name);
      for (let i = index + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
      this.rebuildGlobalFilterOptions();
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

  onDateChange(): void {
    if (!this.hasDateParams || !this.viewSql || !this.viewConnectionId) return;
    if ((!this.fromDate || this.datePattern.test(this.fromDate)) && (!this.toDate || this.datePattern.test(this.toDate)) && (this.fromDate || this.toDate)) this.applyGlobalFilter();
  }

  private applyQuickRange(range: string): void {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    switch (range) {
      case 'Today': this.fromDate = iso(today); this.toDate = iso(today); break;
      case 'Till Last Tuesday': {
        const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 5) % 7));
        this.fromDate = iso(new Date(today.getFullYear(), 0, 1)); this.toDate = iso(d); break;
      }
      case 'This Week': { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); this.fromDate = iso(d); this.toDate = iso(today); break; }
      case 'This Month': this.fromDate = iso(new Date(today.getFullYear(), today.getMonth(), 1)); this.toDate = iso(today); break;
      case 'Last Month': this.fromDate = iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)); this.toDate = iso(new Date(today.getFullYear(), today.getMonth(), 0)); break;
      case 'This Quarter': { const q = Math.floor(today.getMonth() / 3) * 3; this.fromDate = iso(new Date(today.getFullYear(), q, 1)); this.toDate = iso(today); break; }
      case 'This Year': this.fromDate = iso(new Date(today.getFullYear(), 0, 1)); this.toDate = iso(today); break;
      case 'After': this.toDate = ''; break;
    }
  }

  private loadGlobalFilters(): void {
    this.commonApi.getPlantFilters().pipe(catchError(() => of([])), takeUntil(this.destroy$)).subscribe(plants => {
      this.allPlants = plants;
      this.filterFields[0].options = this.distinctPlant(plants, plant => plant.country);
      this.autoSelectSingleOptions();
      this.rebuildGlobalFilterOptions();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingleOptions(): void {
    const active = (value: GlobalFilterSelection) => hasGlobalSelection(value);
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const selectors: ((plant: PlantFilterDto) => string)[] = [
      plant => plant.country,
      plant => plant.sector,
      plant => plant.businessUnit,
      plant => plant.division,
      plant => plant.cluster,
      plant => plant.plantDescription,
    ];

    if (this.filterFields[0].options.length === 1) this.filterValues['country'] = this.filterFields[0].options[0];
    let plants = this.allPlants;
    for (let index = 0; index < keys.length - 1; index++) {
      if (active(this.filterValues[keys[index]])) plants = plants.filter(plant => matchesGlobalSelection(selectors[index](plant), this.filterValues[keys[index]]));
      const options = this.distinctPlant(plants, selectors[index + 1]);
      this.filterFields[index + 1].options = active(this.filterValues[keys[index]]) ? options : [];
      if (options.length === 1 && active(this.filterValues[keys[index]])) this.filterValues[keys[index + 1]] = options[0];
    }
  }

  private rebuildGlobalFilterOptions(): void {
    const active = (value: GlobalFilterSelection) => hasGlobalSelection(value);
    let plants = this.allPlants;
    if (active(this.filterValues['country'])) plants = plants.filter(plant => matchesGlobalSelection(plant.country, this.filterValues['country']));
    this.filterFields[1].options = active(this.filterValues['country']) ? this.distinctPlant(plants, plant => plant.sector) : [];
    // A country with a single sector/business unit/division should cascade automatically, otherwise cluster never gets populated.
    if (!active(this.filterValues['sector']) && this.filterFields[1].options.length === 1) this.filterValues['sector'] = this.filterFields[1].options[0];
    if (active(this.filterValues['sector'])) plants = plants.filter(plant => matchesGlobalSelection(plant.sector, this.filterValues['sector']));
    this.filterFields[2].options = active(this.filterValues['sector']) ? this.distinctPlant(plants, plant => plant.businessUnit) : [];
    if (!active(this.filterValues['businessUnit']) && this.filterFields[2].options.length === 1) this.filterValues['businessUnit'] = this.filterFields[2].options[0];
    if (active(this.filterValues['businessUnit'])) plants = plants.filter(plant => matchesGlobalSelection(plant.businessUnit, this.filterValues['businessUnit']));
    this.filterFields[3].options = active(this.filterValues['businessUnit']) ? this.distinctPlant(plants, plant => plant.division) : [];
    if (!active(this.filterValues['division']) && this.filterFields[3].options.length === 1) this.filterValues['division'] = this.filterFields[3].options[0];
    if (active(this.filterValues['division'])) plants = plants.filter(plant => matchesGlobalSelection(plant.division, this.filterValues['division']));
    this.filterFields[4].options = active(this.filterValues['division']) ? this.distinctPlant(plants, plant => plant.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving 'All' displayed.
    if (!active(this.filterValues['cluster']) && this.filterFields[4].options.length === 1) this.filterValues['cluster'] = this.filterFields[4].options[0];
    if (active(this.filterValues['cluster'])) plants = plants.filter(plant => matchesGlobalSelection(plant.cluster, this.filterValues['cluster']));
    this.filterFields[5].options = this.distinctPlant(plants, plant => plant.plantDescription);
    if (!active(this.filterValues['plant']) && this.filterFields[5].options.length === 1) this.filterValues['plant'] = this.filterFields[5].options[0];
  }

  private distinctPlant(plants: PlantFilterDto[], selector: (plant: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  private advancedFilters: ReturnType<typeof advancedHierarchyFilters> = [];

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    if (this.viewIdForPreview) this.applyGlobalFilter();
  }

  private globalHierarchyFilterPayload(): ReturnType<typeof advancedHierarchyFilters> {
    const columns: Record<string, string> = {
      country: 'country', sector: 'sector', businessUnit: 'business_unit', division: 'division',
      cluster: 'cluster', plant: 'plant_description',
    };
    return [...Object.entries(columns)
      .filter(([key]) => hasGlobalSelection(this.filterValues[key]))
      .map(([key, column]) => ({
        sourceTable: column,
        sourceColumn: column,
        ...globalSelectionPayload(this.filterValues[key]),
        label: column,
      })), ...(this.advancedFilters ?? [])];
  }

  private initDateParamsFromSql(sql: string): void {
    const defaults = getViewDateRangeDefaults(sql);
    this.hasDateParams = defaults.hasStartDate || defaults.hasEndDate || defaults.hasFutureDate;
    if (defaults.hasFutureDate) {
      if (defaults.fromDate) this.fromDate = defaults.fromDate;
      this.toDate = defaults.toDate ?? this.lastTuesday(new Date());
      return;
    }

    const start = /DECLARE\s+@start_date\s+\w+\s*=\s*'(\d{4}-\d{2}-\d{2})'/i.exec(sql);
    if (start) this.fromDate = start[1];
    // "To" always defaults to Till Last Tuesday of today — never inherited from a widget's
    // hardcoded/test literal end date, which would otherwise leave a stale date on open.
    this.toDate = this.lastTuesday(new Date());
  }

  private injectDateParams(sql: string): string {
    sql = replaceViewDateRangeParameters(sql, this.fromDate, this.toDate);
    if (this.drillMode) {
      sql = sql.replace(new RegExp(`DECLARE\\s+@mode\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i'), `DECLARE @mode $1 = '${this.drillMode}';`);
    }
    for (const name of ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']) {
      const value = this.filterValues[name];
      if (typeof value === 'string' && value && value !== 'All' && this.safeValuePattern.test(value)) {
        sql = sql.replace(new RegExp(`DECLARE\\s+@${name}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i'), `DECLARE @${name} $1 = '${value}';`);
      }
    }
    // Local (interactive) filters inherited from the chart view: override whichever DECLARE
    // placeholder matches the filter's label/column, trying a snake_case normalization too
    // (e.g. "Terrain Type" -> "Terrain_Type") since placeholders are typically snake_case.
    for (const filter of this.inheritedLocalFilters) {
      if (!filter.value || !this.safeValuePattern.test(filter.value)) continue;
      const candidates = [filter.label, filter.sourceColumn]
        .filter(Boolean)
        .flatMap(name => [name, name.trim().replace(/[\s-]+/g, '_')])
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      for (const candidate of candidates) {
        const declaration = new RegExp(`DECLARE\\s+@(${candidate})\\b[^=;\\r\\n]*=\\s*[^;\\r\\n]+;?`, 'i');
        const match = declaration.exec(sql);
        if (!match) continue;
        sql = sql.replace(declaration, `DECLARE @${match[1]} VARCHAR(200) = '${filter.value}';`);
        break;
      }
    }
    return sql;
  }

  private applyGlobalFilter(): void {
    this.cancelGlobalFilter$.next();
    this.loading = true;
    // 0 = no cap; keep consistent with the initial load so filtered totals aren't truncated.
    this.commonApi.previewView({
      connectionId: this.viewConnectionId,
      sql: this.injectDateParams(this.viewSql),
      viewId: this.viewIdForPreview,
      maxRows: 0,
      filters: this.globalHierarchyFilterPayload(),
    }).pipe(
      takeUntil(this.cancelGlobalFilter$), takeUntil(this.destroy$),
    ).subscribe({
      next: res => { this.allRows = res.rows ?? []; this.columnDefs = (res.columns ?? []).map(field => ({ field, headerName: field, valueFormatter: p => String(this.formatCellValue(p.value) ?? '') })); this.applyFilters(); this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.error = 'Failed to reload data with the selected filters.'; this.cdr.markForCheck(); },
    });
  }

  setTab(tab: 'all' | 'filtered'): void {
    this.activeTab = tab;
    this.applyFilters();
  }

  onSearchChange(): void { this.gridApi?.setGridOption('quickFilterText', this.searchTerm); }

  applyFilters(): void {
    let rows = [...this.allRows];
    // Tab filter: if filtered tab active, only show rows matching the x-axis value
    if (this.activeTab === 'filtered' && this.filterParam) {
      const xCol = this.columnDefs.find(column =>
        column.field?.toLowerCase() === this.chartXAxis.toLowerCase(),
      )?.field ?? this.columnDefs[0]?.field;
      if (xCol) rows = rows.filter(r => String(r[xCol] ?? '') === this.filterParam);
      // Series (line) filter: narrow to the clicked line's metric, matched against whichever
      // column carries it. Skipped when the series name maps to no column value, so a naming
      // mismatch never empties the grid (falls back to the date-only view).
      if (this.seriesParam) {
        const target = this.normalizeSeries(this.seriesParam);
        const seriesCol = this.columnDefs
          .map(c => c.field)
          .find(f => !!f && f.toLowerCase() !== this.chartXAxis.toLowerCase()
            && this.allRows.some(r => this.normalizeSeries(String(r[f!] ?? '')) === target));
        if (seriesCol) rows = rows.filter(r => this.normalizeSeries(String(r[seriesCol] ?? '')) === target);
      }
    }
    this.rowData = rows;
  }

  /** Loose match so a chart series name (e.g. "Plan_Due_Well") lines up with the drill-down
   * column value (e.g. "Plan - Due Well"): lowercased, spaces/underscores/hyphens removed. */
  private normalizeSeries(s: string): string {
    return s.trim().toLowerCase().replace(/[\s_-]/g, '');
  }

  toggleExpand(): void { this.isExpanded = !this.isExpanded; }

  toggleExportModal(): void { this.showExportModal = !this.showExportModal; }

  exportAs(format: string): void {
    this.showExportModal = false;
    this.cdr.detectChanges();
    setTimeout(() => {
      switch (format) {
        case 'pdf': this.exportPdf(); break;
        case 'png': this.exportPng(); break;
        case 'csv': this.gridApi?.exportDataAsCsv({ fileName: `${this.chartTitle}_drilldown.csv`, processCellCallback: (p) => { const v = String(p.value ?? ''); return /^[=+@-]/.test(v) ? `'${v}` : v; } }); break;
        case 'xlsx': this.exportXlsx(); break;
      }
    }, 100);
  }

  private hideFilterRows(el: HTMLElement): HTMLElement[] {
    const rows = Array.from(el.querySelectorAll('[class*="floating-filter"], [ref="eFloatingFilter"], .ag-floating-filter-body, .ag-header-row-floating-filter')) as HTMLElement[];
    rows.forEach(r => r.style.display = 'none');
    return rows;
  }

  private exportPdf(): void {
    const headers = this.columnDefs.map(c => c.headerName ?? c.field ?? '');
    const fields = this.columnDefs.map(c => c.field ?? '');
    const dataRows = this.rowData.map(r => fields.map(f => String(this.formatCellValue(r[f]) ?? '')));
    if (!headers.length) return;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pdfW = 297;
    const pageH = 200;
    const colW = Math.min((pdfW - 20) / headers.length, 40);
    const rowH = 7;
    const headerH = 8;
    const fontSize = Math.min(8, 60 / headers.length);

    pdf.setFontSize(14);
    pdf.setTextColor(33, 64, 154);
    pdf.text(this.chartTitle, 10, 12);
    pdf.setFontSize(10);
    pdf.setTextColor(102, 112, 133);
    pdf.text(`Drill Down View \u00B7 ${this.rowData.length} rows`, 10, 18);
    let y = 24;

    const drawHeader = () => {
      pdf.setFillColor(41, 72, 163);
      pdf.rect(10, y, pdfW - 20, headerH, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(fontSize);
      headers.forEach((h, i) => pdf.text(h.substring(0, 20), 12 + i * colW, y + 5.5));
      y += headerH;
    };

    drawHeader();
    pdf.setFontSize(fontSize);
    dataRows.forEach((row, ri) => {
      if (y + rowH > pageH) {
        pdf.addPage();
        y = 10;
        drawHeader();
        pdf.setFontSize(fontSize);
      }
      pdf.setTextColor(51, 51, 51);
      if (ri % 2 === 0) { pdf.setFillColor(248, 250, 255); pdf.rect(10, y, pdfW - 20, rowH, 'F'); }
      row.forEach((cell, ci) => pdf.text(String(cell).substring(0, 25), 12 + ci * colW, y + 5));
      y += rowH;
    });

    pdf.save(`${this.chartTitle}_drilldown.pdf`);
  }

  private exportPng(): void {
    const el = document.querySelector('.drilldown-page__card') as HTMLElement;
    if (!el) return;
    const hidden = this.hideFilterRows(el);
    const restore = () => hidden.forEach(r => r.style.display = '');
    html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then((canvas: HTMLCanvasElement) => {
      restore();
      const link = document.createElement('a');
      link.download = `${this.chartTitle}_drilldown.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }).catch(() => restore());
  }

  private exportXlsx(): void {
    const headers = this.columnDefs.map(c => c.headerName ?? c.field ?? '');
    const fields = this.columnDefs.map(c => c.field ?? '');
    const rows = this.rowData.map(r => fields.map(f => this.formatCellValue(r[f]) ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drill Down');
    XLSX.writeFile(wb, `${this.chartTitle}_drilldown.xlsx`);
  }

  @HostListener('document:click')
  onDocumentClick(): void { this.openFilterName = null; this.showExportModal = false; }

  ngOnDestroy(): void { this.cancelGlobalFilter$.next(); this.destroy$.next(); this.destroy$.complete(); }
}

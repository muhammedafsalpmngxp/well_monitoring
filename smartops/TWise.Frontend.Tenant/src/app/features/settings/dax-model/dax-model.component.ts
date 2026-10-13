import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, inject, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ClientSideRowModelModule, ColDef, ModuleRegistry, RowSelectionModule, RowSelectionOptions, SelectionChangedEvent, SelectionColumnDef, themeQuartz, ValueFormatterParams } from 'ag-grid-community';
import { Breadcrumb } from '../../../core/models/breadcrumb.model';
import { DaxModelSaveRequest, DaxModelService, SavedDaxModelDto } from '../../../core/services/dax-model.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DaxSourceTypeCellRendererComponent } from './cell-renderers/dax-source-type-cell-renderer.component';
import { DaxColumnsCellRendererComponent } from './cell-renderers/dax-columns-cell-renderer.component';
import { DaxActionsCellRendererComponent } from './cell-renderers/dax-actions-cell-renderer.component';
import { DaxUsedInCellRendererComponent } from './cell-renderers/dax-used-in-cell-renderer.component';
import { PermissionService } from '../../../core/services/permission.service';
import { DAX_FUNCTION_SNIPPETS, buildDaxOperationExpression, getDaxReferencedColumns, restoreDaxOperation, validateDaxExpression } from '../../../core/utils/dax-evaluator.util';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

const gridTheme = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#dfe6e9',
  borderRadius: 8,
  checkboxBorderRadius: 4,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#344054',
  headerFontWeight: 700,
  rowHoverColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

const rowSelection: RowSelectionOptions = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
};

const selectionColumnDef: SelectionColumnDef = {
  pinned: 'left',
  width: 48,
  maxWidth: 48,
  minWidth: 48,
  suppressHeaderMenuButton: true,
  suppressMovable: true,
};

export type DaxModelSourceType = 'Table' | 'View';
export type DaxModelStatus = 'Active' | 'Draft';

export interface DaxModelRow {
  id: string;
  name: string;
  sourceType: DaxModelSourceType;
  dataSource: string;
  calculatedBy: 'Column' | 'Row';
  operation: string;
  columns: string[];
  expression: string;
  usedIn: string;
  createdBy: string;
  createdDate: string;
  status: DaxModelStatus;
}

function toRow(m: SavedDaxModelDto): DaxModelRow {
  // The API sends UTC; a timestamp without an offset is read as UTC, not local time.
  const created = new Date(/(Z|[+-]\d\d:\d\d)$/i.test(m.createdAt) ? m.createdAt : m.createdAt + 'Z');
  return {
    id: String(m.id),
    name: m.name,
    sourceType: m.sourceType,
    dataSource: m.dataSource,
    calculatedBy: m.calculatedBy,
    operation: m.operation ?? '',
    columns: m.columns,
    expression: m.expression,
    usedIn: `${m.usedInCharts} ${m.usedInCharts === 1 ? 'Chart' : 'Charts'}`,
    createdBy: m.createdByName ?? '',
    createdDate: created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', '
      + created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    status: m.status,
  };
}

@Component({
  selector: 'app-dax-model',
  standalone: false,
  templateUrl: './dax-model.component.html',
  styleUrls: ['./dax-model.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaxModelComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canCreate(): boolean {
    return this.permissions.canView('settings.dax-model') && this.permissions.canCreate('settings.dax-model');
  }

  get canModify(): boolean {
    return this.permissions.canView('settings.dax-model') && this.permissions.canModify('settings.dax-model');
  }

  get canBuildChart(): boolean {
    return this.permissions.canView('charts.wip-charts') && this.permissions.canCreate('charts.wip-charts');
  }

  readonly gridTheme = gridTheme;
  readonly rowSelection = rowSelection;
  readonly selectionColumnDef = selectionColumnDef;

  readonly defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
    flex: 1,
  };

  readonly columnDefs: ColDef<DaxModelRow>[] = [
    // Serial number continues across server pages (page 2 of 10 rows starts at 11).
    {
      headerName: 'S.No', colId: 'serialNo', pinned: 'left', lockPinned: true, width: 80, minWidth: 80, maxWidth: 90, sortable: false, filter: false,
      suppressHeaderMenuButton: true,
      valueGetter: p => (this.currentPage - 1) * this.pageSize + (p.node?.rowIndex ?? 0) + 1,
    },
    // Checkbox, S.No and DAX Model stay frozen on the left while the other columns scroll (like Excel's Freeze Panes).
    { headerName: 'DAX Model', field: 'name', minWidth: 300, pinned: 'left', lockPinned: true },
    { headerName: 'Source Type', field: 'sourceType', cellRenderer: DaxSourceTypeCellRendererComponent, minWidth: 200 },
    { headerName: 'Data Source', field: 'dataSource', minWidth: 320, tooltipField: 'dataSource' },
    { headerName: 'Calculated By', field: 'calculatedBy', minWidth: 200 },
    { headerName: 'Operation', field: 'operation', minWidth: 150 },
    // columns is an array: without a formatter AG Grid infers an 'object' type and warns (#48).
    // The formatter is the text used by filter/copy/export; the renderer still gets the array for its chips.
    {
      headerName: 'Columns', field: 'columns', cellRenderer: DaxColumnsCellRendererComponent, minWidth: 320, sortable: false,
      valueFormatter: (p: ValueFormatterParams<DaxModelRow, string[]>) => (p.value ?? []).join(', '),
    },
    { headerName: 'Expression', field: 'expression', minWidth: 340, cellClass: 'dax-model-table__expression' },
    { headerName: 'Used In', field: 'usedIn', cellRenderer: DaxUsedInCellRendererComponent, minWidth: 210 },
    // Only admins see every user's models, so only they get the creator column.
    ...(this.permissions.isAdminUser ? [{ headerName: 'Created By', field: 'createdBy', minWidth: 200 } as ColDef<DaxModelRow>] : []),
    { headerName: 'Created Date', field: 'createdDate', minWidth: 260 },
    { headerName: 'Actions', sortable: false, filter: false, cellRenderer: DaxActionsCellRendererComponent, minWidth: 110, maxWidth: 110 },
  ];

  get gridContext() {
    return {
      canModify: () => this.canModify,
      onEditRow: (row: DaxModelRow) => this.editRow(row),
      onDeleteRow: (row: DaxModelRow) => this.deleteRow(row),
    };
  }

  readonly breadcrumbs: Breadcrumb[] = [
    { label: 'Home' },
    { label: 'Settings', route: '/settings' },
    { label: 'Dax Model' },
  ];

  searchTerm = '';
  readonly statusOptions = ['All Status', 'Active', 'Draft'];
  statusFilter = 'All Status';
  readonly timeOptions = ['All Time', 'Last 7 Days', 'Last 30 Days'];
  timeFilter = 'All Time';
  openFilterName: 'status' | 'time' | null = null;

  /** Current page from core.DaxModels (GET /api/dax-models); filters and paging run on the server. */
  rows: DaxModelRow[] = [];
  loading = false;
  loadError = '';
  totalRecords = 0;
  totalModelsCount = 0;
  fromTablesCount = 0;
  fromViewsCount = 0;
  readonly pageSizeOptions = [10, 20, 40, 50];
  pageSize = 20;
  currentPage = 1;
  private searchTimer?: ReturnType<typeof setTimeout>;
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalRecords / this.pageSize)); }
  get rangeStart(): number { return this.rows.length ? (this.currentPage - 1) * this.pageSize + 1 : 0; }
  get rangeEnd(): number { return (this.currentPage - 1) * this.pageSize + this.rows.length; }

  // --- "Create / Edit DAX Model" modal: saves through POST / PUT /api/dax-models ---
  showCreateModal = false;
  /** Id of the model being edited; null while creating. */
  editingModelId: number | null = null;
  get isEditing(): boolean { return this.editingModelId !== null; }
  saving = false;
  saveError = '';
  createSourceType: DaxModelSourceType = 'Table';
  /** Real tables and views from the BI connection, loaded when the dialog opens. */
  private sourceOptionsByType: Record<DaxModelSourceType, string[]> = { Table: [], View: [] };
  get createDataSourceOptions(): string[] {
    const options = this.sourceOptionsByType[this.createSourceType];
    // A model saved against a source that is no longer listed still shows its own source.
    return this.createDataSource && !options.includes(this.createDataSource) ? [this.createDataSource, ...options] : options;
  }
  /** Typed text that filters the Data Source list (DFCT0010722). */
  dataSourceSearch = '';
  get filteredDataSourceOptions(): string[] {
    const term = this.dataSourceSearch.trim().toLowerCase();
    return term ? this.createDataSourceOptions.filter(ds => ds.toLowerCase().includes(term)) : this.createDataSourceOptions;
  }
  /** Focuses the search box as soon as the Data Source panel opens. */
  @ViewChild('dataSourceSearchInput') set dataSourceSearchInput(input: ElementRef<HTMLInputElement> | undefined) {
    input?.nativeElement.focus();
  }
  createDataSource = '';
  createModelName = '';
  readonly createCalculateByOptions: Array<'Column' | 'Row'> = ['Column', 'Row'];
  createCalculateBy: 'Column' | 'Row' | '' = '';
  readonly createOperationOptions = [...DAX_FUNCTION_SNIPPETS];
  createOperation = '';
  /** Columns of the chosen data source (plus the saved column while editing). */
  private sourceColumns: string[] = [];
  get createColumnOptions(): string[] {
    return [...new Set([...this.sourceColumns, ...this.createColumns])];
  }
  createColumns: string[] = [];
  createExpression = '';
  openCreateDropdown: 'dataSource' | 'calculateBy' | 'operation' | 'column' | null = null;

  get canSubmitCreateModel(): boolean {
    // Editing needs modify permission, creating needs create permission (dev's permission checks).
    return (this.isEditing ? this.canModify : this.canCreate) && !this.saving
      && !!(this.createModelName.trim() && this.createDataSource && this.createCalculateBy
      && this.createOperation && this.createExpression.trim());
  }

  openCreateModal(): void {
    if (!this.canCreate) return;
    this.editingModelId = null;
    this.createSourceType = 'Table';
    this.createDataSource = '';
    this.createModelName = '';
    this.createCalculateBy = '';
    this.createOperation = '';
    this.createColumns = [];
    this.createExpression = '';
    this.sourceColumns = [];
    this.openDialog();
  }

  /** Same dialog as Create, pre-filled with the saved model; Save Model updates it in place. */
  openEditModal(row: DaxModelRow): void {
    this.editingModelId = Number(row.id);
    this.createSourceType = row.sourceType;
    this.createDataSource = row.dataSource;
    this.createModelName = row.name;
    this.createCalculateBy = row.calculatedBy;
    this.createOperation = restoreDaxOperation(row.operation, row.expression);
    this.createColumns = [...row.columns];
    this.createExpression = row.expression;
    this.sourceColumns = [];
    this.openDialog();
    this.loadSourceColumns();
  }

  private openDialog(): void {
    this.saveError = '';
    this.saving = false;
    this.openCreateDropdown = null;
    this.showCreateModal = true;
    // The grid's Edit button reaches here through the cell renderer's context callback, outside
    // this OnPush component's own template events, so the dialog must be scheduled explicitly.
    this.cdr.markForCheck();
    this.loadSourceOptions();
  }

  /** Saved database views by name, for their ids (columns come from the view's stored preview). */
  private viewIdsByName = new Map<string, number>();

  private loadSourceOptions(): void {
    // Tables come from the BI connection; views are the saved database views, as in the Chart Builder.
    this.commonApi.getBISources().subscribe({
      next: sources => {
        this.sourceOptionsByType = { ...this.sourceOptionsByType, Table: sources.map(s => s.name) };
        this.cdr.markForCheck();
      },
      error: () => { /* the dialog still works with the saved source */ },
    });
    this.commonApi.getDatabaseViews('view').subscribe({
      next: views => {
        this.viewIdsByName = new Map(views.map(v => [v.viewName, v.id]));
        this.sourceOptionsByType = { ...this.sourceOptionsByType, View: views.map(v => v.viewName) };
        if (this.createSourceType === 'View' && this.createDataSource && !this.sourceColumns.length) this.loadSourceColumns();
        this.cdr.markForCheck();
      },
      error: () => { /* same */ },
    });
  }

  private loadSourceColumns(): void {
    if (!this.createDataSource) { this.sourceColumns = []; return; }
    const source = this.createDataSource;
    const sourceType = this.createSourceType;
    const apply = (columns: string[]) => {
      if (source !== this.createDataSource || sourceType !== this.createSourceType) return;
      this.sourceColumns = columns;
      this.cdr.markForCheck();
    };
    if (this.createSourceType === 'View') {
      // A view's columns are the ones its last preview produced; running its SQL here would be
      // far too slow for a picker (some views take seconds).
      const viewId = this.viewIdsByName.get(source);
      if (!viewId) return;
      this.commonApi.getDatabaseViewById(viewId).subscribe({
        next: view => {
          let columns: string[] = [];
          try { columns = JSON.parse(view.previewColumnsJson ?? '[]'); } catch { /* fall through */ }
          const names = Array.isArray(columns) ? columns.map(c => typeof c === 'string' ? c : String((c as { name?: string })?.name ?? '')).filter(Boolean) : [];
          if (names.length) { apply(names); return; }
          // Never previewed: run the view once through the chart-data endpoint for its columns.
          this.widgetService.getFilteredChartData({ chartSource: source, chartSourceType: 'View', viewId, filters: [] })
            .subscribe({ next: data => apply(data.columns ?? []), error: () => { /* keep the saved column */ } });
        },
        error: () => { /* keep the saved column selectable */ },
      });
      return;
    }
    this.commonApi.getTableData(source, 'Table').subscribe({
      next: data => apply(data.columns ?? []),
      error: () => { /* keep the saved column selectable */ },
    });
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.editingModelId = null;
    this.openCreateDropdown = null;
  }

  selectCreateSourceType(type: DaxModelSourceType): void {
    this.createSourceType = type;
    this.createDataSource = '';
    this.createColumns = [];
    this.sourceColumns = [];
  }

  toggleCreateDropdown(name: 'dataSource' | 'calculateBy' | 'operation' | 'column', event: Event): void {
    event.stopPropagation();
    this.openCreateDropdown = this.openCreateDropdown === name ? null : name;
    this.dataSourceSearch = '';
  }

  /** Enter in the Data Source search picks the first match. */
  selectFirstDataSource(event: Event): void {
    const first = this.filteredDataSourceOptions[0];
    if (first) this.selectCreateDataSource(first, event);
  }

  selectCreateDataSource(value: string, event: Event): void {
    event.stopPropagation();
    this.createDataSource = value;
    this.createColumns = [];
    this.sourceColumns = [];
    this.openCreateDropdown = null;
    this.dataSourceSearch = '';
    this.loadSourceColumns();
  }

  selectCreateCalculateBy(value: 'Column' | 'Row', event: Event): void {
    event.stopPropagation();
    this.createCalculateBy = value;
    this.openCreateDropdown = null;
  }

  selectCreateOperation(value: string, event: Event): void {
    event.stopPropagation();
    this.createOperation = value;
    this.openCreateDropdown = null;
    this.updateCreateExpression();
  }

  selectCreateColumn(value: string, event: Event): void {
    event.stopPropagation();
    this.createColumns = this.createColumns.includes(value)
      ? this.createColumns.filter(column => column !== value) : [...this.createColumns, value];
    this.updateCreateExpression();
  }

  private updateCreateExpression(): void {
    if (this.createOperation) {
      this.createExpression = buildDaxOperationExpression(this.createOperation, this.createColumns, this.createCalculateBy === 'Row' ? 'row' : 'column');
    }
  }

  submitCreateModel(): void {
    if (!this.canSubmitCreateModel) return;
    const expression = this.createExpression.trim();
    const columns = getDaxReferencedColumns({ id: 'draft', name: this.createModelName, expression });
    if (columns.length && !this.sourceColumns.length) {
      this.saveError = 'Data source columns are not available yet. Select the source again and retry.';
      return;
    }
    this.saveError = validateDaxExpression(expression, this.sourceColumns, this.createCalculateBy === 'Row' ? 'row' : 'column');
    if (this.saveError) return;
    const body: DaxModelSaveRequest = {
      name: this.createModelName.trim(),
      sourceType: this.createSourceType,
      dataSource: this.createDataSource,
      calculatedBy: this.createCalculateBy as 'Column' | 'Row',
      operation: this.createOperation.split('(')[0].trim(),
      columns,
      expression,
    };
    const request$ = this.isEditing ? this.daxModels.update(this.editingModelId!, body) : this.daxModels.create(body);
    this.saving = true;
    this.saveError = '';
    request$.subscribe({
      next: () => {
        this.saving = false;
        this.closeCreateModal();
        this.loadModels();
      },
      error: () => {
        this.saving = false;
        this.saveError = this.isEditing ? 'Could not save the changes. Try again.' : 'Could not create the model. Try again.';
        this.cdr.markForCheck();
      },
    });
  }

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
    private readonly daxModels: DaxModelService,
    private readonly commonApi: CommonApiService,
    private readonly widgetService: WidgetService,
  ) {}

  ngOnInit(): void {
    this.loadModels();
  }

  loadModels(): void {
    this.loading = true;
    this.loadError = '';
    const days = this.timeFilter === 'Last 7 Days' ? 7 : this.timeFilter === 'Last 30 Days' ? 30 : undefined;
    this.daxModels.list({
      search: this.searchTerm.trim() || undefined,
      status: this.statusFilter === 'All Status' ? undefined : this.statusFilter as 'Active' | 'Draft',
      sinceDays: days,
      page: this.currentPage,
      pageSize: this.pageSize,
    }).subscribe({
      next: page => {
        this.rows = page.items.map(toRow);
        this.totalRecords = page.total;
        this.totalModelsCount = page.totalModels;
        this.fromTablesCount = page.fromTables;
        this.fromViewsCount = page.fromViews;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.rows = [];
        this.loadError = 'Could not load saved DAX models. Try again.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm = term;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.currentPage = 1; this.loadModels(); }, 300);
  }

  openChartBuilder(): void {
    if (!this.canBuildChart) return;
    this.router.navigate(['/charts-tiles/builder']);
  }


  private selectedRows: DaxModelRow[] = [];
  get selectedCount(): number { return this.selectedRows.length; }

  onSelectionChanged(event: SelectionChangedEvent<DaxModelRow>): void {
    this.selectedRows = event.api.getSelectedRows();
    this.cdr.markForCheck();
  }

  editRow(row: DaxModelRow): void {
    if (!this.canModify) return;
    this.openEditModal(row);
  }

  // --- Delete (row bin icon or "Delete selected"): confirm, delete on the server, reload the page of models ---
  deleteTargets: DaxModelRow[] = [];
  deleteBusy = false;
  deleteError: string | null = null;
  deleteSuccess = '';

  get deleteConfirmMessage(): string {
    return this.deleteTargets.length === 1
      ? 'Are you sure you want to delete this DAX model? This action cannot be undone.'
      : `Are you sure you want to delete these ${this.deleteTargets.length} DAX models? This action cannot be undone.`;
  }

  get deleteTargetNames(): string {
    return this.deleteTargets.map(row => row.name).join(', ');
  }

  deleteRow(row: DaxModelRow): void {
    if (!this.canModify) return;
    this.openDeleteConfirm([row]);
  }

  deleteSelected(): void {
    if (!this.canModify || !this.selectedRows.length) return;
    this.openDeleteConfirm([...this.selectedRows]);
  }

  private openDeleteConfirm(rows: DaxModelRow[]): void {
    this.deleteTargets = rows;
    this.deleteError = null;
    this.deleteSuccess = '';
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    if (this.deleteBusy) return;
    this.deleteTargets = [];
    this.deleteError = null;
    this.cdr.markForCheck();
  }

  /** Deletes each target; a model a chart still uses is kept and its reason shown in the dialog. */
  confirmDelete(): void {
    if (!this.canModify || !this.deleteTargets.length || this.deleteBusy) return;
    this.deleteBusy = true;
    this.deleteError = null;
    const requests = this.deleteTargets.map(row => this.daxModels.delete(Number(row.id)).pipe(
      map(() => ''),
      catchError(err => of(err?.error?.message ?? `"${row.name}" could not be deleted.`)),
    ));
    forkJoin(requests).subscribe(errors => {
      const failed = errors.filter(Boolean);
      const deleted = errors.length - failed.length;
      this.deleteBusy = false;
      if (deleted) {
        this.deleteSuccess = deleted === 1 && this.deleteTargets.length === 1
          ? `"${this.deleteTargets[0].name}" deleted.`
          : `${deleted} DAX ${deleted === 1 ? 'model' : 'models'} deleted.`;
        this.selectedRows = [];
        this.loadModels();
      }
      if (failed.length) {
        // Keep the dialog open on the models that were not deleted, with the reason.
        this.deleteTargets = this.deleteTargets.filter((_, i) => errors[i]);
        this.deleteError = failed.join(' ');
      } else {
        this.deleteTargets = [];
      }
      this.cdr.markForCheck();
    });
  }

  toggleFilterDropdown(name: 'status' | 'time', event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  /** The Saved DAX Models card fills the screen while expanded. */
  tableExpanded = false;

  toggleTableExpand(): void {
    this.tableExpanded = !this.tableExpanded;
  }

  @HostListener('document:keydown.escape')
  collapseTable(): void {
    if (this.tableExpanded) { this.tableExpanded = false; this.cdr.markForCheck(); }
  }

  @HostListener('document:click')
  closeFilterDropdowns(): void {
    if (this.openFilterName) { this.openFilterName = null; this.cdr.markForCheck(); }
    if (this.openCreateDropdown) { this.openCreateDropdown = null; this.cdr.markForCheck(); }
  }

  selectStatusFilter(option: string, event: Event): void {
    event.stopPropagation();
    this.statusFilter = option;
    this.openFilterName = null;
    this.currentPage = 1;
    this.loadModels();
  }

  selectTimeFilter(option: string, event: Event): void {
    event.stopPropagation();
    this.timeFilter = option;
    this.openFilterName = null;
    this.currentPage = 1;
    this.loadModels();
  }

  /** Rows per page: back to page 1 and reload the server page. */
  onPageSizeChange(size: number): void {
    this.pageSize = Number(size);
    this.currentPage = 1;
    this.loadModels();
  }

  goToFirstPage(): void { this.goToPage(1); }
  goToPrevPage(): void { this.goToPage(this.currentPage - 1); }
  goToNextPage(): void { this.goToPage(this.currentPage + 1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  private goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages);
    if (next === this.currentPage) return;
    this.currentPage = next;
    this.loadModels();
  }

}

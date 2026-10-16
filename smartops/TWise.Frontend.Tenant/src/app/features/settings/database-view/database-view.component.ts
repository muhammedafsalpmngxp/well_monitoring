import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of } from 'rxjs';
import { Router } from '@angular/router';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  SelectionColumnDef,
  themeQuartz,
} from 'ag-grid-community';
import { CommonApiService, DatabaseViewListItem, ViewContractReportItem, ViewContractViolation } from '../../../core/services/common-api.service';
import { ViewNameCellRendererComponent } from './cell-renderers/view-name-cell-renderer.component';
import { TablesCellRendererComponent } from './cell-renderers/tables-cell-renderer.component';
import { SourceCellRendererComponent } from './cell-renderers/source-cell-renderer.component';
import { ContractCellRendererComponent } from './cell-renderers/contract-cell-renderer.component';
import { DbActionsCellRendererComponent } from './cell-renderers/db-actions-cell-renderer.component';
import { PermissionService } from '../../../core/services/permission.service';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

export type ViewSource = 'built-in' | 'custom';

export interface DatabaseViewStat {
  label: string;
  value: number;
  icon: 'total' | 'builtin' | 'custom';
  accent: 'blue' | 'teal' | 'green';
}

export interface DatabaseViewSourceTable {
  name: string;
  columns: number;
}

export type ViewType = 'view' | 'cte' | 'component';

export interface DatabaseViewRow {
  id: string;
  viewName: string;
  description: string;
  tablesUsed: string[];
  columns: number;
  raw: number;
  source: ViewSource;
  viewType: ViewType;
  sourceTables: DatabaseViewSourceTable[];
  sqlQuery: string;
  /** Null while unknown, e.g. when the contract report failed to load. */
  contractViolations: ViewContractViolation[] | null;
}

const gridTheme = themeQuartz.withParams({
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

const rowSelection: RowSelectionOptions<DatabaseViewRow> = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
};

@Component({
  selector: 'app-database-view',
  standalone: false,
  templateUrl: './database-view.component.html',
  styleUrls: ['./database-view.component.scss'],
})
export class DatabaseViewComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canCreate(): boolean {
    return this.permissions.canView('settings.database-view') && this.permissions.canCreate('settings.database-view');
  }

  get canModify(): boolean {
    return this.permissions.canView('settings.database-view') && this.permissions.canModify('settings.database-view');
  }

  private readonly destroyRef = inject(DestroyRef);
  constructor(
    private readonly router: Router,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  loading = false;
  private contract?: Map<number, ViewContractReportItem['violations']>;
  loadError = '';
  viewTypeFilter: ViewType = 'view';
  /** Per-tab counts shown next to Views/CTEs/Components, fetched separately since the main list only loads the active type. */
  typeCounts: Record<ViewType, number> = { view: 0, cte: 0, component: 0 };

  ngOnInit(): void {
    this.loadViews();
    this.loadTypeCounts();
  }

  private loadTypeCounts(): void {
    forkJoin({
      view: this.commonApi.getDatabaseViews('view'),
      cte: this.commonApi.getDatabaseViews('cte'),
      component: this.commonApi.getDatabaseViews('component'),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.typeCounts = { view: res.view.length, cte: res.cte.length, component: res.component.length };
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  loadViews(): void {
    this.loading = true;
    this.loadError = '';
    // List first; the slower contract report fills the badges when it arrives.
    this.commonApi.getDatabaseViews(this.viewTypeFilter).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => {
        this.allRows = items.map((v: DatabaseViewListItem) => ({
          id: String(v.id),
          viewName: v.viewName,
          description: v.description,
          tablesUsed: v.tablesUsed ? v.tablesUsed.split(',').map(t => t.trim()) : [],
          columns: v.columnCount,
          raw: v.rowCount ?? 0,
          source: (v.sourceType?.toLowerCase() === 'built-in' ? 'built-in' : 'custom') as ViewSource,
          viewType: (v.viewType ?? 'view') as ViewType,
          sourceTables: [],
          sqlQuery: '',
          contractViolations: this.contract?.get(Number(v.id)) ?? null,
        }));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.loadError = 'Failed to load views.'; this.cdr.markForCheck(); },
    });
    // The contract badge is advisory; the list does not wait for it or fail with it.
    this.commonApi.getViewContractReport().pipe(
      catchError(() => of([] as ViewContractReportItem[])),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(report => {
      this.contract = new Map(report.map(r => [r.id, r.violations]));
      this.allRows = this.allRows.map(r => ({ ...r, contractViolations: this.contract!.get(Number(r.id)) ?? null }));
      this.cdr.markForCheck();
    });
  }

  setViewTypeFilter(type: ViewType): void {
    this.viewTypeFilter = type;
    this.currentPage = 1;
    this.loadViews();
  }

  createView(): void {
    if (!this.canCreate) return;
    this.router.navigate(['/settings/database-view/builder'], {
      queryParams: this.viewTypeFilter !== 'view' ? { type: this.viewTypeFilter } : {},
    });
  }

  showDeleteConfirm = false;
  deleteTarget: DatabaseViewRow | null = null;

  deleteView(row: DatabaseViewRow): void {
    if (!this.canModify) return;
    this.deleteTarget = row;
    this.showDeleteConfirm = true;
  }

  confirmDelete(): void {
    if (!this.canModify || !this.deleteTarget) return;
    this.commonApi.deleteDatabaseView(Number(this.deleteTarget.id)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.allRows = this.allRows.filter(r => r.id !== this.deleteTarget!.id); this.cancelDelete(); this.loadTypeCounts(); this.cdr.markForCheck(); },
      error: () => { this.cancelDelete(); },
    });
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deleteTarget = null;
  }

  get stats(): DatabaseViewStat[] {
    const total = this.allRows.length;
    const builtin = this.allRows.filter(r => r.source === 'built-in').length;
    const custom = this.allRows.filter(r => r.source === 'custom').length;
    return [
      { label: 'Total', value: total, icon: 'total', accent: 'blue' },
      { label: 'Built-in', value: builtin, icon: 'builtin', accent: 'teal' },
      { label: 'Custom', value: custom, icon: 'custom', accent: 'green' },
    ];
  }

  sourceFilter: 'all' | ViewSource = 'all';
  searchQuery = '';

  allRows: DatabaseViewRow[] = [];

  get filteredRows(): DatabaseViewRow[] {
    return this.allRows.filter(row => {
      const matchesSource = this.sourceFilter === 'all' || row.source === this.sourceFilter;
      const matchesSearch = !this.searchQuery ||
        row.viewName.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchesSource && matchesSearch;
    });
  }

  setSourceFilter(filter: 'all' | ViewSource): void {
    this.sourceFilter = filter;
    this.currentPage = 1;
  }

  readonly gridTheme = gridTheme;
  readonly rowSelection = rowSelection;
  readonly gridContext = { canModify: () => this.canModify, onDelete: (row: DatabaseViewRow) => this.deleteView(row) };

  readonly selectionColumnDef: SelectionColumnDef = {
    width: 48,
    maxWidth: 48,
    minWidth: 48,
    suppressHeaderMenuButton: true,
    suppressMovable: true,
  };

  readonly columnDefs: ColDef<DatabaseViewRow>[] = [
    { headerName: 'View Name',   field: 'viewName',   cellRenderer: ViewNameCellRendererComponent,  minWidth: 180 },
    { headerName: 'Description', field: 'description',                                              minWidth: 260 },
    { headerName: 'Table Used',  field: 'tablesUsed', cellRenderer: TablesCellRendererComponent, cellDataType: false, minWidth: 350, autoHeight: true },
    { headerName: 'Column',      field: 'columns',                                                  minWidth: 200 },
    { headerName: 'Rows',        field: 'raw',                                                      minWidth: 200  },
    { headerName: 'Source',      field: 'source',     cellRenderer: SourceCellRendererComponent,    minWidth: 200 },
    { headerName: 'Model',       field: 'contractViolations', cellRenderer: ContractCellRendererComponent, cellDataType: false, sortable: false, minWidth: 130 },
    { headerName: 'Actions', sortable: false, filter: false, cellRenderer: DbActionsCellRendererComponent, minWidth: 100, maxWidth: 100 },
  ];

  readonly defaultColDef: ColDef<DatabaseViewRow> = {
    sortable: true,
    resizable: true,
    flex: 1,
  };

  get totalCount(): number { return this.filteredRows.length; }
  pageSize = 20;
  currentPage = 1;
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalCount / this.pageSize)); }

  get rangeStart(): number { return this.totalCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1; }
  get rangeEnd(): number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }

  get pagedRows(): DatabaseViewRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  goToFirstPage(): void { this.currentPage = 1; }
  goToPrevPage(): void { this.currentPage = Math.max(1, this.currentPage - 1); }
  goToNextPage(): void { this.currentPage = Math.min(this.totalPages, this.currentPage + 1); }
  goToLastPage(): void { this.currentPage = this.totalPages; }
}

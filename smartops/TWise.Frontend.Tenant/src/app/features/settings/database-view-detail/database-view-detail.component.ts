import { ChangeDetectorRef, Component, DestroyRef, HostListener, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  ValueGetterParams,
  themeQuartz,
} from 'ag-grid-community';
import { CommonApiService, DatabaseViewDetail, PreviewViewRequest } from '../../../core/services/common-api.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { PermissionService } from '../../../core/services/permission.service';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const PREVIEW_ROWS = 5000;
/** Enough stored rows to fill the grid until the live preview replaces them. */
const SNAPSHOT_ROWS = 1000;

const gridTheme = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#E7ECF3',
  borderRadius: 0,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#FAFBFC',
  headerTextColor: '#667085',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

const SQL_KEYWORDS = [
  'CREATE OR REPLACE VIEW', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN',
  'SELECT', 'FROM', 'WHERE', 'LIMIT', 'DISTINCT',
];

export interface SqlLineView {
  indent: string;
  keyword: string;
  rest: string;
  isComment: boolean;
}

export interface SourceTableInfo {
  name: string;
  columns: number;
}

@Component({
  selector: 'app-database-view-detail',
  standalone: false,
  templateUrl: './database-view-detail.component.html',
  styleUrls: ['./database-view-detail.component.scss'],
})
export class DatabaseViewDetailComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canModify(): boolean {
    return this.permissions.canView('settings.database-view') && this.permissions.canModify('settings.database-view');
  }

  private readonly destroyRef = inject(DestroyRef);
  viewDetail: DatabaseViewDetail | null = null;
  loading = true;
  copied = false;

  // Preview state
  previewColumns: ColDef[] = [];
  previewRowData: Record<string, unknown>[] = [];
  previewRowCount: number | null = null;
  previewLoading = false;
  previewError: string | null = null;
  /** Run time of the stored preview on screen while the live one loads; null once live data is shown. */
  snapshotAt: string | null = null;
  private liveDone = false;

  // ─── Resizable two-column layout ─────────────────────────────────────────
  leftColWidth = 440;
  private readonly MIN_COL_WIDTH = 320;
  private readonly MAX_COL_WIDTH = 720;
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  onResizeStart(event: MouseEvent): void {
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.leftColWidth;
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onResizeMove(event: MouseEvent): void {
    if (!this.resizing) return;
    const delta = event.clientX - this.resizeStartX;
    this.leftColWidth = Math.min(this.MAX_COL_WIDTH, Math.max(this.MIN_COL_WIDTH, this.resizeStartWidth + delta));
  }

  @HostListener('document:mouseup')
  onResizeEnd(): void {
    this.resizing = false;
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly apiService: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly layoutState: LayoutStateService,
  ) {}

  ngOnInit(): void {
    // Keep the "Database View" sidebar item highlighted while on this detail page.
    this.layoutState.setActiveNavOverride('/settings/database-view');
    this.destroyRef.onDestroy(() => this.layoutState.setActiveNavOverride(null));
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.loading = false;
      return;
    }
    // Slow views take a minute to run; show the stored preview until the live one arrives.
    this.apiService.getPreviewSnapshot(id, SNAPSHOT_ROWS).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe(snap => {
      if (!snap || this.liveDone) return;
      this.showPreviewRows(snap.columns, snap.rows);
      this.previewRowCount = snap.totalRows;
      this.snapshotAt = snap.executedAt;
      this.cdr.markForCheck();
    });
    this.apiService.getDatabaseViewById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        this.viewDetail = detail;
        this.loading = false;
        this.cdr.markForCheck();
        this.loadPreview();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  get viewName(): string {
    return this.viewDetail?.viewName ?? '';
  }

  get description(): string {
    return this.viewDetail?.description ?? '';
  }

  get sourceType(): string {
    return this.viewDetail?.sourceType ?? 'custom';
  }

  get tableCount(): number {
    return this.sourceTables.length;
  }

  get columnCount(): number {
    return this.previewColumns.length > 0 ? this.previewColumns.length : (this.viewDetail?.columnCount ?? 0);
  }

  get rowCount(): number | null {
    return this.previewRowCount ?? this.viewDetail?.rowCount ?? null;
  }

  get sourceTables(): SourceTableInfo[] {
    if (!this.viewDetail?.tablesJson) return [];
    try {
      const tables = JSON.parse(this.viewDetail.tablesJson) as { name: string; columns?: number }[];
      return tables.map(t => ({ name: t.name, columns: t.columns ?? 0 }));
    } catch {
      // Fallback: parse from tablesUsed
      return (this.viewDetail.tablesUsed || '').split(',').filter(Boolean).map(t => ({ name: t.trim(), columns: 0 }));
    }
  }

  get generatedSql(): string {
    return this.viewDetail?.generatedSql ?? '';
  }

  get sqlLineViews(): SqlLineView[] {
    return (this.generatedSql || '').split('\n').map(line => {
      const [, indent = '', remainder = ''] = /^(\s*)(.*)$/.exec(line) ?? [];
      const keyword = SQL_KEYWORDS.find(k => remainder.toUpperCase().startsWith(k));
      const rest = keyword ? remainder.slice(keyword.length) : remainder;
      return {
        indent,
        keyword: keyword ? remainder.slice(0, keyword.length) : '',
        rest,
        isComment: rest.includes('/*'),
      };
    });
  }

  readonly gridTheme = gridTheme;

  readonly defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
    flex: 1,
    minWidth: 100,
  };

  /** Strip "CREATE OR REPLACE VIEW ... AS\n" prefix to get pure SELECT for preview. */
  private extractSelectSql(sql: string): string {
    return sql.replace(/^CREATE\s+OR\s+REPLACE\s+VIEW\s+\S+\s+AS\s*/i, '');
  }

  loadPreview(): void {
    if (!this.viewDetail) { this.loading = false; return; }
    const rawSql = this.viewDetail.generatedSql || this.viewDetail.manualSql;
    if (!rawSql) {
      this.previewLoading = false;
      this.loading = false;
      return;
    }
    this.previewLoading = true;
    this.previewError = null;

    const request: PreviewViewRequest = {
      connectionId: this.viewDetail.connectionId,
      sql: this.extractSelectSql(rawSql),
      viewId: this.viewDetail.id,
      maxRows: PREVIEW_ROWS,
    };

    this.apiService.previewView(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.liveDone = true;
        this.snapshotAt = null;
        this.showPreviewRows(result.columns, result.rows);
        this.previewLoading = false;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.liveDone = true;
        // Keep the stored preview on screen; the note says the refresh failed.
        if (!this.snapshotAt) this.previewError = err?.error?.message || 'Failed to load preview';
        this.previewLoading = false;
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private showPreviewRows(columns: string[] | undefined, rows: Record<string, unknown>[] | undefined): void {
    this.previewColumns = (columns || []).map(col => ({
      headerName: col,
      valueGetter: (params: ValueGetterParams) => (params.data as Record<string, unknown>)?.[col],
      minWidth: 120,
    }));
    this.previewRowData = rows || [];
    this.previewRowCount = rows?.length ?? 0;
  }

  copySql(): void {
    navigator.clipboard?.writeText(this.generatedSql).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    });
  }

  editView(): void {
    if (!this.canModify) return;
    this.router.navigate(['/settings/database-view/builder'], { queryParams: { editId: this.viewDetail?.id } });
  }
}

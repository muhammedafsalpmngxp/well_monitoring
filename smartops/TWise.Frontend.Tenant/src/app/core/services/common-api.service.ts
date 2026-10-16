import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of, shareReplay, tap, catchError, switchMap, defer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardShareContext } from './widget.service';
import { DaxModelConfig, getTileDaxRequest } from '../utils/dax-evaluator.util';

export interface SourceDto {
  name: string;
  sourceType: string;
  schemaName: string;
  columnCount: number;
}

export interface TableDataDto {
  columns: string[];
  rows: Record<string, unknown>[];
  columnTypes?: Record<string, string>;
  primaryKeys?: string[];
}

export interface ReliabilityDto {
  reliability: number | null;
  reliability_breakdown: string;
}

export interface DbConnection {
  id: number;
  connectionName: string;
  databaseName: string;
  server: string;
  port: number;
}

/** An index a table already has; supportsView = it leads with a column the view filters, joins or sorts on. */
export interface ExistingIndex {
  name: string;
  type: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  keyColumns: string[];
  includedColumns: string[];
  supportsView: boolean;
}

/** An index that would help the view; source 'View' (its filters/joins) or 'SQL Server' (missing-index statistics). */
export interface SuggestedIndex {
  keyColumns: string[];
  includedColumns: string[];
  reason: string;
  source: string;
  estimatedImpact: number | null;
  createSql: string;
}

export interface ViewTableIndexAdvice {
  table: string;
  rowCount: number | null;
  filterColumns: string[];
  joinColumns: string[];
  sortColumns: string[];
  existingIndexes: ExistingIndex[];
  suggestedIndexes: SuggestedIndex[];
}

export interface ViewIndexAdvice {
  supported: boolean;
  message: string | null;
  tables: ViewTableIndexAdvice[];
}

export interface DbSchemaColumn {
  id: number;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTable: string | null;
  foreignKeyColumn: string | null;
  maxLength: number | null;
  ordinalPosition: number;
}

export interface DbSchemaTable {
  schemaName: string;
  tableName: string;
  columnCount: number;
  columns: DbSchemaColumn[];
}

export interface DbSchema {
  connectionId: number;
  connectionName: string;
  databaseName: string;
  syncedAt: string;
  tables: DbSchemaTable[];
}

export interface PlantFilterDto {
  plantCode: number;
  plantDescription: string;
  cluster: string;
  division: string;
  businessUnit: string;
  sector: string;
  country: string;
}

export interface OrgStructureRow {
  plantCode: number;
  siteManagerA: string;
  siteManagerB: string;
  clusterManager: string;
  projectDirectorID: number;
  projectDirectorName: string;
  executiveVicePresident: string;
  ceo: string;
}

export interface CompanyRow {
  companyId: number;
  companyName: string;
}

export interface AdvancedFilterDataDto {
  orgStructure: OrgStructureRow[];
  companies: CompanyRow[];
}

@Injectable({ providedIn: 'root' })
export class CommonApiService {
  private readonly baseUrl = `${environment.apiBaseUrl}/common`;
  private readonly connectionsUrl = `${environment.apiBaseUrl}/database-connections`;
  private viewsCache = new Map<string, Observable<DatabaseViewListItem[]>>();
  private sourcesCache$?: Observable<SourceDto[]>;
  private plantFiltersCache$?: Observable<PlantFilterDto[]>;

  constructor(private readonly http: HttpClient) {}

  clearCache(): void {
    this.sourcesCache$ = undefined;
    this.plantFiltersCache$ = undefined;
    this.viewsCache.clear();
  }

  /** GET /api/common/sources – list all available tables/views for report building. */
  getSources(): Observable<SourceDto[]> {
    if (!this.sourcesCache$) {
      this.sourcesCache$ = this.http.get<SourceDto[]>(`${this.baseUrl}/sources`).pipe(shareReplay(1));
    }
    return this.sourcesCache$;
  }

  /** TEMPORARY: list tables from AlTasnimBI */
  getBISources(): Observable<SourceDto[]> {
    return this.http.get<SourceDto[] | { data: SourceDto[] }>(`${this.baseUrl}/bi-sources`).pipe(
      map(response => Array.isArray(response) ? response : response.data ?? []),
    );
  }

  /** GET /api/common/table-data?sourceName=X&sourceType=Y – preview data from a source. */
  getTableData(sourceName: string, sourceType: string): Observable<TableDataDto> {
    const params = new HttpParams()
      .set('sourceName', sourceName)
      .set('sourceType', sourceType);
    return this.http.get<TableDataDto>(`${this.baseUrl}/table-data`, { params });
  }

  /**
   * POST /api/common/aggregate – compute a single aggregate value in SQL (server-side) for a
   * table source, so tiles on very large tables show the correct number instead of a browser-side
   * count over the first 1000 rows. `aggregation`: count | countDistinct | total | average | value.
   */
  getAggregate(req: { sourceName: string; sourceType: string; aggregation: string; valueField?: string; daxModel?: DaxModelConfig }, shareContext?: DashboardShareContext): Observable<{ value: number | null }> {
    let params = new HttpParams();
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    return defer(() => {
      const { daxModel, ...body } = req;
      const dax = getTileDaxRequest(daxModel);
      return this.http.post<{ value: number | null }>(`${this.baseUrl}/aggregate`, { ...body, ...(dax ? { dax } : {}) }, { params });
    });
  }

  /**
   * Live "1st value" of a breakdown row's column (same meaning as the tile's Value calculation),
   * computed server-side so it reflects current data. Table → aggregate; View → the view's first row.
   * Falls back to 0 on any error.
   */
  getBreakdownValue(sourceName: string, sourceType: string, column: string, shareContext?: DashboardShareContext): Observable<number> {
    if (!sourceName || !column) return of(0);
    if ((sourceType || 'Table').toLowerCase() !== 'view') {
      return this.getAggregate({ sourceName, sourceType: 'Table', aggregation: 'value', valueField: column }, shareContext)
        .pipe(map(r => r.value ?? 0), catchError(() => of(0)));
    }
    if (shareContext) {
      const params = new HttpParams()
        .set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token)
        .set('sourceName', sourceName).set('column', column);
      return this.http.get<{ value: unknown }>(`${environment.apiBaseUrl}/database-views/shared-value`, { params })
        .pipe(map(result => Number(result.value ?? 0) || 0), catchError(() => of(0)));
    }
    return this.getDatabaseViews('view').pipe(
      switchMap(views => {
        const v = views.find(x => x.viewName === sourceName);
        if (!v) return of(0);
        return this.getDatabaseViewById(v.id).pipe(
          switchMap(detail => this.previewView({ connectionId: detail.connectionId, sql: detail.generatedSql, viewId: detail.id, maxRows: 1 })),
          map(res => Number(res.rows?.[0]?.[column] ?? 0) || 0),
        );
      }),
      catchError(() => of(0)),
    );
  }

  getPlantFilters(shareContext?: DashboardShareContext): Observable<PlantFilterDto[]> {
    if (shareContext) {
      const params = new HttpParams().set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
      return this.http.get<PlantFilterDto[]>(`${this.baseUrl}/plant-filters`, { params });
    }
    if (!this.plantFiltersCache$) {
      this.plantFiltersCache$ = this.http.get<PlantFilterDto[]>(`${this.baseUrl}/plant-filters`).pipe(shareReplay(1));
    }
    return this.plantFiltersCache$;
  }

  getAdvancedFilters(shareContext?: DashboardShareContext): Observable<AdvancedFilterDataDto> {
    let params = new HttpParams();
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    return this.http.get<AdvancedFilterDataDto>(`${this.baseUrl}/advanced-filters`, { params });
  }

  /** GET /api/database-connections – list all registered database connections. */
  getConnections(): Observable<DbConnection[]> {
    return this.http.get<DbConnection[]>(this.connectionsUrl);
  }

  /** GET /api/database-connections/{id}/schema – full table/column schema for a connection. */
  getConnectionSchema(connectionId: number): Observable<DbSchema> {
    return this.http.get<DbSchema>(`${this.connectionsUrl}/${connectionId}/schema`);
  }

  /** GET /api/database-views – list all saved database views. */
  getDatabaseViews(type?: string): Observable<DatabaseViewListItem[]> {
    const key = type ?? '__all__';
    if (!this.viewsCache.has(key)) {
      let params = new HttpParams();
      if (type) params = params.set('type', type);
      this.viewsCache.set(key, this.http.get<DatabaseViewListItem[]>(`${environment.apiBaseUrl}/database-views`, { params }).pipe(shareReplay(1)));
    }
    return this.viewsCache.get(key)!;
  }

  /** GET /api/database-views/contract-report – every view checked against the view contract. */
  getViewContractReport(): Observable<ViewContractReportItem[]> {
    return this.http.get<ViewContractReportItem[]>(`${environment.apiBaseUrl}/database-views/contract-report`);
  }

  /** GET /api/database-views/{id}?sourceName=X – get a single database view by id. */
  getDatabaseViewById(id: number, shareContext?: DashboardShareContext, sourceName?: string): Observable<DatabaseViewDetail> {
    let params = new HttpParams();
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    if (sourceName) params = params.set('sourceName', sourceName);
    return this.http.get<DatabaseViewDetail>(`${environment.apiBaseUrl}/database-views/${id}`, { params });
  }

  /** GET /api/data-quality/reliability/table?tableName=X – calculate table reliability. */
  getTableReliability(tableName: string, shareContext?: DashboardShareContext): Observable<ReliabilityDto> {
    let params = new HttpParams().set('tableName', tableName);
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    return this.http.get<ReliabilityDto>(`${environment.apiBaseUrl}/data-quality/reliability/table`, { params });
  }

  /** DELETE /api/database-views/{id} – delete a saved view. */
  deleteDatabaseView(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/database-views/${id}`).pipe(tap(() => this.viewsCache.clear()));
  }

  /** POST /api/database-views – create a new database view definition. */
  saveView(request: CreateDatabaseViewRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${environment.apiBaseUrl}/database-views`, request).pipe(tap(() => this.viewsCache.clear()));
  }

  /** PUT /api/database-views/{id} – update an existing database view definition. */
  updateView(id: number, request: CreateDatabaseViewRequest): Observable<{ id: number }> {
    return this.http.put<{ id: number }>(`${environment.apiBaseUrl}/database-views/${id}`, request).pipe(tap(() => this.viewsCache.clear()));
  }

  /** POST /api/database-views/index-advice – existing and suggested indexes for the tables the SQL reads (read-only). */
  getIndexAdvice(connectionId: number, sql: string): Observable<ViewIndexAdvice> {
    return this.http.post<ViewIndexAdvice>(`${environment.apiBaseUrl}/database-views/index-advice`, { connectionId, sql });
  }

  /** POST /api/database-views/preview – run SQL and return sample rows. */
  previewView(request: PreviewViewRequest, shareContext?: DashboardShareContext): Observable<{ columns: string[]; rows: Record<string, unknown>[] }> {
    let params = new HttpParams();
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    return this.http.post<{ columns: string[]; rows: Record<string, unknown>[] }>(
      `${environment.apiBaseUrl}/database-views/preview`, request, { params });
  }

  /** GET /api/database-views/{id}/preview-snapshot – last stored preview; null when there is none. */
  getPreviewSnapshot(id: number, maxRows: number): Observable<PreviewSnapshot | null> {
    return this.http.get<PreviewSnapshot | null>(`${environment.apiBaseUrl}/database-views/${id}/preview-snapshot`, { params: { maxRows } });
  }
}

export interface PreviewSnapshot {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executedAt: string | null;
}

export interface CreateDatabaseViewRequest {
  connectionId: number;
  viewName: string;
  description: string;
  isDistinct: boolean;
  tablesJson: string;
  joinsJson: string;
  selectedColumnsJson: string;
  columnAliasesJson: string;
  filtersJson: string;
  generatedSql: string;
  manualSql: string;
  tablesUsed: string;
  columnCount: number;
  viewType?: string;
  referencedCteIdsJson?: string;
  referencedComponentIdsJson?: string;
}

export interface PreviewViewRequest {
  connectionId: number;
  /** Optional. When omitted the API resolves the SQL from the stored view identified by viewId. */
  sql?: string;
  viewId: number;
  maxRows: number;
}

/** One failed rule of docs/VIEW-CONTRACT.md. An empty list means the view is model-compliant. */
export interface ViewContractViolation {
  rule: number;
  message: string;
}

export interface ViewContractReportItem {
  id: number;
  viewName: string;
  viewType: string;
  violations: ViewContractViolation[];
}

export interface DatabaseViewListItem {
  id: number;
  viewName: string;
  description: string;
  connectionId: number;
  connectionName: string;
  tablesUsed: string;
  columnCount: number;
  rowCount: number | null;
  reliability: number | null;
  reliability_breakdown: string;
  sourceType: string;
  viewType: string;
  generatedSql: string;
  createdAt: string;
  modifiedAt: string;
}

export interface DatabaseViewDetail {
  id: number;
  connectionId: number;
  connectionName: string;
  viewName: string;
  description: string;
  isDistinct: boolean;
  tablesJson: string;
  joinsJson: string;
  selectedColumnsJson: string;
  columnAliasesJson: string;
  filtersJson: string;
  generatedSql: string;
  manualSql: string;
  previewDataJson: string | null;
  previewColumnsJson: string | null;
  previewRowCount: number | null;
  previewExecutedAt: string | null;
  tablesUsed: string;
  columnCount: number;
  rowCount: number | null;
  reliability: number | null;
  reliability_breakdown: string;
  sourceType: string;
  viewType: string;
  referencedCteIdsJson: string | null;
  referencedComponentIdsJson: string | null;
  tenantId: number;
  createdBy: number;
  createdAt: string;
  modifiedBy: number | null;
  modifiedAt: string;
  contractViolations: ViewContractViolation[];
}

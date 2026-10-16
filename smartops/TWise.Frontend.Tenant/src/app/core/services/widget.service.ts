import { Injectable } from '@angular/core';
import { ReportFilter, TopNSpec } from '../utils/report-filter.util';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { catchError, defer, Observable, of, retry, switchMap, throwError } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import { API_ENDPOINTS } from '../constants/api.constants';
import { environment } from '../../../environments/environment';
import { DaxModelConfig, getTileDaxRequest } from '../utils/dax-evaluator.util';

export interface ChartSource {
  name: string;
  sourceType: string;  // 'Table' or 'View'
  schemaName: string;
  columnCount: number;
}

export interface WidgetLibraryItem {
  id: number;
  widgetName: string;
  type: string;
  json: string;
}

export interface CreateWidgetRequest {
  name: string;
  description?: string;
  type: string;
  libraryId: number;
  source: string;
  sourceType: string;
  sourceId?: number | null;
  designJson: string;
  categoryId: number;
}

export interface UserPreferenceDto {
  preferenceId: number;
  userId: number;
  controlTypeId: number;   // 1=Dashboard 2=Chart 3=Tile 4=Report
  controlId: number;
  isFavourite: boolean;
  lastViewedOn: string | null;
}

export interface Widget {
  id: number;
  name: string;
  description?: string;
  type: string;
  libraryId: number;
  source: string;
  sourceType: string;
  sourceId?: number | null;
  designJson: string;
  categoryId: number;
  categoryName?: string;
  status: string;
  createdAt: string;
  createdBy: number;
  /** Tiles attached to a chart, in saved order; only on GET /api/widgets/{id}. */
  attachedTiles?: Widget[];
}

/** Identifies an externally shared dashboard so its data requests can bypass authentication. */
export interface DashboardShareContext {
  dashboardId: number;
  token: string;
}

@Injectable({ providedIn: 'root' })
export class WidgetService {
  private tableDataCache = new Map<string, Observable<{ columns: string[]; rows: Record<string, unknown>[] }>>();

  constructor(
    private readonly api: ApiService,
    private readonly http: HttpClient,
  ) {}

  /** Returns flat array — not wrapped in ApiResponse */
  getSources(): Observable<ChartSource[]> {
    return this.http.get<ChartSource[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.COMMON.SOURCES}`);
  }

  /** TEMPORARY: list tables from AlTasnimBI */
  getBISources(): Observable<ChartSource[]> {
    return this.http.get<ChartSource[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.COMMON.BI_SOURCES}`);
  }

  /** Fetch chart templates from ControlPlane widget library */
  getWidgetLibraryCharts(): Observable<WidgetLibraryItem[]> {
    const params = new HttpParams().set('type', 'chart');
    return this.http.get<WidgetLibraryItem[]>(
      `${environment.controlPlaneApiUrl}/widget-library`,
      { params },
    );
  }

  /** Fetch tile templates from ControlPlane widget library */
  getWidgetLibraryByType(type: string): Observable<WidgetLibraryItem[]> {
    const params = new HttpParams().set('type', type);
    return this.http.get<WidgetLibraryItem[]>(
      `${environment.controlPlaneApiUrl}/widget-library`,
      { params },
    );
  }

  getTableData(sourceName: string, sourceType: string, shareContext?: DashboardShareContext): Observable<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const key = `${sourceName}::${sourceType}::${shareContext?.dashboardId ?? ''}`;
    if (!this.tableDataCache.has(key)) {
      // Imported files are keyed by dataset id, not a table/view name — route to the imports API.
      let req$: Observable<{ columns: string[]; rows: Record<string, unknown>[] }>;
      if (sourceType === 'Import') {
        req$ = this.http.get<{ columns: string[]; rows: Record<string, unknown>[] }>(
          `${environment.tenantApiUrl}${API_ENDPOINTS.IMPORTS.DATA(sourceName)}`,
        );
      } else {
        let params = new HttpParams().set('sourceName', sourceName).set('sourceType', sourceType);
        if (shareContext) {
          params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
        }
        req$ = this.http.get<{ columns: string[]; rows: Record<string, unknown>[] }>(
          `${environment.tenantApiUrl}${API_ENDPOINTS.COMMON.TABLE_DATA}`,
          { params },
        );
      }
      this.tableDataCache.set(key, req$.pipe(shareReplay({ bufferSize: 1, refCount: false })));
    }
    return this.tableDataCache.get(key)!;
  }

  /** Returns flat array — not wrapped in ApiResponse */
  getWidgets(status?: string, type?: string): Observable<Widget[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (type)   params = params.set('type', type);
    return this.http.get<Widget[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BASE}`, { params });
  }

  /** Returns single widget — not wrapped in ApiResponse */
  getWidgetById(id: number, shareContext?: DashboardShareContext): Observable<Widget> {
    if (shareContext) {
      const params = new HttpParams().set('token', shareContext.token);
      return this.http.get<Widget>(
        `${environment.tenantApiUrl}/dashboard/shared/${shareContext.dashboardId}/widgets/${id}`,
        { params },
      );
    }
    return this.http.get<Widget>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BY_ID(id)}`);
  }

  createWidget(request: CreateWidgetRequest): Observable<Widget> {
    return this.http.post<Widget>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BASE}`, request);
  }

  cloneChart(id: number): Observable<Widget> {
    return this.getWidgetById(id).pipe(
      switchMap((source) => {
        if (!source || source.type !== 'chart') throw new Error('Failed to load chart for cloning.');
        let designJson = source.designJson;
        if (designJson) {
          const design = JSON.parse(designJson);
          if (design?._meta) delete design._meta.copiedFromWidgetId;
          designJson = JSON.stringify(design);
        }
        let name = `${source.name} Clone`;
        return defer(() => this.createWidget({
          name,
          description: source.description,
          type: source.type,
          libraryId: source.libraryId,
          source: source.source,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          designJson,
          categoryId: source.categoryId,
        })).pipe(
          retry({
            count: 9,
            delay: (error, retryCount) => {
              if (error.status !== 409) throw error;
              name = `${source.name} Clone (${retryCount + 1})`;
              return of(null);
            },
          }),
        );
      }),
    );
  }

  copyWidgetToDraft(id: number): Observable<Widget> {
    return this.http.post<Widget>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BASE}/${id}/copy-to-draft`, {});
  }

  /** Update widget — used for publishing (status: 'published') */
  updateWidget(id: number, request: CreateWidgetRequest & { status?: string }): Observable<Widget> {
    return this.http.put<Widget>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BY_ID(id)}`, request);
  }

  deleteWidget(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.tenantApiUrl}${API_ENDPOINTS.WIDGETS.BY_ID(id)}`);
  }

  // ── User Preference (Favourites + Recently Viewed) ─────────────────────────
  private get prefUrl(): string { return `${environment.tenantApiUrl}/preferences`; }

  /** Toggle favourite for a control. ControlTypeId: 1=Dashboard 2=Chart 3=Tile 4=Report */
  toggleFavourite(controlTypeId: number, controlId: number): Observable<UserPreferenceDto> {
    return this.http.post<UserPreferenceDto>(`${this.prefUrl}/favourite`, { controlTypeId, controlId });
  }

  /** Track a view (call when opening a chart/tile/dashboard/report). */
  trackView(controlTypeId: number, controlId: number): Observable<void> {
    return this.http.post<void>(`${this.prefUrl}/view`, { controlTypeId, controlId });
  }

  /** Get all favourites. Pass controlTypeId to filter: 2=Chart, 3=Tile */
  getFavourites(controlTypeId?: number): Observable<UserPreferenceDto[]> {
    let params = new HttpParams();
    if (controlTypeId != null) params = params.set('controlTypeId', controlTypeId);
    return this.http.get<UserPreferenceDto[]>(`${this.prefUrl}/favourites`, { params });
  }

  /** Get recently viewed items. Pass controlTypeId to filter. */
  getRecentlyViewed(controlTypeId?: number, limit = 20): Observable<UserPreferenceDto[]> {
    let params = new HttpParams().set('limit', limit);
    if (controlTypeId != null) params = params.set('controlTypeId', controlTypeId);
    return this.http.get<UserPreferenceDto[]>(`${this.prefUrl}/recently-viewed`, { params });
  }

  getFilteredChartData(body: { chartSource: string; chartSourceType: string; viewId: number | null; filters: { sourceTable: string; sourceColumn: string; controlType: string; value: string; values?: string[]; label?: string; dashboardAdditional?: boolean }[]; fromDate?: string; toDate?: string; preserveFutureDateRange?: boolean; mode?: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; reportFilters?: ReportFilter[]; topN?: TopNSpec; aggregation?: string; valueField?: string; daxModel?: DaxModelConfig }, shareContext?: DashboardShareContext, onUnsupportedAdditionalFilter?: () => void): Observable<{ columns: string[]; rows: Record<string, unknown>[] }> {
    let params = new HttpParams();
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    const url = `${environment.tenantApiUrl}${API_ENDPOINTS.COMMON.FILTERED_CHART_DATA}`;
    const filters = body.filters.map(({ dashboardAdditional, ...filter }) =>
      dashboardAdditional ? { ...filter, dashboardAdditional: true } : filter);
    if (body.chartSourceType.toLowerCase() === 'import' && body.filters.some(filter => filter.dashboardAdditional)) {
      console.warn(`Additional dashboard filters cannot be applied to imported chart source ${body.chartSource}.`);
      return of({ columns: [], rows: [] });
    }
    return defer(() => {
      const { daxModel, ...request } = body;
      const dax = getTileDaxRequest(daxModel);
      return this.http.post<{ columns: string[]; rows: Record<string, unknown>[] }>(
        url, { ...request, filters, ...(dax ? { dax } : {}) }, { params });
    }).pipe(
      catchError((error: unknown) => {
        if (body.daxModel?.enabled || !(error instanceof HttpErrorResponse) || error.status !== 404 ||
            !body.filters.some(filter => filter.dashboardAdditional)) return throwError(() => error);
        console.warn(`Additional dashboard filters cannot be joined to ${body.chartSource}; showing no data.`, error);
        return of({ columns: [], rows: [] });
      }),
    );
  }
}

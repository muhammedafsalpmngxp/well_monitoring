import { Injectable } from '@angular/core';
import { BehaviorSubject, catchError, concatMap, defer, from, Observable, of, retry, switchMap, tap, toArray } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ApiResponse } from '../models/api-response.model';
import {
  CompleteDashboardResponse,
  CreateDashboardResponse,
  DashboardCategoryResponse,
  DashboardDetailResponse,
  DashboardShareLinkResponse,
  ShareDashboardInternallyResponse,
  DashboardVersionSummaryResponse,
  RestoreDashboardVersionResponse,
  PublishDashboardResponse,
  ReopenDashboardResponse,
  SaveDashboardRequest,
  ToggleDashboardActiveResponse,
  UpdateDashboardResponse,
  WidgetLibraryResponse,
} from '../models/dashboard.model';
import { CategoryDropdown } from '../models/category.model';
import { DashboardSavedFilterService } from './dashboard-saved-filter.service';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly path = '/dashboard';

  /** Reactive WIP (Draft) dashboard list. */
  private readonly wipSubject = new BehaviorSubject<DashboardCategoryResponse[]>([]);
  readonly wip$ = this.wipSubject.asObservable();

  /** Reactive Published dashboard list. */
  private readonly publishedSubject = new BehaviorSubject<DashboardCategoryResponse[]>([]);
  readonly published$ = this.publishedSubject.asObservable();

  /** Reactive "shared with me" dashboard list (any status, shared internally by other users). */
  private readonly sharedSubject = new BehaviorSubject<DashboardCategoryResponse[]>([]);
  readonly shared$ = this.sharedSubject.asObservable();

  private wipLoaded = false;
  private publishedLoaded = false;
  private sharedLoaded = false;

  private wipLoading = false;
  private publishedLoading = false;
  private sharedLoading = false;

  constructor(
    private readonly api: ApiService,
    private readonly savedFilterService: DashboardSavedFilterService,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  /** Load WIP dashboards from backend (GET /api/dashboard/wip). */
  loadWipDashboards(): Observable<DashboardCategoryResponse[]> {
    this.wipLoading = true;
    return this.api.get<DashboardCategoryResponse[]>(`${this.path}/wip`).pipe(
      map((res: ApiResponse<DashboardCategoryResponse[]>) => res.data ?? []),
      tap({
        next: (data) => {
          this.wipSubject.next(data);
          this.wipLoaded = true;
          this.wipLoading = false;
        },
        error: () => {
          this.wipLoading = false;
        },
      }),
    );
  }

  /** Get WIP dashboards – loads once from API, then returns cache reactively. */
  getWipDashboards(): Observable<DashboardCategoryResponse[]> {
    if (!this.wipLoaded && !this.wipLoading) {
      this.loadWipDashboards().subscribe({ error: () => { this.wipLoading = false; } });
    }
    return this.wip$;
  }

  /** Load Published dashboards from backend (GET /api/dashboard/published). */
  loadPublishedDashboards(): Observable<DashboardCategoryResponse[]> {
    this.publishedLoading = true;
    return this.api.get<DashboardCategoryResponse[]>(`${this.path}/published`).pipe(
      map((res: ApiResponse<DashboardCategoryResponse[]>) => res.data ?? []),
      tap({
        next: (data) => {
          this.publishedSubject.next(data);
          this.publishedLoaded = true;
          this.publishedLoading = false;
        },
        error: () => {
          this.publishedLoading = false;
        },
      }),
    );
  }

  /** Get Published dashboards – loads once from API, then returns cache reactively. */
  getPublishedDashboards(): Observable<DashboardCategoryResponse[]> {
    if (!this.publishedLoaded && !this.publishedLoading) {
      this.loadPublishedDashboards().subscribe({ error: () => { this.publishedLoading = false; } });
    }
    return this.published$;
  }

  /** Load dashboards internally shared with the current user (GET /api/dashboard/shared-with-me). */
  loadSharedWithMeDashboards(): Observable<DashboardCategoryResponse[]> {
    this.sharedLoading = true;
    return this.api.get<DashboardCategoryResponse[]>(`${this.path}/shared-with-me`).pipe(
      map((res: ApiResponse<DashboardCategoryResponse[]>) => res.data ?? []),
      tap({
        next: (data) => {
          this.sharedSubject.next(data);
          this.sharedLoaded = true;
          this.sharedLoading = false;
        },
        error: () => {
          this.sharedLoading = false;
        },
      }),
    );
  }

  /** Get dashboards shared with the current user – loads once, then returns cache reactively. */
  getSharedWithMeDashboards(): Observable<DashboardCategoryResponse[]> {
    if (!this.sharedLoaded && !this.sharedLoading) {
      this.loadSharedWithMeDashboards().subscribe({ error: () => { this.sharedLoading = false; } });
    }
    return this.shared$;
  }

  /** Reset cached WIP/Published/Shared lists (call on logout so the next user starts fresh). */
  clearCache(): void {
    this.wipSubject.next([]);
    this.publishedSubject.next([]);
    this.sharedSubject.next([]);
    this.wipLoaded = false;
    this.publishedLoaded = false;
    this.sharedLoaded = false;
    this.wipLoading = false;
    this.publishedLoading = false;
    this.sharedLoading = false;
  }

  /** Get categories for dropdown (GET /api/dashboard/categories). */
  getDashboardCategories(): Observable<CategoryDropdown[]> {
    return this.api.get<CategoryDropdown[]>(`${this.path}/categories`).pipe(
      map((res: ApiResponse<CategoryDropdown[]>) => res.data ?? []),
    );
  }

  /** Get a single dashboard with widgets (GET /api/dashboard/:id). */
  getDashboardById(dashboardId: number): Observable<ApiResponse<DashboardDetailResponse>> {
    return this.api.get<DashboardDetailResponse>(`${this.path}/${dashboardId}`);
  }

  /** Lightweight list of the current user's WIP dashboards for copy targets (GET /api/dashboard/wip-min). */
  getWipDashboardsMinimal(): Observable<{ dashboardId: number; dashboardName: string }[]> {
    return this.api.get<{ dashboardId: number; dashboardName: string }[]>(`${this.path}/wip-min`).pipe(
      map((res: ApiResponse<{ dashboardId: number; dashboardName: string }[]>) => res.data ?? []),
    );
  }

  /** The current user's canvases, grouped by category (GET /api/dashboard/wip?kind=canvas). Not cached. */
  getMyCanvases(): Observable<DashboardCategoryResponse[]> {
    return this.api.get<DashboardCategoryResponse[]>(`${this.path}/wip?kind=canvas`).pipe(
      map((res: ApiResponse<DashboardCategoryResponse[]>) => res.data ?? []),
    );
  }

  /** Published canvases, grouped by category (GET /api/dashboard/published?kind=canvas). Not cached. */
  getPublishedCanvases(): Observable<DashboardCategoryResponse[]> {
    return this.api.get<DashboardCategoryResponse[]>(`${this.path}/published?kind=canvas`).pipe(
      map((res: ApiResponse<DashboardCategoryResponse[]>) => res.data ?? []),
    );
  }

  /** Get one dashboard using its anonymous external-share token. */
  getSharedDashboard(dashboardId: number, token: string): Observable<ApiResponse<DashboardDetailResponse>> {
    return this.api.get<DashboardDetailResponse>(`${this.path}/shared/${dashboardId}?token=${encodeURIComponent(token)}`);
  }

  /** Get only the widgets configured on an anonymously shared dashboard. */
  getSharedDashboardWidgets(dashboardId: number, token: string): Observable<WidgetLibraryResponse> {
    return this.api.get<WidgetLibraryResponse>(`${this.path}/shared/${dashboardId}/widgets?token=${encodeURIComponent(token)}`).pipe(
      map((res: ApiResponse<WidgetLibraryResponse>) => res.data ?? { tiles: [], charts: [] }),
    );
  }

  /** Get the published version history of a dashboard's series (GET /api/dashboard/:id/versions). */
  getVersionHistory(dashboardId: number): Observable<DashboardVersionSummaryResponse[]> {
    return this.api.get<DashboardVersionSummaryResponse[]>(`${this.path}/${dashboardId}/versions`).pipe(
      map((res: ApiResponse<DashboardVersionSummaryResponse[]>) => res.data ?? []),
    );
  }

  /**
   * Restore a dashboard to an earlier published version
   * (POST /api/dashboard/:id/restore/:versionNo). Admin only.
   *
   * Append-only: the chosen version's content is republished as a NEW version, so the
   * history — including the version being rolled back from — is preserved.
   */
  restoreVersion(dashboardId: number, versionNo: number): Observable<RestoreDashboardVersionResponse> {
    return this.api.post<RestoreDashboardVersionResponse>(`${this.path}/${dashboardId}/restore/${versionNo}`, {}).pipe(
      map((res: ApiResponse<RestoreDashboardVersionResponse>) => res.data as RestoreDashboardVersionResponse),
    );
  }

  /** Get active charts and tiles for the builder library (GET /api/dashboard/widgets/library). */
  getWidgetLibrary(): Observable<WidgetLibraryResponse> {
    return this.api.get<WidgetLibraryResponse>(`${this.path}/widgets/library`).pipe(
      map((res: ApiResponse<WidgetLibraryResponse>) => res.data ?? { tiles: [], charts: [] }),
    );
  }

  /** Get only the widgets referenced by one dashboard — any authenticated user (GET /api/dashboard/:id/widgets). */
  getDashboardWidgets(dashboardId: number): Observable<WidgetLibraryResponse> {
    return this.api.get<WidgetLibraryResponse>(`${this.path}/${dashboardId}/widgets`).pipe(
      map((res: ApiResponse<WidgetLibraryResponse>) => res.data ?? { tiles: [], charts: [] }),
    );
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  /** Create a new dashboard (POST /api/dashboard). */
  createDashboard(request: SaveDashboardRequest): Observable<ApiResponse<CreateDashboardResponse>> {
    return this.api.post<CreateDashboardResponse>(this.path, request).pipe(
      tap(() => this.refreshWip()),
    );
  }

  cloneDashboard(dashboardId: number): Observable<ApiResponse<CreateDashboardResponse>> {
    return this.getDashboardById(dashboardId).pipe(
      switchMap((response) => {
        if (!response.success || !response.data) {
          throw new Error(response.message || 'Failed to load dashboard for cloning.');
        }
        const source = response.data;
        let configJson = source.configJson;
        if (configJson) {
          const config = JSON.parse(configJson);
          if (config?._meta) {
            delete config._meta.publicShareTokenHash;
            delete config._meta.sharedWithUserIds;
          }
          configJson = JSON.stringify(config);
        }
        let dashboardName = `${source.dashboardName} Clone`;
        const createClone$ = defer(() => this.createDashboard({
          dashboardName,
          categoryId: source.categoryId,
          description: source.description,
          configJson,
        })).pipe(
          retry({
            count: 9,
            delay: (error, retryCount) => {
              if (error.status !== 409) throw error;
              dashboardName = `${source.dashboardName} Clone (${retryCount + 1})`;
              return of(null);
            },
          }),
        );
        return this.savedFilterService.getAll(dashboardId).pipe(
          switchMap((filters) => createClone$.pipe(
            switchMap((created) => {
              if (!created.success || !created.data) return of(created);
              const cloneId = created.data.dashboardId;
              return from(filters).pipe(
                concatMap((filter) => this.savedFilterService.save(cloneId, {
                  filterName: filter.filterName,
                  country: filter.country,
                  sector: filter.sector,
                  businessUnit: filter.businessUnit,
                  division: filter.division,
                  cluster: filter.cluster,
                  plant: filter.plant,
                  quickRange: filter.quickRange,
                  fromDate: filter.fromDate,
                  toDate: filter.toDate,
                }).pipe(
                  switchMap((saved) => filter.isFavorite
                    ? this.savedFilterService.setFavorite(cloneId, saved.id, true)
                    : of(saved)),
                )),
                toArray(),
                map(() => created),
                catchError(() => {
                  throw new Error(`Dashboard '${created.data.dashboardName}' was created, but its saved filters could not be fully copied.`);
                }),
              );
            }),
          )),
        );
      }),
    );
  }

  /** Update an existing dashboard (PUT /api/dashboard/:id). */
  updateDashboard(dashboardId: number, request: SaveDashboardRequest): Observable<ApiResponse<UpdateDashboardResponse>> {
    return this.api.put<UpdateDashboardResponse>(`${this.path}/${dashboardId}`, request).pipe(
      tap(() => this.refreshWip()),
    );
  }

  /** Soft delete a dashboard (DELETE /api/dashboard/:id). */
  deleteDashboard(dashboardId: number): Observable<ApiResponse<void>> {
    return this.api.delete<void>(`${this.path}/${dashboardId}`).pipe(
      tap(() => {
        this.refreshWip();
        this.refreshPublished();
        this.refreshShared();
      }),
    );
  }

  /** Publish a dashboard (POST /api/dashboard/:id/publish). */
  publishDashboard(dashboardId: number): Observable<ApiResponse<PublishDashboardResponse>> {
    return this.api.post<PublishDashboardResponse>(`${this.path}/${dashboardId}/publish`, {}).pipe(
      tap(() => {
        this.refreshWip();
        this.refreshPublished();
        // Also refresh the "shared with me" cache - a dashboard shared with another
        // admin still shows in their WIP > Shared tab with the stale Draft status
        // otherwise, until a full page reload re-fetches shared-with-me.
        this.refreshShared();
      }),
    );
  }

  /** Move a published dashboard back to Draft. */
  unpublishDashboard(dashboardId: number): Observable<ApiResponse<PublishDashboardResponse>> {
    return this.api.post<PublishDashboardResponse>(`${this.path}/${dashboardId}/unpublish`, {}).pipe(
      tap(() => {
        this.refreshWip();
        this.refreshPublished();
        this.refreshShared();
      }),
    );
  }

  /** Mark a dashboard as completed (POST /api/dashboard/:id/complete). */
  completeDashboard(dashboardId: number): Observable<ApiResponse<CompleteDashboardResponse>> {
    return this.api.post<CompleteDashboardResponse>(`${this.path}/${dashboardId}/complete`, {}).pipe(
      tap(() => {
        this.refreshWip();
        this.refreshPublished();
        this.refreshShared();
      }),
    );
  }

  /** Move a Completed dashboard back to Draft (POST /api/dashboard/:id/reopen). */
  reopenDashboard(dashboardId: number): Observable<ApiResponse<ReopenDashboardResponse>> {
    return this.api.post<ReopenDashboardResponse>(`${this.path}/${dashboardId}/reopen`, {}).pipe(
      tap(() => {
        this.refreshWip();
        this.refreshShared();
      }),
    );
  }

  /** Copy a published dashboard into a new Draft dashboard (POST /api/dashboard/:id/copy-to-draft). */
  copyDashboardToDraft(dashboardId: number): Observable<ApiResponse<CreateDashboardResponse>> {
    return this.api.post<CreateDashboardResponse>(`${this.path}/${dashboardId}/copy-to-draft`, {}).pipe(
      tap(() => this.refreshWip()),
    );
  }

  /** Generate a new external-share token for a dashboard. */
  createShareLink(dashboardId: number): Observable<ApiResponse<DashboardShareLinkResponse>> {
    return this.api.post<DashboardShareLinkResponse>(`${this.path}/${dashboardId}/share-link`, {});
  }

  /** Share a dashboard internally with specific tenant users (POST /api/dashboard/:id/share-internal). */
  shareDashboardInternally(dashboardId: number, userIds: number[]): Observable<ApiResponse<ShareDashboardInternallyResponse>> {
    return this.api.post<ShareDashboardInternallyResponse>(`${this.path}/${dashboardId}/share-internal`, { userIds });
  }

  /** Toggle active state of a published dashboard (PATCH /api/dashboard/:id/toggle-active). */
  toggleDashboardActive(dashboardId: number): Observable<ApiResponse<ToggleDashboardActiveResponse>> {
    return this.api.patch<ToggleDashboardActiveResponse>(`${this.path}/${dashboardId}/toggle-active`, {}).pipe(
      // Unpublishing here also archives the version and spawns/reuses a WIP draft,
      // so both cached lists need to be refreshed, not just Published.
      tap(() => {
        this.refreshPublished();
        this.refreshWip();
        this.refreshShared();
      }),
    );
  }

  // ─── Cache Refresh ───────────────────────────────────────────────────────────

  /** Force-refresh WIP dashboards from backend. */
  refreshWip(): void {
    this.loadWipDashboards().subscribe({
      error: () => { this.wipLoading = false; },
    });
  }

  /** Force-refresh Published dashboards from backend. */
  refreshPublished(): void {
    this.loadPublishedDashboards().subscribe({
      error: () => { this.publishedLoading = false; },
    });
  }

  /** Force-refresh "shared with me" dashboards from backend. */
  refreshShared(): void {
    this.loadSharedWithMeDashboards().subscribe({
      error: () => { this.sharedLoading = false; },
    });
  }
}

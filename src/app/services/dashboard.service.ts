import { environment } from '../../environments/environment';
﻿import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface HfbFilter {
  cluster?: string;
  site?: string;
  location?: string;
  project?: string;
  wellId?: string;
  startDate?: string;
  endDate?: string;
}
import { map } from 'rxjs/operators';

export interface CrewsDeployedKpi {
  totalCrews: number;
  deployed: number;
  restRotation: number;
  utilizationPct: number;
}

export interface ActiveWellsKpi {
  activeToday: number;
  totalThisMonth: number;
  inProgress: number;
  early: number;
  planned: number;
  onHold: number;
  dueWells: number;
  notDueWells: number;
  critical?: number;
  atRisk?: number;
  completed?: number;
  bonusPotential?: number;
  highPerformers?: number;
}

export interface KpiTiles {
  totalWells: number;
  activeWells: number;
  inactiveWells: number;
  completedWells: number;
  dueWellsCompleted: number;
  nonDueWellsCompleted: number;
  penaltyExposure: number;
  bonusPotential: number;
}

export interface ActivitiesProgress {
  progress: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

export interface CriticalDateTimelineItem {
  wellId: string;
  stageItem: string;
  assignee: string | null;
  dateLabel: string;
  dateType: 'Actual' | 'Forecast';
  type: string;
  status: 'Completed' | 'Overdue' | 'On Track';
  progressPct: number;
  varianceDays: number | null;
  blockers: string | null;
  predecessor: string | null;
}

export interface CriticalDatesTimelinePage {
  items: CriticalDateTimelineItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface TargetFinishTimelineItem {
  wellId: string;
  wellName: string | null;
  cluster: string;
  wellType: string;
  category: string;
  progressPct: number;
  targetFinishDate: string | null;   // ISO yyyy-MM-dd
  daysRemaining: number | null;       // negative = overdue
  timelineStatus: string;             // Overdue | Due Within 30 Days | Due In 31-60 Days | Due After 60 Days
}

export interface TargetFinishTimeline {
  items: TargetFinishTimelineItem[];
}

export interface ActivityRowDto {
  code: string;
  description: string;
  wellId: string;
  cluster: string;
  status: string;
  progressPct: number;
  startDate: string | null;
  endDate: string | null;
  assignee: string | null;
}

export interface ActivitiesListResponse {
  summary: ActivitiesProgress;
  items: ActivityRowDto[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface ClusterWellItem {
  id: string;
  wellName: string | null;
  wellType: string | null;
  site: string | null;
  project: string | null;
}

export interface ClusterWellTypeItem {
  wellType: string;
  projectIds: string[];
}

export interface ClusterSiteItem {
  site: string;
}

export interface ClusterProjectItem {
  project: string;
}

export interface ClusterWells {
  cluster: string;
  sites: ClusterSiteItem[];
  wellTypes: ClusterWellTypeItem[];
  projects: ClusterProjectItem[];
  wells: ClusterWellItem[];
}

export interface ClusterHealthItem {
  cluster:          string;
  wellCount:        number;
  healthPercentage: number;
  atRisk:           number;
  critical:         number;
  status:           'OnTrack' | 'AtRisk' | 'Critical';
  plannedPct:       number;
  actualPct:        number;
}

export interface ClusterHealth {
  totalClusters: number;
  atRisk:        number;
  critical:      number;
  clusters:      ClusterHealthItem[];
}

export interface ClusterWellProgressItem {
  wellId:    string;
  wellName:  string | null;
  progress:  number;
  wellType:  string | null;
}

export interface ClusterWellsProgress {
  cluster: string;
  wells:   ClusterWellProgressItem[];
}

// ── Crew PI Rating Heatmap ──────────────────────────────────────────────────
export interface CrewPiKpis {
  totalCrews: number;
  avgRating:  string;
  avgDelta:   string;
  topCrew:    string;
  topRating:  string;
  lowCrew:    string;
  lowRating:  string;
  belowP3:    number;
  belowP3Pct: number;
}
export interface CrewPiRow {
  crew: string;
  avg:  number;
  vals: (number | null)[];   // null = no data for that crew in that period
}
export interface CrewPiDistribution {
  range: string;
  count: number;
  pct:   number;
  color: string;
}
export interface CrewPiPeriod {
  columns:      string[];
  rows:         CrewPiRow[];
  distribution: CrewPiDistribution[];
}
export interface CrewPiHeatmapResponse {
  kpis:     CrewPiKpis;
  day:      CrewPiPeriod;
  week:     CrewPiPeriod;
  month:    CrewPiPeriod;
  insights: string[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {

  private readonly baseUrl = environment.apiBaseUrl + '/api/v1/wells/dashboard';

  private readonly _filter = new BehaviorSubject<HfbFilter>({});
  readonly filter$ = this._filter.asObservable();

  // Source of truth for filter state. Components should read from this rather than
  // window.hfbState, which is pre-seeded with default month-start/today dates and
  // makes it impossible to tell user-selected dates apart from defaults.
  get currentFilter(): HfbFilter {
    return this._filter.value;
  }

  setFilter(patch: Partial<HfbFilter>): void {
    this._cache.clear();
    this._filter.next({ ...this._filter.value, ...patch });
  }

  resetFilter(): void {
    this._cache.clear();
    this._filter.next({});
  }

  getCurrentFilter(): HfbFilter {
    return this._filter.value;
  }

  // ── In-memory response cache (TTL = 30 min) ───────────────────────────────
  private readonly _cache = new Map<string, { data: unknown; expires: number }>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  private cachedGet<T>(url: string, params: HttpParams, ttl = this.CACHE_TTL): Observable<T> {
    const key = `${url}?${params.toString()}`;
    const entry = this._cache.get(key);
    if (entry && Date.now() < entry.expires) {
      return of(entry.data as T);
    }
    return this.http.get<T>(url, { params }).pipe(
      tap(data => this._cache.set(key, { data, expires: Date.now() + ttl }))
    );
  }

  /** Invalidate all cached entries (call after filter change if fresh data is required). */
  clearCache(): void {
    this._cache.clear();
  }

  constructor(private readonly http: HttpClient) {}

  getActivitiesProgress(filters?: {
    odc?: string;
    cluster?: string;
    wellId?: string;
    projectId?: string;
    scheduleId?: string;
    startDate?: string;
    endDate?: string;
  }): Observable<ActivitiesProgress> {
    let params = new HttpParams();
    if (filters?.odc) params = params.set('odc', filters.odc);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.projectId) params = params.set('projectId', filters.projectId);
    if (filters?.scheduleId) params = params.set('scheduleId', filters.scheduleId);
    if (filters?.startDate) params = params.set('startDate', filters.startDate);
    if (filters?.endDate) params = params.set('endDate', filters.endDate);

    return this.cachedGet<{ data: ActivitiesProgress }>(`${this.baseUrl}/activities-progress`, params)
      .pipe(map(res => res.data));
  }

  getCrewsDeployed(filters?: {
    crewGroup?: string;
    cluster?: string;
    wellId?: string;
    from?: string;
    to?: string;
  }): Observable<CrewsDeployedKpi> {
    let params = new HttpParams();
    if (filters?.crewGroup) params = params.set('crewGroup', filters.crewGroup);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);

    return this.cachedGet<CrewsDeployedKpi>(`${this.baseUrl}/crews-deployed`, params);
  }

  getActiveWells(filters?: {
    cluster?: string;
    site?: string;
    wellType?: string;
    project?: string;
    wellId?: string;
    from?: string;
    to?: string;
    thisMonth?: boolean;
  }): Observable<ActiveWellsKpi> {
    let params = new HttpParams();
    if (filters?.cluster)   params = params.set('cluster',   filters.cluster);
    if (filters?.site)      params = params.set('site',      filters.site);
    if (filters?.wellType)  params = params.set('wellType',  filters.wellType);
    if (filters?.project)   params = params.set('project',   filters.project);
    if (filters?.wellId)    params = params.set('wellId',    filters.wellId);
    if (filters?.from)      params = params.set('from',      filters.from);
    if (filters?.to)        params = params.set('to',        filters.to);
    if (filters?.thisMonth) params = params.set('thisMonth', 'true');

    return this.cachedGet<ActiveWellsKpi>(`${this.baseUrl}/active-wells`, params);
  }

  getKpiTiles(filters?: {
    cluster?: string;
    site?: string;
    wellType?: string;
    project?: string;
    from?: string;
    to?: string;
  }): Observable<KpiTiles> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<KpiTiles>(`${this.baseUrl}/kpi-tiles`, params);
  }

  getWellsList(filters?: {
    cluster?: string;
    wellId?: string;
    status?: string;
    thisMonth?: boolean;
    from?: string;
    to?: string;
    wrFilter?: string;
    planYear?: number;
    asOfDate?: string;
    commStatus?: string;
    project?: string;
  }): Observable<WmrWell[]> {
    let params = new HttpParams();
    if (filters?.cluster)   params = params.set('cluster', filters.cluster);
    if (filters?.wellId)    params = params.set('wellId', filters.wellId);
    if (filters?.status)    params = params.set('status', filters.status);
    if (filters?.thisMonth) params = params.set('thisMonth', 'true');
    if (filters?.from)      params = params.set('from', filters.from);
    if (filters?.to)        params = params.set('to', filters.to);
    if (filters?.wrFilter)  params = params.set('wrFilter', filters.wrFilter);
    if (filters?.planYear)  params = params.set('planYear', String(filters.planYear));
    if (filters?.asOfDate)  params = params.set('asOfDate', filters.asOfDate);
    if (filters?.commStatus) params = params.set('commStatus', filters.commStatus);
    if (filters?.project)   params = params.set('project', filters.project);
    return this.cachedGet<WmrWell[]>(`${this.baseUrl}/wells-list`, params);
  }

  getWellsReadinessOverview(filters?: {
    cluster?: string;
    wellId?: string;
    status?: string;
    thisMonth?: boolean;
    from?: string;
    to?: string;
    wrFilter?: string;
    planYear?: number;
    asOfDate?: string;
    page?: number;
    pageSize?: number;
    project?: string;
    site?: string;
    wellType?: string;
  }): Observable<WmrWellsPage> {
    let params = new HttpParams();
    if (filters?.cluster)   params = params.set('cluster', filters.cluster);
    if (filters?.wellId)    params = params.set('wellId', filters.wellId);
    if (filters?.status)    params = params.set('status', filters.status);
    if (filters?.thisMonth) params = params.set('thisMonth', 'true');
    if (filters?.from)      params = params.set('from', filters.from);
    if (filters?.to)        params = params.set('to', filters.to);
    if (filters?.wrFilter)  params = params.set('wrFilter', filters.wrFilter);
    if (filters?.planYear)  params = params.set('planYear', String(filters.planYear));
    if (filters?.asOfDate)  params = params.set('asOfDate', filters.asOfDate);
    if (filters?.page)      params = params.set('page', String(filters.page));
    if (filters?.pageSize)  params = params.set('pageSize', String(filters.pageSize));
    if (filters?.project)   params = params.set('project', filters.project);
    if (filters?.site)      params = params.set('site', filters.site);
    if (filters?.wellType)  params = params.set('wellType', filters.wellType);
    return this.cachedGet<WmrWellsPage>(`${this.baseUrl}/wells-readiness-overview`, params);
  }

  getWellStatusList(filters?: {
    cluster?: string;
    site?: string;
    wellType?: string;
    project?: string;
    from?: string;
    to?: string;
    commStatus?: string;
    commFrom?: string;
    commTo?: string;
    bufferReady?: boolean;
    peggingBucket?: string;
    wlaMode?: boolean;
  }): Observable<WellStatusItem[]> {
    let params = new HttpParams();
    if (filters?.cluster)       params = params.set('cluster',       filters.cluster);
    if (filters?.site)          params = params.set('site',          filters.site);
    if (filters?.wellType)      params = params.set('wellType',      filters.wellType);
    if (filters?.project)       params = params.set('project',       filters.project);
    if (filters?.from)          params = params.set('from',          filters.from);
    if (filters?.to)            params = params.set('to',            filters.to);
    if (filters?.commStatus)    params = params.set('commStatus',    filters.commStatus);
    if (filters?.commFrom)      params = params.set('commFrom',      filters.commFrom);
    if (filters?.commTo)        params = params.set('commTo',        filters.commTo);
    if (filters?.bufferReady)   params = params.set('bufferReady',   'true');
    if (filters?.peggingBucket) params = params.set('peggingBucket', filters.peggingBucket);
    if (filters?.wlaMode)       params = params.set('wlaMode',       'true');
    return this.cachedGet<WellStatusItem[]>(`${this.baseUrl}/wells-status-list`, params);
  }

  getWellProgress(filters?: {
    cluster?: string;
    wellId?: string;
    status?: string;
    thisMonth?: boolean;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Observable<WellProgressPage> {
    let params = new HttpParams();
    if (filters?.cluster)   params = params.set('cluster', filters.cluster);
    if (filters?.wellId)    params = params.set('wellId', filters.wellId);
    if (filters?.status)    params = params.set('status', filters.status);
    if (filters?.thisMonth) params = params.set('thisMonth', 'true');
    if (filters?.from)      params = params.set('from', filters.from);
    if (filters?.to)        params = params.set('to', filters.to);
    params = params.set('page',     (filters?.page     ?? 1).toString());
    params = params.set('pageSize', (filters?.pageSize ?? 20).toString());
    return this.cachedGet<WellProgressPage>(`${this.baseUrl}/well-progress`, params);
  }

  getWellProgressKpi(filters?: { cluster?: string; wellId?: string; from?: string; to?: string }): Observable<WellProgressKpi> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId)  params = params.set('wellId',  filters.wellId);
    if (filters?.from)    params = params.set('from',    filters.from);
    if (filters?.to)      params = params.set('to',      filters.to);
    return this.cachedGet<WellProgressKpi>(`${this.baseUrl}/well-progress-kpi`, params);
  }

  getDrilledWellsCompletion(filters?: { cluster?: string; wellId?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): Observable<DrilledWellsCompletion> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DrilledWellsCompletion>(`${this.baseUrl}/drilled-wells-completion`, { params });
  }

  getDrilledWellsYtdCompletion(filters?: { cluster?: string; wellId?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): Observable<DrilledWellsYtdCompletion> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DrilledWellsYtdCompletion>(`${this.baseUrl}/drilled-wells-ytd-completion`, { params });
  }

  getDrilledWellsBreakdown(filters?: { cluster?: string; wellId?: string; project?: string; from?: string; to?: string }): Observable<DrilledWellsBreakdown> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId)  params = params.set('wellId',  filters.wellId);
    if (filters?.project) params = params.set('project', filters.project);
    if (filters?.from)    params = params.set('from',    filters.from);
    if (filters?.to)      params = params.set('to',      filters.to);
    return this.cachedGet<DrilledWellsBreakdown>(`${this.baseUrl}/drilled-wells-breakdown`, params);
  }

  getDueWellsCompletion(filters?: { cluster?: string; location?: string; site?: string; project?: string; wellId?: string; from?: string; to?: string }): Observable<DueWellsCompletion> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.location) params = params.set('location', filters.location);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DueWellsCompletion>(`${this.baseUrl}/due-wells-completion`, { params });
  }

  getDueWellsCompletionTrend(filters?: { cluster?: string; location?: string; site?: string; project?: string; wellId?: string; from?: string; to?: string }): Observable<DueWellsCompletionTrend> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.location) params = params.set('location', filters.location);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DueWellsCompletionTrend>(`${this.baseUrl}/due-wells-completion-trend`, { params });
  }

  getCriticalDatesTimeline(page = 1, pageSize = 100, from?: string, to?: string, cluster?: string, site?: string, wellId?: string, wellType?: string): Observable<CriticalDatesTimelinePage> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('pageSize', pageSize.toString());
    if (from)     params = params.set('from',     from);
    if (to)       params = params.set('to',       to);
    if (cluster)  params = params.set('cluster',  cluster);
    if (site)     params = params.set('site',     site);
    if (wellId)   params = params.set('wellId',   wellId);
    if (wellType) params = params.set('wellType', wellType);
    return this.cachedGet<CriticalDatesTimelinePage>(`${this.baseUrl}/critical-dates-timeline`, params);
  }

  getTargetFinishTimeline(filters?: { cluster?: string; site?: string; wellType?: string; wellId?: string; from?: string; to?: string; take?: number }): Observable<TargetFinishTimeline> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.take)     params = params.set('take',     String(filters.take));
    return this.cachedGet<TargetFinishTimeline>(`${this.baseUrl}/target-finish-timeline`, params);
  }

  getWorkloadAnalysis(filters?: { from?: string; to?: string; cluster?: string; wellId?: string; project?: string }): Observable<WorkloadAnalysisResponse> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<WorkloadAnalysisResponse>(`${this.baseUrl}/workload-analysis`, params);
  }

  getWellDetail(wellId: string): Observable<WellDetail> {
    return this.http.get<WellDetail>(`${this.baseUrl}/wells/${encodeURIComponent(wellId)}`);
  }

  getActivitiesList(filters?: {    odc?: string;
    cluster?: string;
    wellId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }): Observable<ActivitiesListResponse> {
    let params = new HttpParams();
    if (filters?.odc) params = params.set('odc', filters.odc);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.startDate) params = params.set('startDate', filters.startDate);
    if (filters?.endDate) params = params.set('endDate', filters.endDate);
    params = params.set('page', (filters?.page ?? 1).toString());
    params = params.set('pageSize', (filters?.pageSize ?? 50).toString());
    return this.cachedGet<ActivitiesListResponse>(`${this.baseUrl}/activities-list`, params);
  }

  
  getCrewPRatingDistribution(filters?: { cluster?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): Observable<CrewPRatingItem[]> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<CrewPRatingItem[]>(`${this.baseUrl}/crew-p-rating-distribution`, params);
  }

  /** Crew PI Rating heatmap (KPIs + Day/Week/Month grids + insights) for the well-execution page. */
  getCrewPiHeatmap(filters?: { cluster?: string; wellType?: string; wellId?: string; from?: string; to?: string }): Observable<CrewPiHeatmapResponse> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<CrewPiHeatmapResponse>(`${this.baseUrl}/crew-pi-heatmap`, params);
  }

  getClusterWells(): Observable<ClusterWells[]> {
    return this.http.get<ClusterWells[]>(`${this.baseUrl}/cluster-wells`);
  }

  getClusterHealth(filters?: { from?: string; to?: string; wellType?: string; cluster?: string; site?: string; project?: string }): Observable<ClusterHealth> {
    let params = new HttpParams();
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    return this.cachedGet<ClusterHealth>(`${this.baseUrl}/cluster-health`, params);
  }

  getClusterWellsProgress(from?: string, to?: string, wellType?: string, project?: string): Observable<ClusterWellsProgress[]> {
    let params = new HttpParams();
    if (from)    params = params.set('from',    from);
    if (to)      params = params.set('to',      to);
    if (wellType) params = params.set('wellType', wellType);
    if (project)  params = params.set('project',  project);
    return this.cachedGet<ClusterWellsProgress[]>(`${this.baseUrl}/cluster-wells-progress`, params);
  }

  getWellStages(wellId: string, from?: string, to?: string): Observable<WellStagesResponse> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.cachedGet<WellStagesResponse>(`${this.baseUrl}/well-stages/${encodeURIComponent(wellId)}`, params);
  }

  /** ActivityTaskPlan rows (type='A' OR type='M') for the Well Execution Activity Gantt. */
  getActivityGantt(): Observable<ActivityGanttRow[]> {
    return this.cachedGet<ActivityGanttRow[]>(`${this.baseUrl}/activity-gantt`, new HttpParams());
  }

  getWellsReadiness(filters?: { year?: number; cluster?: string; fromDate?: string; toDate?: string; wellType?: string; project?: string }): Observable<WellsReadiness> {
    let params = new HttpParams();
    if (filters?.year) params = params.set('year', filters.year.toString());
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params = params.set('toDate', filters.toDate);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<WellsReadiness>(`${this.baseUrl}/wells-readiness`, params);
  }

  /** Bulk endpoint: returns overall + per-type breakdown in a single call (avoids N+1 requests). */
  getWellsReadinessByType(filters: { fromDate: string; toDate: string; cluster?: string; project?: string }): Observable<WellsReadinessByType> {
    let params = new HttpParams()
      .set('fromDate', filters.fromDate)
      .set('toDate', filters.toDate);
    if (filters.cluster) params = params.set('cluster', filters.cluster);
    if (filters.project) params = params.set('project', filters.project);
    return this.cachedGet<WellsReadinessByType>(`${this.baseUrl}/wells-readiness-by-type`, params);
  }

  getCommissioningStatus(filters?: { cluster?: string; wellId?: string; from?: string; to?: string; project?: string }): Observable<CommissioningStatus> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.from) params = params.set('startDate', filters.from);
    if (filters?.to) params = params.set('endDate', filters.to);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<CommissioningStatus>(`${this.baseUrl}/commissioning-status`, params);
  }

  getBufferFlowlinesReady(filters?: { cluster?: string; wellId?: string; from?: string; to?: string; project?: string }): Observable<BufferFlowlinesReady> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.from) params = params.set('startDate', filters.from);
    if (filters?.to) params = params.set('endDate', filters.to);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<BufferFlowlinesReady>(`${this.baseUrl}/buffer-flowlines-ready`, params);
  }

  getConstructionProgress(filters?: { year?: number; asOfDate?: string; cluster?: string; wellType?: string; project?: string; from?: string; to?: string }): Observable<ConstructionProgressResponse> {
    let params = new HttpParams();
    if (filters?.year)     params = params.set('year', filters.year.toString());
    if (filters?.asOfDate) params = params.set('asOfDate', filters.asOfDate);
    if (filters?.cluster)  params = params.set('cluster', filters.cluster);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project', filters.project);
    if (filters?.from)     params = params.set('fromDate', filters.from);
    if (filters?.to)       params = params.set('toDate', filters.to);
    return this.cachedGet<ConstructionProgressResponse>(`${this.baseUrl}/construction-progress`, params);
  }

  getConstructionProgressWells(filters?: {
    filter?: string;
    year?: number;
    asOfDate?: string;
    cluster?: string;
    wellId?: string;
    page?: number;
    pageSize?: number;
    fromDate?: string;
    toDate?: string;
    wellType?: string;
    project?: string;
  }): Observable<WmrWellsPage> {
    let params = new HttpParams();
    if (filters?.filter)   params = params.set('filter', filters.filter);
    if (filters?.year)     params = params.set('year', filters.year.toString());
    if (filters?.asOfDate) params = params.set('asOfDate', filters.asOfDate);
    if (filters?.cluster)  params = params.set('cluster', filters.cluster);
    if (filters?.wellId)   params = params.set('wellId', filters.wellId);
    if (filters?.page)     params = params.set('page', String(filters.page));
    if (filters?.pageSize) params = params.set('pageSize', String(filters.pageSize));
    if (filters?.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters?.toDate)   params = params.set('toDate', filters.toDate);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project', filters.project);
    return this.http.get<WmrWellsPage>(`${this.baseUrl}/construction-progress-wells`, { params });
  }

  getFlowlineReadiness(filters?: { year?: number; cluster?: string; wellId?: string; fromDate?: string; toDate?: string; project?: string }): Observable<FlowlineReadinessResponse> {
    let params = new HttpParams();
    if (filters?.year) params = params.set('year', filters.year.toString());
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params = params.set('toDate', filters.toDate);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<FlowlineReadinessResponse>(`${this.baseUrl}/flowline-readiness`, params);
  }

  getOhlReadiness(filters?: { year?: number; cluster?: string; fromDate?: string; toDate?: string; project?: string }): Observable<OhlReadinessResponse> {
    let params = new HttpParams();
    if (filters?.year) params = params.set('year', filters.year.toString());
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params = params.set('toDate', filters.toDate);
    if (filters?.project) params = params.set('project', filters.project);
    return this.cachedGet<OhlReadinessResponse>(`${this.baseUrl}/ohl-readiness`, params);
  }

  getCommissioningProgress(filters?: { fiscalYear?: number; asOfDate?: string }): Observable<CommissioningProgressResponse> {
    let params = new HttpParams();
    if (filters?.fiscalYear) params = params.set('fiscalYear', filters.fiscalYear.toString());
    if (filters?.asOfDate)   params = params.set('asOfDate',   filters.asOfDate);
    return this.cachedGet<CommissioningProgressResponse>(`${this.baseUrl}/commissioning-progress`, params);
  }

  getDailyOutputRate(filters?: { cluster?: string; site?: string; wellId?: string; location?: string; project?: string; from?: string; to?: string }): Observable<DailyOutputRate> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.location) params = params.set('location', filters.location);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<DailyOutputRate>(`${this.baseUrl}/daily-output-rate`, params);
  }

  getBufferLocationProgress(filters?: { year?: number; asOfDate?: string; cluster?: string; project?: string; fromDate?: string; toDate?: string }): Observable<BufferLocationProgressResponse> {
    let params = new HttpParams();
    if (filters?.year)    params = params.set('year',    filters.year.toString());
    if (filters?.asOfDate) params = params.set('asOfDate', filters.asOfDate);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.project) params = params.set('project', filters.project);
    if (filters?.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters?.toDate)   params = params.set('toDate', filters.toDate);
    return this.cachedGet<BufferLocationProgressResponse>(`${this.baseUrl}/buffer-location-progress`, params);
  }

  getPeggingStatus(filters?: { year?: number; cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): Observable<PeggingStatusResponse> {
    let params = new HttpParams();
    if (filters?.year)     params = params.set('year', filters.year.toString());
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    return this.cachedGet<PeggingStatusResponse>(`${this.baseUrl}/pegging-status`, params);
  }

  /** Overall Pegging Status pie — wells with completed pegging split by <90d / >90d before rig-on. */
  getOverallPeggingStatus(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): Observable<OverallPeggingStatus> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    return this.cachedGet<OverallPeggingStatus>(`${this.baseUrl}/overall-pegging-status`, params);
  }

  /** Well Delivery Cycle Time — rig-on → delivery KPIs, monthly trend, and phase breakdown. */
  getWellDeliveryCycleTime(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; from?: string; to?: string }): Observable<WellDeliveryCycleTime> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<WellDeliveryCycleTime>(`${this.baseUrl}/well-delivery-cycle-time`, params);
  }

  getFlafStatus(filters?: { year?: number; cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): Observable<FlafStatusResponse> {
    let params = new HttpParams();
    if (filters?.year)      params = params.set('year', filters.year.toString());
    if (filters?.cluster)   params = params.set('cluster', filters.cluster);
    if (filters?.site)      params = params.set('site', filters.site);
    if (filters?.project)   params = params.set('project', filters.project);
    if (filters?.wellType)  params = params.set('wellType', filters.wellType);
    if (filters?.wellId)    params = params.set('wellId', filters.wellId);
    return this.cachedGet<FlafStatusResponse>(`${this.baseUrl}/flaf-status`, params);
  }

  getWellExecKpi(filters?: { cluster?: string; wellType?: string; period?: string; from?: string; to?: string; wellId?: string; chartOnly?: boolean }): Observable<WellExecKpiDto> {
    let params = new HttpParams();
    if (filters?.cluster)   params = params.set('cluster',   filters.cluster);
    if (filters?.wellType)  params = params.set('wellType',  filters.wellType);
    if (filters?.period)    params = params.set('period',    filters.period);
    if (filters?.from)      params = params.set('from',      filters.from);
    if (filters?.to)        params = params.set('to',        filters.to);
    if (filters?.wellId)    params = params.set('wellId',    filters.wellId);
    if (filters?.chartOnly) params = params.set('chartOnly', 'true');
    return this.cachedGet<WellExecKpiDto>(`${this.baseUrl}/well-execution-kpi`, params, 15 * 60 * 1000);
  }

  getHookupProgress(filters?: { wellType?: string; cluster?: string; site?: string; location?: string; project?: string; from?: string; to?: string }): Observable<HookupProgressResponse> {
    let params = new HttpParams();
    if (filters?.wellType)  params = params.set('wellType',  filters.wellType!);
    if (filters?.cluster)   params = params.set('cluster',   filters.cluster!);
    if (filters?.site)      params = params.set('site',      filters.site!);
    if (filters?.location)  params = params.set('location',  filters.location!);
    if (filters?.project)   params = params.set('project',   filters.project!);
    if (filters?.from)      params = params.set('from',      filters.from!);
    if (filters?.to)        params = params.set('to',        filters.to!);
    return this.cachedGet<HookupProgressResponse>(`${this.baseUrl}/hookup-progress`, params);
  }

  getOdcOverallStatus(filters?: { cluster?: string; site?: string; wellType?: string; project?: string; from?: string; to?: string }): Observable<OdcOverallStatus> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    return this.http.get<OdcOverallStatus>(`${this.baseUrl}/odc-overall-status`, { params });
  }

  getWellHookupKpi(filters?: { cluster?: string; from?: string; to?: string }): Observable<WellHookupKpi> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<WellHookupKpi>(`${this.baseUrl}/well-hookup-kpi`, params);
  }

  getNsHookupWaterfall(filters?: { cluster?: string; from?: string; to?: string }): Observable<NsHookupWaterfall> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.from)    params = params.set('from',    filters.from);
    if (filters?.to)      params = params.set('to',      filters.to);
    return this.cachedGet<NsHookupWaterfall>(`${this.baseUrl}/ns-hookup-waterfall`, params);
  }

  getNsHookupCompletion(filters?: { cluster?: string; from?: string; to?: string }): Observable<NsHookupCompletion> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.from)    params = params.set('from',    filters.from);
    if (filters?.to)      params = params.set('to',      filters.to);
    return this.cachedGet<NsHookupCompletion>(`${this.baseUrl}/ns-hookup-completion`, params);
  }

  getNsHookupBreakdown(filters?: { cluster?: string; from?: string; to?: string }): Observable<NsHookupBreakdown> {
    let params = new HttpParams();
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.from)    params = params.set('from',    filters.from);
    if (filters?.to)      params = params.set('to',      filters.to);
    return this.cachedGet<NsHookupBreakdown>(`${this.baseUrl}/ns-hookup-breakdown`, params);
  }

  getOdcWellStatusList(filters?: { cluster?: string; site?: string; wellType?: string; project?: string; from?: string; to?: string }): Observable<OdcWellStatusItem[]> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    return this.cachedGet<OdcWellStatusItem[]>(`${this.baseUrl}/odc-wells-status-list`, params);
  }

  /** Hookup Wells List — uses WellMonitoringReport_Latest with the same project-type scoping
   *  as /hookup-progress, so row counts always match the KPI tile numbers. */
  getHookupWellsList(filters?: { wellType?: string; cluster?: string; site?: string; project?: string; from?: string; to?: string }): Observable<OdcWellStatusItem[]> {
    let params = new HttpParams();
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.cachedGet<OdcWellStatusItem[]>(`${this.baseUrl}/hookup-wells-list`, params);
  }

  getDrilledWellsList(filters?: { cluster?: string; wellId?: string; wellType?: string; from?: string; to?: string }): Observable<DrilledWellListItem[]> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DrilledWellListItem[]>(`${this.baseUrl}/drilled-wells-list`, { params });
  }

  getDueWellsList(filters?: { cluster?: string; wellId?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): Observable<DrilledWellListItem[]> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<DrilledWellListItem[]>(`${this.baseUrl}/due-wells-list`, { params });
  }

  getCmdReadinessKpi(filters?: {
    from?: string; to?: string; cluster?: string; site?: string;
    wellType?: string; project?: string; wellId?: string;
  }): Observable<CmdReadinessKpi> {
    let params = new HttpParams();
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    return this.cachedGet<CmdReadinessKpi>(`${this.baseUrl}/cmd-readiness-kpi`, params);
  }

  getCmdReadinessKpiWells(filters?: {
    category?: string; from?: string; to?: string; cluster?: string; site?: string;
    wellType?: string; project?: string; wellId?: string; page?: number; pageSize?: number;
  }): Observable<WmrWellsPage> {
    let params = new HttpParams();
    if (filters?.category) params = params.set('category', filters.category);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.wellId)   params = params.set('wellId',   filters.wellId);
    if (filters?.page)     params = params.set('page',     String(filters.page));
    if (filters?.pageSize) params = params.set('pageSize', String(filters.pageSize));
    return this.cachedGet<WmrWellsPage>(`${this.baseUrl}/cmd-readiness-kpi-wells`, params);
  }

  getCmdReadinessKpiActivities(filters?: {
    category?: string; from?: string; to?: string; cluster?: string; site?: string;
    wellType?: string; project?: string; page?: number; pageSize?: number;
  }): Observable<ActivityDrilldownPage> {
    let params = new HttpParams();
    if (filters?.category) params = params.set('category', filters.category);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.page)     params = params.set('page',     String(filters.page));
    if (filters?.pageSize) params = params.set('pageSize', String(filters.pageSize));
    return this.cachedGet<ActivityDrilldownPage>(`${this.baseUrl}/cmd-readiness-kpi-activities`, params);
  }
}

export interface OdcOverallStatus {
  totalWells: number;
  totalDrilled: number;
  hookUpCompleted: number;
  dueWells: number;
  notDueWells: number;
  drilledNotCompleted: number;
  wellsAccelerated: number;
  backlogWells: number;
  bufferWells: number;
  dueWellsCompleted: number;
  suspendedWells: number;
  pdoIssues: number;
  readyForCommissioning: number;
}

export interface OdcWellStatusItem {
  wellId: string;
  wellName: string | null;
  status: string;
  field: string | null;
  rig: string | null;
  progressPct: number;
  plannedPct: number | null;
  variance: number | null;
  ratePerDay: number | null;
  askRate: number;
  gapPerDay: number | null;
  spi: number | null;
  cpi: number | null;
  wellType: string | null;
  odcCategory: string;
  locPrepStatus: string | null;
  drillingPct: number;
  commStatus: string | null;
  constrStatus: string | null;
  constrPct: number;
  commProgress: number;
  rigBy: string | null;
  rigTo: string | null;
  // Independent category flags — match odc-overall-status CTE logic; can overlap
  isHookup: boolean;
  isSuspended: boolean;
  isDue: boolean;
  isNotDue: boolean;
  isDnc: boolean;
  isDueCompleted: boolean;
  isAccelerated: boolean;
}

/** Individual well row returned by /dashboard/drilled-wells-list.
 *  Uses the same date/filter logic as the drilled-wells-completion KPI tiles. */
export interface DrilledWellListItem {
  wellId: string;
  wellName: string | null;
  status: string;           // COMPLETED | ACTIVE | PLANNED
  field: string | null;
  rig: string | null;
  wellType: string | null;
  progressPct: number;      // 0–100
  plannedPct: number | null;
  variance: number | null;
  spi: number | null;
  cpi: number | null;
  dwcCategory: string;      // completed | inprogress | pending
  odcCategory: string;
  locPrepStatus: string | null;
  drillingPct: number;
  commStatus: string | null;
  constrStatus: string | null;
  constrPct: number;
  commProgress: number;
  rigBy: string | null;
  rigTo: string | null;
}

export interface CrewPRatingItem {
  rating: string;
  crewCount: number;
}

export interface DailyOutputRatePoint {
  date:       string;
  actualRate: number;
  askingRate: number;
}

export interface DailyOutputRate {
  points:   DailyOutputRatePoint[];
  subtitle: string;
}

export interface WellStageItem {
  stageName:    string;
  progress:     number;
  stageType:    string;
  targetStart?: string | null;   // ISO yyyy-MM-dd
  targetEnd?:   string | null;
  actualStart?: string | null;
  actualEnd?:   string | null;
  code?:        string | null;
}

export interface WellStagesResponse {
  wellId:  string;
  stages:  WellStageItem[];
}

/** One ActivityTaskPlan row (type 'A' or 'M') for the Activity Gantt. */
export interface ActivityGanttRow {
  wellId:      string;
  code:        string;
  text:        string;
  type:        string;          // 'A' | 'M'
  targetStart: string | null;   // ISO yyyy-MM-dd
  targetEnd:   string | null;
  actualStart: string | null;
  actualEnd:   string | null;
  progress:    number;          // 0..1
}

export interface WorkloadAssetItem {
  name: string;
  wellsCompleted: number;
}

export interface WorkloadMonthItem {
  label: string;
  isForecast: boolean;
  assets: WorkloadAssetItem[];
  totalDrilled: number;
}

export interface WorkloadMetadata {
  from: string;
  to: string;
  generatedAt: string;
  totalMonths: number;
  assets: string[];
}

export interface WorkloadSummary {
  averagePerAsset: Record<string, number>;
  averageTotalDrilled: number;
  grandTotalDrilled: number;
}

export interface WorkloadAnalysisResponse {
  metadata: WorkloadMetadata;
  months: WorkloadMonthItem[];
  summary: WorkloadSummary;
}

export interface WellProgressPage {
  items: WellProgress[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface WellProgressKpi {
  ahead: number;
  onTrack: number;
  atRisk: number;
  dueWells: number;
  total: number;
  critical: number;
  bonusPotential: number;
}

export interface DrilledWellsMonthlyPoint {
  month: string;
  cumulativePct: number;
  cumulativeCompleted: number;
}

export interface DrilledWellsCompletion {
  totalWells: number;
  completed: number;
  hold: number;
  inProgress: number;
  suspended: number;
  completionRatePct: number;
  monthlyTrend: DrilledWellsMonthlyPoint[];
}

export interface DrilledWellsYtdCompletion {
  currentYear: number;
  currentPct: number;
  previousYear: number;
  previousPct: number;
  deltaPct: number;
  totalDrilled: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export interface DrilledWellsBreakdown {
  backlogWells: number;
  acceleratedWells: number;
}

export interface DueWellsMonthlyPoint {
  month: string;
  cumulativePct: number;
}

export interface DueWellsCompletionTrendPoint {
  month: string;
  completedThisMonth: number;
  cumulativeRate: number;
}

export interface DueWellsCompletionTrend {
  totalDueWells: number;
  totalCompleted: number;
  points: DueWellsCompletionTrendPoint[];
}

export interface DueWellsCompletion {
  totalDueWells: number;
  completed: number;
  inProgress: number;
  pending: number;
  completionRatePct: number;
  commissioned: number;
  backlogInCommissioning: number;
  suspendedWells: number;
  totalWellsForBreakdown: number;
  commissioningPct: number;
  monthlyTrend: DueWellsMonthlyPoint[];
}

export interface WellProgress {
  wellId: string;
  cluster: string;
  currentActivity: string | null;
  crewGroup: string | null;
  progress: number;
  variance: number;
  planned: number;
  rate: number | null;
  askRate: number | null;
  gapPerDay: number | null;
  rigOn: string | null;
  spi: number | null;
  cpi: number | null;
  status: string;
}

export interface WmrWell {
  wellId: string;
  field: string | null;
  rig: string | null;
  location: string | null;
  wellType: string | null;
  progressPct: number;
  status: string;
  locPrepStatus: string | null;
  flStatus: string | null;
  commStatus: string | null;
  locPrepPct: number | null;
  flConstructionPct: number | null;
  commPct: number | null;
  ohlPct: number | null;
  rigOnDate: string | null;
  rigOffDate: string | null;
  pdoIssue?: boolean;
  drilledNotCompleted?: boolean;
  flafScr?: boolean;
  plannedPct?: number | null;
  spi?: number | null;
  ratePerDay?: number | null;
  askRate?: number | null;
  drillingBufferStatus?: string | null;
  wellCategory?: string | null;
  locationPoNo?: string | null;
  actualPeggedDate?: string | null;
  flafIssueDate?: string | null;
  flowLinePoNo?: string | null;
  submittedCount?: number | null;
}

export interface WmrWellsPage {
  items: WmrWell[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ActivityDrilldownRow {
  activityCode: string;
  wellId: string;
  activityName: string;
  status: string;
  actualStart: string;
  actualEnd: string;
  targetStart: string;
  targetEnd: string;
  quantity: number;
  progress: number;
  duration: number;
  crewType: string;
  cluster: string;
  project: string;
  committedStart: string;
  committedEnd: string;
}

export interface ActivityDrilldownPage {
  activities: ActivityDrilldownRow[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface WellStatusItem {
  wellId: string;
  wellName: string | null;
  status: string;
  field: string | null;
  rig: string | null;
  progressPct: number;
  plannedPct: number | null;
  variance: number | null;
  ratePerDay: number | null;
  askRate: number;
  gapPerDay: number | null;
  spi: number | null;
  cpi: number | null;
  tags: string | null;
  wellType: string | null;
  locPrepStatus: string | null;
  drillingPct: number | null;
  commStatus: string | null;
  constrStatus: string | null;
  constrPct: number | null;
  complePct: number | null;
  rigBy: string | null;
  rigTo: string | null;
  commStartDate: string | null;
  commFinishDate: string | null;
  commProgressPct: number | null;
  engCompletionDate: string | null;
  completionType: string | null;
  peggedDate: string | null;
  isActiveKpi: boolean;
  isInactiveKpi: boolean;
  isBonusPotential: boolean;
  isPenaltyExposure: boolean;
}

export interface WellDetail {
  wellId: string;
  wellName: string | null;
  rigNo: string | null;
  wellLocation: string | null;
  wellType: string | null;
  projectId: string | null;
  progressPct: number | null;
  plannedPct: number | null;
  status: string | null;
  sapPlannedStart: string | null;
  sapPlannedEnd: string | null;
  rigOnDate: string | null;
  rigOffDate: string | null;
  /** Completed wells only: "Due Completed" or "Not Due Accelerated". */
  completionCategory?: string | null;
  [key: string]: any;
}

// ─── Wells Readiness Overall Status ──────────────────────────────────────────

export interface WellsReadiness {
  asOfDate:            string;
  planYear:            number;
  originalPlan:        number;
  flafScrExcluded:     number;
  afterFlafScr:        number;
  pdoIssuesExcluded:   number;
  cleanTarget:         number;
  dueCompleted:        number;
  notDueAccelerated:   number;
  actualCompleted:     number;
  wellsAccelerated:    number;
  remaining:           number;
  atnmPerformancePct:  number;
  overallCompletionPct:number;
  ohlCompleted:        number;
}

export interface WellsReadinessTypeBreakdown {
  wellType:            string;
  originalPlan:        number;
  flafScrExcluded:     number;
  afterFlafScr:        number;
  cleanTarget:         number;
  actualCompleted:     number;
  remaining:           number;
  atnmPerformancePct:  number;
}

export interface WellsReadinessByType {
  overall: WellsReadiness;
  byType: WellsReadinessTypeBreakdown[];
}

export interface CommissioningStatus {
  totalReady:      number;
  commissioned:    number;
  notCommissioned: number;
  backlogInCommissioning: number;
  atRisk:          number;
  due:             number;
  suspendedWells:  number;
  readinessPct:    number;
  lastYearPct:     number | null;
  status:          string;
  asOfDate:        string;
}

export interface BufferFlowlineArea {
  area: string;
  count: number;
  pct: number;
}

export interface BufferFlowlinesReady {
  totalReady: number;
  status:     string;
  asOfDate:   string;
  areas:      BufferFlowlineArea[];
}

export interface ConstructionProgressKpi {
  planPdoRigSequence: number;
  planFlafScrAdjusted: number;
  planPdoIssuesRemoved: number;
  actualDueWellsCompleted: number;
  actualAcceleratedWells: number;
  backlogsAgainstPlan: number;
  totalCompleted: number;
}

export interface ConstructionProgressMonth {
  monthLabel: string;
  monthNum: number;
  isForecast: boolean;
  planPdoRigSequenceCumulative: number;
  planFlafScrAdjustedCumulative: number;
  planPdoIssuesRemovedCumulative: number;
  actualDueCompletedCumulative: number;
  actualNotDueAcceleratedCumulative: number;
  backlog: number;
}

export interface ConstructionProgressResponse {
  asOfDate: string;
  planYear: number;
  kpi: ConstructionProgressKpi;
  monthlyTrend: ConstructionProgressMonth[];
}

// ─── Flowline Readiness (Funnel Widget) ──────────────────────────────────────

export interface FlowlineReadinessResponse {
  asOfDate: string;
  planYear: number;
  totalWells: number;
  originalPlan: number;
  flafScrExcluded: number;
  afterFlafScr: number;
  pdoIssuesExcluded: number;
  afterPdoIssues: number;
  actualCompleted: number;
  backlog: number;
}

// ─── OHL Readiness (Funnel Widget) ───────────────────────────────────────────

export interface OhlReadinessResponse {
  asOfDate: string;
  planYear: number;
  totalWells: number;
  originalPlan: number;
  flafScrExcluded: number;
  afterFlafScr: number;
  pdoIssuesExcluded: number;
  afterPdoIssues: number;
  actualCompleted: number;
  backlog: number;
}

// ─── Commissioning Progress ───────────────────────────────────────────────────

export interface CommissioningProgressMonth {
  monthLabel:          string;
  monthNum:            number;
  isForecast:          boolean;
  actualCompletionPct: number;
  planTargetPct:       number;
}

export interface CommissioningProgressKpi {
  totalPlanned:      number;
  totalCommissioned: number;
  completionPct:     number;
  planTargetPct:     number;
}

export interface CommissioningProgressResponse {
  asOfDate:     string;
  fiscalYear:   number;
  kpi:          CommissioningProgressKpi;
  monthlyTrend: CommissioningProgressMonth[];
}

export interface BufferLocationProgressKpi {
  rigSequencePlan:    number;
  afterPeggingScr:    number;
  peggingScrExcluded: number;
  cleanTarget:        number;
  dueWellsCompleted:  number;
  actualCompleted:    number;
  accelerated:        number;
  backlog:            number;
  netAcceleration:    number;
  scheduleVariance:   number;
  overallPct:         number;
  atnmPct:            number;
}

export interface BufferLocationProgressResponse {
  asOfDate: string;
  planYear: number;
  kpi: BufferLocationProgressKpi;
}

// ─── Pegging Status ──────────────────────────────────────────────────────────

export interface PeggingStatusKpi {
  planRigSequence: number;
  actualIssued: number;
  peggingPerformancePct: number;
  peggingReadiness4mPct: number;
  trendVsPlanPct: number;
}

export interface PeggingBacklog {
  totalBacklog: number;
  atnmBacklog: number;
  atnmPct: number;
  pdoBacklog: number;
  pdoPct: number;
}

export interface PeggingRisk {
  projectedGap: number;
  riskLevel: string;
  gaugeMax: number;
}

export interface PeggingMonth {
  monthLabel: string;
  monthNum: number;
  isForecast: boolean;
  planCumulative: number;
  actualCumulative: number;
  backlogCumulative: number;
}

export interface PeggingStatusResponse {
  asOfDate: string;
  planYear: number;
  kpi: PeggingStatusKpi;
  backlog: PeggingBacklog;
  risk: PeggingRisk;
  monthlyTrend: PeggingMonth[];
}

// ─── Overall Pegging Status (pie: pegging completed <90d / >90d before rig-on) ──
export interface CycleTimeTrendPoint {
  month: string;
  avgDays: number;
  medianDays: number;
}
export interface CycleTimePhase {
  name: string;
  days: number;
  pct: number;
}
export interface WellDeliveryCycleTime {
  avgDays: number;
  avgDelta: number;
  avgDeltaPct: number;
  medianDays: number;
  medianDelta: number;
  medianDeltaPct: number;
  minDays: number;
  minWell: string | null;
  maxDays: number;
  maxWell: string | null;
  wellsCompleted: number;
  wellsDelta: number;
  trend: CycleTimeTrendPoint[];
  phases: CycleTimePhase[];
}

export interface OverallPeggingStatus {
  completedWithin90Days: number;
  completedAfter90Days:  number;
  total:                 number;
  /** Locations not yet pegged where scheduled rig-on is within 0–90 days (at risk). */
  notPeggedWithin90Days:      number;
  /** FLAFs not yet issued where scheduled rig-on is within 0–90 days (at risk). */
  flafPendingWithin90Days:    number;
  /** FLAFs issued but less than 90 days before scheduled rig-on (breach of lead-time rule). */
  flafIssuedLateWithin90Days: number;
}

// ─── FLAF Status (Construction Well Delivery) ─────────────────────────────────

export interface FlafStatusKpi {
  planFlafSubmissions: number;
  actualSubmitted: number;
  approvalRatePct: number;
  avgCycleTimeDays: number;
  flafBacklog: number;
}

export interface FlafBacklog {
  totalBacklog: number;
  atnmBacklog: number;
  atnmPct: number;
  pdoBacklog: number;
  pdoPct: number;
}

export interface FlafRisk {
  projectedGap: number;
  riskLevel: string;
  gaugeMax: number;
}

export interface FlafMonth {
  monthLabel: string;
  monthNum: number;
  isForecast: boolean;
  planCumulative: number;
  actualCumulative: number;
  gapCumulative: number;
}

export interface FlafStatusResponse {
  asOfDate: string;
  planYear: number;
  kpi: FlafStatusKpi;
  backlog: FlafBacklog;
  risk: FlafRisk;
  monthlyTrend: FlafMonth[];
}

// ─── Well Execution Dashboard ─────────────────────────────────────────────────

export interface WellExecJobCounts {
  total:      number;
  completed:  number;
  inProgress: number;
  notStarted: number;
}

export interface WellExecProgress {
  actualPct:  number;
  plannedPct: number;
  variancePct: number;
}

export interface WellExecDelayed {
  count:      number;
  pctOfTotal: number;
}

export interface WellExecRevenue {
  actualM:    number;
  plannedM:   number;
  pctAchieved: number;
}

export interface WellExecChartPoint {
  label:       string;
  plannedPct:  number | null;
  actualPct:   number | null;
  plannedRevM: number | null;
  actualRevM:  number | null;
}

export interface WellExecMilestone {
  name: string;
  date: string | null;
}

export interface WellExecKpiDto {
  jobCounts:         WellExecJobCounts;
  progress:          WellExecProgress;
  delayed:           WellExecDelayed;
  revenue:           WellExecRevenue;
  upcomingTargetEnds: number;
  chartSeries:       WellExecChartPoint[];
  milestones:        WellExecMilestone[];
}

// ─── Well Hookup KPI (Non-Standard) ──────────────────────────────────────────

export interface WellHookupKpi {
  actualCompleted:   number;
  suspendedCount:    number;
  totalPlanned:      number;
  aheadOfPlan:       number;
  atRiskOfDelay:     number;
  lyActualCompleted: number;
  lySuspendedCount:  number;
  lyTotalPlanned:    number;
  lyAheadOfPlan:     number;
  lyAtRiskOfDelay:   number;
}

export interface NsHookupWaterfall {
  pdoPlan:          number;
  flafScrRemoved:   number;
  afterFlafScr:     number;
  pdoIssuesRemoved: number;
  cleanTarget:      number;
  actualCompleted:  number;
  asOfDate:         string;
}

export interface NsHookupCompletion {
  completionPct:   number;
  lyCompletionPct: number;
  deltaPct:        number;
  asOfDate:        string;
}

export interface NsHookupBreakdown {
  hookedUp:    number;
  hookedUpPct: number;
  backlog:     number;
  backlogPct:  number;
  suspended:   number;
  suspendedPct: number;
  total:       number;
  asOfDate:    string;
}

// ─── Well Hookup Progress (Conventional) ─────────────────────────────────────

export interface HookupWaterfallStep {
  label: string;
  value: number;
}

export interface HookupProgressKpi {
  actualCompleted:     number;
  actualCompletedLy:   number;
  suspendedHookups:    number;
  totalPlannedYtd:     number;
  aheadOfPlan:         number;
  aheadOfPlanLy:       number;
  atRiskOfDelay:       number;
  atRiskOfDelayLy:     number;
}

export interface HookupOverall {
  overallPct:           number;
  lastYearPct:          number;
  hookedUp:             number;
  backlogInHookup:      number;
  suspendedInBreakdown: number;
  totalWells:           number;
}

export interface HookupProgressResponse {
  wellType:       string;
  kpi:            HookupProgressKpi;
  waterfallSteps: HookupWaterfallStep[];
  overall:        HookupOverall;
}

export interface CmdReadinessKpi {
  plannedWells: number;
  executedWellsAsPerPlan: number;
  nonExecutedWellsAsPerPlan: number;
  unplannedWellsExecuted: number;
  plannedWellCoveragePct: number;
  // Section 2: Planned Activity Coverage
  totalActivitiesPlanned: number;
  inProgressActivitiesPlanned: number;
  newActivitiesPlanned: number;
  totalExecutedAsPlanned: number;
  inProgressExecutedAsPlanned: number;
  newExecutedAsPlanned: number;
  plannedActivityCoveragePct: number;
  // Section 3: Unplanned Activities
  totalActivitiesExecuted: number;
  unplannedActivitiesExecuted: number;
  unplannedActivitiesPct: number;
  // Section 5: Schedule Alignment
  newActivitiesScheduled: number;
  newActivitiesCommitted: number;
  scheduleAlignmentPct: number;
  // Section 6: Documents
  totalRequiredDocuments: number;
  totalSubmittedDocuments: number;
  totalMissingDocuments: number;
  documentCompliancePct: number;
}

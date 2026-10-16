import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

/** Job lifecycle — mirrors RefreshJobStatuses on the server. */
export type RefreshJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export type RefreshTrigger = 'schedule' | 'manual' | 'retry';

export type RefreshMode = 'full' | 'incremental';

/** One execution, shown on the Data Sync "Jobs" tab. */
export interface RefreshJob {
  id: number;
  jobCode: string;
  scheduleId?: number | null;
  jobProcess: string;
  status: RefreshJobStatus;
  triggeredBy: RefreshTrigger;
  refreshMode: RefreshMode;
  queuedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  rowCount?: number | null;
  errorMessage?: string | null;
}

/** A recurring refresh, shown on the Data Sync "Recurring" tab. */
export interface RefreshSchedule {
  id: number;
  scheduleName: string;
  dataSourceConnectionId: number;
  dataSourceName?: string | null;
  importedDatasetId: number;
  datasetName?: string | null;
  objectRef?: string | null;
  cronExpression: string;
  timeZoneId: string;
  frequencyLabel?: string | null;
  refreshMode: RefreshMode;
  incrementalColumn?: string | null;
  isEnabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastStatus?: string | null;
  createdAt: string;
}

export interface CreateRefreshScheduleRequest {
  scheduleName: string;
  dataSourceConnectionId: number;
  importedDatasetId: number;
  cronExpression: string;
  objectRef?: string | null;
  timeZoneId?: string;
  frequencyLabel?: string | null;
  refreshMode?: RefreshMode;
  incrementalColumn?: string | null;
  isEnabled?: boolean;
}

export interface UpdateRefreshScheduleRequest {
  scheduleName: string;
  cronExpression: string;
  objectRef?: string | null;
  timeZoneId: string;
  frequencyLabel?: string | null;
  refreshMode: RefreshMode;
  incrementalColumn?: string | null;
  isEnabled: boolean;
}

/** Freshness of a dataset — powers the "last refreshed" indicator. */
export interface DatasetRefreshStatus {
  datasetId: number;
  datasetName: string;
  rowCount: number;
  /** Null for an uploaded file, which has no source to refresh from. */
  dataSourceConnectionId?: number | null;
  sourceObjectRef?: string | null;
  lastRefreshedAt?: string | null;
  lastRefreshStatus?: string | null;
  lastRefreshJobCode?: string | null;
  /** True when the most recent attempt failed, so the data shown is older than the source. */
  isStale: boolean;
  scheduleId?: number | null;
  nextRunAt?: string | null;
}

export interface CronPreview {
  isValid: boolean;
  error?: string | null;
  nextRuns: string[];
}

export interface RunRefreshRequest {
  dataSourceConnectionId: number;
  importedDatasetId: number;
  objectRef?: string | null;
  refreshMode?: RefreshMode;
  incrementalColumn?: string | null;
}

/**
 * Scheduled, manual and incremental refresh of connector-backed datasets, plus the execution
 * history and freshness indicators behind the Data Sync screen.
 *
 * Manual runs and retries execute synchronously and return the completed job, so the caller
 * can show the outcome without polling.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  constructor(private readonly http: HttpClient) {}

  private get base(): string {
    return `${environment.tenantApiUrl}${API_ENDPOINTS.REFRESH.BASE}`;
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  getSchedules(): Observable<RefreshSchedule[]> {
    return this.http.get<RefreshSchedule[]>(`${this.base}/schedules`);
  }

  createSchedule(request: CreateRefreshScheduleRequest): Observable<RefreshSchedule> {
    return this.http.post<RefreshSchedule>(`${this.base}/schedules`, request);
  }

  updateSchedule(id: number, request: UpdateRefreshScheduleRequest): Observable<RefreshSchedule> {
    return this.http.put<RefreshSchedule>(`${this.base}/schedules/${id}`, request);
  }

  deleteSchedule(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/schedules/${id}`);
  }

  /** Runs a schedule now. This is an extra run — its next fire time is unchanged. */
  runSchedule(id: number): Observable<RefreshJob> {
    return this.http.post<RefreshJob>(`${this.base}/schedules/${id}/run`, {});
  }

  // ── Jobs ───────────────────────────────────────────────────────────────────

  getJobs(limit = 200): Observable<RefreshJob[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http.get<RefreshJob[]>(`${this.base}/jobs`, { params });
  }

  runManual(request: RunRefreshRequest): Observable<RefreshJob> {
    return this.http.post<RefreshJob>(`${this.base}/run`, request);
  }

  /** Re-runs a job. The original attempt stays in the history with its error. */
  retryJob(id: number): Observable<RefreshJob> {
    return this.http.post<RefreshJob>(`${this.base}/jobs/${id}/retry`, {});
  }

  // ── Monitoring ─────────────────────────────────────────────────────────────

  getDatasetStatuses(): Observable<DatasetRefreshStatus[]> {
    return this.http.get<DatasetRefreshStatus[]>(`${this.base}/datasets`);
  }

  /** Validates a cron expression and previews its next fire times. */
  previewCron(cron: string, timeZone = 'UTC', count = 5): Observable<CronPreview> {
    const params = new HttpParams().set('cron', cron).set('timeZone', timeZone).set('count', count);
    return this.http.get<CronPreview>(`${this.base}/cron/preview`, { params });
  }
}

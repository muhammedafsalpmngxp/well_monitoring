import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

export interface SelfHealingKpis {
  runs: number;
  failures: number;
  slowRuns: number;
  avgMs: number;
  maxMs: number;
  failingViews: number;
  dataLoadIssues: number;
}

export interface SelfHealingDay { day: string; runs: number; failures: number; avgMs: number; }

export interface FailingView {
  viewId: number | null;
  sourceName: string;
  sourceType: string;
  runs: number;
  failures: number;
  lastError: string | null;
  lastFailedAt: string;
  /** Its latest run failed too. */
  stillFailing: boolean;
}

export interface SlowView { viewId: number | null; sourceName: string; sourceType: string; runs: number; avgMs: number; maxMs: number; }

export type DataLoadIssueKind = 'failed' | 'refresh_failed' | 'stale';

export interface DataLoadIssue { importId: number; name: string; issue: DataLoadIssueKind; error: string | null; at: string | null; }

export interface ViewRun {
  id: number;
  viewId: number | null;
  sourceName: string;
  sourceType: string;
  caller: 'chart' | 'preview' | 'dataset' | 'ai';
  durationMs: number;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  /** The query sent to the database (parameter names, not values); failed and slow runs only. */
  sql: string | null;
}

export interface SelfHealingOverview {
  days: number;
  dayOptions: number[];
  slowMs: number;
  recordingOn: boolean;
  kpis: SelfHealingKpis;
  daily: SelfHealingDay[];
  failingViews: FailingView[];
  slowViews: SlowView[];
  dataLoads: DataLoadIssue[];
  log: ViewRun[];
}

/** Data Quality → Self-Healing AI: the scan of chart and view loads and of data loads. */
@Injectable({ providedIn: 'root' })
export class SelfHealingService {
  private readonly base = `${environment.tenantApiUrl}${API_ENDPOINTS.SELF_HEALING.BASE}`;

  constructor(private readonly http: HttpClient) {}

  /** days omitted: the server's default period. */
  overview(days?: number): Observable<SelfHealingOverview> {
    return this.http.get<SelfHealingOverview>(`${this.base}/overview`, { params: days ? { days } : {} });
  }
}

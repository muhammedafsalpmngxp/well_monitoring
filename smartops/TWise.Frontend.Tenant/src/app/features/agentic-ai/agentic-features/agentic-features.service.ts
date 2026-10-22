import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { API_ENDPOINTS } from '../../../core/constants/api.constants';

/** One Agentic Feature on the landing page (only those the user may open). route: slippage | daily-report | data-anomaly | crew-management. */
export interface AgenticFeatureSummary {
  feature: string; title: string; description: string; route: string; moduleCode: string;
  /** AI is switched on for the tenant (Settings → AI Providers). */
  aiEnabled: boolean;
  /** An admin has chosen the tables the feature may read (AI Settings → Ask Data & Features → the feature). */
  configured: boolean;
}

/** A verified query of Slippage or Daily Report (read-only here; stored in core.AiFeatureQuery). */
export interface AgenticFeatureQuery {
  key: string; label: string; description: string | null; sql: string; params: string[]; columns: string[];
  modifiedAt: string; edited: boolean;
}

/** A long Data Anomaly operation (compile / run / discover) run by the server's job worker. */
export interface AiFeatureJob {
  id: number; feature: string; kind: 'compile' | 'run' | 'discover'; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  request: any; progress: { stage?: string; done?: number; total?: number; label?: string } | null; result: any;
  error: string | null; requestedBy: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
}

/** A downloaded file: its body and the name the server gave it. */
export interface DownloadedFile { blob: Blob; name: string }

/** Saves a downloaded file in the browser. */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The user's date (yyyy-MM-dd in the browser's time zone): deadlines are counted from it. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The message of a failed call: the API's { message }, else a fallback. */
export function errorText(err: any, fallback: string): string {
  if (err?.status === 403) return 'You do not have permission for this.';
  if (err?.status === 0) return 'The server could not be reached. Check your connection and try again.';
  return err?.error?.message ?? err?.error?.detail ?? fallback;
}

/**
 * The Tenant API of Agentic AI → Agentic Features. Slippage and Daily Report read the tenant's verified SQL; their AI
 * calls (advisor, briefs, questions) go through the tenant's AI provider and quota. Data Anomaly's compile / run /
 * discover are jobs: start one, then poll it. Response bodies of the feature engines are typed by each page.
 */
@Injectable({ providedIn: 'root' })
export class AgenticFeaturesService {
  private readonly api = environment.tenantApiUrl;
  private readonly ep = API_ENDPOINTS.AGENTIC_FEATURES;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<AgenticFeatureSummary[]> {
    return this.http.get<AgenticFeatureSummary[]>(`${this.api}${this.ep.LIST}`);
  }

  queries(feature: string): Observable<AgenticFeatureQuery[]> {
    return this.http.get<AgenticFeatureQuery[]>(`${this.api}${this.ep.QUERIES(feature)}`);
  }

  // ── Slippage ────────────────────────────────────────────────────────────────────────────────────────────────

  /** One verified query: well_slippage | activity_summary | crew_availability | activity_delay (needs wellId). */
  slippageQuery<T = any>(key: string, wellId?: string | null): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.SLIPPAGE}/query`, { key, wellId: wellId ?? null });
  }

  /** The AI advisor for a well, or with taskCode one late task. fresh: ask the AI again instead of reusing an answer. */
  slippageAdvise<T = any>(wellId: string, taskCode: string | null, fresh = false): Observable<T> {
    const path = taskCode ? 'advise-task' : 'advise-well';
    return this.http.post<T>(`${this.api}${this.ep.SLIPPAGE}/${path}`, { wellId, taskCode, fresh });
  }

  // ── Daily Report ───────────────────────────────────────────────────────────────────────────────────────────

  dailyDates<T = any>(limit?: number): Observable<T> {
    let params = new HttpParams();
    if (limit) params = params.set('limit', limit);
    return this.http.get<T>(`${this.api}${this.ep.DAILY_REPORT}/dates`, { params });
  }

  /** summary | group-details | well-activity | well, with the report date and the filters each takes. */
  daily<T = any>(path: 'summary' | 'group-details' | 'well-activity' | 'well', body: {
    reportDate: string; refresh?: boolean; status?: string | null; wbs?: string | null; activityCode?: string | null;
    uom?: string | null; wellId?: number | null;
  }): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.DAILY_REPORT}/${path}`, body);
  }

  dailyMilestones<T = any>(windowDays: number | null): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.DAILY_REPORT}/milestones`, { windowDays, today: localToday() });
  }

  dailyBrief<T = any>(reportDate: string, scope: 'day' | 'well' | 'task', wellId?: number | null, taskDailyId?: number | null): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.DAILY_REPORT}/brief`,
      { reportDate, scope, wellId: wellId ?? null, taskDailyId: taskDailyId ?? null, today: localToday() });
  }

  dailyAsk<T = any>(reportDate: string, question: string): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.DAILY_REPORT}/ask`, { reportDate, question, today: localToday() });
  }

  dailyExport(reportDate: string): Observable<DownloadedFile> {
    return this.download(this.http.post(`${this.api}${this.ep.DAILY_REPORT}/export`, { reportDate },
      { observe: 'response', responseType: 'blob' }), `daily-report-${reportDate}.xlsx`);
  }

  // ── Data Anomaly ───────────────────────────────────────────────────────────────────────────────────────────

  anomalyOverview<T = any>(): Observable<T> { return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/overview`); }

  anomalySchema<T = any>(refresh = false): Observable<T> {
    return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/schema`, { params: new HttpParams().set('refresh', refresh) });
  }

  anomalyRules<T = any>(): Observable<T> { return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/rules`); }

  anomalySetRuleStatus<T = any>(ruleId: string, status: string): Observable<T> {
    return this.http.put<T>(`${this.api}${this.ep.DATA_ANOMALY}/rules/${encodeURIComponent(ruleId)}/status`, { status });
  }

  anomalyRuns<T = any>(take = 30): Observable<T> {
    return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/runs`, { params: new HttpParams().set('take', take) });
  }

  anomalyRun<T = any>(runId: string): Observable<T> {
    return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/runs/${encodeURIComponent(runId)}`);
  }

  anomalyReport(runId: string, format: 'xlsx' | 'docx'): Observable<DownloadedFile> {
    return this.download(this.http.get(`${this.api}${this.ep.DATA_ANOMALY}/runs/${encodeURIComponent(runId)}/reports/${format}`,
      { observe: 'response', responseType: 'blob' }), `data-anomaly-${runId}.${format}`);
  }

  anomalyProposals<T = any>(status?: string): Observable<T> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<T>(`${this.api}${this.ep.DATA_ANOMALY}/proposals`, { params });
  }

  /** Accept (it becomes a rule; probation unless another status is chosen) or reject (Discover will not propose it again). */
  anomalyDecide<T = any>(id: number, decision: 'accept' | 'reject', body: { ruleId?: string | null; status?: string | null; reason?: string | null } = {}): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.DATA_ANOMALY}/proposals/${id}/${decision}`, body);
  }

  anomalyStartJob(body: { kind: 'compile' | 'run' | 'discover'; ruleIds?: string[]; force?: boolean; retryFailed?: boolean;
    formats?: ('xlsx' | 'docx')[]; maxProposals?: number | null }): Observable<AiFeatureJob> {
    return this.http.post<AiFeatureJob>(`${this.api}${this.ep.DATA_ANOMALY}/jobs`,
      { ruleIds: [], force: false, retryFailed: false, formats: null, maxProposals: null, ...body });
  }

  anomalyJobs(take = 20): Observable<AiFeatureJob[]> {
    return this.http.get<AiFeatureJob[]>(`${this.api}${this.ep.DATA_ANOMALY}/jobs`, { params: new HttpParams().set('take', take) });
  }

  anomalyJob(id: number): Observable<AiFeatureJob> {
    return this.http.get<AiFeatureJob>(`${this.api}${this.ep.DATA_ANOMALY}/jobs/${id}`);
  }

  anomalyCancelJob(id: number): Observable<AiFeatureJob> {
    return this.http.post<AiFeatureJob>(`${this.api}${this.ep.DATA_ANOMALY}/jobs/${id}/cancel`, {});
  }

  private download(call: Observable<HttpResponse<Blob>>, fallback: string): Observable<DownloadedFile> {
    return new Observable<DownloadedFile>(sub => {
      const s = call.subscribe({
        next: res => {
          const header = res.headers.get('content-disposition') ?? '';
          const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)?.[1];
          const plain = /filename="?([^";]+)"?/i.exec(header)?.[1];
          const name = star ? decodeURIComponent(star.trim().replace(/"/g, '')) : (plain ?? fallback);
          sub.next({ blob: res.body!, name });
          sub.complete();
        },
        // A failed download's body is a Blob: read the server's { message } out of it.
        error: async err => {
          if (err?.error instanceof Blob) {
            try { err = { ...err, error: JSON.parse(await err.error.text()) }; } catch { /* keep the original */ }
          }
          sub.error(err);
        },
      });
      return () => s.unsubscribe();
    });
  }

  // ── Crew Management ─────────────────────────────────────────────────────────────────────────────────────────

  /** Every crew and its availability, capacity vs delayed work per crew type, the wells needing crews (no AI).
   *  fresh reads the fleet-wide results again instead of the server's short-lived cache. */
  crewOverview<T = any>(fresh = false): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.CREW_MANAGEMENT}/overview`, { fresh });
  }

  /** One well's delayed activities, the crew on each and the free crews to approach (no AI). */
  crewWell<T = any>(wellId: string, fresh = false): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.CREW_MANAGEMENT}/well`, { wellId, fresh });
  }

  /** The well's crew plan with an AI brief (the tenant's AI provider and quota). */
  crewBrief<T = any>(wellId: string): Observable<T> {
    return this.http.post<T>(`${this.api}${this.ep.CREW_MANAGEMENT}/brief`, { wellId, fresh: false });
  }
}

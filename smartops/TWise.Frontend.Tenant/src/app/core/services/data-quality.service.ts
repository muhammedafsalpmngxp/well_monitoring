import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, from, Observable, of, throwError } from 'rxjs';
import { catchError, concatMap, finalize, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { DashboardShareContext } from './widget.service';
import { NotificationRefreshService } from './notification-refresh.service';
import { ToastService } from './toast.service';

export type ValidationRuleExecutionStatus = 'loading' | 'success' | 'failed';

export interface ValidationRuleBatchState {
  isRunning: boolean;
  statuses: Readonly<Record<string, ValidationRuleExecutionStatus>>;
  triggeredOnByRule: Readonly<Record<string, string>>;
  successCount: number;
  failedCount: number;
  completionId: number;
  completionPending: boolean;
}

export interface CreateValidationRuleRequest {
  category: string;
  ruleName: string;
  table: string;
  severity: string;
  query: string;
  validationPeriod?: string;
  maxRecords?: number;
  primaryField?: string;
  fields?: string;
  ruleDesc?: string;
  additionalCondition?: string;
  sourceType?: string;
  viewId?: number;
}

export interface UpdateValidationRuleRequest extends CreateValidationRuleRequest {
  customStartDate?: string;
  customEndDate?: string;
}

export interface ValidationRule {
  ruleId: string;
  category: string;
  ruleName: string;
  table: string;
  severity: string;
  activeYn: string;
  query: string;
  maxRecords: number | null;
  startDate: string | null;
  endDate: string | null;
  primaryField: string | null;
  triggeredOn: string | null;
  fields: string | null;
  ruleDesc: string | null;
  sourceType: string | null;
  viewId: number | null;
}

export interface ErrorLogEntry {
  errorId: string;
  ruleId: string;
  severity: string | null;
  ruleName: string | null;
  primaryField: string | null;
  status: string;
  well: string | null;
  sla: string | null;
  createdAt: string | null;
  changedBy: string | null;
  category: string | null;
  fields: string | null;
  ruleDesc: string | null;
  tableName: string | null;
  maxRecords: number | null;
  recordsFound: number | null;
}

export interface ReliabilityRule {
  ruleId: string;
  ruleName: string;
  ruleDesc: string | null;
  category: string | null;
  severity: string | null;
  recordsFound: number | null;
  recordsTotal: number | null;
  recordsPerExecution: string;
  reliability: number | null;
  triggeredOn: string | null;
  /** True when this rule's latest execution feeds the chart's overall score. */
  contributes: boolean;
}

export interface ReliabilityDetail {
  source: string;
  reliability: number | null;
  reliabilityBreakdown: string;
  rules: ReliabilityRule[];
}

export interface CreateValidationRuleResponse {
  ruleId: string;
  message: string;
  activeYn: string;
}
export interface ExecuteRuleResponse { ruleId: string; message: string; inserted: number; total: number; }

@Injectable({ providedIn: 'root' })
export class DataQualityService {
  private readonly baseUrl = `${environment.tenantApiUrl}/data-quality`;
  private readonly batchState = new BehaviorSubject<ValidationRuleBatchState>({
    isRunning: false,
    statuses: {},
    triggeredOnByRule: {},
    successCount: 0,
    failedCount: 0,
    completionId: 0,
    completionPending: false,
  });

  constructor(
    private readonly http: HttpClient,
    private readonly notificationRefreshService: NotificationRefreshService,
    private readonly toastService: ToastService,
  ) {}

  get validationRuleBatchState$(): Observable<ValidationRuleBatchState> {
    return this.batchState.asObservable();
  }

  get validationRuleBatchState(): ValidationRuleBatchState {
    return this.batchState.value;
  }

  // Rules CRUD
  createRule(request: CreateValidationRuleRequest): Observable<{ data: CreateValidationRuleResponse }> {
    return this.http.post<{ data: CreateValidationRuleResponse }>(`${this.baseUrl}/rules`, request);
  }

  listRules(): Observable<{ data: { rules: ValidationRule[] } }> {
    return this.http.get<{ data: { rules: ValidationRule[] } }>(`${this.baseUrl}/rules`);
  }

  updateRule(ruleId: string, request: UpdateValidationRuleRequest): Observable<{ data: { ruleId: string; message: string } }> {
    return this.http.put<{ data: { ruleId: string; message: string } }>(`${this.baseUrl}/rules/${ruleId}`, request);
  }

  toggleRuleActive(ruleId: string, activeYn: 'Y' | 'N'): Observable<{ data: { ruleId: string; activeYn: string; message: string } }> {
    return this.http.patch<{ data: { ruleId: string; activeYn: string; message: string } }>(`${this.baseUrl}/rules/${ruleId}/active`, { activeYn });
  }

  executeRule(ruleId: string): Observable<{ data: ExecuteRuleResponse }> {
    return this.http.post<{ data: ExecuteRuleResponse }>(`${this.baseUrl}/rules/${ruleId}/execute`, {});
  }

  executeRuleWithStatus(ruleId: string): Observable<{ data: ExecuteRuleResponse }> {
    this.setRuleExecutionStatus(ruleId, 'loading');
    return this.executeRule(ruleId).pipe(
      tap(() => this.setRuleExecutionStatus(ruleId, 'success', new Date().toISOString().slice(0, 16).replace('T', ' '))),
      catchError(error => {
        this.setRuleExecutionStatus(ruleId, 'failed');
        return throwError(() => error);
      }),
    );
  }

  runRulesSequentially(ruleIds: string[]): void {
    const uniqueRuleIds = [...new Set(ruleIds)];
    if (this.batchState.value.isRunning || uniqueRuleIds.length === 0) return;

    const statuses = Object.fromEntries(uniqueRuleIds.map(ruleId => [ruleId, 'loading'])) as Record<string, ValidationRuleExecutionStatus>;
    this.batchState.next({
      ...this.batchState.value,
      isRunning: true,
      statuses,
      triggeredOnByRule: {},
      successCount: 0,
      failedCount: 0,
      completionPending: false,
    });

    from(uniqueRuleIds).pipe(
      concatMap(ruleId => this.executeRule(ruleId).pipe(
        map(() => ({ ruleId, status: 'success' as const })),
        catchError(() => of({ ruleId, status: 'failed' as const })),
      )),
      tap(result => {
        const current = this.batchState.value;
        this.batchState.next({
          ...current,
          statuses: { ...current.statuses, [result.ruleId]: result.status },
          triggeredOnByRule: result.status === 'success'
            ? { ...current.triggeredOnByRule, [result.ruleId]: new Date().toISOString().slice(0, 16).replace('T', ' ') }
            : current.triggeredOnByRule,
        });
      }),
      finalize(() => {
        const current = this.batchState.value;
        const successCount = Object.values(current.statuses).filter(status => status === 'success').length;
        const failedCount = Object.values(current.statuses).filter(status => status === 'failed').length;
        const message = `Rule batch execution completed with ${successCount} success and ${failedCount} failed`;
        this.toastService.pending = message;
        this.batchState.next({
          ...current,
          isRunning: false,
          successCount,
          failedCount,
          completionId: current.completionId + 1,
          completionPending: true,
        });
        this.publishRuleBatchCompletionNotification(successCount, failedCount);
      }),
    ).subscribe();
  }

  private publishRuleBatchCompletionNotification(successCount: number, failedCount: number): void {
    this.http.post<void>(`${this.baseUrl}/rules/batch-completion`, { successCount, failedCount }).pipe(
      catchError(() => of(undefined)),
    ).subscribe(() => this.notificationRefreshService.requestRefresh());
  }

  acknowledgeValidationRuleBatchCompletion(): void {
    if (!this.batchState.value.completionPending) return;
    this.batchState.next({ ...this.batchState.value, completionPending: false });
  }

  private setRuleExecutionStatus(ruleId: string, status: ValidationRuleExecutionStatus, triggeredOn?: string): void {
    const current = this.batchState.value;
    this.batchState.next({
      ...current,
      statuses: { ...current.statuses, [ruleId]: status },
      triggeredOnByRule: triggeredOn
        ? { ...current.triggeredOnByRule, [ruleId]: triggeredOn }
        : current.triggeredOnByRule,
    });
  }

  deleteRule(ruleId: string): Observable<unknown> {
    return this.http.delete(`${this.baseUrl}/rules/${ruleId}`);
  }

  // Error Log
  listOpenErrors(): Observable<{ data: { errors: ErrorLogEntry[] } }> {
    return this.http.get<{ data: { errors: ErrorLogEntry[] } }>(`${this.baseUrl}/open-errors`);
  }

  updateErrorAction(errorId: string, action: string, changedBy?: string): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/open-errors/${errorId}/action`, { action, changedBy });
  }

  updateErrorStatus(errorId: string, status: string, changedBy?: string): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/open-errors/${errorId}/status`, { status, changedBy });
  }

  /** Rules that make up the reliability score of a chart source (table name or view id). */
  getReliabilityDetail(source: { tableName?: string | null; viewId?: number | null }, shareContext?: DashboardShareContext): Observable<{ data: ReliabilityDetail }> {
    let params = new HttpParams();
    if (source.tableName) params = params.set('tableName', source.tableName);
    if (source.viewId != null) params = params.set('viewId', String(source.viewId));
    if (shareContext) params = params.set('shareDashboardId', shareContext.dashboardId).set('shareToken', shareContext.token);
    return this.http.get<{ data: ReliabilityDetail }>(`${this.baseUrl}/reliability/rules`, { params });
  }
}

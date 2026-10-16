import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardShareContext } from './widget.service';

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

  constructor(private readonly http: HttpClient) {}

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

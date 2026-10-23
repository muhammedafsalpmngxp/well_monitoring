import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TenantReportDto {
  id: number;
  reportName: string;
  description?: string;
  categoryId: number;
  categoryName?: string;
  categoryDescription?: string | null;
  sourceName: string;
  sourceType: string;
  reportJson?: string;
  status: string;
  publishedOn?: string;
  createdBy: number;
  tenantId: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantReportRequest {
  reportName: string;
  description?: string;
  categoryId: number;
  sourceName: string;
  sourceType: string;
  reportJson?: string;
}

export interface UpdateTenantReportRequest {
  reportName: string;
  description?: string;
  categoryId: number;
  sourceName: string;
  sourceType: string;
  reportJson?: string;
  status: string;
}

/** One published snapshot of a report, for the version-history panel. */
export interface ReportVersionSummaryDto {
  versionNo: number;
  reportName: string;
  description?: string | null;
  sourceName: string;
  sourceType: string;
  /** 'publish' for a normal publish, 'restore' when produced by a rollback. */
  reason: string;
  restoredFromVersionNo?: number | null;
  publishedBy: number;
  publishedAt: string;
  /** True for the snapshot the live report currently reflects. */
  isCurrent: boolean;
}

export interface RestoreReportVersionResponse {
  reportId: number;
  restoredFromVersionNo: number;
  newVersionNo: number;
  status: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class TenantReportsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/reports`;

  constructor(private readonly http: HttpClient) {}

  /** GET /api/reports – list user's reports. */
  getAll(status?: string): Observable<TenantReportDto[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<TenantReportDto[]>(this.baseUrl, { params });
  }

  /**
   * GET /api/reports/:id/versions – published version history, newest first.
   * Empty for reports last published before version tracking existed.
   */
  getVersions(id: number): Observable<ReportVersionSummaryDto[]> {
    return this.http.get<ReportVersionSummaryDto[]>(`${this.baseUrl}/${id}/versions`);
  }

  /**
   * POST /api/reports/:id/restore/:versionNo – roll back to an earlier version. Admin only.
   * Append-only: the restore is recorded as a new version, preserving the history.
   */
  restoreVersion(id: number, versionNo: number): Observable<RestoreReportVersionResponse> {
    return this.http.post<RestoreReportVersionResponse>(`${this.baseUrl}/${id}/restore/${versionNo}`, {});
  }

  /** GET /api/reports/:id – get single report. */
  getById(id: number): Observable<TenantReportDto> {
    return this.http.get<TenantReportDto>(`${this.baseUrl}/${id}`);
  }

  /** POST /api/reports – create a new report. */
  create(req: CreateTenantReportRequest): Observable<TenantReportDto> {
    return this.http.post<TenantReportDto>(this.baseUrl, req);
  }

  /** PUT /api/reports/:id – update existing report. */
  update(id: number, req: UpdateTenantReportRequest): Observable<TenantReportDto> {
    return this.http.put<TenantReportDto>(`${this.baseUrl}/${id}`, req);
  }

  copyToDraft(id: number): Observable<TenantReportDto> {
    return this.http.post<TenantReportDto>(`${this.baseUrl}/${id}/copy-to-draft`, {});
  }

  /** DELETE /api/reports/:id – soft delete. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  /** GET /api/reports/:id/export?format=pdf|excel|word – RDLC export as file download. */
  export(id: number, format: 'pdf' | 'excel' | 'word' = 'pdf'): Observable<Blob> {
    const params = new HttpParams().set('format', format);
    return this.http.get(`${this.baseUrl}/${id}/export`, { params, responseType: 'blob' });
  }
}

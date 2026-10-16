// Report design-template persistence: saves/loads a source's reusable setup (see report-builder "Save Setup").
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

/** A saved report design template, associated with a single data source. */
export interface ReportTemplateDto {
  id: number;
  customName?: string;
  sourceName: string;
  sourceType: string;
  /** Design config (same shape as a report's reportJson) serialized as a string. */
  templateJson: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  viewId: number | null;
}

export interface SaveReportTemplateRequest {
  customName: string;
  sourceName: string;
  sourceType: string;
  templateJson: string;
  type: string;
  viewId: number;
}

@Injectable({ providedIn: 'root' })
export class ReportTemplatesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/report-templates`;
//   private readonly baseUrl = 'http://localhost:5069/api/report-templates';

  constructor(private readonly http: HttpClient) {}

  /** GET /api/report-templates?type=Y&customName=Z – saved templates filtered by custom name. */
  getBySource(sourceType: string, customName: string): Observable<ReportTemplateDto[]> {
    const params = new HttpParams()
      .set('type', sourceType);
      // .set('customName', customName);
    return this.http.get<ApiResponse<ReportTemplateDto[] | null>>(this.baseUrl, { params }).pipe(
      map(res => res?.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /api/report-templates – create or update the template for a data source. */
  save(req: SaveReportTemplateRequest): Observable<ReportTemplateDto> {
    return this.http.post<ApiResponse<ReportTemplateDto>>(this.baseUrl, req).pipe(
      map(res => res.data),
    );
  }
}
export {};

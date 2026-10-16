// Chart design-template persistence: saves/loads a source's reusable chart setup (see chart-builder "Save Setup").
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

/** A saved chart design template, associated with a single data source. */
export interface ChartTemplateDto {
  id: number;
  customName: string;
  sourceName: string;
  sourceType: string;
  /** Design config (same shape as a chart's chartJson) serialized as a string. */
  templateJson: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  viewId: number | null;
}

export interface SaveChartTemplateRequest {
  customName: string;
  sourceName: string;
  sourceType: string;
  templateJson: string;
  type: string;
  viewId: number;
}

@Injectable({ providedIn: 'root' })
export class ChartTemplatesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/report-templates`;

  constructor(private readonly http: HttpClient) {}

  /** GET /api/chart-templates?type=Y – all saved templates of a type (one per source). */
  getBySource(sourceType: string, customName = ''): Observable<ChartTemplateDto[]> {
    let params = new HttpParams().set('type', sourceType);
    if (customName.trim()) {
      params = params.set('customName', customName.trim());
    }
    return this.http.get<ApiResponse<ChartTemplateDto[] | null>>(this.baseUrl, { params }).pipe(
      map(res => res?.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /api/chart-templates – create or update the template for a data source. */
  save(req: SaveChartTemplateRequest): Observable<ChartTemplateDto> {
    return this.http.post<ApiResponse<ChartTemplateDto>>(this.baseUrl, req).pipe(
      map(res => res.data),
    );
  }
}
export {};

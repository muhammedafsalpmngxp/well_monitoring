import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SavedDaxModelDto {
  id: number;
  name: string;
  sourceType: 'Table' | 'View';
  dataSource: string;
  calculatedBy: 'Column' | 'Row';
  operation: string | null;
  columns: string[];
  expression: string;
  status: 'Active' | 'Draft';
  usedInCharts: number;
  createdAt: string;
  /** Creator's name — sent to admins only. */
  createdByName?: string | null;
}

export interface DaxModelPage {
  items: SavedDaxModelDto[];
  total: number;
  totalModels: number;
  fromTables: number;
  fromViews: number;
}

/** Body of POST /api/dax-models and PUT /api/dax-models/{id}. */
export interface DaxModelSaveRequest {
  name: string;
  sourceType: 'Table' | 'View';
  dataSource: string;
  calculatedBy: 'Column' | 'Row';
  operation: string | null;
  columns: string[];
  expression: string;
  status?: 'Active' | 'Draft';
}

export interface DaxModelListQuery {
  search?: string;
  status?: 'Active' | 'Draft';
  sinceDays?: number;
  page: number;
  pageSize: number;
}

/** Saved DAX models (core.DaxModels) for Settings → Dax Model. */
@Injectable({ providedIn: 'root' })
export class DaxModelService {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/dax-models – one page, newest first, with totals for the cards. */
  list(query: DaxModelListQuery): Observable<DaxModelPage> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.sinceDays) params = params.set('sinceDays', query.sinceDays);
    return this.http.get<DaxModelPage>(`${environment.apiBaseUrl}/dax-models`, { params });
  }

  /** POST /api/dax-models – saves a new model. */
  create(body: DaxModelSaveRequest): Observable<SavedDaxModelDto> {
    return this.http.post<SavedDaxModelDto>(`${environment.apiBaseUrl}/dax-models`, body);
  }

  /** PUT /api/dax-models/{id} – replaces an existing model's definition. */
  update(id: number, body: DaxModelSaveRequest): Observable<SavedDaxModelDto> {
    return this.http.put<SavedDaxModelDto>(`${environment.apiBaseUrl}/dax-models/${id}`, body);
  }

  /** DELETE /api/dax-models/{id} – 409 with a message when a saved chart still uses the model. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/dax-models/${id}`);
  }
}

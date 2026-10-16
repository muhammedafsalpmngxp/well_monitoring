import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ApiResponse } from '../models/api-response.model';

export interface DashboardSavedFilterDto {
  id: number;
  dashboardId: number;
  filterName: string;
  country: string | null;
  sector: string | null;
  businessUnit: string | null;
  division: string | null;
  cluster: string | null;
  plant: string | null;
  quickRange: string | null;
  fromDate: string | null;
  toDate: string | null;
  createdOn: string;
  updatedOn: string;
  isFavorite: boolean;
}

export interface SaveDashboardSavedFilterRequest {
  filterName?: string;
  country?: string | null;
  sector?: string | null;
  businessUnit?: string | null;
  division?: string | null;
  cluster?: string | null;
  plant?: string | null;
  quickRange?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  id?: number | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardSavedFilterService {
  constructor(private readonly api: ApiService) {}

  getAll(dashboardId: number): Observable<DashboardSavedFilterDto[]> {
    return this.api.get<DashboardSavedFilterDto[]>(`/dashboards/${dashboardId}/saved-filters`).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto[]>) => res.data ?? []),
    );
  }

  /** Creates a new preset, or overwrites the existing one with the same FilterName. */
  save(dashboardId: number, request: SaveDashboardSavedFilterRequest): Observable<DashboardSavedFilterDto> {
    return this.api.post<DashboardSavedFilterDto>(`/dashboards/${dashboardId}/saved-filters`, request).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto>) => res.data),
    );
  }

  rename(dashboardId: number, id: number, newFilterName: string): Observable<DashboardSavedFilterDto> {
    return this.api.patch<DashboardSavedFilterDto>(`/dashboards/${dashboardId}/saved-filters/${id}`, { newFilterName }).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto>) => res.data),
    );
  }

  setFavorite(dashboardId: number, id: number, isFavorite: boolean): Observable<DashboardSavedFilterDto> {
    return this.api.patch<DashboardSavedFilterDto>(`/dashboards/${dashboardId}/saved-filters/${id}/favorite`, { isFavorite }).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto>) => res.data),
    );
  }

  delete(dashboardId: number, id: number): Observable<void> {
    return this.api.delete<unknown>(`/dashboards/${dashboardId}/saved-filters/${id}`).pipe(
      map(() => void 0),
    );
  }

  /** Gets the dashboard's shared default filter (same for every user), set from Build/Edit Dashboard. */
  getDefault(dashboardId: number): Observable<DashboardSavedFilterDto | null> {
    return this.api.get<DashboardSavedFilterDto | null>(`/dashboards/${dashboardId}/saved-filters/default`).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto | null>) => res.data ?? null),
    );
  }

  /** Saves the dashboard's shared default filter (same for every user) — called when the dashboard is saved. */
  saveDefault(dashboardId: number, request: SaveDashboardSavedFilterRequest): Observable<DashboardSavedFilterDto> {
    return this.api.post<DashboardSavedFilterDto>(`/dashboards/${dashboardId}/saved-filters/default`, request).pipe(
      map((res: ApiResponse<DashboardSavedFilterDto>) => res.data),
    );
  }
}

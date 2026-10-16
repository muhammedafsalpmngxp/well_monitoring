import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardLogoAsset } from '../models/dashboard.model';

@Injectable({ providedIn: 'root' })
export class DashboardLogoService {
  private readonly baseUrl = `${environment.tenantApiUrl}/dashboard/logos`;

  constructor(private readonly http: HttpClient) {}

  upload(file: File): Observable<DashboardLogoAsset> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<DashboardLogoAsset>(this.baseUrl, body);
  }

  load(assetId: string, dashboardId?: number, token?: string): Observable<Blob> {
    const path = token && dashboardId
      ? `${this.baseUrl}/public/${dashboardId}/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`
      : `${this.baseUrl}/${encodeURIComponent(assetId)}`;
    return this.http.get(path, { responseType: 'blob' });
  }
}
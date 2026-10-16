import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

/** The tenant's Power BI connection. The client secret is never returned. */
export interface PowerBiSettings {
  azureTenantId: string;
  clientId: string;
  workspaceId: string;
  hasSecret: boolean;
  modifiedAt: string;
}

export interface SavePowerBiSettingsRequest {
  azureTenantId: string;
  clientId: string;
  workspaceId: string;
  /** Blank on update keeps the stored secret. */
  clientSecret?: string | null;
}

export interface PowerBiReport {
  id: string;
  name: string;
  embedUrl: string;
  datasetId?: string | null;
}

/** What powerbi-client needs to embed one report. The token is short-lived. */
export interface PowerBiEmbedConfig {
  reportId: string;
  embedUrl: string;
  embedToken: string;
  expiration: string;
}

@Injectable({ providedIn: 'root' })
export class PowerBiService {
  constructor(private readonly http: HttpClient) {}

  private get base(): string {
    return `${environment.tenantApiUrl}${API_ENDPOINTS.POWER_BI.BASE}`;
  }

  /** Null when Power BI is not configured (204). */
  getSettings(): Observable<PowerBiSettings | null> {
    return this.http.get<PowerBiSettings | null>(`${this.base}/settings`);
  }

  saveSettings(request: SavePowerBiSettingsRequest): Observable<PowerBiSettings> {
    return this.http.put<PowerBiSettings>(`${this.base}/settings`, request);
  }

  getReports(): Observable<PowerBiReport[]> {
    return this.http.get<PowerBiReport[]>(`${this.base}/reports`);
  }

  getEmbedConfig(reportId: string): Observable<PowerBiEmbedConfig> {
    return this.http.post<PowerBiEmbedConfig>(`${this.base}/reports/${encodeURIComponent(reportId)}/embed-token`, {});
  }
}

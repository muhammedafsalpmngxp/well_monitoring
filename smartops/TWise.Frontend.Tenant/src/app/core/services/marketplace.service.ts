import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

export type CustomVisualRoleType = 'dimension' | 'measure';

/** One field a visual needs, used to bind data into its template. */
export interface CustomVisualDataRole {
  key: string;
  label: string;
  type: CustomVisualRoleType;
  required: boolean;
  allowMultiple: boolean;
}

/** A visual installed in this tenant. */
export interface InstalledVisual {
  id: number;
  visualKey: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  renderKind: string;
  dataRoles: CustomVisualDataRole[];
  optionsTemplateJson: string;
  isActive: boolean;
}

/** A visual offered by a catalog. */
export interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  visualKey: string;
  renderKind: string;
  dataRoles: CustomVisualDataRole[];
  optionsTemplateJson: string;
  icon?: string | null;
  /** Short selling points shown on the marketplace card. */
  features?: string[] | null;
  /** Preview image; when absent the card renders the template with sample data. */
  imageUrl?: string | null;
}

/** A catalog this tenant registered. The auth value is never returned. */
export interface MarketplaceCatalog {
  catalogKey: string;
  name: string;
  url: string;
  authHeader?: string | null;
  hasAuth: boolean;
  createdAt: string;
  /** Shipped with the API; cannot be edited or removed. */
  isBuiltIn?: boolean;
}

export interface SaveCatalogRequest {
  name: string;
  url: string;
  authHeader?: string | null;
  authValue?: string | null;
}

export interface MarketplaceListing {
  plugin: CatalogPlugin;
  isInstalled: boolean;
  installedVersion?: string | null;
  updateAvailable: boolean;
}

@Injectable({ providedIn: 'root' })
export class MarketplaceService {
  constructor(private readonly http: HttpClient) {}

  private get base(): string {
    return `${environment.tenantApiUrl}${API_ENDPOINTS.MARKETPLACE.BASE}`;
  }

  /** Visuals installed in this tenant, registered as renderers at startup. */
  getInstalled(): Observable<InstalledVisual[]> {
    return this.http.get<InstalledVisual[]>(`${this.base}/installed`);
  }

  /** Catalogues a Power BI custom visual (.pbiviz) in the built-in marketplace. */
  importPowerBiVisual(file: File): Observable<CatalogPlugin> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<CatalogPlugin>(`${this.base}/catalog/pbiviz`, form);
  }

  getCatalogs(): Observable<MarketplaceCatalog[]> {
    return this.http.get<MarketplaceCatalog[]>(`${this.base}/catalogs`);
  }

  addCatalog(request: SaveCatalogRequest): Observable<MarketplaceCatalog> {
    return this.http.post<MarketplaceCatalog>(`${this.base}/catalogs`, request);
  }

  updateCatalog(catalogKey: string, request: SaveCatalogRequest): Observable<MarketplaceCatalog> {
    return this.http.put<MarketplaceCatalog>(`${this.base}/catalogs/${encodeURIComponent(catalogKey)}`, request);
  }

  removeCatalog(catalogKey: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/catalogs/${encodeURIComponent(catalogKey)}`);
  }

  browse(catalogId: string): Observable<MarketplaceListing[]> {
    return this.http.get<MarketplaceListing[]>(`${this.base}/catalogs/${encodeURIComponent(catalogId)}/plugins`);
  }

  install(catalogId: string, pluginId: string): Observable<InstalledVisual> {
    return this.http.post<InstalledVisual>(`${this.base}/install`, { catalogId, pluginId });
  }

  uninstall(catalogId: string, pluginId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/catalogs/${encodeURIComponent(catalogId)}/plugins/${encodeURIComponent(pluginId)}`);
  }
}

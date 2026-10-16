import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

export interface ImportColumn {
  name: string;
  type: string;
}

export interface ImportedDatasetListItem {
  id: number;
  datasetName: string;
  fileName: string;
  fileType: string;
  rowCount: number;
  status: string;
  createdAt: string;
}

export interface ImportedDatasetDto {
  id: number;
  datasetName: string;
  fileName: string;
  fileType: string;
  columns: ImportColumn[];
  rowCount: number;
  status: string;
  errorMessage?: string | null;
}

export interface ImportedDatasetDataResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

/** Uploads and manages CSV/XLSX/XLS/JSON files used as chart data sources. */
@Injectable({ providedIn: 'root' })
export class ImportedDatasetService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<ImportedDatasetListItem[]> {
    return this.http.get<ImportedDatasetListItem[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.IMPORTS.BASE}`);
  }

  getData(id: number | string): Observable<ImportedDatasetDataResponse> {
    return this.http.get<ImportedDatasetDataResponse>(`${environment.tenantApiUrl}${API_ENDPOINTS.IMPORTS.DATA(id)}`);
  }

  upload(file: File, datasetName?: string): Observable<ImportedDatasetDto> {
    const formData = new FormData();
    formData.append('file', file);
    if (datasetName) formData.append('datasetName', datasetName);
    return this.http.post<ImportedDatasetDto>(`${environment.tenantApiUrl}${API_ENDPOINTS.IMPORTS.BASE}`, formData);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.tenantApiUrl}${API_ENDPOINTS.IMPORTS.BY_ID(id)}`);
  }
}

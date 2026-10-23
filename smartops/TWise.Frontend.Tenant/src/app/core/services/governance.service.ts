import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

export type DictionaryKind = 'import' | 'view';
export type Sensitivity = 'public' | 'internal' | 'confidential' | 'pii';
export const SENSITIVITIES: Sensitivity[] = ['public', 'internal', 'confidential', 'pii'];

export interface DictionaryDataset {
  kind: DictionaryKind;
  id: number;
  name: string;
  description: string | null;
  owner: string | null;
  columnCount: number;
  documentedCount: number;
  piiCount: number;
}

export interface DictionaryColumn {
  columnName: string;
  dataType: string;
  businessName: string | null;
  description: string | null;
  owner: string | null;
  sensitivity: Sensitivity;
  tags: string | null;
}

export interface DictionaryDatasetDetail {
  kind: DictionaryKind;
  id: number;
  name: string;
  description: string | null;
  owner: string | null;
  columns: DictionaryColumn[];
}

export interface SaveDictionaryRequest {
  description: string | null;
  owner: string | null;
  columns: Omit<DictionaryColumn, 'dataType'>[];
}

/** The AI's draft for a dataset; nothing is saved until the user saves the editor. */
export interface DictionaryDraft {
  description: string | null;
  columns: { columnName: string; businessName: string | null; description: string | null; sensitivity: Sensitivity; tags: string | null }[];
}

export type LineageKind = 'source' | 'db' | 'import' | 'view' | 'table' | 'chart' | 'dashboard' | 'report';

export interface LineageNode {
  id: string;
  kind: LineageKind;
  label: string;
  sub: string | null;
}

export interface LineageEdge {
  from: string;
  to: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

@Injectable({ providedIn: 'root' })
export class GovernanceService {
  private readonly base = `${environment.tenantApiUrl}${API_ENDPOINTS.GOVERNANCE.BASE}`;

  constructor(private readonly http: HttpClient) {}

  listDatasets(): Observable<DictionaryDataset[]> {
    return this.http.get<DictionaryDataset[]>(`${this.base}/dictionary`);
  }

  getDataset(kind: DictionaryKind, id: number): Observable<DictionaryDatasetDetail> {
    return this.http.get<DictionaryDatasetDetail>(`${this.base}/dictionary/${kind}/${id}`);
  }

  saveDataset(kind: DictionaryKind, id: number, body: SaveDictionaryRequest): Observable<DictionaryDatasetDetail> {
    return this.http.put<DictionaryDatasetDetail>(`${this.base}/dictionary/${kind}/${id}`, body);
  }

  /** The AI's draft documentation (Draft the data dictionary feature). */
  draftDataset(kind: DictionaryKind, id: number): Observable<DictionaryDraft> {
    return this.http.post<DictionaryDraft>(`${this.base}/dictionary/${kind}/${id}/draft`, {});
  }

  lineage(): Observable<LineageGraph> {
    return this.http.get<LineageGraph>(`${this.base}/lineage`);
  }
}

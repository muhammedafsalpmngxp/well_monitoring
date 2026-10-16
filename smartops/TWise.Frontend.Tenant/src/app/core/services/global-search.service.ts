import { Injectable } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { API_ENDPOINTS } from '../constants/api.constants';

export type GlobalSearchResultType = 'dashboard' | 'chart' | 'tile' | 'report';

export interface GlobalSearchResult {
  type: GlobalSearchResultType;
  id: string;
  name: string;
  categoryName: string | null;
  status: string;
  /** Absolute frontend route to the item's detail page — safe to pass straight to Router.navigateByUrl. */
  url: string;
}

@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  constructor(private readonly api: ApiService) {}

  search(term: string): Observable<GlobalSearchResult[]> {
    const params = new HttpParams().set('q', term);
    return this.api
      .get<GlobalSearchResult[]>(API_ENDPOINTS.SEARCH.BASE, params)
      .pipe(map(res => res.data ?? []));
  }
}

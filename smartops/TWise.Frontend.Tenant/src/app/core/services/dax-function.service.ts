import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DaxFunctionSuggestion {
  functionName: string;
  category: string;
  syntax: string;
  returnType: string;
  description: string;
  /** Snippet syntax, e.g. SUM(${1:ColumnName})$0. */
  insertSnippet: string;
  minArgs: number;
  maxArgs: number | null;
  isNotRecommended: boolean;
  isDeprecated: boolean;
  docUrl: string | null;
}

/** DAX function catalog (dbo.DaxFunction) for smart compose. Results are cached per prefix. */
@Injectable({ providedIn: 'root' })
export class DaxFunctionService {
  private readonly cache = new Map<string, Observable<DaxFunctionSuggestion[]>>();

  constructor(private readonly http: HttpClient) {}

  /** GET /api/dax-functions/suggest – enabled functions starting with the prefix, best first. */
  suggest(prefix: string, top = 10): Observable<DaxFunctionSuggestion[]> {
    const key = `${prefix.toUpperCase()}|${top}`;
    let request = this.cache.get(key);
    if (!request) {
      const params = new HttpParams().set('prefix', prefix).set('top', top);
      request = this.http.get<DaxFunctionSuggestion[]>(`${environment.apiBaseUrl}/dax-functions/suggest`, { params }).pipe(
        // A failed lookup just means no suggestions; it is not cached so the next keystroke retries.
        catchError(() => { this.cache.delete(key); return of([]); }),
        shareReplay(1),
      );
      this.cache.set(key, request);
    }
    return request;
  }
}

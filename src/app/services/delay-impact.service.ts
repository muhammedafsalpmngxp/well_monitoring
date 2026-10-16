import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface DelayCascadeItem {
  phase: string;
  slip: string;
}

export interface RecoveryOption {
  rank: number;
  action: string;
  cost: number;
  daysSaved: number;
  netSaving: number;
}

export interface DelayCard {
  well: string;
  rootCause: string;
  cascade: DelayCascadeItem[];
  penalty: number;
  recoveries: RecoveryOption[];
}

@Injectable({ providedIn: 'root' })
export class DelayImpactService {

  private readonly apiUrl = environment.databricks.delayImpactUrl;
  private readonly token = environment.databricks.token;

  private readonly requestBody = {
    inputs: [
      {
        query: 'Return delay impact analysis across all wells including root cause of delay, delay cascade across activities, penalty risk, and recovery options ranked by net saving. Compute delay using planned dates and current date, propagate delay from root cause to downstream activities, and return structured JSON aligned to delay impact dashboard.'
      }
    ]
  };

  constructor(private http: HttpClient) {}

  fetchDelayImpact(): Observable<DelayCard[]> {
    const headers = new HttpHeaders(
      this.token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` }
        : { 'Content-Type': 'application/json' }
    );

    return this.http.post<any>(this.apiUrl, this.requestBody, { headers }).pipe(
      map(response => this.parseResponse(response)),
      catchError(err => {
        console.error('[DelayImpactService] API call failed', err);
        return of([]);
      })
    );
  }

  private parseResponse(response: any): DelayCard[] {
    try {
      const answerStr: string = response?.predictions?.answer;
      if (!answerStr) return [];

      // The answer string starts with a JSON array followed by natural language text.
      // Extract just the JSON array portion.
      const firstBracket = answerStr.indexOf('[');
      const lastBracket = answerStr.lastIndexOf(']');
      if (firstBracket < 0 || lastBracket < 0) return [];

      const jsonStr = answerStr.substring(firstBracket, lastBracket + 1);
      const wellsArray = JSON.parse(jsonStr);

      if (!Array.isArray(wellsArray)) return [];

      return wellsArray
        .map((item: any) => this.mapWellItem(item))
        .filter((c): c is DelayCard => c !== null);
    } catch (e) {
      console.error('[DelayImpactService] Failed to parse response', e);
      return [];
    }
  }

  private mapWellItem(item: any): DelayCard | null {
    try {
      const result = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;

      return {
        well: item.well_id || result.well_id || '',
        rootCause: result.root_cause || '',
        penalty: parseInt(result.penalty_risk, 10) || 0,
        cascade: (result.delay_cascade || []).map((c: any) => ({
          phase: c.activity || '',
          slip: '+' + (c.delay_days || 0) + 'd'
        })),
        recoveries: (result.recovery_options || [])
          .sort((a: any, b: any) => (parseInt(a.rank, 10) || 0) - (parseInt(b.rank, 10) || 0))
          .map((r: any) => ({
            rank: parseInt(r.rank, 10) || 0,
            action: r.action || '',
            cost: parseInt(r.cost, 10) || 0,
            daysSaved: parseInt(r.days_saved, 10) || 0,
            netSaving: parseInt(r.net_saving, 10) || 0
          }))
      };
    } catch (e) {
      console.error('[DelayImpactService] Failed to parse well item', item, e);
      return null;
    }
  }
}

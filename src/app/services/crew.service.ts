import { environment } from '../../environments/environment';
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CrewListItem {
  crewId: string;
  crewName: string | null;
  discipline: string | null;
  activity: string | null;
  leader: string | null;
  cluster: string | null;
  size: number | null;
  pRating: string | null;
  productivity: number | null;
  status: string;
  deployedOn: string | null;
  formation: string | null;
}

export interface CrewListResponse {
  totalCount: number;
  deployed: number;
  standby: number;
  restRotation: number;
  page: number;
  pageSize: number;
  crews: CrewListItem[];
}

// ─── Crew Calendar (Gantt) DTOs ─────────────────────────────────────────────

export interface CalendarActivity {
  activityCode: string;
  activityName: string;
  wellId: string;
  category: string | null;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  progress: number;
  status: 'milestone' | 'completed' | 'delayed' | 'inprogress' | 'notstarted';
  isMilestone: boolean;
  rigOnDate: string | null;
  expectedRigOnDate: string | null;
}

export interface CalendarCrew {
  crewCode: string;
  activities: CalendarActivity[];
}

export interface CalendarGroup {
  crewGroupCode: string;
  activityCount: number;
  completionPct: number;
  crews: CalendarCrew[];
}

export interface CrewCalendarResponse {
  totalGroups: number;
  totalCrews: number;
  totalActivities: number;
  totalMilestones: number;
  fromDate: string;
  toDate: string;
  groups: CalendarGroup[];
  milestones: CalendarActivity[];
}

export interface CalendarFilters {
  cluster?: string;
  site?: string;
  wellType?: string;
  project?: string;
  from?: string;
  to?: string;
}

@Injectable({ providedIn: 'root' })
export class CrewService {

  private readonly baseUrl = environment.apiBaseUrl + '/api/v1/wells/crews';

  constructor(private readonly http: HttpClient) {}

  getCrewList(filters?: {
    crewGroup?: string;
    cluster?: string;
    wellId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Observable<CrewListResponse> {
    let params = new HttpParams();
    if (filters?.crewGroup) params = params.set('crewGroup', filters.crewGroup);
    if (filters?.cluster) params = params.set('cluster', filters.cluster);
    if (filters?.wellId) params = params.set('wellId', filters.wellId);
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.page) params = params.set('page', filters.page.toString());
    if (filters?.pageSize) params = params.set('pageSize', filters.pageSize.toString());
    return this.http.get<CrewListResponse>(this.baseUrl, { params });
  }

  getCrewCalendar(filters?: CalendarFilters): Observable<CrewCalendarResponse> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    return this.http.get<CrewCalendarResponse>(`${this.baseUrl}/calendar`, { params });
  }
}

import { Injectable } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { StorageService } from './storage.service';
import { APP_CONSTANTS } from '../constants/app.constants';
import {
  CalendarFilters,
  CrewCalendarData,
  UnassignedCrewsData,
  AssignableActivitiesData,
  CreateCrewAssignmentRequest,
  CrewAssignment,
  CalendarGroup,
  StoredCrewCalendarPlan,
} from '../models/crew-calendar.model';

@Injectable({ providedIn: 'root' })
export class CrewCalendarService {
  private readonly path = '/legacy-crews/calendar';
  private readonly unassignedPath = '/legacy-crews/unassigned';
  private readonly activitiesPath = '/legacy-crews/assignable-activities';
  private readonly assignmentsPath = '/crew-assignments';

  constructor(private readonly api: ApiService, private readonly storage: StorageService) {}

  getCalendar(filters?: CalendarFilters): Observable<CrewCalendarData> {
    let params = new HttpParams();
    if (filters?.cluster)  params = params.set('cluster',  filters.cluster);
    if (filters?.site)     params = params.set('site',     filters.site);
    if (filters?.wellType) params = params.set('wellType', filters.wellType);
    if (filters?.project)  params = params.set('project',  filters.project);
    if (filters?.from)     params = params.set('from',     filters.from);
    if (filters?.to)       params = params.set('to',       filters.to);
    if (filters?.includeAssignments) params = params.set('includeAssignments', 'true');
    if (filters?.includeRoster) params = params.set('includeRoster', 'true');
    return this.api.get<CrewCalendarData>(this.path, params).pipe(
      map(res => {
        const data = res.data;
        if (!filters?.includeRoster || !data.roster) return data;
        return {
          ...data,
          planningScope: { ...filters, from: data.fromDate, to: data.toDate },
          retainedPlan: this.getSessionPlan({ ...filters, from: data.fromDate, to: data.toDate }),
        };
      }),
    );
  }

  private sessionKey(filters: CalendarFilters): string | null {
    try {
      const user = JSON.parse(this.storage.getItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA) ?? 'null');
      if (user?.userId == null || user?.tenantId == null) return null;
      const scope = [filters.cluster, filters.site, filters.wellType, filters.project]
        .map(value => value?.trim().toLowerCase() ?? '');
      return APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION +
        JSON.stringify([user.tenantId, user.userId, filters.from, filters.to, ...scope]);
    } catch {
      return null;
    }
  }

  getSessionPlan(filters: CalendarFilters): CalendarGroup[] {
    const key = this.sessionKey(filters);
    if (!key) return [];
    try {
      const saved: StoredCrewCalendarPlan = JSON.parse(this.storage.getSessionItem(key) ?? 'null');
      if (!Array.isArray(saved?.activities) || !Array.isArray(saved.bookings)) return [];
      const groups = new Map<string, CalendarGroup>();
      const crews = new Map<string, CalendarGroup['crews'][number]>();
      for (const [groupCode, crewCode, index, plannedStart, plannedEnd] of saved.bookings) {
        const template = saved.activities[index];
        if (!template?.proposed || template.source === 'draft' || template.actualStart || template.actualEnd || template.progress) continue;
        let group = groups.get(groupCode);
        if (!group) {
          group = { crewGroupCode: groupCode, activityCount: 0, completionPct: 0, crews: [] };
          groups.set(groupCode, group);
        }
        const crewKey = JSON.stringify([groupCode, crewCode]);
        let crew = crews.get(crewKey);
        if (!crew) {
          crew = { crewCode, activities: [] };
          crews.set(crewKey, crew);
          group.crews.push(crew);
        }
        crew.activities.push({ ...template, plannedStart, plannedEnd });
        group.activityCount++;
      }
      return [...groups.values()];
    } catch {
      return [];
    }
  }

  saveSessionPlan(filters: CalendarFilters, data: CrewCalendarData): boolean {
    const key = this.sessionKey({ ...filters, from: data.fromDate, to: data.toDate });
    if (!key) return false;
    const saved: StoredCrewCalendarPlan = { activities: [], bookings: [] };
    const templates = new Map<string, number>();
    for (const group of data.groups) for (const crew of group.crews) for (const activity of crew.activities) {
      if (!activity.proposed || activity.source === 'draft') continue;
      const template = { ...activity, plannedStart: '', plannedEnd: '' };
      const templateKey = JSON.stringify(template);
      let index = templates.get(templateKey);
      if (index === undefined) {
        index = saved.activities.length;
        saved.activities.push(template);
        templates.set(templateKey, index);
      }
      saved.bookings.push([group.crewGroupCode, crew.crewCode, index, activity.plannedStart, activity.plannedEnd]);
    }
    return this.storage.setSessionItem(key, JSON.stringify(saved));
  }

  getUnassignedCrews(crewGroup?: string, from?: string, to?: string): Observable<UnassignedCrewsData> {
    let params = new HttpParams();
    if (crewGroup) params = params.set('crewGroup', crewGroup);
    if (from)      params = params.set('from', from);
    if (to)        params = params.set('to', to);
    return this.api.get<UnassignedCrewsData>(this.unassignedPath, params).pipe(map(res => res.data));
  }

  getAssignableActivities(crewGroup?: string, crewTypeCode?: string): Observable<AssignableActivitiesData> {
    let params = new HttpParams();
    if (crewGroup)    params = params.set('crewGroup', crewGroup);
    if (crewTypeCode) params = params.set('crewTypeCode', crewTypeCode);
    return this.api.get<AssignableActivitiesData>(this.activitiesPath, params).pipe(map(res => res.data));
  }

  assignActivity(request: CreateCrewAssignmentRequest): Observable<CrewAssignment> {
    return this.api.post<CrewAssignment>(this.assignmentsPath, request).pipe(map(res => res.data));
  }

  unassign(id: number): Observable<void> {
    return this.api.delete<void>(`${this.assignmentsPath}/${id}`).pipe(map(() => void 0));
  }
}

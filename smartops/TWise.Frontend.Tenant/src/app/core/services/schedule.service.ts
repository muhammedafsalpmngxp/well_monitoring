import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

/** Permission module of schedules and their delivery log: view lists, create adds, modify edits, pauses, deletes and runs now. */
export const SCHEDULES_MODULE = 'smart-alerts.schedules';

export type TargetType = 'Report' | 'Dashboard' | 'Canvas';
export type DeliveryFormat = 'Link' | 'Xlsx' | 'Csv';
export type RecipientKind = 'To' | 'Cc' | 'Bcc';
export type RecipientType = 'User' | 'Role' | 'Group' | 'Email';
export type RunStatus = 'Sent' | 'Skipped' | 'Failed';
export type RunTrigger = 'Schedule' | 'RunNow' | 'Test';

/** value: user id, role code, mail group id or address. label is what the chip shows. */
export interface ScheduleRecipient { kind: RecipientKind; type: RecipientType; value: string; label?: string; }

export interface ScheduleRequest {
  name: string;
  targetType: TargetType;
  targetId: number;
  format: DeliveryFormat;
  /** 5-field cron; null runs once at runOnceAt. */
  cron: string | null;
  runOnceAt: string | null;
  /** IANA, e.g. Asia/Muscat. */
  timeZone: string;
  startAt: string | null;
  endAt: string | null;
  skipIfEmpty: boolean;
  subject: string;
  body: string;
  recipients: ScheduleRecipient[];
}

export interface ScheduleDto extends ScheduleRequest {
  id: number;
  isActive: boolean;
  ownerUserId: number;
  ownerName: string | null;
  targetName: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: RunStatus | null;
  createdAt: string;
  modifiedAt: string;
}

export interface ScheduleRunDto {
  id: number;
  scheduleId: number | null;
  scheduleName: string;
  targetType: TargetType;
  targetName: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  recipientCount: number;
  attachmentBytes: number;
  attempt: number;
  error: string | null;
}

export interface PreviewRunsRequest { cron: string | null; timeZone: string; startAt: string | null; endAt: string | null; runOnceAt: string | null; }

export interface RunsQuery { scheduleId?: number; status?: RunStatus; from?: string; to?: string; page?: number; pageSize?: number; }

export interface MailGroupRequest { name: string; description?: string; members: string[]; }
export interface MailGroupDto extends MailGroupRequest { id: number; createdAt: string; modifiedAt: string; }

/** The formats a target type can be delivered in, the first being the default. */
export const FORMATS_BY_TARGET: Record<TargetType, DeliveryFormat[]> = {
  Report: ['Xlsx', 'Csv', 'Link'],
  Canvas: ['Xlsx', 'Link'],
  Dashboard: ['Link'],
};

/** Scheduled deliveries (api/schedules) and mail groups (api/mail-groups), unwrapped from the API envelope. */
@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly base = `${environment.tenantApiUrl}/schedules`;
  private readonly groups = `${environment.tenantApiUrl}/mail-groups`;

  constructor(private readonly http: HttpClient) {}

  list(targetType?: TargetType, targetId?: number): Observable<ScheduleDto[]> {
    let params = new HttpParams();
    if (targetType) params = params.set('targetType', targetType);
    if (targetId !== undefined) params = params.set('targetId', targetId);
    return this.http.get<ApiResponse<ScheduleDto[]>>(this.base, { params }).pipe(map(r => r.data));
  }

  get(id: number): Observable<ScheduleDto> {
    return this.http.get<ApiResponse<ScheduleDto>>(`${this.base}/${id}`).pipe(map(r => r.data));
  }

  create(body: ScheduleRequest): Observable<ScheduleDto> {
    return this.http.post<ApiResponse<ScheduleDto>>(this.base, body).pipe(map(r => r.data));
  }

  update(id: number, body: ScheduleRequest): Observable<ScheduleDto> {
    return this.http.put<ApiResponse<ScheduleDto>>(`${this.base}/${id}`, body).pipe(map(r => r.data));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  pause(id: number): Observable<ScheduleDto> {
    return this.http.post<ApiResponse<ScheduleDto>>(`${this.base}/${id}/pause`, {}).pipe(map(r => r.data));
  }

  resume(id: number): Observable<ScheduleDto> {
    return this.http.post<ApiResponse<ScheduleDto>>(`${this.base}/${id}/resume`, {}).pipe(map(r => r.data));
  }

  /** Runs the schedule now and sends it to its recipients. */
  runNow(id: number): Observable<ScheduleRunDto> {
    return this.http.post<ApiResponse<ScheduleRunDto>>(`${this.base}/${id}/run-now`, {}).pipe(map(r => r.data));
  }

  /** Renders the unsaved schedule and sends it to the signed-in user only. */
  test(body: ScheduleRequest): Observable<ScheduleRunDto> {
    return this.http.post<ApiResponse<ScheduleRunDto>>(`${this.base}/test`, body).pipe(map(r => r.data));
  }

  /** The next five run times, in UTC. An invalid recurrence is HTTP 400 with a message. */
  previewRuns(body: PreviewRunsRequest): Observable<string[]> {
    return this.http.post<ApiResponse<string[]>>(`${this.base}/preview-runs`, body).pipe(map(r => r.data));
  }

  runs(query: RunsQuery): Observable<{ items: ScheduleRunDto[]; total: number }> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, value);
    }
    return this.http.get<ApiResponse<{ items: ScheduleRunDto[]; total: number }>>(`${this.base}/runs`, { params }).pipe(map(r => r.data));
  }

  mailGroups(): Observable<MailGroupDto[]> {
    return this.http.get<ApiResponse<MailGroupDto[]>>(this.groups).pipe(map(r => r.data));
  }

  createMailGroup(body: MailGroupRequest): Observable<MailGroupDto> {
    return this.http.post<ApiResponse<MailGroupDto>>(this.groups, body).pipe(map(r => r.data));
  }

  updateMailGroup(id: number, body: MailGroupRequest): Observable<MailGroupDto> {
    return this.http.put<ApiResponse<MailGroupDto>>(`${this.groups}/${id}`, body).pipe(map(r => r.data));
  }

  deleteMailGroup(id: number): Observable<void> {
    return this.http.delete<void>(`${this.groups}/${id}`);
  }
}

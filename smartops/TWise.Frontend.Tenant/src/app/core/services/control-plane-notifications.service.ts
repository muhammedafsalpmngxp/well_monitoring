import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { NotificationsFeed } from '../models/notification.model';
import { NotificationSource } from './notification-source';

interface RawNotificationEntry {
  id: number;
  type: string;
  title: string;
  description: string | null;
  createdAt: string;
  isRead: boolean;
  route?: string | null;
}

interface RawNotificationsResponse {
  unreadCount: number;
  items: RawNotificationEntry[];
}

/** Backend `type` (control.Notification.type) -> navbar icon/color token (navbar.component.scss). */
const TYPE_ICON_MAP: Readonly<Record<string, string>> = {
  DashboardShare: 'dashboard',
  DataQualityError: 'chart',
  DataQualityRuleBatchCompleted: 'chart',
  RbacRoleChange: 'report',
  RbacPermissionChange: 'report',
};

/**
 * Single centralized navbar-bell feed — ControlPlane (control.Notification/NotificationRecipient)
 * is now the ONLY notification store: every event, regardless of which service/DB it originated
 * in (Tenant's Data Share/Data Quality, or ControlPlane-native access/role change), is written
 * here at the moment it happens. Read/unread state is real and persisted (IsRead), not a
 * client-only localStorage cursor.
 */
@Injectable({ providedIn: 'root' })
export class ControlPlaneNotificationsService implements NotificationSource {
  private readonly baseUrl = environment.controlPlaneApiUrl;

  constructor(private readonly http: HttpClient) {}

  getNotifications(sinceIso: string): Observable<NotificationsFeed> {
    const params = new HttpParams().set('since', sinceIso);
    return this.http.get<RawNotificationsResponse>(`${this.baseUrl}/notifications`, { params }).pipe(
      map(res => ({
        unseenCount: res?.unreadCount ?? 0,
        items: (res?.items ?? []).map(item => ({
          id: String(item.id),
          type: TYPE_ICON_MAP[item.type] ?? 'report',
          title: item.title,
          description: item.description ?? '',
          changedAt: item.createdAt,
          isRead: item.isRead,
          route: item.route ?? undefined,
        })),
      })),
    );
  }

  markAsRead(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/notifications/${id}/read`, {});
  }

  markAllAsRead(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/notifications/read-all`, {});
  }
}

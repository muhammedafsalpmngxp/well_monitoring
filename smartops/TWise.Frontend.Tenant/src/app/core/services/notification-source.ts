import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { NotificationsFeed } from '../models/notification.model';

/**
 * Pluggable navbar-bell feed — one implementation per backend notification-aggregator endpoint
 * (Tenant, ControlPlane, ...). Register additional sources via the NOTIFICATION_SOURCES
 * multi-provider token in app.config.ts; NotificationsAggregatorService polls every registered
 * source in parallel and merges them into one list/badge — a new backend service only needs to
 * add its own provider entry here, navbar.component.ts never needs to change.
 */
export interface NotificationSource {
  getNotifications(sinceIso: string): Observable<NotificationsFeed>;
}

export const NOTIFICATION_SOURCES = new InjectionToken<NotificationSource[]>('NOTIFICATION_SOURCES');

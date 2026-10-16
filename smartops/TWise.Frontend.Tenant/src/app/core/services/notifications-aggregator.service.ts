import { Inject, Injectable, Optional } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { NotificationItem, NotificationsFeed } from '../models/notification.model';
import { NOTIFICATION_SOURCES, NotificationSource } from './notification-source';

/**
 * Merges every registered NOTIFICATION_SOURCES into one navbar-bell poll. Backend call count
 * stays fixed at "one per registered source" (currently 2: Tenant + ControlPlane) no matter how
 * many notification TYPES get added later inside each backend — new types piggyback on the
 * existing per-service aggregator endpoint instead of registering a new frontend source.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsAggregatorService {
  constructor(@Optional() @Inject(NOTIFICATION_SOURCES) private readonly sources: NotificationSource[] | null) {}

  pollAll(sinceIso: string) {
    const sources = this.sources ?? [];
    if (sources.length === 0) return of<NotificationsFeed>({ unseenCount: 0, items: [] });

    return forkJoin(
      sources.map(source =>
        source.getNotifications(sinceIso).pipe(
          catchError(() => of<NotificationsFeed>({ unseenCount: 0, items: [] })),
        ),
      ),
    ).pipe(
      map(feeds => {
        const items: NotificationItem[] = feeds
          .flatMap(f => f.items)
          .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
        const unseenCount = feeds.reduce((sum, f) => sum + f.unseenCount, 0);
        return { unseenCount, items };
      }),
    );
  }
}

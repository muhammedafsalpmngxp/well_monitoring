import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Lets any component (e.g. after a Data Quality rule trigger succeeds) tell the navbar bell to
 * poll immediately instead of waiting for its 60s timer or a manual bell click — the two live in
 * unrelated parts of the component tree, so this is a small shared pub/sub bridge between them.
 */
@Injectable({ providedIn: 'root' })
export class NotificationRefreshService {
  private readonly refreshRequested = new Subject<void>();
  readonly refreshRequested$ = this.refreshRequested.asObservable();

  requestRefresh(): void {
    this.refreshRequested.next();
  }
}

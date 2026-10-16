import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BreadcrumbService } from './breadcrumb.service';

/**
 * Manages the active well detail overlay state.
 * Any code (Angular or legacy globals) can call open()/close().
 * WellDetailOverlayComponent subscribes to activeWellId$ and renders the overlay.
 */
@Injectable({ providedIn: 'root' })
export class WellDetailService {
  private activeWell = new BehaviorSubject<string | null>(null);

  /** Emits the currently-open well ID, or null when the overlay is closed. */
  readonly activeWellId$ = this.activeWell.asObservable();

  /** True while the trail's last entry is the step this service pushed —
   *  guards close() so it only pops a crumb it actually owns. */
  private ownsLastCrumb = false;

  constructor(private readonly breadcrumb: BreadcrumbService) {}

  /** Open the well detail overlay for the given well ID. The overlay never
   *  changes the URL, so it's tracked as its own breadcrumb step rather than
   *  through router navigation. */
  open(wellId: string): void {
    this.activeWell.next(wellId);
    this.breadcrumb.push({
      label: `Well ${wellId}`,
      onActivate: () => this.close(),
      onLeave: () => { this.ownsLastCrumb = false; this.activeWell.next(null); }
    });
    this.ownsLastCrumb = true;
  }

  /** Close the well detail overlay (e.g. its own close button). Also drops
   *  the breadcrumb step it added, unless that step was already removed by
   *  a breadcrumb click or a fresh navigation (see onLeave above). */
  close(): void {
    this.activeWell.next(null);
    if (this.ownsLastCrumb) {
      this.ownsLastCrumb = false;
      this.breadcrumb.pop();
    }
  }
}

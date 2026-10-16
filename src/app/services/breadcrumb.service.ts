import { Injectable } from '@angular/core';

export interface BreadcrumbStep {
  label: string;
  /** URL to navigate to when an earlier step is clicked. Omitted for
   *  non-route steps (e.g. an overlay) — clicking those just runs onActivate. */
  url?: string;
  /** Run when this step is clicked directly (e.g. close an overlay in place). */
  onActivate?: () => void;
  /** Run when this step is dropped from the trail — either because an earlier
   *  crumb was clicked (truncating everything after it) or because a fresh,
   *  unrelated navigation reset the whole trail. Used to close overlays that
   *  don't have a URL of their own to navigate away from. */
  onLeave?: () => void;
}

/**
 * Tracks the user's actual click-through path (e.g. Standard Boards →
 * Operations Dashboard → Well Detail) so the shared breadcrumb in
 * AppComponent can render it with every step but the current one clickable.
 *
 * Two ways a step gets added:
 *  - queuePush(label) right before a router navigation — the page that loads
 *    is appended to the trail instead of replacing it (a "drill down").
 *  - push(step) directly, for state that isn't a route at all (e.g. the
 *    well-detail overlay, which never changes the URL).
 *
 * Any *other* navigation (sidebar, topbar, typing a URL, refresh) resets the
 * trail to just that page — it's a fresh starting point, not a drill-down.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  trail: BreadcrumbStep[] = [];

  private pendingPushLabel: string | null = null;
  /** Only set right before we actually call navigate() with a *different*
   *  URL than the current one — so it's guaranteed to be consumed by the
   *  NavigationEnd it caused, and never leaks into a later, unrelated
   *  navigation (that leak was the "second back-click does nothing" bug:
   *  going back from an overlay-only step, e.g. Well Detail, doesn't change
   *  the URL, so no NavigationEnd ever fires to clear the flag). */
  private holdNextReset = false;

  /** Call right before router.navigate(...) to mark the destination as a
   *  drill-down step that extends the trail rather than resetting it. */
  queuePush(label: string): void {
    this.pendingPushLabel = label;
  }

  /** Append a non-route step (e.g. an overlay) onto the trail immediately. */
  push(step: BreadcrumbStep): void {
    this.trail = [...this.trail, step];
  }

  /** Drop the last step — e.g. when an overlay is closed by its own close button. */
  pop(): void {
    this.trail = this.trail.slice(0, -1);
  }

  /** Jump back to an earlier step: truncate the trail, clean up whatever the
   *  dropped steps owned (e.g. close an overlay), then navigate only if the
   *  step's URL actually differs from where we already are — clicking back
   *  from a same-URL overlay step must NOT wait on a NavigationEnd that will
   *  never come. */
  goTo(index: number, currentUrl: string, navigate: (url: string) => void): void {
    const step = this.trail[index];
    if (!step) return;
    const removed = this.trail.slice(index + 1);
    this.trail = this.trail.slice(0, index + 1);
    removed.forEach(s => s.onLeave?.());
    if (step.onActivate) step.onActivate();
    if (step.url && step.url !== currentUrl) {
      this.holdNextReset = true;
      navigate(step.url);
    }
  }

  /** Called by AppComponent on every router NavigationEnd. */
  resolveRouteChange(defaultLabel: string, url: string): void {
    if (this.holdNextReset) {
      this.holdNextReset = false;
      return;
    }
    if (this.pendingPushLabel) {
      this.trail = [...this.trail, { label: this.pendingPushLabel, url }];
      this.pendingPushLabel = null;
      return;
    }
    this.trail.forEach(s => s.onLeave?.());
    this.trail = [{ label: defaultLabel, url }];
  }
}

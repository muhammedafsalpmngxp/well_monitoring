import { Injectable } from '@angular/core';

export interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

const STORAGE_PREFIX = 'dashboard_widget_scroll_positions';

/**
 * Remembers each widget's own internal scroll position (not the page scroll) across a widget's
 * content being torn down and rebuilt — e.g. a chart-type switch or a filter-triggered reload
 * toggles `*ngIf="card.dataReady"`, which destroys and recreates the scrollable element itself,
 * so the browser's native scroll memory is lost even though the widget (same stable key) is
 * still logically the same one. Scoped per dashboard id so two dashboards with similarly-named
 * widgets never collide. Backed by sessionStorage (survives a page refresh within the tab,
 * cleared when the tab closes) since this is ephemeral view state, not data worth persisting to
 * the backend.
 */
@Injectable({ providedIn: 'root' })
export class DashboardScrollStateService {
  private readonly byDashboard = new Map<string, Map<string, ScrollPosition>>();
  private readonly loadedDashboards = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  get(dashboardId: string | number, widgetKey: string): ScrollPosition | undefined {
    return this.mapFor(dashboardId).get(widgetKey);
  }

  set(dashboardId: string | number, widgetKey: string, position: ScrollPosition): void {
    this.mapFor(dashboardId).set(widgetKey, position);
    this.schedulePersist(dashboardId);
  }

  remove(dashboardId: string | number, widgetKey: string): void {
    if (this.mapFor(dashboardId).delete(widgetKey)) this.schedulePersist(dashboardId);
  }

  private mapFor(dashboardId: string | number): Map<string, ScrollPosition> {
    const id = String(dashboardId);
    if (!this.loadedDashboards.has(id)) {
      this.loadedDashboards.add(id);
      this.byDashboard.set(id, this.readFromStorage(id));
    }
    return this.byDashboard.get(id)!;
  }

  private storageKey(dashboardId: string): string {
    return `${STORAGE_PREFIX}:${dashboardId}`;
  }

  private readFromStorage(dashboardId: string): Map<string, ScrollPosition> {
    try {
      const raw = sessionStorage.getItem(this.storageKey(dashboardId));
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, ScrollPosition>;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  // Debounced so a burst of scroll events (even though each one is already rAF-throttled by the
  // directive) coalesces into a single JSON.stringify + sessionStorage write.
  private schedulePersist(dashboardId: string | number): void {
    const id = String(dashboardId);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const map = this.byDashboard.get(id);
      if (!map) return;
      try {
        sessionStorage.setItem(this.storageKey(id), JSON.stringify(Object.fromEntries(map)));
      } catch { /* storage unavailable/full — scroll memory just won't survive a refresh */ }
    }, 250);
  }
}

import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Route leaf paths whose component instance (and therefore its in-memory state — expanded
 * accordion groups, filters, scroll position) should be kept alive when the user navigates
 * away to a detail page, so that "Back" restores the exact same state instead of a freshly
 * re-initialized page.
 */
const REUSABLE_PATHS = new Set([
  'standard-boards',
  'wip-boards',
  'standard-charts',
  'wip-charts',
  'standard-tiles',
  'wip-tiles',
  'standard-reports',
  'my-reports',
]);

@Injectable({ providedIn: 'root' })
export class ListRouteReuseStrategy extends RouteReuseStrategy {
  private readonly handles = new Map<string, DetachedRouteHandle>();

  /** Discard all detached component instances (call on logout) so the next visit to a
   *  reusable list route creates a fresh component instead of reattaching stale/previous-user data. */
  clear(): void {
    this.handles.clear();
  }

  /** Drop a single cached list route so its next visit re-initializes with fresh data.
   *  Call after a create/update/delete so the listing reflects the change without a manual reload. */
  invalidate(path: string): void {
    this.handles.delete(path);
  }

  private key(route: ActivatedRouteSnapshot): string | null {
    const path = route.routeConfig?.path;
    return path && REUSABLE_PATHS.has(path) ? path : null;
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.key(route) !== null;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = this.key(route);
    if (!key) return;
    if (handle) this.handles.set(key, handle);
    else this.handles.delete(key);
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.key(route);
    return !!key && this.handles.has(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.key(route);
    return key ? this.handles.get(key) ?? null : null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}

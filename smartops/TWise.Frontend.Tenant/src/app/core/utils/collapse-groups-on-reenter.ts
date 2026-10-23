import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * These list routes are kept alive by ListRouteReuseStrategy, so their component is reattached on
 * revisit without re-running ngOnInit. This collapses every accordion group each time the route is
 * (re)entered, so a category left open before navigating away never stays expanded on return.
 * Returning with Back (history navigation) is the exception: the page is left exactly as it was.
 *
 * The caller owns the returned Subscription and must unsubscribe in ngOnDestroy.
 */
export function collapseGroupsOnReenter(
  router: Router,
  routePaths: readonly string[],
  getGroups: () => readonly { expanded: boolean }[],
  onChanged: () => void,
  onReenter?: () => void,
): Subscription {
  let viaBack = false;
  return router.events
    .pipe(filter((e): e is NavigationStart | NavigationEnd => e instanceof NavigationStart || e instanceof NavigationEnd))
    .subscribe((e) => {
      if (e instanceof NavigationStart) {
        viaBack = e.navigationTrigger === 'popstate';
        return;
      }
      if (!routePaths.some(p => e.urlAfterRedirects.includes(`/${p}`))) return;
      if (viaBack) return;
      let changed = false;
      for (const group of getGroups()) {
        if (group.expanded) {
          group.expanded = false;
          changed = true;
        }
      }
      if (changed) onChanged();
      onReenter?.();
    });
}

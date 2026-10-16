import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * These list routes are kept alive by ListRouteReuseStrategy, so their component is reattached on
 * revisit without re-running ngOnInit — leaving the listing stale (e.g. a tile published elsewhere
 * never shows up, recently-viewed ordering never updates) until a manual hard refresh.
 *
 * This re-fetches the list each time the route is *re-entered* (not on the very first entry, which
 * ngOnInit already loads), so returning to the page always reflects the latest server state while
 * preserving the user's in-memory filters (active tab, sort, search).
 *
 * The caller owns the returned Subscription and must unsubscribe in ngOnDestroy.
 */
export function reloadListOnReenter(
  router: Router,
  routePaths: readonly string[],
  reload: () => void,
): Subscription {
  let seenInitialEntry = false;
  return router.events
    .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
    .subscribe((e) => {
      if (!routePaths.some(p => e.urlAfterRedirects.includes(`/${p}`))) return;
      // The first matching navigation is the initial entry that ngOnInit already loaded.
      if (!seenInitialEntry) { seenInitialEntry = true; return; }
      reload();
    });
}

import { ApplicationConfig, ErrorHandler, APP_INITIALIZER, inject } from '@angular/core';
import { provideRouter, withComponentInputBinding, withNavigationErrorHandler, withPreloading, RouteReuseStrategy } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHighcharts } from 'highcharts-angular';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { GlobalErrorHandlerService } from './core/services/global-error-handler.service';
import { PermissionService } from './core/services/permission.service';
import { NOTIFICATION_SOURCES } from './core/services/notification-source';
import { ControlPlaneNotificationsService } from './core/services/control-plane-notifications.service';
import { ListRouteReuseStrategy } from './core/services/list-route-reuse.strategy';
import { registerDefaultCustomRenderers } from './core/utils/advanced-chart-renderers';
import { registerInstalledVisuals } from './core/utils/installed-visual-renderers';
import { MarketplaceService } from './core/services/marketplace.service';
import { DashboardIdlePreloadingStrategy } from './core/services/dashboard-idle-preloading.strategy';

// Renderers for the "Custom Visual / Extensibility" chart type. Registered here, at module
// load, so they are in place before any chart builder or viewer reads the renderer list.
// Idempotent, so a hot reload cannot double-register and throw.
registerDefaultCustomRenderers();

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding(), withNavigationErrorHandler(
      navigationError => inject(ErrorHandler).handleError(navigationError.error),
    ), withPreloading(DashboardIdlePreloadingStrategy)),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
    { provide: RouteReuseStrategy, useExisting: ListRouteReuseStrategy },
    {
      provide: APP_INITIALIZER,
      useFactory: (ps: PermissionService) => () => ps.loadFromToken(),
      deps: [PermissionService],
      multi: true,
    },
    {
      // Visuals installed from the marketplace become renderers before the first chart is drawn.
      // Never blocks startup: an unauthenticated or failed call just leaves the built-in shapes,
      // and the marketplace screen re-registers after an install so no reload is needed.
      provide: APP_INITIALIZER,
      useFactory: (marketplace: MarketplaceService) => () =>
        firstValueFrom(marketplace.getInstalled().pipe(timeout(5000), catchError(() => of([]))))
          .then(visuals => registerInstalledVisuals(visuals))
          .catch(() => undefined),
      deps: [MarketplaceService],
      multi: true,
    },
    // Waterfall/Bubble/Gauge live in highcharts-more (not core). Treemap/Funnel/Histogram/Bullet/Sankey/
    // Timeline/Heatmap each need their own dedicated module, and accessibility is loaded last.
    // Loaded as ONE sequential chain (not parallel dynamic imports) — several of these modules
    // extend classes registered by highcharts-more, and firing all imports in parallel can race
    // with each other under Vite's dev bundling, intermittently throwing "Class extends value
    // undefined is not a constructor or null".
    provideHighcharts({ modules: () => [
      (async () => {
        await import('highcharts/esm/highcharts-more');
        await import('highcharts/esm/modules/funnel');
        await import('highcharts/esm/modules/treemap');
        await import('highcharts/esm/modules/histogram-bellcurve');
        await import('highcharts/esm/modules/solid-gauge');
        // Part of the installed highcharts package, not a new dependency; the canvas funnel needs it (plan 10).
        await import('highcharts/esm/modules/funnel');
        await import('highcharts/esm/modules/bullet');
        await import('highcharts/esm/modules/sankey');
        await import('highcharts/esm/modules/timeline');
        await import('highcharts/esm/modules/stock');
        await import('highcharts/esm/modules/map');
        await import('highcharts/esm/modules/flowmap');
        await import('highcharts/esm/modules/tiledwebmap');
        await import('highcharts/esm/modules/treegraph');
        await import('highcharts/esm/modules/heatmap');
        // Marketplace visuals added for chart-type parity: word cloud, item, variable pie,
        // sunburst (extends treemap, so after it) and pareto (derives from a base series).
        await import('highcharts/esm/modules/wordcloud');
        await import('highcharts/esm/modules/item-series');
        await import('highcharts/esm/modules/variable-pie');
        await import('highcharts/esm/modules/sunburst');
        await import('highcharts/esm/modules/pareto');
        // Accessibility loads LAST: it augments the series types registered above, so anything
        // imported after it would not be instrumented. It gives charts keyboard navigation and
        // screen-reader announcements, and removes Highcharts' "consider including
        // accessibility.js" console warning.
        return import('highcharts/esm/modules/accessibility');
      })(),
    ] }),
    // Navbar-bell notification source — ControlPlane's control.Notification/NotificationRecipient
    // is now the single centralized store for every notification type across all services.
    { provide: NOTIFICATION_SOURCES, useExisting: ControlPlaneNotificationsService, multi: true },
  ],
};

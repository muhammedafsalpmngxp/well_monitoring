import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Route,
  RouteConfigLoadEnd,
  RouteConfigLoadStart,
  Router,
} from '@angular/router';
import { ROUTES } from '../constants/route.constants';

@Injectable({ providedIn: 'root' })
export class RouteLoadingService {
  private readonly router = inject(Router);
  private readonly pendingRoutes = new Set<Route>();
  private readonly loading = signal(false);
  private readonly postLoginTransition = signal(false);
  readonly isLoading = computed(() => this.loading() || this.postLoginTransition());

  async navigateAfterLogin(): Promise<boolean> {
    this.postLoginTransition.set(true);
    try {
      return await this.router.navigate([`/${ROUTES.DASHBOARD}`]);
    } finally {
      this.postLoginTransition.set(false);
    }
  }

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof RouteConfigLoadStart) {
        // Idle preloading must not block the current page.
        if (this.router.currentNavigation()) {
          this.pendingRoutes.add(event.route);
        }
      } else if (event instanceof RouteConfigLoadEnd) {
        this.pendingRoutes.delete(event.route);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
      ) {
        // Failed or cancelled imports may not emit RouteConfigLoadEnd.
        this.pendingRoutes.clear();
      }

      this.loading.set(this.pendingRoutes.size > 0);
    });
  }
}

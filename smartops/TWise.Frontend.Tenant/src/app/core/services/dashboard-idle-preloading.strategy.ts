import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, from, of, switchMap } from 'rxjs';

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

@Injectable({ providedIn: 'root' })
export class DashboardIdlePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preloadWhenIdle'] !== true) {
      return of(null);
    }

    return from(this.waitForIdle()).pipe(switchMap(() => load()));
  }

  private waitForIdle(): Promise<void> {
    return new Promise(resolve => {
      const idleWindow = window as IdleWindow;
      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(() => resolve(), { timeout: 2000 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}

import { Injectable } from '@angular/core';

/**
 * Injects the original SPA's full JavaScript bundle (`assets/app-globals.js`)
 * into the document at app startup so every `renderXxx()` function it defines
 * is available before any page tries to use it.
 *
 * The original bundle uses many IIFEs and global function declarations on
 * `window` (e.g. `renderActivities`, `renderForecastAI`, `dbRenderList`, …).
 * Loading it once globally — exactly as the original page did — preserves
 * all the existing functionality without requiring a port to TypeScript.
 *
 * Subtle issue handled here: the bundle contains several
 * `document.addEventListener('DOMContentLoaded', fn)` calls. Because we load
 * the script AFTER Angular's DOM is already ready, those events would never
 * fire. We monkey-patch `document.addEventListener` so any DOMContentLoaded
 * listener added while the bundle is parsing is captured and invoked once
 * the bundle has finished initialising. The patch is removed afterwards.
 */
@Injectable({ providedIn: 'root' })
export class GlobalsLoaderService {
  private loaded = false;

  load(): Promise<void> {
    if (this.loaded) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const origAdd = document.addEventListener.bind(document);
      const pendingDcl: Array<() => void> = [];

      // Capture late DOMContentLoaded listeners
      (document as any).addEventListener = function (
        type: string,
        listener: any,
        options?: any
      ) {
        if (
          type === 'DOMContentLoaded' &&
          document.readyState !== 'loading' &&
          typeof listener === 'function'
        ) {
          pendingDcl.push(() => {
            try {
              listener.call(document, new Event('DOMContentLoaded'));
            } catch (e) {
              console.warn('[GlobalsLoaderService] DOMContentLoaded handler threw', e);
            }
          });
          return;
        }
        return origAdd(type, listener, options);
      };

      const finish = () => {
        document.addEventListener = origAdd;
        pendingDcl.forEach((cb) => cb());
        this.loaded = true;
        resolve();
      };

      const s = document.createElement('script');
      // Cache-bust per page-load so browsers don't serve stale data when the
      // bundled `assets/app-globals.js` changes between deploys.
      s.src = 'assets/app-globals.js?v=' + Date.now();
      s.async = false;
      s.defer = false;
      s.onload = () => setTimeout(() => {
        // Chain-load well-detail-live.js AFTER app-globals.js has fully run
        // so that its awShowDetail IIFE is already defined when we override it.
        const s2 = document.createElement('script');
        s2.src = 'assets/well-detail-live.js?v=' + Date.now();
        s2.async = false;
        s2.onload = () => finish();
        s2.onerror = () => finish(); // non-fatal — detail overlay falls back gracefully
        document.body.appendChild(s2);
      }, 0);
      s.onerror = (err) => {
        console.error('[GlobalsLoaderService] Failed to load app-globals.js', err);
        finish();
      };
      document.body.appendChild(s);
    });
  }
}

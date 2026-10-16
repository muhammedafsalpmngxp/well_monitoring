import { NgModule, Optional, SkipSelf } from '@angular/core';

/**
 * CoreModule — Singleton application-level services.
 *
 * In this Angular 22 project, core providers (HttpClient, interceptors,
 * error handler, router) are registered via app.config.ts using the
 * standalone provider API. This module acts as the organizational root
 * for the core/ folder.
 *
 * Do NOT import CoreModule into any feature module.
 */
@NgModule({})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule?: CoreModule) {
    if (parentModule) {
      throw new Error(
        'CoreModule has already been loaded. Import CoreModule in the root only.'
      );
    }
  }
}

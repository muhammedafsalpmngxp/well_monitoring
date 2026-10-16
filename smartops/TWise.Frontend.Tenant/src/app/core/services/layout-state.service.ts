import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Shared singleton that lets any routed component request sidebar
 * collapse/expand and react to the current sidebar state.
 */
@Injectable({ providedIn: 'root' })
export class LayoutStateService {
  private readonly _sidebarCollapsed = new BehaviorSubject<boolean>(false);
  readonly sidebarCollapsed$ = this._sidebarCollapsed.asObservable();

  get isCollapsed(): boolean { return this._sidebarCollapsed.value; }

  collapse(): void { this._sidebarCollapsed.next(true); }
  expand(): void   { this._sidebarCollapsed.next(false); }
  toggle(): void   { this._sidebarCollapsed.next(!this._sidebarCollapsed.value); }

  // ─── Active-nav override ────────────────────────────────────────────────
  // Some detail routes (e.g. a single board at /dashboard/operations-dashboard/:id)
  // aren't a sub-path of the list route that led there (/dashboard/wip-boards or
  // /dashboard/standard-boards), so the sidebar's routerLinkActive match on the
  // literal URL fails and the section loses its highlight. A detail component
  // can set this to the nav route it conceptually belongs to; the sidebar treats
  // that route as active too, in addition to whatever the URL literally matches.
  private readonly _activeNavOverride = new BehaviorSubject<string | null>(null);
  readonly activeNavOverride$ = this._activeNavOverride.asObservable();

  get activeNavOverride(): string | null { return this._activeNavOverride.value; }

  setActiveNavOverride(route: string | null): void { this._activeNavOverride.next(route); }
}

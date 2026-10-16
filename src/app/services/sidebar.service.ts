import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Shared sidebar collapse state so other parts of the shell (e.g. the
 * advanced filter) can collapse/expand the left menu, and the sidebar
 * stays in sync. Backed by localStorage so the choice persists.
 */
@Injectable({ providedIn: 'root' })
export class SidebarService {
  private static readonly KEY = 'sb-collapsed';

  private readonly _collapsed$ = new BehaviorSubject<boolean>(this.readInitial());
  /** Emits the current collapsed state (true = icon-only rail). */
  readonly collapsed$ = this._collapsed$.asObservable();

  get collapsed(): boolean { return this._collapsed$.value; }

  /** Set the collapsed state and persist it. */
  set(collapsed: boolean): void {
    if (collapsed === this._collapsed$.value) return;
    this._collapsed$.next(collapsed);
    try { localStorage.setItem(SidebarService.KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }

  toggle(): void { this.set(!this.collapsed); }
  collapse(): void { this.set(true); }
  expand(): void { this.set(false); }

  private readonly _mobileOpen$ = new BehaviorSubject<boolean>(false);
  /** Emits whether the sidebar is open as a mobile off-canvas drawer (<=1199px). */
  readonly mobileOpen$ = this._mobileOpen$.asObservable();

  get mobileOpen(): boolean { return this._mobileOpen$.value; }

  /** Session-only — the drawer always starts closed, no persistence. */
  toggleMobile(): void { this._mobileOpen$.next(!this._mobileOpen$.value); }
  openMobile(): void { this._mobileOpen$.next(true); }
  closeMobile(): void { this._mobileOpen$.next(false); }

  private readInitial(): boolean {
    try { return localStorage.getItem(SidebarService.KEY) === '1'; } catch { return false; }
  }
}

import { Component, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SidebarService } from '../../services/sidebar.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements AfterViewInit, OnDestroy {
  private sub?: Subscription;
  private collapseSub?: Subscription;
  private mobileOpenSub?: Subscription;

  /** Whether the sidebar is collapsed to an icon-only rail. */
  collapsed = false;
  /** Whether the sidebar is open as a mobile off-canvas drawer (<=1199px). */
  mobileOpen = false;

  constructor(
    private el: ElementRef<HTMLElement>,
    private router: Router,
    private sidebarSvc: SidebarService,
    private auth: AuthService
  ) {
    this.collapsed = this.sidebarSvc.collapsed;
    this.collapseSub = this.sidebarSvc.collapsed$.subscribe(v => this.collapsed = v);
    this.mobileOpen = this.sidebarSvc.mobileOpen;
    this.mobileOpenSub = this.sidebarSvc.mobileOpen$.subscribe(v => this.mobileOpen = v);
  }

  /** Admin sees renamed board listings (Published / WIP); others keep the defaults. */
  get isAdmin(): boolean {
    return (this.auth.currentUser?.role || '').toLowerCase() === 'admin';
  }
  get boardsStandardLabel(): string { return this.isAdmin ? 'Published Boards' : 'Standard Boards'; }
  get boardsMyLabel(): string { return this.isAdmin ? 'WIP Boards' : 'My Boards'; }
  get chartsStandardLabel(): string { return this.isAdmin ? 'Published Charts' : 'Standard Charts'; }
  get chartsMyLabel(): string { return this.isAdmin ? 'WIP Charts' : 'My Charts'; }
  /** Tiles menus: visible to admin and Site MGT (Sujith); labels vary by role. */
  get isSiteMgt(): boolean { return (this.auth.currentUser?.role || '').toLowerCase() === 'site mgt'; }
  get showTiles(): boolean { return this.isAdmin || this.isSiteMgt; }
  get tilesStandardLabel(): string { return this.isAdmin ? 'Published Tiles' : 'Standard Tiles'; }
  get tilesMyLabel(): string { return this.isAdmin ? 'WIP Tiles' : 'My Tiles'; }
  get reportsStandardLabel(): string { return this.isAdmin ? 'Published Reports' : 'Standard Reports'; }

  /** Toggle between the full sidebar and the icon-only rail. */
  toggleCollapsed(): void {
    this.sidebarSvc.toggle();
  }

  /** Close the mobile off-canvas drawer (backdrop click, or after navigating). */
  closeMobile(): void {
    this.sidebarSvc.closeMobile();
  }

  /** "Standard Reports" → the same Reports card list, on its own route
      (/standardreports) so it can be shown/hidden per role independently of
      "All Reports" (/reports). Closes any open report modal first. */
  openStandardReports(): void {
    const w = window as any;
    try { if (typeof w.__reportsCloseModal === 'function') w.__reportsCloseModal(); } catch { /* no-op */ }
    // Prefer the Angular router; fall back to the global navigate used by other items.
    this.router.navigate(['/standardreports']).then(ok => {
      if (!ok && typeof w.navigate === 'function') w.navigate('standardreports');
    }).catch(() => { if (typeof w.navigate === 'function') w.navigate('standardreports'); });
    if (this.mobileOpen) this.closeMobile();
  }

  /** Standard Boards / My Boards listing pages (card galleries). */
  goStandardBoards(): void { this.navTo('standardboards'); }
  goMyBoards(): void { this.navTo('myboards'); }
  /** Standard Charts / My Charts listing pages (card galleries). */
  goStandardCharts(): void { this.navTo('standardcharts'); }
  goMyCharts(): void { this.navTo('mycharts'); }
  /** Published Tiles / WIP Tiles listing pages (KPI-tile galleries, admin). */
  goPublishedTiles(): void { this.navTo('publishedtiles'); }
  goWipTiles(): void { this.navTo('wiptiles'); }
  /** Standard Reports / My Reports listing pages (card galleries). */
  goStandardReports(): void { this.navTo('standardreports'); }
  goMyReports(): void { this.navTo('myreports'); }
  /** Smart Alerts (top-level menu). */
  goSmartAlerts(): void { this.navTo('smartalerts'); }
  /** Settings → Database Views listing page. */
  goDbViews(): void { this.navTo('db-views'); }
  /** Smart Alerts → Alert Rule Configuration page. */
  goAlertRules(): void { this.navTo('alert-rules'); }

  /** Reliable navigation via the Angular router, with a global-navigate fallback. */
  private navTo(page: string): void {
    const w = window as any;
    this.router.navigate(['/' + page]).then(ok => {
      if (!ok && typeof w.navigate === 'function') w.navigate(page);
    }).catch(() => { if (typeof w.navigate === 'function') w.navigate(page); });
    if (this.mobileOpen) this.closeMobile();
  }

  /** On mobile, navigating to a leaf item should close the drawer automatically. */
  onNavClick(ev: Event): void {
    if (!this.mobileOpen) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest('.sb-sub-item') || target?.closest('#sb-dashboards')) {
      this.closeMobile();
    }
  }

  ngAfterViewInit(): void {
    // While collapsed, clicking a group header (which only toggles a now-hidden
    // sub-menu) should expand the rail instead of doing nothing visible.
    this.el.nativeElement.addEventListener(
      'click',
      (ev: Event) => {
        if (!this.collapsed) return;
        const target = ev.target as HTMLElement | null;
        const item = target?.closest('.sb-item') as HTMLElement | null;
        if (item && item.querySelector('.sb-item-arrow')) {
          ev.preventDefault();
          ev.stopPropagation();
          this.toggleCollapsed();
        }
      },
      true // capture phase so we run before the inline onclick handlers
    );

    // Populate the "My Boards" group with every dashboard created from BI Boards.
    // The renderer lives in app-globals.js (owns the dbDashboards collection);
    // retry briefly in case that script hasn't finished initialising yet.
    this.renderMyBoards();

    this.syncActiveFromUrl(this.router.url);

    this.sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        const url: string = (e.urlAfterRedirects || e.url || '').split('?')[0];
        this.syncActiveFromUrl(url);
      });
  }

  /**
   * Ask app-globals.js to render the dynamic sidebar sections: the BI-Boards
   * dashboards under "My Boards", plus the Standard/My charts under "Charts".
   */
  private renderMyBoards(attempt = 0): void {
    const boards = (window as any).sbRenderMyDashboards;
    const charts = (window as any).sbRenderCharts;
    const reports = (window as any).sbRenderStdReports;
    if (typeof boards === 'function' && typeof charts === 'function') {
      boards();
      charts();
      if (typeof reports === 'function') reports();
    } else if (attempt < 20) {
      setTimeout(() => this.renderMyBoards(attempt + 1), 100);
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.collapseSub?.unsubscribe();
    this.mobileOpenSub?.unsubscribe();
  }

  private syncActiveFromUrl(url: string): void {
    const pageId = (url || '').replace(/^\/+/, '').split('/')[0] || 'cmdoverview';
    const root = this.el.nativeElement;

    // Clear all sub-item and group-header active states
    root.querySelectorAll('.sb-sub-item').forEach((n) => n.classList.remove('active'));
    root.querySelectorAll('.sb-item').forEach((n) => n.classList.remove('active'));

    const sub = root.querySelector('#nav-' + pageId) as HTMLElement | null;
    if (sub) {
      // Only activate and expand the group if the item is actually visible
      const isVisible = sub.offsetParent !== null ||
        (getComputedStyle(sub).display !== 'none' && getComputedStyle(sub).visibility !== 'hidden');
      if (isVisible) {
        sub.classList.add('active');
        const groupSub = sub.closest('.sb-sub') as HTMLElement | null;
        if (groupSub) {
          groupSub.classList.add('open');
          const parentItem = groupSub.previousElementSibling as HTMLElement | null;
          if (parentItem) {
            parentItem.classList.add('active');
            const arrow = parentItem.querySelector('.sb-item-arrow');
            if (arrow) arrow.classList.add('open');
          }
        }
      }
    } else {
      const top = root.querySelector('#sb-' + pageId) as HTMLElement | null;
      if (top) top.classList.add('active');
    }
  }
}

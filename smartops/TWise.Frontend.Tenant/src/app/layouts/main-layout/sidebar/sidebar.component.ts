import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { MENU_STRUCTURE } from '../../../core/constants/menu.constants';
import { MenuGroup, MenuItem } from '../../../core/models/menu.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ProductTourService } from '../../../core/services/product-tour.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { FieldLabelDirective } from '../../../shared/directives/field-label.directive';
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule, FormsModule, RouterModule, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isCollapsed = false;

  /** Off-canvas drawer state on small screens — independent of the desktop icon-only collapse. */
  @Input() isMobileOpen = false;
  @Output() closeMobile = new EventEmitter<void>();

  menuGroups: MenuGroup[] = [];
  expandedItems = new Set<string>();
  searchTerm = '';
  promoAcknowledged = false;

  flyoutTop = 0;
  /** Arrow offset inside the flyout, so it still points at the icon after the panel is
   *  shifted up to fit the viewport (bottom items such as Settings). */
  flyoutArrowTop = 20;
  /** Bottom offset (px) for a flyout flipped to open upward (null when it opens downward). */
  flyoutBottom: number | null = null;
  private currentUrl = '';
  private readonly navSub: Subscription;
  private readonly overrideSub: Subscription;

  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly productTour: ProductTourService,
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly router: Router,
    private readonly layoutState: LayoutStateService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.currentUrl = this.router.url;
    this.navSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.currentUrl = event.urlAfterRedirects;
        this.closeFlyout();
        // Proactively clear on every navigation rather than only relying on
        // the *previous* detail page's ngOnDestroy — if that page's override
        // was set inside an async response handler, destroy can race it and
        // leave a stale value that (post the DETAIL_PAGE_PREFIXES gate above)
        // still gets trusted once the *next* page also happens to be a
        // detail page, wrongly highlighting the old page's section instead
        // of the new one. Clearing here first means the new page's own
        // detail-page setup (if any) is what re-sets it, once its data loads.
        this.layoutState.setActiveNavOverride(null);
        this.expandParentForActiveRoute();
      }
    });
    this.overrideSub = this.layoutState.activeNavOverride$.subscribe(() => {
      this.expandParentForActiveRoute();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.navSub.unsubscribe();
    this.overrideSub.unsubscribe();
  }

  // URL prefixes of the "detail" pages that are allowed to declare an
  // activeNavOverride (their own route has no matching sidebar entry, so they
  // borrow their conceptual parent section's highlight instead). Gating on
  // this set means a stale override — e.g. left behind if a detail page's
  // ngOnDestroy races an in-flight request instead of running before it
  // resolves — can never mis-highlight an unrelated section: once the URL
  // moves to a plain list page like /charts-tiles/wip-charts, the override
  // is simply ignored and the normal path-based check below takes over.
  private static readonly DETAIL_PAGE_PREFIXES = [
    '/dashboard/operations-dashboard/',
    '/charts-tiles/view/',
    '/charts-tiles/odc-overall-status/',
    '/reports/view/',
    '/settings/database-view/',
  ];

  /** Maps each top-level section to the `data-tour` id its sidebar icon is spotlighted
   *  under in ProductTourService's step list, so the product tour can walk through
   *  every section instead of just Dashboard. */
  private static readonly TOUR_IDS: Record<string, string> = {
    Dashboard: 'tour-dashboard',
    'Charts & Tiles': 'tour-charts-tiles',
    Reports: 'tour-reports',
    'BI Canvas': 'tour-bi-canvas',
    'Model Studio': 'tour-model-studio',
    'Smart Alerts': 'tour-smart-alerts',
    'Data Quality': 'tour-data-quality',
    'Agentic AI': 'tour-ai-assistant',
    'User & Role Management': 'tour-user-role-management',
    Settings: 'tour-settings',
    'AI Settings': 'tour-ai-settings',
  };

  tourIdFor(label: string): string | null {
    return SidebarComponent.TOUR_IDS[label] ?? null;
  }

  /** A submenu item is active if the URL matches it directly, or the current
   *  page is one of the known detail pages above and has declared this route
   *  as its conceptual parent section (see LayoutStateService.activeNavOverride). */
  isChildActive(route?: string): boolean {
    if (!route) return false;
    const path = this.currentUrl.split('?')[0].split('#')[0];
    if (path === route) return true;
    if (path.startsWith('/dashboard/activity-breakdown/')) return route === '/dashboard/crew-calendar';
    const onDetailPage = SidebarComponent.DETAIL_PAGE_PREFIXES.some(prefix => path.startsWith(prefix));
    return onDetailPage && this.layoutState.activeNavOverride === route;
  }

  /** A parent (group) item is active when the current route belongs to one of its children —
   *  so the collapsed rail's icon stays highlighted for the section you're in, not just while
   *  its flyout happens to be open. */
  isParentActive(item: MenuItem): boolean {
    if (item.children?.some(child => this.isChildActive(child.route))) return true;
    if (!item.children?.length) return false;
    // AI Settings pages live under /settings too: don't light up Settings when another group owns the page.
    if (this.menuGroups.some(g => g.items.some(other => other !== item && other.children?.some(c => this.isChildActive(c.route))))) return false;
    const base = '/' + (item.children[0]?.route ?? '').split('/').filter(Boolean)[0];
    const path = this.currentUrl.split('?')[0].split('#')[0];
    return path === base || path.startsWith(base + '/');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isCollapsed'] && this.isCollapsed) {
      this.expandedItems.clear();
    }
    if (changes['isCollapsed'] && !this.isCollapsed) {
      this.expandParentForActiveRoute();
    }
  }

  /** Collapsed sidebar only: clicking outside the flyout closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isCollapsed || this.expandedItems.size === 0) return;
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.expandedItems.clear();
    }
  }

  ngOnInit(): void {
    this.permissionService.loadFromToken();
    this.menuGroups = this.filterMenuByPermissions(MENU_STRUCTURE);
    if (!this.isCollapsed) {
      this.expandParentForActiveRoute();
    }
  }

  private filterMenuByPermissions(groups: MenuGroup[]): MenuGroup[] {
    const isAdmin = this.permissionService.isAdminUser;
    return groups.map(group => ({
      ...group,
      items: group.items
        .map(item => ({
          ...item,
          children: item.children
            ?.filter(child => (!child.adminOnly || isAdmin) && (!child.moduleCode || this.permissionService.canView(child.moduleCode)))
            .map(child => {
              if (isAdmin || !child.label.startsWith('WIP')) return child;
              return { ...child, label: child.label.replace('WIP', 'My') };
            }),
        }))
        .filter(item => !item.children || item.children.length > 0),
    }));
  }

  /** Menu, filtered down to items/children whose label matches the search box. */
  get filteredGroups(): MenuGroup[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.menuGroups;

    return this.menuGroups
      .map(group => {
        const items = group.items
          .map(item => {
            if (item.label.toLowerCase().includes(term)) return item;
            const children = item.children?.filter(c => c.label.toLowerCase().includes(term));
            return children?.length ? { ...item, children } : null;
          })
          .filter((item): item is MenuItem => !!item);
        return { ...group, items };
      })
      .filter(group => group.items.length > 0);
  }

  /** Collapsed sidebar only: navigating from the flyout should close it. */
  closeFlyout(): void {
    if (this.isCollapsed) this.expandedItems.clear();
  }

  toggleItem(item: MenuItem, event?: MouseEvent): void {
    const shouldExpand = !this.expandedItems.has(item.label);
    this.expandedItems.clear();
    if (shouldExpand) {
      this.expandedItems.add(item.label);
      if (this.isCollapsed && event) {
        // getBoundingClientRect() already returns zoomed/visual pixels; dividing by the
        // zoom factor avoids double-applying it when re-assigned as a style inside the
        // zoomed <app-root> subtree (same pattern as report-builder's fixed dropdowns).
        const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')) || 1;
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const anchorTop = rect.top / zoom;
        this.flyoutTop = anchorTop;
        this.flyoutArrowTop = 20;
        // Once rendered, pull the panel up if it would run past the bottom of the window.
        requestAnimationFrame(() => {
          const flyout = this.elementRef.nativeElement.querySelector<HTMLElement>('.sidebar__flyout');
          if (!flyout) return;
          const margin = 12;
          const viewportH = window.innerHeight / zoom;
          const top = Math.max(margin, Math.min(anchorTop, viewportH - flyout.offsetHeight - margin));
          this.flyoutTop = top;
          this.flyoutArrowTop = Math.min(Math.max(anchorTop - top + 20, 14), flyout.offsetHeight - 28);
          this.cdr.markForCheck();
        });
      }
      // Navigate to first child when expanding a parent that isn't already active
      // if (!this.isParentActive(item) && item.children?.length) {
      //   this.router.navigateByUrl(item.children[0].route!);
      // }
    }
  }

  /** A group is shown expanded either because the user opened it, or because
      an active search has narrowed its children down to matching results. */
  isExpanded(label: string): boolean {
    return !!this.searchTerm.trim() || this.expandedItems.has(label);
  }

  private expandParentForActiveRoute(): void {
    if (this.isCollapsed) return;
    for (const group of this.menuGroups) {
      for (const item of group.items) {
        if (this.isParentActive(item) && !this.expandedItems.has(item.label)) {
          this.expandedItems.add(item.label);
          return;
        }
      }
    }
  }

  hasChildren(item: MenuItem): boolean {
    return !!(item.children && item.children.length > 0);
  }

  acknowledgePromo(): void {
    this.promoAcknowledged = true;
    this.searchTerm = '';
    const targets: string[] = [];
    const pageTitles: Record<string, string> = {};
    for (const group of this.menuGroups) {
      for (const item of group.items) {
        const visibleChildren = item.children?.filter(child => !child.hidden && child.route) ?? [];
        const moduleTourId = this.tourIdFor(item.label);
        if (moduleTourId && visibleChildren.length) {
          targets.push(`[data-tour="${moduleTourId}"]`);
        }
        for (const child of visibleChildren) {
          if (!child.route) continue;
          targets.push(`[data-tour-page="${child.route}"]`);
          pageTitles[child.route] = child.label;
        }
      }
    }

    if (this.permissionService.canCreate('dashboard.wip-boards')) {
      targets.push('[data-tour="tour-new-dashboard"]');
    }
    if (this.permissionService.canView('dashboard.wip-boards')) {
      targets.push('[data-tour="tour-filters"]');
    }
    if (this.permissionService.canView('dashboard.categories')) {
      targets.push('[data-tour="tour-manage-category"]');
    }

    this.productTour.start(targets, pageTitles);
  }
}

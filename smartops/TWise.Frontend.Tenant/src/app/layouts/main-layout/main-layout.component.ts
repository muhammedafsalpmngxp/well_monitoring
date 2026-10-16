import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NavbarComponent } from './navbar/navbar.component';
import { LayoutStateService } from '../../core/services/layout-state.service';
import { ProductTourComponent } from '../../shared/components/product-tour/product-tour.component';
import { AskAiPanelComponent } from '../../shared/components/ask-ai-panel/ask-ai-panel.component';

/**
 * True when the deepest active route carries data: { fullBleed: true }. Such a route is a desktop-style
 * tool: the shell drops its padding, page scroll and footer, and collapses the sidebar.
 */
export function isFullBleed(root: ActivatedRouteSnapshot): boolean {
  let route = root;
  while (route.firstChild) route = route.firstChild;
  return route.data['fullBleed'] === true;
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, NavbarComponent, ProductTourComponent, AskAiPanelComponent],
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
})
export class MainLayoutComponent implements OnInit {
  isSidebarCollapsed = false;
  isMobileSidebarOpen = false;
  /** The routed page fills the content area edge to edge, with no footer. */
  fullBleed = false;
  /** The sidebar state from before the first full-bleed page, put back when the user leaves such pages. */
  private sidebarBeforeFullBleed: boolean | null = null;

  constructor(
    private readonly layoutState: LayoutStateService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.layoutState.sidebarCollapsed$.subscribe(collapsed => {
      this.isSidebarCollapsed = collapsed;
    });
    // The shell lives as long as the session, like the subscription above. The first page may
    // already be active when the shell starts, so its flag is read at once as well.
    this.setFullBleed(isFullBleed(this.router.routerState.snapshot.root));
    this.router.events.pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => this.setFullBleed(isFullBleed(this.router.routerState.snapshot.root)));
  }

  /** Skip link: move focus past the sidebar and navbar to the page content (WCAG 2.4.1). */
  skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }

  toggleSidebar(): void {
    this.layoutState.toggle();
  }

  toggleMobileSidebar(): void {
    this.isMobileSidebarOpen = !this.isMobileSidebarOpen;
  }

  closeMobileSidebar(): void {
    this.isMobileSidebarOpen = false;
  }

  /** The builders' pattern, once for every full-bleed route: collapse on the way in, restore on the way out. */
  private setFullBleed(fullBleed: boolean): void {
    if (fullBleed === this.fullBleed) return;
    this.fullBleed = fullBleed;
    if (fullBleed) {
      this.sidebarBeforeFullBleed = this.layoutState.isCollapsed;
      this.layoutState.collapse();
    } else if (this.sidebarBeforeFullBleed !== null) {
      if (this.sidebarBeforeFullBleed) this.layoutState.collapse();
      else this.layoutState.expand();
      this.sidebarBeforeFullBleed = null;
    }
    this.cdr.markForCheck();
  }
}

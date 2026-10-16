import { Component, Input, OnChanges } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Breadcrumb } from '../../../core/models/breadcrumb.model';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-page-header',
  standalone: false,
  templateUrl: './page-header.component.html',
  styleUrls: ['./page-header.component.scss'],
})
export class PageHeaderComponent implements OnChanges {
  @Input() title = '';
  @Input() subtitle?: string;
  @Input() breadcrumbs: Breadcrumb[] = [];

  constructor(
    private readonly breadcrumbService: BreadcrumbService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd && this.isActiveRoute(this.router.routerState.root)) {
        this.breadcrumbService.set(this.breadcrumbs);
      }
    });
  }

  ngOnChanges(): void {
    this.breadcrumbService.set(this.breadcrumbs);
  }

  private isActiveRoute(route: ActivatedRoute): boolean {
    // Compare by routeConfig (a stable singleton), not instance: cached/reattached list pages
    // (ListRouteReuseStrategy) keep a stale ActivatedRoute, so instance equality would fail and
    // the breadcrumb would never refresh when switching back to a reused tab.
    if (route === this.route) return true;
    if (route.routeConfig && route.routeConfig === this.route.routeConfig) return true;
    return route.children.some(child => this.isActiveRoute(child));
  }
}

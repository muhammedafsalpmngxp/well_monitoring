import { Injectable, signal } from '@angular/core';
import { Breadcrumb } from '../models/breadcrumb.model';

/**
 * Lets each page's app-page-header publish its breadcrumb trail so the
 * navbar (a layout-level sibling, not an ancestor of the routed page) can
 * render it in the top header bar.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly crumbs = signal<Breadcrumb[]>([]);
  readonly breadcrumbs = this.crumbs.asReadonly();

  set(breadcrumbs: Breadcrumb[]): void {
    // Callers often pass a brand-new array/object literal on every change-detection cycle
    // (inline template arrays, getters) even when the content hasn't actually changed.
    // Skip the signal update in that case so the navbar's *ngFor doesn't keep tearing down
    // and recreating breadcrumb links — which was swallowing the first click on them.
    const current = this.crumbs();
    const changed = current.length !== breadcrumbs.length
      || current.some((c, i) => c.label !== breadcrumbs[i].label || c.route !== breadcrumbs[i].route);
    if (changed) this.crumbs.set(breadcrumbs);
  }
}

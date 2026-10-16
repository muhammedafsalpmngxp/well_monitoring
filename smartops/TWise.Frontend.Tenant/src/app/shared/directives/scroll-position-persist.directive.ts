import { AfterViewInit, Directive, ElementRef, Input, NgZone, OnDestroy } from '@angular/core';
import { DashboardScrollStateService } from '../../core/services/dashboard-scroll-state.service';

/**
 * Restores the host element's own scrollTop/scrollLeft (never the page scroll) once it's
 * (re)created, and keeps the stored value up to date as the user scrolls — so a widget whose
 * scrollable content gets destroyed and rebuilt (chart-type switch, filter-triggered reload,
 * drag/resize/reorder) comes back exactly where the user left it instead of snapping to the top.
 *
 * The key must be stable for the widget's lifetime (e.g. a chart's title/id) — never an array
 * index, since reordering would silently swap one widget's saved position onto another.
 */
@Directive({ selector: '[appScrollPositionPersist]', standalone: false })
export class ScrollPositionPersistDirective implements AfterViewInit, OnDestroy {
  /** Stable per-widget key. A falsy value (not yet known) disables persistence for this instance. */
  @Input('appScrollPositionPersist') widgetKey = '';
  /** Scopes the key so two dashboards with similarly-named widgets never collide. */
  @Input() scrollPositionDashboardId: string | number = 'default';

  private rafPending = false;
  private readonly onScroll = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (!this.widgetKey) return;
      const el = this.host.nativeElement;
      this.scrollState.set(this.scrollPositionDashboardId, this.widgetKey, {
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
      });
    });
  };

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly scrollState: DashboardScrollStateService,
    private readonly zone: NgZone,
  ) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.restore();
      this.host.nativeElement.addEventListener('scroll', this.onScroll, { passive: true });
    });
  }

  private restore(): void {
    if (!this.widgetKey) return;
    const saved = this.scrollState.get(this.scrollPositionDashboardId, this.widgetKey);
    if (!saved) return;
    const el = this.host.nativeElement;
    // Two frames: the first lets the just-created DOM (chart/table content) finish laying out,
    // the second restores into the now-settled, now-scrollable box — matches this codebase's
    // existing post-render settle pattern (see scheduleChartReflow in the board/dashboard builders).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = saved.scrollTop;
        el.scrollLeft = saved.scrollLeft;
      });
    });
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('scroll', this.onScroll);
  }
}

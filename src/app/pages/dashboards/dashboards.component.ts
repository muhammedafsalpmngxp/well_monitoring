import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-dashboards',
  templateUrl: './dashboards.component.html',
  styleUrls: ['./dashboards.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DashboardsComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['dbRenderList'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[dashboards] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

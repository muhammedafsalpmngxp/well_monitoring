import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-projoverview',
  templateUrl: './projoverview.component.html',
  styleUrls: ['./projoverview.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ProjOverviewComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderProjOverview'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[projoverview] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

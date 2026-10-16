import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

/**
 * Charts gallery page. Shows the seeded Standard Charts and the user-created
 * My Charts (rendered by window.chartsRenderPage in app-globals.js). The
 * "Add Chart" button opens the shared Custom Chart Builder in standalone mode.
 */
@Component({
  selector: 'app-charts',
  templateUrl: './charts.component.html',
  styleUrls: ['./charts.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ChartsComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['chartsRenderPage'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[charts] renderer threw', e); }
    }
  }

  addChart(): void {
    const fn = (window as any)['chartsAddChart'];
    if (typeof fn === 'function') fn();
  }

  ngOnDestroy(): void {}
}

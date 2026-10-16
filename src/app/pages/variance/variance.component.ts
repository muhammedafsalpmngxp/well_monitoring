import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-variance',
  templateUrl: './variance.component.html',
  styleUrls: ['./variance.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class VarianceComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderVariance'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[variance] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-delayforecast',
  templateUrl: './delayforecast.component.html',
  styleUrls: ['./delayforecast.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DelayForecastComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderDelayForecast'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[delayforecast] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

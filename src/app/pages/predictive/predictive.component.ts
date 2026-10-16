import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-predictive',
  templateUrl: './predictive.component.html',
  styleUrls: ['./predictive.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PredictiveComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderPredictive'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[predictive] renderer threw', e); }
    }
  }
}

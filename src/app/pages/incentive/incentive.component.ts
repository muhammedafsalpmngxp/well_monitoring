import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-incentive',
  templateUrl: './incentive.component.html',
  styleUrls: ['./incentive.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class IncentiveComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderIncentive'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[incentive] renderer threw', e); }
    }
  }
}

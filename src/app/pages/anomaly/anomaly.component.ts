import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-anomaly',
  templateUrl: './anomaly.component.html',
  styleUrls: ['./anomaly.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AnomalyComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderAnomaly'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[anomaly] renderer threw', e); }
    }
  }
}

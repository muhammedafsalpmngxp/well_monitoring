import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-jobcost',
  templateUrl: './jobcost.component.html',
  styleUrls: ['./jobcost.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class JobCostComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderJobCost'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[jobcost] renderer threw', e); }
    }
  }
}

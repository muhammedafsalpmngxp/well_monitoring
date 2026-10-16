import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-commission',
  templateUrl: './commission.component.html',
  styleUrls: ['./commission.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CommissionComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderCommission'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[commission] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

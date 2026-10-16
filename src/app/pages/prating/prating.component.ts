import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-prating',
  templateUrl: './prating.component.html',
  styleUrls: ['./prating.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PratingComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderPrating'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[prating] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

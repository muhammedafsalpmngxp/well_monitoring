import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-progopt',
  templateUrl: './progopt.component.html',
  styleUrls: ['./progopt.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ProgOptComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderProgOpt'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[progopt] renderer threw', e); }
    }
  }
}

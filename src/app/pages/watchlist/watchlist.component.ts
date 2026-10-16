import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-watchlist',
  templateUrl: './watchlist.component.html',
  styleUrls: ['./watchlist.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class WatchlistComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderWatchlistCharts'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[watchlist] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-scorecards',
  templateUrl: './scorecards.component.html',
  styleUrls: ['./scorecards.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ScorecardsComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderScorecards'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[scorecards] renderer threw', e); }
    }
  }
}

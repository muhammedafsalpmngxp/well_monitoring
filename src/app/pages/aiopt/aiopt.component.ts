import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-aiopt',
  templateUrl: './aiopt.component.html',
  styleUrls: ['./aiopt.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AiOptComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (globalThis as any)['renderAiOpt'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[aiopt] renderer threw', e); }
    }
  }
}

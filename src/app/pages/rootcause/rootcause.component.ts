import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-rootcause',
  templateUrl: './rootcause.component.html',
  styleUrls: ['./rootcause.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class RootCauseComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderRCA'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[rootcause] renderer threw', e); }
    }
  }
}

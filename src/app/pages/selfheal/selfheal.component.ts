import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-selfheal',
  templateUrl: './selfheal.component.html',
  styleUrls: ['./selfheal.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class SelfHealComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderSelfHeal'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[selfheal] renderer threw', e); }
    }
  }
}

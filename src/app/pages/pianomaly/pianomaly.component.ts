import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-pianomaly',
  templateUrl: './pianomaly.component.html',
  styleUrls: ['./pianomaly.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PiAnomalyComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['renderPiAnomaly'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[pianomaly] renderer threw', e); }
    }
  }
}

import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-predict',
  templateUrl: './predict.component.html',
  styleUrls: ['./predict.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PredictComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderPredict'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[predict] renderer threw', e); }
    }
  }
}

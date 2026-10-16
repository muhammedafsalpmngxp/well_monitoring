import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-datadict',
  templateUrl: './datadict.component.html',
  styleUrls: ['./datadict.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DataDictComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderDataDict'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[datadict] renderer threw', e); }
    }
  }
}

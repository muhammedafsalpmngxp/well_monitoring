import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-autopm',
  templateUrl: './autopm.component.html',
  styleUrls: ['./autopm.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AutoPmComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderAutoPM'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[autopm] renderer threw', e); }
    }
  }
}

import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-criticalpath',
  templateUrl: './criticalpath.component.html',
  styleUrls: ['./criticalpath.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CriticalPathComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderCriticalPath'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[criticalpath] renderer threw', e); }
    }
  }
}

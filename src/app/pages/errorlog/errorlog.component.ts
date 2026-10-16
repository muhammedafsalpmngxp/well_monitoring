import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-errorlog',
  templateUrl: './errorlog.component.html',
  styleUrls: ['./errorlog.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ErrorLogComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderErrorLog'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[errorlog] renderer threw', e); }
    }
  }
}

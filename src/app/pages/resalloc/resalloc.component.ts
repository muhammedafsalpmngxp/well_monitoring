import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-resalloc',
  templateUrl: './resalloc.component.html',
  styleUrls: ['./resalloc.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ResAllocComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderResAlloc'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[resalloc] renderer threw', e); }
    }
  }
}

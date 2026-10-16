import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-connections',
  templateUrl: './connections.component.html',
  styleUrls: ['./connections.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ConnectionsComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (globalThis as any)['renderConnections'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[connections] renderer threw', e); }
    }
  }
}

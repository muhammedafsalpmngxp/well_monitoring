import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-flowdesigner',
  templateUrl: './flowdesigner.component.html',
  styleUrls: ['./flowdesigner.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class FlowDesignerComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;333333333333333333333333333333333333333333333333333333333
    

    // Call page renderer
    const fn = (globalThis as any)['renderFlowDesigner'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[flowdesigner] renderer threw', e); }
    }
  }
}

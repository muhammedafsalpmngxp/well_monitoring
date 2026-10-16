import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-flowedit',
  templateUrl: './flowedit.component.html',
  styleUrls: ['./flowedit.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class FlowEditComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderFlowEdit'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[flowedit] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

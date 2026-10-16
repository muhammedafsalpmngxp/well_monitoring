import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-aiagent-edit',
  templateUrl: './aiagent-edit.component.html',
  styleUrls: ['./aiagent-edit.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AiAgentEditComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderAIAgentEdit'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[aiagent-edit] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

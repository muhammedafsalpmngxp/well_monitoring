import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-crewassign',
  templateUrl: './crewassign.component.html',
  styleUrls: ['./crewassign.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewAssignComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderCrewAssign'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[crewassign] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

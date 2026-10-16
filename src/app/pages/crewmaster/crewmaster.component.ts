import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-crewmaster',
  templateUrl: './crewmaster.component.html',
  styleUrls: ['./crewmaster.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewMasterComponent implements AfterViewInit, OnDestroy {

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['renderCrewMaster'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[crewmaster] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

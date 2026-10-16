import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-crewopt',
  templateUrl: './crewopt.component.html',
  styleUrls: ['./crewopt.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewOptComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['renderCrewOpt'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[crewopt] renderer threw', e); }
    }
  }
}

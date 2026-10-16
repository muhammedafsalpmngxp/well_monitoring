import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-crewpi',
  templateUrl: './crewpi.component.html',
  styleUrls: ['./crewpi.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewPiComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['renderCrewPi'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[crewpi] renderer threw', e); }
    }
  }
}

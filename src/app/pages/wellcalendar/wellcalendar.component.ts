import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-wellcalendar',
  templateUrl: './wellcalendar.component.html',
  styleUrls: ['./wellcalendar.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class WellCalendarComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['renderWellCalendar'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[wellcalendar] renderer threw', e); }
    }
  }
}

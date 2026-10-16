import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { TranslateService, LangChangeEvent } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-crewcalendar',
  templateUrl: './crewcalendar.component.html',
  styleUrls: ['./crewcalendar.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewCalendarComponent implements AfterViewInit, OnDestroy {

  private langSub?: Subscription;

  constructor(private translate: TranslateService) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    this.render();

    this.langSub = this.translate.onLangChange.subscribe((_e: LangChangeEvent) => {
      this.render();
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private render(): void {
    const fn = (window as any)['renderCrewCalendar'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[crewcalendar] renderer threw', e); }
    }
  }
}

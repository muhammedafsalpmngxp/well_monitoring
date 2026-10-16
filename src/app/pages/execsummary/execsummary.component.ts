import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-execsummary',
  templateUrl: './execsummary.component.html',
  styleUrls: ['./execsummary.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ExecSummaryComponent implements AfterViewInit, OnDestroy {

  briefingDate: string = '';

  constructor(private translate: TranslateService) {
    this.refreshBriefingDate();
  }

  private refreshBriefingDate(): void {
    const lang = this.translate.currentLang || this.translate.getDefaultLang() || 'en';
    const locale = lang === 'ar' ? 'ar-EG' : 'en-GB';
    this.briefingDate = new Date().toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  ngAfterViewInit(): void {
    this.refreshBriefingDate();

    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Call page renderer
    const fn = (window as any)['execRender'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[execsummary] renderer threw', e); }
    }
  }

  ngOnDestroy(): void {}
}

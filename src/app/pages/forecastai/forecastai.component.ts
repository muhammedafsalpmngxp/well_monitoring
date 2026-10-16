import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-forecastai',
  templateUrl: './forecastai.component.html',
  styleUrls: ['./forecastai.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ForecastAiComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderForecastAI'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[forecastai] renderer threw', e); }
    }
  }
}

import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-perfanalysis',
  templateUrl: './perfanalysis.component.html',
  styleUrls: ['./perfanalysis.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class PerfAnalysisComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (window as any)['renderPerfAnalysis'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[perfanalysis] renderer threw', e); }
    }
  }
}

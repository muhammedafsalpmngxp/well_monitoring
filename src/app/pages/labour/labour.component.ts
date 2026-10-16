import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-labour',
  templateUrl: './labour.component.html',
  styleUrls: ['./labour.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class LabourComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const fn = (globalThis as any)['renderLabour'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[labour] renderer threw', e); }
    }
  }
}

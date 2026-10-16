import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { TranslateService, LangChangeEvent } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-aiagents',
  templateUrl: './aiagents.component.html',
  styleUrls: ['./aiagents.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AiAgentsComponent implements AfterViewInit, OnDestroy {

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
    const fn = (window as any)['renderAIAgents'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[aiagents] renderer threw', e); }
    }
  }
}

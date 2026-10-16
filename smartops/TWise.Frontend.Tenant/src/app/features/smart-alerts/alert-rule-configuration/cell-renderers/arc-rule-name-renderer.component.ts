import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { AlertRule } from '../../alert-rule.service';

@Component({
  selector: 'app-arc-rule-name-renderer',
  standalone: true,
  template: `<a class="arc-grid-link" href="javascript:void(0)" (click)="onClick()">{{ ruleName }}</a>`,
  styles: [`.arc-grid-link { color: #21409A; font-weight: 500; text-decoration: none; cursor: pointer; &:hover { text-decoration: underline; } }`],
})
export class ArcRuleNameRendererComponent implements ICellRendererAngularComp {
  ruleName = '';
  private params!: ICellRendererParams<AlertRule>;

  agInit(params: ICellRendererParams<AlertRule>): void {
    this.params = params;
    this.ruleName = params.value ?? '';
  }

  refresh(params: ICellRendererParams<AlertRule>): boolean {
    this.agInit(params);
    return true;
  }

  onClick(): void {
    (this.params.context?.onOpen as ((r: AlertRule) => void) | undefined)?.(this.params.data!);
  }
}

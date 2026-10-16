import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-vr-ruleid-renderer',
  standalone: true,
  template: `<button type="button" class="vr-ruleid-link" (click)="onClick($event)">{{ value }}</button>`,
  styles: [`
    .vr-ruleid-link {
      color: #21409A; text-decoration: underline; cursor: pointer; font-weight: 500;
      border: 0; padding: 0; background: none; font: inherit;
    }
    .vr-ruleid-link:hover { color: #1a3480; }
  `],
})
export class VrRuleIdRendererComponent implements ICellRendererAngularComp {
  value = '';
  private params!: ICellRendererParams;

  agInit(params: ICellRendererParams): void { this.params = params; this.value = params.value ?? ''; }
  refresh(): boolean { return false; }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.params.context?.onViewRule?.(this.params.data);
  }
}

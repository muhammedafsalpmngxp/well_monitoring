import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { AlertRule } from '../../alert-rule.service';

@Component({
  selector: 'app-arc-status-renderer',
  standalone: true,
  template: `
    <label class="arc-toggle">
      <input type="checkbox" [checked]="enabled" (change)="onChange()" aria-label="Rule enabled" />
      <span class="arc-toggle__slider"></span>
    </label>
  `,
  styles: [`
    .arc-toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
    .arc-toggle input { opacity: 0; width: 0; height: 0; }
    .arc-toggle__slider {
      position: absolute; inset: 0; border-radius: 999px;
      background: #D0D5DD; transition: background 0.2s;
      &::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform 0.2s; }
    }
    input:checked + .arc-toggle__slider { background: #21409A; &::after { transform: translateX(18px); } }
  `],
})
export class ArcStatusRendererComponent implements ICellRendererAngularComp {
  enabled = false;
  private params!: ICellRendererParams<AlertRule>;

  agInit(params: ICellRendererParams<AlertRule>): void {
    this.params = params;
    this.enabled = params.value as boolean;
  }

  refresh(params: ICellRendererParams<AlertRule>): boolean {
    this.agInit(params);
    return true;
  }

  onChange(): void {
    this.enabled = !this.enabled;
    if (this.params.data) this.params.data.enabled = this.enabled;
  }
}

import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-severity-renderer',
  standalone: true,
  template: `<span class="severity-pill" [class]="'severity-pill--' + cssClass">{{ value }}</span>`,
  styles: [`
    :host { display: flex; align-items: center; height: 100%; }
    .severity-pill {
      display: inline-flex; align-items: center; width: fit-content;
      border-radius: 999px; padding: 2px 12px; font-size: 12px; line-height: 18px; font-weight: 500;
    }
    .severity-pill--critical { background: #FCE4E4; color: #B42318; }
    .severity-pill--high     { background: #FFEACB; color: #E08A00; }
    .severity-pill--medium   { background: #FBF0C7; color: #C9971A; }
    .severity-pill--low      { background: #DEF5E6; color: #34A853; }
  `],
})
export class SeverityRendererComponent implements ICellRendererAngularComp {
  value = '';
  private params!: ICellRendererParams;

  get cssClass(): string {
    return this.value.toLowerCase().trim();
  }

  agInit(params: ICellRendererParams): void {
    this.params = params;
    this.value = params.value ?? '';
  }

  refresh(params: ICellRendererParams): boolean {
    this.value = params.value ?? '';
    return true;
  }
}

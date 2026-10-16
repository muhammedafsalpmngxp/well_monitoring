import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { AlertRule, RuleSeverity } from '../../alert-rule.service';

const SEVERITY_STYLE: Record<RuleSeverity, { bg: string; color: string; border: string }> = {
  Critical: { bg: '#FDECEC', color: '#C62828', border: '#F8C7C6' },
  High:     { bg: '#FFF4E8', color: '#B54708', border: '#FFD9AD' },
  Medium:   { bg: '#FFF8E1', color: '#8A5A00', border: '#F3E6BF' },
  Low:      { bg: '#EEF8EE', color: '#1B7A3A', border: '#B7ECBA' },
  Info:     { bg: '#ECF7FF', color: '#1565C0', border: '#C3E4FF' },
};

// Common flag icon path data (same shape for all severities)
const FLAG_PATH1 = 'M4.33333 8C2.58333 8 2 8.58333 2 8.58333V1.58333C2 1.58333 2.58333 1 4.33333 1C6.08333 1 7.25 2.16667 9 2.16667C10.75 2.16667 11.3333 1.58333 11.3333 1.58333V8.58333C11.3333 8.58333 10.75 9.16667 9 9.16667C7.25 9.16667 6.08333 8 4.33333 8Z';
const FLAG_PATH2 = 'M2 8.58333C2 8.58333 2.58333 8 4.33333 8C6.08333 8 7.25 9.16667 9 9.16667C10.75 9.16667 11.3333 8.58333 11.3333 8.58333V1.58333C11.3333 1.58333 10.75 2.16667 9 2.16667C7.25 2.16667 6.08333 1 4.33333 1C2.58333 1 2 1.58333 2 1.58333V12.6667';

@Component({
  selector: 'app-arc-severity-renderer',
  standalone: true,
  template: `
    <span class="arc-sev-pill"
      [style.background]="style.bg"
      [style.color]="style.color"
      [style.border]="'1px solid ' + style.border">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path [attr.d]="flagPath1" [attr.fill]="style.color"/>
        <path [attr.d]="flagPath2" [attr.stroke]="style.color"
          stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      {{ severity }}
    </span>
  `,
  styles: [`
    .arc-sev-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0 10px; height: 24px;
      border-radius: 20px;
      font-size: 12px; font-weight: 500; white-space: nowrap;
    }
  `],
})
export class ArcSeverityRendererComponent implements ICellRendererAngularComp {
  severity: RuleSeverity = 'Low';
  style = SEVERITY_STYLE['Low'];
  readonly flagPath1 = FLAG_PATH1;
  readonly flagPath2 = FLAG_PATH2;

  agInit(params: ICellRendererParams<AlertRule>): void {
    this.severity = params.value as RuleSeverity;
    this.style = SEVERITY_STYLE[this.severity] ?? SEVERITY_STYLE['Low'];
  }

  refresh(params: ICellRendererParams<AlertRule>): boolean {
    this.agInit(params);
    return true;
  }
}

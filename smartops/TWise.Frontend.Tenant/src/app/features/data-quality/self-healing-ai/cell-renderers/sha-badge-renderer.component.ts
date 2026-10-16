import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

const BADGE_MAP: Record<string, { bg: string; color: string; border: string }> = {
  'Missing Value':  { bg: '#FFF8E1', color: '#D89B00', border: '#E9DBB8' },
  'Inconsistent':   { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  'Out-of-Range':   { bg: '#FEF2F2', color: '#D92D20', border: '#FECACA' },
  'Date Sequence':  { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' },
  'Anomalous':      { bg: '#F0FDFA', color: '#0F766E', border: '#A7F3D0' },
  'Pending PO':     { bg: '#FFF8E1', color: '#D89B00', border: '#E9DBB8' },
  'Completed':      { bg: '#ECFDF5', color: '#16A34A', border: '#A7F3D0' },
};

@Component({
  selector: 'app-sha-badge-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span *ngIf="value" class="sha-tbl-badge"
      [style.background]="style.bg"
      [style.color]="style.color"
      [style.border]="'1px solid ' + style.border">
      {{ value }}
    </span>
    <span *ngIf="!value">—</span>
  `,
  styles: [`
    .sha-tbl-badge {
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      height: 24px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
  `],
})
export class ShaBadgeRendererComponent implements ICellRendererAngularComp {
  value = '';
  style = BADGE_MAP['Missing Value'];

  agInit(params: ICellRendererParams): void {
    this.value = params.value ?? '';
    this.style = BADGE_MAP[this.value] ?? { bg: '#F9FAFB', color: '#344054', border: '#E7ECF3' };
  }

  refresh(params: ICellRendererParams): boolean {
    this.agInit(params);
    return true;
  }
}

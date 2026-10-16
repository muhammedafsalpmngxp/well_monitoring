import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DaxModelSourceType } from '../dax-model.component';

@Component({
  selector: 'app-dax-source-type-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="dax-model-table__source-pill"
      [class.dax-model-table__source-pill--view]="sourceType === 'View'"
      [class.dax-model-table__source-pill--table]="sourceType === 'Table'">
      <svg *ngIf="sourceType === 'View'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
      <svg *ngIf="sourceType === 'Table'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="3" y1="15" x2="21" y2="15"></line>
        <line x1="12" y1="3" x2="12" y2="21"></line>
      </svg>
      {{ sourceType }}
    </span>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DaxSourceTypeCellRendererComponent implements ICellRendererAngularComp {
  sourceType: DaxModelSourceType = 'Table';

  agInit(params: ICellRendererParams<unknown, DaxModelSourceType>): void {
    this.sourceType = params.value ?? 'Table';
  }

  refresh(params: ICellRendererParams<unknown, DaxModelSourceType>): boolean {
    this.agInit(params);
    return true;
  }
}

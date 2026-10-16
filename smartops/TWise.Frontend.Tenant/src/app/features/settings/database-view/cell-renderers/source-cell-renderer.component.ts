import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DatabaseViewRow } from '../database-view.component';

@Component({
  selector: 'app-source-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="db-table__source-badge db-table__source-badge--{{ row?.source === 'built-in' ? 'builtin' : 'custom' }}">
      <span class="db-table__source-dot"></span>
      {{ row?.source === 'built-in' ? 'Build-in' : 'Custom' }}
    </span>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class SourceCellRendererComponent implements ICellRendererAngularComp {
  row?: DatabaseViewRow;

  agInit(params: ICellRendererParams<DatabaseViewRow>): void {
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DatabaseViewRow>): boolean {
    this.row = params.data;
    return true;
  }
}

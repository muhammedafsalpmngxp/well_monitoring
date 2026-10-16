import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DatabaseViewRow } from '../database-view.component';

@Component({
  selector: 'app-tables-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="db-table__tags">
      <span class="db-table__tag" *ngFor="let t of row?.tablesUsed">{{ t }}</span>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class TablesCellRendererComponent implements ICellRendererAngularComp {
  row?: DatabaseViewRow;

  agInit(params: ICellRendererParams<DatabaseViewRow>): void {
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DatabaseViewRow>): boolean {
    this.row = params.data;
    return true;
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-dax-columns-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dax-model-table__tags">
      <span class="dax-model-table__tag" *ngFor="let col of columns">{{ col }}</span>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DaxColumnsCellRendererComponent implements ICellRendererAngularComp {
  columns: string[] = [];

  agInit(params: ICellRendererParams<unknown, string[]>): void {
    this.columns = params.value ?? [];
  }

  refresh(params: ICellRendererParams<unknown, string[]>): boolean {
    this.agInit(params);
    return true;
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-dax-name-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="dax-model-table__name">
      <span class="dax-model-table__name-icon">fx</span>
      {{ name }}
    </span>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DaxNameCellRendererComponent implements ICellRendererAngularComp {
  name = '';

  agInit(params: ICellRendererParams<unknown, string>): void {
    this.name = params.value ?? '';
  }

  refresh(params: ICellRendererParams<unknown, string>): boolean {
    this.agInit(params);
    return true;
  }
}

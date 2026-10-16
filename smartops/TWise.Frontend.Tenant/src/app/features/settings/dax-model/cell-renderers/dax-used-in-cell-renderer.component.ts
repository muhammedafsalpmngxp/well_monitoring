import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-dax-used-in-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="dax-model-table__used-in-pill">{{ usedIn }}</span>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DaxUsedInCellRendererComponent implements ICellRendererAngularComp {
  usedIn = '';

  agInit(params: ICellRendererParams<unknown, string>): void {
    this.usedIn = params.value ?? '';
  }

  refresh(params: ICellRendererParams<unknown, string>): boolean {
    this.agInit(params);
    return true;
  }
}

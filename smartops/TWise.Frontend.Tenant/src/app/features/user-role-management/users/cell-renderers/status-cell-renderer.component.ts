import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { UserRow } from '../users.component';

@Component({
  selector: 'app-status-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="users-table__status users-table__status--{{ user?.status }}">
      <span class="users-table__status-dot"></span>
      {{ user?.status === 'active' ? 'Active' : 'Inactive' }}
    </span>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class StatusCellRendererComponent implements ICellRendererAngularComp {
  user?: UserRow;

  agInit(params: ICellRendererParams<UserRow>): void {
    this.user = params.data;
  }

  refresh(params: ICellRendererParams<UserRow>): boolean {
    this.user = params.data;
    return true;
  }
}

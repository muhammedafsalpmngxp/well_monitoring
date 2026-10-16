import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { UserRow } from '../users.component';

@Component({
  selector: 'app-employee-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="users-table__employee">
      <span class="users-table__avatar users-table__avatar--{{ user?.avatarAccent }}">{{ user?.initials }}</span>
      <span class="users-table__name">{{ user?.name }}</span>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class EmployeeCellRendererComponent implements ICellRendererAngularComp {
  user?: UserRow;

  agInit(params: ICellRendererParams<UserRow>): void {
    this.user = params.data;
  }

  refresh(params: ICellRendererParams<UserRow>): boolean {
    this.user = params.data;
    return true;
  }
}

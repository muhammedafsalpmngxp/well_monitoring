import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { UserRow } from '../users.component';

@Component({
  selector: 'app-role-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="users-table__roles">
      <span *ngFor="let role of roles" class="users-table__role-pill users-table__role-pill--{{ role.accent }}">{{ role.name }}</span>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class RoleCellRendererComponent implements ICellRendererAngularComp {
  user?: UserRow;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  get roles(): NonNullable<UserRow['roles']> {
    if (!this.user) return [];
    return this.user.roles?.length ? this.user.roles : [{ name: this.user.role, accent: this.user.roleAccent }];
  }

  agInit(params: ICellRendererParams<UserRow>): void {
    this.user = params.data;
  }

  refresh(params: ICellRendererParams<UserRow>): boolean {
    this.user = params.data;
    this.cdr.markForCheck();
    return true;
  }
}

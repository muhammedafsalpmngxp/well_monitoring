import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { UserRow } from '../users.component';

@Component({
  selector: 'app-actions-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="users-table__actions">
      <button class="users-table__action-btn" title="Edit" (click)="onEdit()">
       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
<g clip-path="url(#clip0_495_1222)">
<path d="M7.33337 2.66665H4.53337C3.41327 2.66665 2.85321 2.66665 2.42539 2.88464C2.04907 3.07639 1.74311 3.38235 1.55136 3.75867C1.33337 4.1865 1.33337 4.74655 1.33337 5.86665V11.4667C1.33337 12.5867 1.33337 13.1468 1.55136 13.5747C1.74311 13.9509 2.04907 14.2569 2.42539 14.4487C2.85321 14.6667 3.41327 14.6667 4.53337 14.6667H10.1334C11.2535 14.6667 11.8135 14.6667 12.2414 14.4487C12.6177 14.2569 12.9236 13.9509 13.1154 13.5747C13.3334 13.1468 13.3334 12.5867 13.3334 11.4667V8.66667M5.33335 10.6667H6.44972C6.77584 10.6667 6.93891 10.6667 7.09237 10.6298C7.22837 10.5971 7.35844 10.5433 7.47777 10.4702C7.61231 10.3877 7.72764 10.2724 7.95824 10.0418L14.3334 3.66665C14.8856 3.11437 14.8856 2.21894 14.3334 1.66665C13.7811 1.11437 12.8856 1.11437 12.3334 1.66665L5.95819 8.0418C5.72759 8.2724 5.61229 8.38773 5.52983 8.52227C5.45673 8.6416 5.40286 8.7716 5.37019 8.90767C5.33335 9.06113 5.33335 9.2242 5.33335 9.55033V10.6667Z" stroke="#64748B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="clip0_495_1222">
<rect width="16" height="16" fill="white"/>
</clipPath>
</defs>
</svg>
      </button>
      <button class="users-table__action-btn" title="Reset password" (click)="onResetPassword()">
       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
<path d="M11 6.66667V4.66667C11 3.00981 9.65687 1.66667 8 1.66667C6.34315 1.66667 5 3.00981 5 4.66667V6.66667M5.86667 14.3333H10.1333C11.2534 14.3333 11.8135 14.3333 12.2413 14.1153C12.6176 13.9236 12.9236 13.6176 13.1153 13.2413C13.3333 12.8135 13.3333 12.2534 13.3333 11.1333V9.86667C13.3333 8.74656 13.3333 8.18651 13.1153 7.75869C12.9236 7.38236 12.6176 7.0764 12.2413 6.88466C11.8135 6.66667 11.2534 6.66667 10.1333 6.66667H5.86667C4.74656 6.66667 4.18651 6.66667 3.75869 6.88466C3.38236 7.0764 3.0764 7.38236 2.88466 7.75869C2.66667 8.18651 2.66667 8.74656 2.66667 9.86667V11.1333C2.66667 12.2534 2.66667 12.8135 2.88466 13.2413C3.0764 13.6176 3.38236 13.9236 3.75869 14.1153C4.18651 14.3333 4.74656 14.3333 5.86667 14.3333Z" stroke="#21409A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
      </button>

         <button class="users-table__action-btn" title="Delete" (click)="onDelete()">
       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
<path d="M6 2H10M2 4H14M12.6667 4L12.1991 11.0129C12.129 12.065 12.0939 12.5911 11.8667 12.99C11.6666 13.3412 11.3648 13.6235 11.0011 13.7998C10.588 14 10.0607 14 9.0062 14H6.9938C5.93927 14 5.41202 14 4.99889 13.7998C4.63517 13.6235 4.33339 13.3412 4.13332 12.99C3.90607 12.5911 3.871 12.065 3.80086 11.0129L3.33333 4M6.66667 7V10.3333M9.33333 7V10.3333" stroke="#D92D20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
      </button>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class ActionsCellRendererComponent implements ICellRendererAngularComp {
  user?: UserRow;
  private params?: ICellRendererParams<UserRow>;

  agInit(params: ICellRendererParams<UserRow>): void {
    this.params = params;
    this.user = params.data;
  }

  refresh(params: ICellRendererParams<UserRow>): boolean {
    this.params = params;
    this.user = params.data;
    return true;
  }

  onEdit(): void {
    if (this.user && this.params?.context?.onEdit) {
      this.params.context.onEdit(this.user);
    }
  }

  onResetPassword(): void {
    if (this.user && this.params?.context?.onResetPassword) {
      this.params.context.onResetPassword(this.user);
    }
  }

  onDelete(): void {
    if (this.user && this.params?.context?.onDelete) {
      this.params.context.onDelete(this.user);
    }
  }
}

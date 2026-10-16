import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DatabaseViewRow } from '../database-view.component';

@Component({
  selector: 'app-db-actions-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="db-table__actions">
      <button *ngIf="canModify" class="db-table__action-btn" title="Delete view" (click)="onDelete()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 2H10M2 4H14M12.6667 4L12.1991 11.0129C12.129 12.065 12.0939 12.5911 11.8667 12.99C11.6666 13.3412 11.3648 13.6235 11.0011 13.7998C10.588 14 10.0607 14 9.0062 14H6.9938C5.93927 14 5.41202 14 4.99889 13.7998C4.63517 13.6235 4.33339 13.3412 4.13332 12.99C3.90607 12.5911 3.871 12.065 3.80086 11.0129L3.33333 4M6.66667 7V10.3333M9.33333 7V10.3333"
            stroke="#D92D20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DbActionsCellRendererComponent implements ICellRendererAngularComp {
  row?: DatabaseViewRow;
  private params?: ICellRendererParams<DatabaseViewRow>;

  get canModify(): boolean { return this.params?.context?.canModify?.() === true; }

  agInit(params: ICellRendererParams<DatabaseViewRow>): void {
    this.params = params;
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DatabaseViewRow>): boolean {
    this.params = params;
    this.row = params.data;
    return true;
  }

  onDelete(): void {
    if (this.canModify && this.row && this.params?.context?.onDelete) {
      this.params.context.onDelete(this.row);
    }
  }
}

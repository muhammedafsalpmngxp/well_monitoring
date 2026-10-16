import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { RecurringSyncJob } from '../data-sync.component';

@Component({
  selector: 'app-recurring-actions-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="data-sync-actions">
      <button class="data-sync-actions__btn data-sync-actions__btn--view" title="Details">
        <svg width="13" height="15" viewBox="0 0 13 15" fill="none">
          <path
            d="M7.36589 0.879882V3.63358C7.36589 4.00694 7.36589 4.19363 7.43855 4.33624C7.50249 4.46168 7.60442 4.56366 7.72989 4.62758C7.87249 4.70024 8.05915 4.70024 8.43255 4.70024H11.1862M7.36589 10.7002H3.36589M8.69922 8.03353H3.36589M11.3659 6.02568V10.8335C11.3659 11.9537 11.3659 12.5137 11.1479 12.9415C10.9562 13.3179 10.6502 13.6238 10.2739 13.8155C9.84602 14.0335 9.28602 14.0335 8.16589 14.0335H3.89922C2.77911 14.0335 2.21906 14.0335 1.79124 13.8155C1.41491 13.6238 1.10895 13.3179 0.917205 12.9415C0.699219 12.5137 0.699219 11.9537 0.699219 10.8335V3.9002C0.699219 2.78009 0.699219 2.22004 0.917205 1.79222C1.10895 1.41589 1.41491 1.10993 1.79124 0.918182C2.21906 0.700195 2.77911 0.700195 3.89922 0.700195H6.04042C6.52955 0.700195 6.77415 0.700195 7.00435 0.755455C7.20842 0.804449 7.40349 0.885255 7.58249 0.994915C7.78429 1.1186 7.95722 1.29155 8.30315 1.63746L10.4286 3.76294C10.7746 4.10884 10.9475 4.2818 11.0712 4.48363C11.1808 4.66257 11.2616 4.85766 11.3106 5.06173C11.3659 5.29191 11.3659 5.5365 11.3659 6.02568Z"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button *ngIf="canModify" class="data-sync-actions__btn data-sync-actions__btn--edit" title="Edit" (click)="onEdit()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <g clip-path="url(#clip0_recurring_edit)">
            <path
              d="M7.33594 2.66665H4.53594C3.41583 2.66665 2.85578 2.66665 2.42796 2.88464C2.05163 3.07639 1.74567 3.38235 1.55392 3.75867C1.33594 4.1865 1.33594 4.74655 1.33594 5.86665V11.4667C1.33594 12.5867 1.33594 13.1468 1.55392 13.5747C1.74567 13.9509 2.05163 14.2569 2.42796 14.4487C2.85578 14.6667 3.41583 14.6667 4.53594 14.6667H10.1359C11.2561 14.6667 11.8161 14.6667 12.2439 14.4487C12.6203 14.2569 12.9262 13.9509 13.1179 13.5747C13.3359 13.1468 13.3359 12.5867 13.3359 11.4667V8.66667M5.33592 10.6667H6.45228C6.7784 10.6667 6.94147 10.6667 7.09494 10.6298C7.23094 10.5971 7.361 10.5433 7.48034 10.4702C7.61487 10.3877 7.7302 10.2724 7.9608 10.0418L14.3359 3.66665C14.8882 3.11437 14.8882 2.21894 14.3359 1.66665C13.7837 1.11437 12.8882 1.11437 12.3359 1.66665L5.96076 8.0418C5.73016 8.2724 5.61486 8.38773 5.5324 8.52227C5.4593 8.6416 5.40542 8.7716 5.37276 8.90767C5.33592 9.06113 5.33592 9.2242 5.33592 9.55033V10.6667Z"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </g>
          <defs>
            <clipPath id="clip0_recurring_edit">
              <rect width="16" height="16" fill="white" />
            </clipPath>
          </defs>
        </svg>
      </button>
      <button *ngIf="canModify" class="data-sync-actions__btn data-sync-actions__btn--run" title="Run now" (click)="onRun()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.33203 3.32618C3.33203 2.67874 3.33203 2.35502 3.46702 2.17657C3.58462 2.02111 3.76438 1.92491 3.95896 1.91329C4.18232 1.89995 4.45167 2.07952 4.99038 2.43866L12.0008 7.11224C12.4459 7.40897 12.6684 7.55737 12.746 7.74437C12.8138 7.9079 12.8138 8.09164 12.746 8.25517C12.6684 8.44217 12.4459 8.5905 12.0008 8.8873L4.99038 13.5608C4.45167 13.92 4.18232 14.0996 3.95896 14.0862C3.76438 14.0746 3.58462 13.9784 3.46702 13.823C3.33203 13.6445 3.33203 13.3208 3.33203 12.6734V3.32618Z"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button *ngIf="canModify" class="data-sync-actions__btn data-sync-actions__btn--delete" title="Delete" (click)="onDelete()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M6 2H10M2 4H14M12.6667 4L12.1991 11.0129C12.129 12.065 12.0939 12.5911 11.8667 12.99C11.6666 13.3412 11.3648 13.6235 11.0011 13.7998C10.588 14 10.0607 14 9.0062 14H6.9938C5.93927 14 5.41202 14 4.99889 13.7998C4.63517 13.6235 4.33339 13.3412 4.13332 12.99C3.90607 12.5911 3.871 12.065 3.80086 11.0129L3.33333 4M6.66667 7V10.3333M9.33333 7V10.3333"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class RecurringActionsCellRendererComponent implements ICellRendererAngularComp {
  private row?: RecurringSyncJob;
  private params?: ICellRendererParams<RecurringSyncJob>;

  get canModify(): boolean { return this.params?.context?.canModify?.() === true; }

  agInit(params: ICellRendererParams<RecurringSyncJob>): void {
    this.params = params;
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<RecurringSyncJob>): boolean {
    this.agInit(params);
    return true;
  }

  onEdit(): void {
    if (this.canModify && this.row) this.params?.context?.onEditRecurring?.(this.row);
  }

  onRun(): void {
    if (this.canModify && this.row) this.params?.context?.onRunRecurring?.(this.row);
  }

  onDelete(): void {
    if (this.canModify && this.row) this.params?.context?.onDeleteRecurring?.(this.row);
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { SyncJob } from '../data-sync.component';

@Component({
  selector: 'app-job-actions-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="data-sync-actions">
      <button class="data-sync-actions__btn data-sync-actions__btn--view" title="View Details" (click)="onView()">
        <svg width="13" height="15" viewBox="0 0 13 15" fill="none">
          <path
            d="M7.36589 0.879882V3.63358C7.36589 4.00694 7.36589 4.19363 7.43855 4.33624C7.50249 4.46168 7.60442 4.56366 7.72989 4.62758C7.87249 4.70024 8.05915 4.70024 8.43255 4.70024H11.1862M7.36589 10.7002H3.36589M8.69922 8.03353H3.36589M11.3659 6.02568V10.8335C11.3659 11.9537 11.3659 12.5137 11.1479 12.9415C10.9562 13.3179 10.6502 13.6238 10.2739 13.8155C9.84602 14.0335 9.28602 14.0335 8.16589 14.0335H3.89922C2.77911 14.0335 2.21906 14.0335 1.79124 13.8155C1.41491 13.6238 1.10895 13.3179 0.917205 12.9415C0.699219 12.5137 0.699219 11.9537 0.699219 10.8335V3.9002C0.699219 2.78009 0.699219 2.22004 0.917205 1.79222C1.10895 1.41589 1.41491 1.10993 1.79124 0.918182C2.21906 0.700195 2.77911 0.700195 3.89922 0.700195H6.04042C6.52955 0.700195 6.77415 0.700195 7.00435 0.755455C7.20842 0.804449 7.40349 0.885255 7.58249 0.994915C7.78429 1.1186 7.95722 1.29155 8.30315 1.63746L10.4286 3.76294C10.7746 4.10884 10.9475 4.2818 11.0712 4.48363C11.1808 4.66257 11.2616 4.85766 11.3106 5.06173C11.3659 5.29191 11.3659 5.5365 11.3659 6.02568Z"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button *ngIf="canModify" class="data-sync-actions__btn data-sync-actions__btn--retry" title="Retry" (click)="onRetry()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M14.6667 6.66667C14.6667 6.66667 13.33 4.84548 12.2441 3.75883C11.1582 2.67218 9.6576 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C10.7354 14 13.0433 12.1695 13.7655 9.66667M10.6667 6.66667H14.6667V2.66667"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class JobActionsCellRendererComponent implements ICellRendererAngularComp {
  private job?: SyncJob;
  private params?: ICellRendererParams<SyncJob>;

  get canModify(): boolean { return this.params?.context?.canModify?.() === true; }

  agInit(params: ICellRendererParams<SyncJob>): void {
    this.params = params;
    this.job = params.data;
  }

  refresh(params: ICellRendererParams<SyncJob>): boolean {
    this.agInit(params);
    return true;
  }

  onView(): void {
    if (this.job) this.params?.context?.onViewJobDetails?.(this.job);
  }

  onRetry(): void {
    if (this.canModify && this.job) this.params?.context?.onRetryJob?.(this.job);
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { SyncJobStatus } from '../data-sync.component';

export const STATUS_STYLE: Record<SyncJobStatus, { bg: string; color: string; label: string }> = {
  queued:     { bg: '#EEF2FF', color: '#4F46E5', label: 'Queued' },
  processing: { bg: '#FEF3C7', color: '#F59E0B', label: 'Processing' },
  scheduled:  { bg: '#E6FBFA', color: '#0EA5A4', label: 'Scheduled' },
  succeeded:  { bg: '#E9F8F3', color: '#22C55E', label: 'Succeeded' },
  failed:     { bg: '#FEF3F2', color: '#EF4444', label: 'Failed' },
  deleted:    { bg: '#F2F4F7', color: '#64748B', label: 'Deleted' },
  awaiting:   { bg: '#F3ECFF', color: '#7C3AED', label: 'Awaiting' },
};

@Component({
  selector: 'app-job-status-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="job-status-pill" [style.background]="style.bg" [style.color]="style.color">
      <span class="job-status-pill__dot" [style.background]="style.color"></span>
      {{ style.label }}
    </span>
  `,
  styles: [`
    .job-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    .job-status-pill__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  `],
})
export class JobStatusCellRendererComponent implements ICellRendererAngularComp {
  style = STATUS_STYLE.queued;

  agInit(params: ICellRendererParams<unknown, SyncJobStatus>): void {
    this.style = STATUS_STYLE[params.value as SyncJobStatus] ?? STATUS_STYLE.queued;
  }

  refresh(params: ICellRendererParams<unknown, SyncJobStatus>): boolean {
    this.agInit(params);
    return true;
  }
}

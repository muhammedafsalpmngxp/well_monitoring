import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { JobSyncLogStatus } from '../data-sync.component';

export const LOG_STATUS_STYLE: Record<JobSyncLogStatus, { bg: string; color: string; label: string }> = {
  succeeded: { bg: '#E9F8F3', color: '#22C55E', label: 'Succeeded' },
  partial:   { bg: '#FFF6ED', color: '#F58220', label: 'Partial' },
  failed:    { bg: '#FEF3F2', color: '#EF4444', label: 'Failed' },
};

@Component({
  selector: 'app-log-status-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="log-status-pill" [style.background]="style.bg" [style.color]="style.color">
      <span class="log-status-pill__dot" [style.background]="style.color"></span>
      {{ style.label }}
    </span>
  `,
  styles: [`
    .log-status-pill {
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

    .log-status-pill__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  `],
})
export class LogStatusCellRendererComponent implements ICellRendererAngularComp {
  style = LOG_STATUS_STYLE.succeeded;

  agInit(params: ICellRendererParams<unknown, JobSyncLogStatus>): void {
    this.style = LOG_STATUS_STYLE[params.value as JobSyncLogStatus] ?? LOG_STATUS_STYLE.succeeded;
  }

  refresh(params: ICellRendererParams<unknown, JobSyncLogStatus>): boolean {
    this.agInit(params);
    return true;
  }
}

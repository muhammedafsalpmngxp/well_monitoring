import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { ScheduleRunDto } from '../../../core/services/schedule.service';

const TYPE_LABELS: Record<string, string> = { Report: 'Report', Dashboard: 'Dashboard', Canvas: 'BI Canvas' };

/** The status chip or the item type badge of a delivery log row, in the look of the Schedules page. */
@Component({
  selector: 'app-delivery-badge-renderer',
  standalone: true,
  template: `<span [class]="cls">{{ text }}</span>`,
  styleUrls: ['../schedules/delivery-pages.scss'],
})
export class DeliveryBadgeRendererComponent implements ICellRendererAngularComp {
  cls = '';
  text = '';

  agInit(params: ICellRendererParams<ScheduleRunDto>): void {
    const value = String(params.value ?? '');
    const isType = params.colDef?.field === 'targetType';
    this.text = isType ? TYPE_LABELS[value] ?? value : value;
    this.cls = isType ? `dp-type dp-type--${value.toLowerCase()}` : `dp-status dp-status--${value.toLowerCase()}`;
  }

  refresh(params: ICellRendererParams<ScheduleRunDto>): boolean {
    this.agInit(params);
    return true;
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DaxModelRow } from '../dax-model.component';

@Component({
  selector: 'app-dax-actions-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dax-model-table__actions">
      <button *ngIf="canModify" type="button" class="dax-model-table__icon-btn" aria-label="Edit" (click)="onEdit()">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path
            d="M6.69922 2.11441H3.89922C2.77911 2.11441 2.21906 2.11441 1.79124 2.33239C1.41491 2.52414 1.10895 2.83011 0.917205 3.20643C0.699219 3.63425 0.699219 4.19431 0.699219 5.31441V10.9144C0.699219 12.0345 0.699219 12.5946 0.917205 13.0224C1.10895 13.3987 1.41491 13.7047 1.79124 13.8964C2.21906 14.1144 2.77911 14.1144 3.89922 14.1144H9.49922C10.6194 14.1144 11.1794 14.1144 11.6072 13.8964C11.9836 13.7047 12.2895 13.3987 12.4812 13.0224C12.6992 12.5946 12.6992 12.0345 12.6992 10.9144V8.11442M4.6992 10.1144H5.81557C6.14169 10.1144 6.30475 10.1144 6.45822 10.0776C6.59422 10.0449 6.72429 9.99102 6.84362 9.91796C6.97815 9.83549 7.09349 9.72015 7.32409 9.48955L13.6992 3.11441C14.2515 2.56213 14.2515 1.66669 13.6992 1.11441C13.147 0.562128 12.2515 0.562121 11.6992 1.11441L5.32404 7.48955C5.09344 7.72015 4.97814 7.83549 4.89568 7.97002C4.82258 8.08935 4.76871 8.21935 4.73604 8.35542C4.6992 8.50889 4.6992 8.67195 4.6992 8.99809V10.1144Z"
            stroke="#21409A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button *ngIf="canModify" type="button" class="dax-model-table__icon-btn dax-model-table__icon-btn--danger" aria-label="Delete"
        (click)="onDelete()">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M4.69922 0.700195H8.69922M0.699219 2.7002H12.6992M11.3659 2.7002L10.8984 9.71306C10.8282 10.7652 10.7932 11.2913 10.5659 11.6902C10.3658 12.0414 10.064 12.3237 9.70035 12.5C9.28722 12.7002 8.75995 12.7002 7.70542 12.7002H5.69302C4.63849 12.7002 4.11124 12.7002 3.69811 12.5C3.33439 12.3237 3.03261 12.0414 2.83254 11.6902C2.60529 11.2913 2.57022 10.7652 2.50008 9.71306L2.03255 2.7002M5.36589 5.7002V9.03353M8.03255 5.7002V9.03353"
            stroke="#D92D20" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  `,
  styleUrls: ['./cell-renderers.scss'],
})
export class DaxActionsCellRendererComponent implements ICellRendererAngularComp {
  private row?: DaxModelRow;
  private params?: ICellRendererParams<DaxModelRow>;

  get canModify(): boolean { return this.params?.context?.canModify?.() === true; }

  agInit(params: ICellRendererParams<DaxModelRow>): void {
    this.params = params;
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DaxModelRow>): boolean {
    this.agInit(params);
    return true;
  }

  onEdit(): void {
    if (this.canModify && this.row) this.params?.context?.onEditRow?.(this.row);
  }

  onDelete(): void {
    if (this.canModify && this.row) this.params?.context?.onDeleteRow?.(this.row);
  }
}

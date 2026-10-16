import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartView, ChartViewIcon, chartViewIcon } from '../../core/constants/chart-view.constants';

/** Renders the small chart-type icon for a given chart view, shared across builders and viewers. */
@Component({
  selector: 'app-chart-type-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container [ngSwitch]="icon">
      <svg *ngSwitchCase="'pie'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <path d="M4.61175 12.417C5.37863 13.4103 6.37406 14.0588 7.59806 14.3627C7.75581 14.4136 7.88494 14.5109 7.98544 14.6546C8.08581 14.7984 8.136 14.9592 8.136 15.1371C8.136 15.3938 8.02975 15.5984 7.81725 15.7508C7.60475 15.9033 7.37019 15.9362 7.11356 15.8496C5.54906 15.4237 4.28487 14.5799 3.321 13.3183C2.357 12.0568 1.875 10.6184 1.875 9.00301C1.875 7.38763 2.357 5.9492 3.321 4.6877C4.28487 3.42607 5.54906 2.58232 7.11356 2.15645C7.37019 2.06982 7.60475 2.10276 7.81725 2.25526C8.02975 2.40763 8.136 2.6122 8.136 2.86895C8.136 3.04682 8.08581 3.20763 7.98544 3.35138C7.88494 3.49513 7.75581 3.59245 7.59806 3.64332C6.37406 3.9472 5.37863 4.59576 4.61175 5.58901C3.84488 6.58226 3.46144 7.72026 3.46144 9.00301C3.46144 10.2858 3.84488 11.4238 4.61175 12.417ZM9.83794 2.86895C9.83794 2.6122 9.94538 2.40763 10.1603 2.25526C10.3753 2.10276 10.6111 2.06982 10.8677 2.15645C11.9477 2.44795 12.9049 2.98795 13.7393 3.77645C14.5737 4.56482 15.1575 5.51257 15.4908 6.61957C15.5724 6.87607 15.5383 7.11195 15.3883 7.32695C15.2383 7.54182 15.035 7.64926 14.7783 7.64926H9.83794V2.86895ZM9.83794 15.1371V10.3538H14.7783C15.035 10.3538 15.2383 10.4613 15.3883 10.6762C15.5383 10.8912 15.5724 11.127 15.4908 11.3836C15.1525 12.4956 14.5662 13.4459 13.7318 14.2343C12.8975 15.0228 11.9427 15.5603 10.8677 15.8496C10.6111 15.9313 10.3753 15.8972 10.1603 15.7472C9.94538 15.5972 9.83794 15.3938 9.83794 15.1371Z" fill="#7C3AED" />
      </svg>
      <svg *ngSwitchCase="'donut'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <path d="M9 1.5C9.9849 1.5 10.9602 1.69399 11.8701 2.07091C12.7801 2.44781 13.6069 3.00026 14.3033 3.6967C14.9998 4.39314 15.5522 5.21993 15.9291 6.12988C16.306 7.03982 16.5 8.0151 16.5 9M16.5 9C16.5 10.1836 16.2199 11.3503 15.6826 12.4049C15.1452 13.4595 14.3659 14.3719 13.4084 15.0676L9 9V1.5M9 1.5C4.85786 1.5 1.5 4.85786 1.5 9C1.5 13.1421 4.85786 16.5 9 16.5C13.1421 16.5 16.5 13.1422 16.5 9M9 1.5C13.1421 1.5 16.5 4.85787 16.5 9M16.5 9H9" stroke="#2563EB" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg *ngSwitchCase="'bar'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <path d="M6.75 5.25H3.45C3.02996 5.25 2.81994 5.25 2.65951 5.33174C2.51839 5.40365 2.40365 5.51839 2.33174 5.65951C2.25 5.81994 2.25 6.02996 2.25 6.45V14.55C2.25 14.9701 2.25 15.1801 2.33174 15.3405C2.40365 15.4817 2.51839 15.5963 2.65951 15.6683C2.81994 15.75 3.02996 15.75 3.45 15.75H6.75M6.75 15.75H11.25M6.75 15.75V3.45C6.75 3.02996 6.75 2.81994 6.83174 2.65951C6.90365 2.51839 7.01839 2.40365 7.15951 2.33174C7.31994 2.25 7.52993 2.25 7.95 2.25H10.05C10.4701 2.25 10.6801 2.25 10.8405 2.33174C10.9817 2.40365 11.0963 2.51839 11.1682 2.65951C11.25 2.81994 11.25 3.02996 11.25 3.45V15.75M11.25 15.75H14.55C14.9701 15.75 15.1801 15.75 15.3405 15.6683C15.4817 15.5963 15.5963 15.4817 15.6683 15.3405C15.75 15.1801 15.75 14.9701 15.75 14.55V9.45C15.75 9.02993 15.75 8.81992 15.6683 8.6595C15.5963 8.51835 15.4817 8.40368 15.3405 8.33175C15.1801 8.25 14.9701 8.25 14.55 8.25H11.25" stroke="#F58220" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg *ngSwitchCase="'line'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <path d="M2.25 13.5L6 8.25L9.75 11.25L15.75 4.5" stroke="#12B76A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg *ngSwitchCase="'trend'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <path d="M2.25 13.5L7.5 8.25L10.5 11.25L15.75 6M15.75 6H12M15.75 6V9.75" stroke="#6366F1" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg *ngSwitchCase="'combo'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <rect x="2.25" y="9" width="3" height="6.75" rx="0.5" fill="#F58220" />
        <rect x="7.5" y="6" width="3" height="9.75" rx="0.5" fill="#F58220" />
        <rect x="12.75" y="7.5" width="3" height="8.25" rx="0.5" fill="#F58220" />
        <path d="M3.75 7.5L9 4.5L14.25 5.25" stroke="#12B76A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg *ngSwitchCase="'grouped'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <rect x="1.5" y="9" width="2.5" height="6.75" rx="0.5" fill="#F58220" />
        <rect x="4" y="6" width="2.5" height="9.75" rx="0.5" fill="#2563EB" />
        <rect x="7.75" y="7.5" width="2.5" height="8.25" rx="0.5" fill="#F58220" />
        <rect x="10.25" y="4.5" width="2.5" height="11.25" rx="0.5" fill="#2563EB" />
        <rect x="14" y="10.5" width="2.5" height="5.25" rx="0.5" fill="#F58220" />
      </svg>
      <svg *ngSwitchCase="'table'" xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="14" height="14" rx="2" stroke="#667085" stroke-width="1.4" />
        <path d="M2 6h14M2 10h14M6 6v10M12 6v10" stroke="#667085" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </ng-container>
  `,
})
export class ChartTypeIconComponent {
  @Input() type: ChartView | string = 'bar';
  @Input() size = 14;
  get icon(): ChartViewIcon { return chartViewIcon(this.type as ChartView); }
}

import { Component, Input } from '@angular/core';

/**
 * Standalone-in-SharedModule "No data found" placeholder shown in place of a chart that has
 * nothing meaningful to render (e.g. a pie/donut whose slices are all zero).
 */
@Component({
  selector: 'app-chart-no-data',
  standalone: false,
  template: `
    <div class="chart-no-data">
      <svg class="chart-no-data__art" viewBox="0 0 240 176" fill="none" xmlns="http://www.w3.org/2000/svg"
        role="img" [attr.aria-label]="message">
        <circle cx="120" cy="86" r="74" fill="#EAF1FF" />
        <path d="M64 54c0-6 5-10 11-10s11 4 11 10" stroke="#BBD1F5" stroke-width="3" stroke-linecap="round" />
        <path d="M150 44c0-6 5-10 11-10s11 4 11 10" stroke="#BBD1F5" stroke-width="3" stroke-linecap="round" />
        <line x1="40" y1="142" x2="200" y2="142" stroke="#9FBCEB" stroke-width="3" stroke-linecap="round" />
        <rect x="150" y="96" width="34" height="46" rx="3" fill="#DCE7FB" stroke="#5B7FC7" stroke-width="2.5" />
        <line x1="159" y1="104" x2="159" y2="142" stroke="#5B7FC7" stroke-width="2" />
        <line x1="168" y1="104" x2="168" y2="142" stroke="#5B7FC7" stroke-width="2" />
        <line x1="177" y1="104" x2="177" y2="142" stroke="#5B7FC7" stroke-width="2" />
        <rect x="66" y="128" width="54" height="14" rx="2" fill="#DCE7FB" stroke="#5B7FC7" stroke-width="2.5" />
        <path d="M78 128 L92 82 L100 82 L86 128 Z" fill="#EAF1FF" stroke="#5B7FC7" stroke-width="2.5" stroke-linejoin="round" />
        <path d="M108 128 L94 82 L102 82 L116 128 Z" fill="#EAF1FF" stroke="#5B7FC7" stroke-width="2.5" stroke-linejoin="round" />
        <line x1="70" y1="78" x2="150" y2="60" stroke="#5B7FC7" stroke-width="4" stroke-linecap="round" />
        <path d="M150 60 q14 -3 16 12 q-14 3 -16 -12 Z" fill="#DCE7FB" stroke="#5B7FC7" stroke-width="2.5" stroke-linejoin="round" />
        <circle cx="66" cy="80" r="9" fill="#DCE7FB" stroke="#5B7FC7" stroke-width="2.5" />
        <line x1="132" y1="66" x2="132" y2="120" stroke="#5B7FC7" stroke-width="2.5" stroke-linecap="round" />
        <rect x="124" y="120" width="16" height="8" rx="2" fill="#DCE7FB" stroke="#5B7FC7" stroke-width="2" />
      </svg>
      <p class="chart-no-data__text">{{ message }}</p>
    </div>
  `,
  styles: [`
    .chart-no-data {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 100%;
      min-height: 180px;
      padding: 16px;
      box-sizing: border-box;
    }
    .chart-no-data__art { width: 180px; max-width: 60%; height: auto; }
    .chart-no-data__text { margin: 0; color: #667085; font-size: 14px; font-weight: 500; }
  `],
})
export class ChartNoDataComponent {
  @Input() message = 'No data found';
}

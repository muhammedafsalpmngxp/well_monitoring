import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DashboardBranding } from '../../../core/models/dashboard.model';
import { DashboardLogoComponent } from './dashboard-logo.component';

@Component({
  selector: 'app-dashboard-branding',
  standalone: true,
  imports: [CommonModule, DashboardLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="branding" [class.branding--titled]="title" *ngIf="title || branding.leftLogo || branding.rightLogo" aria-label="Dashboard branding">
    <app-dashboard-logo *ngIf="branding.leftLogo" class="left" [asset]="branding.leftLogo" [dashboardId]="dashboardId" [token]="token" label="Left dashboard logo" />
    <div *ngIf="title" class="branding__heading">
      <h1>{{ title }}</h1>
      <p *ngIf="subtitle">{{ subtitle }}</p>
    </div>
    <app-dashboard-logo *ngIf="branding.rightLogo" class="right" [asset]="branding.rightLogo" [dashboardId]="dashboardId" [token]="token" label="Right dashboard logo" />
  </div>`,
  styles: [`:host { display: block; }
    .branding { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 12px 20px; background: #fff; border: 1px solid #e7ecf3;border-radius:10px;margin-bottom:10px; }
    app-dashboard-logo { width: 160px; max-width: 100%; height: 64px; }
    .left { grid-column: 1; justify-self: start; }
    .right { grid-column: 2; justify-self: end; }
    .branding--titled { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr); align-items: center; }
    .branding--titled > * { grid-row: 1; }
    .branding--titled .right { grid-column: 3; }
    .branding__heading { grid-column: 2; min-width: 0; text-align: center; overflow-wrap: anywhere; }
    .branding__heading h1 { margin: 0; font-size: 24px; font-weight: 700; line-height: 1.3; color: #1d2939; }
    .branding__heading p { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: #667085; }
    @media (max-width: 600px) {
      .branding--titled { gap: 8px; padding: 12px; }
      .branding__heading h1 { font-size: 18px; }
    }`],
})
export class DashboardBrandingComponent {
  @Input() branding: DashboardBranding = {};
  @Input() dashboardId?: number;
  @Input() token = '';
  @Input() title = '';
  @Input() subtitle = '';
}
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { DashboardLogoAsset } from '../../../core/models/dashboard.model';
import { DashboardLogoService } from '../../../core/services/dashboard-logo.service';

@Component({
  selector: 'app-dashboard-logo',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img *ngIf="url && !failed" [src]="url" [alt]="label" (error)="failed = true" />
    <span *ngIf="failed" role="status">Logo unavailable</span>`,
  styles: [`:host { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
    img { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; max-width: 100%; max-height: 100%; object-fit: contain; }
    span { color: #667085; font-size: 12px; }`],
})
export class DashboardLogoComponent implements OnChanges, OnDestroy {
  @Input() asset: DashboardLogoAsset | null | undefined;
  @Input() previewUrl = '';
  @Input() dashboardId?: number;
  @Input() token = '';
  @Input() label = 'Dashboard logo';
  url = '';
  failed = false;
  private ownedUrl = '';
  private request?: Subscription;

  constructor(private readonly logos: DashboardLogoService, private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.release();
    this.failed = false;
    this.url = this.previewUrl;
    if (this.url || !this.asset) return;
    this.request = this.logos.load(this.asset.assetId, this.dashboardId, this.token).subscribe({
      next: blob => {
        this.ownedUrl = URL.createObjectURL(blob);
        this.url = this.ownedUrl;
        this.cdr.markForCheck();
      },
      error: () => { this.failed = true; this.cdr.markForCheck(); },
    });
  }

  ngOnDestroy(): void { this.release(); }

  private release(): void {
    this.request?.unsubscribe();
    if (this.ownedUrl) URL.revokeObjectURL(this.ownedUrl);
    this.ownedUrl = '';
  }
}
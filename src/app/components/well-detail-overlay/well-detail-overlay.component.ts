import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { NavigationStart, Router } from '@angular/router';
import { WellDetailService } from '../../services/well-detail.service';
import { DashboardService } from '../../services/dashboard.service';

@Component({
  selector: 'app-well-detail-overlay',
  templateUrl: './well-detail-overlay.component.html',
  styleUrls: ['./well-detail-overlay.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class WellDetailOverlayComponent implements OnInit, OnDestroy {
  /** Controls visibility via Angular binding — no direct DOM style writes needed. */
  isVisible = false;

  @ViewChild('detailInner', { static: true })
  private detailInner!: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly wellDetailService: WellDetailService,
    private readonly dashboardService: DashboardService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    // Bridge legacy globals → Angular service so that any code that calls
    // window.awShowDetail() (app-globals.js grid buttons, theme-change handler, etc.)
    // routes through Angular instead of the old dynamically-loaded JS file.
    (window as any).awShowDetail  = (id: string) => this.wellDetailService.open(id);
    (window as any).awCloseDetail = ()           => {
      this.wellDetailService.close();
      // Navigate to allwells if not already there
      if (!this.router.url.startsWith('/allwells')) {
        this.router.navigate(['/allwells']);
      }
    };
    (window as any).awNavTo = (target: string) => {
      this.wellDetailService.close();
      const current = this.router.url.replace(/^\//, '').split('?')[0];
      if (current !== target) {
        this.router.navigate(['/' + target]);
      }
    };

    this.wellDetailService.activeWellId$
      .pipe(takeUntil(this.destroy$))
      .subscribe(wellId => {
        if (wellId) {
          this.openDetail(wellId);
        } else {
          this.closeDetail();
        }
      });

    // Close the overlay whenever the user navigates (e.g. clicks a sidebar menu).
    // Without this the overlay stays mounted on top of the newly-routed page,
    // making the sidebar appear unresponsive.
    this.router.events
      .pipe(
        filter((e): e is NavigationStart => e instanceof NavigationStart),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.isVisible) {
          this.wellDetailService.close();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private openDetail(wellId: string): void {
    this.isVisible = true;
    (window as any)._awDetailCurrentWell = wellId;

    // Show loading state immediately
    this.detailInner.nativeElement.innerHTML =
      '<div style="padding:60px 24px;text-align:center;color:var(--txt-2,#64748b);font-size:10pt">' +
      'Loading well data\u2026</div>';

    // Hide filter dock / scope banners while overlay is open
    this.setFilterDockVisible(false);

    // Fetch via Angular HttpClient — no raw fetch() calls needed
    this.dashboardService.getWellDetail(wellId).subscribe({
      next: d => {
        // Delegate HTML rendering to the render function exposed by well-detail-live.js.
        // It writes directly to #awDetailInner and sets the overlay background.
        if (typeof (window as any)._wdRenderDetail === 'function') {
          (window as any)._wdRenderDetail(wellId, d);
        } else {
          // Fallback if the renderer hasn't loaded yet
          this.detailInner.nativeElement.innerHTML =
            '<div style="padding:48px;text-align:center;color:#ef4444">' +
            'Renderer not ready. Please refresh.</div>';
        }
      },
      error: () => {
        this.detailInner.nativeElement.innerHTML =
          '<div style="padding:48px;text-align:center;color:#ef4444">' +
          'Failed to load well data. Please try again.</div>';
      },
    });
  }

  private closeDetail(): void {
    this.isVisible = false;
    (window as any)._awDetailCurrentWell = null;
    this.setFilterDockVisible(true);
  }

  private setFilterDockVisible(visible: boolean): void {
    const display = visible ? '' : 'none';
    (['hfbDock', 'hfbChip'] as const).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = display;
    });
    document.querySelectorAll<HTMLElement>('.hfb-scope-banner')
      .forEach(el => (el.style.display = display));
  }
}


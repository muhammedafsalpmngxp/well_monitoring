import {
  Component,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  ViewEncapsulation
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DashboardService, WellsReadiness, WmrWell } from '../../services/dashboard.service';

@Component({
  selector: 'app-wellsreadiness',
  templateUrl: './wellsreadiness.component.html',
  styleUrls: ['./wellsreadiness.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class WellsReadinessComponent implements AfterViewInit, OnDestroy {

  isLoading = true;
  data: WellsReadiness | null = null;
  errorMsg = '';

  /** Year picker — default to current year */
  selectedYear: number = new Date().getFullYear();
  availableYears: number[] = [];

  /** Date picker — default to today, formatted as yyyy-MM-dd for <input type="date"> */
  today: string = new Date().toISOString().slice(0, 10);
  selectedDate: string = this.today;

  /** Wells drill-through */
  activeFilter: 'plan' | 'flafscr' | 'clean' | 'completed' | null = null;
  wells: WmrWell[] = [];
  isLoadingWells = false;
  wellsError = '';

  private sub?: Subscription;
  private wellsSub?: Subscription;

  constructor(
    private dashSvc: DashboardService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {
    const currentYear = new Date().getFullYear();
    this.availableYears = [currentYear - 1, currentYear, currentYear + 1];
    this.selectedYear = currentYear;
  }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Read optional query params set by cmdoverview KPI tile clicks
    const params = this.route.snapshot.queryParams;
    if (params['year']) {
      const yr = +params['year'];
      if (!isNaN(yr)) this.selectedYear = yr;
    }

    this.load();

    if (params['filter']) {
      this.selectFilter(params['filter'] as 'plan' | 'flafscr' | 'clean' | 'completed');
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.wellsSub?.unsubscribe();
  }

  onYearChange(): void {
    this.load();
    if (this.activeFilter) this.loadWells();
  }

  onDateChange(): void {
    this.load();
  }

  selectFilter(filter: 'plan' | 'flafscr' | 'clean' | 'completed'): void {
    // Toggle off if already active
    if (this.activeFilter === filter) {
      this.activeFilter = null;
      this.wells = [];
      this.cdr.detectChanges();
      return;
    }
    this.activeFilter = filter;
    this.loadWells();
  }

  private loadWells(): void {
    if (!this.activeFilter) return;
    this.isLoadingWells = true;
    this.wellsError = '';
    this.wells = [];
    this.cdr.detectChanges();

    this.wellsSub?.unsubscribe();

    const filters: Parameters<typeof this.dashSvc.getWellsList>[0] = {
      from: `${this.selectedYear}-01-01`,
      to: this.selectedDate,
      cluster: this.dashSvc.currentFilter.cluster,
      project: this.dashSvc.currentFilter.project,
      wrFilter: (this.activeFilter === 'flafscr' || this.activeFilter === 'clean') ? this.activeFilter : undefined,
      status:   this.activeFilter === 'completed' ? 'completed' : undefined,
    };

    this.wellsSub = this.dashSvc.getWellsList(filters).subscribe({
      next: (w) => {
        this.wells = w;
        this.isLoadingWells = false;
        this.cdr.detectChanges();
        // Scroll the wells table into view
        setTimeout(() => {
          const el = document.querySelector('.wr-wells-section');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      },
      error: () => {
        this.wellsError = 'Unable to load wells list.';
        this.isLoadingWells = false;
        this.cdr.detectChanges();
      }
    });
  }

  private load(): void {
    this.isLoading = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    this.sub?.unsubscribe();
    const fromDate = `${this.selectedYear}-01-01`;
    const toDate = this.selectedDate;
    const globalFilter = this.dashSvc.currentFilter;
    this.sub = this.dashSvc.getWellsReadiness({ fromDate, toDate, cluster: globalFilter.cluster, project: globalFilter.project }).subscribe({
      next: (result) => {
        this.data = result;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMsg = 'Unable to load Wells Readiness data. Please try again.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  /** Funnel step widths as % of max (original plan) */
  funnelWidth(value: number): number {
    if (!this.data || this.data.originalPlan === 0) return 0;
    // The actual-completed bar can exceed clean target — cap at 100%
    const pct = (value / this.data.originalPlan) * 100;
    return Math.min(100, Math.round(pct));
  }

  /**
   * SVG trapezoid paths for the funnel chart.
   *
   * Each band is a clean trapezoid whose top width = its own value and
   * bottom width = the next value. Adjacent bands share their meeting
   * width exactly so blue→orange→yellow→green flow continuously, whether
   * values decrease, grow, or recover.
   *
   * Only the very top (blue) and very bottom (green) have rounded outer
   * corners — all internal edges between bands are straight horizontal
   * lines, so junctions look perfectly flush.
   */
  get funnelPoints(): { blue: string; orange: string; yellow: string; greenGhost: string; green: string } {
    const empty = { blue: '', orange: '', yellow: '', greenGhost: '', green: '' };
    if (!this.data) return empty;

    const v0 = this.data.originalPlan;
    const v1 = this.data.afterFlafScr;
    const v2 = this.data.cleanTarget;
    const v3 = this.data.actualCompleted;

    const W = 440, cx = 220, r = 8;
    const maxV = Math.max(v0, v1, v2, v3, 1);
    const maxHw = W / 2 - 20;   // leave a small horizontal margin
    const minHw = 28;           // keep tiny values visible
    const hw = (v: number): number => {
      const ratio = Math.max(v, 0) / maxV;
      return Math.max(minHw, Math.round(ratio * maxHw));
    };

    const hw0 = hw(v0);
    const hw1 = hw(v1);
    const hw2 = hw(v2);
    const hw3 = hw(v3);

    // 4 bands, 4px gap between each — keeps subtle separation while
    // letting widths line up edge-to-edge.
    const bandH = 78;
    const gap = 4;
    const y0 = 0;
    const y1 = y0 + bandH;
    const y2 = y1 + gap;
    const y3 = y2 + bandH;
    const y4 = y3 + gap;
    const y5 = y4 + bandH;
    const y6 = y5 + gap;
    const y7 = y6 + bandH;

    /** roundTop/roundBot: only round the outermost corners of the whole funnel */
    const band = (
      topY: number, botY: number,
      topHW: number, botHW: number,
      roundTop: boolean, roundBot: boolean
    ): string => {
      const tl = cx - topHW, tr = cx + topHW;
      const bl = cx - botHW, br = cx + botHW;
      const crT = roundTop ? Math.min(r, topHW) : 0;
      const crB = roundBot ? Math.min(r, botHW) : 0;

      const parts: string[] = [];
      // start at top-left (offset by corner radius if rounded)
      parts.push(`M ${tl + crT} ${topY}`);
      // top edge
      parts.push(`L ${tr - crT} ${topY}`);
      if (roundTop) parts.push(`Q ${tr} ${topY} ${tr} ${topY + crT}`);
      // right diagonal (or vertical if same width)
      parts.push(`L ${br} ${botY - crB}`);
      if (roundBot) parts.push(`Q ${br} ${botY} ${br - crB} ${botY}`);
      // bottom edge
      parts.push(`L ${bl + crB} ${botY}`);
      if (roundBot) parts.push(`Q ${bl} ${botY} ${bl} ${botY - crB}`);
      // left diagonal back up
      parts.push(`L ${tl} ${topY + crT}`);
      if (roundTop) parts.push(`Q ${tl} ${topY} ${tl + crT} ${topY}`);
      parts.push(`Z`);
      return parts.join(' ');
    };

    return {
      blue:       band(y0, y1, hw0, hw1, true,  false),
      orange:     band(y2, y3, hw1, hw2, false, false),
      yellow:     band(y4, y5, hw2, hw3, false, false),
      // Ghost shows full clean-target width (hw2) — the "potential" band.
      // Solid green (hw3) overlays the center; the ghost "wings" = shortfall.
      greenGhost: band(y6, y7, hw2, hw2, false, true),
      green:      band(y6, y7, hw3, hw3, false, true)
    };
  }

  /** Shortfall: clean target minus actual completed */
  get shortfall(): number {
    return Math.max(0, (this.data?.cleanTarget ?? 0) - (this.data?.actualCompleted ?? 0));
  }

  /** Format an ISO date string as DD-Mon-YYYY (e.g. 05-Jan-2026) */
  fmtDate(val: string | null | undefined): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Format a signed number with + prefix */
  signed(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  /** Color class based on completion percentage:
   *  ≥ 90% → green  |  ≥ 75% → amber  |  < 75% → red */
  pctColor(pct: number): string {
    if (pct >= 90) return 'green';
    if (pct >= 75) return 'amber';
    return 'red';
  }
}

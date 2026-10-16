import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ChangeDetectorRef, ViewEncapsulation
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DashboardService,
  HookupProgressResponse,
  OdcWellStatusItem
} from '../../services/dashboard.service';

export type HookupWaterfallPill = 'original_plan' | 'after_flaf_scr' | 'after_pdo_issues' | 'completed' | 'backlog';
export type HookupWellTypeView = 'conventional' | 'non-standard' | 'well-conversions';

@Component({
  selector: 'app-hookup-drilldown',
  templateUrl: './hookup-drilldown.component.html',
  styleUrls: ['./hookup-drilldown.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class HookupDrilldownComponent implements OnInit, AfterViewInit, OnDestroy {

  isLoading = true;
  errorMsg = '';

  wellTypeView: HookupWellTypeView = 'conventional';
  activePill: HookupWaterfallPill = 'original_plan';

  hookupData: HookupProgressResponse | null = null;
  private allWells: OdcWellStatusItem[] = [];
  private filteredWells: OdcWellStatusItem[] = [];

  totalCount = 0;

  /** Counts sourced from the waterfall API data */
  waterfallCounts = {
    original_plan:    0,
    after_flaf_scr:   0,
    after_pdo_issues: 0,
    completed:        0,
    backlog:          0
  };

  private kpiSub?: Subscription;
  private wellsSub?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const p = this.route.snapshot.queryParams;
    this.wellTypeView = (p['wellType'] as HookupWellTypeView) || 'conventional';
    this.activePill = (p['pill'] as HookupWaterfallPill) || 'original_plan';
  }

  ngAfterViewInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.kpiSub?.unsubscribe();
    this.wellsSub?.unsubscribe();
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  selectWellType(type: HookupWellTypeView): void {
    this.wellTypeView = type;
    this.activePill = 'original_plan';
    this.loadData();
  }

  onPillClick(pill: HookupWaterfallPill): void {
    this.activePill = pill;
    this.cdr.detectChanges();
    this.applyWaterfallFilter();
  }

  exportCsv(): void {
    const wells = this.filteredWells;
    if (!wells.length) { alert('No data to export.'); return; }
    const esc = (s: any): string => {
      const str = (s == null) ? '' : String(s);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? '"' + str.replaceAll('"', '""') + '"' : str;
    };
    const headers = ['Well ID','Well Name','Status','Category','Field','Rig','Progress %','Planned %','Variance','SPI','CPI','Rig Start','Rig End'];
    const rows = wells.map((w: any) => [
      esc(w.wellId), esc(w.name), esc(w.rawStatus), esc(w.odcCategory),
      esc(w.field), esc(w.rig), w.pct ?? '', w.planned ?? '',
      w.variance ?? '', w.spi ?? '', w.cpi ?? '', esc(w.rigBy), esc(w.rigTo)
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hookup-wells-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  get wellTypeLabel(): string {
    const labels: Record<HookupWellTypeView, string> = {
      'conventional':    'Conventional',
      'non-standard':    'Non-Standard',
      'well-conversions':'Well Conversions'
    };
    return labels[this.wellTypeView] || 'Conventional';
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private loadData(): void {
    this.isLoading = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    this.kpiSub?.unsubscribe();
    this.wellsSub?.unsubscribe();

    const currentYear = new Date().getFullYear();
    const from = `${currentYear}-01-01`;
    const to   = `${currentYear}-12-31`;

    // Fetch waterfall KPI (used for hookupData / chart — counts are overridden by computePillCountsFromWells)
    this.kpiSub = this.dashSvc.getHookupProgress({ wellType: this.wellTypeView, from, to }).subscribe({
      next: (d) => {
        this.hookupData = d;
        this.buildWaterfallCounts(d);
        // If wells already loaded, immediately re-apply list-derived counts so
        // the API waterfall numbers don't overwrite the badge values.
        if (this.allWells.length > 0) { this.computePillCountsFromWells(); }
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    // Fetch wells list — same date range as hookup-progress so counts match overview tiles.
    this.wellsSub = this.dashSvc.getHookupWellsList({ wellType: this.wellTypeView, from, to }).subscribe({
      next: (wells) => {
        this.allWells = wells;
        this.computePillCountsFromWells();
        this.isLoading = false;
        this.cdr.detectChanges();
        this.applyWaterfallFilter();
      },
      error: () => {
        this.errorMsg = 'Unable to load hookup wells data. Please try again.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private buildWaterfallCounts(d: HookupProgressResponse): void {
    const steps = d.waterfallSteps || [];
    const findStep = (label: string) => steps.find(s => s.label.toLowerCase().includes(label))?.value ?? 0;
    this.waterfallCounts = {
      original_plan:    findStep('pdo plan'),
      after_flaf_scr:   Math.abs(findStep('after flaf')),
      after_pdo_issues: Math.abs(findStep('clean')),
      completed:        d.kpi.actualCompleted,
      backlog:          d.overall.backlogInHookup
    };
  }

  /** Recompute all pill counts from the well list using waterfallBucket so
   *  each badge exactly matches the grid row count for that pill. */
  private computePillCountsFromWells(): void {
    const bucket = (w: any): string => (w as any).waterfallBucket || 'backlog';
    const total       = this.allWells.length;                                                    // original_plan
    const notFlaf     = this.allWells.filter(w => bucket(w) !== 'flaf_scr').length;             // after_flaf_scr
    const clean       = this.allWells.filter(w => bucket(w) !== 'flaf_scr' && bucket(w) !== 'pdo_issues').length; // after_pdo_issues
    const completed   = this.allWells.filter(w => bucket(w) === 'completed').length;
    const backlog     = this.allWells.filter(w => bucket(w) === 'backlog').length;
    this.waterfallCounts = {
      original_plan:    total,
      after_flaf_scr:   notFlaf,
      after_pdo_issues: clean,
      completed,
      backlog
    };
  }

  private applyWaterfallFilter(): void {
    // Each well from hookup-wells-list carries a waterfallBucket:
    //   'completed'  → is_hooked_up = 1
    //   'flaf_scr'   → is_flaf_scr_delayed = 1 (not hooked up)
    //   'pdo_issues' → is_pdo_issue = 1 (not flaf_scr, not hooked up)
    //   'backlog'    → clean wells not yet hooked up
    const bucket = (w: any): string => (w as any).waterfallBucket || 'backlog';
    switch (this.activePill) {
      case 'original_plan':
        // All 201 wells
        this.filteredWells = [...this.allWells];
        break;
      case 'after_flaf_scr':
        // Exclude flaf_scr-delayed wells → 106
        this.filteredWells = this.allWells.filter(w => bucket(w) !== 'flaf_scr');
        break;
      case 'after_pdo_issues':
        // Exclude flaf_scr and pdo_issues → 106
        this.filteredWells = this.allWells.filter(w => bucket(w) !== 'flaf_scr' && bucket(w) !== 'pdo_issues');
        break;
      case 'completed':
        // Only hooked-up wells → 101
        this.filteredWells = this.allWells.filter(w => bucket(w) === 'completed');
        break;
      case 'backlog':
        // Clean wells not yet completed → 5
        this.filteredWells = this.allWells.filter(w => bucket(w) === 'backlog');
        break;
      default:
        this.filteredWells = [...this.allWells];
    }
    this.totalCount = this.filteredWells.length;

    const mapped = this.filteredWells.map(w => this.mapToGridRow(w));
    (globalThis as any).AW_WELLS = mapped;
    (globalThis as any).__awSkipTileUpdate = true;
    const fn = (globalThis as any)['renderAllWells'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[hookup-drilldown] renderer threw', e); }
      // renderAllWells uses an internal 50 ms setTimeout that strips .active from all
      // .aw-status-pill elements and tries to restore via id="awf-..." (which don't
      // exist on this page). Re-run Angular change detection after that delay so the
      // [class.active] bindings are restored to reflect the correct activePill.
      setTimeout(() => this.cdr.detectChanges(), 60);
    }
  }

  private mapToGridRow(w: OdcWellStatusItem): any {
    const pct = Math.round(w.progressPct);
    return {
      wellId:           w.wellId,
      name:             w.wellName || w.wellId,
      rawStatus:        w.status,
      rigActive:        pct > 0 && pct < 100,
      rig:              w.rig ?? '—',
      field:            w.field ?? '',
      loc:              w.wellName ?? '',
      type:             w.wellType ?? 'N/A',
      pct,
      planned:          w.plannedPct != null ? Math.round(w.plannedPct) : null,
      variance:         w.variance   != null ? Math.round(w.variance)   : null,
      rateDay:          w.ratePerDay ?? null,
      askRate:          w.askRate    ?? 7.0,
      gapDay:           w.gapPerDay  ?? null,
      spi:              w.spi,
      cpi:              w.cpi,
      status:           this.deriveGridStatus(w.status, pct, w.variance),
      atRisk:           w.spi != null && w.spi < 0.85 && w.spi >= 0.7,
      tags:             [w.wellType ?? 'N/A'],
      extra:            null,
      highPerformer:    (w.spi != null && w.spi >= 1) || pct >= 85,
      rigBy:            this.fmtDate(w.rigBy),
      rigTo:            this.fmtDate(w.rigTo),
      rigOnDate:        w.rigBy,
      flConstructionPct: w.constrPct,
      ohlPct:           w.drillingPct,
      commPct:          w.commProgress,
      odcCategory:      w.odcCategory,
      dwcCategory:      w.odcCategory,
      p: {
        locPrep:       this.mapPhase(w.locPrepStatus, null),
        construction:  this.mapPhase(w.constrStatus,  w.constrPct),
        commissioning: this.mapPhase(w.commStatus,    w.commProgress),
        drilling:      w.drillingPct > 0 ? Math.round(w.drillingPct) : null,
        procurement: null, mechanical: null, civil: null,
        completion:  pct >= 100 ? true : null,
      }
    };
  }

  private deriveGridStatus(status: string, pct: number, variance: number | null): string {
    switch ((status || '').toUpperCase()) {
      case 'COMPLETED': return 'completed';
      case 'ON HOLD':   return 'onhold';
      case 'PLANNED':   return 'planned';
      case 'ACTIVE':
        if (variance != null && Math.round(variance) < 0) return 'critical';
        if (pct < 15) return 'early';
        return 'inprogress';
      default: return 'planned';
    }
  }

  private mapPhase(statusStr: string | null, pct: number | null): any {
    if (statusStr === 'Completed')  return true;
    if (statusStr === 'In Progress') return (pct != null && pct > 0) ? Math.round(pct) : 50;
    return null;
  }

  private fmtDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    const dd  = String(d.getDate()).padStart(2, '0');
    const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${dd} ${mmm} ${d.getFullYear()}`;
  }

}

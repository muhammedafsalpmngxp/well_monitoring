import { Component, OnInit, OnDestroy, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, WellStatusItem, ActiveWellsKpi } from '../../services/dashboard.service';

@Component({
  selector: 'app-allwells',
  templateUrl: './allwells.component.html',
  styleUrls: ['./allwells.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AllWellsComponent implements OnInit, OnDestroy {

  isLoading = true;
  private isBufferMode = false;

  private kpiSub?: Subscription;
  private wellsSub?: Subscription;
  private filterSub?: Subscription;
  private lastKpi?: ActiveWellsKpi;

  constructor(
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef,
    private readonly location: Location
  ) {}

  goBack(): void {
    // Reset any pending WLA/commissioning/buffer globals
    delete (globalThis as any).__awPendingWlaMode;
    delete (globalThis as any).__awPendingWlaStatus;
    delete (globalThis as any).__awPendingWlaFrom;
    delete (globalThis as any).__awPendingWlaTo;
    delete (globalThis as any).__awPendingWlaProject;
    delete (globalThis as any).__awPendingWlaWellType;
    delete (globalThis as any).__awPendingCommStatus;
    delete (globalThis as any).__awPendingBufferReady;
    delete (globalThis as any).__awPendingPeggingBucket;
    delete (globalThis as any).__awCommMode;
    delete (globalThis as any).__awBufferMode;

    // Reset the "All" pill filter in the grid
    const awFilter = (globalThis as any)['awFilter'];
    const allPill = document.getElementById('awf-all');
    if (typeof awFilter === 'function' && allPill) {
      awFilter('all', allPill);
    }

    this.location.back();
  }

  ngOnInit(): void {
    this.fetchData();

    // Re-fetch when header filters change
    this.filterSub = this.dashSvc.filter$.pipe(skip(1)).subscribe(() => {
      this.kpiSub?.unsubscribe();
      this.wellsSub?.unsubscribe();
      this.fetchData();
    });
  }

  ngOnDestroy(): void {
    this.kpiSub?.unsubscribe();
    this.wellsSub?.unsubscribe();
    this.filterSub?.unsubscribe();
  }

  private get ytdFrom(): string {
    const y = new Date().getFullYear();
    return `${y}-01-01`;
  }
  private get ytdTo(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  private fetchData(): void {
    this.isLoading = true;
    this.cdr.detectChanges();

    const f = this.dashSvc.currentFilter;

    // Read pending cluster filter (set by Buffer Flowlines Ready widget click)
    const pendingCluster: string | undefined = (globalThis as any).__awPendingCluster || undefined;
    if (pendingCluster) { delete (globalThis as any).__awPendingCluster; }

    // Read pending buffer flowlines ready filter (set by Buffer widget click)
    const pendingBufferReady: boolean = !!(globalThis as any).__awPendingBufferReady;
    if (pendingBufferReady) { delete (globalThis as any).__awPendingBufferReady; this.isBufferMode = true; }

    // Read pending commissioning status filter (set by PDO Commissioning widget click)
    const pendingCommStatus: string | undefined = (globalThis as any).__awPendingCommStatus || undefined;
    if (pendingCommStatus) { delete (globalThis as any).__awPendingCommStatus; }
    const pendingCommFrom: string | undefined = (globalThis as any).__awPendingCommFrom || undefined;
    if (pendingCommFrom) { delete (globalThis as any).__awPendingCommFrom; }
    const pendingCommTo: string | undefined = (globalThis as any).__awPendingCommTo || undefined;
    if (pendingCommTo) { delete (globalThis as any).__awPendingCommTo; }

    // Read pending pegging-bucket filter (set by Overall Pegging Status donut click)
    const pendingPeggingBucket: string | undefined = (globalThis as any).__awPendingPeggingBucket || undefined;
    if (pendingPeggingBucket) { delete (globalThis as any).__awPendingPeggingBucket; }

    // Read pending WLA mode flag (set by Workload Analysis chart bar click)
    const pendingWlaMode: boolean = !!(globalThis as any).__awPendingWlaMode;
    if (pendingWlaMode) { delete (globalThis as any).__awPendingWlaMode; }

    // Read WLA month-specific date range (set by bar click)
    const pendingWlaFrom: string | undefined = (globalThis as any).__awPendingWlaFrom || undefined;
    if (pendingWlaFrom) { delete (globalThis as any).__awPendingWlaFrom; }
    const pendingWlaTo: string | undefined = (globalThis as any).__awPendingWlaTo || undefined;
    if (pendingWlaTo) { delete (globalThis as any).__awPendingWlaTo; }

    // Read pending WLA project/wellType (saved before hfbOnChange reset them)
    const pendingWlaProject: string | undefined = (globalThis as any).__awPendingWlaProject || undefined;
    if (pendingWlaProject) { delete (globalThis as any).__awPendingWlaProject; }
    const pendingWlaWellType: string | undefined = (globalThis as any).__awPendingWlaWellType || undefined;
    if (pendingWlaWellType) { delete (globalThis as any).__awPendingWlaWellType; }

    // The pegging-bucket drill-down spans all dates (matching the dashboard pie),
    // so suppress the header date range when it's active — same as commStatus.
    const bypassDates = !!pendingCommStatus || !!pendingPeggingBucket;

    // Pass cluster (from topbar), wellType (stored as 'location' in HfbFilter),
    // and date range to the API
    const wellsFilters = {
      cluster: pendingCluster || f.cluster || undefined,
      site: f.site || undefined,
      wellType: pendingWlaWellType || f.location || undefined,
      project: pendingWlaProject || f.project || undefined,
      from: pendingWlaFrom || ((bypassDates || this.isBufferMode) ? undefined : (f.startDate || this.ytdFrom)),
      to: pendingWlaTo || ((bypassDates || this.isBufferMode) ? undefined : (f.endDate || this.ytdTo)),
      commStatus: pendingCommStatus,
      commFrom: pendingCommFrom,
      commTo: pendingCommTo,
      bufferReady: this.isBufferMode || undefined,
      peggingBucket: pendingPeggingBucket,
      wlaMode: pendingWlaMode || undefined,
    };

    // Signal to the grid renderer whether we're in commissioning mode
    (globalThis as any).__awCommMode = !!pendingCommStatus;
    // Signal buffer-ready mode for grid columns
    (globalThis as any).__awBufferMode = this.isBufferMode;

    const kpiFilters = {
      cluster: pendingCluster || f.cluster || undefined,
      site: f.site || undefined,
      wellType: f.location || undefined,
      project: f.project || undefined,
      from: f.startDate || this.ytdFrom,
      to: f.endDate || this.ytdTo,
      thisMonth: false,
    };

    // Fetch KPI counts from active-wells API (same source as dashboard KPI tiles)
    this.kpiSub = this.dashSvc.getActiveWells(kpiFilters).subscribe({
      next: (kpi) => {
        this.lastKpi = kpi;
        this.applyKpiCounts(kpi);
      },
      error: () => {}
    });

    // Fetch wells list with filters for the grid
    this.wellsSub = this.dashSvc.getWellStatusList(wellsFilters).subscribe({
      next: (wells) => this.applyWellsData(wells),
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private applyWellsData(wells: WellStatusItem[]): void {
    this.isLoading = false;
    this.cdr.detectChanges();

    const mapped = wells.map(w => this.mapToGridRow(w));
    (globalThis as any).AW_WELLS = mapped;

    // Let awUpdateTilesFromScoped() recompute pill counts from actual well data
    // so pill counts always match the grid's client-side filtering logic.
    (globalThis as any).__awSkipTileUpdate = false;

    // Call the existing grid renderer in app-globals.js
    const fn = (globalThis as any)['renderAllWells'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[allwells] renderer threw', e); }
    }

    // If navigated from WLA bar click, activate the "completed" pill now that data is ready
    if ((globalThis as any).__awPendingWlaStatus) {
      const status = (globalThis as any).__awPendingWlaStatus;
      delete (globalThis as any).__awPendingWlaStatus;
      setTimeout(() => {
        const pill = document.getElementById('awf-' + status);
        const awFilter = (globalThis as any)['awFilter'];
        if (pill && typeof awFilter === 'function') {
          awFilter(status, pill);
        }
      }, 50);
    }

    // If navigated from ODC tile click, activate the dynamic ODC category pill
    if ((globalThis as any).__awPendingOdcCat) {
      const catKey = (globalThis as any).__awPendingOdcCat;
      const catLabel = (globalThis as any).__awPendingOdcLabel || catKey;
      delete (globalThis as any).__awPendingOdcCat;
      delete (globalThis as any).__awPendingOdcLabel;
      setTimeout(() => {
        const awActivateOdcPill = (globalThis as any)['awActivateOdcPill'];
        if (typeof awActivateOdcPill === 'function') {
          awActivateOdcPill(catKey, catLabel);
        }
      }, 50);
    }
  }

  private applyKpiCounts(kpi: ActiveWellsKpi): void {
    const a = kpi.activeToday ?? 0;
    const t = kpi.totalThisMonth ?? 0;

    // Active Wells KPI card
    this.setText('.aw-kpi.active .aw-active-val', String(a));
    this.setText('.aw-kpi.active .aw-total-val', String(t));
    this.setText('.aw-kpi.active .aw-active-breakdown',
      `${kpi.inProgress ?? 0} in progress \u00b7 ${kpi.onHold ?? 0} on hold`);
    const ratio = t > 0 ? Math.round((a / t) * 100) : 0;
    const fillEl = document.querySelector('.aw-kpi.active .aw-kpi-bar-fill') as HTMLElement | null;
    if (fillEl) fillEl.style.width = ratio + '%';

    const critical = kpi.critical ?? 0;
    const inProgress = kpi.inProgress ?? 0;
    const completed = kpi.completed ?? 0;
    const early = kpi.early ?? 0;
    const onHold = kpi.onHold ?? 0;
    const planned = kpi.planned ?? 0;
    const pct = (n: number) => t > 0 ? Math.round((n / t) * 100) + '%' : '0%';

    this.setText('.aw-kpi.critical .kpi-val', String(critical));
    this.setText('.aw-kpi.critical .aw-kpi-pct', pct(critical));
    this.setText('.aw-kpi.progress .kpi-val', String(inProgress));
    this.setText('.aw-kpi.progress .aw-kpi-pct', pct(inProgress));

    this.setText('.aw-kpi.complete .kpi-val', String(completed));
    this.setText('.aw-kpi.complete .aw-kpi-pct', pct(completed));
    this.setText('.aw-kpi.early .kpi-val', String(early));
    this.setText('.aw-kpi.early .aw-kpi-pct', pct(early));
    this.setText('.aw-kpi.planned .kpi-val', String(planned + onHold));
    this.setText('.aw-kpi.planned .aw-kpi-pct', pct(planned + onHold));

    // Pill counts are computed by awUpdateTilesFromScoped() in app-globals.js
    // using the same client-side filtering logic as the grid, ensuring counts
    // always match the actual records shown when a pill is clicked.
  }

  private mapToGridRow(w: WellStatusItem): any {
    const pct = Math.round(w.progressPct);
    const rigActive = w.progressPct > 1 && w.progressPct < 100;

    // Map backend status (COMPLETED, ACTIVE, ON HOLD, PLANNED) to grid pill keys
    const status = this.deriveGridStatus(w, pct);
    const highPerformer = (w.spi != null && w.spi >= 1) || (pct >= 85 && status === 'completed');
    const atRisk = status === 'inprogress' && w.spi != null && w.spi < 0.85 && w.spi >= 0.7;

    return {
      wellId: w.wellId,
      name: w.wellName || w.wellId,
      rawStatus: w.status,
      rigActive,
      rig: w.rig ?? '\u2014',
      field: w.field ?? '',
      loc: w.wellName ?? '',
      type: w.wellType ?? 'N/A',
      pct,
      planned: w.plannedPct === null ? null : Math.round(w.plannedPct),
      variance: w.variance,
      rateDay: w.ratePerDay,
      askRate: w.askRate,
      gapDay: w.gapPerDay,
      spi: w.spi,
      cpi: w.cpi,
      status,
      atRisk,
      tags: [w.tags ?? w.wellType ?? 'N/A'],
      extra: null,
      highPerformer,
      rigBy: this.fmtDate(w.rigBy),
      rigTo: this.fmtDate(w.rigTo),
      peggingOn: this.fmtDate(w.peggedDate),
      rigOnDate: w.rigBy,
      flConstructionPct: w.constrPct,
      ohlPct: w.drillingPct,
      commPct: w.complePct,
      pdoIssue: false,
      drilledNotCompleted: false,
      commStartDate: w.commStartDate ?? null,
      commFinishDate: w.commFinishDate ?? null,
      commProgressPct: w.commProgressPct ?? null,
      engCompletionDate: w.engCompletionDate ?? null,
      completionType: w.completionType ?? null,
      isActiveKpi: w.isActiveKpi,
      isInactiveKpi: w.isInactiveKpi,
      isBonusPotential: w.isBonusPotential,
      isPenaltyExposure: w.isPenaltyExposure,
      p: {
        locPrep: this.mapPhase(w.locPrepStatus, null),
        construction: this.mapPhase(w.constrStatus, w.constrPct),
        commissioning: this.mapPhase(w.commStatus, w.complePct),
        drilling: w.drillingPct != null && w.drillingPct > 0 ? Math.round(w.drillingPct) : null,
        procurement: null,
        mechanical: null,
        civil: null,
        completion: w.status === 'COMPLETED' ? true : null,
      }
    };
  }

  private deriveGridStatus(w: WellStatusItem, pct: number): string {
    // Direct mapping from backend status to grid status key
    // Backend returns: Completed/Completed (Late)/Completed (On Time)/Completed (Early)/
    //                  Due/Delayed (At Risk)/On Time/Accelerated/Not Started
    const s = (w.status || '').toLowerCase();
    if (s.startsWith('completed')) return 'completed';
    if (s === 'due') return 'due';
    if (s === 'delayed (at risk)') return 'delayed';
    if (s === 'on time') return 'ontime';
    if (s === 'accelerated') return 'accelerated';
    if (s === 'not started') return 'notstarted';
    // Legacy fallback
    if (s === 'active') return 'ontime';
    if (s === 'inactive' || s === 'on hold') return 'delayed';
    if (s === 'planned') return 'notstarted';
    return 'ontime';
  }

  private mapPhase(statusStr: string | null, pct: number | null): any {
    if (statusStr === 'Completed') return true;
    if (statusStr === 'In Progress') return (pct != null && pct > 0) ? Math.round(pct) : 50;
    return null;
  }

  private fmtDate(dateStr: string | null): string {
    if (!dateStr) return '\u2014';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '\u2014';
    const dd = String(d.getDate()).padStart(2, '0');
    const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${dd} ${mmm} ${d.getFullYear()}`;
  }

  private setText(selector: string, value: string): void {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  }

  exportCsv(): void {
    const wells: any[] = (globalThis as any).AW_WELLS ?? [];
    if (!wells.length) { alert('No data to export.'); return; }

    const esc = (s: any): string => {
      const str = (s == null) ? '' : String(s);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? '"' + str.replaceAll('"', '""') + '"'
        : str;
    };

    const headers = [
      'Well Name','Status','Field','Rig','Progress %','Planned %','Variance %',
      'Rate/Day','Ask Rate','SPI','CPI','Rig Start','Rig End','High Performer'
    ];

    const rows = wells.map((w: any) => [
      esc(w.name), esc(w.status), esc(w.field), esc(w.rig),
      w.pct ?? '', w.planned ?? '', ((+w.pct || 0) - (+w.planned || 0)),
      w.rateDay ?? '', w.askRate ?? '', w.spi ?? '', w.cpi ?? '',
      esc(w.rigBy), esc(w.rigTo), w.highPerformer ? 'Yes' : 'No'
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `wells-export-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

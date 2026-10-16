import { Component, OnInit, OnDestroy, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, OdcWellStatusItem, OdcOverallStatus } from '../../services/dashboard.service';

/**
 * ODC category keys matching the 12 ODC Overall Status widget tiles.
 */
export type OdcCategory =
  | 'all'
  | 'drilled'
  | 'hookup'
  | 'due'
  | 'notdue'
  | 'dnc'
  | 'early'
  | 'backlog'
  | 'buffer'
  | 'completed'
  | 'suspended'
  | 'pdoissues'
  | 'readycomm';

@Component({
  selector: 'app-odcwells',
  templateUrl: './odcwells.component.html',
  styleUrls: ['./odcwells.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class OdcWellsComponent implements OnInit, OnDestroy {

  isLoading = true;
  activeCategory: OdcCategory = 'all';

  /** ODC KPI counts — driven directly from odc-overall-status API */
  odcCounts: OdcOverallStatus = {
    totalWells: 0, totalDrilled: 0, hookUpCompleted: 0, dueWells: 0, notDueWells: 0,
    drilledNotCompleted: 0, wellsAccelerated: 0, backlogWells: 0,
    bufferWells: 0, dueWellsCompleted: 0, suspendedWells: 0,
    pdoIssues: 0, readyForCommissioning: 0
  };

  /** Pill counts — sourced directly from odc-overall-status API */
  pillCounts: Record<OdcCategory, number> = {
    all: 0, drilled: 0, hookup: 0, due: 0, notdue: 0,
    dnc: 0, early: 0, backlog: 0, buffer: 0,
    completed: 0, suspended: 0, pdoissues: 0, readycomm: 0
  };

  /** All wells with server-side ODC classification */
  private allWells: any[] = [];
  filteredWells: any[] = [];

  private odcSub?: Subscription;
  private wellsSub?: Subscription;
  private filterSub?: Subscription;

  constructor(
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    // Check if navigated with a pending ODC category from the widget
    const pendingCat = (globalThis as any).__awPendingOdcCat;
    if (pendingCat) {
      this.activeCategory = pendingCat as OdcCategory;
      delete (globalThis as any).__awPendingOdcCat;
      delete (globalThis as any).__awPendingOdcLabel;
    }

    this.fetchData();

    this.filterSub = this.dashSvc.filter$.pipe(skip(1)).subscribe(() => {
      this.odcSub?.unsubscribe();
      this.wellsSub?.unsubscribe();
      this.fetchData();
    });
  }

  ngOnDestroy(): void {
    this.odcSub?.unsubscribe();
    this.wellsSub?.unsubscribe();
    this.filterSub?.unsubscribe();
  }

  selectCategory(cat: OdcCategory): void {
    this.activeCategory = cat;
    this.applyFilter();
  }

  goBack(): void {
    this.router.navigate(['/cmdoverview']);
  }

  private fetchData(): void {
    this.isLoading = true;
    this.cdr.detectChanges();

    const f = this.dashSvc.currentFilter;
    const from = f.startDate || undefined;
    const to = f.endDate || undefined;
    const cluster = f.cluster || undefined;
    const site = f.site || undefined;
    const wellType = f.location || undefined;
    const project = f.project || undefined;

    // Fetch ODC KPI counts from the same API used by the dashboard widget
    this.odcSub = this.dashSvc.getOdcOverallStatus({ cluster, site, wellType, project, from, to }).subscribe({
      next: (data) => {
        this.odcCounts = data;
        this.updatePillCountsFromApi();
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    // Fetch wells list with server-side ODC classification
    this.wellsSub = this.dashSvc.getOdcWellStatusList({ cluster, site, wellType, project, from, to }).subscribe({
      next: (wells) => this.applyWellsData(wells),
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  /** Update pill counts directly from the odc-overall-status API response */
  private updatePillCountsFromApi(): void {
    this.pillCounts = {
      all:       this.odcCounts.totalWells,
      drilled:   this.odcCounts.totalDrilled,
      hookup:    this.odcCounts.hookUpCompleted,
      due:       this.odcCounts.dueWells,
      notdue:    this.odcCounts.notDueWells,
      dnc:       this.odcCounts.drilledNotCompleted,
      early:     this.odcCounts.wellsAccelerated,
      backlog:   this.odcCounts.backlogWells,
      buffer:    this.odcCounts.bufferWells,
      completed: this.odcCounts.dueWellsCompleted,
      suspended: this.odcCounts.suspendedWells,
      pdoissues: this.odcCounts.pdoIssues,
      readycomm: this.odcCounts.readyForCommissioning
    };
  }

  private applyWellsData(wells: OdcWellStatusItem[]): void {
    this.isLoading = false;

    // Map server-classified wells to grid rows
    this.allWells = wells.map(w => this.mapToGridRow(w));

    this.applyFilter();
    this.cdr.detectChanges();
  }

  private applyFilter(): void {
    if (this.activeCategory === 'all') {
      this.filteredWells = [...this.allWells];
    } else if (this.activeCategory === 'drilled') {
      // Total Drilled = DrilledWells CTE: actual_rig_off_date IS NOT NULL
      this.filteredWells = this.allWells.filter(w => w.rigTo && w.rigTo !== '—');
    } else if (this.activeCategory === 'hookup' || this.activeCategory === 'readycomm') {
      // Hook-Up Completed / Ready for Commissioning (same set)
      this.filteredWells = this.allWells.filter(w => w.isHookup);
    } else if (this.activeCategory === 'suspended') {
      this.filteredWells = this.allWells.filter(w => w.isSuspended);
    } else if (this.activeCategory === 'due') {
      this.filteredWells = this.allWells.filter(w => w.isDue);
    } else if (this.activeCategory === 'notdue') {
      this.filteredWells = this.allWells.filter(w => w.isNotDue);
    } else if (this.activeCategory === 'early') {
      this.filteredWells = this.allWells.filter(w => w.isAccelerated);
    } else if (this.activeCategory === 'dnc') {
      this.filteredWells = this.allWells.filter(w => w.isDnc);
    } else if (this.activeCategory === 'completed') {
      this.filteredWells = this.allWells.filter(w => w.isDueCompleted);
    } else {
      // early, backlog, buffer, pdoissues — still exclusive in odc_category
      this.filteredWells = this.allWells.filter(w => w.odcCategory === this.activeCategory);
    }

    // Update the grid via app-globals renderer
    (globalThis as any).AW_WELLS = this.filteredWells;
    (globalThis as any).__awSkipTileUpdate = true;
    const fn = (globalThis as any)['renderAllWells'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[odcwells] renderer threw', e); }
    }

    // Update records badge
    const badge = document.getElementById('odcRecordsBadge');
    if (badge) badge.textContent = this.filteredWells.length + ' records';
  }

  private mapToGridRow(w: OdcWellStatusItem): any {
    const pct = Math.round(w.progressPct);
    const status = this.deriveGridStatus(w, pct);

    return {
      wellId: w.wellId,
      name: w.wellName || w.wellId,
      rawStatus: w.status,
      rigActive: pct > 0 && pct < 100,
      rig: w.rig ?? '—',
      field: w.field ?? '',
      loc: w.wellName ?? '',
      type: w.wellType ?? 'N/A',
      pct,
      planned: w.plannedPct != null ? Math.round(w.plannedPct) : null,
      variance: w.variance != null ? Math.round(w.variance) : null,
      rateDay: w.ratePerDay,
      askRate: w.askRate,
      gapDay: w.gapPerDay,
      spi: w.spi,
      cpi: w.cpi,
      status,
      atRisk: status === 'inprogress' && w.spi != null && w.spi < 0.85 && w.spi >= 0.7,
      tags: [w.wellType ?? 'N/A'],
      extra: null,
      highPerformer: (w.spi != null && w.spi >= 1) || (pct >= 85 && status === 'completed'),
      rigBy: this.fmtDate(w.rigBy),
      rigTo: this.fmtDate(w.rigTo),
      rigOnDate: w.rigBy,
      flConstructionPct: w.constrPct,
      ohlPct: w.drillingPct,
      commPct: w.commProgress,
      pdoIssue: w.odcCategory === 'pdoissues',
      drilledNotCompleted: w.isDnc,
      odcCategory: w.odcCategory,
      isHookup: w.isHookup,
      isSuspended: w.isSuspended,
      isDue: w.isDue,
      isNotDue: w.isNotDue,
      isAccelerated: w.isAccelerated,
      isDnc: w.isDnc,
      isDueCompleted: w.isDueCompleted,
      p: {
        locPrep: this.mapPhase(w.locPrepStatus, null),
        construction: this.mapPhase(w.constrStatus, w.constrPct),
        commissioning: this.mapPhase(w.commStatus, w.commProgress),
        drilling: w.drillingPct > 0 ? Math.round(w.drillingPct) : null,
        procurement: null,
        mechanical: null,
        civil: null,
        completion: pct >= 100 ? true : null,
      }
    };
  }

  private deriveGridStatus(w: OdcWellStatusItem, pct: number): string {
    switch (w.status) {
      case 'COMPLETED': return 'completed';
      case 'ON HOLD':   return 'onhold';
      case 'PLANNED':   return 'planned';
      case 'ACTIVE':
        if (w.variance != null && Math.round(w.variance) < 0) return 'critical';
        if (pct < 15) return 'early';
        return 'inprogress';
      default: return 'planned';
    }
  }

  private mapPhase(statusStr: string | null, pct: number | null): any {
    if (statusStr === 'Completed') return true;
    if (statusStr === 'In Progress') return (pct != null && pct > 0) ? Math.round(pct) : 50;
    return null;
  }

  private fmtDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${dd} ${mmm} ${d.getFullYear()}`;
  }

  exportCsv(): void {
    const wells: any[] = this.filteredWells;
    if (!wells.length) { alert('No data to export.'); return; }

    const esc = (s: any): string => {
      const str = (s == null) ? '' : String(s);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? '"' + str.replaceAll('"', '""') + '"'
        : str;
    };

    const headers = [
      'Well ID','Well Name','Status','ODC Category','Field','Rig','Progress %',
      'Rig Start','Rig End'
    ];

    const rows = wells.map((w: any) => [
      esc(w.wellId), esc(w.name), esc(w.status), esc(w.odcCategory), esc(w.field), esc(w.rig),
      w.pct ?? '', esc(w.rigBy), esc(w.rigTo)
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `odc-wells-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getCategoryLabel(cat: OdcCategory): string {
    const labels: Record<OdcCategory, string> = {
      all: 'All Wells',
      drilled: 'Total Drilled',
      hookup: 'Hook-Up Completed',
      due: 'Due Wells',
      notdue: 'Non Due Wells',
      dnc: 'Drilled & Not Completed',
      early: 'Actual - Non Due Wells Accelerated',
      backlog: 'Backlog Wells',
      buffer: 'Buffer Wells',
      completed: 'Actual - Due Wells Completed',
      suspended: 'Suspended Wells',
      pdoissues: 'Not Due (PDO Issues)',
      readycomm: 'Ready for Commissioning'
    };
    return labels[cat];
  }

  getCategoryCount(cat: OdcCategory): number {
    if (cat === 'all') return this.odcCounts.totalWells;
    const map: Record<string, keyof OdcOverallStatus> = {
      drilled: 'totalWells',
      hookup: 'hookUpCompleted',
      due: 'dueWells',
      notdue: 'notDueWells',
      dnc: 'drilledNotCompleted',
      early: 'wellsAccelerated',
      backlog: 'backlogWells',
      buffer: 'bufferWells',
      completed: 'dueWellsCompleted',
      suspended: 'suspendedWells',
      pdoissues: 'pdoIssues',
      readycomm: 'readyForCommissioning'
    };
    return (this.odcCounts[map[cat]]) ?? 0;
  }

  getOdcPct(value: number): string {
    const total = this.odcCounts.totalWells;
    if (!total) return '0%';
    return Math.round((value / total) * 100) + '%';
  }
}

import { Component, OnInit, OnDestroy, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, DrilledWellsCompletion, DrilledWellListItem } from '../../services/dashboard.service';

export type DwcCategory = 'all' | 'completed' | 'inprogress' | 'suspended';

@Component({
  selector: 'app-drilledwells',
  templateUrl: './drilledwells.component.html',
  styleUrls: ['./drilledwells.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DrilledWellsComponent implements OnInit, OnDestroy {

  isLoading = true;
  activeCategory: DwcCategory = 'all';

  /** Drilled Wells Completion KPI counts */
  dwcCounts: DrilledWellsCompletion = {
    totalWells: 0, completed: 0, hold: 0,
    inProgress: 0, suspended: 0, completionRatePct: 0, monthlyTrend: []
  };

  /** Pill counts */
  pillCounts: Record<DwcCategory, number> = {
    all: 0, completed: 0, inprogress: 0, suspended: 0
  };

  private allWells: any[] = [];
  filteredWells: any[] = [];

  private dwcSub?: Subscription;
  private wellsSub?: Subscription;
  private filterSub?: Subscription;

  constructor(
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    const pendingCat = (globalThis as any).__dwcPendingCat as DwcCategory | undefined;
    if (pendingCat) {
      this.activeCategory = pendingCat;
      delete (globalThis as any).__dwcPendingCat;
    }

    this.fetchData();

    this.filterSub = this.dashSvc.filter$.pipe(skip(1)).subscribe(() => {
      this.dwcSub?.unsubscribe();
      this.wellsSub?.unsubscribe();
      this.fetchData();
    });
  }

  ngOnDestroy(): void {
    this.dwcSub?.unsubscribe();
    this.wellsSub?.unsubscribe();
    this.filterSub?.unsubscribe();
  }

  goBack(): void {
    this.router.navigate(['/cmdoverview']);
  }

  selectCategory(cat: DwcCategory): void {
    this.activeCategory = cat;
    this.applyFilter();
  }

  private fetchData(): void {
    this.isLoading = true;
    this.cdr.detectChanges();

    // Use global date filter if set; otherwise fall back to current year
    const f = this.dashSvc.currentFilter;
    const currentYear = new Date().getFullYear();
    const from = f.startDate || `${currentYear}-01-01`;
    const to   = f.endDate   || `${currentYear}-12-31`;

    // Dimension filters from the global filter bar
    const cluster  = f.cluster   || undefined;
    const wellId   = f.wellId    || undefined;
    const wellType = f.location  || undefined;
    const site     = f.site      || undefined;
    const project  = f.project   || undefined;

    // Fetch KPI strip + pill counts from completion API (same endpoint as the tile —
    // guarantees All/Completed/InProgress/Pending pill numbers are identical to the tile).
    this.dwcSub = this.dashSvc.getDrilledWellsCompletion({ cluster, wellId, wellType, site, project, from, to }).subscribe({
      next: (data) => {
        this.dwcCounts = data;
        // Pill counts come directly from the same API as the tile so they always match.
        this.pillCounts = {
          all:        data.totalWells,
          completed:  data.completed,
          inprogress: data.inProgress,
          suspended:  data.suspended
        };
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    // Fetch wells list using the DWC-specific endpoint (same logic as the KPI tiles)
    this.wellsSub = this.dashSvc.getDrilledWellsList({ cluster, wellId, wellType, from, to }).subscribe({
      next: (wells) => this.applyWellsData(wells),
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private applyWellsData(wells: DrilledWellListItem[]): void {
    this.isLoading = false;
    this.allWells = wells.map(w => this.mapToGridRow(w));
    // pillCounts are set by getDrilledWellsCompletion (same as tile) — do not override here.
    this.applyFilter();
    this.cdr.detectChanges();
  }

  private applyFilter(): void {
    if (this.activeCategory === 'all') {
      this.filteredWells = [...this.allWells];
    } else {
      this.filteredWells = this.allWells.filter(w => w.dwcCategory === this.activeCategory);
    }

    (globalThis as any).AW_WELLS = this.filteredWells;
    (globalThis as any).__awSkipTileUpdate = true;
    const fn = (globalThis as any)['renderAllWells'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[drilledwells] renderer threw', e); }
    }
  }

  private mapToGridRow(w: DrilledWellListItem): any {
    const pct = Math.round(w.progressPct);
    // dwcCategory comes directly from the backend (same logic as the tile SQL)
    const dwcCategory = w.dwcCategory as DwcCategory;

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
      rateDay: null,
      askRate: 7.0,
      gapDay: null,
      spi: w.spi,
      cpi: w.cpi,
      status: this.deriveGridStatus(w.status, pct, w.variance),
      atRisk: w.spi != null && w.spi < 0.85 && w.spi >= 0.7,
      tags: [w.wellType ?? 'N/A'],
      extra: null,
      highPerformer: (w.spi != null && w.spi >= 1) || (pct >= 85),
      rigBy: this.fmtDate(w.rigBy),
      rigTo: this.fmtDate(w.rigTo),
      rigOnDate: w.rigBy,
      flConstructionPct: w.constrPct,
      ohlPct: w.drillingPct,
      commPct: w.commProgress,
      dwcCategory,
      p: {
        locPrep: this.mapPhase(w.locPrepStatus, null),
        construction: this.mapPhase(w.constrStatus, w.constrPct),
        commissioning: this.mapPhase(w.commStatus, w.commProgress),
        drilling: w.drillingPct > 0 ? Math.round(w.drillingPct) : null,
        procurement: null, mechanical: null, civil: null,
        completion: pct >= 100 ? true : null,
      }
    };
  }

  private deriveGridStatus(status: string, pct: number, variance: number | null): string {
    switch (status) {
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
    if (statusStr === 'Completed') return true;
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

  getDwcPct(value: number): string {
    const total = this.dwcCounts.totalWells;
    if (!total) return '0%';
    return Math.round((value / total) * 100) + '%';
  }

  exportCsv(): void {
    const wells = this.filteredWells;
    if (!wells.length) { alert('No data to export.'); return; }

    const esc = (s: any): string => {
      const str = (s == null) ? '' : String(s);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? '"' + str.replaceAll('"', '""') + '"'
        : str;
    };

    const headers = ['Well ID','Well Name','Status','Category','Field','Rig','Progress %','Rig Start','Rig End'];
    const rows = wells.map((w: any) => [
      esc(w.wellId), esc(w.name), esc(w.status), esc(w.dwcCategory),
      esc(w.field), esc(w.rig), w.pct ?? '', esc(w.rigBy), esc(w.rigTo)
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drilled-wells-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

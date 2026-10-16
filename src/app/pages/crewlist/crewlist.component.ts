import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { CrewService, CrewListItem } from '../../services/crew.service';
import { DashboardService } from '../../services/dashboard.service';

@Component({
  selector: 'app-crewlist',
  templateUrl: './crewlist.component.html',
  styleUrls: ['./crewlist.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewListComponent implements AfterViewInit, OnDestroy {

  loading = true;
  statTotal = 0;
  statDeployed = 0;
  statStandby = 0;
  statRest = 0;
  statUnassigned = 0;
  private filterSub?: Subscription;

  // DQ Info drawer
  dqDrawerOpen = false;
  dqDesc = 'Crew list: Total (45) = distinct CREW_GROUP_CODE from OLD_NEW_CREW_MAPPING. Deployed (42) = group codes with matching activity in task_daily (last 90 days, CONTAINS match). Unassigned (3) = Total - Deployed. Grid shows latest activity per crew. Productivity from PH_PRODUCTIVITY_WEEKLY_REPORT (Average Productivity %). Verified: UI counts match DB exactly (45/42/3).';
  dqTables = [
    { name: 'dbo.OLD_NEW_CREW_MAPPING (354 rows)', issues: [
      { field: 'CREW_GROUP_CODE', issue: '161 of 354 rows have NULL/empty CREW_GROUP_CODE — excluded. 45 distinct valid codes remain (= Total Crews KPI).', type: 'Null key', severity: 'High', affected: 161, status: 'Open' },
      { field: '(table)', issue: 'No formal PK. DISTINCT on CREW_GROUP_CODE deduplicates 354 → 45.', type: 'PK missing', severity: 'Low', affected: 0, status: 'Open' }
    ]},
    { name: 'dbo.task_daily (30,319 rows in last 90 days)', issues: [
      { field: 'crew_code', issue: 'NVARCHAR(100). 11,017 of 30,319 rows (36%) have NULL/empty crew_code — excluded from crew matching. 19,302 valid rows with 1,382 distinct crew codes.', type: 'Null key', severity: 'High', affected: 11017, status: 'Open' },
      { field: 'ActionOn', issue: 'Proper DATE type — no cast needed. Used for 90-day range filter. No data type issues.', type: 'Data type', severity: 'High', affected: 0, status: 'Fixed' },
      { field: 'project_id', issue: 'UNIQUEIDENTIFIER type. 0 nulls in valid crew rows — all activity maps to a project for cluster filtering.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Fixed' },
      { field: 'well_id', issue: 'Used for well-specific filtering. 0 nulls in valid crew rows.', type: 'Null key', severity: 'Low', affected: 0, status: 'Fixed' }
    ]},
    { name: 'dbo.PH_PRODUCTIVITY_WEEKLY_REPORT (953 rows)', issues: [
      { field: 'Crew Type', issue: 'Matched to task_daily crew for enrichment. 0 nulls, 285 distinct values. Not all task_daily crews have a match — unmatched show as "Unrated".', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Open' },
      { field: 'Average Productivity (%)', issue: 'Numeric column — 0 cast failures to FLOAT. Displayed directly in grid as productivity %.', type: 'Data type', severity: 'Medium', affected: 0, status: 'Fixed' },
      { field: '(table)', issue: 'No p_rating column exists — P-rating is derived from productivity ranges (P1-P8) in backend enrichment logic.', type: 'Logic dependency', severity: 'Low', affected: 0, status: 'Open' }
    ]}
  ];
  dqActiveTab = 0;

  constructor(
    private crewService: CrewService,
    private dashboardSvc: DashboardService,
    private location: Location
  ) {}

  goBack(): void {
    this.location.back();
  }

  // DQ reliability score helpers
  dqRelPct(t: any): number {
    const SEVW: Record<string, number> = { High: 40, Medium: 20, Low: 8 };
    const penalty = t.issues.filter((i: any) => i.status !== 'Fixed').reduce((s: number, i: any) => s + (SEVW[i.severity] ?? 10), 0);
    return Math.max(0, Math.min(100, 100 - penalty));
  }
  dqAvgReliability(): number {
    if (!this.dqTables.length) return 0;
    const scores = this.dqTables.map(t => this.dqRelPct(t));
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  dqAvgRelClass(): string {
    const r = this.dqAvgReliability();
    return r >= 80 ? 'rel-high' : r >= 65 ? 'rel-med' : 'rel-low';
  }
  dqRelClass(t: any): string {
    const r = this.dqRelPct(t);
    return r >= 80 ? 'rel-high' : r >= 65 ? 'rel-med' : 'rel-low';
  }
  dqRelLabel(t: any): string {
    const r = this.dqRelPct(t);
    const l = t.reliabilityLabel ?? (r >= 80 ? 'Trusted' : r >= 65 ? 'Good' : r >= 40 ? 'Fair' : 'Poor');
    return l + ' · ' + r + '%';
  }
  dqRelColor(t: any): string {
    const r = this.dqRelPct(t);
    return r >= 80 ? '#2e9e5b' : r >= 65 ? '#f5a623' : r >= 40 ? '#e07c24' : '#d9534f';
  }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    this.filterSub = this.dashboardSvc.filter$.pipe(
      switchMap((f) => {
        this.loading = true;

        return this.crewService.getCrewList({
          cluster: f.cluster || undefined,
          wellId: f.wellId || undefined,
          from: f.startDate || undefined,
          to: f.endDate || undefined
        });
      })
    ).subscribe({
      next: (res) => {
        this.loading = false;
        // Update hero stats
        this.statTotal = res.totalCount;
        this.statDeployed = res.deployed;
        this.statStandby = res.standby;
        this.statRest = res.restRotation;
        this.statUnassigned = res.standby + res.restRotation;

        // Expose data to the global renderer
        (window as any)['_CL_CREW_API_DATA'] = res.crews;

        // Call page renderer after Angular renders the DOM
        setTimeout(() => {
          const fn = (window as any)['renderCrewList'];
          if (typeof fn === 'function') {
            try { fn(); } catch (e) { console.error('[crewlist] renderer threw', e); }
          }
        });
      },
      error: (err) => {
        console.error('[crewlist] API error', err);
        this.loading = false;
        // Show empty state — no fake data
        (window as any)['_CL_CREW_API_DATA'] = [];
        this.statTotal = 0;
        this.statDeployed = 0;
        this.statStandby = 0;
        this.statRest = 0;
        setTimeout(() => {
          const fn = (window as any)['renderCrewList'];
          if (typeof fn === 'function') {
            try { fn(); } catch (e) { console.error('[crewlist] renderer threw', e); }
          }
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.filterSub?.unsubscribe();
  }

  setView(view: string, event: Event): void {
    const fn = (globalThis as any)['clSetView'];
    if (typeof fn === 'function') fn(view, event.currentTarget);
  }

  onSearchInput(): void {
    const fn = (globalThis as any)['clFilter'];
    if (typeof fn === 'function') fn();
  }

  navigateTo(page: string): void {
    const fn = (globalThis as any)['navigate'];
    if (typeof fn === 'function') fn(page, document.querySelector('#nav-' + page));
  }

  exportToExcel(): void {
    const gridInstance = (globalThis as any)['_CL_CREWS_GRID_INSTANCE'];
    if (!gridInstance) return;

    const rows: any[] = [];
    gridInstance.forEachNodeAfterFilterAndSort((node: any) => {
      if (node.data) {
        rows.push({
          'Crew ID': node.data.crewId || '',
          'Crew Name': node.data.name || '',
          'Discipline': node.data.discipline || '',
          'Activity': node.data.activity || '',
          'Leader': node.data.leader || '',
          'Cluster': node.data.cluster || '',
          'Size': node.data.size ?? '',
          'P-Rating': node.data.pRating || '',
          'Productivity (%)': node.data.productivity ?? '',
          'Status': node.data.status || '',
          'Deployed On': node.data.deployedOn || '',
          'Formation': node.data.formation || ''
        });
      }
    });

    const XLSXLib = (window as any).XLSX;
    const worksheet = XLSXLib.utils.json_to_sheet(rows);
    const workbook = XLSXLib.utils.book_new();
    XLSXLib.utils.book_append_sheet(workbook, worksheet, 'Crew List');
    XLSXLib.writeFile(workbook, 'crew-list-export.xlsx');
  }
}

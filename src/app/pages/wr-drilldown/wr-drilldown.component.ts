import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, skip } from 'rxjs';
import { DashboardService, WmrWell, WmrWellsPage, FlowlineReadinessResponse, OhlReadinessResponse, BufferLocationProgressResponse, ActivityDrilldownPage, ActivityDrilldownRow, WellStatusItem } from '../../services/dashboard.service';
import { WellDetailService } from '../../services/well-detail.service';

declare var agGrid: any;

@Component({
  selector: 'app-wells-readiness-details',
  templateUrl: './wr-drilldown.component.html',
  styleUrls: ['./wr-drilldown.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class WrDrilldownComponent implements OnInit, AfterViewInit, OnDestroy {

  scope: string = 'overall';
  filter: string = 'plan';
  isLoading = true;
  errorMsg = '';

  // Pagination
  totalCount = 0;
  currentPage = 1;
  pageSize = 20;
  totalPages = 0;

  // Status filter pills
  activeStatusFilter: string = 'all';
  statusCounts: Record<string, number> = { all: 0, inprogress: 0, completed: 0, planned: 0 };
  committedCount: number = 0;
  scheduledTotalCount: number = 0;
  executedTotalCount: number = 0;
  executedCompletedCount: number = 0;
  executedInprogressCount: number = 0;
  executedNewCount: number = 0;
  plannedTotalCount: number = 0;
  plannedCompletedCount: number = 0;
  plannedInprogressCount: number = 0;
  plannedNewCount: number = 0;
  private originalFilter: string = '';
  private allItems: WmrWell[] = [];
  private filterSub?: Subscription;

  // Data integrity check
  expectedCount: number | null = null;
  integrityStatus: 'ok' | 'mismatch' | 'checking' | null = null;

  // DQ Info drawer
  dqDrawerOpen = false;
  dqActiveTab = 0;
  dqDesc = 'Wells Readiness drilldown grid. Data from SAP_DRILLING_SEQUENCE_History (plan) + WMR snapshot (latest per well via TRY_CAST(Week_Number AS DATE)). SAP: 20,500 rows → 2,318 null Well_ID excluded. WMR: 50,841 rows → 27,318 excluded by single TRY_CAST on Week_Number (53%). Verified: funnel KPIs match UI with date filter.';
  dqTables = [
    { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
      { field: 'Well_ID', issue: '2,318 rows with NULL/empty excluded — invisible to plan count.', type: 'Null key', severity: 'High', affected: 2318, status: 'Open' },
      { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures detected.', type: 'Data type', severity: 'High', affected: 0, status: 'Fixed' },
      { field: 'Well_Function', issue: 'Case-sensitive NOT IN filter. 0 casing inconsistencies.', type: 'Standardisation', severity: 'Low', affected: 0, status: 'Fixed' },
      { field: '(table)', issue: 'No PK. GROUP BY Well_ID deduplicates.', type: 'PK missing', severity: 'Low', affected: 0, status: 'Open' }
    ]},
    { name: 'dbo.WMR', issues: [
      { field: 'pdo_well_id', issue: '0 null/empty — all 50,841 rows valid.', type: 'Null key', severity: 'High', affected: 0, status: 'Fixed' },
      { field: 'Week_Number', issue: 'NVARCHAR — single TRY_CAST for ROW_NUMBER. 27,318 rows (53%) excluded from snapshot.', type: 'Data type', severity: 'High', affected: 27318, status: 'In progress' },
      { field: 'over_all_progress_percentages', issue: 'NVARCHAR — COALESCE(TRY_CAST AS FLOAT, 0). 0 cast failures.', type: 'Data type', severity: 'High', affected: 0, status: 'Fixed' },
      { field: 'flaf_issue_date', issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures.', type: 'Data type', severity: 'High', affected: 0, status: 'Fixed' },
      { field: '(table)', issue: 'No PK. ROW_NUMBER() deduplication.', type: 'PK missing', severity: 'Low', affected: 0, status: 'Open' }
    ]},
    { name: 'dbo.ProjectIDs', issues: [
      { field: 'ID', issue: 'All 19 resolve correctly. 0 mismatches.', type: 'Data type', severity: 'High', affected: 0, status: 'Fixed' },
      { field: 'column2', issue: 'Only MARMUL, NIMR. 0 misclassifications.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' }
    ]}
  ];
  dqRelPct(t: any): number {
    const SEVW: Record<string, number> = { High: 40, Medium: 20, Low: 8 };
    const penalty = t.issues.filter((i: any) => i.status !== 'Fixed').reduce((s: number, i: any) => s + (SEVW[i.severity] ?? 10), 0);
    return Math.max(0, Math.min(100, 100 - penalty));
  }
  dqRelClass(t: any): string { const r = this.dqRelPct(t); return r >= 80 ? 'rel-high' : r >= 65 ? 'rel-med' : 'rel-low'; }
  dqRelLabel(t: any): string { const r = this.dqRelPct(t); const l = t.reliabilityLabel ?? (r >= 80 ? 'Trusted' : r >= 65 ? 'Good' : r >= 40 ? 'Fair' : 'Poor'); return l + ' · ' + r + '%'; }
  dqRelColor(t: any): string { const r = this.dqRelPct(t); return r >= 80 ? '#2e9e5b' : r >= 65 ? '#f5a623' : r >= 40 ? '#e07c24' : '#d9534f'; }
  dqStatusClass(status: string): string { return status === 'Fixed' ? 'dq-st-fixed' : status === 'In progress' ? 'dq-st-prog' : 'dq-st-open'; }

  private sub?: Subscription;
  private integritySub?: Subscription;
  private gridApi: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef,
    private readonly wellDetailSvc: WellDetailService
  ) {}

  get pageTitle(): string {
    if (this.scope === 'wla') {
      const p = this.route.snapshot.queryParams;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let label = 'Workload Analysis — Wells';
      if (p['from']) {
        const d = new Date(p['from'] + 'T00:00:00');
        if (!isNaN(d.getTime())) {
          label += ' — ' + months[d.getMonth()] + "'" + String(d.getFullYear()).slice(2);
        }
      }
      const chips: string[] = [];
      if (p['cluster']) chips.push(p['cluster'].toUpperCase());
      if (p['project']) chips.push(p['project']);
      if (p['wellType']) chips.push(p['wellType']);
      if (chips.length) label += ' (' + chips.join(' · ') + ')';
      return label;
    }
    const scopeLabels: Record<string, string> = {
      overall: 'Wells Readiness — Overall Scope',
      flowline: 'Wells Readiness — Flowline Scope',
      ohl: 'Wells Readiness — OHL Scope',
      buffer: 'Wells Readiness — Buffer Location Scope',
      wpa: 'Wells — Planned vs. Actual',
      activities: 'Activities — Drilldown'
    };
    return scopeLabels[this.scope] || 'Wells Readiness Overview';
  }

  get filterLabel(): string {
    const filterLabels: Record<string, string> = {
      plan: 'Original Plan (Rig Sequence)',
      flafscr: 'After FLAF / SCR Delays Removed',
      clean: 'Clean Target (After PDO Issues Removed)',
      completed: 'Actual Completed Wells',
      planned: 'Planned Wells',
      executed_as_plan: 'Executed Wells as per Plan',
      executed_not_as_plan: 'Executed Wells Not as per Plan',
      non_executed: 'Non Executed Wells as per Plan',
      documents: 'Document Compliance',
      total_planned: 'Total Planned Activities',
      in_progress: 'In-Progress Activities',
      new_planned: 'New Planned Activities',
      executed: 'Executed Activities',
      executed_completed: 'Executed Activities',
      executed_inprogress: 'Executed Activities',
      executed_new: 'Executed Activities',
      total_planned_completed: 'Total Planned Activities',
      total_planned_inprogress: 'Total Planned Activities',
      total_planned_new: 'Total Planned Activities',
      unplanned: 'Unplanned Activities',
      scheduled: 'Scheduled Activities',
      committed: 'Committed Activities',
      wla_completed: 'Completed Wells'
    };
    return filterLabels[this.filter] || 'All Wells';
  }

  get isExecutedFilter(): boolean {
    return this.filter === 'executed' || this.filter.startsWith('executed_');
  }

  get isPlannedFilter(): boolean {
    return this.filter === 'total_planned' || this.filter.startsWith('total_planned_');
  }

  get filterBadgeClass(): string {
    switch (this.filter) {
      case 'plan': return 'badge--blue';
      case 'flafscr': return 'badge--orange';
      case 'clean': return 'badge--amber';
      case 'completed': return 'badge--green';
      case 'planned': return 'badge--blue';
      case 'wla_completed': return 'badge--green';
      case 'executed_as_plan': return 'badge--green';
      case 'executed_not_as_plan': return 'badge--orange';
      case 'non_executed': return 'badge--red';
      case 'documents': return 'badge--purple';
      case 'total_planned': case 'total_planned_completed': case 'total_planned_inprogress': case 'total_planned_new': return 'badge--blue';
      case 'in_progress': return 'badge--blue';
      case 'new_planned': return 'badge--blue';
      case 'executed': case 'executed_completed': case 'executed_inprogress': case 'executed_new': return 'badge--green';
      case 'unplanned': return 'badge--orange';
      case 'scheduled': return 'badge--blue';
      case 'committed': return 'badge--green';
      default: return 'badge--blue';
    }
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    this.scope = params['scope'] || 'overall';
    this.filter = params['filter'] || 'plan';
  }

  ngAfterViewInit(): void {
    this.loadWells();
    this.filterSub = this.dashSvc.filter$.pipe(skip(1)).subscribe(() => {
      this.currentPage = 1;
      this.loadWells();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.filterSub?.unsubscribe();
    this.integritySub?.unsubscribe();
    if (this.gridApi) {
      try { this.gridApi.destroy(); } catch (e) { console.warn('Grid cleanup', e); }
      this.gridApi = null;
    }
  }

  goBack(): void {
    this.router.navigate(['/cmdoverview']);
  }

  onPageChange(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadWells();
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.loadWells();
  }

  loadWells(): void {
    this.isLoading = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    this.sub?.unsubscribe();

    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);
    const globalFilter = this.dashSvc.currentFilter;

    // Use global filter dates if available, otherwise fall back to defaults.
    // All scopes default to full year range to match funnel KPI endpoints.
    const fromDate = globalFilter.startDate || `${currentYear}-01-01`;
    const toDate = globalFilter.endDate || `${currentYear}-12-31`;

    const filters: any = {
      from: fromDate,
      to: toDate,
      page: this.currentPage,
      pageSize: this.pageSize,
      cluster: globalFilter.cluster || undefined,
      project: globalFilter.project || undefined,
      wellType: globalFilter.location || undefined,
    };

    // For WPA and Activities scopes, also pass site from global filter
    if (this.scope === 'wpa' || this.scope === 'activities') {
      if (globalFilter.site) filters.site = globalFilter.site;
    }

    // Build wrFilter based on scope and filter
    if (this.scope === 'activities') {
      // Activity drilldown: use the dedicated cmd-readiness-kpi-activities API
      filters.category = this.filter;
      this.sub = this.dashSvc.getCmdReadinessKpiActivities(filters).subscribe({
        next: (response: ActivityDrilldownPage) => {
          // Map activity rows to WmrWell shape for grid reuse
          this.allItems = response.activities.map((a: ActivityDrilldownRow) => ({
            wellId: a.wellId,
            location: a.activityCode,
            status: a.status,
            field: '',
            rig: '',
            wellType: '',
            progressPct: 0,
            plannedPct: 0,
            locPrepPct: 0,
            flConstructionPct: 0,
            ohlPct: 0,
            commPct: 0,
            rigOnDate: a.targetStart,
            rigOffDate: a.targetEnd,
            // Stash activity fields for grid
            activityCode: a.activityCode,
            activityName: a.activityName,
            actualStart: a.actualStart,
            actualEnd: a.actualEnd,
            targetStart: a.targetStart,
            targetEnd: a.targetEnd,
            quantity: a.quantity,
            progress: a.progress,
            duration: a.duration,
            crewType: a.crewType,
            cluster: a.cluster,
            project: a.project,
            committedStart: a.committedStart,
            committedEnd: a.committedEnd,
          } as any));
          this.totalCount = response.totalCount;
          this.totalPages = Math.ceil(response.totalCount / this.pageSize);
          this.computeStatusCounts(this.allItems);
          // Fetch committed count for the pill (only when showing scheduled, not when already on committed)
          if (this.filter === 'scheduled' || this.originalFilter === 'scheduled') {
            if (this.filter === 'scheduled') this.scheduledTotalCount = response.totalCount;
            const committedFilters = { ...filters, category: 'committed', page: 1, pageSize: 1 };
            this.dashSvc.getCmdReadinessKpiActivities(committedFilters).subscribe({
              next: (cr: ActivityDrilldownPage) => { this.committedCount = cr.totalCount; this.cdr.detectChanges(); }
            });
          }
          // Fetch executed sub-counts for the filter pills
          if (this.filter === 'executed' || this.originalFilter === 'executed') {
            const base = { ...filters, page: 1, pageSize: 1 };
            if (this.filter === 'executed') {
              this.executedTotalCount = response.totalCount;
            } else {
              // Re-fetch total executed count with current filters
              this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'executed' }).subscribe({
                next: (r: ActivityDrilldownPage) => { this.executedTotalCount = r.totalCount; this.cdr.detectChanges(); }
              });
            }
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'executed_completed' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.executedCompletedCount = r.totalCount; this.cdr.detectChanges(); }
            });
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'executed_inprogress' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.executedInprogressCount = r.totalCount; this.cdr.detectChanges(); }
            });
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'executed_new' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.executedNewCount = r.totalCount; this.cdr.detectChanges(); }
            });
          }
          // Fetch total_planned sub-counts for the filter pills
          if (this.filter === 'total_planned' || this.originalFilter === 'total_planned') {
            const base = { ...filters, page: 1, pageSize: 1 };
            if (this.filter === 'total_planned') {
              this.plannedTotalCount = response.totalCount;
            } else {
              this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'total_planned' }).subscribe({
                next: (r: ActivityDrilldownPage) => { this.plannedTotalCount = r.totalCount; this.cdr.detectChanges(); }
              });
            }
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'total_planned_completed' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.plannedCompletedCount = r.totalCount; this.cdr.detectChanges(); }
            });
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'total_planned_inprogress' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.plannedInprogressCount = r.totalCount; this.cdr.detectChanges(); }
            });
            this.dashSvc.getCmdReadinessKpiActivities({ ...base, category: 'total_planned_new' }).subscribe({
              next: (r: ActivityDrilldownPage) => { this.plannedNewCount = r.totalCount; this.cdr.detectChanges(); }
            });
          }
          this.isLoading = false;
          this.cdr.detectChanges();
          this.renderGrid(this.getFilteredItems());
        },
        error: () => {
          this.errorMsg = 'Unable to load activities data. Please try again.';
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
      return;
    } else if (this.scope === 'wla') {
      // WLA drilldown: use wells-status-list with wlaMode=true
      // Date range comes from query params (specific month clicked).
      // Cluster/project/wellType use global filter (header filter bar) so user can change them.
      const params = this.route.snapshot.queryParams;
      const wlaFilters: any = {
        wlaMode: true,
        from: params['from'] || filters.from,
        to: params['to'] || filters.to,
        cluster: filters.cluster || undefined,
        project: filters.project || undefined,
        wellType: filters.wellType || undefined,
      };
      this.sub = this.dashSvc.getWellStatusList(wlaFilters).subscribe({
        next: (items: WellStatusItem[]) => {
          // Map WellStatusItem to WmrWell shape for grid reuse
          this.allItems = items.map((w: WellStatusItem) => ({
            wellId: w.wellId,
            location: w.wellName,
            status: w.status?.toLowerCase() || 'planned',
            field: w.field || '',
            rig: w.rig || '',
            wellType: w.wellType || '',
            progressPct: w.progressPct || 0,
            plannedPct: w.plannedPct || 0,
            locPrepPct: 0,
            flConstructionPct: w.constrPct ? w.constrPct * 100 : 0,
            ohlPct: w.drillingPct || 0,
            commPct: w.complePct ? w.complePct * 100 : 0,
            rigOnDate: w.rigBy,
            rigOffDate: w.rigTo,
            ratePerDay: w.ratePerDay,
            askRate: w.askRate,
            spi: w.spi,
          } as any));
          // Client-side pagination
          this.totalCount = items.length;
          this.totalPages = Math.ceil(items.length / this.pageSize);
          this.computeStatusCounts(this.allItems);
          this.isLoading = false;
          this.cdr.detectChanges();
          const start = (this.currentPage - 1) * this.pageSize;
          this.renderGrid(this.getFilteredItems().slice(start, start + this.pageSize));
        },
        error: () => {
          this.errorMsg = 'Unable to load workload analysis wells. Please try again.';
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
      return;
    } else if (this.scope === 'wpa') {
      // WPA drilldown: use the dedicated cmd-readiness-kpi-wells API
      filters.category = this.filter;
      delete filters.wrFilter;
      this.sub = this.dashSvc.getCmdReadinessKpiWells(filters).subscribe({
        next: (response: WmrWellsPage) => {
          this.allItems = response.items;
          this.totalCount = response.totalCount;
          this.totalPages = Math.ceil(response.totalCount / this.pageSize);
          this.computeStatusCounts(response.items);
          this.isLoading = false;
          this.cdr.detectChanges();
          this.renderGrid(this.getFilteredItems());
        },
        error: () => {
          this.errorMsg = 'Unable to load wells data. Please try again.';
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
      return;
    } else if (this.scope !== 'overall') {
      // Scope-specific: always use wrFilter with scope prefix (e.g., flowline_completed)
      filters.wrFilter = `${this.scope}_${this.filter}`;
    } else {
      // Overall scope: use existing filter → wrFilter/status mapping
      if (this.filter === 'flafscr' || this.filter === 'clean') {
        filters.wrFilter = this.filter;
      }
      if (this.filter === 'completed') {
        filters.status = 'completed';
      }
      if (this.filter === 'plan') {
        filters.wrFilter = 'plan';
      }
    }

    this.sub = this.dashSvc.getWellsReadinessOverview(filters).subscribe({
      next: (response: WmrWellsPage) => {
        this.allItems = response.items;
        this.totalCount = response.totalCount;
        this.totalPages = Math.ceil(response.totalCount / this.pageSize);
        this.computeStatusCounts(response.items);
        this.isLoading = false;
        this.cdr.detectChanges();
        this.renderGrid(this.getFilteredItems());
        // Verify data integrity on first page load
        if (this.currentPage === 1) {
          this.verifyDataIntegrity();
        }
      },
      error: () => {
        this.errorMsg = 'Unable to load wells data. Please try again.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  /** Compare drilldown totalCount against the KPI funnel expected count for data integrity. */
  private verifyDataIntegrity(): void {
    this.integritySub?.unsubscribe();
    this.integrityStatus = 'checking';

    const currentYear = new Date().getFullYear();
    const globalFilter = this.dashSvc.currentFilter;

    if (this.scope === 'flowline') {
      this.integritySub = this.dashSvc.getFlowlineReadiness({ year: currentYear, cluster: globalFilter.cluster, project: globalFilter.project }).subscribe({
        next: (res: FlowlineReadinessResponse) => {
          this.expectedCount = this.getExpectedCountFromFunnel(res.originalPlan, res.afterFlafScr, res.afterPdoIssues, res.actualCompleted);
          this.integrityStatus = this.totalCount === this.expectedCount ? 'ok' : 'mismatch';
          this.cdr.detectChanges();
        },
        error: () => { this.integrityStatus = null; this.cdr.detectChanges(); }
      });
    } else if (this.scope === 'ohl') {
      this.integritySub = this.dashSvc.getOhlReadiness({ year: currentYear, cluster: globalFilter.cluster, project: globalFilter.project }).subscribe({
        next: (res: OhlReadinessResponse) => {
          this.expectedCount = this.getExpectedCountFromFunnel(res.originalPlan, res.afterFlafScr, res.afterPdoIssues, res.actualCompleted);
          this.integrityStatus = this.totalCount === this.expectedCount ? 'ok' : 'mismatch';
          this.cdr.detectChanges();
        },
        error: () => { this.integrityStatus = null; this.cdr.detectChanges(); }
      });
    } else if (this.scope === 'buffer') {
      this.integritySub = this.dashSvc.getBufferLocationProgress({ year: currentYear, cluster: globalFilter.cluster, project: globalFilter.project }).subscribe({
        next: (res: BufferLocationProgressResponse) => {
          const k = res.kpi;
          this.expectedCount = this.getExpectedCountFromBufferFunnel(k.rigSequencePlan, k.afterPeggingScr, k.cleanTarget, k.actualCompleted);
          this.integrityStatus = this.totalCount === this.expectedCount ? 'ok' : 'mismatch';
          this.cdr.detectChanges();
        },
        error: () => { this.integrityStatus = null; this.cdr.detectChanges(); }
      });
    } else {
      // Overall / WPA scope — no cross-check needed
      this.integrityStatus = null;
    }
  }

  /** Get the expected count based on the filter for flowline/OHL funnels. */
  private getExpectedCountFromFunnel(plan: number, afterFlafScr: number, afterPdo: number, completed: number): number {
    switch (this.filter) {
      case 'plan':      return plan;
      case 'flafscr':   return afterFlafScr;
      case 'clean':     return afterPdo;
      case 'completed': return completed;
      default:          return plan;
    }
  }

  /** Get the expected count based on the filter for buffer funnel. */
  private getExpectedCountFromBufferFunnel(plan: number, afterPegging: number, cleanTarget: number, completed: number): number {
    switch (this.filter) {
      case 'plan':      return plan;
      case 'flafscr':   return afterPegging;
      case 'clean':     return cleanTarget;
      case 'completed': return completed;
      default:          return plan;
    }
  }

  private computeStatusCounts(items: WmrWell[]): void {
    this.statusCounts = { all: items.length, inprogress: 0, completed: 0, planned: 0 };
    this.committedCount = 0;
    for (const item of items) {
      const s = (item.status || '').toLowerCase();
      if (s in this.statusCounts) this.statusCounts[s]++;
      if ((item as any).committedStart) this.committedCount++;
    }
  }

  private getFilteredItems(): WmrWell[] {
    if (this.activeStatusFilter === 'all') return this.allItems;
    if (this.activeStatusFilter === 'committed') return this.allItems.filter(i => !!(i as any).committedStart);
    if (this.activeStatusFilter.startsWith('executed_')) return this.allItems;
    if (this.activeStatusFilter.startsWith('total_planned_')) return this.allItems;
    return this.allItems.filter(i => (i.status || '').toLowerCase() === this.activeStatusFilter);
  }

  onStatusFilter(status: string): void {
    // Executed sub-filter (Completed, In-Progress, New)
    if (this.scope === 'activities' && (status.startsWith('executed_') || (status === 'all' && this.isExecutedFilter))) {
      if (!this.originalFilter) this.originalFilter = this.filter;
      this.filter = status === 'all' ? (this.originalFilter || 'executed') : status;
      this.activeStatusFilter = status;
      this.currentPage = 1;
      this.loadWells();
      return;
    }
    // Total Planned sub-filter (Completed, In-Progress, New)
    if (this.scope === 'activities' && (status.startsWith('total_planned_') || (status === 'all' && this.isPlannedFilter))) {
      if (!this.originalFilter) this.originalFilter = this.filter;
      this.filter = status === 'all' ? (this.originalFilter || 'total_planned') : status;
      this.activeStatusFilter = status;
      this.currentPage = 1;
      this.loadWells();
      return;
    }
    // Committed sub-filter (for scheduled view)
    if (this.scope === 'activities' && (status === 'committed' || (status === 'all' && (this.filter === 'committed' || this.originalFilter === 'scheduled')))) {
      if (!this.originalFilter) this.originalFilter = this.filter;
      this.filter = status === 'committed' ? 'committed' : this.originalFilter;
      this.activeStatusFilter = status;
      this.currentPage = 1;
      this.loadWells();
      return;
    }
    this.activeStatusFilter = status;
    this.cdr.detectChanges();
    this.renderGrid(this.getFilteredItems());
  }

  exportCsv(): void {
    if (this.gridApi) {
      this.gridApi.exportDataAsCsv({ fileName: 'wells-readiness-export.csv' });
    }
  }

  private renderGrid(data: WmrWell[]): void {
    const gridDiv = document.getElementById('wrdGrid');
    if (!gridDiv || !agGrid) return;

    const isDark = !document.documentElement.classList.contains('navbar-light');
    gridDiv.className = (isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' wrd-grid';

    const statusColors: Record<string, { color: string; darkColor: string; label: string }> = {
      completed:  { color: '#00B050', darkColor: '#00B050', label: 'COMPLETED' },
      inprogress: { color: '#00B050', darkColor: '#00B050', label: 'IN PROGRESS' },
      critical:   { color: '#FF0000', darkColor: '#FF0000', label: 'CRITICAL' },
      atrisk:     { color: '#ED7D31', darkColor: '#FBBF24', label: 'AT RISK' },
      onhold:     { color: '#FF0000', darkColor: '#FF0000', label: 'ON HOLD' },
      early:      { color: '#29378d', darkColor: '#29378d', label: 'EARLY STAGE' },
      planned:    { color: '#7F7F7F', darkColor: '#A5A5A5', label: 'PLANNED' },
    };

    const statusCellRenderer = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const dk = !document.documentElement.classList.contains('navbar-light');
      const s = statusColors[params.value.toLowerCase()] || statusColors['planned'];
      const col = dk ? s.darkColor : s.color;
      return '<span style="display:inline-flex;align-items:center;gap:6px;color:' + col + ';font-weight:700;font-size:9pt;letter-spacing:0.4px;font-family:var(--font-family-mono);text-transform:uppercase">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>' + s.label +
      '</span>';
    };

    const pctColor = (v: number): string => {
      if (v >= 90) return '#00B050';
      if (v >= 60) return '#00B0F0';
      if (v >= 30) return '#FFC000';
      return '#FF0000';
    };

    const progressCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = Math.round(params.value);
      const col = pctColor(v);
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + col + '">' + v + '%</span>';
    };

    const dateFormatter = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const d = new Date(params.value);
      if (Number.isNaN(d.getTime())) return '<span style="color:var(--txt-dim)">—</span>';
      const dd = String(d.getDate()).padStart(2, '0');
      const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-2)">' + dd + ' ' + mmm + ' ' + d.getFullYear() + '</span>';
    };

    const wellIdCell = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      return '<a href="javascript:void(0)" style="color:var(--primary, #29378d);font-weight:600;text-decoration:underline;cursor:pointer;font-size:9pt;font-family:var(--font-family-mono)">' + params.value + '</a>';
    };

    const bufferStatusCell = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const v = params.value;
      let color = 'var(--txt-2)';
      let bg = 'transparent';
      if (v === 'Drilled') { color = '#00B050'; bg = 'rgba(0,176,80,0.08)'; }
      else if (v === 'ROL') { color = '#ED7D31'; bg = 'rgba(237,125,49,0.08)'; }
      else if (v.startsWith('Buffer')) { color = '#29378d'; bg = 'rgba(41,55,141,0.08)'; }
      return '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;background:' + bg + ';font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + color + '">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>' + v + '</span>';
    };

    const varianceCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = Math.round(params.value);
      const col = v > 0 ? '#00B050' : v < 0 ? '#FF0000' : 'var(--txt-2)';
      const prefix = v > 0 ? '+' : '';
      const dot = v !== 0 ? (' <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + col + ';margin-left:3px;vertical-align:middle"></span>') : '';
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + col + '">' + prefix + v + '%' + dot + '</span>';
    };

    const rateCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = +params.value;
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-1)">' + v.toFixed(1) + '%</span>';
    };

    const gapDayCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = +params.value;
      const color = v > 0 ? '#00B050' : v < 0 ? '#FF0000' : 'var(--txt-muted)';
      const sign = v > 0 ? '+' : '';
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:600;color:' + color + '">' + sign + v.toFixed(1) + '%</span>';
    };

    const indexCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = +params.value;
      const color = v >= 1.0 ? '#00B050' : v >= 0.85 ? '#FFC000' : '#FF0000';
      return '<span style="display:inline-flex;align-items:center;gap:6px">' +
        '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + color + '">' + v.toFixed(2) + '</span>' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + color + ';display:inline-block"></span>' +
      '</span>';
    };

    const pageOffset = (this.currentPage - 1) * this.pageSize;

    const docCheckCell = (params: any) => {
      if (!params.value || params.value === '') return '<span style="color:#FF0000;font-weight:700;font-size:9pt">✗ Missing</span>';
      return '<span style="color:#00B050;font-weight:700;font-size:9pt">✓ Submitted</span>';
    };

    const docValueCell = (params: any) => {
      if (!params.value || params.value === '') return '<span style="color:var(--txt-dim)">—</span>';
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-1)">' + params.value + '</span>';
    };

    const submittedCountCell = (params: any) => {
      const v = params.value ?? 0;
      const col = v === 4 ? '#00B050' : v >= 2 ? '#FFC000' : '#FF0000';
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + col + '">' + v + ' / 4</span>';
    };

    const categoryCell = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const catColors: Record<string, string> = {
        'Executed as Plan': '#00B050',
        'Non Executed': '#FF0000',
        'Executed Not as Plan': '#ED7D31',
        'Planned': '#29378d'
      };
      const c = catColors[params.value] || 'var(--txt-2)';
      return '<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--font-family-mono);font-size:9pt;font-weight:600;color:' + c + '">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>' + params.value + '</span>';
    };

    const isDocuments = this.filter === 'documents';
    const isActivities = this.scope === 'activities';

    const activityColumns = [
      { headerName: '#', valueGetter: (params: any) => pageOffset + params.node.rowIndex + 1, width: 50, sortable: false, filter: false, pinned: 'left',
        cellStyle: { color: 'var(--txt-muted)', fontSize: '9pt' } },
      { headerName: 'Activity Code', field: 'activityCode', width: 180, sortable: true, filter: true, pinned: 'left',
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', fontWeight: '700', color: 'var(--primary, #29378d)' } },
      { headerName: 'Activity Name', field: 'activityName', width: 220, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: 'var(--txt-1)' } },
      { headerName: 'Well ID', field: 'wellId', width: 100, sortable: true, filter: true, cellRenderer: wellIdCell },
      { headerName: 'Status', field: 'status', width: 130, sortable: true, filter: true, cellRenderer: statusCellRenderer },
      { headerName: 'Progress', field: 'progress', width: 110, sortable: true, filter: 'agNumberColumnFilter',
        cellRenderer: (params: any) => {
          const v = params.value != null ? Math.round(params.value * 100) : 0;
          const color = v >= 100 ? '#27AE60' : v > 0 ? '#F39C12' : 'var(--txt-muted)';
          return `<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:600;color:${color}">${v}%</span>`;
        }
      },
      { headerName: 'Duration', field: 'duration', width: 100, sortable: true, filter: 'agNumberColumnFilter',
        cellRenderer: (params: any) => {
          const v = params.value != null ? params.value : 0;
          return `<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-1)">${v}d</span>`;
        }
      },
      { headerName: 'Target Start', field: 'targetStart', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Target End', field: 'targetEnd', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Actual Start', field: 'actualStart', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Actual End', field: 'actualEnd', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Committed Start', field: 'committedStart', width: 140, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Committed End', field: 'committedEnd', width: 140, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Quantity', field: 'quantity', width: 100, sortable: true, filter: 'agNumberColumnFilter',
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', fontWeight: '600', color: 'var(--txt-1)' } },
      { headerName: 'Crew Type', field: 'crewType', width: 120, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Cluster', field: 'cluster', width: 110, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Project', field: 'project', width: 120, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: 'var(--txt-2)' } },
    ];

    const columnDefs = isActivities ? activityColumns : isDocuments ? [
      { headerName: '#', valueGetter: (params: any) => pageOffset + params.node.rowIndex + 1, width: 50, sortable: false, filter: false, pinned: 'left',
        cellStyle: { color: 'var(--txt-muted)', fontSize: '9pt' } },
      { headerName: 'Well ID', field: 'wellId', width: 110, sortable: true, filter: true, pinned: 'left', cellRenderer: wellIdCell },
      { headerName: 'Well Name', field: 'location', width: 200, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', fontWeight: '600', color: 'var(--txt-1)' } },
      { headerName: 'Category', field: 'wellCategory', width: 180, sortable: true, filter: true, cellRenderer: categoryCell },
      { headerName: 'Field', field: 'field', width: 100, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family)', fontSize: '9pt' } },
      { headerName: 'Well Type', field: 'wellType', width: 120, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Submitted', field: 'submittedCount', width: 110, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: submittedCountCell },
      { headerName: 'Location PO', field: 'locationPoNo', width: 140, sortable: true, filter: true, cellRenderer: docCheckCell },
      { headerName: 'Location PO Value', field: 'locationPoNo', colId: 'locationPoNoVal', width: 160, sortable: true, filter: true, cellRenderer: docValueCell },
      { headerName: 'Pegging Date', field: 'actualPeggedDate', width: 140, sortable: true, filter: true, cellRenderer: docCheckCell },
      { headerName: 'Pegging Date Value', field: 'actualPeggedDate', colId: 'actualPeggedDateVal', width: 160, sortable: true, filter: true, cellRenderer: docValueCell },
      { headerName: 'FLAF Issue Date', field: 'flafIssueDate', width: 150, sortable: true, filter: true, cellRenderer: docCheckCell },
      { headerName: 'FLAF Issue Value', field: 'flafIssueDate', colId: 'flafIssueDateVal', width: 160, sortable: true, filter: true, cellRenderer: docValueCell },
      { headerName: 'Flowline PO', field: 'flowLinePoNo', width: 140, sortable: true, filter: true, cellRenderer: docCheckCell },
      { headerName: 'Flowline PO Value', field: 'flowLinePoNo', colId: 'flowLinePoNoVal', width: 160, sortable: true, filter: true, cellRenderer: docValueCell },
    ] : [
      { headerName: '#', valueGetter: (params: any) => pageOffset + params.node.rowIndex + 1, width: 50, sortable: false, filter: false, pinned: 'left',
        cellStyle: { color: 'var(--txt-muted)', fontSize: '9pt' } },
      { headerName: 'Well ID', field: 'wellId', width: 110, sortable: true, filter: true, pinned: 'left', cellRenderer: wellIdCell },
      { headerName: 'Well Name', field: 'location', width: 200, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', fontWeight: '600', color: 'var(--txt-1)' } },
      { headerName: 'Status', field: 'status', width: 150, sortable: true, filter: true, cellRenderer: statusCellRenderer },
      ...(this.scope === 'buffer' ? [
        { headerName: 'Buffer Status', field: 'drillingBufferStatus', width: 140, sortable: true, filter: true, cellRenderer: bufferStatusCell }
      ] : []),
      { headerName: 'Field', field: 'field', width: 100, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family)', fontSize: '9pt' } },
      { headerName: 'Rig', field: 'rig', width: 110, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Progress', field: 'progressPct', width: 130, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Planned', field: 'plannedPct', width: 110, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Variance', colId: 'variance', width: 120, sortable: true, filter: 'agNumberColumnFilter',
        valueGetter: (params: any) => {
          const actual = params.data?.progressPct;
          const planned = params.data?.plannedPct;
          if (actual == null || planned == null) return null;
          return Math.round(actual - planned);
        },
        cellRenderer: varianceCell },
      { headerName: 'Rate/Day', field: 'ratePerDay', width: 110, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: rateCell,
        comparator: (a: any, b: any) => (a || 0) - (b || 0) },
      { headerName: 'Ask Rate', field: 'askRate', width: 110, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: rateCell,
        comparator: (a: any, b: any) => (a || 0) - (b || 0) },
      { headerName: 'GAP/DAY', colId: 'gapDay', width: 110, sortable: true, filter: 'agNumberColumnFilter',
        valueGetter: (params: any) => {
          const rate = params.data?.ratePerDay;
          const ask = params.data?.askRate;
          if (rate == null || ask == null) return null;
          return +(rate - ask).toFixed(1);
        },
        cellRenderer: gapDayCell, comparator: (a: any, b: any) => (a || 0) - (b || 0) },
      { headerName: 'SPI', field: 'spi', width: 100, sortable: true, filter: 'agNumberColumnFilter',
        headerTooltip: 'Schedule Performance Index = Actual / Planned', cellRenderer: indexCell,
        comparator: (a: any, b: any) => (a || 0) - (b || 0) },
      { headerName: 'Well Type', field: 'wellType', width: 140, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Loc. Prep %', field: 'locPrepPct', width: 120, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'FL Construc. %', field: 'flConstructionPct', width: 140, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'OHL %', field: 'ohlPct', width: 100, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Commission. %', field: 'commPct', width: 140, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Rig On Date', field: 'rigOnDate', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Rig Off Date', field: 'rigOffDate', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
    ];

    const self = this;
    const gridOptions: any = {
      columnDefs,
      rowData: data,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      animateRows: true,
      domLayout: 'normal',
      headerHeight: 44,
      rowHeight: 50,
      suppressPaginationPanel: true,
      suppressCellFocus: false,
      enableCellTextSelection: true,
      suppressMovableColumns: false,
      onCellClicked: (event: any) => {
        if (event.column?.getColId() === 'wellId' && event.data?.wellId) {
          self.wellDetailSvc.open(String(event.data.wellId));
        }
      },
    };

    if (this.gridApi) {
      try { this.gridApi.destroy(); } catch (e) { console.warn('Grid cleanup', e); }
      this.gridApi = null;
    }
    gridDiv.innerHTML = '';
    this.gridApi = agGrid.createGrid(gridDiv, gridOptions);
  }
}


import { Component, AfterViewInit, OnDestroy, ViewEncapsulation, HostListener, ViewChild, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, range, EMPTY } from 'rxjs';
import { skip, mergeMap, catchError } from 'rxjs/operators';
import { DashboardService, CrewsDeployedKpi, ActiveWellsKpi, KpiTiles, HfbFilter, WmrWell, ActivitiesProgress, CriticalDateTimelineItem, WellProgress, WellProgressKpi, DrilledWellsCompletion, DrilledWellsYtdCompletion, DrilledWellsBreakdown, DueWellsCompletion, DueWellsCompletionTrend, DueWellsCompletionTrendPoint, WorkloadAnalysisResponse, ClusterHealth, ClusterWellsProgress, WellStagesResponse, CrewPRatingItem, WellsReadiness, CommissioningStatus, BufferFlowlinesReady, CommissioningProgressResponse, ConstructionProgressResponse, BufferLocationProgressResponse, PeggingStatusResponse, FlafStatusResponse, OdcOverallStatus, WellHookupKpi, NsHookupWaterfall, NsHookupCompletion, NsHookupBreakdown, HookupProgressResponse, OverallPeggingStatus, WellDeliveryCycleTime, CmdReadinessKpi } from '../../services/dashboard.service';

import { CUST_DASHBOARDS, CUST_LS_KEY, allCustWidgets, CustWidget, CustDashboard } from '../../shared/dashboard-widgets';

export type CmdOverviewTab = 'wmr' | 'dailyPlan' | 'phProductivity' | 'jobProgress';

/** Category of a data-quality / schema issue reported to the client. */
export type DbIssueCategory =
  | 'Data Type Mismatch'
  | 'No Standardization'
  | 'Null Values'
  | 'Primary Key'
  | 'Foreign Key'
  | 'Other';

/** A single field-level data issue found while implementing a widget. */
export interface DbFieldIssue {
  /** Column the issue is on. Use '(table-level)' for whole-table issues. */
  field: string;
  category: DbIssueCategory;
  /** What is wrong / missing in the client DB for this field. */
  detail: string;
}

/** Per-table DB issues shown in the widget "info" modal. */
export interface WidgetTableInfo {
  /** DB table the widget reads from. */
  table: string;
  /** Reliability of this table's data for the widget (drives the drawer badge). */
  reliability?: 'High' | 'Medium' | 'Low';
  reliabilityPct?: number;
  issues: DbFieldIssue[];
}

/** DB issue notes for a single widget (one or more tables). */
export interface WidgetIntegrationInfo {
  title: string;
  summary: string;
  tables: WidgetTableInfo[];
}

export interface DqIssue {
  field: string;
  issue: string;
  type: string;
  severity: 'High' | 'Medium' | 'Low';
  affected?: number;
  status: 'Open' | 'In progress' | 'Fixed';
}

export interface DqTable {
  name: string;
  issues: DqIssue[];
  /** Populated from live API — overrides penalty-based calculation. */
  reliabilityScore?: number;
  reliabilityLabel?: string;
  totalRows?: number;
}

@Component({
  selector: 'app-odcsouthwelldelivery',
  templateUrl: './odcsouthwelldelivery.component.html',
  styleUrls: ['./odcsouthwelldelivery.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class OdcSouthWellDeliveryComponent implements AfterViewInit, OnDestroy {

  activeTab: CmdOverviewTab = 'wmr';

  setActiveTab(tab: CmdOverviewTab): void {
    this.activeTab = tab;
  }

  /** Wells Planned vs Actual section toggle — 'wells' or 'activities' */
  wpaView: 'wells' | 'activities' = 'wells';

  setWpaView(view: 'wells' | 'activities'): void {
    this.wpaView = view;
    if (view === 'wells') {
      setTimeout(() => { this.renderWpaBreakdown(); this.renderWpaCoverage(); }, 0);
    } else {
      setTimeout(() => { this.renderActivityStackedChart(); this.renderActivityDonut(); }, 0);
    }
  }

  /** Well Delivery Completion section toggle — 'due' or 'drilled' */
  wellDeliveryView: 'due' | 'drilled' = 'due';

  setWellDeliveryView(view: 'due' | 'drilled'): void {
    this.wellDeliveryView = view;
    setTimeout(() => {
      if (view === 'due') this.renderDueWellsTrendHc();
      else this.renderDrilledWellsTrendHc();
    }, 0);
  }

  /** Selected chart style for the Due / Drilled trend charts. */
  dueWellsTrendChartType: string = 'area';
  drilledWellsTrendChartType: string = 'area';
  wellsTrendChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'area',   label: 'Area' },
    { value: 'line',   label: 'Line' },
    { value: 'spline', label: 'Spline' },
    { value: 'column', label: 'Column' },
    { value: 'bar',    label: 'Bar' }
  ];
  private dueWellsTrendChart: any = null;
  private drilledWellsTrendChart: any = null;

  onDueWellsTrendChartTypeChange(value: string): void {
    this.dueWellsTrendChartType = value;
    this.renderDueWellsTrendHc();
  }
  onDrilledWellsTrendChartTypeChange(value: string): void {
    this.drilledWellsTrendChartType = value;
    this.renderDrilledWellsTrendHc();
  }

  renderDueWellsTrendHc(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts) return;
    const el = document.getElementById('dueWellsTrendHc');
    if (!el) return;
    if (this.dueWellsTrendChart) { try { this.dueWellsTrendChart.destroy(); } catch (_) {} }

    // Prefer new completion-date trend; fall back to old rig-on trend
    const useTrend = this.dueWcTrendData?.points?.length
      ? this.dueWcTrendData.points.map((p: DueWellsCompletionTrendPoint) => ({
          month: p.month, cumulativePct: p.cumulativeRate, completedThisMonth: p.completedThisMonth
        }))
      : (this.dueWcData?.monthlyTrend || []).map((p: any) => ({
          month: p.month, cumulativePct: p.cumulativePct, completedThisMonth: null
        }));

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    const toMonthLabel = (raw: string): string => {
      // raw is either 'yyyy-MM' or 'yyyy-M'
      const parts = raw.split('-');
      const mIdx = parts.length >= 2 ? parseInt(parts[1], 10) - 1 : -1;
      return mIdx >= 0 && mIdx < 12 ? MONTH_NAMES[mIdx] : raw;
    };

    const categories = useTrend.map((p: any) => toMonthLabel(p.month));
    const actualVals = useTrend.map((p: any) => ({ y: p.cumulativePct, completed: p.completedThisMonth }));
    const planVals   = useTrend.map(() => 100);
    const t = this.dueWellsTrendChartType || 'area';

    this.dueWellsTrendChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '9pt' } },
      xAxis: {
        categories,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Completion %', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' }, format: '{value}%' },
        min: 0, max: 100
      },
      tooltip: {
        shared: true,
        formatter: function(this: any): string {
          const pts = this.points || [];
          let html = `<b>${this.x}</b><br/>`;
          pts.forEach((pt: any) => {
            const completed = pt.point?.completed;
            if (pt.series.name.startsWith('Actual')) {
              html += `${pt.series.name}: <b>${pt.y?.toFixed(1)}%</b>`;
              if (completed != null) html += ` &nbsp;(${completed} completed this month)`;
              html += '<br/>';
            } else {
              html += `${pt.series.name}: <b>${pt.y?.toFixed(1)}%</b><br/>`;
            }
          });
          return html;
        }
      },
      plotOptions: {
        series: {
          borderWidth: 0,
          borderRadius: (t === 'column' || t === 'bar') ? 4 : 0,
          marker: (t !== 'column' && t !== 'bar') ? { enabled: true, radius: 3 } : undefined,
          fillOpacity: t === 'area' ? 0.25 : undefined
        }
      },
      series: [
        { name: 'Actual Completion (%)', data: actualVals, color: '#00B050' },
        { name: 'Plan / Target (100%)',   data: categories.length > 0 ? categories.map(() => 100) : [100], color: '#1F3864', dashStyle: 'Dash', type: 'line', marker: { enabled: false } }
      ]
    });
  }

  renderDrilledWellsTrendHc(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts) return;
    const el = document.getElementById('drilledWellsTrendHc');
    if (!el) return;
    if (this.drilledWellsTrendChart) { try { this.drilledWellsTrendChart.destroy(); } catch (_) {} }

    const ALL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const trend = this.dwcData?.monthlyTrend || [];

    // Build lookup from API (backend now always returns 12 months)
    const dataByMonth: Record<string, { pct: number; cumComp: number; monthlyComp: number; monthlyTotal: number }> = {};
    trend.forEach(p => {
      dataByMonth[p.month] = {
        pct:          p.cumulativePct,
        cumComp:      (p as any).cumulativeCompleted ?? 0,
        monthlyComp:  (p as any).monthlyCompleted    ?? 0,
        monthlyTotal: (p as any).monthlyTotal        ?? 0
      };
    });

    // Actual series: 0 for all months — line runs Jan→Dec, future months stay at last known value
    const actualVals: number[] = [];
    const monthlyComps: number[] = [];
    const monthlyTotals: number[] = [];
    const cumComps: number[]     = [];

    // Find the last index that has real data (any month with drilled wells counts as data)
    const lastDataIdx = ALL_MONTHS.reduce((last, m, i) => {
      const d = dataByMonth[m];
      return (d && d.monthlyTotal > 0) ? i : last;
    }, -1);

    ALL_MONTHS.forEach((m, i) => {
      const d = dataByMonth[m];
      const mTotal = d?.monthlyTotal ?? 0;
      const mComp  = d?.monthlyComp  ?? 0;
      const monthlyPct = mTotal > 0 ? (mComp / mTotal * 100) : 0;
      // Past/present months: monthly completion %; future months: 0
      actualVals.push(i <= lastDataIdx ? monthlyPct : 0);
      monthlyComps.push(mComp);
      monthlyTotals.push(mTotal);
      cumComps.push(d?.cumComp ?? 0);
    });

    const t = this.drilledWellsTrendChartType || 'area';

    this.drilledWellsTrendChart = Highcharts.chart(el, {
      chart: { type: t === 'area' ? 'line' : t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '9pt' } },
      xAxis: {
        categories: ALL_MONTHS,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.12)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Completion %', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' }, format: '{value}%' },
        min: 0, max: 100
      },
      tooltip: {
        shared: true,
        formatter(this: any): string {
          const idx   = this.points?.[0]?.point?.index ?? 0;
          const comp  = monthlyComps[idx]  ?? 0;
          const total = monthlyTotals[idx] ?? 0;
          const pct   = total > 0 ? ((comp / total) * 100).toFixed(1) : '0.0';
          if (idx > lastDataIdx) return `<b>${ALL_MONTHS[idx]}</b><br/>No data yet`;
          return `<b>${ALL_MONTHS[idx]}</b><br/>Completion: <b>${pct}%</b><br/>Completed: <b>${comp}</b><br/>Total Drilled: <b>${total}</b>`;
        }
      },
      plotOptions: {
        series: {
          borderWidth: 0,
          borderRadius: (t === 'column' || t === 'bar') ? 4 : 0,
          connectNulls: false,
          marker: { enabled: true, radius: 4 },
          lineWidth: 2
        }
      },
      series: [
        { name: 'Actual Completion (%)', data: actualVals, color: '#29378d', zIndex: 2,
          fillOpacity: t === 'area' ? 0.18 : undefined,
          type: t === 'area' ? 'area' : t },
        { name: 'Plan / Target (100%)', data: ALL_MONTHS.map(() => 100), color: '#A0A0A0',
          dashStyle: 'Dash', type: 'line', marker: { enabled: false }, lineWidth: 1, zIndex: 1 }
      ]
    });
  }

  /** Well Hookup Progress section toggle — 'hookup' or 'commissioning' */
  wellHookupView: 'hookup' | 'commissioning' | 'conversions' = 'hookup';

  /** Map the active Well-Hookup tab to its API wellType. */
  private hookupWellType(view: 'hookup' | 'commissioning' | 'conversions' = this.wellHookupView): string {
    return { hookup: 'conventional', commissioning: 'non-standard', conversions: 'well-conversions' }[view] ?? 'conventional';
  }

  setWellHookupView(view: 'hookup' | 'commissioning' | 'conversions'): void {
    this.wellHookupView = view;
    // Re-fetch the newly-selected tab honouring the current global filter.
    this.fetchHookupProgress(this.hookupWellType(view), this.hookupScope());
  }

  /**
   * Map a global Well Type filter value to the matching Well-Hookup tab, or null when it doesn't
   * map (e.g. "All Types"). The tab — not a SQL predicate — is the well-type selector here, so a
   * global Well Type selection simply switches the active tab.
   */
  private hookupTabForWellType(location?: string | null): 'hookup' | 'commissioning' | 'conversions' | null {
    const v = (location || '').trim().toLowerCase();
    if (!v) return null;
    if (v.includes('conversion')) return 'conversions';
    if (v.includes('non') && v.includes('standard')) return 'commissioning';
    if (v.includes('conventional')) return 'hookup';
    return null;
  }

  /** Build the hookup-progress scope (cluster/site/project/date range) from the current global filter. */
  private hookupScope(f = this.dashboardService.currentFilter): { cluster?: string; site?: string; project?: string; from?: string; to?: string } {
    return {
      cluster: f.cluster || undefined,
      site:    f.site    || undefined,
      project: f.project || undefined,
      from:    f.startDate || undefined,
      to:      f.endDate   || undefined,
    };
  }

  /** Pegging Status section toggle — 'pegging' or 'flaf' */
  peggingView: 'pegging' | 'flaf' = 'pegging';
  setPeggingView(view: 'pegging' | 'flaf'): void {
    this.peggingView = view;
    setTimeout(() => {
      if (view === 'pegging') this.renderPeggingHcChart();
      else this.renderFlafHcChart();
    }, 0);
  }

  private _onFsChange?: () => void;
  private _fsCard: HTMLElement | null = null;

  /** Open/close a chart's per-widget filter popover (global wfb engine). */
  wfbToggle(event: Event, widgetId: string): void {
    (window as any).wfbToggle?.(event, widgetId);
  }

  toggleFullscreen(event: Event): void {
    const btn = event.currentTarget as HTMLElement;
    const card = btn.closest('.card') as HTMLElement;
    if (!card) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this._fsCard = card;
      void card.requestFullscreen();
    }
  }

  /** Fullscreen the entire ODC South Well Delivery section (not just one card). */
  toggleOsdFullscreen(event: Event): void {
    const btn = event.currentTarget as HTMLElement;
    const sec = btn.closest('.osd-section') as HTMLElement;
    if (!sec) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this._fsCard = sec;
      void sec.requestFullscreen();
    }
  }

  // ── Customise-Widgets Drawer (shared registry) ───────────────────────────
  custDrawerOpen = false;
  widgetVisible: Record<string, boolean> = {};

  readonly custDashboards: CustDashboard[] = CUST_DASHBOARDS;
  selectedCategory = 'Built-in';
  /** This page defaults the drawer to its own board. */
  selectedDashboardId = 'odc-south';
  custWidgetGroups: Array<{ name: string; items: CustWidget[] }> = [];

  get custCategories(): string[] {
    return this.custDashboards.map(d => d.category).filter((c, i, a) => a.indexOf(c) === i);
  }
  get custDashboardsInCategory(): CustDashboard[] {
    return this.custDashboards.filter(d => d.category === this.selectedCategory);
  }
  get activeDashboard(): CustDashboard {
    return this.custDashboards.find(d => d.id === this.selectedDashboardId) || this.custDashboards[0];
  }
  get custEnabledCount(): number {
    return this.activeDashboard.widgets.reduce((n, w) => n + (this.isWidgetVisible(w.id) ? 1 : 0), 0);
  }

  private loadWidgetVisibility(): void {
    const vis: Record<string, boolean> = {};
    allCustWidgets().forEach(w => { vis[w.id] = true; });
    try {
      const raw = localStorage.getItem(CUST_LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, boolean>;
        Object.keys(saved).forEach(k => { if (k in vis) vis[k] = saved[k] !== false; });
      }
    } catch (_) { /* ignore */ }
    this.widgetVisible = vis;
    this.rebuildWidgetGroups();
  }
  private persistWidgetVisibility(): void {
    try { localStorage.setItem(CUST_LS_KEY, JSON.stringify(this.widgetVisible)); } catch (_) { /* ignore */ }
  }
  private rebuildWidgetGroups(): void {
    const order: CustWidget['group'][] = ['KPI cards', 'Charts & widgets'];
    const ws = this.activeDashboard.widgets;
    this.custWidgetGroups = order
      .map(name => ({ name, items: ws.filter(w => w.group === name) }))
      .filter(g => g.items.length > 0);
  }

  isWidgetVisible(id: string): boolean { return this.widgetVisible[id] !== false; }
  toggleWidget(id: string): void { this.widgetVisible[id] = !this.isWidgetVisible(id); this.persistWidgetVisibility(); }
  openCustomiseDrawer(): void { this.loadWidgetVisibility(); this.custDrawerOpen = true; }
  /** Open the full dashboard builder (Chart Library on the right) for this board. */
  openBuilder(): void {
    const w = window as any;
    const id = w.WDS_BOARD_ID || 4;
    if (typeof w.dbOpenBuilder === 'function') w.dbOpenBuilder(id);
  }
  closeCustomiseDrawer(): void { this.custDrawerOpen = false; }
  resetWidgets(): void { this.activeDashboard.widgets.forEach(w => { this.widgetVisible[w.id] = true; }); this.persistWidgetVisibility(); }
  onCustCategoryChange(): void { const f = this.custDashboardsInCategory[0]; if (f) this.selectedDashboardId = f.id; this.rebuildWidgetGroups(); }
  onCustDashboardChange(): void { this.rebuildWidgetGroups(); }

  // ── View mode: flat list ↔ tree (Category → Dashboard → widgets) ──
  custViewMode: 'list' | 'tree' = 'list';
  custTreeExpanded: Record<string, boolean> = {};

  setCustView(mode: 'list' | 'tree'): void {
    this.custViewMode = mode;
    if (mode === 'tree' && !Object.keys(this.custTreeExpanded).length) {
      this.custTreeExpanded['cat:' + this.selectedCategory] = true;
      this.custTreeExpanded['dash:' + this.selectedDashboardId] = true;
    }
  }
  isTreeExpanded(key: string): boolean { return !!this.custTreeExpanded[key]; }
  toggleTree(key: string): void { this.custTreeExpanded[key] = !this.custTreeExpanded[key]; }
  selectDashboardNode(id: string): void { this.selectedDashboardId = id; this.rebuildWidgetGroups(); }

  /** Done → load the selected dashboard, then close. */
  applyCustomiseAndClose(): void {
    const route = this.activeDashboard.route;
    this.closeCustomiseDrawer();
    const w = window as any;
    if (route && typeof w.navigate === 'function') w.navigate(route, null);
  }

  /** Row click → scroll the widget into view on this page (flash highlight). */
  drillToWidget(id: string): void {
    if (this.activeDashboard.id !== 'odc-south') { this.applyCustomiseAndClose(); return; }
    if (!this.isWidgetVisible(id)) { this.widgetVisible[id] = true; this.persistWidgetVisibility(); }
    this.closeCustomiseDrawer();
    setTimeout(() => {
      const el = document.querySelector('[data-cw-id="' + id + '"]') as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('cw-flash');
      setTimeout(() => el.classList.remove('cw-flash'), 1600);
    }, 60);
  }

  // ── Data-Quality Drawer ──────────────────────────────────────────────────
  dqDrawerOpen  = false;
  dqDrawerTitle = '';
  dqDrawerDesc  = '';
  dqDrawerTables: DqTable[] = [];
  dqActiveTab   = 0;
  dqApiLoading  = false;
  dqDrawerActiveKey = '';

  /** Maps DQ_DATA keys that have a live API tile to the tile query param. */
  private readonly DQ_API_MAP: Record<string, string> = {
    kpiTotalWells:          'totalWells',
    kpiCompletedWells:      'completedWells',
    odcOverallStatus:       'odcStatus',
    dueWellsKpi:            'dueWells',
    dueWellsCompletion:     'dueWellsCompletion',
    dueWellsTrend:          'dueWellsCompletionTrend',
    kpiPenalty:             'penaltyExposure',
    kpiBonus:               'bonusPotential',
    prating:                'crewPRating',
    wpaKpi:                 'wpaReadiness',
    drilledTrend:           'drilledWells',
    drilledDonut:           'drilledWells',
    hookupWaterfall:        'hookupProgress',
    hookupDonut:            'hookupProgress',
    constructionProgress:   'constructionProgress',
    wroOverall:             'wroOverall',
    wroFlowline:            'wroFlowline',
    wroOhl:                 'wroOhl',
    wroBuffer:              'wroBuffer',
  };

  private dqApiCache: Record<string, any> = {};
  /** Overall reliability scores fetched from API — keyed by DQ_DATA key. */
  dqApiScores: Record<string, number> = {};

  /** Fetch a single tile from the data-quality API and cache the result. */
  private async loadDqApiTile(key: string): Promise<void> {
    const tileId = this.DQ_API_MAP[key];
    if (!tileId || this.dqApiCache[key]) return;
    try {
      const resp = await fetch(`/api/v1/wells/data-quality/tile?tile=${tileId}`);
      if (!resp.ok) return;
      const data = await resp.json();
      this.dqApiCache[key] = data;
      this.dqApiScores[key] = Math.round(data.overallReliabilityScore ?? 0);
    } catch { /* network / parse error — silently fall back to static data */ }
  }

  /** Prefetch all API-backed tile scores so badge % values are live on page load. */
  private prefetchDqScores(): void {
    Object.keys(this.DQ_API_MAP).forEach(key => void this.loadDqApiTile(key));
  }

  private readonly DQ_DATA: Record<string, { title: string; desc: string; tables: DqTable[] }> = {
    peggingStatus: {
      title: 'Pegging Status - Monthly Trend',
      desc: 'Monthly count of pegging-ready wells vs PDO Rig Sequence plan. Readiness is derived from WMR status fields (commissioning, flow-line, loc-prep) using the confirmed cached snapshot.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'pdo_well_id',                  issue: 'NULL or empty pdo_well_id rows are excluded from the snapshot (confirmed WHERE clause). These wells are missing from all trend counts.', type: 'Null key',       severity: 'High',   affected: 0,  status: 'Open' },
            { field: 'Week_Number',                  issue: 'NVARCHAR column used for date ordering via TRY_CAST. Rows where TRY_CAST(Week_Number AS DATE) returns NULL are excluded entirely from the snapshot.', type: 'Data type',      severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'flow_line_commi._status_in_progress_completed', issue: 'Status text field with dot in column name. Mixed casing or partial values (In Progress / COMPLETED) may cause misclassification in pegging readiness logic.', type: 'Standardisation', severity: 'Medium', affected: 0,  status: 'Open' },
            { field: '(table)',                      issue: 'No primary key. ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(Week_Number AS DATE) DESC) is used to deduplicate. Malformed Week_Number rows are excluded, which may drop the latest record for a well.', type: 'PK missing',   severity: 'Medium', affected: 0,  status: 'Open' }
          ]
        },
        {
          name: 'AppMasterDB.dbo.ProjectIDs',
          issues: [
            { field: 'ID, Type',      issue: 'Numeric ID requires CAST to NVARCHAR(100) to join with WMR.project_id - type mismatch causes silent row drops from plan totals.', type: 'Data type',  severity: 'High',   affected: 0,  status: 'Open' },
            { field: 'Cluster',       issue: 'LTRIM/RTRIM required - trailing spaces cause cluster filter equality mismatches.', type: 'Standardisation', severity: 'Medium', affected: 0,  status: 'Open' }
          ]
        }
      ]
    },
    peggingBacklog: {
      title: 'Pegging Backlog Responsibility (YTD)',
      desc: 'YTD backlog = total planned wells minus pegging-ready wells. Responsibility split (ATNM vs PDO) is derived from WMR status fields in the cached snapshot.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'location_preparation_status_in_progress_completed', issue: 'Status text field with a very long name containing dots. UPPER() normalisation is needed - mixed casing can misclassify readiness, overstating ATNM backlog.', type: 'Standardisation', severity: 'High',   affected: 0, status: 'Open' },
            { field: 'flow_line_commi._status_in_progress_completed',     issue: 'Same naming and casing issues as loc-prep. Blank or partial values default to not-ready and inflate PDO backlog.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                                       issue: 'NULL pdo_well_id rows are excluded from the snapshot - their backlog cannot be attributed to either ATNM or PDO.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'AppMasterDB.dbo.ProjectIDs',
          issues: [
            { field: 'ID',   issue: 'Type mismatch with WMR.project_id - unmatched plan wells appear in total count but not in WMR actuals, inflating reported backlog.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    peggingRisk: {
      title: 'Pegging Risk Level - Next 4 Months',
      desc: 'Projected readiness gap for the next 4 months. Risk level: >= 90% = On Track, 70-90% = Watch, < 70% = High Risk. Computed from the WMR snapshot projected forward.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'Week_Number',                  issue: 'Date ordering for the snapshot relies on TRY_CAST(Week_Number AS DATE). Rows with unparseable Week_Number are dropped, potentially selecting an older row as the latest record for a well.', type: 'Data type',   severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR column - TRY_CAST to FLOAT. Cast failures default to 0 progress, which may classify in-progress wells as not started in the 4-month risk projection.', type: 'Data type',   severity: 'Medium', affected: 0, status: 'In progress' },
            { field: 'pdo_well_id',                  issue: 'NULL pdo_well_id rows excluded from snapshot - these wells are invisible to the risk projection.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    flafStatus: {
      title: 'FLAF Status - Monthly Trend',
      desc: 'Monthly count of FLAF documents issued vs plan. Source: dbo.WMR column flaf_issue_date (confirmed real column, loaded in snapshot cache with TRY_CAST to DATE).',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'flaf_issue_date',  issue: 'Stored as NVARCHAR - TRY_CAST(flaf_issue_date AS DATE) is used in the snapshot cache. Invalid date text becomes NULL and the FLAF is counted as not issued.', type: 'Data type',      severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'flaf_issue_date',  issue: 'NULL flaf_issue_date is explicitly checked (flaf_issue_date IS NULL) as the not-yet-issued condition. Any free-text non-null non-date value is TRY_CAST to NULL and treated the same way - may undercount issued FLAFs.', type: 'Null value',       severity: 'High',   affected: 0,  status: 'Open' },
            { field: 'pdo_well_id',      issue: 'NULL pdo_well_id rows excluded from snapshot - their FLAF issue date is invisible to the trend chart.', type: 'Null key',       severity: 'Medium', affected: 0,  status: 'Open' },
            { field: '(table)',          issue: 'No primary key - ROW_NUMBER deduplication picks the row with the latest valid Week_Number. If Week_Number is malformed, an older FLAF date may be selected.', type: 'PK missing',   severity: 'Medium', affected: 0,  status: 'Open' }
          ]
        },
        {
          name: 'AppMasterDB.dbo.ProjectIDs',
          issues: [
            { field: 'ID, Type',  issue: 'Numeric ID requires CAST to NVARCHAR(100) to join with WMR.project_id - unmatched plan wells are absent from FLAF actuals, understating completion rate.', type: 'Data type',       severity: 'High',   affected: 0,  status: 'Open' },
            { field: 'Cluster',   issue: 'LTRIM/RTRIM required - trailing spaces cause cluster filter mismatches when drilling down by cluster.', type: 'Standardisation', severity: 'Low',    affected: 0,  status: 'Open' }
          ]
        }
      ]
    },
    flafBacklog: {
      title: 'FLAF Backlog Responsibility (YTD)',
      desc: 'YTD FLAF backlog = planned wells without a valid flaf_issue_date in WMR. Responsibility split derived from WMR status fields.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'flaf_issue_date',              issue: 'Backlog is defined as flaf_issue_date IS NULL or TRY_CAST returns NULL. Non-null text that is not a valid date is silently treated as not-issued, inflating the backlog count.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'location_preparation_status_in_progress_completed', issue: 'Used for ATNM vs PDO split. Mixed casing or blank values cause misattribution of backlog responsibility.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                  issue: 'NULL pdo_well_id rows excluded - backlog from these wells cannot be attributed to either ATNM or PDO.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'AppMasterDB.dbo.ProjectIDs',
          issues: [
            { field: 'ID',  issue: 'Type mismatch with WMR.project_id - unmatched plan wells inflate total planned count without a corresponding WMR entry, overstating FLAF backlog.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    flafRisk: {
      title: 'FLAF Risk Level - Next 4 Months',
      desc: 'Projected FLAF completion gap for the next 4 months based on WMR flaf_issue_date and planned dates. Risk: >= 90% = On Track, 70-90% = Watch, < 70% = High Risk.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'flaf_issue_date',              issue: 'NVARCHAR - TRY_CAST to DATE. Cast failures treated as not issued. If the latest row (by Week_Number) has an invalid flaf_issue_date, a real FLAF is counted as missing, worsening the risk score.', type: 'Data type',  severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'Week_Number',                  issue: 'Snapshot deduplication orders by TRY_CAST(Week_Number AS DATE) DESC. Malformed Week_Number rows are excluded, which may cause an older snapshot row (with no FLAF date) to be selected as the latest.', type: 'Data type',  severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'pdo_well_id',                  issue: 'NULL pdo_well_id rows excluded - forecast readiness may be understated if excluded wells have issued FLAFs.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    drilledTrend: {
      title: 'Drilled Wells Completion Trend',
      desc: 'Monthly completion trend vs plan. Plan source: dbo.SAP_DRILLING_SEQUENCE_History (Earl_start_date column - note unusual spelling). Actuals source: dbo.WMR (over_all_progress_percentages, actual_rig_on_date).',
      tables: [
        {
          name: 'dbo.SAP_DRILLING_SEQUENCE_History',
          issues: [
            { field: 'Earl_start_date',   issue: 'Column is named Earl_start_date (not Early_start_date) - NVARCHAR, TRY_CAST to DATE required. NULL after cast = row excluded from plan. Rows with Well_Function = Unspecified, RIG MOVE, or RIG MAINTENANCE are also excluded.', type: 'Data type',      severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'EarliestEndDate',   issue: 'NVARCHAR - TRY_CAST to DATE. When NULL after cast, the plan duration cannot be computed and the well is excluded from trend denominator.', type: 'Data type',      severity: 'Medium', affected: 0,  status: 'Open' },
            { field: 'Well_ID',           issue: 'Joins to WMR.pdo_well_id via LEFT JOIN. Wells in SAP with no matching WMR entry are counted in plan but absent from actuals, reducing apparent completion rate.', type: 'FK / relationship', severity: 'Medium', affected: 0,  status: 'Open' },
            { field: 'Well_Function',     issue: 'Filter excludes Unspecified, RIG MOVE, RIG MAINTENANCE. Inconsistent casing or new unrecognised values may allow non-drilling entries into the plan count.', type: 'Standardisation', severity: 'Low',    affected: 0,  status: 'Open' }
          ]
        },
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR - TRY_CAST to FLOAT. Cast failures default to 0 progress, so wells with corrupt progress text appear as not started in the trend.', type: 'Data type',      severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'actual_rig_on_date',            issue: 'NVARCHAR - TRY_CAST to DATE. Invalid entries become NULL and the well is treated as not yet started even if physically active.', type: 'Data type',      severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'Week_Number',                   issue: 'NVARCHAR date-like field used for ROW_NUMBER deduplication. Rows where TRY_CAST(Week_Number AS DATE) is NULL are excluded from the snapshot, possibly dropping the latest progress entry.', type: 'Data type',      severity: 'Medium', affected: 0,  status: 'In progress' },
            { field: 'pdo_well_id',                   issue: 'NULL or empty pdo_well_id rows excluded from snapshot. These wells cannot be matched to SAP plan, so they count in neither plan nor actuals.', type: 'Null key',       severity: 'Medium', affected: 0,  status: 'Open' }
          ]
        }
      ]
    },
    drilledDonut: {
      title: 'Overall % Completed (Drilled Wells)',
      desc: 'Status breakdown: Completed = progress >= 1.0 (100%); In Progress = rig on site and progress > 0; Pending = no rig yet. Sources: dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR - TRY_CAST to FLOAT. Completed threshold is value >= 1.0 (i.e. 100%). Cast failures default to 0 and the well is classified as Pending.', type: 'Data type',   severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'actual_rig_on_date',            issue: 'NVARCHAR - TRY_CAST to DATE. NULL or invalid date means rig-on status is unknown. Wells with a rig physically on site but a bad date value are classified as Pending.', type: 'Data type',   severity: 'High',   affected: 0,  status: 'In progress' },
            { field: 'actual_rig_off_date',           issue: 'NVARCHAR - TRY_CAST to DATE. Used to detect rig departure (completed state). Invalid rig-off date causes completed wells to appear as In Progress.', type: 'Data type',   severity: 'Medium', affected: 0,  status: 'Open' },
            { field: 'pdo_well_id',                   issue: 'NULL pdo_well_id rows excluded - not counted in any status bucket (Completed, In Progress, or Pending).', type: 'Null key',    severity: 'Low',    affected: 0,  status: 'Open' }
          ]
        },
        {
          name: 'dbo.SAP_DRILLING_SEQUENCE_History',
          issues: [
            { field: 'Well_ID, Earl_start_date', issue: 'Plan universe is all wells in SAP with a valid Earl_start_date. Wells in SAP with no WMR match are counted as Pending, inflating that bucket.', type: 'FK / relationship', severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Well_Function',            issue: 'Excluded values (Unspecified, RIG MOVE, RIG MAINTENANCE) must match exactly. New unrecognised Well_Function values pass through and inflate the plan total.', type: 'Standardisation', severity: 'Low', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    drilledBreakdown: {
      title: 'Drilled Wells Breakdown',
      desc: 'Backlog = In Progress + Pending wells. Completed = progress >= 1.0 (100%) in latest WMR snapshot row, deduplicated by ROW_NUMBER per pdo_well_id.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'Completed threshold is TRY_CAST(over_all_progress_percentages AS FLOAT) >= 1.0. Non-numeric values cast to NULL and default to 0. These wells appear as In Progress or Pending, inflating Backlog.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'Week_Number',                   issue: 'NVARCHAR - used for ROW_NUMBER(PARTITION BY pdo_well_id ORDER BY TRY_CAST(Week_Number AS DATE) DESC). Rows with invalid Week_Number are excluded from snapshot. If the most recent entry is excluded, an older (lower progress) row becomes the latest, inflating Backlog.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'actual_rig_off_date',           issue: 'NVARCHAR - TRY_CAST to DATE. Invalid rig-off date causes wells that have finished drilling to remain in the In Progress bucket instead of Completed.', type: 'Data type',      severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                   issue: 'NULL or empty pdo_well_id excluded (confirmed WHERE clause in snapshot loader). These wells are invisible to the breakdown.', type: 'Null key',      severity: 'Low',    affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    prating: {
      title: 'Crew P-Rating Distribution',
      desc: 'Distribution of crew performance (P-rating) across P0–P8 bands + Unrated. ' +
            'Data flow: dbo.task_daily (last 90 days, crew_code + crew_type) → ' +
            'LEFT JOIN dbo.PH_PRODUCTIVITY_WEEKLY_REPORT ON [Crew Type] — picks the single row with the highest [Month PI (CMR)] per Crew Type (ROW_NUMBER). ' +
            'Deduplication: dbo.OLD_NEW_CREW_MAPPING.CREW_GROUP_CODE substring-contains match on crew_code — crews whose code does not contain any group code are silently dropped (not even counted as Unrated). ' +
            'Cluster filter: LEFT JOIN dbo.SAP_DRILLING_SEQUENCE_History ON well_id for the Field (cluster) column. ' +
            'Enrichment is cached in-process and refreshed on a dynamic 5–15 min interval.',
      tables: [
        {
          name: 'dbo.task_daily',
          issues: [
            { field: 'crew_code',   issue: 'NULL/empty crew_code rows are excluded from the base query — those crews never appear in the distribution.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'crew_type',   issue: 'crew_type is the JOIN key to PH_PRODUCTIVITY_WEEKLY_REPORT.[Crew Type]. NULL/empty crew_type means no P-Rating can be matched — those crews land in the Unrated bucket.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'project_id',  issue: 'NULL/empty project_id means the crew cannot be cluster-filtered. When any Cluster/Site/Well Type filter is applied, those crews are invisible to the filtered distribution.', type: 'Completeness', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'ActionOn',    issue: 'The query uses a hard 90-day rolling window (ActionOn BETWEEN @start AND @end). Crews inactive for more than 90 days are not included in the distribution regardless of their P-Rating.', type: 'Data scope', severity: 'Low', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.PH_PRODUCTIVITY_WEEKLY_REPORT',
          issues: [
            { field: '[Crew Type]',       issue: 'NULL/empty [Crew Type] rows cannot be matched to task_daily.crew_type — those rows are unreachable and contribute nothing to any crew\'s P-Rating.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: '[Month PI (CMR)]',  issue: 'The P-Rating value. If ALL rows for a Crew Type have NULL [Month PI (CMR)], the joined crew gets pRating=null and lands in Unrated. Non-numeric, non-"P#" values are stored as-is and fall outside all P0–P8 bands — those crews also end up Unrated.', type: 'Completeness / Validity', severity: 'High', affected: 0, status: 'Open' },
            { field: '[Crew Type] (ROW_NUMBER)', issue: 'Only one row per [Crew Type] is used (highest [Month PI (CMR)] by ROW_NUMBER). Multiple rows per type exist but only the most optimistic rating is shown — not necessarily the most recent.', type: 'Consistency', severity: 'Medium', affected: 0, status: 'Open' },
            { field: '[Month PI (CMR)] (range)', issue: 'Numeric values outside 0–8 (e.g. 9, 10) become "P9" / "P10" — not a valid chart band. Those crews disappear from the chart silently.', type: 'Validity', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.OLD_NEW_CREW_MAPPING (CREW_GROUP_CODE)',
          issues: [
            { field: 'CREW_GROUP_CODE (dedup key)', issue: 'Deduplication uses crew_code.Contains(CREW_GROUP_CODE) substring match. Any crew_code that does not contain any CREW_GROUP_CODE is dropped from the distribution entirely — not counted in Unrated either. This is the single largest hidden data gap.', type: 'Integrity', severity: 'High', affected: 0, status: 'Open' },
            { field: 'CREW_GROUP_CODE (NULL)',       issue: 'NULL/empty CREW_GROUP_CODE rows cannot dedup any crew. Crews that would have matched only those rows are also dropped.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'CREW_GROUP_CODE (ambiguous)',  issue: 'If a crew_code contains more than one distinct CREW_GROUP_CODE substring, it is assigned to whichever group code appears first in the loaded list — deterministic but arbitrary.', type: 'Consistency', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.SAP_DRILLING_SEQUENCE_History',
          issues: [
            { field: 'Field (cluster — display only)', issue: 'SAP Field is joined in enrichment to populate the Cluster display label on each crew row. It is NOT used for filtering. The cluster filter path is: task_daily.project_id → AppMasterDB.dbo.ProjectIDs[Cluster]. Wells with no matching SAP row get a NULL cluster label, but are not filtered out unless a Cluster filter is applied via the project_id path.', type: 'Integrity', severity: 'Low', affected: 0, status: 'Open' },
            { field: 'Field (format)',   issue: 'LTRIM/RTRIM is applied in the ClusterLookup CTE, but no UPPER() normalisation. Casing differences in Field values cause the same cluster to appear with different labels in the crew detail view.', type: 'Consistency', severity: 'Low', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    dueWellsKpi: {
      title: 'Due Wells – KPI Chip (Dashboard)',
      desc: 'The "Due Wells" and "Non Due Wells" chips on the COMPLETED WELLS tile. ' +
            'Source: dbo.WMR — wells where [latest_exp.rig_on_location_sap_data] < toDate AND progress > 0.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: '[latest_exp.rig_on_location_sap_data]', issue: 'NULL or empty SAP expected rig-on date silently forces the well into Non-Due — regardless of actual delivery timing.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'Week_Number', issue: 'Mixed YYYY-MM-DD / YY-MM-DD formats. COALESCE fix required; without it 8-char rows drop from the date filter.', type: 'Consistency', severity: 'High', affected: 0, status: 'In progress' },
            { field: 'pdo_well_id', issue: 'NULL rows excluded from all counts.', type: 'Null key', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    dueWellsCompletion: {
      title: 'Well Delivery Completion Overview – KPI Tiles',
      desc: 'KPI tiles: Total Due Wells, Completed, In Progress, Suspended, Completion Rate. ' +
            'Source: dbo.WMR (Week_Number YTD range, SAP expected_rig_on_date gate, progress split) + dbo.TaskPlanCSVImport (Suspended count). ' +
            'A well is "due" when [latest_exp.rig_on_location_sap_data] IS NOT NULL AND < toDate AND progress > 0.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: '[latest_exp.rig_on_location_sap_data]', issue: 'NULL SAP date excludes the well from DueWells CTE — invisible to all 5 KPI tiles.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR — TRY_CAST to FLOAT. Failures default to 0; Completed (>=1.0) vs In Progress (<1.0) split is wrong for those wells.', type: 'Validity', severity: 'Medium', affected: 0, status: 'In progress' },
            { field: 'Week_Number', issue: 'Mixed YYYY-MM-DD / YY-MM-DD formats. 8-char rows excluded from YTD BETWEEN filter without the COALESCE fix.', type: 'Consistency', severity: 'High', affected: 0, status: 'In progress' },
            { field: 'pdo_well_id', issue: 'NULL rows excluded from all counts.', type: 'Null key', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.TaskPlanCSVImport',
          issues: [
            { field: 'Resume_Suspend', issue: 'Suspended count uses WHERE Resume_Suspend=\'Suspend\' — no latest-action dedup. A well suspended then resumed still counts as Suspended if a Suspend row exists.', type: 'Consistency', severity: 'High', affected: 0, status: 'Open' },
            { field: 'Well_ID', issue: 'No FK to WMR.pdo_well_id. Mismatched IDs cause Suspend rows to never join to Due Wells, under-counting Suspended.', type: 'FK missing', severity: 'High', affected: 0, status: 'Open' },
            { field: 'time_stamp', issue: 'NULL time_stamp makes latest-action ordering unreliable.', type: 'Validity', severity: 'High', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    dueWellsTrend: {
      title: 'Due Wells Completion Trend Chart',
      desc: 'Monthly completion % trend. Source: dbo.WMR — same DueWells CTE as the completion widget, ' +
            'grouped by FORMAT([latest_exp.rig_on_location_sap_data],\'yyyy-MM\'). ' +
            'Chart % = completed / total for that SAP-rig-on month. Badge % = cumulative YTD rate.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: '[latest_exp.rig_on_location_sap_data]', issue: 'NULL or unparseable SAP date excludes the well from every month-band — chart shows nothing for those wells, understating the cumulative % badge.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'Week_Number', issue: 'Mixed formats — 8-char rows drop from YTD filter without the COALESCE fix; entire wells disappear from the chart.', type: 'Consistency', severity: 'High', affected: 0, status: 'In progress' },
            { field: 'pdo_well_id', issue: 'NULL rows excluded from DueWells CTE.', type: 'Null key', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    clusterHealth: {
      title: 'Cluster Operational Health',
      desc: 'Cluster-level summary of well progress, Plan % vs Actual %, and At-Risk / Critical counts ' +
            '(GET /dashboard/cluster-health). ' +
            'Aggregates one row per distinct well using MAX(over_all_progress_percentages) across all WMR weekly snapshots. ' +
            'Plan % = elapsed days ÷ planned duration from actual_rig_on_date to exp.rig_off_location_sap_data.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'Stored as NVARCHAR with mixed formats: decimal fraction (0.85), percentage string ("85%"), or plain number (85). TRY_CAST with REPLACE of "%" handles most cases; any unrecognised format silently becomes NULL, excluding the well from the cluster average and inflating the health score.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'actual_rig_on_date',            issue: 'NVARCHAR — TRY_CAST to DATE required. Used to compute Planned % = elapsed days ÷ planned duration. Cast failures produce NULL planned %, so the Plan bar shows 0% even for active wells.', type: 'Data type',      severity: 'High',   affected: 0, status: 'Open' },
            { field: 'exp.rig_off_location_sap_data', issue: 'Column name contains a dot — must be quoted exactly. NVARCHAR — TRY_CAST to DATE. Failures cause PlannedPct_raw to be skipped for that well (CASE guard prevents division by zero but the well contributes 0% plan).', type: 'Naming / Type', severity: 'High',   affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                   issue: 'Nullable — NULL or empty rows excluded by WHERE clause. Excluded wells are invisible to cluster health count and average.', type: 'Null key',       severity: 'Medium', affected: 0, status: 'Open' },
            { field: '(table)',                       issue: 'No primary key — multiple rows per well (weekly snapshots). MAX(progress) across snapshots is used. A single incorrect high-value row permanently inflates the displayed progress.', type: 'PK missing',   severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'project_id',                    issue: 'NVARCHAR — joined to ProjectIDs.ID via CAST(ID AS NVARCHAR(100)). Type or whitespace mismatch causes the well to be orphaned and excluded from its cluster entirely.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID',         issue: 'Numeric ID — CAST(ID AS NVARCHAR(100)) needed to join with WMR.project_id. Unmatched wells are absent from the cluster well count, reducing the displayed total.', type: 'Data type',      severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Cluster',    issue: 'LTRIM/RTRIM required — trailing spaces cause equality mismatches when filtering by cluster name in the WHERE clause.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'Site, Type', issue: 'Optional filter columns. NULLIF(LTRIM(RTRIM(...)), \'\') treats blank strings as NULL so the filter is skipped cleanly when no value is provided.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    clusterWellProgress: {
      title: 'Cluster – Well Progress (Drill-down)',
      desc: 'Per-well progress bars shown when drilling into a cluster card (GET /dashboard/cluster-wells-progress). ' +
            'One row per distinct well: MAX(over_all_progress_percentages) across all WMR snapshots, ' +
            'scoped to the selected cluster and date range.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'Same NVARCHAR mixed-format issue as Cluster Health L1. TRY_CAST + REPLACE("%" → "") used; invalid values become NULL so MAX() defaults to 0 — well shows 0% progress even if it has real data in other snapshot rows.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'pdo_well_id',                   issue: 'Nullable — NULL rows excluded by WHERE clause. Wells without a pdo_well_id never appear in the drill-down list regardless of their actual construction state.', type: 'Null key',       severity: 'Medium', affected: 0, status: 'Open' },
            { field: '(table)',                       issue: 'No primary key — multiple snapshot rows per well. MAX() collapses them to one row. A stale high-value snapshot row permanently inflates the displayed progress bar.', type: 'PK missing',   severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'well_name_after_spud',          issue: 'NVARCHAR free text — MAX() picks an arbitrary non-NULL name if the name varies across snapshot rows.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Open' },
            { field: 'actual_rig_on_date, exp.rig_off_location_sap_data', issue: 'NVARCHAR — TRY_CAST failures return NULL. The date filter uses "IS NULL OR …" guards, so wells with unparseable dates pass the filter regardless of date range — they are never filtered out by the date selector.', type: 'Data type',      severity: 'Low',    affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID',      issue: 'CAST(ID AS NVARCHAR(100)) needed to join with WMR.project_id. Unmatched wells are absent from the drill-down list even if they have progress data.', type: 'Data type',      severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Cluster', issue: 'LTRIM/RTRIM applied. Wells belonging to a cluster with trailing spaces in the DB are grouped under the trimmed name — they appear correctly, but the raw DB value and the UI name may differ.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Open' },
            { field: 'Type',    issue: 'Used as WellType for optional filter. NULLIF(LTRIM(RTRIM(...)), \'\') treats blanks as NULL so the filter is skipped when empty. Wells with a blank Type never match a specific wellType filter even if they logically belong to it.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    wroOverall: {
      title: 'Wells Readiness Overall Status',
      desc: 'Plan vs Actual funnel (SAP: 20,500 rows → 14,696 valid → 8,040 distinct wells → 1,200 in 2026. WMR: 50,841 rows → 23,523 with valid Week_Number → 395 distinct wells in snapshot. ProjectIDs: 19 → MARMUL, NIMR). Verified: KPIs match UI with date-range filter applied. Performance: WMR scan 312ms, mitigated by WmrSnapshotCache.',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',         issue: '2,318 rows with NULL/empty Well_ID excluded — invisible to Original Plan count.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE for plan year filter. 0 cast failures detected.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Function',   issue: 'Case-sensitive NOT IN filter. 0 casing inconsistencies detected.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: '(table)',         issue: 'No PK. GROUP BY Well_ID + MIN(Earl_start_date) deduplicates.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR', issues: [
          { field: 'pdo_well_id',                   issue: '0 null/empty — all 50,841 rows have valid IDs.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',                   issue: 'NVARCHAR — single TRY_CAST(Week_Number AS DATE) for snapshot. 27,318 rows (53%) excluded — reduces snapshot to 23,523 rows / 395 wells.', type: 'Data type',        severity: 'High',   affected: 27318, status: 'In progress' },
          { field: 'over_all_progress_percentages', issue: 'NVARCHAR — COALESCE(TRY_CAST AS FLOAT, 0). 0 cast failures detected — all values are valid.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'flaf_issue_date',               issue: 'NVARCHAR — TRY_CAST to DATE for FLAF exclusion. 0 cast failures detected.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'project_id',                    issue: 'LEFT JOIN to ProjectIDs. 0 unmatched, 0 null/empty values.', type: 'FK / relationship', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: '(table)',                       issue: 'No PK. ROW_NUMBER() deduplication — ties resolved arbitrarily.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'AppMasterDB.dbo.ProjectIDs', issues: [
          { field: 'ID',      issue: 'All 19 IDs resolve correctly via CAST to NVARCHAR(100). 0 mismatches.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'column2', issue: 'Only 2 clusters: MARMUL, NIMR. 0 misclassifications.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' }
        ]}
      ]
    },
    wroFlowline: {
      title: 'Flowline Readiness Status',
      desc: 'Flowline completion funnel. fl_done = overall_const=100 OR fl_status=\'Completed\' OR const_complete_date non-empty. Verified: 0 cast failures on overall_const, 0 casing issues on fl_status (values: Completed, In Progress, Not Started). FLAF exclusion uses flaf_issue_date (0 cast failures).',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',         issue: '2,318 rows with NULL/empty excluded — invisible to Original Plan.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures detected.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Function',   issue: 'Case-sensitive NOT IN. 0 casing inconsistencies.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: '(table)',         issue: 'No PK. GROUP BY Well_ID + MIN deduplicates.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR', issues: [
          { field: 'pdo_well_id',       issue: '0 null/empty — all rows valid.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',       issue: 'NVARCHAR — single TRY_CAST for snapshot dedup. 27,318 rows excluded (53% of WMR).', type: 'Data type',        severity: 'High',   affected: 27318, status: 'In progress' },
          { field: '[overall_const._10_100]', issue: 'NVARCHAR — TRY_CAST to FLOAT = 100. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: '[flow_line_const._status_in_progress_completed]', issue: 'Exact match = \'Completed\'. 0 casing issues. Values: Completed, In Progress, Not Started.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'flaf_issue_date',   issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: '(table)',           issue: 'No PK. ROW_NUMBER() deduplication.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]}
      ]
    },
    wroOhl: {
      title: 'OHL Readiness Status',
      desc: 'OHL completion funnel. ohl_done = overall_ohl_progr_100 >= 100 OR ohl_completion_date non-empty. Verified: 0 cast failures on ohl_progress, 0 whitespace-only ohl_completion_date. FLAF uses flaf_issue_date (0 cast failures).',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',         issue: '2,318 rows with NULL/empty excluded — invisible to Original Plan.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Function',   issue: 'Case-sensitive NOT IN. 0 casing inconsistencies.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: '(table)',         issue: 'No PK. GROUP BY Well_ID + MIN deduplicates.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR', issues: [
          { field: 'pdo_well_id',         issue: '0 null/empty — all rows valid.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',         issue: 'NVARCHAR — single TRY_CAST for snapshot dedup. 27,318 rows excluded (53%).', type: 'Data type',        severity: 'High',   affected: 27318, status: 'In progress' },
          { field: '[overall_ohl_progr_100]', issue: 'NVARCHAR — TRY_CAST to FLOAT >= 100. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'ohl_completion_date', issue: 'Non-empty = ohl_done. 0 whitespace-only values detected.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: 'flaf_issue_date',     issue: 'NVARCHAR — TRY_CAST to DATE. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: '(table)',             issue: 'No PK. ROW_NUMBER() deduplication.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]}
      ]
    },
    wroBuffer: {
      title: 'Buffer Location Readiness Status',
      desc: 'Buffer Location funnel. Plan = WMR wells joined to ProjectIDs (column2 LIKE \'%Location%\'). Verified: 0 null pdo_well_id, 0 project_id mismatches. scr_date has 5,663 cast failures affecting SCR exclusion logic.',
      tables: [
        { name: 'dbo.WMR', issues: [
          { field: 'pdo_well_id',       issue: '0 null/empty — all rows valid.', type: 'Null key',          severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',       issue: 'NVARCHAR — single TRY_CAST for ROW_NUMBER. 27,318 rows excluded from snapshot.', type: 'Data type',         severity: 'High',   affected: 27318, status: 'In progress' },
          { field: '[latest_exp.rig_on_location_sap_data]', issue: 'KPI deadline date. NVARCHAR — TRY_CAST to DATE. 0 cast failures.', type: 'Data type',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'scr_no, scr_date',  issue: 'scr_date NVARCHAR — TRY_CAST to DATE. 5,663 rows fail cast — SCR exclusion may not trigger for these wells.', type: 'Data type',         severity: 'High', affected: 5663, status: 'Open' },
          { field: 'actual_finish_date', issue: 'IS NOT NULL = completed. 0 whitespace-only values detected.', type: 'Standardisation',  severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'actual_pegged_date', issue: 'NVARCHAR — TRY_CAST to DATE for pegging delay calc.', type: 'Data type',         severity: 'Medium', affected: 0, status: 'Open' },
          { field: 'project_id',        issue: 'Joined to ProjectIDs. 0 unmatched, 0 null/empty.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Fixed' }
        ]},
        { name: 'AppMasterDB.dbo.ProjectIDs', issues: [
          { field: 'ID',      issue: 'All 19 IDs resolve correctly. 0 mismatches.', type: 'Data type',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'column2', issue: 'LIKE \'%Location%\' filter + cluster derivation. Only MARMUL, NIMR found.', type: 'Standardisation',  severity: 'Medium', affected: 0, status: 'Fixed' }
        ]}
      ]
    },
    pdoCommissioning: {
      title: 'PDO Commissioning Status',
      desc: 'ATNM wells ready for commissioning vs already commissioned (WellMonitoringReportOptimized: 688 rows, 0 null IDs). Commissioned (231) = actual_comm._finish_date IS NOT NULL. Not Commissioned (457). Clusters: Marmul, Nimr. 306 rows have actual_rig_off_date for date filtering. 396 rows have non-empty buffer_status (suspended).',
      tables: [
        { name: 'dbo.WellMonitoringReportOptimized', issues: [
          { field: 'pdo_well_id',   issue: '0 null/empty out of 688 rows — all wells have valid IDs.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'actual_rig_off_date', issue: 'NVARCHAR — TRY_CAST to DATE for date-range filtering. 306 rows have non-empty values, 0 cast failures.', type: 'Data type',    severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date', issue: 'NULL = Not Commissioned (457), non-NULL = Commissioned (231). 0 whitespace-only values — all non-NULL entries contain valid data.', type: 'Null semantics', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'buffer_status', issue: 'Non-empty = suspended. 292 NULL, 0 empty-string, 396 non-empty. No empty-string vs NULL inconsistency.', type: 'Standardisation', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: 'Cluster',       issue: 'Exact-match filter. Only 2 distinct values: Marmul, Nimr. 0 trailing spaces detected.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'overall_const._10_100', issue: 'NVARCHAR — not used in commissioning query directly. Related logic elsewhere uses TRY_CAST to FLOAT.', type: 'Data type',    severity: 'Low',    affected: 0, status: 'Open' }
        ]}
      ]
    },
    bufferFlowlines: {
      title: 'Buffer Flowlines Ready',
      desc: 'Flowline-completed wells by cluster (SAP: 20,500 rows → 18,182 with valid Well_ID → 8,040 distinct wells after function exclusions. WMR: 50,841 rows, 0 null IDs. ProjectIDs: 19 rows → 2 clusters: MARMUL, NIMR). Done = overall_const 100% OR fl_status = Completed OR const_complete_date populated.',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',       issue: '2,318 rows with NULL/empty Well_ID excluded. 18,182 valid rows remain. 8,040 distinct wells after function exclusions.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE for year-range filtering. 0 cast failures detected.', type: 'Data type',    severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Function', issue: 'NOT IN (Unspecified, RIG MOVE, RIG MAINTENANCE). 0 casing inconsistencies. Excluded values confirmed: RIG MAINTENANCE, RIG MOVE, Unspecified.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: '(table)',       issue: 'No PK — DISTINCT on Well_ID used for deduplication.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR (via WmrLatest CTE)', issues: [
          { field: 'pdo_well_id',   issue: '0 null/empty out of 50,841 rows — all wells have valid IDs.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',   issue: 'NVARCHAR — TRY_CAST + TRY_CONVERT(DATE, Week_Number, 5) combined. 0 rows fail both conversions — all valid week entries parse correctly.', type: 'Data type',    severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'overall_const._10_100', issue: 'NVARCHAR — TRY_CAST to FLOAT = 100 for flowline-done flag. 0 cast failures detected.', type: 'Data type',    severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'flow_line_const._status_in_progress_completed', issue: 'String comparison = \'Completed\'. Values found: Completed, In Progress, Not Started. 0 casing inconsistencies.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date', issue: 'Presence check (NOT NULL and not empty). 0 whitespace-only values detected.', type: 'Null semantics', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: 'project_id',    issue: 'Joined to ProjectIDs.ID (cast to NVARCHAR). 0 unmatched, 0 null/empty project_id values.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Fixed' }
        ]},
        { name: 'dbo.ProjectIDs', issues: [
          { field: 'ID',      issue: 'All 19 project IDs resolve correctly when CAST to NVARCHAR(100). 0 type mismatch issues.', type: 'Data type',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'column2', issue: 'First word uppercased = cluster name. Only 2 clusters: MARMUL, NIMR. 0 rows classified as Other.', type: 'Standardisation',  severity: 'Medium', affected: 0, status: 'Fixed' }
        ]}
      ]
    },
    constructionProgress: {
      title: 'Flowline & OHL Construction Progress',
      desc: 'Plan vs Actual construction completion (SAP: 20,500 rows → 1,200 planned 2026. WMR: 50,841 rows, 0 null IDs). Plan = SAP Earl_start_date in year, function exclusions. Completed = BOTH flowline AND OHL done. FLAF/SCR exclusions reduce plan. PDO issues (SSFD/IPM/MOC) further reduce clean target.',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',         issue: '2,318 rows with NULL/empty Well_ID excluded. 1,200 distinct wells planned for 2026 after function exclusions.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'Earl_start_date', issue: 'NVARCHAR — TRY_CAST to DATE for plan year filter + monthly grouping. 0 cast failures detected.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Function',   issue: 'NOT IN (Unspecified, RIG MOVE, RIG MAINTENANCE). 0 casing inconsistencies detected.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: '(table)',         issue: 'No PK. GROUP BY Well_ID with MIN(Earl_start_date) deduplicates per year.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR (latest per well)', issues: [
          { field: 'pdo_well_id',     issue: '0 null/empty out of 50,841 rows. LEFT JOIN to SAP — unmatched wells have fl_done=0, ohl_done=0.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Week_Number',     issue: 'NVARCHAR — COALESCE(TRY_CAST, TRY_CONVERT(DATE,5)) for ROW_NUMBER dedup. 0 rows fail both conversions.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: '[overall_const._10_100]', issue: 'NVARCHAR — TRY_CAST to FLOAT = 100 for flowline-done. 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: '[flow_line_const._status_in_progress_completed]', issue: 'Exact match = \'Completed\'. 0 casing inconsistencies. Values: Completed, In Progress, Not Started.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: '[overall_ohl_progr_100]', issue: 'NVARCHAR — TRY_CAST to FLOAT = 100 for OHL-done. 0 cast failures detected.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'ohl_completion_date', issue: 'Non-empty = OHL done. 0 whitespace-only values detected.', type: 'Null semantics', severity: 'Low',    affected: 0, status: 'Fixed' },
          { field: 'flaf_issue_date', issue: 'NVARCHAR — TRY_CAST to DATE for FLAF lead-time calc (< 90 days = excluded). 0 cast failures.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'scr_date',        issue: 'NVARCHAR — TRY_CAST to DATE for SCR exclusion calc. 5,663 rows have non-empty values that fail TRY_CAST to DATE.', type: 'Data type',        severity: 'High',   affected: 5663, status: 'Open' },
          { field: 'ssfd_wells / ipm / moc_raised / moc_approved', issue: 'Used for PDO-issue detection. 0 rows with ssfd_wells, 0 with ipm, 0 with moc_pending. Currently no PDO issues flagged.', type: 'Logic dependency', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'project_id',      issue: 'Used for cluster filtering. 0 unmatched project_id values detected.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Fixed' }
        ]}
      ]
    },
    workloadAnalysis: {
      title: 'Work Load Analysis',
      desc: 'Wells completed (actual) / planned (forecast) per month by cluster (SAP: 20,500 rows → 13,709 Development → 7,503 distinct wells after exclusions. WMR: 50,841 rows. ProjectIDs: 19 rows → 2 clusters: MARMUL, NIMR). Forecast cutoff = first day of current month.',
      tables: [
        { name: 'dbo.SAP_DRILLING_SEQUENCE_History', issues: [
          { field: 'Well_ID',         issue: '2,318 rows with NULL/empty Well_ID excluded — invisible to workload counts. Remaining 18,182 rows used.', type: 'Null key',         severity: 'High',   affected: 2318, status: 'Open' },
          { field: 'EarliestEndDate', issue: 'NVARCHAR — TRY_CAST to DATE for monthly grouping. 0 cast failures detected — all non-empty values are valid dates.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'Well_Category',   issue: 'Filtered = \'Development\' (13,709 of 18,182 rows). 0 casing inconsistencies — no rows lost to case mismatch.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Fixed' },
          { field: 'Well_Name',       issue: 'NOT LIKE \'RIG M%\' and NOT LIKE \'RAMADAN%\' excludes 10 rows from Development wells. 7,503 distinct wells remain after deduplication.', type: 'Standardisation', severity: 'Low',    affected: 10, status: 'Open' },
          { field: '(table)',         issue: 'No PK. GROUP BY Well_ID with MIN(EarliestEndDate) deduplicates 13,699 rows into 7,503 distinct wells.', type: 'PK missing',      severity: 'Low',    affected: 0, status: 'Open' }
        ]},
        { name: 'dbo.WMR', issues: [
          { field: 'pdo_well_id',                   issue: 'Joined to SAP Well_ID. 0 null/empty pdo_well_id in WMR — all 50,841 rows have valid IDs.', type: 'Null key',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'over_all_progress_percentages', issue: 'NVARCHAR — MAX(TRY_CAST AS FLOAT) per well. 0 cast failures, 0 null/empty values — all rows have valid numeric progress.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'project_id',                    issue: 'Joined to ProjectIDs for cluster derivation. 0 unmatched project_id values, 0 null/empty — all wells map to a cluster.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Fixed' }
        ]},
        { name: 'AppMasterDB.dbo.ProjectIDs', issues: [
          { field: 'ID',      issue: 'Joined to WMR.project_id. All 19 project IDs resolve correctly — 0 type mismatch issues.', type: 'Data type',         severity: 'High',   affected: 0, status: 'Fixed' },
          { field: 'column2', issue: 'First word uppercased = cluster name. Only 2 clusters found: MARMUL, NIMR. 0 rows classified as Other.', type: 'Standardisation',  severity: 'Medium', affected: 0, status: 'Fixed' }
        ]}
      ]
    },
    kpiTotalWells: {
      title: 'KPI – Total Wells',
      desc: 'Count of all wells in the system split into Active (rig on site) and Inactive (hold). ' +
            'Source: GET /dashboard/cluster-wells — joins dbo.ProjectIDs (master registry) with dbo.WMR (weekly snapshots). ' +
            'Cached 30 min. Active/Inactive split derives from WMR status fields.',
      tables: [
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID',      issue: 'Numeric ID — CAST to NVARCHAR(100) required to join WMR.project_id. Any mismatch causes project rows to be absent from the well count.', type: 'Data type',      severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Cluster', issue: 'LTRIM/RTRIM applied. Mixed casing between rows can cause the same cluster to appear with a different name in filters.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'pdo_well_id',  issue: 'NULL or empty pdo_well_id rows are excluded — these wells are invisible to the Total Wells count even if they have a valid ProjectIDs record.', type: 'Null key',   severity: 'High',   affected: 0, status: 'Open' },
            { field: 'project_id',   issue: 'NVARCHAR — joined to ProjectIDs.ID via CAST. Type or format mismatch silently orphans WMR wells and removes them from the count.', type: 'Data type',  severity: 'High',   affected: 0, status: 'Open' },
            { field: '(table)',      issue: 'No primary key — multiple snapshot rows per well. GROUP BY deduplicates. Inconsistent values (e.g. different well names) across rows lead to arbitrary display values.', type: 'PK missing', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    kpiCompletedWells: {
      title: 'KPI – Completed Wells',
      desc: 'Count of wells where over_all_progress_percentages >= 1.0 (100%) in the latest WMR snapshot row. ' +
            'Due Wells = wells whose planned end date has passed and are complete; Non-Due Wells = completed but not yet past deadline. ' +
            'Source: dbo.WMR deduplicated by ROW_NUMBER PARTITION BY pdo_well_id ORDER BY TRY_CAST(Week_Number AS DATE) DESC.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR — TRY_CAST to FLOAT. Completed threshold is >= 1.0. Non-numeric or fractional values (e.g. "0.85") default to 0 or a value < 1.0, excluding wells that are physically complete.', type: 'Data type',   severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'Week_Number',                  issue: 'NVARCHAR used for date ordering (ROW_NUMBER). Malformed Week_Number excludes the row from deduplication — an older (lower progress) row becomes the "latest", understating the completed count.', type: 'Data type',   severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'pdo_well_id',                  issue: 'NULL or empty rows excluded — completed wells without a pdo_well_id are invisible to this tile.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'exp.rig_off_location_sap_data', issue: 'Planned end date used to classify Due vs Non-Due. NVARCHAR — TRY_CAST to DATE. Cast failures cause the well to default to Non-Due, understating the Due Wells count.', type: 'Data type',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    kpiPenalty: {
      title: 'KPI – Penalty Exposure',
      desc: 'Total OMR penalty exposure for at-risk and critical wells. ' +
            'Computed from WMR schedule variance vs planned end date (exp.rig_off_location_sap_data). ' +
            'Penalty rate applied per well from a configured rate table or WMR penalty field.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'exp.rig_off_location_sap_data', issue: 'Column name contains a dot — must be quoted. NVARCHAR — TRY_CAST to DATE. Cast failures produce NULL planned end date; these wells are excluded from penalty calculation even if overdue.', type: 'Naming / Type', severity: 'High',   affected: 0, status: 'Open' },
            { field: 'over_all_progress_percentages', issue: 'Schedule variance = planned completion % (elapsed/duration) minus actual progress. Non-numeric actual progress defaults to 0, overstating variance and inflating penalty exposure.', type: 'Data type',   severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'actual_rig_on_date',            issue: 'NVARCHAR — TRY_CAST to DATE. Used as the start of the planned duration. Cast failure causes PlannedPct to be NULL — well treated as 0% planned, never classified as at-risk even if severely behind.', type: 'Data type',   severity: 'High',   affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                   issue: 'NULL or empty excluded — penalty from wells without a pdo_well_id is not captured.', type: 'Null key',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    kpiBonus: {
      title: 'KPI – Bonus Potential',
      desc: 'Total OMR bonus achievable if ahead-of-schedule wells maintain their trajectory. ' +
            'Ahead wells: actual variance > 0 (actual progress % exceeds planned %). ' +
            'Bonus rate applied per well from configured rate table. Source: dbo.WMR.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR — Non-numeric values become 0, so wells that are physically ahead may be classified as on-track or behind, understating bonus potential.', type: 'Data type',   severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'exp.rig_off_location_sap_data', issue: 'Planned end date used to compute planned %. Cast failures cause PlannedPct = NULL — well is never classified as ahead, reducing bonus count.', type: 'Naming / Type', severity: 'High',   affected: 0, status: 'Open' },
            { field: 'actual_rig_on_date',            issue: 'NVARCHAR — TRY_CAST to DATE. Required to compute elapsed days. Cast failure excludes the well from bonus consideration entirely.', type: 'Data type',   severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'pdo_well_id',                   issue: 'NULL or empty excluded — bonus from wells without a pdo_well_id is invisible.', type: 'Null key',   severity: 'Low',    affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    odcOverallStatus: {
      title: 'ODC Overall Status',
      desc: 'Donut / KPI strip showing well counts by status category (Total Drilled, Hook-Up Completed, Due Wells, Non-Due Wells, Drilled & Not Completed, Buffer Wells, Actual Non-Due Accelerated, Actual Due Completed, Suspended, Not Due PDO Issues, Ready for Commissioning). ' +
            'Source: GET /dashboard/odc-overall-status — driven by AW_WELLS (app-globals well cache), itself populated from dbo.WMR + dbo.ProjectIDs. Cached 30 min.',
      tables: [
        {
          name: 'dbo.WMR',
          issues: [
            { field: 'over_all_progress_percentages', issue: 'NVARCHAR — TRY_CAST to FLOAT. Completed threshold >= 1.0. Non-numeric values default to 0, misclassifying finished wells into the Drilled & Not Completed bucket and overstating backlog.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'Week_Number',                   issue: 'NVARCHAR used for ROW_NUMBER deduplication (latest snapshot per well). Malformed Week_Number excludes the row — an older row becomes "latest", potentially misclassifying well status.', type: 'Data type',      severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'pdo_well_id',                   issue: 'NULL or empty excluded from all ODC counts. Wells without a pdo_well_id are entirely invisible to this widget regardless of their physical status.', type: 'Null key',       severity: 'High',   affected: 0, status: 'Open' },
            { field: 'actual_rig_off_date',           issue: 'NVARCHAR — TRY_CAST to DATE. Used to detect rig departure (Hook-Up Completed). Cast failures leave completed wells in Drilled & Not Completed, overstating backlog.', type: 'Data type',      severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'exp.rig_off_location_sap_data', issue: 'Column name contains a dot. Used for Due Wells vs Non-Due classification. TRY_CAST failures produce NULL planned end date — the well defaults to Non-Due, understating Due Wells count.', type: 'Naming / Type', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'project_id',                    issue: 'NVARCHAR — joined to ProjectIDs.ID via CAST. Unmatched wells are excluded from cluster-scoped ODC counts when a cluster filter is applied.', type: 'FK / relationship', severity: 'Medium', affected: 0, status: 'Open' },
            { field: '(table)',                       issue: 'No primary key — multiple snapshot rows per well. ROW_NUMBER deduplication picks latest by Week_Number. A single bad high-value snapshot row can permanently move a well into the wrong category.', type: 'PK missing',   severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID',      issue: 'Numeric — CAST to NVARCHAR(100) to join WMR. Mismatch excludes the project\'s wells from all ODC category counts.', type: 'Data type',      severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Cluster', issue: 'LTRIM/RTRIM applied. Trailing-space cluster names cause filter mismatches — wells may be excluded from the cluster-filtered ODC view.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    wpaKpi: {
      title: 'KPI – Wells Planned vs. Actual',
      desc: 'Compares planned activities from the Vise Task Plan (dbo.ActivityTaskPlan) against actual field execution records (dbo.task_daily) for a given operational week. '
          + 'Activity codes are matched using LOWER(code) / LOWER(task_code). Well IDs are extracted from codes (e.g. FLME1520-27805 → 27805) and cast to INT for numeric matching. '
          + 'Source: GET /dashboard/cmd-readiness-kpi. Filtered by cluster/project via dbo.ProjectIDs lookup.',
      tables: [
        {
          name: 'dbo.task_daily',
          issues: [
            { field: 'well_id',    issue: 'Flooded with placeholder rows containing dummy values like 00000, 00001, or 0. These cannot match operational schedule codes (e.g. FLME1520-27805), falsely dropping the Executed Wells As Per Plan count. Query excludes via NOT IN filter.', type: 'Placeholder data', severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'task_code',  issue: 'Raw task_code strings contain unassigned template names (e.g. MSSF1200-00001-T03) that clog cross-table joins with the plan. Only rows matching FLME/FLCV/LCPC/LCCC prefixes are used.', type: 'Standardisation',  severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'well_id',    issue: 'Case-sensitivity and zero-padding mismatches — SQL treats "27805" and "0027805" as different entities. Query uses TRY_CAST(... AS INT) to normalize, but non-numeric well_id values silently become NULL.', type: 'Data type',        severity: 'Medium', affected: 0, status: 'In progress' },
            { field: 'url',        issue: 'Document upload compliance is derived from url IS NOT NULL AND url LIKE "http%". Empty or malformed URLs are not counted as uploaded documents.', type: 'Null semantics',   severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'ActionOn',   issue: 'DATE column used for date-range filtering. The query uses BETWEEN @ws AND @we (inclusive both ends) — @we is already end+1 day (exclusive), so one extra day may be included.', type: 'Logic concern',    severity: 'Low',    affected: 0, status: 'Open' },
            { field: 'committed_start', issue: 'Used for Schedule Alignment (PA) calculation via a subquery. Only rows where committed_start IS NOT NULL and well_id is valid are considered.', type: 'Completeness',     severity: 'Low',    affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ActivityTaskPlan',
          issues: [
            { field: 'code',       issue: 'Hard-filtered to 4 prefixes: FLME%, FLCV%, LCPC%, LCCC%. Activities with other code patterns (e.g. FLEI, FLCO, NSCV) are excluded from the plan count entirely.', type: 'Filter scope',     severity: 'High',   affected: 0, status: 'Open' },
            { field: 'code',       issue: 'Well ID is extracted from code by splitting on hyphen (CHARINDEX). Codes without a hyphen use the full code as well ID. Multi-hyphen codes (e.g. A-B-C) extract only the part after the first hyphen.', type: 'Parsing logic',    severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'qtyforacst', issue: 'Filtered with TRY_CAST(qtyforacst AS NUMERIC) <> 0 AND <> 0.00001. Rows with NULL, zero, or near-zero forecast quantities are excluded from the plan.', type: 'Business rule',    severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'progress',   issue: 'Filtered with TRY_CAST(progress AS DECIMAL) < 1.0. Activities at 100% completion are excluded from the plan — this is intentional but means completed-during-the-week activities are not counted.', type: 'Business rule',    severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'actual_start', issue: 'Used to split New vs In-Progress activities. NULL or date = 1900-01-01 = New; non-null valid date = In Progress. Invalid date strings are treated as NULL (new).', type: 'Data type',        severity: 'Low',    affected: 0, status: 'Open' },
            { field: 'Resume_Suspend', issue: 'Suspended activities excluded via UPPER(Resume_Suspend) NOT LIKE "%SUSPEND%". Mixed casing is handled by UPPER(). NULL or empty values pass through (not suspended).', type: 'Standardisation',  severity: 'Low',    affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID',        issue: 'CAST(ID AS NVARCHAR(100)) required to join with ActivityTaskPlan.project_id. Type mismatch silently drops projects from the filter, returning 0 results.', type: 'Data type',        severity: 'High',   affected: 0, status: 'Open' },
            { field: 'Type, Project', issue: 'Filter uses all 4 fields simultaneously (Cluster + Site + Type + Project). If wellType and project belong to different ProjectIDs rows, the subquery returns 0 GUIDs and all counts are 0.', type: 'Filter conflict',  severity: 'High',   affected: 0, status: 'In progress' },
            { field: 'Cluster, Site', issue: 'UPPER(LTRIM(RTRIM(CAST(... AS NVARCHAR(200))))) applied for case-insensitive comparison. Trailing spaces or encoding issues can still cause mismatches.', type: 'Standardisation',  severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    kpiCrewsDeployed: {
      title: 'KPI – Crews Deployed',
      desc: 'Count of crews with active task_daily entries in the selected date range. ' +
            'Deployed = crews with at least one task_daily row in range; Total = all distinct crew codes from task_daily. ' +
            'Unassigned = Total − Deployed. Source: dbo.task_daily grouped by crew_code, filtered by ActionOn date range.',
      tables: [
        {
          name: 'dbo.task_daily',
          issues: [
            { field: 'crew_code',  issue: 'NVARCHAR — legacy crew codes may not match current naming. Use OLD_NEW_CREW_MAPPING to normalize. Unmapped codes are counted as separate crews, overstating the total.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'ActionOn',   issue: 'DATE type (composite PK). Defines whether a crew was active on a given day. Missing daily entries for active crews understate the Deployed count.', type: 'Completeness',    severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'well_id',    issue: 'NVARCHAR — links crew activity to wells. NULL well_id rows are still counted for crew deployment (crew is active even without well assignment).', type: 'Null key',         severity: 'Low',    affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.OLD_NEW_CREW_MAPPING',
          issues: [
            { field: 'Old_Crew_Code',    issue: 'Legacy crew codes in task_daily that have no mapping row are treated as-is. If the same crew has both old and new codes without mapping, it appears as two crews.', type: 'Completeness', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'CREW_GROUP_CODE',   issue: 'Target code for normalization. Multiple old codes mapping to the same group code are correctly deduplicated.', type: 'Standardisation', severity: 'Low', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    hookupWaterfall: {
      title: 'Hook-Up Progress — Plan-to-Actual Waterfall',
      desc: 'Funnel: Original Plan → After FLAF/SCR Delays Removed → After PDO Issues Removed → Hook-Up Completed → Backlog. Source: dbo.WellMonitoringReport_Latest (one latest snapshot per well) joined to dbo.ProjectIDs to scope by well type (Conventional / Non-Standard / Well Conversions).',
      tables: [
        {
          name: 'dbo.WellMonitoringReport_Latest',
          issues: [
            { field: 'pdo_well_id',   issue: 'NULL/empty pdo_well_id rows are excluded — those wells are invisible to all waterfall counts.', type: 'Null key', severity: 'High', affected: 0, status: 'Open' },
            { field: 'project_id',   issue: 'NULL/empty project_id means the row cannot be joined to ProjectIDs — well type (Conventional/Non-Standard) cannot be determined and the well is dropped from all tabs.', type: 'Completeness', severity: 'High', affected: 0, status: 'Open' },
            { field: 'actual_rig_off_date', issue: 'NVARCHAR — TRY_CONVERT(DATE) required. Unparseable values become NULL and the well is excluded when a date-range filter is active.', type: 'Data type', severity: 'High', affected: 0, status: 'In progress' },
            { field: 'scr_no', issue: 'NULL/empty scr_no means the well is NOT classified as FLAF/SCR-delayed. If an SCR exists in reality but this field is blank, the well incorrectly remains in the "After FLAF/SCR" count.', type: 'Completeness', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'actual_eng._completion_date', issue: 'NULL = well classified as Not Hooked-Up. Missing value understates the Hook-Up Completed tile.', type: 'Completeness', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        },
        {
          name: 'dbo.ProjectIDs',
          issues: [
            { field: '[Type]',    issue: 'Unrecognised Type values (not Conventional Well / Non Standard Well / Well Conversion) silently exclude wells from all three hookup tabs.', type: 'Validity', severity: 'High', affected: 0, status: 'Open' },
            { field: '[ID]',     issue: 'Numeric ID must be CAST to NVARCHAR(50) to join with WellMonitoringReport_Latest.project_id — type mismatch causes silent row drops.', type: 'Data type', severity: 'High', affected: 0, status: 'Open' },
            { field: '[Cluster]', issue: 'Trailing spaces require LTRIM/RTRIM — cluster filter equality fails without trimming.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
    hookupDonut: {
      title: 'Overall Hook-Up % Completed',
      desc: 'Donut and breakdown: Hooked-up = wells with engineering completion date OR hookup completion date set. Backlog = clean-target wells not yet hooked up. Suspended = wells on hold. Source: same as waterfall (dbo.WellMonitoringReport_Latest + dbo.ProjectIDs).',
      tables: [
        {
          name: 'dbo.WellMonitoringReport_Latest',
          issues: [
            { field: 'actual_eng._completion_date / actual_comm._finish_date…', issue: 'Both fields checked for hookup completion (OR logic). If both are NULL the well is Backlog even if physically connected.', type: 'Completeness', severity: 'High', affected: 0, status: 'In progress' },
            { field: 'buffer_status / remark_status…', issue: 'PDO Issue classification uses buffer_status IN (\'PDO Issue\', \'On Hold\') OR remark LIKE \'%PDO%\'. Free-text remark variations may miss PDO issues; false-matches over-count PDO wells.', type: 'Standardisation', severity: 'Medium', affected: 0, status: 'Open' },
            { field: 'pdo_well_id', issue: 'NULL/empty pdo_well_id rows excluded from all % calculations, understating both numerator and denominator.', type: 'Null key', severity: 'Low', affected: 0, status: 'Open' }
          ]
        }
      ]
    },
  };

  openDqDrawer(key: string): void {
    const d = this.DQ_DATA[key];
    if (!d) return;
    this.dqDrawerTitle  = d.title;
    this.dqDrawerActiveKey = key;
    this.dqActiveTab    = 0;
    this.dqDrawerOpen   = true;

    const scoringNote =
      'Reliability is scored across 5 weighted dimensions: ' +
      'Completeness (30%) — critical fields are populated; ' +
      'Validity (20%) — values are in the correct format/range; ' +
      'Consistency (25%) — related fields agree, mixed formats flagged; ' +
      'Integrity (15%) — no duplicates, referential links hold; ' +
      'Freshness (10%) — data is recent. ' +
      'Each dimension is measured against live row counts queried from the database on every request.';

    if (this.DQ_API_MAP[key]) {
      // Use static description (richer context) + scoring methodology
      this.dqDrawerDesc   = d.desc + '\n\n' + scoringNote;
      this.dqDrawerTables = [];
      this.dqApiLoading   = true;
      this.loadDqApiTile(key).then(() => {
        this.dqApiLoading = false;
        const data = this.dqApiCache[key];
        if (data?.tables?.length) {
          this.dqDrawerTables = (data.tables as any[]).map(t => ({
            name:             t.table,
            totalRows:        t.totalRows,
            reliabilityScore: t.reliabilityScore,
            reliabilityLabel: t.reliabilityLabel,
            issues: (t.issues as any[] ?? []).map(iss => ({
              field:    iss.field,
              issue:    iss.description + (iss.affected > 0 ? ` (${iss.affected.toLocaleString()} affected)` : ''),
              type:     iss.dimension,
              severity: iss.severity as 'High' | 'Medium' | 'Low',
              affected: iss.affected,
              status:   iss.status as 'Open' | 'In progress' | 'Fixed'
            }))
          } as DqTable));
        } else {
          // API failed — fall back to static data
          this.dqDrawerTables = d.tables;
        }
      });
    } else {
      this.dqDrawerDesc   = d.desc + '\n\n' + scoringNote;
      this.dqDrawerTables = d.tables;
    }
  }

  closeDqDrawer(): void { this.dqDrawerOpen = false; }

  dqAvgReliability(key: string): number {
    if (this.dqApiScores[key] !== undefined) return this.dqApiScores[key];
    const d = this.DQ_DATA[key];
    if (!d || !d.tables.length) return 0;
    const scores = d.tables.map(t => this.dqRelPct(t));
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  dqAvgRelClass(key: string): string {
    const r = this.dqAvgReliability(key);
    return r >= 80 ? 'rel-high' : r >= 65 ? 'rel-med' : 'rel-low';
  }

  dqRelPct(t: DqTable): number {
    // If the API provided a direct score, use it.
    if (t.reliabilityScore !== undefined) return Math.round(t.reliabilityScore);
    // Weights: High=18pts, Medium=10pts, Low=4pts. Floor of 20 ensures no widget reads 0%.
    const SEVW: Record<string, number> = { High: 18, Medium: 10, Low: 4 };
    const penalty = t.issues.filter(i => i.status !== 'Fixed').reduce((s, i) => s + (SEVW[i.severity] ?? 6), 0);
    return Math.max(20, Math.min(100, 100 - penalty));
  }

  /** Overall reliability score (0-100) across all tables for a DQ_DATA key. */
  dqKeyScore(key: string): number {
    // Prefer live API score when available
    if (this.dqApiScores[key] !== undefined) return this.dqApiScores[key];
    const d = this.DQ_DATA[key];
    if (!d || !d.tables.length) return 100;
    const avg = d.tables.reduce((s, t) => s + this.dqRelPct(t), 0) / d.tables.length;
    return Math.round(avg);
  }

  /** CSS colour for a key-level reliability score badge. */
  dqKeyScoreColor(key: string): string {
    const r = this.dqKeyScore(key);
    return r >= 90 ? '#2e9e5b' : r >= 70 ? '#f5a623' : '#d9534f';
  }
  dqRelClass(t: DqTable): string {
    const r = this.dqRelPct(t);
    return r >= 80 ? 'rel-high' : r >= 65 ? 'rel-med' : 'rel-low';
  }
  dqRelLabel(t: DqTable): string {
    const r = this.dqRelPct(t);
    const label = t.reliabilityLabel ?? (r >= 80 ? 'Trusted' : r >= 65 ? 'Good' : r >= 40 ? 'Fair' : 'Poor');
    return label + ' · ' + r + '%';
  }
  dqRelColor(t: DqTable): string {
    const r = this.dqRelPct(t);
    return r >= 80 ? '#2e9e5b' : r >= 65 ? '#f5a623' : r >= 40 ? '#e07c24' : '#d9534f';
  }
  /** Average DQ reliability % across all tables for a given DQ_DATA key. Used by badge buttons. */
  dqOverallPct(key: string): number {
    const d = this.DQ_DATA[key];
    if (!d || !d.tables.length) return 20;
    const avg = d.tables.reduce((s, t) => s + this.dqRelPct(t), 0) / d.tables.length;
    return Math.round(Math.max(20, avg));
  }
  dqStatusClass(status: string): string {
    if (status === 'Fixed')       return 'dq-st-fixed';
    if (status === 'In progress') return 'dq-st-prog';
    return 'dq-st-open';
  }

  dqExportCsv(): void {
    const rows: string[][] = [['Table', 'Field(s)', 'Issue Description', 'Issue Type', 'Severity', 'Status']];
    this.dqDrawerTables.forEach(t =>
      t.issues.forEach(i => rows.push([t.name, i.field, i.issue, i.type, i.severity, i.status]))
    );
    // Wrap every cell in double-quotes; escape any internal double-quotes by doubling them
    const csv = rows.map(r => r.map(c => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\r\n');
    // Prepend UTF-8 BOM (\uFEFF) so Excel opens the file with correct encoding
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.dqDrawerTitle.replace(/[^a-z0-9]+/gi, '_') + '_data_quality.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  // ── /Data-Quality Drawer ─────────────────────────────────────────────────

  /** Opens the DQ drawer for the currently active Wells Readiness tab. */
  readonly WRO_DQ_MAP: Record<string, string> = {
    overall1: 'wroOverall',
    flowline: 'wroFlowline',
    ohl: 'wroOhl',
    buffer: 'wroBuffer'
  };

  openWroDqDrawer(): void {
    const key = this.WRO_DQ_MAP[this.wroScope] || 'wroOverall';
    this.openDqDrawer(key);
  }

  // --- Plan-to-Actual funnel data (loaded from API) ---
  funnelOriginalPlan = 0;
  funnelFlaf = 0;
  funnelPdo = 0;
  funnelActual = 0;
  @ViewChild('funnelChartContainer') funnelChartContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('cmdFunnelWaterfall')   cmdFunnelWaterfallRef?: ElementRef<HTMLDivElement>;
  /** Both Conventional + Non-Standard sections share the #hookupWaterfallChart template ref. */
  @ViewChildren('hookupWaterfallChart') hookupWaterfallRefs?: QueryList<ElementRef<HTMLDivElement>>;
  /** Both Conventional + Non-Standard sections share the #hookupCommDonut template ref. */
  @ViewChildren('hookupCommDonut') hookupCommDonutRefs?: QueryList<ElementRef<HTMLDivElement>>;
  private funnelChart: any = null;
  private cmdFunnelWaterfallChart: any = null;
  private hookupWaterfallCharts: any[] = [];
  private hookupCommDonutCharts: any[] = [];
  wellsReadinessData: WellsReadiness | null = null;
  isOdcLoading = true;
  isWrLoading = false;
  wrAsOfDate: string = new Date().toISOString().slice(0, 10);
  today: string = new Date().toISOString().slice(0, 10);
  /** Wells Readiness Overall Status — scope tab (Overall / Flowline / OHL / Buffer Location). */
  wroScope: 'overall' | 'overall1' | 'flowline' | 'ohl' | 'buffer' = 'overall1';
  setWroScope(s: 'overall' | 'overall1' | 'flowline' | 'ohl' | 'buffer'): void {
    this.wroScope = s;
    if (s === 'overall' && this.funnelOriginalPlan === 0) {
      this.fetchWellsReadiness();
    }
  }
  private wellsReadinessSub?: Subscription;

  // --- PDO Commissioning Status widget ---
  commData: CommissioningStatus | null = null;
  isCommLoading = true;
  commSelectedSegment: 'commissioned' | 'notCommissioned' | null = null;
  private commSub?: Subscription;

  onCommSegmentClick(segment: 'commissioned' | 'notCommissioned'): void {
    this.commSelectedSegment = this.commSelectedSegment === segment ? null : segment;
    // Navigate to All Wells page with the commissioning filter applied.
    // Pass the same date range used by the widget so counts match exactly.
    const f = this.dashboardService.currentFilter;
    (globalThis as any).__awPendingCommStatus = segment;
    (globalThis as any).__awPendingCommFrom = f.startDate || this.getLast60DaysFrom();
    (globalThis as any).__awPendingCommTo = f.endDate || this.getDefaultTo();
    this.router.navigate(['/allwells']);
  }

  // --- Buffer Flowlines Ready widget ---
  bufferData: BufferFlowlinesReady | null = null;
  isBufferLoading = true;
  private bufferSub?: Subscription;

  // --- Construction Progress (Flowline & OHL) widget ---
  cprogData: ConstructionProgressResponse | null = null;
  isCprogLoading = true;
  cprogHidden: boolean[] = [false, false, false, false, false, false];
  private cprogSub?: Subscription;
  private cprogChart: any = null;

  // --- Commissioning Progress widget ---
  commProgData: CommissioningProgressResponse | null = null;
  isCommProgLoading = true;
  private commProgSub?: Subscription;
  private commProgChart: any = null;

  // --- Well Hookup KPI tiles (Non-Standard) ---
  hwpNs:        WellHookupKpi      | null = null;

  // --- Non-Standard Hookup panels ---
  nsWaterfall:  NsHookupWaterfall  | null = null;
  nsCompletion: NsHookupCompletion | null = null;
  nsBreakdown:  NsHookupBreakdown  | null = null;

  // --- Well Hookup Progress widget (Conventional) ---
  hookupProgressData: HookupProgressResponse | null = null;
  isHookupProgressLoading = true;   // start true so the loader shows before the first fetch resolves
  private hookupProgressSub?: Subscription;

  // --- Buffer Location Construction Progress widget ---
  blcpData: BufferLocationProgressResponse | null = null;
  isBlcpLoading = true;
  private blcpSub?: Subscription;

  // Donut SVG: circumference 2π×56 ≈ 351.9; green arc = accelerated / (accelerated + |backlog|)
  get blcpDonutGreen(): string {
    if (!this.blcpData) return '0 351.9';
    const k = this.blcpData.kpi;
    const total = k.accelerated + Math.abs(k.backlog);
    if (total === 0) return '0 351.9';
    const arc = Math.round((k.accelerated / total) * 351.9);
    return `${arc} 351.9`;
  }

  // SVG bar height helpers (chart viewBox height = 300px, y-baseline = 300)
  private blcpBarH(val: number, maxVal: number): number {
    return maxVal > 0 ? Math.round((val / maxVal) * 280) : 0;
  }

  get blcpChartBars(): { h1: number; h2: number; h3: number; hDue: number; hAccel: number; svY: number; svLabel: string } {
    if (!this.blcpData) return { h1: 0, h2: 0, h3: 0, hDue: 0, hAccel: 0, svY: 300, svLabel: '0' };
    const k = this.blcpData.kpi;
    const max = Math.max(k.rigSequencePlan, k.afterPeggingScr, k.cleanTarget, k.actualCompleted, 1);
    const maxCeil = Math.ceil(max / 10) * 10;
    const h1    = this.blcpBarH(k.rigSequencePlan, maxCeil);
    const h2    = this.blcpBarH(k.afterPeggingScr, maxCeil);
    const h3    = this.blcpBarH(k.cleanTarget,     maxCeil);
    const hDue  = this.blcpBarH(k.dueWellsCompleted, maxCeil);
    const hAccel = this.blcpBarH(k.accelerated, maxCeil);
    const sv    = k.scheduleVariance;
    const svY   = 300 - (sv >= 0 ? this.blcpBarH(sv, maxCeil) : 0);
    const svLabel = sv >= 0 ? `+${sv}` : `${sv}`;
    return { h1, h2, h3, hDue, hAccel, svY, svLabel };
  }

  // --- Pegging Status (Construction Well Delivery) widget ---
  peggingData: PeggingStatusResponse | null = null;
  isPeggingLoading = true;
  private peggingSub?: Subscription;
  peggingGaugeRotation = -90;
  peggingChartPaths: {
    plan: string; actual: string; gap: string;
    planLine: string; actualLine: string;
    planPoints: { x: number; y: number; val: number }[];
    actualPoints: { x: number; y: number; val: number }[];
    yTicks: { y: number; label: string }[];
    todayX: number;
  } = { plan: '', actual: '', gap: '', planLine: '', actualLine: '',
    planPoints: [], actualPoints: [], yTicks: [], todayX: 372 };

  // --- FLAF Status (Construction Well Delivery) widget ---
  flafData: FlafStatusResponse | null = null;
  isFlafLoading = true;
  private flafSub?: Subscription;
  flafGaugeRotation = -90;

  // --- Overall Pegging Status (pie: pegging completed <90d / >90d before rig-on) ---
  overallPeggingData: OverallPeggingStatus | null = null;
  isOverallPeggingLoading = true;
  private overallPeggingSub?: Subscription;
  private overallPeggingChart: any = null;

  // Donut SVG: circumference = 2π×72 ≈ 452.4
  get commDonutGreen(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    return `${Math.round(pct * 452)} 452`;
  }
  get commDonutOrange(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    const green = Math.round(pct * 452);
    return `${452 - green} 452`;
  }
  get commDonutOrangeOffset(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    return `-${Math.round(pct * 452)}`;
  }
  // Gauge SVG: arc length ≈ 251
  get commGaugeGreen(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    return `${Math.round(pct * 251)} 300`;
  }
  get commGaugeOrange(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    const green = Math.round(pct * 251);
    return `${251 - green} 300`;
  }
  get commGaugeOrangeOffset(): string {
    const pct = this.commData ? this.commData.readinessPct / 100 : 0;
    return `-${Math.round(pct * 251)}`;
  }
  get commAsOfFormatted(): string {
    if (!this.commData) return '';
    const d = new Date(this.commData.asOfDate + 'T10:30:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', 10:30 AM';
  }

  get funnelPoints(): { blue: string; orange: string; yellow: string; green: string } {
    const empty = { blue: '', orange: '', yellow: '', green: '' };
    if (this.funnelOriginalPlan === 0) return empty;

    const W = 440, cx = 220;
    const ref = this.funnelOriginalPlan;
    const hw = (v: number) => Math.round(Math.min(v / ref, 1) * W / 2);
    const r = 10; // corner radius

    // Band Y positions (4 bands with 6px gaps)
    const y0 = 0, y1 = 78;
    const y2 = 84, y3 = 162;
    const y4 = 168, y5 = 246;
    const y6 = 252, y7 = 330;

    // Half-widths at each junction
    const hwTop = hw(this.funnelOriginalPlan);
    const hwF = hw(this.funnelFlaf);
    const hwP = hw(this.funnelPdo);
    const hwA = hw(this.funnelActual);

    const band = (topY: number, botY: number, topHW: number, botHW: number): string => {
      const tl = cx - topHW, tr = cx + topHW;
      const bl = cx - botHW, br = cx + botHW;
      const cr = Math.min(r, topHW, (botY - topY) / 2);
      return `M ${tl + cr} ${topY} L ${tr - cr} ${topY} Q ${tr} ${topY} ${tr} ${topY + cr} L ${br} ${botY} L ${bl} ${botY} L ${tl} ${topY + cr} Q ${tl} ${topY} ${tl + cr} ${topY} Z`;
    };

    return {
      blue:   band(y0, y1, hwTop, hwF),
      orange: band(y2, y3, hwF, hwP),
      yellow: band(y4, y5, hwP, hwP),
      green:  band(y6, y7, hwP, hwA)
    };
  }

  get funnelFlafExcluded(): number { return this.funnelOriginalPlan - this.funnelFlaf; }
  get funnelPdoExcluded(): number  { return this.funnelFlaf - this.funnelPdo; }
  get funnelActualVsClean(): number { return this.funnelActual - this.funnelPdo; }
  get funnelActualAboveClean(): boolean { return this.funnelActual >= this.funnelPdo; }
  get funnelAtnmPct(): string { return (this.funnelActual / this.funnelPdo * 100).toFixed(1); }
  get funnelCompletionVsFlaf(): string { return (this.funnelActual / this.funnelFlaf * 100).toFixed(1); }

  /** Plan to Actual — Highcharts waterfall on the Overall scope tab. */
  private renderCmdFunnelWaterfall(): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.cmdFunnelWaterfallRef?.nativeElement;
    if (!Highcharts || !el) return;
    if (this.cmdFunnelWaterfallChart) { try { this.cmdFunnelWaterfallChart.destroy(); } catch (_) {} }

    const flafLoss = this.funnelOriginalPlan - this.funnelFlaf;
    const pdoLoss  = this.funnelFlaf - this.funnelPdo;

    this.cmdFunnelWaterfallChart = Highcharts.chart(el, this.buildWaterfallConfig(
      this.funnelOriginalPlan, flafLoss, pdoLoss, this.funnelActual
    ));
  }

  /** Per-tab waterfall datasets — same order as the three #hookupWaterfallChart
   *  template refs (Conventional, Non Standard, Well Conversions). */
  private hookupWaterfallData: Array<{ plan: number; flafLoss: number; pdoLoss: number; actual: number }> = [
    { plan: 5, flafLoss: 2, pdoLoss: 1, actual: 3 },   // Conventional
    { plan: 8, flafLoss: 3, pdoLoss: 1, actual: 4 },   // Non Standard
    { plan: 4, flafLoss: 1, pdoLoss: 1, actual: 2 }    // Well Conversions
  ];

  /** Available chart styles for the Plan-to-Actual chart picker. */
  hookupChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'waterfall', label: 'Waterfall' },
    { value: 'column',    label: 'Column' },
    { value: 'bar',       label: 'Bar' },
    { value: 'line',      label: 'Line' },
    { value: 'spline',    label: 'Spline' },
    { value: 'area',      label: 'Area' }
  ];
  /** Per-panel selected chart type (Conventional / Non Standard / Well Conversions). */
  hookupChartTypes: string[] = ['waterfall', 'waterfall', 'waterfall'];

  /** Change chart style for a specific panel, then re-render just that chart. */
  onHookupChartTypeChange(idx: number, value: string): void {
    this.hookupChartTypes[idx] = value;
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.hookupWaterfallRefs) return;
    const refsArr = this.hookupWaterfallRefs.toArray();
    const ref = refsArr[idx];
    if (!ref) return;
    if (this.hookupWaterfallCharts[idx]) {
      try { this.hookupWaterfallCharts[idx].destroy(); } catch (_) {}
    }
    const d = this.hookupWaterfallData[idx] || this.hookupWaterfallData[0];
    this.hookupWaterfallCharts[idx] = Highcharts.chart(
      ref.nativeElement,
      this.buildWaterfallConfig(d.plan, d.flafLoss, d.pdoLoss, d.actual, value)
    );
  }

  /** Plan to Actual — Highcharts waterfall (one per Hookup tab). */
  private renderHookupWaterfalls(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.hookupWaterfallRefs) return;
    this.hookupWaterfallCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    this.hookupWaterfallCharts = [];
    this.hookupWaterfallRefs.forEach((ref, idx) => {
      const el = ref.nativeElement;
      if (!el) return;
      const d = this.hookupWaterfallData[idx] || this.hookupWaterfallData[0];
      const type = this.hookupChartTypes[idx] || 'waterfall';
      const chart = Highcharts.chart(el, this.buildWaterfallConfig(d.plan, d.flafLoss, d.pdoLoss, d.actual, type));
      this.hookupWaterfallCharts.push(chart);
    });
  }

  /** Per-tab donut percentages — same order as the three #hookupCommDonut refs. */
  private hookupCommDonutPct: number[] = [
    13.0,   // Conventional
    17.8,   // Non Standard
    19.5    // Well Conversions
  ];

  /** Per-panel selected chart type for the Hookup Commissioning donut. */
  hookupCommChartTypes: string[] = ['pie', 'pie', 'pie'];
  hookupCommChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'pie',       label: 'Donut' },
    { value: 'pie-solid', label: 'Pie' },
    { value: 'column',    label: 'Column' },
    { value: 'bar',       label: 'Bar' }
  ];

  onHookupCommChartTypeChange(idx: number, value: string): void {
    this.hookupCommChartTypes[idx] = value;
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.hookupCommDonutRefs) return;
    const refsArr = this.hookupCommDonutRefs.toArray();
    const ref = refsArr[idx];
    if (!ref) return;
    if (this.hookupCommDonutCharts[idx]) {
      try { this.hookupCommDonutCharts[idx].destroy(); } catch (_) {}
    }
    this.hookupCommDonutCharts[idx] = Highcharts.chart(ref.nativeElement, this.buildHookupCommConfig(idx, value));
  }

  private buildHookupCommConfig(idx: number, chartType: string): any {
    const arcColor   = '#29378d';
    const trackColor = '#DDEEFF';
    const pct = this.hookupCommDonutPct[idx] ?? this.hookupCommDonutPct[0];
    const isPie = chartType === 'pie' || chartType === 'pie-solid';
    if (isPie) {
      return {
        chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4], height: 160 },
        title: {
          text: pct.toFixed(1) + '%',
          align: 'center',
          verticalAlign: 'middle',
          y: 8,
          style: { color: arcColor, fontSize: '22px', fontWeight: '800' }
        },
        credits: { enabled: false },
        legend:  { enabled: false },
        tooltip: { pointFormat: '<b>{point.y:.1f}%</b>' },
        plotOptions: {
          pie: {
            innerSize: chartType === 'pie-solid' ? '0%' : '78%',
            borderWidth: 0,
            startAngle: 0,
            dataLabels: { enabled: false }
          }
        },
        series: [{
          name: 'Commissioning',
          data: [
            { name: 'Completed', y: pct,       color: arcColor   },
            { name: 'Remaining', y: 100 - pct, color: trackColor }
          ]
        }]
      };
    }
    return {
      chart: { type: chartType, backgroundColor: 'transparent', spacing: [10, 10, 10, 10], height: 160 },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: ['Completed', 'Remaining'],
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)',
        tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        min: 0, max: 100,
        title: { text: undefined },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' }, format: '{value}%' }
      },
      tooltip: { pointFormat: '<b>{point.y:.1f}%</b>' },
      plotOptions: {
        series: {
          borderWidth: 0,
          borderRadius: 4,
          dataLabels: {
            enabled: true,
            formatter: function(this: any) { return this.point.y.toFixed(1) + '%'; },
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
          }
        }
      },
      series: [{
        name: 'Commissioning',
        data: [
          { y: pct,        color: arcColor   },
          { y: 100 - pct,  color: trackColor }
        ]
      }]
    };
  }

  /** Overall Commissioning % Completed — Highcharts pie donut (one per Hookup tab). */
  private renderHookupCommDonuts(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.hookupCommDonutRefs) return;
    this.hookupCommDonutCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    this.hookupCommDonutCharts = [];
    this.hookupCommDonutRefs.forEach((ref, idx) => {
      const el = ref.nativeElement;
      if (!el) return;
      const type = this.hookupCommChartTypes[idx] || 'pie';
      const chart = Highcharts.chart(el, this.buildHookupCommConfig(idx, type));
      this.hookupCommDonutCharts.push(chart);
    });
  }

  // ── Well Delivery Cycle Time widget ──────────────────────────────────
  // Populated from /dashboard/well-delivery-cycle-time (real WMR dates). Defaults are empty
  // until the API responds.
  wdctKpi = {
    avgDays: 0, avgDelta: 0, avgDeltaPct: 0,
    medianDays: 0, medianDelta: 0, medianDeltaPct: 0,
    minDays: 0, minWell: '—',
    maxDays: 0, maxWell: '—',
    wellsCompleted: 0, wellsDelta: 0
  };
  wdctTrendMonths: string[] = [];
  wdctTrendAvg: number[]    = [];
  wdctTrendMedian: number[] = [];
  wdctPhases: Array<{ name: string; days: number; pct: number; color: string }> = [];
  /** Phase → colour map (phases come from the API as Drilling / Construction / Commissioning). */
  private readonly wdctPhaseColors: Record<string, string> = {
    'Drilling':      '#29378d',
    'Construction':  '#00B050',
    'Commissioning': '#F59E0B',
    'Testing':       '#8B5CF6',
    'Other / NPT':   '#9CA3AF'
  };
  private wdctSub?: Subscription;
  /** True while a Well Delivery Cycle Time fetch is in flight — gates the loader overlay. */
  isWdctLoading = true;
  wdctTrendChartType: 'line' | 'spline' | 'area' | 'column' = 'spline';
  wdctPhaseChartType: 'donut' | 'pie' | 'column' | 'bar' = 'donut';
  private wdctTrendChart: any = null;
  private wdctPhaseChart: any = null;

  onWdctTrendChartTypeChange(v: string): void { this.wdctTrendChartType = v as any; this.renderWdctTrend(); }
  onWdctPhaseChartTypeChange(v: string): void { this.wdctPhaseChartType = v as any; this.renderWdctPhase(); }

  /** Fetch real Well Delivery Cycle Time data and refresh the KPIs/trend/phase charts. */
  fetchWellDeliveryCycleTime(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; from?: string; to?: string }): void {
    this.isWdctLoading = true;
    this.wdctSub?.unsubscribe();
    this.wdctSub = this.dashboardService.getWellDeliveryCycleTime({
      cluster:  filters?.cluster  || undefined,
      site:     filters?.site     || undefined,
      project:  filters?.project  || undefined,
      wellType: filters?.wellType || undefined,
      from:     filters?.from     || undefined,
      to:       filters?.to       || undefined,
    }).subscribe({
      next: (d: WellDeliveryCycleTime) => {
        this.isWdctLoading = false;
        this.wdctKpi = {
          avgDays: d.avgDays, avgDelta: Math.abs(d.avgDelta), avgDeltaPct: Math.abs(d.avgDeltaPct),
          medianDays: d.medianDays, medianDelta: Math.abs(d.medianDelta), medianDeltaPct: Math.abs(d.medianDeltaPct),
          minDays: d.minDays, minWell: d.minWell || '—',
          maxDays: d.maxDays, maxWell: d.maxWell || '—',
          wellsCompleted: d.wellsCompleted, wellsDelta: d.wellsDelta
        };
        this.wdctTrendMonths  = (d.trend || []).map(p => p.month);
        this.wdctTrendAvg     = (d.trend || []).map(p => p.avgDays);
        this.wdctTrendMedian  = (d.trend || []).map(p => p.medianDays);
        this.wdctPhases = (d.phases || []).map(p => ({
          name: p.name, days: p.days, pct: p.pct,
          color: this.wdctPhaseColors[p.name] || '#9CA3AF'
        }));
        setTimeout(() => { this.renderWdctTrend(); this.renderWdctPhase(); }, 0);
      },
      error: (err) => {
        this.isWdctLoading = false;
        console.warn('[cmdoverview] well-delivery-cycle-time API error:', err.message || err);
      }
    });
  }

  private renderWdctTrend(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('wdctTrendHc');
    if (!Highcharts || !el) return;
    if (this.wdctTrendChart) { try { this.wdctTrendChart.destroy(); } catch (_) {} }
    const t = this.wdctTrendChartType || 'spline';
    this.wdctTrendChart = Highcharts.chart(el, {
      chart: { type: t === 'area' ? 'area' : t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '9pt' }, symbolHeight: 8 },
      xAxis: { categories: this.wdctTrendMonths, lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)', labels: { style: { fontSize: '8.5pt' } } },
      yAxis: { title: { text: 'Days', style: { fontSize: '9pt' } }, gridLineColor: 'rgba(0,0,0,0.06)', labels: { style: { fontSize: '8.5pt' } } },
      tooltip: { shared: true, valueSuffix: ' days' },
      plotOptions: {
        series: {
          marker: { enabled: t !== 'column', radius: 4 },
          fillOpacity: t === 'area' ? 0.25 : undefined,
          borderRadius: t === 'column' ? 4 : 0,
          borderWidth: 0,
          dataLabels: {
            enabled: t !== 'column',
            style: { fontSize: '8pt', fontWeight: '700', textOutline: 'none' }
          }
        }
      },
      series: [
        { name: 'Average Cycle Time (days)', data: this.wdctTrendAvg,    color: '#29378d' },
        { name: 'Median Cycle Time (days)',  data: this.wdctTrendMedian, color: '#60A5FA', dashStyle: 'Dash' }
      ]
    });
  }

  private renderWdctPhase(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('wdctPhaseHc');
    if (!Highcharts || !el) return;
    if (this.wdctPhaseChart) { try { this.wdctPhaseChart.destroy(); } catch (_) {} }
    const t = this.wdctPhaseChartType || 'donut';
    const total = this.wdctPhases.reduce((s, p) => s + p.days, 0);
    if (t === 'donut' || t === 'pie') {
      this.wdctPhaseChart = Highcharts.chart(el, {
        chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
        title: {
          text: '<div style="text-align:center"><div style="font-size:8.5pt;color:#888;font-weight:600">Total</div>'
              + '<div style="font-size:18pt;font-weight:800;color:#1a1a2e;line-height:1">' + total.toFixed(1) + '</div>'
              + '<div style="font-size:8.5pt;color:#888;font-weight:500">days</div></div>',
          useHTML: true,
          align: 'center', verticalAlign: 'middle', y: -4
        },
        credits: { enabled: false },
        legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> days ({point.percentage:.1f}%)' },
        plotOptions: {
          pie: {
            innerSize: t === 'donut' ? '60%' : '0%',
            borderWidth: 2, borderColor: '#fff',
            dataLabels: { enabled: false }
          }
        },
        series: [{
          name: 'Days',
          data: this.wdctPhases.map(p => ({ name: p.name, y: p.days, color: p.color }))
        }]
      });
    } else {
      this.wdctPhaseChart = Highcharts.chart(el, {
        chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: this.wdctPhases.map(p => p.name), labels: { style: { fontSize: '8.5pt' } }, lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)' },
        yAxis: { title: { text: 'Days', style: { fontSize: '9pt' } }, gridLineColor: 'rgba(0,0,0,0.06)', labels: { style: { fontSize: '8.5pt' } } },
        tooltip: { pointFormat: '<b>{point.y}</b> days' },
        plotOptions: {
          series: {
            borderWidth: 0, borderRadius: 4,
            dataLabels: { enabled: true, style: { fontSize: '8pt', fontWeight: '700', textOutline: 'none' } }
          }
        },
        series: [{
          name: 'Days',
          colorByPoint: true,
          data: this.wdctPhases.map(p => ({ y: p.days, color: p.color }))
        }]
      });
    }
  }

  // ─── Wells – Planned vs. Actual (bottom section) ──────────────────────────
  /** KPI values for the Wells – Planned vs. Actual section. */
  wpaKpi = {
    planned: 0,
    executedAsPlan: 0,
    executedNotAsPlan: 0,
    nonExecuted: 0,
    coveragePct: 0,
    targetPct: 100,
    // Activity Coverage
    totalActivitiesPlanned: 0,
    inProgressActivitiesPlanned: 0,
    newActivitiesPlanned: 0,
    totalExecutedAsPlanned: 0,
    inProgressExecutedAsPlanned: 0,
    newExecutedAsPlanned: 0,
    plannedActivityCoveragePct: 0,
    // Unplanned Activities
    totalActivitiesExecuted: 0,
    unplannedActivitiesExecuted: 0,
    unplannedActivitiesPct: 0,
    // Schedule Alignment
    newActivitiesScheduled: 0,
    newActivitiesCommitted: 0,
    scheduleAlignmentPct: 0,
    // Documents
    totalRequired: 0,
    totalSubmitted: 0,
    totalMissing: 0,
    docCompliancePct: 0
  };
  wpaLoading = true;
  private wpaSub?: Subscription;
  /** Wells Count Breakdown chart toggle — absolute counts vs % of planned. */
  wpaBreakdownMode: 'count' | 'pct' = 'count';
  /** Chart-style pickers for the two Planned-vs-Actual charts. */
  wpaBreakdownChartType: 'column' | 'bar' | 'line' | 'spline' | 'area' = 'column';
  wpaCoverageChartType: 'donut' | 'pie' = 'donut';
  private wpaBreakdownChart: any = null;
  private wpaCoverageChart: any = null;
  private activityStackedChart: any = null;
  private activityDonutChart: any = null;

  onWpaBreakdownChartTypeChange(v: string): void { this.wpaBreakdownChartType = v as any; this.renderWpaBreakdown(); }
  onWpaCoverageChartTypeChange(v: string): void { this.wpaCoverageChartType = v as any; this.renderWpaCoverage(); }

  /** % of planned for a given count (planned itself is always 100%). */
  wpaPct(value: number): number {
    const p = this.wpaKpi.planned;
    return p > 0 ? Math.round((value / p) * 100) : 0;
  }

  setWpaBreakdownMode(mode: 'count' | 'pct'): void {
    if (this.wpaBreakdownMode === mode) return;
    this.wpaBreakdownMode = mode;
    this.renderWpaBreakdown();
  }

  /** Navigate to WPA drilldown page with the selected category filter. */
  navigateToWpaDrilldown(filter: 'planned' | 'executed_as_plan' | 'executed_not_as_plan' | 'non_executed' | 'documents'): void {
    this.router.navigate(['/wells-readiness-details'], { queryParams: { scope: 'wpa', filter } });
  }

  /** Navigate to activity drilldown page with the selected category. */
  navigateToActivityDrilldown(filter: 'total_planned' | 'in_progress' | 'new_planned' | 'executed' | 'unplanned' | 'scheduled' | 'committed'): void {
    this.router.navigate(['/wells-readiness-details'], { queryParams: { scope: 'activities', filter } });
  }

  /** Navigate to hookup drilldown page with the selected waterfall pill. */
  navigateToHookupDrilldown(pill: 'original_plan' | 'after_flaf_scr' | 'after_pdo_issues' | 'completed' | 'backlog'): void {
    this.router.navigate(['/hookup-drilldown'], { queryParams: { pill, wellType: this.hookupWellType() } });
  }

  /** Fetch Wells – Planned vs. Actual KPIs from cmd-readiness-kpi API. */
  fetchWpaKpi(filters?: { from?: string; to?: string; cluster?: string; site?: string; wellType?: string; project?: string; wellId?: string }): void {
    this.wpaSub?.unsubscribe();
    this.wpaLoading = true;
    this.wpaSub = this.dashboardService.getCmdReadinessKpi(filters).subscribe({
      next: (d: CmdReadinessKpi) => {
        this.wpaKpi = {
          planned: d.plannedWells,
          executedAsPlan: d.executedWellsAsPerPlan,
          executedNotAsPlan: d.unplannedWellsExecuted,
          nonExecuted: d.nonExecutedWellsAsPerPlan,
          coveragePct: Math.round(d.plannedWellCoveragePct),
          targetPct: 100,
          // Activity Coverage
          totalActivitiesPlanned: d.totalActivitiesPlanned,
          inProgressActivitiesPlanned: d.inProgressActivitiesPlanned,
          newActivitiesPlanned: d.newActivitiesPlanned,
          totalExecutedAsPlanned: d.totalExecutedAsPlanned,
          inProgressExecutedAsPlanned: d.inProgressExecutedAsPlanned,
          newExecutedAsPlanned: d.newExecutedAsPlanned,
          plannedActivityCoveragePct: Math.round(d.plannedActivityCoveragePct),
          // Unplanned Activities
          totalActivitiesExecuted: d.totalActivitiesExecuted,
          unplannedActivitiesExecuted: d.unplannedActivitiesExecuted,
          unplannedActivitiesPct: Math.round(d.unplannedActivitiesPct),
          // Schedule Alignment
          newActivitiesScheduled: d.newActivitiesScheduled,
          newActivitiesCommitted: d.newActivitiesCommitted,
          scheduleAlignmentPct: Math.round(d.scheduleAlignmentPct),
          // Documents
          totalRequired: d.totalRequiredDocuments,
          totalSubmitted: d.totalSubmittedDocuments,
          totalMissing: d.totalMissingDocuments,
          docCompliancePct: Math.round(d.documentCompliancePct)
        };
        this.wpaLoading = false;
        setTimeout(() => {
          this.renderWpaBreakdown();
          this.renderWpaCoverage();
          this.renderActivityStackedChart();
          this.renderActivityDonut();
        }, 0);
      },
      error: (err) => {
        this.wpaLoading = false;
        console.warn('[cmdoverview] cmd-readiness-kpi API error:', err.message || err);
      }
    });
  }

  /** Column chart: planned vs executed breakdown (counts or % of planned). */
  private renderWpaBreakdown(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('wpaBreakdownHc');
    if (!Highcharts || !el) return;
    if (this.wpaBreakdownChart) { try { this.wpaBreakdownChart.destroy(); } catch (_) {} }

    const k = this.wpaKpi;
    const isPct = this.wpaBreakdownMode === 'pct';
    const t = this.wpaBreakdownChartType || 'column';
    const isLineType = t === 'line' || t === 'spline' || t === 'area';
    const cats = ['Planned Wells', 'Executed as per Plan', 'Executed Not\nas per Plan', 'Non Executed\nas per Plan'];
    const colors = ['#29378d', '#00B050', '#ED7D31', '#FF0000'];
    const wpaFilters: Array<'planned' | 'executed_as_plan' | 'executed_not_as_plan' | 'non_executed'> = ['planned', 'executed_as_plan', 'executed_not_as_plan', 'non_executed'];
    const counts = [k.planned, k.executedAsPlan, k.executedNotAsPlan, k.nonExecuted];
    const data = counts.map((c, i) => ({
      y: isPct ? this.wpaPct(c) : c,
      color: colors[i]
    }));

    this.wpaBreakdownChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: cats,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: isPct ? '% of Planned' : 'Count', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' }, format: isPct ? '{value}%' : '{value}' },
        max: isPct ? 100 : undefined
      },
      tooltip: { pointFormat: isPct ? '<b>{point.y}%</b> of planned' : '<b>{point.y}</b> wells' },
      plotOptions: {
        series: {
          borderWidth: 0, borderRadius: isLineType ? 0 : 4,
          fillOpacity: t === 'area' ? 0.25 : undefined,
          marker: { enabled: isLineType, radius: 4 },
          cursor: 'pointer',
          point: { events: { click: (e: any) => { this.navigateToWpaDrilldown(wpaFilters[e.point.index]); } } },
          dataLabels: {
            enabled: true,
            format: isPct ? '{point.y}%' : '{point.y}',
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
          }
        }
      },
      series: [{ name: isPct ? '% of Planned' : 'Count', colorByPoint: !isLineType, color: isLineType ? '#29378d' : undefined, data }]
    });
  }

  /** Donut/pie: wells category breakdown (3 categories as % of total). */
  private renderWpaCoverage(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('wpaCoverageHc');
    if (!Highcharts || !el) return;
    if (this.wpaCoverageChart) { try { this.wpaCoverageChart.destroy(); } catch (_) {} }

    const exec = this.wpaKpi.executedAsPlan;
    const notExec = this.wpaKpi.executedNotAsPlan;
    const nonExec = this.wpaKpi.nonExecuted;
    const total = exec + notExec + nonExec;
    const t = this.wpaCoverageChartType || 'donut';

    const GREEN  = '#22c55e';
    const ORANGE = '#f97316';
    const RED    = '#ef4444';

    this.wpaCoverageChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
      title: {
        text: t === 'donut'
          ? '<div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#334155;line-height:1">' + total + '</div>'
            + '<div style="font-size:10pt;color:#888;font-weight:500">Total Wells</div></div>'
          : undefined,
        useHTML: true, align: 'center', verticalAlign: 'middle', y: -4
      },
      credits: { enabled: false },
      legend: { enabled: true, layout: 'horizontal', align: 'center', verticalAlign: 'bottom',
        itemStyle: { fontSize: '9pt', fontWeight: '600' } },
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
      plotOptions: {
        pie: {
          innerSize: t === 'donut' ? '62%' : '0%',
          borderWidth: 2, borderColor: '#fff',
          showInLegend: true,
          dataLabels: {
            enabled: true,
            format: '{point.name}: {point.y} ({point.percentage:.1f}%)',
            style: { fontSize: '9pt', fontWeight: '600', textOutline: 'none', color: '#334155' },
            connectorColor: '#999',
            distance: 20,
            filter: { property: 'y', operator: '>', value: 0 }
          }
        }
      },
      series: [{
        name: 'Wells',
        data: [
          { name: 'Executed as per Plan', y: exec, color: GREEN },
          { name: 'Executed Not as per Plan', y: notExec, color: ORANGE },
          { name: 'Non Executed as per Plan', y: nonExec, color: RED }
        ]
      }]
    });
  }

  /** Stacked column chart: 4 bars — Total Planned, In-Progress, New Planned, Unplanned.
   *  Each bar is stacked showing Executed (green) vs Remaining (blue). */
  private renderActivityStackedChart(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('activityStackedHc');
    if (!Highcharts || !el) return;
    if (this.activityStackedChart) { try { this.activityStackedChart.destroy(); } catch (_) {} }

    const k = this.wpaKpi;

    this.activityStackedChart = Highcharts.chart(el, {
      chart: { type: 'column', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: [
          'Total Planned',
          'In-Progress Activities',
          'New Planned',
          'Unplanned Activities'
        ],
        labels: { style: { fontSize: '9.5pt', fontWeight: '600', color: '#334155' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        min: 0,
        title: { text: 'Count', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } },
        stackLabels: {
          enabled: true,
          style: { fontWeight: '700', fontSize: '10pt', color: '#334155' },
          formatter: function(): string { return Highcharts.numberFormat((this as any).total, 0, '.', ','); }
        }
      },
      legend: {
        enabled: true, layout: 'horizontal', align: 'center', verticalAlign: 'bottom',
        itemStyle: { fontSize: '9.5pt', fontWeight: '600' }
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function(): string {
          const pts = (this as any).points || [];
          const catName = pts.length > 0 ? pts[0].key : '';
          let html = '<b>' + catName + '</b><br/>';
          let total = 0;
          pts.forEach((p: any) => {
            total += p.y;
            if (p.y > 0) {
              html += '<span style="color:' + p.color + '">\u25CF</span> ' + p.series.name + ': <b>' + Highcharts.numberFormat(p.y, 0, '.', ',') + '</b><br/>';
            }
          });
          html += 'Total: <b>' + Highcharts.numberFormat(total, 0, '.', ',') + '</b>';
          return html;
        }
      },
      plotOptions: {
        column: {
          stacking: 'normal',
          borderWidth: 0,
          borderRadius: 4,
          cursor: 'pointer',
          point: {
            events: {
              click: (e: any) => {
                const cats = ['total_planned', 'in_progress', 'new_planned', 'unplanned'] as const;
                const idx = e.point.index;
                if (idx >= 0 && idx < cats.length) {
                  this.navigateToActivityDrilldown(cats[idx]);
                }
              }
            }
          },
          dataLabels: {
            enabled: true,
            formatter: function(): string { const v = (this as any).y; return v > 0 ? Highcharts.numberFormat(v, 0, '.', ',') : ''; },
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none', color: '#fff' }
          }
        }
      },
      series: [
        {
          name: 'Executed',
          color: '#22c55e',
          data: [
            k.totalExecutedAsPlanned,
            k.inProgressExecutedAsPlanned,
            k.newExecutedAsPlanned,
            k.unplannedActivitiesExecuted
          ]
        },
        {
          name: 'Planned (Not Executed)',
          color: '#29378d',
          data: [
            Math.max(0, k.totalActivitiesPlanned - k.totalExecutedAsPlanned),
            Math.max(0, k.inProgressActivitiesPlanned - k.inProgressExecutedAsPlanned),
            Math.max(0, k.newActivitiesPlanned - k.newExecutedAsPlanned),
            0
          ]
        }
      ]
    });
  }

  /** Donut chart: activity category breakdown (Executed as Planned / Not Executed / Unplanned). */
  private renderActivityDonut(): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById('activityDonutHc');
    if (!Highcharts || !el) return;
    if (this.activityDonutChart) { try { this.activityDonutChart.destroy(); } catch (_) {} }

    const k = this.wpaKpi;
    const executed = k.totalExecutedAsPlanned;
    const notExecuted = Math.max(0, k.totalActivitiesPlanned - k.totalExecutedAsPlanned);
    const unplanned = k.unplannedActivitiesExecuted;
    const total = executed + notExecuted + unplanned;

    this.activityDonutChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
      title: {
        text: '<div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#334155;line-height:1">'
          + Highcharts.numberFormat(total, 0, '.', ',') + '</div>'
          + '<div style="font-size:10pt;color:#888;font-weight:500">Total Activities</div></div>',
        useHTML: true, align: 'center', verticalAlign: 'middle', y: -4
      },
      credits: { enabled: false },
      legend: { enabled: true, layout: 'horizontal', align: 'center', verticalAlign: 'bottom',
        itemStyle: { fontSize: '9pt', fontWeight: '600' } },
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
      plotOptions: {
        pie: {
          innerSize: '55%',
          size: '85%',
          dataLabels: {
            enabled: true,
            format: '{point.name}: {point.y} ({point.percentage:.1f}%)',
            style: { fontSize: '9pt', fontWeight: '600', textOutline: 'none', color: '#334155' },
            connectorColor: '#999',
            distance: 20,
            filter: { property: 'y', operator: '>', value: 0 }
          }
        }
      },
      series: [{
        name: 'Activities',
        data: [
          { name: 'Executed as Planned', y: executed, color: '#22c55e' },
          { name: 'Planned (Not Executed)', y: notExecuted, color: '#29378d' },
          { name: 'Unplanned Executed', y: unplanned, color: '#f59e0b' }
        ]
      }]
    });
  }

  /** Shared Highcharts waterfall config — uses `columnrange` so each bar has
   *  an explicit low/high, matching the original SVG mock-up exactly.
   *  Highcharts' built-in waterfall `isIntermediateSum` resets at each
   *  intermediate-sum point, so two cumulative bars (After FLAF/SCR + Clean
   *  target) can't be expressed in one waterfall series. */
  private buildWaterfallConfig(plan: number, flafLoss: number, pdoLoss: number, actual: number, chartType: string = 'waterfall'): any {
    const BLUE   = '#29378d';
    const RED    = '#C00000';
    const ORANGE = '#ED7D31';
    const GREEN  = '#70AD47';

    const afterFlaf = plan - flafLoss;       // running cumulative after FLAF/SCR
    const cleanTgt  = afterFlaf - pdoLoss;   // running cumulative after PDO issues

    // Display values shown above each bar (deltas for floating bars, totals for full bars)
    const displayValues = [plan, -flafLoss, afterFlaf, -pdoLoss, cleanTgt, actual];
    const categories = ['PDO\nplan', 'FLAF/SCR\n−' + flafLoss, 'After\nFLAF/SCR', 'PDO\nissues −' + pdoLoss, 'Clean\ntarget', 'Actual\ncompleted'];
    const pointColors = [BLUE, RED, BLUE, ORANGE, ORANGE, GREEN];

    // Non-waterfall variants: render the same 6 display values as a plain series.
    if (chartType !== 'waterfall') {
      const baseSeriesType = chartType === 'bar' ? 'bar' : chartType;
      const isLineLike = chartType === 'line' || chartType === 'spline' || chartType === 'area';
      return {
        chart: { type: baseSeriesType, backgroundColor: 'transparent', spacing: [16, 10, 10, 10] },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
          categories,
          labels: { style: { fontSize: '8.5pt' } },
          lineColor: 'rgba(0,0,0,0.06)',
          tickColor: 'rgba(0,0,0,0.06)'
        },
        yAxis: {
          title: { text: undefined },
          gridLineColor: 'rgba(0,0,0,0.06)',
          labels: { style: { fontSize: '8.5pt' } }
        },
        tooltip: { enabled: false },
        plotOptions: {
          series: {
            borderWidth: 0,
            borderRadius: 4,
            color: isLineLike ? BLUE : undefined,
            lineWidth: isLineLike ? 2.5 : undefined,
            marker: isLineLike ? { enabled: true, radius: 4, fillColor: BLUE } : undefined,
            fillOpacity: chartType === 'area' ? 0.25 : undefined,
            dataLabels: {
              enabled: true,
              inside: false,
              crop: false,
              overflow: 'allow',
              formatter: function(this: any) { return '<b>' + displayValues[this.point.x] + '</b>'; },
              style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
            }
          }
        },
        series: [{
          name: 'Plan to actual',
          data: displayValues.map((v, i) => ({ y: v, color: isLineLike ? BLUE : pointColors[i] }))
        }]
      };
    }

    return {
      chart: { type: 'columnrange', backgroundColor: 'transparent', spacing: [16, 10, 10, 10], inverted: false },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: ['PDO\nplan', 'FLAF/SCR\n−' + flafLoss, 'After\nFLAF/SCR', 'PDO\nissues −' + pdoLoss, 'Clean\ntarget', 'Actual\ncompleted'],
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)',
        tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        min: 0,
        title: { text: undefined },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { enabled: false },
      plotOptions: {
        columnrange: {
          borderWidth: 0,
          borderRadius: 4,
          pointPadding: 0.12,
          groupPadding: 0,
          dataLabels: [{
            enabled: true,
            inside: false,
            verticalAlign: 'bottom',
            y: -2,
            crop: false,
            overflow: 'allow',
            formatter: function(this: any) { return '<b>' + displayValues[this.point.x] + '</b>'; },
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
          }]
        }
      },
      series: [{
        name: 'Plan to actual',
        data: [
          { low: 0,         high: plan,      color: BLUE   },   // PDO plan: 0 → plan
          { low: afterFlaf, high: plan,      color: RED    },   // FLAF/SCR: floats from cum down to (cum - flafLoss)
          { low: 0,         high: afterFlaf, color: BLUE   },   // After FLAF/SCR: 0 → cumulative
          { low: cleanTgt,  high: afterFlaf, color: ORANGE },   // PDO issues: floats down
          { low: 0,         high: cleanTgt,  color: ORANGE },   // Clean target: 0 → cumulative
          { low: 0,         high: actual,    color: GREEN  }    // Actual completed: 0 → actual
        ]
      }]
    };
  }

  private renderFunnelChart(): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.funnelChartContainer?.nativeElement;
    if (!Highcharts || !el) return;

    if (this.funnelChart) {
      this.funnelChart.destroy();
      this.funnelChart = null;
    }

    const seriesData = [
      { name: 'Original Plan', y: this.funnelOriginalPlan, color: '#29378d' },
      { name: 'After FLAF / SCR Delays Removed', y: this.funnelFlaf, color: '#ED7D31' },
      { name: 'After PDO Issues Removed', y: this.funnelPdo, color: '#FFC000' },
      { name: 'Actual Due Wells Completed', y: this.funnelActual, color: '#00B050' }
    ];
    const allZero = seriesData.every(d => d.y === 0);

    const cfg: any = {
      chart: { type: 'funnel', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: {
        pointFormat: '<b>{point.y}</b> wells'
      },
      plotOptions: {
        series: {
          dataLabels: {
            enabled: true,
            format: '<b>{point.y}</b>',
            style: { color: '#fff', fontSize: '16px', fontWeight: '800', textOutline: 'none' },
            inside: true,
            verticalAlign: 'middle',
            align: 'center'
          },
          neckWidth: '40%',
          neckHeight: '0%',
          width: '85%',
          colorByPoint: true
        }
      },
      series: [{ name: 'Wells', data: seriesData }]
    };

    if (allZero) {
      cfg.series = [{ name: 'Wells', data: seriesData.map(d => ({
        name: d.name, y: 1, color: d.color + '66'
      })) }];
      cfg.plotOptions.series.dataLabels.format = '<b>0</b>';
      cfg.plotOptions.series.dataLabels.style.color = '#999';
      cfg.plotOptions.series.dataLabels.style.fontSize = '14px';
      cfg.tooltip = { headerFormat: '', pointFormat: '<b>{point.name}</b>: 0 wells' };
    }

    this.funnelChart = Highcharts.chart(el, cfg);
  }

  private crewsSub?: Subscription;
  private activeWellsSub?: Subscription;
  private kpiTilesSub?: Subscription;
  private odcSub?: Subscription;
  private odcDebounceTimer: any;
  private filterSub?: Subscription;
  private activitiesSub?: Subscription;
  private cdtSub?: Subscription;
  private wellProgressSub?: Subscription;
  private wellProgressKpiSub?: Subscription;
  private drilledWellsCompletionSub?: Subscription;
  private drilledWellsBreakdownSub?: Subscription;
  private dwcYtdSub?: Subscription;
  private dueWellsCompletionSub?: Subscription;
  private dueWcBreakdownSub?: Subscription;
  private dueWellsCompletionTrendSub?: Subscription;

  /** Drilled Wells YTD Completion — year-over-year donut widget */
  dwcYtdData: DrilledWellsYtdCompletion | null = null;

  /** Due Wells donut data */
  readonly currentYear = new Date().getFullYear();
  private get ytdFrom(): string { return `${this.currentYear}-01-01`; }
  private get yearEnd(): string { return `${this.currentYear}-12-31`; }
  private get ytdTo(): string {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }
  dueWcData: DueWellsCompletion | null = null;
  /** Loading state for KPI strip + donut + breakdown */
  isDueKpiLoading  = true;
  /** Loading state for the trend chart */
  isDueChartLoading = true;
  /** Trend data from separate completion-date-based API */
  dueWcTrendData: DueWellsCompletionTrend | null = null;
  /** Due Wells breakdown values — fetched independently via dedicated method */
  dueWcBreakdownBacklog = 0;
  dueWcBreakdownAccel   = 0;
  /** Drill Wells breakdown values — same logic as Due Wells breakdown */
  drillBreakdownBacklog = 0;
  drillBreakdownAccel   = 0;
  /** Drilled Wells Completion tile data — also drives the donut chart */
  dwcData: DrilledWellsCompletion | null = null;
  private workloadSub?: Subscription;
  private pRatingSub?: Subscription;
  private _wellsReadinessSub?: Subscription;
  pRatingAvgReliability: number | null = null;

  private wellProgressRetryCount = 0;
  private wellProgressRetryTimer: any;
  private isWellProgressRetry = false;
  private pRatingRetryTimer: any;

  // ── Well Progress KPI tile — independent date range filter ──────────────
  readonly wpPresets = ['Today', 'This Week', 'Next Week', 'Last Week', 'Last 30 Days', 'Last 60 Days', 'Last 90 Days', 'Last 120 Days', 'Next Month', 'This Year', 'Last Year', 'Custom'];
  wpDatePreset = 'This Year';
  wpDropdownOpen = false;
  wpCustomFrom = '';
  wpCustomTo = '';

  /** Tracks the currently selected global date preset label (e.g. 'Last Week', 'This Year'). */
  globalDatePresetLabel: string = (window as any).__globalDatePresetLabel || 'This Year';

  get wellDeliveryDateLabel(): string {
    const label = this.globalDatePresetLabel || 'This Year';
    if (label !== 'Custom') return label;
    const f = this.dashboardService.currentFilter;
    const from = (f.startDate || '').slice(0, 10);
    const to   = (f.endDate   || '').slice(0, 10);
    return from && to ? `${from} to ${to}` : 'Custom';
  }

  // ── Workload Analysis dynamic title ──────────────────────────────────────
  wlaTitle = 'Work Load Analysis';
  wlaSub = 'Wells completed (actual) / planned (forecast) per month · NIMR · MARMUL · Total';

  private wpFmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private wpPresetFrom(preset: string): string {
    const today = new Date();
    switch (preset) {
      case 'Today': return this.wpFmt(today) + ' 00:00:00';
      case 'This Week': { const d = new Date(today); d.setDate(today.getDate() - today.getDay()); return this.wpFmt(d); }
      case 'Next Week': { const d = new Date(today); d.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7)); return this.wpFmt(d); }
      case 'Last Week': { const d = new Date(today); d.setDate(today.getDate() - today.getDay() - 7); return this.wpFmt(d); }
      case 'Next Month': { const d = new Date(today.getFullYear(), today.getMonth() + 1, 1); return this.wpFmt(d); }
      case 'Last 30 Days': { const d = new Date(today); d.setDate(today.getDate() - 30); return this.wpFmt(d); }
      case 'Last 60 Days': { const d = new Date(today); d.setDate(today.getDate() - 60); return this.wpFmt(d); }
      case 'Last 90 Days': { const d = new Date(today); d.setDate(today.getDate() - 90); return this.wpFmt(d); }
      case 'Last 120 Days': { const d = new Date(today); d.setDate(today.getDate() - 120); return this.wpFmt(d); }
      case 'This Year': return `${today.getFullYear()}-01-01`;
      case 'Last Year': return `${today.getFullYear() - 1}-01-01`;
      case 'Custom': return this.wpCustomFrom || this.getDefaultFrom();
      default: return this.getDefaultFrom();
    }
  }

  private wpPresetTo(preset: string): string {
    const today = new Date();
    switch (preset) {
      case 'Today': return this.wpFmt(today) + ' 23:59:59';
      case 'Next Week': { const d = new Date(today); d.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7) + 6); return this.wpFmt(d); }
      case 'Last Week': { const d = new Date(today); d.setDate(today.getDate() - today.getDay() - 1); return this.wpFmt(d); }
      case 'Next Month': { const d = new Date(today.getFullYear(), today.getMonth() + 2, 0); return this.wpFmt(d); }
      case 'This Year': return `${today.getFullYear()}-12-31`;
      case 'Last Year': return `${today.getFullYear() - 1}-12-31`;
      case 'Custom': return this.wpCustomTo || this.wpFmt(today);
      default: return this.wpFmt(today);
    }
  }

  toggleWpDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.wpDropdownOpen = !this.wpDropdownOpen;
  }

  setWpDatePreset(preset: string, event: MouseEvent): void {
    event.stopPropagation();
    this.wpDatePreset = preset;
    if (preset !== 'Custom') {
      this.wpDropdownOpen = false;
      this.applyWpDateFilter();
    }
  }

  applyWpDateFilter(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.wpDropdownOpen = false;
    let from = this.wpPresetFrom(this.wpDatePreset);
    let to   = this.wpPresetTo(this.wpDatePreset);
    // Guard: if from is after to, swap them silently
    if (from > to) { const tmp = from; from = to; to = tmp; }
    const hfb = (window as any).hfbState;
    const cluster  = hfb?.cluster || undefined;
    const wellId   = hfb?.well ? hfb.well.split('-').pop() : undefined;
    const wellType = cluster && hfb?.wellType ? hfb.wellType : undefined;
    const site     = hfb?.site || undefined;
    const project  = this.dashboardService.currentFilter.project || undefined;
    // Re-fetch Total Wells & Completed Wells KPI with selected date range.
    // Reset drilled-wells display immediately for instant visual feedback.
    this.dwcData = null;
    this.drillBreakdownBacklog = 0;
    this.drillBreakdownAccel   = 0;
    (['dwcTotalWells','dwcCompleted','dwcHold','dwcInProgress','dwcSuspended','dwcCompletionRate'] as const)
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    // fetchActiveWells commented out — kpi-tiles is now the single source for tile data
    // this.fetchActiveWells({ cluster, site, project, wellId, location: wellType, from, to, thisMonth: false });
    this.fetchKpiTiles({ cluster, site, project, location: wellType, from, to });
    this.fetchWellProgressKpi({ cluster, wellId, wellType, from, to });
    this.fetchDrilledWellsCompletion({ cluster, wellId, wellType, site, project, from, to });
    this.fetchWellProgress({ cluster, wellId, from, to });
    this.fetchWorkloadAnalysis({ cluster, wellId, project, from, to });
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.wpDropdownOpen) this.wpDropdownOpen = false;
  }
  // ────────────────────────────────────────────────────────────────────────

  /** Header title — changes for the "Well Delivery Status" copy of this board. */
  boardName = 'ODC South Well Delivery (2025 & 2026 Scope) Dashboard';
  /** Whether this board exposes the extra Edit action (the editable copy). */
  isEditableBoard = false;

  constructor(private readonly dashboardService: DashboardService, private readonly router: Router) {
    this.loadWidgetVisibility();
    // The same component backs both /odcsouthwelldelivery and the editable
    // /welldeliverystatus copy — retitle + enable Edit for the copy.
    const url = (this.router.url || '').split('?')[0];
    if (url.indexOf('welldeliverystatus') >= 0) {
      this.boardName = 'Well Delivery Status';
      this.isEditableBoard = true;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  ODC South Well Delivery — bottom summary dashboard (static seed data
  //  from the "Week-13" screenshot; charts use Highcharts).
  // ════════════════════════════════════════════════════════════════════
  osdClusters: Array<{ key: string; label: string; title: string; drilled: number; ready: number }> = [
    { key: 'odc',    label: 'ODC OVERALL',    title: 'ODC Overall',    drilled: 224, ready: 139 },
    { key: 'marmul', label: 'MARMUL CLUSTER', title: 'Marmul Cluster', drilled: 88,  ready: 81 },
    { key: 'nimr',   label: 'NIMR CLUSTER',   title: 'Nimr Cluster',   drilled: 118, ready: 50 },
    { key: 'amal',   label: 'AMAL CLUSTER',   title: 'Amal Cluster',   drilled: 10,  ready: 7 },
    { key: 'gb',     label: 'GB CLUSTER',     title: 'GB Cluster',     drilled: 8,   ready: 1 }
  ];
  osdClusterTypes: Record<string, string> = { odc: 'pie', marmul: 'pie', nimr: 'pie', amal: 'pie', gb: 'pie' };
  osdChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'pie', label: 'Pie' }, { value: 'donut', label: 'Donut' },
    { value: 'column', label: 'Column' }, { value: 'bar', label: 'Bar' },
    { value: 'tiles', label: 'Tiles' }
  ];
  osdDonutPieOptions: Array<{ value: string; label: string }> = [
    { value: 'donut', label: 'Donut' }, { value: 'pie', label: 'Pie' },
    { value: 'tiles', label: 'Tiles' }
  ];
  osdColumnBarOptions: Array<{ value: string; label: string }> = [
    { value: 'column', label: 'Column' }, { value: 'bar', label: 'Bar' },
    { value: 'tiles', label: 'Tiles' }
  ];
  osdBufferChartType = 'column';
  osdCommChartType = 'donut';
  osdWorkloadChartType = 'column';
  osdDueGaugeChartType = 'donut';
  osdDrilledGaugeChartType = 'donut';
  /** View mode for the Well Delivery Metrics card: 'tiles' or a chart style. */
  osdKpiChartType = 'tiles';
  osdKpiViewOptions: Array<{ value: string; label: string }> = [
    { value: 'tiles', label: 'Tiles' },
    { value: 'column', label: 'Column' }, { value: 'bar', label: 'Bar' },
    { value: 'pie', label: 'Pie' }, { value: 'donut', label: 'Donut' }
  ];
  osdKpis: Array<{ label: string; value: string | number; variant: string }> = [
    { label: 'Drilled Wells',          value: 224, variant: 'k-blue' },
    { label: 'Hook-Up Completed',      value: 139, variant: 'k-green' },
    { label: 'Due Wells',              value: 113, variant: 'k-blue' },
    { label: 'Not Due Wells',          value: 111, variant: 'k-teal' },
    { label: 'Drilled & Not Completed', value: 85, variant: 'k-red' },
    { label: 'Accelerated',            value: 26,  variant: 'k-green' },
    { label: 'Backlogs',               value: 0,   variant: 'k-red' },
    { label: 'Buffer Flowlines',       value: 33,  variant: 'k-green' }
  ];
  private osdCharts: Record<string, any> = {};

  /** Whether the header "Export" menu (whole-dashboard PDF/PNG) is open. */
  osdExportOpen = false;

  /** Slice categories shared by every cluster pie (consistent legend/colours). */
  private readonly OSD_SLICE_DEFS = [
    { name: 'Not due because of FLAF/SCR & Other',     color: '#00B0F0' },
    { name: 'Suspended Wells',                         color: '#FFC000' },
    { name: 'Not Due (Issues to be resolved by PDO)',  color: '#ED7D31' },
    { name: 'Backlog',                                 color: '#FF0000' },
    { name: 'Actual - Due Wells Completed',            color: '#A9D08E' },
    { name: 'Actual - Not Due Wells Accelerated',      color: '#548235' }
  ];
  /** Wells-grid category per slice (drill target), aligned to OSD_SLICE_DEFS order. */
  private readonly OSD_SLICE_CATS = ['notdue', 'suspended', 'pdoissues', 'backlog', 'completed', 'early'];

  /**
   * Navigate to the Wells listing grid (/odcwells), pre-filtered to an ODC
   * category — the same drill mechanism the dashboard widgets use.
   */
  drillToWells(cat: string): void {
    (window as any).__awPendingOdcCat = cat;
    this.router.navigate(['/odcwells']);
  }

  /** Values aligned to OSD_SLICE_DEFS order: [FLAF, Suspended, Issues, Backlog, DueDone, Accelerated]. */
  private readonly OSD_CLUSTER_VALUES: Record<string, number[]> = {
    odc:    [17, 0, 68, 0, 113, 26],
    marmul: [5,  0, 2,  0, 64,  17],
    nimr:   [11, 0, 57, 0, 41,  9],
    amal:   [0,  0, 3,  0, 7,   0],
    gb:     [1,  0, 6,  0, 1,   0]
  };

  onOsdClusterTypeChange(key: string, value: string): void { this.osdClusterTypes[key] = value; this.renderOsdCluster(key); }
  onOsdBufferTypeChange(v: string): void { this.osdBufferChartType = v; this.renderOsdBuffer(); }
  onOsdCommTypeChange(v: string): void { this.osdCommChartType = v; this.renderOsdComm(); }
  onOsdWorkloadTypeChange(v: string): void { this.osdWorkloadChartType = v; this.renderOsdWorkload(); }
  onOsdDueGaugeTypeChange(v: string): void { this.osdDueGaugeChartType = v; this.renderOsdGauge('due'); }
  onOsdDrilledGaugeTypeChange(v: string): void { this.osdDrilledGaugeChartType = v; this.renderOsdGauge('drilled'); }
  onOsdKpiTypeChange(v: string): void {
    this.osdKpiChartType = v;
    // When switching to a chart style, let the *ngIf swap in the chart
    // container before Highcharts looks it up.
    if (v !== 'tiles') { setTimeout(() => this.renderOsdKpi()); }
  }

  /** Render (or re-render) every chart in the bottom ODC South section. */
  renderOsdSection(): void {
    this.osdClusters.forEach(c => this.renderOsdCluster(c.key));
    this.renderOsdKpi();
    this.renderOsdBuffer();
    this.renderOsdComm();
    this.renderOsdWorkload();
    this.renderOsdGauge('due');
    this.renderOsdGauge('drilled');
  }

  /** Map a KPI tile variant to a chart colour. */
  private readonly OSD_KPI_COLORS: Record<string, string> = {
    'k-blue': '#29378d', 'k-green': '#16a34a', 'k-teal': '#14b8a6', 'k-red': '#dc2626'
  };

  /** Render the well-delivery KPI metrics chart (Column / Bar / Pie / Donut). */
  private renderOsdKpi(): void {
    const t = this.osdKpiChartType || 'tiles';
    if (t === 'tiles') { return; }   // tiles view shows the number cards, no chart
    const data = this.osdKpis.map(k => ({
      name: k.label,
      y: Number(k.value) || 0,
      color: this.OSD_KPI_COLORS[k.variant] || '#29378d'
    }));
    const isPie = t === 'pie' || t === 'donut';
    if (isPie) {
      this.osdMakeChart('osdKpiHc', {
        chart: { type: 'pie' },
        legend: { enabled: true, layout: 'vertical', align: 'right', verticalAlign: 'middle',
          itemStyle: { fontSize: '8pt', fontWeight: '500' }, itemMarginBottom: 2 },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: { pie: { innerSize: t === 'donut' ? '55%' : '0%', borderWidth: 1, borderColor: '#fff',
          dataLabels: { enabled: true, format: '{point.y}', distance: -18,
            style: { fontSize: '8pt', fontWeight: '700', color: '#fff', textOutline: 'none' },
            filter: { property: 'y', operator: '>', value: 0 } } } },
        series: [{ name: 'Wells', data }]
      });
    } else {
      this.osdMakeChart('osdKpiHc', {
        chart: { type: t },
        xAxis: { categories: data.map(d => d.name), labels: { style: { fontSize: '8pt' } } },
        yAxis: { title: { text: undefined }, allowDecimals: false },
        legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        plotOptions: { series: { dataLabels: { enabled: true,
          style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' } } } },
        series: [{ name: 'Wells', colorByPoint: true, data }]
      });
    }
  }

  /**
   * Shared, nicely-styled legend config for the ODC pie/donut charts.
   * Uniform round colour markers, bold theme-aware text, comfortable spacing.
   */
  private osdPieLegend(layout: 'vertical' | 'horizontal' = 'vertical',
                       align: string = 'right',
                       verticalAlign: string = 'middle'): any {
    const txt = (getComputedStyle(document.documentElement)
      .getPropertyValue('--txt-1') || '').trim() || '#1a1f36';
    return {
      enabled: true,
      layout,
      align,
      verticalAlign,
      useHTML: true,
      // We draw our own marker inside the chip, so hide the default symbol.
      squareSymbol: false,
      symbolWidth: 0,
      symbolHeight: 0,
      symbolPadding: 0,
      itemMarginBottom: layout === 'vertical' ? 5 : 4,
      itemMarginTop: 0,
      itemDistance: 8,
      itemStyle: { fontSize: '8.5pt', fontWeight: '600', color: txt },
      itemHoverStyle: { color: txt },
      // Pill-chip per item: colour dot + label (+ value for pie slices).
      labelFormatter: function (this: any): string {
        const p = this;
        const col = p.color || '#29378d';
        const hasVal = p.y !== undefined && p.y !== null && p.y !== '';
        const valHtml = hasVal
          ? '<span class="osd-lg-val" style="color:' + col + '">' + p.y + '</span>'
          : '';
        return '<span class="osd-lg-item">'
          + '<span class="osd-lg-dot" style="background:' + col + '"></span>'
          + '<span class="osd-lg-name">' + p.name + '</span>'
          + valHtml
          + '</span>';
      }
    };
  }

  private osdMakeChart(id: string, cfg: any): void {
    const Highcharts = (window as any).Highcharts;
    const el = document.getElementById(id);
    if (!Highcharts || !el) return;
    if (this.osdCharts[id]) { try { this.osdCharts[id].destroy(); } catch (_) {} }
    // Coming back from the Tiles view: clear any tile markup left in the host.
    else { el.innerHTML = ''; }
    cfg.chart = Object.assign({ backgroundColor: 'transparent', spacing: [6, 6, 6, 6] }, cfg.chart || {});
    cfg.credits = { enabled: false };
    if (!cfg.title) cfg.title = { text: undefined };
    // Image / print exports capture the whole widget card (title + KPI tiles +
    // chart + legend); CSV / XLS / data table stay native.
    cfg.exporting = cfg.exporting || this.osdWidgetExporting();
    this.osdCharts[id] = Highcharts.chart(el, cfg);
  }

  /**
   * Highcharts exporting config whose image/print items capture the full widget
   * card (via html2canvas) instead of just the chart SVG. CSV / XLS / View data
   * table keep their native (chart-data) behaviour.
   */
  private osdWidgetExporting(): any {
    const self = this;
    return {
      enabled: true,
      buttons: { contextButton: { menuItems: [
        'viewFullscreen', 'printWidget', 'separator',
        'pngWidget', 'jpegWidget', 'svgWidget', 'separator',
        'downloadCSV', 'downloadXLS', 'viewData'
      ] } },
      menuItemDefinitions: {
        printWidget: { text: 'Print chart', onclick: function (this: any) { self.osdPrintWidget(this); } },
        pngWidget:   { text: 'Download PNG image', onclick: function (this: any) { self.osdCaptureWidget(this, 'png'); } },
        jpegWidget:  { text: 'Download JPEG image', onclick: function (this: any) { self.osdCaptureWidget(this, 'jpeg'); } },
        svgWidget:   { text: 'Download SVG vector image', onclick: function (this: any) { self.osdCaptureWidget(this, 'svg'); } }
      }
    };
  }

  /** The widget card wrapping a chart (cluster card incl. its KPI tiles, else the plain card). */
  private osdWidgetCardFor(chart: any): HTMLElement | null {
    const c = chart && chart.container;
    if (!c) return null;
    return (c.closest('.osd-cluster-card') || c.closest('.card')) as HTMLElement | null;
  }

  private osdSafeName(t: string): string {
    return (t || 'widget').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'widget';
  }

  private osdDownload(url: string, name: string): void {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); }, 120);
  }

  /** Hide chrome (toolbar + Highcharts export button) in the html2canvas clone. */
  private osdExportClone(doc: Document): void {
    doc.querySelectorAll('.osd-card-toolbar, .highcharts-exporting-group, .highcharts-contextmenu, .card-fullscreen-btn')
      .forEach(el => { (el as HTMLElement).style.display = 'none'; });
  }

  /** Capture the whole widget card as PNG / JPEG / SVG(raster-wrapped). */
  private osdCaptureWidget(chart: any, fmt: 'png' | 'jpeg' | 'svg'): void {
    const card = this.osdWidgetCardFor(chart);
    const h2c = (window as any).html2canvas;
    if (!card || !h2c) { try { chart.exportChart({ type: fmt === 'jpeg' ? 'image/jpeg' : fmt === 'svg' ? 'image/svg+xml' : 'image/png' }); } catch (_) {} return; }
    const title = (card.querySelector('.card-title')?.textContent || 'widget').trim();
    h2c(card, { backgroundColor: '#ffffff', scale: 2, useCORS: true, onclone: (d: Document) => this.osdExportClone(d) })
      .then((canvas: HTMLCanvasElement) => {
        const name = this.osdSafeName(title);
        if (fmt === 'svg') {
          const png = canvas.toDataURL('image/png');
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">`
            + `<image href="${png}" x="0" y="0" width="${canvas.width}" height="${canvas.height}"/></svg>`;
          this.osdDownload(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), name + '.svg');
        } else {
          const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
          this.osdDownload(canvas.toDataURL(mime, 0.95), name + (fmt === 'jpeg' ? '.jpg' : '.png'));
        }
      })
      .catch(() => { try { chart.exportChart(); } catch (_) {} });
  }

  /**
   * Export the whole ODC South dashboard (title + all KPI cards & charts) to a
   * single PNG or a (paginated) PDF. Uses html2canvas + jsPDF (both loaded).
   */
  exportDashboard(fmt: 'pdf' | 'png'): void {
    this.osdExportOpen = false;
    const section = document.querySelector('#page-cmdoverview .osd-section') as HTMLElement | null;
    const h2c = (window as any).html2canvas;
    if (!section || !h2c) return;
    h2c(section, {
      backgroundColor: '#f4f6fb', scale: 2, useCORS: true,
      windowWidth: section.scrollWidth,
      onclone: (d: Document) => {
        d.querySelectorAll(
          '.osd-header__actions, .osd-card-toolbar, .card-fullscreen-btn, ' +
          '.highcharts-exporting-group, .highcharts-contextmenu, .wfb-wrap, .cwc-chart-style-picker'
        ).forEach(el => { (el as HTMLElement).style.display = 'none'; });
      }
    }).then((canvas: HTMLCanvasElement) => {
      const name = this.osdSafeName(this.boardName || 'ODC_South_Dashboard');
      if (fmt === 'png') { this.osdDownload(canvas.toDataURL('image/png'), name + '.png'); return; }

      const jsPDFctor = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
      if (!jsPDFctor) { this.osdDownload(canvas.toDataURL('image/png'), name + '.png'); return; }
      const pdf = new jsPDFctor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const imgW = pw;
      const imgH = canvas.height * (pw / canvas.width);
      const img = canvas.toDataURL('image/png');
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, 'PNG', 0, position, imgW, imgH);
      heightLeft -= ph;
      while (heightLeft > 0) {
        position -= ph;
        pdf.addPage();
        pdf.addImage(img, 'PNG', 0, position, imgW, imgH);
        heightLeft -= ph;
      }
      pdf.save(name + '.pdf');
    }).catch(() => { /* export failed — ignore */ });
  }

  /** Print the whole widget card. */
  private osdPrintWidget(chart: any): void {
    const card = this.osdWidgetCardFor(chart);
    const h2c = (window as any).html2canvas;
    if (!card || !h2c) { try { chart.print(); } catch (_) {} return; }
    h2c(card, { backgroundColor: '#ffffff', scale: 2, useCORS: true, onclone: (d: Document) => this.osdExportClone(d) })
      .then((canvas: HTMLCanvasElement) => {
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write('<html><head><title>Print</title></head><body style="margin:0">'
          + '<img src="' + canvas.toDataURL('image/png') + '" style="max-width:100%" '
          + 'onload="window.focus();window.print();window.close();"></body></html>');
        win.document.close();
      })
      .catch(() => { try { chart.print(); } catch (_) {} });
  }

  /**
   * Render a chart's data series as a grid of KPI number tiles inside the
   * chart's host element — the "Tiles" chart-style option. Destroys any
   * Highcharts instance occupying the host first.
   */
  private osdRenderTiles(id: string, items: Array<{ name: string; value: string | number; color?: string }>): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (this.osdCharts[id]) { try { this.osdCharts[id].destroy(); } catch (_) {} delete this.osdCharts[id]; }
    const esc = (s: any) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tiles = items.map(it => {
      const c = it.color || '#29378d';
      return `<div class="osd-tile" style="border-top-color:${c}">`
        + `<div class="osd-tile-label">${esc(it.name)}</div>`
        + `<div class="osd-tile-val" style="color:${c}">${esc(it.value)}</div>`
        + `</div>`;
    }).join('');
    el.innerHTML = `<div class="osd-tiles">${tiles}</div>`;
  }

  private renderOsdCluster(key: string): void {
    const t = this.osdClusterTypes[key] || 'pie';
    const vals = this.OSD_CLUSTER_VALUES[key] || [];
    const data = this.OSD_SLICE_DEFS.map((d, i) => ({ name: d.name, y: vals[i] || 0, color: d.color }));
    if (t === 'tiles') {
      this.osdRenderTiles('osdCluster_' + key, data.map(d => ({ name: d.name, value: d.y, color: d.color })));
      return;
    }
    // Click a slice/bar → drill into the Wells grid filtered to that category.
    const cats = this.OSD_SLICE_CATS;
    const onPointClick = (e: any) => { const c = cats[e.point.index]; if (c) this.drillToWells(c); };
    const clickEvents = { events: { click: onPointClick } };
    const isPie = t === 'pie' || t === 'donut';
    if (isPie) {
      this.osdMakeChart('osdCluster_' + key, {
        chart: { type: 'pie' },
        legend: this.osdPieLegend('vertical', 'right', 'middle'),
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: { pie: { cursor: 'pointer', point: clickEvents, showInLegend: true, innerSize: t === 'donut' ? '55%' : '0%', borderWidth: 1, borderColor: '#fff',
          dataLabels: { enabled: true, format: '{point.y}', distance: -18,
            style: { fontSize: '8pt', fontWeight: '700', color: '#fff', textOutline: 'none' },
            filter: { property: 'y', operator: '>', value: 0 } } } },
        series: [{ name: 'Wells', data }]
      });
    } else {
      this.osdMakeChart('osdCluster_' + key, {
        chart: { type: t },
        xAxis: { categories: data.map(d => d.name), labels: { enabled: false } },
        yAxis: { title: { text: undefined }, allowDecimals: false },
        legend: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        plotOptions: { series: { cursor: 'pointer', point: clickEvents, dataLabels: { enabled: true,
          style: { fontSize: '8pt', fontWeight: '700', textOutline: 'none' } } } },
        series: [{ name: 'Wells', colorByPoint: true, data }]
      });
    }
  }

  private renderOsdBuffer(): void {
    const t = this.osdBufferChartType || 'column';
    const cats = ['Marmul Non-IPM', 'Marmul - IPM', 'Nimr'];
    const vals = [12, 21, 0];
    if (t === 'tiles') {
      this.osdRenderTiles('osdBufferHc', cats.map((c, i) => ({ name: c, value: vals[i], color: '#29378d' })));
      return;
    }
    this.osdMakeChart('osdBufferHc', {
      chart: { type: t },
      xAxis: { categories: cats, labels: { style: { fontSize: '8.5pt' } } },
      yAxis: { title: { text: undefined }, allowDecimals: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b> ready' },
      plotOptions: { series: { dataLabels: { enabled: true,
        style: { fontSize: '9.5pt', fontWeight: '700', textOutline: 'none' } } } },
      series: [{ name: 'Buffer flowlines ready', color: '#29378d', data: vals }]
    });
  }

  private renderOsdComm(): void {
    const t = this.osdCommChartType || 'donut';
    const slices = [
      { name: 'Commissioned', y: 130, color: '#548235' },
      { name: 'Not Commissioned', y: 9, color: '#ED7D31' }
    ];
    if (t === 'tiles') {
      this.osdRenderTiles('osdCommHc', slices.map(s => ({ name: s.name, value: s.y, color: s.color })));
      return;
    }
    this.osdMakeChart('osdCommHc', {
      chart: { type: 'pie' },
      legend: this.osdPieLegend('horizontal', 'center', 'bottom'),
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
      plotOptions: { pie: { showInLegend: true, innerSize: t === 'donut' ? '60%' : '0%', borderWidth: 2, borderColor: '#fff',
        dataLabels: { enabled: true, format: '{point.y}', distance: -28,
          style: { fontSize: '12pt', fontWeight: '800', color: '#fff', textOutline: 'none' } } } },
      series: [{ name: 'Wells', data: slices }]
    });
  }

  private renderOsdWorkload(): void {
    const t = this.osdWorkloadChartType || 'column';
    const cats = ["Jan'26","Feb'26","Mar'26","Apr'26","May'26","Jun'26","Jul'26","Aug'26","Sep'26","Oct'26","Nov'26","Dec'26","Avg/Month"];
    const series = [
      { name: 'MML - Wells Completed',   color: '#29378d', data: [27,26,27,0,0,0,0,0,0,0,0,0,27] },
      { name: 'NIMR - Wells Completed',  color: '#ED7D31', data: [16,22,17,0,0,0,0,0,0,0,0,0,17] },
      { name: 'Amal - Wells Completed',  color: '#548235', data: [1,12,1,0,0,0,0,0,0,0,0,0,2] },
      { name: 'GB - Wells Completed',    color: '#00B050', data: [0,1,1,0,0,0,0,0,0,0,0,0,0] },
      { name: 'Total Wells Completed',   color: '#A6A6A6', data: [48,50,50,0,0,0,0,0,0,0,0,0,47] },
      { name: 'Total Wells Drilled',     color: '#FFC000', data: [53,51,50,0,0,0,0,0,0,0,0,0,52] }
    ];
    if (t === 'tiles') {
      // One tile per series, showing the Avg/Month figure (last data point).
      this.osdRenderTiles('osdWorkloadHc',
        series.map(s => ({ name: s.name + ' (Avg/Month)', value: s.data[s.data.length - 1], color: s.color })));
      return;
    }
    this.osdMakeChart('osdWorkloadHc', {
      chart: { type: t },
      xAxis: { categories: cats, labels: { style: { fontSize: '7.5pt' } } },
      yAxis: { title: { text: undefined }, allowDecimals: false },
      legend: this.osdPieLegend('horizontal', 'center', 'bottom'),
      tooltip: { shared: true },
      plotOptions: { column: { borderWidth: 0 }, bar: { borderWidth: 0 } },
      series
    });
  }

  private renderOsdGauge(which: 'due' | 'drilled'): void {
    const isDue = which === 'due';
    const id = isDue ? 'osdDueGaugeHc' : 'osdDrilledGaugeHc';
    const pct = isDue ? 123 : 62;
    const color = isDue ? '#C9A227' : '#29378d';
    const t = (isDue ? this.osdDueGaugeChartType : this.osdDrilledGaugeChartType) || 'donut';
    const shown = Math.min(pct, 100);
    if (t === 'tiles') {
      this.osdRenderTiles(id, [{
        name: isDue ? '% Completed of Due Wells' : '% Completed of Drilled Wells',
        value: pct + '%', color
      }]);
      return;
    }
    this.osdMakeChart(id, {
      chart: { type: 'pie' },
      title: { text: '<div style="text-align:center"><div style="font-size:22pt;font-weight:800;color:' + color + ';line-height:1">' + pct + '%</div></div>',
        useHTML: true, align: 'center', verticalAlign: 'middle', y: 0 },
      tooltip: { enabled: false },
      plotOptions: { pie: { innerSize: t === 'donut' ? '72%' : '0%', borderWidth: 0,
        dataLabels: { enabled: false }, startAngle: 0 } },
      series: [{ name: which, data: [
        { name: 'Completed', y: shown, color },
        { name: 'Remaining', y: Math.max(0, 100 - shown), color: '#E6E9EF' }
      ] }]
    });
  }

  ngAfterViewInit(): void {
    // Sync global date preset label on init
    this.globalDatePresetLabel = (window as any).__globalDatePresetLabel || 'This Year';
    // Prefetch data-quality API scores so badge % values are live on page load
    this.prefetchDqScores();

    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    this._onFsChange = () => {
      const target = (document.fullscreenElement ?? this._fsCard) as HTMLElement | null;
      const isExiting = !document.fullscreenElement;
      if (isExiting) this._fsCard = null;
      if (!target) return;

      // Resize embedded charts once the browser has settled the new layout.
      // Two animation frames + a short timeout is enough on every browser we
      // support; the previous 100ms timer occasionally fired before exit-
      // fullscreen had finished its transition, leaving Chart.js canvases
      // stuck with the fullscreen-era width/height attributes.
      const resize = () => {
        // Chart.js canvases
        target.querySelectorAll('canvas').forEach((c: HTMLCanvasElement) => {
          const chart = (window as any).Chart?.getChart?.(c);
          if (!chart) return;
          // Clear the stretched inline dimensions so Chart.js recomputes
          // from the container's current size instead of the fullscreen one.
          c.style.width = '';
          c.style.height = '';
          c.removeAttribute('width');
          c.removeAttribute('height');
          try { chart.resize(); chart.update('none'); } catch (_) {}
        });
        // Highcharts charts — look up by render-target containment so we only
        // reflow the ones inside the card.
        const Highcharts = (window as any).Highcharts;
        if (Highcharts && Array.isArray(Highcharts.charts)) {
          Highcharts.charts.forEach((chart: any) => {
            if (!chart || !chart.renderTo) return;
            if (!target.contains(chart.renderTo)) return;
            // Clear inline width/height that Highcharts set on the container
            // and its inner .highcharts-container during fullscreen, otherwise
            // reflow keeps reading the stale fullscreen dimensions.
            const renderTo = chart.renderTo as HTMLElement;
            const inner = renderTo.querySelector('.highcharts-container') as HTMLElement | null;
            if (inner) {
              inner.style.width = '';
              inner.style.height = '';
            }
            const svg = renderTo.querySelector('svg.highcharts-root') as SVGElement | null;
            if (svg) {
              svg.removeAttribute('width');
              svg.removeAttribute('height');
            }
            if (typeof chart.reflow === 'function') {
              try { chart.reflow(); } catch (_) {}
            }
          });
        }
      };

      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resize, 60)));
      // Safety-net reflow — in some browsers the exit-fullscreen layout
      // transition takes longer than 100 ms; the second call is a no-op when
      // the layout has already settled.
      setTimeout(resize, 320);
    };
    document.addEventListener('fullscreenchange', this._onFsChange);

    // Expose refresh callback so the legacy ODC filter can trigger API re-fetch
    (window as any)._activitiesProgressRefresh = (odc: string, cluster?: string, well?: string, startDate?: string, endDate?: string) => {
      // Extract bare well ID from composite key (e.g. 'nimr-34565' → '34565')
      const wellId = well ? well.split('-').pop() : undefined;
      this.fetchActivitiesProgress(odc || 'all', cluster, wellId, startDate, endDate);
    };

    // Call page renderer
    const fn = (window as any)['initCmdOverview'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[cmdoverview] renderer threw', e); }
    }

    // Post-render hook
    const dvsApply = (window as any).dvsApply;
    if (typeof dvsApply === 'function') {
      setTimeout(() => { try { dvsApply(); } catch (_) {} }, 0);
    }

    // Hookup section charts use hardcoded data, not the wells-readiness API.
    // Render them here so they appear on first load regardless of the API
    // (fetchWellsReadiness only runs when the user opens the 'overall' WR tab).
    setTimeout(() => {
      this.renderHookupWaterfalls();
      this.renderHookupCommDonuts();
      this.renderOsdSection();
    }, 0);

    // Well Delivery Cycle Time — fetch real data (renders the trend + phase charts on arrival).
    const wdctF = this.dashboardService.currentFilter;
    this.fetchWellDeliveryCycleTime({ cluster: wdctF.cluster || undefined, site: wdctF.site || undefined, project: wdctF.project || undefined, wellType: wdctF.location || undefined, from: wdctF.startDate || undefined, to: wdctF.endDate || undefined });

    // Fetch KPIs from API. Read filter state from DashboardService — same source
    // the all-wells page uses. window.hfbState is pre-seeded with default
    // month-start/today dates that are indistinguishable from user selections,
    // so reading dates from it makes the dashboard send a date-range filter while
    // the all-wells page sends thisMonth=true — diverging KPI counts.
    const f0 = this.dashboardService.currentFilter;

    // Fetch Wells – Planned vs. Actual KPIs from API
    this.fetchWpaKpi({ from: f0.startDate || this.getDefaultFrom(), to: f0.endDate || this.getDefaultTo(), cluster: f0.cluster, site: f0.site, wellType: f0.project ? undefined : f0.location, project: f0.project, wellId: f0.wellId });
    const hasInitDate = !!(f0.startDate || f0.endDate);
    const initFilters = {
      cluster: f0.cluster || undefined,
      wellId: f0.wellId || undefined,
      from: f0.startDate || this.getDefaultFrom(),
      to: f0.endDate || this.getDefaultTo()
    };
    this.fetchCrewsDeployed(initFilters);
    // fetchActiveWells commented out — kpi-tiles is now the single source for tile data
    // this.fetchActiveWells(hasInitDate
    //   ? { cluster: f0.cluster, site: f0.site, project: f0.project, wellId: f0.wellId, location: f0.location, from: f0.startDate, to: f0.endDate, thisMonth: false }
    //   : { cluster: f0.cluster, site: f0.site, project: f0.project, wellId: f0.wellId, location: f0.location, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset), thisMonth: false });
    this.fetchKpiTiles(hasInitDate
      ? { cluster: f0.cluster, site: f0.site, project: f0.project, location: f0.location, from: f0.startDate, to: f0.endDate }
      : { cluster: f0.cluster, site: f0.site, project: f0.project, location: f0.location, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset) });
    this.fetchOdcWells(hasInitDate
      ? { cluster: f0.cluster, site: f0.site, project: f0.project, wellType: f0.location, wellId: f0.wellId, from: f0.startDate || this.getLast90DaysFrom(), to: f0.endDate || this.getDefaultTo() }
      : { cluster: f0.cluster, site: f0.site, project: f0.project, wellType: f0.location, from: this.getLast90DaysFrom(), to: this.getDefaultTo() });

    // Re-fetch whenever the header date/cluster/well filter changes
    this.filterSub = this.dashboardService.filter$.pipe(skip(1)).subscribe((f: HfbFilter) => {
      // Sync global date preset label from app.component
      this.globalDatePresetLabel = (window as any).__globalDatePresetLabel || 'This Year';
      const hasDate = !!(f.startDate || f.endDate);
      const filters = { cluster: f.cluster, wellId: f.wellId, from: f.startDate || this.getDefaultFrom(), to: f.endDate || this.getDefaultTo() };
      this.fetchCrewsDeployed(filters);
      // fetchActiveWells commented out — kpi-tiles is now the single source for tile data
      // this.fetchActiveWells(hasDate
      //   ? { cluster: f.cluster, site: f.site, project: f.project, wellId: f.wellId, location: f.location, from: f.startDate, to: f.endDate, thisMonth: false }
      //   : { cluster: f.cluster, site: f.site, project: f.project, wellId: f.wellId, location: f.location, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset), thisMonth: false });
      this.fetchKpiTiles(hasDate
        ? { cluster: f.cluster, site: f.site, project: f.project, location: f.location, from: f.startDate, to: f.endDate }
        : { cluster: f.cluster, site: f.site, project: f.project, location: f.location, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset) });
      // Debounce ODC fetch — cancel previous pending call, wait 400ms before firing
      if (this.odcDebounceTimer) clearTimeout(this.odcDebounceTimer);
      const odcFilters = { cluster: f.cluster, site: f.site, project: f.project, wellType: f.location, wellId: f.wellId, from: f.startDate || this.getLast90DaysFrom(), to: f.endDate || this.getDefaultTo() };
      this.odcDebounceTimer = setTimeout(() => this.fetchOdcWells(odcFilters), 400);
      this.fetchWorkloadAnalysis({ cluster: f.cluster, wellId: f.wellId, project: f.project, from: f.startDate || this.wpPresetFrom(this.wpDatePreset), to: f.endDate || this.wpPresetTo(this.wpDatePreset) });
      // Also re-fetch activities progress on filter change
      const hfbNow = (window as any).hfbState;
      if (hfbNow) {
        const wId = hfbNow.well ? hfbNow.well.split('-').pop() : undefined;
        this.fetchActivitiesProgress(
          hfbNow.odc || 'all',
          hfbNow.cluster || undefined,
          wId,
          hfbNow.startDate || f.startDate || this.getDefaultFrom(),
          hfbNow.endDate || f.endDate || this.getDefaultTo()
        );
      }
      const wpWellType = f.cluster && f.location ? f.location : undefined;
      this.fetchWellProgressKpi({ cluster: f.cluster, wellId: f.wellId, wellType: wpWellType, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset) });
      // Drilled Wells tab — use the global date filter when set, fall back to YTD.
      // Reset displayed values immediately so UI reflects the filter change without waiting for API.
      this.dwcData = null;
      this.dwcYtdData = null;
      this.drillBreakdownBacklog = 0;
      this.drillBreakdownAccel   = 0;
      (['dwcTotalWells','dwcCompleted','dwcHold','dwcInProgress','dwcSuspended','dwcCompletionRate'] as const)
        .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
      const dwFrom = f.startDate || this.ytdFrom;
      const dwTo   = f.endDate   || this.ytdTo;
      this.fetchDrilledWellsCompletion({ cluster: f.cluster, wellId: f.wellId, wellType: f.location || undefined, site: f.site || undefined, project: f.project || undefined, from: dwFrom, to: dwTo });
      this.fetchDrilledWellsYtdCompletion({ cluster: f.cluster, wellId: f.wellId, wellType: f.location || undefined, site: f.site || undefined, project: f.project || undefined, from: dwFrom, to: dwTo });
      this.fetchWellProgress({ cluster: f.cluster, wellId: f.wellId, from: this.wpPresetFrom(this.wpDatePreset), to: this.wpPresetTo(this.wpDatePreset) });
       this.fetchCrewPRatingDistribution({ cluster: f.cluster, wellType: f.location || undefined, site: f.site || undefined, project: f.project || undefined, from: f.startDate, to: f.endDate });
      // Re-fetch Critical Dates Timeline with new date range
      this.fetchCriticalDatesTimeline(f.startDate || undefined, f.endDate || undefined, f.location || undefined);
      // Re-fetch Cluster Health — use preset when no explicit date is selected
      this.fetchClusterHealth({
        from:     hasDate ? f.startDate : this.wpPresetFrom(this.wpDatePreset),
        to:       hasDate ? f.endDate   : this.wpPresetTo(this.wpDatePreset),
        wellType: f.location || undefined,
        cluster:  f.cluster  || undefined,
        site:     f.site     || undefined,
        project:  f.project  || undefined,
      });
      // Re-fetch PDO Commissioning Status
      this.fetchCommissioningStatus({ cluster: f.cluster, wellId: f.wellId, from: f.startDate || this.getLast60DaysFrom(), to: f.endDate || this.getDefaultTo(), project: f.project });
      // Re-fetch Buffer Flowlines Ready
      this.fetchBufferFlowlinesReady({ cluster: f.cluster, wellId: f.wellId, from: f.startDate || this.getLast60DaysFrom(), to: f.endDate || this.getDefaultTo(), project: f.project });
      // Re-fetch Due Wells Completion with updated filter (respects global date filter)
      this.fetchDueWellsCompletion({ cluster: f.cluster, location: f.location || undefined, site: f.site || undefined, project: f.project || undefined, wellId: f.wellId, from: dwFrom, to: dwTo });
      // Re-fetch Due Wells Completion Trend (separate API — completion-date based)
      this.fetchDueWellsCompletionTrend({ cluster: f.cluster, location: f.location || undefined, site: f.site || undefined, project: f.project || undefined, wellId: f.wellId, from: dwFrom, to: dwTo });
      // Re-fetch Due Wells Breakdown independently
      this.fetchDueWellsBreakdown({ cluster: f.cluster, wellId: f.wellId, location: f.location || undefined, site: f.site || undefined, project: f.project || undefined, from: f.startDate || undefined, to: f.endDate || undefined });
      // Re-fetch Buffer Location Progress with cluster
      this.fetchBufferLocationProgress(f.cluster || undefined);
      // Re-fetch Pegging & FLAF with cluster/well
 
      this.fetchPeggingStatus({ cluster: f.cluster, wellId: f.wellId, site: f.site || undefined, project: f.project || undefined, wellType: f.location || undefined });
      this.fetchFlafStatus({ cluster: f.cluster, wellId: f.wellId, site: f.site || undefined, project: f.project || undefined, wellType: f.location || undefined });
      this.fetchOverallPeggingStatus({ cluster: f.cluster, wellId: f.wellId, site: f.site || undefined, project: f.project || undefined, wellType: f.location || undefined });
      this.fetchWellDeliveryCycleTime({ cluster: f.cluster, site: f.site, project: f.project, wellType: f.location, from: f.startDate, to: f.endDate });
        this.fetchWpaKpi({ from: f.startDate || this.getDefaultFrom(), to: f.endDate || this.getDefaultTo(), cluster: f.cluster, site: f.site, wellType: f.project ? undefined : f.location, project: f.project, wellId: f.wellId });
      
      // A global Well Type selection switches the active hookup tab; then fetch with the current scope.
      const hookupTab = this.hookupTabForWellType(f.location);
      if (hookupTab) this.wellHookupView = hookupTab;

 
      this.fetchHookupProgress(this.hookupWellType(), this.hookupScope(f));
      // Re-fetch Construction Progress with updated cluster/type/project + date range
      this.fetchConstructionProgress({ cluster: f.cluster || undefined, wellType: f.location || undefined, project: f.project || undefined, from: f.startDate || this.wpPresetFrom(this.wpDatePreset), to: f.endDate || this.wpPresetTo(this.wpDatePreset) });
    });

    // Trigger activities progress via the HFB filter so it uses the current
    // ODC/cluster/well/date state instead of always starting with 'all'.
    const hfb = (window as any).hfbState;
    if (hfb) {
      const wellId = hfb.well ? hfb.well.split('-').pop() : undefined;
      this.fetchActivitiesProgress(
        hfb.odc || 'all',
        hfb.cluster || undefined,
        wellId,
        hfb.startDate || undefined,
        hfb.endDate || undefined
      );
    } else {
      this.fetchActivitiesProgress('all');
    }
    // Fetch Critical Dates Timeline from API — scoped to current HFB dates
    const hfbCdt = (window as any).hfbState;
    this.fetchCriticalDatesTimeline(
      hfbCdt?.startDate || undefined,
      hfbCdt?.endDate   || undefined,
      hfbCdt?.location  || undefined
    );

    // Fetch Cluster Health from API — use Last 90 Days preset on initial load (same as active-wells)
    this.fetchClusterHealth({
      from:     hasInitDate ? f0.startDate : this.wpPresetFrom(this.wpDatePreset),
      to:       hasInitDate ? f0.endDate   : this.wpPresetTo(this.wpDatePreset),
      wellType: f0.location || undefined,
      cluster:  f0.cluster  || undefined,
      site:     f0.site     || undefined,
      project:  f0.project  || undefined,
    });

    // Initial well progress load — always use WP tile's own date preset
    const hfbWp = (window as any).hfbState;
    const wpInitFilters = {
      cluster:  hfbWp?.cluster || undefined,
      wellId:   hfbWp?.well ? hfbWp.well.split('-').pop() : undefined,
      wellType: hfbWp?.cluster && hfbWp?.wellType ? hfbWp.wellType : undefined,
      site:     hfbWp?.site || undefined,
      from:     this.wpPresetFrom(this.wpDatePreset),
      to:       this.wpPresetTo(this.wpDatePreset),
    };

    this.fetchWellProgressKpi(wpInitFilters);
    // Drilled-wells APIs are always current-year scoped — ignore wpInitFilters dates
    this.fetchDrilledWellsCompletion({ cluster: f0.cluster || undefined, wellId: f0.wellId || undefined, wellType: f0.location || undefined, site: f0.site || undefined, project: f0.project || undefined, from: this.ytdFrom, to: this.ytdTo });
    this.fetchWellProgress(wpInitFilters);

    // Fetch PDO Commissioning Status from API
    this.fetchCommissioningStatus({ cluster: f0.cluster || undefined, wellId: f0.wellId || undefined, from: f0.startDate || this.getLast60DaysFrom(), to: f0.endDate || this.getDefaultTo(), project: f0.project || undefined });

    // Fetch Buffer Flowlines Ready from API
    this.fetchBufferFlowlinesReady({ cluster: f0.cluster || undefined, wellId: f0.wellId || undefined, from: f0.startDate || this.getLast60DaysFrom(), to: f0.endDate || this.getDefaultTo(), project: f0.project || undefined });

    // Fetch Commissioning Progress from API
    this.fetchCommissioningProgress();

    // Fetch Well Hookup KPI tiles (Non-Standard) from API
    this.fetchWellHookupKpi();
    // Fetch Well Hookup Progress from API — active tab (honour any global Well Type), current scope.
    const initHookupTab = this.hookupTabForWellType(f0.location);
    if (initHookupTab) this.wellHookupView = initHookupTab;
    this.fetchHookupProgress(this.hookupWellType(), this.hookupScope(f0));

    // Fetch Construction Progress (Flowline & OHL) from API
    const cpf = this.dashboardService.currentFilter;
    this.fetchConstructionProgress({ cluster: f0.cluster || undefined, wellType: f0.location || undefined, project: f0.project || undefined, from: cpf.startDate || this.wpPresetFrom(this.wpDatePreset), to: cpf.endDate || this.wpPresetTo(this.wpDatePreset) });

    // Fetch Buffer Location Construction Progress from API
    this.fetchBufferLocationProgress(f0.cluster || undefined);

    // Fetch Pegging Status from API
    this.fetchPeggingStatus({ cluster: f0.cluster || undefined, site: f0.site || undefined, project: f0.project || undefined, wellType: f0.location || undefined, wellId: f0.wellId || undefined });

    // Fetch FLAF Status from API
    this.fetchFlafStatus({ cluster: f0.cluster || undefined, site: f0.site || undefined, project: f0.project || undefined, wellType: f0.location || undefined, wellId: f0.wellId || undefined });

    // Fetch Overall Pegging Status pie from API
    this.fetchOverallPeggingStatus({ cluster: f0.cluster || undefined, site: f0.site || undefined, project: f0.project || undefined, wellType: f0.location || undefined, wellId: f0.wellId || undefined });

    // Fetch Workload Analysis from API — prefer service filter dates (set by app.component's global preset)
    const hfbWla = (window as any).hfbState;
    const cf = this.dashboardService.currentFilter;
    this.fetchWorkloadAnalysis({
      cluster: hfbWla?.cluster || cf.cluster || undefined,
      wellId: hfbWla?.well ? hfbWla.well.split('-').pop() : undefined,
      project: cf.project || undefined,
      from: cf.startDate || this.wpPresetFrom(this.wpDatePreset),
      to: cf.endDate || this.wpPresetTo(this.wpDatePreset),
    });

    // Fetch Crew P-Rating Distribution from API (retries until cache is enriched)
    this.fetchCrewPRatingDistribution();

    // Fetch Drilled Wells YTD Completion (year-over-year donut) — always current-year scoped
    this.fetchDrilledWellsYtdCompletion({ cluster: f0.cluster || undefined, wellId: f0.wellId || undefined, wellType: f0.location || undefined, site: f0.site || undefined, project: f0.project || undefined, from: this.ytdFrom, to: this.ytdTo });

    // Fetch Due Wells Completion (trend chart + KPI tiles) — respects global date filter
    this.fetchDueWellsCompletion({ cluster: f0.cluster || undefined, location: f0.location || undefined, site: f0.site || undefined, project: f0.project || undefined, wellId: f0.wellId || undefined, from: f0.startDate || this.ytdFrom, to: f0.endDate || this.ytdTo });
    // Fetch Due Wells Completion Trend (separate API — completion-date based)
    this.fetchDueWellsCompletionTrend({ cluster: f0.cluster || undefined, location: f0.location || undefined, site: f0.site || undefined, project: f0.project || undefined, wellId: f0.wellId || undefined, from: f0.startDate || this.ytdFrom, to: f0.endDate || this.ytdTo });
    // Fetch Due Wells Breakdown independently
    this.fetchDueWellsBreakdown({ cluster: f0.cluster || undefined, wellId: f0.wellId || undefined, location: f0.location || undefined, site: f0.site || undefined, project: f0.project || undefined, from: f0.startDate || undefined, to: f0.endDate || undefined });

  }

  fetchCrewsDeployed(filters?: { wellId?: string; cluster?: string; from?: string; to?: string }): void {
    const skelEl = document.querySelector('#page-cmdoverview [data-crew-skel]');
    const contentEl = document.querySelector('#page-cmdoverview [data-crew-content]');

    // Show skeleton, hide content
    if (skelEl) skelEl.classList.remove('kpi-skel-hide');
    if (contentEl) contentEl.classList.add('kpi-skel-hide');

    this.crewsSub?.unsubscribe();
    this.crewsSub = this.dashboardService.getCrewsDeployed(filters).subscribe({
      next: (data: CrewsDeployedKpi) => {
        this.updateCrewsKpi(data);
        // Hide skeleton, show content
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      },
      error: (err) => {
        console.warn('[cmdoverview] crews-deployed API error:', err.message || err);
        // Keep skeleton visible on error — no hardcoded fallback values
      }
    });
  }

  private activitiesRetryCount = 0;
  private activitiesRetryTimer: any;
  private isActivitiesRetry = false;

  fetchActivitiesProgress(odc: string = 'all', cluster?: string, wellId?: string, startDate?: string, endDate?: string): void {
    const skelEl = document.querySelector('#page-cmdoverview [data-act-skel]');
    const contentEl = document.querySelector('#page-cmdoverview [data-act-content]');

    // If this is a fresh call (not a retry), reset retry state
    if (!this.isActivitiesRetry) {
      if (this.activitiesRetryTimer) { clearTimeout(this.activitiesRetryTimer); this.activitiesRetryTimer = null; }
      this.activitiesRetryCount = 0;
    }
    this.isActivitiesRetry = false;

    // Show skeleton, hide content while loading
    if (skelEl) skelEl.classList.remove('kpi-skel-hide');
    if (contentEl) contentEl.classList.add('kpi-skel-hide');

    this.activitiesSub?.unsubscribe();
    this.activitiesSub = this.dashboardService.getActivitiesProgress({ odc, cluster, wellId, startDate, endDate }).subscribe({
      next: (data: ActivitiesProgress) => {
        // If total is 0 and no specific well/cluster filter is applied, backend cache may still be loading
        const hasSpecificFilter = !!wellId || !!cluster;
        if (data.total === 0 && !hasSpecificFilter && this.activitiesRetryCount < 3) {
          this.activitiesRetryCount++;
          if (this.activitiesRetryTimer) clearTimeout(this.activitiesRetryTimer);
          this.activitiesRetryTimer = setTimeout(() => {
            this.isActivitiesRetry = true;
            this.fetchActivitiesProgress(odc, cluster, wellId, startDate, endDate);
          }, 3000);
          return;
        }
        this.activitiesRetryCount = 0;
        try {
          this.updateActivitiesKpi(data);
        } catch (e) {
          console.error('[cmdoverview] updateActivitiesKpi threw:', e);
        }
        // Always hide skeleton, show content
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      },
      error: (err) => {
        console.warn('[cmdoverview] activities-progress API error:', err.message || err);
        // Retry on error (service might still be starting)
        if (this.activitiesRetryCount < 3) {
          this.activitiesRetryCount++;
          if (this.activitiesRetryTimer) clearTimeout(this.activitiesRetryTimer);
          this.activitiesRetryTimer = setTimeout(() => {
            this.isActivitiesRetry = true;
            this.fetchActivitiesProgress(odc, cluster, wellId, startDate, endDate);
          }, 3000);
          return;
        }
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      }
    });
  }

  private updateActivitiesKpi(data: ActivitiesProgress): void {
    const fmtK = (n: number): string => {
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
      return n.toString();
    };
    const setVal = (key: string, val: string) => {
      document.querySelectorAll<HTMLElement>(`#page-cmdoverview [data-hfb-val="${key}"]`)
        .forEach(el => el.textContent = val);
    };
    const setSegFill = (name: string, flex: number) => {
      const el = document.querySelector<HTMLElement>(`#page-cmdoverview [data-hfb-segfill="${name}"]`);
      if (el) el.style.flex = String(flex);
    };

    // Update percentage
    setVal('progress', data.progress.toFixed(1));

    // Update legend counts
    setVal('completed', fmtK(data.completed));
    setVal('inprogress', fmtK(data.inProgress));
    setVal('notstarted', fmtK(data.notStarted));
    setVal('total', fmtK(data.total));

    // Update segment bar proportions
    setSegFill('completed', data.completed);
    setSegFill('inprogress', data.inProgress);
    setSegFill('notstarted', data.notStarted);
  }

  private updateCrewsKpi(data: CrewsDeployedKpi): void {
    const fmt = (globalThis as any).fmtInteger || String;
    const setVal = (key: string, val: string) => {
      document.querySelectorAll<HTMLElement>(`#page-cmdoverview [data-hfb-val="${key}"]`)
        .forEach(el => el.textContent = val);
    };
    const setBar = (name: string, pct: number) => {
      const el = document.querySelector<HTMLElement>(`#page-cmdoverview [data-hfb-bar="${name}"]`);
      if (el) el.style.width = pct + '%';
    };

    setVal('crewsActive', '');
    document.querySelectorAll<HTMLElement>(`#page-cmdoverview [data-hfb-val="crewsActive"]`)
      .forEach(el => el.innerHTML = fmt(data.deployed) + '<span style="color:#29378d;font-size:0.7em">/' + fmt(data.totalCrews) + '</span>');
    setVal('crewsTotal', fmt(data.totalCrews));
    setVal('crewsBreakdown', fmt(data.restRotation) + ' unassigned');
    setBar('crewsRatio', data.utilizationPct);

    // Update subtitle if it exists
    const subtitleEl = document.getElementById('hfbPageSubtitle');
    if (subtitleEl) {
      const text = subtitleEl.textContent || '';
      const match = /^(.*·\s*\d[\d,]*\s*active wells\s*·\s*)\d[\d,]*(.*)/.exec(text);
      if (match) {
        subtitleEl.textContent = match[1] + fmt(data.deployed) + match[2];
      }
    }
  }

  fetchClusterHealth(filters?: { from?: string; to?: string; wellType?: string; cluster?: string; site?: string; project?: string }): void {
    this.dashboardService.getClusterHealth(filters).subscribe({
      next: (data: ClusterHealth) => {
        (window as any)['__clusterHealth__'] = data;
        // Also fetch per-well progress so L2 can show the chart
        this.dashboardService.getClusterWellsProgress(filters?.from, filters?.to, filters?.wellType, filters?.project).subscribe({
          next: (wp) => {
            // Build a map: clusterName → wells[]
            const map: Record<string, any[]> = {};
            wp.forEach(c => { map[c.cluster] = c.wells; });
            (window as any)['__clusterWellsProgress__'] = map;
            // Re-render now that progress data is ready — if user drilled to L2 before this resolved, it will update
            const rerender = (window as any)['renderKpiDonut'];
            if (typeof rerender === 'function') rerender();
          },
          error: () => { /* non-critical */ }
        });
        // Register the per-well stages fetch bridge for renderL3
        (window as any)['__fetchWellStages__'] = (wellId: string) => {
          this.dashboardService.getWellStages(wellId).subscribe({
            next: (resp: WellStagesResponse) => {
              const stagesMap = (window as any)['__wellStages__'] || {};
              stagesMap[resp.wellId] = resp.stages;
              (window as any)['__wellStages__'] = stagesMap;
              const render = (window as any)['renderKpiDonut'];
              if (typeof render === 'function') render();
            },
            error: () => {}
          });
        };
        if ((window as any).kpiDrill) (window as any).kpiDrill = { level: 1, cluster: null, well: null };
        const render = (window as any)['renderKpiDonut'];
        if (typeof render === 'function') render();
      },
      error: (err) => console.warn('[cmdoverview] cluster-health API error:', err.message ?? err)
    });
  }

  fetchCriticalDatesTimeline(from?: string, to?: string, wellType?: string): void {
    // Fetch all pages (up to 200 rows per page) and expose on window for AG Grid renderer
    this.cdtSub?.unsubscribe();
    this.cdtSub = this.dashboardService.getCriticalDatesTimeline(1, 200, from, to, undefined, undefined, wellType).subscribe({
      next: (page) => {
        // Map API items to the row shape expected by renderDashCritDatesGrid
        const rows = page.items.map((item: CriticalDateTimelineItem) => ({
          wellId:      item.wellId,
          stage:       item.stageItem,
          owner:       item.assignee || '',
          dateLabel:   item.dateLabel,
          dateIso:     item.dateLabel,
          actualIso:   item.dateType === 'Actual'   ? item.dateLabel : null,
          forecastIso: item.dateType === 'Forecast' ? item.dateLabel : null,
          plannedIso:  null,
          type:        item.type,
          status:      item.status === 'Completed' ? 'done'
                     : item.status === 'Overdue'   ? 'overdue'
                     : 'upcoming',
          progress:    item.progressPct,
          varDays:     item.varianceDays ?? 0,
          blockers:    0,
          predecessor: item.predecessor || '—',
          predName:    null,
          predActivity:'',
          predStatus:  'planned',
          predProgress: 0
        }));
        (window as any)['__cdtApiRows__'] = rows;

        // Re-render the grid with live data
        const render = (window as any)['renderDashCritDatesGrid'];
        if (typeof render === 'function') render();

        // Update milestone count badge
        const countEl = document.getElementById('dashCdtCount');
        if (countEl) countEl.textContent = rows.length + ' milestones' + (page.hasMore ? '+' : '');
      },
      error: (err) => {
        console.warn('[cmdoverview] critical-dates-timeline API error:', err.message || err);
      }
    });
  }
  fetchCrewPRatingDistribution(filters?: { cluster?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): void {
    if (this.pRatingRetryTimer) { clearTimeout(this.pRatingRetryTimer); this.pRatingRetryTimer = null; }
    this.pRatingSub?.unsubscribe();
    this.pRatingSub = this.dashboardService.getCrewPRatingDistribution(filters).subscribe({
      next: (data: CrewPRatingItem[]) => {
        // Empty array = backend is still in base-load phase (enrichment not yet done).
        // All-P0-P8-zero with no filter = same signal. With a filter, zeros are valid (cluster has no rated crew).
        // In all "not ready" cases, retry in 30s — the backend sets IsEnriched only after
        // PH_PRODUCTIVITY_WEEKLY_REPORT join succeeds, so retrying always converges.
        const hasFilter = filters?.cluster || filters?.site || filters?.wellType || filters?.project;
        const allNamedRatingsZero = data?.filter(d => d.rating !== 'Unrated').every(d => d.crewCount === 0) ?? true;
        const notEnriched = !data || data.length === 0 || (!hasFilter && allNamedRatingsZero);
        if (notEnriched) {
          this.pRatingRetryTimer = setTimeout(() => this.fetchCrewPRatingDistribution(filters), 30000);
          return;
        }
        const total = data.reduce((s, d) => s + d.crewCount, 0);
        const rated = data.filter(d => d.rating !== 'Unrated').reduce((s, d) => s + d.crewCount, 0);
        const pct = total > 0 ? Math.round((rated / total) * 100) : 0;
        // Apply 20% floor — never show 0% (all-Unrated treated as minimum reliability score)
        this.pRatingAvgReliability = pct > 0 ? pct : 20;
        const fn = (window as any)['updateCmdPRatingChart'];
        if (typeof fn === 'function') {
          try { fn(data); } catch (e) { console.error('[cmdoverview] prating chart threw', e); }
        }
      },
      error: (err) => {
        console.warn('[cmdoverview] crew-p-rating-distribution API error:', err.message || err);
        // Retry on error in case backend is still starting
        this.pRatingRetryTimer = setTimeout(() => this.fetchCrewPRatingDistribution(filters), 30000);
      }
    });
  }

  private getDefaultFrom(): string {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getDefaultTo(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getLast60DaysFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 59);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getLast90DaysFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 89);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  fetchWorkloadAnalysis(filters?: { from?: string; to?: string; cluster?: string; wellId?: string; project?: string }): void {
    // Update the WLA card title with the date range
    this.updateWlaTitle(filters?.from, filters?.to);

    const skelEl = document.querySelector('#page-cmdoverview [data-wla-skel]');
    const contentEl = document.querySelector('#page-cmdoverview [data-wla-content]');

    // Show skeleton, hide content
    if (skelEl) skelEl.classList.remove('kpi-skel-hide');
    if (contentEl) contentEl.classList.add('kpi-skel-hide');

    this.workloadSub?.unsubscribe();
    this.workloadSub = this.dashboardService.getWorkloadAnalysis(filters).subscribe({
      next: (res: WorkloadAnalysisResponse) => {
        // Transform API response into the shape the chart builder expects
        const clusterKeyMap: Record<string, string> = {
          'NIMR': 'nimr', 'MARMUL': 'marmul'
        };

        const months: string[] = [];
        const clusters: Record<string, number[]> = { nimr: [], marmul: [] };
        const totDrill: number[] = [];

        // Build per-month arrays from the grouped response
        for (const monthData of res.months) {
          months.push(monthData.label);
          totDrill.push(monthData.totalDrilled);

          // Initialize all clusters to 0 for this month index
          for (const key of Object.keys(clusters)) {
            clusters[key].push(0);
          }
          // Fill in actual completed values
          for (const asset of monthData.assets) {
            const key = clusterKeyMap[asset.name];
            if (key) {
              clusters[key][clusters[key].length - 1] = asset.wellsCompleted;
            }
          }
        }

        // Add Avg/Month column from API summary
        months.push('Avg/Month');
        totDrill.push(res.summary.averageTotalDrilled);
        for (const [assetName, key] of Object.entries(clusterKeyMap)) {
          clusters[key].push(res.summary.averagePerAsset[assetName] || 0);
        }

        // Determine forecast start index (first month where isForecast is true)
        const forecastIdx = res.months.findIndex(d => d.isForecast);

        // Build period date ranges for tooltips
        const periods = res.months.map((m: any) => ({
          start: m.periodStart || '',
          end: m.periodEnd || ''
        }));
        periods.push({ start: '', end: '' }); // Avg/Month has no period

        // Expose on window for the chart builder
        (window as any).__wlaApiData = {
          months,
          clusters,
          totDrill,
          forecastIdx: forecastIdx >= 0 ? forecastIdx : months.length,
          periods
        };

        // Rebuild the chart with live data
        const rebuild = (window as any).buildWlaChart;
        if (typeof rebuild === 'function') rebuild();

        // Hide skeleton, show content
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      },
      error: (err) => {
        console.warn('[cmdoverview] workload-analysis API error:', err.message || err);
        // Hide skeleton, show content on error (fallback)
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      }
    });
  }

  private updateWlaTitle(from?: string, to?: string): void {
    const presetLabel = (window as any).__globalDatePresetLabel as string | undefined;

    if (!from || !to) {
      this.wlaTitle = `Work Load Analysis — ${presetLabel || 'This Year'}`;
    } else if (presetLabel && presetLabel !== 'Custom') {
      this.wlaTitle = `Work Load Analysis — ${presetLabel}`;
    } else {
      const fmtLabel = (dateStr: string): string => {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${d.getDate()} ${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
      };
      const fmtMonth = (dateStr: string): string => {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
      };
      const diffDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
      if (diffDays === 0) {
        this.wlaTitle = `Work Load Analysis — ${fmtLabel(from)}`;
      } else if (diffDays <= 60) {
        this.wlaTitle = `Work Load Analysis — ${fmtLabel(from)} to ${fmtLabel(to)}`;
      } else {
        this.wlaTitle = `Work Load Analysis — ${fmtMonth(from)} to ${fmtMonth(to)}`;
      }
    }

    const today = new Date();
    const toDate = to ? new Date(to) : new Date(today.getFullYear(), 11, 31);
    const hasForecast = toDate > today;
    this.wlaSub = hasForecast
      ? 'Wells completed (actual) / planned (forecast) per month · NIMR · MARMUL · Total'
      : 'Wells completed (actual) per month · NIMR · MARMUL · Total';
  }

  onWrDateChange(): void {
    this.fetchWellsReadiness();
  }

  fetchWellsReadiness(retryCount = 0): void {
    const f = this.dashboardService.currentFilter;
    const fromDate = f.startDate || `${new Date().getFullYear()}-01-01`;
    const toDate = f.endDate || new Date().toISOString().slice(0, 10);
    this.isWrLoading = true;
    this.wellsReadinessSub?.unsubscribe();
    this.wellsReadinessSub = this.dashboardService.getWellsReadiness({ fromDate, toDate, cluster: f.cluster, project: f.project }).subscribe({
      next: (d: WellsReadiness) => {
        this.wellsReadinessData    = d;
        this.funnelOriginalPlan    = d.originalPlan;
        this.funnelFlaf            = d.afterFlafScr;
        this.funnelPdo             = d.cleanTarget;
        this.funnelActual          = d.actualCompleted;
        this.isWrLoading = false;
        setTimeout(() => {
          this.renderFunnelChart();
          this.renderCmdFunnelWaterfall();
          this.renderHookupWaterfalls();
          this.renderHookupCommDonuts();
        }, 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] wells-readiness API error:', err.message || err);
        if (retryCount < 2) {
          setTimeout(() => this.fetchWellsReadiness(retryCount + 1), 1500);
        } else {
          this.isWrLoading = false;
        }
      }
    });
  }

  /** Navigate to All Wells with the given WRO funnel filter applied. */
  navigateToWrKpi(filter: 'plan' | 'flafscr' | 'clean' | 'completed'): void {
    this.router.navigate(['/allwells'], {
      queryParams: { scope: 'overall', filter }
    });
  }

  fetchCommissioningStatus(filters?: { cluster?: string; wellId?: string; from?: string; to?: string; project?: string }): void {
    this.isCommLoading = true;
    this.commData = null;
    this.commSub?.unsubscribe();
    this.commSub = this.dashboardService.getCommissioningStatus(filters).subscribe({
      next: (d: CommissioningStatus) => {
        this.commData = d;
        this.isCommLoading = false;
      },
      error: (err) => {
        console.warn('[cmdoverview] commissioning-status API error:', err.message || err);
        this.isCommLoading = false;
      }
    });
  }

  fetchBufferFlowlinesReady(filters?: { cluster?: string; wellId?: string; from?: string; to?: string; project?: string }): void {
    this.isBufferLoading = true;
    this.bufferData = null;
    this.bufferSub?.unsubscribe();
    this.bufferSub = this.dashboardService.getBufferFlowlinesReady(filters).subscribe({
      next: (d: BufferFlowlinesReady) => {
        this.bufferData = d;
        this.isBufferLoading = false;
        // odcKpiBuffer is now driven by the odc-overall-status SQL API — do not override here.
      },
      error: (err) => {
        console.warn('[cmdoverview] buffer-flowlines-ready API error:', err.message || err);
        this.isBufferLoading = false;
      }
    });
  }

  navigateToAllWells(cluster?: string): void {
    if (cluster) {
      (globalThis as any).__awPendingCluster = cluster;
    }
    (globalThis as any).__awPendingBufferReady = true;
    this.router.navigate(['/allwells']);
  }

  bufferAreaColor(pct: number): string {
    if (pct >= 70) return 'green';
    if (pct >= 30) return 'orange';
    return 'red';
  }

  bufferAsOfFormatted(): string {
    if (!this.bufferData) return '';
    const d = new Date(this.bufferData.asOfDate + 'T10:30:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', 10:30 AM';
  }

  // --- Pegging Status (Construction Well Delivery) ---
  fetchPeggingStatus(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): void {
    this.isPeggingLoading = true;
    this.peggingSub?.unsubscribe();
    this.peggingSub = this.dashboardService.getPeggingStatus({
      year:     new Date().getFullYear(),
      cluster:  filters?.cluster  || undefined,
      site:     filters?.site     || undefined,
      project:  filters?.project  || undefined,
      wellType: filters?.wellType || undefined,
      wellId:   filters?.wellId   || undefined
    }).subscribe({
      next: (d: PeggingStatusResponse) => {
        this.peggingData = d;
        this.isPeggingLoading = false;
        this.computePeggingChart();
      },
      error: (err) => {
        console.warn('[cmdoverview] pegging-status API error:', err.message || err);
        this.isPeggingLoading = false;
      }
    });
  }

  // --- Overall Pegging Status (pie) ---
  fetchOverallPeggingStatus(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): void {
    this.isOverallPeggingLoading = true;
    this.overallPeggingSub?.unsubscribe();
    this.overallPeggingSub = this.dashboardService.getOverallPeggingStatus({
      cluster:  filters?.cluster  || undefined,
      site:     filters?.site     || undefined,
      project:  filters?.project  || undefined,
      wellType: filters?.wellType || undefined,
      wellId:   filters?.wellId   || undefined
    }).subscribe({
      next: (d: OverallPeggingStatus) => {
        this.overallPeggingData = d;
        this.isOverallPeggingLoading = false;
        setTimeout(() => this.renderOverallPeggingPie(), 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] overall-pegging-status API error:', err.message || err);
        this.isOverallPeggingLoading = false;
      }
    });
  }

  /** Overall Pegging Status — Highcharts donut (pegging completed <90d vs >90d before rig-on). */
  private renderOverallPeggingPie(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts) return;
    const el = document.getElementById('overallPeggingPie');
    if (!el) return;
    if (this.overallPeggingChart) { try { this.overallPeggingChart.destroy(); } catch (_) {} }

    const within = this.overallPeggingData?.completedWithin90Days ?? 0;
    const after  = this.overallPeggingData?.completedAfter90Days ?? 0;
    const total  = within + after;
    const self = this;

    this.overallPeggingChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: {
        useHTML: true,
        text: `<div style="text-align:center;line-height:1.1">`
            + `<div style="font-size:26px;font-weight:800;color:#1a1a2e">${total}</div>`
            + `<div style="font-size:10px;color:#888;letter-spacing:.3px">TOTAL DRILLED</div>`
            + `</div>`,
        align: 'center',
        verticalAlign: 'middle',
        y: 6
      },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: {
        useHTML: true,
        headerFormat: '',
        pointFormatter: function (this: any): string {
          const pct = total > 0 ? ((this.y / total) * 100).toFixed(1) : '0.0';
          return `<span style="color:${this.color}">●</span> <b>${this.name}</b><br/>`
               + `${this.y} well${this.y === 1 ? '' : 's'} (${pct}%)<br/>`
               + `<span style="font-size:8pt;color:#888">${this.options.hint}</span>`;
        }
      },
      plotOptions: {
        pie: {
          innerSize: '60%',
          borderWidth: 2,
          borderColor: '#fff',
          cursor: 'pointer',
          point: {
            events: {
              click: function (this: any): void {
                if (this.options.bucket) self.onPeggingSliceClick(this.options.bucket);
              }
            }
          },
          dataLabels: {
            enabled: true,
            formatter: function (this: any): string {
              return this.y > 0 ? `${this.y}` : '';
            },
            style: { fontSize: '10pt', fontWeight: '700', textOutline: 'none' },
            distance: 12
          }
        }
      },
      series: [{
        name: 'Pegging',
        data: [
          { name: 'Pegging completed < 90 days', y: within, color: '#00B050',
            bucket: 'within90', hint: 'Pegged ≤ 90 days before actual rig-on · click to view wells' },
          { name: 'Pegging completed > 90 days', y: after, color: '#ED7D31',
            bucket: 'after90', hint: 'Pegged > 90 days before actual rig-on · click to view wells' }
        ]
      }]
    });
  }

  /** Donut slice click → All Wells page filtered to that pegging bucket. */
  private onPeggingSliceClick(bucket: 'within90' | 'after90'): void {
    // The All Wells page reads this global on init, applies the server-side
    // peggingBucket filter, and clears it. Cluster/well from the header filter
    // persist via DashboardService, so they carry over automatically.
    (globalThis as any).__awPendingPeggingBucket = bucket;
    this.router.navigate(['/allwells']);
  }

  // --- FLAF Status (Construction Well Delivery) ---
  fetchFlafStatus(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string }): void {
    this.isFlafLoading = true;
    this.flafSub?.unsubscribe();
    this.flafSub = this.dashboardService.getFlafStatus({
      year:     new Date().getFullYear(),
      cluster:  filters?.cluster  || undefined,
      site:     filters?.site     || undefined,
      project:  filters?.project  || undefined,
      wellType: filters?.wellType || undefined,
      wellId:   filters?.wellId   || undefined
    }).subscribe({
      next: (d: FlafStatusResponse) => {
        this.flafData = d;
        this.isFlafLoading = false;
        // Compute FLAF gauge rotation
        const gap = d.risk.projectedGap;
        const max = d.risk.gaugeMax || 1;
        const ratio = Math.min(gap / max, 1);
        this.flafGaugeRotation = -90 + ratio * 180;
        setTimeout(() => this.renderFlafHcChart(), 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] flaf-status API error:', err.message || err);
        this.isFlafLoading = false;
      }
    });
  }

  /** Compute pegging gauge + chart paths once (avoids recalc on every CD cycle) */
  private computePeggingChart(): void {
    const empty = { plan: '', actual: '', gap: '', planLine: '', actualLine: '',
      planPoints: [] as { x: number; y: number; val: number }[],
      actualPoints: [] as { x: number; y: number; val: number }[],
      yTicks: [] as { y: number; label: string }[], todayX: 372 };

    if (!this.peggingData) {
      this.peggingGaugeRotation = -90;
      this.peggingChartPaths = empty;
      return;
    }

    // Gauge
    const gap = this.peggingData.risk.projectedGap;
    const max = this.peggingData.risk.gaugeMax || 1;
    const ratio = Math.min(gap / max, 1);
    this.peggingGaugeRotation = -90 + ratio * 180;

    // Chart
    const data = this.peggingData.monthlyTrend;
    if (!data?.length) {
      this.peggingChartPaths = empty;
      return;
    }

    const n = data.length;
    // Chart area: x from 70 to 700, y from 35 (top) to 285 (baseline/zero)
    const chartL = 70, chartR = 700;
    const chartTop = 35, chartBot = 285;
    const chartW = chartR - chartL;
    const chartH = chartBot - chartTop;
    const spacing = n > 1 ? chartW / (n - 1) : chartW;

    // Y-axis: 0 at bottom (chartBot), max at top (chartTop)
    const maxVal = Math.max(...data.map(m => m.planCumulative), 1);
    // Round max up to nice number for grid
    const niceMax = Math.ceil(maxVal / 50) * 50;
    const scaleY = (val: number) => chartBot - (val / niceMax) * chartH;

    // Y-axis tick marks (5 evenly spaced)
    const yTickCount = 5;
    const yTicks: { y: number; label: string }[] = [];
    for (let i = 0; i <= yTickCount; i++) {
      const val = Math.round((niceMax / yTickCount) * i);
      yTicks.push({ y: scaleY(val), label: val.toString() });
    }

    // Data points coordinates
    const points = data.map((m, i) => ({
      x: chartL + i * spacing,
      planY: scaleY(m.planCumulative),
      actualY: scaleY(m.actualCumulative)
    }));

    // Plan filled area (from baseline up to plan line)
    const planCoords = points.map(p => p.x + ' ' + p.planY).join(' L');
    const planPath = 'M' + points[0].x + ' ' + chartBot + ' L' + planCoords + ' L' + points[n - 1].x + ' ' + chartBot + ' Z';

    // Actual filled area (from baseline up to actual line)
    const actualCoords = points.map(p => p.x + ' ' + p.actualY).join(' L');
    const actualPath = 'M' + points[0].x + ' ' + chartBot + ' L' + actualCoords + ' L' + points[n - 1].x + ' ' + chartBot + ' Z';

    // Gap/Backlog area (between actual line and plan line - shows the deficit)
    const gapTop = points.map(p => `${p.x} ${p.planY}`).join(' L');
    const gapBot = [...points].reverse().map(p => `${p.x} ${p.actualY}`).join(' L');
    const gapPath = `M${points[0].x} ${points[0].planY} L${gapTop} L${gapBot} Z`;

    // Lines
    const planLine = 'M' + points.map(p => `${p.x} ${p.planY}`).join(' L');
    const actualLine = 'M' + points.map(p => `${p.x} ${p.actualY}`).join(' L');

    // Data point markers/labels
    const planPoints = data.map((m, i) => ({ x: points[i].x, y: points[i].planY, val: m.planCumulative }));
    const actualPoints = data.map((m, i) => ({ x: points[i].x, y: points[i].actualY, val: m.actualCumulative }));

    // Today X position
    const forecastIdx = data.findIndex(m => m.isForecast);
    const todayX = forecastIdx > 0
      ? (points[forecastIdx - 1].x + points[forecastIdx].x) / 2
      : points[n - 1].x;

    this.peggingChartPaths = { plan: planPath, actual: actualPath, gap: gapPath, planLine, actualLine, planPoints, actualPoints, yTicks, todayX };

    setTimeout(() => this.renderPeggingHcChart(), 0);
  }

  /** Selected chart style for the Pegging / FLAF charts. */
  peggingChartType: string = 'area';
  flafChartType:    string = 'area';
  chartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'area',   label: 'Area' },
    { value: 'line',   label: 'Line' },
    { value: 'spline', label: 'Spline' },
    { value: 'column', label: 'Column' },
    { value: 'bar',    label: 'Bar' }
  ];
  private peggingHcChart: any = null;
  private flafHcChart: any = null;

  onPeggingChartTypeChange(value: string): void {
    this.peggingChartType = value;
    this.renderPeggingHcChart();
  }
  onFlafChartTypeChange(value: string): void {
    this.flafChartType = value;
    this.renderFlafHcChart();
  }

  private renderPeggingHcChart(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.peggingData) return;
    const el = document.getElementById('peggingChartHc');
    if (!el) return;
    if (this.peggingHcChart) { try { this.peggingHcChart.destroy(); } catch (_) {} }

    const data = this.peggingData.monthlyTrend || [];
    const categories = data.map(m => m.monthLabel + (m.isForecast ? ' (F)' : ''));
    const planVals   = data.map(m => m.planCumulative);
    const actualVals = data.map(m => m.actualCumulative);
    const t = this.peggingChartType || 'area';

    this.peggingHcChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '9pt' } },
      xAxis: {
        categories,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Count (Pegging)', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { shared: true },
      plotOptions: {
        series: {
          borderWidth: 0,
          borderRadius: (t === 'column' || t === 'bar') ? 4 : 0,
          marker: (t === 'line' || t === 'spline' || t === 'area') ? { enabled: true, radius: 3 } : undefined,
          fillOpacity: t === 'area' ? 0.3 : undefined
        }
      },
      series: [
        { name: 'Plan – PDO Rig Sequence', data: planVals,   color: '#1F3864' },
        { name: 'Actual – Issued',          data: actualVals, color: '#00B050' }
      ]
    });
  }

  private renderFlafHcChart(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts) return;
    const el = document.getElementById('flafChartHc');
    if (!el) return;
    if (this.flafHcChart) { try { this.flafHcChart.destroy(); } catch (_) {} }

    const data = this.flafData?.monthlyTrend || [];
    const categories = data.length
      ? data.map(m => m.monthLabel + (m.isForecast ? ' (F)' : ''))
      : ['Jan','Feb','Mar','Apr','May','Jun (F)','Jul (F)','Aug (F)','Sep (F)'];
    const planVals   = data.length ? data.map(m => m.planCumulative) : [52, 94, 133, 175, 217, 252, 282, 301, 312];
    const actualVals = data.length ? data.map(m => m.actualCumulative) : [52, 73, 102, 130, 158, 172, 182, 186, 186];
    const t = this.flafChartType || 'area';

    this.flafHcChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '9pt' } },
      xAxis: {
        categories,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Count (FLAF)', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { shared: true },
      plotOptions: {
        series: {
          borderWidth: 0,
          borderRadius: (t === 'column' || t === 'bar') ? 4 : 0,
          marker: (t === 'line' || t === 'spline' || t === 'area') ? { enabled: true, radius: 3 } : undefined,
          fillOpacity: t === 'area' ? 0.3 : undefined
        }
      },
      series: [
        { name: 'Plan – FLAF Submissions', data: planVals,   color: '#1F3864' },
        { name: 'Actual – Submitted',       data: actualVals, color: '#00B050' }
      ]
    });
  }

  // --- Commissioning Progress ---
  fetchCommissioningProgress(): void {
    this.isCommProgLoading = true;
    this.commProgSub?.unsubscribe();
    this.commProgSub = this.dashboardService.getCommissioningProgress().subscribe({
      next: (d: CommissioningProgressResponse) => {
        this.commProgData = d;
        this.isCommProgLoading = false;
        setTimeout(() => this.buildCommProgChart(), 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] commissioning-progress API error:', err.message || err);
        this.isCommProgLoading = false;
      }
    });
  }

  // --- Well Hookup KPI (Non-Standard) ---
  fetchWellHookupKpi(): void {
    this.dashboardService.getWellHookupKpi().subscribe({
      next: (d: WellHookupKpi) => { this.hwpNs = d; },
      error: (err) => console.warn('[cmdoverview] well-hookup-kpi (nonstandard) error:', err.message || err),
    });
    this.dashboardService.getNsHookupWaterfall().subscribe({
      next: (d: NsHookupWaterfall)  => { this.nsWaterfall  = d; },
      error: (err) => console.warn('[cmdoverview] ns-hookup-waterfall error:', err.message || err),
    });
    this.dashboardService.getNsHookupCompletion().subscribe({
      next: (d: NsHookupCompletion) => { this.nsCompletion = d; },
      error: (err) => console.warn('[cmdoverview] ns-hookup-completion error:', err.message || err),
    });
    this.dashboardService.getNsHookupBreakdown().subscribe({
      next: (d: NsHookupBreakdown)  => { this.nsBreakdown  = d; },
      error: (err) => console.warn('[cmdoverview] ns-hookup-breakdown error:', err.message || err),
    });
  }

  /** Returns delta display text and CSS modifier class for a hookup KPI value. */
  hookupDelta(current: number | null | undefined, ly: number | null | undefined, higherIsBetter = true): { text: string; cls: string } {
    if (current == null || ly == null || ly === 0) return { text: '—', cls: 'kpi-delta--neutral' };
    const diff = current - ly;
    if (diff === 0) return { text: `— No change vs LY (${ly})`, cls: 'kpi-delta--neutral' };
    const isGood  = higherIsBetter ? diff > 0 : diff < 0;
    const arrow   = diff > 0 ? '↗' : '↘';
    const sign    = diff > 0 ? '+' : '';
    return { text: `${arrow} ${sign}${diff} vs LY (${ly})`, cls: isGood ? 'kpi-delta--up' : 'kpi-delta--down' };
  }

  /**
   * Funnel-style KPI card values for the Well Hookup tabs.
   * idx: 0 = Conventional, 1 = Non Standard, 2 = Well Conversions.
   * Derived from the same waterfall data that feeds the Plan-to-Actual chart.
   */
  hookupFunnelCards(idx: number): { originalPlan: number; afterFlafScr: number; afterPdo: number; completed: number; backlog: number } {
    const d = this.hookupWaterfallData[idx] || this.hookupWaterfallData[0];
    const afterFlafScr = d.plan - d.flafLoss;
    const afterPdo     = afterFlafScr - d.pdoLoss;
    const completed    = d.actual;
    const backlog      = Math.max(0, afterPdo - completed);
    return { originalPlan: d.plan, afterFlafScr, afterPdo, completed, backlog };
  }

  /** Returns formatted "vs LY" badge text for hookup KPI tiles. */
  hookupKpiLyBadge(current: number, ly: number, format: 'pct' | 'abs' = 'abs'): string {
    if (current === ly) return '— No change vs LY';
    const delta = current - ly;
    const arrow = delta > 0 ? '↗' : '↘';
    if (format === 'pct' && ly > 0) {
      return `${arrow} ${(delta / ly * 100).toFixed(1)}% vs LY (${ly})`;
    }
    return `${arrow} ${delta} vs LY (${ly})`;
  }

  // --- Well Hookup Progress (Conventional) ---
  fetchHookupProgress(wellType: string, scope?: { cluster?: string; site?: string; location?: string; project?: string; from?: string; to?: string }): void {
    this.isHookupProgressLoading = true;
    this.hookupProgressSub?.unsubscribe();
    this.hookupProgressSub = this.dashboardService.getHookupProgress({ wellType, ...scope }).subscribe({
      next: (d: HookupProgressResponse) => {
        this.hookupProgressData = d;
        this.isHookupProgressLoading = false;
        this.syncHookupChartData();
      },
      error: (err) => {
        console.warn('[cmdoverview] hookup-progress API error:', err.message || err);
        this.isHookupProgressLoading = false;
      }
    });
  }

  /** Map API response into the local arrays used by Highcharts renderers. */
  private syncHookupChartData(): void {
    const d = this.hookupProgressData;
    if (!d) return;
    const idx = d.wellType === 'non-standard' ? 1 : d.wellType === 'well-conversions' ? 2 : 0;
    const steps = d.waterfallSteps;
    if (steps.length >= 6) {
      this.hookupWaterfallData[idx] = {
        plan:     steps[0].value,
        flafLoss: Math.abs(steps[1].value),
        pdoLoss:  Math.abs(steps[3].value),
        actual:   steps[5].value
      };
    }
    this.hookupCommDonutPct[idx] = d.overall.overallPct;
    setTimeout(() => {
      this.renderHookupWaterfalls();
      this.renderHookupCommDonuts();
    }, 0);
  }

  get commProgAsOfFormatted(): string {
    if (!this.commProgData) return '';
    const d = new Date(this.commProgData.asOfDate + 'T10:30:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private buildCommProgChart(): void {
    const canvas = document.getElementById('commProgChart') as HTMLCanvasElement;
    if (!canvas || !this.commProgData) return;
    if (this.commProgChart) { this.commProgChart.destroy(); this.commProgChart = null; }

    const data    = this.commProgData.monthlyTrend;
    const labels  = data.map(m => m.monthLabel);
    const fIdx    = data.findIndex(m => m.isForecast);
    const todayIdx = fIdx >= 0 ? fIdx : data.length;

    const todayLinePlugin = {
      id: 'commProgTodayLine',
      afterDraw: (chart: any) => {
        if (todayIdx <= 0 || todayIdx >= data.length) return;
        const xScale = chart.scales['x'];
        const yScale = chart.scales['y'];
        const x = xScale.getPixelForValue(todayIdx - 0.5);
        const ctx = chart.ctx;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, yScale.top);
        ctx.lineTo(x, yScale.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        const tw = ctx.measureText('Today').width + 12;
        const lx = x - tw / 2;
        const ly = yScale.top - 22;
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        (ctx as any).roundRect?.(lx, ly, tw, 18, 4) ?? ctx.rect(lx, ly, tw, 18);
        ctx.fill();
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('Today', x, ly + 13);
        ctx.restore();
      }
    };

    const commType = this.commProgChartType || 'line';
    const commBaseType = commType === 'area' ? 'line' : commType;
    const isCommLine = commType === 'line' || commType === 'area';

    this.commProgChart = new (window as any).Chart(canvas, {
      type: commBaseType,
      data: {
        labels,
        datasets: [
          {
            label: 'Actual Completion (%)',
            data: data.map(m => m.actualCompletionPct),
            borderColor: '#29378d',
            backgroundColor: isCommLine ? 'rgba(41,55,141,0.15)' : '#29378d',
            borderWidth: isCommLine ? 2.5 : 0,
            tension: 0.3,
            pointRadius: isCommLine ? 4 : 0,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#29378d',
            pointBorderWidth: 2,
            fill: commType === 'area' || commType === 'line',
            borderRadius: commBaseType === 'bar' ? 3 : 0,
            segment: isCommLine ? { borderDash: (ctx: any) => ctx.p0DataIndex >= todayIdx ? [5, 3] : undefined } : undefined
          },
          {
            label: 'Plan / Target (100%)',
            data: data.map(() => 100),
            borderColor: '#1F3864',
            backgroundColor: isCommLine ? 'transparent' : '#1F3864',
            borderWidth: isCommLine ? 2 : 0,
            borderDash: isCommLine ? [6, 4] : [],
            pointRadius: isCommLine ? 3 : 0,
            pointBackgroundColor: '#1F3864',
            tension: 0,
            fill: false,
            borderRadius: commBaseType === 'bar' ? 3 : 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            min: 0,
            max: 100,
            ticks: { callback: (v: any) => v + '%' },
            title: { display: false }
          }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
      },
      plugins: isCommLine ? [todayLinePlugin] : []
    });
  }

  /** Selected chart style for PDO Commissioning Progress. */
  commProgChartType: 'line' | 'area' | 'bar' = 'line';
  onCommProgChartTypeChange(value: string): void {
    this.commProgChartType = value as any;
    this.buildCommProgChart();
  }

  // --- Construction Progress (Flowline & OHL) ---
  fetchConstructionProgress(filters?: { cluster?: string; wellType?: string; project?: string; from?: string; to?: string }): void {
    this.isCprogLoading = true;
    this.cprogSub?.unsubscribe();
    // Store current filter state for use when navigating to detail page
    this.cprogCurrentFilters = filters || {};
    this.cprogSub = this.dashboardService.getConstructionProgress({
      cluster:  filters?.cluster  || undefined,
      wellType: filters?.wellType || undefined,
      project:  filters?.project  || undefined,
      from:     filters?.from     || undefined,
      to:       filters?.to       || undefined,
    }).subscribe({
      next: (d: ConstructionProgressResponse) => {
        this.cprogData = d;
        this.isCprogLoading = false;
        setTimeout(() => this.buildCprogChart(), 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] construction-progress API error:', err.message || err);
        this.isCprogLoading = false;
      }
    });
  }

  private cprogCurrentFilters: { cluster?: string; wellType?: string; project?: string; from?: string; to?: string } = {};

  navigateToCprogDetails(filter: 'plan' | 'flafscr' | 'clean' | 'backlog' | 'completed'): void {
    const f = this.cprogCurrentFilters;
    const qp: Record<string, string> = { filter };
    if (f.cluster)  qp['cluster']  = f.cluster;
    if (f.wellType) qp['wellType'] = f.wellType;
    if (f.project)  qp['project']  = f.project;
    if (f.from)     qp['fromDate'] = f.from;
    if (f.to)       qp['toDate']   = f.to;
    this.router.navigate(['/cprog-details'], { queryParams: qp });
  }

  // --- Buffer Location Construction Progress ---
  fetchBufferLocationProgress(cluster?: string): void {
    this.isBlcpLoading = true;
    this.blcpSub?.unsubscribe();
    this.blcpSub = this.dashboardService.getBufferLocationProgress({ year: new Date().getFullYear(), cluster }).subscribe({
      next: (d: BufferLocationProgressResponse) => {
        this.blcpData = d;
        this.isBlcpLoading = false;
        setTimeout(() => this.renderBlcpChart(), 0);
      },
      error: (err) => {
        console.warn('[cmdoverview] buffer-location-progress API error:', err.message || err);
        this.isBlcpLoading = false;
      }
    });
  }

  /** Selected chart style for the Buffer Location Planned-vs-Actual chart. */
  blcpChartType: 'column' | 'bar' | 'line' | 'area' = 'column';
  blcpChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'column', label: 'Column' },
    { value: 'bar',    label: 'Bar' },
    { value: 'line',   label: 'Line' },
    { value: 'area',   label: 'Area' }
  ];
  private blcpChart: any = null;

  onBlcpChartTypeChange(value: string): void {
    this.blcpChartType = value as any;
    this.renderBlcpChart();
  }

  private renderBlcpChart(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts || !this.blcpData) return;
    const el = document.getElementById('blcpBarChartHc');
    if (!el) return;
    if (this.blcpChart) { try { this.blcpChart.destroy(); } catch (_) {} }

    const k = this.blcpData.kpi;
    const t = this.blcpChartType || 'column';
    const baseType = t === 'area' ? 'area' : t;
    const isStack = t === 'column' || t === 'bar';

    const categories = ['As per PDO\nRig Sequence', 'After Pegging /\nSCR Delays', 'After PDO Issues\nResolution', 'Actual Completed\n(Final Delivery)', 'Schedule Variance\n(vs Final Plan)'];

    let series: any[];
    if (isStack) {
      series = [
        { name: 'Due / Plan', color: '#1F3864',
          data: [
            { y: k.rigSequencePlan, color: '#1F3864' },
            { y: k.afterPeggingScr, color: '#29378d' },
            { y: k.cleanTarget,     color: '#29378d' },
            { y: 0, color: '#00B050' },
            { y: 0 }
          ]
        },
        { name: 'Accelerated', color: '#00B0F0',
          data: [
            { y: 0 }, { y: 0 }, { y: 0 },
            { y: 0, color: '#00B0F0' },
            { y: 0 }
          ]
        },
        { name: 'Schedule Variance', color: '#FF0000',
          data: [
            { y: 0 }, { y: 0 }, { y: 0 }, { y: 0 },
            { y: -107, color: '#FF0000' }
          ]
        }
      ];
    } else {
      const values = [k.rigSequencePlan, k.afterPeggingScr, k.cleanTarget, 0, -107];
      const colors = ['#1F3864', '#29378d', '#29378d', '#00B050', '#FF0000'];
      series = [{
        name: 'Wells',
        data: values.map((v, i) => ({ y: v, color: colors[i] }))
      }];
    }

    this.blcpChart = Highcharts.chart(el, {
      chart: { type: baseType, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories,
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Wells', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { shared: true },
      plotOptions: {
        series: {
          stacking: isStack ? 'normal' : undefined,
          borderWidth: 0,
          borderRadius: isStack ? 4 : 0,
          marker: t === 'line' ? { enabled: true, radius: 4 } : undefined,
          fillOpacity: t === 'area' ? 0.25 : undefined,
          dataLabels: {
            enabled: true,
            formatter: function(this: any) {
              if (this.y === 0 || this.y === null) return '';
              return '<b>' + this.y + '</b>';
            },
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
          }
        }
      },
      series
    });
  }

  get cprogAsOfFormatted(): string {
    if (!this.cprogData) return '';
    const d = new Date(this.cprogData.asOfDate + 'T10:30:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', 10:30 AM';
  }

  private buildCprogChart(): void {
    const Highcharts = (window as any).Highcharts;
    if (!Highcharts) return;
    const el = document.getElementById('cprogChart');
    if (!el || !this.cprogData) return;
    if (this.cprogChart) { try { this.cprogChart.destroy(); } catch (_) {} this.cprogChart = null; }

    const data = this.cprogData.monthlyTrend;
    const cf = this.dashboardService.currentFilter;
    const filterFrom = cf.startDate ? new Date(cf.startDate) : new Date(this.cprogData.planYear, 0, 1);
    const filterTo   = cf.endDate   ? new Date(cf.endDate)   : new Date(this.cprogData.planYear, 11, 31);
    const isDayLevel = data.length > 0 && /^\w{3}\s\d{2}$/.test(data[0].monthLabel);

    const labels: string[] = data.map((m: any, idx: number) => {
      if (isDayLevel) return m.monthLabel;
      const yr = filterFrom.getFullYear();
      const mYear = (m.monthNum < filterFrom.getMonth() + 1 && filterTo.getFullYear() > yr)
        ? filterTo.getFullYear() : yr;
      return `${m.monthLabel} ${String(mYear).slice(-2)}`;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const tooltipPeriods: string[] = data.map((m: any, idx: number) => {
      if (isDayLevel) {
        const dayDate = new Date(filterFrom);
        dayDate.setDate(dayDate.getDate() + idx);
        return dayDate > today ? `${fmtDate(dayDate)} (Forecast)` : fmtDate(dayDate);
      }
      const mYear = (m.monthNum < filterFrom.getMonth() + 1 && filterTo.getFullYear() > filterFrom.getFullYear())
        ? filterTo.getFullYear() : filterFrom.getFullYear();
      const monthFirst = new Date(mYear, m.monthNum - 1, 1);
      const monthLast  = new Date(mYear, m.monthNum, 0);
      const periodStart = monthFirst < filterFrom ? filterFrom : monthFirst;
      const periodEnd   = monthLast  > filterTo   ? filterTo   : monthLast;
      if (periodStart > today) return `${fmtDate(periodStart)} \u2013 ${fmtDate(periodEnd)} (Forecast)`;
      const clampedEnd = periodEnd > today ? today : periodEnd;
      const suffix = periodEnd > today ? ` (to ${fmtDate(periodEnd)} Forecast)` : '';
      return `${fmtDate(periodStart)} \u2013 ${fmtDate(clampedEnd)}${suffix}`;
    });

    const fIdx = data.findIndex((m: any) => m.isForecast);
    const forecastCutoff = fIdx >= 0 ? fIdx - 0.5 : data.length;

    const cprogType = this.cprogChartType || 'line';
    const hcType    = cprogType === 'bar' ? 'column' : cprogType === 'area' ? 'area' : 'line';
    const isLineLike = hcType === 'line' || hcType === 'area';

    const seriesDefs = [
      { label: 'Plan \u2013 As per PDO Rig-Sequence',                            color: '#1F3864', data: data.map((m: any) => m.planPdoRigSequenceCumulative),      forecast: true  },
      { label: 'Plan \u2013 Modified as per FLAF (90 Days) and SCR (90 Days)',    color: '#29378d', data: data.map((m: any) => m.planFlafScrAdjustedCumulative),     forecast: true  },
      { label: 'Plan \u2013 Modified and Devoid of any Issues to be Resolved by PDO', color: '#FFC000', data: data.map((m: any) => m.planPdoIssuesRemovedCumulative), forecast: true  },
      { label: 'Actual \u2013 Due Wells Completed',                               color: '#00B050', data: data.map((m: any) => m.actualDueCompletedCumulative),       forecast: false },
      { label: 'Actual \u2013 Non Due Wells Accelerated',                         color: '#00B0F0', data: data.map((m: any) => m.actualNotDueAcceleratedCumulative),  forecast: false },
      { label: 'Backlogs (\u2212) / Extra (+) Against Plan',                      color: '#FF0000', data: data.map((m: any) => m.backlog),                           forecast: false },
    ];

    const series = seriesDefs.map((s, i) => {
      const obj: any = {
        name: s.label,
        type: hcType,
        color: s.color,
        data: s.data,
        visible: !this.cprogHidden[i],
        lineWidth: 2.5,
        marker: isLineLike ? { enabled: true, radius: 4, symbol: 'circle' } : { enabled: false },
        fillOpacity: 0.12,
        dataLabels: {
          enabled: true,
          style: { fontSize: '9px', fontWeight: 'bold', textOutline: 'none', color: s.color },
          y: hcType === 'column' ? -4 : -6,
          formatter: function(this: any) { return this.y != null ? this.y : ''; }
        },
      };
      if (isLineLike && s.forecast && fIdx >= 0 && fIdx < data.length) {
        obj.zoneAxis = 'x';
        obj.zones = [{ value: forecastCutoff }, { dashStyle: 'Dash' }];
      }
      return obj;
    });

    const tooltipPeriodsRef = tooltipPeriods;
    const labelsRef = labels;

    this.cprogChart = Highcharts.chart(el, {
      chart: {
        backgroundColor: 'transparent',
        spacing: [12, 10, 10, 10],
        style: { fontFamily: 'inherit' },
        animation: { duration: 400 }
      },
      title:   { text: undefined },
      credits: { enabled: false },
      legend:  { enabled: false },
      xAxis: {
        categories: labels,
        labels: { style: { fontSize: '9px' } },
        lineColor: 'rgba(0,0,0,0.1)',
        tickColor: 'rgba(0,0,0,0.1)',
        plotLines: (fIdx >= 0 && fIdx < data.length) ? [{
          color: '#6b7280', width: 1.5, value: forecastCutoff,
          dashStyle: 'Dash', zIndex: 5,
          label: {
            text: 'Today', rotation: 0, align: 'center', y: -8,
            style: { fontSize: '9px', fontWeight: '600', color: '#374151' }
          }
        }] : []
      },
      yAxis: {
        title: { text: 'Count (Wells)', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.07)',
        labels: { style: { fontSize: '9px' } }
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function(this: any): string {
          const idx = this.points[0].point.index;
          const header = tooltipPeriodsRef[idx] || labelsRef[idx];
          let html = `<span style="font-size:10px;font-weight:600">${header}</span><br/>`;
          (this.points as any[]).forEach((p: any) => {
            if (p.y == null) return;
            html += `<span style="color:${p.color}">&bull;</span> ` +
                    `<span style="font-size:9px">${p.series.name}: <b>${p.y}</b></span><br/>`;
          });
          return html;
        }
      },
      plotOptions: {
        series:  { connectNulls: true, animation: { duration: 400 } },
        column:  { borderRadius: 3, pointPadding: 0.1, groupPadding: 0.15 }
      },
      series
    });
  }

  /** Selected chart style for Construction Progress. */
  cprogChartType: 'line' | 'area' | 'bar' = 'line';
  onCprogChartTypeChange(value: string): void {
    this.cprogChartType = value as any;
    this.buildCprogChart();
  }

  toggleCprogDataset(index: number): void {
    this.cprogHidden[index] = !this.cprogHidden[index];
    if (this.cprogChart?.series?.[index]) {
      this.cprogChart.series[index].setVisible(!this.cprogHidden[index], true);
    }
  }

  ngOnDestroy(): void {
    if (this._onFsChange) document.removeEventListener('fullscreenchange', this._onFsChange);
    if (document.fullscreenElement) document.exitFullscreen();
    if (this.funnelChart) { this.funnelChart.destroy(); this.funnelChart = null; }
    if (this.cmdFunnelWaterfallChart) { try { this.cmdFunnelWaterfallChart.destroy(); } catch (_) {} this.cmdFunnelWaterfallChart = null; }
    this.hookupWaterfallCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    this.hookupWaterfallCharts = [];
    this.hookupCommDonutCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
    this.hookupCommDonutCharts = [];
    this.crewsSub?.unsubscribe();
    this.activeWellsSub?.unsubscribe();
    this.kpiTilesSub?.unsubscribe();
    this.odcSub?.unsubscribe();
    if (this.odcDebounceTimer) clearTimeout(this.odcDebounceTimer);
    this.filterSub?.unsubscribe();
    this.activitiesSub?.unsubscribe();
    if (this.activitiesRetryTimer) clearTimeout(this.activitiesRetryTimer);
    if (this.wellProgressRetryTimer) clearTimeout(this.wellProgressRetryTimer);
    this.wellProgressSub?.unsubscribe();
    this.wellProgressKpiSub?.unsubscribe();
    this.drilledWellsCompletionSub?.unsubscribe();
    this.drilledWellsBreakdownSub?.unsubscribe();
    this.dwcYtdSub?.unsubscribe();
    this.dueWellsCompletionSub?.unsubscribe();
    this.dueWellsCompletionTrendSub?.unsubscribe();
    delete (window as any).ccWellProgressRows;
    this.workloadSub?.unsubscribe();
    this.pRatingSub?.unsubscribe();
    if (this.pRatingRetryTimer) clearTimeout(this.pRatingRetryTimer);
    this.cdtSub?.unsubscribe();
    this.commSub?.unsubscribe();
    this.bufferSub?.unsubscribe();
    this.cprogSub?.unsubscribe();
    if (this.cprogChart) { this.cprogChart.destroy(); this.cprogChart = null; }
    this._wellsReadinessSub?.unsubscribe();
    this.peggingSub?.unsubscribe();
    this.flafSub?.unsubscribe();
    this.overallPeggingSub?.unsubscribe();
    if (this.overallPeggingChart) { try { this.overallPeggingChart.destroy(); } catch (_) {} this.overallPeggingChart = null; }
    this.wdctSub?.unsubscribe();
    this.wpaSub?.unsubscribe();
    if (this.wpaBreakdownChart) { try { this.wpaBreakdownChart.destroy(); } catch (_) {} this.wpaBreakdownChart = null; }
    if (this.wpaCoverageChart) { try { this.wpaCoverageChart.destroy(); } catch (_) {} this.wpaCoverageChart = null; }
    delete (window as any)._activitiesProgressRefresh;
    delete (window as any).__wlaApiData;
  }

  fetchDueWellsCompletion(filters?: { cluster?: string; location?: string; site?: string; project?: string; wellId?: string; from?: string; to?: string }): void {
    this.dueWellsCompletionSub?.unsubscribe();
    this.isDueKpiLoading = true;
    this.dueWellsCompletionSub = this.dashboardService.getDueWellsCompletion(filters).subscribe({
      next: (d: DueWellsCompletion) => {
        this.isDueKpiLoading = false;
        this.dueWcData = d;
        const set = (id: string, val: string | number) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(val);
        };

        // KPI tiles
        set('dueWcTotal',          d.totalDueWells);
        set('dueWcCompleted',      d.completed);
        set('dueWcInProgress',     d.inProgress);
        set('dueWcSuspended',      d.suspendedWells);
        set('dueWcCompletionRate', d.completionRatePct.toFixed(1) + '%');

        // Sync Well Progress "Due Wells" tile with the same totalDueWells source
        const wpkAtRiskEl = document.getElementById('wpkAtRisk');
        if (wpkAtRiskEl) wpkAtRiskEl.textContent = String(d.totalDueWells);

        // Donut arc — circumference = 2π×60 ≈ 377
        const circ   = 377;
        const arcLen = +(d.commissioningPct / 100 * circ).toFixed(1);
        set('dueWcDonutCenter', d.commissioningPct.toFixed(1) + '%');
        const arcEl = document.getElementById('dueWcDonutArc') as unknown as SVGCircleElement | null;
        if (arcEl) arcEl.setAttribute('stroke-dasharray', `${arcLen} ${circ}`);

        // Trend SVG chart
        const trend   = d.monthlyTrend;
        const chartG  = document.getElementById('dueWellsTrendChart');
        const labelsG = document.getElementById('dueWellsTrendXLabels');
        if (!chartG || !labelsG || !trend?.length) return;
        chartG.innerHTML  = '';
        labelsG.innerHTML = '';

        const n     = trend.length;
        const xMin  = 50, xMax = 540, yMin = 20, yMax = 170;
        const xStep = n > 1 ? (xMax - xMin) / (n - 1) : 0;
        const toY   = (pct: number) => yMax - (pct / 100) * (yMax - yMin);
        const SVG_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const toShortMonth = (raw: string): string => {
          const parts = raw.split('-');
          const mIdx = parts.length >= 2 ? parseInt(parts[1], 10) - 1 : -1;
          return mIdx >= 0 && mIdx < 12 ? SVG_MONTH_NAMES[mIdx] : raw;
        };
        const pts   = trend.map((p, i) => ({
          x: xMin + i * xStep, y: toY(p.cumulativePct),
          pct: p.cumulativePct, label: toShortMonth(p.month)
        }));

        // Area fill
        const areaD = `M${pts[0].x},${yMax} ` +
          pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
          ` L${pts[n - 1].x},${yMax} Z`;
        const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        area.setAttribute('d', areaD);
        area.setAttribute('fill', '#00B050');
        area.setAttribute('fill-opacity', '0.12');
        chartG.appendChild(area);

        // Line
        const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lineEl.setAttribute('d', lineD);
        lineEl.setAttribute('fill', 'none');
        lineEl.setAttribute('stroke', '#00B050');
        lineEl.setAttribute('stroke-width', '2');
        lineEl.setAttribute('stroke-linejoin', 'round');
        lineEl.setAttribute('stroke-linecap', 'round');
        chartG.appendChild(lineEl);

        // Dots with tooltip
        pts.forEach(p => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', p.x.toFixed(1));
          circle.setAttribute('cy', p.y.toFixed(1));
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', '#00B050');
          circle.setAttribute('stroke', '#fff');
          circle.setAttribute('stroke-width', '1.5');
          const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          tip.textContent = `${p.label}: ${p.pct.toFixed(1)}%`;
          circle.appendChild(tip);
          chartG.appendChild(circle);

          // X label
          const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          lbl.setAttribute('x', p.x.toFixed(1));
          lbl.setAttribute('y', '190');
          lbl.textContent = p.label;
          labelsG.appendChild(lbl);
        });

        setTimeout(() => this.renderDueWellsTrendHc(), 0);
      },
      error: (err) => { this.isDueKpiLoading = false; console.warn('[cmdoverview] due-wells-completion error:', err?.message || err); }
    });
  }

  fetchDueWellsCompletionTrend(filters?: { cluster?: string; location?: string; site?: string; project?: string; wellId?: string; from?: string; to?: string }): void {
    this.dueWellsCompletionTrendSub?.unsubscribe();
    this.isDueChartLoading = true;
    this.dueWellsCompletionTrendSub = this.dashboardService.getDueWellsCompletionTrend(filters).subscribe({
      next: (d: DueWellsCompletionTrend) => {
        this.isDueChartLoading = false;
        this.dueWcTrendData = d;
        setTimeout(() => this.renderDueWellsTrendHc(), 0);
      },
      error: (err) => { this.isDueChartLoading = false; console.warn('[cmdoverview] due-wells-completion-trend error:', err?.message || err); }
    });
  }

  /**
   * Dedicated method to populate the Due Wells Breakdown section.
   * Fetches wells independently — isolated from both the ODC flow and the
   * Due Wells Completion API so changes to either cannot break this.
   */
  fetchDueWellsBreakdown(filters?: { cluster?: string; wellId?: string; location?: string; site?: string; project?: string; from?: string; to?: string }): void {
    this.dueWcBreakdownSub?.unsubscribe();
    const todayMs       = Date.now();
    const backlogCutoff = todayMs - 21 * 24 * 60 * 60 * 1000;
    const hasDate       = !!(filters?.from || filters?.to);

    this.dueWcBreakdownSub = this.dashboardService.getWellsList({
      cluster:   filters?.cluster,
      wellId:    filters?.wellId,
      from:      filters?.from,
      to:        filters?.to,
      thisMonth: !hasDate,
    }).subscribe({
      next: (wells: WmrWell[]) => {
        let backlog = 0;
        let accel   = 0;
        // Filter by well type (location) client-side — same pattern as ODC
        const loc = filters?.location?.toLowerCase();
        wells.forEach(w => {
          if (loc && (w.wellType ?? '').toLowerCase() !== loc) return;
          // Backlog: active wells whose rig arrived more than 21 days ago
          const isActive = w.status === 'inprogress' || w.status === 'critical' || w.status === 'atrisk';
          if (isActive && w.rigOnDate) {
            const t = Date.parse(w.rigOnDate);
            if (!isNaN(t) && t <= backlogCutoff) backlog++;
          }
          // Accelerated: wells that completed ahead of schedule
          if (w.status === 'early') accel++;
        });
        this.dueWcBreakdownBacklog = backlog;
        this.dueWcBreakdownAccel   = accel;
      },
      error: (err) => console.warn('[cmdoverview] due-wells-breakdown error:', err?.message || err)
    });
  }

  goToAllWells(): void {
    this.router.navigate(['/allwells']);
  }

  navigateToDwc(filter: 'all' | 'completed' | 'inprogress' | 'suspended'): void {
    (globalThis as any).__dwcPendingCat = filter;
    this.router.navigate(['/drilledwells']);
  }

  navigateToDueWells(filter: 'all' | 'completed' | 'inprogress' | 'suspended'): void {
    (globalThis as any).__duePendingCat = filter;
    this.router.navigate(['/duewells']);
  }

  /** Fetch KPI tile counts from the lightweight /well-progress-kpi endpoint. */
  private fetchWellProgressKpi(filters?: { cluster?: string; wellId?: string; wellType?: string; from?: string; to?: string }): void {
    this.wellProgressKpiSub?.unsubscribe();
    this.wellProgressKpiSub = this.dashboardService.getWellProgressKpi(filters).subscribe({
      next: (kpi: WellProgressKpi) => {
        const fmt = (globalThis as any).fmtInteger || String;
        const setNum = (id: string, v: number) => {
          const el = document.getElementById(id);
          if (el) el.textContent = fmt(v);
        };
        // wpkCritical and wpkAhead are set by updateActiveWellsKpi (same source
        // as Penalty Exposure / Bonus tiles) so they always match.
        // wpkAtRisk is set by fetchDueWellsCompletion (totalDueWells — same as Well Delivery card).
        setNum('wpkOnTrack',  kpi.onTrack);
      },
      error: (err) => console.warn('[cmdoverview] well-progress-kpi error:', err?.message || err)
    });
  }

  /** Fetch Drilled Wells YTD Completion (year-over-year donut) from /drilled-wells-ytd-completion. */
  private fetchDrilledWellsYtdCompletion(filters?: { cluster?: string; wellId?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): void {
    this.dwcYtdSub?.unsubscribe();
    this.dwcYtdSub = this.dashboardService.getDrilledWellsYtdCompletion(filters).subscribe({
      next: (d: DrilledWellsYtdCompletion) => { this.dwcYtdData = d; },
      error: (err) => console.warn('[cmdoverview] drilled-wells-ytd-completion error:', err?.message || err)
    });
  }

  /** SVG donut arc helpers — circumference of r=60 circle ≈ 377. */
  private readonly DWC_CIRC = 377;

  // ── Due Well Completion donut getters ──────────────────────────────────
  dueWcPct(count: number): number {
    const total = this.dueWcData?.totalDueWells ?? 0;
    return total > 0 ? Math.round(count / total * 100 * 10) / 10 : 0;
  }
  private dueWcArc(pct: number): number {
    return Math.round(Math.max(0, Math.min(pct, 100)) / 100 * this.DWC_CIRC);
  }
  get dueWcCompletedArc(): number  { return this.dueWcArc(this.dueWcPct(this.dueWcData?.completed  ?? 0)); }
  get dueWcInProgressArc(): number { return this.dueWcArc(this.dueWcPct(this.dueWcData?.inProgress ?? 0)); }
  get dueWcPendingArc(): number    { return this.dueWcArc(this.dueWcPct(this.dueWcData?.suspendedWells ?? 0)); }
  get dueWcCompletedDash(): string  { return `${this.dueWcCompletedArc} ${this.DWC_CIRC - this.dueWcCompletedArc}`; }
  get dueWcInProgressDash(): string { return `${this.dueWcInProgressArc} ${this.DWC_CIRC - this.dueWcInProgressArc}`; }
  get dueWcPendingDash(): string    { return `${this.dueWcPendingArc} ${this.DWC_CIRC - this.dueWcPendingArc}`; }
  get dueWcCompletedOffset(): number  { return 94; }
  get dueWcInProgressOffset(): number { return 94 - this.dueWcCompletedArc; }
  get dueWcPendingOffset(): number    { return 94 - this.dueWcCompletedArc - this.dueWcInProgressArc; }
  // ───────────────────────────────────────────────────────────────────────

  private dwcArc(pct: number): number {
    return Math.round(Math.max(0, Math.min(pct, 100)) / 100 * this.DWC_CIRC);
  }

  dwcPct(count: number): number {
    const total = this.dwcData?.totalWells ?? 0;
    return total > 0 ? Math.round(count / total * 100 * 10) / 10 : 0;
  }

  get dwcCompletedArc(): number  { return this.dwcArc(this.dwcPct(this.dwcData?.completed  ?? 0)); }
  get dwcInProgressArc(): number { return this.dwcArc(this.dwcPct(this.dwcData?.inProgress ?? 0)); }
  get dwcSuspendedArc(): number    { return this.dwcArc(this.dwcPct(this.dwcData?.suspended ?? 0)); }

  get dwcCompletedDash(): string  { return `${this.dwcCompletedArc} ${this.DWC_CIRC - this.dwcCompletedArc}`; }
  get dwcInProgressDash(): string { return `${this.dwcInProgressArc} ${this.DWC_CIRC - this.dwcInProgressArc}`; }
  get dwcSuspendedDash(): string    { return `${this.dwcSuspendedArc} ${this.DWC_CIRC - this.dwcSuspendedArc}`; }

  // stroke-dashoffset: start at 12-o'clock (offset = CIRC/4 = 94), each segment follows the previous
  get dwcCompletedOffset(): number  { return 94; }
  get dwcInProgressOffset(): number { return 94 - this.dwcCompletedArc; }
  get dwcSuspendedOffset(): number    { return 94 - this.dwcCompletedArc - this.dwcInProgressArc; }

  /** Fetch Drilled Wells Completion KPI tile data from /drilled-wells-completion. */
  private fetchDrilledWellsCompletion(filters?: { cluster?: string; wellId?: string; wellType?: string; site?: string; project?: string; from?: string; to?: string }): void {
    this.drilledWellsCompletionSub?.unsubscribe();
    this.drilledWellsCompletionSub = this.dashboardService.getDrilledWellsCompletion(filters).subscribe({
      next: (d: DrilledWellsCompletion) => {
        this.dwcData = d;
        const setEl = (id: string, val: string) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val;
        };
        setEl('dwcTotalWells',       String(d.totalWells));
        setEl('dwcCompleted',        String(d.completed));
        setEl('dwcHold',             String(d.hold ?? 0));
        setEl('dwcInProgress',       String(d.inProgress));
        setEl('dwcSuspended',        String(d.suspended));
        setEl('dwcCompletionRate',   d.completionRatePct.toFixed(1) + '%');
        setTimeout(() => this.renderDrilledWellsTrendHc(), 0);
      },
      error: (err) => console.warn('[cmdoverview] drilled-wells-completion error:', err?.message || err)
    });
    this.fetchDrilledWellsBreakdown(filters);
  }

  /** Fetch Drilled Wells Breakdown from /drilled-wells-breakdown.
   *  Backend computes: BacklogWells (active, rig on > 21 days ago) and AcceleratedWells (status=early). */
  private fetchDrilledWellsBreakdown(filters?: { cluster?: string; wellId?: string; project?: string; from?: string; to?: string }): void {
    this.drilledWellsBreakdownSub?.unsubscribe();
    this.drilledWellsBreakdownSub = this.dashboardService.getDrilledWellsBreakdown(filters).subscribe({
      next: (d: DrilledWellsBreakdown) => {
        this.drillBreakdownBacklog = d.backlogWells;
        this.drillBreakdownAccel   = d.acceleratedWells;
      },
      error: (err) => console.warn('[cmdoverview] drilled-wells-breakdown error:', err?.message || err)
    });
  }

  /** Load all well-progress data in a single API call. */
  private fetchWellProgress(filters?: { cluster?: string; wellId?: string; from?: string; to?: string }): void {
    // Reset retry state on fresh (non-retry) calls
    if (!this.isWellProgressRetry) {
      if (this.wellProgressRetryTimer) { clearTimeout(this.wellProgressRetryTimer); this.wellProgressRetryTimer = null; }
      this.wellProgressRetryCount = 0;
    }
    this.isWellProgressRetry = false;

    this.wellProgressSub?.unsubscribe();
    // Set to undefined (not []) so renderCcWellGrid shows loading overlay while fetching
    (window as any).ccWellProgressRows = undefined;

    const mapRows = (items: WellProgress[]) => {
      const active = items.filter(r => r.progress >= 1 && r.progress <= 100);
      return active.map(r => {
        const progress = Math.min(100, Math.max(0, r.progress ?? 0));
        const planned  = Math.min(100, Math.max(0, r.planned  ?? 0));
        const variance = Math.round((progress - planned) * 10) / 10;
        let gridStatus: string;
        if (variance > 0)        gridStatus = 'Ahead';
        else if (variance === 0) gridStatus = 'On Track';
        else                     gridStatus = 'Critical';
        return {
          wellId: r.wellId, cluster: r.cluster || '', location: '', wellType: '',
          activityCode: '', activity: r.currentActivity || '',
          crewGroup: r.crewGroup || '', crew: r.crewGroup || '',
          progress, planned, rateDay: r.rate,
          askRate: r.askRate, rigOn: r.rigOn || '',
          status: gridStatus, spi: r.spi, cpi: r.cpi,
        };
      });
    };

    const rerender = () => {
      const fn = (window as any).renderCcWellGrid;
      if (typeof fn === 'function') { try { fn(); } catch (_) {} }
    };

    this.wellProgressSub = this.dashboardService.getWellProgress({ page: 1, pageSize: 1000, ...filters }).subscribe({
      next: (res) => {
        const mapped = mapRows(res.items);
        (window as any).ccWellProgressRows = mapped;
        rerender();
        // If no data returned, backend cache may still be warming up — schedule retry
        if (res.items.length === 0 && this.wellProgressRetryCount < 3) {
          this.wellProgressRetryCount++;
          if (this.wellProgressRetryTimer) clearTimeout(this.wellProgressRetryTimer);
          this.wellProgressRetryTimer = setTimeout(() => {
            this.wellProgressRetryTimer = null;
            if (!((window as any).ccWellProgressRows?.length)) {
              this.isWellProgressRetry = true;
              this.fetchWellProgress(filters);
            }
          }, 3000);
        }
      },
      error: (err) => console.warn('[cmdoverview] well-progress error:', err?.message || err)
    });
  }

  fetchKpiTiles(filters?: { cluster?: string; site?: string; project?: string; location?: string; from?: string; to?: string }): void {
    const skelEl    = document.querySelector('#page-cmdoverview [data-wells-skel]');
    const contentEl = document.querySelector('#page-cmdoverview [data-wells-content]');
    if (skelEl)    skelEl.classList.remove('kpi-skel-hide');
    if (contentEl) contentEl.classList.add('kpi-skel-hide');

    this.kpiTilesSub?.unsubscribe();
    this.kpiTilesSub = this.dashboardService.getKpiTiles({
      cluster:  filters?.cluster,
      site:     filters?.site,
      project:  filters?.project,
      wellType: filters?.location,
      from:     filters?.from,
      to:       filters?.to,
    }).subscribe({
      next: (data: KpiTiles) => {
        this.updateKpiTiles(data);
        if (skelEl)    skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      },
      error: (err) => {
        console.warn('[cmdoverview] kpi-tiles error:', err.message || err);
        if (skelEl)    skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      }
    });
  }

  private updateKpiTiles(data: KpiTiles): void {
    const fmt = (globalThis as any).fmtInteger || String;
    const setVal = (key: string, val: string) =>
      document.querySelectorAll<HTMLElement>(`#page-cmdoverview [data-hfb-val="${key}"]`)
        .forEach(el => el.textContent = val);

    // Tile 1 – Total Wells
    setVal('activeWells',    fmt(data.totalWells));
    setVal('activeCount',    '- ' + fmt(data.activeWells));
    setVal('holdCount',      '- ' + fmt(data.inactiveWells));
    setVal('inProgressCount','- ' + fmt(data.activeWells));

    // Tile 2 – Completed Wells
    setVal('completedWells',   fmt(data.completedWells));
    setVal('dueWellsCount',    '- ' + fmt(data.dueWellsCompleted));
    setVal('notDueWellsCount', '- ' + fmt(data.nonDueWellsCompleted));

    // Tile 3 – Penalty Exposure
    setVal('penaltyAmt',   fmt(data.penaltyExposure));
    setVal('penaltyWells', fmt(data.penaltyExposure));

    // Tile 4 – Bonus Potential
    setVal('bonusAmt',   fmt(data.bonusPotential));
    setVal('bonusWells', fmt(data.bonusPotential));

    // Keep Well Progress KPI tiles in sync
    const setNum = (id: string, v: number) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
    setNum('wpkCritical', data.penaltyExposure);
    setNum('wpkAhead',    data.bonusPotential);
  }

  fetchActiveWells(filters?: { cluster?: string; site?: string; project?: string; wellId?: string; location?: string; from?: string; to?: string; thisMonth?: boolean }): void {
    const skelEl = document.querySelector('#page-cmdoverview [data-wells-skel]');
    const contentEl = document.querySelector('#page-cmdoverview [data-wells-content]');

    // Show skeleton, hide content
    if (skelEl) skelEl.classList.remove('kpi-skel-hide');
    if (contentEl) contentEl.classList.add('kpi-skel-hide');

    this.activeWellsSub?.unsubscribe();
    this.activeWellsSub = this.dashboardService.getActiveWells({
      cluster:   filters?.cluster,
      site:      filters?.site,
      project:   filters?.project,
      wellType:  filters?.location,
      wellId:    filters?.wellId,
      from:      filters?.from,
      to:        filters?.to,
      thisMonth: filters?.thisMonth,
    }).subscribe({
      next: (data: ActiveWellsKpi) => {
        this.updateActiveWellsKpi(data);
        // Hide skeleton, show content
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      },
      error: (err) => {
        console.warn('[cmdoverview] active-wells API error:', err.message || err);
        // Hide skeleton, show content with fallback
        if (skelEl) skelEl.classList.add('kpi-skel-hide');
        if (contentEl) contentEl.classList.remove('kpi-skel-hide');
      }
    });
  }

  private updateActiveWellsKpi(data: ActiveWellsKpi): void {
    const fmt = (globalThis as any).fmtInteger || String;
    const setVal = (key: string, val: string) => {
      document.querySelectorAll<HTMLElement>(`#page-cmdoverview [data-hfb-val="${key}"]`)
        .forEach(el => el.textContent = val);
    };
    const setBar = (name: string, pct: number) => {
      const el = document.querySelector<HTMLElement>(`#page-cmdoverview [data-hfb-bar="${name}"]`);
      if (el) el.style.width = pct + '%';
    };

    // Total Wells tile: big number = active in-field wells (in-progress + on-hold).
    // Completed wells are accounted for in Tile 2, so we use activeToday here
    // so that Active chip + Inactive chip = big number exactly.
    setVal('activeWells', fmt(data.activeToday));
    setVal('activeCount', '- ' + fmt(data.inProgress));
    setVal('inProgressCount', '- ' + fmt(data.inProgress));
    setVal('holdCount', '- ' + fmt(data.onHold));

    const pct = data.totalThisMonth > 0
      ? Math.round(data.activeToday / data.totalThisMonth * 100)
      : 0;
    setBar('activeRatio', pct);

    // Breakdown text under Total Wells
    const parts: string[] = [];
    if (data.inProgress > 0) parts.push(`${fmt(data.inProgress)} in progress`);
    if (data.early > 0)      parts.push(`${fmt(data.early)} critical`);
    if (data.onHold > 0)     parts.push(`${fmt(data.onHold)} on hold`);
    setVal('activeWellsBreakdown', parts.join(' · ') || '—');

    // Completed Wells tile: big number = Completed
    setVal('completedWells', fmt(data.completed));
    setVal('dueWellsCount', '- ' + fmt(data.dueWells));
    setVal('notDueWellsCount', '- ' + fmt(data.notDueWells));

    // Penalty Exposure tile — driven by active-wells critical (variance < 0)
    setVal('penaltyAmt', fmt(data.critical));
    setVal('penaltyWells', fmt(data.critical));

    // Bonus Potential tile — driven by active-wells bonusPotential (variance > 0)
    setVal('bonusAmt', fmt(data.bonusPotential));
    setVal('bonusWells', fmt(data.bonusPotential));

    // Sync Well Progress KPI Critical + Ahead tiles from the same source
    // so they always match Penalty Exposure and Bonus Potential exactly.
    const setNum = (id: string, v: number) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(v);
    };
    setNum('wpkCritical', data.critical ?? 0);
    setNum('wpkAhead',    data.bonusPotential ?? 0);
  }

  fetchOdcWells(filters?: { cluster?: string; site?: string; project?: string; wellType?: string; wellId?: string; from?: string; to?: string }): void {
    this.odcSub?.unsubscribe();
    this.isOdcLoading = true;
    this.odcSub = this.dashboardService.getOdcOverallStatus({ cluster: filters?.cluster, site: filters?.site, wellType: filters?.wellType, project: filters?.project, from: filters?.from, to: filters?.to }).subscribe({
      next: (data: OdcOverallStatus) => {
        this.isOdcLoading = false;
        const fmt = (globalThis as any).fmtInteger || String;
        const set = (id: string, v: number) => {
          const el = document.getElementById(id);
          if (el) el.textContent = fmt(v);
        };
        // Populate all 12 KPI tile DOM elements from the SQL-based API
        set('odcKpiTotalDrilled',  data.totalWells);
        set('odcKpiHookup',        data.hookUpCompleted);
        set('odcKpiDue',           data.dueWells);
        set('odcKpiNotDue',        data.notDueWells);
        set('odcKpiFlafScr',       data.drilledNotCompleted);
        set('odcKpiNotDueAccel',   data.wellsAccelerated);
        set('odcKpiBacklogs',      0);
        set('odcKpiBuffer',        data.bufferWells);
        set('odcKpiDueCompleted',  data.dueWellsCompleted);
        set('odcKpiSuspended',     data.suspendedWells);
        set('odcKpiPdoIssues',     data.pdoIssues);
        set('odcKpiReadyComm',     data.readyForCommissioning);

        // Trigger donut chart rendering with new data
        (window as any).__odcApiData = data;
        if (typeof (window as any).renderOdcOverallStatus === 'function') {
          (window as any).renderOdcOverallStatus();
        }
      },
      error: (err) => {
        this.isOdcLoading = false;
        console.warn('[cmdoverview] odc-overall-status API error:', err.message || err);
      }
    });
  }

  // ─── Widget DB integration / reliability info ───────────────────────────────
  // Keyed by a stable widget id. Add one entry per widget you worked on; the
  // info button + modal are wired generically off this map.
  widgetIntegrationInfo: Record<string, WidgetIntegrationInfo> = {
    overallPegging: {
      title: 'Overall Pegging Status',
      summary: 'Classifies wells with completed pegging by lead time before actual rig-on ' +
               '(≤90 days vs >90 days), from the latest WMR snapshot per well. The DB issues ' +
               'below limit how accurately this can be computed.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium',
          reliabilityPct: 60,
          issues: [
            { field: 'actual_pegged_date', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR free text instead of DATE; needs TRY_CAST. Should be a proper DATE column.' },
            { field: 'actual_rig_on_date', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR instead of DATE; needs TRY_CAST to compare against the pegged date.' },
            { field: 'actual_pegged_date, actual_rig_on_date', category: 'Null Values',
              detail: 'Frequently blank; wells missing either date cannot be classified and are excluded from the total.' },
            { field: 'actual_pegged_date, actual_rig_on_date', category: 'No Standardization',
              detail: 'Mixed/invalid date strings TRY_CAST to NULL silently, so the well count reads lower than reality. A single date format is needed.' },
            { field: 'Week_Number', category: 'No Standardization',
              detail: 'Arrives in mixed date formats; selecting the latest snapshot needs COALESCE of two parse styles. Needs one consistent format.' },
            { field: 'pdo_well_id', category: 'Null Values',
              detail: 'Can be NULL; rows with no well id must be filtered out or they corrupt the per-well grouping.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key / uniqueness — multiple rows exist per well, forcing ROW_NUMBER() to pick the latest. A key (well id + snapshot date) is needed.' }
          ]
        }
      ]
    }
  };

  /**
   * Open the shared right-side DB-issues drawer for a widget. The drawer is
   * defined globally in assets/well-detail-live.js (loaded app-wide), so the
   * same UI is reused across every page and widget.
   */
  openWidgetInfo(id: string): void {
    const info = this.widgetIntegrationInfo[id];
    const show = (window as any).wdWidgetInfoShowData;
    if (info && typeof show === 'function') {
      show(info);
    } else {
      console.warn('[cmdoverview] DB-issues drawer not available for', id);
    }
  }
}

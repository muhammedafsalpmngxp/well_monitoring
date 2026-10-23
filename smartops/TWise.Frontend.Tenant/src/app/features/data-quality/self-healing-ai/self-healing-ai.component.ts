import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type Highcharts from 'highcharts';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';

import { ShaBadgeRendererComponent } from './cell-renderers/sha-badge-renderer.component';
import {
  DataLoadIssue,
  FailingView,
  SelfHealingOverview,
  SelfHealingService,
  ViewRun,
} from '../../../core/services/self-healing.service';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

export interface ShaKpi {
  icon: 'completeness' | 'healed' | 'review' | 'errors' | 'date' | 'confidence';
  accent: 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'purple';
  label: string;
  value: number;
  suffix?: string;
  description: string;
}

/** A failing view or a data load that needs someone to look at it. */
export interface ReviewItem {
  id: string;
  name: string;
  badge: string;
  badgeAccent: 'orange' | 'red';
  detail: string;
  error: string;
  when: string | null;
}

export interface AuditRow {
  when: string;
  source: string;
  type: string;
  caller: string;
  seconds: number;
  rows: number | null;
  status: string;
  error: string;
}

const SHA_GRID_THEME = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#E7ECF3',
  borderRadius: 0,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#F9FAFB',
  headerTextColor: '#667085',
  headerFontWeight: 600,
  rowHoverColor: '#F9FAFB',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

const AXIS_LABELS = { style: { fontSize: '11px', color: '#667085' } };
const LEGEND_ITEM = { fontSize: '12px', fontWeight: '500', color: '#667085' };
const ISSUE_LABELS: Record<DataLoadIssue['issue'], string> = { failed: 'Load failed', refresh_failed: 'Refresh failed', stale: 'Stale' };
const CALLER_LABELS: Record<ViewRun['caller'], string> = { chart: 'Chart / dashboard', preview: 'View run' };

const seconds = (ms: number) => Math.round(ms / 100) / 10;
const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

/**
 * Self-Healing step 1: what is broken or slow. Every chart, dashboard, Ask AI and saved-view load is timed into a run
 * log; this page shows the scan of that log (failing and slow views) and the imports that failed or went stale.
 */
@Component({
  selector: 'app-self-healing-ai',
  standalone: false,
  templateUrl: './self-healing-ai.component.html',
  styleUrls: ['./self-healing-ai.component.scss'],
})
export class SelfHealingAiComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly selfHealing = inject(SelfHealingService);
  private readonly cdr = inject(ChangeDetectorRef);

  overview: SelfHealingOverview | null = null;
  loading = false;
  error = '';

  // ─── Header controls ────────────────────────────────────────────────────
  days: number | null = null;
  showTimeTypeMenu = false;
  get selectedTimeType(): string { return this.days ? `Last ${this.days} Days` : 'Period'; }
  get dayOptions(): number[] { return this.overview?.dayOptions ?? []; }

  // ─── Summary KPIs ────────────────────────────────────────────────────────
  kpis: ShaKpi[] = [];

  // ─── Health check stats ──────────────────────────────────────────────────
  healStats = [
    { label: 'Failures today', value: 0 },
    { label: 'Recovered', value: 0 },
    { label: 'Still failing', value: 0 },
  ];
  get healthy(): boolean { return this.healStats[2].value === 0 && !this.overview?.dataLoads.length; }

  // ─── Needs attention ─────────────────────────────────────────────────────
  reviewItems: ReviewItem[] = [];

  // ─── Run log filters ─────────────────────────────────────────────────────
  auditSearch = '';
  auditStatus = '';
  auditCaller = '';
  readonly statusOptions = ['Failed', 'Slow'];
  readonly callerOptions = Object.values(CALLER_LABELS);

  // ─── Run log AG Grid ─────────────────────────────────────────────────────
  readonly gridTheme = SHA_GRID_THEME;

  readonly auditColumns: ColDef<AuditRow>[] = [
    { headerName: 'When',     field: 'when',    minWidth: 160, flex: 1.2 },
    { headerName: 'Source',   field: 'source',  minWidth: 180, flex: 2 },
    { headerName: 'Type',     field: 'type',    minWidth: 90,  flex: 0.8 },
    { headerName: 'Used by',  field: 'caller',  minWidth: 140, flex: 1 },
    { headerName: 'Time (s)', field: 'seconds', minWidth: 100, flex: 0.8 },
    { headerName: 'Rows',     field: 'rows',    minWidth: 90,  flex: 0.7 },
    { headerName: 'Status',   field: 'status',  minWidth: 110, flex: 0.9, cellRenderer: ShaBadgeRendererComponent },
    { headerName: 'Error',    field: 'error',   minWidth: 240, flex: 3, tooltipField: 'error' },
  ];

  readonly defaultColDef: ColDef<AuditRow> = { sortable: true, resizable: true, flex: 1 };

  private allRows: AuditRow[] = [];

  get filteredRows(): AuditRow[] {
    const q = this.auditSearch.trim().toLowerCase();
    return this.allRows.filter(r =>
      (!q || r.source.toLowerCase().includes(q) || r.error.toLowerCase().includes(q))
      && (!this.auditStatus || r.status === this.auditStatus)
      && (!this.auditCaller || r.caller === this.auditCaller));
  }

  // Pagination (client side over the filtered log)
  pageSize = 20;
  currentPage = 1;
  get totalCount(): number { return this.filteredRows.length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalCount / this.pageSize)); }
  get auditRows(): AuditRow[] { return this.filteredRows.slice((this.currentPage - 1) * this.pageSize, this.currentPage * this.pageSize); }
  get rangeStart(): number { return this.totalCount ? (this.currentPage - 1) * this.pageSize + 1 : 0; }
  get rangeEnd():   number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }
  goToFirstPage(): void { this.currentPage = 1; }
  goToPrevPage():  void { this.currentPage = Math.max(1, this.currentPage - 1); }
  goToNextPage():  void { this.currentPage = Math.min(this.totalPages, this.currentPage + 1); }
  goToLastPage():  void { this.currentPage = this.totalPages; }

  // ─── Highcharts ──────────────────────────────────────────────────────────
  slowViewsOptions: Highcharts.Options = {};
  failuresOptions: Highcharts.Options = {};
  dailyRunsOptions: Highcharts.Options = {};
  dailyTimeOptions: Highcharts.Options = {};

  ngOnInit(): void { this.load(); }

  /** Runs the scan for the selected period (first load: the server's default). */
  load(): void {
    this.loading = true;
    this.error = '';
    this.selfHealing.overview(this.days ?? undefined).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: o => { this.apply(o); this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message ?? 'Could not run the scan. Try again.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private apply(o: SelfHealingOverview): void {
    this.overview = o;
    this.days = o.days;
    const k = o.kpis;
    const success = k.runs ? Math.round(((k.runs - k.failures) / k.runs) * 1000) / 10 : 0;
    this.kpis = [
      { icon: 'completeness', accent: 'blue',   label: 'Loads',            value: k.runs,             description: 'Charts, dashboards and views' },
      { icon: 'healed',       accent: 'green',  label: 'Success Rate',     value: success, suffix: '%', description: 'Loads that returned data' },
      { icon: 'review',       accent: 'yellow', label: 'Slow Loads',       value: k.slowRuns,         description: `${seconds(o.slowMs)} s or longer` },
      { icon: 'errors',       accent: 'red',    label: 'Failed Loads',     value: k.failures,         description: `${k.failingViews} source(s) still failing` },
      { icon: 'date',         accent: 'purple', label: 'Data Load Issues', value: k.dataLoadIssues,   description: 'Failed or stale imports' },
      { icon: 'confidence',   accent: 'orange', label: 'Avg Load Time',    value: seconds(k.avgMs), suffix: ' s', description: `Longest ${seconds(k.maxMs)} s` },
    ];

    const today = new Date().toISOString().slice(0, 10);
    this.healStats = [
      { label: 'Failures today', value: o.daily.find(d => d.day.slice(0, 10) === today)?.failures ?? 0 },
      { label: 'Recovered', value: o.failingViews.filter(f => !f.stillFailing).length },
      { label: 'Still failing', value: k.failingViews },
    ];

    this.reviewItems = [
      ...o.failingViews.filter(f => f.stillFailing).map(f => this.viewItem(f)),
      ...o.dataLoads.map(d => ({
        id: `import-${d.importId}`, name: d.name, badge: ISSUE_LABELS[d.issue], badgeAccent: d.issue === 'stale' ? 'orange' : 'red',
        detail: 'Import', error: d.error ?? (d.issue === 'stale' ? 'Not refreshed recently.' : ''),
        when: d.at ? `${d.issue === 'stale' ? 'Last refreshed' : 'Failed'} ${shortDate(d.at)}` : null,
      } as ReviewItem)),
      ...o.failingViews.filter(f => !f.stillFailing).map(f => this.viewItem(f)),
    ];

    this.allRows = o.log.map(r => ({
      when: shortDate(r.createdAt), source: r.sourceName, type: r.sourceType, caller: CALLER_LABELS[r.caller] ?? r.caller,
      seconds: seconds(r.durationMs), rows: r.rowCount, status: r.error ? 'Failed' : 'Slow', error: r.error ?? '',
    }));
    this.currentPage = 1;
    this.buildCharts(o);
  }

  trackItem(_: number, r: ReviewItem): string { return r.id; }

  private viewItem(f: FailingView): ReviewItem {
    return {
      id: `view-${f.viewId ?? f.sourceName}-${f.sourceType}`, name: f.sourceName,
      badge: f.stillFailing ? 'Still failing' : 'Recovered', badgeAccent: f.stillFailing ? 'red' : 'orange',
      detail: `${f.sourceType} · ${f.failures} of ${f.runs} loads failed`, error: f.lastError ?? '',
      when: `Last failed ${shortDate(f.lastFailedAt)}`,
    };
  }

  private buildCharts(o: SelfHealingOverview): void {
    const days = o.daily.map(d => new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
    const base = { title: { text: undefined }, credits: { enabled: false } };

    this.slowViewsOptions = {
      ...base,
      chart: { type: 'bar', backgroundColor: 'transparent', height: 300 },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom', itemStyle: LEGEND_ITEM },
      xAxis: { categories: o.slowViews.map(v => v.sourceName), lineColor: '#E7ECF3', tickColor: 'transparent', labels: AXIS_LABELS },
      yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6', min: 0, labels: { format: '{value} s', ...AXIS_LABELS } },
      tooltip: { shared: true, valueSuffix: ' s' },
      plotOptions: { bar: { borderWidth: 0, borderRadius: 2, groupPadding: 0.08, pointPadding: 0.04 } },
      series: [
        { type: 'bar', name: 'Average', color: '#FFA726', data: o.slowViews.map(v => seconds(v.avgMs)) },
        { type: 'bar', name: 'Longest', color: '#EF5350', data: o.slowViews.map(v => seconds(v.maxMs)) },
      ],
    };

    const palette = ['#5058C9', '#42A5F5', '#EF5350', '#FFA726', '#66BB6A', '#AB47BC', '#26A69A', '#8D6E63', '#78909C', '#EC407A'];
    this.failuresOptions = {
      ...base,
      chart: { type: 'pie', backgroundColor: 'transparent', height: 280 },
      legend: { enabled: true, align: 'right', verticalAlign: 'middle', layout: 'vertical', itemMarginBottom: 8,
        itemStyle: { fontSize: '13px', fontWeight: '500', color: '#344054' } },
      tooltip: { pointFormat: '<b>{point.y}</b> failed loads ({point.percentage:.0f}%)' },
      plotOptions: { pie: { innerSize: '58%', borderWidth: 2, borderColor: '#fff', dataLabels: { enabled: false }, showInLegend: true } },
      series: [{
        type: 'pie', name: 'Failed loads',
        data: o.failingViews.map((f, i) => ({ name: f.sourceName, y: f.failures, color: palette[i % palette.length] })),
      }],
    };

    this.dailyRunsOptions = {
      ...base,
      chart: { type: 'column', backgroundColor: 'transparent', height: 280 },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom', itemStyle: LEGEND_ITEM },
      xAxis: { categories: days, lineColor: '#E7ECF3', tickColor: 'transparent', labels: AXIS_LABELS },
      yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6', min: 0, allowDecimals: false, labels: AXIS_LABELS },
      tooltip: { shared: true },
      plotOptions: { column: { stacking: 'normal', borderRadius: 3, borderWidth: 0, pointPadding: 0.1, groupPadding: 0.15 } },
      series: [
        { type: 'column', name: 'Succeeded', color: '#66BB6A', data: o.daily.map(d => d.runs - d.failures) },
        { type: 'column', name: 'Failed', color: '#EF5350', data: o.daily.map(d => d.failures) },
      ],
    };

    this.dailyTimeOptions = {
      ...base,
      chart: { type: 'line', backgroundColor: 'transparent', height: 280 },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom', itemStyle: LEGEND_ITEM },
      xAxis: { categories: days, lineColor: '#E7ECF3', tickColor: 'transparent', labels: AXIS_LABELS },
      yAxis: {
        title: { text: undefined }, gridLineColor: '#F1F3F6', min: 0, labels: { format: '{value} s', ...AXIS_LABELS },
        plotLines: [{ value: seconds(o.slowMs), color: '#EF5350', dashStyle: 'Dash', width: 1.5, zIndex: 5,
          label: { text: `Slow: ${seconds(o.slowMs)} s`, align: 'right', x: 0, y: -8, style: { color: '#EF5350', fontSize: '12px', fontWeight: '700' } } }],
      },
      tooltip: { valueSuffix: ' s' },
      series: [{
        type: 'areaspline', name: 'Average load time', color: '#5058C9', lineWidth: 2,
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(80,88,201,0.25)'], [1, 'rgba(80,88,201,0.04)']] },
        data: o.daily.map(d => seconds(d.avgMs)),
        marker: { fillColor: '#fff', lineColor: '#5058C9', lineWidth: 2, radius: 4 },
      }],
    };
  }

  @HostListener('document:click')
  closeMenus(): void { this.showTimeTypeMenu = false; }

  toggleTimeTypeMenu(e: MouseEvent): void {
    e.stopPropagation();
    this.showTimeTypeMenu = !this.showTimeTypeMenu;
  }

  selectDays(days: number): void {
    this.showTimeTypeMenu = false;
    if (days === this.days) return;
    this.days = days;
    this.load();
  }

  onAuditFilterChange(): void { this.currentPage = 1; }

  resetAuditFilters(): void {
    this.auditSearch = '';
    this.auditStatus = '';
    this.auditCaller = '';
    this.currentPage = 1;
  }
}

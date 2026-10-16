import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { CUST_DASHBOARDS, CUST_LS_KEY, allCustWidgets, CustWidget, CustDashboard } from '../../shared/dashboard-widgets';

interface WdPoint { name: string; y: number; color: string; }

@Component({
  selector: 'app-welldashboard',
  templateUrl: './welldashboard.component.html',
  styleUrls: ['./welldashboard.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class WellDashboardComponent implements AfterViewInit, OnDestroy {

  constructor(private router: Router) {}

  // ── Customise-Widgets Drawer (shared registry) ───────────────────────────
  custDrawerOpen = false;
  widgetVisible: Record<string, boolean> = {};

  readonly custDashboards: CustDashboard[] = CUST_DASHBOARDS;
  selectedCategory = 'Built-in';
  /** This page defaults the drawer to its own board. */
  selectedDashboardId = 'well-dashboard';
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
    } catch (_) { /* ignore corrupt/blocked storage */ }
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
    if (route && route !== 'welldashboard' && typeof w.navigate === 'function') w.navigate(route, null);
  }

  /** Row click → scroll the widget into view on this page (flash highlight). */
  drillToWidget(id: string): void {
    if (this.activeDashboard.id !== 'well-dashboard') { this.applyCustomiseAndClose(); return; }
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

  // ═══════════════════════════════════════════════════════════════════════
  // Charts row (Highcharts, same library/height as Operations Dashboard) —
  // each widget gets a chart-style picker, a per-widget filter, and a
  // fullscreen button, matching the Operations Dashboard toolbar.
  // ═══════════════════════════════════════════════════════════════════════
  private Highcharts: any = null;
  private drilledDonutChart: any = null;
  private funnelChart: any = null;
  private execStatusChart: any = null;

  readonly donutData: WdPoint[] = [
    { name: 'Cluster A', y: 70, color: '#2ecc71' },
    { name: 'Cluster B', y: 50, color: '#1a9c4a' },
    { name: 'Cluster C', y: 40, color: '#ED7D31' },
    { name: 'Cluster D', y: 12, color: '#00B050' },
    { name: 'Cluster E', y: 10, color: '#29378d' },
    { name: 'Cluster F', y: 65, color: '#FF0000' },
    { name: 'Cluster G', y: 20, color: '#FFC000' },
  ];
  readonly funnelData: WdPoint[] = [
    { name: 'Wells Planned',                y: 302, color: '#29378d' },
    { name: 'Wells Released for Execution', y: 75,  color: '#ED7D31' },
    { name: 'Wells Spudded',                y: 74,  color: '#FFC000' },
    { name: 'Wells Completed',              y: 25,  color: '#00B050' },
  ];
  readonly execData: WdPoint[] = [
    { name: 'Planned Wells',                 y: 229, color: '#29378d' },
    { name: 'Executed as per Plan',          y: 206, color: '#00B050' },
    { name: 'Executed Not as per Plan',      y: 250, color: '#ED7D31' },
    { name: 'Non Executed as per Plan',      y: 23,  color: '#FF0000' },
  ];

  // Chart-style picker state
  donutChartType: 'doughnut' | 'pie' | 'bar' = 'doughnut';
  funnelChartType: 'funnel' | 'pyramid' | 'column' = 'funnel';
  execChartType: 'column' | 'bar' | 'line' | 'area' = 'column';

  // Per-widget filter state ('all' or a point name)
  donutFilter = 'all';
  funnelFilter = 'all';
  execFilter = 'all';

  /** Which widget's filter popover is open — 'donut' | 'funnel' | 'exec' | null. */
  wfbOpen: string | null = null;

  private _fsCard: HTMLElement | null = null;
  private readonly _onFsChange = () => {
    const isFs = !!document.fullscreenElement;
    const card = this._fsCard;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => {
        if (card) {
          const canvas = card.querySelector('.wd-chart-canvas') as HTMLElement | null;
          const chart = canvas ? this.chartForContainer(canvas.id) : null;
          if (chart) {
            try { chart.update({ chart: { height: isFs ? null : 240 } }); chart.reflow(); } catch (_) { /* ignore */ }
          }
        }
        this.reflowCharts();
        if (!isFs) this._fsCard = null;
      }, 60);
    }));
  };
  private readonly _onDocClick = (ev: Event) => {
    const t = ev.target as HTMLElement;
    if (!t.closest || !t.closest('.wfb-wrap')) this.wfbOpen = null;
  };

  ngAfterViewInit(): void {
    setTimeout(() => this.renderCharts(), 0);
    document.addEventListener('fullscreenchange', this._onFsChange);
    document.addEventListener('click', this._onDocClick);
  }

  ngOnDestroy(): void {
    [this.drilledDonutChart, this.funnelChart, this.execStatusChart].forEach(c => { try { c?.destroy(); } catch (_) { /* ignore */ } });
    document.removeEventListener('fullscreenchange', this._onFsChange);
    document.removeEventListener('click', this._onDocClick);
    if (document.fullscreenElement) document.exitFullscreen();
  }

  private reflowCharts(): void {
    [this.drilledDonutChart, this.funnelChart, this.execStatusChart].forEach(c => { try { c?.reflow(); } catch (_) { /* ignore */ } });
  }

  private chartForContainer(id: string): any {
    if (id === 'wdDrilledDonut') return this.drilledDonutChart;
    if (id === 'wdFunnelChart') return this.funnelChart;
    if (id === 'wdExecStatusChart') return this.execStatusChart;
    return null;
  }

  private renderCharts(): void {
    this.Highcharts = (window as any).Highcharts;
    if (!this.Highcharts) return;
    this.renderDrilledDonut();
    this.renderFunnel();
    this.renderExecStatusBar();
  }

  /** Fullscreen — same native Fullscreen API + reflow pattern as Operations Dashboard. */
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

  /** Per-widget filter popover — open/close, mutually exclusive across widgets. */
  toggleWfb(which: string, event: Event): void {
    event.stopPropagation();
    this.wfbOpen = this.wfbOpen === which ? null : which;
  }

  /** Greys out every point except the selected one (Highcharts has no native per-point opacity fade, so this fakes it with an rgba color). */
  private applyPointFilter(data: WdPoint[], filter: string): any[] {
    if (filter === 'all') return data.map(d => ({ name: d.name, y: d.y, color: d.color }));
    return data.map(d => ({
      name: d.name, y: d.y,
      color: d.name === filter ? d.color : this.dim(d.color)
    }));
  }
  private dim(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},0.18)`;
  }

  setDonutFilter(name: string): void { this.donutFilter = name; this.wfbOpen = null; this.renderDrilledDonut(); }
  setFunnelFilter(name: string): void { this.funnelFilter = name; this.wfbOpen = null; this.renderFunnel(); }
  setExecFilter(name: string): void { this.execFilter = name; this.wfbOpen = null; this.renderExecStatusBar(); }

  onDonutChartTypeChange(value: string): void { this.donutChartType = value as any; this.renderDrilledDonut(); }
  onFunnelChartTypeChange(value: string): void { this.funnelChartType = value as any; this.renderFunnel(); }
  onExecChartTypeChange(value: string): void { this.execChartType = value as any; this.renderExecStatusBar(); }

  private renderDrilledDonut(): void {
    const Highcharts = this.Highcharts;
    const el = document.getElementById('wdDrilledDonut');
    if (!Highcharts || !el) return;
    if (this.drilledDonutChart) { try { this.drilledDonutChart.destroy(); } catch (_) { /* ignore */ } }

    const data = this.applyPointFilter(this.donutData, this.donutFilter);
    const shownTotal = this.donutFilter === 'all'
      ? this.donutData.reduce((n, d) => n + d.y, 0)
      : (this.donutData.find(d => d.name === this.donutFilter)?.y ?? 0);
    const centerLabel = this.donutFilter === 'all' ? 'TOTAL DRILLED' : this.donutFilter.toUpperCase();

    if (this.donutChartType === 'bar') {
      this.drilledDonutChart = Highcharts.chart(el, {
        chart: { type: 'column', backgroundColor: 'transparent', spacing: [10, 10, 10, 10], height: 240 },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        exporting: { enabled: true },
        xAxis: { categories: data.map((d: any) => d.name), labels: { style: { fontSize: '8pt' } } },
        yAxis: { title: { text: 'Wells', style: { fontSize: '9pt' } } },
        tooltip: { pointFormat: '<b>{point.y}</b> wells' },
        plotOptions: {
          series: {
            borderWidth: 0, borderRadius: 4, colorByPoint: true, cursor: 'pointer',
            point: { events: { click: () => this.navigateToDrilledWells() } },
            dataLabels: { enabled: true, style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' } }
          }
        },
        series: [{ name: 'Drilled Wells', data }]
      });
      return;
    }

    this.drilledDonutChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [8, 8, 8, 8], height: 240 },
      title: {
        text: shownTotal + '<br><span style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:.04em">' + centerLabel + '</span>',
        useHTML: true, align: 'center', verticalAlign: 'middle', y: 8,
        style: { color: '#0f2f57', fontSize: '26px', fontWeight: '800' }
      },
      credits: { enabled: false },
      legend: { enabled: false },
      exporting: { enabled: true },
      tooltip: { pointFormat: '<b>{point.y}</b> wells ({point.percentage:.1f}%)' },
      plotOptions: {
        pie: {
          innerSize: this.donutChartType === 'pie' ? '0%' : '68%',
          borderWidth: 2, borderColor: '#fff',
          dataLabels: { enabled: false },
          cursor: 'pointer',
          point: { events: { click: () => this.navigateToDrilledWells() } }
        }
      },
      series: [{ name: 'Drilled Wells', data }]
    });
  }

  private renderFunnel(): void {
    const Highcharts = this.Highcharts;
    const el = document.getElementById('wdFunnelChart');
    if (!Highcharts || !el) return;
    if (this.funnelChart) { try { this.funnelChart.destroy(); } catch (_) { /* ignore */ } }

    const data = this.applyPointFilter(this.funnelData, this.funnelFilter);
    const t = this.funnelChartType;

    if (t === 'column') {
      this.funnelChart = Highcharts.chart(el, {
        chart: { type: 'column', backgroundColor: 'transparent', spacing: [10, 10, 10, 10], height: 240 },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        exporting: { enabled: true },
        xAxis: { categories: data.map((d: any) => d.name), labels: { style: { fontSize: '8pt' } } },
        yAxis: { title: { text: 'Wells', style: { fontSize: '9pt' } } },
        tooltip: { pointFormat: '<b>{point.y}</b> wells' },
        plotOptions: {
          series: {
            borderWidth: 0, borderRadius: 4, colorByPoint: true, cursor: 'pointer',
            point: { events: { click: (e: any) => this.navigateToStage(e.point.name) } },
            dataLabels: { enabled: true, style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' } }
          }
        },
        series: [{ name: 'Wells', data }]
      });
      return;
    }

    // Equal-height bands with a gentle, even width taper — the real (uneven)
    // values only drive the labels/tooltip, not the shape, so one dominant
    // stage doesn't collapse the rest of the funnel into thin slivers.
    const shapeData = data.map((d: any) => ({
      name: d.name, y: 100, color: d.color,
      custom: { realValue: this.funnelData.find(f => f.name === d.name)?.y ?? 0 }
    }));

    this.funnelChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10], height: 240 },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      exporting: { enabled: true },
      tooltip: { pointFormatter: function (this: any): string { return '<b>' + this.custom.realValue + '</b> wells'; } },
      plotOptions: {
        series: {
          dataLabels: {
            enabled: true,
            formatter: function (this: any): string { return '<b>' + this.point.custom.realValue + '</b>'; },
            style: { color: '#fff', fontSize: '14px', fontWeight: '800', textOutline: 'none' },
            inside: true, verticalAlign: 'middle', align: 'center'
          },
          neckWidth: '30%', neckHeight: '0%', width: '80%',
          borderWidth: 1, borderColor: '#fff',
          colorByPoint: true, cursor: 'pointer',
          point: { events: { click: (e: any) => this.navigateToStage(e.point.name) } }
        }
      },
      series: [{ name: 'Wells', data: shapeData }]
    });
  }

  private renderExecStatusBar(): void {
    const Highcharts = this.Highcharts;
    const el = document.getElementById('wdExecStatusChart');
    if (!Highcharts || !el) return;
    if (this.execStatusChart) { try { this.execStatusChart.destroy(); } catch (_) { /* ignore */ } }

    const data = this.applyPointFilter(this.execData, this.execFilter);
    const t = this.execChartType;
    const isLineType = t === 'line' || t === 'area';

    this.execStatusChart = Highcharts.chart(el, {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10], height: 240 },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      exporting: { enabled: true },
      xAxis: {
        categories: data.map((d: any) => d.name), labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)', tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: 'Count', style: { fontSize: '9pt' } },
        gridLineColor: 'rgba(0,0,0,0.06)', labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { pointFormat: '<b>{point.y}</b> wells' },
      plotOptions: {
        series: {
          borderWidth: 0, borderRadius: isLineType ? 0 : 4,
          fillOpacity: t === 'area' ? 0.25 : undefined,
          marker: { enabled: isLineType, radius: 4 },
          colorByPoint: !isLineType, color: isLineType ? '#29378d' : undefined,
          cursor: 'pointer',
          point: { events: { click: (e: any) => this.navigateToStage(e.point.name) } },
          dataLabels: { enabled: true, style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' } }
        }
      },
      series: [{ name: 'Count', data }]
    });
  }

  private navigateToDrilledWells(): void {
    this.router.navigate(['/drilledwells']);
  }
  private navigateToStage(stage: string): void {
    this.router.navigate(['/allwells'], { queryParams: { filter: stage } });
  }
}

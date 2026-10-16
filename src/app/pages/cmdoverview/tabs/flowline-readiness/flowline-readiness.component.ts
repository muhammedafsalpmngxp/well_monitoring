import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, FlowlineReadinessResponse, HfbFilter } from '../../../../services/dashboard.service';

@Component({
  selector: 'app-flowline-readiness',
  templateUrl: './flowline-readiness.component.html',
  styleUrls: ['./flowline-readiness.component.scss']
})
export class FlowlineReadinessComponent implements OnInit, OnDestroy {
  planned = 0;
  flafExcluded = 0;
  pdoExcluded = 0;
  completed = 0;
  isLoading = true;

  private funnelChart: any = null;
  private funnelEl?: HTMLDivElement;
  private backlogPieChart: any = null;
  private backlogPieEl?: HTMLDivElement;
  private waterfallChart: any = null;
  private waterfallEl?: HTMLDivElement;
  private sub?: Subscription;
  private filterSub?: Subscription;

  // Backlog / Acceleration donut data
  backlogAgainstPlan = 12;  // orange slice
  accelerated        = 7;   // green slice

  @ViewChild('funnelChart') set funnelRef(ref: ElementRef<HTMLDivElement> | undefined) {
    if (ref) {
      this.funnelEl = ref.nativeElement;
      if (!this.isLoading) { setTimeout(() => this.renderFunnel(), 0); }
    }
  }

  @ViewChild('backlogPieChart') set backlogPieRef(ref: ElementRef<HTMLDivElement> | undefined) {
    if (ref) {
      this.backlogPieEl = ref.nativeElement;
      if (!this.isLoading) { setTimeout(() => this.renderBacklogPie(), 0); }
    }
  }

  @ViewChild('waterfallChart') set waterfallRef(ref: ElementRef<HTMLDivElement> | undefined) {
    if (ref) {
      this.waterfallEl = ref.nativeElement;
      if (!this.isLoading) { setTimeout(() => this.renderWaterfall(), 0); }
    }
  }

  get afterFlaf(): number { return this.planned - this.flafExcluded; }
  get afterPdo(): number  { return this.afterFlaf - this.pdoExcluded; }
  get vsClean(): number   { return this.completed - this.afterPdo; }

  constructor(private readonly dashboardService: DashboardService, private readonly router: Router) {}

  navigateToAllWells(filter: 'plan' | 'flafscr' | 'clean' | 'completed'): void {
    this.router.navigate(['/wells-readiness-details'], { queryParams: { scope: 'flowline', filter } });
  }

  ngOnInit(): void {
    const f = this.dashboardService.currentFilter;
    this.fetchData(f);
    this.filterSub = this.dashboardService.filter$.pipe(skip(1)).subscribe((f2: HfbFilter) => {
      this.fetchData(f2);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.filterSub?.unsubscribe();
    if (this.funnelChart)     { try { this.funnelChart.destroy(); }     catch (e) { console.warn('Chart cleanup failed', e); } this.funnelChart = null; }
    if (this.backlogPieChart) { try { this.backlogPieChart.destroy(); } catch (e) { console.warn('Chart cleanup failed', e); } this.backlogPieChart = null; }
    if (this.waterfallChart)  { try { this.waterfallChart.destroy(); }  catch (e) { console.warn('Chart cleanup failed', e); } this.waterfallChart = null; }
  }

  private fetchData(f?: HfbFilter): void {
    this.isLoading = true;
    this.sub?.unsubscribe();
    this.sub = this.dashboardService.getFlowlineReadiness({
      year: new Date().getFullYear(),
      cluster: f?.cluster || undefined,
      wellId: f?.wellId || undefined,
      fromDate: f?.startDate || undefined,
      toDate: f?.endDate || undefined,
      project: f?.project || undefined
    }).subscribe({
      next: (res: FlowlineReadinessResponse) => {
        this.planned = res.originalPlan;
        this.flafExcluded = res.flafScrExcluded;
        this.pdoExcluded = res.pdoIssuesExcluded;
        this.completed = res.actualCompleted;

        // Backlog / Acceleration donut
        this.accelerated        = res.actualCompleted || 0;
        this.backlogAgainstPlan = Math.max(0, this.afterPdo - this.completed);

        this.isLoading = false;
        setTimeout(() => { this.renderFunnel(); this.renderBacklogPie(); this.renderWaterfall(); }, 0);
      },
      error: (err) => {
        console.warn('[flowline-readiness] API error:', err.message || err);
        this.isLoading = false;
      }
    });
  }

  funnelChartType: string = 'funnel';
  funnelChartTypeOptions: Array<{ value: string; label: string }> = [
    { value: 'funnel',  label: 'Funnel' },
    { value: 'pyramid', label: 'Pyramid' },
    { value: 'column',  label: 'Column' },
    { value: 'bar',     label: 'Bar' },
    { value: 'pie',     label: 'Pie' }
  ];
  onFunnelChartTypeChange(value: string): void {
    this.funnelChartType = value;
    this.renderFunnel();
  }

  private renderFunnel(retries: number = 8): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.funnelEl;
    if (!Highcharts || !el || el.clientWidth === 0) {
      if (retries > 0) { setTimeout(() => this.renderFunnel(retries - 1), 50); }
      return;
    }
    if (this.funnelChart) { try { this.funnelChart.destroy(); } catch (e) { console.warn('Chart destroy failed', e); } }

    const seriesData = [
      { name: 'Original Plan',                  y: this.planned,    color: '#29378d' },
      { name: 'After FLAF / SCR Delays Removed', y: this.afterFlaf, color: '#ED7D31' },
      { name: 'After PDO Issues Removed',        y: this.afterPdo,  color: '#FFC000' },
      { name: 'Actual Flowlines Completed',      y: this.completed, color: '#00B050' }
    ];
    const allZero = seriesData.every(d => d.y === 0);
    const t = this.funnelChartType || 'funnel';
    const isShape = (t === 'funnel' || t === 'pyramid' || t === 'pie');

    const filterMap: Record<string, string> = {
      'Original Plan': 'plan',
      'After FLAF / SCR Delays Removed': 'flafscr',
      'After PDO Issues Removed': 'clean',
      'Actual Flowlines Completed': 'completed'
    };
    const self = this;
    const cfg: any = {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b> flowlines' },
      plotOptions: {
        series: {
          cursor: 'pointer',
          colorByPoint: true,
          point: { events: { click: function(this: any) { const f = filterMap[this.name]; if (f) self.navigateToAllWells(f as any); } } },
          dataLabels: {
            enabled: true,
            format: '<b>{point.y}</b>',
            style: { color: isShape ? '#fff' : '#1a1a2e', fontSize: '16px', fontWeight: '800', textOutline: 'none' },
            inside: isShape, verticalAlign: 'middle', align: 'center'
          }
        }
      },
      series: [{ name: 'Flowlines', data: seriesData }]
    };
    if (t === 'funnel' || t === 'pyramid') {
      cfg.plotOptions.series.neckWidth = '40%';
      cfg.plotOptions.series.neckHeight = '0%';
      cfg.plotOptions.series.width = '85%';
      // When all zero, use placeholder y:1 so the shape remains visible
      if (allZero) {
        cfg.series = [{ name: 'Flowlines', data: seriesData.map(d => ({
          name: d.name, y: 1, color: d.color + '66'
        })) }];
        cfg.plotOptions.series.dataLabels.format = '<b>0</b>';
        cfg.plotOptions.series.dataLabels.style.color = '#999';
        cfg.plotOptions.series.dataLabels.style.fontSize = '14px';
        cfg.tooltip = { headerFormat: '', pointFormat: '<b>{point.name}</b>: 0 flowlines' };
      }
    }
    if (t === 'column' || t === 'bar') {
      cfg.xAxis = { categories: seriesData.map(d => d.name), labels: { style: { fontSize: '9pt' } } };
      cfg.yAxis = { title: { text: undefined }, gridLineColor: 'rgba(0,0,0,0.06)' };
      cfg.plotOptions.series.dataLabels.inside = false;
      cfg.plotOptions.series.dataLabels.style.color = '#1a1a2e';
      cfg.plotOptions.series.borderRadius = 4;
    }
    this.funnelChart = Highcharts.chart(el, cfg);
  }

  /** Backlog / Acceleration pie chart (Highcharts pie). */
  private renderBacklogPie(retries: number = 8): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.backlogPieEl;
    if (!Highcharts || !el || el.clientWidth === 0) {
      if (retries > 0) { setTimeout(() => this.renderBacklogPie(retries - 1), 50); }
      return;
    }
    if (this.backlogPieChart) { try { this.backlogPieChart.destroy(); } catch (_) {} }
    this.backlogPieChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { headerFormat: '', pointFormat: '<b>{point.name}</b>: {point.y}' },
      plotOptions: {
        pie: {
          innerSize: '0%',
          borderWidth: 0,
          dataLabels: {
            enabled: true,
            format: '<b>{point.y}</b>',
            distance: -34,
            style: { color: '#fff', fontSize: '17px', fontWeight: '800', textOutline: 'none' }
          },
          states: { hover: { halo: { size: 4 } } }
        }
      },
      series: [{
        name: 'Backlog / Acceleration',
        data: [
          { name: 'Backlogs (-) / Extra(+) Against Plan', y: this.backlogAgainstPlan, color: '#ED7D31' },
          { name: 'Actual - Non Due Wells Accelerated',  y: this.accelerated,        color: '#00B050' }
        ]
      }]
    });
  }

  /** Plan to Actual — Highcharts waterfall (uses 'waterfall' series from highcharts-more). */
  private renderWaterfall(retries: number = 8): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.waterfallEl;
    if (!Highcharts || !el || el.clientWidth === 0) {
      if (retries > 0) { setTimeout(() => this.renderWaterfall(retries - 1), 50); }
      return;
    }
    if (this.waterfallChart) { try { this.waterfallChart.destroy(); } catch (_) {} }

    const BLUE   = '#29378d';
    const RED    = '#DC2626';
    const ORANGE = '#F97316';
    const GREEN  = '#16A34A';

    this.waterfallChart = Highcharts.chart(el, {
      chart: { type: 'waterfall', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: ['PDO\nplan', 'FLAF/SCR\n-2', 'After\nFLAF/SCR', 'PDO\nissues -1', 'Clean\ntarget', 'Actual\ncompleted'],
        labels: { style: { fontSize: '8.5pt' } },
        lineColor: 'rgba(0,0,0,0.06)',
        tickColor: 'rgba(0,0,0,0.06)'
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: 'rgba(0,0,0,0.06)',
        labels: { style: { fontSize: '8.5pt' } }
      },
      tooltip: { pointFormat: '<b>{point.y}</b>' },
      plotOptions: {
        series: {
          borderWidth: 0,
          dataLabels: {
            enabled: true,
            inside: false,
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' }
          }
        }
      },
      series: [{
        upColor:   BLUE,
        color:     RED,
        lineWidth: 1,
        dashStyle: 'Dash',
        data: [
          { name: 'PDO plan',          y: 5,                       color: BLUE   },
          { name: 'FLAF/SCR -2',       y: -2,                      color: RED    },
          { name: 'After FLAF/SCR',    isIntermediateSum: true,    color: BLUE   },
          { name: 'PDO issues -1',     y: -1,                      color: ORANGE },
          { name: 'Clean target',      isIntermediateSum: true,    color: ORANGE },
          { name: 'Actual completed',  y: 3,                       color: GREEN  }
        ]
      }]
    });
  }
}

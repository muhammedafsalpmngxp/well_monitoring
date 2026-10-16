import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, HfbFilter, OhlReadinessResponse } from '../../../../services/dashboard.service';

@Component({
  selector: 'app-ohl-readiness',
  templateUrl: './ohl-readiness.component.html',
  styleUrls: ['./ohl-readiness.component.scss']
})
export class OhlReadinessComponent implements OnInit, AfterViewInit, OnDestroy {
  planned = 0;
  flafExcluded = 0;
  pdoExcluded = 0;
  completed = 0;

  @ViewChild('funnelChart') funnelRef?: ElementRef<HTMLDivElement>;
  @ViewChild('backlogPieChart') backlogPieRef?: ElementRef<HTMLDivElement>;
  @ViewChild('waterfallChart') waterfallRef?: ElementRef<HTMLDivElement>;
  private funnelChart: any = null;
  private backlogPieChart: any = null;
  private waterfallChart: any = null;
  private sub?: Subscription;
  private filterSub?: Subscription;
  isLoading = true;

  // Backlog / Acceleration donut
  backlogAgainstPlan = 0;  // orange slice — remaining wells behind clean target
  accelerated        = 0;  // green slice — not due accelerated wells
  get backlogTotal(): number { return this.backlogAgainstPlan + this.accelerated; }

  get afterFlaf(): number { return this.planned - this.flafExcluded; }
  get afterPdo(): number  { return this.afterFlaf - this.pdoExcluded; }
  get vsClean(): number   { return this.completed - this.afterPdo; }

  constructor(private readonly dashboardService: DashboardService, private readonly router: Router) {}

  navigateToAllWells(filter: 'plan' | 'flafscr' | 'clean' | 'completed'): void {
    this.router.navigate(['/wells-readiness-details'], { queryParams: { scope: 'ohl', filter } });
  }

  ngOnInit(): void {
    const f = this.dashboardService.currentFilter;
    this.fetchData(f);
    this.filterSub = this.dashboardService.filter$.pipe(skip(1)).subscribe((f2: HfbFilter) => {
      this.fetchData(f2);
    });
  }

  ngAfterViewInit(): void { /* Charts render after data loads in fetchData() */ }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.filterSub?.unsubscribe();
    if (this.funnelChart)     { try { this.funnelChart.destroy(); }     catch (_) {} this.funnelChart = null; }
    if (this.backlogPieChart) { try { this.backlogPieChart.destroy(); } catch (_) {} this.backlogPieChart = null; }
    if (this.waterfallChart)  { try { this.waterfallChart.destroy(); }  catch (_) {} this.waterfallChart = null; }
  }

  private fetchData(f?: HfbFilter): void {
    this.isLoading = true;
    this.sub?.unsubscribe();
    this.sub = this.dashboardService.getOhlReadiness({
      year: new Date().getFullYear(),
      cluster: f?.cluster || undefined,
      fromDate: f?.startDate || undefined,
      toDate: f?.endDate || undefined,
      project: f?.project || undefined
    }).subscribe({
      next: (d: OhlReadinessResponse) => {
        // Map API response to OHL widget fields
        this.planned       = d.originalPlan;
        this.flafExcluded  = d.flafScrExcluded;
        this.pdoExcluded   = d.pdoIssuesExcluded;
        this.completed     = d.actualCompleted;

        // Backlog / Acceleration donut
        this.accelerated        = d.actualCompleted || 0;
        this.backlogAgainstPlan = Math.max(0, this.afterPdo - this.completed);

        this.isLoading = false;
        setTimeout(() => {
          this.renderFunnel();
          this.renderBacklogPie();
          this.renderWaterfall();
        }, 0);
      },
      error: () => {
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

  private renderFunnel(): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.funnelRef?.nativeElement;
    if (!Highcharts || !el) return;
    if (this.funnelChart) { try { this.funnelChart.destroy(); } catch (_) {} }

    const seriesData = [
      { name: 'Original Plan',                  y: this.planned,    color: '#29378d' },
      { name: 'After FLAF / SCR Delays Removed', y: this.afterFlaf, color: '#ED7D31' },
      { name: 'After PDO Issues Removed',        y: this.afterPdo,  color: '#FFC000' },
      { name: 'Actual OHL Completed',            y: this.completed, color: '#00B050' }
    ];
    const allZero = seriesData.every(d => d.y === 0);
    const t = this.funnelChartType || 'funnel';
    const isShape = (t === 'funnel' || t === 'pyramid' || t === 'pie');

    const filterMap: Record<string, string> = {
      'Original Plan': 'plan',
      'After FLAF / SCR Delays Removed': 'flafscr',
      'After PDO Issues Removed': 'clean',
      'Actual OHL Completed': 'completed'
    };
    const self = this;
    const cfg: any = {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b> OHL units' },
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
      series: [{ name: 'OHL', data: seriesData }]
    };
    if (t === 'funnel' || t === 'pyramid') {
      cfg.plotOptions.series.neckWidth = '40%';
      cfg.plotOptions.series.neckHeight = '0%';
      cfg.plotOptions.series.width = '85%';
      if (allZero) {
        cfg.series = [{ name: 'OHL', data: seriesData.map(d => ({
          name: d.name, y: 1, color: d.color + '66'
        })) }];
        cfg.plotOptions.series.dataLabels.format = '<b>0</b>';
        cfg.plotOptions.series.dataLabels.style.color = '#999';
        cfg.plotOptions.series.dataLabels.style.fontSize = '14px';
        cfg.tooltip = { headerFormat: '', pointFormat: '<b>{point.name}</b>: 0 OHL units' };
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

  /** Backlog / Acceleration donut chart (Highcharts pie). */
  private renderBacklogPie(): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.backlogPieRef?.nativeElement;
    if (!Highcharts || !el) return;
    if (this.backlogPieChart) { try { this.backlogPieChart.destroy(); } catch (_) {} }
    this.backlogPieChart = Highcharts.chart(el, {
      chart: { type: 'pie', backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.name}</b>: {point.y}' },
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
  private renderWaterfall(): void {
    const Highcharts = (window as any).Highcharts;
    const el = this.waterfallRef?.nativeElement;
    if (!Highcharts || !el) return;
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
        categories: ['PDO\nplan', `FLAF/SCR\n-${this.flafExcluded}`, 'After\nFLAF/SCR', `PDO\nissues -${this.pdoExcluded}`, 'Clean\ntarget', 'Actual\ncompleted'],
        labels: { style: { fontSize: '8.5pt', color: 'var(--txt-muted)' } },
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
            style: { fontSize: '9pt', fontWeight: '700', textOutline: 'none' },
            formatter: function(this: any) {
              if (this.point.isIntermediateSum || this.point.isSum) return this.y;
              return (this.y > 0 ? '' : '') + this.y;
            }
          }
        }
      },
      series: [{
        upColor:   BLUE,
        color:     RED,
        lineWidth: 1,
        dashStyle: 'Dash',
        data: [
          { name: 'PDO plan',          y: this.planned,                  color: BLUE   },
          { name: `FLAF/SCR -${this.flafExcluded}`, y: -this.flafExcluded, color: RED    },
          { name: 'After FLAF/SCR',    isIntermediateSum: true,          color: BLUE   },
          { name: `PDO issues -${this.pdoExcluded}`, y: -this.pdoExcluded, color: ORANGE },
          { name: 'Clean target',      isIntermediateSum: true,          color: ORANGE },
          { name: 'Actual completed',  y: this.completed - this.afterPdo, color: GREEN  }
        ]
      }]
    });
  }
}

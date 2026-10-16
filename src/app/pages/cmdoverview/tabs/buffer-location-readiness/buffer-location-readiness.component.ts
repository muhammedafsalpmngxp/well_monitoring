import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { DashboardService, BufferLocationProgressResponse } from '../../../../services/dashboard.service';

@Component({
  selector: 'app-buffer-location-readiness',
  templateUrl: './buffer-location-readiness.component.html',
  styleUrls: ['./buffer-location-readiness.component.scss']
})
export class BufferLocationReadinessComponent implements OnInit, OnDestroy {
  planned = 0;
  flafExcluded = 0;
  pdoExcluded = 0;
  completed = 0;

  @ViewChild('funnelChart') funnelRef?: ElementRef<HTMLDivElement>;
  @ViewChild('backlogPieChart') backlogPieRef?: ElementRef<HTMLDivElement>;
  private funnelChart: any = null;
  private backlogPieChart: any = null;
  private apiSub?: Subscription;
  private filterSub?: Subscription;

  // Backlog / Acceleration donut — left side of the funnel section
  backlogAgainstPlan = 0;  // orange slice
  accelerated        = 0;   // green slice
  get backlogTotal(): number { return this.backlogAgainstPlan + this.accelerated; }

  get afterFlaf(): number { return this.planned - this.flafExcluded; }
  get afterPdo(): number  { return this.afterFlaf - this.pdoExcluded; }
  get vsClean(): number   { return this.completed - this.afterPdo; }

  constructor(private dashboardService: DashboardService, private readonly router: Router) {}

  navigateToAllWells(filter: 'plan' | 'flafscr' | 'clean' | 'completed'): void {
    this.router.navigate(['/wells-readiness-details'], { queryParams: { scope: 'buffer', filter } });
  }

  ngOnInit(): void {
    this.fetchData();
    this.filterSub = this.dashboardService.filter$.pipe(skip(1)).subscribe(() => {
      this.fetchData();
    });
  }

  private fetchData(): void {
    const cluster = this.dashboardService.currentFilter?.cluster || undefined;
    const project = this.dashboardService.currentFilter?.project || undefined;
    this.apiSub?.unsubscribe();
    const year = new Date().getFullYear();
    this.apiSub = this.dashboardService.getBufferLocationProgress({ year, cluster, project, fromDate: `${year}-01-01`, toDate: `${year}-12-31` }).subscribe({
      next: (res: BufferLocationProgressResponse) => {
        const k = res.kpi;
        this.planned = k.rigSequencePlan;
        this.flafExcluded = k.peggingScrExcluded;
        this.pdoExcluded = k.afterPeggingScr - k.cleanTarget;
        this.completed = k.actualCompleted;
        // Backlog Against Plan = remaining wells to meet clean target
        this.backlogAgainstPlan = Math.max(0, k.cleanTarget - k.actualCompleted);
        this.accelerated = k.accelerated;
        setTimeout(() => {
          this.renderFunnel();
          this.renderBacklogPie();
        }, 0);
      },
      error: (err) => {
        console.warn('[buffer-location-readiness] API error:', err.message || err);
      }
    });
  }

  ngOnDestroy(): void {
    this.apiSub?.unsubscribe();
    this.filterSub?.unsubscribe();
    if (this.funnelChart)     { try { this.funnelChart.destroy(); }     catch (_) {} this.funnelChart = null; }
    if (this.backlogPieChart) { try { this.backlogPieChart.destroy(); } catch (_) {} this.backlogPieChart = null; }
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
      { name: 'Actual Buffer Location Completed', y: this.completed, color: '#00B050' }
    ];
    const allZero = seriesData.every(d => d.y === 0);
    const t = this.funnelChartType || 'funnel';
    const isShape = (t === 'funnel' || t === 'pyramid' || t === 'pie');

    const filterMap: Record<string, string> = {
      'Original Plan': 'plan',
      'After FLAF / SCR Delays Removed': 'flafscr',
      'After PDO Issues Removed': 'clean',
      'Actual Buffer Location Completed': 'completed'
    };
    const self = this;
    const cfg: any = {
      chart: { type: t, backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b> Buffer Location units' },
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
      series: [{ name: 'Buffer Location', data: seriesData }]
    };
    if (t === 'funnel' || t === 'pyramid') {
      cfg.plotOptions.series.neckWidth = '40%';
      cfg.plotOptions.series.neckHeight = '0%';
      cfg.plotOptions.series.width = '85%';
      if (allZero) {
        cfg.series = [{ name: 'Buffer Location', data: seriesData.map(d => ({
          name: d.name, y: 1, color: d.color + '66'
        })) }];
        cfg.plotOptions.series.dataLabels.format = '<b>0</b>';
        cfg.plotOptions.series.dataLabels.style.color = '#999';
        cfg.plotOptions.series.dataLabels.style.fontSize = '14px';
        cfg.tooltip = { headerFormat: '', pointFormat: '<b>{point.name}</b>: 0 units' };
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
}

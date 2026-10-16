import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';

declare var Chart: any;
declare var agGrid: any;

export interface TopDelayedJob {
  wellId: string; category: string; plan: number; actual: number; variance: number; targetEnd: string;
}
export interface GanttRow {
  wellId: string; category: string; progress: string;
  type: 'overdue' | 'within30' | 'within60' | 'after60';
  label: string; barPct: number;
}

@Component({
  selector: 'app-job-progress',
  templateUrl: './job-progress.component.html',
  styleUrls: ['./job-progress.component.scss']
})
export class JobProgressComponent implements AfterViewInit, OnDestroy {

  @ViewChild('weeklyTrendChart') weeklyTrendRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sCurveChart')      sCurveRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('revPhysChart')     revPhysRef!: ElementRef<HTMLCanvasElement>;

  private charts: any[] = [];
  private delayedGrid: any = null;

  // ── KPI ──────────────────────────────────────────────────────────────────
  overallProgress = 8.76;
  overallVsPlan   = -23.91;
  totalJobs       = 240;
  delayedJobs     = 174;
  delayedJobsPct  = 72.5;
  revenueAchieved = '0.96M';
  revenuePlanned  = '10.97M';
  revenuePct      = 8.76;
  upcomingEnds    = 27;

  // ── Category bars (chart 3) ───────────────────────────────────────────────
  categoryBars = [
    { name: 'NIMR Flowline',   plan: 36.31, actual: 9.39 },
    { name: 'NIMR Location',   plan: 27.24, actual: 5.74 },
    { name: 'Marmul Flowline', plan: 19.22, actual: 3.85 },
    { name: 'NIMR SNLP',       plan: 17.23, actual: 3.32 },
  ];
  catAxisMax = 40;

  // ── Top Delayed Jobs (table 5) ────────────────────────────────────────────
  topDelayedJobs: TopDelayedJob[] = [
    { wellId: 'WD-3522-05087-SNL-1-L', category: 'NIMR SNLP',    plan: 12.17, actual: 0.00, variance: -12.17, targetEnd: '24 Jun 2025' },
    { wellId: 'WD-3522-02286-SNL-1-L', category: 'Marmul SNLP',  plan:  2.00, actual: 0.00, variance:  -2.00, targetEnd: '27 May 2025' },
    { wellId: 'WD-3522-02198-SNL-1-L', category: 'NIMR SNLP',    plan: 13.00, actual: 0.00, variance: -13.00, targetEnd: '25 May 2025' },
    { wellId: 'WD-3522-04895-SNL-1-L', category: 'NIMR SNLP',    plan: 13.00, actual: 0.00, variance: -13.00, targetEnd: '16 May 2025' },
    { wellId: 'WD-3522-01918-SNL-1-L', category: 'NIMR SNLP',    plan: 85.00, actual:  0.38, variance: -84.62, targetEnd: '26 Apr 2025' },
    { wellId: 'WD-3522-02263-SNL-1-L', category: 'Marmul SNLP',  plan:  0.00, actual: 0.00, variance:   0.00, targetEnd: '23 May 2025' },
    { wellId: 'WD-3522-24172-FLC-1-L', category: 'Marmul Flowline', plan: 0.45, actual: 0.00, variance: -0.45, targetEnd: '26 May 2025' },
    { wellId: 'WD-3522-24245-FLC-1-L', category: 'Marmul Cvr. w/ Flowline', plan: 0.00, actual: 0.00, variance: 0.00, targetEnd: '02 Jul 2025' },
    { wellId: 'WD-3522-24176-FLC-1-L', category: 'Marmul Flowline', plan: 0.00, actual: 0.00, variance: 0.00, targetEnd: '04 Jul 2025' },
    { wellId: 'WD-3522-05501-SNL-1-L', category: 'NIMR SNLP',    plan:  0.00, actual: 0.00, variance:   0.00, targetEnd: '06 Jul 2025' },
  ];

  // ── Gantt (chart 6) ───────────────────────────────────────────────────────
  ganttRows: GanttRow[] = [];

  // Timeline ticks shown in header
  ganttTicks = [
    { month: 'May 2025', days: [25, 27, 29, 31] },
    { month: 'Jun 2025', days: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] },
    { month: 'Jul 2025', days: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] },
  ];
  // Total number of ticks for positioning: 4 + 15 + 11 = 30 ticks (every 2 days over 60 days)
  ganttTotalDays = 60;

  ngAfterViewInit(): void {
    this.buildGanttRows();
    setTimeout(() => {
      this.buildWeeklyTrendChart();
      this.buildSCurveChart();
      this.buildRevPhysChart();
      this.buildDelayedGrid();
    }, 300);
  }

  ngOnDestroy(): void {
    this.charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    if (this.delayedGrid) { try { this.delayedGrid.destroy(); } catch (_) {} }
  }

  getVarianceClass(v: number): string {
    return v < 0 ? 'jp2-var--neg' : v > 0 ? 'jp2-var--pos' : '';
  }

  private parseDate(s: string): Date {
    const [d, m, y] = s.split(' ');
    const months: Record<string, number> = {
      Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11
    };
    return new Date(parseInt(y), months[m], parseInt(d));
  }

  private buildGanttRows(): void {
    const start = new Date('2025-05-25');
    const total = this.ganttTotalDays;

    this.ganttRows = this.topDelayedJobs.map(j => {
      const td = this.parseDate(j.targetEnd);
      const daysFromStart = Math.round((td.getTime() - start.getTime()) / 86400000);

      let type: 'overdue' | 'within30' | 'within60' | 'after60';
      let label: string;
      if (daysFromStart < 0) {
        type = 'overdue'; label = 'Overdue';
      } else if (daysFromStart <= 30) {
        type = 'within30';
        label = daysFromStart <= 0 ? 'Due today' : `Due in ${daysFromStart} day${daysFromStart === 1 ? '' : 's'}`;
      } else if (daysFromStart <= 60) {
        type = 'within60';
        label = `Due in ${daysFromStart} days`;
      } else {
        type = 'after60'; label = 'Due after 60 days';
      }

      // Bar pct: for overdue → 0 (no forward bar), for future → clamp to 100
      const barPct = daysFromStart < 0 ? 0 : Math.min(100, (daysFromStart / total) * 100);

      return { wellId: j.wellId, category: j.category, progress: j.actual + '%', type, label, barPct };
    });
  }

  // ── Chart builders ────────────────────────────────────────────────────────

  private buildWeeklyTrendChart(): void {
    const canvas = this.weeklyTrendRef?.nativeElement;
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const labels = ['Week 1\n27 Apr–03 May', 'Week 2\n04 May–10 May', 'Week 3\n11 May–17 May', 'Week 4\n18 May–24 May', 'Week 5\n25 May–31 May'];
    const planData     = [9.47,  11.91, 46.97, 40.94, 1.29];
    const actualData   = [9.99,   7.19, 27.50, 29.06, 0.00];
    const varianceData = [-0.38, -4.72, -19.47, -11.88, -1.29];

    const dlPlugin = {
      id: 'jpTrendDL',
      afterDatasetsDraw(chart: any) {
        const { ctx: c } = chart;
        c.save();
        chart.data.datasets.forEach((ds: any, di: number) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden || meta.type !== 'line') return;
          meta.data.forEach((pt: any, idx: number) => {
            const v = ds.data[idx];
            if (v === null || v === undefined) return;
            c.font = 'bold 7.5px Inter,Arial,sans-serif';
            c.fillStyle = ds.borderColor as string;
            c.textAlign = 'center';
            c.fillText(v + '%', pt.x, pt.y + (v < 0 ? 16 : -8));
          });
        });
        c.restore();
      }
    };

    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [dlPlugin],
      data: {
        labels,
        datasets: [
          { label: 'Plan %',     type: 'bar',  data: planData,     backgroundColor: '#29378d', barPercentage: 0.38, categoryPercentage: 0.72, yAxisID: 'y' },
          { label: 'Actual %',   type: 'bar',  data: actualData,   backgroundColor: '#00B050', barPercentage: 0.38, categoryPercentage: 0.72, yAxisID: 'y' },
          { label: 'Variance %', type: 'line', data: varianceData, borderColor: '#FF0000', backgroundColor: 'rgba(255,0,0,0.08)', borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#FF0000', pointBorderWidth: 2, tension: 0.3, yAxisID: 'y', fill: false },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22, bottom: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 9 }, padding: 12 } },
          tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y}%` } }
        },
        scales: {
          y: { min: -40, max: 80, ticks: { callback: (v: any) => v + '%', font: { size: 8.5 }, stepSize: 20 }, grid: { color: 'rgba(0,0,0,0.06)' } },
          x: { ticks: { font: { size: 7.5 }, maxRotation: 0, autoSkip: false }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
    this.charts.push(chart);
  }

  private buildSCurveChart(): void {
    const canvas = this.sCurveRef?.nativeElement;
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const labels = ['Week 1\n27 Apr–03 May', 'Week 2\n04 May–10 May', 'Week 3\n11 May–17 May', 'Week 4\n18 May–24 May', 'Week 5\n25 May–31 May'];
    const cumPlan   = [9.47,  21.38,  68.36, 109.39, 110.59];
    const cumActual = [9.09,  16.28,  43.78, 113.78, 113.78];

    const dlPlugin = {
      id: 'jpSCurveDL',
      afterDatasetsDraw(chart: any) {
        const { ctx: c } = chart;
        c.save();
        chart.data.datasets.forEach((ds: any, di: number) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          meta.data.forEach((pt: any, idx: number) => {
            const v = ds.data[idx];
            c.font = 'bold 7.5px Inter,Arial,sans-serif';
            c.fillStyle = ds.borderColor as string;
            c.textAlign = 'center';
            c.fillText(v + '%', pt.x, pt.y - 9);
          });
        });
        c.restore();
      }
    };

    const chart = new Chart(ctx, {
      type: 'line',
      plugins: [dlPlugin],
      data: {
        labels,
        datasets: [
          { label: 'Cumulative Plan %',   data: cumPlan,   borderColor: '#29378d', backgroundColor: 'rgba(41,55,141,0.07)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#29378d', pointBorderWidth: 2, tension: 0.35, fill: true },
          { label: 'Cumulative Actual %', data: cumActual, borderColor: '#00B050', backgroundColor: 'rgba(0,176,80,0.07)',    borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#00B050', pointBorderWidth: 2, tension: 0.35, fill: true },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22, bottom: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 9 }, padding: 12 } },
          tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y}%` } }
        },
        scales: {
          y: { min: 0, max: 120, ticks: { callback: (v: any) => v + '%', font: { size: 8.5 }, stepSize: 20 }, grid: { color: 'rgba(0,0,0,0.06)' } },
          x: { ticks: { font: { size: 7.5 }, maxRotation: 0, autoSkip: false }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
    this.charts.push(chart);
  }

  private buildRevPhysChart(): void {
    const canvas = this.revPhysRef?.nativeElement;
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const labels = ['Week 1\n27 Apr–03 May', 'Week 2\n04 May–10 May', 'Week 3\n11 May–17 May', 'Week 4\n18 May–24 May', 'Week 5\n25 May–31 May'];
    const revData  = [0.10, 0.19, 0.48, 0.80, 0.96];
    const physData = [9.09, 16.28, 43.78, 113.78, 113.78];

    const dlPlugin = {
      id: 'jpRevDL',
      afterDatasetsDraw(chart: any) {
        const { ctx: c } = chart;
        c.save();
        chart.data.datasets.forEach((ds: any, di: number) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          meta.data.forEach((pt: any, idx: number) => {
            const v = ds.data[idx];
            c.font = 'bold 7.5px Inter,Arial,sans-serif';
            c.fillStyle = ds.borderColor as string;
            c.textAlign = 'center';
            const lbl = di === 0 ? v + 'M' : v + '%';
            c.fillText(lbl, pt.x, pt.y - 9);
          });
        });
        c.restore();
      }
    };

    const chart = new Chart(ctx, {
      type: 'line',
      plugins: [dlPlugin],
      data: {
        labels,
        datasets: [
          { label: 'Revenue Achieved (M)', data: revData,  borderColor: '#00B0F0', backgroundColor: 'rgba(0,176,240,0.07)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#00B0F0', pointBorderWidth: 2, tension: 0.35, fill: true, yAxisID: 'y' },
          { label: 'Cumulative Actual Progress %', data: physData, borderColor: '#00B050', backgroundColor: 'rgba(0,176,80,0.07)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#00B050', pointBorderWidth: 2, tension: 0.35, fill: true, yAxisID: 'y2' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22, bottom: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 9 }, padding: 12 } },
          tooltip: { callbacks: { label: (c: any) => c.datasetIndex === 0 ? ` Revenue: ${c.parsed.y}M` : ` Progress: ${c.parsed.y}%` } }
        },
        scales: {
          y:  { position: 'left',  min: 0, max: 14, ticks: { callback: (v: any) => v + 'M', font: { size: 8.5 }, stepSize: 2 }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y2: { position: 'right', min: 0, max: 140, ticks: { callback: (v: any) => v + '%', font: { size: 8.5 }, stepSize: 20 }, grid: { drawOnChartArea: false } },
          x:  { ticks: { font: { size: 7.5 }, maxRotation: 0, autoSkip: false }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
    this.charts.push(chart);
  }

  private buildDelayedGrid(): void {
    const gridEl = document.getElementById('jp2DelayedGrid');
    if (!gridEl || typeof agGrid === 'undefined') return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' jp2__grid';

    const fmt2 = (v: number) => v.toFixed(2) + '%';

    const columnDefs = [
      {
        headerName: 'Well ID', field: 'wellId', flex: 2, minWidth: 180, sortable: true, filter: true,
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:700;color:${dk ? '#00B0F0' : '#29378d'}">${p.value}</span>`
      },
      { headerName: 'Category', field: 'category', flex: 1.5, minWidth: 140, sortable: true, filter: true },
      {
        headerName: 'Plan %', field: 'plan', flex: 1, minWidth: 100, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:600">${fmt2(p.value)}</span>`
      },
      {
        headerName: 'Actual %', field: 'actual', flex: 1, minWidth: 100, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:600">${fmt2(p.value)}</span>`
      },
      {
        headerName: 'Variance %', field: 'variance', flex: 1, minWidth: 110, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) => {
          const color = p.value < 0 ? '#FF0000' : p.value > 0 ? '#00B050' : 'var(--txt-1)';
          return `<span style="font-family:var(--font-family-mono);font-weight:700;color:${color}">${fmt2(p.value)}</span>`;
        }
      },
      {
        headerName: 'Target End', field: 'targetEnd', flex: 1, minWidth: 120, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '8.5pt' }
      }
    ];

    if (this.delayedGrid) { try { this.delayedGrid.destroy(); } catch (_) {} }

    this.delayedGrid = agGrid.createGrid(gridEl, {
      columnDefs,
      rowData: this.topDelayedJobs,
      defaultColDef: { resizable: true },
      domLayout: 'normal' as const,
      pagination: true,
      paginationPageSize: 10,
      paginationPageSizeSelector: [5, 10, 20],
      animateRows: true,
      suppressHorizontalScroll: false
    });
  }
}

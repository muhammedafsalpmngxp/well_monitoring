import {
  Component, OnInit, AfterViewInit, OnDestroy, ViewEncapsulation, ChangeDetectorRef, NgZone
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

interface OpsSegment { label: string; value: number; color: string; }
interface OpsChartDef {
  title: string;
  sub: string;
  type: string;               // 'doughnut' | 'donut' | 'bar'
  cols: string[];
  segments: OpsSegment[];
  rowsFor: (seg: OpsSegment) => any[][];
  xTitle?: string;            // x-axis label (bar / line)
  yTitle?: string;            // y-axis label (bar / line)
  filters?: any[];            // chart-level filters (Plant / Resource / Discipline …)
}

/**
 * Segment → grid-page routing for charts that drill straight to a dedicated
 * listing page (instead of the in-page grid). For ODC Overall Status the
 * doughnut segments map to the ODC category filter used by the Wells grid.
 */
interface SegmentNav {
  route: string;
  catGlobal: string;                 // window global the target page reads
  map: Record<string, string>;       // segment label → category key
}

/**
 * Chart Drill-down — page-level replacement for the Standard Charts popup.
 *
 * Opened via /chart-drilldown?id=<chartId>. Renders the chart inline on its
 * own page; clicking a segment drills to the next level:
 *   • ODC Overall Status → navigates to the Wells listing grid (/odcwells),
 *     pre-filtered to the clicked segment's category.
 *   • Other Operations Dashboard charts → reveal the segment's well grid
 *     inline (with a "Back to chart" control) as the next drill level.
 */
@Component({
  selector: 'app-chart-drilldown',
  templateUrl: './chart-drilldown.component.html',
  styleUrls: ['./chart-drilldown.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ChartDrilldownComponent implements OnInit, AfterViewInit, OnDestroy {

  chartId = '';
  def: OpsChartDef | null = null;

  /** When set, the in-page grid is showing this segment's rows (level-2 drill). */
  activeSeg: OpsSegment | null = null;
  gridRows: any[][] = [];

  /** Chart height (px) — adjustable via the Size control / drag handle. */
  chartHeight = 440;

  /** Level-1 view: the chart, or its data as a table. */
  view: 'chart' | 'table' = 'chart';

  /** Set a preset chart size, then let Chart.js re-fit the new container. */
  setChartHeight(h: number): void {
    this.chartHeight = h;
    this.cdr.detectChanges();
    setTimeout(() => { try { this.chart?.resize(); } catch { /* noop */ } }, 30);
  }

  /** Toggle between the chart and its data table. */
  setView(v: 'chart' | 'table'): void {
    if (this.view === v) return;
    this.view = v;
    this.cdr.detectChanges();
    if (v === 'chart') { setTimeout(() => this.renderChart(), 40); }
    else { this.destroyChart(); }
  }

  /** Total of all segment values (for the data table + percentages). */
  get segTotal(): number {
    return (this.def?.segments || []).reduce((a, s) => a + (Number(s.value) || 0), 0);
  }

  /** A value as a percentage of the segment total. */
  segPct(value: number): string {
    const t = this.segTotal;
    return t ? Math.round((value / t) * 100) + '%' : '0%';
  }

  private chart: any = null;
  private routeSub?: Subscription;

  /** Charts that drill to a dedicated grid page rather than the in-page grid. */
  private readonly SEGMENT_NAV: Record<string, SegmentNav> = {
    'std-odc-overall': ChartDrilldownComponent.ODC_NAV,
    'std-odcstatus':   ChartDrilldownComponent.ODC_NAV
  };

  /** ODC Overall Status donut → Wells grid, keyed by delivery-status category. */
  private static readonly ODC_NAV: SegmentNav = {
    route: '/odcwells',
    catGlobal: '__awPendingOdcCat',
    map: {
      'Hook-Up Completed':       'hookup',
      'Drilled & Not Completed': 'dnc',
      'Due Wells':               'due',
      'Suspended Wells':         'suspended',
      'Ready for Commissioning': 'readycomm',
      'Non Due Wells':           'notdue'
    }
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone
  ) {}

  ngOnInit(): void {
    // React to id changes (e.g. navigating between charts without a full reload).
    this.routeSub = this.route.queryParams.subscribe(p => {
      const id = p['id'] || '';
      if (id === this.chartId) return;
      this.chartId = id;
      this.loadDef();
      this.activeSeg = null;
      this.gridRows = [];
      this.cdr.detectChanges();
      // Defer render until the canvas exists in the DOM.
      setTimeout(() => this.renderChart(), 40);
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.renderChart(), 40);
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.destroyChart();
  }

  goToCharts(): void { this.router.navigateByUrl('/standardcharts'); }

  /** Return to the chart from the in-page grid (level-2 → level-1). */
  backToChart(): void {
    this.activeSeg = null;
    this.gridRows = [];
    this.cdr.detectChanges();
    setTimeout(() => this.renderChart(), 40);
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private loadDef(): void {
    const w = window as any;
    this.def = (typeof w.opsGetChartDef === 'function') ? w.opsGetChartDef(this.chartId) : null;
  }

  /** Render the chart-level filter bar (Plant / Resource / Discipline …) if the def declares any. */
  private renderFilterBar(): void {
    const w = window as any;
    const host = document.getElementById('cddFilterBar');
    if (!host) return;
    const filters = (this.def && !this.activeSeg) ? this.def.filters : null;
    const html = (filters && typeof w.dbFilterBarHtml === 'function') ? w.dbFilterBarHtml(filters) : '';
    host.innerHTML = html;
    host.style.display = html ? 'flex' : 'none';
  }

  private destroyChart(): void {
    if (this.chart) { try { this.chart.destroy(); } catch { /* noop */ } this.chart = null; }
  }

  private renderChart(): void {
    this.destroyChart();
    this.renderFilterBar();
    const def = this.def;
    const Chart = (window as any).Chart;
    const canvas = document.getElementById('cddChartCanvas') as HTMLCanvasElement | null;
    if (!def || !Chart || !canvas) return;

    const isDonut = def.type === 'doughnut' || def.type === 'donut';
    const isPie = def.type === 'pie';
    const isRound = isDonut || isPie;              // circular chart (pie / donut) — slice legend, no axes
    const isLine = def.type === 'line';
    const labels = def.segments.map(s => s.label);
    const values = def.segments.map(s => s.value);
    const colors = def.segments.map(s => s.color);

    const dataset = isLine
      ? { label: def.title, data: values, borderColor: '#2E3E8C', backgroundColor: 'rgba(46,62,140,0.10)', pointBackgroundColor: '#2E3E8C', pointRadius: 4, pointHoverRadius: 6, fill: true, tension: 0.35 }
      : { label: 'Wells', data: values, backgroundColor: colors, borderColor: '#fff', borderWidth: isRound ? 2 : 0, borderRadius: isRound ? 0 : 4 };

    this.chart = new Chart(canvas, {
      type: isDonut ? 'doughnut' : isPie ? 'pie' : isLine ? 'line' : 'bar',
      data: { labels, datasets: [dataset] },
      plugins: [this.valueLabelPlugin(), this.centerTotalPlugin()],
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
        cutout: isDonut ? '58%' : undefined,
        plugins: { legend: this.legendConfig(Chart, isRound, isLine) },
        scales: isRound ? {} : {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
            title: def.xTitle ? { display: true, text: def.xTitle, font: { size: 11, weight: '600' }, color: '#475569' } : { display: false }
          },
          y: {
            beginAtZero: !isLine,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 } },
            title: { display: true, text: def.yTitle || 'Wells', font: { size: 11, weight: '600' }, color: '#475569' }
          }
        },
        onClick: (_evt: any, els: any[]) => {
          if (els && els.length) {
            const seg = def.segments[els[0].index];
            // Chart.js click handlers run outside Angular's zone — re-enter so
            // navigation and change detection fire.
            this.zone.run(() => this.onSegmentClick(seg));
          }
        }
      }
    });
  }

  /**
   * Legend config: donut → native per-slice (right); line → hidden;
   * bar → a per-category legend (one entry per bar, its own colour), clickable
   * to show/hide that bar.
   */
  private legendConfig(Chart: any, isDonut: boolean, isLine: boolean): any {
    if (isLine) return { display: false };
    if (isDonut) {
      return { display: true, position: 'right', labels: { font: { size: 11 }, usePointStyle: true, boxWidth: 9 } };
    }
    // Bar — one legend item per category/bar.
    return {
      display: true,
      position: 'bottom',
      labels: {
        font: { size: 11 }, usePointStyle: true, boxWidth: 9, padding: 14,
        generateLabels: (chart: any) => {
          const ds = chart.data.datasets[0] || {};
          const bg = ds.backgroundColor || [];
          return (chart.data.labels || []).map((lab: string, i: number) => ({
            text: lab,
            fillStyle: Array.isArray(bg) ? bg[i] : bg,
            strokeStyle: Array.isArray(bg) ? bg[i] : bg,
            hidden: !chart.getDataVisibility(i),
            index: i,
            pointStyle: 'circle'
          }));
        }
      },
      onClick: (_e: any, item: any, legend: any) => {
        const ch = legend.chart;
        ch.toggleDataVisibility(item.index);
        ch.update();
      }
    };
  }

  /** Pick black/white text for best contrast against a hex fill. */
  private contrastText(hex: string): string {
    const h = (hex || '').replace('#', '');
    if (h.length < 6) return '#ffffff';
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1f2937' : '#ffffff';
  }

  /** Draws each segment's count on the slice / bar / point. */
  private valueLabelPlugin(): any {
    const contrast = (hex: string) => this.contrastText(hex);
    return {
      id: 'cddValueLabels',
      afterDatasetsDraw(chart: any) {
        const ds = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        const ctx = chart.ctx;
        const type = chart.config.type;
        ctx.save();
        ctx.textAlign = 'center';
        meta.data.forEach((el: any, i: number) => {
          const v = ds.data[i];
          if (v == null || v === 0) return;
          if (type === 'doughnut' || type === 'pie') {
            const p = el.getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'], true);
            const ang = (p.startAngle + p.endAngle) / 2;
            const r = (p.innerRadius + p.outerRadius) / 2;
            ctx.fillStyle = contrast(ds.backgroundColor[i]);
            ctx.font = '700 12px system-ui, "Segoe UI", sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(v), p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r);
          } else if (type === 'bar') {
            const pos = el.tooltipPosition();
            ctx.fillStyle = '#334155';
            ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(v), pos.x, pos.y - 4);
          } else {
            const pos = el.tooltipPosition();
            ctx.fillStyle = '#2E3E8C';
            ctx.font = '700 10px system-ui, "Segoe UI", sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(v), pos.x, pos.y - 7);
          }
        });
        ctx.restore();
      }
    };
  }

  /** Draws the total in the centre of the doughnut. */
  private centerTotalPlugin(): any {
    return {
      id: 'cddCenterTotal',
      afterDraw(chart: any) {
        if (chart.config.type !== 'doughnut') return;
        const meta = chart.getDatasetMeta(0);
        const first = meta.data[0];
        if (!first) return;
        const { x, y } = first.getProps(['x', 'y'], true);
        const total = (chart.data.datasets[0].data as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
        const ctx = chart.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748b';
        ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Total', x, y - 8);
        ctx.fillStyle = '#0f172a';
        ctx.font = '800 26px system-ui, "Segoe UI", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(String(total), x, y - 2);
        ctx.restore();
      }
    };
  }

  private onSegmentClick(seg: OpsSegment): void {
    if (!seg) return;
    const nav = this.SEGMENT_NAV[this.chartId];
    if (nav) {
      const cat = nav.map[seg.label];
      if (cat) {
        (window as any)[nav.catGlobal] = cat;
        this.router.navigateByUrl(nav.route);
        return;
      }
    }
    // Fallback: reveal the segment's wells in the in-page grid (next drill level).
    this.activeSeg = seg;
    this.gridRows = (this.def && typeof this.def.rowsFor === 'function') ? (this.def.rowsFor(seg) || []) : [];
    this.destroyChart();
    this.cdr.detectChanges();
  }

  // ─── Export (PNG / CSV) ──────────────────────────────────────────────────

  exportPng(): void {
    const page = document.getElementById('page-chart-drilldown');
    const h2c = (window as any).html2canvas;
    // Preferred: capture the whole widget (title + chart + numbers) via html2canvas.
    if (page && h2c) {
      h2c(page, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true,
        onclone: (d: Document) => {
          d.querySelectorAll('.cdd-actions').forEach(el => { (el as HTMLElement).style.display = 'none'; });
        }
      }).then((canvas: HTMLCanvasElement) => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = this.safeName() + '.png';
        a.click();
      }).catch(() => this.exportCanvasOnly());
      return;
    }
    this.exportCanvasOnly();
  }

  /** Fallback — export just the chart canvas (used if html2canvas is unavailable). */
  private exportCanvasOnly(): void {
    const canvas = document.getElementById('cddChartCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    const ctx = tmp.getContext('2d');
    if (ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, tmp.width, tmp.height); ctx.drawImage(canvas, 0, 0); }
    const a = document.createElement('a');
    a.href = tmp.toDataURL('image/png');
    a.download = this.safeName() + '.png';
    a.click();
  }

  exportCsv(): void {
    if (!this.def) return;
    const esc = (s: any): string => {
      const str = (s == null) ? '' : String(s);
      return /[",\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
    };
    let rows: string[][];
    if (this.activeSeg) {
      rows = [this.def.cols, ...this.gridRows.map(r => r.map(c => String(c)))];
    } else {
      rows = [['Category', 'Wells'], ...this.def.segments.map(s => [s.label, String(s.value)])];
    }
    const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = this.safeName() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private safeName(): string {
    const t = (this.def && this.def.title) || 'chart';
    return t.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'chart';
  }
}

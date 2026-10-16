import { Component, AfterViewInit, OnDestroy, OnInit, NgZone, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';

/**
 * Chart View — inside-page viewer for a created chart (replaces the popup).
 * Opened via /chart-view?id=<chartId>. Renders the chart inline using the
 * shared global chart engine, with its filter bar above and an optional data
 * table below (toggle-able), plus CSV export.
 */
@Component({
  selector: 'app-chart-view',
  templateUrl: './chart-view.component.html',
  styleUrls: ['./chart-view.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ChartViewComponent implements OnInit, AfterViewInit, OnDestroy {

  found = true;
  title = 'Chart';
  subtitle = '';
  hasTable = false;
  showTable = false;
  canEdit = false;
  isLabour = false;

  private type = '';
  private xT = 'Category';
  private yT = 'Value';
  private chartId = '';
  private sub?: Subscription;

  private readonly IDS = { canvas: 'cvChartCanvas', kpi: 'cvChartKpi', table: 'cvChartTable', empty: 'cvChartEmpty' };

  constructor(private route: ActivatedRoute, private location: Location, private zone: NgZone) {}

  ngOnInit(): void {
    this.sub = this.route.queryParams.subscribe(p => {
      this.chartId = p['id'] || '';
      setTimeout(() => this.render(), 60);
    });
    // Let the (global-JS) builder re-render this page after an edit is saved.
    (window as any).__chartViewRefresh = () => this.zone.run(() => this.render());
  }
  ngAfterViewInit(): void { setTimeout(() => this.render(), 60); }
  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if ((window as any).__chartViewRefresh) { try { delete (window as any).__chartViewRefresh; } catch { /* noop */ } }
  }

  back(): void { this.location.back(); }
  edit(): void { const w = window as any; if (typeof w.chartsEditChart === 'function') w.chartsEditChart(this.chartId); }

  private render(): void {
    const w = window as any;
    if (typeof w.chartsRenderInline !== 'function' || !this.chartId) return;
    const info = w.chartsRenderInline(this.chartId, this.IDS);
    if (!info) { this.found = false; return; }
    this.found = true;
    this.title = info.name;
    this.subtitle = info.desc || info.meta || '';
    this.type = info.type;
    this.xT = info.xTitle; this.yT = info.yTitle;

    // Filter bar (from the chart's saved filters).
    const fb = document.getElementById('cvFilterBar');
    if (fb) {
      const html = (typeof w.dbFilterBarHtml === 'function') ? w.dbFilterBarHtml(info.filters) : '';
      fb.innerHTML = html;
      fb.style.display = html ? 'flex' : 'none';
    }

    // Data table is available for chart types only; default per the saved flag.
    this.isLabour = !!info.labour;
    this.canEdit = !!info.custom && !this.isLabour;   // labour uses a bespoke viewer, not the generic builder

    // Labour-productivity charts use their bespoke viewer (Chart / Data-table
    // toggle + click-to-drill) rendered into a page container.
    if (this.isLabour) {
      this.hasTable = false; this.showTable = false;
      if (typeof w.dbLabourRenderInline === 'function') { setTimeout(() => w.dbLabourRenderInline('cvLabourHost', this.title), 30); }
      return;
    }

    this.hasTable = ['bar', 'line', 'pie', 'donut', 'trend', 'area'].indexOf(info.type) >= 0;
    this.showTable = this.hasTable && !!info.showTable;
    this.renderTable();
  }

  private renderTable(): void {
    const w = window as any;
    const dt = document.getElementById('cvDataTable');
    if (!dt) return;
    if (this.showTable && typeof w.dbInlineDataTableHtml === 'function') {
      dt.innerHTML = w.dbInlineDataTableHtml(this.IDS.canvas, this.xT, this.yT);
      dt.style.display = '';
    } else { dt.innerHTML = ''; dt.style.display = 'none'; }
  }

  toggleTable(): void { this.showTable = !this.showTable; this.renderTable(); }

  exportCsv(): void {
    const w = window as any;
    const data = (typeof w.dbInlineChartData === 'function') ? w.dbInlineChartData(this.IDS.canvas) : null;
    if (!data) return;
    const esc = (s: any): string => { const str = s == null ? '' : String(s); return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str; };
    const rows = [[this.xT, this.yT], ...data.labels.map((l: any, i: number) => [l, data.values[i]])];
    const csv = rows.map((r: any[]) => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = (this.title || 'chart').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}

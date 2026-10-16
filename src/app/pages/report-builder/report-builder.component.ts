import { Component, AfterViewInit, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import {
  SavedReport,
  ReportVizType,
  ReportAggregateFn,
  ReportMetricKey,
  ReportLayoutDef,
  REPORT_LAYOUTS,
  buildLayoutPreviewHtml,
  PH_PROD_ROWS,
  findReport,
  upsertReport
} from '../reports/reports.component';

interface DataColumn {
  id: string;
  label: string;
  type: 'string' | 'number' | 'date';
}

interface DataTable {
  id: string;
  name: string;
  /** Underlying database table (shown in the source picker). */
  dbName: string;
  description: string;
  columns: DataColumn[];
  rows: any[];
}

interface VizDef {
  id: ReportVizType;
  name: string;
  description: string;
}

/** A layout the user uploaded (HTML template or image), stored in localStorage. */
interface UploadedLayout {
  id: string;
  name: string;
  description: string;
  kind: 'html' | 'image';
  content: string;   // HTML markup, or an image data URL
}

@Component({
  selector: 'app-report-builder',
  templateUrl: './report-builder.component.html',
  styleUrls: ['./report-builder.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportBuilderComponent implements OnInit, AfterViewInit, OnDestroy {

  // ── Form state ────────────────────────────────
  reportId: string | null = null;
  reportName = '';
  reportDescription = '';
  sourceTableId = '';
  /** Selected fixed layout (e.g. 'daily-plan'); '' = standard chart/list report. */
  layoutId = '';
  layouts: ReportLayoutDef[] = REPORT_LAYOUTS;

  /** User-uploaded layouts (persisted in localStorage). */
  private readonly LAYOUT_KEY = 'smartops.report.layouts';
  uploaded: UploadedLayout[] = [];
  get uploadedLayouts(): ReportLayoutDef[] {
    return this.uploaded.map(u => ({ id: u.id, name: u.name, description: u.description }));
  }
  get allLayouts(): ReportLayoutDef[] { return [...this.layouts, ...this.uploadedLayouts]; }
  vizType: ReportVizType | '' = '';
  groupBy = '';
  aggregateColumn = '';
  aggregateFn: ReportAggregateFn | '' = '';
  viewMode = false;

  /** Headline metrics enabled for this report. */
  metrics: ReportMetricKey[] = ['records', 'distinctGroups', 'highestGroup', 'total'];
  /** Column ids exposed as on-view filters. */
  filterCols: string[] = [];
  /** Column ids included in the report output (defaults to all columns of the source). */
  selectedCols: string[] = [];
  /** Live filter controls rendered in the preview (built from filterCols). */
  previewFilters: { col: string; label: string; type: 'text' | 'date'; value: string; from: string; to: string; options: string[] }[] = [];

  metricCatalogue: { id: ReportMetricKey; label: string; desc: string }[] = [
    { id: 'records',        label: 'Records in scope',  desc: 'Total rows in the source' },
    { id: 'distinctGroups', label: 'Distinct groups',   desc: 'Count of unique group values' },
    { id: 'highestGroup',   label: 'Highest group',     desc: 'Group with the largest value' },
    { id: 'lowestGroup',    label: 'Lowest group',      desc: 'Group with the smallest value' },
    { id: 'total',          label: 'Total / aggregate', desc: 'Sum across all groups' },
    { id: 'avgPerGroup',    label: 'Average per group', desc: 'Mean value per group' }
  ];

  hasMetric(id: ReportMetricKey): boolean { return this.metrics.includes(id); }
  toggleMetric(id: ReportMetricKey): void {
    if (this.viewMode) return;
    const i = this.metrics.indexOf(id);
    if (i >= 0) this.metrics.splice(i, 1); else this.metrics.push(id);
    this.computePreviewStats();
  }

  // ── Column selection ─────────────────────────
  hasCol(id: string): boolean { return this.selectedCols.includes(id); }
  toggleCol(id: string): void {
    if (this.viewMode) return;
    const i = this.selectedCols.indexOf(id);
    if (i >= 0) this.selectedCols.splice(i, 1); else this.selectedCols.push(id);
    this.scheduleRender();
  }
  allColsSelected(): boolean {
    const t = this.currentTable;
    return !!t && t.columns.length > 0 && t.columns.every(c => this.selectedCols.includes(c.id));
  }
  toggleAllCols(): void {
    if (this.viewMode) return;
    this.selectedCols = this.allColsSelected() ? [] : (this.currentTable?.columns || []).map(c => c.id);
    this.scheduleRender();
  }
  /** Columns actually shown in the report (table order), honouring the selection. */
  get visibleColumns(): DataColumn[] {
    const t = this.currentTable;
    if (!t) return [];
    if (!this.selectedCols.length) return t.columns;   // none picked → show all
    return t.columns.filter(c => this.selectedCols.includes(c.id));
  }

  hasFilter(col: string): boolean { return this.filterCols.includes(col); }
  toggleFilter(col: string): void {
    if (this.viewMode) return;
    const i = this.filterCols.indexOf(col);
    if (i >= 0) this.filterCols.splice(i, 1); else this.filterCols.push(col);
    this.buildPreviewFilters();
    this.scheduleRender();
  }

  /** String + date columns can be exposed as filters. */
  get filterableColumns(): DataColumn[] {
    return this.currentTable?.columns.filter(c => c.type === 'string' || c.type === 'date') || [];
  }
  private colType(col: string): 'text' | 'date' {
    return this.currentTable?.columns.find(c => c.id === col)?.type === 'date' ? 'date' : 'text';
  }

  /** (Re)build the preview filter controls from the selected filter columns. */
  private buildPreviewFilters(): void {
    const t = this.currentTable;
    if (!t) { this.previewFilters = []; return; }
    const prev: Record<string, { value: string; from: string; to: string }> = {};
    this.previewFilters.forEach(f => { prev[f.col] = { value: f.value, from: f.from, to: f.to }; });
    this.previewFilters = this.filterCols.map(col => {
      const type = this.colType(col);
      const p = prev[col] || { value: 'All', from: '', to: '' };
      if (type === 'date') {
        return { col, label: this.colLabel(col), type, value: 'All', from: p.from || '', to: p.to || '', options: [] };
      }
      const options = [...new Set(t.rows.map(r => String(r[col] ?? '')).filter(Boolean))].sort();
      const keep = p.value && (p.value === 'All' || options.includes(p.value));
      return { col, label: this.colLabel(col), type, value: keep ? p.value : 'All', from: '', to: '', options };
    });
    this.computePreviewStats();
  }

  onPreviewFilterChange(): void { this.computePreviewStats(); this.scheduleRender(); }

  /** Current table rows after applying the preview filters. */
  private filteredRows(): any[] {
    const t = this.currentTable;
    if (!t) return [];
    let rows = t.rows;
    this.previewFilters.forEach(f => {
      if (f.type === 'date') {
        if (f.from) rows = rows.filter(r => String(r[f.col] ?? '') >= f.from);
        if (f.to)   rows = rows.filter(r => String(r[f.col] ?? '') <= f.to);
      } else if (f.value && f.value !== 'All') {
        rows = rows.filter(r => String(r[f.col] ?? '') === f.value);
      }
    });
    return rows;
  }

  /** Cached headline-metric cards for the preview (recomputed only on real changes). */
  previewStats: { lbl: string; num: string; sd: string; variant: string }[] = [];

  /** Recompute the preview metric cards — reflects the ticked metrics + active filters. */
  private computePreviewStats(): void {
    const t = this.currentTable;
    if (!t || !this.metrics.length) { this.previewStats = []; return; }
    const rows = this.filteredRows();
    const gby  = this.groupBy;
    const fn   = this.aggregateFn || 'count';
    const acol = this.aggregateColumn;
    const groups: Record<string, number[]> = {};
    rows.forEach(row => {
      const k = String((gby ? row[gby] : 'All') ?? 'Unknown');
      if (!groups[k]) groups[k] = [];
      if (fn === 'count') groups[k].push(1);
      else { const n = parseFloat(String(row[acol])); if (!isNaN(n)) groups[k].push(n); }
    });
    const labels = Object.keys(groups);
    const values = labels.map(k => {
      const a = groups[k];
      if (fn === 'count') return a.length;
      if (fn === 'sum')   return a.reduce((s, v) => s + v, 0);
      if (fn === 'avg')   return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
      if (fn === 'min')   return a.length ? Math.min(...a) : 0;
      if (fn === 'max')   return a.length ? Math.max(...a) : 0;
      return 0;
    });
    const total  = values.reduce((s, v) => s + v, 0);
    const maxIdx = values.length ? values.indexOf(Math.max(...values)) : 0;
    const minIdx = values.length ? values.indexOf(Math.min(...values)) : 0;
    const fnLbl  = this.fnLabel(fn) || 'Count';
    const all: Record<ReportMetricKey, { lbl: string; num: string; sd: string; variant: string }> = {
      records:        { lbl: 'RECORDS IN SCOPE', num: String(rows.length),   sd: t.name + ' · total rows',                      variant: '' },
      distinctGroups: { lbl: 'DISTINCT GROUPS',  num: String(labels.length), sd: 'unique ' + (this.colLabel(gby) || 'group') + ' values', variant: '' },
      highestGroup:   { lbl: 'HIGHEST GROUP',    num: labels[maxIdx] || '—',  sd: fnLbl + ': ' + Math.round(values[maxIdx] || 0), variant: 'good' },
      lowestGroup:    { lbl: 'LOWEST GROUP',     num: labels[minIdx] || '—',  sd: fnLbl + ': ' + Math.round(values[minIdx] || 0), variant: 'bad' },
      total:          { lbl: fn === 'count' ? 'TOTAL COUNT' : fnLbl.toUpperCase() + ' TOTAL', num: String(Math.round(total)), sd: 'across all groups', variant: '' },
      avgPerGroup:    { lbl: 'AVG PER GROUP',    num: labels.length ? (total / labels.length).toFixed(1) : '0', sd: 'mean per group', variant: '' }
    };
    this.previewStats = this.metrics.filter(k => all[k]).map(k => all[k]);
  }

  // ── UI catalogues ─────────────────────────────
  // Reports only support the List (tabular) visualisation. Charts & widgets
  // (the Custom Chart builder) still offer bar/line/pie/donut/kpi/list.
  vizCatalogue: VizDef[] = [
    { id: 'list',  name: 'List',        description: 'Tabular view of the source rows' }
  ];

  tables: DataTable[] = [];

  private chartInstance: any = null;
  private chartJsAvailable = false;

  constructor(private router: Router, private route: ActivatedRoute) {}

  // ────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────
  ngOnInit(): void {
    this.tables = this.buildTables();
    this.chartJsAvailable = typeof (window as any).Chart !== 'undefined';
    this.loadUploadedLayouts();

    const qp = this.route.snapshot.queryParamMap;
    const id = qp.get('id');
    this.viewMode = qp.get('mode') === 'view';

    if (id) {
      const r = findReport(id);
      if (r) {
        this.reportId = r.id;
        this.reportName = r.name;
        this.reportDescription = r.description;
        this.sourceTableId = r.sourceTableId;
        this.vizType = r.vizType;
        this.groupBy = r.groupBy || '';
        this.aggregateColumn = r.aggregateColumn || '';
        this.aggregateFn = r.aggregateFn || 'count';
        this.metrics = (r.metrics && r.metrics.length) ? [...r.metrics] : ['records', 'distinctGroups', 'highestGroup', 'total'];
        this.filterCols = (r.filters || []).map(f => f.column);
        this.selectedCols = (r.columns && r.columns.length) ? [...r.columns] : (this.currentTable?.columns.map(c => c.id) || []);
        this.layoutId = r.layoutId || '';
        return;
      }
    }

    // Fresh report — List is the only report visualisation, so preselect it.
    this.reportName = '';
    this.reportDescription = '';
    this.sourceTableId = '';
    this.vizType = 'list';
    this.groupBy = '';
    this.aggregateColumn = '';
    this.aggregateFn = '';
    this.metrics = [];
    this.filterCols = [];
    this.selectedCols = [];
    this.layoutId = '';
  }

  ngAfterViewInit(): void {
    this.buildPreviewFilters();
    setTimeout(() => this.renderPreview(), 80);
  }

  ngOnDestroy(): void {
    if (this.chartInstance) { try { this.chartInstance.destroy(); } catch {} this.chartInstance = null; }
  }

  // ────────────────────────────────────────────────
  // Computed helpers
  // ────────────────────────────────────────────────
  get currentTable(): DataTable | null {
    return this.tables.find(t => t.id === this.sourceTableId) || null;
  }

  get groupableColumns(): DataColumn[] {
    return this.currentTable?.columns.filter(c => c.type === 'string') || [];
  }

  get numericColumns(): DataColumn[] {
    return this.currentTable?.columns.filter(c => c.type === 'number') || [];
  }

  get needsAggregateColumn(): boolean {
    return this.aggregateFn !== 'count' && this.aggregateFn !== '';
  }

  // ────────────────────────────────────────────────
  // UI handlers
  // ────────────────────────────────────────────────
  onSourceChange(): void {
    this.applyDefaultsForTable();
    this.buildPreviewFilters();
    this.scheduleRender();
  }

  get isLayoutMode(): boolean { return !!this.layoutId; }
  get layoutDescription(): string { return this.allLayouts.find(l => l.id === this.layoutId)?.description || ''; }
  onLayoutChange(): void { this.scheduleRender(); }

  // ── Uploaded layouts ─────────────────────────────────────
  private loadUploadedLayouts(): void {
    try { this.uploaded = JSON.parse(localStorage.getItem(this.LAYOUT_KEY) || '[]'); }
    catch { this.uploaded = []; }
  }
  private persistUploadedLayouts(): void {
    try { localStorage.setItem(this.LAYOUT_KEY, JSON.stringify(this.uploaded)); } catch { /* noop */ }
  }

  /** Open the file picker to upload a new layout (HTML template or image). */
  triggerLayoutUpload(): void {
    const inp = document.getElementById('rbLayoutFile') as HTMLInputElement | null;
    if (inp) { inp.value = ''; inp.click(); }
  }

  /** Read the chosen file, store it as a selectable layout, and select it. */
  onLayoutFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|gif|svg|webp)$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const entry: UploadedLayout = {
        id: 'up-' + Date.now(),
        name: file.name.replace(/\.[^.]+$/, '') || 'Uploaded layout',
        description: 'Uploaded layout · ' + file.name,
        kind: isImage ? 'image' : 'html',
        content: String(reader.result || '')
      };
      this.uploaded = [entry, ...this.uploaded];
      this.persistUploadedLayouts();
      this.layoutId = entry.id;
      this.onLayoutChange();
    };
    if (isImage) reader.readAsDataURL(file); else reader.readAsText(file);
  }

  /** Select an uploaded layout from the list. */
  selectLayout(id: string): void { this.layoutId = id; this.onLayoutChange(); }

  /** Remove an uploaded layout. */
  removeUploadedLayout(id: string, ev: Event): void {
    ev.stopPropagation();
    this.uploaded = this.uploaded.filter(u => u.id !== id);
    this.persistUploadedLayouts();
    if (this.layoutId === id) this.layoutId = '';
    this.onLayoutChange();
  }

  pickViz(t: ReportVizType): void {
    if (this.viewMode) return;
    this.vizType = t;
    this.computePreviewStats();
    this.scheduleRender();
  }

  onConfigChange(): void {
    this.computePreviewStats();
    this.scheduleRender();
  }

  /** Clear any selections that don't exist on the current table — the user picks the rest. */
  private applyDefaultsForTable(): void {
    if (this.groupBy && !this.groupableColumns.some(c => c.id === this.groupBy)) this.groupBy = '';
    if (this.aggregateColumn && !this.numericColumns.some(c => c.id === this.aggregateColumn)) this.aggregateColumn = '';
    this.filterCols = this.filterCols.filter(c => this.filterableColumns.some(col => col.id === c));
    // Default: include every column of the newly-selected source.
    this.selectedCols = (this.currentTable?.columns || []).map(c => c.id);
  }

  private renderTimer: any = null;
  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.renderPreview(), 60);
  }

  // ────────────────────────────────────────────────
  // Preview rendering
  // ────────────────────────────────────────────────
  renderPreview(): void {
    const tbl = this.currentTable;
    if (!tbl) return;

    const chartHost = document.getElementById('rb-chart-host');
    const listHost  = document.getElementById('rb-list-host');
    const kpiHost   = document.getElementById('rb-kpi-host');
    if (!chartHost || !listHost || !kpiHost) return;

    // Reset all hosts
    if (this.chartInstance) { try { this.chartInstance.destroy(); } catch {} this.chartInstance = null; }
    chartHost.style.display = 'none';
    listHost.style.display  = 'none';
    kpiHost.style.display   = 'none';
    listHost.innerHTML = '';
    kpiHost.innerHTML  = '';

    // A fixed layout is selected — render its formatted preview and stop.
    if (this.layoutId) {
      listHost.style.display = 'block';
      const up = this.uploaded.find(u => u.id === this.layoutId);
      if (up) {
        listHost.innerHTML = up.kind === 'image'
          ? `<div class="rb-uploaded-layout"><img src="${up.content}" alt="${up.name}"/></div>`
          : `<div class="rb-uploaded-layout">${up.content}</div>`;
      } else {
        listHost.innerHTML = buildLayoutPreviewHtml(this.layoutId) ||
          '<div class="rb-chart-fallback">Layout preview unavailable.</div>';
      }
      return;
    }

    // Nothing chosen yet — keep the preview blank until the user picks a visualisation.
    if (!this.vizType) return;

    if (this.vizType === 'list') {
      listHost.style.display = 'block';
      this.renderList(listHost, tbl);
      return;
    }

    if (this.vizType === 'kpi') {
      kpiHost.style.display = 'flex';
      this.renderKpi(kpiHost, tbl);
      return;
    }

    chartHost.style.display = 'block';
    this.renderChart(chartHost as HTMLCanvasElement, tbl);
  }

  private renderList(host: HTMLElement, tbl: DataTable): void {
    const cols = this.visibleColumns;
    const all  = this.filteredRows();
    const rows = all.slice(0, 12);
    const head = '<thead><tr>' + cols.map(c => `<th>${this.esc(c.label)}</th>`).join('') + '</tr></thead>';
    const body = '<tbody>' + rows.map(r =>
      '<tr>' + cols.map(c => `<td>${this.esc(this.formatCell(r[c.id], c.type))}</td>`).join('') + '</tr>'
    ).join('') + '</tbody>';
    host.innerHTML = `<table class="rb-list-tbl">${head}${body}</table>` +
      (all.length > rows.length ? `<div class="rb-list-foot">Showing ${rows.length} of ${all.length} rows</div>` : '');
  }

  private renderKpi(host: HTMLElement, tbl: DataTable): void {
    const agg = this.aggregate(tbl);
    const total = agg.values.reduce((a, b) => a + b, 0);
    const fn = this.aggregateFn;
    let value: number = total;
    if (fn === 'avg') {
      value = agg.values.length ? total / agg.values.length : 0;
    } else if (fn === 'min') {
      value = agg.values.length ? Math.min(...agg.values) : 0;
    } else if (fn === 'max') {
      value = agg.values.length ? Math.max(...agg.values) : 0;
    }
    const formatted = this.formatNumber(value);
    const label = fn === 'count'
      ? `Total ${tbl.name.toLowerCase()}`
      : `${this.fnLabel(fn)} of ${this.colLabel(this.aggregateColumn)}`;

    host.innerHTML = `
      <div class="rb-kpi-card">
        <div class="rb-kpi-value">${this.esc(formatted)}</div>
        <div class="rb-kpi-label">${this.esc(label)}</div>
        <div class="rb-kpi-sub">across ${agg.labels.length} ${this.colLabel(this.groupBy).toLowerCase()}${agg.labels.length === 1 ? '' : 's'}</div>
      </div>
    `;
  }

  private renderChart(host: HTMLCanvasElement, tbl: DataTable): void {
    if (!this.chartJsAvailable) {
      const parent = host.parentElement;
      if (parent) parent.innerHTML = '<div class="rb-chart-fallback">Chart.js not available — preview disabled.</div>';
      return;
    }

    const Chart = (window as any).Chart;
    const agg = this.aggregate(tbl);
    const palette = ['#29378d', '#00B050', '#FFC000', '#FF0000', '#1F3864', '#00B0F0', '#7F7F7F', '#A5A5A5', '#D6E4F0', '#29378d'];
    const colors = agg.labels.map((_, i) => palette[i % palette.length]);

    const isPie = this.vizType === 'pie' || this.vizType === 'donut';
    const cfg: any = {
      type: this.vizType === 'donut' ? 'doughnut' : (this.vizType === 'pie' ? 'pie' : this.vizType),
      data: {
        labels: agg.labels,
        datasets: [{
          label: this.aggregateFn === 'count' ? 'Count' : `${this.fnLabel(this.aggregateFn)} of ${this.colLabel(this.aggregateColumn)}`,
          data: agg.values,
          backgroundColor: isPie ? colors : 'rgba(41,55,141, 0.65)',
          borderColor: isPie ? '#fff' : 'rgba(41,55,141, 1)',
          borderWidth: isPie ? 2 : 0,
          borderRadius: isPie ? 0 : 4,
          tension: this.vizType === 'line' ? 0.3 : 0,
          fill: this.vizType === 'line',
          pointRadius: this.vizType === 'line' ? 3 : 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isPie,
            position: 'bottom',
            labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: '#1F3864', padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: (c: any) => `${c.label || ''}: ${this.formatNumber(c.parsed.y ?? c.parsed)}`
            }
          }
        },
        scales: isPie ? {} : {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#1F3864' } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, color: '#1F3864' }, beginAtZero: true }
        }
      }
    };

    this.chartInstance = new Chart(host, cfg);
  }

  // ────────────────────────────────────────────────
  // Aggregation
  // ────────────────────────────────────────────────
  private aggregate(_tbl: DataTable): { labels: string[]; values: number[] } {
    if (!this.groupBy) return { labels: [], values: [] };
    const groups: Record<string, number[]> = {};

    this.filteredRows().forEach(row => {
      const key = String(row[this.groupBy] ?? 'Unknown');
      if (!groups[key]) groups[key] = [];
      if (this.aggregateFn === 'count') {
        groups[key].push(1);
      } else {
        const raw = row[this.aggregateColumn];
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (!isNaN(num)) groups[key].push(num);
      }
    });

    const labels = Object.keys(groups);
    const values = labels.map(k => {
      const arr = groups[k];
      if (this.aggregateFn === 'count') return arr.length;
      if (this.aggregateFn === 'sum') return arr.reduce((a, b) => a + b, 0);
      if (this.aggregateFn === 'avg') return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      if (this.aggregateFn === 'min') return arr.length ? Math.min(...arr) : 0;
      if (this.aggregateFn === 'max') return arr.length ? Math.max(...arr) : 0;
      return 0;
    });

    return { labels, values };
  }

  // ────────────────────────────────────────────────
  // Save / cancel
  // ────────────────────────────────────────────────
  onSave(): void {
    const name = (this.reportName || '').trim();
    if (!name) { alert('Please name the report.'); return; }
    if (!this.sourceTableId) { alert('Please select a data source.'); return; }
    // A fixed layout supplies its own format — the chart/group/aggregate rules
    // don't apply, so only the name + source are required.
    if (!this.layoutId) {
      if (!this.vizType) { alert('Please choose a visualisation or a report layout.'); return; }
      if (this.vizType !== 'kpi' && this.vizType !== 'list' && !this.groupBy) {
        alert('Please pick a column to group by.');
        return;
      }
      if (this.vizType !== 'list' && !this.aggregateFn) {
        alert('Please choose an aggregate.');
        return;
      }
      if (this.needsAggregateColumn && !this.aggregateColumn) {
        alert('Please pick a numeric column for the aggregate.');
        return;
      }
    }

    const now = new Date().toISOString();
    const existing = this.reportId ? findReport(this.reportId) : null;
    const record: SavedReport = {
      id: existing?.id || this.reportId || this.generateId(),
      name,
      description: (this.reportDescription || '').trim(),
      sourceTableId: this.sourceTableId,
      sourceTableName: this.currentTable?.name || this.sourceTableId,
      vizType: (this.vizType || 'list') as ReportVizType,
      layoutId: this.layoutId || undefined,
      groupBy: this.groupBy,
      aggregateColumn: this.needsAggregateColumn ? this.aggregateColumn : '',
      aggregateFn: (this.aggregateFn || 'count') as ReportAggregateFn,
      metrics: this.metrics.slice(),
      columns: this.selectedCols.length ? this.selectedCols.slice() : (this.currentTable?.columns.map(c => c.id) || []),
      filters: this.filterCols.map(col => ({ column: col, label: this.colLabel(col), type: this.colType(col) })),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      owner: existing?.owner || 'You',
      lastRun: now
    };
    upsertReport(record);
    this.router.navigate(['/reports']);
  }

  onCancel(): void {
    this.router.navigate(['/reports']);
  }

  enterEdit(): void {
    this.viewMode = false;
  }

  // ────────────────────────────────────────────────
  // Formatting helpers
  // ────────────────────────────────────────────────
  private generateId(): string {
    return 'rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  private fnLabel(fn: ReportAggregateFn | ''): string {
    if (!fn) return '';
    return ({ count: 'Count', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' } as Record<string,string>)[fn] || fn;
  }

  private colLabel(id: string): string {
    return this.currentTable?.columns.find(c => c.id === id)?.label || id || 'group';
  }

  private formatCell(val: any, type: string): string {
    if (val == null) return '—';
    if (type === 'number') return this.formatNumber(val);
    return String(val);
  }

  private formatNumber(n: number): string {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (abs >= 10_000)    return (n / 1_000).toFixed(1) + 'K';
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toFixed(2);
  }

  private esc(s: any): string {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]
    );
  }

  // ────────────────────────────────────────────────
  // Mock data sources — wired statically for now
  // ────────────────────────────────────────────────
  private buildTables(): DataTable[] {
    const wells: DataTable = {
      id: 'wells',
      name: 'Wells',
      dbName: 'db.WMR',
      description: 'Active well programme — 20 wells across 5 clusters',
      columns: [
        { id: 'well_id',    label: 'Well ID',                type: 'string' },
        { id: 'cluster',    label: 'Cluster',                type: 'string' },
        { id: 'status',     label: 'Status',                 type: 'string' },
        { id: 'discipline', label: 'Discipline',             type: 'string' },
        { id: 'progress',   label: 'Progress %',             type: 'number' },
        { id: 'penalty',    label: 'Penalty Exposure (OMR)', type: 'number' },
        { id: 'rig_on',     label: 'Rig-On Date',            type: 'date'   }
      ],
      rows: [
        { well_id: '34565', cluster: 'NIMR',    status: 'On Track',  discipline: 'Mechanical', progress: 78, penalty: 0,     rig_on: '2026-04-28' },
        { well_id: '34561', cluster: 'NIMR',    status: 'At Risk',   discipline: 'Civil',      progress: 64, penalty: 19000, rig_on: '2026-05-12' },
        { well_id: '31780', cluster: 'NIMR',    status: 'Critical',  discipline: 'Mechanical', progress: 62, penalty: 52000, rig_on: '2026-03-17' },
        { well_id: '36078', cluster: 'NIMR',    status: 'Ahead',     discipline: 'Electrical', progress: 81, penalty: 0,     rig_on: '2026-03-15' },
        { well_id: '34422', cluster: 'AL BURJ', status: 'On Track',  discipline: 'Mechanical', progress: 71, penalty: 0,     rig_on: '2026-04-22' },
        { well_id: '37797', cluster: 'AL BURJ', status: 'Critical',  discipline: 'Civil',      progress: 47, penalty: 48000, rig_on: '2026-04-10' },
        { well_id: '34357', cluster: 'AL BURJ', status: 'At Risk',   discipline: 'Mechanical', progress: 58, penalty: 21000, rig_on: '2026-04-30' },
        { well_id: '24665', cluster: 'AL BURJ', status: 'On Track',  discipline: 'Instrument', progress: 88, penalty: 0,     rig_on: '2026-04-05' },
        { well_id: '30330', cluster: 'AMIN',    status: 'On Track',  discipline: 'Civil',      progress: 75, penalty: 0,     rig_on: '2026-05-08' },
        { well_id: '36076', cluster: 'AMIN',    status: 'Ahead',     discipline: 'Mechanical', progress: 92, penalty: 0,     rig_on: '2026-03-29' },
        { well_id: '36075', cluster: 'AMIN',    status: 'On Track',  discipline: 'Electrical', progress: 68, penalty: 0,     rig_on: '2026-05-15' },
        { well_id: '36106', cluster: 'AMIN',    status: 'At Risk',   discipline: 'Instrument', progress: 52, penalty: 18000, rig_on: '2026-05-20' },
        { well_id: '33146', cluster: 'TUQAA',   status: 'On Track',  discipline: 'Mechanical', progress: 73, penalty: 0,     rig_on: '2026-05-01' },
        { well_id: '33147', cluster: 'TUQAA',   status: 'On Track',  discipline: 'Civil',      progress: 80, penalty: 0,     rig_on: '2026-04-18' },
        { well_id: '33152', cluster: 'TUQAA',   status: 'Critical',  discipline: 'Mechanical', progress: 41, penalty: 67000, rig_on: '2026-04-25' },
        { well_id: '33153', cluster: 'TUQAA',   status: 'Critical',  discipline: 'Mechanical', progress: 38, penalty: 71000, rig_on: '2026-05-25' },
        { well_id: '36748', cluster: 'RAKID',   status: 'On Track',  discipline: 'Electrical', progress: 76, penalty: 0,     rig_on: '2026-04-12' },
        { well_id: '36749', cluster: 'RAKID',   status: 'Ahead',     discipline: 'Civil',      progress: 95, penalty: 0,     rig_on: '2026-03-20' },
        { well_id: '36757', cluster: 'RAKID',   status: 'On Track',  discipline: 'Mechanical', progress: 72, penalty: 0,     rig_on: '2026-05-03' },
        { well_id: '36758', cluster: 'RAKID',   status: 'At Risk',   discipline: 'Instrument', progress: 55, penalty: 16000, rig_on: '2026-05-18' }
      ]
    };

    const crews: DataTable = {
      id: 'crews',
      name: 'Crews',
      dbName: 'dbo.crews',
      description: '20 crews across 4 disciplines, with hours and P-rating',
      columns: [
        { id: 'crew_id',     label: 'Crew ID',          type: 'string' },
        { id: 'discipline',  label: 'Discipline',       type: 'string' },
        { id: 'p_rating',    label: 'P-Rating',         type: 'string' },
        { id: 'hours',       label: 'Hours This Month', type: 'number' },
        { id: 'utilization', label: 'Utilization %',    type: 'number' }
      ],
      rows: [
        { crew_id: 'CW-001', discipline: 'Mechanical', p_rating: 'P6', hours: 184, utilization: 92 },
        { crew_id: 'CW-002', discipline: 'Mechanical', p_rating: 'P5', hours: 176, utilization: 88 },
        { crew_id: 'CW-003', discipline: 'Mechanical', p_rating: 'P7', hours: 192, utilization: 96 },
        { crew_id: 'CW-004', discipline: 'Civil',      p_rating: 'P6', hours: 168, utilization: 84 },
        { crew_id: 'CW-005', discipline: 'Civil',      p_rating: 'P5', hours: 172, utilization: 86 },
        { crew_id: 'CW-006', discipline: 'Civil',      p_rating: 'P4', hours: 158, utilization: 79 },
        { crew_id: 'CW-007', discipline: 'Civil',      p_rating: 'P6', hours: 180, utilization: 90 },
        { crew_id: 'CW-008', discipline: 'Civil',      p_rating: 'P5', hours: 176, utilization: 88 },
        { crew_id: 'CW-009', discipline: 'Electrical', p_rating: 'P7', hours: 188, utilization: 94 },
        { crew_id: 'CW-010', discipline: 'Electrical', p_rating: 'P6', hours: 184, utilization: 92 },
        { crew_id: 'CW-011', discipline: 'Instrument', p_rating: 'P6', hours: 180, utilization: 90 },
        { crew_id: 'CW-012', discipline: 'Instrument', p_rating: 'P5', hours: 172, utilization: 86 },
        { crew_id: 'CW-013', discipline: 'Mechanical', p_rating: 'P8', hours: 196, utilization: 98 },
        { crew_id: 'CW-014', discipline: 'Mechanical', p_rating: 'P5', hours: 174, utilization: 87 },
        { crew_id: 'CW-015', discipline: 'Civil',      p_rating: 'P6', hours: 178, utilization: 89 },
        { crew_id: 'CW-016', discipline: 'Electrical', p_rating: 'P5', hours: 170, utilization: 85 },
        { crew_id: 'CW-017', discipline: 'Electrical', p_rating: 'P4', hours: 162, utilization: 81 },
        { crew_id: 'CW-018', discipline: 'Instrument', p_rating: 'P7', hours: 186, utilization: 93 },
        { crew_id: 'CW-019', discipline: 'Instrument', p_rating: 'P5', hours: 174, utilization: 87 },
        { crew_id: 'CW-020', discipline: 'Mechanical', p_rating: 'P6', hours: 182, utilization: 91 }
      ]
    };

    const phProd: DataTable = {
      id: 'phprod',
      name: 'PH Productivity',
      dbName: 'dbo.ph_productivity',
      description: 'Piping-head crew productivity — 20 activity records across P0–P9 ratings',
      columns: [
        { id: 'crew_id',       label: 'Crew ID',         type: 'string' },
        { id: 'p_rating',      label: 'P-Rating',        type: 'string' },
        { id: 'activity_name', label: 'Activity Name',   type: 'string' },
        { id: 'activity_id',   label: 'Activity ID',     type: 'string' },
        { id: 'well_id',       label: 'Well ID',         type: 'string' },
        { id: 'progress',      label: 'Progress %',      type: 'number' },
        { id: 'status',        label: 'Activity Status', type: 'string' },
        { id: 'date',          label: 'Date',            type: 'date'   }
      ],
      rows: PH_PROD_ROWS
    };

    const activities: DataTable = {
      id: 'activities',
      name: 'Activities',
      dbName: 'dbo.activities',
      description: 'Activity-level execution snapshot — plan vs actual quantities',
      columns: [
        { id: 'code',       label: 'Activity Code', type: 'string' },
        { id: 'discipline', label: 'Discipline',    type: 'string' },
        { id: 'status',     label: 'Status',        type: 'string' },
        { id: 'plan_qty',   label: 'Plan Qty',      type: 'number' },
        { id: 'actual_qty', label: 'Actual Qty',    type: 'number' },
        { id: 'variance',   label: 'Variance',      type: 'number' }
      ],
      rows: [
        { code: 'F-M-SLW-FLY-10',  discipline: 'Mechanical', status: 'On Track', plan_qty: 460,  actual_qty: 484,  variance: 24 },
        { code: 'F-M-SLW-PWD-41',  discipline: 'Mechanical', status: 'On Track', plan_qty: 218,  actual_qty: 236,  variance: 18 },
        { code: 'F-M-SLW-PWD-43',  discipline: 'Mechanical', status: 'Ahead',    plan_qty: 42,   actual_qty: 46,   variance: 4 },
        { code: 'F-M-SLW-BUP-01',  discipline: 'Mechanical', status: 'On Track', plan_qty: 60,   actual_qty: 65,   variance: 5 },
        { code: 'F-C-RDG-GRD-03',  discipline: 'Civil',      status: 'Critical', plan_qty: 18,   actual_qty: 9,    variance: -9 },
        { code: 'F-C-EXC-MNS-02',  discipline: 'Civil',      status: 'Critical', plan_qty: 2800, actual_qty: 1640, variance: -1160 },
        { code: 'F-C-EXC-MHD-03',  discipline: 'Civil',      status: 'At Risk',  plan_qty: 420,  actual_qty: 210,  variance: -210 },
        { code: 'F-C-PAD-PRE-01',  discipline: 'Civil',      status: 'At Risk',  plan_qty: 1200, actual_qty: 620,  variance: -580 },
        { code: 'F-E-CAB-LVL-02',  discipline: 'Electrical', status: 'On Track', plan_qty: 4200, actual_qty: 4050, variance: -150 },
        { code: 'F-I-CAB-INC-02',  discipline: 'Instrument', status: 'On Track', plan_qty: 3800, actual_qty: 3820, variance: 20 },
        { code: 'F-I-PNL-INS-01',  discipline: 'Instrument', status: 'On Track', plan_qty: 4,    actual_qty: 4,    variance: 0 },
        { code: 'F-I-LPC-CHK-01',  discipline: 'Instrument', status: 'At Risk',  plan_qty: 12,   actual_qty: 11,   variance: -1 },
        { code: 'F-M-BHP-LPR-05',  discipline: 'Mechanical', status: 'On Track', plan_qty: 5,    actual_qty: 5,    variance: 0 },
        { code: 'F-M-RIG-LFT-02',  discipline: 'Mechanical', status: 'Ahead',    plan_qty: 148,  actual_qty: 156,  variance: 8 },
        { code: 'F-M-RIG-MSH-01',  discipline: 'Mechanical', status: 'On Track', plan_qty: 88,   actual_qty: 92,   variance: 4 },
        { code: 'F-M-RIG-YRD-01',  discipline: 'Mechanical', status: 'On Track', plan_qty: 18,   actual_qty: 19,   variance: 1 }
      ]
    };

    const requests = this.buildSubmittedRequestsTable();

    return [wells, crews, phProd, activities, requests];
  }

  /** Builds a "Submitted Requests" table from the live My Requests store. */
  private buildSubmittedRequestsTable(): DataTable {
    const cols: DataColumn[] = [
      { id: 'reference',   label: 'Reference',    type: 'string' },
      { id: 'formName',    label: 'Form',         type: 'string' },
      { id: 'submittedBy', label: 'Submitted By', type: 'string' },
      { id: 'status',      label: 'Status',       type: 'string' }
    ];
    let rows: any[] = [];
    try {
      const raw = localStorage.getItem('altasnim.requests');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) rows = arr.map((r: any) => ({
          reference:   r.reference || r.id,
          formName:    r.formName || 'Unknown',
          submittedBy: r.submittedBy || 'Unknown',
          status:      r.status || 'Pending'
        }));
      }
    } catch {}
    return {
      id: 'requests',
      name: 'Submitted Requests',
      dbName: 'dbo.submitted_requests',
      description: 'Live request submissions from My Requests',
      columns: cols,
      rows
    };
  }

  trackById = (_: number, item: { id: string }) => item.id;
}

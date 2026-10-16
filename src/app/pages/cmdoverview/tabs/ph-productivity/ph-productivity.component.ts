import { Component, AfterViewInit, OnDestroy, ElementRef, Input, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

declare var Chart: any;
declare var agGrid: any;

interface HeatmapRow  { name: string; weeks: number[]; }
interface RankRow     { rank: number; name: string; discipline: string; contractor: string; avgProd: number; piScore: string; piNum: number; trend: number; }
interface CriticalRow { name: string; discipline: string; contractor: string; currentPI: string; piNum: number; avgProd: number; trend: number; riskStatus: 'Critical' | 'High' | 'Medium'; }

interface PhProdRow {
  sNo: number; month: string; year: number; monthStart: string;
  paName: string; phEmpId: string; phName: string; atnmSubContractor: string;
  category: string; crewType: string; crewDiscipline: string; crewName: string;
  averageProductivity: number | null;
  w1PiCmr: string | null; w1PiTWise: string | null;
  w2PiCmr: string | null; w2PiTWise: string | null;
  w3PiCmr: string | null; w3PiTWise: string | null;
  w4PiCmr: string | null; w4PiTWise: string | null;
  w5PiCmr: string | null; w5PiTWise: string | null;
  monthPiCmr: string | null; monthPiTWise: string | null;
}

interface PhProdResponse {
  data: PhProdRow[];
  totalRows: number;
  monthsCovered: string[];
  generatedAt: string;
}

interface PhReportColumn {
  key: string;
  label: string;
  value: (row: PhProdRow) => string | number;
}

@Component({
  selector: 'app-ph-productivity',
  templateUrl: './ph-productivity.component.html',
  styleUrls: ['./ph-productivity.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PhProductivityComponent implements AfterViewInit, OnDestroy {

  @Input() showReportToolbar = false;

  @ViewChild('trendChart')     trendChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('categoryChart')  categoryChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sparklineChart') sparklineChartRef!: ElementRef<HTMLCanvasElement>;

  private _cachedFilteredRows: PhProdRow[] | null = null;

  private charts: any[]  = [];
  private hmGrid:   any  = null;
  private rankGrid: any  = null;
  private critGrid: any  = null;
  private fullGrid: any  = null;
  private rawRows: PhProdRow[] = [];
  loading = true;
  error: string | null = null;

  // ── Report modal filters / actions ───────────────────────────────────────
  phFilter = { type: 'All', location: 'All', category: 'All', discipline: 'All', search: '' };
  phTypeOptions: string[] = [];
  phLocationOptions: string[] = [];
  phCategoryOptions: string[] = [];
  phDisciplineOptions: string[] = [];
  showPhCustomPanel = false;
  phCustomColDefs = [
    { key: 'sNo', label: 'S.No', sel: true },
    { key: 'month', label: 'Month', sel: true },
    { key: 'year', label: 'Year', sel: true },
    { key: 'paName', label: 'PA Name', sel: true },
    { key: 'phEmpId', label: 'PH Emp ID', sel: true },
    { key: 'phName', label: 'PH Name', sel: true },
    { key: 'atnmSubContractor', label: 'ATNM/Sub Contractor', sel: true },
    { key: 'category', label: 'Category', sel: true },
    { key: 'crewType', label: 'Crew Type', sel: true },
    { key: 'crewDiscipline', label: 'Crew Discipline', sel: true },
    { key: 'crewName', label: 'Crew Name', sel: true },
    { key: 'averageProductivity', label: 'Average Productivity (%)', sel: true },
    { key: 'w1PiCmr', label: 'W1 PI (CMR)', sel: true },
    { key: 'w1PiTWise', label: 'W1 PI (T-Wise)', sel: true },
    { key: 'w2PiCmr', label: 'W2 PI (CMR)', sel: true },
    { key: 'w2PiTWise', label: 'W2 PI (T-Wise)', sel: true },
    { key: 'w3PiCmr', label: 'W3 PI (CMR)', sel: true },
    { key: 'w3PiTWise', label: 'W3 PI (T-Wise)', sel: true },
    { key: 'w4PiCmr', label: 'W4 PI (CMR)', sel: true },
    { key: 'w4PiTWise', label: 'W4 PI (T-Wise)', sel: true },
    { key: 'w5PiCmr', label: 'W5 PI (CMR)', sel: true },
    { key: 'w5PiTWise', label: 'W5 PI (T-Wise)', sel: true },
    { key: 'monthPiCmr', label: 'Month PI (CMR)', sel: true },
    { key: 'monthPiTWise', label: 'Month PI (T-Wise)', sel: true },
  ];

  private readonly phReportColumns: PhReportColumn[] = [
    { key: 'sNo', label: 'S.No', value: r => r.sNo },
    { key: 'month', label: 'Month', value: r => r.month },
    { key: 'year', label: 'Year', value: r => r.year },
    { key: 'paName', label: 'PA Name', value: r => this.cleanMultiline(r.paName) },
    { key: 'phEmpId', label: 'PH Emp ID', value: r => r.phEmpId },
    { key: 'phName', label: 'PH Name', value: r => r.phName },
    { key: 'atnmSubContractor', label: 'ATNM/Sub Contractor', value: r => r.atnmSubContractor },
    { key: 'category', label: 'Category', value: r => this.cleanMultiline(r.category) },
    { key: 'crewType', label: 'Crew Type', value: r => this.cleanMultiline(r.crewType) },
    { key: 'crewDiscipline', label: 'Crew Discipline', value: r => this.cleanMultiline(r.crewDiscipline) },
    { key: 'crewName', label: 'Crew Name', value: r => this.cleanMultiline(r.crewName) },
    { key: 'averageProductivity', label: 'Average Productivity (%)', value: r => r.averageProductivity ?? '' },
    { key: 'w1PiCmr', label: 'W1 PI (CMR)', value: r => r.w1PiCmr ?? 'NA' },
    { key: 'w1PiTWise', label: 'W1 PI (T-Wise)', value: r => r.w1PiTWise ?? 'NA' },
    { key: 'w2PiCmr', label: 'W2 PI (CMR)', value: r => r.w2PiCmr ?? 'NA' },
    { key: 'w2PiTWise', label: 'W2 PI (T-Wise)', value: r => r.w2PiTWise ?? 'NA' },
    { key: 'w3PiCmr', label: 'W3 PI (CMR)', value: r => r.w3PiCmr ?? 'NA' },
    { key: 'w3PiTWise', label: 'W3 PI (T-Wise)', value: r => r.w3PiTWise ?? 'NA' },
    { key: 'w4PiCmr', label: 'W4 PI (CMR)', value: r => r.w4PiCmr ?? 'NA' },
    { key: 'w4PiTWise', label: 'W4 PI (T-Wise)', value: r => r.w4PiTWise ?? 'NA' },
    { key: 'w5PiCmr', label: 'W5 PI (CMR)', value: r => r.w5PiCmr ?? 'NA' },
    { key: 'w5PiTWise', label: 'W5 PI (T-Wise)', value: r => r.w5PiTWise ?? 'NA' },
    { key: 'monthPiCmr', label: 'Month PI (CMR)', value: r => r.monthPiCmr ?? 'NA' },
    { key: 'monthPiTWise', label: 'Month PI (T-Wise)', value: r => r.monthPiTWise ?? 'NA' },
  ];

  // ── KPI ──────────────────────────────────────────────────────────────────
  avgProductivity    = 0;
  p8Score            = 0;
  criticalCrewsCount = 0;
  criticalCrewsPct   = 0;
  bestContractor     = '—';
  bestContractorProd = 0;
  bestContractorP8   = 0;

  // ── Trend ─────────────────────────────────────────────────────────────────
  weekDates: string[]   = [];
  plannedData: number[] = [];
  actualData: number[]  = [];
  piScoreData: number[] = [];

  // ── Heatmap ────────────────────────────────────────────────────────────────
  heatmapRows: HeatmapRow[] = [];

  // ── Discipline ────────────────────────────────────────────────────────────
  disciplines: { name: string; planned: number; actual: number }[] = [];

  // ── Category donut ────────────────────────────────────────────────────────
  categoryData: { name: string; pct: number; color: string }[] = [];

  // ── Rankings ──────────────────────────────────────────────────────────────
  topCrews: RankRow[] = [];

  // ── Critical Crews ────────────────────────────────────────────────────────
  criticalCrews: CriticalRow[] = [];

  // ── Gauge SVG ─────────────────────────────────────────────────────────────
  readonly gaugeArcPath = 'M 15 80 A 65 65 0 0 1 145 80';
  get gaugeCircumference(): number { return Math.PI * 65; }
  get gaugeDashArray(): string {
    const fill = this.gaugeCircumference * Math.min(this.avgProductivity, 100) / 100;
    return `${fill.toFixed(1)} ${(this.gaugeCircumference + 30).toFixed(1)}`;
  }

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  // ── Helpers ───────────────────────────────────────────────────────────────
  filteredRowsCount = 0;

  onPhFilterChange(): void {
    this._invalidateFilterCache();
    this.cdr.markForCheck();
    setTimeout(() => this.buildFullReportGrid(), 0);
  }

  togglePhCustomPanel(e: Event): void {
    e.stopPropagation();
    this.showPhCustomPanel = !this.showPhCustomPanel;
  }

  closePhCustomPanel(): void {
    this.showPhCustomPanel = false;
  }

  exportPdf(): void {
    this.openPrintableReport('PH Productivity Weekly Report', this.phReportColumns);
  }

  printReport(): void {
    this.openPrintableReport('PH Productivity Weekly Report', this.phReportColumns);
  }

  mailReport(): void {
    const subject = encodeURIComponent('PH Productivity Weekly Report');
    const body = encodeURIComponent(
      `PH Productivity Weekly Report\n` +
      `Rows: ${this.filteredRowsCount}\n` +
      `Filters: ${this.reportFilterSummary()}\n` +
      `Generated: ${new Date().toLocaleString()}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  exportPhCustomPdf(): void {
    this.showPhCustomPanel = false;
    const cols = this.selectedReportColumns();
    if (!cols.length) { alert('Select at least one column.'); return; }
    this.openPrintableReport('PH Productivity Custom Report', cols);
  }

  exportPhCustomExcel(): void {
    this.showPhCustomPanel = false;
    const cols = this.selectedReportColumns();
    if (!cols.length) { alert('Select at least one column.'); return; }
    this.exportRowsToExcel(this.filteredRows, cols, `PH_Productivity_Custom_${this.fileDate()}.xlsx`, 'Custom Report');
  }

  private _invalidateFilterCache(): void {
    this._cachedFilteredRows = null;
    this.filteredRowsCount = this.filteredRows.length;
  }

  private get filteredRows(): PhProdRow[] {
    if (this._cachedFilteredRows) return this._cachedFilteredRows;
    const type = this.norm(this.phFilter.type);
    const location = this.norm(this.phFilter.location);
    const category = this.norm(this.phFilter.category);
    const discipline = this.norm(this.phFilter.discipline);
    const search = this.norm(this.phFilter.search);

    this._cachedFilteredRows = this.rawRows.filter(row => {
      const rowType = this.norm(row.atnmSubContractor);
      const cats = this.splitValues(row.category);
      const catMeta = this.categoryMeta(row);
      const disciplines = this.splitValues(row.crewDiscipline).map(v => this.norm(v));
      const searchText = this.norm([
        row.sNo, row.month, row.year, row.paName, row.phEmpId, row.phName,
        row.atnmSubContractor, row.category, row.crewType, row.crewDiscipline,
        row.crewName, row.averageProductivity, row.monthPiCmr, row.monthPiTWise
      ].join(' '));

      return (type === 'all' || rowType === type) &&
        (location === 'all' || catMeta.locations.some(v => this.norm(v) === location)) &&
        (category === 'all' || catMeta.categories.some(v => this.norm(v) === category) || cats.some(v => this.norm(v) === category)) &&
        (discipline === 'all' || disciplines.includes(discipline)) &&
        (!search || searchText.includes(search));
    });
    return this._cachedFilteredRows;
  }

  private reportFilterSummary(): string {
    const parts = [
      `Type=${this.phFilter.type}`,
      `Location=${this.phFilter.location}`,
      `Category=${this.phFilter.category}`,
      `Discipline=${this.phFilter.discipline}`,
    ];
    if (this.phFilter.search.trim()) parts.push(`Search=${this.phFilter.search.trim()}`);
    return parts.join(', ');
  }

  private selectedReportColumns(): PhReportColumn[] {
    const selected = new Set(this.phCustomColDefs.filter(c => c.sel).map(c => c.key));
    return this.phReportColumns.filter(c => selected.has(c.key));
  }

  private refreshReportOptions(rows: PhProdRow[]): void {
    const types = new Set<string>();
    const locations = new Set<string>();
    const categories = new Set<string>();
    const disciplines = new Set<string>();

    rows.forEach(row => {
      this.addOption(types, row.atnmSubContractor);
      const meta = this.categoryMeta(row);
      meta.locations.forEach(v => this.addOption(locations, v));
      meta.categories.forEach(v => this.addOption(categories, v));
      this.splitValues(row.crewDiscipline).forEach(v => this.addOption(disciplines, v));
    });

    this.phTypeOptions = this.sortedOptions(types);
    this.phLocationOptions = this.sortedOptions(locations);
    this.phCategoryOptions = this.sortedOptions(categories);
    this.phDisciplineOptions = this.sortedOptions(disciplines);
  }

  private categoryMeta(row: PhProdRow): { locations: string[]; categories: string[] } {
    const locations = new Set<string>();
    const categories = new Set<string>();
    this.splitValues(row.category).forEach(value => {
      const parts = value.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        this.addOption(locations, parts[0]);
        this.addOption(categories, parts.slice(1).join(' '));
      } else {
        this.addOption(categories, value);
      }
    });
    return { locations: [...locations], categories: [...categories] };
  }

  private addOption(set: Set<string>, value: string | null | undefined): void {
    const clean = this.cleanMultiline(value).trim();
    if (clean && clean !== 'NA') set.add(clean);
  }

  private sortedOptions(values: Set<string>): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
  }

  private splitValues(value: string | null | undefined): string[] {
    return this.cleanMultiline(value).split('\n').map(v => v.trim()).filter(v => v && v !== 'NA');
  }

  private cleanMultiline(value: string | null | undefined): string {
    return String(value ?? 'NA').replace(/\\n/g, '\n');
  }

  private norm(value: any): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private fileDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private exportRowsToExcel(rows: PhProdRow[], cols: PhReportColumn[], filename: string, sheetName: string): void {
    if (!rows.length) return;
    const sheetRows = [
      cols.map(c => c.label),
      ...rows.map(row => cols.map(c => c.value(row)))
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    ws['!cols'] = cols.map(c => ({ wch: Math.min(Math.max(c.label.length + 4, 12), 32) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), filename);
  }

  private openPrintableReport(title: string, cols: PhReportColumn[]): void {
    const rows = this.filteredRows;
    if (!rows.length) return;
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDF'); return; }
    const th = cols.map(c => `<th>${this.escapeHtml(c.label)}</th>`).join('');
    const trs = rows.map(row => `<tr>${cols.map(c => `<td>${this.escapeHtml(c.value(row))}</td>`).join('')}</tr>`).join('');
    w.document.open();
    w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; color: #1f2937; }
    h1 { margin: 0; color: #1F3864; font-size: 20px; }
    .meta { margin: 6px 0 14px; color: #64748b; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { background: #1F3864; color: #fff; text-align: left; }
    th, td { border: 1px solid #d7dee8; padding: 5px 6px; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  <div class="meta">${this.escapeHtml(this.reportFilterSummary())} · ${rows.length} row(s) · ${this.escapeHtml(new Date().toLocaleString())}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
</body>
</html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
  }

  private escapeHtml(value: any): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, ch => map[ch]);
  }

  getPiClass(pi: number): string {
    if (pi < 0) return 'pi-na';
    if (pi >= 8) return 'pi-8';
    if (pi >= 6) return 'pi-67';
    if (pi >= 4) return 'pi-45';
    if (pi >= 1) return 'pi-13';
    return 'pi-0';
  }

  private piBadge(pi: number, label?: string): string {
    // Al Tasnim style guide: RAG palette + tinted badges
    const map: any = {
      8: '#E2F3E8:#00733A',  // Green tint + green text (Achieved)
      6: '#E4EEF7:#245F94',  // Blue tint + blue text (Reference/Good)
      4: '#FFF1CC:#946A00',  // Amber tint + amber text (At risk)
      1: '#FCE5E5:#C20000',  // Red tint + red text (Low)
      0: '#FCE5E5:#C20000',  // Red tint + red text (Missed)
      '-1': '#ECECEC:#5F5F5F', // NA tint + grey text
    };
    const key = pi < 0 ? '-1' : pi >= 8 ? 8 : pi >= 6 ? 6 : pi >= 4 ? 4 : pi >= 1 ? 1 : 0;
    const [bg, fg] = (map[key] as string).split(':');
    const lbl = label ?? (pi < 0 ? 'NA' : `P${pi}`);
    // Dot color uses the full RAG spec hex
    const dotColor = pi < 0 ? '#A5A5A5' : pi >= 8 ? '#00B050' : pi >= 6 ? '#29378d' : pi >= 4 ? '#FFC000' : '#FF0000';
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;background:${bg};color:${fg};font-weight:600;font-size:8.5pt;min-width:28px;text-align:center;line-height:1.5"><span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex:none"></span>${lbl}</span>`;
  }

  private piNum(pi: string | null): number {
    if (!pi || pi === 'NA') return -1;
    const n = parseInt(pi.replace('P', ''), 10);
    return isNaN(n) ? -1 : n;
  }

  private gridTheme(): string {
    return document.documentElement.classList.contains('navbar-light')
      ? 'ag-theme-alpine'
      : 'ag-theme-alpine-dark';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    this.fetchData();
  }

  ngOnDestroy(): void {
    this.charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    [this.hmGrid, this.rankGrid, this.critGrid, this.fullGrid].forEach(g => {
      if (g) { try { g.destroy(); } catch (_) {} }
    });
  }

  // ── API fetch ─────────────────────────────────────────────────────────────
  private fetchData(): void {
    this.loading = true;
    this.error = null;
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const url = `/api/v1/wells/ph-productivity/report?from=${from}&to=${to}`;

    this.http.get<PhProdResponse>(url).subscribe({
      next: (res) => {
        this.loading = false;
        this.processData(res.data);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.error = 'Failed to load PH Productivity data';
        console.warn('PH Productivity API error:', err);
        this.cdr.markForCheck();
      }
    });
  }

  // ── Transform API response → component properties ────────────────────────
  private processData(rows: PhProdRow[]): void {
    this.rawRows = rows;
    this._invalidateFilterCache();
    this.refreshReportOptions(rows);
    const valid = rows.filter(r => r.averageProductivity != null && r.phEmpId !== 'NA');

    // ── KPIs ──
    if (valid.length) {
      // Filter outliers (>500%) before computing average — extreme norms produce unrealistic values
      const reasonable = valid.filter(r => r.averageProductivity! <= 500 && r.averageProductivity! >= 0);
      this.avgProductivity = reasonable.length
        ? Math.round(reasonable.reduce((s, r) => s + r.averageProductivity!, 0) / reasonable.length * 10) / 10
        : 0;
    }
    const totalWithPi = valid.filter(r => r.monthPiCmr && r.monthPiCmr !== 'NA');
    const p8Count = totalWithPi.filter(r => r.monthPiCmr === 'P8').length;
    this.p8Score = totalWithPi.length ? Math.round(p8Count / totalWithPi.length * 100) : 0;

    const critical = totalWithPi.filter(r => this.piNum(r.monthPiCmr) <= 3 && this.piNum(r.monthPiCmr) >= 0);
    this.criticalCrewsCount = critical.length;
    this.criticalCrewsPct = totalWithPi.length ? Math.round(critical.length / totalWithPi.length * 1000) / 10 : 0;

    // Best contractor
    const byContractor = new Map<string, number[]>();
    valid.forEach(r => {
      const arr = byContractor.get(r.atnmSubContractor) || [];
      arr.push(r.averageProductivity!);
      byContractor.set(r.atnmSubContractor, arr);
    });
    let bestName = '—', bestAvg = 0;
    byContractor.forEach((vals, name) => {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (avg > bestAvg) { bestAvg = avg; bestName = name; }
    });
    this.bestContractor = bestName;
    this.bestContractorProd = Math.round(bestAvg * 10) / 10;
    const bestRows = valid.filter(r => r.atnmSubContractor === bestName);
    const bestP8 = bestRows.filter(r => r.monthPiCmr === 'P8').length;
    this.bestContractorP8 = bestRows.length ? Math.round(bestP8 / bestRows.length * 100) : 0;

    // ── Heatmap (PH Name × Week PI) ──
    this.heatmapRows = valid.slice(0, 20).map(r => ({
      name: r.phName,
      weeks: [
        this.piNum(r.w1PiCmr), this.piNum(r.w2PiCmr), this.piNum(r.w3PiCmr),
        this.piNum(r.w4PiCmr), this.piNum(r.w5PiCmr)
      ]
    }));

    // ── Discipline breakdown ──
    const discMap = new Map<string, number[]>();
    valid.forEach(r => {
      const discs = (r.crewDiscipline || 'NA').split('\n');
      discs.forEach(d => {
        if (d && d !== 'NA') {
          const arr = discMap.get(d) || [];
          arr.push(r.averageProductivity!);
          discMap.set(d, arr);
        }
      });
    });
    this.disciplines = [...discMap.entries()]
      .map(([name, vals]) => {
        // Filter outlier productivity values (>500%) before averaging
        const capped = vals.filter(v => v <= 500 && v >= 0);
        const avg = capped.length ? capped.reduce((s, v) => s + v, 0) / capped.length : 0;
        return { name, planned: 85, actual: Math.round(avg * 10) / 10 };
      })
      .sort((a, b) => b.actual - a.actual)
      .slice(0, 6);

    // ── Category donut ──
    const catColors = ['#29378d', '#00B050', '#9b59b6', '#FFC000', '#FF6B35', '#00B0F0'];
    const catMap = new Map<string, number>();
    valid.forEach(r => {
      const cats = (r.category || 'NA').split('\n');
      cats.forEach(c => { if (c && c !== 'NA') catMap.set(c, (catMap.get(c) || 0) + 1); });
    });
    const catTotal = [...catMap.values()].reduce((s, v) => s + v, 0);
    this.categoryData = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], i) => ({
        name,
        pct: Math.round(count / catTotal * 100),
        color: catColors[i % catColors.length]
      }));

    // ── Trend (weekly PI averages — latest month) ──
    const latestMonth = rows.length ? rows.reduce((m, r) => r.monthStart > m ? r.monthStart : m, '') : '';
    const latestRows = valid.filter(r => r.monthStart === latestMonth);
    const weekAvgs: number[] = [];
    for (let w = 1; w <= 5; w++) {
      const piKey = `w${w}PiCmr` as keyof PhProdRow;
      const withWeek = latestRows.filter(r => r[piKey] && r[piKey] !== 'NA' && r[piKey] !== null);
      weekAvgs.push(withWeek.length ? Math.round(withWeek.map(r => this.piNum(r[piKey] as string)).reduce((s, v) => s + v, 0) / withWeek.length * 10) / 10 : 0);
    }
    this.weekDates = ['Week 1 (1-7)', 'Week 2 (8-14)', 'Week 3 (15-21)', 'Week 4 (22-28)', 'Week 5 (29+)'];
    this.actualData = weekAvgs;
    this.plannedData = [5, 5, 5, 5, 5];
    this.piScoreData = weekAvgs;

    // ── Rankings (Top 10) — exclude outliers (>500%) ──
    this.topCrews = valid
      .filter(r => r.averageProductivity! > 0 && r.averageProductivity! <= 500)
      .sort((a, b) => b.averageProductivity! - a.averageProductivity!)
      .slice(0, 10)
      .map((r, i) => ({
        rank: i + 1,
        name: r.phName,
        discipline: (r.crewDiscipline || 'NA').split('\n')[0],
        contractor: r.atnmSubContractor,
        avgProd: Math.round(r.averageProductivity! * 100) / 100,
        piScore: r.monthPiCmr || 'NA',
        piNum: this.piNum(r.monthPiCmr),
        trend: 0
      }));

    // ── Critical Crews (P0–P3) ──
    this.criticalCrews = critical
      .sort((a, b) => (a.averageProductivity || 0) - (b.averageProductivity || 0))
      .slice(0, 10)
      .map(r => ({
        name: r.phName,
        discipline: (r.crewDiscipline || 'NA').split('\n')[0],
        contractor: r.atnmSubContractor,
        currentPI: r.monthPiCmr || 'NA',
        piNum: this.piNum(r.monthPiCmr),
        avgProd: Math.round((r.averageProductivity || 0) * 100) / 100,
        trend: 0,
        riskStatus: (this.piNum(r.monthPiCmr) <= 1 ? 'Critical' : this.piNum(r.monthPiCmr) <= 2 ? 'High' : 'Medium') as any
      }));

    // ── Build visuals ──
    setTimeout(() => {
      this.buildTrendChart();
      this.buildCategoryChart();
      this.buildHeatmapGrid();
      this.buildRankingGrid();
      this.buildCriticalGrid();
      this.buildFullReportGrid();
    }, 100);
  }

  // ── Chart: Weekly Productivity Trend ─────────────────────────────────────
  private buildTrendChart(): void {
    const canvas = this.trendChartRef?.nativeElement;
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.weekDates,
        datasets: [
          { label: 'Target (P5)', data: this.plannedData, borderColor: '#29378d', borderWidth: 2, borderDash: [5, 3], pointRadius: 0, tension: 0, yAxisID: 'y', fill: false },
          { label: 'Avg PI Score', data: this.actualData, borderColor: '#00B050', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#00B050', pointBorderWidth: 2, tension: 0.35, yAxisID: 'y', fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9.5 }, padding: 10 } } },
        scales: {
          y:  { min: 0, max: 8, ticks: { callback: (v: any) => 'P' + v, font: { size: 9 }, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.06)' } },
          x:  { ticks: { font: { size: 8.5 } }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
    this.charts.push(chart);
  }

  // ── Chart: Category donut ─────────────────────────────────────────────────
  private buildCategoryChart(): void {
    const canvas = this.categoryChartRef?.nativeElement;
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: this.categoryData.map(c => c.name), datasets: [{ data: this.categoryData.map(c => c.pct), backgroundColor: this.categoryData.map(c => c.color), borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${c.label}: ${c.parsed}%` } } } }
    });
    this.charts.push(chart);
  }

  // ── AG Grid: Heatmap ──────────────────────────────────────────────────────
  private buildHeatmapGrid(): void {
    const el = document.getElementById('phHeatmapGrid');
    if (!el || typeof agGrid === 'undefined') return;
    el.className = `${this.gridTheme()} ph-prod__ag-wrap`;

    const badge = (pi: number) => this.piBadge(pi);
    const columnDefs = [
      { headerName: 'PH Name', field: 'name', minWidth: 180, flex: 1.5, pinned: 'left', sortable: true, filter: true },
      ...['Week 1','Week 2','Week 3','Week 4','Week 5'].map((wk, i) => ({
        headerName: wk, field: `w${i + 1}`, minWidth: 100, flex: 1, sortable: true,
        comparator: (a: number, b: number) => a - b,
        cellRenderer: (p: any) => badge(p.value),
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' }
      }))
    ];
    const rowData = this.heatmapRows.map(r => ({
      name: r.name, w1: r.weeks[0], w2: r.weeks[1], w3: r.weeks[2], w4: r.weeks[3], w5: r.weeks[4]
    }));

    try { if (this.hmGrid) this.hmGrid.destroy(); } catch (_) {}
    this.hmGrid = agGrid.createGrid(el, {
      columnDefs, rowData,
      defaultColDef: { resizable: true, suppressMovable: true },
      domLayout: 'autoHeight', rowHeight: 44, headerHeight: 42,
      animateRows: true, suppressCellFocus: true, enableCellTextSelection: true,
    });
  }

  // ── AG Grid: Crew Performance Ranking ─────────────────────────────────────
  private buildRankingGrid(): void {
    const el = document.getElementById('phRankingGrid');
    if (!el || typeof agGrid === 'undefined') return;
    el.className = `${this.gridTheme()} ph-prod__ag-wrap`;

    const rankBadge = (n: number) => {
      // Al Tasnim style guide: Dark Blue, Mid Blue, Teal hierarchy
      const c = n === 1 ? 'background:#1F3864;color:#fff' : n === 2 ? 'background:#29378d;color:#fff' : n === 3 ? 'background:#00B0F0;color:#1F3864' : 'background:#D6E4F0;color:#1F3864';
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;${c};font-weight:700;font-size:9pt">${n}</span>`;
    };
    const columnDefs = [
      { headerName: 'Rank', field: 'rank', width: 80, sortable: true, cellStyle: { display: 'flex', alignItems: 'center' }, cellRenderer: (p: any) => rankBadge(p.value) },
      { headerName: 'PH Name', field: 'name', minWidth: 130, flex: 1, sortable: true, filter: true },
      { headerName: 'Discipline', field: 'discipline', width: 115, sortable: true, filter: true },
      { headerName: 'Contractor', field: 'contractor', width: 120, sortable: true, filter: true },
      { headerName: 'Avg Productivity (%)', field: 'avgProd', width: 160, sortable: true, type: 'numericColumn', cellRenderer: (p: any) => `<b>${p.value}%</b>` },
      { headerName: 'PI Score', field: 'piScore', width: 120, sortable: true, cellStyle: { display: 'flex', alignItems: 'center' }, cellRenderer: (p: any) => this.piBadge(p.data.piNum, p.value) },
    ];

    try { if (this.rankGrid) this.rankGrid.destroy(); } catch (_) {}
    this.rankGrid = agGrid.createGrid(el, {
      columnDefs, rowData: this.topCrews,
      defaultColDef: { resizable: true, suppressMovable: true },
      domLayout: 'autoHeight', rowHeight: 44, headerHeight: 42,
      animateRows: true, pagination: true, paginationPageSize: 10, paginationPageSizeSelector: [5, 10, 20],
      suppressCellFocus: true, enableCellTextSelection: true,
    });
  }

  // ── AG Grid: Bottom / Critical Crews ──────────────────────────────────────
  private buildCriticalGrid(): void {
    const el = document.getElementById('phCriticalGrid');
    if (!el || typeof agGrid === 'undefined') return;
    el.className = `${this.gridTheme()} ph-prod__ag-wrap`;

    const riskBadge = (s: string) => {
      // Al Tasnim style guide RAG badges with dot + tint
      const m: any = {
        Critical: '#FCE5E5:#C20000:#FF0000',
        High:     '#FFF1CC:#946A00:#FFC000',
        Medium:   '#E4EEF7:#245F94:#29378d',
      };
      const [bg, fg, dot] = (m[s] ?? m.Medium).split(':');
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:${bg};color:${fg};font-weight:600;font-size:8.5pt"><span style="width:7px;height:7px;border-radius:50%;background:${dot};flex:none"></span>${s}</span>`;
    };
    const columnDefs = [
      { headerName: 'PH Name', field: 'name', minWidth: 130, flex: 1, sortable: true, filter: true },
      { headerName: 'Discipline', field: 'discipline', width: 115, sortable: true, filter: true },
      { headerName: 'Contractor', field: 'contractor', width: 130, sortable: true, filter: true },
      { headerName: 'Current PI', field: 'currentPI', width: 115, sortable: true, cellStyle: { display: 'flex', alignItems: 'center' }, cellRenderer: (p: any) => this.piBadge(p.data.piNum, p.value) },
      { headerName: 'Avg Prod (%)', field: 'avgProd', width: 120, sortable: true, type: 'numericColumn', cellRenderer: (p: any) => `<b>${p.value}%</b>` },
      { headerName: 'Risk Status', field: 'riskStatus', width: 130, sortable: true, filter: true, cellStyle: { display: 'flex', alignItems: 'center' }, cellRenderer: (p: any) => riskBadge(p.value) },
    ];

    try { if (this.critGrid) this.critGrid.destroy(); } catch (_) {}
    this.critGrid = agGrid.createGrid(el, {
      columnDefs, rowData: this.criticalCrews,
      defaultColDef: { resizable: true, suppressMovable: true },
      domLayout: 'autoHeight', rowHeight: 44, headerHeight: 42,
      animateRows: true, pagination: true, paginationPageSize: 10, paginationPageSizeSelector: [5, 10, 20],
      suppressCellFocus: true, enableCellTextSelection: true,
    });
  }

  // ── AG Grid: Full PH Productivity Report (all 25 columns per doc spec) ────
  private buildFullReportGrid(): void {
    const el = document.getElementById('phFullReportGrid');
    if (!el || typeof agGrid === 'undefined') return;
    el.className = `${this.gridTheme()} ph-prod__ag-wrap`;

    const piBadge = (p: any) => {
      const v = p.value;
      if (!v || v === 'NA') return '<span style="color:var(--txt-muted);font-size:8pt">NA</span>';
      const n = parseInt(v.replace('P', ''), 10);
      return this.piBadge(isNaN(n) ? -1 : n, v);
    };
    const piStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center' };

    // Multi-line field renderer: shows first value + count badge, full text in tooltip
    const multiLine = (p: any) => {
      const v = p.value;
      if (!v || v === 'NA') return 'NA';
      const parts = v.split('\n').filter((s: string) => s.trim());
      if (parts.length <= 1) return v;
      return `<span title="${v.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}">${parts[0]} <span style="background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:0 4px;font-size:7.5pt;color:var(--txt-muted)">+${parts.length - 1}</span></span>`;
    };

    const columnDefs: any[] = [
      { headerName: '#',   field: 'sNo',   width: 62, maxWidth: 65, pinned: 'left', sortable: false, filter: false,
        cellStyle: { fontWeight: '600', textAlign: 'center' } },
      { headerName: 'Type', field: '_typeLabel', width: 95, pinned: 'left',
        cellRenderer: (p: any) => {
          if (!p.value) return '';
          return p.value === 'ATNM'
            ? `<span style="background:#D6E4F0;color:#1F3864;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">ATNM</span>`
            : `<span style="background:#EEF3F9;color:#475569;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">SC</span>`;
        }},
      { headerName: 'PH Emp ID', field: 'phEmpId', width: 105, pinned: 'left',
        cellStyle: { fontWeight: '700', color: '#1F3864', display: 'flex', alignItems: 'center' } },
      { headerName: 'PH Name',   field: 'phName',  minWidth: 160, flex: 1,
        cellRenderer: (p: any) => {
          if (p.data?._type === 'type-subtotal') return `<span style="font-weight:800;color:#1e3a8a">${p.value || ''}</span>`;
          if (p.node?.rowPinned) return `<span style="font-weight:800">${p.value || ''}</span>`;
          return p.value || '';
        }},
      { headerName: 'PA Name', field: 'paName', minWidth: 130, flex: 1,
        cellRenderer: multiLine, tooltipField: 'paName' },
      { headerName: 'ATNM/Sub Contractor', field: 'atnmSubContractor', width: 130,
        headerTooltip: 'ATNM / Sub Contractor' },
      { headerName: 'Category', field: 'category', minWidth: 120, flex: 1,
        cellRenderer: multiLine, tooltipField: 'category' },
      { headerName: 'Crew Discipline', field: 'crewDiscipline', width: 130,
        cellRenderer: multiLine, tooltipField: 'crewDiscipline' },
      { headerName: 'Crew Name', field: 'crewName', minWidth: 140, flex: 1,
        cellRenderer: multiLine, tooltipField: 'crewName' },
      { headerName: 'Avg Prod (%)', field: 'averageProductivity', width: 105, type: 'numericColumn',
        cellRenderer: (p: any) => {
          if (p.value == null) return 'NA';
          const v = p.value.toFixed(2);
          return `<b>${v}%</b>`;
        },
        cellStyle: (p: any) => ({ fontWeight: '700', justifyContent: 'center',
          ...(p.data?._type === 'type-subtotal' ? { background: '#93c5fd', color: '#1e3a8a' } : {}) }) },
      // Week 1
      { headerName: 'Week 1 (1st-7th)', children: [
        { headerName: 'CMR',   field: 'w1PiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'w1PiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
      // Week 2
      { headerName: 'Week 2 (8th-14th)', children: [
        { headerName: 'CMR',   field: 'w2PiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'w2PiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
      // Week 3
      { headerName: 'Week 3 (15th-21st)', children: [
        { headerName: 'CMR',   field: 'w3PiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'w3PiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
      // Week 4
      { headerName: 'Week 4 (22nd-28th)', children: [
        { headerName: 'CMR',   field: 'w4PiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'w4PiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
      // Week 5
      { headerName: 'Week 5 (29th-End)', children: [
        { headerName: 'CMR',   field: 'w5PiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'w5PiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
      // Month Score
      { headerName: 'Month Score', children: [
        { headerName: 'CMR',   field: 'monthPiCmr',   width: 70, cellRenderer: piBadge, cellStyle: piStyle },
        { headerName: 'T-Wise', field: 'monthPiTWise', width: 70, cellRenderer: piBadge, cellStyle: piStyle },
      ]},
    ];

    // ── Build grouped flat rows matching Daily Plan design ──
    const rows = this.filteredRows;
    const types = [
      { label: 'ATNM',            filter: (r: PhProdRow) => this.norm(r.atnmSubContractor) === 'atnm' },
      { label: 'Sub Contractors', filter: (r: PhProdRow) => this.norm(r.atnmSubContractor) !== 'atnm' },
    ];
    const allDiscs = [...new Set(rows.map(r => (r.crewDiscipline || 'NA').split('\n')[0].trim()).filter(Boolean))].sort();

    const flatRows: any[] = [];
    let sl = 0;
    const grand = { count: 0, avgProdSum: 0, avgProdCount: 0 };

    for (const t of types) {
      const typeRows = rows.filter(t.filter);
      const typeAvgProd = typeRows.filter(r => r.averageProductivity != null && r.averageProductivity! <= 500 && r.averageProductivity! >= 0);
      const typeAvg = typeAvgProd.length
        ? Math.round(typeAvgProd.reduce((s, r) => s + r.averageProductivity!, 0) / typeAvgProd.length * 100) / 100
        : 0;

      // Type-level full-width banner
      flatRows.push({ _type: 'type-group', _typeLabel: t.label, _typePh: typeRows.length, _typeAvg: typeAvg });

      for (const disc of allDiscs) {
        const gr = typeRows.filter(r => (r.crewDiscipline || 'NA').split('\n')[0].trim() === disc);
        if (!gr.length) continue;
        const grAvg = gr.filter(r => r.averageProductivity != null && r.averageProductivity! <= 500 && r.averageProductivity! >= 0);
        const avg = grAvg.length
          ? Math.round(grAvg.reduce((s, r) => s + r.averageProductivity!, 0) / grAvg.length * 100) / 100
          : 0;

        // Discipline sub-group full-width banner
        flatRows.push({ _type: 'group', _groupLabel: disc, _groupCount: gr.length, _groupAvg: avg });

        for (const r of gr) {
          flatRows.push({
            ...r,
            sNo: ++sl,
            _typeLabel: t.label === 'ATNM' ? 'ATNM' : 'SC',
            paName: (r.paName || 'NA').replace(/\\n/g, '\n'),
            category: (r.category || 'NA').replace(/\\n/g, '\n'),
            crewType: (r.crewType || 'NA').replace(/\\n/g, '\n'),
            crewDiscipline: (r.crewDiscipline || 'NA').replace(/\\n/g, '\n'),
            crewName: (r.crewName || 'NA').replace(/\\n/g, '\n'),
          });
        }
      }

      // Type-level subtotal row
      flatRows.push({
        _type: 'type-subtotal',
        phName: `${t.label} TOTAL (PH Count: ${typeRows.length})`,
        averageProductivity: typeAvg,
      });

      grand.count += typeRows.length;
      grand.avgProdSum += typeAvgProd.reduce((s, r) => s + r.averageProductivity!, 0);
      grand.avgProdCount += typeAvgProd.length;
    }

    const grandAvg = grand.avgProdCount
      ? Math.round(grand.avgProdSum / grand.avgProdCount * 100) / 100
      : 0;
    const grandTotal = {
      sNo: '', _typeLabel: '', phEmpId: '', phName: `GRAND TOTAL (PH Count: ${grand.count})`,
      paName: '', atnmSubContractor: `${rows.length} row(s)`, category: '', crewDiscipline: '', crewName: '',
      averageProductivity: grandAvg,
      w1PiCmr: '', w1PiTWise: '', w2PiCmr: '', w2PiTWise: '',
      w3PiCmr: '', w3PiTWise: '', w4PiCmr: '', w4PiTWise: '',
      w5PiCmr: '', w5PiTWise: '', monthPiCmr: '', monthPiTWise: ''
    };

    try { if (this.fullGrid) this.fullGrid.destroy(); } catch (_) {}
    this.fullGrid = agGrid.createGrid(el, {
      columnDefs,
      rowData: flatRows,
      pinnedBottomRowData: [grandTotal],
      defaultColDef: { resizable: true, suppressMovable: true, sortable: true, cellStyle: { display: 'flex', alignItems: 'center', fontSize: '14px' } },
      domLayout: 'normal',
      rowHeight: 42, headerHeight: 36, groupHeaderHeight: 30,
      animateRows: false,
      pagination: true, paginationPageSize: 50, paginationPageSizeSelector: [25, 50, 100, 200],
      suppressCellFocus: true,
      enableCellTextSelection: true,
      tooltipShowDelay: 300,
      enableBrowserTooltips: true,
      getRowHeight: (p: any) => (p.data?._type === 'type-group' ? 40 : p.data?._type === 'group' ? 32 : 42),
      isFullWidthRow: (p: any) => p.rowNode?.data?._type === 'type-group' || p.rowNode?.data?._type === 'group',
      fullWidthCellRenderer: (p: any) => {
        const div = document.createElement('div');
        if (p.data?._type === 'type-group') {
          div.style.cssText = 'background:#1F3864;color:#fff;font-weight:900;font-size:14px;padding:0 14px;display:flex;align-items:center;height:100%;letter-spacing:.6px;gap:8px;border-bottom:2px solid #3b5fa0';
          div.innerHTML = `<span style="font-size:18px;line-height:1">&#9658;</span>${(p.data._typeLabel || '').toUpperCase()}&ensp;<span style="font-weight:400;font-size:11px;opacity:.75">${p.data._typePh || 0} PH(s) &nbsp;|&nbsp; Avg Prod: ${p.data._typeAvg || 0}%</span>`;
        } else {
          const disc = (p.data?._groupLabel || '').toUpperCase();
          const cnt = p.data?._groupCount || 0;
          const avg = p.data?._groupAvg || 0;
          div.style.cssText = 'background:#2E5096;color:#fff;font-weight:800;font-size:12px;padding:0 14px 0 28px;display:flex;align-items:center;height:100%;letter-spacing:.4px;gap:8px';
          div.innerHTML = `<span style="font-size:13px;line-height:1">&#9658;</span>${disc}<span style="font-weight:400;font-size:11px;opacity:.65">&mdash; ${cnt} PH(s) &nbsp;|&nbsp; Avg Prod: ${avg}%</span>`;
        }
        return div;
      },
      rowClassRules: {
        'jp-subtotal-row': (p: any) => p.data?._type === 'type-subtotal',
      },
    });
  }

  // ── Excel Export ──────────────────────────────────────────────────────────
  exportExcel(): void {
    this.exportRowsToExcel(
      this.filteredRows,
      this.phReportColumns,
      `PH_Productivity_Report_${this.fileDate()}.xlsx`,
      'PH Productivity'
    );
  }
}

import { Component, HostListener } from '@angular/core';
import type Highcharts from 'highcharts';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';

import { ShaBadgeRendererComponent } from './cell-renderers/sha-badge-renderer.component';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

export interface ShaKpi {
  icon: 'completeness' | 'healed' | 'review' | 'errors' | 'date' | 'confidence';
  accent: 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'purple';
  label: string;
  value: number;
  description: string;
}

export interface ReviewItem {
  id: string;
  wellName: string;
  badge: string;
  badgeAccent: 'orange' | 'red';
  detail: string;
  method: string;
  confidence: number;
}

export interface AuditRow {
  well: string;
  field: string;
  errorType: string;
  detected: string;
  currentValue: string;
  suggestedRepair: string;
  confidence: string;
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

@Component({
  selector: 'app-self-healing-ai',
  standalone: false,
  templateUrl: './self-healing-ai.component.html',
  styleUrls: ['./self-healing-ai.component.scss'],
})
export class SelfHealingAiComponent {

  // ─── Header controls ────────────────────────────────────────────────────
  selectedTimeType = 'All Time Types';
  readonly timeTypeOptions = ['All Time Types', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days'];
  showTimeTypeMenu = false;

  // ─── Summary KPIs ────────────────────────────────────────────────────────
  readonly kpis: ShaKpi[] = [
    { icon: 'completeness', accent: 'blue',   label: 'Avg Completeness', value: 0, description: 'Multi-checked fields' },
    { icon: 'healed',       accent: 'green',  label: 'Auto-Healed',      value: 0, description: 'Safe auto-repairs'  },
    { icon: 'review',       accent: 'yellow', label: 'Pending Review',   value: 0, description: 'Human review needed' },
    { icon: 'errors',       accent: 'red',    label: 'Open Errors',      value: 0, description: 'Not resolved'       },
    { icon: 'date',         accent: 'purple', label: 'Date Seq. Errors', value: 0, description: 'End-to-start'       },
    { icon: 'confidence',   accent: 'orange', label: 'Avg Confidence',   value: 0, description: 'Input confidence'   },
  ];

  // ─── Auto-Heal Queue stats ───────────────────────────────────────────────
  readonly healStats = [
    { label: 'Applied today', value: 18 },
    { label: 'Last 7 day',    value: 18 },
    { label: 'All time',      value: 18 },
  ];

  // ─── Human Review Queue ──────────────────────────────────────────────────
  readonly reviewItems: ReviewItem[] = [
    { id: 'TUQAA_PH1_OP_LOC12', wellName: 'TUQAA_PH1_OP_LOC12', badge: 'Missing Value', badgeAccent: 'orange',
      detail: 'FLAF No. · Pending PO', method: 'AI → PO not yet placed — flag to procurement team',
      confidence: 45.0 },
    { id: 'TUQAA_PH1_OP_LOC12_2', wellName: 'TUQAA_PH1_OP_LOC12', badge: 'Missing Value', badgeAccent: 'orange',
      detail: 'FLAF No. · Pending PO', method: 'AI → PO not yet placed — flag to procurement team',
      confidence: 45.0 },
  ];

  // ─── Audit trail filters ─────────────────────────────────────────────────
  auditSearch = '';
  auditErrorType = '';
  auditStatus = '';
  auditDateRange = '';
  readonly errorTypeOptions = ['Missing Value', 'Inconsistent', 'Out-of-Range', 'Date Sequence', 'Anomalous'];
  readonly statusOptions    = ['All', 'Auto-Healed', 'Pending Review', 'Open'];

  // ─── Audit trail AG Grid ─────────────────────────────────────────────────
  readonly gridTheme = SHA_GRID_THEME;

  readonly auditColumns: ColDef<AuditRow>[] = [
    { headerName: 'Well',             field: 'well',            minWidth: 160, flex: 2 },
    { headerName: 'Field',            field: 'field',           minWidth: 140, flex: 2 },
    { headerName: 'Error Type',       field: 'errorType',       minWidth: 140, flex: 1.5,
      cellRenderer: ShaBadgeRendererComponent },
    { headerName: 'Detected',         field: 'detected',        minWidth: 110, flex: 1 },
    { headerName: 'Current Value',    field: 'currentValue',    minWidth: 120, flex: 1 },
    { headerName: 'Suggested Repair', field: 'suggestedRepair', minWidth: 150, flex: 1.5,
      cellRenderer: ShaBadgeRendererComponent },
    { headerName: 'Confidence',       field: 'confidence',      minWidth: 110, flex: 1 },
  ];

  readonly defaultColDef: ColDef<AuditRow> = { sortable: true, resizable: true, flex: 1 };

  readonly auditRows: AuditRow[] = [
    { well: 'TUQAA_PH1_OP_LOC12', field: 'Material PO No.', errorType: 'Missing Value', detected: 'Feb 2026', currentValue: '-', suggestedRepair: 'Pending PO', confidence: '41%' },
    { well: 'TUQAA_PH1_OP_LOC12', field: 'Material PO No.', errorType: 'Missing Value', detected: 'Feb 2026', currentValue: '-', suggestedRepair: 'Pending PO', confidence: '41%' },
    { well: 'TUQAA_PH1_OP_LOC12', field: 'Material PO No.', errorType: 'Missing Value', detected: 'Feb 2026', currentValue: '-', suggestedRepair: 'Pending PO', confidence: '41%' },
    { well: 'TUQAA_PH1_OP_LOC12', field: 'Material PO No.', errorType: 'Missing Value', detected: 'Feb 2026', currentValue: '-', suggestedRepair: 'Pending PO', confidence: '41%' },
    { well: 'TUQAA_PH1_OP_LOC12', field: 'Material PO No.', errorType: 'Missing Value', detected: 'Feb 2026', currentValue: '-', suggestedRepair: 'Pending PO', confidence: '41%' },
  ];

  // Pagination
  totalCount = 8618;
  pageSize   = 20;
  currentPage = 1;
  readonly totalPages = 431;
  get rangeStart(): number { return (this.currentPage - 1) * this.pageSize + 1; }
  get rangeEnd():   number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }
  goToFirstPage(): void { this.currentPage = 1; }
  goToPrevPage():  void { this.currentPage = Math.max(1, this.currentPage - 1); }
  goToNextPage():  void { this.currentPage = Math.min(this.totalPages, this.currentPage + 1); }
  goToLastPage():  void { this.currentPage = this.totalPages; }

  // ─── Highcharts ──────────────────────────────────────────────────────────

  /** Completeness Score by Field — grouped horizontal bar */
  readonly completenessOptions: Highcharts.Options = {
    chart: { type: 'bar', backgroundColor: 'transparent', height: 300 },
    title: { text: undefined }, credits: { enabled: false },
    legend: {
      enabled: true, align: 'center', verticalAlign: 'bottom',
      symbolRadius: 5, symbolWidth: 10, symbolHeight: 10, squareSymbol: true,
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#667085' },
    },
    xAxis: {
      categories: ['Well Name', 'Rig Unit', 'Engineering%', 'DRL Progress %', 'Exp Rig on Date', 'SMPC ID', 'Fi mat/line PO No.'],
      lineColor: '#E7ECF3', tickColor: 'transparent',
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    yAxis: {
      title: { text: undefined }, gridLineColor: '#F1F3F6',
      min: 0, max: 100, tickInterval: 10,
      opposite: true,
      labels: { format: '{value}%', style: { fontSize: '11px', color: '#667085' } },
    },
    tooltip: { shared: true, valueSuffix: '%' },
    plotOptions: { bar: { borderWidth: 0, borderRadius: 2, groupPadding: 0.08, pointPadding: 0.04 } },
    series: [
      { type: 'bar', name: 'No. of Issues',        color: '#EF5350', data: [40, 62, 48, 52, 22, 50, 28] },
      { type: 'bar', name: 'Completeness % : 100', color: '#66BB6A', data: [82, 18, 68, 52, 18, 18, 42] },
    ],
  };

  /** Error Classification Breakdown — donut */
  readonly errorBreakdownOptions: Highcharts.Options = {
    chart: { type: 'pie', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined }, credits: { enabled: false },
    legend: {
      enabled: true, align: 'right', verticalAlign: 'middle', layout: 'vertical',
      useHTML: true,
      itemMarginBottom: 10,
      symbolRadius: 6,
      symbolWidth: 12,
      symbolHeight: 12,
      itemStyle: { fontSize: '13px', fontWeight: '500', color: '#344054', lineHeight: '1.5' },
      labelFormatter(this: Highcharts.Point | Highcharts.Series) {
        const pt = this as Highcharts.Point & { y: number; name: string };
        const val = pt.name === 'Date sequence' ? '2+' : `${pt.y}`;
        return `<span style="display:inline-flex;align-items:center;width:150px;">
          <span style="flex:1;color:#344054;white-space:nowrap;">${pt.name}:</span>
          <b style="color:#101828;min-width:24px;text-align:right;">${val}</b>
        </span>`;
      },
    },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
    plotOptions: {
      pie: { innerSize: '58%', borderWidth: 2, borderColor: '#fff', dataLabels: { enabled: false }, showInLegend: true },
    },
    series: [{
      type: 'pie', name: 'Errors',
      data: [
        { name: 'Missing Value',  y: 8, color: '#5058C9' },
        { name: 'Inconsistent',   y: 8, color: '#42A5F5' },
        { name: 'Out-of- Range',  y: 8, color: '#EF5350' },
        { name: 'Date sequence',  y: 2, color: '#FFA726' },
      ],
    }],
  };

  /** Repair Confidence Distribution — column */
  readonly confidenceOptions: Highcharts.Options = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined }, credits: { enabled: false },
    legend: {
      enabled: true, align: 'center', verticalAlign: 'bottom',
      symbolRadius: 6, symbolWidth: 12, symbolHeight: 12,
      itemStyle: { fontSize: '12px', fontWeight: '500', color: '#667085' },
    },
    xAxis: {
      categories: ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'],
      lineColor: '#E7ECF3', tickColor: 'transparent',
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    yAxis: {
      title: { text: undefined }, gridLineColor: '#F1F3F6',
      min: 0, max: 100, tickInterval: 20,
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    tooltip: { valueSuffix: ' issues' },
    plotOptions: {
      column: {
        borderRadius: 4, borderWidth: 0,
        pointPadding: 0.1, groupPadding: 0.15,
        dataLabels: {
          enabled: true,
          format: '{y}',
          style: { fontSize: '12px', fontWeight: '700', textOutline: 'none', color: '#344054' },
          verticalAlign: 'top',
          y: -20,
        },
      },
    },
    series: [{ type: 'column', name: 'Issue', color: '#5058C9',
      data: [97, 18, 83, 50, 87] }],
  };

  /** Data Quality Score Trend — line + area */
  readonly dqTrendOptions: Highcharts.Options = {
    chart: { type: 'line', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined }, credits: { enabled: false },
    legend: {
      enabled: true, align: 'center', verticalAlign: 'bottom',
      symbolRadius: 5,
      squareSymbol: false,
      itemStyle: { fontSize: '12px', fontWeight: '500', color: '#667085' },
    },
    xAxis: {
      categories: ['W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'],
      lineColor: '#E7ECF3', tickColor: 'transparent',
      labels: { style: { fontSize: '11px', color: '#667085' } },
    },
    yAxis: {
      title: { text: undefined }, gridLineColor: '#F1F3F6',
      min: 50, max: 100, tickInterval: 10,
      labels: { format: '{value}%', style: { fontSize: '11px', color: '#667085' } },
      plotLines: [{
        value: 90,
        color: '#EF5350',
        dashStyle: 'Dash',
        width: 1.5,
        zIndex: 5,
        label: {
          text: 'Target: 90%',
          align: 'right',
          style: { color: '#EF5350', fontSize: '12px', fontWeight: '700' },
          x: 0,
          y: -8,
        },
      }],
    },
    tooltip: { shared: true, valueSuffix: '%' },
    plotOptions: {
      areaspline: { marker: { radius: 4, symbol: 'circle' } },
    },
    series: [
      {
        type: 'areaspline', name: 'DQ Score', color: '#66BB6A', lineWidth: 2,
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(102,187,106,0.30)'],
            [1, 'rgba(102,187,106,0.05)'],
          ],
        },
        data: [73, 88, 92, 70, 65, 90, 82, 78],
        marker: { fillColor: '#fff', lineColor: '#66BB6A', lineWidth: 2, radius: 4 },
      },
      {
        type: 'line', name: 'Target', color: '#EF5350', dashStyle: 'Dash', lineWidth: 1.5,
        data: [90, 90, 90, 90, 90, 90, 90, 90],
        marker: { enabled: false },
        showInLegend: true,
        enableMouseTracking: false,
      },
    ],
  };

  @HostListener('document:click')
  closeMenus(): void { this.showTimeTypeMenu = false; }

  toggleTimeTypeMenu(e: MouseEvent): void {
    e.stopPropagation();
    this.showTimeTypeMenu = !this.showTimeTypeMenu;
  }

  selectTimeType(t: string): void { this.selectedTimeType = t; this.showTimeTypeMenu = false; }

  resetAuditFilters(): void {
    this.auditSearch = '';
    this.auditErrorType = '';
    this.auditStatus = '';
    this.auditDateRange = '';
  }
}


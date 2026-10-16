import {
  AfterViewInit, ChangeDetectorRef, Component, Directive, ElementRef, EventEmitter,
  Input, OnChanges, Output, SimpleChanges, TemplateRef, ViewChild,
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, GetRowIdParams, GridApi, GridOptions, GridReadyEvent, ICellRendererParams,
  ModelUpdatedEvent, RowClassParams, RowGroupOpenedEvent, themeQuartz } from 'ag-grid-community';
import { TreeDataModule } from 'ag-grid-enterprise';
import { ArrowLeft, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet, Gauge, Network, Users, createElement } from 'lucide';
import type { Workbook } from 'exceljs';
import { SharedModule } from '../../../shared/shared.module';
import { Breadcrumb } from '../../../core/models/breadcrumb.model';
import { CrewReportGridRow, CrewUtilizationReport, CrewUtilizationTotals } from '../../../core/models/crew-calendar.model';
import { summarizeCrewUtilizationReport } from './crew-utilization';

const reportIcons = { ArrowLeft, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet, Gauge, Network, Users };

@Directive({ selector: '[appCrewReportIcon]', standalone: true })
export class CrewReportIconDirective implements OnChanges {
  @Input({ required: true }) appCrewReportIcon!: keyof typeof reportIcons;

  constructor(private readonly element: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    this.element.nativeElement.replaceChildren(createElement(reportIcons[this.appCrewReportIcon], {
      width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false',
    }));
  }
}

@Component({
  selector: 'app-crew-utilization-report',
  standalone: true,
  imports: [SharedModule, CrewReportIconDirective, AgGridAngular],
  templateUrl: './crew-utilization-report.component.html',
  styleUrls: ['./crew-utilization-report.component.scss'],
})
export class CrewUtilizationReportComponent implements OnChanges, AfterViewInit {
  @Input({ required: true }) report!: CrewUtilizationReport;
  @Input() plannedReport: CrewUtilizationReport | null = null;
  @Input() actualReport: CrewUtilizationReport | null = null;
  @Input() scopeLabel = '';
  @Input() selectionLabel = '';
  @Input() exportCluster = '';
  @Input() exportView = 'Planned';
  @Input() view: 'planned' | 'actual' = 'actual';
  @Output() viewChanged = new EventEmitter<'planned' | 'actual'>();
  @Input() scopedActivities = false;
  @Input() breadcrumbs: Breadcrumb[] = [];
  @Input() filtersTemplate: TemplateRef<unknown> | null = null;
  @Input() loading = false;
  @Input() loadError: string | null = null;
  showFilters = true;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('reportHeading', { read: ElementRef }) reportHeading?: ElementRef<HTMLElement>;
  readonly partialTotalsNote = 'Partial totals: available days, idle days, utilization and status use only crews with known capacity. Day totals include every crew.';
  expanded = new Set<string>();
  gridApi: GridApi<CrewReportGridRow> | null = null;
  rows: CrewReportGridRow[] = [];
  totals: CrewReportGridRow[] = [];
  autoHeight = false;
  exportableCrewCount = 0;
  readonly gridOptions: GridOptions<CrewReportGridRow> = {
    excludeChildrenWhenTreeDataFiltering: true,
    onGridPreDestroyed: () => {
      this.gridApi = null;
      this.expanded.clear();
    },
  };
  readonly gridModules = [AllCommunityModule, TreeDataModule];
  readonly gridTheme = themeQuartz.withParams({
    fontFamily: 'var(--font-family-base)', fontSize: 13, headerFontSize: 12,
    backgroundColor: '#FFFFFF', foregroundColor: '#101828', headerBackgroundColor: '#F7F9FC',
    headerTextColor: '#101828', borderColor: '#D7DFED', accentColor: '#21409A',
    rowHoverColor: '#EEF4FF', wrapperBorderRadius: 4,
  });
  readonly defaultColDef: ColDef<CrewReportGridRow> = {
    sortable: true, resizable: true, minWidth: 115, wrapHeaderText: true, autoHeaderHeight: true,
    filter: 'agTextColumnFilter', floatingFilter: true,
    tooltip: params => params.data?.unknownCapacity && params.data.availableDays !== null
      ? this.partialTotalsNote : undefined,
  };
  readonly autoGroupColumnDef: ColDef<CrewReportGridRow> = {
    headerName: 'Crew Group', minWidth: 250, flex: 1.4,
    filter: 'agTextColumnFilter', filterValueGetter: params => params.data?.groupCode ?? '',
    cellRendererParams: {
      suppressCount: true,
      innerRenderer: (params: ICellRendererParams<CrewReportGridRow>) => {
        const row = params.data;
        if (!row || row.kind === 'crew') return '';
        const label = document.createElement('span');
        label.textContent = row.kind === 'total' ? 'Grand Total' : row.groupCode;
        if (row.unknownCapacity && row.availableDays !== null) label.textContent += ' - Partial capacity';
        return label;
      },
    },
  };
  columns: ColDef<CrewReportGridRow>[] = [];
  private readonly reportColumns: ColDef<CrewReportGridRow>[] = [
    { field: 'crewId', headerName: 'Actual Crew ID', minWidth: 215, flex: 1.3,
      filterValueGetter: params => params.data?.crewLabel ?? params.data?.crewId ?? '',
      valueFormatter: params => params.data?.crewLabel ?? params.value ?? '' },
    ...(['availableDays', 'plannedDays', 'actualAssignedDays', 'idleDays'] as const).map((field, index) => ({
      field, headerName: ['Available Days', 'Planned Days', 'Actual Assigned Days', 'Idle Days'][index],
      type: 'numericColumn', filter: 'agNumberColumnFilter', flex: 1,
      valueFormatter: (params: { value: number | null | undefined }) => params.value == null ? 'N/A' : params.value.toLocaleString('en-US'),
    })),
    { field: 'utilization', headerName: 'Utilization %', type: 'numericColumn', filter: 'agNumberColumnFilter', flex: 1,
      valueFormatter: params => params.value == null ? 'N/A' : `${Number(params.value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` },
    { field: 'status', headerName: 'Status', minWidth: 165, flex: 1,
      cellClassRules: {
        'cu-status-full': params => params.value === 'Fully utilized',
        'cu-status-partial': params => params.value === 'Partially utilized',
        'cu-status-idle': params => params.value === 'Not utilized' || params.value === 'N/A',
      } },
  ];
  readonly getDataPath = (row: CrewReportGridRow): string[] => row.path;
  readonly getRowId = (params: GetRowIdParams<CrewReportGridRow>): string => params.data.id;
  readonly getRowClass = (params: RowClassParams<CrewReportGridRow>): string =>
    params.data?.kind === 'crew' ? 'cu-report-crew' : 'cu-report-total';
  exporting = false;
  exportError = '';

  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(changes?: SimpleChanges): void {
    if (changes && !changes['report'] && !changes['view']) return;
    this.expanded.clear();
    this.gridApi?.collapseAll();
    this.exportError = '';
    this.columns = this.reportColumns.filter(column => column.field !==
      (this.view === 'planned' ? 'actualAssignedDays' : 'plannedDays')).map(column =>
      column.field === 'crewId' ? { ...column, headerName: this.view === 'planned' ? 'Crew' : 'Actual Crew ID' } : column);
    this.rows = this.report.groups.flatMap(group => [
      { ...group, id: JSON.stringify([group.code]), path: [group.code], kind: 'group' as const,
        groupCode: group.code, crewId: '', crewCount: group.crews.length },
      ...group.crews.map((crew, index) => ({ ...crew, id: JSON.stringify([group.code, crew.crewId]),
        path: [group.code, crew.crewId], kind: 'crew' as const, groupCode: group.code,
        crewLabel: this.view === 'planned' ? `crew-${index + 1}` : crew.crewId })),
    ]);
    this.totals = this.report.groups.length ? [{ ...this.report.totals, id: 'grand-total', path: [],
      kind: 'total', groupCode: 'Grand Total', crewId: '' }] : [];
    this.autoHeight = this.report.groups.length > 0 && this.report.groups.length <= 10;
    this.exportableCrewCount = this.rows.filter(row => row.kind === 'crew').length;
  }

  ngAfterViewInit(): void {
    const heading = this.reportHeading?.nativeElement.querySelector('h1');
    heading?.setAttribute('id', 'crew-utilization-title');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }

  get periodLabel(): string {
    const start = new Date(`${this.report.from}T00:00:00`);
    const end = new Date(`${this.report.to}T00:00:00`);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    if (start.getDate() === 1 && end.getTime() === monthEnd.getTime()) {
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const format: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start.toLocaleDateString('en-US', format)} - ${end.toLocaleDateString('en-US', format)}`;
  }

  get allExpanded(): boolean {
    return this.report.groups.length > 0 && this.report.groups.every(group =>
      this.gridApi ? this.gridApi.getRowNode(JSON.stringify([group.code]))?.expanded : this.expanded.has(group.code));
  }

  get hasExpanded(): boolean {
    return this.report.groups.some(group =>
      this.gridApi ? this.gridApi.getRowNode(JSON.stringify([group.code]))?.expanded : this.expanded.has(group.code));
  }

  onGridReady(event: GridReadyEvent<CrewReportGridRow>): void {
    this.gridApi = event.api;
  }

  onModelUpdated(event: ModelUpdatedEvent<CrewReportGridRow>): void {
    this.exportableCrewCount = 0;
    event.api.forEachNodeAfterFilter(node => {
      if (node.data?.kind === 'crew') this.exportableCrewCount++;
    });
    const rowCount = event.api.getDisplayedRowCount();
    const autoHeight = rowCount > 0 && rowCount <= 10;
    this.autoHeight = autoHeight;
    this.cdr.markForCheck();
  }

  onRowGroupOpened(event: RowGroupOpenedEvent<CrewReportGridRow>): void {
    this.expanded.clear();
    event.api.forEachNode(node => {
      if (node.group && node.expanded && node.data) this.expanded.add(node.data.groupCode);
    });
    this.cdr.markForCheck();
  }

  expandAll(): void {
    this.gridApi?.expandAll();
    this.expanded = new Set(this.report.groups.map(group => group.code));
  }

  collapseAll(): void {
    this.gridApi?.collapseAll();
    this.expanded.clear();
  }

  get hasExportableCrews(): boolean {
    return this.gridApi ? this.exportableCrewCount > 0 : this.report.groups.some(group => group.crews.length > 0);
  }

  private exportRows(): CrewReportGridRow[] {
    if (!this.gridApi) {
      return this.report.groups.flatMap(group => group.crews.map((crew, index) => ({
        ...crew, id: JSON.stringify([group.code, crew.crewId]), path: [group.code, crew.crewId],
        kind: 'crew' as const, groupCode: group.code,
        crewLabel: this.view === 'planned' ? `crew-${index + 1}` : crew.crewId,
      })));
    }
    const rows: CrewReportGridRow[] = [];
    this.gridApi.forEachNodeAfterFilterAndSort(node => {
      if (node.data?.kind === 'crew') rows.push({ ...node.data });
    });
    return rows;
  }

  async createWorkbook(): Promise<Workbook> {
    const selectedRows = this.exportRows();
    if (!selectedRows.length) throw new Error('No crews match the grid filters.');
    const sheets = (['planned', 'actual'] as const).map(view => {
      const source = (view === 'planned' ? this.plannedReport : this.actualReport) ?? this.report;
      return { view, ...this.exportSheetData(source, selectedRows, view) };
    });
    const context = `${this.periodLabel} | ${this.scopeLabel}`;
    const { default: ExcelJS } = await import('exceljs/dist/exceljs.js');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'T-Wise Insights';
    for (const sheet of sheets) {
      this.addReportWorksheet(workbook, sheet.report, sheet.labels, sheet.view, context);
    }
    return workbook;
  }

  private exportSheetData(source: CrewUtilizationReport, selectedRows: CrewReportGridRow[], view: 'planned' | 'actual') {
    const key = (group: string, crew: string) => JSON.stringify([group.trim().toLowerCase(), crew.trim().toLowerCase()]);
    const sourceRows = new Map(source.groups.flatMap(group => group.crews.map((crew, index) => [
      key(group.code, crew.crewId), { crew, label: view === 'planned' ? `crew-${index + 1}` : crew.crewId },
    ] as const)));
    const names = new Map(source.groups.map(group => [group.code, group.name]));
    const selectedGroups = new Map<string, { code: string; name: string | null; crews: CrewReportGridRow[] }>();
    const labels = new Map<string, string>();
    for (const row of selectedRows) {
      const matching = sourceRows.get(key(row.groupCode, row.crewId));
      if (!matching) throw new Error(`Crew data is missing from the ${view} report.`);
      let group = selectedGroups.get(row.groupCode);
      if (!group) {
        group = { code: row.groupCode, name: names.get(row.groupCode) ?? null, crews: [] };
        selectedGroups.set(row.groupCode, group);
      }
      group.crews.push({ ...row, ...matching.crew });
      labels.set(JSON.stringify([row.groupCode, matching.crew.crewId]), matching.label);
    }
    return { report: summarizeCrewUtilizationReport([...selectedGroups.values()], source.from, source.to, view), labels };
  }

  private addReportWorksheet(workbook: Workbook, report: CrewUtilizationReport, labels: Map<string, string>,
    view: 'planned' | 'actual', context: string): void {
    const planned = view === 'planned';
    const name = planned ? 'Planned' : 'Actual';
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 7, showGridLines: false }],
    });
    sheet.columns = [24, 34, 22, 22, 18, 18, 21].map((width, index) => ({
      width,
      style: {
        font: { name: 'Calibri', size: 11 },
        alignment: { horizontal: index >= 2 && index <= 5 ? 'right' as const : 'left' as const,
          vertical: 'middle' as const, wrapText: index < 2 || index === 6 },
        numFmt: index >= 2 && index <= 4 ? '#,##0' : 'General',
      },
    }));
    sheet.mergeCells('A1:G1');
    sheet.getCell('A1').value = `Crew Utilization Report - ${name}`;
    sheet.getCell('A1').font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF21409A' } };
    sheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getRow(1).height = 30;
    sheet.mergeCells('A2:G2');
    sheet.getCell('A2').value = `${context} | ${name}`;
    sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    sheet.getRow(2).height = 32;
    sheet.getRow(4).values = ['Crew Groups', planned ? 'Crews' : 'Actual Crews',
      planned ? 'Avg. Planned Utilization' : 'Avg. Actual Utilization'];
    const summary = report.summary;
    const average = planned ? summary.averagePlannedUtilization : summary.averageUtilization;
    sheet.getRow(5).values = [summary.crewGroups, summary.actualCrews,
      average === null ? 'N/A' : average / 100];
    sheet.getCell('C5').numFmt = '0.0%';
    sheet.getRow(5).height = 28;
    sheet.getRow(5).eachCell(cell => {
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF21409A' } };
    });
    sheet.getRow(7).values = ['Crew Group', planned ? 'Crew' : 'Actual Crew ID', 'Available Days',
      planned ? 'Planned Days' : 'Actual Assigned Days', 'Idle Days', 'Utilization %', 'Status'];
    for (const rowNumber of [4, 7]) {
      sheet.getRow(rowNumber).height = 36;
      sheet.getRow(rowNumber).eachCell((cell, column) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0FA' } };
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF21409A' } };
        cell.alignment = { horizontal: rowNumber === 7 && column >= 3 && column <= 6 ? 'right' : 'left',
          vertical: 'middle', wrapText: true };
      });
    }
    const valuesFor = (totals: CrewUtilizationTotals) => [totals.availableDays ?? 'N/A',
      planned ? totals.plannedDays : totals.actualAssignedDays, totals.idleDays ?? 'N/A',
      totals.utilization === null ? 'N/A' : totals.utilization / 100, totals.status];
    for (const group of report.groups) {
      for (const crew of group.crews) {
        const row = sheet.addRow([group.code, labels.get(JSON.stringify([group.code, crew.crewId]))!, ...valuesFor(crew)]);
        row.height = 30;
        row.outlineLevel = 1;
        row.getCell(6).numFmt = '0.0%';
      }
      const partialLabel = group.unknownCapacity && group.availableDays !== null ? ' (partial capacity)' : '';
      const subtotal = sheet.addRow([`${group.code} - Group Subtotal${partialLabel}`, '', ...valuesFor(group)]);
      sheet.mergeCells(subtotal.number, 1, subtotal.number, 2);
      subtotal.height = 30;
      subtotal.font = { name: 'Calibri', size: 11, bold: true };
      subtotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FA' } };
      subtotal.getCell(6).numFmt = '0.0%';
      if (partialLabel) subtotal.getCell(6).note = this.partialTotalsNote;
    }
    const partialLabel = report.totals.unknownCapacity && report.totals.availableDays !== null ? ' (partial capacity)' : '';
    const total = sheet.addRow([`GRAND TOTAL - All Selected Crew Groups${partialLabel}`, '', ...valuesFor(report.totals)]);
    sheet.mergeCells(total.number, 1, total.number, 2);
    total.height = 36;
    total.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF21409A' } };
    total.getCell(6).numFmt = '0.0%';
    if (partialLabel) total.getCell(6).note = this.partialTotalsNote;
    const statusColors: Record<string, { background: string; foreground: string }> = {
      'Fully utilized': { background: 'FFDCEEDC', foreground: 'FF1E7B34' },
      'Partially utilized': { background: 'FFFCEACB', foreground: 'FF97650F' },
      'Not utilized': { background: 'FFF0F4FA', foreground: 'FF667085' },
    };
    for (let rowNumber = 7; rowNumber <= total.number; rowNumber++) {
      sheet.getCell(`F${rowNumber}`).border = { right: { style: 'thin', color: { argb: 'FFD7DFED' } } };
      const statusCell = sheet.getCell(`G${rowNumber}`);
      statusCell.alignment = { ...statusCell.alignment, indent: 1 };
      const colors = statusColors[statusCell.text];
      if (!colors) continue;
      for (const column of ['F', 'G']) {
        const cell = sheet.getCell(`${column}${rowNumber}`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: colors.foreground } };
      }
    }
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:7' };
  }

  private exportFileName(exportedAt: Date): string {
    const safePart = (value: string, fallback: string) =>
      value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
    const cluster = safePart(this.exportCluster, 'All-clusters');
    const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
    return `Crew_Utilization_${cluster}_Planned-Actual_${this.report.from}_${this.report.to}_${timestamp}.xlsx`;
  }

  async exportExcel(): Promise<void> {
    if (this.exporting || this.loading || this.loadError || !this.hasExportableCrews) return;
    const filename = this.exportFileName(new Date());
    this.exporting = true;
    this.exportError = '';
    try {
      const workbook = await this.createWorkbook();
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      this.exportError = 'The report could not be exported. Please try again.';
    } finally {
      this.exporting = false;
      this.cdr.markForCheck();
    }
  }
}
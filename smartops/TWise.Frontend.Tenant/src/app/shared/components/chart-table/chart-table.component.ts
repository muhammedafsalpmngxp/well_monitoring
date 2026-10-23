import { Component, Input, OnChanges, signal } from '@angular/core';
import {
  CellClassParams, CellDoubleClickedEvent, ColDef, Column, DefaultMenuItem, GetContextMenuItemsParams, GridApi,
  GridReadyEvent, IRowNode, MenuItemDef, RowClassParams, themeQuartz,
} from 'ag-grid-community';
import { DateUtil } from '../../../core/utils/date.util';
import {
  TableColumnStat, TableGridOptions, applyTableGridColumnOptions, buildDrillColumns, cloneTableGridOptions,
  computeTableColumnStats, defaultTableGridOptions, drillLeafData, hasTableGridOptions, isTableCfRuleComplete,
} from '../../../core/utils/table-grid-features.util';
import { REPORT_AGG_FUNCS, evaluateConditionalRules } from '../../../features/reports/shared/report-grid-columns.util';

interface ChartTableRow { values: readonly unknown[]; index: number; source?: Record<string, unknown> }

@Component({
  selector: 'app-chart-table',
  standalone: false,
  template: `
    <div class="ct-toolbar" *ngIf="grid.groupBy.length">
      <button type="button" class="ct-toolbar__btn" (click)="gridApi?.expandAll()">Expand all</button>
      <button type="button" class="ct-toolbar__btn" (click)="gridApi?.collapseAll()">Collapse all</button>
    </div>
    <ag-grid-angular [columnDefs]="columnDefs" [rowData]="displayRows" [defaultColDef]="activeDefaultColDef"
      [theme]="theme" [getRowStyle]="rowStyle" [animateRows]="true"
      [domLayout]="autoHeight ? 'autoHeight' : 'normal'"
      [style.height]="autoHeight ? null : height"
      [groupDisplayType]="'multipleColumns'" [suppressGroupChangesColumnVisibility]="true"
      [autoGroupColumnDef]="autoGroupColumnDef" [groupDefaultExpanded]="grid.groupExpanded ? -1 : 0"
      [groupTotalRow]="grid.groupSubtotals ? 'bottom' : undefined"
      [grandTotalRow]="grid.grandTotal ? 'bottom' : undefined" [aggFuncs]="aggFuncs"
      [suppressAggFuncInHeader]="true" [pinnedBottomRowData]="pinnedSummaryRows"
      [getContextMenuItems]="contextMenuItems"
      (gridReady)="onGridReady($event)" (cellDoubleClicked)="onCellDoubleClicked($event)"
      (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()">
    </ag-grid-angular>
    <div class="ct-drill-backdrop" *ngIf="drill() as d" (click)="closeDrill()">
      <div appDialog (dialogClose)="closeDrill()" class="ct-drill" role="dialog" aria-modal="true"
        aria-labelledby="ct-drill-title" (click)="$event.stopPropagation()">
        <div class="ct-drill__header">
          <div>
            <h3 id="ct-drill-title" class="ct-drill__title">Drill to detail</h3>
            <p class="ct-drill__subtitle">{{ d.subtitle }}</p>
          </div>
          <button type="button" class="ct-drill__close" aria-label="Close" (click)="closeDrill()">&times;</button>
        </div>
        <ag-grid-angular class="ct-drill__grid" [theme]="theme" [columnDefs]="d.columns"
          [defaultColDef]="drillColDef" [rowData]="d.rows"></ag-grid-angular>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    /* flex/min-height are inert unless an ancestor makes :host a flex container (e.g. the
       expanded/fullscreen widget view) - in that case this lets the grid stretch to fill it
       instead of staying pinned to the fixed [height] input, so it fills the card with no
       top/bottom gap and no longer shrinks relative to the container at different app zoom levels. */
    ag-grid-angular { display: block; width: 100%; min-width: 0; text-transform: none; flex: 1; min-height: 0; }
    .ct-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
    .ct-toolbar__btn {
      height: 30px; padding: 0 12px; background: #fff; border: 1px solid #D0D5DD; border-radius: 10px;
      font-size: 13px; font-weight: 500; font-family: inherit; color: #101828; cursor: pointer;
    }
    .ct-toolbar__btn:hover { border-color: #21409A; }
    .ct-drill-backdrop {
      position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, 0.45);
    }
    .ct-drill {
      display: flex; flex-direction: column; width: 90vw; max-width: 1100px; height: 70vh; padding: 20px;
      background: #fff; border-radius: 12px; box-shadow: 0 12px 32px rgba(16, 24, 40, 0.18); text-align: left;
    }
    .ct-drill__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .ct-drill__title { margin: 0; font-size: 16px; font-weight: 700; color: #101828; }
    .ct-drill__subtitle { margin: 4px 0 0; font-size: 13px; color: #475467; }
    .ct-drill__close {
      width: 32px; height: 32px; border: none; border-radius: 8px; background: transparent;
      font-size: 22px; line-height: 1; color: #667085; cursor: pointer;
    }
    .ct-drill__close:hover { background: #F3F4F6; }
    .ct-drill ag-grid-angular.ct-drill__grid { flex: 1 1 auto; min-height: 0; width: 100%; }
  `],
})
export class ChartTableComponent implements OnChanges {
  @Input() headers: string[] = [];
  @Input() rows: (readonly unknown[] | { category: string; values: unknown[] })[] = [];
  @Input() headerColor: string | null = null;
  @Input() headerTextColor: string | null = null;
  @Input() rowColors: string[] = [];
  @Input() rowTextColors: string[] = [];
  @Input() height = '420px';
  /** Grows the grid to fit all rows instead of scrolling within a fixed height. */
  @Input() autoHeight = false;
  @Input() designJson?: string;
  /** Pin / group / total / data bar / conditional format / wrap options saved with the chart. */
  @Input() tableGrid?: Partial<TableGridOptions> | null;
  /** Source record behind each row (same order as `rows`), shown by "Drill to detail". */
  @Input() records: (Record<string, unknown> | null | undefined)[] = [];

  private savedStyle: {
    tableHeaderColor?: string; tableHeaderTextColor?: string;
    tableRowColors?: string[]; tableRowTextColors?: string[];
    tableGrid?: Partial<TableGridOptions>;
  } = {};
  private parsedDesignJson?: string;

  readonly theme = themeQuartz.withParams({
    accentColor: '#21409A', headerBackgroundColor: '#2948A3', headerTextColor: '#FFFFFF',
    // AG Grid's active-filter header icon defaults to accentColor on an accent-tinted
    // background — both close in tone to this dark-blue custom header, so the icon all but
    // disappears once a column filter is applied. Force a light, high-contrast active state.
    iconButtonActiveColor: '#FFFFFF', iconButtonActiveBackgroundColor: 'rgba(255, 255, 255, 0.25)',
    iconButtonActiveIndicatorColor: '#FFFFFF',
    headerFontWeight: 600, rowHoverColor: '#F5F8FF',
  });
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: true, flex: 1, minWidth: 110 };
  private readonly wrapColDef: ColDef = { ...this.defaultColDef, wrapText: true, autoHeight: true };
  readonly drillColDef: ColDef = { sortable: true, resizable: true, filter: true, minWidth: 140 };
  readonly aggFuncs = REPORT_AGG_FUNCS;
  private readonly palette = ['#EFF6FF', '#FFF7ED', '#F0FDF4', '#FEFCE8', '#FEF2F2', '#F5F3FF', '#F8FAFC', '#F0FDFA', '#FDF2F8', '#EEF2FF'];
  private columnsKey = '';
  private rowsKey = '';
  private recordCount = 0;
  private stats: TableColumnStat[] = [];
  private activeCfRules: TableGridOptions['conditionalRules'] = [];
  private rowRecords = new WeakMap<object, Record<string, unknown>>();
  columnDefs: ColDef[] = [];
  gridRows: ChartTableRow[] = [];
  /** While grouping, trailing summary rows leave the groups and stay pinned at the bottom. */
  displayRows: ChartTableRow[] = [];
  pinnedSummaryRows: ChartTableRow[] = [];
  grid: TableGridOptions = defaultTableGridOptions();
  autoGroupColumnDef: ColDef = {};
  gridApi: GridApi | null = null;
  readonly drill = signal<{ subtitle: string; columns: ColDef[]; rows: Record<string, unknown>[] } | null>(null);

  get activeDefaultColDef(): ColDef {
    return this.grid.wrapText ? this.wrapColDef : this.defaultColDef;
  }

  readonly rowStyle = (params: RowClassParams) => {
    const index = params.data?.index ?? 0;
    const customColor = this.rowColors[index] || this.savedStyle.tableRowColors?.[index];
    return {
      backgroundColor: customColor || this.palette[index % this.palette.length],
      '--ag-row-hover-color': customColor ? 'transparent' : '#F5F8FF',
      color: this.rowTextColors[index] || this.savedStyle.tableRowTextColors?.[index] || '#101828',
    };
  };

  ngOnChanges(): void {
    if (this.designJson !== this.parsedDesignJson) {
      this.parsedDesignJson = this.designJson;
      try { this.savedStyle = JSON.parse(this.designJson || '{}') ?? {}; }
      catch { this.savedStyle = {}; }
    }
    const headerColor = this.headerColor || this.savedStyle.tableHeaderColor;
    const headerTextColor = this.headerTextColor || this.savedStyle.tableHeaderTextColor;
    const rowsKey = JSON.stringify([this.rows, this.rowColors, this.rowTextColors,
      this.savedStyle.tableRowColors, this.savedStyle.tableRowTextColors]);
    const rowsChanged = rowsKey !== this.rowsKey || this.records.length !== this.recordCount;
    if (rowsChanged) {
      this.rowsKey = rowsKey;
      this.recordCount = this.records.length;
      this.gridRows = this.rows.map((row, index) => ({
        index, values: 'category' in row ? [row.category, ...row.values] : row,
        source: this.records[index] ?? undefined,
      }));
    }
    const nextGrid = cloneTableGridOptions(this.tableGrid ?? this.savedStyle.tableGrid);
    if (rowsChanged) {
      this.stats = computeTableColumnStats(this.gridRows, this.headers.length);
      this.rowRecords = new WeakMap();
    } else if (this.stats.length !== this.headers.length) {
      this.stats = computeTableColumnStats(this.gridRows, this.headers.length);
    }
    // Stats are part of the key: they decide which columns draw data bars and how long the bars are.
    const columnsKey = JSON.stringify([this.headers, headerColor, headerTextColor, nextGrid, this.stats]);
    if (columnsKey !== this.columnsKey) {
      this.columnsKey = columnsKey;
      this.grid = nextGrid;
      this.activeCfRules = nextGrid.conditionalRules.filter(isTableCfRuleComplete);
      const header = {
        background: headerColor || 'linear-gradient(180deg, #2948A3 0%, #3B58B6 100%)',
        color: headerTextColor || '#FFFFFF',
      };
      const withTooltip = hasTableGridOptions(this.grid);
      this.columnDefs = this.headers.map((headerName, index) => {
        const def: ColDef = {
          colId: `column-${index}`, headerName,
          valueGetter: params => params.data ? params.data.values[index] ?? '\u2014' : undefined,
          valueFormatter: params => DateUtil.formatCellValue(params.value),
          cellStyle: params => this.cellStyle(params, headerName),
          headerStyle: header,
        };
        if (withTooltip) def.tooltip = params => params.valueFormatted ?? undefined;
        applyTableGridColumnOptions(def, headerName, this.stats[index], this.grid);
        return def;
      });
      this.autoGroupColumnDef = {
        minWidth: 180,
        pinned: this.grid.groupBy.some(name => this.grid.pinnedColumns.includes(name)) ? 'left' : null,
        headerStyle: header,
      };
    }
    const grouped = this.grid.groupBy.length > 0;
    this.displayRows = grouped ? this.gridRows.filter(row => !this.isSummaryRow(row)) : this.gridRows;
    this.pinnedSummaryRows = grouped ? this.gridRows.filter(row => this.isSummaryRow(row)) : [];
  }

  /** With records supplied, a row without one is a DAX summary row. */
  private isSummaryRow(row: ChartTableRow): boolean {
    return this.records.length > 0 && !row.source;
  }

  private cellStyle(params: CellClassParams, header: string): Record<string, string> | null {
    const data = params.data as ChartTableRow | undefined;
    if (!data || !this.activeCfRules.length) return null;
    let record = this.rowRecords.get(data);
    if (!record) {
      record = Object.fromEntries(this.headers.map((name, index) => [name, data.values[index]]));
      this.rowRecords.set(data, record);
    }
    const format = evaluateConditionalRules(this.activeCfRules, header, record);
    const style: Record<string, string> = {};
    if (format.backgroundColor) style['backgroundColor'] = format.backgroundColor;
    if (format.textColor) style['color'] = format.textColor;
    if (format.bold) style['fontWeight'] = '700';
    return Object.keys(style).length ? style : null;
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
  }

  readonly contextMenuItems = (params: GetContextMenuItemsParams): (DefaultMenuItem | MenuItemDef)[] => {
    const defaults = (params.defaultItems ?? []) as (DefaultMenuItem | MenuItemDef)[];
    const node = params.node;
    if (!node || node.rowPinned || !this.drillRecords(node).length) return defaults;
    return [{ name: 'Drill to detail', action: () => this.openDrill(node, params.column) }, 'separator', ...defaults];
  };

  onCellDoubleClicked(event: CellDoubleClickedEvent): void {
    if (event.node && !event.node.rowPinned) this.openDrill(event.node, event.column);
  }

  /** Source records when supplied, otherwise the displayed row keyed by column header. */
  private drillRecords(node: IRowNode): Record<string, unknown>[] {
    return drillLeafData<ChartTableRow>(node)
      .filter(row => !this.isSummaryRow(row))
      .map(row => row.source ?? Object.fromEntries(this.headers.map((name, index) => [name, row.values[index]])));
  }

  private openDrill(node: IRowNode, column: Column | null): void {
    const records = this.drillRecords(node);
    if (!records.length) return;
    const header = this.headers[Number((column?.getColId() ?? '').replace('column-', ''))];
    const data = node.data as ChartTableRow | undefined;
    const target = node.group
      ? `${node.rowGroupColumn?.getColDef().headerName ?? 'Group'}: ${node.key ?? ''}`
      : header && data ? `${header}: ${DateUtil.formatCellValue(data.values[this.headers.indexOf(header)])}` : '';
    this.drill.set({
      subtitle: `${target}${target ? ' \u00b7 ' : ''}${records.length} ${records.length === 1 ? 'record' : 'records'}`,
      columns: buildDrillColumns(records),
      rows: records,
    });
  }

  closeDrill(): void {
    this.drill.set(null);
  }
}
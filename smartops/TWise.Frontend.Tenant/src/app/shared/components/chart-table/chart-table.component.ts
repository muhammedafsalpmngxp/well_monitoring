import { Component, Input, OnChanges } from '@angular/core';
import { ColDef, RowClassParams, themeQuartz } from 'ag-grid-community';
import { DateUtil } from '../../../core/utils/date.util';

@Component({
  selector: 'app-chart-table',
  standalone: false,
  template: `
    <ag-grid-angular [columnDefs]="columnDefs" [rowData]="gridRows" [defaultColDef]="defaultColDef"
      [theme]="theme" [getRowStyle]="rowStyle" [animateRows]="true"
      [domLayout]="autoHeight ? 'autoHeight' : 'normal'"
      [style.height]="autoHeight ? null : height"
      (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()">
    </ag-grid-angular>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    /* flex/min-height are inert unless an ancestor makes :host a flex container (e.g. the
       expanded/fullscreen widget view) - in that case this lets the grid stretch to fill it
       instead of staying pinned to the fixed [height] input, so it fills the card with no
       top/bottom gap and no longer shrinks relative to the container at different app zoom levels. */
    ag-grid-angular { display: block; width: 100%; min-width: 0; text-transform: none; flex: 1; min-height: 0; }
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

  private savedStyle: {
    tableHeaderColor?: string; tableHeaderTextColor?: string;
    tableRowColors?: string[]; tableRowTextColors?: string[];
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
  private readonly palette = ['#EFF6FF', '#FFF7ED', '#F0FDF4', '#FEFCE8', '#FEF2F2', '#F5F3FF', '#F8FAFC', '#F0FDFA', '#FDF2F8', '#EEF2FF'];
  private columnsKey = '';
  private rowsKey = '';
  columnDefs: ColDef[] = [];
  gridRows: { values: readonly unknown[]; index: number }[] = [];

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
    const columnsKey = JSON.stringify([this.headers, headerColor, headerTextColor]);
    if (columnsKey !== this.columnsKey) {
      this.columnsKey = columnsKey;
      this.columnDefs = this.headers.map((headerName, index) => ({
        colId: `column-${index}`, headerName,
        valueGetter: params => params.data?.values[index] ?? '\u2014',
        valueFormatter: params => DateUtil.formatCellValue(params.value),
        headerStyle: {
          background: headerColor || 'linear-gradient(180deg, #2948A3 0%, #3B58B6 100%)',
          color: headerTextColor || '#FFFFFF',
        },
      }));
    }
    const rowsKey = JSON.stringify([this.rows, this.rowColors, this.rowTextColors,
      this.savedStyle.tableRowColors, this.savedStyle.tableRowTextColors]);
    if (rowsKey !== this.rowsKey) {
      this.rowsKey = rowsKey;
      this.gridRows = this.rows.map((row, index) => ({
        index, values: 'category' in row ? [row.category, ...row.values] : row,
      }));
    }
  }
}
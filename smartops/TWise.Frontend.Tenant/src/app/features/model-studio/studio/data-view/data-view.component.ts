import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { ColDef, ColGroupDef, GridApi, GridReadyEvent, RowSelectionOptions, SideBarDef, themeQuartz } from 'ag-grid-community';
import { Subscription, catchError, of } from 'rxjs';
import { DbSchemaColumn } from '../../../../core/services/common-api.service';
import { DatasetDetail, DatasetSource, ModelStudioService, QueryResult } from '../../../../core/services/model-studio.service';
import { TableDensity } from '../../../reports/shared/report-config.model';
import { buildReportGridColumns } from '../../../reports/shared/report-grid-columns.util';
import { fieldColumns, readQueryError } from '../../model-studio.util';

/** How many rows the Data view reads. */
export const DATA_VIEW_ROWS = 50;

// The report viewer's grid look (reports/view), so rows read the same in Model Studio and in reports.
export const gridTheme = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#E2E7EF',
  borderRadius: 8,
  fontFamily: 'var(--font-family-base)',
  headerBackgroundColor: '#E8F0FC',
  headerTextColor: '#344054',
  headerFontWeight: 700,
  rowHoverColor: '#F0F4FF',
  selectedRowBackgroundColor: '#FCD34D',
  wrapperBorderRadius: 8,
});

/** Row heights of the three densities, as in the report viewer. */
export const DENSITY_ROW_HEIGHT: Record<TableDensity, number> = { comfortable: 42, compact: 32, dense: 25 };

/**
 * The Data view: the first rows of one table as the model reads it, with its transforms and its calculated
 * columns, from the draft (POST /api/query with draft), in the report viewer's grid with its search and three
 * row densities. When the model cannot read the table, the rows as stored.
 */
@Component({
  selector: 'app-model-data-view',
  standalone: false,
  templateUrl: './data-view.component.html',
  styleUrls: ['./data-view.component.scss'],
})
export class DataViewComponent implements OnChanges, OnDestroy {
  @Input() dataset: DatasetDetail | null = null;
  @Input() source: DatasetSource | null = null;
  @Input() columns = new Map<string, DbSchemaColumn[]>();

  readonly gridTheme = gridTheme;
  readonly defaultColDef: ColDef = { flex: 1, minWidth: 140, resizable: true, sortable: true, filter: true };
  readonly densities: { id: TableDensity; label: string }[] = [
    { id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }, { id: 'dense', label: 'Dense' },
  ];
  density: TableDensity = 'compact';
  search = '';
  /** Rows picked by click or checkbox are highlighted, as in the report viewer. */
  readonly rowSelection: RowSelectionOptions = { mode: 'multiRow', headerCheckbox: true, enableClickSelection: true };
  readonly sideBar: SideBarDef = {
    toolPanels: [
      { id: 'columns', labelDefault: 'Columns', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel',
        toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } },
      { id: 'filters', labelDefault: 'Filters', labelKey: 'filters', iconKey: 'filter', toolPanel: 'agFiltersToolPanel' },
    ],
  };
  /** The grid fills the window. */
  expanded = false;
  private gridApi?: GridApi;

  running = false;
  result: QueryResult | null = null;
  columnDefs: (ColDef | ColGroupDef)[] = [];
  error: { message: string; hint: string } | null = null;
  /** True when the model could not read the table and the rows are shown as stored. */
  raw = false;

  /** The table and model the rows were read for; a change that does not touch them reads nothing. */
  private shownFor = '';
  private request?: Subscription;

  constructor(private readonly modelStudio: ModelStudioService, private readonly cdr: ChangeDetectorRef) {}

  get rowsLabel(): string {
    const count = this.result?.rows.length ?? 0;
    if (count >= DATA_VIEW_ROWS) return `First ${DATA_VIEW_ROWS} rows`;
    return `${count} row${count === 1 ? '' : 's'}, the whole table`;
  }

  get calculatedCount(): number {
    return this.dataset?.calculatedColumns.filter(c => c.sourceId === this.source?.id).length ?? 0;
  }

  get transformCount(): number {
    return this.dataset?.transforms.filter(t => t.sourceId === this.source?.id).length ?? 0;
  }

  ngOnChanges(): void {
    const { dataset, source } = this;
    const shownFor = dataset && source ? JSON.stringify([
      dataset.id, source.id, source.alias, dataset.calculatedColumns.filter(c => c.sourceId === source.id),
      dataset.transforms.filter(t => t.sourceId === source.id), this.fields().length,
    ]) : '';
    if (shownFor === this.shownFor) return;
    this.shownFor = shownFor;
    this.request?.unsubscribe();
    this.running = false;
    this.result = null;
    this.error = null;
    this.run();
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  /** Refresh reads the rows from the database again. */
  run(refresh = false): void {
    const { dataset, source } = this;
    if (!dataset || !source) return;
    this.request?.unsubscribe();
    this.running = true;
    this.error = null;
    this.raw = false;
    const dimensions = this.fields().map(name => `${source.alias}.${name}`);
    const rows$ = dimensions.length
      ? this.modelStudio.runQuery({ datasetId: dataset.id, dimensions, measures: [], topN: DATA_VIEW_ROWS, draft: true, refresh })
      : this.stored();
    this.request = rows$.pipe(catchError(() => {
      // The model cannot read the table yet (for example an unfinished row filter): show it as stored.
      this.raw = true;
      return this.stored();
    })).subscribe({
      next: result => {
        this.result = result;
        this.columnDefs = this.gridColumns(result);
        this.running = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.result = null;
        this.error = readQueryError(err);
        this.running = false;
        this.cdr.markForCheck();
      },
    });
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
  }

  /** Opens the Columns panel, or closes it when it is open. */
  toggleColumns(): void {
    if (!this.gridApi) return;
    if (this.gridApi.getOpenedToolPanel() === 'columns') this.gridApi.closeToolPanel();
    else this.gridApi.openToolPanel('columns');
  }

  get rowHeight(): number {
    return DENSITY_ROW_HEIGHT[this.density];
  }

  /** The table's stored columns and its calculated columns, as the model names them. */
  private fields(): string[] {
    const { dataset, source } = this;
    return dataset && source ? fieldColumns(dataset, this.columns, source).map(column => column.columnName) : [];
  }

  private stored() {
    const { dataset, source } = this;
    this.raw = true;
    if (!dataset || !source) return of({ columns: [], rows: [], fetchedAt: '', fromCache: false } as QueryResult);
    return this.modelStudio.previewSource(dataset.id, { kind: source.kind ?? 'table', schemaName: source.schemaName, sourceName: source.sourceName });
  }

  /** Headers without the table prefix; calculated columns marked, so they stand out from stored ones. */
  private gridColumns(result: QueryResult): (ColDef | ColGroupDef)[] {
    const prefix = `${this.source?.alias}.`;
    const calculated = new Set(this.dataset?.calculatedColumns.filter(c => c.sourceId === this.source?.id).map(c => c.name.toLowerCase()));
    return buildReportGridColumns(() => null, result.columns, result.rows).map(column => {
      if ('children' in column || !column.field) return column;
      const name = column.field.startsWith(prefix) ? column.field.slice(prefix.length) : column.field;
      const isCalculated = !this.raw && calculated.has(name.toLowerCase());
      return {
        ...column,
        headerName: isCalculated ? `ƒx ${name}` : name,
        headerTooltip: isCalculated ? 'Calculated column' : name,
        headerClass: isCalculated ? 'data-view__calculated' : undefined,
      };
    });
  }
}

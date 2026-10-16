import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, inject } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, themeQuartz } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { HighchartsChartComponent } from 'highcharts-angular';
import type Highcharts from 'highcharts';
import { Observable, Subscription, shareReplay } from 'rxjs';
import { buildAdvancedOptions, isAdvancedChart, MAP_CHART_TYPES, prepareAdvancedDax, readAdvancedConfig, validateAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { DaxMeasureConfig, formatDaxValue } from '../../../core/utils/dax-evaluator.util';

@Component({
  selector: 'app-advanced-chart',
  standalone: true,
  host: { '[style.height]': 'height' },
  imports: [CommonModule, HighchartsChartComponent, AgGridAngular],
  template: `
    <div class="advanced-visual" [style.height]="height" [style.display]="daxSummaries.length ? 'flex' : null" [style.flex-direction]="daxSummaries.length ? 'column' : null">
      <div *ngIf="error" class="visual-state" role="status">{{ error }}</div>
      <div *ngIf="!error && !rows.length" class="visual-state" role="status">No data</div>
      <div *ngIf="loading && !error && rows.length" class="visual-state" role="status">Loading map...</div>
      <ag-grid-angular *ngIf="grid && !error && rows.length" class="advanced-grid"
        [theme]="theme" [modules]="modules" [rowData]="displayRows" [columnDefs]="columns"
        [defaultColDef]="defaultColumn" [pivotMode]="type === 'pivottable'" [groupDefaultExpanded]="1"
        [suppressFieldDotNotation]="true" [grandTotalRow]="'bottom'" [groupTotalRow]="'bottom'"
        [animateRows]="false" [autoGroupColumnDef]="groupColumn" />
      <ng-container *ngFor="let renderType of [type]; trackBy: trackRenderType">
        <!-- Keyed on the options object so a new renderer gets a NEW chart. Updating in place merges
             options, which leaves a polar pane and old series behind when switching renderers. -->
        <ng-container *ngFor="let o of (options && !error && rows.length && !loading ? [options] : []); trackBy: byRef">
          <highcharts-chart class="advanced-highchart"
            [constructorType]="map ? 'mapChart' : 'chart'" [options]="o" />
        </ng-container>
      </ng-container>
      <ag-grid-angular *ngIf="daxSummaries.length && !error" [theme]="theme" [modules]="modules"
        [rowData]="daxSummaries" [columnDefs]="daxSummaryColumns" [headerHeight]="0" [rowHeight]="28"
        [style.height.px]="daxSummaryHeight" style="flex: 0 0 auto; width: 100%; min-width: 0"
        [animateRows]="false" [suppressCellFocus]="true" />
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; height: 100%; }
    .advanced-visual { width: 100%; min-height: 200px; min-width: 0; overflow: hidden; }
    .advanced-highchart, .advanced-grid { display: block; width: 100%; height: 100%; flex: 1; min-height: 0; }
    .visual-state { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; box-sizing: border-box; color: #667085; font-size: 13px; overflow-wrap: anywhere; text-align: center; flex: 1; min-height: 0; }
  `],
})
export class AdvancedChartComponent implements OnChanges, OnDestroy {
  @Input() type: string | null = null;
  @Input() rows: Record<string, unknown>[] = [];
  @Input() config: unknown;
  @Input() height = '100%';
  @Input() showLegend = true;
  /** A marker of a map visual was clicked: the label field and the marker's label (used to filter a dashboard). */
  @Output() pointClick = new EventEmitter<{ field: string; value: string }>();
  @Input() daxMeasures: DaxMeasureConfig[] = [];
  displayRows: Record<string, unknown>[] = [];
  daxSummaries: ReturnType<typeof prepareAdvancedDax>['summaries'] = [];
  readonly daxSummaryColumns: ColDef[] = [
    { headerName: 'DAX Measure', flex: 2, minWidth: 100, valueGetter: params => params.data?.measure.name?.trim() || 'New Metric' },
    { headerName: 'Value', field: 'value', flex: 1, minWidth: 70, valueFormatter: params => formatDaxValue(params.value, params.data?.measure) },
  ];
  options: Highcharts.Options | null = null;
  columns: ColDef[] = [];
  readonly modules = [AllCommunityModule, AllEnterpriseModule];
  readonly theme = themeQuartz.withParams({ fontSize: 12, headerBackgroundColor: '#eef3f8', wrapperBorderRadius: 0 });
  readonly defaultColumn: ColDef = { flex: 1, minWidth: 110, sortable: true, filter: true, resizable: true };
  readonly groupColumn: ColDef = { headerName: 'Dimension', minWidth: 180, cellRendererParams: { suppressCount: false } };
  grid = false;
  map = false;
  error = '';
  loading = false;
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private subscription?: Subscription;
  private static worldMap?: Observable<unknown>;

  trackRenderType(_index: number, type: string | null): string | null { return type; }

  byRef = (_: number, o: Highcharts.Options) => o;

  get daxSummaryHeight(): number { return Math.min(this.daxSummaries.length * 28 + 2, 114); }

  ngOnChanges(): void {
    this.subscription?.unsubscribe();
    this.options = null;
    this.error = '';
    this.loading = false;
    this.grid = this.type === 'pivottable' || this.type === 'matrix';
    this.map = MAP_CHART_TYPES.has(this.type ?? '') || this.type === 'wellmap';
    this.displayRows = this.rows;
    this.daxSummaries = [];
    this.columns = [];
    if (!isAdvancedChart(this.type)) return;
    const dax = prepareAdvancedDax(this.rows, this.daxMeasures);
    this.displayRows = dax.rows;
    this.daxSummaries = dax.summaries;
    if (!this.rows.length) return;
    const type = this.type;
    const config = readAdvancedConfig(this.config);
    try {
      validateAdvancedConfig(type, this.rows, config);
      if (this.grid) {
        this.columns = [
          ...config.dimensions.map((field, index): ColDef => ({ field, rowGroup: true, rowGroupIndex: index, hide: true })),
          ...(this.type === 'pivottable' ? [{ field: config.fields['column'], pivot: true, hide: true }] : []),
          ...config.measures.map((field): ColDef => ({ field, aggFunc: config.aggregation, cellDataType: 'number', valueGetter: params => {
            const value = params.data?.[field];
            if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
            return Number.isFinite(Number(value)) ? Number(value) : null;
          } })),
          ...dax.rowMeasures.map(({ field, measure }): ColDef => ({ field, headerName: measure.name?.trim() || 'New Metric', aggFunc: 'sum', cellDataType: 'number', valueFormatter: params => formatDaxValue(params.value, measure) })),
        ];
      } else if (this.type === 'wellmap') {
        // Well Map draws on map tiles (or a plain background), so it needs no country boundaries.
        this.options = this.withPointClick(buildAdvancedOptions(type, this.rows, config), config.fields['category']);
        this.applyLegend();
      } else if (this.map) {
        this.loading = true;
        AdvancedChartComponent.worldMap ??= this.http.get('assets/maps/world.topo.json').pipe(shareReplay({ bufferSize: 1, refCount: false }));
        this.subscription = AdvancedChartComponent.worldMap.subscribe({
          next: boundaries => {
            try { this.options = buildAdvancedOptions(type, this.rows, config, boundaries); this.applyLegend(); }
            catch (error) { this.error = error instanceof Error ? error.message : 'Unable to render map.'; }
            this.loading = false;
            this.cdr.markForCheck();
          },
          error: () => { this.error = 'Unable to load map boundaries.'; this.loading = false; this.cdr.markForCheck(); },
        });
      } else {
        this.options = buildAdvancedOptions(type, this.rows, config);
        this.applyLegend();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to render visual.';
    }
  }

  private withPointClick(options: Highcharts.Options, field: string): Highcharts.Options {
    if (!field || !this.pointClick.observed) return options;
    const emit = (name: unknown) => { if (name !== undefined && name !== '') this.pointClick.emit({ field, value: String(name) }); };
    return {
      ...options,
      plotOptions: { ...options.plotOptions, series: { ...options.plotOptions?.series, cursor: 'pointer', point: { events: { click() { emit(this.name); } } } } },
    };
  }

  private applyLegend(): void {
    if (this.options && !this.showLegend) this.options.legend = { ...this.options.legend, enabled: false };
  }

  ngOnDestroy(): void { this.subscription?.unsubscribe(); }
}
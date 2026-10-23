import { ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import type Highcharts from 'highcharts';
import { buildFunnelOptions } from '../../../core/utils/funnel-chart.util';
import { buildTimelineOptions } from '../../../core/utils/timeline-chart.util';
import { buildHistogramOptions } from '../../../core/utils/histogram-chart.util';
import { buildScatterOptions } from '../../../core/utils/scatter-chart.util';
import { buildHeatmapOptions, resolveHeatmapMeasure } from '../../../core/utils/heatmap-chart.util';
import { applyDataLabelPreference } from '../../../core/utils/chart-data-labels.util';
import { applyChartSort } from '../../../core/utils/chart-sort.util';
import { Widget, WidgetService } from '../../../core/services/widget.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import type { DaxMeasureConfig } from '../../../core/utils/dax-evaluator.util';
import { appendDaxToChartData, appendDaxToTableRows, getActiveDaxMeasures, getDaxRowColumnMeasures } from '../../../core/utils/dax-evaluator.util';
import { applyConditionalFilters, getSavedConditionalFilters } from '../../../core/utils/conditional-filter.util';
import { applyParameterFilters, getSavedParameterFilters, remapDesignColumns } from '../../../core/utils/parameter-filter.util';
import { AdvancedChartPayload, isAdvancedChart, readAdvancedConfig } from '../../../core/utils/advanced-chart.util';
import { CHART_AUTO_COLORS, getSeriesColorByName, usesPeriodLineCategoryColorRules, usesSeriesCategoryColorRules } from '../../../core/utils/chart-color.util';
import { buildKpiChartOptions, computeKpiValue } from '../../../core/utils/kpi-chart.util';
import { comboAxes, gaugeShape, treemapShape } from '../../../core/utils/chart-shapes.util';

// Same palette as the Chart Details page (widget-view.component.ts) so a chart's colors match
// between its card preview and its detail view.
const COLORS = [...CHART_AUTO_COLORS];

function safeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

@Component({
  selector: 'app-chart-card-preview',
  standalone: false,
  template: `
    <app-advanced-chart *ngIf="advanced" [type]="advanced.type" [rows]="advanced.rows" [config]="advanced.config" [daxMeasures]="advanced.daxMeasures ?? []" height="260px"></app-advanced-chart>
    <highcharts-chart *ngIf="options && !showTable && !advanced && !isPreviewEmpty" class="chart-card-preview" [options]="options"></highcharts-chart>
    <app-chart-no-data *ngIf="options && !showTable && !advanced && isPreviewEmpty" class="chart-card-preview"></app-chart-no-data>
    <app-chart-table *ngIf="showTable" [headers]="tableHeaders" [rows]="tableRows" height="220px"
      [headerColor]="cachedDesign?.['tableHeaderColor']" [headerTextColor]="cachedDesign?.['tableHeaderTextColor']"
      [rowColors]="tableRowColors" [rowTextColors]="cachedDesign?.['tableRowTextColors'] || []">
    </app-chart-table>
    <div *ngIf="!options && !showTable && !advanced && loadingData" class="ccp-loading">
      <div class="ccp-skeleton"></div>
      <div class="ccp-skeleton ccp-skeleton--short"></div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .chart-card-preview { display: block; width: 100%; }
    .chart-card-preview-table { overflow: auto; max-height: 220px; border-radius: 12px; border: 1px solid #E7ECF3; scrollbar-width: thin; scrollbar-color: #21409A transparent; }
    .chart-card-preview-table::-webkit-scrollbar { width: 3px; }
    .chart-card-preview-table::-webkit-scrollbar-track { background: transparent; }
    .chart-card-preview-table::-webkit-scrollbar-thumb { background: #21409A; border-radius: 30px; }
    .chart-card-preview-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .chart-card-preview-table th { border-bottom: 1px solid #E6EBF2;
background: linear-gradient(180deg, #2948A3 0%, #3B58B6 100%);
 color: #fff; font-weight: 600; padding: 8px 10px; text-align: left; white-space: nowrap;  position: sticky; top: 0; }
    .chart-card-preview-table th.ccp-th-val { text-align: right; }
    .chart-card-preview-table td { padding: 6px 10px; color: #344054; border-bottom: 1px solid rgba(0,0,0,0.05); white-space: nowrap; vertical-align: middle; font-size: 12px; }
    .chart-card-preview-table td.ccp-val { text-align: right; font-weight: 500; color: #101828; }
    .chart-card-preview-table tr:last-child td { border-bottom: none; }
    .ccp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; vertical-align: middle; flex-shrink: 0; }
    .ccp-loading { display: flex; flex-direction: column; gap: 8px; padding: 16px 0; }
    .ccp-skeleton { height: 120px; border-radius: 8px; background: linear-gradient(90deg, #f0f2f5 25%, #e4e7ec 50%, #f0f2f5 75%); background-size: 200% 100%; animation: ccp-shimmer 1.4s infinite; }
    .ccp-skeleton--short { height: 16px; width: 60%; }
    @keyframes ccp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `],
})
export class ChartCardPreviewComponent implements OnInit, OnChanges, OnDestroy {
  @Input() widget!: Widget;
  @Input() chartTypeOverride?: string;
  private _options: Highcharts.Options | null = null;
  /** Assignments flow through here so the saved "Show Data Labels" preference is applied centrally. */
  get options(): Highcharts.Options | null { return this._options; }
  set options(value: Highcharts.Options | null) {
    this._options = applyDataLabelPreference(applyChartSort(value, this.cachedDesign?.['sortOrder'] as string | undefined), this.cachedDesign?.['showDataLabels']);
  }
  /** True when there's nothing worth drawing: every series has no data points at all (the
   *  common case for a draft widget whose xAxis/source isn't fully configured yet — Highcharts
   *  would otherwise draw an empty axes box that looks identical to a broken chart), or — for a
   *  pie/donut specifically — every slice is zero (which Highcharts would otherwise draw as an
   *  empty ring). Checked here rather than relying solely on the pie-only `pieChartEmpty` pipe,
   *  which never covered the empty-data case for bar/line/area/etc. */
  get isPreviewEmpty(): boolean {
    const series = this.options?.series;
    if (!Array.isArray(series) || series.length === 0) return false;
    const chartType = this.options?.chart?.type;
    return series.every(s => {
      const data = (s as { data?: unknown[] }).data;
      if (!Array.isArray(data) || data.length === 0) return true;
      const seriesType = (s as { type?: string }).type ?? chartType;
      return seriesType === 'pie' && data.every(point => !this.pointValue(point));
    });
  }

  private pointValue(point: unknown): number {
    if (typeof point === 'number') return point;
    if (Array.isArray(point)) return Number(point.at(-1)) || 0;
    if (point && typeof point === 'object') {
      const record = point as { y?: unknown; value?: unknown };
      return Number(record.y ?? record.value ?? 0) || 0;
    }
    return 0;
  }
  advanced: AdvancedChartPayload | null = null;
  showTable = false;
  tableHeaders: string[] = [];
  tableRows: (string | number)[][] = [];
  tableRowColors: string[] = [];
  tableRowBgColors: string[] = [];

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  private observer: IntersectionObserver | null = null;
  private loaded = false;

  constructor(
    private readonly el: ElementRef,
    private readonly cdr: ChangeDetectorRef,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
  ) { }

  ngOnInit(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !this.loaded) {
          this.loaded = true;
          this.observer?.disconnect();
          this.loadData();
        }
      },
      { rootMargin: '200px' },
    );
    this.observer.observe(this.el.nativeElement);
  }

  cachedDesign: Record<string, any> | null = null;
  private cachedRows: Record<string, unknown>[] | null = null;
  private cachedColumns: string[] | null = null;
  private lastWidgetId: number | null = null;
  loadingData = false;

  ngOnChanges(): void {
    this.advanced = null;
    if (this.loaded) {
      if (this.widget && this.widget.id === this.lastWidgetId) {
        if (this.cachedDesign && this.cachedRows) {
          // Null out options first so *ngIf destroys the existing Highcharts instance,
          // then rebuild on the next microtask to always get a fresh chart for any type.
          this.options = null;
          this.showTable = false;
          this.cdr.markForCheck();
          const design = this.cachedDesign;
          const cols = this.cachedColumns ?? [];
          const rows = this.cachedRows;
          Promise.resolve().then(() => {
            this.buildChart(design, cols, rows);
            this.cdr.markForCheck();
          });
        }
        // If loadingData is in-flight, it will call buildChart with the latest override on arrival
      } else {
        this.options = null;
        this.showTable = false;
        this.loadData();
      }
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private loadData(): void {
    if (!this.widget || this.loadingData) return;
    let design: Record<string, any> = {};
    try { design = JSON.parse(this.widget.designJson ?? '{}'); } catch { this.buildFallback({}); return; }

    this.lastWidgetId = this.widget.id;
    this.cachedDesign = design;
    this.loadingData = true;

    const source = this.widget.source;
    const sourceType = this.widget.sourceType ?? 'Table';
    const viewId = this.widget.sourceId ?? design['viewId'];

    const onData = (res: { columns: string[]; rows: Record<string, unknown>[] }) => {
      this.loadingData = false;
      this.cachedColumns = res.columns ?? [];
      this.cachedRows = res.rows ?? [];
      this.buildChart(design, this.cachedColumns, this.cachedRows);
    };
    const onError = () => { this.loadingData = false; this.buildFallback(design); };

    if (sourceType === 'View' && viewId) {
      this.commonApi.getDatabaseViewById(viewId).subscribe({
        next: (view) => {
          this.commonApi.previewView({ connectionId: view.connectionId, sql: view.generatedSql, viewId: view.id, maxRows: 100 }).subscribe({ next: onData, error: onError });
        },
        error: onError,
      });
    } else {
      this.widgetService.getTableData(source, sourceType).subscribe({ next: onData, error: onError });
    }
  }

  private buildChart(rawDesign: Record<string, any>, _columns: string[], rawRows: Record<string, unknown>[]): void {
    this.advanced = null;
    const paramFilters = getSavedParameterFilters(rawDesign);
    const design = remapDesignColumns(rawDesign, paramFilters);
    const { rows: transformedRows, columns: transformedCols } = applyParameterFilters(rawRows, paramFilters, _columns);
    const rows = applyConditionalFilters(transformedRows, getSavedConditionalFilters(design));
    const chartType = this.chartTypeOverride ?? (design['chartType'] as string ?? '');
    this.ruleDesignValue = design;
    this.ruleChartType = chartType;
    if (isAdvancedChart(chartType)) {
      this.advanced = { type: chartType, config: readAdvancedConfig(design['advancedConfig']), rows, daxMeasures: getActiveDaxMeasures(design) };
      this.options = null;
      this.showTable = false;
      this.cdr.markForCheck();
      return;
    }
    const xAxis = design['xAxis'] as string ?? '';
    const yAxis = design['yAxis'] as string ?? 'Count (F)';
    const yAggCol = design['yAggColumn'] as string ?? '';
    const multiYColumns = (design['multiYColumns'] as string[]) ?? [];
    const comboLineCols = (chartType === 'combo' || chartType === 'multiline' || chartType === 'grouped') ? ((design['comboLineColumns'] as string[]) ?? []) : [];
    const allMultiCols = (chartType === 'combo' || ((chartType === 'multiline' || chartType === 'grouped') && comboLineCols.length > 0)) ? [...new Set([...multiYColumns, ...comboLineCols])] : multiYColumns;
    const isMulti = ['multiline', 'area', 'stacked', 'grouped', 'combo', 'table'].includes(chartType) && allMultiCols.length > 0;
    const daxMeasures = getActiveDaxMeasures(design);

    // Chart types with their own field set instead of the plain xAxis/yAxis category+value shape.
    if (chartType === 'kpi') { this.options = buildKpiChartOptions(computeKpiValue(rows, design), 220); this.cdr.markForCheck(); return; }
    if (chartType === 'gauge') { this.buildGaugeChart(rows, yAxis, yAggCol, design); return; }
    if (chartType === 'histogram') { this.buildHistogramChart(rows, yAggCol || yAxis, design['histogramBins'] as number | undefined); return; }
    if (chartType === 'sankey') { this.buildSankeyChart(rows, design); return; }
    if (chartType === 'timeline') { this.buildTimelineChart(rows, design); return; }
    if (chartType === 'bullet') { this.buildBulletChart(rows, xAxis, yAxis, yAggCol, design); return; }
    if (chartType === 'bubble') { this.buildBubbleChart(rows, xAxis, yAxis, yAggCol, design); return; }
    if (chartType === 'scatter') {
      this.options = buildScatterOptions({
        rows, xColumn: xAxis, yColumn: yAggCol || yAxis,
        categoryColumn: (design['scatterCategoryColumn'] as string) || undefined, height: 220,
      });
      this.cdr.markForCheck();
      return;
    }
    if (chartType === 'heatmap') { this.buildHeatmapChart(rows, xAxis, yAxis, yAggCol, design); return; }

    if (chartType === 'table') {
      this.showTable = true;
      this.options = null;
      if (isMulti) {
        const tableColumns = multiYColumns.filter(column => column !== xAxis);
        const displayRows = rows.slice(0, 100);
        const rowColumnMeasures = getDaxRowColumnMeasures(daxMeasures);
        this.tableHeaders = [design['xAxisTitle'] || xAxis || 'Parameter', ...tableColumns,
          ...rowColumnMeasures.map(measure => measure.name?.trim() || 'New Metric')];
        this.tableRows = displayRows.map(row => [xAxis, ...tableColumns].map(column => {
          const value = row[column];
          return typeof value === 'number' ? value : String(value ?? '\u2014');
        }));
        appendDaxToTableRows(daxMeasures, rows, transformedCols, this.tableRows, tableColumns.length,
          displayRows.map(row => [row]), tableColumns);
        this.tableRowColors = this.computeTableRowColors(this.tableRows);
        this.tableRowBgColors = this.tableRowColors.map(c => c ? this.hexToRgba(c, 0.08) : '');
      } else {
        const { cats, vals } = this.aggregate(rows, xAxis, yAxis, yAggCol);
        const rowColumnMeasures = getDaxRowColumnMeasures(daxMeasures);
        this.tableHeaders = ['Category', 'Value', ...rowColumnMeasures.map(m => m.name?.trim() || 'New Metric')];
        this.tableRows = cats.slice(0, 50).map((c, i) => [c, vals[i] ?? 0]);
        const grouped = new Map<string, Record<string, unknown>[]>();
        for (const r of rows) { const k = safeString(r[xAxis]) || '(empty)'; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k)!.push(r); }
        const rowGroups = cats.slice(0, 50).map(c => grouped.get(c) ?? []);
        appendDaxToTableRows(daxMeasures, rows, _columns, this.tableRows, 1, rowGroups, [yAggCol || yAxis]);
        this.tableRowColors = this.computeTableRowColors(this.tableRows);
        this.tableRowBgColors = this.tableRowColors.map(c => c ? this.hexToRgba(c, 0.08) : '');
      }
      this.cdr.markForCheck();
      return;
    }

    this.showTable = false;

    if (isMulti) {
      this.buildMultiSeriesChart(chartType, xAxis, yAxis, allMultiCols, rows, comboLineCols, { measures: daxMeasures, columns: _columns });
    } else {
      const { cats, vals } = this.aggregate(rows, xAxis, yAxis, yAggCol);
      const limitedCats = cats.slice(0, 20);
      const limitedVals = vals.slice(0, 20);
      appendDaxToChartData(daxMeasures, rows, _columns, limitedCats, limitedVals);
      this.buildSingleChart(chartType, limitedCats, limitedVals);
    }
  }

  private aggregate(rows: Record<string, unknown>[], xAxis: string, yAxis: string, yAggCol: string): { cats: string[]; vals: number[] } {
    if (!rows.length || !xAxis) return { cats: [], vals: [] };
    const fns = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'];
    const isFn = fns.includes(yAxis);
    const grouped = new Map<string, { count: number; set: Set<string>; nums: number[] }>();
    for (const row of rows) {
      const key = safeString(row[xAxis]) || '(empty)';
      if (!grouped.has(key)) grouped.set(key, { count: 0, set: new Set(), nums: [] });
      const g = grouped.get(key)!;
      g.count++;
      const col = isFn ? yAggCol : yAxis;
      if (yAxis === 'Count Distinct (F)') g.set.add(col ? (safeString(row[col]) || '(empty)') : key);
      else g.set.add(key);
      if (col) { const v = Number(row[col] ?? 0); g.nums.push(Number.isNaN(v) ? 0 : v); }
    }
    const cats: string[] = [];
    const vals: number[] = [];
    for (const [k, g] of grouped) {
      cats.push(k);
      vals.push(this.computeGroupValue(yAxis, g));
    }
    return { cats, vals };
  }

  private computeGroupValue(yAxis: string, g: { count: number; set: Set<string>; nums: number[] }): number {
    switch (yAxis) {
      case 'Count (F)': return g.count;
      case 'Count Distinct (F)': return g.set.size;
      case 'Sum (F)': return g.nums.reduce((a, b) => a + b, 0);
      case 'Average (F)': return g.nums.length ? g.nums.reduce((a, b) => a + b, 0) / g.nums.length : 0;
      case 'Min (F)': return g.nums.length ? Math.min(...g.nums) : 0;
      case 'Max (F)': return g.nums.length ? Math.max(...g.nums) : 0;
      default: return g.nums.reduce((a, b) => a + b, 0);
    }
  }

  /** Design used for color-rule matching (column names remapped by parameter filters). */
  private ruleDesignValue: Record<string, any> | null = null;
  private ruleChartType = '';

  private get ruleDesign(): Record<string, any> {
    return this.ruleDesignValue ?? this.cachedDesign ?? {};
  }

  private get colorRules(): Array<{ field: string; operator: string; value: string; value2?: string; categories?: string[]; color: string }> {
    return (this.ruleDesign['colorRules'] as any[] | undefined) ?? [];
  }

  /** Saved per-category color override from the Color Rules panel (Field = "Category"). For
   *  stacked/grouped/combo (and Period x-axis) charts the rule targets the series name, matching
   *  the Chart Details page. */
  private categoryColorForRule(category: string, seriesName = ''): string | undefined {
    const usesSeriesCategory = usesSeriesCategoryColorRules(this.ruleChartType, this.ruleDesign['xAxis'] as string | undefined);
    const normalized = (usesSeriesCategory ? seriesName : category).trim().toLowerCase();
    return this.colorRules.find(rule => rule.field?.trim().toLowerCase() === 'category'
      && (rule.categories ?? []).some(selected => selected.trim().toLowerCase() === normalized))?.color;
  }

  /** Non-"Category" color rules (operator + value, e.g. "pk_id Equal 179"), matched the same way
   *  as the Chart Details page: against the category, the value, or the field the rule names. */
  private colorForRule(category: string, value: number, seriesName = ''): string | undefined {
    const xField = ((this.ruleDesign['xAxis'] as string) ?? '').toLowerCase();
    const xTitle = ((this.ruleDesign['xAxisTitle'] as string) ?? '').toLowerCase();
    const yField = (((this.ruleDesign['yAggColumn'] as string) || (this.ruleDesign['yAxis'] as string)) ?? '').toLowerCase();
    const yTitle = ((this.ruleDesign['yAxisTitle'] as string) ?? '').toLowerCase();
    for (const rule of this.colorRules) {
      const field = rule.field?.trim().toLowerCase() ?? '';
      if (field === 'category') continue;
      const candidates: unknown[] = [category, value];
      if (field && (field === xField || field === xTitle)) candidates.splice(1, 1);
      else if (field && (field === yField || field === yTitle || field === seriesName.toLowerCase())) candidates.splice(0, 1);
      if (rule.operator === 'Between' && this.matchesColorRule(value, rule.operator, rule.value, rule.value2)) return rule.color;
      if (candidates.some(candidate => this.matchesColorRule(candidate, rule.operator, rule.value, rule.value2))) return rule.color;
    }
    return undefined;
  }

  private colorOverrideFor(category: string, seriesName = ''): string | undefined {
    const overrides = this.ruleDesign['colorOverrides'] as Record<string, string> | undefined;
    if (!overrides) return undefined;
    const names = [seriesName, this.ruleDesign['yAggColumn'] as string, this.ruleDesign['yAxis'] as string, '']
      .filter((name, index, all) => name !== undefined && name !== null && all.indexOf(name) === index);
    for (const name of names) {
      const color = overrides[`${name}:${category}`];
      if (color) return color;
    }
    return undefined;
  }

  /** Same precedence as the Chart Details page: category rule → manual override → value rule. */
  private pointColor(category: string, value: number, seriesName = '', includeCategoryRule = true): string | undefined {
    return (includeCategoryRule ? this.categoryColorForRule(category, seriesName) : undefined)
      ?? this.colorOverrideFor(category, seriesName)
      ?? this.colorForRule(category, value, seriesName);
  }

  private matchesColorRule(raw: unknown, operator: string, expected: string, expectedUpper?: string): boolean {
    const actualText = String(raw ?? '').trim();
    const expectedText = expected.trim();
    const actualNumber = Number(actualText);
    const expectedNumber = Number(expectedText);
    const expectedUpperNumber = Number(expectedUpper?.trim());
    const numeric = actualText !== '' && expectedText !== '' && Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
    switch (operator) {
      case '>=': return numeric && actualNumber >= expectedNumber;
      case '<=': return numeric && actualNumber <= expectedNumber;
      case '>': return numeric && actualNumber > expectedNumber;
      case '<': return numeric && actualNumber < expectedNumber;
      case 'Between': return numeric && Number.isFinite(expectedUpperNumber)
        && actualNumber >= Math.min(expectedNumber, expectedUpperNumber)
        && actualNumber <= Math.max(expectedNumber, expectedUpperNumber);
      case 'Not Equal': return actualText.toLowerCase() !== expectedText.toLowerCase();
      case 'Equal':
      case 'equals': return numeric ? actualNumber === expectedNumber : actualText.toLowerCase() === expectedText.toLowerCase();
      default: return false;
    }
  }

  /** Per-row background colors for the Table chart type — Color Rules (matched against the
   *  row's first column as category / second column as value) take priority over any manually
   *  saved per-row colors, matching the Chart Details page's own table coloring. */
  private computeTableRowColors(rows: (string | number)[][]): string[] {
    const manual = (this.cachedDesign?.['tableRowColors'] as string[]) ?? [];
    const hasRules = this.colorRules.length > 0;
    if (!hasRules) return manual;
    return rows.map((row, i) => {
      const category = String(row[0] ?? '');
      const value = Number(row[1]);
      return this.categoryColorForRule(category) ?? this.colorForRule(category, value) ?? manual[i] ?? '';
    });
  }

  private buildSingleChart(chartType: string, cats: string[], vals: number[]): void {
    this.ruleChartType = chartType;
    const singleSeriesName = String(this.ruleDesign['yAggColumn'] || this.ruleDesign['yAxis'] || 'Value');
    if (chartType === 'funnel') {
      this.options = buildFunnelOptions(cats, vals, COLORS, 260, 'Value', this.cachedDesign?.['showLegend'] !== false);
      this.cdr.markForCheck();
      return;
    }
    const isPie = ['pie', 'donut'].includes(chartType);
    const isTreemap = chartType === 'treemap';
    let hcType: string;
    if (isPie) hcType = 'pie';
    else if (['bar', 'column', 'stacked'].includes(chartType)) hcType = 'column';
    else if (['line', 'multiline', 'spline'].includes(chartType)) hcType = 'line';
    else if (chartType === 'area') hcType = 'area';
    else if (chartType === 'waterfall' || chartType === 'scatter' || isTreemap) hcType = chartType;
    else hcType = 'column';

    if (isPie) {
      this.options = {
        chart: { type: 'pie', backgroundColor: 'transparent', height: 260 },
        title: { text: undefined }, credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        // Paginate the legend so the plot retains room for outside value labels.
        legend: { enabled: true, align: 'center', verticalAlign: 'bottom', layout: 'vertical', squareSymbol: false, symbolRadius: 4, symbolHeight: 8, symbolWidth: 8, itemDistance: 10, itemStyle: { fontSize: '10px', fontWeight: '500', color: '#667085' }, maxHeight: 60 },
        plotOptions: {
          series: { dataLabels: { allowOverlap: false } },
          pie: {
            innerSize: chartType === 'donut' ? '55%' : '0%',
            borderWidth: 2, borderColor: '#fff', showInLegend: true,
            // Automatic size/center lets Highcharts fit and distribute labels in compact cards.
            dataLabels: {
              enabled: true, distance: 12, format: '{point.y}',
              connectorWidth: 1, padding: [2, 2, 2, 2],
              style: { color: '#344054', fontWeight: '700', fontSize: '12px', textOutline: 'none' },
            },
          },
        },
        series: [{ type: 'pie', name: 'Value', data: cats.map((name, i) => ({ name, y: vals[i] ?? 0, color: this.pointColor(name, vals[i] ?? 0, singleSeriesName) ?? COLORS[i % COLORS.length] })).filter(d => d.y !== 0) }],
      };
    } else if (isTreemap) {
      const shape = treemapShape(cats.map((name, i) => ({ name, value: vals[i] ?? 0 })), 'Value', COLORS);
      this.options = { ...shape, chart: { ...shape.chart, height: 220 } };
    } else {
      const lineCategoryColor = usesPeriodLineCategoryColorRules(this.ruleChartType, this.ruleDesign['xAxis'] as string, hcType)
        ? this.categoryColorForRule('', singleSeriesName) : undefined;
      this.options = {
        chart: { type: hcType as any, backgroundColor: 'transparent', height: 220 },
        title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: cats, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
        yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6' },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        plotOptions: { column: { borderRadius: 4, borderWidth: 0, colorByPoint: true, colors: COLORS, dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600' } } }, line: { marker: { enabled: true } }, area: { fillOpacity: 0.15 } },
        // A matched Color Rule overrides colorByPoint's cycling color for that one point only.
        series: [{
          type: hcType as any, name: 'Value', showInLegend: false,
          ...(lineCategoryColor ? { color: lineCategoryColor } : {}),
          data: vals.map((v, i) => { const c = this.pointColor(cats[i] ?? '', v, singleSeriesName, !lineCategoryColor); return c ? { y: v, color: c } : v; }),
        }],
      };
    }
    this.cdr.markForCheck();
  }

  /** Single aggregated number, no axes — solid-gauge needs a min/max range. */
  private buildGaugeChart(rows: Record<string, unknown>[], yAxis: string, yAggCol: string, design: Record<string, any>): void {
    const col = yAggCol || yAxis;
    const nums = rows.map(r => Number(r[col])).filter(v => !Number.isNaN(v));
    let value: number;
    if (yAxis === 'Average (F)') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (yAxis === 'Min (F)') value = nums.length ? Math.min(...nums) : 0;
    else if (yAxis === 'Max (F)') value = nums.length ? Math.max(...nums) : 0;
    else if (yAxis === 'Count (F)' || yAxis === 'Count Distinct (F)') value = rows.length;
    else value = nums.reduce((a, b) => a + b, 0);
    const min = Number(design['gaugeMin']) || 0;
    const max = Number(design['gaugeMax']) || 100;

    const shape = gaugeShape(value, min, max, col || 'Value');
    this.options = { ...shape, chart: { ...shape.chart, height: 220 } };
    this.cdr.markForCheck();
  }

  private buildHistogramChart(rows: Record<string, unknown>[], col: string, bins?: number): void {
    this.options = buildHistogramOptions(rows, col, bins, 220, COLORS);
    this.cdr.markForCheck();
  }

  /** Reuses X-axis category + Y-axis value, adds an optional Target column per category. */
  private buildBulletChart(rows: Record<string, unknown>[], xAxis: string, yAxis: string, yAggCol: string, design: Record<string, any>): void {
    const measureCol = yAggCol || yAxis;
    const targetCol = design['bulletTargetColumn'] as string ?? '';
    const grouped = this.groupRowsBy(rows, xAxis);
    const categories: string[] = [];
    const data: Array<{ y: number; target?: number }> = [];
    for (const [k, groupRows] of grouped) {
      categories.push(k);
      const y = groupRows.reduce((sum, r) => sum + (Number(r[measureCol]) || 0), 0);
      const target = targetCol ? groupRows.reduce((sum, r) => sum + (Number(r[targetCol]) || 0), 0) : undefined;
      data.push(target !== undefined ? { y, target } : { y });
    }
    this.options = {
      chart: { type: 'bullet' as any, inverted: true, backgroundColor: 'transparent', height: 220 },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories, title: { text: undefined } },
      yAxis: { title: { text: undefined }, gridLineWidth: 0 },
      plotOptions: { series: { pointPadding: 0.25, borderWidth: 0, color: COLORS[0], targetOptions: { width: '200%' } } } as any,
      series: [{ type: 'bullet' as any, name: measureCol || 'Value', data }],
    };
    this.cdr.markForCheck();
  }

  /** Reuses X-axis category + Y-axis value (aggregated), adds a required Size column (aggregated) per category. */
  private buildBubbleChart(rows: Record<string, unknown>[], xAxis: string, yAxis: string, yAggCol: string, design: Record<string, any>): void {
    const measureCol = yAggCol || yAxis;
    const sizeCol = design['bubbleSizeColumn'] as string ?? '';
    const grouped = this.groupRowsBy(rows, xAxis);
    const data: Array<{ x: number; y: number; z: number; name: string; color: string }> = [];
    let i = 0;
    for (const [k, groupRows] of grouped) {
      const y = groupRows.reduce((sum, r) => sum + (Number(r[measureCol]) || 0), 0);
      const z = sizeCol ? groupRows.reduce((sum, r) => sum + (Number(r[sizeCol]) || 0), 0) : 1;
      data.push({ x: i, y, z, name: k, color: COLORS[i % COLORS.length] });
      i++;
    }
    this.options = {
      chart: { type: 'bubble', zoomType: 'xy', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: [...grouped.keys()], title: { text: undefined } },
      yAxis: { title: { text: undefined } },
      plotOptions: { bubble: { minSize: 6, maxSize: 40 } },
      series: [{ type: 'bubble' as const, name: measureCol || 'Value', data }],
    };
    this.cdr.markForCheck();
  }

  /** X dimension x Y dimension grid, coloured by the aggregated Intensity / Value. */
  private buildHeatmapChart(rows: Record<string, unknown>[], xAxis: string, yAxis: string, yAggCol: string, design: Record<string, any>): void {
    this.options = buildHeatmapOptions({
      rows, xColumn: xAxis, yColumn: design['heatmapYColumn'] as string ?? '', ...resolveHeatmapMeasure(yAggCol, yAxis),
      xTitle: (design['xAxisTitle'] as string) || undefined, yTitle: (design['yAxisTitle'] as string) || undefined,
      height: 220, showLegend: design['showLegend'] !== false,
    });
    this.cdr.markForCheck();
  }

  /** From/To/Weight relationship — no xAxis/yAxis at all. */
  private buildSankeyChart(rows: Record<string, unknown>[], design: Record<string, any>): void {
    const from = design['sankeyFromColumn'] as string ?? '';
    const to = design['sankeyToColumn'] as string ?? '';
    const weightCol = design['sankeyWeightColumn'] as string ?? '';
    const weightMap = new Map<string, number>();
    for (const row of rows) {
      const f = safeString(row[from]), t = safeString(row[to]);
      if (!f || !t) continue;
      const key = `${f}\u2192${t}`;
      weightMap.set(key, (weightMap.get(key) ?? 0) + (Number(row[weightCol]) || 0));
    }
    const data = [...weightMap.entries()].map(([key, weight]) => {
      const [f, t] = key.split('\u2192');
      return [f, t, weight] as [string, string, number];
    });
    this.options = {
      chart: { type: 'sankey', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined }, credits: { enabled: false },
      series: [{ type: 'sankey' as const, name: weightCol || 'Flow', keys: ['from', 'to', 'weight'], data } as any],
    };
    this.cdr.markForCheck();
  }

  private buildTimelineChart(rows: Record<string, unknown>[], design: Record<string, any>): void {
    this.options = buildTimelineOptions(rows, {
      start: design['timelineDateColumn'] as string ?? '',
      end: design['timelineEndColumn'] as string ?? '',
      task: design['timelineLabelColumn'] as string ?? '',
    }, 220);
    this.cdr.markForCheck();
  }

  private groupRowsBy(rows: Record<string, unknown>[], xAxis: string): Map<string, Record<string, unknown>[]> {
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = safeString(row[xAxis]) || '(empty)';
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return grouped;
  }

  /** Applies the saved Top N / Bottom N / "Group as Others" limit to a card-preview multi-series category list. */
  private limitCardCategories(categories: string[], grouped: Map<string, Record<string, unknown>[]>, allCols: string[]): string[] {
    const design = this.cachedDesign ?? {};
    const limitCat = (design['limitCategory'] as string) ?? 'all';
    const wantTop = limitCat === 'top' && ((design['topN'] as number) ?? 0) > 0;
    const wantBottom = limitCat === 'bottom' && ((design['bottomN'] as number) ?? 0) > 0;
    if (!wantTop && !wantBottom) return categories.slice(0, 20);
    const n = wantTop ? (design['topN'] as number) : (design['bottomN'] as number);
    if (categories.length <= n) return categories;
    const total = (cat: string) => (grouped.get(cat) ?? []).reduce((s, r) => s + allCols.reduce((cs, c) => cs + (Number(r[c]) || 0), 0), 0);
    const pairs = categories.map(c => ({ c, v: total(c) })).sort((a, b) => wantTop ? b.v - a.v : a.v - b.v);
    const kept = pairs.slice(0, n).map(p => p.c);
    const rest = pairs.slice(n).map(p => p.c);
    if (((design['groupRestAsOthers'] as boolean) ?? false) && rest.length) {
      grouped.set('Others', rest.flatMap(rc => grouped.get(rc) ?? []));
      return [...kept, 'Others'];
    }
    return kept;
  }

  private buildMultiSeriesChart(chartType: string, xAxis: string, yAxis: string, multiYColumns: string[], rows: Record<string, unknown>[], comboLineCols: string[] = [], dax: { measures: DaxMeasureConfig[]; columns: string[] } = { measures: [], columns: [] }): void {
    const fns = ['Count (F)', 'Count Distinct (F)', 'Sum (F)', 'Average (F)', 'Min (F)', 'Max (F)'];
    const isFn = fns.includes(yAxis);
    const allCols: string[] = [];
    if (!isFn && yAxis && !multiYColumns.includes(yAxis)) allCols.push(yAxis);
    allCols.push(...multiYColumns);

    // Group rows by x-axis category for proper aggregation
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const k = safeString(r[xAxis]);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(r);
    }
    const cats = this.limitCardCategories([...grouped.keys()], grouped, allCols);
    const isStacked = chartType === 'stacked';
    const isGrouped = chartType === 'grouped';
    const isCombo = chartType === 'combo';
    // Grouped bars can carry a secondary (right) Y-axis: right-axis series stay bars, just on axis 1.
    const isGroupedDualY = isGrouped && comboLineCols.length > 0;
    // replace nested ternary with if/else to satisfy sonar rule
    let hcType: string;
    if (isStacked || isCombo || isGrouped) { hcType = 'column'; }
    else if (chartType === 'area') { hcType = 'area'; }
    else { hcType = 'line'; }

    const usesSeriesCategory = usesSeriesCategoryColorRules(chartType, xAxis);
    this.ruleChartType = chartType;
    const series: Highcharts.SeriesOptionsType[] = allCols.map((col, i) => {
      const isLineSeries = isCombo && comboLineCols.includes(col);
      const isRightAxis = (isCombo || isGroupedDualY) && comboLineCols.includes(col);
      const values = cats.map(cat => {
        const catRows = grouped.get(cat) ?? [];
        const nums = catRows.map(r => Number(r[col] ?? 0)).filter(n => !Number.isNaN(n));
        return nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
      });
      // Series-level "Category" rule (stacked/grouped/combo or Period line series) recolors the
      // whole series so the legend matches; other rules recolor individual points.
      const seriesCategoryColor = usesSeriesCategory
        || usesPeriodLineCategoryColorRules(chartType, xAxis, isLineSeries ? 'line' : hcType)
        ? this.categoryColorForRule('', col) : undefined;
      // only attach optional props when they have a real value to avoid Highcharts axis-lookup errors
      const s: any = {
        type: isLineSeries ? 'line' : hcType,
        name: col,
        data: values.map((value, ci) => {
          const color = this.pointColor(cats[ci] ?? '', value, col, !seriesCategoryColor);
          return color ? { y: value, color } : value;
        }),
        color: seriesCategoryColor ?? getSeriesColorByName(col, i),
      };
      if (isStacked || (isCombo && !isLineSeries)) s.stacking = 'normal';
      if (isCombo || isGroupedDualY) { s.yAxis = isRightAxis ? 1 : 0; }
      if (isLineSeries) { s.marker = { enabled: true, radius: 3 }; }
      return s as Highcharts.SeriesOptionsType;
    });

    if (isStacked && this.cachedDesign?.['showStackTotal'] !== false) {
      const totals = cats.map((_cat, ci) =>
        series.reduce((sum, s) => sum + this.pointValue(((s as any).data as unknown[])[ci]), 0)
      );
      series.push({
        type: 'line' as any,
        name: 'Total',
        data: totals,
        color: '#374151',
        marker: { enabled: true },
        dataLabels: { enabled: true, allowOverlap: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600' } } as any,
      });
    }

    const yAxisOptions: any = (isCombo || isGroupedDualY)
      ? comboAxes('#F1F3F6')
      : [{ title: { text: undefined }, gridLineColor: '#F1F3F6' }];

    appendDaxToChartData(dax.measures, rows, dax.columns, cats, [], series as { data?: unknown }[],
      isStacked && this.cachedDesign?.['showStackTotal'] !== false ? series.length - 1 : -1);

    this.options = {
      chart: { type: hcType, backgroundColor: 'transparent', height: 220 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom', layout: 'horizontal', squareSymbol: false, symbolRadius: 4, symbolHeight: 8, symbolWidth: 8, itemDistance: 10, itemStyle: { fontSize: '10px', fontWeight: '500', color: '#667085' } },
      xAxis: { categories: cats, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
      yAxis: yAxisOptions,
      tooltip: { shared: true },
      plotOptions: {
        line: { marker: { enabled: true } }, area: { fillOpacity: 0.15 }, column: {
          stacking: (isStacked || isCombo) ? 'normal' as any : undefined, grouping: isGrouped, borderRadius: (isStacked || isCombo) ? 0 : 4, borderWidth: 0,
          dataLabels: { enabled: isStacked || isGrouped, allowOverlap: true, crop: false, overflow: 'allow' as any, style: { fontSize: '11px', fontWeight: '600', ...(isStacked ? { color: '#fff' } : {}) } }
        }
      },
      series,
    };
    this.cdr.markForCheck();
  }

  private buildFallback(design: Record<string, any>): void {
    const chartType = design['chartType'] as string ?? 'bar';
    const fallbackCats = ['A', 'B', 'C', 'D', 'E'];
    const fallbackVals = [0, 0, 0, 0, 0];
    this.buildSingleChart(chartType, fallbackCats, fallbackVals);
  }
}

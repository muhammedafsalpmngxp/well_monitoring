import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostBinding, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CellClassParams, ColDef, ColGroupDef, RowClassParams, themeQuartz } from 'ag-grid-community';
import type Highcharts from 'highcharts';
import { Subscription } from 'rxjs';
import { ModelStudioService, QueryFilter, QueryRequest, QueryResult } from '../../../core/services/model-studio.service';
import { LoaderType } from '../../../shared/components/loader/loader.component';
import { readQueryError } from '../../model-studio/model-studio.util';
import {
  CanvasItem, FormatRule, MAX_SERIES, RelativeUnit, SERIES_CHART_TYPES, SLICER_HIGH, SLICER_LOW, SlicerState, SlicerStyle,
  Highlight, drillView, isDataItem, itemProblem, itemQuery, levelLabel, measuresOnAxis, slicerStyle,
} from '../canvas-config.util';
import { FieldKind } from '../canvas-filter.util';
import {
  GRID_DENSITY, LEVEL_COLUMN, MATRIX_KIND, TileView, canvasGridColumns, displayValue, formatNumber, matrixRows, ruleTone, skippedFiltersNote, tableRows, tileView,
} from '../canvas-format.util';
import { chartOptions, gaugeOptions, measureRows, withHighlight, withTooltips } from '../canvas-render.util';
import { rowsToExcel } from '../canvas-export.util';
import { ItemStyle, ThemeId, fitFontSize, paletteFor, sanitizeRichText, styleChart } from '../canvas-style.util';

// The polished grids' theme: design tokens as AG Grid theme parameters, no hex values.
const gridTheme = themeQuartz.withParams({
  accentColor: 'var(--color-primary)',
  backgroundColor: 'var(--color-bg-card)',
  borderColor: 'var(--color-border-subtle)',
  fontFamily: 'var(--font-family-base)',
  headerBackgroundColor: 'var(--color-bg-app)',
  headerFontWeight: 600,
  headerTextColor: 'var(--color-text-label)',
  rowHoverColor: 'var(--color-primary-50)',
  wrapperBorder: false,
});

/** static: a text or image object, which shows what it holds and runs no query. */
export type ObjectState = 'incomplete' | 'loading' | 'ready' | 'error' | 'static';

/** A point clicked on a chart: the chart's first field and the value there (P10-3). */
/** additive: Ctrl, Cmd or Shift was held, to add the point to the chosen ones. */
export interface PointClickEvent { field: string; value: unknown; additive?: boolean; }

/** The most slicer values listed at once; the search box finds the others. */
const SLICER_SHOWN = 200;

/**
 * One canvas object. Runs its dataset query through POST /api/query when the query or the sheet's filters
 * change, and redraws without a new request when only the look changes. Refresh, and the editor's Refresh all,
 * ask the server to read the rows from the database again. Chart clicks and slicer choices go up to the editor.
 */
@Component({
  selector: 'app-canvas-object',
  standalone: false,
  templateUrl: './canvas-object.component.html',
  styleUrls: ['./canvas-object.component.scss'],
})
export class CanvasObjectComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) item!: CanvasItem;
  /** The editor's Refresh all raises this; every change after the object's first load refreshes it. */
  @Input() refreshToken = 0;
  /** The object's place on the sheet; staggers the loading shimmer across objects. */
  @Input() index = 0;
  /** The sheet's slicer and cross-filter filters; the editor keeps the same array while they do not change. */
  @Input() filters: QueryFilter[] = [];
  /** A click on a chart point that this chart highlights; the editor keeps the same object while it does not change. */
  @Input() highlight: Highlight | null = null;
  /** A canvas still being edited reads the dataset's draft; a published canvas reads the published model. */
  @Input() draft = false;
  /** The sheet's theme, whose colours charts use unless the object has its own. */
  @Input() theme: ThemeId | undefined;
  /** Links on images and text open only while the canvas is viewed, not while it is edited. */
  @Input() interactive = false;
  /** Canvas-only names of fields and measures (Data pane menu), shown in place of the dataset's names. */
  @Input() labels: Record<string, string> = {};
  /** The canvas brand kit's colours, which charts use when neither they nor the sheet theme set their own. */
  @Input() brandColors: string[] | undefined;
  /** The kind of a slicer's field, which sets its inputs: numbers, dates or text. */
  @Input() fieldKind: FieldKind = 'text';
  @Output() pointClick = new EventEmitter<PointClickEvent>();
  @Output() slicerChange = new EventEmitter<SlicerState>();

  readonly gridTheme = gridTheme;
  readonly defaultColDef: ColDef = { flex: 1, minWidth: 70, resizable: true, sortable: true, wrapHeaderText: false };
  /** A matrix keeps each total next to its rows, so its grid is not sortable (P10-11). */
  readonly matrixColDef: ColDef = { ...this.defaultColDef, sortable: false };
  readonly matrixRowClass = (params: RowClassParams): string | undefined => {
    const kind = params.data?.[MATRIX_KIND];
    return kind === 'total' || kind === 'subtotal' ? `canvas-object__row--${kind}` : undefined;
  };

  state: ObjectState = 'incomplete';
  problem = '';
  error: { message: string; hint: string } | null = null;
  result: QueryResult | null = null;
  /** True when the result has as many rows as the query's limit, so more may exist. */
  limited = false;
  /** True when a chart split into series left some out (P10-4). */
  seriesCut = false;
  options: Highcharts.Options | null = null;
  value = '';
  tile: TileView | null = null;
  columnDefs: (ColDef | ColGroupDef)[] = [];
  rowData: Record<string, unknown>[] = [];
  /** A table's grand total, pinned under its rows. */
  totalRow: Record<string, unknown>[] = [];
  slicerValues: string[] = [];
  slicerSearch = '';
  /** A range or relative slicer's lowest and highest value of its field, as the inputs take them. */
  slicerLow = '';
  slicerHigh = '';
  readonly relativeUnits: RelativeUnit[] = ['days', 'months', 'years'];

  private queryKey: string | null = null;
  private seenToken?: number;
  private request?: Subscription;
  /** The value chosen at each drill level above the one shown, and whether a click drills down. */
  drillPath: (string | null)[] = [];
  drillMode = false;
  private drillKey = '';
  private highlightRequest?: Subscription;
  private highlightKey: string | null = null;
  /** The rows of the highlighted part, for a highlight on another field than the chart's axis. */
  private highlightPart: QueryResult | null = null;

  constructor(private readonly modelStudio: ModelStudioService, private readonly cdr: ChangeDetectorRef, private readonly sanitizer: DomSanitizer) {}

  /**
   * The base font size a text box starts from, and the largest a card may grow to; everything inside them is sized
   * relative to it (em), so one size scales the whole content.
   */
  private static readonly TEXT_SIZE = 14;
  private static readonly CARD_MAX = 20;
  private textBox?: HTMLElement;
  private textObserver?: ResizeObserver;

  /** A text box or a card, watched so its content fits again whenever the box changes size. */
  @ViewChild('fitBox') set textBoxElement(element: ElementRef<HTMLElement> | undefined) {
    this.textObserver?.disconnect();
    this.textBox = element?.nativeElement;
    if (this.textBox && typeof ResizeObserver !== 'undefined') {
      this.textObserver = new ResizeObserver(() => this.fitText());
      this.textObserver.observe(this.textBox);
    }
    this.fitText();
  }

  /**
   * Fits the content to its box: the largest size at which nothing overflows. Cards always fit, growing up to
   * CARD_MAX in a large box; a text box fits only with Fit text to the box, and never grows past its own size.
   */
  private fitText(): void {
    const box = this.textBox;
    if (!box) return;
    const card = this.item.type === 'tile';
    box.style.fontSize = '';
    if (!card && !this.item.style?.fitText) return;
    // A text box shrinks from its own size, which the brand kit may set; a card may grow to CARD_MAX.
    const own = parseFloat(getComputedStyle(box).fontSize) || CanvasObjectComponent.TEXT_SIZE;
    fitFontSize(size => {
      box.style.fontSize = `${size}px`;
      return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
    }, card ? CanvasObjectComponent.CARD_MAX : own);
  }

  /** The text object's rich text, sanitized here as it was when stored; plain text is shown as written. */
  get richText(): SafeHtml | null {
    const html = this.item.style?.html;
    // Safe: sanitizeRichText keeps only formatting tags, checked styles and https or mailto links.
    return html ? this.sanitizer.bypassSecurityTrustHtml(sanitizeRichText(html)) : null;
  }

  /** The grid's look: compact rows unless another density is chosen, and the object's text size, header colours and banding. */
  get objectGridTheme(): typeof gridTheme {
    const style = this.item.style;
    const key = JSON.stringify([style?.density, style?.fontSize, style?.headerBackground, style?.headerColor, style?.striped]);
    if (this.themeCache?.key === key) return this.themeCache.theme;
    const density = GRID_DENSITY[style?.density ?? 'compact'];
    const theme = gridTheme.withParams({
      rowHeight: density.rowHeight,
      headerHeight: density.headerHeight,
      spacing: density.spacing,
      fontSize: style?.fontSize ?? density.fontSize,
      headerFontSize: style?.fontSize ?? density.fontSize,
      ...(style?.headerBackground ? { headerBackgroundColor: style.headerBackground } : {}),
      ...(style?.headerColor ? { headerTextColor: style.headerColor } : {}),
      ...(style?.striped ? { oddRowBackgroundColor: 'var(--color-bg-app)' } : {}),
    });
    this.themeCache = { key, theme };
    return theme;
  }

  private themeCache?: { key: string; theme: typeof gridTheme };

  /** The totals row's own colours, from the Totals card. */
  readonly totalRowStyle = (params: RowClassParams): Record<string, string> | undefined => {
    const style = this.item.style;
    const total = params.node.rowPinned === 'bottom' || params.data?.[MATRIX_KIND] === 'total';
    if (!total || (!style?.totalsBackground && !style?.totalsColor)) return undefined;
    return { ...(style.totalsBackground ? { background: style.totalsBackground } : {}), ...(style.totalsColor ? { color: style.totalsColor } : {}) };
  };

  /** The loading skeleton shaped like the object (P8-23). */
  get skeleton(): LoaderType {
    if (this.item.type === 'table' || this.item.type === 'matrix' || this.item.type === 'slicer') return 'skeleton-table';
    return this.item.type === 'tile' && !this.item.gauge ? 'skeleton-tile' : 'skeleton-bars';
  }

  /** The slicer values that match the search. */
  get slicerShown(): string[] {
    const find = this.slicerSearch.trim().toLowerCase();
    return (find ? this.slicerValues.filter(value => this.label(value).toLowerCase().includes(find)) : this.slicerValues).slice(0, SLICER_SHOWN);
  }

  ngOnChanges(): void {
    // A new hierarchy starts again at its top level.
    const levels = JSON.stringify(this.item.dimensions);
    if (levels !== this.drillKey) {
      this.drillKey = levels;
      this.drillPath = [];
    }
    this.problem = itemProblem(this.item);
    // The text or the card's value may have changed; it is fitted once it is drawn.
    if (this.item.type === 'text' || this.item.type === 'tile') setTimeout(() => this.fitText());
    const query = this.query();
    const key = JSON.stringify(query);
    // The token an object is created with is not a request to refresh; only a later change is.
    const refresh = this.seenToken !== undefined && this.refreshToken !== this.seenToken;
    this.seenToken = this.refreshToken;
    // Objects without a query (text, images, incomplete objects) are shown again on every change.
    this.loadHighlight(query);
    if (query && key === this.queryKey && !refresh) {
      this.render();
      return;
    }
    this.queryKey = key;
    this.load(query, refresh);
  }

  /**
   * The rows of the highlighted part, for a highlight on another field than the chart's axis: the same query with the
   * click as a filter. A highlight on the axis field needs no query.
   */
  private loadHighlight(query: QueryRequest | null): void {
    const highlight = this.highlight;
    const wanted = highlight && query && highlight.field !== this.item.dimensions[0]
      ? { ...query, filters: [...(query.filters ?? []), highlight.filter] } : null;
    const key = wanted ? JSON.stringify(wanted) : null;
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    this.highlightRequest?.unsubscribe();
    this.highlightPart = null;
    if (!wanted) return;
    this.highlightRequest = this.modelStudio.runQuery(wanted).subscribe({
      next: part => {
        this.highlightPart = part;
        this.render();
        this.cdr.markForCheck();
      },
      error: () => undefined,
    });
  }

  /** The object's menu offers Export data once it has rows (slicers excepted) and Refresh once it has asked for them. */
  /** Says which filters the rows are not filtered by, when a saved view could not take them. */
  get skippedNote(): string { return skippedFiltersNote(this.result?.skippedFilters, this.labels); }

  get canExport(): boolean { return !!this.result && this.item.type !== 'slicer'; }
  get canRefresh(): boolean { return this.state === 'ready' || this.state === 'error'; }

  /** The object's rows as an Excel file, under the names the object shows; a matrix without its level column. */
  exportExcel(): void {
    const result = this.result;
    if (!result) return;
    rowsToExcel(this.item.title || 'Data', result.columns.filter(column => column !== LEVEL_COLUMN), result.rows, this.labels)
      .catch(() => undefined);
  }

  /** Reads the object's data from the database again, even when the server has it cached. */
  refresh(): void {
    this.load(this.query(), true);
  }

  private query(): QueryRequest | null {
    const view = drillView(this.item, this.drillPath);
    const query = itemQuery(view.item, [...this.filters, ...view.filters]);
    return query && this.draft ? { ...query, draft: true } : query;
  }

  // ── Drill down (a chart whose axis holds several fields) ───────────────────

  get drillable(): boolean { return this.item.type === 'chart' && this.item.dimensions.length > 1; }

  /** The field of the level shown now. */
  get drillField(): string { return drillView(this.item, this.drillPath).item.dimensions[0] ?? ''; }

  get canDrillDown(): boolean { return this.drillPath.length < this.item.dimensions.length - 1; }

  /** The values chosen on the way down, as "action_on (Year): 2026". */
  get drillCrumbs(): string[] {
    return this.drillPath.map((value, i) => `${levelLabel(this.item.dimensions[i], this.labels)}: ${value === null ? '(blank)' : this.drillValue(value)}`);
  }

  levelName(field: string): string { return levelLabel(field, this.labels); }

  /** Changes when the chart's highlight comes, goes or changes, so the chart is drawn again rather than updated. */
  get drawKey(): string { return this.highlight ? `${this.highlight.field}:${JSON.stringify(this.highlight.values)}` : ''; }


  drillUp(): void {
    this.drillPath = this.drillPath.slice(0, -1);
    this.ngOnChanges();
  }

  /** The filters behind what the object shows now, drill level included, for Show records. */
  recordFilters(): QueryFilter[] {
    return [...this.filters, ...drillView(this.item, this.drillPath).filters];
  }

  /** A click on a point drills down in drill mode, while there is a level below; otherwise it is a click for the canvas. */
  private onPoint(value: unknown, additive: boolean): void {
    const text = value === null || value === undefined ? null : String(value);
    if (this.drillMode && this.canDrillDown) {
      this.drillPath = [...this.drillPath, text];
      this.ngOnChanges();
      this.cdr.markForCheck();
      return;
    }
    this.pointClick.emit({ field: this.drillField || this.item.dimensions[0], value, additive });
  }

  private drillValue(value: string): string {
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value;
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.highlightRequest?.unsubscribe();
    this.textObserver?.disconnect();
  }

  /** A slicer value as shown; the raw value is what the filter uses. */
  label(value: string): string { return displayValue(value); }

  get style(): SlicerStyle { return slicerStyle(this.item.slicer); }

  /** The kind of input a range slicer uses. */
  get inputType(): string { return this.fieldKind === 'date' ? 'date' : this.fieldKind === 'number' ? 'number' : 'text'; }

  /** What a dropdown slicer shows while closed. */
  /** True while a dropdown slicer's list is open; the sheet lifts this object above the ones around it so the list shows. */
  @HostBinding('class.canvas-object--dropdown-open') dropdownOpen = false;

  get dropdownText(): string {
    const values = this.item.slicer?.values ?? [];
    if (!values.length) return 'All';
    return values.length === 1 ? this.label(values[0]) : `${values.length} selected`;
  }

  isChosen(value: string): boolean {
    return this.item.slicer?.values.includes(value) ?? false;
  }

  /** Ticks or unticks a value; a single-select slicer keeps one value at most. */
  toggleValue(value: string): void {
    const values = this.item.slicer?.values ?? [];
    const chosen = values.includes(value);
    const next = this.item.slicer?.single ? (chosen ? [] : [value]) : chosen ? values.filter(entry => entry !== value) : [...values, value];
    this.emit({ kind: 'list', values: next });
  }

  setRange(index: 0 | 1, value: string): void {
    const values = [...(this.item.slicer?.values ?? [])];
    while (values.length < 2) values.push('');
    values[index] = value.trim();
    this.emit({ kind: 'range', values: values.slice(0, 2) });
  }

  setRelative(n: string, unit: string): void {
    const count = Math.round(Number(n));
    const last = Number.isFinite(count) && count > 0 ? { n: Math.min(count, 1000), unit: unit as RelativeUnit } : undefined;
    const { last: _old, ...rest } = this.item.slicer ?? { kind: 'relative' as const, values: [] };
    this.slicerChange.emit({ ...rest, kind: 'relative', values: [], ...(last ? { last } : {}) });
  }

  clearSlicer(): void {
    const { last: _old, ...rest } = this.item.slicer ?? { kind: 'list' as const, values: [] };
    this.slicerChange.emit({ ...rest, values: [] });
  }

  // ── Range slider: two thumbs over the field's lowest and highest value ─────

  /** The slider works on numbers: the value itself, or days since 1970 for dates. */
  private toStep(value: string): number {
    if (this.fieldKind === 'date') return Math.round(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86_400_000);
    return Number(value);
  }

  private fromStep(step: number): string {
    if (this.fieldKind === 'date') return new Date(step * 86_400_000).toISOString().slice(0, 10);
    return String(step);
  }

  get canSlide(): boolean {
    return (this.fieldKind === 'number' || this.fieldKind === 'date') && !!this.slicerLow && !!this.slicerHigh
      && Number.isFinite(this.toStep(this.slicerLow)) && this.toStep(this.slicerHigh) > this.toStep(this.slicerLow);
  }

  get slideMin(): number { return this.toStep(this.slicerLow); }
  get slideMax(): number { return this.toStep(this.slicerHigh); }
  get slideStep(): number {
    if (this.fieldKind === 'date') return 1;
    const span = this.slideMax - this.slideMin;
    return Number.isInteger(this.slideMin) && Number.isInteger(this.slideMax) && span >= 100 ? 1 : span / 100;
  }

  slideAt(index: 0 | 1): number {
    const value = this.item.slicer?.kind === 'range' ? this.item.slicer.values[index] : '';
    return value ? this.toStep(value) : index === 0 ? this.slideMin : this.slideMax;
  }

  /** A thumb let go: its value, rounded to the step, and never past the other thumb. */
  slide(index: 0 | 1, raw: string): void {
    let step = Number(raw);
    if (index === 0) step = Math.min(step, this.slideAt(1));
    else step = Math.max(step, this.slideAt(0));
    const atEnd = index === 0 ? step <= this.slideMin : step >= this.slideMax;
    const value = this.fieldKind === 'number' && this.slideStep < 1 ? String(Number(step.toPrecision(6))) : this.fromStep(step);
    this.setRange(index, atEnd ? '' : value);
  }

  /** The value in a range input: what was chosen, else nothing (the placeholder shows the field's end). */
  rangeValue(index: 0 | 1): string {
    const value = this.item.slicer?.kind === 'range' ? this.item.slicer.values[index] ?? '' : '';
    return this.fieldKind === 'date' ? value.slice(0, 10) : value;
  }

  endLabel(value: string): string {
    return this.fieldKind === 'date' ? value.slice(0, 10) : this.fieldKind === 'number' ? formatNumber(Number(value)) : value;
  }

  private emit(change: Pick<SlicerState, 'kind' | 'values'>): void {
    this.slicerChange.emit({ ...(this.item.slicer ?? {}), ...change });
  }

  private load(query: QueryRequest | null, refresh: boolean): void {
    this.request?.unsubscribe();
    this.result = null;
    this.error = null;
    if (!query) {
      this.state = !isDataItem(this.item.type) && !this.problem ? 'static' : 'incomplete';
      return;
    }
    this.state = 'loading';
    this.request = this.modelStudio.runQuery(refresh ? { ...query, refresh: true } : query).subscribe({
      next: result => {
        this.result = result;
        this.limited = query.topN !== undefined && result.rows.length >= query.topN;
        this.state = 'ready';
        this.render();
        this.cdr.markForCheck();
        if (this.item.type === 'tile') setTimeout(() => this.fitText());
      },
      error: err => {
        this.error = readQueryError(err);
        this.state = 'error';
        this.cdr.markForCheck();
      },
    });
  }

  private render(): void {
    const result = this.result;
    if (!result) return;
    // A chart with a hierarchy is drawn at the level it is drilled to.
    const item = drillView(this.item, this.drillPath).item;
    switch (item.type) {
      case 'chart': {
        if (measuresOnAxis(item)) {
          // One bar per measure, each in its own colour; a measure is not a value another visual can be filtered by.
          const view = measureRows(item, result, this.labels);
          const plain = styleChart(chartOptions(view.item, view.result, undefined, paletteFor(item.style, this.theme, this.brandColors)), item.style);
          this.options = {
            ...plain,
            chart: { ...plain.chart, style: { ...(plain.chart?.style ?? {}), fontFamily: 'inherit' } },
            legend: { ...(plain.legend ?? {}), enabled: false },
            series: (plain.series ?? []).map(entry => ({ ...entry, colorByPoint: true } as Highcharts.SeriesOptionsType)),
          };
          this.seriesCut = false;
          break;
        }
        const styled = styleChart(withTooltips(
          withHighlight(
            chartOptions(item, result, (value, additive) => this.onPoint(value, additive),
              paletteFor(item.style, this.theme, this.brandColors)),
            item, result, this.highlight, this.highlightPart),
          item, result, this.labels), item.style);
        // Charts write in the sheet's font, so the brand kit's font reaches them too.
        this.options = { ...styled, chart: { ...styled.chart, style: { ...(styled.chart?.style ?? {}), fontFamily: 'inherit' } } };
        // Measure series show under their canvas names; split series are named by their values and keep them.
        (this.options.series ?? []).forEach(series => { if (series.name && this.labels[series.name]) series.name = this.labels[series.name]; });
        const series = item.series;
        this.seriesCut = !!series && SERIES_CHART_TYPES.includes(item.chartType ?? 'column')
          && new Set(result.rows.map(row => row[series])).size >= MAX_SERIES;
        break;
      }
      case 'tile':
        this.tile = tileView(item, result.rows[0]);
        this.value = this.tile.value;
        this.options = item.gauge ? gaugeOptions(item, result) : null;
        break;
      case 'slicer': {
        const row = result.rows[0] ?? {};
        const end = (value: unknown) => (value === null || value === undefined ? '' : String(value));
        this.slicerLow = end(row[SLICER_LOW]);
        this.slicerHigh = end(row[SLICER_HIGH]);
        this.slicerValues = result.rows.map(entry => entry[item.dimensions[0]])
          .filter(value => value !== null && value !== undefined && value !== '')
          .map(value => String(value));
        break;
      }
      case 'matrix':
        this.rowData = matrixRows(result, item.dimensions, item.style?.totalsLabel || 'Grand total')
          .filter(row => item.style?.subtotals !== false || row[MATRIX_KIND] !== 'subtotal');
        this.totalRow = [];
        this.columnDefs = this.gridColumns(result.columns.filter(column => column !== LEVEL_COLUMN));
        break;
      default: {
        const { rows, total } = tableRows(result, item.dimensions, item.style?.totalsLabel || 'Total');
        this.rowData = rows;
        this.totalRow = total ? [total] : [];
        this.columnDefs = this.gridColumns(result.columns.filter(column => column !== LEVEL_COLUMN));
      }
    }
  }

  private gridColumns(columns: string[]): (ColDef | ColGroupDef)[] {
    const built = canvasGridColumns(columns, new Set(this.item.dimensions), new Set(this.item.measures), this.labels, this.item.format);
    return withCues(withRules(built, this.item.rules), this.rowData, this.item.style);
  }
}

/**
 * Data bars and heatmap shading, as Power BI draws them: each detail cell against the lowest and highest value of its
 * column. Total and subtotal rows are left plain, since they would stretch the scale.
 */
export function withCues(columns: (ColDef | ColGroupDef)[], rows: Record<string, unknown>[], style: ItemStyle | undefined): (ColDef | ColGroupDef)[] {
  const bars = new Set(style?.dataBars ?? []);
  const heat = new Set(style?.heatmap ?? []);
  if (!bars.size && !heat.size) return columns;
  const barColor = style?.barColor ?? '#6366f1';
  const heatColor = style?.heatColor ?? '#16a34a';
  return columns.map(column => {
    if ('children' in column || !column.field || (!bars.has(column.field) && !heat.has(column.field))) return column;
    const field = column.field;
    const values = rows.filter(row => !row[MATRIX_KIND] || row[MATRIX_KIND] === 'detail')
      .map(row => Number(row[field])).filter(Number.isFinite);
    if (!values.length) return column;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const widest = Math.max(Math.abs(low), Math.abs(high)) || 1;
    const cellStyle = (params: CellClassParams): Record<string, string> => {
      const value = Number(params.value);
      const kind = params.data?.[MATRIX_KIND];
      if (params.node.rowPinned || kind === 'total' || kind === 'subtotal' || params.value === null || !Number.isFinite(value)) return {};
      if (bars.has(field)) {
        const width = Math.round((Math.abs(value) / widest) * 100);
        return { backgroundImage: `linear-gradient(90deg, ${barColor}59 ${width}%, transparent ${width}%)` };
      }
      // From a light tint at the lowest value to a strong one at the highest.
      const share = high === low ? 1 : (value - low) / (high - low);
      const alpha = Math.round((0.08 + share * 0.72) * 255).toString(16).padStart(2, '0');
      return { backgroundColor: `${heatColor}${alpha}` };
    };
    return { ...column, cellStyle: cellStyle as ColDef['cellStyle'] };
  });
}

/** Cells coloured by the first rule of their column that they meet (P10-10). */
function withRules(columns: (ColDef | ColGroupDef)[], rules: FormatRule[] | undefined): (ColDef | ColGroupDef)[] {
  if (!rules?.length) return columns;
  return columns.map(column => {
    if ('children' in column || !column.field || !rules.some(rule => rule.field === column.field)) return column;
    const field = column.field;
    const toned = (tone: string) => (params: CellClassParams) => ruleTone(rules, field, params.value) === tone;
    return {
      ...column,
      cellClassRules: {
        ...column.cellClassRules,
        'canvas-object__cell--good': toned('good'),
        'canvas-object__cell--warn': toned('warn'),
        'canvas-object__cell--bad': toned('bad'),
      },
    };
  });
}

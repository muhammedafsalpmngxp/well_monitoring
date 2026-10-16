import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { DatasetDetail, ModelStudioService } from '../../../core/services/model-studio.service';
import { dataPaneTables } from '../../model-studio/model-studio.util';
import { CanvasItem, SLICER_VALUE_LIMIT, isDataItem } from '../canvas-config.util';
import {
  CanvasFilter, FieldKind, FilterOp, MAX_FILTERS, OP_LABELS, TOP_FNS, TopFn, fieldLabel, filterSummary, newFilter, opsFor, valueCount,
} from '../canvas-filter.util';
import { displayValue } from '../canvas-format.util';
import { DataDrag } from '../canvas-wells.util';

export type FilterScope = 'visual' | 'page' | 'canvas';

interface FieldOption { key: string; kind: FieldKind; }
/** What a Top N filter can rank by: a measure, or the sum, average, minimum or maximum of a numeric field. */
interface Ranker { key: string; label: string; measure: string; fn?: TopFn; }

/** The values of a field for basic filtering, read once per field while the pane is open. */
type ValueList = { state: 'loading' } | { state: 'ready'; values: string[] } | { state: 'error' };

/**
 * The canvas Filters pane, as in Power BI: filters on the selected visual, on the open sheet and on all sheets. A
 * field is dragged in from the Data pane or chosen from the list under each section. Basic filtering ticks values;
 * advanced filtering sets one condition. The filters are part of the canvas and are saved with it.
 */
@Component({
  selector: 'app-canvas-filters',
  standalone: false,
  templateUrl: './canvas-filters.component.html',
  styleUrls: ['./canvas-filters.component.scss'],
})
export class CanvasFiltersComponent implements OnChanges, OnDestroy {
  @Input() item: CanvasItem | null = null;
  @Input() pageFilters: CanvasFilter[] = [];
  @Input() canvasFilters: CanvasFilter[] = [];
  @Input() dataset: DatasetDetail | null = null;
  @Input() columns: ReadonlyMap<string, DbSchemaColumn[]> = new Map();
  /** A canvas being edited reads the dataset's draft, as its objects do. */
  @Input() draft = true;
  @Input() dragging: DataDrag | null = null;
  /** Canvas-only names of fields, from the Data pane's menu. */
  @Input() labels: Record<string, string> = {};
  @Output() itemChange = new EventEmitter<CanvasItem>();
  @Output() pageFiltersChange = new EventEmitter<CanvasFilter[]>();
  @Output() canvasFiltersChange = new EventEmitter<CanvasFilter[]>();
  @Output() collapse = new EventEmitter<void>();

  readonly opLabels = OP_LABELS;
  readonly fieldLabel = (field: string): string => this.labels[field] ?? fieldLabel(field);
  readonly display = displayValue;
  readonly valueCount = valueCount;
  readonly opsFor = opsFor;
  readonly scopeTitles: Record<FilterScope, string> = {
    visual: 'Filters on this visual', page: 'Filters on this page', canvas: 'Filters on all pages',
  };

  fields: FieldOption[] = [];
  /** The open filter cards, as "scope:index". */
  open = new Set<string>();
  /** The section a field is being dragged over. */
  over: FilterScope | null = null;
  search: Record<string, string> = {};
  private readonly values = new Map<string, ValueList>();
  private readonly requests: Subscription[] = [];

  constructor(private readonly modelStudio: ModelStudioService, private readonly cdr: ChangeDetectorRef) {}

  readonly scopes: FilterScope[] = ['visual', 'page', 'canvas'];

  /** Filters on a visual need a chart, card, table, matrix or slicer selected on the sheet. */
  get visualSelected(): boolean { return !!this.item && isDataItem(this.item.type); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dataset'] || changes['columns']) {
      this.fields = this.dataset
        ? dataPaneTables(this.dataset, this.columns, '', true).flatMap(table =>
          table.fields.map(field => ({ key: `${table.source.alias}.${field.name}`, kind: field.kind as FieldKind })))
        : [];
      this.values.clear();
    }
    if (changes['item'] && changes['item'].previousValue?.id !== changes['item'].currentValue?.id) {
      [...this.open].filter(key => key.startsWith('visual:')).forEach(key => this.open.delete(key));
    }
  }

  ngOnDestroy(): void {
    this.requests.forEach(request => request.unsubscribe());
  }

  filtersOf(scope: FilterScope): CanvasFilter[] {
    if (scope === 'visual') return this.item?.filters ?? [];
    return scope === 'page' ? this.pageFilters : this.canvasFilters;
  }

  summary(filter: CanvasFilter): string {
    return filterSummary(filter, displayValue);
  }

  isOpen(scope: FilterScope, index: number): boolean { return this.open.has(`${scope}:${index}`); }

  toggle(scope: FilterScope, index: number): void {
    const key = `${scope}:${index}`;
    if (this.open.has(key)) this.open.delete(key);
    else {
      this.open.add(key);
      const filter = this.filtersOf(scope)[index];
      if (filter?.mode === 'basic') this.loadValues(filter.field);
    }
  }

  // ── Adding and removing ────────────────────────────────────────────────────

  dragOver(scope: FilterScope, event: DragEvent): void {
    if (this.dragging?.kind !== 'field') return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.over = scope;
  }

  drop(scope: FilterScope, event: DragEvent): void {
    event.preventDefault();
    this.over = null;
    const drag = this.dragging;
    if (drag?.kind === 'field') this.add(scope, drag.name, drag.fieldKind ?? this.kindOf(drag.name));
  }

  addFromList(scope: FilterScope, select: HTMLSelectElement): void {
    const key = select.value;
    select.value = '';
    if (key) this.add(scope, key, this.kindOf(key));
  }

  /** A new filter opens at once, with its values loading, as Power BI does. */
  add(scope: FilterScope, field: string, kind: FieldKind): void {
    const current = this.filtersOf(scope);
    if (current.length >= MAX_FILTERS) return;
    this.write(scope, [...current, newFilter(field, kind)]);
    this.open.add(`${scope}:${current.length}`);
    this.loadValues(field);
  }

  remove(scope: FilterScope, index: number): void {
    this.write(scope, this.filtersOf(scope).filter((_, i) => i !== index));
    // The cards after it move up one place.
    const prefix = `${scope}:`;
    const kept = [...this.open].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length)));
    kept.forEach(i => this.open.delete(prefix + i));
    kept.filter(i => i !== index).forEach(i => this.open.add(prefix + (i > index ? i - 1 : i)));
  }

  clear(scope: FilterScope, index: number): void {
    const filter = this.filtersOf(scope)[index];
    this.change(scope, index, { values: [], exclude: undefined, op: filter.mode === 'advanced' ? opsFor(filter.kind)[0] : undefined,
      value: undefined, value2: undefined, second: undefined, top: undefined, mode: filter.mode });
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  setMode(scope: FilterScope, index: number, mode: 'basic' | 'advanced' | 'top'): void {
    const filter = this.filtersOf(scope)[index];
    const cleared = { op: undefined, value: undefined, value2: undefined, second: undefined, top: undefined, values: [], exclude: undefined };
    this.change(scope, index, mode === 'basic' ? { ...cleared, mode }
      : mode === 'advanced' ? { ...cleared, mode, op: opsFor(filter.kind)[0] }
        : { ...cleared, mode, top: { direction: 'top', count: 5, ...this.defaultRanker(filter.field) } });
    if (mode === 'basic') this.loadValues(filter.field);
  }

  /** What a Top N filter ranks by: the dataset's measures, then the sum, average, minimum and maximum of each numeric field. */
  get rankers(): Ranker[] {
    const measures = (this.dataset?.measures ?? []).map(m => ({ key: m.name, label: m.name, measure: m.name }));
    const numbers = this.fields.filter(field => field.kind === 'number').flatMap(field =>
      (Object.keys(TOP_FNS) as TopFn[]).map(fn => ({ key: `${fn}|${field.key}`, label: `${TOP_FNS[fn]} of ${fieldLabel(field.key)}`, measure: field.key, fn })));
    return [...measures, ...numbers];
  }

  /**
   * The ranking a new Top N filter starts with: a measure of the field's own table, else the sum of one of its numeric
   * columns, else the first there is. A measure of another table can count rows twice across the join and be refused.
   */
  private defaultRanker(field: string): { measure: string; fn?: TopFn } {
    const alias = field.slice(0, field.indexOf('.'));
    const home = this.dataset?.sources.find(source => source.alias === alias)?.id;
    const own = this.dataset?.measures.find(m => m.homeSourceId === home);
    const column = this.rankers.find(r => r.fn === 'sum' && r.measure.startsWith(alias + '.'));
    const ranker: { measure: string; fn?: TopFn } | undefined = own ? { measure: own.name } : column ?? this.rankers[0];
    return { measure: ranker?.measure ?? '', fn: ranker?.fn };
  }

  rankerKey(filter: CanvasFilter): string {
    return filter.top?.fn ? `${filter.top.fn}|${filter.top.measure}` : filter.top?.measure ?? '';
  }

  setRanker(scope: FilterScope, index: number, key: string): void {
    const ranker = this.rankers.find(r => r.key === key);
    if (ranker) this.setTop(scope, index, { measure: ranker.measure, fn: ranker.fn });
  }

  setTop(scope: FilterScope, index: number, patch: Partial<NonNullable<CanvasFilter['top']>>): void {
    const top = this.filtersOf(scope)[index].top ?? { direction: 'top' as const, count: 5, measure: this.rankers[0]?.measure ?? '', fn: this.rankers[0]?.fn };
    const next = { ...top, ...patch };
    this.change(scope, index, { top: { ...next, count: Math.min(1000, Math.max(1, Math.round(Number(next.count)) || 1)) } });
  }

  /** The second advanced condition: And or Or, its comparison and its values; no join removes it. */
  setSecond(scope: FilterScope, index: number, patch: { join?: string; op?: FilterOp; value?: string; value2?: string }): void {
    const filter = this.filtersOf(scope)[index];
    if (patch.join === '') { this.change(scope, index, { second: undefined }); return; }
    const second = filter.second ?? { join: 'and' as const, op: opsFor(filter.kind)[0] };
    const next = { ...second, ...patch, join: (patch.join ?? second.join) as 'and' | 'or' };
    (['value', 'value2'] as const).forEach(key => { if (!next[key]?.trim()) delete next[key]; });
    this.change(scope, index, { second: next });
  }

  setOp(scope: FilterScope, index: number, op: FilterOp): void {
    this.change(scope, index, { op, ...(valueCount(op) === 0 ? { value: undefined, value2: undefined } : {}) });
  }

  setValue(scope: FilterScope, index: number, which: 'value' | 'value2', value: string): void {
    this.change(scope, index, { [which]: value.trim() || undefined });
  }

  toggleValue(scope: FilterScope, index: number, value: string): void {
    const values = this.filtersOf(scope)[index].values;
    this.change(scope, index, { values: values.includes(value) ? values.filter(v => v !== value) : [...values, value] });
  }

  /** Select all ticks every listed value that matches the search; when all are ticked it clears them. */
  toggleAll(scope: FilterScope, index: number): void {
    const filter = this.filtersOf(scope)[index];
    const shown = this.shown(scope, index);
    const all = shown.length > 0 && shown.every(value => filter.values.includes(value));
    this.change(scope, index, {
      values: all ? filter.values.filter(v => !shown.includes(v)) : [...new Set([...filter.values, ...shown])],
    });
  }

  setExclude(scope: FilterScope, index: number, exclude: boolean): void {
    this.change(scope, index, { exclude: exclude || undefined });
  }

  // ── Values ─────────────────────────────────────────────────────────────────

  valueState(field: string): ValueList['state'] { return this.values.get(field)?.state ?? 'loading'; }

  /** The field's values that match the card's search. */
  shown(scope: FilterScope, index: number): string[] {
    const filter = this.filtersOf(scope)[index];
    const list = this.values.get(filter.field);
    const values = list?.state === 'ready' ? list.values : [];
    const find = (this.search[`${scope}:${index}`] ?? '').trim().toLowerCase();
    return find ? values.filter(value => displayValue(value).toLowerCase().includes(find)) : values;
  }

  allTicked(scope: FilterScope, index: number): boolean {
    const shown = this.shown(scope, index);
    const values = this.filtersOf(scope)[index].values;
    return shown.length > 0 && shown.every(value => values.includes(value));
  }

  inputType(kind: FieldKind, op: FilterOp | undefined): string {
    if (op?.startsWith('last_')) return 'number';
    return kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text';
  }

  private loadValues(field: string): void {
    const datasetId = this.dataset?.id;
    const state = this.values.get(field)?.state;
    if (datasetId === undefined || state === 'ready' || state === 'loading') return;
    this.values.set(field, { state: 'loading' });
    this.requests.push(this.modelStudio.runQuery({
      datasetId, dimensions: [field], measures: [], topN: SLICER_VALUE_LIMIT, sort: { field, descending: false }, ...(this.draft ? { draft: true } : {}),
    }).subscribe({
      next: result => {
        const values = result.rows.map(row => row[field])
          .filter(value => value !== null && value !== undefined && value !== '')
          .map(value => String(value));
        this.values.set(field, { state: 'ready', values });
        this.cdr.markForCheck();
      },
      error: () => {
        this.values.set(field, { state: 'error' });
        this.cdr.markForCheck();
      },
    }));
  }

  private kindOf(field: string): FieldKind {
    return this.fields.find(option => option.key === field)?.kind ?? 'text';
  }

  private change(scope: FilterScope, index: number, patch: Partial<CanvasFilter>): void {
    const next = this.filtersOf(scope).map((filter, i) => {
      if (i !== index) return filter;
      const merged: CanvasFilter = { ...filter, ...patch };
      // Unset settings are left out, so the saved canvas holds only what was chosen.
      (Object.keys(merged) as (keyof CanvasFilter)[]).forEach(key => merged[key] === undefined && delete merged[key]);
      return merged;
    });
    this.write(scope, next);
  }

  private write(scope: FilterScope, filters: CanvasFilter[]): void {
    if (scope === 'visual' && this.item) {
      const { filters: _old, ...rest } = this.item;
      this.itemChange.emit(filters.length ? { ...rest, filters } : rest);
    } else if (scope === 'page') this.pageFiltersChange.emit(filters);
    else if (scope === 'canvas') this.canvasFiltersChange.emit(filters);
  }
}

import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  AddRelationshipBody, Cardinality, DatasetDetail, DatasetRelationship, DatasetSource, ModelStudioService,
} from '../../../core/services/model-studio.service';

/** How rows match, as the dialog offers it; one to many is saved as many to one from the other side. */
export type RelationshipShape = 'many_to_one' | 'one_to_many' | 'one_to_one';

export interface RelationshipEnd { sourceId: number | null; column: string | null; }

/** The relationship as the server stores it: from is the many side of many to one. */
export function relationshipBody(from: RelationshipEnd, to: RelationshipEnd, shape: RelationshipShape): AddRelationshipBody | null {
  if (from.sourceId === null || to.sourceId === null || !from.column || !to.column) return null;
  const [many, one] = shape === 'one_to_many' ? [to, from] : [from, to];
  const cardinality: Cardinality = shape === 'one_to_one' ? 'one_to_one' : 'many_to_one';
  return { fromSourceId: many.sourceId!, fromColumn: many.column!, toSourceId: one.sourceId!, toColumn: one.column!, cardinality, detectedFrom: 'user' };
}

/** True when the body joins the same columns as the stored relationship, so only its cardinality may differ. */
export function sameEnds(body: AddRelationshipBody, relationship: DatasetRelationship): boolean {
  return body.fromSourceId === relationship.fromSourceId && body.fromColumn === relationship.fromColumn
    && body.toSourceId === relationship.toSourceId && body.toColumn === relationship.toColumn;
}

/** The first rows of a table for the dialog, or why they could not be read. */
interface TablePreview { state: 'loading' | 'ready' | 'error'; columns: string[]; rows: Record<string, unknown>[]; }

/** Whether a column holds each value once: unknown while it is being counted. */
type Uniqueness = 'checking' | 'unique' | 'repeated' | 'unknown';

/**
 * New and edit relationship, as Power BI's side panel: the From and To tables with their first rows, where a click
 * on a column chooses it; how rows match. It counts the values of each chosen column, so it can warn when the one side
 * of a relationship repeats values, which would count rows twice.
 */
@Component({
  selector: 'app-relationship-dialog',
  standalone: false,
  templateUrl: './relationship-dialog.component.html',
  styleUrls: ['./relationship-dialog.component.scss'],
})
export class RelationshipDialogComponent implements OnInit, OnDestroy {
  @Input({ required: true }) dataset!: DatasetDetail;
  /** The relationship to edit; null for a new one. */
  @Input() relationship: DatasetRelationship | null = null;
  @Input() saving = false;
  @Input() serverError = '';
  @Output() save = new EventEmitter<AddRelationshipBody>();
  @Output() cancelled = new EventEmitter<void>();

  from: RelationshipEnd = { sourceId: null, column: null };
  to: RelationshipEnd = { sourceId: null, column: null };
  shape: RelationshipShape = 'many_to_one';
  readonly previews = new Map<number, TablePreview>();
  readonly uniqueness: Record<'from' | 'to', Uniqueness> = { from: 'unknown', to: 'unknown' };
  private readonly requests: Subscription[] = [];

  constructor(private readonly modelStudio: ModelStudioService, private readonly cdr: ChangeDetectorRef) {}

  get title(): string { return this.relationship ? 'Edit relationship' : 'New relationship'; }
  get body(): AddRelationshipBody | null { return relationshipBody(this.from, this.to, this.shape); }

  ngOnInit(): void {
    const relationship = this.relationship;
    if (relationship) {
      this.from = { sourceId: relationship.fromSourceId, column: relationship.fromColumn };
      this.to = { sourceId: relationship.toSourceId, column: relationship.toColumn };
      this.shape = relationship.cardinality;
    } else {
      const [first, second] = this.dataset.sources;
      this.from = { sourceId: first?.id ?? null, column: null };
      this.to = { sourceId: second?.id ?? null, column: null };
    }
    for (const side of ['from', 'to'] as const) {
      const end = this[side];
      if (end.sourceId !== null) this.loadPreview(end.sourceId);
      if (end.column) this.checkUnique(side);
    }
  }

  ngOnDestroy(): void {
    this.requests.forEach(request => request.unsubscribe());
  }

  endOf(side: string): RelationshipEnd { return side === 'from' ? this.from : this.to; }
  sideOf(side: string): 'from' | 'to' { return side === 'from' ? 'from' : 'to'; }

  source(id: number | null): DatasetSource | undefined { return this.dataset.sources.find(source => source.id === id); }
  preview(id: number | null): TablePreview | undefined { return id === null ? undefined : this.previews.get(id); }

  chooseTable(side: 'from' | 'to', value: string): void {
    const sourceId = value ? Number(value) : null;
    this[side] = { sourceId, column: null };
    this.uniqueness[side] = 'unknown';
    if (sourceId !== null) this.loadPreview(sourceId);
  }

  chooseColumn(side: 'from' | 'to', column: string): void {
    this[side] = { ...this[side], column };
    this.checkUnique(side);
  }

  /**
   * What stops the save, then what only warns. The one side of a relationship (both sides of one to one) must hold
   * each value once; repeated values there count the many side's rows more than once.
   */
  get problems(): { blocking: string[]; warnings: string[] } {
    const blocking: string[] = [];
    const warnings: string[] = [];
    if (this.from.sourceId === null || this.to.sourceId === null) blocking.push('Choose both tables.');
    else if (this.from.sourceId === this.to.sourceId) blocking.push('Choose two different tables.');
    if (!this.from.column || !this.to.column) blocking.push('Click the matching column in each table.');
    const one: ('from' | 'to')[] = this.shape === 'one_to_one' ? ['from', 'to'] : [this.shape === 'one_to_many' ? 'from' : 'to'];
    for (const side of one) {
      if (this.uniqueness[side] !== 'repeated') continue;
      const end = this[side];
      warnings.push(`${this.source(end.sourceId)?.alias}.${end.column} repeats values, so it cannot be the "one" side. `
        + 'Totals would count the other table\'s rows more than once. Choose a column with one row per value, or swap the direction.');
    }
    return { blocking, warnings };
  }

  /** Swaps the two tables, their columns and what is known about them. */
  swap(): void {
    [this.from, this.to] = [this.to, this.from];
    [this.uniqueness.from, this.uniqueness.to] = [this.uniqueness.to, this.uniqueness.from];
  }

  submit(): void {
    const body = this.body;
    if (body && !this.problems.blocking.length) this.save.emit(body);
  }

  private loadPreview(sourceId: number): void {
    if (this.previews.has(sourceId)) return;
    const source = this.source(sourceId);
    if (!source) return;
    this.previews.set(sourceId, { state: 'loading', columns: [], rows: [] });
    this.requests.push(this.modelStudio.previewSource(this.dataset.id, {
      kind: source.kind ?? 'table', schemaName: source.schemaName, sourceName: source.sourceName,
    }).subscribe({
      next: result => {
        this.previews.set(sourceId, { state: 'ready', columns: result.columns, rows: result.rows.slice(0, 3) });
        this.cdr.markForCheck();
      },
      error: () => {
        this.previews.set(sourceId, { state: 'error', columns: [], rows: [] });
        this.cdr.markForCheck();
      },
    }));
  }

  /** Counts the column's values and its distinct values on the dataset as it is being edited. */
  private checkUnique(side: 'from' | 'to'): void {
    const end = this[side];
    const alias = this.source(end.sourceId)?.alias;
    if (!alias || !end.column) return;
    this.uniqueness[side] = 'checking';
    const field = `${alias}.${end.column}`;
    const column = end.column;
    this.requests.push(this.modelStudio.runQuery({
      datasetId: this.dataset.id, dimensions: [], measures: ['Rows', 'Distinct'], draft: true,
      values: [{ name: 'Rows', field, fn: 'count' }, { name: 'Distinct', field, fn: 'count_distinct' }],
    }).subscribe({
      next: result => {
        if (this[side].column !== column) return;
        const row = result.rows[0] ?? {};
        this.uniqueness[side] = Number(row['Rows']) > Number(row['Distinct']) ? 'repeated' : 'unique';
        this.cdr.markForCheck();
      },
      // A column the dataset cannot count yet is simply not checked; the save still goes ahead.
      error: () => {
        if (this[side].column !== column) return;
        this.uniqueness[side] = 'unknown';
        this.cdr.markForCheck();
      },
    }));
  }
}

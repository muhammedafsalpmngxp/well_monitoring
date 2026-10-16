import { AfterViewInit, ChangeDetectorRef, Component, DoCheck, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { AggregateFn, BinaryOp, ConditionOp, DatasetDetail, DatasetMeasure, MeasureNode, ModelStudioService } from '../../../core/services/model-studio.service';
import { LiveFormulaCheck } from '../live-formula-check';
import { SuggestField } from '../field-suggest/field-suggest.util';
import { ExampleColumns } from '../function-list/formula-functions';
import { FormulaError, parseMeasure, printMeasure } from '../../../core/utils/measure-syntax.util';
import {
  AGGREGATE_LABELS, COMPARISON_LABELS, OPERATOR_LABELS, columnFitsAggregate, describeMeasure, fieldColumns, fieldKind, keepFocusInside,
} from '../model-studio.util';
import {
  FormulaPart, FormulaStart, SavedMeasure, VisualFormula, blankFormula, buildVisual, emptyPart, insertText, textToVisual, toVisual, visualToText,
} from './formula-builder.util';

export type FormulaMode = 'visual' | 'text';

/**
 * Dialog for adding or editing a measure. The visual mode and the text mode edit the same tree:
 * switching converts through the tree, and is refused rather than allowed to change it.
 */
@Component({
  selector: 'app-formula-builder',
  standalone: false,
  templateUrl: './formula-builder.component.html',
  styleUrls: ['./formula-builder.component.scss'],
})
export class FormulaBuilderComponent implements OnInit, AfterViewInit, DoCheck, OnDestroy {
  @Input() dataset!: DatasetDetail;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  /** The measure to edit, or null for a new one. */
  @Input() measure: DatasetMeasure | null = null;
  @Input() saving = false;
  /** Why the server refused the last save; shown inside the dialog. */
  @Input() serverError = '';
  /** A quick measure to open a new measure with; ignored when editing. */
  @Input() start: FormulaStart | null = null;
  /** Shown under the title, for example that the change reaches every canvas on the dataset. */
  @Input() notice = '';
  /** A new measure opens in the text mode, where "[" lists the fields of every table. */
  @Input() startInText = false;
  @Output() save = new EventEmitter<SavedMeasure>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;
  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('textInput') textInput?: ElementRef<HTMLTextAreaElement>;

  // COUNTROWS takes a table, not a column, so the visual mode leaves it to the text mode.
  readonly aggregates = (Object.entries(AGGREGATE_LABELS) as [AggregateFn, string][]).filter(([fn]) => fn !== 'count_rows');
  readonly operators = Object.entries(OPERATOR_LABELS) as [BinaryOp, string][];
  readonly comparisons = Object.entries(COMPARISON_LABELS) as [ConditionOp, string][];

  name = '';
  mode: FormulaMode = 'visual';
  visual!: VisualFormula;
  text = '';
  /** Why the visual formula, or the name, cannot be saved yet. */
  problem = '';
  textError: FormulaError | null = null;
  /** Every field of every table, for the list that "[" opens in the text mode. */
  suggestFields: SuggestField[] = [];
  /** The table and columns the function examples are written with: the first table with a number column. */
  exampleColumns: ExampleColumns | null = null;

  // Focus goes back here when the dialog closes.
  private readonly opener = document.activeElement as HTMLElement | null;
  /** The server's checks of Save, run while the formula is edited. */
  readonly check: LiveFormulaCheck;

  constructor(private readonly models: ModelStudioService, cdr: ChangeDetectorRef) {
    this.check = new LiveFormulaCheck(() => cdr.markForCheck());
  }

  ngOnInit(): void {
    this.suggestFields = this.dataset.sources.flatMap(source => fieldColumns(this.dataset, this.columns, source).map(column => ({
      insert: `${source.alias}.${column.columnName}`, table: source.alias, name: column.columnName,
      kind: fieldKind(column.dataType), calculated: column.id < 0,
    })));
    // Other measures, written [Name]; the server puts their formula in place.
    this.suggestFields = [...this.dataset.measures.filter(m => m.id !== this.measure?.id).map((m): SuggestField => ({
      insert: `[${m.name.replace(/]/g, ']]')}]`, table: 'Measure', name: m.name, kind: 'number', calculated: false, measure: true,
    })), ...this.suggestFields];
    const facts = this.dataset.sources.find(source => this.suggestFields.some(f => f.table === source.alias && f.kind === 'number'))
      ?? this.dataset.sources[0];
    if (facts) {
      const stored = fieldColumns(this.dataset, this.columns, facts);
      const isKey = (name: string) => /_id$/i.test(name) || stored.some(c => c.columnName === name && (c.isPrimaryKey || c.isForeignKey));
      const own = this.suggestFields.filter(f => f.table === facts.alias);
      const firstOf = (kind: string) => (own.find(f => f.kind === kind && !isKey(f.name)) ?? own.find(f => f.kind === kind))?.name;
      const key = stored.find(c => c.isPrimaryKey)?.columnName;
      this.exampleColumns = { table: facts.alias, number: firstOf('number'), text: firstOf('text'), date: firstOf('date'), key: key ?? firstOf('number') };
    }
    this.name = this.measure?.name ?? '';
    const expression = this.measure?.expression ?? null;
    const visual = expression ? toVisual(expression) : null;
    this.text = expression ? printMeasure(expression) : '';
    this.visual = visual ?? blankFormula(this.firstAlias);
    // A formula the visual mode cannot show opens as text.
    this.mode = (expression && !visual) || (!expression && this.startInText) ? 'text' : 'visual';
    if (!this.measure && this.start) {
      this.name = this.start.name;
      this.visual = this.start.visual;
    }
  }

  ngAfterViewInit(): void {
    this.nameInput?.nativeElement.focus();
  }

  /** Every edit ends in a change detection, so this sees each complete formula once and asks the server about it. */
  ngDoCheck(): void {
    const node = this.currentNode();
    const name = this.name.trim();
    this.check.update(node ? JSON.stringify([name, node]) : null,
      () => this.models.checkMeasure(this.dataset.id, name, node!, this.measure?.id ?? null));
  }

  ngOnDestroy(): void {
    this.check.destroy();
    // A successful save reloads the dataset before this dialog closes, in the same change-detection
    // cycle that re-renders the inspector. Destruction runs first, so focusing now would target a
    // button about to be refreshed; queueMicrotask waits for that cycle, and the re-render, to finish.
    queueMicrotask(() => this.opener?.focus());
  }

  get title(): string {
    return this.measure ? `Edit ${this.measure.name}` : 'New measure';
  }

  /** The formula read back as a sentence. */
  get sentence(): string {
    const node = this.currentNode();
    return node ? describeMeasure(node) : 'Complete the formula to see how it reads.';
  }

  /** The formula as it stands, in whichever mode is open, or null while it is incomplete. */
  private currentNode(): MeasureNode | null {
    if (this.mode === 'text') {
      const parsed = parseMeasure(this.text);
      return parsed.ok ? parsed.node : null;
    }
    const built = buildVisual(this.visual);
    return 'node' in built ? built.node : null;
  }

  /** In the text mode, the formula's first problem as it is typed, or the one Save found. Nothing for an empty formula until Save. */
  get shownError(): FormulaError | null {
    if (this.textError) return this.textError;
    if (this.mode !== 'text' || !this.text.trim()) return null;
    const parsed = parseMeasure(this.text);
    return parsed.ok ? null : parsed.error;
  }

  /** A field chosen from the list "[" opened: the new text, with the cursor after the field. */
  applySuggestion(next: { text: string; caret: number }): void {
    this.text = next.text;
    this.textError = null;
    this.clearServerError();
    const input = this.textInput?.nativeElement;
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
  }

  /** Puts a function's example in the formula at the cursor, or at the end, in place of any selection. */
  insertExample(example: string): void {
    const input = this.textInput?.nativeElement;
    const next = insertText(this.text, input?.selectionStart ?? this.text.length, input?.selectionEnd ?? this.text.length, example);
    this.text = next.text;
    this.textError = null;
    this.clearServerError();
    // ponytail: after the change detection that writes the new text into the box; a timer, not a microtask,
    // because the zoneless scheduler may run after a microtask.
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
  }

  get rightPart(): FormulaPart | null {
    return this.visual.right.kind === 'agg' ? this.visual.right.part : null;
  }

  get rightNumber(): number | null {
    return this.visual.right.kind === 'num' ? this.visual.right.value : null;
  }

  set rightNumber(value: number | null) {
    this.visual.right = { kind: 'num', value };
  }

  /** Columns the part's calculation can use: sum and average take number columns only. */
  columnsFor(part: FormulaPart): DbSchemaColumn[] {
    return this.columnsOf(part.source).filter(c => columnFitsAggregate(part.fn, c.dataType ?? ''));
  }

  /**
   * Calculated columns are new objects on every call, so options are kept by name; recreating them on each
   * check makes the select write its value again and change detection never settles (NG0103).
   */
  trackColumn(_index: number, column: DbSchemaColumn): string {
    return column.columnName;
  }

  /** The table's columns and its calculated columns: a measure uses either the same way. */
  columnsOf(alias: string): DbSchemaColumn[] {
    const source = this.dataset.sources.find(s => s.alias === alias);
    return source ? fieldColumns(this.dataset, this.columns, source) : [];
  }

  /** A column chosen for another calculation may not fit sum or average. */
  setFn(part: FormulaPart, fn: AggregateFn): void {
    part.fn = fn;
    if (!this.columnsFor(part).some(c => c.columnName === part.column)) part.column = '';
  }

  setSource(part: FormulaPart, alias: string): void {
    part.source = alias;
    part.column = '';
    if (part.where) part.where.column = '';
  }

  setCondition(part: FormulaPart, on: boolean): void {
    part.where = on ? { column: '', op: 'eq', value: '' } : null;
  }

  setRightKind(kind: 'agg' | 'num'): void {
    this.visual.right = kind === 'num' ? { kind: 'num', value: null } : { kind: 'agg', part: emptyPart(this.visual.left.source) };
  }

  showText(): void {
    if (this.mode === 'text') return;
    const result = visualToText(this.visual);
    if ('problem' in result) {
      this.problem = result.problem;
      return;
    }
    this.problem = '';
    this.text = result.text;
    this.textError = null;
    this.mode = 'text';
  }

  showVisual(): void {
    if (this.mode === 'visual') return;
    const result = textToVisual(this.text, this.firstAlias);
    if ('error' in result) {
      this.showTextError(result.error);
      return;
    }
    this.visual = result.visual;
    this.textError = null;
    this.problem = '';
    this.mode = 'visual';
  }

  /** A fresh edit means a server refusal shown for the previous attempt no longer applies. */
  clearServerError(): void {
    this.serverError = '';
  }

  submit(): void {
    this.problem = '';
    const name = this.name.trim();
    if (!name) {
      this.problem = 'Give the measure a name.';
      return;
    }
    const expression = this.expression();
    if (expression) this.save.emit({ name, expression });
  }

  /** Escape closes; Tab and Shift+Tab stay inside the dialog. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // The field list closes on Escape first and marks the key as handled.
      if (event.defaultPrevented) return;
      event.preventDefault();
      this.cancelled.emit();
      return;
    }
    if (this.dialog) keepFocusInside(event, this.dialog.nativeElement);
  }

  private expression(): MeasureNode | null {
    if (this.mode === 'text') {
      const parsed = parseMeasure(this.text);
      if (parsed.ok) return parsed.node;
      this.showTextError(parsed.error);
      return null;
    }
    const built = buildVisual(this.visual);
    if ('node' in built) return built.node;
    this.problem = built.problem;
    return null;
  }

  /** Shows the message and selects the characters it is about. */
  private showTextError(error: FormulaError): void {
    this.textError = error;
    const input = this.textInput?.nativeElement;
    input?.focus();
    input?.setSelectionRange(error.start, error.end);
  }

  private get firstAlias(): string {
    return this.dataset.sources[0]?.alias ?? '';
  }
}

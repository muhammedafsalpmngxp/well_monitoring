import { AfterViewInit, ChangeDetectorRef, Component, DoCheck, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { ConditionOp, DatasetCalculatedColumn, DatasetDetail, DatasetSource, ModelStudioService } from '../../../core/services/model-studio.service';
import { LiveFormulaCheck } from '../live-formula-check';
import { SuggestField } from '../field-suggest/field-suggest.util';
import { FormulaError, parseRowExpression, printMeasure } from '../../../core/utils/measure-syntax.util';
import { SavedMeasure, insertText } from '../formula-builder/formula-builder.util';
import { COMPARISON_LABELS, columnFitsAggregate, describeMeasure, fieldColumns, fieldKind, keepFocusInside } from '../model-studio.util';
import { BinsSpec, Built, ConditionRule, binsFormula, conditionalFormula } from './column-builders.util';
import { ExampleColumns } from '../function-list/formula-functions';

/**
 * Dialog for adding or editing a calculated column of one table: a name, and a formula on one row written
 * as text. It needs only the dataset, the catalogue columns and the table, and reports through save and
 * cancelled, so any Model Studio page can open it.
 */
// ponytail: text mode only; a visual mode for row formulas waits until users ask for one.
@Component({
  selector: 'app-calculated-column-dialog',
  standalone: false,
  templateUrl: './calculated-column-dialog.component.html',
  // The formula builder's dialog styles: both dialogs look and behave alike.
  styleUrls: ['../formula-builder/formula-builder.component.scss'],
})
export class CalculatedColumnDialogComponent implements OnInit, AfterViewInit, DoCheck, OnDestroy {
  @Input() dataset!: DatasetDetail;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  @Input() source!: DatasetSource;
  /** The column to edit, or null for a new one. */
  @Input() column: DatasetCalculatedColumn | null = null;
  @Input() saving = false;
  /** Why the server refused the last save; shown inside the dialog. */
  @Input() serverError = '';
  /** Shown under the title, for example that the change reaches every canvas on the dataset. */
  @Input() notice = '';
  @Output() save = new EventEmitter<SavedMeasure>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;
  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('textInput') textInput?: ElementRef<HTMLTextAreaElement>;

  name = '';
  text = '';
  /** Why the column cannot be saved yet. */
  problem = '';
  textError: FormulaError | null = null;
  /** The table's own fields, for the list that "[" opens: a row formula reads only its own table. */
  suggestFields: SuggestField[] = [];

  readonly comparisons = Object.entries(COMPARISON_LABELS) as [ConditionOp, string][];

  /**
   * How the column is written: a formula typed in the box, or one of the builders, which write the formula
   * as they are filled in. Save saves whichever is open; Edit as formula moves a builder's formula to the box.
   */
  mode: 'formula' | 'conditional' | 'bins' = 'formula';
  bins: BinsSpec = { column: '', mode: 'width', width: '', bounds: '', labels: '' };
  rules: ConditionRule[] = [];
  otherwise = '';
  /** The table and columns the function examples are written with. */
  exampleColumns: ExampleColumns | null = null;

  // Focus goes back here when the dialog closes.
  private readonly opener = document.activeElement as HTMLElement | null;
  /** The server's checks of Save, run while the formula is edited. */
  readonly check: LiveFormulaCheck;

  constructor(private readonly models: ModelStudioService, cdr: ChangeDetectorRef) {
    this.check = new LiveFormulaCheck(() => cdr.markForCheck());
  }

  ngOnInit(): void {
    this.suggestFields = this.tableFields.map(column => ({
      insert: `${this.source.alias}.${column.columnName}`, table: this.source.alias, name: column.columnName,
      kind: fieldKind(column.dataType), calculated: column.id < 0,
    }));
    const kinds = this.tableFields.map(column => ({
      name: column.columnName, kind: fieldKind(column.dataType), key: column.isPrimaryKey || column.isForeignKey || /_id$/i.test(column.columnName),
    }));
    const firstOf = (kind: string) => (kinds.find(k => k.kind === kind && !k.key) ?? kinds.find(k => k.kind === kind))?.name;
    this.exampleColumns = {
      table: this.source.alias, number: firstOf('number'), text: firstOf('text'), date: firstOf('date'),
      key: this.tableFields.find(c => c.isPrimaryKey)?.columnName ?? firstOf('number'),
    };
    this.name = this.column?.name ?? '';
    this.text = this.column?.expression ? printMeasure(this.column.expression) : '';
  }

  ngAfterViewInit(): void {
    this.nameInput?.nativeElement.focus();
  }

  /** As in the formula builder: each complete formula is sent once for the checks of Save. */
  ngDoCheck(): void {
    const parsed = parseRowExpression(this.formulaText);
    const name = this.name.trim();
    const node = parsed.ok ? parsed.node : null;
    this.check.update(node ? JSON.stringify([name, this.source.id, node]) : null,
      () => this.models.checkCalculatedColumn(this.dataset.id, this.source.id, name, node!, this.column?.id ?? null));
  }

  ngOnDestroy(): void {
    this.check.destroy();
    // As in the formula builder: wait for the change-detection cycle that re-renders the page to finish.
    queueMicrotask(() => this.opener?.focus());
  }

  get title(): string {
    return this.column ? `Edit ${this.source.alias}.${this.column.name}` : `New calculated column in ${this.source.alias}`;
  }

  /** The table's columns and its other calculated columns, for the builders. */
  get tableFields(): DbSchemaColumn[] {
    return fieldColumns(this.dataset, this.columns, this.source).filter(c => c.columnName !== this.column?.name);
  }

  /** The fields that hold numbers, or whose type is not known, for bins. */
  get numberFields(): DbSchemaColumn[] {
    return this.tableFields.filter(c => columnFitsAggregate('sum', c.dataType ?? ''));
  }

  setMode(mode: 'formula' | 'conditional' | 'bins'): void {
    this.mode = mode;
    this.problem = '';
    this.clearServerError();
    if (mode === 'conditional' && !this.rules.length) this.addRule();
  }

  /** What the open builder writes: its formula, or why it cannot yet. Null in the formula mode. */
  get built(): Built | null {
    if (this.mode === 'formula') return null;
    const numbers = new Set(this.numberFields.map(c => c.columnName));
    return this.mode === 'bins'
      ? binsFormula(this.source.alias, this.bins)
      : conditionalFormula(this.source.alias, this.rules, this.otherwise, column => numbers.has(column));
  }

  /** The formula that Save would save: the box's, or the open builder's. */
  get formulaText(): string {
    const built = this.built;
    return built === null ? this.text : 'text' in built ? built.text : '';
  }


  addRule(): void {
    this.rules.push({ column: '', op: 'eq', value: '', result: '' });
  }

  removeRule(index: number): void {
    this.rules.splice(index, 1);
  }

  /** Moves the builder's formula to the formula box, to change it by hand. */
  editAsFormula(): void {
    const built = this.built;
    if (built && 'text' in built) this.text = built.text;
    this.textError = null;
    this.mode = 'formula';
  }

  /** The formula read back as a sentence. */
  get sentence(): string {
    const parsed = parseRowExpression(this.formulaText);
    return parsed.ok ? describeMeasure(parsed.node) : 'Complete the formula to see how it reads.';
  }

  /** The formula's first problem as it is typed, or the one Save found. Nothing for an empty formula until Save. */
  get shownError(): FormulaError | null {
    if (this.textError) return this.textError;
    if (!this.text.trim()) return null;
    const parsed = parseRowExpression(this.text);
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

  /** A fresh edit means a server refusal shown for the previous attempt no longer applies. */
  clearServerError(): void {
    this.serverError = '';
  }

  submit(): void {
    this.problem = '';
    const name = this.name.trim();
    if (!name) {
      this.problem = 'Give the column a name.';
      return;
    }
    const built = this.built;
    if (built && 'problem' in built) {
      this.problem = built.problem;
      return;
    }
    const parsed = parseRowExpression(this.formulaText);
    if (!parsed.ok) {
      if (this.mode === 'formula') this.showTextError(parsed.error);
      else this.problem = parsed.error.message;
      return;
    }
    this.save.emit({ name, expression: parsed.node });
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

  /** Shows the message and selects the characters it is about. */
  private showTextError(error: FormulaError): void {
    this.textError = error;
    const input = this.textInput?.nativeElement;
    input?.focus();
    input?.setSelectionRange(error.start, error.end);
  }
}

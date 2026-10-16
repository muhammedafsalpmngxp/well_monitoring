import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ExampleColumns, FormulaFunction, FunctionGroup, FunctionMode, functionCategories, functionGroups, localizeExample } from './formula-functions';

/**
 * The functions a formula can use, grouped by category and searchable. Each shows its signature, what it does
 * and an example; Insert hands the example to the host, which places it in the formula.
 */
@Component({
  selector: 'app-function-list',
  standalone: false,
  templateUrl: './function-list.component.html',
  styleUrls: ['./function-list.component.scss'],
})
export class FunctionListComponent {
  /** row for a calculated column, measure for a measure. */
  @Input() mode: FunctionMode = 'row';
  /** The dataset's own table and columns the examples are written with; null keeps the library's. */
  @Input() columns: ExampleColumns | null = null;
  @Output() insert = new EventEmitter<string>();

  term = '';
  /** The one category shown, or every category for null. */
  category: string | null = null;

  get categories(): string[] {
    return functionCategories(this.mode);
  }

  get groups(): FunctionGroup[] {
    return functionGroups(this.mode, this.term, this.category);
  }

  example(fn: FormulaFunction): string {
    return localizeExample(fn.example, this.columns);
  }

  choose(fn: FormulaFunction): void {
    this.insert.emit(this.example(fn));
  }

  trackName(_index: number, fn: FormulaFunction): string {
    return fn.name;
  }

  /** groups is rebuilt on every check, so the sections are kept by category instead of being redrawn. */
  trackCategory(_index: number, group: FunctionGroup): string {
    return group.category;
  }
}

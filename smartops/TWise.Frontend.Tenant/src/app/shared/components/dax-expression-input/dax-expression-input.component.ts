import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, EventEmitter, Input, Output, ViewChild, inject,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { DaxFunctionService, DaxFunctionSuggestion } from '../../../core/services/dax-function.service';
import { composeContext, enclosingFunction, expandSnippet } from '../../../core/utils/dax-compose.util';

import { FieldLabelDirective } from '../../directives/field-label.directive';
interface ComposeItem {
  label: string;
  detail: string;
  hint: string;
  insert: () => void;
}

/**
 * DAX expression textarea with smart compose: function suggestions from the catalog
 * (GET /api/dax-functions/suggest), column suggestions after "[", and the syntax of the
 * function the caret is in. Arrow keys move, Enter/Tab accept, Escape closes.
 */
@Component({
  selector: 'app-dax-expression-input',
  standalone: true,
  imports: [FieldLabelDirective, NgClass],
  templateUrl: './dax-expression-input.component.html',
  styleUrls: ['./dax-expression-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaxExpressionInputComponent {
  @Input() value = '';
  @Input() columns: string[] = [];
  @Input() placeholder = 'SUM([Column])';
  @Input() rows = 3;
  @Input() inputId = '';
  @Input() invalid = false;
  @Input() describedBy: string | null = null;
  @Input() textareaClass = 'dax-model__expression';
  @Input() invalidClass = 'dax-model__expression--invalid';
  @Output() readonly valueChange = new EventEmitter<string>();

  @ViewChild('box', { static: true }) private readonly box!: ElementRef<HTMLTextAreaElement>;

  items: ComposeItem[] = [];
  active = 0;
  signature: DaxFunctionSuggestion | null = null;
  readonly listId = `dax-compose-${Math.random().toString(36).slice(2, 9)}`;

  private readonly functions = inject(DaxFunctionService);
  private readonly cdr = inject(ChangeDetectorRef);
  private lookup?: Subscription;
  private signatureLookup?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => { clearTimeout(this.timer); this.lookup?.unsubscribe(); this.signatureLookup?.unsubscribe(); });
  }

  get open(): boolean { return this.items.length > 0; }

  onInput(): void {
    const el = this.box.nativeElement;
    this.value = el.value;
    this.valueChange.emit(this.value);
    this.refresh();
  }

  /** Re-reads the caret (typing, clicking, arrow keys outside the list). */
  refresh(): void {
    const el = this.box.nativeElement;
    const caret = el.selectionStart ?? el.value.length;
    this.updateSignature(el.value, caret);
    clearTimeout(this.timer);
    const ctx = composeContext(el.value, caret);
    if (ctx.kind === 'column') {
      const q = ctx.prefix.trim().toLowerCase();
      this.show(this.columns.filter(c => c.toLowerCase().includes(q)).slice(0, 8).map(c => ({
        label: c, detail: 'Column', hint: '',
        insert: () => this.replace(ctx.start, caret, `[${c}]`, true),
      })));
      return;
    }
    if (ctx.kind !== 'function') { this.close(); return; }
    // Short debounce: the catalog lookup runs per prefix and is cached.
    this.timer = setTimeout(() => {
      this.lookup?.unsubscribe();
      this.lookup = this.functions.suggest(ctx.prefix, 8).subscribe(list => {
        this.show(list.map(f => ({
          label: f.functionName, detail: f.category, hint: `${f.syntax} — ${f.description}`,
          insert: () => {
            const s = expandSnippet(f.insertSnippet);
            this.replace(ctx.start, caret, s.text, false, s.selectStart, s.selectEnd);
          },
        })));
      });
    }, 120);
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    if (event.key === 'ArrowDown') { this.active = (this.active + 1) % this.items.length; }
    else if (event.key === 'ArrowUp') { this.active = (this.active - 1 + this.items.length) % this.items.length; }
    else if (event.key === 'Enter' || event.key === 'Tab') { this.items[this.active].insert(); }
    else if (event.key === 'Escape') { this.close(); }
    else return;
    event.preventDefault();
    this.cdr.markForCheck();
  }

  pick(item: ComposeItem, event: MouseEvent): void {
    event.preventDefault(); // keep focus in the textarea
    item.insert();
  }

  onBlur(): void {
    // Delay so a click on a suggestion lands before the list closes.
    setTimeout(() => { this.close(); this.signature = null; this.cdr.markForCheck(); }, 150);
  }

  private show(items: ComposeItem[]): void {
    this.items = items;
    this.active = 0;
    this.cdr.markForCheck();
  }

  private close(): void {
    if (!this.items.length) return;
    this.items = [];
    this.cdr.markForCheck();
  }

  /** Replaces [start, end) with text; a column also swallows the "]" already typed after the caret. */
  private replace(start: number, end: number, text: string, column: boolean, selStart = text.length, selEnd = selStart): void {
    const el = this.box.nativeElement;
    let to = end;
    if (column) {
      const rest = el.value.slice(end);
      const close = /^[^\[\]\s,()]*\]/.exec(rest);
      if (close) to += close[0].length;
    }
    el.value = el.value.slice(0, start) + text + el.value.slice(to);
    el.focus();
    el.setSelectionRange(start + selStart, start + selEnd);
    this.items = [];
    this.onInputAfterInsert();
  }

  private onInputAfterInsert(): void {
    this.value = this.box.nativeElement.value;
    this.valueChange.emit(this.value);
    const el = this.box.nativeElement;
    this.updateSignature(el.value, el.selectionStart ?? el.value.length);
    this.cdr.markForCheck();
  }

  private updateSignature(text: string, caret: number): void {
    const name = enclosingFunction(text, caret);
    if (!name) { this.signature = null; this.cdr.markForCheck(); return; }
    if (this.signature?.functionName === name) return;
    this.signatureLookup?.unsubscribe();
    this.signatureLookup = this.functions.suggest(name, 1).subscribe(list => {
      this.signature = list[0]?.functionName === name ? list[0] : null;
      this.cdr.markForCheck();
    });
  }
}

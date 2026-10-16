import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { SuggestField, SuggestQuery, applySuggestion, matchFields, suggestQuery } from './field-suggest.util';

/**
 * The field list of a formula box. Typing "[" in the box, or a table alias and a dot, lists the fields that
 * match what follows; arrows move, Enter or Tab puts the chosen field in the formula, Escape closes.
 * The box stays the host's: the chosen text goes back through applied, so its ngModel keeps up.
 */
@Component({
  selector: 'app-field-suggest',
  standalone: false,
  templateUrl: './field-suggest.component.html',
  styleUrls: ['./field-suggest.component.scss'],
})
export class FieldSuggestComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) target!: HTMLTextAreaElement | null;
  @Input() fields: SuggestField[] = [];
  @Input() listId = 'field-suggest';
  @Output() applied = new EventEmitter<{ text: string; caret: number }>();

  shown: SuggestField[] = [];
  active = 0;
  private query: SuggestQuery | null = null;
  private attached: HTMLTextAreaElement | null = null;
  private readonly onInput = () => this.update();
  private readonly onKeydown = (event: KeyboardEvent) => this.keydown(event);
  private readonly onBlur = () => setTimeout(() => this.close(), 150);

  constructor(private readonly cdr: ChangeDetectorRef) {}

  get open(): boolean {
    return this.shown.length > 0;
  }

  ngOnChanges(): void {
    if (this.target === this.attached) return;
    this.detach();
    this.attached = this.target;
    this.attached?.addEventListener('input', this.onInput);
    this.attached?.addEventListener('click', this.onInput);
    this.attached?.addEventListener('keydown', this.onKeydown);
    this.attached?.addEventListener('blur', this.onBlur);
    this.attached?.setAttribute('aria-autocomplete', 'list');
  }

  ngOnDestroy(): void {
    this.detach();
  }

  choose(field: SuggestField): void {
    const box = this.attached;
    if (!box || !this.query) return;
    const next = applySuggestion(box.value, box.selectionStart ?? box.value.length, this.query, field);
    this.close();
    this.applied.emit(next);
  }

  trackField(_index: number, field: SuggestField): string {
    return field.insert;
  }

  private update(): void {
    const box = this.attached;
    if (!box) return;
    const tables = [...new Set(this.fields.map(f => f.table))];
    this.query = suggestQuery(box.value, box.selectionStart ?? box.value.length, tables);
    this.shown = this.query ? matchFields(this.fields, this.query) : [];
    this.active = 0;
    box.setAttribute('aria-expanded', String(this.open));
    if (this.open) box.setAttribute('aria-controls', this.listId);
    this.cdr.markForCheck();
  }

  private keydown(event: KeyboardEvent): void {
    if (!this.open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.shown.length) % this.shown.length;
      this.cdr.markForCheck();
      // The list scrolls, so the chosen row is brought into view once it is drawn.
      const id = this.listId;
      const index = this.active;
      setTimeout(() => document.getElementById(id)?.children[index]?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.choose(this.shown[this.active]);
    } else if (event.key === 'Escape') {
      // Closes the list only; the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  private close(): void {
    this.shown = [];
    this.query = null;
    this.attached?.setAttribute('aria-expanded', 'false');
    this.cdr.markForCheck();
  }

  private detach(): void {
    this.attached?.removeEventListener('input', this.onInput);
    this.attached?.removeEventListener('click', this.onInput);
    this.attached?.removeEventListener('keydown', this.onKeydown);
    this.attached?.removeEventListener('blur', this.onBlur);
    this.attached = null;
  }
}

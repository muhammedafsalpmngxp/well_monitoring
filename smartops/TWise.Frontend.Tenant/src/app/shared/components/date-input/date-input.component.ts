import { Component, Input, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Date field that always displays/edits in mm-dd-yyyy regardless of browser/OS locale.
 * Wraps a native `input[type=date]` (kept for picker + keyboard support) whose own
 * locale-formatted text is hidden, and renders a locale-independent mm-dd-yyyy overlay on top.
 * Bound value is the native ISO `yyyy-MM-dd` string, so it can replace `input[type=date]` as a drop-in `ngModel`.
 */
@Component({
  selector: 'app-date-input',
  standalone: false,
  templateUrl: './date-input.component.html',
  styleUrls: ['./date-input.component.scss'],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputComponent), multi: true },
  ],
})
export class DateInputComponent implements ControlValueAccessor {
  @Input() min?: string;
  @Input() max?: string;
  @Input() disabled = false;
  @Input() placeholder = 'mm-dd-yyyy';
  /** Accessible name for the native input; the visible label is usually on a wrapper, not the input. */
  @Input() ariaLabel = 'Date';

  value = '';

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  get displayText(): string {
    const parts = (this.value || '').split('-');
    if (parts.length !== 3) return this.placeholder;
    const [y, m, d] = parts;
    if (!y || !m || !d) return this.placeholder;
    return `${m}-${d}-${y}`;
  }

  onNativeChange(newValue: string): void {
    this.value = newValue;
    this.onChange(this.value);
    this.onTouched();
  }

  writeValue(value: string | null): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}

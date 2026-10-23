import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DaxMeasureConfig } from '../../../core/utils/dax-evaluator.util';

/** Lets a viewer switch a tile, chart or report between its enabled DAX measures. */
@Component({
  selector: 'app-dax-metric-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <select [attr.aria-label]="label" [title]="label" [ngModel]="value ?? ''" (ngModelChange)="metricChange.emit($event || null)"
      (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
      <option *ngIf="allowAll" value="">All metrics</option>
      <option *ngFor="let measure of measures" [value]="measure.id">{{ measure.name || 'Metric' }}</option>
    </select>
  `,
  styles: [`
    :host { display: inline-block; max-width: 100%; }
    select {
      box-sizing: border-box; max-width: 100%; height: 32px; padding: 4px 28px 4px 10px; border: 1px solid #C9D3E2;
      border-radius: 8px; background: var(--color-bg-card, #fff); color: var(--color-text-primary, #101828);
      font-family: var(--font-family-base, inherit); font-size: 13px; cursor: pointer;
    }
    select:focus { outline: none; border-color: var(--color-primary, #21409A); }
  `],
})
export class DaxMetricSelectComponent {
  @Input() measures: readonly DaxMeasureConfig[] = [];
  @Input() value: string | null | undefined = null;
  /** Charts and reports can show every measure again; a tile always shows exactly one. */
  @Input() allowAll = false;
  @Input() label = 'Metric';
  @Output() metricChange = new EventEmitter<string | null>();
}

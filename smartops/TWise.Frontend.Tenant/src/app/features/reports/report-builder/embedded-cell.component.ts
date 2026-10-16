import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

import { FieldLabelDirective } from '../../../shared/directives/field-label.directive';
interface EmbeddedCellParams extends ICellRendererParams {
  rows: number;
  cols: number;
  values: Record<string, unknown>;
  editable: boolean;
  onChange?: (subRow: number, subCol: number, value: string) => void;
}

/**
 * Renders a cell as a rows x cols grid of blank sub-cells ("Split Cells").
 * Editable in the builder; read-only in the viewer.
 */
@Component({
  selector: 'app-embedded-cell',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule],
  template: `
    <div class="ec"
      [style.grid-template-columns]="'repeat(' + cols + ', minmax(0, 1fr))'"
      [style.grid-template-rows]="'repeat(' + rows + ', minmax(0, 1fr))'">
      <ng-container *ngFor="let r of rowArr">
        <ng-container *ngFor="let c of colArr">
          <input *ngIf="editable; else ro" class="ec__cell"
            [value]="valueAt(r, c)"
            (mousedown)="$event.stopPropagation()"
            (click)="$event.stopPropagation()"
            (dblclick)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()"
            (input)="onInput(r, c, $any($event.target).value)" />
          <ng-template #ro><span class="ec__cell ec__cell--ro">{{ valueAt(r, c) }}</span></ng-template>
        </ng-container>
      </ng-container>
    </div>
  `,
  styles: [`
    .ec { display: grid; width: 100%; height: 100%; background: transparent; }
    .ec__cell {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      min-height: 20px;
      // Transparent so the parent cell's row/cell color shows through; translucent
      // border draws the sub-cell separators legibly on any background color.
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: transparent;
      font: inherit;
      color: inherit;
      text-align: center;
      padding: 2px 4px;
      outline: none;
      box-sizing: border-box;
    }
    .ec__cell:focus { box-shadow: inset 0 0 0 1px #21409A; }
  `],
})
export class EmbeddedCellComponent implements ICellRendererAngularComp {
  rows = 1;
  cols = 1;
  editable = false;
  rowArr: number[] = [];
  colArr: number[] = [];
  private values: Record<string, unknown> = {};
  private onChange?: (subRow: number, subCol: number, value: string) => void;

  agInit(params: EmbeddedCellParams): void { this.setup(params); }

  refresh(params: EmbeddedCellParams): boolean { this.setup(params); return true; }

  private setup(params: EmbeddedCellParams): void {
    this.rows = Math.max(1, params.rows || 1);
    this.cols = Math.max(1, params.cols || 1);
    this.values = params.values ?? {};
    this.editable = !!params.editable;
    this.onChange = params.onChange;
    this.rowArr = Array.from({ length: this.rows }, (_, i) => i);
    this.colArr = Array.from({ length: this.cols }, (_, i) => i);
  }

  valueAt(subRow: number, subCol: number): string {
    const v = this.values[`${subRow}:${subCol}`];
    return v == null ? '' : String(v);
  }

  onInput(subRow: number, subCol: number, value: string): void {
    this.values[`${subRow}:${subCol}`] = value;
    this.onChange?.(subRow, subCol, value);
  }
}

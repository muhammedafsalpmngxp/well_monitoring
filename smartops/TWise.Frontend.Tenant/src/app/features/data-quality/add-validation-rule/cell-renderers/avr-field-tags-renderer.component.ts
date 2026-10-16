import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { FieldGroup } from '../add-validation-rule.component';

@Component({
  selector: 'app-avr-field-tags-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="avr-tag-cell">
      <span class="avr-field-tag" *ngFor="let f of fields">
        {{ f }}
        <button type="button" class="avr-field-tag__remove" title="Remove" (click)="removeField(f)">×</button>
      </span>
    </div>
  `,
  styles: [`
    .avr-tag-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      padding: 8px 0;
    }
    .avr-field-tag {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 1px 10px;
      border-radius: 20px;
      border: none;
      background: #FDF0D9;
      color: #9A6700;
      height: 24px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      line-height: 1.6;
    }
    .avr-field-tag__remove {
      position: absolute;
      top: -6px;
      right: -6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      border: 1px solid #DCE3ED;
      background: #fff;
      color: #64748B;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;

      &:hover { color: #D92D20; border-color: #D92D20; }
    }
  `],
})
export class AvrFieldTagsRendererComponent implements ICellRendererAngularComp {
  fields: string[] = [];
  private params!: ICellRendererParams<FieldGroup>;

  agInit(params: ICellRendererParams<FieldGroup>): void {
    this.params = params;
    this.fields = params.data?.fields ?? [];
  }

  refresh(params: ICellRendererParams<FieldGroup>): boolean {
    this.params = params;
    this.fields = params.data?.fields ?? [];
    return true;
  }

  removeField(field: string): void {
    (this.params.context?.onRemoveField as ((idx: number, field: string) => void) | undefined)?.(this.params.node.rowIndex ?? 0, field);
  }
}

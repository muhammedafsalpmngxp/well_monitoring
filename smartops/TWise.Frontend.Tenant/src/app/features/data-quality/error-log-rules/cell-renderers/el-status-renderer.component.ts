import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

import { FieldLabelDirective } from '../../../../shared/directives/field-label.directive';
@Component({
  selector: 'app-el-status-renderer',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule, FormsModule],
  template: `
    <select class="el-status-select" [ngModel]="value" (ngModelChange)="onChange($event)" 
      [class]="'el-status-select--' + cssClass" (click)="$event.stopPropagation()" (mousedown)="$event.stopPropagation()">
      <option value="Open">Open</option>
      <option value="Close">Close</option>
      <option value="In Progress">In Progress</option>
      <option value="On Hold">On Hold</option>
      <option value="Invalid">Invalid</option>
    </select>
  `,
  styles: [`
    :host { display: flex; align-items: center; height: 100%; }
    .el-status-select {
      width: 100%; height: 28px; border: 1px solid #E7ECF3; border-radius: 6px;
      font-size: 12px; font-weight: 500; padding: 0 24px 0 8px; cursor: pointer;
      background: #fff; position: relative; z-index: 1;
    }
    .el-status-select--open { color: #B54708; background-color: #FFFAEB; border-color: #FEC84B; }
    .el-status-select--close { color: #067647; background-color: #ECFDF3; border-color: #ABEFC6; }
    .el-status-select--inprogress { color: #175CD3; background-color: #EFF8FF; border-color: #B2DDFF; }
    .el-status-select--onhold { color: #344054; background-color: #F2F4F7; border-color: #D0D5DD; }
    .el-status-select--invalid { color: #912018; background-color: #FEF3F2; border-color: #FECDCA; }
  `],
})
export class ElStatusRendererComponent implements ICellRendererAngularComp {
  value = 'Open';
  private params!: ICellRendererParams;

  get cssClass(): string {
    return this.value.toLowerCase().replace(/\s+/g, '');
  }

  agInit(params: ICellRendererParams): void {
    this.params = params;
    this.value = params.value ?? 'Open';
  }

  refresh(params: ICellRendererParams): boolean {
    this.value = params.value ?? 'Open';
    return true;
  }

  onChange(newStatus: string): void {
    this.value = newStatus;
    this.params.data.status = newStatus;
    this.params.context?.onStatusChange?.(this.params.data, newStatus);
  }
}

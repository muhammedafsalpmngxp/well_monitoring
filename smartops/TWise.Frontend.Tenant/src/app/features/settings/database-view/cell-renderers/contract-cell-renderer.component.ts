import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DatabaseViewRow } from '../database-view.component';

/** View contract result (docs/VIEW-CONTRACT.md). Advisory only; a non-compliant view still works. */
@Component({
  selector: 'app-contract-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span *ngIf="row?.contractViolations as violations" class="badge"
      [class.badge-success]="!violations.length" [class.badge-warning]="violations.length"
      [attr.title]="tooltip(violations)">
      {{ violations.length ? violations.length + ' issue' + (violations.length > 1 ? 's' : '') : 'Compliant' }}
    </span>
  `,
})
export class ContractCellRendererComponent implements ICellRendererAngularComp {
  row?: DatabaseViewRow;

  agInit(params: ICellRendererParams<DatabaseViewRow>): void {
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DatabaseViewRow>): boolean {
    this.row = params.data;
    return true;
  }

  tooltip(violations: { rule: number; message: string }[]): string | null {
    return violations.length ? violations.map(v => `Rule ${v.rule}: ${v.message}`).join('\n') : null;
  }
}

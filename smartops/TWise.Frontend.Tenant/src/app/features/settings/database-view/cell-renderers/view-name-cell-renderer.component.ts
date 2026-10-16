import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { DatabaseViewRow } from '../database-view.component';

@Component({
  selector: 'app-view-name-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `<a class="db-table__view-link" href="javascript:void(0)" (click)="openView()">{{ row?.viewName }}</a>`,
  styleUrls: ['./cell-renderers.scss'],
})
export class ViewNameCellRendererComponent implements ICellRendererAngularComp {
  row?: DatabaseViewRow;

  constructor(private readonly router: Router) {}

  agInit(params: ICellRendererParams<DatabaseViewRow>): void {
    this.row = params.data;
  }

  refresh(params: ICellRendererParams<DatabaseViewRow>): boolean {
    this.row = params.data;
    return true;
  }

  openView(): void {
    if (this.row) this.router.navigate(['/settings/database-view', this.row.id]);
  }
}

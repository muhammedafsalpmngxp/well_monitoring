import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CategoryDropdown } from '../../../../core/models/category.model';

@Component({
  selector: 'app-category-dashboard-cell-renderer',
  standalone: true,
  template: `
    <div class="cm-dash-cell">
      <span class="cm-dash-cell__badge">{{ count }} {{ label }}</span>
    </div>
  `,
  styles: [`
    .cm-dash-cell { display: flex; align-items: center; height: 100%; }
    .cm-dash-cell__badge { display: inline-flex; align-items: center; height: 24px; padding: 4px 10px; border-radius: 20px; background: #EEF4FF; color: #21409A; font-size: 12px; font-weight: 600; white-space: nowrap; border: none; }
  `],
})
export class CategoryDashboardCellRendererComponent implements ICellRendererAngularComp {
  count = 0;
  label = 'Dashboard';

  agInit(params: ICellRendererParams<CategoryDropdown>): void {
    this.setState(params);
  }

  refresh(params: ICellRendererParams<CategoryDropdown>): boolean {
    this.setState(params);
    return true;
  }

  private setState(params: ICellRendererParams<CategoryDropdown>): void {
    this.count = params.data?.itemCount ?? 0;
    const controlType = (params.data?.controlType ?? '').toLowerCase();
    switch (controlType) {
      case 'chart': this.label = 'Chart'; break;
      case 'tile': this.label = 'Tile'; break;
      case 'report': this.label = 'Report'; break;
      default: this.label = 'Dashboard';
    }
  }
}

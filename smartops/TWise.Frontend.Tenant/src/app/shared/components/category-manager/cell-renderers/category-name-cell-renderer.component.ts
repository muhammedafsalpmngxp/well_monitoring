import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CategoryDropdown } from '../../../../core/models/category.model';

@Component({
  selector: 'app-category-name-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cm-name-cell">
      <span class="cm-name-cell__icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2.25 6.75L2.25 4.5C2.25 3.67157 2.92157 3 3.75 3H6.87868C7.27650 3 7.65804 3.15804 7.93934 3.43934L9 4.5H14.25C15.0784 4.5 15.75 5.17157 15.75 6V6.75M2.25 6.75H15.75M2.25 6.75L2.25 13.5C2.25 14.3284 2.92157 15 3.75 15H14.25C15.0784 15 15.75 14.3284 15.75 13.5V6.75" stroke="#21409A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="cm-name-cell__label">{{ name }}</span>
    </div>
  `,
  styles: [`
    .cm-name-cell { display: flex; align-items: center; gap: 10px; height: 100%; }
    .cm-name-cell__icon { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: #EEF4FF; flex-shrink: 0; }
    .cm-name-cell__label { font-size: 14px; font-weight: 500; color: #101828; }
  `],
})
export class CategoryNameCellRendererComponent implements ICellRendererAngularComp {
  name = '';

  agInit(params: ICellRendererParams<CategoryDropdown>): void {
    this.name = params.data?.categoryName ?? '';
  }

  refresh(params: ICellRendererParams<CategoryDropdown>): boolean {
    this.name = params.data?.categoryName ?? '';
    return true;
  }
}

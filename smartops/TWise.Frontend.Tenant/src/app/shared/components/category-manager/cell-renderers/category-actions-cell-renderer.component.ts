import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CategoryDropdown } from '../../../../core/models/category.model';

@Component({
  selector: 'app-category-actions-cell-renderer',
  standalone: true,
  template: `
    @if (canModify) {
    <div class="cm-actions-cell">
      <button class="cm-actions-cell__btn" title="Edit" (click)="onEdit()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <g clip-path="url(#cm-edit-clip)">
            <path d="M7.33301 2.66665H4.53301C3.4129 2.66665 2.85285 2.66665 2.42503 2.88464C2.0487 3.07639 1.74274 3.38235 1.55099 3.75867C1.33301 4.1865 1.33301 4.74655 1.33301 5.86665V11.4667C1.33301 12.5867 1.33301 13.1468 1.55099 13.5747C1.74274 13.9509 2.0487 14.2569 2.42503 14.4487C2.85285 14.6667 3.4129 14.6667 4.53301 14.6667H10.133C11.2531 14.6667 11.8131 14.6667 12.241 14.4487C12.6173 14.2569 12.9233 13.9509 13.115 13.5747C13.333 13.1468 13.333 12.5867 13.333 11.4667V8.66667M5.33299 10.6667H6.44935C6.77547 10.6667 6.93854 10.6667 7.09201 10.6298C7.22801 10.5971 7.35807 10.5433 7.47741 10.4702C7.61194 10.3877 7.72727 10.2724 7.95787 10.0418L14.333 3.66665C14.8853 3.11437 14.8853 2.21894 14.333 1.66665C13.7807 1.11437 12.8853 1.11437 12.333 1.66665L5.95783 8.0418C5.72723 8.2724 5.61193 8.38773 5.52947 8.52227C5.45637 8.6416 5.40249 8.7716 5.36983 8.90767C5.33299 9.06113 5.33299 9.2242 5.33299 9.55033V10.6667Z" stroke="#64748B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          <defs><clipPath id="cm-edit-clip"><rect width="16" height="16" fill="white"/></clipPath></defs>
        </svg>
      </button>
      <button class="cm-actions-cell__btn cm-actions-cell__btn--delete" title="Delete" (click)="onDelete()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 2H10M2 4H14M12.6667 4L12.1991 11.0129C12.129 12.065 12.0939 12.5911 11.8667 12.99C11.6666 13.3412 11.3648 13.6235 11.0011 13.7998C10.588 14 10.0607 14 9.0062 14H6.9938C5.93927 14 5.41202 14 4.99889 13.7998C4.63517 13.6235 4.33339 13.3412 4.13332 12.99C3.90607 12.5911 3.871 12.065 3.80086 11.0129L3.33333 4M6.66667 7V10.3333M9.33333 7V10.3333" stroke="#D92D20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    }
  `,
  styles: [`
    .cm-actions-cell { display: flex; align-items: center; gap: 6px; height: 100%; }
    .cm-actions-cell__btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid #DCE3ED; border-radius: 10px; background: #fff; cursor: pointer; transition: background 0.12s ease; }
    .cm-actions-cell__btn:hover { background: #F9FAFB; border-color: #9CA3AF; }
    .cm-actions-cell__btn--delete { border-color: #DCE3ED; }
    .cm-actions-cell__btn--delete:hover { background: #F9FAFB; }
  `],
})
export class CategoryActionsCellRendererComponent implements ICellRendererAngularComp {
  private params!: ICellRendererParams<CategoryDropdown>;

  get canModify(): boolean { return this.params?.context?.componentParent?.canModify === true; }

  agInit(params: ICellRendererParams<CategoryDropdown>): void {
    this.params = params;
  }

  refresh(params: ICellRendererParams<CategoryDropdown>): boolean {
    this.params = params;
    return true;
  }

  onEdit(): void {
    this.params.context?.componentParent?.openEditForm(this.params.data);
  }

  onDelete(): void {
    this.params.context?.componentParent?.confirmDelete(this.params.data);
  }
}

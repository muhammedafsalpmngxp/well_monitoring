import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import type { FieldGroup } from '../add-validation-rule.component';

@Component({
    selector: 'app-avr-actions-renderer',
    standalone: true,
    template: `
    <div class="avr-actions-cell">
      <button class="avr-act-btn avr-act-btn--delete" title="Delete" (click)="onDelete()">
       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
<path d="M6 2H10M2 4H14M12.6667 4L12.1991 11.0129C12.129 12.065 12.0939 12.5911 11.8667 12.99C11.6666 13.3412 11.3648 13.6235 11.0011 13.7998C10.588 14 10.0607 14 9.0062 14H6.9938C5.93927 14 5.41202 14 4.99889 13.7998C4.63517 13.6235 4.33339 13.3412 4.13332 12.99C3.90607 12.5911 3.871 12.065 3.80086 11.0129L3.33333 4M6.66667 7V10.3333M9.33333 7V10.3333" stroke="#D92D20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
      </button>
    </div>
  `,
    styles: [`
    .avr-actions-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      height: 100%;
    }
    .avr-act-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      border: 1px solid #DCE3ED;
      background: #fff;
      cursor: pointer;
      flex-shrink: 0;

      &:hover { border-color: #D0D5DD; background: #F9FAFB; }

      &--delete:hover { border-color: #D92D20; background: #FEF2F2; }
    }
  `],
})
export class AvrActionsRendererComponent implements ICellRendererAngularComp {
    private params!: ICellRendererParams<FieldGroup>;

    agInit(params: ICellRendererParams<FieldGroup>): void {
        this.params = params;
    }

    refresh(params: ICellRendererParams<FieldGroup>): boolean {
        this.params = params;
        return true;
    }

    onEdit(): void {
        (this.params.context?.onEdit as ((idx: number) => void) | undefined)?.(this.params.node.rowIndex ?? 0);
    }

    onDelete(): void {
        (this.params.context?.onDelete as ((idx: number) => void) | undefined)?.(this.params.node.rowIndex ?? 0);
    }
}

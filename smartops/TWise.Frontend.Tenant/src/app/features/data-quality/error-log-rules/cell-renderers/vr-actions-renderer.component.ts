import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

@Component({
  selector: 'app-vr-actions-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="vr-actions">
      <button *ngIf="canModify" class="vr-act-btn" title="Trigger Rule" (click)="onTrigger()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 2.66667L12.6667 8L4 13.3333V2.66667Z" fill="#F58220" stroke="#F58220" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button *ngIf="canModify" class="vr-act-btn" title="Edit" (click)="onEdit()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M7.336 2.668H4.536c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874c-.218.428-.218.988-.218 2.108v5.6c0 1.12 0 1.68.218 2.108a2 2 0 0 0 .874.874c.428.218.988.218 2.108.218h5.6c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874c.218-.428.218-.988.218-2.108V8.668M5.336 10.668h1.116c.326 0 .49 0 .643-.037a1.3 1.3 0 0 0 .386-.16c.134-.082.25-.197.48-.428L14.336 3.668a1.414 1.414 0 1 0-2-2l-6.375 6.375c-.23.23-.346.346-.428.48a1.3 1.3 0 0 0-.16.386c-.037.153-.037.317-.037.643v1.116Z" stroke="#64748B" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button *ngIf="canModify" class="vr-act-btn" title="Delete" (click)="onDelete()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 2h4M2 4h12m-1.333 0-.468 7.013c-.07 1.052-.105 1.578-.333 1.977a2 2 0 0 1-.866.81c-.413.2-.94.2-1.994.2H6.994c-1.054 0-1.582 0-1.995-.2a2 2 0 0 1-.866-.81c-.227-.399-.262-.925-.332-1.977L3.333 4m3.334 3v3.333m2.666-3.333v3.333" stroke="#D92D20" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `,
  styles: [`
    .vr-actions { display: flex; align-items: center; justify-content: center; gap: 6px; height: 100%; }
    .vr-act-btn {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; border-radius: 6px;
      background: transparent; cursor: pointer; padding: 0;
    }
    .vr-act-btn:hover { background: #F2F4F7; }
  `],
})
export class VrActionsRendererComponent implements ICellRendererAngularComp {
  private params!: ICellRendererParams;

  agInit(params: ICellRendererParams): void { this.params = params; }
  refresh(): boolean { return false; }

  get canModify(): boolean {
    const fn = this.params?.context?.canModify;
    return typeof fn === 'function' ? !!fn() : fn !== false;
  }

  onTrigger(): void { this.params.context?.onTrigger?.(this.params.data); }
  onEdit(): void { this.params.context?.onEdit?.(this.params.data); }
  onDelete(): void { this.params.context?.onDelete?.(this.params.data); }
}

import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { IHeaderParams } from 'ag-grid-community';

import { FieldLabelDirective } from '../../../shared/directives/field-label.directive';
interface EditableHeaderParams extends IHeaderParams {
  onRename?: (field: string, name: string) => void;
  onSelectColumn?: (field: string, mods: { shift: boolean; ctrl: boolean }) => void;
  onSelectColumnCells?: (field: string) => void;
  isColumnSelected?: (field: string) => boolean;
  allowRename?: boolean;
}

/**
 * Header for manually inserted (custom) columns: the label becomes an inline text
 * field on click and commits on blur/Enter, while sort/filter/menu icons keep their
 * native AG Grid behaviour so the header still looks and works like every other one.
 */
@Component({
  selector: 'app-editable-header',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule],
  template: `
    <div class="eh" [class.eh--selected]="columnSelected">
      <textarea
        *ngIf="editing; else labelTpl"
        #input
        class="eh__input"
        rows="1"
        [value]="draft"
        (click)="$event.stopPropagation()"
        (blur)="commit()"
        (keydown.enter)="onEnterCommit($event)"
        (keydown.escape)="cancel()"
        (input)="draft = $any($event.target).value"
      ></textarea>
      <ng-template #labelTpl>
        <span class="eh__label" [class.eh__label--static]="!allowRename"
          [style.text-align]="headerAlign"
          [style.writing-mode]="verticalHeader ? 'vertical-rl' : null"
          [style.transform]="verticalHeader ? 'rotate(180deg)' : null"
          [style.flex]="verticalHeader ? '0 0 auto' : null"
          [style.width]="verticalHeader ? 'auto' : null"
          [style.max-width]="verticalHeader ? 'none' : null"
          [style.height]="verticalHeader ? 'calc(var(--rb-header-height, 50px) - 8px)' : null"
          [style.white-space]="verticalHeader ? 'normal' : null"
          [style.word-break]="verticalHeader ? 'break-word' : null"
          [style.overflow]="verticalHeader ? 'visible' : null"
          [title]="allowRename ? 'Click to rename' : params.displayName"
          (click)="onLabelClick($event)">{{ params.displayName }}</span>
      </ng-template>

      <span *ngIf="sortState" class="eh__sort">
        <svg *ngIf="sortState === 'asc'" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
        <svg *ngIf="sortState === 'desc'" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>

      <button *ngIf="enableFilter" class="eh__icon-btn" [class.eh__icon-btn--active]="isFilterActive"
        title="Filter" (click)="onFilterClicked($event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>

      <button *ngIf="enableMenu" class="eh__icon-btn" title="Menu" (click)="onMenuClicked($event)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    .eh { display: flex; align-items: center; width: 100%; gap: 2px; }
    .eh--selected { outline: 2px solid #2563EB; outline-offset: -2px; border-radius: 3px; }
    .eh__label { flex: 1 1 auto; min-width: 0; overflow: hidden; line-height: 1.2; white-space: pre-line; cursor: text; }
    .eh__label--static { cursor: pointer; }
    .eh__input {
      flex: 1;
      min-width: 0;
      min-height: 24px;
      padding: 2px 6px;
      border: 1px solid #21409A;
      border-radius: 4px;
      font: inherit;
      color: inherit;
      background: #fff;
      outline: none;
      resize: none;
      overflow: hidden;
      line-height: 1.2;
      white-space: pre-wrap;
    }
    .eh__icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 4px;
      background: transparent;
      backdrop-filter: invert(30%) brightness(150%) blur(4px);
      cursor: pointer;
      color: #45494f;
      opacity: 1;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      flex-shrink: 0;
      padding: 0;
    }
    .eh__icon-btn--active { opacity: 1 !important; color: #21409A; }
    .eh__icon-btn:hover { background: #EEF4FF; color: #21409A; }
    .eh__sort { flex-shrink: 0; color: #21409A; display: flex; }
  `],
})
export class EditableHeaderComponent implements IHeaderAngularComp {
  params!: EditableHeaderParams;
  editing = false;
  draft = '';
  isFilterActive = false;
  sortState: 'asc' | 'desc' | '' = '';
  enableMenu = false;
  enableFilter = false;
  allowRename = false;
  columnSelected = false;
  headerAlign: 'left' | 'center' | 'right' = 'center';
  verticalHeader = false;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('input') set inputRef(ref: ElementRef<HTMLTextAreaElement> | undefined) {
    if (ref) { ref.nativeElement.focus(); ref.nativeElement.select(); }
  }

  agInit(params: EditableHeaderParams): void {
    this.params = params;
    this.allowRename = params.allowRename ?? false;
    this.enableMenu = params.enableMenu ?? false;
    this.enableFilter = params.column?.isFilterAllowed() ?? false;
    this.isFilterActive = params.column?.isFilterActive() ?? false;
    this.columnSelected = params.isColumnSelected?.(params.column?.getColId() ?? '') ?? false;
    this.readHeaderLayout(params);
    this.updateSort();
    params.column?.addEventListener('sortChanged', () => this.updateSort());
    params.column?.addEventListener('filterChanged', () => {
      this.isFilterActive = params.column?.isFilterActive() ?? false;
    });
  }

  refresh(params: EditableHeaderParams): boolean {
    this.params = params;
    this.columnSelected = params.isColumnSelected?.(params.column?.getColId() ?? '') ?? false;
    this.readHeaderLayout(params);
    this.updateSort();
    return true;
  }

  /** Mirrors the alignment/orientation the shared util encodes as header CSS classes so it applies even to this custom header. */
  private readHeaderLayout(params: EditableHeaderParams): void {
    const hc = params.column?.getColDef()?.headerClass;
    const classes = Array.isArray(hc) ? hc : typeof hc === 'string' ? [hc] : [];
    this.headerAlign = classes.includes('rb-header-align-left') ? 'left'
      : classes.includes('rb-header-align-right') ? 'right'
      : 'center';
    this.verticalHeader = classes.includes('rb-header-vertical');
  }

  /** Renameable columns edit inline on click; other columns select the column on single click and all its cells on double click. */
  onLabelClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.allowRename) {
      this.draft = this.params.displayName ?? '';
      this.editing = true;
      return;
    }
    const field = this.params.column.getColId();
    const mods = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey };
    // Shift/Ctrl multi-select acts immediately (no double-click variant).
    if (mods.shift || mods.ctrl) {
      if (this.clickTimer) { clearTimeout(this.clickTimer); this.clickTimer = null; }
      this.params.onSelectColumn?.(field, mods);
      return;
    }
    // A second click before the timer fires is a double click → select the whole column.
    // Deferring the single-click select keeps this header's DOM intact between the two
    // clicks (a select triggers refreshHeader, which would otherwise defeat native dblclick).
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
      this.params.onSelectColumnCells?.(field);
      return;
    }
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      this.params.onSelectColumn?.(field, mods);
    }, 250);
  }

  commit(): void {
    if (!this.editing) return;
    this.editing = false;
    const name = this.draft.trim();
    if (name && name !== this.params.displayName) {
      this.params.onRename?.(this.params.column.getColId(), name);
    }
  }

  /** Enter commits the rename; Shift+Enter is left to the textarea so it inserts a newline. */
  onEnterCommit(event: Event): void {
    event.preventDefault();
    this.commit();
  }

  cancel(): void {
    this.editing = false;
  }

  onFilterClicked(event: Event): void {
    event.stopPropagation();
    this.params.showFilter?.(event.currentTarget as HTMLElement);
  }

  onMenuClicked(event: Event): void {
    event.stopPropagation();
    this.params.showColumnMenu(event.currentTarget as HTMLElement);
  }

  private updateSort(): void {
    const sort = this.params.column?.getSort();
    this.sortState = sort === 'asc' ? 'asc' : sort === 'desc' ? 'desc' : '';
  }
}

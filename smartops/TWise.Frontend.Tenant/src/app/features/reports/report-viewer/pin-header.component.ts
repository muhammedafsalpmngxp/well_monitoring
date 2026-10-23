import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { IHeaderParams } from 'ag-grid-community';

interface PinHeaderParams extends IHeaderParams {
  onPinToggle: (field: string, pinned: boolean) => void;
}

@Component({
  selector: 'app-pin-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pin-header">
      <span class="pin-header__label"
        [style.text-align]="headerAlign"
        [style.writing-mode]="verticalHeader ? 'vertical-rl' : null"
        [style.transform]="verticalHeader ? 'rotate(180deg)' : null"
        [style.flex]="verticalHeader ? '0 0 auto' : null"
        [style.width]="verticalHeader ? 'auto' : null"
        [style.max-width]="verticalHeader ? 'none' : null"
        [style.height]="verticalHeader ? 'calc(var(--rb-header-height, 50px) - 8px)' : null"
        [style.white-space]="verticalHeader ? 'normal' : null"
        [style.word-break]="verticalHeader ? 'break-word' : null"
        [style.overflow]="verticalHeader ? 'visible' : null">{{ params.displayName }}</span>
      <span *ngIf="sortState" class="pin-header__sort">
        <svg *ngIf="sortState === 'asc'" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
        <svg *ngIf="sortState === 'desc'" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      <button class="pin-header__icon-btn" [class.pin-header__icon-btn--active]="isFilterActive"
        title="Filter" (click)="onFilterClicked($event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>
      <button class="pin-header__icon-btn" *ngIf="!isPinned"
        title="Move to left" (click)="togglePin($event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 17V3M6 11l6 6 6-6" transform="rotate(90 12 12)" />
        </svg>
      </button>
      <button class="pin-header__icon-btn" *ngIf="enableMenu" title="Menu" (click)="onMenuClicked($event)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    .pin-header {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 2px;
    }
    .pin-header__label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      line-height: 1.2;
      white-space: pre-line;
      cursor: default;
    }
    .pin-header__icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      color: #45494f;
      backdrop-filter: invert(30%) brightness(150%) blur(4px);
      opacity: 1;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      flex-shrink: 0;
      padding: 0;
    }
    .pin-header__icon-btn--active { opacity: 1 !important; color: #21409A; }
    .pin-header__icon-btn--pinned { opacity: 1 !important; color: #21409A; }
    .pin-header__icon-btn:hover { background: #EEF4FF; color: #21409A; }
    .pin-header__sort { flex-shrink: 0; color: #21409A; display: flex; }
  `],
})
export class PinHeaderComponent implements IHeaderAngularComp, OnDestroy {
  params!: PinHeaderParams;
  isPinned = false;
  isFilterActive = false;
  enableMenu = false;
  headerAlign: 'left' | 'center' | 'right' = 'center';
  verticalHeader = false;
  sortState: 'asc' | 'desc' | '' = '';

  // Tracks whether this column's filter popup is currently open so the button acts as a
  // toggle: AG Grid renders the popup outside the button, so a second click would otherwise
  // close (via outside-click) and immediately reopen it. See onFilterClicked.
  private filterOpen = false;
  private filterAnchorEl: HTMLElement | null = null;

  agInit(params: PinHeaderParams): void {
    this.params = params;
    this.isPinned = params.column?.isPinned() ?? false;
    this.isFilterActive = params.column?.isFilterActive() ?? false;
    this.enableMenu = params.enableMenu ?? false;
    this.readHeaderLayout(params);
    this.updateSort();
    params.column?.addEventListener('sortChanged', () => this.updateSort());
    params.column?.addEventListener('columnPinned' as any, () => {
      this.isPinned = params.column?.isPinned() ?? false;
    });
    params.column?.addEventListener('filterChanged', () => {
      this.isFilterActive = params.column?.isFilterActive() ?? false;
    });
  }

  refresh(params: PinHeaderParams): boolean {
    this.params = params;
    this.isPinned = params.column?.isPinned() ?? false;
    this.isFilterActive = params.column?.isFilterActive() ?? false;
    this.readHeaderLayout(params);
    this.updateSort();
    return true;
  }

  /** Mirrors the alignment/orientation the shared util encodes as header CSS classes so it applies even to this custom header. */
  private readHeaderLayout(params: PinHeaderParams): void {
    const hc = params.column?.getColDef()?.headerClass;
    const classes = Array.isArray(hc) ? hc : typeof hc === 'string' ? [hc] : [];
    this.headerAlign = classes.includes('rb-header-align-left') ? 'left'
      : classes.includes('rb-header-align-right') ? 'right'
      : 'center';
    this.verticalHeader = classes.includes('rb-header-vertical');
  }

  togglePin(event: Event): void {
    event.stopPropagation();
    const col = this.params.column;
    this.params.onPinToggle(col.getColId(), true);
  }

  onFilterClicked(event: Event): void {
    event.stopPropagation();
    const anchor = event.currentTarget as HTMLElement;
    // AG Grid ignores clicks on the popup's anchor, so a second click never closes the popup
    // by itself — close it explicitly. The DOM check covers popups closed via Apply/Escape.
    if (this.filterOpen && this.isFilterPopupInDom()) {
      this.params.api?.hideColumnFilter?.();
      this.resetFilterTracking();
      anchor.blur();
      return;
    }
    this.params.showFilter!(anchor);
    this.filterOpen = true;
    this.filterAnchorEl = anchor;
    document.addEventListener('mousedown', this.onOutsideMousedown, true);
  }

  // Keeps filterOpen in sync when the popup closes by any means other than clicking this
  // button (selecting outside, another column, etc.) so the toggle doesn't go stale.
  private onOutsideMousedown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    // Clicking this button again: let onFilterClicked handle the toggle.
    if (this.filterAnchorEl?.contains(target)) return;
    // Interacting inside the open filter popup: keep it open.
    if (target?.closest?.('.ag-popup, .ag-menu')) return;
    this.resetFilterTracking();
  };

  private isFilterPopupInDom(): boolean {
    return !!document.querySelector('.ag-popup .ag-filter-menu, .ag-popup .ag-filter');
  }

  private resetFilterTracking(): void {
    this.filterOpen = false;
    this.filterAnchorEl = null;
    document.removeEventListener('mousedown', this.onOutsideMousedown, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousedown', this.onOutsideMousedown, true);
  }

  onMenuClicked(event: Event): void {
    event.stopPropagation();
    this.params.showColumnMenu(event.currentTarget as HTMLElement);
  }

  private updateSort(): void {
    if (!this.params.column) { this.sortState = ''; return; }
    const sort = this.params.column.getSort();
    this.sortState = sort === 'asc' ? 'asc' : sort === 'desc' ? 'desc' : '';
  }
}

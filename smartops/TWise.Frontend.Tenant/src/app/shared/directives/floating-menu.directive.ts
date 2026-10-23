import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';

const GAP = 4;
const EDGE = 8;

/**
 * Floats a card's "more options" menu above the page instead of inside the card list.
 *
 * The menus are `position: absolute` under their ⋮ button, so near the bottom of a scrolling
 * card list they ran past its edge and made the list itself scroll. This switches the panel to
 * `position: fixed` next to its anchor (the parent element by default): right-aligned under the
 * button, flipped above it when there is no room below, and kept inside the page content area
 * (right of the sidebar) and the viewport. Accounts for
 * the app's font-size zoom on <app-root> (`--app-zoom-factor`).
 *
 * Usage: `<div class="x__menu-panel" *ngIf="open" appFloatingMenu (floatingMenuScroll)="close...()">`.
 */
@Directive({ selector: '[appFloatingMenu]', standalone: true })
export class FloatingMenuDirective implements AfterViewInit, OnDestroy {
  /** Element to align to; defaults to the panel's parent (the ⋮ button wrapper). */
  @Input() floatingMenuAnchor?: HTMLElement;

  /** Fires when the page/a container scrolls while the menu is open, so the host can close it —
   *  since the panel is `position: fixed`, it would otherwise appear to drift and "stay open". */
  @Output() floatingMenuScroll = new EventEmitter<void>();

  constructor(private readonly el: ElementRef<HTMLElement>) {}

  // Capture phase: the card lists scroll inside their own containers, whose scroll events
  // don't bubble up to document. Ignores scrolling inside the panel itself (e.g. a long menu
  // list with its own overflow), which shouldn't close the menu.
  private readonly onScroll = (e: Event): void => {
    const target = e.target as Node | null;
    if (target && this.el.nativeElement.contains(target)) return;
    this.floatingMenuScroll.emit();
  };

  ngAfterViewInit(): void {
    this.position();
    document.addEventListener('scroll', this.onScroll, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
  }

  @HostListener('window:resize')
  onViewportChange(): void {
    this.position();
  }

  private position(): void {
    const panel = this.el.nativeElement;
    const anchor = this.floatingMenuAnchor ?? panel.parentElement;
    if (!anchor) return;
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')) || 1;

    panel.style.position = 'fixed';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.zIndex = '1300';
    panel.style.maxHeight = '';
    panel.style.overflowY = '';

    const rect = anchor.getBoundingClientRect();
    const top = rect.top / zoom;
    const bottom = rect.bottom / zoom;
    const right = rect.right / zoom;
    const vw = window.innerWidth / zoom;
    const vh = window.innerHeight / zoom;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    // Stay within the page content area (right of the sidebar), not just the window.
    // Inset matches .paddingContent's own padding, so the panel lines up with the page's cards.
    const content = anchor.closest('.paddingContent')?.getBoundingClientRect();
    const inset = 16;
    const minLeft = Math.max(EDGE, content ? content.left / zoom + inset : EDGE);
    const maxRight = Math.min(vw - EDGE, content ? content.right / zoom - inset : vw - EDGE);
    const left = width > maxRight - minLeft
      ? Math.max(EDGE, (vw - width) / 2) // wider than the content area (phones): centre on screen
      : Math.max(minLeft, Math.min(right - width, maxRight - width));
    const roomBelow = vh - bottom - GAP - EDGE;
    const roomAbove = top - GAP - EDGE;
    let panelTop: number;
    if (height <= roomBelow || roomBelow >= roomAbove) {
      panelTop = bottom + GAP;
      if (height > roomBelow) panel.style.maxHeight = `${roomBelow}px`;
    } else {
      panelTop = Math.max(EDGE, top - GAP - height);
      if (height > roomAbove) panel.style.maxHeight = `${roomAbove}px`;
    }
    if (panel.style.maxHeight) panel.style.overflowY = 'auto';

    panel.style.left = `${left}px`;
    panel.style.top = `${panelTop}px`;
  }
}

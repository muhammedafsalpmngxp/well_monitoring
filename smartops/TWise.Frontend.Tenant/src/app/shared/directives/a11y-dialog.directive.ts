import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, OnDestroy, Output } from '@angular/core';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextHeadingId = 0;

/**
 * Makes a modal panel accessible (WCAG 2.1.2, 2.4.3, 4.1.2): role="dialog" + aria-modal, named by its
 * first heading, focus moved inside on open, Tab / Shift+Tab kept inside, Escape emits dialogClose,
 * and focus returned to the element that opened it when the panel is removed.
 */
@Directive({ selector: '[appDialog]', standalone: true })
export class A11yDialogDirective implements AfterViewInit, OnDestroy {
  /** Escape was pressed inside the dialog; bind to the same handler as the close button. */
  @Output() dialogClose = new EventEmitter<void>();

  private readonly opener: HTMLElement | null;

  constructor(private readonly host: ElementRef<HTMLElement>) {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
  }

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      const heading = el.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
      if (heading) {
        heading.id ||= `app-dialog-title-${++nextHeadingId}`;
        el.setAttribute('aria-labelledby', heading.id);
      }
    }
    // Only take focus when the panel is actually shown (some panels stay in the DOM while hidden).
    if (this.isShown() && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>('[autofocus]') ?? this.focusables()[0] ?? el).focus();
    }
  }

  ngOnDestroy(): void {
    if (this.opener?.isConnected) this.opener.focus();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.dialogClose.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    const el = this.host.nativeElement;
    if (!items.length) {
      event.preventDefault();
      el.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === el)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(item => !item.closest('[hidden], [aria-hidden="true"]'));
  }

  private isShown(): boolean {
    const el = this.host.nativeElement;
    return el.isConnected && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none'
      && getComputedStyle(el).visibility !== 'hidden';
  }
}

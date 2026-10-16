import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';

const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard access for a clickable element that is not a native button or link (WCAG 2.1.1, 4.1.2):
 * puts it in the Tab order, and Enter / Space trigger its existing (click) handler. It is announced as
 * role="button" only while it holds no controls of its own — a card with buttons inside stays a plain
 * focusable container, because a button inside a button is unusable for screen readers (WCAG 4.1.2).
 */
@Directive({ selector: '[appKeyClick]', standalone: true })
export class KeyClickDirective implements OnInit, AfterViewInit, OnDestroy {
  private ownsRole = false;
  private observer?: MutationObserver;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    const el = this.host.nativeElement;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    this.ownsRole = !el.hasAttribute('role');
    this.updateRole();
  }

  ngAfterViewInit(): void {
    if (!this.ownsRole || typeof MutationObserver === 'undefined') return;
    // Rows and cards often render their inner buttons later (ngFor, async data).
    this.observer = new MutationObserver(() => this.updateRole());
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
    this.updateRole();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Keys typed in a field or pressed on a control inside the element belong to that control.
    if (event.target !== this.host.nativeElement) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    // dispatchEvent rather than click(): SVG elements have no click() method.
    this.host.nativeElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  private updateRole(): void {
    if (!this.ownsRole) return;
    const el = this.host.nativeElement;
    if (el.querySelector(INTERACTIVE)) el.removeAttribute('role');
    else if (el.getAttribute('role') !== 'button') el.setAttribute('role', 'button');
  }
}

import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, HostListener, Inject, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';

let nextTooltipId = 0;

@Directive({ selector: '[appTileTooltip]', standalone: true })
export class TileTooltipDirective implements OnInit, OnChanges, OnDestroy {
  @Input() appTileTooltip: string | null | undefined = '';

  private tooltip?: HTMLDivElement;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private addedTabIndex = false;
  private readonly id = `tile-tooltip-${++nextTooltipId}`;
  private readonly dismiss = (): void => this.hide();
  private readonly onScroll = (event: Event): void => {
    if (event.target !== this.tooltip) this.hide();
  };
  private readonly escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hide();
  };

  constructor(
    private readonly el: ElementRef<HTMLElement>,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  ngOnInit(): void {
    if (!this.el.nativeElement.hasAttribute('tabindex')) {
      this.el.nativeElement.tabIndex = 0;
      this.addedTabIndex = true;
    }
  }

  ngOnChanges(): void {
    if (this.tooltip) {
      if (!this.appTileTooltip) this.hide();
      else {
        this.tooltip.textContent = this.appTileTooltip;
        this.position();
      }
    }
  }

  @HostListener('mouseenter')
  @HostListener('focusin')
  show(): void {
    this.cancelHide();
    if (this.tooltip || !this.appTileTooltip) return;
    const tooltip = this.document.createElement('div');
    tooltip.id = this.id;
    tooltip.className = 'app-tile-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = this.appTileTooltip;
    tooltip.addEventListener('mouseenter', () => this.cancelHide());
    tooltip.addEventListener('mouseleave', () => this.scheduleHide());
    this.document.body.appendChild(tooltip);
    this.tooltip = tooltip;
    // The browser top layer escapes overflow, transforms and modal stacking contexts.
    if (typeof tooltip.showPopover === 'function') {
      tooltip.setAttribute('popover', 'manual');
      tooltip.showPopover();
    }
    const host = this.el.nativeElement;
    host.setAttribute('aria-describedby', [host.getAttribute('aria-describedby'), this.id].filter(Boolean).join(' '));
    this.position();
    this.document.addEventListener('scroll', this.onScroll, true);
    this.document.addEventListener('keydown', this.escape);
    this.document.defaultView?.addEventListener('resize', this.dismiss);
  }

  @HostListener('mouseleave')
  scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), 100);
  }

  @HostListener('focusout')
  hide(): void {
    this.cancelHide();
    this.tooltip?.remove();
    this.tooltip = undefined;
    const host = this.el.nativeElement;
    const descriptions = (host.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.id);
    if (descriptions.length) host.setAttribute('aria-describedby', descriptions.join(' '));
    else host.removeAttribute('aria-describedby');
    this.document.removeEventListener('scroll', this.onScroll, true);
    this.document.removeEventListener('keydown', this.escape);
    this.document.defaultView?.removeEventListener('resize', this.dismiss);
  }

  ngOnDestroy(): void {
    this.hide();
    if (this.addedTabIndex) this.el.nativeElement.removeAttribute('tabindex');
  }

  private cancelHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  private position(): void {
    const tooltip = this.tooltip;
    const viewport = this.document.defaultView;
    if (!tooltip || !viewport) return;
    const rect = this.el.nativeElement.getBoundingClientRect();
    const edge = 8;
    const gap = 8;
    const width = tooltip.getBoundingClientRect().width;
    const height = tooltip.getBoundingClientRect().height;
    const left = Math.max(edge, Math.min(rect.left, viewport.innerWidth - width - edge));
    const top = rect.top >= height + gap + edge ? rect.top - height - gap : rect.bottom + gap;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(edge, Math.min(top, viewport.innerHeight - height - edge))}px`;
  }
}

import { AfterViewInit, Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

const SIDE_CLASSES = ['chart-legend-layout--left', 'chart-legend-layout--right'];
const PAGED_CLASS = 'chart-legend-pager--paged';
const OFF_PAGE_CLASS = 'chart-legend-pager__off';
const CHEVRON = (points: string) =>
  `<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="${points}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Pages a chart's HTML legend pills when the legend sits beside the chart (left/right legend position):
 * `pageSize` pills at a time, with ‹ 1/3 › controls under them. The pills stay rendered and only the ones
 * off the current page are hidden, so their own click/hover handlers and indexes are untouched.
 *
 * Top/bottom legends, and side legends that fall back to a bottom row on narrow cards (the
 * `chart-legend-layout` container query, detected through the legend's flex direction), show every pill.
 *
 * Place it on the `.chart-legend-layout__legend` element, a direct child of the `.chart-legend-layout` wrapper.
 */
@Directive({ selector: '[appLegendPager]', standalone: true })
export class LegendPagerDirective implements AfterViewInit, OnDestroy {
  @Input() legendPageSize = 5;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private page = 0;
  private pageCount = 1;
  private nav?: HTMLElement;
  private prev?: HTMLButtonElement;
  private next?: HTMLButtonElement;
  private status?: HTMLElement;
  private mutations?: MutationObserver;
  private resizes?: ResizeObserver;

  ngAfterViewInit(): void {
    const layout = this.host.parentElement;
    if (typeof MutationObserver !== 'undefined') {
      this.mutations = new MutationObserver(() => this.refresh());
      // Pills come and go with the data; the wrapper's class changes with the legend position.
      this.mutations.observe(this.host, { childList: true });
      if (layout) this.mutations.observe(layout, { attributes: true, attributeFilter: ['class'] });
    }
    if (layout && typeof ResizeObserver !== 'undefined') {
      // Crossing the narrow-card breakpoint switches between a paged column and the full bottom row.
      this.resizes = new ResizeObserver(() => this.refresh());
      this.resizes.observe(layout);
    }
    this.refresh();
  }

  ngOnDestroy(): void {
    this.mutations?.disconnect();
    this.resizes?.disconnect();
  }

  /** Re-evaluates whether the legend pages, and where. */
  refresh(): void {
    const host = this.host;
    const pills = this.pills();
    const size = Math.max(1, Math.floor(this.legendPageSize) || 1);

    // Start from every pill shown so the side/narrow check and the width measurement see the full legend.
    host.classList.remove(PAGED_CLASS);
    host.style.removeProperty('width');
    for (const pill of pills) pill.classList.remove(OFF_PAGE_CLASS);

    const side = SIDE_CLASSES.some(name => host.parentElement?.classList.contains(name));
    const paged = side && pills.length > size && getComputedStyle(host).flexDirection === 'column';
    if (!paged) {
      this.page = 0;
      if (this.nav) this.nav.hidden = true;
      return;
    }

    this.pageCount = Math.ceil(pills.length / size);
    this.page = Math.min(this.page, this.pageCount - 1);
    const nav = this.ensureNav();
    nav.hidden = false;
    // Keep the pager under the last pill as pills are added before it.
    if (host.lastElementChild !== nav) host.appendChild(nav);
    host.classList.add(PAGED_CLASS);
    // Lock the width measured with every pill showing, so the chart beside it doesn't shift between pages.
    host.style.width = `${host.offsetWidth + 1}px`;
    this.render(pills, size);
  }

  private go(step: number): void {
    const target = Math.min(Math.max(this.page + step, 0), this.pageCount - 1);
    if (target === this.page) return;
    this.page = target;
    this.render(this.pills(), Math.max(1, Math.floor(this.legendPageSize) || 1));
  }

  private render(pills: HTMLElement[], size: number): void {
    pills.forEach((pill, index) => pill.classList.toggle(OFF_PAGE_CLASS, Math.floor(index / size) !== this.page));
    if (!this.prev || !this.next || !this.status) return;
    this.status.textContent = `${this.page + 1}/${this.pageCount}`;
    const focused = this.host.ownerDocument.activeElement;
    this.prev.disabled = this.page === 0;
    this.next.disabled = this.page === this.pageCount - 1;
    // A button disabled under the keyboard would drop focus to the page; hand it to the other arrow.
    if (focused === this.prev && this.prev.disabled) this.next.focus();
    if (focused === this.next && this.next.disabled) this.prev.focus();
  }

  private pills(): HTMLElement[] {
    return Array.from(this.host.children).filter((child): child is HTMLElement => child !== this.nav && child instanceof HTMLElement);
  }

  private ensureNav(): HTMLElement {
    if (this.nav) return this.nav;
    const doc = this.host.ownerDocument;
    const nav = doc.createElement('div');
    // board-no-drag: the dashboard grids must not start dragging the card from these buttons.
    nav.className = 'chart-legend-pager board-no-drag';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Legend pages');
    const button = (label: string, path: string, step: number): HTMLButtonElement => {
      const element = doc.createElement('button');
      element.type = 'button';
      element.className = 'chart-legend-pager__btn';
      element.setAttribute('aria-label', label);
      element.innerHTML = CHEVRON(path);
      element.addEventListener('click', event => { event.stopPropagation(); this.go(step); });
      return element;
    };
    this.prev = button('Previous legend page', 'M5 1.5L2.5 4L5 6.5', -1);
    this.next = button('Next legend page', 'M3 1.5L5.5 4L3 6.5', 1);
    this.status = doc.createElement('span');
    this.status.className = 'chart-legend-pager__status';
    this.status.setAttribute('aria-live', 'polite');
    nav.append(this.prev, this.status, this.next);
    // Keep clicks and drags on the pager from reaching card click handlers and the grid's drag.
    for (const type of ['click', 'mousedown', 'pointerdown', 'touchstart']) nav.addEventListener(type, event => event.stopPropagation());
    this.nav = nav;
    return nav;
  }
}

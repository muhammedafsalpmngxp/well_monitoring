import { AfterViewInit, Directive, ElementRef, EventEmitter, NgZone, OnDestroy, Output } from '@angular/core';

/**
 * Emits `appLazyVisible` once when the host element first scrolls into the viewport,
 * then stops observing. Falls back to emitting immediately if IntersectionObserver
 * is unavailable so functionality is never lost.
 */
@Directive({ selector: '[appLazyVisible]', standalone: false })
export class LazyVisibleDirective implements AfterViewInit, OnDestroy {
  @Output() appLazyVisible = new EventEmitter<void>();

  private observer?: IntersectionObserver;
  private emitted = false;

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.emit();
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) {
          this.zone.run(() => this.emit());
        }
      }, { root: null, rootMargin: '200px', threshold: 0.01 });
      this.observer.observe(this.host.nativeElement);
    });
  }

  private emit(): void {
    if (this.emitted) return;
    this.emitted = true;
    this.appLazyVisible.emit();
    this.observer?.disconnect();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}

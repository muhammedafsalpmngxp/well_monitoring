import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: '[appGlobalFilterOption]',
  standalone: true,
  host: {
    'role': 'checkbox',
    '[class.global-filter-option]': 'true',
    '[class.active]': 'selected',
    '[attr.role]': 'isAll ? "button" : "checkbox"',
    '[attr.aria-checked]': 'isAll ? null : selected',
    'tabindex': '0',
  },
})
export class GlobalFilterOptionDirective {
  @Input('appGlobalFilterOption') selected = false;
  @Input() globalFilterValue = '';

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  get isAll(): boolean {
    return this.globalFilterValue === 'All';
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const element = this.host.nativeElement;
    if (event.target !== element) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.stopPropagation();
    if (event.defaultPrevented || element.hasAttribute('appKeyClick') || element.tagName === 'BUTTON') return;
    event.preventDefault();
    element.click();
  }
}

import { AfterViewInit, Directive, ElementRef } from '@angular/core';

let nextLabelId = 0;

/**
 * Gives a form field an accessible name when the template shows a label next to it but never links
 * them (WCAG 1.3.1, 3.3.2, 4.1.2): the nearest preceding <label> in the same field group becomes its
 * aria-labelledby; with no such label, the placeholder (or title) becomes its aria-label. Fields that
 * already have a name (aria-label, aria-labelledby, <label for>, wrapping <label>) are left alone.
 */
@Directive({
  selector: 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea',
  standalone: true,
})
export class FieldLabelDirective implements AfterViewInit {
  constructor(private readonly host: ElementRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {}

  ngAfterViewInit(): void {
    this.applyName();
  }

  private applyName(): void {
    const field = this.host.nativeElement;
    if (field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby') || field.labels?.length) return;

    const label = this.nearestLabel(field) ?? this.optionText(field);
    if (label) {
      label.id ||= `app-field-label-${++nextLabelId}`;
      field.setAttribute('aria-labelledby', label.id);
      return;
    }
    const fallback = field.getAttribute('placeholder') || field.getAttribute('title');
    if (fallback) field.setAttribute('aria-label', fallback.trim());
  }

  /** A checkbox or radio written as `<input type="checkbox"><span>Option</span>`: its text is the next element. */
  private optionText(field: HTMLElement): HTMLElement | null {
    if (!/^(checkbox|radio)$/i.test(field.getAttribute('type') ?? '')) return null;
    const next = field.nextElementSibling as HTMLElement | null;
    return next && !next.matches('input, select, textarea, button') && next.textContent?.trim() ? next : null;
  }

  /**
   * The closest <label> before the field, looking up to three levels out. A label with another
   * field between it and this one belongs to that field, so it is not used.
   */
  private nearestLabel(field: HTMLElement): HTMLLabelElement | null {
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    let group: HTMLElement | null = field.parentElement;
    for (let depth = 0; group && depth < 3; depth++, group = group.parentElement) {
      const labels = Array.from(group.querySelectorAll('label')).filter(label =>
        !label.htmlFor && !label.querySelector('input, select, textarea') && before(label, field));
      if (!labels.length) continue;
      const label = labels[labels.length - 1];
      const between = Array.from(group.querySelectorAll('input, select, textarea'))
        .some(other => other !== field && before(label, other) && before(other, field));
      return between ? null : label;
    }
    return null;
  }
}

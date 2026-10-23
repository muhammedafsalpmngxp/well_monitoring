import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalFilterOptionDirective } from './global-filter-option.directive';
import { KeyClickDirective } from './key-click.directive';

@Component({
  imports: [GlobalFilterOptionDirective, KeyClickDirective],
  template: `
    <section (click)="parentClick()" (keydown.enter)="parentKey()">
      <div id="plain" [appGlobalFilterOption]="selected()" [globalFilterValue]="value()" (click)="choose()">Plant</div>
      <div id="key-click" appKeyClick [appGlobalFilterOption]="selected()" [globalFilterValue]="value()" (click)="choose()">Plant</div>
      <button id="native" type="button" [appGlobalFilterOption]="selected()" [globalFilterValue]="value()" (click)="choose()">Plant</button>
    </section>
  `,
})
class OptionHost {
  selected = signal(false);
  value = signal('Plant');
  choose = vi.fn();
  parentClick = vi.fn();
  parentKey = vi.fn();
}

describe('GlobalFilterOptionDirective', () => {
  let fixture: ComponentFixture<OptionHost>;
  let host: OptionHost;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OptionHost] });
    fixture = TestBed.createComponent(OptionHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function option(id: string): HTMLElement {
    return fixture.nativeElement.querySelector(`#${id}`);
  }

  it.each(['plain', 'key-click', 'native'])('reflects selection and reset semantics on %s', async id => {
    const element = option(id);
    expect(element.getAttribute('role')).toBe('checkbox');
    expect(element.getAttribute('aria-checked')).toBe('false');
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.classList.contains('global-filter-option')).toBe(true);
    host.selected.set(true);
    await fixture.whenStable();
    expect(element.classList.contains('active')).toBe(true);
    expect(element.getAttribute('aria-checked')).toBe('true');
    host.value.set('All');
    await fixture.whenStable();
    expect(element.getAttribute('role')).toBe('button');
    expect(element.hasAttribute('aria-checked')).toBe(false);
  });

  it.each(['plain', 'key-click', 'native'])('selects once without closing the dropdown on %s', id => {
    option(id).click();
    expect(host.choose).toHaveBeenCalledOnce();
    expect(host.parentClick).not.toHaveBeenCalled();
  });

  it.each(['plain', 'key-click'])('activates %s exactly once per Enter or Space key', id => {
    for (const key of ['Enter', ' ']) {
      option(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(host.choose).toHaveBeenCalledTimes(2);
    expect(host.parentClick).not.toHaveBeenCalled();
    expect(host.parentKey).not.toHaveBeenCalled();
  });

  it('preserves native button keyboard activation without synthesizing another click', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    option('native').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(host.choose).not.toHaveBeenCalled();
    expect(host.parentKey).not.toHaveBeenCalled();
    option('native').click();
    expect(host.choose).toHaveBeenCalledOnce();
  });
});

import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldLabelDirective } from './field-label.directive';

function label(html: string, selector = 'input, select, textarea') {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  const field = root.querySelector<HTMLInputElement>(selector)!;
  new FieldLabelDirective(new ElementRef(field)).ngAfterViewInit();
  return field;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('FieldLabelDirective', () => {
  it('links the label shown next to the field', () => {
    const field = label('<div class="form-group"><label>Email</label><input type="email"></div>');
    expect(document.getElementById(field.getAttribute('aria-labelledby')!)!.textContent).toBe('Email');
  });

  it('picks each field\'s own label when a row holds several', () => {
    const root = document.createElement('div');
    root.innerHTML = '<label>From</label><input id="a"><label>To</label><input id="b">';
    document.body.appendChild(root);
    const to = root.querySelector<HTMLInputElement>('#b')!;
    new FieldLabelDirective(new ElementRef(to)).ngAfterViewInit();
    expect(document.getElementById(to.getAttribute('aria-labelledby')!)!.textContent).toBe('To');
  });

  it('names a checkbox by the option text next to it', () => {
    const field = label('<li><input type="checkbox"><span>Nimr</span></li>');
    expect(document.getElementById(field.getAttribute('aria-labelledby')!)!.textContent).toBe('Nimr');
  });

  it('falls back to the placeholder when there is no label', () => {
    const field = label('<div><input placeholder="Search users"></div>');
    expect(field.getAttribute('aria-label')).toBe('Search users');
  });

  it('leaves fields that already have a name alone', () => {
    const named = label('<div><label>Ignored</label><select aria-label="Status"></select></div>');
    expect(named.getAttribute('aria-label')).toBe('Status');
    expect(named.getAttribute('aria-labelledby')).toBeNull();
    const linked = label('<div><label for="x">Name</label><input id="x"></div>');
    expect(linked.getAttribute('aria-labelledby')).toBeNull();
  });

  it('does not borrow a label from a neighbouring field group', () => {
    const field = label('<div><label>Name</label><input id="n"><div><input id="other" placeholder="Code"></div></div>', '#other');
    expect(field.getAttribute('aria-labelledby')).toBeNull();
    expect(field.getAttribute('aria-label')).toBe('Code');
  });
});

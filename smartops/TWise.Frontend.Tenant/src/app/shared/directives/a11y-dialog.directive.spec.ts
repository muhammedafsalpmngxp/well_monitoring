import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A11yDialogDirective } from './a11y-dialog.directive';

function open(html: string) {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const panel = document.createElement('div');
  panel.innerHTML = html;
  document.body.appendChild(panel);
  const dialog = new A11yDialogDirective(new ElementRef(panel));
  dialog.ngAfterViewInit();
  return { opener, panel, dialog };
}

function key(target: HTMLElement, dialog: A11yDialogDirective, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  dialog.onKeydown(event);
  return event;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('A11yDialogDirective', () => {
  it('marks the panel as a modal dialog named by its heading', () => {
    const { panel } = open('<h3>Create User</h3><input id="name"><button>Save</button>');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const heading = panel.querySelector('h3')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('keeps an existing role and label', () => {
    const { panel } = open('<h3>Title</h3>');
    const kept = document.createElement('div');
    kept.setAttribute('role', 'alertdialog');
    kept.setAttribute('aria-label', 'Delete report');
    document.body.appendChild(kept);
    new A11yDialogDirective(new ElementRef(kept)).ngAfterViewInit();
    expect(kept.getAttribute('role')).toBe('alertdialog');
    expect(kept.getAttribute('aria-labelledby')).toBeNull();
    expect(panel.getAttribute('role')).toBe('dialog');
  });

  it('moves focus to the first control when it opens', () => {
    const { panel } = open('<h3>T</h3><input id="first"><button id="last">OK</button>');
    expect(document.activeElement).toBe(panel.querySelector('#first'));
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    const { panel, dialog } = open('<input id="first"><button id="last">OK</button>');
    const first = panel.querySelector<HTMLElement>('#first')!;
    const last = panel.querySelector<HTMLElement>('#last')!;
    last.focus();
    expect(key(last, dialog, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key(first, dialog, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('emits dialogClose on Escape and returns focus to the opener when removed', () => {
    const { opener, panel, dialog } = open('<button>OK</button>');
    const closed = vi.fn();
    dialog.dialogClose.subscribe(closed);
    key(panel.querySelector('button')!, dialog, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
    panel.remove();
    dialog.ngOnDestroy();
    expect(document.activeElement).toBe(opener);
  });

  it('does not take focus while the panel is hidden', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const panel = document.createElement('div');
    panel.style.display = 'none';
    panel.innerHTML = '<input>';
    document.body.appendChild(panel);
    new A11yDialogDirective(new ElementRef(panel)).ngAfterViewInit();
    expect(document.activeElement).toBe(opener);
  });
});

import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyClickDirective } from './key-click.directive';

function setup(el: Element) {
  document.body.appendChild(el);
  const directive = new KeyClickDirective(new ElementRef(el as HTMLElement));
  directive.ngOnInit();
  const clicked = vi.fn();
  el.addEventListener('click', clicked);
  const press = (key: string, target: Element = el) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    directive.onKeydown(event);
    return event;
  };
  return { clicked, press };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('KeyClickDirective', () => {
  it('puts the element in the Tab order as a button', () => {
    const div = document.createElement('div');
    setup(div);
    expect(div.getAttribute('role')).toBe('button');
    expect(div.getAttribute('tabindex')).toBe('0');
  });

  it('keeps an existing role and tabindex', () => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '-1');
    setup(li);
    expect(li.getAttribute('role')).toBe('option');
    expect(li.getAttribute('tabindex')).toBe('-1');
  });

  it('stays a plain focusable container when it holds its own controls', () => {
    const card = document.createElement('div');
    card.innerHTML = '<span>Board</span><button>Favourite</button>';
    setup(card);
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('runs the click handler on Enter and Space', () => {
    const { clicked, press } = setup(document.createElement('span'));
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(press(' ').defaultPrevented).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it('works on SVG icons, which have no click() method', () => {
    const { clicked, press } = setup(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    press('Enter');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys and keys typed in a field inside it', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    div.appendChild(input);
    const { clicked, press } = setup(div);
    press('a');
    press('Enter', input);
    expect(clicked).not.toHaveBeenCalled();
  });
});

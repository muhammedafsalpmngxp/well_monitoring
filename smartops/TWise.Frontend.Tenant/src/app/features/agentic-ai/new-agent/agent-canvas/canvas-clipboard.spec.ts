import { describe, expect, it } from 'vitest';
import { cloneSteps, EditHistory } from './canvas-clipboard';

describe('cloneSteps', () => {
  it('keeps links inside the copy, keeps outside links, and renames output keys', () => {
    const copies = cloneSteps([
      { id: 'a', value: 'Count wells', outputKey: 'wells', x: 10, y: 20, next: 'b' },
      { id: 'b', value: 'Use {{wells}} and {{other}}', kind: 'router', branches: [{ id: 'b1', op: 'else', target: 'a' }, { id: 'b2', op: 'else', target: 'z' }] },
      { id: 'c', value: 'Each', forEach: 'wells', options: { retryFrom: 'a' } },
    ], new Set(['wells', 'wells_2']));
    const [a, b, c] = copies;
    expect(a.id).not.toBe('a');
    expect(a.x).toBe(50);
    expect(a.y).toBe(80);
    expect(a.next).toBe(b.id);
    expect(a.outputKey).toBe('wells_3');
    expect(b.value).toBe('Use {{wells_3}} and {{other}}');
    expect(b.branches![0].target).toBe(a.id);
    expect(b.branches![1].target).toBe('z');
    expect(b.branches![0].id).not.toBe('b1');
    expect(c.forEach).toBe('wells_3');
    expect(c.options!['retryFrom']).toBe(a.id);
  });
  it('numbers a copy of a copy from the base name', () => {
    const [copy] = cloneSteps([{ id: 'x', value: 'T', outputKey: 'title_2' }], new Set(['title', 'title_2']));
    expect(copy.outputKey).toBe('title_3');
  });
});

describe('EditHistory', () => {
  it('undoes and redoes snapshots and drops redo after a new change', () => {
    const h = new EditHistory(2);
    h.record('v1'); h.record('v2'); h.record('v3');
    expect(h.undo()).toBe('v2');
    expect(h.undo()).toBe('v1');
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe('v2');
    h.record('v4');
    expect(h.canRedo).toBe(false);
    h.record('v5'); h.record('v6');
    expect(h.undo()).toBe('v5');
    expect(h.undo()).toBe('v4');
    expect(h.undo()).toBeNull();   // limit 2
  });
});

import { describe, expect, it } from 'vitest';
import { PANE_WIDTHS, clampPaneWidth, readPaneWidth, savePaneWidth } from './pane-width.util';

function fakeStorage(saved: Record<string, string> = {}) {
  const store = new Map(Object.entries(saved));
  return () => ({ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) }) as unknown as Storage;
}

const blocked = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };

describe('pane widths', () => {
  it('keeps a width inside the pane limits, in whole pixels', () => {
    expect(clampPaneWidth('pane', 300.6)).toBe(301);
    expect(clampPaneWidth('pane', 10)).toBe(PANE_WIDTHS.pane.min);
    expect(clampPaneWidth('inspector', 9999)).toBe(PANE_WIDTHS.inspector.max);
    expect(clampPaneWidth('inspector', Number.NaN)).toBe(PANE_WIDTHS.inspector.initial);
  });

  it('reads the saved width, and the initial one when nothing usable is saved', () => {
    expect(readPaneWidth('pane', fakeStorage())).toBe(260);
    expect(readPaneWidth('pane', fakeStorage({ 'twise.model-studio.pane-width': '320' }))).toBe(320);
    expect(readPaneWidth('inspector', fakeStorage({ 'twise.model-studio.inspector-width': '9999' }))).toBe(520);
    expect(readPaneWidth('inspector', fakeStorage({ 'twise.model-studio.inspector-width': 'wide' }))).toBe(300);
  });

  it('saves a width, and neither reading nor saving throws when the browser blocks storage', () => {
    const storage = fakeStorage();
    savePaneWidth('pane', 333.2, storage);
    expect(readPaneWidth('pane', storage)).toBe(333);

    expect(readPaneWidth('pane', blocked)).toBe(260);
    expect(() => savePaneWidth('pane', 300, blocked)).not.toThrow();
  });
});

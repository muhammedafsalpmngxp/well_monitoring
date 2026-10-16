/** The Studio's side panes the user can widen or narrow, with their limits in CSS pixels. */
export const PANE_WIDTHS = {
  inspector: { min: 240, max: 520, initial: 300 },
  pane: { min: 220, max: 480, initial: 260 },
} as const;

export type StudioPane = keyof typeof PANE_WIDTHS;

/** Storage is passed as a getter, because reading window.localStorage itself can throw. */
type StorageGetter = () => Storage;

const browserStorage: StorageGetter = () => localStorage;

const storageKey = (pane: StudioPane) => `twise.model-studio.${pane}-width`;

/** A width inside the pane's limits, in whole pixels; anything that is not a number gives the initial width. */
export function clampPaneWidth(pane: StudioPane, width: number): number {
  const { min, max, initial } = PANE_WIDTHS[pane];
  return Number.isFinite(width) ? Math.round(Math.min(max, Math.max(min, width))) : initial;
}

/**
 * The width saved in this browser, or the initial one. Storage can be missing or refuse access
 * (private windows, blocked site data), and the page must work the same without it.
 */
export function readPaneWidth(pane: StudioPane, storage: StorageGetter = browserStorage): number {
  try {
    const saved = storage().getItem(storageKey(pane));
    return saved === null ? PANE_WIDTHS[pane].initial : clampPaneWidth(pane, Number(saved));
  } catch {
    return PANE_WIDTHS[pane].initial;
  }
}

export function savePaneWidth(pane: StudioPane, width: number, storage: StorageGetter = browserStorage): void {
  try {
    storage().setItem(storageKey(pane), String(clampPaneWidth(pane, width)));
  } catch {
    // ponytail: the width is simply not remembered when storage is blocked; the pane still resizes.
  }
}

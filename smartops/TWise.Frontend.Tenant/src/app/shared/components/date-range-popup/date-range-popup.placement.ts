/** Preferred popup width (px); it shrinks to fit narrower screens. */
export const DATE_RANGE_POPUP_WIDTH = 600;
/** Gap kept between the popup and the viewport edges. */
export const DATE_RANGE_POPUP_MARGIN = 12;
/** Below this much room under the trigger, the popup moves up so it stays usable. */
const MIN_USABLE_HEIGHT = 320;
const TRIGGER_GAP = 8;

export interface DateRangePopupPlacement {
  top: number;
  left: number;
  maxHeight: number;
}

/** `zoom` on <app-root> (font-size setting) scales fixed-position coordinates. */
export function appZoomFactor(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')) || 1;
}

/** Viewport size in the zoomed layout's CSS pixels. */
export function zoomedViewport(): { width: number; height: number } {
  const zoom = appZoomFactor();
  return { width: window.innerWidth / zoom, height: window.innerHeight / zoom };
}

/**
 * Places the date-range popup against the clicked From/To trigger on any screen size:
 * left-aligned to the trigger, or right-aligned when that would run off the right edge,
 * always clamped inside the viewport, opening below the trigger with the remaining height.
 */
export function dateRangePopupPlacement(event: Event): DateRangePopupPlacement {
  const { width: vw, height: vh } = zoomedViewport();
  const trigger = (event.currentTarget ?? event.target) as HTMLElement | null;
  const zoom = appZoomFactor();
  const rect = trigger?.getBoundingClientRect();
  const width = Math.min(DATE_RANGE_POPUP_WIDTH, vw - DATE_RANGE_POPUP_MARGIN * 2);

  if (!rect) {
    const top = DATE_RANGE_POPUP_MARGIN;
    return { top, left: (vw - width) / 2, maxHeight: vh - top * 2 };
  }

  const left0 = rect.left / zoom;
  const right0 = rect.right / zoom;
  let left = left0 + width > vw - DATE_RANGE_POPUP_MARGIN ? right0 - width : left0;
  left = Math.max(DATE_RANGE_POPUP_MARGIN, Math.min(left, vw - width - DATE_RANGE_POPUP_MARGIN));

  let top = rect.bottom / zoom + TRIGGER_GAP;
  top = Math.max(DATE_RANGE_POPUP_MARGIN, Math.min(top, vh - DATE_RANGE_POPUP_MARGIN - MIN_USABLE_HEIGHT));
  return { top, left, maxHeight: vh - top - DATE_RANGE_POPUP_MARGIN };
}
